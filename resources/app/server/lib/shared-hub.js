'use strict';

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');
const { promisify } = require('util');
const { replaceFileWithRetry, withFileLeaseAsync } = require('./shared-file-transaction');
const masterReleases = require('./master-releases');
const { stableSha256 } = require('./stable-digest');

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
// Content digests use the shared stableJson convention (server/lib/stable-digest.js),
// streamed and cooperatively yielding: identical hex to sha256(stableJson(value)).
async function fileSignature(file) {
  try { const stat = await fsp.stat(file); return stat.isFile() ? `${stat.size}:${stat.mtimeMs}:${stat.ino}:${stat.ctimeMs}` : null; }
  catch (err) { if (err && err.code === 'ENOENT') return null; throw err; }
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
      personalBackups: 'personal-backups',
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
  /* Eski sürümlerin zaman aşımında bıraktığı yazma testi dosyaları. Yalnız
     kendi adlandırma desenimiz ve 24 saatten eski olanlar silinir; saatte en
     fazla bir tarama, hata sessizce yok sayılır (yalnız temizlik). */
  const PROBE_NAME = /^\.buyerlog-hub-probe-\d+-[0-9a-f-]{36}(\.ready)?$/i;
  let lastProbeSweepAt = 0;
  async function removeStaleProbes(selected) {
    const started = Date.now();
    if (started - lastProbeSweepAt < 60 * 60 * 1000) return 0;
    lastProbeSweepAt = started;
    let removed = 0;
    try {
      const names = await timeout(() => fsp.readdir(selected), 'Shared Hub probe temizliği');
      for (const name of names.filter(item => PROBE_NAME.test(item)).slice(0, 200)) {
        try {
          const file = safePath(selected, name), stat = await timeout(() => fsp.stat(file), 'Shared Hub probe yaşı');
          if (stat.isFile() && started - stat.mtimeMs > 24 * 60 * 60 * 1000) { await timeout(() => fsp.unlink(file), 'Shared Hub probe silme'); removed++; }
        } catch (_) {}
      }
    } catch (_) {}
    return removed;
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
      /* Zaman aşımı alttaki dosya işlemini iptal etmez: OneDrive yavaşken yazma
         temizlikten SONRA bitip probe dosyasını ortak klasörde bırakıyordu.
         Temizlik, başlatılan her işlem sonuçlandıktan sonra yapılır. */
      const started = [];
      const tracked = factory => () => { const operation = Promise.resolve().then(factory); started.push(operation); return operation; };
      try {
        await timeout(tracked(() => fsp.writeFile(probe, 'ok', { encoding: 'utf8', flag: 'wx' })), 'Shared Hub yazma testi');
        await timeout(tracked(() => fsp.rename(probe, renamed)), 'Shared Hub atomic publish testi');
        await timeout(tracked(() => fsp.unlink(renamed)), 'Shared Hub temizlik testi');
      } finally {
        void Promise.allSettled(started).then(() => Promise.allSettled([fsp.unlink(probe), fsp.unlink(renamed)]));
      }
      void removeStaleProbes(selected);
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
    for (const rel of [manifest.layout.sync, manifest.layout.iam, manifest.layout.master, manifest.layout.business || 'business', manifest.layout.images, manifest.layout.personalBackups || 'personal-backups']) await fsp.mkdir(safePath(selected, rel), { recursive: true });
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
  /* Doğrulanmış Master head belleği (kök başına). Eskiden HER yayım — içerik
     değişmemiş olsa bile — mevcut checkpoint'i okuyup açıyor, arşivi yeniden
     okuyup tüm payload'ı defalarca kanonik JSON'a çevirerek doğruluyordu
     (saha: dakikada bir saniyeler süren ana iş parçacığı donması). Aynı head
     (revision + sha256 + dosya) ve diskteki checkpoint/arşiv dosyalarının stat
     imzası değişmediyse doğrulama sonucu yeniden kullanılır. Başka cihazın
     yayımı current.json'u değiştirir (her yayımda yeniden okunur) → bellek
     eşleşmez; arşivin silinmesi/değişmesi imzayı değiştirir → yeniden onarım.
     Bellek yalnız başarılı doğrulamadan sonra yazılır. */
  const verifiedMasterHeads = new Map();
  const ruleContent = value => { const copy = { ...value }; delete copy.release; return copy; };
  const sameHead = (memo, head) => Boolean(memo && head && memo.revision === head.revision && memo.sha256 === head.sha256 && memo.file === head.file
    && memo.payloadSha256 === (head.payloadSha256 || null) && memo.headRulesSha256 === (head.rulesSha256 || null));
  async function verifiedMasterHead(root, head, schemaVersion) {
    const memo = verifiedMasterHeads.get(root);
    if (sameHead(memo, head)
      && await fileSignature(safePath(root, 'master', head.file)) === memo.checkpointSignature
      && (!memo.authority || await masterReleases.archiveSignature(root, head.revision) === memo.archiveSignature)) return memo;
    verifiedMasterHeads.delete(root);
    // A head may have committed before its archive failed. Repair that exact
    // revision before equality checks or advancing; never lose rule history.
    // Fingerprint before AND after the verified read: a file replaced in between is not remembered.
    const signatureBefore = await fileSignature(safePath(root, 'master', head.file));
    const envelope = (await readCheckpointFile(root, head, schemaVersion, 'master')).envelope;
    const signatureAfter = await fileSignature(safePath(root, 'master', head.file));
    const checkpointSignature = signatureBefore && signatureBefore === signatureAfter ? signatureAfter : null;
    const authority = Boolean(envelope.payload && envelope.payload.authority === 'moderator');
    const archived = authority ? await masterReleases.archiveRelease(root, { head, envelope }) : null;
    const next = { revision:head.revision, sha256:head.sha256, file:head.file, payloadSha256:head.payloadSha256 || null, headRulesSha256:head.rulesSha256 || null, checkpointSignature, authority,
      archiveSignature:archived ? archived.signature : null,
      release:envelope.payload ? envelope.payload.release : undefined,
      rulesSha256:head.rulesSha256 || (authority ? await stableSha256(ruleContent(envelope.payload)) : null) };
    // Never remember a state whose files could not be fingerprinted: a null
    // signature would later match a deleted file.
    if (next.checkpointSignature && (!authority || next.archiveSignature)) verifiedMasterHeads.set(root, next);
    return next;
  }
  async function publishCheckpoint(root, area, schemaVersion, payload, { actorId = '', previousRevision = null, note = '', forceRevision = false, changedEntities = [] } = {}) {
    const checked = await validate(root, { requireWrite: true });
    const currentFile = safePath(checked.root, area, 'current.json');
    await fsp.mkdir(path.dirname(currentFile), { recursive:true });
    return withFileLeaseAsync(currentFile, async () => {
      const current = await readCheckpointHead(checked.root, area, schemaVersion);
      const actualRevision = current ? current.revision : 0;
      const verifiedCurrent = area === 'master' && current ? await verifiedMasterHead(checked.root, current, schemaVersion) : null;
      if (previousRevision != null && Number(previousRevision) !== actualRevision) throw error('Checkpoint başka bir istemci tarafından güncellendi.', 'CHECKPOINT_REVISION_CONFLICT', 409, { currentRevision: actualRevision, area });
      const sourcePayload = payload && typeof payload === 'object' ? payload : {};
      const versionedRules = area === 'master' && sourcePayload.authority === 'moderator';
      const rulesSha256 = versionedRules ? await stableSha256(ruleContent(sourcePayload)) : null;
      const currentRulesSha256 = current && (current.rulesSha256 || (verifiedCurrent ? verifiedCurrent.rulesSha256 : null));
      const releaseNote = clean(note, 2000);
      const explicitRevision = versionedRules && (forceRevision === true || Boolean(releaseNote));
      // Versioned rules compare release-free rule content only; the full payload digest
      // is needed solely for unversioned areas (and is then the stored payload digest).
      const originalPayloadSha256 = versionedRules ? null : await stableSha256(sourcePayload);
      if (current && !explicitRevision && (versionedRules ? currentRulesSha256 === rulesSha256 : current.payloadSha256 === originalPayloadSha256)) {
        const release = verifiedCurrent && verifiedCurrent.release;
        return { ...current, ...(release ? { release:structuredClone(release) } : {}), unchanged:true };
      }
      const revision = actualRevision + 1, at = new Date().toISOString();
      // Release metadata only: computed lazily so an unchanged publish never diffs every entity.
      const changedList = versionedRules ? (typeof changedEntities === 'function' ? await changedEntities() : changedEntities) : [];
      const release = versionedRules ? { version:revision, note:releaseNote, publishedBy:clean(actorId,160), publishedAt:at,
        changedEntities:[...new Set((Array.isArray(changedList) ? changedList : []).filter(item => typeof item === 'string').map(item => clean(item,100)).filter(Boolean))].slice(0,100) } : null;
      const normalizedPayload = versionedRules ? { ...ruleContent(sourcePayload), release } : sourcePayload;
      const payloadSha256 = versionedRules ? await stableSha256(normalizedPayload) : originalPayloadSha256;
      const envelope = { schemaVersion, revision, parentRevision: actualRevision, createdAt: at, actorId: clean(actorId, 160), payload: normalizedPayload };
      const raw = Buffer.from(JSON.stringify(envelope), 'utf8'), compressed = await gzipAsync(raw, { level: zlib.constants.Z_BEST_SPEED }), digest = sha256(compressed);
      const fileName = `${String(revision).padStart(16, '0')}-${digest.slice(0, 16)}.json.gz`;
      const checkpointFile = safePath(checked.root, area, 'checkpoints', fileName);
      await atomicWrite(checkpointFile, compressed);
      const verify = await fsp.readFile(checkpointFile);
      if (sha256(verify) !== digest) throw error('Checkpoint doğrulanamadı.', 'CHECKPOINT_INVALID', 503, { area });
      const previous = current ? { revision: current.revision, file: current.file, sha256: current.sha256, updatedAt: current.updatedAt || null } : null;
      const head = { schemaVersion, revision, file: path.posix.join('checkpoints', fileName), sha256: digest, payloadSha256, updatedAt: at,
        ...(versionedRules ? { rulesSha256, release } : {}), ...(previous ? { previous } : {}) };
      await atomicWriteJson(currentFile, head);
      verifiedMasterHeads.delete(checked.root);
      if (area === 'master') {
        const archived = versionedRules ? await masterReleases.archiveRelease(checked.root, { head, envelope }) : null;
        const checkpointSignature = await fileSignature(checkpointFile);
        // The bytes were verified against `digest` above; the archive was verified by archiveRelease.
        if (checkpointSignature && (!versionedRules || (archived && archived.signature))) verifiedMasterHeads.set(checked.root, { revision, sha256:digest, file:head.file, payloadSha256, headRulesSha256:head.rulesSha256 || null, checkpointSignature, authority:versionedRules,
          archiveSignature:archived ? archived.signature : null, release:normalizedPayload.release, rulesSha256:rulesSha256 || null });
      }
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
  return { HUB_FORMAT, HUB_SCHEMA_VERSION, localStateFile, readLocalState, markBootstrap, clearBootstrap, validate, removeStaleProbes, initialize, publishMaster, readMaster, readMasterHead, publishBusiness, readBusiness, readBusinessHead };
}

module.exports = { HUB_FORMAT, HUB_SCHEMA_VERSION, HUB_MANIFEST, MASTER_SCHEMA_VERSION, BUSINESS_SCHEMA_VERSION, createSharedHub, validateManifest };
