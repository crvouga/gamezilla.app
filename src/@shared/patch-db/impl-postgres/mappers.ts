import type { Entity, Patch, PatchInput } from "../interface";
import type { PatchRow, SnapshotRow } from "./types";

export function parseJson(val: unknown): Record<string, unknown> {
    if (typeof val === "string") return JSON.parse(val) as Record<string, unknown>;
    if (val != null && typeof val === "object") return val as Record<string, unknown>;
    return {};
}

function toRecordedAt(val: unknown): string {
    if (typeof val === "string") return val;
    if (val instanceof Date) return val.toISOString();
    return String(val ?? "");
}

export function toPatch(row: PatchRow): Patch {
    const meta = parseJson(row.metadata);
    return {
        patchId: row.patch_id,
        entityId: row.entity_id,
        entityType: row.entity_type,
        attributes: parseJson(row.attributes),
        createdAt: row.created_at,
        recordedAt: toRecordedAt(row.recorded_at),
        parentId: row.parent_id ?? null,
        createdBy: String(meta.createdBy ?? ""),
        sessionId: meta.sessionId != null ? String(meta.sessionId) : "",
    };
}

export function toEntity(row: SnapshotRow): Entity {
    return {
        entityId: row.entity_id,
        entityType: row.entity_type,
        attributes: parseJson(row.attributes),
    };
}

export function toMetadata(patch: PatchInput): string {
    return JSON.stringify({ createdBy: patch.createdBy, sessionId: patch.sessionId });
}
