PRAGMA foreign_keys = OFF;
--> statement-breakpoint

ALTER TABLE users RENAME COLUMN ai_caption_enabled TO ai_label_enabled;
--> statement-breakpoint
ALTER TABLE items RENAME COLUMN caption TO label;
--> statement-breakpoint

UPDATE sheet_sync_state
SET schema_version = 3, updated_at = CURRENT_TIMESTAMP
WHERE id = 1;
--> statement-breakpoint

PRAGMA foreign_keys = ON;
--> statement-breakpoint
PRAGMA optimize;
--> statement-breakpoint
