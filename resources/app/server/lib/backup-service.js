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
  SERVER_DATA_ROOT, APP_DATA_ROOT, LOCAL_DATA_ROOT, LOCAL_DB_FILE, MODEL_FILES_ROOT,
  COLLECTION_IMAGES_ROOT, QTX_FILES_ROOT, CONFIG_PATH,
} = require('../user-data');

const SENSITIVE_KEY = /(?:password|pinHash|secret|token|session|cookie|credential|clientSecret|privateKey|loginFailures?|lockUntil)/i;
const SENSITIVE_FILE = /(?:password|secret|token|session|cookie|credential|agent-ai-settings|agent-browser-settings|browser-debug-settings|browser-profiles|outlook-setup-settings|sync-settings|user-audit)/i;

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
function skipBackupFile(rel, topExcludes) {
  const normalized = String(rel || '').replace(/\\/g, '/'), parts = normalized.split('/');
  if (!normalized || topExcludes.has(parts[0])) return true;
  if (parts.some(part => /^(?:auth|cache|caches|temp|tmp|logs?|sessions?)$/i.test(part))) return true;
  if (/(?:^|\/)\.env(?:\.|$)/i.test(normalized) || /\.(?:pem|key|pfx|p12|tmp|lock|write-lock)$/i.test(normalized) || /(?:^|\/)user-access\.json$/i.test(normalized) || SENSITIVE_FILE.test(normalized)) return true;
  return false;
}
async function collectRoot(entries, root, prefix, excludeTop = []) {
  if (!root || !fs.existsSync(root)) return;
  const excluded = new Set(excludeTop);
  async function visit(current, relative = '') {
    let dir;
    try { dir = await fsp.opendir(current); } catch (_) { return; }
    for await (const item of dir) {
      const rel = relative ? `${relative}/${item.name}` : item.name;
      if (skipBackupFile(rel, excluded) || item.isSymbolicLink()) continue;
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
async function userEntries({ user, browserStorage, accessSnapshot }) {
  const id = safeId(user.id), entries = [
    jsonEntry('user/profile.json', userProfile(accessSnapshot, user.id), 'data'),
    jsonEntry('user/preferences.json', userPreferences.load(user.id), 'settings'),
    jsonEntry('user/browser-storage.json', sanitizeBrowserStorage(browserStorage, user.id), 'settings'),
    jsonEntry('user/collection-workspace.json', collectionWorkspaces.loadWorkspace(user.id), 'data'),
    jsonEntry('user/views.json', db.loadViews(user.id), 'settings'),
    jsonEntry('user/filters.json', db.loadFilterProfiles(user.id), 'settings'),
    jsonEntry('user/shipping.json', db.loadShipping(user.id), 'data'),
    jsonEntry('user/fx.json', db.loadFx(user.id), 'data'),
    jsonEntry('user/refresh-history.json', db.loadRefreshHistory(user.id), 'data'),
  ];
  await collectRoot(entries, path.join(SERVER_DATA_ROOT, 'user-source-data', id), 'user/source-data');
  await collectRoot(entries, path.join(APP_DATA_ROOT, 'user-source-data', id), 'user/local-source-data');
  return entries;
}
async function fullEntries({ accessSnapshot, syncSettings, localDbFile }) {
  const entries = [];
  await collectRoot(entries, SERVER_DATA_ROOT, 'system/server-data', ['logs', 'email-drafts']);
  await collectRoot(entries, APP_DATA_ROOT, 'system/app-data', ['auth', 'logs', 'email-drafts', 'model-files', 'collection-images']);
  await collectRoot(entries, LOCAL_DATA_ROOT, 'system/local-data', ['logs', 'model-files', 'collection-images', 'qtx-files', 'page-cache', 'model-snapshots', 'oab-snapshots']);
  await collectRoot(entries, MODEL_FILES_ROOT, 'system/model-files');
  await collectRoot(entries, COLLECTION_IMAGES_ROOT, 'system/collection-images');
  await collectRoot(entries, QTX_FILES_ROOT, 'system/qtx-files');
  if (localDbFile && fs.existsSync(localDbFile) && !entries.some(item => path.resolve(item.sourcePath || '') === path.resolve(localDbFile))) entries.push({ name: 'system/local/BuyerLogLocal.db', sourcePath: localDbFile, stage: 'data' });
  let config = {};
  try { config = JSON.parse(await fsp.readFile(CONFIG_PATH, 'utf8')); } catch (_) {}
  entries.push(jsonEntry('system/config/config.json', config));
  entries.push(jsonEntry('system/security/users-roles-permissions.json', accessSnapshot, 'settings'));
  entries.push(jsonEntry('system/sync/metadata.json', syncSettings || {}, 'settings'));
  return entries;
}
function createBackupService({ appVersion, userAccess, syncSettings, localDb }) {
  async function create({ mode = 'user', user, browserStorage = {}, onProgress = null }) {
    const current = user || {}, full = mode === 'full';
    if (full && current.systemRole !== 'moderator') throw Object.assign(new Error('Tam Sistem Yedeği yalnız moderatör tarafından oluşturulabilir.'), { statusCode: 403, code: 'MODERATOR_REQUIRED' });
    const accessSnapshot = userAccess.backupSnapshot();
    const syncSnapshot = full ? await syncSettings.read() : null;
    const entries = full ? await fullEntries({ accessSnapshot, syncSettings: syncSnapshot, localDbFile: localDb && (localDb.getFile ? localDb.getFile() : localDb.file) }) : await userEntries({ user: current, browserStorage, accessSnapshot });
    const stamp = dateStamp(), filename = full ? `BuyerLog_FullBackup_${stamp}.zip` : `BuyerLog_Backup_${safeId(current.username || current.displayName || current.id)}_${stamp}.zip`;
    return createBackupArchive({
      entries, filename, onProgress,
      manifest: {
        app_version: String(appVersion || ''), created_at: new Date().toISOString(), backup_type: full ? 'full' : 'user',
        user: sanitize({ id: current.id, username: current.username, displayName: current.displayName, systemRole: current.systemRole }),
        device: { hostname: os.hostname(), platform: process.platform, arch: process.arch },
      },
    });
  }
  return { create, sanitizeBrowserStorage };
}

module.exports = { createBackupService, sanitize, sanitizeBrowserStorage, dateStamp, safeId, skipBackupFile };
