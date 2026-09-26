'use strict';

/* Koleksiyon geri dönüşüm kutusu route'ları
   server.js'ten birebir taşındı (davranış değişikliği yok). Kayıt, server.js'te
   blokların eskiden durduğu satırda yapılır; Express route SIRASI korunur.
   Bağımlılıklar kayıt anında enjekte edilir; çalışma sırasında yeniden atanan
   değerler (yok) canlı okuyucu fonksiyonla okunur. */
module.exports = function registerCollectionRecycleBinRoutes(app, deps) {
  const {
    apiError,
    collectionRecycleBin,
    collectionWorkspaceEditAllowed,
    express,
    userAccess,
  } = deps;


/* ---- Koleksiyon geri dönüşüm kutusu (v5.97) ----
   Silinen modeller 30 gün saklanır. Yetki kontrolü çalışma alanının aynısıdır:
   okumak için erişim, geri yüklemek/temizlemek için DÜZENLEME yetkisi gerekir —
   geri yükleme çalışma alanını değiştirir. */
function collectionBinAccess(req, res, needEdit) {
  const ownerId = String(req.params.ownerId || '');
  const level = userAccess.collectionAccessLevel(req.currentUser, ownerId);
  if (!level) { res.status(403).json({ error: 'Bu Koleksiyon sayfasına erişim yetkiniz bulunmuyor.', code: 'COLLECTION_ACCESS_DENIED' }); return null; }
  if (needEdit && !collectionWorkspaceEditAllowed(req.currentUser, ownerId)) { res.status(403).json({ error: 'Bu Koleksiyon sayfasını düzenleme yetkiniz bulunmuyor.', code: 'COLLECTION_EDIT_DENIED' }); return null; }
  return ownerId;
}
app.get('/api/collection-recycle-bin/:ownerId', userAccess.requireArea('koleksiyon'), (req, res) => {
  const ownerId = collectionBinAccess(req, res, false); if (ownerId == null) return;
  res.set('Cache-Control', 'no-store').json(collectionRecycleBin.loadBin(ownerId));
});
app.post('/api/collection-recycle-bin/:ownerId', userAccess.requireArea('koleksiyon'), express.json({ limit: '100mb' }), (req, res) => {
  try {
    const ownerId = collectionBinAccess(req, res, true); if (ownerId == null) return;
    const entries = Array.isArray(req.body && req.body.entries) ? req.body.entries : [];
    const bin = collectionRecycleBin.addEntries(ownerId, entries, {
      deletedBy: req.currentUser.id,
      deletedByName: req.currentUser.displayName || req.currentUser.username || '',
      reason: String((req.body && req.body.reason) || 'manual'),
    });
    userAccess.appendAudit(req.currentUser, 'COLLECTION_ROWS_DELETED', ownerId, { count: entries.length });
    res.json({ ok: true, bin });
  } catch (err) { apiError(res, err, 'Silinen modeller saklanamadı.'); }
});
// Geri yükleme: kayıtlar kutudan ÇIKARILIP istemciye döndürülür. Satırları
// çalışma alanına yazmak istemcinin işidir; çakışma kararını orada veriyor.
app.post('/api/collection-recycle-bin/:ownerId/restore', userAccess.requireArea('koleksiyon'), express.json({ limit: '1mb' }), (req, res) => {
  try {
    const ownerId = collectionBinAccess(req, res, true); if (ownerId == null) return;
    const result = collectionRecycleBin.takeEntries(ownerId, req.body && req.body.entryIds);
    userAccess.appendAudit(req.currentUser, 'COLLECTION_ROWS_RESTORED', ownerId, { count: result.taken.length });
    res.json({ ok: true, restored: result.taken, bin: result.bin });
  } catch (err) { apiError(res, err, 'Modeller geri yüklenemedi.'); }
});
app.post('/api/collection-recycle-bin/:ownerId/purge', userAccess.requireArea('koleksiyon'), express.json({ limit: '1mb' }), (req, res) => {
  try {
    const ownerId = collectionBinAccess(req, res, true); if (ownerId == null) return;
    const bin = collectionRecycleBin.removeEntries(ownerId, req.body && req.body.entryIds);
    userAccess.appendAudit(req.currentUser, 'COLLECTION_BIN_PURGED', ownerId, { count: (req.body && req.body.entryIds || []).length });
    res.json({ ok: true, bin });
  } catch (err) { apiError(res, err, 'Kayıtlar temizlenemedi.'); }
});

};
