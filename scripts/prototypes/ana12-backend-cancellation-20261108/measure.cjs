'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),zlib=require('node:zlib');
const {performance}=require('node:perf_hooks');
const {setup,http,until,params}=require('../../../resources/app/tests/fixtures/backlog-compute-lifecycle/harness.cjs');
const destination=process.argv[2];if(!destination)throw Error('Evidence JSON destination required');
const report={schema:1,rows:10000,filters:10,intervalMs:12,clockTicksPerSecond:100,
 cpuAttribution:'unknown: builder start/end only, no intermediate progress checkpoint; process CPU includes harness, compression and other threads',
 interpretation:'Adapter + real pool + instrumented real Backlog worker. Production routes are not integrated. Baseline keeps obsolete subscriptions alive.',pairs:[]};
function save(){fs.writeFileSync(destination,JSON.stringify(report,null,2)+'\n');}
function ticks(tid){try{const s=fs.readFileSync('/proc/self/task/'+tid+'/stat','utf8'),fields=s.slice(s.lastIndexOf(')')+2).split(' ');return Number(fields[11])+Number(fields[12]);}catch{return null;}}
const hash=lease=>crypto.createHash('sha256').update(zlib.gunzipSync(Buffer.from(lease.value.buffer))).digest('hex');
async function run(cancel){
 const f=await setup(null,{rows:report.rows}),subscriptions=[],outputs=[],cancellations=[];
 const parts=Array.from({length:10},(_,i)=>({options:{exFactoryFrom:'2026-06-'+String(i+1).padStart(2,'0')},includeSourceDetails:false}));
 const expected=crypto.createHash('sha256').update(require('../../../resources/app/server/lib/compute-tasks').serialize(require('../../../resources/app/server/lib/compute-tasks').buildBacklog('export',f.raw,params(parts.at(-1))))).digest('hex');
 const start=performance.now(),cpu=process.cpuUsage();let timer;
 try{
  timer=setInterval(()=>{for(const c of cancellations){const record=f.records.find(r=>r.jobId===c.jobId);if(record?.tid){const value=ticks(record.tid);if(value!==null){c.lastTicks=value;c.lastSampleAt=performance.now();}}}},2);
  for(let i=0;i<10;i++){
   if(cancel&&i){
    const previous=subscriptions.at(-1),record=f.records.find(r=>r.jobId===previous.jobId);
    const item={jobId:previous.jobId,abortAt:performance.now(),processCpuStart:process.cpuUsage(),ticksAtAbort:record?.tid?ticks(record.tid):null};cancellations.push(item);
    previous.release();
   }
   const subscription=f.subscribe(http(),parts[i]);subscriptions.push(subscription);
   const promise=subscription.promise.then(lease=>{outputs[i]=lease;return lease;},error=>{if(error.code!=='COMPUTE_ABORTED')throw error;});promise.catch(()=>{});
   subscription.observed=promise;
   if(i<9)await new Promise(resolve=>setTimeout(resolve,report.intervalMs));
  }
  await Promise.all(subscriptions.map(s=>s.observed));
  const finalHash=hash(outputs[9]);if(finalHash!==expected)throw Error('EQUIVALENCE FAILURE: final native output differs from real builder oracle');
  for(const lease of outputs)lease?.release();
  await until(()=>f.pool.stats().activeWorkers===0&&f.pool.stats().pending===0);
  const cpuUsed=process.cpuUsage(cpu),wallMs=performance.now()-start;
  const records=f.records.filter(r=>r.task==='backlog-export');
  for(const c of cancellations){const r=records.find(r=>r.jobId===c.jobId);if(r?.exitAt){c.abortToNativeExitMs=r.exitAt-c.abortAt;c.nativeThreadAbsentAtExit=r.tid?ticks(r.tid)===null:null;
    c.abortToExitWholeProcessCpuMs=(r.cpuAtExit.user-c.processCpuStart.user+r.cpuAtExit.system-c.processCpuStart.system)/1000;}
   c.observedThreadPostAbortCpuLowerBoundMs=c.ticksAtAbort!==null&&c.lastTicks!==undefined?(c.lastTicks-c.ticksAtAbort)*10:null;
   delete c.processCpuStart;
  }
  const finalCpu=process.cpuUsage(),afterExitStart=performance.now();await new Promise(r=>setTimeout(r,20));const afterExitCpu=process.cpuUsage(finalCpu);
  return {mode:cancel?'last-subscriber-abort':'keep-obsolete',wallMs,processCpuMs:(cpuUsed.user+cpuUsed.system)/1000,finalHash,oracleHash:expected,
   submitted:records.length,admitted:records.length,dispatched:records.filter(r=>r.dispatchedAt).length,started:records.filter(r=>r['build-start']).length,
   completed:records.filter(r=>r.completedAt).length,queuedCancelled:records.filter(r=>r.error==='COMPUTE_ABORTED'&&!r.dispatchedAt).length,
   runningStopped:records.filter(r=>r.terminateAt&&r.exitAt&&r.error==='COMPUTE_ABORTED').length,
   stoppedInsideBuilder:records.filter(r=>r.terminateAt&&r.exitAt&&r['build-start']&&!r['build-end']).length,
   cancellations,poolAfter:f.pool.stats(),afterWorkDrainedProcessWindow:{wallMs:performance.now()-afterExitStart,cpuMs:(afterExitCpu.user+afterExitCpu.system)/1000,attribution:'whole process with idle worker; not job CPU'},
   records:records.map(r=>Object.fromEntries(['jobId','poolId','sentAt','dispatchedAt','build-start','build-end','completedAt','rejectedAt','error','terminateAt','exitAt','exitCode','tid'].filter(k=>r[k]!==undefined).map(k=>[k,r[k]]))),events:f.events};
 }finally{clearInterval(timer);for(const s of subscriptions)s.release();for(const lease of outputs)lease?.release();await f.close();}
}
(async()=>{
 save();for(let i=0;i<3;i++){
  const pair={pair:i+1,order:i===1?['abort','baseline']:['baseline','abort']};report.pairs.push(pair);save();
  for(const mode of pair.order){pair[mode]=await run(mode==='abort');save();}
  if(pair.baseline.finalHash!==pair.abort.finalHash)throw Error('EQUIVALENCE FAILURE between paired native runs');
  console.log(JSON.stringify({pair:i+1,baselineMs:pair.baseline.wallMs,abortMs:pair.abort.wallMs,baselineCpuMs:pair.baseline.processCpuMs,abortCpuMs:pair.abort.processCpuMs,submitted:pair.abort.submitted,started:pair.abort.started,completed:pair.abort.completed,queuedCancelled:pair.abort.queuedCancelled,runningStopped:pair.abort.runningStopped,hash:pair.abort.finalHash}));
 }
 report.complete=true;save();
})().catch(error=>{report.failure={message:error.message,stack:error.stack};save();console.error(error);process.exitCode=1;});
