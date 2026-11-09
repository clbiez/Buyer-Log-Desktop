'use strict';
const nodeTest=require('node:test'),test=(name,fn)=>nodeTest(name,{timeout:2000},fn),assert=require('node:assert/strict');
const {createComputeReadService}=require('../server/lib/compute-read-service');
const turn=()=>new Promise(resolve=>setImmediate(()=>setImmediate(resolve)));
function setup({ignoreAbort=false}={}){
 let calls=0,aborts=0,releases=0;const jobs=[];
 const service=createComputeReadService({guard:{capture:()=>({key:'same',profile:{},assertBuild(){},assertResponse(){}})},sourceFor:async()=>({}),paramsFor:()=>({}),
 compute:{run:(_task,_source,_params,options={})=>{calls++;return new Promise((resolve,reject)=>{
 const job={signal:options.signal,finish:()=>resolve({value:{buffer:new ArrayBuffer(8)},metrics:{outputBytes:8},release:()=>releases++}),fail:()=>reject(Error('synthetic failure'))};jobs.push(job);
 options.signal?.addEventListener('abort',()=>{aborts++;if(!ignoreAbort)reject(Object.assign(Error('aborted'),{code:'COMPUTE_ABORTED'}));},{once:true});
 });}}});
 return {service,jobs,get calls(){return calls;},get aborts(){return aborts;},get releases(){return releases;}};
}
function start(f,controller,options={}){const pending=f.service.run({},'backlog','backlog-export',{}, {...options,signal:controller?.signal});pending.catch(()=>{});return pending;}
test('single opted-in consumer abort reaches compute and retry starts a fresh flight',async()=>{
 const f=setup(),c=new AbortController(),pending=start(f,c);await turn();assert.ok(f.jobs[0].signal);c.abort();await assert.rejects(pending,{code:'COMPUTE_ABORTED'});await turn();assert.equal(f.aborts,1);assert.equal(f.service.stats().inFlight,0);assert.equal(f.service.stats().bytes,0);
 const retry=start(f,new AbortController());await turn();assert.equal(f.calls,2);f.jobs[1].finish();const lease=await retry;lease.release();f.service.clear();assert.equal(f.releases,1);
});
test('one shared consumer leaves; only the last departure aborts, exactly once',async()=>{
 const f=setup(),a=new AbortController(),b=new AbortController(),one=start(f,a),two=start(f,b);await turn();assert.equal(f.calls,1);a.abort();await assert.rejects(one,{code:'COMPUTE_ABORTED'});assert.equal(f.aborts,0);b.abort();b.abort();await assert.rejects(two,{code:'COMPUTE_ABORTED'});await turn();assert.equal(f.aborts,1);assert.equal(f.service.stats().entries,0);
});
test('live shared and non-opted-in consumers retain completion and cache leases',async()=>{
 for(const legacy of [false,true]){const f=setup(),a=new AbortController(),b=new AbortController(),one=start(f,a),two=start(f,legacy?null:b);await turn();a.abort();await assert.rejects(one,{code:'COMPUTE_ABORTED'});assert.equal(f.aborts,0);f.jobs[0].finish();const lease=await two;b.abort();assert.equal(f.aborts,0);lease.release();lease.release();assert.equal(f.releases,0);f.service.clear();assert.equal(f.releases,1);}
});
test('late completion after cancellation is released once and cannot enter cache',async()=>{
 const f=setup({ignoreAbort:true}),c=new AbortController(),pending=start(f,c);await turn();c.abort();await assert.rejects(pending,{code:'COMPUTE_ABORTED'});f.jobs[0].finish();await turn();assert.equal(f.releases,1);assert.equal(f.service.stats().entries,0);f.service.clear();assert.equal(f.releases,1);
});
test('abort before dispatch admits no compute job; errors release subscribers for retry',async()=>{
 const f=setup(),c=new AbortController(),pending=start(f,c);c.abort();await assert.rejects(pending,{code:'COMPUTE_ABORTED'});await turn();assert.equal(f.calls,0);
 const next=start(f,new AbortController());await turn();f.jobs[0].fail();await assert.rejects(next,/synthetic failure/);assert.equal(f.service.stats().inFlight,0);const retry=start(f,new AbortController());await turn();f.jobs[1].finish();(await retry).release();f.service.clear();assert.equal(f.releases,1);
});
