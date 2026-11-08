'use strict';
// UNRUN. Actual public compiler, formula/normalizer fixture, builder and headers.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto'),zlib=require('node:zlib');
const APP=process.env.BUYER_LOG_ACTUAL_APP_ROOT||'/workspace/buyerlog-post-main-acceptance/resources/app';
const actual=require(path.join(APP,'tests/contracts/orders/runtime-fixture.cjs'));
const {extractFunction}=require(path.join(APP,'tests/helpers/app-main-functions.js'));
const schemaApi=require(path.join(APP,'public/module-projection-schema.js'));
const builder=require(path.join(APP,'server/lib/projection-ready-json.js'));
const {responseIdentityHeaders,planHashFor}=require(path.join(APP,'server/lib/orders-ready-http.js'));
const promotion=require(path.join(APP,'public/orders-full-promotion.js'));
const candidate=require('../candidate/orders-projection-client.js'),recipe=require('../snippets/guard-recipe.cjs');
const app=actual.pinned('app-main.js'),seams=fs.readFileSync(path.join(__dirname,'../snippets/app-seams.js'),'utf8');
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
 const client=candidate.create({finiteApi:actual.api,compiler:f.compiler,schemaApi,formulaColumns:f.formula,readCurrent:capture,
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
async function coldFixture({legacy={},owner='owner'}={}){
 const f=await fixture(),values=new Map(Object.entries(legacy));
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
 const client=candidate.create({finiteApi:actual.api,compiler:f.f.compiler,schemaApi,formulaColumns:f.f.formula,readCurrent:capture,
  settleOnFull:async()=>{throw Error('cold path must not invoke full settlement');},sha256:async value=>hash(value),captureCold,waitCold:async()=>{waits++;}});
 return {...f,native,values,client,captureCold,waits:()=>waits};
}
test('uninitialized and caller-authored guard strings cannot select a finite request',async()=>{
 const f=await fixture();assert.equal((await f.client.prepare(f.metadata,'n')).reason,'FIRST_FULL_REQUIRED');
 const forged={...f.metadata,guards:actual.api.GUARDS};assert.equal((await f.client.prepare(forged,'n')).mode,'full');assert.equal(f.settles(),0);
});
test('actual complete full initializes actual migration once, then metadata-only compile needs no row provider',async()=>{
 const f=await fixture({formulas:[{id:'probe',label:'Probe formula',formula:'[Probe]'}]});
 assert.equal((await f.initialize()).mode,'full-initialized');assert.equal(f.settles(),1);
 f.f.scope.BLFormulaRows.orders=()=>{throw Error('metadata must not read rows');};
 const request=await f.client.prepare(f.metadata,'n');assert.equal(request.mode,'ready',request.reason);assert.ok(!request.body.omittedModelKeys.includes('__CPX_PROBE'));
 assert.equal(request.body.planHash,planHashFor({token:f.metadata.token,schemaChecksum:f.metadata.schemaChecksum,guardStamp:f.metadata.guardStamp,omittedModelKeys:request.body.omittedModelKeys}));
});
test('actual native ready body preserves sparse own 0 false null, row order, duplicate IDs and unknown keys',async()=>{
 const f=await fixture();assert.equal((await f.initialize()).mode,'full-initialized');const wire=await f.ready(),accepted=await f.client.accept(wire.request,wire);
 assert.equal(accepted.mode,'ready');assert.equal(accepted.payload.rows.length,2);assert.equal(accepted.payload.rows[0]['Order Code'],accepted.payload.rows[1]['Order Code']);
 assert.equal(accepted.payload.rows[0].unknown.false,false);assert.equal(accepted.payload.rows[0].unknown.zero,0);assert.equal(accepted.payload.rows[0].unknown.nil,null);
 assert.equal(Object.hasOwn(accepted.payload.rows[1],'Probe'),false);assert.equal(accepted.payload.rows[0].Probe,0);
 assert.ok(accepted.payload.rows.every(row=>Object.hasOwn(row,'__CPX_UNREGISTERED')));accepted.assertCurrent();
});
for(const change of [f=>{f.state.colFilters.orders.__CPX_ZERO={values:new Set(['0'])};},f=>{f.state.ordersSort.key='__CPX_FALSE';},
 f=>{f.state.ordersQuickActive.add('Active');},f=>{f.controls.get('ordersSearch').value='changed';},f=>{f.globals.colmgr.orders.hidden.delete('__CPX_UNUSED');},
 f=>{f.f.formula.save('orders',[{id:'new',label:'New',formula:'[__CPX_UNUSED]'}]);},f=>{f.state.overrides.pricingRules.push({value:0});}]){
 test('real captured filter/sort/quick/column/formula/rule drift prevents cached finite decision '+String(change),async()=>{
  const f=await fixture();assert.equal((await f.initialize()).mode,'full-initialized');const wire=await f.ready();change(f);
  assert.equal((await f.client.prepare(f.metadata,'next')).mode,'full');await assert.rejects(f.client.accept(wire.request,wire),{code:'ORDERS_FULL_STALE'});
 });
}
test('malformed formula storage never masquerades as empty definitions',async()=>{
 const f=await fixture();f.f.scope.BLStorage.setItem('bl.formulaColumns.orders.v1','{bad');assert.equal(f.f.formula.definitions('orders').length,0);
 assert.equal((await f.initialize()).mode,'full');assert.equal((await f.client.prepare(f.metadata,'n')).mode,'full');
});
test('unknown schema, changed source/full SHA, page generation and ordinary missing identity stay full',async()=>{
 for(const change of [f=>{f.metadata.schema.status='unknown';},f=>{f.metadata.schema.rowCount++;},f=>{delete f.h['X-Orders-Owner-B64'];}]){
  const f=await fixture();change(f);assert.equal((await f.initialize()).mode,'full');
 }
 const f=await fixture();await f.initialize();const wire=await f.ready();wire.payload.projection.viewInfo.fullJsonSha256='0'.repeat(64);
 await assert.rejects(f.client.accept(wire.request,wire),{code:'ORDERS_FULL_STALE'});
 const changed=clone(f.metadata);changed.token.sourceGeneration='compute-generation-is-not-page';assert.equal((await f.client.prepare(changed,'n')).mode,'full');
});
test('headers nonce owner broad context and late raw keys are independently checked',async()=>{
 for(const mutate of [w=>w.headers.set('X-Orders-Request-Nonce','other'),w=>w.headers.set('X-Orders-Owner-B64','b3RoZXI'),
  w=>w.headers.set('X-Orders-Broad-Context-Sha256','0'.repeat(64)),w=>{w.payload.rows[0].__CPX_LATE=0;}]){
  const f=await fixture();await f.initialize();const wire=await f.ready();mutate(wire);await assert.rejects(f.client.accept(wire.request,wire));
 }
});
test('capture reads no row graph and records actual revision/0/false/null filter metadata',async()=>{
 const f=await fixture();Object.defineProperty(f.state,'orders',{get(){throw Error('no row reads');}});
 f.state.colFilters.orders['Ex-factory']={revision:'revised',numericRule:{min:0,max:null},quickExf:false};
 const c=f.capture();assert.equal(c.settings.filters['Ex-factory'].revision,'revised');assert.equal(c.settings.filters['Ex-factory'].numericRule.min,0);
 assert.equal(c.settings.filters['Ex-factory'].numericRule.max,null);assert.equal(c.settings.filters['Ex-factory'].quickExf,false);
 assert.ok(c.filterKeys.includes('Sub Manufacturer'));assert.ok(c.filterKeys.includes('Buyer Grup (TR)'));
});
test('capture getter, storage read failure, unknown source and unknown access default full before planning',async()=>{
 for(const mutate of [f=>Object.defineProperty(f.state.colFilters.orders,'trap',{enumerable:true,get(){throw Error('must not invoke');}}),
  f=>{f.globals.BLStorage.getItem=()=>{throw Error('unknown storage');};},f=>{f.window.BL_CP_SOURCE_FILTER_REQUIRED=undefined;},f=>{f.window.BLCanAccessArea=()=>undefined;}]){
  const f=await fixture();mutate(f);assert.equal((await f.initialize()).mode,'full');
 }
});
test('retirement cancels captured requests even if the same actor/source values later reappear',async()=>{
 const f=await fixture();await f.initialize();const wire=await f.ready();f.client.invalidate();
 await assert.rejects(f.client.accept(wire.request,wire),{code:'ORDERS_FULL_STALE'});assert.equal((await f.client.prepare(f.metadata,'n')).reason,'FIRST_FULL_REQUIRED');
});
test('actual unchanged mutator bodies are fenced before source/preference mutation; invalid non-Orders target retains its fast path',()=>{
 const patched=recipe.patch(app,extractFunction),context=vm.createContext({ordersProjectionIsThin:()=>true,
  ordersFullActionError:()=>Object.assign(Error('full'),{code:'ORDERS_FULL_REQUIRED'}),state:{},window:{},
  assertOrdersFiniteMutationAllowed:()=>{throw Object.assign(Error('gate'),{code:'ORDERS_FULL_REQUIRED'});}});
 for(const name of recipe.sync){vm.runInContext(extractFunction(patched,name),context);assert.throws(()=>context[name](),{code:'ORDERS_FULL_REQUIRED'});
  const old=extractFunction(app,name),next=extractFunction(patched,name);assert.equal(next.replace('\n  assertOrdersFiniteMutationAllowed();',''),old);}
 vm.runInContext(extractFunction(patched,'setPartialView'),context);
 assert.throws(()=>context.setPartialView('orders',true),{code:'ORDERS_FULL_REQUIRED'});
 assert.equal(context.setPartialView('unregistered',true),false);
 for(const name of ['ensureCpLoaded','registerManagedGridClipboard','syncUnifiedPrioritiesForTable','cpEvaluateAll'])
  assert.equal(extractFunction(patched,name),extractFunction(app,name));
});
test('existing legacy quick-filter migration executes on full; thin only checks its accepted capture without writes',()=>{
 const patched=recipe.patch(app,extractFunction),state={colFilters:{orders:{Priority:{values:new Set(['x'])}}},ordersSort:{key:'Priority'},ordersQuickExf:''};let thin=true,checked=0;
 const globals={state,ordersProjectionIsThin:()=>thin,assertOrdersFiniteViewCurrent:()=>{checked++;},norm:v=>String(v||''),document:{getElementById:()=>null}};
 const fn=hostFunction('migrateLegacyOrdersQuickFilters',globals,patched);fn();assert.equal(checked,1);assert.ok(state.colFilters.orders.Priority);assert.equal(state.ordersSort.key,'Priority');
 thin=false;fn();assert.equal(state.colFilters.orders.Priority,undefined);assert.equal(state.ordersSort.key,null);
});
test('actual full promotion helper accepts sparse full rows with empty proven requiredKeys and preserves per-row shapes',async()=>{
 const rows=[{_id:1,'Order Code':'same',zero:0,flag:false,nil:null},{_id:1,'Order Code':'same',late:0}],bytes=Buffer.from(JSON.stringify({rows}));
 const id={ownerId:'owner',sessionId:'session-epoch-1',sourceId:'source',generation:'page-g1',accessHash:'access',scopeHash:'guard',module:'orders',planHash:'plan',fullProjectionChecksum:hash(bytes),fullByteLength:bytes.length,rowCount:2};
 let state={kind:'thin',rows:rows.map(r=>({_id:r._id,'Order Code':r['Order Code']})),selectedRows:[],mutationRevision:0,selectionRevision:0,dirty:false,identity:id,requiredKeys:[],ordinals:[0,1]};
 const controller=promotion.create({snapshot:()=>state,fetchFull:async()=>({identity:id,bytes}),normalize:async rows=>({rows,ordinals:[0,1]}),
  publish:(next,{expected,assertCurrent})=>{assert.equal(state,expected);assertCurrent();return state=next;},isCurrent:()=>true});
 const full=await controller.ensure();assert.equal(Object.hasOwn(full.rows[0],'late'),false);assert.equal(Object.hasOwn(full.rows[1],'zero'),false);
 assert.equal(full.rows[0].zero,0);assert.equal(full.rows[0].flag,false);assert.equal(full.rows[0].nil,null);assert.equal(full.rows[1].late,0);full.assertCurrent();
});
test('full-parent adapter uses actual additional header producer, exact DTO and owned decoded-byte hash; identity is never echoed',async()=>{
 const f=await fixture();await f.initialize();const wire=await f.ready();await f.client.accept(wire.request,wire);
 const router=fs.readFileSync(path.join(APP,'server/lib/orders-ready-http.js'),'utf8');
 assert.equal(hash(router),'c6caf8daa7bb876976ae13b43186153042a42843ac3c7aa88da559d5cf2e0d01');
 const extra=hostFunction('fullParentHeaders',{Buffer,stale:()=>Object.assign(Error('stale'),{code:'PROJECTION_VIEW_STALE'})},router)(f.metadata.token,
  {pin:{uncompressedBytes:Buffer.byteLength(f.rawText)},schema:{rowCount:f.metadata.schema.rowCount}});
 const live={token:f.metadata.token,fullGzipChecksum:f.h['X-Orders-Full-Gzip-Sha256'],guardStamp:f.metadata.guardStamp,
  sessionId:'actual-ui-epoch',planHash:wire.request.body.planHash,pageContextSha256:f.h['X-Orders-Page-Context-Sha256'],
  broadContextSha256:f.h['X-Orders-Broad-Context-Sha256'],nonce:()=> 'parent_nonce',assertCurrent(){}};
 const v=wire.payload.projection.viewInfo,expected={ownerId:v.ownerId,sessionId:live.sessionId,sourceId:v.sourceKey,generation:v.sourceGeneration,
  accessHash:v.accessHash,scopeHash:live.guardStamp,module:'orders',planHash:live.planHash,fullProjectionChecksum:v.fullJsonSha256,
  fullByteLength:v.fullJsonBytes,rowCount:f.metadata.schema.rowCount};let dto;
 const adapter=candidate.createFetchFull({promotionApi:promotion,sha256Bytes:async bytes=>hash(bytes),live:()=>live,
  fetch:async(url,options)=>{assert.equal(url,'/api/page-projection/orders/full-parent');dto=JSON.parse(options.body);
   return new Response(Buffer.from(f.rawText),{status:200,headers:headers(f.h,{...extra,'X-Orders-View-Mode':'full','X-Orders-Request-Nonce':'parent_nonce'})});}});
 const response=await adapter(expected,{signal:new AbortController().signal,maxDecodedBytes:v.fullJsonBytes});
 assert.deepEqual(Object.keys(dto),['token','requestNonce','fullGzipChecksum','guardStamp']);assert.equal(Object.hasOwn(dto,'fullJsonSha256'),false);
 assert.deepEqual(response.identity,expected);assert.notStrictEqual(response.identity,expected);assert.equal(hash(response.bytes),v.fullJsonSha256);
 assert.notEqual(v.fullJsonSha256,live.fullGzipChecksum);assert.equal(Object.hasOwn(response.identity,'requiredKeys'),false);
});
test('full-parent header mismatch or session replacement cancels before body reading and is never retried through ready',async()=>{
 const f=await fixture(),token=f.metadata.token;let reads=0,cancelled=0,calls=0;
 const live={token,fullGzipChecksum:f.h['X-Orders-Full-Gzip-Sha256'],guardStamp:f.metadata.guardStamp,sessionId:'old-session',planHash:'plan',
  pageContextSha256:f.h['X-Orders-Page-Context-Sha256'],broadContextSha256:f.h['X-Orders-Broad-Context-Sha256'],nonce:()=> 'n',assertCurrent(){}};
 const expected={ownerId:token.ownerId,sessionId:live.sessionId,sourceId:token.sourceProjectionKey,generation:token.sourceGeneration,accessHash:token.accessHash,
  scopeHash:live.guardStamp,module:'orders',planHash:live.planHash,fullProjectionChecksum:hash(f.rawText),fullByteLength:Buffer.byteLength(f.rawText),rowCount:2};
 const adapter=candidate.createFetchFull({promotionApi:{readDecodedBytes(){reads++;throw Error('must not read');}},sha256Bytes:async()=>{throw Error('must not hash');},live:()=>live,
  fetch:async()=>{calls++;live.sessionId='replacement-same-actor';return {ok:true,status:200,headers:headers(f.h),body:{cancel(){cancelled++;}}};}});
 await assert.rejects(adapter(expected,{maxDecodedBytes:expected.fullByteLength}),{code:'ORDERS_FULL_STALE'});
 assert.equal(reads,0);assert.equal(calls,1);assert.equal(cancelled,1);
});
test('cold empty-formula current+legacy audit uses actual user-storage migration and plans first Orders network without full rows',async()=>{
 const f=await coldFixture({legacy:{'bl.formulaColumns.orders.v1':'[]','bl.formulaColumns.orders.v0':'[]'}});
 assert.equal(f.native.getItem('bl.formulaColumns.orders.v1'),null,'actual startup migrates device-wide key');
 f.f.scope.BLFormulaRows.orders=()=>{throw Error('no rows may be sampled');};
 assert.equal(f.f.formula.migrateReferences('orders'),false,'actual zero-definition migration exits before tableRows');
 const request=await f.client.prepare(f.metadata,'cold_n');assert.equal(request.mode,'ready',request.reason);assert.equal(f.waits(),1);
 const original=JSON.stringify(f.f.full),plan=f.f.compiler.compileSchema(f.f.context);assert.equal(plan.supported,true);
 assert.deepEqual(request.body.omittedModelKeys,plan.omittedKeys);assert.equal(JSON.stringify(f.f.full),original);
});
test('cold form-free plan accepts actual native producer raw SHA as first parent and keeps gzip SHA distinct',async()=>{
 const f=await coldFixture(),request=await f.client.prepare(f.metadata,'cold_nonce');assert.equal(request.mode,'ready',request.reason);
 const viewInfo={ownerId:'owner',actorId:'owner',sourceKey:f.metadata.token.sourceProjectionKey,sourceGeneration:f.metadata.token.sourceGeneration,
  accessHash:f.metadata.token.accessHash,planEpoch:0,fullJsonSha256:hash(f.rawText),fullJsonBytes:Buffer.byteLength(f.rawText)};
 const built=await builder.prepareReadyJson(f.f.full,{schema:f.metadata.schema,omittedKeys:request.body.omittedModelKeys,viewInfo});assert.equal(built.kind,'ready');
 const accepted=await f.client.accept(request,{payload:JSON.parse(zlib.gunzipSync(built.buffer)),headers:headers(f.h,
  {'X-Orders-View-Mode':'ready','X-Orders-Request-Nonce':'cold_nonce','X-Orders-Plan-Hash':request.body.planHash})});
 assert.equal(accepted.parent.fullJsonSha256,viewInfo.fullJsonSha256);assert.equal(accepted.parent.fullGzipChecksum,f.h['X-Orders-Full-Gzip-Sha256']);
 assert.notEqual(accepted.parent.fullJsonSha256,accepted.parent.fullGzipChecksum);accepted.assertCurrent();
});
for(const entry of [
 {'bl.user.owner.bl.formulaColumns.orders.v1':'[{"id":"x","label":"X","formula":"[Probe]"}]'},
 {'bl.formulaColumns.orders.v0':'[{"id":"legacy","label":"Legacy"}]'},
 {'bl.user.owner.bl.formulaColumns.orders.v0':'{broken'},
 {'bl.user.owner.__roleWorkspaceDefaults.v1':'{broken'},
 {'bl.user.owner.__roleWorkspaceDefaults.v1':JSON.stringify({'bl.formulaColumns.orders.v1':{value:JSON.stringify([{id:'r',label:'R'}])}})}
])test('cold current/legacy/inherited/unknown storage must be explicitly empty '+JSON.stringify(entry),async()=>{
 const f=await coldFixture({legacy:entry});assert.equal((await f.client.prepare(f.metadata,'cold_n')).mode,'full');
});
test('cold eligibility checks actual Moderator legacy aliases even if scoped current storage is already empty',async()=>{
 const f=await coldFixture({owner:'moderator',legacy:{'bl.user.moderator.bl.formulaColumns.orders.v1':'[]',
  'bl.user.Gokberk.bl.formulaColumns.orders.v1':'[{"id":"stale","label":"Legacy"}]'}});
 // Context identity differs too; independently inspect the native audit to
 // prove the legacy value was not silently discarded by the scoped [] value.
 assert.ok(f.captureCold().reads.some(item=>item.key==='bl.user.Gokberk.bl.formulaColumns.orders.v1'&&item.raw.includes('Legacy')));
 assert.equal((await f.client.prepare(f.metadata,'cold_n')).mode,'full');
});
test('cold missing bootstrap registration or late actual formula creation stays full without full receipt fabrication',async()=>{
 const f=await coldFixture();f.globals.CP_MODEL_COLUMN_DEFS.length=0;
 assert.equal((await f.client.prepare(f.metadata,'cold_n')).reason,'MODEL_DEFINITIONS_CHANGED');
 const late=await coldFixture(),request=await late.client.prepare(late.metadata,'cold_n');assert.equal(request.mode,'ready');
 late.native.setItem('bl.user.owner.bl.formulaColumns.orders.v1','[{"id":"late","label":"Late","formula":"[Probe]"}]');
 assert.equal((await late.client.prepare(late.metadata,'again')).mode,'full');
});
test('actual cold wait observes pending hydration and rejects absent/failed hydration or concurrent CP model loading',async()=>{
 let resolve;const pending=new Promise(yes=>{resolve=yes;});let done=false;
 const wait=hostFunction('waitOrdersColdEligibility',{authHydrationPromise:pending,cpLoadPromise:null},seams);
 const task=wait().then(()=>{done=true;});await Promise.resolve();assert.equal(done,false);resolve({applied:0,pushed:0});await task;assert.equal(done,true);
 for(const globals of [{authHydrationPromise:null,cpLoadPromise:null},{authHydrationPromise:Promise.resolve(null),cpLoadPromise:null},
  {authHydrationPromise:Promise.resolve({applied:0,pushed:0}),cpLoadPromise:Promise.resolve()}]){
  await assert.rejects(hostFunction('waitOrdersColdEligibility',globals,seams)(),{code:'UNREADY_CLIENT'});
 }
});
