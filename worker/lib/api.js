import { authenticatedUser, requireAdmittedUser, requireMembership, requireOperator, requireOwner } from "./auth.js";
import { backupStatus, createHousehold, getItemForUser, listBootstrap, serializeItem, validateItemLocation } from "./db.js";
import { MIRROR_HEADERS, processSheetOutbox, reconcileSheet, verifySheetSchema } from "./google-sheets.js";
import {
  HttpError,
  assertOrigin,
  cleanText,
  isIsoDate,
  json,
  methodNotAllowed,
  normalizeEmail,
  nowIso,
  readJson,
  sha256Hex,
  uuid,
} from "./http.js";
import { generateLabel } from "./openai.js";
import { isLocalDevRequest } from "./local-mode.js";
import { routeLocalDev } from "./local-dev.js";
import { ensureSchema } from "./schema.js";

function only(request, methods) {
  if (!methods.includes(request.method)) throw Object.assign(new Error("method"), { allowed: methods });
}

function booleanValue(value, label) {
  if (typeof value !== "boolean") throw new HttpError(400, "validation_error", `${label} must be true or false`);
  return value;
}

const TELEMETRY_RETENTION_MS = 60 * 24 * 60 * 60 * 1000;
const TELEMETRY_LEVELS = new Set(["info", "warn", "error"]);
const EVENT_METADATA_KEYS = new Set([
  "requestId", "serverRequestId", "route", "method", "status", "durationMs", "code", "error", "message",
  "source", "line", "column", "stack", "sheet", "settingsView", "activeHouseholdId", "activeFreezerId",
  "openDrawerId", "sortMode", "searchActive", "offline", "online", "itemCount", "syncState",
  "pendingBackupCount", "reference", "recentEventCount", "bundle", "viewport", "displayMode", "language",
  "timezone", "platform", "userAgent",
]);
const FEEDBACK_CONTEXT_KEYS = new Set([
  "route", "bundle", "viewport", "displayMode", "online", "language", "timezone", "platform", "userAgent",
  "activeHouseholdId", "activeFreezerId", "openDrawerId", "sheet", "sortMode", "searchActive", "itemCount",
  "syncState", "pendingBackupCount",
]);

function optionalText(value, maxLength) {
  return String(value ?? "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .trim()
    .slice(0, maxLength) || null;
}

function sanitizedLogValue(value, depth = 0) {
  if (value == null) return null;
  if (depth > 3) return optionalText(value, 160);
  if (typeof value === "string") return optionalText(value, 500) || "";
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.slice(0, 20).map((entry) => sanitizedLogValue(entry, depth + 1));
  if (typeof value === "object") {
    return Object.fromEntries(Object.entries(value).slice(0, 30).map(([key, entry]) => [optionalText(key, 64) || "field", sanitizedLogValue(entry, depth + 1)]));
  }
  return optionalText(value, 160);
}

function allowlistedLogObject(value, allowedKeys) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => allowedKeys.has(key))
      .map(([key, entry]) => [key, sanitizedLogValue(entry)]),
  );
}

function validLogTimestamp(value, fallback) {
  const parsed = new Date(String(value || ""));
  if (Number.isNaN(parsed.getTime())) return fallback;
  const time = parsed.getTime();
  if (time < Date.now() - TELEMETRY_RETENTION_MS || time > Date.now() + 5 * 60 * 1000) return fallback;
  return parsed.toISOString();
}

function validateClientEvents(events, sessionId, now) {
  if (!Array.isArray(events)) throw new HttpError(400, "validation_error", "Events must be a list");
  return events.slice(0, 25).map((event) => {
    const metadata = allowlistedLogObject(event?.metadata, EVENT_METADATA_KEYS);
    const level = TELEMETRY_LEVELS.has(event?.level) ? event.level : "info";
    return {
      id: optionalText(event?.id, 80) || uuid(),
      sessionId,
      eventType: cleanText(event?.type || "client_event", 64, "Event type").toLocaleLowerCase().replace(/[^a-z0-9_.-]/g, "_"),
      level,
      clientRequestId: optionalText(metadata?.requestId, 80),
      route: optionalText(metadata?.route, 180),
      method: optionalText(metadata?.method, 10)?.toUpperCase() || null,
      statusCode: Number.isInteger(metadata?.status) ? Math.max(0, Math.min(Number(metadata.status), 599)) : null,
      durationMs: Number.isFinite(metadata?.durationMs) ? Math.max(0, Math.min(Math.round(Number(metadata.durationMs)), 300_000)) : null,
      metadata,
      occurredAt: validLogTimestamp(event?.occurredAt, now),
    };
  });
}

async function pruneDiagnostics(env, now = new Date()) {
  const cutoff = new Date(now.getTime() - TELEMETRY_RETENTION_MS).toISOString();
  await env.DB.batch([
    env.DB.prepare("DELETE FROM app_events WHERE created_at < ?").bind(cutoff),
    env.DB.prepare("DELETE FROM feedback_reports WHERE created_at < ?").bind(cutoff),
  ]);
}

async function authorizeDiagnosticHousehold(env, userId, householdId) {
  if (!householdId) return null;
  const normalized = cleanText(householdId, 80, "Household");
  await requireMembership(env, userId, normalized);
  return normalized;
}

function diagnosticEventStatement(env, user, householdId, event, now) {
  return env.DB.prepare(
    `INSERT OR IGNORE INTO app_events
      (id, user_id, household_id, session_id, client_request_id, event_type, level, route, method,
       status_code, duration_ms, metadata_json, occurred_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    event.id,
    user.id,
    householdId,
    event.sessionId,
    event.clientRequestId,
    event.eventType,
    event.level,
    event.route,
    event.method,
    event.statusCode,
    event.durationMs,
    JSON.stringify(event.metadata),
    event.occurredAt,
    now,
  );
}

async function storeTelemetry(request, env, user) {
  const body = await readJson(request, 65_536);
  const now = nowIso();
  const sessionId = cleanText(body.sessionId, 80, "Session");
  const householdId = await authorizeDiagnosticHousehold(env, user.id, body.householdId || null);
  const events = validateClientEvents(body.events, sessionId, now);
  await pruneDiagnostics(env, new Date(now));
  if (events.length) await env.DB.batch(events.map((event) => diagnosticEventStatement(env, user, householdId, event, now)));
  return { accepted: events.length };
}

async function storeFeedback(request, env, user) {
  const body = await readJson(request, 65_536);
  const now = nowIso();
  const id = uuid();
  const reference = `ICE-${id.replace(/-/g, "").slice(0, 8).toUpperCase()}`;
  const sessionId = cleanText(body.sessionId, 80, "Session");
  const householdId = await authorizeDiagnosticHousehold(env, user.id, body.householdId || null);
  const message = cleanText(body.message, 4000, "Feedback");
  const context = allowlistedLogObject(body.context, FEEDBACK_CONTEXT_KEYS);
  const recentEvents = validateClientEvents(body.recentEvents || [], sessionId, now);
  const requestId = optionalText(request.headers.get("x-icebox-request-id"), 80);

  await pruneDiagnostics(env, new Date(now));
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO feedback_reports
        (id, reference, user_id, household_id, session_id, message, app_context_json, recent_events_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(id, reference, user.id, householdId, sessionId, message, JSON.stringify(context), JSON.stringify(recentEvents), now),
    diagnosticEventStatement(env, user, householdId, {
      id: uuid(), sessionId, clientRequestId: requestId, eventType: "feedback_submitted", level: "info",
      route: "/api/feedback", method: "POST", statusCode: 201, durationMs: null,
      metadata: { reference, recentEventCount: recentEvents.length }, occurredAt: now,
    }, now),
  ]);
  return { id, reference };
}

function parseDiagnosticJson(value, fallback) {
  try { return JSON.parse(value); } catch { return fallback; }
}

function validateHouseholdInput(body) {
  const name = cleanText(body.name, 60, "Household name");
  if (!Array.isArray(body.freezers) || body.freezers.length < 1 || body.freezers.length > 6) {
    throw new HttpError(400, "validation_error", "Choose between one and six freezers");
  }
  const freezers = body.freezers.map((freezer, index) => {
    const drawerCount = Number(freezer.drawerCount);
    if (!Number.isInteger(drawerCount) || drawerCount < 1 || drawerCount > 8) {
      throw new HttpError(400, "validation_error", "Each freezer needs between one and eight drawers");
    }
    return {
      name: cleanText(freezer.name || `Freezer ${index + 1}`, 60, "Freezer name"),
      drawerCount,
    };
  });
  return { name, freezers };
}

function validateItem(body, { expectedVersion = false } = {}) {
  const label = cleanText(body.label, 80, "Label");
  const frozenOn = String(body.frozenOn || "");
  if (!isIsoDate(frozenOn)) throw new HttpError(400, "validation_error", "Frozen on must be a valid date");
  const expiresOn = body.expiresOn ? String(body.expiresOn) : null;
  if (expiresOn && !isIsoDate(expiresOn)) throw new HttpError(400, "validation_error", "Expiry must be a valid date");
  const version = Number(body.version);
  if (expectedVersion && (!Number.isInteger(version) || version < 1)) {
    throw new HttpError(400, "validation_error", "The item version is required");
  }
  return {
    label,
    frozenOn,
    expiresOn,
    notes: cleanText(body.notes || "", 2000, "Notes", { required: false }),
    freezerId: cleanText(body.freezerId, 80, "Freezer"),
    drawerId: cleanText(body.drawerId, 80, "Drawer"),
    imageId: body.imageId ? cleanText(body.imageId, 80, "Image") : null,
    version,
  };
}

async function mirrorContext(env, householdId, freezerId, drawerId, imageId, { allowDeletedImage = false } = {}) {
  const row = await env.DB.prepare(
    `SELECT h.id AS household_id, h.name AS household_name, owner.email AS household_owner_email,
            f.id AS freezer_id, f.name AS freezer_name,
            d.id AS drawer_id, d.name AS drawer_name, d.position AS drawer_position
     FROM households h
     JOIN users owner ON owner.id = h.owner_user_id
     JOIN freezers f ON f.household_id = h.id
     JOIN drawers d ON d.freezer_id = f.id
     WHERE h.id = ? AND f.id = ? AND d.id = ? AND h.deleted_at IS NULL`,
  )
    .bind(householdId, freezerId, drawerId)
    .first();
  if (!row) throw new HttpError(400, "invalid_location", "Choose a valid freezer drawer");
  let image = null;
  if (imageId) {
    image = await env.DB.prepare(
      `SELECT id, r2_key FROM media WHERE id = ? AND household_id = ?
       AND (? = 1 OR deleted_at IS NULL)`,
    )
      .bind(imageId, householdId, allowDeletedImage ? 1 : 0)
      .first();
    if (!image) throw new HttpError(400, "invalid_image", "Choose an image from this household");
  }
  return { ...row, image };
}

function mirrorPayload(item, context, mirroredAt = nowIso()) {
  return {
    schema_version: 3,
    item_id: item.id,
    item_version: item.version,
    status: item.deletedAt ? "deleted" : "active",
    household_id: context.household_id,
    household_name: context.household_name,
    household_owner_email: context.household_owner_email,
    freezer_id: context.freezer_id,
    freezer_name: context.freezer_name,
    drawer_id: context.drawer_id,
    drawer_name: context.drawer_name,
    drawer_position: context.drawer_position,
    label: item.label,
    frozen_on: item.frozenOn,
    expires_on: item.expiresOn || "",
    notes: item.notes,
    image_id: context.image?.id || "",
    image_storage_key: context.image?.r2_key || "",
    image_present: Boolean(context.image),
    created_at_utc: item.createdAt,
    updated_at_utc: item.updatedAt,
    deleted_at_utc: item.deletedAt || "",
    mirrored_at_utc: mirroredAt,
  };
}

function outboxStatement(env, payload) {
  const now = nowIso();
  return env.DB.prepare(
    `INSERT INTO sheet_outbox
      (item_id, household_id, item_version, payload_json, attempt_count, next_attempt_at, created_at, updated_at, synced_at, last_error_code)
     VALUES (?, ?, ?, ?, 0, ?, ?, ?, NULL, NULL)
     ON CONFLICT(item_id) DO UPDATE SET household_id = excluded.household_id,
       item_version = excluded.item_version, payload_json = excluded.payload_json,
       attempt_count = 0, next_attempt_at = excluded.next_attempt_at, updated_at = excluded.updated_at,
       synced_at = NULL, last_error_code = NULL
     WHERE excluded.item_version >= sheet_outbox.item_version`,
  ).bind(payload.item_id, payload.household_id, payload.item_version, JSON.stringify(payload), now, now, now);
}

function scheduleMirror(ctx, env) {
  if (ctx?.waitUntil) ctx.waitUntil(processSheetOutbox(env).catch(() => undefined));
}

async function routeHouseholds(request, env, user, parts, ctx) {
  if (parts.length === 2) {
    if (request.method === "POST") {
      const result = await createHousehold(env, user.id, validateHouseholdInput(await readJson(request)));
      return json(result, 201);
    }
    return methodNotAllowed(["POST"]);
  }
  const householdId = parts[2];
  if (parts.length === 3) {
    if (request.method === "PATCH") {
      await requireMembership(env, user.id, householdId);
      const body = await readJson(request);
      const name = cleanText(body.name, 60, "Household name");
      const now = nowIso();
      const items = await env.DB.prepare(
        `SELECT id, version, label, frozen_on, expires_on, notes, image_id, freezer_id, drawer_id, created_at, deleted_at
         FROM items WHERE household_id = ?`,
      ).bind(householdId).all();
      const statements = [env.DB.prepare("UPDATE households SET name = ?, updated_at = ? WHERE id = ?").bind(name, now, householdId)];
      for (const item of items.results || []) {
        const context = await mirrorContext(env, householdId, item.freezer_id, item.drawer_id, item.image_id, { allowDeletedImage: true });
        context.household_name = name;
        const version = Number(item.version) + 1;
        statements.push(env.DB.prepare("UPDATE items SET version = ?, updated_at = ? WHERE id = ?").bind(version, now, item.id));
        statements.push(outboxStatement(env, mirrorPayload({
          id: item.id, version, label: item.label, frozenOn: item.frozen_on, expiresOn: item.expires_on, notes: item.notes,
          createdAt: item.created_at, updatedAt: now, deletedAt: item.deleted_at,
        }, context)));
      }
      await env.DB.batch(statements);
      scheduleMirror(ctx, env);
      return json({ household: { id: householdId, name }, backupPending: (items.results || []).length > 0 });
    }
    if (request.method === "DELETE") {
      await requireOwner(env, user.id, householdId);
      const now = nowIso();
      const rows = await env.DB.prepare(
        `SELECT id, version, label, frozen_on, expires_on, notes, image_id, freezer_id, drawer_id, created_at
         FROM items WHERE household_id = ? AND deleted_at IS NULL`,
      ).bind(householdId).all();
      const statements = [env.DB.prepare("UPDATE households SET deleted_at = ?, updated_at = ? WHERE id = ?").bind(now, now, householdId)];
      for (const item of rows.results || []) {
        const context = await mirrorContext(env, householdId, item.freezer_id, item.drawer_id, item.image_id);
        const version = Number(item.version) + 1;
        statements.push(env.DB.prepare("UPDATE items SET version = ?, deleted_at = ?, updated_at = ? WHERE id = ?").bind(version, now, now, item.id));
        statements.push(outboxStatement(env, mirrorPayload({ id: item.id, version, label: item.label, frozenOn: item.frozen_on, expiresOn: item.expires_on, notes: item.notes, createdAt: item.created_at, updatedAt: now, deletedAt: now }, context)));
      }
      await env.DB.batch(statements);
      scheduleMirror(ctx, env);
      return json({ deleted: true, backupPending: (rows.results || []).length > 0 });
    }
    return methodNotAllowed(["PATCH", "DELETE"]);
  }
  const action = parts[3];
  if (action === "default") {
    only(request, ["POST"]);
    await requireMembership(env, user.id, householdId);
    await env.DB.prepare("UPDATE users SET default_household_id = ?, updated_at = ? WHERE id = ?")
      .bind(householdId, nowIso(), user.id).run();
    return json({ defaultHouseholdId: householdId });
  }
  if (action === "transfer") {
    only(request, ["POST"]);
    await requireOwner(env, user.id, householdId);
    const body = await readJson(request);
    const nextOwnerId = cleanText(body.userId, 200, "New owner");
    const member = await env.DB.prepare(
      `SELECT u.email FROM household_members hm JOIN users u ON u.id = hm.user_id
       WHERE hm.household_id = ? AND hm.user_id = ?`,
    )
      .bind(householdId, nextOwnerId).first();
    if (!member) throw new HttpError(400, "member_required", "The new owner must already be a household member");
    const now = nowIso();
    const itemRows = await env.DB.prepare("SELECT * FROM items WHERE household_id = ?").bind(householdId).all();
    const statements = [env.DB.prepare("UPDATE households SET owner_user_id = ?, updated_at = ? WHERE id = ?").bind(nextOwnerId, now, householdId)];
    for (const item of itemRows.results || []) {
      const context = await mirrorContext(env, item.household_id, item.freezer_id, item.drawer_id, item.image_id, { allowDeletedImage: true });
      context.household_owner_email = member.email;
      const version = Number(item.version) + 1;
      statements.push(env.DB.prepare("UPDATE items SET version = ?, updated_at = ? WHERE id = ?").bind(version, now, item.id));
      statements.push(outboxStatement(env, mirrorPayload({ id: item.id, version, label: item.label, frozenOn: item.frozen_on, expiresOn: item.expires_on, notes: item.notes, createdAt: item.created_at, updatedAt: now, deletedAt: item.deleted_at }, context)));
    }
    await env.DB.batch(statements);
    scheduleMirror(ctx, env);
    return json({ ownerUserId: nextOwnerId, backupPending: (itemRows.results || []).length > 0 });
  }
  if (action === "leave") {
    only(request, ["POST"]);
    const household = await requireMembership(env, user.id, householdId);
    if (household.owner_user_id === user.id) throw new HttpError(409, "owner_cannot_leave", "Transfer ownership before leaving");
    await env.DB.prepare("DELETE FROM household_members WHERE household_id = ? AND user_id = ?").bind(householdId, user.id).run();
    return json({ left: true });
  }
  if (action === "invitations") {
    await requireMembership(env, user.id, householdId);
    if (request.method === "GET") {
      const rows = await env.DB.prepare(
        `SELECT id, email_normalized AS email, status, expires_at AS expiresAt, created_at AS createdAt
         FROM household_invitations WHERE household_id = ? ORDER BY created_at DESC`,
      ).bind(householdId).all();
      return json({ invitations: rows.results || [] });
    }
    if (request.method === "POST") {
      const body = await readJson(request);
      const email = normalizeEmail(body.email);
      if (!email.includes("@") || email.length > 254) throw new HttpError(400, "validation_error", "Enter a valid ChatGPT account email");
      const counts = await env.DB.prepare(
        `SELECT
          (SELECT COUNT(*) FROM household_members WHERE household_id = ?) AS members,
          (SELECT COUNT(*) FROM household_invitations WHERE household_id = ? AND status = 'pending' AND expires_at > ?) AS pending`,
      ).bind(householdId, householdId, nowIso()).first();
      if (Number(counts?.members || 0) >= 20) throw new HttpError(409, "member_limit", "This household already has 20 members");
      if (Number(counts?.pending || 0) >= 20) throw new HttpError(409, "invitation_limit", "This household already has 20 pending invitations");
      const existing = await env.DB.prepare(
        `SELECT 1 FROM household_members hm JOIN users u ON u.id = hm.user_id
         WHERE hm.household_id = ? AND u.email_normalized = ?`,
      ).bind(householdId, email).first();
      if (existing) throw new HttpError(409, "already_member", "That account is already a member");
      const now = nowIso();
      const invitation = { id: uuid(), expiresAt: new Date(Date.now() + 30 * 86_400_000).toISOString() };
      await env.DB.prepare(
        `INSERT INTO household_invitations
          (id, household_id, email_normalized, invited_by_user_id, status, expires_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'pending', ?, ?, ?)`,
      ).bind(invitation.id, householdId, email, user.id, invitation.expiresAt, now, now).run();
      return json({ invitation: { ...invitation, email } }, 201);
    }
    return methodNotAllowed(["GET", "POST"]);
  }
  if (action === "freezers") {
    only(request, ["POST"]);
    await requireMembership(env, user.id, householdId);
    const count = await env.DB.prepare("SELECT COUNT(*) AS count FROM freezers WHERE household_id = ?").bind(householdId).first();
    if (Number(count?.count || 0) >= 6) throw new HttpError(409, "freezer_limit", "A household can have up to six freezers");
    const body = await readJson(request);
    const position = Number(count?.count || 0) + 1;
    const name = cleanText(body.name || `Freezer ${position}`, 60, "Freezer name");
    const drawerNames = Array.isArray(body.drawerNames) ? body.drawerNames : null;
    const drawerCount = drawerNames ? drawerNames.length : Number(body.drawerCount || 1);
    if (!Number.isInteger(drawerCount) || drawerCount < 1 || drawerCount > 8) throw new HttpError(400, "validation_error", "Choose between one and eight drawers");
    const freezerId = uuid();
    const now = nowIso();
    const statements = [
      env.DB.prepare("INSERT INTO freezers (id, household_id, name, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
        .bind(freezerId, householdId, name, position, now, now),
    ];
    const createdDrawers = [];
    for (let index = 0; index < drawerCount; index += 1) {
      const drawerId = uuid();
      const drawerName = cleanText(drawerNames?.[index] || `Drawer ${index + 1}`, 60, "Drawer name");
      createdDrawers.push({ id: drawerId, freezerId, name: drawerName, position: index + 1 });
      statements.push(env.DB.prepare("INSERT INTO drawers (id, freezer_id, name, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
        .bind(drawerId, freezerId, drawerName, index + 1, now, now));
    }
    await env.DB.batch(statements);
    return json({ freezer: { id: freezerId, householdId, name, position }, drawers: createdDrawers }, 201);
  }
  if (action === "members") {
    await requireMembership(env, user.id, householdId);
    if (parts.length === 4 && request.method === "GET") {
      const rows = await env.DB.prepare(
        `SELECT u.id, u.email, u.full_name AS fullName, hm.joined_at AS joinedAt,
                CASE WHEN h.owner_user_id = u.id THEN 1 ELSE 0 END AS isOwner
         FROM household_members hm JOIN users u ON u.id = hm.user_id
         JOIN households h ON h.id = hm.household_id
         WHERE hm.household_id = ? ORDER BY isOwner DESC, u.email_normalized`,
      ).bind(householdId).all();
      return json({ members: rows.results || [] });
    }
    if (parts.length !== 5 || request.method !== "DELETE") return methodNotAllowed(["GET", "DELETE"]);
    const memberId = parts[4];
    const household = await env.DB.prepare("SELECT owner_user_id FROM households WHERE id = ?").bind(householdId).first();
    if (memberId === household?.owner_user_id) throw new HttpError(409, "cannot_remove_owner", "Transfer ownership before removing the owner");
    await env.DB.prepare("DELETE FROM household_members WHERE household_id = ? AND user_id = ?").bind(householdId, memberId).run();
    return json({ removed: true });
  }
  throw new HttpError(404, "not_found", "API route not found");
}

async function routeInvitations(request, env, user, parts) {
  const invitationId = parts[2];
  const action = parts[3];
  only(request, action === "revoke" ? ["POST"] : ["POST"]);
  const invitation = await env.DB.prepare(
    `SELECT * FROM household_invitations WHERE id = ? AND status = 'pending'`,
  ).bind(invitationId).first();
  if (!invitation) throw new HttpError(404, "invitation_not_found", "Invitation not found");
  const now = nowIso();
  if (action === "revoke") {
    await requireMembership(env, user.id, invitation.household_id);
    await env.DB.prepare("UPDATE household_invitations SET status = 'revoked', updated_at = ? WHERE id = ?")
      .bind(now, invitationId).run();
    return json({ revoked: true });
  }
  if (invitation.email_normalized !== user.email_normalized) throw new HttpError(404, "invitation_not_found", "Invitation not found");
  if (invitation.expires_at <= now) {
    await env.DB.prepare("UPDATE household_invitations SET status = 'expired', updated_at = ? WHERE id = ?").bind(now, invitationId).run();
    throw new HttpError(410, "invitation_expired", "This invitation has expired");
  }
  if (action === "accept") {
    await env.DB.batch([
      env.DB.prepare("INSERT OR IGNORE INTO household_members (household_id, user_id, joined_at) VALUES (?, ?, ?)").bind(invitation.household_id, user.id, now),
      env.DB.prepare("UPDATE household_invitations SET status = 'accepted', accepted_by_user_id = ?, updated_at = ? WHERE id = ?").bind(user.id, now, invitationId),
      env.DB.prepare("UPDATE users SET default_household_id = COALESCE(default_household_id, ?), updated_at = ? WHERE id = ?").bind(invitation.household_id, now, user.id),
    ]);
    return json({ accepted: true, householdId: invitation.household_id });
  }
  if (action === "decline") {
    await env.DB.prepare("UPDATE household_invitations SET status = 'declined', updated_at = ? WHERE id = ?").bind(now, invitationId).run();
    return json({ declined: true });
  }
  throw new HttpError(404, "not_found", "API route not found");
}

async function routeItems(request, env, user, parts, ctx) {
  if (parts.length === 2) {
    if (request.method === "GET") {
      const url = new URL(request.url);
      const householdId = cleanText(url.searchParams.get("householdId"), 80, "Household");
      await requireMembership(env, user.id, householdId);
      const query = cleanText(url.searchParams.get("q") || "", 100, "Search", { required: false });
      const like = `%${query.replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;
      const rows = await env.DB.prepare(
        `SELECT id, household_id AS householdId, freezer_id AS freezerId, drawer_id AS drawerId,
                label, frozen_on AS frozenOn, expires_on AS expiresOn, notes,
                image_id AS imageId, version, created_at AS createdAt,
                CASE WHEN image_id IS NULL THEN NULL ELSE '/api/media/' || image_id END AS imageUrl
         FROM items WHERE household_id = ? AND deleted_at IS NULL
           AND (? = '' OR label LIKE ? ESCAPE '\\' OR notes LIKE ? ESCAPE '\\')
         ORDER BY updated_at DESC LIMIT 1000`,
      ).bind(householdId, query, like, like).all();
      return json({ items: rows.results || [] });
    }
    if (request.method !== "POST") return methodNotAllowed(["GET", "POST"]);
    const input = validateItem(await readJson(request));
    const freezer = await env.DB.prepare("SELECT household_id FROM freezers WHERE id = ?").bind(input.freezerId).first();
    if (!freezer) throw new HttpError(400, "invalid_location", "Choose a valid freezer");
    const householdId = freezer.household_id;
    await requireMembership(env, user.id, householdId);
    await validateItemLocation(env, householdId, input.freezerId, input.drawerId);
    const activeCount = await env.DB.prepare("SELECT COUNT(*) AS count FROM items WHERE household_id = ? AND deleted_at IS NULL").bind(householdId).first();
    if (Number(activeCount?.count || 0) >= 1000) throw new HttpError(409, "item_limit", "This household has reached its 1,000 item limit");
    const context = await mirrorContext(env, householdId, input.freezerId, input.drawerId, input.imageId);
    const now = nowIso();
    const id = uuid();
    const payload = mirrorPayload({ id, ...input, version: 1, createdAt: now, updatedAt: now, deletedAt: null }, context);
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO items
          (id, household_id, freezer_id, drawer_id, label, frozen_on, expires_on, notes, image_id, version, created_by_user_id, updated_by_user_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`,
      ).bind(id, householdId, input.freezerId, input.drawerId, input.label, input.frozenOn, input.expiresOn, input.notes, input.imageId, user.id, user.id, now, now),
      outboxStatement(env, payload),
    ]);
    scheduleMirror(ctx, env);
    return json({ item: await serializeItem(env, id), backupPending: true }, 201);
  }

  const itemId = parts[2];
  const current = await getItemForUser(env, itemId, user.id);
  if (request.method === "PATCH") {
    const input = validateItem(await readJson(request), { expectedVersion: true });
    if (Number(current.version) !== input.version) throw new HttpError(409, "version_conflict", "This item was changed elsewhere; reload and try again");
    await validateItemLocation(env, current.household_id, input.freezerId, input.drawerId);
    const context = await mirrorContext(env, current.household_id, input.freezerId, input.drawerId, input.imageId);
    const now = nowIso();
    const version = Number(current.version) + 1;
    const payload = mirrorPayload({ id: itemId, version, ...input, createdAt: current.created_at, updatedAt: now, deletedAt: null }, context);
    await env.DB.batch([
      env.DB.prepare(
        `UPDATE items SET freezer_id = ?, drawer_id = ?, label = ?, frozen_on = ?, expires_on = ?, notes = ?, image_id = ?,
           version = ?, updated_by_user_id = ?, updated_at = ? WHERE id = ? AND version = ?`,
      ).bind(input.freezerId, input.drawerId, input.label, input.frozenOn, input.expiresOn, input.notes, input.imageId, version, user.id, now, itemId, input.version),
      outboxStatement(env, payload),
    ]);
    scheduleMirror(ctx, env);
    return json({ item: await serializeItem(env, itemId), backupPending: true });
  }
  if (request.method === "DELETE") {
    const expected = Number(request.headers.get("if-match"));
    if (!Number.isInteger(expected) || expected !== Number(current.version)) throw new HttpError(409, "version_conflict", "This item was changed elsewhere; reload and try again");
    const context = await mirrorContext(env, current.household_id, current.freezer_id, current.drawer_id, current.image_id);
    const now = nowIso();
    const version = expected + 1;
    const payload = mirrorPayload({ id: itemId, version, label: current.label, frozenOn: current.frozen_on, expiresOn: current.expires_on, notes: current.notes, createdAt: current.created_at, updatedAt: now, deletedAt: now }, context);
    await env.DB.batch([
      env.DB.prepare("UPDATE items SET version = ?, deleted_at = ?, updated_at = ?, updated_by_user_id = ? WHERE id = ? AND version = ?")
        .bind(version, now, now, user.id, itemId, expected),
      outboxStatement(env, payload),
    ]);
    scheduleMirror(ctx, env);
    return json({ deleted: true, backupPending: true });
  }
  return methodNotAllowed(["PATCH", "DELETE"]);
}

function inspectJpeg(bytes) {
  let offset = 2;
  let dimensions = null;
  while (offset + 4 < bytes.length) {
    if (bytes[offset] !== 0xff) { offset += 1; continue; }
    const marker = bytes[offset + 1];
    if (marker === 0xd9 || marker === 0xda) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { offset += 2; continue; }
    const length = (bytes[offset + 2] << 8) | bytes[offset + 3];
    if (length < 2 || offset + 2 + length > bytes.length) return null;
    if (marker === 0xe1 || marker === 0xed || marker === 0xfe) return { metadata: true };
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
      dimensions = { height: (bytes[offset + 5] << 8) | bytes[offset + 6], width: (bytes[offset + 7] << 8) | bytes[offset + 8] };
    }
    offset += length + 2;
  }
  return dimensions ? { mimeType: "image/jpeg", ...dimensions, metadata: false } : null;
}

function inspectPng(bytes) {
  if (bytes.length < 24) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint32(16);
  const height = view.getUint32(20);
  let offset = 8;
  // Colour profiles are not personal metadata and are commonly emitted by browser canvas encoders.
  const metadataChunks = new Set(["eXIf", "tEXt", "zTXt", "iTXt"]);
  while (offset + 12 <= bytes.length) {
    const length = view.getUint32(offset);
    const type = String.fromCharCode(...bytes.slice(offset + 4, offset + 8));
    if (metadataChunks.has(type)) return { mimeType: "image/png", width, height, metadata: true };
    offset += 12 + length;
    if (type === "IEND") break;
  }
  return { mimeType: "image/png", width, height, metadata: false };
}

function inspectWebp(bytes) {
  if (bytes.length < 30) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 12;
  let dimensions = null;
  while (offset + 8 <= bytes.length) {
    const type = String.fromCharCode(...bytes.slice(offset, offset + 4));
    const length = view.getUint32(offset + 4, true);
    const data = offset + 8;
    // Keep harmless ICC colour profiles; continue rejecting EXIF and XMP payloads.
    if (["EXIF", "XMP "].includes(type)) return { mimeType: "image/webp", ...(dimensions || {}), metadata: true };
    if (type === "VP8X" && length >= 10) {
      const width = 1 + bytes[data + 4] + (bytes[data + 5] << 8) + (bytes[data + 6] << 16);
      const height = 1 + bytes[data + 7] + (bytes[data + 8] << 8) + (bytes[data + 9] << 16);
      dimensions = { width, height };
    } else if (type === "VP8 " && length >= 10 && bytes[data + 3] === 0x9d && bytes[data + 4] === 0x01 && bytes[data + 5] === 0x2a) {
      dimensions = { width: view.getUint16(data + 6, true) & 0x3fff, height: view.getUint16(data + 8, true) & 0x3fff };
    } else if (type === "VP8L" && length >= 5 && bytes[data] === 0x2f) {
      const packed = view.getUint32(data + 1, true);
      dimensions = { width: (packed & 0x3fff) + 1, height: ((packed >> 14) & 0x3fff) + 1 };
    }
    offset += 8 + length + (length % 2);
  }
  return dimensions ? { mimeType: "image/webp", ...dimensions, metadata: false } : null;
}

export function inspectImage(bytes) {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return inspectJpeg(bytes);
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return inspectPng(bytes);
  if (String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP") return inspectWebp(bytes);
  return null;
}

async function routeMedia(request, env, user, parts) {
  if (parts.length === 3 && request.method === "GET") {
    const media = await env.DB.prepare(
      `SELECT m.* FROM media m JOIN household_members hm ON hm.household_id = m.household_id
       WHERE m.id = ? AND hm.user_id = ? AND m.deleted_at IS NULL`,
    ).bind(parts[2], user.id).first();
    if (!media) throw new HttpError(404, "image_not_found", "Image not found");
    const object = await env.MEDIA.get(media.r2_key);
    if (!object) throw new HttpError(404, "image_not_found", "Image not found");
    return new Response(object.body, { headers: { "content-type": media.mime_type, "cache-control": "private, max-age=3600", "x-content-type-options": "nosniff" } });
  }
  if (parts.length !== 2 || request.method !== "POST") return methodNotAllowed(parts.length === 2 ? ["POST"] : ["GET"]);
  const length = Number(request.headers.get("content-length") || 0);
  if (length > 2_500_000) throw new HttpError(413, "image_too_large", "Images must be no more than 2MB after processing");
  const form = await request.formData();
  const file = form.get("image");
  const householdId = cleanText(form.get("householdId"), 80, "Household");
  if (!file || typeof file.arrayBuffer !== "function") throw new HttpError(400, "image_required", "Choose an image");
  await requireMembership(env, user.id, householdId);
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!bytes.length || bytes.length > 2_097_152) throw new HttpError(413, "image_too_large", "Images must be no more than 2MB after processing");
  const inspection = inspectImage(bytes);
  if (!inspection?.mimeType || !inspection.width || !inspection.height) throw new HttpError(400, "invalid_image", "Use a valid JPEG, PNG, or WebP image");
  if (inspection.metadata) throw new HttpError(400, "image_metadata", "This photo contains metadata; choose it again so Icebox can process it safely");
  if (inspection.width > 1600 || inspection.height > 1600) throw new HttpError(400, "image_dimensions", "Images must be at most 1,600 pixels on either side");
  const mimeType = inspection.mimeType;
  const usage = await env.DB.prepare("SELECT COALESCE(SUM(byte_size), 0) AS bytes FROM media WHERE household_id = ? AND deleted_at IS NULL")
    .bind(householdId).first();
  if (Number(usage?.bytes || 0) + bytes.length > 1_073_741_824) throw new HttpError(409, "image_storage_limit", "This household has reached its image storage limit");
  const id = uuid();
  const extension = mimeType === "image/jpeg" ? "jpg" : mimeType.split("/")[1];
  const key = `households/${householdId}/${id}.${extension}`;
  await env.MEDIA.put(key, bytes, { httpMetadata: { contentType: mimeType }, customMetadata: { householdId } });
  try {
    await env.DB.prepare(
      `INSERT INTO media (id, household_id, r2_key, mime_type, byte_size, width, height, sha256, created_by_user_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(id, householdId, key, mimeType, bytes.length, inspection.width, inspection.height, await sha256Hex(bytes), user.id, nowIso()).run();
  } catch (error) {
    await env.MEDIA.delete(key);
    throw error;
  }
  return json({ id, url: `/api/media/${id}` }, 201);
}

async function routeStructures(request, env, user, parts, ctx) {
  const kind = parts[1];
  const id = parts[2];
  if (!id) throw new HttpError(404, "not_found", "API route not found");
  if (kind === "freezers") {
    const freezer = await env.DB.prepare("SELECT * FROM freezers WHERE id = ?").bind(id).first();
    if (!freezer) throw new HttpError(404, "freezer_not_found", "Freezer not found");
    await requireMembership(env, user.id, freezer.household_id);
    if (parts[3] === "drawers") {
      only(request, ["POST"]);
      const count = await env.DB.prepare("SELECT COUNT(*) AS count FROM drawers WHERE freezer_id = ?").bind(id).first();
      if (Number(count?.count || 0) >= 8) throw new HttpError(409, "drawer_limit", "A freezer can have up to eight drawers");
      const position = Number(count?.count || 0) + 1;
      const body = await readJson(request);
      const name = cleanText(body.name || `Drawer ${position}`, 60, "Drawer name");
      const drawerId = uuid();
      const now = nowIso();
      await env.DB.prepare("INSERT INTO drawers (id, freezer_id, name, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
        .bind(drawerId, id, name, position, now, now).run();
      return json({ drawer: { id: drawerId, freezerId: id, name, position } }, 201);
    }
    if (request.method === "PATCH") {
      const name = cleanText((await readJson(request)).name, 60, "Freezer name");
      const now = nowIso();
      const itemRows = await env.DB.prepare("SELECT * FROM items WHERE freezer_id = ?").bind(id).all();
      const statements = [env.DB.prepare("UPDATE freezers SET name = ?, updated_at = ? WHERE id = ?").bind(name, now, id)];
      for (const item of itemRows.results || []) {
        const context = await mirrorContext(env, item.household_id, item.freezer_id, item.drawer_id, item.image_id, { allowDeletedImage: true });
        context.freezer_name = name;
        const version = Number(item.version) + 1;
        statements.push(env.DB.prepare("UPDATE items SET version = ?, updated_at = ? WHERE id = ?").bind(version, now, item.id));
        statements.push(outboxStatement(env, mirrorPayload({ id: item.id, version, label: item.label, frozenOn: item.frozen_on, expiresOn: item.expires_on, notes: item.notes, createdAt: item.created_at, updatedAt: now, deletedAt: item.deleted_at }, context)));
      }
      await env.DB.batch(statements);
      scheduleMirror(ctx, env);
      return json({ freezer: { id, name }, backupPending: (itemRows.results || []).length > 0 });
    }
    if (request.method === "DELETE") {
      const counts = await env.DB.prepare("SELECT (SELECT COUNT(*) FROM freezers WHERE household_id = ?) AS freezers, (SELECT COUNT(*) FROM items WHERE freezer_id = ? AND deleted_at IS NULL) AS items").bind(freezer.household_id, id).first();
      if (Number(counts?.freezers || 0) <= 1) throw new HttpError(409, "final_structure", "A household needs at least one freezer");
      if (Number(counts?.items || 0) > 0) throw new HttpError(409, "structure_not_empty", "Move or delete this freezer's items first");
      await env.DB.prepare("DELETE FROM freezers WHERE id = ?").bind(id).run();
      return json({ deleted: true });
    }
    return methodNotAllowed(["PATCH", "DELETE"]);
  }
  const drawer = await env.DB.prepare(
    `SELECT d.*, f.household_id FROM drawers d JOIN freezers f ON f.id = d.freezer_id WHERE d.id = ?`,
  ).bind(id).first();
  if (!drawer) throw new HttpError(404, "drawer_not_found", "Drawer not found");
  await requireMembership(env, user.id, drawer.household_id);
  if (request.method === "PATCH") {
    const name = cleanText((await readJson(request)).name, 60, "Drawer name");
    const now = nowIso();
    const rows = await env.DB.prepare("SELECT * FROM items WHERE drawer_id = ?").bind(id).all();
    const statements = [env.DB.prepare("UPDATE drawers SET name = ?, updated_at = ? WHERE id = ?").bind(name, now, id)];
    for (const item of rows.results || []) {
      const context = await mirrorContext(env, item.household_id, item.freezer_id, item.drawer_id, item.image_id, { allowDeletedImage: true });
      context.drawer_name = name;
      const version = Number(item.version) + 1;
      statements.push(env.DB.prepare("UPDATE items SET version = ?, updated_at = ? WHERE id = ?").bind(version, now, item.id));
      statements.push(outboxStatement(env, mirrorPayload({ id: item.id, version, label: item.label, frozenOn: item.frozen_on, expiresOn: item.expires_on, notes: item.notes, createdAt: item.created_at, updatedAt: now, deletedAt: item.deleted_at }, context)));
    }
    await env.DB.batch(statements);
    scheduleMirror(ctx, env);
    return json({ drawer: { id, name }, backupPending: (rows.results || []).length > 0 });
  }
  if (request.method === "DELETE") {
    const count = await env.DB.prepare("SELECT COUNT(*) AS count FROM drawers WHERE freezer_id = ?").bind(drawer.freezer_id).first();
    if (Number(count?.count || 0) <= 1) throw new HttpError(409, "final_structure", "A freezer needs at least one drawer");
    const items = await env.DB.prepare("SELECT COUNT(*) AS count FROM items WHERE drawer_id = ? AND deleted_at IS NULL").bind(id).first();
    if (Number(items?.count || 0) > 0) throw new HttpError(409, "structure_not_empty", "Move or delete this drawer's items first");
    await env.DB.prepare("DELETE FROM drawers WHERE id = ?").bind(id).run();
    return json({ deleted: true });
  }
  return methodNotAllowed(["PATCH", "DELETE"]);
}

async function operatorHouseholdOverview(env, user) {
  const households = await env.DB.prepare(
    `SELECT h.id, h.name, h.created_at AS createdAt, h.updated_at AS updatedAt, h.deleted_at AS deletedAt,
            owner.email AS ownerEmail, owner.full_name AS ownerName,
            COUNT(DISTINCT hm.user_id) AS memberCount,
            COUNT(DISTINCT f.id) AS freezerCount,
            COUNT(DISTINCT d.id) AS drawerCount,
            COUNT(DISTINCT CASE WHEN i.deleted_at IS NULL THEN i.id END) AS activeItemCount
     FROM households h
     JOIN users owner ON owner.id = h.owner_user_id
     LEFT JOIN household_members hm ON hm.household_id = h.id
     LEFT JOIN freezers f ON f.household_id = h.id
     LEFT JOIN drawers d ON d.freezer_id = f.id
     LEFT JOIN items i ON i.household_id = h.id
     GROUP BY h.id
     ORDER BY h.deleted_at IS NOT NULL, h.updated_at DESC, h.name COLLATE NOCASE`,
  ).all();
  const backup = await env.DB.prepare(
    `SELECT s.last_success_at AS lastSuccessAt, s.last_error_code AS lastErrorCode,
            COUNT(o.item_id) AS pendingCount, MIN(o.created_at) AS oldestPendingAt
     FROM sheet_sync_state s
     LEFT JOIN sheet_outbox o ON o.synced_at IS NULL
     WHERE s.id = 1`,
  ).first();
  const feedbackRows = await env.DB.prepare(
    `SELECT f.id, f.reference, f.message, f.session_id AS sessionId,
            f.app_context_json AS appContextJson, f.recent_events_json AS recentEventsJson,
            f.created_at AS createdAt, u.email AS userEmail, u.full_name AS userName,
            h.id AS householdId, h.name AS householdName
     FROM feedback_reports f
     JOIN users u ON u.id = f.user_id
     LEFT JOIN households h ON h.id = f.household_id
     ORDER BY f.created_at DESC
     LIMIT 20`,
  ).all();
  const rows = households.results || [];
  const feedback = (feedbackRows.results || []).map((entry) => ({
    id: entry.id,
    reference: entry.reference,
    message: entry.message,
    sessionId: entry.sessionId,
    appContext: parseDiagnosticJson(entry.appContextJson, {}),
    recentEvents: parseDiagnosticJson(entry.recentEventsJson, []),
    createdAt: entry.createdAt,
    userEmail: entry.userEmail,
    userName: entry.userName,
    householdId: entry.householdId,
    householdName: entry.householdName,
  }));
  const oldest = backup?.oldestPendingAt ? new Date(backup.oldestPendingAt).getTime() : null;
  const pendingCount = Number(backup?.pendingCount || 0);
  const attention = Boolean(backup?.lastErrorCode) || Boolean(oldest && Date.now() - oldest > 86_400_000);
  return {
    operator: { email: user.email, fullName: user.full_name },
    households: rows,
    totals: {
      activeHouseholds: rows.filter((household) => !household.deletedAt).length,
      activeItems: rows.reduce((total, household) => total + Number(household.activeItemCount || 0), 0),
      members: rows.filter((household) => !household.deletedAt).reduce((total, household) => total + Number(household.memberCount || 0), 0),
      pendingBackup: pendingCount,
      feedback: feedback.length,
    },
    feedback,
    backup: {
      state: attention ? "attention" : pendingCount ? "pending" : "current",
      pendingCount,
      oldestPendingAt: backup?.oldestPendingAt || null,
      lastSuccessAt: backup?.lastSuccessAt || null,
      lastErrorCode: backup?.lastErrorCode || null,
    },
  };
}

async function exportFeedback(env, user, feedbackId) {
  requireOperator(env, user.id);
  const feedback = await env.DB.prepare(
    `SELECT f.*, u.email AS user_email, u.full_name AS user_name, h.name AS household_name
     FROM feedback_reports f
     JOIN users u ON u.id = f.user_id
     LEFT JOIN households h ON h.id = f.household_id
     WHERE f.id = ?`,
  ).bind(cleanText(feedbackId, 80, "Feedback")).first();
  if (!feedback) throw new HttpError(404, "feedback_not_found", "Feedback report not found");
  const feedbackTime = new Date(feedback.created_at).getTime();
  const eventWindowStart = new Date(feedbackTime - 24 * 60 * 60 * 1000).toISOString();
  const eventWindowEnd = new Date(feedbackTime + 24 * 60 * 60 * 1000).toISOString();
  const events = await env.DB.prepare(
    `SELECT id, event_type AS eventType, level, client_request_id AS clientRequestId, route, method,
            status_code AS statusCode, duration_ms AS durationMs, metadata_json AS metadataJson,
            occurred_at AS occurredAt, created_at AS storedAt
     FROM app_events
     WHERE session_id = ? AND created_at >= ? AND created_at <= ?
     ORDER BY occurred_at ASC
     LIMIT 500`,
  ).bind(feedback.session_id, eventWindowStart, eventWindowEnd).all();
  const bundle = {
    schemaVersion: 1,
    exportedAt: nowIso(),
    feedback: {
      id: feedback.id,
      reference: feedback.reference,
      message: feedback.message,
      user: { email: feedback.user_email, name: feedback.user_name },
      household: feedback.household_id ? { id: feedback.household_id, name: feedback.household_name } : null,
      sessionId: feedback.session_id,
      appContext: parseDiagnosticJson(feedback.app_context_json, {}),
      recentClientEvents: parseDiagnosticJson(feedback.recent_events_json, []),
      createdAt: feedback.created_at,
    },
    storedSessionEvents: (events.results || []).map((entry) => ({
      ...entry,
      metadata: parseDiagnosticJson(entry.metadataJson, {}),
      metadataJson: undefined,
    })),
    privacy: "Inventory labels, notes, photos, search text and credentials are intentionally excluded.",
  };
  return json(bundle, 200, {
    "content-disposition": `attachment; filename="icebox-${feedback.reference.toLocaleLowerCase()}-diagnostics.json"`,
  });
}

async function tombstoneHouseholdInventory(env, user, household, ctx, { archiveHousehold = false } = {}) {
  const now = nowIso();
  const rows = await env.DB.prepare(
    `SELECT i.id, i.version, i.label, i.frozen_on, i.expires_on, i.notes, i.image_id,
            i.freezer_id, i.drawer_id, i.created_at, m.r2_key
     FROM items i LEFT JOIN media m ON m.id = i.image_id
     WHERE i.household_id = ? AND i.deleted_at IS NULL`,
  ).bind(household.id).all();
  const statements = [];
  const mediaIds = new Set();
  const mediaKeys = new Set();

  for (const item of rows.results || []) {
    const context = await mirrorContext(env, household.id, item.freezer_id, item.drawer_id, item.image_id);
    const version = Number(item.version) + 1;
    statements.push(
      env.DB.prepare("UPDATE items SET version = ?, deleted_at = ?, updated_at = ?, updated_by_user_id = ? WHERE id = ? AND deleted_at IS NULL")
        .bind(version, now, now, user.id, item.id),
      outboxStatement(env, mirrorPayload({
        id: item.id,
        version,
        label: item.label,
        frozenOn: item.frozen_on,
        expiresOn: item.expires_on,
        notes: item.notes,
        createdAt: item.created_at,
        updatedAt: now,
        deletedAt: now,
      }, context)),
    );
    if (item.image_id) mediaIds.add(item.image_id);
    if (item.r2_key) mediaKeys.add(item.r2_key);
  }

  if (mediaIds.size) {
    const placeholders = [...mediaIds].map(() => "?").join(",");
    statements.push(env.DB.prepare(`UPDATE media SET deleted_at = ? WHERE id IN (${placeholders})`).bind(now, ...mediaIds));
  }

  if (archiveHousehold) {
    statements.push(
      env.DB.prepare("UPDATE households SET deleted_at = ?, updated_at = ? WHERE id = ?").bind(now, now, household.id),
      env.DB.prepare("UPDATE users SET default_household_id = NULL, updated_at = ? WHERE default_household_id = ?").bind(now, household.id),
      env.DB.prepare("UPDATE household_invitations SET status = 'revoked', updated_at = ? WHERE household_id = ? AND status = 'pending'").bind(now, household.id),
      env.DB.prepare("UPDATE media SET deleted_at = ? WHERE household_id = ? AND deleted_at IS NULL").bind(now, household.id),
    );
    const remainingMedia = await env.DB.prepare("SELECT r2_key FROM media WHERE household_id = ? AND deleted_at IS NULL").bind(household.id).all();
    for (const media of remainingMedia.results || []) if (media.r2_key) mediaKeys.add(media.r2_key);
  } else if (!statements.length) {
    statements.push(env.DB.prepare("UPDATE households SET updated_at = ? WHERE id = ?").bind(now, household.id));
  }

  await env.DB.batch(statements);
  if (mediaKeys.size && env.MEDIA?.delete) {
    const cleanup = Promise.all([...mediaKeys].map((key) => env.MEDIA.delete(key))).catch(() => undefined);
    if (ctx?.waitUntil) ctx.waitUntil(cleanup);
    else await cleanup;
  }
  if ((rows.results || []).length) scheduleMirror(ctx, env);
  return { itemsReset: (rows.results || []).length, backupPending: (rows.results || []).length > 0 };
}

async function routeOperatorAdmin(request, env, user, parts, ctx) {
  requireOperator(env, user.id);
  if (parts.length === 4) {
    only(request, ["GET"]);
    return json(await operatorHouseholdOverview(env, user));
  }

  const householdId = cleanText(parts[4], 80, "Household");
  const household = await env.DB.prepare("SELECT id, name, deleted_at FROM households WHERE id = ?").bind(householdId).first();
  if (!household) throw new HttpError(404, "household_not_found", "Household not found");

  if (parts[5] === "reset") {
    only(request, ["POST"]);
    if (household.deleted_at) throw new HttpError(409, "household_archived", "Archived households cannot be reset");
    const confirmName = cleanText((await readJson(request)).confirmName, 60, "Confirmation name");
    if (confirmName !== household.name) throw new HttpError(400, "confirmation_mismatch", "Type the household name exactly to confirm");
    return json({ reset: true, ...(await tombstoneHouseholdInventory(env, user, household, ctx)) });
  }

  if (parts.length !== 5) throw new HttpError(404, "not_found", "API route not found");
  if (request.method === "PATCH") {
    if (household.deleted_at) throw new HttpError(409, "household_archived", "Archived households cannot be renamed");
    const name = cleanText((await readJson(request)).name, 60, "Household name");
    const now = nowIso();
    const items = await env.DB.prepare(
      `SELECT id, version, label, frozen_on, expires_on, notes, image_id, freezer_id, drawer_id, created_at, deleted_at
       FROM items WHERE household_id = ?`,
    ).bind(householdId).all();
    const statements = [env.DB.prepare("UPDATE households SET name = ?, updated_at = ? WHERE id = ?").bind(name, now, householdId)];
    for (const item of items.results || []) {
      const context = await mirrorContext(env, householdId, item.freezer_id, item.drawer_id, item.image_id, { allowDeletedImage: true });
      context.household_name = name;
      const version = Number(item.version) + 1;
      statements.push(
        env.DB.prepare("UPDATE items SET version = ?, updated_at = ? WHERE id = ?").bind(version, now, item.id),
        outboxStatement(env, mirrorPayload({ id: item.id, version, label: item.label, frozenOn: item.frozen_on, expiresOn: item.expires_on, notes: item.notes, createdAt: item.created_at, updatedAt: now, deletedAt: item.deleted_at }, context)),
      );
    }
    await env.DB.batch(statements);
    if ((items.results || []).length) scheduleMirror(ctx, env);
    return json({ household: { id: householdId, name }, backupPending: (items.results || []).length > 0 });
  }
  if (request.method === "DELETE") {
    if (household.deleted_at) return json({ deleted: true, alreadyArchived: true });
    const confirmName = cleanText((await readJson(request)).confirmName, 60, "Confirmation name");
    if (confirmName !== household.name) throw new HttpError(400, "confirmation_mismatch", "Type the household name exactly to confirm");
    return json({ deleted: true, ...(await tombstoneHouseholdInventory(env, user, household, ctx, { archiveHousehold: true })) });
  }
  return methodNotAllowed(["PATCH", "DELETE"]);
}

async function routeApiInner(request, env, ctx) {
  const url = new URL(request.url);
  assertOrigin(request, env);
  if (url.pathname.startsWith("/api/local-dev/")) {
    if (!isLocalDevRequest(request, env)) throw new HttpError(404, "not_found", "API route not found");
    await ensureSchema(env);
    return routeLocalDev(request, env, url.pathname.split("/").filter(Boolean)[2]);
  }
  const identity = authenticatedUser(request, env);
  await ensureSchema(env);
  const user = await requireAdmittedUser(env, identity);
  const parts = url.pathname.split("/").filter(Boolean);

  if (url.pathname === "/api/bootstrap") {
    only(request, ["GET"]);
    const result = await listBootstrap(env, user);
    if (ctx?.waitUntil) ctx.waitUntil(processSheetOutbox(env, { limit: 5 }).catch(() => undefined));
    return json(result);
  }
  if (parts[1] === "households") return routeHouseholds(request, env, user, parts, ctx);
  if (parts[1] === "invitations") return routeInvitations(request, env, user, parts);
  if (parts[1] === "items") return routeItems(request, env, user, parts, ctx);
  if (parts[1] === "media") return routeMedia(request, env, user, parts);
  if (parts[1] === "freezers" || parts[1] === "drawers") return routeStructures(request, env, user, parts, ctx);
  if (url.pathname === "/api/ai/label") {
    only(request, ["POST"]);
    const body = await readJson(request);
    const result = await generateLabel(request, env, user, {
      imageId: cleanText(body.imageId, 80, "Image"),
      householdId: cleanText(body.householdId, 80, "Household"),
    });
    return json(result);
  }
  if (url.pathname === "/api/me/preferences") {
    only(request, ["PATCH"]);
    const body = await readJson(request);
    const enabled = booleanValue(body.aiLabelEnabled, "AI label setting");
    await env.DB.prepare("UPDATE users SET ai_label_enabled = ?, updated_at = ? WHERE id = ?").bind(enabled ? 1 : 0, nowIso(), user.id).run();
    return json({ aiLabelEnabled: enabled });
  }
  if (url.pathname === "/api/me") {
    only(request, ["DELETE"]);
    const owned = await env.DB.prepare("SELECT COUNT(*) AS count FROM households WHERE owner_user_id = ? AND deleted_at IS NULL").bind(user.id).first();
    if (Number(owned?.count || 0) > 0) throw new HttpError(409, "owned_households", "Transfer or delete owned households first");
    const suffix = (await sha256Hex(`${user.id}:${nowIso()}`)).slice(0, 16);
    await env.DB.batch([
      env.DB.prepare("DELETE FROM household_members WHERE user_id = ?").bind(user.id),
      env.DB.prepare("UPDATE household_invitations SET status = 'revoked', updated_at = ? WHERE invited_by_user_id = ? AND status = 'pending'").bind(nowIso(), user.id),
      env.DB.prepare("UPDATE users SET email = ?, email_normalized = ?, full_name = NULL, ai_label_enabled = 0, default_household_id = NULL, deleted_at = ?, updated_at = ? WHERE id = ?")
        .bind(`deleted-${suffix}@invalid.local`, `deleted-${suffix}@invalid.local`, nowIso(), nowIso(), user.id),
    ]);
    return json({ deleted: true });
  }
  if (url.pathname === "/api/backup/status") {
    only(request, ["GET"]);
    const memberships = await env.DB.prepare("SELECT household_id FROM household_members WHERE user_id = ?").bind(user.id).all();
    return json(await backupStatus(env, (memberships.results || []).map((row) => row.household_id)));
  }
  if (url.pathname === "/api/telemetry") {
    only(request, ["POST"]);
    return json(await storeTelemetry(request, env, user));
  }
  if (url.pathname === "/api/feedback") {
    only(request, ["POST"]);
    return json(await storeFeedback(request, env, user), 201);
  }
  if (url.pathname.startsWith("/api/operator/backup/")) {
    requireOperator(env, user.id);
    if (url.pathname.endsWith("/retry")) {
      only(request, ["POST"]);
      return json(await processSheetOutbox(env, { limit: 20 }));
    }
    if (url.pathname.endsWith("/schema")) {
      only(request, ["POST"]);
      return json(await verifySheetSchema(env, { repair: Boolean((await readJson(request)).repair) }));
    }
    if (url.pathname.endsWith("/reconcile")) {
      only(request, ["POST"]);
      return json(await reconcileSheet(env));
    }
  }
  if (url.pathname.startsWith("/api/operator/admin/households")) {
    return routeOperatorAdmin(request, env, user, parts, ctx);
  }
  if (parts[1] === "operator" && parts[2] === "admin" && parts[3] === "feedback" && parts[5] === "export") {
    only(request, ["GET"]);
    return exportFeedback(env, user, parts[4]);
  }
  throw new HttpError(404, "not_found", "API route not found");
}

export async function routeApi(request, env, ctx) {
  try {
    return await routeApiInner(request, env, ctx);
  } catch (error) {
    if (error?.allowed) return methodNotAllowed(error.allowed);
    const identityEmail = normalizeEmail(request.headers.get("oai-authenticated-user-email"));
    const identityId = request.headers.get("oai-authenticated-user-id");
    const isOperator = Boolean(env.OPERATOR_CHATGPT_USER_ID && identityId === env.OPERATOR_CHATGPT_USER_ID);
    const isAllowedPilot = String(env.PILOT_ALLOWED_EMAILS || "")
      .split(",")
      .map(normalizeEmail)
      .filter(Boolean)
      .includes(identityEmail);
    if (!(error instanceof HttpError) && (isOperator || isAllowedPilot)) {
      throw new HttpError(500, "internal_error", "Something went wrong", {
        debug: String(error?.message || error?.name || "Unknown error").slice(0, 300),
      });
    }
    throw error;
  }
}

export { MIRROR_HEADERS, mirrorPayload, pruneDiagnostics, validateClientEvents, validateHouseholdInput, validateItem, valuesForTesting };

function valuesForTesting(payload) {
  return MIRROR_HEADERS.map((header) => payload[header] ?? "");
}
