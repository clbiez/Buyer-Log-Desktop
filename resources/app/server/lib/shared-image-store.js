'use strict';

/* PAYLAŞILAN MODEL GÖRSELİ DAĞITIM DEPOSU (v11.10)
 *
 * SORUN. overrides.imagemap ortak iş verisiyle birlikte kullanıcılar arasında
 * taşınıyordu ama GÖRSELİN KENDİSİ taşınmıyordu: B kullanıcısı A'nın yazdığı
 * `ci_...` referansını görüyor, karşılığındaki dosya kendi diskinde olmadığı
 * için görsel kırık kalıyordu. Her kullanıcı aynı modeli ASAS/PLM'den yeniden
 * indirmek zorundaydı.
 *
 * ÇÖZÜM. Ağ klasöründe İÇERİK ADRESLİ küçük bir dağıtım deposu:
 *
 *   <shared>/model-images/
 *     objects/<hash[0:2]>/<hash>.<ext>   ham baytlar, aynı bayt TEK kopya
 *     manifests/<deviceId>.json          o cihazın yayımladığı kayıtlar
 *     heads/<deviceId>.json              { revision } — delta taraması için
 *     leases/<hash>.lease                eşzamanlı üst-kaynak tazeleme kirası
 *
 * HARD RULE. Burası bir DAĞITIM katmanıdır, çalışma zamanı dosya sistemi
 * DEĞİLDİR. Tablolar, hover'lar ve drilldown'lar hiçbir zaman buradan okumaz;
 * yalnız yerel collection-images deposundan okur. Ağ yavaşsa senkron gecikir,
 * tablo gecikmez.
 *
 * DELTA. Çekme her açılışta bütün baytları taramaz: önce küçük heads/
 * dosyaları okunur, yalnız revizyonu ilerlemiş cihazın manifestosu açılır,
 * yalnız yeni kayıtların nesneleri indirilir.
 *
 * SIRA. Çakışmada dosya zaman damgası YETKİ DEĞİLDİR. Her yayım
 * SharedRevisionStore üzerinden GLOBAL ve monoton bir revizyon alır; kazanan
 * (ownershipRank, revision) ikilisine göre deterministik seçilir. MANUEL her
 * zaman OTOMATİK'i yener.
 */

const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const { withFileLeaseAsync, replaceFileWithRetry, getBuyerLogInstanceId } = require('./shared-file-transaction');

const SCHEMA_VERSION = 2;
const ROOT_FOLDER = 'model-images';
// v1 `objects/` is retained READ-ONLY for backwards compatibility. New bytes
// are appended into bounded pack files so physical SMB file count does not
// grow 1:1 with model count.
const OBJECTS = 'objects';
const PACKS = 'packs';
const CONTENT_INDEX = 'content-index';
const MANIFESTS = 'manifests';
const HEADS = 'heads';
const LEASES = 'leases';

const SOURCE_PLM = 'PLM';
const SOURCE_ASAS = 'ASAS';
const SOURCE_PACKAGE = 'PACKAGE';
const SOURCE_MANUAL = 'MANUAL';
const SOURCES = new Set([SOURCE_PLM, SOURCE_ASAS, SOURCE_PACKAGE, SOURCE_MANUAL]);

const OWNERSHIP_MANUAL = 'MANUAL';
const OWNERSHIP_AUTOMATIC = 'AUTOMATIC';

const STATUS_AVAILABLE = 'AVAILABLE';
const STATUS_UNAVAILABLE = 'UNAVAILABLE';
const STATUS_DELETED = 'DELETED';

const EXTENSIONS = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };
const MAX_OBJECT_BYTES = 50 * 1024 * 1024;
const MAX_PACK_BYTES = 64 * 1024 * 1024;
const CONTENT_INDEX_SHARDS = 16;
const MAX_RECORDS_PER_MANIFEST = 200000;

function clean(value, max = 300) {
  return String(value == null ? '' : value).replace(/\u0000/g, '').trim().slice(0, max);
}
function safeSegment(value, max = 120) {
  return clean(value, max).replace(/[^A-Za-z0-9._-]/g, '_');
}
function hashOf(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}
function normalizeSource(value) {
  const source = clean(value, 20).toUpperCase();
  return SOURCES.has(source) ? source : '';
}
function ownershipRank(value) {
  return clean(value, 20).toUpperCase() === OWNERSHIP_MANUAL ? 1 : 0;
}
function extensionFor(mimeType) {
  return EXTENSIONS[clean(mimeType, 60).toLowerCase()] || '';
}

/* Kira anahtarı: varlık + kanonik kimlik + kaynak. ASAS tazelemesi PLM
   tazelemesini kilitlemez — ikisi farklı üst kaynaktır. */
function leaseKey(canonicalKey, source) {
  return `image|${clean(canonicalKey, 300)}|${normalizeSource(source) || 'NONE'}`;
}

function normalizeRecord(raw) {
  const canonicalKey = clean(raw && raw.canonicalKey, 300);
  const source = normalizeSource(raw && raw.source);
  if (!canonicalKey || !source) return null;
  const status = clean(raw && raw.status, 20).toUpperCase();
  const record = {
    canonicalKey,
    plmId: clean(raw && raw.plmId, 80),
    colourCode: clean(raw && raw.colourCode, 80),
    colour: clean(raw && raw.colour, 160),
    source,
    ownership: ownershipRank(raw && raw.ownership) ? OWNERSHIP_MANUAL : OWNERSHIP_AUTOMATIC,
    status: status === STATUS_DELETED || status === STATUS_UNAVAILABLE ? status : STATUS_AVAILABLE,
    contentHash: clean(raw && raw.contentHash, 80).toLowerCase(),
    mimeType: clean(raw && raw.mimeType, 60).toLowerCase(),
    bytes: Math.max(0, Math.trunc(Number(raw && raw.bytes) || 0)),
    objectPath: clean(raw && raw.objectPath, 240),
    packPath: clean(raw && raw.packPath, 240),
    packOffset: Math.max(0, Math.trunc(Number(raw && raw.packOffset) || 0)),
    packLength: Math.max(0, Math.trunc(Number(raw && raw.packLength) || 0)),
    sourceIdentity: clean(raw && raw.sourceIdentity, 200),
    sourceFetchedAt: clean(raw && raw.sourceFetchedAt, 40) || null,
    updatedAt: clean(raw && raw.updatedAt, 40) || null,
    updatedByDevice: clean(raw && raw.updatedByDevice, 80),
    revision: Math.max(0, Math.trunc(Number(raw && raw.revision) || 0)),
  };
  // AVAILABLE bir kayıt baytsız olamaz. v1 objectPath ya da v2 bounded-pack
  // locator'dan biri tam olmalıdır; yarım publish görünür hâle gelmez.
  const hasLegacyObject = Boolean(record.objectPath);
  const hasPackedObject = Boolean(record.packPath && record.packLength > 0 && record.packLength === record.bytes);
  if (record.status === STATUS_AVAILABLE && (!record.contentHash || !record.bytes || (!hasLegacyObject && !hasPackedObject))) return null;
  return record;
}

function emptyManifest(deviceId) {
  return { schemaVersion: SCHEMA_VERSION, deviceId: clean(deviceId, 80), revision: 0, updatedAt: null, records: {} };
}

function normalizeManifest(raw, deviceId) {
  const out = emptyManifest(deviceId);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  out.deviceId = clean(raw.deviceId, 80) || out.deviceId;
  out.revision = Math.max(0, Math.trunc(Number(raw.revision) || 0));
  out.updatedAt = clean(raw.updatedAt, 40) || null;
  const source = raw.records && typeof raw.records === 'object' && !Array.isArray(raw.records) ? raw.records : {};
  for (const [key, value] of Object.entries(source).slice(0, MAX_RECORDS_PER_MANIFEST)) {
    const record = normalizeRecord({ ...value, canonicalKey: clean(value && value.canonicalKey, 300) || key });
    if (record) out.records[record.canonicalKey] = record;
  }
  return out;
}

async function readJsonSafe(file, fallback) {
  try { return JSON.parse(await fsp.readFile(file, 'utf8')); }
  catch (error) {
    if (error && (error.code === 'ENOENT' || error.code === 'ENOTDIR' || error.name === 'SyntaxError')) return fallback;
    throw error;
  }
}

async function atomicJson(file, value) {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${Date.now()}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  try {
    const handle = await fsp.open(temporary, 'wx');
    try { await handle.writeFile(JSON.stringify(value), 'utf8'); try { await handle.sync(); } catch (_) {} }
    finally { await handle.close(); }
    await replaceFileWithRetry(temporary, file);
  } finally { try { await fsp.unlink(temporary); } catch (_) {} }
}

function objectRelativePath(contentHash, mimeType) {
  const hash = clean(contentHash, 80).toLowerCase();
  const extension = extensionFor(mimeType);
  if (!/^[0-9a-f]{64}$/.test(hash) || !extension) return '';
  return `${OBJECTS}/${hash.slice(0, 2)}/${hash}.${extension}`;
}

function normalizeContentLocator(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const contentHash = clean(raw.contentHash, 80).toLowerCase();
  const bytes = Math.max(0, Math.trunc(Number(raw.bytes) || 0));
  const objectPath = clean(raw.objectPath, 240);
  const packPath = clean(raw.packPath, 240);
  const packOffset = Math.max(0, Math.trunc(Number(raw.packOffset) || 0));
  const packLength = Math.max(0, Math.trunc(Number(raw.packLength) || 0));
  const mimeType = clean(raw.mimeType, 60).toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(contentHash) || !bytes) return null;
  if (!objectPath && !(packPath && packLength === bytes)) return null;
  return { contentHash, bytes, mimeType, objectPath, packPath, packOffset, packLength };
}
function locatorFromRecord(record) {
  return normalizeContentLocator(record && {
    contentHash: record.contentHash, bytes: record.bytes, mimeType: record.mimeType,
    objectPath: record.objectPath, packPath: record.packPath,
    packOffset: record.packOffset, packLength: record.packLength,
  });
}

function isNewer(candidate, current) {
  const rank = ownershipRank(candidate.ownership) - ownershipRank(current.ownership);
  if (rank !== 0) return rank > 0;
  if (candidate.revision !== current.revision) return candidate.revision > current.revision;
  // Revizyon eşitse (aynı yayım turu) sıralamayı cihaz kimliği belirler: her
  // istemcide AYNI kazanan seçilsin diye deterministik olmalıdır.
  return String(candidate.updatedByDevice || '') > String(current.updatedByDevice || '');
}

function isInsideRoot(root, target) {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}

/* ===================================================================
   DEPO
   =================================================================== */
function createSharedImageStore(options = {}) {
  const resolveRoot = typeof options.getSharedSyncRoot === 'function' ? options.getSharedSyncRoot : async () => '';
  const resolveDeviceId = typeof options.getDeviceId === 'function' ? options.getDeviceId : () => getBuyerLogInstanceId();
  const allocateRevision = typeof options.allocateRevision === 'function' ? options.allocateRevision : null;
  const leaseTtlMs = Math.max(5000, Number(options.leaseTtlMs) || 120000);

  let fallbackRevision = 0;
  /* Bu süreçte şu an tutulan tazeleme kiraları. */
  const heldLeases = new Set();
  let legacyContentCachePromise = null;

  async function rootFolder() {
    const shared = clean(await resolveRoot(), 1024);
    return shared ? path.join(path.resolve(shared), ROOT_FOLDER) : '';
  }

  async function available() {
    return Boolean(await rootFolder());
  }

  /* GLOBAL MONOTON REVİZYON.
   *
   * Çakışma sırası dosya zaman damgasına DAYANAMAZ: iki makinenin saati
   * birbirini tutmaz ve ağ dosya sistemi mtime'ı koruduğu gibi vermez. Bu
   * yüzden yayımlar paylaşılan, kira altında artan bir sayaçtan numara alır.
   *
   * SharedRevisionStore BİLEREK kullanılmaz: o depo uygulamanın her yerinde
   * ateşle-unut (`void ... .catch`) çağrılır ve başarısızlığı hiçbir iş
   * mutasyonunu düşürmez. Buradaki numara ise yayımın KENDİSİ için gerekli,
   * yani beklenmek zorunda; aynı depoyu await etmek o sözleşmeyi bozardı.
   *
   * Sayaç okunamazsa yayım yapılmaz ve kuyrukta kalır — numarasız bir kayıt
   * yazmak, sıralamayı belirsiz bırakmaktan iyidir. */
  async function nextRevision() {
    if (allocateRevision) {
      const value = Number(await allocateRevision());
      if (Number.isFinite(value) && value > 0) return Math.trunc(value);
    }
    const root = await rootFolder();
    if (!root) { fallbackRevision += 1; return fallbackRevision; }
    const file = path.join(root, 'revision.json');
    return withFileLeaseAsync(file, async () => {
      const current = await readJsonSafe(file, null);
      const next = Math.max(0, Math.trunc(Number(current && current.revision) || 0)) + 1;
      await atomicJson(file, { schemaVersion: SCHEMA_VERSION, revision: next, updatedAt: new Date().toISOString() });
      return next;
    }, { timeoutMs: 10000, staleMs: 60000 });
  }

  async function listDeviceHeads() {
    const root = await rootFolder();
    if (!root) return [];
    let entries = [];
    try { entries = await fsp.readdir(path.join(root, HEADS), { withFileTypes: true }); }
    catch (error) { if (error && (error.code === 'ENOENT' || error.code === 'ENOTDIR')) return []; throw error; }
    const heads = [];
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
      const deviceId = entry.name.slice(0, -5);
      const head = await readJsonSafe(path.join(root, HEADS, entry.name), null);
      heads.push({
        deviceId,
        revision: Math.max(0, Math.trunc(Number(head && head.revision) || 0)),
        updatedAt: clean(head && head.updatedAt, 40) || null,
      });
    }
    return heads;
  }

  async function readManifest(deviceId) {
    const root = await rootFolder();
    if (!root) return emptyManifest(deviceId);
    const file = path.join(root, MANIFESTS, `${safeSegment(deviceId, 80)}.json`);
    return normalizeManifest(await readJsonSafe(file, null), deviceId);
  }

  /* Yalnız `since` revizyonundan SONRAKİ kayıtlar. Manifestonun tamamı okunur
     (küçük JSON) ama nesne baytları YALNIZ yeni kayıtlar için indirilir; bu
     "her açılışta her baytı tarama" yasağının uygulanmasıdır. */
  async function readDelta(deviceId, since = 0) {
    const manifest = await readManifest(deviceId);
    const floor = Math.max(0, Math.trunc(Number(since) || 0));
    const records = Object.values(manifest.records).filter(record => record.revision > floor);
    records.sort((a, b) => a.revision - b.revision);
    return { deviceId: manifest.deviceId || clean(deviceId, 80), revision: manifest.revision, records };
  }

  /* Bütün cihazların kayıtlarını birleştirir ve kanonik kimlik başına KAZANANI
     seçer. Sıra: MANUEL > OTOMATİK, sonra global revizyon. */
  async function mergedView({ since = {}, sources = null } = {}) {
    const heads = await listDeviceHeads();
    const winners = new Map();
    const perDevice = {};
    for (const head of heads) {
      const floor = Math.max(0, Math.trunc(Number(since && since[head.deviceId]) || 0));
      if (head.revision && head.revision <= floor) { perDevice[head.deviceId] = { revision: head.revision, records: 0 }; continue; }
      const delta = await readDelta(head.deviceId, floor);
      perDevice[head.deviceId] = { revision: head.revision, records: delta.records.length };
      for (const record of delta.records) {
        if (sources && !sources.has(record.source)) continue;
        const current = winners.get(record.canonicalKey);
        if (!current || isNewer(record, current)) winners.set(record.canonicalKey, record);
      }
    }
    return { heads, perDevice, records: [...winners.values()] };
  }

  async function lookupMany(canonicalKeys, { source = '' } = {}) {
    const keys = [...new Set((Array.isArray(canonicalKeys) ? canonicalKeys : [canonicalKeys])
      .map(value => clean(value, 300)).filter(Boolean))];
    const out = new Map();
    if (!keys.length) return out;
    const wanted = normalizeSource(source), wantedKeys = new Set(keys);
    const heads = await listDeviceHeads();
    for (const head of heads) {
      const manifest = await readManifest(head.deviceId);
      for (const key of wantedKeys) {
        const record = manifest.records[key];
        if (!record) continue;
        if (wanted && record.source !== wanted && record.ownership !== OWNERSHIP_MANUAL) continue;
        const current = out.get(key);
        if (!current || isNewer(record, current)) out.set(key, record);
      }
    }
    return out;
  }

  async function legacyContentCache() {
    if (legacyContentCachePromise) return legacyContentCachePromise;
    legacyContentCachePromise = (async () => {
      const cache = new Map(), heads = await listDeviceHeads();
      for (const head of heads) {
        const manifest = await readManifest(head.deviceId);
        for (const record of Object.values(manifest.records || {})) {
          const locator = locatorFromRecord(record);
          if (locator && !cache.has(locator.contentHash)) cache.set(locator.contentHash, locator);
        }
      }
      return cache;
    })().catch(error => { legacyContentCachePromise = null; throw error; });
    return legacyContentCachePromise;
  }

  function contentIndexFile(root, contentHash) {
    const shard = parseInt(contentHash[0], 16) % CONTENT_INDEX_SHARDS;
    return path.join(root, CONTENT_INDEX, `${shard.toString(16)}.json`);
  }

  async function locatorUsable(root, locator) {
    const safe = normalizeContentLocator(locator); if (!safe) return false;
    try {
      if (safe.objectPath) {
        const file = path.join(root, ...safe.objectPath.split('/'));
        if (!isInsideRoot(root, file)) return false;
        const stat = await fsp.stat(file); return stat.isFile() && stat.size === safe.bytes;
      }
      const file = path.join(root, ...safe.packPath.split('/'));
      if (!isInsideRoot(root, file)) return false;
      const stat = await fsp.stat(file);
      return stat.isFile() && stat.size >= safe.packOffset + safe.packLength;
    } catch (_) { return false; }
  }

  async function locatorIntact(root, locator) {
    const safe = normalizeContentLocator(locator); if (!safe) return false;
    try {
      const file = path.join(root, ...(safe.objectPath || safe.packPath).split('/'));
      if (!isInsideRoot(root, file)) return false;
      if (safe.objectPath) return hashOf(await fsp.readFile(file)) === safe.contentHash;
      const handle = await fsp.open(file, 'r');
      try {
        const slice = Buffer.alloc(safe.packLength);
        const read = await handle.read(slice, 0, safe.packLength, safe.packOffset);
        return read.bytesRead === safe.packLength && hashOf(slice) === safe.contentHash;
      } finally { await handle.close(); }
    } catch (_) { return false; }
  }

  async function appendPack(root, deviceId, contentHash, mimeType, buffer) {
    const device = safeSegment(deviceId, 80) || 'unknown';
    const packRoot = path.join(root, PACKS, device);
    const headFile = path.join(packRoot, 'head.json');
    return withFileLeaseAsync(headFile, async () => {
      await fsp.mkdir(packRoot, { recursive: true });
      const head = await readJsonSafe(headFile, null);
      let packNo = Math.max(1, Math.trunc(Number(head && head.packNo) || 1));
      let packName = `pack-${String(packNo).padStart(6, '0')}.blpack`;
      let packFile = path.join(packRoot, packName);
      let size = 0;
      try { size = (await fsp.stat(packFile)).size; } catch (_) { size = 0; }
      if (size > 0 && size + buffer.length > MAX_PACK_BYTES) {
        packNo += 1; packName = `pack-${String(packNo).padStart(6, '0')}.blpack`;
        packFile = path.join(packRoot, packName); size = 0;
      }
      const handle = await fsp.open(packFile, 'a+');
      let offset = size;
      try {
        const stat = await handle.stat(); offset = stat.size;
        await handle.write(buffer, 0, buffer.length, null);
        try { await handle.sync(); } catch (_) {}
      } finally { await handle.close(); }
      const relative = `${PACKS}/${device}/${packName}`;
      await atomicJson(headFile, { schemaVersion: SCHEMA_VERSION, packNo, size: offset + buffer.length, updatedAt: new Date().toISOString() });
      return { contentHash, mimeType: clean(mimeType, 60).toLowerCase(), bytes: buffer.length, objectPath: '', packPath: relative, packOffset: offset, packLength: buffer.length };
    }, { timeoutMs: 15000, staleMs: 120000 });
  }

  async function putPackedContent(root, deviceId, contentHash, mimeType, buffer) {
    const indexFile = contentIndexFile(root, contentHash);
    return withFileLeaseAsync(indexFile, async () => {
      const index = await readJsonSafe(indexFile, { schemaVersion: SCHEMA_VERSION, records: {} });
      index.records = index.records && typeof index.records === 'object' ? index.records : {};
      let existing = normalizeContentLocator(index.records[contentHash]);
      if (existing && await locatorUsable(root, existing)) return { locator: existing, reused: true };

      // Lazy migration: before appending new bytes, index an existing v1 object
      // or v2 pack locator from manifests if this content already exists.
      try {
        const legacy = (await legacyContentCache()).get(contentHash);
        // Hash de doğrulanır: kalıcı silmede sıfırlanan bir pack dilimi başka
        // cihazın eski manifestosunda hâlâ görünebilir; boyutu tutsa da
        // içeriği gitmiştir ve yeniden kullanılamaz.
        if (legacy && await locatorUsable(root, legacy) && await locatorIntact(root, legacy)) {
          index.records[contentHash] = legacy;
          index.schemaVersion = SCHEMA_VERSION; index.updatedAt = new Date().toISOString();
          await atomicJson(indexFile, index);
          return { locator: legacy, reused: true };
        }
      } catch (_) { /* index warm-up failure must not block a local publish */ }

      const locator = await appendPack(root, deviceId, contentHash, mimeType, buffer);
      index.records[contentHash] = locator;
      index.schemaVersion = SCHEMA_VERSION; index.updatedAt = new Date().toISOString();
      await atomicJson(indexFile, index);
      return { locator, reused: false };
    }, { timeoutMs: 20000, staleMs: 120000 });
  }

  /* Tek bir kimlik için en iyi PAYLAŞILAN kayıt. `source` verilirse KAYNAK SIKI
     uygulanır: PLM kökenli bir nesne bir ASAS işlemini karşılayamaz. Manuel
     sahipli kayıt kaynaktan bağımsız görünür — o bir koruma sinyalidir. */
  async function lookup(canonicalKey, { source = '' } = {}) {
    const key = clean(canonicalKey, 300);
    if (!key) return null;
    return (await lookupMany([key], { source })).get(key) || null;
  }

  async function readObject(record) {
    const root = await rootFolder();
    const locator = locatorFromRecord(record);
    if (!root || !locator) return null;
    let buffer = null;
    try {
      if (locator.objectPath) {
        const file = path.join(root, ...locator.objectPath.split('/'));
        if (!isInsideRoot(root, file)) return null;
        buffer = await fsp.readFile(file);
      } else {
        const file = path.join(root, ...locator.packPath.split('/'));
        if (!isInsideRoot(root, file)) return null;
        const handle = await fsp.open(file, 'r');
        try {
          buffer = Buffer.alloc(locator.packLength);
          const read = await handle.read(buffer, 0, locator.packLength, locator.packOffset);
          if (read.bytesRead !== locator.packLength) return null;
        } finally { await handle.close(); }
      }
    } catch (error) { if (error && (error.code === 'ENOENT' || error.code === 'ENOTDIR')) return null; throw error; }
    if (!buffer || !buffer.length || buffer.length > MAX_OBJECT_BYTES || buffer.length !== locator.bytes) return null;
    // BÜTÜNLÜK: ağdan gelen yarım/bozuk pack slice yerel depoya GİRMEZ.
    if (hashOf(buffer) !== locator.contentHash) return null;
    return buffer;
  }

  /* Yayım. Baytlar önce nesne deposuna, sonra manifesto/head güncellenir: sıra
     ters olsa başka bir kullanıcı henüz var olmayan bir nesneyi indirmeye
     çalışırdı. Aynı hash zaten varsa bayt YENİDEN YAZILMAZ. */
  async function publish(entries = []) {
    const root = await rootFolder();
    if (!root) return { published: 0, skipped: 0, reused: 0, available: false, revision: 0 };
    const deviceId = safeSegment(await resolveDeviceId(), 80) || 'unknown';
    const list = (Array.isArray(entries) ? entries : []).filter(Boolean);
    if (!list.length) return { published: 0, skipped: 0, reused: 0, available: true, revision: 0, deviceId };

    const revision = await nextRevision();
    const now = new Date().toISOString();
    const prepared = [];
    let reused = 0;
    let skipped = 0;

    for (const entry of list) {
      const source = normalizeSource(entry.source);
      const canonicalKey = clean(entry.canonicalKey, 300);
      if (!canonicalKey || !source) { skipped += 1; continue; }
      const status = clean(entry.status, 20).toUpperCase();
      if (status === STATUS_DELETED || status === STATUS_UNAVAILABLE) {
        // Mezar taşı / bulunamadı kaydı baytsızdır; normalizeRecord onu
        // AVAILABLE zorunluluğuna takmadan geçirir.
        prepared.push({
          canonicalKey,
          plmId: clean(entry.plmId, 80), colourCode: clean(entry.colourCode, 80), colour: clean(entry.colour, 160),
          source, ownership: ownershipRank(entry.ownership) ? OWNERSHIP_MANUAL : OWNERSHIP_AUTOMATIC, status,
          contentHash: '', mimeType: '', bytes: 0, objectPath: '',
          sourceIdentity: clean(entry.sourceIdentity, 200),
          sourceFetchedAt: clean(entry.sourceFetchedAt, 40) || null,
          updatedAt: now, updatedByDevice: deviceId, revision,
        });
        continue;
      }
      const buffer = Buffer.isBuffer(entry.buffer) ? entry.buffer : null;
      if (!buffer || !buffer.length || buffer.length > MAX_OBJECT_BYTES) { skipped += 1; continue; }
      const contentHash = clean(entry.contentHash, 80).toLowerCase() || hashOf(buffer);
      if (!/^[0-9a-f]{64}$/.test(contentHash) || !extensionFor(entry.mimeType)) { skipped += 1; continue; }
      const packed = await putPackedContent(root, deviceId, contentHash, entry.mimeType, buffer);
      if (packed.reused) reused += 1;
      const locator = packed.locator;
      const record = normalizeRecord({
        ...entry, canonicalKey, source, contentHash, bytes: buffer.length,
        objectPath: locator.objectPath || '', packPath: locator.packPath || '',
        packOffset: locator.packOffset || 0, packLength: locator.packLength || 0,
        status: STATUS_AVAILABLE, revision, updatedAt: now, updatedByDevice: deviceId,
      });
      if (record) prepared.push(record); else skipped += 1;
    }
    if (!prepared.length) return { published: 0, skipped, reused, available: true, revision, deviceId };

    const manifestFile = path.join(root, MANIFESTS, `${deviceId}.json`);
    await withFileLeaseAsync(manifestFile, async () => {
      const manifest = normalizeManifest(await readJsonSafe(manifestFile, null), deviceId);
      for (const record of prepared) manifest.records[record.canonicalKey] = record;
      manifest.deviceId = deviceId;
      manifest.revision = Math.max(manifest.revision, revision);
      manifest.updatedAt = now;
      await atomicJson(manifestFile, manifest);
      await atomicJson(path.join(root, HEADS, `${deviceId}.json`), { schemaVersion: SCHEMA_VERSION, deviceId, revision: manifest.revision, updatedAt: now });
    }, { timeoutMs: 10000, staleMs: 60000 });

    return { published: prepared.length, skipped, reused, available: true, revision, deviceId };
  }

  /* Dağıtık tazeleme kirası. Aynı kanonik kimlik + kaynak için ikinci bir
     Buyer Log örneği üst kaynağa gitmez; kira süreli ve çöken örnekten sonra
     kendiliğinden kurtarılır (withFileLeaseAsync bayatlama kurtarması). */
  async function withRefreshLease(canonicalKey, source, operation, { timeoutMs = 250 } = {}) {
    const root = await rootFolder();
    if (!root) return { acquired: true, result: await operation() };
    const digest = crypto.createHash('sha1').update(leaseKey(canonicalKey, source)).digest('hex');
    const file = path.join(root, LEASES, `${digest}.lease`);
    try {
      const result = await withFileLeaseAsync(file, () => operation(), {
        timeoutMs: Math.max(100, Number(timeoutMs) || 250),
        staleMs: leaseTtlMs,
      });
      return { acquired: true, result };
    } catch (error) {
      if (error && error.code === 'SHARED_WRITE_BUSY') return { acquired: false, owner: (error && error.owner) || null, result: undefined };
      throw error;
    }
  }

  /* TUT-VE-BIRAK biçimi. Bir iş üst kaynağa çıkarken kirasını işin SONUNA
     kadar tutmalıdır; withRefreshLease'in sarmalayıcı biçimi bunu ifade
     edemez. Kira yine süreli: örnek çökerse bayatlama kurtarması devreye
     girer ve model kalıcı olarak kilitlenmez. */
  async function acquireRefreshLease(canonicalKey, source, { timeoutMs = 250 } = {}) {
    /* SÜREÇ İÇİ ÖNCE. withFileLeaseAsync aynı kaynağı AYNI SÜREÇTE sıraya
       dizer (serializeLocalWrite): ikinci çağrı "meşgul" demez, birincinin
       bitmesini SONSUZA KADAR bekler. Aynı örnekte açılan ikinci iş bu yüzden
       kilitlenirdi. Süreç içi sahiplik burada, dosya kirasından ÖNCE kararı
       verir; dosya kirası yalnız örnekler ARASI yarış içindir. */
    const localKey = leaseKey(canonicalKey, source);
    if (heldLeases.has(localKey)) return { acquired: false, release: async () => {} };
    const root = await rootFolder();
    if (!root) {
      heldLeases.add(localKey);
      return { acquired: true, release: async () => { heldLeases.delete(localKey); } };
    }
    heldLeases.add(localKey);
    let markAcquired = null;
    let releaseHold = null;
    // Kira gerçekten alındığında operation() çağrılır; alınamazsa withRefreshLease
    // `acquired:false` ile döner. İki sinyali tek bir yarışta bekleriz —
    // zamanlayıcıya dayanmaz, bu yüzden yavaş ağda da doğru sonuç verir.
    const acquired = new Promise(resolve => { markAcquired = resolve; });
    const hold = new Promise(resolve => { releaseHold = resolve; });
    let finished = false;
    const done = withRefreshLease(canonicalKey, source, () => { markAcquired(true); return hold; }, { timeoutMs })
      .then(result => { finished = true; if (!(result && result.acquired)) markAcquired(false); return result; })
      .catch(error => { finished = true; markAcquired(false); throw error; });
    void done.catch(() => {});
    if (!(await acquired)) { heldLeases.delete(localKey); return { acquired: false, release: async () => {} }; }
    return {
      acquired: true,
      release: async () => {
        heldLeases.delete(localKey);
        if (finished) return;
        releaseHold(null);
        try { await done; } catch (_) { /* kira bırakma hatası işi düşürmez */ }
      },
    };
  }

  /* İçeriği paylaşılan klasörden GERÇEKTEN siler. v1 nesne dosyası silinir;
     pack dilimi ise yerinde sıfırlanır (pack ofsetleri başka kayıtlarca
     kullanıldığı için dosya kısaltılamaz). Sıfırlamadan önce dilimin hash'i
     doğrulanır: yanlış ofsetteki başka bir görsel ASLA ezilmez. */
  async function eraseContent(root, contentHash, manifests) {
    const locators = new Map();
    const addLocator = raw => {
      const safe = normalizeContentLocator(raw);
      if (!safe || safe.contentHash !== contentHash) return;
      locators.set(safe.objectPath || `${safe.packPath}@${safe.packOffset}`, safe);
    };
    for (const manifest of manifests) {
      for (const record of Object.values(manifest.records || {})) {
        if (record.contentHash === contentHash) addLocator(locatorFromRecord(record));
      }
    }
    const indexFile = contentIndexFile(root, contentHash);
    await withFileLeaseAsync(indexFile, async () => {
      const index = await readJsonSafe(indexFile, null);
      if (!index || !index.records || !index.records[contentHash]) return;
      addLocator(index.records[contentHash]);
      delete index.records[contentHash];
      index.updatedAt = new Date().toISOString();
      await atomicJson(indexFile, index);
    }, { timeoutMs: 20000, staleMs: 120000 });
    let erased = 0;
    for (const locator of locators.values()) {
      try {
        if (locator.objectPath) {
          const file = path.join(root, ...locator.objectPath.split('/'));
          if (!isInsideRoot(root, file)) continue;
          await fsp.unlink(file);
          erased += 1;
          continue;
        }
        const file = path.join(root, ...locator.packPath.split('/'));
        if (!isInsideRoot(root, file)) continue;
        const handle = await fsp.open(file, 'r+');
        try {
          const slice = Buffer.alloc(locator.packLength);
          const read = await handle.read(slice, 0, locator.packLength, locator.packOffset);
          if (read.bytesRead !== locator.packLength || hashOf(slice) !== contentHash) continue;
          await handle.write(Buffer.alloc(locator.packLength), 0, locator.packLength, locator.packOffset);
          try { await handle.sync(); } catch (_) {}
          erased += 1;
        } finally { await handle.close(); }
      } catch (error) {
        if (!error || (error.code !== 'ENOENT' && error.code !== 'ENOTDIR')) throw error;
      }
    }
    return erased;
  }

  /* SEÇİLİ MODEL GÖRSELLERİNİN KALICI SİLİNMESİ.
     `match(record)` true dönen her kanonik kimliğe MANUEL mezar taşı yazılır
     (eski bir istemci kopyası onu diriltemez) ve artık hiçbir canlı kaydın
     kullanmadığı baytlar paylaşılan klasörden silinir. Aynı içeriği başka bir
     model hâlâ kullanıyorsa bayt korunur; yalnız silinen kimlik düşer. */
  async function purge({ prefix = '', match } = {}) {
    const root = await rootFolder();
    if (!root) return { available: false, tombstoned: 0, erased: 0, keys: [] };
    const accept = typeof match === 'function' ? match : () => false;
    const keyPrefix = clean(prefix, 300);
    const manifests = [];
    for (const head of await listDeviceHeads()) manifests.push(await readManifest(head.deviceId));
    const targets = new Map();
    const hashes = new Set();
    for (const manifest of manifests) {
      for (const record of Object.values(manifest.records || {})) {
        if (keyPrefix && !record.canonicalKey.startsWith(keyPrefix)) continue;
        if (!accept(record)) continue;
        if (!targets.has(record.canonicalKey)) targets.set(record.canonicalKey, record);
        if (record.status === STATUS_AVAILABLE && record.contentHash) hashes.add(record.contentHash);
      }
    }
    if (!targets.size) return { available: true, tombstoned: 0, erased: 0, keys: [] };
    const published = await publish([...targets.values()].map(record => ({
      canonicalKey: record.canonicalKey, plmId: record.plmId, colourCode: record.colourCode, colour: record.colour,
      source: SOURCE_MANUAL, ownership: OWNERSHIP_MANUAL, status: STATUS_DELETED,
      sourceIdentity: record.sourceIdentity || record.canonicalKey,
    })));
    const alive = new Set();
    for (const manifest of manifests) {
      for (const record of Object.values(manifest.records || {})) {
        if (targets.has(record.canonicalKey)) continue;
        if (record.status === STATUS_AVAILABLE && record.contentHash) alive.add(record.contentHash);
      }
    }
    let erased = 0;
    for (const contentHash of hashes) {
      if (alive.has(contentHash)) continue;
      erased += await eraseContent(root, contentHash, manifests);
    }
    legacyContentCachePromise = null;
    return { available: true, tombstoned: published.published || 0, erased, keys: [...targets.keys()], revision: published.revision || 0 };
  }

  return {
    available, rootFolder, listDeviceHeads, readManifest, readDelta, mergedView,
    lookup, lookupMany, readObject, publish, withRefreshLease, acquireRefreshLease, nextRevision, purge,
  };
}

module.exports = {
  SCHEMA_VERSION, ROOT_FOLDER, OBJECTS, PACKS, CONTENT_INDEX, MANIFESTS, HEADS, LEASES,
  SOURCE_PLM, SOURCE_ASAS, SOURCE_PACKAGE, SOURCE_MANUAL,
  OWNERSHIP_MANUAL, OWNERSHIP_AUTOMATIC,
  STATUS_AVAILABLE, STATUS_UNAVAILABLE, STATUS_DELETED,
  MAX_OBJECT_BYTES, MAX_PACK_BYTES, CONTENT_INDEX_SHARDS,
  createSharedImageStore, normalizeRecord, normalizeManifest, objectRelativePath, normalizeContentLocator, locatorFromRecord,
  normalizeSource, ownershipRank, isNewer, leaseKey, hashOf, extensionFor,
};
