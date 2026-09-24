'use strict';

/* ===================================================================
   OAB — FİLTRE METADATA CACHE (Season / MAG / Buyer Group seçenekleri)

   Kullanıcı talimatı: "OAB rapor datası cache'i ile filtre metadata cache'ini
   birbirinden ayrı tut." Bu depo, YALNIZ dropdown seçeneklerini (kullanıcı
   henüz hiçbir filtre seçmeden ÖNCE bile gösterilmesi gereken listeleri)
   tutar — gerçek rapor satırları oab-store.js'te, tamamen ayrı bir anahtar
   uzayında saklanır.

   Amaç: Overview > OAB açıldığında, cache doluysa PASS'e HİÇ bağlanmadan
   filtre seçeneklerini göstermek (kullanıcı akışı: metadata cache-first,
   PASS bağlantısı yalnız "Get OAB"/"Refresh OAB" anında ya da cache boşken
   kurulur).
   =================================================================== */

const fs = require('fs');
const path = require('path');
const { SERVER_DATA_ROOT } = require('../user-data');

const METADATA_FILE = path.join(SERVER_DATA_ROOT, 'oab-metadata.json');

function clean(value) { return String(value == null ? '' : value).trim(); }
function emptyStore() { return { seasons: null, mag: {}, buyerGroups: {} }; }

function load() {
  try {
    const raw = fs.readFileSync(METADATA_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return emptyStore();
    return {
      seasons: parsed.seasons && Array.isArray(parsed.seasons.options) ? parsed.seasons : null,
      mag: parsed.mag && typeof parsed.mag === 'object' ? parsed.mag : {},
      buyerGroups: parsed.buyerGroups && typeof parsed.buyerGroups === 'object' ? parsed.buyerGroups : {},
    };
  } catch (_) { return emptyStore(); }
}
function persist(store) {
  fs.mkdirSync(path.dirname(METADATA_FILE), { recursive: true });
  const tmp = `${METADATA_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(store), 'utf8');
  fs.renameSync(tmp, METADATA_FILE);
}

function getSeasons() { return load().seasons; } // {options, fetchedAt} | null
function setSeasons(options) {
  const store = load();
  store.seasons = { options: Array.isArray(options) ? options : [], fetchedAt: new Date().toISOString() };
  persist(store);
  return store.seasons;
}
function getMag(seasonRef) {
  const key = clean(seasonRef);
  if (!key) return null;
  return load().mag[key] || null;
}
function setMag(seasonRef, options) {
  const key = clean(seasonRef);
  if (!key) return null;
  const store = load();
  store.mag[key] = { options: Array.isArray(options) ? options : [], fetchedAt: new Date().toISOString() };
  persist(store);
  return store.mag[key];
}
function getBuyerGroups(merchSubGroupRef) {
  const key = clean(merchSubGroupRef);
  if (!key) return null;
  return load().buyerGroups[key] || null;
}
function setBuyerGroups(merchSubGroupRef, options) {
  const key = clean(merchSubGroupRef);
  if (!key) return null;
  const store = load();
  store.buyerGroups[key] = { options: Array.isArray(options) ? options : [], fetchedAt: new Date().toISOString() };
  persist(store);
  return store.buyerGroups[key];
}

module.exports = { getSeasons, setSeasons, getMag, setMag, getBuyerGroups, setBuyerGroups, METADATA_FILE };
