import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

const INTERRUPTED_TABLE_RENAMES = [
  {
    current: "media",
    temporary: "media_5mb",
    columns: "id, household_id, r2_key, mime_type, byte_size, width, height, sha256, created_by_user_id, created_at, deleted_at",
  },
  {
    current: "feedback_attachments",
    temporary: "feedback_attachments_relaxed",
    columns: "id, feedback_id, r2_key, mime_type, byte_size, width, height, sha256, created_at",
  },
];

export function migrationStatements(source) {
  return source
    .replace(/^\s*-->\s*statement-breakpoint\s*$/gm, "")
    .split(";")
    .map((statement) => statement.trim())
    .filter(Boolean);
}

async function tableNames(database) {
  const result = await database.prepare("SELECT name FROM sqlite_schema WHERE type = 'table'").all();
  return new Set((result.results || []).map((entry) => entry.name));
}

async function tableSql(database, name) {
  return (await database.prepare("SELECT sql FROM sqlite_schema WHERE type = 'table' AND name = ?").bind(name).first())?.sql || "";
}

async function columnNames(database, table) {
  const result = await database.prepare(`PRAGMA table_info(${table})`).all();
  return new Set((result.results || []).map((entry) => entry.name));
}

async function migrationAlreadyReflected(database, name) {
  if (name === "0002_labels.sql") {
    const [users, items] = await Promise.all([columnNames(database, "users"), columnNames(database, "items")]);
    return users.has("ai_label_enabled") && items.has("label");
  }
  if (name === "0004_feedback_telemetry.sql") {
    const names = await tableNames(database);
    return names.has("feedback_reports") && names.has("app_events");
  }
  if (name === "0005_media_5mb.sql") {
    return /byte_size[\s\S]+5242880/.test(await tableSql(database, "media"));
  }
  if (name === "0006_feedback_attachments.sql") {
    return Boolean(await tableSql(database, "feedback_attachments"));
  }
  if (name === "0007_relax_feedback_attachments.sql") {
    const sql = await tableSql(database, "feedback_attachments");
    return /byte_size[^,]+> 0/.test(sql) && !/5242880/.test(sql);
  }
  if (name === "0009_soft_delete_structures.sql") {
    const [freezers, drawers] = await Promise.all([columnNames(database, "freezers"), columnNames(database, "drawers")]);
    return freezers.has("deleted_at") && drawers.has("deleted_at");
  }
  return false;
}

export async function repairInterruptedLocalMigrations(database) {
  const names = await tableNames(database);
  for (const repair of INTERRUPTED_TABLE_RENAMES) {
    if (!names.has(repair.temporary)) continue;
    if (!names.has(repair.current)) {
      await database.prepare(`ALTER TABLE ${repair.temporary} RENAME TO ${repair.current}`).run();
      names.delete(repair.temporary);
      names.add(repair.current);
      continue;
    }
    await database.batch([
      database.prepare(`INSERT OR IGNORE INTO ${repair.current} (${repair.columns}) SELECT ${repair.columns} FROM ${repair.temporary}`),
      database.prepare(`DROP TABLE ${repair.temporary}`),
    ]);
    names.delete(repair.temporary);
  }
}

export async function applyLocalMigrations(database, migrationDirectory) {
  await database.prepare(
    "CREATE TABLE IF NOT EXISTS local_schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)",
  ).run();
  await repairInterruptedLocalMigrations(database);

  const migrations = (await readdir(migrationDirectory)).filter((name) => name.endsWith(".sql")).sort();
  const applied = [];
  for (const name of migrations) {
    const existing = await database.prepare("SELECT 1 AS applied FROM local_schema_migrations WHERE name = ?").bind(name).first();
    if (existing) continue;
    if (await migrationAlreadyReflected(database, name)) {
      await database.prepare("INSERT INTO local_schema_migrations (name, applied_at) VALUES (?, ?)")
        .bind(name, new Date().toISOString()).run();
      applied.push(`${name} (already present)`);
      continue;
    }
    const source = await readFile(path.join(migrationDirectory, name), "utf8");
    const statements = migrationStatements(source).map((statement) => database.prepare(statement));
    statements.push(
      database.prepare("INSERT INTO local_schema_migrations (name, applied_at) VALUES (?, ?)")
        .bind(name, new Date().toISOString()),
    );
    await database.batch(statements);
    applied.push(name);
  }
  return applied;
}
