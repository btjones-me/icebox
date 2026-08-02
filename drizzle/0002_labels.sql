PRAGMA foreign_keys = OFF;

ALTER TABLE users RENAME COLUMN ai_caption_enabled TO ai_label_enabled;
ALTER TABLE items RENAME COLUMN caption TO label;

UPDATE sheet_sync_state
SET schema_version = 3, updated_at = CURRENT_TIMESTAMP
WHERE id = 1;

PRAGMA foreign_keys = ON;
PRAGMA optimize;
