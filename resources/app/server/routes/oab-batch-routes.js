'use strict';

/* Native OAB shared-service HTTP facade. Registration order and unrelated
   collection/state/settings routes remain unchanged. */
module.exports = function registerOabBatchRoutes(app, deps) {
  const {
    afterSharedCollectionSave,
    automationError,
    canonicalCollectionOwner,
    collectionReplicaStatus,
    collectionSaveWorker,
    collectionWorkspaceEditAllowed,
    express,
    oabRequestTransport,
    liveEvents,
    logRuntimeFailure,
    oabSessionStore,
    oabStore,
    publishCollectionReplica,
    publishCollectionWorkspaceImages,
    refreshCollectionPermissionScope,
    requestClientId,
    sharedRevisionStore,
    userAccess,
  } = deps;


const oabBatchService = deps.oabBatchService || require('../lib/oab-batch-service').createOabBatchService(deps);
function batchError(res,error,fallback) {
  const messages={
    OAB_BATCH_IN_PROGRESS:'Bu kullanıcı için bir OAB toplu çekme işlemi zaten sürüyor.',
    OAB_PARAMS_REQUIRED:'Season, MAG ve Buyer Group seçimi zorunlu.',
    OAB_NO_VALID_COMBINATION:'Seçilen filtreler OAB metadata ile eşleşen hiçbir kombinasyon üretmiyor.',
    OAB_BATCH_TOO_LARGE:`Seçim ${error.details?.combinationCount} kombinasyon üretiyor; üst sınır ${error.details?.maxCombinations}. Seçimi daraltın.`,
    OAB_ACCESS_REVOKED:'OAB erişim yetkisi değişti.',
  };
  if (!messages[error.code]) return automationError(res,error,fallback);
  return res.status(error.statusCode||400).json({error:messages[error.code],code:error.code,...(error.details?{details:error.details}:{}),...(error.skipped?{skipped:error.skipped}:{}),...(error.job?{job:error.job}:{})});
}
app.post('/api/oab/plan', userAccess.requireAnyArea('overview'), userAccess.requireCapability('OAB.VIEW'), express.json({ limit: '64kb' }), (req, res) => {
  try {res.set('Cache-Control','no-store').json(oabBatchService.plan(req.body||{}));}
  catch(error) {batchError(res,error,'OAB çoklu seçim planı hesaplanamadı.');}
});
app.post('/api/oab/batch', userAccess.requireAnyArea('overview'), userAccess.requireCapability('OAB.VIEW'), express.json({ limit: '64kb' }), (req, res) => {
  try {
    const result=oabBatchService.start(req.currentUser,req.body||{},{transport: oabRequestTransport(req)});
    res.status(202).json({ started:true,job:result.job });
  } catch(error) {batchError(res,error,'OAB toplu çekme başlatılamadı.');}
});
app.get('/api/oab/batch-status', userAccess.requireAnyArea('overview'), userAccess.requireCapability('OAB.VIEW'), (req, res) => {
  try {res.set('Cache-Control','no-store').json(oabBatchService.status(req.currentUser,req.query?.jobId));}
  catch(error) {batchError(res,error,'OAB toplu çekme durumu okunamadı.');}
});
app.post('/api/oab/batch/cancel', userAccess.requireAnyArea('overview'), userAccess.requireCapability('OAB.VIEW'), (req, res) => {
  try {res.json(oabBatchService.cancel(req.currentUser));}
  catch(error) {batchError(res,error,'OAB toplu çekme iptal edilemedi.');}
});
app.post('/api/oab/batch/continuation-plan', userAccess.requireAnyArea('overview'), userAccess.requireCapability('OAB.VIEW'), express.json({limit:'4kb'}), (req,res)=>{
  try {res.set('Cache-Control','no-store').json(oabBatchService.continuationPlan(req.currentUser,req.body?.jobId,{transport:oabRequestTransport(req)}));}
  catch(error){batchError(res,error,'OAB_CONTINUATION_UNAVAILABLE');}
});
app.post('/api/oab/batch/completed-state', userAccess.requireAnyArea('overview'), userAccess.requireCapability('OAB.VIEW'), express.json({limit:'4kb'}), (req,res)=>{
  try {res.set('Cache-Control','no-store').json(oabBatchService.completedSnapshot(req.currentUser,req.body?.jobId));}
  catch(error){batchError(res,error,'OAB_JOB_RESULT_UNAVAILABLE');}
});
app.post('/api/oab/batch/continue', userAccess.requireAnyArea('overview'), userAccess.requireCapability('OAB.VIEW'), express.json({limit:'4kb'}), (req,res)=>{
  try {res.status(202).json(oabBatchService.continueJob(req.currentUser,{jobId:req.body?.jobId,sourceFingerprint:req.body?.sourceFingerprint},{transport:oabRequestTransport(req),confirmed:req.body?.confirmed===true}));}
  catch(error){batchError(res,error,'OAB_CONTINUATION_UNAVAILABLE');}
});
app.post('/api/oab/batch/reset-capability', userAccess.requireAnyArea('overview'), userAccess.requireCapability('OAB.VIEW'), (req, res) => {
  try {res.json(oabBatchService.resetCapability(req.currentUser));}
  catch(error) {batchError(res,error,'OAB toplu istek yeteneği sıfırlanamadı.');}
});

/* v7.22 — SATIR BAZLI KAYDETME.

   Bu uç, tam sayfa yerine yalnız DEĞİŞEN SATIRLARI alır ve satır bazlı
   revizyonla uygular. v7.20 incelemesinde ölçülen veri kaybı buradan
   kapanıyor: A 1. satırı, B 900. satırı düzenlediğinde ikisi de kaydedilir.

   Çakışan satır ne ezilir ne de sessizce atılır: sunucudaki güncel hâliyle
   yanıtta döner, istemci kullanıcıya hangi satırın kaydedilemediğini
   gösterir. Kısmi başarı normaldir ve HTTP 200'dür — bazı satırlar
   uygulanmışken bütün isteği hata saymak, uygulanan satırları görünmez
   kılardı. */
app.patch('/api/collection-workspaces/:ownerId', userAccess.requireArea('koleksiyon'), express.raw({ type: () => true, limit: '100mb' }), async (req, res) => {
  try {
    await refreshCollectionPermissionScope();
    const ownerId = canonicalCollectionOwner(String(req.params.ownerId || ''));
    if (!collectionWorkspaceEditAllowed(req.currentUser, ownerId)) return res.status(403).json({ error: 'Bu Koleksiyon sayfasını düzenleme yetkiniz bulunmuyor.', code: 'COLLECTION_EDIT_DENIED' });
    const body = Buffer.isBuffer(req.body) ? req.body : Buffer.from(String(req.body == null ? '' : req.body), 'utf8');
    if (!body.length) return res.status(400).json({ error: 'Koleksiyon değişiklik gövdesi boş.', code: 'COLLECTION_BODY_EMPTY' });
    const result = await collectionSaveWorker.runCollectionSave({
      ownerId, body, mode: 'rows',
      env: {
        BUYER_LOG_SERVER_DATA_ROOT: process.env.BUYER_LOG_SERVER_DATA_ROOT,
        BUYER_LOG_DATA_ROOT: process.env.BUYER_LOG_DATA_ROOT,
        BUYER_LOG_LOCAL_DATA_ROOT: process.env.BUYER_LOG_LOCAL_DATA_ROOT,
        BUYER_LOG_CONFIG_PATH: process.env.BUYER_LOG_CONFIG_PATH,
        BUYER_LOG_TEMP_ROOT: process.env.BUYER_LOG_TEMP_ROOT,
        BL_DATA_DIR: process.env.BL_DATA_DIR,
      },
    });
    if (result.changed) {
      // Yerel kayıt bitti: aynı bilgisayardaki diğer sekmeler/kullanıcılar paylaşım
      // yayınını (ağ klasörü) beklemeden hemen görür.
      liveEvents.notifyChange('collection', requestClientId(req), { ownerId, rowPatches: result.rowPatches, revision: result.revision });
      result.replication = !(await afterSharedCollectionSave(ownerId))
        ? await publishCollectionReplica(ownerId)
        : { ok:true, published:false, reason:'shared-save' };
      // Tam kayıt (PUT) ile aynı: yeni/değişen görsel yetkili kullanıcılara hemen yayımlanır.
      void publishCollectionWorkspaceImages(ownerId).catch(error => logRuntimeFailure('collectionImagePublishOnRowSave', error));
      void sharedRevisionStore.update('collection',{actorId:req.currentUser.id,ownerId}).catch(error=>logRuntimeFailure('sharedRevision',error));
      userAccess.appendAudit(req.currentUser, 'COLLECTION_ROW_SAVE', ownerId, { applied: result.applied.length, conflicts: result.conflicts.length, revision: result.revision });
    }
    res.json({
      ok: true,
      revision: result.revision,
      updatedAt: result.updatedAt,
      rowCount: result.rowCount,
      applied: result.applied,
      conflicts: result.conflicts,
      replication: result.replication || await collectionReplicaStatus(ownerId),
    });
  } catch (err) {
    res.status(err.statusCode || 500).json({
      error: err.message, code: err.code || 'COLLECTION_SAVE_FAILED', currentRevision: err.currentRevision,
      ...(Array.isArray(err.conflicts) ? { conflicts: err.conflicts } : {}),
    });
  }
});

// Son başarılı OAB snapshot'ı ve ona ait seçimler kullanıcı bazında kalıcıdır.
// Uygulama açılışında PASS'e bağlanmadan son görünüm bu uçtan geri yüklenir.
app.get('/api/oab/state', userAccess.requireAnyArea('overview'), userAccess.requireCapability('OAB.VIEW'), (req, res) => {
  try {
    const state = oabSessionStore.load(req.currentUser.id);
    res.set('Cache-Control','no-store').json({ ok:true, state });
  } catch (err) { automationError(res, err, 'OAB son snapshot durumu okunamadı.'); }
});
app.get('/api/oab/settings', userAccess.requireAnyArea('overview'), userAccess.requireCapability('OAB.VIEW'), (req, res) => {
  try { res.set('Cache-Control','no-store').json({ ok:true, settings: oabStore.loadCacheSettings() }); }
  catch (err) { automationError(res, err, 'OAB ayarları okunamadı.'); }
});
app.put('/api/oab/settings', userAccess.requireAnyArea('overview'), userAccess.requireCapability('OAB.MANAGE'), express.json({ limit: '4kb' }), (req, res) => {
  try {
    const settings = oabStore.saveCacheSettings(req.body || {});
    userAccess.appendAudit(req.currentUser, 'OAB_SETTINGS_SAVE', 'oab', settings);
    res.json({ ok:true, settings });
  } catch (err) { automationError(res, err, 'OAB ayarları kaydedilemedi.'); }
});

};
