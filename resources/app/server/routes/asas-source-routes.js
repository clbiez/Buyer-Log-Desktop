'use strict';

/* ASAS / LFL veri kaynağı modu ve yükleme route'ları
   server.js'ten birebir taşındı (davranış değişikliği yok). Kayıt, server.js'te
   blokların eskiden durduğu satırda yapılır; Express route SIRASI korunur.
   Bağımlılıklar kayıt anında enjekte edilir; çalışma sırasında yeniden atanan
   değerler (yok) canlı okuyucu fonksiyonla okunur. */
module.exports = function registerAsasSourceRoutes(app, deps) {
  const {
    apiError,
    cacheForUser,
    excelParseTimeoutMs,
    findLatestSourceFiles,
    fs,
    loadOverrides,
    path,
    publishSharedMasterChange,
    refreshAsasExcelBeforeRead,
    replaceAsasSourceMode,
    replaceLflSourceMode,
    requestRevision,
    runExcelTask,
    saveRuntimeModelSnapshot,
    sourceFolderForUser,
    sourceUserId,
    userAccess,
    withFabricDimensions,
  } = deps;


// ---- ASAS veri kaynağı: Excel (varsayılan) / Database (isteğe bağlı) ----
function currentAsasExcelFile(value) {
  const folder = sourceFolderForUser(value);
  if (!folder) return null;
  try { return findLatestSourceFiles(folder).asas || null; } catch (_) { return null; }
}
function safeAsasUploadName(value) {
  const original = path.basename(String(value || 'ASAS.xlsx')).replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').trim();
  const stem = original.replace(/\.xlsx$/i, '') || 'ASAS';
  const prefixed = /^asas/i.test(stem) ? stem : `ASAS - ${stem}`;
  return `${prefixed.slice(0, 160)}.xlsx`;
}
app.get('/api/asas-source', userAccess.requireArea('source'), (req, res) => {
  const ov = loadOverrides();
  const file = currentAsasExcelFile(req);
  const revision = Number(ov._revisions && ov._revisions.asasSourceMode) || 0;
  res.set('ETag', `"${revision}"`);
  res.json({
    mode: ov.asasSourceMode === 'database' ? 'database' : 'excel',
    revision,
    sourceFolder: sourceFolderForUser(req),
    sourceFile: file ? file.name : null,
  });
});
app.put('/api/asas-source', userAccess.requireArea('source'), userAccess.requirePermission('manageModelConnections'), (req, res) => {
  try {
    const mode = String(req.body && req.body.mode || '').toLowerCase();
    if (!['excel', 'database'].includes(mode)) return res.status(400).json({ error: 'mode yalnız excel veya database olabilir.', code: 'VALIDATION_ERROR' });
    const saved = replaceAsasSourceMode(mode, requestRevision(req));
    userAccess.appendAudit(req.currentUser, 'ASAS_SOURCE_CHANGE', 'settings', { mode: saved.mode });
    publishSharedMasterChange('asasSourceMode', req);
    const file = currentAsasExcelFile(req);
    res.set('ETag', `"${saved.revision}"`);
    res.json({ ...saved, sourceFolder: sourceFolderForUser(req), sourceFile: file ? file.name : null });
  } catch (err) { apiError(res, err, 'ASAS veri kaynağı değiştirilemedi.'); }
});
// LFL kaynağı: ASAS ile aynı çalışma kitabından beslenir, ama Excel/Database
// seçimi ASAS'tan bağımsızdır (ör. siparişler Database, LFL Excel olabilir).
app.get('/api/lfl-source', userAccess.requireArea('source'), (req, res) => {
  const ov = loadOverrides();
  const file = currentAsasExcelFile(req);
  const revision = Number(ov._revisions && ov._revisions.lflSourceMode) || 0;
  res.set('ETag', `"${revision}"`);
  res.json({
    mode: ov.lflSourceMode === 'database' ? 'database' : 'excel',
    revision,
    sourceFolder: sourceFolderForUser(req),
    sourceFile: file ? file.name : null,
  });
});
app.put('/api/lfl-source', userAccess.requireArea('source'), userAccess.requirePermission('manageModelConnections'), (req, res) => {
  try {
    const mode = String(req.body && req.body.mode || '').toLowerCase();
    if (!['excel', 'database'].includes(mode)) return res.status(400).json({ error: 'mode yalnız excel veya database olabilir.', code: 'VALIDATION_ERROR' });
    const saved = replaceLflSourceMode(mode, requestRevision(req));
    userAccess.appendAudit(req.currentUser, 'LFL_SOURCE_CHANGE', 'settings', { mode: saved.mode });
    publishSharedMasterChange('lflSourceMode', req);
    const file = currentAsasExcelFile(req);
    res.set('ETag', `"${saved.revision}"`);
    res.json({ ...saved, sourceFolder: sourceFolderForUser(req), sourceFile: file ? file.name : null });
  } catch (err) { apiError(res, err, 'LFL veri kaynağı değiştirilemedi.'); }
});
app.post('/api/asas-source/upload', userAccess.requireArea('source'), userAccess.requirePermission('manageModelConnections'), async (req, res) => {
  let temp = '';
  try {
    const id = sourceUserId(req);
    const folder = sourceFolderForUser(id);
    if (!folder) {
      const error = new Error('ASAS Excel yüklemek için önce Kaynak Klasör seçin.');
      error.statusCode = 400; error.code = 'SOURCE_FOLDER_MISSING'; throw error;
    }
    const dataBase64 = String(req.body && req.body.dataBase64 || '');
    if (!dataBase64) return res.status(400).json({ error: 'dataBase64 alanı zorunlu.', code: 'VALIDATION_ERROR' });
    const buffer = Buffer.from(dataBase64, 'base64');
    if (!buffer.length || buffer.length > 100 * 1024 * 1024) return res.status(400).json({ error: 'ASAS Excel dosyası boş veya çok büyük.', code: 'VALIDATION_ERROR' });
    fs.mkdirSync(folder, { recursive: true });
    const filename = safeAsasUploadName(req.body && req.body.name);
    const target = path.join(folder, filename);
    temp = target.replace(/\.xlsx$/i, `.upload-${process.pid}-${Date.now()}.xlsx`);
    await fs.promises.writeFile(temp, buffer);

    // Yüklenen çalışma kitabı önce gerçek Excel'de açılıp pivot/veri bağlantıları
    // yenilenmeye çalışılır. Bu adım başarısız olursa (ör. Excel/COM erişilemiyor)
    // yüklemeyi tamamen reddetmek yerine dosyanın kendi son kaydedilmiş (yenilenmemiş)
    // hâliyle devam edilir; kullanıcı açık bir uyarıyla bilgilendirilir.
    let excelRefresh = null;
    let refreshFailureWarning = null;
    try {
      excelRefresh = await refreshAsasExcelBeforeRead({ name: filename, full: temp });
    } catch (err) {
      excelRefresh = { ok: false, source: 'ASAS', name: filename, error: (err && (err.publicMessage || err.message)) || String(err) };
      refreshFailureWarning = `ASAS Excel pivot tabloları yenilenemedi; veri sunucudan güncellenmedi, "${filename}" dosyasının yüklenen son kaydedilmiş hali kullanıldı. ${excelRefresh.error}`;
    }
    const stat = fs.statSync(temp);
    const parsedResult = await runExcelTask('parseAsasFile', {
      fullPath: temp,
      matchRule: loadOverrides().antrepoMatchConfig,
    }, { timeoutMs: excelParseTimeoutMs(stat.size) });
    const parsedAsas = parsedResult && parsedResult.parsedAsas;
    if (!parsedAsas || !Array.isArray(parsedAsas.orders)) {
      const error = new Error(`ASAS Excel dosyasında "Sipariş Kod" sütunu bulunamadı: ${filename}.`);
      error.statusCode = 422; error.code = 'ASAS_EXCEL_MAPPING_INVALID'; throw error;
    }
    const parsedLfl = parsedResult && parsedResult.parsedLfl && Array.isArray(parsedResult.parsedLfl.rows) ? parsedResult.parsedLfl : null;

    try { if (fs.existsSync(target)) fs.unlinkSync(target); } catch (_) { /* rename gerçek hatayı versin */ }
    fs.renameSync(temp, target);
    temp = '';

    const modeSaved = replaceAsasSourceMode('excel');
    const runtime = cacheForUser(id);
    runtime.asasOrders = parsedAsas.orders;
    runtime.asasOrdersByTarget = { ...(runtime.asasOrdersByTarget || {}), cp: parsedAsas.orders, orders: parsedAsas.orders, backlog: parsedAsas.orders, priceanalysis: parsedAsas.orders };
    runtime.fabricHeaderInfo = parsedAsas.fabricHeaderInfo || null;
    runtime.sources = { ...(runtime.sources || {}), asas: `Excel: ${filename}` };
    if (parsedLfl) {
      runtime.lflRows = parsedLfl.rows;
      runtime.lflMeta = withFabricDimensions(parsedLfl.meta, parsedLfl.rows);
      runtime.lflLoadedAt = new Date().toISOString();
      runtime.sources.lfl = `Excel: ${filename}`;
    }
    runtime.refreshWarnings = [
      ...(refreshFailureWarning ? [refreshFailureWarning] : []),
      ...(parsedResult && parsedResult.lflError
        ? [`LFL aynı ASAS Excel kaynağından üretilemedi; son başarılı LFL verisi korundu: ${parsedResult.lflError}`]
        : []),
    ];
    runtime.refreshWarningDetails = [];
    await saveRuntimeModelSnapshot(id, runtime);
    userAccess.appendAudit(req.currentUser, 'ASAS_EXCEL_UPLOAD', filename, { rows: parsedAsas.orders.length });
    publishSharedMasterChange('asasSourceMode', req);
    res.json({
      ok: true, mode: 'excel', revision: modeSaved.revision,
      sourceFolder: folder, sourceFile: filename,
      rowCount: parsedAsas.orders.length,
      lflRowCount: parsedLfl ? parsedLfl.rows.length : 0,
      pivotRefreshed: !refreshFailureWarning,
      excelRefresh,
      warning: refreshFailureWarning || null,
    });
  } catch (err) {
    if (temp) { try { fs.unlinkSync(temp); } catch (_) {} }
    apiError(res, err, 'ASAS Excel dosyası yüklenemedi.');
  }
});

};
