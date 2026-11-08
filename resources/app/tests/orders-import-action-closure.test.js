'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {actualCpAdapter}=require('./helpers/cp-import-fixture'),{extractFunction}=require('./helpers/app-main-functions');
const turn=()=>new Promise(resolve=>setImmediate(resolve));
function openWizard(f){
 const wizard=fs.readFileSync(require('node:path').join(__dirname,'../public/excel-import-wizard.js'),'utf8'),start=wizard.indexOf('  function open('),scope={global:f.scope.window,modules:()=>true,toast:()=>{},T:(a,b)=>b,host:null,state:null,
  Profiles:{list:()=>[]},onClick:()=>{},onChange:()=>{},onKey:()=>{},render:()=>{},releaseKeyboard:null,
  reset:(moduleId,adapter)=>{scope.state={moduleId,adapter};},close:()=>{},document:{createElement:()=>({dataset:{},addEventListener(){}}),body:{appendChild:()=>f.events.push(['wizard-mounted'])},addEventListener(){}}};
 const names=['open','openPrepared'];
 for(const name of names){const i=wizard.indexOf('  function '+name+'(');if(i>=0)scope[name]=Function('scope','with(scope){return ('+extractFunction(wizard.slice(i+2),name)+');}')(scope);}
 return {scope,open:()=>scope.open('cp')};
}
test('thin Orders is promoted before CP import captures adapter/schema or mounts the wizard',async()=>{
 const f=actualCpAdapter({thin:true,finite:true}),w=openWizard(f),pending=w.open();
 assert.equal(f.events.some(e=>e[0]==='wizard-mounted'),false,'wizard must wait for actual full promotion');await turn();
 f.promote();await pending;assert.equal(f.events.filter(e=>e[0]==='wizard-mounted').length,1);
});
test('an armed full CP import passes its original note action through own column creation',async()=>{
 const f=actualCpAdapter({finite:true});const result=await f.adapter.createCustomColumns([{id:'new:1',label:'Synthetic new'}]);
 assert.equal(result.created.length,1);assert.equal(f.events.filter(e=>e[0]==='note-put').length,1);
});

function deferred(){let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};}
function planFor(f){return {executable:true,operations:[{op:'update',targetPosition:0,changes:[{fieldId:'Notes',kind:'set',to:'imported'}]}],revisionGuard:{storeRevision:1,rows:[{targetPosition:0,rev:f.adapter.rowRevision(f.row)}]}};}
async function until(check){for(let i=0;i<50;i++){if(check())return;await turn();}assert.fail('actual queue checkpoint not reached');}
test('a queued CP import rechecks source before actual queue dispatch',async()=>{
 const first=deferred(),f=actualCpAdapter({finite:true,actualQueue:true,actualItems:true,fetchJSON:url=>url==='/predecessor'?first.promise:{updated:1,revision:2}});
 const earlier=f.scope.enqueueOverrideMutation('orders','/predecessor',{});await until(()=>f.sent.length===1);
 const pending=f.adapter.execute(planFor(f),new Map());pending.catch(()=>{});f.scope.retireOrdersProjectionSource('foreign source');first.resolve({});await earlier;
 await assert.rejects(pending);assert.equal(f.sent.filter(e=>e[0]==='/api/overrides/batch').length,0);
});
test('a closed wizard blocks queued import even when actor and data source stay unchanged',async()=>{
 const first=deferred(),f=actualCpAdapter({finite:true,actualQueue:true,actualItems:true,fetchJSON:url=>url==='/predecessor'?first.promise:{updated:1,revision:2}});let open=true;f.adapter.bindOwner(()=>open);
 const earlier=f.scope.enqueueOverrideMutation('orders','/predecessor',{});await until(()=>f.sent.length===1);
 const pending=f.adapter.execute(planFor(f),new Map());pending.catch(()=>{});open=false;first.resolve({});await earlier;
 await assert.rejects(pending);assert.equal(f.sent.filter(e=>e[0]==='/api/overrides/batch').length,0);
});
test('a pending CP import response cannot advance revision or announce an ACK into a changed actor',async()=>{
 const wait=deferred(),f=actualCpAdapter({finite:true,actualQueue:true,actualItems:true,fetchJSON:()=>wait.promise});
 const pending=f.adapter.execute(planFor(f),new Map());pending.catch(()=>{});await until(()=>f.sent.length===1);
 f.state.currentUser={id:'other'};wait.resolve({updated:1,revision:8});await assert.rejects(pending);
 assert.equal(f.state.storeRevisions.orders,1);
});
test('a queued real plan rejects an edited original CP row before POST',async()=>{
 const first=deferred(),f=actualCpAdapter({finite:true,actualQueue:true,actualItems:true,fetchJSON:url=>url==='/predecessor'?first.promise:{updated:1,revision:2}});
 const earlier=f.scope.enqueueOverrideMutation('orders','/predecessor',{});await until(()=>f.sent.length===1);
 const pending=f.adapter.execute(planFor(f),new Map());pending.catch(()=>{});f.row.Notes='changed';first.resolve({});await earlier;
 await assert.rejects(pending);assert.equal(f.sent.filter(e=>e[0]==='/api/overrides/batch').length,0);
});

function wizardRun(f){
 const root=require('node:path'),text=fs.readFileSync(root.join(__dirname,'../public/excel-import-wizard.js'),'utf8'),testSource=fs.readFileSync(root.join(__dirname,'excel-import-completion-safety.test.js'),'utf8'),Plan=require('../public/excel-import-plan');
 const make=Function('text','assert','Plan','extractFunction','turn','deferred','return ('+extractFunction(testSource,'fixture')+');')(text,assert,Plan,extractFunction,turn,deferred);
 const w=make();w.scope.global=f.scope.window;w.scope.importActorSignature=w.scope.importActorStamp();w.state.adapter=f.adapter;
 w.plan.newColumns=[];w.plan.revisionGuard.rows[0].rev=f.adapter.rowRevision(f.row);return w;
}
test('a valid current real CP import dispatches once with its original revision and no private hook in HTTP options',async()=>{
 const f=actualCpAdapter({finite:true,actualQueue:true,actualItems:true});const result=await f.adapter.execute(planFor(f),new Map());
 assert.equal(result.updated,1);assert.equal(f.sent.length,1);assert.equal(f.sent[0][1].expectedRevision,1);assert.equal(Object.hasOwn(f.sent[0][1],'assertCurrent'),false);
 assert.equal(f.state.storeRevisions.orders,2);assert.equal(f.events.filter(e=>e[0]==='event'&&e[1]==='buyerlog:cp-write-ack').length,1);
});
test('whole actual reload preserves successful armed import feedback after its own profile and source transition',async()=>{
 const f=actualCpAdapter({finite:true,realRefresh:true}),w=wizardRun(f);await w.run();
 assert.equal(w.scope.state?.result?.status,'success',JSON.stringify(w.scope.state?.result));assert.equal(w.scope.state?.result?.updated,1);
 assert.equal(f.scope._ordersGlobalUpdateDepth,0);
});
test('armed completion cannot accept a fabricated successful loader without an actual callee receipt',async()=>{
 const f=actualCpAdapter({finite:true});await assert.rejects(f.adapter.refresh());
});
test('source supersession after actual reload completion cannot be adopted by the old import',async()=>{
 const f=actualCpAdapter({finite:true,realRefresh:true}),load=f.scope.loadFromServer;
 f.scope.loadFromServer=async(...args)=>{const value=await load(...args);f.scope.retireOrdersProjectionSource('after actual callee');return value;};
 const w=wizardRun(f);await w.run();assert.notEqual(w.scope.state?.result?.status,'success');
});

test('full import open preserves its original synchronous return and mounts without a promotion request',()=>{
 const f=actualCpAdapter({finite:false}),w=openWizard(f);assert.equal(w.open(),undefined);assert.equal(f.events.filter(e=>e[0]==='wizard-mounted').length,1);assert.equal(f.events.some(e=>e[0]==='full-fetch'),false);
});
for(const change of ['tab','source','actor'])test('thin import open does not mount after pending '+change+' changes',async()=>{
 const f=actualCpAdapter({thin:true,finite:true}),w=openWizard(f),pending=w.open();await turn();
 if(change==='tab')f.tab('orders');if(change==='source')f.scope.retireOrdersProjectionSource('foreign');if(change==='actor')f.state.currentUser={id:'other'};
 f.promote();await pending;assert.equal(f.events.some(e=>e[0]==='wizard-mounted'),false);
});
test('closing the owning wizard during note PUT prevents global schema publication after the response',async()=>{
 const wait=deferred(),f=actualCpAdapter({finite:true,noteWait:wait});let open=true;f.adapter.bindOwner(()=>open);
 const pending=f.adapter.createCustomColumns([{id:'new:1',label:'Synthetic new'}]);pending.catch(()=>{});await until(()=>f.events.some(e=>e[0]==='note-put'));
 open=false;wait.resolve();await assert.rejects(pending);assert.equal(f.scope.CP_NOTE_COLUMN_DEFS.length,1);assert.equal(f.scope.CP_NOTE_COLUMN_DEFS_REVISION,1);
});
test('a possible row write makes the captured column rollback unavailable',async()=>{
 const f=actualCpAdapter({finite:true,actualItems:true}),created=await f.adapter.createCustomColumns([{id:'new:1',label:'Synthetic new'}]);
 await f.adapter.execute(planFor(f),new Map());await assert.rejects(created.rollback());assert.equal(f.events.filter(e=>e[0]==='note-put').length,1);
});

test('note creation carries the existing client identity so its own master notification cannot race the import reload',async()=>{
 const f=actualCpAdapter({finite:true});f.scope.window.BL_CLIENT_ID='synthetic-own-window';
 await f.adapter.createCustomColumns([{id:'new:1',label:'Synthetic new'}]);const put=f.events.find(e=>e[0]==='note-put');
 assert.equal(put[2]['X-Client-Id'],'synthetic-own-window');assert.equal(put[2]['If-Match'],'1');
});

test('the unchanged real SSE handler skips only the originating window and still reloads foreign note changes',async()=>{
 const f=actualCpAdapter({finite:true}),source=f.source,prior=require('./fixtures/orders-import-action-closure/source.cjs').beforeImport();
 assert.equal(extractFunction(source,'initLiveSync'),extractFunction(prior,'initLiveSync'),'SSE behavior itself is unchanged');
 const start=source.indexOf('  const handle=payload=>{',source.indexOf('function initLiveSync(){')),end=source.indexOf('  const channel=',start);assert.ok(start>=0&&end>start);
 const run=(clientId,payload)=>{const received=[];const handle=Function('window','refreshSharedMasterClient','let liveSyncConnected=false;'+source.slice(start,end)+';return handle;')({BL_CLIENT_ID:clientId},area=>{received.push(area);return Promise.resolve();});handle(payload);return received;};
 const own={area:'noteColumnDefs',originClientId:'synthetic-own-window'};
 assert.deepEqual(run('synthetic-own-window',own),[]);assert.deepEqual(run('another-window',own),['noteColumnDefs']);
 assert.deepEqual(run('synthetic-own-window',{area:'noteColumnDefs',originClientId:'teammate'}),['noteColumnDefs']);
});
