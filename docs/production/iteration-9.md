# Production iteration 9 plan (2026-08-23)

Branch: `production/iteration-8` (continued; clean at start).
Baseline: unit 42/42, e2e 25/25, worktree clean. Live site still serves the round-2
build (`/api/health` reports `0.2.0`); deploying stays out of scope per task rules.

## Audience and core job (restated)

Network planners and MSP engineers modelling IPv4 estates: map sites/VLANs/WAN on a
topology canvas, validate addressing, review, and hand off a report, entirely local in
the browser. The canvas is the product's centerpiece, and the editing model only earns
trust if every gesture path leaves the design in an honest, reversible state.

## Confirmed findings (each reproduced on this tree before planning)

1. **A cancelled node drag half-applies the move** (`public/app.js` `releasePointer`).
   Timeline: pointerdown pushes an undo snapshot; pointermove mutates `site.x/y` and
   re-renders; pointercancel pops the undo snapshot but keeps the mutated coordinates.
   The node stays displaced, the revert entry is gone, and the next unrelated save
   persists the move the user never committed. Reproduced with synthetic pointer
   events: after down + 8 moves + cancel the node sits ~48 px from its origin and
   `#undo-button` is disabled.
2. **A moved drag swallowed by a pinch is never settled** (`public/app.js` canvas
   pointerdown). When a second finger lands mid-drag, the drag is discarded. If it had
   already moved, the history entry is kept but `touch()` never runs, so the new
   position renders yet is not saved until some later edit saves by coincidence.
   An interrupted gesture should settle like any other committed edit.
3. **Keyboard nudges are second-class edits** (`public/app.js` keydown handler). Arrow
   moves mutate coordinates and debounce a bare `saveState`, bypassing both history
   (mouse drags are undoable, key nudges are not) and the shared `touch()` pipeline
   ("Saving…" indicator, deferred-render-behind-dialog protection).

## Intended changes

| # | Change | Files | User impact | Risk |
| --- | --- | --- | --- | --- |
| F1 | On `pointercancel`, restore the dragged node to its pre-drag coordinates and re-render the canvas before dropping the history entry | `public/app.js` | A system-gesture interruption can no longer smuggle in an uncommitted, un-undoable move | Low: reuses the snapshot captured at drag start |
| F2 | When a second pointer takes over a drag that had already moved, run `touch()` so the position settles through the normal save/render pipeline | `public/app.js` | Pinch-after-drag no longer strands an unsaved coordinate change | Low |
| F3 | Arrow-key nudges push exactly one history entry per burst (a burst breaks after 600 ms of inactivity) and save through `touch()` instead of raw `saveState()` | `public/app.js` | Keyboard users gain undo parity with pointer drags; nudges honour dialog-deferred rendering and the saving indicator | Low |
| F4 | Release bump 0.8.0 → 0.9.0 (package.json + worker health payload; static test enforces sync); README and ARCHITECTURE sentences updated to describe gesture integrity and nudge undo | `package.json`, `worker.js`, `README.md`, `ARCHITECTURE.md` | Health endpoint reports truthful version after deploy | None |

## Regression coverage

- e2e: node drag + real movement + `pointercancel` restores the pre-drag position
  (must fail pre-fix); hover afterwards still cannot drag.
- e2e: drag that moves, then second finger pinch takeover, then `pagehide` flush:
  localStorage holds the moved position (must fail pre-fix without F2).
- e2e: arrow-key burst enables Undo, Undo restores the original position, and Redo
  reapplies it (history part must fail pre-fix).
- Existing suite guards mouse parity, pinch zoom, focus keeping and save flushing.

## Explicit non-goals

- Deploy/push/publish (prohibited by task rules).
- Pan restore on cancel (pan is view state, not design data, by design).
- Per-keystroke history entries (would flood the 40-snapshot undo stack).
- Trace-through-endpoint semantics for transit-blocked links (deliberate BFS rule).
- IndexedDB library storage, build/minification, light theme: carried decisions.

## Verification

`npm test`, `npm run test:e2e`, stash-check that each new regression fails unfixed,
`wrangler deploy --dry-run`, audit-html.mjs on `/` and `/404`, read-only live spot
check of https://network.illek.ie and the `netplanner.illek.ie` alias redirect.
