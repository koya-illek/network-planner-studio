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
});

test("worker exposes health and hardened assets", async () => {
  const worker = await readFile(new URL("worker.js", root), "utf8");
  const headers = await readFile(new URL("public/_headers", root), "utf8");
  assert.match(worker, /\/api\/health/);
  assert.match(worker, /Content-Security-Policy/);
  assert.ok(worker.includes("static.cloudflareinsights.com"));
  assert.ok(headers.includes("Content-Security-Policy"));
  assert.ok(headers.includes("Strict-Transport-Security"));
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
