'use strict';

// Compare the production engine with a Git revision using synthetic data only.
// Run from resources/app: node scripts/benchmark-price-supplier.js 49abe1d 20000
const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process');
const {performance}=require('node:perf_hooks');
const E=require('../public/price-supplier-insights-engine');
const baselineRef=process.argv[2]||'HEAD';
const count=Number(process.argv[3]||20000);
if(!Number.isInteger(count)||count<1||count>100000)throw new Error('Row count must be an integer from 1 to 100000.');
const source=execFileSync('git',['show',`${baselineRef}:resources/app/public/price-supplier-insights-engine.js`],{cwd:path.resolve(__dirname,'..'),encoding:'utf8'});
const baseline={exports:{}};
new Function('module',source)(baseline);
const before=baseline.exports;
const input=Array.from({length:count},(_,i)=>({season:i%2?'26Y':'25Y',manufacturer:`Demo Supplier ${i%80}`,classification:`Category ${i%12}`,country:i%3?'Türkiye':'Mısır',buyingGroup:'Kız Çocuk',buyer:`Buyer ${i%6}`,mag:`M${i%8}`,mmyg:`Y${i%4}`,productGroup:'Triko',price:8+i%15/10,quantity:50+i%100,currency:i%7?'USD':'EUR',modelKey:`model-${i}`,inStoreMonth:'2026-06',row:{'Demo field':i%2?'Aktif':'Pasif'}}));
const median=values=>values.sort((a,b)=>a-b)[Math.floor(values.length/2)];
function compare(run){
  run(before);run(E);
  const oldTimes=[],newTimes=[];let oldResult,newResult;
  for(let i=0;i<9;i++){
    const pairs=i%2?[[E,newTimes],[before,oldTimes]]:[[before,oldTimes],[E,newTimes]];
    for(const [engine,times] of pairs){const start=performance.now();const result=run(engine);times.push(performance.now()-start);if(engine===E)newResult=result;else oldResult=result;}
  }
  assert.deepEqual(newResult,oldResult,'Production results must match the baseline exactly.');
  return {beforeMedianMs:median(oldTimes),afterMedianMs:median(newTimes)};
}
const result={baselineRef,rows:count,node:process.version,samples:9,prepare:compare(engine=>engine.prepare(input)),scenarios:{}};
const dataset=E.prepare(input);
const scenarios={noFilters:{},emptyFilters:Object.fromEntries(E.FILTER_DIMENSIONS.map(key=>[key,[]])),activeFilters:{country:['TÜRKİYE','MISIR'],buyingGroup:['KIZ ÇOCUK'],mag:['M0','M1','M2','M3','M4','M5','M6','M7'],productGroup:['TRIKO'],'col:Demo field':['AKTIF','PASIF']}};
for(const [name,filters] of Object.entries(scenarios))result.scenarios[name]=compare(engine=>engine.analyze(dataset,{currentSeason:'26Y',previousSeason:'25Y',filters}));
console.log(JSON.stringify(result,null,2));
