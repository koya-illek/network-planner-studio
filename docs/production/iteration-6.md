# Production Iteration 6 Plan (2026-08-22)

Branch: `production/iteration-6` (from `production/iteration-5`, identical trees at start).
Live URL: https://network.illek.ie — inspected read-only during planning: still serving the
round-2 build (`/api/health` reports `0.2.0`; `/app.js` hash differs from HEAD). Deploying
remains out of scope per task rules; this iteration hardens the tree the next deploy ships as v0.6.0.

## Audience and core job (reconfirmed)

Network planners and MSP engineers designing small/mid IPv4 estates entirely in the browser:
map sites, VLANs and WAN intent, validate addressing math, trace routes under policy, export
JSON/CSV/print artifacts. Primary path: open app → start or sample design → add site/VLAN/link →
review → export. Trust boundary: the browser only; imports are hostile input; nothing
user-controlled reaches the server.

## Confirmed findings (each reproduced before planning)

### F1 — Edits made outside the Topology tab corrupt the canvas layout until another re-render

`renderCanvas()` sizes everything from `canvas.clientWidth/clientHeight`, falling back to
800×600 when the element measures 0. The topology view is `display:none` while another tab is
active, so any edit made there (policy-cell click, rename dialog, undo/redo, rerun review)
re-renders the hidden canvas against the fallback: node percentages are computed for an 800-wide
space and the SVG viewBox is written as `0 0 800 600`.

Evidence (Playwright probe, sample design, 1440×1000): before editing,
`canvasW=870, nodeLeftPct=42, viewBox="0 0 870 822"`; after clicking one policy cell on the
Traffic policy tab and returning to Topology, `viewBox="0 0 800 600"`, node paints at 38.6% of
the canvas. Links are additionally distorted by the non-uniform viewBox scale. Nothing restores
the geometry until some other render happens with the view visible.

Impact: after any edit from another tab, the primary view shows misplaced nodes and stretched
links — the product's core visual.

Intended change: make visibility part of the render contract. When the topology view is hidden,
`render()` marks the canvas dirty instead of rendering it blind; `activateView("topology")`
flushes a dirty canvas (with focus keeping). The resize listener does the same. No change to
layout math itself.

Regression test: Playwright test that cycles a policy cell on the policy tab, returns to
topology, and asserts the viewBox matches the measured canvas box and node positions are
preserved within 1 px-equivalent. Verified to fail on the unfixed tree.

### F2 — Mobile Sites drawer `aria-expanded` lies after selection closes it

The drawer toggle sets `aria-expanded` when toggled, but the selection handler
(`[data-site]`) closes the panel by removing `.mobile-open` without updating the attribute;
leaving/re-entering the workspace leaves it stale too.

Evidence (probe, 390 px): open drawer → `aria-expanded=true`; tap a site row → panel closes but
attribute still reports `true`. Screen readers announce an expanded panel that is closed.
Related inconsistency found while reproducing: tapping a VLAN row never closes the drawer at
all, unlike tapping a site row.

Intended change: one `setMobileSites(open)` helper owns the class and the attribute; used by
the toggle, by site and VLAN selection, and when entering/leaving the workspace. VLAN rows now
close the drawer like site rows.

Regression test: extend the mobile probe into an e2e assertion of attribute parity across
open → select-site → reopen → select-vlan.

### F3 — Keyboard focus falls to `<body>` after dialog-driven edits from inspector buttons

Iteration 4 added focus keeping for row/node/link/policy elements, but the identity table does
not cover inspector action buttons or the per-site `+` mini button. After their dialogs submit,
the debounced render rebuilds the DOM and focus drops to `<body>`.

Evidence (probe): focus `.add-vlan-mini`, Enter, submit → `BODY`; focus `[data-edit-vlan]`,
Enter, submit devices edit → `BODY`. Same family as the iteration-4 High finding; keyboard and
screen-reader users are dumped at the top of the document after every such edit.

Intended change: extend `focusKeeper()` with stable selectors for surviving targets:
`.add-vlan-mini[data-add-vlan]` plus attribute-scoped inspector origins
(`#inspector [data-edit-vlan|data-edit-site|data-edit-link|data-inspector-add-vlan|data-recommend-vlan|data-trace-link]`).
When an inspector-origin target no longer exists (entity deleted / inspector switched views),
focus falls back to the `#inspector` container instead of `<body>`. Deletion paths keep their
existing explicit refocus.

Regression test: Playwright test asserting focus lands back on the mini button after adding a
VLAN through it, and on the inspector after an inspector-button edit whose target view changed.

### F4 — Redirect responses carry no security headers (verified live)

`curl -sSI http://network.illek.ie/` (308) and `https://netplanner.illek.ie/` (301) return
none of the security headers — no HSTS on the alias hop, no nosniff/referrer policy on either.
Redirects are responses too; the alias HTTPS hop genuinely benefits from HSTS, and consistent
headers remove a class of edge surprises.

Evidence: live curl matrix above, 2026-08-22; worker code applies `SECURITY_HEADERS` only to
asset and health branches.

Intended change: build redirect responses with the same header set. Location handling unchanged;
no weakening anywhere.

Regression test: unit assertions in `test/redirects.test.js` that every redirect carries the
security headers and an intact Location.

### F5 — `nextSubnet()` walks CIDR strings and reparses per occupied entry

The allocation loop steps candidate-by-candidate through the parent range, calling
`rangesOverlap(candidate, value)` per occupied entry — each call reparses both CIDRs inside
try/catch. Cost is O(range/size × occupied) string parsing.

Evidence (node benchmark): `nextSubnet("10.0.0.0/8", 31, ["10.0.0.0/16"])` takes 77 ms because
one occupied /16 forces 32k parse-pairs; a /8 parent with several occupied /16–/24 blocks (or a
near-exhausted range) scales linearly worse, freezing the tab on modest hardware. Reachable
through normal UI: enter a /8 site range, add a transit VLAN with ≤2 devices (requests /31).

Intended change: rewrite `nextSubnet()` in `public/network-core.js` using numeric interval
math — parse each occupied CIDR once, sort intervals, walk gaps with aligned jumps. Identical
results and error messages for all valid inputs; invalid occupied values keep being ignored
(matching `rangesOverlap`'s catch behaviour).

Regression test: equivalence fuzz against the previous algorithm's semantics on randomized
parents/prefixes/occupied sets, alignment edge cases, and a timing guard for the pathological
case above (generous bound to stay CI-safe).

### F6 — Pending edits can be lost in the debounce window on tab close

`touch()` defers `saveState()` by 220 ms. Closing the tab inside that window silently drops
the last edit (rename, note keystroke, policy cycle).

Intended change: flush any pending save on `pagehide`.

Regression test: static assertion of the wiring.

### F7 — Release provenance bump

Per convention (rounds 3–5): bump `package.json` and the worker health payload 0.5.0 → 0.6.0
together; the existing static test enforces sync.

## Maintenance

- Refresh dev dependencies within semver ranges (`@playwright/test` 1.61.1→1.62.1,
  `wrangler` 4.123.0→4.125.0); both dev-only, MIT/Apache-licensed, no runtime bundle impact.
- `ARCHITECTURE.md`: refresh the accessibility model line (drawer state truth, dialog-action
  focus coverage) and note the deferred canvas rendering behaviour.

## Files

- `public/app.js` — F1 dirty-flag render, F2 drawer state helper, F3 keeper extension, F6 pagehide flush
- `public/network-core.js` — F5 nextSubnet rewrite
- `worker.js` — F4 headers on redirects, F7 version payload
- `package.json` — F7 version bump, dependency refresh
- `test/network-core.test.js` — F5 equivalence/timing tests
- `test/redirects.test.js` — F4 header assertions
- `test/static.test.js` — F6/F2/F3/F1 static guards where cheap
- `tests/planner.spec.js` — F1/F2/F3 e2e regressions
- `docs/production/iteration-6.md` — this plan; `ARCHITECTURE.md` refresh
- Report log appended at `/home/koya/ox-reviews-2026-08-22/network-planner-studio.md`

## User impact

- The topology canvas stays geometrically truthful no matter which tab an edit was made from (F1).
- Screen readers get truthful drawer state; VLAN taps close the drawer like site taps (F2).
- Keyboard users keep their place after every dialog-driven edit (F3).
- Alias/HTTP hops carry the same hardening as content responses (F4).
- Subnet allocation stays instant even for large parent ranges (F5).
- The last edit survives a quick tab close (F6); next deploy reports v0.6.0 (F7).
- No workflow, data-format, storage-layout or copy changes.

## Risk

Low-to-moderate, concentrated in F1's render-flow change (mitigated by the dirty flag defaulting
to today's behaviour whenever the view is visible) and F5's core rewrite (mitigated by
equivalence fuzzing against the old semantics). All others are additive.

## Verification

1. `npm test` — unit + static incl. new F4/F5/F6 coverage.
2. `npm run test:e2e` — existing 17 + new F1/F2/F3 regressions, axe-core and CSP gates.
3. F1 regression check fails pre-fix (verified via stash) and passes post-fix.
4. Header matrix via `wrangler dev`: security headers on `/`, `/api/health`, assets, 404 **and**
   simulated redirect paths; health version `0.6.0`; asset caching untouched.
5. Responsive probe 1440/768/390: no horizontal overflow; drawer aria parity; focus retention;
   reduced-motion behaviour intact.
6. `audit-html.mjs` + Lighthouse on the local server; live read-only spot-check.
7. `npx wrangler deploy --dry-run` clean.

## Explicit non-goals (carried decisions, deliberately unchanged)

- No deploy/push/publish; the live site intentionally stays on the round-2 build until the owner deploys.
- IndexedDB / corrupt-library write-gating — capped library plus recovery messaging retained (rounds 1–5 decisions).
- Zero-build/no-minification architecture, `run_worker_first = true`, CSP allowlist shape — unchanged.
- Mobile pinch-zoom, light theme — carried tradeoffs with prior rationale.
- No new features; six reproduced defects plus provenance and dependency hygiene only.
