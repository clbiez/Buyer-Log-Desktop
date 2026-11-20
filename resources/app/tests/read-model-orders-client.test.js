'use strict';
/* WS3 (#1076): pencereli Siparişler istemci sözleşmeleri.
   - Hücre aralığı kopyası (Ctrl+C) sayfalı görünümde sayfa dilimini okur: aralıktaki
     boş satırlar depodan yüklenip AYNI dizide yerine konmalı (yoksa boş hücre kopyalanır).
   - grid-clipboard pencereli veri sağlayıcısı: prepareRange, matris kurulmadan önce
     beklenir ve tarayıcının kendi kopyası beklemeden önce durdurulur.
   - Anahtar kapalıyken (varsayılan) renderOrdersNow eski yola gider. */
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {extractFunction}=require('./helpers/app-main-functions');
const SOURCE=fs.readFileSync(path.join(__dirname,'..','public','app-main.js'),'utf8');

function loadPrepareRange(store,ensureCalls){
  const context=vm.createContext({Math,Array});
  vm.runInContext(`${extractFunction(SOURCE,'ordersRMPrepareRange')}
    var ordersRM=__store;function ordersRMWindowedActive(){return true;}
    async function ordersRMEnsureRange(start,end){__calls.push([start,end]);for(let i=start;i<end;i++)ordersRM.rows[i]={_id:i,loaded:true};return true;}`,
  Object.assign(context,{__store:store,__calls:ensureCalls}));
  return context.ordersRMPrepareRange;
}

test('paged copy: pending rows in the rendered page slice are loaded and replaced in place',async()=>{
  const pending=index=>({_rmPending:true,_rmIndex:index});
  const store={rows:Array.from({length:600},(_,i)=>i<200?{_id:i,loaded:true}:pending(i))};
  // Sayfa 5 (50'lik): depo 250..299, dilim indeksleri 0..49.
  const page=store.rows.slice(250,300);
  const calls=[];
  const prepare=loadPrepareRange(store,calls);
  assert.equal(await prepare({startRow:10,endRow:19},page),true);
  assert.deepEqual(JSON.parse(JSON.stringify(calls)),[[260,270]]);
  assert.deepEqual(page.slice(10,20).map(row=>row._id),[260,261,262,263,264,265,266,267,268,269]);
  assert.ok(page[9]._rmPending&&page[20]._rmPending,'only the copied range is loaded');
  // Yüklü aralık yeniden istenmez.
  assert.equal(await prepare({startRow:10,endRow:19},page),true);
  assert.equal(calls.length,1);
});

test('grid-clipboard awaits the windowed provider before building the matrix and stops native copy first',()=>{
  const src=fs.readFileSync(path.join(__dirname,'..','public','grid-clipboard.js'),'utf8');
  const body=src.slice(src.indexOf('async function copyEntry('),src.indexOf('function parseClipboardText('));
  const prevent=body.indexOf('event?.preventDefault?.()'),prepare=body.indexOf('await entry.config.prepareRange('),build=body.indexOf('buildMatrix(');
  assert.ok(prevent>0&&prepare>prevent&&build>prepare,'preventDefault → await prepareRange → buildMatrix');
  assert.match(SOURCE,/prepareRange:\(range,rows\)=>ordersRMPrepareRange\(range,rows\)/);
});

test('flag on by default (#1071 WS7); \'0\' / window=false roll back to the legacy renderOrdersNow path',()=>{
  const flag=extractFunction(SOURCE,'ordersReadModelEnabled');
  const key=/^const ORDERS_RM_STORAGE_KEY=.*$/m.exec(SOURCE)[0];
  const run=(storage,override)=>vm.runInNewContext(`${key}\nlet ordersRMEnabledCache=null;\n${flag};ordersReadModelEnabled()`,{window:{...(override===undefined?{}:{BL_ORDERS_READ_MODEL:override}),BLStorage:{getItem:key=>storage[key]??null}},localStorage:{getItem:()=>null}});
  assert.equal(run({}),true,'default ON');
  assert.equal(run({'bl.ordersReadModel.v1':'1'}),true);
  assert.equal(run({'bl.ordersReadModel.v1':'0'}),false,'per-user rollback');
  assert.equal(run({'bl.ordersReadModel.v1':'1'},false),false,'window rollback');
  assert.equal(run({},false),false);
  // Yönlendirici: anahtar kapalıyken doğrudan eski renderOrdersNow.
  const route=extractFunction(SOURCE,'renderOrdersRoute');
  assert.match(route,/if\(!ordersReadModelEnabled\(\)\)return renderOrdersNow\(\);/);
  assert.match(SOURCE,/DEFERRED_TAB_RENDERERS=\{cp:'renderCPNow',orders:'renderOrdersRoute'/);
  // Eski yolun gövdesi korunur: kapsam hesabı + tam tablo.
  const render=extractFunction(SOURCE,'renderOrdersNow');
  assert.match(render,/^function renderOrdersNow\(\)\{\s*if\(!state.orders\)return;/);
  assert.match(render,/const scope=ordersEvaluateAll\(\);/);
});

/* Codex #1086 bulguları için regresyonlar. */
test('paged view: a pending row requests the window of its store index, not its page position',()=>{
  const paint=extractFunction(SOURCE,'ordersRMPaintTable');
  assert.match(paint,/rowClassFn:row=>\{if\(row&&row\._rmPending\)\{ordersRMNeedRow\(row\._rmIndex\);/);
  assert.doesNotMatch(paint,/ordersRMNeedRow\(rowIdx\)/);
  const requested=[];
  const context=vm.createContext({queueMicrotask:fn=>fn(),Set,Math});
  vm.runInContext(`${/^const ORDERS_RM_WINDOW=.*$/m.exec(SOURCE)[0]}\n${/^const ORDERS_RM_PREFETCH=.*$/m.exec(SOURCE)[0]}
    var ordersRM={wanted:new Set(),flushQueued:false};function ordersRMEnsureWindow(i){__requested.push(i);}\n${extractFunction(SOURCE,'ordersRMNeedRow')}`,
  Object.assign(context,{__requested:requested}));
  context.ordersRMNeedRow(650); // 50'lik sayfa 14'ün ilk satırı
  assert.ok(requested.includes(3),JSON.stringify(requested));
});

test('every query transition supersedes in-flight window and count requests',()=>{
  const render=extractFunction(SOURCE,'renderOrdersFromReadModel');
  assert.match(render,/const supersede=\(\)=>\{ordersRM\.seq\+\+;ordersRM\.facetsSeq\+\+;\};/);
  // eski yola düşüş, sunucunun reddettiği imza ve önbellekten çizim
  assert.match(render,/if\(!spec\.ok\)\{supersede\(\);/);
  assert.match(render,/if\(signature===ordersRM\.unsupportedSignature\)\{supersede\(\);/);
  assert.match(render,/if\(signature===ordersRM\.signature&&ordersRM\.rows\)\{\s*supersede\(\);/);
  assert.match(extractFunction(SOURCE,'ordersRMInvalidate'),/ordersRM\.seq\+\+;ordersRM\.facetsSeq\+\+;ordersRM\.signature='';/);
});

test('Orders load, server hydration and deferred refresh invalidate the windowed result and re-query',()=>{
  const reasons=/const ORDERS_RM_DATA_REASONS=new Set\((\[[^\]]*\])\)/.exec(SOURCE);
  assert.ok(reasons,'reason set');
  assert.deepEqual(JSON.parse(reasons[1].replace(/'/g,'"')),['orders-projection-loaded','server-orders-hydrated','server-orders-deferred']);
  // Bu nedenler gerçekten yayınlanıyor.
  for(const reason of ['orders-projection-loaded','server-orders-hydrated','server-orders-deferred'])
    assert.match(SOURCE,new RegExp(`invalidateUnifiedPriorityDecisions\\('${reason}'`));
  const at=SOURCE.indexOf('const ORDERS_RM_DATA_REASONS'),listener=SOURCE.slice(at,SOURCE.indexOf('\n});',at));
  assert.match(listener,/ordersRMInvalidate\(reason\);/);
  assert.match(listener,/renderOrders\(\)/);
});

test('totals footer: precomputed server totals are used; pending totals are never summed from placeholders',()=>{
  const fns=['renderQuantityTotalsFooter','isQuantityLikeColumn','formatQuantityTotal','selectionFooterCellHtml','tableVisibleSelectedCount','tableNumericValue','normalizeDecimalText','selectionHasId','selectionIdKey'];
  const context=vm.createContext({appLang:'tr',escapeHtml:v=>String(v),kolAverageFooter:(w,a,label)=>`<td>${label}:${w}/${a}</td>`,
    kolWeightedAverage:()=>{throw Error('must not average placeholders');},kolArithmeticAverage:()=>{throw Error('must not average placeholders');}});
  vm.runInContext(fns.map(name=>extractFunction(SOURCE,name)).join('\n'),context);
  const table={tFoot:null,createTFoot(){this.tFoot={innerHTML:'',remove(){}};return this.tFoot;}};
  const cols=[{k:'Order Code'},{k:'Order Quantity'},{k:'FOB ($)'}];
  // Map vm realm'inde kurulur (renderQuantityTotalsFooter `instanceof Map` denetler).
  const averageCols=vm.runInContext(`new Map([['FOB ($)',{label:'FOB',getQty:r=>r['Order Quantity']}]])`,context);
  const placeholders=[{_rmPending:true},{_rmPending:true}];
  context.renderQuantityTotalsFooter(table,placeholders,cols,{withCheck:true,selectedSet:new Set(['1']),averageCols,precomputed:null});
  assert.equal((table.tFoot.innerHTML.match(/aria-busy="true"/g)||[]).length,3,'selection + quantity + FOB cells pending');
  assert.match(table.tFoot.innerHTML,/Toplamlar yükleniyor/);
  context.renderQuantityTotalsFooter(table,placeholders,cols,{withCheck:true,selectedSet:new Set(['1']),averageCols,
    precomputed:{sums:{'Order Quantity':10000},averages:{'FOB ($)':{weighted:2.5,arithmetic:3}},selectedCount:7}});
  assert.match(table.tFoot.innerHTML,/10\.000/);
  assert.match(table.tFoot.innerHTML,/FOB:2\.5\/3/);
  assert.match(table.tFoot.innerHTML,/selectionFooterNumber">7</);
});
