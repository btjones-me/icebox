import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { localBackendVersion, watchLocalBackendSources } from "../scripts/local-dev-watch.mjs";

test("local backend versions are stable and change with watched source", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "icebox-local-version-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  await Promise.all([
    mkdir(path.join(root, "worker", "lib"), { recursive: true }),
    mkdir(path.join(root, "migrations"), { recursive: true }),
    mkdir(path.join(root, "drizzle"), { recursive: true }),
    mkdir(path.join(root, "scripts"), { recursive: true }),
  ]);
  await Promise.all([
    writeFile(path.join(root, "worker", "index.js"), "export default 1;\n"),
    writeFile(path.join(root, "worker", "lib", "api.js"), "export const api = 1;\n"),
    writeFile(path.join(root, "migrations", "0001.sql"), "CREATE TABLE test (id TEXT);\n"),
    writeFile(path.join(root, "drizzle", "0001.sql"), "CREATE TABLE test (id TEXT);\n"),
    writeFile(path.join(root, "scripts", "local-backend.mjs"), "export {};\n"),
    writeFile(path.join(root, "scripts", "local-migrations.mjs"), "export {};\n"),
  ]);

  const first = await localBackendVersion(root);
  assert.match(first, /^local-[a-f0-9]{12}$/);
  assert.equal(await localBackendVersion(root), first);

  await writeFile(path.join(root, "worker", "lib", "api.js"), "export const api = 2;\n");
  assert.notEqual(await localBackendVersion(root), first);
});

test("local backend watcher debounces source changes and closes every watch", async () => {
  const registrations = [];
  const closed = [];
  const changes = [];
  const watcher = watchLocalBackendSources({
    projectRoot: "/virtual/icebox",
    relativePaths: ["worker", "scripts/local-backend.mjs"],
    debounceMs: 5,
    watchImplementation(target, options, callback) {
      const registration = { target, options, callback };
      registrations.push(registration);
      return {
        on() {},
        close() { closed.push(target); },
      };
    },
    onChange(paths) { changes.push(paths); },
  });

  assert.equal(registrations[0].options.recursive, true);
  assert.equal(registrations[1].options.recursive, false);
  registrations[0].callback("change", "lib/api.js");
  registrations[0].callback("change", "lib/api.js");
  registrations[0].callback("change", "temporary.tmp");
  registrations[1].callback("change", "local-backend.mjs");
  await new Promise((resolve) => setTimeout(resolve, 25));

  assert.deepEqual(changes, [["scripts/local-backend.mjs", path.join("worker", "lib/api.js")]]);
  watcher.close();
  assert.equal(closed.length, 2);
});
