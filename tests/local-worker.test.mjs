import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { Miniflare } from "miniflare";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngWithAncillaryPayload(payloadBytes) {
  const source = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl9sAAAAASUVORK5CYII=", "base64");
  const iendOffset = source.length - 12;
  const chunkType = Buffer.from("fiLl");
  const chunkData = Buffer.alloc(payloadBytes, 0x5a);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(chunkData.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([chunkType, chunkData])));
  return Buffer.concat([source.subarray(0, iendOffset), length, chunkType, chunkData, checksum, source.subarray(iendOffset)]);
}

function imageMultipart(image, householdId = "house-alder") {
  const boundary = "----icebox-image-test-boundary";
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="householdId"\r\n\r\n${householdId}\r\n`),
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="image"; filename="large.png"\r\nContent-Type: image/png\r\n\r\n`),
    image,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  return { body, contentType: `multipart/form-data; boundary=${boundary}` };
}

function feedbackMultipart(payload, image) {
  const boundary = "----icebox-feedback-test-boundary";
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="payload"\r\n\r\n${JSON.stringify(payload)}\r\n`),
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="photo"; filename="feedback.png"\r\nContent-Type: image/png\r\n\r\n`),
    image,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  return { body, contentType: `multipart/form-data; boundary=${boundary}` };
}

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

  const acceptedImage = pngWithAncillaryPayload(3 * 1024 * 1024);
  const acceptedUpload = imageMultipart(acceptedImage);
  response = await miniflare.dispatchFetch("http://127.0.0.1/api/media", {
    method: "POST",
    headers: { origin: "http://127.0.0.1:4173", "content-type": acceptedUpload.contentType },
    body: acceptedUpload.body,
  });
  assert.equal(response.status, 201, await response.clone().text());
  const acceptedMedia = await response.json();
  assert.match(acceptedMedia.url, /^\/api\/media\//);

  const rejectedImage = pngWithAncillaryPayload(5 * 1024 * 1024);
  const rejectedUpload = imageMultipart(rejectedImage);
  response = await miniflare.dispatchFetch("http://127.0.0.1/api/media", {
    method: "POST",
    headers: { origin: "http://127.0.0.1:4173", "content-type": rejectedUpload.contentType },
    body: rejectedUpload.body,
  });
  assert.equal(response.status, 413);
  assert.equal((await response.json()).error.code, "image_too_large");

  const oldEventId = "event-older-than-retention";
  const database = await miniflare.getD1Database("DB");
  await database.prepare(
    `INSERT INTO app_events
      (id, user_id, household_id, session_id, client_request_id, event_type, level, route, method,
       status_code, duration_ms, metadata_json, occurred_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    oldEventId, "local-alex", "house-alder", "old-session", null, "old_event", "info", "/api/old", "GET",
    200, 10, "{}", "2026-05-01T00:00:00.000Z", "2026-05-01T00:00:00.000Z",
  ).run();

  response = await miniflare.dispatchFetch("http://127.0.0.1/api/telemetry", {
    method: "POST",
    headers: { origin: "http://127.0.0.1:4173", "content-type": "application/json" },
    body: JSON.stringify({
      sessionId: "session-feedback-test",
      householdId: "house-alder",
      events: [{
        id: "client-event-1", type: "api_request", level: "warn", occurredAt: new Date().toISOString(),
        metadata: { requestId: "request-1", route: "/api/items/:id", method: "PATCH", status: 409, durationMs: 42, inventoryLabel: "Must not persist" },
      }],
    }),
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { accepted: 1 });
  assert.equal(await database.prepare("SELECT id FROM app_events WHERE id = ?").bind(oldEventId).first(), null);
  const storedEvent = await database.prepare("SELECT metadata_json FROM app_events WHERE id = 'client-event-1'").first();
  assert.equal(storedEvent.metadata_json.includes("Must not persist"), false);

  response = await miniflare.dispatchFetch("http://127.0.0.1/api/feedback", {
    method: "POST",
    headers: {
      origin: "http://127.0.0.1:4173",
      "content-type": "application/json",
      "x-icebox-request-id": "feedback-request-1",
    },
    body: JSON.stringify({
      sessionId: "session-feedback-test",
      householdId: "house-alder",
      message: "The sort menu was difficult to reach.",
      context: { displayMode: "standalone", viewport: { width: 390, height: 430 }, notes: "Must not persist" },
      recentEvents: [{
        id: "feedback-recent-1", type: "client_error", level: "error", occurredAt: new Date().toISOString(),
        metadata: { message: "TypeError", route: "/", caption: "Must not persist" },
      }],
    }),
  });
  const feedbackResult = await response.json();
  assert.equal(response.status, 201);
  assert.match(feedbackResult.reference, /^ICE-[A-F0-9]{8}$/);

  const feedbackPhoto = pngWithAncillaryPayload(64);
  const photoFeedbackUpload = feedbackMultipart({
    sessionId: "session-feedback-test",
    householdId: "house-alder",
    message: "The date controls overlapped on my iPhone.",
    context: { displayMode: "browser", viewport: { width: 344, height: 608 } },
    recentEvents: [],
  }, feedbackPhoto);
  response = await miniflare.dispatchFetch("http://127.0.0.1/api/feedback", {
    method: "POST",
    headers: {
      origin: "http://127.0.0.1:4173",
      "content-type": photoFeedbackUpload.contentType,
      "x-icebox-request-id": "feedback-request-2",
    },
    body: photoFeedbackUpload.body,
  });
  const photoFeedbackResult = await response.json();
  assert.equal(response.status, 201);
  assert.equal(photoFeedbackResult.attachment, true);

  response = await miniflare.dispatchFetch("http://127.0.0.1/api/operator/admin/households");
  const diagnosticsOverview = await response.json();
  assert.equal(diagnosticsOverview.totals.feedback, 2);
  assert.equal(diagnosticsOverview.feedback.find((entry) => entry.id === photoFeedbackResult.id).attachmentCount, 1);
  assert.equal(JSON.stringify(diagnosticsOverview.feedback[0]).includes("Must not persist"), false);

  response = await miniflare.dispatchFetch(`http://127.0.0.1/api/operator/admin/feedback/${photoFeedbackResult.id}/export`);
  const diagnosticsBundle = await response.json();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-disposition"), /icebox-ice-/);
  assert.equal(diagnosticsBundle.schemaVersion, 2);
  assert.equal(diagnosticsBundle.feedback.reference, photoFeedbackResult.reference);
  assert.equal(diagnosticsBundle.feedback.attachments.length, 1);
  assert.equal(diagnosticsBundle.feedback.attachments[0].encoding, "base64");
  assert.equal(diagnosticsBundle.feedback.attachments[0].mimeType, "image/png");
  assert.deepEqual(Buffer.from(diagnosticsBundle.feedback.attachments[0].dataBase64, "base64"), feedbackPhoto);
  assert.equal(diagnosticsBundle.storedSessionEvents.some((event) => event.clientRequestId === "request-1"), true);
  assert.equal(JSON.stringify(diagnosticsBundle).includes("Must not persist"), false);

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

  response = await miniflare.dispatchFetch("http://127.0.0.1/api/local-dev/demo", {
    method: "POST",
    headers: { origin: "http://127.0.0.1:4174" },
  });
  assert.equal(response.status, 200);

  response = await miniflare.dispatchFetch("http://127.0.0.1/api/operator/admin/households");
  const adminOverview = await response.json();
  assert.equal(response.status, 200);
  assert.equal(adminOverview.totals.activeHouseholds, 1);
  assert.equal(adminOverview.totals.activeItems, 8);
  assert.equal(adminOverview.households[0].name, "Alder House");

  response = await miniflare.dispatchFetch("http://127.0.0.1/api/operator/admin/households/house-alder", {
    method: "PATCH",
    headers: { origin: "http://127.0.0.1:4173", "content-type": "application/json" },
    body: JSON.stringify({ name: "Renamed House" }),
  });
  assert.equal(response.status, 200);

  response = await miniflare.dispatchFetch("http://127.0.0.1/api/operator/admin/households/house-alder/reset", {
    method: "POST",
    headers: { origin: "http://127.0.0.1:4173", "content-type": "application/json" },
    body: JSON.stringify({ confirmName: "Wrong name" }),
  });
  assert.equal(response.status, 400);

  response = await miniflare.dispatchFetch("http://127.0.0.1/api/operator/admin/households/house-alder/reset", {
    method: "POST",
    headers: { origin: "http://127.0.0.1:4173", "content-type": "application/json" },
    body: JSON.stringify({ confirmName: "Renamed House" }),
  });
  const resetResult = await response.json();
  assert.equal(response.status, 200);
  assert.equal(resetResult.itemsReset, 8);

  response = await miniflare.dispatchFetch("http://127.0.0.1/api/bootstrap");
  const resetBootstrap = await response.json();
  assert.equal(resetBootstrap.households[0].name, "Renamed House");
  assert.equal(resetBootstrap.items.length, 0);
  assert.equal(resetBootstrap.freezers.length, 2);
  assert.equal(resetBootstrap.drawers.length, 8);

  response = await miniflare.dispatchFetch("http://127.0.0.1/api/operator/admin/households/house-alder", {
    method: "DELETE",
    headers: { origin: "http://127.0.0.1:4173", "content-type": "application/json" },
    body: JSON.stringify({ confirmName: "Renamed House" }),
  });
  assert.equal(response.status, 200);

  response = await miniflare.dispatchFetch("http://127.0.0.1/api/bootstrap");
  const archivedBootstrap = await response.json();
  assert.equal(archivedBootstrap.households.length, 0);
  assert.equal(archivedBootstrap.items.length, 0);
});
