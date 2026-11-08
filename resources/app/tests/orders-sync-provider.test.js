'use strict';
// Exercise actual installed synchronous provider bindings and the actual formula runtime.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),vm=require('node:vm');
const appRoot=path.resolve(__dirname,'..'),zlib=require('node:zlib');
const {extractFunction}=require('./helpers/app-main-functions'),draft=require('./fixtures/orders-sync-provider/patch-recipe.cjs'),candidate=true;
const before=zlib.gunzipSync(fs.readFileSync(path.join(__dirname,'fixtures/orders-table-summary/app-main-before.js.gz'))).toString('utf8');
const rawApp=require('./fixtures/orders-table-summary/patch-recipe.cjs').app(before);
const app=fs.readFileSync(path.join(appRoot,'public/app-main.js'),'utf8');
const formula=fs.readFileSync(path.join(appRoot,'public/formula-columns.js'),'utf8');
const engine=fs.readFileSync(path.join(appRoot,'public/formula-engine.js'),'utf8');
function between(source,start,end){const at=source.indexOf(start),stop=source.indexOf(end,at);assert.ok(at>=0&&stop>at);return source.slice(at,stop);}
const screenObject=between(app,'window.BLAIScreenData = {','\n};')+'\n};',rowsObject=between(app,'window.BLFormulaRows = {','\n};')+'\n};';
function reviewedBlock(start,end,expected){const actual=between(app,start,end);assert.equal(actual.trimEnd(),expected.trimEnd(),'actual installed provider binding matches the reviewed change');return actual;}
const actualHelpers=reviewedBlock('const _ordersRequireFullSynchronousRead=()=>{','\nvar startupPageProfileReady',draft.helpers);
const actualTableWrapper=reviewedBlock('const _ordersFullScreenTable=','// Üst çubuktaki LCW AI düğmesi:',draft.tableWrapper);
const actualRowsWrapper=reviewedBlock('const _ordersFullFormulaRows=','/* Formül sütunlarını satırlara işler.',draft.formulaRowsWrapper);
const actualFormulaWrapper=reviewedBlock('const _ordersFullApplyFormulaColumns=','\n\n// ================= dynamic table height',draft.publicFormulaWrapper);

function fixture(isThin=false){
 let thin=isThin;const full=[{_id:1,'Order Code':'same','Order Quantity':0,__CPX_needed:7,__CPX_unused:'omitted',zero:0,flag:false,nil:null}],view=[{_id:1,'Order Code':'same','Order Quantity':0,__CPX_needed:7,zero:0,flag:false,nil:null}],state={orders:{rows:isThin?view:full},cp:{rows:[{_id:2}]}};
 const columns=[{k:'Order Code',label:'Order Code'},{k:'Order Quantity',label:'Order Quantity'},{k:'__CPX_needed',label:'Needed model',modelCustom:true}],calls=[],values=new Map();
 const context=vm.createContext({state,shipRows:[],ordersProjectionIsThin:()=>thin,appLang:'en',document:{readyState:'loading',addEventListener(){},getElementById:()=>null},
  tableInfoForTab:tab=>({tableKey:tab,rowsFn:()=>{calls.push('filtered-read');return state[tab]?.rows||[];},cols:()=>columns,selSet:()=>new Set(),filterIds:[]}),visibleCols:()=>columns,tableColumnLabel:(_table,col)=>col.label||col.k,
  COLS_BY_TABLE:{orders:columns,cp:[]},colmgr:{orders:{order:columns.map(col=>col.k),hidden:new Set(),widthPx:{}}},BLStorage:{getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,String(value))},console:{error(){}}});
 context.window=context;
 vm.runInContext(extractFunction(app,'ordersFullActionError')+'\n'+actualHelpers+'\n'+screenObject+'\n'+actualTableWrapper+'\n'+rowsObject+'\n'+actualRowsWrapper+'\n'+extractFunction(app,'applyFormulaColumns')+'\n'+actualFormulaWrapper,context);
 return {context,state,full,view,calls,values,setThin(value){thin=value;state.orders={rows:value?view:full};},loadFormula(){vm.runInContext(engine,context);vm.runInContext(formula,context);return context.BLFormulaColumns;}};
}
for(const opts of [undefined,{all:true},{all:false}])test('actual public table row mode rejects thin before any filtered/full row capture '+JSON.stringify(opts),()=>{
 const f=fixture(true);assert.throws(()=>f.context.BLAIScreenData.table('orders',opts),{code:'ORDERS_FULL_REQUIRED'});assert.deepEqual(f.calls,[]);
});
test('actual public table retains explicit columnsOnly metadata without exposing thin rows',()=>{
 const f=fixture(true),metadata=f.context.BLAIScreenData.table('orders',{all:true,columnsOnly:true});assert.ok(metadata);assert.equal(metadata.rows.length,0);assert.deepEqual(f.calls,[]);assert.equal(metadata.columns.length,3);
});
test('actual full public table returns exact full row objects and keeps 0 false null presence',()=>{
 const f=fixture(false),data=f.context.BLAIScreenData.table('orders',{all:true});assert.equal(data.rows,f.full);assert.equal(data.rows[0].zero,0);assert.equal(data.rows[0].flag,false);assert.equal(data.rows[0].nil,null);
 assert.equal(typeof data.then,'undefined');assert.equal(data.columns.find(col=>col.key==='__CPX_needed').rawValue(data.rows[0]),7);
});
test('actual public BLFormulaRows orders rejects thin; full and CP providers keep synchronous exact arrays',()=>{
 const f=fixture(true);assert.throws(()=>f.context.BLFormulaRows.orders(),{code:'ORDERS_FULL_REQUIRED'});assert.equal(f.context.BLFormulaRows.cp(),f.state.cp.rows);
 f.setThin(false);assert.equal(f.context.BLFormulaRows.orders(),f.full);assert.equal(typeof f.context.BLFormulaRows.orders().then,'undefined');
});
test('actual public applyFormulaColumns guard throws outside its legacy swallow and performs no partial refresh',()=>{
 const f=fixture(true);let calls=0;f.context.BLFormulaColumns={refresh(){calls++;}};assert.throws(()=>f.context.applyFormulaColumns('orders'),{code:'ORDERS_FULL_REQUIRED'});assert.equal(calls,0);
});
test('actual classic global/window applyFormulaColumns binding does not recurse and full body executes once',()=>{
 const f=fixture(false),received=[];f.context.BLFormulaColumns={refresh:(table,rows)=>received.push({table,rows})};assert.equal(f.context.applyFormulaColumns('orders'),undefined);
 assert.equal(received.length,1);assert.equal(received[0].rows,f.full);assert.equal(f.context.window,f.context);
});
test('private explicit current-view formula refresh matches real settled full calculation without reading public Orders provider',()=>{
 const f=fixture(false),api=f.loadFormula();api.save('orders',[{id:'x',label:'X',formula:'[Order Quantity] + [__CPX_needed]'}]);api.syncColumns('orders');api.refresh('orders',f.full);const expected=f.full[0].__f_x;
 f.setThin(true);f.context.BLFormulaRows.orders=()=>{throw Object.assign(Error('public full provider must not be read'),{code:'ORDERS_FULL_REQUIRED'});};
 assert.equal(vm.runInContext('typeof _applyOrdersFormulaColumnsForCurrentView',f.context),'function','private candidate adapter must exist');assert.equal(Object.hasOwn(f.context,'_applyOrdersFormulaColumnsForCurrentView'),false);
 vm.runInContext('_applyOrdersFormulaColumnsForCurrentView();',f.context);assert.equal(f.view[0].__f_x,expected);assert.equal(f.view[0].zero,0);assert.equal(f.view[0].flag,false);assert.equal(f.view[0].nil,null);assert.equal(Object.hasOwn(f.view[0],'__CPX_unused'),false);
});
test('actual unsupported late formula migration propagates FULL_REQUIRED before preference writes',()=>{
 const f=fixture(false),api=f.loadFormula();api.save('orders',[{id:'late',label:'Late',formula:'[Needed model] + 1'}]);f.setThin(true);const before=f.values.get('bl.formulaColumns.orders.v1');
 assert.throws(()=>api.migrateReferences('orders'),{code:'ORDERS_FULL_REQUIRED'});assert.equal(f.values.get('bl.formulaColumns.orders.v1'),before);
});
test('actual formula tableRows keeps its existing generic-provider-error fallback but never swallows FULL_REQUIRED',()=>{
 const f=fixture(false),api=f.loadFormula();f.context.BLFormulaRows.orders=()=>{throw Error('legacy provider failure');};assert.equal(api.tableRows('orders').length,0);
 f.context.BLFormulaRows.orders=()=>{throw Object.assign(Error('missing full'),{code:'ORDERS_FULL_REQUIRED'});};assert.throws(()=>api.tableRows('orders'),{code:'ORDERS_FULL_REQUIRED'});
});
test('candidate leaves protected CP loader, clipboard and original provider literal bodies intact',()=>{
 for(const name of ['ensureCpLoaded','registerManagedGridClipboard'])assert.equal(extractFunction(require('./fixtures/orders-ready-integration/source.cjs').base('public/app-main.js'),name),extractFunction(rawApp,name));
 assert.equal(between(app,'window.BLAIScreenData = {','\n};'),between(rawApp,'window.BLAIScreenData = {','\n};'));
 assert.equal(between(app,'window.BLFormulaRows = {','\n};'),between(rawApp,'window.BLFormulaRows = {','\n};'));
 assert.equal(extractFunction(app,'applyFormulaColumns'),extractFunction(rawApp,'applyFormulaColumns'));
});

test('actual whole Orders renderer computes its private formula before filters and sorting inspect rows',()=>{
 const f=fixture(false),api=f.loadFormula();api.save('orders',[{id:'paint',label:'Paint',formula:'[Order Quantity] + [__CPX_needed]'}]);api.syncColumns('orders');api.refresh('orders',f.full);
 const expected=f.full[0].__f_paint;f.setThin(true);f.view[0].__f_paint=-1;
 const stop={frontier:'ordersEvaluateAll'},observed=[];
 f.context.cpPlmDetailsSync=()=>{};f.context.migrateLegacyOrdersQuickFilters=()=>{};f.context.updateOrdersDimBtnLabels=()=>{};
 f.context.document.getElementById=()=>({style:{}});
 f.context.ordersEvaluateAll=()=>{observed.push(f.view[0].__f_paint);throw stop;};
 vm.runInContext(extractFunction(app,'renderOrdersNow')+'\nglobalThis.actualOrdersRenderer=renderOrdersNow;',f.context);
 assert.throws(()=>f.context.actualOrdersRenderer(),error=>error===stop);
 assert.deepEqual(observed,[expected]);assert.equal(expected,7);
 assert.equal(Object.hasOwn(f.view[0],'__CPX_unused'),false,'test never manufactures omitted cells');
});
