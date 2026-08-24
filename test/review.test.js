import test from "node:test";
import assert from "node:assert/strict";
import { reviewDesignIssues, designScore, defaultFlowPolicy, migrateDesign } from "../public/network-core.js";

const base = (overrides = {}) => ({
  schema: "network-planner-studio/design",
  version: 3,
  projectId: "review-test",
  name: "Review test",
  mode: null,
  topologyMode: "custom",
  policies: { spokeToSpoke: "via-hub", centralizedInspection: false, secondaryHubId: null },
  flowPolicies: {},
  assumptions: [],
  sites: [],
  links: [],
  ...overrides
});

const site = (overrides = {}) => ({
  id: "hq", name: "HQ", type: "office", cidr: "10.20.0.0/16", devices: 10, wan: "single",
  growth: 30, x: 20, y: 20, topologyRole: "standalone", hubId: null, internetBreakout: "local",
  vlans: [], ...overrides
});

const vlan = (overrides = {}) => ({
  id: "v1", name: "Staff", vid: 10, role: "users", devices: 40, cidr: "10.20.10.0/24",
  gateway: "10.20.10.1", dhcpEnabled: true, reserved: 1, dhcpStart: "10.20.10.2", dhcpEnd: "10.20.10.254",
  notes: "", ...overrides
});

const link = (overrides = {}) => ({
  id: "l1", from: "hq", to: "branch", type: "vpn", resilience: "single", routingType: "bgp",
  transitAllowed: true, defaultRoute: false, advertisedPrefixes: [], notes: "", ...overrides
});

const titles = issues => issues.filter(i => i.title !== "Core checks passed").map(i => i.title);

test("an empty design asks for its first site and reports nothing else", () => {
  const issues = reviewDesignIssues(base());
  assert.deepEqual(titles(issues), ["Start the address hierarchy"]);
  assert.equal(designScore(issues), 100);
});

test("recovered import warnings surface before every other finding", () => {
  const design = migrateDesign(base({ sites: [site({ vlans: [] })], links: [] }), { strict: false });
  design.importWarnings = ["VLAN count was corrected"];
  const issues = reviewDesignIssues(design);
  assert.equal(issues[0].title, "Recovered design data");
  assert.equal(issues[0].message, "VLAN count was corrected");
});

test("overlapping site ranges are a blocking error naming both sites", () => {
  const issues = reviewDesignIssues(base({ sites: [site(), site({ id: "b", name: "Branch", cidr: "10.20.64.0/18" })] }));
  assert.ok(titles(issues).includes("Overlapping site ranges"));
  const overlap = issues.find(i => i.title === "Overlapping site ranges");
  assert.equal(overlap.severity, "error");
  assert.match(overlap.message, /HQ and Branch/);
});

test("public site space, missing VLANs and single-WAN dependencies warn", () => {
  const issues = reviewDesignIssues(base({
    sites: [
      site({ cidr: "192.0.2.0/24" }),
      site({ id: "b", name: "B", wan: "single" })
    ],
    links: [link()]
  }));
  const titlesFound = titles(issues);
  for (const expected of ["Public site address space", "No VLANs defined", "Single WAN dependency"]) {
    assert.ok(titlesFound.includes(expected), `${expected} should be reported`);
  }
});

test("duplicate VLAN IDs, containment and overlap errors fire per site", () => {
  const issues = reviewDesignIssues(base({
    sites: [site({ vlans: [
      vlan(),
      vlan({ id: "v2", vid: 10, name: "Second", cidr: "10.20.10.128/25", gateway: "10.20.10.129", dhcpStart: "10.20.10.130", dhcpEnd: "10.20.10.254" }),
      vlan({ id: "v3", vid: 30, name: "Outside", cidr: "10.30.1.0/24", gateway: "10.30.1.1", dhcpStart: "10.30.1.2", dhcpEnd: "10.30.1.254" })
    ] })]
  }));
  const titlesFound = titles(issues);
  for (const expected of ["Duplicate VLAN ID", "VLAN outside site range", "Overlapping VLAN subnets"]) {
    assert.ok(titlesFound.includes(expected));
  }
});

test("capacity and headroom thresholds match the workspace", () => {
  const over = reviewDesignIssues(base({ sites: [site({ vlans: [vlan({ devices: 300 })] })] }));
  assert.equal(over.find(i => i.title === "Subnet over capacity").severity, "error");
  const tight = reviewDesignIssues(base({ sites: [site({ vlans: [vlan({ devices: 220 })] })] }));
  assert.equal(tight.find(i => i.title === "Low address headroom").severity, "warning");
});

test("/31 is reserved for transit networks", () => {
  const issues = reviewDesignIssues(base({ sites: [site({ vlans: [vlan({
    role: "transit", cidr: "10.20.90.0/31", gateway: "10.20.90.0", dhcpEnabled: false, devices: 2
  })] })] }));
  assert.ok(!titles(issues).includes("Invalid /31 use"));
  const misuse = reviewDesignIssues(base({ sites: [site({ vlans: [vlan({
    role: "users", cidr: "10.20.90.0/31", gateway: "10.20.90.0", dhcpEnabled: false
  })] })] }));
  assert.ok(titles(misuse).includes("Invalid /31 use"));
});

test("gateways and DHCP pools are validated against the subnet", () => {
  const badGateway = reviewDesignIssues(base({ sites: [site({ vlans: [vlan({ gateway: "192.0.2.9" })] })] }));
  assert.ok(titles(badGateway).includes("Invalid gateway"));
  const poolOverlap = reviewDesignIssues(base({ sites: [site({ vlans: [vlan()] })] }).sites && base({
    sites: [site({ vlans: [vlan({ reserved: 5, dhcpStart: "10.20.10.2", dhcpEnd: "10.20.10.250" })] })]
  }));
  assert.ok(titles(poolOverlap).some(title => title.includes("DHCP pool")));
});

test("segment hygiene advice fires only when it applies", () => {
  const noManagement = reviewDesignIssues(base({ sites: [site({ vlans: [
    vlan(), vlan({ id: "v2", vid: 20, role: "voice", name: "Voice", cidr: "10.20.20.0/24", gateway: "10.20.20.1", dhcpEnd: "10.20.20.254" }),
    vlan({ id: "v3", vid: 30, role: "guest", name: "Guest", cidr: "10.20.30.0/24", gateway: "10.20.30.1", dhcpEnd: "10.20.30.254" })
  ] })] }));
  const found = titles(noManagement);
  assert.ok(found.includes("No management segment"));
  assert.ok(found.includes("Trust boundary required"));
});

test("isolated spokes of a multi-site topology are named", () => {
  const issues = reviewDesignIssues(base({ sites: [site(), site({ id: "lonely", name: "Lonely" })] }));
  const isolated = issues.find(i => i.title === "Isolated site");
  assert.equal(isolated.severity, "warning");
  assert.match(isolated.message, /Lonely/);
});

test("static routing without prefixes warns; advertised prefixes are checked", () => {
  const staticLink = reviewDesignIssues(base({ sites: [site(), site({ id: "branch", name: "B" })], links: [link({ routingType: "static" })] }));
  assert.ok(titles(staticLink).includes("Static route intent is missing"));
  const badPrefix = reviewDesignIssues(base({
    sites: [site(), site({ id: "branch", name: "B" })],
    links: [link({ advertisedPrefixes: ["10.20.0.0/bad"] })]
  }));
  assert.ok(titles(badPrefix).includes("Invalid advertised prefix"));
  const public_ = reviewDesignIssues(base({
    sites: [site(), site({ id: "branch", name: "B" })],
    links: [link({ advertisedPrefixes: ["203.0.113.0/24"] })]
  }));
  assert.equal(public_.find(i => i.title === "Non-private advertised prefix").severity, "advice");
});

test("hub-and-spoke policy violations are all detected", () => {
  const noHub = reviewDesignIssues(base({
    topologyMode: "hub-spoke",
    sites: [site({ topologyRole: "spoke" }), site({ id: "b", topologyRole: "spoke", hubId: "hq" })]
  }));
  const noHubTitles = titles(noHub);
  assert.ok(noHubTitles.includes("Hub is missing"));
  assert.ok(noHubTitles.includes("Spoke has no valid hub"));

  const full = reviewDesignIssues(base({
    topologyMode: "hub-spoke",
    policies: { spokeToSpoke: "via-hub", centralizedInspection: true, secondaryHubId: "second" },
    sites: [
      site({ topologyRole: "hub", internetBreakout: "local" }),
      site({ id: "second", name: "Secondary", topologyRole: "hub" }),
      site({ id: "s1", name: "S1", topologyRole: "spoke", hubId: "hq", internetBreakout: "hub" }),
      site({ id: "s2", name: "S2", topologyRole: "spoke", hubId: "hq", internetBreakout: "local" })
    ],
    links: [
      link({ from: "hq", to: "s1", defaultRoute: true, resilience: "dual" }),
      link({ id: "l2", from: "hq", to: "s2", defaultRoute: true }),
      link({ id: "l3", from: "s1", to: "s2" })
    ]
  }));
  const fullTitles = titles(full);
  assert.ok(fullTitles.includes("Secondary hub path is missing"), "spokes need a path to the secondary hub");
  assert.ok(fullTitles.includes("Central breakout lacks default route") === false);
  const direct = full.find(i => i.title === "Direct spoke link conflicts with policy");
  assert.ok(direct, "direct spoke links conflict with via-hub policy");
  assert.equal(direct.siteId, "s1");

  const staleSecondary = reviewDesignIssues(base({
    topologyMode: "hub-spoke",
    policies: { spokeToSpoke: "via-hub", centralizedInspection: false, secondaryHubId: "gone" },
    sites: [site({ topologyRole: "hub" }), site({ id: "b", topologyRole: "spoke", hubId: "hq" })],
    links: [link()]
  }));
  assert.ok(titles(staleSecondary).includes("Secondary hub is invalid"));
});

test("a healthy design scores 100 and leads with the pass message", () => {
  const issues = reviewDesignIssues(migrateDesign(base({
    sites: [site({ vlans: [vlan()] })],
    links: []
  }), { strict: false }));
  assert.equal(issues[0].title, "Core checks passed");
  assert.equal(designScore(issues), 100);
});

test("designScore weights errors above warnings above advice and never goes negative", () => {
  assert.equal(designScore([{ severity: "error" }, { severity: "warning" }, { severity: "advice" }]), 73);
  assert.equal(designScore(Array.from({ length: 8 }, () => ({ severity: "error" }))), 0);
});

test("defaultFlowPolicy encodes the trust-zone matrix", () => {
  assert.equal(defaultFlowPolicy("users", "users"), "allow");
  assert.equal(defaultFlowPolicy("guest", "servers"), "deny");
  assert.equal(defaultFlowPolicy("management", "users"), "allow");
  assert.equal(defaultFlowPolicy("iot", "servers"), "restricted");
  assert.equal(defaultFlowPolicy("iot", "guest"), "deny");
  assert.equal(defaultFlowPolicy("users", "management"), "deny");
  assert.equal(defaultFlowPolicy("users", "voice"), "restricted");
});

test("overlap findings keep strict site-pair order while tolerating unparseable ranges", () => {
  const issues = reviewDesignIssues(base({
    sites: [
      site({ id: "a", name: "A", cidr: "10.1.0.0/16" }),
      site({ id: "b", name: "B", cidr: "not-a-cidr" }),
      site({ id: "c", name: "C", cidr: "10.1.3.0/24" }),
      site({ id: "d", name: "D", cidr: "10.1.9.0/24" })
    ]
  }));
  const overlaps = issues.filter(i => i.title === "Overlapping site ranges").map(i => i.message);
  assert.deepEqual(overlaps, [
    "A and C overlap. VPN routing between them will be ambiguous.",
    "A and D overlap. VPN routing between them will be ambiguous."
  ]);
  const invalid = issues.find(i => i.title === "Invalid site range");
  assert.match(invalid.message, /B does not have/);
});

test("reviewing a multi-thousand-site import stays fast and keeps isolation findings complete", () => {
  const count = 1200;
  const sites = Array.from({ length: count }, (_, i) => site({
    id: `s${i}`, name: `Site ${i}`, cidr: `10.${i % 256}.${Math.floor(i / 256)}.0/24`
  }));
  // One long connected chain plus one hundred deliberately stranded sites.
  const linked = Math.floor(count * 0.9);
  const links = Array.from({ length: linked - 1 }, (_, i) => link({ id: `l${i}`, from: `s${i}`, to: `s${i + 1}` }));
  const start = Date.now();
  const issues = reviewDesignIssues(base({ sites, links }));
  const elapsed = Date.now() - start;
  const isolated = issues.filter(i => i.title === "Isolated site");
  assert.equal(isolated.length, count - linked);
  assert.deepEqual(isolated.map(i => i.siteId), Array.from({ length: count - linked }, (_, k) => `s${linked + k}`));
  assert.ok(Number.isFinite(designScore(issues)));
  assert.ok(elapsed < 1500, `review must not stall on large imports (took ${elapsed}ms)`);
});
