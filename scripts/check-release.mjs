#!/usr/bin/env node

import packageMetadata from "../package.json" with { type: "json" };
import packageLock from "../package-lock.json" with { type: "json" };
import worker from "../worker.js";
import { SCHEMA_ID, SCHEMA_VERSION } from "../public/network-core.js";

const failures = [];
const expectEqual = (label, actual, expected) => {
  if (actual !== expected) failures.push(`${label}: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);
};

expectEqual("lockfile name", packageLock.name, packageMetadata.name);
expectEqual("lockfile version", packageLock.version, packageMetadata.version);
expectEqual("lockfile root name", packageLock.packages?.[""]?.name, packageMetadata.name);
expectEqual("lockfile root version", packageLock.packages?.[""]?.version, packageMetadata.version);

const response = await worker.fetch(new Request("http://127.0.0.1/api/health"), {});
const health = await response.json();
expectEqual("health status", response.status, 200);
expectEqual("health service", health.service, packageMetadata.name);
expectEqual("health version", health.version, packageMetadata.version);
expectEqual("health schema", health.schema, SCHEMA_ID);
expectEqual("health schema version", health.schemaVersion, SCHEMA_VERSION);
expectEqual("health cache policy", response.headers.get("Cache-Control"), "no-store");
expectEqual("health index policy", response.headers.get("X-Robots-Tag"), "noindex, nofollow");

if (failures.length) throw new Error(`Release provenance check failed:\n- ${failures.join("\n- ")}`);
process.stdout.write(`Release provenance matches ${packageMetadata.name} ${packageMetadata.version}, schema ${SCHEMA_VERSION}.\n`);
