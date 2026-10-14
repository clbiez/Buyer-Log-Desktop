'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');
const { promisify } = require('util');
const gzip = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);
const { LOCAL_DATA_ROOT, atomicWriteBuffer, atomicWriteBufferAsync } = require('../user-data');

const SNAPSHOT_ROOT = path.join(LOCAL_DATA_ROOT, 'model-snapshots');
const LEGACY_SNAPSHOT_SCHEMA_VERSION = 1;
const SNAPSHOT_SCHEMA_VERSION = 2;
const TARGET_GROUPS = Object.freeze([
  ['asasOrders', 'asasOrdersByTarget'],
  ['antrepoMap', 'antrepoMapByTarget'],
]);
const snapshotWriteTails = new Map();
const verifiedSnapshots = new Map();
const CONTENT_KEYS = Object.freeze(['asasOrders','asasOrdersByTarget','antrepoMap','antrepoMapByTarget','lflRows','targetAliases']);

function splitCompactedPayload(compacted) {
  const content = {}, metadata = {};
  for (const [key, value] of Object.entries(compacted.value)) {
    (CONTENT_KEYS.includes(key) ? content : metadata)[key] = value;
  }
  return { content, metadata };
}
/* İçerik anahtarı artık yazılan JSON'un kendisinden üretilir ve dosya başlığında
   saklanır. Eskiden her kayıtta veri ayrıca sıkıştırılıp serileştirilip
   hash'leniyor (33 bin siparişte ~3,5 sn), her açılışta da yüklenen snapshot
   için aynı iş tekrarlanıyordu. Başlığında anahtar olmayan eski dosyalar için
   yeniden kullanım yalnız bir sonraki tam yazımdan sonra devreye girer. */
function rememberSnapshot(userId, contentKey, baseChecksum, buffer, metrics = {}) {
  if (!baseChecksum || !contentKey) return;
  verifiedSnapshots.set(safeUserId(userId), {
    contentKey, baseChecksum, compressedChecksum:checksum(buffer), bytes:buffer.length, ...metrics,
  });
}
function applySnapshotMetadata(userId, value) {
  const baseChecksum = value._baseChecksum;
  if (!baseChecksum) return value;
  for (const file of [snapshotPath(userId)+'.meta.json', snapshotPath(userId)+'.meta.json.bak']) {
    try {
      const wrapper = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (wrapper.schemaVersion !== 1 || wrapper.baseChecksum !== baseChecksum || !wrapper.payload
          || checksum(JSON.stringify(wrapper.payload)) !== wrapper.checksum) continue;
      if (Object.keys(wrapper.payload).some(key => CONTENT_KEYS.includes(key) || key.startsWith('_'))) continue;
      Object.assign(value, wrapper.payload);
      break;
    } catch (_) { /* incomplete/corrupt metadata: keep the verified base or backup */ }
  }
  return value;
}

function safeUserId(value) {
  return String(value || 'moderator').replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 100) || 'moderator';
}
function snapshotPath(userId) { return path.join(SNAPSHOT_ROOT, `${safeUserId(userId)}.json.gz`); }
function checksum(value) { return crypto.createHash('sha256').update(value).digest('hex'); }

// Excel/local source modes intentionally reuse the same array/map for CP, Orders
// and Backlog. Plain JSON duplicated that object up to four times on disk and on
// every fallback parse. Preserve target semantics while storing identity aliases.
function compactSnapshotPayload(payload) {
  const value = { ...(payload && typeof payload === 'object' ? payload : {}) };
  const targetAliases = {};
  let aliasCount = 0;
  for (const [baseKey, groupKey] of TARGET_GROUPS) {
    const source = value[groupKey];
    if (!source || typeof source !== 'object' || Array.isArray(source)) continue;
    const compact = {}, aliases = {}, seen = new Map();
    const base = value[baseKey];
    if (base && typeof base === 'object') seen.set(base, baseKey);
    for (const [target, entry] of Object.entries(source)) {
      if (entry && typeof entry === 'object' && seen.has(entry)) {
        aliases[target] = seen.get(entry); aliasCount += 1;
      } else {
        compact[target] = entry;
        if (entry && typeof entry === 'object') seen.set(entry, target);
      }
    }
    value[groupKey] = compact;
    if (Object.keys(aliases).length) targetAliases[groupKey] = aliases;
  }
  if (Object.keys(targetAliases).length) value.targetAliases = targetAliases;
  return { value, aliasCount };
}

function expandSnapshotPayload(snapshot) {
  const value = { ...(snapshot && typeof snapshot === 'object' ? snapshot : {}) };
  const allAliases = value.targetAliases && typeof value.targetAliases === 'object' ? value.targetAliases : {};
  for (const [baseKey, groupKey] of TARGET_GROUPS) {
    const stored = value[groupKey] && typeof value[groupKey] === 'object' && !Array.isArray(value[groupKey])
      ? { ...value[groupKey] } : {};
    const aliases = allAliases[groupKey] && typeof allAliases[groupKey] === 'object' ? allAliases[groupKey] : {};
    const resolving = new Set();
    const resolve = target => {
      if (Object.prototype.hasOwnProperty.call(stored, target)) return stored[target];
      if (resolving.has(target)) throw new Error(`Snapshot target alias döngüsü: ${groupKey}.${target}`);
      resolving.add(target);
      const ref = aliases[target];
      const resolved = ref === baseKey ? value[baseKey] : resolve(ref);
      resolving.delete(target);
      if (resolved === undefined) throw new Error(`Snapshot target alias bulunamadı: ${groupKey}.${target}`);
      stored[target] = resolved;
      return resolved;
    };
    for (const target of Object.keys(aliases)) resolve(target);
    value[groupKey] = stored;
  }
  delete value.targetAliases;
  return value;
}

// İçerik JSON'u bir kez üretilir: hem dosyaya yazılır hem içerik anahtarı olur.
// Gövde hash'i ve dosya baytları yalnız gerçekten yazılacaksa hazırlanır.
function prepareSnapshot(payload) {
  const compacted = compactSnapshotPayload(payload);
  const { content, metadata } = splitCompactedPayload(compacted);
  const contentJson = JSON.stringify(content);
  return { contentJson, contentKey:checksum(contentJson), metadata, savedAt:new Date().toISOString(), aliasCount:compacted.aliasCount };
}
function finishSnapshot(prepared) {
  // Gövde = metadata + içerik; çözücü gövdeyi olduğu gibi ayrıştırır.
  const { contentJson, contentKey, metadata, savedAt } = prepared;
  const metadataJson = JSON.stringify({ savedAt, ...metadata });
  // Gövde parçalar halinde hash'lenir ve tek tampona yazılır. Eskiden parçalar
  // birleştirilmiş tek metne dönüştürülüyordu; V8 bu metni düzleştirirken büyük
  // veri setinde içeriğin ikinci tam kopyasını heap'te açıyor ve yenileme
  // "snapshot-save" adımında heap out of memory ile çöküyordu. Baytlar aynıdır.
  const bodyParts = contentJson === '{}' ? [metadataJson] : [`${metadataJson.slice(0, -1)},`, contentJson.slice(1)];
  const hash = crypto.createHash('sha256');
  for (const part of bodyParts) hash.update(part, 'utf8');
  const digest = hash.digest('hex');
  const parts = [`{"schemaVersion":${SNAPSHOT_SCHEMA_VERSION},"checksum":"${digest}","contentKey":"${contentKey}","payload":`, ...bodyParts, '}'];
  const json = Buffer.allocUnsafe(parts.reduce((sum, part) => sum + Buffer.byteLength(part, 'utf8'), 0));
  let offset = 0;
  for (const part of parts) offset += json.write(part, offset, 'utf8');
  if (offset !== json.length) throw new Error('Snapshot gövdesi yazılamadı.');
  return { ...prepared, json, baseChecksum:digest };
}
function encodeSnapshot(payload) { return finishSnapshot(prepareSnapshot(payload)); }

/* Model snapshot'ı düz JSON'dur: Date alanları "2026-03-09T21:00:00.000Z"
   metnine dönüşür (TR'de 10.03 gece yarısı). Canlı yenilemede ise aynı alanlar
   Date nesnesidir. Bazı tüketiciler (ör. Sipariş Yerleştirme tarihi, P&A
   snapshot'ı) metni olduğu gibi taşıyor ya da ilk 10 karakterini UTC günü
   olarak okuyordu; soğuk açılıştan sonra tarihler bir gün geri ve saat
   kısmıyla görünüyordu. Sipariş ve IAS verisindeki tam Date#toJSON biçimli
   metinler burada yeniden Date'e çevrilir; böylece hydrate edilen veri canlı
   yenilemeyle aynı tiptedir. Yalnız tam ISO-Z biçimi dönüştürülür. */
const DATE_JSON = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
function reviveDatesIn(root, seen = new WeakSet()) {
  let revived = 0;
  const visit = node => {
    if (!node || typeof node !== 'object' || node instanceof Date || seen.has(node)) return;
    seen.add(node);
    if (Array.isArray(node)) {
      for (let i = 0; i < node.length; i += 1) {
        const v = node[i];
        if (typeof v === 'string') { if (v.length === 24 && v.charCodeAt(10) === 84 && v.charCodeAt(23) === 90 && DATE_JSON.test(v)) { node[i] = new Date(v); revived += 1; } }
        else if (v && typeof v === 'object') visit(v);
      }
      return;
    }
    for (const key of Object.keys(node)) {
      const v = node[key];
      if (typeof v === 'string') { if (v.length === 24 && v.charCodeAt(10) === 84 && v.charCodeAt(23) === 90 && DATE_JSON.test(v)) { node[key] = new Date(v); revived += 1; } }
      else if (v && typeof v === 'object') visit(v);
    }
  };
  visit(root);
  return revived;
}
function reviveSnapshotDates(value) {
  if (!value || typeof value !== 'object') return 0;
  let total = 0;
  const seen = new WeakSet(); // hedef takma adları aynı diziyi paylaşır; bir kez gezilir
  for (const [baseKey, groupKey] of TARGET_GROUPS) {
    total += reviveDatesIn(value[baseKey], seen);
    total += reviveDatesIn(value[groupKey], seen);
  }
  return total;
}

function decodeSnapshotText(text) {
  const parsed = JSON.parse(text);
  let value;
  if (parsed && parsed.schemaVersion === LEGACY_SNAPSHOT_SCHEMA_VERSION) {
    value = parsed;
  } else if (parsed && parsed.schemaVersion === SNAPSHOT_SCHEMA_VERSION && parsed.payload) {
    const marker = '"payload":', start = text.indexOf(marker);
    if (start < 0 || text[text.length - 1] !== '}') throw new Error('Snapshot payload biçimi geçersiz.');
    const payloadJson = text.slice(start + marker.length, -1);
    if (!parsed.checksum || checksum(payloadJson) !== parsed.checksum) throw new Error('Snapshot checksum uyuşmuyor.');
    value = expandSnapshotPayload(parsed.payload);
    Object.defineProperty(value, '_baseChecksum', { value:parsed.checksum, enumerable:false });
    if (/^[0-9a-f]{64}$/.test(String(parsed.contentKey || ''))) Object.defineProperty(value, '_contentKey', { value:parsed.contentKey, enumerable:false });
  } else {
    throw new Error('Snapshot schema sürümü desteklenmiyor.');
  }
  if (!value || !Array.isArray(value.asasOrders)) throw new Error('Snapshot ana sipariş verisi eksik.');
  reviveSnapshotDates(value);
  return value;
}

function decodeSnapshotBuffer(buffer) {
  return decodeSnapshotText(zlib.gunzipSync(buffer).toString('utf8'));
}

function assertSnapshotPayload(payload) {
  if (!payload || !Array.isArray(payload.asasOrders)) throw new Error('Snapshot ana sipariş verisi eksik.');
}
/* Yazmadan önce doğrulama: sıkıştırılmış baytlar açılınca üretilen JSON'un
   birebir aynısı olmalı. Eskiden bunun yerine tüm snapshot yeniden
   ayrıştırılıyordu (JSON.parse + tarih dönüşümü); bayt eşitliği daha güçlü ve
   çok daha ucuz bir kanıttır, JSON zaten JSON.stringify ile üretildi. */
function assertRoundTrip(raw, encoded) {
  if (!Buffer.isBuffer(raw) || !raw.equals(encoded.json)) throw new Error('Snapshot sıkıştırma doğrulaması başarısız.');
}

function saveModelSnapshot(userId, payload) {
  assertSnapshotPayload(payload);
  const started = Date.now(), encoded = encodeSnapshot(payload);
  const buffer = zlib.gzipSync(encoded.json, { level: 6 });
  assertRoundTrip(zlib.gunzipSync(buffer), encoded);
  const file = snapshotPath(userId);
  atomicWriteBuffer(file, buffer);
  rememberSnapshot(userId, encoded.contentKey, encoded.baseChecksum, buffer, { uncompressedBytes:encoded.json.length });
  return { file, savedAt: encoded.savedAt, bytes: buffer.length, uncompressedBytes: encoded.json.length, aliasCount: encoded.aliasCount, reused:false, totalMs: Date.now() - started };
}

async function writeModelSnapshotAsync(userId, payload) {
  const started = Date.now();
  await new Promise(resolve => setImmediate(resolve));
  assertSnapshotPayload(payload);
  const serializeStarted = Date.now(), prepared = prepareSnapshot(payload), previous = verifiedSnapshots.get(safeUserId(userId));
  if (previous && previous.contentKey === prepared.contentKey) {
    // Re-read and hash the compressed primary: a replaced/deleted/corrupt file
    // must never inherit an in-memory verification from an older generation.
    const primary = await fs.promises.readFile(snapshotPath(userId)).catch(() => null);
    if (primary && checksum(primary) === previous.compressedChecksum) {
      const metadata = { savedAt:prepared.savedAt, ...prepared.metadata };
      const wrapper = { schemaVersion:1, baseChecksum:previous.baseChecksum, checksum:checksum(JSON.stringify(metadata)), payload:metadata };
      await atomicWriteBufferAsync(snapshotPath(userId)+'.meta.json', Buffer.from(JSON.stringify(wrapper)));
      return { file:snapshotPath(userId), savedAt:metadata.savedAt, bytes:previous.bytes, uncompressedBytes:previous.uncompressedBytes,
        aliasCount:prepared.aliasCount, reused:true, totalMs:Date.now()-started };
    }
  }
  const encoded = finishSnapshot(prepared);
  const compressStarted = Date.now(), buffer = await gzip(encoded.json, { level: 6 });
  const validateStarted = Date.now(), raw = await gunzip(buffer);
  assertRoundTrip(raw, encoded);
  const writeStarted = Date.now(), file = snapshotPath(userId);
  await atomicWriteBufferAsync(file, buffer);
  rememberSnapshot(userId, encoded.contentKey, encoded.baseChecksum, buffer, { uncompressedBytes:encoded.json.length });
  return {
    file, savedAt: encoded.savedAt, bytes: buffer.length, uncompressedBytes: encoded.json.length, aliasCount: encoded.aliasCount, reused:false,
    serializeMs: compressStarted - serializeStarted, compressMs: validateStarted - compressStarted,
    validateMs: writeStarted - validateStarted, writeMs: Date.now() - writeStarted, totalMs: Date.now() - started,
  };
}

function saveModelSnapshotAsync(userId, payload) {
  const key = safeUserId(userId), previous = snapshotWriteTails.get(key) || Promise.resolve();
  const next = previous.catch(() => {}).then(() => writeModelSnapshotAsync(userId, payload));
  snapshotWriteTails.set(key, next);
  return next.finally(() => { if (snapshotWriteTails.get(key) === next) snapshotWriteTails.delete(key); });
}

function loadModelSnapshot(userId) {
  const file = snapshotPath(userId);
  for (const candidate of [file, file + '.bak']) {
    if (!fs.existsSync(candidate)) continue;
    try {
      const buffer = fs.readFileSync(candidate), value = decodeSnapshotBuffer(buffer);
      if (candidate === file) rememberSnapshot(userId, value._contentKey, value._baseChecksum, buffer);
      return applySnapshotMetadata(userId, value);
    }
    catch (_) { /* bozuk ana kopyada yedeği dene */ }
  }
  return null;
}

async function loadModelSnapshotAsync(userId) {
  const file = snapshotPath(userId);
  for (const candidate of [file, file + '.bak']) {
    const started = Date.now();
    try {
      const compressed = await fs.promises.readFile(candidate);
      const readMs = Date.now() - started, raw = await gunzip(compressed), inflateMs = Date.now() - started - readMs;
      const parseStarted = Date.now(), value = decodeSnapshotText(raw.toString('utf8'));
      if (candidate === file) rememberSnapshot(userId, value._contentKey, value._baseChecksum, compressed, { uncompressedBytes:raw.length });
      applySnapshotMetadata(userId, value);
      Object.defineProperty(value, '_snapshotMetrics', {
        value:{ readMs, inflateMs, parseMs:Date.now() - parseStarted, totalMs:Date.now() - started, bytes:compressed.length, fallback:candidate !== file },
        enumerable:false,
      });
      return value;
    } catch (error) {
      if (error && error.code === 'ENOENT') continue;
      // bozuk ana kopyada yedeği dene
    }
  }
  return null;
}

module.exports = {
  SNAPSHOT_ROOT, SNAPSHOT_SCHEMA_VERSION, snapshotPath,
  compactSnapshotPayload, expandSnapshotPayload, reviveSnapshotDates,
  saveModelSnapshot, saveModelSnapshotAsync, loadModelSnapshot, loadModelSnapshotAsync,
};
