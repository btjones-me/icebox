CREATE TABLE IF NOT EXISTS sheet_mirror_lock (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  lease_id TEXT,
  lease_expires_at TEXT,
  updated_at TEXT NOT NULL
);
INSERT OR IGNORE INTO sheet_mirror_lock (id, updated_at) VALUES (1, CURRENT_TIMESTAMP);
PRAGMA optimize;
