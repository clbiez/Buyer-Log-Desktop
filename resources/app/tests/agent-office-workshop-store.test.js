'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {createAgentOfficeStore, avatar, normalizeOffice, defaultOffice} = require('../server/lib/agent-office-store');

test('appearance migrates legacy accessories and persists every workshop customization across reopen', async t => {
  assert.equal(avatar({accessory:'glasses'}).glasses,true);
  assert.equal(avatar({accessory:'headphones'}).ornament,'headphones');
  assert.equal(avatar({accessory:'glasses',glasses:false}).glasses,false);
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'bl-workshop-store-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const store=createAgentOfficeStore({root});
  const look={hair:'bun',skin:3,clothes:'rust',accessory:'none',hairColor:'silver',top:'cardigan',bottoms:'cream',shoes:'white',glasses:true,ornament:'scarf'};
  const agent=await store.createProfile('owner-a',{name:'Ada',avatar:look});
  assert.deepEqual((await createAgentOfficeStore({root}).get('owner-a','profile',agent.id)).avatar,look);
  await assert.rejects(store.get('owner-b','profile',agent.id),err=>err.code==='OFFICE_NOT_FOUND');
  await store.updateProfile('owner-a',agent.id,{avatar:{...look,hairColor:'auburn'},revision:agent.revision});
  await assert.rejects(store.updateProfile('owner-a',agent.id,{avatar:look,revision:agent.revision}),err=>err.code==='OFFICE_REVISION_CONFLICT');
});

test('new office settings and templates roundtrip privately; existing legacy layouts remain intact', async t => {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'bl-workshop-layout-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const store=createAgentOfficeStore({root}), initial=await store.state('owner-a');
  assert.equal(initial.office.scene,'workshop-v1'); assert.equal(initial.office.lighting,80);
  const raw={...defaultOffice(),period:'night',lighting:37,lightsOn:false,templates:[{name:'My room',furniture:defaultOffice().furniture}]};
  const saved=await store.save('owner-a','office',{id:'layout',...normalizeOffice(raw)},{expectedRevision:0});
  const reopened=createAgentOfficeStore({root});
  const current=(await reopened.state('owner-a')).office;
  assert.equal(current.period,'night'); assert.equal(current.lighting,37);assert.equal(current.lightsOn,false);
  assert.deepEqual(current.templates,raw.templates);
  assert.equal((await reopened.state('owner-b')).office.period,'auto');
  await assert.rejects(store.save('owner-a','office',{id:'layout',...normalizeOffice(raw)},{expectedRevision:0}),err=>err.code==='OFFICE_REVISION_CONFLICT');
  const legacy={id:'layout',period:'evening',furniture:[{id:'old-desk',kind:'desk',x:11,y:7,rotation:3}]};
  await store.save('legacy-owner','office',legacy);
  assert.deepEqual((await reopened.state('legacy-owner')).office.furniture,legacy.furniture);
  assert.equal((await reopened.state('legacy-owner')).office.scene,undefined);
  assert.deepEqual(normalizeOffice(legacy).furniture,legacy.furniture);
  assert.ok(saved.revision>0);
});

test('workshop normalization bounds visual preferences and strips arbitrary template fields',()=>{
  const office=normalizeOffice({scene:'workshop-v1',lighting:1000,lightsOn:'false',period:'night',templates:Array.from({length:9},(_,i)=>({name:'Room '+i,secret:'private',furniture:[]})),furniture:[{id:'plant',kind:'plant',x:90,y:2,floor:9,rotation:3}]});
  assert.equal(office.lighting,100);assert.equal(office.lightsOn,true);assert.equal(office.templates.length,6);
  assert.deepEqual(Object.keys(office.templates[0]).sort(),['furniture','name']);
  assert.deepEqual(office.furniture[0],{id:'plant',kind:'plant',x:23,y:2,floor:0,rotation:0});
  assert.equal(normalizeOffice({scene:'workshop-v1',lighting:'oops'}).lighting,80);
});

test('workshop rejects furniture collisions, duplicate IDs, blocked stairs and invalid template footprints',()=>{
  const base={scene:'workshop-v1'};
  const desk={id:'a',kind:'desk',x:8,y:2,floor:1};
  for(const furniture of [[desk,{...desk,id:'b',x:9}],[desk,{...desk}],[{...desk,x:2,y:3}],[{...desk,x:0}]]) {
    assert.throws(()=>normalizeOffice({...base,furniture}),err=>err.code==='OFFICE_LAYOUT_INVALID');
  }
  assert.throws(()=>normalizeOffice({...base,furniture:[],templates:[{name:'Invalid',furniture:[{...desk,x:0}]}]}),err=>err.code==='OFFICE_LAYOUT_INVALID');
  assert.doesNotThrow(()=>normalizeOffice(defaultOffice()));
});

test('explicit workshop conversion retains sanitized legacy backup through later changes and reopen',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'bl-workshop-backup-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const store=createAgentOfficeStore({root});
  const previousLayout={scene:'legacy',period:'evening',quality:'high',furniture:[{id:'old-desk',kind:'desk',x:11,y:7,rotation:3}]};
  const first=await store.save('owner-a','office',{id:'layout',...normalizeOffice({...defaultOffice(),previousLayout})},{expectedRevision:0});
  const updated=await store.save('owner-a','office',{id:'layout',...normalizeOffice({...first,period:'night'})},{expectedRevision:first.revision});
  assert.deepEqual((await createAgentOfficeStore({root}).state('owner-a')).office.previousLayout,previousLayout);
  await assert.rejects(store.save('owner-a','office',{id:'layout',...normalizeOffice({...first,period:'morning'})},{expectedRevision:first.revision}),err=>err.code==='OFFICE_REVISION_CONFLICT');
  assert.equal(updated.revision,first.revision+1);
  const sanitized=normalizeOffice({...defaultOffice(),previousLayout:{scene:'workshop-v1',period:'bad',quality:'bad',token:'omit',furniture:[{id:'old',kind:'plant',x:80,y:80,floor:1,rotation:3,secret:'omit'}]}}).previousLayout;
  assert.deepEqual(sanitized,{scene:'legacy',period:'auto',quality:'balanced',furniture:[{id:'old',kind:'plant',x:11,y:7,rotation:3}]});
  assert.equal((await store.state('owner-b')).office.previousLayout,undefined);
});

 test('all 24 agent stations have unique traversable positions and preserve assigned desks',()=>{
  const model=require('../public/agent-office-workshop-model.js');
  const profiles=Array.from({length:24},(_,i)=>({id:'agent-'+i,deskId:['desk-a','desk-b','desk-c'][i]}));
  const items=defaultOffice().furniture,stations=model.stations(profiles,items);
  assert.equal(stations.size,24);
  const points=[...stations.values()].map(s=>s.point);
  assert.ok(points.every(p=>p&&!model.blocked(p,items)));
  assert.equal(new Set(points.map(p=>JSON.stringify(p))).size,24);
  assert.equal(stations.get('agent-0').desk.id,'desk-a');
 });

test('reference furniture scale preserves legacy layouts and survives save, templates and reopen with matching collision bounds',async t=>{
  const model=require('../public/agent-office-workshop-model');
  const legacyItem={id:'old-sofa',kind:'sofa',x:2,y:2,floor:0,rotation:0};
  assert.deepEqual(normalizeOffice({scene:'workshop-v1',furniture:[legacyItem]}).furniture,[legacyItem]);
  assert.equal(model.validPlacement(legacyItem,[legacyItem]),true);
  assert.equal(model.validPlacement({...legacyItem,scale:1.3},[]),false,'Enlarging must not move the object through a wall');
  assert.equal(model.scale({kind:'shelf',scale:1.3}),1);
  assert.equal(normalizeOffice({scene:'workshop-v1',furniture:[{id:'s',kind:'shelf',x:5,y:0,floor:1,scale:1.3}]}).furniture[0].scale,undefined);
  const table={id:'table',kind:'table',x:10,y:2,floor:0,rotation:0,scale:1.3};
  assert.equal(model.blocked({x:7,y:2,floor:0},[table]),true,'Expanded footprint must block the actual newly occupied tile');
  assert.equal(model.blocked({x:7,y:2,floor:0},[{...table,scale:1}]),false);
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'bl-workshop-scale-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const store=createAgentOfficeStore({root});
  await store.save('owner-a','office',{id:'layout',...normalizeOffice({scene:'workshop-v1',furniture:[table],templates:[{name:'Reference',furniture:[table]}]})},{expectedRevision:0});
  const saved=(await createAgentOfficeStore({root}).state('owner-a')).office;
  assert.equal(saved.furniture[0].scale,1.3);assert.equal(saved.templates[0].furniture[0].scale,1.3);
  assert.notDeepEqual((await store.state('owner-b')).office.furniture,saved.furniture);
});
