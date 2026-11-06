'use strict';
// Benchmark-only consumer. It never reads application records or credentials.
const fs=require('node:fs'),path=require('node:path'),{workerData}=require('node:worker_threads');
const {assertSyntheticFixture}=require('./server-loop-probe');
const {control:controlBuffer,records:recordBuffer,capacity,pid,atMs,intervalMs,reportFromMs}=workerData;
const control=new Int32Array(controlBuffer),records=new Float64Array(recordBuffer);
let fd,recorded=0,maxGapMs=0;
function emit(value){
  const bytes=Buffer.from(JSON.stringify({pid,...value})+'\n');
  for(let offset=0;offset<bytes.length;)offset+=fs.writeSync(fd,bytes,offset,bytes.length-offset);
}
try{
  const root=assertSyntheticFixture(workerData.fixtureRoot);
  fd=fs.openSync(path.join(root,`event-loop-probe-${pid}.jsonl`),'wx');
  emit({kind:'start',atMs,intervalMs,reportFromMs,clock:'monotonic elapsed mapped to epoch',transport:'shared-ring-worker',capacity});
  Atomics.store(control,3,1);Atomics.notify(control,3);
  for(;;){
    let consumed=Atomics.load(control,1),published=Atomics.load(control,0);
    while(consumed<published){
      const offset=(consumed%capacity)*4,gapMs=records[offset+2];
      emit({kind:'gap',fromMs:records[offset],toMs:records[offset+1],gapMs,delayMs:records[offset+3]});
      recorded++;maxGapMs=Math.max(maxGapMs,gapMs);consumed++;Atomics.store(control,1,consumed);
    }
    if(Atomics.load(control,6))throw Error('Event-loop observer ring overflow');
    if(Atomics.load(control,2)&&consumed===Atomics.load(control,0))break;
    Atomics.wait(control,0,published,25);
  }
  emit({kind:'stop',atMs:Date.now(),recorded,maxGapMs});
}catch(error){
  Atomics.store(control,5,1);
  if(fd!==undefined){try{emit({kind:'error',code:'OBSERVER_WRITER_FAILED'});}catch(_){}}
}finally{
  if(fd!==undefined)fs.closeSync(fd);
  Atomics.store(control,3,1);Atomics.notify(control,3);Atomics.store(control,4,1);Atomics.notify(control,4);
}
