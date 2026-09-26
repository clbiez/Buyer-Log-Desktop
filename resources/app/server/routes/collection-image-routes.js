'use strict';

/* Koleksiyon görselleri ve görsel kayıt ayarları route'ları
   server.js'ten birebir taşındı (davranış değişikliği yok). Kayıt, server.js'te
   blokların eskiden durduğu satırda yapılır; Express route SIRASI korunur.
   Bağımlılıklar kayıt anında enjekte edilir; çalışma sırasında yeniden atanan
   değerler (yok) canlı okuyucu fonksiyonla okunur. */
module.exports = function registerCollectionImageRoutes(app, deps) {
  const {
    apiError,
    assertModelImageMutable,
    collectionImageOptimizationStatus,
    express,
    getModelImageSettings,
    loadOverrides,
    modelImageRegistry,
    saveCollectionImage,
    userAccess,
  } = deps;


// ---- Koleksiyon görselleri ----
app.post('/api/collection-images', userAccess.requireArea('koleksiyon'), express.json({ limit: '70mb' }), (req, res) => {
  try {
    assertModelImageMutable();
    const body = req.body || {};
    const image = saveCollectionImage({ rowId: body.rowId, filename: body.filename, mimeType: body.mimeType, base64: body.base64 });
    res.json({ ok: true, image });
  } catch (err) { apiError(res, err, 'Koleksiyon görseli kaydedilemedi.'); }
});
app.get('/api/model-images/optimization/status', userAccess.requireAnyArea('source','koleksiyon','cp','orders'), (_req, res) => {
  try { res.set('Cache-Control', 'no-store').json({ ok: true, ...collectionImageOptimizationStatus(50) }); }
  catch (err) { apiError(res, err, 'Model görseli optimizasyon durumu okunamadı.'); }
});
app.get('/api/model-images/settings', userAccess.requireAnyArea('source','koleksiyon','cp','orders'), (_req, res) => {
  try { res.set('Cache-Control', 'no-store').json({ ok:true, ...getModelImageSettings() }); }
  catch (err) { apiError(res, err, 'Görsel boyut limiti okunamadı.'); }
});
app.get('/api/model-images/registry/report', userAccess.requireAnyArea('source','koleksiyon','cp','orders','backlog','lfl','overview'), (_req, res) => {
  try {
    const overrides=loadOverrides();
    res.set('Cache-Control','no-store').json({ok:true,...modelImageRegistry.migrationReport(overrides&&overrides.imagemap)});
  } catch (err) { apiError(res, err, 'Model görseli kayıt raporu okunamadı.'); }
});
};
