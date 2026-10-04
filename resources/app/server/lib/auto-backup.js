'use strict';

/*
 * Günlük otomatik yedek.
 *
 * Her gün bir kez bu bilgisayarın tam sistem yedeği (model dosyaları ve
 * görseller hariç — backup-scope.js) alınır ve iki hedefe yazılır:
 *   1. local: Buyer Log veri klasörlerinin DIŞINDA kişisel bir klasör
 *      (varsayılan: Belgeler/Buyer Log Backups),
 *   2. sync:  Buyer Log Sync (Shared Hub) klasörü altında cihaz klasörü.
 * Her hedefte günde tek dosya tutulur (BuyerLog_AutoBackup_YYYYMMDD.zip);
 * en yeni 3 gün saklanır, yenisi geldiğinde en eskisi silinir.
 */

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { safeId } = require('./backup-service');
const { atomicCopy } = require('./shared-personal-backup');

const STATE_SCHEMA_VERSION = 1;
const DEFAULT_RETENTION_DAYS = 3;
const FILE_PATTERN = /^BuyerLog_AutoBackup_(\d{8})\.zip$/;
const RETRY_AFTER_FAILURE_MS = 60 * 60 * 1000;
const TARGETS = Object.freeze(['local', 'sync']);

function autoBackupError(code, message, statusCode = 400) {
  return Object.assign(new Error(message), { code, statusCode });
}
function dayKey(date = new Date()) {
  const pad = n => String(n).padStart(2, '0');
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`;
}
function backupFilename(day) { return `BuyerLog_AutoBackup_${day}.zip`; }
function isInside(root, target) {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}
function defaultLocalFolder(home = os.homedir()) {
  const documents = path.join(home, 'Documents');
  return path.join(fs.existsSync(documents) ? documents : home, 'Buyer Log Backups');
}
async function readJson(file) {
  try { return JSON.parse(await fsp.readFile(file, 'utf8')); } catch (_) { return null; }
}
async function writeJsonAtomic(file, value) {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  await fsp.writeFile(tmp, JSON.stringify(value, null, 2), 'utf8');
  try { await fsp.rename(tmp, file); }
  catch (error) { await fsp.copyFile(tmp, file); await fsp.rm(tmp, { force: true }); }
}
async function sha256File(file) {
  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

/*
 * Klasördeki otomatik yedekleri gün sırasına göre (yeni → eski) döndürür.
 */
async function listFolder(folder) {
  let names = [];
  try { names = await fsp.readdir(folder); } catch (_) { return []; }
  const out = [];
  for (const name of names) {
    const match = FILE_PATTERN.exec(name);
    if (!match) continue;
    try {
      const stat = await fsp.stat(path.join(folder, name));
      if (!stat.isFile()) continue;
      const meta = await readJson(path.join(folder, name.replace(/\.zip$/i, '.json')));
      out.push({
        filename: name, day: match[1], bytes: Number(stat.size),
        createdAt: meta && meta.createdAt || new Date(stat.mtimeMs).toISOString(),
        appVersion: meta && meta.appVersion || '', fileCount: meta && Number(meta.fileCount) || null,
        excludedAssets: meta && meta.excludedAssets || null,
      });
    } catch (_) {}
  }
  return out.sort((a, b) => b.day.localeCompare(a.day));
}
async function pruneFolder(folder, retentionDays = DEFAULT_RETENTION_DAYS) {
  const items = await listFolder(folder);
  const removed = [];
  for (const item of items.slice(Math.max(1, retentionDays))) {
    try {
      await fsp.rm(path.join(folder, item.filename), { force: true });
      await fsp.rm(path.join(folder, item.filename.replace(/\.zip$/i, '.json')), { force: true });
      removed.push(item.filename);
    } catch (_) {}
  }
  return removed;
}

function createAutoBackupService({
  backupService, syncSettings = null, sharedHub = null, stateFile, appVersion = '',
  forbiddenRoots = [], homeDir = os.homedir(), retentionDays = DEFAULT_RETENTION_DAYS,
  now = () => new Date(), isBlocked = () => false, logger = null,
} = {}) {
  if (!backupService || !stateFile) throw new Error('Auto backup dependencies are required.');
  let running = null, timers = [];

  async function readState() {
    const raw = await readJson(stateFile);
    const state = raw && raw.schemaVersion === STATE_SCHEMA_VERSION ? raw : {};
    return {
      schemaVersion: STATE_SCHEMA_VERSION,
      enabled: state.enabled !== false,
      localFolder: typeof state.localFolder === 'string' ? state.localFolder : '',
      lastSuccessDay: state.lastSuccessDay && typeof state.lastSuccessDay === 'object' ? state.lastSuccessDay : {},
      lastAttemptAt: state.lastAttemptAt || null,
      lastRun: state.lastRun || null,
    };
  }
  async function writeState(state) { await writeJsonAtomic(stateFile, { ...state, schemaVersion: STATE_SCHEMA_VERSION }); }

  function validateLocalFolder(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    if (!path.isAbsolute(raw)) throw autoBackupError('AUTO_BACKUP_FOLDER_INVALID', 'Yedek klasörü tam (mutlak) bir yol olmalı.');
    const resolved = path.resolve(raw);
    for (const root of forbiddenRoots.filter(Boolean)) {
      if (isInside(root, resolved) || isInside(resolved, root)) throw autoBackupError('AUTO_BACKUP_FOLDER_INSIDE_APP', 'Yedek klasörü Buyer Log veri/uygulama klasörlerinin dışında olmalı.');
    }
    return resolved;
  }
  function effectiveLocalFolder(state) { return state.localFolder || defaultLocalFolder(homeDir); }

  async function syncFolder(requireWrite) {
    if (!syncSettings || !sharedHub) return { configured: false };
    const settings = await syncSettings.read();
    if (!settings || !settings.sharedSyncRoot) return { configured: false };
    const checked = await sharedHub.validate(settings.sharedSyncRoot, { requireWrite });
    const device = safeId(`${os.hostname()}_${String(settings.deviceId || '').slice(0, 8)}`.replace(/_$/, ''));
    return { configured: true, folder: path.join(checked.root, 'auto-backups', device) };
  }
  async function resolveTarget(target, { requireWrite = false } = {}) {
    if (target === 'local') {
      const state = await readState();
      return { configured: true, folder: effectiveLocalFolder(state) };
    }
    if (target === 'sync') return syncFolder(requireWrite);
    throw autoBackupError('AUTO_BACKUP_TARGET_INVALID', 'Bilinmeyen yedek hedefi.');
  }

  async function runNow({ reason = 'manual' } = {}) {
    if (running) return running;
    if (isBlocked()) throw autoBackupError('AUTO_BACKUP_BLOCKED', 'Geri yükleme sürerken otomatik yedek alınamaz.', 409);
    running = (async () => {
      const state = await readState();
      const startedAt = now(), day = dayKey(startedAt), filename = backupFilename(day);
      state.lastAttemptAt = startedAt.toISOString();
      await writeState(state);
      const results = {};
      let archive = null;
      try {
        archive = await backupService.create({
          mode: 'full', trusted: true, auto: true, filename,
          user: { id: 'auto-backup', username: 'auto-backup', displayName: 'Buyer Log Auto Backup', systemRole: 'system' },
        });
        const sha256 = await sha256File(archive.path);
        const meta = {
          schemaVersion: STATE_SCHEMA_VERSION, filename, day, createdAt: startedAt.toISOString(), appVersion: String(appVersion || ''),
          bytes: Number(archive.size) || 0, fileCount: Number(archive.fileCount) || 0, sha256,
          excludedAssets: archive.excludedAssets || null, device: os.hostname(),
        };
        for (const target of TARGETS) {
          try {
            const resolved = await resolveTarget(target, { requireWrite: true });
            if (!resolved.configured) { results[target] = { ok: false, skipped: true, reason: 'not-configured' }; continue; }
            await fsp.mkdir(resolved.folder, { recursive: true });
            await atomicCopy(archive.path, path.join(resolved.folder, filename));
            await writeJsonAtomic(path.join(resolved.folder, filename.replace(/\.zip$/i, '.json')), meta);
            const pruned = await pruneFolder(resolved.folder, retentionDays);
            results[target] = { ok: true, folder: resolved.folder, pruned };
            state.lastSuccessDay[target] = day;
          } catch (error) {
            results[target] = { ok: false, error: error && error.message || String(error), code: error && error.code || null };
            if (typeof logger === 'function') logger(`autoBackup:${target}`, error);
          }
        }
        state.lastRun = { day, reason, startedAt: startedAt.toISOString(), finishedAt: now().toISOString(), bytes: meta.bytes, fileCount: meta.fileCount, results };
      } catch (error) {
        if (typeof logger === 'function') logger('autoBackup', error);
        state.lastRun = { day, reason, startedAt: startedAt.toISOString(), finishedAt: now().toISOString(), error: error && error.message || String(error), results };
      } finally {
        if (archive && typeof archive.cleanup === 'function') await archive.cleanup().catch(() => {});
      }
      await writeState(state);
      return state.lastRun;
    })().finally(() => { running = null; });
    return running;
  }

  // Bugünün yedeği eksik olan, yapılandırılmış bir hedef var mı?
  async function isDue() {
    const state = await readState();
    if (!state.enabled || isBlocked()) return false;
    const today = dayKey(now());
    const lastAttempt = state.lastAttemptAt ? Date.parse(state.lastAttemptAt) : 0;
    const missing = [];
    for (const target of TARGETS) {
      if (state.lastSuccessDay[target] === today) continue;
      if (target === 'sync') {
        const settings = syncSettings ? await syncSettings.read().catch(() => null) : null;
        if (!settings || !settings.sharedSyncRoot) continue;
      }
      missing.push(target);
    }
    if (!missing.length) return false;
    const attemptedToday = lastAttempt && dayKey(new Date(lastAttempt)) === today;
    return !attemptedToday || now().getTime() - lastAttempt >= RETRY_AFTER_FAILURE_MS;
  }
  async function tick() {
    try { if (await isDue()) await runNow({ reason: 'schedule' }); }
    catch (error) { if (typeof logger === 'function') logger('autoBackupTick', error); }
  }
  function start({ initialDelayMs = 2 * 60 * 1000, intervalMs = 30 * 60 * 1000 } = {}) {
    stop();
    const first = setTimeout(tick, initialDelayMs);
    const every = setInterval(tick, intervalMs);
    for (const timer of [first, every]) if (timer && typeof timer.unref === 'function') timer.unref();
    timers = [first, every];
  }
  function stop() { for (const timer of timers) { clearTimeout(timer); clearInterval(timer); } timers = []; }

  async function updateSettings({ enabled, localFolder } = {}) {
    const state = await readState();
    if (enabled !== undefined) state.enabled = Boolean(enabled);
    if (localFolder !== undefined) {
      const folder = validateLocalFolder(localFolder);
      if (folder) await fsp.mkdir(folder, { recursive: true });
      state.localFolder = folder;
    }
    await writeState(state);
    return status();
  }

  async function status() {
    const state = await readState();
    const targets = {};
    for (const target of TARGETS) {
      try {
        const resolved = await resolveTarget(target);
        targets[target] = resolved.configured
          ? { configured: true, folder: resolved.folder, backups: await listFolder(resolved.folder), lastSuccessDay: state.lastSuccessDay[target] || null }
          : { configured: false, backups: [] };
      } catch (error) {
        targets[target] = { configured: true, available: false, error: error && error.message || String(error), backups: [] };
      }
    }
    return {
      enabled: state.enabled, retentionDays, running: Boolean(running),
      localFolder: effectiveLocalFolder(state), customLocalFolder: Boolean(state.localFolder), defaultLocalFolder: defaultLocalFolder(homeDir),
      today: dayKey(now()), lastRun: state.lastRun, lastAttemptAt: state.lastAttemptAt, targets,
    };
  }

  async function resolveBackupFile(target, filename) {
    const name = String(filename || '');
    if (!FILE_PATTERN.test(name) || path.basename(name) !== name) throw autoBackupError('AUTO_BACKUP_FILE_INVALID', 'Otomatik yedek dosya adı geçersiz.');
    const resolved = await resolveTarget(target);
    if (!resolved.configured) throw autoBackupError('AUTO_BACKUP_TARGET_UNAVAILABLE', 'Yedek hedefi yapılandırılmamış.', 404);
    const file = path.join(resolved.folder, name);
    try { if (!(await fsp.stat(file)).isFile()) throw new Error('not-file'); }
    catch (_) { throw autoBackupError('AUTO_BACKUP_FILE_NOT_FOUND', 'Otomatik yedek dosyası bulunamadı.', 404); }
    return file;
  }

  return { runNow, isDue, tick, start, stop, status, updateSettings, resolveBackupFile, validateLocalFolder };
}

module.exports = { createAutoBackupService, dayKey, backupFilename, listFolder, pruneFolder, defaultLocalFolder, DEFAULT_RETENTION_DAYS, FILE_PATTERN };
