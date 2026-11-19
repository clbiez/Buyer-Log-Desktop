'use strict';
/* POST /api/read-model/overview/model — Genel Bakış okuma modeli (#1074).
 *
 * İstek gövdesi: { version:1, lang:'tr'|'en', filters:{ main:{dim:[...]}, bg:{dim:[...]} } }
 *   dim: merch | ageGroup | orderStatus | season | buyerGrup | buyer | country
 * Yanıt (200): { ok:true, version:1, generation, cached, timing, model:<overview-model.js sözleşmesi> }
 *   Tarihler projeksiyonla aynı 'YYYY-MM-DD' yerel gün metnidir (not satırları).
 * Hatalar: { ok:false, code, error(TR), errorEn, detail? }
 *   400 READ_MODEL_QUERY_INVALID / READ_MODEL_BODY_INVALID · 401 SESSION_REQUIRED
 *   403 AREA_FORBIDDEN · 409 COMPUTE_STALE_GENERATION (3 denemeden sonra) /
 *   SOURCE_FILTER_REQUIRED · 413 READ_MODEL_BODY_TOO_LARGE · 503 COMPUTE_QUEUE_BUSY
 * Global 100 MB JSON ayrıştırıcısından ÖNCE kaydolur; kendi 64 KB sınırını uygular.
 */
const express=require('express');
const STALE_ATTEMPTS=3;

function sendError(res,status,code,tr,en,detail){
  return res.status(status).set('Cache-Control','no-store').json({ok:false,code,error:tr,errorEn:en,...(detail?{detail}:{})});
}
module.exports=function registerOverviewModelRoutes(app,deps){
  const {userAccess,ensureComputedProjection,apiError,getComputeReadGuard}=deps;
  let service=deps.overviewModelService||null;
  const getService=()=>service||(service=(()=>{
    const {createOverviewModelService,createContextLoader}=require('./overview-model-service');
    const loadContext=deps.loadContext||createContextLoader(deps.contextSources);
    return createOverviewModelService({
      guard:{capture:(req,area)=>getComputeReadGuard().capture(req,area)},
      loadProjection:(req,module)=>ensureComputedProjection(req,module),
      runCompute:(task,payload,options)=>(deps.runReadModelCompute||require('./read-model-pool').getReadModelPool().run)(task,payload,options),
      loadContext,
      canAccessCp:req=>userAccess.hasArea(req.currentUser,'cp'),
    });
  })());
  const json=express.json({limit:'64kb'});
  app.post('/api/read-model/overview/model',async(req,res)=>{
    try{
      if(typeof userAccess.prepareComputeAccessContext==='function')await userAccess.prepareComputeAccessContext();
      const live=userAccess.sessionProfile(req);
      if(!live||(req.currentUser&&String(live.id)!==String(req.currentUser.id))||live.enabled===false||live.status!=='ACTIVE')
        return sendError(res,401,'SESSION_REQUIRED','Oturumunuz artık geçerli değil.','Your session is no longer valid.');
      req.currentUser=live;
      if(!userAccess.hasArea(live,'overview'))return sendError(res,403,'AREA_FORBIDDEN','Bu alana erişim yetkiniz yok.','You do not have access to this area.');
    }catch(err){return apiError(res,err,'Genel Bakış modeli yetkisi doğrulanamadı.');}
    json(req,res,async parseError=>{
      if(parseError){
        const tooLarge=parseError.type==='entity.too.large';
        return sendError(res,tooLarge?413:400,tooLarge?'READ_MODEL_BODY_TOO_LARGE':'READ_MODEL_BODY_INVALID',
          tooLarge?'İstek gövdesi çok büyük.':'İstek gövdesi geçerli JSON değil.',tooLarge?'Request body is too large.':'Request body is not valid JSON.');
      }
      const controller=new AbortController(),onClose=()=>{if(!res.writableEnded)controller.abort();};
      res.on('close',onClose);
      try{
        for(let attempt=1;;attempt++){
          try{
            const out=await getService().model(req,req.body,{signal:controller.signal});
            res.status(200).set('Cache-Control','no-store').set('X-Read-Model-Generation',out.generation).type('application/json');
            return res.send(`{"ok":true,"version":1,"generation":${JSON.stringify(out.generation)},"cached":${out.cached?'true':'false'},"timing":${JSON.stringify(out.timing||{})},"model":${out.body}}`);
          }catch(err){
            if(err?.code!=='COMPUTE_STALE_GENERATION'||attempt>=STALE_ATTEMPTS||res.headersSent||controller.signal.aborted)throw err;
          }
        }
      }catch(err){
        const status=Number(err?.statusCode)||500;
        if(status>=400&&status<500)return sendError(res,status,err.code||'REQUEST_ERROR',err.error||String(err.message||'').split(' / ')[0]||'Genel Bakış modeli hazırlanamadı.',err.errorEn||'Overview model could not be prepared.',err.detail);
        return apiError(res,err,'Genel Bakış modeli hazırlanamadı.');
      }finally{res.off('close',onClose);}
    });
  });
  return getService;
};
