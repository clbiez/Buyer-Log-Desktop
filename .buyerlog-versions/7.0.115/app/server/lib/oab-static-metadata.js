'use strict';

/* ===================================================================
   OAB — BUNDLED FILTER METADATA

   Season / MAG / Buyer Group seçenekleri artık uygulamayla birlikte gelen
   oab_filter_metadata.json dosyasından okunur. Normal OAB kullanımında
   filtre seçerken PASS metadata servislerine bağlanılmaz; PASS bağlantısı
   yalnız gerçek rapor (GetReportData) istenince gerekir.

   Dosya server/resources altında tutulur (server/data DEĞİL), çünkü release
   arşivleyici server/data klasörünü kullanıcıya özel çalışma verisi olarak
   özellikle pakete dahil etmez.
   =================================================================== */

const fs = require('fs');
const path = require('path');

const METADATA_FILE = path.join(__dirname, '..', 'resources', 'oab_filter_metadata.json');

let cached = null;
let cachedMtimeMs = -1;

function cleanRef(value) {
  return String(value == null ? '' : value).trim();
}

function metadataError(message, code) {
  const err = new Error(message);
  err.code = code || 'OAB_STATIC_METADATA_INVALID';
  return err;
}

function assertMetadataShape(raw) {
  if (!raw || typeof raw !== 'object') throw metadataError('OAB filtre metadata dosyası geçersiz.');
  if (raw.reportRef !== 'OrderBudget_List_Report') throw metadataError('OAB filtre metadata rapor kimliği beklenen raporla eşleşmiyor.');
  if (!Array.isArray(raw.seasons)) throw metadataError('OAB filtre metadata içinde seasons dizisi bulunamadı.');

  for (const season of raw.seasons) {
    if (!season || season.ref == null || !Array.isArray(season.mags)) throw metadataError('OAB filtre metadata içinde geçersiz Season kaydı var.');
    for (const mag of season.mags) {
      if (!mag || mag.ref == null || !Array.isArray(mag.buyerGroups)) throw metadataError('OAB filtre metadata içinde geçersiz MAG kaydı var.');
      for (const buyer of mag.buyerGroups) {
        if (!buyer || buyer.ref == null) throw metadataError('OAB filtre metadata içinde geçersiz Buyer Group kaydı var.');
      }
    }
  }
}

function buildIndexes(raw) {
  const seasonByRef = new Map();
  const magByRef = new Map();
  const buyerByRef = new Map();

  for (const season of raw.seasons) {
    const seasonRef = cleanRef(season.ref);
    if (!seasonRef) continue;
    seasonByRef.set(seasonRef, season);

    for (const mag of season.mags || []) {
      const magRef = cleanRef(mag.ref);
      if (!magRef) continue;
      let merged = magByRef.get(magRef);
      if (!merged) {
        merged = { ref: mag.ref, name: mag.name || String(mag.ref), buyerGroups: [], _buyerSeen: new Set() };
        magByRef.set(magRef, merged);
      }
      if (!merged.name && mag.name) merged.name = mag.name;
      for (const buyer of mag.buyerGroups || []) {
        const buyerRef = cleanRef(buyer.ref);
        if (!buyerRef || merged._buyerSeen.has(buyerRef)) continue;
        merged._buyerSeen.add(buyerRef);
        const normalized = { ref: buyer.ref, name: buyer.name || String(buyer.ref) };
        merged.buyerGroups.push(normalized);
        if (!buyerByRef.has(buyerRef)) buyerByRef.set(buyerRef, normalized);
      }
    }
  }
  for (const mag of magByRef.values()) delete mag._buyerSeen;

  const computedCounts = {
    seasons: seasonByRef.size,
    uniqueMags: magByRef.size,
    uniqueBuyerGroups: buyerByRef.size,
  };

  if (raw.counts && typeof raw.counts === 'object') {
    for (const key of Object.keys(computedCounts)) {
      if (Number.isFinite(Number(raw.counts[key])) && Number(raw.counts[key]) !== computedCounts[key]) {
        throw metadataError(`OAB filtre metadata sayımı uyuşmuyor: ${key}=${raw.counts[key]}, hesaplanan=${computedCounts[key]}.`);
      }
    }
  }

  return { raw, seasonByRef, magByRef, buyerByRef, computedCounts };
}

function load() {
  let stat;
  try { stat = fs.statSync(METADATA_FILE); }
  catch (err) { throw metadataError(`OAB filtre metadata dosyası bulunamadı: ${METADATA_FILE}`, 'OAB_STATIC_METADATA_MISSING'); }

  if (cached && cachedMtimeMs === stat.mtimeMs) return cached;

  let raw;
  try { raw = JSON.parse(fs.readFileSync(METADATA_FILE, 'utf8')); }
  catch (err) { throw metadataError(`OAB filtre metadata dosyası okunamadı: ${err.message}`, 'OAB_STATIC_METADATA_PARSE_FAILED'); }

  assertMetadataShape(raw);
  cached = buildIndexes(raw);
  cachedMtimeMs = stat.mtimeMs;
  return cached;
}

function getInfo() {
  const data = load();
  return {
    schemaVersion: data.raw.schemaVersion || 1,
    reportRef: data.raw.reportRef,
    generatedAt: data.raw.generatedAt || '',
    counts: { ...data.computedCounts },
    source: 'bundled-json',
  };
}

function getSeasons() {
  const data = load();
  return data.raw.seasons.map(season => ({
    SeasonRef: season.ref,
    Name: season.name || String(season.ref),
  }));
}

function getMag(seasonRef) {
  const data = load();
  const season = data.seasonByRef.get(cleanRef(seasonRef));
  if (!season) return [];
  return (season.mags || []).map(mag => ({
    MerchSubGroupRef: mag.ref,
    Name: mag.name || String(mag.ref),
  }));
}

function getBuyerGroups(merchSubGroupRef) {
  const data = load();
  const mag = data.magByRef.get(cleanRef(merchSubGroupRef));
  if (!mag) return [];
  return mag.buyerGroups.map(buyer => ({
    BuyerGroupRef: buyer.ref,
    Name: buyer.name || String(buyer.ref),
  }));
}

/* v7.20 — ÇOKLU SEÇİM PLANLAYICISI İÇİN REF ERİŞİMLERİ.

   Dikkat: getBuyerGroups(mag) sezonlar arası BİRLEŞİK listeyi döndürür (filtre
   açılırı için doğru davranış). Planlama ise (Sezon, MAG) ikilisine ait GERÇEK
   listeyi ister — birleşik listeyi kullanmak, o sezonda karşılığı olmayan
   kombinasyonlar için PASS'e boşuna gitmek demek olurdu. */
function seasonRefs() {
  const data = load();
  return data.raw.seasons.map(season => season.ref);
}
function magRefsForSeason(seasonRefValue) {
  const data = load();
  const season = data.seasonByRef.get(cleanRef(seasonRefValue));
  return season ? (season.mags || []).map(mag => mag.ref) : [];
}
function buyerGroupRefsFor(seasonRefValue, merchSubGroupRefValue) {
  const data = load();
  const season = data.seasonByRef.get(cleanRef(seasonRefValue));
  if (!season) return [];
  const mag = (season.mags || []).find(item => cleanRef(item.ref) === cleanRef(merchSubGroupRefValue));
  return mag ? (mag.buyerGroups || []).map(buyer => buyer.ref) : [];
}
// Planlayıcının beklediği arayüz; server.js bunu doğrudan geçirir.
function planningMetadata() {
  return { seasonRefs, magRefsForSeason, buyerGroupRefsFor };
}
// Ekranda ref değil AD gösterilir: "20261" değil "S6-2026 YAZ".
function labelsFor({ seasonRef, merchSubGroupRef, buyerGroupRef } = {}) {
  const data = load();
  const out = {};
  if (seasonRef != null) {
    const season = data.seasonByRef.get(cleanRef(seasonRef));
    out.season = season ? (season.name || String(season.ref)) : cleanRef(seasonRef);
  }
  if (merchSubGroupRef != null) {
    const mag = data.magByRef.get(cleanRef(merchSubGroupRef));
    out.mag = mag ? (mag.name || String(mag.ref)) : cleanRef(merchSubGroupRef);
  }
  if (buyerGroupRef != null) {
    const buyer = data.buyerByRef.get(cleanRef(buyerGroupRef));
    out.buyerGroup = buyer ? (buyer.name || String(buyer.ref)) : cleanRef(buyerGroupRef);
  }
  return out;
}

function validateSelectedRefs({ seasonRef, merchSubGroupRef, buyerGroupRef } = {}) {
  const data = load();
  const season = data.seasonByRef.get(cleanRef(seasonRef));
  if (!season) return { ok: false, field: 'seasonRef' };
  const mag = (season.mags || []).find(item => cleanRef(item.ref) === cleanRef(merchSubGroupRef));
  if (!mag) return { ok: false, field: 'merchSubGroupRef' };
  const buyer = (mag.buyerGroups || []).find(item => cleanRef(item.ref) === cleanRef(buyerGroupRef));
  if (!buyer) return { ok: false, field: 'buyerGroupRef' };
  return { ok: true };
}

module.exports = {
  METADATA_FILE,
  getInfo,
  getSeasons,
  getMag,
  getBuyerGroups,
  validateSelectedRefs,
  seasonRefs, magRefsForSeason, buyerGroupRefsFor, planningMetadata, labelsFor,
  _load: load,
};
