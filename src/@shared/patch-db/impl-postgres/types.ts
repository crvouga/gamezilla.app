export type PatchRow = {
    patch_id: string;
    entity_id: string;
    entity_type: string;
    attributes: string | Record<string, unknown>;
    created_at: string;
    recorded_at: string | Date;
    parent_id: string | null;
    metadata: string | Record<string, unknown>;
};

export type SnapshotRow = {
    entity_id: string;
    entity_type: string;
    attributes: string | Record<string, unknown>;
};
