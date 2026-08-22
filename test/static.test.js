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
