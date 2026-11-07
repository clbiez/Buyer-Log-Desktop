'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawnSync}=require('node:child_process');
const probeFile=path.join(__dirname,'../scripts/lib/server-loop-probe.js');
const probe=require(probeFile);
function fixture(){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'buyerlog-startup-loop-test-'));
  fs.mkdirSync(path.join(root,'source'));
  fs.writeFileSync(path.join(root,'source/benchmark-fixture.json'),JSON.stringify({synthetic:true,rows:1}));
  return root;
}
test('loop observer refuses a missing, non-synthetic or linked fixture',()=>{
  const root=fixture();
  try{
    fs.writeFileSync(path.join(root,'source/benchmark-fixture.json'),JSON.stringify({synthetic:false,rows:1}));
    assert.throws(()=>probe.startLoopProbe({fixtureRoot:root}),/synthetic/i);
    assert.throws(()=>probe.startLoopProbe({fixtureRoot:path.join(root,'missing')}),/fixture|ENOENT/i);
    const link=root+'-link';fs.symlinkSync(root,link,'dir');
    try{assert.throws(()=>probe.startLoopProbe({fixtureRoot:link}),/symbolic|linked/i);}finally{fs.unlinkSync(link);}
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('window summaries use the conservative timer gap and retain boundary stalls',()=>{
  const events=[{kind:'gap',pid:1,fromMs:100,toMs:370,gapMs:270,delayMs:260},{kind:'gap',pid:1,fromMs:500,toMs:530,gapMs:30,delayMs:20}];
  const result=probe.summarizeGaps(events,{startMs:200,endMs:400});
  assert.equal(result.gapsOver200ms,1);assert.equal(result.maxGapMs,270);assert.equal(result.maxDelayMs,260);
  assert.equal(probe.summarizeGaps(events,{startMs:400,endMs:550}).gapsOver200ms,0);
  assert.equal(probe.summarizeGaps([],{startMs:0,endMs:1}).maxGapMs,0);
  assert.throws(()=>probe.summarizeGaps(events,{startMs:400,endMs:200}),/window/i);
});
test('complete corrupt records cannot silently become a zero-stall result',()=>{
  const root=fixture();
  try{
    fs.writeFileSync(path.join(root,'event-loop-probe-1.jsonl'),'{bad}\n');
    assert.throws(()=>probe.readProbeEvents(root),/record/i);
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('a real fresh Node process records a 260ms block with the 10ms observer',()=>{
  const root=fixture();
  try{
    const code=`const p=require(${JSON.stringify(probeFile)}).startLoopProbe({fixtureRoot:process.argv[1]});setTimeout(()=>{const until=performance.now()+260;while(performance.now()<until){}setTimeout(()=>{p.stop();},35);},35);`;
    const run=spawnSync(process.execPath,['-e',code,root],{encoding:'utf8',timeout:5000});
    assert.equal(run.status,0,run.stderr);
    const events=probe.readProbeEvents(root),summary=probe.summarizeGaps(events);
    assert.ok(summary.maxGapMs>=250,JSON.stringify(summary));assert.ok(summary.gapsOver200ms>=1);
    assert.equal(events.filter(e=>e.kind==='start').length,1);assert.equal(events.filter(e=>e.kind==='stop').length,1);
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('native observations retain thread CPU and GC without classifying GC records as timer gaps',()=>{
  const root=fixture();
  try{
    const code=`const p=require(${JSON.stringify(probeFile)}).startLoopProbe({fixtureRoot:process.argv[1]});setTimeout(()=>{const until=performance.now()+80;while(performance.now()<until){}global.gc();setTimeout(()=>p.stop(),60);},35);`;
    const run=spawnSync(process.execPath,['--expose-gc','-e',code,root],{encoding:'utf8',timeout:10000});assert.equal(run.status,0,run.stderr);
    const events=probe.readProbeEvents(root,{requireStopped:true}),gap=events.filter(e=>e.kind==='gap').sort((a,b)=>b.gapMs-a.gapMs)[0];
    assert.equal(events[0].cpuScope,process.platform==='linux'?'thread':'unavailable');
    assert.ok(Number.isFinite(gap.userCpuMs)&&gap.userCpuMs>=0);assert.ok(Number.isFinite(gap.systemCpuMs)&&gap.systemCpuMs>=0);
    const gc=events.filter(e=>e.kind==='gc');assert.ok(gc.length>0,'a real explicit GC must be retained');
    assert.ok(gc.every(e=>Number.isFinite(e.durationMs)&&e.durationMs>=0&&e.toMs>=e.fromMs));
    assert.equal(events.at(-1).gcRecords,gc.length);assert.equal(events.at(-1).recorded,events.filter(e=>e.kind==='gap').length);
    const fakeGc={kind:'gc',pid:1,fromMs:0,toMs:500,durationMs:500,gcKind:4,gcFlags:0};
    assert.equal(probe.summarizeGaps([fakeGc]).gapsOver200ms,0);
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('numeric CPU and GC observations preserve strict record validation and avoid memory sampling on MAIN',()=>{
  const root=fixture();
  try{
    for(const event of [{kind:'gc',pid:1,fromMs:10,toMs:5,durationMs:5,gcKind:4,gcFlags:0},{kind:'gap',pid:1,fromMs:0,toMs:100,gapMs:100,delayMs:90,userCpuMs:-1,systemCpuMs:0}]){
      fs.writeFileSync(path.join(root,'event-loop-probe-1.jsonl'),JSON.stringify(event)+'\n');assert.throws(()=>probe.readProbeEvents(root),/record/i);
    }
    assert.doesNotMatch(fs.readFileSync(probeFile,'utf8'),/process\.memoryUsage|Error\(\)\.stack/);
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('CPU observation never calls either CPU counter on the measured thread',()=>{
  const root=fixture();
  try{
    const code=`process.threadCpuUsage=process.cpuUsage=()=>{throw Error('CPU observation must run outside MAIN');};const p=require(${JSON.stringify(probeFile)}).startLoopProbe({fixtureRoot:process.argv[1]});setTimeout(()=>{const until=performance.now()+80;while(performance.now()<until){}setTimeout(()=>p.stop(),130);},35);`;
    const run=spawnSync(process.execPath,['-e',code,root],{encoding:'utf8',timeout:10000});assert.equal(run.status,0,run.stderr);
    const events=probe.readProbeEvents(root,{requireStopped:true});
    const gap=events.filter(e=>e.kind==='gap').sort((a,b)=>b.gapMs-a.gapMs)[0];assert.ok(gap.gapMs>=70);
    assert.equal(gap.cpuApproximate,true);assert.equal(events[0].cpuMeasurement,'surrounding-sample-window');
    if(events[0].cpuScope==='thread'){
      assert.ok(gap.cpuWindowFromMs<=gap.fromMs);assert.ok(gap.cpuWindowToMs>=gap.toMs);assert.ok(gap.cpuClockResolutionMs>0);
    }
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('approximate CPU records must identify a valid surrounding sample window',()=>{
  const root=fixture();
  try{
    const valid={kind:'gap',pid:1,fromMs:100,toMs:200,gapMs:100,delayMs:90,userCpuMs:10,systemCpuMs:0,cpuApproximate:true,cpuAvailable:true,cpuWindowFromMs:90,cpuWindowToMs:210,cpuClockResolutionMs:10};
    for(const patch of [{cpuWindowFromMs:101},{cpuWindowToMs:199},{cpuClockResolutionMs:0},{cpuAvailable:'yes'}]){
      fs.writeFileSync(path.join(root,'event-loop-probe-1.jsonl'),JSON.stringify({...valid,...patch})+'\n');assert.throws(()=>probe.readProbeEvents(root),/record/i);
    }
    fs.writeFileSync(path.join(root,'event-loop-probe-1.jsonl'),JSON.stringify(valid)+'\n');assert.deepEqual(probe.readProbeEvents(root),[valid]);
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('F0 observer is opt-in and server child alone loads the preload',()=>{
  const source=fs.readFileSync(path.join(__dirname,'../scripts/benchmark-startup-orders.js'),'utf8');
  assert.match(source,/--server-loop-probe/);assert.match(source,/--require/);assert.match(source,/server-loop-probe\.js/);
  assert.match(source,/serverLoopProbe/);assert.match(source,/navigationStartedAtMs/);
  assert.match(source,/harnessSha256/);assert.match(source,/observerSha256/);
});
test('non-server Node children inheriting preload and environment do not pollute server gaps',()=>{
  const root=fixture();
  try{
    const run=spawnSync(process.execPath,['--require',probeFile,'-e','void 0'],{encoding:'utf8',timeout:5000,env:{...process.env,BUYER_LOG_BENCHMARK_LOOP_ROOT:root}});
    assert.equal(run.status,0,run.stderr);assert.deepEqual(probe.readProbeEvents(root),[]);
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('recording a real stall does not encode or synchronously write observations on the measured thread',()=>{
  const root=fixture();
  try{
    const code=`const fs=require('node:fs'),p=require(${JSON.stringify(probeFile)}).startLoopProbe({fixtureRoot:process.argv[1]});const write=fs.writeSync,from=Buffer.from;let writes=0,encodes=0;fs.writeSync=function(...args){writes++;return write.apply(this,args);};Buffer.from=function(...args){if(Error().stack.includes('server-loop-probe.js'))encodes++;return from.apply(this,args);};setTimeout(()=>{const until=performance.now()+260;while(performance.now()<until){}setTimeout(()=>{fs.writeSync=write;Buffer.from=from;p.stop();process.stdout.write(JSON.stringify({writes,encodes}));},35);},35);`;
    const run=spawnSync(process.execPath,['-e',code,root],{encoding:'utf8',timeout:5000});assert.equal(run.status,0,run.stderr);
    const counts=JSON.parse(run.stdout);assert.equal(counts.writes,0,'the measured thread must never perform observer disk writes');assert.equal(counts.encodes,0,'observation encoding belongs to the writer');
    const events=probe.readProbeEvents(root,{requireStopped:true});assert.ok(probe.summarizeGaps(events).maxGapMs>=250);assert.equal(events.at(-1).kind,'stop');
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('a completed run cannot accept a writer that never published its stop record',()=>{
  const root=fixture();
  try{
    fs.writeFileSync(path.join(root,'event-loop-probe-1.jsonl'),JSON.stringify({kind:'start',pid:1,atMs:1})+'\n');
    assert.throws(()=>probe.readProbeEvents(root,{requireStopped:true}),/incomplete|stop/i);
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('SIGTERM flushes every observation even when the measured application has no shutdown handler',()=>{
  const root=fixture();
  try{
    // A real HTTP server keeps the loop alive until its signal is delivered.
    const code=`require(${JSON.stringify(probeFile)}).startLoopProbe({fixtureRoot:process.argv[1]});setInterval(()=>{},1000);setTimeout(()=>{const until=performance.now()+260;while(performance.now()<until){}setTimeout(()=>process.kill(process.pid,'SIGTERM'),35);},35);`;
    const run=spawnSync(process.execPath,['-e',code,root],{encoding:'utf8',timeout:5000});assert.equal(run.error,undefined,run.stderr);assert.equal(run.signal,'SIGTERM',run.stderr);
    const events=probe.readProbeEvents(root,{requireStopped:true});assert.equal(events.at(-1).kind,'stop');assert.ok(probe.summarizeGaps(events).maxGapMs>=250);
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('the observer preserves an application-owned asynchronous shutdown handler',()=>{
  const root=fixture();
  try{
    const marker=path.join(root,'application-closed'),code=`const fs=require('fs');require(${JSON.stringify(probeFile)}).startLoopProbe({fixtureRoot:process.argv[1]});setInterval(()=>{},1000);process.once('SIGTERM',()=>setTimeout(()=>{fs.writeFileSync(${JSON.stringify(marker)},'closed');process.exit(0);},35));setTimeout(()=>process.kill(process.pid,'SIGTERM'),35);`;
    const run=spawnSync(process.execPath,['-e',code,root],{encoding:'utf8',timeout:5000});assert.equal(run.error,undefined,run.stderr);assert.equal(run.status,0,run.stderr);
    assert.equal(fs.readFileSync(marker,'utf8'),'closed');assert.equal(probe.readProbeEvents(root,{requireStopped:true}).at(-1).kind,'stop');
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});
