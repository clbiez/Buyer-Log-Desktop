'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'bl-agent-supporting-'));
for(const key of ['BUYER_LOG_DATA_ROOT','BUYER_LOG_LOCAL_DATA_ROOT','BUYER_LOG_SERVER_DATA_ROOT','BUYER_LOG_AUTH_DATA_ROOT'])process.env[key]=root;
const db=require('../server/db'),fabric=require('../server/lib/fabric-cards'),calendar=require('../server/lib/merch-calendar-store'),cards=require('../server/lib/license-cards'),artifacts=require('../server/lib/agent-artifact-store');
const {createToolRegistry}=require('../server/lib/agent-tool-registry'),{createAgentOfficeStore}=require('../server/lib/agent-office-store'),{createAgentOfficeService}=require('../server/lib/agent-office-service'),{createAgentRuntime}=require('../server/lib/agent-runtime'),runtimeStore=require('../server/lib/agent-workflow-store'),{createPolicyEngine}=require('../server/lib/agent-policy-engine');
const {createLicenseCardService}=require('../server/lib/license-card-service');
let sequence=0;test.after(()=>fs.rmSync(root,{recursive:true,force:true}));
const html=week=>Buffer.from(`<!doctype html><html><app-lcw-calendar id="app-lcw-calendar-2026"><table><tr class="nopadding noselect"><th id="January" rowspan="1">January</th><td class="week-cell">${week}</td>${(week===1?[29,30,31,1,2,3,4]:[5,6,7,8,9,10,11]).map(day=>`<td><span class="noselect">${day}</span></td>`).join('')}</tr></table></app-lcw-calendar></html>`);
async function fixture(t){
 const profile={id:'support'+(++sequence),enabled:true,areas:['source','orders','cp','koleksiyon'],permissions:['manageBusinessRules','manageModelConnections'],edit:true},access={profileById:id=>id===profile.id?profile:null,publicProfile:p=>p,hasArea:(p,a)=>p.areas.includes(a),hasPermission:(p,k)=>p.permissions.includes(k),effectiveCollectionAccess:p=>p.edit?[{level:'edit',ownerId:p.id}]:[],hasCapability:()=>true,appendAudit:()=>{}};
 let service;const store=createAgentOfficeStore({root:path.join(root,profile.id)}),registry=createToolRegistry({userAccess:access,authorizeCapability:(ctx,args)=>service.taskAuthorize(ctx,args)}),changes=[];
 const license=createLicenseCardService({loadOverrides:db.loadOverrides,saveOverrides:db.saveOverrides,mutate:db.mutateSharedResource,pricing:require('../server/lib/resource-rule-service'),getDiscoveryRows:async()=>({module:'cp',rows:[{License:'DEMO '+sequence,Licensor:'DEMO LICENSOR'}]}),publish:async()=>({ok:true}),changed:async()=>{}});
 require('../server/lib/agent-supporting-resource-tools').registerSupportingResourceTools(registry,{license,userAccess:access,authorizeFabric:async()=>{},canEditFabric:p=>p.edit,changed:async(_p,section)=>changes.push(section),withAgentMutation:(ctx,work)=>store.withProfileMutation(ctx.ownerId,ctx.input.officeAgentId,ctx.input.officeAgentRevision,()=>{ctx.assertAuthority();return work();})});
 const runtime=createAgentRuntime({store:runtimeStore,toolRegistry:registry,policyEngine:createPolicyEngine({userAccess:access})});
 service=createAgentOfficeService({store,userAccess:access,toolRegistry:registry,runtime,runtimeStore,getOperationalData:async()=>({})});t.after(()=>service.stop());
 const agent=await store.createProfile(profile.id,{name:'Sources',areas:['source','orders','cp','collection']});return {profile,access,store,registry,service,agent,license,changes};
}
const create=(f,toolId,args={})=>f.service.taskCreate(f.profile,{agentId:f.agent.id,steps:[{toolId,args}]}),apply=(f,job)=>f.service.taskExecute(f.profile,job.id,{confirmed:true,fingerprint:job.steps[0].preview.fingerprint}),undo=(f,job)=>f.service.taskRollback(f.profile,job.id,{stepId:job.steps[0].id,confirmed:true});
test('fabric card create/update/delete use the native dictionary, approval, exact inverse and durable receipt',async t=>{
 const f=await fixture(t),code='100000001',before=fabric.loadFabricCards().cards[code]||null;
 let job=await create(f,'collection.fabric.upsert',{items:[{code,summary:'Demo jersey',summaryEn:'Demo jersey',details:{weight:'150 gsm'},raw:'DEMO RAW'}]});
 assert.equal(job.status,'waiting_approval');await assert.rejects(f.service.taskExecute(f.profile,job.id),{code:'OFFICE_APPROVAL_REQUIRED'});
 let result=await apply(f,job);assert.equal(result.status,'completed');assert.equal(fabric.loadFabricCards().cards[code].details.weight,'150 gsm');
 const first=JSON.parse(JSON.stringify(fabric.loadFabricCards().cards[code]));result=await apply(f,await create(f,'collection.fabric.upsert',{items:[{code,summary:'Revised',summaryEn:'Revised'}]}));assert.equal(result.status,'completed');
 await undo(f,result);assert.deepEqual(fabric.loadFabricCards().cards[code],first);
 result=await apply(f,await create(f,'collection.fabric.delete',{code}));assert.equal(result.status,'completed');assert.equal(fabric.loadFabricCards().cards[code],undefined);await undo(f,result);assert.deepEqual(fabric.loadFabricCards().cards[code],first);
 assert.equal(before,null);assert.ok(f.changes.includes('fabricCards'));
 const again=await apply(f,job);assert.equal(again.steps[0].result.data.revision,job.steps[0].preview.preview.revision+1);
});
test('fabric live editor grant revocation and stale revisions stop writes, inverse never overwrites newer UI edits',async t=>{
 const f=await fixture(t),code='100000002',job=await create(f,'collection.fabric.upsert',{items:[{code,summary:'Denied'}]});f.profile.edit=false;
 await assert.rejects(apply(f,job),{code:'OFFICE_TOOL_FORBIDDEN'});await assert.rejects(f.registry.execute('collection.fabric.upsert',{items:[{code,summary:'Denied'}]},{ownerId:f.profile.id,profile:f.profile,dryRun:true}),{code:'OFFICE_TOOL_FORBIDDEN'});assert.equal(fabric.loadFabricCards().cards[code],undefined);f.profile.edit=true;
 const pending=await create(f,'collection.fabric.upsert',{items:[{code,summary:'Mine'}]});fabric.upsertFabricCards([{code,summary:'Other'}],{id:'other'});
 assert.equal((await apply(f,pending)).status,'failed');assert.equal(fabric.loadFabricCards().cards[code].summary,'Other');
 const done=await apply(f,await create(f,'collection.fabric.upsert',{items:[{code,summary:'Mine'}]}));fabric.upsertFabricCards([{code,summary:'Newer'}],{id:'other'});
 await assert.rejects(undo(f,done),{code:'OFFICE_PREVIEW_CHANGED'});assert.equal(fabric.loadFabricCards().cards[code].summary,'Newer');
});
test('fabric inputs reject invalid IDs, duplicate cards and forged AI provenance; bounded reads declare omitted cards',async t=>{
 const f=await fixture(t);for(const items of [[{code:'abc',summary:'Bad'}],[{code:'100000003',summary:'A'},{code:'100000003',summary:'B'}],[{code:'100000003',summary:'A',summarySource:'ai'}]])await assert.rejects(create(f,'collection.fabric.upsert',{items}),e=>['OFFICE_TOOL_SCHEMA','OFFICE_RULE_INVALID'].includes(e.code));
 const read=await f.registry.execute('collection.fabric.read',{limit:1},{ownerId:f.profile.id,profile:f.profile});assert.equal(read.data.cards.length,1);assert.equal(read.data.truncated,true);
});
test('the shared native fabric lease guards both normal writers and trusted authority immediately before persistence',()=>{
 let guarded=false;assert.throws(()=>fabric.upsertFabricCards([{code:'100000004',summary:'No effect'}],{id:'owner'},null,{assertAuthority:()=>{guarded=fs.existsSync(fabric.FILE+'.write-lock');throw Object.assign(new Error('denied'),{code:'DENIED'});}}),{code:'DENIED'});
 assert.equal(guarded,true);assert.equal(fabric.loadFabricCards().cards['100000004'],undefined);
});
test('Merch Calendar imports actual owner-bound bytes, updates the existing date engine and restores absence',async t=>{
 const f=await fixture(t);calendar.remove();const file=await artifacts.put(f.profile,html(1),'demo.html','merch-calendar');
 const job=await create(f,'resource.merch.import',{artifactId:file.id});assert.equal(job.steps[0].preview.preview.impact.weekCount,1);const result=await apply(f,job);assert.equal(result.status,'completed');
 assert.equal(calendar.load().sourceHash,file.sha256);assert.equal(require('../public/date-dimension').describe('2026-01-01').lcwWeek,1);
 await undo(f,result);assert.equal(calendar.load(),null);assert.equal(fs.existsSync(calendar.FILE),false);
 await assert.rejects(create({...f,profile:{...f.profile,id:'foreign'}},'resource.merch.import',{artifactId:file.id}));
});
test('Merch removal inverse restores the exact source; invalid bytes and newer revisions fail closed',async t=>{
 const f=await fixture(t);calendar.save(html(1),'original.html');const before=JSON.parse(JSON.stringify(calendar.load())),done=await apply(f,await create(f,'resource.merch.delete'));
 assert.equal(done.status,'completed');assert.equal(calendar.load(),null);await undo(f,done);assert.deepEqual(calendar.load(),{...before,_revision:calendar.load()._revision});assert.ok(calendar.load()._revision>before._revision);
 const file=await artifacts.put(f.profile,html(2),'new.html','merch-calendar'),pending=await create(f,'resource.merch.import',{artifactId:file.id});calendar.save(html(1),'someone-else.html');assert.equal((await apply(f,pending)).status,'failed');assert.equal(calendar.load().sourceName,'someone-else.html');
 const malformed=await artifacts.put(f.profile,Buffer.from('not a calendar'),'invalid.html','merch-calendar');await assert.rejects(create(f,'resource.merch.import',{artifactId:malformed.id}));
 assert.throws(()=>artifacts.read({id:'foreign'},file.id,'merch-calendar'),{code:'OFFICE_NOT_FOUND'});
});
test('calendar trusted guards run inside the native lease, and corrupt persisted calendars cannot be silently overwritten',()=>{
 const before=fs.readFileSync(calendar.FILE),fp=calendar.fingerprint();let guarded=false;
 assert.throws(()=>calendar.save(html(1),'denied.html',{expectedFingerprint:fp,assertAuthority:()=>{guarded=fs.existsSync(calendar.FILE+'.write-lock');throw Object.assign(new Error('denied'),{code:'DENIED'});}}),{code:'DENIED'});assert.equal(guarded,true);assert.deepEqual(fs.readFileSync(calendar.FILE),before);
 fs.writeFileSync(calendar.FILE,'{broken');assert.throws(()=>calendar.save(html(1),'overwrite.html'),{code:'MERCH_STORE_INVALID'});assert.equal(fs.readFileSync(calendar.FILE,'utf8'),'{broken');
 const corrupt=JSON.parse(before);corrupt.weeks[0].start='2026-12-01';fs.writeFileSync(calendar.FILE,JSON.stringify(corrupt));assert.throws(()=>calendar.save(html(1),'overwrite.html'),{code:'MERCH_STORE_INVALID'});fs.writeFileSync(calendar.FILE,before);
});
test('license discovery is explicit approved import; read never discovers or writes; native profile/contracts update and inverse persist',async t=>{
 const f=await fixture(t),initial=db.loadOverrides();await f.registry.execute('license.cards.read',{limit:10},{ownerId:f.profile.id,profile:f.profile});assert.deepEqual(db.loadOverrides(),initial);
 const imported=await apply(f,await create(f,'license.cards.discover'));assert.equal(imported.status,'completed');const card=cards.stateOf(db.loadOverrides()).items.find(c=>c.license==='DEMO '+sequence);assert.ok(card);const before=JSON.parse(JSON.stringify(card));
 const rule={id:'support-rule-'+sequence,royalty:5,trCommission:3,ydCommission:null,hologramCost:0,opdStart:'2026-01-01',opdEnd:'2026-12-31'};
 const job=await create(f,'license.cards.update',{cardId:card.id,profile:{workingNotes:'APPROVED DEMO',contactEmail:'demo@example.invalid'},rules:[rule]});assert.equal(job.status,'waiting_approval');assert.equal(job.steps[0].preview.preview.impact.contractsChanged,true);
 const done=await apply(f,job);assert.equal(done.status,'completed');assert.equal(cards.stateOf(db.loadOverrides()).items.find(c=>c.id===card.id).workingNotes,'APPROVED DEMO');assert.equal(db.loadOverrides().pricingRules.find(r=>r.id===rule.id).royalty,5);
 await undo(f,done);assert.deepEqual(cards.stateOf(db.loadOverrides()).items.find(c=>c.id===card.id),before);assert.ok(!db.loadOverrides().pricingRules.some(r=>r.id===rule.id));
});
test('license tool snapshots exclude portal access material and native rule scope/overlap rejects malformed proposals',async t=>{
 const f=await fixture(t);await f.license.discover(f.profile);const ov=db.loadOverrides(),card=cards.stateOf(ov).items.find(c=>c.license==='DEMO '+sequence);card.portalUsername='PRIVATE USER';card.accessReference='PRIVATE REFERENCE';db.saveOverrides(ov,ov._revision);
 const read=await f.registry.execute('license.cards.read',{cardIds:[card.id]},{ownerId:f.profile.id,profile:f.profile});assert.doesNotMatch(JSON.stringify(read),/PRIVATE USER|PRIVATE REFERENCE/);
 const job=await create(f,'license.cards.update',{cardId:card.id,profile:{workingNotes:'Demo'}});assert.doesNotMatch(JSON.stringify(job.steps[0].preview),/PRIVATE USER|PRIVATE REFERENCE/);
 await assert.rejects(create(f,'license.cards.update',{cardId:card.id,profile:{portalUsername:'AI MUST NOT HANDLE'}}),{code:'OFFICE_TOOL_SCHEMA'});
 await assert.rejects(create(f,'license.cards.update',{cardId:card.id,rules:[{id:'bad',license:'OTHER',royalty:5,trCommission:3,hologramCost:0}]}),{code:'LICENSE_RULE_SCOPE'});
 const rule={id:'overlap1',royalty:5,trCommission:3,hologramCost:0};await assert.rejects(create(f,'license.cards.update',{cardId:card.id,rules:[rule,{...rule,id:'overlap2'}]}),{code:'LICENSE_RULE_OVERLAP'});
});
test('license updates preserve concurrent unrelated notes while guarding both section revisions and current IAM',async t=>{
 const f=await fixture(t);await f.license.discover(f.profile);const card=cards.stateOf(db.loadOverrides()).items.find(c=>c.license==='DEMO '+sequence),job=await create(f,'license.cards.update',{cardId:card.id,profile:{workingNotes:'Agent'}});
 const ov=db.loadOverrides();ov.notesmap.UNRELATED='Real UI note';db.saveOverrides(ov,ov._revision);const done=await apply(f,job);assert.equal(done.status,'completed');assert.equal(db.loadOverrides().notesmap.UNRELATED,'Real UI note');
 const pending=await create(f,'license.cards.update',{cardId:card.id,profile:{workingNotes:'Denied'}});f.profile.permissions=[];await assert.rejects(apply(f,pending),{code:'OFFICE_TOOL_FORBIDDEN'});assert.equal(cards.stateOf(db.loadOverrides()).items.find(c=>c.id===card.id).workingNotes,'Agent');
 f.profile.permissions=['manageBusinessRules'];const latest=await create(f,'license.cards.update',{cardId:card.id,profile:{workingNotes:'New'}});await f.license.update(f.profile,card.id,{revision:cards.revisionOf(db.loadOverrides(),'licenseCards'),profile:{workingNotes:'Native UI'}});assert.equal((await apply(f,latest)).status,'failed');
 await assert.rejects(undo(f,done),{code:'OFFICE_PREVIEW_CHANGED'});assert.equal(cards.stateOf(db.loadOverrides()).items.find(c=>c.id===card.id).workingNotes,'Native UI');
});
test('license contracts persist a native peer outbox when publication is unavailable and do not masquerade as synchronized',async t=>{
 const f=await fixture(t),license=createLicenseCardService({loadOverrides:db.loadOverrides,saveOverrides:db.saveOverrides,mutate:db.mutateSharedResource,pricing:require('../server/lib/resource-rule-service'),getDiscoveryRows:async()=>({module:'cp',rows:[{License:'PENDING DEMO',Licensor:'Pending'}]}),publish:async()=>{throw new Error('channel down');},changed:async()=>{}});
 const result=await license.discover(f.profile);assert.equal(result.syncPending,true);const pending=db.loadOverrides().licenseCardOutbox;assert.ok(Object.values(pending).some(v=>v.fields.profile?.license==='PENDING DEMO'));
});
test('read-only collection grants hide fabric mutations from the actual Office catalog; source-only license discovery stays accessible',async t=>{
 const f=await fixture(t);f.profile.edit=false;const tools=await f.service.taskCatalog(f.profile,f.agent.id);assert.ok(tools.some(tool=>tool.id==='collection.fabric.read'));assert.ok(!tools.some(tool=>tool.id==='collection.fabric.upsert'||tool.id==='collection.fabric.delete'));
 f.profile.areas=['source'];assert.ok((await f.service.taskCatalog(f.profile,f.agent.id)).some(tool=>tool.id==='license.cards.discover'));
 const described=await f.registry.execute('module.describe',{module:'licensecards'},{ownerId:f.profile.id,profile:f.profile});assert.equal(described.id,'licensecards');
 f.profile.areas=[];await assert.rejects(f.registry.rollback('license.cards.update',{}, {ownerId:f.profile.id,profile:f.profile,approvalGranted:true}),{code:'OFFICE_TOOL_FORBIDDEN'});
});
function nativeChild(script,args){return new Promise((resolve,reject)=>{const child=require('node:child_process').spawn(process.execPath,['-e',script,...args],{env:process.env,stdio:['ignore','pipe','pipe']});let output='',errors='';child.stdout.on('data',chunk=>output+=chunk);child.stderr.on('data',chunk=>errors+=chunk);child.on('error',reject);child.on('exit',code=>{if(code!==0)reject(new Error(errors||'native child failed'));else{try{resolve(JSON.parse(output));}catch(error){reject(error);}}});});}
test('two real processes sharing fabric CAS have one winner and never lose the winner to the stale native UI writer',async()=>{
 const revision=fabric.loadFabricCards()._revision,script="const fs=require('node:fs'),s=require(process.argv[1]);let result;try{const r=s.upsertFabricCards([{code:process.argv[2],summary:'Native race'}],{id:process.argv[2]},Number(process.argv[3]));result={ok:true,revision:r.revision,code:process.argv[2]};}catch(e){result={ok:false,code:e.code};}fs.writeSync(1,JSON.stringify(result));";
 const results=await Promise.all(['100000031','100000032'].map(code=>nativeChild(script,[require.resolve('../server/lib/fabric-cards'),code,String(revision)])));assert.equal(results.filter(r=>r.ok).length,1);assert.equal(results.find(r=>!r.ok).code,'REVISION_CONFLICT');const winner=results.find(r=>r.ok);assert.equal(fabric.loadFabricCards().cards[winner.code].summary,'Native race');assert.equal(fabric.loadFabricCards()._revision,revision+1);
});
test('two real processes sharing Merch fingerprint cannot overwrite the winner with the stale calendar',async()=>{
 const fp=calendar.fingerprint(),script="const fs=require('node:fs'),s=require(process.argv[1]);let result;try{s.save(Buffer.from(process.argv[2],'base64'),process.argv[3],{expectedFingerprint:process.argv[4]});result={ok:true,name:process.argv[3]};}catch(e){result={ok:false,code:e.code};}fs.writeSync(1,JSON.stringify(result));";
 const results=await Promise.all(['calendar-a.html','calendar-b.html'].map(name=>nativeChild(script,[require.resolve('../server/lib/merch-calendar-store'),html(1).toString('base64'),name,fp])));assert.equal(results.filter(r=>r.ok).length,1);assert.equal(results.find(r=>!r.ok).code,'OFFICE_PREVIEW_CHANGED');assert.equal(calendar.load().sourceName,results.find(r=>r.ok).name);
});
test('a later import/delete cannot make an absent calendar match an earlier agent inverse receipt',async t=>{
 const f=await fixture(t);calendar.save(html(1),'agent-baseline.html');const done=await apply(f,await create(f,'resource.merch.delete'));assert.equal(done.status,'completed');const receipt=done.steps[0].result.rollbackToken.expectedFingerprint;
 calendar.save(html(2),'another-native-upload.html');calendar.remove();assert.notEqual(calendar.fingerprint(),receipt);await assert.rejects(undo(f,done),{code:'OFFICE_PREVIEW_CHANGED'});assert.equal(calendar.load(),null);
});
test('agent scope revoked during the actual backup await stops the approved license and calendar mutations',async t=>{
 for(const toolId of ['license.cards.update','resource.merch.delete']){
  const f=await fixture(t);let args={},before;
  if(toolId==='license.cards.update'){await f.license.discover(f.profile);const card=f.license.read().cards.find(card=>card.license==='DEMO '+sequence);args={cardId:card.id,profile:{workingNotes:'MUST NOT WRITE'}};before=f.license.inverseSnapshot(card.id,false);}
  else{calendar.save(html(1),'guarded-calendar.html');before=calendar.fingerprint();}
  const job=await create(f,toolId,args),put=artifacts.put;
  artifacts.put=async(...values)=>{const artifact=await put(...values);await f.store.updateProfile(f.profile.id,f.agent.id,{revision:f.agent.revision,areas:['collection']});return artifact;};
  let result;try{result=await apply(f,job);}finally{artifacts.put=put;}
  assert.equal(result.status,'failed');assert.equal((await f.store.get(f.profile.id,'profile',f.agent.id)).revision,f.agent.revision+1);
  if(toolId==='license.cards.update')assert.deepEqual(f.license.inverseSnapshot(args.cardId,false),before);else assert.equal(calendar.fingerprint(),before);
 }
});
test('the trusted profile WAL gate serializes a competing real profile update until the native transaction commits',async t=>{
 const f=await fixture(t);let enter,release;const started=new Promise(resolve=>enter=resolve),resume=new Promise(resolve=>release=resolve);let edited=false;
 const mutation=f.store.withProfileMutation(f.profile.id,f.agent.id,f.agent.revision,async()=>{enter();await resume;assert.equal(edited,false);return 'actual commit boundary';});await started;
 const edit=f.store.updateProfile(f.profile.id,f.agent.id,{revision:f.agent.revision,areas:['collection']}).then(()=>{edited=true;});await new Promise(resolve=>setTimeout(resolve,30));assert.equal(edited,false);release();assert.equal(await mutation,'actual commit boundary');await edit;assert.equal(edited,true);
});
test('fabric native READ/upsert/delete results and previews have strict complete field contracts',async t=>{
 const f=await fixture(t);for(const id of ['collection.fabric.read','collection.fabric.upsert','collection.fabric.delete']){const tool=f.registry.get(id);assert.equal(tool.outputSchema.additionalProperties,false);assert.equal(tool.dryRunOutputSchema.additionalProperties,false);}
 const code='100000090',ready=await create(f,'collection.fabric.upsert',{items:[{code,summary:'Native bilingual fabric',summaryEn:'Native bilingual fabric',details:{composition:'100% cotton'},raw:'Full raw fabric detail'}]}),done=await apply(f,ready);assert.equal(done.status,'completed');assert.equal(done.steps[0].result.data.cards[0].details.composition,'100% cotton');assert.equal(done.steps[0].result.data.cards[0].raw,'Full raw fabric detail');assert.equal(done.steps[0].result.data.cards[0].summarySource,'manual');
 const read=await f.registry.execute('collection.fabric.read',{codes:[code]},{ownerId:f.profile.id,profile:f.profile});assert.deepEqual(read.data.cards[0],fabric.loadFabricCards().cards[code]);const removed=await apply(f,await create(f,'collection.fabric.delete',{code}));assert.equal(removed.status,'completed');await undo(f,removed);assert.deepEqual(fabric.loadFabricCards().cards[code],read.data.cards[0]);
});
test('fabric strict receipts preserve full 50-card native inverse and do not invent a rollback for skipped-only work',async t=>{
 const f=await fixture(t),items=Array.from({length:50},(_,i)=>({code:String(100000100+i),summary:'Native '+i,summaryEn:'Native '+i,details:{composition:'界'.repeat(200)},raw:'界'.repeat(4000)}));fabric.upsertFabricCards(items,f.profile);const snapshot=fabric.loadFabricCards().cards,before=Object.fromEntries(items.map(item=>[item.code,snapshot[item.code]]));
 const done=await apply(f,await create(f,'collection.fabric.upsert',{items:items.map(item=>({...item,summary:'Revised '+item.code}))}));assert.equal(done.status,'completed');assert.equal(done.steps[0].result.data.updated,50);assert.equal(done.steps[0].result.rollbackToken.before[items[49].code].raw,before[items[49].code].raw);await undo(f,done);const restored=fabric.loadFabricCards().cards;for(const item of items)assert.deepEqual(restored[item.code],before[item.code]);
 const noop=await apply(f,await create(f,'collection.fabric.upsert',{items,onlyMissing:true}));assert.equal(noop.status,'completed');assert.equal(noop.steps[0].result.data.updated,0);assert.equal(noop.steps[0].result.data.skipped,50);assert.equal(noop.steps[0].result.rollbackToken,undefined);
});
test('Merch READ/import/delete publish strict native week, metadata and inverse contracts',async t=>{
 const f=await fixture(t);for(const id of ['resource.merch.read','resource.merch.import','resource.merch.delete']){assert.equal(f.registry.get(id).outputSchema.additionalProperties,false);assert.equal(f.registry.get(id).dryRunOutputSchema.additionalProperties,false);}
 calendar.remove();const file=await artifacts.put(f.profile,html(1),'native-demo.html','merch-calendar'),done=await apply(f,await create(f,'resource.merch.import',{artifactId:file.id}));assert.equal(done.status,'completed');assert.equal(done.steps[0].result.data.summary.weekCount,1);
 const read=await f.registry.execute('resource.merch.read',{year:2026},{ownerId:f.profile.id,profile:f.profile});assert.equal(read.data.weeks[0].start,'2025-12-29');assert.equal(read.data.weeks[0].end,'2026-01-04');assert.equal(read.data.summary.years[0].year,2026);const before=calendar.load(),removed=await apply(f,await create(f,'resource.merch.delete'));assert.equal(removed.status,'completed');await undo(f,removed);assert.deepEqual(calendar.load(),{...before,_revision:calendar.load()._revision});
});
test('legacy Merch metadata extras are omitted from agent previews but preserved by full native inverse',async t=>{
 const f=await fixture(t);calendar.save(html(1),'legacy-demo.html');const before=calendar.load();before.meta.privateDetails='KEEP_FULL_NATIVE_METADATA';before.meta.weekCount='invalid legacy count';calendar.restoreSnapshot(before);const original=calendar.load(),ready=await create(f,'resource.merch.delete');assert.ok(!JSON.stringify(ready.steps[0].preview).includes('KEEP_FULL_NATIVE_METADATA'));assert.ok(ready.steps[0].preview.preview.metadataOmissions>0);
 const done=await apply(f,ready);assert.equal(done.status,'completed');await undo(f,done);assert.deepEqual(calendar.load().meta,original.meta);
});
