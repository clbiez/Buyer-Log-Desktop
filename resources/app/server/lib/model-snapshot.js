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

function encodeSnapshot(payload) {
  const compacted = compactSnapshotPayload(payload);
  const body = { savedAt: new Date().toISOString(), ...compacted.value };
  const bodyJson = JSON.stringify(body);
  const digest = checksum(bodyJson);
  const json = `{"schemaVersion":${SNAPSHOT_SCHEMA_VERSION},"checksum":"${digest}","payload":${bodyJson}}`;
  return { json: Buffer.from(json, 'utf8'), savedAt: body.savedAt, aliasCount: compacted.aliasCount };
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
  } else {
    throw new Error('Snapshot schema sürümü desteklenmiyor.');
  }
  if (!value || !Array.isArray(value.asasOrders)) throw new Error('Snapshot ana sipariş verisi eksik.');
  return value;
}

function decodeSnapshotBuffer(buffer) {
  return decodeSnapshotText(zlib.gunzipSync(buffer).toString('utf8'));
}

function saveModelSnapshot(userId, payload) {
  const started = Date.now(), encoded = encodeSnapshot(payload);
  const buffer = zlib.gzipSync(encoded.json, { level: 6 });
  decodeSnapshotBuffer(buffer);
  const file = snapshotPath(userId);
  atomicWriteBuffer(file, buffer);
  return { file, savedAt: encoded.savedAt, bytes: buffer.length, uncompressedBytes: encoded.json.length, aliasCount: encoded.aliasCount, totalMs: Date.now() - started };
}

async function writeModelSnapshotAsync(userId, payload) {
  const started = Date.now();
  await new Promise(resolve => setImmediate(resolve));
  const serializeStarted = Date.now(), encoded = encodeSnapshot(payload);
  const compressStarted = Date.now(), buffer = await gzip(encoded.json, { level: 6 });
  const validateStarted = Date.now(), raw = await gunzip(buffer);
  decodeSnapshotText(raw.toString('utf8'));
  const writeStarted = Date.now(), file = snapshotPath(userId);
  await atomicWriteBufferAsync(file, buffer);
  return {
    file, savedAt: encoded.savedAt, bytes: buffer.length, uncompressedBytes: encoded.json.length, aliasCount: encoded.aliasCount,
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
    try { return decodeSnapshotBuffer(fs.readFileSync(candidate)); }
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
  compactSnapshotPayload, expandSnapshotPayload,
  saveModelSnapshot, saveModelSnapshotAsync, loadModelSnapshot, loadModelSnapshotAsync,
};
