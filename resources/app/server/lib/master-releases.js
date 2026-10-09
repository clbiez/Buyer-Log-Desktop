'use strict';

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const { promisify } = require('node:util');
const { withFileLeaseAsync, replaceFileWithRetry } = require('./shared-file-transaction');
const gzip = promisify(zlib.gzip), gunzip = promisify(zlib.gunzip);
const DEFAULT_KEEP = 30;
const DEFAULT_COMPRESSED_BYTES = 32 * 1024 * 1024;
const DEFAULT_DECODED_BYTES = 128 * 1024 * 1024;

function failure(code, statusCode = 503) { return Object.assign(new Error(code), { code, statusCode }); }
// This convention intentionally matches shared-hub.js:stableJson exactly.
function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
function digest(value) { return crypto.createHash('sha256').update(stableJson(value), 'utf8').digest('hex'); }
function versionNumber(value) {
  if (typeof value !== 'number' && (typeof value !== 'string' || !/^[1-9]\d{0,15}$/.test(value))) throw failure('MASTER_RELEASE_VERSION_INVALID', 400);
  const version = Number(value);
  if (!Number.isSafeInteger(version) || version < 1) throw failure('MASTER_RELEASE_VERSION_INVALID', 400);
  return version;
}
function boundedOption(value, fallback) {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || value < 1) throw failure('MASTER_RELEASE_LIMIT_INVALID', 400);
  return value;
}
function releaseRoot(root) {
  if (typeof root !== 'string' || !root.trim()) throw failure('MASTER_RELEASE_ROOT_INVALID', 400);
  return path.join(path.resolve(root), 'master', 'releases');
}
function releaseFile(root, version) { return path.join(releaseRoot(root), `${versionNumber(version)}.json.gz`); }
function summary(envelope) {
  const version = versionNumber(envelope.revision), raw = envelope.payload && envelope.payload.release;
  if (raw && (versionNumber(raw.version) !== version || typeof raw.note !== 'string' || typeof raw.publishedBy !== 'string' || !Number.isFinite(Date.parse(raw.publishedAt)) || !Array.isArray(raw.changedEntities) || raw.changedEntities.some(item => typeof item !== 'string'))) throw failure('MASTER_RELEASE_METADATA_INVALID');
  return raw ? { version, note: raw.note, publishedBy: raw.publishedBy, publishedAt: raw.publishedAt, changedEntities: [...raw.changedEntities] } :
    { version, note: '', publishedBy: String(envelope.actorId || ''), publishedAt: String(envelope.createdAt || ''), changedEntities: [] };
}
function validateArchive(value, expectedVersion) {
  if (!value || value.schemaVersion !== 1 || value.version !== expectedVersion || !value.checkpoint || value.checkpoint.schemaVersion !== 1 || value.checkpoint.revision !== expectedVersion) throw failure('MASTER_RELEASE_INVALID');
  const payload = value.checkpoint.payload;
  if (!payload || payload.authority !== 'moderator') throw failure('MASTER_RELEASE_AUTHORITY_INVALID', 403);
  if (value.payloadSha256 !== digest(payload) || value.checkpointSha256 !== digest(value.checkpoint)) throw failure('MASTER_RELEASE_CHECKSUM_INVALID');
  if (stableJson(value.release) !== stableJson(summary(value.checkpoint))) throw failure('MASTER_RELEASE_METADATA_INVALID');
  return value;
}

async function readRelease(root, version, options = {}) {
  const expected = versionNumber(version), file = releaseFile(root, expected);
  const maxCompressed = boundedOption(options.maxCompressedBytes, DEFAULT_COMPRESSED_BYTES);
  const maxDecoded = boundedOption(options.maxDecodedBytes, DEFAULT_DECODED_BYTES);
  let handle;
  try {
    const lstat = await fsp.lstat(file);
    if (!lstat.isFile() || lstat.isSymbolicLink() || lstat.size > maxCompressed) throw failure('MASTER_RELEASE_FILE_INVALID');
    handle = await fsp.open(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > maxCompressed) throw failure('MASTER_RELEASE_FILE_INVALID');
    // A file can grow after stat. Never let readFile allocate the new size:
    // read only the verified size plus one byte and reject any growth.
    const buffer = Buffer.alloc(stat.size + 1);
    let bytes = 0;
    while (bytes < buffer.length) {
      const read = await handle.read(buffer, bytes, buffer.length - bytes, bytes);
      if (!read.bytesRead) break;
      bytes += read.bytesRead;
    }
    if (bytes > stat.size || bytes > maxCompressed) throw failure('MASTER_RELEASE_FILE_INVALID');
    const compressed = buffer.subarray(0, bytes);
    let value;
    try { value = JSON.parse((await gunzip(compressed, { maxOutputLength: maxDecoded })).toString('utf8')); }
    catch (_) { throw failure('MASTER_RELEASE_DECODE_INVALID'); }
    return validateArchive(value, expected);
  } catch (error) {
    if (error.code === 'ENOENT') throw failure('MASTER_RELEASE_NOT_FOUND', 404);
    throw error;
  } finally { if (handle) await handle.close(); }
}

async function names(root) {
  const entries = await fsp.readdir(releaseRoot(root), { withFileTypes: true }).catch(error => {
    if (error.code === 'ENOENT') return []; throw error;
  });
  return entries.filter(entry => entry.isFile() && /^[1-9]\d{0,15}\.json\.gz$/.test(entry.name))
    .map(entry => { try { return { name: entry.name, version: versionNumber(entry.name.slice(0, -8)) }; } catch (_) { return null; } })
    .filter(Boolean).sort((a, b) => b.version - a.version);
}
async function pruneUnlocked(root, options) {
  const keep = boundedOption(options.keep, DEFAULT_KEEP);
  let removed = 0;
  for (const entry of (await names(root)).slice(keep)) {
    try { await fsp.unlink(path.join(releaseRoot(root), entry.name)); removed++; }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  return { removed };
}
async function pruneReleases(root, options = {}) {
  return withFileLeaseAsync(path.join(releaseRoot(root), 'archive'), () => pruneUnlocked(root, options), { timeoutMs: 15000, staleMs: 120000 });
}
async function listReleases(root, options = {}) {
  const limit = Math.min(DEFAULT_KEEP, boundedOption(options.limit, DEFAULT_KEEP));
  const result = [];
  for (const entry of (await names(root)).slice(0, limit)) {
    try { result.push((await readRelease(root, entry.version, options)).release); }
    catch (error) {
      if (typeof options.onError !== 'function') throw error;
      try { options.onError(error, entry.version); } catch (_) {}
    }
  }
  return result;
}

async function archiveRelease(root, { head, envelope } = {}, options = {}) {
  if (!envelope || envelope.schemaVersion !== 1 || !envelope.payload || envelope.payload.authority !== 'moderator') throw failure('MASTER_RELEASE_AUTHORITY_INVALID', 403);
  const version = versionNumber(envelope.revision);
  if (head && versionNumber(head.revision) !== version) throw failure('MASTER_RELEASE_VERSION_INVALID', 400);
  const payloadSha256 = digest(envelope.payload);
  if (head && head.payloadSha256 && head.payloadSha256 !== payloadSha256) throw failure('MASTER_RELEASE_CHECKSUM_INVALID');
  const value = { schemaVersion: 1, version, release: summary(envelope), checkpoint: envelope, payloadSha256, checkpointSha256: digest(envelope) };
  validateArchive(value, version);
  const decoded = Buffer.from(JSON.stringify(value), 'utf8');
  if (decoded.length > boundedOption(options.maxDecodedBytes, DEFAULT_DECODED_BYTES)) throw failure('MASTER_RELEASE_FILE_INVALID');
  const compressed = await gzip(decoded, { level: zlib.constants.Z_BEST_SPEED });
  if (compressed.length > boundedOption(options.maxCompressedBytes, DEFAULT_COMPRESSED_BYTES)) throw failure('MASTER_RELEASE_FILE_INVALID');
  const area = releaseRoot(root), file = releaseFile(root, version);
  return withFileLeaseAsync(path.join(area, 'archive'), async () => {
    let existing;
    try { existing = await readRelease(root, version, options); }
    catch (error) { if (error.code !== 'MASTER_RELEASE_NOT_FOUND') throw error; }
    if (existing) {
      if (stableJson(existing) !== stableJson(value)) throw failure('MASTER_RELEASE_REVISION_CONFLICT', 409);
      await pruneUnlocked(root, options);
      return { archived: false, unchanged: true, version, release: existing.release };
    }
    await fsp.mkdir(area, { recursive: true });
    const temporary = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
    try {
      const handle = await fsp.open(temporary, 'wx', 0o600);
      try { await handle.writeFile(compressed); try { await handle.sync(); } catch (_) {} } finally { await handle.close(); }
      // Verify the exact staged bytes before publication; no checkpoint gzip
      // checksum is compared because this is a separate archive envelope.
      const verified = JSON.parse((await gunzip(await fsp.readFile(temporary), { maxOutputLength: boundedOption(options.maxDecodedBytes, DEFAULT_DECODED_BYTES) })).toString('utf8'));
      validateArchive(verified, version);
      await replaceFileWithRetry(temporary, file);
    } finally { await fsp.unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
    const pruned = await pruneUnlocked(root, options);
    return { archived: true, unchanged: false, version, release: value.release, pruned: pruned.removed };
  }, { timeoutMs: 15000, staleMs: 120000 });
}

module.exports = { archiveRelease, readRelease, listReleases, pruneReleases };
