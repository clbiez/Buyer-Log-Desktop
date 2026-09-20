'use strict';

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');
const { promisify } = require('util');
const { replaceFileWithRetry, withFileLeaseAsync } = require('./shared-file-transaction');

const gzipAsync = promisify(zlib.gzip);
const gunzipAsync = promisify(zlib.gunzip);
const HUB_FORMAT = 'buyer-log-shared-hub';
const HUB_SCHEMA_VERSION = 1;
const MASTER_SCHEMA_VERSION = 1;
const BUSINESS_SCHEMA_VERSION = 1;
const HUB_MANIFEST = 'buyerlog-hub.json';
const MASTER_DIR = path.join('master', 'checkpoints');
const MASTER_CURRENT = 'current.json';
const BUSINESS_DIR = path.join('business', 'checkpoints');
const BUSINESS_CURRENT = 'current.json';
const BOOTSTRAP_STATE_VERSION = 1;

function clean(value, max = 1000) { return String(value == null ? '' : value).trim().slice(0, max); }
function error(message, code, statusCode = 400, extra = {}) { return Object.assign(new Error(message), { code, statusCode, ...extra }); }
function sha256(buffer) { return crypto.createHash('sha256').update(buffer).digest('hex'); }
function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
function safePath(root, ...parts) {
  const base = path.resolve(root), target = path.resolve(base, ...parts);
  const relative = path.relative(base, target);
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw error('Shared Hub yolu geçersiz.', 'SHARED_HUB_PATH_INVALID');
  return target;
}
async function statDir(root) {
  try { const stat = await fsp.stat(root); if (!stat.isDirectory()) throw error('Shared Hub bir klasör olmalıdır.', 'SHARED_HUB_NOT_DIRECTORY'); return stat; }
  catch (err) { if (err && err.code && String(err.code).startsWith('SHARED_HUB_')) throw err; throw error('Shared Hub bulunamadı veya erişilemiyor.', 'SHARED_HUB_UNAVAILABLE', 503); }
}
async function readJson(file) { return JSON.parse(await fsp.readFile(file, 'utf8')); }
async function atomicWrite(file, data) {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  try {
    const handle = await fsp.open(tmp, 'wx', 0o600);
    try { await handle.writeFile(data); try { await handle.sync(); } catch (_) {} } finally { await handle.close(); }
    await replaceFileWithRetry(tmp, file);
  } finally { try { await fsp.unlink(tmp); } catch (_) {} }
}
async function atomicWriteJson(file, value) { return atomicWrite(file, Buffer.from(JSON.stringify(value, null, 2), 'utf8')); }

function validateManifest(raw) {
  const manifest = raw && typeof raw === 'object' ? raw : {};
  if (manifest.format !== HUB_FORMAT) throw error('Seçilen klasör Buyer Log Shared Hub değil.', 'SHARED_HUB_IDENTITY_INVALID', 409);
  if (Number(manifest.schemaVersion) !== HUB_SCHEMA_VERSION) throw error('Shared Hub sürümü bu Buyer Log sürümüyle uyumlu değil.', 'SHARED_HUB_SCHEMA_INCOMPATIBLE', 409, { schemaVersion: manifest.schemaVersion });
  if (!/^[0-9a-f-]{36}$/i.test(clean(manifest.hubId, 80))) throw error('Shared Hub kimliği geçersiz.', 'SHARED_HUB_IDENTITY_INVALID', 409);
  return {
    format: HUB_FORMAT,
    schemaVersion: HUB_SCHEMA_VERSION,
    hubId: manifest.hubId,
    createdAt: clean(manifest.createdAt, 80),
    createdBy: clean(manifest.createdBy, 160),
    createdVersion: clean(manifest.createdVersion, 80),
    dataFormatVersion: Math.max(1, Number(manifest.dataFormatVersion) || 1),
    layout: manifest.layout && typeof manifest.layout === 'object' ? manifest.layout : {},
  };
}

function defaultManifest({ appVersion = '', createdBy = '' } = {}) {
  return {
    format: HUB_FORMAT,
    schemaVersion: HUB_SCHEMA_VERSION,
    hubId: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    createdBy: clean(createdBy, 160),
    createdVersion: clean(appVersion, 80),
    dataFormatVersion: 1,
    layout: {
      iam: 'iam',
      sync: 'BUYER_LOG_SYNC',
      master: 'master',
      business: 'business',
      images: 'model-images',
    },
  };
}

function createSharedHub({ localDataRoot, appVersion = '', networkTimeoutMs = 15000 } = {}) {
  if (!localDataRoot) throw new Error('localDataRoot zorunludur.');
  const localStateFile = path.join(localDataRoot, 'shared-hub-bootstrap.json');
  const timeout = async (promiseFactory, label) => {
    let timer;
    try {
      return await Promise.race([
        Promise.resolve().then(promiseFactory),
        new Promise((_, reject) => { timer = setTimeout(() => reject(error(`${label}: ağ zaman aşımı.`, 'SHARED_HUB_TIMEOUT', 503)), Math.max(1000, Number(networkTimeoutMs) || 15000)); timer.unref?.(); }),
      ]);
    } finally { clearTimeout(timer); }
  };
  function readLocalState() {
    try {
      const raw = JSON.parse(fs.readFileSync(localStateFile, 'utf8'));
      return raw && raw.version === BOOTSTRAP_STATE_VERSION ? raw : null;
    } catch (_) { return null; }
  }
  async function writeLocalState(next) {
    await fsp.mkdir(path.dirname(localStateFile), { recursive: true });
    await atomicWriteJson(localStateFile, { version: BOOTSTRAP_STATE_VERSION, ...next });
    return readLocalState();
  }
  async function validate(root, { requireWrite = false } = {}) {
    const selected = path.resolve(clean(root));
    if (!selected) throw error('Shared Hub klasörü seçilmedi.', 'SHARED_HUB_REQUIRED');
    await timeout(() => statDir(selected), 'Shared Hub kontrolü');
    let manifest;
    try { manifest = validateManifest(await timeout(() => readJson(safePath(selected, HUB_MANIFEST)), 'Shared Hub kimlik kontrolü')); }
    catch (err) { if (err && err.code === 'ENOENT') throw error('Seçilen klasörde Buyer Log Shared Hub kimliği bulunamadı.', 'SHARED_HUB_NOT_INITIALIZED', 409); throw err; }
    await timeout(() => fsp.access(selected, fs.constants.R_OK), 'Shared Hub okuma kontrolü');
    if (requireWrite) {
      await timeout(() => fsp.access(selected, fs.constants.W_OK), 'Shared Hub yazma kontrolü');
      const probe = safePath(selected, `.buyerlog-hub-probe-${process.pid}-${crypto.randomUUID()}`);
      const renamed = `${probe}.ready`;
      try {
        await timeout(() => fsp.writeFile(probe, 'ok', { encoding: 'utf8', flag: 'wx' }), 'Shared Hub yazma testi');
        await timeout(() => fsp.rename(probe, renamed), 'Shared Hub atomic publish testi');
        await timeout(() => fsp.unlink(renamed), 'Shared Hub temizlik testi');
      } finally { void fsp.unlink(probe).catch(() => {}); void fsp.unlink(renamed).catch(() => {}); }
    }
    return { ok: true, root: selected, manifest };
  }
  async function initialize(root, { createdBy = '', allowNonEmpty = false } = {}) {
    const selected = path.resolve(clean(root));
    await statDir(selected);
    await fsp.access(selected, fs.constants.R_OK | fs.constants.W_OK);
    const manifestFile = safePath(selected, HUB_MANIFEST);
    try { return { initialized: false, ...(await validate(selected, { requireWrite: true })) }; }
    catch (err) { if (!err || err.code !== 'SHARED_HUB_NOT_INITIALIZED') throw err; }
    const names = await fsp.readdir(selected);
    const ignored = new Set(['desktop.ini', 'thumbs.db']);
    const meaningful = names.filter(name => !ignored.has(String(name).toLowerCase()) && !String(name).startsWith('.buyerlog-hub-probe-'));
    if (meaningful.length && !allowNonEmpty) throw error('Boş olmayan klasör otomatik Shared Hub olarak başlatılamaz.', 'SHARED_HUB_NONEMPTY', 409);
    const manifest = defaultManifest({ appVersion, createdBy });
    // Create only the handful of bounded top-level namespaces. Per-entity directories are forbidden.
    for (const rel of [manifest.layout.sync, manifest.layout.iam, manifest.layout.master, manifest.layout.business || 'business', manifest.layout.images]) await fsp.mkdir(safePath(selected, rel), { recursive: true });
    await atomicWriteJson(manifestFile, manifest);
    return { initialized: true, ...(await validate(selected, { requireWrite: true })) };
  }
  async function readCheckpointHead(root, area, schemaVersion) {
    const currentFile = safePath(root, area, 'current.json');
    try {
      const head = await readJson(currentFile);
      if (!head || Number(head.schemaVersion) !== Number(schemaVersion) || !Number.isSafeInteger(head.revision) || head.revision < 1 || !/^[a-f0-9]{64}$/.test(String(head.sha256 || ''))) throw error(`${area} checkpoint head geçersiz.`, 'CHECKPOINT_HEAD_INVALID', 503);
      return head;
    } catch (err) { if (err && err.code === 'ENOENT') return null; throw err; }
  }
  async function cleanupCheckpointFiles(root, area, keepFiles = []) {
    const dir = safePath(root, area, 'checkpoints'), keep = new Set(keepFiles.filter(Boolean).map(String));
    let names = [];
    try { names = (await fsp.readdir(dir)).filter(name => name.endsWith('.json.gz')).sort().reverse(); } catch (_) { return; }
    // Two referenced generations plus one emergency generation are enough;
    // checkpoints are recovery seeds, not an audit archive.
    for (const name of names.slice(3)) {
      const rel = path.posix.join('checkpoints', name);
      if (keep.has(rel)) continue;
      try { await fsp.unlink(safePath(root, area, rel)); } catch (_) {}
    }
  }
  async function publishCheckpoint(root, area, schemaVersion, payload, { actorId = '', previousRevision = null } = {}) {
    const checked = await validate(root, { requireWrite: true });
    const currentFile = safePath(checked.root, area, 'current.json');
    await fsp.mkdir(path.dirname(currentFile), { recursive:true });
    return withFileLeaseAsync(currentFile, async () => {
      const current = await readCheckpointHead(checked.root, area, schemaVersion);
      const actualRevision = current ? current.revision : 0;
      if (previousRevision != null && Number(previousRevision) !== actualRevision) throw error('Checkpoint başka bir istemci tarafından güncellendi.', 'CHECKPOINT_REVISION_CONFLICT', 409, { currentRevision: actualRevision, area });
      const normalizedPayload = payload && typeof payload === 'object' ? payload : {};
      const payloadSha256 = sha256(Buffer.from(stableJson(normalizedPayload), 'utf8'));
      if (current && current.payloadSha256 === payloadSha256) return { ...current, unchanged:true };
      const revision = actualRevision + 1, at = new Date().toISOString();
      const envelope = { schemaVersion, revision, parentRevision: actualRevision, createdAt: at, actorId: clean(actorId, 160), payload: normalizedPayload };
      const raw = Buffer.from(JSON.stringify(envelope), 'utf8'), compressed = await gzipAsync(raw, { level: zlib.constants.Z_BEST_SPEED }), digest = sha256(compressed);
      const fileName = `${String(revision).padStart(16, '0')}-${digest.slice(0, 16)}.json.gz`;
      const checkpointFile = safePath(checked.root, area, 'checkpoints', fileName);
      await atomicWrite(checkpointFile, compressed);
      const verify = await fsp.readFile(checkpointFile);
      if (sha256(verify) !== digest) throw error('Checkpoint doğrulanamadı.', 'CHECKPOINT_INVALID', 503, { area });
      const previous = current ? { revision: current.revision, file: current.file, sha256: current.sha256, updatedAt: current.updatedAt || null } : null;
      const head = { schemaVersion, revision, file: path.posix.join('checkpoints', fileName), sha256: digest, payloadSha256, updatedAt: at, ...(previous ? { previous } : {}) };
      await atomicWriteJson(currentFile, head);
      void cleanupCheckpointFiles(checked.root, area, [head.file, previous && previous.file]).catch(()=>{});
      return head;
    }, { timeoutMs:15000, staleMs:120000 });
  }
  async function readCheckpointFile(root, checkpoint, schemaVersion, area = 'master') {
    if (!checkpoint || !Number.isSafeInteger(Number(checkpoint.revision)) || Number(checkpoint.revision) < 1 || !/^[a-f0-9]{64}$/.test(String(checkpoint.sha256 || '')) || !clean(checkpoint.file, 500)) {
      throw error('Checkpoint referansı geçersiz.', 'CHECKPOINT_INVALID', 503);
    }
    const normalized = { revision:Number(checkpoint.revision), file:clean(checkpoint.file,500), sha256:String(checkpoint.sha256), updatedAt:checkpoint.updatedAt || null };
    const file = safePath(root, area, normalized.file);
    const compressed = await fsp.readFile(file);
    if (sha256(compressed) !== normalized.sha256) throw error('Checkpoint bütünlük kontrolü başarısız.', 'CHECKPOINT_INVALID', 503, { area });
    let envelope;
    try { envelope = JSON.parse((await gunzipAsync(compressed)).toString('utf8')); }
    catch (_) { throw error('Checkpoint açılamadı.', 'CHECKPOINT_INVALID', 503, { area }); }
    if (!envelope || Number(envelope.schemaVersion) !== Number(schemaVersion) || Number(envelope.revision) !== normalized.revision) throw error('Checkpoint biçimi geçersiz.', 'CHECKPOINT_INVALID', 503, { area });
    return { head: normalized, envelope };
  }
  async function readCheckpoint(root, area, schemaVersion, expectedRevision = null) {
    const checked = await validate(root, { requireWrite:false });
    const head = await readCheckpointHead(checked.root, area, schemaVersion);
    if (!head) return null;
    if (expectedRevision != null && Number(expectedRevision) === head.revision) return { unchanged:true, head };
    try {
      const current = await readCheckpointFile(checked.root, head, schemaVersion, area);
      return { unchanged:false, head, envelope:current.envelope };
    } catch (err) {
      if (!head.previous) throw err;
      try {
        const recovered = await readCheckpointFile(checked.root, head.previous, schemaVersion, area);
        return { unchanged:false, head:recovered.head, envelope:recovered.envelope, recoveredFrom:{ revision:head.revision, code:err && err.code || 'CHECKPOINT_INVALID' } };
      } catch (_) { throw err; }
    }
  }
  async function readMasterHead(root) { return readCheckpointHead(root, 'master', MASTER_SCHEMA_VERSION); }
  async function publishMaster(root, payload, options = {}) {
    try { return await publishCheckpoint(root, 'master', MASTER_SCHEMA_VERSION, payload, options); }
    catch (err) { if (err && err.code === 'CHECKPOINT_REVISION_CONFLICT') err.code = 'MASTER_REVISION_CONFLICT'; throw err; }
  }
  async function readMaster(root, expectedRevision = null) { return readCheckpoint(root, 'master', MASTER_SCHEMA_VERSION, expectedRevision); }
  async function readBusinessHead(root) { return readCheckpointHead(root, 'business', BUSINESS_SCHEMA_VERSION); }
  async function publishBusiness(root, payload, options = {}) {
    try { return await publishCheckpoint(root, 'business', BUSINESS_SCHEMA_VERSION, payload, options); }
    catch (err) { if (err && err.code === 'CHECKPOINT_REVISION_CONFLICT') err.code = 'BUSINESS_REVISION_CONFLICT'; throw err; }
  }
  async function readBusiness(root, expectedRevision = null) { return readCheckpoint(root, 'business', BUSINESS_SCHEMA_VERSION, expectedRevision); }
  async function markBootstrap({ root, hubId, masterRevision = 0, businessRevision = null, iamRevision = 0, completed = true } = {}) {
    const previous=readLocalState();
    return writeLocalState({ hubId:clean(hubId,80), root:clean(root,1000), masterRevision:Math.max(0,Number(masterRevision)||0), businessRevision:businessRevision==null?Math.max(0,Number(previous&&previous.businessRevision)||0):Math.max(0,Number(businessRevision)||0), iamRevision:Math.max(0,Number(iamRevision)||0), completed:completed===true, completedAt:completed===true?(previous&&previous.completedAt||new Date().toISOString()):null, updatedAt:new Date().toISOString() });
  }
  function clearBootstrap() { try { fs.unlinkSync(localStateFile); } catch (_) {} }
  return { HUB_FORMAT, HUB_SCHEMA_VERSION, localStateFile, readLocalState, markBootstrap, clearBootstrap, validate, initialize, publishMaster, readMaster, readMasterHead, publishBusiness, readBusiness, readBusinessHead };
}

module.exports = { HUB_FORMAT, HUB_SCHEMA_VERSION, HUB_MANIFEST, MASTER_SCHEMA_VERSION, BUSINESS_SCHEMA_VERSION, createSharedHub, validateManifest };
