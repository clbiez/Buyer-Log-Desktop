'use strict';

/* HAZIR PLM GÖRSEL PAKETİ (BUYERLOG_IMPORT).
 *
 * Dış PLM görsel testi binlerce görseli ZATEN indirdi. Buyer Log bu baytları
 * CoreNectum'a tekrar gitmeden kendi kanonik deposuna alabilmelidir.
 *
 * SÖZLEŞME manifest.json'dır (import_report.csv insan okuması içindir):
 *   { formatVersion, packageType:'buyerlog-plm-image-import', entryCount,
 *     selectionPolicy, entries:[{ plmCode, colourCode, styleId, styleName,
 *     sourceType, selectionReason, selectedPath, status, ... }] }
 *   Dosyalar: selected/<PLM>/<ColourCode>/selected.<ext>
 *
 * GÜVENLİK: selectedPath manifestten, yani DIŞ KAYNAKTAN gelir. Mutlak yol,
 * UNC, sürücü harfi, '..' ve sembolik atlama denemeleri REDDEDİLİR; her yol
 * paketin `selected` kökünün içinde kalmak ZORUNDADIR.
 *
 * KALICILIK: paket klasörüne kalıcı bağımlılık BIRAKILMAZ. Baytlar kanonik
 * depoya kopyalanır; paket sonradan silinebilir.
 *
 * UZANTIYA GÜVENİLMEZ: gerçek pakette .bmp/.jfif uzantılı dosyaların baytları
 * PNG çıktı. Tip her zaman baytlardan tespit edilir.
 */

const fs = require('fs');
const path = require('path');
const {
  SOURCE_OPTION, SOURCE_STYLE_DEFAULT, SOURCE_STYLE_LIST, SOURCE_MISSING,
  normalizeColourCode, coreId, clean, packageIdentity,
} = require('./corenectum-style-api');
const { sniffImageMime } = require('./plm-image-download-queue');
const { imageHash, canonicalKeyFor, currentRefFor } = require('./plm-image-ingest');
const ownershipStore = require('./plm-image-ownership');

const PACKAGE_TYPE = 'buyerlog-plm-image-import';
const SUPPORTED_FORMAT_VERSIONS = Object.freeze([1]);
const MANIFEST_NAME = 'manifest.json';
const SELECTED_DIR = 'selected';
const MAX_ENTRIES = 200000;
const MAX_MANIFEST_BYTES = 64 * 1024 * 1024;
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

const ENTRY_READY = 'READY';
const ENTRY_MISSING = 'MISSING';
const ENTRY_INVALID = 'INVALID';
const ENTRY_MANUAL = 'MANUAL';
const ENTRY_CACHED = 'CACHED';

const KNOWN_SOURCE_TYPES = new Set([SOURCE_OPTION, SOURCE_STYLE_DEFAULT, SOURCE_STYLE_LIST, SOURCE_MISSING]);

function packageError(message, code, statusCode = 400) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

/* Manifest dosyası PowerShell tarafından BOM ile yazılıyor; BOM'lu JSON
   JSON.parse'ı kırar. Ayrıca alan adları girinti yüzünden boşluklu değil,
   yalnız BOM sorun. */
function parseManifestText(text) {
  const raw = String(text == null ? '' : text).replace(/^﻿/, '').trim();
  if (!raw) throw packageError('manifest.json boş.', 'PLM_PACKAGE_MANIFEST_EMPTY');
  let parsed = null;
  try { parsed = JSON.parse(raw); }
  catch (error) { throw packageError(`manifest.json okunamadı: ${clean(error && error.message, 200)}`, 'PLM_PACKAGE_MANIFEST_INVALID'); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw packageError('manifest.json beklenen nesne biçiminde değil.', 'PLM_PACKAGE_MANIFEST_INVALID');
  return parsed;
}

function assertManifestContract(manifest) {
  const packageType = clean(manifest.packageType, 80);
  if (packageType !== PACKAGE_TYPE) {
    throw packageError(`Paket türü desteklenmiyor: ${packageType || '(boş)'}. Beklenen: ${PACKAGE_TYPE}.`, 'PLM_PACKAGE_TYPE_UNSUPPORTED');
  }
  const formatVersion = Math.trunc(Number(manifest.formatVersion));
  if (!SUPPORTED_FORMAT_VERSIONS.includes(formatVersion)) {
    throw packageError(`Paket biçim sürümü desteklenmiyor: ${manifest.formatVersion}. Desteklenen: ${SUPPORTED_FORMAT_VERSIONS.join(', ')}.`, 'PLM_PACKAGE_VERSION_UNSUPPORTED');
  }
  if (!Array.isArray(manifest.entries)) throw packageError('manifest.json içinde entries dizisi yok.', 'PLM_PACKAGE_ENTRIES_MISSING');
  if (manifest.entries.length > MAX_ENTRIES) throw packageError(`Paket girdi sınırını aşıyor (${manifest.entries.length} > ${MAX_ENTRIES}).`, 'PLM_PACKAGE_TOO_LARGE', 413);
  return { packageType, formatVersion };
}

/* YOL GÜVENLİĞİ. Tek çıkış kapısı burasıdır; hiçbir çağıran selectedPath'i
   kendi başına birleştirmez. */
function resolveSelectedPath(packageRoot, selectedPath) {
  const raw = clean(selectedPath, 1024);
  if (!raw) return { ok: false, code: 'PLM_PACKAGE_PATH_EMPTY', reason: 'selectedPath boş.' };
  if (/\u0000/.test(selectedPath == null ? '' : String(selectedPath))) return { ok: false, code: 'PLM_PACKAGE_PATH_UNSAFE', reason: 'selectedPath geçersiz karakter içeriyor.' };
  const unix = raw.replace(/\\/g, '/');
  if (/^[a-z]:/i.test(unix) || unix.startsWith('/') || unix.startsWith('//')) {
    return { ok: false, code: 'PLM_PACKAGE_PATH_ABSOLUTE', reason: 'selectedPath mutlak yol olamaz.' };
  }
  if (unix.split('/').some(segment => segment === '..')) {
    return { ok: false, code: 'PLM_PACKAGE_PATH_TRAVERSAL', reason: 'selectedPath paket kökünün dışına çıkıyor.' };
  }
  const root = path.resolve(packageRoot);
  const selectedRoot = path.join(root, SELECTED_DIR);
  const full = path.resolve(root, unix);
  const relative = path.relative(selectedRoot, full);
  if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) {
    return { ok: false, code: 'PLM_PACKAGE_PATH_TRAVERSAL', reason: `selectedPath ${SELECTED_DIR}/ kökünün dışında.` };
  }
  return { ok: true, full, relative: unix };
}

function normalizeEntry(raw, index) {
  const plmId = coreId(raw && (raw.plmCode ?? raw.plmId));
  const colourCode = normalizeColourCode(raw && (raw.colourCode ?? raw.colorCode));
  const sourceType = clean(raw && raw.sourceType, 40).toUpperCase();
  return {
    index,
    plmId,
    rawPlmCode: clean(raw && (raw.plmCode ?? raw.plmId), 80),
    colourCode,
    colour: clean(raw && (raw.colour ?? raw.colorName), 160),
    styleId: coreId(raw && raw.styleId),
    styleName: clean(raw && raw.styleName, 300),
    sourceType: KNOWN_SOURCE_TYPES.has(sourceType) ? sourceType : (sourceType || SOURCE_MISSING),
    selectionReason: clean(raw && raw.selectionReason, 300),
    selectedPath: clean(raw && raw.selectedPath, 1024),
    manifestStatus: clean(raw && raw.status, 40).toUpperCase(),
  };
}

/* Manifesti okur ve sözleşmesini doğrular. Baytlara HİÇ dokunmaz. */
function readPackageManifest(packageRoot, io = {}) {
  const readFile = typeof io.readFile === 'function' ? io.readFile : file => fs.readFileSync(file, 'utf8');
  const statSync = typeof io.stat === 'function' ? io.stat : file => fs.statSync(file);
  const root = clean(packageRoot, 1024);
  if (!root) throw packageError('Paket klasörü belirtilmedi.', 'PLM_PACKAGE_ROOT_REQUIRED');
  const manifestPath = path.join(path.resolve(root), MANIFEST_NAME);
  let size = 0;
  try { size = Number(statSync(manifestPath).size) || 0; }
  catch (_) {
    /* En sık yapılan hata paket klasörünün BİR ÜSTÜNÜ seçmektir
       (output_.../ yerine output_.../BUYERLOG_IMPORT). Kullanıcıyı
       "bulunamadı" deyip bırakmak yerine doğru klasörü söyleriz. */
    let hint = '';
    try {
      const nested = path.join(path.resolve(root), 'BUYERLOG_IMPORT', MANIFEST_NAME);
      if (statSync(nested)) hint = ` Paket bir alt klasörde görünüyor: ${path.dirname(nested)}`;
    } catch (_ignored) { /* alt klasör de yoksa ek ipucu verilmez */ }
    throw packageError(`Seçilen klasörde ${MANIFEST_NAME} bulunamadı.${hint}`, 'PLM_PACKAGE_MANIFEST_NOT_FOUND', 404);
  }
  if (size > MAX_MANIFEST_BYTES) throw packageError(`${MANIFEST_NAME} boyut tavanını aşıyor.`, 'PLM_PACKAGE_TOO_LARGE', 413);
  const manifest = parseManifestText(readFile(manifestPath));
  const contract = assertManifestContract(manifest);
  const entries = manifest.entries.map(normalizeEntry);
  return {
    root: path.resolve(root),
    manifestPath,
    packageType: contract.packageType,
    formatVersion: contract.formatVersion,
    generatedAt: clean(manifest.generatedAt, 60),
    entryCount: Math.trunc(Number(manifest.entryCount)) || entries.length,
    selectionPolicy: manifest.selectionPolicy || null,
    entries,
  };
}

/* Her girdiyi sınıflar. Baytlar OKUNUR (tip ve içerik özeti için) ama
   depoya yazılmaz: önizleme yazmadan önce gerçeği göstermek zorundadır. */
function classifyPackageEntries(packageInfo, context = {}) {
  const readImage = typeof context.readImage === 'function' ? context.readImage : file => fs.readFileSync(file);
  const statImage = typeof context.statImage === 'function' ? context.statImage : file => fs.statSync(file);
  const store = context.store || ownershipStore.loadOwnership();
  const ownership = context.ownership || ownershipStore;
  const imagemap = context.imagemap || {};
  const hasStoredFile = typeof context.hasStoredFile === 'function' ? context.hasStoredFile : () => false;
  const overwriteManual = context.overwriteManual === true;
  const withBytes = context.withBytes === true;

  const entries = [];
  const counts = {
    total: 0, ready: 0, missing: 0, invalid: 0, manualPreserved: 0, cached: 0,
    overwritesAutomatic: 0, manualConflicts: 0, newImages: 0,
    bySource: {},
  };

  for (const entry of packageInfo.entries || []) {
    counts.total += 1;
    const key = canonicalKeyFor(entry);
    const currentRef = currentRefFor(imagemap, entry);
    const base = { ...entry, key, currentRef };

    if (!entry.plmId || !entry.colourCode) {
      entries.push({ ...base, status: ENTRY_INVALID, code: 'PLM_PACKAGE_IDENTITY_INVALID', reason: 'PLM ID veya Renk Kodu normalize edilemedi.' });
      counts.invalid += 1;
      continue;
    }
    if (!key) {
      entries.push({ ...base, status: ENTRY_INVALID, code: 'PLM_IMAGE_KEY_INVALID', reason: 'Kanonik görsel kimliği üretilemedi.' });
      counts.invalid += 1;
      continue;
    }
    if (entry.manifestStatus === ENTRY_MISSING || entry.sourceType === SOURCE_MISSING || !entry.selectedPath) {
      // Pakette görsel YOK. Bu, mevcut geçerli görseli ASLA silmez.
      entries.push({ ...base, status: ENTRY_MISSING, code: 'PLM_PACKAGE_ENTRY_MISSING', reason: entry.selectionReason || 'Pakette bu renk için seçilmiş görsel yok.' });
      counts.missing += 1;
      continue;
    }

    const resolved = resolveSelectedPath(packageInfo.root, entry.selectedPath);
    if (!resolved.ok) {
      entries.push({ ...base, status: ENTRY_INVALID, code: resolved.code, reason: resolved.reason });
      counts.invalid += 1;
      continue;
    }

    let size = 0;
    try {
      const stat = statImage(resolved.full);
      if (!stat || !stat.isFile || !stat.isFile()) throw packageError('Dosya değil.', 'PLM_PACKAGE_FILE_MISSING');
      size = Number(stat.size) || 0;
    } catch (_) {
      entries.push({ ...base, status: ENTRY_INVALID, code: 'PLM_PACKAGE_FILE_MISSING', reason: `Manifestte geçen dosya bulunamadı: ${resolved.relative}` });
      counts.invalid += 1;
      continue;
    }
    if (!size) {
      entries.push({ ...base, status: ENTRY_INVALID, code: 'PLM_PACKAGE_FILE_EMPTY', reason: `Dosya boş: ${resolved.relative}` });
      counts.invalid += 1;
      continue;
    }
    if (size > MAX_IMAGE_BYTES) {
      entries.push({ ...base, status: ENTRY_INVALID, code: 'PLM_PACKAGE_FILE_TOO_LARGE', reason: `Dosya boyut tavanını aşıyor: ${resolved.relative}` });
      counts.invalid += 1;
      continue;
    }

    let buffer = null;
    let mimeType = '';
    let hash = '';
    try {
      buffer = readImage(resolved.full);
      mimeType = sniffImageMime(buffer, '');
      if (mimeType) hash = imageHash(buffer);
    } catch (error) {
      entries.push({ ...base, status: ENTRY_INVALID, code: 'PLM_PACKAGE_FILE_UNREADABLE', reason: `Dosya okunamadı: ${clean(error && error.message, 160)}` });
      counts.invalid += 1;
      continue;
    }
    if (!mimeType) {
      entries.push({ ...base, status: ENTRY_INVALID, code: 'PLM_PACKAGE_FILE_NOT_IMAGE', reason: `Dosya geçerli bir raster görsel değil: ${resolved.relative}` });
      counts.invalid += 1;
      continue;
    }

    const sourceIdentity = packageIdentity({ sourceType: entry.sourceType, plmId: entry.plmId, colourCode: entry.colourCode, hash });
    const ownershipState = ownership.ownershipOf(store, key, currentRef);
    const stored = hasStoredFile(currentRef);

    if (ownershipState.state === ownership.OWNERSHIP_MANUAL && !overwriteManual) {
      entries.push({ ...base, status: ENTRY_MANUAL, mimeType, size, hash, sourceIdentity, fullPath: resolved.full, relativePath: resolved.relative, reason: 'Kullanıcının elle seçtiği görsel korunur.' });
      counts.manualPreserved += 1;
      counts.manualConflicts += 1;
      continue;
    }

    if (ownership.isCacheHit(store, key, currentRef, sourceIdentity, { hasStoredFile: stored })) {
      entries.push({ ...base, status: ENTRY_CACHED, mimeType, size, hash, sourceIdentity, fullPath: resolved.full, relativePath: resolved.relative, reason: 'Aynı görsel kimliği zaten kayıtlı.' });
      counts.cached += 1;
      continue;
    }

    if (ownershipState.state === ownership.OWNERSHIP_MANUAL) counts.manualConflicts += 1;
    else if (ownershipState.state === ownership.OWNERSHIP_AUTOMATIC && stored) counts.overwritesAutomatic += 1;
    else counts.newImages += 1;

    counts.bySource[entry.sourceType] = (counts.bySource[entry.sourceType] || 0) + 1;
    counts.ready += 1;
    entries.push({
      ...base,
      status: ENTRY_READY,
      mimeType,
      size,
      hash,
      sourceIdentity,
      fullPath: resolved.full,
      relativePath: resolved.relative,
      ownershipState: ownershipState.state,
      replacesAutomatic: ownershipState.state === ownership.OWNERSHIP_AUTOMATIC && stored,
      overwritesManual: ownershipState.state === ownership.OWNERSHIP_MANUAL,
      ...(withBytes ? { buffer } : {}),
    });
  }

  return { entries, counts };
}

/* Önizleme: SAYIM ve örnekler. Hiçbir şey yazılmaz. Baytlar önizlemede
   BELLEKTE TUTULMAZ (5.876 girdi × ~60 KB tek seferde tutulamaz); commit
   aşaması dosyaları tek tek yeniden okur. */
function previewPackage(packageRoot, context = {}) {
  const info = readPackageManifest(packageRoot, context);
  const { entries, counts } = classifyPackageEntries(info, { ...context, withBytes: false });
  const sampleOf = status => entries.filter(entry => entry.status === status).slice(0, 25)
    .map(entry => ({ plmId: entry.plmId, colourCode: entry.colourCode, styleName: entry.styleName, sourceType: entry.sourceType, reason: entry.reason || entry.selectionReason, code: entry.code || '' }));
  return {
    root: info.root,
    packageType: info.packageType,
    formatVersion: info.formatVersion,
    generatedAt: info.generatedAt,
    entryCount: info.entryCount,
    manifestEntryCount: info.entries.length,
    selectionPolicy: info.selectionPolicy,
    counts,
    totalReadyBytes: entries.filter(entry => entry.status === ENTRY_READY).reduce((sum, entry) => sum + (Number(entry.size) || 0), 0),
    samples: {
      ready: sampleOf(ENTRY_READY),
      missing: sampleOf(ENTRY_MISSING),
      invalid: sampleOf(ENTRY_INVALID),
      manual: sampleOf(ENTRY_MANUAL),
      cached: sampleOf(ENTRY_CACHED),
    },
  };
}

module.exports = {
  PACKAGE_TYPE,
  SUPPORTED_FORMAT_VERSIONS,
  MANIFEST_NAME,
  SELECTED_DIR,
  MAX_ENTRIES,
  MAX_IMAGE_BYTES,
  ENTRY_READY,
  ENTRY_MISSING,
  ENTRY_INVALID,
  ENTRY_MANUAL,
  ENTRY_CACHED,
  packageError,
  parseManifestText,
  assertManifestContract,
  resolveSelectedPath,
  normalizeEntry,
  readPackageManifest,
  classifyPackageEntries,
  previewPackage,
};
