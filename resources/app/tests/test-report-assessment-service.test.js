'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'bl-assessment-'));
process.env.BUYER_LOG_SERVER_DATA_ROOT=root;
const {createService}=require('../server/lib/test-reports/service');
const store=require('../server/lib/test-reports/store');
const profile={id:'demo',displayName:'Demo'};
const orders=new Map([['po7',{orderCode:'1381207'}],['po1',{orderCode:'1381201'}]]);
let revision='v1';
const service=createService({authorizedOrders:async()=>orders,sourceRevision:()=>revision});
const cp={rowCount:2,columns:['Order Code','Last'],rows:[{key:'po7',orderCode:'1381207',fields:{Last:999}},{key:'po1',orderCode:'1381201',fields:{Last:''}}]};
async function prepare(id='SGS-2026-001') {
  const mail='From: lab@example.test\r\nTo: buyer@example.test\r\nSubject: Test evidence\r\nDate: Tue, 20 Oct 2026 10:00:00 +0300\r\n\r\nReport '+id+' Order 1381207 PATCH FABRIC Fail\r\nLast source line';
  const parsed=await service.parse(profile,[{name:'result.eml',base64:Buffer.from(mail).toString('base64')}]);
  const ready=await service.prepareAssessment(profile,{sessionId:parsed.sessionId,cp,checklistSteps:[{id:'fabric'}],checklistStatuses:[{id:'rejected'},{id:'approved',resolved:true}]});
  const packet=ready.packet,source=packet.sources[0];
  const data={protocol:packet.protocol,caseId:packet.caseId,snapshotId:packet.snapshotId,coveredSourceIds:[source.id],unresolvedSourceIds:[],explanation:'Reviewed',assessments:[{
    reportId:id,orderKey:'po7',orderCode:'1381207',step:'fabric',status:'rejected',scope:'verified',component:'PATCH FABRIC',labResult:'Fail',summary:'Fabric failed',actions:['Request retest'],risks:[],
    evidence:[{sourceId:source.id,page:0,quote:'Report '+id+' Order 1381207 PATCH FABRIC Fail'}],extraction:{genelSonuc:'Fail'}
  }]};
  return {parsed,packet,data};
}
test.after(()=>fs.rmSync(root,{recursive:true,force:true}));
test('review package contains full raw mail and every CP row; incomplete CP fails',async()=>{
  const {parsed,packet}=await prepare();
  assert.match(packet.sources[0].pages[0].text,/Last source line/);
  assert.match(packet.sources[0].pages[0].text,/To: buyer@example.test/);
  assert.equal(packet.cp.rows[1].fields.Last,'');
  await assert.rejects(service.prepareAssessment(profile,{sessionId:parsed.sessionId,cp:{...cp,rowCount:1,rows:cp.rows.slice(0,1)}}),{code:'TEST_REPORT_CP_INCOMPLETE'});
  assert.equal(store.read().revision,0,'preparing does not write business records');
});
test('bad quote and missing source acknowledgement cannot stage accepted reports',async()=>{
  const {parsed,packet,data}=await prepare();
  const bad=structuredClone(data);bad.assessments[0].evidence[0].quote='Invented pass';
  await assert.rejects(service.acceptAssessment(profile,{sessionId:parsed.sessionId,snapshotId:packet.snapshotId,data:bad}),{code:'TEST_REPORT_AI_CONTRACT_INVALID'});
  const missing=structuredClone(data);missing.coveredSourceIds=[];
  await assert.rejects(service.acceptAssessment(profile,{sessionId:parsed.sessionId,snapshotId:packet.snapshotId,data:missing}),{code:'TEST_REPORT_AI_CONTRACT_INVALID'});
  await assert.rejects(service.commit(profile,{sessionId:parsed.sessionId,snapshotId:packet.snapshotId,items:[]}),{code:'TEST_REPORT_REVIEW_REQUIRED'});
});
test('already stale client fields cannot acquire a new server revision',async()=>{
  const {parsed}=await prepare();
  const canonical=structuredClone(cp);canonical.rows[0].fields.Last=1000;
  const authoritative=createService({authorizedOrders:async()=>orders,sourceRevision:()=>revision,reviewContext:async()=>({cp:canonical,checklistSteps:[{id:'fabric'}],checklistStatuses:[{id:'rejected'}]})});
  await assert.rejects(authoritative.prepareAssessment(profile,{sessionId:parsed.sessionId,cp}),{code:'TEST_REPORT_CP_INCOMPLETE'});
  const ready=await authoritative.prepareAssessment(profile,{sessionId:parsed.sessionId,cp:canonical});
  assert.equal(ready.packet.cp.rows[0].fields.Last,1000);
});
test('real alphanumeric laboratory reference is preserved, only approval commits it',async()=>{
  const {parsed,packet,data}=await prepare();
  const accepted=await service.acceptAssessment(profile,{sessionId:parsed.sessionId,snapshotId:packet.snapshotId,data});
  assert.equal(accepted.reports[0].talepNo,'SGS-2026-001');
  assert.equal(store.read().revision,0);
  await assert.rejects(service.commit(profile,{sessionId:parsed.sessionId,items:[{talepNo:'SGS-2026-001',orderKey:'po7',itemId:'fabric'}]}),{code:'TEST_REPORT_REVIEW_REQUIRED'});
  const committed=await service.commit(profile,{sessionId:parsed.sessionId,snapshotId:packet.snapshotId,items:[{talepNo:'SGS-2026-001',orderKey:'po7',itemId:'fabric'}]});
  assert.equal(committed.results.length,1);
  assert.equal(store.read().reports['SGS-2026-001'].aiAssessment.component,'PATCH FABRIC');
});
test('CP changes after the response invalidate approval; another order cannot take the proposal',async()=>{
  const {parsed,packet,data}=await prepare('366956');
  await service.acceptAssessment(profile,{sessionId:parsed.sessionId,snapshotId:packet.snapshotId,data});
  await assert.rejects(service.commit(profile,{sessionId:parsed.sessionId,snapshotId:packet.snapshotId,items:[{talepNo:'366956',orderKey:'po1',itemId:'fabric'}]}),{code:'TEST_REPORT_ORDER_MISMATCH'});
  revision='v2';
  await assert.rejects(service.commit(profile,{sessionId:parsed.sessionId,snapshotId:packet.snapshotId,items:[{talepNo:'366956',orderKey:'po7',itemId:'fabric'}]}),{code:'TEST_REPORT_REVIEW_STALE'});
});
