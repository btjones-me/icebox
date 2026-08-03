import { HttpError, json, nowIso } from "./http.js";
import { LOCAL_IDENTITY } from "./local-mode.js";

const DEMO_HOUSEHOLD_ID = "house-alder";

const freezers = [
  { id: "freezer-kitchen", name: "Kitchen Freezer", position: 1 },
  { id: "freezer-garage", name: "Garage Freezer", position: 2 },
];

const drawers = [
  { id: "drawer-top", freezerId: "freezer-kitchen", name: "Top Drawer", position: 1 },
  { id: "drawer-upper", freezerId: "freezer-kitchen", name: "Upper Drawer", position: 2 },
  { id: "drawer-middle", freezerId: "freezer-kitchen", name: "Middle Drawer", position: 3 },
  { id: "drawer-lower", freezerId: "freezer-kitchen", name: "Lower Drawer", position: 4 },
  { id: "drawer-bottom", freezerId: "freezer-kitchen", name: "Bottom Drawer", position: 5 },
  { id: "garage-one", freezerId: "freezer-garage", name: "Drawer 1", position: 1 },
  { id: "garage-two", freezerId: "freezer-garage", name: "Drawer 2", position: 2 },
  { id: "garage-three", freezerId: "freezer-garage", name: "Drawer 3", position: 3 },
];

const items = [
  ["item-curry", "drawer-middle", "Chicken curry", "2026-07-28", "2026-10-15", "Two generous portions. Defrost overnight and reheat until piping hot.", "2026-07-28T18:30:00.000Z"],
  ["item-bread", "drawer-middle", "Sourdough loaf", "2026-07-25", "2026-09-10", "Pre-sliced. Toast from frozen.", "2026-07-25T09:15:00.000Z"],
  ["item-peas", "drawer-middle", "Peas", "2026-07-20", null, "Half a bag remaining.", "2026-07-20T17:00:00.000Z"],
  ["item-stock", "drawer-middle", "Vegetable stock", "2026-07-18", "2026-08-20", "About 500ml, unsalted.", "2026-07-18T13:45:00.000Z"],
  ["item-lasagne", "drawer-middle", "Lasagne portions", "2026-07-15", "2026-12-01", "Two portions in separate containers.", "2026-07-15T19:20:00.000Z"],
  ["item-blueberries", "drawer-middle", "Blueberries", "2026-07-12", null, "Use from frozen in porridge or smoothies.", "2026-07-12T11:00:00.000Z"],
  ["item-soup", "drawer-top", "Tomato soup", "2026-07-30", "2026-08-12", "One lunch portion.", "2026-07-30T12:10:00.000Z"],
  ["item-burgers", "drawer-lower", "Bean burgers", "2026-07-11", null, "Four burgers, cook from frozen.", "2026-07-11T16:40:00.000Z"],
];

function requireMethod(request, method) {
  if (request.method !== method) throw new HttpError(405, "method_not_allowed", "Method not allowed");
}

async function clearMedia(bucket) {
  let cursor;
  do {
    const page = await bucket.list({ cursor, limit: 1000 });
    const keys = page.objects.map((object) => object.key);
    if (keys.length) await bucket.delete(keys);
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
}

async function clearDatabase(env) {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM app_events"),
    env.DB.prepare("DELETE FROM feedback_reports"),
    env.DB.prepare("DELETE FROM ai_usage_events"),
    env.DB.prepare("DELETE FROM sheet_outbox"),
    env.DB.prepare("DELETE FROM sheet_row_map"),
    env.DB.prepare("DELETE FROM items"),
    env.DB.prepare("DELETE FROM media"),
    env.DB.prepare("DELETE FROM drawers"),
    env.DB.prepare("DELETE FROM freezers"),
    env.DB.prepare("DELETE FROM household_invitations"),
    env.DB.prepare("DELETE FROM household_members"),
    env.DB.prepare("DELETE FROM households"),
    env.DB.prepare("DELETE FROM users"),
    env.DB.prepare("DELETE FROM pilot_allowlist"),
    env.DB.prepare("UPDATE sheet_sync_state SET last_attempt_at = NULL, last_success_at = NULL, last_reconcile_at = NULL, last_error_code = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = 1"),
  ]);
  await clearMedia(env.MEDIA);
}

async function seedIdentity(env, { withUser }) {
  const now = nowIso();
  const statements = [
    env.DB.prepare("INSERT INTO pilot_allowlist (email_normalized, created_at, added_by_user_id) VALUES (?, ?, NULL)")
      .bind(LOCAL_IDENTITY.emailNormalized, now),
  ];
  if (withUser) {
    statements.push(
      env.DB.prepare(
        `INSERT INTO users
          (id, email, email_normalized, full_name, ai_label_enabled, default_household_id, created_at, updated_at, last_seen_at)
         VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?)`,
      ).bind(LOCAL_IDENTITY.id, LOCAL_IDENTITY.email, LOCAL_IDENTITY.emailNormalized, LOCAL_IDENTITY.fullName, DEMO_HOUSEHOLD_ID, now, now, now),
    );
  }
  await env.DB.batch(statements);
}

async function seedHousehold(env, includeItems) {
  const now = nowIso();
  const statements = [
    env.DB.prepare("INSERT INTO households (id, name, owner_user_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
      .bind(DEMO_HOUSEHOLD_ID, "Alder House", LOCAL_IDENTITY.id, now, now),
    env.DB.prepare("INSERT INTO household_members (household_id, user_id, joined_at) VALUES (?, ?, ?)")
      .bind(DEMO_HOUSEHOLD_ID, LOCAL_IDENTITY.id, now),
  ];
  for (const freezer of freezers) {
    statements.push(
      env.DB.prepare("INSERT INTO freezers (id, household_id, name, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
        .bind(freezer.id, DEMO_HOUSEHOLD_ID, freezer.name, freezer.position, now, now),
    );
  }
  for (const drawer of drawers) {
    statements.push(
      env.DB.prepare("INSERT INTO drawers (id, freezer_id, name, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
        .bind(drawer.id, drawer.freezerId, drawer.name, drawer.position, now, now),
    );
  }
  if (includeItems) {
    const freezerByDrawer = new Map(drawers.map((drawer) => [drawer.id, drawer.freezerId]));
    for (const [id, drawerId, label, frozenOn, expiresOn, notes, createdAt] of items) {
      statements.push(
        env.DB.prepare(
          `INSERT INTO items
            (id, household_id, freezer_id, drawer_id, label, frozen_on, expires_on, notes, image_id,
             version, created_by_user_id, updated_by_user_id, created_at, updated_at, deleted_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, 1, ?, ?, ?, ?, NULL)`,
        ).bind(id, DEMO_HOUSEHOLD_ID, freezerByDrawer.get(drawerId), drawerId, label, frozenOn, expiresOn, notes, LOCAL_IDENTITY.id, LOCAL_IDENTITY.id, createdAt, createdAt),
      );
    }
  }
  await env.DB.batch(statements);
}

async function state(env) {
  const counts = await env.DB.prepare(
    `SELECT
      (SELECT COUNT(*) FROM users) AS users,
      (SELECT COUNT(*) FROM households WHERE deleted_at IS NULL) AS households,
      (SELECT COUNT(*) FROM freezers) AS freezers,
      (SELECT COUNT(*) FROM drawers) AS drawers,
      (SELECT COUNT(*) FROM items WHERE deleted_at IS NULL) AS items,
      (SELECT COUNT(*) FROM media WHERE deleted_at IS NULL) AS images,
      (SELECT COUNT(*) FROM ai_usage_events) AS aiCalls,
      (SELECT COUNT(*) FROM feedback_reports) AS feedback,
      (SELECT COUNT(*) FROM app_events) AS events`,
  ).first();
  const householdCount = Number(counts?.households || 0);
  const itemCount = Number(counts?.items || 0);
  return {
    fixture: householdCount === 0 ? "onboarding" : itemCount === 0 ? "empty-household" : "demo-inventory",
    counts: Object.fromEntries(Object.entries(counts || {}).map(([key, value]) => [key, Number(value || 0)])),
    openaiConfigured: Boolean(env.OPENAI_API_KEY),
    // The supervisor verifies this fingerprint before exposing the frontend as ready.
    workerVersion: env.LOCAL_WORKER_VERSION || "local-unversioned",
    identity: { email: LOCAL_IDENTITY.email, fullName: LOCAL_IDENTITY.fullName },
  };
}

export async function routeLocalDev(request, env, action) {
  if (action === "state") {
    requireMethod(request, "GET");
    return json(await state(env));
  }
  if (!["demo", "empty", "fresh"].includes(action)) {
    throw new HttpError(404, "not_found", "Local fixture route not found");
  }
  requireMethod(request, "POST");
  await clearDatabase(env);
  await seedIdentity(env, { withUser: action !== "fresh" });
  if (action !== "fresh") await seedHousehold(env, action === "demo");
  return json(await state(env));
}
