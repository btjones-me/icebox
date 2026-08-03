import { createHash } from "node:crypto";
import { lstat, readFile, readdir } from "node:fs/promises";
import { watch as watchFileSystem } from "node:fs";
import path from "node:path";

export const LOCAL_BACKEND_WATCH_PATHS = Object.freeze([
  "worker",
  "migrations",
  "drizzle",
  "scripts/local-backend.mjs",
  "scripts/local-migrations.mjs",
]);

async function collectFiles(entry, output) {
  const details = await lstat(entry);
  if (!details.isDirectory()) {
    output.push(entry);
    return;
  }

  const children = await readdir(entry, { withFileTypes: true });
  await Promise.all(children.map(async (child) => {
    const childPath = path.join(entry, child.name);
    if (child.isDirectory()) await collectFiles(childPath, output);
    else if (child.isFile()) output.push(childPath);
  }));
}

export async function localBackendVersion(projectRoot, relativePaths = LOCAL_BACKEND_WATCH_PATHS) {
  const files = [];
  for (const relativePath of relativePaths) {
    await collectFiles(path.join(projectRoot, relativePath), files);
  }
  files.sort((left, right) => left.localeCompare(right));

  const digest = createHash("sha256");
  for (const file of files) {
    digest.update(path.relative(projectRoot, file));
    digest.update("\0");
    digest.update(await readFile(file));
    digest.update("\0");
  }
  return `local-${digest.digest("hex").slice(0, 12)}`;
}

function ignoredFilename(filename) {
  if (!filename) return false;
  const name = String(filename);
  return name === ".DS_Store" || name.endsWith("~") || name.endsWith(".swp") || name.endsWith(".tmp");
}

export function watchLocalBackendSources({
  projectRoot,
  onChange,
  onError = (error) => console.error(error),
  relativePaths = LOCAL_BACKEND_WATCH_PATHS,
  debounceMs = 160,
  watchImplementation = watchFileSystem,
}) {
  const watchers = [];
  const pendingPaths = new Set();
  let timer = null;
  let closed = false;

  const flush = () => {
    timer = null;
    if (closed || pendingPaths.size === 0) return;
    const changedPaths = [...pendingPaths].sort();
    pendingPaths.clear();
    Promise.resolve(onChange(changedPaths)).catch(onError);
  };

  const schedule = (changedPath) => {
    if (closed) return;
    pendingPaths.add(changedPath);
    if (timer) clearTimeout(timer);
    timer = setTimeout(flush, debounceMs);
  };

  for (const relativePath of relativePaths) {
    const absolutePath = path.join(projectRoot, relativePath);
    const recursive = !path.extname(absolutePath);
    const watcher = watchImplementation(absolutePath, { recursive }, (_eventType, filename) => {
      if (ignoredFilename(filename)) return;
      schedule(filename && recursive ? path.join(relativePath, String(filename)) : relativePath);
    });
    if (typeof watcher.on === "function") watcher.on("error", onError);
    watchers.push(watcher);
  }

  return {
    close() {
      if (closed) return;
      closed = true;
      if (timer) clearTimeout(timer);
      pendingPaths.clear();
      for (const watcher of watchers) watcher.close();
    },
  };
}
