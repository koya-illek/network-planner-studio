import { test, expect } from "@playwright/test";

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
  await page.locator("#undo-button").click();
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
