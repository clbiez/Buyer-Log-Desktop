'use strict';
const collectionLflEngine=require('../../public/collection-lfl-engine');
const plmBomStore=require('../lib/plm-bom-store');
const plmModelDetails=require('../lib/plm-model-details');

/* LFL verisi route'ları
   server.js'ten birebir taşındı (davranış değişikliği yok). Kayıt, server.js'te
   blokların eskiden durduğu satırda yapılır; Express route SIRASI korunur.
   Bağımlılıklar kayıt anında enjekte edilir; çalışma sırasında yeniden atanan
   değerler (yok) canlı okuyucu fonksiyonla okunur. */
module.exports = function registerLflRoutes(app, deps) {
  const {
    apiError,
    attachModelImageIdentities,
    cacheForUser,
    ensureDataLoaded,
    initialDataLoadPromises,
    loadFromModels,
    modelImageIdentityOrders,
    runExcelTask,
    saveRuntimeModelSnapshot,
    sendDateSafeJson,
    sourceFilterReadiness,
    sourceFilterReadinessMessage,
    sourceUserId,
    userAccess,
    withFabricDimensions,
    collectionLflCache,
    computedCollectionReferenceSource,
    adoptSavedRuntime,
  } = deps;

/* PLM Kumaş / PLM Artwork ve PLM tabanlı kumaş özellikleri yanıt anında
   kalıcı PLM BOM deposundan eklenir (plm-model-details.js); runtime ve
   snapshot değiştirilmez. Depo okunamazsa satırlar ASAS değerleriyle döner. */
function withPlmDetails(rows,meta){
  let enriched=rows;
  try{enriched=plmModelDetails.attachToRows(rows,plmBomStore.load());}catch(err){console.warn('[LFL] PLM model detayları eklenemedi:',err&&err.message);}
  return {rows:enriched,meta:meta===undefined?undefined:withFabricDimensions({...(meta||{}),rowCount:enriched.length},enriched)};
}
/* /api/lfl yanıtı her istekte bütün satırları kopyalamasın: görsel kimliği
   + PLM detaylı satırlar runtime LFL dizisi, ASAS sipariş kaynağı ve PLM BOM
   deposu kimliğiyle bir kez hazırlanır. Kapsam filtresi aynı satır
   nesnelerini döndürdüğü için istek yalnız eşleme yapar. Kaynaklardan biri
   değişince (yenileme, yükleme, PLM SYNC) kimlik değişir ve yeniden kurulur. */
const lflResponseCache=new WeakMap();
function lflResponse(runtime,scopedRows){
  const rows=Array.isArray(runtime&&runtime.lflRows)?runtime.lflRows:[];
  let store=null;
  try{store=plmBomStore.load();}catch(err){console.warn('[LFL] PLM BOM deposu okunamadı:',err&&err.message);}
  const hit=lflResponseCache.get(rows);
  let entry=hit&&hit.store===store&&hit.asasOrders===runtime.asasOrders&&hit.asasOrdersByTarget===runtime.asasOrdersByTarget&&hit.lflMeta===runtime.lflMeta?hit:null;
  if(!entry){
    const imageAware=attachModelImageIdentities(rows,modelImageIdentityOrders(runtime));
    let enriched=imageAware;
    let plmDetails={};
    if(store){try{enriched=plmModelDetails.attachToRows(imageAware,store,{compact:true});plmDetails=plmModelDetails.detailsForRows(enriched,store);}catch(err){console.warn('[LFL] PLM model detayları eklenemedi:',err&&err.message);}}
    const byRow=new Map();rows.forEach((row,index)=>byRow.set(row,enriched[index]));
    // PLM Kumaş / Artwork metinleri model başına bir kez taşınır; istemci PLM ID ile eşler (lfl.js).
    const base=withFabricDimensions(runtime.lflMeta||{},enriched);
    entry={store,asasOrders:runtime.asasOrders,asasOrdersByTarget:runtime.asasOrdersByTarget,lflMeta:runtime.lflMeta,byRow,
      meta:{...base,dimensions:{...(base.dimensions||{}),plmFabrics:[...new Set(Object.values(plmDetails).map(item=>item.plmFabric).filter(Boolean))].sort(),plmArtworks:[...new Set(Object.values(plmDetails).map(item=>item.plmArtwork).filter(Boolean))].sort()},plmDetails}};
    lflResponseCache.set(rows,entry);
  }
  const scoped=Array.isArray(scopedRows)?scopedRows:[];
  // Kapsam dışı yeni nesne gelirse (beklenmez) yine görsel kimliği + PLM detayıyla çözülür.
  const missing=scoped.filter(row=>!entry.byRow.has(row));
  const extra=missing.length?withPlmDetails(attachModelImageIdentities(missing,modelImageIdentityOrders(runtime))).rows:[]; // tam (inline) biçim
  const extraMap=new Map(missing.map((row,index)=>[row,extra[index]]));
  const out=scoped.map(row=>entry.byRow.get(row)||extraMap.get(row)||row);
  return {rows:out,meta:{...entry.meta,rowCount:out.length}};
}
async function collectionReferenceSource(req,res,fallback=null,summaryOnly=false,assertResponse=()=>{}){
    res.set('Cache-Control','no-store');
    // A saved legacy summary is shown as-is while its source cannot upgrade it.
    const unavailable=code=>{assertResponse();if(fallback)sendDateSafeJson(res,fallback);else res.status(409).json({code});return null;};
    const id=sourceUserId(req),readiness=sourceFilterReadiness(['lfl'],req);
    if(!readiness.ready)return unavailable('SOURCE_FILTER_REQUIRED');
    if(summaryOnly&&computedCollectionReferenceSource){
      const source=await computedCollectionReferenceSource(req);
      if(!source.version)return unavailable('LFL_SOURCE_UNAVAILABLE');
      return source;
    }
    let runtime=cacheForUser(id);
    if(!runtime.lflLoadedAt){await ensureDataLoaded(id);runtime=cacheForUser(id);}
    if(!runtime.lflLoadedAt)return unavailable('LFL_SOURCE_UNAVAILABLE');
    return {id,runtime,rows:runtime.lflRows||[],version:runtime.lflLoadedAt};
}
function collectionReferenceIdentity(req){
    const profile=userAccess.publicProfile(req.currentUser);
    // Login and unrelated IAM writes change the global revision. Scope identity
    // follows the effective row permissions instead, including delegated scope.
    return JSON.stringify([sourceUserId(req),profile.id,'scope-v1',profile.dataScope,profile.scopes,profile.delegatedUserIds]);
}
function collectionReferenceSnapshot(req,source,rebuild=false){
    return collectionLflCache.get({identity:collectionReferenceIdentity(req),version:source.version,rebuild,
      buildReferences:source.buildReferences,assertCurrent:source.assertCurrent,loadRows:()=>userAccess.filterRowsByScope(req.currentUser,source.rows)});
}
function collectionReferenceResponseGuard(req){
    const identity=collectionReferenceIdentity(req);
    return ()=>{
      const profile=userAccess.sessionProfile?userAccess.sessionProfile(req):req.currentUser;
      if(!profile||profile.enabled===false||(userAccess.sessionProfile&&profile.status!=='ACTIVE'))throw Object.assign(Error('Oturumunuz artık geçerli değil. / Your session is no longer valid.'),{code:'SESSION_REQUIRED',statusCode:401});
      if(userAccess.hasArea&&['koleksiyon','lfl'].some(area=>!userAccess.hasArea(profile,area)))throw Object.assign(Error('Bu alana erişim yetkiniz yok. / You do not have access to this area.'),{code:'AREA_FORBIDDEN',statusCode:403});
      if(collectionReferenceIdentity({...req,currentUser:profile})!==identity)throw Object.assign(Error('Veri veya yetki sürümü değişti. / The data or permission generation changed.'),{code:'COMPUTE_STALE_GENERATION',statusCode:409});
      req.currentUser=profile;
    };
}
// Collection reads shared summaries; source order rows are requested only for a clicked detail report.
app.get('/api/collection-lfl-reference', userAccess.requireArea('koleksiyon'), userAccess.requireArea('lfl'), async (req,res)=>{
  try{
    res.set('Cache-Control','no-store');
    const assertResponse=collectionReferenceResponseGuard(req);assertResponse();
    let saved=null;
    if(req.query.rebuild!=='1'){
      saved=await collectionLflCache.read({identity:collectionReferenceIdentity(req)});
      assertResponse();
      if(saved&&saved.schema!==4)return sendDateSafeJson(res,saved);
    }
    const source=await collectionReferenceSource(req,res,saved,true,assertResponse);assertResponse();if(!source)return;
    const snapshot=await collectionReferenceSnapshot(req,source,req.query.rebuild==='1');
    assertResponse();source.assertResponse?.();
    sendDateSafeJson(res,snapshot);
  }catch(err){apiError(res,err,'LFL reference could not be calculated.');}
});
app.post('/api/collection-lfl-detail',userAccess.requireArea('koleksiyon'),userAccess.requireArea('lfl'),async(req,res)=>{
  try{
    res.set('Cache-Control','no-store');
    const {key,version,excludedCountries=[]}=req.body||{};
    if(typeof key!=='string'||!key||key.length>2048||typeof version!=='string'||!version||version.length>256)return res.status(400).json({code:'VALIDATION_ERROR'});
    // Buyer country rule (production countries left out of the reference); codes only, never trusted as dimensions.
    if(!Array.isArray(excludedCountries)||excludedCountries.length>60||excludedCountries.some(code=>typeof code!=='string'||code.length>40))return res.status(400).json({code:'VALIDATION_ERROR'});
    const excluded=collectionLflEngine.countryList(excludedCountries);
    const source=await collectionReferenceSource(req,res);if(!source)return;
    if(version!==String(source.version))return res.status(409).json({code:'LFL_REFERENCE_STALE'});
    const snapshot=await collectionReferenceSnapshot(req,source);
    if(version!==snapshot.version)return res.status(409).json({code:'LFL_REFERENCE_STALE'});
    // Never trust client dimensions: the key must exist in the current user's scoped summary.
    const stored=snapshot.references.find(item=>item.key===key);
    const reference=collectionLflEngine.excludeCountries(stored,excluded);
    if(!reference)return res.status(404).json({code:'LFL_REFERENCE_NOT_FOUND'});
    const rows=collectionLflEngine.referenceDetails(userAccess.filterRowsByScope(req.currentUser,source.rows),stored,excluded);
    const imageAwareRows=withPlmDetails(attachModelImageIdentities(rows,modelImageIdentityOrders(source.runtime))).rows;
    sendDateSafeJson(res,{version:String(source.version),calculatedAt:snapshot.calculatedAt,reference,rows:imageAwareRows});
  }catch(err){apiError(res,err,'LFL order detail could not be loaded.');}
});

// Program açılışındaki ilk okuma tamamlanmışsa seçili kullanıcının LFL verisini döndürür.
// GET çağrısı Excel/Power Query yenilemesi başlatmaz; yalnız diskteki kayıtlı dosyayı okur.
app.get('/api/lfl', userAccess.requireArea('lfl'), async (req, res) => {
  try{
    const id=sourceUserId(req);
    const filterStatus=sourceFilterReadiness(['lfl'],req);
    if(!filterStatus.ready){
      return sendDateSafeJson(res,{rows:[],meta:{rowCount:0,warnings:[sourceFilterReadinessMessage(filterStatus,'tr')]},source:null,loadedAt:null,sourceFilterRequired:true,sourceFilterStatus:filterStatus,sourceFilterMessage:sourceFilterReadinessMessage(filterStatus,'tr')});
    }
    await ensureDataLoaded(id);
    const runtime=cacheForUser(id);
    const scopedRows=userAccess.filterRowsByScope(req.currentUser,runtime.lflRows||[]);
    const enriched=lflResponse(runtime,scopedRows);
    sendDateSafeJson(res, {
      rows: enriched.rows,
      meta: enriched.meta,
      source: runtime.sources && runtime.sources.lfl || null,
      loadedAt: runtime.lflLoadedAt,
    });
  }catch(err){apiError(res,err,'LFL Excel dosyası okunamadı.');}
});
const lflRefreshInFlight=new Set();
app.post('/api/lfl/refresh', userAccess.requireArea('lfl'), async (req, res) => {
  const id=sourceUserId(req);
  if(lflRefreshInFlight.has(id))return res.status(409).json({error:'Bu kullanıcı için bir LFL yenileme işlemi zaten devam ediyor.',code:'OPERATION_IN_PROGRESS'});
  lflRefreshInFlight.add(id);
  try {
    const pending=initialDataLoadPromises.get(id); if(pending) await pending;
    const runtime=await loadFromModels(id, ['lfl']);
    const scopedRows=userAccess.filterRowsByScope(req.currentUser,runtime.lflRows||[]);
    const enriched=lflResponse(runtime,scopedRows);
    const result={rows:enriched.rows,meta:enriched.meta,source:runtime.sources&&runtime.sources.lfl||null,loadedAt:runtime.lflLoadedAt};
    userAccess.appendAudit(req.currentUser,'LFL_MODEL_REFRESH','Data Model Connection',{source:result.source,rowCount:Number(result.meta&&result.meta.rowCount)||0});
    sendDateSafeJson(res, result);
  }
  catch (err) { apiError(res, err, 'LFL veri modeli yenilenemedi.'); }
  finally{lflRefreshInFlight.delete(id);}
});
// Kullanıcının seçtiği LFL dosyası yalnız o kullanıcının kalıcı snapshot'ına yazılır.
app.post('/api/lfl/upload', userAccess.requireArea('lfl'), async (req, res) => {
  try {
    const id=sourceUserId(req);
    const pending=initialDataLoadPromises.get(id);if(pending)await pending;
    await ensureDataLoaded(id);
    const { name, dataBase64 } = req.body || {};
    if (!dataBase64) return res.status(400).json({ error: 'dataBase64 alanı zorunlu.', code: 'VALIDATION_ERROR' });
    const buf = Buffer.from(dataBase64, 'base64');
    const exact = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    const parsed = await runExcelTask('parseLflBuffer', { data: exact }, { timeoutMs: 300000, serializationKey: `source:${id}` });
    const runtime=cacheForUser(id);
    const next={...runtime,loadedAt:runtime.loadedAt||new Date().toISOString(),
      lflRows:Array.isArray(parsed.rows)?parsed.rows:[],lflLoadedAt:new Date().toISOString(),
      sources:{...(runtime.sources||{}),lfl:name||'Yüklenen dosya'}};
    next.lflMeta=withFabricDimensions(parsed.meta,next.lflRows);
    await saveRuntimeModelSnapshot(id,next);
    await adoptSavedRuntime(id,runtime,next);
    userAccess.appendAudit(req.currentUser,'LFL_UPLOAD',name||'uploaded',{rowCount:Number(parsed.meta&&parsed.meta.rowCount)||0});
    const scopedRows=userAccess.filterRowsByScope(req.currentUser,runtime.lflRows||[]);
    const enriched=lflResponse(runtime,scopedRows);
    sendDateSafeJson(res, { rows: enriched.rows, meta: enriched.meta, source: runtime.sources.lfl, loadedAt: runtime.lflLoadedAt });
  } catch (err) { apiError(res, err, 'Yüklenen LFL Excel dosyası işlenemedi.'); }
});

};
