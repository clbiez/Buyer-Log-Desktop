'use strict';
// node bench.cjs <baseline resources/app> [candidate resources/app]
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{performance}=require('node:perf_hooks');
const baseline=path.resolve(process.argv[2]),candidate=path.resolve(process.argv[3]||path.join(__dirname,'../../../resources/app'));
const models={main:require(path.join(baseline,'server/lib/model-refresh')),candidate:require(path.join(candidate,'server/lib/model-refresh'))};
const source=fs.readFileSync(path.join(candidate,'tests/model-source-control-rollback.test.js'),'utf8');
const first=source.indexOf('const T ='),last=source.indexOf("test('rollback preserves");assert.ok(first>=0&&last>first);
const fixture=Function('modelFields',source.slice(first,last)+';return {asasItem,iasItem};')(require(path.join(candidate,'server/lib/model-fields')));
const items=[fixture.asasItem(),fixture.iasItem()];
for(const item of items)assert.deepEqual(models.main.buildConnectionQuery(item,{columnType:null}),models.candidate.buildConnectionQuery(item,{columnType:null}));
for(const model of Object.values(models))for(let n=0;n<100;n++)for(const item of items)model.buildConnectionQuery(item,{columnType:null});
const samples=[];
for(let pair=0;pair<3;pair++)for(const variant of ['main','candidate']){const start=performance.now();for(let n=0;n<500;n++)for(const item of items)models[variant].buildConnectionQuery(item,{columnType:null});samples.push({pair:pair+1,variant,ms:performance.now()-start,builds:1000});}
const median=name=>samples.filter(x=>x.variant===name).map(x=>x.ms).sort((a,b)=>a-b)[1];
const main=median('main'),next=median('candidate');assert.ok(next<=main+Math.max(main*.1,10));
console.log(JSON.stringify({mainMedianMs:main,candidateMedianMs:next,exactQueryEquality:true,samples},null,2));
