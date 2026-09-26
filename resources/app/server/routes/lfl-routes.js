'use strict';

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
    sendDateSafeJson,
    sourceFilterReadiness,
    sourceFilterReadinessMessage,
    sourceUserId,
    userAccess,
    withFabricDimensions,
  } = deps;


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
    const imageAwareRows=attachModelImageIdentities(scopedRows,modelImageIdentityOrders(runtime));
    sendDateSafeJson(res, {
      rows: imageAwareRows,
      meta: {...(runtime.lflMeta||{}),rowCount:imageAwareRows.length},
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
    const imageAwareRows=attachModelImageIdentities(scopedRows,modelImageIdentityOrders(runtime));
    const result={rows:imageAwareRows,meta:{...(runtime.lflMeta||{}),rowCount:imageAwareRows.length},source:runtime.sources&&runtime.sources.lfl||null,loadedAt:runtime.lflLoadedAt};
    userAccess.appendAudit(req.currentUser,'LFL_MODEL_REFRESH','Data Model Connection',{source:result.source,rowCount:Number(result.meta&&result.meta.rowCount)||0});
    sendDateSafeJson(res, result);
  }
  catch (err) { apiError(res, err, 'LFL veri modeli yenilenemedi.'); }
  finally{lflRefreshInFlight.delete(id);}
});
// Kullanıcının seçtiği LFL dosyası yalnız o kullanıcının çalışma önbelleğine yüklenir.
app.post('/api/lfl/upload', userAccess.requireArea('lfl'), async (req, res) => {
  try {
    const id=sourceUserId(req), runtime=cacheForUser(id);
    const { name, dataBase64 } = req.body || {};
    if (!dataBase64) return res.status(400).json({ error: 'dataBase64 alanı zorunlu.', code: 'VALIDATION_ERROR' });
    const buf = Buffer.from(dataBase64, 'base64');
    const exact = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    const parsed = await runExcelTask('parseLflBuffer', { data: exact }, { timeoutMs: 300000 });
    runtime.lflRows = Array.isArray(parsed.rows) ? parsed.rows : [];
    runtime.lflMeta = withFabricDimensions(parsed.meta, runtime.lflRows);
    runtime.lflLoadedAt = new Date().toISOString();
    runtime.sources = { ...(runtime.sources || {}), lfl: name || 'Yüklenen dosya' };
    userAccess.appendAudit(req.currentUser,'LFL_UPLOAD',name||'uploaded',{rowCount:Number(parsed.meta&&parsed.meta.rowCount)||0});
    const scopedRows=userAccess.filterRowsByScope(req.currentUser,runtime.lflRows||[]);
    const imageAwareRows=attachModelImageIdentities(scopedRows,modelImageIdentityOrders(runtime));
    sendDateSafeJson(res, { rows: imageAwareRows, meta: {...(runtime.lflMeta||{}),rowCount:imageAwareRows.length}, source: runtime.sources.lfl, loadedAt: runtime.lflLoadedAt });
  } catch (err) { apiError(res, err, 'Yüklenen LFL Excel dosyası işlenemedi.'); }
});

};
