'use strict';

/*
 * CoreNectum Style List image URL -> PLM identity reverse index.
 *
 * Drag/drop gives Buyer Log an Attachment/GetAttachment/<id> URL, but not the
 * PLM Code. This module resolves that URL against GetStyleList without driving
 * Edge/CDP/DOM. The authenticated direct API transport is reused and the
 * resulting reverse index stays in memory only.
 */

const styleApi = require('./corenectum-style-api');
const apiClient = require('./corenectum-api-client');
const apiSettings = require('./corenectum-api-settings');

const DEFAULT_MAX_PAGES = 1000;
const DEFAULT_TTL_MS = 15 * 60 * 1000;

function clean(value, max = 2000) {
  return String(value == null ? '' : value).replace(/\u0000/g, '').trim().slice(0, max);
}

function resolveError(message, code, statusCode = 502, details = null) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  if (details) error.details = details;
  return error;
}

function styleListTotalCount(payload) {
  const preferred = payload && payload.data && payload.data.coreNectumResultData;
  const direct = preferred && Number(preferred.totalCount);
  if (Number.isFinite(direct) && direct >= 0) return Math.trunc(direct);
  let found = null;
  const visit = (value, depth = 0) => {
    if (found != null || depth > 8 || value == null || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      if (/^total(count|records?)$/i.test(String(key))) {
        const number = Number(child);
        if (Number.isFinite(number) && number >= 0) { found = Math.trunc(number); return; }
      }
      visit(child, depth + 1);
      if (found != null) return;
    }
  };
  visit(payload);
  return found;
}

function attachmentIdentity(value) {
  return styleApi.attachmentIdentity(value);
}

function indexRecords(records, byAttachment, ambiguous) {
  for (const record of Array.isArray(records) ? records : []) {
    const row = styleApi.styleListRow(record);
    if (!row || !row.plmId || !row.imageUrl) continue;
    const key = attachmentIdentity(row.imageUrl);
    if (!key) continue;
    const current = byAttachment.get(key);
    if (!current) {
      byAttachment.set(key, row);
      continue;
    }
    if (current.plmId !== row.plmId || current.styleId !== row.styleId) ambiguous.add(key);
  }
}

function createAttachmentResolver(deps = {}) {
  const postJson = typeof deps.postJson === 'function' ? deps.postJson : apiClient.postJson;
  const now = typeof deps.now === 'function' ? deps.now : Date.now;
  const getTemplate = typeof deps.getTemplate === 'function' ? deps.getTemplate : apiSettings.getStyleListTemplate;
  const paginateTemplate = typeof deps.paginateTemplate === 'function' ? deps.paginateTemplate : apiSettings.paginateStyleListTemplate;
  const maxPages = Math.max(1, Math.min(5000, Number(deps.maxPages) || DEFAULT_MAX_PAGES));
  const ttlMs = Math.max(1000, Number(deps.ttlMs) || DEFAULT_TTL_MS);
  const cache = new Map();
  const inflight = new Map();

  async function rebuild(ownerId, options = {}) {
    const ownerKey = clean(ownerId, 120) || 'moderator';
    if (inflight.has(ownerKey)) return inflight.get(ownerKey);
    const task = (async () => {
      const template = getTemplate();
      if (!template) {
        throw resolveError(
          'CoreNectum Style List istek şablonu henüz hazır değil. Buyer Log PLM oturumunu otomatik tazeleyip Style List isteğini yakalamalıdır.',
          'CORENECTUM_STYLE_TEMPLATE_REQUIRED',
          409
        );
      }
      const byAttachment = new Map();
      const ambiguous = new Set();
      let scannedPages = 0;
      let scannedRows = 0;
      let totalCount = null;
      let completed = false;

      for (let pageNumber = 1; pageNumber <= maxPages; pageNumber += 1) {
        let pagePlan;
        try { pagePlan = paginateTemplate(template, pageNumber); }
        catch (error) {
          throw resolveError(
            error && error.message || 'CoreNectum Style List sayfalama şablonu geçersiz.',
            error && error.code || 'CORENECTUM_STYLE_TEMPLATE_INVALID',
            409
          );
        }
        const payload = await postJson(
          ownerId,
          styleApi.GET_STYLE_LIST_URL,
          pagePlan.body,
          { timeoutMs: 90000, retries: 3, language: options.language }
        );
        const records = styleApi.styleListRecords(payload);
        scannedPages += 1;
        scannedRows += records.length;
        const reported = styleListTotalCount(payload);
        if (reported != null) totalCount = reported;
        indexRecords(records, byAttachment, ambiguous);

        if (!records.length || (totalCount != null && scannedRows >= totalCount)) {
          completed = true;
          break;
        }
        if (totalCount == null && records.length < pagePlan.pageSize) {
          completed = true;
          break;
        }
      }

      if (!completed) {
        throw resolveError(
          'CoreNectum Style List reverse index güvenli tarama sınırına ulaştı.',
          'CORENECTUM_ATTACHMENT_INDEX_LIMIT',
          502,
          { scannedPages, scannedRows, maxPages }
        );
      }

      const state = {
        byAttachment,
        ambiguous,
        scannedPages,
        scannedRows,
        totalCount,
        builtAt: now(),
        expiresAt: now() + ttlMs,
      };
      cache.set(ownerKey, state);
      return state;
    })();
    inflight.set(ownerKey, task);
    try { return await task; }
    finally { if (inflight.get(ownerKey) === task) inflight.delete(ownerKey); }
  }

  async function resolve(ownerId, attachmentUrl, options = {}) {
    const normalizedUrl = styleApi.attachmentUrl(attachmentUrl);
    const key = attachmentIdentity(normalizedUrl);
    if (!normalizedUrl || !key) {
      throw resolveError('Geçerli bir CoreNectum model görseli bırakılmadı.', 'CORENECTUM_ATTACHMENT_URL_INVALID', 400);
    }

    const ownerKey = clean(ownerId, 120) || 'moderator';
    let state = cache.get(ownerKey);
    let cached = Boolean(state && state.expiresAt > now());
    if (!cached) {
      cache.delete(ownerKey);
      state = await rebuild(ownerId, options);
      cached = false;
    }

    if (state.ambiguous.has(key)) {
      throw resolveError(
        'Bu PLM görseli birden fazla Style List kaydıyla eşleşiyor; model otomatik seçilmedi.',
        'CORENECTUM_ATTACHMENT_AMBIGUOUS',
        409
      );
    }
    const row = state.byAttachment.get(key);
    if (!row) {
      throw resolveError(
        'Sürüklenen görsel güncel CoreNectum Style List içinde bir modele bağlanamadı.',
        'CORENECTUM_ATTACHMENT_NOT_FOUND',
        404,
        { scannedPages: state.scannedPages, scannedRows: state.scannedRows, totalCount: state.totalCount }
      );
    }
    return {
      plmId: row.plmId,
      styleId: row.styleId,
      styleName: row.styleName,
      imageUrl: row.imageUrl,
      attachmentIdentity: key,
      cached,
      scannedPages: state.scannedPages,
      scannedRows: state.scannedRows,
      totalCount: state.totalCount,
    };
  }

  function clear(ownerId) {
    if (ownerId == null) cache.clear();
    else cache.delete(clean(ownerId, 120) || 'moderator');
  }

  return { resolve, clear, rebuild };
}

const defaultResolver = createAttachmentResolver();

module.exports = {
  DEFAULT_MAX_PAGES,
  DEFAULT_TTL_MS,
  styleListTotalCount,
  attachmentIdentity,
  indexRecords,
  createAttachmentResolver,
  resolve: defaultResolver.resolve,
  clear: defaultResolver.clear,
};
