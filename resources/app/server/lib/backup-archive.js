'use strict';

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const zlib = require('zlib');
const { once } = require('events');
const { Readable } = require('stream');

const BACKUP_VERSION = 1;
const BACKUP_SCHEMA_VERSION = 1;
const CHUNK_BYTES = 256 * 1024;
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    table[n] = c >>> 0;
  }
  return table;
})();

function cleanArchivePath(value) {
  const name = String(value || '').replace(/\\/g, '/').replace(/^\/+/, '');
  if (!name || name.includes('\0') || name.split('/').some(part => !part || part === '.' || part === '..')) throw new Error('Geçersiz backup içerik yolu.');
  return name;
}
function crcUpdate(crc, buffer) {
  let c = crc >>> 0;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return c >>> 0;
}
function dosDateTime(value) {
  const d = value instanceof Date ? value : new Date(value || Date.now());
  const year = Math.max(1980, d.getFullYear());
  return {
    time: ((d.getHours() & 31) << 11) | ((d.getMinutes() & 63) << 5) | ((Math.floor(d.getSeconds() / 2)) & 31),
    date: (((year - 1980) & 127) << 9) | (((d.getMonth() + 1) & 15) << 5) | (d.getDate() & 31),
  };
}
async function streamWrite(stream, buffer) {
  if (!stream.write(buffer)) await once(stream, 'drain');
}
async function snapshotEntry(entry, root) {
  const name = cleanArchivePath(entry.name);
  const target = path.join(root, ...name.split('/'));
  await fsp.mkdir(path.dirname(target), { recursive: true });
  const temp = `${target}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  const output = fs.createWriteStream(temp, { flags: 'wx' });
  const hash = crypto.createHash('sha256');
  let crc = 0xffffffff, size = 0, before = null;
  try {
    if (entry.sourcePath) before = await fsp.stat(entry.sourcePath);
    const input = entry.sourcePath ? fs.createReadStream(entry.sourcePath, { highWaterMark: CHUNK_BYTES }) : [Buffer.isBuffer(entry.buffer) ? entry.buffer : Buffer.from(String(entry.buffer || ''), 'utf8')];
    for await (const chunk of input) {
      size += chunk.length; hash.update(chunk); crc = crcUpdate(crc, chunk);
      if (!output.write(chunk)) await once(output, 'drain');
    }
    output.end(); await once(output, 'finish');
    if (before) {
      const after = await fsp.stat(entry.sourcePath);
      if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || size !== before.size) throw new Error(`Backup sırasında kaynak değişti: ${name}`);
    }
    await fsp.rename(temp, target);
    return { name, file: target, size, sha256: hash.digest('hex'), crc32: (crc ^ 0xffffffff) >>> 0, stage: entry.stage || 'data', sourcePath: entry.sourcePath || null, sourceSize: before && before.size, sourceMtimeMs: before && before.mtimeMs };
  } catch (error) {
    output.destroy();
    try { await fsp.rm(temp, { force: true }); } catch (_) {}
    throw error;
  }
}
async function writeZip(file, entries) {
  const output = fs.createWriteStream(file, { flags: 'wx' });
  const central = [];
  let offset = 0;
  try {
    for (const entry of entries) {
      const name = Buffer.from(entry.name, 'utf8'), stamp = dosDateTime(Date.now()), localOffset = offset;
      const header = Buffer.alloc(30);
      header.writeUInt32LE(0x04034b50, 0); header.writeUInt16LE(20, 4); header.writeUInt16LE(0x0800, 6);
      header.writeUInt16LE(0, 8); header.writeUInt16LE(stamp.time, 10); header.writeUInt16LE(stamp.date, 12);
      header.writeUInt32LE(entry.crc32, 14); header.writeUInt32LE(entry.size, 18); header.writeUInt32LE(entry.size, 22); header.writeUInt16LE(name.length, 26);
      await streamWrite(output, header); await streamWrite(output, name); offset += header.length + name.length;
      for await (const chunk of fs.createReadStream(entry.file, { highWaterMark: CHUNK_BYTES })) { await streamWrite(output, chunk); offset += chunk.length; }
      central.push({ entry, name, stamp, localOffset });
    }
    const centralOffset = offset;
    for (const item of central) {
      const header = Buffer.alloc(46), entry = item.entry;
      header.writeUInt32LE(0x02014b50, 0); header.writeUInt16LE(20, 4); header.writeUInt16LE(20, 6); header.writeUInt16LE(0x0800, 8);
      header.writeUInt16LE(0, 10); header.writeUInt16LE(item.stamp.time, 12); header.writeUInt16LE(item.stamp.date, 14);
      header.writeUInt32LE(entry.crc32, 16); header.writeUInt32LE(entry.size, 20); header.writeUInt32LE(entry.size, 24); header.writeUInt16LE(item.name.length, 28);
      header.writeUInt32LE(item.localOffset, 42);
      await streamWrite(output, header); await streamWrite(output, item.name); offset += header.length + item.name.length;
    }
    const eocd = Buffer.alloc(22), centralSize = offset - centralOffset;
    eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(entries.length, 8); eocd.writeUInt16LE(entries.length, 10);
    eocd.writeUInt32LE(centralSize, 12); eocd.writeUInt32LE(centralOffset, 16);
    await streamWrite(output, eocd); output.end(); await once(output, 'finish');
  } catch (error) { output.destroy(); throw error; }
}
async function validateZip(file, expectedNames) {
  const stat = await fsp.stat(file);
  if (stat.size < 22) throw new Error('Backup ZIP dosyası eksik.');
  const handle = await fsp.open(file, 'r');
  try {
    const tail = Buffer.alloc(Math.min(stat.size, 65557));
    await readExact(handle, tail, stat.size - tail.length);
    let pos = tail.length - 22;
    while (pos >= 0 && tail.readUInt32LE(pos) !== 0x06054b50) pos--;
    if (pos < 0) throw new Error('Backup ZIP bitiş kaydı bulunamadı.');
    const count = tail.readUInt16LE(pos + 10), size = tail.readUInt32LE(pos + 12), start = tail.readUInt32LE(pos + 16);
    if (count !== expectedNames.length || start + size + 22 !== stat.size) throw new Error('Backup ZIP dizini doğrulanamadı.');
    const directory = Buffer.alloc(size); await readExact(handle, directory, start);
    const records = []; let cursor = 0;
    while (cursor < directory.length) {
      if (directory.readUInt32LE(cursor) !== 0x02014b50) throw new Error('Backup ZIP merkez dizini bozuk.');
      const nameLength = directory.readUInt16LE(cursor + 28), extraLength = directory.readUInt16LE(cursor + 30), commentLength = directory.readUInt16LE(cursor + 32);
      const name = directory.subarray(cursor + 46, cursor + 46 + nameLength).toString('utf8');
      records.push({ name, method: directory.readUInt16LE(cursor + 10), crc32: directory.readUInt32LE(cursor + 16), compressedSize: directory.readUInt32LE(cursor + 20), size: directory.readUInt32LE(cursor + 24), localOffset: directory.readUInt32LE(cursor + 42) });
      cursor += 46 + nameLength + extraLength + commentLength;
    }
    const found = records.map(item => item.name);
    if (cursor !== directory.length || new Set(found).size !== found.length || found.length !== expectedNames.length || expectedNames.some(name => !found.includes(name)) || !found.includes('manifest.json')) throw new Error('Backup ZIP içerik listesi doğrulanamadı.');
    const digests = new Map(); let manifestBuffer = null;
    for (const record of records) {
      if (record.method !== 0 || record.compressedSize !== record.size) throw new Error(`Desteklenmeyen backup ZIP kaydı: ${record.name}`);
      const local = Buffer.alloc(30); await readExact(handle, local, record.localOffset);
      if (local.readUInt32LE(0) !== 0x04034b50 || local.readUInt16LE(8) !== 0) throw new Error(`Backup ZIP yerel kaydı bozuk: ${record.name}`);
      const localNameLength = local.readUInt16LE(26), localExtraLength = local.readUInt16LE(28), localName = Buffer.alloc(localNameLength);
      await readExact(handle, localName, record.localOffset + 30);
      if (localName.toString('utf8') !== record.name || local.readUInt32LE(18) !== record.size || local.readUInt32LE(14) !== record.crc32) throw new Error(`Backup ZIP kayıt bilgisi uyuşmuyor: ${record.name}`);
      const dataStart = record.localOffset + 30 + localNameLength + localExtraLength, hash = crypto.createHash('sha256');
      let remaining = record.size, position = dataStart, crc = 0xffffffff; const manifestChunks = [];
      while (remaining > 0) {
        const chunk = Buffer.alloc(Math.min(CHUNK_BYTES, remaining)); await readExact(handle, chunk, position);
        hash.update(chunk); crc = crcUpdate(crc, chunk); if (record.name === 'manifest.json') manifestChunks.push(chunk);
        remaining -= chunk.length; position += chunk.length;
      }
      if (((crc ^ 0xffffffff) >>> 0) !== record.crc32) throw new Error(`Backup ZIP checksum doğrulaması başarısız: ${record.name}`);
      digests.set(record.name, { size: record.size, sha256: hash.digest('hex') });
      if (record.name === 'manifest.json') manifestBuffer = Buffer.concat(manifestChunks);
    }
    let manifest;
    try { manifest = JSON.parse(manifestBuffer.toString('utf8')); } catch (_) { throw new Error('Backup manifest okunamadı.'); }
    if (!manifest || !manifest.backup_version || !manifest.schema_version || !Array.isArray(manifest.contents)) throw new Error('Backup manifest eksik.');
    const listed = new Map(manifest.contents.map(item => [item.path, item]));
    for (const record of records) if (record.name !== 'manifest.json') {
      const declared = listed.get(record.name), actual = digests.get(record.name);
      if (!declared || Number(declared.size) !== actual.size || declared.sha256 !== actual.sha256) throw new Error(`Backup manifest checksum doğrulaması başarısız: ${record.name}`);
    }
    if (listed.size !== records.length - 1) throw new Error('Backup manifest içerik listesi doğrulanamadı.');
    return { size: stat.size, entries: found.length };
  } finally { await handle.close(); }
}
async function readExact(handle, buffer, position) {
  let offset = 0;
  while (offset < buffer.length) {
    const result = await handle.read(buffer, offset, buffer.length - offset, position + offset);
    if (!result.bytesRead) throw new Error('Backup ZIP beklenmedik biçimde sona erdi.');
    offset += result.bytesRead;
  }
}

const MAX_ZIP_CENTRAL_DIRECTORY_BYTES = 128 * 1024 * 1024;
const MAX_ZIP_ENTRIES = 250000;
const MAX_MANIFEST_BYTES = 64 * 1024 * 1024;

function archiveError(code, message, statusCode = 400, details = null) {
  return Object.assign(new Error(message), { code, statusCode, details });
}
function safeZipName(value, directory = false) {
  const raw = String(value || '').replace(/\\/g, '/');
  if (!raw || raw.includes('\0') || raw.startsWith('/') || /^[A-Za-z]:\//.test(raw) || raw.startsWith('//')) throw archiveError('RESTORE_UNSAFE_PATH', `Backup içinde güvenli olmayan yol bulundu: ${raw}`);
  const parts = raw.split('/');
  if (directory && parts.at(-1) === '') parts.pop();
  if (!parts.length || parts.some(part => !part || part === '.' || part === '..')) throw archiveError('RESTORE_UNSAFE_PATH', `Backup içinde güvenli olmayan yol bulundu: ${raw}`);
  return parts.join('/');
}
async function readArchiveTail(handle, size) {
  const length = Math.min(Number(size), 65557);
  const buffer = Buffer.alloc(length);
  await readExact(handle, buffer, Number(size) - length);
  return buffer;
}
function findEndOfCentralDirectory(tail) {
  for (let position = tail.length - 22; position >= 0; position--) if (tail.readUInt32LE(position) === 0x06054b50) return position;
  throw archiveError('RESTORE_ARCHIVE_INVALID', 'Backup ZIP bitiş kaydı bulunamadı.');
}
function isUnsafeZipLink(externalAttributes) {
  const attributes = Number(externalAttributes) >>> 0;
  const unixType = (attributes >>> 16) & 0xf000;
  const dosAttributes = attributes & 0xffff;
  return unixType === 0xa000 || (dosAttributes & 0x0400) !== 0;
}
function commonWrapperPrefix(rawRecords) {
  const files = rawRecords.filter(record => !record.directory);
  if (files.some(record => record.rawName === 'manifest.json')) return '';
  const manifests = files.filter(record => record.rawName.split('/').at(-1) === 'manifest.json');
  const rootManifests = manifests.filter(record => record.rawName.split('/').length === 2);
  if (rootManifests.length === 1) return rootManifests[0].rawName.split('/')[0];
  if (manifests.length !== 1) return '';
  const parts = manifests[0].rawName.split('/');
  if (parts.length < 2) return '';
  const prefix = parts[0];
  if (!rawRecords.every(record => record.rawName === prefix || record.rawName === `${prefix}/` || record.rawName.startsWith(`${prefix}/`))) return '';
  return prefix;
}
async function readZipIndex(file) {
  const stat = await fsp.stat(file), handle = await fsp.open(file, 'r');
  try {
    const tail = await readArchiveTail(handle, stat.size), end = findEndOfCentralDirectory(tail);
    const disk = tail.readUInt16LE(end + 4), centralDisk = tail.readUInt16LE(end + 6);
    const countOnDisk = tail.readUInt16LE(end + 8), count = tail.readUInt16LE(end + 10);
    const centralSize = tail.readUInt32LE(end + 12), centralOffset = tail.readUInt32LE(end + 16);
    if (disk !== 0 || centralDisk !== 0 || countOnDisk !== count) throw archiveError('RESTORE_ARCHIVE_INVALID', 'Çok diskli backup ZIP desteklenmiyor.');
    if (count === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff) throw archiveError('RESTORE_ARCHIVE_INVALID', 'ZIP64 backup arşivleri bu sürümde desteklenmiyor.');
    if (count > MAX_ZIP_ENTRIES || centralSize > MAX_ZIP_CENTRAL_DIRECTORY_BYTES || centralOffset + centralSize + 22 > stat.size) throw archiveError('RESTORE_ARCHIVE_INVALID', 'Backup ZIP merkez dizini güvenli sınırların dışında.');
    const directory = Buffer.alloc(centralSize); await readExact(handle, directory, centralOffset);
    const rawRecords = []; let cursor = 0;
    while (cursor < directory.length) {
      if (cursor + 46 > directory.length || directory.readUInt32LE(cursor) !== 0x02014b50) throw archiveError('RESTORE_ARCHIVE_INVALID', 'Backup ZIP merkez dizini bozuk.');
      const nameLength = directory.readUInt16LE(cursor + 28), extraLength = directory.readUInt16LE(cursor + 30), commentLength = directory.readUInt16LE(cursor + 32), recordLength = 46 + nameLength + extraLength + commentLength;
      if (cursor + recordLength > directory.length) throw archiveError('RESTORE_ARCHIVE_INVALID', 'Backup ZIP kayıt uzunluğu bozuk.');
      const rawName = directory.subarray(cursor + 46, cursor + 46 + nameLength).toString('utf8');
      const directoryEntry = rawName.endsWith('/'), name = safeZipName(rawName, directoryEntry);
      const externalAttributes = directory.readUInt32LE(cursor + 38);
      if (isUnsafeZipLink(externalAttributes)) throw archiveError('RESTORE_UNSAFE_PATH', `Backup içindeki bağlantı/reparse kaydı reddedildi: ${rawName}`);
      rawRecords.push({
        rawName, name, directory: directoryEntry, flags: directory.readUInt16LE(cursor + 8), method: directory.readUInt16LE(cursor + 10),
        crc32: directory.readUInt32LE(cursor + 16), compressedSize: directory.readUInt32LE(cursor + 20), size: directory.readUInt32LE(cursor + 24),
        localOffset: directory.readUInt32LE(cursor + 42), externalAttributes,
      });
      cursor += recordLength;
    }
    if (cursor !== directory.length) throw archiveError('RESTORE_ARCHIVE_INVALID', 'Backup ZIP merkez dizini tamamlanmadı.');
    const names = rawRecords.filter(record => !record.directory).map(record => record.name);
    if (new Set(names).size !== names.length) throw archiveError('RESTORE_ARCHIVE_INVALID', 'Backup ZIP içinde aynı hedefe çözülen yinelenen dosya adı bulundu.');
    const wrapperPrefix = commonWrapperPrefix(rawRecords);
    const prefix = wrapperPrefix ? `${wrapperPrefix}/` : '';
    const records = rawRecords.filter(record => !record.directory).map(record => {
      const logicalName = prefix && record.name.startsWith(prefix) ? record.name.slice(prefix.length) : record.name;
      return { ...record, name: safeZipName(logicalName) };
    });
    if (wrapperPrefix && records.some(record => record.name === record.rawName && record.rawName !== 'manifest.json')) throw archiveError('RESTORE_UNSAFE_PATH', 'Backup ZIP wrapper klasörü dışına taşan kayıt içeriyor.');
    const logicalNames = records.map(record => record.name);
    if (new Set(logicalNames).size !== logicalNames.length) throw archiveError('RESTORE_ARCHIVE_INVALID', 'Backup ZIP wrapper kaldırıldığında yinelenen hedef dosya bulundu.');
    return { file, size: Number(stat.size), wrapperPrefix, records };
  } finally { await handle.close(); }
}
function manifestLimitForIndex(index = {}) {
  const count = Array.isArray(index.records) ? index.records.length : Number(index.recordCount) || 0;
  if (count <= 5000) return 4 * 1024 * 1024;
  return Math.min(MAX_MANIFEST_BYTES, 4 * 1024 * 1024 + Math.ceil(count / 5000) * 8 * 1024 * 1024);
}
async function archiveRecordStream(file, record) {
  const handle = await fsp.open(file, 'r');
  try {
    const local = Buffer.alloc(30); await readExact(handle, local, record.localOffset);
    if (local.readUInt32LE(0) !== 0x04034b50) throw archiveError('RESTORE_ARCHIVE_INVALID', `Backup ZIP yerel kaydı bozuk: ${record.name}`);
    const localNameLength = local.readUInt16LE(26), localExtraLength = local.readUInt16LE(28), localName = Buffer.alloc(localNameLength);
    await readExact(handle, localName, record.localOffset + 30);
    if (localName.toString('utf8') !== record.rawName) throw archiveError('RESTORE_ARCHIVE_INVALID', `Backup ZIP kayıt adı uyuşmuyor: ${record.name}`);
    const dataStart = record.localOffset + 30 + localNameLength + localExtraLength;
    if (dataStart + record.compressedSize > Number((await fsp.stat(file)).size)) throw archiveError('RESTORE_ARCHIVE_INVALID', `Backup ZIP veri alanı dosya sınırını aşıyor: ${record.name}`);
    if (Number(record.compressedSize) === 0) {
      await handle.close();
      if (Number(record.size) !== 0 || Number(record.method) !== 0) {
        throw archiveError('RESTORE_ARCHIVE_INVALID', `Backup ZIP boş kayıt biçimi geçersiz: ${record.name}`);
      }
      return Readable.from([]);
    }
    const source = fs.createReadStream(file, { start: dataStart, end: dataStart + record.compressedSize - 1, highWaterMark: CHUNK_BYTES });
    source.once('close', () => { void handle.close().catch(() => {}); });
    if (record.method === 0) return source;
    if (record.method === 8) return source.pipe(zlib.createInflateRaw());
    source.destroy(); await handle.close(); throw archiveError('RESTORE_ARCHIVE_INVALID', `Desteklenmeyen backup ZIP sıkıştırma yöntemi: ${record.name}`);
  } catch (error) { await handle.close().catch(() => {}); throw error; }
}
async function streamDigest(file, record, { collect = false, limit = MAX_MANIFEST_BYTES, onProgress = null, shouldCancel = null } = {}) {
  const input = await archiveRecordStream(file, record), hash = crypto.createHash('sha256');
  let crc = 0xffffffff, size = 0; const chunks = [];
  try {
    for await (const chunk of input) {
      if (typeof shouldCancel === 'function' && shouldCancel()) throw archiveError('RESTORE_CANCELLED', 'Restore kullanıcı tarafından iptal edildi.', 409);
      size += chunk.length; hash.update(chunk); crc = crcUpdate(crc, chunk);
      if (collect) { if (size > limit) throw archiveError('RESTORE_MANIFEST_TOO_LARGE', 'Backup manifesti güvenli boyut sınırını aşıyor.'); chunks.push(chunk); }
      if (typeof onProgress === 'function') onProgress({ currentBytes: chunk.length, item: record.name });
    }
  } catch (error) { input.destroy?.(); throw error; }
  const actualCrc = (crc ^ 0xffffffff) >>> 0;
  if (size !== Number(record.size) || actualCrc !== Number(record.crc32)) throw archiveError('RESTORE_CHECKSUM_FAILED', `Backup checksum doğrulaması başarısız: ${record.name}`);
  return { size, sha256: hash.digest('hex'), crc32: actualCrc, buffer: collect ? Buffer.concat(chunks) : null };
}
async function readBackupJsonEntry(file, info, archivePath, limit = 32 * 1024 * 1024) {
  const wanted = safeZipName(archivePath);
  const record = info && Array.isArray(info.records) ? info.records.find(item => item.name === wanted) : null;
  if (!record) return null;
  const digest = await streamDigest(file, record, { collect: true, limit });
  try { return JSON.parse(digest.buffer.toString('utf8')); }
  catch (error) { throw archiveError('RESTORE_ARCHIVE_INVALID', `Backup içindeki JSON okunamadı: ${wanted}`, 400, { cause: error.message }); }
}
async function fileSha256(file) {
  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(file, { highWaterMark: CHUNK_BYTES })) hash.update(chunk);
  return hash.digest('hex');
}
async function inspectBackupArchive(file, { requireType = null, validateData = true, onProgress = null } = {}) {
  const index = await readZipIndex(file), manifestRecords = index.records.filter(record => record.name === 'manifest.json');
  if (manifestRecords.length !== 1) throw archiveError('RESTORE_MANIFEST_INVALID', 'Backup kök manifest.json içermiyor veya birden fazla ana manifest içeriyor.');
  const manifestDigest = await streamDigest(file, manifestRecords[0], { collect: true, limit: manifestLimitForIndex(index), onProgress });
  let manifest;
  try { manifest = JSON.parse(manifestDigest.buffer.toString('utf8')); } catch (_) { throw archiveError('RESTORE_MANIFEST_INVALID', 'Backup manifesti okunamadı.'); }
  if (!manifest || !manifest.backup_version || !manifest.schema_version || !Array.isArray(manifest.contents)) throw archiveError('RESTORE_MANIFEST_INVALID', 'Backup manifest eksik.');
  if (requireType && manifest.backup_type !== requireType) throw archiveError('RESTORE_WRONG_TYPE', `Backup türü ${requireType} olmalı.`, 400);
  const declared = new Map();
  for (const item of manifest.contents) {
    if (!item || typeof item.path !== 'string' || declared.has(item.path)) throw archiveError('RESTORE_MANIFEST_INVALID', 'Backup manifest içerik listesi geçersiz.');
    declared.set(safeZipName(item.path), item);
  }
  let totalBytes = 0;
  for (const record of index.records) if (record.name !== 'manifest.json') {
    const item = declared.get(record.name);
    if (!item || Number(item.size) !== Number(record.size)) throw archiveError('RESTORE_MANIFEST_INVALID', `Backup manifest kaydı eksik veya boyutu uyuşmuyor: ${record.name}`);
    if (validateData) {
      const digest = await streamDigest(file, record, { onProgress });
      if (item.sha256 !== digest.sha256) throw archiveError('RESTORE_CHECKSUM_FAILED', `Backup manifest checksum doğrulaması başarısız: ${record.name}`);
    }
    totalBytes += Number(record.size);
  }
  if (declared.size !== index.records.length - 1) throw archiveError('RESTORE_MANIFEST_INVALID', 'Backup manifest içerik listesi doğrulanamadı.');
  const stat = await fsp.stat(file);
  return { manifest, records: index.records, fileCount: index.records.length - 1, totalBytes, archiveBytes: Number(stat.size), archiveSha256: await fileSha256(file), wrapperPrefix: index.wrapperPrefix };
}
async function extractBackupArchive(file, targetRoot, options = {}) {
  // The HTTP flow already performed a complete preflight. Reuse that indexed
  // result and avoid a second full archive checksum pass before extraction.
  const info = options.preflight || await inspectBackupArchive(file, { requireType: options.requireType || null, validateData: true, onProgress: options.onProgress });
  const manifestByPath = new Map((info.manifest && info.manifest.contents || []).map(item => [item.path, item]));
  await fsp.mkdir(targetRoot, { recursive: true });
  let current = 0, bytesDone = 0;
  for (const record of info.records) {
    if (record.name === 'manifest.json') continue;
    if (typeof options.shouldCancel === 'function' && options.shouldCancel()) throw archiveError('RESTORE_CANCELLED', 'Restore kullanıcı tarafından iptal edildi.', 409);
    const target = path.resolve(targetRoot, ...record.name.split('/'));
    if (!ensureArchiveInside(targetRoot, target)) throw archiveError('RESTORE_UNSAFE_PATH', `Restore hedefi staging alanı dışına çıkıyor: ${record.name}`);
    await fsp.mkdir(path.dirname(target), { recursive: true });
    const temporary = `${target}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`, output = fs.createWriteStream(temporary, { flags: 'wx' });
    const input = await archiveRecordStream(file, record), hash = crypto.createHash('sha256'); let crc = 0xffffffff, size = 0;
    try {
      for await (const chunk of input) {
        if (typeof options.shouldCancel === 'function' && options.shouldCancel()) throw archiveError('RESTORE_CANCELLED', 'Restore kullanıcı tarafından iptal edildi.', 409);
        size += chunk.length; bytesDone += chunk.length; hash.update(chunk); crc = crcUpdate(crc, chunk); if (!output.write(chunk)) await once(output, 'drain');
        if (typeof options.onProgress === 'function') options.onProgress({ phase: 'Açılıyor', current, total: info.fileCount, bytesDone, bytesTotal: info.totalBytes, item: record.name });
      }
      output.end(); await once(output, 'finish');
      const item = manifestByPath.get(record.name), actual = hash.digest('hex');
      if (size !== Number(record.size) || actual !== item.sha256 || ((crc ^ 0xffffffff) >>> 0) !== Number(record.crc32)) throw archiveError('RESTORE_CHECKSUM_FAILED', `Restore staging checksum doğrulaması başarısız: ${record.name}`);
      await fsp.rename(temporary, target); current += 1;
      if (typeof options.onProgress === 'function') options.onProgress({ phase: 'Açılıyor', current, total: info.fileCount, bytesDone, bytesTotal: info.totalBytes, item: record.name });
    } catch (error) { output.destroy(); await fsp.rm(temporary, { force: true }).catch(() => {}); throw error; }
  }
  return info;
}
function ensureArchiveInside(root, target) {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}
async function createBackupArchive({ entries, manifest, filename, onProgress }) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'buyerlog-backup-'));
  const snapshotRoot = path.join(root, 'snapshot'); await fsp.mkdir(snapshotRoot);
  const orderedEntries = [...entries.filter(entry => entry.stage !== 'settings'), ...entries.filter(entry => entry.stage === 'settings')];
  const total = orderedEntries.length + 1, snapped = [];
  const report = value => { if (typeof onProgress === 'function') onProgress(value); };
  try {
    report({ phase: 'Hazırlanıyor', current: 0, total });
    for (let index = 0; index < orderedEntries.length; index++) {
      const entry = orderedEntries[index];
      report({ phase: entry.stage === 'settings' ? 'Ayarlar' : 'Veriler', current: index + 1, total, item: entry.name });
      snapped.push(await snapshotEntry(entry, snapshotRoot));
    }
    for (const item of snapped) if (item.sourcePath) {
      const current = await fsp.stat(item.sourcePath);
      if (current.size !== item.sourceSize || current.mtimeMs !== item.sourceMtimeMs) throw new Error(`Backup snapshot tamamlanmadan kaynak değişti: ${item.name}`);
    }
    const contents = snapped.map(item => ({ path: item.name, size: item.size, sha256: item.sha256, stage: item.stage }));
    const manifestEntry = await snapshotEntry({ name: 'manifest.json', stage: 'settings', buffer: Buffer.from(JSON.stringify({
      backup_version: BACKUP_VERSION, schema_version: BACKUP_SCHEMA_VERSION, ...manifest, contents,
    }, null, 2), 'utf8') }, snapshotRoot);
    snapped.unshift(manifestEntry);
    report({ phase: 'Doğrulanıyor', current: total, total, item: 'manifest.json' });
    const temporary = path.join(root, `${filename}.tmp`), final = path.join(root, filename);
    await writeZip(temporary, snapped);
    const validated = await validateZip(temporary, snapped.map(item => item.name));
    await fsp.rename(temporary, final);
    report({ phase: 'Tamamlandı', current: total, total });
    return { path: final, filename, size: validated.size, fileCount: snapped.length, cleanup: () => fsp.rm(root, { recursive: true, force: true }) };
  } catch (error) { await fsp.rm(root, { recursive: true, force: true }); throw error; }
}

module.exports = { BACKUP_VERSION, BACKUP_SCHEMA_VERSION, createBackupArchive, validateZip, cleanArchivePath, readZipIndex, manifestLimitForIndex, inspectBackupArchive, readBackupJsonEntry, extractBackupArchive };
