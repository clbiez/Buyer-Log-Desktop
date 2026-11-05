'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const rules=require('../public/business-rules');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');

test('all season list policies interleave Summer then Winter by year',()=>{
  const input=['W7','S5','W6','S7','W5','S6'];
  const expected=['S5','W5','S6','W6','S7','W7'];
  for(const compare of [rules.compareSeasonNumberThenLetter,rules.compareSeasonPrefixThenNumber,rules.compareChronologicalValues]){
    assert.deepEqual(input.slice().sort(compare),expected);
  }
  assert.deepEqual(input.slice().sort(rules.compareSeasonNewestFirst),expected.slice().reverse());
  assert.equal(rules.previousSeasonByPrefix('W7',input),'W6');
  assert.equal(rules.previousSeasonByPrefix('S7',input),'S6');
});

test('month names, abbreviations and stored keys compare by year then month in both directions',()=>{
  const input=['JULY 2027','DECEMBER 2026','JUNE 2027','2028-01','202705'];
  const expected=['DECEMBER 2026','202705','JUNE 2027','JULY 2027','2028-01'];
  assert.deepEqual(input.slice().sort(rules.compareChronologicalValues),expected);
  assert.deepEqual(input.slice().sort((a,b)=>rules.compareChronologicalValues(a,b,-1)),expected.slice().reverse());
  for(const value of ['HAZİRAN 2027','JUN 2027','2027-06','202706','06/2027','2027 Haziran']){
    assert.equal(rules.compareChronologicalValues(value,'JUNE 2027'),0,value);
  }
  assert.equal(rules.compareChronologicalValues('7S','S7'),0);
  assert.equal(rules.compareChronologicalValues('S2027','S7'),0);
  assert.ok(rules.compareChronologicalValues('W9','S10')<0);
  for(const dir of [1,-1]){
    assert.ok(rules.compareChronologicalValues('JUNE 2027','invalid',dir)<0);
    assert.ok(rules.compareChronologicalValues('W7','',dir)<0);
  }
});

test('season arrays compare by their chronological members without changing stored order',()=>{
  const values=['W7','S6','W5'];
  assert.ok(rules.compareSeasonLists(values,['W6'])<0);
  assert.deepEqual(values,['W7','S6','W5']);
});

test('browser and Node load the same comparator and pivot paths preserve hierarchy',()=>{
  const context=vm.createContext({});
  for(const name of ['chronological-values.js','business-rules.js'])vm.runInContext(fs.readFileSync(path.join(__dirname,'../public',name),'utf8'),context);
  assert.equal(context.BLBusinessRules.compareChronologicalValues('JUNE 2027','JULY 2027'),rules.compareChronologicalValues('JUNE 2027','JULY 2027'));
  assert.ok(rules.compareChronologicalPaths(['DEMO','W6'],['DEMO','S7'])<0);
  assert.ok(rules.compareChronologicalPaths(['A','W7'],['B','S5'])<0);
});

test('strict parsing avoids turning arbitrary codes and invalid months into periods',()=>{
  for(const value of ['RANDOM 2027','MODEL-S7','2027-13','2027-W06','2027',''])assert.equal(rules.monthParts(value),null,value);
  const values=['MODEL-20','MODEL-3','MODEL-1'];
  assert.deepEqual(values.sort(rules.compareChronologicalValues),['MODEL-1','MODEL-3','MODEL-20']);
  const mixed=['S7','W6','unknown','2027-13','','JUNE 2027','JULY 2027'];
  for(const dir of [1,-1])for(const a of mixed)for(const b of mixed)for(const c of mixed){
    const cmp=(x,y)=>rules.compareChronologicalValues(x,y,dir);
    if(cmp(a,b)<=0&&cmp(b,c)<=0)assert.ok(cmp(a,c)<=0,`${a}, ${b}, ${c}`);
  }
});

test('shared table sorting and header/quick facets use the same chronological values',()=>{
  const source=fs.readFileSync(path.join(__dirname,'../public/app-main.js'),'utf8');
  const block=(start,end)=>source.slice(source.indexOf(start),source.indexOf(end,source.indexOf(start)));
  const ctx=vm.createContext({BLBusinessRules:rules,COLS_BY_TABLE:{cp:[],orders:[]},columnSchemaFor:()=>null,norm:v=>String(v??'').trim()});
  vm.runInContext(block('function sortRows(','/* Boş tablo yönlendirmesi'),ctx);
  const months=['JULY 2027','JUNE 2027','MAY 2027'];
  assert.deepEqual(Array.from(ctx.sortRows(months.map(month=>({month})),'month',1),r=>r.month),['MAY 2027','JUNE 2027','JULY 2027']);
  vm.runInContext(block('function sortWithFacet(','function facetChecklistHtml('),ctx);
  assert.deepEqual(Array.from(ctx.sortWithFacet(months,new Set(months))),['MAY 2027','JUNE 2027','JULY 2027']);
});

test('dynamic price-analysis filters sort source month and season values chronologically',()=>{
  const engine=require('../public/price-supplier-insights-engine');
  const values=['W7','S5','W6','S7','W5','S6'];
  assert.deepEqual(engine.seasons({records:values.map(season=>({season}))}),['S5','W5','S6','W6','S7','W7']);
  const dataset={records:['JULY 2027','DECEMBER 2026','JUNE 2027'].map(month=>({obs:{row:{period:month}}}))};
  assert.deepEqual(engine.dimensionValues(dataset,'col:period'),['DECEMBER 2026','JUNE 2027','JULY 2027']);
});

test('quick filter frequencies and Backlog quantities cannot override period chronology',()=>{
  const source=name=>fs.readFileSync(path.join(__dirname,'../',name),'utf8');
  const block=(text,start,end)=>text.slice(text.indexOf(start),text.indexOf(end,text.indexOf(start)));
  const ctx=vm.createContext({BLBusinessRules:rules,window:{BLBusinessRules:rules},MAX_DISTINCT:100,clean:v=>String(v??'').trim(),BACKLOG_DIMENSIONS:{},backlogNode:(label,rows,children)=>({label,qty:rows.reduce((sum,r)=>sum+r.qty,0),children})});
  vm.runInContext(block(source('public/quick-filter-groups.js'),'function countValues(','function activeValues('),ctx);
  const rows=[...Array.from({length:9},()=>({period:'JULY 2027'})),{period:'JUNE 2027'}];
  assert.deepEqual(Array.from(ctx.countValues(rows,'period'),([value,count])=>[value,count]),[['JUNE 2027',1],['JULY 2027',9]]);
  vm.runInContext(block(source('server/lib/parse.js'),'function buildBacklogTree(','// Bir pivot düğümü.'),ctx);
  const tree=ctx.buildBacklogTree([{season:'S7',qty:900},{season:'W6',qty:10}],['season'],0,[],{season:r=>r.season});
  assert.deepEqual(Array.from(tree,r=>r.label),['W6','S7']);
});
