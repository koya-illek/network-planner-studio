# Production iteration 8 plan (2026-08-22)

Branch: `production/iteration-8` (from `production/iteration-7`, identical at start).
Baseline: unit 39/39, e2e 23/23, worktree clean. Live site still serves the round-2 build (`/api/health` reports `0.2.0`; `/app.js` sha256 differs from HEAD); deploying stays out of scope per task rules.

## Audience and core job (restated)

Network planners and MSP engineers modelling IPv4 estates: map sites/VLANs/WAN on a topology canvas, validate addressing, review, and hand off a report — entirely local in the browser. The canvas is the product's centerpiece ("made visible") and mobile is a supported audience (drawer, overlay inspector, 44 px targets, 390 px overflow gates exist since earlier rounds).

## Confirmed findings (each reproduced on this tree before planning)

1. **Touch users have no zoom affordance, and a two-finger pinch silently pans** (`public/app.js` canvas pointer handlers; `public/styles.css` `.zoom-controls{display:none}` ≤720px). Probe at 390×844 with touch: zoom controls hidden, ctrl+wheel unavailable on touch, and a synthetic two-finger pinch produced `translate(60px, 0px) scale(1)` — the second finger re-anchored the pan instead of zooming. A standard gesture produces an unintended result and there is no working path to scale the primary view on a phone.
2. **Canvas gesture lifecycle is fragile** (`public/app.js:698-707`). `setPointerCapture` is unguarded (probe raised unhandled `NotFoundError` when the pointer was already inactive) and there is no `pointercancel` handler: a browser-cancelled drag (incoming call, edge swipe, system gesture takeover) leaves `drag` stuck so later hover moves keep dragging the node with no button held.
3. **A debounced render can fire behind an open modal and destroy keyboard focus** (found while probing the focus suite; reproduced with an instrumented trace). Timeline: an edit arms the 220 ms debounced `touch()` render; a dialog opened inside that window gets its opener element replaced when the timer fires; on submit/cancel, `<dialog>` cannot restore focus to a detached element, so focus falls to `<body>`; every later render then captures no focus identity and never recovers it. Same defect family as the iteration-4 High finding, one layer deeper. Instrumented trace: `520 inspector DOM replaced (timer) → 567 close vlan-dialog → 619 focusout → null`.
4. **`nextVid()` can propose an occupied VLAN ID** (`public/app.js:401`). With IDs 10–99 plus 4094 all used at a site it returns 4094 (reproduced in isolation), pre-filling the Add-VLAN form with a duplicate that fails validation on submit.
5. **Housekeeping**: release provenance still reports 0.7.0 while this iteration ships new behavior; dependency freshness re-checked (`npm outdated` empty, `npm audit` clean — nothing to update).

## Intended changes

| # | Change | Files | User impact | Risk |
| --- | --- | --- | --- | --- |
| F1 | Track active pointers on `#canvas`: two-finger pinch zooms (clamped to the existing 0.7–1.5 range), lifting one finger re-anchors the remaining pointer as a pan; add `touch-action:none` to the canvas so browser gestures cannot hijack drags; guard `setPointerCapture`; handle `pointercancel` by cleaning up without committing | `public/app.js`, `public/styles.css` | Phones/tablets gain the missing zoom gesture; node drags survive system-gesture interruption; mouse behavior unchanged | Low: same transform pipeline as ctrl+wheel; existing single-pointer paths preserved step for step |
| F2 | The debounced save keeps running while a modal dialog is open, but its render is deferred and flushed when the last dialog closes (`close` listener in capture phase, since the event does not bubble) | `public/app.js` | Keyboard/screen-reader focus survives rapid edit-then-dialog workflows instead of silently landing on `<body>` | Low: saves are unchanged; renders were already invisible behind the modal backdrop |
| F3 | `nextVid()` scans upward past occupied IDs before falling back, so it only ever proposes a free VID (returns 4094 solely when every ID is taken) | `public/app.js` | Add-VLAN form no longer pre-fills a duplicate ID in saturated sites | None: submit-side duplicate validation unchanged |
| F4 | Release bump 0.7.0 → 0.8.0 (package.json + worker health payload; static test enforces sync); README feature line mentions pinch zoom truthfully; ARCHITECTURE.md documents the touch interaction model and cancel cleanup | `package.json`, `worker.js`, `README.md`, `ARCHITECTURE.md` | Health endpoint reports truthful version after deploy | None |

## Regression coverage

- e2e: synthetic two-finger pinch changes the canvas transform scale and Fit resets it; single-finger touch node drag still moves the node; `pointercancel` mid-drag leaves the node put and stops the drag; no unhandled page errors during any gesture. Must fail pre-fix (stash-verified).
- e2e: opening a dialog, letting a background edit's debounce elapse behind it, then cancelling keeps focus on the opener and still flushes the deferred render (MutationObserver count). Stash-verified to fail pre-fix; also fixes the intermittently failing `keeps keyboard focus after dialog-driven edits` suite member.
- static: `touch-action:none` on `.canvas`, guarded capture, multi-pointer/pinch wiring, `pointercancel` listener, modal-deferred render wiring with capture-phase close listener, upward `nextVid` scan.
- Existing suite guards mouse parity (selection, focus keeping, resize relayout).

## Explicit non-goals

- Deploy/push/publish (prohibited by task rules). Live site intentionally left on the round-2 build until the owner deploys v0.8.0.
- IndexedDB library storage, corrupt-library write gating, build/minification, `run_worker_first = true`, CSP allowlist shape, light theme, deferred hidden-view rendering (measured and rejected in iteration 7): carried decisions with recorded rationale; no new evidence.
- Pinch zoom beyond the existing 0.7–1.5 clamp and transform pipeline (no new viewport math); double-tap-to-zoom (not requested, adds ambiguity with node taps).
- No new features beyond completing the existing canvas input model.

## Verification

`npm test`, `npm run test:e2e`, stash-check that the pinch regression fails unfixed, header matrix via `wrangler dev` curl across `/`, asset, `/api/health` (GET/OPTIONS/POST), 404; `audit-html.mjs` on `/` and `/404`; Lighthouse performance/accessibility/best-practices/seo; overflow probes at 1440/768/390 across all five views; 200%-zoom-equivalent probe; reduced-motion probe; `wrangler deploy --dry-run`; read-only live spot-check of https://network.illek.ie.
