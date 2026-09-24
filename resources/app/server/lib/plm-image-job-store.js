'use strict';

/* PLM GÖRSEL İŞİ — KALICI KONTROL NOKTASI.
 *
 * job-registry.js işleri BELLEKTE tutar: uygulama yeniden başlarsa iş kaydı
 * gider. 400-500 modellik bir iş için bu kabul edilebilirdi; birkaç bin
 * modellik bir iş için değil — sıfırdan başlamak hem süre hem CoreNectum
 * yükü demektir.
 *
 * Burada işin İSTEK LİSTESİ ve TAMAMLANANLAR diske yazılır. Yeniden
 * başlatmadan sonra iş kaldığı yerden sürer; "yalnız başarısızları yeniden
 * dene" de bu dosyadan beslenir.
 *
 * TASARIM: yazma KISILIR (her N kalemde bir + aşama değişiminde + bitişte).
 * 5.000 kalemlik bir işte her kalemde diske inmek işi yavaşlatırdı.
 * Dosya ATOMİK yazılır; yarım JSON bırakılmaz.
 *
 * TOKEN YOK: iş kaydında Bearer/erişim anahtarı ASLA tutulmaz. Kayıt yalnız
 * PLM ID + Renk Kodu + Style ID gibi iş verisi taşır.
 */

const fs = require('fs');
const path = require('path');
const { SERVER_DATA_ROOT, atomicWriteJson } = require('../user-data');
const { readJsonWithValidatedBackup } = require('./safe-json-read');

const ROOT = path.join(SERVER_DATA_ROOT, 'plm-image-jobs');
const SCHEMA_VERSION = 1;
const MAX_ITEMS = 200000;
const MAX_FAILURES = 5000;
const CHECKPOINT_EVERY = 25;
const MAX_JOB_FILES = 25;

const STATUS_PENDING = 'pending';
const STATUS_RESOLVING = 'resolving';
const STATUS_FETCHING_IMAGES = 'fetching-images';
const STATUS_DOWNLOADING = 'downloading';
const STATUS_COMPLETED = 'completed';
const STATUS_PARTIAL = 'partial';
const STATUS_FAILED = 'failed';
const STATUS_CANCELLED = 'cancelled';

const ACTIVE_STATUSES = new Set([STATUS_PENDING, STATUS_RESOLVING, STATUS_FETCHING_IMAGES, STATUS_DOWNLOADING]);
const TERMINAL_STATUSES = new Set([STATUS_COMPLETED, STATUS_PARTIAL, STATUS_FAILED, STATUS_CANCELLED]);

function clean(value, max = 200) {
  return String(value == null ? '' : value).replace(/\u0000/g, '').trim().slice(0, max);
}
function count(value) { const n = Math.trunc(Number(value)); return Number.isFinite(n) && n > 0 ? n : 0; }
function safeId(value) { return clean(value, 80).replace(/[^A-Za-z0-9_.-]/g, ''); }

function emptyCounts() {
  return {
    requested: 0, resolved: 0, unresolved: 0, stylesProcessed: 0, styleMetadataFailed: 0,
    optionImagesFound: 0, downloadsCompleted: 0, cacheHits: 0, fallbacksUsed: 0,
    manualPreserved: 0, missing: 0, failed: 0, bytesDownloaded: 0,
  };
}

function itemKey(item) {
  return `${clean(item && item.plmId, 40)}|${clean(item && item.colourCode, 40)}|${clean(item && item.colour, 80)}`;
}

function normalizeItem(raw) {
  return {
    plmId: clean(raw && raw.plmId, 40),
    colourCode: clean(raw && (raw.colourCode ?? raw.colorCode), 40),
    colour: clean(raw && (raw.colour ?? raw.color), 160),
    imageRole: ['main', 'option'].includes(clean(raw && raw.imageRole, 20).toLowerCase()) ? clean(raw && raw.imageRole, 20).toLowerCase() : 'auto',
    styleId: clean(raw && raw.styleId, 40),
    styleName: clean(raw && raw.styleName, 300),
  };
}

function normalizeFailure(raw) {
  return {
    plmId: clean(raw && raw.plmId, 40),
    colourCode: clean(raw && raw.colourCode, 40),
    colour: clean(raw && raw.colour, 160),
    styleName: clean(raw && raw.styleName, 300),
    code: clean(raw && raw.code, 60),
    error: clean(raw && raw.error, 400),
  };
}

function normalizeRecord(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const jobId = safeId(raw.jobId);
  if (!jobId) return null;
  const status = clean(raw.status, 40);
  return {
    schemaVersion: SCHEMA_VERSION,
    jobId,
    userId: clean(raw.userId, 80) || 'moderator',
    kind: clean(raw.kind, 40) || 'plm-images',
    scope: clean(raw.scope, 40) || 'genel',
    source: clean(raw.source, 40) || 'live',
    mode: raw.mode === 'all' ? 'all' : 'missing',
    overwriteManual: raw.overwriteManual === true,
    status: ACTIVE_STATUSES.has(status) || TERMINAL_STATUSES.has(status) ? status : STATUS_PENDING,
    phase: clean(raw.phase, 120),
    createdAt: clean(raw.createdAt, 40) || new Date().toISOString(),
    updatedAt: clean(raw.updatedAt, 40) || null,
    finishedAt: clean(raw.finishedAt, 40) || null,
    error: clean(raw.error, 400) || null,
    counts: { ...emptyCounts(), ...(raw.counts && typeof raw.counts === 'object' ? Object.fromEntries(Object.entries(raw.counts).map(([key, value]) => [key, count(value)])) : {}) },
    items: (Array.isArray(raw.items) ? raw.items : []).slice(0, MAX_ITEMS).map(normalizeItem).filter(item => item.plmId),
    done: [...new Set((Array.isArray(raw.done) ? raw.done : []).map(value => clean(value, 250)).filter(Boolean))].slice(0, MAX_ITEMS),
    failures: (Array.isArray(raw.failures) ? raw.failures : []).slice(0, MAX_FAILURES).map(normalizeFailure),
  };
}

function ensureRoot() {
  try { fs.mkdirSync(ROOT, { recursive: true }); } catch (error) { if (error.code !== 'EEXIST') throw error; }
  return ROOT;
}

function fileFor(jobId) {
  return path.join(ensureRoot(), `${safeId(jobId)}.json`);
}

function readRecord(jobId) {
  const file = fileFor(jobId);
  if (!safeId(jobId) || !fs.existsSync(file)) return null;
  return readJsonWithValidatedBackup(file, {
    fallback: () => null,
    normalize: value => normalizeRecord(value),
    restore: value => { if (value) atomicWriteJson(file, value); },
  });
}

function writeRecord(record) {
  const normalized = normalizeRecord(record);
  if (!normalized) return null;
  normalized.updatedAt = new Date().toISOString();
  atomicWriteJson(fileFor(normalized.jobId), normalized);
  return normalized;
}

function removeRecord(jobId) {
  const file = fileFor(jobId);
  try { fs.unlinkSync(file); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  try { fs.unlinkSync(file + '.bak'); } catch (_) {}
  return true;
}

function listRecords(userId = '') {
  const wanted = clean(userId, 80);
  let names = [];
  try { names = fs.readdirSync(ensureRoot()).filter(name => name.endsWith('.json')); } catch (_) { return []; }
  const records = [];
  for (const name of names) {
    const record = readRecord(name.slice(0, -'.json'.length));
    if (!record) continue;
    if (wanted && record.userId !== wanted) continue;
    records.push(record);
  }
  return records.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

/* Biten işlerin kaydı sınırsız büyümez. Çalışan iş ASLA budanmaz: uzun süren
   bir iş kendi kontrol noktasını kaybedemez. */
function pruneRecords(userId = '') {
  const finished = listRecords(userId).filter(record => TERMINAL_STATUSES.has(record.status));
  let removed = 0;
  for (const record of finished.slice(MAX_JOB_FILES)) { removeRecord(record.jobId); removed += 1; }
  return removed;
}

/* Bir iş için kontrol noktası tutamacı. `note` çağrıları bellekte birikir,
   diske yalnız eşik aşıldığında veya flush() çağrıldığında iner. */
function createCheckpoint(input = {}) {
  const record = normalizeRecord({
    ...input,
    status: input.status || STATUS_PENDING,
    createdAt: input.createdAt || new Date().toISOString(),
    counts: { ...emptyCounts(), requested: (Array.isArray(input.items) ? input.items : []).length, ...(input.counts || {}) },
  });
  if (!record) throw new Error('Kontrol noktası için jobId zorunlu.');
  const done = new Set(record.done);
  let dirty = 0;
  let persisted = writeRecord(record);

  function flush(force = false) {
    if (!force && dirty < CHECKPOINT_EVERY) return persisted;
    record.done = [...done];
    dirty = 0;
    persisted = writeRecord(record);
    return persisted;
  }

  return {
    jobId: record.jobId,
    record: () => ({ ...record, done: [...done] }),
    isDone: item => done.has(itemKey(item)),
    pending: () => record.items.filter(item => !done.has(itemKey(item))),
    complete(item) { done.add(itemKey(item)); dirty += 1; flush(); },
    phase(status, phase) {
      if (status) record.status = status;
      if (phase !== undefined) record.phase = clean(phase, 120);
      flush(true);
    },
    bump(patch = {}) {
      for (const [key, value] of Object.entries(patch)) {
        if (!Object.prototype.hasOwnProperty.call(record.counts, key)) continue;
        record.counts[key] = Math.max(0, count(record.counts[key]) + Math.trunc(Number(value) || 0));
      }
      dirty += 1;
      flush();
    },
    set(patch = {}) {
      for (const [key, value] of Object.entries(patch)) {
        if (!Object.prototype.hasOwnProperty.call(record.counts, key)) continue;
        record.counts[key] = count(value);
      }
      dirty += 1;
      flush();
    },
    fail(failure) {
      if (record.failures.length < MAX_FAILURES) record.failures.push(normalizeFailure(failure));
      record.counts.failed = record.failures.length;
      dirty += 1;
      flush();
    },
    failures: () => record.failures.slice(),
    finish(status, { error = '' } = {}) {
      record.status = TERMINAL_STATUSES.has(status) ? status : STATUS_COMPLETED;
      record.error = clean(error, 400) || null;
      record.finishedAt = new Date().toISOString();
      record.phase = '';
      const saved = flush(true);
      pruneRecords(record.userId);
      return saved;
    },
    flush: () => flush(true),
  };
}

/* Var olan bir kayıttan devam. Tamamlanan kalemler korunur; yalnız kalanlar
   yeniden işlenir. */
function resumeCheckpoint(jobId, overrides = {}) {
  const existing = readRecord(jobId);
  if (!existing) return null;
  return createCheckpoint({ ...existing, ...overrides, jobId: existing.jobId, items: existing.items, done: existing.done, failures: existing.failures, counts: existing.counts });
}

/* "Yalnız başarısızları yeniden dene": kayıtlı BAŞARISIZ kalemler. Başarılı
   veya atlanan kalemler bu listeye ASLA girmez. */
function retryItems(jobId) {
  const record = readRecord(jobId);
  if (!record) return [];
  const done = new Set(record.done);
  const seen = new Set();
  const out = [];
  for (const failure of record.failures) {
    const match = record.items.find(item => item.plmId === failure.plmId
      && (!failure.colourCode || item.colourCode === failure.colourCode));
    const item = match || normalizeItem(failure);
    const key = itemKey(item);
    if (!item.plmId || seen.has(key) || done.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function resumableJobs(userId = '') {
  return listRecords(userId).filter(record => ACTIVE_STATUSES.has(record.status));
}

module.exports = {
  ROOT,
  SCHEMA_VERSION,
  CHECKPOINT_EVERY,
  STATUS_PENDING,
  STATUS_RESOLVING,
  STATUS_FETCHING_IMAGES,
  STATUS_DOWNLOADING,
  STATUS_COMPLETED,
  STATUS_PARTIAL,
  STATUS_FAILED,
  STATUS_CANCELLED,
  ACTIVE_STATUSES,
  TERMINAL_STATUSES,
  emptyCounts,
  itemKey,
  normalizeItem,
  normalizeRecord,
  readRecord,
  writeRecord,
  removeRecord,
  listRecords,
  pruneRecords,
  createCheckpoint,
  resumeCheckpoint,
  retryItems,
  resumableJobs,
};
