import {exampleDesign} from '../public/network-core.js';
import {readFileSync} from 'node:fs';
const baselineGeometry=JSON.parse(readFileSync(new URL('./fixtures/topology-default-geometry.json',import.meta.url))).viewports;
import {writeFile} from 'node:fs/promises';
import {test,expect} from '@playwright/test';
async function geometry(page){
 const result=await page.locator('.topology-node').evaluateAll(nodes=>nodes.map(n=>{const r=n.getBoundingClientRect();return{id:n.dataset.site,left:r.left,top:r.top,right:r.right,bottom:r.bottom,overflow:n.scrollWidth-n.clientWidth}}));
 for(const a of result){expect(a.overflow).toBeLessThanOrEqual(1);for(const b of result)if(a.id!==b.id)expect(a.right<=b.left||b.right<=a.left||a.bottom<=b.top||b.bottom<=a.top).toBeTruthy()}
 expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(await page.evaluate(()=>innerWidth));
 const labelCollisions=await page.evaluate(()=>{const nodes=[...document.querySelectorAll('.topology-node')].map(n=>n.getBoundingClientRect());return [...document.querySelectorAll('.link-label')].flatMap(n=>{const r=n.getBoundingClientRect();return nodes.some(b=>r.left<b.right&&r.right>b.left&&r.top<b.bottom&&r.bottom>b.top)?[{label:n.textContent,rect:r.toJSON()}]:[]})});
 expect(labelCollisions).toEqual([]);
 const bounds=await page.evaluate(()=>({canvas:document.querySelector('#canvas').getBoundingClientRect().bottom,view:document.querySelector('#topology-view').getBoundingClientRect().bottom}));expect(bounds.canvas).toBeLessThanOrEqual(bounds.view+1);
 return result;
}
for(const width of [320,390,1440])for(const hasTouch of [false,true])test.describe(`enlarged topology ${width} ${hasTouch?'coarse':'fine'}`,()=>{
 test.use({viewport:{width,height:1000},hasTouch});
 test('readable data, collision layout, Fit, resize, tab return and cancel',async({page},info)=>{
  await page.goto('/');await page.evaluate(()=>document.documentElement.style.fontSize='32px');await page.getByText('explore a complete example').click();
  await geometry(page);
  const controls=await page.locator('.canvas-toolbar button:visible').evaluateAll(nodes=>nodes.map(n=>{const b=n.getBoundingClientRect();return{x:b.x,right:b.right,y:b.y,bottom:b.bottom}}));
  for(const a of controls){expect(a.x).toBeGreaterThanOrEqual(0);expect(a.right).toBeLessThanOrEqual(width+1);for(const b of controls)if(a!==b)expect(a.right<=b.x||b.right<=a.x||a.bottom<=b.y||b.bottom<=a.y).toBeTruthy()}
  if(await page.locator('#zoom-fit').isVisible())await page.locator('#zoom-fit').click();else{await page.locator('#canvas').focus();await page.keyboard.press('0')}await geometry(page);
  const node=page.locator('.topology-node').first();await node.scrollIntoViewIfNeeded();const before=await node.boundingBox();
  await node.dispatchEvent('pointerdown',{pointerId:91,pointerType:'mouse',button:0,buttons:1,clientX:before.x+20,clientY:before.y+20});
  await page.locator('#canvas').dispatchEvent('pointermove',{pointerId:91,pointerType:'mouse',buttons:1,clientX:before.x+40,clientY:before.y+40});
  const displaced=await node.boundingBox();expect(Math.abs(displaced.x-before.x)+Math.abs(displaced.y-before.y)).toBeGreaterThan(3);
  await page.locator('#canvas').dispatchEvent('pointercancel',{pointerId:91,pointerType:'mouse'});
  const cancelled=await node.boundingBox();expect(Math.abs(cancelled.x-before.x)).toBeLessThan(2);expect(Math.abs(cancelled.y-before.y)).toBeLessThan(2);
  await node.focus();await page.keyboard.press('ArrowRight');await geometry(page);
  await page.locator('#tab-policy').click();await page.locator('#tab-topology').click();await geometry(page);
  await page.setViewportSize({width:width===320?390:320,height:1000});await page.waitForTimeout(100);await geometry(page);
  await page.setViewportSize({width,height:1000});await page.waitForTimeout(100);await geometry(page);
  await page.screenshot({path:info.outputPath('root32-topology.png'),fullPage:true});
  if(width===1440){
   for(const item of await page.locator('.vlan-row,.site-row-select').all())expect(await item.evaluate(n=>n.scrollWidth-n.clientWidth)).toBeLessThanOrEqual(1);
  }
 });
});

for(const width of [320,390,768,1440])test(`default geometry matches accepted revision ${width}`,async({browser},info)=>{
 const page=await browser.newPage({viewport:{width,height:1000}});
 await page.goto('/');await page.getByText('explore a complete example').click();
 const candidate=await page.locator('.topology-node').evaluateAll(nodes=>nodes.map(n=>({id:n.dataset.site,left:n.offsetLeft,top:n.offsetTop,width:n.offsetWidth,height:n.offsetHeight})));
 await writeFile(info.outputPath('default-geometry.json'),JSON.stringify({baseline:baselineGeometry[width],candidate},null,2));expect(candidate).toEqual(baselineGeometry[width]);
 await geometry(page);await page.close();
});
for(const width of [320,390,1440])test.describe(`root16 glyphs ${width} coarse`,()=>{test.use({viewport:{width,height:1000},hasTouch:true});test('route labels remain clear of unchanged cards',async({page})=>{await page.goto('/');await page.getByText('explore a complete example').click();await geometry(page)})});
for(const rootSize of [16,32])test(`long site names and full IP addresses at root ${rootSize}`,async({page},info)=>{
 await page.setViewportSize({width:1440,height:1000});await page.goto('/');await page.evaluate(size=>document.documentElement.style.fontSize=`${size}px`,rootSize);await page.getByText('explore a complete example').click();
 const design=exampleDesign();design.sites.push({...design.sites[0],id:'long-ip',name:'Long IP address location',cidr:'192.168.255.0/24',vlans:[],topologyRole:'standalone',hubId:null,x:30,y:40});for(const site of design.sites)site.name='Long infrastructure branch location with extended descriptive operational name '+site.id;
 await page.locator('#file-input').setInputFiles({name:'long-names.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(design))});
 await expect(page.locator('.topology-node strong').first()).toContainText('Long infrastructure');await geometry(page);
 for(const field of await page.locator('.node-copy strong,.node-address').all())expect(await field.evaluate(n=>n.scrollWidth-n.clientWidth)).toBeLessThanOrEqual(1);
 for(const width of [320,390,1440]){await page.setViewportSize({width,height:1000});await page.waitForTimeout(100);await geometry(page)}
 await page.screenshot({path:info.outputPath('long-names.png'),fullPage:true});
});
