import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);

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
  assert.equal(health.api, undefined, "health must not advertise a planning API");
  assert.equal(health.mcp, undefined, "health must not advertise an MCP endpoint");
});

test("former machine-surface paths are not served by the worker", async () => {
  const { default: worker } = await import("../worker.js");
  const env = { ASSETS: { fetch: async () => new Response("That page is not on the map", { status: 404 }) } };
  for (const path of ["/api/v1", "/api/v1/validate", "/api/v1/openapi.json", "/mcp"]) {
    const response = await worker.fetch(new Request(`http://127.0.0.1${path}`), env);
    assert.equal(response.status, 404, `${path} must not be a product surface`);
  }
});
