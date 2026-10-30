'use strict';

/* ===================================================================
   v2026-10-30 — ASAS ⇄ IAS ALAN EŞLEME HAFIZASI

   Kullanıcı kararı: "ASAS'ta X sütununu filtre için seçtiğimde IAS'ta da
   eşleşen başlık otomatik seçilsin. Otomatik eşleşme hatalı olabilir; manuel
   de seçilebilsin. Manuel seçilen eşleşmeyi hatırla."

   Bu modül YALNIZ alan eşdeğerliğini saklar: "ASAS · Buyer Grup ⇄ IAS ·
   Buyer Grup", "ASAS · Product ⇄ IAS · Ürün". Filtre DEĞERİ saklamaz; değer
   her filtrenin kendi kaydıdır. Kayıt ekip geneli ortak ayarlarda durur:
   bir kullanıcının düzelttiği eşleme diğerlerinin önerisini de düzeltir.
   Öneri her zaman ekranda yan yana görünür ve elle değiştirilebilir; hafıza
   bir karar değil, ilk tahmindir.

   `to: null` bilinçli "karşılığı yok" kararıdır: otomatik eşleme yanlış bir
   alan önerdiğinde kullanıcı "eşleme yok" seçerse, aynı yanlış öneri bir
   daha gelmez.

   SAF MODÜL: disk ve ağ yok.
   =================================================================== */

const MAX_PAIRS = 300;
const ROLES = new Set(['asas', 'antrepo']);

function clean(value) { return String(value == null ? '' : value).replace(/\s+/g, ' ').trim(); }
function fold(value) { return clean(value).toLocaleLowerCase('tr-TR'); }

function normalizeEnd(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const table = clean(raw.table).slice(0, 160);
  const name = clean(raw.name).slice(0, 160);
  const field = clean(raw.field || raw.header || name).slice(0, 200);
  if (!name && !field) return null;
  return { table, name, field };
}

/** Kaynak alanın kimliği: tablo + fiziksel sütun (yoksa başlık). */
function endKey(end) {
  if (!end) return '';
  return `${fold(end.table)}|${fold(end.name || end.field)}`;
}

function pairKey(fromRole, toRole, from) {
  return `${fold(fromRole)}>${fold(toRole)}>${endKey(from)}`;
}

function normalizePair(raw) {
  const item = raw && typeof raw === 'object' ? raw : {};
  const fromRole = fold(item.fromRole) || 'asas';
  const toRole = fold(item.toRole) || 'antrepo';
  if (!ROLES.has(fromRole) || !ROLES.has(toRole) || fromRole === toRole) return null;
  const from = normalizeEnd(item.from);
  if (!from) return null;
  // `to` null olabilir (bilinçli "karşılığı yok"); geçersiz nesne ise kayıt düşer.
  const to = item.to == null ? null : normalizeEnd(item.to);
  if (item.to != null && !to) return null;
  return {
    fromRole, toRole, from, to,
    updatedAt: clean(item.updatedAt).slice(0, 40),
    updatedBy: clean(item.updatedBy).slice(0, 80),
  };
}

/** Listeyi normalleştirir; aynı kaynak alan için SON kayıt kazanır. */
function normalizePairs(raw) {
  const byKey = new Map();
  for (const entry of Array.isArray(raw) ? raw : []) {
    const pair = normalizePair(entry);
    if (!pair) continue;
    const key = pairKey(pair.fromRole, pair.toRole, pair.from);
    byKey.delete(key);
    byKey.set(key, pair);
  }
  // En yeni kayıtlar korunur; sınır aşılırsa en eskiler düşer.
  return [...byKey.values()].slice(-MAX_PAIRS);
}

/** Yeni kararları ekler/günceller. Değişmeyen kayıt zaman damgası almaz. */
function upsertPairs(list, incoming, meta = {}) {
  const current = normalizePairs(list);
  const at = clean(meta.at) || new Date().toISOString();
  const by = clean(meta.by);
  const byKey = new Map(current.map(pair => [pairKey(pair.fromRole, pair.toRole, pair.from), pair]));
  let changed = 0;
  for (const entry of Array.isArray(incoming) ? incoming : []) {
    const pair = normalizePair({ ...entry, updatedAt: at, updatedBy: by });
    if (!pair) continue;
    const key = pairKey(pair.fromRole, pair.toRole, pair.from);
    const existing = byKey.get(key);
    if (existing && endKey(existing.to) === endKey(pair.to) && fold((existing.to || {}).field) === fold((pair.to || {}).field)) continue;
    byKey.delete(key);
    byKey.set(key, pair);
    changed += 1;
  }
  return { items: normalizePairs([...byKey.values()]), changed };
}

/** Bir kaynak alan için hatırlanan karar; yoksa null. */
function lookupPair(list, fromRole, toRole, from) {
  const key = pairKey(fromRole, toRole, normalizeEnd(from));
  return (Array.isArray(list) ? list : []).find(pair => pair && pairKey(pair.fromRole, pair.toRole, pair.from) === key) || null;
}

module.exports = { MAX_PAIRS, normalizePairs, upsertPairs, lookupPair, endKey, normalizeEnd };
