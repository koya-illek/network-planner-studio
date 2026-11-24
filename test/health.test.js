import test from "node:test";
import assert from "node:assert/strict";
import worker from "../worker.js";

const request = (method = "GET") => new Request("https://network.illek.ie/api/health", { method });
const noAssetReads = { ASSETS: { fetch() { throw new Error("Health must not read assets"); } } };

test("health reports injected release revision and Cloudflare version without asset reads", async () => {
  const response = await worker.fetch(request(), {
    ...noAssetReads,
    SOURCE_REVISION: "a1b2c3d4e5f6",
    VERSION_METADATA: { id: "390cbe8b-280e-4dfe-ac2d-1eeb94130b81" }
  });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(body.sourceRevision, "a1b2c3d4e5f6");
  assert.equal(body.deploymentId, "390cbe8b-280e-4dfe-ac2d-1eeb94130b81");
  assert.deepEqual(body.checks, { scope: "process-liveness", assetRead: "not-checked", planValidation: "not-checked" });
});

test("health leaves absent or invalid release metadata honestly unknown", async () => {
  for (const env of [noAssetReads, { ...noAssetReads, SOURCE_REVISION: " ", VERSION_METADATA: { id: null } }]) {
    const body = await (await worker.fetch(request(), env)).json();
    assert.equal(body.sourceRevision, "unknown");
    assert.equal(body.deploymentId, "unknown");
  }
});

test("health preserves cheap HEAD, OPTIONS and method rejection behavior", async () => {
  for (const [method, expected] of [["HEAD", 200], ["OPTIONS", 204], ["POST", 405]]) {
    const response = await worker.fetch(request(method), noAssetReads);
    assert.equal(response.status, expected);
    assert.equal(response.headers.get("allow"), "GET, HEAD, OPTIONS");
    if (method !== "POST") assert.equal(await response.text(), "");
  }
});
