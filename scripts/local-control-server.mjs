#!/usr/bin/env node
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const controlRoot = path.join(projectRoot, "local-control");
const files = new Map([
  ["/", ["index.html", "text/html; charset=utf-8"]],
  ["/app.js", ["app.js", "text/javascript; charset=utf-8"]],
  ["/styles.css", ["styles.css", "text/css; charset=utf-8"]],
]);
const actions = new Set(["state", "demo", "empty", "fresh"]);

async function proxyApi(request, response, action) {
  const origin = request.headers.origin;
  if (origin && origin !== "http://127.0.0.1:4174" && origin !== "http://localhost:4174") {
    response.writeHead(403, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
    response.end(JSON.stringify({ error: { message: "Origin not accepted" } }));
    return;
  }
  if (!actions.has(action)) {
    response.writeHead(404).end();
    return;
  }
  const expectedMethod = action === "state" ? "GET" : "POST";
  if (request.method !== expectedMethod) {
    response.writeHead(405, { allow: expectedMethod }).end();
    return;
  }
  try {
    const upstream = await fetch(`http://127.0.0.1:8787/api/local-dev/${action}`, {
      method: request.method,
      headers: { origin: "http://127.0.0.1:4174" },
    });
    const body = await upstream.arrayBuffer();
    response.writeHead(upstream.status, {
      "content-type": upstream.headers.get("content-type") || "application/json; charset=utf-8",
      "cache-control": "no-store",
    });
    response.end(Buffer.from(body));
  } catch {
    response.writeHead(502, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
    response.end(JSON.stringify({ error: { message: "The Icebox local API is not running" } }));
  }
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url || "/", "http://127.0.0.1:4174");
  if (url.pathname.startsWith("/api/")) {
    await proxyApi(request, response, url.pathname.slice(5));
    return;
  }
  const entry = files.get(url.pathname);
  if (!entry || request.method !== "GET") {
    response.writeHead(404).end();
    return;
  }
  const [fileName, contentType] = entry;
  const body = await readFile(path.join(controlRoot, fileName));
  response.writeHead(200, {
    "content-type": contentType,
    "cache-control": "no-store",
    "content-security-policy": "default-src 'self'; style-src 'self'; script-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'",
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
  });
  response.end(body);
});

server.listen(4174, "127.0.0.1", () => {
  console.log("Icebox local data control ready at http://127.0.0.1:4174/");
});

function stop() {
  server.close(() => process.exit(0));
}
process.once("SIGINT", stop);
process.once("SIGTERM", stop);
