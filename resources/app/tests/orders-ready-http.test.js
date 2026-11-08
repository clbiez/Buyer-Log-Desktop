'use strict';
// Real Express HTTP, actual guard/cache/source service/pool/worker/builder.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const APP=path.resolve(__dirname,'..');
const ROOT=fs.mkdtempSync(path.join(os.tmpdir(),'buyerlog-ready-http-native-'));
Object.assign(process.env,{BUYER_LOG_LOCAL_DATA_ROOT:ROOT,BUYER_LOG_TEMP_ROOT:path.join(ROOT,'tmp'),BUYER_LOG_DATA_ROOT:path.join(ROOT,'app'),BUYER_LOG_SERVER_DATA_ROOT:path.join(ROOT,'server')});
const express=require(APP+'/node_modules/express'),cache=require(APP+'/server/lib/page-projection-cache');
const {createComputeReadGuard}=require(APP+'/server/lib/compute-read-guard');
const {createAccessContext}=require(APP+'/server/lib/compute-access');
const {createComputePool}=require(APP+'/server/lib/compute-pool'),{createComputeService}=require(APP+'/server/lib/compute-service');
const codec=require(APP+'/server/lib/compute-source-codec'),{sendComputedResponse}=require(APP+'/server/lib/compute-response');
const {createOrdersReadyRouter,planHashFor,responseIdentityHeaders}=require('../server/lib/orders-ready-http');
const sha=value=>crypto.createHash('sha256').update(value).digest('hex'),KEY='__CPX_READY_HTTP_TEST';
const deferred=()=>{let resolve;const promise=new Promise(yes=>{resolve=yes;});return {promise,resolve};};
const stale=()=>Object.assign(Error('synthetic current-source mismatch'),{code:'PROJECTION_VIEW_STALE',statusCode:409});
async function gate(promise,signal){
  if(!promise)return;
  if(signal?.aborted)throw stale();let abort;
  try{await Promise.race([promise,new Promise((_,reject)=>{abort=()=>reject(stale());signal?.addEventListener('abort',abort,{once:true});})]);}
  finally{if(abort)signal?.removeEventListener('abort',abort);}
}
test.after(()=>fs.rmSync(ROOT,{recursive:true,force:true}));
let count=0;
async function fixture(t,{canonicalDefinition=false,ordinaryGet=false,ordinaryWorkerLease=false}={}){
  const n=++count,owner='synthetic-owner-'+n,actor='synthetic-actor-'+n,other='synthetic-other-'+n;
  const profiles=new Map([actor,other].map(id=>[id,{id,owner,status:'ACTIVE',enabled:true,areas:['cp','orders'],viewScope:{all:true}}]));
  const sessions=new Map([['first',actor],['second',other]]);
  const f={owner,actor,profiles,sessions,filtersReady:true,guardRevision:1,jobs:[],jobEntered:deferred(),jobReleases:0,fullReads:0,viewReads:0,backgroundErrors:[]};
  const profileFor=req=>profiles.get(sessions.get(req.headers['x-session']))||null;
  const contextFor=profile=>({id:profile.owner,contextHash:sha(JSON.stringify(['page',profile.owner,profile.viewScope,profile.areas]))});
  const accessFor=profile=>createAccessContext({userId:profile.id,systemRole:'moderator',manageAll:true,viewScope:profile.viewScope,editScopes:{all:true},authority:{},profiles:[]});
  const rows=[0,1].map(index=>({ocode:'duplicate',model:'Synthetic '+index,ccode:'R',colour:'Red',buyer:'Synthetic Buyer '+n,merch:'M',ageGroup:'A',buyerGrup:'G',
    license:'',manufacturer:'Synthetic',season:'W7',countryRaw:'TURKIYE',qty:10,kalan:5,fob:0,
    ex:new Date(2026,6,1),retail:new Date(2026,7,1),mb:new Date(2026,8,1),_cpExtra:{[KEY]:index?false:0}}));
  const source={loadedAt:'2026-11-08T00:00:00.000Z',asasOrders:rows,asasOrdersByTarget:{cp:rows,orders:rows},antrepoMap:{}};
  const generation='synthetic-compute-'+n,encoded=codec.encode({ownerId:owner,generation,source});
  const pool=createComputePool({maxWorkers:1,memoryBudgetBytes:512*1024*1024,maxPendingBytes:256*1024*1024});
  const privateRoot=path.join(ROOT,'service-'+n);fs.mkdirSync(privateRoot);
  const service=createComputeService({pool,root:privateRoot});f.service=service;f.pool=pool;
  const descriptor=await service.seedSource({ownerId:owner,generation,source,uncompressedBytes:encoded.bytes.length});f.descriptor=descriptor;f.sourceToken=generation;
  const context=contextFor(profiles.get(actor));f.context=context;
  const definitions=[{id:'synthetic',header:KEY,label:'Synthetic model',metadata:{zero:0,false:false,nil:null}}];
  if(canonicalDefinition)definitions.push({id:'bad-registration',header:'Order Code',label:'Cannot remove native field'});
  const params={modules:['orders'],overrides:{},horizons:{},cpAllowed:true,cpModelColumns:definitions,
    moduleSchemaExposureCp:true,moduleSchemaTargetKnownCp:true,moduleSchemaBindingsKnownCp:true,
    moduleSchemaExposureOrders:true,moduleSchemaTargetKnownOrders:true,moduleSchemaBindingsKnownOrders:true,collectModuleSchemas:true};
  const plan=await service.run('projection-plan',descriptor,{...params,projectionContextHash:context.contextHash,appVersion:'synthetic'});
  const inputKeys=plan.value.inputKeys;plan.release();
  const produced=await service.run('projections',descriptor,params);
  try{
    const entry={buffer:Buffer.from(produced.value.compressed.orders.buffer),uncompressedBytes:produced.value.compressed.orders.uncompressedBytes};
    const keys={sourceProjectionKeys:produced.value.sourceProjectionKeys,moduleInputKeys:inputKeys};
    const schemas=cache.prepareModuleSchemas({ownerId:owner,contextHash:context.contextHash,...keys,projections:{orders:entry},moduleSchemas:produced.value.moduleSchemas});
    f.manifest=await cache.writeCompressedGeneration(owner,{contextHash:context.contextHash,sourceLoadedAt:source.loadedAt,projections:{orders:entry},
      extra:{...keys,sourceRevisionKey:descriptor.checksum,moduleSchemas:schemas}});
    f.fullBuffer=Buffer.from(entry.buffer);
  }finally{produced.release();}
  const guard=createComputeReadGuard({sessionProfile:profileFor,profileById:id=>profiles.get(id),hasArea:(profile,area)=>profile.areas.includes(area),
    contextFor:profile=>({contextHash:sha(JSON.stringify(['BROAD-GUARD',contextFor(profile).contextHash,f.guardRevision]))}),
    accessFor,sourceTokenFor:()=>f.sourceToken});
  function assertCachedCurrent(req,ctx,cached){
    const profile=profileFor(req);if(!profile||contextFor(profile).id!==owner||contextFor(profile).contextHash!==ctx.contextHash
      ||cached.manifest.contextHash!==ctx.contextHash||f.sourceToken!==descriptor.generation
      ||cached.manifest.sourceProjectionKeys.orders!==descriptor.projectionKeys.orders)throw stale();
    // Ordinary same-context backup full reads remain possible. Ready/schema
    // authority separately requires the actual primary cache API below.
    if(fs.existsSync(cache.manifestPath(owner))){
      const current=JSON.parse(fs.readFileSync(cache.manifestPath(owner),'utf8'));
      if(cached.fallback===false&&(current.activeGeneration!==cached.manifest.activeGeneration
        ||current.modules.orders.checksum!==cached.meta.checksum||current.contextHash!==ctx.contextHash))throw stale();
    }
  }
  const observedCache={...cache,
    async readProjectionCompressed(...args){f.fullReads++;const value=await cache.readProjectionCompressed(...args);await f.afterFullRead?.();return value;},
    async readViewCompressed(...args){f.viewReads++;f.lastReadOptions=args[3];const value=await cache.readViewCompressed(...args);await f.afterViewRead?.();return value;},
    readCurrentModuleSchema(...args){f.schemaReads=(f.schemaReads||0)+1;return cache.readCurrentModuleSchema(...args);},
  };
  const router=createOrdersReadyRouter({express,cache:observedCache,guard:{capture(...args){f.hookCaptures=(f.hookCaptures||0)+1;return guard.capture(...args);}},
    assertSourceFilters(targets){assert.deepEqual(targets,['orders']);if(!f.filtersReady)throw Object.assign(Error('source filters required'),{code:'SOURCE_FILTER_REQUIRED',statusCode:409});},
    contextFor,assertCachedCurrent,
    async sourceFor(profile){if(profile.owner!==owner||f.sourceToken!==descriptor.generation)throw stale();await gate(f.beforeSource?.promise);return descriptor;},
    async runTask(task,actualDescriptor,payload,options){
      assert.equal(task,'projection-ready-orders');assert.equal(actualDescriptor,descriptor);
      const job={task,payload,options,returned:false};f.jobs.push(job);f.jobEntered.resolve();await gate(f.beforeRun?.promise,options.signal);
      const lease=await service.run(task,actualDescriptor,payload,options);job.returned=true;job.kind=lease.value.kind;job.metrics=lease.metrics;
      let released=false;return {...lease,release(){if(!released){released=true;f.jobReleases++;}lease.release();}};
    },
    publishReady:(...args)=>cache.writeViewCompressed(...args), // Requires the real guarded-writer extension; no fake pre/post adapter.
    send:(...args)=>{f.beforeSend?.();return sendComputedResponse(...args);},onBackgroundError:value=>f.backgroundErrors.push(value),
    apiError:(res,error)=>res.status(error.statusCode||500).json({code:error.code||'TEST_ERROR',error:error.message})});
  const app=express();
  if(ordinaryGet)app.get('/api/page-projection/orders',async(req,res)=>{
    let lease,handed=false;
    try{
      const acquired=guard.capture(req,'orders'),ctx=contextFor(acquired.profile);let nativeLease;
      if(ordinaryWorkerLease){
        // Actual normal full-build output lease, independent of the binding
        // hook. The hook must not submit another task or require a schema.
        f.ordinaryWorkerCalls=(f.ordinaryWorkerCalls||0)+1;
        const produced=await service.run('projections',descriptor,params),entry=produced.value.compressed.orders;
        try{
          const manifest=await cache.writeCompressedGeneration(owner,{contextHash:ctx.contextHash,sourceLoadedAt:source.loadedAt,
            projections:{orders:{buffer:Buffer.from(entry.buffer),uncompressedBytes:entry.uncompressedBytes}},
            extra:{sourceProjectionKeys:produced.value.sourceProjectionKeys,moduleInputKeys:inputKeys,sourceRevisionKey:descriptor.checksum}});
          nativeLease={...produced,value:entry,manifest,cacheState:'miss',assertResponse:acquired.assertResponse};
        }catch(error){produced.release();throw error;}
      }else{
        const cached=await observedCache.readProjectionCompressed(ctx.id,'orders',ctx.contextHash);acquired.assertResponse();
        if(!cached)throw stale();
        nativeLease={value:{buffer:cached.buffer,uncompressedBytes:cached.meta.uncompressedBytes},manifest:cached.manifest,
          cacheState:cached.fallback?'fallback':'hit',assertResponse:acquired.assertResponse,release(){}};
      }
      const ordinaryReleased=deferred();f.ordinaryReleased=ordinaryReleased.promise;
      lease={...nativeLease,release(){f.ordinaryReleases=(f.ordinaryReleases||0)+1;try{nativeLease.release();}finally{ordinaryReleased.resolve();}}};
      f.lastOrdinaryLease=lease;f.beforeOrdinaryBind?.(lease);
      if(typeof router.bindOrdinaryFullResponse!=='function')throw TypeError('Actual ordinary binding hook is not installed');
      handed=true;const bound=router.bindOrdinaryFullResponse(req,lease);f.lastOrdinaryBound=bound;
      f.beforeOrdinarySend?.(bound,lease);
      return sendComputedResponse(req,res,bound.lease,{headers:{'X-Page-Cache':lease.cacheState,
        'X-Page-Cache-Generation':lease.manifest?.activeGeneration||'',...bound.headers}});
    }catch(error){if(lease&&!handed)lease.release();return res.status(error.statusCode||500).json({code:error.code||'TEST_ERROR'});}
  });
  app.use('/api/page-projection',router);
  app.use((error,_req,res,_next)=>res.status(error.status||500).json({code:error.type||'ERROR'}));
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  f.router=router;
  t.after(async()=>{f.beforeRun?.resolve();f.beforeSource?.resolve();await router.readyBackground.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await service.close();cache.invalidate(owner);});
  f.request=async(method,suffix,body,session='first',encoding='gzip')=>{
    const response=await fetch(`http://127.0.0.1:${server.address().port}/api/page-projection/${suffix}`,{method,
      headers:{'x-session':session,'Accept-Encoding':encoding,...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});
    const text=await response.text();let parsed;try{parsed=JSON.parse(text);}catch(_){parsed=null;}
    return {status:response.status,headers:response.headers,text,body:parsed};
  };
  f.get=(session='first')=>f.request('GET','orders/schema',undefined,session);
  f.body=(metadata,nonce='nonce_one',keys=[KEY])=>({token:metadata.token,requestNonce:nonce,omittedModelKeys:keys,
    planHash:planHashFor({token:metadata.token,schemaChecksum:metadata.schemaChecksum,guardStamp:metadata.guardStamp,omittedModelKeys:keys})});
  f.post=(body,session='first',encoding='gzip')=>f.request('POST','orders/ready',body,session,encoding);
  f.idle=async()=>{await new Promise(setImmediate);await router.readyBackground.idle();};
  f.primary=()=>JSON.parse(fs.readFileSync(cache.manifestPath(owner),'utf8'));
  f.derived=()=>f.primary().derivedViews?.orders||{};
  return f;
}
test('schema GET is hit-only own metadata; PAGE context differs from separately live broad guard',async t=>{
  const f=await fixture(t),got=await f.get();assert.equal(got.status,200);assert.equal(got.body.mode,'schema');assert.equal(f.jobs.length,0);
  assert.equal(got.body.token.contextHash,f.context.contextHash);assert.equal(got.body.token.ownerId,f.owner);assert.equal(got.body.token.actorId,f.actor);
  assert.deepEqual(got.body.schema.modelColumns[0].metadata,{zero:0,false:false,nil:null});
  cache.invalidate(f.owner);assert.deepEqual((await f.get()).body,{mode:'full'});assert.equal(f.jobs.length,0);
});
test('cold POST returns ordinary full before actual background job is allowed to execute',async t=>{
  const f=await fixture(t),metadata=(await f.get()).body;f.beforeRun=deferred();
  const first=await f.post(f.body(metadata));assert.equal(first.status,200);assert.equal(first.headers.get('x-orders-view-mode'),'full');
  assert.equal(Object.hasOwn(first.body.rows[0],KEY),true);assert.equal(f.router.readyBackground.stats().owned,1);
  f.beforeRun.resolve();await f.idle();assert.equal(f.jobs.length,1);assert.equal(f.jobs[0].kind,'ready');assert.ok(f.jobs[0].metrics.threadId>0);
  assert.equal(f.jobs[0].payload.projectionPin.contextHash,f.context.contextHash);assert.equal(f.jobs[0].payload.token.contextHash,f.context.contextHash);
  assert.equal(Object.hasOwn(f.jobs[0].payload.viewInfo,'fullJsonSha256'),false);assert.equal(Object.hasOwn(f.jobs[0].payload.viewInfo,'requestNonce'),false);
  assert.equal(f.jobReleases,1);assert.equal(f.pool.stats().leasedOutputBytes,0);assert.equal(f.router.readyBackground.stats().published,1);
});
test('ready cache hits require info, preserve stable body across nonces and do not start another worker',async t=>{
  const f=await fixture(t),metadata=(await f.get()).body,full=await f.post(f.body(metadata));await f.idle();
  const a=await f.post(f.body(metadata,'nonce_A')),b=await f.post(f.body(metadata,'nonce_B'),'first','identity');
  assert.equal(a.headers.get('x-orders-view-mode'),'ready');assert.equal(b.headers.get('x-orders-view-mode'),'ready');assert.equal(a.text,b.text);
  assert.equal(a.headers.get('x-orders-request-nonce'),'nonce_A');assert.equal(b.headers.get('x-orders-request-nonce'),'nonce_B');
  assert.equal(Object.hasOwn(a.body.rows[0],KEY),false);assert.equal(a.body.profile,'orders-ready-model-v1');
  assert.equal(a.body.projection.viewInfo.requestNonce,undefined);assert.deepEqual(f.lastReadOptions,{requireInfo:true});assert.equal(f.jobs.length,1);
  assert.deepEqual(a.body.rows,full.body.rows.map(row=>Object.fromEntries(Object.entries(row).filter(([key])=>key!==KEY))));
  for(const response of [full,a,b]){
    assert.equal(response.headers.get('x-orders-binding-version'),'1');
    assert.equal(response.headers.get('x-orders-owner-b64'),Buffer.from(f.owner).toString('base64url'));
    assert.equal(response.headers.get('x-orders-actor-b64'),Buffer.from(f.actor).toString('base64url'));
    assert.equal(response.headers.get('x-orders-access-hash'),metadata.token.accessHash);
    assert.equal(response.headers.get('x-orders-page-context-sha256'),sha(f.context.contextHash));
    assert.equal(response.headers.get('x-orders-broad-context-sha256'),sha(sha(JSON.stringify(['BROAD-GUARD',f.context.contextHash,f.guardRevision]))));
    assert.equal(response.headers.get('x-orders-guard-sha256'),metadata.guardStamp);
    assert.equal(response.headers.get('x-orders-cache-generation'),f.manifest.activeGeneration);
    assert.equal(response.headers.get('x-orders-full-gzip-sha256'),sha(f.fullBuffer));
  }
});
test('legacy ready metadata without producer info is a full fallback, never a thin cache hit',async t=>{
  const f=await fixture(t),metadata=(await f.get()).body;await f.post(f.body(metadata));await f.idle();
  const manifest=f.primary(),entry=manifest.derivedViews.orders[f.body(metadata).planHash];delete entry.info;delete entry.infoChecksum;
  fs.writeFileSync(cache.manifestPath(f.owner),JSON.stringify(manifest));f.beforeRun=deferred();
  const got=await f.post(f.body(metadata,'legacy_info'));assert.equal(got.headers.get('x-orders-view-mode'),'full');
  assert.equal(Object.hasOwn(got.body.rows[0],KEY),true);assert.deepEqual(f.lastReadOptions,{requireInfo:true});
  f.beforeRun.resolve();await f.idle();
});
test('actual session, role, view scope and source-filter authority reject before data/worker admission',async t=>{
  const f=await fixture(t),metadata=(await f.get()).body,body=f.body(metadata),reads=f.fullReads;
  assert.equal((await f.get('missing')).status,401);assert.equal(f.fullReads,reads);
  f.profiles.get(f.actor).areas=[];assert.equal((await f.post(body)).status,403);assert.equal(f.fullReads,reads);
  f.profiles.get(f.actor).areas=['orders'];f.filtersReady=false;assert.equal((await f.post(body)).status,409);assert.equal(f.fullReads,reads);
  f.filtersReady=true;f.profiles.get(f.actor).viewScope={all:false,buyers:['another scope']};assert.deepEqual((await f.get()).body,{mode:'full'});
  assert.equal(f.jobs.length,0);
});
test('strict 64KiB DTO, unknown raw keys, token/plan tamper and canonical requests cannot schedule work',async t=>{
  const f=await fixture(t),metadata=(await f.get()).body;
  assert.equal((await f.post({...f.body(metadata),extra:'x'.repeat(70*1024)})).status,413);
  assert.equal((await f.post({...f.body(metadata),requestNonce:'bad\r\nheader'})).status,400);
  assert.equal((await f.post({...f.body(metadata),omittedModelKeys:[KEY,KEY]})).status,400);
  for(const body of [f.body(metadata,'unknown',['__CPX_NOT_REGISTERED']),f.body(metadata,'canonical',['Order Code']),
    {...f.body(metadata),planHash:'0'.repeat(64)}, {...f.body(metadata),token:{...metadata.token,ownerId:'other-owner'}}]){
    const got=await f.post(body);assert.equal(got.status,200);assert.equal(got.headers.get('x-orders-view-mode'),'full');
  }
  await f.idle();assert.equal(f.jobs.length,0);assert.equal((await f.request('GET','cp/schema')).status,404);
});
test('legacy or backup own-schema absence returns full mode without creating a schema or ready view',async t=>{
  const f=await fixture(t),metadata=(await f.get()).body,primary=f.primary();delete primary.moduleSchemas;
  fs.writeFileSync(cache.manifestPath(f.owner),JSON.stringify(primary));assert.deepEqual((await f.get()).body,{mode:'full'});
  assert.equal((await f.post(f.body(metadata))).headers.get('x-orders-view-mode'),'full');
  fs.copyFileSync(cache.manifestPath(f.owner),cache.manifestPath(f.owner)+'.bak');fs.unlinkSync(cache.manifestPath(f.owner));
  assert.deepEqual((await f.get()).body,{mode:'full'});assert.equal((await f.post(f.body(metadata))).headers.get('x-orders-view-mode'),'full');
  await f.idle();assert.equal(f.jobs.length,0);
});
test('real native canonical guard can decline a registered model plan; full fallback never publishes ready bytes',async t=>{
  const f=await fixture(t,{canonicalDefinition:true}),metadata=(await f.get()).body;
  assert.equal((await f.post(f.body(metadata))).headers.get('x-orders-view-mode'),'full');await f.idle();
  assert.equal(f.jobs.length,1);assert.equal(f.jobs[0].kind,'full');assert.deepEqual(f.derived(),{});assert.equal(f.jobReleases,1);
});
test('unknown or other-module schema cannot authorize a ready request',async t=>{
  for(const mutate of [entry=>{entry.schema.status='unknown';},entry=>{entry.module='cp';}]){
    const f=await fixture(t),metadata=(await f.get()).body,manifest=f.primary();mutate(manifest.moduleSchemas.orders);
    fs.writeFileSync(cache.manifestPath(f.owner),JSON.stringify(manifest));
    assert.deepEqual((await f.get()).body,{mode:'full'});assert.equal((await f.post(f.body(metadata))).headers.get('x-orders-view-mode'),'full');
    await f.idle();assert.equal(f.jobs.length,0);
  }
});
test('same owner+plan deduplicates and process-wide background admission never exceeds two',async t=>{
  const a=await fixture(t),b=await fixture(t),c=await fixture(t);a.beforeRun=deferred();b.beforeRun=deferred();c.beforeRun=deferred();
  const ma=(await a.get()).body,mb=(await b.get()).body,mc=(await c.get()).body;
  await a.post(a.body(ma));await a.post(a.body(ma,'duplicate_nonce'));await b.post(b.body(mb));await c.post(c.body(mc));
  assert.equal(a.router.readyBackground.stats().processWide,2);assert.equal(a.router.readyBackground.stats().deduplicated,1);
  assert.equal(c.router.readyBackground.stats().capacityMiss,1);assert.equal(c.jobs.length,0);
  a.beforeRun.resolve();b.beforeRun.resolve();c.beforeRun.resolve();await Promise.all([a.idle(),b.idle(),c.idle()]);
  assert.equal(a.jobs.length,1);assert.equal(b.jobs.length,1);assert.equal(a.router.readyBackground.stats().processWide,0);
});
test('session/access/source/schema changes during deferred native work discard and release the result',async t=>{
  for(const change of [f=>f.sessions.delete('first'),f=>f.profiles.get(f.actor).areas=[],f=>f.sourceToken='superseded',
    f=>{const m=f.primary();delete m.moduleSchemas;fs.writeFileSync(cache.manifestPath(f.owner),JSON.stringify(m));}]){
    const f=await fixture(t),metadata=(await f.get()).body;f.beforeRun=deferred();await f.post(f.body(metadata));
    change(f);f.beforeRun.resolve();await f.idle();assert.deepEqual(f.derived(),{});assert.equal(f.pool.stats().leasedOutputBytes,0);
  }
});
test('same-generation full rewrite during deferred work invalidates the exact body/schema pin',async t=>{
  const f=await fixture(t),metadata=(await f.get()).body;f.beforeRun=deferred();const first=await f.post(f.body(metadata));
  await f.jobEntered.promise;
  await cache.writeProjection(f.owner,'orders',f.context.contextHash,{...first.body,syntheticRewriteMarker:true});
  assert.equal(f.primary().activeGeneration,f.manifest.activeGeneration);assert.notEqual(f.primary().modules.orders.checksum,sha(f.fullBuffer));
  f.beforeRun.resolve();await f.idle();assert.deepEqual(f.derived(),{});assert.equal(f.jobReleases,1);
});
test('live guard after awaiting a cached hit prevents delivery after actor/role revocation',async t=>{
  const f=await fixture(t),metadata=(await f.get()).body;await f.post(f.body(metadata));await f.idle();
  const entered=deferred(),resume=deferred();f.afterViewRead=async()=>{entered.resolve();await resume.promise;};
  const pending=f.post(f.body(metadata,'late_hit'));await entered.promise;f.profiles.get(f.actor).areas=[];resume.resolve();
  const got=await pending;assert.equal(got.status,403);assert.equal(got.headers.get('x-orders-view-mode'),null);assert.equal(f.jobs.length,1);
});
test('another actor or broader guard revision cannot adopt an earlier ready entry',async t=>{
  const f=await fixture(t),metadata=(await f.get()).body;await f.post(f.body(metadata));await f.idle();
  const other=await f.post(f.body(metadata),'second');assert.equal(other.headers.get('x-orders-view-mode'),'full');
  f.guardRevision++;const now=(await f.get()).body;assert.notEqual(now.guardStamp,metadata.guardStamp);
  assert.notEqual(f.body(now).planHash,f.body(metadata).planHash);assert.equal((await f.post(f.body(metadata))).headers.get('x-orders-view-mode'),'full');
  assert.equal(f.jobs.length,1);
});
test('revoke before the native final manifest guard prevents publication; never rewinds the full manifest',async t=>{
  const f=await fixture(t),metadata=(await f.get()).body,entered=deferred(),resume=deferred();
  const readFile=fs.promises.readFile,manifest=cache.manifestPath(f.owner);let intercepted=false;
  fs.promises.readFile=async function(file,...args){
    const value=await readFile.call(this,file,...args);
    if(!intercepted&&String(file).startsWith(manifest+'.')&&String(file).endsWith('.tmp')){intercepted=true;entered.resolve();await resume.promise;}
    return value;
  };
  t.after(()=>{fs.promises.readFile=readFile;resume.resolve();});
  await f.post(f.body(metadata));
  // A missing native assertCurrent option must produce a finite RED, not wait
  // forever for a temp file which the old writer correctly never creates.
  await Promise.race([entered.promise,f.idle()]);
  assert.equal(intercepted,true,'actual native writer must reach the final manifest commit guard');
  f.sessions.delete('first');resume.resolve();await f.idle();
  fs.promises.readFile=readFile;
  assert.equal(intercepted,true);assert.deepEqual(f.derived(),{});assert.equal(f.primary().activeGeneration,f.manifest.activeGeneration);
  assert.equal(f.primary().modules.orders.checksum,sha(f.fullBuffer));assert.equal(f.jobReleases,1);
});
test('router shutdown aborts only its admitted jobs and leaves the existing shared pool usable',async t=>{
  const f=await fixture(t),metadata=(await f.get()).body;f.beforeRun=deferred();await f.post(f.body(metadata));
  await f.router.readyBackground.close();assert.equal(f.router.readyBackground.stats().owned,0);assert.equal(f.router.readyBackground.stats().processWide,0);
  const lease=await f.service.run('source-info',f.descriptor,{});try{assert.equal(lease.value.rows,2);}finally{lease.release();}
});
test('same endpoint: old-owner schema then new-owner session POST returns newly authorized full identity',async t=>{
  const a=await fixture(t),b=await fixture(t),owners=new Map([[a.owner,a],[b.owner,b]]);
  const profiles=new Map([[a.actor,a.profiles.get(a.actor)],[b.actor,b.profiles.get(b.actor)]]);let sessionActor=a.actor;
  const sessionProfile=()=>profiles.get(sessionActor),contextFor=profile=>owners.get(profile.owner).context;
  const accessFor=profile=>createAccessContext({userId:profile.id,systemRole:'moderator',manageAll:true,viewScope:profile.viewScope,editScopes:{all:true},authority:{},profiles:[]});
  const broad=profile=>sha(JSON.stringify(['cross-owner-live-context',contextFor(profile).contextHash]));
  const guard=createComputeReadGuard({sessionProfile,profileById:id=>profiles.get(id),hasArea:(profile,area)=>profile.areas.includes(area),
    contextFor:profile=>({contextHash:broad(profile)}),accessFor,sourceTokenFor:id=>owners.get(profiles.get(id).owner).sourceToken});
  const router=createOrdersReadyRouter({express,cache,guard,contextFor,
    assertSourceFilters(targets){assert.deepEqual(targets,['orders']);if(!owners.get(sessionProfile().owner).filtersReady)throw stale();},
    assertCachedCurrent(_req,ctx,cached){
      const currentProfile=sessionProfile(),owner=owners.get(currentProfile.owner),primary=owner.primary();
      if(contextFor(currentProfile).id!==ctx.id||contextFor(currentProfile).contextHash!==ctx.contextHash
        ||owner.sourceToken!==owner.descriptor.generation||cached.manifest.contextHash!==ctx.contextHash
        ||primary.activeGeneration!==cached.manifest.activeGeneration||primary.modules.orders.checksum!==cached.meta.checksum
        ||cached.manifest.sourceProjectionKeys.orders!==owner.descriptor.projectionKeys.orders)throw stale();
    },
    sourceFor:async profile=>owners.get(profile.owner).descriptor,
    runTask:(task,descriptor,payload,options)=>owners.get(descriptor.ownerId).service.run(task,descriptor,payload,options),
    publishReady:(...args)=>cache.writeViewCompressed(...args),send:sendComputedResponse,
    apiError:(res,error)=>res.status(error.statusCode||500).json({code:error.code||'TEST_ERROR'})});
  const app=express();app.use('/api/page-projection',router);const server=app.listen(0,'127.0.0.1');
  await new Promise(resolve=>server.once('listening',resolve));
  t.after(async()=>{await router.readyBackground.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));});
  const base=`http://127.0.0.1:${server.address().port}/api/page-projection/orders`;
  const metadata=await (await fetch(base+'/schema')).json();assert.equal(metadata.token.ownerId,a.owner);
  sessionActor=b.actor;
  const response=await fetch(base+'/ready',{method:'POST',headers:{'Content-Type':'application/json','Accept-Encoding':'gzip'},body:JSON.stringify(a.body(metadata,'switch_nonce'))});
  assert.equal(response.status,200);const body=await response.json();assert.ok(Array.isArray(body.rows));assert.equal(body.profile,undefined);
  assert.equal(response.headers.get('x-orders-view-mode'),'full');assert.equal(response.headers.get('x-orders-request-nonce'),'switch_nonce');
  assert.equal(response.headers.get('x-orders-owner-b64'),Buffer.from(b.owner).toString('base64url'));
  assert.equal(response.headers.get('x-orders-actor-b64'),Buffer.from(b.actor).toString('base64url'));
  assert.notEqual(response.headers.get('x-orders-owner-b64'),Buffer.from(metadata.token.ownerId).toString('base64url'));
  assert.notEqual(response.headers.get('x-orders-actor-b64'),Buffer.from(metadata.token.actorId).toString('base64url'));
  assert.equal(response.headers.get('x-orders-access-hash'),accessFor(profiles.get(b.actor)).accessHash);
  assert.notEqual(response.headers.get('x-orders-access-hash'),metadata.token.accessHash);
  assert.equal(response.headers.get('x-orders-page-context-sha256'),sha(b.context.contextHash));
  assert.equal(response.headers.get('x-orders-broad-context-sha256'),sha(broad(profiles.get(b.actor))));
  assert.equal(response.headers.get('x-orders-guard-sha256'),sha(guard.capture({},'orders').key));
  assert.equal(response.headers.get('x-orders-cache-generation'),b.manifest.activeGeneration);
  assert.equal(response.headers.get('x-orders-full-gzip-sha256'),sha(b.fullBuffer));
  assert.notEqual(sha(b.fullBuffer),sha(a.fullBuffer));assert.equal(router.readyBackground.stats().started,0);
});
test('changed full body with old token reports the new exact full checksum without adopting the old ready identity',async t=>{
  const f=await fixture(t),metadata=(await f.get()).body;
  const original=await f.post({...f.body(metadata),planHash:'0'.repeat(64)});
  await cache.writeProjection(f.owner,'orders',f.context.contextHash,{...original.body,syntheticRewriteMarker:'fresh full only'});
  const current=f.primary(),response=await f.post(f.body(metadata,'changed_source'));
  assert.equal(response.headers.get('x-orders-view-mode'),'full');assert.equal(response.body.syntheticRewriteMarker,'fresh full only');
  assert.equal(response.headers.get('x-orders-cache-generation'),current.activeGeneration);
  assert.equal(response.headers.get('x-orders-full-gzip-sha256'),current.modules.orders.checksum);
  assert.notEqual(response.headers.get('x-orders-full-gzip-sha256'),original.headers.get('x-orders-full-gzip-sha256'));
  assert.equal(response.headers.get('x-orders-owner-b64'),Buffer.from(f.owner).toString('base64url'));
  assert.equal(response.headers.get('x-orders-request-nonce'),'changed_source');assert.equal(f.jobs.length,0);
});
test('actual native final response guard runs before identity headers or full data are sent',async t=>{
  const f=await fixture(t),metadata=(await f.get()).body;f.beforeSend=()=>f.sessions.delete('first');
  const response=await f.post({...f.body(metadata),planHash:'0'.repeat(64)});
  assert.equal(response.status,401);assert.equal(response.headers.get('x-orders-owner-b64'),null);
  assert.equal(response.headers.get('x-orders-full-gzip-sha256'),null);assert.equal(response.body.rows,undefined);
});
test('response identity encoding is bounded, lossless and header-safe; invalid metadata fails closed',()=>{
  const state=()=>({captured:{userId:'actor\r\nİ',accessHash:'a'.repeat(64),contextHash:'broad-context',key:'guard-key'},
    context:{id:'owner\r\nİ',contextHash:'page-context'},full:{manifest:{activeGeneration:'g_1',contextHash:'page-context',modules:{orders:{checksum:'b'.repeat(64)}}},meta:{checksum:'b'.repeat(64)}}});
  const valid=state(),headers=responseIdentityHeaders(valid);
  assert.equal(Buffer.from(headers['X-Orders-Owner-B64'],'base64url').toString('utf8'),valid.context.id);
  assert.equal(Buffer.from(headers['X-Orders-Actor-B64'],'base64url').toString('utf8'),valid.captured.userId);
  assert.ok(Object.values(headers).every(value=>/^[A-Za-z0-9_-]+$/.test(value)));
  assert.ok(Object.entries(headers).reduce((sum,[key,value])=>sum+key.length+value.length+4,0)<=3072);
  for(const change of [s=>{s.context.id='x'.repeat(513);},s=>{s.captured.userId='İ'.repeat(257);},s=>{s.context.id='\ud800';},
    s=>{s.full.manifest.activeGeneration='bad\r\nheader';},s=>{s.captured.accessHash='wrong';},s=>{s.full.meta.checksum='c'.repeat(64);},
    s=>{s.captured.contextHash='x'.repeat(4097);},s=>{s.captured.key='x'.repeat(16385);}]){
    const input=state();change(input);assert.throws(()=>responseIdentityHeaders(input),{code:'PROJECTION_VIEW_STALE'});
  }
});
test('native guarded cache declines and drains invalid asynchronous callbacks, including rejected promises',async t=>{
  const f=await fixture(t),metadata=(await f.get()).body;await f.post(f.body(metadata));await f.idle();
  const lease=await f.service.run('projection-ready-orders',f.descriptor,f.jobs[0].payload,{});
  const unhandled=[],observe=error=>unhandled.push(error);process.on('unhandledRejection',observe);
  try{
    const value=lease.value;assert.equal(value.kind,'ready');const buffer=Buffer.from(value.buffer),m=f.primary();
    const entry={buffer,bytes:buffer.length,uncompressedBytes:value.uncompressedBytes,checksum:value.checksum,registryKeys:value.registryKeys,info:value.info};
    const cases=[async()=>undefined,async()=>{throw Error('invalid async guard rejection');},()=>Promise.reject(Error('invalid rejected promise guard')),
      ()=>({then(_resolve,reject){reject(Error('invalid rejected thenable guard'));}})];
    for(let index=0;index<cases.length;index++){
      let calls=0;const pin={generation:m.activeGeneration,contextHash:m.contextHash,moduleInputKey:m.moduleInputKeys.orders,
        sourceProjectionKey:m.sourceProjectionKeys.orders,fullChecksum:m.modules.orders.checksum,sourceRevisionKey:m.sourceRevisionKey,planHash:sha('invalid-callback-'+index)};
      const result=await cache.writeViewCompressed(f.owner,'orders',pin,entry,{assertCurrent(){calls++;return cases[index]();}});
      assert.equal(calls,1,'callback must be reached by the real guarded cache writer');assert.equal(result,null);
      await new Promise(setImmediate);assert.deepEqual(unhandled,[]);assert.equal(f.primary().derivedViews?.orders?.[pin.planHash],undefined);
      assert.equal(f.primary().modules.orders.checksum,m.modules.orders.checksum);
    }
  }finally{process.removeListener('unhandledRejection',observe);lease.release();}
});

// Additive full-parent coverage. All adopted 22 test bodies remain unchanged.
function fullParentRequest(metadata,checksum,nonce='full_parent_nonce'){
  return {token:metadata.token,requestNonce:nonce,fullGzipChecksum:checksum,guardStamp:metadata.guardStamp};
}
async function waitForParentRead(entered,pending){
  // A missing route or early rejection must fail this assertion, not leave the
  // RED fixture waiting forever for a read that can no longer happen.
  await Promise.race([entered.promise,pending.then(result=>{
    assert.fail('full-parent finished before the required cache-read boundary: '+result.status);
  })]);
}
async function actualThinParent(f){
  const metadata=(await f.get()).body,cold=await f.post(f.body(metadata));await f.idle();
  const ready=await f.post(f.body(metadata,'known_ready_parent'));
  assert.equal(ready.headers.get('x-orders-view-mode'),'ready');
  return {metadata,cold,ready,request:fullParentRequest(metadata,ready.headers.get('x-orders-full-gzip-sha256'))};
}
test('explicit full-parent serves exact actual ready parent without a ready miss, new worker or reserialization',async t=>{
  const f=await fixture(t),parent=await actualThinParent(f),jobs=f.jobs.length,viewReads=f.viewReads,started=f.router.readyBackground.stats().started;
  for(const encoding of ['gzip','identity']){
    const got=await f.request('POST','orders/full-parent',parent.request,'first',encoding);
    assert.equal(got.status,200);assert.equal(got.headers.get('x-orders-view-mode'),'full');assert.equal(got.text,parent.cold.text);
    assert.equal(got.headers.get('x-orders-request-nonce'),'full_parent_nonce');assert.equal(got.headers.get('x-orders-plan-hash'),null);
    assert.equal(got.headers.get('x-orders-owner-b64'),Buffer.from(f.owner).toString('base64url'));
    assert.equal(got.headers.get('x-orders-actor-b64'),Buffer.from(f.actor).toString('base64url'));
    assert.equal(got.headers.get('x-orders-access-hash'),parent.metadata.token.accessHash);
    assert.equal(got.headers.get('x-orders-guard-sha256'),parent.metadata.guardStamp);
    assert.equal(got.headers.get('x-orders-cache-generation'),parent.metadata.token.sourceGeneration);
    assert.equal(got.headers.get('x-orders-full-gzip-sha256'),sha(f.fullBuffer));
    assert.equal(Buffer.from(got.headers.get('x-orders-source-projection-key-b64'),'base64url').toString('utf8'),parent.metadata.token.sourceProjectionKey);
    assert.equal(Buffer.from(got.headers.get('x-orders-module-input-key-b64'),'base64url').toString('utf8'),parent.metadata.token.moduleInputKey);
    assert.equal(got.headers.get('x-orders-source-revision'),parent.metadata.token.sourceRevision);
    assert.equal(got.headers.get('x-orders-full-json-bytes'),String(Buffer.byteLength(got.text)));
    assert.equal(got.headers.get('x-orders-full-row-count'),String(parent.ready.body.projection.schema.rowCount));
    // Actual worker raw SHA matches actual decoded full bytes. It is NOT the
    // compressed checksum in the response parent identity header.
    assert.equal(sha(Buffer.from(got.text,'utf8')),parent.ready.body.projection.viewInfo.fullJsonSha256);
    assert.equal(Buffer.byteLength(got.text),parent.ready.body.projection.viewInfo.fullJsonBytes);
    assert.notEqual(sha(Buffer.from(got.text,'utf8')),got.headers.get('x-orders-full-gzip-sha256'));
    assert.equal(got.body.profile,undefined);assert.equal(Object.hasOwn(got.body.rows[0],KEY),true);
  }
  await f.idle();assert.equal(f.jobs.length,jobs);assert.equal(f.viewReads,viewReads);assert.equal(f.router.readyBackground.stats().started,started);
});
test('full-parent mismatched expected token, gzip checksum or broad guard conflicts without any newly authorized body',async t=>{
  const f=await fixture(t),parent=await actualThinParent(f),jobs=f.jobs.length;
  const changes=Object.keys(parent.request.token).map(key=>({...parent.request,token:{...parent.request.token,[key]:parent.request.token[key]+'changed'}}));
  changes.push({...parent.request,fullGzipChecksum:'0'.repeat(64)},{...parent.request,guardStamp:'0'.repeat(64)},
    {...parent.request,fullGzipChecksum:parent.ready.body.projection.viewInfo.fullJsonSha256});
  for(const body of changes){
    const got=await f.request('POST','orders/full-parent',body);assert.equal(got.status,409);assert.equal(got.body.code,'PROJECTION_VIEW_STALE');
    assert.equal(got.body.rows,undefined);assert.equal(got.headers.get('x-orders-owner-b64'),null);assert.equal(got.headers.get('x-orders-full-gzip-sha256'),null);
  }
  const switched=await f.request('POST','orders/full-parent',parent.request,'second');assert.equal(switched.status,409);assert.equal(switched.body.rows,undefined);
  assert.equal(f.jobs.length,jobs);
});
test('full-parent accepts only the explicit bounded DTO, not ready-plan knobs or expected raw-hash echo',async t=>{
  const f=await fixture(t),metadata=(await f.get()).body,body=fullParentRequest(metadata,sha(f.fullBuffer));
  for(const invalidBody of [{...body,planHash:'0'.repeat(64)},{...body,omittedModelKeys:[KEY]},
    {...body,fullJsonSha256:'0'.repeat(64)},{...body,identity:{...body.token}},
    {...body,token:{...body.token,unexpected:'value'}},{...body,guardStamp:17},
    {...body,requestNonce:'bad\r\nheader'},{...body,fullGzipChecksum:'not-a-sha'}]){
    assert.equal((await f.request('POST','orders/full-parent',invalidBody)).status,400);
  }
  assert.equal((await f.request('POST','orders/full-parent',{...body,padding:'x'.repeat(70*1024)})).status,413);
  assert.equal(f.jobs.length,0);assert.equal(f.router.readyBackground.stats().started,0);
});
test('full-parent never rebuilds and rejects missing, unknown, legacy or backup schema authority',async t=>{
  for(const mode of ['missing','unknown','legacy','backup']){
    const f=await fixture(t),metadata=(await f.get()).body,body=fullParentRequest(metadata,sha(f.fullBuffer));
    if(mode==='missing')cache.invalidate(f.owner);
    else{
      const manifest=f.primary();
      if(mode==='unknown')manifest.moduleSchemas.orders.schema.status='unknown';
      if(mode==='legacy')delete manifest.moduleSchemas;
      if(mode==='backup'){fs.writeFileSync(cache.manifestPath(f.owner)+'.bak',JSON.stringify(manifest));fs.unlinkSync(cache.manifestPath(f.owner));}
      else fs.writeFileSync(cache.manifestPath(f.owner),JSON.stringify(manifest));
    }
    const got=await f.request('POST','orders/full-parent',body);assert.equal(got.status,409);assert.equal(got.body.rows,undefined);
    assert.equal(f.jobs.length,0);assert.equal(f.router.readyBackground.stats().started,0);
  }
});
test('full-parent full-cache read awaits recheck live actor, source, scope and filter authority',async t=>{
  for(const change of [f=>f.sessions.set('first',f.sessions.get('second')),
    f=>{f.sourceToken='superseded';},f=>{f.profiles.get(f.actor).viewScope={all:false,buyers:['changed']};},f=>{f.filtersReady=false;}]){
    const f=await fixture(t),metadata=(await f.get()).body,body=fullParentRequest(metadata,sha(f.fullBuffer)),entered=deferred(),resume=deferred();
    f.afterFullRead=async()=>{entered.resolve();await resume.promise;};
    const pending=f.request('POST','orders/full-parent',body);await waitForParentRead(entered,pending);change(f);resume.resolve();
    const got=await pending;assert.equal(got.status,409);assert.equal(got.body.rows,undefined);assert.equal(got.headers.get('x-orders-owner-b64'),null);
  }
});
test('full-parent same-generation full rewrite or schema loss at final native send cannot satisfy the old parent',async t=>{
  const f=await fixture(t),parent=await actualThinParent(f),entered=deferred(),resume=deferred();
  f.afterFullRead=async()=>{entered.resolve();await resume.promise;};
  const pending=f.request('POST','orders/full-parent',parent.request);await waitForParentRead(entered,pending);
  await cache.writeProjection(f.owner,'orders',f.context.contextHash,{...parent.cold.body,parentChanged:true});resume.resolve();
  const changed=await pending;assert.equal(changed.status,409);assert.equal(changed.body.rows,undefined);
  const other=await fixture(t),metadata=(await other.get()).body,body=fullParentRequest(metadata,sha(other.fullBuffer));
  other.beforeSend=()=>{const manifest=other.primary();delete manifest.moduleSchemas;fs.writeFileSync(cache.manifestPath(other.owner),JSON.stringify(manifest));};
  const late=await other.request('POST','orders/full-parent',body);assert.equal(late.status,409);assert.equal(late.body.rows,undefined);
  assert.equal(late.headers.get('x-orders-owner-b64'),null);assert.equal(late.headers.get('x-orders-source-projection-key-b64'),null);
});
test('same native endpoint refuses old owner full-parent after a session switch; a fresh matching owner parent succeeds',async t=>{
  const a=await fixture(t),b=await fixture(t),owners=new Map([[a.owner,a],[b.owner,b]]);
  const profiles=new Map([[a.actor,a.profiles.get(a.actor)],[b.actor,b.profiles.get(b.actor)]]);let sessionActor=a.actor,taskCalls=0;
  const sessionProfile=()=>profiles.get(sessionActor),contextFor=profile=>owners.get(profile.owner).context;
  const guard=createComputeReadGuard({sessionProfile,profileById:id=>profiles.get(id),hasArea:(profile,area)=>profile.areas.includes(area),
    contextFor:profile=>({contextHash:sha(JSON.stringify(['full-parent-cross-owner',contextFor(profile).contextHash]))}),
    accessFor:profile=>createAccessContext({userId:profile.id,systemRole:'moderator',manageAll:true,viewScope:profile.viewScope,editScopes:{all:true},authority:{},profiles:[]}),
    sourceTokenFor:id=>owners.get(profiles.get(id).owner).sourceToken});
  const router=createOrdersReadyRouter({express,cache,guard,contextFor,
    assertSourceFilters(targets){assert.deepEqual(targets,['orders']);if(!owners.get(sessionProfile().owner).filtersReady)throw stale();},
    assertCachedCurrent(_req,ctx,cached){
      const profile=sessionProfile(),owner=owners.get(profile.owner),primary=owner.primary();
      if(contextFor(profile).id!==ctx.id||contextFor(profile).contextHash!==ctx.contextHash||owner.sourceToken!==owner.descriptor.generation
        ||cached.manifest.contextHash!==ctx.contextHash||primary.activeGeneration!==cached.manifest.activeGeneration
        ||primary.modules.orders.checksum!==cached.meta.checksum||cached.manifest.sourceProjectionKeys.orders!==owner.descriptor.projectionKeys.orders)throw stale();
    },sourceFor:async profile=>owners.get(profile.owner).descriptor,
    runTask:(task,descriptor,payload,options)=>{taskCalls++;return owners.get(descriptor.ownerId).service.run(task,descriptor,payload,options);},
    publishReady:(...args)=>cache.writeViewCompressed(...args),send:sendComputedResponse,
    apiError:(res,error)=>res.status(error.statusCode||500).json({code:error.code||'TEST_ERROR'})});
  const app=express();app.use('/api/page-projection',router);const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  t.after(async()=>{await router.readyBackground.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));});
  const base=`http://127.0.0.1:${server.address().port}/api/page-projection/orders`;
  const old=await (await fetch(base+'/schema')).json();sessionActor=b.actor;
  const post=body=>fetch(base+'/full-parent',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const wrong=await post(fullParentRequest(old,sha(a.fullBuffer)));assert.equal(wrong.status,409);assert.equal((await wrong.json()).rows,undefined);
  assert.equal(wrong.headers.get('x-orders-owner-b64'),null);
  const fresh=await (await fetch(base+'/schema')).json(),right=await post(fullParentRequest(fresh,sha(b.fullBuffer),'new_ui_load'));
  assert.equal(right.status,200);assert.ok(Array.isArray((await right.json()).rows));
  assert.equal(right.headers.get('x-orders-owner-b64'),Buffer.from(b.owner).toString('base64url'));
  assert.equal(right.headers.get('x-orders-actor-b64'),Buffer.from(b.actor).toString('base64url'));
  assert.equal(right.headers.get('x-orders-full-gzip-sha256'),sha(b.fullBuffer));assert.equal(taskCalls,0);
});

test('revoked CP area cannot reuse earlier CP-derived own schema while Orders area remains granted',async t=>{
 const f=await fixture(t),before=(await f.get()).body;assert.equal(before.mode,'schema');
 f.profiles.get(f.actor).areas=['orders'];
 const after=await f.get();assert.equal(after.status,200);assert.deepEqual(after.body,{mode:'full'});
 const ready=await f.post(f.body(before));assert.equal(ready.status,409);assert.equal(ready.body.code,'ORDERS_FULL_REQUIRED');assert.equal(ready.body.rows,undefined);assert.equal(f.jobs.length,0);
});

test('first ordinary Orders GET binds its exact native full bytes without schema, second full read or worker',async t=>{
  const f=await fixture(t,{ordinaryGet:true}),manifest=f.primary();delete manifest.moduleSchemas;
  fs.writeFileSync(cache.manifestPath(f.owner),JSON.stringify(manifest));
  const got=await f.request('GET','orders');assert.equal(got.status,200);assert.ok(Array.isArray(got.body.rows));
  assert.equal(got.headers.get('x-orders-binding-version'),'1');assert.equal(got.headers.get('x-orders-view-mode'),'full');
  assert.equal(got.headers.get('x-orders-owner-b64'),Buffer.from(f.owner).toString('base64url'));
  assert.equal(got.headers.get('x-orders-actor-b64'),Buffer.from(f.actor).toString('base64url'));
  assert.equal(got.headers.get('x-orders-page-context-sha256'),sha(f.context.contextHash));
  const accessHash=createAccessContext({userId:f.actor,systemRole:'moderator',manageAll:true,viewScope:f.profiles.get(f.actor).viewScope,editScopes:{all:true},authority:{},profiles:[]}).accessHash;
  const broadContext=sha(JSON.stringify(['BROAD-GUARD',f.context.contextHash,f.guardRevision]));
  assert.equal(got.headers.get('x-orders-access-hash'),accessHash);assert.equal(got.headers.get('x-orders-broad-context-sha256'),sha(broadContext));
  assert.equal(got.headers.get('x-orders-guard-sha256'),sha(JSON.stringify({userId:f.actor,contextHash:broadContext,accessHash,sourceToken:f.sourceToken})));
  assert.equal(got.headers.get('x-orders-cache-generation'),manifest.activeGeneration);assert.equal(got.headers.get('x-orders-full-gzip-sha256'),sha(f.fullBuffer));
  assert.equal(got.headers.get('x-orders-full-json-bytes'),String(Buffer.byteLength(got.text)));
  assert.equal(got.headers.get('x-page-cache'),'hit');assert.equal(got.headers.get('x-page-cache-generation'),manifest.activeGeneration);
  assert.equal(got.headers.get('x-orders-request-nonce'),null,'ordinary GET does not invent a request nonce');
  assert.equal(f.lastOrdinaryBound.lease.value,f.lastOrdinaryLease.value);assert.equal(f.lastOrdinaryBound.lease.value.buffer,f.lastOrdinaryLease.value.buffer);
  assert.equal(f.fullReads,1);assert.equal(f.viewReads,0);assert.equal(f.schemaReads||0,0);assert.equal(f.jobs.length,0);assert.equal(f.ordinaryReleases,1);
  assert.deepEqual((await f.get()).body,{mode:'full'},'full receipt identity does not grant missing schema authority');
});
test('ordinary first-build worker lease retains its native output, identity streaming and one release',{timeout:5000},async t=>{
  const f=await fixture(t,{ordinaryGet:true,ordinaryWorkerLease:true}),got=await f.request('GET','orders',undefined,'first','identity');
  assert.equal(got.status,200);assert.equal(got.headers.get('content-encoding'),null);assert.equal(got.headers.get('x-page-cache'),'miss');
  assert.equal(got.headers.get('x-orders-full-gzip-sha256'),f.primary().modules.orders.checksum);
  assert.equal(got.headers.get('content-length'),String(Buffer.byteLength(got.text)));
  assert.equal(f.lastOrdinaryBound.lease.value,f.lastOrdinaryLease.value);assert.ok(f.lastOrdinaryLease.value.buffer instanceof ArrayBuffer);
  // Client body EOF and one local immediate do not prove that the server's
  // native finish/close callback has released its lease. Observe that actual
  // release; the bounded test still fails if the event or release never occurs.
  assert.ok(f.ordinaryReleased instanceof Promise);await f.ordinaryReleased;
  assert.equal(f.ordinaryWorkerCalls,1);assert.equal(f.ordinaryReleases,1);assert.equal(f.pool.stats().leasedOutputBytes,0);
  assert.equal(f.fullReads,0);assert.equal(f.viewReads,0);assert.equal(f.schemaReads||0,0);assert.equal(f.jobs.length,0);
});
test('ordinary legacy source metadata or explicit native backup fallback returns full without certification',async t=>{
  for(const missing of ['sourceRevisionKey','moduleInputKeys','sourceProjectionKeys']){
    const f=await fixture(t,{ordinaryGet:true}),manifest=f.primary();delete manifest[missing];
    fs.writeFileSync(cache.manifestPath(f.owner),JSON.stringify(manifest));
    const got=await f.request('GET','orders');assert.equal(got.status,200);assert.ok(Array.isArray(got.body.rows));
    assert.equal(got.headers.get('x-orders-binding-version'),null);assert.equal(got.headers.get('x-orders-full-gzip-sha256'),null);
    assert.equal(f.ordinaryReleases,1);assert.equal(f.schemaReads||0,0);
  }
  const unknown=await fixture(t,{ordinaryGet:true});unknown.beforeOrdinaryBind=lease=>{lease.manifest={...lease.manifest,schemaVersion:999};};
  const unknownResponse=await unknown.request('GET','orders');assert.equal(unknownResponse.status,200);
  assert.equal(unknownResponse.headers.get('x-orders-binding-version'),null);assert.ok(Array.isArray(unknownResponse.body.rows));assert.equal(unknown.ordinaryReleases,1);
  const f=await fixture(t,{ordinaryGet:true}),previous=f.primary();
  await cache.writeCompressedGeneration(f.owner,{contextHash:f.context.contextHash,sourceLoadedAt:previous.sourceLoadedAt,
    projections:{orders:{buffer:f.fullBuffer,uncompressedBytes:previous.modules.orders.uncompressedBytes}},
    extra:{sourceRevisionKey:previous.sourceRevisionKey,moduleInputKeys:previous.moduleInputKeys,sourceProjectionKeys:previous.sourceProjectionKeys}});
  const manifest=f.primary(),backup=JSON.parse(fs.readFileSync(cache.manifestPath(f.owner)+'.bak','utf8'));
  assert.notEqual(manifest.activeGeneration,previous.activeGeneration);assert.equal(backup.activeGeneration,previous.activeGeneration);
  manifest.modules.orders.checksum='0'.repeat(64);fs.writeFileSync(cache.manifestPath(f.owner),JSON.stringify(manifest));
  const got=await f.request('GET','orders');assert.equal(got.status,200,JSON.stringify({body:got.body,cacheState:f.lastOrdinaryLease?.cacheState,hookCaptures:f.hookCaptures}));assert.equal(got.headers.get('x-page-cache'),'fallback');
  assert.equal(got.headers.get('x-orders-binding-version'),null);assert.ok(Array.isArray(got.body.rows));assert.equal(f.ordinaryReleases,1);
});
test('same-generation backup is not a native fallback candidate and cannot certify corrupt current bytes',async t=>{
  const f=await fixture(t,{ordinaryGet:true}),manifest=f.primary();
  fs.copyFileSync(cache.manifestPath(f.owner),cache.manifestPath(f.owner)+'.bak');
  manifest.modules.orders.checksum='0'.repeat(64);fs.writeFileSync(cache.manifestPath(f.owner),JSON.stringify(manifest));
  const got=await f.request('GET','orders');assert.equal(got.status,409);assert.equal(got.body.rows,undefined);
  assert.equal(got.headers.get('x-orders-binding-version'),null);assert.equal(f.lastOrdinaryLease,undefined);
});
test('ordinary binding cannot recapture a new actor and relabel an earlier acquired lease',async t=>{
  const f=await fixture(t,{ordinaryGet:true});f.beforeOrdinaryBind=()=>f.sessions.set('first',f.sessions.get('second'));
  const got=await f.request('GET','orders');assert.equal(got.status,409);assert.equal(got.body.rows,undefined);
  assert.equal(got.headers.get('x-orders-owner-b64'),null);assert.equal(f.hookCaptures||0,0,'original lease guard runs before new capture');
  assert.equal(f.ordinaryReleases,1);
});
test('ordinary native final send rechecks original session, current source, filters and current cache bytes',async t=>{
  for(const [status,change] of [[401,f=>f.sessions.delete('first')],[409,f=>{f.sourceToken='superseded';}],
    [409,f=>{f.filtersReady=false;}],[403,f=>{f.profiles.get(f.actor).areas=[];}],
    [409,f=>{const manifest=f.primary();manifest.modules.orders.checksum='0'.repeat(64);fs.writeFileSync(cache.manifestPath(f.owner),JSON.stringify(manifest));}]]){
    const f=await fixture(t,{ordinaryGet:true});f.beforeOrdinarySend=()=>change(f);
    const got=await f.request('GET','orders');assert.equal(got.status,status);assert.equal(got.body.rows,undefined);
    assert.equal(got.headers.get('x-orders-binding-version'),null);assert.equal(f.ordinaryReleases,1);
  }
});
test('ordinary full checksum certification validates the actual response bytes, not an unrelated manifest hash',async t=>{
  const f=await fixture(t,{ordinaryGet:true});f.beforeOrdinarySend=(_bound,lease)=>{lease.value.buffer[lease.value.buffer.length-1]^=1;};
  const got=await f.request('GET','orders');assert.equal(got.status,409);assert.equal(got.body.rows,undefined);
  assert.equal(got.headers.get('x-orders-full-gzip-sha256'),null);assert.equal(f.ordinaryReleases,1);
});
test('ordinary header construction failure releases the actual worker lease without sending partial identity',async t=>{
  const f=await fixture(t,{ordinaryGet:true,ordinaryWorkerLease:true}),longId='x'.repeat(513);
  f.profiles.set(longId,{...f.profiles.get(f.actor),id:longId});f.sessions.set('first',longId);
  const got=await f.request('GET','orders');assert.equal(got.status,409);assert.equal(got.body.rows,undefined);
  assert.equal(got.headers.get('x-orders-owner-b64'),null);assert.equal(f.ordinaryReleases,1);
  assert.equal(f.pool.stats().leasedOutputBytes,0);
});
test('lone backup may describe actual ordinary bytes but still cannot establish PRIMARY schema authority',async t=>{
  const f=await fixture(t,{ordinaryGet:true});fs.copyFileSync(cache.manifestPath(f.owner),cache.manifestPath(f.owner)+'.bak');fs.unlinkSync(cache.manifestPath(f.owner));
  const got=await f.request('GET','orders');assert.equal(got.status,200);assert.equal(got.headers.get('x-orders-full-gzip-sha256'),sha(f.fullBuffer));
  assert.equal(got.headers.get('x-orders-owner-b64'),Buffer.from(f.owner).toString('base64url'));
  assert.equal(f.schemaReads||0,0);assert.deepEqual((await f.get()).body,{mode:'full'});
});
test('ordinary wrapper retains the original guard and release method snapshots through final send',async t=>{
  const f=await fixture(t,{ordinaryGet:true});let originalChecks=0,beforeSendChecks=0,replacements=0;
  f.beforeOrdinaryBind=lease=>{const check=lease.assertResponse;lease.assertResponse=function(){originalChecks++;return check.call(lease);};};
  f.beforeOrdinarySend=(_bound,lease)=>{beforeSendChecks=originalChecks;lease.assertResponse=()=>{replacements++;throw stale();};lease.release=()=>{replacements++;};};
  const got=await f.request('GET','orders');assert.equal(got.status,200);assert.ok(originalChecks>beforeSendChecks);
  assert.equal(replacements,0);assert.equal(f.ordinaryReleases,1);
});
