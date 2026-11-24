import test from 'node:test';
import assert from 'node:assert/strict';
import {createPersistence,DRAFT_PREFIX} from '../public/persistence.js';
function fixture({locks,storage:provided}={}){
  const data=new Map();
  const storage=provided||{get length(){return data.size},key:i=>[...data.keys()][i],getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v),removeItem:k=>data.delete(k)};
  const statuses=[],conflicts=[];let current='a',serial=0;
  const make=(writer,custom={})=>createPersistence({storage,locks:locks??{request:(_,run)=>Promise.resolve().then(run)},id:()=>writer,
    readLibrary:()=>JSON.parse(storage.getItem('library')||'{}'),writeLibrary:lib=>{storage.setItem('library',JSON.stringify(lib));return true},
    writeActive:doc=>{storage.setItem('active',JSON.stringify(doc));return true},validate:doc=>{if(!doc?.projectId)throw new Error('invalid');return doc},
    currentId:()=>current,onStatus:t=>statuses.push(t),onConflict:d=>conflicts.push(d),...custom});
  return {storage,data,statuses,conflicts,make,setCurrent:id=>{current=id},draft:name=>({projectId:'a',name,revision:++serial})};
}
test('one immutable queued snapshot cannot consume the newer revision journal',async()=>{
  const callbacks=[];const f=fixture({locks:{request:(_,run)=>new Promise(resolve=>callbacks.push(()=>resolve(run())))}}),p=f.make('writer');
  p.observe('a','null');const doc=f.draft('first');const first=p.enqueue(doc),firstKey=p.ownDraft('a').key;doc.name='mutated after enqueue';assert.equal(JSON.parse(f.storage.getItem(firstKey)).document.name,'first');const second=p.enqueue(f.draft('latest'));
  assert.notEqual(p.ownDraft('a').key,firstKey);
  await new Promise(setImmediate);callbacks.shift()();assert.equal((await first).cancelled,true);
  assert.equal(f.storage.getItem('library'),null);assert.equal(JSON.parse(f.storage.getItem(p.ownDraft('a')?.key)).document.name,'latest');
  await new Promise(setImmediate);callbacks.shift()();await second;
  assert.equal(JSON.parse(f.storage.getItem('library')).a.name,'latest');assert.equal([...f.data.keys()].filter(key=>key.startsWith(DRAFT_PREFIX)).length,0);
});
test('competing saves retain both versions instead of replacing the winner',async()=>{
  const f=fixture(),a=f.make('a'),b=f.make('b');a.observe('a','null');b.observe('a','null');
  assert.equal((await a.enqueue(f.draft('winner'))).ok,true);assert.equal((await b.enqueue(f.draft('conflict'))).conflict,true);
  assert.equal(JSON.parse(f.storage.getItem('library')).a.name,'winner');assert.equal(b.recoveries()[0].document.name,'conflict');
});
test('different projects merge into the latest library and old selections cannot take over active state',async()=>{
  const f=fixture(),p=f.make('writer');f.setCurrent('b');
  await p.enqueue({projectId:'a',name:'A'});await p.enqueue({projectId:'b',name:'B'});
  assert.equal(Object.keys(JSON.parse(f.storage.getItem('library'))).length,2);assert.equal(JSON.parse(f.storage.getItem('active')).name,'B');
});
test('journal failure never queues an unsafe shared-library write',async()=>{
  const f=fixture(),base=f.storage;const p=f.make('writer',{storage:{...base,setItem(){throw new Error('quota')}}});
  const result=await p.enqueue(f.draft('unsaved'));assert.equal(result.ok,false);assert.match(result.error.message,/Export a recovery copy/);assert.equal(f.storage.getItem('library'),null);
});
test('library failure preserves a durable recovery and never claims saved',async()=>{
  const f=fixture(),p=f.make('writer',{writeLibrary:()=>false});
  assert.equal((await p.enqueue(f.draft('pending'))).ok,false);assert.equal(p.recoveries()[0].document.name,'pending');assert.ok(!f.statuses.includes('Saved locally'));
});
test('active-pointer failure keeps recoverable state even after the library commits',async()=>{
  const f=fixture(),p=f.make('writer',{writeActive:()=>false});
  assert.equal((await p.enqueue(f.draft('library only'))).ok,false);assert.equal(JSON.parse(f.storage.getItem('library')).a.name,'library only');assert.equal(p.recoveries()[0].document.name,'library only');
});
test('unsupported locking keeps a recovery draft without writing the library',async()=>{
  const f=fixture(),p=f.make('writer',{locks:{}});const result=await p.enqueue(f.draft('unsupported'));
  assert.equal(result.ok,false);assert.match(result.error.message,/cannot safely save across tabs/);assert.equal(f.storage.getItem('library'),null);assert.equal(p.recoveries().length,1);
});
test('explicit discard cannot erase a newer recovery from another tab',()=>{
  const f=fixture();const key=DRAFT_PREFIX+'other.a';f.storage.setItem(key,JSON.stringify({format:'network-planner-pending.v1',document:{projectId:'a',name:'old'}}));
  const p=f.make('writer'),row=p.recoveries()[0];f.storage.setItem(key,JSON.stringify({format:'network-planner-pending.v1',document:{projectId:'a',name:'new'}}));
  assert.throws(()=>p.discard(row.key,row.raw),/changed/);assert.equal(p.recoveries()[0].document.name,'new');
});
test('malformed journals remain downloadable and are not mistaken for valid designs',()=>{
  const f=fixture(),key=DRAFT_PREFIX+'broken';f.storage.setItem(key,'{broken');const p=f.make('writer');assert.equal(p.recoveries()[0].raw,'{broken');assert.ok(p.recoveries()[0].error);assert.equal(f.storage.getItem(key),'{broken');
});
test('reserved-looking project ids are own JSON properties, not prototype mutations',async()=>{
 const f=fixture(),p=f.make('writer');for(const projectId of ['__proto__','constructor'])assert.equal((await p.enqueue({projectId,name:projectId})).ok,true);
 const library=JSON.parse(f.storage.getItem('library'));assert.equal(Object.prototype.hasOwnProperty.call(library,'__proto__'),true);assert.equal(library.__proto__.name,'__proto__');assert.equal(library.constructor.name,'constructor');
});
test('recovering a reviewed draft never deletes a newer source draft',async()=>{
 const f=fixture(),key=DRAFT_PREFIX+'old.a';f.storage.setItem(key,JSON.stringify({format:'network-planner-pending.v1',document:{projectId:'a',name:'old'}}));const p=f.make('writer'),row=p.recoveries()[0];
 f.storage.setItem(key,JSON.stringify({format:'network-planner-pending.v1',document:{projectId:'a',name:'newer'}}));const result=await p.enqueue({projectId:'copy',name:'recovered'},{recovery:row});
 assert.equal(result.ok,true);assert.equal(result.recoveryRetained,true);assert.equal(p.recoveries()[0].document.name,'newer');assert.equal(JSON.parse(f.storage.getItem('library')).copy.name,'recovered');
});
test('a journal explicitly discarded in another tab cancels its queued writer',async()=>{
 const callbacks=[];const f=fixture({locks:{request:(_,run)=>new Promise(resolve=>callbacks.push(()=>resolve(run())))}}),p=f.make('writer');const save=p.enqueue(f.draft('discarded'));
 await new Promise(setImmediate);f.storage.removeItem(p.ownDraft('a').key);callbacks.shift()();assert.equal((await save).cancelled,true);assert.equal(f.storage.getItem('library'),null);assert.equal(p.pendingDocuments().length,0);
});

test('discard interleaved with a new journal cannot erase that newer revision',async()=>{
 const callbacks=[];const f=fixture({locks:{request:(_,run)=>new Promise(resolve=>callbacks.push(()=>resolve(run())))}}),writer=f.make('writer');
 writer.enqueue(f.draft('reviewed'));const reviewer=f.make('reviewer'),row=reviewer.recoveries()[0];
 const storage=f.storage,get=storage.getItem;let interleaved=false;
 storage.getItem=key=>{const raw=get(key);if(key===row.key&&!interleaved){interleaved=true;writer.enqueue(f.draft('newer'))}return raw};
 reviewer.discard(row.key,row.raw);
 assert.equal(JSON.parse(get(writer.ownDraft('a').key)).document.name,'newer');
 assert.equal(reviewer.recoveries()[0].document.name,'newer');
});
test('already open tabs discover newly created foreign drafts and forget removed ones',async()=>{
 const f=fixture({locks:{request:()=>new Promise(()=>{})}}),reviewer=f.make('reviewer'),writer=f.make('writer');
 assert.equal(reviewer.recoveries().length,0);writer.enqueue(f.draft('created later'));
 assert.equal(reviewer.recoveries()[0].document.name,'created later');
 const row=reviewer.recoveries()[0];reviewer.discard(row.key,row.raw);assert.equal(reviewer.recoveries().length,0);
});
test('a failed replacement journal keeps the previously durable revision intact',async()=>{
 const f=fixture({locks:{request:()=>new Promise(()=>{})}}),p=f.make('writer');p.enqueue(f.draft('previous durable'));
 const previous=p.ownDraft('a'),set=f.storage.setItem;f.storage.setItem=(key,value)=>{if(key!==previous.key&&key.startsWith(DRAFT_PREFIX))throw new Error('quota');return set(key,value)};
 const result=await p.enqueue(f.draft('newer in memory'));assert.equal(result.ok,false);assert.equal(p.ownDraft('a').key,previous.key);assert.equal(f.storage.getItem(previous.key),previous.raw);assert.equal(f.storage.getItem('library'),null);
});
