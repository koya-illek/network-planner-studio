# Production iteration 7 plan (2026-08-22)

Branch: `production/iteration-7` (from `production/iteration-6`, identical at start).
Baseline: unit 38/38, e2e 21/21, worktree clean. Live site still serves the round-2 build (`/api/health` reports `0.2.0`); deploying stays out of scope.

## Confirmed findings (each reproduced on this tree before planning)

1. **Editing a VLAN silently rewrites its gateway** (`public/app.js:554`). The VLAN form has no gateway field and submit always computes `gateway=firstUsable(cidr)`. A design imported from JSON or CSV may carry any valid gateway (probe: `10.60.10.254`); renaming the VLAN replaced it with `10.60.10.1` without telling the user. Same defect family as the round-3 growth-allowance reset. Data honesty bug on a primary editing path.
2. **Two tabs editing one design clobber each other silently** (`public/app.js` save path). Both tabs write the same `localStorage` current-design key; last writer wins and the loser's next edit destroys the other tab's work with no warning. Plausible for a workshop tool; cheap to surface honestly.
3. **`#canvas` exposes no role** (`public/index.html:116`). It is focusable with an `aria-label` but has no role, so many screen readers never announce the label for the main interaction surface.
4. **Dead imports in `public/app.js:1`**: `ipToInt`, `validHostInSubnet`, `validateDesign` appear only in the import statement.
5. **`suggestSiteRange` wrapper passes a dead third argument** (`public/app.js:72-74`): the core helper takes `(occupied, devices)`; the wrapper forwards `growth`, which is ignored.

Measured and rejected: deferring hidden-view rendering like the iteration-6 canvas guard. Edit-to-re-render latency is ~3 ms at sample scale and ~18 ms at 240 VLANs / 40 sites (linear growth), so the added dirty-flag complexity across four views is not justified.

## Intended changes

| # | Change | Files | User impact | Risk |
| --- | --- | --- | --- | --- |
| F1 | VLAN edit keeps the stored gateway when it is still a valid host for the resulting subnet and role; otherwise falls back to `firstUsable(cidr)` as today | `public/app.js` | Imported/custom gateways survive unrelated edits | Low: imported designs already carry arbitrary gateways; validation unchanged |
| F2 | `storage` event listener warns when another tab writes the current-design key with different content | `public/app.js` | Cross-tab overwrites become visible instead of silent | Low: read-only listener, toast only |
| F3 | Add `role="region"` to `#canvas` | `public/index.html` | Canvas label announced by screen readers | None |
| F4 | Remove dead imports; align `suggestSiteRange` signature with the core helper | `public/app.js` | None | None |
| F5 | Release bump 0.6.0 → 0.7.0 (package.json + worker health payload); ARCHITECTURE.md refreshed (gateway preservation, cross-tab warning, canvas region) | `package.json`, `worker.js`, `ARCHITECTURE.md` | Health endpoint reports truthful version | None |

## Regression coverage

- e2e: custom-gateway VLAN survives a rename (inspector + stored state). Must fail pre-fix; verified via stash.
- e2e: second tab renaming the design raises the cross-tab toast in the first tab.
- static: gateway-preservation wiring, storage-listener wiring, canvas region role, import-line hygiene.

## Explicit non-goals

- Deploy/push/publish (prohibited by task rules).
- Deferred rendering of hidden views (measured, not warranted).
- IndexedDB library storage, build/minification, `run_worker_first`, CSP shape, pinch-zoom, light theme: carried decisions from rounds 1-6 with recorded rationale; no new evidence.
- No new features. The core job (map, validate, review, report IPv4 designs locally) is complete.

## Verification

`npm test`, `npm run test:e2e`, stash-check of the F1 regression test, header matrix via `wrangler dev` curl, `audit-html.mjs`, Lighthouse, responsive probes at 390/768/1440, reduced-motion probe, `wrangler deploy --dry-run`, live read-only spot-check.
