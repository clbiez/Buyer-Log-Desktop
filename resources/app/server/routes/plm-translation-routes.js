'use strict';

/* PLM → ASAS çeviri sözlüğü route'ları
   server.js'ten birebir taşındı (davranış değişikliği yok). Kayıt, server.js'te
   blokların eskiden durduğu satırda yapılır; Express route SIRASI korunur.
   Bağımlılıklar kayıt anında enjekte edilir; çalışma sırasında yeniden atanan
   değerler (yok) canlı okuyucu fonksiyonla okunur. */
module.exports = function registerPlmTranslationRoutes(app, deps) {
  const {
    apiError,
    express,
    loadPlmTranslations,
    publicPlmTranslations,
    requestRevision,
    upsertPlmTranslations,
    userAccess,
  } = deps;


app.get('/api/plm-translations', userAccess.requireArea('koleksiyon'), (_req, res) => {
  res.set('Cache-Control', 'no-store').json(publicPlmTranslations(loadPlmTranslations()));
});
app.post('/api/plm-translations', userAccess.requireArea('koleksiyon'), express.json({ limit: '512kb' }), (req, res) => {
  try {
    const canEditCollection = userAccess.effectiveCollectionAccess(req.currentUser).some(item => item.level === 'edit');
    if (!canEditCollection) return res.status(403).json({ error: 'PLM çeviri sözlüğünü güncellemek için Koleksiyon düzenleme yetkisi gerekir.', code: 'COLLECTION_EDIT_DENIED' });
    const items = req.body && req.body.items;
    if (!Array.isArray(items)) return res.status(400).json({ error: 'items (dizi) zorunlu.', code: 'VALIDATION_ERROR' });
    const saved = upsertPlmTranslations(items, req.currentUser, requestRevision(req));
    userAccess.appendAudit(req.currentUser, 'PLM_TRANSLATION_APPROVE', 'collection', { count: saved.updated, fields: [...new Set(items.map(item => item && item.field).filter(Boolean))] });
    res.set('ETag', `"${saved.revision}"`);
    res.json({ ok: true, ...saved });
  } catch (err) { apiError(res, err, 'PLM çeviri sözlüğü kaydedilemedi.'); }
});

};
