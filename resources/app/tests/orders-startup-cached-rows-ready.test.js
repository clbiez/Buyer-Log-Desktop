'use strict';
/* Doğrudan Siparişler açılışı (okuma modeli açık) başlangıç kapısı.
   İlk pencere (bl:orders-rows-visible) waitForOrdersReadModelRows dinleyiciyi
   eklemeden önce çizilebiliyor. Bekleyicinin çağırdığı renderOrders() aynı imza
   için önbellekten yeniden çizer ve olay yaymaz: kapı 15 sn zaman aşımını bekliyordu
   (ADR-0003 §6A.5b, primaryScreenReadyMs ≈ 17 sn).
   - Satırlar güncel sorgu için zaten çiziliyse bekleyici hemen çözülür;
   - imza değiştiyse (yeni sorgu uçuşta) eski satırlar hazır sayılmaz, yeni pencere beklenir. */
const test=require('node:test'),assert=require('node:assert/strict');
const {loadAppMainFunctions}=require('./helpers/app-main-functions');

function harness(){
  const timers=[];const posts=[];let signature='sig-a';
  const win=new EventTarget();
  const table={};
  const ordersRM={epoch:0,seq:0,signature:'',spec:null,rows:null,total:0,generation:'',windows:new Set(),
    pending:new Map(),wanted:new Set(),facets:null,facetsKey:'',facetsSeq:0,columnFacets:new Map(),materialized:null,legacyReason:'',paintedSeq:0};
  const ctx=loadAppMainFunctions(['renderOrdersFromReadModel','waitForOrdersReadModelRows','ordersRecordRowsVisible','ordersRMResetStore'],{
    window:win,CustomEvent,performance,ordersRM,state:{orders:null},ORDERS_RM_WINDOW:200,appLang:'tr',
    document:{getElementById:id=>id==='ordersTable'?table:null},
    setTimeout(fn,ms){timers.push({fn,ms});return timers.length;},clearTimeout(){},
    applyCoreAutoFilterState(){},ordersReadModelSpec:()=>({ok:true}),ordersRMHideSearchFeedback(){},
    ordersRMSignature:()=>signature,ordersRMRequestFacets(){},setOrdersLoadingState(){},showToast(){},
    ordersRMQueryBody:()=>({}),ordersRMPlaceholder:index=>({_rmPending:true,_rmIndex:index}),
    ordersRMPlace(){},ordersRMDecorate:rows=>rows,currentActiveTab:()=>'orders',_deferredTabRenders:new Set(),
    ordersRMPaintTable(){table._blRenderedRowsSource=ordersRM.rows;},
    ordersRMPost(url){let respond;const p=new Promise(r=>{respond=r;});posts.push({url,respond});return p;},
  });
  ctx.context.renderOrders=()=>ctx.renderOrdersFromReadModel();
  return {ctx,ordersRM,timers,posts,setSignature(v){signature=v;}};
}

const flush=()=>new Promise(resolve=>setImmediate(resolve));
async function settledWithoutTimers(promise){
  let value='pending';promise.then(v=>{value=v;});
  await flush();return value;
}

async function paintFirstWindow(h){
  assert.equal(h.ctx.renderOrdersFromReadModel(),true);
  h.posts.shift().respond({generation:'g1',result:{total:3,rows:[]}});
  await flush();
  assert.ok(h.ordersRM.rows,'first window painted before the startup gate listens');
}

test('rows painted before the startup gate listens resolve the wait without the 15 s timeout',async()=>{
  const h=harness();
  await paintFirstWindow(h);
  const result=await settledWithoutTimers(h.ctx.waitForOrdersReadModelRows());
  assert.equal(result,true,'cached repaint of the visible rows counts as ready');
  assert.equal(h.posts.length,0,'no new query for the unchanged signature');
  assert.equal(h.timers.filter(t=>t.ms===15000).length,0,'no 15 s fallback timer is armed');
});

test('a changed query does not count stale rows as ready and resolves on the new window',async()=>{
  const h=harness();
  await paintFirstWindow(h);
  h.setSignature('sig-b');
  const wait=h.ctx.waitForOrdersReadModelRows();
  assert.equal(await settledWithoutTimers(wait),'pending','stale rows of the previous query are not the ready screen');
  assert.equal(h.posts.length,1,'the new query is in flight');
  h.posts.shift().respond({generation:'g1',result:{total:2,rows:[]}});
  assert.equal(await settledWithoutTimers(wait),true,'resolves on bl:orders-rows-visible of the new window');
});

test('without any visible rows the 15 s fallback still applies',async()=>{
  const h=harness();
  const wait=h.ctx.waitForOrdersReadModelRows();
  assert.equal(await settledWithoutTimers(wait),'pending');
  const fallback=h.timers.find(t=>t.ms===15000);
  assert.ok(fallback,'fallback timer armed while the first query is in flight');
  fallback.fn();
  assert.equal(await settledWithoutTimers(wait),false,'no rows → not ready');
});
