'use strict';
// Benchmark-only consumer. It never reads application records or credentials.
const fs=require('node:fs'),path=require('node:path'),{workerData}=require('node:worker_threads');
const {performance}=require('node:perf_hooks');
const {assertSyntheticFixture}=require('./server-loop-probe');
const {control:controlBuffer,records:recordBuffer,capacity,recordWidth,pid,atMs,intervalMs,reportFromMs}=workerData;
const control=new Int32Array(controlBuffer),records=new Float64Array(recordBuffer);
let fd,recorded=0,gcRecords=0,maxGapMs=0;
const sampleIntervalMs=100,samples=[],pending=[];let ticks=0,lastSampleAt=-Infinity;
if(process.platform==='linux'){
  try{ticks=Number(require('node:child_process').execFileSync('getconf',['CLK_TCK'],{encoding:'utf8',timeout:2000}).trim());}catch{}
}
if(!Number.isFinite(ticks)||ticks<=0)ticks=0;
const cpuScope=ticks?'thread':'unavailable',resolutionMs=ticks?1000/ticks:null;
function sampleCpu(force=false){
  if(!ticks)return;
  const start=performance.now();if(!force&&start-lastSampleAt<sampleIntervalMs)return;
  if(samples.length>=72000)throw Error('CPU sample history capacity exceeded');
  const text=fs.readFileSync(`/proc/${pid}/task/${pid}/stat`,'utf8'),fields=text.slice(text.lastIndexOf(')')+1).trim().split(/\s+/);
  const user=Number(fields[11]),system=Number(fields[12]),end=performance.now();
  if(![user,system].every(v=>Number.isSafeInteger(v)&&v>=0))throw Error('Invalid main-thread CPU sample');
  samples.push({fromMs:performance.timeOrigin+start,toMs:performance.timeOrigin+end,user,system});lastSampleAt=end;
}
function lowerBound(value,key){let lo=0,hi=samples.length;while(lo<hi){const mid=(lo+hi)>>>1;if(samples[mid][key]<value)lo=mid+1;else hi=mid;}return lo;}
function cpuWindow(gap){
  if(!ticks)return {cpuApproximate:true,cpuAvailable:false,userCpuMs:0,systemCpuMs:0};
  const beforeIndex=lowerBound(gap.fromMs+.000001,'toMs')-1,afterIndex=lowerBound(gap.toMs,'fromMs');
  if(beforeIndex<0||afterIndex>=samples.length)return null;
  const before=samples[beforeIndex],after=samples[afterIndex];
  if(after.user<before.user||after.system<before.system)throw Error('Main-thread CPU counter moved backwards');
  return {cpuApproximate:true,cpuAvailable:true,cpuWindowFromMs:before.fromMs,cpuWindowToMs:after.toMs,cpuClockResolutionMs:resolutionMs,
    userCpuMs:(after.user-before.user)*resolutionMs,systemCpuMs:(after.system-before.system)*resolutionMs};
}
function flushPending(){
  while(pending.length){const gap=pending[0],cpu=cpuWindow(gap);if(!cpu)break;pending.shift();emit({...gap,...cpu});recorded++;maxGapMs=Math.max(maxGapMs,gap.gapMs);}
}
function emit(value){
  const bytes=Buffer.from(JSON.stringify({pid,...value})+'\n');
  for(let offset=0;offset<bytes.length;)offset+=fs.writeSync(fd,bytes,offset,bytes.length-offset);
}
try{
  const root=assertSyntheticFixture(workerData.fixtureRoot);
  sampleCpu(true);
  fd=fs.openSync(path.join(root,`event-loop-probe-${pid}.jsonl`),'wx');
  emit({kind:'start',atMs,intervalMs,reportFromMs,clock:'monotonic elapsed mapped to epoch',transport:'shared-ring-worker',capacity,cpuScope,cpuMeasurement:'surrounding-sample-window',cpuSampleIntervalMs:sampleIntervalMs,cpuClockResolutionMs:resolutionMs,gc:true});
  Atomics.store(control,3,1);Atomics.notify(control,3);
  for(;;){
    sampleCpu();
    let consumed=Atomics.load(control,1),published=Atomics.load(control,0);
    while(consumed<published){
      const offset=(consumed%capacity)*recordWidth,kind=records[offset],fromMs=records[offset+1],toMs=records[offset+2],durationMs=records[offset+3];
      if(kind===1)pending.push({kind:'gap',fromMs,toMs,gapMs:durationMs,delayMs:records[offset+4]});
      else if(kind===2){emit({kind:'gc',fromMs,toMs,durationMs,gcKind:records[offset+4],gcFlags:records[offset+5]});gcRecords++;}
      else throw Error('Invalid observer ring record');
      consumed++;Atomics.store(control,1,consumed);
    }
    if(Atomics.load(control,6))throw Error('Event-loop observer ring overflow');
    if(Atomics.load(control,2)&&consumed===Atomics.load(control,0)){
      sampleCpu(true);flushPending();if(pending.length)throw Error('Incomplete CPU observation window');break;
    }
    flushPending();
    Atomics.wait(control,0,published,25);
  }
  emit({kind:'stop',atMs:Date.now(),recorded,gcRecords,maxGapMs});
}catch(error){
  Atomics.store(control,5,1);
  if(fd!==undefined){try{emit({kind:'error',code:'OBSERVER_WRITER_FAILED'});}catch(_){}}
}finally{
  if(fd!==undefined)fs.closeSync(fd);
  Atomics.store(control,3,1);Atomics.notify(control,3);Atomics.store(control,4,1);Atomics.notify(control,4);
}
