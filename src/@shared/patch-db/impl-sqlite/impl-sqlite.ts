import { SqlClient } from "../../sql-client/interface";
import { Entity, Patch, PatchesDb, PatchesDbQuery, PatchesDbQueryWhereClause, PatchesDbResult } from "../interface";
import insertPatch from "./insert-patch.sql" with { type: "text" };
import migrations from "./migrations.sql" with { type: "text" };

type PatchRow = {
    patch_id: string;
    entity_id: string;
    entity_type: string;
    attributes: string;
    created_at: string;
    recorded_at: string;
    parent_id: string;
    metadata: string;
};

type SnapshotRow = {
    entity_id: string;
    entity_type: string;
    attributes: string;
};

function toPatch(row: PatchRow): Patch {
    const meta = JSON.parse(row.metadata) as Record<string, unknown>;
    return {
        patchId: row.patch_id,
        entityId: row.entity_id,
        entityType: row.entity_type,
        attributes: JSON.parse(row.attributes),
        createdAt: row.created_at,
        recordedAt: row.recorded_at,
        parentId: row.parent_id,
        createdBy: String(meta.createdBy ?? ""),
        sessionId: meta.sessionId != null ? String(meta.sessionId) : "",
    };
}

function toEntity(row: SnapshotRow): Entity {
    return {
        entityId: row.entity_id,
        entityType: row.entity_type,
        attributes: JSON.parse(row.attributes),
    };
}

function toMetadata(patch: Patch): string {
    return JSON.stringify({ createdBy: patch.createdBy, sessionId: patch.sessionId });
}

function sanitizeIdentifier(name: string): string {
    if (!/^[a-zA-Z_][a-zA-Z0-9_.]*$/.test(name)) {
        throw new Error(`Invalid attribute name: ${name}`);
    }
    return name;
}

type WhereFragment = { sql: string; params: unknown[] };

function buildWhereClause(clause: PatchesDbQueryWhereClause): WhereFragment {
    switch (clause.type) {
        case "=":
            return { sql: `json_extract(attributes, '$.' || ?) = ?`, params: [clause.attribute, clause.value] };
        case "!=":
            return { sql: `json_extract(attributes, '$.' || ?) != ?`, params: [clause.attribute, clause.value] };
        case "gt":
            return { sql: `json_extract(attributes, '$.' || ?) > ?`, params: [clause.attribute, clause.value] };
        case "gte":
            return { sql: `json_extract(attributes, '$.' || ?) >= ?`, params: [clause.attribute, clause.value] };
        case "lt":
            return { sql: `json_extract(attributes, '$.' || ?) < ?`, params: [clause.attribute, clause.value] };
        case "lte":
            return { sql: `json_extract(attributes, '$.' || ?) <= ?`, params: [clause.attribute, clause.value] };
        case "contains":
            return { sql: `json_extract(attributes, '$.' || ?) LIKE '%' || ? || '%'`, params: [clause.attribute, clause.value] };
        case "in": {
            const placeholders = clause.values.map(() => "?").join(", ");
            return { sql: `json_extract(attributes, '$.' || ?) IN (${placeholders})`, params: [clause.attribute, ...clause.values] };
        }
        case "not_in": {
            const placeholders = clause.values.map(() => "?").join(", ");
            return { sql: `json_extract(attributes, '$.' || ?) NOT IN (${placeholders})`, params: [clause.attribute, ...clause.values] };
        }
        case "exists":
            return { sql: `json_extract(attributes, '$.' || ?) IS NOT NULL`, params: [clause.attribute] };
        case "not_exists":
            return { sql: `json_extract(attributes, '$.' || ?) IS NULL`, params: [clause.attribute] };
        case "and": {
            const parts = clause.clauses.map(buildWhereClause);
            return { sql: `(${parts.map(p => p.sql).join(" AND ")})`, params: parts.flatMap(p => p.params) };
        }
        case "or": {
            const parts = clause.clauses.map(buildWhereClause);
            return { sql: `(${parts.map(p => p.sql).join(" OR ")})`, params: parts.flatMap(p => p.params) };
        }
        case "not": {
            const inner = buildWhereClause(clause.clause);
            return { sql: `NOT (${inner.sql})`, params: inner.params };
        }
    }
}

function buildSnapshotConditions(query: PatchesDbQuery): { conditions: string[]; params: unknown[] } {
    const conditions: string[] = ["entity_type = ?"];
    const params: unknown[] = [query.entityType];

    if (query.entityId != null) {
        if (Array.isArray(query.entityId)) {
            const placeholders = query.entityId.map(() => "?").join(", ");
            conditions.push(`entity_id IN (${placeholders})`);
            params.push(...query.entityId);
        } else {
            conditions.push("entity_id = ?");
            params.push(query.entityId);
        }
    }

    if (query.where) {
        const fragment = buildWhereClause(query.where);
        conditions.push(fragment.sql);
        params.push(...fragment.params);
    }

    return { conditions, params };
}

function buildOrderSQL(query: PatchesDbQuery, defaultOrder: string): string {
    if (query.orderBy && query.orderBy.length > 0) {
        return "ORDER BY " + query.orderBy.map(o => {
            const attr = sanitizeIdentifier(o.attribute);
            const dir = o.direction === "desc" ? "DESC" : "ASC";
            return `json_extract(attributes, '$.${attr}') ${dir}`;
        }).join(", ");
    }
    return defaultOrder;
}

function buildLimitSQL(query: PatchesDbQuery): { sql: string; params: unknown[] } {
    let sql = "";
    const params: unknown[] = [];
    if (query.limit != null) {
        sql += " LIMIT ?";
        params.push(query.limit);
    }
    if (query.offset != null) {
        sql += " OFFSET ?";
        params.push(query.offset);
    }
    return { sql, params };
}

export class PatchDbImplSqlite implements PatchesDb {
    constructor(private sqlClient: SqlClient) {}

    async migrate(): Promise<void> {
        const statements = migrations.split(";").map(s => s.trim()).filter(Boolean);
        for (const stmt of statements) {
            await this.sqlClient.run(stmt);
        }
    }

    private async recomputeSnapshot(tx: SqlClient, entityId: string, entityType: string): Promise<void> {
        const rows = await tx.query<PatchRow>(
            "SELECT * FROM patches WHERE entity_id = ? AND entity_type = ? ORDER BY created_at ASC",
            [entityId, entityType]
        );

        const merged: Record<string, unknown> = {};
        for (const row of rows) {
            const attrs = JSON.parse(row.attributes) as Record<string, unknown>;
            for (const [key, value] of Object.entries(attrs)) {
                if (value === null) {
                    delete merged[key];
                } else {
                    merged[key] = value;
                }
            }
        }

        if (Object.keys(merged).length === 0) {
            await tx.run(
                "DELETE FROM snapshots WHERE entity_id = ? AND entity_type = ?",
                [entityId, entityType]
            );
        } else {
            await tx.run(
                `INSERT INTO snapshots (entity_id, entity_type, attributes) VALUES (?, ?, ?)
                 ON CONFLICT (entity_id, entity_type) DO UPDATE SET attributes = excluded.attributes`,
                [entityId, entityType, JSON.stringify(merged)]
            );
        }
    }

    async write(patches: Patch[]): Promise<void> {
        if (patches.length === 0) return;
        await this.sqlClient.transaction(async (tx) => {
            const touchedEntities = new Set<string>();
            for (const patch of patches) {
                await tx.run(
                    insertPatch,
                    [
                        patch.patchId,
                        patch.entityId,
                        patch.entityType,
                        JSON.stringify(patch.attributes),
                        patch.createdAt,
                        patch.recordedAt,
                        patch.parentId,
                        toMetadata(patch),
                    ]
                );
                touchedEntities.add(`${patch.entityId}\0${patch.entityType}`);
            }

            for (const key of touchedEntities) {
                const [entityId, entityType] = key.split("\0");
                await this.recomputeSnapshot(tx, entityId, entityType);
            }
        });
    }

    async patches(query: PatchesDbQuery): Promise<PatchesDbResult<Patch>> {
        const { conditions: snapConditions, params: snapParams } = buildSnapshotConditions(query);
        const snapWhereSQL = snapConditions.join(" AND ");

        const hasSnapshotFilter = query.where != null;

        let patchConditions: string[];
        let patchParams: unknown[];

        if (hasSnapshotFilter) {
            patchConditions = [`p.entity_id IN (SELECT s.entity_id FROM snapshots s WHERE ${snapWhereSQL})`];
            patchParams = [...snapParams];
            patchConditions.push("p.entity_type = ?");
            patchParams.push(query.entityType);
        } else {
            patchConditions = ["p.entity_type = ?"];
            patchParams = [query.entityType];
            if (query.entityId != null) {
                if (Array.isArray(query.entityId)) {
                    const placeholders = query.entityId.map(() => "?").join(", ");
                    patchConditions.push(`p.entity_id IN (${placeholders})`);
                    patchParams.push(...query.entityId);
                } else {
                    patchConditions.push("p.entity_id = ?");
                    patchParams.push(query.entityId);
                }
            }
        }

        if (query.after) {
            patchConditions.push("p.recorded_at > ?");
            patchParams.push(query.after);
        }

        const patchWhereSQL = patchConditions.join(" AND ");

        const countRows = await this.sqlClient.query<{ cnt: number }>(
            `SELECT COUNT(*) as cnt FROM patches p WHERE ${patchWhereSQL}`,
            patchParams
        );
        const total = countRows[0]?.cnt ?? 0;

        let orderSQL = "ORDER BY p.created_at ASC";
        if (query.orderBy && query.orderBy.length > 0) {
            orderSQL = "ORDER BY " + query.orderBy.map(o => {
                const attr = sanitizeIdentifier(o.attribute);
                const dir = o.direction === "desc" ? "DESC" : "ASC";
                return `json_extract(p.attributes, '$.${attr}') ${dir}`;
            }).join(", ");
        }

        const limit = buildLimitSQL(query);

        const rows = await this.sqlClient.query<PatchRow>(
            `SELECT p.* FROM patches p WHERE ${patchWhereSQL} ${orderSQL}${limit.sql}`,
            [...patchParams, ...limit.params]
        );

        const data = rows.map(toPatch);
        const hasMore = query.limit != null ? (query.offset ?? 0) + data.length < total : false;
        const nextCursor = data.length > 0 ? data[data.length - 1].recordedAt : null;

        return { data, total, hasMore, nextCursor };
    }

    async entities(query: PatchesDbQuery): Promise<PatchesDbResult<Entity>> {
        const { conditions, params } = buildSnapshotConditions(query);
        const whereSQL = conditions.join(" AND ");

        const countRows = await this.sqlClient.query<{ cnt: number }>(
            `SELECT COUNT(*) as cnt FROM snapshots WHERE ${whereSQL}`,
            params
        );
        const total = countRows[0]?.cnt ?? 0;

        const orderSQL = buildOrderSQL(query, "ORDER BY entity_id ASC");
        const limit = buildLimitSQL(query);

        const rows = await this.sqlClient.query<SnapshotRow>(
            `SELECT * FROM snapshots WHERE ${whereSQL} ${orderSQL}${limit.sql}`,
            [...params, ...limit.params]
        );

        const data = rows.map(toEntity);
        const hasMore = query.limit != null ? (query.offset ?? 0) + data.length < total : false;

        return { data, total, hasMore, nextCursor: null };
    }
}
