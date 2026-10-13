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


// Native UI and Office share the owner profile file lease and journal writer.
const profileService = deps.tableProfileService;
for (const [kind,route] of [['view','views'],['filter','filter-profiles']]) {
  app.get('/api/'+route, async (req,res)=>{
    try { res.json(await profileService.capture(kind,{ownerId:req.currentUser.id,profile:req.currentUser})); }
    catch(err){ apiError(res,err,'Profil okunamadı.'); }
  });
  for (const operation of ['create','update','delete','favorite','use']) {
    const method=operation==='update'?'put':operation==='delete'?'delete':'post';
    const suffix=operation==='create'?'':operation==='favorite'||operation==='use'?'/'+operation:'';
    app[method]('/api/'+route+(operation==='create'?'':'/:id')+suffix,async(req,res)=>{
      const body=req.body||{};
      if(operation==='create'&&(!body.name||!body.data))return res.status(400).json({error:'name ve data alanları zorunlu.'});
      try { res.json(await profileService.execute(kind,operation,{id:req.params?.id,name:body.name,data:body.data},null,{ownerId:req.currentUser.id,profile:req.currentUser},{native:true,revision:requestRevision(req)})); }
      catch(err){ apiError(res,err,'Profil kaydedilemedi.'); }
    });
  }
}

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
