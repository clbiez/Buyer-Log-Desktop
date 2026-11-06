'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm');
const {installFirstTransitionProbe,validateFirstTransition}=require('../scripts/lib/first-transition-probe');
function harness({denied=false}={}){
  let now=100,shown=false;const timers=[],frames=[],listeners=new Map();
  const content={getClientRects:()=>shown?[{}]:[]},row={};
  const document={body:{dataset:{activeTab:'overview'}},getElementById:()=>content,querySelector:()=>row,querySelectorAll:selector=>selector==='.blTriviaHold'?[]:[row]};
  const window={addEventListener:(type,fn)=>listeners.set(type,fn),BLCanAccessArea:()=>!denied};
  const context={window,document,state:{cp:null,orders:null},performance:{now:()=>now},setTimeout:fn=>timers.push(fn),requestAnimationFrame:fn=>frames.push(fn),
    switchTab:module=>{if(denied)return false;document.body.dataset.activeTab=module;context.state[module]={rows:[1,2,3]};}};
  vm.runInNewContext('('+installFirstTransitionProbe.toString()+')({module:"cp",expectedRows:3,timeoutMs:2000})',context);
  return {window,timers,frames,setTime:value=>{now=value;},show:()=>{shown=true;},complete:()=>listeners.get('bl:startup-complete')()};
}
test('first intent includes handler dispatch delay and waits for actual visible rows and paint',()=>{
  const h=harness();h.complete();h.setTime(500);h.timers.shift()();
  assert.equal(h.window.__benchmarkFirstTransition.dispatchDelayMs,400);
  assert.equal(h.frames.length,0,'old or hidden row DOM cannot satisfy readiness');
  h.show();h.setTime(600);h.timers.shift()();h.frames.shift()();h.setTime(620);h.frames.shift()();
  h.setTime(1620);h.timers.shift()();
  const r=h.window.__benchmarkFirstTransition;
  assert.equal(r.status,'passed');assert.equal(r.firstRowsPaintedMs,520);assert.equal(r.elapsedMs,520);
  assert.equal(r.observationEndMs,1520,'the fixed observation does not inflate measured transition latency');
  assert.equal(r.canAccess,true);assert.equal(r.rows,3);assert.equal(r.domRows,1);
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
  const result={module:'cp',status:'passed',rows:3,canAccess:true,domRows:1,errors:[],initialGeneration:null,projectionGenerations:['g-1'],revisions:{orders:2,suppFob:3}};
  assert.doesNotThrow(()=>validateFirstTransition(result,expected,null));
  for(const patch of [{projectionGenerations:[]},{projectionGenerations:['g-2']},{rows:2},{revisions:{orders:1,suppFob:3}},{domRows:0},{initialGeneration:'unexpected'}]){
    assert.throws(()=>validateFirstTransition({...result,...patch},expected,null));
  }
});
