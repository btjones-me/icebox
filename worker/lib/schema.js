const SCHEMA_STATEMENTS = [
  "CREATE TABLE IF NOT EXISTS users (\n  id TEXT PRIMARY KEY,\n  email TEXT NOT NULL,\n  email_normalized TEXT NOT NULL,\n  full_name TEXT,\n  ai_label_enabled INTEGER NOT NULL DEFAULT 1 CHECK (ai_label_enabled IN (0, 1)),\n  default_household_id TEXT,\n  created_at TEXT NOT NULL,\n  updated_at TEXT NOT NULL,\n  last_seen_at TEXT NOT NULL,\n  deleted_at TEXT\n)",
  "CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_normalized\nON users(email_normalized)",
  "CREATE TABLE IF NOT EXISTS pilot_allowlist (\n  email_normalized TEXT PRIMARY KEY,\n  created_at TEXT NOT NULL,\n  added_by_user_id TEXT\n)",
  "CREATE TABLE IF NOT EXISTS households (\n  id TEXT PRIMARY KEY,\n  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 60),\n  owner_user_id TEXT NOT NULL REFERENCES users(id),\n  created_at TEXT NOT NULL,\n  updated_at TEXT NOT NULL,\n  deleted_at TEXT\n)",
  "CREATE INDEX IF NOT EXISTS idx_households_owner_active\nON households(owner_user_id, deleted_at)",
  "CREATE TABLE IF NOT EXISTS household_members (\n  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,\n  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,\n  joined_at TEXT NOT NULL,\n  PRIMARY KEY (household_id, user_id)\n)",
  "CREATE INDEX IF NOT EXISTS idx_household_members_user\nON household_members(user_id, household_id)",
  "CREATE TABLE IF NOT EXISTS household_invitations (\n  id TEXT PRIMARY KEY,\n  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,\n  email_normalized TEXT NOT NULL,\n  invited_by_user_id TEXT NOT NULL REFERENCES users(id),\n  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined', 'revoked', 'expired')),\n  expires_at TEXT NOT NULL,\n  accepted_by_user_id TEXT REFERENCES users(id),\n  created_at TEXT NOT NULL,\n  updated_at TEXT NOT NULL\n)",
  "CREATE UNIQUE INDEX IF NOT EXISTS idx_invitations_pending_email\nON household_invitations(household_id, email_normalized)\nWHERE status = 'pending'",
  "CREATE INDEX IF NOT EXISTS idx_invitations_email_status\nON household_invitations(email_normalized, status, expires_at)",
  "CREATE TABLE IF NOT EXISTS freezers (\n  id TEXT PRIMARY KEY,\n  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,\n  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 60),\n  position INTEGER NOT NULL CHECK (position BETWEEN 1 AND 6),\n  created_at TEXT NOT NULL,\n  updated_at TEXT NOT NULL\n)",
  "CREATE UNIQUE INDEX IF NOT EXISTS idx_freezers_household_position\nON freezers(household_id, position)",
  "CREATE TABLE IF NOT EXISTS drawers (\n  id TEXT PRIMARY KEY,\n  freezer_id TEXT NOT NULL REFERENCES freezers(id) ON DELETE CASCADE,\n  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 60),\n  position INTEGER NOT NULL CHECK (position BETWEEN 1 AND 8),\n  created_at TEXT NOT NULL,\n  updated_at TEXT NOT NULL\n)",
  "CREATE UNIQUE INDEX IF NOT EXISTS idx_drawers_freezer_position\nON drawers(freezer_id, position)",
  "CREATE TABLE IF NOT EXISTS media (\n  id TEXT PRIMARY KEY,\n  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,\n  r2_key TEXT NOT NULL UNIQUE,\n  mime_type TEXT NOT NULL,\n  byte_size INTEGER NOT NULL CHECK (byte_size BETWEEN 1 AND 5242880),\n  width INTEGER,\n  height INTEGER,\n  sha256 TEXT NOT NULL,\n  created_by_user_id TEXT NOT NULL REFERENCES users(id),\n  created_at TEXT NOT NULL,\n  deleted_at TEXT\n)",
  "CREATE INDEX IF NOT EXISTS idx_media_household_active\nON media(household_id, deleted_at)",
  "CREATE TABLE IF NOT EXISTS items (\n  id TEXT PRIMARY KEY,\n  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,\n  freezer_id TEXT NOT NULL REFERENCES freezers(id),\n  drawer_id TEXT NOT NULL REFERENCES drawers(id),\n  label TEXT NOT NULL CHECK (length(label) BETWEEN 1 AND 80),\n  frozen_on TEXT NOT NULL,\n  expires_on TEXT,\n  notes TEXT NOT NULL DEFAULT '' CHECK (length(notes) <= 2000),\n  image_id TEXT REFERENCES media(id),\n  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),\n  created_by_user_id TEXT NOT NULL REFERENCES users(id),\n  updated_by_user_id TEXT NOT NULL REFERENCES users(id),\n  created_at TEXT NOT NULL,\n  updated_at TEXT NOT NULL,\n  deleted_at TEXT\n)",
  "CREATE INDEX IF NOT EXISTS idx_items_household_active\nON items(household_id, deleted_at, freezer_id, drawer_id)",
  "CREATE INDEX IF NOT EXISTS idx_items_drawer_active\nON items(drawer_id, deleted_at, frozen_on)",
  "CREATE INDEX IF NOT EXISTS idx_items_household_expiry\nON items(household_id, deleted_at, expires_on)",
  "CREATE TABLE IF NOT EXISTS ai_usage_events (\n  id TEXT PRIMARY KEY,\n  user_id TEXT NOT NULL REFERENCES users(id),\n  household_id TEXT NOT NULL REFERENCES households(id),\n  ip_hash TEXT NOT NULL,\n  status TEXT NOT NULL CHECK (status IN ('started', 'succeeded', 'failed', 'rejected')),\n  input_tokens INTEGER NOT NULL DEFAULT 0,\n  output_tokens INTEGER NOT NULL DEFAULT 0,\n  estimated_cost_microusd INTEGER NOT NULL DEFAULT 0,\n  created_at TEXT NOT NULL\n)",
  "CREATE INDEX IF NOT EXISTS idx_ai_usage_user_time\nON ai_usage_events(user_id, created_at)",
  "CREATE INDEX IF NOT EXISTS idx_ai_usage_household_time\nON ai_usage_events(household_id, created_at)",
  "CREATE INDEX IF NOT EXISTS idx_ai_usage_ip_time\nON ai_usage_events(ip_hash, created_at)",
  "CREATE TABLE IF NOT EXISTS feedback_reports (\n  id TEXT PRIMARY KEY,\n  reference TEXT NOT NULL UNIQUE,\n  user_id TEXT NOT NULL REFERENCES users(id),\n  household_id TEXT REFERENCES households(id),\n  session_id TEXT NOT NULL,\n  message TEXT NOT NULL CHECK (length(message) BETWEEN 1 AND 4000),\n  app_context_json TEXT NOT NULL,\n  recent_events_json TEXT NOT NULL,\n  created_at TEXT NOT NULL\n)",
  "CREATE INDEX IF NOT EXISTS idx_feedback_reports_created\nON feedback_reports(created_at DESC)",
  "CREATE INDEX IF NOT EXISTS idx_feedback_reports_session\nON feedback_reports(session_id, created_at)",
  "CREATE TABLE IF NOT EXISTS feedback_attachments (\n  id TEXT PRIMARY KEY,\n  feedback_id TEXT NOT NULL UNIQUE REFERENCES feedback_reports(id) ON DELETE CASCADE,\n  r2_key TEXT NOT NULL UNIQUE,\n  mime_type TEXT NOT NULL,\n  byte_size INTEGER NOT NULL CHECK (byte_size BETWEEN 1 AND 5242880),\n  width INTEGER NOT NULL,\n  height INTEGER NOT NULL,\n  sha256 TEXT NOT NULL,\n  created_at TEXT NOT NULL\n)",
  "CREATE INDEX IF NOT EXISTS idx_feedback_attachments_created\nON feedback_attachments(created_at)",
  "CREATE TABLE IF NOT EXISTS app_events (\n  id TEXT PRIMARY KEY,\n  user_id TEXT NOT NULL REFERENCES users(id),\n  household_id TEXT REFERENCES households(id),\n  session_id TEXT NOT NULL,\n  client_request_id TEXT,\n  event_type TEXT NOT NULL,\n  level TEXT NOT NULL CHECK (level IN ('info', 'warn', 'error')),\n  route TEXT,\n  method TEXT,\n  status_code INTEGER,\n  duration_ms INTEGER,\n  metadata_json TEXT NOT NULL,\n  occurred_at TEXT NOT NULL,\n  created_at TEXT NOT NULL\n)",
  "CREATE INDEX IF NOT EXISTS idx_app_events_created\nON app_events(created_at)",
  "CREATE INDEX IF NOT EXISTS idx_app_events_session\nON app_events(session_id, occurred_at)",
  "CREATE INDEX IF NOT EXISTS idx_app_events_request\nON app_events(client_request_id)",
  "CREATE TABLE IF NOT EXISTS sheet_outbox (\n  item_id TEXT PRIMARY KEY,\n  household_id TEXT NOT NULL,\n  item_version INTEGER NOT NULL,\n  payload_json TEXT NOT NULL,\n  attempt_count INTEGER NOT NULL DEFAULT 0,\n  next_attempt_at TEXT NOT NULL,\n  last_error_code TEXT,\n  created_at TEXT NOT NULL,\n  updated_at TEXT NOT NULL,\n  synced_at TEXT\n)",
  "CREATE INDEX IF NOT EXISTS idx_sheet_outbox_due\nON sheet_outbox(synced_at, next_attempt_at, updated_at)",
  "CREATE TABLE IF NOT EXISTS sheet_row_map (\n  item_id TEXT PRIMARY KEY,\n  row_number INTEGER NOT NULL CHECK (row_number >= 2),\n  mirrored_version INTEGER NOT NULL,\n  updated_at TEXT NOT NULL\n)",
  "CREATE TABLE IF NOT EXISTS sheet_sync_state (\n  id INTEGER PRIMARY KEY CHECK (id = 1),\n  schema_version INTEGER NOT NULL DEFAULT 3,\n  last_attempt_at TEXT,\n  last_success_at TEXT,\n  last_reconcile_at TEXT,\n  last_error_code TEXT,\n  updated_at TEXT NOT NULL\n)",
  "INSERT OR IGNORE INTO sheet_sync_state (id, schema_version, updated_at)\nVALUES (1, 3, CURRENT_TIMESTAMP)",
];

let schemaPromise;

async function initializeSchema(env) {
  await env.DB.batch(SCHEMA_STATEMENTS.map((statement) => env.DB.prepare(statement)));

  const [userColumns, itemColumns] = await Promise.all([
    env.DB.prepare("PRAGMA table_info(users)").all(),
    env.DB.prepare("PRAGMA table_info(items)").all(),
  ]);
  const userColumnNames = new Set((userColumns.results || []).map((column) => column.name));
  const itemColumnNames = new Set((itemColumns.results || []).map((column) => column.name));

  if (userColumnNames.has("ai_caption_enabled") && !userColumnNames.has("ai_label_enabled")) {
    await env.DB.prepare("ALTER TABLE users RENAME COLUMN ai_caption_enabled TO ai_label_enabled").run();
  }
  if (itemColumnNames.has("caption") && !itemColumnNames.has("label")) {
    await env.DB.prepare("ALTER TABLE items RENAME COLUMN caption TO label").run();
  }
  await env.DB.prepare("UPDATE sheet_sync_state SET schema_version = 3, updated_at = CURRENT_TIMESTAMP WHERE id = 1").run();
}

export function ensureSchema(env) {
  if (!schemaPromise) {
    schemaPromise = initializeSchema(env).catch((error) => {
      schemaPromise = undefined;
      throw error;
    });
  }
  return schemaPromise;
}
