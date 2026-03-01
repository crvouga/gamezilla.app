CREATE TABLE IF NOT EXISTS patches (
    patch_id TEXT PRIMARY KEY,
    entity_id TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    attributes TEXT NOT NULL DEFAULT('{}'),
    created_at TEXT NOT NULL,
    recorded_at TEXT DEFAULT(datetime('now')) NOT NULL,
    parent_id TEXT REFERENCES patches (patch_id),
    metadata TEXT NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_patches_entity_type_recorded_at ON patches (entity_type, recorded_at);

CREATE INDEX IF NOT EXISTS idx_patches_entity_id ON patches (entity_id);

CREATE INDEX IF NOT EXISTS idx_patches_parent_id ON patches (parent_id);
