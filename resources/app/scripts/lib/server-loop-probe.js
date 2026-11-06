'use strict';
// Yalnız benchmark: ürün sunucusu bu modülü normal açılışta yüklemez.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {performance}=require('node:perf_hooks'),{isMainThread}=require('node:worker_threads');
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
  const fd=fs.openSync(file,'wx'),startedMono=performance.now(),startedEpoch=Date.now();
  let previous=startedMono,closed=false,recorded=0,maxGapMs=0;
  const epoch=mono=>startedEpoch+mono-startedMono;
  // Seyrek, küçük kayıtlar senkron yazılır: SIGTERM dahil kuyrukta kayıp örnek
  // bırakılmaz. Bu gözlem maliyeti iki kolda da vardır; tüm 10ms tick'ler yazılmaz.
  function emit(event){
    const bytes=Buffer.from(JSON.stringify({pid:process.pid,...event})+'\n');
    for(let offset=0;offset<bytes.length;)offset+=fs.writeSync(fd,bytes,offset,bytes.length-offset);
  }
  emit({kind:'start',atMs:startedEpoch,intervalMs:INTERVAL_MS,reportFromMs:REPORT_FROM_MS,clock:'monotonic elapsed mapped to epoch'});
  const timer=setInterval(()=>{
    const now=performance.now(),gapMs=now-previous;
    if(gapMs>=REPORT_FROM_MS){recorded++;maxGapMs=Math.max(maxGapMs,gapMs);emit({kind:'gap',fromMs:epoch(previous),toMs:epoch(now),gapMs,delayMs:Math.max(0,gapMs-INTERVAL_MS)});}
    previous=now;
  },INTERVAL_MS);timer.unref();
  const stop=()=>{if(closed)return;closed=true;clearInterval(timer);emit({kind:'stop',atMs:epoch(performance.now()),recorded,maxGapMs});fs.closeSync(fd);process.removeListener('exit',stop);};
  process.once('exit',stop);
  return {file,stop};
}
function readProbeEvents(root){
  const events=[];
  for(const name of fs.readdirSync(root).filter(name=>/^event-loop-probe-\d+\.jsonl$/.test(name)).sort()){
    const lines=fs.readFileSync(path.join(root,name),'utf8').split('\n');lines.pop(); // Son satır yazılıyor olabilir.
    for(const line of lines){
      let value;try{value=JSON.parse(line);}catch(_){throw Error('Invalid event-loop probe record: '+name);}
      if(!['start','gap','stop'].includes(value.kind)||!Number.isSafeInteger(value.pid)||value.pid<1)throw Error('Invalid event-loop probe record: '+name);
      if(value.kind==='gap'&&(![value.fromMs,value.toMs,value.gapMs,value.delayMs].every(Number.isFinite)||value.toMs<value.fromMs||value.gapMs<0||Math.abs(value.toMs-value.fromMs-value.gapMs)>.01))throw Error('Invalid event-loop gap record: '+name);
      events.push(value);
    }
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
module.exports={startLoopProbe,readProbeEvents,summarizeGaps};
// Fork edilen parser süreçleri execArgv/env miras alsa da sunucu lag'ına girmez.
if(isMainThread&&process.env.BUYER_LOG_BENCHMARK_LOOP_ROOT&&path.resolve(process.argv[1]||'').endsWith(path.join('server','server.js')))
  startLoopProbe({fixtureRoot:process.env.BUYER_LOG_BENCHMARK_LOOP_ROOT});
