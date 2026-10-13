'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'bl-partial-undo-'));for(const key of ['BUYER_LOG_DATA_ROOT','BUYER_LOG_LOCAL_DATA_ROOT','BUYER_LOG_SERVER_DATA_ROOT','BUYER_LOG_AUTH_DATA_ROOT'])process.env[key]=root;
const prefs=require('../server/lib/user-preferences'),{createToolRegistry}=require('../server/lib/agent-tool-registry'),{createAgentOfficeStore}=require('../server/lib/agent-office-store'),{createAgentOfficeService}=require('../server/lib/agent-office-service'),{createAgentRuntime}=require('../server/lib/agent-runtime'),runtimeStore=require('../server/lib/agent-workflow-store'),{createPolicyEngine}=require('../server/lib/agent-policy-engine'),{object,string}=require('../server/lib/agent-capability-contract');
let seq=0;test.after(()=>fs.rmSync(root,{force:true,recursive:true}));
async function fixture(t){
 const profile={id:'partial'+(++seq),enabled:true,areas:['cp']},other={id:profile.id+'-other',enabled:true,areas:['cp']},access={profileById:id=>id===profile.id?profile:id===other.id?other:null,publicProfile:p=>p,hasArea:(p,a)=>p.areas.includes(a),appendAudit:()=>{}},store=createAgentOfficeStore({root:path.join(root,profile.id)}),key='lcw.cp.assistant.first',second='lcw.cp.assistant.second';let service,f;
 const registry=createToolRegistry({userAccess:access,authorizeCapability:(ctx,args)=>service.taskAuthorize(ctx,args)}),snapshot=(ctx,key)=>prefs.load(ctx.ownerId).entries[key]||null,write=(ctx,key,value,before)=>prefs.applyEntryChanges(ctx.ownerId,{[key]:value},[],{expectedEntries:{[key]:before},assertAuthority:()=>ctx.assertAuthority()});
 const guarded=(ctx,work)=>store.withProfileMutation(ctx.ownerId,ctx.input.officeAgentId,ctx.input.officeAgentRevision,()=>{ctx.assertAuthority();return work();});
 const restore=async(token,ctx)=>{
  await f.beforeUndo?.();return guarded(ctx,()=>{if(token.ownerId!==ctx.ownerId)throw Object.assign(new Error('owner'),{code:'OFFICE_ROLLBACK_INVALID'});if(f.undoMode==='unverified')return {verified:false};
   prefs.applyEntryChanges(ctx.ownerId,token.before?{[token.key]:token.before.value}:{},token.before?[]:[token.key],{expectedEntries:{[token.key]:token.after},assertAuthority:()=>ctx.assertAuthority()});f.inverses++;
   return {verified:f.undoMode!=='unverified-after-write'};
  });
 };
 const base={module:'cp',areas:['cp'],agentAreas:['cp'],operation:'UPDATE',risk:'write',inputSchema:{...object({value:string(100)}),required:['value']}};
 registry.registerCapability({...base,id:'test.native.partial',read:(_args,ctx)=>({before:snapshot(ctx,key),secondBefore:snapshot(ctx,second)}),apply:(args,ctx,approved)=>guarded(ctx,()=>{
  const saved=write(ctx,key,args.value,approved.before);f.effects++;
  const receipt={ownerId:ctx.ownerId,key,before:approved.before,after:saved.entries[key]};
  if(f.partial){prefs.applyEntryChanges(ctx.ownerId,{[second]:'peer edit'},[]);try{write(ctx,second,'requested second value',approved.secondBefore);}catch(err){if(err.code!=='OFFICE_PREVIEW_CHANGED')throw err;return {verified:true,outcome:'partial',data:{applied:1,failed:1,errorCode:err.code},...(f.token?{rollbackToken:receipt}:{})};}}
  return {verified:true,data:{value:args.value},rollbackToken:receipt};
 }),restore});
 for(const [id,laterKey]of [['test.native.later',second],['test.native.third','lcw.cp.assistant.third']])registry.registerCapability({...base,id,read:(_args,ctx)=>({before:snapshot(ctx,laterKey)}),apply:(args,ctx,approved)=>guarded(ctx,()=>{const saved=write(ctx,laterKey,args.value,approved.before);return {verified:true,rollbackToken:{ownerId:ctx.ownerId,key:laterKey,before:approved.before,after:saved.entries[laterKey]}};}),restore});
 registry.registerCapability({id:'test.native.read',module:'cp',areas:['cp'],risk:'read',operation:'READ',inputSchema:object({}),read:(_args,ctx)=>({value:snapshot(ctx,key)?.value||null})});
 const runtime=createAgentRuntime({store:runtimeStore,toolRegistry:registry,policyEngine:createPolicyEngine({userAccess:access})});service=createAgentOfficeService({store,userAccess:access,toolRegistry:registry,runtime,runtimeStore,taskOwners:()=>[],getOperationalData:async()=>({})});t.after(()=>service.stop());const agent=await store.createProfile(profile.id,{name:'Native preference worker',areas:['cp']});
 f={profile,other,access,store,registry,service,agent,key,second,partial:true,token:true,effects:0,inverses:0,undoMode:'verified'};return f;
}
const create=(f,later)=>f.service.taskCreate(f.profile,{agentId:f.agent.id,steps:[{id:'first',toolId:'test.native.partial',args:{value:'first effect'}},...(later?[{id:'later',toolId:later,args:later==='test.native.read'?{}:{value:'later effect'}}]:[])]}),apply=(f,j)=>f.service.taskExecute(f.profile,j.id,{confirmed:true,fingerprint:j.steps.find(s=>s.status==='waiting_approval')?.preview?.fingerprint}),undo=(f,j,stepId='first')=>f.service.taskRollback(f.profile,j.id,{stepId,confirmed:true});
test('actual native partial write can be explicitly undone, preserving the conflicting peer record and surviving restart',async t=>{
 const f=await fixture(t),done=await apply(f,await create(f,'test.native.later'));assert.equal(done.status,'partial');assert.equal(done.steps[0].result.data.errorCode,'OFFICE_PREVIEW_CHANGED');assert.equal(prefs.load(f.profile.id).entries[f.key].value,'first effect');assert.equal(prefs.load(f.profile.id).entries[f.second].value,'peer edit');
 const restored=await undo(f,done);assert.equal(restored.status,'rolled_back');assert.equal(restored.steps[0].rollbackStatus,'completed');assert.equal(restored.steps[1].status,'cancelled');assert.equal(prefs.load(f.profile.id).entries[f.key],undefined);assert.equal(prefs.load(f.profile.id).entries[f.second].value,'peer edit');
 const reopened=createAgentOfficeStore({root:path.join(root,f.profile.id)});assert.equal((await reopened.get(f.profile.id,'job',done.id)).status,'rolled_back');await undo(f,restored);assert.equal(f.inverses,1);assert.equal(f.effects,1);
});
test('partial inverse requires confirmation, a real token and the original device',async t=>{
 const f=await fixture(t),done=await apply(f,await create(f));await assert.rejects(f.service.taskRollback(f.profile,done.id,{stepId:'first'}),{code:'OFFICE_ROLLBACK_INVALID'});await f.store.save(f.profile.id,'job',{...done,runtimeDeviceId:'foreign-device'},{expectedRevision:done.revision});await assert.rejects(undo(f,done),{code:'OFFICE_ROLLBACK_INVALID'});assert.equal(f.inverses,0);
 const g=await fixture(t);g.token=false;await assert.rejects(undo(g,await apply(g,await create(g))),{code:'OFFICE_ROLLBACK_INVALID'});assert.equal(g.inverses,0);
});
test('partial tasks never blindly retry their forward write; concurrent undo applies once',async t=>{
 const f=await fixture(t),done=await apply(f,await create(f));await apply(f,done);assert.equal(f.effects,1);const outcomes=await Promise.allSettled([undo(f,done),undo(f,done)]);assert.ok(outcomes.some(r=>r.status==='fulfilled'));assert.equal(f.inverses,1);assert.equal(prefs.load(f.profile.id).entries[f.key],undefined);
});
test('a reserved native inverse blocks downstream execution, preparation, rejection and tick until its actual receipt commits',async t=>{
 const f=await fixture(t);f.partial=false;const done=await apply(f,await create(f,'test.native.later'));assert.equal(done.status,'waiting_approval');let entered,release;const started=new Promise(resolve=>entered=resolve),gate=new Promise(resolve=>release=resolve);f.beforeUndo=async()=>{entered();await gate;};const inverse=undo(f,done);await started;
 try{const reserved=await f.store.get(f.profile.id,'job',done.id);for(const action of [()=>apply(f,reserved),()=>f.service.taskPrepare(f.profile,done.id),()=>f.service.taskReject(f.profile,done.id,{})])await assert.rejects(action(),{code:'OFFICE_TASK_RECONCILE'});await f.service.taskTick(f.profile);assert.equal((await f.store.get(f.profile.id,'job',done.id)).revision,reserved.revision);assert.equal(prefs.load(f.profile.id).entries[f.second],undefined);}finally{release();}
 const restored=await inverse;assert.equal(restored.steps[0].rollbackStatus,'completed');assert.equal(restored.steps[1].status,'cancelled');assert.equal(prefs.load(f.profile.id).entries[f.key],undefined);assert.equal(prefs.load(f.profile.id).entries[f.second],undefined);
});
test('unverified inverse is a failed attempt with an actionable receipt, and a verified retry can finish',async t=>{
 const f=await fixture(t);f.partial=false;const done=await apply(f,await create(f));f.undoMode='unverified';await assert.rejects(undo(f,done),{code:'OFFICE_ROLLBACK_VERIFY_FAILED'});const failed=await f.store.get(f.profile.id,'job',done.id);assert.equal(failed.status,'completed');assert.equal(failed.steps[0].rollbackStatus,'failed');assert.equal(failed.steps[0].rollbackErrorCode,'OFFICE_ROLLBACK_VERIFY_FAILED');assert.equal(prefs.load(f.profile.id).entries[f.key].value,'first effect');f.undoMode='verified';const restored=await undo(f,failed);assert.equal(restored.status,'rolled_back');assert.equal(restored.steps[0].rollbackErrorCode,undefined);assert.equal(f.inverses,1);
});
test('an unverified inverse after a real effect cannot be replayed against its old native revision',async t=>{
 const f=await fixture(t);f.partial=false;const done=await apply(f,await create(f));f.undoMode='unverified-after-write';await assert.rejects(undo(f,done),{code:'OFFICE_ROLLBACK_VERIFY_FAILED'});assert.equal(prefs.load(f.profile.id).entries[f.key],undefined);f.undoMode='verified';await assert.rejects(undo(f,await f.store.get(f.profile.id,'job',done.id)),{code:'OFFICE_PREVIEW_CHANGED'});assert.equal(f.inverses,1);
});
test('a newer native edit is preserved when partial undo fails its actual record CAS',async t=>{
 const f=await fixture(t),done=await apply(f,await create(f));prefs.applyEntryChanges(f.profile.id,{[f.key]:'newer peer value'},[]);await assert.rejects(undo(f,done),{code:'OFFICE_PREVIEW_CHANGED'});assert.equal(prefs.load(f.profile.id).entries[f.key].value,'newer peer value');assert.equal(f.inverses,0);
});
for(const change of ['IAM','agent'])test(change+' revocation at the native inverse boundary blocks partial undo',async t=>{
 const f=await fixture(t),done=await apply(f,await create(f));f.beforeUndo=async()=>{if(change==='IAM')f.profile.areas=[];else await f.store.updateProfile(f.profile.id,f.agent.id,{enabled:false});};await assert.rejects(undo(f,done),err=>['OFFICE_TOOL_FORBIDDEN','OFFICE_AGENT_DISABLED','OFFICE_PREVIEW_CHANGED'].includes(err.code));assert.equal(prefs.load(f.profile.id).entries[f.key].value,'first effect');assert.equal(f.inverses,0);
});
test('a different actual owner cannot read or reverse the partial task',async t=>{const f=await fixture(t),done=await apply(f,await create(f));await assert.rejects(f.service.taskRollback(f.other,done.id,{stepId:'first',confirmed:true}),{code:'OFFICE_NOT_FOUND'});assert.equal(prefs.load(f.profile.id).entries[f.key].value,'first effect');assert.equal(f.inverses,0);});
for(const status of ['completed','partial','waiting_output','running','failed','interrupted','cancelled','queued'])test('downstream '+status+' actual or uncertain mutation prevents undo of its input',async t=>{
 const f=await fixture(t);f.partial=false;let done=await apply(f,await create(f,'test.native.later'));done=await apply(f,done);assert.equal(done.status,'completed');done.steps[1]={...done.steps[1],status,attempts:1};done=await f.store.save(f.profile.id,'job',{...done,status:'interrupted'},{expectedRevision:done.revision});await assert.rejects(undo(f,done),{code:'OFFICE_ROLLBACK_DEPENDENCY'});assert.equal(prefs.load(f.profile.id).entries[f.key].value,'first effect');assert.equal(prefs.load(f.profile.id).entries[f.second].value,'later effect');assert.equal(f.inverses,0);
});
test('a verified downstream inverse releases its upstream dependency without replaying either write',async t=>{
 const f=await fixture(t);f.partial=false;let done=await apply(f,await create(f,'test.native.later'));done=await apply(f,done);done=await undo(f,done,'later');done=await undo(f,done);assert.equal(done.steps[0].status,'rolled_back');assert.equal(done.steps[1].status,'rolled_back');assert.equal(prefs.load(f.profile.id).entries[f.key],undefined);assert.equal(prefs.load(f.profile.id).entries[f.second],undefined);assert.equal(f.inverses,2);
});
test('three verified native inverses preserve downstream receipts and release each earlier dependency in order',async t=>{
 const f=await fixture(t);f.partial=false;let done=await f.service.taskCreate(f.profile,{agentId:f.agent.id,steps:[{id:'first',toolId:'test.native.partial',args:{value:'first effect'}},{id:'later',toolId:'test.native.later',args:{value:'later effect'}},{id:'third',toolId:'test.native.third',args:{value:'third effect'}}]});for(let i=0;i<3;i++)done=await apply(f,done);assert.equal(done.status,'completed');
 for(const stepId of ['third','later','first'])done=await undo(f,done,stepId);assert.deepEqual(done.steps.map(s=>s.status),['rolled_back','rolled_back','rolled_back']);assert.equal(prefs.load(f.profile.id).entries[f.key],undefined);assert.equal(prefs.load(f.profile.id).entries[f.second],undefined);assert.equal(prefs.load(f.profile.id).entries['lcw.cp.assistant.third'],undefined);assert.equal(f.inverses,3);
});
test('failed read-only work does not block a verified upstream inverse',async t=>{
 const f=await fixture(t);f.partial=false;let done=await apply(f,await create(f,'test.native.read'));done=await f.service.taskExecute(f.profile,done.id);done.steps[1]={...done.steps[1],status:'failed',attempts:1};done=await f.store.save(f.profile.id,'job',{...done,status:'failed'},{expectedRevision:done.revision});done=await undo(f,done);assert.equal(done.status,'rolled_back');assert.equal(f.inverses,1);
});
