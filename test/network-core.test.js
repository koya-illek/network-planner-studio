import test from "node:test";
import assert from "node:assert/strict";
import {
  parseCidr,rangesOverlap,contains,endpointCapacity,prefixForDevices,nextSubnet,
  suggestSiteRange,isPrivateCidr,isPrivateRoutePrefix,shortestPath,migrateDesign,defaultDhcpPool,validHostInSubnet,parseRoutePrefix,validateGateway,validateDhcpPool,validateDesign,guardCsvCell,unguardCsvCell,parseCsvRows,intToIp,firstUsable,SCHEMA_ID,SCHEMA_VERSION
} from "../public/network-core.js";

test("parses LAN and point-to-point IPv4 networks",()=>{
  assert.equal(parseCidr("10.0.0.0/24").usable,254);
  assert.equal(parseCidr("10.0.0.0/31").usable,2);
  assert.throws(()=>parseCidr("10.0.0.1/24"),/Network address/);
  assert.throws(()=>parseCidr("10.0.0.0/32"),/between/);
});

test("detects overlap and containment at boundaries",()=>{
  assert.equal(rangesOverlap("10.0.0.0/24","10.0.1.0/24"),false);
  assert.equal(rangesOverlap("10.0.0.0/24","10.0.0.128/25"),true);
  assert.equal(contains("10.0.0.0/16","10.0.20.0/24"),true);
  assert.equal(contains("10.0.0.0/24","10.0.1.0/24"),false);
});

test("capacity reserves the gateway and supports /31 transit",()=>{
  assert.equal(endpointCapacity("10.0.0.0/24"),253);
  assert.equal(endpointCapacity("10.0.0.0/24",1,{gateway:"10.0.0.254"}),252);
  assert.equal(endpointCapacity("10.0.0.0/31"),2);
  assert.equal(prefixForDevices(2,0,0,{transit:true}),31);
  assert.equal(prefixForDevices(60,0,1),26);
});

test("builds a DHCP pool that excludes reserved addresses and the gateway",()=>{
  assert.deepEqual(defaultDhcpPool("10.0.10.0/24",5),{start:"10.0.10.6",end:"10.0.10.254"});
  assert.deepEqual(defaultDhcpPool("10.0.10.0/24",1,{gateway:"10.0.10.254"}),{start:"10.0.10.2",end:"10.0.10.253"});
  assert.deepEqual(defaultDhcpPool("10.0.10.0/24",1,{gateway:"10.0.10.100"}),{start:"10.0.10.101",end:"10.0.10.254"});
  assert.deepEqual(defaultDhcpPool("10.0.10.0/30",1,{gateway:"10.0.10.2"}),{start:"",end:""});
  assert.equal(validHostInSubnet("10.0.10.254","10.0.10.0/24"),true);
  assert.equal(validHostInSubnet("10.0.10.255","10.0.10.0/24"),false);
});

test("allocates the next aligned free subnet",()=>{
  assert.equal(nextSubnet("10.0.0.0/16",24,["10.0.0.0/24","10.0.1.0/24"]),"10.0.2.0/24");
});

test("nextSubnet handles partial overlaps, unsorted entries and exhausted ranges",()=>{
  assert.equal(nextSubnet("10.0.0.0/16",24,[]),"10.0.0.0/24");
  assert.equal(nextSubnet("10.0.0.0/16",24,["10.0.0.128/25","10.0.0.0/25"]),"10.0.1.0/24");
  assert.equal(nextSubnet("10.0.0.0/16",24,["10.0.2.0/24","10.0.0.0/24"]),"10.0.1.0/24");
  assert.equal(nextSubnet("10.0.0.0/24",26,["not-a-cidr","10.0.0.0/33"]),"10.0.0.0/26");
  assert.equal(nextSubnet("10.0.0.0/24",30,["10.0.0.8/30","10.0.0.0/30","10.0.0.4/30"]),"10.0.0.12/30");
  assert.throws(()=>nextSubnet("10.0.0.0/24",24,["10.0.0.0/24"]),/No suitable free subnet remains/);
  assert.throws(()=>nextSubnet("10.0.0.0/24",23,[]),/Required subnet prefix/);
});

test("nextSubnet matches the legacy candidate scan across randomized allocations",()=>{
  const legacy=(parentCidr,prefix,occupied)=>{
    const parent=parseCidr(parentCidr),size=2**(32-prefix);
    for(let network=parent.network;network+size-1<=parent.broadcast;network+=size){
      const candidate=`${intToIp(network)}/${prefix}`;
      if(!occupied.some(value=>rangesOverlap(candidate,value)))return candidate;
    }
    return null;
  };
  let seed=42;
  const rand=()=>{seed=(seed*1103515245+12345)>>>0;return seed/2**32};
  for(let round=0;round<300;round++){
    const parentPrefix=[16,20,22,24][Math.floor(rand()*4)];
    const prefix=parentPrefix+Math.floor(rand()*(31-parentPrefix+1));
    const parent=`10.${Math.floor(rand()*255)}.0.0/${parentPrefix}`;
    const occupied=[];
    for(let i=0,n=Math.floor(rand()*6);i<n;i++){
      if(rand()<.15){occupied.push(`garbage-${i}`);continue}
      try{
        const subnet=nextSubnet(parent,prefix+ (rand()<.3?1:0),occupied);
        occupied.push(subnet);
      }catch{/* range full; stop filling */}
    }
    let result;
    try{result=nextSubnet(parent,prefix,occupied)}catch{result=null}
    assert.equal(result,legacy(parent,prefix,occupied),`mismatch for ${parent} /${prefix} with ${JSON.stringify(occupied)}`);
  }
});

test("allocating a /31 inside a sparsely blocked /8 stays fast",()=>{
  const start=Date.now();
  const result=nextSubnet("10.0.0.0/8",31,["10.255.0.0/16"]);
  assert.equal(result,"10.0.0.0/31");
  assert.ok(Date.now()-start<400,"nextSubnet must not scan the whole parent range");
});

test("suggested site blocks are private and non-overlapping",()=>{
  const result=suggestSiteRange(["10.0.0.0/8"],50);
  assert.equal(isPrivateCidr(result),true);
  assert.equal(rangesOverlap(result,"10.0.0.0/8"),false);
});

test("finds a multi-hop spoke path through a hub",()=>{
  const sites=[{id:"h",topologyRole:"hub"},{id:"a",topologyRole:"spoke"},{id:"b",topologyRole:"spoke"}];
  const links=[{id:"ah",from:"a",to:"h",transitAllowed:true},{id:"hb",from:"h",to:"b",transitAllowed:true}];
  assert.deepEqual(shortestPath(sites,links,"a","b",{topologyMode:"hub-spoke",spokeToSpoke:"via-hub"}),{sites:["a","h","b"],links:["ah","hb"]});
  assert.equal(shortestPath(sites,links,"a","b",{topologyMode:"hub-spoke",spokeToSpoke:"denied"}),null);
});

test("does not traverse a direct spoke link under via-hub policy",()=>{
  const sites=[{id:"h",topologyRole:"hub"},{id:"a",topologyRole:"spoke"},{id:"b",topologyRole:"spoke"}];
  const links=[
    {id:"ab",from:"a",to:"b",transitAllowed:true},
    {id:"ah",from:"a",to:"h",transitAllowed:true},
    {id:"hb",from:"h",to:"b",transitAllowed:true}
  ];
  assert.deepEqual(shortestPath(sites,links,"a","b",{topologyMode:"hub-spoke",spokeToSpoke:"via-hub"}),{sites:["a","h","b"],links:["ah","hb"]});
});

test("bounds malformed imported numeric fields to finite values",()=>{
  const result=migrateDesign({sites:[{
    id:"s",devices:Number.NaN,growth:"not-a-number",x:Infinity,y:"oops",vlans:[
      {id:"v",vid:"NaN",devices:"Infinity",reserved:"bad",cidr:"10.0.0.0/24"}
    ]
  }],links:[]});
  const site=result.sites[0],vlan=site.vlans[0];
  assert.deepEqual({devices:site.devices,growth:site.growth,x:site.x,y:site.y},{devices:1,growth:30,x:20,y:20});
  assert.deepEqual({vid:vlan.vid,devices:vlan.devices,reserved:vlan.reserved},{vid:1,devices:1,reserved:1});
  assert.ok([site.devices,site.growth,site.x,site.y,vlan.vid,vlan.devices,vlan.reserved].every(Number.isFinite));

  const bounded=migrateDesign({sites:[{
    id:"bounded",devices:999999,growth:-5,x:-10,y:999,vlans:[
      {id:"v",vid:9999,devices:999999,reserved:9999,cidr:"10.1.0.0/24"}
    ]
  }],links:[]},{strict:false});
  const boundedSite=bounded.sites[0],boundedVlan=boundedSite.vlans[0];
  assert.deepEqual({devices:boundedSite.devices,growth:boundedSite.growth,x:boundedSite.x,y:boundedSite.y},{devices:50000,growth:0,x:0,y:100});
  assert.deepEqual({vid:boundedVlan.vid,devices:boundedVlan.devices,reserved:boundedVlan.reserved},{vid:4094,devices:65534,reserved:1000});
});

test("migrates v1 designs and removes dangling links",()=>{
  const result=migrateDesign({version:1,name:"Old",sites:[{id:"a",name:"A",vlans:[]}],links:[{id:"x",from:"a",to:"missing"}]});
  assert.equal(result.version,3);
  assert.equal(result.sites[0].topologyRole,"standalone");
  assert.ok(result.projectId);
  assert.equal(result.links.length,0);
});

test("sanitizes imported DOM identifiers while preserving links",()=>{
  const result=migrateDesign({sites:[{id:'a\" onclick=\"bad()',name:"A",vlans:[]},{id:"b",name:"B",vlans:[]}],links:[{id:"l",from:'a\" onclick=\"bad()',to:"b"}]});
  assert.match(result.sites[0].id,/^[A-Za-z0-9_-]+$/);
  assert.equal(result.links[0].from,result.sites[0].id);
});

test("clamps hostile imported link enums so rendered values stay inert",()=>{
  const result=migrateDesign({sites:[{id:"a",name:"A",vlans:[]},{id:"b",name:"B",vlans:[]}],links:[{id:"l",from:"a",to:"b",type:"<script>",resilience:"><img src=x onerror=alert(1)>",routingType:"static;drop"}]},{strict:false});
  const link=result.links[0];
  assert.deepEqual({type:link.type,resilience:link.resilience,routingType:link.routingType},{type:"vpn",resilience:"single",routingType:"static"});
  assert.deepEqual(validateDesign(result,{allowIncomplete:true}).errors.filter(e=>e.code==="invalid-enum"),[]);
});

test("keeps route-prefix validation separate from allocation CIDRs",()=>{
  assert.throws(()=>parseCidr("0.0.0.0/0"),/between/);
  assert.equal(parseRoutePrefix("0.0.0.0/0").cidr,"0.0.0.0/0");
  assert.equal(parseRoutePrefix("192.0.2.1/32").cidr,"192.0.2.1/32");
  assert.equal(isPrivateRoutePrefix("10.20.0.0/16"),true);
  assert.equal(isPrivateRoutePrefix("0.0.0.0/0"),false);
});

test("rejects invalid gateway, reservation and pool combinations",()=>{
  assert.equal(validateGateway("10.40.10.1","10.40.10.0/24"),true);
  assert.equal(validateGateway("10.40.11.1","10.40.10.0/24"),false);
  const conflict=validateDhcpPool("10.40.10.0/24","10.40.10.1",5,{enabled:true,start:"10.40.10.2",end:"10.40.10.50"});
  assert.equal(conflict.valid,false);
  assert.match(conflict.errors.join(" "),/reserved/);
});

test("strict migration rejects hostile structural values and validates canonical schema",()=>{
  const input={schema:SCHEMA_ID,version:SCHEMA_VERSION,sites:[{id:"site",name:"HQ",type:"office",cidr:"10.40.0.0/16",devices:1,wan:"single",growth:30,x:1,y:1,topologyRole:"standalone",internetBreakout:"local",vlans:[{id:"vlan",name:"Staff",vid:10,role:"users",devices:1,cidr:"10.40.10.0/24",gateway:"192.0.2.1",dhcpEnabled:true,reserved:1,dhcpStart:"10.40.10.2",dhcpEnd:"10.40.10.254"}]}],links:[],topologyMode:"custom",policies:{spokeToSpoke:"via-hub",centralizedInspection:false},flowPolicies:{}};
  assert.throws(()=>migrateDesign(input),/Gateway must be/);
  const valid={...input,sites:[{...input.sites[0],vlans:[{...input.sites[0].vlans[0],gateway:"10.40.10.1",dhcpStart:"10.40.10.2",dhcpEnd:"10.40.10.254"}]}]};
  const migrated=migrateDesign(valid);
  assert.equal(migrated.schema,SCHEMA_ID);assert.equal(migrated.version,SCHEMA_VERSION);assert.equal(validateDesign(migrated).valid,true);
});

test("strict v3 migration rejects string booleans instead of changing design intent",()=>{
  const site=(id,cidr,vlanCidr)=>({id,name:id,type:"office",cidr,devices:1,wan:"single",growth:30,x:20,y:20,topologyRole:"standalone",hubId:null,internetBreakout:"local",vlans:[{id:`${id}-vlan`,name:"Staff",vid:10,role:"users",devices:1,cidr:vlanCidr,gateway:firstUsable(vlanCidr),dhcpEnabled:true,reserved:1,dhcpStart:defaultDhcpPool(vlanCidr).start,dhcpEnd:defaultDhcpPool(vlanCidr).end}]});
  const input={schema:SCHEMA_ID,version:SCHEMA_VERSION,name:"Boolean probe",mode:"imported",topologyMode:"custom",policies:{spokeToSpoke:"via-hub",centralizedInspection:false},flowPolicies:{},assumptions:[],sites:[site("a","10.1.0.0/16","10.1.1.0/24"),site("b","10.2.0.0/16","10.2.1.0/24")],links:[{id:"link",from:"a",to:"b",type:"vpn",resilience:"single",routingType:"static",transitAllowed:true,defaultRoute:false,advertisedPrefixes:[]}]};
  assert.throws(()=>migrateDesign({...input,sites:[{...input.sites[0],vlans:[{...input.sites[0].vlans[0],dhcpEnabled:"false"}]},input.sites[1]]}),/must be a boolean/);
  assert.throws(()=>migrateDesign({...input,links:[{...input.links[0],defaultRoute:"false"}]}),/must be a boolean/);
  assert.throws(()=>migrateDesign({...input,policies:{...input.policies,centralizedInspection:"true"}}),/must be a boolean/);
  const recovered=migrateDesign({...input,version:2,sites:[{...input.sites[0],vlans:[{...input.sites[0].vlans[0],dhcpEnabled:"false"}]},input.sites[1]],links:[{...input.links[0],transitAllowed:"false",defaultRoute:"false"}]});
  assert.equal(recovered.sites[0].vlans[0].dhcpEnabled,false);
  assert.equal(recovered.links[0].transitAllowed,false);
  assert.equal(recovered.links[0].defaultRoute,false);
});

test("strict v3 migration rejects invalid numeric types and lenient recovery reports corrections",()=>{
  const input={schema:SCHEMA_ID,version:SCHEMA_VERSION,name:"Number probe",mode:"imported",topologyMode:"custom",policies:{spokeToSpoke:"via-hub",centralizedInspection:false},flowPolicies:{},assumptions:[],sites:[{id:"site",name:"HQ",type:"office",cidr:"10.50.0.0/16",devices:1,wan:"single",growth:30,x:20,y:20,topologyRole:"standalone",hubId:null,internetBreakout:"local",vlans:[{id:"vlan",name:"Staff",vid:5000,role:"users",devices:"30",cidr:"10.50.10.0/24",gateway:"10.50.10.1",dhcpEnabled:true,reserved:1,dhcpStart:"10.50.10.2",dhcpEnd:"10.50.10.254"}]}],links:[]};
  assert.throws(()=>migrateDesign(input),/must be/);
  const recovered=migrateDesign(input,{strict:false});
  assert.equal(recovered.sites[0].vlans[0].vid,4094);
  assert.equal(recovered.sites[0].vlans[0].devices,30);
  assert.ok(recovered.importWarnings.some(message=>message.includes("vid")));
  assert.ok(recovered.importWarnings.some(message=>message.includes("devices")));
});

test("allocation and migration remain finite across generated boundary values",()=>{
  for(let prefix=8;prefix<=31;prefix++){
    const parsed=parseCidr(`10.0.0.0/${prefix}`);
    assert.ok(Number.isFinite(parsed.network)&&Number.isFinite(parsed.broadcast));
    assert.ok(parsed.cidr.endsWith(`/${prefix}`));
  }
});

test("CSV export cells neutralize formula injection and round-trip losslessly",()=>{
  assert.equal(guardCsvCell("=cmd|' /c calc"),"'=cmd|' /c calc");
  assert.equal(guardCsvCell("+1+1"),"'+1+1");
  assert.equal(guardCsvCell("-summary"),"'-summary");
  assert.equal(guardCsvCell("@import"),"'@import");
  assert.equal(guardCsvCell("\t=x"),"'\t=x");
  assert.equal(guardCsvCell("\rcmd"),"'\rcmd");
  assert.equal(guardCsvCell("\ncmd"),"'\ncmd");
  assert.equal(guardCsvCell("  =cmd"),"'  =cmd");
  assert.equal(guardCsvCell("10.20.10.0/24"),"10.20.10.0/24");
  assert.equal(guardCsvCell(42),"42");
  assert.equal(guardCsvCell(""),"");
  assert.equal(guardCsvCell(null),"");
  for(const hostile of ["=cmd","+2","-flag","@x","\ty","\rz","\nrun","  =sum"]){
    const cell=guardCsvCell(hostile);
    assert.notEqual(cell[0],hostile[0]);
    assert.equal(unguardCsvCell(cell),hostile);
  }
  assert.equal(unguardCsvCell("plain"),"plain");
  assert.equal(unguardCsvCell(""),"");
  for(const apostrophe of ["'=literal","'+353","'-flag","'@name","'plain","''nested"]){
    assert.equal(unguardCsvCell(guardCsvCell(apostrophe)),apostrophe);
  }
});

test("CSV records preserve quoted commas, escaped quotes and multiline fields",()=>{
  const csv='\uFEFFName,Notes,Empty\r\n"Cork, IE","Firewall ""handoff""\r\nRack 4",\r\n';
  assert.deepEqual(parseCsvRows(csv),[
    ["Name","Notes","Empty"],
    ["Cork, IE",'Firewall "handoff"\r\nRack 4',""],
  ]);
});

test("CSV records reject malformed quote boundaries",()=>{
  assert.throws(()=>parseCsvRows('Name,Notes\nCork,"unfinished'),/unclosed quoted field/);
  assert.throws(()=>parseCsvRows('Name,Notes\nCork,bad"quote'),/unexpected quote/);
  assert.throws(()=>parseCsvRows('Name,Notes\nCork,"done"tail'),/content after a closing quote/);
});
