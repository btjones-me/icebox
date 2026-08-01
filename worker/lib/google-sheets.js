import { nowIso } from "./http.js";
import { enqueueMirror, mirrorRowForItem } from "./db.js";

export const MIRROR_HEADERS = [
  "schema_version",
  "item_id",
  "item_version",
  "status",
  "household_id",
  "household_name",
  "household_owner_email",
  "freezer_id",
  "freezer_name",
  "drawer_id",
  "drawer_name",
  "drawer_position",
  "label",
  "frozen_on",
  "expires_on",
  "notes",
  "image_id",
  "image_storage_key",
  "image_present",
  "created_at_utc",
  "updated_at_utc",
  "deleted_at_utc",
  "mirrored_at_utc",
];

const LEGACY_MIRROR_HEADERS = MIRROR_HEADERS.map((header) => header === "label" ? "caption" : header);

const BACKOFF_MS = [60_000, 300_000, 1_800_000, 7_200_000, 43_200_000];
let tokenCache = null;

function configured(env) {
  return Boolean(
    env.GOOGLE_SERVICE_ACCOUNT_EMAIL &&
      env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY &&
      env.GOOGLE_SPREADSHEET_ID,
  );
}

function base64Url(value) {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "");
}

function privateKeyBytes(value) {
  const pem = value.replaceAll("\\n", "\n");
  const body = pem.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g, "");
  const binary = atob(body);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function accessToken(env) {
  if (tokenCache && tokenCache.expiresAt > Date.now() + 60_000) return tokenCache.value;
  const issuedAt = Math.floor(Date.now() / 1000);
  const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = base64Url(
    JSON.stringify({
      iss: env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      scope: "https://www.googleapis.com/auth/spreadsheets",
      aud: "https://oauth2.googleapis.com/token",
      iat: issuedAt,
      exp: issuedAt + 3600,
    }),
  );
  const signingInput = `${header}.${claims}`;
  const key = await crypto.subtle.importKey(
    "pkcs8",
    privateKeyBytes(env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(signingInput),
  );
  const assertion = `${signingInput}.${base64Url(new Uint8Array(signature))}`;
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }),
  });
  if (!response.ok) throw Object.assign(new Error("Google authentication failed"), { code: `google_auth_${response.status}` });
  const data = await response.json();
  tokenCache = { value: data.access_token, expiresAt: Date.now() + Number(data.expires_in || 3600) * 1000 };
  return tokenCache.value;
}

function sheetName(env) {
  return env.GOOGLE_WORKSHEET_NAME || "Inventory";
}

async function sheetsFetch(env, path, init = {}) {
  const token = await accessToken(env);
  const response = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${env.GOOGLE_SPREADSHEET_ID}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...(init.headers || {}) },
  });
  if (!response.ok) {
    if (response.status === 401) tokenCache = null;
    const error = Object.assign(new Error("Google Sheets request failed"), {
      code: `google_sheets_${response.status}`,
      retryAfter: response.headers.get("retry-after"),
    });
    throw error;
  }
  return response.status === 204 ? {} : response.json();
}

function valuesFor(payload) {
  return MIRROR_HEADERS.map((header) => {
    const value = payload[header];
    if (value === null || value === undefined) return "";
    // RAW input prevents formula execution; leading apostrophe is unnecessary and would alter recovery data.
    return typeof value === "boolean" ? String(value) : value;
  });
}

async function findRow(env, itemId, mappedRow) {
  const name = encodeURIComponent(sheetName(env));
  if (mappedRow) {
    const result = await sheetsFetch(env, `/values/${name}!B${mappedRow}:B${mappedRow}`);
    if (result.values?.[0]?.[0] === itemId) return mappedRow;
  }
  const result = await sheetsFetch(env, `/values/${name}!B2:B`);
  const index = (result.values || []).findIndex((row) => row[0] === itemId);
  return index >= 0 ? index + 2 : null;
}

async function upsertRow(env, payload, mappedRow) {
  const name = encodeURIComponent(sheetName(env));
  const row = await findRow(env, payload.item_id, mappedRow);
  if (row) {
    await sheetsFetch(
      env,
      `/values/${name}!A${row}:W${row}?valueInputOption=RAW`,
      { method: "PUT", body: JSON.stringify({ range: `${sheetName(env)}!A${row}:W${row}`, majorDimension: "ROWS", values: [valuesFor(payload)] }) },
    );
    return row;
  }
  const result = await sheetsFetch(
    env,
    `/values/${name}!A:W:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
    { method: "POST", body: JSON.stringify({ majorDimension: "ROWS", values: [valuesFor(payload)] }) },
  );
  const match = String(result.updates?.updatedRange || "").match(/![A-Z]+(\d+):/);
  if (!match) throw Object.assign(new Error("Google append row was not reported"), { code: "google_append_unknown_row" });
  return Number(match[1]);
}

async function markState(env, values) {
  const now = nowIso();
  await env.DB.prepare(
    `UPDATE sheet_sync_state SET last_attempt_at = ?, last_success_at = COALESCE(?, last_success_at),
       last_error_code = ?, updated_at = ? WHERE id = 1`,
  )
    .bind(now, values.successAt || null, values.errorCode || null, now)
    .run();
}

export async function verifySheetSchema(env, { repair = false } = {}) {
  if (!configured(env)) return { configured: false, valid: false, error: "google_not_configured" };
  const name = encodeURIComponent(sheetName(env));
  const result = await sheetsFetch(env, `/values/${name}!A1:W1`);
  const actual = result.values?.[0] || [];
  const valid = MIRROR_HEADERS.every((header, index) => actual[index] === header);
  const legacy = LEGACY_MIRROR_HEADERS.every((header, index) => actual[index] === header);
  if (!valid && repair && (actual.length === 0 || legacy)) {
    await sheetsFetch(env, `/values/${name}!A1:W1?valueInputOption=RAW`, {
      method: "PUT",
      body: JSON.stringify({ majorDimension: "ROWS", values: [MIRROR_HEADERS] }),
    });
    const sheetId = Number(env.GOOGLE_WORKSHEET_ID || 0);
    await sheetsFetch(env, ":batchUpdate", {
      method: "POST",
      body: JSON.stringify({
        requests: [
          { updateSheetProperties: { properties: { sheetId, gridProperties: { frozenRowCount: 1 } }, fields: "gridProperties.frozenRowCount" } },
          { setBasicFilter: { filter: { range: { sheetId, startRowIndex: 0, startColumnIndex: 0, endColumnIndex: MIRROR_HEADERS.length } } } },
          { addProtectedRange: { protectedRange: { range: { sheetId, startRowIndex: 0, endRowIndex: 1 }, description: "Icebox schema header", warningOnly: true } } },
        ],
      }),
    });
    return { configured: true, valid: true, repaired: true, migratedFromSchemaVersion: legacy ? 2 : null };
  }
  return { configured: true, valid, actual };
}

export async function processSheetOutbox(env, { limit = 20 } = {}) {
  if (!configured(env)) {
    await markState(env, { errorCode: "google_not_configured" });
    return { configured: false, processed: 0, failed: 0 };
  }
  const due = await env.DB.prepare(
    `SELECT item_id, item_version, payload_json, attempt_count FROM sheet_outbox
     WHERE synced_at IS NULL AND next_attempt_at <= ? ORDER BY updated_at LIMIT ?`,
  )
    .bind(nowIso(), Math.min(Math.max(Number(limit) || 20, 1), 20))
    .all();
  let processed = 0;
  let failed = 0;
  for (const event of due.results || []) {
    try {
      const mapping = await env.DB.prepare("SELECT row_number FROM sheet_row_map WHERE item_id = ?")
        .bind(event.item_id)
        .first();
      const payload = JSON.parse(event.payload_json);
      const rowNumber = await upsertRow(env, payload, mapping?.row_number);
      const now = nowIso();
      await env.DB.batch([
        env.DB.prepare(
          `INSERT INTO sheet_row_map (item_id, row_number, mirrored_version, updated_at) VALUES (?, ?, ?, ?)
           ON CONFLICT(item_id) DO UPDATE SET row_number = excluded.row_number,
             mirrored_version = MAX(sheet_row_map.mirrored_version, excluded.mirrored_version), updated_at = excluded.updated_at`,
        ).bind(event.item_id, rowNumber, event.item_version, now),
        env.DB.prepare(
          "UPDATE sheet_outbox SET synced_at = ?, updated_at = ?, last_error_code = NULL WHERE item_id = ? AND item_version = ?",
        ).bind(now, now, event.item_id, event.item_version),
      ]);
      processed += 1;
      await markState(env, { successAt: now });
    } catch (error) {
      failed += 1;
      const attempt = Number(event.attempt_count || 0) + 1;
      const delay = BACKOFF_MS[Math.min(attempt - 1, BACKOFF_MS.length - 1)];
      const next = new Date(Date.now() + delay).toISOString();
      const code = String(error?.code || "google_unknown_error").slice(0, 80);
      await env.DB.prepare(
        `UPDATE sheet_outbox SET attempt_count = ?, next_attempt_at = ?, last_error_code = ?, updated_at = ?
         WHERE item_id = ? AND item_version = ?`,
      )
        .bind(attempt, next, code, nowIso(), event.item_id, event.item_version)
        .run();
      await markState(env, { errorCode: code });
      console.error(JSON.stringify({ event: "sheet_mirror_failed", code, attempt }));
      if (code.includes("429")) break;
    }
  }
  return { configured: true, processed, failed };
}

export async function reconcileSheet(env) {
  if (!configured(env)) return { configured: false, inspected: 0, repaired: 0, duplicates: 0 };
  const name = encodeURIComponent(sheetName(env));
  const sheet = await sheetsFetch(env, `/values/${name}!A2:W`);
  const sheetVersions = new Map();
  let duplicates = 0;
  for (const row of sheet.values || []) {
    const itemId = row[1];
    if (!itemId) continue;
    if (sheetVersions.has(itemId)) duplicates += 1;
    else sheetVersions.set(itemId, Number(row[2] || 0));
  }
  const rows = await env.DB.prepare(
    `SELECT i.id, i.version, i.household_id FROM items i`,
  ).all();
  let queued = 0;
  for (const item of rows.results || []) {
    if (Number(sheetVersions.get(item.id) || 0) < Number(item.version)) {
      const row = await mirrorRowForItem(env, item.id);
      await enqueueMirror(env, item.id, item.household_id, item.version, row.object);
      queued += 1;
    }
  }
  if (duplicates) await markState(env, { errorCode: "google_duplicate_item_ids" });
  await env.DB.prepare("UPDATE sheet_sync_state SET last_reconcile_at = ?, updated_at = ? WHERE id = 1")
    .bind(nowIso(), nowIso())
    .run();
  const mirror = duplicates ? { processed: 0, failed: 0 } : await processSheetOutbox(env, { limit: 20 });
  return { configured: true, inspected: (rows.results || []).length, repaired: mirror.processed, queued, duplicates };
}
