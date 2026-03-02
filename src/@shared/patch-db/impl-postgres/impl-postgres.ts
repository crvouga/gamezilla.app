import { SqlClient } from "../../sql-client/interface";
import { Entity, Patch, PatchInput, PatchesDb, PatchesDbQuery, PatchesDbResult } from "../interface";
import { parseJson, toEntity, toMetadata, toPatch } from "./mappers";
import {
    buildLimitSQL,
    buildOrderSQL,
    buildSnapshotConditions,
} from "./query-builder";
import deleteSnapshot from "./sql/delete-snapshot.sql" with { type: "text" };
import insertPatch from "./sql/insert-patch.sql" with { type: "text" };
import migrations from "./sql/migrations.sql" with { type: "text" };
import resolveParentIdSql from "./sql/resolve-parent-id.sql" with { type: "text" };
import selectPatchesForSnapshot from "./sql/select-patches-for-snapshot.sql" with { type: "text" };
import upsertSnapshot from "./sql/upsert-snapshot.sql" with { type: "text" };
import type { PatchRow, SnapshotRow } from "./types";

export class PatchDbImplPostgres implements PatchesDb {
    constructor(private sqlClient: SqlClient) {}

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
        if (typeof process !== "undefined" && process.env.DEBUG_PATCH_DB === "1") {
            // eslint-disable-next-line no-console
            console.log("[PatchDb] entities", { whereSQL, params });
        }

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
}
