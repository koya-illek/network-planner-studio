export function ipToInt(ip) {
  const parts=String(ip).trim().split(".");
  if(parts.length!==4||parts.some(p=>!(/^\d+$/.test(p))||+p>255))throw new Error("Invalid IPv4 address");
  return parts.reduce((n,p)=>((n<<8)>>>0)+(+p),0)>>>0;
}

export function intToIp(n){return[(n>>>24)&255,(n>>>16)&255,(n>>>8)&255,n&255].join(".")}

export function parseCidr(value,{allow31=true}={}) {
  const [ip,prefixText,...extra]=String(value).trim().split("/");
  const prefix=Number(prefixText);
  const max=allow31?31:30;
  if(extra.length||!Number.isInteger(prefix)||prefix<8||prefix>max)throw new Error(`Use an IPv4 prefix between /8 and /${max}`);
  const raw=ipToInt(ip),mask=(0xffffffff<<(32-prefix))>>>0,network=(raw&mask)>>>0,size=2**(32-prefix);
  if(raw!==network)throw new Error(`Network address must be ${intToIp(network)}/${prefix}`);
  return{cidr:`${intToIp(network)}/${prefix}`,network,broadcast:(network+size-1)>>>0,prefix,size,usable:prefix===31?2:Math.max(0,size-2)};
}

export function rangesOverlap(a,b){try{const x=parseCidr(a),y=parseCidr(b);return x.network<=y.broadcast&&y.network<=x.broadcast}catch{return false}}
export function contains(parent,child){try{const p=parseCidr(parent),c=parseCidr(child);return p.network<=c.network&&p.broadcast>=c.broadcast}catch{return false}}
export function firstUsable(cidr){try{const p=parseCidr(cidr);return intToIp((p.network+(p.prefix===31?0:1))>>>0)}catch{return""}}
export function endpointCapacity(cidr,reserved=1){const p=parseCidr(cidr);return Math.max(0,p.usable-(p.prefix===31?0:reserved))}
export function defaultDhcpPool(cidr,reserved=1){
  const p=parseCidr(cidr);
  if(p.prefix===31)return{start:"",end:""};
  const start=Math.min(p.broadcast-1,p.network+1+Math.max(1,Number(reserved)||1));
  return{start:intToIp(start>>>0),end:intToIp((p.broadcast-1)>>>0)};
}
export function validHostInSubnet(ip,cidr){
  try{const value=ipToInt(ip),p=parseCidr(cidr);return p.prefix===31?value>=p.network&&value<=p.broadcast:value>p.network&&value<p.broadcast}catch{return false}
}

export function prefixForDevices(devices,growth=30,reserved=1,{transit=false}={}){
  if(transit&&Number(devices)<=2)return 31;
  const needed=Math.ceil(Number(devices)*(1+Number(growth)/100))+2+reserved;
  for(let prefix=30;prefix>=8;prefix--)if(2**(32-prefix)>=needed)return prefix;
  return 8;
}

export function nextSubnet(parentCidr,prefix,occupied=[]){
  const parent=parseCidr(parentCidr),size=2**(32-prefix);
  if(prefix<parent.prefix)throw new Error("Required subnet is larger than the site range");
  for(let n=parent.network;n+size-1<=parent.broadcast;n+=size){
    const candidate=`${intToIp(n)}/${prefix}`;
    if(!occupied.some(c=>rangesOverlap(candidate,c)))return candidate;
  }
  throw new Error("No suitable free subnet remains in this site range");
}

export function suggestSiteRange(occupied=[],devices=50){
  const prefix=Number(devices)>1000?16:Number(devices)>250?18:20;
  const candidates=[];
  for(let second=0;second<=255;second++)candidates.push(`10.${second}.0.0/${prefix}`);
  for(let second=16;second<=31;second++)candidates.push(`172.${second}.0.0/${prefix}`);
  for(let third=0;third<=240;third+=16)candidates.push(`192.168.${third}.0/${Math.max(prefix,20)}`);
  const result=candidates.find(candidate=>!occupied.some(c=>rangesOverlap(candidate,c)));
  if(!result)throw new Error("No compatible private site block remains in the automatic allocation pools");
  return result;
}

export function isPrivateCidr(cidr){
  try{
    const p=parseCidr(cidr);
    return contains("10.0.0.0/8",p.cidr)||contains("172.16.0.0/12",p.cidr)||contains("192.168.0.0/16",p.cidr);
  }catch{return false}
}

export function shortestPath(sites,links,from,to,{topologyMode="custom",spokeToSpoke="via-hub"}={}){
  if(from===to)return{sites:[from],links:[]};
  const byId=new Map(sites.map(s=>[s.id,s]));
  const enforceHubSpoke=topologyMode==="hub-spoke"&&["denied","via-hub"].includes(spokeToSpoke);
  if(enforceHubSpoke&&spokeToSpoke==="denied"&&byId.get(from)?.topologyRole==="spoke"&&byId.get(to)?.topologyRole==="spoke")return null;
  const queue=[{id:from,sitePath:[from],linkPath:[]}],seen=new Set([from]);
  while(queue.length){
    const current=queue.shift();
    for(const link of links.filter(l=>l.from===current.id||l.to===current.id)){
      if(link.transitAllowed===false&&current.id!==from)continue;
      const next=link.from===current.id?link.to:link.from;if(seen.has(next)||!byId.has(next))continue;
      const a=byId.get(current.id),b=byId.get(next);
      if(enforceHubSpoke&&a?.topologyRole==="spoke"&&b?.topologyRole==="spoke")continue;
      const candidate={id:next,sitePath:[...current.sitePath,next],linkPath:[...current.linkPath,link.id]};
      if(next===to)return{sites:candidate.sitePath,links:candidate.linkPath};
      seen.add(next);queue.push(candidate);
    }
  }
  return null;
}

function safeIdentifier(value){const id=String(value||"");return/^[A-Za-z0-9_-]{1,80}$/.test(id)?id:crypto.randomUUID()}
const IMPORT_LIMITS={siteDevices:[1,50000],growth:[0,1000],coordinate:[0,100],vlanId:[1,4094],vlanDevices:[1,65534],reserved:[1,1000]};
function finiteBounded(value,fallback,[min,max],integer=false){
  if(value===null||value===undefined||(typeof value==="string"&&!value.trim())||!(["number","string"].includes(typeof value)))return fallback;
  const numeric=Number(value);if(!Number.isFinite(numeric))return fallback;
  const bounded=Math.min(max,Math.max(min,numeric));return integer?Math.trunc(bounded):bounded;
}
function normalizeVlan(raw={}){
  const v=raw&&typeof raw==="object"?raw:{};
  const reserved=finiteBounded(v.reserved,1,IMPORT_LIMITS.reserved,true),cidr=String(v.cidr||"");let pool={start:"",end:""};try{pool=defaultDhcpPool(cidr,reserved)}catch{}
  return{id:safeIdentifier(v.id),name:String(v.name||"Network").slice(0,100),vid:finiteBounded(v.vid,1,IMPORT_LIMITS.vlanId,true),role:String(v.role||"other").slice(0,30),devices:finiteBounded(v.devices,1,IMPORT_LIMITS.vlanDevices,true),cidr,gateway:String(v.gateway||firstUsable(cidr)),dhcpEnabled:v.dhcpEnabled!==false,reserved,dhcpStart:String(v.dhcpStart||pool.start),dhcpEnd:String(v.dhcpEnd||pool.end),notes:String(v.notes||"").slice(0,2000)};
}
function normalizeSite(raw={}){
  const s=raw&&typeof raw==="object"?raw:{};
  return{id:safeIdentifier(s.id),name:String(s.name||"Site").slice(0,100),type:String(s.type||"office").slice(0,30),cidr:String(s.cidr||""),devices:finiteBounded(s.devices,1,IMPORT_LIMITS.siteDevices,true),wan:String(s.wan||"single"),growth:finiteBounded(s.growth,30,IMPORT_LIMITS.growth),x:finiteBounded(s.x,20,IMPORT_LIMITS.coordinate),y:finiteBounded(s.y,20,IMPORT_LIMITS.coordinate),topologyRole:String(s.topologyRole||"standalone"),hubId:s.hubId?String(s.hubId):null,internetBreakout:String(s.internetBreakout||"local"),notes:String(s.notes||"").slice(0,2000),vlans:Array.isArray(s.vlans)?s.vlans.map(normalizeVlan):[]};
}
function normalizeLink(l={}){
  return{id:safeIdentifier(l.id),from:String(l.from||""),to:String(l.to||""),type:String(l.type||"vpn"),resilience:String(l.resilience||"single"),routingType:String(l.routingType||"static"),transitAllowed:l.transitAllowed!==false,defaultRoute:Boolean(l.defaultRoute),advertisedPrefixes:Array.isArray(l.advertisedPrefixes)?l.advertisedPrefixes.map(String):[]};
}

export function migrateDesign(input){
  if(!input||typeof input!=="object")throw new Error("Design must be a JSON object");
  if(!Array.isArray(input.sites)||!Array.isArray(input.links))throw new Error("Design must contain sites and links arrays");
  const idMap=new Map(),sites=input.sites.map(raw=>{const normalized=normalizeSite(raw);idMap.set(String(raw?.id||""),normalized.id);return normalized}),siteIds=new Set(sites.map(s=>s.id));
  if(siteIds.size!==sites.length)throw new Error("Every site must have a unique ID");
  for(const site of sites)if(site.hubId)site.hubId=idMap.get(site.hubId)||null;
  const links=input.links.map(raw=>normalizeLink({...raw,from:idMap.get(String(raw?.from||""))||raw?.from,to:idMap.get(String(raw?.to||""))||raw?.to})).filter(l=>siteIds.has(l.from)&&siteIds.has(l.to)&&l.from!==l.to);
  return{version:2,projectId:safeIdentifier(input.projectId),name:String(input.name||"Imported network").slice(0,80),mode:String(input.mode||"imported"),topologyMode:String(input.topologyMode||"custom"),policies:{spokeToSpoke:"via-hub",centralizedInspection:false,...input.policies},flowPolicies:input.flowPolicies&&typeof input.flowPolicies==="object"?{...input.flowPolicies}:{},assumptions:Array.isArray(input.assumptions)?input.assumptions.map(String):[],sites,links,updatedAt:new Date().toISOString()};
}
