INSERT INTO
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
