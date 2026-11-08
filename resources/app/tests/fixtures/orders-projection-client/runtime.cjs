'use strict';
// Portable test-only adapter over the frozen actual source; no application activation.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto'),zlib=require('node:zlib');
const APP=path.resolve(__dirname,'../../..');
const PACKET=path.resolve(APP,'../../docs/performance-program/parallel-handoff-20261108/01-orders-client');
const actual=require(path.join(APP,'tests/contracts/orders/runtime-fixture.cjs'));
const {extractFunction}=require(path.join(APP,'tests/helpers/app-main-functions.js'));
const schemaApi=require(path.join(APP,'public/module-projection-schema.js'));
const builder=require(path.join(APP,'server/lib/projection-ready-json.js'));
const {responseIdentityHeaders,planHashFor}=require(path.join(APP,'server/lib/orders-ready-http.js'));
const promotion=require(path.join(APP,'public/orders-full-promotion.js'));
const candidate=require(path.join(APP,'public/orders-projection-client.js')),recipe=require(path.join(PACKET,'snippets/guard-recipe.cjs'));
const app=actual.pinned('app-main.js'),seams=fs.readFileSync(path.join(PACKET,'snippets/app-seams.js'),'utf8');
const hash=value=>crypto.createHash('sha256').update(value).digest('hex'),clone=actual.clone;
function hostFunction(name,globals,source=app){return Function(...Object.keys(globals),'return ('+extractFunction(source,name)+');')(...Object.values(globals));}
function literal(name){const start=app.indexOf('const '+name+' = '),compact=app.indexOf('const '+name+'=');const at=start<0?compact:start;
 assert.ok(at>=0,name);const end=app.indexOf(';',at);return Function(app.slice(at,end+1)+'return '+name+';')();}
function headers(base,extra={}){return new Headers({...base,...extra});}
async function fixture(options={}){
 const f=actual.fixture(options),state={currentUser:{id:'owner'},colFilters:{orders:{}},ordersSort:{key:null,dir:1},
  checkFilter:{orders:''},ordersQuickActive:new Set(),ordersQuickExf:'',ordersSelected:new Set(),modelScopes:[],modelHorizons:{},storeRevisions:{orders:0},
  overrides:{pricingRules:[],transitRules:[],nonDtrManufacturers:[],landedMultipliers:{tr:1.05,overseas:1.11}}};
 const controls=new Map(['ordersSearch','ordersFCountry','ordersFLicense','ordersFDelType','ordersFStatus','ordersFSeason'].map(id=>[id,{value:''}]));
 const window={BL_USER_CONTEXT:{id:'owner'},BLCanAccessArea:()=>true,BL_CP_SOURCE_FILTER_REQUIRED:false,BL_HAS_CACHED_MODEL_DATA:true,BLCanonicalFields:f.canonical};
 const globals={state,window,coreFilterAutoReady:true,ORDERS_COLS:f.scope.COLS_BY_TABLE.orders,CP_MODEL_COLUMN_DEFS:clone(f.context.schema.modelColumns),
  colmgr:f.scope.colmgr,CP_SEARCH_KEYS:literal('CP_SEARCH_KEYS'),ORDERS_MIRROR_COLS:['STATUS','Del. Type','Season','Ex-factory'],
  ORDERS_DIM_META:literal('CP_DIM_META'),ordersDimFilters:{},partialViewEnabled:()=>false,BLStorage:f.scope.BLStorage,
  document:{readyState:'complete',getElementById:id=>controls.get(id)||null}};
 const capture=hostFunction('captureOrdersFiniteInputs',globals,seams),rawText=JSON.stringify(f.full),gzip=zlib.gzipSync(rawText);
 const token={...f.context.token,ownerId:'owner',actorId:'owner',sourceGeneration:'page-g1',accessHash:'a'.repeat(64),
  sourceRevision:hash(JSON.stringify(['real-revision-key',hash(gzip)])),planRevision:'0',requestGeneration:'orders-ready-v1'};
 const metadata={mode:'schema',profile:'orders-ready-model-v1',token,schema:clone(f.context.schema),schemaChecksum:hash(JSON.stringify(f.context.schema)),guardStamp:hash('actual-guard-key'),planHashVersion:1};
 const h={...responseIdentityHeaders({captured:{userId:'owner',accessHash:token.accessHash,contextHash:'broad-context',key:'actual-guard-key'},
  context:{id:'owner',contextHash:token.contextHash},full:{manifest:{activeGeneration:token.sourceGeneration,contextHash:token.contextHash,modules:{orders:{checksum:hash(gzip)}}},meta:{checksum:hash(gzip)}}})};
 let settles=0;
 const client=(options.clientApi||candidate).create({finiteApi:actual.api,compiler:f.compiler,schemaApi,formulaColumns:f.formula,readCurrent:capture,
  settleOnFull:async()=>{settles++;f.formula.migrateReferences('orders');},sha256:async value=>hash(value)});
 const initialize=()=>client.initializeFull({metadata,afterMetadata:clone(metadata),headers:headers(h),fullWire:f.full,rawText});
 const ready=async()=>{
  const request=await client.prepare(metadata,'native_nonce');assert.equal(request.mode,'ready',request.reason);
  const viewInfo={ownerId:'owner',actorId:'owner',sourceKey:token.sourceProjectionKey,sourceGeneration:token.sourceGeneration,
    accessHash:token.accessHash,planEpoch:0,fullJsonSha256:hash(rawText),fullJsonBytes:Buffer.byteLength(rawText)};
  const result=await builder.prepareReadyJson(f.full,{schema:metadata.schema,omittedKeys:request.body.omittedModelKeys,viewInfo});
  assert.equal(result.kind,'ready',result.reason);const bytes=zlib.gunzipSync(result.buffer);
  return {request,payload:JSON.parse(bytes),rawText:bytes.toString(),headers:headers(h,{'X-Orders-View-Mode':'ready','X-Orders-Request-Nonce':'native_nonce','X-Orders-Plan-Hash':request.body.planHash})};
 };
 return {f,state,controls,window,globals,capture,metadata,h,rawText,client,initialize,ready,settles:()=>settles};
}
async function coldFixture({legacy={},owner='owner',baseFixture,clientApi=candidate}={}){
 const f=baseFixture||await fixture(),values=new Map(Object.entries(legacy));
 const native={get length(){return values.size;},key:index=>[...values.keys()][index]??null,getItem:key=>values.get(String(key))??null,
  setItem:(key,value)=>values.set(String(key),String(value)),removeItem:key=>values.delete(String(key)),clear:()=>values.clear()};
 const storageSource=fs.readFileSync(path.join(APP,'public/user-storage.js'),'utf8');
 assert.equal(hash(storageSource),'b924316165494261b584b967c983ebcb238869a00274880cc92261783c6e90ee');
 const w={localStorage:native,BL_USER_CONTEXT:{id:owner},setTimeout:()=>1,clearTimeout(){},fetch:async()=>({ok:true,json:async()=>({entries:{}})})};
 vm.runInNewContext(storageSource,{window:w,fetch:w.fetch,Promise,Date,JSON});
 f.window.BLStorage=w.BLStorage;f.window.BLFormulaColumns=f.f.formula;f.globals.BLStorage=w.BLStorage;f.globals.cpLoadPromise=null;
 f.f.scope.BLStorage=w.BLStorage;f.f.scope.localStorage=w.BLStorage;
 f.state.currentUser.id=owner;f.window.BL_USER_CONTEXT.id=owner;
 const capture=hostFunction('captureOrdersFiniteInputs',f.globals,seams);
 const captureCold=hostFunction('captureOrdersColdEligibility',f.globals,seams);
 let waits=0;
 const client=clientApi.create({finiteApi:actual.api,compiler:f.f.compiler,schemaApi,formulaColumns:f.f.formula,readCurrent:capture,
  settleOnFull:async()=>{throw Error('cold path must not invoke full settlement');},sha256:async value=>hash(value),captureCold,waitCold:async()=>{waits++;}});
 return {...f,native,values,client,captureCold,waits:()=>waits};
}

module.exports={APP,PACKET,actual,extractFunction,schemaApi,builder,responseIdentityHeaders,planHashFor,promotion,candidate,recipe,app,seams,hash,clone,hostFunction,headers,fixture,coldFixture};
