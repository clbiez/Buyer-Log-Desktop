'use strict';
// Native draft, UNRUN. Root executes under its common lock.
const nativeTest=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto');
const test=(name,body)=>nativeTest(name,{timeout:5000},body),APP=process.env.BL_SCHEMA_APP_ROOT||path.resolve(__dirname,'../../../..');assert.ok(APP,'set BL_SCHEMA_APP_ROOT');
const root=name=>path.join(APP,name),packet=__dirname,recipe=require('./candidate/text-edits.cjs');
const lifecycle=require(root('tests/helpers/orders-retirement-source.js')),promotion=require(root('public/orders-full-promotion.js')),ui=require(root('public/orders-ui-command.js'));
const labels=require(root('public/column-display-names.js'));
const reviewed=require('../source.cjs'),base=reviewed.base('public/app-main.js'),personalBase=reviewed.base('public/personal-order-notes.js');
const helpers=fs.readFileSync(path.join(packet,'candidate/app-note-action-helpers.js'),'utf8'),patched=recipe.patchApp(base,lifecycle.extractFunction,helpers);
const baseline=process.env.BL_SCHEMA_BASELINE==='1',source=baseline?base:reviewed.current('public/app-main.js'),personalSource=baseline?personalBase:reviewed.current('public/personal-order-notes.js');
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex'),turn=()=>new Promise(resolve=>setImmediate(resolve));
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};}
function fixture({thin=true,active=true,promptWait,fetchWait,jsonWait}={}){
 const events=[],fullWait=deferred(),bytes=Buffer.from(JSON.stringify({rows:[{_id:1,'Order Code':7,hiddenModel:0}]}));
 const id={ownerId:'fixture-owner',sessionId:'fixture-session',sourceId:'fixture-source',generation:'fixture-page',accessHash:'fixture-access',scopeHash:'fixture-scope',module:'orders',planHash:'fixture-plan',fullProjectionChecksum:sha(bytes),fullByteLength:bytes.length,rowCount:1};
 let native={kind:thin?'thin':'full',rows:[{_id:1,'Order Code':7}],identity:id,ordinals:[0],selectedRows:[],requiredKeys:[],mutationRevision:0,selectionRevision:0,dirty:false},receipt=null,allowed=true,fullRequests=0;
 const state={orders:{rows:native.rows},ordersSelected:new Set(),cp:null,currentUser:{id:'fixture-owner'}};
 const values=new Map(),key='lcw.personalOrderNotes.definitions.v1',definition={id:'personal_note_existing',label:'Old',labelEn:'Old',labelTr:'Eski'};
 const actualKey=k=>'user.'+state.currentUser.id+'.'+k;
 values.set(actualKey(key),JSON.stringify([definition]));
 const storage={actualKey,getItem:k=>{events.push(['storage-read',k]);return values.get(actualKey(k))??null;},
  setItem:(k,v)=>{events.push(['storage-write',k]);values.set(actualKey(k),String(v));},removeItem:k=>{events.push(['storage-remove',k]);values.delete(actualKey(k));},
  native:{get length(){return values.size;},key:i=>[...values.keys()][i]??null}};
 const c=vm.createContext({state,AbortController,Set,Map,WeakMap,Promise,JSON,Date,Math,appLang:'en',BLColumnNames:labels,
  window:{BL_USER_CONTEXT:state.currentUser,BLCanAccessArea:()=>allowed,BLOrdersUiCommand:ui,BLStorage:storage,BLOrdersFiniteLifecycleRequired:active},
  currentActiveTab:()=> 'orders',activeProfilePage:()=> 'orders',CP_COLS:[],
  showToast:value=>events.push(['toast',value]),confirm:()=>{events.push(['confirm']);return true;},
  promptBilingualColumnName:options=>{events.push(['prompt',options]);return promptWait?promptWait.promise:Promise.resolve({en:'New',tr:'Yeni'});},
  forgetPersistedColumnKeys:(...args)=>events.push(['forget',...args]),renderCP:()=>events.push(['render-cp']),renderOrders:()=>events.push(['render-orders']),
  refreshPersonalOrderNoteColumns:()=>events.push(['refresh-personal']),
  fetch:async(url,init)=>{events.push(['fetch',url,init]);if(fetchWait)await fetchWait.promise;return {ok:true,json:async()=>{if(jsonWait)await jsonWait.promise;return {revision:2,columns:JSON.parse(init.body).columns};}};},
 });
 lifecycle.installLifecycle(c,active?{_ordersProjectionClient:{invalidate:()=>events.push(['invalidate'])}}:{});
 const guardStart=base.indexOf('const _ordersRequireFullSynchronousRead='),guardEnd=base.indexOf('\n};',guardStart)+3;
 assert.ok(guardStart>=0&&guardEnd>guardStart);
 vm.runInContext(base.slice(guardStart,guardEnd)+'\nwindow.BLOrdersRequireFullSynchronousRead=_ordersRequireFullSynchronousRead;\nlet _ordersUiCommandGate=null;\nlet CP_NOTE_COLUMN_DEFS=[];\nlet CP_NOTE_COLUMN_DEFS_REVISION=1;\nObject.defineProperty(globalThis,"sharedDefs",{get:()=>CP_NOTE_COLUMN_DEFS,set:v=>{CP_NOTE_COLUMN_DEFS=v;}});\nObject.defineProperty(globalThis,"sharedRevision",{get:()=>CP_NOTE_COLUMN_DEFS_REVISION,set:v=>{CP_NOTE_COLUMN_DEFS_REVISION=v;}});',c);
 vm.runInContext(helpers+'\n'+['ensureOrdersFullForAction','ordersUiChange','cpNoteColumnNameClash','saveCpNoteColumnDefs',
  'addPersonalOrderNoteColumn','renamePersonalOrderNoteColumn','removePersonalOrderNoteColumn','addCpNoteColumn','renameCpNoteColumn','removeCpNoteColumn'].map(name=>lifecycle.extractFunction(source,name)).join('\n')+'\nwindow.BLOrdersUiChange=ordersUiChange;',c);
 vm.runInContext(personalSource,c);c.BLStorage=storage;
 c.syncCpNoteColumns=defs=>{events.push(['sync-shared']);c.sharedDefs=defs;};
 c.sharedDefs=[{id:'note_existing',label:'Old shared',labelEn:'Old shared',labelTr:'Eski ortak'}];
 const profile=state.currentUser,epoch=c._ordersProjectionSourceEpoch,session=c._ordersUiSessionEpoch;
 const nativeController=promotion.create({snapshot:()=>native,fetchFull:async()=>{fullRequests++;return fullWait.promise;},normalize:(rows,{ordinals})=>({rows,ordinals}),
  isCurrent:()=>allowed&&state.currentUser===profile&&c._ordersProjectionSourceEpoch===epoch&&c._ordersUiSessionEpoch===session,
  publish:(next,{assertCurrent,expected})=>{assertCurrent();assert.equal(native,expected);native=next;state.orders={rows:next.rows};return next;}});
 const privateUi=ui.createPrivateSource({moduleNow:()=>state.orders,lastFull:()=>receipt,sourceNow:()=>Object.freeze({allowed,actorId:state.currentUser.id,
  sourceEpoch:c._ordersProjectionSourceEpoch,sessionEpoch:c._ordersUiSessionEpoch,parent:id.fullProjectionChecksum})});
 if(thin)c._ordersFullViewControllers.set(state.orders,{ensure:async options=>(receipt=await nativeController.ensure(options)),captureUiSource:()=>privateUi.capture()});
 events.length=0;return {c,state,events,storage,values,key,definition,fullWait,resolve:()=>fullWait.resolve({identity:id,bytes:new Uint8Array(bytes)}),
  get fullRequests(){return fullRequests;},revoke:()=>{allowed=false;}};
}
test('RED whole action: thin personal add must promote before prompt, definition/storage read or write',async()=>{
 const f=fixture(),pending=f.c.addPersonalOrderNoteColumn();
 assert.equal(f.events.some(e=>e[0]==='prompt'),false,'prompt must wait for actual full promotion');assert.equal(f.events.length,0);
 await turn();assert.equal(f.fullRequests,1);f.resolve();await pending;
 assert.equal(f.events.filter(e=>e[0]==='prompt').length,1);assert.equal(f.events.filter(e=>e[0]==='storage-write').length,1);
});
test('each high-level note/personal entry gates before prompt/confirm/definition captures while thin',async()=>{
 for(const [name,args] of [['renamePersonalOrderNoteColumn',['personal_note_existing']],['removePersonalOrderNoteColumn',['personal_note_existing']],
  ['addCpNoteColumn',[]],['renameCpNoteColumn',['note_existing']],['removeCpNoteColumn',['note_existing']]]){
  const f=fixture(),pending=f.c[name](...args);assert.equal(f.events.length,0,name);await turn();assert.equal(f.fullRequests,1,name);
  f.resolve();await pending;assert.ok(f.events.some(e=>e[0]==='prompt'||e[0]==='confirm'),name);
 }
});
test('full synchronous remove stays synchronous and preserves private other-account values',()=>{
 const f=fixture({thin:false,active:false}),prefix='lcw.personalOrderNotes.value.v1.personal_note_existing.';
 f.values.set('user.fixture-owner.'+prefix+'123%7Cline','mine');f.values.set('user.other.'+prefix+'123%7Cline','other');
 f.c.window.BLOrdersUiChange=()=>assert.fail('full must remain synchronous');assert.equal(f.c.removePersonalOrderNoteColumn('personal_note_existing'),undefined);
 assert.equal(f.fullRequests,0);assert.equal(f.values.has('user.fixture-owner.'+prefix+'123%7Cline'),false);assert.equal(f.values.get('user.other.'+prefix+'123%7Cline'),'other');
});
test('prompt pending actor/profile/page/source or definition change blocks private storage and schema refresh',async()=>{
 for(const change of [f=>{f.state.currentUser={id:'other'};},f=>{f.c.window.BL_USER_CONTEXT={id:'other'};},
  f=>{f.c.activeProfilePage=()=> 'cp';},f=>f.c.retireOrdersProjectionSource('dialog-source'),
  f=>f.values.set('user.fixture-owner.'+f.key,'[]'),f=>f.c.CP_COLS.push({k:'other',label:'Changed catalog'})]){
  const prompt=deferred(),f=fixture({thin:false,promptWait:prompt}),pending=f.c.renamePersonalOrderNoteColumn('personal_note_existing');
  change(f);prompt.resolve({en:'Changed',tr:'Değişti'});await pending;
  assert.equal(f.events.filter(e=>e[0]==='storage-write'||e[0]==='refresh-personal').length,0);
 }
});
test('shared prompt pending definition revision drift prevents PUT and ordinary full adds no new pre-prompt await',async()=>{
 const prompt=deferred(),f=fixture({thin:false,promptWait:prompt}),pending=f.c.renameCpNoteColumn('note_existing');
 assert.equal(f.events.filter(e=>e[0]==='prompt').length,1,'full prompt starts in the original call turn');
 f.c.sharedRevision++;prompt.resolve({en:'Changed',tr:'Değişti'});await pending;assert.equal(f.events.some(e=>e[0]==='fetch'),false);
});
test('shared HTTP/JSON pending drift cannot apply revision, persisted-key removal or schema',async()=>{
 for(const which of ['fetch','json'])for(const change of [f=>f.c.retireOrdersProjectionSource('response-source'),f=>{f.state.currentUser={id:'other'};},f=>{f.c.sharedRevision=7;}]){
  const wait=deferred(),f=fixture({thin:false,...(which==='fetch'?{fetchWait:wait}:{jsonWait:wait})}),pending=f.c.removeCpNoteColumn('note_existing');
  await turn();assert.equal(f.events.filter(e=>e[0]==='fetch').length,1);change(f);wait.resolve();await pending;
  assert.equal(f.events.some(e=>e[0]==='forget'||e[0]==='sync-shared'),false);assert.notEqual(f.c.sharedRevision,2);
 }
});
test('an inactive action that becomes armed rejects after prompt; remaining unarmed keeps original PUT semantics',async()=>{
 for(const arm of [false,true]){
  const prompt=deferred(),f=fixture({thin:false,active:false,promptWait:prompt}),pending=f.c.addCpNoteColumn();
  if(arm)f.c.window.BLOrdersFiniteLifecycleRequired=true;prompt.resolve({en:'New',tr:'Yeni'});await pending;
  assert.equal(f.events.filter(e=>e[0]==='fetch').length,arm?0:1);
 }
});
test('known successful shared write acknowledges only definition revision and retains original source intent',async()=>{
 const f=fixture({thin:false}),action=f.c.captureOrdersNoteAction('shared'),epoch=action.intent.epoch;
 await f.c.saveCpNoteColumnDefs([],action);assert.equal(action.intent.epoch,epoch);assert.equal(f.c.sharedRevision,2);
 f.c.assertOrdersNoteAction(action);assert.equal(f.events.filter(e=>e[0]==='fetch').length,1);
 const second=fixture({thin:false}),original=second.c.captureOrdersNoteAction('shared');
 second.c.syncCpNoteColumns=defs=>{second.c.sharedDefs=defs;second.c.retireOrdersProjectionSource('own-sync-retired');};
 await assert.rejects(second.c.saveCpNoteColumnDefs([],original),e=>e.code==='ORDERS_FULL_STALE');assert.equal(original.intent.epoch,0,'own write never rebases epoch');
});
test('low-level personal schema guards reject before input getter/coercion or storage; missing armed capability denies',()=>{
 const f=fixture();let reads=0;const next=new Proxy([],{get(){reads++;throw Error('input');}});
 assert.throws(()=>f.c.window.BLPersonalNoteColumns.setDefinitions(next),e=>e.code==='ORDERS_FULL_REQUIRED');
 assert.throws(()=>f.c.window.BLPersonalNoteColumns.removeDefinition({toString(){reads++;return 'personal_note_existing';}}),e=>e.code==='ORDERS_FULL_REQUIRED');
 assert.equal(reads,0);assert.equal(f.events.length,0);delete f.c.window.BLOrdersRequireFullSynchronousRead;
 assert.throws(()=>f.c.window.BLPersonalNoteColumns.setDefinitions([]),e=>e.code==='ORDERS_FULL_STALE');
});
test('writer without original action is legacy-compatible only while unarmed and fails finite import/rollback closed',async()=>{
 const active=fixture({thin:false});await assert.rejects(active.c.saveCpNoteColumnDefs([]),e=>e.code==='ORDERS_FULL_STALE');assert.equal(active.events.length,0);
 const legacy=fixture({thin:false,active:false});assert.equal(await legacy.c.saveCpNoteColumnDefs([]),undefined);assert.equal(legacy.events.filter(e=>e[0]==='fetch').length,1);
});
test('exact text edits restore whole app/personal source and preserve untouched original action bodies',()=>{
 let restored=patched.source.replace(patched.block,'');for(const edit of patched.changed.slice().reverse())restored=restored.replace(edit.next,edit.old);
 assert.equal(restored,base);assert.equal(sha(base),recipe.pins.app);assert.equal(sha(personalBase),recipe.pins.personal);
 for(const name of ['removeCpModelColumn','openCpModelColumnModal','writeCpModelColumn','syncCpModelColumns','syncCpNoteColumns',
  'syncOrdersColumnsFromCp','ensureCpLoaded','ensureOrdersLoaded','cpEvaluateAll','syncUnifiedPrioritiesForTable'])
  assert.equal(lifecycle.extractFunction(patched.source,name),lifecycle.extractFunction(base,name),name);
});
