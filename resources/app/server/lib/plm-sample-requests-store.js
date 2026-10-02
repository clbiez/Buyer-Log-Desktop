'use strict';

/* PLM numune talepleri deposu (CoreNectum Requests → Buyer Log).

   PLM'e ait iş verisidir (PLM_OWNED): kullanıcıya özel değil, uygulama
   genelinde tek kopya tutulur — plm-style-links ile aynı model. Oturum
   çerezi, erişim anahtarı veya ham yanıt saklanmaz; yalnız normalize
   edilmiş talep alanları.

   KURAL: Bir modelin talepleri YALNIZ o model için başarılı bir istek
   döndüğünde değiştirilir. Başarısız istek eski veriyi silmez; başarılı ama
   boş yanıt ise "PLM'de talep yok" olarak (fetchedAt ile) yazılır. */

const path = require('path');
const { SERVER_DATA_ROOT, atomicWriteJson } = require('../user-data');
const { readJsonWithValidatedBackup } = require('./safe-json-read');
const engine = require('../../public/plm-sample-requests-engine');

const DEFAULT_FILE = path.join(SERVER_DATA_ROOT, 'plm-sample-requests.json');
const MAX_MODELS = 100000;
const MAX_REQUESTS_PER_MODEL = 500;

function emptyStore() { return { schemaVersion: 1, models: {}, _revision: 0, _updatedAt: null }; }

function normalizeEntry(raw, fallbackPlmId) {
  const plmId = engine.numericId(raw && raw.plmId) || engine.numericId(fallbackPlmId);
  const styleId = engine.numericId(raw && raw.styleId);
  if (!plmId) return null;
  const requests = (Array.isArray(raw && raw.requests) ? raw.requests : [])
    .slice(0, MAX_REQUESTS_PER_MODEL)
    .map(item => (item && item.requestCode ? { ...item, ...reclassify(item) } : null))
    .filter(Boolean);
  return { plmId, styleId, fetchedAt: String(raw && raw.fetchedAt || '') || null, requests };
}

/* Sınıflandırma kuralı sonradan genişlerse (yeni alt tip) saklı kayıt
   yeniden sınıflanır; böylece eski senkron yeni kuralla okunur. */
function reclassify(item) {
  return {
    status: engine.requestStatus(item.statusId, item.statusName, item.evaluationStatusName),
    milestone: engine.classifyMilestone(item.subTypeId, item.subTypeName),
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

  /* results: [{ plmId, styleId, requests }] — yalnız BAŞARILI istekler. */
  function saveResults(results, now = new Date().toISOString()) {
    const store = load();
    let written = 0;
    for (const result of Array.isArray(results) ? results : []) {
      const entry = normalizeEntry({ ...result, fetchedAt: now });
      if (!entry) continue;
      store.models[entry.plmId] = entry;
      written += 1;
    }
    if (Object.keys(store.models).length > MAX_MODELS) {
      throw Object.assign(new Error(`PLM numune talebi model sınırı aşıldı (${MAX_MODELS}).`), { statusCode: 413, code: 'PLM_REQUEST_LIMIT' });
    }
    if (written) {
      store._revision += 1;
      store._updatedAt = now;
      atomicWriteJson(file, store);
    }
    return { written, revision: store._revision, updatedAt: store._updatedAt };
  }

  function publicPayload(store = load()) {
    return {
      models: store.models,
      count: Object.keys(store.models).length,
      revision: store._revision,
      updatedAt: store._updatedAt,
    };
  }

  return { file, load, saveResults, publicPayload };
}

const defaultStore = createStore();

module.exports = {
  DEFAULT_FILE,
  MAX_MODELS,
  emptyStore,
  normalizeStore,
  createStore,
  load: defaultStore.load,
  saveResults: defaultStore.saveResults,
  publicPayload: defaultStore.publicPayload,
};
