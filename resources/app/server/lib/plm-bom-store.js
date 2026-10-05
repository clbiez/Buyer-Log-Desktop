'use strict';

/* PLM BOM deposu.
 *
 * Ham CoreNectum cevabı veya kimlik bilgisi saklanmaz. Yalnız normalize
 * embellishment bileşenleri + baskı analizi tutulur. Kayıt PLM'e aittir;
 * kullanıcı notu değildir ve modelin PLM ID'siyle tekilleştirilir.
 */
const path = require('path');
const { SERVER_DATA_ROOT, atomicWriteJson } = require('../user-data');
const { readJsonWithValidatedBackup } = require('./safe-json-read');
const bomApi = require('./corenectum-bom-api');

const DEFAULT_FILE = path.join(SERVER_DATA_ROOT, 'plm-bom.json');
const MAX_MODELS = 100000;
const MAX_COMPONENTS_PER_MODEL = 200;
const MAX_PLACEMENTS_PER_MODEL = 100;

function emptyStore() { return { schemaVersion: 1, models: {}, _revision: 0, _updatedAt: null }; }
function text(value, max = 500) { return String(value == null ? '' : value).trim().slice(0, max); }

function normalizeAi(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const status = ['not-needed', 'resolved', 'partial', 'failed', 'deferred'].includes(text(source.status, 30)) ? text(source.status, 30) : 'not-needed';
  return {
    status,
    model: text(source.model, 80),
    consultedAt: text(source.consultedAt, 80) || null,
    confidence: ['high', 'medium', 'low'].includes(text(source.confidence, 20).toLowerCase()) ? text(source.confidence, 20).toLowerCase() : '',
    notes: (Array.isArray(source.notes) ? source.notes : []).slice(0, 10).map(item => text(item, 500)).filter(Boolean),
    error: text(source.error, 500),
  };
}
function normalizeEntry(raw, fallbackPlmId) {
  const plmId = bomApi.coreId(raw && raw.plmId) || bomApi.coreId(fallbackPlmId);
  const styleId = bomApi.coreId(raw && raw.styleId);
  if (!plmId || !styleId) return null;
  const components = (Array.isArray(raw && raw.components) ? raw.components : [])
    .slice(0, MAX_COMPONENTS_PER_MODEL)
    .map(bomApi.normalizeComponent)
    .filter(Boolean);
  const placements = (Array.isArray(raw && raw.placements) ? raw.placements : [])
    .slice(0, MAX_PLACEMENTS_PER_MODEL)
    .map(item => {
      if (!item || typeof item !== 'object') return null;
      const placement = text(item.placement, 40);
      const meta = bomApi.PLACEMENTS[placement] || bomApi.PLACEMENTS.other;
      return {
        componentCode: text(item.componentCode, 120),
        styleBomComponentId: text(item.styleBomComponentId, 80),
        placement: meta.key,
        placementTr: text(item.placementTr, 80) || meta.tr,
        placementEn: text(item.placementEn, 80) || meta.en,
        count: Math.max(1, Math.min(20, Number(item.count) || meta.count || 1)),
        printType: text(item.printType, 160),
        categoryName: text(item.categoryName, 160),
        description: text(item.description, 500),
        quantity: Number.isFinite(Number(item.quantity)) ? Number(item.quantity) : null,
        imageUrl: text(item.imageUrl, 2000),
        graphicApprovalStatusName: text(item.graphicApprovalStatusName, 160),
        aiResolved: item.aiResolved === true,
        aiConfidence: text(item.aiConfidence, 20),
        aiReason: text(item.aiReason, 500),
      };
    }).filter(Boolean);
  const summary = bomApi.summaryForPlacements(placements);
  return {
    plmId,
    styleId,
    styleBomId: bomApi.coreId(raw && raw.styleBomId),
    fetchedAt: text(raw && raw.fetchedAt, 80) || null,
    sourceCreatedDate: text(raw && raw.sourceCreatedDate, 80) || null,
    sourceModifiedDate: text(raw && raw.sourceModifiedDate, 80) || null,
    fingerprint: text(raw && raw.fingerprint, 128),
    components,
    placements,
    hasPrint: summary.totalPrintCount > 0,
    totalPrintCount: summary.totalPrintCount,
    placementSummary: summary.placementSummary,
    techniqueSummary: summary.techniqueSummary,
    summary: summary.summary,
    needsAi: placements.some(item => item.placement === 'other'),
    ambiguousComponentCodes: placements.filter(item => item.placement === 'other').map(item => item.componentCode || item.styleBomComponentId).filter(Boolean),
    ai: normalizeAi(raw && raw.ai),
  };
}
function normalizeStore(raw) {
  const out = emptyStore();
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  out._revision = Math.max(0, Number(raw._revision) || 0);
  out._updatedAt = raw._updatedAt ? String(raw._updatedAt) : null;
  const entries = raw.models && typeof raw.models === 'object' && !Array.isArray(raw.models)
    ? Object.entries(raw.models).slice(0, MAX_MODELS) : [];
  for (const [plmId, value] of entries) {
    const entry = normalizeEntry(value, plmId);
    if (entry) out.models[entry.plmId] = entry;
  }
  return out;
}

function createStore(file = DEFAULT_FILE) {
  function load() {
    return readJsonWithValidatedBackup(file, {
      fallback: emptyStore,
      normalize: normalizeStore,
      restore: value => atomicWriteJson(file, value),
    });
  }
  function entry(plmId, source = load()) {
    const id = bomApi.coreId(plmId);
    return id ? source.models[id] || null : null;
  }
  function saveResults(results, now = new Date().toISOString()) {
    const store = load();
    let written = 0;
    for (const raw of Array.isArray(results) ? results : []) {
      const normalized = normalizeEntry({ ...raw, fetchedAt: raw && raw.fetchedAt || now });
      if (!normalized) continue;
      store.models[normalized.plmId] = normalized;
      written += 1;
    }
    if (Object.keys(store.models).length > MAX_MODELS) {
      throw Object.assign(new Error(`PLM BOM model sınırı aşıldı (${MAX_MODELS}).`), { statusCode: 413, code: 'PLM_BOM_LIMIT' });
    }
    if (written) {
      store._revision += 1;
      store._updatedAt = now;
      atomicWriteJson(file, store);
    }
    return { written, revision: store._revision, updatedAt: store._updatedAt };
  }
  function publicPayload(store = load()) {
    return { models: store.models, count: Object.keys(store.models).length, revision: store._revision, updatedAt: store._updatedAt };
  }
  return { file, load, entry, saveResults, publicPayload };
}

const defaultStore = createStore();

module.exports = {
  DEFAULT_FILE,
  MAX_MODELS,
  emptyStore,
  normalizeEntry,
  normalizeStore,
  createStore,
  load: defaultStore.load,
  entry: defaultStore.entry,
  saveResults: defaultStore.saveResults,
  publicPayload: defaultStore.publicPayload,
};
