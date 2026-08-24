import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);

test("application is explicitly IPv4-only", async () => {
  const html = await readFile(new URL("public/index.html", root), "utf8");
  assert.match(html, /IPv4 network design/);
  assert.doesNotMatch(html, /IPv6/i);
});

test("existing sites, VLANs and path tracing are present", async () => {
  const html = await readFile(new URL("public/index.html", root), "utf8");
  const app = await readFile(new URL("public/app.js", root), "utf8");
  assert.match(html, /Map an existing network/);
  assert.match(html, /Add a VLAN/);
  assert.match(html, /Connect sites/);
  assert.match(app, /animateTrace/);
  assert.match(app, /showHome/);
  assert.match(app, /rangesOverlap/);
  assert.match(app, /contains/);
  assert.match(html, /Implementation report/);
  assert.match(html, /Your designs/);
  assert.match(html, /Project and file commands/);
  assert.match(html, /<summary class="button ghost">More<\/summary>/);
});

test("worker exposes health and hardened assets", async () => {
  const worker = await readFile(new URL("worker.js", root), "utf8");
  const headers = await readFile(new URL("public/_headers", root), "utf8");
  const securityModule = await readFile(new URL("headers.js", root), "utf8");
  assert.match(worker, /\/api\/health/);
  // The hardening set has one source (headers.js); the worker applies it to
  // every response it produces.
  assert.match(worker, /import \{ SECURITY_HEADERS \} from "\.\/headers\.js"/);
  assert.match(worker, /for \(const \[key, value\] of Object\.entries\(SECURITY_HEADERS\)\)/);
  assert.match(securityModule, /Content-Security-Policy/);
  assert.ok(securityModule.includes("script-src 'self'"));
  assert.doesNotMatch(securityModule, /cloudflareinsights\.com/, "the local-only application must not allow unused third-party script or connection origins");
  assert.doesNotMatch(worker, /cloudflareinsights\.com/);
  assert.ok(headers.includes("Content-Security-Policy"));
  assert.doesNotMatch(headers, /cloudflareinsights\.com/, "static headers must mirror the self-only runtime policy");
  const hsts="max-age=31536000; includeSubDomains; preload";
  assert.ok(securityModule.includes(hsts));
  assert.ok(headers.includes(hsts));
  assert.match(worker, /env\.ASSETS\.fetch/);
  assert.match(worker, /X-Robots-Tag/);
  const wrangler = await readFile(new URL("wrangler.toml", root), "utf8");
  assert.match(wrangler, /run_worker_first\s*=\s*true/);
  const html = await readFile(new URL("public/index.html", root), "utf8");
  assert.match(html, /rel="canonical"/);
  assert.match(html, /property="og:image"/);
  assert.match(html, /<script type="application\/ld\+json">/);
  assert.match(html, /Skip to network planner/);
  assert.equal((html.match(/<h1\b/g) ?? []).length, 1);
  assert.doesNotMatch(html, /class="(?:eyebrow|kicker)"/);
  assert.doesNotMatch(html, /—/);
});

test("health and lockfile release provenance match package.json", async () => {
  const pkg = JSON.parse(await readFile(new URL("package.json", root), "utf8"));
  const lock = JSON.parse(await readFile(new URL("package-lock.json", root), "utf8"));
  const { default: worker } = await import("../worker.js");
  const response = await worker.fetch(new Request("http://127.0.0.1/api/health"), {});
  const health = await response.json();
  assert.equal(lock.version, pkg.version, "lockfile metadata must report the package.json version");
  assert.equal(lock.packages[""].version, pkg.version, "lockfile root package must report the package.json version");
  assert.equal(health.service, pkg.name, "health must report the package name");
  assert.equal(health.version, pkg.version, "health must report the package version");
});

test("round-2 affordances stay wired: motion, touch, live errors, keyboard links, inspector close", async () => {
  const css = await readFile(new URL("public/styles.css", root), "utf8");
  const html = await readFile(new URL("public/index.html", root), "utf8");
  const app = await readFile(new URL("public/app.js", root), "utf8");
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(css, /@media \(pointer: coarse\)/);
  const liveErrors = (html.match(/class="form-error" aria-live="polite"/g) ?? []).length;
  assert.ok(liveErrors >= 6, "every form-error region must be a live region");
  assert.ok(app.includes('e.target.closest?.(".link-hit")') && app.includes('{type:"link",id:hit.dataset.link}'), "canvas links must be keyboard-reachable");
  assert.ok(app.includes("[data-inspector-close]"), "inspector overlay must have a close affordance");
});

test("round-3 safeguards stay wired: native keyboard activation, tolerant revival, growth editing, trace-safe resize", async () => {
  const app = await readFile(new URL("public/app.js", root), "utf8");
  const html = await readFile(new URL("public/index.html", root), "utf8");
  assert.ok(
    app.includes('!e.target.closest?.("button,a,input,select,textarea")'),
    "Enter/Space handling must not hijack native controls inside rows"
  );
  assert.match(app, /function reviveDesign\(raw\)\{try\{return migrateDesign\(raw\)\}catch\{return migrateDesign\(raw,\{strict:false\}\)\}\}/, "internal state revival must fall back to lenient migration");
  assert.ok((app.match(/reviveDesign\(/g) ?? []).length >= 4, "undo/redo, duplicate and library open must use tolerant revival");
  assert.match(app, /data-dynamic-growth/, "site dialog must preserve off-list growth allowances");
  assert.ok(app.includes('resizeFrame=requestAnimationFrame(renderCanvas)') === false && app.includes("resizeFrame=requestAnimationFrame(()=>{const keeper=focusKeeper();renderCanvas();restoreFocus(keeper)})"), "resize relayout must be coalesced, trace-safe and keep node focus");
  assert.match(app, /aria-label="Design score \$\{score\} out of 100"/, "score ring needs an accessible name");
  assert.match(html, /<aside id="inspector"[^>]*tabindex="-1"/, "inspector must be focusable for focus restoration");
  assert.match(html, /property="og:site_name"/);
});

test("round-2 keyboard shortcuts and machine surfaces are wired", async () => {
  const app = await readFile(new URL("public/app.js", root), "utf8");
  const html = await readFile(new URL("public/index.html", root), "utf8");
  const worker = await readFile(new URL("worker.js", root), "utf8");
  // Editor shortcuts must yield to native text undo while typing or in a dialog.
  assert.match(app, /\["z","y"\]\.includes\(e\.key\.toLowerCase\(\)\)/);
  assert.match(app, /if\(typing\|\|\$\("dialog\[open\]"\)\)return/);
  assert.match(html, /aria-keyshortcuts="Control\+Z Meta\+Z"/);
  assert.match(html, /aria-keyshortcuts="Control\+Shift\+Z Control\+Y Meta\+Shift\+Z Meta\+Y"/);
  assert.match(app, /behavior:prefersReducedMotion\.matches\?"auto":"smooth"/, "home scrolling must honour reduced motion");
  // Machine surface routing lives on the worker.
  assert.match(worker, /handleMcpRequest/);
  assert.match(worker, /handleApiRequest/);
});

test("iteration-4 keeps keyboard focus across selection, policy and resize re-renders", async () => {
  const app = await readFile(new URL("public/app.js", root), "utf8");
  assert.match(app, /function focusKeeper\(\)/, "render passes must capture focused element identity");
  assert.match(app, /function restoreFocus\(keeper\)/, "focus restoration helper must exist");
  assert.ok((app.match(/restoreFocus\(keeper\)/g) ?? []).length >= 3, "render() and the resize relayout must both restore focus");
});

test("iteration-4 sets cross-origin isolation headers", async () => {
  const worker = await readFile(new URL("worker.js", root), "utf8");
  const headers = await readFile(new URL("public/_headers", root), "utf8");
  const securityModule = await readFile(new URL("headers.js", root), "utf8");
  for (const header of ["Cross-Origin-Opener-Policy", "Cross-Origin-Resource-Policy"]) {
    assert.ok(securityModule.includes(`"${header}": "same-origin"`), `${header} must be declared in the shared security module`);
    assert.ok(worker.includes('from "./headers.js"'), "the worker must apply the shared security module");
    assert.ok(headers.includes(header), `${header} must be mirrored in _headers`);
  }
});

test("iteration-5 keeps local dev off the production redirect path", async () => {
  const pkg = JSON.parse(await readFile(new URL("package.json", root), "utf8"));
  assert.ok(
    pkg.scripts.dev.includes("--local") && pkg.scripts.dev.includes("--host 127.0.0.1"),
    "npm run dev must pin the local host or wrangler route simulation loops on the http->https upgrade"
  );
});

test("iteration-5 marks the health endpoint uncacheable without touching asset caching", async () => {
  const worker = await readFile(new URL("worker.js", root), "utf8");
  const securityBlock = worker.slice(worker.indexOf("SECURITY_HEADERS"), worker.indexOf("export default"));
  assert.ok(!securityBlock.includes("Cache-Control"), "shared security headers must not disable asset caching");
  assert.ok(worker.includes('headers.set("Cache-Control", "no-store")'), "health responses must be no-store");
});

test("iteration-6 flushes pending saves on pagehide and on backgrounding", async () => {
  const app = await readFile(new URL("public/app.js", root), "utf8");
  assert.match(app, /function flushPendingSave\(\)\{if\(touch\.timer\)\{clearTimeout\(touch\.timer\);touch\.timer=null;saveState\(\)\}\}/, "the debounce window must not swallow the last edit");
  assert.match(app, /window\.addEventListener\("pagehide",flushPendingSave\)/, "pagehide must flush the debounce");
  assert.match(app, /document\.addEventListener\("visibilitychange",\(\)=>\{if\(document\.visibilityState==="hidden"\)flushPendingSave\(\)\}\)/, "backgrounding the tab must flush the debounce before mobile discards it");
});

test("quarantines unreadable stored state instead of overwriting it", async () => {
  const app = await readFile(new URL("public/app.js", root), "utf8");
  assert.match(app, /function quarantineStorage\(key\)\{[\s\S]*?localStorage\.getItem\(key\);if\(raw!=null\)localStorage\.setItem\(`\$\{key\}\.unreadable`,raw\)[\s\S]*?catch\{\}\}/, "the raw corrupt blob must be preserved before any rewrite");
  const quarantines = (app.match(/quarantineStorage\(/g) ?? []).length;
  assert.ok(quarantines >= 3, "both loadState and loadLibrary must quarantine (definition plus two call sites)");
  assert.match(app, /could not be read\. The raw copy was kept under/, "the recovery message must tell the user where the copy lives");
});

test("canvas health, link resilience and escape selection are wired", async () => {
  const app = await readFile(new URL("public/app.js", root), "utf8");
  const html = await readFile(new URL("public/index.html", root), "utf8");
  assert.match(app, /class="health-flag \$\{health\}"/, "node health must carry a text flag, not a colour-only dot");
  assert.match(app, /function healthWord\(health\)\{return health==="error"\?"blocking issues":health==="warning"\?"risks to review":""\}/);
  assert.match(app, /redundant paths":"single path/, "link labels must announce resilience in words");
  assert.match(html, /id="trace-detail" aria-live="polite"/, "trace progress must be announced");
  assert.doesNotMatch(app, /walk=id=>/, "connectivity must not recurse per site");
  assert.match(app, /Escape is the keyboard counterpart of the inspector close button/);
  assert.match(app, /roles\.filter\(destination=>destination!==source\)/, "the report must not present same-zone rows as policies");
});

test("imports tolerate BOMs and data tables carry scoped headers", async () => {
  const app = await readFile(new URL("public/app.js", root), "utf8");
  const html = await readFile(new URL("public/index.html", root), "utf8");
  const css = await readFile(new URL("public/styles.css", root), "utf8");
  assert.match(app, /JSON\.parse\(text\.replace\(\/\^\\uFEFF\/,""\)\)/, "JSON imports must strip a UTF-8 BOM like the CSV path does");
  const colScopes = (html.match(/th scope="col"/g) ?? []).length + (app.match(/th scope="col"/g) ?? []).length;
  assert.ok(colScopes >= 14, "every data table header must declare its scope");
  assert.match(app, /<tr><th scope="row">/, "policy matrix row headers must be scoped");
  assert.match(css, /\.mode-group button,\.zoom-controls button\{min-height:44px\}/, "coarse pointers need full-size toolbar targets");
  assert.match(html, /rel="modulepreload" href="\/network-core\.js"/, "the core module must load in parallel with the app");
  assert.match(html, /name="twitter:image:alt"/);
  assert.match(html, /"isAccessibleForFree":true/);
});

test("iteration-7 keeps stored gateways and surfaces cross-tab conflicts", async () => {
  const app = await readFile(new URL("public/app.js", root), "utf8");
  const html = await readFile(new URL("public/index.html", root), "utf8");
  assert.match(html, /input name="gateway"/, "the VLAN form must expose custom gateways instead of silently replacing them");
  assert.match(app, /gateway=fd\.get\("gateway"\)\.trim\(\)\|\|firstUsable\(cidr\)/, "a VLAN edit must submit the visible gateway value");
  assert.ok(app.includes('window.addEventListener("storage"') && app.includes("e.key!==STORAGE_KEY"), "cross-tab writes to the current design must raise a warning");
  assert.match(html, /id="canvas" class="canvas" role="region"/, "the focusable canvas must expose its label through a region role");
  for (const dead of ["ipToInt", "validHostInSubnet", "validateDesign"]) {
    const occurrences = (app.match(new RegExp(`\\b${dead}\\b`, "g")) ?? []).length;
    assert.ok(occurrences === 0, `${dead} is no longer imported by app.js`);
  }
});

test("iteration-8 keeps touch canvas gestures reliable", async () => {
  const css = await readFile(new URL("public/styles.css", root), "utf8");
  const app = await readFile(new URL("public/app.js", root), "utf8");
  assert.match(css, /\.canvas\{[^}]*touch-action:none/, "browser gestures must not hijack drags that start on the canvas");
  assert.match(app, /let activePointers = new Map\(\);[\s\S]*?let pinch = null;/, "multi-touch pointers must be tracked for pinch zoom");
  assert.match(app, /function capturePointer\(e\)\{try\{e\.currentTarget\.setPointerCapture\(e\.pointerId\)\}catch\{\}\}/, "setPointerCapture must be guarded against inactive pointers");
  assert.ok(app.includes('addEventListener("pointercancel"'), "cancelled gestures must abort instead of leaving a stuck drag");
  assert.match(app, /pinch=\{dist:Math\.hypot\(a\.x-b\.x,a\.y-b\.y\)\|\|1,zoom:canvasZoom\}/, "pinch baseline must come from the two active pointers");
});

test("iteration-8 defers workspace renders behind open modals", async () => {
  const app = await readFile(new URL("public/app.js", root), "utf8");
  assert.match(app, /if\(\$\("dialog\[open\]"\)\)\{touch\.deferred=true;return\}/, "a debounced render must not replace DOM behind an open dialog");
  assert.match(app, /addEventListener\("close",e=>\{[^}]+\},true\)/, "the deferred render must flush when a dialog closes");
});

test("iteration-8 never proposes an occupied VLAN ID", async () => {
  const app = await readFile(new URL("public/app.js", root), "utf8");
  assert.match(app, /for\(let id=1;id<=4094;id\+\+\)if\(!site\.vlans\.some\(v=>v\.vid===id\)\)return id;return null/, "nextVid must scan every valid ID and report exhaustion instead of returning an occupied value");
});

test("iteration-9 keeps interrupted gestures honest", async () => {
  const app = await readFile(new URL("public/app.js", root), "utf8");
  assert.match(app, /if\(!commit\)\{drag\.site\.x=drag\.x;drag\.site\.y=drag\.y;if\(drag\.moved\)renderCanvas\(\)\}/, "a cancelled drag must restore the pre-drag coordinates before dropping the history entry");
  assert.match(app, /else if\(drag&&drag\.moved\)touch\(\)/, "a moved drag swallowed by a pinch must settle through the save pipeline");
  assert.match(app, /nudgeBurst\.siteId!==site\.id\|\|now-nudgeBurst\.at>600/, "keyboard nudges must coalesce only for the same node in one burst");
  assert.match(app, /function restoreHistory\([\s\S]*?nudgeBurst=\{siteId:null,at:0\}/, "undo and redo must close the current nudge burst");
  assert.ok(!app.includes("setTimeout(saveState,220)"), "nudge saves must flow through the shared touch pipeline");
});
