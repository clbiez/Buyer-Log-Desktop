'use strict';

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const os = require('os');
const { inspectBackupArchive, extractBackupArchive } = require('./backup-archive');
const { safeId } = require('./backup-service');
const userPreferences = require('./user-preferences');
const collectionWorkspaces = require('./collection-workspaces');
const db = require('../db');
const { SERVER_DATA_ROOT, APP_DATA_ROOT } = require('../user-data');

const REQUIRED_JSON = Object.freeze([
  'user/preferences.json',
  'user/browser-storage.json',
  'user/collection-workspace.json',
  'user/views.json',
  'user/filters.json',
  'user/shipping.json',
  'user/refresh-history.json',
]);
const MAX_JSON_BYTES = 256 * 1024 * 1024;

function restoreError(code, message, statusCode = 400, details = null) {
  return Object.assign(new Error(message), { code, statusCode, details });
}
function clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }
function archivePaths(info) {
  return new Set((info && info.manifest && Array.isArray(info.manifest.contents) ? info.manifest.contents : []).map(item => String(item && item.path || '')));
}
function userSourceRoots(userId) {
  const id = safeId(userId);
  return {
    sourceData: path.join(SERVER_DATA_ROOT, 'user-source-data', id),
    localSourceData: path.join(APP_DATA_ROOT, 'user-source-data', id),
  };
}
async function copyTree(source, target) {
  if (!source || !fs.existsSync(source)) return;
  await fsp.mkdir(target, { recursive: true });
  const dir = await fsp.opendir(source);
  for await (const entry of dir) {
    if (entry.isSymbolicLink()) continue;
    const from = path.join(source, entry.name), to = path.join(target, entry.name);
    if (entry.isDirectory()) await copyTree(from, to);
    else if (entry.isFile()) { await fsp.mkdir(path.dirname(to), { recursive: true }); await fsp.copyFile(from, to); }
  }
}
async function replaceTree(source, target) {
  await fsp.rm(target, { recursive: true, force: true });
  if (source && fs.existsSync(source)) await copyTree(source, target);
}
async function readJsonFile(file, label) {
  let stat;
  try { stat = await fsp.stat(file); } catch (_) { throw restoreError('USER_RESTORE_MISSING_CONTENT', 'Backup içinde ' + label + ' bulunamadı.'); }
  if (stat.size > MAX_JSON_BYTES) throw restoreError('USER_RESTORE_JSON_TOO_LARGE', 'Backup içindeki ' + label + ' güvenli boyut sınırını aşıyor.', 413);
  try { return JSON.parse(await fsp.readFile(file, 'utf8')); }
  catch (_) { throw restoreError('USER_RESTORE_JSON_INVALID', 'Backup içindeki ' + label + ' okunamadı.'); }
}

function publicInspect(info) {
  const manifest = info.manifest || {}, owner = manifest.user || {}, paths = archivePaths(info);
  const warnings = [];
  if (paths.has('user/fx.json')) warnings.push('Eski kişisel backup içindeki FX kaydı ortak veri olduğu için restore edilmeyecek.');
  warnings.push('Koleksiyon satırlarındaki Royalty/Hologram değerleri Collection ile geri gelir; merkezi Royalty kuralları ve E-posta Grupları kişisel backup kapsamı dışındadır ve Shared Hub / Tam Sistem Yedeği üzerinden geri yüklenmelidir.');
  const unknown = [...paths].filter(name => name !== 'user/profile.json'
    && name !== 'user/fx.json'
    && !REQUIRED_JSON.includes(name)
    && !name.startsWith('user/source-data/')
    && !name.startsWith('user/local-source-data/'));
  if (unknown.length) warnings.push('Bu sürümün kişisel restore kapsamı dışında ' + unknown.length + ' kayıt var; uygulanmayacak.');
  return {
    backupType: String(manifest.backup_type || ''),
    appVersion: String(manifest.app_version || ''),
    createdAt: manifest.created_at || null,
    user: { id: String(owner.id || ''), username: String(owner.username || ''), displayName: String(owner.displayName || '') },
    fileCount: Number(info.fileCount) || 0,
    totalBytes: Number(info.totalBytes) || 0,
    warnings,
  };
}

function createUserRestoreService({ restoreCollectionWorkspace = null } = {}) {
  async function inspect(file, user) {
    const current = user || {};
    const info = await inspectBackupArchive(file, { requireType: 'user', validateData: true });
    const owner = info.manifest && info.manifest.user || {};
    if (!current.id || String(owner.id || '') !== String(current.id)) {
      throw restoreError(
        'USER_RESTORE_OWNER_MISMATCH',
        'Bu kişisel backup başka bir Buyer Log kullanıcısına ait.',
        403,
        { backupUserId: String(owner.id || ''), currentUserId: String(current.id || '') },
      );
    }
    const paths = archivePaths(info), missing = REQUIRED_JSON.filter(name => !paths.has(name));
    if (missing.length) throw restoreError('USER_RESTORE_MISSING_CONTENT', 'Kişisel backup eksik: ' + missing.join(', '), 400, { missing });
    return { info, public: publicInspect(info) };
  }

  async function restore(file, { user, preflight = null, onProgress = null } = {}) {
    const currentUser = user || {};
    const checked = preflight && preflight.info ? preflight : await inspect(file, currentUser);
    const info = checked.info;
    const owner = info.manifest && info.manifest.user || {};
    if (!currentUser.id || String(owner.id || '') !== String(currentUser.id)) throw restoreError('USER_RESTORE_OWNER_MISMATCH', 'Bu kişisel backup başka bir kullanıcıya ait.', 403);

    const txRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'buyerlog-user-restore-'));
    const stageRoot = path.join(txRoot, 'stage'), rollbackRoot = path.join(txRoot, 'rollback');
    const roots = userSourceRoots(currentUser.id);
    const report = value => { if (typeof onProgress === 'function') onProgress(value); };

    const customCollectionRestore = typeof restoreCollectionWorkspace === 'function';
    const before = {
      preferences: clone(userPreferences.load(currentUser.id)),
      collection: customCollectionRestore ? null : clone(collectionWorkspaces.loadWorkspace(currentUser.id)),
      stores: clone(db.userBackupStoreSnapshot(currentUser.id)),
    };

    try {
      await fsp.mkdir(rollbackRoot, { recursive: true });
      await copyTree(roots.sourceData, path.join(rollbackRoot, 'source-data'));
      await copyTree(roots.localSourceData, path.join(rollbackRoot, 'local-source-data'));

      await extractBackupArchive(file, stageRoot, {
        preflight: info,
        requireType: 'user',
        onProgress: progress => report({ ...progress, phase: 'Açılıyor' }),
      });

      const read = name => readJsonFile(path.join(stageRoot, ...name.split('/')), name);
      const incoming = {
        preferences: await read('user/preferences.json'),
        browserStorage: await read('user/browser-storage.json'),
        collection: await read('user/collection-workspace.json'),
        views: await read('user/views.json'),
        filters: await read('user/filters.json'),
        shipping: await read('user/shipping.json'),
        refreshHistory: await read('user/refresh-history.json'),
      };

      report({ phase: 'Uygulanıyor', current: 0, total: 5, item: 'preferences' });
      userPreferences.restoreSnapshot(currentUser.id, incoming.preferences);

      report({ phase: 'Uygulanıyor', current: 1, total: 5, item: 'user-stores' });
      db.restoreUserBackupStores(currentUser.id, {
        views: incoming.views,
        filters: incoming.filters,
        shipping: incoming.shipping,
        refreshHistory: incoming.refreshHistory,
      });

      report({ phase: 'Uygulanıyor', current: 2, total: 5, item: 'source-data' });
      await replaceTree(path.join(stageRoot, 'user', 'source-data'), roots.sourceData);
      await replaceTree(path.join(stageRoot, 'user', 'local-source-data'), roots.localSourceData);

      // Collection EN SON uygulanır. Shared Collection aktifse çağıran merge
      // yapar; böylece eski kişisel backup shared-collection yerine görünmez
      // owner workspace'ine yazılmaz ve diğer kullanıcıların satırları silinmez.
      report({ phase: 'Uygulanıyor', current: 4, total: 5, item: 'collection-workspace' });
      let collectionRestore;
      if (customCollectionRestore) {
        collectionRestore = await restoreCollectionWorkspace(currentUser, incoming.collection);
      } else {
        const currentWorkspace = collectionWorkspaces.loadWorkspace(currentUser.id);
        const workspace = collectionWorkspaces.saveWorkspace(currentUser.id, incoming.collection, currentWorkspace._revision);
        collectionRestore = { shared:false, ownerId:currentUser.id, incomingRows:Array.isArray(incoming.collection && incoming.collection.rows) ? incoming.collection.rows.length : 0, totalRows:workspace.rows.length };
      }

      report({ phase: 'Tamamlandı', current: 5, total: 5, item: '' });
      return {
        ok: true,
        browserStorage: incoming.browserStorage && typeof incoming.browserStorage === 'object' ? incoming.browserStorage : {},
        sourceAppVersion: String(info.manifest && info.manifest.app_version || ''),
        createdAt: info.manifest && info.manifest.created_at || null,
        collectionRestore,
        warnings: publicInspect(info).warnings,
      };
    } catch (error) {
      try {
        userPreferences.restoreSnapshot(currentUser.id, before.preferences);
        if (!customCollectionRestore) {
          const workspace = collectionWorkspaces.loadWorkspace(currentUser.id);
          collectionWorkspaces.saveWorkspace(currentUser.id, before.collection, workspace._revision);
        }
        db.restoreUserBackupStores(currentUser.id, before.stores);
        await replaceTree(path.join(rollbackRoot, 'source-data'), roots.sourceData);
        await replaceTree(path.join(rollbackRoot, 'local-source-data'), roots.localSourceData);
      } catch (rollbackError) {
        error.rollbackError = rollbackError && rollbackError.message || String(rollbackError);
      }
      throw error;
    } finally {
      await fsp.rm(txRoot, { recursive: true, force: true }).catch(() => {});
    }
  }

  return { inspect, restore };
}

module.exports = { createUserRestoreService, REQUIRED_JSON, publicInspect, userSourceRoots };
