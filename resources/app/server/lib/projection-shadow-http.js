'use strict';
const crypto=require('node:crypto');
const TOKEN_KEYS=['ownerId','actorId','module','sourceGeneration','sourceRevision','moduleInputKey',
  'sourceProjectionKey','accessHash','contextHash','planRevision','requestGeneration'];
const FULL_SHADOW_PLAN='cp-orders-full-shadow-v1';
function failure(code,statusCode,tr,en){return Object.assign(Error(tr+' / '+en),{code,statusCode,errorEn:en});}
function invalid(){return failure('PROJECTION_VIEW_INVALID',400,'Geçersiz ekran detayı isteği.','Invalid view detail request.');}
function stale(){return failure('PROJECTION_VIEW_STALE',409,'Ekran verisi değişti. Ekranı yeniden yükleyin.','View data changed. Reload the screen.');}
function createProjectionShadowRouter({express,guard,assertSourceFilters,contextFor,projectionFor,assertProjectionCurrent,runTask,send,apiError,secret}={}){
  for(const callback of [assertSourceFilters,contextFor,projectionFor,assertProjectionCurrent,runTask,send,apiError])
    if(typeof callback!=='function')throw new TypeError('Projection router callback required');
  if(!guard||typeof guard.capture!=='function'||!Buffer.isBuffer(secret)||secret.length!==32)throw new TypeError('Projection guard and private secret required');
  const router=express.Router();
  function bind(captured,context,full,module,requestGeneration){
    const manifest=full.manifest,meta=manifest?.modules?.[module];
    if(!manifest?.activeGeneration||manifest.contextHash!==context.contextHash||!manifest.sourceRevisionKey
      ||!manifest.moduleInputKeys?.[module]||!manifest.sourceProjectionKeys?.[module]
      ||typeof meta?.checksum!=='string'||!/^[a-f0-9]{64}$/.test(meta.checksum)
      ||!Number.isSafeInteger(meta.uncompressedBytes)||meta.uncompressedBytes<1||meta.uncompressedBytes>128*1024*1024)throw stale();
    // Bind the exact authorized compressed representation as well as its source.
    // A rewrite inside one generation cannot re-use earlier row handles.
    const sourceRevision=crypto.createHash('sha256').update(JSON.stringify([manifest.sourceRevisionKey,meta.checksum])).digest('hex');
    return {ownerId:String(context.id),actorId:captured.userId,module,sourceGeneration:manifest.activeGeneration,sourceRevision,
      moduleInputKey:manifest.moduleInputKeys[module],sourceProjectionKey:manifest.sourceProjectionKeys[module],
      accessHash:captured.accessHash,contextHash:captured.contextHash,planRevision:FULL_SHADOW_PLAN,requestGeneration};
  }
  function sameToken(left,right){
    return left&&Object.keys(left).length===TOKEN_KEYS.length&&TOKEN_KEYS.every(key=>Object.hasOwn(left,key)&&left[key]===right[key]);
  }
  function validateBody(kind,body){
    if(!body||typeof body!=='object'||Array.isArray(body))throw invalid();
    if(kind==='view'){
      if(Object.keys(body).length!==1||typeof body.requestGeneration!=='string'||!body.requestGeneration||body.requestGeneration.length>512)throw invalid();
      return body.requestGeneration;
    }
    if(Object.keys(body).some(key=>!['token','records','maxBytes'].includes(key))||!body.token
      ||typeof body.token.requestGeneration!=='string'||!body.token.requestGeneration||body.token.requestGeneration.length>512
      ||!Array.isArray(body.records)||!body.records.length||body.records.length>128
      ||!Number.isSafeInteger(body.maxBytes)||body.maxBytes<1||body.maxBytes>4*1024*1024)throw invalid();
    const ordinals=new Set();
    for(const record of body.records){
      if(!record||Object.keys(record).length!==2||!Number.isSafeInteger(record.ordinal)||record.ordinal<0||ordinals.has(record.ordinal)
        ||typeof record.handle!=='string'||record.handle.length!==32)throw invalid();
      ordinals.add(record.ordinal);
    }
    return body.token.requestGeneration;
  }
  for(const [path,kind] of [['/:module/shadow','view'],['/:module/details','details']])router.post(path,async(req,res)=>{
    let full,computed;
    try{
      const module=String(req.params.module||'');
      if(!['cp','orders'].includes(module))return res.status(404).json({code:'PAGE_PROJECTION_UNKNOWN',error:'Bilinmeyen ekran.',errorEn:'Unknown view.'});
      const captured=guard.capture(req,module);assertSourceFilters([module],req);
      const requestGeneration=validateBody(kind,req.body),context=contextFor(captured.profile);
      full=await projectionFor(req,module,{build:kind==='view'});captured.assertResponse();
      if(!full)throw stale();
      full.assertResponse?.();assertProjectionCurrent(context.id,module,full.manifest);
      const token=bind(captured,context,full,module,requestGeneration);
      if(kind==='details'&&!sameToken(req.body.token,token))throw stale();
      const meta=full.manifest.modules[module];
      const params={projectionBuffer:full.value.buffer,projectionBytes:meta.uncompressedBytes,projectionChecksum:meta.checksum,
        token,secret,...(kind==='details'?{records:req.body.records,maxBytes:req.body.maxBytes}:{})};
      computed=await runTask(req,module,kind==='view'?'projection-private-view':'projection-private-details',
        {module,generation:token.sourceGeneration,sourceRevision:token.sourceRevision,requestGeneration,planRevision:FULL_SHADOW_PLAN},params);
      const initialGuard=computed.assertResponse,fullGuard=full.assertResponse,manifest=full.manifest,ownerId=context.id;
      computed.assertResponse=()=>{captured.assertResponse();fullGuard?.();assertProjectionCurrent(ownerId,module,manifest);initialGuard?.();};
      computed.assertResponse();
      // Full public projection routes and application state remain authoritative.
      // This explicit endpoint certifies only full/full private shadow reads.
      const result=send(req,res,computed);computed=null;return result;
    }catch(error){computed?.release();return apiError(res,error,'Ekran detayı okunamadı.');}
    finally{full?.release();}
  });
  return router;
}
module.exports={createProjectionShadowRouter,FULL_SHADOW_PLAN};
