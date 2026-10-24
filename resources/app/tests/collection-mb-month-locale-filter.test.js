'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const Groups=require('../public/collection-model-groups.js');

const app=fs.readFileSync(path.join(__dirname,'..','public','app-main.js'),'utf8');
function between(start,end){
  const a=app.indexOf(start),b=app.indexOf(end,a+start.length);
  assert.ok(a>=0,'Missing '+start);
  assert.ok(b>a,'Missing '+end);
  return app.slice(a,b);
}
function collectionContext(){
  const sandbox={
    appLang:'tr',
    norm:value=>String(value==null?'':value).trim(),
    turknorm:value=>String(value==null?'':value).toUpperCase().replace(/[İŞÇÖÜĞ]/g,x=>({'İ':'I','Ş':'S','Ç':'C','Ö':'O','Ü':'U','Ğ':'G'}[x])).replace(/\s+/g,' ').trim(),
    kolColDefs:()=>[{k:'inStoreMonth'}],
    columnSchemaFor:()=>null,
    kolRows:[],
    kolEffectiveValue:(row,key)=>row[key],
    kolSort:{key:'inStoreMonth',dir:1},
  };
  const ctx=vm.createContext(sandbox);
  const helpers=between('const KOL_MONTHS_TR=', '// ===================== Collection In-Store period picker');
  const selections=between('function kolCanonicalFilterSelection(', 'function kolFilterValue(');
  const filterValue=between('function kolFilterValue(', 'function kolFilterMeta(');
  const compare=between('function kolCompareRowsForActiveSort(', 'function kolGroupMembersIndex(');
  vm.runInContext(helpers+selections+filterValue+compare,ctx);
  return ctx;
}
test('MB month keys and labels are locale-independent for filters',()=>{
  const ctx=collectionContext();
  const key=vm.runInContext('kolFilterValue',ctx);
  const show=vm.runInContext('kolMonthDisplay',ctx);
  const variants=['JULY 2027','TEMMUZ 2027','2027-07','202707','07/2027'];
  variants.forEach(value=>assert.equal(key({inStoreMonth:value},'inStoreMonth'),'202707',value));
  assert.equal(show('JULY 2027'),'TEMMUZ 2027');
  assert.equal(show('TEMMUZ 2027'),'TEMMUZ 2027');
  ctx.appLang='en';
  assert.equal(show('TEMMUZ 2027'),'JULY 2027');
  assert.equal(show('JULY 2027'),'JULY 2027');
  assert.equal(key({inStoreMonth:''},'inStoreMonth'),'');
  assert.equal(key({inStoreMonth:'2027-13'},'inStoreMonth'),'2027-13');
});
test('Mixed historical names merge into one facet and preserve selected filters',()=>{
  const ctx=collectionContext();
  const key=vm.runInContext('kolFilterValue',ctx);
  const selection=vm.runInContext('kolCanonicalFilterSelection',ctx);
  const rows=[
    ...Array.from({length:14},()=>({inStoreMonth:'JULY 2027'})),
    {inStoreMonth:'TEMMUZ 2027'},
    {inStoreMonth:'HAZİRAN 2027'},
    {inStoreMonth:'MAYIS 2027'},
    {inStoreMonth:''},
  ];
  const counts=new Map();
  rows.forEach(row=>{const k=key(row,'inStoreMonth');counts.set(k,(counts.get(k)||0)+1);});
  assert.equal(counts.get('202707'),15);
  assert.equal(counts.get('202706'),1);
  assert.equal(counts.get('202705'),1);
  assert.equal(counts.get(''),1);
  assert.equal(counts.size,4);
  const restored=selection('inStoreMonth',['JULY 2027','TEMMUZ 2027','2027-07']);
  assert.deepEqual([...restored],['202707']);
  assert.equal(rows.filter(row=>restored.has(key(row,'inStoreMonth'))).length,15);
  const other=selection('season',['7S','7W']);
  assert.deepEqual([...other],['7S','7W']);
});
test('MB month sorting and filter/quick-filter UIs use stable period keys',()=>{
  const ctx=collectionContext();
  const compare=vm.runInContext('kolCompareRowsForActiveSort',ctx);
  assert.ok(compare({inStoreMonth:'TEMMUZ 2027'},{inStoreMonth:'JUNE 2027'},[])>0);
  assert.equal(compare({inStoreMonth:'TEMMUZ 2027'},{inStoreMonth:'JULY 2027'},[]),0);
  const header=between('function openKolHeaderFilter(','document.getElementById(\'kolClearColFiltersBtn\')');
  assert.match(header,/const monthFacet=key==='inStoreMonth'/);
  assert.match(header,/kolMonthDisplay\(raw\)/);
  assert.match(header,/rawByDisplay\.get\(v\)/);
  const quick=between('function renderKolQuickFilters(){','\/\/ ================= PRICING PREFLIGHT');
  assert.match(quick,/kolFilterValue\(r,dim\.key\)/);
  assert.match(quick,/kolMonthDisplay\(val\)/);
  assert.match(app,/kolColFilters\[k\]=kolCanonicalFilterSelection\(k,vals\)/);
  assert.match(app,/activeFilterEntrySummary\(\{values:key==='inStoreMonth'\?/);
});
test('Models with same PLM, model and budget month share a grouping identity across languages',()=>{
  const a={id:1,plmId:'2105001',modelKod:'MODEL-1',inStoreMonth:'JULY 2027',colourCode:'BLK',colour:'Black'};
  const b={id:2,plmId:'2105001',modelKod:'MODEL-1',inStoreMonth:'TEMMUZ 2027',colourCode:'WHT',colour:'White'};
  assert.equal(Groups.identityOf(a),Groups.identityOf(b));
  const normalized=Groups.normalizeRows([a,b]);
  assert.equal(normalized.groups.length,1);
  assert.equal(normalized.rows[0].modelGroupId,normalized.rows[1].modelGroupId);
  const c={...b,id:3,inStoreMonth:'AĞUSTOS 2027'};
  assert.notEqual(Groups.identityOf(a),Groups.identityOf(c));
});
