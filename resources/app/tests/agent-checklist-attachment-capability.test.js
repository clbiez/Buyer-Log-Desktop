'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'bl-agent-checklist-attachments-'));for(const key of ['BUYER_LOG_DATA_ROOT','BUYER_LOG_LOCAL_DATA_ROOT','BUYER_LOG_SERVER_DATA_ROOT','BUYER_LOG_AUTH_DATA_ROOT'])process.env[key]=root;
const native=require('../server/lib/checklist-supplier-store'),{createToolRegistry}=require('../server/lib/agent-tool-registry'),{createAgentOfficeStore,hash}=require('../server/lib/agent-office-store'),{createAgentOfficeService}=require('../server/lib/agent-office-service'),{createAgentRuntime}=require('../server/lib/agent-runtime'),runtimeStore=require('../server/lib/agent-workflow-store'),{createPolicyEngine}=require('../server/lib/agent-policy-engine');
test.after(()=>fs.rmSync(root,{recursive:true,force:true}));let seq=0;
async function fixture(t){const profile={id:'shared-cp-'+(++seq),enabled:true,areas:['cp'],systemRole:'buyer',directPermissions:['VIEW','CREATE','EDIT','DELETE'].map(action=>({permission:'CP.'+action}))},access={profileById:()=>profile,publicProfile:p=>p,hasArea:(p,a)=>p.areas.includes(a),hasCapability:(p,code)=>require('../server/lib/iam-core').hasPermission(p,code,{users:[p],iam:{roles:{buyer:{permissions:[]}}}}),appendAudit:()=>{}};let service;const office=createAgentOfficeStore({root:path.join(root,profile.id)}),registry=createToolRegistry({userAccess:access,authorizeCapability:(ctx,args)=>service.taskAuthorize(ctx,args)}),rows=[{'Order Code':'DEMO-1',Country:'CHINA'}];let revision=1;const allowed=new Map([['DEMO-1',{orderCode:'1'}],['DEMO-2',{orderCode:'2'}]]);fs.mkdirSync(path.dirname(native.FILE),{recursive:true});fs.writeFileSync(native.FILE,JSON.stringify({revision:0,definitions:[],answers:{},tombstones:{},events:[]}));const deps={authorizedOrders:async()=>allowed,data:async()=>({cpRows:rows,personalRules:[],deletedRuleIds:[]}),sourceRevision:()=>String(revision),withAgentMutation:(ctx,work)=>office.withProfileMutation(ctx.ownerId,ctx.input.officeAgentId,ctx.input.officeAgentRevision,()=>{ctx.assertAuthority();return work();})};require('../server/lib/agent-checklist-answer-tools').registerChecklistAnswerTools(registry,deps);require('../server/lib/agent-checklist-attachment-tools').registerChecklistAttachmentTools(registry,deps);service=createAgentOfficeService({store:office,userAccess:access,toolRegistry:registry,runtime:createAgentRuntime({store:runtimeStore,toolRegistry:registry,policyEngine:createPolicyEngine({userAccess:access})}),runtimeStore,getOperationalData:async()=>({}),engine:{}});t.after(()=>service.stop());const agent=await office.createProfile(profile.id,{name:'Shared CP checklist',areas:['cp']});return {profile,office,registry,service,agent,rows,deps,allowed,changeSource:()=>revision++};}
const create=(f,toolId,args)=>f.service.taskCreate(f.profile,{agentId:f.agent.id,steps:[{toolId,args}]}),apply=(f,job)=>f.service.taskExecute(f.profile,job.id,{confirmed:true,fingerprint:job.steps[0].preview.fingerprint}),undo=(f,job)=>f.service.taskRollback(f.profile,job.id,{stepId:job.steps[0].id,confirmed:true});

/* Checklist evidence attachment lifecycle for Office: list scoped attachments,
   remove one from an answer through the native answer write, keep the stored
   file (history references it) and restore the exact prior answer. */
const seedAnswer=f=>{const a=native.addAttachmentBuffer(Buffer.from('DEMO evidence A'),{filename:'demo-a.pdf'},f.profile),b=native.addAttachmentBuffer(Buffer.from('DEMO evidence B'),{filename:'demo-b.pdf'},f.profile);
  native.applyEntries([{orderKey:'DEMO-1',itemId:'tests',state:'approved',note:'kept note',reportNumber:'DEMO-R1',actualDate:'2026-10-01',supplier:'DEMO SUPPLIER',itemLabel:'DEMO TEST',attachments:[a,b]},{orderKey:'OUTSIDE_SCOPE',itemId:'tests',state:'approved',attachments:[a]}],f.profile);return {a,b};};
test('attachment READ lists only scoped answers with file existence',async t=>{const f=await fixture(t),{a,b}=seedAnswer(f),ctx={ownerId:f.profile.id,profile:f.profile};
  const result=await f.registry.execute('cp.checklist.attachments.read',{orderKeys:['DEMO-1']},ctx);
  assert.deepEqual(result.data.answers.map(x=>x.key),['DEMO-1::tests']);assert.deepEqual(result.data.answers[0].attachments.map(x=>[x.id,x.exists]),[[a.id,true],[b.id,true]]);
  await assert.rejects(f.registry.execute('cp.checklist.attachments.read',{orderKeys:['OUTSIDE_SCOPE']},ctx),{code:'OFFICE_TOOL_FORBIDDEN'});});
test('approved removal keeps state and evidence fields, keeps the file and the inverse restores the exact answer',async t=>{const f=await fixture(t),{a,b}=seedAnswer(f),before=JSON.parse(JSON.stringify(native._read().answers['DEMO-1::tests']));
  const job=await create(f,'cp.checklist.attachment.remove',{entries:[{orderKey:'DEMO-1',itemId:'tests',attachmentId:a.id}]});
  assert.equal(job.steps[0].preview.preview.changes[0].remaining,1);
  await assert.rejects(f.service.taskExecute(f.profile,job.id,{}),{code:'OFFICE_APPROVAL_REQUIRED'});
  const done=await apply(f,job);assert.equal(done.status,'completed');
  const now=native._read().answers['DEMO-1::tests'];
  assert.deepEqual(now.attachments.map(x=>x.id),[b.id]);assert.equal(now.state,'approved');assert.equal(now.note,'kept note');assert.equal(now.reportNumber,'DEMO-R1');assert.equal(now.actualDate,'2026-10-01');assert.equal(now.supplier,'DEMO SUPPLIER');
  assert.ok(native.getAttachmentPath(a.id),'stored file stays: history still references it');
  assert.equal(native.deleteAttachment(a.id),false,'native orphan delete still refuses a referenced file');
  assert.equal((await undo(f,done)).status,'rolled_back');
  assert.deepEqual(native._read().answers['DEMO-1::tests'],before);});
test('unknown attachment, out-of-scope order or VIEW-only profile cannot remove evidence',async t=>{const f=await fixture(t),{a}=seedAnswer(f);
  await assert.rejects(create(f,'cp.checklist.attachment.remove',{entries:[{orderKey:'DEMO-1',itemId:'tests',attachmentId:'0'.repeat(32)}]}),{code:'OFFICE_NOT_FOUND'});
  await assert.rejects(create(f,'cp.checklist.attachment.remove',{entries:[{orderKey:'OUTSIDE_SCOPE',itemId:'tests',attachmentId:a.id}]}),{code:'OFFICE_TOOL_FORBIDDEN'});
  await assert.rejects(create(f,'cp.checklist.attachment.remove',{entries:[{orderKey:'DEMO-1',itemId:'tests',attachmentId:a.id},{orderKey:'DEMO-1',itemId:'tests',attachmentId:a.id}]}),{code:'OFFICE_TASK_INVALID'});
  f.profile.directPermissions=[{permission:'CP.VIEW'}];
  await assert.rejects(create(f,'cp.checklist.attachment.remove',{entries:[{orderKey:'DEMO-1',itemId:'tests',attachmentId:a.id}]}),{code:'OFFICE_TOOL_FORBIDDEN'});
  assert.equal(native._read().answers['DEMO-1::tests'].attachments.length,2);});
test('a peer answer edit after preview invalidates the approval; a later peer edit refuses the inverse',async t=>{const f=await fixture(t),{a}=seedAnswer(f);
  const job=await create(f,'cp.checklist.attachment.remove',{entries:[{orderKey:'DEMO-1',itemId:'tests',attachmentId:a.id}]});
  native.applyEntries([{orderKey:'DEMO-1',itemId:'tests',state:'approved',note:'peer note'}],f.profile);
  const stale=await f.service.taskExecute(f.profile,job.id,{confirmed:true,fingerprint:job.steps[0].preview.fingerprint}).catch(e=>e);
  assert.equal(stale.status,'failed','the changed answer fails the stale step instead of applying it');
  assert.equal(native._read().answers['DEMO-1::tests'].attachments.length,2);
  const done=await apply(f,await create(f,'cp.checklist.attachment.remove',{entries:[{orderKey:'DEMO-1',itemId:'tests',attachmentId:a.id}]}));assert.equal(done.status,'completed');
  native.applyEntries([{orderKey:'DEMO-2',itemId:'tests',state:'approved'}],f.profile);
  const refused=await undo(f,done).catch(e=>e);assert.equal(refused.code,'CHECKLIST_REVISION_CONFLICT');
  assert.deepEqual(native._read().answers['DEMO-1::tests'].attachments.length,1);});
