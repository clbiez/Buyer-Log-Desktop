'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'bl-resource-authority-'));for(const key of ['BUYER_LOG_DATA_ROOT','BUYER_LOG_LOCAL_DATA_ROOT','BUYER_LOG_SERVER_DATA_ROOT','BUYER_LOG_AUTH_DATA_ROOT'])process.env[key]=root;
const db=require('../server/db'),{createToolRegistry}=require('../server/lib/agent-tool-registry'),{createAgentOfficeStore}=require('../server/lib/agent-office-store'),{createAgentOfficeService}=require('../server/lib/agent-office-service'),{createAgentRuntime}=require('../server/lib/agent-runtime'),runtimeStore=require('../server/lib/agent-workflow-store'),{createPolicyEngine}=require('../server/lib/agent-policy-engine');
const {createLocalDb}=require('../server/lib/local-db'),{createDeltaStore}=require('../server/lib/delta-store');
const kinds={
 transit:{id:'resource.transit.replace',args:{rules:[{id:'sea',delType:'Sea',days:51}]},seed:()=>db.replaceTransitRules([{id:'sea',delType:'Sea',days:30}]),read:()=>db.loadOverrides().transitRules},
 royalty:{id:'resource.royalty.replace',args:{rules:[{id:'royalty',licensor:'Demo',license:'Demo',royalty:7,trCommission:5,ydCommission:null,hologramCost:0}]},seed:()=>db.replacePricingRules([{id:'royalty',licensor:'Demo',license:'Demo',royalty:6,trCommission:5,ydCommission:null,hologramCost:0}]),read:()=>db.loadOverrides().pricingRules},
 fx:{id:'resource.fx.update',args:{rates:[{month:'2026-10',currency:'TRY',rate:42}]},seed:()=>db.saveFx({base:'USD',currencies:['USD','TRY'],months:{'2026-10':{USD:1,TRY:40}}}),read:()=>db.loadFx()}
};let seq=0;test.after(()=>{db.attachDeltaStore(null);fs.rmSync(root,{recursive:true,force:true});});
async function fixture(t,kind){
 const profile={id:'resource'+(++seq),enabled:true,areas:['source'],permissions:['manageBusinessRules']},access={profileById:()=>profile,publicProfile:p=>p,hasArea:(p,a)=>p.areas.includes(a),hasPermission:(p,k)=>p.permissions.includes(k),appendAudit:()=>{}},store=createAgentOfficeStore({root:path.join(root,profile.id)});let service,f;
 const registry=createToolRegistry({userAccess:access,authorizeCapability:(ctx,args)=>service.taskAuthorize(ctx,args)});
 const deps={withAgentMutation:async(ctx,work)=>{f.guards++;if(f.pause){f.pause=false;await store.updateProfile(profile.id,f.agent.id,{enabled:false});}return store.withProfileMutation(ctx.ownerId,ctx.input.officeAgentId,ctx.input.officeAgentRevision,()=>{ctx.assertAuthority();return work();});},impact:async()=>({available:false})};require('../server/lib/agent-resource-tools').registerResourceTools(registry,deps);
 const runtime=createAgentRuntime({store:runtimeStore,toolRegistry:registry,policyEngine:createPolicyEngine({userAccess:access})});service=createAgentOfficeService({store,userAccess:access,toolRegistry:registry,runtime,runtimeStore,getOperationalData:async()=>({})});t.after(()=>service.stop());
 const agent=await store.createProfile(profile.id,{name:'Moderator',areas:['source']});f={profile,access,deps,store,service,agent,registry,guards:0,pause:false,kind};kind.seed();return f;
}
const job=f=>f.service.taskCreate(f.profile,{agentId:f.agent.id,steps:[{toolId:f.kind.id,args:f.kind.args}]}),apply=(f,j)=>f.service.taskExecute(f.profile,j.id,{confirmed:true,fingerprint:j.steps[0].preview.fingerprint}),undo=(f,j)=>f.service.taskRollback(f.profile,j.id,{stepId:j.steps[0].id,confirmed:true});
for(const [name,kind]of Object.entries(kinds)){
 test(name+' applies and restores through the actual Office profile WAL and native revision service',async t=>{
  const f=await fixture(t,kind),before=kind.read(),pending=await job(f);await assert.rejects(f.service.taskExecute(f.profile,pending.id),{code:'OFFICE_APPROVAL_REQUIRED'});const done=await apply(f,pending);assert.equal(done.status,'completed');assert.equal(f.guards,1);assert.notDeepEqual(kind.read(),before);await apply(f,done);assert.equal(f.guards,1);await undo(f,done);assert.equal(f.guards,2);
  if(name==='fx')assert.deepEqual(kind.read().months,before.months);else assert.deepEqual(kind.read(),before);
 });
 test(name+' profile pause at native mutation entry blocks a previously approved effect',async t=>{
  const f=await fixture(t,kind),before=kind.read(),pending=await job(f);f.pause=true;const done=await apply(f,pending);assert.equal(done.status,'failed');assert.equal(f.guards,1);assert.equal((await f.store.get(f.profile.id,'profile',f.agent.id)).enabled,false);assert.deepEqual(kind.read(),before);
 });
 test(name+' profile pause at inverse entry protects the already committed source',async t=>{
  const f=await fixture(t,kind),done=await apply(f,await job(f));assert.equal(done.status,'completed');const before=kind.read();f.pause=true;await assert.rejects(undo(f,done),err=>['OFFICE_AGENT_DISABLED','OFFICE_PREVIEW_CHANGED'].includes(err.code));assert.deepEqual(kind.read(),before);assert.equal(f.guards,2);
 });
 for(const mode of ['delta','delta-only'])for(const inverse of [false,true])test(name+' '+mode+' real journal IAM revocation blocks '+(inverse?'inverse':'effect')+' with an independent durable reader',async t=>{
  const local=createLocalDb(path.join(root,name+'-'+mode+'-'+inverse+'.db')),delta=createDeltaStore({localDb:local,mode});await delta.hydrate();db.attachDeltaStore(delta);t.after(()=>db.attachDeltaStore(null));const f=await fixture(t,kind);await delta.flush();let pending=await job(f);if(inverse){pending=await apply(f,pending);assert.equal(pending.status,'completed');}const before=kind.read(),queue=local.queuePatches.bind(local);local.queuePatches=async(...args)=>{f.profile.permissions=[];return queue(...args);};
  if(inverse)await assert.rejects(undo(f,pending),{code:'OFFICE_TOOL_FORBIDDEN'});else{const done=await apply(f,pending);assert.equal(done.status,'failed');assert.equal(done.steps[0].errorCode,'OFFICE_TOOL_FORBIDDEN');}local.queuePatches=queue;
  const reader=createDeltaStore({localDb:createLocalDb(local.file),mode});await reader.hydrate();db.attachDeltaStore(reader);assert.deepEqual(kind.read(),before);
 });
}
for(const [name,kind]of Object.entries(kinds).filter(([name])=>name!=='fx'))for(const mode of ['delta','delta-only'])test(name+' '+mode+' peer notes at the journal lease are not overwritten',async t=>{
 const local=createLocalDb(path.join(root,name+'-peer-'+mode+'.db')),delta=createDeltaStore({localDb:local,mode});await delta.hydrate();db.attachDeltaStore(delta);t.after(()=>db.attachDeltaStore(null));const f=await fixture(t,kind);await delta.flush();const before=kind.read(),pending=await job(f),queue=local.queuePatches.bind(local),peer=createLocalDb(local.file);let changed=false;
 local.queuePatches=async(...args)=>{if(!changed){changed=true;await peer.queuePatches([{id:'store:overrides.json',entityType:'store',patch:{notesmap:{100:{Notes:'Peer journal note'}}}}]);}return queue(...args);};const done=await apply(f,pending);assert.equal(done.status,'failed');assert.equal(done.steps[0].errorCode,'OFFICE_PREVIEW_CHANGED');local.queuePatches=queue;
 const reader=createDeltaStore({localDb:createLocalDb(local.file),mode});await reader.hydrate();db.attachDeltaStore(reader);assert.deepEqual(kind.read(),before);assert.equal(db.loadOverrides().notesmap[100].Notes,'Peer journal note');
});
for(const mode of ['delta','delta-only'])test('FX '+mode+' a peer rate during the actual journal wait remains intact',async t=>{
 const local=createLocalDb(path.join(root,'fx-peer-'+mode+'.db')),delta=createDeltaStore({localDb:local,mode});await delta.hydrate();db.attachDeltaStore(delta);t.after(()=>db.attachDeltaStore(null));const f=await fixture(t,kinds.fx);await delta.flush();const pending=await job(f),queue=local.queuePatches.bind(local),peer=createLocalDb(local.file);let changed=false;
 local.queuePatches=async(...args)=>{if(!changed){changed=true;await peer.queuePatches([{id:'store:fx-rates.json',entityType:'store',patch:{months:{'2026-10':{USD:1,TRY:99}},_revision:db.loadFx()._revision+1}}]);}return queue(...args);};const done=await apply(f,pending);assert.equal(done.status,'failed');assert.equal(done.steps[0].errorCode,'OFFICE_PREVIEW_CHANGED');local.queuePatches=queue;
 const reader=createDeltaStore({localDb:createLocalDb(local.file),mode});await reader.hydrate();db.attachDeltaStore(reader);assert.equal(db.loadFx().months['2026-10'].TRY,99);
});
for(const [name,kind]of Object.entries(kinds))for(const mode of ['delta','delta-only'])test(name+' '+mode+' legitimate effects and exact inverse do not mistake their queued revision for a peer change',async t=>{
 const local=createLocalDb(path.join(root,name+'-lifecycle-'+mode+'.db')),delta=createDeltaStore({localDb:local,mode});await delta.hydrate();db.attachDeltaStore(delta);t.after(()=>db.attachDeltaStore(null));const f=await fixture(t,kind);await delta.flush();const before=kind.read(),done=await apply(f,await job(f));assert.equal(done.status,'completed');await undo(f,done);assert.equal(f.guards,2);
 const reader=createDeltaStore({localDb:createLocalDb(local.file),mode});await reader.hydrate();db.attachDeltaStore(reader);if(name==='fx')assert.deepEqual(kind.read().months,before.months);else assert.deepEqual(kind.read(),before);
});
for(const scope of ['source-only-agent','source-only-user','both'])test('native impact requires current user and Office agent dataset scope: '+scope,async t=>{
 const f=await fixture(t,kinds.transit);let calls=0;const rows=[{'Order Code':1234567,'Ex-factory':'2026-10-15','Delivery Type':'Sea'}];
 if(scope!=='source-only-user')f.profile.areas.push('cp');if(scope!=='source-only-agent')f.agent=await f.store.updateProfile(f.profile.id,f.agent.id,{areas:['source','cp']});
 f.deps.impact=require('../server/lib/agent-resource-impact').createResourceImpact({office:f.store,userAccess:f.access,dataset:async()=>{calls++;return rows;}});
 const pending=await job(f),impact=pending.steps[0].preview.preview.impact;assert.equal(calls,scope==='both'?1:0);assert.equal(impact.available,scope==='both');if(scope!=='both')assert.equal(impact.samples,undefined);
});
for(const change of ['agent','IAM'])test('impact revocation during dataset await cannot expose a stale preview: '+change,async t=>{
 const f=await fixture(t,kinds.transit);f.profile.areas.push('cp');f.agent=await f.store.updateProfile(f.profile.id,f.agent.id,{areas:['source','cp']});
 f.deps.impact=require('../server/lib/agent-resource-impact').createResourceImpact({office:f.store,userAccess:f.access,dataset:async()=>{if(change==='agent')await f.store.updateProfile(f.profile.id,f.agent.id,{areas:['source']});else f.profile.areas=['source'];return [{'Order Code':'PRIVATE_SCOPE_CANARY'}];}});
 await assert.rejects(job(f),{code:'OFFICE_PREVIEW_CHANGED'});const jobs=(await f.store.records(f.profile.id)).filter(r=>r.type==='capability-task');assert.doesNotMatch(JSON.stringify(jobs),/PRIVATE_SCOPE_CANARY/);
});
