PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  email_normalized TEXT NOT NULL,
  full_name TEXT,
  ai_caption_enabled INTEGER NOT NULL DEFAULT 1 CHECK (ai_caption_enabled IN (0, 1)),
  default_household_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_normalized
ON users(email_normalized);

CREATE TABLE IF NOT EXISTS pilot_allowlist (
  email_normalized TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  added_by_user_id TEXT
);

CREATE TABLE IF NOT EXISTS households (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 60),
  owner_user_id TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_households_owner_active
ON households(owner_user_id, deleted_at);

CREATE TABLE IF NOT EXISTS household_members (
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  joined_at TEXT NOT NULL,
  PRIMARY KEY (household_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_household_members_user
ON household_members(user_id, household_id);

CREATE TABLE IF NOT EXISTS household_invitations (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  email_normalized TEXT NOT NULL,
  invited_by_user_id TEXT NOT NULL REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined', 'revoked', 'expired')),
  expires_at TEXT NOT NULL,
  accepted_by_user_id TEXT REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_invitations_pending_email
ON household_invitations(household_id, email_normalized)
WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_invitations_email_status
ON household_invitations(email_normalized, status, expires_at);

CREATE TABLE IF NOT EXISTS freezers (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 60),
  position INTEGER NOT NULL CHECK (position BETWEEN 1 AND 6),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_freezers_household_position
ON freezers(household_id, position);

CREATE TABLE IF NOT EXISTS drawers (
  id TEXT PRIMARY KEY,
  freezer_id TEXT NOT NULL REFERENCES freezers(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 60),
  position INTEGER NOT NULL CHECK (position BETWEEN 1 AND 8),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_drawers_freezer_position
ON drawers(freezer_id, position);

CREATE TABLE IF NOT EXISTS media (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  r2_key TEXT NOT NULL UNIQUE,
  mime_type TEXT NOT NULL,
  byte_size INTEGER NOT NULL CHECK (byte_size BETWEEN 1 AND 2097152),
  width INTEGER,
  height INTEGER,
  sha256 TEXT NOT NULL,
  created_by_user_id TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_media_household_active
ON media(household_id, deleted_at);

CREATE TABLE IF NOT EXISTS items (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  freezer_id TEXT NOT NULL REFERENCES freezers(id),
  drawer_id TEXT NOT NULL REFERENCES drawers(id),
  caption TEXT NOT NULL CHECK (length(caption) BETWEEN 1 AND 80),
  frozen_on TEXT NOT NULL,
  expires_on TEXT,
  notes TEXT NOT NULL DEFAULT '' CHECK (length(notes) <= 2000),
  image_id TEXT REFERENCES media(id),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_by_user_id TEXT NOT NULL REFERENCES users(id),
  updated_by_user_id TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_items_household_active
ON items(household_id, deleted_at, freezer_id, drawer_id);

CREATE INDEX IF NOT EXISTS idx_items_drawer_active
ON items(drawer_id, deleted_at, frozen_on);

CREATE INDEX IF NOT EXISTS idx_items_household_expiry
ON items(household_id, deleted_at, expires_on);

CREATE TABLE IF NOT EXISTS ai_usage_events (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  household_id TEXT NOT NULL REFERENCES households(id),
  ip_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('started', 'succeeded', 'failed', 'rejected')),
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  estimated_cost_microusd INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ai_usage_user_time
ON ai_usage_events(user_id, created_at);

CREATE INDEX IF NOT EXISTS idx_ai_usage_household_time
ON ai_usage_events(household_id, created_at);

CREATE INDEX IF NOT EXISTS idx_ai_usage_ip_time
ON ai_usage_events(ip_hash, created_at);

CREATE TABLE IF NOT EXISTS sheet_outbox (
  item_id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL,
  item_version INTEGER NOT NULL,
  payload_json TEXT NOT NULL,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT NOT NULL,
  last_error_code TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  synced_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_sheet_outbox_due
ON sheet_outbox(synced_at, next_attempt_at, updated_at);

CREATE TABLE IF NOT EXISTS sheet_row_map (
  item_id TEXT PRIMARY KEY,
  row_number INTEGER NOT NULL CHECK (row_number >= 2),
  mirrored_version INTEGER NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sheet_sync_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  schema_version INTEGER NOT NULL DEFAULT 2,
  last_attempt_at TEXT,
  last_success_at TEXT,
  last_reconcile_at TEXT,
  last_error_code TEXT,
  updated_at TEXT NOT NULL
);

INSERT OR IGNORE INTO sheet_sync_state (id, schema_version, updated_at)
VALUES (1, 2, CURRENT_TIMESTAMP);

PRAGMA optimize;
