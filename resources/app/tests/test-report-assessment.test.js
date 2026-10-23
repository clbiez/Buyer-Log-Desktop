'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../public/test-report-assessment');
const packet = () => ({ protocol: R.PROTOCOL, caseId: 'case', snapshotId: 'snap',
  sources: [{ id: 's1', name: 'a.pdf', kind: 'pdf', pages: [{ page: 1, text: 'Request 366956 Order 1381207 CVL NEW BLACK PATCH FABRIC 208,4 220 103,9 145 Fail' }], complete: true }],
  cp: { rows: [{ key: 'po7', orderCode: '1381207', fields: { Colour: 'NEW BLACK' } }] },
  checklistSteps: [{ id: 'fabric' }], checklistStatuses: [{ id: 'approved', resolved: true }, { id: 'rejected' }] });
const finding = () => ({ reportId: '366956', orderKey: 'po7', orderCode: '1381207', step: 'fabric', status: 'rejected', scope: 'verified',
  component: 'PATCH FABRIC', labResult: 'Fail', summary: 'Fabric failed', actions: ['Request retest'], risks: [],
  evidence: [{ sourceId: 's1', page: 1, quote: 'Request 366956 Order 1381207' }, { sourceId: 's1', page: 1, quote: 'PATCH FABRIC' }, { sourceId: 's1', page: 1, quote: 'Fail' }] });
const reply = () => ({ protocol: R.PROTOCOL, caseId: 'case', snapshotId: 'snap', coveredSourceIds: ['s1'], assessments: [finding()], explanation: 'Done' });

test('complete source-grounded proposals are scoped to one CP key', () => {
  const result = R.validate(reply(), packet());
  assert.equal(result.ok, true);
  assert.equal(result.assessments[0].orderKey, 'po7');
  assert.equal(result.assessments[0].status, 'rejected');
});
test('forged quote, page, missing coverage, stale snapshot and unknown row fail closed', () => {
  for (const change of [r => r.assessments[0].evidence[0].quote = 'Made up', r => r.assessments[0].evidence[0].page = 2,
    r => r.coveredSourceIds = [], r => r.snapshotId = 'old', r => r.assessments[0].orderKey = 'po1']) {
    const r = reply(); change(r); assert.equal(R.validate(r, packet()).ok, false);
  }
});
test('PASS cannot resolve a scope conflict or use another order as evidence', () => {
  const r = reply(); r.assessments[0].scope = 'uncertain'; r.assessments[0].status = 'approved';
  const result = R.validate(r, packet());
  assert.equal(result.assessments[0].status, '');
  assert.equal(result.assessments[0].blocked, true);
  const other = reply(); other.assessments[0].orderCode = '1381201';
  assert.equal(R.validate(other, packet()).ok, false);
});
test('no first-five cutoff: readable sources plus four originals per batch', () => {
  const p = packet();
  p.sources = Array.from({ length: 12 }, (_, i) => ({ id: 's' + i, complete: i < 3, fileId: 'f' + i, pages: [] }));
  const batches = R.batches(p);
  assert.equal(batches.length, 3);
  assert.equal(new Set(batches.flatMap(b => b.sourceIds)).size, 12);
  assert.ok(batches.every(b => b.visualSourceIds.length <= 4));
});
test('CP snapshot retains every row and field, original numbers and empty values', () => {
  const rows = Array.from({ length: 901 }, (_, i) => ({ 'Order Code': String(1000000 + i), 'Last custom column': i, Blank: '', 'BL Image': 'KOL-3', _internal: 'omit' }));
  const cp = R.cpSnapshot(rows, { keyOf: r => r['Order Code'], orderCodeOf: r => r['Order Code'] });
  assert.equal(cp.rows.length, 901);
  assert.equal(cp.rows[900].fields['Last custom column'], 900);
  assert.equal(cp.rows[0].fields.Blank, '');
  assert.equal(cp.rows[0].fields._internal, undefined);
});
test('unrelated source fragments cannot manufacture a report/order/PASS connection', () => {
  const p=packet();
  p.sources=[{id:'s1',name:'old.pdf',complete:true,pages:[{page:1,text:'Request 366956 Order 1381201 PATCH FABRIC Fail'}]},
    {id:'s2',name:'other.pdf',complete:true,pages:[{page:1,text:'Request 365168 Order 1381207 PRINT Pass'}]}];
  const r=reply();r.coveredSourceIds=['s1','s2'];
  r.assessments[0]={...finding(),component:'PRINT',labResult:'Pass',status:'approved',evidence:[{sourceId:'s1',page:1,quote:'Request 366956'}, {sourceId:'s2',page:1,quote:'Order 1381207 PRINT Pass'}]};
  assert.equal(R.validate(r,p).ok,false);
});
test('a missing source prevents a positive closure and scanned evidence requires owner verification',()=>{
  const p=packet();p.sources[0].pages[0].text=p.sources[0].pages[0].text.replace('Fail','Pass');
  p.sources.push({id:'missing',complete:false,pages:[],pageCount:0});
  const r=reply();r.coveredSourceIds.push('missing');r.unresolvedSourceIds=['missing'];r.assessments[0].labResult='Pass';r.assessments[0].status='approved';r.assessments[0].evidence[2].quote='Pass';
  const checked=R.validate(r,p);assert.equal(checked.ok,true);assert.equal(checked.assessments[0].status,'');assert.equal(checked.assessments[0].blocked,true);
  const scan=packet();scan.sources[0]={...scan.sources[0],complete:false,fileId:'file',pages:[{page:1,text:''}],pageCount:1};
  const visual=reply();visual.assessments[0].evidence=visual.assessments[0].evidence.map(ref=>({...ref,visual:true}));
  const v=R.validate(visual,scan);assert.equal(v.ok,true);assert.equal(v.assessments[0].blocked,true);
});
test('different order findings never overwrite each other and conflicting duplicates fail', () => {
  const p = packet(); p.cp.rows.push({ key: 'po1', orderCode: '1381201' });
  p.sources[0].pages[0].text += ' Additional Order 1381201';
  const r = reply(); r.assessments.push({ ...finding(), orderKey: 'po1', orderCode: '1381201', scope: 'uncertain', evidence: [{ sourceId: 's1', page: 1, quote: 'Additional Order 1381201 Request' }] });
  r.assessments[1].evidence = finding().evidence.concat([{ sourceId: 's1', page: 1, quote: 'Additional Order 1381201' }]);
  assert.equal(R.validate(r, p).assessments.length, 2);
  r.assessments.push({ ...finding(), status: 'approved' });
  assert.equal(R.validate(r, p).ok, false);
});
test('covering mail without a report ID needs a cited PDF, matching attachment hash and the same printed PO',()=>{
  const p=packet();p.sources[0]={...p.sources[0],kind:'pdf',hash:'pdf-hash',parentId:'mail'};
  p.sources.push({id:'mail',kind:'msg',complete:true,pages:[{page:0,text:'Order 1381207 request approval'}],attachments:[{kind:'pdf',hash:'pdf-hash'}]});
  const r=reply();r.coveredSourceIds.push('mail');r.assessments[0].evidence.push({sourceId:'mail',page:0,quote:'Order 1381207 request approval'});
  assert.equal(R.validate(r,p).ok,true);
  const detached=structuredClone(p);detached.sources[1].attachments[0].hash='other';assert.equal(R.validate(r,detached).ok,false);
  const wrongPo=structuredClone(p);wrongPo.sources[1].pages[0].text='Order 1381201 request approval';
  const other=structuredClone(r);other.assessments[0].evidence.at(-1).quote=wrongPo.sources[1].pages[0].text;assert.equal(R.validate(other,wrongPo).ok,false);
  const withoutPdf=structuredClone(r);withoutPdf.assessments[0].evidence=withoutPdf.assessments[0].evidence.filter(e=>e.sourceId==='mail');assert.equal(R.validate(withoutPdf,p).ok,false);
});
