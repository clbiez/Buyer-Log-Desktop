'use strict';

/* ===================================================================
   OAB — KULLANICI BAZLI SON SNAPSHOT / SEÇİM DURUMU

   Amaç:
   - Son başarılı OAB raporunda kullanılan Season/MAG/Buyer seçimini hatırla.
   - Son başarılı OAB snapshot'ını kullanıcı bazında kalıcı tut.
   - Uygulama yeniden açıldığında PASS'e gitmeden aynı snapshot ile devam et.

   Bu depo Authorization/token içermez. Yalnız filtre ref'leri, satırlar, alanlar
   ve snapshot zamanı saklanır. LOCAL_DATA_ROOT kullanıldığı için yeni Buyer Log
   paketine geçildiğinde de kullanıcı durumunun korunması hedeflenir.
   =================================================================== */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { LOCAL_DATA_ROOT, atomicWriteBuffer } = require('../user-data');

const ROOT = path.join(LOCAL_DATA_ROOT, 'oab-snapshots');
const SCHEMA_VERSION = 1;

function safeUserId(value) {
  return String(value || 'moderator').replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 100) || 'moderator';
}
function cleanRef(value) { return String(value == null ? '' : value).trim(); }
function filePathFor(userId) { return path.join(ROOT, `${safeUserId(userId)}.json.gz`); }

function cleanRefList(value, single) {
  const list = Array.isArray(value) ? value : [];
  const seen = new Set(), out = [];
  for (const item of list) {
    const ref = cleanRef(item);
    if (!ref || seen.has(ref)) continue;
    seen.add(ref); out.push(ref);
  }
  if (out.length) return out;
  const one = cleanRef(single);
  return one ? [one] : [];
}

/* v7.23 — ÇOKLU SEÇİM SNAPSHOT'A DA YAZILIR.

   v7.20'de çoklu seçim eklendiğinde toplu iş, seçimi ÇOĞUL alanlarla
   (seasonRefs/merchSubGroupRefs/buyerGroupRefs) kaydetmeye başladı; bu depo
   ise yalnız TEKİL alanları yazıyordu. Sonuç: çoklu seçimle çekilen her
   raporun seçimi boş kaydediliyor, program yeniden açıldığında istemci
   seçimi doğrulayamayıp son snapshot'ı hiç geri yükleyemiyordu.

   Artık ikisi de yazılır. SCHEMA_VERSION BİLEREK ARTIRILMADI: sürüm
   değişirse load() eldeki bütün snapshot'ları reddeder ve kullanıcılar
   yükseltmede son raporlarını kaybederdi. Eski dosyalarda çoğul alanlar
   yoktur; istemci zaten tekilden diziye düşüyor. */
function normalizePayload(payload) {
  const src = payload && typeof payload === 'object' ? payload : {};
  const selection = src.selection && typeof src.selection === 'object' ? src.selection : {};
  const seasonRefs = cleanRefList(selection.seasonRefs, selection.seasonRef);
  const merchSubGroupRefs = cleanRefList(selection.merchSubGroupRefs, selection.merchSubGroupRef);
  const buyerGroupRefs = cleanRefList(selection.buyerGroupRefs, selection.buyerGroupRef);
  return {
    schemaVersion: SCHEMA_VERSION,
    savedAt: new Date().toISOString(),
    selection: {
      seasonRef: seasonRefs[0] || '',
      merchSubGroupRef: merchSubGroupRefs[0] || '',
      buyerGroupRef: buyerGroupRefs[0] || '',
      seasonRefs,
      merchSubGroupRefs,
      buyerGroupRefs,
      allBuyerGroups: Boolean(selection.allBuyerGroups),
    },
    snapshot: {
      rows: Array.isArray(src.rows) ? src.rows : [],
      fields: Array.isArray(src.fields) ? src.fields : [],
      fetchedAt: src.fetchedAt || new Date().toISOString(),
      fromCache: Boolean(src.fromCache),
    },
  };
}

function save(userId, payload) {
  const value = normalizePayload(payload);
  const buffer = zlib.gzipSync(Buffer.from(JSON.stringify(value), 'utf8'), { level: 6 });
  const file = filePathFor(userId);
  atomicWriteBuffer(file, buffer);
  return { savedAt: value.savedAt, fetchedAt: value.snapshot.fetchedAt, rows: value.snapshot.rows.length };
}

function load(userId) {
  const file = filePathFor(userId);
  for (const candidate of [file, file + '.bak']) {
    if (!fs.existsSync(candidate)) continue;
    try {
      const raw = zlib.gunzipSync(fs.readFileSync(candidate));
      const parsed = JSON.parse(raw.toString('utf8'));
      if (!parsed || parsed.schemaVersion !== SCHEMA_VERSION) continue;
      if (!parsed.selection || !parsed.snapshot || !Array.isArray(parsed.snapshot.rows) || !Array.isArray(parsed.snapshot.fields)) continue;
      return parsed;
    } catch (_) { /* yedek kopyayı dene */ }
  }
  return null;
}

function clear(userId) {
  const file = filePathFor(userId);
  let removed = false;
  for (const candidate of [file, file + '.bak']) {
    try { fs.unlinkSync(candidate); removed = true; } catch (err) { if (err && err.code !== 'ENOENT') throw err; }
  }
  return removed;
}

module.exports = { ROOT, SCHEMA_VERSION, filePathFor, save, load, clear };
