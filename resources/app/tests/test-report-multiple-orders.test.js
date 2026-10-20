'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../public/test-report-engine');
const description = 'LIGHT NAVY-HEU, MAIN FABRIC, 100% COTTON, 150 GSM, ORDER: 1354555/1354546/1378310';
function mail(value = description) {
  return E.parseMail({subject:'[RESULT REPORT] TALEP NO: 363443',body:'Test Talep Bilgileri\nTalep No / Request no\t363443\tSipariş Kodu / Order No\t1354555\nModel\tDEMO-YD\tRenk / Color\tNAVY\nAçıklama / Description\t'+value+'\tYaş Grubu / Age Group\tCHILD'}).report;
}
test('description survives parsing; each explicit PO has source evidence', () => {
  const r=mail();
  assert.equal(r.aciklama,description);
  assert.deepEqual(E.orderScopes(r).map(s=>s.orderCode),['1354555','1354546','1378310']);
  assert.ok(E.orderScopes(r).slice(1).every(s=>s.requiresReview && s.evidence.includes(s.orderCode)));
});
test('flexible labels, separators, unicode, multiline, duplicates and leading zeros', () => {
  for(const label of ['ORDER','orders','P.O. NO','POs','Sipariş No','siparişler','Purchase Orders']) {
    const r=mail(label+'： 01354555 / 1354546,\n1378310; 1354546');
    assert.deepEqual(E.orderScopes(r).map(s=>s.orderCode),['1354555','1354546','1378310'],label);
  }
});
test('unlabelled numbers and ranges require review; measurements and embedded IDs are not orders', () => {
  const r=mail('100% COTTON 150 GSM ISO 12945 MODEL ABC1354546Z; applies also to 1378310');
  const scopes=E.orderScopes(r);
  assert.deepEqual(scopes.map(s=>s.orderCode),['1354555','1378310']);
  assert.equal(scopes[1].confidence,'candidate');
  assert.ok(E.orderScopes(mail('ORDER: 1354546-1378310')).slice(1).every(s=>s.confidence==='candidate'));
});
test('multiple order scopes match separately; unresolved PO never disappears behind primary', () => {
  const r=mail();
  const rows=['1354555','1354546'].map(po=>({'Order Code':po,'Model Name':'DEMO-YD','Colour':'NAVY','C.Code':'NVY'}));
  const scopes=E.matchReportScopes(r,rows);
  assert.equal(scopes.length,3);
  assert.equal(scopes[0].match.level,'exact');
  assert.equal(scopes[1].match.level,'exact');
  assert.equal(scopes[2].match.reason,'order');
});
test('description variants survive merge and AI sees complete report scope', () => {
  const a=mail(),b=mail('PO: 1999999');
  const merged=E.mergeReports(a,b);
  assert.ok(E.orderScopes(merged).some(s=>s.orderCode==='1999999'));
  assert.equal(E.orderScopes(E.mergeReports(merged,a)).length,4);
  const ctx=E.reviewContext([{report:merged}],[]).reports[0];
  assert.ok(ctx.descriptions.includes(description));
  assert.deepEqual(ctx.orderScopes.map(s=>s.orderCode),['1354555','1354546','1378310','1999999']);
});
test('AI extra PO without literal source evidence is rejected', () => {
  const r=E.reportFromAiExtract({talepNo:'363443',siparisKodu:'1354555',aciklama:'PO: 1354546',siparisKodlari:['9999999','1354546'],confidence:'HIGH'});
  assert.deepEqual(E.orderScopes(r).map(s=>s.orderCode),['1354555','1354546']);
});
test('legacy single links and multi-target links share one read path', () => {
  const a={orderKey:'a',itemId:'tests'},b={orderKey:'b',itemId:'tests'};
  assert.deepEqual(E.reportLinks(a),[a]);
  assert.deepEqual(E.reportLinks({...a,targets:[a,b]}),[a,b]);
});

test('mail wraps before ORDER label and PDF split cells retain the complete scope',()=>{
 const r=mail('100% COTTON\nORDER: 1354555/1354546/1378310');
 assert.deepEqual(E.orderScopes(r).map(s=>s.orderCode),['1354555','1354546','1378310']);
 for(const label of ['Açıklama','Description','Explanation']) {
  const item=(x,y,s)=>({p:1,x,y,s});
  const parsed=E.parsePdfItems([item(20,700,'Request No'),item(100,700,'363443'),item(20,680,'Order No'),item(100,680,'1354555'),item(20,650,label),item(100,650,'MAIN FABRIC, ORDER:'),item(100,639,'1354555/1354546/1378310'),item(240,615,'EVALUATION SUMMARY'),item(20,600,'Applied Test')]).report;
  assert.deepEqual(E.orderScopes(parsed).map(s=>s.orderCode),['1354555','1354546','1378310'],label);
  assert.doesNotMatch(parsed.aciklama,/EVALUATION SUMMARY|Applied Test/);
 }
});
test('multi-order and unresolved annotated descriptions never auto-select a scope',()=>{
 assert.equal(E.orderScopeNeedsReview(mail()),true);
 assert.equal(E.orderScopeNeedsReview(mail('PO: 1 354 546')),true);
 assert.equal(E.orderScopeNeedsReview(mail('100% COTTON, 150 GSM')),false);
});

test('operational intelligence reads secondary links without false primary-PO mismatch',()=>{
 const Intelligence=require('../server/lib/agent-office-intelligence'),CP=require('../public/cp-readiness-engine');
 const rows=['1354555','1354546'].map(po=>({'Order Code':po,'Model Name':'DEMO-YD','Colour':'NAVY','C.Code':'NVY','PLM ID':'2000011','STATUS':'ÜRETİM','Ex-factory':'2026-11-20'}));
 const targets=rows.map(row=>({orderKey:CP.analyzeOrder(row).orderKey,itemId:'tests'}));
 const result=Intelligence.analyzeOperationalData({today:'2026-11-10',cpRows:rows,personalRules:[{id:'tests',kind:'checklist',enabled:true,conditions:[{field:'Order Code',operator:'notEmpty'}]}],reports:{reports:{'363443':mail()},links:{'363443':{...targets[0],targets}}}});
 assert.equal(result.orders.length,2);
 for(const order of result.orders){
  assert.ok(order.evidence.some(e=>e.itemId==='tests'&&e.sources.some(s=>s.source==='Test report'&&s.id==='363443')));
  assert.ok(!order.findings.some(f=>f.code==='REPORT_MATCH_363443'));
 }
});
