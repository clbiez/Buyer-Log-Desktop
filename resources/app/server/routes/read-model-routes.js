'use strict';
/* POST /api/read-model/:module/query — yerel arka uç okuma modeli (#1073).
 *
 * İstek gövdesi: public/read-model-query.js başındaki şema (version: 1).
 * Yanıt (200):
 *   { ok:true, version:1, module, generation, cached, timing:{loadMs,queryMs,totalMs,rows},
 *     result:{ rows:[{_rowIndex,...fields,_canEdit?,_canEditShared?}], total, offset, limit,
 *              aggregates:{count,sums,groups} } }
 *   Tarihler projeksiyonla aynı 'YYYY-MM-DD' yerel gün metnidir.
 * Hatalar: { ok:false, code, error(TR), errorEn, detail? }
 *   400 READ_MODEL_QUERY_INVALID / READ_MODEL_FILTER_UNSUPPORTED / READ_MODEL_BODY_INVALID
 *   401 SESSION_REQUIRED · 403 AREA_FORBIDDEN · 404 READ_MODEL_MODULE_UNKNOWN
 *   409 COMPUTE_STALE_GENERATION (3 denemeden sonra) / SOURCE_FILTER_REQUIRED
 *   413 READ_MODEL_BODY_TOO_LARGE · 503 COMPUTE_QUEUE_BUSY / COMPUTE_ACCESS_NOT_READY
 */
const express=require('express');
// Modül/alan eşlemesi burada sabittir; sorgu motoru ilk istekte yüklenir (açılış maliyeti yok).
const AREAS=Object.freeze({cp:'cp',orders:'orders',overview:'overview'});
const STALE_ATTEMPTS=3;

function sendError(res,status,code,tr,en,detail){
  return res.status(status).set('Cache-Control','no-store').json({ok:false,code,error:tr,errorEn:en,...(detail?{detail}:{})});
}
module.exports = function registerReadModelRoutes(app, deps) {
  const {
    userAccess,
    computeReadGuard,
    ensureComputedProjection,
    apiError,
  } = deps;
  let service=deps.readModelService||null;
  const getService=()=>service||(service=require('../lib/read-model/read-model-service').createReadModelService({
    guard:computeReadGuard,
    loadProjection:(req,module)=>ensureComputedProjection(req,module),
    runCompute:(task,payload,options)=>(deps.runReadModelCompute||require('../lib/read-model/read-model-pool').getReadModelPool().run)(task,payload,options),
    calendar:()=>require('../lib/merch-calendar-store').publicProjection(),
  }));
  const json=express.json({limit:'2mb'});
  app.post('/api/read-model/:module/query',async(req,res)=>{
    const module=String(req.params.module||''),area=AREAS[module];
    if(!Object.hasOwn(AREAS,module))return sendError(res,404,'READ_MODEL_MODULE_UNKNOWN','Bilinmeyen okuma modeli modülü.','Unknown read model module.');
    try{
      // compute-access-middleware ile aynı: yetki dizini hazır, oturum profili canlı.
      if(typeof userAccess.prepareComputeAccessContext==='function')await userAccess.prepareComputeAccessContext();
      const live=userAccess.sessionProfile(req);
      if(!live||(req.currentUser&&String(live.id)!==String(req.currentUser.id))||live.enabled===false||live.status!=='ACTIVE')
        return sendError(res,401,'SESSION_REQUIRED','Oturumunuz artık geçerli değil.','Your session is no longer valid.');
      req.currentUser=live;
      if(!userAccess.hasArea(live,area))return sendError(res,403,'AREA_FORBIDDEN','Bu alana erişim yetkiniz yok.','You do not have access to this area.');
    }catch(err){return apiError(res,err,'Okuma modeli yetkisi doğrulanamadı.');}
    json(req,res,async parseError=>{
      if(parseError){
        const tooLarge=parseError.type==='entity.too.large';
        return sendError(res,tooLarge?413:400,tooLarge?'READ_MODEL_BODY_TOO_LARGE':'READ_MODEL_BODY_INVALID',
          tooLarge?'Sorgu gövdesi çok büyük.':'Sorgu gövdesi geçerli JSON değil.',tooLarge?'Query body is too large.':'Query body is not valid JSON.');
      }
      const controller=new AbortController(),onClose=()=>{if(!res.writableEnded)controller.abort();};
      res.on('close',onClose);
      try{
        for(let attempt=1;;attempt++){
          try{
            const out=await getService().query(req,module,req.body,{signal:controller.signal});
            res.status(200).set('Cache-Control','no-store').set('X-Read-Model-Generation',out.generation).type('application/json');
            return res.send(`{"ok":true,"version":1,"module":${JSON.stringify(out.module)},"generation":${JSON.stringify(out.generation)},"cached":${out.cached?'true':'false'},"timing":${JSON.stringify(out.timing||{})},"result":${out.body}}`);
          }catch(err){
            if(err?.code!=='COMPUTE_STALE_GENERATION'||attempt>=STALE_ATTEMPTS||res.headersSent||controller.signal.aborted)throw err;
          }
        }
      }catch(err){
        const status=Number(err?.statusCode)||500;
        if(status>=400&&status<500)return sendError(res,status,err.code||'REQUEST_ERROR',err.error||String(err.message||'').split(' / ')[0]||'Okuma modeli sorgusu tamamlanamadı.',err.errorEn||'Read model query could not be completed.',err.detail);
        return apiError(res,err,'Okuma modeli sorgusu tamamlanamadı.');
      }finally{res.off('close',onClose);}
    });
  });
  return getService;
};
module.exports.AREAS=AREAS;
