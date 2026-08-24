import test from "node:test";
import assert from "node:assert/strict";
import packageMetadata from "../package.json" with { type: "json" };
import worker from "../worker.js";
import { SCHEMA_ID, SCHEMA_VERSION } from "../public/network-core.js";

const fetchApi = (path, init) => worker.fetch(new Request(`http://127.0.0.1${path}`, init), {});

const validDesign = () => ({
  schema: SCHEMA_ID,
  version: SCHEMA_VERSION,
  projectId: "api-test",
  name: "API test design",
  mode: null,
  topologyMode: "custom",
  policies: { spokeToSpoke: "via-hub", centralizedInspection: false, secondaryHubId: null },
  flowPolicies: {},
  assumptions: [],
  sites: [
    {
      id: "hq", name: "HQ", type: "office", cidr: "10.20.0.0/16", devices: 120, wan: "dual",
      growth: 30, x: 30, y: 30, topologyRole: "standalone", hubId: null, internetBreakout: "local",
      notes: "", vlans: [{
        id: "hq-staff", name: "Staff", vid: 10, role: "users", devices: 40, cidr: "10.20.10.0/24",
        gateway: "10.20.10.1", dhcpEnabled: true, reserved: 1, dhcpStart: "10.20.10.2", dhcpEnd: "10.20.10.254", notes: ""
      }]
    },
    {
      id: "branch", name: "Branch", type: "branch", cidr: "10.30.0.0/16", devices: 60, wan: "single",
      growth: 30, x: 70, y: 30, topologyRole: "standalone", hubId: null, internetBreakout: "local",
      notes: "", vlans: [{
        id: "branch-staff", name: "Staff", vid: 10, role: "users", devices: 20, cidr: "10.30.10.0/26",
        gateway: "10.30.10.1", dhcpEnabled: true, reserved: 1, dhcpStart: "10.30.10.2", dhcpEnd: "10.30.10.62", notes: ""
      }]
    }
  ],
  links: [{
    id: "l1", from: "hq", to: "branch", type: "vpn", resilience: "single", routingType: "bgp",
    transitAllowed: true, defaultRoute: false, advertisedPrefixes: [], notes: ""
  }]
});

const postJson = async (path, payload) => fetchApi(path, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: typeof payload === "string" ? payload : JSON.stringify(payload)
});

test("the service directory describes every endpoint with release provenance", async () => {
  const response = await fetchApi("/api/v1");
  assert.equal(response.status, 200);
  assert.match(response.headers.get("Content-Type"), /application\/json/);
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.equal(body.service, packageMetadata.name);
  assert.equal(body.version, packageMetadata.version);
  assert.equal(body.schema, SCHEMA_ID);
  assert.equal(body.schemaVersion, SCHEMA_VERSION);
  assert.equal(body.endpoints.length, 9);
});

test("machine responses carry the hardening set, no-store caching and noindex", async () => {
  const response = await fetchApi("/api/v1");
  for (const header of ["Content-Security-Policy", "Strict-Transport-Security", "X-Content-Type-Options"]) {
    assert.ok(response.headers.get(header), `${header} must ride along on API responses`);
  }
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.equal(response.headers.get("X-Robots-Tag"), "noindex, nofollow");
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), "*");
});

test("the OpenAPI description covers all operations at the released version", async () => {
  const response = await fetchApi("/api/v1/openapi.json");
  assert.equal(response.status, 200);
  const doc = await response.json();
  assert.equal(doc.openapi, "3.1.0");
  assert.equal(doc.info.version, packageMetadata.version);
  for (const path of ["/api/v1/validate", "/api/v1/review", "/api/v1/route", "/api/v1/subnets/next", "/api/v1/site-range/suggest"]) {
    assert.ok(doc.paths[path]?.post, `${path} must be described`);
  }
  assert.ok(doc.components.schemas.DesignDocument, "the canonical design schema must be described");
});

test("validate accepts a canonical design and reports it as valid", async () => {
  const response = await postJson("/api/v1/validate", { design: validDesign() });
  assert.equal(response.status, 200);
  const { result } = await response.json();
  assert.equal(result.valid, true);
  assert.deepEqual(result.corrections, []);
  assert.deepEqual(result.errors, []);
  assert.equal(result.design.schema, SCHEMA_ID);
  assert.ok(!("importWarnings" in result.design), "internal migration notes must not leak into the echoed design");
});

test("validate surfaces normalization corrections and hard errors distinctly", async () => {
  const loose = structuredClone(validDesign());
  loose.sites[0].vlans[0].devices = "40";
  let response = await postJson("/api/v1/validate", { design: loose });
  const { result } = await response.json();
  assert.equal(result.valid, false);
  assert.ok(result.corrections.some(message => message.includes("devices")), "type drift must be reported as a correction");

  const overlapping = validDesign();
  overlapping.sites[0].vlans.push({
    id: "clash", name: "Clash", vid: 40, role: "servers", devices: 5, cidr: "10.20.10.128/26",
    gateway: "10.20.10.129", dhcpEnabled: false, reserved: 1, dhcpStart: "", dhcpEnd: "", notes: ""
  });
  response = await postJson("/api/v1/validate", { design: overlapping });
  const broken = await response.json();
  assert.equal(broken.result.valid, false);
  assert.ok(broken.result.errors.some(error => error.code === "overlap"));
});

test("malformed submissions map to precise status codes", async () => {
  const cases = [
    [postJson("/api/v1/validate", "{not json"), 400, "invalid_json"],
    [postJson("/api/v1/validate", ""), 400, "empty_body"],
    [postJson("/api/v1/validate", { design: 42 }), 400, "invalid_design"],
    [postJson("/api/v1/validate", { design: { schema: SCHEMA_ID, sites: [] } }), 400, "invalid_design"],
    [postJson("/api/v1/route", { design: validDesign(), from: "hq" }), 400, "missing_field"]
  ];
  for (const [promise, status, code] of cases) {
    const response = await promise;
    assert.equal(response.status, status);
    const body = await response.json();
    assert.equal(body.error.code, code);
    assert.equal(body.ok, false);
  }
});

test("non-JSON and oversized bodies are rejected before compute", async () => {
  const plain = await fetchApi("/api/v1/validate", { method: "POST", headers: { "Content-Type": "text/plain" }, body: "{}" });
  assert.equal(plain.status, 415);
  assert.equal((await plain.json()).error.code, "unsupported_media_type");
  const huge = await postJson("/api/v1/validate", JSON.stringify({ design: validDesign() }) + " ".repeat(1024 * 1024 + 10));
  assert.equal(huge.status, 413);
});

test("methods are guarded per route and preflight is answered", async () => {
  const wrongMethod = await fetchApi("/api/v1/validate");
  assert.equal(wrongMethod.status, 405);
  assert.equal(wrongMethod.headers.get("Allow"), "POST, OPTIONS");
  const headOk = await fetchApi("/api/v1", { method: "HEAD" });
  assert.equal(headOk.status, 200);
  const preflight = await fetchApi("/api/v1/review", { method: "OPTIONS" });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get("Access-Control-Allow-Origin"), "*");
  assert.match(preflight.headers.get("Access-Control-Allow-Methods"), /POST/);
  const missing = await fetchApi("/api/v1/nope");
  assert.equal(missing.status, 404);
  assert.equal((await missing.json()).error.code, "not_found");
});

test("review reproduces the workspace score and findings over HTTP", async () => {
  const response = await postJson("/api/v1/review", { design: validDesign() });
  assert.equal(response.status, 200);
  const { result } = await response.json();
  // Branch has inter-site connectivity over a single WAN: exactly one warning.
  assert.deepEqual(result.summary, { errors: 0, warnings: 1, advice: 0 });
  assert.equal(result.score, 93);
  const warning = result.issues.find(issue => issue.severity === "warning");
  assert.equal(warning.title, "Single WAN dependency");
  assert.equal(warning.siteId, "branch");
});

test("route tracing honours topology policy and resolves names or ids", async () => {
  const hubSpoke = validDesign();
  hubSpoke.topologyMode = "hub-spoke";
  hubSpoke.policies.centralizedInspection = true;
  Object.assign(hubSpoke.sites[0], { topologyRole: "hub" });
  Object.assign(hubSpoke.sites[1], { topologyRole: "spoke", hubId: "hq" });

  let response = await postJson("/api/v1/route", { design: hubSpoke, from: "Branch", to: "hq" });
  let { result } = await response.json();
  assert.equal(result.reachable, true);
  assert.deepEqual(result.hops, ["Branch", "HQ"]);
  assert.deepEqual(result.hopIds, ["branch", "hq"]);
  assert.equal(result.policyApplied.topologyMode, "hub-spoke");

  const isolatedSpokes = structuredClone(hubSpoke);
  isolatedSpokes.policies.spokeToSpoke = "denied";
  isolatedSpokes.sites.push({
    id: "s2", name: "Second spoke", type: "office", cidr: "10.40.0.0/16", devices: 20, wan: "single",
    growth: 30, x: 50, y: 70, topologyRole: "spoke", hubId: "hq", internetBreakout: "local", notes: "",
    vlans: []
  });
  isolatedSpokes.links.push({
    id: "l2", from: "hq", to: "s2", type: "vpn", resilience: "single", routingType: "bgp",
    transitAllowed: true, defaultRoute: false, advertisedPrefixes: [], notes: ""
  });
  isolatedSpokes.links.push({
    id: "l3", from: "s2", to: "branch", type: "vpn", resilience: "single", routingType: "bgp",
    transitAllowed: true, defaultRoute: false, advertisedPrefixes: [], notes: ""
  });
  response = await postJson("/api/v1/route", { design: isolatedSpokes, from: "s2", to: "branch" });
  result = (await response.json()).result;
  assert.equal(result.reachable, false);

  response = await postJson("/api/v1/route", { design: hubSpoke, from: "Nope", to: "hq" });
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error.code, "unknown_site");
});

test("subnet allocation endpoints expose the engine math with honest failures", async () => {
  let response = await postJson("/api/v1/subnets/next", { parent: "10.0.0.0/16", prefix: 24, occupied: ["10.0.0.0/24", "10.0.1.0/24"] });
  let { result } = await response.json();
  assert.equal(result.cidr, "10.0.2.0/24");

  response = await postJson("/api/v1/subnets/next", { parent: "10.0.0.0/24", prefix: 24, occupied: ["10.0.0.0/26", "10.0.0.128/25"] });
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error.code, "unallocatable");

  response = await postJson("/api/v1/subnets/next", { parent: "10.0.0.0/16", prefix: 7 });
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error.code, "invalid_input");

  response = await postJson("/api/v1/site-range/suggest", { occupied: ["10.20.0.0/16"], devices: 50 });
  result = (await response.json()).result;
  assert.match(result.cidr, /^10\.\d+\.0\.0\/20$/);
  assert.notEqual(result.cidr, "10.20.0.0/16");

  response = await postJson("/api/v1/site-range/suggest", { occupied: ["10.20.0.0/16"], devices: "many" });
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error.code, "invalid_input");
});

test("the standalone design schema is a draft 2020-12 artifact mirroring the OpenAPI component", async () => {
  const response = await fetchApi("/api/v1/design-schema.json");
  assert.equal(response.status, 200);
  assert.ok(response.headers.get("Content-Type").startsWith("application/schema+json"), "schema artifacts use the schema+json media type");
  const schema = await response.json();
  assert.equal(schema.$schema, "https://json-schema.org/draft/2020-12/schema");
  assert.equal(schema.$id, "https://network.illek.ie/api/v1/design-schema.json");
  assert.equal(schema.type, "object");
  for (const key of ["schema", "version", "sites", "links"]) assert.ok(schema.required.includes(key));
  assert.equal(schema.properties.schema.const, SCHEMA_ID);
  assert.ok(Array.isArray(schema.properties.sites.items.properties.vlans.items.properties.role.enum));
  // One source of truth: the OpenAPI component must be the same object.
  const openapi = await (await fetchApi("/api/v1/openapi.json")).json();
  const { $schema: _s, $id: _i, title: _t, ...component } = schema;
  assert.deepEqual(openapi.components.schemas.DesignDocument, component);
  assert.ok(openapi.paths["/api/v1/design-schema.json"], "OpenAPI must describe the schema endpoint");
});

test("the design schema endpoint answers HEAD and refuses writes", async () => {
  const head = await fetchApi("/api/v1/design-schema.json", { method: "HEAD" });
  assert.equal(head.status, 200);
  assert.equal(await head.text(), "");
  const post = await fetchApi("/api/v1/design-schema.json", { method: "POST" });
  assert.equal(post.status, 405);
  assert.equal(post.headers.get("Allow"), "GET, HEAD, OPTIONS");
});

test("the directory points at the MCP surface and the schema artifact", async () => {
  const directory = await (await fetchApi("/api/v1")).json();
  assert.equal(directory.mcp, "/mcp");
  assert.equal(directory.designSchema, "/api/v1/design-schema.json");
  assert.ok(directory.endpoints.some(entry => entry.path === "/api/v1/design-schema.json"));
});

/* Site and VLAN planning over HTTP. */

test("planning a site returns a complete identity-free plan", async () => {
  const response = await postJson("/api/v1/sites/plan", { type: "office", devices: 50, growth: 30, name: "Limerick office" });
  assert.equal(response.status, 200);
  const { ok, result } = await response.json();
  assert.equal(ok, true);
  const { plan } = result;
  assert.equal(plan.name, "Limerick office");
  assert.deepEqual(plan.vlans.map(v => v.role), ["users", "voice", "guest", "management"]);
  for (const vlan of plan.vlans) {
    assert.ok(vlan.vid >= 1 && vlan.vid <= 4094);
    assert.ok(vlan.cidr && vlan.gateway, "each planned VLAN needs addressing");
    assert.equal(vlan.id, undefined, "plans are identity-free");
  }
  // The plan must survive canonical validation when merged into a design.
  const merged = await postJson("/api/v1/validate", { design: { schema: SCHEMA_ID, version: SCHEMA_VERSION, topologyMode: "custom", policies: { spokeToSpoke: "via-hub" }, flowPolicies: {}, links: [], sites: [{ id: "s1", name: plan.name, type: plan.type, cidr: plan.cidr, devices: plan.devices, wan: "single", growth: plan.growth, x: 20, y: 20, topologyRole: "standalone", hubId: null, internetBreakout: "local", vlans: plan.vlans.map((v, i) => ({ ...v, id: `m-${i}` })) }] } });
  assert.equal((await merged.json()).result.valid, true);
});

test("site planning follows the conventions of the supplied sites", async () => {
  const sites = [{ id: "hq", cidr: "10.20.0.0/16", vlans: [{ vid: 10, role: "users" }, { vid: 97, role: "management" }, { vid: 10, role: "users" }] }];
  const response = await postJson("/api/v1/sites/plan", { type: "office", devices: 40, sites });
  const { result } = await response.json();
  assert.deepEqual(result.plan.vlans.map(v => v.vid), [10, 20, 30, 97]);
});

test("site planning rejects bad input with honest problem codes", async () => {
  const badType = await postJson("/api/v1/sites/plan", { type: "spaceship" });
  assert.equal(badType.status, 400);
  assert.equal((await badType.json()).error.code, "invalid_input");
  const noRoom = await postJson("/api/v1/sites/plan", { sites: [{ id: "x", cidr: "10.0.0.0/8" }, { id: "y", cidr: "172.16.0.0/12" }, { id: "z", cidr: "192.168.0.0/16" }] });
  assert.equal(noRoom.status, 400);
  assert.equal((await noRoom.json()).error.code, "unallocatable");
  const wrongSites = await postJson("/api/v1/sites/plan", { sites: "hq" });
  assert.equal(wrongSites.status, 400);
  assert.equal((await wrongSites.json()).error.code, "invalid_input");
  const get = await fetchApi("/api/v1/sites/plan");
  assert.equal(get.status, 405);
  assert.equal(get.headers.get("Allow"), "POST, OPTIONS");
});

test("planning a VLAN reuses the environment convention inside the chosen site", async () => {
  const sites = [
    { id: "hq", name: "HQ", cidr: "10.20.0.0/16", growth: 30, vlans: [{ id: "v1", vid: 10, role: "users", devices: 40, cidr: "10.20.10.0/24", gateway: "10.20.10.1", dhcpEnabled: true, reserved: 1, dhcpStart: "10.20.10.2", dhcpEnd: "10.20.10.254" }] },
    { id: "b1", name: "Dublin", cidr: "10.30.0.0/16", growth: 30, vlans: [] }
  ];
  const response = await postJson("/api/v1/vlans/plan", { sites, siteId: "hq", role: "guest", devices: 30 });
  assert.equal(response.status, 200);
  const { result } = await response.json();
  assert.equal(result.plan.vid, 30);
  assert.match(result.plan.cidr, /^10\.20\./);
  const unknown = await postJson("/api/v1/vlans/plan", { sites, siteId: "nope" });
  assert.equal(unknown.status, 400);
  assert.equal((await unknown.json()).error.code, "unknown_site");
  const missing = await postJson("/api/v1/vlans/plan", { sites });
  assert.equal(missing.status, 400);
  assert.equal((await missing.json()).error.code, "missing_field");
});
