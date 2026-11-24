import {test,expect} from '@playwright/test';
import {mkdir} from 'node:fs/promises';
for(const width of [320,390,768,1440])test(`live critique: example geometry, context and downstream paths ${width}`,async({page},testInfo)=>{
  const evidence=process.env.IMPECCABLE_EVIDENCE_DIR || testInfo.outputPath('critique');
  await mkdir(evidence,{recursive:true});
  await page.setViewportSize({width,height:1000});await page.goto('/');await page.getByText('explore a complete example').click();
  await expect(page.locator('#project-name-button')).toBeVisible();await expect(page.locator('#save-state')).toBeVisible();
  for(const tab of await page.locator('.view-tabs button').all()){
    const b=await tab.boundingBox();expect(b.x).toBeGreaterThanOrEqual(0);expect(b.x+b.width).toBeLessThanOrEqual(width+1);
  }
  const boxes=await page.locator('.topology-node').evaluateAll(nodes=>nodes.map(n=>{const b=n.getBoundingClientRect();return{x:b.x,y:b.y,right:b.right,bottom:b.bottom}}));
  for(let a=0;a<boxes.length;a++)for(let b=a+1;b<boxes.length;b++)expect(boxes[a].right<=boxes[b].x||boxes[b].right<=boxes[a].x||boxes[a].bottom<=boxes[b].y||boxes[b].bottom<=boxes[a].y).toBeTruthy();
  const endpoints=await page.evaluate(()=>{
    const path=[...document.querySelectorAll('.link-hit')].find(p=>p.getAttribute('aria-label').startsWith('Cork HQ to Dublin office'));
    const start=path.getAttribute('d').match(/^M ([\d.]+) ([\d.]+)/).slice(1).map(Number);
    const node=document.querySelector('.topology-node[data-site="hq"]');
    return {start,center:[parseFloat(node.style.left)+node.offsetWidth/2,parseFloat(node.style.top)+node.offsetHeight/2]};
  });
  expect(Math.abs(endpoints.start[0]-endpoints.center[0])).toBeLessThan(1);expect(Math.abs(endpoints.start[1]-endpoints.center[1])).toBeLessThan(1);
  await page.screenshot({path:`${evidence}/topology-${width}.png`,fullPage:true});
  const node=page.locator('.topology-node').first(),before=await node.boundingBox(),canvas=await page.locator('#canvas').boundingBox();
  await page.mouse.move(before.x+20,before.y+20);await page.mouse.down();await page.mouse.move(before.x+30,canvas.y+canvas.height-2,{steps:8});
  await page.locator('#canvas').dispatchEvent('pointercancel',{pointerId:1});await page.mouse.up();
  const cancelled=await node.boundingBox();expect(Math.abs(cancelled.y-before.y)).toBeLessThan(2);
  await page.mouse.move(cancelled.x+20,cancelled.y+20);await page.mouse.down();await page.mouse.move(cancelled.x+20,canvas.y+canvas.height-2,{steps:8});await page.mouse.up();
  let moved=await node.boundingBox();expect(moved.y+moved.height).toBeLessThanOrEqual(canvas.y+canvas.height-6);
  await page.locator('#tab-policy').click();await page.locator('#tab-topology').click();
  moved=await node.boundingBox();expect(moved.y+moved.height).toBeLessThanOrEqual(canvas.y+canvas.height-6);
  await page.setViewportSize({width:width===320?390:320,height:1000});await page.waitForTimeout(100);await page.setViewportSize({width,height:1000});await page.waitForTimeout(100);
  const restored=await node.boundingBox(),resizedCanvas=await page.locator('#canvas').boundingBox();expect(restored.y+restored.height).toBeLessThanOrEqual(resizedCanvas.y+resizedCanvas.height-6);
  await page.locator('#tab-report').click();await page.screenshot({path:`${evidence}/report-${width}.png`,fullPage:true});
  if(width===1440)await page.pdf({path:`${evidence}/report-a4.pdf`,format:'A4',printBackground:true});
});
