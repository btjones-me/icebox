import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { Miniflare } from "miniflare";
import { applyLocalMigrations, migrationStatements, repairInterruptedLocalMigrations } from "../scripts/local-migrations.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function applyMigrationFiles(database, names) {
  for (const name of names) {
    const source = await readFile(path.join(projectRoot, "migrations", name), "utf8");
    await database.batch(migrationStatements(source).map((statement) => database.prepare(statement)));
  }
}

async function captureProductionRows(database) {
  const rows = async (sql) => (await database.prepare(sql).all()).results;
  return {
    users: await rows(
      `SELECT id, email, email_normalized, full_name, ai_label_enabled, default_household_id,
              created_at, updated_at, last_seen_at, deleted_at
       FROM users ORDER BY id`,
    ),
    households: await rows("SELECT * FROM households ORDER BY id"),
    members: await rows("SELECT * FROM household_members ORDER BY household_id, user_id"),
    invitations: await rows("SELECT * FROM household_invitations ORDER BY id"),
    freezers: await rows(
      `SELECT id, household_id, name, position, created_at, updated_at, deleted_at
       FROM freezers ORDER BY id`,
    ),
    drawers: await rows(
      `SELECT id, freezer_id, name, position, created_at, updated_at, deleted_at
       FROM drawers ORDER BY id`,
    ),
    items: await rows("SELECT * FROM items ORDER BY id"),
    media: await rows(
      `SELECT id, household_id, r2_key, mime_type, byte_size, width, height, sha256,
              created_by_user_id, created_at, deleted_at
       FROM media ORDER BY id`,
    ),
    feedbackReports: await rows("SELECT * FROM feedback_reports ORDER BY id"),
    feedbackAttachments: await rows("SELECT * FROM feedback_attachments ORDER BY id"),
    appEvents: await rows("SELECT * FROM app_events ORDER BY id"),
    sheetOutbox: await rows("SELECT * FROM sheet_outbox ORDER BY item_id"),
    sheetRowMap: await rows("SELECT * FROM sheet_row_map ORDER BY item_id"),
    sheetSyncState: await rows("SELECT * FROM sheet_sync_state ORDER BY id"),
    sheetMirrorLock: await rows("SELECT * FROM sheet_mirror_lock ORDER BY id"),
  };
}

async function captureTableCounts(database, names) {
  const entries = await Promise.all(names.map(async (name) => {
    const row = await database.prepare(`SELECT COUNT(*) AS count FROM ${name}`).first();
    return [name, Number(row?.count || 0)];
  }));
  return Object.fromEntries(entries);
}

test("local migrations apply atomically, replay safely, and repair interrupted table swaps", async (context) => {
  const miniflare = new Miniflare({
    script: "export default { fetch() { return new Response('ok'); } }",
    modules: true,
    compatibilityDate: "2026-08-01",
    d1Databases: { DB: "icebox-local-migration-test" },
    d1Persist: false,
  });
  context.after(() => miniflare.dispose());
  const database = await miniflare.getD1Database("DB");

  const applied = await applyLocalMigrations(database, path.join(projectRoot, "migrations"));
  assert.deepEqual(applied, [
    "0001_initial.sql",
    "0002_labels.sql",
    "0003_label_outbox.sql",
    "0004_feedback_telemetry.sql",
    "0005_media_5mb.sql",
    "0006_feedback_attachments.sql",
    "0007_relax_feedback_attachments.sql",
    "0009_soft_delete_structures.sql",
    "0010_sheet_mirror_lease.sql",
    "0011_structure_sort_modes.sql",
    "0012_media_thumbnails.sql",
  ]);
  assert.deepEqual(await applyLocalMigrations(database, path.join(projectRoot, "migrations")), []);
  assert.deepEqual((await database.prepare("PRAGMA foreign_key_check").all()).results, []);

  const attachmentSchema = await database.prepare(
    "SELECT sql FROM sqlite_schema WHERE type = 'table' AND name = 'feedback_attachments'",
  ).first();
  assert.match(attachmentSchema.sql, /byte_size[^,]+CHECK \(`byte_size` > 0\)/);
  assert.doesNotMatch(attachmentSchema.sql, /5242880/);
  assert.ok(await database.prepare("SELECT name FROM sqlite_schema WHERE type = 'table' AND name = 'sheet_mirror_lock'").first());

  const [freezerColumns, drawerColumns] = await Promise.all([
    database.prepare("PRAGMA table_info(freezers)").all(),
    database.prepare("PRAGMA table_info(drawers)").all(),
  ]);
  assert.equal(freezerColumns.results.find((column) => column.name === "default_sort_mode").dflt_value, "'added'");
  assert.equal(drawerColumns.results.find((column) => column.name === "default_sort_mode").dflt_value, "'added'");
  const mediaColumns = await database.prepare("PRAGMA table_info(media)").all();
  assert.equal(mediaColumns.results.some((column) => column.name === "thumbnail_r2_key"), true);
  assert.equal(mediaColumns.results.some((column) => column.name === "thumbnail_sha256"), true);
  const now = new Date().toISOString();
  await database.batch([
    database.prepare(
      `INSERT INTO users (id, email, email_normalized, full_name, ai_label_enabled, created_at, updated_at, last_seen_at)
       VALUES ('user-repair', 'repair@example.com', 'repair@example.com', 'Repair User', 1, ?, ?, ?)`,
    ).bind(now, now, now),
    database.prepare(
      `INSERT INTO households (id, name, owner_user_id, created_at, updated_at)
       VALUES ('house-repair', 'Repair House', 'user-repair', ?, ?)`,
    ).bind(now, now),
    database.prepare(
      `INSERT INTO freezers (id, household_id, name, position, created_at, updated_at)
       VALUES ('freezer-repair', 'house-repair', 'Repair Freezer', 1, ?, ?)`,
    ).bind(now, now),
    database.prepare(
      `INSERT INTO drawers (id, freezer_id, name, position, created_at, updated_at)
       VALUES ('drawer-repair', 'freezer-repair', 'Repair Drawer', 1, ?, ?)`,
    ).bind(now, now),
  ]);
  await assert.rejects(
    database.prepare("UPDATE drawers SET default_sort_mode = 'invalid' WHERE id = 'drawer-repair'").run(),
    /CHECK constraint failed/,
  );
  await database.prepare("CREATE TABLE media_5mb AS SELECT * FROM media WHERE 0").run();
  await database.prepare(
    `INSERT INTO media_5mb
      (id, household_id, r2_key, mime_type, byte_size, width, height, sha256, created_by_user_id, created_at, deleted_at)
     VALUES ('media-repair', 'house-repair', 'repair/image.jpg', 'image/jpeg', 100, 10, 10, 'hash', 'user-repair', ?, NULL)`,
  ).bind(now).run();

  await repairInterruptedLocalMigrations(database);
  assert.equal((await database.prepare("SELECT COUNT(*) AS count FROM media WHERE id = 'media-repair'").first()).count, 1);
  assert.equal(await database.prepare("SELECT name FROM sqlite_schema WHERE type = 'table' AND name = 'media_5mb'").first(), null);
});

test("production data survives the populated 0010 to 0012 upgrade", async (context) => {
  const miniflare = new Miniflare({
    script: "export default { fetch() { return new Response('ok'); } }",
    modules: true,
    compatibilityDate: "2026-08-01",
    d1Databases: { DB: "icebox-production-upgrade-test" },
    d1Persist: false,
  });
  context.after(() => miniflare.dispose());
  const database = await miniflare.getD1Database("DB");

  await applyMigrationFiles(database, [
    "0001_initial.sql",
    "0002_labels.sql",
    "0003_label_outbox.sql",
    "0004_feedback_telemetry.sql",
    "0005_media_5mb.sql",
    "0006_feedback_attachments.sql",
    "0007_relax_feedback_attachments.sql",
    "0009_soft_delete_structures.sql",
    "0010_sheet_mirror_lease.sql",
  ]);

  const createdAt = "2026-08-10T10:00:00.000Z";
  const updatedAt = "2026-08-11T11:00:00.000Z";
  await database.batch([
    database.prepare(
      `INSERT INTO users
        (id, email, email_normalized, full_name, ai_label_enabled, default_household_id,
         created_at, updated_at, last_seen_at, deleted_at)
       VALUES
        ('user-owner', 'owner@example.com', 'owner@example.com', 'Owner', 1, 'house-live', ?, ?, ?, NULL),
        ('user-member', 'member@example.com', 'member@example.com', 'Member', 0, 'house-live', ?, ?, ?, NULL)`,
    ).bind(createdAt, updatedAt, updatedAt, createdAt, updatedAt, updatedAt),
    database.prepare(
      `INSERT INTO households (id, name, owner_user_id, created_at, updated_at, deleted_at)
       VALUES ('house-live', 'Production Household', 'user-owner', ?, ?, NULL)`,
    ).bind(createdAt, updatedAt),
    database.prepare(
      `INSERT INTO household_members (household_id, user_id, joined_at)
       VALUES ('house-live', 'user-owner', ?), ('house-live', 'user-member', ?)`,
    ).bind(createdAt, updatedAt),
    database.prepare(
      `INSERT INTO household_invitations
        (id, household_id, email_normalized, invited_by_user_id, status, expires_at,
         accepted_by_user_id, created_at, updated_at)
       VALUES
        ('invite-pending', 'house-live', 'invitee@example.com', 'user-owner', 'pending',
         '2026-09-10T10:00:00.000Z', NULL, ?, ?)`,
    ).bind(createdAt, updatedAt),
    database.prepare(
      `INSERT INTO freezers (id, household_id, name, position, created_at, updated_at, deleted_at)
       VALUES
        ('freezer-live', 'house-live', 'Kitchen Freezer', 1, ?, ?, NULL),
        ('freezer-deleted', 'house-live', 'Old Freezer', 2, ?, ?, '2026-08-11T09:00:00.000Z')`,
    ).bind(createdAt, updatedAt, createdAt, updatedAt),
    database.prepare(
      `INSERT INTO drawers (id, freezer_id, name, position, created_at, updated_at, deleted_at)
       VALUES
        ('drawer-live', 'freezer-live', 'Top Drawer', 1, ?, ?, NULL),
        ('drawer-deleted', 'freezer-live', 'Old Drawer', 2, ?, ?, '2026-08-11T09:30:00.000Z')`,
    ).bind(createdAt, updatedAt, createdAt, updatedAt),
    database.prepare(
      `INSERT INTO media
        (id, household_id, r2_key, mime_type, byte_size, width, height, sha256,
         created_by_user_id, created_at, deleted_at)
       VALUES
        ('media-live', 'house-live', 'house-live/media-live.jpg', 'image/jpeg', 345678,
         1200, 900, 'production-image-sha256', 'user-owner', ?, NULL)`,
    ).bind(createdAt),
    database.prepare(
      `INSERT INTO items
        (id, household_id, freezer_id, drawer_id, label, frozen_on, expires_on, notes, image_id,
         version, created_by_user_id, updated_by_user_id, created_at, updated_at, deleted_at)
       VALUES
        ('item-live', 'house-live', 'freezer-live', 'drawer-live', 'Production curry',
         '2026-08-10', '2026-11-10', 'Four portions', 'media-live', 4,
         'user-owner', 'user-member', ?, ?, NULL)`,
    ).bind(createdAt, updatedAt),
    database.prepare(
      `INSERT INTO feedback_reports
        (id, reference, user_id, household_id, session_id, message, app_context_json,
         recent_events_json, created_at)
       VALUES
        ('feedback-live', 'ICE-PROD01', 'user-member', 'house-live', 'session-live',
         'Representative production feedback', '{"route":"/"}', '[{"type":"item_open"}]', ?)`,
    ).bind(updatedAt),
    database.prepare(
      `INSERT INTO feedback_attachments
        (id, feedback_id, r2_key, mime_type, byte_size, width, height, sha256, created_at)
       VALUES
        ('feedback-photo-live', 'feedback-live', 'feedback/feedback-photo-live.heic',
         'image/heic', 7340032, 3024, 4032, 'feedback-photo-sha256', ?)`,
    ).bind(updatedAt),
    database.prepare(
      `INSERT INTO app_events
        (id, user_id, household_id, session_id, client_request_id, event_type, level, route,
         method, status_code, duration_ms, metadata_json, occurred_at, created_at)
       VALUES
        ('event-live', 'user-member', 'house-live', 'session-live', 'request-live',
         'feedback_submit', 'info', '/api/feedback', 'POST', 201, 87, '{"attachment":true}', ?, ?)`,
    ).bind(updatedAt, updatedAt),
    database.prepare(
      `INSERT INTO sheet_outbox
        (item_id, household_id, item_version, payload_json, attempt_count, next_attempt_at,
         last_error_code, created_at, updated_at, synced_at)
       VALUES
        ('item-live', 'house-live', 4, '{"item_id":"item-live","item_version":4,"label":"Production curry"}',
         2, '2026-08-12T12:00:00.000Z', '429', ?, ?, NULL)`,
    ).bind(createdAt, updatedAt),
    database.prepare(
      `INSERT INTO sheet_row_map (item_id, row_number, mirrored_version, updated_at)
       VALUES ('item-live', 42, 3, ?)`,
    ).bind(updatedAt),
    database.prepare(
      `UPDATE sheet_sync_state
       SET schema_version = 3, last_attempt_at = '2026-08-11T10:50:00.000Z',
           last_success_at = '2026-08-10T10:30:00.000Z', last_reconcile_at = '2026-08-09T10:00:00.000Z',
           last_error_code = '429', updated_at = ?
       WHERE id = 1`,
    ).bind(updatedAt),
    database.prepare(
      `UPDATE sheet_mirror_lock
       SET lease_id = 'lease-live', lease_expires_at = '2026-08-12T12:05:00.000Z', updated_at = ?
       WHERE id = 1`,
    ).bind(updatedAt),
  ]);

  const before = await captureProductionRows(database);
  await applyMigrationFiles(database, ["0011_structure_sort_modes.sql", "0012_media_thumbnails.sql"]);
  const after = await captureProductionRows(database);

  assert.deepEqual(after, before);
  assert.deepEqual(
    (await database.prepare("SELECT id, default_sort_mode FROM freezers ORDER BY id").all()).results,
    [
      { id: "freezer-deleted", default_sort_mode: "added" },
      { id: "freezer-live", default_sort_mode: "added" },
    ],
  );
  assert.deepEqual(
    (await database.prepare("SELECT id, default_sort_mode FROM drawers ORDER BY id").all()).results,
    [
      { id: "drawer-deleted", default_sort_mode: "added" },
      { id: "drawer-live", default_sort_mode: "added" },
    ],
  );
  assert.deepEqual(
    (await database.prepare(
      `SELECT thumbnail_r2_key, thumbnail_mime_type, thumbnail_byte_size,
              thumbnail_width, thumbnail_height, thumbnail_sha256
       FROM media WHERE id = 'media-live'`,
    ).first()),
    {
      thumbnail_r2_key: null,
      thumbnail_mime_type: null,
      thumbnail_byte_size: null,
      thumbnail_width: null,
      thumbnail_height: null,
      thumbnail_sha256: null,
    },
  );
  assert.deepEqual((await database.prepare("PRAGMA foreign_key_check").all()).results, []);
});

test("current Worker boots authenticated session and bootstrap from populated production-through-0010 D1", async (context) => {
  const miniflare = new Miniflare({
    rootPath: projectRoot,
    scriptPath: "worker/index.js",
    modules: true,
    modulesRules: [{ type: "ESModule", include: ["**/*.js"] }],
    compatibilityDate: "2026-08-01",
    bindings: { OPERATOR_CHATGPT_USER_ID: "user-owner" },
    d1Databases: { DB: "icebox-production-worker-upgrade-test" },
    r2Buckets: { MEDIA: "icebox-production-worker-upgrade-media" },
    d1Persist: false,
    r2Persist: false,
  });
  context.after(() => miniflare.dispose());
  const database = await miniflare.getD1Database("DB");

  await applyMigrationFiles(database, [
    "0001_initial.sql",
    "0002_labels.sql",
    "0003_label_outbox.sql",
    "0004_feedback_telemetry.sql",
    "0005_media_5mb.sql",
    "0006_feedback_attachments.sql",
    "0007_relax_feedback_attachments.sql",
    "0009_soft_delete_structures.sql",
    "0010_sheet_mirror_lease.sql",
  ]);

  const createdAt = "2026-08-10T10:00:00.000Z";
  const updatedAt = "2026-08-11T11:00:00.000Z";
  await database.batch([
    database.prepare(
      `INSERT INTO users
        (id, email, email_normalized, full_name, ai_label_enabled, default_household_id,
         created_at, updated_at, last_seen_at, deleted_at)
       VALUES ('user-owner', 'owner@example.com', 'owner@example.com', 'Owner', 1,
               'house-live', ?, ?, ?, NULL)`,
    ).bind(createdAt, updatedAt, updatedAt),
    database.prepare(
      `INSERT INTO households (id, name, owner_user_id, created_at, updated_at, deleted_at)
       VALUES ('house-live', 'Production Household', 'user-owner', ?, ?, NULL)`,
    ).bind(createdAt, updatedAt),
    database.prepare(
      `INSERT INTO household_members (household_id, user_id, joined_at)
       VALUES ('house-live', 'user-owner', ?)`,
    ).bind(createdAt),
    database.prepare(
      `INSERT INTO household_invitations
        (id, household_id, email_normalized, invited_by_user_id, status, expires_at,
         accepted_by_user_id, created_at, updated_at)
       VALUES ('invite-live', 'house-live', 'invitee@example.com', 'user-owner', 'pending',
               '2026-09-10T10:00:00.000Z', NULL, ?, ?)`,
    ).bind(createdAt, updatedAt),
    database.prepare(
      `INSERT INTO freezers (id, household_id, name, position, created_at, updated_at, deleted_at)
       VALUES
        ('freezer-live', 'house-live', 'Kitchen Freezer', 1, ?, ?, NULL),
        ('freezer-deleted', 'house-live', 'Old Freezer', 2, ?, ?, '2026-08-11T09:00:00.000Z')`,
    ).bind(createdAt, updatedAt, createdAt, updatedAt),
    database.prepare(
      `INSERT INTO drawers (id, freezer_id, name, position, created_at, updated_at, deleted_at)
       VALUES
        ('drawer-live', 'freezer-live', 'Top Drawer', 1, ?, ?, NULL),
        ('drawer-deleted', 'freezer-live', 'Old Drawer', 2, ?, ?, '2026-08-11T09:30:00.000Z')`,
    ).bind(createdAt, updatedAt, createdAt, updatedAt),
    database.prepare(
      `INSERT INTO media
        (id, household_id, r2_key, mime_type, byte_size, width, height, sha256,
         created_by_user_id, created_at, deleted_at)
       VALUES ('media-live', 'house-live', 'house-live/media-live.jpg', 'image/jpeg', 345678,
               1200, 900, 'production-image-sha256', 'user-owner', ?, NULL)`,
    ).bind(createdAt),
    database.prepare(
      `INSERT INTO items
        (id, household_id, freezer_id, drawer_id, label, frozen_on, expires_on, notes, image_id,
         version, created_by_user_id, updated_by_user_id, created_at, updated_at, deleted_at)
       VALUES ('item-live', 'house-live', 'freezer-live', 'drawer-live', 'Production curry',
               '2026-08-10', '2026-11-10', 'Four portions', 'media-live', 4,
               'user-owner', 'user-owner', ?, ?, NULL)`,
    ).bind(createdAt, updatedAt),
    database.prepare(
      `INSERT INTO feedback_reports
        (id, reference, user_id, household_id, session_id, message, app_context_json,
         recent_events_json, created_at)
       VALUES ('feedback-live', 'ICE-PROD02', 'user-owner', 'house-live', 'session-live',
               'Representative production feedback', '{"route":"/"}', '[]', ?)`,
    ).bind(updatedAt),
    database.prepare(
      `INSERT INTO feedback_attachments
        (id, feedback_id, r2_key, mime_type, byte_size, width, height, sha256, created_at)
       VALUES ('feedback-photo-live', 'feedback-live', 'feedback/feedback-photo-live.heic',
               'image/heic', 7340032, 3024, 4032, 'feedback-photo-sha256', ?)`,
    ).bind(updatedAt),
    database.prepare(
      `INSERT INTO sheet_outbox
        (item_id, household_id, item_version, payload_json, attempt_count, next_attempt_at,
         last_error_code, created_at, updated_at, synced_at)
       VALUES ('item-live', 'house-live', 4, '{"item_id":"item-live","item_version":4}',
               1, ?, NULL, ?, ?, ?)`,
    ).bind(updatedAt, createdAt, updatedAt, updatedAt),
    database.prepare(
      `INSERT INTO sheet_row_map (item_id, row_number, mirrored_version, updated_at)
       VALUES ('item-live', 42, 4, ?)`,
    ).bind(updatedAt),
  ]);

  const preservedTables = [
    "users", "households", "household_members", "household_invitations", "freezers", "drawers",
    "media", "items", "feedback_reports", "feedback_attachments", "sheet_outbox", "sheet_row_map",
  ];
  const countsBefore = await captureTableCounts(database, preservedTables);
  const identity = {
    "oai-authenticated-user-id": "user-owner",
    "oai-authenticated-user-email": "owner@example.com",
  };

  let response = await miniflare.dispatchFetch("https://icebox.example/api/session", { headers: identity });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    authenticated: true,
    admitted: true,
    user: { email: "owner@example.com", fullName: null },
  });

  response = await miniflare.dispatchFetch("https://icebox.example/api/bootstrap", { headers: identity });
  assert.equal(response.status, 200);
  const bootstrap = await response.json();
  assert.equal(bootstrap.user.id, "user-owner");
  assert.equal(bootstrap.defaultHouseholdId, "house-live");
  assert.deepEqual(bootstrap.households.map(({ id, name, memberCount }) => ({ id, name, memberCount })), [
    { id: "house-live", name: "Production Household", memberCount: 1 },
  ]);
  assert.deepEqual(bootstrap.freezers, [
    { id: "freezer-live", householdId: "house-live", name: "Kitchen Freezer", position: 1, defaultSortMode: "added" },
  ]);
  assert.deepEqual(bootstrap.drawers, [
    { id: "drawer-live", freezerId: "freezer-live", name: "Top Drawer", position: 1, defaultSortMode: "added" },
  ]);
  assert.deepEqual(bootstrap.items, [
    {
      id: "item-live",
      householdId: "house-live",
      freezerId: "freezer-live",
      drawerId: "drawer-live",
      label: "Production curry",
      frozenOn: "2026-08-10",
      expiresOn: "2026-11-10",
      notes: "Four portions",
      imageId: "media-live",
      version: 4,
      createdAt,
      imageUrl: "/api/media/media-live",
      thumbnailUrl: "/api/media/media-live/thumbnail",
      thumbnailReady: 0,
    },
  ]);

  assert.deepEqual(await captureTableCounts(database, preservedTables), countsBefore);
  assert.deepEqual(
    await database.prepare(
      `SELECT id, household_id, freezer_id, drawer_id, label, frozen_on, expires_on, notes,
              image_id, version, created_at, updated_at, deleted_at
       FROM items WHERE id = 'item-live'`,
    ).first(),
    {
      id: "item-live",
      household_id: "house-live",
      freezer_id: "freezer-live",
      drawer_id: "drawer-live",
      label: "Production curry",
      frozen_on: "2026-08-10",
      expires_on: "2026-11-10",
      notes: "Four portions",
      image_id: "media-live",
      version: 4,
      created_at: createdAt,
      updated_at: updatedAt,
      deleted_at: null,
    },
  );
  assert.deepEqual((await database.prepare("PRAGMA foreign_key_check").all()).results, []);
});

test("migration parser removes Drizzle breakpoints", () => {
  assert.deepEqual(
    migrationStatements("CREATE TABLE one (id TEXT);\n--> statement-breakpoint\nINSERT INTO one VALUES ('1');"),
    ["CREATE TABLE one (id TEXT)", "INSERT INTO one VALUES ('1')"],
  );
});

test("local migrations baseline a database previously initialized by the Worker", async (context) => {
  const miniflare = new Miniflare({
    host: "127.0.0.1",
    port: 0,
    rootPath: projectRoot,
    scriptPath: "worker/index.js",
    modules: true,
    modulesRules: [{ type: "ESModule", include: ["**/*.js"] }],
    compatibilityDate: "2026-08-01",
    bindings: { LOCAL_DEV_MODE: "1", LOCAL_WORKER_VERSION: "legacy-worker" },
    d1Databases: { DB: "icebox-legacy-local-migration-test" },
    r2Buckets: { MEDIA: "icebox-legacy-local-migration-media" },
    d1Persist: false,
    r2Persist: false,
  });
  context.after(() => miniflare.dispose());

  const response = await miniflare.dispatchFetch("http://127.0.0.1/api/local-dev/state");
  assert.equal(response.status, 200);
  const database = await miniflare.getD1Database("DB");
  const applied = await applyLocalMigrations(database, path.join(projectRoot, "migrations"));
  assert.equal(applied.length, 11);
  assert.equal(applied.some((name) => name.includes("already present")), true);
  assert.equal((await database.prepare("SELECT COUNT(*) AS count FROM local_schema_migrations").first()).count, 11);
  assert.deepEqual((await database.prepare("PRAGMA foreign_key_check").all()).results, []);
});
