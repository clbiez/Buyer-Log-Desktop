'use strict';

const plmBomSync = require('../lib/plm-bom-sync');
const plmBomStore = require('../lib/plm-bom-store');

/* Koleksiyon doğrudan PLM senkronu ve QTX route'ları
   server.js'ten birebir taşındı (davranış değişikliği yok). Kayıt, server.js'te
   blokların eskiden durduğu satırda yapılır; Express route SIRASI korunur.
   Bağımlılıklar kayıt anında enjekte edilir; çalışma sırasında yeniden atanan
   değerler (yok) canlı okuyucu fonksiyonla okunur. */
module.exports = function registerPlmSyncRoutes(app, deps) {
  const {
    MODEL_FILES_ROOT,
    agentBrowserConnector,
    apiError,
    automationError,
    clearModelOperationProgress,
    crypto,
    ensureModelFilesRoot,
    express,
    fs,
    getModelImageSettings,
    loadPlmStyleLinks,
    modelStoredFileExists,
    normalizePlmId,
    plmJobs,
    publicModelFileMeta,
    qtxStore,
    readModelFilesIndex,
    resolveStoredFile,
    safeMailFilename,
    setModelOperationProgress,
    technicalSheetOwnership,
    upsertPlmStyleLinks,
    userAccess,
    withPlmJob,
    writeModelFilesIndex,
  } = deps;


/* ===================================================================
   COLLECTION DIRECT PLM SYNC

   Bu uç nokta "PLM Excel'inden Modelleri Aktar" ile AYNI normalize edilmiş
   model nesnesini üretmek için VERİ KAYNAĞIDIR — eşleme/güncelleme mantığı
   burada değil, istemcideki paylaşılan mapping motorunda
   (public/app-main.js: kolPlmNormalizeDirectRecord → kolBuildPlmImportPlan)
   yaşar. İkinci bir GetStyleList/pagination/authentication uygulaması
   YOKTUR: agentBrowserConnector.collectCoreNectumStyleLinks zaten "PLM Link
   ve Görsellerini Bul" tarafından üretimde kullanılan AYNI fonksiyondur —
   yalnız artık kayıt başına daha fazla iş alanı taşıyor (bkz.
   agent-browser-connector.js CORENECTUM_EXTRA_FIELDS).

   needImage HER ZAMAN false: görsel çekme ayrı, zaten var olan
   /api/model-images/import-plm akışının işidir (§13 — görsel altyapısı
   yeniden yazılmaz). PLM linki sözlüğü (plmId→styleId) burada da tazelenir
   (upsertPlmStyleLinks) — Collection PLM Sync çalıştıran kullanıcı, PLM
   model linklerini de bedavaya güncellemiş olur. */
const fetchService=createPlmFetchService(deps);
app.post('/api/plm-sync/fetch', userAccess.requireAnyArea('koleksiyon', 'cp', 'orders'), express.json({limit:'4mb'}), async(req,res)=>{try{res.json(await fetchService.fetch(req.currentUser,req.body||{},{request:req,allowAi:true}));}catch(err){automationError(res,err,'PLM verileri alınamadı.');}});


/* Koleksiyon tablosundaki Artwork Detayı sanal sistem sütunu görünür
   satırların BOM özetini tek yerel okumayla alır. Bu uç CoreNectum/LCW AI
   çağırmaz; yalnız kalıcı plm-bom.json kaydını projekte eder. */
app.post('/api/plm-sync/bom/batch', userAccess.requireAnyArea('koleksiyon', 'cp', 'orders'), express.json({ limit: '128kb' }), (req, res) => {
  try {
    const raw = Array.isArray(req.body && req.body.plmIds) ? req.body.plmIds : null;
    if (!raw) return res.status(400).json({ error: 'plmIds (dizi) zorunlu.', code: 'VALIDATION_ERROR' });
    const plmIds = [...new Set(raw.map(normalizePlmId).filter(Boolean))].slice(0, 1000);
    const store = plmBomStore.load();
    const entries = {};
    for (const plmId of plmIds) {
      const entry = store.models && store.models[plmId];
      if (entry) entries[plmId] = entry;
    }
    res.set('Cache-Control', 'no-store').json({
      ok: true,
      entries,
      requested: plmIds.length,
      found: Object.keys(entries).length,
      revision: Number(store._revision) || 0,
      updatedAt: store._updatedAt || null,
    });
  } catch (err) { apiError(res, err, 'PLM BOM özetleri okunamadı.'); }
});

/* PLM Sync sırasında saklanan son normalize BOM analizi. Bu uç yalnız
   Buyer Log deposunu okur; CoreNectum'a veya LCW AI'a yeni istek atmaz. */
app.get('/api/plm-sync/bom/:plmId', userAccess.requireAnyArea('koleksiyon', 'cp', 'orders'), (req, res) => {
  try {
    const plmId = normalizePlmId(req.params && req.params.plmId);
    if (!plmId) return res.status(400).json({ error: 'Geçerli PLM ID gerekli.', code: 'PLM_ID_REQUIRED' });
    const entry = plmBomStore.entry(plmId);
    if (!entry) return res.status(404).json({ error: 'Bu model için kaydedilmiş BOM yok.', code: 'PLM_BOM_NOT_FOUND' });
    res.set('Cache-Control', 'no-store').json({ ok: true, entry });
  } catch (err) { apiError(res, err, 'PLM BOM bilgisi okunamadı.'); }
});

/* PLM teknik föylerini (Technical Sheet Report) toplu indirip Koleksiyon'un
   "Dosyalar" deposuna yazar.

   NEDEN AYRI BİR UÇ: dosyalar /api/model-files deposuna gider ama o uç
   'source' yetkisi ister; PLM Sync'i çalıştıran kullanıcının yetkisi
   'koleksiyon'dur. Aynı depoyu burada PLM Sync'in kendi yetkisiyle yazıyoruz
   ki 'source' yetkisi olmayan bir kullanıcıda işlem yarıda patlamasın.

   styleId BURADA çözülür (PLM link deposundan) ve tarayıcıya hazır verilir.
   Bulunamayan model atlanır ve raporlanır — asla tahmin edilmez, çünkü yanlış
   bir styleId hata vermeden BAŞKA BİR MODELİN PDF'ini getirir. */
app.post('/api/plm-sync/model-files', userAccess.requireArea('koleksiyon'), express.json({ limit: '2mb' }), async (req, res) => {
  try {
    const rawItems = Array.isArray(req.body && req.body.items) ? req.body.items : null;
    if (!rawItems) return res.status(400).json({ error: 'items (dizi) zorunlu.', code: 'VALIDATION_ERROR' });
    const language = String(req.body && req.body.language || 'en').toLowerCase() === 'tr' ? 'tr' : 'en';
    const links = loadPlmStyleLinks().links || {};
    const seen = new Set();
    const items = [];
    for (const raw of rawItems.slice(0, 500)) {
      const plmId = normalizePlmId(raw && raw.plmId);
      if (!plmId || seen.has(plmId)) continue;
      seen.add(plmId);
      const link = links[plmId];
      items.push({
        plmId,
        styleId: link && link.styleId ? String(link.styleId) : '',
        // A technical sheet belongs to a PLM style, not to the first colour
        // row that happened to request it.
        modelKey: technicalSheetOwnership.canonicalTechnicalSheetKey(plmId),
        modelLabel: String(raw && raw.modelLabel || '').trim().slice(0, 300),
        filename: String(raw && raw.filename || '').trim().slice(0, 200),
      });
    }
    if (!items.length) return res.status(400).json({ error: 'Geçerli PLM ID bulunamadı.', code: 'PLM_ID_REQUIRED' });
    const byPlmId = new Map(items.map(item => [item.plmId, item]));

    setModelOperationProgress(req.currentUser.id, { kind: 'plm-technical-sheet', phase: 'Teknik föy indiriliyor', current: 0, total: items.length, model: '' });
    const sheetRun = await withPlmJob(req, {
      kind: 'plm-files', scope: 'koleksiyon', total: items.length,
      label: `Teknik föy · ${items.length} model (${language.toUpperCase()})`,
      phase: 'Teknik föy indiriliyor',
    }, async job => agentBrowserConnector.downloadCoreNectumTechnicalSheets(
      req.currentUser.id,
      items.map(item => ({ plmId: item.plmId, styleId: item.styleId })),
      { language, isCancelled: job.cancelled, onProgress: progress => {
        setModelOperationProgress(req.currentUser.id, { kind: 'plm-technical-sheet', ...progress });
        job.report({ phase: progress && progress.phase, processed: progress && progress.current, total: (progress && progress.total) || items.length, activeModel: progress && progress.model });
      } }
    ));
    const collected = sheetRun.result;
    for (const item of collected.failed || []) plmJobs.addFailure(req.currentUser.id, sheetRun.job.id, { plmId: item && item.plmId, error: item && item.error, code: item && item.code });

    ensureModelFilesRoot();
    const index = readModelFilesIndex();
    const ownership = technicalSheetOwnership.resolveTechnicalSheetOwnership(index, items.map(item => item.plmId), { fileExists: modelStoredFileExists });
    const saved = [];
    const storeFailed = [];
    for (const file of collected.files) {
      const meta = byPlmId.get(file.plmId);
      if (!meta || !meta.modelKey) { storeFailed.push({ plmId: file.plmId, error: 'Model anahtarı yok.', code: 'MODEL_KEY_REQUIRED' }); continue; }
      try {
        const buffer = Buffer.from(file.base64, 'base64');
        if (!buffer.length) throw new Error('PLM boş dosya döndürdü.');
        const filename = safeMailFilename(meta.filename || `TechnicalSheet_${file.plmId}_${language.toUpperCase()}.pdf`, 'technical-sheet');
        const id = `mf_${Date.now()}_${crypto.randomBytes(6).toString('hex')}`;
        const storedName = `${id}_${filename}`;
        fs.writeFileSync(resolveStoredFile(MODEL_FILES_ROOT, storedName), buffer);
        // Aynı PLM ID için önceki canonical PLM föyünü değiştir; dil varyantı
        // ikinci bir source of truth yaratamaz. Kullanıcının kendi
        // yüklediği dosyalara (plmSource'u olmayanlara) DOKUNULMAZ.
        for (let i = index.length - 1; i >= 0; i -= 1) {
          const old = index[i];
          if (old && old.modelKey === meta.modelKey && old.plmSource === 'technical-sheet') {
            try { fs.unlinkSync(resolveStoredFile(MODEL_FILES_ROOT, old.storedName)); } catch (err) { if (err && err.code !== 'ENOENT') throw err; }
            index.splice(i, 1);
          }
        }
        const item = {
          id, modelKey: meta.modelKey, modelLabel: meta.modelLabel, filename, storedName,
          mimeType: 'application/pdf', size: buffer.length, lastModified: null,
          createdAt: new Date().toISOString(),
          plmSource: 'technical-sheet', plmLanguage: language, plmId: file.plmId, styleId: file.styleId,
        };
        index.push(item);
        saved.push(publicModelFileMeta(item));
      } catch (err) {
        storeFailed.push({ plmId: file.plmId, error: String(err && err.message || err).slice(0, 300), code: 'MODEL_FILE_WRITE_FAILED' });
      }
    }
    if (saved.length || ownership.migrated.length) writeModelFilesIndex(index);

    const failed = [...collected.failed, ...storeFailed];
    userAccess.appendAudit(req.currentUser, 'PLM_SYNC_MODEL_FILES', 'corenectum', {
      requested: collected.requested, downloaded: collected.files.length, saved: saved.length, failed: failed.length, language,
    });
    for (const item of storeFailed) plmJobs.addFailure(req.currentUser.id, sheetRun.job.id, { plmId: item.plmId, error: item.error, code: item.code });
    plmJobs.update(req.currentUser.id, sheetRun.job.id, { processed: items.length, succeeded: saved.length });
    res.json({ ok: true, requested: collected.requested, downloaded: collected.files.length, saved: saved.length, files: saved, failedItems: failed, language, jobId: sheetRun.job.id, migrated: ownership.migrated, ownershipConflicts: ownership.conflicts });
  } catch (err) { automationError(res, err, 'PLM teknik föyleri alınamadı.'); }
  finally { clearModelOperationProgress(req.currentUser && req.currentUser.id); }
});

/* Pricing preflight reads only the normalized model-file metadata. It neither
   downloads PDFs nor contacts CoreNectum, so opening the warning is cheap. */
app.post('/api/plm-sync/model-files/status', userAccess.requireArea('koleksiyon'), express.json({ limit: '128kb' }), (req, res) => {
  try {
    const raw = Array.isArray(req.body && req.body.plmIds) ? req.body.plmIds : null;
    if (!raw) return res.status(400).json({ error: 'plmIds (dizi) zorunlu.', code: 'VALIDATION_ERROR' });
    const plmIds = [...new Set(raw.map(normalizePlmId).filter(Boolean))].slice(0, 500);
    const index = readModelFilesIndex();
    const ownership = technicalSheetOwnership.resolveTechnicalSheetOwnership(index, plmIds, { fileExists: modelStoredFileExists });
    if (ownership.migrated.length) writeModelFilesIndex(index);
    res.set('Cache-Control', 'no-store').json({ ok: true, statusByPlmId: ownership.statusByPlmId, migrated: ownership.migrated, conflicts: ownership.conflicts });
  } catch (err) { apiError(res, err, 'PLM teknik föy durumu okunamadı.'); }
});

/* v6.55 — QTX'İ KALICI OLARAK SAĞ TIK MENÜSÜNDEN YÖNETME.
   Eskiden Colour Code hücresine ÇİFT TIKLAMA yalnız tarayıcının kendi
   indirme mekanizmasını TETİKLİYORDU; Buyer Log dosyanın baytlarını hiç
   görmüyordu (kalıcı kayıt YOKTU). Kullanıcı kararı: sağ tık ile "Umbrella'da
   Bul" (indir + KAYDET) ve "QTX indir" (kayıtlıyı indir) — Colour Code
   TÜM modellerde ortak bir değer olduğu için kayıt bir kez yapılınca AYNI
   Colour Code'a sahip HER satırda görünür/indirilebilir olur (bkz. qtx-store.js). */
// "Umbrella'da Bul": arayıp bulur, dosyanın GERÇEK baytlarını yakalar (mode:'fetch')
// ve Colour Code anahtarıyla kalıcı olarak kaydeder.
app.post('/api/qtx/fetch-and-save', userAccess.requireAnyArea('cp', 'orders', 'koleksiyon'), express.json({ limit: '16kb' }), async (req, res) => {
  try {
    const body=req.body&&typeof req.body==='object'?req.body:{};
    const colourCode=String(body.colourCode||'').replace(/[\u0000-\u001f\u007f]/g,' ').trim().slice(0,80);
    const source=['cp','orders','koleksiyon'].includes(String(body.source||''))?String(body.source):'cp';
    if(!colourCode)return res.status(400).json({error:'Colour Code boş olamaz.',code:'QTX_COLOUR_REQUIRED'});
    const result=await agentBrowserConnector.downloadUmbrellaQtx(req.currentUser.id,{colourCode,mode:'fetch'});
    if(!result.base64)throw Object.assign(new Error('QTX dosyasının içeriği yakalanamadı.'),{code:result.code||'QTX_BYTES_NOT_CAPTURED',statusCode:409});
    const buffer=Buffer.from(result.base64,'base64');
    const saved=qtxStore.saveQtxFile(colourCode,buffer,{fileName:result.filename,savedBy:req.currentUser.id});
    userAccess.appendAudit(req.currentUser,'QTX_FETCH_AND_SAVE',colourCode,{source,filename:saved.fileName,size:saved.size,pageNumber:result.pageNumber,pagesScanned:result.pagesScanned,rowsScanned:result.rowsScanned});
    res.json({ok:true,saved,result:{filename:result.filename,pagesScanned:result.pagesScanned,rowsScanned:result.rowsScanned}});
  } catch (err) { automationError(res,err,'QTX dosyası bulunup kaydedilemedi.'); }
});
// Görsel işaretleme (kalın+mavi Colour Code): tüm kayıtlı Colour Code'ların listesi.
app.get('/api/qtx/saved', userAccess.requireAnyArea('cp', 'orders', 'koleksiyon'), (req, res) => {
  try {
    res.set('Cache-Control','no-store').json({ok:true,colourCodes:qtxStore.listSavedColourCodes()});
  } catch (err) { automationError(res,err,'Kayıtlı QTX listesi okunamadı.'); }
});
// "QTX indir": daha önce kaydedilmiş dosyayı doğrudan tarayıcıya indirir —
// Umbrella'ya hiç gidilmez, sunucudaki kopya servis edilir.
app.get('/api/qtx/file/:colourCode', userAccess.requireAnyArea('cp', 'orders', 'koleksiyon'), (req, res) => {
  try {
    const file=qtxStore.filePathFor(req.params.colourCode);
    if(!file)return res.status(404).json({error:'Bu Colour Code için kayıtlı QTX dosyası yok.',code:'QTX_NOT_SAVED'});
    userAccess.appendAudit(req.currentUser,'QTX_FILE_DOWNLOAD',qtxStore.colourKey(req.params.colourCode),{fileName:file.fileName});
    res.download(file.fullPath,file.fileName);
  } catch (err) { automationError(res,err,'QTX dosyası indirilemedi.'); }
});

return fetchService;
};

function createPlmFetchService(deps){
  const {normalizePlmId,setModelOperationProgress,withPlmJob,agentBrowserConnector,getModelImageSettings,plmJobs,upsertPlmStyleLinks,userAccess,clearModelOperationProgress}=deps;
  async function fetch(profile,input={}, {request,assertAuthority=()=>{},allowAi=false}={}){
  try {
     const requestedScope=String(input.scope||'koleksiyon');
     const scope=['koleksiyon','cp','orders'].includes(requestedScope)?requestedScope:'koleksiyon';
     const selectedOnly = Boolean(input && input.selectedOnly === true);
     const language = String(input && input.language || '').toLowerCase()==='tr'?'tr':String(input && input.language || '').toLowerCase()==='en'?'en':'';
     const raw = Array.isArray(input && input.plmIds) ? input.plmIds : null;
     if (!selectedOnly && !raw) throw Object.assign(new Error('PLM IDs are required.'),{code:'VALIDATION_ERROR',statusCode:400});
     const plmIds = selectedOnly ? [] : [...new Set(raw.map(value => normalizePlmId(value)).filter(Boolean))].slice(0, 2000);
     if (!selectedOnly && !plmIds.length) throw Object.assign(new Error('Valid PLM IDs are required.'),{code:'PLM_ID_REQUIRED',statusCode:400});
     // selectedOnly modunda CoreNectum Style List'teki mevcut DOM checkbox'ları
     // connector okur; istemciden PLM ID listesi beklenmez.
     const items = selectedOnly ? [] : plmIds.map(plmId => ({ plmId, needImage: false }));
    setModelOperationProgress(profile.id, { kind: 'plm-sync', phase: 'PLM verisi aranıyor', current: 0, total: items.length, model: '' });
    /* İş kaydı: bu iş Koleksiyon kapsamına yazılır, böylece CP/Orders
       ekranlarında görünmez ama sayfa değişince de durmaz. */
    const fetchRun = await withPlmJob(request||{currentUser:profile}, {
       kind: 'plm-sync', scope, total: items.length,
       label: selectedOnly ? 'PLM seçili modelleri aktar' : `PLM verisi · ${items.length} model`, phase: 'PLM verisi aranıyor',
     }, async job => {
       const collected = await agentBrowserConnector.collectCoreNectumStyleLinks(profile.id, items, {
         ...getModelImageSettings(),
         selectedOnly,
         language,
         onProgress: progress => {
           setModelOperationProgress(profile.id, { kind: 'plm-sync', ...progress });
           job.report({
             phase: progress && progress.phase,
             processed: progress && progress.current,
             total: (progress && progress.total) || items.length,
             activeModel: progress && progress.model,
           });
         },
       });

       assertAuthority();
       /* BOM, Style List sonucundaki doğrulanmış styleId üzerinden okunur.
          Başarısız BOM/LCW AI analizi ana PLM alan senkronunu geri ALMAZ:
          plm-bom-sync eski başarılı kaydı korur ve yalnız hata raporlar. */
       const bomSync = await plmBomSync.syncPlmBoms(collected.links, {
         ownerId: profile.id,assertAuthority,allowAi,
         language,
         onProgress: progress => {
           setModelOperationProgress(profile.id, { kind: 'plm-sync', ...progress });
           job.report({
             phase: progress && progress.phase,
             processed: progress && progress.current,
             total: (progress && progress.total) || collected.links.length,
             activeModel: progress && progress.model,
           });
         },
       });
       collected.links = collected.links.map(record => {
         const plmId = String(record && record.plmId || '');
         const override = bomSync.recordOverrides && bomSync.recordOverrides.get(plmId);
         const base = override ? { ...record, ...override } : record;
         const entry = bomSync.entries.get(plmId);
         return entry ? {
           ...base,
           bomSummary: entry.summary,
           artworkSummary: entry.artworkSummary || (base && base.artworkSummary) || '',
           bomPrintCount: entry.totalPrintCount,
           bomHasPrint: entry.hasPrint,
           bomAiStatus: entry.ai && entry.ai.status || 'not-needed',
         } : base;
       });
       collected.bomSync = {
         requested: bomSync.requested,
         fetched: bomSync.fetched,
         changed: bomSync.changed,
         unchanged: bomSync.unchanged,
         withPrint: bomSync.withPrint,
         aiConsulted: bomSync.aiConsulted,
         aiResolved: bomSync.aiResolved,
         failed: bomSync.failed,
         revision: bomSync.revision,
         updatedAt: bomSync.updatedAt,
       };
       return collected;
     });
    const collected = fetchRun.result;assertAuthority();
    // Bulunamayan modeller işin başarısız listesine yazılır ki kullanıcı
    // ayrıntısını görebilsin ve YALNIZ onları yeniden deneyebilsin.
    for (const item of collected.failed || []) {
      plmJobs.addFailure(profile.id, fetchRun.job.id, {
        plmId: item && item.plmId, model: item && item.styleName,
        error: (item && item.error) || 'PLM listesinde bulunamadı.', code: (item && item.code) || 'PLM_NOT_FOUND',
      });
    }
    for (const item of (collected.bomSync && collected.bomSync.failed) || []) {
      plmJobs.addFailure(profile.id, fetchRun.job.id, {
        plmId: item && item.plmId,
        error: (item && item.error) || 'PLM BOM alınamadı.',
        code: (item && item.code) || 'PLM_BOM_FETCH_FAILED',
      });
    }
     plmJobs.update(profile.id, fetchRun.job.id, {
       processed: collected.requested || items.length, total: collected.requested || items.length,
       succeeded: collected.links.length,
     });
    // PLM linki sözlüğü de tazelensin — "PLM Link ve Görsellerini Bul"
    // ile ikinci bir ayrı istek gerekmesin. Başarısız olsa bile ana sonuç
    // (records) etkilenmemeli; bu tazeleme bir yan fayda, kritik yol değil.
    // styleLinks: upsert sonrası GÜNCEL TAM link deposu. İstemci bunu
    // applyPlmStyleLinksPayload'a verip link haritasını tazeler; böylece
    // "Model Linklerini PLM'den Al" için AYRI bir Style List taraması
    // (pahalı, dakikalar süren tam liste gezintisi) gerekmez.
    let styleLinks = null;
    try { styleLinks = upsertPlmStyleLinks(collected.links, profile); } catch (_) {}
    userAccess.appendAudit(profile, 'PLM_SYNC_FETCH', 'corenectum', {
      scope, requested: collected.requested, found: collected.links.length, failed: collected.failed.length,
      scannedPages: collected.scannedPages, scannedRows: collected.scannedRows,
      bomFetched: collected.bomSync && collected.bomSync.fetched || 0,
      bomWithPrint: collected.bomSync && collected.bomSync.withPrint || 0,
      bomAiConsulted: collected.bomSync && collected.bomSync.aiConsulted || 0,
      bomFailed: collected.bomSync && collected.bomSync.failed ? collected.bomSync.failed.length : 0,
    });
    return {
      ok: true, records: collected.links, failed: collected.failed,
      requested: collected.requested, found: collected.links.length,
      scannedPages: collected.scannedPages, scannedRows: collected.scannedRows,
      // Sırsız tanı izi: tarayıcı/profil/oturum/HTTP/kayıt aşamaları. Hata
      // hâlinde de aynı iz automationError üzerinden details.diagnostics olarak
      // döner, böylece "0 model" ile "oturum yok" karıştırılamaz.
      diagnostics: collected.diagnostics || [],
      bom: collected.bomSync || null,
      styleLinks, jobId: fetchRun.job.id,
    };

  }finally{clearModelOperationProgress(profile.id);}
  }
  return {fetch};
}
module.exports.createPlmFetchService=createPlmFetchService;
