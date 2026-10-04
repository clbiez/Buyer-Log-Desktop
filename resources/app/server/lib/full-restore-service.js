'use strict';

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const {
  inspectBackupArchive, readBackupJsonEntry, extractBackupArchive, BACKUP_VERSION, BACKUP_SCHEMA_VERSION,
} = require('./backup-archive');
const { skipBackupFile, BACKUP_EXCLUDED_TOP, CATEGORIES: COMPONENT_CATEGORIES, componentsFromManifest, componentIdForArchivePath, archivePathRestorable, topMatches } = require('./backup-scope');
const { createLocalDb, SCHEMA_VERSION: LOCAL_DB_SCHEMA_VERSION } = require('./local-db');
const { isNetworkPath } = require('./local-path-policy');
const prewipeMasterRecovery = require('./prewipe-master-recovery');

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
// onlyTop: seçmeli restore'da kök altındaki tek bir üst seviye dosya/klasörle
// sınırlar; diğer veri alanlarına dokunulmaz.
async function walkManaged(root, excludeTop = [], onlyTop = '') {
  const out = [], excluded = new Set(excludeTop);
  if (!root || !fs.existsSync(root)) return out;
  async function visit(current, relative = '') {
    let dir;
    try { dir = await fsp.opendir(current); } catch (_) { return; }
    for await (const item of dir) {
      const rel = relative ? `${relative}/${item.name}` : item.name;
      if (onlyTop && !relative && !topMatches(item.name, onlyTop)) continue;
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
  for (const scope of scopes) for (const file of await walkManaged(scope.root, scope.excludeTop, scope.onlyTop)) total += file.size;
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
// excludeTop backup-service fullBackupRoots ile aynı kaynaktan gelir
// (backup-scope.js). modelFiles/collectionImages yalnız eski (v1) yedeklerde
// bulunur; yeni yedekler bu büyük varlıkları içermez ve restore onlara dokunmaz.
const CORE_SCOPE_IDS = new Set(['serverData', 'appData', 'localData']);
function scopeDefinitions(roots) {
  return [
    { id: 'serverData', prefix: 'system/server-data/', root: roots.serverDataRoot, excludeTop: [...BACKUP_EXCLUDED_TOP] },
    { id: 'appData', prefix: 'system/app-data/', root: roots.appDataRoot, excludeTop: [...BACKUP_EXCLUDED_TOP] },
    { id: 'localData', prefix: 'system/local-data/', root: roots.localDataRoot, excludeTop: [...BACKUP_EXCLUDED_TOP, 'qtx-files'] },
    { id: 'modelFiles', prefix: 'system/model-files/', root: roots.modelFilesRoot, excludeTop: [] },
    { id: 'collectionImages', prefix: 'system/collection-images/', root: roots.collectionImagesRoot, excludeTop: [] },
    { id: 'qtxFiles', prefix: 'system/qtx-files/', root: roots.qtxFilesRoot, excludeTop: [] },
  ];
}
const SPECIAL_COMPONENT_IDS = new Set(['config', 'security', 'sync']);
/*
 * components == null → eski "ayna" restore: çekirdek veri kökleri ve arşivde
 * bulunan varlık kökleri tamamen backup içeriğine eşitlenir.
 * components = [...] → seçmeli restore: yalnız seçilen veri alanları
 * (kök + üst seviye dosya/klasör) temizlenir ve backup'tan yazılır.
 */
function buildRestorePlan(scopes, manifest, components = null) {
  const available = componentsFromManifest(manifest, scopes);
  const availableIds = new Set(available.map(item => item.id));
  if (components == null) {
    const names = (manifest && manifest.contents || []).map(item => String(item && item.path || ''));
    const touched = scopes.filter(scope => CORE_SCOPE_IDS.has(scope.id) || names.some(name => name.startsWith(scope.prefix))).map(scope => ({ ...scope, baseId: scope.id, onlyTop: '' }));
    return { mode: 'mirror', selected: availableIds, touched, available };
  }
  if (!Array.isArray(components)) throw restoreError('RESTORE_SCOPE_INVALID', 'Restore kapsamı geçersiz.');
  const selected = new Set();
  for (const raw of components) {
    const id = String(raw || '').trim();
    if (!id) continue;
    if (!availableIds.has(id)) throw restoreError('RESTORE_SCOPE_UNAVAILABLE', `Seçilen veri alanı bu backup içinde yok: ${id}`, 400, { component: id });
    selected.add(id);
  }
  if (!selected.size) throw restoreError('RESTORE_SCOPE_EMPTY', 'Geri yüklenecek en az bir veri alanı seçin.');
  // Tümü seçiliyse eski tam ayna davranışı: backup'ta olmayan üst seviye
  // dosyalar da (ör. yedekten sonra oluşmuş WAL) temizlenir.
  if (selected.size === availableIds.size) return buildRestorePlan(scopes, manifest, null);
  const touched = [];
  for (const id of selected) {
    if (SPECIAL_COMPONENT_IDS.has(id)) continue;
    const slash = id.indexOf('/'), baseId = id.slice(0, slash), top = id.slice(slash + 1);
    const scope = scopes.find(item => item.id === baseId);
    if (!scope || !top || top.includes('/') || top === '.' || top === '..') throw restoreError('RESTORE_SCOPE_INVALID', `Restore kapsamı geçersiz: ${id}`);
    touched.push({ ...scope, id: `${baseId}~${top}`, baseId, onlyTop: top });
  }
  return { mode: 'selective', selected, touched, available };
}
function planIncludes(plan, archivePath, scopes) {
  if (!archivePathRestorable(archivePath, scopes)) return false;
  if (!plan || plan.mode === 'mirror') return true;
  return plan.selected.has(componentIdForArchivePath(archivePath, scopes));
}
// Rollback manifest'i hangi alanların snapshot'landığını taşır; kesintiden
// sonra kurtarma yalnız o alanları geri yazar (seçilmeyen veriler silinmez).
function touchedScopesFromManifest(manifest, scopes) {
  if (!Array.isArray(manifest && manifest.touched)) return scopes;
  return manifest.touched.map(item => {
    const base = scopes.find(scope => scope.id === item.baseId);
    return base ? { ...base, id: item.id, baseId: item.baseId, onlyTop: String(item.onlyTop || '') } : null;
  }).filter(Boolean);
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
  const manifest = { scopes: {}, specials: {}, touched: scopes.map(scope => ({ id: scope.id, baseId: scope.baseId || scope.id, onlyTop: scope.onlyTop || '' })) };
  for (const scope of scopes) {
    const files = await walkManaged(scope.root, scope.excludeTop, scope.onlyTop);
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
    const files = await walkManaged(scope.root, scope.excludeTop, scope.onlyTop);
    for (const file of files) {
      await fsp.rm(file.full, { force: true });
      await removeEmptyParents(file.full, scope.root);
    }
  }
}
async function restoreRollback(txRoot, baseScopes) {
  const rollbackRoot = path.join(txRoot, 'rollback');
  const manifest = safeJsonRead(path.join(rollbackRoot, 'manifest.json'), 'RESTORE_ROLLBACK_INVALID', 'Restore rollback manifesti okunamadı.');
  const scopes = touchedScopesFromManifest(manifest, baseScopes);
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

function walkManagedSync(root, excludeTop = [], onlyTop = '') {
  const out = [], excluded = new Set(excludeTop);
  if (!root || !fs.existsSync(root)) return out;
  function visit(current, relative = '') {
    for (const item of fs.readdirSync(current, { withFileTypes: true })) {
      const rel = relative ? `${relative}/${item.name}` : item.name;
      if (onlyTop && !relative && !topMatches(item.name, onlyTop)) continue;
      if (skipBackupFile(rel, excluded) || item.isSymbolicLink()) continue;
      const full = path.join(current, item.name);
      if (item.isDirectory()) visit(full, rel);
      else if (item.isFile()) out.push({ full, rel: rel.replace(/\\/g, '/') });
    }
  }
  visit(root); return out;
}
function clearManagedScopesSync(scopes) {
  for (const scope of scopes) for (const file of walkManagedSync(scope.root, scope.excludeTop, scope.onlyTop)) {
    try { fs.rmSync(file.full, { force: true }); } catch (_) {}
  }
}
function restoreRollbackSync(txRoot, baseScopes) {
  const rollbackRoot = path.join(txRoot, 'rollback');
  const manifest = JSON.parse(fs.readFileSync(path.join(rollbackRoot, 'manifest.json'), 'utf8'));
  const scopes = touchedScopesFromManifest(manifest, baseScopes);
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
    warnings.push('Parolalar, oturumlar ve API kimlik bilgileri güvenlik nedeniyle restore edilmez.');
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
      // Seçmeli restore listesi arşivin kendi içeriğinden üretilir; yeni bir
      // özelliğin veri dosyası otomatik olarak seçilebilir bileşen olur.
      components: componentsFromManifest(info.manifest, scopes),
      componentCategories: COMPONENT_CATEGORIES,
      heavyAssetsExcluded: Boolean(info.manifest.heavy_assets_excluded),
      excludedAssets: info.manifest.excluded_assets || null,
      autoBackup: Boolean(info.manifest.auto_backup),
    };
    if (info.manifest.heavy_assets_excluded) warnings.push('Bu yedek model dosyalarını, görselleri, PDF ve arşiv dosyalarını içermez; bu dosyaların mevcut halleri restore sırasında korunur.');
    // Keep the verified central-directory records for the same-process start
    // phase without serializing hundreds of thousands of records to the UI.
    Object.defineProperty(result, 'records', { value: info.records, enumerable: false });
    Object.defineProperty(result, 'manifest', { value: info.manifest, enumerable: false });
    return result;
  }

  async function validateStaged(stageRoot, manifest, plan = null) {
    validateManifestContents(scopes, manifest);
    const names = new Set((manifest.contents || []).map(item => item.path));
    const dbArchivePath = names.has('system/local-data/BuyerLogLocal.db') ? 'system/local-data/BuyerLogLocal.db' : (names.has('system/local/BuyerLogLocal.db') ? 'system/local/BuyerLogLocal.db' : null);
    const wants = id => !plan || plan.mode === 'mirror' || plan.selected.has(id);
    const dbSelected = wants('localData/BuyerLogLocal.db');
    if (!dbArchivePath && dbSelected) throw restoreError('RESTORE_DATABASE_MISSING', 'Full System Backup içinde BuyerLogLocal.db bulunamadı.');
    if (dbArchivePath && dbSelected) await validateStagedDb(stagePath(stageRoot, dbArchivePath));
    const configFile = stagePath(stageRoot, 'system/config/config.json');
    const securityFilePath = stagePath(stageRoot, 'system/security/users-roles-permissions.json');
    const syncFilePath = stagePath(stageRoot, 'system/sync/metadata.json');
    const settingsFilePath = stagePath(stageRoot, 'system/server-data/settings.json');
    const configSnapshot = wants('config') && fs.existsSync(configFile) ? safeJsonRead(configFile, 'RESTORE_CONFIG_INVALID', 'Backup config.json okunamadı.') : null;
    const securitySnapshot = wants('security') && fs.existsSync(securityFilePath) ? safeJsonRead(securityFilePath, 'RESTORE_SECURITY_SNAPSHOT_INVALID', 'Backup kullanıcı/rol/yetki snapshotı okunamadı.') : null;
    const syncSnapshot = wants('sync') && fs.existsSync(syncFilePath) ? safeJsonRead(syncFilePath, 'RESTORE_SYNC_METADATA_INVALID', 'Backup Sync metadata okunamadı.') : null;
    const settingsSelected = wants('serverData/settings.json');
    const settingsSnapshot = settingsSelected && fs.existsSync(settingsFilePath) ? safeJsonRead(settingsFilePath, 'RESTORE_SETTINGS_INVALID', 'Backup settings.json okunamadı.') : null;
    return {
      dbArchivePath, dbSelected: Boolean(dbArchivePath && dbSelected), configSnapshot: configSnapshot || (plan && plan.mode === 'selective' ? null : {}), securitySnapshot, syncSnapshot,
      checkConnections: settingsSelected, modelConnections: modelConnectionsFrom(settingsSnapshot),
    };
  }

  async function validateStagedDb(stagedDb) {
    let rawDb;
    try { rawDb = JSON.parse(await fsp.readFile(stagedDb, 'utf8')); }
    catch (error) { throw restoreError('RESTORE_DATABASE_CORRUPT', `BuyerLogLocal.db okunamadı: ${error.message}`); }
    if (Number(rawDb && rawDb.schemaVersion) > LOCAL_DB_SCHEMA_VERSION) throw restoreError('RESTORE_DATABASE_NEWER_SCHEMA', `Backup DB schema sürümü (${rawDb.schemaVersion}) bu Buyer Log sürümünden daha yeni (${LOCAL_DB_SCHEMA_VERSION}).`, 409);
    try {
      const stagedLocalDb = createLocalDb(stagedDb);
      const state = await stagedLocalDb.read();
      if (!state || typeof state !== 'object' || !state.records || !state.deviceId) throw new Error('DB envelope eksik.');
    } catch (error) { throw restoreError('RESTORE_DATABASE_CORRUPT', `BuyerLogLocal.db bütünlük kontrolü başarısız: ${error.message}`); }
  }

  async function applyStaged(stageRoot, manifest, validation, progress, plan) {
    const contents = (manifest.contents || []).filter(item => planIncludes(plan, String(item && item.path || ''), scopes));
    report(progress, { phase: 'Uygulanıyor', current: 0, total: contents.length, item: 'Mevcut veri alanları hazırlanıyor' });
    await clearManagedScopes(plan.touched);
    let applied = 0;
    for (const item of contents) {
      const archivePath = String(item.path || '');
      if (archivePath === 'system/config/config.json' || archivePath === 'system/security/users-roles-permissions.json' || archivePath === 'system/sync/metadata.json') continue;
      let scope = findScope(scopes, archivePath), rel = scope && relativeForScope(scope, archivePath);
      if (!scope && archivePath === 'system/local/BuyerLogLocal.db') { scope = scopes.find(item => item.id === 'localData'); rel = 'BuyerLogLocal.db'; }
      if (!scope || !rel) throw restoreError('RESTORE_UNHANDLED_CONTENT', `Restore kapsamı tanımlı olmayan içerik: ${archivePath}`, 409, { paths: [archivePath] });
      const source = stagePath(stageRoot, archivePath), target = path.join(scope.root, ...rel.split('/'));
      if (!ensureInside(scope.root, target)) throw restoreError('RESTORE_UNSAFE_PATH', `Restore hedefi veri alanı dışına çıkıyor: ${archivePath}`);
      await copyFileDurable(source, target); applied += 1;
      report(progress, { phase: 'Uygulanıyor', current: applied, total: contents.length, item: archivePath });
    }
    let masterRecovery = { promoted:0, ids:[], coverage:null };
    if (validation.dbSelected && localDb && typeof localDb.read === 'function' && typeof localDb.transaction === 'function') {
      if (typeof localDb.setFolder === 'function') localDb.setFolder(path.dirname(roots.localDbFile));
      const restoredState = await localDb.read();
      const recoveredRecords = prewipeMasterRecovery.loadMasterRecordsFromFullSystemRoots(roots, restoredState);
      const ids = prewipeMasterRecovery.masterRecoveryIds(recoveredRecords, restoredState.records);
      if (ids.length) {
        await localDb.transaction(async next => {
          next.records = next.records && typeof next.records === 'object' ? next.records : {};
          next.tombstones = next.tombstones && typeof next.tombstones === 'object' ? next.tombstones : {};
          for (const id of ids) {
            next.records[id] = clone(recoveredRecords[id]);
            delete next.tombstones[id];
          }
          return { promoted:ids.length };
        });
      }
      const after = ids.length ? await localDb.read() : restoredState;
      masterRecovery = {
        promoted:ids.length,
        ids,
        coverage:prewipeMasterRecovery.masterCoverage(after.records),
      };
    }
    if (validation.configSnapshot) {
      let currentConfig = {};
      try { currentConfig = JSON.parse(await fsp.readFile(roots.configPath, 'utf8')); } catch (_) {}
      await atomicWriteJson(roots.configPath, mergePortableConfig(currentConfig, validation.configSnapshot));
    }
    // Central IAM restore, backup'taki taşınabilir shared root üzerinden remote
    // dizini deneyebilsin diye Sync metadata güvenlik snapshotından ÖNCE uygulanır.
    const sync = validation.syncSnapshot && syncSettings && typeof syncSettings.restoreMetadata === 'function'
      ? await syncSettings.restoreMetadata(validation.syncSnapshot)
      : { requiresSharedSyncSetup: false, previousSharedSyncRoot: '' };
    const security = validation.securitySnapshot && userAccess && typeof userAccess.restoreBackupSnapshot === 'function'
      ? await userAccess.restoreBackupSnapshot(validation.securitySnapshot, { centralIamExpected: validation.configSnapshot && validation.configSnapshot.centralIamEnabled === true })
      : { applied: false, restoredUsers: 0, credentialsRequired: 0 };
    return { appliedFiles: applied, security, sync, masterRecovery, mode: plan.mode, components: [...plan.selected] };
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
    if (validation && validation.checkConnections === false) {
      return { checks, users, connections: { configurationRestored: null, skipped: true, roles: {}, modelConnections: [], health: {} }, dbRevision: Number(state.revision) || 0, dbSchemaVersion: Number(state.schemaVersion) || LOCAL_DB_SCHEMA_VERSION };
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

  async function restore(file, { actor, onProgress = null, shouldCancel = null, createSafetyBackup = true, preflight = null, components = null } = {}) {
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
      const plan = buildRestorePlan(scopes, extracted.manifest, components);
      const validation = await validateStaged(stageRoot, extracted.manifest, plan);
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
      await snapshotRollback(txRoot, plan.touched, specialFiles);
      await writeJournal(txRoot, { ...journalBase, status: 'rollback_ready', safetyBackup: safetyArchive ? safetyArchive.filename : null });
      if (typeof shouldCancel === 'function' && shouldCancel()) throw restoreError('RESTORE_CANCELLED', 'Restore kullanıcı tarafından iptal edildi.', 409);

      commitStarted = true;
      await writeJournal(txRoot, { ...journalBase, status: 'committing', safetyBackup: safetyArchive ? safetyArchive.filename : null });
      if (typeof onCommitState === 'function') onCommitState(true, restoreId);
      const applied = await applyStaged(stageRoot, extracted.manifest, validation, onProgress, plan);
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
  buildRestorePlan,
};
