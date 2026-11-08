'use strict';
const fs=require('node:fs'),{performance}=require('node:perf_hooks');
const {setup,http,until}=require('../../../resources/app/tests/fixtures/backlog-compute-lifecycle/harness.cjs');
const destination=process.argv[2];if(!destination)throw Error('JSON destination required');
const result={complete:false,rows:10000,cpuContribution:'unknown: no internal progress checkpoint within the real builder',cpuClockHz:Number(require('node:child_process').execFileSync('getconf',['CLK_TCK'],{encoding:'utf8'}).trim())};
const save=()=>fs.writeFileSync(destination,JSON.stringify(result,null,2)+'\n');
function ticks(tid){try{const stat=fs.readFileSync('/proc/self/task/'+tid+'/stat','utf8').split(') ')[1].split(' ');return Number(stat[11])+Number(stat[12]);}catch{return null;}}
(async()=>{
 save();const f=await setup(null,{rows:10000});let sampler;
 try{
  const h=http(),s=f.subscribe(h);await until(()=>f.records.find(r=>r.jobId===s.jobId)?.['build-start']);
  const r=f.records.find(r=>r.jobId===s.jobId);if(r['build-end'])throw Error('Real builder already completed before abort');
  const abortAt=performance.now(),cpu=process.cpuUsage(),startTicks=ticks(r.tid);let lastTicks=startTicks,lastSampleAt=abortAt;
  sampler=setInterval(()=>{const value=ticks(r.tid);if(value!==null){lastTicks=value;lastSampleAt=performance.now();}},1);
  h.abort();await s.promise.catch(error=>{result.rejection=error.code;});await until(()=>r.exitAt);clearInterval(sampler);
  if(!r.terminateAt||r['build-end']||r.completedAt||r.worker.threadId!==-1)throw Error('Native cancellation acceptance failed');
  Object.assign(result,{jobId:s.jobId,requestId:s.requestId,buildStartAt:r['build-start'],abortAt,nativeExitAt:r.exitAt,abortToNativeExitMs:r.exitAt-abortAt,
   abortToExitWholeProcessCpuMs:(r.cpuAtExit.user-cpu.user+r.cpuAtExit.system-cpu.system)/1000,
   postAbortThreadCpuLowerBoundMs:startTicks===null||lastTicks===null?null:(lastTicks-startTicks)*1000/result.cpuClockHz,
   lastNativeCpuSampleAt:lastSampleAt,threadAbsentAfterExit:ticks(r.tid)===null,nativeThreadId:r.tid,exitCode:r.exitCode,poolAfter:f.pool.stats(),events:f.events});
  const afterCpu=process.cpuUsage();await new Promise(resolve=>setTimeout(resolve,25));const used=process.cpuUsage(afterCpu);
  result.afterExitWholeProcessCpuWindow={wallMs:25,cpuMs:(used.user+used.system)/1000,attribution:'entire idle harness process; worker no longer exists'};
  result.complete=true;save();console.log(JSON.stringify(result));
 }finally{clearInterval(sampler);await f.close();}
})().catch(error=>{result.failure={message:error.message,stack:error.stack};save();console.error(error);process.exitCode=1;});
