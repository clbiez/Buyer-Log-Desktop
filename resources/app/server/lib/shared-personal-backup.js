'use strict';

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const { replaceFileWithRetry, withFileLeaseAsync } = require('./shared-file-transaction');
const { inspectBackupArchive } = require('./backup-archive');
const { safeId } = require('./backup-service');

const DEFAULT_RETENTION = 30;
// Ortak kişisel yedekler de en fazla 3 günlük geçmiş tutar; en son sürüm her
// zaman korunur.
const MAX_AGE_MS = 3 * 24 * 60 * 60 * 1000;
const META_SCHEMA_VERSION = 1;

function digest(value) {
  return crypto.createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
}
function stamp(date = new Date()) {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}
function safeBackupName(value) {
  const name = path.basename(String(value || ''));
  if (!name || name !== String(value || '') || !/^[A-Za-z0-9_.-]+\.zip$/i.test(name)) {
    const error = new Error('Ortak kişisel yedek dosya adı geçersiz.');
    error.code = 'SHARED_PERSONAL_BACKUP_INVALID';
    error.statusCode = 503;
    throw error;
  }
  return name;
}
async function readJson(file) {
  try { return JSON.parse(await fsp.readFile(file, 'utf8')); } catch (_) { return null; }
}
async function syncBestEffort(handle) {
  try { await handle.sync(); } catch (_) {}
}
async function atomicCopy(source, target) {
  await fsp.mkdir(path.dirname(target), { recursive: true });
  const tmp = `${target}.${process.pid}.${Date.now()}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  try {
    const input = fs.createReadStream(source), output = fs.createWriteStream(tmp, { flags: 'wx' });
    await new Promise((resolve, reject) => {
      input.on('error', reject); output.on('error', reject); output.on('finish', resolve); input.pipe(output);
    });
    const handle = await fsp.open(tmp, 'r+');
    try { await syncBestEffort(handle); } finally { await handle.close(); }
    await replaceFileWithRetry(tmp, target);
  } finally { await fsp.rm(tmp, { force: true }).catch(() => {}); }
}
async function atomicJson(file, value) {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  try {
    const handle = await fsp.open(tmp, 'wx', 0o600);
    try { await handle.writeFile(JSON.stringify(value, null, 2), 'utf8'); await syncBestEffort(handle); } finally { await handle.close(); }
    await replaceFileWithRetry(tmp, file);
  } finally { await fsp.rm(tmp, { force: true }).catch(() => {}); }
}
function contentFingerprint(info, userId) {
  const contents = (info && info.manifest && Array.isArray(info.manifest.contents) ? info.manifest.contents : [])
    .map(item => ({ path: String(item.path || ''), size: Number(item.size) || 0, sha256: String(item.sha256 || '') }))
    .sort((a, b) => a.path.localeCompare(b.path));
  return digest({ userId: String(userId || ''), contents });
}
function backupArea(checked, userId) {
  const root = path.resolve(checked.root);
  const namespace = checked.manifest && checked.manifest.layout && checked.manifest.layout.personalBackups || 'personal-backups';
  const area = path.resolve(root, namespace, safeId(userId));
  const relative = path.relative(root, area);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    const error = new Error('Ortak kişisel yedek yolu Shared Hub dışında.');
    error.code = 'SHARED_PERSONAL_BACKUP_PATH_INVALID';
    error.statusCode = 503;
    throw error;
  }
  return area;
}
async function pruneVersions(area, keepName, retentionCount) {
  let names = [];
  try { names = await fsp.readdir(area); } catch (_) { return 0; }
  const versions = [];
  for (const name of names) {
    if (!/^BuyerLog_Personal_.*_\d{8}T\d{6}Z\.zip$/i.test(name)) continue;
    try {
      const stat = await fsp.stat(path.join(area, name));
      if (stat.isFile()) versions.push({ name, mtimeMs: stat.mtimeMs });
    } catch (_) {}
  }
  versions.sort((a, b) => b.mtimeMs - a.mtimeMs || b.name.localeCompare(a.name));
  const cutoff = Date.now() - MAX_AGE_MS;
  const keep = new Set([keepName, ...versions.slice(0, Math.max(1, retentionCount)).filter(item => item.mtimeMs >= cutoff).map(item => item.name)]);
  let removed = 0;
  for (const item of versions) {
    if (keep.has(item.name)) continue;
    try { await fsp.rm(path.join(area, item.name), { force: true }); removed += 1; } catch (_) {}
  }
  return removed;
}

function createSharedPersonalBackupService({ backupService, syncSettings, sharedHub, retentionCount = DEFAULT_RETENTION } = {}) {
  if (!backupService || !syncSettings || !sharedHub) throw new Error('Shared personal backup dependencies are required.');
  const inFlight = new Map();

  async function checkedRoot(requireWrite = false) {
    const settings = await syncSettings.read();
    if (!settings.sharedSyncRoot) return null;
    return sharedHub.validate(settings.sharedSyncRoot, { requireWrite });
  }

  async function status(user) {
    const checked = await checkedRoot(false);
    if (!checked) return { configured: false, available: false, reason: 'not-configured' };
    const area = backupArea(checked, user && user.id);
    const latest = await readJson(path.join(area, 'latest.json'));
    if (!latest || latest.schemaVersion !== META_SCHEMA_VERSION || String(latest.userId) !== String(user && user.id)) {
      return { configured: true, available: false, root: checked.root, hubId: checked.manifest.hubId };
    }
    let exists = false;
    try { exists = (await fsp.stat(path.join(area, safeBackupName(latest.filename)))).isFile(); } catch (_) {}
    return { configured: true, available: exists, root: checked.root, hubId: checked.manifest.hubId, latest: exists ? latest : null };
  }

  async function latestFile(user) {
    const current = await status(user);
    if (!current.available || !current.latest) return null;
    const checked = await checkedRoot(false);
    if (!checked) return null;
    const area = backupArea(checked, user && user.id);
    const file = path.join(area, safeBackupName(current.latest.filename));
    return { file, meta: current.latest };
  }

  async function create(user, browserStorage = {}) {
    const userId = String(user && user.id || '').trim();
    if (!userId) {
      const error = new Error('Kişisel yedek için kullanıcı kimliği bulunamadı.');
      error.code = 'USER_REQUIRED'; error.statusCode = 400; throw error;
    }
    if (inFlight.has(userId)) return inFlight.get(userId);
    const work = (async () => {
      const checked = await checkedRoot(true);
      if (!checked) return { configured: false, saved: false, reason: 'not-configured' };
      const area = backupArea(checked, userId);
      await fsp.mkdir(area, { recursive: true });
      return withFileLeaseAsync(path.join(area, 'latest.json'), async () => {
        let archive = null;
        try {
          archive = await backupService.create({ mode: 'user', user, browserStorage });
          const info = await inspectBackupArchive(archive.path, { requireType: 'user', validateData: false });
          const fingerprint = contentFingerprint(info, userId);
          const latestFile = path.join(area, 'latest.json');
          const previous = await readJson(latestFile);
          if (previous && previous.schemaVersion === META_SCHEMA_VERSION && previous.fingerprint === fingerprint) {
            return { configured: true, saved: false, unchanged: true, root: checked.root, hubId: checked.manifest.hubId, latest: previous };
          }

          const filename = `BuyerLog_Personal_${safeId(userId)}_${stamp()}.zip`;
          const destination = path.join(area, filename);
          await atomicCopy(archive.path, destination);
          const sha256 = await (async () => {
            const hash = crypto.createHash('sha256');
            for await (const chunk of fs.createReadStream(destination)) hash.update(chunk);
            return hash.digest('hex');
          })();
          const stat = await fsp.stat(destination);
          const meta = {
            schemaVersion: META_SCHEMA_VERSION,
            userId,
            username: String(user.username || ''),
            displayName: String(user.displayName || ''),
            filename,
            createdAt: new Date().toISOString(),
            appVersion: String(info.manifest && info.manifest.app_version || ''),
            bytes: Number(stat.size),
            sha256,
            fingerprint,
            fileCount: Number(info.fileCount) || 0,
            sourceDevice: info.manifest && info.manifest.device || null,
          };
          await atomicJson(latestFile, meta);
          const pruned = await pruneVersions(area, filename, Math.max(3, Number(retentionCount) || DEFAULT_RETENTION));
          return { configured: true, saved: true, root: checked.root, hubId: checked.manifest.hubId, latest: meta, pruned };
        } finally {
          if (archive && typeof archive.cleanup === 'function') await archive.cleanup().catch(() => {});
        }
      });
    })().finally(() => inFlight.delete(userId));
    inFlight.set(userId, work);
    return work;
  }

  return { create, status, latestFile };
}

module.exports = { createSharedPersonalBackupService, META_SCHEMA_VERSION, DEFAULT_RETENTION, MAX_AGE_MS, contentFingerprint, atomicCopy };
