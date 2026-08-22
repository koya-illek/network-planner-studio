# Round 3 Improvement Plan — network-planner-studio

Date: 2026-08-22. Branch: `rerun3/review-2026-08-22` (on top of rounds 1–2).
Scope: NEW findings missed (or introduced) by rounds 1–2. No deploys.

## Technical

1. **Stop strict-migration crashes on internally stored states**
   - Where: `public/app.js` — `restoreHistory` (~line 89), `duplicateProject` (~327), `[data-open-project]` click handler (~543).
   - What: All three run `migrateDesign(...)` in strict mode against states this app itself wrote (undo snapshots, library entries, duplicated current design). Any recoverable defect carried through a lenient load (legacy v1/v2 localStorage designs, e.g. an invalid CIDR string kept by `canonicalAllocation`) makes migration throw: Undo pops a history entry and dies (entry lost, no state change, no message), Open/Duplicate fail silently with a console exception.
   - How: Add a `reviveDesign(raw)` helper that tries strict migration once and falls back to `{strict:false}` (same policy as `loadState`) for these three internal paths. File import stays strict — it remains the hostile external boundary.

2. **Keyboard Enter/Space must not hijack native controls inside rows/nodes/links**
   - Where: `public/app.js` global `keydown` handler (Enter/Space selection branch).
   - What: `e.target.closest(".site-row,.vlan-row")` matches when focus is on the nested `.add-vlan-mini` (Add VLAN) button, so Enter/Space is preventDefault-ed and re-routed to "select site". Keyboard users cannot activate Add-VLAN from the sites panel — a round-1/2 regression.
   - How: Bail out of the custom activation branch when `e.target.closest("button,a,input,select,textarea")` is a real control; `.topology-node` and `.link-hit` are divs/paths and keep working.

3. **Editing a site must not silently reset an off-list growth allowance to 0%**
   - Where: `public/app.js` `openSiteDialog`; growth `<select>` in `public/index.html` (options 30/20/50/0 only).
   - What: Assigning `select.value = 45` (an imported/clamped value outside the list) deselects everything; on submit `+fd.get("growth")` coerces null to 0, permanently rewriting the design's growth allowance.
   - How: After populating an edit form, if the select doesn't contain the site's value, append a temporary `data-dynamic-growth` option ("45% (from design)") and select it; drop any leftover dynamic option on each open.

4. **Resize during an active trace must not orphan the trace**
   - Where: `public/app.js` `window.addEventListener("resize", ...)`.
   - What: `renderCanvas()` wipes `#link-layer` (removing route paths/particles) mid-trace while the step timer keeps writing to the trace bar; rapid resize events also rebuild all node DOM per frame.
   - How: Call `stopTrace()` first and coalesce relayout with `requestAnimationFrame`.

5. **CSV design-only export row is one column short**
   - Where: `public/app.js` `exportCsv` (`Array(23)` filler for the headerless-site case).
   - What: Header has 33 columns; the design-only row emits 32, so every consumer must special-case the ragged final record.
   - How: Use `Array(24)`.

6. **Release provenance: bump 0.2.0 → 0.3.0**
   - Where: `package.json`, `worker.js` health payload.
   - What: Three shipped improvement rounds with no version movement undermine `/api/health` as provenance.
   - How: Bump both (the round-1 static test fails if they ever diverge).

## UI-UX

7. **Traffic-policy cell cycling: instant feedback + screen-reader announcement**
   - Where: `public/app.js` `[data-flow]` click handler.
   - What: State changes but the cell only updates after the 220 ms debounced full re-render; nothing announces the new value to assistive tech.
   - How: Update the pressed cell's class/text/aria-label immediately, and surface `${source} to ${destination}: ${next}` via the existing `role="status"` toast.

8. **Review score ring needs an accessible name**
   - Where: `public/app.js` `renderReview` (`.score-ring`).
   - What: A bare number in a styled circle; screen readers get "73" with no context.
   - How: `role="img"` + `aria-label="Design score N out of 100"`.

9. **Restore focus after destructive actions**
   - Where: `public/index.html` (#inspector), `public/app.js` delete handlers + inspector close.
   - What: Deleting a site/VLAN/link (or closing the mobile inspector) removes the focused button from the DOM; focus falls to `<body>` and keyboard/SR users are dumped at the top of the page.
   - How: Give `#inspector` `tabindex="-1"` and focus it wherever a destructive action clears the selection.

10. **Social card completeness: `og:site_name`**
    - Where: `public/index.html`.
    - What: Cards can't group the app under "Network Planner Studio".
    - How: Add `<meta property="og:site_name">`.

## Other

11. **Static smoke coverage for round-3 safeguards**
    - Where: `test/static.test.js`.
    - How: Assert the keyboard guard, the `reviveDesign` strict-false fallback, the dynamic growth-option mechanism, and the trace-safe resize wiring exist, so none regress silently.

Explicitly skipped (carried decisions): no build/minify step; `run_worker_first` stays; IndexedDB stays capped-library; pinch-zoom on mobile stays out of scope.
