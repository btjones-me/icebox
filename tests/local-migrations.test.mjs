import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { Miniflare } from "miniflare";
import { applyLocalMigrations, migrationStatements, repairInterruptedLocalMigrations } from "../scripts/local-migrations.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

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
  ]);
  assert.deepEqual(await applyLocalMigrations(database, path.join(projectRoot, "migrations")), []);
  assert.deepEqual((await database.prepare("PRAGMA foreign_key_check").all()).results, []);

  const attachmentSchema = await database.prepare(
    "SELECT sql FROM sqlite_schema WHERE type = 'table' AND name = 'feedback_attachments'",
  ).first();
  assert.match(attachmentSchema.sql, /byte_size[^,]+CHECK \(`byte_size` > 0\)/);
  assert.doesNotMatch(attachmentSchema.sql, /5242880/);

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
  ]);
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
  assert.equal(applied.length, 8);
  assert.equal(applied.some((name) => name.includes("already present")), true);
  assert.equal((await database.prepare("SELECT COUNT(*) AS count FROM local_schema_migrations").first()).count, 8);
  assert.deepEqual((await database.prepare("PRAGMA foreign_key_check").all()).results, []);
});
