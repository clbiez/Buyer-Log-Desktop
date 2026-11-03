'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'bl-report-ops-'));process.env.BUYER_LOG_SERVER_DATA_ROOT=root;
const {createService}=require('../server/lib/test-reports/service'),staging=require('../server/lib/test-reports/staging');
const operations=require('../server/lib/test-reports/operations');
const {spawnSync}=require('node:child_process'),crypto=require('node:crypto');
const {fixture,pdfFromItems}=require('./helpers/external-lab-fixture.cjs');
const owner={id:'owner-a'},other={id:'owner-b'};let revision='v1';
const orders=new Map([['po1',{orderCode:'4100001'}]]);
const service=createService({authorizedOrders:async()=>orders,sourceRevision:()=>revision});
async function create(){return service.parse(owner,[{name:'Lab.pdf',base64:pdfFromItems(fixture()).toString('base64')}],{operation:true});}
test.after(()=>fs.rmSync(root,{recursive:true,force:true}));
test('operation survives expired staging and process-local state, retains exact original bytes',async()=>{
 const parsed=await create();assert.ok(parsed.operationId);const bytes=pdfFromItems(fixture());
 assert.equal(operations.list(owner.id).length,1);
 staging.dropSession(parsed.sessionId);
 const resumed=await service.resumeOperation(owner,parsed.operationId);
 assert.notEqual(resumed.sessionId,parsed.sessionId);assert.equal(resumed.reports[0].talepNo,'DEMSL260000124-A');
 const session=service.sessionFor(owner,resumed.sessionId);assert.deepEqual([...session.files.values()][0].buffer,bytes);
 assert.equal(resumed.operationId,parsed.operationId);
 const restarted=spawnSync(process.execPath,['-e',`const {createService}=require('./server/lib/test-reports/service');const s=createService({authorizedOrders:async()=>new Map([['po1',{orderCode:'4100001'}]])});s.resumeOperation({id:'owner-a'},${JSON.stringify(parsed.operationId)}).then(r=>console.log(JSON.stringify({report:r.reports[0].talepNo,files:s.sessionFor({id:'owner-a'},r.sessionId).files.size}))).catch(e=>{console.error(e);process.exitCode=1;});`],{cwd:path.resolve(__dirname,'..'),env:process.env,encoding:'utf8'});
 assert.equal(restarted.status,0,restarted.stderr);assert.deepEqual(JSON.parse(restarted.stdout.trim()),{report:'DEMSL260000124-A',files:1});
});
test('owner separation, path traversal and draft conflicts preserve existing history',async()=>{
 const parsed=await create();assert.deepEqual(operations.list(other.id),[]);
 await assert.rejects(service.resumeOperation(other,parsed.operationId),{code:'TEST_REPORT_OPERATION_NOT_FOUND'});
 assert.throws(()=>operations.load(owner.id,'../../x'),{code:'TEST_REPORT_OPERATION_NOT_FOUND'});
 const saved=operations.saveDraft(owner.id,parsed.operationId,{expectedRevision:0,draft:{note:'Retest needed',activeEntry:'r0',tab:'sources',entries:[{reportId:'DEMSL260000124-A',chosen:'po1',itemId:'tests',include:true,reviewVerified:true}],packet:{forged:true}}});
 assert.equal(saved.revision,1);
 const resumed=await service.resumeOperation(owner,parsed.operationId);
 assert.equal(resumed.draft.note,'Retest needed');assert.equal(resumed.draft.packet,undefined);
 assert.equal(resumed.draft.entries[0].include,undefined);assert.equal(resumed.draft.entries[0].reviewVerified,undefined);
 assert.throws(()=>operations.saveDraft(owner.id,parsed.operationId,{expectedRevision:0,draft:{note:'stale overwrite'}}),{code:'TEST_REPORT_OPERATION_CONFLICT'});
 assert.equal((await service.resumeOperation(owner,parsed.operationId)).draft.note,'Retest needed');
});
test('validated AI review is archived; changed authority/revision requires fresh review',async()=>{
 const parsed=await create(),cp={rowCount:1,rows:[{key:'po1',orderCode:'4100001',fields:{SecretBusiness:'owned'}}]};
 const {packet}=await service.prepareAssessment(owner,{sessionId:parsed.sessionId,cp,checklistSteps:[{id:'tests'}],checklistStatuses:[{id:'approved',resolved:true}]});
 const ids=packet.sources.map(source=>source.id);
 await service.acceptAssessment(owner,{sessionId:parsed.sessionId,snapshotId:packet.snapshotId,data:{protocol:packet.protocol,caseId:packet.caseId,snapshotId:packet.snapshotId,coveredSourceIds:ids,unresolvedSourceIds:ids,assessments:[]}});
 staging.dropSession(parsed.sessionId);
 const fresh=await service.resumeOperation(owner,parsed.operationId);assert.equal(fresh.reviewCurrent,true);assert.ok(fresh.ai.packet);
 revision='v2';const stale=await service.resumeOperation(owner,parsed.operationId);assert.equal(stale.reviewCurrent,false);
 const denied=createService({authorizedOrders:async()=>new Map(),sourceRevision:()=>revision});
 const revoked=await denied.resumeOperation(owner,parsed.operationId);assert.deepEqual(revoked.ai.packet.cp.rows,[]);assert.equal(revoked.reviewCurrent,false);
});
test('completed operations remain readable but cannot be committed twice by reopening',async()=>{
 const parsed=await create();
 const concurrent=await service.resumeOperation(owner,parsed.operationId);
 await service.commit(owner,{sessionId:parsed.sessionId,items:[{talepNo:'DEMSL260000124-A',orderKey:'po1',itemId:'tests'}]});
 const resumed=await service.resumeOperation(owner,parsed.operationId);assert.equal(resumed.readOnly,true);assert.equal(resumed.phase,'committed');
 assert.ok(resumed.reports.length);assert.ok(service.sessionFor(owner,resumed.sessionId).files.size);
 await assert.rejects(service.commit(owner,{sessionId:resumed.sessionId,items:[]}),{code:'TEST_REPORT_OPERATION_COMMITTED'});
 await assert.rejects(service.commit(owner,{sessionId:concurrent.sessionId,items:[]}),{code:'TEST_REPORT_OPERATION_COMMITTED'});
 assert.throws(()=>operations.capture(staging.getSession(concurrent.sessionId,owner.id),'reviewed'),{code:'TEST_REPORT_OPERATION_COMMITTED'});
});
test('deleted history cannot be resurrected by a late assessment, draft save or commit',async()=>{
 const parsed=await create();operations.remove(owner.id,parsed.operationId);
 assert.throws(()=>operations.saveDraft(owner.id,parsed.operationId,{expectedRevision:0,draft:{note:'late'}}),{code:'TEST_REPORT_OPERATION_NOT_FOUND'});
 await assert.rejects(service.prepareAssessment(owner,{sessionId:parsed.sessionId,cp:{}}),{code:'TEST_REPORT_OPERATION_NOT_FOUND'});
 await assert.rejects(service.commit(owner,{sessionId:parsed.sessionId,items:[]}),{code:'TEST_REPORT_OPERATION_NOT_FOUND'});
 assert.ok(!operations.list(owner.id).some(item=>item.id===parsed.operationId));
});
test('corrupt archived file fails verification and does not silently discard the history record',async()=>{
 const parsed=await create(),dir=path.join(root,'document-review-operations',crypto.createHash('sha256').update(owner.id).digest('hex'),parsed.operationId);
 const file=fs.readdirSync(dir).find(name=>name.endsWith('.bin'));fs.writeFileSync(path.join(dir,file),'changed');
 await assert.rejects(service.resumeOperation(owner,parsed.operationId),{code:'TEST_REPORT_OPERATION_INVALID'});
 assert.ok(operations.list(owner.id).some(item=>item.id===parsed.operationId));
});
