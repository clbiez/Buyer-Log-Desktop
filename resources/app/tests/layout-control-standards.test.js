'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const template=require('../public/layout-control-template');
const store=require('../server/lib/layout-control-store');
const engine=require('../public/layout-control-engine');
const prompts=require('../server/lib/lcwai/lcwai-prompt');

test('default LCW template retains revisions and variant-specific rules',()=>{
  assert.equal(template.SOURCES.PRICE_TAG.revision,5);assert.equal(template.SOURCES.CARE_LABEL.revision,4);
  for(const source of Object.values(template.SOURCES))assert.ok(fs.existsSync(path.join(__dirname,'../public',source.url)));
  assert.match(template.rules.find(r=>r.id==='CARE_SYMBOLS').expected.en,/Home exception/);
  assert.match(template.rules.find(r=>r.id==='CARE_QR').expected.en,/18×18/);
  assert.match(template.rules.find(r=>r.id==='PRICE_QR').expected.en,/11×11/);
  assert.ok(template.applicable('PRICE_TAG').every(r=>r.type!=='CARE_LABEL'));
});
test('AI evidence never auto-approves and invalid page/box/rule cannot create a false marker',()=>{
  const data=[JSON.stringify({ruleId:'PRICE_QR',verdict:'PASS',page:2,bbox:[.1,.2,.3,.4],actual:'QR',comment:'Visible'}),JSON.stringify({ruleId:'PRICE_ORIGIN',verdict:'NA',page:9,bbox:[0,0,2,1]}),JSON.stringify({ruleId:'INVENTED',verdict:'PASS',page:1,bbox:[0,0,.1,.1]})];
  const checks=template.checks('PRICE_TAG',data,2,'en');
  assert.equal(checks.find(c=>c.ruleId==='PRICE_QR').status,'REVIEW');
  assert.deepEqual(checks.find(c=>c.ruleId==='PRICE_QR').bbox,[.1,.2,.3,.4]);
  assert.equal(checks.find(c=>c.ruleId==='PRICE_ORIGIN').page,null);
  assert.equal(checks.find(c=>c.ruleId==='PRICE_ORIGIN').bbox,null);
  assert.ok(!checks.some(c=>c.ruleId==='INVENTED'));
  assert.ok(checks.every(c=>c.decision==='PENDING'));
});
test('central LCW AI parser preserves structured visual evidence lines',()=>{
  const line=JSON.stringify({ruleId:'CARE_FIRE',verdict:'ISSUE',page:1,bbox:[.1,.2,.3,.1],actual:'Black warning',comment:'Use red',correction:'Red uppercase'});
  const result=prompts.parseStructured(JSON.stringify({documentType:'CARE_LABEL',confidence:'HIGH',explanation:'Visible',standardFindings:[line]}),'layout-control');
  assert.equal(result.ok,true);assert.deepEqual(result.data.standardFindings,[line]);
});
test('history preserves source-linked annotations, buyer decisions and unknown evidence stays review',()=>{
  const check={rule:'STD_CARE_FIRE',ruleId:'CARE_FIRE',category:'STANDARD',status:'REVIEW',source:'LCW AI',page:2,bbox:[.1,.2,.3,.1],severity:'CRITICAL',decision:'REJECTED',comment:'Please correct',correction:'Red uppercase',aiVerdict:'ISSUE',standardType:'CARE_LABEL',standardPage:3};
  const run=store.normalizeRun({templateVersion:template.VERSION,checks:[check]});
  assert.equal(run.checks[0].decision,'REJECTED');assert.deepEqual(run.checks[0].bbox,check.bbox);
  assert.equal(run.checks[0].comment,'Please correct');assert.equal(run.summary.status,'ERROR');
  assert.equal(run.templateVersion,template.VERSION);
  assert.equal(engine.summarize([{status:'NOT_CHECKED'}]).status,'REVIEW');
  assert.equal(store.summaryFromChecks([{status:'NOT_CHECKED'}]).status,'REVIEW');
});
test('layout approval requires buyer decisions for all standard rules; CP omissions never become approvals',()=>{
  const checks=template.checks('PRICE_TAG',[],1,'en');
  assert.equal(template.reviewStatus(checks),'PENDING');
  checks.forEach(c=>{c.decision='APPROVED';c.status='MATCH';});
  assert.equal(template.reviewStatus(checks),'APPROVED');
  checks[0].decision='PENDING';assert.equal(template.reviewStatus(checks),'PENDING');
  checks[0].decision='NOT_APPLICABLE';assert.equal(template.reviewStatus(checks),'APPROVED');
  checks.push({rule:'COUNTRY_MATCH',status:'MISMATCH'});assert.equal(template.reviewStatus(checks),'REJECTED');
  const unknown=template.checks('UNKNOWN',[],1,'en');unknown.forEach(c=>c.decision='APPROVED');assert.equal(template.reviewStatus(unknown),'PENDING');
});
