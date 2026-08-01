#!/usr/bin/env node
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Log, LogLevel, Miniflare } from "miniflare";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const persistenceRoot = path.join(projectRoot, ".local");

const miniflare = new Miniflare({
  host: "127.0.0.1",
  port: 8787,
  rootPath: projectRoot,
  scriptPath: "worker/index.js",
  modules: true,
  modulesRules: [{ type: "ESModule", include: ["**/*.js"] }],
  compatibilityDate: "2026-08-01",
  bindings: {
    LOCAL_DEV_MODE: "1",
    OPENAI_API_KEY: process.env.OPENAI_API_KEY || "",
    AI_MONTHLY_CAP_MICROUSD: process.env.AI_MONTHLY_CAP_MICROUSD || "25000000",
    RATE_LIMIT_SALT: process.env.RATE_LIMIT_SALT || "icebox-local-development",
    OPERATOR_CHATGPT_USER_ID: "local-alex",
    PILOT_ALLOWED_EMAILS: "alex@example.com",
  },
  d1Databases: { DB: "icebox-local" },
  r2Buckets: { MEDIA: "icebox-local-media" },
  d1Persist: path.join(persistenceRoot, "d1"),
  r2Persist: path.join(persistenceRoot, "r2"),
  log: new Log(LogLevel.INFO, { prefix: "icebox-api" }),
});

const database = await miniflare.getD1Database("DB");
await database.prepare(
  "CREATE TABLE IF NOT EXISTS local_schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)",
).run();
const migrationDirectory = path.join(projectRoot, "migrations");
const migrations = (await readdir(migrationDirectory)).filter((name) => name.endsWith(".sql")).sort();
for (const name of migrations) {
  const applied = await database.prepare("SELECT 1 AS applied FROM local_schema_migrations WHERE name = ?").bind(name).first();
  if (applied) continue;
  const migration = await readFile(path.join(migrationDirectory, name), "utf8");
  for (const statement of migration.split(";").map((entry) => entry.trim()).filter(Boolean)) {
    await database.prepare(statement).run();
  }
  await database.prepare(
    "INSERT INTO local_schema_migrations (name, applied_at) VALUES (?, ?)",
  ).bind(name, new Date().toISOString()).run();
}
const address = await miniflare.ready;

console.log(`Icebox local API ready at ${address.origin}`);
console.log(`OpenAI labeling: ${process.env.OPENAI_API_KEY ? "configured" : "not configured"}`);

let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  await miniflare.dispose();
  process.exit(0);
}

process.once("SIGINT", stop);
process.once("SIGTERM", stop);
await new Promise(() => {});
