/*
 * Single source of the platform's response hardening. The worker applies this
 * set to every response — pages, API and MCP alike — so no route can ship an
 * unhardened hop. public/_headers mirrors it for direct asset responses.
 */
export const SECURITY_HEADERS = Object.freeze({
  "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains; preload"
});

/*
 * Machine surfaces (/api/v1, /mcp) are public stateless compute: they add
 * no-store caching, noindex and wildcard CORS to the hardened base set.
 */
export function machineResponseHeaders() {
  const headers = new Headers(SECURITY_HEADERS);
  headers.set("Cache-Control", "no-store");
  headers.set("X-Robots-Tag", "noindex, nofollow");
  headers.set("Access-Control-Allow-Origin", "*");
  return headers;
}

export function machinePreflightHeaders() {
  const headers = machineResponseHeaders();
  headers.set("Access-Control-Allow-Methods", "GET, HEAD, POST, OPTIONS");
  headers.set("Access-Control-Allow-Headers", "Content-Type");
  headers.set("Access-Control-Max-Age", "86400");
  return headers;
}
