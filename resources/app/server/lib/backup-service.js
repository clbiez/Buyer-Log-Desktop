'use strict';

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const os = require('os');
const db = require('../db');
const userPreferences = require('./user-preferences');
const collectionWorkspaces = require('./collection-workspaces');
const { createBackupArchive } = require('./backup-archive');
const {
  SERVER_DATA_ROOT, APP_DATA_ROOT, LOCAL_DATA_ROOT, QTX_FILES_ROOT, CONFIG_PATH,
} = require('../user-data');

const { SENSITIVE_KEY } = require('./backup-sensitivity');
const { skipBackupFile, isHeavyBackupPath, BACKUP_EXCLUDED_TOP, HEAVY_ASSET_DIRS } = require('./backup-scope');

const USER_BACKUP_COMPONENTS = Object.freeze([
  { id: 'preferences', labelTr: 'Arayüz ve kullanıcı tercihleri', labelEn: 'Interface & user preferences', paths: ['user/preferences.json', 'user/browser-storage.json'] },
  { id: 'collection', labelTr: 'Collection', labelEn: 'Collection', paths: ['user/collection-workspace.json'] },
  { id: 'views-filters', labelTr: 'Görünümler ve filtreler', labelEn: 'Views & filters', paths: ['user/views.json', 'user/filters.json'] },
  { id: 'shipping', labelTr: 'Shipping Comparison', labelEn: 'Shipping Comparison', paths: ['user/shipping.json'] },
  { id: 'refresh-history', labelTr: 'Yenileme geçmişi', labelEn: 'Refresh history', paths: ['user/refresh-history.json'] },
  { id: 'source-data', labelTr: 'Kişisel kaynak dosyaları', labelEn: 'Personal source data', prefixes: ['user/source-data/', 'user/local-source-data/'] },
  { id: 'cp-exfactory', labelTr: 'CP Tracker · Ex-Factory revizyonları', labelEn: 'CP Tracker · Ex-Factory revisions', paths: ['user/cp-ex-factory-revisions.json'], shared: true, moderatorOnly: true },
]);
const DEFAULT_USER_BACKUP_COMPONENTS = Object.freeze(USER_BACKUP_COMPONENTS.filter(item => !item.shared).map(item => item.id));

function normalizeUserBackupSelection(selection, { allowShared = false } = {}) {
  const source = Array.isArray(selection) ? selection : DEFAULT_USER_BACKUP_COMPONENTS;
  const known = new Map(USER_BACKUP_COMPONENTS.map(item => [item.id, item]));
  const normalized = [];
  for (const raw of source) {
    const id = String(raw || '').trim();
    if (!id || normalized.includes(id)) continue;
    const component = known.get(id);
    if (!component) throw Object.assign(new Error('Bilinmeyen backup kapsamı: ' + id), { statusCode: 400, code: 'BACKUP_SCOPE_INVALID' });
    if ((component.shared || component.moderatorOnly) && !allowShared) {
      throw Object.assign(new Error(component.labelTr + ' yalnız moderatör tarafından yedeklenebilir.'), { statusCode: 403, code: 'BACKUP_SCOPE_FORBIDDEN' });
    }
    normalized.push(id);
  }
  if (!normalized.length) throw Object.assign(new Error('Backup için en az bir veri alanı seçin.'), { statusCode: 400, code: 'BACKUP_SCOPE_EMPTY' });
  return normalized;
}

function safeId(value) { return String(value || 'user').replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 80) || 'user'; }
function dateStamp(value = new Date()) {
  const pad = n => String(n).padStart(2, '0');
  return `${value.getFullYear()}${pad(value.getMonth()+1)}${pad(value.getDate())}-${pad(value.getHours())}${pad(value.getMinutes())}`;
}
function sanitize(value) {
  if (Array.isArray(value)) return value.map(sanitize);
  if (!value || typeof value !== 'object') return value;
  const out = {};
  for (const [key, item] of Object.entries(value)) if (!SENSITIVE_KEY.test(key)) out[key] = sanitize(item);
  return out;
}
function jsonEntry(name, value, stage = 'settings') {
  return { name, stage, buffer: Buffer.from(JSON.stringify(sanitize(value), null, 2), 'utf8') };
}
function sanitizeBrowserStorage(storage, userId) {
  const out = {}, prefix = `bl.user.${safeId(userId)}.`;
  for (const [key, value] of Object.entries(storage && typeof storage === 'object' ? storage : {})) {
    if (!String(key).startsWith(prefix) || SENSITIVE_KEY.test(key)) continue;
    const text = String(value == null ? '' : value);
    try { out[String(key)] = JSON.stringify(sanitize(JSON.parse(text))); }
    catch (_) { out[String(key)] = text; }
  }
  return out;
}
async function measureSkipped(dirPath, skipped) {
  let dir;
  try { dir = await fsp.opendir(dirPath); } catch (_) { return; }
  for await (const item of dir) {
    const full = path.join(dirPath, item.name);
    if (item.isDirectory()) await measureSkipped(full, skipped);
    else if (item.isFile()) { skipped.count += 1; try { skipped.bytes += (await fsp.stat(full)).size; } catch (_) {} }
  }
}
// skipped: { count, bytes } — model/görsel gibi bilerek dışarıda bırakılan
// büyük varlıkları manifest'e raporlamak için.
async function collectRoot(entries, root, prefix, excludeTop = [], skipped = null) {
  if (!root || !fs.existsSync(root)) return;
  const excluded = new Set(excludeTop);
  async function visit(current, relative = '') {
    let dir;
    try { dir = await fsp.opendir(current); } catch (_) { return; }
    for await (const item of dir) {
      const rel = relative ? `${relative}/${item.name}` : item.name;
      if (item.isSymbolicLink()) continue;
      if (skipBackupFile(rel, excluded)) {
        if (skipped && item.isDirectory() && !relative && HEAVY_ASSET_DIRS.includes(item.name)) await measureSkipped(path.join(current, item.name), skipped);
        else if (skipped && item.isFile() && isHeavyBackupPath(rel)) {
          skipped.count += 1;
          try { skipped.bytes += (await fsp.stat(path.join(current, item.name))).size; } catch (_) {}
        }
        continue;
      }
      const full = path.join(current, item.name);
      if (item.isDirectory()) await visit(full, rel);
      else if (item.isFile()) entries.push({ name: `${prefix}/${rel.replace(/\\/g, '/')}`, sourcePath: full, stage: 'data' });
    }
  }
  await visit(root);
}
function userProfile(snapshot, userId) {
  const all = [snapshot && snapshot.moderator, ...(Array.isArray(snapshot && snapshot.users) ? snapshot.users : [])].filter(Boolean);
  return all.find(item => String(item.id) === String(userId)) || { id: String(userId || '') };
}
async function userEntries({ user, browserStorage, accessSnapshot, components, skipped = null }) {
  const id = safeId(user.id), selected = new Set(components), entries = [
    // profile.json backup sahibini doğrulamak için her zaman bulunur; restore
    // kapsamında seçilebilir bir sayfa verisi değildir.
    jsonEntry('user/profile.json', userProfile(accessSnapshot, user.id), 'data'),
  ];
  if (selected.has('preferences')) {
    entries.push(jsonEntry('user/preferences.json', userPreferences.load(user.id), 'settings'));
    entries.push(jsonEntry('user/browser-storage.json', sanitizeBrowserStorage(browserStorage, user.id), 'settings'));
  }
  if (selected.has('collection')) entries.push(jsonEntry('user/collection-workspace.json', collectionWorkspaces.loadWorkspace(user.id), 'data'));
  if (selected.has('views-filters')) {
    entries.push(jsonEntry('user/views.json', db.loadViews(user.id), 'settings'));
    entries.push(jsonEntry('user/filters.json', db.loadFilterProfiles(user.id), 'settings'));
  }
  if (selected.has('shipping')) entries.push(jsonEntry('user/shipping.json', db.loadShipping(user.id), 'data'));
  // FX ortak iş verisidir; kişisel backup kullanıcının verisini geri yüklerken
  // bütün kullanıcıların kur tablosunu değiştirmemelidir.
  if (selected.has('refresh-history')) entries.push(jsonEntry('user/refresh-history.json', db.loadRefreshHistory(user.id), 'data'));
  if (selected.has('source-data')) {
    await collectRoot(entries, path.join(SERVER_DATA_ROOT, 'user-source-data', id), 'user/source-data', [], skipped);
    await collectRoot(entries, path.join(APP_DATA_ROOT, 'user-source-data', id), 'user/local-source-data', [], skipped);
  }
  if (selected.has('cp-exfactory')) entries.push(jsonEntry('user/cp-ex-factory-revisions.json', db.cpExFactoryRevisionSnapshot(), 'data'));
  return entries;
}
// Tam sistem yedeğinin kök tanımları full-restore-service scopeDefinitions ile
// aynı excludeTop listesini kullanır; yedeğe girmeyen hiçbir dosya restore
// sırasında silinmez. Model dosyaları ve görsel depoları artık yedeğe girmez.
function fullBackupRoots() {
  return [
    { root: SERVER_DATA_ROOT, prefix: 'system/server-data', excludeTop: BACKUP_EXCLUDED_TOP },
    { root: APP_DATA_ROOT, prefix: 'system/app-data', excludeTop: BACKUP_EXCLUDED_TOP },
    { root: LOCAL_DATA_ROOT, prefix: 'system/local-data', excludeTop: [...BACKUP_EXCLUDED_TOP, 'qtx-files'] },
    { root: QTX_FILES_ROOT, prefix: 'system/qtx-files', excludeTop: [] },
  ];
}
async function fullEntries({ accessSnapshot, syncSettings, localDbFile, skipped = null }) {
  const entries = [];
  for (const item of fullBackupRoots()) await collectRoot(entries, item.root, item.prefix, item.excludeTop, skipped);
  if (localDbFile && fs.existsSync(localDbFile) && !entries.some(item => path.resolve(item.sourcePath || '') === path.resolve(localDbFile))) entries.push({ name: 'system/local/BuyerLogLocal.db', sourcePath: localDbFile, stage: 'data' });
  let config = {};
  try { config = JSON.parse(await fsp.readFile(CONFIG_PATH, 'utf8')); } catch (_) {}
  entries.push(jsonEntry('system/config/config.json', config));
  entries.push(jsonEntry('system/security/users-roles-permissions.json', accessSnapshot, 'settings'));
  entries.push(jsonEntry('system/sync/metadata.json', syncSettings || {}, 'settings'));
  return entries;
}
function createBackupService({ appVersion, userAccess, syncSettings, localDb }) {
  // trusted: yalnız sunucu içi zamanlanmış otomatik yedek kullanır (HTTP
  // isteğinden asla gelmez); kullanıcı oturumu olmadan tam sistem yedeği alır.
  async function create({ mode = 'user', user, browserStorage = {}, components = null, onProgress = null, trusted = false, auto = false, filename: requestedFilename = '' }) {
    const current = user || {}, full = mode === 'full';
    if (full && !trusted && current.systemRole !== 'moderator') throw Object.assign(new Error('Tam Sistem Yedeği yalnız moderatör tarafından oluşturulabilir.'), { statusCode: 403, code: 'MODERATOR_REQUIRED' });
    const accessSnapshot = userAccess.backupSnapshot();
    const syncSnapshot = full ? await syncSettings.read() : null;
    const selectedComponents = full ? ['full-system'] : normalizeUserBackupSelection(components, { allowShared: current.systemRole === 'moderator' });
    const skipped = { count: 0, bytes: 0 };
    const entries = full
      ? await fullEntries({ accessSnapshot, syncSettings: syncSnapshot, localDbFile: localDb && (localDb.getFile ? localDb.getFile() : localDb.file), skipped })
      : await userEntries({ user: current, browserStorage, accessSnapshot, components: selectedComponents, skipped });
    const stamp = dateStamp(), filename = requestedFilename ? requestedFilename : full ? `BuyerLog_FullBackup_${stamp}.zip` : `BuyerLog_Backup_${safeId(current.username || current.displayName || current.id)}_${stamp}.zip`;
    const archive = await createBackupArchive({
      entries, filename, onProgress,
      manifest: {
        app_version: String(appVersion || ''), created_at: new Date().toISOString(), backup_type: full ? 'full' : 'user',
        user: sanitize({ id: current.id, username: current.username, displayName: current.displayName, systemRole: current.systemRole }),
        device: { hostname: os.hostname(), platform: process.platform, arch: process.arch },
        scope_schema: 1, scope_components: selectedComponents,
        // v2 kapsam: model dosyaları/görseller gibi büyük varlıklar bilerek yok.
        heavy_assets_excluded: true, excluded_assets: skipped, auto_backup: Boolean(auto),
      },
    });
    archive.excludedAssets = skipped;
    return archive;
  }
  return { create, sanitizeBrowserStorage };
}

module.exports = { createBackupService, sanitize, sanitizeBrowserStorage, dateStamp, safeId, skipBackupFile, fullBackupRoots, USER_BACKUP_COMPONENTS, DEFAULT_USER_BACKUP_COMPONENTS, normalizeUserBackupSelection };
