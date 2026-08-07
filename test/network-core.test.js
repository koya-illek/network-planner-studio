import test from "node:test";
import assert from "node:assert/strict";
import {
  parseCidr,rangesOverlap,contains,endpointCapacity,prefixForDevices,nextSubnet,
  suggestSiteRange,isPrivateCidr,shortestPath,migrateDesign,defaultDhcpPool,validHostInSubnet
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
  assert.equal(endpointCapacity("10.0.0.0/31"),2);
  assert.equal(prefixForDevices(2,0,0,{transit:true}),31);
  assert.equal(prefixForDevices(60,0,1),26);
});

test("builds a DHCP pool that excludes reserved addresses and the gateway",()=>{
  assert.deepEqual(defaultDhcpPool("10.0.10.0/24",5),{start:"10.0.10.6",end:"10.0.10.254"});
  assert.equal(validHostInSubnet("10.0.10.254","10.0.10.0/24"),true);
  assert.equal(validHostInSubnet("10.0.10.255","10.0.10.0/24"),false);
});

test("allocates the next aligned free subnet",()=>{
  assert.equal(nextSubnet("10.0.0.0/16",24,["10.0.0.0/24","10.0.1.0/24"]),"10.0.2.0/24");
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
  }],links:[]});
  const boundedSite=bounded.sites[0],boundedVlan=boundedSite.vlans[0];
  assert.deepEqual({devices:boundedSite.devices,growth:boundedSite.growth,x:boundedSite.x,y:boundedSite.y},{devices:50000,growth:0,x:0,y:100});
  assert.deepEqual({vid:boundedVlan.vid,devices:boundedVlan.devices,reserved:boundedVlan.reserved},{vid:4094,devices:65534,reserved:1000});
});

test("migrates v1 designs and removes dangling links",()=>{
  const result=migrateDesign({version:1,name:"Old",sites:[{id:"a",name:"A",vlans:[]}],links:[{id:"x",from:"a",to:"missing"}]});
  assert.equal(result.version,2);
  assert.equal(result.sites[0].topologyRole,"standalone");
  assert.ok(result.projectId);
  assert.equal(result.links.length,0);
});

test("sanitizes imported DOM identifiers while preserving links",()=>{
  const result=migrateDesign({sites:[{id:'a\" onclick=\"bad()',name:"A",vlans:[]},{id:"b",name:"B",vlans:[]}],links:[{id:"l",from:'a\" onclick=\"bad()',to:"b"}]});
  assert.match(result.sites[0].id,/^[A-Za-z0-9_-]+$/);
  assert.equal(result.links[0].from,result.sites[0].id);
});
