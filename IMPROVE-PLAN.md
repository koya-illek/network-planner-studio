# Improvement Plan — Round 2 (2026-08-22)

Second-pass review of `network-planner-studio` on branch `improve/review-2026-08-22`
(after round 1, `42f5495`). Items are concrete and implementable; each lists
what / where / why / how.

## Technical

### T1 — Clear stale undo/redo history when starting a new session
- **What**: `start()` replaces `state` (blank/sample/existing) but never resets
  `undoStack`/`redoStack`, so pressing Undo after starting a new or sample design
  restores the *previous* project's full state over the current one.
- **Where**: `public/app.js` — `start()` (~line 96).
- **Why**: Cross-project state contamination through a normal user flow
  (workspace → Home → "Map an existing network" → Undo).
- **How**: In `start()`, before rendering: `undoStack=[];redoStack=[];updateHistoryButtons();`.

### T2 — Cancel the active trace when the design re-renders
- **What**: Any edit (`touch()` → `render()` → `renderCanvas()`) wipes
  `#link-layer`, destroying route paths and trace particles mid-animation, while
  the trace bar and its 900 ms step timer keep running against a dead canvas.
- **Where**: `public/app.js` — `render()` (~line 115).
- **Why**: Orphaned timer + stale UI; particles vanish but the bar claims a live
  trace until manually closed.
- **How**: Call `stopTrace()` at the top of `render()` (it is idempotent: hides
  the bar, clears the timeout, removes particles/active classes).

### T3 — Make "Run review" actually recompute
- **What**: The `#rerun-review` button calls `renderReview()`, which reads the
  per-render `reviewCache`; it never recomputes anything.
- **Where**: `public/app.js` — click dispatcher `#rerun-review` branch (~line 572).
- **Why**: Button implies action; currently cosmetic.
- **How**: Set `reviewCache=null` before `renderReview()` in that handler.

### T4 — Clamp negative headroom % in the address-plan table
- **What**: When devices exceed capacity, the table shows a negative percentage;
  round 1 clamped only the inspector.
- **Where**: `public/app.js` — `renderAddressPlan()` (~line 208).
- **Why**: Consistency; "−37% headroom" plus an "Over capacity" pill is noise.
- **How**: `head=p?Math.max(0,Math.round((1-v.devices/capacity)*100)):0` (the row
  already flags status as Over capacity/error).

### T5 — Keyboard access to WAN links on the canvas
- **What**: `.link-hit` paths are mouse-only. Sites/VLANs are focusable and
  Enter/Space-selectable; links are not reachable by keyboard at all.
- **Where**: `public/app.js` — `renderCanvas()` link loop (~line 160) and the
  keydown handler (~line 576); `public/styles.css`.
- **Why**: A11y parity with sites/VLANs (extends round-1 #7 work).
- **How**: Give each link-hit `tabindex="0" role="button"` and an escaped
  aria-label ("A to B connection"); extend the keydown closest-selector and
  selection branch to handle `.link-hit`; add a visible focus indicator via
  stroke change (`.link-hit:focus-visible`).

## UI / UX

### U1 — Inspector close affordance below 1050 px
- **What**: On tablet/mobile the inspector is a fixed overlay (up to ~90vw);
  once anything is selected there is no way to dismiss it — canvas taps pan,
  they don't deselect.
- **Where**: `public/app.js` — `renderInspector()` branches; `public/styles.css`;
  click dispatcher for `[data-inspector-close]`.
- **Why**: Users get trapped with the panel covering the canvas.
- **How**: Render an absolutely-positioned Close button inside every
  `.inspector-content`; CSS shows it only ≤1050px (desktop keeps the always-on
  column); handler sets `selected=null` and re-renders.

### U2 — 44px touch targets for small icon controls on coarse pointers
- **What**: `.icon-button` (34px), `.add-vlan-mini` (34px), `.dialog-close`
  (unstyled) sit below the 44px target the app already uses elsewhere.
- **Where**: `public/styles.css` — new `@media (pointer: coarse)` block.
- **Why**: WCAG 2.5.8 / thumb reach on phones; consistent with existing 44px work.
- **How**: Under `pointer: coarse`, raise those to 44×44 (mouse/desktop unchanged).

### U3 — Bound toast width so long errors can't overflow mobile viewports
- **What**: `showToast()` prints raw error messages (import/storage failures) into
  a fixed-position pill with no max-width.
- **Where**: `public/styles.css` — `.toast` rule (~line 44).
- **Why**: Long messages currently stretch past the viewport edge on phones.
- **How**: Add `max-width:min(92vw,560px);overflow-wrap:anywhere;text-align:center`.

### U4 — Announce form errors to assistive tech
- **What**: The six `.form-error` regions update silently; validation failures
  are invisible to screen readers unless focus happens to land nearby.
- **Where**: `public/index.html` — site/vlan/connect/recommend/hub/trace error divs.
- **Why**: Forms are the primary input path; errors must be announced.
- **How**: Add `aria-live="polite"` to each region (text-only updates, no focus steal).

## Other

### O1 — Static smoke test for the new affordances
- **What**: One compact `test/static.test.js` case asserting: reduced-motion
  block exists, coarse-pointer block exists, six live error regions, link-hit
  keyboard selector present, inspector close wired.
- **Where**: `test/static.test.js`.
- **Why**: Repo convention is cheap presence smoke; prevents silent regressions.

## Reviewed and intentionally not changed
- Mobile zoom controls hidden ≤720px (pinch-zoom unsupported) — accepted tradeoff.
- Dark-theme-only design — deliberate brand choice, contrast verified adequate.
- No build/minify step — zero-build architecture kept (round-1 decision).
- `run_worker_first = true`, CSP allowlist for Cloudflare Insights — verified
  appropriate; no change.
