import test from "node:test";
import assert from "node:assert/strict";
import packageMetadata from "../package.json" with { type: "json" };
import worker from "../worker.js";

const fetchMcp = (body, init = {}) => worker.fetch(new Request("http://127.0.0.1/mcp", {
  method: "POST",
  headers: { "Content-Type": "application/json", ...init.headers },
  body: typeof body === "string" ? body : JSON.stringify(body)
}), {});

const rpc = async (payload, init) => {
  const response = await fetchMcp(payload, init);
  return { response, body: response.status === 202 ? null : await response.json() };
};

const validDesign = () => ({
  schema: "network-planner-studio/design",
  version: 3,
  projectId: "mcp-test",
  name: "MCP test design",
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
      notes: "", vlans: []
    }
  ],
  links: [{
    id: "l1", from: "hq", to: "branch", type: "vpn", resilience: "single", routingType: "bgp",
    transitAllowed: true, defaultRoute: false, advertisedPrefixes: [], notes: ""
  }]
});

test("initialize negotiates a supported protocol version and declares tools", async () => {
  const { response, body } = await rpc({
    jsonrpc: "2.0", id: 1, method: "initialize",
    params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test" } }
  });
  assert.equal(response.status, 200);
  assert.equal(body.result.protocolVersion, "2025-06-18");
  assert.ok(body.result.capabilities.tools, "tool capability must be declared");
  assert.equal(body.result.serverInfo.name, packageMetadata.name);
  assert.equal(body.result.serverInfo.version, packageMetadata.version);
  assert.match(response.headers.get("Access-Control-Allow-Origin"), /\*/);
});

test("initialize with an unsupported version falls back to the latest supported one", async () => {
  const { body } = await rpc({
    jsonrpc: "2.0", id: 1, method: "initialize",
    params: { protocolVersion: "1999-01-01", capabilities: {} }
  });
  assert.equal(body.result.protocolVersion, "2025-06-18");
});

test("notifications are acknowledged with an empty 202", async () => {
  const response = await fetchMcp({ jsonrpc: "2.0", method: "notifications/initialized" });
  assert.equal(response.status, 202);
  assert.equal(await response.text(), "");
});

test("tools/list describes the planning tools with input and output schemas", async () => {
  const { body } = await rpc({ jsonrpc: "2.0", id: 2, method: "tools/list" });
  const names = body.result.tools.map(entry => entry.name);
  assert.deepEqual(names, ["validate_design", "review_design", "find_route", "plan_site", "plan_vlan", "next_subnet", "suggest_site_range"]);
  for (const entry of body.result.tools) {
    assert.equal(entry.inputSchema.type, "object");
    assert.equal(entry.outputSchema?.type, "object", `${entry.name} must declare its structured result shape`);
    assert.ok(Array.isArray(entry.outputSchema.required), `${entry.name} must name its required result fields`);
    assert.ok(entry.description.length > 20, `${entry.name} needs a real description`);
    assert.ok(entry.title);
  }
});

test("structured tool results conform to their declared output schemas", async () => {
  const { body: list } = await rpc({ jsonrpc: "2.0", id: 20, method: "tools/list" });
  const requiredFields = new Map(list.result.tools.map(entry => [entry.name, entry.outputSchema.required]));
  const call = async payload => {
    const { body } = await rpc(payload);
    assert.notEqual(body.result.isError, true);
    return body.result.structuredContent;
  };
  const design = validDesign();
  let result = await call({ jsonrpc: "2.0", id: 21, method: "tools/call", params: { name: "validate_design", arguments: { design } } });
  for (const field of requiredFields.get("validate_design")) assert.ok(field in result);
  assert.equal(typeof result.valid, "boolean");

  result = await call({ jsonrpc: "2.0", id: 22, method: "tools/call", params: { name: "review_design", arguments: { design } } });
  for (const field of requiredFields.get("review_design")) assert.ok(field in result);
  assert.ok(result.summary.errors >= 0 && Array.isArray(result.issues));

  result = await call({
    jsonrpc: "2.0", id: 23, method: "tools/call",
    params: { name: "find_route", arguments: { design, from: "hq", to: "branch" } }
  });
  for (const field of requiredFields.get("find_route")) assert.ok(field in result);
  assert.equal(result.reachable, true);

  result = await call({
    jsonrpc: "2.0", id: 24, method: "tools/call",
    params: { name: "next_subnet", arguments: { parent: "10.20.0.0/16", prefix: 24, occupied: ["10.20.0.0/24"] } }
  });
  assert.deepEqual(Object.keys(result), ["cidr"]);

  result = await call({ jsonrpc: "2.0", id: 25, method: "tools/call", params: { name: "suggest_site_range", arguments: {} } });
  assert.deepEqual(Object.keys(result), ["cidr"]);
});

test("tools/call returns structured content for a valid design", async () => {
  let { body } = await rpc({
    jsonrpc: "2.0", id: 3, method: "tools/call",
    params: { name: "validate_design", arguments: { design: validDesign() } }
  });
  assert.notEqual(body.result.isError, true);
  // A linked single-WAN site draws review warnings, but it is canonically valid.
  assert.equal(body.result.structuredContent.valid, true);
  assert.deepEqual(body.result.structuredContent.errors, []);
  assert.ok(Array.isArray(body.result.content) && body.result.content[0].type === "text");

  ({ body } = await rpc({
    jsonrpc: "2.0", id: 4, method: "tools/call",
    params: { name: "review_design", arguments: { design: validDesign() } }
  }));
  assert.equal(typeof body.result.structuredContent.score, "number");
  assert.ok(body.result.structuredContent.summary.warnings >= 1);
});

test("tools/call maps engine rejections to tool errors, not protocol errors", async () => {
  const { body } = await rpc({
    jsonrpc: "2.0", id: 5, method: "tools/call",
    params: { name: "next_subnet", arguments: { parent: "10.0.0.0/24", prefix: 24, occupied: ["10.0.0.0/24"] } }
  });
  assert.equal(body.result.isError, true);
  assert.match(body.result.content[0].text, /unallocatable/);
  assert.equal(body.error, undefined);
});

test("unknown tools and methods produce precise JSON-RPC errors", async () => {
  let { body } = await rpc({ jsonrpc: "2.0", id: 6, method: "tools/call", params: { name: "deploy_router" } });
  assert.equal(body.error.code, -32602);
  ({ body } = await rpc({ jsonrpc: "2.0", id: 7, method: "designs/create" }));
  assert.equal(body.error.code, -32601);
});

test("ping responds with an empty result", async () => {
  const { body } = await rpc({ jsonrpc: "2.0", id: 8, method: "ping" });
  assert.deepEqual(body.result, {});
});

test("protocol violations are rejected with JSON-RPC error envelopes", async () => {
  let { body } = await rpc([{ jsonrpc: "2.0", id: 1, method: "ping" }, { jsonrpc: "2.0", id: 2, method: "ping" }]);
  assert.equal(body.error.code, -32600, "batching was removed in protocol 2025-06-18");

  ({ body } = await rpc({ jsonrpc: "1.0", id: 3 }));
  assert.equal(body.error.code, -32600);

  ({ body } = await rpc("{not json"));
  assert.equal(body.error.code, -32700);
  assert.equal(body.id, null);

  const plain = await worker.fetch(new Request("http://127.0.0.1/mcp", {
    method: "POST", headers: { "Content-Type": "text/plain" }, body: "{}"
  }), {});
  assert.equal(plain.status, 415);
});

test("the endpoint only accepts POST and answers preflight like the REST API", async () => {
  const get = await worker.fetch(new Request("http://127.0.0.1/mcp"), {});
  assert.equal(get.status, 405);
  assert.equal(get.headers.get("Allow"), "POST, OPTIONS");
  const preflight = await worker.fetch(new Request("http://127.0.0.1/mcp", { method: "OPTIONS" }), {});
  assert.equal(preflight.status, 204);
  assert.match(preflight.headers.get("Access-Control-Allow-Methods"), /POST/);
  const huge = await fetchMcp(JSON.stringify({ jsonrpc: "2.0", id: 9, method: "ping" }) + " ".repeat(1024 * 1024 + 10));
  assert.equal(huge.status, 413);
});

test("machine responses carry the shared hardening set", async () => {
  const response = (await rpc({ jsonrpc: "2.0", id: 10, method: "ping" })).response;
  for (const header of ["Strict-Transport-Security", "X-Content-Type-Options", "X-Robots-Tag"]) {
    assert.ok(response.headers.get(header));
  }
  assert.equal(response.headers.get("Cache-Control"), "no-store");
});

test("every tool declares read-only, idempotent, closed-world annotations", async () => {
  const { body } = await rpc({ jsonrpc: "2.0", id: 1, method: "tools/list" });
  assert.ok(body.result.tools.length >= 5);
  for (const entry of body.result.tools) {
    assert.equal(entry.annotations.readOnlyHint, true, `${entry.name} computes without side effects`);
    assert.equal(entry.annotations.idempotentHint, true, `${entry.name} is deterministic per arguments`);
    assert.equal(entry.annotations.openWorldHint, false, `${entry.name} never touches an external system`);
  }
});

test("initialize declares a stable tool list", async () => {
  const { body } = await rpc({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } });
  assert.equal(body.result.capabilities.tools.listChanged, false);
});

test("a pinned unsupported protocol version is refused with 400", async () => {
  const { response, body } = await rpc({ jsonrpc: "2.0", id: 1, method: "ping" }, { headers: { "MCP-Protocol-Version": "2024-11-05" } });
  assert.equal(response.status, 400);
  assert.equal(body.error.code, -32600);
  assert.match(body.error.message, /2024-11-05/);
  assert.match(body.error.message, /2025-06-18/);
});

test("a supported pinned protocol version passes through untouched", async () => {
  const { response } = await rpc({ jsonrpc: "2.0", id: 1, method: "tools/list" }, { headers: { "MCP-Protocol-Version": "2025-03-26" } });
  assert.equal(response.status, 200);
});

/* Planning tools: one call produces a compatible identity-free plan. */

test("tools/list advertises the planning tools with output schemas", async () => {
  const { body } = await rpc({ jsonrpc: "2.0", id: 1, method: "tools/list" });
  const names = body.result.tools.map(entry => entry.name);
  assert.ok(names.includes("plan_site"));
  assert.ok(names.includes("plan_vlan"));
  const planSite = body.result.tools.find(entry => entry.name === "plan_site");
  assert.equal(planSite.outputSchema.required[0], "plan");
  assert.equal(planSite.inputSchema.properties.type.enum[0], "office");
});

test("plan_site computes a mergeable plan through tools/call", async () => {
  const { body } = await rpc({
    jsonrpc: "2.0", id: 2, method: "tools/call",
    params: { name: "plan_site", arguments: { type: "office", devices: 50, name: "Limerick office" } }
  });
  assert.equal(body.result.isError, undefined);
  const plan = body.result.structuredContent.plan;
  assert.deepEqual(plan.vlans.map(v => v.role), ["users", "voice", "guest", "management"]);
  for (const vlan of plan.vlans) assert.equal(vlan.id, undefined);
});

test("plan_vlan resolves the owning site and reports failures as tool results", async () => {
  const design = validDesign();
  const call = args => rpc({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "plan_vlan", arguments: args } });
  const good = await call({ sites: design.sites, siteId: "branch", role: "guest", devices: 25 });
  assert.equal(good.body.result.structuredContent.plan.role, "guest");
  const bad = await call({ sites: design.sites, siteId: "ghost-town", role: "guest" });
  assert.equal(bad.body.result.isError, true);
  assert.match(bad.body.result.content[0].text, /unknown_site/);
});
