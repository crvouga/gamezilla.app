import { SqlClient } from "../sql-client/interface";
import { Entity, Patch, PatchesDb, PatchesDbQuery, PatchesDbResult, PatchesDbSubscription } from "./interface";

type PatchRow = {
    patch_id: string;
    op: string;
    entity_id: string;
    entity_type: string;
    attributes: string;
    created_at: string;
    recorded_at: string;
    parent_id: string;
    created_by: string;
    session_id: string;
};

const PATCH_ROW_KEYS: (keyof PatchRow)[] = [
    "patch_id", "op", "entity_id", "entity_type", "attributes",
    "created_at", "recorded_at", "parent_id", "created_by", "session_id",
];

function isPatchRow(row: unknown): row is PatchRow {
    if (typeof row !== "object" || row === null) return false;
    const r = row as Record<string, unknown>;
    return PATCH_ROW_KEYS.every((k) => typeof r[k] === "string");
}

function toPatch(row: unknown): Patch {
    if (!isPatchRow(row)) throw new Error("Invalid patch row");
    return {
        patchId: row.patch_id,
        op: row.op === "add" ? "add" : "retract",
        entityId: row.entity_id,
        entityType: row.entity_type,
        attributes: JSON.parse(row.attributes),
        createdAt: row.created_at,
        recordedAt: row.recorded_at,
        parentId: row.parent_id,
        createdBy: row.created_by,
        sessionId: row.session_id,
    };
}

export const migrations = `
  CREATE TABLE IF NOT EXISTS patches (
    patch_id TEXT PRIMARY KEY,
    op TEXT CHECK (op IN ('add', 'retract')) NOT NULL,
    entity_id TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    attributes TEXT NOT NULL,
    created_at TEXT NOT NULL,
    recorded_at TEXT DEFAULT (datetime('now')) NOT NULL,
    parent_id TEXT REFERENCES patches(patch_id),
    created_by TEXT NOT NULL,
    session_id TEXT,
    CONSTRAINT unique_entity_patch UNIQUE(entity_id, op, created_at)
  );

  CREATE INDEX IF NOT EXISTS idx_patches_entity_type_recorded_at ON patches(entity_type, recorded_at);
  CREATE INDEX IF NOT EXISTS idx_patches_entity_id ON patches(entity_id);
  CREATE INDEX IF NOT EXISTS idx_patches_created_by ON patches(created_by);
`;

const INSERT_PATCH_SQL = `INSERT INTO patches (patch_id, op, entity_id, entity_type, attributes, created_at, recorded_at, parent_id, created_by, session_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

export class PatchDbImplSqlite implements PatchesDb {
    constructor(private sqlClient: SqlClient) { }
    async entities(query: PatchesDbQuery): Promise<PatchesDbResult<Entity>> {
        throw new Error("Method not implemented.");
    }

    async migrate(): Promise<void> {
        await this.sqlClient.run(migrations);
    }

    async write(patches: Patch[]): Promise<void> {
        for (const patch of patches) {
            await this.sqlClient.run(
                INSERT_PATCH_SQL,
                [
                    patch.patchId,
                    patch.op,
                    patch.entityId,
                    patch.entityType,
                    JSON.stringify(patch.attributes),
                    patch.createdAt,
                    patch.recordedAt,
                    patch.parentId,
                    patch.createdBy,
                    patch.sessionId,
                ]
            );
        }
    }

    async patches(_query: PatchesDbQuery): Promise<PatchesDbResult<Patch>> {
        throw new Error("Not implemented");
    }

    async listByEntityId(entityId: string): Promise<Patch[]> {
        const rows = await this.sqlClient.query("SELECT * FROM patches WHERE entity_id = ?", [entityId]);
        return rows.map(toPatch);
    }
    subscribePatches(query: PatchesDbQuery, callback: (patches: Patch[]) => void): PatchesDbSubscription {
        throw new Error("Method not implemented.");
    }
    subscribeEntities(query: PatchesDbQuery, callback: (entities: Entity[]) => void): PatchesDbSubscription {
        throw new Error("Method not implemented.");
    }
    snapshot(entityId: string, entityType: string): Promise<void> {
        throw new Error("Method not implemented.");
    }
    count(query: PatchesDbQuery): Promise<number> {
        throw new Error("Method not implemented.");
    }
}
