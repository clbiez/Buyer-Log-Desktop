'use strict';
/* POST /api/read-model/cp/computed — CP hesaplanmış sütunlar (#1078, WS5 alt PR 1).
 *
 * İstek gövdesi: { version:1, lang:'tr'|'en', since?:<önceki yanıtın token'ı>,
 *   answers?:{<cevap anahtarı>:cevap|null} (senkronu bekleyen kendi cevapları; cp-computed-service.js) }
 * Yanıt (200): { ok:true, version:1, generation, cached, timing,
 *   columns:{ version:1, lang, token, delta, total, fields:[...]|null, rows:[[id, priority,
 *     calculationStatus, trackingTags, priorityTags, actionReasons, signals, basePriority,
 *     checklist:null|{cells,status,parts,elements,single,tasks}]], removed:[id] } }
 *   delta:false → kullanıcının bütün CP satırları; delta:true → yalnız `since` sonrası değişenler.
 * Hatalar: { ok:false, code, error(TR), errorEn, detail? }
 *   400 READ_MODEL_QUERY_INVALID / READ_MODEL_BODY_INVALID · 401 SESSION_REQUIRED
 *   403 AREA_FORBIDDEN · 409 COMPUTE_STALE_GENERATION (3 denemeden sonra) /
 *   SOURCE_FILTER_REQUIRED · 413 READ_MODEL_BODY_TOO_LARGE · 503 COMPUTE_QUEUE_BUSY
 * POST /api/read-model/cp/query · /api/read-model/cp/facets (alt PR 2) — pencereli okuma:
 *   gövde { version:1, lang?, answers?, query|facets:<cp-query.js> } · yanıt { ok, version, generation, timing, result }.
 * Global 100 MB JSON ayrıştırıcısından ÖNCE kaydolur; kendi 1 MB sınırını uygular.
 */
const express=require('express');
const STALE_ATTEMPTS=3;

function sendError(res,status,code,tr,en,detail){
  return res.status(status).set('Cache-Control','no-store').json({ok:false,code,error:tr,errorEn:en,...(detail?{detail}:{})});
}
module.exports=function registerCpComputedRoutes(app,deps){
  const {userAccess,ensureComputedProjection,apiError,getComputeReadGuard}=deps;
  let service=deps.cpComputedService||null;
  const getService=()=>service||(service=(()=>{
    const {createContextLoader}=require('./overview-model-service');
    const {createCpComputedService,createTaskLoader}=require('./cp-computed-service');
    return createCpComputedService({
      guard:{capture:(req,area)=>getComputeReadGuard().capture(req,area)},
      loadProjection:(req,module)=>ensureComputedProjection(req,module),
      runCompute:(task,payload,options)=>(deps.runReadModelCompute||require('./read-model-pool').getReadModelPool().run)(task,payload,options),
      loadContext:deps.loadContext||createContextLoader(deps.contextSources),
      loadTasks:deps.testTasks?createTaskLoader(deps.testTasks):async()=>[],
      // Bekleyen satır yaması zinciri (cp-row-patch-log.js); yoksa her okuma projeksiyon kirasıyla.
      rowPatchLog:deps.rowPatchLog||null,
      onRowPatchMismatch:typeof deps.onRowPatchMismatch==='function'?deps.onRowPatchMismatch:()=>{},
    });
  })());
  const json=express.json({limit:'1mb'});
  const send=(res,out,kind)=>{
    res.status(200).set('Cache-Control','no-store').set('X-Read-Model-Generation',out.generation).type('application/json');
    if(kind==='computed')return res.send(`{"ok":true,"version":1,"generation":${JSON.stringify(out.generation)},"cached":${out.cached?'true':'false'},"timing":${JSON.stringify(out.timing||{})},"columns":${out.body}}`);
    return res.send(JSON.stringify({ok:true,version:1,generation:out.generation,timing:out.timing||{},result:out.result}));
  };
  const handle=kind=>async(req,res)=>{
    try{
      if(typeof userAccess.prepareComputeAccessContext==='function')await userAccess.prepareComputeAccessContext();
      const live=userAccess.sessionProfile(req);
      if(!live||(req.currentUser&&String(live.id)!==String(req.currentUser.id))||live.enabled===false||live.status!=='ACTIVE')
        return sendError(res,401,'SESSION_REQUIRED','Oturumunuz artık geçerli değil.','Your session is no longer valid.');
      req.currentUser=live;
      if(!userAccess.hasArea(live,'cp'))return sendError(res,403,'AREA_FORBIDDEN','Bu alana erişim yetkiniz yok.','You do not have access to this area.');
    }catch(err){return apiError(res,err,'CP hesaplanmış sütun yetkisi doğrulanamadı.');}
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
            const out=await getService()[kind](req,req.body,{signal:controller.signal});
            return send(res,out,kind);
          }catch(err){
            if(err?.code!=='COMPUTE_STALE_GENERATION'||attempt>=STALE_ATTEMPTS||res.headersSent||controller.signal.aborted)throw err;
          }
        }
      }catch(err){
        const status=Number(err?.statusCode)||500;
        if(status>=400&&status<500)return sendError(res,status,err.code||'REQUEST_ERROR',err.error||String(err.message||'').split(' / ')[0]||'CP hesaplanmış sütunları hazırlanamadı.',err.errorEn||'CP computed columns could not be prepared.',err.detail);
        return apiError(res,err,'CP hesaplanmış sütunları hazırlanamadı.');
      }finally{res.off('close',onClose);}
    });
  };
  app.post('/api/read-model/cp/computed',handle('computed'));
  // Alt PR 2: pencereli okuma (gövde ve sonuç: cp-query.js; hatalar yukarıdakiyle aynı).
  app.post('/api/read-model/cp/query',handle('query'));
  app.post('/api/read-model/cp/facets',handle('facets'));
  return getService;
};
