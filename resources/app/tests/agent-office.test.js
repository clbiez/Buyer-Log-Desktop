'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const crypto=require('node:crypto');
const express=require('express');
const {createAgentOfficeStore,hash}=require('../server/lib/agent-office-store');
const {createAgentOfficeSync,seal,open}=require('../server/lib/agent-office-sync');
const {createAgentOfficeService,trainingChunks,packContext,inferScope}=require('../server/lib/agent-office-service');
const Intelligence=require('../server/lib/agent-office-intelligence');
const Prompt=require('../server/lib/lcwai/lcwai-prompt');
const register=require('../server/routes/agent-office-routes');
const profiles={a:{id:'a',enabled:true,systemRole:'buyer',displayName:'Demo A'},b:{id:'b',enabled:true,systemRole:'buyer',displayName:'Demo B'},m:{id:'m',enabled:true,systemRole:'moderator',displayName:'Demo Moderator'}};
function access(){return{profileById:id=>profiles[id],hasArea:(profile,area)=>profile.id!=='b'||area==='koleksiyon',appendAudit:()=>{},requireModerator:(req,res,next)=>req.currentUser.systemRole==='moderator'?next():res.status(403).json({code:'MODERATOR_REQUIRED'})};}
async function temporary(t){const root=await fs.mkdtemp(path.join(os.tmpdir(),'bl-agent-office-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));return root;}
const row=(extra={})=>({'Order Code':'1234567','PLM ID':'7654321','Model Name':'DEMO-A','C.Code':'BLU','Colour':'BLUE','Manufacturer':'DEMO SUPPLIER','Order Quantity':100,'Shipment Quantity':0,'STATUS':'ÜRETİM','Ex-factory':'2026-11-20','Retail Date':'2026-12-20',...extra});
function fixture(root,options={}){
  const store=createAgentOfficeStore({root:path.join(root,'owners')}),calls=[];
  const sync=createAgentOfficeSync({store,localRoot:path.join(root,'sync'),getSharedRoot:async()=>options.shared || null,profileById:id=>profiles[id],deviceId:options.device || 'device-a'});
  const engine={async ask(owner,input){calls.push({owner,input});if(options.offline)throw Object.assign(new Error('auth'),{code:'LCWAI_AUTH_REQUIRED'});return{structured:{ok:true},data:{answer:'Demo answer',perspectives:input.context.participants.map(p=>`${p.id}|Demo perspective`),actions:['Verify delivery date'],references:[input.context.referenceIds[0],'invented-reference'].filter(Boolean),confidence:'MEDIUM'},model:{label:'LCW AI'}};},cancel(){return true;}};
  const service=createAgentOfficeService({store,sync,userAccess:access(),engine,getOperationalData:async()=>({cpRows:[row()],cpAvailable:true,sourceUpdatedAt:'2026-10-10T10:00:00Z',reports:{reports:{},links:{}},checklist:{answers:{},definitions:[]}})});
  return{store,sync,service,calls};
}
test('full archive survives reopen and pagination; owner isolation, memory versions, expiry and conflicts',async t=>{
  const root=await temporary(t),store=createAgentOfficeStore({root});
  const agent=await store.createProfile('a',{name:'Ada',areas:['cp','orders']},['cp']);assert.deepEqual(agent.areas,['cp']);
  const conv=await store.conversation('a',[agent.id],'Demo');
  for(let i=0;i<105;i++)await store.appendMessage('a',conv.id,{role:i%2?'assistant':'user',text:'Message '+i});
  const reopened=createAgentOfficeStore({root}),last=await reopened.messages('a',conv.id,{limit:60});assert.equal(last.total,105);assert.equal(last.messages.length,60);assert.equal(last.hasMore,true);
  const first=await reopened.messages('a',conv.id,{before:last.before,limit:60});assert.equal(first.messages.length,45);
  await assert.rejects(reopened.get('b','profile',agent.id),err=>err.statusCode===404);
  const a=await reopened.learn('a',agent.id,{text:'Priority is CP',key:'priority',approved:true});
  const b=await reopened.learn('a',agent.id,{text:'Priority is collection',key:'priority',approved:true});assert.deepEqual(b.conflictingIds,[a.id]);
  await reopened.editMemory('a',a.id,{active:false,revision:(await reopened.get('a','memory',a.id)).revision});
  await reopened.learn('a',agent.id,{text:'Expired fact',expiresAt:'2020-01-01',approved:true});
  const inference=await reopened.learn('a',agent.id,{text:'AI guess',type:'inference',approved:true});assert.equal(inference.approved,false);
  const context=await reopened.selectContext('a',[agent.id],conv.id,'priority',3000);assert.ok(context.selected.some(item=>item.id===b.id));assert.ok(!context.selected.some(item=>item.id===a.id));assert.ok(!context.selected.some(item=>item.text==='Expired fact'));assert.ok(context.chars<=3000);assert.equal(context.completeArchive,false);
  assert.equal((await reopened.exportTraining('a',[agent.id])).filter(doc=>doc.kind==='message').length,105);
  await assert.rejects(reopened.editMemory('a',b.id,{text:'Overwrite',revision:0}),err=>err.code==='OFFICE_REVISION_CONFLICT');
});
test('shared job uses one engine call and separate scoped perspectives; writes only archive and proposals',async t=>{
  const root=await temporary(t),f=fixture(root);t.after(()=>f.service.stop());const state=await f.service.state(profiles.a);
  await f.service.learn(profiles.a,state.profiles[0].id,{text:'Give concrete actions',type:'instruction',approved:true});
  const result=await f.service.run(profiles.a,{profileIds:state.profiles.slice(0,2).map(p=>p.id),task:'Review this order',lang:'en'});
  assert.equal(f.calls.length,1);assert.equal(result.job.perspectiveMode,'one-call-shared-perspectives');assert.equal(result.message.provenance.independentReviews,false);
  assert.ok(!result.message.sourceIds.includes('invented-reference'));assert.deepEqual(result.message.provenance.unsupportedReferences,['invented-reference']);
  assert.equal((await f.store.messages('a',result.conversation.id)).messages.length,2);
  await assert.rejects(f.service.run(profiles.b,{profileIds:[state.profiles[0].id],task:'Steal context'}),err=>err.statusCode===404);
  assert.equal(f.calls.length,1);
  assert.ok(Prompt.buildPrompt({source:'agent-office',task:'Review',context:f.calls[0].input.context,lang:'en'}).prompt.includes('Named participants share this single LCW AI call'));
});
test('offline failure keeps user message and terminal job; watches deduplicate and never call AI',async t=>{
  const root=await temporary(t),f=fixture(root,{offline:true});t.after(()=>f.service.stop());const state=await f.service.state(profiles.a);
  await assert.rejects(f.service.run(profiles.a,{profileIds:[state.profiles[0].id],task:'Check the schedule'}),err=>err.code==='LCWAI_AUTH_REQUIRED');
  const next=await f.store.state('a');assert.equal(next.jobs[0].status,'failed');assert.equal(next.archive.messages,2);assert.equal(f.calls.length,1);
  await f.service.watch(profiles.a,{profileId:state.profiles[0].id,scope:{orderCode:'1234567'},name:'Demo'});await f.service.checkWatches(profiles.a);await f.service.checkWatches(profiles.a);
  assert.equal(f.calls.length,1);assert.ok((await f.store.state('a')).alerts.length<=1);
});
test('encrypted owner and moderator sync; ordinary peers cannot decrypt private history; only approved shareable learning copies',async t=>{
  const root=await temporary(t),shared=path.join(root,'shared'),a=fixture(path.join(root,'a'),{shared,device:'a'}),b=fixture(path.join(root,'b'),{shared,device:'b'}),m=fixture(path.join(root,'m'),{shared,device:'m'}),a2=fixture(path.join(root,'a2'),{shared,device:'a2'});
  for(const f of [a,b,m,a2])t.after(()=>f.service.stop());
  const agent=await a.store.createProfile('a',{name:'Ada',areas:['cp']});
  await a.store.learn('a',agent.id,{text:'Private training sentence',key:'private',approved:true});
  await a.store.learn('a',agent.id,{text:'Shared preference',key:'shared',approved:true,shareable:true});
  const conv=await a.store.conversation('a',[agent.id],'Private topic');await a.store.appendMessage('a',conv.id,{role:'assistant',text:'Private answer sentence'});
  await m.sync.sync(profiles.m);await b.sync.sync(profiles.b);await a2.sync.sync(profiles.a);await a.sync.sync(profiles.a);
  await m.sync.sync(profiles.m,['a']);assert.equal((await m.store.state('a')).archive.messages,0,'unverified recipient cannot receive private archive');
  const attacker=crypto.generateKeyPairSync('rsa',{modulusLength:2048,publicKeyEncoding:{type:'spki',format:'pem'},privateKeyEncoding:{type:'pkcs8',format:'pem'}}),badId=hash('m:evil');
  await fs.writeFile(path.join(shared,'BUYER_LOG_SYNC','agent-office','v1','keys',badId+'.json'),JSON.stringify({ownerId:'m',deviceId:'evil',keyId:badId,publicKey:attacker.publicKey}));
  for(const [f,profile] of [[a,profiles.a],[a2,profiles.a],[m,profiles.m]])for(const key of await f.sync.keysFor(profile))if(!key.trusted && key.deviceId!=='evil')await f.sync.approveKey(profile,{...key,confirmed:true});
  await a.sync.sync(profiles.a);await m.sync.sync(profiles.m,['a']);await a2.sync.sync(profiles.a);
  assert.equal((await m.store.state('a')).archive.messages,1);
  await assert.rejects(fs.stat(path.join(shared,'BUYER_LOG_SYNC','agent-office','v1','private',hash('a'),badId)),err=>err.code==='ENOENT');assert.equal((await a2.store.state('a')).archive.messages,1);
  await assert.rejects(b.sync.sync(profiles.b,['a']),err=>err.statusCode===403);
  const files=[];async function walk(folder){for(const entry of await fs.readdir(folder,{withFileTypes:true})){const file=path.join(folder,entry.name);if(entry.isDirectory())await walk(file);else files.push(file);}}await walk(shared);
  for(const file of files){const content=await fs.readFile(file,'utf8');assert.ok(!content.includes('Private training sentence'));assert.ok(!content.includes('Private answer sentence'));assert.ok(!content.includes('PRIVATE KEY'));}
  await a.service.publish(profiles.a,agent.id,true);const catalog=await b.sync.catalog();assert.equal(catalog[0].memory.length,1);assert.equal(catalog[0].transcriptsIncluded,false);
  const copied=await b.service.copyAgent(profiles.b,'a',agent.id,'rental');assert.equal(copied.lineage.mode,'rental');assert.deepEqual(copied.areas,[]);
  const memories=(await b.store.state('b')).memory.filter(item=>item.profileId===copied.id);assert.equal(memories.length,1);assert.equal(memories[0].approved,false);assert.equal(memories[0].origin,'copied');
  profiles.m.systemRole='buyer';await assert.rejects(m.sync.sync(profiles.m,['a']),err=>err.statusCode===403);profiles.m.systemRole='moderator';
});
test('authenticated encryption rejects tampering and another key',()=>{
  const pair=()=>crypto.generateKeyPairSync('rsa',{modulusLength:2048,publicKeyEncoding:{type:'spki',format:'pem'},privateKeyEncoding:{type:'pkcs8',format:'pem'}}),a=pair(),b=pair();
  const sealed=seal({private:'data'},a.publicKey,'scope');assert.deepEqual(open(sealed,a.privateKey,'scope'),{private:'data'});
  assert.throws(()=>open(sealed,b.privateKey,'scope'));assert.throws(()=>open(sealed,a.privateKey,'another-scope'));
  const tampered={...sealed,data:Buffer.from('bad').toString('base64')};assert.throws(()=>open(tampered,a.privateKey,'scope'));
});
test('20 MiB transfer uses whole message chunks; context is valid bounded JSON with explicit omissions',()=>{
  const records=Array.from({length:11},(_,i)=>({id:'message-'+i,kind:'message',text:'ü'.repeat(1000000),createdAt:'2026-10-10'}));
  const chunks=trainingChunks(records);assert.equal(chunks.length,2);assert.ok(chunks.every(chunk=>chunk.buffer.length<20*1024*1024));assert.equal(chunks.reduce((n,chunk)=>n+chunk.sourceIds.length,0),11);
  const packed=packContext({participants:[{id:'a',instructions:'x'.repeat(6000)}],memory:records,coverage:{completeArchive:false}},17800);
  assert.ok(JSON.stringify(packed).length<=17800);assert.ok(packed.omitted>0);assert.ok(JSON.parse(JSON.stringify(packed)));
});
test('canonical identity joins preserve duplicate variants; source revisions compare actual values without changing source',()=>{
  const input=[row(),row({'C.Code':'RED'})],collection=[{id:1,plmId:'7654321',colourCode:'BLU'},{id:2,plmId:'7654321',colourCode:'BLU'},{id:3,plmId:'7654321',colourCode:'RED'}];
  const joins=Intelligence.correlate(input,collection);assert.equal(joins.get('7654321|BLU').length,2);assert.equal(joins.get('7654321|RED').length,1);
  const before=JSON.stringify(input),a=Intelligence.analyzeOperationalData({cpRows:input,cpAvailable:true,collectionRows:collection});assert.equal(JSON.stringify(input),before);assert.ok(a.findings.some(item=>item.code==='COLLECTION_AMBIGUOUS'));assert.ok(a.orders[0].unavailable.includes('full-fabric-bom'));
  const b=Intelligence.analyzeOperationalData({cpRows:[row({'Ex-factory':'2026-12-01'}),input[1]],cpAvailable:true});
  assert.ok(Intelligence.compareSnapshots(a.snapshots,b.snapshots).some(item=>item.field==='exFactory'&&item.kind==='source-change'));
});
test('HTTP authorization prevents cross-owner reads, forged profiles and moderator archive access',async t=>{
  const root=await temporary(t),f=fixture(root);t.after(()=>f.service.stop());const state=await f.service.state(profiles.a);
  const app=express();app.use((req,_res,next)=>{req.currentUser=profiles[req.headers['x-demo-user'] || 'b'];next();});register(app,{express,service:f.service,userAccess:access(),listOwners:async()=>Object.values(profiles)});
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));const base='http://127.0.0.1:'+server.address().port;
  const denied=await fetch(base+'/api/agent-office/profiles/'+state.profiles[0].id,{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({ownerId:'a',name:'Stolen'})});assert.equal(denied.status,404);
  assert.equal((await fetch(base+'/api/agent-office/moderation/a')).status,403);
  assert.equal((await fetch(base+'/api/agent-office/training/preview',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({ownerId:'a'})})).status,403);
  const result=await fetch(base+'/api/agent-office/profiles',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({ownerId:'a',name:'Own agent',areas:['cp','collection'],lineage:{ownerId:'a'}})});
  assert.equal(result.status,201);const body=await result.json();assert.equal(body.profile.ownerId,'b');assert.deepEqual(body.profile.areas,['collection']);assert.equal(body.profile.lineage,null);
});

test('malformed and interrupted AI replies remain archived and never become approved memory',async t=>{
  const root=await temporary(t),f=fixture(root);t.after(()=>f.service.stop());const state=await f.service.state(profiles.a),agent=state.profiles[0];
  f.service.engineOf().ask=async()=>({structured:{ok:false},text:'Unverified full answer',data:null});
  await assert.rejects(f.service.run(profiles.a,{profileIds:[agent.id],task:'Review'}),err=>err.code==='OFFICE_AI_CONTRACT_INVALID');
  let docs=await f.store.records('a');assert.ok(docs.some(doc=>doc.role==='assistant'&&doc.text==='Unverified full answer'&&doc.provenance.contractValid===false));
  f.service.engineOf().ask=async(_owner,input)=>{input.onProgress({delta:'Partial preserved answer'});throw Object.assign(new Error('cancel'),{code:'LCWAI_CANCELLED'});};
  await assert.rejects(f.service.run(profiles.a,{profileIds:[agent.id],task:'Another review'}));
  docs=await f.store.records('a');assert.ok(docs.some(doc=>doc.role==='assistant'&&doc.text==='Partial preserved answer'&&doc.status==='cancelled'));assert.equal(docs.filter(doc=>doc.kind==='memory').length,0);
});
test('many short archive messages stay under the actual rendered UTF8 upload limit',()=>{
  const records=Array.from({length:38000},(_,index)=>({id:'message-'+index,kind:'message',text:'x'.repeat(450),createdAt:'2026-10-10'}));
  const chunks=trainingChunks(records);assert.ok(chunks.length>1);assert.ok(chunks.every(chunk=>chunk.buffer.length<20*1024*1024));assert.equal(chunks.reduce((sum,chunk)=>sum+chunk.sourceIds.length,0),records.length);
});
test('disabled and unmatched checklist rules do not produce false pending approval findings',()=>{
  const definitions=[{id:'disabled',kind:'checklist',enabled:false,name:'Disabled',conditions:[{field:'Manufacturer',operator:'eq',value:'DEMO SUPPLIER'}]},{id:'other-supplier',kind:'checklist',enabled:true,name:'Other supplier',conditions:[{field:'Manufacturer',operator:'eq',value:'OTHER'}]}];
  const result=Intelligence.analyzeOperationalData({cpRows:[row()],cpAvailable:true,checklist:{definitions,answers:{}}});
  assert.ok(!result.findings.some(item=>['APPROVAL_disabled','APPROVAL_other-supplier'].includes(item.code)));
});
test('private document hot writes use WAL; concurrent stale edits fail and ordered messages survive reopen',async t=>{
  const root=await temporary(t),store=createAgentOfficeStore({root}),agent=await store.createProfile('a',{name:'Demo'}),conv=await store.conversation('a',[agent.id],'Ordered');
  for(let index=0;index<100;index++)await store.appendMessage('a',conv.id,{role:'user',text:'x'.repeat(1200),requestId:String(index)});
  const file=store.db('a').getFile();assert.ok((await fs.stat(file)).size<20000);assert.ok((await fs.stat(file+'.wal')).size>100000);
  const updates=await Promise.allSettled([store.updateProfile('a',agent.id,{name:'First',revision:agent.revision}),store.updateProfile('a',agent.id,{name:'Second',revision:agent.revision})]);assert.equal(updates.filter(item=>item.status==='fulfilled').length,1);
  const reopened=createAgentOfficeStore({root}),messages=await reopened.messages('a',conv.id,{limit:100});assert.deepEqual(messages.messages.map(item=>item.requestId),Array.from({length:100},(_,index)=>String(index)));
});

test('equal-revision concurrent observations preserve the losing value even with older device clock',async t=>{
  const root=await temporary(t),store=createAgentOfficeStore({root}),agent=await store.createProfile('a',{name:'Original'});
  const incoming={...agent,name:'Concurrent older clock',updatedAt:'2000-01-01T00:00:00.000Z'};
  await store.importRecords('a',[{doc:incoming}]);
  assert.equal((await store.get('a','profile',agent.id)).name,'Original');
  assert.ok((await store.records('a')).some(doc=>doc.kind==='memory-version' && doc.name==='Concurrent older clock'));
  assert.equal((await store.state('a')).conflicts.length,1);
});

test('natural-language scope uses explicit identifiers and preserves manual filters',()=>{
  assert.deepEqual(inferScope('Sipariş 9000103 PLM ID 8000003 renk kodu BLUE'),{orderCode:'9000103',plmId:'8000003',colourCode:'BLUE'});
  assert.deepEqual(inferScope('9000103 siparişindeki riski incele',{orderCode:'9000100'}),{orderCode:'9000100'});
  assert.deepEqual(inferScope('Order quantity is 12000; compare prices'),{});
});

test('report automation reuses the real DSL and needs approval, unchanged preview and current CREATE permission',async t=>{
  const root=await temporary(t),store=createAgentOfficeStore({root}),iam=access();let permitted=true,matched=1;
  iam.hasCapability=(_profile,capability)=>permitted&&capability==='AUTOMATIONS.CREATE';
  const language=require('../server/lib/automation-language'),registry=require('../server/lib/ai-capability-registry'),compiler=require('../server/lib/ai-automation-compiler');
  const model=registry.getCapabilityModel(),safeModel={...model,actions:model.actions.filter(action=>['OPEN_PAGE','SHOW_REPORT'].includes(action.id))};
  const guide=require('../server/lib/ai-guide-generator').generateGuide(safeModel);assert.ok(!guide.includes('SEND_EMAIL'));assert.ok(guide.includes('SHOW_REPORT'));
  const code='BUYERLOG_AUTOMATION 1.0\nNAME "Demo risk report"\nTRIGGER\n  MANUAL\nEND\nSOURCE "orders"\nWHEN\n  [Order Quantity] > 50\nEND\nACTIONS\n  SHOW_REPORT\n    TITLE "Demo risk report"\n  END\nEND';
  const parsed=language.parse(code),validation=language.validate(parsed);assert.equal(validation.ok,true);
  const validateAutomation=async()=>({source:parsed.source,total:1,matched,actions:parsed.actions.map(action=>action.type)});
  const service=createAgentOfficeService({store,userAccess:iam,sync:null,engine:{ask:async()=>({structured:{ok:true},data:{code},text:code})},getOperationalData:async()=>({cpRows:[row()],cpAvailable:true}),automationGuide:async()=>guide,validateAutomation});t.after(()=>service.stop());
  const state=await service.state(profiles.a),run=await service.run(profiles.a,{profileIds:[state.profiles[0].id],task:'Show a quantity risk report',mode:'automation'});
  assert.equal(run.job.proposedAutomation.code,code);assert.ok((await store.messages('a',run.conversation.id)).messages.some(message=>message.role==='assistant'&&message.text===code));
  const app=express();app.use((req,_res,next)=>{req.currentUser=profiles.a;next();});let drafts=0;
  register(app,{express,service,userAccess:iam,validateAutomation,applyAutomation:async()=>{drafts++;return compiler.compile(parsed,validation,{sourceCode:code});}});
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
  const base='http://127.0.0.1:'+server.address().port+'/api/agent-office/jobs/'+run.job.id+'/automation';
  const post=async(action,body)=>fetch(base+'/'+action,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
  const preview=await(await post('preview',{})).json();assert.ok(preview.fingerprint);
  assert.equal((await post('apply',{fingerprint:preview.fingerprint})).status,403);assert.equal(drafts,0);
  matched=0;assert.equal((await post('apply',{fingerprint:preview.fingerprint,confirmed:true})).status,409);assert.equal(drafts,0);
  matched=1;permitted=false;assert.equal((await post('apply',{fingerprint:preview.fingerprint,confirmed:true})).status,403);assert.equal(drafts,0);
  permitted=true;const saved=await(await post('apply',{fingerprint:preview.fingerprint,confirmed:true})).json();assert.equal(saved.result.enabled,false);assert.equal(saved.result.schedule.enabled,false);assert.equal(saved.result.appActions[0].action,'show_report');assert.equal(drafts,1);
});

test('bulk archive review is cost-approved and uses the real LCW upload contract; summaries remain unverified',async t=>{
  const root=await temporary(t),f=fixture(root);t.after(()=>f.service.stop());const state=await f.service.state(profiles.a),profileIds=[state.profiles[0].id];
  await f.service.learn(profiles.a,profileIds[0],{text:'Archive decision',type:'decision',approved:true});
  const preview=await f.service.trainingPreview(profiles.a,{profileIds});
  let uploads=0;f.service.engineOf().askWithFiles=async(_owner,input)=>{uploads++;const file=require('../server/lib/lcwai/lcwai-files').validateUpload(input.files[0]);assert.equal(file.contentType,'text/markdown');assert.ok(file.size<20*1024*1024);return{structured:{ok:true},data:{answer:'Proposed archive summary'},text:'Proposed archive summary'};};
  await assert.rejects(f.service.reviewArchive(profiles.a,{profileIds,confirmed:false,fingerprint:preview.fingerprint,maxCalls:1}),err=>err.code==='OFFICE_COST_APPROVAL_REQUIRED');assert.equal(uploads,0);
  const result=await f.service.reviewArchive(profiles.a,{profileIds,confirmed:true,fingerprint:preview.fingerprint,maxCalls:1});assert.equal(result.job.status,'completed');assert.equal(uploads,1);
  const summary=(await f.store.state('a')).summaries[0];assert.equal(summary.requiresVerification,true);assert.equal(summary.origin,'ai-inference');assert.ok(summary.sourceIds.length);
});
test('moderator combination includes direct profile instructions and rejects unapproved or expired memory',async t=>{
  const root=await temporary(t),f=fixture(root);t.after(()=>f.service.stop());
  const first=await f.store.createProfile('a',{name:'CP',instructions:'Verify shipment dates'}),second=await f.store.createProfile('b',{name:'Collection',instructions:'Review option identity'});
  const approved=await f.store.learn('a',first.id,{text:'Approved knowledge',approved:true});await f.store.learn('a',first.id,{text:'Unverified knowledge',approved:false});await f.store.learn('b',second.id,{text:'Expired knowledge',approved:true,expiresAt:'2020-01-01'});
  const selections=[{ownerId:'a',profileId:first.id},{ownerId:'b',profileId:second.id}],preview=await f.service.mergePreview(profiles.m,selections);
  assert.ok(preview.candidates.some(doc=>doc.text==='Verify shipment dates'));assert.ok(preview.candidates.some(doc=>doc.id===approved.id));assert.ok(!preview.candidates.some(doc=>doc.text==='Expired knowledge'||doc.text==='Unverified knowledge'));
  await assert.rejects(f.service.merge(profiles.b,{selections}),err=>err.statusCode===403);
  const merged=await f.service.merge(profiles.m,{selections,fingerprint:preview.fingerprint,confirmed:true,memoryIds:preview.candidates.map(doc=>doc.id),name:'Combined advisor'});assert.equal(merged.lineage.mode,'merged');assert.equal((await f.store.state('m')).memory.filter(doc=>doc.profileId===merged.id).length,preview.candidates.length);
});

test('large archives allow separately approved ranges without uploading omitted parts',async t=>{
  const root=await temporary(t),f=fixture(root);t.after(()=>f.service.stop());const state=await f.service.state(profiles.a),profileIds=[state.profiles[0].id];
  f.store.exportTraining=async()=>[{kind:'message',id:'message-first',text:'A'.repeat(10*1024*1024)},{kind:'message',id:'message-last',text:'B'.repeat(10*1024*1024)}];
  const full=await f.service.trainingPreview(profiles.a,{profileIds});assert.equal(full.totalParts,2);assert.equal(full.estimatedCalls,3);
  const range={startPart:1,partCount:1},selected=await f.service.trainingPreview(profiles.a,{profileIds,...range});assert.equal(selected.estimatedCalls,1);assert.notEqual(selected.fingerprint,full.fingerprint);
  let uploads=0;f.service.engineOf().askWithFiles=async(_owner,input)=>{uploads++;assert.equal(input.context.part,2);assert.equal(input.context.totalParts,2);assert.equal(input.context.completeArchive,false);assert.ok(input.files[0].buffer.includes('message-last'));assert.ok(!input.files[0].buffer.includes('message-first'));return{structured:{ok:true},data:{answer:'Last part summary'},text:'Last part summary'};};
  await assert.rejects(f.service.reviewArchive(profiles.a,{profileIds,...range,confirmed:true,fingerprint:full.fingerprint,maxCalls:3}),err=>err.code==='OFFICE_COST_APPROVAL_REQUIRED');assert.equal(uploads,0);
  const result=await f.service.reviewArchive(profiles.a,{profileIds,...range,confirmed:true,fingerprint:selected.fingerprint,maxCalls:1});assert.equal(uploads,1);assert.deepEqual(result.job.range,{start:1,count:1});
  assert.equal((await f.store.state('a')).summaries[0].part,1);
  await assert.rejects(f.service.trainingPreview(profiles.a,{profileIds,startPart:2,partCount:1}),err=>err.code==='OFFICE_ARCHIVE_BATCH_LIMIT');
  await assert.rejects(f.service.trainingPreview(profiles.a,{profileIds,partCount:16}),err=>err.code==='OFFICE_ARCHIVE_BATCH_LIMIT');
});

test('two-floor workshop routes only through the staircase and avoids every blocked cell',()=>{
 const model=require('../public/agent-office-workshop-model'),{defaultOffice}=require('../server/lib/agent-office-store'),items=defaultOffice().furniture;
 const start={x:4,y:3,floor:1},end={x:12,y:3,floor:0},route=model.path(start,end,items);assert.ok(route.length);assert.deepEqual(route.at(-1),end);
 // The upper landing is at the reference's left edge; the lower landing stays protected.
 let prior=start;for(const point of route){assert.equal(model.blocked(point,items),false);if(prior.floor!==point.floor){assert.deepEqual(prior,{x:0,y:3,floor:1});assert.deepEqual(point,{x:6,y:3,floor:0});}prior=point;}
 assert.equal(model.validPlacement({id:'bad',kind:'desk',x:2,y:3,floor:1},items),false);
 assert.equal(model.validPlacement({id:'bad',kind:'desk',x:6,y:3,floor:0},items),false);
 assert.equal(model.validPlacement({id:'bad',kind:'desk',x:12,y:2,floor:1},items),false);
});
test('workstation assignment gives copied agents separate real desks or commons without inventing desks',()=>{
 const model=require('../public/agent-office-workshop-model'),{defaultOffice}=require('../server/lib/agent-office-store'),profiles=[{id:'ada',deskId:'desk-a'},{id:'atlas',deskId:'desk-b'},{id:'ece',deskId:'desk-c'},...Array.from({length:9},(_,i)=>({id:'copy-'+i,deskId:'desk-a'}))],items=defaultOffice().furniture,assigned=model.stations(profiles,items);
 assert.equal(assigned.size,profiles.length);assert.equal(assigned.get('ada').desk.id,'desk-a');assert.equal([...assigned.values()].filter(s=>s.desk).length,3);for(const station of assigned.values())assert.equal(model.blocked(station.point,items),false);
});
test('four local-time periods and agent states derive from actual jobs and tasks',()=>{
 const {periodForHour,status}=require('../public/agent-office-workshop-model');assert.deepEqual([0,7,13,18,23].map(periodForHour),['night','morning','noon','evening','night']);
 assert.equal(status('a',{activeJobs:[{profileIds:['b']}],connected:true}),'available');assert.equal(status('a',{activeJobs:[{profileIds:['a'],phase:'responding'}]}),'responding');assert.equal(status('a',{jobs:[{profileIds:['a'],status:'failed'}]}),'error');assert.equal(status('a',{memory:[{profileId:'a',type:'task',active:true}]}),'waiting');assert.equal(status('a',{connected:false}),'offline');
});
