'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),httpServer=require('node:http');
const {setup,until,params}=require('./fixtures/backlog-compute-lifecycle/harness.cjs');
const {sendComputedResponse}=require('../server/lib/compute-response');
test('loopback HTTP close cancels the last real native Backlog job; complete req.close and response finish preserve sharing',async t=>{
 const f=await setup(t,{rows:10000});let latest,arrivals=0;
 const server=httpServer.createServer(async(req,res)=>{
  req.cookie='one';arrivals++;
  const captured=f.guard.capture(req,'backlog');
  const subscription=f.lifecycle.subscribe({req,res,captured,task:'backlog-export',parts:{query:req.url},
   build:async ctx=>f.service.run('backlog-export',f.descriptor,params({}),{signal:ctx.signal,traceJobId:ctx.jobId})});
  latest=subscription;
  try{const lease=await subscription.promise;sendComputedResponse(req,res,lease);}
  catch(error){if(!res.destroyed){res.statusCode=error.statusCode||500;res.end(error.code||'error');}}
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 t.after(()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();}));
 const url='http://127.0.0.1:'+server.address().port;
 function request(route){const req=httpServer.get(url+route);const promise=new Promise((resolve,reject)=>{req.once('error',reject);req.once('response',res=>{const chunks=[];res.on('data',b=>chunks.push(b));res.once('end',()=>resolve({status:res.statusCode,body:Buffer.concat(chunks)}));});});promise.catch(()=>{});return {req,promise};}
 const a=request('/shared'),b=request('/shared');await until(()=>arrivals===2);
 const shared=latest.jobId;await until(()=>f.records.find(r=>r.jobId===shared)?.['build-start']);a.req.destroy();
 await until(()=>f.events.some(e=>e.type==='request-release'&&e.jobId===shared));
 const result=await b.promise;assert.equal(result.status,200);assert.ok(JSON.parse(result.body).rows.length);
 assert.equal(f.records.filter(r=>r.jobId===shared).length,1);assert.equal(f.events.filter(e=>e.type==='job-abort'&&e.jobId===shared).length,0);
 await until(()=>f.pool.stats().leasedOutputBytes===0);
 const c=request('/last');await until(()=>arrivals===3);const last=latest.jobId;
 await until(()=>f.records.find(r=>r.jobId===last)?.['build-start']);c.req.destroy();
 const record=f.records.find(r=>r.jobId===last);await until(()=>record.exitAt);
 assert.ok(record.terminateAt);assert.equal(record['build-end'],undefined);assert.equal(f.pool.stats().leasedOutputBytes,0);assert.equal(f.lifecycle.inFlight,0);
});
