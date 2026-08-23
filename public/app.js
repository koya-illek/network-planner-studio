import {SCHEMA_ID,SCHEMA_VERSION,ENUMS,parseCidr,parseRoutePrefix,rangesOverlap,contains,firstUsable,endpointCapacity,defaultDhcpPool,validateGateway,validateDhcpPool,prefixForDevices,nextSubnet,suggestSiteRange as suggestSiteRangeCore,isPrivateCidr,isPrivateRoutePrefix,guardCsvCell,unguardCsvCell,parseCsvRows,shortestPath,migrateDesign,createSite,createVlan,createLink} from "./network-core.js";

const STORAGE_KEY = "network-planner-studio.v1";
const LIBRARY_KEY = "network-planner-studio.projects.v1";
const LIBRARY_LIMIT = 20;
const IMPORT_MAX_BYTES = 10 * 1024 * 1024;
const prefersReducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
const TYPE_ICONS = {office:"OF",branch:"BR",datacentre:"DC",cloud:"CL",warehouse:"WH"};
const INSPECTOR_CLOSE = `<button class="button ghost inspector-close" data-inspector-close type="button" aria-label="Close inspector">×</button>`;
const $ = (selector, root=document) => root.querySelector(selector);
const $$ = (selector, root=document) => [...root.querySelectorAll(selector)];
const uid = () => crypto.randomUUID();

let storageIssue = "";
function storageGet(key) {
  try { return localStorage.getItem(key); }
  catch { storageIssue = "Browser storage is unavailable. Export a recovery copy before leaving this page."; return null; }
}
function storageSet(key, value) {
  try { localStorage.setItem(key, value); return true; }
  catch { storageIssue = "Browser storage is full or unavailable. Export a recovery copy before continuing."; return false; }
}
let state = loadState() || blankState();
let selected = null;
let currentTool = "select";
let drag = null;
let traceTimer = null;
let pendingRecommendation = null;
let editingSiteId = null;
let editingVlanId = null;
let editingLinkId = null;
let undoStack = [];
let redoStack = [];
let canvasZoom = 1;
let canvasPan = {x:0,y:0};
let panDrag = null;
let canvasDirty = false;
let activePointers = new Map();
let pinch = null;
let nudgeBurst = {siteId:null,at:0};

function blankState() {
  return {schema:SCHEMA_ID,version:SCHEMA_VERSION,projectId:uid(),name:"Untitled network",mode:null,topologyMode:"custom",policies:{spokeToSpoke:"via-hub",centralizedInspection:false,secondaryHubId:null},flowPolicies:{},assumptions:[],sites:[],links:[],updatedAt:new Date().toISOString()};
}

function sampleState() {
  const hq=uid(), branch=uid(), cloud=uid();
  return {
    schema:SCHEMA_ID,version:SCHEMA_VERSION,projectId:uid(),name:"Illek example network",mode:"sample",topologyMode:"hub-spoke",policies:{spokeToSpoke:"via-hub",centralizedInspection:true,secondaryHubId:null},flowPolicies:{},assumptions:["Cork HQ provides transit and centralized inspection."],updatedAt:new Date().toISOString(),
    sites:[
      {id:hq,name:"Cork HQ",type:"office",cidr:"10.20.0.0/16",devices:180,wan:"dual",growth:30,x:42,y:40,topologyRole:"hub",hubId:null,internetBreakout:"local",notes:"Primary network hub.",vlans:[
        vlan("Staff",10,"users",100,"10.20.10.0/25"),vlan("Voice",20,"voice",80,"10.20.20.0/25"),vlan("Guest",30,"guest",120,"10.20.30.0/24"),vlan("Management",99,"management",22,"10.20.99.0/27")
      ]},
      {id:branch,name:"Dublin office",type:"branch",cidr:"10.30.0.0/16",devices:70,wan:"single",growth:30,x:70,y:20,topologyRole:"spoke",hubId:hq,internetBreakout:"hub",notes:"",vlans:[
        vlan("Staff",10,"users",52,"10.30.10.0/26"),vlan("Voice",20,"voice",45,"10.30.20.0/26"),vlan("Guest",30,"guest",70,"10.30.30.0/25")
      ]},
      {id:cloud,name:"Azure production",type:"cloud",cidr:"10.80.0.0/16",devices:40,wan:"none",growth:50,x:42,y:72,topologyRole:"spoke",hubId:hq,internetBreakout:"hub",notes:"",vlans:[
        vlan("Applications",40,"servers",28,"10.80.10.0/26"),vlan("Private endpoints",50,"servers",18,"10.80.20.0/27")
      ]}
    ],
    links:[
      {id:uid(),from:hq,to:branch,type:"vpn",resilience:"dual",routingType:"bgp",transitAllowed:true,defaultRoute:true,advertisedPrefixes:[],notes:"Primary branch path."},
      {id:uid(),from:hq,to:cloud,type:"vpn",resilience:"single",routingType:"bgp",transitAllowed:true,defaultRoute:false,advertisedPrefixes:[],notes:"Cloud application path."}
    ]
  };
}

function vlan(name,vid,role,devices,cidr){const pool=defaultDhcpPool(cidr,1);return createVlan({id:uid(),name,vid,role,devices,cidr,gateway:firstUsable(cidr),dhcpEnabled:role!=="servers",reserved:1,dhcpStart:pool.start,dhcpEnd:pool.end,notes:"",siteCidr:"10.0.0.0/8"})}

function suggestSiteRange(devices=50){
  return suggestSiteRangeCore(state.sites.map(s=>s.cidr).filter(Boolean),devices);
}
// An unreadable stored blob is quarantined before any later save can overwrite
// it, so one corrupt byte can no longer erase the whole local library.
function quarantineStorage(key){
  try{const raw=localStorage.getItem(key);if(raw!=null)localStorage.setItem(`${key}.unreadable`,raw)}catch{}
}
function loadState(){try{const value=JSON.parse(storageGet(STORAGE_KEY));return value?migrateDesign(value,{strict:false}):null}catch(error){quarantineStorage(STORAGE_KEY);storageIssue="The saved design could not be read. The raw copy was kept under network-planner-studio.v1.unreadable. Start a new design or import a recovery copy.";showToast(storageIssue);return null}}
function loadLibrary(){try{const value=JSON.parse(storageGet(LIBRARY_KEY));return value&&typeof value==="object"?value:{}}catch{quarantineStorage(LIBRARY_KEY);storageIssue="The local project library could not be read. The raw copy was kept under network-planner-studio.projects.v1.unreadable. Export current work before continuing.";showToast(storageIssue);return{}}}
function saveState(){
  state.updatedAt=new Date().toISOString();
  const saved=storageSet(STORAGE_KEY,JSON.stringify(state));
  const library=loadLibrary();library[state.projectId]=state;
  const kept=Object.entries(library).sort((a,b)=>String(b[1].updatedAt).localeCompare(String(a[1].updatedAt))).slice(0,LIBRARY_LIMIT);
  const librarySaved=storageSet(LIBRARY_KEY,JSON.stringify(Object.fromEntries(kept)));
  $("#save-state").textContent=saved&&librarySaved?"Saved locally":"Storage needs recovery";
  if(!saved||!librarySaved) showToast(storageIssue);
}
function pushHistory(){
  undoStack.push(JSON.stringify(state));if(undoStack.length>40)undoStack.shift();redoStack=[];nudgeBurst={siteId:null,at:0};updateHistoryButtons();
}
function reviveDesign(raw){try{return migrateDesign(raw)}catch{return migrateDesign(raw,{strict:false})}}
function restoreHistory(source,target){
  if(!source.length)return;target.push(JSON.stringify(state));state=reviveDesign(JSON.parse(source.pop()));selected=null;nudgeBurst={siteId:null,at:0};saveState();render();updateHistoryButtons();
}
function updateHistoryButtons(){
  $("#undo-button").disabled=!undoStack.length;$("#redo-button").disabled=!redoStack.length;
}
function touch(){
  $("#save-state").textContent="Saving…";
  clearTimeout(touch.timer);
  touch.timer=setTimeout(()=>{
    touch.timer=null;saveState();
    if($("dialog[open]")){touch.deferred=true;return}
    touch.deferred=false;render();
  },220);
}
document.addEventListener("close",e=>{
  if(!(e.target instanceof HTMLDialogElement)||!touch.deferred||$("dialog[open]"))return;
  touch.deferred=false;
  setTimeout(()=>render(),0);
},true);
function showToast(message){const el=$("#toast");el.textContent=message;el.classList.add("show");clearTimeout(showToast.timer);showToast.timer=setTimeout(()=>el.classList.remove("show"),2300)}

// The mobile drawer's visible state and its aria-expanded disclosure must
// move together, whichever path closes it.
function setMobileSites(open){
  $(".tool-panel").classList.toggle("mobile-open",open);
  $("#mobile-sites-button").setAttribute("aria-expanded",String(open));
}

function start(mode){
  if(mode==="sample") state=sampleState();
  else {state=blankState();state.mode=mode}
  undoStack=[];redoStack=[];nudgeBurst={siteId:null,at:0};updateHistoryButtons();
  saveState();window.scrollTo({top:0,left:0,behavior:"auto"});$("#welcome").classList.add("hidden");$("#workspace").classList.remove("hidden");render();
  if(mode!=="sample") openSiteDialog();
}
function enterWorkspace(){
  $("#welcome").classList.toggle("hidden",!!state.mode);
  $("#workspace").classList.toggle("hidden",!state.mode);
  setMobileSites(false);
}
function showHome(){
  stopTrace();
  selected=null;
  $("#workspace").classList.add("hidden");
  $("#welcome").classList.remove("hidden");
  $("#continue-design").classList.toggle("hidden",!state.sites.length);
  window.scrollTo({top:0,behavior:"smooth"});
}

const FOCUS_IDENTITY=[["vlan-row","data-vlan"],["site-row-select","data-site"],["topology-node","data-site"],["link-hit","data-link"],["add-vlan-mini","data-add-vlan"]];
const FOCUS_INSPECTOR_ATTRS=["data-edit-site","data-edit-vlan","data-edit-link","data-inspector-add-vlan","data-recommend-vlan","data-trace-link"];
function focusKeeper(){
  const el=document.activeElement;
  if(!el||el===document.body)return null;
  for(const [cls,attr] of FOCUS_IDENTITY)if(el.classList.contains(cls)&&el.getAttribute(attr))return `.${cls}[${attr}="${CSS.escape(el.getAttribute(attr))}"]`;
  if(el.dataset.flow)return `[data-flow="${CSS.escape(el.dataset.flow)}"]`;
  for(const attr of FOCUS_INSPECTOR_ATTRS)if(el.getAttribute(attr))return `#inspector [${attr}="${CSS.escape(el.getAttribute(attr))}"]`;
  return null;
}
function restoreFocus(keeper){
  if(!keeper||document.activeElement!==document.body)return;
  const target=$(keeper);
  if(target){
    target.focus({preventScroll:true});
    if(document.activeElement===document.body&&!target.offsetParent){
      const opener=target.closest("#sites-panel")?$("#mobile-sites-button"):null;
      if(opener&&opener.offsetParent)opener.focus({preventScroll:true});
    }
    return;
  }
  // An inspector-origin control whose entity or view is gone (the inspector
  // moved on, or its row was removed) still needs a landing spot better
  // than <body>.
  if(keeper.startsWith("#inspector "))$("#inspector").focus({preventScroll:true});
}
function render(){
  const keeper=focusKeeper();
  stopTrace();
  reviewCache=null;
  $("#project-name-button").textContent=state.name;
  renderSiteList();renderCanvas();renderInspector();renderAddressPlan();renderReview();renderTrafficPolicy();renderReport();
  const vlanCount=state.sites.reduce((n,s)=>n+s.vlans.length,0);
  const addressCount=state.sites.reduce((n,s)=>n+s.vlans.reduce((sum,v)=>sum+(safeCapacity(v)||0),0),0);
  $("#site-total").textContent=`${state.sites.length} site${state.sites.length===1?"":"s"}`;
  $("#vlan-total").textContent=`${vlanCount} VLAN${vlanCount===1?"":"s"}`;
  $("#address-total").textContent=`${addressCount.toLocaleString()} usable IPs`;
  $("#topology-mode").textContent=state.topologyMode==="hub-spoke"?"Hub & spoke":state.topologyMode==="mesh"?"Mesh":"Custom";
  updateHistoryButtons();
  $("#empty-canvas").classList.toggle("hidden",state.sites.length>0);
  restoreFocus(keeper);
}
function activateView(view, moveFocus=false){
  $$('[data-view]').forEach(button=>{const active=button.dataset.view===view;button.classList.toggle("active",active);button.setAttribute("aria-selected",String(active));button.tabIndex=active?0:-1});
  $$(".view").forEach(panel=>{const active=panel.id===`${view}-view`;panel.classList.toggle("active",active);panel.hidden=!active});
  if(view==="topology"&&canvasDirty){const keeper=focusKeeper();renderCanvas();restoreFocus(keeper)}
  if(moveFocus)document.querySelector(`[data-view="${view}"]`)?.focus();
}

function renderSiteList(){
  const root=$("#site-list");root.innerHTML="";
  for(const site of state.sites){
    const wrap=document.createElement("div");wrap.className="site-tree";
    wrap.innerHTML=`<div class="site-row ${selected?.type==="site"&&selected.id===site.id?"selected":""}">
      <button class="site-row-select" data-site="${site.id}" type="button" aria-pressed="${selected?.type==="site"&&selected.id===site.id}"><span class="site-symbol">${TYPE_ICONS[site.type]||"ST"}</span><span class="site-row-text"><strong>${escapeHtml(site.name)}</strong><small>${escapeHtml(site.cidr)}</small></span></button>
      <button class="add-vlan-mini" data-add-vlan="${site.id}" type="button" aria-label="Add VLAN to ${escapeHtml(site.name)}">+</button></div>
      <div class="vlan-list">${site.vlans.map(v=>`<div class="vlan-row ${selected?.type==="vlan"&&selected.id===v.id?"selected":""}" data-vlan="${v.id}" data-parent="${site.id}" role="button" tabindex="0" aria-pressed="${selected?.type==="vlan"&&selected.id===v.id}"><i class="vlan-dot ${roleClass(v.role)}" aria-hidden="true"></i><span>${escapeHtml(v.name)} · ${v.vid}</span><code>${escapeHtml(v.cidr)}</code></div>`).join("")}</div>`;
    root.append(wrap);
  }
  const issues=reviewDesign();
  const guidance=issues.find(i=>i.severity==="error")||issues.find(i=>i.severity==="warning")||issues[0];
  $("#guidance-summary").textContent=guidance?guidance.message:"The address hierarchy is valid and has healthy capacity.";
}

function renderCanvas(){
  // The canvas measures its own box; rendering while the topology view is
  // hidden would bake 800x600 fallback geometry into nodes and the SVG
  // viewBox. Defer instead and flush on view activation.
  if($("#topology-view").hidden||$("#workspace").classList.contains("hidden")){canvasDirty=true;return}
  canvasDirty=false;
  const layer=$("#node-layer"),svg=$("#link-layer"),canvas=$("#canvas");
  layer.innerHTML="";svg.innerHTML="";
  const w=canvas.clientWidth||800,h=canvas.clientHeight||600;
  const nodeWidth=w<600?150:180;
  const point=site=>{const left=Math.max(8,Math.min(w-nodeWidth-8,site.x/100*w)),top=Math.max(8,Math.min(h-88,site.y/100*h));return{left,top,x:left+nodeWidth/2,y:top+35}};
  svg.setAttribute("viewBox",`0 0 ${w} ${h}`);
  for(const link of state.links){
    const a=state.sites.find(s=>s.id===link.from),b=state.sites.find(s=>s.id===link.to);if(!a||!b)continue;
    const ap=point(a),bp=point(b),x1=ap.x,y1=ap.y,x2=bp.x,y2=bp.y;
    const path=`M ${x1} ${y1} C ${(x1+x2)/2} ${y1}, ${(x1+x2)/2} ${y2}, ${x2} ${y2}`;
    svg.insertAdjacentHTML("beforeend",`<path id="route-${link.id}" d="${path}" class="link ${link.resilience==="dual"?"dual":""}"/><path d="${path}" class="link-hit" data-link="${link.id}" tabindex="0" role="button" aria-label="${escapeHtml(`${a.name} to ${b.name}: ${linkLabel(link).toLowerCase()}, ${link.resilience==="dual"?"redundant paths":"single path"}`)}"/><text class="link-label" x="${(x1+x2)/2}" y="${(y1+y2)/2-7}" text-anchor="middle">${linkLabel(link)}</text>`);
  }
  for(const site of state.sites){
    const node=document.createElement("div"),position=point(site),health=siteHealth(site);node.className=`topology-node role-${site.topologyRole||"standalone"} ${selected?.type==="site"&&selected.id===site.id?"selected":""}`;node.dataset.site=site.id;node.tabIndex=0;node.setAttribute("role","button");node.setAttribute("aria-label",`${site.name}, ${site.topologyRole||"standalone"} site, ${site.cidr}${health?`, ${healthWord(health)}`:""}`);
    node.style.left=`${position.left}px`;node.style.top=`${position.top}px`;node.style.width=`${nodeWidth}px`;
    node.innerHTML=`<div class="node-head"><span class="node-icon">${site.topologyRole==="hub"?"HUB":TYPE_ICONS[site.type]||"ST"}</span><span class="node-copy"><strong>${escapeHtml(site.name)}</strong><small>${escapeHtml(site.cidr)} · ${escapeHtml(site.topologyRole||"standalone")}</small></span></div><div class="node-foot"><span><i class="health-dot ${health}"></i>${health?`<span class="health-flag ${health}">${health==="error"?"Errors":"Risks"}</span>`:""}${site.vlans.length} VLAN${site.vlans.length===1?"":"s"}</span><span>${site.devices} devices</span></div>`;
    layer.append(node);
  }
}
// Health must not be a colour-only signal: the flag word reaches sighted
// readers who cannot distinguish the dot, and the aria-label reaches the rest.
function healthWord(health){return health==="error"?"blocking issues":health==="warning"?"risks to review":""}
function linkLabel(link){return link.type==="vpn"?"VPN":link.type==="private"?"PRIVATE WAN":link.type==="peering"?"PEERING":"INTERNET"}
function siteHealth(site){const issues=reviewDesign().filter(i=>i.siteId===site.id);return issues.some(i=>i.severity==="error")?"error":issues.some(i=>i.severity==="warning")?"warning":""}

function renderInspector(){
  const root=$("#inspector");
  if(!selected){root.innerHTML=`<div class="inspector-empty"><span>↖</span><h3>Select something</h3><p>Choose a site, VLAN or connection to inspect and edit its design.</p></div>`;root.classList.remove("open");return}
  root.classList.add("open");
  if(selected.type==="site"){
    const s=state.sites.find(x=>x.id===selected.id);if(!s){selected=null;return renderInspector()}
    const cap=s.vlans.reduce((n,v)=>n+safeCapacity(v),0);
    root.innerHTML=`<div class="inspector-content">${INSPECTOR_CLOSE}<p class="context-label">${escapeHtml(s.type)} · ${escapeHtml(s.topologyRole||"standalone")}</p><h2>${escapeHtml(s.name)}</h2><p>This site owns its parent IPv4 range. Add existing or proposed VLANs inside it.</p>
      <div class="detail-grid"><div class="detail"><span>Site range</span><strong>${escapeHtml(s.cidr)}</strong></div><div class="detail"><span>VLANs</span><strong>${s.vlans.length}</strong></div><div class="detail"><span>Planned devices</span><strong>${s.devices}</strong></div><div class="detail"><span>VLAN capacity</span><strong>${cap}</strong></div></div>
      <div class="inspector-section"><h3>Connectivity</h3><p>${connectionsFor(s.id)} connection${connectionsFor(s.id)===1?"":"s"} · ${s.wan==="dual"?"Dual WAN":s.wan==="single"?"Single WAN":"No direct WAN"} · ${s.internetBreakout||"local"} breakout</p></div>
      ${s.notes?`<div class="inspector-section"><h3>Notes</h3><p>${escapeHtml(s.notes)}</p></div>`:""}
      <div class="inspector-actions"><button class="button primary" data-inspector-add-vlan="${s.id}" type="button">+ Add VLAN</button><button class="button secondary" data-recommend-vlan="${s.id}" type="button">✦ Recommend VLAN</button><button class="button ghost" data-edit-site="${s.id}" type="button">Edit</button><button class="button ghost" data-delete-site="${s.id}" type="button">Delete site</button></div></div>`;
  } else if(selected.type==="vlan"){
    const found=findVlan(selected.id);if(!found){selected=null;return renderInspector()}const {site,vlan:v}=found,p=safeParse(v.cidr),capacity=safeCapacity(v),over=p&&v.devices>capacity,head=p?Math.max(0,Math.round((1-v.devices/capacity)*100)):0;
    root.innerHTML=`<div class="inspector-content">${INSPECTOR_CLOSE}<p class="context-label">VLAN ${v.vid} · ${escapeHtml(v.role)}</p><h2>${escapeHtml(v.name)}</h2><p>Segment within ${escapeHtml(site.name)}.</p>
      <div class="detail-grid"><div class="detail"><span>IPv4 subnet</span><strong>${escapeHtml(v.cidr)}</strong></div><div class="detail"><span>Gateway</span><strong>${escapeHtml(v.gateway)}</strong></div><div class="detail"><span>Devices</span><strong>${v.devices}</strong></div><div class="detail"><span>Headroom</span><strong>${head}%</strong>${over?'<span class="status-pill error">Over capacity</span>':""}</div></div>
      <div class="inspector-section"><h3>DHCP and reservations</h3><p>${v.dhcpEnabled?`${escapeHtml(v.dhcpStart)} – ${escapeHtml(v.dhcpEnd)}`:"Static addressing"} · ${v.reserved||1} reserved address${(v.reserved||1)===1?"":"es"}</p></div>
      <div class="inspector-section"><h3>Best-practice note</h3><p>${roleAdvice(v.role)}</p></div>
      ${v.notes?`<div class="inspector-section"><h3>Notes</h3><p>${escapeHtml(v.notes)}</p></div>`:""}
      <div class="inspector-actions"><button class="button ghost" data-edit-vlan="${v.id}" type="button">Edit</button><button class="button ghost" data-delete-vlan="${v.id}" type="button">Delete VLAN</button></div></div>`;
  } else {
    const l=state.links.find(x=>x.id===selected.id),a=l&&state.sites.find(s=>s.id===l.from),b=l&&state.sites.find(s=>s.id===l.to);if(!l||!a||!b){selected=null;return renderInspector()}
    root.innerHTML=`<div class="inspector-content">${INSPECTOR_CLOSE}<p class="context-label">WAN connection</p><h2>${escapeHtml(a.name)} to ${escapeHtml(b.name)}</h2><p>${linkLabel(l)} with ${l.resilience==="dual"?"redundant paths":"a single path"}.</p><div class="detail-grid"><div class="detail"><span>Type</span><strong>${linkLabel(l)}</strong></div><div class="detail"><span>Resilience</span><strong>${escapeHtml(l.resilience)}</strong></div><div class="detail"><span>Routing</span><strong>${escapeHtml(l.routingType||"static")}</strong></div><div class="detail"><span>Transit</span><strong>${l.transitAllowed===false?"blocked":"allowed"}</strong></div></div>${l.notes?`<div class="inspector-section"><h3>Notes</h3><p>${escapeHtml(l.notes)}</p></div>`:""}<div class="inspector-actions"><button class="button primary" data-trace-link="${l.id}" type="button">Trace path</button><button class="button ghost" data-edit-link="${l.id}" type="button">Edit</button><button class="button ghost" data-delete-link="${l.id}" type="button">Delete</button></div></div>`;
  }
}
function connectionsFor(id){return state.links.filter(l=>l.from===id||l.to===id).length}
function roleAdvice(role){return{users:"Keep user endpoints separate from infrastructure and restrict east-west access where practical.",voice:"Reserve predictable capacity and apply the voice QoS policy consistently across the WAN.",guest:"Use internet-only access and prevent routes to private corporate address space.",iot:"Treat unmanaged devices as untrusted and allow only required destinations and ports.",servers:"Separate workloads by trust level where the environment warrants it.",management:"Restrict access to administrators and avoid general user traffic on this network.",transit:"Use a dedicated, tightly sized subnet for routed point-to-point connectivity.",other:"Document the trust level, allowed flows and ownership of this segment."}[role]}

function renderAddressPlan(){
  const all=state.sites.flatMap(s=>s.vlans.map(v=>({site:s,vlan:v,p:safeParse(v.cidr)})));
  const usable=all.reduce((n,x)=>n+safeCapacity(x.vlan),0),needed=all.reduce((n,x)=>n+x.vlan.devices,0);
  $("#address-summary").innerHTML=[
    ["Sites",state.sites.length],["VLANs",all.length],["Usable addresses",usable.toLocaleString()],["Planned devices",needed.toLocaleString()]
  ].map(([a,b])=>`<div class="summary-card"><span>${a}</span><strong>${b}</strong></div>`).join("");
  $("#address-table").innerHTML=all.length?all.map(({site,vlan:v,p})=>{
    const capacity=safeCapacity(v),head=p?Math.max(0,Math.round((1-v.devices/capacity)*100)):0,status=!p?["Invalid","error"]:v.devices>capacity?["Over capacity","error"]:head<20?["Low headroom","warning"]:["Healthy",""];
    return `<tr><td><strong>${escapeHtml(site.name)}</strong><br><small>${escapeHtml(v.name)}</small></td><td>${v.vid}</td><td><code>${escapeHtml(v.cidr)}</code></td><td><code>${escapeHtml(v.gateway)}</code></td><td>${v.devices}</td><td>${p?capacity:"Unavailable"}</td><td>${p?head+"%":"Unavailable"}</td><td><span class="status-pill ${status[1]}">${status[0]}</span></td></tr>`
  }).join(""):`<tr><td colspan="8">No VLANs have been added yet.</td></tr>`;
}

let reviewCache=null;
function reviewDesign(){
  if(reviewCache)return reviewCache;
  const issues=[];
  for(const message of state.importWarnings||[])issues.push(issue("warning","Recovered design data",message));
  if(!state.sites.length)return[...issues,{severity:"info",title:"Start the address hierarchy",message:"Add a site with a parent IPv4 range and create VLANs inside it."}];
  for(let i=0;i<state.sites.length;i++){
    const s=state.sites[i],sp=safeParse(s.cidr);
    if(!sp)issues.push(issue("error","Invalid site range",`${s.name} does not have a valid IPv4 CIDR range.`,s.id));
    else if(!isPrivateCidr(s.cidr))issues.push(issue("warning","Public site address space",`${s.name} uses ${s.cidr}, which is not RFC1918 private address space. Confirm ownership and intent.`,s.id));
    for(let j=i+1;j<state.sites.length;j++)if(rangesOverlap(s.cidr,state.sites[j].cidr))issues.push(issue("error","Overlapping site ranges",`${s.name} and ${state.sites[j].name} overlap. VPN routing between them will be ambiguous.`,s.id));
    if(s.wan==="single"&&connectionsFor(s.id)>0)issues.push(issue("warning","Single WAN dependency",`${s.name} has inter-site connectivity but only one WAN path. Document the accepted outage risk.`,s.id));
    if(!s.vlans.length)issues.push(issue("warning","No VLANs defined",`${s.name} has a parent range but no usable networks yet.`,s.id));
    const vids=new Map();
    for(let vIndex=0;vIndex<s.vlans.length;vIndex++){
      const v=s.vlans[vIndex],p=safeParse(v.cidr);
      if(vids.has(v.vid))issues.push(issue("error","Duplicate VLAN ID",`${s.name} uses VLAN ${v.vid} for both ${vids.get(v.vid)} and ${v.name}.`,s.id));
      vids.set(v.vid,v.name);
      if(!p)issues.push(issue("error","Invalid VLAN subnet",`${s.name} / ${v.name} has an invalid IPv4 subnet.`,s.id));
      else{
        if(sp&&!contains(s.cidr,v.cidr))issues.push(issue("error","VLAN outside site range",`${v.cidr} is not contained by ${s.name}'s ${s.cidr} allocation.`,s.id));
        const capacity=safeCapacity(v);
        if(v.devices>capacity)issues.push(issue("error","Subnet over capacity",`${s.name} / ${v.name} needs ${v.devices} endpoint addresses but ${v.cidr} has only ${capacity} after reservations.`,s.id));
        else if(capacity>0&&v.devices/capacity>.8)issues.push(issue("warning","Low address headroom",`${s.name} / ${v.name} is planned above 80% of endpoint capacity.`,s.id));
        if(p.prefix===31&&v.role!=="transit")issues.push(issue("error","Invalid /31 use",`${s.name} / ${v.name} uses /31 but is not a transit network.`,s.id));
        if(p.prefix<22&&v.role!=="guest")issues.push(issue("advice","Large broadcast domain",`${s.name} / ${v.name} is a /${p.prefix}. Consider whether a smaller failure and broadcast domain is preferable.`,s.id));
        if(!validateGateway(v.gateway,v.cidr,{transit:v.role==="transit"}))issues.push(issue("error","Invalid gateway",`${s.name} / ${v.name} must use a usable gateway inside ${v.cidr}.`,s.id));
        const pool=validateDhcpPool(v.cidr,v.gateway,v.reserved,{enabled:v.dhcpEnabled,start:v.dhcpStart,end:v.dhcpEnd});
        for(const message of pool.errors)issues.push(issue("error",message.includes("gateway")?"Gateway inside DHCP pool":"Invalid DHCP pool",`${s.name} / ${v.name}: ${message}.`,s.id));
      }
      for(let k=vIndex+1;k<s.vlans.length;k++)if(rangesOverlap(v.cidr,s.vlans[k].cidr))issues.push(issue("error","Overlapping VLAN subnets",`${s.name}: ${v.name} overlaps ${s.vlans[k].name}.`,s.id));
    }
    if(s.vlans.length>=3&&!s.vlans.some(v=>v.role==="management"))issues.push(issue("advice","No management segment",`${s.name} has several VLANs but no dedicated network-management segment.`,s.id));
    if(s.vlans.some(v=>v.role==="guest")&&s.vlans.some(v=>v.role==="users"))issues.push(issue("info","Trust boundary required",`${s.name}'s guest network should be denied access to private staff and infrastructure ranges.`,s.id));
  }
  if(state.sites.length>1){
    // Iterative flood fill: a deep imported chain must not be able to exhaust
    // the stack through recursive closure.
    const visited=new Set(),stack=[state.sites[0].id];
    while(stack.length){
      const id=stack.pop();
      if(visited.has(id))continue;
      visited.add(id);
      for(const l of state.links){
        if(l.from===id)stack.push(l.to);
        else if(l.to===id)stack.push(l.from);
      }
    }
    state.sites.filter(s=>!visited.has(s.id)).forEach(s=>issues.push(issue("warning","Isolated site",`${s.name} is not connected to the rest of the topology.`,s.id)));
  }
  for(const link of state.links){
    const a=state.sites.find(s=>s.id===link.from),b=state.sites.find(s=>s.id===link.to);if(!a||!b)continue;
    if(link.routingType==="static"&&!(link.advertisedPrefixes||[]).length)issues.push(issue("warning","Static route intent is missing",`${a.name} ↔ ${b.name} uses static routing but has no documented advertised prefixes.`,a.id));
    for(const prefix of link.advertisedPrefixes||[]){try{parseRoutePrefix(prefix)}catch(error){issues.push(issue("error","Invalid advertised prefix",`${a.name} ↔ ${b.name}: ${error.message}.`,a.id));continue}if(prefix!=="0.0.0.0/0"&&!isPrivateRoutePrefix(prefix))issues.push(issue("advice","Non-private advertised prefix",`${a.name} ↔ ${b.name} advertises ${prefix}. Confirm ownership and intent.`,a.id));}
  }
  if(state.topologyMode==="hub-spoke"){
    const hubs=state.sites.filter(s=>s.topologyRole==="hub"),spokes=state.sites.filter(s=>s.topologyRole==="spoke");
    if(!hubs.length)issues.push(issue("error","Hub is missing","Hub-and-spoke mode requires at least one site with the hub role."));
    if(hubs.length===1&&spokes.length>1)issues.push(issue("warning","Single hub dependency",`${hubs[0].name} is the only transit hub for ${spokes.length} spokes.`,hubs[0].id));
    const secondary=state.sites.find(s=>s.id===state.policies?.secondaryHubId&&s.topologyRole==="hub");
    if(state.policies?.secondaryHubId&&!secondary)issues.push(issue("error","Secondary hub is invalid","The configured secondary hub no longer exists or no longer has the hub role."));
    for(const spoke of spokes){
      const hub=state.sites.find(s=>s.id===spoke.hubId&&s.topologyRole==="hub");
      if(!hub)issues.push(issue("error","Spoke has no valid hub",`${spoke.name} is marked as a spoke but has no valid hub assignment.`,spoke.id));
      else if(!state.links.some(l=>(l.from===spoke.id&&l.to===hub.id)||(l.to===spoke.id&&l.from===hub.id)))issues.push(issue("error","Spoke is not connected to hub",`${spoke.name} is assigned to ${hub.name} but no connection exists.`,spoke.id));
      if(secondary&&!state.links.some(l=>(l.from===spoke.id&&l.to===secondary.id)||(l.to===spoke.id&&l.from===secondary.id)))issues.push(issue("warning","Secondary hub path is missing",`${spoke.name} is not connected to secondary hub ${secondary.name}.`,spoke.id));
      if(spoke.internetBreakout==="hub"&&!state.links.some(l=>((l.from===spoke.id&&l.to===spoke.hubId)||(l.to===spoke.id&&l.from===spoke.hubId))&&l.defaultRoute))issues.push(issue("warning","Central breakout lacks default route",`${spoke.name} uses hub internet breakout but its hub link does not advertise a default route.`,spoke.id));
    }
    for(const link of state.links){const a=state.sites.find(s=>s.id===link.from),b=state.sites.find(s=>s.id===link.to);if(a?.topologyRole==="spoke"&&b?.topologyRole==="spoke")issues.push(issue("warning","Direct spoke link conflicts with policy",`${a.name} and ${b.name} are directly connected even though spoke traffic is ${state.policies.spokeToSpoke}.`,a.id));}
  }
  if(!issues.some(i=>["error","warning"].includes(i.severity)))issues.unshift(issue("info","Core checks passed","No overlaps, invalid allocations or immediate capacity risks were found."));
  reviewCache=issues;
  return issues;
}
function issue(severity,title,message,siteId){return{severity,title,message,siteId}}
function renderReview(){
  const issues=reviewDesign(),errors=issues.filter(i=>i.severity==="error").length,warnings=issues.filter(i=>i.severity==="warning").length;
  const score=Math.max(0,100-errors*18-warnings*7-issues.filter(i=>i.severity==="advice").length*2);
  $("#issue-count").textContent=errors+warnings;$("#issue-count").classList.toggle("has-errors",errors+warnings>0);
  $("#review-score").innerHTML=`<div class="score-ring" role="img" aria-label="Design score ${score} out of 100">${score}</div><div><h2>${errors?`${errors} blocking issue${errors===1?"":"s"} found`:warnings?`${warnings} design risk${warnings===1?"":"s"} to review`:"The foundations look healthy"}</h2><p>${errors?"Resolve address conflicts before implementation or connecting sites.":"Recommendations remain editable; document intentional exceptions."}</p></div>`;
  const assumptions=(state.assumptions||[]).map(message=>({severity:"info",title:"Design assumption",message}));
  $("#review-list").innerHTML=[...issues,...assumptions].map(i=>`<article class="review-item ${i.severity}"><span class="review-icon">${i.severity==="error"?"!":i.severity==="warning"?"△":"✓"}</span><div><h3>${escapeHtml(i.title)}</h3><p>${escapeHtml(i.message)}</p></div><small>${i.severity}</small></article>`).join("");
}
function defaultFlow(source,destination){
  if(source===destination)return"allow";
  if(source==="guest")return"deny";
  if(source==="management")return"allow";
  if(source==="iot")return["servers","management"].includes(destination)?"restricted":"deny";
  if(destination==="management")return"deny";
  if(source==="users"&&destination==="servers")return"restricted";
  return"restricted";
}
function renderTrafficPolicy(){
  const root=$("#flow-matrix");if(!root)return;const roles=[...new Set(state.sites.flatMap(s=>s.vlans.map(v=>v.role)))];
  if(!roles.length){root.innerHTML="<p class=\"empty-policy\">Add VLANs to build the trust-zone matrix.</p>";return}
  root.innerHTML=`<table><thead><tr><th scope="col">Source / destination</th>${roles.map(r=>`<th scope="col">${escapeHtml(r)}</th>`).join("")}</tr></thead><tbody>${roles.map(source=>`<tr><th scope="row">${escapeHtml(source)}</th>${roles.map(destination=>{const key=`${source}:${destination}`;if(source===destination)return`<td><span class="flow-cell-self">same zone</span></td>`;const raw=state.flowPolicies?.[key],value=ENUMS.flowPolicies.includes(raw)?raw:defaultFlow(source,destination);return`<td><button class="flow-cell ${value}" data-flow="${key}" type="button" aria-label="${escapeHtml(`${source} to ${destination}: ${value}`)}">${escapeHtml(value)}</button></td>`}).join("")}</tr>`).join("")}</tbody></table>`;
}

function renderReport(){
  const root=$("#implementation-report");if(!root)return;
  const issues=reviewDesign(),blocking=issues.filter(i=>i.severity==="error").length,risks=issues.filter(i=>i.severity==="warning").length;
  const vlans=state.sites.flatMap(site=>site.vlans.map(vlan=>({site,vlan}))),siteName=id=>state.sites.find(s=>s.id===id)?.name||"Unknown",roles=[...new Set(vlans.map(({vlan})=>vlan.role))];
  const policyRows=roles.flatMap(source=>roles.filter(destination=>destination!==source).map(destination=>{const key=`${source}:${destination}`,value=ENUMS.flowPolicies.includes(state.flowPolicies?.[key])?state.flowPolicies[key]:defaultFlow(source,destination);return`<tr><td>${escapeHtml(source)}</td><td>${escapeHtml(destination)}</td><td>${escapeHtml(value)}</td><td>${value==="deny"?"Trust boundary enforced":value==="allow"?"Explicitly permitted":"Review required before implementation"}</td></tr>`})).join("");
  const breakoutRows=state.sites.map(site=>`<tr><td>${escapeHtml(site.name)}</td><td>${escapeHtml(site.topologyRole)}</td><td>${escapeHtml(site.hubId?siteName(site.hubId):"Not assigned")}</td><td>${escapeHtml(site.internetBreakout||"local")}</td><td>${state.policies?.centralizedInspection?"Central inspection intended":"No centralized inspection intent"}</td></tr>`).join("");
  const unresolved=issues.filter(item=>["error","warning","advice"].includes(item.severity));
  root.innerHTML=`<article class="report-sheet">
    <header class="report-header"><div><p class="context-label">IPv4 network design</p><h2>${escapeHtml(state.name)}</h2><p>Generated ${new Date().toLocaleString()} · ${escapeHtml(state.topologyMode)}</p></div><div class="report-status ${blocking?"error":risks?"warning":""}">${blocking?`${blocking} blocking issue${blocking===1?"":"s"}`:risks?`${risks} risk${risks===1?"":"s"} to accept`:"Ready for technical review"}</div></header>
    <div class="report-kpis">${[["Sites",state.sites.length],["VLANs",vlans.length],["WAN links",state.links.length],["Schema",`${SCHEMA_ID} v${SCHEMA_VERSION}`]].map(([label,value])=>`<div class="report-kpi"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`).join("")}</div>
    <section class="report-section"><h3>Site and address plan</h3><table><thead><tr><th scope="col">Site</th><th>Role</th><th>Site range</th><th>VLAN</th><th>Subnet and gateway</th><th>DHCP pool</th><th>Reserved</th><th>Devices</th></tr></thead><tbody>${vlans.length?vlans.map(({site,vlan:v})=>`<tr><td>${escapeHtml(site.name)}</td><td>${escapeHtml(site.topologyRole)}</td><td><code>${escapeHtml(site.cidr)}</code></td><td>${v.vid} · ${escapeHtml(v.name)}</td><td><code>${escapeHtml(v.cidr)}</code><br><small>${escapeHtml(v.gateway)}</small></td><td>${v.dhcpEnabled?`<code>${escapeHtml(v.dhcpStart)}</code><br><small>to ${escapeHtml(v.dhcpEnd)}</small>`:"Static"}</td><td>${v.reserved}</td><td>${v.devices}</td></tr>`).join(""):`<tr><td colspan="8">No VLANs defined.</td></tr>`}</tbody></table></section>
    <section class="report-section"><h3>WAN and routing intent</h3><table><thead><tr><th scope="col">Connection</th><th>Transport</th><th>Resilience</th><th>Routing</th><th>Transit</th><th>Prefixes and default</th><th>Notes</th></tr></thead><tbody>${state.links.length?state.links.map(l=>`<tr><td>${escapeHtml(siteName(l.from))} to ${escapeHtml(siteName(l.to))}</td><td>${escapeHtml(linkLabel(l))}</td><td>${escapeHtml(l.resilience)}</td><td>${escapeHtml(l.routingType)}</td><td>${l.transitAllowed===false?"denied":"allowed"}</td><td>${(l.advertisedPrefixes||[]).map(escapeHtml).join(", ")||"Learned dynamically"}${l.defaultRoute?"; default 0.0.0.0/0":""}</td><td>${escapeHtml(l.notes||"Not documented")}</td></tr>`).join(""):`<tr><td colspan="7">No WAN links defined.</td></tr>`}</tbody></table></section>
    <section class="report-section"><h3>Breakout, hub assignments and inspection</h3><table><thead><tr><th scope="col">Site</th><th>Topology role</th><th>Assigned hub</th><th>Internet breakout</th><th>Inspection intent</th></tr></thead><tbody>${breakoutRows||`<tr><td colspan="5">No sites defined.</td></tr>`}</tbody></table></section>
    <section class="report-section"><h3>Traffic policy matrix</h3><table><thead><tr><th scope="col">Source role</th><th>Destination role</th><th>Action</th><th>Rationale</th></tr></thead><tbody>${policyRows||`<tr><td colspan="4">${roles.length?"A single VLAN role has no cross-zone flows to govern.":"No VLAN roles defined."}</td></tr>`}</tbody></table><p>Policy values describe intended trust boundaries. They are not device configuration.</p></section>
    <section class="report-section"><h3>Assumptions and unresolved decisions</h3>${state.assumptions?.length?`<ul>${state.assumptions.map(a=>`<li>${escapeHtml(a)}</li>`).join("")}</ul>`:"<p>No assumptions documented.</p>"}${unresolved.length?`<ul>${unresolved.map(i=>`<li><strong>${escapeHtml(i.severity.toUpperCase())}:</strong> ${escapeHtml(i.title)}: ${escapeHtml(i.message)}</li>`).join("")}</ul>`:"<p>No unresolved review decisions.</p>"}</section>
    <section class="report-section"><h3>Schema and review provenance</h3><p><code>${escapeHtml(SCHEMA_ID)} v${SCHEMA_VERSION}</code>. This is a local IPv4 design artifact. A network owner must review addressing, routing and policy before implementation.</p></section>
  </article>`;
}

function renderProjectLibrary(){
  const library=loadLibrary(),projects=Object.values(library).sort((a,b)=>String(b.updatedAt).localeCompare(String(a.updatedAt)));
  $("#project-list").innerHTML=projects.length?projects.map(p=>`<article class="project-card ${p.projectId===state.projectId?"current":""}"><div><strong>${escapeHtml(p.name)}</strong><small>${p.sites?.length||0} sites · updated ${new Date(p.updatedAt).toLocaleString()}${p.projectId===state.projectId?" · current":""}</small></div><div class="project-card-actions"><button class="button ghost" data-open-project="${p.projectId}" type="button">Open</button>${p.projectId===state.projectId?"":`<button class="button ghost" data-delete-project="${p.projectId}" type="button">Delete</button>`}</div></article>`).join(""):"<p>No saved designs yet.</p>";
}
function openProjects(){saveState();renderProjectLibrary();$("#projects-dialog").showModal()}
function duplicateProject(){
  saveState();state=reviveDesign(JSON.parse(JSON.stringify(state)));state.projectId=uid();state.name=`${state.name} copy`;state.mode=state.mode||"existing";undoStack=[];redoStack=[];nudgeBurst={siteId:null,at:0};saveState();renderProjectLibrary();render();showToast("Design duplicated");
}
function newProject(){state=blankState();state.mode="new";selected=null;undoStack=[];redoStack=[];nudgeBurst={siteId:null,at:0};saveState();$("#projects-dialog").close();enterWorkspace();render();openSiteDialog()}

function openSiteDialog(siteId=null){
  editingSiteId=siteId;const form=$("#site-form");form.reset();form.elements.devices.value=50;
  const growth=form.elements.growth;growth.querySelector("option[data-dynamic-growth]")?.remove();growth.value=30;
  const site=siteId&&state.sites.find(s=>s.id===siteId);
  $("#site-dialog-title").textContent=site?"Edit site":"Add a site";$("#site-submit").textContent=site?"Save changes":"Add site";
  if(site){for(const key of ["name","type","devices","cidr","wan","growth","topologyRole","internetBreakout","notes"])if(form.elements[key])form.elements[key].value=site[key]??"";
    if(growth.value!==String(site.growth)){const option=document.createElement("option");option.value=String(site.growth);option.textContent=`${site.growth}% (from design)`;option.dataset.dynamicGrowth="";growth.add(option);growth.value=String(site.growth)}}
  $("#site-form-error").textContent="";$("#site-dialog").showModal();setTimeout(()=>form.elements.name.focus(),50);
}
function openVlanDialog(siteId,vlanId=null){
  if(!state.sites.length){showToast("Add a site before adding a VLAN");return openSiteDialog()}
  editingVlanId=vlanId;const form=$("#vlan-form");form.reset();form.elements.siteId.innerHTML=state.sites.map(s=>`<option value="${s.id}">${escapeHtml(s.name)} · ${escapeHtml(s.cidr)}</option>`).join("");if(siteId)form.elements.siteId.value=siteId;
  const found=vlanId&&findVlan(vlanId),site=found?.site||state.sites.find(s=>s.id===form.elements.siteId.value);
  $("#vlan-dialog-title").textContent=found?"Edit VLAN":"Add a VLAN";$("#vlan-submit").textContent=found?"Save changes":"Add VLAN";
  if(found){form.elements.siteId.value=found.site.id;for(const key of ["name","vid","role","devices","cidr","gateway","dhcpStart","dhcpEnd","notes"])form.elements[key].value=found.vlan[key]??"";form.elements.dhcpEnabled.value=String(found.vlan.dhcpEnabled!==false);form.elements.reserved.value=found.vlan.reserved??1}
  else{const vid=nextVid(site);if(vid===null){editingVlanId=null;return showToast(`${site.name} has no free VLAN IDs`)}form.elements.vid.value=vid;form.elements.devices.value=30;form.elements.reserved.value=1}
  form.elements.siteId.disabled=Boolean(found);$("#vlan-form-error").textContent="";$("#vlan-dialog").showModal();setTimeout(()=>form.elements.name.focus(),50);
}
function openConnectDialog(fromId,linkId=null){
  if(state.sites.length<2)return showToast("Add at least two sites before connecting them");
  editingLinkId=linkId;const options=state.sites.map(s=>`<option value="${s.id}">${escapeHtml(s.name)}</option>`).join(""),form=$("#connect-form");form.reset();form.elements.from.innerHTML=options;form.elements.to.innerHTML=options;
  const link=linkId&&state.links.find(l=>l.id===linkId);$("#connect-submit").textContent=link?"Save changes":"Create connection";
  if(link){for(const key of ["from","to","type","resilience","routingType","notes"])form.elements[key].value=link[key]??"";form.elements.transitAllowed.value=String(link.transitAllowed!==false);form.elements.defaultRoute.checked=Boolean(link.defaultRoute);form.elements.advertisedPrefixes.value=(link.advertisedPrefixes||[]).join(", ")}
  else{if(fromId)form.elements.from.value=fromId;form.elements.to.value=state.sites.find(s=>s.id!==form.elements.from.value)?.id||""}
  $("#connect-form-error").textContent="";$("#connect-dialog").showModal();
}
function nextVid(site){if(!site)return 10;for(const id of [10,20,30,40,50,60,70,80,90,99])if(!site.vlans.some(v=>v.vid===id))return id;for(let id=1;id<=4094;id++)if(!site.vlans.some(v=>v.vid===id))return id;return null}

const ROLE_DEFAULTS={
  users:{name:"Staff",vid:10},voice:{name:"Voice",vid:20},guest:{name:"Guest",vid:30},
  servers:{name:"Servers",vid:40},iot:{name:"IoT",vid:50},management:{name:"Management",vid:99},
  transit:{name:"Transit",vid:90},other:{name:"Network",vid:60}
};
function conventionalVid(role,site={vlans:[]}){
  const counts=new Map();
  state.sites.flatMap(s=>s.vlans).filter(v=>v.role===role).forEach(v=>counts.set(v.vid,(counts.get(v.vid)||0)+1));
  const ranked=[...counts].sort((a,b)=>b[1]-a[1]).map(([vid])=>vid);
  for(const vid of [...ranked,ROLE_DEFAULTS[role]?.vid||60]) if(!site.vlans.some(v=>v.vid===vid))return vid;
  return nextVid(site);
}
function siteRoles(type){
  if(type==="cloud")return["servers","management"];
  if(type==="datacentre")return["servers","management"];
  if(type==="warehouse")return["users","iot","guest","management"];
  return["users","voice","guest","management"];
}
function roleDevices(role,primary){
  return Math.max(role==="management"?12:4,Math.ceil(primary*({users:1,voice:.8,guest:1.2,iot:.65,servers:.45,management:.12}[role]||.5)));
}
function busiestHub(){
  return [...state.sites].sort((a,b)=>connectionsFor(b.id)-connectionsFor(a.id)||b.vlans.length-a.vlans.length)[0];
}
function buildRecommendation(){
  const form=$("#recommend-form"),fd=new FormData(form),kind=fd.get("kind");
  $("#recommend-error").textContent="";
  try{
    if(kind==="site"){
      const name=String(fd.get("siteName")||"").trim()||"New site",type=fd.get("siteType"),devices=Math.max(1,+fd.get("siteDevices")),growth=+fd.get("siteGrowth");
      const cidr=suggestSiteRange(devices),shell={vlans:[]},vlans=[],occupied=[];
      for(const role of siteRoles(type)){
        const count=roleDevices(role,devices),prefix=prefixForDevices(count,growth),subnet=nextSubnet(cidr,prefix,occupied),vid=conventionalVid(role,shell);if(vid===null)throw new Error("This site has no free VLAN IDs");
        const pool=defaultDhcpPool(subnet,1),proposed=createVlan({id:uid(),name:ROLE_DEFAULTS[role].name,vid,role,devices:count,cidr:subnet,gateway:firstUsable(subnet),dhcpEnabled:!["servers","management"].includes(role),reserved:1,dhcpStart:pool.start,dhcpEnd:pool.end,notes:"Recommended for the new site.",siteCidr:cidr});
        shell.vlans.push(proposed);vlans.push(proposed);occupied.push(subnet);
      }
      pendingRecommendation={kind,id:uid(),name,type,devices,growth,cidr,wan:"single",topologyRole:fd.get("connectTo")?"spoke":"standalone",hubId:fd.get("connectTo")||null,internetBreakout:fd.get("connectTo")?"hub":"local",notes:"Generated by the compatibility assistant.",x:15+(state.sites.length%3)*30,y:18+Math.floor(state.sites.length/3)*32,vlans,connectTo:fd.get("connectTo")};
      renderRecommendationPreview();
    }else{
      const site=state.sites.find(s=>s.id===fd.get("vlanSite"));if(!site)throw new Error("Add or select a site before requesting a VLAN");
      const role=fd.get("vlanRole"),devices=Math.max(1,+fd.get("vlanDevices")),vid=conventionalVid(role,site);if(vid===null)throw new Error(`${site.name} has no free VLAN IDs`);const prefix=prefixForDevices(devices,site.growth),cidr=nextSubnet(site.cidr,prefix,site.vlans.map(v=>v.cidr));
      const dhcpEnabled=!(["servers","management"].includes(role)),pool=defaultDhcpPool(cidr,1);
      pendingRecommendation={kind,siteId:site.id,id:uid(),name:String(fd.get("vlanName")||"").trim()||ROLE_DEFAULTS[role].name,role,devices,vid,cidr,gateway:firstUsable(cidr),dhcpEnabled,reserved:1,dhcpStart:dhcpEnabled?pool.start:"",dhcpEnd:dhcpEnabled?pool.end:"",notes:"Recommended by the compatibility assistant."};
      renderRecommendationPreview();
    }
  }catch(err){pendingRecommendation=null;$("#recommend-preview").className="recommend-preview empty";$("#recommend-preview").textContent="A compatible proposal could not be produced.";$("#recommend-error").textContent=err.message}
}
function renderRecommendationPreview(){
  const p=pendingRecommendation,root=$("#recommend-preview");if(!p)return;
  root.className="recommend-preview";
  if(p.kind==="site"){
    const connection=p.connectTo?state.sites.find(s=>s.id===p.connectTo)?.name:"Not connected yet";
    root.innerHTML=`<div class="proposal-heading"><div><p class="context-label">Recommended site plan</p><h3>${escapeHtml(p.name)}</h3></div><code>${p.cidr}</code></div>
      <div class="proposal-grid">${p.vlans.map(v=>`<div class="proposal-item"><span>VLAN ${v.vid}</span><strong>${escapeHtml(v.name)} · ${v.cidr}</strong></div>`).join("")}</div>
      <ul class="proposal-reasons"><li>${p.cidr} does not overlap any existing site range.</li><li>VLAN IDs follow the conventions already used in this environment where possible.</li><li>Subnet sizes include ${p.growth}% growth and stay inside the site allocation.</li><li>${p.connectTo?`A VPN connection to ${escapeHtml(connection)} will be created.`:"No WAN connection will be assumed."}</li></ul>`;
  }else{
    const site=state.sites.find(s=>s.id===p.siteId);
    root.innerHTML=`<div class="proposal-heading"><div><p class="context-label">Recommended VLAN</p><h3>${escapeHtml(p.name)} at ${escapeHtml(site.name)}</h3></div><code>${p.cidr}</code></div>
      <div class="proposal-grid"><div class="proposal-item"><span>VLAN ID</span><strong>${p.vid}</strong></div><div class="proposal-item"><span>Gateway</span><strong>${p.gateway}</strong></div><div class="proposal-item"><span>Devices</span><strong>${p.devices}</strong></div><div class="proposal-item"><span>Role</span><strong>${escapeHtml(p.role)}</strong></div></div>
      <ul class="proposal-reasons"><li>The subnet is free and contained by ${site.cidr}.</li><li>VLAN ${p.vid} follows the environment's ${escapeHtml(p.role)} convention and is unused at this site.</li><li>The prefix includes the site's ${site.growth}% growth allowance.</li></ul>`;
  }
}
function openRecommendDialog(kind="site",siteId){
  if(kind==="vlan"&&!state.sites.length){showToast("Add an existing site before requesting a compatible VLAN");return openSiteDialog()}
  const form=$("#recommend-form"),siteOptions=state.sites.map(s=>`<option value="${s.id}">${escapeHtml(s.name)} · ${escapeHtml(s.cidr)}</option>`).join("");
  form.elements.connectTo.innerHTML=`<option value="">No VPN yet</option>${siteOptions}`;
  form.elements.vlanSite.innerHTML=siteOptions;
  if(siteId)form.elements.vlanSite.value=siteId;
  const hub=busiestHub();if(hub)form.elements.connectTo.value=hub.id;
  setRecommendationKind(kind);$("#recommend-dialog").showModal();buildRecommendation();
}
function setRecommendationKind(kind){
  const form=$("#recommend-form");form.elements.kind.value=kind;
  $$("[data-recommend-kind]").forEach(b=>b.classList.toggle("active",b.dataset.recommendKind===kind));
  $("#recommend-site-fields").classList.toggle("hidden",kind!=="site");$("#recommend-vlan-fields").classList.toggle("hidden",kind!=="vlan");
  if($("#recommend-dialog").open)buildRecommendation();
}
function applyRecommendation(){
  const p=pendingRecommendation;if(!p)return;
  pushHistory();
  if(p.kind==="site"){
    const site=createSite({id:p.id,name:p.name,type:p.type,devices:p.devices,growth:p.growth,cidr:p.cidr,wan:p.wan,topologyRole:p.topologyRole,hubId:p.hubId,internetBreakout:p.internetBreakout,notes:p.notes,x:p.x,y:p.y,vlans:p.vlans});state.sites.push(site);
    if(p.connectTo){const hub=state.sites.find(s=>s.id===p.connectTo);state.links.push(createLink({id:uid(),from:p.connectTo,to:site.id,type:"vpn",resilience:"single",routingType:"static",transitAllowed:true,defaultRoute:true,advertisedPrefixes:["0.0.0.0/0",hub?.cidr,site.cidr].filter(Boolean)}))}
    selected={type:"site",id:site.id};showToast(`${site.name} added with ${site.vlans.length} recommended VLANs`);
  }else{
    const site=state.sites.find(s=>s.id===p.siteId);if(!site)return;site.vlans.push(createVlan({...p,siteCidr:site.cidr}));selected={type:"vlan",id:p.id};showToast(`${p.name} added as ${p.cidr}`);
  }
  $("#recommend-dialog").close();pendingRecommendation=null;touch();
}

function layoutHubSpoke(hubId,secondaryHubId=null){
  const hub=state.sites.find(s=>s.id===hubId);if(!hub)return;
  const secondary=secondaryHubId&&state.sites.find(s=>s.id===secondaryHubId);hub.x=secondary?32:42;hub.y=40;if(secondary){secondary.x=54;secondary.y=40}
  const spokes=state.sites.filter(s=>![hubId,secondaryHubId].includes(s.id)),count=Math.max(1,spokes.length);
  spokes.forEach((site,index)=>{const angle=-Math.PI/2+index*(Math.PI*2/count);site.x=Math.max(3,Math.min(80,42+35*Math.cos(angle)));site.y=Math.max(6,Math.min(79,42+34*Math.sin(angle)))});
}
function openHubDialog(){
  if(state.sites.length<2)return showToast("Add at least two sites before creating a hub-and-spoke design");
  const form=$("#hub-form"),options=state.sites.map(s=>`<option value="${s.id}">${escapeHtml(s.name)} · ${escapeHtml(s.cidr)}</option>`).join("");form.elements.hubId.innerHTML=options;form.elements.secondaryHubId.innerHTML=`<option value="">No secondary hub</option>${options}`;
  const current=state.sites.find(s=>s.topologyRole==="hub")||busiestHub();if(current)form.elements.hubId.value=current.id;
  form.elements.secondaryHubId.value=state.policies?.secondaryHubId||"";
  form.elements.spokeToSpoke.value=state.policies?.spokeToSpoke||"via-hub";form.elements.centralizedInspection.checked=state.policies?.centralizedInspection!==false;$("#hub-form-error").textContent="";$("#hub-dialog").showModal();
}
$("#hub-form").addEventListener("submit",e=>{
  e.preventDefault();const fd=new FormData(e.currentTarget),hubId=fd.get("hubId"),secondaryHubId=fd.get("secondaryHubId")||null,hub=state.sites.find(s=>s.id===hubId),secondary=secondaryHubId&&state.sites.find(s=>s.id===secondaryHubId);if(!hub)return;
  if(secondaryHubId===hubId)return $("#hub-form-error").textContent="Primary and secondary hubs must be different sites";
  pushHistory();state.topologyMode="hub-spoke";state.policies={...state.policies,spokeToSpoke:fd.get("spokeToSpoke"),centralizedInspection:fd.get("centralizedInspection")==="on",secondaryHubId};
  const hubIds=[hubId,secondaryHubId].filter(Boolean);
  for(const site of state.sites){site.topologyRole=hubIds.includes(site.id)?"hub":"spoke";site.hubId=hubIds.includes(site.id)?null:hubId;site.internetBreakout=hubIds.includes(site.id)?"local":fd.get("internetBreakout")}
  if(fd.get("createLinks")==="on")for(const spoke of state.sites.filter(s=>!hubIds.includes(s.id)))for(const targetHub of [hub,secondary].filter(Boolean)){
    const existing=state.links.find(l=>(l.from===targetHub.id&&l.to===spoke.id)||(l.to===targetHub.id&&l.from===spoke.id));
    if(existing){existing.transitAllowed=true;if(spoke.internetBreakout==="hub")existing.defaultRoute=true}
    else state.links.push(createLink({id:uid(),from:targetHub.id,to:spoke.id,type:"vpn",resilience:secondary?"dual":"single",routingType:"static",transitAllowed:true,defaultRoute:spoke.internetBreakout==="hub",advertisedPrefixes:[targetHub.cidr,spoke.cidr,...(spoke.internetBreakout==="hub"?["0.0.0.0/0"]:[])]}));
  }
  layoutHubSpoke(hubId,secondaryHubId);selected={type:"site",id:hubId};$("#hub-dialog").close();touch();showToast(`${hub.name}${secondary?` and ${secondary.name}`:""} now serve ${state.sites.length-hubIds.length} spokes`);
});
function openTraceDialog(){
  if(state.sites.length<2)return showToast("Add at least two sites before tracing a route");
  const options=state.sites.map(s=>`<option value="${s.id}">${escapeHtml(s.name)}</option>`).join(""),form=$("#trace-form");form.elements.from.innerHTML=options;form.elements.to.innerHTML=options;form.elements.to.value=state.sites[1].id;$("#trace-form-error").textContent="";$("#trace-dialog").showModal();
}
$("#trace-form").addEventListener("submit",e=>{
  e.preventDefault();const fd=new FormData(e.currentTarget);if(fd.get("from")===fd.get("to"))return $("#trace-form-error").textContent="Choose two different sites";
  $("#trace-dialog").close();animateRoute(fd.get("from"),fd.get("to"));
});
function animateRoute(fromId,toId){
  stopTrace();const route=shortestPath(state.sites,state.links,fromId,toId,{topologyMode:state.topologyMode,spokeToSpoke:state.policies?.spokeToSpoke}),from=state.sites.find(s=>s.id===fromId),to=state.sites.find(s=>s.id===toId);
  $("#trace-bar").classList.remove("hidden");$("#trace-title").textContent=`${from?.name||"Source"} → ${to?.name||"Destination"}`;
  if(!route){$("#trace-detail").textContent="No permitted route exists under the current topology policy";return}
  const names=route.sites.map(id=>state.sites.find(s=>s.id===id)?.name).filter(Boolean);$("#trace-detail").textContent=names.join(" → ");
  const svg=$("#link-layer"),dur=2.3;
  if(!prefersReducedMotion.matches)route.links.forEach((linkId,index)=>svg.insertAdjacentHTML("beforeend",`<circle class="trace-particle route-particle" r="6"><animateMotion begin="${index*dur}s" dur="${dur}s" repeatCount="indefinite"><mpath href="#route-${linkId}"/></animateMotion></circle>`));
  $$(".topology-node").forEach(n=>n.classList.toggle("trace-active",route.sites.includes(n.dataset.site)));
}

$("#site-form").addEventListener("submit",e=>{
  e.preventDefault();const fd=new FormData(e.currentTarget),name=fd.get("name").trim(),devices=+fd.get("devices"),growth=+fd.get("growth");let cidr=fd.get("cidr").trim()||suggestSiteRange(devices);
  try{cidr=parseCidr(cidr,{allow31:false}).cidr;if(state.sites.some(s=>s.id!==editingSiteId&&rangesOverlap(cidr,s.cidr)))throw new Error("This site range overlaps an existing site allocation");
    pushHistory();
    if(editingSiteId){const site=state.sites.find(s=>s.id===editingSiteId),canonical=createSite({...site,name,type:fd.get("type"),devices,cidr,wan:fd.get("wan"),growth,topologyRole:fd.get("topologyRole"),internetBreakout:fd.get("internetBreakout"),notes:fd.get("notes").trim()});Object.assign(site,canonical,{id:site.id,hubId:site.hubId,x:site.x,y:site.y});selected={type:"site",id:site.id};showToast("Site updated")}
    else{const index=state.sites.length,stateSite=createSite({id:uid(),name,type:fd.get("type"),devices,cidr,wan:fd.get("wan"),growth,topologyRole:fd.get("topologyRole"),hubId:null,internetBreakout:fd.get("internetBreakout"),notes:fd.get("notes").trim(),x:12+(index%3)*31,y:18+Math.floor(index/3)*34,vlans:[]});state.sites.push(stateSite);selected={type:"site",id:stateSite.id};showToast("Site added. Add its existing or proposed VLANs next.")}
    editingSiteId=null;e.currentTarget.closest("dialog").close();touch();
  }catch(err){$("#site-form-error").textContent=err.message}
});
$("#vlan-form").addEventListener("submit",e=>{
  e.preventDefault();const existing=editingVlanId&&findVlan(editingVlanId),site=existing?.site||state.sites.find(s=>s.id===e.currentTarget.elements.siteId.value);if(!site)return $("#vlan-form-error").textContent="The selected site no longer exists";const fd=new FormData(e.currentTarget);
  const devices=+fd.get("devices"),vid=+fd.get("vid"),reserved=+fd.get("reserved");let cidr=fd.get("cidr").trim();
  try{
    const role=fd.get("role");if(site.vlans.some(v=>v.id!==editingVlanId&&v.vid===vid))throw new Error(`VLAN ${vid} is already used at ${site.name}`);
    if(!cidr)cidr=nextSubnet(site.cidr,prefixForDevices(devices,site.growth,reserved,{transit:role==="transit"}),site.vlans.filter(v=>v.id!==editingVlanId).map(v=>v.cidr));
    cidr=parseCidr(cidr,{allow31:role==="transit"}).cidr;if(!contains(site.cidr,cidr))throw new Error(`${cidr} is outside the site's ${site.cidr} allocation`);
    if(site.vlans.some(v=>v.id!==editingVlanId&&rangesOverlap(cidr,v.cidr)))throw new Error("This subnet overlaps another VLAN at the site");
    const dhcpEnabled=fd.get("dhcpEnabled")==="true",gateway=fd.get("gateway").trim()||firstUsable(cidr),automaticPool=defaultDhcpPool(cidr,reserved,{gateway}),dhcpStart=fd.get("dhcpStart").trim()||automaticPool.start,dhcpEnd=fd.get("dhcpEnd").trim()||automaticPool.end;
    if(!validateGateway(gateway,cidr,{transit:role==="transit"}))throw new Error("Gateway must be a usable host inside the VLAN subnet");
    const poolValidation=validateDhcpPool(cidr,gateway,reserved,{enabled:dhcpEnabled,start:dhcpStart,end:dhcpEnd});
    if(!poolValidation.valid)throw new Error(poolValidation.errors[0]);
    pushHistory();
    const values=createVlan({id:editingVlanId||uid(),name:fd.get("name").trim(),vid,role,devices,cidr,gateway,dhcpEnabled,reserved,dhcpStart:dhcpEnabled?dhcpStart:"",dhcpEnd:dhcpEnabled?dhcpEnd:"",notes:fd.get("notes").trim(),siteCidr:site.cidr});
    let v;if(editingVlanId){v=existing.vlan;Object.assign(v,values);showToast(`${v.name} updated`)}else{v=values;site.vlans.push(v);showToast(`Added ${v.name} as ${v.cidr}`)}
    selected={type:"vlan",id:v.id};editingVlanId=null;e.currentTarget.closest("dialog").close();touch();
  }catch(err){$("#vlan-form-error").textContent=err.message}
});
$("#connect-form").addEventListener("submit",e=>{
  e.preventDefault();const fd=new FormData(e.currentTarget),from=fd.get("from"),to=fd.get("to");
  if(from===to)return $("#connect-form-error").textContent="Choose two different sites";
  if(state.links.some(l=>l.id!==editingLinkId&&((l.from===from&&l.to===to)||(l.from===to&&l.to===from))))return $("#connect-form-error").textContent="These sites are already connected";
  let advertisedPrefixes;try{advertisedPrefixes=String(fd.get("advertisedPrefixes")||"").split(",").map(x=>x.trim()).filter(Boolean).map(x=>parseRoutePrefix(x).cidr)}catch(err){return $("#connect-form-error").textContent=`Advertised prefix: ${err.message}`}
  pushHistory();const values=createLink({id:editingLinkId||uid(),from,to,type:fd.get("type"),resilience:fd.get("resilience"),routingType:fd.get("routingType"),transitAllowed:fd.get("transitAllowed")==="true",defaultRoute:fd.get("defaultRoute")==="on",advertisedPrefixes,notes:fd.get("notes").trim()});
  let l;if(editingLinkId){l=state.links.find(x=>x.id===editingLinkId);Object.assign(l,values);showToast("Connection updated")}else{l=values;state.links.push(l);showToast("Connection added")}editingLinkId=null;selected={type:"link",id:l.id};e.currentTarget.closest("dialog").close();touch();
});
$("#name-form").addEventListener("submit",e=>{e.preventDefault();pushHistory();const fd=new FormData(e.currentTarget);state.name=fd.get("name").trim();state.assumptions=fd.get("assumptions").split("\n").map(x=>x.trim()).filter(Boolean);$("#name-dialog").close();touch()});

document.addEventListener("click",e=>{
  const utilityMenu=$("#utility-menu"),utilityCommand=e.target.closest("#utility-menu .utility-menu-panel button,#utility-menu .utility-menu-panel a");
  if(utilityMenu?.open&&!utilityMenu.contains(e.target))utilityMenu.open=false;
  if(utilityCommand&&!utilityCommand.disabled)queueMicrotask(()=>{utilityMenu.open=false});
  const closeDialog=e.target.closest("[data-close-dialog]");if(closeDialog)return closeDialog.closest("dialog").close();
  const closeInspector=e.target.closest("[data-inspector-close]");if(closeInspector){selected=null;render();$("#inspector").focus();return}
  if(e.target.closest("#home-button,.brand")){e.preventDefault();return showHome()}
  if(e.target.closest("#continue-design")){state.mode=state.mode||"existing";saveState();enterWorkspace();render();return}
  if(e.target.closest("#undo-button"))return restoreHistory(undoStack,redoStack);
  if(e.target.closest("#redo-button"))return restoreHistory(redoStack,undoStack);
  if(e.target.closest("#recommend-button"))return openRecommendDialog("site");
  if(e.target.closest("#projects-button,#welcome-projects"))return openProjects();
  if(e.target.closest("#duplicate-project"))return duplicateProject();
  if(e.target.closest("#new-project"))return newProject();
  if(e.target.closest("#print-report"))return window.print();
  const openProject=e.target.closest("[data-open-project]");if(openProject){const project=loadLibrary()[openProject.dataset.openProject];if(project){state=reviveDesign(project);selected=null;undoStack=[];redoStack=[];nudgeBurst={siteId:null,at:0};saveState();$("#projects-dialog").close();enterWorkspace();render();showToast(`${state.name} opened`)}return}
  const deleteProject=e.target.closest("[data-delete-project]");if(deleteProject&&confirm("Delete this locally saved design?")){const library=loadLibrary();delete library[deleteProject.dataset.deleteProject];storageSet(LIBRARY_KEY,JSON.stringify(library));renderProjectLibrary();showToast("Design deleted");return}
  const recommendVlan=e.target.closest("[data-recommend-vlan]");if(recommendVlan)return openRecommendDialog("vlan",recommendVlan.dataset.recommendVlan);
  const recommendKind=e.target.closest("[data-recommend-kind]");if(recommendKind)return setRecommendationKind(recommendKind.dataset.recommendKind);
  if(e.target.closest("#refresh-recommendation"))return buildRecommendation();
  if(e.target.closest("#apply-recommendation"))return applyRecommendation();
  if(e.target.closest("#hub-spoke-button"))return openHubDialog();
  if(e.target.closest("#mobile-sites-button")){setMobileSites(!$(".tool-panel").classList.contains("mobile-open"));return}
  if(e.target.closest("#zoom-in")){canvasZoom=Math.min(1.5,canvasZoom+.1);return applyCanvasZoom()}
  if(e.target.closest("#zoom-out")){canvasZoom=Math.max(.7,canvasZoom-.1);return applyCanvasZoom()}
  if(e.target.closest("#zoom-fit")){canvasZoom=1;canvasPan={x:0,y:0};return applyCanvasZoom()}
  const startButton=e.target.closest("[data-start]");if(startButton)return start(startButton.dataset.start);
  if(e.target.closest("#add-site-top,#add-site-side,#empty-add-site"))return openSiteDialog();
  const add=e.target.closest("[data-add-vlan],[data-inspector-add-vlan]");if(add)return openVlanDialog(add.dataset.addVlan||add.dataset.inspectorAddVlan);
  const site=e.target.closest("[data-site]");if(site&&!e.target.closest("[data-add-vlan]")){selected={type:"site",id:site.dataset.site};setMobileSites(false);render();return}
  const vlanEl=e.target.closest("[data-vlan]");if(vlanEl){selected={type:"vlan",id:vlanEl.dataset.vlan};setMobileSites(false);render();return}
  const link=e.target.closest("[data-link]");if(link){selected={type:"link",id:link.dataset.link};render();return}
  const view=e.target.closest("[data-view]");if(view){activateView(view.dataset.view);return}
  const tool=e.target.closest("[data-tool]");if(tool){currentTool=tool.dataset.tool;$$("[data-tool]").forEach(b=>b.classList.toggle("active",b===tool));if(currentTool==="connect")openConnectDialog(selected?.type==="site"?selected.id:null);if(currentTool==="trace")openTraceDialog();return}
  if(e.target.closest("#project-name-button")){$("#name-form").elements.name.value=state.name;$("#name-form").elements.assumptions.value=(state.assumptions||[]).join("\n");$("#name-dialog").showModal();return}
  if(e.target.closest("#export-button"))return exportDesign();
  if(e.target.closest("#csv-export"))return exportCsv();
  const flow=e.target.closest("[data-flow]");if(flow){pushHistory();state.flowPolicies=state.flowPolicies||{};const [source,destination]=flow.dataset.flow.split(":"),current=state.flowPolicies[flow.dataset.flow]||flow.textContent.trim(),next=current==="allow"?"restricted":current==="restricted"?"deny":"allow";state.flowPolicies[flow.dataset.flow]=next;flow.classList.remove("allow","restricted","deny");flow.classList.add(next);flow.textContent=next;flow.setAttribute("aria-label",`${source} to ${destination}: ${next}`);showToast(`${source} to ${destination}: ${next}`);touch();return}
  if(e.target.closest("#import-button"))return $("#file-input").click();
  if(e.target.closest("#add-vlan-address"))return openVlanDialog(state.sites[0]?.id);
  const editSite=e.target.closest("[data-edit-site]");if(editSite)return openSiteDialog(editSite.dataset.editSite);
  const editVlan=e.target.closest("[data-edit-vlan]");if(editVlan){const found=findVlan(editVlan.dataset.editVlan);return openVlanDialog(found?.site.id,editVlan.dataset.editVlan)}
  const editLink=e.target.closest("[data-edit-link]");if(editLink)return openConnectDialog(null,editLink.dataset.editLink);
  const delSite=e.target.closest("[data-delete-site]");if(delSite&&confirm("Delete this site, its VLANs and connections?")){pushHistory();state.sites=state.sites.filter(s=>s.id!==delSite.dataset.deleteSite);state.links=state.links.filter(l=>l.from!==delSite.dataset.deleteSite&&l.to!==delSite.dataset.deleteSite);selected=null;touch();$("#inspector").focus();return}
  const delVlan=e.target.closest("[data-delete-vlan]");if(delVlan&&confirm("Delete this VLAN?")){pushHistory();for(const s of state.sites)s.vlans=s.vlans.filter(v=>v.id!==delVlan.dataset.deleteVlan);selected=null;touch();$("#inspector").focus();return}
  const delLink=e.target.closest("[data-delete-link]");if(delLink&&confirm("Delete this connection?")){pushHistory();state.links=state.links.filter(l=>l.id!==delLink.dataset.deleteLink);selected=null;touch();$("#inspector").focus();return}
  const trace=e.target.closest("[data-trace-link]");if(trace)return animateTrace(trace.dataset.traceLink);
  if(e.target.closest("#close-trace"))return stopTrace();
  if(e.target.closest("#rerun-review")){reviewCache=null;renderReview();showToast("Design review updated")}
});
document.addEventListener("keydown",e=>{
  if(e.key==="Escape"){
    const menu=$("#utility-menu");
    if(menu?.open){menu.open=false;menu.querySelector("summary").focus();return}
    // Escape is the keyboard counterpart of the inspector close button.
    if(!$("dialog[open]")&&selected){selected=null;render();$("#inspector").focus()}
  }
  const node=e.target.closest?.(".topology-node"),row=e.target.closest?.(".site-row,.vlan-row"),hit=e.target.closest?.(".link-hit");
  if(node&&e.target===node&&["ArrowLeft","ArrowRight","ArrowUp","ArrowDown"].includes(e.key)){
    e.preventDefault();const site=state.sites.find(s=>s.id===node.dataset.site);if(!site)return;
    // One undo entry per nudge burst, so keyboard moves match pointer drags.
    const now=Date.now();
    if(nudgeBurst.siteId!==site.id||now-nudgeBurst.at>600)pushHistory();
    nudgeBurst={siteId:site.id,at:now};
    if(e.key==="ArrowLeft")site.x=Math.max(0,site.x-2);
    if(e.key==="ArrowRight")site.x=Math.min(82,site.x+2);
    if(e.key==="ArrowUp")site.y=Math.max(0,site.y-2);
    if(e.key==="ArrowDown")site.y=Math.min(84,site.y+2);
    renderCanvas();$(`.topology-node[data-site="${site.id}"]`)?.focus();
    touch();
    return;
  }
  if((node||row||hit)&&!e.target.closest?.("button,a,input,select,textarea")&&["Enter"," "].includes(e.key)){e.preventDefault();selected=node?{type:"site",id:node.dataset.site}:hit?{type:"link",id:hit.dataset.link}:row.dataset.vlan?{type:"vlan",id:row.dataset.vlan}:{type:"site",id:row.dataset.site};render();return}
  const tab=e.target.closest?.('[role="tab"]');if(tab&&["ArrowRight","ArrowDown","ArrowLeft","ArrowUp","Home","End"].includes(e.key)){e.preventDefault();const tabs=$$('[role="tab"]'),index=tabs.indexOf(tab),next=e.key==="Home"?0:e.key==="End"?tabs.length-1:e.key.includes("Right")||e.key.includes("Down")?(index+1)%tabs.length:(index-1+tabs.length)%tabs.length;activateView(tabs[next].dataset.view,true)}
});
$("#recommend-form").addEventListener("submit",e=>e.preventDefault());
$("#recommend-form").addEventListener("input",()=>{clearTimeout(buildRecommendation.timer);buildRecommendation.timer=setTimeout(buildRecommendation,180)});
$("#recommend-form").addEventListener("change",()=>buildRecommendation());

$("#file-input").addEventListener("change",async e=>{
  const file=e.target.files[0];if(!file)return;
  if(file.size>IMPORT_MAX_BYTES){showToast(`Import failed: ${file.name} is larger than 10 MB`);e.target.value="";return}
  try{const text=await file.text(),isCsv=file.name.toLowerCase().endsWith(".csv"),raw=isCsv?designFromCsv(text):JSON.parse(text.replace(/^\uFEFF/,"")),imported=isCsv?raw:migrateDesign(raw,{strict:true});pushHistory();state=imported;state.mode="imported";selected=null;saveState();enterWorkspace();render();showToast(`${isCsv?"CSV":"Design"} imported and validated`)}catch(err){showToast(`Import failed: ${err.message}`)}e.target.value="";
});
function designFromCsv(text){
  const rows=parseCsvRows(text).filter(row=>row.some(value=>value.trim()));if(rows.length<2)throw new Error("CSV must include a header and at least one address record");
  const headers=rows[0].map(h=>h.trim().toLowerCase()),required=headers.includes("record type")?["record type","site range"]:["site","site range","vlan","subnet"];
  if(required.some(h=>!headers.includes(h)))throw new Error(`CSV requires columns: ${required.join(", ")}`);
  const decode=(value,key)=>{let textValue=String(value??"").trim();if(!textValue)return"";textValue=unguardCsvCell(textValue);if(["policies","flow policies","assumptions","links"].includes(key)){try{return JSON.parse(textValue)}catch{throw new Error(`CSV ${key} metadata is not valid JSON`)}}if(key==="site notes"||key==="vlan notes"){try{return JSON.parse(textValue)}catch{return textValue}}return textValue};
  const records=rows.slice(1).map(values=>Object.fromEntries(headers.map((header,index)=>[header,decode(values[index],header)]))),sites=[],siteById=new Map();let metadata=null;
  for(const record of records){
    if(record["record type"]==="design")metadata=record;
    const siteKey=record["site id"]||record.site||uid();
    if(!record.site&&record["record type"]==="design")continue;
    let site=siteById.get(siteKey);
    if(!site){const index=sites.length;site={id:siteKey,name:record.site||"Imported site",type:record["site type"]||"office",cidr:record["site range"],devices:Number(record["site devices"]||record.devices||1),wan:record.wan||"single",growth:Number(record.growth||30),topologyRole:record["site role"]||record.role||"standalone",hubId:record["hub id"]||null,internetBreakout:record["internet breakout"]||"local",notes:record["site notes"]||"Imported from CSV",x:12+(index%3)*31,y:18+Math.floor(index/3)*34,vlans:[]};sites.push(site);siteById.set(siteKey,site)}
    if(!headers.includes("record type")||record["record type"]==="vlan"||record.subnet){const vlanObjectId=record["vlan id"],vlanId=record.vlan||vlanObjectId;if(!vlanId)continue;const cidr=parseCidr(record.subnet).cidr,devices=Math.max(1,Number(record.devices||1)),reserved=Math.max(1,Number(record.reserved||1)),dhcpEnabled=String(record.dhcp||"enabled").toLowerCase()!=="disabled",gateway=record.gateway||firstUsable(cidr),automatic=defaultDhcpPool(cidr,reserved,{gateway}),start=dhcpEnabled?(record["dhcp start"]||automatic.start):"",end=dhcpEnabled?(record["dhcp end"]||automatic.end):"";site.vlans.push(createVlan({id:vlanObjectId&&/^[A-Za-z0-9_-]{1,80}$/.test(vlanObjectId)?vlanObjectId:uid(),name:record["vlan name"]||record.purpose||`VLAN ${vlanId}`,vid:Number(vlanId),role:record.purpose||"other",devices,cidr,gateway,dhcpEnabled,reserved,dhcpStart:start,dhcpEnd:end,notes:record["vlan notes"]||"",siteCidr:site.cidr}));}
  }
  const raw={schema:SCHEMA_ID,version:SCHEMA_VERSION,projectId:metadata?.["project id"]||uid(),name:metadata?.["project name"]||"Imported address plan",mode:"imported",topologyMode:metadata?.["topology mode"]||"custom",policies:metadata?.policies||{spokeToSpoke:"via-hub",centralizedInspection:false,secondaryHubId:null},flowPolicies:metadata?.["flow policies"]||{},assumptions:metadata?.assumptions||["Imported from CSV; confirm site types, WAN design and routing."],sites,links:metadata?.links||[]};
  return migrateDesign(raw,{strict:true});
}

function exportDesign(){
  const blob=new Blob([JSON.stringify(state,null,2)],{type:"application/json"}),a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download=`${state.name.toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"")||"network-design"}.json`;a.click();URL.revokeObjectURL(a.href);showToast("Design exported");
}
function exportCsv(){
  const headers=["Record type","Project ID","Project name","Mode","Topology mode","Policies","Flow policies","Assumptions","Links","Site ID","Site","Site type","Site range","Site devices","WAN","Growth","Site role","Hub ID","Internet breakout","Site notes","VLAN ID","VLAN","VLAN name","Purpose","Subnet","Gateway","Devices","Endpoint capacity","DHCP","DHCP start","DHCP end","Reserved","VLAN notes"],rows=[headers],metadata=[state.projectId,state.name,state.mode||"",state.topologyMode,JSON.stringify(state.policies||{}),JSON.stringify(state.flowPolicies||{}),JSON.stringify(state.assumptions||[]),JSON.stringify(state.links||[])];
  for(const site of state.sites){for(const v of site.vlans)rows.push(["vlan",...metadata,site.id,site.name,site.type,site.cidr,site.devices,site.wan,site.growth,site.topologyRole,site.hubId||"",site.internetBreakout,JSON.stringify(site.notes||""),v.id,v.vid,v.name,v.role,v.cidr,v.gateway,v.devices,safeCapacity(v),v.dhcpEnabled?"enabled":"disabled",v.dhcpStart||"",v.dhcpEnd||"",v.reserved??1,JSON.stringify(v.notes||"")]);if(!site.vlans.length)rows.push(["site",...metadata,site.id,site.name,site.type,site.cidr,site.devices,site.wan,site.growth,site.topologyRole,site.hubId||"",site.internetBreakout,JSON.stringify(site.notes||""),...Array(13).fill("")]);}
  if(!state.sites.length)rows.push(["design",...metadata,...Array(24).fill("")]);
  const csv=rows.map(row=>row.map(value=>`"${guardCsvCell(value).replaceAll('"','""')}"`).join(",")).join("\n"),blob=new Blob([csv],{type:"text/csv"}),a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download=`${state.name.toLowerCase().replace(/[^a-z0-9]+/g,"-")||"network"}-address-plan.csv`;a.click();URL.revokeObjectURL(a.href);showToast("Address plan exported as CSV");
}
function animateTrace(linkId){
  stopTrace();const link=state.links.find(l=>l.id===linkId),a=link&&state.sites.find(s=>s.id===link.from),b=link&&state.sites.find(s=>s.id===link.to);if(!a||!b)return;
  const conflict=rangesOverlap(a.cidr,b.cidr);
  $("#trace-bar").classList.remove("hidden");$("#trace-title").textContent=`${a.name} → ${b.name}`;
  const steps=conflict?["Source VLAN and default gateway","Site edge and route lookup","Trace stopped: destination range overlaps the source site"]:["Source VLAN and default gateway","Site edge and route lookup",`${linkLabel(link)} transport`,"Destination route and VLAN","Path validated"];
  if(!conflict&&!prefersReducedMotion.matches){
    const svg=$("#link-layer");
    svg.insertAdjacentHTML("beforeend",`<circle id="trace-particle" class="trace-particle" r="6"><animateMotion dur="3.2s" repeatCount="indefinite"><mpath href="#route-${link.id}"/></animateMotion></circle>`);
  }
  let i=0;const tick=()=>{$("#trace-detail").textContent=steps[i];$$(".topology-node").forEach(n=>n.classList.toggle("trace-active",n.dataset.site===(i<2?a.id:b.id)));i++;if(i<steps.length)traceTimer=setTimeout(tick,900)};tick();
}
function stopTrace(){clearTimeout(traceTimer);traceTimer=null;$("#trace-bar").classList.add("hidden");$("#trace-particle")?.remove();$$(".route-particle").forEach(p=>p.remove());$$(".topology-node").forEach(n=>n.classList.remove("trace-active"))}
function applyCanvasZoom(){for(const el of [$("#link-layer"),$("#node-layer")]){el.style.transform=`translate(${canvasPan.x}px,${canvasPan.y}px) scale(${canvasZoom})`;el.style.transformOrigin="center center"}}

function capturePointer(e){try{e.currentTarget.setPointerCapture(e.pointerId)}catch{}}
$("#canvas").addEventListener("pointerdown",e=>{
  activePointers.set(e.pointerId,{x:e.clientX,y:e.clientY});
  if(activePointers.size===2){
    if(drag&&!drag.moved){undoStack.pop();updateHistoryButtons()}
    // A drag displaced before the pinch took over is a real edit: settle it
    // through the normal save pipeline instead of stranding it unsaved.
    else if(drag&&drag.moved)touch();
    drag=null;panDrag=null;
    const [a,b]=activePointers.values();
    pinch={dist:Math.hypot(a.x-b.x,a.y-b.y)||1,zoom:canvasZoom};
    return;
  }
  if(activePointers.size>2)return;
  const node=e.target.closest(".topology-node");
  if(!node){if(currentTool==="select"){panDrag={startX:e.clientX,startY:e.clientY,x:canvasPan.x,y:canvasPan.y};capturePointer(e)}return}
  const site=state.sites.find(s=>s.id===node.dataset.site);if(!site)return;
  pushHistory();drag={site,node,startX:e.clientX,startY:e.clientY,x:site.x,y:site.y,moved:false};capturePointer(e);
});
$("#canvas").addEventListener("pointermove",e=>{
  if(activePointers.has(e.pointerId))activePointers.set(e.pointerId,{x:e.clientX,y:e.clientY});
  if(pinch&&activePointers.size>=2){
    const [a,b]=[...activePointers.values()].slice(0,2),dist=Math.hypot(a.x-b.x,a.y-b.y)||1;
    canvasZoom=Math.max(.7,Math.min(1.5,pinch.zoom*dist/pinch.dist));
    return applyCanvasZoom();
  }
  if(panDrag){canvasPan={x:panDrag.x+e.clientX-panDrag.startX,y:panDrag.y+e.clientY-panDrag.startY};applyCanvasZoom();return}
  if(!drag)return;const canvas=$("#canvas"),dx=(e.clientX-drag.startX)/canvasZoom,dy=(e.clientY-drag.startY)/canvasZoom;if(Math.abs(dx)+Math.abs(dy)>3)drag.moved=true;
  drag.site.x=Math.max(0,Math.min(82,drag.x+dx/canvas.clientWidth*100));drag.site.y=Math.max(0,Math.min(84,drag.y+dy/canvas.clientHeight*100));renderCanvas();
});
function releasePointer(e,commit){
  const wasPinch=pinch;
  activePointers.delete(e.pointerId);
  if(wasPinch){
    if(activePointers.size<2){
      pinch=null;
      const remaining=[...activePointers.values()][0];
      if(commit&&remaining)panDrag={startX:remaining.x,startY:remaining.y,x:canvasPan.x,y:canvasPan.y};
      else panDrag=null;
    }
    return;
  }
  if(commit&&panDrag){panDrag=null;return}
  if(!commit)panDrag=null;
  if(!drag)return;
  if(commit&&drag.moved)touch();
  else{
    // A cancelled gesture never happened: put the node back where the drag
    // found it before dropping the history snapshot.
    if(!commit){drag.site.x=drag.x;drag.site.y=drag.y;if(drag.moved)renderCanvas()}
    undoStack.pop();updateHistoryButtons();if(commit){selected={type:"site",id:drag.site.id};render()}
  }
  drag=null;
}
$("#canvas").addEventListener("pointerup",e=>releasePointer(e,true));
$("#canvas").addEventListener("pointercancel",e=>releasePointer(e,false));
$("#canvas").addEventListener("wheel",e=>{if(!e.ctrlKey)return;e.preventDefault();canvasZoom=Math.max(.7,Math.min(1.5,canvasZoom+(e.deltaY<0?.1:-.1)));applyCanvasZoom()},{passive:false});
let resizeFrame=null;window.addEventListener("resize",()=>{stopTrace();cancelAnimationFrame(resizeFrame);resizeFrame=requestAnimationFrame(()=>{const keeper=focusKeeper();renderCanvas();restoreFocus(keeper)})});
// A debounced save must not die with the tab: flush it when the page goes
// away, and when it is only backgrounded (mobile may never fire pagehide).
function flushPendingSave(){if(touch.timer){clearTimeout(touch.timer);touch.timer=null;saveState()}}
window.addEventListener("pagehide",flushPendingSave);
document.addEventListener("visibilitychange",()=>{if(document.visibilityState==="hidden")flushPendingSave()});
// Storage has no merge: when two tabs hold one design, the next save from
// either side silently destroys the other's work. Surface the conflict.
window.addEventListener("storage",e=>{
  if(e.key!==STORAGE_KEY||!e.newValue)return;
  let incoming=null;try{incoming=JSON.parse(e.newValue)}catch{}
  if(!incoming||incoming.projectId===state.projectId&&String(incoming.updatedAt)!==String(state.updatedAt))showToast("This design changed in another browser tab. Export this tab before reloading, or continue here to overwrite the other version.");
});

function findVlan(id){for(const site of state.sites){const vlan=site.vlans.find(v=>v.id===id);if(vlan)return{site,vlan}}return null}
function safeParse(cidr){try{return parseCidr(cidr)}catch{return null}}
function safeCapacity(vlan){try{return endpointCapacity(vlan.cidr,Number(vlan.reserved??1),{gateway:vlan.gateway})}catch{return 0}}
function escapeHtml(value){return String(value??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]))}
function roleClass(role){return ENUMS.vlanRoles.includes(role)?`role-${role}`:"role-other"}

activateView("topology");enterWorkspace();render();
if(storageIssue) showToast(storageIssue);
