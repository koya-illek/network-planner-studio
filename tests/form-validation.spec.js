import { test, expect } from "@playwright/test";
async function submit(page,id){await page.locator(id).focus();await page.keyboard.press("Enter")}
async function failure(page,form,name,text){
 const field=page.locator(`${form} [name="${name}"]`),error=page.locator(`${form} .form-error`);
 await expect(error).toContainText(text);await expect(field).toBeFocused();
 await expect(field).toHaveAttribute("aria-invalid","true");
 await expect(field).toHaveAttribute("aria-describedby",new RegExp(await error.getAttribute("id")));
}
async function correct(page,form,name,value,hint){
 const field=page.locator(`${form} [name="${name}"]`);await field.fill(value);
 await expect(field).toHaveAttribute("aria-invalid","false");await expect(page.locator(`${form} .form-error`)).toBeEmpty();
 if(hint)await expect(field).toHaveAttribute("aria-describedby",hint);else await expect(field).not.toHaveAttribute("aria-describedby");
}
for(const width of [320,390,1440])for(const rootSize of [16,32])for(const hasTouch of [false,true])test.describe(`${width}px root${rootSize} ${hasTouch?"coarse":"fine"}`,()=>{
 test.use({viewport:{width,height:1000},hasTouch});
 test("custom errors locate, describe, clear and allow corrected retry",async({page},testInfo)=>{
  const errors=[];page.on("pageerror",error=>errors.push(error.message));
  await page.goto("/");await page.evaluate(size=>document.documentElement.style.fontSize=`${size}px`,rootSize);
  expect(await page.evaluate(()=>matchMedia("(pointer: coarse)").matches)).toBe(hasTouch);
  await page.locator('[data-start="new"]').click();const site=page.locator("#site-form");
  await site.locator('[name="name"]').fill("Audit site with a long descriptive name");const cidr=site.locator('[name="cidr"]');
  await expect(cidr).not.toHaveAttribute("aria-invalid","true");await cidr.fill("bad-cidr");await submit(page,"#site-submit");
  await failure(page,"#site-form","cidr","IPv4 CIDR");await expect(cidr).toHaveAttribute("aria-describedby","site-cidr-hint site-form-error");
  await expect(site.locator('[name="name"]')).toHaveValue("Audit site with a long descriptive name");
  for(const field of await site.locator("input,select,textarea").all())expect(await field.evaluate(e=>parseFloat(getComputedStyle(e).fontSize))).toBeGreaterThanOrEqual(rootSize);
  const box=await site.evaluate(e=>{const r=e.closest("dialog").getBoundingClientRect();return{left:r.left,right:r.right,scroll:e.scrollWidth,client:e.clientWidth}});
  expect(box.left).toBeGreaterThanOrEqual(0);expect(box.right).toBeLessThanOrEqual(width+1);expect(box.scroll).toBeLessThanOrEqual(box.client+1);
  await page.screenshot({path:testInfo.outputPath("site-invalid.png")});
  await correct(page,"#site-form","cidr","10.40.0.0/16","site-cidr-hint");await submit(page,"#site-submit");
  await expect(page.locator("#site-dialog")).not.toBeVisible();await expect(page.locator(".topology-node")).toHaveCount(1);
  await expect.poll(()=>page.locator("#inspector").evaluate(e=>e.getBoundingClientRect().right)).toBeLessThanOrEqual(width+1);
  if(width<=1050){const rectangles=await page.evaluate(()=>({tabs:document.querySelector(".view-tabs").getBoundingClientRect().bottom,inspector:document.querySelector("#inspector").getBoundingClientRect().top}));expect(rectangles.inspector).toBeGreaterThanOrEqual(rectangles.tabs-1)}
  await page.screenshot({path:testInfo.outputPath("after-site.png")});
  await page.locator("#tab-addressing").click();expect(await page.locator("#address-filter").evaluate(e=>parseFloat(getComputedStyle(e).fontSize))).toBeGreaterThanOrEqual(rootSize);await page.locator("#add-vlan-address").click();const vlan=page.locator("#vlan-form");
  await vlan.locator('[name="name"]').fill("Staff VLAN");await vlan.locator('[name="cidr"]').fill("10.41.1.0/24");await submit(page,"#vlan-submit");
  await failure(page,"#vlan-form","cidr","outside the site's");await correct(page,"#vlan-form","cidr","10.40.1.0/24","vlan-cidr-hint");
  await vlan.locator('[name="gateway"]').fill("10.40.2.1");await submit(page,"#vlan-submit");
  await failure(page,"#vlan-form","gateway","Gateway must");await correct(page,"#vlan-form","gateway","10.40.1.1");
  await vlan.locator('[name="dhcpStart"]').fill("10.40.1.100");await vlan.locator('[name="dhcpEnd"]').fill("10.40.1.50");await submit(page,"#vlan-submit");
  await expect(page.locator("#vlan-form-error")).toBeFocused();for(const name of ["dhcpStart","dhcpEnd"])await expect(vlan.locator(`[name="${name}"]`)).toHaveAttribute("aria-invalid","true");
  await correct(page,"#vlan-form","dhcpEnd","10.40.1.200");await expect(vlan.locator('[name="dhcpStart"]')).toHaveAttribute("aria-invalid","false");
  await submit(page,"#vlan-submit");await expect(page.locator("#vlan-dialog")).not.toBeVisible();await expect(page.locator("#address-table")).toContainText("Staff VLAN");
  await page.locator("#add-vlan-address").click();await vlan.locator('[name="name"]').fill("Duplicate VLAN");await vlan.locator('[name="vid"]').fill("10");await submit(page,"#vlan-submit");
  await failure(page,"#vlan-form","vid","already used");await page.keyboard.press("Escape");await page.locator("#add-vlan-address").click();
  await expect(page.locator("#vlan-form-error")).toBeEmpty();await expect(vlan.locator('[name="vid"]')).not.toHaveAttribute("aria-invalid","true");await expect(vlan.locator('[name="vid"]')).not.toHaveAttribute("aria-describedby");
  await page.screenshot({path:testInfo.outputPath("vlan-reopened.png")});await expect(errors).toEqual([]);
 });
});

for(const rootSize of [16,32])test(`desktop site filter scales and remains usable at root ${rootSize}px`,async({page},testInfo)=>{
 await page.setViewportSize({width:1440,height:1000});await page.goto("/");
 await page.evaluate(size=>document.documentElement.style.fontSize=`${size}px`,rootSize);
 await page.getByText("explore a complete example").click();const filter=page.locator("#site-filter");
 await expect(filter).toBeVisible();expect(await filter.evaluate(e=>parseFloat(getComputedStyle(e).fontSize))).toBeGreaterThanOrEqual(rootSize);
 await filter.fill("Dublin");await expect(page.locator(".site-row-select")).toHaveCount(1);await expect(page.locator(".site-row-select")).toContainText("Dublin");
 await page.keyboard.press("Escape");await expect(filter).toHaveValue("");await expect(page.locator(".site-row-select")).toHaveCount(3);
 await page.screenshot({path:testInfo.outputPath("site-filter.png")});
});

test("a missing hidden site field falls back to the summary and can recover",async({page})=>{
 await page.goto("/");await page.getByText("explore a complete example").click();await page.locator("#tab-addressing").click();await page.locator("#add-vlan-address").click();
 const form=page.locator("#vlan-form");await form.locator('[name="name"]').fill("Recovered VLAN");
 // Model stale form data without changing the design or calling the error helper directly.
 const site=await form.locator('[name="siteId"]').elementHandle();
 await site.evaluate(select=>{const hidden=document.createElement("input");hidden.name="siteId";hidden.type="hidden";hidden.value="missing-site";select.replaceWith(hidden)});
 await submit(page,"#vlan-submit");await expect(page.locator("#vlan-form-error")).toHaveText("The selected site no longer exists");await expect(page.locator("#vlan-form-error")).toBeFocused();
 await expect(form.locator('[name="siteId"]')).not.toHaveAttribute("aria-invalid","true");
 await site.evaluate(select=>document.querySelector('#vlan-form [name="siteId"]').replaceWith(select));await form.locator('[name="siteId"]').dispatchEvent("change");
 await expect(page.locator("#vlan-form-error")).toBeEmpty();await expect(form.locator('[name="cidr"]')).toHaveAttribute("aria-describedby","vlan-cidr-hint");
 await submit(page,"#vlan-submit");await expect(page.locator("#vlan-dialog")).not.toBeVisible();await expect(page.locator("#address-table")).toContainText("Recovered VLAN");
});
