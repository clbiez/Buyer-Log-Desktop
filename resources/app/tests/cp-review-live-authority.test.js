'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../server/server.js'),'utf8');
const start=source.indexOf('async function cpAgentData('),end=source.indexOf('\n}',start)+2;
function world(current,dataset){const context={userAccess:{profileById:()=>current.value,hasArea:(p,a)=>p.areas.includes(a)},cpAgentRevision:()=>JSON.stringify(current.value),agentPlatformDataset:dataset,require};vm.createContext(context);vm.runInContext(source.slice(start,end),context);return context.cpAgentData;}
test('CP review rejects a profile revoked before context loading without reading canonical data',async()=>{
 const stale={id:'buyer',enabled:true,areas:['cp']};
 for(const profile of [null,{...stale,enabled:false},{...stale,areas:[]}]){let reads=0;const load=world({value:profile},()=>{reads++;return [];});await assert.rejects(load(stale),{code:'AREA_FORBIDDEN'});assert.equal(reads,0);}
});
test('CP review rechecks authority after its canonical data await',async()=>{
 const current={value:{id:'buyer',enabled:true,areas:['cp']}},stale=current.value;
 const context={userAccess:{profileById:()=>current.value,hasArea:(p,a)=>p.areas.includes(a)},cpAgentRevision:()=>JSON.stringify(current.value),agentPlatformDataset:async()=>{current.value={...stale,enabled:false};return [];},require:()=>({analyzeOrder:()=>{},optionIdentity:()=>{},publicPayload:()=>({}),}),cpAgentPreferences:{ruleSnapshot:()=>({rules:[],payload:{}})}};
 vm.createContext(context);vm.runInContext(source.slice(start,end),context);
 await assert.rejects(context.cpAgentData(stale),{code:'OFFICE_PREVIEW_CHANGED'});
});
