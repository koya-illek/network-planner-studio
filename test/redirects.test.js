import test from "node:test";
import assert from "node:assert/strict";
import { redirectForRequest } from "../worker.js";

test("HTTP network homepage redirects permanently to canonical HTTPS", () => {
  const response = redirectForRequest(new Request("http://network.illek.ie/?from=test"));
  assert.equal(response.status, 308);
  assert.equal(response.headers.get("location"), "https://network.illek.ie/?from=test");
});

test("HTTP network API paths redirect while preserving path and query", () => {
  const response = redirectForRequest(new Request("http://network.illek.ie/api/health?check=1"));
  assert.equal(response.status, 308);
  assert.equal(response.headers.get("location"), "https://network.illek.ie/api/health?check=1");
});

test("spoofable local-looking headers cannot bypass the production HTTP redirect", () => {
  const response = redirectForRequest(new Request("http://network.illek.ie/?spoofed=1", {
    headers: {
      Host: "127.0.0.1:8799",
      "CF-Connecting-IP": "127.0.0.1",
      "MF-Original-Hostname": "localhost",
    },
  }));
  assert.equal(response.status, 308);
  assert.equal(response.headers.get("location"), "https://network.illek.ie/?spoofed=1");
});

test("legacy netplanner alias uses one-hop canonical HTTPS redirect", () => {
  const response = redirectForRequest(new Request("http://netplanner.illek.ie/api/health?check=1"));
  assert.equal(response.status, 301);
  assert.equal(response.headers.get("location"), "https://network.illek.ie/api/health?check=1");
});

test("HTTPS requests to the legacy alias also canonicalize to network", () => {
  const response = redirectForRequest(new Request("https://netplanner.illek.ie/?plan=x"));
  assert.equal(response.status, 301);
  assert.equal(response.headers.get("location"), "https://network.illek.ie/?plan=x");
});

test("canonical HTTPS network requests are not redirected", () => {
  assert.equal(redirectForRequest(new Request("https://network.illek.ie/")), null);
});
