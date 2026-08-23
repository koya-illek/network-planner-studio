# Production Iteration 4 Plan — network-planner-studio

Date: 2026-08-22. Branch: `production/iteration-4` (from `ox-round3-baseline`, currently identical to it).
Live deployment inspected 2026-08-22: serves the round-2 build (`/api/health` version `0.2.0`, bare 404 body, pre-round-3 asset hashes). Deploying is out of scope for this iteration; HEAD already carries round 3.

## Audience and core job

Network planners and MSP engineers modelling IPv4 site/VLAN/WAN designs entirely in the browser. The primary path is: start or reopen a design, add sites and VLANs (manual or recommended), review conflicts, export a report. Trust boundary: imports are hostile input; everything else stays local; no backend project data.

## Confirmed findings (reproduced before planning)

1. **Keyboard focus is destroyed by every selection re-render** (accessibility, High).
   Reproduced with a Playwright probe against `wrangler dev` at 1440px:
   - Enter on a `.vlan-row` → `document.activeElement` becomes `<body>`.
   - Enter on a `.topology-node` → focus dropped.
   - Enter on a `.site-row-select` → focus dropped.
   - Activating a `[data-flow]` policy cell → focus survives the click but the debounced `touch()` re-render 220 ms later rebuilds the matrix and drops focus to `<body>`.
   - Browser zoom / window resize triggers `renderCanvas()` directly, also destroying node focus (relevant to the 200% zoom check).
   Root cause: `render()`/`renderCanvas()` replace `innerHTML` of the lists, canvas layers, inspector and matrix without focus continuity. Keyboard users are dumped on `<body>` after each selection and must Tab from the top of the document.

2. **Missing cross-origin hardening headers** (security, Low).
   No `Cross-Origin-Opener-Policy` or `Cross-Origin-Resource-Policy` on any response class. The app opens no popups and embeds no cross-origin resources (CSP allows only self plus Cloudflare Insights), so `same-origin` values cannot break anything while closing XS-Leak/embed vectors on shared edge infrastructure.

3. **Documentation drift** (maintainability, Low).
   `ARCHITECTURE.md` says "Last reviewed: 2026-08-15" and predates three hardening rounds: 20-project library cap, 10 MB import ceiling, reduced-motion support, branded 404 handling, tolerant internal revival, keyboard nudge/link activation. `IMPROVE-PLAN.md` holds the superseded round-3 plan while this iteration's plan convention moves to `docs/production/iteration-N.md`.

4. **Release provenance skew** (operations, Low).
   Live `/api/health` reports `0.2.0`; HEAD is `0.3.0` undeployed. This iteration's changes warrant one coherent bump to `0.4.0` so the next deploy carries a single truthful version (sync enforced by `test/static.test.js`).

## Intended changes

| # | Change | Files | User impact | Risk |
| --- | --- | --- | --- | --- |
| 1 | Focus preservation across re-renders: capture a stable selector (`data-vlan`, `data-site`, `data-link`, `data-flow`) for the focused element before render sections run and restore focus when it was lost to `<body>`; wire into `render()` and the resize relayout path | `public/app.js` | Keyboard and screen-reader users keep their place after selecting sites, VLANs, links, cycling policy cells, or zooming | Low: restoration only fires when focus actually fell to `<body>`; explicit refocus after arrow-key nudge unchanged |
| 2 | Add `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Resource-Policy: same-origin` | `worker.js`, `public/_headers` | None for legitimate use; hardens response embedding | Very low: verified locally on `/`, `/api/health`, and 404 responses |
| 3 | Version bump 0.3.0 → 0.4.0 | `package.json`, `worker.js` | Health payload matches next release | Very low |
| 4 | Refresh architecture documentation; delete superseded round-3 plan file | `ARCHITECTURE.md`, remove `IMPROVE-PLAN.md` | Docs match shipped behavior | None |
| 5 | Regression coverage: static assertions for headers and focus wiring; Playwright test covering Enter-selection focus retention (VLAN row, site row) and policy-cell focus retention past the debounce | `test/static.test.js`, `tests/planner.spec.js` | Prevents silent regression | None |

## Verification

- `npm test` (unit + static).
- `npm run test:e2e` (15 existing + new focus test, axe gate included).
- `wrangler dev` + curl: COOP/CORP present on `/`, `/api/health`, unknown path; redirects still correct.
- Skill `scripts/audit-html.mjs` against local `/` and `/404.html`.
- Responsive probe at 390 / 768 / 1440 CSS px: no horizontal overflow, selection focus retained, mobile Sites drawer intact.
- `wrangler deploy --dry-run`.

## Explicit non-goals

- No deploy, push, or publish (prohibited this round; live site intentionally left on round-2 build).
- No IndexedDB/storage-engine migration or corrupt-library write-gating (deliberate round-1/3 decisions; capped library remains adequate).
- No build/minification step, no `run_worker_first` change, no CSP relaxation (carried decisions from rounds 1–3).
- No mobile pinch-zoom implementation (accepted tradeoff since round 2).
- No new features; this iteration removes risk rather than adding surface.
