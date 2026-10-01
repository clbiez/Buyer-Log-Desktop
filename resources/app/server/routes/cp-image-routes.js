'use strict';

/* CP görselleri route'ları
   server.js'ten birebir taşındı (davranış değişikliği yok). Kayıt, server.js'te
   blokların eskiden durduğu satırda yapılır; Express route SIRASI korunur.
   Bağımlılıklar kayıt anında enjekte edilir; çalışma sırasında yeniden atanan
   değerler (yok) canlı okuyucu fonksiyonla okunur. */
module.exports = function registerCpImageRoutes(app, deps) {
  const {
    apiError,
    assertModelImageMutable,
    deleteCollectionImage,
    fs,
    getCollectionImage,
    saveCollectionImage,
    userAccess,
  } = deps;


// ---- CP görselleri ----
// Fiziksel dosyalar Koleksiyon görselleriyle aynı yedeklenebilir depoda tutulur;
// bağlantı PLM ID + Colour Code anahtarıyla overrides.imagemap'e yazılır.
app.post('/api/cp-images', userAccess.requireArea('cp'), (req, res) => {
  try {
    assertModelImageMutable();
    const body = req.body || {};
    const stored = saveCollectionImage({ rowId: `cp:${body.rowId || ''}`, filename: body.filename, mimeType: body.mimeType, base64: body.base64 });
    res.json({ ok: true, image: { ...stored, url: `/api/cp-images/${encodeURIComponent(stored.id)}` } });
  } catch (err) { apiError(res, err, 'CP görseli kaydedilemedi.'); }
});
app.get('/api/cp-images/:id', userAccess.requireAnyArea('cp','orders','backlog','koleksiyon','lfl','overview','priceanalysis','opencosting','shipping'), (req, res) => {
  try {
    const found = getCollectionImage(req.params.id);
    if (!found) return res.status(404).json({ error: 'CP görseli bulunamadı.' });
    res.setHeader('Content-Type', found.item.mimeType || 'application/octet-stream');
    res.setHeader('Content-Length', String(fs.statSync(found.full).size));
    res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
    /* /api katmanı her yanıta Pragma: no-cache + Expires: 0 ekler. Chromium
       yanıttaki Pragma: no-cache'i Cache-Control: no-cache gibi yorumlar:
       immutable YOK SAYILIR ve her görsel her render'da sunucuya yeniden
       doğrulatılır. Görseller bu yüzden geç geliyor, sayfa değişince
       kaybolup bir süre sonra geri geliyordu. Görsel kimliği değişmez. */
    res.removeHeader('Pragma');
    res.removeHeader('Expires');
    res.sendFile(found.full);
  } catch (err) { apiError(res, err, 'CP görseli okunamadı.'); }
});
app.delete('/api/cp-images/:id', userAccess.requireArea('cp'), (req, res) => {
  try { res.json({ ok: true, deleted: deleteCollectionImage(req.params.id) }); }
  catch (err) { apiError(res, err, 'CP görseli silinemedi.'); }
});

};
