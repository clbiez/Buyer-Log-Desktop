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
test('complete active CP can be reviewed when order authority also includes closed orders',async()=>{
  const {parsed}=await prepare();
  const allowed=new Map([...orders,['closed',{orderCode:'1381000'}]]);
  const canonical={cp:structuredClone(cp),checklistSteps:[{id:'fabric'}],checklistStatuses:[{id:'rejected'}]};
  const authoritative=createService({authorizedOrders:async()=>allowed,reviewContext:async()=>canonical});
  const ready=await authoritative.prepareAssessment(profile,{sessionId:parsed.sessionId,cp});
  assert.equal(ready.packet.cp.rowCount,2);
  assert.deepEqual(ready.packet.cp.rows.map(row=>row.key),['po7','po1']);
  const review=client=>authoritative.prepareAssessment(profile,{sessionId:parsed.sessionId,cp:client});
  await assert.rejects(review({...cp,rowCount:1,rows:cp.rows.slice(0,1)}),{code:'TEST_REPORT_CP_INCOMPLETE'});
  await assert.rejects(review({...cp,rowCount:3,rows:cp.rows.concat({key:'closed',orderCode:'1381000',fields:{}})}),{code:'TEST_REPORT_CP_INCOMPLETE'});
  await assert.rejects(review({...cp,rows:[cp.rows[0],cp.rows[0]]}),{code:'TEST_REPORT_CP_INCOMPLETE'});
  await assert.rejects(review({...cp,rows:[{...cp.rows[0],orderCode:'forged'},cp.rows[1]]}),{code:'TEST_REPORT_CP_INCOMPLETE'});
  const denied=createService({authorizedOrders:async()=>new Map([['po7',orders.get('po7')]]),reviewContext:async()=>canonical});
  await assert.rejects(denied.prepareAssessment(profile,{sessionId:parsed.sessionId,cp}),{code:'TEST_REPORT_CP_INCOMPLETE'});
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
  assert.equal(store.read().reports['SGS-2026-001'].aiAssessment.evidence[0].sourceName,'result.eml');
  assert.equal(store.read().events[0].review.snapshotId,packet.snapshotId);
});
test('CP changes after the response invalidate approval; another order cannot take the proposal',async()=>{
  const {parsed,packet,data}=await prepare('366956');
  await service.acceptAssessment(profile,{sessionId:parsed.sessionId,snapshotId:packet.snapshotId,data});
  await assert.rejects(service.commit(profile,{sessionId:parsed.sessionId,snapshotId:packet.snapshotId,items:[{talepNo:'366956',orderKey:'po1',itemId:'fabric'}]}),{code:'TEST_REPORT_ORDER_MISMATCH'});
  revision='v2';
  await assert.rejects(service.commit(profile,{sessionId:parsed.sessionId,snapshotId:packet.snapshotId,items:[{talepNo:'366956',orderKey:'po7',itemId:'fabric'}]}),{code:'TEST_REPORT_REVIEW_STALE'});
});
test('a late old response cannot replace the reports of a newer validated review',async()=>{
  const {parsed,packet,data}=await prepare('366957');
  let resume,started;
  const waiting=new Promise(resolve=>{started=resolve;});
  const slow=createService({sourceRevision:()=>revision,authorizedOrders:async()=>{started();await new Promise(resolve=>{resume=resolve;});return orders;}});
  const old=slow.acceptAssessment(profile,{sessionId:parsed.sessionId,snapshotId:packet.snapshotId,data});
  await waiting;
  const newer=await service.prepareAssessment(profile,{sessionId:parsed.sessionId,cp:{...cp,displayTable:{note:'new generation'}},checklistSteps:packet.checklistSteps,checklistStatuses:packet.checklistStatuses});
  const latest={...data,snapshotId:newer.packet.snapshotId,assessments:data.assessments.map(item=>({...item,summary:'Newest reviewed source'}))};
  await service.acceptAssessment(profile,{sessionId:parsed.sessionId,snapshotId:newer.packet.snapshotId,data:latest});
  resume();
  await assert.rejects(old,{code:'TEST_REPORT_REVIEW_STALE'});
  const session=service.sessionFor(profile,parsed.sessionId);
  assert.equal(session.reports[0].aiAssessment.snapshotId,newer.packet.snapshotId);
  assert.equal(session.reports[0].aiAssessment.summary,'Newest reviewed source');
});
test('buyer can explicitly add an authorised PO outside AI scope; source identity stays unchanged',async()=>{
  const {parsed,packet,data}=await prepare('MANUAL-PO-01');
  await service.acceptAssessment(profile,{sessionId:parsed.sessionId,snapshotId:packet.snapshotId,data});
  const origin={fromOrderKey:'po7',fromItemId:'fabric'};
  const manual={talepNo:'MANUAL-PO-01',orderKey:'po1',itemId:'fabric',manualMatch:origin,confirmMatch:true,confirmEvidence:true,targetStatus:'rejected',context:{orderCode:'FAKE'}};
  const body={sessionId:parsed.sessionId,snapshotId:packet.snapshotId,items:[{talepNo:'MANUAL-PO-01',orderKey:'po7',itemId:'fabric'},manual]};
  const result=await service.commit(profile,body);
  assert.equal(result.results.length,2);
  const saved=store.read(),links=saved.links['MANUAL-PO-01'].targets;
  assert.deepEqual(links.map(link=>link.orderKey),['po7','po1']);
  assert.equal(saved.reports['MANUAL-PO-01'].siparisKodu,'1381207','manual PO never changes source extraction');
  assert.equal(saved.reports['MANUAL-PO-01'].aiAssessment.orderKey,'po7','AI never claims verification of manual target');
  assert.deepEqual(links[1].review.manualMatch,{fromOrderKey:'po7',fromItemId:'fabric',targetStatus:'rejected'});
  assert.equal(saved.events.at(-1).review.matchSource,'buyer');
  assert.equal(saved.events.at(-1).review.scopeConfirmed,true);
});
test('manual rematch requires source review, both confirmations, and a real checklist status',async()=>{
  const {parsed,packet,data}=await prepare('MANUAL-PO-02');
  await service.acceptAssessment(profile,{sessionId:parsed.sessionId,snapshotId:packet.snapshotId,data});
  const manual={talepNo:'MANUAL-PO-02',orderKey:'po1',itemId:'fabric',manualMatch:{fromOrderKey:'po7',fromItemId:'fabric'},confirmMatch:true,confirmEvidence:true,targetStatus:'rejected'};
  const commit=item=>service.prepareCommit(profile,{sessionId:parsed.sessionId,snapshotId:packet.snapshotId,items:[item]});
  for(const change of [{confirmEvidence:false},{confirmMatch:false},{targetStatus:''},{targetStatus:'invented'},{itemId:'invented'},{manualMatch:{fromOrderKey:'po1',fromItemId:'fabric'}}]) {
    await assert.rejects(commit({...manual,...change}),{code:'TEST_REPORT_MANUAL_MATCH_REQUIRED'});
  }
  await assert.rejects(commit({...manual,orderKey:'unauthorised'}),{code:'TEST_REPORT_ORDER_FORBIDDEN'});
  const allowed=await commit(manual);assert.equal(allowed.items[0].context.orderCode,'1381201');
  await assert.rejects(service.prepareCommit(profile,{sessionId:parsed.sessionId,snapshotId:packet.snapshotId,items:[manual,manual]}),{code:'TEST_REPORT_DUPLICATE_TARGET'});
});
test('manual scope cannot bypass changed CP or current write authority',async()=>{
  const {parsed,packet,data}=await prepare('MANUAL-PO-03');
  await service.acceptAssessment(profile,{sessionId:parsed.sessionId,snapshotId:packet.snapshotId,data});
  const body={sessionId:parsed.sessionId,snapshotId:packet.snapshotId,items:[{talepNo:'MANUAL-PO-03',orderKey:'po1',itemId:'fabric',manualMatch:{fromOrderKey:'po7',fromItemId:'fabric'},confirmMatch:true,confirmEvidence:true,targetStatus:'approved'}]};
  const restricted=createService({authorizedOrders:async(_p,{write})=>write?new Map([['po7',orders.get('po7')]]):orders,sourceRevision:()=>revision});
  await assert.rejects(restricted.prepareCommit(profile,body),{code:'TEST_REPORT_ORDER_FORBIDDEN'});
  revision+='-changed';
  await assert.rejects(service.prepareCommit(profile,body),{code:'TEST_REPORT_REVIEW_STALE'});
});
test('manual target cannot inherit an invisible set part; real target parts remain selectable',async()=>{
  cp.rows[1].fields.Category='T-shirt';
  try {
    const {parsed,packet,data}=await prepare('MANUAL-PART-01');
    await service.acceptAssessment(profile,{sessionId:parsed.sessionId,snapshotId:packet.snapshotId,data});
    const item={talepNo:'MANUAL-PART-01',orderKey:'po1',itemId:'fabric~part~A',manualMatch:{fromOrderKey:'po7',fromItemId:'fabric'},confirmMatch:true,confirmEvidence:true,targetStatus:'approved'};
    await assert.rejects(service.prepareCommit(profile,{sessionId:parsed.sessionId,snapshotId:packet.snapshotId,items:[item]}),{code:'TEST_REPORT_MANUAL_MATCH_REQUIRED'});
    cp.rows[1].fields.Category="2'li Takım";
    const next=await prepare('MANUAL-PART-02');
    await service.acceptAssessment(profile,{sessionId:next.parsed.sessionId,snapshotId:next.packet.snapshotId,data:next.data});
    const check=itemId=>service.prepareCommit(profile,{sessionId:next.parsed.sessionId,snapshotId:next.packet.snapshotId,items:[{...item,talepNo:'MANUAL-PART-02',itemId}]});
    await assert.rejects(check('fabric'),{code:'TEST_REPORT_MANUAL_MATCH_REQUIRED'});
    await assert.rejects(check('fabric~part~Z'),{code:'TEST_REPORT_MANUAL_MATCH_REQUIRED'});
    assert.equal((await check('fabric~part~B')).items[0].itemId,'fabric~part~B');
  }finally{delete cp.rows[1].fields.Category;}
});
