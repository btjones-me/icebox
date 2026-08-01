export const LOCAL_IDENTITY = Object.freeze({
  id: "local-alex",
  email: "alex@example.com",
  emailNormalized: "alex@example.com",
  fullName: "Alex Morgan",
});

export function isLocalDevRequest(request, env) {
  if (env?.LOCAL_DEV_MODE !== "1") return false;
  const hostname = new URL(request.url).hostname;
  return hostname === "127.0.0.1" || hostname === "localhost";
}

export function isAllowedLocalOrigin(origin) {
  return new Set([
    "http://127.0.0.1:4173",
    "http://localhost:4173",
    "http://127.0.0.1:4174",
    "http://localhost:4174",
    "http://127.0.0.1:8787",
    "http://localhost:8787",
  ]).has(origin);
}
