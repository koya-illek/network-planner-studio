// Shared library writes are serialized; pending revisions survive page closure.
import {DRAFT_PREFIX,WRITE_LOCK} from './storage-generation.js';
export {DRAFT_PREFIX,WRITE_LOCK} from './storage-generation.js';
export function createPersistence({storage, locks, readLibrary, writeLibrary, writeActive, validate, currentId, onStatus=()=>{}, onConflict=()=>{}, onRecovery=()=>{}, id=()=>crypto.randomUUID()}) {
  const writer=id(), records=new Map(), observed=new Map(), pending=new Map();
  const recoveryKeys=new Set();
  let queue=Promise.resolve(), revision=0;
  try { for(let i=0;i<storage.length;i++){const key=storage.key(i);if(key?.startsWith(DRAFT_PREFIX))recoveryKeys.add(key)} } catch {}
  const snapshot=(library,projectId)=>JSON.stringify(Object.prototype.hasOwnProperty.call(library,projectId)?library[projectId]:null);
  // Journals are immutable by key: another tab can discard a reviewed revision
  // without racing a synchronous newer edit into the same localStorage slot.
  const ownPrefix=DRAFT_PREFIX+writer+'.';
  const keyFor=(projectId,revision)=>ownPrefix+revision+'.'+projectId;
  function observe(projectId,snapshot){
    observed.set(projectId,snapshot);
    records.set(projectId,{expected:snapshot,blocked:false});
  }
  function recoveries(){
    const rows=[];
    // Other tabs may create drafts after this window started. Active own saves
    // stay out of the recovery UI until explicitly retained on failure.
    try{for(let i=0;i<storage.length;i++){const key=storage.key(i);if(key?.startsWith(DRAFT_PREFIX)&&!key.startsWith(ownPrefix))recoveryKeys.add(key)}}catch{}
    for(const key of recoveryKeys){
      let raw;try{raw=storage.getItem(key)}catch{continue}
      if(raw==null){recoveryKeys.delete(key);continue}
      try{
        if(raw.length>10*1024*1024)throw new Error('Draft exceeds the 10 MB design limit. Download it for recovery.');
        const value=JSON.parse(raw);
        if(value.format!=='network-planner-pending.v1')throw new Error('Unrecognised recovery format.');
        rows.push({key,raw,document:validate(value.document)});
      }catch(error){rows.push({key,raw,error:error.message})}
    }
    return rows;
  }
  function notifyRecovery(){onRecovery(recoveries())}
  function retain(job){recoveryKeys.add(job.key);notifyRecovery()}
  function journal(job){
    // Persist the replacement first. Failed cleanup merely leaves an extra
    // recoverable revision; it must never prevent retaining the latest edit.
    storage.setItem(job.key,job.raw);
    const previous=pending.get(job.document.projectId);
    pending.set(job.document.projectId,job);
    if(previous){
      try{storage.removeItem(previous.key);recoveryKeys.delete(previous.key)}catch{}
    }
  }
  function discard(key,raw){
    // Explicit recovery actions may only remove the version the user reviewed.
    if(storage.getItem(key)!==raw)throw new Error('This draft changed in another tab. Review the updated copy first.');
    storage.removeItem(key);recoveryKeys.delete(key);
    for(const [projectId,job] of pending){if(job.key===key&&job.raw===raw){pending.delete(projectId);records.delete(projectId)}}
    notifyRecovery();
  }
  function status(job,text){if(currentId()===job.document.projectId)onStatus(text)}
  function unsupported(){return !locks||typeof locks.request!=='function'}
  function schedule(operation){
    const result=queue.then(()=>{
      if(unsupported())throw new Error('This browser cannot safely save across tabs. Try another browser over HTTPS, or download your recovery copy.');
      return locks.request(WRITE_LOCK,operation);
    });
    queue=result.catch(()=>{});return result;
  }
  function enqueue(document,{recovery=null,keepExisting=false}={}){
    const copy=JSON.parse(JSON.stringify(document)),projectId=copy.projectId;
    if(!records.has(projectId))observe(projectId,snapshot(readLibrary(),projectId));
    const record=records.get(projectId),job={document:copy,record,key:keyFor(projectId,++revision),revision,recovery};
    job.raw=JSON.stringify({format:'network-planner-pending.v1',revision:job.revision,document:copy});
    // Never queue a commit without a durable close/reload recovery copy.
    try{journal(job)}catch{onStatus('Storage needs recovery');return Promise.resolve({ok:false,error:new Error('Browser storage is full or unavailable. Export a recovery copy before continuing.')})}
    status(job,'Saving…');
    const result=schedule(()=>{
      if(record!==records.get(projectId))return {ok:false,cancelled:true};
      if(storage.getItem(job.key)===null){
        if(pending.get(projectId)===job){pending.delete(projectId);status(job,'Recovery draft discarded')}
        return {ok:false,cancelled:true};
      }
      if(record.blocked){retain(job);return {ok:false,conflict:true}}
      const library=readLibrary();
      if(readLibrary.unavailable)throw new Error('The library cannot be read. Export a recovery copy before continuing.');
      const actual=snapshot(library,projectId);
      // Content-addressed legacy imports are idempotent, even after the copy
      // was edited. Another import must never replace that edited design.
      if(keepExisting&&actual!=='null'){
        if(storage.getItem(job.key)===job.raw)storage.removeItem(job.key);
        if(pending.get(projectId)===job)pending.delete(projectId);
        record.expected=actual;observed.set(projectId,actual);recoveryKeys.delete(job.key);notifyRecovery();
        return {ok:true,existing:library[projectId]};
      }
      if(!readLibrary.recovered&&actual!==record.expected){record.blocked=true;retain(job);onConflict(copy);return {ok:false,conflict:true}}
      Object.defineProperty(library,projectId,{value:copy,enumerable:true,writable:true,configurable:true});
      if(!writeLibrary(library))throw new Error('The library could not be saved. Download the recovery copy before leaving.');
      record.expected=JSON.stringify(copy);observed.set(projectId,record.expected);
      // Older queued projects must not take over the current-document pointer.
      if(currentId()===projectId&&!writeActive(copy))throw new Error('The design is in your library, but this browser could not remember it as the current design. Keep a recovery copy.');
      if(storage.getItem(job.key)===job.raw)storage.removeItem(job.key);
      if(pending.get(projectId)===job){pending.delete(projectId);status(job,'Saved locally')}
      if(job.recovery){
        try{discard(job.recovery.key,job.recovery.raw)}catch{notifyRecovery();return {ok:true,recoveryRetained:true}}
      }
      recoveryKeys.delete(job.key);notifyRecovery();return {ok:true};
    }).catch(error=>{retain(job);status(job,'Storage needs recovery');return {ok:false,error}});
    return result;
  }
  function protect(document){
    const copy=JSON.parse(JSON.stringify(document)),projectId=copy.projectId;
    if(!records.has(projectId))observe(projectId,snapshot(readLibrary(),projectId));
    const record=records.get(projectId);record.blocked=true;
    const job={document:copy,record,key:keyFor(projectId,++revision),revision};
    job.raw=JSON.stringify({format:'network-planner-pending.v1',revision:job.revision,document:copy});
    try{journal(job);retain(job)}catch{onStatus('Storage needs recovery')}
  }
  function mutate(operation){return schedule(()=>{const library=readLibrary();if(readLibrary.unavailable)throw new Error('The library cannot be read. No change was made.');const result=operation(library);if(!writeLibrary(library))throw new Error('The library could not be saved.');return result})}
  function discardOwn(projectId){
    const job=pending.get(projectId);if(job){discard(job.key,job.raw);pending.delete(projectId)}
    records.delete(projectId);
  }
  return {observed,observe,enqueue,protect,mutate,discardOwn,recoveries,discard,notifyRecovery,
    isBlocked:projectId=>records.get(projectId)?.blocked===true,
    hasRecovery:projectId=>recoveries().some(row=>row.document?.projectId===projectId),
    pendingDocuments:()=>[...pending.values()].map(job=>job.document),
    pendingDocument:projectId=>pending.get(projectId)?.document,
    ownDraft:projectId=>{const job=pending.get(projectId);return job?{key:job.key,raw:job.raw}:null},
    idle:()=>queue};
}
