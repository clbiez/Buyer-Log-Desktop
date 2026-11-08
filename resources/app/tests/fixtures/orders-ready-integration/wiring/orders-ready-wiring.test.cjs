'use strict';
// PREPARATION: root executes serially. Actual product modules + named app
// functions, no copied app snapshot, fake registry, or mocked finite client.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),zlib=require('node:zlib');
const APP=process.env.BL_ORDERS_WIRING_APP_ROOT||path.resolve(__dirname,'../../../..');
assert.ok(APP,'set BL_ORDERS_WIRING_APP_ROOT to the real resources/app');
const product=file=>path.join(APP,file),packet=path.join(__dirname);
const fxt=require(product('tests/fixtures/orders-projection-client/runtime.cjs'));
const retirement=require(product('tests/helpers/orders-retirement-source.js'));
const coordinator=require(product('public/orders-ready-load.js')),recipe=require('./snippets/fetch-recipe.cjs');
const ownedApi=require(product('public/orders-owned-json.js')),uiApi=require(product('public/orders-ui-command.js'));
const {coldFixture,candidate:clientApi,promotion,hash,builder,extractFunction}=fxt;
const reviewed=require('../source.cjs');const app=reviewed.base('public/app-main.js');assert.equal(hash(app),recipe.BASE_APP,'exact current before-wiring app');
assert.equal(hash(fs.readFileSync(product('public/orders-owned-json.js'))),'9295fc79956b2dfbff1b230af69c70fa02d1f8e2c5cbd07a65ddd97fc6a5606b','actual schema-owned reader followup');
assert.equal(hash(fs.readFileSync(product('server/lib/orders-ready-http.js'))),'b4adbc88603bbaac7c1498668090a6cae87e559f3168f0650076a6a4f2183247','actual schema/view length producer followup');
const seed=fs.readFileSync(path.join(packet,'snippets/capture-seed.js'),'utf8');
assert.equal(hash(seed),'27586659f024e9bd5bca2bc262f3717a702b4d12be206d8154cc35222750cde8','unchanged actual handoff seed');
const extra=fs.readFileSync(path.join(packet,'snippets/app-first-slice.js'),'utf8');
const source=process.env.BL_ORDERS_WIRING_BASELINE==='1'?app:reviewed.current('public/app-main.js');
const functionIn=(scope,name,text)=>Function('scope','with(scope){return ('+extractFunction(text,name)+');}')(scope);
async function setup({cacheHit=true,afterSchema,afterReady,headersChange}={}){
 const f=await coldFixture(),calls=[];let opened=0,reads=0,accepts=0;
 const scope={...f.globals,Promise,AbortController,Set,Map,WeakMap,Date,Object,JSON,performance:{now:()=>0},location:{href:''},appLang:'en',
  state:f.state,window:f.window,coreFilterAutoReady:true,currentActiveTab:()=> 'orders',activeProfilePage:()=> 'orders',authHydrationPromise:Promise.resolve({ready:true})};
 scope.window.BLOrdersUiCommand=uiApi;
 Function('window','BLStorage','localStorage',fs.readFileSync(product('public/quick-filter-groups.js'),'utf8'))(scope.window,scope.BLStorage,f.native);
 const context=vm.createContext(scope);retirement.installLifecycle(context);
 for(const name of ['captureOrdersFiniteInputs','captureOrdersColdEligibility','waitOrdersColdEligibility'])scope[name]=functionIn(scope,name,seed);
 for(const name of ['ordersHasPotentialReadyModelKey','captureOrdersQuickFilterEvidence','captureOrdersReadyInputs','ordersReadyFirstSliceEligible','captureOrdersReadyLoadLease','ordersReadyLoadLeaseCurrent','captureOrdersReadySource','bindOrdersReadyUiController'])scope[name]=functionIn(scope,name,extra);
 const client=clientApi.create({finiteApi:fxt.actual.api,compiler:f.f.compiler,schemaApi:fxt.schemaApi,formulaColumns:f.f.formula,
  readCurrent:scope.captureOrdersReadyInputs,captureCold:scope.captureOrdersColdEligibility,waitCold:scope.waitOrdersColdEligibility,
  settleOnFull:async()=>{throw Error('cold wiring must not settle from fabricated full rows');},sha256:async value=>hash(value)});
 scope._ordersProjectionClient=client;
 const owned=ownedApi.create({promotionApi:promotion,sha256Bytes:async bytes=>hash(bytes)});
 const observedClient={prepare:(...args)=>client.prepare(...args),accept:(...args)=>{accepts++;return client.accept(...args);},invalidate:()=>client.invalidate()};
 const reply=(payload,headers)=>new Response(JSON.stringify(payload),{status:200,headers:{...headers,'Content-Type':'application/json'}});
 const fullHeaders={...f.h,'X-Orders-View-Mode':'full','X-Orders-View-Json-Bytes':String(Buffer.byteLength(f.rawText))};
 const transport=async(url,options={})=>{
  calls.push({url,options});
  if(url==='/api/page-projection/orders/schema'){if(afterSchema)await afterSchema(scope,f);return reply(f.metadata,{'X-Orders-Schema-Json-Bytes':String(Buffer.byteLength(JSON.stringify(f.metadata)))});}
  if(url==='/api/page-projection/orders/ready'){
   const request=JSON.parse(options.body),h={...f.h,'X-Orders-Request-Nonce':request.requestNonce,'X-Orders-Plan-Hash':request.planHash};
   let payload;
   if(cacheHit){
    const result=await builder.prepareReadyJson(f.f.full,{schema:f.metadata.schema,omittedKeys:request.omittedModelKeys,
     viewInfo:{ownerId:'owner',actorId:'owner',sourceKey:f.metadata.token.sourceProjectionKey,sourceGeneration:f.metadata.token.sourceGeneration,
      accessHash:f.metadata.token.accessHash,planEpoch:0,fullJsonSha256:hash(f.rawText),fullJsonBytes:Buffer.byteLength(f.rawText)}});
    assert.equal(result.kind,'ready',result.reason);const bytes=zlib.gunzipSync(result.buffer);payload=JSON.parse(bytes);h['X-Orders-View-Mode']='ready';h['X-Orders-View-Json-Bytes']=String(bytes.length);
   }else{payload=f.f.full;Object.assign(h,fullHeaders);}
   if(afterReady)await afterReady(scope,f);if(headersChange)headersChange(h);return reply(payload,h);
  }
  assert.ok(url==='/api/page-projection/orders'||url==='/api/data/orders',url);return reply(f.f.full,fullHeaders);
 };
 scope.ORDERS_FINITE_READY_ENABLED=true;scope.ensureOrdersReadyProjectionRuntime=async()=>null;
 scope.fetch=transport;scope.parseProjectionResponse=functionIn(scope,'parseProjectionResponse',app);
 const flight={abort:new AbortController(),epoch:scope._ordersProjectionSourceEpoch,sessionEpoch:scope._ordersUiSessionEpoch,
  profile:scope.state.currentUser,userContext:scope.window.BL_USER_CONTEXT};scope._ordersLoadFlight=flight;
 // Actual owned reader's schema receipt shares the same instance WeakSet.
 // No response.json/text shim or second byte reader exists in this fixture.
 const rt={client:observedClient,ownedJson:{read:async(...args)=>{reads++;return owned.read(...args);},owns:owned.owns},
  readMetadata:(...args)=>owned.readSchema(...args)};
 scope._ordersReadyProjectionLoader=coordinator.create({eligible:scope.ordersReadyFirstSliceEligible,captureLease:scope.captureOrdersReadyLoadLease,isLeaseCurrent:scope.ordersReadyLoadLeaseCurrent,
  runtime:async()=>{opened++;return rt;},fetch:transport,nonce:()=> 'native_wiring_nonce'});
 const fetchOrders=functionIn(scope,'fetchOrdersProjection',source);
 return {f,scope,client,flight,fetchOrders,calls,owned,rt,stats:()=>({opened,reads,accepts})};
}
test('RED seam: actual fetchOrdersProjection uses real metadata/native ready/client before hydration',async()=>{
 const s=await setup();assert.equal(s.scope.ordersReadyFirstSliceEligible(),true);
 const result=await s.fetchOrders({signal:s.flight.abort.signal});
 assert.equal(result.accepted?.mode,'ready','actual fetch must reach the owned ready path');
 assert.deepEqual(s.calls.map(c=>c.url),['/api/page-projection/orders/schema','/api/page-projection/orders/ready']);
 assert.equal(s.stats().accepts,1);assert.equal(result.payload,result.accepted.payload);
 assert.equal(s.f.state.orders,undefined,'fetch seam does not hydrate/publish state');result.accepted.assertCurrent();
 assert.equal(result.payload.rows[0].unknown.zero,0);assert.equal(result.payload.rows[0].unknown.false,false);assert.equal(result.payload.rows[0].unknown.nil,null);
 assert.equal(Object.hasOwn(result.payload.rows[1],'Probe'),false);
 assert.ok(Object.hasOwn(result.payload.rows[0],'__CPX_UNREGISTERED'));
});
test('disabled, CPX0 and fullOnly preserve actual ordinary full without feature runtime or metadata roundtrip',async()=>{
 for(const mode of ['disabled','no-cpx','fullOnly']){
  const s=await setup();if(mode==='disabled')s.scope._ordersReadyProjectionLoader=null;
  if(mode==='no-cpx')s.scope.ORDERS_COLS=s.scope.ORDERS_COLS.filter(c=>!c.modelCustom);
  const result=await s.fetchOrders({fullOnly:mode==='fullOnly',signal:s.flight.abort.signal});
  assert.equal(result.accepted,undefined);assert.deepEqual(s.calls.map(c=>c.url),['/api/page-projection/orders']);
  assert.deepEqual(s.stats(),{opened:0,reads:0,accepts:0});assert.deepEqual(result.payload,s.f.f.full);
 }
});
test('ready-cache MISS reuses immediate ordinary full without finite accept or redundant GET',async()=>{
 const s=await setup({cacheHit:false}),result=await s.fetchOrders({signal:s.flight.abort.signal});
 assert.equal(result.accepted,undefined);assert.deepEqual(result.payload,s.f.f.full);assert.deepEqual(s.stats(),{opened:1,reads:1,accepts:0});
 assert.deepEqual(s.calls.map(c=>c.url),['/api/page-projection/orders/schema','/api/page-projection/orders/ready']);
});
test('actual QFG swallowed malformed/unknown/legacy extra never becomes eligibility authority',async()=>{
 for(const [key,value] of [['bl.user.owner.bl.quickFilterGroups.orders.v1','{bad'],['bl.user.owner.bl.quickFilterGroups.orders.v1','{}'],
  ['bl.quickFilterGroups.orders.v0','{"hidden":[],"extra":["__CPX_UNUSED"]}']]){
  const s=await setup();s.f.native.setItem(key,value);
  if(value==='{bad'||value==='{}')assert.deepEqual(s.scope.window.BLQuickFilterGroups.config('orders').extra,[],'actual UI masks malformed input');
  assert.equal(s.scope.ordersReadyFirstSliceEligible(),false);await s.fetchOrders({signal:s.flight.abort.signal});
  assert.deepEqual(s.calls.map(c=>c.url),['/api/page-projection/orders']);assert.equal(s.stats().opened,0);
 }
});
test('actual selection, legacy control, sort and partial prerequisites decline before metadata',async()=>{
 for(const mutate of [s=>s.f.state.ordersSelected.add('id'),s=>{s.f.controls.get('ordersFStatus').value='Active';},
  s=>{s.f.state.ordersSort.key='__CPX_UNUSED';},s=>{s.scope.partialViewEnabled=()=>true;}]){
  const s=await setup();mutate(s);await s.fetchOrders({signal:s.flight.abort.signal});assert.equal(s.stats().opened,0);
  assert.deepEqual(s.calls.map(c=>c.url),['/api/page-projection/orders']);
 }
});
test('real lifecycle profile/source/actor invalidation cancels old flight without ordinary publication',async()=>{
 for(const change of [scope=>{scope.state.currentUser={id:'owner'};},scope=>scope.retireOrdersProjectionSource('native-source'),
  scope=>{scope.window.BL_USER_CONTEXT={id:'another'};},scope=>{scope.state.currentUser.id='another';},scope=>{scope.activeProfilePage=()=> 'cp';}]){
  const s=await setup({afterSchema:async scope=>change(scope)}),result=await s.fetchOrders({signal:s.flight.abort.signal});
  assert.equal(result.cancelled,true);assert.deepEqual(s.calls.map(c=>c.url),['/api/page-projection/orders/schema']);assert.equal(s.stats().accepts,0);
 }
});
test('QFG raw drift or wrong owner header makes actual client decline ready and use current ordinary full',async()=>{
 for(const options of [{afterReady:async(_scope,f)=>f.native.setItem('bl.user.owner.bl.quickFilterGroups.orders.v1','{"hidden":["season"],"extra":[]}')},
  {headersChange:h=>{h['X-Orders-Owner-B64']='b3RoZXI';}}]){
  const s=await setup(options),result=await s.fetchOrders({signal:s.flight.abort.signal});assert.equal(result.accepted,undefined);
  assert.deepEqual(result.payload,s.f.f.full);assert.equal(s.calls.at(-1).url,'/api/page-projection/orders');
 }
});
test('missing transport closure or same-shaped unowned parse receipt cannot publish finite data',async()=>{
 for(const mutate of [s=>{s.rt.readMetadata=null;},s=>{const read=s.rt.readMetadata;s.rt.readMetadata=async(...args)=>({...await read(...args)});},
  s=>{const read=s.rt.ownedJson.read;s.rt.ownedJson.read=async(...args)=>({...await read(...args)});}]){
  const s=await setup();mutate(s);const result=await s.fetchOrders({signal:s.flight.abort.signal});
  assert.equal(result.accepted,undefined);assert.equal(s.calls.at(-1).url,'/api/page-projection/orders');assert.equal(s.stats().accepts,0);
 }
});
test('private controller source guard survives pending DOM while actual accepted capture rejects it',async()=>{
 const s=await setup(),result=await s.fetchOrders({signal:s.flight.abort.signal});assert.equal(result.accepted?.mode,'ready');
 const view={rows:result.payload.rows};
 // The real promotion helper is instantiated, never a no-op ensure/counter.
 const parent=result.accepted.parent,id={ownerId:parent.token.ownerId,sessionId:'native-session-'+s.scope._ordersUiSessionEpoch,
  sourceId:parent.token.sourceProjectionKey,generation:parent.token.sourceGeneration,accessHash:parent.token.accessHash,scopeHash:parent.guardStamp,
  module:'orders',planHash:parent.planHash,fullProjectionChecksum:parent.fullJsonSha256,fullByteLength:parent.fullJsonBytes,rowCount:parent.rowCount};
 let nativeState={kind:'thin',rows:view.rows,selectedRows:[],mutationRevision:0,selectionRevision:0,dirty:false,identity:id,requiredKeys:[],ordinals:[0,1]},readSource;
 const native=promotion.create({snapshot:()=>nativeState,isCurrent:()=>{readSource();return true;},
  // Transport proof itself is already covered by the unchanged actual client
  // 89a/full-parent tests; here fixed actual fixture bytes isolate UI binding.
  fetchFull:async()=>({bytes:Buffer.from(s.f.rawText),identity:id}),normalize:async rows=>({rows,ordinals:[0,1]}),
  publish:(next,{expected,assertCurrent})=>{assert.equal(nativeState,expected);assertCurrent();nativeState=next;s.f.state.orders={rows:next.rows};return next;}});
 const controller=s.scope.bindOrdersReadyUiController(view,result.accepted,native);readSource=controller.readSource;
 assert.equal(s.f.state.orders,undefined,'private controller construction does not publish a half-installed thin source');
 s.f.state.orders=view;s.scope._ordersAcceptedReceipt=result.accepted;
 s.f.controls.get('ordersSearch').value='pending input';assert.throws(()=>result.accepted.assertCurrent(),{code:'ORDERS_FULL_STALE'});
 const capture=controller.captureUiSource();capture.assertPending();const full=await controller.ensure({signal:s.flight.abort.signal});
 assert.equal(capture.assertPromoted(),full);assert.equal(full.rows,s.f.state.orders.rows);assert.ok(Object.hasOwn(full.rows[0],'__CPX_UNUSED'));
 assert.equal(s.f.controls.get('ordersSearch').value,'pending input','binding does not rebuild/replay DOM controls');
 s.f.state.overrides.pricingRules.push({probe:0});assert.throws(()=>capture.assertPromoted(),{code:'ORDERS_FULL_STALE'},'actual config remains part of source continuity');
 s.scope.retireOrdersProjectionSource('native-retire');assert.throws(()=>capture.assertPromoted(),{code:'ORDERS_FULL_STALE'});
});
test('exact recipe changes only fetch; ordinary branch and every existing app function restore exactly',()=>{
 const next=recipe.patch(app,extractFunction),old=extractFunction(app,'fetchOrdersProjection'),changed=extractFunction(next,'fetchOrdersProjection');
 assert.equal(next.replace(changed,old),app,'whole current app exact restoration, no ignored drift');
 for(const name of ['ensureOrdersLoaded','ensureOrdersFullForAction','filteredOrders','renderOrdersNow','syncCpModelColumns',
  'syncOrdersColumnsFromCp','syncUnifiedPrioritiesForTable','cpEvaluateAll'])assert.equal(extractFunction(next,name),extractFunction(app,name),name);
});
