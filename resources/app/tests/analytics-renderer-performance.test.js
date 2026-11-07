'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const publicRoot=path.join(__dirname,'../public');
const read=name=>fs.readFileSync(path.join(publicRoot,name),'utf8');

test('ANA-07: sort/filter only renders its table and reuses prepared rows',()=>{
  const source=read('lfl.js'),start=source.indexOf('  function renderCpTable('),end=source.indexOf('  function totalFooterByKey(',start);
  let options,fullRenders=0,mappings=0,filtered=false;
  const exports=new Map(),columns=[{key:'qty',type:'number'}],rows=[{qty:2},{qty:7}];
  const api={register(){},closeFilter(){},filteredRows:(_key,all)=>filtered?all.filter(r=>r.qty>2):all,render:o=>{options=o;}};
  const context={window:{BLTableFramework:api},state:{tableViews:{}},LFL_CP_TABLE_KEYS:{group:'lflGroup'},
    frameworkRows:r=>{mappings++;return r.map((row,i)=>({...row,_id:i,_source:row}));},frameworkColumns:c=>c,
    sortFrameworkRows:(r,_name)=>r.slice().sort((a,b)=>(a.qty-b.qty)*(context.state.tableViews.group?.dir||1)),
    emptyTableView:()=>({dir:1}),ensureCpTableTools(){},closeLflColumnPanel(){},frameworkCellHtml(){},
    attachLflColumnResize(){},bindLflDrillDown(){},LFL_TABLE_EXPORTS:exports,render:()=>{fullRenders++;}};
  vm.createContext(context);vm.runInContext(source.slice(start,end)+';globalThis.draw=renderCpTable;',context);
  context.draw({tableId:'t',viewName:'group',columns,sourceRows:rows});
  const prepared=options.allRows;options.onSort('qty');
  assert.equal(fullRenders,0,'sorting must preserve KPI/source/scenario/Trial DOM');
  assert.equal(mappings,1,'sorting must reuse the mapped view rows');assert.equal(options.allRows,prepared);
  filtered=true;options.rerender();assert.equal(fullRenders,0);assert.equal(mappings,1);
  assert.deepEqual(exports.get('t').rows,[rows[1]]);
  // A full analysis/language/FX/Trial render supplies fresh rows and closures.
  context.draw({tableId:'t',viewName:'group',columns,sourceRows:[{qty:11}]});
  assert.equal(mappings,2);assert.equal(exports.get('t').rows[0].qty,11);
});

test('ANA-11: step country normalization is linear, preserves duplicates and year scope',()=>{
  const engine=require('../public/transit-analysis');let reads=0;
  const records=Array.from({length:100},(_,i)=>({basis:'loading',year:'2026',period:'2026-01',country:'Demo '+i,vehicle:'Gemi',qty:i+1,endToEnd:30,transit:20,customs:2,loading:8}));
  const steps=records.flatMap((r,i)=>['2025','2026'].map(year=>({...r,year,code:'1',days:i,get country(){reads++;return 'DEMO '+i;}})));
  const all=engine.summarize({records,steps},{basis:'loading',year:'*'});
  assert.equal(all.rows.length,100);assert.equal(all.rows[12].steps.length,2);
  assert.ok(reads<=steps.length,'each step country is normalized at most once');
  const selected=engine.summarize({records,steps},{basis:'loading',year:'2026'});
  assert.ok(selected.rows.every(r=>r.steps.length===1));
});

test('ANA-07: persistent column/clear tools call the latest analysis closure',()=>{
  const source=read('lfl.js'),start=source.indexOf('  function ensureCpTableTools('),end=source.indexOf('  function lflResizeColumnType(',start);
  let existing=null,called=0,columnCallback;
  const elements=new Map(),element=key=>{if(!elements.has(key))elements.set(key,{addEventListener:(_type,fn)=>{elements.get(key).click=fn;},classList:{add(){},toggle(){}},setAttribute(){}});return elements.get(key);};
  const tools={dataset:{},querySelector:element},head={querySelector:()=>existing,appendChild:node=>{existing=node;}},card={querySelector:()=>head};
  const context={document:{createElement:()=>tools},$:()=>({closest:()=>card}),isEn:()=>true,esc:String,closeLflColumnPanel(){},openLflColumnPanel:null,requestAnimationFrame(){},exportLflTable(){},
    window:{BLTableFramework:{clearFilters(){},renderColumnPanel:(_key,_panel,callback)=>{columnCallback=callback;},isFrozen:()=>false}}};
  vm.createContext(context);vm.runInContext(source.slice(start,end)+';globalThis.ensure=ensureCpTableTools;',context);
  context.ensure('t','key',()=>{called=1;});context.ensure('t','key',()=>{called=2;});
  const event={preventDefault(){},stopPropagation(){},currentTarget:{}};
  element('[data-lfl-clear]').click(event);assert.equal(called,2,'clear filters must use the current dataset');
  called=0;element('[data-lfl-columns]').click(event);columnCallback();assert.equal(called,2,'column picker must use the current dataset');
});

function deliveryView(){
  const workers=[],Engine=require('../public/backlog-delivery-engine');
  class Worker {
    constructor(url){this.url=url;workers.push(this);}
    postMessage(message){this.message=message;(this.messages??=[]).push(message);}
    terminate(){this.terminated=true;}
    reply(data){this.onmessage({data});}
  }
  const context={window:{BLBacklogDeliveryEngine:Engine,BLBacklogDeliveryInsights:{defaultPreferences:()=>({}),build:()=>[]},BLBacklogRows:{load:async()=>[]}},
    Worker,URL,document:{readyState:'loading',addEventListener(){},getElementById:()=>null,baseURI:'http://localhost/'},
    BLStorage:{getItem:()=>null},backlogExportQueryParams:()=>({}),setTimeout,clearTimeout,Date,console};
  context.window.window=context.window;vm.createContext(context);vm.runInContext(read('backlog-delivery-analysis.js'),context);
  const view=context.window.BLBacklogAnalysis;view._state.rows=[];view._state.rowsSignature='{}';
  return {view,workers,Engine,context};
}
const turn=()=>new Promise(resolve=>setTimeout(resolve,10));
test('ANA-05: worker cancellation/generation guard and dataset reuse',async()=>{
  const {view,workers,Engine}=deliveryView();
  const a=view.refresh(false);await turn();assert.equal(workers.length,1,'cache miss runs in a browser Worker');
  const old=workers[0],oldMessage=old.message;
  const b=view.refresh(false);await turn();assert.equal(old.terminated,true);
  const current=workers[1],model=Engine.analyze([],{today:1});
  current.reply({generation:current.message.generation,model,rowIndices:[],periodRowCount:0,totalRowCount:0});await b;
  old.reply({generation:oldMessage.generation,model:{stale:true},rowIndices:[]});await a;
  assert.equal(view._state.model,model);assert.equal(view._state.loading,false);
  view._state.settings={...view._state.settings,requiredBufferRetail:99};
  const c=view.refresh(false);await turn();assert.equal(workers.length,2,'completed worker is reused');
  assert.equal(current.message.rows,undefined,'unchanged dataset is not cloned again');
  current.reply({generation:current.message.generation,model:Engine.analyze([]),rowIndices:[],periodRowCount:0,totalRowCount:0});await c;
  const d=view.refresh(false);await d;assert.equal(workers.length,2,'cache hit starts no job');
});

test('ANA-05: projected transport restores non-enumerable sourceRow and risk aliases; worker error recovers',async()=>{
  const {view,workers,Engine,context}=deliveryView(),F=Engine.FIELDS;
  const rows=[{[F.qty]:99,[F.retail]:'31.12.2026',unused:'not sent',_backlogExcel:{raw:'not sent',transitRule:{id:'rule'},signals:[{code:'DEMO'}]}}];
  context.dateOrdinal=value=>value==='31.12.2026'?20818:Engine.defaultOrdinal(value);
  view._state.rows=rows;const pending=view.refresh(false);await turn();
  const worker=workers[0],upload=worker.messages[0];
  assert.equal(upload.kind,'rows');assert.equal(upload.rows[0].unused,undefined);assert.equal(upload.rows[0]._backlogExcel.raw,undefined);
  assert.equal(upload.rows[0]._backlogExcel.transitRule,true);assert.equal(upload.ordinals.find(([key])=>key==='string:31.12.2026')[1],20818);
  const model=Engine.analyze(rows,{dateOrdinal:context.dateOrdinal,today:22000}),generation=worker.message.generation;
  worker.reply({kind:'orders',generation,orders:structuredClone(model.orders),rowIndices:[0]});
  worker.reply({kind:'result',generation,model:structuredClone({...model,orders:[],topRiskOrders:[]}),topRiskIndices:[0],periodRowCount:1,totalRowCount:1});await pending;
  assert.equal(view._state.model.orders[0].sourceRow,rows[0]);
  assert.equal(Object.getOwnPropertyDescriptor(view._state.model.orders[0],'sourceRow').enumerable,false);
  assert.equal(view._state.model.topRiskOrders[0],view._state.model.orders[0]);
  view._state.model=null;const failed=view.refresh(false);await turn();worker.onerror();await failed;
  assert.equal(view._state.loading,false);assert.ok(view._state.error);assert.equal(worker.terminated,true);
  view._state.rows=[];const recovered=view.refresh(false);await turn();const next=workers.at(-1);
  next.reply({kind:'result',generation:next.message.generation,model:Engine.analyze([]),topRiskIndices:[],periodRowCount:0,totalRowCount:0});await recovered;
  assert.equal(view._state.error,'');assert.equal(view._state.loading,false);
});

test('ANA-05: worker runs canonical engine with caller ordinals and restores filtered order mapping',()=>{
  const file=path.join(publicRoot,'backlog-delivery-worker.js');assert.ok(fs.existsSync(file),'external worker entry exists');
  let result,packets=[];
  const context={postMessage:data=>{result=structuredClone(data);packets.push(result);},performance,console};
  vm.createContext(context);context.importScripts=(...names)=>names.forEach(name=>vm.runInContext(read(name),context));
  vm.runInContext(fs.readFileSync(file,'utf8'),context);
  const E=require('../public/backlog-delivery-engine'),F=E.FIELDS;
  const rows=[{[F.qty]:10,[F.retail]:'31.12.2026',[F.plannedLoad]:47000,_backlogExcel:{handoverDate:'bad'}},{[F.qty]:20,[F.retail]:'01.01.2027'}];
  const ordinal=value=>({'31.12.2026':20818,'01.01.2027':20819,'47000':21431}[value]??null);
  const values=[undefined,'31.12.2026','01.01.2027',47000,'bad'];
  const ordinals=values.map(value=>[typeof value+':'+String(value),ordinal(value)]);
  context.onmessage({data:{kind:'rows',rows,ordinals}});
  context.onmessage({data:{generation:1,settings:{},today:20000,bounds:{to:20818}}});
  result.model.orders=packets.filter(p=>p.kind==='orders').flatMap(p=>p.orders);
  result.model.topRiskOrders=result.topRiskIndices.map(index=>result.model.orders[index]);
  const expected=E.analyze(rows.slice(0,1),{today:20000,dateOrdinal:ordinal});
  const canonical=value=>JSON.parse(JSON.stringify({...value,context:{...value.context,generatedAt:''}}));
  assert.deepEqual(canonical(result.model),canonical(expected));assert.deepEqual(packets[0].rowIndices,[0]);
  packets=[];
  context.onmessage({data:{generation:2,settings:{targetType:'inStore'},today:20000,bounds:null}});
  assert.equal(packets[0].orders.length,2,'small parameter message uses the same dataset');
});
