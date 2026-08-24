/*
 * Large-design render benchmark. Generates a synthetic design (default 1200
 * sites, ~3 VLANs each), loads the workspace with it in localStorage, and
 * measures the interactive cost of a selection change and a node drag.
 *
 * Usage: node scripts/bench-large.mjs [siteCount] [samples]
 */
import { chromium } from "@playwright/test";
import { SCHEMA_ID } from "../public/network-core.js";

const SITES = Number(process.argv[2] || 1200);
const SAMPLES = Number(process.argv[3] || 5);

function buildDesign(siteCount) {
  const sites = [], links = [];
  for (let i = 0; i < siteCount; i++) {
    const id = `s${i}`;
    const third = Math.floor(i / 256), fourth = i % 256;
    sites.push({
      id, name: `Site ${String(i).padStart(4, "0")}`, type: "branch", cidr: `10.${third}.${fourth}.0/24`,
      devices: 60, wan: "single", growth: 30, x: 5 + (i % 20) * 4.5, y: 4 + Math.floor(i / 20) * 4,
      topologyRole: i === 0 ? "hub" : "spoke", hubId: i === 0 ? null : "s0", internetBreakout: "local",
      notes: "", vlans: [
        { id: `${id}-v1`, name: "Staff", vid: 10, role: "users", devices: 30, cidr: `10.${third}.${fourth}.0/26`, gateway: `10.${third}.${fourth}.1`, dhcpEnabled: true, reserved: 1, dhcpStart: `10.${third}.${fourth}.2`, dhcpEnd: `10.${third}.${fourth}.62`, notes: "" },
        { id: `${id}-v2`, name: "Voice", vid: 20, role: "voice", devices: 15, cidr: `10.${third}.${fourth}.64/26`, gateway: `10.${third}.${fourth}.65`, dhcpEnabled: true, reserved: 1, dhcpStart: `10.${third}.${fourth}.66`, dhcpEnd: `10.${third}.${fourth}.126`, notes: "" },
        { id: `${id}-v3`, name: "Management", vid: 99, role: "management", devices: 8, cidr: `10.${third}.${fourth}.128/27`, gateway: `10.${third}.${fourth}.129`, dhcpEnabled: false, reserved: 1, dhcpStart: "", dhcpEnd: "", notes: "" }
      ]
    });
    if (i > 0 && (i % 7 === 0 || i < 8)) links.push({ id: `l${i}`, from: "s0", to: id, type: "vpn", resilience: "single", routingType: "static", transitAllowed: true, defaultRoute: true, advertisedPrefixes: ["0.0.0.0/0"], notes: "" });
  }
  return { schema: SCHEMA_ID, version: 3, projectId: "bench", name: "Benchmark design", mode: "imported", topologyMode: "custom", policies: { spokeToSpoke: "via-hub", centralizedInspection: false, secondaryHubId: null }, flowPolicies: {}, assumptions: [], sites, links, updatedAt: new Date().toISOString() };
}

async function timed(page, fn) {
  return page.evaluate(fn);
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
await page.goto("http://127.0.0.1:8795/");
await page.evaluate(() => localStorage.clear());
await page.evaluate(design => localStorage.setItem("network-planner-studio.v1", JSON.stringify(design)), buildDesign(SITES));

// Cold workspace entry with the large design present.
const coldStart = Date.now();
await page.reload();
await page.waitForSelector(".topology-node");
const coldMs = Date.now() - coldStart;

function measureClick() {
  const start = performance.now();
  document.querySelectorAll(".topology-node")[50].click();
  const end = performance.now();
  return end - start;
}
function measureDragStep() {
  // Simulate what one pointermove does during a drag: a full canvas re-render
  // through the same code path renderCanvas uses.
  const start = performance.now();
  const event = new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true });
  document.activeElement.dispatchEvent(event);
  const end = performance.now();
  return end - start;
}

await page.click("[data-view=\"topology\"]");
await page.waitForTimeout(300);
const firstNode = await page.locator(".topology-node").nth(2);
await firstNode.focus();

const clicks = [], nudges = [];
for (let i = 0; i < SAMPLES; i++) {
  await page.waitForTimeout(80);
  clicks.push(await timed(page, measureClick));
}
await page.locator(".topology-node").nth(3).focus();
for (let i = 0; i < SAMPLES; i++) {
  await page.waitForTimeout(80);
  nudges.push(await timed(page, measureDragStep));
}

// Tab switch cost into the heaviest table views.
const addressingSwitch = await timed(page, async () => {
  const start = performance.now();
  document.querySelector('[data-view="addressing"]').click();
  void document.querySelector("#address-table").rows.length;
  const end = performance.now();
  return end - start;
});
const addressRows = await page.evaluate(() => document.querySelector("#address-table").rows.length);

const median = values => values.sort((a, b) => a - b)[Math.floor(values.length / 2)];
console.log(`sites=${SITES} vlans=${SITES * 3}`);
console.log(`cold workspace entry: ${coldMs} ms`);
console.log(`select-node median: ${median(clicks).toFixed(1)} ms  (all: ${clicks.map(v => v.toFixed(1)).join(", ")})`);
console.log(`nudge-step median : ${median(nudges).toFixed(1)} ms  (all: ${nudges.map(v => v.toFixed(1)).join(", ")})`);
console.log(`address-plan tab switch: ${addressingSwitch.toFixed(1)} ms, rows=${addressRows}`);
console.log(`dom nodes total   : ${(await page.evaluate(() => document.getElementsByTagName("*").length))}`);
await browser.close();
