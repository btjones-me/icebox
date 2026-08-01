import { isAllowedLocalOrigin, isLocalDevRequest } from "./local-mode.js";

export class HttpError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      ...headers,
    },
  });
}

export function methodNotAllowed(allowed) {
  return json({ error: { code: "method_not_allowed", message: "Method not allowed" } }, 405, {
    allow: allowed.join(", "),
  });
}

export async function readJson(request, maxBytes = 32_768) {
  const length = Number(request.headers.get("content-length") || 0);
  if (length > maxBytes) throw new HttpError(413, "body_too_large", "Request body is too large");
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > maxBytes) {
    throw new HttpError(413, "body_too_large", "Request body is too large");
  }
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    throw new HttpError(400, "invalid_json", "Request body must be valid JSON");
  }
}

export function assertOrigin(request, env) {
  if (["GET", "HEAD", "OPTIONS"].includes(request.method)) return;
  const origin = request.headers.get("origin");
  const expected = new URL(request.url).origin;
  if (isLocalDevRequest(request, env) && origin && isAllowedLocalOrigin(origin)) return;
  if (!origin || origin !== expected) {
    throw new HttpError(403, "invalid_origin", "Request origin was not accepted");
  }
}

export function normalizeEmail(value) {
  return String(value || "").trim().toLocaleLowerCase("en-US");
}

export function cleanText(value, maxLength, label, { required = true } = {}) {
  const text = String(value ?? "").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").trim();
  if (required && !text) throw new HttpError(400, "validation_error", `${label} is required`);
  if (text.length > maxLength) throw new HttpError(400, "validation_error", `${label} is too long`);
  return text;
}

export function isIsoDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value)) && !Number.isNaN(new Date(`${value}T12:00:00Z`).getTime());
}

export function uuid() {
  return crypto.randomUUID();
}

export function nowIso() {
  return new Date().toISOString();
}

export async function sha256Hex(value) {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((entry) => entry.toString(16).padStart(2, "0")).join("");
}

export function securityHeaders(response) {
  const headers = new Headers(response.headers);
  headers.set("referrer-policy", "same-origin");
  headers.set("x-frame-options", "DENY");
  headers.set("permissions-policy", "camera=(self), microphone=(), geolocation=()");
  headers.set(
    "content-security-policy",
    "default-src 'self'; img-src 'self' blob: data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self' https://api.openai.com https://oauth2.googleapis.com https://sheets.googleapis.com; object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
  );
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export function errorResponse(error, requestId) {
  if (error instanceof HttpError) {
    return json(
      { error: { code: error.code, message: error.message, details: error.details }, requestId },
      error.status,
    );
  }
  console.error(JSON.stringify({ event: "request_failed", requestId, error: error?.name || "Error" }));
  return json({ error: { code: "internal_error", message: "Something went wrong" }, requestId }, 500);
}
