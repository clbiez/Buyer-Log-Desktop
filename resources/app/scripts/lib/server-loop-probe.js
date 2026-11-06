'use strict';
// Yalnız benchmark: ürün sunucusu bu modülü normal açılışta yüklemez.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {performance}=require('node:perf_hooks'),{isMainThread,Worker}=require('node:worker_threads');
const INTERVAL_MS=10,REPORT_FROM_MS=20;
function assertSyntheticFixture(value){
  const root=path.resolve(String(value||''));
  if(path.dirname(root)!==path.resolve(os.tmpdir())||!path.basename(root).startsWith('buyerlog-startup-'))throw Error('Synthetic fixture directly under temp required');
  if(fs.lstatSync(root).isSymbolicLink()||fs.realpathSync(root)!==root)throw Error('Linked/symbolic fixture refused');
  const source=path.join(root,'source'),file=path.join(source,'benchmark-fixture.json');
  if(fs.lstatSync(source).isSymbolicLink()||fs.realpathSync(source)!==source||fs.lstatSync(file).isSymbolicLink())throw Error('Linked/symbolic fixture refused');
  if(fs.statSync(file).size>65536)throw Error('Synthetic fixture marker too large');
  const marker=JSON.parse(fs.readFileSync(file,'utf8'));
  if(marker.synthetic!==true||!Number.isSafeInteger(marker.rows)||marker.rows<1)throw Error('Synthetic fixture marker required');
  return root;
}
function startLoopProbe({fixtureRoot}={}){
  const root=assertSyntheticFixture(fixtureRoot),file=path.join(root,`event-loop-probe-${process.pid}.jsonl`);
  const capacity=8192,control=new Int32Array(new SharedArrayBuffer(8*Int32Array.BYTES_PER_ELEMENT));
  const records=new Float64Array(new SharedArrayBuffer(capacity*4*Float64Array.BYTES_PER_ELEMENT));
  // Ana thread yalnız önceden ayrılmış halkaya sayıları yazar. JSON/UTF-8 ve
  // dosya I/O'su ölçülen event loop'a ait değildir. Taşma sessizce atlanmaz.
  const writer=new Worker(path.join(__dirname,'server-loop-probe-writer.js'),{execArgv:[],resourceLimits:{maxOldGenerationSizeMb:64},
    workerData:{fixtureRoot:root,pid:process.pid,atMs:Date.now(),intervalMs:INTERVAL_MS,reportFromMs:REPORT_FROM_MS,capacity,control:control.buffer,records:records.buffer}});
  writer.on('error',()=>{Atomics.store(control,5,1);});writer.unref();
  Atomics.wait(control,3,0,5000);
  if(!Atomics.load(control,3)||Atomics.load(control,5)){void writer.terminate();throw Error('Event-loop observer writer failed to start');}
  let previous=performance.now(),closed=false;const signalHandlers=new Map();
  const timer=setInterval(()=>{
    const now=performance.now(),gapMs=now-previous;
    if(gapMs>=REPORT_FROM_MS){
      const published=Atomics.load(control,0),consumed=Atomics.load(control,1);
      if(published-consumed>=capacity)Atomics.store(control,6,1);
      else{
        const offset=(published%capacity)*4;
        records[offset]=performance.timeOrigin+previous;records[offset+1]=performance.timeOrigin+now;records[offset+2]=gapMs;records[offset+3]=Math.max(0,gapMs-INTERVAL_MS);
        Atomics.store(control,0,published+1);
      }
    }
    previous=now;
  },INTERVAL_MS);timer.unref();
  const stop=()=>{
    if(closed)return;closed=true;clearInterval(timer);process.removeListener('exit',stop);
    for(const [signal,handler] of signalHandlers)process.removeListener(signal,handler);
    Atomics.store(control,2,1);Atomics.notify(control,0);Atomics.wait(control,4,0,5000);
    if(!Atomics.load(control,4)||Atomics.load(control,5)||Atomics.load(control,6))throw Error('Event-loop observer writer failed or overflowed');
  };
  process.once('exit',stop);
  for(const signal of ['SIGTERM','SIGINT']){
    const handler=()=>{
      stop();process.removeListener(signal,handler);
      // Eski karşılaştırma sunucusunun kendi shutdown handler'ı olmayabilir.
      // Gözlemci varsayılan sinyal davranışını değiştirmez, önce kuyruğu boşaltır.
      // libuv eski sinyal watcher'ını bu tur sonunda kapatır. Aynı callback'te
      // yeniden sinyal göndermek varsayılan çıkışı yutabilir.
      if(process.listenerCount(signal)===0)setTimeout(()=>process.kill(process.pid,signal),0);
    };
    signalHandlers.set(signal,handler);process.prependListener(signal,handler);
  }
  return {file,stop};
}
function readProbeEvents(root,{requireStopped=false}={}){
  const events=[];
  for(const name of fs.readdirSync(root).filter(name=>/^event-loop-probe-\d+\.jsonl$/.test(name)).sort()){
    const lines=fs.readFileSync(path.join(root,name),'utf8').split('\n');lines.pop(); // Son satır yazılıyor olabilir.
    let started=false,stopped=false;
    for(const line of lines){
      let value;try{value=JSON.parse(line);}catch(_){throw Error('Invalid event-loop probe record: '+name);}
      if(!['start','gap','stop'].includes(value.kind)||!Number.isSafeInteger(value.pid)||value.pid<1)throw Error('Invalid event-loop probe record: '+name);
      if(value.kind==='gap'&&(![value.fromMs,value.toMs,value.gapMs,value.delayMs].every(Number.isFinite)||value.toMs<value.fromMs||value.gapMs<0||Math.abs(value.toMs-value.fromMs-value.gapMs)>.01))throw Error('Invalid event-loop gap record: '+name);
      if(value.kind==='start')started=true;if(value.kind==='stop')stopped=true;
      events.push(value);
    }
    if(requireStopped&&(!started||!stopped))throw Error('Incomplete event-loop observer: missing start or stop record: '+name);
  }
  return events;
}
function summarizeGaps(events,{startMs=-Infinity,endMs=Infinity}={}){
  if(Number.isNaN(startMs)||Number.isNaN(endMs)||endMs<startMs)throw Error('Invalid event-loop observation window');
  const gaps=events.filter(e=>e.kind==='gap'&&e.toMs>=startMs&&e.fromMs<=endMs);
  const maxGapMs=Math.max(0,...gaps.map(e=>e.gapMs));
  return {recordedGaps:gaps.length,maxGapMs,maxDelayMs:Math.max(0,...gaps.map(e=>e.delayMs)),gapsOver200ms:gaps.filter(e=>e.gapMs>200).length,
    maxGapUpperBoundMs:Math.max(REPORT_FROM_MS,maxGapMs),intervalMs:INTERVAL_MS,reportFromMs:REPORT_FROM_MS,boundaryPolicy:'overlapping gap is retained in full; gap includes the normal timer interval'};
}
function observerSha256(){
  const hash=require('node:crypto').createHash('sha256');
  for(const name of ['server-loop-probe.js','server-loop-probe-writer.js'])hash.update(name+'\0').update(fs.readFileSync(path.join(__dirname,name))).update('\0');
  return hash.digest('hex');
}
module.exports={assertSyntheticFixture,startLoopProbe,readProbeEvents,summarizeGaps,observerSha256};
// Fork edilen parser süreçleri execArgv/env miras alsa da sunucu lag'ına girmez.
if(isMainThread&&process.env.BUYER_LOG_BENCHMARK_LOOP_ROOT&&path.resolve(process.argv[1]||'').endsWith(path.join('server','server.js')))
  startLoopProbe({fixtureRoot:process.env.BUYER_LOG_BENCHMARK_LOOP_ROOT});
