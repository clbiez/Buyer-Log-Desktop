'use strict';
/* Office preset sharing: the owner takes another user's Focus/Extended and
   layout presets into their own workspace through the native preset-share
   plan/commit service; approval is bound to the exact plan and the target's
   current state; the inverse restores the exact prior keys and profile stores. */
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'buyerlog-agent-presets-'));
for(const key of ['BUYER_LOG_SERVER_DATA_ROOT','BUYER_LOG_DATA_ROOT','BUYER_LOG_LOCAL_DATA_ROOT','BUYER_LOG_AUTH_DATA_ROOT'])process.env[key]=root;
process.env.BUYER_LOG_CONFIG_PATH=path.join(root,'config.json');
const prefs=require('../server/lib/user-preferences'),{createPresetShare}=require('../server/lib/preset-share');
const {createToolRegistry}=require('../server/lib/agent-tool-registry'),{registerPresetTools}=require('../server/lib/agent-preset-tools');
test.after(()=>fs.rmSync(root,{recursive:true,force:true}));

const stores=new Map();
const loadProfiles=id=>({views:stores.get(`${id}:views`)||{items:[]},filters:stores.get(`${id}:filters`)||{items:[]}});
const restoreProfiles=(id,next)=>{for(const [kind,store]of Object.entries(next))stores.set(`${id}:${kind}`,JSON.parse(JSON.stringify(store)));};
const presetShare=createPresetShare({loadProfiles,restoreProfiles});
const seed=(userId,values)=>{const stamp=new Date(Date.now()-60000).toISOString();prefs.merge(userId,Object.fromEntries(Object.entries(values).map(([key,value])=>[key,{value:JSON.stringify(value),updatedAt:stamp}])));};
const write=(userId,values)=>prefs.applyEntryChanges(userId,Object.fromEntries(Object.entries(values).map(([key,value])=>[key,JSON.stringify(value)])),[]);
const value=(userId,key)=>{const entry=prefs.load(userId).entries[key];return entry?JSON.parse(entry.value):undefined;};
const users={owner:{id:'owner',displayName:'Owner'},source:{id:'source',displayName:'DEMO Kaynak'}};
const owner=users.owner,input={officeJobId:'job-p',officeStepId:'step-p',officeAgentId:'agent-p'};
const ctx={ownerId:owner.id,profile:owner,input,approvalGranted:true,assertAuthority:()=>{}};
function tools(){
  const registry=createToolRegistry({userAccess:{profileById:id=>users[id],hasArea:()=>true,appendAudit:()=>{}},authorizeCapability:async()=>true});
  registerPresetTools(registry,{withAgentMutation:(_c,work)=>work(),presetShare,users:me=>Object.values(users).filter(u=>u.id!==me.id).map(u=>({id:u.id,name:u.displayName,title:'',role:''})),
    sourceProfile:id=>users[id]||null,displayName:u=>u.displayName,loadProfiles,restoreProfiles,applyEntryChanges:(...a)=>prefs.applyEntryChanges(...a)});
  return registry;
}
const FOCUS='lcw.tableViewFocus.v1';

test('read lists other active users and previews the source presets without writing',async()=>{
  seed('source',{[FOCUS]:{cp:{mode:'focus',columns:['Order Code','Model Name']}}});
  const registry=tools();
  const list=await registry.execute('presets.share.read',{},ctx);
  assert.deepEqual(list.data.users.map(u=>u.id),['source']);
  const preview=await registry.execute('presets.share.read',{sourceUserId:'source'},ctx);
  assert.equal(preview.data.items.find(item=>item.id==='tablePresets').count>0,true);
  await assert.rejects(registry.execute('presets.share.read',{sourceUserId:'owner'},ctx),{code:'OFFICE_TASK_INVALID'});
  await assert.rejects(registry.execute('presets.share.read',{},{...ctx,ownerId:'someone-else'}),{code:'OFFICE_TOOL_FORBIDDEN'});
});

test('apply is approval-bound to the plan and target state, verified, and its inverse restores exactly',async()=>{
  seed('owner',{[FOCUS]:{orders:{mode:'extended',columns:['Order Code']}}});
  stores.set('source:views',{items:[{id:'v1',name:'DEMO görünüm',page:'cp',settings:{}}],favoriteByPage:{}});
  const registry=tools(),args={sourceUserId:'source',items:['tablePresets','views'],mode:'MERGE'};
  const beforeEntry=prefs.load('owner').entries[FOCUS],beforeViews=JSON.stringify(loadProfiles('owner').views);
  await assert.rejects(registry.execute('presets.share.apply',{...args,items:['invented']},{...ctx,dryRun:true}),{code:'OFFICE_TOOL_SCHEMA'});
  const preview=await registry.execute('presets.share.apply',args,{...ctx,dryRun:true});
  assert.equal(preview.preview.changed,true);assert.deepEqual(preview.preview.setKeys,[FOCUS]);assert.deepEqual(preview.preview.profiles,['views']);
  // The owner changes their own preset after the preview: the approval no longer matches.
  write('owner',{[FOCUS]:{orders:{mode:'focus',columns:['Order Code','Supplier']}}});
  await assert.rejects(registry.execute('presets.share.apply',{...args,fingerprint:preview.fingerprint},ctx),{code:'OFFICE_PREVIEW_CHANGED'});
  const ownerBefore=prefs.load('owner').entries[FOCUS];
  assert.notDeepEqual(ownerBefore,beforeEntry);
  const fresh=await registry.execute('presets.share.apply',args,{...ctx,dryRun:true});
  const result=await registry.execute('presets.share.apply',{...args,fingerprint:fresh.fingerprint},ctx);
  assert.equal(result.verified,true);
  assert.deepEqual(Object.keys(value('owner',FOCUS)).sort(),['cp','orders'],'MERGE keeps the owner pages and adds the source page');
  assert.equal(loadProfiles('owner').views.items.some(item=>item.name==='DEMO görünüm'),true);
  assert.equal(presetShare.undoInfo('owner').available,true);
  assert.equal(result.rollbackToken.entries,undefined,'prior values live in the bound artifact');
  await assert.rejects(registry.rollback('presets.share.apply',result.rollbackToken,{...ctx,input:{...input,officeStepId:'other'}}),{code:'OFFICE_ROLLBACK_INVALID'});
  const restored=await registry.rollback('presets.share.apply',result.rollbackToken,ctx);
  assert.equal(restored.verified,true);
  assert.equal(prefs.load('owner').entries[FOCUS].value,ownerBefore.value);
  assert.equal(JSON.stringify(loadProfiles('owner').views),beforeViews);
  assert.equal(presetShare.undoInfo('owner').available,false,'the menu undo slot of the reverted application is discarded');
  assert.deepEqual(value('source',FOCUS),{cp:{mode:'focus',columns:['Order Code','Model Name']}},'source record is never written');
});

test('inverse is refused when the owner changed an affected preset after the effect',async()=>{
  seed('source',{'lcw.table.columnState.v1':{cp:{order:['A','B']}}});
  const registry=tools(),args={sourceUserId:'source',items:['columnLayout'],mode:'REPLACE'};
  const fresh=await registry.execute('presets.share.apply',args,{...ctx,dryRun:true});
  const result=await registry.execute('presets.share.apply',{...args,fingerprint:fresh.fingerprint},ctx);
  write('owner',{'lcw.table.columnState.v1':{cp:{order:['B','A']}}});
  await assert.rejects(registry.rollback('presets.share.apply',result.rollbackToken,ctx),{code:'OFFICE_PREVIEW_CHANGED'});
  assert.deepEqual(value('owner','lcw.table.columnState.v1'),{cp:{order:['B','A']}});
});

test('user menu apply keeps its behaviour after the plan/commit split',()=>{
  seed('source',{'lcw.freeze.v1':{cp:2}});
  const result=presetShare.apply({sourceUserId:'source',targetUserId:'menu-user',items:['columnLayout'],mode:'MERGE'});
  assert.equal(result.changed,true);assert.deepEqual(value('menu-user','lcw.freeze.v1'),{cp:2});
  const undone=presetShare.undo('menu-user');assert.equal(undone.ok,true);assert.equal(value('menu-user','lcw.freeze.v1'),undefined);
});

test('commit refuses a profile store changed after the plan before writing anything',()=>{
  stores.set('source:filters',{items:[{id:'f1',name:'DEMO filtre',page:'cp',settings:{}}],favoriteByPage:{}});
  const planned=presetShare.plan({sourceUserId:'source',targetUserId:'cas-user',items:['filters','columnLayout'],mode:'MERGE'});
  const {profileDigest}=require('../server/lib/preset-share');
  const expectedProfiles={filters:profileDigest(planned.previousProfiles.filters)};
  stores.set('cas-user:filters',{items:[{id:'mine',name:'Saved in another tab',page:'cp',settings:{}}]});
  assert.throws(()=>presetShare.commit(planned,{expectedEntries:planned.targetEntries,expectedProfiles}),{code:'OFFICE_PREVIEW_CHANGED'});
  assert.equal(loadProfiles('cas-user').filters.items[0].id,'mine');
  assert.equal(value('cas-user','lcw.freeze.v1'),undefined,'no entry was written either');
});
