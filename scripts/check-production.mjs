#!/usr/bin/env node

import packageMetadata from "../package.json" with { type: "json" };
import { SCHEMA_ID, SCHEMA_VERSION } from "../public/network-core.js";

const canonicalOrigin = "https://network.illek.ie";
const failures = [];
const expectEqual = (label, actual, expected) => {
  if (actual !== expected) failures.push(`${label}: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);
};
const expect = (label, condition) => {
  if (!condition) failures.push(label);
};

const healthResponse = await fetch(`${canonicalOrigin}/api/health`, { redirect: "manual", cache: "no-store" });
const health = await healthResponse.json();
expectEqual("health status", healthResponse.status, 200);
expectEqual("health service", health.service, packageMetadata.name);
expectEqual("health version", health.version, packageMetadata.version);
expectEqual("health schema", health.schema, SCHEMA_ID);
expectEqual("health schema version", health.schemaVersion, SCHEMA_VERSION);
expectEqual("health cache policy", healthResponse.headers.get("Cache-Control"), "no-store");
expectEqual("health index policy", healthResponse.headers.get("X-Robots-Tag"), "noindex, nofollow");

const homeResponse = await fetch(`${canonicalOrigin}/`, { redirect: "manual", cache: "no-store" });
const contentSecurityPolicy = homeResponse.headers.get("Content-Security-Policy") ?? "";
expectEqual("canonical homepage status", homeResponse.status, 200);
expect("canonical homepage content type is HTML", (homeResponse.headers.get("Content-Type") ?? "").includes("text/html"));
expect("production CSP uses self-only scripts", contentSecurityPolicy.includes("script-src 'self'") && !contentSecurityPolicy.includes("static.cloudflareinsights.com"));
expect("production CSP uses self-only connections", contentSecurityPolicy.includes("connect-src 'self'") && !contentSecurityPolicy.includes("cloudflareinsights.com"));

const aliasPath = "/example?release-check=1";
const aliasResponse = await fetch(`https://netplanner.illek.ie${aliasPath}`, { redirect: "manual", cache: "no-store" });
expectEqual("legacy alias status", aliasResponse.status, 301);
expectEqual("legacy alias destination", aliasResponse.headers.get("Location"), `${canonicalOrigin}${aliasPath}`);

const missingResponse = await fetch(`${canonicalOrigin}/.well-known/network-planner-release-check-missing`, { redirect: "manual", cache: "no-store" });
const missingBody = await missingResponse.text();
expectEqual("unknown route status", missingResponse.status, 404);
expect("unknown route uses the branded page", missingBody.includes("That page is not on the map"));

const exampleResponse = await fetch(`${canonicalOrigin}/api/v1/example-design`, { cache: "no-store" });
expectEqual("example design status", exampleResponse.status, 200);
const example = await exampleResponse.json().catch(() => null);
if (example) {
  expectEqual("example design name", example.name, "Illek example network");
  expectEqual("example design sites", Array.isArray(example.sites) && example.sites.length >= 2, true);
} else {
  failures.push("example design: response body was not JSON");
}

if (failures.length) throw new Error(`Production smoke check failed:\n- ${failures.join("\n- ")}`);
process.stdout.write(`Production serves ${packageMetadata.name} ${packageMetadata.version}, schema ${SCHEMA_VERSION}, on canonical and legacy routes.\n`);
