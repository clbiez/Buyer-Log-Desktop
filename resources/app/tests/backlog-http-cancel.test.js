'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),http=require('node:http'),vm=require('node:vm'),path=require('node:path'),zlib=require('node:zlib');
const source=require('./helpers/server-source')();
const {createComputeReadService}=require('../server/lib/compute-read-service'),{createComputePool}=require('../server/lib/compute-pool'),{sendComputedResponse}=require('../server/lib/compute-response');
const block=source.slice(source.indexOf('function backlogReadConsumer('),source.indexOf('// Backlog pivot',source.indexOf('function backlogReadConsumer(')));
const until=async predicate=>{const deadline=Date.now()+5000;while(!predicate()){assert.ok(Date.now()<deadline,'condition timed out');await new Promise(resolve=>setTimeout(resolve,5));}};
for(const route of ['/api/backlog-export','/api/backlog-filter-values'])test(`${route}: real HTTP close reaches the existing pool only for the last consumer`,{timeout:15000},async t=>{
 const pool=createComputePool({workerFile:path.join(__dirname,'fixtures/compute-pool-worker.js'),maxWorkers:1,memoryBudgetBytes:64*1024*1024,workerBaseBytes:1024});
 let calls=0,aborts=0,releases=0,delayMs=1000;const signals=[],routes=new Map();
 const service=createComputeReadService({guard:{capture:()=>({key:'synthetic',profile:{},assertBuild(){},assertResponse(){}})},sourceFor:async()=>({}),paramsFor:()=>({}),
 compute:{run:async(_task,_source,_params,options)=>{
 calls++;signals.push(options.signal);options.signal.addEventListener('abort',()=>aborts++,{once:true});
 const lease=await pool.run('echo',{value:'synthetic',delayMs},{...options,ownerKey:'demo',generation:'g1',estimatedBytes:1024*1024,inputBytes:0});
 return {...lease,value:{buffer:zlib.gzipSync('{"synthetic":true}')},metrics:{...lease.metrics,outputBytes:64},release(){releases++;lease.release();}};
 }}});
 const context={AbortController,app:{get:(url,_guard,handler)=>routes.set(url,handler)},userAccess:{requireArea:()=>null},assertSourceFilters(){},prepareComputeBacklog:async()=>{},computeReads:service,sendComputedResponse,apiError:(res,error)=>{res.statusCode=error.statusCode||500;res.end(error.message);}};
 vm.createContext(context);vm.runInContext(block,context);
 const server=http.createServer((req,res)=>{req.query={format:'json',field:'synthetic'};routes.get(route)(req,res);});
 t.after(async()=>{service.clear();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await pool.close();});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const url=`http://127.0.0.1:${server.address().port}${route}`;
 const open=()=>{const request=http.get(url,{headers:{'accept-encoding':'gzip'}},res=>res.resume());request.on('error',()=>{});return request;};
 const a=open(),b=open();await until(()=>calls===1);a.destroy();await until(()=>service.stats().inFlight===1);await new Promise(resolve=>setTimeout(resolve,25));assert.equal(aborts,0);
 b.destroy();await until(()=>aborts===1);await until(()=>pool.stats().activeWorkers===0);assert.equal(service.stats().entries,0);assert.equal(pool.stats().leasedOutputBytes,0);
 delayMs=5;const normal=await fetch(url,{headers:{'accept-encoding':'gzip'}});assert.equal(normal.status,200);assert.deepEqual(await normal.json(),{synthetic:true});assert.equal(aborts,1,'normal GET request close/response finish must not abort');
 service.clear();assert.equal(releases,1);assert.equal(pool.stats().leasedOutputBytes,0);
 const req=new (require('node:events').EventEmitter)(),res=new (require('node:events').EventEmitter)();const consumer=context.backlogReadConsumer(req,res);req.emit('close');assert.equal(consumer.signal.aborted,false);res.writableFinished=true;res.emit('finish');res.emit('close');assert.equal(consumer.signal.aborted,false);assert.equal(req.listenerCount('aborted'),0);assert.equal(res.listenerCount('close'),0);
});
