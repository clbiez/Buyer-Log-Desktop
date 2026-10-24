'use strict';

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const { assertHeldFileLeases, assertHeldFileLeasesAsync } = require('./shared-file-transaction');

const VERSION = 1;
const RETRYABLE = new Set(['EPERM', 'EACCES', 'EBUSY']);
const OPTIONAL_SYNC_ERRORS = new Set(['EPERM', 'EINVAL', 'ENOSYS', 'ENOTSUP', 'EOPNOTSUPP']);
const syncWait = new Int32Array(new SharedArrayBuffer(4));

function sha256(buffer) { return crypto.createHash('sha256').update(buffer).digest('hex'); }
function keyFor(target) { return sha256(Buffer.from(path.resolve(target).toLowerCase(), 'utf8')); }
function pause(ms) { Atomics.wait(syncWait, 0, 0, ms); }
function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
function integrityError(message, details = {}) {
  return Object.assign(new Error(message), { code: 'DATA_INTEGRITY_ERROR', statusCode: 503, ...details });
}
function inside(root, target) {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}
function ensureAllowed(target, roots) {
  if (!roots.some(root => inside(root, target))) throw integrityError(`Recovery target is outside allowed data roots: ${target}`);
}
function fsyncFileSync(fd) {
  try { fs.fsyncSync(fd); }
  catch (error) { if (!OPTIONAL_SYNC_ERRORS.has(error && error.code)) throw error; }
}
async function fsyncFile(handle) {
  try { await handle.sync(); }
  catch (error) { if (!OPTIONAL_SYNC_ERRORS.has(error && error.code)) throw error; }
}
function fsyncDirSync(folder) {
  try { const fd = fs.openSync(folder, 'r'); try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); } } catch (_) {}
}
async function fsyncDir(folder) {
  try { const handle = await fsp.open(folder, 'r'); try { await handle.sync(); } finally { await handle.close(); } } catch (_) {}
}
function openNewSync(file, attempts = 8) {
  for (let attempt = 1;; attempt += 1) {
    try { return fs.openSync(file, 'wx'); }
    catch (error) {
      if (!RETRYABLE.has(error && error.code) || attempt >= attempts) throw error;
      pause(Math.min(250, 15 * (2 ** (attempt - 1))));
    }
  }
}
async function openNew(file, attempts = 8) {
  for (let attempt = 1;; attempt += 1) {
    try { return await fsp.open(file, 'wx'); }
    catch (error) {
      if (!RETRYABLE.has(error && error.code) || attempt >= attempts) throw error;
      await sleep(Math.min(250, 15 * (2 ** (attempt - 1))));
    }
  }
}
function writeNewSync(file, buffer) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  let fd;
  try {
    fd = openNewSync(tmp); fs.writeFileSync(fd, buffer); fsyncFileSync(fd); fs.closeSync(fd); fd = null;
    renameWithRetrySync(tmp, file);
    fsyncDirSync(path.dirname(file));
  } finally {
    if (fd != null) try { fs.closeSync(fd); } catch (_) {}
    try { fs.unlinkSync(tmp); } catch (_) {}
  }
}
async function writeNew(file, buffer) {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  let handle;
  try {
    handle = await openNew(tmp); await handle.writeFile(buffer); await fsyncFile(handle); await handle.close(); handle = null;
    await renameWithRetry(tmp, file);
    await fsyncDir(path.dirname(file));
  } finally {
    if (handle) try { await handle.close(); } catch (_) {}
    try { await fsp.unlink(tmp); } catch (_) {}
  }
}
function renameWithRetrySync(source, target, attempts = 8) {
  for (let attempt = 1;; attempt += 1) {
    try { assertHeldFileLeases(); fs.renameSync(source, target); return; }
    catch (error) {
      if (!RETRYABLE.has(error && error.code) || attempt >= attempts) throw error;
      pause(Math.min(250, 15 * (2 ** (attempt - 1))));
    }
  }
}
async function renameWithRetry(source, target, attempts = 8) {
  for (let attempt = 1;; attempt += 1) {
    try { await assertHeldFileLeasesAsync(); await fsp.rename(source, target); return; }
    catch (error) {
      if (!RETRYABLE.has(error && error.code) || attempt >= attempts) throw error;
      await sleep(Math.min(250, 15 * (2 ** (attempt - 1))));
    }
  }
}
function fingerprintSync(file) {
  try { const buffer = fs.readFileSync(file); return { exists: true, size: buffer.length, sha256: sha256(buffer) }; }
  catch (error) { if (error && error.code === 'ENOENT') return { exists: false, size: 0, sha256: null }; throw error; }
}
async function fingerprint(file) {
  try { const buffer = await fsp.readFile(file); return { exists: true, size: buffer.length, sha256: sha256(buffer) }; }
  catch (error) { if (error && error.code === 'ENOENT') return { exists: false, size: 0, sha256: null }; throw error; }
}
function sameFingerprint(left, right) {
  return Boolean(left && right) && Boolean(left.exists) === Boolean(right.exists)
    && Number(left.size || 0) === Number(right.size || 0)
    && String(left.sha256 || '') === String(right.sha256 || '');
}
function intentPaths(recoveryRoot, target) {
  const key = keyFor(target);
  return { key, meta: path.join(recoveryRoot, `${key}.intent.json`), payload: path.join(recoveryRoot, `${key}.payload`) };
}
function readIntentSync(metaFile) {
  let value;
  try { value = JSON.parse(fs.readFileSync(metaFile, 'utf8')); }
  catch (error) { throw integrityError(`Recovery intent cannot be read: ${metaFile}`, { cause: error }); }
  if (!value || value.version !== VERSION || !value.target || !value.payload || !value.after || !value.mutationId) {
    throw integrityError(`Recovery intent is invalid: ${metaFile}`);
  }
  return value;
}
function verifyPayloadSync(intent, recoveryRoot) {
  const payloadFile = path.join(recoveryRoot, path.basename(intent.payload));
  const buffer = fs.readFileSync(payloadFile);
  if (buffer.length !== Number(intent.after.size) || sha256(buffer) !== intent.after.sha256) {
    throw integrityError(`Recovery payload checksum failed: ${payloadFile}`);
  }
  return { payloadFile, buffer };
}
function replaceTargetSync(target, buffer, expectedHash) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const tmp = `${target}.${process.pid}.${Date.now()}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  const rollback = `${target}.${process.pid}.${Date.now()}.rollback`;
  let fd;
  try {
    fd = openNewSync(tmp); fs.writeFileSync(fd, buffer); fsyncFileSync(fd); fs.closeSync(fd); fd = null;
    if (fs.existsSync(target)) {
      const backupTmp = `${target}.bak.${process.pid}.${Date.now()}.tmp`;
      try { fs.copyFileSync(target, backupTmp); renameWithRetrySync(backupTmp, `${target}.bak`); }
      finally { try { fs.unlinkSync(backupTmp); } catch (_) {} }
    }
    try { renameWithRetrySync(tmp, target); }
    catch (firstError) {
      if (!fs.existsSync(target)) throw firstError;
      renameWithRetrySync(target, rollback);
      try { renameWithRetrySync(tmp, target); }
      catch (error) { try { if (!fs.existsSync(target)) renameWithRetrySync(rollback, target); } catch (_) {} throw error; }
      try { fs.unlinkSync(rollback); } catch (_) {}
    }
    fsyncDirSync(path.dirname(target));
    const actual = fingerprintSync(target);
    if (!actual.exists || actual.sha256 !== expectedHash) throw integrityError(`Durable target verification failed: ${target}`);
  } finally {
    if (fd != null) try { fs.closeSync(fd); } catch (_) {}
    try { fs.unlinkSync(tmp); } catch (_) {}
  }
}
async function replaceTarget(target, buffer, expectedHash) {
  await fsp.mkdir(path.dirname(target), { recursive: true });
  const tmp = `${target}.${process.pid}.${Date.now()}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  const rollback = `${target}.${process.pid}.${Date.now()}.rollback`;
  let handle;
  try {
    handle = await openNew(tmp); await handle.writeFile(buffer); await fsyncFile(handle); await handle.close(); handle = null;
    try {
      const backupTmp = `${target}.bak.${process.pid}.${Date.now()}.tmp`;
      await fsp.copyFile(target, backupTmp); await renameWithRetry(backupTmp, `${target}.bak`);
    } catch (error) { if (error && error.code !== 'ENOENT') throw error; }
    try { await renameWithRetry(tmp, target); }
    catch (firstError) {
      try { await fsp.access(target); } catch (_) { throw firstError; }
      await renameWithRetry(target, rollback);
      try { await renameWithRetry(tmp, target); }
      catch (error) { try { await renameWithRetry(rollback, target); } catch (_) {} throw error; }
      try { await fsp.unlink(rollback); } catch (_) {}
    }
    await fsyncDir(path.dirname(target));
    const actual = await fingerprint(target);
    if (!actual.exists || actual.sha256 !== expectedHash) throw integrityError(`Durable target verification failed: ${target}`);
  } finally {
    if (handle) try { await handle.close(); } catch (_) {}
    try { await fsp.unlink(tmp); } catch (_) {}
  }
}

function createDurableFileRecovery({ recoveryRoot, allowedRoots = [] } = {}) {
  const root = path.resolve(recoveryRoot || path.join(process.cwd(), '.write-recovery'));
  const roots = (allowedRoots.length ? allowedRoots : [process.cwd()]).map(item => path.resolve(item));
  function clearSync(intent) {
    const files = intentPaths(root, intent.target);
    try { fs.unlinkSync(files.meta); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    try { fs.unlinkSync(files.payload); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  async function clear(intent) {
    const files = intentPaths(root, intent.target);
    try { await fsp.unlink(files.meta); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    try { await fsp.unlink(files.payload); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  function quarantineSync(intent, reason) {
    const files = intentPaths(root, intent.target), folder = path.join(root, 'quarantine');
    fs.mkdirSync(folder, { recursive: true });
    const suffix = `${Date.now()}-${files.key}`;
    for (const [source, extension] of [[files.meta, 'intent.json'], [files.payload, 'payload']]) {
      if (fs.existsSync(source)) renameWithRetrySync(source, path.join(folder, `${suffix}.${extension}`));
    }
    fs.appendFileSync(path.join(folder, 'conflicts.jsonl'), `${JSON.stringify({ at: new Date().toISOString(), mutationId: intent.mutationId, target: intent.target, reason })}\n`);
  }
  function quarantineUnknownSync(metaFile, error) {
    const folder = path.join(root, 'quarantine'); fs.mkdirSync(folder, { recursive: true });
    const key = path.basename(metaFile).replace(/\.intent\.json$/, ''), suffix = `${Date.now()}-${key}`;
    for (const [source, extension] of [[metaFile, 'intent.json'], [path.join(root, `${key}.payload`), 'payload']]) {
      if (fs.existsSync(source)) renameWithRetrySync(source, path.join(folder, `${suffix}.${extension}`));
    }
    fs.appendFileSync(path.join(folder, 'conflicts.jsonl'), `${JSON.stringify({ at: new Date().toISOString(), mutationId: null, target: null, reason: 'invalid-intent', error: error && error.message || String(error) })}\n`);
  }
  function prepareSync(target, buffer, options = {}) {
    assertHeldFileLeases();
    const resolved = path.resolve(target); ensureAllowed(resolved, roots);
    const data = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
    fs.mkdirSync(root, { recursive: true });
    const files = intentPaths(root, resolved);
    if (fs.existsSync(files.meta)) {
      const prior = recoverOneSync(files.meta);
      if (prior.conflict) throw integrityError(`Unresolved recovery conflict blocks write: ${resolved}`);
    }
    const intent = {
      version: VERSION,
      mutationId: String(options.mutationId || crypto.randomUUID()),
      target: resolved,
      payload: path.basename(files.payload),
      before: fingerprintSync(resolved),
      after: { exists: true, size: data.length, sha256: sha256(data) },
      createdAt: new Date().toISOString(),
    };
    writeNewSync(files.payload, data);
    writeNewSync(files.meta, Buffer.from(JSON.stringify(intent, null, 2), 'utf8'));
    return intent;
  }
  async function prepare(target, buffer, options = {}) {
    await assertHeldFileLeasesAsync();
    const resolved = path.resolve(target); ensureAllowed(resolved, roots);
    const data = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
    await fsp.mkdir(root, { recursive: true });
    const files = intentPaths(root, resolved);
    try { await fsp.access(files.meta); const result = recoverOneSync(files.meta); if (result.conflict) throw integrityError(`Unresolved recovery conflict blocks write: ${resolved}`); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    const intent = {
      version: VERSION,
      mutationId: String(options.mutationId || crypto.randomUUID()),
      target: resolved,
      payload: path.basename(files.payload),
      before: await fingerprint(resolved),
      after: { exists: true, size: data.length, sha256: sha256(data) },
      createdAt: new Date().toISOString(),
    };
    await writeNew(files.payload, data);
    await writeNew(files.meta, Buffer.from(JSON.stringify(intent, null, 2), 'utf8'));
    return intent;
  }
  function commitPreparedSync(intent) {
    ensureAllowed(intent.target, roots);
    const { buffer } = verifyPayloadSync(intent, root);
    replaceTargetSync(intent.target, buffer, intent.after.sha256);
    clearSync(intent);
    return { mutationId: intent.mutationId, target: intent.target, sha256: intent.after.sha256 };
  }
  async function commitPrepared(intent) {
    ensureAllowed(intent.target, roots);
    const payloadFile = path.join(root, path.basename(intent.payload));
    const buffer = await fsp.readFile(payloadFile);
    if (buffer.length !== Number(intent.after.size) || sha256(buffer) !== intent.after.sha256) throw integrityError(`Recovery payload checksum failed: ${payloadFile}`);
    await replaceTarget(intent.target, buffer, intent.after.sha256);
    await clear(intent);
    return { mutationId: intent.mutationId, target: intent.target, sha256: intent.after.sha256 };
  }
  function recoverOneSync(metaFile) {
    const intent = readIntentSync(metaFile); ensureAllowed(intent.target, roots);
    verifyPayloadSync(intent, root);
    const current = fingerprintSync(intent.target);
    if (sameFingerprint(current, intent.after)) { clearSync(intent); return { committed: true, recovered: false, conflict: false }; }
    if (sameFingerprint(current, intent.before)) { commitPreparedSync(intent); return { committed: true, recovered: true, conflict: false }; }
    quarantineSync(intent, 'target-diverged');
    return { committed: false, recovered: false, conflict: true };
  }
  function recoverSync() {
    fs.mkdirSync(root, { recursive: true });
    const result = { recovered: 0, committed: 0, conflicts: 0, errors: [] };
    for (const name of fs.readdirSync(root).filter(item => item.endsWith('.intent.json')).sort()) {
      try {
        const item = recoverOneSync(path.join(root, name));
        if (item.recovered) result.recovered += 1;
        if (item.committed) result.committed += 1;
        if (item.conflict) result.conflicts += 1;
      } catch (error) {
        result.errors.push({ file: name, error: error.message });
        try { quarantineUnknownSync(path.join(root, name), error); result.conflicts += 1; }
        catch (quarantineError) { result.errors.push({ file: name, error: `quarantine failed: ${quarantineError.message}` }); }
      }
    }
    return result;
  }
  function replaceSync(target, buffer, options) { return commitPreparedSync(prepareSync(target, buffer, options)); }
  async function replace(target, buffer, options) { return commitPrepared(await prepare(target, buffer, options)); }
  return { root, prepareSync, prepare, commitPreparedSync, commitPrepared, replaceSync, replace, recoverSync };
}

module.exports = { VERSION, createDurableFileRecovery, integrityError };
