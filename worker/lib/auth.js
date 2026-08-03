import { HttpError, cleanText, normalizeEmail, nowIso } from "./http.js";
import { LOCAL_IDENTITY, isLocalDevRequest } from "./local-mode.js";

function decodeDisplayName(request) {
  if (request.headers.get("oai-authenticated-user-full-name-encoding") !== "percent-encoded-utf-8") return null;
  const encoded = request.headers.get("oai-authenticated-user-full-name");
  if (!encoded) return null;
  try {
    return cleanText(decodeURIComponent(encoded), 100, "Display name", { required: false }) || null;
  } catch {
    return null;
  }
}

export function optionalAuthenticatedUser(request, env) {
  if (isLocalDevRequest(request, env)) return { ...LOCAL_IDENTITY };
  const id = request.headers.get("oai-authenticated-user-id");
  const email = request.headers.get("oai-authenticated-user-email");
  if (!id && !email) return null;
  if (!id || !email) throw new HttpError(401, "invalid_identity", "The signed-in identity is incomplete");
  const normalized = normalizeEmail(email);
  if (!normalized || !normalized.includes("@")) {
    throw new HttpError(401, "invalid_identity", "The signed-in identity is missing a valid email");
  }
  return { id, email, emailNormalized: normalized, fullName: decodeDisplayName(request) };
}

export function authenticatedUser(request, env) {
  const identity = optionalAuthenticatedUser(request, env);
  if (!identity) throw new HttpError(401, "authentication_required", "Sign in with ChatGPT to continue");
  return identity;
}

export async function admissionStatus(env, identity) {
  const operatorMatches = env.OPERATOR_CHATGPT_USER_ID && identity.id === env.OPERATOR_CHATGPT_USER_ID;
  const allowedFromSecret = String(env.PILOT_ALLOWED_EMAILS || "")
    .split(",")
    .map(normalizeEmail)
    .filter(Boolean)
    .includes(identity.emailNormalized);
  if (operatorMatches) return { admitted: true, reason: "operator" };
  if (allowedFromSecret) return { admitted: true, reason: "environment_allowlist" };

  const status = await env.DB.prepare(
    `SELECT
       EXISTS(SELECT 1 FROM pilot_allowlist WHERE email_normalized = ?) AS allowlisted,
       EXISTS(
         SELECT 1 FROM household_members hm
         JOIN households h ON h.id = hm.household_id
         WHERE hm.user_id = ? AND h.deleted_at IS NULL
       ) AS member,
       EXISTS(
         SELECT 1 FROM household_invitations
         WHERE email_normalized = ? AND status = 'pending' AND expires_at > ?
       ) AS invited`,
  ).bind(identity.emailNormalized, identity.id, identity.emailNormalized, nowIso()).first();
  if (Number(status?.allowlisted || 0)) return { admitted: true, reason: "pilot_allowlist" };
  if (Number(status?.member || 0)) return { admitted: true, reason: "household_member" };
  if (Number(status?.invited || 0)) return { admitted: true, reason: "pending_invitation" };
  return { admitted: false, reason: "not_invited" };
}

export async function requireAdmittedUser(env, identity) {
  const admission = await admissionStatus(env, identity);
  if (!admission.admitted) {
    throw new HttpError(403, "pilot_access_required", "Icebox is currently available by invitation");
  }

  const now = nowIso();
  await env.DB.prepare(
    `INSERT INTO users (id, email, email_normalized, full_name, ai_label_enabled, created_at, updated_at, last_seen_at)
     VALUES (?, ?, ?, ?, 1, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       email = excluded.email,
       email_normalized = excluded.email_normalized,
       full_name = COALESCE(excluded.full_name, users.full_name),
       ai_label_enabled = CASE WHEN users.deleted_at IS NULL THEN users.ai_label_enabled ELSE 1 END,
       deleted_at = NULL,
       updated_at = excluded.updated_at,
       last_seen_at = excluded.last_seen_at`,
  )
    .bind(identity.id, identity.email, identity.emailNormalized, identity.fullName, now, now, now)
    .run();

  return env.DB.prepare(
    "SELECT id, email, email_normalized, full_name, ai_label_enabled, default_household_id FROM users WHERE id = ?",
  )
    .bind(identity.id)
    .first();
}

export async function requireMembership(env, userId, householdId) {
  const membership = await env.DB.prepare(
    `SELECT h.id, h.name, h.owner_user_id, h.deleted_at
     FROM household_members hm
     JOIN households h ON h.id = hm.household_id
     WHERE hm.user_id = ? AND hm.household_id = ? AND h.deleted_at IS NULL`,
  )
    .bind(userId, householdId)
    .first();
  if (!membership) throw new HttpError(404, "household_not_found", "Household not found");
  return membership;
}

export async function requireOwner(env, userId, householdId) {
  const household = await requireMembership(env, userId, householdId);
  if (household.owner_user_id !== userId) {
    throw new HttpError(403, "owner_required", "Only the household owner can do that");
  }
  return household;
}

export function requireOperator(env, userId) {
  if (!env.OPERATOR_CHATGPT_USER_ID || userId !== env.OPERATOR_CHATGPT_USER_ID) {
    throw new HttpError(403, "operator_required", "Operator access is required");
  }
}
