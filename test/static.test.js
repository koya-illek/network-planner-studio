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
  assert.match(worker, /\/api\/health/);
  assert.match(worker, /Content-Security-Policy/);
  assert.ok(worker.includes("static.cloudflareinsights.com"));
  assert.ok(headers.includes("Content-Security-Policy"));
  const hsts="max-age=31536000; includeSubDomains; preload";
  assert.ok(worker.includes(hsts));
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

test("health release version matches package.json", async () => {
  const pkg = JSON.parse(await readFile(new URL("package.json", root), "utf8"));
  const worker = await readFile(new URL("worker.js", root), "utf8");
  assert.ok(worker.includes(`version: "${pkg.version}"`), "worker health payload must report the package.json version");
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

test("iteration-4 keeps keyboard focus across selection, policy and resize re-renders", async () => {
  const app = await readFile(new URL("public/app.js", root), "utf8");
  assert.match(app, /function focusKeeper\(\)/, "render passes must capture focused element identity");
  assert.match(app, /function restoreFocus\(keeper\)/, "focus restoration helper must exist");
  assert.ok((app.match(/restoreFocus\(keeper\)/g) ?? []).length >= 3, "render() and the resize relayout must both restore focus");
});

test("iteration-4 sets cross-origin isolation headers", async () => {
  const worker = await readFile(new URL("worker.js", root), "utf8");
  const headers = await readFile(new URL("public/_headers", root), "utf8");
  for (const header of ["Cross-Origin-Opener-Policy", "Cross-Origin-Resource-Policy"]) {
    assert.ok(worker.includes(`"${header}": "same-origin"`), `${header} must be set by the worker`);
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

test("iteration-6 flushes pending saves on pagehide", async () => {
  const app = await readFile(new URL("public/app.js", root), "utf8");
  assert.match(app, /window\.addEventListener\("pagehide",\(\)=>\{if\(touch\.timer\)\{clearTimeout\(touch\.timer\);touch\.timer=null;saveState\(\)\}\}\)/, "the debounce window must not swallow the last edit on tab close");
});

test("iteration-7 keeps stored gateways and surfaces cross-tab conflicts", async () => {
  const app = await readFile(new URL("public/app.js", root), "utf8");
  const html = await readFile(new URL("public/index.html", root), "utf8");
  assert.match(app, /previousGateway&&validateGateway\(previousGateway,cidr/, "a VLAN edit must keep a stored gateway that is still valid for the subnet");
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

