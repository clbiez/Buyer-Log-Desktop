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
