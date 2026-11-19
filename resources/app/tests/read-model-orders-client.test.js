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

test('flag off by default: renderOrdersNow takes the legacy path unless the read model is enabled',()=>{
  const flag=extractFunction(SOURCE,'ordersReadModelEnabled');
  const key=/^const ORDERS_RM_STORAGE_KEY=.*$/m.exec(SOURCE)[0];
  const run=(storage,override)=>vm.runInNewContext(`${key}\nlet ordersRMEnabledCache=null;\n${flag};ordersReadModelEnabled()`,{window:{...(override===undefined?{}:{BL_ORDERS_READ_MODEL:override}),BLStorage:{getItem:key=>storage[key]??null}},localStorage:{getItem:()=>null}});
  assert.equal(run({}),false);
  assert.equal(run({'bl.ordersReadModel.v1':'1'}),true);
  assert.equal(run({'bl.ordersReadModel.v1':'1'},false),false);
  const render=extractFunction(SOURCE,'renderOrdersNow');
  assert.match(render,/^function renderOrdersNow\(\)\{\n\s*\/\/[^\n]*\n\s*if\(ordersReadModelEnabled\(\)&&renderOrdersFromReadModel\(\)\)return;/);
  // Eski yolun gövdesi korunur: kapsam hesabı + tam tablo.
  assert.match(render,/const scope=ordersEvaluateAll\(\);/);
});
