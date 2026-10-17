'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=fs.mkdtempSync(path.join(require('node:os').tmpdir(),'bl-endeksmatik-order-'));
process.env.BUYER_LOG_SERVER_DATA_ROOT=path.join(root,'server');
process.env.BUYER_LOG_DATA_ROOT=path.join(root,'app');
process.env.BUYER_LOG_LOCAL_DATA_ROOT=path.join(root,'local');
const engine=require('../server/lib/endeksmatik'),model=require('../server/lib/endeksmatik-model');
const {buildEndeksmatikWorkbook}=require('./helpers/endeksmatik-fixture');
const APP=fs.readFileSync(path.join(__dirname,'../public/app-main.js'),'utf8');
const HTML=fs.readFileSync(path.join(__dirname,'../public/index.html'),'utf8');
const detail={mmyg:'CUW4',mag:'CU4E',buyingGroup:'LİSANS',category:'KEY ORME BODY',previousOrderMonth:'202507',previousInStoreMonth:'202602',newOrderMonth:'202607',newInStoreMonth:'202702'};
const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-9,`${a} != ${b}`);
const snapshot=model.parseWorkbookBuffer(buildEndeksmatikWorkbook(),'demo.xlsx');
for(const kind of ['legacy','usd']){
 const calculate=input=>kind==='legacy'?engine.calculate({...input,setId:'legacy',category:'KEY ORME BODY K.KOL-LİSANS'}):model.calculate(snapshot,input);
 for(const costs of [false,true])test(`${kind}: backward USD/TRY calculation inverts the forward index, including royalty and hologram (${costs})`,()=>{
   const input={...detail,previousUsdPrice:3.2,previousTryPrice:120,adjustmentPct:3,royaltyIncluded:costs,royaltyPct:costs?12:0,hologramCost:costs?0.08:0};
   const forward=calculate(input);
   const backward=calculate({...input,priceReference:'new',previousUsdPrice:forward.prices.usd,previousTryPrice:forward.prices.try});
   close(backward.prices.usd,input.previousUsdPrice);
   close(backward.prices.try,input.previousTryPrice);
   assert.equal(backward.priceReference,'new');
   assert.equal(backward.months.previousOrderMonth,'202507');
 });
 test(`${kind}: backward calculation rejects an uninvertible index`,()=>{
   assert.throws(()=>calculate({...detail,previousUsdPrice:3,adjustmentPct:100,priceReference:'new'}),e=>e.code==='INDEX_NOT_INVERTIBLE');
 });
}
test('CP and Orders expose Endeksmatik in Tools and read only their visible selected row',()=>{
 assert.match(HTML,/id="cpToolsMenu"[\s\S]*?id="cpEndeksmatikBtn"/);
 assert.match(HTML,/id="ordersToolsMenu"[\s\S]*?id="ordersEndeksmatikBtn"/);
 assert.match(APP,/function selectedEndeksmatikOrder\(mode\)/);
 const selection=APP.slice(APP.indexOf('function selectedEndeksmatikRows(mode)'),APP.indexOf('function endeksmatikModelContext'));
 assert.match(selection,/filteredOrders\(\)/);assert.match(selection,/filteredCP\(\)/);
 assert.doesNotMatch(selection,/selectedCpRowsForAction|_canEdit/);
 assert.match(APP,/data-em-order-direction/);
});
const canonical=require('../public/canonical-fields');
const contextSource=APP.slice(APP.indexOf('function endeksmatikModelContext(mode,row)'),APP.indexOf('function endeksmatikComponentTableHtml'));
const context=new Function('window','norm','endeksmatikMonthFromDate','endeksmatikAddYear','endeksmatikDefaultAdjustment','endeksmatikRoyaltyRule',contextSource+';return endeksmatikModelContext;')(
 {BLCanonicalFields:canonical},v=>String(v??'').trim(),v=>v?String(v).slice(0,7).replace('-',''):'',v=>v?`${Number(v.slice(0,4))+1}${v.slice(4)}`:'',()=>3,()=>null);
for(const mode of ['cp','orders'])test(`${mode}: canonical order aliases provide dates, dimensions and FOB without mutating the order`,()=>{
 const row={orderCode:'DEMO-1',modelName:'DEMO',MMYG:'CUW4',MAG:'CU4E','Buying Group':'LİSANS',Category:'SWEATSHIRT','Order Placement Date':'2025-07-10','In-Store':'2026-02-05',FOB:3.2,_canEdit:false};
 const before=JSON.stringify(row),ctx=context(mode,row);
 assert.deepEqual([ctx.previousOrderMonth,ctx.previousInStoreMonth,ctx.newOrderMonth,ctx.newInStoreMonth],['202507','202602','202607','202702']);
 assert.deepEqual([ctx.mmyg,ctx.mag,ctx.buyingGroup,ctx.category,ctx.previousUsdPrice],['CUW4','CU4E','LİSANS','SWEATSHIRT',3.2]);
 assert.equal(JSON.stringify(row),before);
 const missing=context(mode,{});assert.equal(missing.previousOrderMonth,'');assert.equal(missing.newInStoreMonth,'');
});
test('order selection uses the active table, accepts view-only rows, and rejects hidden or multiple selections',()=>{
 const source=APP.slice(APP.indexOf('function selectedEndeksmatikRows(mode)'),APP.indexOf('function endeksmatikModelContext'));
 const cp={_id:'cp',_canEdit:false},order={_id:'orders',_canEdit:false};
 const state={cpSelected:new Set(['cp','hidden']),ordersSelected:new Set(['orders'])},document={body:{dataset:{activeTab:'cp'}}};
 const select=new Function('state','filteredCP','filteredOrders','document','showToast','appLang',source+';return selectedEndeksmatikOrder;')(state,()=>[cp],()=>[order],document,()=>{},'en');
 assert.equal(select('cp'),cp);assert.equal(select('orders'),null);
 state.cpSelected.delete('cp');assert.equal(select('cp'),null);
 document.body.dataset.activeTab='orders';assert.equal(select('orders'),order);
});
test('copied reverse setups retain direction and are blocked in Collection',()=>{
 assert.match(APP,/priceReference:payload.priceReference\|\|'previous'/);
 assert.match(APP,/copied.priceReference==='new'&&!directionSelect/);
 assert.match(APP,/directionSelect.value=copied.priceReference==='new'\?'backward':'forward'/);
});
