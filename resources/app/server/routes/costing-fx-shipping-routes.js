'use strict';

/* Ön Maliyet, Aylık Döviz Kurları ve Nakliye Kıyaslaması route'ları
   server.js'ten birebir taşındı (davranış değişikliği yok). Kayıt, server.js'te
   blokların eskiden durduğu satırda yapılır; Express route SIRASI korunur.
   Bağımlılıklar kayıt anında enjekte edilir; çalışma sırasında yeniden atanan
   değerler (yok) canlı okuyucu fonksiyonla okunur. */
module.exports = function registerCostingFxShippingRoutes(app, deps) {
  const {
    addShippingRows,
    apiError,
    createOpenCosting,
    currentUserIsModerator,
    deleteOpenCosting,
    deleteShippingRows,
    fxMonthResolved,
    loadFx,
    loadOpenCostings,
    loadShipping,
    patchShippingRow,
    publishSharedMasterChange,
    recordOrderCode,
    rejectUnauthorizedOrders,
    requestRevision,
    saveFx,
    sourceUserId,
    updateOpenCosting,
    userAccess,
    withOrderAccess,
  } = deps;


// ---- Open Costing ----
app.get('/api/open-costing', userAccess.requireArea('opencosting'), (_req, res) => res.json(loadOpenCostings()));
app.post('/api/open-costing', userAccess.requireArea('opencosting'), (req, res) => { try { res.json(createOpenCosting(req.body || {}, requestRevision(req))); } catch (err) { apiError(res, err, 'Ön maliyet kaydedilemedi.'); } });
app.put('/api/open-costing/:id', userAccess.requireArea('opencosting'), (req, res) => { try { res.json(updateOpenCosting(req.params.id, req.body || {}, requestRevision(req))); } catch (err) { apiError(res, err, 'Ön maliyet güncellenemedi.'); } });
app.delete('/api/open-costing/:id', userAccess.requireArea('opencosting'), (req, res) => { try { res.json(deleteOpenCosting(req.params.id, requestRevision(req))); } catch (err) { apiError(res, err, 'Ön maliyet silinemedi.'); } });

// ---- Aylık Döviz Kurları (FX) ----
app.get('/api/fx',userAccess.requireAnyArea('source','opencosting','koleksiyon'),(_req,res)=>{res.set('Cache-Control','no-store, no-cache, must-revalidate');res.json(loadFx());});
app.put('/api/fx', userAccess.requireAnyArea('source','opencosting','koleksiyon'), (req, res) => { try { const saved=saveFx(req.body || {}, requestRevision(req)); publishSharedMasterChange('fx', req); userAccess.appendAudit(req.currentUser,'FX_UPDATE','rates',{revision:saved._revision}); res.json(saved); } catch (err) { apiError(res, err, 'Döviz kurları kaydedilemedi.'); } });
app.get('/api/fx/resolve/:month', userAccess.requireAnyArea('source','opencosting','koleksiyon'), (req, res) => { const store = loadFx(); const r = fxMonthResolved(store, req.params.month); res.json({ base: store.base, month: r.month, requestedMonth: req.params.month, exact: r.exact, rates: r.rates, _revision: store._revision }); });

// ---- Nakliye Tipine Göre Maliyet Kıyaslaması ----
app.get('/api/shipping-comparison', userAccess.requireArea('shipping'), (req, res) => {
  // v7.23 — kullanıcıya özgü: her kullanıcı YALNIZ kendi nakliye kıyaslamasını görür.
  const store = loadShipping(sourceUserId(req));
  res.json({ ...store, rows: store.rows.map(row => withOrderAccess(req, row)) });
});
app.post('/api/shipping-comparison', userAccess.requireArea('shipping'), (req, res) => {
  const rows = (req.body || {}).rows; if (!Array.isArray(rows) || !rows.length) return res.status(400).json({ error: 'rows (dizi) zorunlu.' });
  const codes = rows.map(recordOrderCode).filter(Number.isFinite);
  const codeLessRows = rows.filter(row => recordOrderCode(row) == null);
  if (codeLessRows.some(row => row && row._sourceModule !== 'collection') && !currentUserIsModerator(req)) return res.status(403).json({ error: 'Sipariş kodu olmayan nakliye satırlarını yalnız Moderatör ekleyebilir.', code: 'MODERATOR_REQUIRED' });
  if (rejectUnauthorizedOrders(req, res, codes)) return;
  try {
    const saved = addShippingRows(rows.map(({ _canEdit, _inherited, ...row }) => row), requestRevision(req), sourceUserId(req));
    userAccess.appendAudit(req.currentUser, 'SHIPPING_ADD', 'orders', { orderCodes: [...new Set(codes)], count: rows.length });
    res.json({ ...saved, rows: saved.rows.map(row => withOrderAccess(req, row)) });
  } catch (err) { apiError(res, err, 'Nakliye satırları eklenemedi.'); }
});
app.patch('/api/shipping-comparison/:shipId', userAccess.requireArea('shipping'), (req, res) => {
  try {
    const store = loadShipping(sourceUserId(req)), row = store.rows.find(item => item._shipId === req.params.shipId);
    if (!row) return res.status(404).json({ error: 'Nakliye satırı bulunamadı.' });
    const code = recordOrderCode(row);
    if (code == null && row._sourceModule !== 'collection' && !currentUserIsModerator(req)) return res.status(403).json({ error: 'Bu satırı yalnız Moderatör değiştirebilir.', code: 'MODERATOR_REQUIRED' });
    if (code != null && rejectUnauthorizedOrders(req, res, [code])) return;
    const saved = patchShippingRow(req.params.shipId, (({ _canEdit, _inherited, ...patch }) => patch)(req.body || {}), requestRevision(req), sourceUserId(req));
    userAccess.appendAudit(req.currentUser, 'SHIPPING_UPDATE', 'order', { orderCode: code, shipId: req.params.shipId });
    res.json({ ...saved, rows: saved.rows.map(item => withOrderAccess(req, item)) });
  } catch (err) { apiError(res, err, 'Nakliye satırı güncellenemedi.'); }
});
app.post('/api/shipping-comparison/delete', userAccess.requireArea('shipping'), (req, res) => {
  const ids = (req.body || {}).ids; if (!Array.isArray(ids) || !ids.length) return res.status(400).json({ error: 'ids (dizi) zorunlu.' });
  try {
    const store = loadShipping(sourceUserId(req)), selected = store.rows.filter(row => ids.includes(row._shipId));
    const codes = selected.map(recordOrderCode).filter(Number.isFinite);
    if (selected.some(row => recordOrderCode(row) == null && row._sourceModule !== 'collection') && !currentUserIsModerator(req)) return res.status(403).json({ error: 'Sipariş kodu olmayan satırları yalnız Moderatör silebilir.', code: 'MODERATOR_REQUIRED' });
    if (rejectUnauthorizedOrders(req, res, codes)) return;
    const saved = deleteShippingRows(ids, requestRevision(req), sourceUserId(req));
    userAccess.appendAudit(req.currentUser, 'SHIPPING_DELETE', 'orders', { orderCodes: [...new Set(codes)], count: selected.length });
    res.json({ ...saved, rows: saved.rows.map(row => withOrderAccess(req, row)) });
  } catch (err) { apiError(res, err, 'Nakliye satırları silinemedi.'); }
});

};
