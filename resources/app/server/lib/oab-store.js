'use strict';

/* ===================================================================
   OAB (Order-Assortment-Budget) — KALICI CACHE DEPOSU

   PASS'ten çekilen OrderBudget_List_Report verisi pahalı (15-25 saniye) ve
   yalnız kullanıcının Buyer Log içinden seçtiği filtre kombinasyonu için
   çekiliyor (bkz. oab-pass-service.js — asla toplu/tüm-kombinasyon tarama
   yapılmaz). Bu depo, aynı kombinasyonun kısa sürede tekrar istenmesi
   durumunda PASS'e yeniden gitmeyi önler.

   Cache anahtarı: SeasonRef|MerchSubGroupRef|BuyerGroupRef (kullanıcı
   talimatındaki formatla birebir aynı).
   =================================================================== */

const fs = require('fs');
const path = require('path');
const { SERVER_DATA_ROOT } = require('../user-data');

const CACHE_DIR = path.join(SERVER_DATA_ROOT, 'oab-cache');
const SETTINGS_FILE = path.join(SERVER_DATA_ROOT, 'oab-settings.json');
const DEFAULT_TTL_MINUTES = 30;
const MAX_TTL_MINUTES = 24 * 60;
const MIN_TTL_MINUTES = 1;

function clean(value) { return String(value == null ? '' : value).trim(); }

function cacheKeyOf(seasonRef, merchSubGroupRef, buyerGroupRef) {
  const s = clean(seasonRef), m = clean(merchSubGroupRef), b = clean(buyerGroupRef);
  if (!s || !m || !b) return '';
  return `${s}|${m}|${b}`;
}
function diskNameFor(key) {
  // Windows dosya adlarında < > : " / \ | ? * karakterleri kullanılamaz.
  // Mantıksal cache anahtarı Season|MAG|Buyer biçiminde kalır; yalnız disk
  // üzerindeki dosya adı platformlar arası güvenli hale getirilir.
  const safe = String(key || '')
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
    .replace(/[. ]+$/g, '')
    .replace(/_+/g, '_');
  return (safe || 'oab-cache') + '.json';
}

const DEFAULT_OAB_PIVOT_VALUES = Object.freeze([
  'Plan Başlangıç Ayı',
  'Klasman Tanımı',
  'Toplam WSSI Sipariş Miktarı',
  'Toplam Onaylı Sipariş Miktarı',
  'Toplam Onaylanmış - Sipariş Geçilmemiş Adet',
]);

const REMOVED_OAB_DERIVED_FIELDS = new Set([
  'Sipariş Geçiş %', 'Kalan Sipariş Adet', 'Kalan Sipariş %', 'Fazla Sipariş Adet',
  'Plan Sapma %', 'Onaylı Sipariş %', 'Onay Bekleyen Adet', 'Sipariş Pipeline',
  'Depo Giriş %', 'Uygun Giriş %', 'Dönem Kalan Sipariş', 'Dönem Gerçekleşme %',
  "WSSI'ye Göre Kalan", 'WSSI Sipariş Geçilmemiş Adet', 'WSSI Sipariş Geçiş %',
  'WSSI Kalan Sipariş Adet', 'WSSI Kalan Sipariş %', 'WSSI Fazla Sipariş Adet',
  'WSSI Sipariş Sapma %', 'Plan–WSSI Sapma %', "Retail'e Kalan Gün",
  'Sipariş Geçilmemiş Adet', 'Sipariş Durumu', 'Sipariş Risk Durumu',
]);
function sanitizePivotConfig(config) {
  const source = config && typeof config === 'object' ? config : defaultPivotConfig();
  const keepField = field => field && !REMOVED_OAB_DERIVED_FIELDS.has(String(field));
  return {
    ...source,
    rows: (Array.isArray(source.rows) ? source.rows : []).filter(keepField),
    columns: (Array.isArray(source.columns) ? source.columns : []).filter(keepField),
    values: (Array.isArray(source.values) ? source.values : []).filter(v => v && keepField(v.field)),
    localFilters: Object.fromEntries(Object.entries(source.localFilters || {}).filter(([field]) => keepField(field))),
    calculatedFields: (Array.isArray(source.calculatedFields) ? source.calculatedFields : []).filter(v => !v || keepField(v.field || v.key || v.label)),
    grouped: source.grouped !== false,
    showSubtotals: source.showSubtotals !== false,
  };
}
function defaultPivotValueDefs() {
  return DEFAULT_OAB_PIVOT_VALUES.map(field => ({
    field,
    agg: (field === 'Plan Başlangıç Ayı' || field === 'Klasman Tanımı') ? 'FIRST' : 'SUM',
  }));
}

function defaultPivotConfig() {
  // Kullanıcı talimatındaki "ilk varsayılan pivot önerisi".
  return {
    rows: ['Klasman Grup Tanımı', 'Klasman Tanımı'],
    columns: [],
    values: defaultPivotValueDefs(),
    localFilters: {},
    calculatedFields: [],
    grouped: true,
    showSubtotals: true,
  };
}
function loadCacheSettings() {
  try {
    const raw = fs.readFileSync(SETTINGS_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    const minutes = Number(parsed && parsed.ttlMinutes);
    return {
      ttlMinutes: Number.isFinite(minutes) ? clampTtl(minutes) : DEFAULT_TTL_MINUTES,
      pivotConfig: sanitizePivotConfig((parsed && parsed.pivotConfig && typeof parsed.pivotConfig === 'object') ? parsed.pivotConfig : defaultPivotConfig()),
    };
  } catch (_) {
    return { ttlMinutes: DEFAULT_TTL_MINUTES, pivotConfig: defaultPivotConfig() };
  }
}
function clampTtl(minutes) {
  return Math.max(MIN_TTL_MINUTES, Math.min(MAX_TTL_MINUTES, Math.round(minutes)));
}

/* ===================================================================
   v7.20 — TOPLU BuyerGroupRefs YETENEĞİ (öğrenilen, varsayılmayan)

   PASS rapor parametresi `BuyerGroupRefs` çoğuldur; servisin virgüllü liste
   kabul edip etmediği belgelenmemiştir. Bu yüzden yetenek VARSAYILMAZ:
   çalışma anında bir kez denenir, dönen SATIR İÇERİĞİNDEN doğrulanır ve sonuç
   burada saklanır. Böylece her toplu işte yeniden denenmez.

   Değerler:
     'unknown'     → henüz denenmedi
     'supported'   → denendi, yanıt gerçekten çok gruplu geldi
     'unsupported' → denendi, parametre yok sayılmış görünüyor

   Yanlış bir 'supported' kaydı sessizce eksik rapor demektir; bu yüzden
   kullanıcı bunu tek tıkla sıfırlayabilir (resetBatchCapability).
   =================================================================== */
const BATCH_CAPABILITY_VALUES = new Set(['unknown', 'supported', 'unsupported']);
function readSettingsFile() {
  try { return JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')) || {}; }
  catch (_) { return {}; }
}
function loadBatchCapability() {
  const parsed = readSettingsFile();
  const raw = parsed && parsed.batchedBuyerGroups;
  const state = raw && BATCH_CAPABILITY_VALUES.has(raw.state) ? raw.state : 'unknown';
  return {
    state,
    checkedAt: raw && raw.checkedAt ? String(raw.checkedAt) : '',
    reason: raw && raw.reason ? String(raw.reason) : '',
    distinctGroups: Number(raw && raw.distinctGroups) || 0,
  };
}
function saveBatchCapability(next) {
  const state = next && BATCH_CAPABILITY_VALUES.has(next.state) ? next.state : 'unknown';
  const parsed = readSettingsFile();
  parsed.batchedBuyerGroups = {
    state,
    checkedAt: new Date().toISOString(),
    reason: next && next.reason ? String(next.reason).slice(0, 200) : '',
    distinctGroups: Number(next && next.distinctGroups) || 0,
  };
  fs.mkdirSync(path.dirname(SETTINGS_FILE), { recursive: true });
  const tmp = `${SETTINGS_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(parsed, null, 2), 'utf8');
  fs.renameSync(tmp, SETTINGS_FILE);
  return parsed.batchedBuyerGroups;
}
function resetBatchCapability() { return saveBatchCapability({ state: 'unknown' }); }
function saveCacheSettings(next) {
  const provided = Number(next && next.ttlMinutes);
  const ttlMinutes = clampTtl(Number.isFinite(provided) ? provided : DEFAULT_TTL_MINUTES);
  const pivotConfig = sanitizePivotConfig((next && next.pivotConfig && typeof next.pivotConfig === 'object') ? next.pivotConfig : loadCacheSettings().pivotConfig);
  fs.mkdirSync(path.dirname(SETTINGS_FILE), { recursive: true });
  const tmp = `${SETTINGS_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ ttlMinutes, pivotConfig }, null, 2), 'utf8');
  fs.renameSync(tmp, SETTINGS_FILE);
  return { ttlMinutes, pivotConfig };
}

// entry: { rows, fields, fetchedAt, params }
function get(key) {
  if (!key) return null;
  try {
    const file = path.join(CACHE_DIR, diskNameFor(key));
    const raw = fs.readFileSync(file, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.rows) || !parsed.fetchedAt) return null;
    const ttlMinutes = loadCacheSettings().ttlMinutes;
    const ageMs = Date.now() - new Date(parsed.fetchedAt).getTime();
    const fresh = ageMs >= 0 && ageMs <= ttlMinutes * 60000;
    return { ...parsed, fresh, ageMs, ttlMinutes };
  } catch (_) {
    return null;
  }
}

function set(key, entry) {
  if (!key) return null;
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const record = {
    rows: Array.isArray(entry.rows) ? entry.rows : [],
    fields: Array.isArray(entry.fields) ? entry.fields : [],
    fetchedAt: new Date().toISOString(),
    params: entry.params || {},
  };
  const file = path.join(CACHE_DIR, diskNameFor(key));
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(record), 'utf8');
  fs.renameSync(tmp, file);
  return record;
}

function clearKey(key) {
  if (!key) return false;
  try { fs.unlinkSync(path.join(CACHE_DIR, diskNameFor(key))); return true; }
  catch (_) { return false; }
}

module.exports = {
  CACHE_DIR, SETTINGS_FILE, DEFAULT_TTL_MINUTES,
  cacheKeyOf, get, set, clearKey,
  loadCacheSettings, saveCacheSettings,
  loadBatchCapability, saveBatchCapability, resetBatchCapability,
  DEFAULT_OAB_PIVOT_VALUES,
  sanitizePivotConfig, defaultPivotConfig,
};
