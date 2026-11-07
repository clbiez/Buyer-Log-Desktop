'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),zlib=require('node:zlib');
const vm=require('node:vm');
const {createComputePool}=require('../server/lib/compute-pool'),{createComputeService}=require('../server/lib/compute-service'),metadata=require('../server/lib/oab-static-metadata');
const MiB=1024*1024;
function fixture(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'buyerlog-oab-compute-')),pool=createComputePool({maxWorkers:1,memoryBudgetBytes:768*MiB,maxPendingBytes:32*MiB}),service=createComputeService({pool,root});t.after(async()=>{await service.close();fs.rmSync(root,{recursive:true,force:true});});return {pool,service};}
function expected(operation,ref){const options=operation==='seasons'?metadata.getSeasons():operation==='mag'?metadata.getMag(ref):metadata.getBuyerGroups(ref),info=metadata.getInfo();return {ok:true,[operation==='buyer-groups'?'buyerGroups':operation]:options,fromCache:true,source:'bundled-json',fetchedAt:info.generatedAt,metadata:info};}
test('native shared pool preserves exact OAB JSON bytes, handles unknown refs and never hydrates source data',async t=>{
 const {pool,service}=fixture(t),season=metadata.getSeasons().find(s=>metadata.getMag(s.SeasonRef).length),mag=metadata.getMag(season.SeasonRef)[0];
 const queries=[['seasons'],['mag',season.SeasonRef],['mag','DEMO-UNKNOWN-SEASON'],['buyer-groups',mag.MerchSubGroupRef],['buyer-groups','DEMO-UNKNOWN-MAG']],responses=queries.map(q=>JSON.stringify(expected(...q)));
 const getters=['getSeasons','getMag','getBuyerGroups','getInfo'],saved=Object.fromEntries(getters.map(k=>[k,metadata[k]])),read=fs.readFileSync,run=pool.run.bind(pool),admissions=[];
 for(const name of getters)metadata[name]=()=>{throw Error('OAB main-thread getter is forbidden');};
 fs.readFileSync=function(file,...args){if(String(file)===metadata.METADATA_FILE)throw Error('OAB file read must remain off main');return read.call(this,file,...args);};
 pool.run=(task,payload,options)=>{admissions.push({task,inputBytes:options.inputBytes,encodedBytes:payload.paramsBytes?.byteLength,estimatedBytes:options.estimatedBytes});return run(task,payload,options);};
 try{
  let thread;
  for(let i=0;i<queries.length;i++){
   const lease=await service.runOabMetadata('synthetic-viewer',...queries[i]);
   try{const body=zlib.gunzipSync(Buffer.from(lease.value.buffer));assert.equal(body.toString(),responses[i]);assert.equal(lease.value.uncompressedBytes,body.length);assert.ok(lease.metrics.threadId>0);if(thread)assert.equal(lease.metrics.threadId,thread);thread=lease.metrics.threadId;}finally{lease.release();}
   assert.equal(pool.stats().leasedOutputBytes,0);
  }
  assert.equal(service.stats().sourceFiles,0);assert.equal(pool.stats().workerCount,1);
  const size=(await fs.promises.stat(metadata.METADATA_FILE)).size;
  assert.equal(admissions.length,queries.length);for(const a of admissions){assert.equal(a.task,'oab-static-metadata');assert.ok(a.inputBytes>=a.encodedBytes);assert.ok(a.estimatedBytes>=size*8);}
 }finally{Object.assign(metadata,saved);fs.readFileSync=read;}
});
test('authority revoked during async metadata descriptor reading prevents worker admission',async t=>{
 const {pool,service}=fixture(t),stat=fs.promises.stat;let allowed=true,admissions=0;pool.run=async()=>{admissions++;throw Error('Revoked request reached the pool');};
 fs.promises.stat=async function(file,...args){const value=await stat.call(this,file,...args);if(String(file)===metadata.METADATA_FILE){await new Promise(setImmediate);allowed=false;}return value;};
 try{await assert.rejects(service.runOabMetadata('synthetic-viewer','seasons',undefined,{assertCurrent(){if(!allowed)throw Object.assign(Error('DEMO revoked'),{code:'OAB_ACCESS_REVOKED'});}}),{code:'OAB_ACCESS_REVOKED'});assert.equal(admissions,0);}finally{fs.promises.stat=stat;}
});
test('a replacement bundled generation reloads options even when its mtime was preserved',()=>{
 let name='DEMO FIRST';
 const raw=()=>({reportRef:'OrderBudget_List_Report',seasons:[{ref:'DEMO-S',name,mags:[{ref:'DEMO-M',buyerGroups:[{ref:'DEMO-B'}]}]}]});
 const fakeFs={statSync:()=>({mtimeMs:10}),readFileSync:()=>JSON.stringify(raw())};
 function load(file,deps){const context={module:{exports:{}},__dirname:path.dirname(file),require:key=>Object.hasOwn(deps,key)?deps[key]:require(key)};vm.runInNewContext(fs.readFileSync(file,'utf8'),context,{filename:file});return context.module.exports;}
 const reader=load(path.join(__dirname,'../server/lib/oab-static-metadata.js'),{fs:fakeFs});
 const builder=load(path.join(__dirname,'../server/lib/compute-oab-metadata.js'),{'node:fs':fakeFs,'./oab-static-metadata':reader});
 assert.equal(builder.buildResponse('seasons',undefined,'generation-one').seasons[0].Name,'DEMO FIRST');
 name='DEMO REPLACEMENT';
 assert.equal(builder.buildResponse('seasons',undefined,'generation-two').seasons[0].Name,'DEMO REPLACEMENT');
});
test('a changed bundled descriptor after computation rejects the result and releases output bytes',async t=>{
 const {pool,service}=fixture(t),stat=fs.promises.stat;let changed=false,released=0;
 pool.run=async()=>{changed=true;return {value:{buffer:new ArrayBuffer(0)},release(){released++;}};};
 fs.promises.stat=async function(file,...args){const value=await stat.call(this,file,...args);return String(file)===metadata.METADATA_FILE&&changed?{...value,ctimeNs:value.ctimeNs+1n,isFile:()=>true}:value;};
 try{await assert.rejects(service.runOabMetadata('synthetic-viewer','seasons'),{code:'COMPUTE_STALE_GENERATION'});assert.equal(released,1);}finally{fs.promises.stat=stat;}
});
test('a later metadata admission cannot overtake an unresolved descriptor for the same owner',async t=>{
 const {pool,service}=fixture(t),stat=fs.promises.stat;let calls=0,entered,resume;
 const ready=new Promise(resolve=>entered=resolve),gate=new Promise(resolve=>resume=resolve);
 fs.promises.stat=async function(file,...args){const value=await stat.call(this,file,...args);if(String(file)===metadata.METADATA_FILE&&++calls===1){entered();await gate;}return value;};
 pool.run=async()=>({value:{buffer:new ArrayBuffer(0)},release(){}});
 try{
  const first=service.runOabMetadata('synthetic-viewer','seasons');await ready;
  const second=service.runOabMetadata('synthetic-viewer','mag','DEMO');await new Promise(setImmediate);const pending=calls;resume();
  const leases=await Promise.all([first,second]);for(const lease of leases)lease.release();assert.equal(pending,1);
 }finally{resume?.();fs.promises.stat=stat;}
});
