import { SqlClient } from "../../sql-client/interface";
import { Entity, Patch, PatchInput, PatchesDbQuery, PatchesDbResult, SyncStatePatchesDb } from "../interface";
import { parseJson, toEntity, toMetadata, toPatch } from "./mappers";
import {
    buildLimitSQL,
    buildOrderSQL,
    buildSnapshotConditions,
} from "./query-builder";
import type { PatchRow, SnapshotRow } from "./types";

const deleteSnapshot = `DELETE FROM snapshots
WHERE entity_id = ? AND entity_type = ?`;

const insertPatch = `INSERT INTO
    patches (
        patch_id,
        entity_id,
        entity_type,
        attributes,
        created_at,
        recorded_at,
        parent_id,
        metadata
    )
VALUES (?, ?, ?, ?::jsonb, ?, ?::timestamptz, ?, ?::jsonb)
ON CONFLICT (patch_id) DO NOTHING`;

const migrations = `CREATE TABLE IF NOT EXISTS patches (
    patch_id TEXT PRIMARY KEY,
    entity_id TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    attributes JSONB NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    recorded_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,
    parent_id TEXT REFERENCES patches (patch_id),
    metadata JSONB NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_patches_entity_type_recorded_at ON patches (entity_type, recorded_at);

CREATE INDEX IF NOT EXISTS idx_patches_entity_id ON patches (entity_id);

CREATE INDEX IF NOT EXISTS idx_patches_parent_id ON patches (parent_id);

CREATE TABLE IF NOT EXISTS snapshots (
    entity_id TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    attributes JSONB NOT NULL DEFAULT '{}',
    PRIMARY KEY (entity_id, entity_type)
);

CREATE INDEX IF NOT EXISTS idx_snapshots_entity_type ON snapshots (entity_type);`;

const resolveParentIdSql = `SELECT patch_id FROM patches
WHERE entity_id = ? AND entity_type = ?
ORDER BY created_at DESC
LIMIT 1`;

const selectPatchesForSnapshot = `SELECT * FROM patches
WHERE entity_id = ? AND entity_type = ?
ORDER BY created_at ASC`;

const upsertSnapshot = `INSERT INTO snapshots (entity_id, entity_type, attributes)
VALUES (?, ?, ?::jsonb)
ON CONFLICT (entity_id, entity_type) DO UPDATE SET attributes = excluded.attributes`;

const selectUnsyncedPatches = `SELECT * FROM patches
WHERE metadata->'syncedAt' IS NULL
ORDER BY recorded_at ASC`;

export class PatchDbImplPostgres implements SyncStatePatchesDb {
    constructor(private sqlClient: SqlClient) { }

    async migrate(): Promise<void> {
        const statements = migrations.split(";").map(s => s.trim()).filter(Boolean);
        for (const stmt of statements) {
            await this.sqlClient.run(stmt);
        }
    }

    private async recomputeSnapshot(tx: SqlClient, entityId: string, entityType: string): Promise<void> {
        const rows = await tx.query<PatchRow>(selectPatchesForSnapshot, [entityId, entityType]);

        const merged: Record<string, unknown> = {};
        for (const row of rows) {
            const attrs = parseJson(row.attributes);
            for (const [key, value] of Object.entries(attrs)) {
                if (value === null) {
                    delete merged[key];
                } else {
                    merged[key] = value;
                }
            }
        }

        if (Object.keys(merged).length === 0) {
            await tx.run(deleteSnapshot, [entityId, entityType]);
        } else {
            await tx.run(upsertSnapshot, [entityId, entityType, JSON.stringify(merged)]);
        }
    }

    private async resolveParentId(tx: SqlClient, entityId: string, entityType: string): Promise<string | null> {
        const rows = await tx.query<{ patch_id: string }>(resolveParentIdSql, [entityId, entityType]);
        return rows.length > 0 ? rows[0].patch_id : null;
    }

    async write(patches: PatchInput[]): Promise<void> {
        if (patches.length === 0) return;
        await this.sqlClient.transaction(async (tx) => {
            const touchedEntities = new Set<string>();
            for (const patch of patches) {
                const parentId = await this.resolveParentId(tx, patch.entityId, patch.entityType);
                await tx.run(
                    insertPatch,
                    [
                        patch.patchId,
                        patch.entityId,
                        patch.entityType,
                        JSON.stringify(patch.attributes),
                        patch.createdAt,
                        patch.recordedAt,
                        parentId,
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

    async read(query: PatchesDbQuery): Promise<PatchesDbResult<Patch>> {
        const hasSnapshotFilter = query.where != null;
        const { conditions: snapConditions, params: snapParams } = hasSnapshotFilter
            ? buildSnapshotConditions(query, "s.")
            : { conditions: [] as string[], params: [] as unknown[] };
        const snapWhereSQL = snapConditions.join(" AND ");

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
        const total = Number(countRows[0]?.cnt ?? 0);

        const orderSQL = buildOrderSQL(query, "ORDER BY p.created_at ASC", "p.");
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
        const total = Number(countRows[0]?.cnt ?? 0);

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

    async getUnsyncedPatches(): Promise<Patch[]> {
        const rows = await this.sqlClient.query<PatchRow>(selectUnsyncedPatches, []);
        return rows.map(toPatch);
    }

    async markPatchesSynced(patchIds: string[]): Promise<void> {
        if (patchIds.length === 0) return;
        const now = new Date().toISOString();
        const placeholders = patchIds.map(() => "?").join(", ");
        await this.sqlClient.run(
            `UPDATE patches SET metadata = jsonb_set(metadata, '{syncedAt}', to_jsonb(?::text)) WHERE patch_id IN (${placeholders})`,
            [now, ...patchIds]
        );
    }
}
