INSERT INTO snapshots (entity_id, entity_type, attributes)
VALUES (?, ?, ?)
ON CONFLICT (entity_id, entity_type) DO UPDATE SET attributes = excluded.attributes
