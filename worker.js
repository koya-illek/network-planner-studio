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

    // Canonical host redirect: legacy/staging hostnames 301 to network.illek.ie
    if (url.hostname !== "network.illek.ie" && url.hostname !== "localhost" && !url.hostname.endsWith(".workers.dev")) {
      const target = new URL(request.url);
      target.hostname = "network.illek.ie";
      target.protocol = "https:";
      return Response.redirect(target.toString(), 301);
    }

    if (url.pathname === "/api/health") {
      return Response.json({
        ok: true,
        service: "network-planner-studio",
        version: "0.1.0"
      }, { headers: SECURITY_HEADERS });
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
