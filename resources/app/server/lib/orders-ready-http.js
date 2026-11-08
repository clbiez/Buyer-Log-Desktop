'use strict';
// Optional ready-byte transport. Installation and the existing pool remain server-owned.
const crypto=require('node:crypto'),{types}=require('node:util');
const PROFILE='orders-ready-model-v1',MAX_BODY=65536;
const TOKEN_KEYS=['ownerId','actorId','module','sourceGeneration','sourceRevision','moduleInputKey','sourceProjectionKey','accessHash','contextHash','planRevision','requestGeneration'];
const flights=new Map(); // Process-wide transient admission only. At most two, no pending queue.
const sha=value=>crypto.createHash('sha256').update(value).digest('hex');
const own=(object,key)=>Object.prototype.hasOwnProperty.call(object,key);
function record(value){
  if(!value||typeof value!=='object'||types.isProxy(value)||Array.isArray(value)||![Object.prototype,null].includes(Object.getPrototypeOf(value)))return false;
  return Reflect.ownKeys(value).every(key=>{const d=Object.getOwnPropertyDescriptor(value,key);return typeof key==='string'&&d.enumerable&&own(d,'value');});
}
function exact(value,keys){return record(value)&&Object.keys(value).length===keys.length&&keys.every(key=>own(value,key));}
function failure(code,statusCode,tr,en){return Object.assign(Error(tr+' / '+en),{code,statusCode,errorEn:en});}
const invalid=()=>failure('ORDERS_READY_INVALID',400,'Geçersiz sipariş görünümü isteği.','Invalid Orders view request.');
const stale=()=>failure('PROJECTION_VIEW_STALE',409,'Sipariş verisi değişti.','Orders data changed.');
function validToken(value){return exact(value,TOKEN_KEYS)&&TOKEN_KEYS.every(key=>typeof value[key]==='string'&&value[key].length>0&&value[key].length<=512);}
function sameToken(a,b){return validToken(a)&&validToken(b)&&TOKEN_KEYS.every(key=>a[key]===b[key]);}
function responseIdentityHeaders({captured,context,full}){
  // Identity of the actually authorized response, never the supplied request
  // token. Encoding keeps Unicode owner/actor IDs out of raw HTTP headers.
  function bounded(value,max){
    if(typeof value!=='string'||!value.length||value.length>max||Buffer.byteLength(value)>max)throw stale();
    return value;
  }
  function id(value){
    if(typeof value==='number'&&Number.isSafeInteger(value))value=String(value);
    const bytes=Buffer.from(bounded(value,512),'utf8');
    if(bytes.toString('utf8')!==value)throw stale(); // No lossy lone-surrogate alias.
    return bytes.toString('base64url');
  }
  const manifest=full?.manifest,meta=manifest?.modules?.orders;
  if(!manifest||manifest.contextHash!==context?.contextHash||meta?.checksum!==full?.meta?.checksum
    ||typeof manifest.activeGeneration!=='string'||!/^[A-Za-z0-9_-]{1,100}$/.test(manifest.activeGeneration)
    ||typeof meta?.checksum!=='string'||!/^[a-f0-9]{64}$/.test(meta.checksum)
    ||typeof captured?.accessHash!=='string'||!/^[a-f0-9]{64}$/.test(captured.accessHash))throw stale();
  const headers={
    'X-Orders-Binding-Version':'1',
    'X-Orders-Owner-B64':id(context.id),'X-Orders-Actor-B64':id(captured.userId),
    'X-Orders-Access-Hash':captured.accessHash,
    'X-Orders-Page-Context-Sha256':sha(bounded(manifest.contextHash,4096)),
    'X-Orders-Broad-Context-Sha256':sha(bounded(captured.contextHash,4096)),
    'X-Orders-Guard-Sha256':sha(bounded(captured.key,16384)),
    'X-Orders-Cache-Generation':manifest.activeGeneration,
    'X-Orders-Full-Gzip-Sha256':meta.checksum,
  };
  if(Object.entries(headers).reduce((sum,[key,value])=>sum+key.length+value.length+4,0)>3072)throw stale();
  return Object.freeze(headers);
}
function rawKeys(value){
  if(!Array.isArray(value)||types.isProxy(value)||Object.getPrototypeOf(value)!==Array.prototype||value.length<1||value.length>64||Reflect.ownKeys(value).length!==value.length+1)return null;
  const result=[];
  for(let index=0;index<value.length;index++){
    const d=Object.getOwnPropertyDescriptor(value,String(index));
    if(!d||!d.enumerable||!own(d,'value')||typeof d.value!=='string'||d.value.length<1||d.value.length>256)return null;
    result.push(d.value);
  }
  return new Set(result).size===result.length?result:null;
}
function planHashFor({token,schemaChecksum,guardStamp,omittedModelKeys}){
  return sha(JSON.stringify(['orders-ready-http-plan-v1',TOKEN_KEYS.map(key=>token[key]),schemaChecksum,guardStamp,omittedModelKeys]));
}
function dto(body){
  if(!exact(body,['token','requestNonce','omittedModelKeys','planHash'])||!validToken(body.token)
    ||typeof body.requestNonce!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(body.requestNonce)
    ||typeof body.planHash!=='string'||!/^[a-f0-9]{64}$/.test(body.planHash))throw invalid();
  const keys=rawKeys(body.omittedModelKeys);if(!keys)throw invalid();
  // The existing narrow parser must also precede the broad app parser. This
  // bound validates the DTO if the narrow upstream parser has already run.
  if(Buffer.byteLength(JSON.stringify(body))>MAX_BODY)throw failure('ORDERS_READY_TOO_LARGE',413,'İstek çok büyük.','Request too large.');
  return {token:Object.fromEntries(TOKEN_KEYS.map(key=>[key,body.token[key]])),requestNonce:body.requestNonce,omittedModelKeys:keys,planHash:body.planHash};
}
function fullParentDto(body){
  if(!exact(body,['token','requestNonce','fullGzipChecksum','guardStamp'])||!validToken(body.token)
    ||typeof body.requestNonce!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(body.requestNonce)
    ||typeof body.fullGzipChecksum!=='string'||!/^[a-f0-9]{64}$/.test(body.fullGzipChecksum)
    ||typeof body.guardStamp!=='string'||!/^[a-f0-9]{64}$/.test(body.guardStamp))throw invalid();
  if(Buffer.byteLength(JSON.stringify(body))>MAX_BODY)throw failure('ORDERS_READY_TOO_LARGE',413,'İstek çok büyük.','Request too large.');
  return {token:Object.fromEntries(TOKEN_KEYS.map(key=>[key,body.token[key]])),requestNonce:body.requestNonce,
    fullGzipChecksum:body.fullGzipChecksum,guardStamp:body.guardStamp};
}
function fullParentHeaders(token,binding){
  function encoded(value){
    if(typeof value!=='string'||!value.length||value.length>512||Buffer.byteLength(value)>512)throw stale();
    const bytes=Buffer.from(value,'utf8');if(bytes.toString('utf8')!==value)throw stale();return bytes.toString('base64url');
  }
  if(!Number.isSafeInteger(binding.pin.uncompressedBytes)||binding.pin.uncompressedBytes<1||binding.pin.uncompressedBytes>128*1024*1024
    ||!Number.isSafeInteger(binding.schema.rowCount)||binding.schema.rowCount<0||binding.schema.rowCount>50000
    ||!/^[a-f0-9]{64}$/.test(token.sourceRevision))throw stale();
  const headers={'X-Orders-Source-Projection-Key-B64':encoded(token.sourceProjectionKey),
    'X-Orders-Module-Input-Key-B64':encoded(token.moduleInputKey),'X-Orders-Source-Revision':token.sourceRevision,
    'X-Orders-Full-Json-Bytes':String(binding.pin.uncompressedBytes),'X-Orders-Full-Row-Count':String(binding.schema.rowCount)};
  if(Object.entries(headers).reduce((sum,[key,value])=>sum+key.length+value.length+4,0)>2048)throw stale();
  return headers;
}
function createOrdersReadyRouter({express,cache,guard,assertSourceFilters,contextFor,assertCachedCurrent,sourceFor,runTask,publishReady,send,apiError,onBackgroundError=()=>{}}={}){
  for(const name of ['readProjectionCompressed','readCurrentModuleSchema','readViewCompressed'])if(typeof cache?.[name]!=='function')throw TypeError('Actual cache API required: '+name);
  for(const callback of [assertSourceFilters,contextFor,assertCachedCurrent,sourceFor,runTask,publishReady,send,apiError,onBackgroundError])if(typeof callback!=='function')throw TypeError('Orders ready callback required');
  if(typeof guard?.capture!=='function'||typeof express?.Router!=='function')throw TypeError('Actual Express and live guard required');
  // publishReady must forward assertCurrent into the existing native writer's
  // LAST pre-rename guard. A pre/post-only wrapper is not this contract.
  const router=express.Router(),instance=Symbol('orders-ready-router'),owned=new Set();let closed=false;
  const counters={started:0,deduplicated:0,capacityMiss:0,published:0,discarded:0,failed:0};
  function live(req,captured){if(closed)throw stale();captured.assertBuild();captured.assertResponse();assertSourceFilters(['orders'],req);}
  function current(req,captured,context,full){live(req,captured);assertCachedCurrent(req,context,full);}
  function schemaFor(req,captured,context,full){
    current(req,captured,context,full);
    return cache.readCurrentModuleSchema(String(context.id),'orders',context.contextHash,full);
  }
  function tokenFor(captured,context,full){
    const manifest=full.manifest,meta=manifest?.modules?.orders;
    if(!manifest?.activeGeneration||manifest.contextHash!==context.contextHash||!manifest.sourceRevisionKey
      ||!manifest.moduleInputKeys?.orders||!manifest.sourceProjectionKeys?.orders||!meta?.checksum)throw stale();
    const token={ownerId:String(context.id),actorId:captured.userId,module:'orders',sourceGeneration:manifest.activeGeneration,
      sourceRevision:sha(JSON.stringify([manifest.sourceRevisionKey,meta.checksum])),moduleInputKey:manifest.moduleInputKeys.orders,
      sourceProjectionKey:manifest.sourceProjectionKeys.orders,accessHash:captured.accessHash,
      contextHash:manifest.contextHash,planRevision:'0',requestGeneration:'orders-ready-v1'};
    if(!validToken(token))throw stale();return token;
  }
  async function acquire(req){
    const captured=guard.capture(req,'orders');assertSourceFilters(['orders'],req);const context=contextFor(captured.profile);
    const full=await cache.readProjectionCompressed(context.id,'orders',context.contextHash);
    live(req,captured);if(full)current(req,captured,context,full);
    return {captured,context,full};
  }
  function registered(keys,schema){
    if(schema?.status!=='known'||schema.module!=='orders'||!Array.isArray(schema.rowKeys)||!Array.isArray(schema.modelColumns))return false;
    // Cheap admission only. The native ready builder is still the sole full
    // registration/hidden-key/canonical-protection validator for publication.
    return keys.every(key=>key.startsWith('__CPX_')&&schema.rowKeys.includes(key)
      &&schema.modelColumns.filter(definition=>definition.header===key).length===1);
  }
  function sidecarValid(hit,expected){
    try {
    const info=hit?.info,producer=info?.producerInfo,view=producer?.viewInfo;
    if(!exact(info,['version','profile','guardStamp','planHash','schemaChecksum','token','producerInfo'])||info.version!==1||info.profile!==PROFILE
      ||info.guardStamp!==expected.guardStamp||info.planHash!==expected.planHash||info.schemaChecksum!==expected.binding.schemaChecksum
      ||!sameToken(info.token,expected.token)||!record(producer)||producer.schemaVersion!==1||producer.module!=='orders'
      ||JSON.stringify(producer.omittedKeys)!==JSON.stringify(expected.keys)||!record(producer.schema)||sha(JSON.stringify(producer.schema))!==expected.binding.schemaChecksum
      ||!record(view)||own(view,'requestNonce')||view.ownerId!==expected.token.ownerId||view.actorId!==expected.token.actorId
      ||view.accessHash!==expected.token.accessHash||view.sourceKey!==expected.token.sourceProjectionKey||view.sourceGeneration!==expected.token.sourceGeneration
      ||view.planEpoch!==0||view.fullJsonBytes!==expected.binding.pin.uncompressedBytes||!/^([a-f0-9]{64})$/.test(view.fullJsonSha256||''))return false;
    return JSON.stringify(hit.meta?.registryKeys)===JSON.stringify(expected.binding.schema.rowKeys);
    }catch(_){return false;} // Malformed optional metadata is a full fallback, never a response failure.
  }
  function viewPin(full,hash){const m=full.manifest;return {generation:m.activeGeneration,contextHash:m.contextHash,moduleInputKey:m.moduleInputKeys.orders,
    sourceProjectionKey:m.sourceProjectionKeys.orders,fullChecksum:m.modules.orders.checksum,sourceRevisionKey:m.sourceRevisionKey,planHash:hash};}
  function captureGuard(req,captured,context,full,binding,token,guardStamp){
    return ()=>{
      current(req,captured,context,full);
      const actual=cache.readCurrentModuleSchema(String(context.id),'orders',context.contextHash,full);
      if(!actual||actual.schemaChecksum!==binding.schemaChecksum||JSON.stringify(actual.pin)!==JSON.stringify(binding.pin)
        ||!sameToken(tokenFor(captured,context,full),token)||sha(captured.key)!==guardStamp)throw stale();
    };
  }
  function background(req,state,body,binding,token,guardStamp,pin){
    if(closed||req.aborted)return;
    const key=JSON.stringify([token.ownerId,body.planHash]);
    if(flights.has(key)){counters.deduplicated++;return;}
    if(flights.size>=2){counters.capacityMiss++;return;}
    const controller=new AbortController();let done;
    const complete=new Promise(resolve=>{done=resolve;});const job={instance,controller,complete};flights.set(key,job);owned.add(job);counters.started++;
    const {captured,context,full}=state,check=captureGuard(req,captured,context,full,binding,token,guardStamp);
    setImmediate(async()=>{
      let lease;
      const assertCurrent=()=>{if(controller.signal.aborted)throw stale();check();};
      try{
        assertCurrent();const descriptor=await sourceFor(captured.profile);assertCurrent();
        const manifest=full.manifest,meta=manifest.modules.orders;
        if(String(descriptor?.ownerId)!==token.ownerId||descriptor.loadedAt!==manifest.sourceLoadedAt
          ||descriptor.projectionKeys?.orders!==token.sourceProjectionKey||typeof descriptor.generation!=='string')throw stale();
        const projectionPin={schemaVersion:manifest.schemaVersion,cacheGeneration:manifest.activeGeneration,sourceLoadedAt:manifest.sourceLoadedAt,
          sourceRevisionKey:manifest.sourceRevisionKey,module:'orders',moduleInputKey:manifest.moduleInputKeys.orders,
          sourceProjectionKey:manifest.sourceProjectionKeys.orders,contextHash:manifest.contextHash,checksum:meta.checksum,uncompressedBytes:meta.uncompressedBytes};
        const viewInfo={ownerId:token.ownerId,actorId:token.actorId,sourceKey:token.sourceProjectionKey,sourceGeneration:token.sourceGeneration,
          accessHash:token.accessHash,planEpoch:0,fullJsonBytes:meta.uncompressedBytes};
        lease=await runTask('projection-ready-orders',descriptor,{projectionBuffer:full.buffer,projectionCompressedBytes:full.buffer.length,
          projectionBytes:meta.uncompressedBytes,projectionChecksum:meta.checksum,projectionPin,computeGeneration:descriptor.generation,
          token,viewInfo,schema:binding.schema,omittedKeys:body.omittedModelKeys},{signal:controller.signal,priority:'background'});
        assertCurrent();
        if(lease.value?.kind!=='ready'){counters.discarded++;return;}
        const value=lease.value,buffer=Buffer.isBuffer(value.buffer)?value.buffer:Buffer.from(value.buffer);
        const info={version:1,profile:PROFILE,guardStamp,planHash:body.planHash,schemaChecksum:binding.schemaChecksum,token,producerInfo:value.info};
        const entry={buffer,bytes:buffer.length,uncompressedBytes:value.uncompressedBytes,checksum:value.checksum,registryKeys:value.registryKeys,info};
        // Validate the actual producer descriptor before handing bytes to the
        // cache. The worker computed the full-row hash; main never inflates it.
        if(!sidecarValid({info,meta:{registryKeys:value.registryKeys}},{guardStamp,planHash:body.planHash,binding,token,keys:body.omittedModelKeys}))throw stale();
        assertCurrent();const saved=await publishReady(token.ownerId,'orders',pin,entry,{assertCurrent});
        assertCurrent();if(saved)counters.published++;else counters.discarded++;
      }catch(error){counters.failed++;try{onBackgroundError({code:error?.code||'ORDERS_READY_BACKGROUND_FAILED'});}catch(_){} }
      finally{lease?.release();if(flights.get(key)===job)flights.delete(key);owned.delete(job);done();}
    });
  }
  function sendFull(req,res,state,nonce,prepare,parent){
    const {captured,context,full}=state;
    if(!full)throw failure('ORDERS_FULL_REQUIRED',409,'Tam sipariş görünümünü yeniden yükleyin.','Reload the ordinary full Orders projection.');
    current(req,captured,context,full);
    parent?.assertResponse();
    const headers={...parent?.headers,...responseIdentityHeaders(state),'X-Orders-View-Mode':'full','X-Orders-Request-Nonce':nonce};
    if(prepare)res.once('finish',()=>background(req,state,...prepare)); // No worker/serialization in the response path.
    return send(req,res,{value:{buffer:full.buffer,uncompressedBytes:full.meta.uncompressedBytes},
      assertResponse:()=>{current(req,captured,context,full);parent?.assertResponse();},release(){}},
    {headers});
  }
  router.get('/orders/schema',async(req,res)=>{
    try{
      const state=await acquire(req),{captured,context,full}=state;
      if(!full){live(req,captured);return res.set('Cache-Control','no-store').json({mode:'full'});}
      const binding=schemaFor(req,captured,context,full);
      if(!binding){current(req,captured,context,full);return res.set('Cache-Control','no-store').json({mode:'full'});}
      const token=tokenFor(captured,context,full),guardStamp=sha(captured.key);
      const result={mode:'schema',profile:PROFILE,token,schema:binding.schema,schemaChecksum:binding.schemaChecksum,guardStamp,planHashVersion:1};
      const check=captureGuard(req,captured,context,full,binding,token,guardStamp);check();
      if(Buffer.byteLength(JSON.stringify(result))>MAX_BODY)return res.set('Cache-Control','no-store').json({mode:'full'});
      return res.set('Cache-Control','no-store').json(result);
    }catch(error){return apiError(res,error,'Sipariş şeması okunamadı.');}
  });
  // Explicit promotion of this exact pending full parent. A different current
  // owner/source is a conflict here, never an ordinary-new-full fallback.
  router.post('/orders/full-parent',express.json({limit:MAX_BODY,strict:true}),async(req,res)=>{
    try{
      const body=fullParentDto(req.body),state=await acquire(req),{captured,context,full}=state;
      if(!full)throw stale();
      const binding=schemaFor(req,captured,context,full);if(!binding)throw stale();
      const token=tokenFor(captured,context,full),guardStamp=sha(captured.key);
      if(!sameToken(body.token,token)||body.fullGzipChecksum!==binding.pin.fullChecksum||body.guardStamp!==guardStamp)throw stale();
      const check=captureGuard(req,captured,context,full,binding,token,guardStamp);check();
      return sendFull(req,res,state,body.requestNonce,undefined,{assertResponse:check,headers:fullParentHeaders(token,binding)});
    }catch(error){return apiError(res,error,'Tam sipariş kaynağı okunamadı. / Full Orders source could not be read.');}
  });
  router.post('/orders/ready',express.json({limit:MAX_BODY,strict:true}),async(req,res)=>{
    try{
      const body=dto(req.body),state=await acquire(req),{captured,context,full}=state;
      if(!full)return sendFull(req,res,state,body.requestNonce);
      const binding=schemaFor(req,captured,context,full);
      if(!binding)return sendFull(req,res,state,body.requestNonce);
      const token=tokenFor(captured,context,full),guardStamp=sha(captured.key);
      if(!sameToken(body.token,token)||!registered(body.omittedModelKeys,binding.schema)
        ||body.planHash!==planHashFor({token,schemaChecksum:binding.schemaChecksum,guardStamp,omittedModelKeys:body.omittedModelKeys}))return sendFull(req,res,state,body.requestNonce);
      const pin=viewPin(full,body.planHash),check=captureGuard(req,captured,context,full,binding,token,guardStamp);
      check();const hit=await cache.readViewCompressed(token.ownerId,'orders',pin,{requireInfo:true});check();
      if(hit&&sidecarValid(hit,{guardStamp,planHash:body.planHash,binding,token,keys:body.omittedModelKeys})){
        return send(req,res,{value:{buffer:hit.buffer,uncompressedBytes:hit.meta.uncompressedBytes},assertResponse:check,release(){}},
          {headers:{...responseIdentityHeaders(state),'X-Orders-View-Mode':'ready','X-Orders-Request-Nonce':body.requestNonce,'X-Orders-Plan-Hash':body.planHash}});
      }
      return sendFull(req,res,state,body.requestNonce,[body,binding,token,guardStamp,pin]);
    }catch(error){return apiError(res,error,'Sipariş görünümü okunamadı.');}
  });
  // Internal only: stamp the exact ordinary GET lease, never fetch another full
  // projection or infer schema authority. Native send must use the returned lease.
  router.bindOrdinaryFullResponse=(req,lease)=>{
    let released=false;const originalAssert=lease?.assertResponse,originalRelease=lease?.release;
    const release=()=>{if(!released){released=true;if(typeof originalRelease==='function')originalRelease.call(lease);}};
    try{
      if(typeof originalAssert!=='function'||typeof originalRelease!=='function')throw stale();
      originalAssert.call(lease); // The original acquisition may predate a session/source change.
      const captured=guard.capture(req,'orders'),context=contextFor(captured.profile);
      const baseCheck=()=>{originalAssert.call(lease);live(req,captured);};baseCheck();
      const wrapped={...lease,assertResponse:baseCheck,release};
      const manifest=lease.manifest,meta=manifest?.modules?.orders;
      const text=value=>typeof value==='string'&&value.length>0&&value.length<=512;
      const known=record(manifest)&&manifest.schemaVersion===cache.CACHE_SCHEMA_VERSION
        &&typeof manifest.activeGeneration==='string'&&/^[A-Za-z0-9_-]{1,100}$/.test(manifest.activeGeneration)
        &&text(manifest.contextHash)&&text(manifest.sourceRevisionKey)
        &&record(manifest.moduleInputKeys)&&text(manifest.moduleInputKeys.orders)
        &&record(manifest.sourceProjectionKeys)&&text(manifest.sourceProjectionKeys.orders)
        &&record(meta)&&typeof meta.checksum==='string'&&/^[a-f0-9]{64}$/.test(meta.checksum)
        &&Number.isSafeInteger(meta.bytes)&&meta.bytes>0&&meta.bytes<=64*1024*1024
        &&Number.isSafeInteger(meta.uncompressedBytes)&&meta.uncompressedBytes>0&&meta.uncompressedBytes<=128*1024*1024;
      // A legacy/unknown response stays on its original authorized full path.
      // Explicit fallback is conservatively uncertified; no PRIMARY claim is made.
      if(!known||lease.cacheState==='fallback')return {lease:wrapped,headers:Object.freeze({})};
      const value=lease.value,input=value?.buffer;
      let buffer;
      if(types.isProxy(input))throw stale();
      if(Buffer.isBuffer(input))buffer=input;
      else if(input instanceof ArrayBuffer)buffer=Buffer.from(input);
      else if(ArrayBuffer.isView(input)&&input.buffer instanceof ArrayBuffer)buffer=Buffer.from(input.buffer,input.byteOffset,input.byteLength);
      else throw stale();
      if(value.uncompressedBytes!==meta.uncompressedBytes||buffer.length!==meta.bytes)throw stale();
      const full={manifest,meta,buffer,module:'orders',fallback:false};
      const stamp=()=>JSON.stringify({schemaVersion:manifest.schemaVersion,generation:manifest.activeGeneration,contextHash:manifest.contextHash,
        sourceLoadedAt:manifest.sourceLoadedAt,sourceRevisionKey:manifest.sourceRevisionKey,moduleInputKey:manifest.moduleInputKeys?.orders,
        sourceProjectionKey:manifest.sourceProjectionKeys?.orders,checksum:meta.checksum,bytes:meta.bytes,rawBytes:meta.uncompressedBytes});
      const initial=stamp();current(req,captured,context,full);
      const headers=Object.freeze({...responseIdentityHeaders({captured,context,full}),'X-Orders-View-Mode':'full',
        'X-Orders-Full-Json-Bytes':String(meta.uncompressedBytes)});
      wrapped.assertResponse=()=>{
        baseCheck();
        if(lease.manifest!==manifest||lease.value!==value||value.buffer!==input||manifest.modules?.orders!==meta
          ||stamp()!==initial||value.uncompressedBytes!==meta.uncompressedBytes)throw stale();
        current(req,captured,context,full);
        // One compressed-byte hash at the actual final native send guard. No
        // main-thread gunzip/raw SHA, row graph, extra full read or buffer copy.
        if(buffer.length!==meta.bytes||sha(buffer)!==meta.checksum)throw stale();
      };
      return {lease:wrapped,headers};
    }catch(error){release();throw error;}
  };
  router.readyBackground=Object.freeze({
    stats:()=>({...counters,owned:owned.size,processWide:flights.size,limit:2}),
    idle:()=>Promise.all([...owned].map(job=>job.complete)),
    async close(){closed=true;for(const job of owned)job.controller.abort();await Promise.all([...owned].map(job=>job.complete));},
  });
  return router;
}
module.exports={createOrdersReadyRouter,planHashFor,responseIdentityHeaders,PROFILE};
