import { SqlClient } from "../../sql-client/interface";
import { Entity, Patch, PatchInput, PatchesDbQuery, PatchesDbResult, SyncStatePatchesDb } from "../interface";
import { toEntity, toMetadata, toPatch } from "./mappers";
import {
    buildLimitSQL,
    buildOrderSQL,
    buildSnapshotConditions,
} from "./query-builder";
import type { PatchRow, SnapshotRow } from "./types";

const deleteSnapshot = `DELETE FROM snapshots
WHERE entity_id = ? AND entity_type = ?`;

const insertPatch = `INSERT OR IGNORE INTO
    patches (
        patch_id,
        entity_id,
        entity_type,
        attributes,
        created_at,
        recorded_at,
        parent_id,
        lineage_depth,
        metadata
    )
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;

const migrations = `CREATE TABLE IF NOT EXISTS patches (
    patch_id TEXT PRIMARY KEY,
    entity_id TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    attributes TEXT NOT NULL DEFAULT('{}'),
    created_at TEXT NOT NULL,
    recorded_at TEXT DEFAULT(datetime('now')) NOT NULL,
    parent_id TEXT REFERENCES patches (patch_id),
    metadata TEXT NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_patches_entity_id ON patches (entity_id);

CREATE INDEX IF NOT EXISTS idx_patches_parent_id ON patches (parent_id);

CREATE TABLE IF NOT EXISTS snapshots (
    entity_id TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    attributes TEXT NOT NULL DEFAULT '{}',
    PRIMARY KEY (entity_id, entity_type)
);

CREATE INDEX IF NOT EXISTS idx_snapshots_entity_type ON snapshots (entity_type);`;

const migrationAddLineageDepth = `ALTER TABLE patches ADD COLUMN lineage_depth INTEGER NOT NULL DEFAULT 0`;

const migrationBackfillLineageDepth = `WITH RECURSIVE depth AS (
    SELECT patch_id, 0 AS d FROM patches WHERE parent_id IS NULL
    UNION ALL
    SELECT p.patch_id, d.d + 1 FROM patches p JOIN depth d ON p.parent_id = d.patch_id
)
UPDATE patches SET lineage_depth = COALESCE((SELECT d FROM depth WHERE depth.patch_id = patches.patch_id), 0)`;

const resolveParentIdSql = `SELECT p.patch_id FROM patches p
WHERE p.entity_id = ? AND p.entity_type = ?
  AND NOT EXISTS (
    SELECT 1 FROM patches c
    WHERE c.parent_id = p.patch_id
      AND c.entity_id = p.entity_id AND c.entity_type = p.entity_type
  )
ORDER BY p.lineage_depth DESC, p.patch_id DESC
LIMIT 1`;

const selectPatchesForSnapshot = `SELECT * FROM patches
WHERE entity_id = ? AND entity_type = ?
ORDER BY lineage_depth ASC, patch_id ASC`;

const upsertSnapshot = `INSERT INTO snapshots (entity_id, entity_type, attributes)
VALUES (?, ?, ?)
ON CONFLICT (entity_id, entity_type) DO UPDATE SET attributes = excluded.attributes`;

const selectUnsyncedPatches = `SELECT * FROM patches
WHERE json_extract(metadata, '$.syncedAt') IS NULL
ORDER BY lineage_depth ASC, patch_id ASC`;

export class PatchDbImplSqlite implements SyncStatePatchesDb {
    constructor(private sqlClient: SqlClient) { }

    async migrate(): Promise<void> {
        const statements = migrations.split(";").map(s => s.trim()).filter(Boolean);
        for (const stmt of statements) {
            await this.sqlClient.run(stmt);
        }
        try {
            await this.sqlClient.run(migrationAddLineageDepth);
        } catch {
            // Column may already exist
        }
        try {
            await this.sqlClient.run(migrationBackfillLineageDepth);
        } catch {
            // Backfill may fail if no patches or schema mismatch
        }
        await this.sqlClient.run("CREATE INDEX IF NOT EXISTS idx_patches_entity_type_lineage ON patches (entity_type, lineage_depth, patch_id)");
    }

    private async recomputeSnapshot(tx: SqlClient, entityId: string, entityType: string): Promise<void> {
        const rows = await tx.query<PatchRow>(selectPatchesForSnapshot, [entityId, entityType]);

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
            await tx.run(deleteSnapshot, [entityId, entityType]);
        } else {
            await tx.run(upsertSnapshot, [entityId, entityType, JSON.stringify(merged)]);
        }
    }

    private async resolveParentId(tx: SqlClient, entityId: string, entityType: string): Promise<string | null> {
        const rows = await tx.query<{ patch_id: string }>(resolveParentIdSql, [entityId, entityType]);
        return rows.length > 0 ? rows[0].patch_id : null;
    }

    async write(patches: PatchInput[]): Promise<Patch[]> {
        if (patches.length === 0) return [];
        const result: Patch[] = [];
        await this.sqlClient.transaction(async (tx) => {
            const touchedEntities = new Set<string>();
            let lastTimestamp = Date.now() - 1;
            for (const patch of patches) {
                const patchId = ("patchId" in patch && typeof patch.patchId === "string")
                    ? patch.patchId
                    : crypto.randomUUID();
                const isSyncedPatch = "patchId" in patch && "parentId" in patch && typeof patch.patchId === "string";
                const parentId: string | null = isSyncedPatch
                    ? (typeof patch.parentId === "string" ? patch.parentId : null)
                    : await this.resolveParentId(tx, patch.entityId, patch.entityType);
                const lineageDepth = parentId == null
                    ? 0
                    : ((await tx.query<{ lineage_depth: number }>(
                        "SELECT lineage_depth FROM patches WHERE patch_id = ?",
                        [parentId]
                    ))[0]?.lineage_depth ?? 0) + 1;
                lastTimestamp += 1;
                const now = ("createdAt" in patch && typeof patch.createdAt === "string")
                    ? patch.createdAt
                    : new Date(lastTimestamp).toISOString();
                const recordedAt = ("recordedAt" in patch && typeof patch.recordedAt === "string")
                    ? patch.recordedAt
                    : now;
                await tx.run(
                    insertPatch,
                    [
                        patchId,
                        patch.entityId,
                        patch.entityType,
                        JSON.stringify(patch.attributes),
                        now,
                        recordedAt,
                        parentId,
                        lineageDepth,
                        toMetadata(patch),
                    ]
                );
                const meta = patch.meta ?? {};
                result.push({
                    ...patch,
                    patchId,
                    parentId,
                    createdAt: now,
                    recordedAt,
                    createdBy: String(meta.createdBy ?? ""),
                    sessionId: meta.sessionId != null ? String(meta.sessionId) : "",
                });
                touchedEntities.add(`${patch.entityId}\0${patch.entityType}`);
            }

            for (const key of touchedEntities) {
                const [entityId, entityType] = key.split("\0");
                await this.recomputeSnapshot(tx, entityId, entityType);
            }
        });
        return result;
    }

    async readPatches(queries: PatchesDbQuery[], _knownPatches?: Patch[][]): Promise<PatchesDbResult<Patch>[]> {
        if (queries.length === 0) return [];
        return Promise.all(queries.map((q) => this.patchesOne(q)));
    }

    private async patchesOne(query: PatchesDbQuery): Promise<PatchesDbResult<Patch>> {
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
            const cursorRows = await this.sqlClient.query<{ entity_id: string; entity_type: string; lineage_depth: number; patch_id: string }>(
                "SELECT entity_id, entity_type, lineage_depth, patch_id FROM patches WHERE patch_id = ?",
                [query.after]
            );
            if (cursorRows.length > 0) {
                const c = cursorRows[0];
                patchConditions.push("(p.entity_id, p.entity_type, p.lineage_depth, p.patch_id) > (?, ?, ?, ?)");
                patchParams.push(c.entity_id, c.entity_type, c.lineage_depth, c.patch_id);
            }
        }

        const patchWhereSQL = patchConditions.join(" AND ");

        const countRows = await this.sqlClient.query<{ cnt: number }>(
            `SELECT COUNT(*) as cnt FROM patches p WHERE ${patchWhereSQL}`,
            patchParams
        );
        const total = countRows[0]?.cnt ?? 0;

        const defaultOrder = "ORDER BY p.entity_id ASC, p.entity_type ASC, p.lineage_depth ASC, p.patch_id ASC";
        const orderSQL = buildOrderSQL(query, defaultOrder, "p.");
        const limit = buildLimitSQL(query);

        const rows = await this.sqlClient.query<PatchRow>(
            `SELECT p.* FROM patches p WHERE ${patchWhereSQL} ${orderSQL}${limit.sql}`,
            [...patchParams, ...limit.params]
        );

        const data = rows.map(toPatch);
        const hasMore = query.limit != null ? (query.offset ?? 0) + data.length < total : false;
        const nextCursor = data.length > 0 ? data[data.length - 1].patchId : null;

        return { data, total, hasMore, nextCursor };
    }

    async readEntities(query: PatchesDbQuery): Promise<PatchesDbResult<Entity>> {
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

    async getUnsyncedPatches(): Promise<Patch[]> {
        const rows = await this.sqlClient.query<PatchRow>(selectUnsyncedPatches, []);
        return rows.map(toPatch);
    }

    async markPatchesSynced(patchIds: string[]): Promise<void> {
        if (patchIds.length === 0) return;
        const now = new Date().toISOString();
        const placeholders = patchIds.map(() => "?").join(", ");
        await this.sqlClient.run(
            `UPDATE patches SET metadata = json_set(metadata, '$.syncedAt', ?) WHERE patch_id IN (${placeholders})`,
            [now, ...patchIds]
        );
    }
}
