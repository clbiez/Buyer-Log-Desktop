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
  const assertRead=req=>{
    const current=userAccess.sessionProfile?userAccess.sessionProfile(req):userAccess.profileById?userAccess.profileById(req.currentUser.id):req.currentUser;
    if(!current||current.id!==req.currentUser.id||current.enabled===false||userAccess.hasArea&&!userAccess.hasArea(current,'koleksiyon'))throw Object.assign(new Error('Koleksiyon erişim yetkisi değişti. / Collection access permission changed.'),{code:'COLLECTION_EDIT_DENIED',statusCode:403});
    return current;
  };
  const assertEdit=req=>{
    const current=assertRead(req);
    if(!userAccess.effectiveCollectionAccess(current).some(item=>item.level==='edit'))throw Object.assign(new Error('Koleksiyon düzenleme yetkisi değişti. / Collection edit permission changed.'),{code:'COLLECTION_EDIT_DENIED',statusCode:403});
  };

  const requireEdit = (req, res) => {
    const canEdit = userAccess.effectiveCollectionAccess(req.currentUser).some(item => item.level === 'edit');
    if (!canEdit) res.status(403).json({ error: 'Kumaş kartlarını düzenlemek için Koleksiyon düzenleme yetkisi gerekir.', code: 'COLLECTION_EDIT_DENIED' });
    return canEdit;
  };

app.get('/api/fabric-cards', userAccess.requireArea('koleksiyon'), async (req, res) => {
    try { const saved=await fabricCards.loadFabricCardsAsync();assertRead(req);res.set('Cache-Control', 'no-store').json(fabricCards.publicCards(saved)); }
    catch (err) { apiError(res, err, 'Kumaş kartları okunamadı.'); }
  });

app.post('/api/fabric-cards', userAccess.requireArea('koleksiyon'), express.json({ limit: '2mb' }), async (req, res) => {
    try {
      if (!requireEdit(req, res)) return;
      const items = req.body && req.body.items;
      if (!Array.isArray(items)) return res.status(400).json({ error: 'items (dizi) zorunlu.', code: 'VALIDATION_ERROR' });
      const saved = await fabricCards.upsertFabricCards(items, req.currentUser, requestRevision(req), { onlyMissing: Boolean(req.body.onlyMissing),assertAuthority:()=>assertEdit(req) });
      userAccess.appendAudit(req.currentUser, 'FABRIC_CARD_UPSERT', 'collection', { count: saved.updated });
      res.set('ETag', `"${saved.revision}"`);
      res.json({ ok: true, ...saved });
    } catch (err) { apiError(res, err, 'Kumaş kartları kaydedilemedi.'); }
  });

app.delete('/api/fabric-cards/:code', userAccess.requireArea('koleksiyon'), async (req, res) => {
    try {
      if (!requireEdit(req, res)) return;
      const saved = await fabricCards.deleteFabricCard(req.params && req.params.code, req.currentUser, requestRevision(req),{assertAuthority:()=>assertEdit(req)});
      userAccess.appendAudit(req.currentUser, 'FABRIC_CARD_DELETE', 'collection', { code: String(req.params && req.params.code || ''), deleted: saved.deleted });
      res.set('ETag', `"${saved.revision}"`);
      res.json({ ok: true, ...saved });
    } catch (err) { apiError(res, err, 'Kumaş kartı silinemedi.'); }
  });
};
