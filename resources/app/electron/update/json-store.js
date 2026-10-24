'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const wait = new Int32Array(new SharedArrayBuffer(4));
const TRANSIENT = new Set(['EPERM', 'EACCES', 'EBUSY']);
const OPTIONAL_DIRECTORY_SYNC = new Set(['EPERM', 'EACCES', 'EINVAL', 'ENOSYS', 'ENOTSUP', 'EOPNOTSUPP', 'EISDIR']);
function readJson(file, fallback = null) {
  try { let text = fs.readFileSync(file, 'utf8'); if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1); return JSON.parse(text); }
  catch (_) { return fallback; }
}
function ensureDir(dir) { fs.mkdirSync(dir, { recursive: true }); }
function syncDirectory(dir) {
  let fd;
  try { fd = fs.openSync(dir, 'r'); fs.fsyncSync(fd); }
  catch (error) { if (!OPTIONAL_DIRECTORY_SYNC.has(error.code)) throw error; }
  finally { if (fd != null) fs.closeSync(fd); }
}
function atomicWriteBuffer(file, buffer) {
  ensureDir(path.dirname(file));
  const tmp = file + '.tmp-' + process.pid + '-' + crypto.randomBytes(8).toString('hex');
  let fd;
  try {
    fd = fs.openSync(tmp, 'wx'); fs.writeFileSync(fd, buffer); fs.fsyncSync(fd); fs.closeSync(fd); fd = null;
    for (let attempt = 0;; attempt++) {
      try { fs.renameSync(tmp, file); break; }
      catch (error) {
        // Never unlink a valid state/pointer to bypass a transient Windows lock.
        if (!TRANSIENT.has(error.code) || attempt >= 5) throw error;
        Atomics.wait(wait, 0, 0, Math.min(240, 15 * 2 ** attempt));
      }
    }
    syncDirectory(path.dirname(file));
  } finally {
    if (fd != null) fs.closeSync(fd);
    try { fs.unlinkSync(tmp); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
}
function atomicWriteJson(file, value) { atomicWriteBuffer(file, Buffer.from(JSON.stringify(value, null, 2) + '\n', 'utf8')); }
module.exports = { readJson, atomicWriteJson, atomicWriteBuffer, ensureDir, syncDirectory };
