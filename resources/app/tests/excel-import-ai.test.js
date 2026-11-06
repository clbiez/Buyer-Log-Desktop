'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
globalThis.BLCanonicalFields = require('../public/canonical-fields');
require('../public/column-schema');
require('../public/excel-date-utils');
require('../public/excel-import-mapping');
require('../public/excel-import-match');
const Plan = require('../public/excel-import-plan');
const AI = require('../public/excel-import-ai');
const Prompt = require('../server/lib/lcwai/lcwai-prompt');
function spec() {
  return { moduleId: 'collection', fields: [
    {id:'plmId',label:'PLM ID',dataType:'code',identity:true,writable:false},
    {id:'price',label:'Price',dataType:'currency',currency:'EUR',writable:true}
  ], source: {sheetName:'Demo',headerRow:0,columns:[{id:'col:0',header:'ID'},{id:'col:1',header:'Price'}],rows:[
    {id:'r1',excelRow:2,cells:{'col:0':{value:'0012'},'col:1':{value:'€ 12,50'}}}
  ]}, mapping:{assignments:{'col:0':{action:'match',targetId:'plmId'},'col:1':{action:'ignore',targetId:'__ignore__'}}},
  matchRule:{fieldIds:['plmId']}, options:{createNew:false},decisions:{},
  target:{rows:[{plmId:'0012',price:10}],revision:1,readValue:(row,id)=>row[id],rowRevision:()=>1} };
}
function proposal(operations) {return {structured:{ok:true},data:{explanation:'Review',operationsJson:JSON.stringify(operations),warnings:[]}};}
test('AI maps canonical fields and repairs currency locally; only the approved plan writes', () => {
  const s=spec(), before=JSON.stringify(s);
  const result=AI.prepare(s,proposal([{op:'map',columnId:'col:1',targetId:'price',action:'update'},{op:'normalize',columnId:'col:1'}]));
  assert.equal(result.ok,true);
  assert.equal(JSON.stringify(s),before,'input is untouched before approval');
  assert.equal(result.fixes.length,1);
  assert.equal(result.fixes[0].before,'€ 12,50');
  assert.equal(result.fixes[0].after,12.5);
  const draft=AI.apply(s,result);
  const plan=Plan.buildImportPlan(draft);
  assert.equal(plan.executable,true);
  assert.equal(plan.operations[0].changes[0].to,12.5);
  assert.equal(s.source.rows[0].cells['col:1'].value,'€ 12,50');
});
test('unknown fields/actions, duplicate mappings and arbitrary value writes are rejected atomically', () => {
  for(const ops of [
    [{op:'map',columnId:'col:1',targetId:'invented',action:'update'}],
    [{op:'map',columnId:'col:1',targetId:'plmId',action:'update'}],
    [{op:'map',columnId:'col:1',targetId:'plmId',action:'match'}],
    [{op:'set',columnId:'col:0',value:'9999'}],
    [{op:'normalize',columnId:'col:0'}],
    [{op:'match',fieldIds:['invented']}],
  ]) assert.equal(AI.prepare(spec(),proposal(ops)).ok,false,JSON.stringify(ops));
});
test('normalization never guesses missing identifiers, dates or formula results', () => {
  const s=spec();
  s.source.rows.push({id:'r2',excelRow:3,cells:{'col:0':{value:'0013'},'col:1':{value:null,formula:'A1*2',unreliable:true}}});
  s.source.rows.push({id:'r3',excelRow:4,cells:{'col:0':{value:'0014'},'col:1':{value:'unknown'}}});
  const r=AI.prepare(s,proposal([{op:'map',columnId:'col:1',targetId:'price',action:'update'},{op:'normalize',columnId:'col:1'}]));
  assert.equal(r.ok,true);
  assert.equal(r.fixes.length,1);
  assert.ok(r.plan.summary.invalidRows >= 2);
});
test('stale source, mapping, decisions and target revision cannot accept an old suggestion', () => {
  for(const mutate of [s=>s.source.rows[0].cells['col:1'].value='20',s=>s.target.revision++,s=>s.decisions.excludedSourceRows=['r1'],s=>s.mapping.assignments['col:1']={targetId:'price'}]) {
    const s=spec(),r=AI.prepare(s,proposal([])); mutate(s);
    assert.throws(()=>AI.apply(s,r),/STALE/);
  }
});
test('the whole sheet is checked locally while AI context is bounded and honest about coverage', () => {
  const s=spec();
  s.mapping.assignments['col:1']={action:'update',targetId:'price'};
  s.source.rows=Array.from({length:1000},(_,i)=>({id:'r'+i,excelRow:i+2,cells:{'col:0':{value:'0012'},'col:1':{value:i===999?'bad':12}}}));
  const c=AI.buildContext(s);
  assert.equal(c.coverage.totalRows,1000);
  assert.ok(c.coverage.sampledRows<=20);
  assert.equal(c.localSummary.invalidRows,1);
  assert.equal(c.coverage.complete,false);
  assert.ok(JSON.stringify(c).length<=14000);
});
test('central LCW AI prompt contract forbids invented values and automatic conflict decisions', () => {
  const parsed=Prompt.parseStructured(JSON.stringify({explanation:'Review',operationsJson:'[]',warnings:[]}), 'excel-import');
  assert.equal(parsed.ok,true);
  const prompt=Prompt.buildPrompt({source:'excel-import',lang:'en',task:'Scan',context:AI.buildContext(spec())}).prompt;
  assert.match(prompt,/normalize/);
  assert.match(prompt,/Never invent/);
  assert.match(prompt,/sample/i);
});
test('CP keeps its existing plan/bridge semantics and never creates unmatched rows', () => {
  const s=spec(); s.moduleId='cp'; s.target.canCreate=false;
  delete s.mapping.assignments['col:0'].action;
  const r=AI.prepare(s,proposal([{op:'map',columnId:'col:1',targetId:'price',action:'update'},{op:'normalize',columnId:'col:1'}]));
  assert.equal(r.ok,true);
  assert.equal(r.draft.mapping.assignments['col:1'].action,undefined);
  assert.equal(r.plan.summary.updates,1);
  assert.equal(r.plan.summary.creates,0);
  r.draft.mapping.assignments['col:0'].reviewed=true;
  assert.equal(s.mapping.assignments['col:0'].reviewed,undefined,'undo state is not mutated');
});
test('ambiguous matches remain blocked after accepting an AI formatting correction', () => {
  const s=spec(); s.target.rows.push({...s.target.rows[0]});
  const r=AI.prepare(s,proposal([{op:'map',columnId:'col:1',targetId:'price',action:'update'},{op:'normalize',columnId:'col:1'}]));
  assert.equal(r.ok,true);
  assert.equal(r.plan.executable,false);
  assert.ok(r.plan.blocking.some(item=>item.code==='ambiguous-match'));
  assert.deepEqual(r.draft.decisions,{});
});
test('inconsistent currency marks and fractional quantities are never silently repaired', () => {
  const s=spec(); s.source.rows[0].cells['col:1'].value='USD 12 EUR';
  let r=AI.prepare(s,proposal([{op:'map',columnId:'col:1',targetId:'price',action:'update'},{op:'normalize',columnId:'col:1'}]));
  assert.equal(r.fixes.length,0);
  s.fields[1].currency='USD'; s.source.rows[0].cells['col:1'].value='€ 12,50';
  r=AI.prepare(s,proposal([{op:'map',columnId:'col:1',targetId:'price',action:'update'},{op:'normalize',columnId:'col:1'}]));
  assert.equal(r.fixes.length,0,'foreign currency must not be treated as USD');
  s.fields[1].dataType='quantity'; s.source.rows[0].cells['col:1'].value=' 12,5 ';
  r=AI.prepare(s,proposal([{op:'map',columnId:'col:1',targetId:'price',action:'update'},{op:'normalize',columnId:'col:1'}]));
  assert.equal(r.fixes.length,0);
});
test('a suggested matching subset disables removed match columns without granting write access', () => {
  const s=spec(); s.mapping.assignments['col:1']={targetId:'price',action:'match'}; s.matchRule.fieldIds.push('price');
  const r=AI.prepare(s,proposal([{op:'match',fieldIds:['plmId']}]));
  assert.equal(r.ok,true);
  assert.deepEqual(r.draft.matchRule.fieldIds,['plmId']);
  assert.equal(r.draft.mapping.assignments['col:1'].action,'ignore');
  assert.ok(r.changes.some(item=>item.columnId==='col:1'&&item.action==='ignore'));
  assert.equal(s.mapping.assignments['col:1'].action,'match');
});
