'use strict';

/* Model görselinin SAHİBİ kim?
 *
 * SORUN: overrides.imagemap yalnız "bu model/renk kimliği şu anda şu görsele
 * sahip" der. Görselin kullanıcının elle seçtiği bir görsel mi, otomatik PLM
 * senkronunun yazdığı bir görsel mi olduğunu TAŞIMAZ. Bu yüzden otomatik bir
 * senkron kullanıcının elle koyduğu görseli sessizce ezebiliyordu; tersi de
 * mümkündü (PLM'de görsel bulunamayınca geçerli bir manuel görselin silinmesi).
 *
 * ÇÖZÜM: imagemap sözleşmesine DOKUNMADAN ayrı ve küçük bir sahiplik kaydı.
 * Yalnız OTOMATİK yazımlar buraya kaydedilir. Kural:
 *
 *   imagemap'te dolu bir referans var + sahiplik kaydı YOK      -> MANUEL
 *   imagemap'te dolu bir referans var + kayıt var ama ref farklı -> MANUEL
 *   imagemap'te dolu bir referans var + kayıt var ve ref aynı    -> OTOMATİK
 *   imagemap boş / mezar taşı / hiç yok                          -> SAHİPSİZ
 *
 * Böylece kayıt dosyası KAYBOLSA bile davranış güvenli tarafa düşer: her şey
 * manuel sayılır, hiçbir kullanıcı görseli ezilmez.
 *
 * Kayıt aynı zamanda önbellek kimliğini tutar (styleOptionImageId,
 * attachmentAssociationId veya paket içerik özeti). Aynı kaynak kimliği
 * yeniden görüldüğünde görsel TEKRAR İNDİRİLMEZ.
 */

const path = require('path');
const { SERVER_DATA_ROOT, atomicWriteJson } = require('../user-data');
const { readJsonWithValidatedBackup } = require('./safe-json-read');

const FILE = path.join(SERVER_DATA_ROOT, 'plm-image-ownership.json');
const MAX_ENTRIES = 200000;
const SCHEMA_VERSION = 1;

const OWNER_PLM = 'plm';
const OWNER_PACKAGE = 'package';
/* v11.10 — ASAS da artık kaydedilen bir OTOMATİK kaynaktır.
   Eskiden ASAS görselleri hiçbir sahiplik kaydı bırakmıyordu; sonuç olarak
   sahiplik çıkarımı onları MANUEL sayıyor ve kaynak KÖKENİ (ASAS mı PLM mi)
   hiçbir yerde yazmıyordu. Paylaşılan dağıtımda köken zorunludur: bir ASAS
   isteği PLM kökenli bir nesneyle karşılanamaz. */
const OWNER_ASAS = 'asas';
const AUTOMATIC_OWNERS = new Set([OWNER_PLM, OWNER_PACKAGE, OWNER_ASAS]);

/* owner -> paylaşılan dağıtım kaydındaki kaynak kökeni. */
const PROVENANCE = { [OWNER_PLM]: 'PLM', [OWNER_PACKAGE]: 'PACKAGE', [OWNER_ASAS]: 'ASAS' };
function provenanceOf(owner) {
  return PROVENANCE[clean(owner, 20).toLowerCase()] || '';
}

const OWNERSHIP_MANUAL = 'manual';
const OWNERSHIP_AUTOMATIC = 'automatic';
const OWNERSHIP_UNOWNED = 'unowned';

function clean(value, max = 200) {
  return String(value == null ? '' : value).replace(/\u0000/g, '').trim().slice(0, max);
}

function emptyStore() {
  return { schemaVersion: SCHEMA_VERSION, owners: {}, manual: {}, _updatedAt: null };
}

function normalizeRecord(raw) {
  const imageRef = clean(raw && raw.imageRef, 120);
  const owner = clean(raw && raw.owner, 20).toLowerCase();
  if (!imageRef || !AUTOMATIC_OWNERS.has(owner)) return null;
  return {
    owner,
    imageRef,
    sourceType: clean(raw && raw.sourceType, 40).toUpperCase(),
    sourceIdentity: clean(raw && raw.sourceIdentity, 200),
    hash: clean(raw && raw.hash, 80),
    styleId: clean(raw && raw.styleId, 40),
    at: clean(raw && raw.at, 40) || null,
    /* Dağıtım alanları. Yayım kuyruğu ve tazelik politikası bunları okur;
       eski kayıtlarda yoklar ve yokluğu davranışı bozmaz. */
    mimeType: clean(raw && raw.mimeType, 60).toLowerCase(),
    bytes: Math.max(0, Math.trunc(Number(raw && raw.bytes) || 0)),
    sourceFetchedAt: clean(raw && raw.sourceFetchedAt, 40) || clean(raw && raw.at, 40) || null,
    sharedRevision: Math.max(0, Math.trunc(Number(raw && raw.sharedRevision) || 0)),
    publishedAt: clean(raw && raw.publishedAt, 40) || null,
  };
}

/* MANUEL SAHİPLİK KAYDI — kullanıcılar arasında taşınabilir olması için.
 *
 * Yerel çıkarım ("kayıt yoksa manuel") tek makinede güvenliydi ama AĞ ÜZERİNDEN
 * TAŞINAMIYORDU: B kullanıcısının diskinde A'nın manuel kararına dair hiçbir iz
 * yoktu. Bu küçük kayıt manuel kararı AÇIK bir olguya çevirir; paylaşılan
 * manifestodan MANUAL sahipli bir kayıt çekildiğinde de buraya yazılır, böylece
 * B'nin otomatik senkronu A'nın elle koyduğu görseli EZEMEZ. */
function normalizeManualRecord(raw) {
  const imageRef = clean(raw && raw.imageRef, 120);
  if (!imageRef) return null;
  return {
    imageRef,
    hash: clean(raw && raw.hash, 80),
    mimeType: clean(raw && raw.mimeType, 60).toLowerCase(),
    bytes: Math.max(0, Math.trunc(Number(raw && raw.bytes) || 0)),
    deviceId: clean(raw && raw.deviceId, 80),
    sharedRevision: Math.max(0, Math.trunc(Number(raw && raw.sharedRevision) || 0)),
    at: clean(raw && raw.at, 40) || null,
  };
}

function normalizeStore(raw) {
  const out = emptyStore();
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  out._updatedAt = clean(raw._updatedAt, 40) || null;
  const source = raw.owners && typeof raw.owners === 'object' && !Array.isArray(raw.owners) ? raw.owners : {};
  for (const [key, value] of Object.entries(source).slice(0, MAX_ENTRIES)) {
    const canonicalKey = clean(key, 300);
    const record = normalizeRecord(value);
    if (canonicalKey && record) out.owners[canonicalKey] = record;
  }
  const manual = raw.manual && typeof raw.manual === 'object' && !Array.isArray(raw.manual) ? raw.manual : {};
  for (const [key, value] of Object.entries(manual).slice(0, MAX_ENTRIES)) {
    const canonicalKey = clean(key, 300);
    const record = normalizeManualRecord(value);
    if (canonicalKey && record) out.manual[canonicalKey] = record;
  }
  return out;
}

function loadOwnership() {
  return readJsonWithValidatedBackup(FILE, {
    fallback: emptyStore,
    normalize: normalizeStore,
    restore: value => atomicWriteJson(FILE, value),
  });
}

function saveOwnership(store) {
  const normalized = normalizeStore(store);
  normalized._updatedAt = new Date().toISOString();
  atomicWriteJson(FILE, normalized);
  return normalized;
}

function recordOf(store, key) {
  const canonicalKey = clean(key, 300);
  const owners = store && store.owners && typeof store.owners === 'object' ? store.owners : {};
  if (!canonicalKey || !Object.prototype.hasOwnProperty.call(owners, canonicalKey)) return null;
  return owners[canonicalKey] || null;
}

/* Tek gerçek karar noktası. currentRef imagemap'ten okunan referanstır;
   boş string MEZAR TAŞIDIR ("kullanıcı bunu kaldırdı") ve otomatik senkron
   açısından SAHİPSİZ sayılır — v6.38 kararı gereği eksik görsel yeniden
   yüklenir. */
function manualRecordOf(store, key) {
  const canonicalKey = clean(key, 300);
  const manual = store && store.manual && typeof store.manual === 'object' ? store.manual : {};
  if (!canonicalKey || !Object.prototype.hasOwnProperty.call(manual, canonicalKey)) return null;
  return manual[canonicalKey] || null;
}

function ownershipOf(store, key, currentRef) {
  const ref = clean(currentRef, 120);
  if (!ref) return { state: OWNERSHIP_UNOWNED, record: null };
  /* AÇIK manuel kayıt her şeyin önündedir: bu, bu makinede ya da paylaşılan
     manifestodan gelen BAŞKA bir kullanıcının elle verdiği karardır. */
  const manual = manualRecordOf(store, key);
  if (manual && manual.imageRef === ref) return { state: OWNERSHIP_MANUAL, record: null, manual };
  const record = recordOf(store, key);
  if (record && record.imageRef === ref) return { state: OWNERSHIP_AUTOMATIC, record };
  return { state: OWNERSHIP_MANUAL, record: record || null, manual: manual || null };
}

function isManual(store, key, currentRef) {
  return ownershipOf(store, key, currentRef).state === OWNERSHIP_MANUAL;
}

/* Otomatik kaynağın bu kimliği yazmasına izin var mı?
   Manuel görsel yalnız kullanıcı AÇIKÇA üzerine yazmayı seçtiyse değişir. */
function canWriteAutomatic(store, key, currentRef, { overwriteManual = false } = {}) {
  const ownership = ownershipOf(store, key, currentRef);
  if (ownership.state !== OWNERSHIP_MANUAL) return { allowed: true, ...ownership };
  return { allowed: overwriteManual === true, ...ownership };
}

/* Aynı kaynak kimliği zaten bu kimlikte duruyor ve dosya kullanılabilir mi?
   Evetse görsel TEKRAR İNDİRİLMEZ (önbellek isabeti). */
function isCacheHit(store, key, currentRef, sourceIdentity, { hasStoredFile = true } = {}) {
  const identity = clean(sourceIdentity, 200);
  if (!identity || !hasStoredFile) return false;
  const ownership = ownershipOf(store, key, currentRef);
  if (ownership.state !== OWNERSHIP_AUTOMATIC || !ownership.record) return false;
  return ownership.record.sourceIdentity === identity;
}

/* Otomatik yazımları kaydeder. Yalnız gerçekten değişen kayıtlar yazılır:
   binlerce kayıtlık dosya her turda boşuna diske inmesin. */
function rememberAutomatic(entries, { store = loadOwnership(), persist = saveOwnership } = {}) {
  const now = new Date().toISOString();
  let changed = 0;
  for (const entry of Array.isArray(entries) ? entries : []) {
    const key = clean(entry && entry.key, 300);
    const record = normalizeRecord({ ...entry, at: clean(entry && entry.at, 40) || now });
    if (!key || !record) continue;
    const previous = store.owners[key];
    if (previous && previous.owner === record.owner && previous.imageRef === record.imageRef
      && previous.sourceIdentity === record.sourceIdentity && previous.hash === record.hash) continue;
    store.owners[key] = record;
    changed += 1;
  }
  if (!changed) return { store, changed: 0 };
  return { store: persist(store), changed };
}

/* Kullanıcı elle görsel koyduğunda / sildiğinde otomatik sahiplik düşer.
   Aksi hâlde manuel bir görsel eski otomatik kaydı yüzünden "otomatik"
   sayılıp bir sonraki senkronda ezilebilirdi. */
function forget(keys, { store = loadOwnership(), persist = saveOwnership } = {}) {
  let changed = 0;
  for (const key of Array.isArray(keys) ? keys : [keys]) {
    const canonicalKey = clean(key, 300);
    if (canonicalKey && Object.prototype.hasOwnProperty.call(store.owners, canonicalKey)) {
      delete store.owners[canonicalKey];
      changed += 1;
    }
  }
  if (!changed) return { store, changed: 0 };
  return { store: persist(store), changed };
}

/* Manuel kararı AÇIKÇA kaydeder. İki çağıran vardır: kullanıcı bu makinede
   elle görsel bağladığında, ve paylaşılan manifestodan MANUAL sahipli bir
   kayıt yerel depoya kurulduğunda. Otomatik kayıt aynı anda DÜŞER — aksi hâlde
   çıkarım onu "otomatik" sayıp bir sonraki senkronda ezerdi. */
function rememberManual(entries, { store = loadOwnership(), persist = saveOwnership } = {}) {
  const now = new Date().toISOString();
  let changed = 0;
  for (const entry of Array.isArray(entries) ? entries : [entries]) {
    const key = clean(entry && entry.key, 300);
    const record = normalizeManualRecord({ ...entry, at: clean(entry && entry.at, 40) || now });
    if (!key || !record) continue;
    const previous = store.manual[key];
    if (Object.prototype.hasOwnProperty.call(store.owners, key)) { delete store.owners[key]; changed += 1; }
    if (previous && previous.imageRef === record.imageRef && previous.hash === record.hash
      && previous.sharedRevision === record.sharedRevision) continue;
    store.manual[key] = record;
    changed += 1;
  }
  if (!changed) return { store, changed: 0 };
  return { store: persist(store), changed };
}

/* Manuel kaydı düşürür (kullanıcı görseli kaldırdı ya da otomatik kaynağa
   geri döndü). Mezar taşı yayımı ayrı yapılır; burası yalnız yerel karardır. */
function forgetManual(keys, { store = loadOwnership(), persist = saveOwnership } = {}) {
  let changed = 0;
  for (const key of Array.isArray(keys) ? keys : [keys]) {
    const canonicalKey = clean(key, 300);
    if (canonicalKey && Object.prototype.hasOwnProperty.call(store.manual, canonicalKey)) {
      delete store.manual[canonicalKey];
      changed += 1;
    }
  }
  if (!changed) return { store, changed: 0 };
  return { store: persist(store), changed };
}

function summarize(store = loadOwnership()) {
  const records = Object.values((store && store.owners) || {});
  const bySource = {};
  for (const record of records) bySource[record.sourceType || 'UNKNOWN'] = (bySource[record.sourceType || 'UNKNOWN'] || 0) + 1;
  const byProvenance = {};
  for (const record of records) byProvenance[provenanceOf(record.owner) || 'UNKNOWN'] = (byProvenance[provenanceOf(record.owner) || 'UNKNOWN'] || 0) + 1;
  return {
    total: records.length, bySource, byProvenance,
    manual: Object.keys((store && store.manual) || {}).length,
    updatedAt: (store && store._updatedAt) || null,
  };
}

module.exports = {
  FILE,
  SCHEMA_VERSION,
  OWNER_PLM,
  OWNER_PACKAGE,
  OWNER_ASAS,
  PROVENANCE,
  provenanceOf,
  normalizeManualRecord,
  manualRecordOf,
  rememberManual,
  forgetManual,
  OWNERSHIP_MANUAL,
  OWNERSHIP_AUTOMATIC,
  OWNERSHIP_UNOWNED,
  emptyStore,
  normalizeStore,
  loadOwnership,
  saveOwnership,
  recordOf,
  ownershipOf,
  isManual,
  canWriteAutomatic,
  isCacheHit,
  rememberAutomatic,
  forget,
  summarize,
};
