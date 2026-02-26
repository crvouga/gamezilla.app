CREATE TABLE IF NOT EXISTS patches (
    patch_id TEXT PRIMARY KEY,
    op TEXT CHECK (op IN ('add', 'retract')) NOT NULL,
    entity_id TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    attributes TEXT NOT NULL DEFAULT('{}'),
    created_at TEXT NOT NULL,
    recorded_at TEXT DEFAULT(datetime('now')) NOT NULL,
    parent_id TEXT REFERENCES patches (patch_id),
    metadata TEXT NOT NULL DEFAULT '{}',
    CONSTRAINT unique_entity_patch UNIQUE (entity_id, op, created_at)
);

CREATE INDEX IF NOT EXISTS idx_patches_entity_type_recorded_at ON patches (entity_type, recorded_at);

CREATE INDEX IF NOT EXISTS idx_patches_entity_id ON patches (entity_id);