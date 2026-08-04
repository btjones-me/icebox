import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { MIRROR_HEADERS } from "../worker/lib/google-sheets.js";
import { inspectImage, mirrorPayload, prepareImageForStorage, validateHouseholdInput, validateItem, valuesForTesting } from "../worker/lib/api.js";
import { labelLimitReason, validateLabelSuggestion } from "../worker/lib/openai.js";
import { selectInventoryResults, sortInventory } from "../src/inventory-sort.ts";
import { itemInitials, itemThumbnailColour } from "../src/item-thumbnail.ts";
import { expiryUrgency } from "../src/expiry-urgency.ts";

test("household induction enforces structure limits", () => {
  assert.equal(validateHouseholdInput({ name: "Alder House", freezers: [{ name: "Kitchen", drawerCount: 8 }] }).freezers[0].drawerCount, 8);
  assert.throws(() => validateHouseholdInput({ name: "Alder", freezers: [] }), /one and six/);
  assert.throws(() => validateHouseholdInput({ name: "Alder", freezers: [{ drawerCount: 9 }] }), /one and eight/);
});

test("inventory validation requires bounded text and an ISO date", () => {
  const item = validateItem({ label: "Chicken curry", frozenOn: "2026-08-01", expiresOn: "2026-11-01", notes: "Two portions", freezerId: "f1", drawerId: "d1", version: 3 }, { expectedVersion: true });
  assert.equal(item.label, "Chicken curry");
  assert.equal(item.expiresOn, "2026-11-01");
  assert.throws(() => validateItem({ label: "", frozenOn: "2026-08-01", freezerId: "f1", drawerId: "d1" }), /Label is required/);
  assert.throws(() => validateItem({ label: "Meal", frozenOn: "tomorrow", freezerId: "f1", drawerId: "d1" }), /valid date/);
  assert.throws(() => validateItem({ label: "Meal", frozenOn: "2026-08-01", expiresOn: "later", freezerId: "f1", drawerId: "d1" }), /Expiry must be a valid date/);
});

test("mirror rows use the fixed schema and preserve formula-looking labels as data", () => {
  const context = {
    household_id: "h1", household_name: "Home", household_owner_email: "owner@example.com",
    freezer_id: "f1", freezer_name: "Kitchen", drawer_id: "d1", drawer_name: "Top", drawer_position: 1, image: null,
  };
  const payload = mirrorPayload({ id: "i1", version: 2, label: "=1+1", frozenOn: "2026-08-01", expiresOn: "2026-11-01", notes: "", createdAt: "2026-08-01T00:00:00.000Z", updatedAt: "2026-08-01T00:00:00.000Z", deletedAt: null }, context, "2026-08-01T00:00:01.000Z");
  const values = valuesForTesting(payload);
  assert.equal(values.length, 23);
  assert.equal(payload.schema_version, 3);
  assert.equal(values[MIRROR_HEADERS.indexOf("expires_on")], "2026-11-01");
  assert.equal(values[MIRROR_HEADERS.indexOf("label")], "=1+1");
  assert.equal(payload.status, "active");
});

test("label schema and every configured rate boundary fail closed", () => {
  assert.equal(validateLabelSuggestion({ label: "Vegetable soup", confidence: 0.8 }), true);
  assert.equal(validateLabelSuggestion({ label: "x".repeat(81), confidence: 0.8 }), false);
  assert.equal(validateLabelSuggestion({ label: "Soup", confidence: 1.1 }), false);
  const base = { userMinute: 0, userDay: 0, householdDay: 0, ipHour: 0, globalDay: 0, monthlyCost: 0, cap: 25_000_000 };
  assert.equal(labelLimitReason({ ...base, userMinute: 5 }), "user_minute");
  assert.equal(labelLimitReason({ ...base, userDay: 25 }), "user_day");
  assert.equal(labelLimitReason({ ...base, householdDay: 100 }), "household_day");
  assert.equal(labelLimitReason({ ...base, ipHour: 30 }), "ip_hour");
  assert.equal(labelLimitReason({ ...base, globalDay: 500 }), "global_day");
  assert.equal(labelLimitReason({ ...base, monthlyCost: 24_960_000 }), "monthly_budget");
});

test("Google writes explicitly use raw-value mode", async () => {
  const source = await readFile(new URL("../worker/lib/google-sheets.js", import.meta.url), "utf8");
  assert.match(source, /valueInputOption=RAW/);
  assert.doesNotMatch(source, /valueInputOption=USER_ENTERED/);
});

test("PWA navigation bypasses stale HTTP caches during upgrades", async () => {
  const source = await readFile(new URL("../public/sw.js", import.meta.url), "utf8");
  assert.match(source, /icebox-shell-v4/);
  assert.match(source, /new Request\(request, \{ cache: "no-store" \}\)/);
  assert.match(source, /const copy = response\.clone\(\);[\s\S]*cache\.put\(request, copy\)/);
  assert.doesNotMatch(source, /cache\.put\(request, response\.clone\(\)\)/);
  assert.match(source, /url\.pathname === "\/signin-with-chatgpt"/);
  assert.match(source, /url\.pathname === "\/signout-with-chatgpt"/);
  assert.match(source, /url\.pathname === "\/callback"/);
});

test("inventory sorts by expiry, alphabetically, and newest added", () => {
  const items = [
    { label: "Ziti", expiresOn: undefined, createdAt: "2026-08-03T00:00:00.000Z" },
    { label: "Apples", expiresOn: "2026-09-01", createdAt: "2026-08-01T00:00:00.000Z" },
    { label: "Curry", expiresOn: "2026-08-15", createdAt: "2026-08-02T00:00:00.000Z" },
    { label: "Bread", expiresOn: undefined, createdAt: "2026-07-30T00:00:00.000Z" },
  ];
  assert.deepEqual(sortInventory(items, "expiry").map((item) => item.label), ["Curry", "Apples", "Bread", "Ziti"]);
  assert.deepEqual(sortInventory(items, "alphabetical").map((item) => item.label), ["Apples", "Bread", "Curry", "Ziti"]);
  assert.deepEqual(sortInventory(items, "added").map((item) => item.label), ["Ziti", "Curry", "Apples", "Bread"]);
});

test("expiry urgency increases through the final seven local calendar days", () => {
  const now = new Date(2026, 7, 4, 12, 0, 0);
  assert.equal(expiryUrgency(null, now), null);
  assert.equal(expiryUrgency("2026-08-12", now), null);
  assert.deepEqual(expiryUrgency("2026-08-11", now), { daysRemaining: 7, level: 7, warning: false });
  assert.deepEqual(expiryUrgency("2026-08-05", now), { daysRemaining: 1, level: 1, warning: false });
  assert.deepEqual(expiryUrgency("2026-08-04", now), { daysRemaining: 0, level: 0, warning: true });
  assert.deepEqual(expiryUrgency("2026-08-03", now), { daysRemaining: -1, level: 0, warning: true });
});

test("inventory result views scope the household, filter search, and preserve default ordering", () => {
  const items = [
    { id: "1", freezerId: "kitchen", label: "Soup", notes: "tomato", expiresOn: "2026-08-20", createdAt: "2026-08-01T10:00:00.000Z" },
    { id: "2", freezerId: "garage", label: "Bread", notes: "sliced", expiresOn: null, createdAt: "2026-08-03T10:00:00.000Z" },
    { id: "3", freezerId: "other-house", label: "Private curry", notes: "hidden", expiresOn: "2026-08-10", createdAt: "2026-08-04T10:00:00.000Z" },
    { id: "4", freezerId: "kitchen", label: "Curry", notes: "tomato", expiresOn: "2026-08-12", createdAt: "2026-08-02T10:00:00.000Z" },
  ];

  assert.deepEqual(
    selectInventoryResults(items, ["kitchen", "garage"], "", "default").map((item) => item.label),
    ["Bread", "Curry", "Soup"],
  );
  assert.deepEqual(
    selectInventoryResults(items, ["kitchen", "garage"], "", "expiry").map((item) => item.label),
    ["Curry", "Soup", "Bread"],
  );
  assert.deepEqual(
    selectInventoryResults(items, ["kitchen", "garage"], "tomato", "alphabetical").map((item) => item.label),
    ["Curry", "Soup"],
  );
});

test("item thumbnails derive useful initials and stable colours", () => {
  assert.equal(itemInitials("Chicken curry"), "CC");
  assert.equal(itemInitials("CHICKEN curry"), "CH");
  assert.equal(itemInitials("lasagne portions"), "LP");
  assert.equal(itemInitials("Peas"), "P");
  assert.equal(itemInitials(""), "?");
  assert.equal(itemThumbnailColour("item-soup"), itemThumbnailColour("item-soup"));
  assert.notEqual(itemThumbnailColour("item-soup"), itemThumbnailColour("item-curry"));
});

test("image inspection reads dimensions and rejects embedded metadata", () => {
  const clean = new Uint8Array(24);
  clean.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  new DataView(clean.buffer).setUint32(16, 800);
  new DataView(clean.buffer).setUint32(20, 600);
  assert.deepEqual(inspectImage(clean), { mimeType: "image/png", width: 800, height: 600, metadata: false });

  const tagged = new Uint8Array(36);
  tagged.set(clean);
  tagged.set([0, 0, 0, 0, 0x65, 0x58, 0x49, 0x66], 8);
  assert.equal(inspectImage(tagged).metadata, true);

  const colourManagedWebp = new Uint8Array(38);
  colourManagedWebp.set([..."RIFF"].map((character) => character.charCodeAt(0)), 0);
  colourManagedWebp.set([..."WEBPVP8X"].map((character) => character.charCodeAt(0)), 8);
  new DataView(colourManagedWebp.buffer).setUint32(16, 10, true);
  colourManagedWebp[24] = 255;
  colourManagedWebp[27] = 255;
  colourManagedWebp.set([..."ICCP"].map((character) => character.charCodeAt(0)), 30);
  assert.deepEqual(inspectImage(colourManagedWebp), { mimeType: "image/webp", width: 256, height: 256, metadata: false });
});

test("Safari-style JPEG metadata is stripped without losing image dimensions", () => {
  const jpeg = new Uint8Array([
    0xff, 0xd8,
    0xff, 0xe1, 0x00, 0x08, 0x45, 0x78, 0x69, 0x66, 0x00, 0x00,
    0xff, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x02, 0x58, 0x03, 0x20, 0x03,
    0x01, 0x11, 0x00, 0x02, 0x11, 0x00, 0x03, 0x11, 0x00,
    0xff, 0xda, 0x00, 0x0c, 0x03, 0x01, 0x00, 0x02, 0x11, 0x03, 0x11, 0x00, 0x3f, 0x00,
    0x00, 0xff, 0xd9,
  ]);

  assert.deepEqual(inspectImage(jpeg), { mimeType: "image/jpeg", width: 800, height: 600, metadata: true });
  const prepared = prepareImageForStorage(jpeg);
  assert.deepEqual(prepared.inspection, { mimeType: "image/jpeg", width: 800, height: 600, metadata: false });
  assert.equal(Buffer.from(prepared.bytes).includes(Buffer.from("Exif")), false);
  assert.equal(prepared.bytes.length < jpeg.length, true);
});
