'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),fsp=fs.promises,path=require('node:path'),os=require('node:os');
const {createComputeService}=require('../server/lib/compute-service'),{jsonToBuffer}=require('../server/lib/large-json');
function fixture(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'bl-snapshot-compute-')),service=createComputeService({root});t.after(async()=>{await service.close();await fsp.rm(root,{recursive:true,force:true});});return {root,service};}
test('DS-08: snapshot encoding runs on the common pool and preserves exact JSON bytes',async t=>{
 const {service}=fixture(t),state={revision:7,records:Object.fromEntries(Array.from({length:3000},(_,i)=>['r'+i,{text:'ü\\n'.repeat(100),date:new Date('2026-01-01Z'),missing:undefined,nan:NaN,arr:[undefined,null,-0]}]))};
 const lease=await service.encodeLocalDbSnapshot(state);
 try{assert.ok(lease.metrics.threadId>0);assert.deepEqual(Buffer.from(lease.value.buffer),jsonToBuffer(state));assert.equal(lease.value.revision,7);}finally{lease.release();}
 assert.equal(service.stats().leasedOutputBytes,0);
});
test('DS-08: small snapshots retain their cheap local path',async t=>{
 const {service}=fixture(t),state={revision:0,records:{}};const lease=await service.encodeLocalDbSnapshot(state);
 try{assert.deepEqual(Buffer.from(lease.value.buffer),jsonToBuffer(state));assert.equal(service.stats().workerCount,0);}finally{lease.release();}
});
test('DS-08: a real pool capacity rejection retains the existing durable JSON capacity',async t=>{
 const {root}=fixture(t),{createComputePool}=require('../server/lib/compute-pool');
 const service=createComputeService({root,pool:createComputePool({memoryBudgetBytes:160*1024*1024})});t.after(()=>service.close());
 const state={revision:8,records:{large:{text:'x'.repeat(5*1024*1024)}}},lease=await service.encodeLocalDbSnapshot(state);
 try{assert.deepEqual(Buffer.from(lease.value.buffer),jsonToBuffer(state));assert.equal(lease.metrics.fallbackReason,'COMPUTE_JOB_TOO_LARGE');assert.equal(service.stats().workerCount,0);}finally{lease.release();}
});
for(const code of ['COMPUTE_QUEUE_BUSY','COMPUTE_TIMEOUT','COMPUTE_WORKER_FAILED'])test(`DS-08: ${code} cannot turn a valid checkpoint into a failed save`,async t=>{
 const {root}=fixture(t),service=createComputeService({root,pool:{run:async()=>{throw Object.assign(Error(code),{code});},close:async()=>{}}});t.after(()=>service.close());
 const state={revision:9,records:{large:{text:'x'.repeat(300000)}}},lease=await service.encodeLocalDbSnapshot(state);
 try{assert.deepEqual(Buffer.from(lease.value.buffer),jsonToBuffer(state));assert.equal(lease.metrics.fallbackReason,code);}finally{lease.release();}
});
test('DS-08: JSON-compatible toJSON values retain the pre-worker encoding contract',async t=>{
 const {service}=fixture(t),state={revision:10,records:{custom:{toJSON(){return {value:'compatible'};}}}};
 const lease=await service.encodeLocalDbSnapshot(state);try{assert.deepEqual(Buffer.from(lease.value.buffer),jsonToBuffer(state));assert.equal(lease.metrics.fallbackReason,'COMPUTE_INPUT_ENCODING');}finally{lease.release();}
});
