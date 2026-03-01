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

function toMetadata(patch: Patch): string {
    return JSON.stringify({ createdBy: patch.createdBy, sessionId: patch.sessionId });
}

function mergePatches(patches: Patch[]): Record<string, unknown> {
    const merged: Record<string, unknown> = {};
    for (const patch of patches) {
        for (const [key, value] of Object.entries(patch.attributes)) {
            if (value === null) {
                delete merged[key];
            } else {
                merged[key] = value;
            }
        }
    }
    return merged;
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

export class PatchDbImplSqlite implements PatchesDb {
    constructor(private sqlClient: SqlClient) {}

    async migrate(): Promise<void> {
        const statements = migrations.split(";").map(s => s.trim()).filter(Boolean);
        for (const stmt of statements) {
            await this.sqlClient.run(stmt);
        }
    }

    async write(patches: Patch[]): Promise<void> {
        if (patches.length === 0) return;
        await this.sqlClient.transaction(async (tx) => {
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
            }
        });
    }

    async patches(query: PatchesDbQuery): Promise<PatchesDbResult<Patch>> {
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

        if (query.after) {
            conditions.push("recorded_at > ?");
            params.push(query.after);
        }

        const whereSQL = conditions.join(" AND ");

        const countRows = await this.sqlClient.query<{ cnt: number }>(
            `SELECT COUNT(*) as cnt FROM patches WHERE ${whereSQL}`,
            params
        );
        const total = countRows[0]?.cnt ?? 0;

        let orderSQL = "ORDER BY created_at ASC";
        if (query.orderBy && query.orderBy.length > 0) {
            orderSQL = "ORDER BY " + query.orderBy.map(o => {
                const attr = sanitizeIdentifier(o.attribute);
                const dir = o.direction === "desc" ? "DESC" : "ASC";
                return `json_extract(attributes, '$.${attr}') ${dir}`;
            }).join(", ");
        }

        let limitSQL = "";
        const limitParams: unknown[] = [];
        if (query.limit != null) {
            limitSQL = " LIMIT ?";
            limitParams.push(query.limit);
        }
        if (query.offset != null) {
            limitSQL += " OFFSET ?";
            limitParams.push(query.offset);
        }

        const rows = await this.sqlClient.query<PatchRow>(
            `SELECT * FROM patches WHERE ${whereSQL} ${orderSQL}${limitSQL}`,
            [...params, ...limitParams]
        );

        const data = rows.map(toPatch);
        const hasMore = query.limit != null ? (query.offset ?? 0) + data.length < total : false;
        const nextCursor = data.length > 0 ? data[data.length - 1].recordedAt : null;

        return { data, total, hasMore, nextCursor };
    }

    async entities(query: PatchesDbQuery): Promise<PatchesDbResult<Entity>> {
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

        const whereSQL = conditions.join(" AND ");

        const entityIdRows = await this.sqlClient.query<{ entity_id: string }>(
            `SELECT DISTINCT entity_id FROM patches WHERE ${whereSQL} ORDER BY entity_id`,
            params
        );

        const allEntities: Entity[] = [];

        for (const { entity_id } of entityIdRows) {
            const patchRows = await this.sqlClient.query<PatchRow>(
                `SELECT * FROM patches WHERE entity_id = ? AND entity_type = ? ORDER BY created_at ASC`,
                [entity_id, query.entityType]
            );
            const patches = patchRows.map(toPatch);
            const attributes = mergePatches(patches);

            if (Object.keys(attributes).length > 0) {
                allEntities.push({
                    entityId: entity_id,
                    entityType: query.entityType,
                    attributes,
                });
            }
        }

        let filtered = allEntities;
        if (query.where) {
            filtered = allEntities.filter(entity => matchesWhere(entity.attributes, query.where!));
        }

        if (query.orderBy && query.orderBy.length > 0) {
            filtered.sort((a, b) => {
                for (const o of query.orderBy!) {
                    const aVal = a.attributes[o.attribute];
                    const bVal = b.attributes[o.attribute];
                    if (aVal === bVal) continue;
                    if (aVal == null) return o.direction === "asc" ? 1 : -1;
                    if (bVal == null) return o.direction === "asc" ? -1 : 1;
                    const cmp = aVal < bVal ? -1 : 1;
                    return o.direction === "asc" ? cmp : -cmp;
                }
                return 0;
            });
        }

        const total = filtered.length;
        const offset = query.offset ?? 0;
        const sliced = query.limit != null
            ? filtered.slice(offset, offset + query.limit)
            : filtered.slice(offset);
        const hasMore = query.limit != null ? offset + sliced.length < total : false;

        return { data: sliced, total, hasMore, nextCursor: null };
    }
}

function matchesWhere(attrs: Record<string, unknown>, clause: PatchesDbQueryWhereClause): boolean {
    switch (clause.type) {
        case "=": return attrs[clause.attribute] === clause.value;
        case "!=": return attrs[clause.attribute] !== clause.value;
        case "gt": return (attrs[clause.attribute] as number) > (clause.value as number);
        case "gte": return (attrs[clause.attribute] as number) >= (clause.value as number);
        case "lt": return (attrs[clause.attribute] as number) < (clause.value as number);
        case "lte": return (attrs[clause.attribute] as number) <= (clause.value as number);
        case "contains": return String(attrs[clause.attribute] ?? "").includes(clause.value);
        case "in": return clause.values.includes(attrs[clause.attribute]);
        case "not_in": return !clause.values.includes(attrs[clause.attribute]);
        case "exists": return clause.attribute in attrs && attrs[clause.attribute] != null;
        case "not_exists": return !(clause.attribute in attrs) || attrs[clause.attribute] == null;
        case "and": return clause.clauses.every(c => matchesWhere(attrs, c));
        case "or": return clause.clauses.some(c => matchesWhere(attrs, c));
        case "not": return !matchesWhere(attrs, clause.clause);
    }
}
