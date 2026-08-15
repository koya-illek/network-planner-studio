const SECURITY_HEADERS = {
  "Content-Security-Policy": "default-src 'self'; script-src 'self' https://static.cloudflareinsights.com; style-src 'self'; img-src 'self' data:; connect-src 'self' https://cloudflareinsights.com; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains"
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
      if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
      if (!["GET", "HEAD"].includes(request.method)) return Response.json({ ok: false, error: "method_not_allowed" }, { status: 405, headers });
      const body = JSON.stringify({ ok: true, service: "network-planner-studio", version: "0.2.0", schema: "network-planner-studio/design", schemaVersion: 3 });
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
    url.hostname = "network.illek.ie";
    url.protocol = "https:";
    return Response.redirect(url.toString(), 301);
  }
  if (url.protocol === "http:" && !localRequest) {
    url.protocol = "https:";
    return Response.redirect(url.toString(), 308);
  }
  return null;
}

function isLocalDevelopmentHost(hostname) {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}
