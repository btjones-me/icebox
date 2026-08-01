#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const children = new Set();
let stopping = false;

const runtimeCheck = spawnSync(process.execPath, ["scripts/check-mobile-runtime.mjs"], {
  cwd: projectRoot,
  stdio: "inherit",
});
if (runtimeCheck.status !== 0) process.exit(runtimeCheck.status || 1);

function start(name, command, args) {
  const child = spawn(command, args, {
    cwd: projectRoot,
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  children.add(child);
  const forward = (stream, target) => {
    let remainder = "";
    stream.on("data", (chunk) => {
      const lines = `${remainder}${chunk}`.split("\n");
      remainder = lines.pop() || "";
      for (const line of lines) if (line) target.write(`[${name}] ${line}\n`);
    });
    stream.on("end", () => {
      if (remainder) target.write(`[${name}] ${remainder}\n`);
    });
  };
  forward(child.stdout, process.stdout);
  forward(child.stderr, process.stderr);
  child.once("exit", (code, signal) => {
    children.delete(child);
    if (!stopping) {
      console.error(`[${name}] stopped unexpectedly (${signal || code})`);
      void stop(code || 1);
    }
  });
  return child;
}

async function waitForApi() {
  let lastError;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch("http://127.0.0.1:8787/api/local-dev/state");
      if (response.ok) return;
      lastError = new Error(`Local API returned ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw lastError || new Error("Local API did not start");
}

async function stop(exitCode = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill("SIGTERM");
  await Promise.all([...children].map((child) => new Promise((resolve) => child.once("exit", resolve))));
  process.exit(exitCode);
}

process.once("SIGINT", () => void stop());
process.once("SIGTERM", () => void stop());

start("api", process.execPath, ["scripts/local-backend.mjs"]);
try {
  await waitForApi();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  await stop(1);
}

start("app", process.execPath, ["node_modules/vite/bin/vite.js", "--config", "vite.local.config.ts"]);
start("control", process.execPath, ["scripts/local-control-server.mjs"]);
console.log("Icebox: http://127.0.0.1:4173/");
console.log("Local data control: http://127.0.0.1:4174/");
await new Promise(() => {});
