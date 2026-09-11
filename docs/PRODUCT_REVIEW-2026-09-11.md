# Network Planner Studio product review

Review date: 2026-09-11

Reviewed target: local `main` at `84e8a9e` (package `0.11.0`, schema v3), exercised at
`http://127.0.0.1:8787`, compared with live `https://network.illek.ie`.

This is a read-only review of code, UI/UX, performance, functionality, and copy.
No product behaviour was changed.

The August 2026 review in [`docs/archive/PRODUCT_REVIEW-2026-08-14.md`](archive/PRODUCT_REVIEW-2026-08-14.md)
is historical. Its High and Medium correctness findings are resolved in this tree.
This review is of the current product, not that earlier build.

## Executive verdict

Network Planner Studio is a credible local-first IPv4 design workbench. The
canonical model in `public/network-core.js` is the real product: factories,
validators, DHCP, hub-and-spoke rules, CSV, recommendations and review heuristics
share one schema. The canvas, address plan, review, policy matrix and print report
are different views of that model. For a consultant or MSP workshop, that is the
right shape.

The August correctness crisis is over. Gateways, reserved counts, DHCP pools,
CSV round-trips, recommendation objects, enum clamping and CSP role colours now
go through the same factories. Unit tests (71) and a dense Playwright suite cover
the dangerous paths. Security headers, canonical-host redirects and a strict CSP
are in good order.

The remaining risk is not remote compromise. It is still **authority of language
and first-run honesty**: an empty design prints “Ready for technical review”;
the sample opens with a red Review `4` and a green score of 70; social copy still
says “simulate routes on a live topology”; production `0.10.0` still advertises
`api`/`mcp` after this tree removed that surface. The workbench is trustworthy
as a private planning aid. It is not yet a source of truth, and some of its
chrome still talks as if it were.

Release decision: keep the product public as a workshop tool. Do not let report
status, score rings, or Open Graph text imply implementation approval. Deploy
`0.11.0` so production matches the documented local-only boundary. Then fix the
empty-report status, landing-page chrome, and user-facing enum labels before
pushing the report as a client handoff artifact.

No Critical remote-server vulnerability was found. There are no High
correctness failures of the August kind. There are High product-honesty and
production-drift findings, plus a set of Medium UI, copy and process issues.

## Evidence

### Repository

- HEAD `84e8a9e` — “Add MIT license and live service link for public release.”
- Runtime: Cloudflare Worker + `public/` assets. No database, no auth, no
  planning API. Designs live in `localStorage`.
- `public/network-core.js` (1,057 lines) owns schema v3, IPv4 math, validation,
  migration, CSV, review, recommendations.
- `public/app.js` (882 lines) is a single browser controller: persistence,
  canvas, dialogs, import/export, focus, gestures.
- Worker: `worker.js` + `headers.js`. Custom domains `network.illek.ie` and
  `netplanner.illek.ie`. `workers_dev` and preview URLs disabled.

### Automated checks run for this review

- `npm test`: 71 passing, 0 failing.
- `npm audit --omit=dev`: 0 production vulnerabilities. Dev `wrangler`/`sharp`
  reports 3 High issues that do not ship in the Worker bundle.
- Live `GET https://network.illek.ie/api/health`:
  `{"ok":true,"service":"network-planner-studio","version":"0.10.0","schema":"network-planner-studio/design","schemaVersion":3,"api":"v1","mcp":"/mcp"}`.
  Local health is `0.11.0` and must not advertise `api` or `mcp`
  (`test/static.test.js`).

GitHub CI (`.github/workflows/ci.yml`) runs `npm test` and `check:provenance`
only. Playwright is not in CI. `npm run test:e2e` was not re-run here; the suite
is large (48 cases) and is the right place for interactive regressions.

### Hands-on UI

The local app was driven at desktop, ~1024px, and a narrow window approximating
mobile: welcome, sample topology, inspector, address plan, review, policies,
report, recommend dialog, empty new design, add-site auto-allocation
(`10.0.0.0/20`).

## Findings

Severity: Critical, High, Medium, Low. Evidence points at this tree.

### Critical findings

None in the reviewed public request paths. There is no plan-mutation API on this
tree. The main residual risk is misleading local output and a stale production
build that still names a removed machine surface.

### High findings

#### H-01: Production still advertises a planning API and MCP that this tree removed

Evidence:

- Live health is `0.10.0` and includes `"api":"v1","mcp":"/mcp"`.
- This tree is `0.11.0`. `worker.js` health payload has no those fields.
- `test/static.test.js` asserts `health.api` and `health.mcp` are `undefined`,
  and that `/api/v1`, `/mcp` and related paths 404.
- README and ARCHITECTURE state there is no public planning API or MCP surface.

Impact:

Anyone probing production still sees a machine API that no longer exists in
source. That is a trust and documentation failure at the product boundary, and
it means `npm run check:production` would fail against this checkout until
`0.11.0` is deployed.

Recommendation:

Deploy this tree (or the commit that removed the API) to `network.illek.ie`.
Confirm health matches package version and omits `api`/`mcp`. Keep the
production smoke check in the release ritual.

#### H-02: An empty design prints “Ready for technical review”

Evidence:

- `renderReport()` in `public/app.js` sets status to “Ready for technical review”
  whenever there are zero errors and zero warnings.
- Empty designs return only an info finding (“Start the address hierarchy”) from
  `reviewDesignIssues`, so they have no warnings.
- Hands-on: a new untitled network with 0 sites, 0 VLANs, 0 WAN links rendered
  that status on the implementation report.

Impact:

The printed artifact can claim readiness before any work exists. That repeats
the August concern about authority language, now on the empty path rather than
on invalid imports.

Recommendation:

Treat “no sites” (and perhaps “no VLANs”) as not-ready. Copy such as “No design
to review yet” or “Add a site before treating this as a handoff.” Add an e2e
assertion on the empty report.

#### H-03: Landing chrome can edit a hidden design, and the two start CTAs are the same product

Evidence:

- The welcome page still shows the full top bar: “Untitled network”, Saved
  locally, Home, Recommend, + Add site, More.
- `start("existing")` and `start("new")` both blank the design, set `mode`,
  and immediately open the same Add-site dialog. The CIDR field is always
  labelled “Existing site range”.
- `#add-site-top` opens that dialog without calling `start()`, so a welcome-page
  Add site can mutate `state` while `mode` is still `null` and the workspace
  stays hidden.

Impact:

First-run users are asked to pick “existing” vs “new” and then see the same
form. Top-bar actions on the landing page compete with the hero and can create
sites the user cannot see. The two CTAs currently encode almost no product
difference.

Recommendation:

Hide workspace actions on the welcome screen. Distinguish the two starts in the
form (existing range vs recommend a new parent). Only open the site dialog after
the empty canvas is visible, or make the landing CTAs clearly “start by adding
the first site.”

### Medium findings

#### M-01: Connect and Trace are labelled as tools but are one-shot dialogs

Evidence:

- Clicking “Connect sites” or “Trace path” sets `currentTool` and opens a
  dialog. Canvas `pointerdown` only pans when `currentTool === "select"`.
- After the dialog closes, the tool button stays active. Empty-canvas
  screenshots in this review still show Trace path selected, so pan no longer
  works until Select is clicked again.

Impact:

The toolbar looks like a mode switcher (Select / Connect / Trace) but Connect
and Trace do not enter a click-to-connect or click-to-trace mode. Users who
expect to click two nodes get a form, then a stuck non-panning canvas.

Recommendation:

Treat Connect and Trace as commands, not tools: open the dialog and leave Select
active. Or implement real two-click connect/trace on the canvas.

#### M-02: Review chrome encodes warnings as errors and info as success

Evidence:

- The Review tab badge uses `.count.has-errors` (red) for any error *or*
  warning. The sample shows a red `4` even though all four counted items are
  warnings, not blocking errors.
- Info and advice rows use a green check icon. “Trust boundary required” and
  “No management segment” therefore look like passes.
- The score ring is mint-green at 70/100 on that same sample.

Impact:

The first sample screen says the design is both risky (badge, “RISKS” on nodes)
and healthy (green score, green ticks). That undermines the review as a to-do
list.

Recommendation:

Style errors, warnings, advice and info as four distinct treatments. Count
blocking issues separately from risks. Do not paint the score ring mint unless
the design is actually clean. Consider labelling sample findings as intentional
teaching points.

#### M-03: User-facing surfaces leak schema enums

Evidence:

- Policy matrix headers and cells are raw roles (`users`, `voice`, `guest`)
  forced to ALL CAPS by `.flow-cell { text-transform: uppercase }`.
- Inspector kicker is `office · hub`; connectivity is `Dual WAN · local
  breakout`; report role column is `hub` / `spoke`; WAN table prints `dual`,
  `bgp`, `allowed`.
- Address-plan “VLAN” column is the numeric ID; the VLAN name is a subtitle
  under the site. Role is filterable but not shown.

Impact:

The forms speak human (“Staff / users”, “Data centre”, “Dynamic / BGP”). The
canvas, inspector, matrix and report speak the schema. A client-facing PDF
should not require the reader to know the enum.

Recommendation:

One display-label map for site type, role, WAN, breakout, resilience and
routing. Use it in the inspector, matrix, address plan and report.

#### M-04: Copy still overclaims “live” simulation, then correctly disclaims it

Evidence:

- Open Graph description: “simulate routes on a live topology.”
- README lead: “Drag sites on a live topology canvas.”
- Trace bar and report correctly say modelled intent; live routing and
  firewalls are not tested.

Impact:

Link previews and the README promise more than the trace engine (BFS + routing
intent flags) delivers. The in-app disclaimer is good; the marketing surface
fights it.

Recommendation:

Replace “live” / “simulate” with “modelled” / “design-intent” on OG, Twitter
and README. Keep the trace-bar disclaimer.

#### M-05: Footer claims “All rights reserved” while the repo is MIT

Evidence:

- `LICENSE` is MIT © 2026 Koya Illek.
- `public/index.html` footer: “© 2026 Illek. All rights reserved.”

Impact:

The hosted UI contradicts the public licence. That is a product-legal mismatch,
not a code defect.

Recommendation:

Footer should match MIT (or a short “MIT licence” link). Keep the planning
disclaimer.

#### M-06: Recommendation notes and defaults still sound like an internal assistant

Evidence:

- Applied site notes: `"Generated by the compatibility assistant."`
- VLAN plans: `"Recommended by the compatibility assistant."`
- Opening Recommend with the sample pre-selects Cork HQ as the VPN target
  (`busiestHub()`), so a “new office” is a spoke unless the user notices.

Impact:

Exported JSON/CSV/report carry leftover product naming. The hub default is
reasonable for an MSP template and surprising for a standalone site.

Recommendation:

Write notes as “Recommended by Network Planner Studio.” Default Connect-to to
“No VPN yet” unless the design is already hub-and-spoke.

#### M-07: CI does not run the browser suite

Evidence:

- `.github/workflows/ci.yml` runs `npm ci`, `npm test`, `check:provenance`.
- `npm run check:release` includes Playwright, audit and Wrangler dry-run, but
  that is a local ritual, not GitHub CI.
- `app.js` has no unit tests; regressions there rely on e2e.

Impact:

A change that breaks canvas gestures, dialogs or axe checks can merge green.

Recommendation:

Run Playwright (or a smoke subset) on PRs. Keep the full release gate for
schema and import changes.

#### M-08: Mobile topology hides zoom and compresses the tool group

Evidence:

- `@media (max-width: 720px)` sets `.zoom-controls { display: none }`. Pinch
  zoom exists (`ARCHITECTURE.md`).
- Narrow-window capture: Select / Connect sites / Trace path / Hub & spoke
  share one crowded strip with Sites; Home and Recommend disappear into More.

Impact:

Pinch is documented but undiscoverable. The tool strip is the densest control
row in the app.

Recommendation:

Keep compact +/- even on small viewports, or teach pinch in the empty-canvas
hint. Collapse Connect/Trace/Hub into an overflow on coarse pointers.

### Low findings

#### L-01: Mixed British and American English

Site type `datacentre` / “Data centre” vs hub form “Centralized at hub” and
checkbox “centralized inspection”. Pick one locale (Irish English is the
natural house style) and apply it to labels, not only to schema keys.

#### L-02: Stylesheet still contains a discarded light theme and unused font names

`public/styles.css` paints a cream/paper light UI, then overrides it from
`:root { color-scheme: dark }` onward. `html` asks for Inter / Aptos / Segoe;
site symbols ask for “DM Mono”; neither family is loaded. Users get system
fonts (fine for performance) while the CSS describes a different design system.

#### L-03: `mesh` is a first-class topology mode with no editor

`ENUMS.topologyModes` includes `mesh`; the canvas meta can display “Mesh”.
Nothing in the UI sets it. Import-only modes should be documented or given a
control.

#### L-04: “Run review” does not compute anything the tab did not already have

Review is computed on render and cached. The button invalidates the cache and
rebuilds the same view. Rename to “Refresh” or remove it.

#### L-05: `app.js` is still one orchestration module

882 lines of persistence, canvas, HTML templates, import and gestures. It is
much better factored against the core than in August, and the performance
comments in-source are genuine. Splitting renderers from persistence would make
the Medium UI bugs cheaper to fix. Not a release blocker.

#### L-06: `rangesOverlap` treats unparseable CIDRs as non-overlapping

A parse failure returns `false`. Review has a parallel `parseOrIssue` path, so
the UI usually still flags invalid ranges. Direct overlap checks should fail
closed.

#### L-07: Cross-tab storage warning fires if the stored blob is unreadable

The `storage` handler toasts a sibling-tab warning when `JSON.parse` fails
(`!incoming`). A corrupt write is not “changed in another tab.”

## What is working well

- **Local-first boundary.** Cloudflare serves assets and `/api/health`. Site
  names, CIDRs, policies and notes stay in the browser unless the user exports.
  That is still the product’s best idea.
- **One canonical model.** Forms, recommendations, JSON, CSV and the sample
  all use `createSite` / `createVlan` / `createLink` / `migrateDesign`. The
  August High findings (invalid gateways, pools vs reserved, lossy CSV,
  incomplete recommendations, policy HTML injection) are actually gone.
- **IPv4 engine.** `/8`–`/31` allocation, `/0`–`/32` route prefixes, `/31`
  transit, gateway and DHCP validation, containment, hub-spoke wiring. Tests
  include randomized allocation parity and long-chain tracing.
- **Canvas as the centre of gravity.** Draggable nodes, incremental
  `moveNode` during drags, deferred layout while Topology is hidden, pinch,
  keyboard pan/zoom/nudge with burst undo, health flags that are not
  colour-only. The sample HQ / Dublin / hosted layout is immediately readable.
- **Performance engineering is real, not decorative.** Hidden tabs are stale
  until opened; selection is a class toggle; history is byte-budgeted (12 MiB);
  imports cap at 10 MB / 500 sites / 2000 links; review parses site CIDRs once;
  the site tree collapses after 40 sites. Payload is small (no runtime npm
  dependencies, no webfonts in practice).
- **Accessibility investment.** Skip link, tablist, labelled dialogs, roving
  tabs, focus restoration, 44px coarse targets, reduced-motion, live regions
  for filters and toasts, axe in e2e. This is well above typical prototype
  quality.
- **Handoff.** Versioned JSON, RFC 4180 CSV with formula guards, print report
  with policy matrix, assumptions, provenance. Storage failures surface instead
  of eating the design.
- **Hardening.** CSP without `unsafe-inline`, COOP/CORP, HSTS preload,
  canonical 301, HTTP 308, branded 404, health limited to GET/HEAD/OPTIONS.

## Code quality

The split between `network-core.js` and `app.js` is the main architectural
success. Domain rules are testable without the DOM. Comments in both files
explain *why* (quarantine before overwrite, do not validate on undo, do not
measure a hidden canvas). That is unusual and useful.

Costs:

- `app.js` remains a click-handler switchboard (~50 branches). Connect/trace
  tool state and welcome-vs-workspace coupling live there, which is why M-01
  and H-03 are easy to ship and hard to notice in unit tests.
- Display labels are not a module, so enums leak (M-03).
- CSS is accretion: light theme, dark overrides, then several mobile patches.
  It works; it is not a design system.

Tests are strong on the core and on browser workflows, weak as a merge gate
because CI skips Playwright (M-07).

## UI and UX

The visual language is coherent: dark infrastructure palette, mint/amber/red
severity, monospace CIDRs, node cards that look like a topology without
pretending to be Visio. Dialogs are well titled. Empty canvas copy is friendly.
Toasts are short and operational (“Site added. Add its existing or proposed
VLANs next.”).

The main UX problems are **mode confusion** (landing chrome, fake tools,
identical existing/new starts) and **status confusion** (green score, red
badge, green ticks on advice). Tablet at 1024px behaved; the off-canvas
inspector from the August review did not overflow in this pass. Mobile is
usable as a Sites drawer plus canvas, but zoom and the tool strip need another
pass (M-08).

Recommend is the best “magic” in the product: a preview with CIDRs, VLAN IDs
and reasons before apply. It should not quietly attach a VPN to the busiest
hub.

## Performance and functionality

Functionality of the planning loop is solid: auto-allocation of a blank site
range worked (`10.0.0.0/20`); overlapping VLAN CIDRs are rejected on the form;
trace Dublin → hosted went via Cork HQ; hub policy can deny spoke-to-spoke
(covered by e2e). Undo/redo, projects, import size limits and print-flush of a
stale report are implemented with intent.

Performance for workshop-sized designs should be a non-issue. The code is
already written for thousand-site imports (tree collapse, incremental drag,
deferred report). The JS is unminified but tiny. The larger cost on first paint
is HTML that includes every dialog and every tab shell; that is acceptable.

Gaps that are functional rather than polish: mesh mode (L-03), Connect not
being click-two-nodes (M-01), empty-report status (H-02), production version
drift (H-01). IPv6, VRF and live discovery remain explicit non-goals and should
stay that way.

## Language and copy

House voice is generally good: short, specific, Irish place names in
placeholders (Cork, Limerick), honest disclaimers on the report and trace bar.
The 404 line (“That page is not on the map”) is the right amount of wit.

Problems, in priority order:

1. Authority language on empty and scored reports (H-02, M-02).
2. “Live topology” / “simulate routes” in OG and README (M-04).
3. “All rights reserved” vs MIT (M-05).
4. Schema words in the UI (`users`, `datacentre`, `bgp`, `dual`) (M-03, L-01).
5. “Compatibility assistant” in persisted notes (M-06).
6. “Existing site range” on the Plan-a-new-network path (H-03).
7. Policy matrix ALL CAPS, which reads like a debug view.

Do not add more marketing adjectives. Tighten claims until they match the
engine.

## Recommended next work

Ordered by impact, not calendar time.

| Order | Work | Why |
| --- | --- | --- |
| 1 | Deploy `0.11.0` and pass `check:production` | Production still names a removed API (H-01). |
| 2 | Empty and incomplete reports must not say ready; restyle review severity | Stops the remaining honesty hole (H-02, M-02). |
| 3 | Quiet the landing chrome; make existing vs new starts real | First minute of the product (H-03). |
| 4 | Display-label map; drop live/simulate; MIT footer | Copy and handoff (M-03–M-05). |
| 5 | Connect/Trace as commands; recommendation defaults | Daily canvas UX (M-01, M-06). |
| 6 | Playwright on CI; compact mobile zoom | Prevent regressions (M-07, M-08). |

Explicit do-not-do list, unchanged in spirit from August: no cloud project
sync, no live scanner, no config push, no IPv6/VRF expansion, no generic
diagramming, until the IPv4 workshop loop is honest in every status string.

## Final assessment

This is a serious small product. The domain engine and local-first boundary are
ahead of the chrome. August’s “do not trust imports” gate is passed. The next
gate is narrower: **every status string, score and social description should be
true of the document on screen**, including the empty one, the sample, and
production health. After that, the useful work is UX (landing, tools, labels)
and keeping CI as strict as the local release script — not a broader feature
set.
