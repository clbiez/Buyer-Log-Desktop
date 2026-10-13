'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),path=require('path'),os=require('os');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'bl-quality-agent-'));
for(const key of ['BUYER_LOG_DATA_ROOT','BUYER_LOG_LOCAL_DATA_ROOT','BUYER_LOG_SERVER_DATA_ROOT','BUYER_LOG_AUTH_DATA_ROOT'])process.env[key]=root;
const {createService}=require('../server/lib/test-reports/service'),reports=require('../server/lib/test-reports/store'),checklist=require('../server/lib/checklist-supplier-store');
const {createToolRegistry}=require('../server/lib/agent-tool-registry'),{registerQualityTools}=require('../server/lib/agent-quality-tools');
const {createAgentOfficeStore}=require('../server/lib/agent-office-store'),{createAgentOfficeService}=require('../server/lib/agent-office-service');
const {createAgentRuntime}=require('../server/lib/agent-runtime'),runtimeStore=require('../server/lib/agent-workflow-store'),{createPolicyEngine}=require('../server/lib/agent-policy-engine');
const staging=require('../server/lib/test-reports/staging'),mail=require('../server/lib/automation-email'),E=require('../public/test-report-engine');
const file=name=>({name,base64:fs.readFileSync(path.join(__dirname,'fixtures/test-reports',name)).toString('base64')});
test.after(()=>fs.rmSync(root,{recursive:true,force:true}));let seq=0;
async function fixture(t){
  for(const name of ['test-reports.json','test-reports.last-good.json','checklist-supplier-sync.json','checklist-supplier-sync.last-good.json'])fs.rmSync(path.join(root,name),{force:true});
  const profile={id:'quality-'+(++seq),areas:['cp','automations'],enabled:true},access={profileById:id=>id===profile.id?profile:null,hasArea:(p,a)=>p.areas.includes(a),hasCapability:()=>true,appendAudit:()=>{}};
  let allowed=new Map([['1374537|KK.TSH,FT-UKRAYNA 2447160|Q6K',{orderCode:'1374537',modelName:'KK.TSH,FT-UKRAYNA 2447160',colourCode:'Q6K',colour:'BUXE WHITE'}],['1359393|ATL,MINECRAFT-1-EQ|ECR',{orderCode:'1359393',modelName:'ATL,MINECRAFT-1-EQ',colourCode:'ECR',colour:'ECRU'}]]);
  const authorizedOrders=async()=>allowed,source=createService({authorizedOrders});let office;
  let beforeAuthorize=()=>{};
  const registry=createToolRegistry({userAccess:access,authorizeCapability:async(ctx,args)=>{await beforeAuthorize(ctx,args);return office.taskAuthorize(ctx,args);}}),store=createAgentOfficeStore({root:path.join(root,profile.id)});
  const tools=registerQualityTools(registry,{service:source,authorizedOrders,dataset:async()=>[...allowed.values()].map(c=>({'Order Code':c.orderCode,'Model Name':c.modelName,'C.Code':c.colourCode,Colour:c.colour,Manufacturer:'Demo'})),mail:(_p,args,rows,dryRun,expected)=>{const preview={messages:[{to:['demo@example.invalid'],subject:args.subject,rows:rows.length}],sendAvailable:false};if(dryRun)return preview;assert.deepEqual(preview,expected);const result=mail.createDraft({ownerId:profile.id,to:['demo@example.invalid'],subject:args.subject,body:args.body,rows,fields:['Order Code'],open:false});return {emails:[{filename:result.filename}],sendAvailable:false};},verifyMail:result=>result.emails.every(f=>!!mail.draftPath(f.filename,profile.id))});
  office=createAgentOfficeService({store,userAccess:access,toolRegistry:registry,runtime:createAgentRuntime({store:runtimeStore,toolRegistry:registry,policyEngine:createPolicyEngine({userAccess:access})}),runtimeStore,engine:{},getOperationalData:async()=>({}),taskOwners:()=>[]});t.after(()=>office.stop());
  const agent=await store.createProfile(profile.id,{name:'Quality',areas:['cp']});
  const create=steps=>office.taskCreate(profile,{agentId:agent.id,task:'Process test reports',steps}),execute=job=>office.taskExecute(profile,job.id,{confirmed:true,fingerprint:job.steps.find(s=>s.status!=='completed')?.preview.fingerprint});
  return {profile,access,source,registry,office,agent,tools,create,execute,setAllowed:value=>{allowed=value;},beforeAuthorize:fn=>{beforeAuthorize=fn;}};
}
test('real PDF/MSG → exact match → approved report/checklist → actual Fail EML receipt',async t=>{
  const f=await fixture(t),parsed=await f.source.parse(f.profile,[file('B-labright-result-364790.msg'),file('A-TestRequestResultReport_4459415.pdf')],{durable:true}),preview=await f.tools.inspect(f.profile,parsed.sessionId);
  assert.equal(preview.matches.length,2);assert.ok(preview.matches.every(m=>m.level==='exact'));assert.equal(preview.unresolved.length,0);
  const items=preview.suggestedItems;
  let job=await f.create([{id:'reports',toolId:'quality.commit',args:{sessionId:parsed.sessionId,items}},{id:'answers',toolId:'quality.checklist.apply',args:{items}},{id:'draft',toolId:'quality.fail.drafts',args:{talepNos:['364790'],subject:'Failed tests',body:'Retest needed',language:'en'}}]);
  await assert.rejects(f.office.taskExecute(f.profile,job.id),{code:'OFFICE_APPROVAL_REQUIRED'});
  job=await f.execute(job);assert.equal(job.status,'waiting_approval');assert.equal(reports.read().links['364790'].orderKey,items[0].orderKey);assert.ok(reports.read().reports['364790'].dosyalar.some(d=>d.attachmentId));
  job=await f.execute(job);assert.equal(checklist._read().answers[items[0].orderKey+'::tests'].state,'rejected');assert.equal(checklist._read().answers[items[1].orderKey+'::tests'].state,'approved');assert.equal(checklist._read().answers[items[0].orderKey+'::tests'].source,'test_report','later normal imports must recognize machine-derived report evidence');
  job=await f.execute(job);assert.equal(job.status,'completed');assert.equal(job.steps[2].result.sendAvailable,false);
  const filename=job.steps[2].result.emails[0].filename;assert.match(fs.readFileSync(mail.draftPath(filename,f.profile.id),'utf8'),/^To: demo@example.invalid/m);
  await f.execute(job);assert.equal(job.steps[2].result.emails[0].filename,filename,'completed receipt is not replayed');
});
test('ambiguous model/color waits for a selected candidate and explicit match confirmation',async t=>{
  const f=await fixture(t),parsed=await f.source.parse(f.profile,[file('B-labright-result-364790.msg')]);
  f.setAllowed(new Map([['one',{orderCode:'1374537',modelName:'KK.TSH,FT-UKRAYNA 2447160',colourCode:'Q6K',colour:'BUXE WHITE'}],['two',{orderCode:'1374537',modelName:'KK.TSH,FT-UKRAYNA 2447160',colourCode:'OTHER',colour:'BUXE WHITE'}]]));
  const preview=await f.tools.inspect(f.profile,parsed.sessionId);assert.equal(preview.matches[0].level,'ambiguous');assert.deepEqual(preview.suggestedItems,[]);
  const args={sessionId:parsed.sessionId,items:[{talepNo:'364790',orderKey:'one',itemId:'tests'}]};await assert.rejects(f.create([{toolId:'quality.commit',args}]),{code:'OFFICE_QUALITY_MATCH_REQUIRED'});
  args.items[0].confirmMatch=true;const job=await f.create([{toolId:'quality.commit',args}]);assert.equal(job.status,'waiting_approval');
});
test('source revision, real writable scope, owner staging and reverse revisions protect writes',async t=>{
  const f=await fixture(t),parsed=await f.source.parse(f.profile,[file('A-TestRequestResultReport_4459415.pdf')]),items=(await f.tools.inspect(f.profile,parsed.sessionId)).suggestedItems;
  assert.equal(staging.getSession(parsed.sessionId,'stranger'),null);
  let job=await f.create([{toolId:'quality.commit',args:{sessionId:parsed.sessionId,items}}]);
  reports.commit([],{},f.profile);job=await f.execute(job);assert.equal(job.status,'failed','a later revision invalidates approval');
  job=await f.create([{toolId:'quality.commit',args:{sessionId:parsed.sessionId,items}}]);job=await f.execute(job);assert.equal(job.status,'completed');
  const before=reports.read().reports['4459415'];assert.ok(before);
  f.setAllowed(new Map());await assert.rejects(f.office.taskRollback(f.profile,job.id,{stepId:job.steps[0].id,confirmed:true}),{code:'OFFICE_TOOL_FORBIDDEN'});
});
test('revision-safe checklist inverse restores exact absence and report inverse preserves audit',async t=>{
  const f=await fixture(t),parsed=await f.source.parse(f.profile,[file('B-labright-result-364790.msg')]),items=(await f.tools.inspect(f.profile,parsed.sessionId)).suggestedItems;
  let reportJob=await f.create([{toolId:'quality.commit',args:{sessionId:parsed.sessionId,items}}]);reportJob=await f.execute(reportJob);
  const previous=checklist._read();let answer=await f.create([{toolId:'quality.checklist.apply',args:{items}}]);answer=await f.execute(answer);
  await f.office.taskRollback(f.profile,answer.id,{stepId:answer.steps[0].id,confirmed:true});assert.deepEqual(checklist._read().answers,previous.answers);assert.deepEqual(checklist._read().tombstones,previous.tombstones);
  await f.office.taskRollback(f.profile,reportJob.id,{stepId:reportJob.steps[0].id,confirmed:true});assert.ok(reports.read().events.some(e=>e.type==='agent-report-undo'));
});
test('durable local staging survives module restart, verifies file bytes and expires safely',async t=>{
  const f=await fixture(t),parsed=await f.source.parse(f.profile,[file('A-TestRequestResultReport_4459415.pdf')],{durable:true});
  const before=staging.getSession(parsed.sessionId,f.profile.id);delete require.cache[require.resolve('../server/lib/test-reports/staging')];const restarted=require('../server/lib/test-reports/staging'),after=restarted.getSession(parsed.sessionId,f.profile.id);
  assert.equal(after.reports[0].talepNo,before.reports[0].talepNo);assert.deepEqual([...after.files.values()].map(f=>f.hash),[...before.files.values()].map(f=>f.hash));assert.equal(restarted.getSession(parsed.sessionId,'stranger'),null);
  const now=Date.now;Date.now=()=>now()+restarted.TTL_MS+1;try{assert.equal(restarted.getSession(parsed.sessionId,f.profile.id),null);}finally{Date.now=now;}
});
test('unrecognized files use only the existing LCW AI contract and never auto-approve reports',async t=>{
  const f=await fixture(t),png=Buffer.concat([Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]),Buffer.alloc(64)]),parsed=await f.source.parse(f.profile,[{name:'report.png',base64:png.toString('base64')}],{durable:true});let calls=0;
  const before=reports.read().revision;
  await f.source.extractAi(f.profile,parsed.sessionId,{engine:{askWithFiles:async(owner,input)=>{calls++;assert.equal(owner,f.profile.id);assert.equal(input.source,'test-report-extract');assert.ok(Buffer.isBuffer(input.files[0].buffer));return {structured:{ok:true},data:{talepNo:'4400009',siparisKodu:'1374537',modelAdi:'KK.TSH,FT-UKRAYNA 2447160',renk:'BUXE WHITE',genelSonuc:'Fail',confidence:'HIGH'}};}}});
  assert.equal(calls,1);assert.equal(reports.read().revision,before);assert.equal(staging.getSession(parsed.sessionId,f.profile.id).reports[0].kaynak,'ai');
  await assert.rejects(f.registry.execute('quality.commit',{sessionId:parsed.sessionId,items:[{talepNo:'4400009',orderKey:'forged',itemId:'tests'}]},{ownerId:f.profile.id,profile:f.profile,dryRun:true}),{code:'OFFICE_QUALITY_MATCH_REQUIRED'});
});
test('large live order scope is matched deterministically without putting all records in the preview',async t=>{
  const f=await fixture(t),parsed=await f.source.parse(f.profile,[file('A-TestRequestResultReport_4459415.pdf')]),allowed=new Map(Array.from({length:50000},(_,i)=>['order-'+i,{orderCode:String(2000000+i),modelName:'DEMO',colourCode:'BLU',colour:'BLUE'}]));
  allowed.set('target',{orderCode:'1359393',modelName:'ATL,MINECRAFT-1-EQ',colourCode:'ECR',colour:'ECRU'});f.setAllowed(allowed);
  const started=performance.now(),preview=await f.tools.inspect(f.profile,parsed.sessionId);assert.equal(preview.matches[0].level,'exact');assert.equal(preview.suggestedItems[0].orderKey,'target');assert.ok(JSON.stringify(preview).length<20000);assert.ok(performance.now()-started<10000);
});
test('AI report changes while the approved effect awaits authorization cannot change committed evidence',async t=>{
  const f=await fixture(t),png=Buffer.concat([Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]),Buffer.alloc(64)]),parsed=await f.source.parse(f.profile,[{name:'report.png',base64:png.toString('base64')}],{durable:true});
  const data={talepNo:'4400009',siparisKodu:'1374537',modelAdi:'KK.TSH,FT-UKRAYNA 2447160',renk:'BUXE WHITE',genelSonuc:'Fail',confidence:'HIGH'};
  f.source.acceptAi(f.profile,{sessionId:parsed.sessionId,fileName:'report.png',data});
  const items=(await f.tools.inspect(f.profile,parsed.sessionId)).suggestedItems;let job=await f.create([{toolId:'quality.commit',args:{sessionId:parsed.sessionId,items}}]);
  f.beforeAuthorize(()=>f.source.acceptAi(f.profile,{sessionId:parsed.sessionId,fileName:'report.png',data:{...data,genelSonuc:'Pass',testler:['Any | C1 | Pass']}}));
  job=await f.execute(job);assert.equal(job.status,'failed');assert.equal(job.steps[0].errorCode,'TEST_REPORT_PREVIEW_CHANGED');assert.equal(reports.read().reports['4400009'],undefined);
});
test('undo checks the previous link scope and completed checklist evidence from separate jobs',async t=>{
  const f=await fixture(t),parsed=await f.source.parse(f.profile,[file('A-TestRequestResultReport_4459415.pdf')]),items=(await f.tools.inspect(f.profile,parsed.sessionId)).suggestedItems;
  let reportJob=await f.create([{toolId:'quality.commit',args:{sessionId:parsed.sessionId,items}}]);reportJob=await f.execute(reportJob);
  let answerJob=await f.create([{toolId:'quality.checklist.apply',args:{items}}]);await f.execute(answerJob);
  await assert.rejects(f.office.taskRollback(f.profile,reportJob.id,{stepId:reportJob.steps[0].id,confirmed:true}),{code:'OFFICE_TASK_DEPENDENCY'});assert.ok(reports.read().reports['4459415']);
  const receipt={records:{'4459415':{report:null,link:{orderKey:'lost-scope',itemId:'tests'}}},expectedRevision:reports.read().revision};
  await assert.rejects(f.registry.rollback('quality.commit',receipt,{ownerId:f.profile.id,profile:f.profile,approvalGranted:true}),{code:'OFFICE_TOOL_FORBIDDEN'});
});
test('real order ownership revoked during approval prevents a checklist answer',async t=>{
  const f=await fixture(t),parsed=await f.source.parse(f.profile,[file('A-TestRequestResultReport_4459415.pdf')]),items=(await f.tools.inspect(f.profile,parsed.sessionId)).suggestedItems;
  let job=await f.create([{toolId:'quality.commit',args:{sessionId:parsed.sessionId,items}}]);await f.execute(job);
  job=await f.create([{toolId:'quality.checklist.apply',args:{items}}]);const revision=checklist._read().revision;f.beforeAuthorize(()=>f.setAllowed(new Map()));
  job=await f.execute(job);assert.equal(job.status,'failed');assert.equal(job.steps[0].errorCode,'OFFICE_TOOL_FORBIDDEN');assert.equal(checklist._read().revision,revision);
});
test('Fail outcome changed during approval prevents a misleading mail draft',async t=>{
  const f=await fixture(t),parsed=await f.source.parse(f.profile,[file('B-labright-result-364790.msg')]),items=(await f.tools.inspect(f.profile,parsed.sessionId)).suggestedItems;
  let job=await f.create([{toolId:'quality.commit',args:{sessionId:parsed.sessionId,items}}]);await f.execute(job);
  job=await f.create([{toolId:'quality.fail.drafts',args:{talepNos:['364790'],subject:'Fail',body:'Review',language:'en'}}]);
  f.beforeAuthorize(()=>{const report=reports.read().reports['364790'];reports.commit([{report:{...report,genelSonuc:'Pass',kararlar:[{talepNo:'364790',test:'*',karar:'Commercial Approval',tarihIso:'2026-10-12T00:00:00Z'}]},orderKey:items[0].orderKey,itemId:'tests'}],{},f.profile);});
  job=await f.execute(job);assert.equal(job.status,'failed');assert.equal(job.steps[0].errorCode,'OFFICE_PREVIEW_CHANGED');assert.equal(job.steps[0].result?.emails,undefined);
});
test('two live processes see new staged sessions and a concurrent AI update invalidates approval',async t=>{
  const f=await fixture(t),child=require('child_process').fork(path.join(__dirname,'helpers/quality-stage-worker.cjs'),[],{stdio:['ignore','ignore','inherit','ipc']});t.after(()=>child.kill());
  const receive=type=>new Promise((resolve,reject)=>{const listener=message=>{if(message.type==='error'){child.off('message',listener);reject(new Error(message.code));}else if(message.type===type){child.off('message',listener);resolve(message);}};child.on('message',listener);});
  await receive('ready');const png=Buffer.concat([Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]),Buffer.alloc(64)]),parsed=await f.source.parse(f.profile,[{name:'report.png',base64:png.toString('base64')}],{durable:true});
  let waiting=receive('done');child.send({action:'inspect',sessionId:parsed.sessionId,owner:f.profile.id});assert.equal((await waiting).exists,true);
  const data={talepNo:'4400009',siparisKodu:'1374537',modelAdi:'KK.TSH,FT-UKRAYNA 2447160',renk:'BUXE WHITE',genelSonuc:'Fail',confidence:'HIGH'};
  f.source.acceptAi(f.profile,{sessionId:parsed.sessionId,fileName:'report.png',data});const items=(await f.tools.inspect(f.profile,parsed.sessionId)).suggestedItems;
  let job=await f.create([{toolId:'quality.commit',args:{sessionId:parsed.sessionId,items}}]);f.beforeAuthorize(async()=>{waiting=receive('done');child.send({action:'update',sessionId:parsed.sessionId,owner:f.profile.id,data:{...data,testler:['Any | C1 | Pass']}});await waiting;});
  job=await f.execute(job);assert.equal(job.status,'failed');assert.equal(job.steps[0].errorCode,'TEST_REPORT_PREVIEW_CHANGED');assert.equal(reports.read().reports['4400009'],undefined);
});
test('a real writer holding the checklist lease cannot race between inverse dependency check and report restore',async t=>{
  const f=await fixture(t),parsed=await f.source.parse(f.profile,[file('A-TestRequestResultReport_4459415.pdf')]),items=(await f.tools.inspect(f.profile,parsed.sessionId)).suggestedItems;
  let job=await f.create([{toolId:'quality.commit',args:{sessionId:parsed.sessionId,items}}]);job=await f.execute(job);
  const child=require('child_process').fork(path.join(__dirname,'helpers/quality-stage-worker.cjs'),[],{env:{...process.env,QUALITY_TEST_MODE:'answer-race'},stdio:['ignore','ignore','inherit','ipc']});t.after(()=>child.kill());
  const receive=type=>new Promise((resolve,reject)=>{const listener=message=>{if(message.type==='error'){child.off('message',listener);reject(new Error(message.code));}else if(message.type===type){child.off('message',listener);resolve(message);}};child.on('message',listener);});
  await receive('ready');const held=receive('held'),done=receive('done');child.send({owner:f.profile.id,entry:{orderKey:items[0].orderKey,itemId:'tests',state:'approved',reportNumber:'4459415'}});await held;
  await assert.rejects(f.office.taskRollback(f.profile,job.id,{stepId:job.steps[0].id,confirmed:true}),{code:'OFFICE_TASK_DEPENDENCY'});await done;assert.ok(reports.read().reports['4459415']);
});
