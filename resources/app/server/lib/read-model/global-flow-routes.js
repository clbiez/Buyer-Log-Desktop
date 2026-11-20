'use strict';
/* POST /api/read-model/global-flow/model — Küresel Akış Haritası okuma modeli (#1075).
 *
 * İstek: { version:1, source:'backlog', query:{…backlogExportQueryParams} }
 *   `query`, /api/backlog-export?projection=global-flow ile aynı parametrelerdir;
 *   seçenekler GET rotasıyla birebir aynı kurulur (backlogExportOptions; eşitlik
 *   tests/read-model-global-flow-route.test.js bekçisiyle server.js'e karşı
 *   sabitlenir), aynı compute okuma servisi ve önbelleğiyle kullanıcının Backlog
 *   harita projeksiyonu alınır. Global 100 MB JSON ayrıştırıcısından önce kaydolur:
 *   yetki gövdeden önce, rota kendi küçük gövde sınırını uygular.
 * Yanıt (200, gzip JSON): public/overview-global-flow.js encodeReadModelRecords
 *   { version, source, sourceRevision, fields, priorityFields, count, rows:[[…]] }
 *   + ETag ve X-Read-Model-Timing başlıkları. If-None-Match aynı ETag'i taşırsa 304.
 * Yetki: Backlog alanı (requireArea) + assertSourceFilters; satır kapsamı
 *   projeksiyonun kendisinden gelir (kapsam dışı satır projeksiyona girmez).
 * Hatalar: 400 READ_MODEL_QUERY_INVALID · 409 COMPUTE_STALE_GENERATION (3 denemeden sonra) /
 *   SOURCE_FILTER_REQUIRED · 503 COMPUTE_QUEUE_BUSY — apiError biçiminde.
 * Hesap okuma modeli işçisinde yapılır; aynı projeksiyon baytları ve aynı gün için
 * sonuç yeniden kullanılır (önbellek projeksiyon Buffer'ına zayıf bağlıdır, compute
 * okuma önbelleği bıraktığında kendiliğinden düşer).
 */
const STALE_ATTEMPTS=3;
const QUERY_KEYS=Object.freeze(['format','retailFrom','retailTo','inStoreFrom','inStoreTo','exFactoryFrom','exFactoryTo','buyerGrup','groupBy','dimFilters','analysisFilters','antrepoFrom','antrepoTo','antrepoDateLevels','sourceColumns','projection','previewLimit']);
const MAX_VALUE_LENGTH=256*1024;

function invalid(detail){return Object.assign(new Error('Geçersiz harita modeli isteği. / Invalid map model request.'),{code:'READ_MODEL_QUERY_INVALID',statusCode:400,detail});}
// Yalnız backlog-export'un okuduğu metin parametreleri kabul edilir.
function normalizeRequest(body){
  const value=body&&typeof body==='object'?body:{};
  if(value.version!==1)throw invalid('version');
  if((value.source||'backlog')!=='backlog')throw invalid('source');
  const raw=value.query&&typeof value.query==='object'&&!Array.isArray(value.query)?value.query:{},query={};
  for(const [key,item] of Object.entries(raw)){
    // Backlog'un yalnız istemci tarafı parametreleri (ör. lazyDimensions) yok sayılır.
    if(!QUERY_KEYS.includes(key)||item==null)continue;
    if(typeof item!=='string'&&typeof item!=='number'&&typeof item!=='boolean')throw invalid('query.'+key);
    const text=String(item);if(text.length>MAX_VALUE_LENGTH)throw invalid('query.'+key);
    query[key]=text;
  }
  return query;
}
// server.js GET /api/backlog-export içindeki satır içi seçenek nesnesinin aynısı.
function backlogExportOptions(q){
  let dimFilters={};try{dimFilters=JSON.parse(q.dimFilters||'{}');}catch{}
  return {retailFrom:q.retailFrom,retailTo:q.retailTo,inStoreFrom:q.inStoreFrom,inStoreTo:q.inStoreTo,exFactoryFrom:q.exFactoryFrom,exFactoryTo:q.exFactoryTo,buyerGrup:q.buyerGrup,groupBy:String(q.groupBy||'').split(',').filter(Boolean),dimFilters,analysisFilters:q.analysisFilters,antrepoFrom:q.antrepoFrom,antrepoTo:q.antrepoTo,antrepoDateLevels:q.antrepoDateLevels?String(q.antrepoDateLevels).split(',').filter(Boolean):undefined};
}
const dayKey=(now=new Date())=>`${now.getFullYear()}-${now.getMonth()+1}-${now.getDate()}`;

function registerGlobalFlowRoutes(app,deps){
  const {userAccess,assertSourceFilters,prepareComputeBacklog,backlogReadConsumer,apiError,sendComputedResponse}=deps;
  // Kayıt, compute okuma servisi kurulmadan önce yapılır; servis ilk istekte alınır.
  const computeReads=()=>deps.getComputeReads();
  const json=require('express').json({limit:'512kb'});
  const runCompute=deps.runReadModelCompute||((task,payload,options)=>require('./read-model-pool').getReadModelPool().run(task,payload,options));
  const results=new WeakMap();
  const counters={requests:0,computed:0,reused:0};
  async function recordsFor(lease,signal){
    const source=lease.value&&lease.value.buffer;
    if(!source)throw Object.assign(new Error('Backlog projeksiyonu boş. / Backlog projection is empty.'),{code:'COMPUTE_WORKER_FAILED',statusCode:500});
    const day=dayKey(),cached=results.get(source);
    if(cached&&cached.day===day){counters.reused++;return cached.value;}
    // Projeksiyon Buffer'ı compute okuma önbelleğiyle paylaşılır: aktarım için kopyalanır.
    const bytes=Uint8Array.from(Buffer.isBuffer(source)?source:Buffer.from(source));
    const uncompressed=Number(lease.value.uncompressedBytes)||bytes.byteLength*8;
    const result=await runCompute('global-flow-records',{buffer:bytes.buffer},{signal,ownerKey:'read-model',generation:'1',inputBytes:bytes.byteLength,estimatedBytes:64*1024*1024+uncompressed*4,transferList:[bytes.buffer]});
    try{
      const value=result.value;
      if(!value||!value.buffer)throw Object.assign(new Error('Hesaplama işçisi tamamlanamadı. / Compute worker failed.'),{code:'COMPUTE_WORKER_FAILED',statusCode:500});
      // ETag: aynı projeksiyon baytları + aynı gün için sabit; istemci öncelik
      // değişiminde koşullu ister, veri aynıysa gövdesiz 304 alır.
      const out={buffer:Buffer.from(value.buffer.buffer?value.buffer.buffer:value.buffer,value.buffer.byteOffset||0,value.buffer.byteLength),uncompressedBytes:value.uncompressedBytes,count:value.count,timing:value.timing,etag:`"gf-${require('node:crypto').randomUUID()}"`};
      results.set(source,{day,value:out});counters.computed++;return out;
    }finally{result.release?.();}
  }
  app.post('/api/read-model/global-flow/model',userAccess.requireArea('backlog'),(req,res,next)=>json(req,res,error=>{
    if(!error)return next();
    const tooLarge=error.type==='entity.too.large';
    return res.status(tooLarge?413:400).set('Cache-Control','no-store').json({ok:false,code:tooLarge?'READ_MODEL_BODY_TOO_LARGE':'READ_MODEL_BODY_INVALID',
      error:tooLarge?'İstek gövdesi çok büyük.':'İstek gövdesi geçerli JSON değil.',errorEn:tooLarge?'Request body is too large.':'Request body is not valid JSON.'});
  }),async(req,res)=>{
    const consumer=backlogReadConsumer(req,res);
    try{
      counters.requests++;
      const q=normalizeRequest(req.body);
      assertSourceFilters(['backlog'],req);await prepareComputeBacklog(req);
      if(consumer.signal.aborted)return;
      const params={options:backlogExportOptions(q),sourceColumns:String(q.sourceColumns||'').split(',').map(value=>value.trim()).filter(Boolean),previewLimit:Math.min(500,Math.max(0,Number(q.previewLimit)||0)),includeSourceDetails:false,mapProjection:true};
      for(let attempt=1;;attempt++){
        // Projeksiyon edinimi de denemenin içindedir: compute okuma servisi
        // hazırlık sırasında nesil değişirse COMPUTE_STALE_GENERATION fırlatır.
        let lease=null,handed=false;
        try{
          lease=await computeReads().run(req,'backlog','backlog-export',params,{cache:true,signal:consumer.signal});
          const out=await recordsFor(lease,consumer.signal);
          if(consumer.signal.aborted)return;
          lease.assertResponse?.();
          if(String(req.headers?.['if-none-match']||'')===out.etag)
            return res.status(304).set('Cache-Control','no-store').set('ETag',out.etag).end();
          handed=true;
          return sendComputedResponse(req,res,{value:out,assertResponse:()=>lease.assertResponse?.(),release:()=>lease.release()},
            {headers:{'ETag':out.etag,'X-Read-Model-Timing':JSON.stringify({count:out.count,...(out.timing||{})})}});
        }catch(err){
          if(err?.code!=='COMPUTE_STALE_GENERATION'||attempt>=STALE_ATTEMPTS||res.headersSent||consumer.signal.aborted)throw err;
        }finally{if(!handed)lease?.release();}
      }
    }catch(err){if(!consumer.signal.aborted)apiError(res,err,'Harita okuma modeli hazırlanamadı.');}
    finally{consumer.dispose();}
  });
  return {stats:()=>({...counters})};
}
module.exports=registerGlobalFlowRoutes;
module.exports.normalizeRequest=normalizeRequest;
module.exports.QUERY_KEYS=QUERY_KEYS;
module.exports.backlogExportOptions=backlogExportOptions;
