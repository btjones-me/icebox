import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { Miniflare } from "miniflare";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("local Worker supports onboarding, induction, and demo fixture resets", async (context) => {
  const miniflare = new Miniflare({
    host: "127.0.0.1",
    port: 0,
    rootPath: projectRoot,
    scriptPath: "worker/index.js",
    modules: true,
    modulesRules: [{ type: "ESModule", include: ["**/*.js"] }],
    compatibilityDate: "2026-08-01",
    bindings: {
      LOCAL_DEV_MODE: "1",
      OPENAI_API_KEY: "",
      PILOT_ALLOWED_EMAILS: "alex@example.com",
      OPERATOR_CHATGPT_USER_ID: "local-alex",
    },
    d1Databases: { DB: "icebox-test" },
    r2Buckets: { MEDIA: "icebox-test-media" },
    d1Persist: false,
    r2Persist: false,
  });
  context.after(() => miniflare.dispose());

  let response = await miniflare.dispatchFetch("http://127.0.0.1/api/local-dev/fresh", {
    method: "POST",
    headers: { origin: "http://127.0.0.1:4174" },
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).fixture, "onboarding");

  response = await miniflare.dispatchFetch("http://127.0.0.1/api/bootstrap");
  const onboarding = await response.json();
  assert.equal(response.status, 200);
  assert.equal(onboarding.needsOnboarding, true);
  assert.deepEqual(onboarding.households, []);

  response = await miniflare.dispatchFetch("http://127.0.0.1/api/households", {
    method: "POST",
    headers: { origin: "http://127.0.0.1:4173", "content-type": "application/json" },
    body: JSON.stringify({ name: "Test House", freezers: [{ name: "Kitchen", drawerCount: 2 }] }),
  });
  assert.equal(response.status, 201);
  const testHousehold = await response.json();
  assert.equal(testHousehold.drawers.length, 2);

  response = await miniflare.dispatchFetch(`http://127.0.0.1/api/households/${testHousehold.household.id}/freezers`, {
    method: "POST",
    headers: { origin: "http://127.0.0.1:4173", "content-type": "application/json" },
    body: JSON.stringify({ name: "Garage", drawerNames: ["Upper basket", "Lower basket"] }),
  });
  const addedFreezer = await response.json();
  assert.equal(response.status, 201);
  assert.equal(addedFreezer.freezer.name, "Garage");
  assert.deepEqual(addedFreezer.drawers.map((drawer) => drawer.name), ["Upper basket", "Lower basket"]);

  response = await miniflare.dispatchFetch(`http://127.0.0.1/api/drawers/${addedFreezer.drawers[1].id}`, {
    method: "DELETE",
    headers: { origin: "http://127.0.0.1:4173" },
  });
  assert.equal(response.status, 200);

  response = await miniflare.dispatchFetch(`http://127.0.0.1/api/drawers/${addedFreezer.drawers[0].id}`, {
    method: "DELETE",
    headers: { origin: "http://127.0.0.1:4173" },
  });
  assert.equal(response.status, 409);

  response = await miniflare.dispatchFetch("http://127.0.0.1/api/local-dev/empty", {
    method: "POST",
    headers: { origin: "http://127.0.0.1:4174" },
  });
  const emptyState = await response.json();
  assert.equal(response.status, 200);
  assert.equal(emptyState.fixture, "empty-household");
  assert.equal(emptyState.counts.items, 0);
  assert.equal(emptyState.counts.drawers, 8);

  response = await miniflare.dispatchFetch("http://127.0.0.1/api/items", {
    method: "POST",
    headers: { origin: "http://127.0.0.1:4173", "content-type": "application/json" },
    body: JSON.stringify({
      label: "Test meal",
      frozenOn: "2026-08-01",
      expiresOn: "2026-09-01",
      freezerId: "freezer-kitchen",
      drawerId: "drawer-top",
      notes: "",
      imageId: null,
    }),
  });
  const createdItem = await response.json();
  assert.equal(response.status, 201);
  assert.equal(createdItem.item.label, "Test meal");
  assert.equal(createdItem.item.expiresOn, "2026-09-01");
  assert.equal("caption" in createdItem.item, false);

  response = await miniflare.dispatchFetch(`http://127.0.0.1/api/items/${createdItem.item.id}`, {
    method: "PATCH",
    headers: { origin: "http://127.0.0.1:4173", "content-type": "application/json" },
    body: JSON.stringify({
      label: "Updated test meal",
      frozenOn: "2026-08-01",
      expiresOn: "2026-08-15",
      freezerId: "freezer-kitchen",
      drawerId: "drawer-upper",
      notes: "Two portions",
      imageId: null,
      version: createdItem.item.version,
    }),
  });
  const updatedItem = await response.json();
  assert.equal(response.status, 200);
  assert.equal(updatedItem.item.version, 2);
  assert.equal(updatedItem.item.drawerId, "drawer-upper");
  assert.equal(updatedItem.item.expiresOn, "2026-08-15");

  response = await miniflare.dispatchFetch(`http://127.0.0.1/api/items/${createdItem.item.id}`, {
    method: "DELETE",
    headers: { origin: "http://127.0.0.1:4173", "if-match": String(updatedItem.item.version) },
  });
  assert.equal(response.status, 200);

  response = await miniflare.dispatchFetch("http://127.0.0.1/api/bootstrap");
  const afterDelete = await response.json();
  assert.equal(afterDelete.items.some((item) => item.id === createdItem.item.id), false);

  response = await miniflare.dispatchFetch("http://127.0.0.1/api/local-dev/demo", {
    method: "POST",
    headers: { origin: "http://127.0.0.1:4174" },
  });
  const demoState = await response.json();
  assert.equal(response.status, 200);
  assert.equal(demoState.fixture, "demo-inventory");
  assert.deepEqual(
    { households: demoState.counts.households, freezers: demoState.counts.freezers, drawers: demoState.counts.drawers, items: demoState.counts.items },
    { households: 1, freezers: 2, drawers: 8, items: 8 },
  );

  response = await miniflare.dispatchFetch("http://127.0.0.1/api/bootstrap");
  const demo = await response.json();
  assert.equal(demo.user.id, "local-alex");
  assert.equal(demo.households[0].name, "Alder House");
  assert.equal(demo.items.length, 8);
  assert.equal(demo.items[0].label.length > 0, true);
  assert.equal("caption" in demo.items[0], false);

  response = await miniflare.dispatchFetch("http://127.0.0.1/api/freezers/freezer-garage", {
    method: "DELETE",
    headers: { origin: "http://127.0.0.1:4173" },
  });
  assert.equal(response.status, 200);

  response = await miniflare.dispatchFetch("http://127.0.0.1/api/freezers/freezer-kitchen", {
    method: "DELETE",
    headers: { origin: "http://127.0.0.1:4173" },
  });
  assert.equal(response.status, 409);
});
