'use strict';

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const {
  inspectBackupArchive, readBackupJsonEntry, extractBackupArchive, BACKUP_VERSION, BACKUP_SCHEMA_VERSION,
} = require('./backup-archive');
const { skipBackupFile } = require('./backup-service');
const { createLocalDb, SCHEMA_VERSION: LOCAL_DB_SCHEMA_VERSION } = require('./local-db');
const { isNetworkPath } = require('./local-path-policy');

const SENSITIVE_KEY = /(?:password|pinHash|secret|token|cookie|credential|clientSecret|privateKey|loginFailures?|lockUntil|session(?:Id|Key|Secret|Token|Cookie))/i;
const MACHINE_PATH_KEY = /(?:path|folder|directory|root|file)$/i;
const MACHINE_CONFIG_KEYS = new Set(['host', 'port', 'sharedDataRoot']);
const RESTORE_JOURNAL_VERSION = 1;
const SAFETY_MARGIN_BYTES = 128 * 1024 * 1024;

function restoreError(code, message, statusCode = 400, details = null) {
  return Object.assign(new Error(message), { code, statusCode, details });
}
function safeJsonRead(file, code, message) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (error) { throw restoreError(code, message, 400, { cause: error.message }); }
}
function ensureInside(root, target) {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}
function clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }
function isAbsoluteMachinePath(value) {
  const raw = String(value || '').trim();
  return path.isAbsolute(raw) || /^[A-Za-z]:[\\/]/.test(raw) || /^\\\\/.test(raw);
}
function compareVersions(a, b) {
  const pa = String(a || '').split(/[.-]/).map(part => Number(part)).filter(Number.isFinite);
  const pb = String(b || '').split(/[.-]/).map(part => Number(part)).filter(Number.isFinite);
  const length = Math.max(pa.length, pb.length);
  for (let i = 0; i < length; i++) {
    const diff = (pa[i] || 0) - (pb[i] || 0);
    if (diff) return diff > 0 ? 1 : -1;
  }
  return 0;
}
function mergePortableConfig(current, snapshot, key = '') {
  if (SENSITIVE_KEY.test(key) || MACHINE_CONFIG_KEYS.has(key)) return clone(current);
  if (Array.isArray(snapshot)) return clone(snapshot);
  if (!snapshot || typeof snapshot !== 'object') {
    if (typeof snapshot === 'string' && MACHINE_PATH_KEY.test(key) && isAbsoluteMachinePath(snapshot) && !isNetworkPath(snapshot)) return current == null ? undefined : clone(current);
    return clone(snapshot);
  }
  const base = current && typeof current === 'object' && !Array.isArray(current) ? current : {};
  const out = { ...clone(base) };
  for (const [childKey, value] of Object.entries(snapshot)) {
    const merged = mergePortableConfig(base[childKey], value, childKey);
    if (merged !== undefined) out[childKey] = merged;
  }
  return out;
}
async function atomicWriteJson(file, value) {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.${crypto.randomBytes(4).toString('hex')}.restore.tmp`;
  const handle = await fsp.open(tmp, 'wx');
  try { await handle.writeFile(JSON.stringify(value, null, 2), 'utf8'); try { await handle.sync(); } catch (_) {} }
  finally { await handle.close(); }
  try { await fsp.rename(tmp, file); }
  catch (error) { try { await fsp.copyFile(tmp, file); await fsp.rm(tmp, { force: true }); } catch (_) { throw error; } }
}
async function copyFileDurable(source, target) {
  await fsp.mkdir(path.dirname(target), { recursive: true });
  const tmp = `${target}.${process.pid}.${Date.now()}.${crypto.randomBytes(4).toString('hex')}.restore.tmp`;
  await fsp.copyFile(source, tmp);
  try { const handle = await fsp.open(tmp, 'r+'); try { await handle.sync(); } finally { await handle.close(); } } catch (_) {}
  try { await fsp.rename(tmp, target); }
  catch (error) { try { await fsp.copyFile(tmp, target); await fsp.rm(tmp, { force: true }); } catch (_) { throw error; } }
}
async function removeEmptyParents(file, stopRoot) {
  let dir = path.dirname(file), root = path.resolve(stopRoot);
  while (ensureInside(root, dir) && path.resolve(dir) !== root) {
    try { await fsp.rmdir(dir); } catch (_) { break; }
    dir = path.dirname(dir);
  }
}
async function walkManaged(root, excludeTop = []) {
  const out = [], excluded = new Set(excludeTop);
  if (!root || !fs.existsSync(root)) return out;
  async function visit(current, relative = '') {
    let dir;
    try { dir = await fsp.opendir(current); } catch (_) { return; }
    for await (const item of dir) {
      const rel = relative ? `${relative}/${item.name}` : item.name;
      if (skipBackupFile(rel, excluded) || item.isSymbolicLink()) continue;
      const full = path.join(current, item.name);
      if (item.isDirectory()) await visit(full, rel);
      else if (item.isFile()) {
        const stat = await fsp.stat(full);
        out.push({ full, rel: rel.replace(/\\/g, '/'), size: stat.size });
      }
    }
  }
  await visit(root);
  return out;
}
async function folderBytes(scopes) {
  let total = 0;
  for (const scope of scopes) for (const file of await walkManaged(scope.root, scope.excludeTop)) total += file.size;
  return total;
}
async function freeBytesFor(target) {
  if (typeof fsp.statfs !== 'function') return null;
  let current = path.resolve(target);
  while (!fs.existsSync(current) && path.dirname(current) !== current) current = path.dirname(current);
  try {
    const stat = await fsp.statfs(current);
    return Number(stat.bavail) * Number(stat.bsize || stat.frsize || 0);
  } catch (_) { return null; }
}
function publicManifest(manifest) {
  return {
    backupVersion: Number(manifest.backup_version), schemaVersion: Number(manifest.schema_version), backupType: String(manifest.backup_type || ''),
    appVersion: String(manifest.app_version || ''), createdAt: manifest.created_at || null, device: manifest.device || {},
  };
}
function modelConnectionsFrom(settings) {
  return Array.isArray(settings && settings.modelConnections) ? clone(settings.modelConnections) : [];
}
function connectionRole(connection) {
  return String(connection && (connection.role || connection.sourceRole) || '').trim().toLocaleLowerCase('en-US');
}
function connectionRoles(connections) {
  const found = new Set((connections || []).map(connectionRole));
  return { asas: found.has('asas'), ias: found.has('ias'), intake: found.has('intake') };
}
function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, stableValue(value[key])]));
}
function sameStructuredValue(left, right) {
  return JSON.stringify(stableValue(left)) === JSON.stringify(stableValue(right));
}
function securityInventory(snapshot) {
  const users = snapshot ? [snapshot.moderator, ...(Array.isArray(snapshot.users) ? snapshot.users : [])].filter(Boolean).length : 0;
  const rolesValue = snapshot && snapshot.iam && snapshot.iam.roles;
  const roles = Array.isArray(rolesValue) ? rolesValue.length : (rolesValue && typeof rolesValue === 'object' ? Object.keys(rolesValue).length : 0);
  return { users, roles };
}
function scopeDefinitions(roots) {
  return [
    { id: 'serverData', prefix: 'system/server-data/', root: roots.serverDataRoot, excludeTop: ['logs', 'email-drafts'] },
    { id: 'appData', prefix: 'system/app-data/', root: roots.appDataRoot, excludeTop: ['auth', 'logs', 'email-drafts', 'model-files', 'collection-images'] },
    { id: 'localData', prefix: 'system/local-data/', root: roots.localDataRoot, excludeTop: ['logs', 'model-files', 'collection-images', 'qtx-files', 'page-cache', 'model-snapshots', 'oab-snapshots', 'restore-recovery'] },
    { id: 'modelFiles', prefix: 'system/model-files/', root: roots.modelFilesRoot, excludeTop: [] },
    { id: 'collectionImages', prefix: 'system/collection-images/', root: roots.collectionImagesRoot, excludeTop: [] },
    { id: 'qtxFiles', prefix: 'system/qtx-files/', root: roots.qtxFilesRoot, excludeTop: [] },
  ];
}
function stagePath(stageRoot, archivePath) { return path.join(stageRoot, ...String(archivePath).split('/')); }
function relativeForScope(scope, archivePath) { return String(archivePath).slice(scope.prefix.length); }
function findScope(scopes, archivePath) { return scopes.find(scope => String(archivePath).startsWith(scope.prefix)) || null; }
function validateManifestContents(scopes, manifest) {
  const seen = new Set(), unhandled = [];
  for (const item of manifest && manifest.contents || []) {
    const archivePath = String(item && item.path || '');
    if (!archivePath || seen.has(archivePath)) { unhandled.push(archivePath || '(boş)'); continue; }
    seen.add(archivePath);
    if (['system/config/config.json', 'system/security/users-roles-permissions.json', 'system/sync/metadata.json'].includes(archivePath)) continue;
    const known = findScope(scopes, archivePath) || archivePath === 'system/local/BuyerLogLocal.db';
    if (!known) unhandled.push(archivePath);
  }
  if (unhandled.length) throw restoreError('RESTORE_UNHANDLED_CONTENT', `Backup içinde bu sürümün restore edemediği içerik var: ${unhandled.slice(0, 20).join(', ')}`, 409, { paths: unhandled });
}

async function writeJournal(txRoot, value) {
  await atomicWriteJson(path.join(txRoot, 'journal.json'), { journalVersion: RESTORE_JOURNAL_VERSION, ...value, updatedAt: new Date().toISOString() });
}
async function snapshotRollback(txRoot, scopes, specialFiles) {
  const rollbackRoot = path.join(txRoot, 'rollback');
  await fsp.mkdir(rollbackRoot, { recursive: true });
  const manifest = { scopes: {}, specials: {} };
  for (const scope of scopes) {
    const files = await walkManaged(scope.root, scope.excludeTop);
    manifest.scopes[scope.id] = files.map(file => file.rel);
    for (const file of files) await copyFileDurable(file.full, path.join(rollbackRoot, 'scopes', scope.id, ...file.rel.split('/')));
  }
  for (const [id, file] of Object.entries(specialFiles)) {
    const exists = Boolean(file && fs.existsSync(file));
    manifest.specials[id] = { file, exists };
    if (exists) await copyFileDurable(file, path.join(rollbackRoot, 'specials', `${id}.bin`));
  }
  await atomicWriteJson(path.join(rollbackRoot, 'manifest.json'), manifest);
  return { rollbackRoot, manifest };
}
async function clearManagedScopes(scopes) {
  for (const scope of scopes) {
    const files = await walkManaged(scope.root, scope.excludeTop);
    for (const file of files) {
      await fsp.rm(file.full, { force: true });
      await removeEmptyParents(file.full, scope.root);
    }
  }
}
async function restoreRollback(txRoot, scopes) {
  const rollbackRoot = path.join(txRoot, 'rollback');
  const manifest = safeJsonRead(path.join(rollbackRoot, 'manifest.json'), 'RESTORE_ROLLBACK_INVALID', 'Restore rollback manifesti okunamadı.');
  await clearManagedScopes(scopes);
  for (const scope of scopes) {
    const files = Array.isArray(manifest.scopes && manifest.scopes[scope.id]) ? manifest.scopes[scope.id] : [];
    for (const rel of files) {
      const source = path.join(rollbackRoot, 'scopes', scope.id, ...String(rel).split('/'));
      const target = path.join(scope.root, ...String(rel).split('/'));
      if (fs.existsSync(source)) await copyFileDurable(source, target);
    }
  }
  for (const [id, info] of Object.entries(manifest.specials || {})) {
    if (!info || !info.file) continue;
    const source = path.join(rollbackRoot, 'specials', `${id}.bin`);
    if (info.exists && fs.existsSync(source)) await copyFileDurable(source, info.file);
    else await fsp.rm(info.file, { force: true });
  }
  return { ok: true };
}

async function recoverInterruptedRestores({ roots, securityFile = null, syncFile = null, onEvent = null }) {
  const scopes = scopeDefinitions(roots), recoveryRoot = path.join(roots.localDataRoot, 'restore-recovery');
  if (!fs.existsSync(recoveryRoot)) return { recovered: 0, cleaned: 0, failures: [] };
  const entries = await fsp.readdir(recoveryRoot, { withFileTypes: true });
  let recovered = 0, cleaned = 0; const failures = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const txRoot = path.join(recoveryRoot, entry.name), journalFile = path.join(txRoot, 'journal.json');
    let journal = null;
    try { journal = JSON.parse(await fsp.readFile(journalFile, 'utf8')); } catch (_) { continue; }
    try {
      if (['committing', 'rollback_failed'].includes(journal.status)) {
        await restoreRollback(txRoot, scopes);
        recovered += 1;
        if (typeof onEvent === 'function') onEvent('RESTORE_INTERRUPTED_RECOVERED', { restoreId: entry.name });
      } else cleaned += 1;
      await fsp.rm(txRoot, { recursive: true, force: true });
    } catch (error) {
      failures.push({ restoreId: entry.name, error: error.message });
      if (typeof onEvent === 'function') onEvent('RESTORE_INTERRUPTED_RECOVERY_FAILED', { restoreId: entry.name, error: error.message });
    }
  }
  return { recovered, cleaned, failures, securityFile, syncFile };
}

function walkManagedSync(root, excludeTop = []) {
  const out = [], excluded = new Set(excludeTop);
  if (!root || !fs.existsSync(root)) return out;
  function visit(current, relative = '') {
    for (const item of fs.readdirSync(current, { withFileTypes: true })) {
      const rel = relative ? `${relative}/${item.name}` : item.name;
      if (skipBackupFile(rel, excluded) || item.isSymbolicLink()) continue;
      const full = path.join(current, item.name);
      if (item.isDirectory()) visit(full, rel);
      else if (item.isFile()) out.push({ full, rel: rel.replace(/\\/g, '/') });
    }
  }
  visit(root); return out;
}
function clearManagedScopesSync(scopes) {
  for (const scope of scopes) for (const file of walkManagedSync(scope.root, scope.excludeTop)) {
    try { fs.rmSync(file.full, { force: true }); } catch (_) {}
  }
}
function restoreRollbackSync(txRoot, scopes) {
  const rollbackRoot = path.join(txRoot, 'rollback');
  const manifest = JSON.parse(fs.readFileSync(path.join(rollbackRoot, 'manifest.json'), 'utf8'));
  clearManagedScopesSync(scopes);
  for (const scope of scopes) {
    const files = Array.isArray(manifest.scopes && manifest.scopes[scope.id]) ? manifest.scopes[scope.id] : [];
    for (const rel of files) {
      const source = path.join(rollbackRoot, 'scopes', scope.id, ...String(rel).split('/'));
      const target = path.join(scope.root, ...String(rel).split('/'));
      if (!fs.existsSync(source)) continue;
      fs.mkdirSync(path.dirname(target), { recursive: true }); fs.copyFileSync(source, target);
    }
  }
  for (const [id, info] of Object.entries(manifest.specials || {})) {
    if (!info || !info.file) continue;
    const source = path.join(rollbackRoot, 'specials', `${id}.bin`);
    if (info.exists && fs.existsSync(source)) { fs.mkdirSync(path.dirname(info.file), { recursive: true }); fs.copyFileSync(source, info.file); }
    else { try { fs.rmSync(info.file, { force: true }); } catch (_) {} }
  }
}
function recoverInterruptedRestoresSync({ roots, onEvent = null }) {
  const scopes = scopeDefinitions(roots), recoveryRoot = path.join(roots.localDataRoot, 'restore-recovery');
  if (!fs.existsSync(recoveryRoot)) return { recovered: 0, cleaned: 0, failures: [] };
  let recovered = 0, cleaned = 0; const failures = [];
  for (const entry of fs.readdirSync(recoveryRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const txRoot = path.join(recoveryRoot, entry.name), journalFile = path.join(txRoot, 'journal.json');
    let journal;
    try { journal = JSON.parse(fs.readFileSync(journalFile, 'utf8')); } catch (_) { continue; }
    try {
      if (['committing', 'rollback_failed'].includes(journal.status)) {
        restoreRollbackSync(txRoot, scopes); recovered += 1;
        if (typeof onEvent === 'function') onEvent('RESTORE_INTERRUPTED_RECOVERED', { restoreId: entry.name });
      } else cleaned += 1;
      fs.rmSync(txRoot, { recursive: true, force: true });
    } catch (error) {
      failures.push({ restoreId: entry.name, error: error.message });
      if (typeof onEvent === 'function') onEvent('RESTORE_INTERRUPTED_RECOVERY_FAILED', { restoreId: entry.name, error: error.message });
    }
  }
  return { recovered, cleaned, failures };
}

function createFullRestoreService({ appVersion, roots, localDb, syncSettings, userAccess, backupService, securityFile = null, connectionHealthCheck = null, onWriteLockState = null, onCommitState = null }) {
  if (!roots || !roots.localDataRoot) throw new Error('Full restore data roots zorunludur.');
  const scopes = scopeDefinitions(roots);
  const recoveryRoot = path.join(roots.localDataRoot, 'restore-recovery');
  const specialFiles = { config: roots.configPath, security: securityFile, sync: syncSettings && syncSettings.file };
  const report = (callback, value) => { if (typeof callback === 'function') callback(value); };

  async function inspect(file, options = {}) {
    const info = await inspectBackupArchive(file, { requireType: 'full', onProgress: options.onProgress });
    if (Number(info.manifest.backup_version) !== BACKUP_VERSION || Number(info.manifest.schema_version) !== BACKUP_SCHEMA_VERSION) throw restoreError('RESTORE_UNSUPPORTED_VERSION', 'Backup sürümü desteklenmiyor.');
    if (info.manifest.app_version && compareVersions(info.manifest.app_version, appVersion) > 0) throw restoreError('RESTORE_NEWER_APP_VERSION', `Backup daha yeni Buyer Log sürümünden alınmış (${info.manifest.app_version}). Önce Buyer Log'u güncelleyin.`, 409);
    const currentBytes = await folderBytes(scopes);
    const safetyCopyBytes = options.createSafetyBackup === false ? 0 : currentBytes;
    const estimatedRequiredBytes = info.totalBytes + currentBytes + safetyCopyBytes + SAFETY_MARGIN_BYTES;
    const freeBytes = await freeBytesFor(recoveryRoot);
    if (freeBytes != null && freeBytes < estimatedRequiredBytes) throw restoreError('RESTORE_INSUFFICIENT_DISK', 'Restore için yeterli boş disk alanı yok.', 507, { freeBytes, estimatedRequiredBytes });
    const contents = new Set((info.manifest.contents || []).map(item => item.path));
    const warnings = [];
    if (String(info.manifest.app_version || '') !== String(appVersion || '')) warnings.push(`Backup sürümü ${info.manifest.app_version || 'bilinmiyor'}, yüklü sürüm ${appVersion}. Restore sonrası veri migration/doğrulaması uygulanacak.`);
    if (!contents.has('system/security/users-roles-permissions.json')) warnings.push('Kullanıcı/rol/yetki snapshotı bulunmuyor.');
    if (!contents.has('system/sync/metadata.json')) warnings.push('Sync metadata bulunmuyor.');
    warnings.push('Parolalar, oturumlar, Outlook/API kimlik bilgileri güvenlik nedeniyle restore edilmez.');
    const securitySnapshot = contents.has('system/security/users-roles-permissions.json')
      ? await readBackupJsonEntry(file, info, 'system/security/users-roles-permissions.json') : null;
    const settingsSnapshot = contents.has('system/server-data/settings.json')
      ? await readBackupJsonEntry(file, info, 'system/server-data/settings.json') : null;
    const modelConnections = modelConnectionsFrom(settingsSnapshot);
    const identityInventory = securityInventory(securitySnapshot);
    const result = {
      ok: true, compatible: true, ...publicManifest(info.manifest), fileCount: info.fileCount, totalBytes: info.totalBytes,
      archiveBytes: info.archiveBytes, archiveSha256: info.archiveSha256, estimatedRequiredBytes, freeBytes, warnings,
      inventory: {
        ...identityInventory,
        localDb: contents.has('system/local-data/BuyerLogLocal.db') || contents.has('system/local/BuyerLogLocal.db'),
        modelConnections: modelConnections.length,
        connections: connectionRoles(modelConnections),
      },
      contents: {
        serverData: [...contents].some(name => name.startsWith('system/server-data/')),
        appData: [...contents].some(name => name.startsWith('system/app-data/')),
        localData: [...contents].some(name => name.startsWith('system/local-data/')) || contents.has('system/local/BuyerLogLocal.db'),
        modelFiles: [...contents].some(name => name.startsWith('system/model-files/')),
        collectionImages: [...contents].some(name => name.startsWith('system/collection-images/')),
        qtxFiles: [...contents].some(name => name.startsWith('system/qtx-files/')),
        security: contents.has('system/security/users-roles-permissions.json'),
        config: contents.has('system/config/config.json'), sync: contents.has('system/sync/metadata.json'),
      },
    };
    // Keep the verified central-directory records for the same-process start
    // phase without serializing hundreds of thousands of records to the UI.
    Object.defineProperty(result, 'records', { value: info.records, enumerable: false });
    Object.defineProperty(result, 'manifest', { value: info.manifest, enumerable: false });
    return result;
  }

  async function validateStaged(stageRoot, manifest) {
    validateManifestContents(scopes, manifest);
    const names = new Set((manifest.contents || []).map(item => item.path));
    const dbArchivePath = names.has('system/local-data/BuyerLogLocal.db') ? 'system/local-data/BuyerLogLocal.db' : (names.has('system/local/BuyerLogLocal.db') ? 'system/local/BuyerLogLocal.db' : null);
    if (!dbArchivePath) throw restoreError('RESTORE_DATABASE_MISSING', 'Full System Backup içinde BuyerLogLocal.db bulunamadı.');
    const stagedDb = stagePath(stageRoot, dbArchivePath);
    let rawDb;
    try { rawDb = JSON.parse(await fsp.readFile(stagedDb, 'utf8')); }
    catch (error) { throw restoreError('RESTORE_DATABASE_CORRUPT', `BuyerLogLocal.db okunamadı: ${error.message}`); }
    if (Number(rawDb && rawDb.schemaVersion) > LOCAL_DB_SCHEMA_VERSION) throw restoreError('RESTORE_DATABASE_NEWER_SCHEMA', `Backup DB schema sürümü (${rawDb.schemaVersion}) bu Buyer Log sürümünden daha yeni (${LOCAL_DB_SCHEMA_VERSION}).`, 409);
    try {
      const stagedLocalDb = createLocalDb(stagedDb);
      const state = await stagedLocalDb.read();
      if (!state || typeof state !== 'object' || !state.records || !state.deviceId) throw new Error('DB envelope eksik.');
    } catch (error) { throw restoreError('RESTORE_DATABASE_CORRUPT', `BuyerLogLocal.db bütünlük kontrolü başarısız: ${error.message}`); }
    const configFile = stagePath(stageRoot, 'system/config/config.json');
    const securityFilePath = stagePath(stageRoot, 'system/security/users-roles-permissions.json');
    const syncFilePath = stagePath(stageRoot, 'system/sync/metadata.json');
    const settingsFilePath = stagePath(stageRoot, 'system/server-data/settings.json');
    const configSnapshot = fs.existsSync(configFile) ? safeJsonRead(configFile, 'RESTORE_CONFIG_INVALID', 'Backup config.json okunamadı.') : {};
    const securitySnapshot = fs.existsSync(securityFilePath) ? safeJsonRead(securityFilePath, 'RESTORE_SECURITY_SNAPSHOT_INVALID', 'Backup kullanıcı/rol/yetki snapshotı okunamadı.') : null;
    const syncSnapshot = fs.existsSync(syncFilePath) ? safeJsonRead(syncFilePath, 'RESTORE_SYNC_METADATA_INVALID', 'Backup Sync metadata okunamadı.') : null;
    const settingsSnapshot = fs.existsSync(settingsFilePath) ? safeJsonRead(settingsFilePath, 'RESTORE_SETTINGS_INVALID', 'Backup settings.json okunamadı.') : null;
    return { dbArchivePath, configSnapshot, securitySnapshot, syncSnapshot, modelConnections: modelConnectionsFrom(settingsSnapshot) };
  }

  async function applyStaged(stageRoot, manifest, validation, progress) {
    report(progress, { phase: 'Uygulanıyor', current: 0, total: manifest.contents.length, item: 'Mevcut veri alanları hazırlanıyor' });
    await clearManagedScopes(scopes);
    let applied = 0;
    for (const item of manifest.contents || []) {
      const archivePath = String(item.path || '');
      if (archivePath === 'system/config/config.json' || archivePath === 'system/security/users-roles-permissions.json' || archivePath === 'system/sync/metadata.json') continue;
      let scope = findScope(scopes, archivePath), rel = scope && relativeForScope(scope, archivePath);
      if (!scope && archivePath === 'system/local/BuyerLogLocal.db') { scope = scopes.find(item => item.id === 'localData'); rel = 'BuyerLogLocal.db'; }
      if (!scope || !rel) throw restoreError('RESTORE_UNHANDLED_CONTENT', `Restore kapsamı tanımlı olmayan içerik: ${archivePath}`, 409, { paths: [archivePath] });
      const source = stagePath(stageRoot, archivePath), target = path.join(scope.root, ...rel.split('/'));
      if (!ensureInside(scope.root, target)) throw restoreError('RESTORE_UNSAFE_PATH', `Restore hedefi veri alanı dışına çıkıyor: ${archivePath}`);
      await copyFileDurable(source, target); applied += 1;
      report(progress, { phase: 'Uygulanıyor', current: applied, total: manifest.contents.length, item: archivePath });
    }
    let currentConfig = {};
    try { currentConfig = JSON.parse(await fsp.readFile(roots.configPath, 'utf8')); } catch (_) {}
    await atomicWriteJson(roots.configPath, mergePortableConfig(currentConfig, validation.configSnapshot));
    // Central IAM restore, backup'taki taşınabilir shared root üzerinden remote
    // dizini deneyebilsin diye Sync metadata güvenlik snapshotından ÖNCE uygulanır.
    const sync = validation.syncSnapshot && syncSettings && typeof syncSettings.restoreMetadata === 'function'
      ? await syncSettings.restoreMetadata(validation.syncSnapshot)
      : { requiresSharedSyncSetup: false, previousSharedSyncRoot: '' };
    const security = validation.securitySnapshot && userAccess && typeof userAccess.restoreBackupSnapshot === 'function'
      ? await userAccess.restoreBackupSnapshot(validation.securitySnapshot, { centralIamExpected: validation.configSnapshot && validation.configSnapshot.centralIamEnabled === true })
      : { applied: false, restoredUsers: 0, credentialsRequired: 0 };
    return { appliedFiles: applied, security, sync };
  }

  async function verifyRestored(validation = null, applied = null) {
    if (localDb && typeof localDb.setFolder === 'function') localDb.setFolder(path.dirname(localDb.getFile ? localDb.getFile() : roots.localDbFile));
    const state = localDb && typeof localDb.read === 'function' ? await localDb.read() : null;
    if (!state || typeof state !== 'object') throw restoreError('RESTORE_POSTCHECK_FAILED', 'Restore sonrası Local DB açılamadı.', 500);
    const checks = {
      localDb: true,
      serverData: fs.existsSync(roots.serverDataRoot), appData: fs.existsSync(roots.appDataRoot), localData: fs.existsSync(roots.localDataRoot),
      config: fs.existsSync(roots.configPath), modelFiles: fs.existsSync(roots.modelFilesRoot), collectionImages: fs.existsSync(roots.collectionImagesRoot), qtxFiles: fs.existsSync(roots.qtxFilesRoot),
    };
    let users = null;
    if (validation && validation.securitySnapshot && userAccess && typeof userAccess.allPublicProfiles === 'function') {
      const expectedProfiles = [validation.securitySnapshot.moderator, ...(Array.isArray(validation.securitySnapshot.users) ? validation.securitySnapshot.users : [])].filter(Boolean);
      const profiles = userAccess.allPublicProfiles();
      const actualProfiles = Array.isArray(profiles) ? profiles : [];
      const actualIds = new Set(actualProfiles.map(profile => String(profile && profile.id || '').trim()).filter(Boolean));
      const actualNames = new Set(actualProfiles.map(profile => String(profile && (profile.username || profile.displayName) || '').trim().toLocaleLowerCase('tr-TR')).filter(Boolean));
      const missing = expectedProfiles.filter(profile => {
        const id = String(profile && profile.id || '').trim();
        const name = String(profile && (profile.username || profile.displayName) || '').trim().toLocaleLowerCase('tr-TR');
        return !((id && actualIds.has(id)) || (name && actualNames.has(name)));
      });
      const expected = expectedProfiles.length, actual = actualProfiles.length;
      users = { expected, actual, missing: missing.length, missingUserIds: missing.slice(0, 100).map(profile => profile.id), source: applied && applied.security && applied.security.source || 'unknown' };
      checks.users = expected === 0 || missing.length === 0;
      if (expected > 0 && actual === 0) throw restoreError('RESTORE_USERS_MISSING', 'Restore sonrası kullanıcı dizini okunamadı.', 500, users);
      if (missing.length) throw restoreError('RESTORE_USERS_MISSING', `Restore sonrası kullanıcı dizini eksik (${actual}/${expected}; eksik ${missing.length}).`, 500, users);
    }
    const expectedConnections = modelConnectionsFrom({ modelConnections: validation && validation.modelConnections });
    const restoredSettingsFile = path.join(roots.serverDataRoot, 'settings.json');
    let restoredConnections = [];
    if (fs.existsSync(restoredSettingsFile)) restoredConnections = modelConnectionsFrom(safeJsonRead(restoredSettingsFile, 'RESTORE_SETTINGS_INVALID', 'Restore edilen settings.json okunamadı.'));
    const configurationRestored = sameStructuredValue(expectedConnections, restoredConnections);
    checks.connections = configurationRestored;
    if (!configurationRestored) throw restoreError('RESTORE_CONNECTION_CONFIG_MISSING', 'Restore sonrası ASAS / IAS / INTAKE bağlantı yapılandırması doğrulanamadı.', 500);
    const roles = connectionRoles(restoredConnections), health = {};
    for (const role of ['asas', 'ias', 'intake']) {
      const connection = restoredConnections.find(item => connectionRole(item) === role);
      if (!connection) { health[role] = { checked: false, connected: false, reason: 'configuration-missing' }; continue; }
      if (typeof connectionHealthCheck !== 'function') { health[role] = { checked: false, connected: null }; continue; }
      try {
        const result = await connectionHealthCheck(clone(connection));
        health[role] = { checked: true, connected: result === true || Boolean(result && result.connected), ...(result && typeof result === 'object' ? result : {}) };
      } catch (error) { health[role] = { checked: true, connected: false, error: error.message }; }
    }
    return {
      checks, users,
      connections: { configurationRestored, roles, modelConnections: restoredConnections, health },
      dbRevision: Number(state.revision) || 0, dbSchemaVersion: Number(state.schemaVersion) || LOCAL_DB_SCHEMA_VERSION,
    };
  }

  async function restore(file, { actor, onProgress = null, shouldCancel = null, createSafetyBackup = true, preflight = null } = {}) {
    const restoreId = crypto.randomUUID(), txRoot = path.join(recoveryRoot, restoreId), stageRoot = path.join(txRoot, 'stage');
    await fsp.mkdir(stageRoot, { recursive: true });
    let safetyArchive = null, commitStarted = false, rollback = null, paused = false, writeLocked = false, iamRestoreLocked = false;
    const journalBase = { restoreId, source: path.basename(file), startedAt: new Date().toISOString(), status: 'preparing' };
    await writeJournal(txRoot, journalBase);
    try {
      const checked = preflight || await inspect(file, { onProgress });
      if (typeof shouldCancel === 'function' && shouldCancel()) throw restoreError('RESTORE_CANCELLED', 'Restore kullanıcı tarafından iptal edildi.', 409);
      report(onProgress, { phase: 'Hazırlanıyor', current: 0, total: checked.fileCount, item: 'Backup staging alanına açılıyor' });
      const extracted = await extractBackupArchive(file, stageRoot, { requireType: 'full', preflight: checked, onProgress, shouldCancel });
      const validation = await validateStaged(stageRoot, extracted.manifest);
      if (typeof shouldCancel === 'function' && shouldCancel()) throw restoreError('RESTORE_CANCELLED', 'Restore kullanıcı tarafından iptal edildi.', 409);

      // Stop Central IAM refresh/commit races before the optional safety backup
      // and keep the gate until the restored local identity is verified.
      if (userAccess && typeof userAccess.beginRestore === 'function') { userAccess.beginRestore(restoreId); iamRestoreLocked = true; }

      if (createSafetyBackup !== false) {
        report(onProgress, { phase: 'Güvenlik yedeği', current: 0, total: 1, item: 'Mevcut sistem yedekleniyor' });
        if (!backupService || typeof backupService.create !== 'function') throw restoreError('RESTORE_SAFETY_BACKUP_UNAVAILABLE', 'Restore öncesi güvenlik yedeği oluşturulamıyor.', 500);
        safetyArchive = await backupService.create({ mode: 'full', user: actor, browserStorage: {}, onProgress: p => report(onProgress, { ...p, phase: 'Güvenlik yedeği' }) });
        if (typeof shouldCancel === 'function' && shouldCancel()) throw restoreError('RESTORE_CANCELLED', 'Restore kullanıcı tarafından iptal edildi.', 409);
      } else {
        report(onProgress, { phase: 'Hazırlanıyor', current: 1, total: 1, item: 'Ek güvenlik yedeği kullanıcı tercihiyle atlandı' });
      }

      // Rollback snapshot canlı sistemin tutarlı bir görüntüsü olmalı. Bu kilit
      // commit değildir: snapshot tamamlanana kadar kullanıcı restore'u hâlâ
      // iptal edebilir; yalnız yeni HTTP yazmaları geçici olarak reddedilir.
      if (typeof onWriteLockState === 'function') { onWriteLockState(true, restoreId); writeLocked = true; }
      if (syncSettings && typeof syncSettings.pause === 'function') { syncSettings.pause(`restore:${restoreId}`); paused = true; }
      if (syncSettings && typeof syncSettings.waitForIdle === 'function') await syncSettings.waitForIdle();
      report(onProgress, { phase: 'Rollback hazırlanıyor', current: 0, total: 1, item: 'Mevcut canlı sistem güvenceye alınıyor' });
      await snapshotRollback(txRoot, scopes, specialFiles);
      await writeJournal(txRoot, { ...journalBase, status: 'rollback_ready', safetyBackup: safetyArchive ? safetyArchive.filename : null });
      if (typeof shouldCancel === 'function' && shouldCancel()) throw restoreError('RESTORE_CANCELLED', 'Restore kullanıcı tarafından iptal edildi.', 409);

      commitStarted = true;
      await writeJournal(txRoot, { ...journalBase, status: 'committing', safetyBackup: safetyArchive ? safetyArchive.filename : null });
      if (typeof onCommitState === 'function') onCommitState(true, restoreId);
      const applied = await applyStaged(stageRoot, extracted.manifest, validation, onProgress);
      report(onProgress, { phase: 'Doğrulanıyor', current: 0, total: 1, item: 'Restore edilen sistem kontrol ediliyor' });
      const verification = await verifyRestored(validation, applied);
      const warnings = [...checked.warnings];
      for (const role of ['asas', 'ias', 'intake']) {
        const health = verification.connections && verification.connections.health && verification.connections.health[role];
        if (health && health.checked && health.connected === false) warnings.push(`${role.toUpperCase()} yapılandırması restore edildi; bağlantı kullanılamıyor${health.error ? `: ${health.error}` : '.'}`);
      }
      if (applied.security && applied.security.credentialsRequired) warnings.push(`${applied.security.credentialsRequired} aktif kullanıcı için yönetici tarafından yeni şifre atanması gerekiyor.`);
      if (applied.security && applied.security.requiresIamRefresh) warnings.push('Central IAM etkin: backup kullanıcı dizini recovery seed olarak geri yüklendi; merkezi IAM ile uzlaştırma bekleniyor.');
      if (applied.sync && applied.sync.requiresSharedSyncSetup) warnings.push(`Eski Sync yolu bu bilgisayara taşınmadı: ${applied.sync.previousSharedSyncRoot}. Data Management üzerinden yeniden seçin.`);
      await writeJournal(txRoot, { ...journalBase, status: 'completed', completedAt: new Date().toISOString(), safetyBackup: safetyArchive ? safetyArchive.filename : null });
      report(onProgress, { phase: 'Tamamlandı', current: 1, total: 1, item: 'Full System Restore tamamlandı' });
      await fsp.rm(txRoot, { recursive: true, force: true });
      return { ok: true, restoreId, restartRecommended: true, safetyArchive, preflight: checked, applied, verification, warnings };
    } catch (error) {
      if (commitStarted) {
        try {
          report(onProgress, { phase: 'Rollback', current: 0, total: 1, item: 'Önceki sistem geri yükleniyor' });
          rollback = await restoreRollback(txRoot, scopes);
          if (localDb && typeof localDb.setFolder === 'function') localDb.setFolder(path.dirname(localDb.getFile ? localDb.getFile() : roots.localDbFile));
          if (localDb && typeof localDb.ensure === 'function') await localDb.ensure();
          await writeJournal(txRoot, { ...journalBase, status: 'rolled_back', error: error.message, rolledBackAt: new Date().toISOString() });
          await fsp.rm(txRoot, { recursive: true, force: true });
        } catch (rollbackError) {
          try { await writeJournal(txRoot, { ...journalBase, status: 'rollback_failed', error: error.message, rollbackError: rollbackError.message }); } catch (_) {}
          error.rollbackError = rollbackError;
          error.code = 'RESTORE_ROLLBACK_FAILED'; error.statusCode = 500;
        }
      } else {
        try { await fsp.rm(txRoot, { recursive: true, force: true }); } catch (_) {}
      }
      error.rollback = rollback;
      if (safetyArchive) error.safetyArchive = safetyArchive;
      throw error;
    } finally {
      if (typeof onCommitState === 'function') onCommitState(false, restoreId);
      if (writeLocked && typeof onWriteLockState === 'function') onWriteLockState(false, restoreId);
      if (paused && syncSettings && typeof syncSettings.resume === 'function') syncSettings.resume();
      if (iamRestoreLocked && userAccess && typeof userAccess.endRestore === 'function') userAccess.endRestore(restoreId);
    }
  }

  return { inspect, restore, recoveryRoot, recoverInterrupted: () => recoverInterruptedRestores({ roots, securityFile, syncFile: syncSettings && syncSettings.file }) };
}

module.exports = {
  RESTORE_JOURNAL_VERSION,
  createFullRestoreService,
  recoverInterruptedRestores,
  recoverInterruptedRestoresSync,
  mergePortableConfig,
  compareVersions,
  scopeDefinitions,
};
