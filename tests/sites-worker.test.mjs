import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";
import worker from "../worker/index.js";

test("serves existing static assets without a fallback", async () => {
  const calls = [];
  const response = await worker.fetch(new Request("https://example.test/assets/app.js"), {
    ASSETS: {
      fetch: async (request) => {
        calls.push(new URL(request.url).pathname);
        return new Response("asset", { status: 200 });
      },
    },
  });

  assert.equal(response.status, 200);
  assert.deepEqual(calls, ["/assets/app.js"]);
});

test("falls back to index.html for an unknown app route", async () => {
  const calls = [];
  const response = await worker.fetch(
    new Request("https://example.test/flow/step-two?source=share", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async (request) => {
          const url = new URL(request.url);
          calls.push(url.pathname + url.search);
          return new Response(url.pathname === "/index.html" ? "app" : "missing", {
            status: url.pathname === "/index.html" ? 200 : 404,
          });
        },
      },
    },
  );

  assert.equal(response.status, 200);
  assert.deepEqual(calls, ["/flow/step-two?source=share", "/index.html"]);
});

test("does not turn API or write requests into the app shell", async () => {
  let apiAssetCalls = 0;
  const apiResponse = await worker.fetch(
    new Request("https://example.test/api/missing", { headers: { accept: "application/json" } }),
    { ASSETS: { fetch: async () => { apiAssetCalls += 1; return new Response("missing", { status: 404 }); } } },
    { waitUntil() {} },
  );
  assert.equal(apiResponse.status, 401);
  assert.equal(apiAssetCalls, 0);
  assert.match(apiResponse.headers.get("content-security-policy"), /default-src 'self'/);

  let writeAssetCalls = 0;
  const writeResponse = await worker.fetch(
    new Request("https://example.test/flow", { method: "POST", headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => { writeAssetCalls += 1; return new Response("missing", { status: 404 }); } } },
  );
  assert.equal(writeResponse.status, 404);
  assert.equal(writeAssetCalls, 1);
});

test("does not expose localhost fixture routes in a deployed environment", async () => {
  const response = await worker.fetch(
    new Request("https://example.test/api/local-dev/state", { headers: { accept: "application/json" } }),
    { ASSETS: { fetch: async () => new Response("missing", { status: 404 }) } },
    { waitUntil() {} },
  );
  assert.equal(response.status, 404);
  assert.equal((await response.json()).error.code, "not_found");
});

test("serves the admin shell only to the configured operator", async () => {
  let assetCalls = 0;
  const assets = {
    fetch: async (request) => {
      assetCalls += 1;
      const pathname = new URL(request.url).pathname;
      return new Response(pathname === "/" ? "admin app" : "missing", { status: pathname === "/" ? 200 : 404 });
    },
  };
  const env = { ASSETS: assets, OPERATOR_CHATGPT_USER_ID: "operator-1" };

  let response = await worker.fetch(new Request("https://example.test/admin", { headers: { accept: "text/html" } }), env);
  assert.equal(response.status, 404);
  assert.equal(assetCalls, 0);

  response = await worker.fetch(new Request("https://example.test/admin", {
    headers: { accept: "text/html", "oai-authenticated-user-id": "someone-else" },
  }), env);
  assert.equal(response.status, 404);
  assert.equal(assetCalls, 0);

  response = await worker.fetch(new Request("https://example.test/admin", {
    headers: { accept: "text/html", "oai-authenticated-user-id": "operator-1" },
  }), env);
  assert.equal(response.status, 200);
  assert.equal(await response.text(), "admin app");
  assert.equal(assetCalls, 1);
});

test("emits the files required by Sites packaging", async () => {
  await access(new URL("../dist/client/index.html", import.meta.url));
  await access(new URL("../dist/server/index.js", import.meta.url));
  await access(new URL("../dist/server/lib/api.js", import.meta.url));
  await access(new URL("../dist/.openai/hosting.json", import.meta.url));
  await access(new URL("../drizzle/0001_initial.sql", import.meta.url));
  await access(new URL("../drizzle/0002_labels.sql", import.meta.url));
  await access(new URL("../drizzle/0003_label_outbox.sql", import.meta.url));
  await access(new URL("../drizzle/0004_feedback_telemetry.sql", import.meta.url));
  await access(new URL("../drizzle/0005_media_5mb.sql", import.meta.url));
  await access(new URL("../drizzle/meta/_journal.json", import.meta.url));

  const mediaMigration = await readFile(new URL("../drizzle/0005_media_5mb.sql", import.meta.url), "utf8");
  assert.match(mediaMigration, /byte_size BETWEEN 1 AND 5242880/);
  assert.match(mediaMigration, /PRAGMA defer_foreign_keys = ON/);
  assert.doesNotMatch(mediaMigration, /PRAGMA foreign_keys = OFF/);
});
