'use strict';
/* Doğrudan CP açılışı (/?module=cp) başlangıç kapısı.
   Hesaplanmış sütunlar ısınırken (computed-warming) CP satırları eski yoldan
   "Hesaplanıyor…" hücreleriyle çizilir (cpComputed.pendingView). Bu yol karar
   motorunu (BLPerf feature 'cpAssistant') hiç istemiyordu: motor yokken
   scheduleUnifiedPrioritiesForTable hemen false döner, başlangıç kapısı da
   'initial-screen-failed' ile düşüp bl:primary-screen-ready hiç yayınlanmıyordu.
   - Bekleyen görünüm, görünür CP'nin kendi karar motorunu ister (tembel yükleme
     sözleşmesi: yalnız görünür modül, yükleme durumu çizilmez);
   - satırlar bekleyen görünümde çizildiyse açılış ekranı hazırdır; öncelikler
     arka planda tamamlanır ve 'cp' durumu 'ready' olur. */
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {loadAppMainFunctions,extractFunction}=require('./helpers/app-main-functions');
const SOURCE=fs.readFileSync(path.join(__dirname,'..','public','app-main.js'),'utf8');

function harness({assistant=null,viewNeedsComputed=false}={}){
  const calls={ensure:0,schedule:0,loading:0,render:0,invalidate:[]};let feature=Promise.resolve();
  const win={BLCpAssistant:assistant,BLModulePreparation:{setStatus(){}},
    BLPerf:{ensureFeature(name){calls.ensure++;calls.feature=name;feature=Promise.resolve().then(()=>{win.BLCpAssistant={computeDecisionsForRowsAsync(){}};});return feature;}}};
  const ctx=loadAppMainFunctions(['cpPrioritiesReadyForRender'],{
    window:win,
    cpComputed:{pendingView:false},
    _unifiedPriorityFeaturePromise:null,
    cpComputedPending:()=>true,
    cpViewNeedsComputed:()=>viewNeedsComputed,
    scheduleUnifiedPrioritiesForTable(){calls.schedule++;return Promise.resolve(false);},
    ensureUnifiedPrioritiesForTable(){calls.loading++;return false;},
    invalidateUnifiedPriorityDecisions(reason){calls.invalidate.push(reason);},
    currentActiveTab:()=>'cp',
    renderCP(){calls.render++;},renderOrders(){},showToast(){},
  });
  return {ctx,calls,settled:()=>feature.then(()=>new Promise(resolve=>setImmediate(resolve)))};
}

test('pending CP view requests the visible module decision engine when it is not loaded yet',async()=>{
  const {ctx,calls,settled}=harness();
  assert.equal(ctx.cpPrioritiesReadyForRender(),true,'rows are drawn with pending cells');
  assert.equal(calls.feature,'cpAssistant');
  assert.equal(calls.ensure,1);
  assert.equal(calls.loading,0,'no loading state replaces the drawn rows');
  assert.equal(calls.schedule,0,'without the engine nothing is scheduled yet');
  await settled();
  assert.equal(calls.schedule,1,'priorities are scheduled once the engine is ready');
  assert.equal(calls.render,0,'the already drawn rows are not redrawn for the engine');
  assert.deepEqual(calls.invalidate,[]);
});

test('pending CP view with a loaded engine schedules priorities without reloading the feature',()=>{
  const {ctx,calls}=harness({assistant:{computeDecisionsForRowsAsync(){}}});
  assert.equal(ctx.cpPrioritiesReadyForRender(),true);
  assert.equal(calls.schedule,1);
  assert.equal(calls.ensure,0);
});

test('a view that depends on computed values keeps the existing loading path',()=>{
  const {ctx,calls}=harness({viewNeedsComputed:true});
  assert.equal(ctx.cpPrioritiesReadyForRender(),false);
  assert.equal(calls.loading,1);
});

test('startup gate treats CP rows drawn in the pending view as the ready primary screen',()=>{
  const gate=extractFunction(SOURCE,'waitForStartupPrimaryScreen');
  const cp=gate.slice(gate.indexOf("if(tab==='cp'){"),gate.indexOf("if(tab==='orders'"));
  const render=cp.indexOf('renderCP();'),pending=cp.indexOf('cpComputed.pendingView'),loop=cp.indexOf('for(let attempt=0');
  assert.ok(render>=0&&pending>render&&loop>pending,'pending-view check runs after the render and before the priority wait loop');
  assert.match(cp,/if\(cpComputed\.pendingView&&document\.querySelector\('#cpTable tbody tr\[data-id\]'\)\)return true;/);
  // Kapı hiçbir modül için karar motorunu ayrıca beklemez; motoru görünür CP'nin çizim yolu ister.
  assert.doesNotMatch(gate,/ensureFeature/);
  assert.match(cp,/setStatus\('cp','error','CP_PREPARATION_FAILED'\)/);
});
