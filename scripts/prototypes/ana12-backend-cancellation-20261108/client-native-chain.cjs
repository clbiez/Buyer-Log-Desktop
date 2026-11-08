'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),http=require('node:http'),vm=require('node:vm'),{execFileSync}=require('node:child_process');
const {setup,params,until}=require('../../../resources/app/tests/fixtures/backlog-compute-lifecycle/harness.cjs');
const {sendComputedResponse}=require('../../../resources/app/server/lib/compute-response');
const pin='6060c6b0e66a65ef0b8f5c2c4ee4e44f193f8f7b';
const source=execFileSync('git',['show',pin+':resources/app/public/backlog-request-lifecycle.js'],{encoding:'utf8'});
const sandbox={module:{exports:{}},AbortController,Error,TypeError,JSON};vm.runInNewContext(source,sandbox);
test('pinned unchanged client last release -> native fetch abort -> loopback close -> real Backlog worker exit',async t=>{
 const f=await setup(t,{rows:10000});let subscription,signal;
 const server=http.createServer(async(req,res)=>{
  req.cookie='one';subscription=f.lifecycle.subscribe({req,res,captured:f.guard.capture(req,'backlog'),task:'backlog-export',parts:{},
   build:ctx=>f.service.run('backlog-export',f.descriptor,params({}),{signal:ctx.signal,traceJobId:ctx.jobId})});
  try{sendComputedResponse(req,res,await subscription.promise);}catch(error){if(!res.destroyed){res.statusCode=error.statusCode||500;res.end(error.code);}}
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 t.after(()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();}));
 const requests=sandbox.module.exports.createRequestLifecycle({keyForQuery:()=> 'same',isCurrent:()=>true,request(_parts,context){signal=context.signal;return fetch('http://127.0.0.1:'+server.address().port,{signal});}});
 t.after(()=>requests.dispose());
 const identity={scope:'synthetic',user:'synthetic',session:'synthetic',generation:'g1',revision:'r1'};
 const a=requests.subscribe({},identity),b=requests.subscribe({},identity);
 await until(()=>subscription&&f.records.find(r=>r.jobId===subscription.jobId)?.['build-start']);
 a.release();await assert.rejects(a.promise,{name:'AbortError'});assert.equal(signal.aborted,false);
 b.release();await assert.rejects(b.promise,{name:'AbortError'});assert.equal(signal.aborted,true);
 const record=f.records.find(r=>r.jobId===subscription.jobId);await until(()=>record.exitAt);
 assert.ok(record.terminateAt);assert.equal(record['build-end'],undefined);assert.equal(record.worker.threadId,-1);assert.equal(f.pool.stats().reservedBytes,0);
 const current=requests.subscribe({},identity),body=await current.promise;
 const tasks=require('../../../resources/app/server/lib/compute-tasks');assert.equal(JSON.stringify(body),tasks.serialize(tasks.buildBacklog('export',f.raw,params({}))));current.release();
 await until(()=>f.pool.stats().leasedOutputBytes===0);
});
