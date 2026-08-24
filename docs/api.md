# Machine surface: REST API and MCP

The planning engine (`public/network-core.js`) is a pure, deterministic model.
Both machine surfaces are thin stateless wrappers over it, served by the same
Worker that serves the app:

- `/api/v1/*` — versioned REST endpoints (this document)
- `/mcp` — an MCP tool server for AI agents (Streamable HTTP, stateless JSON mode)

Nothing is stored. There are no accounts, no cookies and no user data. Every
operation is a computation on the design document you send.

## Conventions

| Aspect | Value |
| --- | --- |
| Base URL | `https://network.illek.ie` |
| Versioning | Path-prefixed (`/api/v1`); breaking changes ship under `/api/v2` |
| Request bodies | `application/json` only; anything else returns `415` |
| Size limit | 1 MiB per request body (`413` beyond) |
| Caching | All API responses are `Cache-Control: no-store` |
| Indexing | `X-Robots-Tag: noindex, nofollow` on every API response |
| CORS | `Access-Control-Allow-Origin: *` with `OPTIONS` preflight |
| Security | The full site hardening set (CSP, HSTS, COOP/CORP, …) rides on every response |

Error envelope:

```json
{ "ok": false, "error": { "code": "invalid_design", "message": "…" } }
```

Status mapping: `400` invalid input or unallocatable request, `404` unknown
path, `405` wrong method (`Allow` header says what is allowed), `413` oversized,
`415` wrong media type, `500` internal (never expected).

## Endpoints

### `GET /api/v1`

Self-describing directory: service name and version, schema id/version, and the
endpoint list below.

### `GET /api/v1/openapi.json`

An OpenAPI 3.1 description of every operation, including a structural schema of
the canonical design document.

### `POST /api/v1/validate`

Canonicalize a design against schema v3 and run all hard checks.

```sh
curl -sS https://network.illek.ie/api/v1/validate \
  -H 'Content-Type: application/json' \
  -d '{"design": {"schema":"network-planner-studio/design","version":3,"sites":[],"links":[]}}'
```

```json
{
  "ok": true,
  "result": {
    "valid": true,
    "design": { "…canonical v3 document…" },
    "corrections": [],
    "errors": [],
    "warnings": []
  }
}
```

- `corrections` — human-readable notes about values normalized during migration
  (bounded numbers, canonical CIDR spelling). A non-empty list means the input
  was lossy or non-canonical.
- `errors` / `warnings` — structured issues with `path`, `message`, `code`
  (`invalid-cidr`, `overlap`, `outside-parent`, `duplicate-id`, …).
- `valid` is true only when both lists are empty.

### `POST /api/v1/review`

Runs exactly the heuristics the browser workspace shows: weighted score and
findings for overlaps, capacity headroom, single-WAN dependencies, isolated
sites, missing management segments, static-route intent and hub-and-spoke
policy conflicts.

```json
{ "ok": true, "result": {
    "score": 93,
    "summary": { "errors": 0, "warnings": 1, "advice": 0 },
    "issues": [ { "severity": "warning", "title": "Single WAN dependency", "message": "…", "siteId": "branch" } ] } }
```

### `POST /api/v1/route`

Traces the shortest permitted inter-site path. Sites may be referenced by id or
exact name; hub-and-spoke transit policy comes from the submitted design.

```json
{ "design": { "…design…" }, "from": "Dublin office", "to": "hq" }
```

Response: `reachable`, `hops` (names), `hopIds`, `links`, and the
`policyApplied` values used for the decision.

### `POST /api/v1/subnets/next`

Allocates the next aligned free subnet inside a parent range:
`{"parent":"10.20.0.0/16","prefix":24,"occupied":["10.20.0.0/24","10.20.1.0/24"]}`
→ `{"cidr":"10.20.2.0/24"}`. Exhausted parents return `400 unallocatable`.

### `POST /api/v1/site-range/suggest`

Suggests a non-overlapping RFC1918 block sized for a device count:
`{"occupied":["10.20.0.0/16"],"devices":50}` → `{"cidr":"10.21.0.0/20"}`.

## MCP server

Connect an MCP client to `https://network.illek.ie/mcp`. The server implements
the Streamable HTTP transport in stateless JSON mode:

- `initialize` negotiates protocol `2025-06-18` (also accepts `2025-03-26`)
- `tools/list` returns five tools
- `tools/call` computes and returns `structuredContent`; engine rejections come
  back as tool results with `isError: true`, never as protocol errors
- notifications are answered with `202 Accepted`; `GET`/`DELETE` return `405`;
  batching is rejected per the 2025-06-18 spec

| Tool | Purpose |
| --- | --- |
| `validate_design` | Canonicalize + hard-check a design document |
| `review_design` | Workspace review score and findings |
| `find_route` | Permitted inter-site path trace |
| `next_subnet` | Next aligned free subnet inside a parent |
| `suggest_site_range` | Private site block suggestion |

Example round trip:

```sh
curl -sS https://network.illek.ie/mcp \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call",
       "params":{"name":"next_subnet",
                 "arguments":{"parent":"10.20.0.0/16","prefix":24,"occupied":["10.20.10.0/24"]}}}'
```

## Operational notes

- **No rate limiting at the application layer.** Requests are pure compute over
  small JSON documents; abuse protection relies on Cloudflare's platform-level
  safeguards. If heavier use emerges, add a KV/DO-based limiter behind the same
  routes.
- **No persistence, therefore no data risk.** Designs sent to the API are not
  written anywhere.
- **Version pinning.** Clients should read `version` from `GET /api/v1` or the
  OpenAPI `info.version` and treat new optional fields as additive.
