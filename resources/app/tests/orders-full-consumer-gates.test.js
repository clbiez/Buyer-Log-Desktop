'use strict';
// Exercise the production consumer functions and dispatcher; no substitute bodies.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const repo=path.resolve(__dirname,'../../..');
const {extractFunction}=require(path.join(repo,'resources/app/tests/helpers/app-main-functions'));
const publicRoot=path.join(__dirname,'../public');
const baselineRoot=path.join(__dirname,'fixtures/orders-full-consumer-baseline');
const read=name=>fs.readFileSync(path.join(publicRoot,name),'utf8');
const app=read('app-main.js'),chat=read('lcwai-chat.js'),editor=read('lcwai-output-editor.js');
const turn=()=>new Promise(resolve=>setImmediate(resolve));
function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});promise.catch(()=>{});return {promise,resolve,reject};}
function context(code,globals){const value=vm.createContext({...globals});vm.runInContext(code,value);return value;}
function fn(source,name,globals){
  // Existing extractor expects column-zero declarations. Only declaration
  // indentation is removed; the original executable function is not replaced.
  const code=extractFunction(source.replace(/^[ \t]+(?=(?:async )?function )/gm,''),name);
  const sandbox=context(code+'\nglobalThis.run='+name+';',globals);return {run:sandbox.run,sandbox};
}
function between(source,start,end){const at=source.indexOf(start);assert.ok(at>=0,'real source start is present');const stop=source.indexOf(end,at+start.length);assert.ok(stop>at,'real source end is present');return source.slice(at,stop);}
function objectCode(name){const start='window.'+name+'={';return between(app,start,'\n};')+'\n};';}
const thin=[{_id:1,'Order Code':7}],full=[{_id:1,'Order Code':7,__CPX_HIDDEN:'complete'}];

test('real AI Orders provider waits before tableContext; CP still executes immediately',async()=>{
  const gate=deferred(),providers=[],reads=[];let rows=thin,calls=0;
  const {run}=fn(chat,'registerDefaultProviders',{AI:()=>({registerContextProvider:value=>providers.push(value)}),
    window:{BLEnsureOrdersFullForAction:async()=>{calls++;await gate.promise;}},tableContext:tab=>{reads.push(tab);return rows;}});
  run();const pending=providers.find(item=>item.id==='orders').build('selected'),before=reads.length;
  rows=full;gate.resolve();assert.equal(await pending,full);assert.equal(before,0);assert.equal(calls,1);
  const cp=providers.find(item=>item.id==='cp').build('all');assert.equal(reads.at(-1),'cp');await cp;assert.equal(calls,1);
});
test('real AI provider fails closed when the full barrier rejects',async()=>{
  const providers=[];let reads=0;
  const {run}=fn(chat,'registerDefaultProviders',{AI:()=>({registerContextProvider:value=>providers.push(value)}),
    window:{BLEnsureOrdersFullForAction:async()=>{throw Error('stale-source');}},tableContext:()=>{reads++;return thin;}});
  run();await assert.rejects(providers.find(item=>item.id==='orders').build('all'),/stale-source/);assert.equal(reads,0);
});
test('real queryDatasets captures full rows after the gate outside swallowed loader errors',async()=>{
  const gate=deferred();let rows=thin,reads=0,calls=0;
  const data={table:()=>{reads++;return {rows,columns:[{key:'__CPX_HIDDEN'}],selectedIds:[1],rowId:row=>row._id};},pageTitle:()=> 'Orders'};
  const {run}=fn(chat,'queryDatasets',{DQ:()=>({createDataset:value=>value}),window:{BLAIScreenData:data,BLEnsureOrdersFullForAction:async()=>{calls++;await gate.promise;}},
    queryTargets:()=>({targets:[{screen:'orders',scope:'selected'}],named:false}),ensureQueryData:async()=>{}});
  const pending=run([],'');await turn();const before=reads;rows=full;gate.resolve();const result=await pending;
  assert.equal(before,0);assert.equal(calls,1);assert.equal(result[0].rows[0],full[0]);
});
test('real Studio selection waits before every getter, row build and draft creation',async()=>{
  const gate=deferred(),events=[];let rows=thin;
  const {run}=fn(editor,'openSelection',{window:{BLEnsureOrdersFullForAction:()=>gate.promise,
    BLAIScreenData:{table:()=>{events.push('getter');return {rows,columns:[],selectedIds:[1],rowId:row=>row._id};}},
    BLOutputSource:{MAX_ROWS:30000,build:input=>{events.push(input.rows[0]);return {records:{},items:[],data:{},source:{}};}}},
    AI:()=>({createStudio:async()=>{events.push('draft');return {id:'demo'};},errorText:error=>error.message}),open:async()=>{},ed:null,isEn:()=>true,L:(_tr,en)=>en,toast:message=>events.push(message)});
  const pending=run('orders','selected'),before=events.length;rows=full;gate.resolve();await pending;
  assert.equal(before,0);assert.ok(events.includes(full[0]));assert.equal(events.at(-1),'draft');
});
test('real Studio rejection creates no partial draft',async()=>{
  let getters=0,drafts=0;const errors=[];
  const {run}=fn(editor,'openSelection',{window:{BLEnsureOrdersFullForAction:async()=>{throw Error('stale-source');},BLAIScreenData:{table:()=>{getters++;return null;}}},
    AI:()=>({createStudio:async()=>{drafts++;},errorText:error=>error.message}),L:(_tr,en)=>en,toast:message=>errors.push(message)});
  await run('orders');assert.equal(getters,0);assert.equal(drafts,0);assert.deepEqual(errors,['stale-source']);
});
test('real export captures filtered rows and selection only after full publication',async()=>{
  const gate=deferred();let rows=thin,reads=0,captured;
  const globals={document:{body:{dataset:{activeTab:'orders'}}},state:{ordersSelected:new Set(),cpSelected:new Set()},
    ensureOrdersFullForAction:()=>gate.promise,filteredOrders:()=>{reads++;return rows;},filteredCP:()=>[],computeFlags:()=>({}),
    showToast(){},exportStyledDomTable:async(_selector,options)=>{captured=options.records;}};
  const {run}=fn(app,'exportActiveTableStyled',globals),pending=run(),before=reads;rows=full;gate.resolve();await pending;
  assert.equal(before,0);assert.equal(captured,full);
});
test('real export rejection never calls the serializer',async()=>{
  let exports=0;const {run}=fn(app,'exportActiveTableStyled',{document:{body:{dataset:{activeTab:'orders'}}},
    ensureOrdersFullForAction:async()=>{throw Error('stale-source');},state:{ordersSelected:new Set(),cpSelected:new Set()},filteredOrders:()=>thin,filteredCP:()=>[],computeFlags:()=>({}),
    exportStyledDomTable:async()=>exports++,showToast(){}});
  await assert.rejects(run(),/stale-source/);assert.equal(exports,0);
});
for(const bridge of ['BLManufacturerDataBridge','BLPriceSupplierAnalysisBridge'])test(`real ${bridge} captures full rows before derived snapshots`,async()=>{
  const gate=deferred(),state={orders:{rows:thin}};let calls=0;
  const window={BLCanonicalFields:{},BLPriceSupplierInsights:{orderPriceObservation:row=>({row})}};
  const sandbox=context(objectCode(bridge),{window,state,ensureOrdersLoaded:async()=>{},ensureOrdersFullForAction:async()=>{calls++;await gate.promise;},
    ensureCpLoaded:async()=>{},ensureCollectionCatalogLoaded:async()=>{},filteredOrders:()=>state.orders.rows,appLang:'en',priceAnalysisMapInBatches:async(rows,mapper)=>rows.map(mapper)});
  const pending=bridge==='BLManufacturerDataBridge'?window[bridge].rows():window[bridge].get('orders');await turn();
  state.orders={rows:full};gate.resolve();const result=await pending;
  assert.equal(calls,1);assert.equal(bridge==='BLManufacturerDataBridge'?result[0]:result.observations[0].row,full[0]);assert.ok(sandbox);
});
for(const action of ['onShow','onShowAll'])for(const isThin of [true,false])test(`real column ${action}: ${isThin?'thin waits':'full body stays synchronous'}`,async()=>{
  const gate=deferred(),hidden=new Set(['hidden']);let callbacks,calls=0,saves=0;
  const {run}=fn(app,'openManagedTableColumnMenu',{COLS_BY_TABLE:{orders:[{k:'hidden'}]},colmgr:{orders:{hidden}},ordersProjectionIsThin:()=>isThin,
    ensureOrdersFullForAction:async()=>{calls++;await gate.promise;},tableColumnLabel:()=> 'Hidden',openColumnVisibilityMenu:(_event,options)=>{callbacks=options;},
    saveAutoTableColumnState:()=>saves++,showToast(){}});
  run({},'orders','hidden',()=>{});const pending=callbacks[action]('hidden'),before=hidden.has('hidden');gate.resolve();await pending;
  assert.equal(before,isThin);assert.equal(hidden.has('hidden'),false);assert.equal(saves,1);assert.equal(calls,isThin?1:0);
});
test('real show-all barrier failure changes neither hidden state nor stored preferences',async()=>{
  const hidden=new Set(['hidden']);let callbacks,saves=0;
  const {run}=fn(app,'openManagedTableColumnMenu',{COLS_BY_TABLE:{orders:[{k:'hidden'}]},colmgr:{orders:{hidden}},ordersProjectionIsThin:()=>true,
    ensureOrdersFullForAction:async()=>{throw Error('stale-source');},tableColumnLabel:()=> 'Hidden',openColumnVisibilityMenu:(_event,options)=>{callbacks=options;},
    saveAutoTableColumnState:()=>saves++,showToast(){}});
  run({},'orders','hidden',()=>{});await callbacks.onShowAll();assert.equal(hidden.has('hidden'),true);assert.equal(saves,0);
});
for(const isThin of [true,false])test(`real formula edit ${isThin?'waits before opening':'opens synchronously for full'}`,async()=>{
  const gate=deferred();let opened=0,calls=0;
  const {run}=fn(app,'tableFieldsRenameColumn',{ordersProjectionIsThin:()=>isThin,ensureOrdersFullForAction:async()=>{calls++;await gate.promise;},
    tableFieldsColumn:()=>({col:{formulaId:'f1'},canRename:true,kind:'formula'}),tableFieldsRerender(){},window:{BLFormulaColumns:{open:()=>opened++}},showToast(){}});
  const pending=run('orders','formula'),before=opened;gate.resolve();await pending;
  assert.equal(before,isThin?0:1);assert.equal(opened,1);assert.equal(calls,isThin?1:0);
});
test('real preset click gates thin configuration but keeps full body synchronous',async()=>{
  const marker="const button=event.target.closest?.('[data-table-view-preset][data-table-key]');if(!button)return;",at=app.indexOf(marker);
  assert.ok(at>0);const start=app.lastIndexOf("document.addEventListener('click',",at),end=app.indexOf('\n});',at)+4,code=app.slice(start,end);
  for(const isThin of [true,false]){
    const gate=deferred();let handler,applied=0;
    context(code,{document:{addEventListener:(_type,fn)=>{handler=fn;}},ordersProjectionIsThin:()=>isThin,ensureOrdersFullForAction:()=>gate.promise,
      applyTableViewPreset:()=>applied++,showToast(){}});
    const pending=handler({target:{closest:()=>({dataset:{tableKey:'orders',tableViewPreset:'all'},isConnected:true})}}),before=applied;
    gate.resolve();await pending;assert.equal(before,isThin?0:1);assert.equal(applied,1);
  }
});
test('real Collection backfill gates before row capture and rejects duplicate pending clicks',async()=>{
  const gate=deferred();let handler,rows=thin,reads=0,planned;
  const code="let cpKolBackfillBusy=false;\n"+between(app,"document.getElementById('cpCopyToKolBtn')?.addEventListener('click',async event=>{",'\n\n// ================= DİL');
  context(code,{document:{body:{dataset:{activeTab:'orders'}},getElementById:()=>({addEventListener:(_type,fn)=>{handler=fn;}})},
    window:{BLTableToolbarActionCleanup:{finish(){}}},kolRequireWorkspaceEdit:()=>true,kolIsOwnWorkspace:()=>true,kolWorkspaceOwnerId:'demo',kolWorkspaceRevision:1,
    ensureOrdersFullForAction:()=>gate.promise,cpKolSelectedSourceRows:()=>{reads++;return rows;},cpKolBackfillPlan:input=>{planned=input;return {changes:[]};},showToast(){},appLang:'en'});
  const event={currentTarget:{closest:()=>null}},pending=handler(event),duplicate=handler(event),before=reads;
  rows=full;gate.resolve();await Promise.all([pending,duplicate]);assert.equal(before,0);assert.equal(reads,1);assert.equal(planned,full);
});
test('actual contextual dispatcher reacquires full source before synchronous price drawer',async()=>{
  const gate=deferred();let rows=thin,opened;
  const actualCommands=require(path.join(repo,'resources/app/public/contextual-commands.js'));
  const window={BLContextualCommands:actualCommands,BLCollectionPriceDrawer:{openCp:row=>{opened=row;return true;}}};
  const code=between(app,'window.BLContextCommands=window.BLContextualCommands.create(', '\n\n/* ===================================================================');
  context(code,{window,contextualCommandSnapshot:()=>({module:'orders',rows,token:'same-semantic-selection'}),showToast(){},contextualCommandLabel:(_tr,en)=>en,
    contextOne:()=>'',contextModel:()=>'',contextArea:()=>'',contextOrderTarget:()=> 'cp',ensureOrdersFullForAction:()=>gate.promise,
    kolWorkspaceList:[],kolWorkspaceCanEdit:false,contextualCommandButton:()=>null,contextualCommandRule:()=>null});
  const action=window.BLContextCommands.commands().find(value=>value.id==='context.price-lineage'),pending=action.run();await turn();const before=opened;
  rows=full;gate.resolve();await pending;assert.equal(before,undefined);assert.equal(opened,full[0]);
});
test('actual linked-order dispatcher waits for target Orders full before synchronous drawer',async()=>{
  const gate=deferred(),sourceRows=[{_id:9}];let rows=thin,opened;
  const actualCommands=require(path.join(repo,'resources/app/public/contextual-commands.js'));
  const window={BLContextualCommands:actualCommands,BLDetailDrawer:{open:options=>{opened=options.rows;}}};
  const code=between(app,'window.BLContextCommands=window.BLContextualCommands.create(', '\n\n/* ===================================================================');
  context(code,{window,contextualCommandSnapshot:()=>({module:'cp',rows:sourceRows,token:'same-semantic-selection'}),showToast(){},contextualCommandLabel:(_tr,en)=>en,
    contextOne:()=>'',contextModel:()=>'',contextArea:()=>'',contextOrderTarget:()=> 'orders',ensureOrdersLoaded:async()=>{},ensureOrdersFullForAction:()=>gate.promise,
    orderLinePeerRows:()=>rows,kolWorkspaceList:[],kolWorkspaceCanEdit:false,contextualCommandButton:()=>null,contextualCommandRule:()=>null});
  const action=window.BLContextCommands.commands().find(value=>value.id==='context.linked-order'),pending=action.run();await turn();const before=opened;
  rows=full;gate.resolve();await pending;assert.equal(before,undefined);assert.equal(opened,full);
});
test('public synchronous screen getters, CP loader and native clipboard source are unchanged',()=>{
  const baseline=fs.readFileSync(path.join(baselineRoot,'app-main.js'),'utf8');
  for(const name of ['ensureCpLoaded','registerManagedGridClipboard'])assert.equal(extractFunction(app,name),extractFunction(baseline,name));
  // The new metadata-only method adds no row provider. Keep the entire old
  // synchronous provider object byte-exact after removing that one reviewed
  // addition; its real behavior has separate native table-summary regressions.
  const {summary}=require('./fixtures/orders-table-summary/patch-recipe.cjs');
  const providers=between(app,'window.BLAIScreenData = {','\n};');
  assert.equal(providers.split(summary).length,2,'exactly one reviewed count-only method');
  assert.equal(providers.replace(summary,''),between(baseline,'window.BLAIScreenData = {','\n};'));
  const native=source=>between(source,"document.addEventListener('copy', e=>{",'\n});');
  assert.equal(native(app),native(baseline));assert.doesNotMatch(native(app),/await ensureOrdersFullForAction/);
});
