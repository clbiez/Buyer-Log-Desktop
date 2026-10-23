'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const E=require('../public/test-report-engine');
const {fixture}=require('./helpers/external-lab-fixture.cjs');
test('glyph-split SGS headers and summary tables retain external identity, PO, type, colour and tests',()=>{
  const p=E.parsePdfItems(fixture());assert.equal(p.format,'external-lab');
  const r=p.report;assert.equal(r.talepNo,'DEMSL260000124-A');assert.equal(r.siparisKodu,'4100001');
  assert.equal(r.talepTipi,'Gold Seal');assert.equal(r.renk,'BLUE');assert.equal(r.modelAdi,'DEMO,KNIT-8YD');
  assert.equal(r.raporTarihiIso,'2026-10-17');assert.equal(r.testler.length,2);assert.equal(E.reportOutcome(r).code,'pass');
  assert.deepEqual(r.ekBilgi.reportNumbers,['DEMSL260000124-A','DEMSL260000124-B']);
  assert.equal(r.testler[0].sourcePage,2);
  assert.match(E.linesFromItems(fixture()),/TEST REPORT No/);assert.doesNotMatch(E.linesFromItems(fixture()),/T\tE\tS\tT/);
});
test('summary FAIL wins; unknown/blank verdicts never become positive approvals',()=>{
  assert.equal(E.reportOutcome(E.parsePdfItems(fixture({result:'FAIL'})).report).code,'fail');
  for(const result of ['NOT EVALUATED','N/A',''])assert.equal(E.reportOutcome(E.parsePdfItems(fixture({result})).report).code,'pending');
});
test('different orders or unrelated report families in a combined PDF require source review',()=>{
  assert.equal(E.parsePdfItems(fixture({secondOrder:'4100002'})).report,null);
  assert.equal(E.parsePdfItems(fixture({secondReport:'OTHER260000999-B'})).report,null);
});
test('numeric request validation remains strict while explicit external report IDs survive AI normalization',()=>{
  assert.equal(E.normalizeTalepNo('1375ABC'),'');
  assert.equal(E.normalizeReportId('260000124DEMSL-A'),'260000124DEMSL-A');
  assert.equal(E.normalizeReportId('123456789'),'');
  const digitLeading=fixture().map(item=>({...item,s:item.s.replace(/DEMSL260000124/g,'260000124DEMSL')}));
  assert.equal(E.parsePdfItems(digitLeading).report.talepNo,'260000124DEMSL-A');
  const r=E.reportFromAiExtract({talepNo:'SGS-2026-0001',siparisKodu:'4100001',genelSonuc:'Pass',confidence:'HIGH'});
  assert.equal(r.talepNo,'SGS-2026-0001');assert.ok(!r.uyarilar.some(w=>w.code==='missingTalepNo'));
});

test('continued summary and same-cell detailed FAIL cannot be hidden by a PASS summary',()=>{
  const continuation=fixture();continuation.push({p:3,x:25,y:680,w:5,s:'3'},{p:3,x:70,y:680,w:150,s:'Restricted substance'},{p:3,x:380,y:680,w:25,s:'FAIL'});
  assert.equal(E.reportOutcome(E.parsePdfItems(continuation).report).code,'fail');
  const detail=fixture();detail.push({p:3,x:25,y:660,w:100,s:'Conclusion: FAIL'});
  assert.equal(E.reportOutcome(E.parsePdfItems(detail).report).code,'fail');
  for(const verdict of ['REJECTED','Kalır']) {
    const cells=fixture();cells.push({p:3,x:25,y:660,w:60,s:'Conclusion'},{p:3,x:180,y:660,w:50,s:verdict});
    assert.equal(E.reportOutcome(E.parsePdfItems(cells).report).code,'fail');
  }
});

test('same-family appendices with conflicting variant or sample scope stay with source review',()=>{
  for(const [label,value] of [['COLOUR','RED'],['SAMPLE DESCRIPTION','DIFFERENT SAMPLE']]) {
    const items=fixture();items.push({p:3,x:25,y:640,w:120,s:label},{p:3,x:180,y:640,w:150,s:value});
    assert.equal(E.parsePdfItems(items).report,null);
  }
});

test('test names starting with Colour are not mistaken for explicit variant labels',()=>{
  const items=fixture();items.push({p:3,x:25,y:640,w:200,s:'Colour Fastness to Washing'});
  assert.equal(E.parsePdfItems(items).report.renk,'BLUE');
});
test('review preference flush waits for queued and already active writes without losing the local copy',async()=>{
  const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),values=new Map(),timers=new Map(),requests=[];
  let timerId=0;
  const window={BL_USER_CONTEXT:{id:'demo'},localStorage:{getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,String(v)),removeItem:k=>values.delete(k),key:i=>[...values.keys()][i],get length(){return values.size;}},setTimeout:fn=>{timers.set(++timerId,fn);return timerId;},clearTimeout:id=>timers.delete(id)};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../public/user-storage.js'),'utf8'),{window,fetch:(url,options)=>new Promise((resolve,reject)=>requests.push({url,options,resolve,reject}))});
  const storage=window.BLStorage;
  storage.setItem('lcw.lang.current','tr');assert.equal(requests.length,0);
  const first=timers.values().next().value;first();assert.equal(requests.length,1);
  storage.setItem('lcw.lang.current','en');let settled=false;
  const flushed=storage.flushPending().then(()=>{settled=true;});assert.equal(requests.length,2);
  requests[1].resolve({ok:true});await Promise.resolve();await Promise.resolve();assert.equal(settled,false);
  requests[0].resolve({ok:true});await flushed;assert.equal(storage.getItem('lcw.lang.current'),'en');
  storage.setItem('lcw.lang.current','tr');const failed=storage.flushPending();requests[2].reject(new Error('offline'));
  await assert.rejects(failed,/offline/);assert.equal(storage.getItem('lcw.lang.current'),'tr');
});
