'use strict';

/* PLM numune talebi senkronu: PLM ID listesi → styleId → GetRequestList.

   styleId önce PLM link deposundan okunur (Collection PLM Sync onu zaten
   tazeliyor). Depoda olmayan PLM'ler İÇİN TAHMİN YAPILMAZ: ölçülmüş
   GetStyleList parti isteğiyle çözülür ve link deposuna da yazılır. Yanlış bir
   styleId hata vermeden BAŞKA BİR MODELİN taleplerini getirirdi.

   Yetkilendirme hatası (token yok/geçersiz) bütün işi durdurur ve yukarı
   fırlatılır: istemci otomatik kurumsal oturum yenilemesini başlatır. Diğer
   hatalar model bazında raporlanır, eski veri korunur. */

const styleApi = require('./corenectum-style-api');
const requestApi = require('./corenectum-request-api');

const AUTH_CODES = new Set(['CORENECTUM_API_TOKEN_REQUIRED', 'CORENECTUM_API_TOKEN_INVALID']);
const MAX_PLM_IDS = 2000;

function isAuthError(error) { return Boolean(error && AUTH_CODES.has(error.code)); }

async function mapLimit(items, limit, worker) {
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      await worker(items[index], index);
    }
  });
  await Promise.all(runners);
}

async function resolveStyleIds(plmIds, deps) {
  const links = (deps.loadLinks() || {}).links || {};
  const resolved = new Map();
  const missing = [];
  for (const plmId of plmIds) {
    const link = links[plmId];
    if (link && link.styleId) resolved.set(plmId, String(link.styleId));
    else missing.push(plmId);
  }
  const failed = [];
  if (!missing.length) return { resolved, notFound: [], failed };
  const newLinks = [];
  for (const batch of styleApi.splitBatches(missing, styleApi.STYLE_LIST_BATCH_SIZE)) {
    try {
      const payload = await deps.postJson(styleApi.GET_STYLE_LIST_URL, styleApi.styleListBatchBody(batch), { timeoutMs: 90000, retries: 3 });
      const { rows } = styleApi.styleListRowsByPlm(payload);
      for (const [plmId, row] of rows) {
        if (!batch.includes(plmId) || !row.styleId) continue;
        resolved.set(plmId, row.styleId);
        newLinks.push({ plmId, styleId: row.styleId, styleName: row.styleName });
      }
    } catch (error) {
      if (isAuthError(error)) throw error;
      batch.forEach(plmId => failed.push({ plmId, code: error.code || 'PLM_STYLE_LOOKUP_FAILED', error: error.message }));
    }
  }
  if (newLinks.length && typeof deps.upsertLinks === 'function') {
    try { deps.upsertLinks(newLinks); } catch (_) { /* link sözlüğü yan faydadır */ }
  }
  const failedIds = new Set(failed.map(item => item.plmId));
  const notFound = missing.filter(plmId => !resolved.has(plmId) && !failedIds.has(plmId));
  return { resolved, notFound, failed };
}

async function syncSampleRequests(rawPlmIds, deps) {
  const plmIds = [...new Set((Array.isArray(rawPlmIds) ? rawPlmIds : []).map(deps.normalizePlmId).filter(Boolean))].slice(0, MAX_PLM_IDS);
  const progress = typeof deps.onProgress === 'function' ? deps.onProgress : () => {};
  progress({ phase: 'PLM model kimlikleri çözülüyor', current: 0, total: plmIds.length });
  const { resolved, notFound, failed } = await resolveStyleIds(plmIds, deps);

  const targets = [...resolved.entries()].map(([plmId, styleId]) => ({ plmId, styleId }));
  const results = [];
  let done = 0;
  let authError = null;
  await mapLimit(targets, requestApi.REQUEST_LIST_CONCURRENCY, async target => {
    if (authError) return;
    try {
      const payload = await deps.postJson(requestApi.GET_REQUEST_LIST_URL, requestApi.requestListBody(target.styleId), { timeoutMs: 60000, retries: 3 });
      results.push({ plmId: target.plmId, styleId: target.styleId, requests: requestApi.parseRequestList(payload, target.styleId) });
    } catch (error) {
      if (isAuthError(error)) { authError = error; return; }
      failed.push({ plmId: target.plmId, code: error.code || 'PLM_REQUEST_LIST_FAILED', error: error.message });
    } finally {
      done += 1;
      progress({ phase: 'PLM numune talepleri alınıyor', current: done, total: targets.length, model: target.plmId });
    }
  });
  // Yetki hatasından önce alınmış sonuçlar kaybolmasın.
  const saved = deps.store.saveResults(results);
  if (authError) throw authError;
  return {
    checked: plmIds.length,
    synced: results.length,
    withRequests: results.filter(item => item.requests.length).length,
    requestCount: results.reduce((sum, item) => sum + item.requests.length, 0),
    notFound,
    failed,
    revision: saved.revision,
    updatedAt: saved.updatedAt,
  };
}

module.exports = { MAX_PLM_IDS, resolveStyleIds, syncSampleRequests, mapLimit };
