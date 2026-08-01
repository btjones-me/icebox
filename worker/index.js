import { routeApi } from "./lib/api.js";
import { errorResponse, securityHeaders, uuid } from "./lib/http.js";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === "/healthz") {
      return securityHeaders(new Response("ok", { headers: { "cache-control": "no-store" } }));
    }
    if (url.pathname.startsWith("/api/")) {
      const requestId = uuid();
      try {
        return securityHeaders(await routeApi(request, env, ctx));
      } catch (error) {
        return securityHeaders(errorResponse(error, requestId));
      }
    }

    const response = await env.ASSETS.fetch(request);
    const acceptsHtml = request.headers.get("accept")?.includes("text/html");

    if (response.status !== 404 || !acceptsHtml || !["GET", "HEAD"].includes(request.method)) {
      return securityHeaders(response);
    }

    const indexUrl = new URL(request.url);
    indexUrl.pathname = "/index.html";
    indexUrl.search = "";
    return securityHeaders(await env.ASSETS.fetch(new Request(indexUrl, request)));
  },
};
