'use strict';

/* KOLEKSİYON ANA VERİ KATALOĞU — ASAS veri modelinden DOĞRUDAN.

   Kullanıcı bulgusu: Koleksiyon'da "Yaz veya ASAS'tan seç" yazan License,
   Category, Country… hücreleri gerçekte veri tabanına gitmiyordu. Liste,
   kullanıcının OKUNMUŞ ve ufuk/kaynak/kapsam filtresinden geçmiş sipariş
   satırlarından kuruluyordu; filtrenin dışında kalan (ör. yeni sezonda ilk kez
   kullanılacak) bir lisans listede hiç yoktu. PLM → ASAS çeviri penceresi de
   aynı dar listeyi "ASAS kataloğu" diye gösteriyordu.

   Burası seçilen referans alanların TEKİL değerlerini ASAS modelinden
   ufuk/kaynak filtresi uygulamadan okur (v7.38 kullanıcı kapsamı kataloğuyla
   aynı yol) ve sonucu yerel olarak saklar: uygulama çevrimdışıyken de son
   okunan liste kullanılır, hücre her odaklandığında sorgu atılmaz.

   KAPSAM BİLİNÇLİ OLARAK DAR: MAG / MMYG / Buying Group / Buyer yetki
   kapsamını belirleyen alanlardır; onlar kullanıcının kapsamına göre
   süzülmüş sipariş kataloğundan gelmeye devam eder. Licensor ASAS'ta bir
   sütun değildir (Lisans'tan License Royalty kurallarıyla türetilir); onun
   ana kaynağı istemcideki kural listesidir.

   Alan başına AYRI denenir: biri okunamazsa diğerleri yine gelir, okunamayan
   alanın önceki listesi korunur ve sebebi raporlanır (§152). */

const fs = require('fs');
const path = require('path');

const MASTER_CATALOG_FIELDS = Object.freeze([
  Object.freeze({ key: 'category', header: 'Ürün Klasman', label: 'Category' }),
  Object.freeze({ key: 'license', header: 'Lisans', label: 'License' }),
  Object.freeze({ key: 'season', header: 'Sezon', label: 'Season' }),
  Object.freeze({ key: 'country', header: 'Siparişin Üretildiği Ülke', label: 'Country', transform: 'country' }),
  Object.freeze({ key: 'line', header: 'Line', label: 'Line' }),
  Object.freeze({ key: 'manufacturer', header: 'Üretici', label: 'Manufacturer' }),
  Object.freeze({ key: 'productMainDefinition', header: 'Ürün Tanım', label: 'Product Main Definition' }),
]);
const MASTER_CATALOG_KEYS = Object.freeze(MASTER_CATALOG_FIELDS.map(field => field.key));
const MASTER_CATALOG_SCHEMA_VERSION = 1;
const MAX_VALUES_PER_FIELD = 20000;
const STALE_AFTER_MS = 12 * 60 * 60 * 1000;
// Başarısız bir arka plan tazelemesinden sonra her GET'te modele yeniden
// gidilmez (ör. bu bilgisayarın model erişimi yoksa).
const BACKGROUND_RETRY_MS = 10 * 60 * 1000;

const TR_MAP = { 'ı': 'I', 'İ': 'I', 'ş': 'S', 'Ş': 'S', 'ğ': 'G', 'Ğ': 'G', 'ü': 'U', 'Ü': 'U', 'ö': 'O', 'Ö': 'O', 'ç': 'C', 'Ç': 'C' };
// İstemcideki kolCatalogIdentity ile aynı kimlik: büyük/küçük harf, Türkçe
// karakter, boşluk ve noktalama farkı aynı değeri iki kez listelemez.
function identity(value) {
  return String(value == null ? '' : value)
    .replace(/[ıİşŞğĞüÜöÖçÇ]/g, ch => TR_MAP[ch] || ch)
    .toUpperCase().replace(/[^A-Z0-9]+/g, '');
}
function cleanValue(value) {
  return String(value == null ? '' : value).replace(/\u0000/g, '').replace(/\s+/g, ' ').trim().slice(0, 300);
}
function uniqueSorted(values) {
  const seen = new Map();
  for (const raw of Array.isArray(values) ? values : []) {
    const value = cleanValue(raw), key = identity(value);
    if (key && !seen.has(key)) seen.set(key, value);
  }
  return [...seen.values()]
    .sort((a, b) => a.localeCompare(b, 'tr-TR', { numeric: true, sensitivity: 'base' }))
    .slice(0, MAX_VALUES_PER_FIELD);
}

function emptySnapshot() {
  return { schemaVersion: MASTER_CATALOG_SCHEMA_VERSION, catalogs: {}, fields: [], refreshedAt: null };
}
function normalizeSnapshot(raw) {
  const out = emptySnapshot();
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const key of MASTER_CATALOG_KEYS) {
    const list = raw.catalogs && raw.catalogs[key];
    if (Array.isArray(list)) out.catalogs[key] = uniqueSorted(list);
  }
  out.fields = (Array.isArray(raw.fields) ? raw.fields : [])
    .filter(item => item && MASTER_CATALOG_KEYS.includes(item.key))
    .map(item => ({
      key: item.key, label: cleanValue(item.label), count: Math.max(0, Number(item.count) || 0),
      source: cleanValue(item.source), error: cleanValue(item.error), readAt: cleanValue(item.readAt) || null,
    }));
  out.refreshedAt = cleanValue(raw.refreshedAt) || null;
  return out;
}

// Bağlantının alan eşlemesinde (veya elle eklenmiş özel alanlarında) ilgili
// ASAS başlığının hangi tablo/sütuna bağlandığı. Eşleme yoksa null.
function columnForHeader(connection, header) {
  const mapping = (connection && connection.mapping) || {};
  const direct = mapping[header];
  const fallbackTable = connection && connection.horizon && connection.horizon.table || '';
  if (direct && direct.name) return { table: direct.table || fallbackTable, name: direct.name };
  const custom = (Array.isArray(connection && connection.customFields) ? connection.customFields : [])
    .find(field => field && String(field.header || '').trim() === header);
  if (custom && custom.column && custom.column.name) {
    return { table: custom.column.table || fallbackTable, name: custom.column.name };
  }
  return null;
}
function distinctQuery(column, limit = MAX_VALUES_PER_FIELD) {
  const dax = `'${String(column.table).replace(/'/g, "''")}'[${String(column.name).replace(/]/g, ']]')}]`;
  return `EVALUATE TOPN(${limit}, DISTINCT(${dax}), ${dax}, ASC)`;
}

/* Model okuması. `runModelRows` enjekte edilir (sunucuda lib/modelQuery;
   testte sahte). Önceki anlık görüntü verilirse okunamayan alanın listesi
   korunur — bir bağlantı hatası kullanıcının seçeneklerini silmez. */
async function readMasterCatalog({ connections, runModelRows, transforms = {}, previous = null, now = () => new Date() } = {}) {
  if (typeof runModelRows !== 'function') throw new TypeError('runModelRows zorunlu.');
  const asas = (Array.isArray(connections) ? connections : [])
    .filter(item => item && item.role === 'asas' && item.server && item.catalog);
  if (!asas.length) {
    throw Object.assign(new Error('ASAS Data Model bağlantısı bulunamadı. Seçim listeleri ancak model bağlantısından okunabilir.'), {
      code: 'ASAS_CONNECTION_MISSING', statusCode: 409,
    });
  }
  const base = normalizeSnapshot(previous);
  const catalogs = { ...base.catalogs };
  const fields = [];
  const readAt = now().toISOString();
  for (const field of MASTER_CATALOG_FIELDS) {
    const transform = typeof transforms[field.transform] === 'function' ? transforms[field.transform] : (value => value);
    const values = [];
    let ok = false, failure = '', source = '';
    for (const connection of asas) {
      const column = columnForHeader(connection, field.header);
      if (!column || !column.table || !column.name) {
        if (!failure) failure = `"${field.header}" alanı bu bağlantıda eşlenmemiş.`;
        continue;
      }
      source = `${column.table}[${column.name}]`;
      try {
        const result = await runModelRows({
          server: connection.server, catalog: connection.catalog,
          query: distinctQuery(column), generated: true, maxRows: MAX_VALUES_PER_FIELD, timeoutMs: 120000,
        });
        for (const row of (result && result.rows) || []) {
          const first = row && typeof row === 'object' ? Object.values(row)[0] : row;
          const text = cleanValue(first == null ? '' : transform(cleanValue(first)));
          if (text) values.push(text);
        }
        ok = true;
      } catch (err) {
        if (!failure) failure = err && err.message ? err.message : String(err);
      }
    }
    if (ok) catalogs[field.key] = uniqueSorted(values);
    const previousField = base.fields.find(item => item.key === field.key);
    fields.push({
      key: field.key, label: field.label,
      count: Array.isArray(catalogs[field.key]) ? catalogs[field.key].length : 0,
      source, error: ok ? '' : failure,
      readAt: ok ? readAt : (previousField && previousField.readAt) || null,
    });
  }
  const anyRead = fields.some(item => !item.error);
  return {
    schemaVersion: MASTER_CATALOG_SCHEMA_VERSION,
    catalogs, fields,
    refreshedAt: anyRead ? readAt : base.refreshedAt,
  };
}

function isStale(snapshot, nowMs = Date.now(), staleAfterMs = STALE_AFTER_MS) {
  const at = Date.parse(snapshot && snapshot.refreshedAt || '');
  return !Number.isFinite(at) || nowMs - at > staleAfterMs;
}

/* Kalıcı depo + tek uçuşlu tazeleme. Dosya yolu ve model okuyucusu dışarıdan
   verilir; böylece sunucu dışında (testte) gerçek veri klasörüne dokunmaz. */
function createMasterCatalogStore({ file, runModelRows, loadConnections, transforms = {}, readJson, writeJson, logFailure, nowMs = () => Date.now() } = {}) {
  const read = typeof readJson === 'function' ? readJson : target => {
    if (!fs.existsSync(target)) return null;
    return JSON.parse(fs.readFileSync(target, 'utf8'));
  };
  const write = typeof writeJson === 'function' ? writeJson : (target, value) => {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const temp = `${target}.tmp-${process.pid}`;
    fs.writeFileSync(temp, JSON.stringify(value, null, 2));
    fs.renameSync(temp, target);
  };
  let inFlight = null, lastAttemptMs = 0;
  function load() {
    try { return normalizeSnapshot(read(file)); }
    catch (err) { if (typeof logFailure === 'function') logFailure('collectionMasterCatalogRead', err); return emptySnapshot(); }
  }
  function refresh() {
    if (inFlight) return inFlight;
    lastAttemptMs = nowMs();
    inFlight = (async () => {
      const previous = load();
      const next = await readMasterCatalog({ connections: loadConnections(), runModelRows, transforms, previous });
      write(file, next);
      return next;
    })().finally(() => { inFlight = null; });
    return inFlight;
  }
  // Eskimişse arka planda tazeler; isteği bekletmez ve hatası isteği düşürmez.
  function refreshInBackgroundIfStale(snapshot = load()) {
    if (inFlight || !isStale(snapshot, nowMs())) return false;
    if (lastAttemptMs && nowMs() - lastAttemptMs < BACKGROUND_RETRY_MS) return false;
    const hasAsas = (loadConnections() || []).some(item => item && item.role === 'asas' && item.server && item.catalog);
    if (!hasAsas) return false;
    refresh().catch(err => { if (typeof logFailure === 'function') logFailure('collectionMasterCatalogRefresh', err); });
    return true;
  }
  return { load, refresh, refreshInBackgroundIfStale, isRefreshing: () => Boolean(inFlight) };
}

module.exports = {
  MASTER_CATALOG_FIELDS,
  MASTER_CATALOG_KEYS,
  MASTER_CATALOG_SCHEMA_VERSION,
  STALE_AFTER_MS,
  BACKGROUND_RETRY_MS,
  identity,
  uniqueSorted,
  normalizeSnapshot,
  columnForHeader,
  distinctQuery,
  readMasterCatalog,
  isStale,
  createMasterCatalogStore,
};
