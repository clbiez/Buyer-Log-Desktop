'use strict';

/* Veri modeli bağlantıları route'ları (şema, sorgu, çalıştırma)
   server.js'ten birebir taşındı (davranış değişikliği yok). Kayıt, server.js'te
   blokların eskiden durduğu satırda yapılır; Express route SIRASI korunur.
   Bağımlılıklar kayıt anında enjekte edilir; çalışma sırasında yeniden atanan
   değerler (yok) canlı okuyucu fonksiyonla okunur. */
module.exports = function registerModelConnectionRoutes(app, deps) {
  const {
    MODEL_EXPORT_ROOT,
    alignHorizonWithMapping,
    apiError,
    ensureConnectionMapping,
    express,
    fs,
    intakeLiveFields,
    intakeSafeSourceMessage,
    intakeStore,
    loadModelConnections,
    logRuntimeFailure,
    modelApiError,
    modelExportPath,
    modelFields,
    modelHorizon,
    modelQuery,
    modelRunInFlight,
    queryModelDistinctValues,
    recordModelConnectionRun,
    replaceModelConnections,
    resolveColumnTypes,
    userAccess,
  } = deps;


// Bağlantıyı sınar ve modeldeki tabloları listeler. Veri çekmez; yalnız şema okur.
// TMSCHEMA görünümleri yönetici yetkisi istediği için, erişilemezse Excel'in de
// kullandığı MDSCHEMA görünümlerine düşülür (bkz. lib/modelQuery.js).
app.post('/api/model-connections/inspect', userAccess.requireArea('source'), userAccess.requirePermission('manageModelConnections'), async (req, res) => {
  const body = req.body || {};
  try {
    const found = await modelQuery.discoverTables({ server: body.server, catalog: body.catalog });
    res.json({
      ok: true, provider: found.provider, elapsedMs: found.elapsedMs,
      tableCount: found.tables.length, tables: found.tables,
      method: found.method, methodNote: found.methodNote, attempts: found.attempts,
    });
  } catch (err) {
    logRuntimeFailure('modelInspect', err);
    modelApiError(res, err, 'Veri modeline bağlanılamadı.');
  }
});

// Seçilen tablonun sütun adları. Sorguyu yazarken alan adlarını görebilmek için.
app.post('/api/model-connections/columns', userAccess.requireArea('source'), userAccess.requirePermission('manageModelConnections'), async (req, res) => {
  const body = req.body || {};
  try {
    const found = await modelQuery.discoverColumns({ server: body.server, catalog: body.catalog, table: body.table });
    res.json({ ok: true, ...found });
  } catch (err) {
    logRuntimeFailure('modelColumns', err);
    modelApiError(res, err, 'Tablo sütunları okunamadı.');
  }
});

// Uygulamanın bir rol için beklediği alanların kataloğu. Arayüz listeyi burada
// tanımlı tek kaynaktan alır; iki yerde ayrı liste tutulmaz.
app.get('/api/model-fields', async (req, res) => {
  const role = String(req.query.role || 'asas');
  if (role !== 'intake') return res.json({ role, fields: modelFields.fieldsForRole(role), derived: modelFields.DERIVED_FIELDS });
  let fields = modelFields.fieldsForRole(role), source = 'defaults', warning = '';
  try {
    const found = await intakeLiveFields();
    fields = modelFields.intakeFieldsForMapping(found.fields);
    source = 'database';
  } catch (error) {
    const snapshot = intakeStore.loadSnapshot(req.currentUser.id);
    if (snapshot && Array.isArray(snapshot.fields) && snapshot.fields.length) {
      fields = modelFields.intakeFieldsForMapping(snapshot.fields);
      source = 'snapshot';
    }
    warning = intakeSafeSourceMessage();
  }
  res.set('Cache-Control','no-store').json({ role, fields, derived: [], source, warning });
});

// Seçilen tablonun sütunlarını okuyup katalogla otomatik eşleştirir.
// Modelin tamamını tarar: bütün tabloların sütunları + bütün ölçüler. Tek bir tabloya
// bakmak yetmez, çünkü FOB ve miktar alanları genelde ayrı bir ölçü grubunda durur.
app.post('/api/model-connections/automap', userAccess.requireArea('source'), userAccess.requirePermission('manageModelConnections'), async (req, res) => {
  const body = req.body || {};
  try {
    const schema = await modelQuery.discoverSchema({ server: body.server, catalog: body.catalog });
    const role = body.role || 'asas';
    const mapped = modelFields.autoMapSchema(role, schema);
    res.json({
      ok: true, ...mapped,
      /* v7.81 — hangi ZORUNLU alanların bulunamadığı. "37 alan eşlendi" demek
         yetmiyordu: eksik olan tek bir zorunlu alan yenilemeyi tamamen
         durdurur ve kullanıcı bunu ancak yenilemede öğreniyordu. */
      missingRequired: modelFields.missingRequired(role, mapped.mapping),
      columns: schema.columns, measures: schema.measures,
      schemaErrors: schema.errors, provider: schema.provider || '',
    });
  } catch (err) {
    logRuntimeFailure('modelAutomap', err);
    modelApiError(res, err, 'Alanlar eşleştirilemedi.');
  }
});

/* v7.38 — KULLANICI KAPSAMI SEÇİM LİSTELERİNİ ASAS'TAN TAZELE.

   Kullanıcı bulgusu: kullanıcı ayarlarında MAG/MMYG listeleri boş, Buyer Grup
   listesinde yalnız bir kısmı var. Sebep, kataloğun okunmuş (ve kaynak
   filtresinden geçmiş) sipariş satırlarından kurulmasıydı. Burası tekil
   değerleri veri modelinden DOĞRUDAN okur; ufuk/kaynak filtresi uygulanmaz.

   Alan başına AYRI ayrı denenir ve sonuç alan başına bildirilir: biri
   okunamazsa diğerleri yine gelir ve okunamayanın SEBEBİ yazılır — sessizce
   eksik liste göstermek, kullanıcının "veriler gelmiyor" demesine yol açan
   durumun ta kendisiydi (§152). */
const USER_SCOPE_CATALOG_FIELDS = [
  { key: 'mags', header: 'Merch Alt Grup Kod', label: 'MAG' },
  { key: 'mmygs', header: 'Merch Marka Yaş Grup Kod', label: 'MMYG' },
  { key: 'buyingGroups', header: 'Buyer Grup (TR)', label: 'Buying Group' },
];
function userScopeCatalogSource(item, header) {
  const mapping = (item && item.mapping) || {};
  const direct = mapping[header];
  if (direct && direct.name) return { table: direct.table || (item.horizon && item.horizon.table) || '', name: direct.name };
  const custom = (Array.isArray(item && item.customFields) ? item.customFields : [])
    .find(field => field && String(field.header || '').trim() === header);
  if (custom && custom.column && custom.column.name) {
    return { table: custom.column.table || (item.horizon && item.horizon.table) || '', name: custom.column.name };
  }
  return null;
}
app.post('/api/user-scope-catalog/refresh', userAccess.requireArea('source'), userAccess.requirePermission('manageModelConnections'), express.json({ limit: '16kb' }), async (req, res) => {
  try {
    const connections = loadModelConnections().items.filter(item => item && item.role === 'asas' && item.server && item.catalog);
    if (!connections.length) {
      return res.status(409).json({ error: 'ASAS Data Model bağlantısı bulunamadı. Seçim listeleri ancak model bağlantısından okunabilir.', code: 'ASAS_CONNECTION_MISSING' });
    }
    const limit = 20000;
    const values = { mags: [], mmygs: [], buyingGroups: [] };
    const fields = [];
    for (const field of USER_SCOPE_CATALOG_FIELDS) {
      let read = 0, failure = '', source = '';
      for (const item of connections) {
        const column = userScopeCatalogSource(item, field.header);
        if (!column || !column.table || !column.name) {
          if (!failure) failure = `"${field.header}" alanı bu bağlantıda eşlenmemiş.`;
          continue;
        }
        source = `${column.table}[${column.name}]`;
        try {
          const dax = `'${column.table.replace(/'/g, "''")}'[${column.name.replace(/]/g, ']]')}]`;
          const result = await modelQuery.runModelRows({
            server: item.server, catalog: item.catalog,
            query: `EVALUATE TOPN(${limit}, DISTINCT(${dax}), ${dax}, ASC)`,
            generated: true, maxRows: limit, timeoutMs: 120000,
          });
          for (const row of result.rows || []) {
            const first = Object.values(row)[0];
            const text = first == null ? '' : String(first).trim();
            if (text) values[field.key].push(text);
          }
          read = values[field.key].length;
          failure = '';
        } catch (err) { if (!failure) failure = err && err.message ? err.message : String(err); }
      }
      fields.push({ key: field.key, label: field.label, header: field.header, count: read, source, error: failure });
    }
    const merged = userAccess.mergeCatalogValues(values);
    const catalog = merged.catalog || {};
    userAccess.appendAudit(req.currentUser, 'USER_SCOPE_CATALOG_REFRESH', 'asas', {
      mags: (catalog.mags || []).length, mmygs: (catalog.mmygs || []).length, buyingGroups: (catalog.buyingGroups || []).length,
    });
    res.json({
      ok: true, changed: merged.changed, fields,
      totals: { mags: (catalog.mags || []).length, mmygs: (catalog.mmygs || []).length, buyingGroups: (catalog.buyingGroups || []).length },
    });
  } catch (err) { apiError(res, err, 'Seçim listeleri ASAS’tan tazelenemedi.'); }
});

// Şemayı ham haliyle döndürür (eşleme tablosundaki açılır listeleri doldurmak için).
app.post('/api/model-connections/schema', userAccess.requireArea('source'), userAccess.requirePermission('manageModelConnections'), async (req, res) => {
  const body = req.body || {};
  try {
    const schema = await modelQuery.discoverSchema({ server: body.server, catalog: body.catalog });
    res.json({ ok: true, ...schema });
  } catch (err) {
    logRuntimeFailure('modelSchema', err);
    modelApiError(res, err, 'Model şeması okunamadı.');
  }
});

// Bir sütunun modeldeki tekil değerleri. Ufuk koşullarında değer ELLE yazılmasın,
// CP/LFL sayfalarındaki sütun filtresi gibi listeden seçilsin diye.
app.post('/api/model-connections/distinct', userAccess.requireArea('source'), userAccess.requirePermission('manageModelConnections'), async (req, res) => {
  const body = req.body || {};
  try {
    const table = String(body.table || '').trim();
    const field = String(body.field || '').trim();
    if (!table || !field) return res.status(400).json({ error: 'Tablo ve sütun zorunlu.', code: 'VALIDATION_ERROR' });
    const limit = Math.min(20000, Math.max(50, Number(body.limit) || 5000));
    // Page Horizon ve Settings aynı sorgu/cache yolunu kullanır; böylece iki
    // ekranda farklı veya farklı genişlikte seçenek listeleri oluşmaz.
    const distinct = await queryModelDistinctValues(body, limit);
    res.json(distinct);
  } catch (err) {
    logRuntimeFailure('modelDistinct', err);
    modelApiError(res, err, 'Sütun değerleri okunamadı.');
  }
});

// Ufuk ayarından üretilecek DAX'ı, çalıştırmadan önce göstermek için.
app.post('/api/model-connections/preview-query', userAccess.requireArea('source'), userAccess.requirePermission('manageModelConnections'), async (req, res) => {
  const body = req.body || {};
  try {
    const mapping = body.mapping && Object.keys(body.mapping).length ? body.mapping : null;
    const transient = { name: 'Sorgu önizlemesi', role: body.role || 'asas', horizon: { ...(body.horizon || {}) } };
    const aligned = mapping ? alignHorizonWithMapping(transient, mapping) : { horizon: transient.horizon, warnings: [] };
    // Önizleme, yenilemenin GÖNDERECEĞİ DAX'ı göstermeli. Şema tipi burada
    // çözülmezse ekranda metin literali görünür, yenileme sayısal literal
    // gönderir; kullanıcı hatayı önizlemede hiç göremez.
    const columnType = await resolveColumnTypes({ server: body.server, catalog: body.catalog });
    const built = mapping
      ? modelHorizon.buildMappedQuery(aligned.horizon, mapping, { topN: Number(body.topN) || 0, columnType })
      : modelHorizon.buildHorizonQuery(aligned.horizon, { topN: Number(body.topN) || 0, columnType });
    const leftOut = modelHorizon.seasonsLeftOut(aligned.horizon, body.knownSeasons);
    const missing = mapping ? modelFields.missingRequired(body.role || 'asas', mapping) : [];
    res.json({
      ok: true, query: built.query, warnings: [...(aligned.warnings || []), ...(built.warnings || [])],
      usedSeasons: built.usedSeasons, usedDates: built.usedDates,
      seasonsLeftOut: leftOut, missingRequired: missing,
    });
  } catch (err) { modelApiError(res, err, 'Sorgu oluşturulamadı.'); }
});

// Ufuk kaç satır getirecek? Veri çekmeden yalnız sayar.
app.post('/api/model-connections/count', userAccess.requireArea('source'), userAccess.requirePermission('manageModelConnections'), async (req, res) => {
  const body = req.body || {};
  try {
    const mapping = body.mapping && Object.keys(body.mapping).length ? body.mapping : null;
    const transient = { name: 'Satır sayımı', role: body.role || 'asas', horizon: { ...(body.horizon || {}) } };
    const aligned = mapping ? alignHorizonWithMapping(transient, mapping) : { horizon: transient.horizon, warnings: [] };
    // v7.26: sayım sorgusu da alan eşlemesini bilmeli; aksi halde ASAS
    // başlığıyla kurulmuş bir koşul modelde var olmayan sütuna filtre koyar.
    // v7.83: sayım sorgusu da sütun tipini şemadan çözer; aksi halde veri
    // sorgusu çalışırken sayım tip hatasıyla düşerdi.
    const columnType = await resolveColumnTypes({ server: body.server, catalog: body.catalog });
    const built = modelHorizon.buildCountQuery(aligned.horizon, mapping, { columnType });
    const result = await modelQuery.runModelRows({
      server: body.server, catalog: body.catalog, query: built.query, generated: true, timeoutMs: 120000, maxRows: 10,
    });
    const first = result.rows[0] || {};
    const rowCount = Number(first.SatirSayisi != null ? first.SatirSayisi : Object.values(first)[0]) || 0;
    res.json({ ok: true, rowCount, elapsedMs: result.elapsedMs, provider: result.provider, query: built.query, warnings: [...(aligned.warnings || []), ...(built.warnings || [])] });
  } catch (err) {
    logRuntimeFailure('modelCount', err);
    modelApiError(res, err, 'Satır sayısı okunamadı.');
  }
});

/* ELLE YAZILAN DAX'I KAYDETMEDEN SINA (§7).

   Manuel sorgunun tek doğruluk kaynağı motorun kendisidir; DAX'ı sunucuda
   ayrıştırmak ikinci bir dil yorumlayıcısı yazmak olurdu. Bu uç sorguyu
   GERÇEKTEN çalıştırır ama YALNIZ birkaç satır ister ve hiçbir şey yazmaz:
   /run gibi dışa aktarma klasörüne dosya bırakmaz, önbelleğe dokunmaz.

   Kaydetmeden önce sınamanın nedeni: hatalı bir manuel sorgu kaydedilirse
   bir sonraki yenileme çöker ve kullanıcı hatayı ancak o zaman görür. */
app.post('/api/model-connections/try-query', userAccess.requireArea('source'), userAccess.requirePermission('manageModelConnections'), express.json({ limit: '256kb' }), async (req, res) => {
  const body = req.body || {};
  try {
    const text = String(body.query == null ? '' : body.query);
    if (!text.trim()) return res.status(400).json({ error: 'Sınanacak sorgu boş.', code: 'QUERY_REQUIRED' });
    const maxRows = Math.min(Math.max(Number(body.maxRows) || 5, 1), 50);
    const result = await modelQuery.runModelRows({
      server: body.server, catalog: body.catalog, query: text,
      // generated:false → kullanıcının yazdığı metin; motor onu olduğu gibi çalıştırır.
      generated: false, timeoutMs: 120000, maxRows,
    });
    const rows = result.rows || [];
    res.json({
      ok: true,
      rowCount: rows.length,
      /* Sütun adları da döner: manuel sorgunun uygulamanın beklediği başlıkları
         üretip üretmediğini kullanıcı ancak böyle görebilir. */
      columns: rows.length ? Object.keys(rows[0]) : [],
      sample: rows.slice(0, 5),
      elapsedMs: result.elapsedMs,
      provider: result.provider,
      truncated: rows.length >= maxRows,
    });
  } catch (err) {
    logRuntimeFailure('modelTryQuery', err);
    modelApiError(res, err, 'Sorgu çalıştırılamadı.');
  }
});

// Kayıtlı bir bağlantının sorgusunu çalıştırır, sonucu dışa aktarma klasörüne yazar.
app.post('/api/model-connections/run', userAccess.requireArea('source'), userAccess.requirePermission('manageModelConnections'), async (req, res) => {
  const body = req.body || {};
  const store = loadModelConnections();
  const saved = body.id ? store.items.find(item => item.id === String(body.id)) : null;
  if (body.id && !saved) return res.status(404).json({ error: 'Bağlantı bulunamadı.', code: 'MODEL_CONNECTION_NOT_FOUND' });

  const server = saved ? saved.server : body.server;
  const catalog = saved ? saved.catalog : body.catalog;
  // Otomatik modda sorgu ufuk ayarından üretilir; manuel modda kullanıcının yazdığı DAX çalışır.
  let mode = body.mode || (saved && saved.mode) || 'auto';
  let horizon = body.horizon || (saved && saved.horizon) || null;
  let query = body.query != null && String(body.query).trim() ? body.query : (saved ? saved.query : '');
  let horizonWarnings = [];
  let headerMap = null;
  const role = body.role || (saved && saved.role) || 'asas';
  let mapping = (body.mapping && Object.keys(body.mapping).length ? body.mapping : null)
    || (saved && saved.mapping && Object.keys(saved.mapping).length ? saved.mapping : null);
  const brokenManualQuery = mode === 'manual' && /\[object Object\]/i.test(String(query || ''));
  let connectionSettingsChanged = false;
  if ((mode !== 'manual' || brokenManualQuery) && horizon && String(horizon.table || '').trim()) {
    // Kayıtlı eski eşleme [object Object] biçiminde bozulmuşsa Test/Run işlemi de
    // ana Refresh gibi şemayı tarayıp kendiliğinden onarır.
    const transientConnection = {
      ...(saved || {}), ...body,
      server, catalog, role, horizon,
      mapping: mapping || {},
      mode, query,
    };
    try {
      const repair = await ensureConnectionMapping(transientConnection);
      mapping = transientConnection.mapping;
      mode = transientConnection.mode || mode;
      query = transientConnection.query || query;
      if (repair.repaired) connectionSettingsChanged = true;
      horizonWarnings.push(...(repair.warnings || []));
      if (mapping) {
        const aligned = alignHorizonWithMapping(transientConnection, mapping);
        horizon = aligned.horizon;
        horizonWarnings.push(...(aligned.warnings || []));
        if (aligned.repaired) connectionSettingsChanged = true;
      }
    } catch (err) { return modelApiError(res, err, 'Alan eşlemesi otomatik onarılamadı.'); }
    if (connectionSettingsChanged && saved) {
      const repairedItems = store.items.map(item => item.id === saved.id
        ? { ...item, mapping, mode: transientConnection.mode, query: transientConnection.query, horizon: transientConnection.horizon, mappingEnhancementScanVersion: transientConnection.mappingEnhancementScanVersion }
        : item);
      try {
        replaceModelConnections(repairedItems, store.revision);
      } catch (err) {
        horizonWarnings = [
          ...horizonWarnings,
          `Alan eşlemesi otomatik onarıldı ancak kaydedilemedi: ${String(err && err.message || err)}`,
        ];
      }
    }
    const missing = mapping ? modelFields.missingRequired(role, mapping) : [];
    if (mapping && missing.length) {
      return res.status(400).json({
        error: `Zorunlu alanlar eşleştirilmedi: ${missing.join(', ')}`,
        code: 'MAPPING_INCOMPLETE', missingRequired: missing,
      });
    }
    try {
      // Test/Run, ana yenilemeyle AYNI predicate'i üretmeli: sütun tipi
      // kaynağın kendi şemasından çözülür (best-effort; okunamazsa kayıtlı
      // valueType ile bugünkü davranışa düşülür).
      const columnType = await resolveColumnTypes({ server, catalog });
      const built = mapping
        ? modelHorizon.buildMappedQuery(horizon, mapping, { topN: Number(body.topN) || 0, columnType })
        : modelHorizon.buildHorizonQuery(horizon, { topN: Number(body.topN) || 0, columnType });
      query = built.query;
      headerMap = built.headerMap || null;
      horizonWarnings = [...horizonWarnings, ...(built.warnings || [])];
    } catch (err) { return modelApiError(res, err, 'Ufuk ayarından sorgu oluşturulamadı.'); }
  }
  const format = (body.format || (saved && saved.format) || 'csv') === 'json' ? 'json' : 'csv';
  const outputName = body.outputName || (saved && saved.outputName) || (saved && saved.name) || `${catalog || 'model'}`;
  const runKey = `${server}|${catalog}`;

  if (modelRunInFlight.has(runKey)) {
    return res.status(409).json({ error: 'Bu model için bir sorgu zaten çalışıyor.', code: 'OPERATION_IN_PROGRESS' });
  }
  modelRunInFlight.add(runKey);
  try {
    fs.mkdirSync(MODEL_EXPORT_ROOT, { recursive: true });
    const outFile = modelExportPath(outputName, format);
    const summary = await modelQuery.runModelQuery({
      server, catalog, query, format, outFile, headerMap,
      previewRows: Math.min(25, Math.max(0, Number(body.previewRows) || 10)),
      maxRows: body.maxRows, timeoutMs: body.timeoutMs,
    });
    const lastRun = {
      at: new Date().toISOString(), ok: true, rowCount: summary.rowCount,
      elapsedMs: summary.elapsedMs, provider: summary.provider, outFile: summary.outFile, error: '',
    };
    if (saved) recordModelConnectionRun(saved.id, lastRun);
    userAccess.appendAudit(req.currentUser, 'MODEL_QUERY_RUN', `${server}/${catalog}`, { rowCount: summary.rowCount, elapsedMs: summary.elapsedMs });
    res.json({ ok: true, ...summary, lastRun, query, mode, horizonWarnings });
  } catch (err) {
    if (saved) {
      try {
        recordModelConnectionRun(saved.id, {
          at: new Date().toISOString(), ok: false, rowCount: 0, elapsedMs: 0,
          provider: err && err.provider || '', outFile: '', error: String(err && err.message || ''),
        });
      } catch (_) { /* son çalıştırma bilgisi yazılamazsa asıl hatayı gölgeleme */ }
    }
    logRuntimeFailure('modelRun', err);
    modelApiError(res, err, 'Model sorgusu çalıştırılamadı.');
  } finally { modelRunInFlight.delete(runKey); }
});

};
