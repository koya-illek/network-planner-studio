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
  const originalId=await page.locator(".vlan-row").first().getAttribute("data-vlan");
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
  expect(stored.sites[0].vlans[0].id).toBe(originalId);
});

test("editing a connection keeps its stable ID", async ({ page }) => {
  const originalId=await page.locator(".link-hit").first().getAttribute("data-link");
  await page.locator(".link-hit").first().focus();
  await page.keyboard.press("Enter");
  await page.locator("[data-edit-link]").click();
  await page.locator("#connect-form select[name=resilience]").selectOption("single");
  await page.locator("#connect-form button[type=submit]").click();
  await expect.poll(()=>page.evaluate(()=>JSON.parse(localStorage.getItem("network-planner-studio.v1")).links[0])).toMatchObject({id:originalId,notes:"Primary branch path."});
});

test("a failed VLAN edit cannot turn into an accidental site move", async ({ page }) => {
  await page.locator(".vlan-row").first().click();
  await page.locator("[data-edit-vlan]").click();
  await page.locator("#vlan-form input[name=cidr]").fill("10.99.10.0/24");
  await page.locator("#vlan-form button[type=submit]").click();
  await expect(page.locator("#vlan-form select[name=siteId]")).toBeDisabled();
  await expect(page.locator("#vlan-form-error")).toContainText("outside the site's");
  await page.locator("#vlan-form input[name=cidr]").fill("10.20.10.0/25");
  await page.locator("#vlan-form button[type=submit]").click();
  await expect(page.locator("#vlan-dialog")).not.toBeVisible();
});

test("accepts a custom gateway and excludes it from the default pool", async ({ page }) => {
  await page.locator(".vlan-row").first().click();
  await page.locator("[data-edit-vlan]").click();
  await page.locator("#vlan-form input[name=gateway]").fill("10.20.10.126");
  await page.locator("#vlan-form input[name=dhcpStart]").fill("");
  await page.locator("#vlan-form input[name=dhcpEnd]").fill("");
  await page.locator("#vlan-form button[type=submit]").click();
  await expect.poll(()=>page.evaluate(()=>JSON.parse(localStorage.getItem("network-planner-studio.v1")).sites[0].vlans[0])).toMatchObject({gateway:"10.20.10.126",dhcpStart:"10.20.10.2",dhcpEnd:"10.20.10.125"});
  await expect(page.locator("#inspector")).toContainText("10.20.10.126");
});

test("finds a free low VLAN ID when a high ID is already occupied", async ({ page }) => {
  const vids=[10,20,30,40,50,60,70,80,90,99,4094];
  const vlans=vids.map((vid,index)=>({id:`v${index}`,name:`VLAN ${vid}`,vid,role:"other",devices:1,cidr:`10.70.${index}.0/24`,gateway:`10.70.${index}.1`,dhcpEnabled:true,reserved:1,dhcpStart:`10.70.${index}.2`,dhcpEnd:`10.70.${index}.254`,notes:""}));
  const design={schema:"network-planner-studio/design",version:3,name:"VLAN fallback",mode:"imported",topologyMode:"custom",policies:{spokeToSpoke:"via-hub",centralizedInspection:false},flowPolicies:{},assumptions:[],sites:[{id:"site",name:"HQ",type:"office",cidr:"10.70.0.0/16",devices:1,wan:"single",growth:30,x:20,y:20,topologyRole:"standalone",hubId:null,internetBreakout:"local",vlans}],links:[]};
  await page.locator("#file-input").setInputFiles({name:"vlan-fallback.json",mimeType:"application/json",buffer:Buffer.from(JSON.stringify(design))});
  await page.locator("#add-site-side").waitFor();
  await page.locator(".add-vlan-mini").click();
  await expect(page.locator("#vlan-form input[name=vid]")).toHaveValue("1");
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

test("imports RFC 4180 multiline CSV fields", async ({ page }) => {
  const csv='Site,Role,Site range,VLAN,VLAN name,Purpose,Subnet,Gateway,Devices,DHCP,Reserved,Site notes,VLAN notes\r\nCork,standalone,10.44.0.0/16,10,Staff,users,10.44.10.0/24,10.44.10.1,80,enabled,1,"First line\r\nSecond line","Firewall ""handoff""\r\nRack 4"';
  await page.locator("#file-input").setInputFiles({name:"multiline.csv",mimeType:"text/csv",buffer:Buffer.from(csv)});
  await expect(page.locator("#toast")).toContainText("CSV imported and validated");
  await expect.poll(() => page.evaluate(() => {
    const design=JSON.parse(localStorage.getItem("network-planner-studio.v1"));
    return {site:design.sites[0].notes,vlan:design.sites[0].vlans[0].notes};
  })).toEqual({site:"First line\r\nSecond line",vlan:'Firewall "handoff"\r\nRack 4'});
});

test("builds a safe default DHCP pool for a custom CSV gateway", async ({ page }) => {
  const csv="Site,Role,Site range,VLAN,VLAN name,Purpose,Subnet,Gateway,Devices,DHCP,Reserved\nCork,standalone,10.44.0.0/16,10,Staff,users,10.44.10.0/24,10.44.10.254,80,enabled,1";
  await page.locator("#file-input").setInputFiles({name:"custom-gateway.csv",mimeType:"text/csv",buffer:Buffer.from(csv)});
  await expect.poll(()=>page.evaluate(()=>JSON.parse(localStorage.getItem("network-planner-studio.v1")).sites[0].vlans[0])).toMatchObject({gateway:"10.44.10.254",dhcpStart:"10.44.10.2",dhcpEnd:"10.44.10.253"});
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

test("keeps a stored gateway when a VLAN is edited", async ({ page }) => {
  const design={schema:"network-planner-studio/design",version:3,name:"Gateway keeper",mode:"imported",topologyMode:"custom",policies:{spokeToSpoke:"via-hub",centralizedInspection:false},flowPolicies:{},assumptions:[],sites:[{id:"site",name:"HQ",type:"office",cidr:"10.60.0.0/16",devices:1,wan:"single",growth:30,x:20,y:20,topologyRole:"standalone",hubId:null,internetBreakout:"local",vlans:[{id:"vlan",name:"Staff",vid:10,role:"users",devices:40,cidr:"10.60.10.0/24",gateway:"10.60.10.254",dhcpEnabled:true,reserved:1,dhcpStart:"10.60.10.2",dhcpEnd:"10.60.10.250"}]}],links:[]};
  await page.locator("#file-input").setInputFiles({ name:"gateway.json", mimeType:"application/json", buffer:Buffer.from(JSON.stringify(design)) });
  await page.locator(".vlan-row").first().click();
  await page.locator("[data-edit-vlan]").click();
  await page.locator("#vlan-form input[name=name]").fill("Staff renamed");
  await page.locator("#vlan-form button[type=submit]").click();
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("network-planner-studio.v1")).sites[0].vlans[0]), { timeout: 2000 }).toMatchObject({ name:"Staff renamed", gateway:"10.60.10.254" });
  await expect(page.locator("#inspector")).toContainText("10.60.10.254");
});

test("rejects invalid gateways and hostile imported policy values", async ({ page }) => {
  const design={schema:"network-planner-studio/design",version:3,name:"Hostile",mode:"imported",topologyMode:"custom",policies:{spokeToSpoke:"via-hub",centralizedInspection:false},flowPolicies:{},assumptions:[],sites:[{id:"site",name:"HQ",type:"office",cidr:"10.60.0.0/16",devices:1,wan:"single",growth:30,x:20,y:20,topologyRole:"standalone",hubId:null,internetBreakout:"local",vlans:[{id:"vlan",name:"Staff",vid:10,role:'users" data-breakout="bad',devices:1,cidr:"10.60.10.0/24",gateway:"192.0.2.1",dhcpEnabled:true,reserved:1,dhcpStart:"10.60.10.2",dhcpEnd:"10.60.10.254"}]}],links:[]};
  await page.locator("#file-input").setInputFiles({name:"hostile.json",mimeType:"application/json",buffer:Buffer.from(JSON.stringify(design))});
  await expect(page.locator("#toast")).toContainText("Import failed");
  expect(await page.locator("[data-breakout]").count()).toBe(0);
});

test("reports corrections made while recovering stored design data", async ({ page }) => {
  await page.evaluate(() => {
    const design=JSON.parse(localStorage.getItem("network-planner-studio.v1"));
    design.sites[0].vlans[0].vid=5000;
    localStorage.setItem("network-planner-studio.v1",JSON.stringify(design));
  });
  await page.reload();
  await page.locator('[data-view="review"]').click();
  await expect(page.locator("#review-list")).toContainText("Recovered design data");
  await expect(page.locator("#review-list")).toContainText("vid");
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

test("has no automated accessibility violations in planner dialogs", async ({ page }) => {
  const checks = [
    ["#add-site-top", "#site-dialog"],
    [".add-vlan-mini", "#vlan-dialog"],
    ['[data-tool="connect"]', "#connect-dialog"],
    ["#project-name-button", "#name-dialog"],
    ["#recommend-button", "#recommend-dialog"],
    ["#hub-spoke-button", "#hub-dialog"],
    ['[data-tool="trace"]', "#trace-dialog"],
  ];
  for (const [opener, dialog] of checks) {
    await page.locator(opener).first().click();
    await expect(page.locator(dialog)).toBeVisible();
    const results = await new AxeBuilder({ page }).include(dialog).analyze();
    expect(results.violations, dialog).toEqual([]);
    await page.locator(`${dialog} [data-close-dialog]`).first().click();
  }
  await page.locator("#utility-menu > summary").click();
  await page.locator("#projects-button").click();
  const projectResults = await new AxeBuilder({ page }).include("#projects-dialog").analyze();
  expect(projectResults.violations, "#projects-dialog").toEqual([]);
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

test("keeps keyboard focus after dialog-driven edits", async ({ page }) => {
  await page.locator(".add-vlan-mini").first().focus();
  await page.keyboard.press("Enter");
  await page.locator("#vlan-form input[name=name]").fill("Probe net");
  await page.locator("#vlan-form button[type=submit]").click();
  await expect.poll(() => page.evaluate(() => document.activeElement.className)).toContain("add-vlan-mini");

  await page.locator(".site-row-select").first().click();
  const inspectorButton = page.locator("[data-inspector-add-vlan]");
  await inspectorButton.focus();
  await page.keyboard.press("Enter");
  await page.locator("#vlan-form input[name=name]").fill("Probe two");
  await page.locator("#vlan-form button[type=submit]").click();
  await expect.poll(() => page.evaluate(() => document.activeElement.id || document.activeElement.className)).toBe("inspector");
});

test("flushes a pending debounced save when the page is hidden", async ({ page }) => {
  await page.locator("#project-name-button").click();
  await page.locator("#name-form input[name=name]").fill("Flush test");
  await page.locator("#name-form button[type=submit]").click();
  await page.evaluate(() => window.dispatchEvent(new Event("pagehide")));
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("network-planner-studio.v1")).name);
  expect(stored).toBe("Flush test");
});

test("warns when the current design changes in another browser tab", async ({ page }) => {
  const other = await page.context().newPage();
  await other.goto("/");
  await other.locator("#project-name-button").click();
  await other.locator("#name-form input[name=name]").fill("Renamed in the other tab");
  await other.locator("#name-form button[type=submit]").click();
  await expect(page.locator("#toast")).toContainText("another browser tab", { timeout: 3000 });
  await other.close();
});

test("does not report a conflict when another tab saves a different design", async ({ page }) => {
  const other = await page.context().newPage();
  await other.goto("/");
  await other.evaluate(() => localStorage.setItem("network-planner-studio.v1", JSON.stringify({projectId:"different-project",updatedAt:new Date().toISOString()})));
  await page.waitForTimeout(300);
  await expect(page.locator("#toast")).not.toContainText("another browser tab");
  await other.close();
});

test("relayouts the canvas after edits made from other tabs", async ({ page }) => {
  const nodeBox = () => page.evaluate(() => {
    const canvas = document.querySelector("#canvas").getBoundingClientRect();
    const node = document.querySelector(".topology-node").getBoundingClientRect();
    return { viewBox: document.querySelector("#link-layer").getAttribute("viewBox"), left: node.left - canvas.left, top: node.top - canvas.top };
  });
  const before = await nodeBox();
  await page.locator('[data-view="policy"]').click();
  await page.locator("[data-flow]").first().click();
  await page.waitForTimeout(400);
  await page.locator('[data-view="topology"]').click();
  const after = await nodeBox();
  expect(after.viewBox).not.toBe("0 0 800 600");
  expect(Math.abs(after.left - before.left)).toBeLessThanOrEqual(2);
  expect(Math.abs(after.top - before.top)).toBeLessThanOrEqual(2);
});

test("keeps the mobile sites drawer disclosure truthful", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(150);
  const expanded = () => page.locator("#mobile-sites-button").getAttribute("aria-expanded");
  await page.locator("#mobile-sites-button").click();
  expect(await expanded()).toBe("true");
  await page.locator(".site-row-select").last().click();
  expect(await page.locator(".tool-panel")).not.toHaveClass(/mobile-open/);
  expect(await expanded()).toBe("false");
  await page.locator("#mobile-sites-button").click();
  await page.locator(".vlan-row").first().click();
  expect(await page.locator(".tool-panel")).not.toHaveClass(/mobile-open/);
  expect(await expanded()).toBe("false");
});

test("keeps topology nodes inside the canvas on tablet widths", async ({ page }) => {  await page.setViewportSize({ width: 768, height: 900 });
  await page.waitForTimeout(250);
  const boxes = await page.evaluate(() => {
    const canvas = document.querySelector("#canvas").getBoundingClientRect();
    return [...document.querySelectorAll(".topology-node")].map(node => ({
      width: node.offsetWidth,
      overhang: Math.round(node.getBoundingClientRect().right - canvas.right)
    }));
  });
  expect(boxes.length).toBeGreaterThan(0);
  for (const box of boxes) {
    expect(box.width).toBe(150);
    expect(box.overhang).toBeLessThanOrEqual(1);
  }
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

test("pinch-zooms the canvas on touch and aborts cancelled gestures", async ({ page }) => {
  const pageErrors = [];
  page.on("pageerror", error => pageErrors.push(String(error)));
  const transform = () => page.locator("#link-layer").evaluate(el => el.style.transform || "");
  await page.locator(".topology-node").first().waitFor();
  expect(await transform()).toBe("");

  await page.evaluate(() => {
    const canvas = document.querySelector("#canvas");
    const box = canvas.getBoundingClientRect();
    const cx = box.left + box.width / 2, cy = box.top + box.height / 2;
    const mk = (type, id, x, y) => new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: id, pointerType: "touch", isPrimary: id === 5, clientX: x, clientY: y });
    canvas.dispatchEvent(mk("pointerdown", 5, cx - 60, cy));
    canvas.dispatchEvent(mk("pointerdown", 6, cx + 60, cy));
    for (let i = 1; i <= 10; i++) {
      canvas.dispatchEvent(mk("pointermove", 5, cx - 60 - i * 4, cy));
      canvas.dispatchEvent(mk("pointermove", 6, cx + 60 + i * 4, cy));
    }
    canvas.dispatchEvent(mk("pointerup", 5, cx - 100, cy));
    canvas.dispatchEvent(mk("pointerup", 6, cx + 100, cy));
  });
  const zoomed = Number(((await transform()).match(/scale\(([\d.]+)\)/) || [])[1]);
  expect(zoomed).toBeGreaterThan(1.2);
  await page.locator("#zoom-fit").click();
  expect(await transform()).toContain("scale(1)");

  const node = page.locator(".topology-node").first();
  await page.waitForTimeout(250);
  const dragStart = await page.evaluate(() => {
    const canvas = document.querySelector("#canvas");
    const nb = document.querySelector(".topology-node").getBoundingClientRect();
    const mk = (type, x, y) => new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 7, pointerType: "touch", isPrimary: true, clientX: x, clientY: y });
    document.elementFromPoint(nb.left + 10, nb.top + 10).dispatchEvent(mk("pointerdown", nb.left + 10, nb.top + 10));
    for (let i = 1; i <= 8; i++) canvas.dispatchEvent(mk("pointermove", nb.left + 10 + i * 6, nb.top + 10));
    canvas.dispatchEvent(mk("pointerup", nb.left + 58, nb.top + 10));
    return nb.left;
  });
  expect((await node.boundingBox()).x).toBeGreaterThan(dragStart + 5);

  const cancelProbe = await page.evaluate(() => {
    const canvas = document.querySelector("#canvas");
    const nb = document.querySelector(".topology-node").getBoundingClientRect();
    const mk = (type, x, y) => new PointerEvent(type, { bubbles: true, cancelable: type !== "pointercancel", pointerId: 9, pointerType: "touch", isPrimary: true, clientX: x, clientY: y });
    const hit = document.elementFromPoint(nb.left + 10, nb.top + 10);
    hit.dispatchEvent(mk("pointerdown", nb.left + 10, nb.top + 10));
    canvas.dispatchEvent(new PointerEvent("pointercancel", { bubbles: true, cancelable: false, pointerId: 9, pointerType: "touch", isPrimary: true }));
    const settled = document.querySelector(".topology-node").getBoundingClientRect().left;
    canvas.dispatchEvent(mk("pointermove", nb.left + 120, nb.top + 60));
    canvas.dispatchEvent(mk("pointermove", nb.left + 180, nb.top + 90));
    return { settled, afterHover: document.querySelector(".topology-node").getBoundingClientRect().left };
  });
  expect(Math.abs(cancelProbe.afterHover - cancelProbe.settled)).toBeLessThan(2);
  expect(pageErrors).toEqual([]);
});

test("restores a dragged node when the gesture is cancelled", async ({ page }) => {
  await page.locator(".topology-node").first().waitFor();
  const nodeLeft = () => page.evaluate(() => Math.round(document.querySelector(".topology-node").getBoundingClientRect().left));
  const origin = await nodeLeft();
  await page.evaluate(() => {
    const canvas = document.querySelector("#canvas");
    const nb = document.querySelector(".topology-node").getBoundingClientRect();
    const mk = (type, x, y) => new PointerEvent(type, { bubbles: true, cancelable: type !== "pointercancel", pointerId: 11, pointerType: "touch", isPrimary: true, clientX: x, clientY: y });
    document.elementFromPoint(nb.left + 10, nb.top + 10).dispatchEvent(mk("pointerdown", nb.left + 10, nb.top + 10));
    for (let i = 1; i <= 8; i++) canvas.dispatchEvent(mk("pointermove", nb.left + 10 + i * 6, nb.top + 10));
    canvas.dispatchEvent(new PointerEvent("pointercancel", { bubbles: true, cancelable: false, pointerId: 11, pointerType: "touch", isPrimary: true }));
  });
  await page.waitForTimeout(60);
  expect(Math.abs((await nodeLeft()) - origin)).toBeLessThanOrEqual(1);
  await expect(page.locator("#undo-button")).toBeDisabled();
});

test("settles a moved node drag when a pinch takes over", async ({ page }) => {
  await page.locator(".topology-node").first().waitFor();
  const storedX = () => page.evaluate(() => JSON.parse(localStorage.getItem("network-planner-studio.v1")).sites[0].x);
  const before = await storedX();
  await page.evaluate(() => {
    const canvas = document.querySelector("#canvas");
    const box = canvas.getBoundingClientRect();
    const nb = document.querySelector(".topology-node").getBoundingClientRect();
    const mk = (type, id, x, y) => new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: id, pointerType: "touch", isPrimary: id === 21, clientX: x, clientY: y });
    document.elementFromPoint(nb.left + 10, nb.top + 10).dispatchEvent(mk("pointerdown", 21, nb.left + 10, nb.top + 10));
    for (let i = 1; i <= 8; i++) canvas.dispatchEvent(mk("pointermove", 21, nb.left + 10 + i * 6, nb.top + 10));
    canvas.dispatchEvent(mk("pointerdown", 22, box.left + 20, box.bottom - 20));
    for (let i = 1; i <= 4; i++) {
      canvas.dispatchEvent(mk("pointermove", 21, nb.left + 58 - i * 3, nb.top + 10));
      canvas.dispatchEvent(mk("pointermove", 22, box.left + 20 - i * 3, box.bottom - 20));
    }
    canvas.dispatchEvent(mk("pointerup", 21, nb.left + 46, nb.top + 10));
    canvas.dispatchEvent(mk("pointerup", 22, box.left + 8, box.bottom - 20));
  });
  await page.evaluate(() => window.dispatchEvent(new Event("pagehide")));
  expect(await storedX()).toBeGreaterThan(before);
});

test("makes an arrow-key nudge burst undoable and redoable", async ({ page }) => {
  const node = page.locator(".topology-node").first();
  await node.waitFor();
  const storedX = () => page.evaluate(() => JSON.parse(localStorage.getItem("network-planner-studio.v1")).sites[0].x);
  await node.focus();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await expect(page.locator("#undo-button")).toBeEnabled();
  await page.evaluate(() => window.dispatchEvent(new Event("pagehide")));
  const moved = await storedX();
  expect(moved).toBeGreaterThan(42);
  await page.locator("#utility-menu > summary").click();
  await page.locator("#undo-button").click();
  expect(await storedX()).toBe(42);
  await page.locator("#utility-menu > summary").click();
  await page.locator("#redo-button").click();
  expect(await storedX()).toBe(moved);
});

test("keeps rapid keyboard nudges on different nodes in separate history entries", async ({ page }) => {
  const nodes = page.locator(".topology-node");
  const positions = () => page.evaluate(() => JSON.parse(localStorage.getItem("network-planner-studio.v1")).sites.slice(0,2).map(site => site.x));
  await nodes.nth(0).focus();
  await page.keyboard.press("ArrowRight");
  await nodes.nth(1).focus();
  await page.keyboard.press("ArrowRight");
  await page.locator("#utility-menu > summary").click();
  await page.locator("#undo-button").click();
  expect(await positions()).toEqual([44,70]);
  await page.locator("#utility-menu > summary").click();
  await page.locator("#undo-button").click();
  expect(await positions()).toEqual([42,70]);
});

test("keeps focus recoverable when a background save-render lands during a dialog", async ({ page }) => {
  await page.locator(".add-vlan-mini").first().focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("#vlan-dialog")).toBeVisible();
  await page.evaluate(() => {
    window.__inspectorReplacements = 0;
    new MutationObserver(records => { window.__inspectorReplacements += records.length; }).observe(document.querySelector("#inspector"), { childList: true });
    document.querySelector("[data-flow]").click();
  });
  await page.waitForTimeout(350);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(80);
  const state = await page.evaluate(() => ({
    active: document.activeElement?.className?.split(" ")[0] || document.activeElement?.tagName,
    replacements: window.__inspectorReplacements
  }));
  expect(state.active).toBe("add-vlan-mini");
  expect(state.replacements).toBeGreaterThan(0);
});

test("quarantines an unreadable project library instead of erasing it", async ({ page }) => {
  await page.evaluate(() => localStorage.setItem("network-planner-studio.projects.v1", "{not json"));
  await page.locator("#utility-menu > summary").click();
  await page.locator("#projects-button").click();
  const quarantined = await page.evaluate(() => localStorage.getItem("network-planner-studio.projects.v1.unreadable"));
  expect(quarantined).toBe("{not json");
  await expect(page.locator("#project-list")).toContainText("No saved designs yet.");
  await expect(page.locator("#toast")).toContainText("could not be read");
  await page.keyboard.press("Escape");
});

test("flushes a pending debounced save when the tab is backgrounded", async ({ page }) => {
  await page.locator("#project-name-button").click();
  await page.locator("#name-form input[name=name]").fill("Background flush test");
  await page.locator("#name-form button[type=submit]").click();
  await page.evaluate(() => Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" }));
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("network-planner-studio.v1")).name)).toBe("Background flush test");
});

test("canvas nodes and links announce health and resilience in words", async ({ page }) => {
  await expect(page.locator(".topology-node .health-flag.warning").first()).toHaveText("Risks");
  const flagged = await page.locator('.topology-node[aria-label*="risks to review"]').count();
  expect(flagged).toBeGreaterThan(0);
  const dualLabel = await page.locator(".link-hit").first().getAttribute("aria-label");
  expect(dualLabel).toMatch(/redundant paths/);
  expect(dualLabel).toMatch(/vpn/);
});

test("trace progress is a live region", async ({ page }) => {
  await expect(page.locator("#trace-detail")).toHaveAttribute("aria-live", "polite");
});

test("escape clears the inspector selection", async ({ page }) => {
  await page.locator(".vlan-row").first().click();
  await expect(page.locator("#inspector")).not.toContainText("Select something");
  await page.keyboard.press("Escape");
  await expect(page.locator("#inspector")).toContainText("Select something");
  await expect.poll(() => page.evaluate(() => document.activeElement.id)).toBe("inspector");
});
