import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.getByText("explore a complete example").click();
});

test("traces between spokes through the hub", async ({ page }) => {
  await page.getByRole("button", { name: "Trace path", exact: true }).click();
  const options=await page.locator("#trace-form select[name=from] option").evaluateAll(es=>es.map(e=>({text:e.textContent,value:e.value})));
  await page.locator("#trace-form select[name=from]").selectOption(options.find(o=>o.text.includes("Dublin")).value);
  await page.locator("#trace-form select[name=to]").selectOption(options.find(o=>o.text.includes("Azure")).value);
  await page.locator("#trace-form button[type=submit]").click();
  await expect(page.locator("#trace-detail")).toHaveText("Dublin office → Cork HQ → Azure production");
});

test("hub policy can deny spoke-to-spoke routing", async ({ page }) => {
  await page.locator("#hub-spoke-button").click();
  await page.locator("#hub-form select[name=spokeToSpoke]").selectOption("denied");
  await page.locator("#hub-form button[type=submit]").click();
  await page.getByRole("button", { name: "Trace path", exact: true }).click();
  const options=await page.locator("#trace-form select[name=from] option").evaluateAll(es=>es.map(e=>({text:e.textContent,value:e.value})));
  await page.locator("#trace-form select[name=from]").selectOption(options.find(o=>o.text.includes("Dublin")).value);
  await page.locator("#trace-form select[name=to]").selectOption(options.find(o=>o.text.includes("Azure")).value);
  await page.locator("#trace-form button[type=submit]").click();
  await expect(page.locator("#trace-detail")).toContainText("No permitted route");
});

test("editing a VLAN can be undone and redone", async ({ page }) => {
  await page.locator(".vlan-row").first().click();
  await page.locator("[data-edit-vlan]").click();
  await page.locator("#vlan-form input[name=devices]").fill("110");
  await page.locator("#vlan-form button[type=submit]").click();
  await expect(page.locator("#undo-button")).toBeEnabled();
  await page.locator("#utility-menu > summary").click();
  await page.locator("#undo-button").click();
  await page.locator("#utility-menu > summary").click();
  await page.locator("#redo-button").click();
  const stored=await page.evaluate(()=>JSON.parse(localStorage.getItem("network-planner-studio.v1")));
  expect(stored.sites[0].vlans[0].devices).toBe(110);
});

test("recommendations remain compatible with the example", async ({ page }) => {
  await page.locator("#recommend-button").click();
  await expect(page.locator("#recommend-preview")).toContainText("does not overlap");
  await page.locator("#apply-recommendation").click();
  await expect(page.locator(".topology-node")).toHaveCount(4);
});

test("imports a validated CSV address plan", async ({ page }) => {
  const csv="Site,Role,Site range,VLAN,VLAN name,Purpose,Subnet,Gateway,Devices,Endpoint capacity,DHCP,Reserved\nCork,standalone,10.44.0.0/16,10,Staff,users,10.44.10.0/24,10.44.10.1,80,253,enabled,1";
  await page.locator("#file-input").setInputFiles({name:"address-plan.csv",mimeType:"text/csv",buffer:Buffer.from(csv)});
  await expect(page.locator(".topology-node")).toHaveCount(1);
  await expect(page.locator(".vlan-row")).toContainText("Staff");
});

test("duplicates and reopens local projects", async ({ page }) => {
  await page.locator("#utility-menu > summary").click();
  await page.locator("#projects-button").click();
  await page.locator("#duplicate-project").click();
  await expect(page.locator(".project-card")).toHaveCount(2);
  await expect(page.locator(".project-card.current")).toContainText("copy");
  await page.locator(".project-card:not(.current) [data-open-project]").click();
  await expect(page.locator("#project-name-button")).toHaveText("Illek example network");
});

test("renders a complete implementation report", async ({ page }) => {
  await page.setViewportSize({width:390,height:844});
  await page.locator('[data-view="report"]').click();
  await expect(page.locator("#implementation-report")).toContainText("Site and address plan");
  await expect(page.locator("#implementation-report")).toContainText("WAN and routing intent");
  await expect(page.locator("#implementation-report")).toContainText("10.20.10.2");
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth)).toBe(true);
});

test("stores explicit DHCP pools outside the gateway", async ({ page }) => {
  await page.locator(".vlan-row").first().click();
  await page.locator("[data-edit-vlan]").click();
  await page.locator('#vlan-form input[name="dhcpStart"]').fill("10.20.10.20");
  await page.locator('#vlan-form input[name="dhcpEnd"]').fill("10.20.10.100");
  await page.locator("#vlan-form button[type=submit]").click();
  await expect(page.locator("#inspector")).toContainText("10.20.10.20 – 10.20.10.100");
});

test("rejects invalid gateways and hostile imported policy values", async ({ page }) => {
  const design={schema:"network-planner-studio/design",version:3,name:"Hostile",mode:"imported",topologyMode:"custom",policies:{spokeToSpoke:"via-hub",centralizedInspection:false},flowPolicies:{},assumptions:[],sites:[{id:"site",name:"HQ",type:"office",cidr:"10.60.0.0/16",devices:1,wan:"single",growth:30,x:20,y:20,topologyRole:"standalone",hubId:null,internetBreakout:"local",vlans:[{id:"vlan",name:"Staff",vid:10,role:'users" data-breakout="bad',devices:1,cidr:"10.60.10.0/24",gateway:"192.0.2.1",dhcpEnabled:true,reserved:1,dhcpStart:"10.60.10.2",dhcpEnd:"10.60.10.254"}]}],links:[]};
  await page.locator("#file-input").setInputFiles({name:"hostile.json",mimeType:"application/json",buffer:Buffer.from(JSON.stringify(design))});
  await expect(page.locator("#toast")).toContainText("Import failed");
  expect(await page.locator("[data-breakout]").count()).toBe(0);
});

test("keeps CSV DHCP pool boundaries on export and import", async ({ page }) => {
  await page.locator(".vlan-row").first().click();
  await page.locator("[data-edit-vlan]").click();
  await page.locator('#vlan-form input[name="dhcpStart"]').fill("10.20.10.20");
  await page.locator('#vlan-form input[name="dhcpEnd"]').fill("10.20.10.100");
  await page.locator("#vlan-form button[type=submit]").click();
  await page.locator('[data-view="addressing"]').click();
  const downloadPromise=page.waitForEvent("download");
  await page.locator("#csv-export").click();
  const download=await downloadPromise,csv=await (await import("node:fs/promises")).readFile(await download.path(),"utf8");
  await page.locator("#file-input").setInputFiles({name:"roundtrip.csv",mimeType:"text/csv",buffer:Buffer.from(csv)});
  await expect(page.locator("#toast")).toContainText("CSV imported and validated");
  await page.locator('[data-view="topology"]').click();
  await page.locator(".vlan-row").first().click();
  await expect(page.locator("#inspector")).toContainText("10.20.10.20");
  await expect(page.locator("#inspector")).toContainText("10.20.10.100");
});

test("keeps the tablet shell within the viewport and exposes keyboard tabs", async ({ page }) => {
  await page.setViewportSize({width:1024,height:768});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth)).toBe(true);
  const first=page.locator('[role="tab"]').first();await first.focus();await first.press("ArrowRight");
  await expect(page.locator('[role="tab"][aria-selected="true"]')).toHaveAttribute("data-view","addressing");
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth)).toBe(true);
});

test("reports no CSP console errors during a sample load", async ({ page }) => {
  const errors=[];page.on("console",message=>{if(message.text().toLowerCase().includes("content security policy"))errors.push(message.text())});
  await page.reload();await page.locator('[data-view="topology"]').click();
  expect(errors).toEqual([]);
});

test("has no automated accessibility violations in the planner", async ({ page }) => {
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
});

test("surfaces a storage quota failure with a recovery prompt", async ({ page }) => {
  await page.evaluate(() => Object.defineProperty(Storage.prototype, "setItem", { configurable: true, value() { throw new Error("quota"); } }));
  await page.locator("#project-name-button").click();
  await page.locator("#name-form input[name=name]").fill("Recovery test");
  await page.locator("#name-form button[type=submit]").click();
  await expect(page.locator("#toast")).toContainText("Export a recovery copy");
  await expect(page.locator("#save-state")).toContainText("Storage needs recovery");
});

test("skips trace particles under prefers-reduced-motion", async ({ page }) => {
  const trace = async () => {
    await page.getByRole("button", { name: "Trace path", exact: true }).click();
    const options = await page.locator("#trace-form select[name=from] option").evaluateAll(es => es.map(e => e.value));
    await page.locator("#trace-form select[name=from]").selectOption(options[0]);
    await page.locator("#trace-form select[name=to]").selectOption(options[1]);
    await page.locator("#trace-form button[type=submit]").click();
    await expect(page.locator("#trace-bar")).toBeVisible();
  };
  await trace();
  expect(await page.locator(".route-particle").count()).toBeGreaterThan(0);
  await page.locator("#close-trace").click();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await trace();
  expect(await page.locator(".route-particle").count()).toBe(0);
});

test("keeps keyboard focus when selection and policy edits re-render", async ({ page }) => {
  await page.locator(".vlan-row").first().focus();
  const vlanId = await page.locator(".vlan-row").first().getAttribute("data-vlan");
  await page.keyboard.press("Enter");
  await expect.poll(() => page.evaluate(() => `${document.activeElement.className.split(" ")[0]}[${document.activeElement.dataset.vlan || ""}]`)).toBe(`vlan-row[${vlanId}]`);

  const siteId = await page.locator(".site-row-select").first().getAttribute("data-site");
  await page.locator(".site-row-select").first().focus();
  await page.keyboard.press("Enter");
  await expect.poll(() => page.evaluate(() => `${document.activeElement.className.split(" ")[0]}[${document.activeElement.dataset.site || ""}]`)).toBe(`site-row-select[${siteId}]`);

  await page.locator('[data-view="policy"]').click();
  const cell = page.locator("[data-flow]").first();
  await cell.focus();
  const key = await cell.getAttribute("data-flow");
  await cell.click();
  await expect.poll(() => page.evaluate(() => document.activeElement?.dataset.flow || "")).toBe(key, { timeout: 2_000 });

  await page.locator('[data-view="topology"]').click();
  const nodeId = await page.locator(".topology-node").first().getAttribute("data-site");
  await page.locator(".topology-node").first().focus();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(150);
  expect(await page.evaluate(() => `${document.activeElement.className.split(" ")[0]}[${document.activeElement.dataset.site || ""}]`)).toBe(`topology-node[${nodeId}]`);

  await page.locator("#mobile-sites-button").click();
  await page.locator(".site-row-select").last().focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("#mobile-sites-button")).toBeFocused();
});
