'use strict';
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),zlib=require('node:zlib');
const {EventEmitter}=require('node:events'),{Worker}=require('node:worker_threads'),{performance}=require('node:perf_hooks');
const {createComputePool}=require('../../../server/lib/compute-pool');
const {createComputeService}=require('../../../server/lib/compute-service');
const {createComputeReadGuard}=require('../../../server/lib/compute-read-guard');
const {createBacklogComputeLifecycle}=require('../../../server/lib/backlog-compute-lifecycle');
const MiB=1024*1024;
const turn=()=>new Promise(setImmediate);
function deferred(){let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};}
async function until(predicate){const deadline=performance.now()+10000;while(!predicate()){if(performance.now()>deadline)throw Error('Native observation deadline exceeded');await new Promise(r=>setTimeout(r,2));}}
function source(count){
 const rows=Array.from({length:count},(_,i)=>({ocode:4100000+i,model:'Synthetic '+i,ccode:'R',colour:'Red',buyer:'Synthetic Buyer',merch:'M',ageGroup:'A',buyerGrup:'G'+i%2,qty:10,kalan:5,fob:5,ex:new Date('2026-07-01'),retail:new Date('2026-08-01'),mb:new Date('2026-09-01'),_sourceFields:{'Synthetic Column':'Demo '+i}}));
 return {loadedAt:'demo-r1',asasOrders:rows,asasOrdersByTarget:{backlog:rows},antrepoMap:{}};
}
const params=parts=>({overrides:{},horizons:{},headers:['Synthetic'],options:{},sourceColumns:[],calendar:{configured:false},rowsRevision:'rows-v1',...parts});
function http(cookie='one'){
 const req=Object.assign(new EventEmitter(),{cookie,aborted:false,complete:true});
 const res=Object.assign(new EventEmitter(),{destroyed:false,writableFinished:false,writableEnded:false});
 return {req,res,abort(){req.aborted=true;req.emit('aborted');res.destroyed=true;res.emit('close');}};
}
async function setup(t,{rows=12,maxWorkers=1}={}){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'ana12-native-'));
 const records=[],workers=[],events=[];let admission;
 class ObservedWorker extends Worker{
  constructor(...args){super(...args);workers.push(this);this.current=null;this.once('exit',code=>{if(this.current){this.current.exitAt=performance.now();this.current.exitCode=code;this.current.cpuAtExit=process.cpuUsage();}});
   this.on('message',m=>{const r=records.find(r=>r.poolId===m.id&&r.worker===this);if(!r)return;
    if(m.type==='ana12-checkpoint'){r[m.phase]=performance.now();r.tid=m.tid;}
    if(m.type==='result'){r.resultAt=performance.now();r.ok=m.ok;this.current=null;}
   });
  }
  postMessage(m,...rest){if(m.type==='run'&&admission){admission.poolId=m.id;admission.worker=this;admission.dispatchedAt=performance.now();this.current=admission;}return super.postMessage(m,...rest);}
  terminate(){if(this.current)this.current.terminateAt=performance.now();return super.terminate();}
 }
 const pool=createComputePool({WorkerClass:ObservedWorker,workerFile:path.join(__dirname,'native-worker.cjs'),maxWorkers,memoryBudgetBytes:1536*MiB,maxPendingBytes:128*MiB});
 const originalRun=pool.run;
 pool.run=(task,payload,options)=>{
  const r={task,jobId:options.traceJobId,sentAt:performance.now()};records.push(r);admission=r;
  let promise;try{promise=originalRun(task,payload,options);}finally{admission=null;}
  // Queued dispatch occurs later, so look up its input identity without copying it.
  r.payload=payload;
  return promise.then(lease=>{r.completedAt=performance.now();return lease;},error=>{r.error=error.code;r.rejectedAt=performance.now();throw error;});
 };
 const post=ObservedWorker.prototype.postMessage;
 ObservedWorker.prototype.postMessage=function(m,...rest){
  const prior=admission;if(!admission&&m.type==='run')admission=records.find(r=>r.payload===m.payload);
  try{return post.call(this,m,...rest);}finally{admission=prior;}
 };
 const service=createComputeService({pool,root,diskBudgetBytes:256*MiB});
 const raw=source(rows),bytes=require('node:v8').serialize(raw).length;
 const descriptor=await service.seedSource({ownerId:'demo',generation:'g1',source:raw,uncompressedBytes:Math.max(MiB,bytes)});
 const profile={id:'demo',enabled:true,status:'ACTIVE',context:'ctx',access:'access'};
 const other={...profile,id:'other'},profiles=new Map([['demo',profile],['other',other]]);
 const sessions=new Map([['one',profile],['two',profile],['other',other]]),tokens=new Map([['demo','g1'],['other','g1']]);
 const guard=createComputeReadGuard({sessionProfile:req=>sessions.get(req.cookie),profileById:id=>profiles.get(id),hasArea:()=>true,contextFor:p=>({contextHash:p.context}),accessFor:p=>({accessHash:p.access}),sourceTokenFor:id=>tokens.get(id)});
 const lifecycle=createBacklogComputeLifecycle({onEvent:e=>events.push(e)});
 function subscribe(h= http(),parts={},extra={}){
  const captured=guard.capture(h.req,'backlog');
  return lifecycle.subscribe({req:h.req,res:h.res,captured,task:'backlog-export',parts,
   build:async ctx=>{ctx.assertCurrent();return service.run('backlog-export',descriptor,params(ctx.parts),{signal:ctx.signal,traceJobId:ctx.jobId});},...extra});
 }
 async function close(){lifecycle.dispose();await service.close();fs.rmSync(root,{recursive:true,force:true});}
 t?.after(close);
 return {pool,service,descriptor,raw,profile,other,sessions,tokens,guard,lifecycle,subscribe,records,workers,events,close};
}
const decode=lease=>JSON.parse(zlib.gunzipSync(Buffer.from(lease.value.buffer)));
module.exports={setup,http,deferred,until,turn,params,decode};
