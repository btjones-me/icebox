#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Log, LogLevel, Miniflare } from "miniflare";
import { applyLocalMigrations } from "./local-migrations.mjs";

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
    LOCAL_WORKER_VERSION: process.env.ICEBOX_LOCAL_WORKER_VERSION || "local-unversioned",
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
const migrationDirectory = path.join(projectRoot, "migrations");
const appliedMigrations = await applyLocalMigrations(database, migrationDirectory);
const address = await miniflare.ready;

console.log(`Icebox local API ready at ${address.origin}`);
console.log(`Worker source version: ${process.env.ICEBOX_LOCAL_WORKER_VERSION || "local-unversioned"}`);
if (appliedMigrations.length) console.log(`Applied local migrations: ${appliedMigrations.join(", ")}`);
console.log(`OpenAI labeling: ${process.env.OPENAI_API_KEY ? "configured" : "not configured"}`);
if (typeof process.send === "function") {
  process.send({ type: "icebox-local-api-ready", version: process.env.ICEBOX_LOCAL_WORKER_VERSION || "local-unversioned" });
}

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
