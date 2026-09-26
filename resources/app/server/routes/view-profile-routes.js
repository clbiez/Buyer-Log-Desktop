'use strict';

/* Görünüm ve filtre profilleri + kaynak klasör seçimi route'ları
   server.js'ten birebir taşındı (davranış değişikliği yok). Kayıt, server.js'te
   blokların eskiden durduğu satırda yapılır; Express route SIRASI korunur.
   Bağımlılıklar kayıt anında enjekte edilir; çalışma sırasında yeniden atanan
   değerler (yok) canlı okuyucu fonksiyonla okunur. */
module.exports = function registerViewProfileRoutes(app, deps) {
  const {
    addFilterProfile,
    addView,
    apiError,
    chooseFolderDialog,
    deleteFilterProfile,
    deleteView,
    loadFilterProfiles,
    loadViews,
    markUsedFilterProfile,
    markUsedView,
    requestRevision,
    resetUserCache,
    setFavoriteFilterProfile,
    setFavoriteView,
    setUserSourceFolder,
    sourceFolderForUser,
    sourceUserId,
    syncFxFromKurWorkbook,
    updateFilterProfile,
    updateView,
    userAccess,
  } = deps;


// ---- Görünüm profilleri (kolon seçimi/sırası/genişliği) ----
app.get('/api/views', (req, res) => res.json(loadViews(req.currentUser.id)));
app.post('/api/views', (req, res) => {
  const { name, data } = req.body || {}; if (!name || !data) return res.status(400).json({ error: 'name ve data alanları zorunlu.' });
  try { res.json(addView(req.currentUser.id, name, data, requestRevision(req))); } catch (err) { apiError(res, err, 'Görünüm kaydedilemedi.'); }
});
app.delete('/api/views/:id', (req, res) => { try { res.json(deleteView(req.currentUser.id, req.params.id, requestRevision(req))); } catch (err) { apiError(res, err, 'Görünüm silinemedi.'); } });
app.put('/api/views/:id', (req, res) => { try { res.json(updateView(req.currentUser.id, req.params.id, (req.body || {}).data, requestRevision(req), (req.body || {}).name)); } catch (err) { apiError(res, err, 'Görünüm güncellenemedi.'); } });
app.post('/api/views/:id/favorite', (req, res) => { try { res.json(setFavoriteView(req.currentUser.id, req.params.id, requestRevision(req))); } catch (err) { apiError(res, err, 'Favori görünüm değiştirilemedi.'); } });
app.post('/api/views/:id/use', (req, res) => { try { res.json(markUsedView(req.currentUser.id, req.params.id, requestRevision(req))); } catch (err) { apiError(res, err, 'Son kullanılan görünüm kaydedilemedi.'); } });

// ---- Filtre profilleri ----
app.get('/api/filter-profiles', (req, res) => res.json(loadFilterProfiles(req.currentUser.id)));
app.post('/api/filter-profiles', (req, res) => {
  const { name, data } = req.body || {}; if (!name || !data) return res.status(400).json({ error: 'name ve data alanları zorunlu.' });
  try { res.json(addFilterProfile(req.currentUser.id, name, data, requestRevision(req))); } catch (err) { apiError(res, err, 'Filtre profili kaydedilemedi.'); }
});
app.delete('/api/filter-profiles/:id', (req, res) => { try { res.json(deleteFilterProfile(req.currentUser.id, req.params.id, requestRevision(req))); } catch (err) { apiError(res, err, 'Filtre profili silinemedi.'); } });
app.put('/api/filter-profiles/:id', (req, res) => { try { res.json(updateFilterProfile(req.currentUser.id, req.params.id, (req.body || {}).data, requestRevision(req), (req.body || {}).name)); } catch (err) { apiError(res, err, 'Filtre profili güncellenemedi.'); } });
app.post('/api/filter-profiles/:id/favorite', (req, res) => { try { res.json(setFavoriteFilterProfile(req.currentUser.id, req.params.id, requestRevision(req))); } catch (err) { apiError(res, err, 'Favori filtre değiştirilemedi.'); } });
app.post('/api/filter-profiles/:id/use', (req, res) => { try { res.json(markUsedFilterProfile(req.currentUser.id, req.params.id, requestRevision(req))); } catch (err) { apiError(res, err, 'Son kullanılan filtre kaydedilemedi.'); } });

// "📁 Kaynak Klasörü Seç" her kullanıcı için ayrı bir klasör kaydeder.
// Seçim yalnız aktif kullanıcının önbelleğini ve KUR kaynağını etkiler.
app.post('/api/choose-folder', userAccess.requireArea('source'), async (req, res) => {
  try {
    const id=sourceUserId(req);
    const folder = await chooseFolderDialog({ mode:'modern', initialPath:sourceFolderForUser(id) || '' });
    if (!folder) return res.json({ cancelled: true });
    setUserSourceFolder(id, folder);
    resetUserCache(id);
    // Kur ortak ayardır: klasördeki KUR.xlsx yalnız yetkili kullanıcıda herkese yayılır.
    const fxSync = userAccess.hasPermission(req.currentUser, 'manageBusinessRules') ? await syncFxFromKurWorkbook(id, true) : { found:false, updated:false, reason:'permission' };
    userAccess.appendAudit(req.currentUser,'SOURCE_FOLDER_CHANGE',folder,{fxUpdated:Boolean(fxSync&&fxSync.updated)});
    res.json({ ok: true, sourceFolder: folder, fxSync });
  } catch (err) { apiError(res, err, 'Klasör seçme penceresi açılamadı.'); }
});

};
