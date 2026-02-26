import { SqlClient } from "../../sql-client/interface";
import { Entity, Patch, PatchesDb, PatchesDbQuery, PatchesDbResult, PatchesDbSubscription } from "../interface";
import insertPatch from "./insert-patch.sql" with { type: "text" };
import migrations from "./migrations.sql" with { type: "text" };

type PatchRow = {
    patch_id: string;
    op: string;
    entity_id: string;
    entity_type: string;
    attributes: string;
    created_at: string;
    recorded_at: string;
    parent_id: string;
    metadata: string;
};

const PATCH_ROW_KEYS: (keyof PatchRow)[] = [
    "patch_id", "op", "entity_id", "entity_type", "attributes",
    "created_at", "recorded_at", "parent_id", "metadata",
];

function isPatchRow(row: unknown): row is PatchRow {
    if (typeof row !== "object" || row === null) return false;
    const r = row as Record<string, unknown>;
    return PATCH_ROW_KEYS.every((k) => typeof r[k] === "string");
}

function toPatch(row: unknown): Patch {
    if (!isPatchRow(row)) throw new Error("Invalid patch row");
    const meta = JSON.parse(row.metadata) as Record<string, unknown>;
    return {
        patchId: row.patch_id,
        op: row.op === "add" ? "add" : "retract",
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
                insertPatch,
                [
                    patch.patchId,
                    patch.op,
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
