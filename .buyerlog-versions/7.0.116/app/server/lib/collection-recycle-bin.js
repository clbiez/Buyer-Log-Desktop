'use strict';

/* KOLEKSİYON GERİ DÖNÜŞÜM KUTUSU (v5.97)

   Silinen Koleksiyon modelleri 30 gün saklanır ve geri çağrılabilir.

   Neden ayrı bir dosya: çalışma alanı (collection-workspaces) her kayıtta
   BÜTÜN olarak yeniden yazılıyor. Silinen satırları orada tutmak, her kayıtta
   taşınan veriyi büyütür ve satır sayısı sınırlarını yer. Ayrı depo, silinen
   kaydın çalışma alanının revizyon zincirinden bağımsız yaşamasını da sağlar.

   Satırlar OLDUĞU GİBİ saklanır — modele ait tüm alanlar, Pricing History
   bağlantısı (rowId), Confirmed Supplier/FOB ve kullanıcı girişleri dahil.
   Alan seçmek, ileride eklenen bir alanın sessizce kaybolması demekti.

   Temizlik okuma anında yapılır: ayrı bir zamanlayıcıya bağlı olmayan bir
   sistemde 30 günlük sınır ancak böyle güvenilir şekilde uygulanır. */

const fs = require('fs');
const path = require('path');
const { SERVER_DATA_ROOT, atomicWriteJson } = require('../user-data');
const { readJsonWithValidatedBackup } = require('./safe-json-read');

const ROOT = path.join(SERVER_DATA_ROOT, 'collection-recycle-bin');
const RETENTION_DAYS = 30;
const RETENTION_MS = RETENTION_DAYS * 24 * 60 * 60 * 1000;
const MAX_ENTRIES = 20000;

function safeId(value) {
  return String(value || '').replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 100) || 'anonymous';
}
function binFile(ownerId) { return path.join(ROOT, `${safeId(ownerId)}.json`); }
function cleanObject(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }

function normalizeEntry(entry) {
  const item = cleanObject(entry);
  const deletedAt = typeof item.deletedAt === 'string' && item.deletedAt ? item.deletedAt : new Date().toISOString();
  return {
    // Kayıt kimliği satır kimliğinden AYRIDIR: aynı satır silinip geri
    // yüklendikten sonra tekrar silinebilir; her silme ayrı bir kayıttır.
    entryId: String(item.entryId || '') || `bin-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    deletedAt,
    deletedBy: String(item.deletedBy || ''),
    deletedByName: String(item.deletedByName || ''),
    reason: String(item.reason || 'manual').slice(0, 40),
    rowId: Number.isFinite(Number(item.rowId)) ? Number(item.rowId) : null,
    plmId: String(item.plmId == null ? '' : item.plmId).slice(0, 120),
    modelName: String(item.modelName == null ? '' : item.modelName).slice(0, 200),
    season: String(item.season == null ? '' : item.season).slice(0, 60),
    row: cleanObject(item.row),
  };
}

function isExpired(entry, now) {
  const time = Date.parse(entry && entry.deletedAt);
  if (!Number.isFinite(time)) return false;
  return now - time > RETENTION_MS;
}

function readRaw(ownerId) {
  const file = binFile(ownerId);
  const value = readJsonWithValidatedBackup(file, {
    fallback: () => ({ entries: [] }),
    restore: restored => atomicWriteJson(file, restored),
  });
  return Array.isArray(value && value.entries) ? value.entries : [];
}

function writeEntries(ownerId, entries) {
  fs.mkdirSync(ROOT, { recursive: true });
  const saved = {
    schemaVersion: 1,
    ownerId: String(ownerId || ''),
    retentionDays: RETENTION_DAYS,
    entries: entries.slice(0, MAX_ENTRIES),
    _updatedAt: new Date().toISOString(),
  };
  atomicWriteJson(binFile(ownerId), saved);
  return saved;
}

/** Süresi dolmuş kayıtları atarak listeyi döndürür; atılan varsa dosyaya yazar. */
function loadBin(ownerId, now = Date.now()) {
  const all = readRaw(ownerId).map(normalizeEntry);
  const kept = all.filter(entry => !isExpired(entry, now));
  if (kept.length !== all.length) writeEntries(ownerId, kept);
  // En son silinen en üstte.
  kept.sort((a, b) => String(b.deletedAt).localeCompare(String(a.deletedAt)));
  return { ownerId: String(ownerId || ''), retentionDays: RETENTION_DAYS, entries: kept, purged: all.length - kept.length };
}

function addEntries(ownerId, list, meta = {}, now = Date.now()) {
  const incoming = (Array.isArray(list) ? list : []).map(item => normalizeEntry({
    ...item,
    deletedAt: new Date(now).toISOString(),
    deletedBy: meta.deletedBy,
    deletedByName: meta.deletedByName,
    reason: item && item.reason ? item.reason : meta.reason,
  }));
  if (!incoming.length) return loadBin(ownerId, now);
  const current = loadBin(ownerId, now).entries;
  writeEntries(ownerId, [...incoming, ...current]);
  return loadBin(ownerId, now);
}

/** Kayıtları kutudan çıkarır ve içeriklerini döndürür (geri yükleme için). */
function takeEntries(ownerId, entryIds, now = Date.now()) {
  const wanted = new Set((Array.isArray(entryIds) ? entryIds : []).map(String));
  if (!wanted.size) return { taken: [], bin: loadBin(ownerId, now) };
  const current = loadBin(ownerId, now).entries;
  const taken = current.filter(entry => wanted.has(entry.entryId));
  if (taken.length) writeEntries(ownerId, current.filter(entry => !wanted.has(entry.entryId)));
  return { taken, bin: loadBin(ownerId, now) };
}

function removeEntries(ownerId, entryIds, now = Date.now()) {
  return takeEntries(ownerId, entryIds, now).bin;
}

module.exports = { loadBin, addEntries, takeEntries, removeEntries, normalizeEntry, isExpired, RETENTION_DAYS, RETENTION_MS, safeId };
