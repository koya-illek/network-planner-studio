# Production Iteration 5 Plan (2026-08-22)

Branch: `production/iteration-5` (from `production/iteration-4`, identical trees at start).
Live URL: https://network.illek.ie — inspected read-only during planning: still serving the
round-2 build (`/api/health` reports `0.2.0`; asset hashes differ from HEAD). Deploying remains
out of scope per task rules; this iteration hardens the tree the next deploy will ship as v0.5.0.

## Audience and core job (reconfirmed)

Network planners and MSP engineers designing small/mid IPv4 estates locally: map sites, VLANs,
WAN intent and policy, validate addressing math, export JSON/CSV/print artifacts. Primary path:
open app → start or sample design → add site/VLAN/link → review → export. Trust boundary: the
browser only; imports are hostile input; nothing user-controlled reaches the server.

## Confirmed findings (all reproduced on this tree before planning)

### F1 — `npm run dev` infinite-redirects every request (Bug, release ops)

Wrangler 4.x simulates `wrangler.toml` custom-domain routes in local dev: inside the Worker,
`request.url` arrives as `http://network.illek.ie/...`. `redirectForRequest()` correctly treats
plain-http canonical-host traffic as production and issues the http→https 308; wrangler then
rewrites the Location back to the local origin, producing a redirect loop for **every** path.

Evidence: bare `npx wrangler dev --port 8796` returns `308 Location: http://127.0.0.1:8796/`
(self-loop) for `/`, `/api/health`, `/styles.css`, `/nope`; a temporary probe showed
`request.url = http://network.illek.ie/api/health`. The e2e webServer invocation
(`wrangler dev --local --host 127.0.0.1`) is unaffected: same tree serves `200` with correct body.

Impact: the documented developer entry (`README.md` "Run locally", package.json `dev` script)
is broken for contributors; iteration-4's local verification path no longer works as documented.

Intended change: pin the proven flags in `package.json` `scripts.dev`:
`wrangler dev --local --host 127.0.0.1`. Do not weaken the production redirect logic — plain-http
canonical-host requests must keep upgrading in production, and spoofable headers stay ignored.

Regression test: static assertion that `scripts.dev` pins the host so the loop cannot silently
return via a script edit.

### F2 — Topology nodes paint wider than the layout math assumes (Layout bug, 721–1050 px band)

`renderCanvas()` computes `nodeWidth = w<600 ? 150 : 180` from the canvas element and uses it for
centering and right-edge clamping, but the painted width comes from CSS
(`.topology-node{width:180px}`, 150 px only under the 720 px viewport media query). For viewports
~721–1050 px the grid gives the canvas <600 px while the viewport media query still paints 180 px:
nodes are clamped/centered for a 150 px box but render 180 px wide.

Evidence (Playwright probe, sample design): viewport 768 → canvas 548 px, "Dublin office" paints
16 px past the canvas's right edge (clipped by `overflow:hidden`); viewport 800 → 6 px overhang;
link endpoints anchor at `left+75` while the visual center is `left+90`. At 390 and ≥1050 px both
sources agree (verified).

Impact: clipped nodes and misaligned connectors exactly at the 768 px tablet width that this
project treats as a first-class test dimension.

Intended change: make positioning and painting share one source of truth — `renderCanvas()` sets
the node width explicitly from the same `nodeWidth` value used for layout. One line; CSS media
query stays as a fallback.

Regression test: Playwright test asserting, at 768×900, every `.topology-node` box fits inside the
canvas and reports the expected width.

### F3 — `/api/health` responses are cacheable (Ops hygiene)

The health endpoint carries release provenance (`version`) but sets no `Cache-Control`, so any
intermediary that does cache it could serve stale release truth. Workers responses are not cached
by default today; the header makes the intent explicit and safe under future configuration changes.

Intended change: set `Cache-Control: no-store` on health responses only (GET/HEAD/OPTIONS/405).
Must NOT go into `SECURITY_HEADERS`, which also apply to assets and would disable edge caching.

Regression test: extend static test to assert worker.js sets no-store on the health response.

### F4 — Release provenance bump

Per established convention (round 3, iteration 4): bump `package.json` and the worker health
payload 0.4.0 → 0.5.0 together; the existing static test enforces their sync.

## Files

- `package.json` — dev-script fix (F1), version bump (F4)
- `public/app.js` — node width source of truth (F2)
- `worker.js` — health `Cache-Control: no-store` (F3), version payload (F4)
- `test/static.test.js` — regression coverage F1, F3
- `tests/planner.spec.js` — regression coverage F2
- `docs/production/iteration-5.md` — this plan
- Report log appended at `/home/koya/ox-reviews-2026-08-22/network-planner-studio.md`

## User impact

- Contributors get a working `npm run dev` again (F1).
- Tablet users stop seeing nodes clipped at the screen edge and connectors meeting boxes off-center (F2).
- Release provenance cannot be served stale by a cache (F3); next deploy reports v0.5.0 (F4).
- No workflow, data format, storage layout, or copy changes.

## Risk

Low. All four changes are small and independently verifiable. Main care points: do not put
`no-store` into the shared security-header set (would break asset caching); do not touch
`redirectForRequest()` production behavior (covered by existing unit tests).

## Verification

1. `npm test` — all unit/static tests including new assertions.
2. `npm run test:e2e` — all browser tests including the new 768 px containment test, axe and CSP gates.
3. Probe matrix on `wrangler dev` (e2e variant): health status/body/version/headers incl. `Cache-Control: no-store`, COOP/CORP on `/`, `/api/health`, 404; no self-redirect anywhere.
4. Re-run the five-width node-box probe (1440/1024/800/768/390) post-fix: zero overhang, widths consistent.
5. `npx wrangler deploy --dry-run` clean.
6. audit-html + Lighthouse on the local server; live read-only spot-check unchanged.

## Explicit non-goals (carried decisions, deliberately unchanged)

- No deploy/push/publish; the live site intentionally stays on the round-2 build until the owner deploys.
- IndexedDB / corrupt-library write-gating — capped library plus recovery messaging retained (rounds 1–4 decisions).
- Zero-build/no-minification architecture, `run_worker_first = true`, CSP allowlist shape — unchanged.
- Mobile pinch-zoom, light theme — carried tradeoffs with prior rationale.
- No new features; no speculative refactors. Four reproduced defects and provenance hygiene only.
