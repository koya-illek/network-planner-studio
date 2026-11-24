import {test,expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {readFile} from 'node:fs/promises';
const ACTIVE='network-planner-studio.v2',LIBRARY='network-planner-studio.projects.v2',PREFIX='network-planner-studio.pending.v2.',LOCK='network-planner-studio.library-write.v2';
async function seed(page){await page.goto('/');await page.evaluate(()=>localStorage.clear());await page.reload();await page.getByText('explore a complete example').click();await expect(page.locator('#save-state')).toHaveText('Saved locally');}
async function rename(page,name){await page.locator('#project-name-button').click();await page.locator('#name-form input[name=name]').fill(name);await page.locator('#name-form button[type=submit]').click();await page.evaluate(()=>window.dispatchEvent(new Event('pagehide')));}
async function hold(context){const page=await context.newPage();await page.goto('/');await page.evaluate(lock=>{void navigator.locks.request(lock,()=>new Promise(resolve=>{window.releaseSaveLock=resolve;window.saveLockHeld=true}))},LOCK);await page.waitForFunction(()=>window.saveLockHeld);return page;}
async function docs(page){return page.evaluate(key=>Object.values(JSON.parse(localStorage.getItem(key)||'{}')),LIBRARY)}
async function drafts(page){return page.evaluate(prefix=>Object.keys(localStorage).filter(key=>key.startsWith(prefix)).map(key=>JSON.parse(localStorage.getItem(key))),PREFIX)}
test('actual simultaneous writers serialize, retain the loser, and recover it as a separate design',async({page,context})=>{
 await seed(page);const other=await context.newPage();await other.goto('/');const blocker=await hold(context);
 await rename(page,'First writer');await rename(other,'Second writer');await expect.poll(()=>drafts(page).then(rows=>rows.length)).toBe(2);
 await blocker.evaluate(()=>window.releaseSaveLock());
 await expect.poll(()=>docs(page).then(rows=>rows.map(d=>d.name))).toEqual(['First writer']);
 await expect(other.locator('#storage-conflict')).toBeVisible();await expect(other.locator('#storage-recovery')).toContainText('Second writer');
 await expect.poll(()=>drafts(page).then(rows=>rows.some(row=>row.document.name==='Second writer'))).toBe(true);
 await other.getByRole('button',{name:'Save my version as a copy',exact:true}).click();
 await expect.poll(()=>docs(page).then(rows=>rows.map(d=>d.name))).toEqual(expect.arrayContaining(['First writer','Second writer copy']));
 await expect.poll(()=>drafts(page).then(rows=>rows.length)).toBe(0);
});
test('concurrent different designs merge into one library without false conflicts',async({page,context})=>{
 await seed(page);const ids=await page.evaluate(({active,library})=>{const original=JSON.parse(localStorage.getItem(active)),copy={...original,projectId:crypto.randomUUID(),name:'Independent B'};const all=JSON.parse(localStorage.getItem(library));all[copy.projectId]=copy;localStorage.setItem(library,JSON.stringify(all));localStorage.setItem(active,JSON.stringify(copy));return [original.projectId,copy.projectId]},{active:ACTIVE,library:LIBRARY});
 const other=await context.newPage();await other.goto('/');const blocker=await hold(context);
 await rename(page,'Independent A edited');await rename(other,'Independent B edited');await blocker.evaluate(()=>window.releaseSaveLock());
 await expect.poll(()=>docs(page).then(rows=>rows.map(d=>d.name).sort())).toEqual(['Independent A edited','Independent B edited']);
 expect((await docs(page)).map(d=>d.projectId).sort()).toEqual(ids.sort());await expect(page.locator('#storage-conflict')).toHaveCount(0);await expect(other.locator('#storage-conflict')).toHaveCount(0);
});
test('queued close and reopen retains a downloadable draft and explicit copy recovery',async({page,context})=>{
 await seed(page);const blocker=await hold(context);await rename(page,'Closed while queued');await expect.poll(()=>drafts(blocker).then(rows=>rows.some(row=>row.document.name==='Closed while queued'))).toBe(true);
 await page.close();await blocker.evaluate(()=>window.releaseSaveLock());const reopened=await context.newPage();await reopened.goto('/');
 await expect(reopened.locator('#storage-recovery')).toContainText('Closed while queued');expect((await docs(reopened)).map(d=>d.name)).toEqual(['Illek example network']);
 const download=reopened.waitForEvent('download');await reopened.getByRole('button',{name:'Download recovery',exact:true}).click();const recovered=JSON.parse(await readFile(await (await download).path(),'utf8'));expect(recovered.name).toBe('Closed while queued');
 expect((await new AxeBuilder({page:reopened}).include('#storage-recovery').analyze()).violations).toEqual([]);
 await reopened.getByRole('button',{name:'Recover as copy',exact:true}).click();await expect.poll(()=>docs(reopened).then(rows=>rows.map(d=>d.name))).toEqual(expect.arrayContaining(['Illek example network','Closed while queued recovered copy']));
 await expect(reopened.locator('#storage-recovery')).toHaveCount(0);
});
test('queued revisions and duplicate navigation preserve latest state and active pointer',async({page,context})=>{
 await seed(page);const original=await page.evaluate(key=>JSON.parse(localStorage.getItem(key)).projectId,ACTIVE);const blocker=await hold(context);
 await rename(page,'Queued first');await rename(page,'Queued latest');await page.locator('#utility-menu summary').click();await page.locator('#projects-button').click();await page.locator('#duplicate-project').click();
 await expect(page.locator('#project-name-button')).toContainText('Queued latest copy');await blocker.evaluate(()=>window.releaseSaveLock());
 await expect.poll(()=>docs(page).then(rows=>rows.map(d=>d.name).sort())).toEqual(['Queued latest','Queued latest copy']);
 await expect.poll(()=>page.evaluate(key=>JSON.parse(localStorage.getItem(key)).name,ACTIVE)).toBe('Queued latest copy');
 expect((await docs(page)).find(d=>d.projectId===original).name).toBe('Queued latest');await expect.poll(()=>drafts(page).then(rows=>rows.length)).toBe(0);
});
test('without Web Locks changes remain in recovery rather than writing shared storage',async({page})=>{
 await seed(page);const baseline=await page.evaluate(key=>localStorage.getItem(key),LIBRARY);await page.addInitScript(()=>Object.defineProperty(navigator,'locks',{configurable:true,value:undefined}));await page.reload();await rename(page,'Unsupported draft');
 await expect(page.locator('#save-state')).toContainText('Storage needs recovery');await expect(page.locator('#storage-recovery')).toContainText('Unsupported draft');expect(await page.evaluate(key=>localStorage.getItem(key),LIBRARY)).toBe(baseline);
 const download=page.waitForEvent('download');await page.getByRole('button',{name:'Download recovery',exact:true}).click();expect(JSON.parse(await readFile(await(await download).path(),'utf8')).name).toBe('Unsupported draft');
});
test('corrupt recovery stays downloadable until explicitly discarded',async({page})=>{
 await seed(page);await page.evaluate(prefix=>localStorage.setItem(prefix+'broken','{unreadable'),PREFIX);await page.reload();await expect(page.locator('#storage-recovery')).toContainText('Unreadable recovery draft');
 const download=page.waitForEvent('download');await page.getByRole('button',{name:'Download recovery',exact:true}).click();expect(await readFile(await(await download).path(),'utf8')).toBe('{unreadable');
 page.once('dialog',dialog=>dialog.accept());await page.getByRole('button',{name:'Discard draft',exact:true}).click();await expect(page.locator('#storage-recovery')).toHaveCount(0);expect((await docs(page)).length).toBe(1);
});
test('partial active-pointer failure retains library work and reload cannot silently overwrite it',async({page})=>{
 await seed(page);await page.evaluate(active=>{const set=Storage.prototype.setItem;Storage.prototype.setItem=function(key,value){if(key===active)throw new Error('pointer failure');return set.call(this,key,value)}},ACTIVE);
 await rename(page,'Library committed before pointer failed');await expect(page.locator('#save-state')).toHaveText('Storage needs recovery');await expect.poll(()=>docs(page).then(rows=>rows[0].name)).toBe('Library committed before pointer failed');await expect(page.locator('#storage-recovery')).toContainText('Library committed before pointer failed');
 await page.reload();await expect(page.locator('#storage-conflict')).toBeVisible();await page.evaluate(()=>window.dispatchEvent(new Event('pagehide')));expect((await docs(page))[0].name).toBe('Library committed before pointer failed');
 await page.getByRole('button',{name:'Reload latest',exact:true}).click();await expect(page.locator('#project-name-button')).toContainText('Library committed before pointer failed');
});
test('editing before resolving startup recovery durably preserves both draft variants',async({page,context})=>{
 await seed(page);await page.evaluate(({active,prefix})=>{const document={...JSON.parse(localStorage.getItem(active)),name:'Earlier unfinished draft'};localStorage.setItem(prefix+'earlier.'+document.projectId,JSON.stringify({format:'network-planner-pending.v1',document}))},{active:ACTIVE,prefix:PREFIX});await page.reload();await rename(page,'New edits during recovery');
 await expect.poll(()=>drafts(page).then(rows=>rows.map(row=>row.document.name).sort())).toEqual(['Earlier unfinished draft','New edits during recovery']);expect((await docs(page))[0].name).toBe('Illek example network');await page.close();
 const reopened=await context.newPage();await reopened.goto('/');await expect(reopened.locator('#storage-recovery')).toContainText('Earlier unfinished draft');await expect(reopened.locator('#storage-recovery')).toContainText('New edits during recovery');
});
test('denied library reads cannot be mistaken for an empty library and overwritten',async({page})=>{
 await seed(page);const baseline=await page.evaluate(key=>localStorage.getItem(key),LIBRARY);
 await page.evaluate(key=>{const get=Storage.prototype.getItem;window.readOriginalLibrary=()=>get.call(localStorage,key);Storage.prototype.getItem=function(name){if(name===key)throw new Error('read denied');return get.call(this,name)}},LIBRARY);
 await rename(page,'Read failure draft');await expect(page.locator('#save-state')).toHaveText('Storage needs recovery');await expect(page.locator('#storage-recovery')).toContainText('Read failure draft');expect(await page.evaluate(()=>window.readOriginalLibrary())).toBe(baseline);
});
test('a corrupt library is not replaced when its quarantine copy cannot be retained',async({page})=>{
 await seed(page);await page.evaluate(key=>{localStorage.setItem(key,'{corrupt original');const set=Storage.prototype.setItem;Storage.prototype.setItem=function(name,value){if(name===key+'.unreadable')throw new Error('quarantine denied');return set.call(this,name,value)}},LIBRARY);
 await rename(page,'Quarantine failure draft');await expect(page.locator('#save-state')).toHaveText('Storage needs recovery');await expect(page.locator('#storage-recovery')).toContainText('Quarantine failure draft');expect(await page.evaluate(key=>localStorage.getItem(key),LIBRARY)).toBe('{corrupt original');
});

test('discard reviewed draft cannot remove a concurrently journalled newer revision',async({page,context})=>{
 await seed(page);
 const blocker=await context.newPage();await blocker.goto('/');await blocker.evaluate(lock=>{void navigator.locks.request(lock,()=>new Promise(resolve=>{window.releaseLock=resolve;window.held=true}))},LOCK);await blocker.waitForFunction(()=>window.held);
 await rename(page,'Reviewed draft');
 const reviewer=await context.newPage();await reviewer.goto('/');await expect(reviewer.locator('#storage-recovery')).toContainText('Reviewed draft');
 const client=await context.newCDPSession(reviewer);await client.send('Debugger.enable');
 const source=await readFile('public/persistence.js','utf8');const line=source.split('\n').findIndex(l=>l.includes('storage.removeItem(key);recoveryKeys.delete(key)'));
 await client.send('Debugger.setBreakpointByUrl',{urlRegex:'/persistence\\.js',lineNumber:line});
 const paused=new Promise(resolve=>client.once('Debugger.paused',resolve));reviewer.once('dialog',dialog=>dialog.accept());const click=reviewer.getByRole('button',{name:'Discard draft',exact:true}).click();await paused;
 try{await rename(page,'Newer draft must survive');}finally{await client.send('Debugger.resume');}
 await click;await client.detach();
 const names=await page.evaluate(prefix=>Object.keys(localStorage).filter(key=>key.startsWith(prefix)).map(key=>JSON.parse(localStorage.getItem(key)).document.name),PREFIX);
 expect(names).toContain('Newer draft must survive');
 await blocker.evaluate(()=>window.releaseLock());
});

test('open recovery view discovers drafts created later in a different tab',async({page,context})=>{
 await seed(page);const reviewer=await context.newPage();await reviewer.goto('/');await expect(reviewer.locator('#storage-recovery')).toHaveCount(0);
 const blocker=await hold(context);await rename(page,'Created after reviewer opened');
 await expect(reviewer.locator('#storage-recovery')).toContainText('Created after reviewer opened');
 await page.close();await blocker.evaluate(()=>window.releaseSaveLock());
 await expect(reviewer.locator('#storage-recovery')).toContainText('Created after reviewer opened');
});
test('opening recovery cannot abandon current edits when their journal write is refused',async({page,context})=>{
 await seed(page);const currentId=await page.evaluate(key=>JSON.parse(localStorage.getItem(key)).projectId,ACTIVE),other=await context.newPage();await other.goto('/');
 await other.evaluate(({active,prefix})=>{const document={...JSON.parse(localStorage.getItem(active)),projectId:'foreign-recovery',name:'Another unfinished design'};localStorage.setItem(prefix+'foreign.1.foreign-recovery',JSON.stringify({format:'network-planner-pending.v1',document}))},{active:ACTIVE,prefix:PREFIX});
 await expect(page.locator('#storage-recovery')).toContainText('Another unfinished design');
 await page.evaluate(({prefix,id})=>{const set=Storage.prototype.setItem;Storage.prototype.setItem=function(key,value){if(key.startsWith(prefix)&&key.endsWith('.'+id))throw new Error('current draft denied');return set.call(this,key,value)}},{prefix:PREFIX,id:currentId});
 await page.locator('#project-name-button').click();await page.locator('#name-form input[name=name]').fill('Current edit exists only in memory');await page.locator('#name-form button[type=submit]').click();await expect(page.locator('#save-state')).toHaveText('Storage needs recovery');await expect(page.locator('#project-name-button')).toHaveText('Current edit exists only in memory');
 await page.locator('#storage-recovery li').filter({hasText:'Another unfinished design'}).getByRole('button',{name:'Recover as copy',exact:true}).click();
 await expect(page.locator('#project-name-button')).toHaveText('Current edit exists only in memory');expect((await docs(page)).find(doc=>doc.projectId===currentId).name).toBe('Illek example network');await expect(page.locator('#storage-recovery')).toContainText('Another unfinished design');
});
