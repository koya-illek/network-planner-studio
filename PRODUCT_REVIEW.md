# Network Planner Studio product review

Review date: 2026-08-14 (Europe/Dublin)

Reviewed target: [network.illek.ie](https://network.illek.ie/)

## Resolution status (2026-08-22)

All six High findings and every Medium finding below have since been fixed and verified; treat the narrative sections as historical. Per-finding status:

| Finding | Status | Evidence |
| --- | --- | --- |
| H-01 stale Pages deployment | Resolved | `network-planner-studio.pages.dev` is NXDOMAIN; only the Worker custom domains serve traffic |
| H-02 unvalidated imported gateways | Resolved | Gateway validated in `validateNormalizedDesign` (`public/network-core.js`, `invalid-gateway`) and flagged by design review |
| H-03 pools ignoring reserved counts | Resolved | `validateDhcpPool` rejects pool/reserved overlaps on every entry path |
| H-04 lossy CSV DHCP round trip | Resolved | CSV import preserves explicit pools; covered by e2e `keeps CSV DHCP pool boundaries on export and import` |
| H-05 incomplete recommended VLAN objects | Resolved | Recommendations build through `createVlan`/`createSite`/`createLink` canonical factories |
| H-06 policy attribute injection | Resolved | Imported roles/enums clamp to allowlists (`normalizeVlan`, `normalizeLink`); matrix cells escaped; hostile-import e2e test passes |
| M-01 CSP vs inline styles | Resolved | Role colors are CSS classes; e2e asserts zero console CSP errors |
| M-02 tablet overflow | Resolved | 1050px breakpoint with off-canvas inspector; overflow asserted at 1024px and 390px |
| M-03 scrolled workspace entry | Resolved | `start()` scrolls to top before revealing the workspace |
| M-04 route-prefix parsing | Resolved | `parseRoutePrefix` accepts `/0`–`/32` separately from allocation CIDRs |
| M-05 report omits policy matrix | Resolved | Report includes traffic-policy matrix, breakout/hub table, inspection intent, assumptions, unresolved review items |
| M-06 accessibility semantics | Resolved | Tablist/tab/tabpanel semantics, labelled dialogs, row keyboard support, axe-core in CI |
| M-07 storage failure boundary | Resolved | Wrapped storage with recovery prompts; quota-failure e2e test; library capped at 20 projects (2026-08-22) |
| M-08 import normalization gaps | Resolved | Unique-ID checks, parsed advertised prefixes, enum clamping, bounded allocator arguments |
| L-02 dead code remnants | Partially resolved | `startTraceSelection` removed 2026-08-22; module split intentionally deferred |

A follow-up review dated 2026-08-22 found no Critical or High issues; see the repository history from commit `56ade12` onward for the fixes listed above.

Reviewed target: [network.illek.ie](https://network.illek.ie/)

Repository: `/home/koya/network-planner-studio`

This is a read-only product and deployment review. No product code, deployment, DNS, storage, or external state was changed. The only file added by this review is this report.

## Executive verdict

Network Planner Studio is a polished, technically interesting IPv4 planning prototype. It combines address allocation, site topology, route-intent simulation, DHCP pool planning, trust-zone policy, local projects, and a printable handoff in a small zero-login application. The local-first boundary is a good fit for consultants and small network teams who need a design artifact before they adopt a system of record.

The public custom domain is reachable, the Worker is using the intended custom-domain configuration, the current production static assets match the current working tree, and the main desktop and 390px flows are usable. The current implementation is not trustworthy as an implementation authority yet. Imported data can contain an invalid gateway without a review error, a custom pool can contain addresses declared reserved, CSV round trips silently replace explicit DHCP pools, and the recommended VLAN path creates an incomplete object that renders as static addressing. These are correctness failures in the product's central promise.

Release decision: keep the product public as an exploratory MVP, but hold any claim that its output is implementation-ready until the high findings below are fixed and covered by import/export and property tests. The app is suitable for a design workshop after a human checks every generated address and pool. It is not yet suitable as a source of truth, change authority, or automated network configuration input.

No critical remote-server vulnerability was found in the reviewed paths. There are six high findings, several medium findings, and a set of sensible low-cost improvements.

## Evidence and tests run

### Repository and architecture

- HEAD is `8dc94f5` (`Design language convergence - hero grammar, dark token harmonization, ecosystem nav, 301 canonical redirect`).
- The checkout is dirty. Modified tracked files are `package.json`, `package-lock.json`, `playwright.config.js`, `public/app.js`, `public/index.html`, `public/styles.css`, `test/static.test.js`, `worker.js`, and `wrangler.toml`; `test/redirects.test.js` is untracked. The current production assets match these current local public files, so this review treats the dirty tree as the live review target.
- `public/network-core.js` is a small pure IPv4 domain module. It owns parsing, overlap and containment, capacity, allocation, DHCP defaults, shortest-path traversal, and import normalization.
- `public/app.js` is a 607-line browser module that owns state, rendering, dialogs, local persistence, projects, imports and exports, recommendations, topology interaction, route animation, policy matrix, and report generation.
- `worker.js` serves the static asset binding, exposes `/api/health`, applies security headers, and redirects non-canonical hosts. `wrangler.toml` uses Worker Assets with `workers_dev = false`, `preview_urls = false`, `run_worker_first = true`, and custom routes for `network.illek.ie` and `netplanner.illek.ie`.
- The product has no server-side design store, authentication, API for plans, or paid binding. Designs are saved in browser `localStorage` under two keys. This is a meaningful privacy boundary, but it also makes browser clearing, quota, and local profile security part of the data-loss model.

### Automated checks

- `npm test`: 19 passing, 0 failing. This includes 11 core/static tests, 5 redirect tests, and 3 static checks.
- `npm run test:e2e`: 8 passing, 0 failing. These run against a local Wrangler server and cover sample tracing, hub policy, undo/redo, site recommendations, CSV import, projects, the 390px report, and a basic DHCP pool edit.
- `npm audit --omit=optional --audit-level=moderate`: 0 vulnerabilities reported.
- `npx wrangler deploy --dry-run`: completed with 8 assets and the configured `ASSETS` binding. There was no current `pages_build_output_dir` warning because this checkout is using Worker Assets, not a Pages build configuration.
- `git diff --check`: clean.

The tests are useful smoke coverage, but they do not test production, imported JSON edge cases, custom DHCP reservations, CSV round trips, HTML injection in the policy matrix, keyboard navigation, accessibility semantics, tablet layouts, export downloads, or browser storage quota behavior.

### Live production checks

- `GET https://network.illek.ie/`: HTTP 200, `content-type: text/html`, `cache-control: public, max-age=0, must-revalidate`, and a current Cloudflare cache hit.
- `GET https://network.illek.ie/api/health`: HTTP 200 with `{"ok":true,"service":"network-planner-studio","version":"0.1.0"}`.
- `http://network.illek.ie/`: HTTP 308 to the canonical HTTPS URL. `http://netplanner.illek.ie/api/health`: HTTP 301 to the canonical host while preserving path and query.
- Canonical responses include HSTS, CSP, `X-Content-Type-Options`, `X-Frame-Options`, Referrer-Policy, and Permissions-Policy. Unknown paths return 404 with the security headers.
- SHA-256 hashes for the canonical `app.js`, `network-core.js`, and `styles.css` match the local `public/` files exactly. The canonical HTML also matches the current source content.
- Production Playwright checks at 1440px and 390px loaded the sample, rendered the topology, opened the report, and found no document-level horizontal overflow. The 390px report tables correctly scroll inside their report sections.
- A sample production load produced nine CSP console errors from blocked inline style attributes. The page did not emit a JavaScript exception or failed request.
- At 1024px by 768px, `document.documentElement.scrollWidth` was 1107px for a 1024px viewport. At 844px by 390px, clicking the sample while it was below the fold left `scrollY` at 188px, so the workspace opened with its tabs scrolled above the viewport.
- A synthetic production navigation measured about 6.2 KB HTML transfer, 19.9 KB app transfer, 7.1 KB stylesheet transfer, and 3.6 KB core transfer. DOM content loaded at about 165 ms in that run. This is good for the current scope; it is not a substitute for real-device testing.

## Findings

Severity uses Critical, High, Medium, and Low. Evidence references the current working tree line numbers and the live checks above.

### Critical findings

None found in the reviewed public request paths. The product has no public plan mutation API, so the main risk is incorrect or misleading local output rather than a remote data breach.

### High findings

#### H-01: A stale Pages deployment remains publicly reachable

Evidence:

- `https://network-planner-studio.pages.dev/` returns HTTP 200 instead of redirecting or being unavailable.
- Its title is `Network Planner Studio`, while the canonical custom host serves the newer `Network Planner Studio: IPv4 network design, made visible` build.
- Its `app.js`, `network-core.js`, and `styles.css` hashes differ from the canonical host and local `public/` files.
- The Pages response exposes `Access-Control-Allow-Origin: *` and does not include the custom Worker's CSP or HSTS headers observed on `network.illek.ie`.
- The repository's `wrangler.toml` explicitly disables `workers_dev` and preview URLs, but that does not remove the separately hosted Pages project.

Impact:

Users, search engines, bookmarks, or support links can reach two different products. The old endpoint has different behavior and a weaker header posture. This conflicts with the deployment boundary that only the custom domain should be public and makes production verification ambiguous.

Recommendation:

Decommission the Pages project or make it perform a one-hop redirect to `https://network.illek.ie/`. Verify that no Pages or Workers development URL remains advertised, then add a release check that canonical and alternate host responses have the expected status and asset hashes. Do not keep two independently deployed copies.

#### H-02: Imported gateways are not validated as gateways in their subnet

Evidence:

- `public/network-core.js:96-100` accepts an imported `gateway` string without checking it.
- `public/app.js:550-559` accepts the CSV gateway value directly, also without validating it.
- `public/app.js:211-212` only checks whether a valid gateway falls inside a DHCP pool. It never emits an error when the gateway itself is outside the VLAN, is the network address, or is the broadcast address.
- A live browser import with subnet `10.40.10.0/24`, gateway `192.0.2.1`, and a valid pool produced only `Core checks passed` and a `Ready for technical review` report.

Impact:

An imported plan can print and export an unreachable gateway while all visible review gates say it is healthy. This undermines the central address-plan correctness claim and can cause a deployment outage.

Recommendation:

Validate every gateway with `validHostInSubnet` (or a separate point-to-point gateway rule for `/31`) during migration and during review. Reject or mark invalid imported records; do not silently preserve an invalid value. Add JSON, CSV, and report assertions for network, broadcast, outside-subnet, and `/31` cases.

#### H-03: Reserved address counts do not constrain custom DHCP pools

Evidence:

- `public/network-core.js:23-27` correctly starts an automatic pool after the gateway and reserved count.
- `public/app.js:473-475` validates only that custom pool endpoints are usable, ordered, and exclude the first gateway. It does not exclude the additional reserved addresses.
- `public/app.js:211-212` repeats the gateway-only check in the design review.
- A live import with `reserved: 5`, gateway `10.40.10.1`, and explicit pool `10.40.10.2` through `10.40.10.254` produced `Core checks passed`. Addresses `.2` through `.5` are inside the declared reserved block.

Impact:

The UI says reserved addresses are excluded, while an explicitly entered pool can lease them. This is an operationally unsafe DHCP plan and the error is invisible in the report status.

Recommendation:

Define reservation semantics precisely, then validate the entire reserved set, not just the gateway. The validator should report the first conflicting address and reject a pool that intersects network, broadcast, gateway, reserved addresses, or an explicit exclusion list. Add cases for `/30`, `/31`, and a reserved count larger than the usable host set.

#### H-04: CSV round trips silently discard explicit DHCP pool boundaries

Evidence:

- `public/app.js:566-569` exports `DHCP start` and `DHCP end` columns.
- `public/app.js:550-559` imports the CSV but never reads `record["dhcp start"]` or `record["dhcp end"]` when constructing the VLAN.
- A live CSV import containing pool `10.55.10.20` through `10.55.10.100` and `reserved: 5` produced `10.55.10.6` through `10.55.10.254`, the automatic default. The toast still said `CSV imported and validated`.

Impact:

Export and re-import is lossy. A consultant can hand a CSV to another person or use it as a backup and silently change the DHCP plan. This is especially dangerous because the import claims validation success.

Recommendation:

Preserve both pool columns, validate them using the same domain validator as the form, and fail the import when a populated pool is invalid. Add a round-trip test that compares every exported address field, including gateway, reserved count, DHCP state, pool start, and pool end.

#### H-05: The recommended new VLAN path creates an incomplete VLAN object

Evidence:

- `public/app.js:362-365` builds a recommended VLAN with only `id`, `name`, `role`, `devices`, `vid`, `cidr`, and `gateway`.
- `public/app.js:407-409` pushes that object directly into state without schema normalization or DHCP defaults.
- `public/app.js:164` treats a missing `dhcpEnabled` as static addressing, and `public/app.js:281` prints `Static` when the field is absent.
- A live production click sequence through `Recommend`, `New VLAN`, and `Apply recommendation` created a `users` VLAN that the inspector displayed as `Static addressing` and whose stored object had no DHCP pool fields.

Impact:

The recommendation can produce a plan that differs from the normal Add VLAN form and from the product's own role defaults. A user may export or print an apparently compatible recommendation with no DHCP plan.

Recommendation:

Create one canonical VLAN factory and use it for forms, recommendations, CSV import, sample data, and migration. Normalize before every state insertion. The recommendation preview should show DHCP state, reservations, gateway, and capacity so the user can review the full object before applying it.

#### H-06: Imported policy values can break out of HTML attributes

Evidence:

- `public/network-core.js:96-100` truncates imported roles but does not restrict them to a safe enum.
- `public/network-core.js:116` copies arbitrary `flowPolicies` values.
- `public/app.js:268-270` inserts role-derived `data-flow` keys and flow-policy values into `innerHTML` without `escapeHtml`.
- A live import with a role containing quote and tag characters rendered a nested `<span>` inside the policy button and rewrote the `data-flow` attribute. The current CSP blocks inline script execution, reducing XSS impact, but the markup injection remains and a future CSP change could turn it into script execution.

Impact:

Untrusted JSON or CSV can corrupt the policy view, create unexpected controls, and potentially become stored XSS if the CSP is relaxed or a browser context permits an event handler. Import is a normal product workflow, so the input should be treated as hostile.

Recommendation:

Use DOM construction or escape every dynamic attribute and class value. Restrict role and policy values to enums during migration, preserve unknown values as an explicit `other` value, and add an import security test that asserts no extra elements or event attributes are created.

### Medium findings

#### M-01: The CSP conflicts with dynamic inline styles and breaks VLAN role colours

Evidence:

- `worker.js:2` and `public/_headers:7` set `style-src 'self'` without `unsafe-inline`.
- `public/app.js:116` renders each VLAN dot with an inline `style="background:..."` attribute. `public/app.js:135` and `public/app.js:139` also set styles dynamically for canvas geometry.
- A production sample load produced nine browser CSP violations. All sampled VLAN dots computed to the same default blue rather than the role-specific colours in `ROLE_COLORS`.

Impact:

The security policy is noisy and the visual encoding of users, voice, guest, servers, and management roles is lost. Future dynamic style changes may fail silently in the same way.

Recommendation:

Keep the strict CSP and remove inline style attributes. Render safe role classes such as `role-users` and define colours in CSS. For geometry, use a CSP-compatible DOM/CSS strategy and test with the production header attached. Treat browser console CSP violations as a release failure.

#### M-02: Tablet layout overflows and hides top-level controls

Evidence:

- At 1024px by 768px, the body width was 1107px. `.top-actions` ended at x=1106.5px, so `Projects` and `+ Add site` were clipped offscreen.
- The `@media(max-width:1050px)` rule in `public/styles.css:44` moves the inspector offscreen with `transform: translateX(100%)`, but the transformed 310px panel still contributes to horizontal overflow.
- The mobile breakpoint is only 720px (`public/styles.css:45`), so the 1024px tablet keeps the full desktop action bar.

Impact:

Common laptop and tablet widths require horizontal scrolling and hide project and add-site actions. This is separate from the successful 390px check and can make the application appear broken during a client workshop.

Recommendation:

Add a responsive action-bar state before 1050px, clip or contain the off-canvas inspector, and test 768px, 834px, 1024px, and 1280px widths. Keep body overflow at the viewport width while allowing only intentional table and report scrolling.

#### M-03: Starting from a scrolled welcome page can open the workspace below its navigation

Evidence:

- `public/app.js:77-81` hides the welcome screen and reveals the workspace without resetting scroll position.
- At 844px by 390px, the sample link was below the fold. Clicking it left `scrollY` at 188px; the view tabs then had a top coordinate of -112px and the canvas toolbar began at -10px.

Impact:

Landscape phones and short browser windows can open directly into a workspace with its navigation and toolbar above the viewport. The user may not understand where the app went.

Recommendation:

Scroll to the workspace top after every start transition, or use a layout that does not depend on document scroll for the application shell. Add an e2e case with a short viewport and a below-fold start action.

#### M-04: Network CIDR parsing cannot represent valid route prefixes used by the UI

Evidence:

- `public/network-core.js:9-16` accepts only `/8` through `/31`.
- The connection form parses every advertised prefix through this function at `public/app.js:486`, so `0.0.0.0/0` and host routes such as `/32` cannot be entered.
- The report at `public/app.js:282` can print a default route as `0.0.0.0/0` even though the parser rejects that prefix.

Impact:

The address allocator's deliberate `/8` lower bound leaks into routing intent. A valid default route or host advertisement cannot be represented consistently, and the report can display a route the editor would reject.

Recommendation:

Separate `network allocation CIDR` validation from `routing prefix` validation. Keep allocation limits explicit, but allow `/0` through `/32` for advertised and learned routes, with canonical network-address checks. Add tests for default, host, and `/31` route prefixes.

#### M-05: The report claims policy coverage but omits the actual traffic-policy matrix

Evidence:

- `public/index.html:158-163` provides a Traffic policy view and `public/app.js:267-271` renders an editable role matrix.
- `public/index.html:165-171` describes the implementation report as covering policy, but `public/app.js:278-284` only emits site/address, WAN/routing, assumptions, and review sections. It never emits `flowPolicies`, the matrix, per-site breakout, or the centralized-inspection setting.
- A production sample report contained no Traffic policy section.

Impact:

The printed artifact is incomplete for the handoff it advertises. An operator receives routes and subnets without the intended trust-zone decisions, so the report cannot serve as a change-review packet.

Recommendation:

Add a policy matrix with source, destination, action, and rationale to the report. Include hub policy, breakout mode, centralized inspection, and unresolved assumptions. Add a print assertion for every policy cell and a warning when policy is still default-derived rather than explicitly accepted.

#### M-06: Accessibility semantics are incomplete for core interactions

Evidence:

- View navigation in `public/index.html:72-78` uses buttons and a CSS `active` class but no tablist, tab, or `aria-selected` semantics.
- Site and VLAN rows rendered at `public/app.js:113-117` are clickable `div` elements without keyboard roles or focus behavior. Only topology nodes receive `role="button"` and keyboard handling at `public/app.js:138` and `public/app.js:538`.
- Dialog headings have IDs, but the `<dialog>` elements at `public/index.html:177`, `196`, `217`, and later have no `aria-labelledby` or accessible name.
- No automated accessibility audit is present in the test suite.

Impact:

Keyboard and screen-reader users cannot reliably select the site tree, understand the active view, or identify dialog context. This matters for a professional handoff tool with dense data tables.

Recommendation:

Use semantic tabs or add the appropriate ARIA state, make rows buttons or links with visible focus, label each dialog, and add an automated axe or equivalent audit to desktop and 390px CI runs. Keep the existing topology-node keyboard support.

#### M-07: Storage writes have no quota, corruption, or recovery boundary

Evidence:

- `public/app.js:57-62` reads and writes both local storage keys without a quota/error path. `saveState()` serializes the complete design into the current key and the project library key on every save.
- The library has no count, size, or retention limit, and duplicate projects multiply serialized data.
- `localStorage` is plaintext browser profile storage, not encrypted project storage.

Impact:

A full browser quota or a partially corrupted key can turn a normal edit into an uncaught write failure or make a design disappear on reload. Users can also mistake browser-local storage for a secure backup.

Recommendation:

Wrap writes, surface a clear export/recovery prompt, keep a small bounded journal or use IndexedDB for larger designs, and document that local projects are not encrypted backups. Add storage failure tests with mocked `setItem` errors.

#### M-08: Import normalization is stronger for numbers than for schema and link identity

Evidence:

- Numeric fields are bounded in `public/network-core.js:89-107`, which is good defensive work.
- Link IDs are not checked for uniqueness, advertised prefixes are string-copied without parsing, and topology roles, link types, routing types, and policy values are not enum-normalized.
- `nextSubnet` at `public/network-core.js:40-47` does not validate its `prefix` argument; a direct call with `99` returns `10.0.0.0/99` rather than rejecting it. UI callers currently supply normal values, but the domain module is exported and under-tested at this boundary.

Impact:

Malformed imports can create duplicate SVG route IDs, misleading route/report metadata, or invalid values that bypass the editor's normal form constraints. The module's apparent safety is uneven.

Recommendation:

Add a versioned schema validator before normalization, enforce unique IDs, parse every advertised prefix, normalize enums, and validate allocator arguments. Add property-based tests for malformed prefixes, duplicate IDs, invalid gateway/pools, and round-trip invariants.

### Low findings

#### L-01: The sample starts with four review risks and a score that can undermine first-run confidence

The sample deliberately contains single-WAN and policy advice, so the first screen shows `Design review 4` and a risk message. That is honest, but it makes the example feel unfinished before the user has seen the product's strengths. Label sample findings as intentional teaching points or make the sample fully healthy and use a separate invalid example.

#### L-02: The code has a monolithic UI module and small maintenance remnants

`public/app.js` combines state, domain orchestration, HTML templates, events, persistence, and export code. `startTraceSelection()` at `public/app.js:571-573` is unused. Split schema/state, renderers, import/export, and interaction controllers after correctness work, and remove dead paths as part of that refactor.

#### L-03: Address plans and site lists have no search, filter, sort, or duplicate detection view

The current layout is pleasant for a handful of sites and VLANs. A real MSP or consultant plan can quickly exceed that size. Add lightweight search and filtering only after a trial shows the need; do not build a large inventory system prematurely.

#### L-04: Browser capability assumptions are undocumented

The application depends on ES modules, `<dialog>`, `crypto.randomUUID`, SVG `animateMotion`, and modern CSS. There is no fallback or unsupported-browser message. Add a small capability check or state the supported browser baseline in the README and report.

#### L-05: The public health endpoint accepts all methods

The Worker returns the same health JSON for `GET`, `POST`, and `OPTIONS`. There is no sensitive state and no mutation, so this is low risk, but `GET` and `HEAD` plus an explicit `Allow` policy would be cleaner and reduce accidental API assumptions.

## What is working well

- The local-first architecture is easy to explain and has a small attack surface. No design data was observed leaving the browser during the production flows.
- The custom domain Worker configuration is materially better than a generic preview deployment: `workers_dev` and preview URLs are disabled, canonical redirects are tested, and security headers are present.
- IPv4 arithmetic covers aligned networks, overlap, containment, endpoint capacity, `/31` transit, and shortest paths. The pure core is easy to unit test and the existing tests cover several boundary cases.
- The sample topology is legible on desktop. Nodes, links, hub status, route tracing, and the site tree make the relationship between address plan and topology clear.
- The 390px report overflow issue recorded in earlier project history is currently addressed. Report tables scroll within sections and the document width stayed at 390px in the live check.
- Undo/redo, project duplication, JSON export, CSV export, import, and print output make the prototype useful as a workshop tool instead of a disposable calculator.
- The default security headers are strong for a static local-plan product. The main CSP issue is an implementation mismatch, not an absence of a policy.
- Static payloads are small and there are no third-party application dependencies or external fonts in the reviewed page.

## Product and market assessment

### Best customer job

The strongest job is a consultant or small network team turning an existing flat or partly documented IPv4 environment into a reviewable site, VLAN, WAN, and handoff plan. The user needs address math, overlap detection, route intent, assumptions, and a client-ready artifact in one short session. The no-login, local browser model removes the friction of putting confidential network details into a new SaaS account.

### Differentiation

The product has a credible wedge at the intersection of an IP calculator, an architecture whiteboard, and a change-handoff generator:

- Generic diagram tools such as [diagrams.net](https://www.diagrams.net/) draw networks well but do not enforce CIDR containment, endpoint capacity, DHCP exclusion, or route policy.
- Established IPAM products such as [NetBox IPAM](https://netbox.readthedocs.io/en/feature/features/ipam/) and [phpIPAM](https://www.phpipam.net/) are much stronger sources of truth with IPv4 and IPv6, persistent records, APIs, and broader inventory capabilities. They are not a replacement for a fast, disposable architecture workshop artifact.
- The useful promise is therefore "make a defensible network change plan quickly and privately", not "replace IPAM" or "simulate a real network".

The current recommendation assistant is not yet a differentiator. It is a set of fixed heuristics and conventional VLAN IDs. It becomes differentiated only when it can explain constraints, preserve the full schema, show conflicts, and produce a verified acceptance pack from real before-and-after plans.

### Value and risk

Current value is high for a small, bounded workshop and low for ongoing operations. The product does not discover devices, resolve DNS/DHCP reality, model VRFs, represent IPv6, validate vendor behavior, generate device configuration, or prove that a real packet will follow the animated route. The UI sometimes uses language such as "live topology" and "implementation report" that can imply more authority than the model provides.

Positioning should stay explicit: an interactive IPv4 architecture and change-planning workbench, with human review required. This is a good technical product direction if real users confirm that the report and import workflow save them time.

### Features to remove, rename, or defer

- Rename `Compatibility assistant` to a clearly bounded `Draft allocation` until it has schema-complete output and confidence tests.
- Remove or reword `centralized inspection` if it remains metadata only. The current checkbox does not model firewall placement, policy enforcement, or route asymmetry.
- Avoid presenting the score ring as a network health score. It is a count-weighted design heuristic, not an operational health measure.
- Remove the stale Pages deployment and any preview-host references.
- Do not add a large icon library, generic diagramming features, or a server-side project gallery to solve a market problem that has not been validated.

### Features worth adding after the correctness gate

- A complete, lossless address-plan acceptance pack: policy matrix, default routes, breakout, hub assignments, route prefixes, DHCP exclusions, assumptions, owner, date, and unresolved decisions.
- A formal schema with explicit allocation CIDRs, routing prefixes, gateway rules, pool reservations, and policy enums.
- Import adapters for the one or two real source formats encountered in trials, with a visible diff and rejected-row report.
- A route explanation that distinguishes topology reachability from routing advertisement and states when it is only an intent simulation.
- A small acceptance checklist that a human can sign off before the plan is exported.
- Search and filter for plans that exceed workshop size, only if user trials demonstrate that need.

IPv6, VRF, live discovery, vendor configuration generation, and cloud synchronization may be valuable later, but they should follow evidence of demand rather than broaden the first product wedge.

## Recommended implementation plan, ordered by impact and effort

| Order | Work | Impact | Effort | Release gate |
| --- | --- | --- | --- | --- |
| 1 | Build one canonical schema and factory for sites, VLANs, links, pools, gateways, policies, and recommendations. Validate gateway, reserved ranges, pool, prefixes, enums, and unique IDs on every entry path. | Very high | Medium | Malformed JSON and CSV are rejected or visibly quarantined; no invalid plan can show Core checks passed. |
| 2 | Fix lossless CSV import/export and recommendation output. Add round-trip tests for explicit DHCP pools, gateway, reservations, disabled DHCP, notes, and all route fields. | Very high | Medium | Export then import produces an equivalent normalized design. Recommendation output passes the same schema as Add VLAN. |
| 3 | Close the import HTML injection path and make the CSP clean. Replace inline role styles with classes and add a production-header browser test that fails on console CSP errors. | High | Small | Zero console CSP violations on sample, malicious import, and report flows. |
| 4 | Remove or redirect the stale Pages deployment and deploy only from a clean, identifiable commit. Add a canonical-host smoke check and record a release version in health output. | High | Small, external | Custom host is the only live application endpoint and alternate hosts redirect or 404. |
| 5 | Fix responsive layout at 768px to 1280px, reset scroll after start transitions, and add keyboard and dialog semantics. | Medium | Medium | No document overflow at supported widths; keyboard can reach every site, VLAN, tab, dialog, and report action. |
| 6 | Complete the implementation report with policy matrix, breakout, inspection intent, hub assignments, route assumptions, explicit unresolved decisions, and a generated schema/version. | High | Medium | A printed report contains every field required to reproduce and review the design. |
| 7 | Add core property tests, import fuzz cases, storage failure tests, export-download tests, and a production smoke workflow. Split UI modules only after the model and release gates are stable. | Medium | Medium | CI covers core invariants and current production behavior without relying on string-presence tests. |
| 8 | Run a small, privacy-respecting user trial with network consultants or MSP engineers. Measure time to import, resolve overlaps, complete a report, and catch intentional faults. | Very high product learning | Small | Continue, narrow, or stop based on observed repeat use and willingness to use the report in a real review. |

## Explicit do-not-implement list

- Do not add a server-side database, account system, or cloud sync before users demonstrate a need that outweighs the local-first privacy advantage.
- Do not make the app a live network scanner, configuration pusher, or automated change executor. That would require a separate security boundary, credential model, approvals, and operational rollback design.
- Do not treat the animated path as packet-level simulation or claim vendor routing correctness. Keep it clearly labelled as topology and route-intent reasoning.
- Do not expand the heuristic recommendation assistant, add AI-generated designs, or increase its authority until schema-complete output and real-user evidence exist.
- Do not add IPv6, VRF, DNS/DHCP integrations, or vendor-specific configuration generators as general-purpose feature expansion before the IPv4 handoff workflow is trusted.
- Do not add generic diagramming, icon marketplace, client CRM, ticketing, or MSP portal features. They dilute the technical wedge and compete with mature products.
- Do not keep Pages, Workers preview, and custom-domain copies alive in parallel. One canonical deployment is enough.
- Do not claim that a green score or `Ready for technical review` status is a deployment approval. The output still requires a human network owner and implementation review.

## Final assessment

The product direction is worth a focused trial. The interface makes an otherwise dry address plan understandable, and the local-first architecture is a real advantage for confidential network workshops. The current release needs a correctness pass before it can be trusted with client handoff: imported plans, CSV backups, and recommendations must all produce the same validated schema, and the report must contain the policy decisions that the UI lets users make. Once those gates pass, the strongest next step is user validation of the narrow architecture-to-handoff workflow, not a broad feature expansion.
