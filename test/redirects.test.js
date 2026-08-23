import test from "node:test";
import assert from "node:assert/strict";
import { redirectForRequest } from "../worker.js";

test("every redirect response carries the security headers with an intact Location", () => {
  const redirects = [
    redirectForRequest(new Request("http://network.illek.ie/?from=test")),
    redirectForRequest(new Request("https://netplanner.illek.ie/plan?x=1")),
  ];
  for (const response of redirects) {
    assert.ok(response, "expected a redirect response");
    for (const header of [
      "Strict-Transport-Security",
      "X-Content-Type-Options",
      "X-Frame-Options",
      "Referrer-Policy",
      "Content-Security-Policy",
      "Cross-Origin-Opener-Policy",
    ]) {
      assert.ok(response.headers.get(header), `${header} must ride along on ${response.status} redirects`);
    }
    assert.match(response.headers.get("location"), /^https:\/\/network\.illek\.ie\//);
  }
});

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
