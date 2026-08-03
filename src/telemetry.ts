export type ClientLogLevel = "info" | "warn" | "error";

export type ClientTelemetryEvent = {
  id: string;
  sequence: number;
  sessionId: string;
  type: string;
  level: ClientLogLevel;
  occurredAt: string;
  metadata: Record<string, unknown>;
};

const MAX_RECENT_EVENTS = 80;
const MAX_PENDING_EVENTS = 80;
const FLUSH_BATCH_SIZE = 20;
const clientSessionId = crypto.randomUUID();
let sequence = 0;
let recentEvents: ClientTelemetryEvent[] = [];
let pendingEvents: ClientTelemetryEvent[] = [];
let transportEnabled = false;
let flushing = false;
let installed = false;
let telemetryHouseholdId: string | null = null;

function clippedString(value: unknown, maxLength = 500) {
  return String(value ?? "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .slice(0, maxLength);
}

function sanitizeValue(value: unknown, depth = 0): unknown {
  if (depth > 3 || value == null) return value == null ? null : clippedString(value, 160);
  if (typeof value === "string") return clippedString(value);
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.slice(0, 20).map((entry) => sanitizeValue(entry, depth + 1));
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .slice(0, 30)
        .map(([key, entry]) => [clippedString(key, 64), sanitizeValue(entry, depth + 1)]),
    );
  }
  return clippedString(value, 160);
}

export function sanitizeTelemetryMetadata(metadata: Record<string, unknown> = {}) {
  return sanitizeValue(metadata) as Record<string, unknown>;
}

export function getClientSessionId() {
  return clientSessionId;
}

export function setTelemetryHouseholdId(householdId: string | null) {
  telemetryHouseholdId = householdId;
}

export function recordClientEvent(
  type: string,
  metadata: Record<string, unknown> = {},
  level: ClientLogLevel = "info",
) {
  const event: ClientTelemetryEvent = {
    id: crypto.randomUUID(),
    sequence: sequence += 1,
    sessionId: clientSessionId,
    type: clippedString(type.toLocaleLowerCase().replace(/[^a-z0-9_.-]/g, "_"), 64),
    level,
    occurredAt: new Date().toISOString(),
    metadata: sanitizeTelemetryMetadata(metadata),
  };
  recentEvents = [...recentEvents.slice(-(MAX_RECENT_EVENTS - 1)), event];
  pendingEvents = [...pendingEvents.slice(-(MAX_PENDING_EVENTS - 1)), event];
  if (transportEnabled && pendingEvents.length >= 12) void flushClientTelemetry();
  return event;
}

export function getRecentClientEvents(limit = 50) {
  return recentEvents.slice(-Math.max(1, Math.min(limit, MAX_RECENT_EVENTS)));
}

function normalizedRoute(input: RequestInfo | URL) {
  const raw = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const pathname = new URL(raw, window.location.origin).pathname;
  return pathname
    .replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, ":id")
    .replace(/\/(?:house|freezer|drawer|item|image)-[^/]+/gi, "/:id")
    .slice(0, 180);
}

export async function trackedFetch(input: RequestInfo | URL, init?: RequestInit) {
  const requestId = crypto.randomUUID();
  const method = String(init?.method || (input instanceof Request ? input.method : "GET")).toUpperCase();
  const route = normalizedRoute(input);
  const startedAt = performance.now();
  const headers = new Headers(init?.headers);
  headers.set("x-icebox-request-id", requestId);
  try {
    const response = await fetch(input, { ...init, headers });
    recordClientEvent("api_request", {
      requestId,
      route,
      method,
      status: response.status,
      durationMs: Math.round(performance.now() - startedAt),
    }, response.ok ? "info" : "warn");
    return { response, requestId };
  } catch (error) {
    recordClientEvent("api_network_error", {
      requestId,
      route,
      method,
      durationMs: Math.round(performance.now() - startedAt),
      error: error instanceof Error ? error.name : "Error",
    }, "error");
    throw error;
  }
}

export function feedbackDeviceContext(extra: Record<string, unknown> = {}) {
  const bundle = document.querySelector<HTMLScriptElement>('script[src*="/assets/index-"]')?.src.split("/").pop() ?? "unknown";
  return sanitizeTelemetryMetadata({
    route: `${window.location.pathname}${window.location.hash}`.slice(0, 240),
    bundle,
    viewport: { width: window.innerWidth, height: window.innerHeight, pixelRatio: window.devicePixelRatio },
    displayMode: window.matchMedia("(display-mode: standalone)").matches ? "standalone" : "browser",
    online: navigator.onLine,
    language: navigator.language,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    platform: navigator.platform,
    userAgent: navigator.userAgent.slice(0, 320),
    ...extra,
  });
}

export async function flushClientTelemetry({ keepalive = false } = {}) {
  if (!transportEnabled || flushing || pendingEvents.length === 0) return false;
  flushing = true;
  const batch = pendingEvents.splice(0, FLUSH_BATCH_SIZE);
  try {
    const response = await fetch("/api/telemetry", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId: clientSessionId, householdId: telemetryHouseholdId, events: batch }),
      keepalive,
    });
    if (!response.ok) throw new Error("Telemetry was not accepted");
    return true;
  } catch {
    pendingEvents = [...batch, ...pendingEvents].slice(-MAX_PENDING_EVENTS);
    return false;
  } finally {
    flushing = false;
  }
}

export function enableClientTelemetryTransport() {
  if (transportEnabled) return;
  transportEnabled = true;
  void flushClientTelemetry();
}

export function installClientTelemetry() {
  if (installed) return () => undefined;
  installed = true;
  const onError = (event: ErrorEvent) => {
    recordClientEvent("client_error", {
      message: clippedString(event.message, 300),
      source: event.filename ? event.filename.split("/").pop() : "unknown",
      line: event.lineno,
      column: event.colno,
      stack: event.error instanceof Error ? clippedString(event.error.stack, 1200) : "",
    }, "error");
  };
  const onUnhandledRejection = (event: PromiseRejectionEvent) => {
    const reason = event.reason;
    recordClientEvent("unhandled_rejection", {
      message: reason instanceof Error ? clippedString(reason.message, 300) : clippedString(reason, 300),
      stack: reason instanceof Error ? clippedString(reason.stack, 1200) : "",
    }, "error");
  };
  const onVisibilityChange = () => {
    if (document.visibilityState === "hidden") void flushClientTelemetry({ keepalive: true });
  };
  window.addEventListener("error", onError);
  window.addEventListener("unhandledrejection", onUnhandledRejection);
  document.addEventListener("visibilitychange", onVisibilityChange);
  const interval = window.setInterval(() => void flushClientTelemetry(), 30_000);
  recordClientEvent("app_started", feedbackDeviceContext());
  return () => {
    window.removeEventListener("error", onError);
    window.removeEventListener("unhandledrejection", onUnhandledRejection);
    document.removeEventListener("visibilitychange", onVisibilityChange);
    window.clearInterval(interval);
    installed = false;
  };
}
