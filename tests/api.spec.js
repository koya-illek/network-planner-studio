import { test, expect } from "@playwright/test";

const design = {
  schema: "network-planner-studio/design",
  version: 3,
  projectId: "e2e-api",
  name: "HTTP surface check",
  mode: null,
  topologyMode: "hub-spoke",
  policies: { spokeToSpoke: "via-hub", centralizedInspection: true, secondaryHubId: null },
  flowPolicies: {},
  assumptions: [],
  sites: [
    { id: "hq", name: "Cork HQ", type: "office", cidr: "10.20.0.0/16", devices: 120, wan: "dual", growth: 30, x: 40, y: 40, topologyRole: "hub", hubId: null, internetBreakout: "local", notes: "", vlans: [] },
    { id: "spoke", name: "Dublin", type: "branch", cidr: "10.30.0.0/16", devices: 60, wan: "single", growth: 30, x: 70, y: 20, topologyRole: "spoke", hubId: "hq", internetBreakout: "local", notes: "", vlans: [] }
  ],
  links: [
    { id: "l1", from: "hq", to: "spoke", type: "vpn", resilience: "single", routingType: "bgp", transitAllowed: true, defaultRoute: false, advertisedPrefixes: [], notes: "" }
  ]
};

test("the planning API validates and traces designs over HTTP", async ({ request }) => {
  const health = await request.get("/api/v1");
  expect(health.ok()).toBeTruthy();
  const directory = await health.json();
  expect(directory.endpoints).toHaveLength(7);
  expect(directory.mcp).toBe("/mcp");
  expect(directory.designSchema).toBe("/api/v1/design-schema.json");

  const validated = await request.post("/api/v1/validate", { data: { design } });
  expect((await validated.json()).result.valid).toBe(true);

  const route = await request.post("/api/v1/route", { data: { design, from: "Dublin", to: "Cork HQ" } });
  const traced = await route.json();
  expect(traced.result.reachable).toBe(true);
  expect(traced.result.hops).toEqual(["Dublin", "Cork HQ"]);
});

test("the design schema artifact validates over HTTP", async ({ request }) => {
  const response = await request.get("/api/v1/design-schema.json");
  expect(response.ok()).toBeTruthy();
  expect(response.headers()["content-type"]).toContain("application/schema+json");
  const schema = await response.json();
  expect(schema.$schema).toBe("https://json-schema.org/draft/2020-12/schema");
  expect(schema.properties.sites.items.required).toEqual(["id", "cidr"]);
});

test("the MCP handshake works against the dev worker", async ({ request }) => {
  const init = await request.post("/mcp", {
    headers: { "Content-Type": "application/json" },
    data: { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {} } }
  });
  const handshake = await init.json();
  expect(handshake.result.protocolVersion).toBe("2025-06-18");
  expect(init.headers()["access-control-allow-origin"]).toBe("*");

  const listed = await (await request.post("/mcp", {
    headers: { "Content-Type": "application/json" },
    data: { jsonrpc: "2.0", id: 2, method: "tools/list" }
  })).json();
  expect(listed.result.tools.map(entry => entry.name)).toContain("review_design");
  for (const entry of listed.result.tools) {
    expect(entry.annotations.readOnlyHint).toBe(true);
    expect(entry.annotations.openWorldHint).toBe(false);
  }

  const reviewed = await (await request.post("/mcp", {
    headers: { "Content-Type": "application/json" },
    data: { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "review_design", arguments: { design } } }
  })).json();
  expect(reviewed.result.structuredContent.summary.errors).toBe(0);
});
