'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {api,source,patched,quickSource,quickPatched,barSource,barPatched,selectedSource,baseline,extractFunction,between,nested,callback,node,fire,fixture}=require('./ui-fixture.cjs');
const tick=()=>new Promise(setImmediate);
function controls(f){f.evaluate(between(f.source,"['ordersSearch','ordersFCountry','ordersFLicense','ordersFDelType','ordersFStatus','ordersFSeason'].forEach(id=>{","\nbindTableSearchClipboardPaste(document.getElementById('ordersSearch'))"));}
function functions(f){f.load(['removeActiveFilterToken','clearTableFilters','clearColumnFilters','toggleMirroredQuickFilter','toggleOrdersQuickExFactory','toggleOrdersActiveQuick','setPartialView','cycleCheckFilter','managedSelectionChange']);}
test('ordinary full gate retains synchronous return/exception and never captures/promotes a source',()=>{
 const gate=api.create({isThin:()=>false,captureSource(){throw Error('must not capture');},ensureFull(){throw Error('must not fetch');},activeTab(){throw Error('must not read');},onError(){throw Error('must not catch full errors');}});
 const value={full:true};assert.equal(gate.run({change:()=>value}),value);const expected=Error('original');assert.throws(()=>gate.run({change:()=>{throw expected;}}),e=>e===expected);
});
for(const id of ['ordersSearch','ordersFCountry','ordersFLicense','ordersFDelType','ordersFStatus','ordersFSeason'])test('actual '+id+' listener awaits native full despite pending DOM value; no storage/render before promotion',async()=>{
 const f=fixture();controls(f);const n=f.nodes.get(id);n.value='pending new input';const task=fire(n,id==='ordersSearch'?'input':'change');await tick();
 assert.deepEqual(f.events,['fetch']);assert.equal(f.state.orders.kind,'thin');assert.equal(f.acceptedReads(),0);
 f.settle();await task;assert.equal(f.state.orders.kind,'full');assert.ok(f.events.includes(id==='ordersSearch'?'debounced-render':'render'));assert.equal(f.fetches(),1);assert.equal(f.acceptedReads(),0);
});
test('actual full control listeners still render synchronously and fetch nothing',()=>{
 const f=fixture({thin:false});controls(f);assert.equal(fire(f.nodes.get('ordersFStatus'),'change'),undefined);assert.deepEqual(f.events,['render']);assert.equal(f.fetches(),0);
});
for(const change of [f=>{f.nodes.get('ordersSearch').value='newer';},f=>{f.nodes.get('ordersSearch').isConnected=false;},f=>{f.nodes.set('ordersSearch',node('ordersSearch'));},f=>f.setTab('cp'),f=>f.retire()])test('pending actual input rechecks changed target/value/tab/source '+String(change),async()=>{
 const f=fixture();controls(f);const n=f.nodes.get('ordersSearch');n.value='first';const task=fire(n,'input');await tick();change(f);f.settle();await task;
 assert.equal(f.events.includes('debounced-render'),false);assert.equal(f.events.includes('save'),false);assert.equal(f.events.includes('storage'),false);
});
test('rapid input supersedes the old intent quietly, without replaying native events or duplicate full fetch',async()=>{
 const f=fixture();controls(f);const n=f.nodes.get('ordersSearch');n.value='a';const first=fire(n,'input');await tick();n.value='ab';const last=fire(n,'input');f.settle();await Promise.all([first,last]);
 assert.equal(f.events.filter(e=>e==='debounced-render').length,1);assert.equal(f.events.filter(e=>e&&e.type==='toast').length,0);assert.equal(f.fetches(),1);
});
test('thin clipboard-matrix paste applies its semantic value after full and dispatches no synthetic input',async()=>{
 const f=fixture();f.load(['bindTableSearchClipboardPaste']);f.ctx.parseTableSearchClipboardMatrix=()=>['one','two'];const n=f.nodes.get('ordersSearch');n.value='before';f.ctx.bindTableSearchClipboardPaste(n);
 const task=fire(n,'paste',{clipboardData:{getData:()=> 'one\ntwo'}});await tick();assert.equal(n.value,'before');assert.equal(f.events.includes('debounced-render'),false);
 f.settle();await task;assert.equal(n.value,'one, two');assert.equal(f.events.includes('debounced-render'),true);
});
function dimensions(f){
 const panel=node('ordersDimPanel_country'),all=node('all'),box=node('egypt','Egypt');box.checked=true;
 panel.one.set('.ordersDimAll',all);panel.many.set('.ordersDimChk',[box]);f.nodes.set(panel.id,panel);
 Object.assign(f.ctx,{ORDERS_DIM_META:{country:{col:'Country'}},ordersDimFilters:{},uniqueVals:()=>['Egypt'],computeValidValueSet:()=>new Set(['Egypt']),sortWithFacet:v=>v,facetChecklistHtml:()=>''});
 f.load(['renderOrdersDimPanel']);f.ctx.renderOrdersDimPanel('country');return {panel,all,box};
}
for(const kind of ['value','all'])test('actual dimension '+kind+' callback mutates filters/storage only after full',async()=>{
 const f=fixture(),d=dimensions(f);if(kind==='all'){f.ctx.ordersDimFilters.country=new Set(['Egypt']);d.all.checked=true;}
 const task=fire(kind==='all'?d.all:d.box,'change');await tick();assert.equal(f.events.includes('dim-save'),false);
 if(kind==='value')assert.equal(f.ctx.ordersDimFilters.country,undefined);else assert.ok(f.ctx.ordersDimFilters.country.has('Egypt'));
 f.settle();await task;assert.equal(f.events.includes('dim-save'),true);
 if(kind==='value')assert.ok(f.ctx.ordersDimFilters.country.has('Egypt'));else assert.equal(f.ctx.ordersDimFilters.country,undefined);
});
test('actual full dimension callback keeps synchronous domain/storage/render sequence',()=>{
 const f=fixture({thin:false}),d=dimensions(f);assert.equal(fire(d.box,'change'),undefined);assert.ok(f.ctx.ordersDimFilters.country.has('Egypt'));assert.deepEqual(f.events,['dim-label','dim-save','render']);
});
test('actual clear/remove/quick/check/partial/managed sinks defer all old bodies before full',async()=>{
 for(const [name,args,setup] of [
  ['removeActiveFilterToken',['orders','column','x'],f=>{f.state.colFilters.orders.x={values:new Set(['a'])};}],
  ['clearTableFilters',['orders'],f=>{f.state.colFilters.orders.x={};}],
  ['toggleOrdersActiveQuick',['Active'],()=>{}],['toggleOrdersQuickExFactory',['past'],()=>{}],
  ['toggleMirroredQuickFilter',['orders','STATUS','ordersFStatus','Open'],()=>{}],
  ['cycleCheckFilter',['orders'],()=>{}],['managedSelectionChange',['orders',s=>s.add('row-a')],()=>{}],
  ['setPartialView',['orders',true],()=>{}]
 ]){
  const f=fixture();functions(f);Object.assign(f.ctx,{partialViewState:{orders:false},cpLogisticExpandedSet:()=>new Set(),renderTableViewContext:()=>{},CHECK_FILTER_CYCLE:['','checked','unchecked']});
  setup(f);const before={filter:Object.keys(f.state.colFilters.orders),active:[...f.state.ordersQuickActive],selected:[...f.state.ordersSelected],check:f.state.checkFilter.orders,partial:f.ctx.partialViewState.orders};
  const task=f.ctx[name](...args);await tick();assert.deepEqual({filter:Object.keys(f.state.colFilters.orders),active:[...f.state.ordersQuickActive],selected:[...f.state.ordersSelected],check:f.state.checkFilter.orders,partial:f.ctx.partialViewState.orders},before,name);
  assert.equal(f.events.some(e=>e==='save'||e==='render'),false,name);f.settle();await task;assert.equal(f.state.orders.kind,'full',name);
 }
});
function header(f,options={}){
 const panel=node('header'),apply=node('apply'),remove=node('remove'),add=node('add'),sort=node('sort'),clear=node('clear'),min=node('min','0'),max=node('max','10'),radio=node('radio','revised'),input=node('choice','zero');input.checked=true;sort.dataset.dir='-1';
 panel.one.set('.cfpApplySelection',apply);panel.one.set('.cfpRemoveSelection',remove);panel.one.set('.cfpAddSelection',add);panel.one.set('.cfpClearCol',clear);
 panel.one.set('.cfpRangeApply',apply);panel.one.set('.cfpRangeClear',clear);panel.one.set('.cfpRangeMin',min);panel.one.set('.cfpRangeMax',max);
 panel.one.set('.cfpSearch',node('search'));panel.many.set('.cfpSortBtn',[sort]);panel.many.set('input[name="cfpRev"]',[radio]);panel.many.set('input,select,textarea',[input,min,max,radio]);
 panel.many.set('.cfpList input[type=checkbox]',[input]);panel.many.set('.cfpItem',[]);panel.many.set('.cfpDrawerHead',[]);
 Object.assign(f.ctx,{panel,tableKey:'orders',key:'Ex-factory',currentGran:null,isDate:false,canFilterRevision:true,SORT_STATE_KEY:'ordersSort',
  rerenderOuter:()=>f.events.push('render'),pinCheckedFilterChoices(){},bindTableSearchClipboardPaste(){},parseTableSearchTerms:()=>[],
  uniqueColValues:()=>['zero','other'],uniqueDateBuckets:()=>[],revisionFilterMode:e=>e?.revision||'',colFilterHasValueTest:e=>Boolean(e?.values),
  updateDrawerSummaries(){},closeHeaderFilter:()=>f.events.push('close'),_openFilterPanel:panel,...options});
 const declaration=extractFunction(f.source,'openHeaderFilter');
 const helper=baseline?'const changeHeader=(_r,change)=>change();':between(declaration,'  const changeHeader=','  const GRAN_LABELS');
 f.evaluate(helper+'\n'+['wireList','applyFromBody','updateDrawerSummaries','wireSortBar','wirePctRange','wireRevisionSection'].map(name=>nested(declaration,name)).join('\n'));
 return {panel,apply,remove,add,sort,clear,min,max,radio,input};
}
for(const kind of ['apply','sort','clear','range','revision'])test('actual header '+kind+' command awaits full and preserves original 0/range/revision semantics',async()=>{
 const f=fixture(),h=header(f);let task;
 if(kind==='apply')task=f.ctx.applyFromBody(h.panel,null,false);
 if(kind==='sort'){f.ctx.wireSortBar();task=fire(h.sort,'click');}
 if(kind==='clear'){f.state.colFilters.orders['Ex-factory']={values:new Set(['old'])};f.ctx.wireSortBar();task=fire(h.clear,'click');}
 if(kind==='range'){f.ctx.wirePctRange();task=fire(h.apply,'click');}
 if(kind==='revision'){f.ctx.wireRevisionSection();task=fire(h.radio,'change');}
 await tick();assert.equal(f.events.includes('render'),false);assert.equal(f.events.includes('close'),false);assert.equal(f.state.ordersSort.key,null);
 f.settle();await task;
 if(kind==='sort')assert.equal(f.state.ordersSort.dir,-1);
 if(kind==='range'){assert.equal(f.state.colFilters.orders['Ex-factory'].range.min,0);assert.equal(f.state.colFilters.orders['Ex-factory'].range.max,0.1);}
 if(kind==='revision')assert.equal(f.state.colFilters.orders['Ex-factory'].revision,'revised');
 if(kind==='apply')assert.ok(f.state.colFilters.orders['Ex-factory'].values.has('zero'));
 assert.equal(f.events.includes('render'),true);
});
test('actual header opening waits before rowsForFilterUniverse temporarily deletes/restores a domain filter',async()=>{
 const f=fixture(),anchor=node('anchor'),bucket={x:{values:new Set(['a'])}},trace=[];
 f.state.colFilters.orders=new Proxy(bucket,{deleteProperty(target,key){trace.push('delete:'+key);return delete target[key];},set(target,key,value){trace.push('restore:'+key);target[key]=value;return true;}});
 Object.assign(f.ctx,{closeHeaderFilter(){},COLS_BY_TABLE:{orders:[{k:'x',type:'ro'}]},GENERIC_TABLE_SOURCES:{},filteredOrders:()=>f.state.orders.rows,
  isDateColumnDefinition(){throw Error('frontier after actual universe');}});
 f.load(['openHeaderFilter','rowsForFilterUniverse']);const task=f.ctx.openHeaderFilter('orders','x',anchor,()=>{});await tick();assert.deepEqual(trace,[]);
 f.settle();await task;assert.deepEqual(trace,['delete:x','restore:x']);assert.ok(bucket.x.values.has('a'));
});
test('header pending values/panel identity are rechecked after full before application',async()=>{
 const f=fixture(),h=header(f),task=f.ctx.applyFromBody(h.panel,null,false);await tick();h.input.checked=false;f.settle();await task;assert.equal(f.state.colFilters.orders['Ex-factory'],undefined);assert.equal(f.events.includes('render'),false);
});
function selection(f,kind){
 const table=node('ordersTable'),tbody=node('tbody'),all=node('ordersTable_selAll');all.checked=true;f.nodes.set(table.id,table);f.nodes.set(all.id,all);
 Object.assign(f.ctx,{table,tbody,tableKey:'orders',tableId:table.id,fullRows:f.state.orders.rows,selSet:f.state.ordersSelected,sortState:f.state.ordersSort,onSort(){},
  opts:{onSelectionChange:(selected,rows)=>f.events.push({type:'notified',selected,rows})},renderFullTable:()=>f.events.push('table-render'),updateSelectionFooterCount:()=>f.events.push('footer')});
 const declaration=extractFunction(f.source,'renderFullTable');
 f.evaluate(between(declaration,'  const notifySelectionChange =','  const groupBoundaryKeys'));
 if(kind==='all')f.evaluate(between(declaration,'    const selAll = document.getElementById','    const chkFilterBtn ='));
 else f.evaluate(between(declaration,'    if(!tbody._chkDelegated){','    // v10.11'));
 return {table,tbody,all};
}
for(const kind of ['all','row'])test('actual '+kind+' checkbox maps old row references through real native receipt and uses live selected Set',async()=>{
 const f=fixture(),s=selection(f,kind),oldSet=f.state.ordersSelected,oldRows=f.state.orders.rows;let task;
 if(kind==='all'){s.all.checked=true;task=fire(s.all,'change');}else{const checkbox=node('row');checkbox.checked=true;checkbox.dataset.id='row-a';task=fire(s.tbody,'change',{target:checkbox});}
 await tick();assert.deepEqual([...oldSet],[]);assert.equal(f.events.includes('clipboard-clear:ordersTable'),false);f.settle();await task;
 assert.deepEqual([...f.state.ordersSelected],kind==='all'?['row-a','row-b']:['row-a']);assert.notStrictEqual(f.state.orders.rows,oldRows);
 const notified=f.events.find(e=>e&&e.type==='notified');assert.equal(notified.selected,f.state.ordersSelected);assert.notStrictEqual(notified.rows[0],oldRows[0]);
 assert.equal(notified.rows[0].late,0);assert.equal(notified.rows[0].flag,false);assert.equal(notified.rows[0].nil,null);
});
function chips(f){
 functions(f);const kpi=node('ordersKpi'),active=node('active'),clear=node('clear'),status=node('status'),del=node('del'),season=node('season'),exf=node('exf');
 active.dataset.orderActive='Active';clear.dataset.act='clearAll';status.dataset.status='Open';del.dataset.deltype='Air';season.dataset.season='S6';exf.dataset.exf='past';
 kpi.many.set('[data-order-active]',[active]);kpi.many.set('[data-status]',[status]);kpi.many.set('[data-deltype]',[del]);kpi.many.set('[data-season]',[season]);kpi.many.set('[data-exf]',[exf]);kpi.many.set('.kpi:not([data-qfg-col])',[clear,status,del,season,exf]);f.nodes.set(kpi.id,kpi);
 Object.assign(f.ctx,{html:'',selectedActive:new Set(),mirrored:['STATUS','Del. Type','Season','Ex-factory'],qfgFinish(){},mirroredQuickValueActive:()=>false});
 const renderer=extractFunction(f.source,'renderOrdersNow');f.evaluate(between(renderer,"  const kpi=document.getElementById('ordersKpi');",'  scheduleCoreAutoFilterSave();'));
 return {kpi,active,clear,status,del,season,exf};
}
for(const kind of ['active','clear','status','del','season','exf'])test('actual KPI '+kind+' click gates entire semantic command before mutation/render',async()=>{
 const f=fixture(),c=chips(f);if(kind==='clear'){f.state.ordersQuickActive.add('Active');f.state.colFilters.orders.STATUS={values:new Set(['Open'])};}
 const task=fire(c[kind],'click');await tick();assert.equal(f.events.includes('render'),false);assert.equal(f.events.includes('save'),false);
 if(kind==='clear')assert.ok(f.state.ordersQuickActive.has('Active'));else if(kind==='active')assert.equal(f.state.ordersQuickActive.size,0);
 f.settle();await task;assert.equal(f.events.includes('render'),true);
 if(kind==='active')assert.ok(f.state.ordersQuickActive.has('Active'));if(kind==='clear')assert.equal(f.state.ordersQuickActive.size,0);
});
test('actual dynamic model quick-chip callback awaits whole handler, including its trailing rerender',async()=>{
 const f=fixture();functions(f);const chip=node('dynamic');chip.dataset.qfgCol='__CPX_PROBE';chip.dataset.qfgValue='0';const host=node('host');host.many.set('[data-qfg-col]',[chip]);
 Object.assign(f.ctx,{MODULES:{orders:{tableKey:'orders',navigates:false}},host,rerender:()=>f.events.push('render')});
 f.evaluate(nested(baseline?quickSource:quickPatched,'bindExtra'));f.ctx.bindExtra('orders',host,f.ctx.rerender);
 const task=fire(chip,'click');await tick();assert.equal(f.state.colFilters.orders.__CPX_PROBE,undefined);assert.equal(f.events.includes('render'),false);
 f.settle();await task;assert.ok(f.state.colFilters.orders.__CPX_PROBE.values.has('0'));assert.equal(f.events.filter(e=>e==='render').length,1);
});
test('actual table header sort click waits for full and uses actual Orders callback after target recheck',async()=>{
 const f=fixture(),table=node('ordersTable'),thead=node('thead'),th=node('th'),label=node('label');th.dataset.k='Order Code';th.one.set('.thLabel',label);thead.many.set('tr.colRow th[data-k]',[th]);f.nodes.set(table.id,table);
 Object.assign(f.ctx,{table,thead,tableId:table.id,tableKey:'orders',COLS_BY_TABLE:{orders:[{k:'Order Code',type:'ro'}]},opts:{},withChk:false,
  attachDrag(){},attachResize(){},ordersCycleImageSize(){},onSort:null});
 const renderer=extractFunction(f.source,'renderOrdersNow');f.evaluate(callback(renderer,"  renderFullTable('ordersTable','orders',rows,state.ordersSort,key=>{",'actualOrdersSort','key')+'\nonSort=actualOrdersSort;');
 const declaration=extractFunction(f.source,'renderFullTable');f.evaluate(between(declaration,"  thead.querySelectorAll('tr.colRow th[data-k]').forEach(th=>{",'  if(withChk){'));
 const task=fire(label,'click');await tick();assert.equal(f.state.ordersSort.key,null);f.settle();await task;assert.equal(f.state.ordersSort.key,'Order Code');assert.equal(f.events.includes('render'),true);
});
test('actual managed selection popover removal waits before snapshot/draw and mutates only the full selection',async()=>{
 const f=fixture();functions(f);f.load(['managedSelectionSnapshot','managedSelectionSourceRows']);f.state.ordersSelected.add('row-a');
 Object.assign(f.ctx,{filteredOrders:()=>f.state.orders.rows,partialViewRows:(_table,rows)=>rows});
 f.evaluate(between(f.source,'window.BLManagedSelection={','\n};')+'\n};');
 const panel=node('selection-panel'),button=node('remove');button.dataset.selectionRemove='row-a';
 Object.assign(f.ctx,{panel,root:f.ctx,lastKey:'orders',closePanel(){},schedule:()=>f.events.push('schedule'),drawPanel:()=>{const value=f.ctx.BLManagedSelection.snapshot('orders');f.events.push({type:'panel',rows:value.rows});}});
 const selected=baseline?barSource:barPatched;f.evaluate(between(selected,"    panel.addEventListener('click',event=>{","    doc.addEventListener('click'"));
 const task=fire(panel,'click',{target:button});await tick();assert.ok(f.state.ordersSelected.has('row-a'));assert.equal(f.events.some(e=>e&&e.type==='panel'),false);
 f.settle();await task;assert.equal(f.state.ordersSelected.size,0);assert.equal(f.events.some(e=>e&&e.type==='panel'),true);
});
test('public managed snapshot fails closed on thin while full keeps exact row references',()=>{
 const f=fixture();f.load(['managedSelectionSnapshot','managedSelectionSourceRows']);Object.assign(f.ctx,{filteredOrders:()=>f.state.orders.rows,partialViewRows:(_t,rows)=>rows});
 assert.throws(()=>f.ctx.managedSelectionSnapshot('orders'),{code:'ORDERS_FULL_REQUIRED'});
 const full=fixture({thin:false});full.load(['managedSelectionSnapshot','managedSelectionSourceRows']);full.state.ordersSelected.add('row-a');Object.assign(full.ctx,{filteredOrders:()=>full.state.orders.rows,partialViewRows:(_t,rows)=>rows});
 assert.strictEqual(full.ctx.managedSelectionSnapshot('orders').rows[0],full.state.orders.rows[0]);assert.equal(full.fetches(),0);
});
test('actual partial-toggle click waits before state/logistic/render mutation',async()=>{
 const f=fixture(),button=node('partial');button.dataset.partialViewToggle='orders';let handler;
 Object.assign(f.ctx,{partialViewState:{orders:false},cpLogisticExpandedSet:()=>new Set(),renderTableViewContext:()=>f.events.push('view')});f.load(['partialViewEnabled','setPartialView']);
 f.ctx.document.addEventListener=(_type,fn)=>{handler=fn;};
 f.evaluate(between(f.source,"document.addEventListener('click',event=>{\n  const button=event.target.closest?.('[data-partial-view-toggle]')","\ndocument.addEventListener('dblclick'"));
 const task=handler({target:button});await tick();assert.equal(f.ctx.partialViewState.orders,false);assert.equal(f.events.includes('view'),false);
 f.settle();await task;assert.equal(f.ctx.partialViewState.orders,true);assert.equal(f.events.includes('view'),true);
});
for(const kind of ['details','dismiss'])test('actual selection-bar '+kind+' initiator awaits full before reading rows or clearing selection',async()=>{
 const f=fixture();functions(f);f.load(['managedSelectionSnapshot','managedSelectionSourceRows']);f.state.ordersSelected.add('row-a');Object.assign(f.ctx,{filteredOrders:()=>f.state.orders.rows,partialViewRows:(_t,rows)=>rows});
 f.evaluate(between(f.source,'window.BLManagedSelection={','\n};')+'\n};');
 const bar=node('bar'),panel=node('panel'),button=node('button');panel.hidden=true;button.dataset[kind==='details'?'selectionDetails':'selectionDismiss']='';
 Object.assign(f.ctx,{bar,panel,root:f.ctx,lastKey:'orders',closePanel(){},schedule:()=>f.events.push('schedule'),drawPanel:()=>{const snapshot=f.ctx.BLManagedSelection.snapshot('orders');f.events.push({type:'snapshot',rows:snapshot.rows});}});
 f.evaluate(between(baseline?barSource:barPatched,"    bar.addEventListener('click',event=>{",'\n  }\n  function closePanel'));
 const task=fire(bar,'click',{target:button});await tick();assert.ok(f.state.ordersSelected.has('row-a'));assert.equal(f.events.some(e=>e&&e.type==='snapshot'),false);
 f.settle();await task;if(kind==='dismiss')assert.equal(f.state.ordersSelected.size,0);else{assert.equal(panel.hidden,false);assert.equal(f.events.find(e=>e&&e.type==='snapshot').rows[0].late,0);}
});
test('full select-all retains synchronous exact old references and notification behavior',()=>{
 const f=fixture({thin:false}),s=selection(f,'all'),rows=f.state.orders.rows;s.all.checked=true;
 assert.equal(fire(s.all,'change'),undefined);assert.deepEqual([...f.state.ordersSelected],['row-a','row-b']);assert.equal(f.fetches(),0);
 const notified=f.events.find(e=>e&&e.type==='notified');assert.strictEqual(notified.rows,rows);assert.strictEqual(notified.selected,f.state.ordersSelected);assert.equal(f.events.includes('table-render'),true);
});
test('all guarded named sink full bodies remain byte-exact after removing only the new thin-only entry lines',()=>{
 for(const name of ['removeActiveFilterToken','clearTableFilters','clearColumnFilters','toggleMirroredQuickFilter','toggleOrdersQuickExFactory','toggleOrdersActiveQuick','setPartialView','cycleCheckFilter','managedSelectionChange','managedSelectionSnapshot']){
  const next=extractFunction(patched,name).split('\n').filter(line=>!(line.includes('ordersProjectionIsThin()')&&(line.includes('ordersUiChange(')||line.includes("code:'ORDERS_FULL_REQUIRED'")))).join('\n');
  assert.equal(next,extractFunction(source,name),name+' exact full body');
 }
});
test('guarded patch preserves protected actual CP/clipboard declarations and all old provider implementations byte-for-byte',()=>{
 for(const name of ['ensureCpLoaded','registerManagedGridClipboard','syncUnifiedPrioritiesForTable','cpEvaluateAll','applyFormulaColumns'])assert.equal(extractFunction(patched,name),extractFunction(source,name));
 for(const prefix of ['window.BLAIScreenData = {','window.BLFormulaRows = {'])assert.equal(between(patched,prefix,'\n};'),between(source,prefix,'\n};'));
});
