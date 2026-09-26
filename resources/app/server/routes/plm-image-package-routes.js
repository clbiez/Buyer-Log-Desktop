'use strict';

/* Hazır PLM görsel paketi ve görsel iş durumu route'ları
   server.js'ten birebir taşındı (davranış değişikliği yok). Kayıt, server.js'te
   blokların eskiden durduğu satırda yapılır; Express route SIRASI korunur.
   Bağımlılıklar kayıt anında enjekte edilir; çalışma sırasında yeniden atanan
   değerler (yok) canlı okuyucu fonksiyonla okunur. */
module.exports = function registerPlmImagePackageRoutes(app, deps) {
  const {
    apiError,
    assertModelImageMutable,
    canonicalPlmImageIngest,
    express,
    finishImageJob,
    fs,
    getCollectionImage,
    loadOverrides,
    modelOperationProgress,
    path,
    plmImageJobCounts,
    plmImageJobStore,
    plmImageOwnership,
    plmImagePackage,
    plmImagePayload,
    plmImageRefreshLog,
    plmImageSyncService,
    plmJobScope,
    plmJobs,
    reportImageProgress,
    requirePlmContextAccess,
    userAccess,
    withModelImageImportLock,
  } = deps;


/* ===================================================================
   HAZIR PLM GÖRSEL PAKETİ (BUYERLOG_IMPORT)

   Dış PLM görsel testi binlerce görseli ZATEN indirdi. Bu iki uç o paketi
   CoreNectum'a hiç gitmeden Buyer Log'un KANONİK deposuna alır.

   ÖNCE ÖNİZLEME, SONRA ONAY: yazma yalnız kullanıcı sayıları gördükten ve
   açıkça onayladıktan sonra yapılır. Önizleme hiçbir şey yazmaz.

   Paket klasörüne KALICI BAĞIMLILIK BIRAKILMAZ: baytlar kanonik depoya
   kopyalanır, kayıt güncellenir; paket sonradan silinebilir.
   =================================================================== */
/* Kullanıcı yolu Gezgin'den yapıştırır. Gezgin'in "Yol olarak kopyala"
   komutu yolu TIRNAK İÇİNDE verir ("C:\...\BUYERLOG_IMPORT"); sondaki ters
   bölü de sık görülür. İkisi de geçerli bir klasör niyetidir ve yalnız
   yazım farkı yüzünden "klasör bulunamadı" demek kullanıcıyı yanıltır.
   Kopyalamada araya girebilen U+202A/U+200E gibi görünmez yön işaretleri de
   temizlenir. */
function plmPackageRootFrom(req) {
  let raw = String((req.body && (req.body.folder || req.body.path)) || '')
    .replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, '')
    .trim();
  if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) raw = raw.slice(1, -1).trim();
  if (!raw) { const error = new Error('Paket klasörü zorunlu.'); error.statusCode = 400; error.code = 'PLM_PACKAGE_ROOT_REQUIRED'; throw error; }
  if (raw.length > 1024) { const error = new Error('Paket klasörü yolu çok uzun.'); error.statusCode = 400; error.code = 'PLM_PACKAGE_ROOT_INVALID'; throw error; }
  return path.resolve(raw);
}
function plmPackageContext(overwriteManual) {
  const overrides = loadOverrides();
  return {
    imagemap: overrides.imagemap || {},
    store: plmImageOwnership.loadOwnership(),
    ownership: plmImageOwnership,
    hasStoredFile: ref => Boolean(String(ref || '').trim() && getCollectionImage(ref)),
    overwriteManual: overwriteManual === true,
  };
}
app.post('/api/model-images/package/preview', userAccess.requireAnyArea('cp', 'orders', 'koleksiyon'), express.json({ limit: '64kb' }), (req, res) => {
  try {
    assertModelImageMutable();
    const root = plmPackageRootFrom(req);
    const preview = plmImagePackage.previewPackage(root, plmPackageContext(req.body && req.body.overwriteManual));
    userAccess.appendAudit(req.currentUser, 'PLM_IMAGE_PACKAGE_PREVIEW', 'package', { root, ...preview.counts });
    res.json({ ok: true, ...preview });
  } catch (err) { apiError(res, err, 'PLM görsel paketi okunamadı.'); }
});
app.post('/api/model-images/package/import', userAccess.requireAnyArea('cp', 'orders', 'koleksiyon'), express.json({ limit: '64kb' }), async (req, res) => {
  const imageJobRef = { id: null };
  let checkpoint = null;
  try {
    assertModelImageMutable();
    // Onay AÇIK olmalı: kazayla yazma olmasın.
    if (req.body && req.body.confirm !== true) return res.status(400).json({ error: 'İçe aktarma için önce önizlemeyi onaylayın.', code: 'PLM_PACKAGE_CONFIRM_REQUIRED' });
    const root = plmPackageRootFrom(req);
    const overwriteManual = Boolean(req.body && req.body.overwriteManual);
    const context = plmPackageContext(overwriteManual);
    const info = plmImagePackage.readPackageManifest(root, {});
    const classified = plmImagePackage.classifyPackageEntries(info, { ...context, withBytes: false });
    const ready = classified.entries.filter(entry => entry.status === plmImagePackage.ENTRY_READY);
    imageJobRef.id = plmJobs.create(req.currentUser.id, {
      kind: 'plm-images', scope: plmJobScope(req), total: ready.length,
      label: 'Model gorseli · ' + ready.length + ' paket girdisi', phase: 'Paket goresellerini aliyor',
    }).id;
    const result = await withModelImageImportLock(req.currentUser.id, async () => {
      checkpoint = plmImageJobStore.createCheckpoint({
        jobId: imageJobRef.id, userId: String(req.currentUser.id), kind: 'plm-images',
        scope: plmJobScope(req), source: 'package', mode: 'all', overwriteManual,
        items: ready.map(entry => ({ plmId: entry.plmId, colourCode: entry.colourCode, colour: entry.colour, styleId: entry.styleId, styleName: entry.styleName })),
      });
      return plmImageSyncService.runPackageImport({
        entries: ready,
        ingest: canonicalPlmImageIngest(plmImageOwnership.OWNER_PACKAGE),
        // Baytlar TEK TEK okunur; 5.000+ görsel aynı anda belleğe alınmaz.
        readImage: file => fs.readFileSync(file),
        imagemap: context.imagemap, store: context.store, overwriteManual,
        checkpoint, commitBatchSize: 200,
        isCancelled: () => plmJobs.isCancelled(req.currentUser.id, imageJobRef.id),
        onProgress: progress => reportImageProgress(req, imageJobRef, progress),
      });
    });
    for (const item of result.failures || []) plmJobs.addFailure(req.currentUser.id, imageJobRef.id, { plmId: item.plmId, model: item.styleName, error: item.error, code: item.code });
    plmJobs.update(req.currentUser.id, imageJobRef.id, { processed: ready.length, total: ready.length, succeeded: Math.max(0, ready.length - (result.failures || []).length) });
    plmImageRefreshLog('PLM_IMAGE_PACKAGE_IMPORT', { root, ...result.counts });
    userAccess.appendAudit(req.currentUser, 'PLM_IMAGE_PACKAGE_IMPORT', 'package', { root, ...result.counts, skipped: classified.counts });
    res.json({
      ok: true, root, status: result.status, mode: 'all',
      overrides: result.overrides, images: plmImagePayload(result.outcomes),
      imagesSaved: result.counts.linksUpdated || result.linksUpdated || 0,
      requested: ready.length, counts: plmImageJobCounts(result.counts),
      preview: classified.counts, failedItems: result.failures || [], imageFailedItems: result.failures || [],
      jobId: imageJobRef.id,
    });
    finishImageJob(req, imageJobRef, null);
  } catch (err) {
    if (checkpoint) try { checkpoint.finish(plmImageJobStore.STATUS_FAILED, { error: err && err.message }); } catch (_) {}
    finishImageJob(req, imageJobRef, err);
    apiError(res, err, 'PLM görsel paketi içe aktarılamadı.');
  }
});
/* Yeniden başlatmadan sonra yarım kalmış işler. Kayıt diskte durduğu için
   birkaç bin modellik bir iş sıfırdan başlamak zorunda kalmaz. */
app.get('/api/plm-image-jobs', requirePlmContextAccess, (req, res) => {
  const records = plmImageJobStore.listRecords(String(req.currentUser.id)).map(record => ({
    jobId: record.jobId, kind: record.kind, scope: record.scope, source: record.source, mode: record.mode,
    status: record.status, phase: record.phase, counts: record.counts,
    total: record.items.length, done: record.done.length, pending: Math.max(0, record.items.length - record.done.length),
    failures: record.failures.length, createdAt: record.createdAt, updatedAt: record.updatedAt, finishedAt: record.finishedAt,
    resumable: plmImageJobStore.ACTIVE_STATUSES.has(record.status) && record.done.length < record.items.length,
  }));
  res.set('Cache-Control', 'no-store').json({ ok: true, jobs: records });
});
/* Devam / yalnız başarısızları yeniden dene: İSTEK LİSTESİNİ döndürür,
   çalıştırmayı istemci mevcut akışıyla başlatır. Böylece ikinci bir
   "yalnız başarısızlar" yolu yazılmaz. */
app.get('/api/plm-image-jobs/:id/pending', requirePlmContextAccess, (req, res) => {
  const record = plmImageJobStore.readRecord(req.params.id);
  if (!record || record.userId !== String(req.currentUser.id)) return res.status(404).json({ error: 'İş bulunamadı.', code: 'PLM_JOB_NOT_FOUND' });
  const only = String(req.query.only || '').trim();
  const done = new Set(record.done);
  const items = only === 'failed'
    ? plmImageJobStore.retryItems(record.jobId)
    : record.items.filter(item => !done.has(plmImageJobStore.itemKey(item)));
  res.json({ ok: true, jobId: record.jobId, scope: record.scope, mode: record.mode, source: record.source, only: only === 'failed' ? 'failed' : 'pending', items });
});
app.delete('/api/plm-image-jobs/:id', requirePlmContextAccess, (req, res) => {
  const record = plmImageJobStore.readRecord(req.params.id);
  if (!record || record.userId !== String(req.currentUser.id)) return res.status(404).json({ error: 'İş bulunamadı.', code: 'PLM_JOB_NOT_FOUND' });
  plmImageJobStore.removeRecord(record.jobId);
  res.json({ ok: true, removed: record.jobId });
});
app.get('/api/model-operation-status', requirePlmContextAccess, (req,res) => {
  res.set('Cache-Control','no-store').json(modelOperationProgress.get(String(req.currentUser.id)) || {running:false});
});

};
