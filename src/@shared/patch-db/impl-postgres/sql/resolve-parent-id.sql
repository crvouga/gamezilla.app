SELECT patch_id FROM patches
WHERE entity_id = ? AND entity_type = ?
ORDER BY created_at DESC
LIMIT 1
