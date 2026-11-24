import {test,expect} from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

for(const width of [320,390,768,1440]){
  test(`working views retain actions and scrollable data at ${width}px`,async({page})=>{
    await page.setViewportSize({width,height:1000});
    await page.goto("/");
    await page.getByText("explore a complete example").click();
    for(const [tab,view] of [["addressing","addressing"],["policy","policy"],["report","report"]]){
      await page.locator(`#tab-${tab}`).click();
      const metrics=await page.locator(`#${view}-view .page-view`).evaluate(el=>({left:el.getBoundingClientRect().left,right:el.getBoundingClientRect().right,width:innerWidth}));
      expect(metrics.left).toBeGreaterThanOrEqual(0);
      expect(metrics.right).toBeLessThanOrEqual(metrics.width+1);
      expect((await new AxeBuilder({page}).withTags(["wcag2a","wcag2aa","wcag21aa","wcag22aa"]).analyze()).violations).toEqual([]);
      if(tab==="addressing"){
        for(const id of ["csv-export","add-vlan-address"]){
          const bounds=await page.locator(`#${id}`).boundingBox();
          expect(bounds.x).toBeGreaterThanOrEqual(0);
          expect(bounds.x+bounds.width).toBeLessThanOrEqual(width+1);
        }
        await page.locator("#add-vlan-address").click();
        await expect(page.locator("#vlan-dialog")).toBeVisible();
        await page.keyboard.press("Escape");
      }
      if(tab==="policy"){
        const table=page.getByRole("region",{name:"Traffic policy",exact:true});
        await table.focus();
        const overflow=await table.evaluate(el=>el.scrollWidth>el.clientWidth);
        if(overflow){
          await page.keyboard.press("ArrowRight");
          await expect.poll(()=>table.evaluate(el=>el.scrollLeft)).toBeGreaterThan(0);
        }
        await table.locator("button").last().scrollIntoViewIfNeeded();
        const bounds=await table.locator("button").last().boundingBox();
        expect(bounds.x+bounds.width).toBeLessThanOrEqual(width+1);
      }
      if(tab==="report"){
        await expect(page.locator(".report-kpi").last()).toContainText("Decisions to review");
        await expect(page.locator(".report-kpis")).not.toContainText("network-planner-studio/design");
        await expect(page.getByRole("heading",{name:"Schema and review provenance"})).toBeVisible();
        for(const region of await page.locator(".report-section[role=region]").all()){
          const bounds=await region.boundingBox();
          expect(bounds.x+bounds.width).toBeLessThanOrEqual(width+1);
        }
      }
    }
  });
}

test("recommendations and assumptions do not masquerade as completed checks",async({page})=>{
  await page.goto("/");
  await page.getByText("explore a complete example").click();
  await page.locator("#tab-review").click();
  await expect(page.locator(".review-summary")).toContainText("recommendation");
  const advice=page.locator(".review-item.advice").first();
  await expect(advice.locator(".review-side small")).toHaveText("Recommendation");
  await expect(advice.locator(".review-icon svg")).toBeVisible();
  await expect(page.locator(".review-icon")).not.toHaveText(["✓"]);
});

for(const width of [320,390]){
  test(`readable node cards remain inside the canvas after a bottom-edge drag at ${width}px`,async({page})=>{
    await page.setViewportSize({width,height:844});
    await page.goto("/");
    await page.getByText("explore a complete example").click();
    const node=page.locator(".topology-node").first();
    const box=await node.boundingBox(),canvas=await page.locator("#canvas").boundingBox();
    await page.mouse.move(box.x+20,box.y+20);
    await page.mouse.down();
    await page.mouse.move(box.x+20,canvas.y+canvas.height-2,{steps:8});
    await page.mouse.up();
    const after=await node.boundingBox();
    expect(after.y+after.height).toBeLessThanOrEqual(canvas.y+canvas.height-6);
    await page.locator("#tab-policy").click();
    await page.locator("#tab-topology").click();
    const restored=await node.boundingBox();
    expect(restored.y+restored.height).toBeLessThanOrEqual(canvas.y+canvas.height-6);
  });
}
