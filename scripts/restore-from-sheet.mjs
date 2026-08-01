#!/usr/bin/env node
import { createHash, createSign } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { MIRROR_HEADERS } from "../worker/lib/google-sheets.js";

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') quoted = false;
      else field += character;
    } else if (character === '"') quoted = true;
    else if (character === ",") {
      row.push(field);
      field = "";
    } else if (character === "\n") {
      row.push(field.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      field = "";
    } else field += character;
  }
  if (field || row.length) {
    row.push(field.replace(/\r$/, ""));
    rows.push(row);
  }
  return rows;
}

function base64Url(value) {
  return Buffer.from(value).toString("base64url");
}

async function googleRows() {
  const required = ["GOOGLE_SERVICE_ACCOUNT_EMAIL", "GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY", "GOOGLE_SPREADSHEET_ID"];
  const missing = required.filter((name) => !process.env[name]);
  if (missing.length) throw new Error(`Provide --csv <export.csv>, or set ${missing.join(", ")}`);
  const now = Math.floor(Date.now() / 1000);
  const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = base64Url(JSON.stringify({
    iss: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    scope: "https://www.googleapis.com/auth/spreadsheets.readonly",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  }));
  const signingInput = `${header}.${claims}`;
  const signer = createSign("RSA-SHA256");
  signer.update(signingInput);
  const assertion = `${signingInput}.${signer.sign(process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY.replaceAll("\\n", "\n"), "base64url")}`;
  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }),
  });
  if (!tokenResponse.ok) throw new Error(`Google authentication failed (${tokenResponse.status})`);
  const token = await tokenResponse.json();
  const tab = encodeURIComponent(process.env.GOOGLE_WORKSHEET_NAME || "Inventory");
  const valuesResponse = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${process.env.GOOGLE_SPREADSHEET_ID}/values/${tab}!A:W`,
    { headers: { authorization: `Bearer ${token.access_token}` } },
  );
  if (!valuesResponse.ok) throw new Error(`Google Sheet read failed (${valuesResponse.status})`);
  return (await valuesResponse.json()).values || [];
}

function validate(table) {
  const headers = table[0] || [];
  if (!MIRROR_HEADERS.every((header, index) => headers[index] === header)) {
    throw new Error("Inventory headers do not match schema version 3; recovery stopped without writing");
  }
  const records = table.slice(1).filter((row) => row.some(Boolean)).map((row, rowIndex) =>
    Object.fromEntries(MIRROR_HEADERS.map((header, index) => [header, row[index] ?? ""]).concat([["_row", rowIndex + 2]])),
  );
  const ids = new Map();
  for (const record of records) {
    if (String(record.schema_version) !== "3") throw new Error(`Unsupported schema version at row ${record._row}`);
    if (!record.item_id || !record.household_id || !record.freezer_id || !record.drawer_id) throw new Error(`Missing stable ID at row ${record._row}`);
    if (!Number.isInteger(Number(record.item_version)) || Number(record.item_version) < 1) throw new Error(`Invalid item version at row ${record._row}`);
    if (!['active', 'deleted'].includes(record.status)) throw new Error(`Invalid status at row ${record._row}`);
    if (ids.has(record.item_id)) throw new Error(`Duplicate item_id ${record.item_id} at rows ${ids.get(record.item_id)} and ${record._row}`);
    ids.set(record.item_id, record._row);
  }
  return records;
}

function sql(value) {
  return `'${String(value ?? "").replaceAll("'", "''")}'`;
}

function recoveryOwnerId(email) {
  return `recovery-owner-${createHash("sha256").update(String(email).toLowerCase()).digest("hex").slice(0, 20)}`;
}

function buildSql(records) {
  const generatedAt = new Date().toISOString();
  const households = new Map();
  const freezers = new Map();
  const drawers = new Map();
  for (const row of records) {
    households.set(row.household_id, row);
    freezers.set(row.freezer_id, row);
    drawers.set(row.drawer_id, row);
  }
  const freezerPositions = new Map();
  for (const householdId of households.keys()) {
    [...freezers.values()]
      .filter((row) => row.household_id === householdId)
      .sort((left, right) => `${left.freezer_name}\0${left.freezer_id}`.localeCompare(`${right.freezer_name}\0${right.freezer_id}`))
      .forEach((row, index) => freezerPositions.set(row.freezer_id, index + 1));
  }
  const lines = ["PRAGMA foreign_keys = ON;", "BEGIN IMMEDIATE;"];
  for (const row of households.values()) {
    const ownerId = recoveryOwnerId(row.household_owner_email);
    const email = row.household_owner_email || `${ownerId}@invalid.local`;
    lines.push(
      `INSERT OR IGNORE INTO users (id, email, email_normalized, full_name, ai_label_enabled, created_at, updated_at, last_seen_at) VALUES (${sql(ownerId)}, ${sql(email)}, ${sql(email.toLowerCase())}, NULL, 0, ${sql(generatedAt)}, ${sql(generatedAt)}, ${sql(generatedAt)});`,
      `INSERT OR IGNORE INTO households (id, name, owner_user_id, created_at, updated_at) VALUES (${sql(row.household_id)}, ${sql(row.household_name)}, ${sql(ownerId)}, ${sql(generatedAt)}, ${sql(generatedAt)});`,
    );
  }
  for (const row of freezers.values()) {
    lines.push(`INSERT OR IGNORE INTO freezers (id, household_id, name, position, created_at, updated_at) VALUES (${sql(row.freezer_id)}, ${sql(row.household_id)}, ${sql(row.freezer_name)}, ${Number(freezerPositions.get(row.freezer_id))}, ${sql(generatedAt)}, ${sql(generatedAt)});`);
  }
  for (const row of drawers.values()) {
    lines.push(`INSERT OR IGNORE INTO drawers (id, freezer_id, name, position, created_at, updated_at) VALUES (${sql(row.drawer_id)}, ${sql(row.freezer_id)}, ${sql(row.drawer_name)}, ${Math.max(1, Math.min(8, Number(row.drawer_position) || 1))}, ${sql(generatedAt)}, ${sql(generatedAt)});`);
  }
  for (const row of records) {
    const ownerId = recoveryOwnerId(row.household_owner_email);
    const deletedAt = row.status === "deleted" ? sql(row.deleted_at_utc || row.updated_at_utc || generatedAt) : "NULL";
    lines.push(`INSERT OR REPLACE INTO items (id, household_id, freezer_id, drawer_id, label, frozen_on, expires_on, notes, image_id, version, created_by_user_id, updated_by_user_id, created_at, updated_at, deleted_at) VALUES (${sql(row.item_id)}, ${sql(row.household_id)}, ${sql(row.freezer_id)}, ${sql(row.drawer_id)}, ${sql(row.label)}, ${sql(row.frozen_on)}, ${row.expires_on ? sql(row.expires_on) : "NULL"}, ${sql(row.notes)}, NULL, ${Number(row.item_version)}, ${sql(ownerId)}, ${sql(ownerId)}, ${sql(row.created_at_utc || generatedAt)}, ${sql(row.updated_at_utc || generatedAt)}, ${deletedAt});`);
  }
  lines.push("COMMIT;");
  return `${lines.join("\n")}\n`;
}

const csvPath = argument("--csv");
const table = csvPath ? parseCsv(await readFile(resolve(csvPath), "utf8")) : await googleRows();
const records = validate(table);
const canonicalRows = records
  .map(({ _row, ...row }) => row)
  .sort((left, right) => left.item_id.localeCompare(right.item_id));
const rowHash = createHash("sha256").update(JSON.stringify(canonicalRows)).digest("hex");
const active = records.filter((row) => row.status === "active").length;
const deleted = records.length - active;
const summary = {
  mode: process.argv.includes("--confirm") ? "confirmed-sql-output" : "dry-run",
  schemaVersion: 3,
  rows: records.length,
  active,
  tombstones: deleted,
  households: new Set(records.map((row) => row.household_id)).size,
  freezers: new Set(records.map((row) => row.freezer_id)).size,
  drawers: new Set(records.map((row) => row.drawer_id)).size,
  deterministicRowHash: rowHash,
  limitations: ["shared members and invitations are not restored", "image bytes and metadata are not restored", "empty structures are not restored"],
};
console.log(JSON.stringify(summary, null, 2));

if (process.argv.includes("--confirm")) {
  const output = resolve(argument("--out") || "recovery.sql");
  await writeFile(output, buildSql(records), { mode: 0o600 });
  console.log(`Wrote recovery SQL to ${output}`);
} else {
  console.log("Dry run only. Re-run with --confirm --out <path.sql> after reviewing the counts and hash.");
}
