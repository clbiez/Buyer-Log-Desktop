'use strict';

/* FOB Sonrası Maliyet raporu route'ları (Genel Bakış › Ticari widget'ı).
 *
 * INTAKE ile aynı erişim sınırı: Genel Bakış alanı + OAB.VIEW merkezi yetkisi.
 * Model sorgusu kullanıcının kendi Windows kimliğiyle (SSPI) çalışır; küp
 * tarafındaki yetki ayrıca geçerlidir. Önbellek anahtarı kullanıcıyı içerir:
 * bir kullanıcının model yetkisiyle çekilen satırlar başka kullanıcıya dönmez.
 */

const path = require('path');
const report = require('../lib/postfob-report');
const intakeReport = require('../lib/intake-report');
const { createIntakeStore } = require('../lib/intake-store');
const { SERVER_DATA_ROOT } = require('../user-data');
const canonical = require('../lib/canonical-fields');

const VIEW_PREF_KEY = 'lcw.postfob.view.v1';
const RECOVERABLE_ERRORS = new Set([
  'MODEL_QUERY_FAILED', 'MODEL_QUERY_TIMEOUT', 'MODEL_QUERY_UNSUPPORTED',
  'MODEL_QUERY_NO_RESULT', 'MODEL_SCHEMA_UNAVAILABLE', 'MODEL_QUERY_OUT_OF_MEMORY',
]);
const SOURCE_MESSAGE = {
  tr: 'FOB sonrası maliyet modeline şu anda ulaşılamıyor. Şirket ağı veya VPN bağlantısını kontrol edin.',
  en: 'The post-FOB cost model is unreachable right now. Check the company network or VPN connection.',
};

module.exports = function registerPostFobRoutes(app, deps) {
  const {
    BLBusinessRules,
    cacheForUser,
    express,
    loadModelConnections,
    modelQuery,
    userAccess,
    userPreferences,
  } = deps;
  const store = deps.store || createIntakeStore({ root: path.join(SERVER_DATA_ROOT, 'postfob-cache'), ttlMinutes: 30 });
  const guard = [userAccess.requireAnyArea('overview'), userAccess.requireCapability('OAB.VIEW')];

  const connection = () => report.resolveConnection(loadModelConnections().items);
  function storedView(userId) {
    const entry = userPreferences.load(userId).entries[VIEW_PREF_KEY];
    if (!entry || !entry.value) return report.normalizeView(null);
    try { return report.normalizeView(JSON.parse(entry.value)); } catch (_) { return report.normalizeView(null); }
  }
  function saveView(userId, view) {
    const next = report.normalizeView(view);
    userPreferences.merge(userId, { [VIEW_PREF_KEY]: { value: JSON.stringify(next), updatedAt: new Date().toISOString() } });
    return next;
  }
  async function liveFields(target = connection()) {
    const schema = await modelQuery.discoverSchema({ server: target.server, catalog: target.catalog });
    return { fields: intakeReport.allowedSchema(schema), connection: target };
  }
  function failure(err) {
    const code = String(err && err.code || '');
    if (code.startsWith('POSTFOB_')) return { status: Number(err.statusCode) || 400, code, error: String(err.message || code) };
    return { status: 502, code: 'POSTFOB_SOURCE_UNAVAILABLE', error: SOURCE_MESSAGE.tr, errorEn: SOURCE_MESSAGE.en };
  }
  function logFailure(route, err) {
    const detail = String(err && err.message || err || '').replace(/\s+/g, ' ').slice(0, 300);
    console.error(`[${new Date().toISOString()}] [POSTFOB] ${route} failed code=${String(err && err.code || 'UNKNOWN')} error=${detail}`);
  }
  /* Arama için sipariş kodundan Buyer Log'un yüklü ASAS verisindeki özel kod ve
     model adı eklenir (küpte bu alanlar yok). Kanonik alan bağları üzerinden
     okunur; yalnız yanıt anında yapılır, önbelleğe yazılmaz — ASAS yenilenince
     güncel değer gelir. Kullanıcının ASAS kapsamında olmayan sipariş boş kalır. */
  function orderCodeKey(value) { return String(value == null ? '' : value).replace(/\D+/g, ''); }
  function enrich(req, rows) {
    if (typeof cacheForUser !== 'function' || !Array.isArray(rows) || !rows.length) return rows;
    let asas = [];
    try { const cache = cacheForUser(req); asas = Array.isArray(cache && cache.asasOrders) ? cache.asasOrders : []; } catch (_) { asas = []; }
    if (!asas.length) return rows;
    const byOrder = new Map();
    for (const row of asas) {
      const key = orderCodeKey(canonical.value(row, 'orders', 'orderCode'));
      if (!key) continue;
      const entry = byOrder.get(key) || { special: new Set(), model: new Set() };
      const special = String(canonical.value(row, 'orders', 'specialCode') ?? '').trim();
      const model = String(canonical.value(row, 'orders', 'modelName') ?? '').trim();
      if (special) entry.special.add(special);
      if (model) entry.model.add(model);
      byOrder.set(key, entry);
    }
    return rows.map(row => {
      const entry = byOrder.get(orderCodeKey(row && row.order));
      if (!entry) return row;
      return { ...row, specialCode: [...entry.special].join(' / '), modelName: [...entry.model].join(' / ') };
    });
  }
  function snapshotPayload(snapshot, req) {
    if (!snapshot) return null;
    const meta = snapshot.viewConfig && typeof snapshot.viewConfig === 'object' ? snapshot.viewConfig : {};
    return { rows: req ? enrich(req, snapshot.rows) : snapshot.rows, fetchedAt: snapshot.fetchedAt, filterValues: meta.filterValues || {}, missing: meta.missing || [], truncated: Boolean(meta.truncated), rowLimit: meta.rowLimit || report.POSTFOB_MAX_ROWS, horizonApplied: Boolean(meta.horizonApplied) };
  }

  app.get('/api/postfob/state', ...guard, (req, res) => {
    try {
      const target = connection();
      res.set('Cache-Control', 'no-store').json({
        ok: true, view: storedView(req.currentUser.id), catalog: report.catalog(),
        connection: { name: target.name, server: target.server, catalog: target.catalog, source: target.source },
        horizon: Boolean(report.resolveHorizon(loadModelConnections().items)),
        snapshot: snapshotPayload(store.loadSnapshot(req.currentUser.id), req),
      });
    } catch (err) { logFailure('state', err); const out = failure(err); res.status(out.status).json(out); }
  });

  app.put('/api/postfob/view', ...guard, express.json({ limit: '64kb' }), (req, res) => {
    try { res.json({ ok: true, view: saveView(req.currentUser.id, req.body && req.body.view) }); }
    catch (err) { logFailure('view', err); const out = failure(err); res.status(out.status).json(out); }
  });

  app.get('/api/postfob/metadata', ...guard, async (req, res) => {
    try {
      const found = await liveFields();
      res.set('Cache-Control', 'no-store').json({ ok: true, ...report.metadata(found.fields) });
    } catch (err) { logFailure('metadata', err); const out = failure(err); res.status(out.status).json(out); }
  });

  app.post('/api/postfob/distinct', ...guard, express.json({ limit: '16kb' }), async (req, res) => {
    try {
      const key = String(req.body && req.body.key || '').trim();
      const found = await liveFields();
      const field = report.resolveFilterField(found.fields, { key, source: req.body && req.body.source });
      if (!field) throw Object.assign(new Error('Filtre alanı canlı modelde bulunamadı.'), { code: 'POSTFOB_FILTER_UNAVAILABLE', statusCode: 422 });
      const search = String(req.body && req.body.search || '');
      const plan = report.distinctQuery(field, { search, limit: req.body && req.body.limit });
      const result = await modelQuery.runModelRows({ server: found.connection.server, catalog: found.connection.catalog, query: plan.query, generated: true, maxRows: plan.limit, timeoutMs: 120000 });
      const needle = search.trim().toLocaleLowerCase('tr-TR');
      const values = [...new Set((result.rows || []).map(row => String(Object.values(row || {})[0] ?? '').trim()).filter(Boolean))]
        .filter(value => plan.searchInDax || !needle || value.toLocaleLowerCase('tr-TR').includes(needle))
        .sort(BLBusinessRules.compareChronologicalValues);
      res.json({ ok: true, key, values });
    } catch (err) { logFailure('distinct', err); const out = failure(err); res.status(out.status).json(out); }
  });

  app.post('/api/postfob/report', ...guard, express.json({ limit: '64kb' }), async (req, res) => {
    const userId = req.currentUser.id;
    const previous = store.loadSnapshot(userId);
    try {
      const view = saveView(userId, { ...storedView(userId), ...(req.body && req.body.view ? req.body.view : {}) });
      const found = await liveFields();
      const horizon = report.resolveHorizon(loadModelConnections().items);
      const built = report.buildQuery({ liveFields: found.fields, view, horizon });
      // Ufuk anahtarın parçası: Veri Yönetimi'nde filtre değişince önbellek eski satırı dönmez.
      const queryKey = store.queryKey({ connection: { server: found.connection.server, catalog: found.connection.catalog, user: String(userId) }, measures: built.measures, rows: built.dimensions, filters: built.filterValues, horizon, options: { report: 'postfob', version: 2 } });
      const meta = { filterValues: built.filterValues, missing: built.missing, rowLimit: built.maxRows, horizonApplied: built.horizonApplied };
      if (!(req.body && req.body.forceRefresh)) {
        const cached = store.get(queryKey);
        if (cached && cached.fresh) {
          store.saveSnapshot(userId, { queryKey, rows: cached.rows, fields: [], viewConfig: cached.viewConfig || meta, fetchedAt: cached.fetchedAt });
          return res.json({ ok: true, view, ...snapshotPayload({ rows: cached.rows, fetchedAt: cached.fetchedAt, viewConfig: cached.viewConfig || meta }, req), fromCache: true });
        }
      }
      const result = await modelQuery.runModelRows({ server: found.connection.server, catalog: found.connection.catalog, query: built.query, headerMap: built.headerMap, generated: true, maxRows: built.maxRows, timeoutMs: 180000 });
      const rows = report.normalizeRows(result.rows, built);
      const stamped = { ...meta, truncated: rows.length >= built.maxRows };
      const record = store.set(queryKey, { rows, fields: [], viewConfig: stamped, fetchedAt: new Date().toISOString() });
      store.saveSnapshot(userId, { queryKey, rows, fields: [], viewConfig: stamped, fetchedAt: record.fetchedAt });
      userAccess.appendAudit(req.currentUser, 'POSTFOB_REPORT_FETCH', queryKey, { rows: rows.length, forceRefresh: Boolean(req.body && req.body.forceRefresh) });
      res.json({ ok: true, view, ...snapshotPayload({ rows, fetchedAt: record.fetchedAt, viewConfig: stamped }, req), fromCache: false });
    } catch (err) {
      logFailure('report', err);
      if (previous && Array.isArray(previous.rows) && RECOVERABLE_ERRORS.has(String(err && err.code || ''))) {
        return res.json({ ok: true, view: storedView(userId), ...snapshotPayload(previous, req), fromCache: true, offline: true, error: SOURCE_MESSAGE.tr, errorEn: SOURCE_MESSAGE.en });
      }
      const out = failure(err); res.status(out.status).json(out);
    }
  });

  /* Veri Yönetimi › Corporate Integration Lab "İncele": canlı şema okunur ve
     beklenen FOB/adet alanları doğrulanır. Sezon/ufuk bilinmeden veri sorgusu
     atılmaz (sınırsız sorgu yok); satır örneği kullanıcının son snapshot'ıdır. */
  async function probe(req, item, probeRecord) {
    const target = { server: String(item && item.server || ''), catalog: String(item && item.catalog || '') };
    const schema = await modelQuery.discoverSchema(target);
    const fields = intakeReport.allowedSchema(schema);
    probeRecord.schema = {
      columnCount: Array.isArray(schema && schema.columns) ? schema.columns.length : 0,
      measureCount: Array.isArray(schema && schema.measures) ? schema.measures.length : 0,
      errors: Array.isArray(schema && schema.errors) ? schema.errors.slice(0, 20) : [],
      provider: String(schema && schema.provider || ''),
    };
    const resolved = report.resolveFields(fields);
    const snapshot = store.loadSnapshot(req.currentUser.id);
    const rows = snapshot && Array.isArray(snapshot.rows) ? snapshot.rows : [];
    probeRecord.queryOk = true;
    probeRecord.queryRowCount = rows.length;
    probeRecord.queryError = '';
    probeRecord.queryCode = '';
    probeRecord.queryRuns = [{ id: 'postfob', name: 'FOB Sonrası Maliyet', targets: ['postfob'], ok: true, mode: 'schema', generated: true, rowCount: rows.length, sampledRows: Math.min(5, rows.length), missing: resolved.missing }];
    probeRecord.sample = rows.slice(0, 5);
    return rows;
  }
  function snapshotRows(userId) {
    const snapshot = store.loadSnapshot(userId);
    return snapshot && Array.isArray(snapshot.rows) ? snapshot.rows : [];
  }

  return { store, storedView, saveView, probe, snapshotRows };
};
