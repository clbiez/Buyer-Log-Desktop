'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm');
const {installFirstTransitionProbe,validateFirstTransition}=require('../scripts/lib/first-transition-probe');
function harness({denied=false,covered=false,timeoutMs=2000}={}){
  let now=100,shown=false;const timers=[],frames=[],listeners=new Map(),holds=[];
  const content={getClientRects:()=>shown?[{}]:[]};
  const row={getBoundingClientRect:()=>({left:216,right:1400,top:200,bottom:240}),contains:node=>node===row};
  const document={body:{dataset:{activeTab:'overview'}},getElementById:()=>content,querySelector:()=>row,querySelectorAll:selector=>selector==='.blTriviaHold'?holds:[row],elementFromPoint:()=>covered?content:row};
  const window={innerWidth:1440,innerHeight:900,getComputedStyle:()=>({visibility:'visible',opacity:'1'}),addEventListener:(type,fn)=>listeners.set(type,fn),BLCanAccessArea:()=>!denied};
  const context={window,document,state:{cp:null,orders:null},performance:{now:()=>now},setTimeout:fn=>timers.push(fn),requestAnimationFrame:fn=>frames.push(fn),
    switchTab:module=>{if(denied)return false;document.body.dataset.activeTab=module;context.state[module]={rows:[1,2,3]};}};
  vm.runInNewContext('('+installFirstTransitionProbe.toString()+')('+JSON.stringify({module:'cp',expectedRows:3,timeoutMs})+')',context);
  return {window,timers,frames,setTime:value=>{now=value;},show:()=>{shown=true;},setCovered:value=>{covered=value;},
    addHold:()=>{const hold={dataset:{},getClientRects:()=>[{}]};const button={getClientRects:()=>[{}],click:()=>{hold.dataset.leaving='1';}};hold.querySelector=()=>button;holds.push(hold);},clearHold:()=>{holds.length=0;},complete:()=>listeners.get('bl:startup-complete')()};
}
test('first intent includes handler dispatch delay and waits for actual visible rows and paint',()=>{
  const h=harness();h.complete();h.setTime(500);h.timers.shift()();
  assert.equal(h.window.__benchmarkFirstTransition.dispatchDelayMs,400);
  assert.equal(h.frames.length,0,'old or hidden row DOM cannot satisfy readiness');
  h.show();h.setTime(600);h.timers.shift()();h.frames.shift()();h.setTime(620);h.frames.shift()();
  for(let at=640;at<=1620;at+=20){h.setTime(at);h.timers.shift()();}
  const r=h.window.__benchmarkFirstTransition;
  assert.equal(r.status,'passed');assert.equal(r.firstRowsPaintedMs,520);assert.equal(r.elapsedMs,520);
  assert.equal(r.observationEndMs,1520,'the fixed observation does not inflate measured transition latency');
  assert.equal(r.canAccess,true);assert.equal(r.rows,3);assert.equal(r.domRows,1);
});

test('row DOM behind an overlay cannot satisfy first visible paint',()=>{
  const h=harness({covered:true});h.show();h.complete();h.timers.shift()();
  assert.equal(h.frames.length,0,'a covered row is not visible even when its container has a rectangle');
  assert.notEqual(h.window.__benchmarkFirstTransition.status,'passed');
  h.setCovered(false);h.setTime(120);h.timers.shift()();
  assert.equal(h.frames.length,1,'the real row becomes eligible once the cover leaves');
});

test('a blocked timer turn cannot skip late trivia settlement and certify the covered screen',()=>{
  const h=harness({timeoutMs:4000});h.show();h.complete();h.timers.shift()();
  h.setTime(116);h.frames.shift()();h.setTime(132);h.frames.shift()();
  // The poll was due before the application's delayed loading-state check.
  // A long task lets the poll run first after >1s of wall time, with the
  // real hold still waiting for its 300ms-check + 400ms-settle callbacks.
  h.setTime(1300);h.timers.shift()();
  assert.notEqual(h.window.__benchmarkFirstTransition.status,'passed','elapsed blocked time is not an observed stable screen');
  h.addHold();h.setTime(1320);h.timers.shift()();
  assert.equal(h.window.__benchmarkFirstTransition.moduleContinueCount,1);
  h.clearHold();h.setTime(1340);h.timers.shift()();
  h.setTime(1356);h.frames.shift()();h.setTime(1372);h.frames.shift()();
  for(let at=1392;at<=2372;at+=20){h.setTime(at);h.timers.shift()();}
  const result=h.window.__benchmarkFirstTransition;
  assert.equal(result.status,'passed');assert.equal(result.firstRowsPaintedMs,32);
  assert.equal(result.elapsedMs,1272,'the last real post-hold paint determines usable readiness');
});
test('a denied first transition fails instead of reporting a ready previous screen',()=>{
  const h=harness({denied:true});h.complete();h.timers.shift()();
  assert.equal(h.window.__benchmarkFirstTransition.status,'failed');
  assert.match(h.window.__benchmarkFirstTransition.error,/denied/);assert.equal(h.frames.length,0);
});
test('an unready first transition has a bounded failure with partial evidence',()=>{
  const h=harness();h.complete();h.timers.shift()();h.setTime(2201);h.timers.shift()();
  assert.equal(h.window.__benchmarkFirstTransition.status,'failed');
  assert.match(h.window.__benchmarkFirstTransition.error,/timed out/);
  assert.equal(h.window.__benchmarkFirstTransition.module,'cp');
});

test('metadata-only startup is compared with its envelope while actual projection identity remains mandatory',()=>{
  const expected={rows:{cp:3},generation:'g-1',revisions:{orders:2,suppFob:3}};
  const result={module:'cp',status:'passed',rows:3,canAccess:true,domRows:1,errors:[],initialGeneration:null,projectionGenerations:['g-1'],revisions:{orders:2,suppFob:3},visibilityProbeVersion:2,rowVisibilityVerified:true};
  assert.doesNotThrow(()=>validateFirstTransition(result,expected,null));
  for(const patch of [{projectionGenerations:[]},{projectionGenerations:['g-2']},{rows:2},{revisions:{orders:1,suppFob:3}},{domRows:0},{initialGeneration:'unexpected'},{visibilityProbeVersion:1},{rowVisibilityVerified:false}]){
    assert.throws(()=>validateFirstTransition({...result,...patch},expected,null));
  }
});
