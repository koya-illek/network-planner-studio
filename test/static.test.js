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
  assert.equal(health.api, "v1", "health must point at the REST surface version");
  assert.equal(health.mcp, "/mcp", "health must point at the MCP endpoint");
});
