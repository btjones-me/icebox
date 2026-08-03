#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { localBackendVersion, watchLocalBackendSources } from "./local-dev-watch.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const children = new Set();
const expectedExits = new WeakSet();
let stopping = false;
let apiChild = null;
let activeBackendVersion = null;
let backendWatcher = null;
let backendRestarting = false;
let queuedBackendChanges = null;

const runtimeCheck = spawnSync(process.execPath, ["scripts/check-mobile-runtime.mjs"], {
  cwd: projectRoot,
  stdio: "inherit",
});
if (runtimeCheck.status !== 0) process.exit(runtimeCheck.status || 1);

function start(name, command, args, { env = process.env, ipc = false } = {}) {
  const child = spawn(command, args, {
    cwd: projectRoot,
    env,
    stdio: ipc ? ["ignore", "pipe", "pipe", "ipc"] : ["ignore", "pipe", "pipe"],
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
    if (!stopping && !expectedExits.has(child)) {
      console.error(`[${name}] stopped unexpectedly (${signal || code})`);
      void stop(code || 1);
    }
  });
  return child;
}

function waitForBackendReady(child, expectedVersion) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => finish(new Error("Local API did not finish its database migrations")), 20_000);
    const onMessage = (message) => {
      if (message?.type !== "icebox-local-api-ready") return;
      if (message.version !== expectedVersion) {
        finish(new Error(`Local API process reported ${message.version || "an unknown version"}; expected ${expectedVersion}`));
        return;
      }
      finish();
    };
    const onExit = (code, signal) => finish(new Error(`Local API stopped before it was ready (${signal || code})`));
    const finish = (error) => {
      clearTimeout(timeout);
      child.off("message", onMessage);
      child.off("exit", onExit);
      if (error) reject(error);
      else resolve();
    };
    child.on("message", onMessage);
    child.once("exit", onExit);
  });
}

async function waitForApi(expectedVersion) {
  let lastError;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch("http://127.0.0.1:8787/api/local-dev/state");
      if (!response.ok) {
        lastError = new Error(`Local API returned ${response.status}`);
      } else {
        const state = await response.json();
        if (state.workerVersion === expectedVersion) return state;
        lastError = new Error(`Local API version mismatch (expected ${expectedVersion}, received ${state.workerVersion || "unversioned"})`);
      }
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw lastError || new Error("Local API did not start");
}

async function terminateChild(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  expectedExits.add(child);
  const exited = new Promise((resolve) => child.once("exit", resolve));
  child.kill("SIGTERM");
  await exited;
}

async function startBackend(requestedVersion) {
  const version = requestedVersion || await localBackendVersion(projectRoot);
  apiChild = start("api", process.execPath, ["scripts/local-backend.mjs"], {
    env: { ...process.env, ICEBOX_LOCAL_WORKER_VERSION: version },
    ipc: true,
  });
  await waitForBackendReady(apiChild, version);
  await waitForApi(version);
  activeBackendVersion = version;
  console.log(`[api] Worker source ${version}`);
}

async function restartBackend(changedPaths) {
  if (stopping) return;
  if (backendRestarting) {
    queuedBackendChanges = [...new Set([...(queuedBackendChanges || []), ...changedPaths])];
    return;
  }

  backendRestarting = true;
  let changes = changedPaths;
  try {
    do {
      queuedBackendChanges = null;
      const version = await localBackendVersion(projectRoot);
      if (version === activeBackendVersion) {
        changes = queuedBackendChanges;
        continue;
      }
      console.log(`[api] Backend change detected (${changes.join(", ")}); restarting…`);
      const previous = apiChild;
      apiChild = null;
      await terminateChild(previous);
      if (stopping) return;
      await startBackend(version);
      changes = queuedBackendChanges;
    } while (changes?.length);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    await stop(1);
  } finally {
    backendRestarting = false;
  }
}

async function stop(exitCode = 0) {
  if (stopping) return;
  stopping = true;
  backendWatcher?.close();
  const activeChildren = [...children];
  await Promise.all(activeChildren.map(terminateChild));
  process.exit(exitCode);
}

process.once("SIGINT", () => void stop());
process.once("SIGTERM", () => void stop());

try {
  await startBackend();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  await stop(1);
}

start("app", process.execPath, ["node_modules/vite/bin/vite.js", "--config", "vite.local.config.ts"]);
start("control", process.execPath, ["scripts/local-control-server.mjs"]);
backendWatcher = watchLocalBackendSources({
  projectRoot,
  onChange: restartBackend,
  onError: (error) => {
    console.error(`[api] Backend watcher failed: ${error instanceof Error ? error.message : String(error)}`);
    void stop(1);
  },
});
console.log("Icebox: http://127.0.0.1:4173/");
console.log("Local data control: http://127.0.0.1:4174/");
await new Promise(() => {});
