'use strict';
/* POST /api/read-model/backlog/v3 — Backlog Genel Bakış (V3) okuma modeli (#1079 WS6c).
 *
 * İstek: { version:1, query:{…backlogExportQueryParams}, view:{…}, priority:{…}, drill? }
 *   `query`, /api/backlog-export?format=json ile aynı parametrelerdir; seçenekler aynı
 *   kurulur (global-flow-routes backlogExportOptions = server.js GET rotası).
 * Hesap iki adımdır:
 *   1. Hesap işçisi 'backlog-v3-items': export ile aynı satırlar → V3 kayıtları
 *      (compute okuma servisi önbelleği; aynı sorgu + gün için tek uçuş).
 *   2. Okuma modeli işçisi 'read-model-backlog-v3': kayıtlar işçide önbelleğe alınır;
 *      panel modeli ya da drill-down yalnız sonuç olarak döner.
 * Yanıt (200, gzip JSON): { kind:'model', model, priority:{ready,needKeys}, keys? } ya da
 *   { kind:'drill', summary, count, rows, identities }.
 * Yetki: Backlog alanı (requireArea) + assertSourceFilters; satır kapsamı export
 *   hesabının kendisinden gelir (kapsam dışı satır kayıtlara girmez).
 * Hatalar: 400 READ_MODEL_QUERY_INVALID · 409 COMPUTE_STALE_GENERATION (3 denemeden sonra) /
 *   SOURCE_FILTER_REQUIRED · 503 COMPUTE_QUEUE_BUSY — apiError biçiminde.
 * Salt okunur: kayıt yolu yok.
 */
const crypto=require('node:crypto');
const {backlogExportOptions}=require('./global-flow-routes');
const STALE_ATTEMPTS=3;
const QUERY_KEYS=Object.freeze(['retailFrom','retailTo','inStoreFrom','inStoreTo','exFactoryFrom','exFactoryTo','buyerGrup','groupBy','dimFilters','analysisFilters','antrepoFrom','antrepoTo','antrepoDateLevels','sourceColumns']);
const MAX_VALUE_LENGTH=256*1024;
const DRILL_KINDS=new Set(['all','stages','overdue','special','tags','quality','risk','group','bucket']);

function invalid(detail){return Object.assign(new Error('Geçersiz Backlog V3 isteği. / Invalid Backlog V3 request.'),{code:'READ_MODEL_QUERY_INVALID',statusCode:400,detail});}
const isDay=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value);
function normalizeRequest(body){
  const value=body&&typeof body==='object'?body:{};
  if(value.version!==1)throw invalid('version');
  const raw=value.query&&typeof value.query==='object'&&!Array.isArray(value.query)?value.query:{},query={};
  for(const [key,item] of Object.entries(raw)){
    // İstemci tarafı parametreleri (format, lazyDimensions, previewLimit …) yok sayılır.
    if(!QUERY_KEYS.includes(key)||item==null)continue;
    if(typeof item!=='string'&&typeof item!=='number'&&typeof item!=='boolean')throw invalid('query.'+key);
    const text=String(item);if(text.length>MAX_VALUE_LENGTH)throw invalid('query.'+key);
    query[key]=text;
  }
  const view=value.view&&typeof value.view==='object'&&!Array.isArray(value.view)?value.view:{};
  if(view.today!=null&&!isDay(view.today))throw invalid('view.today');
  const priority=value.priority&&typeof value.priority==='object'&&!Array.isArray(value.priority)?value.priority:{};
  let drill=null;
  if(value.drill!=null){
    if(typeof value.drill!=='object'||Array.isArray(value.drill)||!DRILL_KINDS.has(value.drill.k))throw invalid('drill');
    drill=value.drill;
  }
  return {query,view,priority,drill,today:isDay(view.today)?view.today:null};
}

function registerBacklogV3Routes(app,deps){
  const {userAccess,assertSourceFilters,prepareComputeBacklog,backlogReadConsumer,apiError,sendComputedResponse}=deps;
  const computeReads=()=>deps.getComputeReads();
  const json=require('express').json({limit:'2mb'});
  const runCompute=deps.runReadModelCompute||((task,payload,options)=>require('./read-model-pool').getReadModelPool().run(task,payload,options));
  // Kayıt yükü (compute önbelleğindeki Buffer) → işçi veri kümesi anahtarı. Önbellek
  // Buffer'ı bıraktığında anahtar da düşer; aynı yük için işçiye bir kez gönderilir.
  const datasetKeys=new WeakMap(),sent=new Set();
  const counters={requests:0,computed:0,resent:0};
  function datasetKeyFor(buffer){
    let key=datasetKeys.get(buffer);
    if(!key){key='bv3-'+crypto.randomUUID();datasetKeys.set(buffer,key);}
    return key;
  }
  async function modelFor(lease,request,signal){
    const source=lease.value&&lease.value.buffer;
    if(!source)throw Object.assign(new Error('Backlog V3 kayıtları boş. / Backlog V3 items are empty.'),{code:'COMPUTE_WORKER_FAILED',statusCode:500});
    const datasetKey=datasetKeyFor(source);
    const options={signal,ownerKey:'read-model',generation:'1'};
    const send=async withBuffer=>{
      if(!withBuffer)return runCompute('read-model-backlog-v3',{datasetKey,request},{...options,estimatedBytes:32*1024*1024});
      // Buffer compute okuma önbelleğiyle paylaşılır: aktarım için kopyalanır.
      const bytes=Uint8Array.from(Buffer.isBuffer(source)?source:Buffer.from(source));
      const uncompressed=Number(lease.value.uncompressedBytes)||bytes.byteLength*8;
      return runCompute('read-model-backlog-v3',{datasetKey,request,buffer:bytes.buffer},{...options,inputBytes:bytes.byteLength,estimatedBytes:64*1024*1024+uncompressed*3,transferList:[bytes.buffer]});
    };
    let result=await send(!sent.has(datasetKey));
    if(result.value&&result.value.missing){
      // İşçi emekli edilmiş ya da veri kümesi LRU'dan düşmüş: yük yeniden gönderilir.
      result.release?.();counters.resent++;result=await send(true);
    }
    sent.add(datasetKey);if(sent.size>64)sent.delete(sent.values().next().value);
    if(!result.value||!result.value.buffer){result.release?.();throw Object.assign(new Error('Hesaplama işçisi tamamlanamadı. / Compute worker failed.'),{code:'COMPUTE_WORKER_FAILED',statusCode:500});}
    counters.computed++;
    return result;
  }
  app.post('/api/read-model/backlog/v3',userAccess.requireArea('backlog'),(req,res,next)=>json(req,res,error=>{
    if(!error)return next();
    const tooLarge=error.type==='entity.too.large';
    return res.status(tooLarge?413:400).set('Cache-Control','no-store').json({ok:false,code:tooLarge?'READ_MODEL_BODY_TOO_LARGE':'READ_MODEL_BODY_INVALID',
      error:tooLarge?'İstek gövdesi çok büyük.':'İstek gövdesi geçerli JSON değil.',errorEn:tooLarge?'Request body is too large.':'Request body is not valid JSON.'});
  }),async(req,res)=>{
    const consumer=backlogReadConsumer(req,res);
    try{
      counters.requests++;
      const request=normalizeRequest(req.body),q=request.query;
      assertSourceFilters(['backlog'],req);await prepareComputeBacklog(req);
      if(consumer.signal.aborted)return;
      const params={options:backlogExportOptions(q),sourceColumns:String(q.sourceColumns||'').split(',').map(value=>value.trim()).filter(Boolean),previewLimit:0,includeSourceDetails:false,mapProjection:false,today:request.today};
      const workerRequest={view:request.view,priority:request.priority,drill:request.drill};
      for(let attempt=1;;attempt++){
        let lease=null,handed=false;
        try{
          const started=Date.now();
          lease=await computeReads().run(req,'backlog','backlog-v3-items',params,{cache:true,signal:consumer.signal});
          const itemsMs=Date.now()-started;
          const result=await modelFor(lease,workerRequest,consumer.signal);
          if(consumer.signal.aborted){result.release?.();return;}
          lease.assertResponse?.();
          const value=result.value;
          handed=true;
          return sendComputedResponse(req,res,{value,assertResponse:()=>lease.assertResponse?.(),release:()=>{result.release?.();lease.release();}},
            {headers:{'X-Read-Model-Timing':JSON.stringify({itemsMs,...(value.timing||{})})}});
        }catch(err){
          if(err?.code!=='COMPUTE_STALE_GENERATION'||attempt>=STALE_ATTEMPTS||res.headersSent||consumer.signal.aborted)throw err;
        }finally{if(!handed)lease?.release();}
      }
    }catch(err){if(!consumer.signal.aborted)apiError(res,err,'Backlog genel bakış modeli hazırlanamadı.');}
    finally{consumer.dispose();}
  });
  return {stats:()=>({...counters})};
}
module.exports=registerBacklogV3Routes;
module.exports.normalizeRequest=normalizeRequest;
module.exports.QUERY_KEYS=QUERY_KEYS;
