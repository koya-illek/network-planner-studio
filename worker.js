import packageMetadata from "./package.json" with { type: "json" };

const SECURITY_HEADERS = {
  "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains; preload"
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Canonical host redirect: legacy/staging hostnames 301 to network.illek.ie.
    const redirect = redirectForRequest(request);
    if (redirect) return redirect;
    if (url.pathname === "/api/health") {
      const headers = new Headers(SECURITY_HEADERS);
      headers.set("X-Robots-Tag", "noindex, nofollow");
      headers.set("Allow", "GET, HEAD, OPTIONS");
      // Health carries release provenance; no intermediary may serve it stale.
      headers.set("Cache-Control", "no-store");
      if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
      if (!["GET", "HEAD"].includes(request.method)) return Response.json({ ok: false, error: "method_not_allowed" }, { status: 405, headers });
      const body = JSON.stringify({ ok: true, service: packageMetadata.name, version: packageMetadata.version, schema: "network-planner-studio/design", schemaVersion: 3 });
      headers.set("Content-Type", "application/json; charset=utf-8");
      return new Response(request.method === "HEAD" ? null : body, { status: 200, headers });
    }

    const response = await env.ASSETS.fetch(request);
    const headers = new Headers(response.headers);
    for (const [key, value] of Object.entries(SECURITY_HEADERS)) headers.set(key, value);
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers
    });
  }
};

export function redirectForRequest(request) {
  const url = new URL(request.url);
  // Redirect decisions use only the runtime request URL. Host,
  // CF-Connecting-IP, and MF-Original-Hostname are client-controllable
  // headers and must not make a production HTTP request look local.
  // Wrangler tests use localhost/127.0.0.1 URLs directly.
  const localRequest = isLocalDevelopmentHost(url.hostname);
  if (!localRequest && url.hostname !== "network.illek.ie") {
    return redirectResponse(url, 301, "network.illek.ie");
  }
  if (url.protocol === "http:" && !localRequest) {
    return redirectResponse(url, 308);
  }
  return null;
}

// Redirects are responses too: they carry the same hardening headers as
// content, so alias hops still deliver HSTS and intermediaries never see an
// unhardened hop.
function redirectResponse(url, status, hostname) {
  if (hostname) url.hostname = hostname;
  url.protocol = "https:";
  const headers = new Headers(SECURITY_HEADERS);
  headers.set("Location", url.toString());
  return new Response(null, { status, headers });
}

function isLocalDevelopmentHost(hostname) {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}
