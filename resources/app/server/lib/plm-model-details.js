'use strict';

/* PLM Kumaş + PLM Artwork model detayları (salt okunur projeksiyon).
 *
 * Kaynak: PLM SYNC'in kalıcı BOM deposu (server/data/plm-bom.json,
 * plm-bom-store.js). Koleksiyon "Artwork Detayı" ve CP/Siparişler
 * "Fabric (PLM)" / "Artwork Detail" sütunları ile aynı kayıttır; ikinci
 * depo, uzak PLM çağrısı veya AI yoktur.
 *
 * LFL ve Fiyat & Üretici Analizi'nin kumaş filtreleri (Kumaş Kategorisi,
 * Kumaş Tipi, İplik No, Gramaj, Karışım) eskiden ASAS kumaş satırlarından
 * geliyordu. Artık modelin PLM kumaş metninden (plm-fabric-info.js
 * ayrıştırıcısı) okunur. PLM kaydı olmayan model için ASAS değeri korunur
 * (eski sezonların kıyası boşa düşmesin) ve kaynağı `fabricInfoSource`
 * alanında açıkça yazılır. Aynı özelliğin farklı yazımları (ör. PLM
 * "Jersey" ile ASAS "Süprem") tek görünen değerde birleşir ki LFL kıyasının
 * iki tarafı aynı filtre değerine düşsün. Kumaşçı ve Kumaşçı Ülkesi PLM
 * metninde bulunmadığı için ASAS'tan okunmaya devam eder. */

const plmFabricInfo = require('./plm-fabric-info');
const bomApi = require('./corenectum-bom-api');

const PARSED_FIELDS = Object.freeze(['fabricCategory', 'kumasTipi', 'iplikNo', 'fabricWeight', 'karisim']);
const SOURCE = Object.freeze({ PLM: 'PLM', ASAS: 'ASAS' });

const clean = value => String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
function coreId(value) {
  let textValue = String(value == null ? '' : value).trim().replace(/^_+/, '');
  if (/^\d+\.0+$/.test(textValue)) textValue = textValue.slice(0, textValue.indexOf('.'));
  textValue = textValue.replace(/^0+(?=\d)/, '');
  return /^\d+$/.test(textValue) && Number(textValue) > 0 ? textValue : '';
}

// Ayrıştırma pahalıdır; aynı kumaş metni binlerce satırda tekrarlanır.
const PARSE_CACHE_LIMIT = 20000;
const parseCache = new Map();
function parsedFabric(raw) {
  const key = String(raw == null ? '' : raw);
  if (!key.trim()) return null;
  let hit = parseCache.get(key);
  if (hit === undefined) {
    if (parseCache.size >= PARSE_CACHE_LIMIT) parseCache.clear();
    hit = plmFabricInfo.parseMainFabricInfo(key);
    parseCache.set(key, hit);
  }
  return hit;
}
const keyCache = new Map();
function fieldKey(name, value) {
  const textValue = clean(value);
  if (!textValue) return '';
  const cacheKey = `${name}\u0000${textValue}`;
  let hit = keyCache.get(cacheKey);
  if (hit === undefined) {
    if (keyCache.size >= PARSE_CACHE_LIMIT) keyCache.clear();
    hit = plmFabricInfo.fieldKey(name, textValue);
    keyCache.set(cacheKey, hit);
  }
  return hit;
}

function artworkText(entry, lang) {
  if (!entry) return '';
  if (entry.isSetStyle) return clean(entry.artworkSummary || entry.summary);
  const placements = Array.isArray(entry.placements) ? entry.placements : [];
  const counted = placements.filter(item => item && item.placement !== 'all_over');
  if (!counted.length) return lang === 'en' ? 'No print' : 'Baskı yok';
  if (lang !== 'en') return clean(entry.summary) || clean(bomApi.summaryForPlacements(placements).summary);
  /* EN metni yerleşim sözlüğünden kurulur (sunucu özetiyle aynı kural):
     aynı teknik paylaşılıyorsa sonda tek teknik, değilse bölge başına. */
  const groups = new Map(), techniques = new Set();
  let total = 0;
  for (const item of counted) {
    const meta = bomApi.PLACEMENTS[item.placement] || bomApi.PLACEMENTS.other;
    const label = item.placementEn || meta.en;
    const count = Math.max(1, Math.min(20, Number(item.count) || meta.count || 1));
    const technique = clean(item.printType);
    const group = groups.get(label) || { order: Object.keys(bomApi.PLACEMENTS).indexOf(meta.key), count: 0, techniques: new Set() };
    group.count += count;
    if (technique) { group.techniques.add(technique); techniques.add(technique); }
    groups.set(label, group);
    total += count;
  }
  const ordered = [...groups].sort((a, b) => a[1].order - b[1].order);
  const techOf = group => [...group.techniques].join(' + ');
  const uniform = new Set(ordered.map(([, group]) => techOf(group))).size <= 1;
  if (!uniform) return `${ordered.map(([label, group]) => `${label}: ${group.count}${techOf(group) ? ` | ${techOf(group)}` : ''}`).join(' • ')} | Total: ${total}`;
  const tech = [...techniques].join(' + ');
  return `${ordered.map(([label, group]) => `${label}: ${group.count}`).join(' • ')}${tech ? ` | ${tech}` : ''} | Total: ${total}`;
}

/* Set Style'da her parçanın kumaşı ayrı ayrıştırılır; parçalar aynı değeri
   taşıyorsa tek değer, farklıysa " + " ile birleşik değer döner. */
function fabricFieldsFor(entry) {
  const sources = entry && entry.isSetStyle && Array.isArray(entry.setComponents) && entry.setComponents.some(part => clean(part && part.fabric))
    ? entry.setComponents.map(part => part && part.fabric).filter(value => clean(value))
    : [entry && entry.fabric].filter(value => clean(value));
  const out = {};
  for (const name of PARSED_FIELDS) {
    const values = [];
    for (const raw of sources) {
      const parsed = parsedFabric(raw);
      const value = clean(parsed && parsed[name] && parsed[name].value);
      if (value && !values.some(item => fieldKey(name, item) === fieldKey(name, value))) values.push(value);
    }
    out[name] = values.join(' + ');
  }
  return out;
}

const detailCache = new WeakMap();
/* Tek modelin PLM detayları. Depo nesneleri paylaşılan ve değişmez olduğu
   için sonuç kayıt kimliğiyle önbelleklenir. */
function detailsForEntry(entry) {
  if (!entry || typeof entry !== 'object') return null;
  const cached = detailCache.get(entry);
  if (cached) return cached;
  const plmFabric = clean(entry.fabricSummary || entry.fabric) ? String(entry.fabricSummary || entry.fabric).trim() : '';
  const details = Object.freeze({
    plmId: entry.plmId || '',
    plmFabric,
    plmArtwork: artworkText(entry, 'tr'),
    plmArtworkEn: artworkText(entry, 'en'),
    ...fabricFieldsFor(entry),
  });
  detailCache.set(entry, details);
  return details;
}

function detailsForIds(plmIds, store) {
  const models = store && store.models || {};
  const out = {};
  for (const raw of Array.isArray(plmIds) ? plmIds : []) {
    const id = coreId(raw);
    if (!id || out[id]) continue;
    const details = detailsForEntry(models[id]);
    if (details) out[id] = details;
  }
  return out;
}

/* Satırlara PLM Kumaş / PLM Artwork ve PLM tabanlı kumaş özelliklerini yazar.
   Girdi satırları değiştirilmez; yalnız değişen satır kopyalanır. */
/* options.compact: PLM Kumaş / Artwork metinleri ve kaynak satıra yazılmaz
   (yanıt yükü satır başına büyümesin); istemci bunları detailsForRows()
   sözlüğünden PLM ID ile eşler. Revize kumaş alanları her iki modda satırdadır. */
function attachToRows(rows, store, options = {}) {
  const compact = options && options.compact === true;
  const list = Array.isArray(rows) ? rows : [];
  const models = store && store.models || {};
  const next = new Array(list.length);
  /* Birleştirme yalnız farklı değerler üzerinden yapılır (satır başına anahtar
     hesabı yok): PLM yazımlarının sıklığı ve görülen tüm değerler. */
  const plmCounts = Object.fromEntries(PARSED_FIELDS.map(name => [name, new Map()]));
  const seen = Object.fromEntries(PARSED_FIELDS.map(name => [name, new Set()]));
  for (let i = 0; i < list.length; i++) {
    const row = list[i];
    if (!row || typeof row !== 'object') { next[i] = row; continue; }
    const id = coreId(row.plmId);
    const details = id ? detailsForEntry(models[id]) : null;
    const hasPlmFabric = Boolean(details && details.plmFabric);
    const out = { ...row }; // spread kopyası JSON serileştirmede Object.assign kopyasından hızlı (ölçüldü)
    if (!compact) {
      out.plmFabric = details ? details.plmFabric : '';
      out.plmArtwork = details ? details.plmArtwork : '';
      out.plmArtworkEn = details ? details.plmArtworkEn : '';
    }
    let anyValue = false;
    for (const name of PARSED_FIELDS) {
      const value = hasPlmFabric ? details[name] : clean(row[name]);
      out[name] = value;
      if (!value) continue;
      anyValue = true;
      seen[name].add(value);
      if (hasPlmFabric) plmCounts[name].set(value, (plmCounts[name].get(value) || 0) + 1);
    }
    if (!compact) out.fabricInfoSource = hasPlmFabric ? SOURCE.PLM : (anyValue ? SOURCE.ASAS : '');
    else if (out.fabricInfoSource !== undefined) delete out.fabricInfoSource;
    next[i] = out;
  }
  const displayOf = {};
  let needsRewrite = false;
  for (const name of PARSED_FIELDS) {
    const best = new Map();
    for (const [value, count] of plmCounts[name]) {
      const key = fieldKey(name, value), current = best.get(key);
      if (!current || count > current.count || (count === current.count && value.localeCompare(current.value, 'tr') < 0)) best.set(key, { value, count });
    }
    const map = new Map();
    for (const value of seen[name]) {
      const hit = best.get(fieldKey(name, value));
      if (hit && hit.value !== value) { map.set(value, hit.value); needsRewrite = true; }
    }
    displayOf[name] = map;
  }
  if (!needsRewrite) return next;
  for (const row of next) {
    if (!row || typeof row !== 'object') continue;
    for (const name of PARSED_FIELDS) {
      const display = row[name] && displayOf[name].get(row[name]);
      if (display) row[name] = display;
    }
  }
  return next;
}

/* Satırlarda geçen PLM ID'lerin detay sözlüğü (compact yanıt için). */
function detailsForRows(rows, store) {
  const models = store && store.models || {};
  const out = {};
  for (const row of Array.isArray(rows) ? rows : []) {
    const id = coreId(row && row.plmId);
    if (!id || Object.prototype.hasOwnProperty.call(out, id)) continue;
    const details = detailsForEntry(models[id]);
    out[id] = details ? { plmFabric: details.plmFabric, plmArtwork: details.plmArtwork, plmArtworkEn: details.plmArtworkEn } : null;
  }
  for (const id of Object.keys(out)) if (!out[id]) delete out[id];
  return out;
}

module.exports = { detailsForRows, PARSED_FIELDS, SOURCE, coreId, detailsForEntry, detailsForIds, attachToRows, artworkText };
