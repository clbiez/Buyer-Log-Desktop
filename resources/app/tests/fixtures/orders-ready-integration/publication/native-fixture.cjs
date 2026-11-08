'use strict';
// Test-only actual source setup. Import/execute only under root's common lock.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),zlib=require('node:zlib');
const APP=process.env.BL_ORDERS_PUBLICATION_APP_ROOT||path.resolve(__dirname,'../../../..');assert.ok(APP,'set BL_ORDERS_PUBLICATION_APP_ROOT');
const product=name=>path.join(APP,name),actual=require(product('tests/fixtures/orders-projection-client/runtime.cjs'));
const retirement=require(product('tests/helpers/orders-retirement-source.js'));
const ownedApi=require(product('public/orders-owned-json.js')),uiApi=require(product('public/orders-ui-command.js'));
const candidate=require(product('public/orders-publication.js'));
const prior=path.resolve(__dirname,'../wiring'),seed=fs.readFileSync(path.join(prior,'snippets/capture-seed.js'),'utf8');
const captures=fs.readFileSync(path.join(prior,'snippets/app-first-slice.js'),'utf8');
assert.equal(actual.hash(seed),'27586659f024e9bd5bca2bc262f3717a702b4d12be206d8154cc35222750cde8');
assert.equal(actual.hash(captures),'1d659d8750a465c42c27c0062c7930082283ef4bdebc1249a36d49a348dae2bb','frozen previous capture, not edited');
const app=require('../source.cjs').base('public/app-main.js');
assert.equal(actual.hash(app),'ee50b8b649e5c2797470d13feb919ea5befc5f03d15823b4ae34d5f08363d04b');
assert.equal(actual.extractFunction(app,'reviveServerDates'),'function reviveServerDates(rows){ normalizeCPDates(rows); }');
const fn=(scope,name,source)=>Function('scope','with(scope){return ('+actual.extractFunction(source,name)+');}')(scope);
function deferred(){let resolve;return {promise:new Promise(r=>{resolve=r;}),resolve:value=>resolve(value)};}
async function setup(options={}){
 const f=await actual.coldFixture(),events=[],requests=[],gate=deferred(),started=deferred();
 const scope={...f.globals,state:f.state,window:f.window,AbortController,Set,Map,WeakMap,Date,Object,JSON,Promise,appLang:'en',
  activeProfilePage:()=> 'orders',currentActiveTab:()=> 'orders',authHydrationPromise:Promise.resolve({ready:true})};
 scope.state.orders=null;scope.window.BLOrdersUiCommand=uiApi;
 Function('window','BLStorage','localStorage',fs.readFileSync(product('public/quick-filter-groups.js'),'utf8'))(scope.window,scope.BLStorage,f.native);
 retirement.installLifecycle(vm.createContext(scope));
 for(const name of ['captureOrdersFiniteInputs','captureOrdersColdEligibility','waitOrdersColdEligibility'])scope[name]=fn(scope,name,seed);
 for(const name of ['captureOrdersQuickFilterEvidence','captureOrdersReadyInputs','captureOrdersReadySource'])scope[name]=fn(scope,name,captures);
 const client=actual.candidate.create({finiteApi:actual.actual.api,compiler:f.f.compiler,schemaApi:actual.schemaApi,formulaColumns:f.f.formula,
  readCurrent:scope.captureOrdersReadyInputs,captureCold:scope.captureOrdersColdEligibility,waitCold:scope.waitOrdersColdEligibility,
  settleOnFull:async()=>{throw Error('no fabricated full initialization');},sha256:async value=>actual.hash(value)});
 scope._ordersProjectionClient=client;
 const request=await client.prepare(f.metadata,'publication_ready_nonce');assert.equal(request.mode,'ready',request.reason);
 const result=await actual.builder.prepareReadyJson(f.f.full,{schema:f.metadata.schema,omittedKeys:request.body.omittedModelKeys,
  viewInfo:{ownerId:'owner',actorId:'owner',sourceKey:f.metadata.token.sourceProjectionKey,sourceGeneration:f.metadata.token.sourceGeneration,
   accessHash:f.metadata.token.accessHash,planEpoch:0,fullJsonSha256:actual.hash(f.rawText),fullJsonBytes:Buffer.byteLength(f.rawText)}});
 assert.equal(result.kind,'ready',result.reason);const bytes=zlib.gunzipSync(result.buffer);
 const owned=ownedApi.create({promotionApi:actual.promotion,sha256Bytes:async data=>actual.hash(data)});
 const wire=await owned.read(new Response(bytes,{status:200,headers:{...f.h,'Content-Type':'application/json','X-Orders-View-Mode':'ready',
  'X-Orders-Request-Nonce':'publication_ready_nonce','X-Orders-Plan-Hash':request.body.planHash,'X-Orders-View-Json-Bytes':String(bytes.length)}}),{current:()=>true});
 assert.equal(owned.owns(wire),true);const accepted=await client.accept(request,wire);
 const sourceNow=scope.captureOrdersReadySource(accepted),controllers=scope._ordersFullViewControllers;
 const router=fs.readFileSync(product('server/lib/orders-ready-http.js'),'utf8');
 const parentHeaders=actual.hostFunction('fullParentHeaders',{Buffer,stale:()=>Object.assign(Error('stale'),{code:'PROJECTION_VIEW_STALE'})},router)(f.metadata.token,
  {pin:{uncompressedBytes:Buffer.byteLength(f.rawText)},schema:{rowCount:f.metadata.schema.rowCount}});
 const transport=async(url,init)=>{
  requests.push({url,init});started.resolve();await gate.promise;
  const h={...f.h,...parentHeaders,'Content-Type':'application/json','X-Orders-View-Mode':'full','X-Orders-Request-Nonce':'publication_parent_nonce'};
  if(options.headersChange)options.headersChange(h);
  return new Response(options.bytesChange?options.bytesChange(Buffer.from(f.rawText)):Buffer.from(f.rawText),{status:200,headers:h});
 };
 const ordinaryFull=JSON.stringify(f.f.full),readyWire=JSON.stringify(accepted.payload),selected=scope.state.ordersSelected;
 const callbacks={state:scope.state,controllers,accepted,fname:'Sunucu: native fixture',getAccepted:()=>scope._ordersAcceptedReceipt,
  setAccepted:value=>{scope._ordersAcceptedReceipt=value;},sourceNow,promotionApi:actual.promotion,clientApi:actual.candidate,uiApi,
  fetch:transport,sha256Bytes:async data=>actual.hash(data),nonce:()=> 'publication_parent_nonce',
  normalizeDates:rows=>{events.push({kind:'normalize',live:scope.state.orders});f.f.reference.normalize(rows);},
  afterPricing:rows=>{events.push({kind:'pricing',rows,live:scope.state.orders});if(options.afterPricing)options.afterPricing(rows,scope);},
  invalidateOrders:()=>{events.push({kind:'invalidate',live:scope.state.orders});if(options.invalidateOrders)options.invalidateOrders(scope);}};
 const make=overrides=>candidate.create({...callbacks,...overrides});
 return {f,scope,accepted,sourceNow,controllers,make,callbacks,events,requests,gate,started,selected,ordinaryFull,readyWire,
  publish(overrides){const prepared=make(overrides);prepared.publishReady();return prepared;}};
}
module.exports={setup,deferred,actual,candidate,app,fn};
