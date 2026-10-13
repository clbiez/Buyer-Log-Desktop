'use strict';

/* Horizon şablonları ve Veri Yönetimi katman route'ları
   server.js'ten birebir taşındı (davranış değişikliği yok). Kayıt, server.js'te
   blokların eskiden durduğu satırda yapılır; Express route SIRASI korunur.
   Bağımlılıklar kayıt anında enjekte edilir; çalışma sırasında yeniden atanan
   değerler (yok) canlı okuyucu fonksiyonla okunur. */
module.exports = function registerHorizonTemplateRoutes(app, deps) {
  const {
    addHorizonTemplate,
    apiError,
    dataManagementAdapter,
    dataManagementBindingWriter,
    dataManagementFilterWriter,
    deleteHorizonTemplate,
    express,
    loadHorizonTemplates,
    loadModelConnections,
    modelHorizon,
    modelSupportInfo,
    publishSharedMasterChange,
    replaceModelConnections,
    requestRevision,
    sourceUserId,
    sourceWorkflowService,
    personalHorizonService,
    horizonTemplateService,
    userAccess,
    userPreferences,
  } = deps;
  // Both native UI and Office use the existing planners inside the same lease.
  const sourceGuard=req=>({assertAuthority:()=>{
    const current=userAccess.profileById(req.currentUser.id);
    if(!current||current.enabled===false||!userAccess.hasArea(current,'source')||!userAccess.hasPermission(current,'manageModelConnections'))throw Object.assign(new Error('PERMISSION_REQUIRED'),{code:'PERMISSION_REQUIRED',statusCode:403});
    return current;
  }});
  const personalGuard=req=>({ownerId:sourceUserId(req),profile:req.currentUser,assertAuthority:()=>{
    const current=userAccess.profileById(req.currentUser.id);
    if(!current||current.enabled===false||!userAccess.hasArea(current,'source'))throw Object.assign(new Error('PERMISSION_REQUIRED'),{code:'PERMISSION_REQUIRED',statusCode:403});
    return current;
  }});


/* ===================================================================
   HORIZON ŞABLONLARI (v7.81)

   Kaydedilmiş hazır ufuklar. Kullanıcı kararı: modül başlarındaki kişisel
   horizon kalkıyor, ufuk tek yerden — Data Management'tan — yönetiliyor;
   ama "hazır ön ayar" ve "başkasıyla paylaşma" korunuyor.

   Bir şablon = kaydedilmiş filtre tanımı (table + groups) + ad. Uygulanınca
   normal ortak filtre yazma yolundan (/api/data-management/filter) geçer;
   ikinci bir yazma yolu YOKTUR, yoksa iki ayrı doğruluk kaynağı olurdu.
   =================================================================== */
const templateContext=req=>({...sourceGuard(req),ownerId:req.currentUser.id,profile:req.currentUser});
app.get('/api/horizon-templates', userAccess.requireArea('source'), userAccess.requirePermission('manageModelConnections'), async (req, res) => {
  try {
    const ctx=templateContext(req),personal=await horizonTemplateService.capture('create',{shared:false},ctx),shared=await horizonTemplateService.capture('create',{shared:true},ctx);
    const mapItem=(item,isShared)=>({id:item.id,name:item.name,definition:item.data||null,shared:isShared,ownerId:item.userId||null,updatedAt:item.updatedAt||item.createdAt||null});
    res.set('Cache-Control','no-store').json({ok:true,personal:personal.store.items.map(item=>mapItem(item,false)),shared:shared.store.items.map(item=>mapItem(item,true)),personalRevision:personal.store._revision,sharedRevision:shared.store._revision});
  } catch (err) { apiError(res,err,'Horizon şablonları okunamadı.'); }
});
app.post('/api/horizon-templates', userAccess.requireArea('source'), userAccess.requirePermission('manageModelConnections'), express.json({ limit: '256kb' }), async (req,res)=>{
  try {
    const body=req.body||{},args={name:String(body.name||'').trim(),definition:body.definition,shared:body.shared===true};
    if(!args.name)return res.status(400).json({error:'Şablon adı zorunlu.',code:'VALIDATION_ERROR'});
    if(!args.definition||typeof args.definition!=='object')return res.status(400).json({error:'Şablon tanımı zorunlu.',code:'VALIDATION_ERROR'});
    const saved=await horizonTemplateService.execute('create',args,null,templateContext(req));
    userAccess.appendAudit(req.currentUser,'HORIZON_TEMPLATE_CREATE',args.name,{shared:args.shared});res.json({ok:true,shared:saved.shared,revision:saved.revision,id:saved.id});
  } catch (err) { apiError(res,err,'Horizon şablonu kaydedilemedi.'); }
});
app.delete('/api/horizon-templates/:id', userAccess.requireArea('source'), userAccess.requirePermission('manageModelConnections'), express.json({ limit: '64kb' }), async(req,res)=>{
  try {
    const args={id:req.params.id,shared:String(req.query&&req.query.shared||'')==='1'};
    // NOT_OWNER: the native service rechecks ownership/manageAllOrders under its real lease.
    await horizonTemplateService.execute('delete',args,null,templateContext(req));
    userAccess.appendAudit(req.currentUser,'HORIZON_TEMPLATE_DELETE',args.id,{shared:args.shared});res.json({ok:true});
  } catch(err){apiError(res,err,'Horizon şablonu silinemedi.');}
});
app.post('/api/horizon-templates/:id/share', userAccess.requireArea('source'), userAccess.requirePermission('manageModelConnections'), express.json({ limit: '64kb' }), async(req,res)=>{
  try {
    // The native service copies the personal item while holding its lease; it never moves it.
    const saved=await horizonTemplateService.execute('share',{id:req.params.id},null,templateContext(req));
    userAccess.appendAudit(req.currentUser,'HORIZON_TEMPLATE_SHARE',req.params.id,{});res.json({ok:true,id:saved.id,revision:saved.revision});
  } catch(err){apiError(res,err,'Horizon şablonu paylaşılamadı.');}
});
/* v7.0.183 — HORIZON KULLANICI BAZLI (kullanıcı kararı).

   mode 'personal' filtreyi KULLANICININ KENDİ tercih deposuna yazar; ortak
   bağlantı kaydına (settings.json › modelConnections) dokunmaz ve Sync'e
   yayın yapmaz. Ortak kayıt Sync klasörü üzerinden her makineye gittiği için
   eskiden bir bilgisayarda yapılan Horizon değişikliği herkesinkini eziyordu.

   Kişisel kaydetme 'source' alanına erişen herkese açıktır (yalnız kendi
   ayarını değiştirir). Ortak varsayılanı ('shared' / 'split') yazmak yine
   manageModelConnections yetkisi ister. */
app.post('/api/data-management/filter', userAccess.requireArea('source'), express.json({ limit: '256kb' }), async (req, res) => {
  try {
    const body = req.body || {};
    const sourceId = String(body.sourceId || '').trim();
    const moduleId = String(body.moduleId || '').trim();
    if (!sourceId || !moduleId) {
      return res.status(400).json({ error: 'sourceId ve moduleId zorunlu.', code: 'VALIDATION_ERROR' });
    }

    if (body.mode === 'personal') {
      const userId = sourceUserId(req);
      const saved = await personalHorizonService.update({ sourceId, moduleId, definition: body.definition }, { sourceRevision: String(body.expectedSourceRevision || '').trim() }, personalGuard(req));
      userAccess.appendAudit(req.currentUser, 'DATA_MANAGEMENT_PERSONAL_FILTER_UPDATE', userId, { sourceId, moduleId, modules: saved.modules });
      return res.json({ ok: true, personal: true, modules: saved.modules, warnings: saved.warnings || [] });
    }

    if (!userAccess.hasPermission(req.currentUser, 'manageModelConnections')) {
      return res.status(403).json({
        error: 'Herkes için ortak filtreyi değiştirmek Kaynak Veri yönetim yetkisi gerektirir. Kendi filtrenizi "Kaydet (yalnız benim için)" ile kaydedebilirsiniz.',
        code: 'PERMISSION_REQUIRED',
      });
    }
    const saved = await sourceWorkflowService.update('filter', {
      sourceId, moduleId, definition: body.definition, mode: body.mode,
      name: Object.prototype.hasOwnProperty.call(body, 'name') ? body.name : null,
    }, String(body.expectedSourceRevision || '').trim(), sourceGuard(req));
    userAccess.appendAudit(req.currentUser, 'DATA_MANAGEMENT_FILTER_UPDATE', sourceId, { moduleId, mode: body.mode || 'shared' });
    if (saved.changed) publishSharedMasterChange('modelConnections', req);
    res.json({ ok: true, ...saved });
  } catch (err) { apiError(res, err, 'Modül filtresi kaydedilemedi.'); }
});

/* EZEN KİŞİSEL KATMANI KALDIR (P3 — çıkmazı açar).

   KORUNAN KUSUR: ekran, ortak filtrenin üstünde kişisel bir Horizon varken
   düzenleyiciyi hiç açmıyor ve "önce onu kaldırın" diyordu. Ama kaldırılacak
   yer BAŞKA BİR EKRANDI; kullanıcı "her şeyi Veri Yönetimi'nde yapmak
   istiyorum" derken tam olarak bunu kastediyor. Yol burada açılır.

   YALNIZ KULLANICININ KENDİ AYARINI siler. Ön ayar ve rol şablonu buradan
   kaldırılmaz: ikisi de kullanıcının değil, çalışma alanının kararıdır ve
   silinseydi başka kullanıcıları da etkilerdi. O katmanlar ekranda
   açıklanır, silinmez.

   'default' anahtarı BÜTÜN modülleri etkiler; istemci bunu ayrıca sorar. */
app.post('/api/data-management/layer', userAccess.requireArea('source'), express.json({ limit: '16kb' }), (req, res) => {
  try {
    const body = req.body || {};
    const moduleId = String(body.moduleId || '').trim();
    const layerKey = String(body.layerKey || '').trim();
    if (!moduleId) return res.status(400).json({ error: 'moduleId zorunlu.', code: 'VALIDATION_ERROR' });

    const key = layerKey === 'personalDefault' ? userPreferences.horizonKey('default')
      : (layerKey === 'personal' ? userPreferences.horizonKey(moduleId) : '');
    if (!key) {
      return res.status(400).json({
        error: 'Bu katman sizin kişisel ayarınız değil; buradan kaldırılamaz.',
        code: 'LAYER_NOT_PERSONAL',
      });
    }

    const userId = sourceUserId(req);
    personalHorizonService.clearLayer({moduleId,layerKey},null,personalGuard(req));
    userAccess.appendAudit(req.currentUser, 'DATA_MANAGEMENT_LAYER_CLEAR', userId, { moduleId, layerKey });
    res.json({ ok: true, moduleId, layerKey });
  } catch (err) { apiError(res, err, 'Kişisel katman kaldırılamadı.'); }
});

/* MODÜL BAĞLANTISINI AÇ / KAPAT (P5).

   Kapsamlı "bağlantıları kaydet" yerine TEK bir hücreyi değiştirir. Sebebi:
   mevcut /api/model-connections ucu bütün diziyi değiştiriyor ve iki yönetici
   farklı kaynaklarda çalışsa bile birbirini eziyor. Burada değişen tek şey bir
   modül bağlantısıdır; revizyon kontrolü yine uygulanır.

   Kapatılan bağlantının filtresi SİLİNMEZ, park edilir (§11). */
app.post('/api/data-management/binding', userAccess.requireArea('source'), userAccess.requirePermission('manageModelConnections'), express.json({ limit: '16kb' }), async (req, res) => {
  try {
    const body = req.body || {};
    const sourceId = String(body.sourceId || '').trim();
    const moduleId = String(body.moduleId || '').trim();
    if (!sourceId || !moduleId) {
      return res.status(400).json({ error: 'sourceId ve moduleId zorunlu.', code: 'VALIDATION_ERROR' });
    }
    if (typeof body.enabled !== 'boolean') {
      return res.status(400).json({ error: 'enabled (boolean) zorunlu.', code: 'VALIDATION_ERROR' });
    }

    const saved = await sourceWorkflowService.update('binding', { sourceId, moduleId, enabled: body.enabled }, String(body.expectedSourceRevision || '').trim(), sourceGuard(req));
    if (saved.changed) {
      userAccess.appendAudit(req.currentUser, 'DATA_MANAGEMENT_BINDING_UPDATE', sourceId, { moduleId, enabled: body.enabled });
      publishSharedMasterChange('modelConnections', req);
    }
    res.json({ ok: true, ...saved });
  } catch (err) { apiError(res, err, 'Modül bağlantısı güncellenemedi.'); }
});

/* BAĞLI GRUBA EKLE / GRUPTAN AYIR (v20260929).

   Bağlı grup = ASAS'ta tek ortak filtreyi (tek sorgu) paylaşan modüller.
   Kullanıcı bir modülü gruptan ayırabilir (kendi filtresiyle ayrı sorgu olur)
   ya da geri ekleyebilir (grubun filtresini kullanır; kendi filtresi saklanır).
   Yenileme her iki durumda da TEKTİR. Eşzamanlılık kontrolü kaynak başınadır. */
app.post('/api/data-management/link', userAccess.requireArea('source'), userAccess.requirePermission('manageModelConnections'), express.json({ limit: '16kb' }), async (req, res) => {
  try {
    const body = req.body || {};
    const sourceId = String(body.sourceId || '').trim();
    const moduleId = String(body.moduleId || '').trim();
    if (!sourceId || !moduleId) {
      return res.status(400).json({ error: 'sourceId ve moduleId zorunlu.', code: 'VALIDATION_ERROR' });
    }
    if (typeof body.linked !== 'boolean') {
      return res.status(400).json({ error: 'linked (boolean) zorunlu.', code: 'VALIDATION_ERROR' });
    }
    const saved = await sourceWorkflowService.update('link', { sourceId, moduleId, linked: body.linked }, String(body.expectedSourceRevision || '').trim(), sourceGuard(req));
    if (saved.changed) {
      userAccess.appendAudit(req.currentUser, 'DATA_MANAGEMENT_LINK_UPDATE', sourceId, { moduleId, linked: body.linked });
      publishSharedMasterChange('modelConnections', req);
    }
    res.json({ ok: true, ...saved });
  } catch (err) { apiError(res, err, 'Bağlı grup güncellenemedi.'); }
});

app.get('/api/model-connections', (_req, res) => {
  const store = loadModelConnections();
  res.set('ETag', `"${store.revision}"`);
  /* v7.81 — KAYNAK BAŞINA YAPILANDIRMA SÜRÜMÜ de döner.

     Depo revizyonu (store.revision) BÜTÜN diziye aittir: Veri Yönetimi'nden
     bir kaynağa dokunmak, başka bir kaynağı düzenleyen ikinci bir ekranı
     "başkası değiştirdi" diye reddettiriyordu. Tek-işlem uçları kaynak başına
     sürümle çalışıyor; bu uç da o sürümü verirse aynı ekran iki yerden
     çağrıldığında ikisi de doğru olanı gönderebilir.

     lastRun bu parmak izine DAHİL DEĞİLDİR (bkz. legacy-adapter): arka planda
     çalışan bir yenileme, açık duran bir ekranı bayatlatmamalı. */
  const items = store.items.map(item => ({
    ...item,
    configRevision: dataManagementAdapter.configRevision(item),
  }));
  res.json({ items, revision: store.revision, ...modelSupportInfo() });
});

app.put('/api/model-connections', userAccess.requireArea('source'), userAccess.requirePermission('manageModelConnections'), (req, res) => {
  try {
    const items = (req.body || {}).items;
    if (!Array.isArray(items)) return res.status(400).json({ error: 'items (dizi) zorunlu.', code: 'VALIDATION_ERROR' });
    const saved = replaceModelConnections(items, requestRevision(req));
    userAccess.appendAudit(req.currentUser, 'MODEL_CONNECTIONS_UPDATE', 'settings', { count: saved.items.length });
    publishSharedMasterChange('modelConnections', req);
    res.set('ETag', `"${saved.revision}"`);
    res.json({ ok: true, items: saved.items, revision: saved.revision, ...modelSupportInfo() });
  } catch (err) { apiError(res, err, 'Veri modeli bağlantıları kaydedilemedi.'); }
});

};
