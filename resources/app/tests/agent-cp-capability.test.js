'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createToolRegistry}=require('../server/lib/agent-tool-registry');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'buyerlog-cp-pilot-'));
process.env.BUYER_LOG_DATA_ROOT=root;process.env.BUYER_LOG_LOCAL_DATA_ROOT=root;process.env.BUYER_LOG_SERVER_DATA_ROOT=root;process.env.BUYER_LOG_AUTH_DATA_ROOT=root;
test.after(()=>fs.rmSync(root,{recursive:true,force:true}));
const preferences=require('../server/lib/user-preferences');
const {createCpRulePreferences}=require('../server/lib/cp-agent-preferences');
const {createAgentOfficeStore}=require('../server/lib/agent-office-store');
const {createAgentOfficeService}=require('../server/lib/agent-office-service');
const runtimeStore=require('../server/lib/agent-workflow-store');
const {createAgentRuntime}=require('../server/lib/agent-runtime');
const {createPolicyEngine}=require('../server/lib/agent-policy-engine');
const mail=require('../server/lib/automation-email');
const CP=require('../public/cp-readiness-engine');

let sequence=0;
async function fixture(t){
  const owner=`owner${++sequence}`,profile={id:owner,enabled:true,areas:['cp','automations']},audits=[];
  const access={profileById:key=>key===owner?profile:null,hasArea:(actor,area)=>actor?.areas.includes(area),hasCapability:()=>true,roleWorkspaceEntries:()=>({}),appendAudit:(...args)=>audits.push(args)};
  const store=createAgentOfficeStore({root:path.join(root,owner)}),prefs=createCpRulePreferences(preferences,access);
  const agent=await store.createProfile(owner,{name:'Ada',role:'CP',areas:['cp']});
  let sourceRevision='1',calls=0,drafts=0,authorize=async()=>{};const samples={models:{}};
  const rows=[{ 'Order Code':'1234567','Model Name':'DEMO','C.Code':'BLU','PLM ID':'7654321','Order Quantity':120,'Ex-factory':'2026-10-14',Manufacturer:'DEMO SUPPLIER'}, {'Order Code':'1234568','Model Name':'DEMO','C.Code':'RED','Order Quantity':80,'Ex-factory':'2026-10-20',Manufacturer:'DEMO SUPPLIER'}];
  const data=async()=>({cpAvailable:true,cpRows:rows,sourceRevision,samples,personalRules:[...prefs.ruleSnapshot(profile,'priority').rules,...prefs.ruleSnapshot(profile,'checklist').rules],deletedRuleIds:[],today:CP.defaultOrdinal('2026-10-11'),checklist:{answers:{}},transitRules:[]});
  const adapter={...prefs,data,calendar:()=>({configured:true,calendar:{weeks:[{year:2026,week:41,month:10,monthWeek:2,start:'2026-10-13',end:'2026-10-19'}]}}),assertRevision:(_profile,expected)=>{if(expected!==sourceRevision)throw Object.assign(new Error('changed'),{code:'OFFICE_PREVIEW_CHANGED'});},authorize:ctx=>authorize(ctx),
    mail:(_profile,args,selected,dryRun,expected)=>{const preview={messages:[{to:['demo@example.invalid'],subject:args.subject,body:args.body,rows:selected.length}],unresolved:[],sendAvailable:false};if(dryRun)return preview;assert.deepEqual(expected,preview);drafts++;const draft=mail.createDraft({name:'Demo',ownerId:owner,language:args.language,to:['demo@example.invalid'],subject:args.subject,body:args.body,rows:selected,fields:['Order Code'],open:false});return{emails:[{...preview.messages[0],filename:draft.filename}],unresolved:[],sendAvailable:false};},verifyMail:result=>result.emails.every(item=>Boolean(mail.draftPath(item.filename,owner)))};
  const registry=createToolRegistry({userAccess:access,cp:adapter});
  const runtime=createAgentRuntime({store:runtimeStore,toolRegistry:registry,policyEngine:createPolicyEngine({userAccess:access})});
  const engine={ask:async()=>{calls++;return{structured:{ok:true},data:{formula:'=[@daysToLoad]<=14',priority:'CRITICAL',explanation:'Demo condition'}};}};
  const service=createAgentOfficeService({store,userAccess:access,engine,getOperationalData:data,toolRegistry:registry,runtime,cpData:data,cpGroups:()=>[],cpDraftPath:(owner,filename)=>mail.draftPath(filename,owner)});t.after(()=>service.stop());
  const request={agentId:agent.id,kind:'rule',ruleKind:'checklist',name:'Demo kontrol',nameEn:'Demo check',task:'Yüklemeye 14 gün kalan siparişlere sor.'};
  const approve=job=>service.cpExecute(profile,job.id,{confirmed:true,fingerprint:job.preview.fingerprint});
  return {owner,profile,agent,store,prefs,access,registry,runtime,service,request,approve,rows,samples,audits,engine,get calls(){return calls;},get drafts(){return drafts;},change:()=>{sourceRevision=String(Number(sourceRevision)+1);},authorize:fn=>{authorize=fn;}};
}

test('CP pilot tools carry validated schemas and explicit execution contracts',()=>{
  const registry=createToolRegistry({cp:{}});
  assert.deepEqual(registry.catalog().filter(tool=>tool.module==='cp').map(tool=>tool.id).sort(),require('../server/lib/agent-office-cp').TOOL_IDS.slice().sort(),'new tools require an Office access matrix decision');
  for(const id of ['cp.rule.preview','cp.rule.save','cp.weekly.preview','cp.weekly.draft']){
    const tool=registry.get(id);assert.ok(tool,id);
    assert.equal(tool.contractVersion,1);assert.equal(tool.module,'cp');
    assert.equal(tool.inputSchema.type,'object');assert.equal(tool.outputSchema.type,'object');
    assert.ok(tool.dataScope);assert.ok(tool.audit);assert.ok(tool.idempotency);assert.ok(tool.validation);
  }
});

test('module capability declarations and migrated execution grants require access-matrix updates',()=>{
  const modules=require('../server/lib/module-registry').list(),registry=createToolRegistry({cp:{}});
  const actual=modules.map(m=>({id:m.id,area:m.area,capabilities:m.capabilities,agentTools:registry.catalog().filter(t=>t.module===m.id&&t.contractVersion).map(t=>({id:t.id,operation:t.operation,areas:t.areas,risk:t.risk,approval:t.approval,rollbackable:t.rollbackable}))}));
  assert.deepEqual(actual,require('./fixtures/agent-capability-access-matrix.json').modules,'new modules/capabilities/tools require an explicit matrix review');
});

test('module and Office discovery reflect live IAM rather than assuming every declared capability is executable',async t=>{
  const f=await fixture(t);f.profile.areas=['cp'];
  const catalog=await f.registry.execute('module.catalog',{}, {ownerId:f.owner,profile:f.profile});
  assert.deepEqual(catalog.modules.find(m=>m.id==='cp').agentTools.map(t=>t.id),['cp.rule.preview','cp.rule.save']);
  assert.deepEqual((await f.service.cpCatalog(f.profile,f.agent.id)).tools.map(t=>t.id),['cp.rule.preview','cp.rule.save']);
  f.profile.areas=[];assert.deepEqual((await f.registry.execute('module.catalog',{}, {ownerId:f.owner,profile:f.profile})).modules,[]);
});

test('CP context preserves personal settings and does not invent unsupported inherited settings',async t=>{
  const f=await fixture(t),key='lcw.cp.assistant.v1';
  f.access.roleWorkspaceEntries=()=>({[key]:{value:JSON.stringify({settings:{targetType:'inStore'},checklistSettings:{enabled:false}})}});
  assert.equal(f.prefs.context(f.profile).settings.targetType,'retail');assert.equal(f.prefs.context(f.profile).checklistEnabled,true);
  preferences.applyEntryChanges(f.owner,{[key]:JSON.stringify({settings:{targetType:'inStore'},checklistSettings:{enabled:false}})});
  assert.equal(f.prefs.context(f.profile).settings.targetType,'inStore');assert.equal(f.prefs.context(f.profile).checklistEnabled,false);
});

test('natural-language checklist creation, revision, verified persistence and revision-safe rollback',async t=>{
  const f=await fixture(t),job=await f.service.cpPreview(f.profile,f.request);
  assert.equal(job.status,'waiting_approval');assert.equal(job.preview.matched,2);assert.equal(f.calls,1);
  const done=await f.approve(job);assert.equal(done.status,'completed',done.errorCode);assert.equal(done.result.verified,true);
  const persisted=f.prefs.ruleSnapshot(f.profile,'checklist');assert.ok(persisted.rules.some(r=>r.id===job.args.rule.id));
  assert.equal((await f.approve(job)).id,done.id);assert.equal(f.calls,1,'effect never calls AI');
  const revised=await f.service.cpPreview(f.profile,{...f.request,ruleId:job.args.rule.id,name:'Yeni kontrol',nameEn:'Revised check'});
  assert.equal((await f.approve(revised)).status,'completed');
  await assert.rejects(f.service.cpRollback(f.profile,job.id,{confirmed:true}),e=>e.code==='OFFICE_PREVIEW_CHANGED');
  const restored=await f.service.cpRollback(f.profile,revised.id,{confirmed:true});assert.equal(restored.rollbackStatus,'completed');
  assert.equal(f.prefs.ruleSnapshot(f.profile,'checklist').rules.find(r=>r.id===job.args.rule.id).name,'Demo kontrol');
  const reopened=createAgentOfficeStore({root:path.join(root,f.owner)});assert.equal((await reopened.get(f.owner,'job',revised.id)).rollbackStatus,'completed');
});

test('weekly loads use the actual Merch boundary and EML drafts work with AI unavailable',async t=>{
  const f=await fixture(t);f.engine.ask=async()=>{throw new Error('AI offline');};
  const job=await f.service.cpPreview(f.profile,{agentId:f.agent.id,kind:'weekly',date:'2026-10-14',recipientMode:'manufacturer',subject:'Demo week',body:'Confirm loads',lang:'en'});
  assert.equal(job.preview.range.start,'2026-10-13');assert.equal(job.preview.matched,1);assert.equal(job.aiCalls,0);
  const done=await f.approve(job);assert.equal(done.status,'completed',done.errorCode);assert.equal(f.drafts,1);
  assert.ok(fs.readFileSync(mail.draftPath(done.result.emails[0].filename,f.owner),'utf8').includes('1234567'));
  const filename=done.result.emails[0].filename;
  assert.equal(await f.service.cpDraft(f.profile,done.id,filename),mail.draftPath(filename,f.owner));
  assert.equal(mail.draftPath(filename),'','global endpoint cannot resolve CP files');
  await assert.rejects(f.service.cpDraft({...f.profile,id:'other'},done.id,filename));
  await assert.rejects(f.service.cpDraft(f.profile,done.id,'not-a-receipt.eml'));
  f.profile.areas=['automations'];await assert.rejects(f.service.cpDraft(f.profile,done.id,filename),e=>e.code==='OFFICE_TOOL_FORBIDDEN');f.profile.areas=['cp','automations'];
  f.profile.dataScope={buyers:['new-scope']};await assert.rejects(f.service.cpDraft(f.profile,done.id,filename),e=>e.code==='OFFICE_PREVIEW_CHANGED');delete f.profile.dataScope;
  await f.approve(job);assert.equal(f.drafts,1);
});

test('current IAM, agent scope, stale source and concurrent approvals gate effects',async t=>{
  const f=await fixture(t),job=await f.service.cpPreview(f.profile,f.request);
  f.profile.areas=[];await assert.rejects(f.approve(job),e=>e.code==='OFFICE_TOOL_FORBIDDEN');f.profile.areas=['cp','automations'];
  f.change();const failed=await f.approve(job);assert.equal(failed.status,'failed');assert.equal(failed.errorCode,'OFFICE_PREVIEW_CHANGED');
  const fresh=await f.service.cpPreview(f.profile,f.request),results=await Promise.allSettled([f.approve(fresh),f.approve(fresh)]);
  assert.equal(results.filter(r=>r.status==='fulfilled'&&r.value.status==='completed').length,1);
  assert.equal(results.filter(r=>r.status==='rejected').length,1);
  assert.ok(f.prefs.ruleSnapshot(f.profile,'checklist').rules.some(r=>r.id===fresh.args.rule.id));
  const next=await f.service.cpPreview(f.profile,f.request);await f.store.updateProfile(f.owner,f.agent.id,{areas:[],revision:f.agent.revision});
  await assert.rejects(f.approve(next),e=>e.code==='OFFICE_TOOL_FORBIDDEN');
});

test('schema rejects unknown mutation fields and direct unapproved execution',async t=>{
  const f=await fixture(t),ctx={ownerId:f.owner,profile:f.profile};
  await assert.rejects(f.registry.execute('cp.rule.save',{rule:{...f.request,id:'r',kind:'checklist',formula:'=TRUE'},fingerprint:'x'},ctx),e=>e.code==='OFFICE_TOOL_SCHEMA');
  const job=await f.service.cpPreview(f.profile,f.request);
  await assert.rejects(f.registry.execute(job.toolId,job.args,ctx),e=>e.code==='OFFICE_APPROVAL_REQUIRED');
  await assert.rejects(f.service.cpExecute({...f.profile,id:'other'},job.id,{confirmed:true,fingerprint:job.preview.fingerprint}));
});

test('revocation or source change while awaiting effect authority prevents the write',async t=>{
  for(const change of ['iam','source']){
    const f=await fixture(t),job=await f.service.cpPreview(f.profile,f.request);
    f.authorize(async()=>{if(change==='iam')f.profile.areas=[];else f.change();});
    const done=await f.approve(job);assert.equal(done.status,'failed');
    assert.ok(!f.prefs.ruleSnapshot(f.profile,'checklist').rules.some(r=>r.id===job.args.rule.id));
  }
});

test('exact effect receipts survive runtime compaction and safe rollback rejects newer preference entry',async t=>{
  const f=await fixture(t),key='lcw.cp.rules.checklist.v1';
  const extra=Array.from({length:25},(_,i)=>({id:'test_'+i,kind:'checklist',name:'x'.repeat(140),nameEn:'x'.repeat(140),mode:'formula',formula:'=TRUE',expressionVersion:2}));
  preferences.applyEntryChanges(f.owner,{[key]:JSON.stringify({version:2,rules:extra,deletedRuleIds:[]})});
  const job=await f.service.cpPreview(f.profile,f.request),done=await f.approve(job);assert.equal(done.status,'completed',done.errorCode);
  assert.ok(done.result.rollbackToken.before.value.length>5000);
  assert.equal(done.result.rollbackToken.before.value,JSON.stringify({version:2,rules:extra,deletedRuleIds:[]}));
  preferences.merge(f.owner,{[key]:{value:JSON.stringify({version:2,rules:[],deletedRuleIds:[]})}});
  await assert.rejects(f.service.cpRollback(f.profile,job.id,{confirmed:true}),e=>e.code==='OFFICE_PREVIEW_CHANGED');
});

test('Runtime can restore an approved CP effect after a failed verifier',async t=>{
  const f=await fixture(t),job=await f.service.cpPreview(f.profile,f.request);
  const nodes=[{id:'start',type:'trigger.manual',config:{}},{id:'effect',type:'tool.call',config:{toolId:job.toolId,args:job.args}},{id:'verify',type:'verify.result',config:{mode:'equals',path:'verified',value:false}}];
  const workflow={id:'inverse_demo',ownerId:f.owner,name:'Inverse demo',nodes,edges:[{id:'e1',from:'start',to:'effect',channel:'success'},{id:'e2',from:'effect',to:'verify',channel:'success'}]};
  const pending=await f.runtime.execute({ownerId:f.owner,profile:f.profile,workflow});
  const failed=await f.runtime.resumeApproval({ownerId:f.owner,profile:f.profile,runId:pending.run.id,approved:true});
  assert.equal(failed.run.status,'failed');assert.equal(failed.run.output.rollback[0].ok,true);
  assert.ok(!f.prefs.ruleSnapshot(f.profile,'checklist').rules.some(rule=>rule.id===job.args.rule.id));
});

test('CP drafts are isolated from global automation downloads',()=>{
  const draft=mail.createDraft({name:'Isolated demo',ownerId:'cp-owner',to:['demo@example.invalid'],rows:[],open:false});
  assert.equal(mail.draftPath(draft.filename),'');
  assert.ok(mail.draftPath(draft.filename,'cp-owner'));
  assert.equal(mail.draftPath(draft.filename,'another-owner'),'');
});

test('CP impact uses real PLM-approved sample evidence and stage inference',async t=>{
  const f=await fixture(t);f.rows[0].STATUS='PRODUCTION';f.engine.ask=async()=>({structured:{ok:true},data:{formula:'=[@checklist:pps]="approved"',priority:'CRITICAL'}});
  f.samples.models['7654321']={requests:[{milestone:'pps',subTypeId:'50',subTypeName:'PPS',requestCode:'DEMO',iteration:1,status:'approved',statusName:'Approved'}]};
  const approved=await f.service.cpPreview(f.profile,{...f.request,ruleKind:'priority'});
  assert.equal(approved.preview.matched,1);
  f.samples.models={};f.rows[0]['Shipment Quantity']=5;
  const shipped=await f.service.cpPreview(f.profile,{...f.request,ruleKind:'priority'});
  assert.equal(shipped.preview.matched,1);
});

test('synced jobs on another device cannot execute, and large weekly exports fail before creating files',async t=>{
  const f=await fixture(t),job=await f.service.cpPreview(f.profile,f.request);
  await f.store.save(f.owner,'job',{...job,runtimeDeviceId:'other-device'});
  await assert.rejects(f.approve(job),e=>e.code==='OFFICE_TASK_DEVICE');
  f.rows.splice(0,f.rows.length,...Array.from({length:5001},(_,i)=>({'Order Code':String(1234567+i),'Ex-factory':'2026-10-14'})));
  await assert.rejects(f.service.cpPreview(f.profile,{agentId:f.agent.id,kind:'weekly',date:'2026-10-14',recipientMode:'general',subject:'Demo',body:'Demo'}),e=>e.code==='OFFICE_DRAFT_CAPACITY');
  assert.equal(f.drafts,0);assert.equal(f.calls,1);
});

test('preference copies respect the target-user lease across processes',async t=>{
  const f=await fixture(t),{spawnSync}=require('node:child_process'),{withFileLeaseSync}=require('../server/lib/shared-file-transaction');
  for(const method of ['copyWorkspaceSnapshot','copyWorkspaceEntrySnapshot']){
    const args=method==='copyWorkspaceSnapshot'?['source',f.owner,['cp']]:[{},f.owner,['cp']];
    withFileLeaseSync(path.join(root,'user-preferences',`${f.owner}.json`),()=>{
      const script=`const p=require('./server/lib/user-preferences');try{p.${method}(...${JSON.stringify(args)});process.exit(2)}catch(e){require('node:fs').writeFileSync(1,e.code||'unknown')}`;
      const result=spawnSync(process.execPath,['-e',script],{cwd:path.resolve(__dirname,'..'),encoding:'utf8'});
      assert.equal(result.status,0);assert.equal(result.stdout,'SHARED_WRITE_BUSY');
    });
  }
});
