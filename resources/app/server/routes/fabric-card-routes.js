'use strict';

/* Koleksiyon kumaş kartı sözlüğü route'ları (server/lib/fabric-cards.js).
   Okuma Koleksiyon alanı, yazma Koleksiyon düzenleme yetkisi ister —
   PLM çeviri sözlüğüyle aynı kural. */
module.exports = function registerFabricCardRoutes(app, deps) {
  const {
    apiError,
    express,
    fabricCards,
    requestRevision,
    userAccess,
  } = deps;

  const requireEdit = (req, res) => {
    const canEdit = userAccess.effectiveCollectionAccess(req.currentUser).some(item => item.level === 'edit');
    if (!canEdit) res.status(403).json({ error: 'Kumaş kartlarını düzenlemek için Koleksiyon düzenleme yetkisi gerekir.', code: 'COLLECTION_EDIT_DENIED' });
    return canEdit;
  };

app.get('/api/fabric-cards', userAccess.requireArea('koleksiyon'), (_req, res) => {
    try { res.set('Cache-Control', 'no-store').json(fabricCards.publicCards()); }
    catch (err) { apiError(res, err, 'Kumaş kartları okunamadı.'); }
  });

app.post('/api/fabric-cards', userAccess.requireArea('koleksiyon'), express.json({ limit: '2mb' }), (req, res) => {
    try {
      if (!requireEdit(req, res)) return;
      const items = req.body && req.body.items;
      if (!Array.isArray(items)) return res.status(400).json({ error: 'items (dizi) zorunlu.', code: 'VALIDATION_ERROR' });
      const saved = fabricCards.upsertFabricCards(items, req.currentUser, requestRevision(req), { onlyMissing: Boolean(req.body.onlyMissing) });
      userAccess.appendAudit(req.currentUser, 'FABRIC_CARD_UPSERT', 'collection', { count: saved.updated });
      res.set('ETag', `"${saved.revision}"`);
      res.json({ ok: true, ...saved });
    } catch (err) { apiError(res, err, 'Kumaş kartları kaydedilemedi.'); }
  });

app.delete('/api/fabric-cards/:code', userAccess.requireArea('koleksiyon'), (req, res) => {
    try {
      if (!requireEdit(req, res)) return;
      const saved = fabricCards.deleteFabricCard(req.params && req.params.code, req.currentUser, requestRevision(req));
      userAccess.appendAudit(req.currentUser, 'FABRIC_CARD_DELETE', 'collection', { code: String(req.params && req.params.code || ''), deleted: saved.deleted });
      res.set('ETag', `"${saved.revision}"`);
      res.json({ ok: true, ...saved });
    } catch (err) { apiError(res, err, 'Kumaş kartı silinemedi.'); }
  });
};
