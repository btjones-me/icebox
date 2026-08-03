PRAGMA defer_foreign_keys = ON;
--> statement-breakpoint

CREATE TABLE media_5mb (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  r2_key TEXT NOT NULL UNIQUE,
  mime_type TEXT NOT NULL,
  byte_size INTEGER NOT NULL CHECK (byte_size BETWEEN 1 AND 5242880),
  width INTEGER,
  height INTEGER,
  sha256 TEXT NOT NULL,
  created_by_user_id TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  deleted_at TEXT
);
--> statement-breakpoint

INSERT INTO media_5mb
  (id, household_id, r2_key, mime_type, byte_size, width, height, sha256, created_by_user_id, created_at, deleted_at)
SELECT id, household_id, r2_key, mime_type, byte_size, width, height, sha256, created_by_user_id, created_at, deleted_at
FROM media;
--> statement-breakpoint

DROP TABLE media;
--> statement-breakpoint
ALTER TABLE media_5mb RENAME TO media;
--> statement-breakpoint

CREATE INDEX idx_media_household_active
ON media(household_id, deleted_at);
--> statement-breakpoint

PRAGMA defer_foreign_keys = OFF;
--> statement-breakpoint
PRAGMA foreign_key_check;
--> statement-breakpoint
PRAGMA optimize;
--> statement-breakpoint
