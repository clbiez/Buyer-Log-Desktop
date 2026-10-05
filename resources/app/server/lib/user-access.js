'use strict';
const { initials: userInitials } = require('../../public/user-initials.js');

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { PROJECT_ROOT, SERVER_DATA_ROOT, APP_DATA_ROOT, LOCAL_DATA_ROOT, CONFIG_PATH, atomicWriteJson } = require('../user-data');
const { AsyncLocalStorage } = require('node:async_hooks');
const centralIam = require('./central-iam');
const orderAuthorityShare = require('./order-authority-share');
const iam = require('./iam-core');
const userPreferences = require('./user-preferences');
const { createPersonalLoginCache } = require('./personal-login-cache');

// Kullanıcı kimlik bilgileri sürüm klasörünün server/data alanında tutulursa yeni
// Buyer Log ZIP'i ayrı bir klasöre açıldığında eski şifre hash'leri kaybolabiliyor.
// Normal masaüstü kullanımında auth verisini sürümden bağımsız AppData altında tut.
// Test/özel dağıtımlarda BUYER_LOG_SERVER_DATA_ROOT açıkça verilmişse mevcut davranışı
// koruyarak aynı kökü kullan.
const AUTH_DATA_ROOT = process.env.BUYER_LOG_AUTH_DATA_ROOT || (process.env.BUYER_LOG_SERVER_DATA_ROOT ? SERVER_DATA_ROOT : path.join(APP_DATA_ROOT, 'auth'));
const ACCESS_FILE = path.join(AUTH_DATA_ROOT, 'user-access.json');
const AUDIT_FILE = path.join(AUTH_DATA_ROOT, 'user-audit.jsonl');
const LEGACY_ACCESS_FILE = path.join(SERVER_DATA_ROOT, 'user-access.json');
const LEGACY_AUDIT_FILE = path.join(SERVER_DATA_ROOT, 'user-audit.jsonl');
// Bu cihazda giriş yapmış kişilerin yalnız kendi profilleri; merkezi dizin ve
// yerel önbellek ikisi birden yokken son çare giriş kaynağı (personal-login-cache.js).
const personalLogin = createPersonalLoginCache({ file: path.join(AUTH_DATA_ROOT, 'personal-login.json') });
const iamTransaction = new AsyncLocalStorage();
let centralService = null, iamApplied = () => {};
let restoreActive = false;
// Collection erişimi, genel kullanıcı hiyerarşisinden ayrı bir sahip→kullanıcı
// grant deposundan çözülebilir. Sağlayıcı hazır değilken yalnız eski açık
// kayıtlar geçiş kaynağı olarak kullanılır; hazır olduğunda hiyerarşi/rol
// genişletmesi kesinlikle devreye girmez.
let collectionAccessResolver = null;
let centralConfigured = process.env.BUYER_LOG_CENTRAL_IAM_ENABLED === '1';
try {
  const settings = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  if (process.env.BUYER_LOG_CENTRAL_IAM_ENABLED == null) centralConfigured = settings.centralIamEnabled === true;
} catch (_) {}
async function defaultIamSharedRoot() {
  if (process.env.BUYER_LOG_IAM_SHARED_ROOT) return process.env.BUYER_LOG_IAM_SHARED_ROOT;
  const settings = JSON.parse(await fs.promises.readFile(path.join(LOCAL_DATA_ROOT, 'sync-settings.json'), 'utf8'));
  return settings.sharedSyncRoot || settings.sharedSyncFolder || '';
}
let iamSharedRoot = defaultIamSharedRoot;
function getCentralIam() {
  if (!centralConfigured) return null;
  if (!centralService) centralService = centralIam.createCentralIam({ cacheFile: ACCESS_FILE,
    getSharedRoot: defaultIamSharedRoot, onApply: cache => { storeCache = null; reconcilePersonalLogin(cache); iamApplied(cache._revision); }, canApply: () => !restoreActive, canCommit: () => !restoreActive,
  });
  return centralService;
}
function reconcilePersonalLogin(cache) { try { personalLogin.reconcile(cache); } catch (_) {} }
function personalLoginFallbackStore() {
  let saved = [];
  try { saved = personalLogin.profiles(); } catch (_) {}
  if (!saved.length) return null;
  const store = iam.migrateStore({
    schemaVersion: 8, _revision: 0, _personalLoginFallback: true,
    moderator: saved.find(profile => profile.id === 'moderator') || null,
    users: saved.filter(profile => profile.id !== 'moderator'),
    iam: personalLogin.iamState() || undefined, orderAccess: {}, scopeCatalog: {},
  });
  try { const derived = JSON.parse(fs.readFileSync(path.join(AUTH_DATA_ROOT, 'iam-derived.json'), 'utf8')); store.orderAccess = derived.orderAccess || {}; store.scopeCatalog = derived.scopeCatalog || {}; } catch (_) {}
  return store;
}
const COOKIE_NAME = 'bl_user_session';
const SESSION_HOURS = 12;
const LOGIN_FAILURE_LIMIT = 5;
const LOGIN_LOCK_MS = 60 * 1000;
const LOGIN_FAILURE_WINDOW_MS = 5 * 60 * 1000;
const DEFAULT_MODERATOR_NAME = 'Gökberk';
const PASSWORD_MIN_LENGTH = 6;

const ROLE_LEVEL = Object.freeze({ buyer: 1, team_lead: 2, manager: 3, moderator: 4 });
const ROLE_LABELS = Object.freeze({ buyer: 'Buyer', team_lead: 'Ekip Lideri', manager: 'Müdür', moderator: 'Moderatör' });
const PERMISSION_KEYS = Object.freeze([
  'manageBackup', 'manageBusinessRules', 'manageModelConnections', 'manageAllOrders', 'manageCollections',
]);
const ACCESS_AREA_KEYS = Object.freeze([
  'overview', 'cp', 'orders', 'koleksiyon', 'lfl', 'priceanalysis', 'opencosting', 'backlog', 'shipping', 'agents', 'automations', 'source',
]);
const ACCESS_AREA_LABELS = Object.freeze({
  overview: 'Overview', cp: 'CP Tracker', orders: 'Siparişler', koleksiyon: 'Koleksiyon',
  lfl: 'LFL Analizi', priceanalysis: 'Price & Supplier Analysis', opencosting: 'Ön Maliyet', backlog: 'Backlog',
  shipping: 'Nakliye Kıyaslama', agents: 'Agent Workflow Studio', automations: 'Otomasyonlar', source: 'Kaynak Veri',
});
const PUBLIC_ACCESS_AREA_KEYS = Object.freeze(['priceanalysis']);

function readAccessStoreFile(file) {
  try {
    if (!file || !fs.existsSync(file) || !fs.statSync(file).isFile()) return null;
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return parsed && typeof parsed === 'object' && (parsed.moderator || Array.isArray(parsed.users)) ? parsed : null;
  } catch (_) { return null; }
}
function validAccessStoreFile(file) { return Boolean(readAccessStoreFile(file)); }
function accessStoreQuality(file) {
  const parsed = readAccessStoreFile(file); if (!parsed) return null;
  const profiles = [parsed.moderator, ...(Array.isArray(parsed.users) ? parsed.users : [])].filter(Boolean);
  const credentialCount = profiles.filter(profile => clean(profile && (profile.passwordHash || profile.pinHash))).length;
  const enabledCredentialCount = profiles.filter(profile => profile && profile.enabled !== false && clean(profile.passwordHash || profile.pinHash)).length;
  const usernameCount = new Set(profiles.map(profile => usernameKey(profile && (profile.username || profile.displayName))).filter(Boolean)).size;
  let mtime = 0; try { mtime = fs.statSync(file).mtimeMs || 0; } catch (_) {}
  const updatedAt = Date.parse(parsed._updatedAt || '') || 0;
  return { file, parsed, credentialCount, enabledCredentialCount, usernameCount, userCount: profiles.length, revision: Number(parsed._revision) || 0, timestamp: Math.max(mtime, updatedAt) };
}
function compareAccessStoreQuality(a, b) {
  // Şifreli ve aktif kullanıcı bilgisi, yalnız dosyanın daha yeni olmasından daha
  // değerlidir. v5.58 sonrası yeni klasörlerin oluşturduğu boş/taze auth dosyaları
  // böylece eski fakat gerçek kullanıcı şifrelerinin önüne geçemez.
  for (const key of ['enabledCredentialCount', 'credentialCount', 'revision', 'usernameCount', 'userCount', 'timestamp']) {
    const diff = Number(b && b[key] || 0) - Number(a && a[key] || 0);
    if (diff) return diff;
  }
  return 0;
}
function legacyAccessCandidates() {
  const out = new Set();
  const add = file => {
    if (!file) return;
    try { out.add(path.resolve(file)); } catch (_) {}
  };
  const addStore = file => { add(file); add(file + '.bak'); };
  const addJsonDirectory = (dir, limit = 200) => {
    try {
      for (const entry of fs.readdirSync(dir, { withFileTypes:true }).slice(0, limit)) {
        if (!entry.isFile() || !/\.json(?:\..+)?$/i.test(entry.name)) continue;
        add(path.join(dir, entry.name));
      }
    } catch (_) {}
  };
  const scanUserAccessTree = (root, options = {}) => {
    const maxDepth = Number.isInteger(options.maxDepth) ? options.maxDepth : 7;
    const maxEntries = Number.isInteger(options.maxEntries) ? options.maxEntries : 1800;
    let seenEntries = 0;
    const skipDirs = new Set(['node_modules','Cache','Code Cache','GPUCache','Service Worker','temp','logs','runtime','write-recovery']);
    function walk(dir, depth) {
      if (depth > maxDepth || seenEntries >= maxEntries) return;
      let entries = [];
      try { entries = fs.readdirSync(dir, { withFileTypes:true }); } catch (_) { return; }
      for (const entry of entries) {
        if (++seenEntries > maxEntries) return;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (skipDirs.has(entry.name)) continue;
          walk(full, depth + 1);
          continue;
        }
        if (!entry.isFile()) continue;
        // Covers canonical, .bak/pre-migration and recovery copies such as
        // selected-<stamp>-user-access.json without considering unrelated JSON.
        if (/user-access[^\\/]*\.json(?:\..+)?$/i.test(entry.name) || /^user-access\.json(?:\..+)?$/i.test(entry.name)) add(full);
      }
    }
    try { if (fs.statSync(root).isDirectory()) walk(root, 0); } catch (_) {}
  };
  const addKnownInstallLayout = installRoot => {
    if (!installRoot) return;
    const root = path.resolve(installRoot);
    for (const file of [
      path.join(root, 'data', 'app', 'auth', 'user-access.json'),
      path.join(root, 'data', 'auth', 'user-access.json'),
      path.join(root, 'data', 'server', 'user-access.json'),
      path.join(root, 'data', 'server', 'data', 'user-access.json'),
      path.join(root, 'data', 'portable-appdata', 'Buyer Log', 'auth', 'user-access.json'),
      path.join(root, 'data', 'portable-appdata', 'BuyerLog', 'auth', 'user-access.json'),
      path.join(root, 'resources', 'app', 'server', 'data', 'user-access.json'),
      // Some pre-portable packages nested their migrated data below resources/app.
      path.join(root, 'resources', 'app', 'data', 'app', 'auth', 'user-access.json'),
      path.join(root, 'resources', 'app', 'data', 'auth', 'user-access.json'),
      path.join(root, 'resources', 'app', 'data', 'server', 'user-access.json'),
      path.join(root, 'resources', 'app', 'data', 'server', 'data', 'user-access.json'),
    ]) addStore(file);
  };

  // Current historical server-data location.
  addStore(LEGACY_ACCESS_FILE);

  // Central IAM creates immutable safety copies before migrations.
  add(path.join(AUTH_DATA_ROOT, 'user-access.pre-iam-migration.json'));
  add(path.join(AUTH_DATA_ROOT, 'user-access.json.pre-migration.bak'));
  addJsonDirectory(AUTH_DATA_ROOT, 100);

  /*
   * Packaged Buyer Log uses:
   *   <portable>\data\app\auth\user-access.json   (current)
   *
   * Real installations have existed in multiple portable layouts over time.
   * Recovery is intentionally bounded to Buyer Log owned roots; it never scans
   * the user's entire drive or arbitrary profile folders.
   */
  let portableDataRoot = clean(process.env.BUYER_LOG_PORTABLE_DATA_ROOT);
  if (!portableDataRoot) {
    const parent = path.dirname(AUTH_DATA_ROOT);
    if (/^app$/i.test(path.basename(parent))) portableDataRoot = path.dirname(parent);
  }
  if (portableDataRoot) {
    const portableRoot = path.dirname(portableDataRoot);
    addKnownInstallLayout(portableRoot);

    // Search Buyer Log's own portable data tree so migration evidence nested in
    // legacy-auth-folder or another recovery folder is not silently missed.
    scanUserAccessTree(portableDataRoot, { maxDepth:7, maxEntries:2200 });

    // Older packages could have resources/app/data/... beside server/data.
    scanUserAccessTree(path.join(portableRoot, 'resources', 'app', 'data'), { maxDepth:6, maxEntries:1000 });

    // data-BACKUP-* is the supported pre-migration safety copy. Scan each backup
    // recursively because historical backups did not always use the same auth path.
    try {
      for (const entry of fs.readdirSync(portableRoot, { withFileTypes:true }).slice(0, 250)) {
        if (!entry.isDirectory() || !/^data[\s._-]*backup/i.test(entry.name)) continue;
        const backup = path.join(portableRoot, entry.name);
        scanUserAccessTree(backup, { maxDepth:7, maxEntries:1800 });
      }
    } catch (_) {}

    // A user may have extracted a newer Buyer Log beside an older installation.
    // Production previously skipped sibling discovery because SERVER_DATA_ROOT is
    // always set. Inspect only sibling folders whose names clearly identify Buyer Log.
    try {
      const parent = path.dirname(portableRoot);
      for (const entry of fs.readdirSync(parent, { withFileTypes:true }).slice(0, 250)) {
        if (!entry.isDirectory() || !/buyer[\s._-]*log/i.test(entry.name)) continue;
        const sibling = path.join(parent, entry.name);
        if (path.resolve(sibling) === path.resolve(portableRoot)) continue;
        addKnownInstallLayout(sibling);
        scanUserAccessTree(path.join(sibling, 'data'), { maxDepth:6, maxEntries:1200 });
        try {
          for (const child of fs.readdirSync(sibling, { withFileTypes:true }).slice(0, 120)) {
            if (child.isDirectory() && /^data[\s._-]*backup/i.test(child.name)) {
              scanUserAccessTree(path.join(sibling, child.name), { maxDepth:6, maxEntries:1200 });
            }
          }
        } catch (_) {}
      }
    } catch (_) {}
  }

  // Real Windows profile locations are retained by the desktop launcher before
  // APPDATA/LOCALAPPDATA are redirected into the portable folder.
  const hostAppData = clean(process.env.BL_HOST_APPDATA);
  if (hostAppData) {
    addStore(path.join(hostAppData, 'Buyer Log', 'auth', 'user-access.json'));
    addStore(path.join(hostAppData, 'BuyerLog', 'auth', 'user-access.json'));
  }
  const hostLocalAppData = clean(process.env.BL_HOST_LOCALAPPDATA);
  if (hostLocalAppData) {
    addStore(path.join(hostLocalAppData, 'Buyer Log', 'auth', 'user-access.json'));
    addStore(path.join(hostLocalAppData, 'BuyerLog', 'auth', 'user-access.json'));
  }

  // Development/legacy sibling installs remain supported.
  if (!portableDataRoot && AUTH_DATA_ROOT !== SERVER_DATA_ROOT) {
    try {
      const parent = path.dirname(PROJECT_ROOT);
      for (const entry of fs.readdirSync(parent, { withFileTypes: true }).slice(0, 250)) {
        if (!entry.isDirectory() || !/buyer[\s._-]*log/i.test(entry.name)) continue;
        addKnownInstallLayout(path.join(parent, entry.name));
      }
    } catch (_) {}
  }

  return [...out].filter(file => path.resolve(file) !== path.resolve(ACCESS_FILE));
}
function migrateLegacyAuthStoreIfNeeded() {
  if (AUTH_DATA_ROOT === SERVER_DATA_ROOT) return false;
  const current = accessStoreQuality(ACCESS_FILE);
  const candidates = legacyAccessCandidates().map(accessStoreQuality).filter(Boolean).sort(compareAccessStoreQuality);
  const best = candidates[0]; if (!best) return false;
  let shouldImport = !current;
  if (current) {
    // If the active store cannot authenticate ANY active account, a usable
    // historical store must win even if the broken/placeholder file has a newer
    // revision. This is the exact state exposed by the login screen as
    // "geçerli yerel kullanıcı önbelleği yok".
    const currentUsable = hasUsableOfflineAuthStore(current.parsed);
    const bestUsable = hasUsableOfflineAuthStore(best.parsed);
    if (!currentUsable && bestUsable) shouldImport = true;
    // Otherwise upgrade only when the candidate is demonstrably stronger.
    else if (best.enabledCredentialCount > current.enabledCredentialCount) shouldImport = true;
    else if (best.enabledCredentialCount === current.enabledCredentialCount && best.credentialCount > current.credentialCount) shouldImport = true;
    else if (best.credentialCount === current.credentialCount && best.credentialCount > 0 && best.revision > current.revision) shouldImport = true;
    else if (best.credentialCount === current.credentialCount && best.revision >= current.revision && best.usernameCount > current.usernameCount) shouldImport = true;
  }
  if (!shouldImport) return false;
  fs.mkdirSync(AUTH_DATA_ROOT, { recursive: true });
  if (fs.existsSync(ACCESS_FILE)) { try { fs.copyFileSync(ACCESS_FILE, ACCESS_FILE + '.pre-migration.bak'); } catch (_) {} }
  fs.copyFileSync(best.file, ACCESS_FILE);
  const sourceDir = path.dirname(best.file);
  const sourceAudit = path.join(sourceDir, 'user-audit.jsonl');
  if (!fs.existsSync(AUDIT_FILE) && fs.existsSync(sourceAudit)) {
    try { fs.copyFileSync(sourceAudit, AUDIT_FILE); } catch (_) {}
  }
  for (const name of ['iam-audit.json', 'user-access.meta.json', 'iam-derived.json']) {
    const source = path.join(sourceDir, name), target = path.join(AUTH_DATA_ROOT, name);
    if (!fs.existsSync(target) && fs.existsSync(source)) {
      try { fs.copyFileSync(source, target); } catch (_) {}
    }
  }
  return true;
}

function clean(value) { return String(value == null ? '' : value).trim(); }
function norm(value) { return clean(value).toLocaleUpperCase('tr-TR'); }
function usernameKey(value) { return centralIam.normalizeUsername(value); }
function unique(values) {
  const seen = new Set(), out = [];
  for (const value of values || []) {
    const text = clean(value), key = norm(text);
    if (text && !seen.has(key)) { seen.add(key); out.push(text); }
  }
  return out.sort((a, b) => a.localeCompare(b, 'tr'));
}
function isKnownRole(value) { return Object.prototype.hasOwnProperty.call(ROLE_LEVEL, clean(value)); }
function normalizeRole(value) { return isKnownRole(value) ? clean(value) : 'buyer'; }
function normalizePermissions(value) {
  const src = value && typeof value === 'object' ? value : {};
  const out = {};
  for (const key of PERMISSION_KEYS) out[key] = Boolean(src[key]);
  return out;
}
function normalizeAccessAreas(value, defaultEnabled = true) {
  const hasExplicit = value && typeof value === 'object' && !Array.isArray(value);
  const out = {};
  for (const key of ACCESS_AREA_KEYS) {
    if (PUBLIC_ACCESS_AREA_KEYS.includes(key)) out[key] = true;
    else if (!hasExplicit) out[key] = Boolean(defaultEnabled);
    else if (key === 'orders' && !Object.prototype.hasOwnProperty.call(value, 'orders')) out[key] = Boolean(value.cp);
    else if ((key === 'agents' || key === 'automations') && !Object.prototype.hasOwnProperty.call(value, key)) out[key] = true;
    else out[key] = Boolean(value[key]);
  }
  return out;
}
function normalizeCollectionAccess(value) {
  const out = [], seen = new Set();
  for (const item of Array.isArray(value) ? value : []) {
    const ownerId = clean(item && item.ownerId), level = clean(item && item.level);
    if (!ownerId || !['view', 'edit'].includes(level) || seen.has(ownerId)) continue;
    seen.add(ownerId); out.push({ ownerId, level });
  }
  return out;
}
function allProfiles(store) { return [store && store.moderator, ...(store && Array.isArray(store.users) ? store.users : [])].filter(Boolean); }
function profileById(store, id) { return allProfiles(store).find(profile => profile.id === clean(id)) || null; }
function profileByUsername(store, username) {
  const key = usernameKey(username);
  return key ? allProfiles(store).find(profile => usernameKey(profile.username || profile.displayName) === key) || null : null;
}
function directReports(store, id) { return allProfiles(store).filter(profile => clean(profile.supervisorId) === clean(id)); }
// v7.16: directReports her adımda allProfiles(store)'u yeniden kurup tarıyordu.
// Yönetici → çocuklar haritası bir kez kurulur; gezinme sırası ve sonuç aynıdır.
function reportsByManager(store) {
  const map = new Map();
  for (const profile of allProfiles(store)) {
    const key = clean(profile.supervisorId);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(profile);
  }
  return map;
}
function descendantProfiles(store, id) {
  const byManager = reportsByManager(store);
  const out = [], seen = new Set([clean(id)]), queue = (byManager.get(clean(id)) || []).slice();
  while (queue.length) {
    const profile = queue.shift();
    if (!profile || seen.has(profile.id)) continue;
    seen.add(profile.id); out.push(profile); queue.push(...(byManager.get(clean(profile.id)) || []));
  }
  return out;
}
function canManageUsers(profile) { return Boolean(profile && (profile.systemRole === 'moderator' || normalizeRole(profile.role) === 'moderator')); }
function canManageTarget(actor, target, store) {
  if (!actor || !target) return false;
  if (actor.systemRole === 'moderator' && iam.canAdminUsers(actor, store)) return true;
  return descendantProfiles(store, actor.id).some(item => item.id === target.id);
}
function roleBasePermissions(profile) {
  const out = normalizePermissions(profile && profile.permissions);
  if (profile && normalizeRole(profile.role) === 'moderator') for (const key of PERMISSION_KEYS) out[key] = true;
  return out;
}
const SHARED_SETTINGS_PERMISSION_KEYS = new Set(['manageBusinessRules', 'manageModelConnections']);
function effectivePermissions(profile, store = readStore()) {
  const out = roleBasePermissions(profile);
  for (const child of descendantProfiles(store, profile && profile.id)) {
    const childPermissions = roleBasePermissions(child);
    // Ortak ayar yönetimi (kur, royalty, yol süresi, bağlantılar…) ekipten
    // yöneticiye devrolmaz; yalnız Moderatörün kişiye verdiği izinle açılır.
    for (const key of PERMISSION_KEYS) if (!SHARED_SETTINGS_PERMISSION_KEYS.has(key)) out[key] = out[key] || childPermissions[key];
  }
  const codes = iam.effectivePermissionSet(profile, store);
  if (codes.has('SYSTEM.MANAGE')) out.manageBackup = true;
  if (codes.has('SOURCE_DATA.MANAGE')) out.manageBusinessRules = true;
  if (codes.has('SOURCE_DATA.MANAGE') || codes.has('SYSTEM.MANAGE')) out.manageModelConnections = true;
  if (codes.has('ORDERS.MANAGE')) out.manageAllOrders = true;
  if (codes.has('COLLECTIONS.MANAGE')) out.manageCollections = true;
  return out;
}
function hasPermission(profile, key, store = readStore()) { return Boolean(profile && effectivePermissions(profile, store)[key]); }
function directAccessAreas(profile) {
  if (profile && normalizeRole(profile.role) === 'moderator') return normalizeAccessAreas(null, true);
  return normalizeAccessAreas(profile && profile.accessAreas, true);
}
function effectiveAccessAreas(profile, store = readStore()) {
  const out = directAccessAreas(profile);
  if (!profile) return out;
  for (const child of descendantProfiles(store, profile.id)) {
    const childAreas = directAccessAreas(child);
    for (const key of ACCESS_AREA_KEYS) out[key] = out[key] || childAreas[key];
  }
  const codes = iam.effectivePermissionSet(profile, store);
  for (const [area, resource] of Object.entries(iam.LEGACY_AREA_RESOURCE)) if (codes.has(`${resource}.VIEW`)) out[area] = true;
  if (codes.has('OAB.VIEW')) out.overview = true;
  return out;
}
function hasArea(profile, key, store = readStore()) {
  return Boolean(profile && ACCESS_AREA_KEYS.includes(clean(key)) && effectiveAccessAreas(profile, store)[clean(key)]);
}
function effectiveCollectionAccess(profile, store = readStore()) {
  const levels = new Map();
  const apply = (ownerId, level) => {
    const prev = levels.get(ownerId);
    if (!prev || level === 'edit') levels.set(ownerId, level);
  };
  if (!profile) return [];
  apply(profile.id, 'edit');
  let resolved = null;
  if (typeof collectionAccessResolver === 'function') {
    try { resolved = collectionAccessResolver(profile, store); } catch (_) { resolved = []; }
  }
  // null yalnız geçişin ilk anında (yerel izin önbelleği henüz yokken)
  // kullanılabilir. Bundan sonra boş liste fail-closed'dur.
  for (const item of normalizeCollectionAccess(resolved == null ? profile.collectionAccess : resolved)) apply(item.ownerId, item.level);
  return [...levels].map(([ownerId, level]) => ({ ownerId, level }));
}
function collectionAccessLevel(profile, ownerId, store = readStore()) {
  const item = effectiveCollectionAccess(profile, store).find(entry => entry.ownerId === clean(ownerId));
  return item ? item.level : null;
}
function hierarchyError(message, code) {
  const error = new Error(message); error.statusCode = 400; error.code = code; return error;
}
function validateHierarchyChange(store, target) {
  const supervisorId = clean(target && (target.managerId || target.supervisorId));
  const targetLevel = target && target.orgLevel || iam.normalizeProfileIam(target || {}).orgLevel;
  target.managerId = supervisorId || null; target.supervisorId = supervisorId || null;
  if (!supervisorId) target.supervisorId = target.managerId = null;
  else {
    const supervisor = profileById(store, supervisorId);
    if (!supervisor || supervisor.status !== 'ACTIVE') throw hierarchyError('Seçilen yönetici bulunamadı veya aktif değil.', 'SUPERVISOR_NOT_FOUND');
    if ((iam.ORG_LEVEL_RANK[supervisor.orgLevel] || 0) < (iam.ORG_LEVEL_RANK[targetLevel] || 0)) throw hierarchyError('Yönetici organizasyon seviyesi bağlı kullanıcıdan düşük olamaz.', 'INVALID_HIERARCHY');
    iam.validateHierarchy(store, target.id, supervisorId);
  }
  const reports = directReports(store, target.id);
  if (reports.length && target.status !== 'ACTIVE') throw hierarchyError('Bu kullanıcı pasif veya askıda yapılmadan önce bağlı kullanıcılar başka bir yöneticiye atanmalıdır.', 'SUPERVISOR_HAS_REPORTS');
}

function titleSuggestedRole(title) {
  const value = norm(title).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/İ/g, 'I');
  if (/MODERATOR|ADMIN/.test(value)) return 'moderator';
  if (/MUDUR|MANAGER|HEAD|DIRECTOR/.test(value)) return 'manager';
  if (/EKIP LIDER|TEAM LEAD|LEADER|SUPERVISOR/.test(value)) return 'team_lead';
  return 'buyer';
}
function roleDraft(role) {
  const normalized = normalizeRole(role);
  const areas = normalizeAccessAreas(null, false);
  if (normalized === 'moderator') for (const key of ACCESS_AREA_KEYS) areas[key] = true;
  else for (const key of ACCESS_AREA_KEYS) areas[key] = key !== 'source';
  const permissions = normalizePermissions({});
  if (normalized === 'team_lead' || normalized === 'manager') permissions.manageCollections = true;
  if (normalized === 'moderator') for (const key of PERMISSION_KEYS) permissions[key] = true;
  return { role: normalized, accessAreas: areas, permissions };
}
function profileDraft(title, metadata = {}) {
  const role = titleSuggestedRole(title), draft = roleDraft(role);
  return {
    ...draft,
    scopeMode: 'profile',
    profileScopes: {
      mags: unique(metadata.mags), mmygs: unique(metadata.mmygs), buyingGroups: unique(metadata.buyingGroups),
    },
  };
}
function hashPin(password) {
  const value = clean(password);
  if (!value) return '';
  const salt = crypto.randomBytes(16);
  return `scrypt$${salt.toString('hex')}$${crypto.scryptSync(value, salt, 32).toString('hex')}`;
}
function verifyPin(password, stored) {
  if (!stored) return clean(password) === '';
  try {
    const parts = String(stored).split('$');
    if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
    const salt = Buffer.from(parts[1], 'hex'), expected = Buffer.from(parts[2], 'hex');
    const actual = crypto.scryptSync(clean(password), salt, expected.length);
    return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
  } catch (_) { return false; }
}
function credentialHash(profile) { return clean(profile && (profile.passwordHash || profile.pinHash)); }
function hasActiveLocalCredential(store) {
  return allProfiles(store).some(profile => {
    if (!profile || profile.enabled === false) return false;
    const status = clean(profile.status);
    if (status && status !== 'ACTIVE') return false;
    return Boolean(credentialHash(profile));
  });
}
function hasUsableOfflineAuthStore(store) {
  return Boolean(store && store.moderator && (store._restoreSeed || hasActiveLocalCredential(store)));
}
function defaultStore() {
  return {
    schemaVersion: 8,
    moderator: {
      id: 'moderator', role: 'moderator', username: DEFAULT_MODERATOR_NAME, displayName: DEFAULT_MODERATOR_NAME,
      title: ROLE_LABELS.moderator, email: '', mags: [], mmygs: [], buyingGroups: [], enabled: true,
      passwordHash: '', pinHash: '', supervisorId: null, permissions: normalizePermissions({}),
      accessAreas: normalizeAccessAreas(null, true), collectionAccess: [], scopeMode: 'profile',
      autoScopes: { buyers: [], mags: [], mmygs: [], buyingGroups: [] },
      customScopes: { buyers: [], mags: [], mmygs: [], buyingGroups: [] },
    },
    users: [], orderAccess: {}, _revision: 0, _updatedAt: null,
  };
}
function normalizeStoredProfile(profile, fallback = {}) {
  const role = normalizeRole(profile && profile.role || fallback.role);
  const explicitUsername = clean(profile && profile.username);
  const legacySourceAccount = Boolean(profile && profile.sourceBuyer && !explicitUsername);
  const username = legacySourceAccount ? '' : (explicitUsername || clean(profile && profile.displayName) || clean(fallback.username) || clean(fallback.displayName));
  const displayName = clean(profile && profile.displayName) || explicitUsername || clean(fallback.displayName) || username;
  const inheritedScopes = profile && (profile.autoScopes || profile.customScopes) || {};
  const passwordHash = credentialHash(profile);
  const normalized = {
    ...fallback, ...(profile || {}), role, username, displayName,
    email: clean(profile && profile.email || fallback.email).slice(0, 254),
    title: clean(profile && profile.title) || ROLE_LABELS[role],
    enabled: legacySourceAccount ? false : (profile ? profile.enabled !== false : fallback.enabled !== false),
    legacySourceAccount,
    mags: unique(profile && profile.mags || inheritedScopes.mags),
    mmygs: unique(profile && profile.mmygs || inheritedScopes.mmygs),
    buyingGroups: unique(profile && profile.buyingGroups || inheritedScopes.buyingGroups),
    passwordHash, pinHash: passwordHash,
    supervisorId: role === 'moderator' ? null : (clean(profile && profile.supervisorId) || null),
    permissions: normalizePermissions(profile && profile.permissions),
    accessAreas: role === 'moderator' ? normalizeAccessAreas(null, true) : normalizeAccessAreas(profile && profile.accessAreas, true),
    collectionAccess: normalizeCollectionAccess(profile && profile.collectionAccess),
    scopeMode: ['profile', 'custom', 'auto'].includes(clean(profile && profile.scopeMode)) ? clean(profile.scopeMode) : 'profile',
    autoScopes: {
      buyers: unique(profile && profile.autoScopes && profile.autoScopes.buyers),
      mags: unique(profile && profile.autoScopes && profile.autoScopes.mags),
      mmygs: unique(profile && profile.autoScopes && profile.autoScopes.mmygs),
      buyingGroups: unique(profile && profile.autoScopes && profile.autoScopes.buyingGroups),
    },
    customScopes: {
      buyers: unique(profile && profile.customScopes && profile.customScopes.buyers),
      mags: unique(profile && profile.customScopes && profile.customScopes.mags),
      mmygs: unique(profile && profile.customScopes && profile.customScopes.mmygs),
      buyingGroups: unique(profile && profile.customScopes && profile.customScopes.buyingGroups),
    },
  };
  delete normalized.sourceMissing;
  return iam.normalizeProfileIam(normalized);
}
// requireSelection (her istekte) ve requirePermission/requireArea (korumalı her
// rotada) her biri kendi loadStore() çağrısını yapar; boyut+mtime imzasıyla
// etiketlenmiş tek girişlik önbellek, dosya değişmediği sürece bu tekrarlı okuma
// ve normalizasyonu (kullanıcı adı tekilleştirme dahil) atlar. db.js'deki
// readJsonWithBackup ile aynı desen — yazımdan sonra mtime değiştiği için
// önbellek kendiliğinden geçersizleşir, ekstra invalidation kodu gerekmez.
//
// v10.16 — ONBELLEK ISABETINDE DERIN KOPYA KALDIRILDI.
//
// Onbellek dosya degismedigi surece okuma+normalizasyonu atliyordu, ama
// isabet eden her cagri yine de TUM depoyu JSON.parse(JSON.stringify(...))
// ile klonluyordu. Canli veride olculen maliyet:
//
//     depo 1.095 KB · 47 kullanici · 6.248 siparis yetkisi
//     loadStore() cache-hit            22,3 ms
//     2.000 x hasPermission (klonlu)   36.659 ms
//     2.000 x hasPermission (klonsuz)     179 ms      -> 205x
//
// hasPermission/canEditOrder gibi fonksiyonlar store'u VARSAYILAN PARAMETRE
// ile aliyor (store = loadStore()); cagiran gecmezse klon o cagrida kopuyor.
// Toplu islemlerde (secili siparisleri kaydet/sil) bu, siparis kodu basina
// bir tam klon demek.
//
// readStore() SALT-OKUMA icindir ve onbellek nesnesinin KENDISINI dondurur.
// Guvenli, cunku: (a) asagidaki okuyucular store uzerinde hicbir mutasyon
// yapmaz - hepsi yeni nesne uretir; (b) mevcut kod zaten onbellek ISKASINDA
// ayni nesnenin kendisini donduruyordu, yani "her zaman ozel kopya" gibi bir
// guvence hicbir zaman yoktu. Yazan yollar loadStore() kullanmaya devam eder.
//
let storeCache = null;
/* Depo imzasi: boyut+mtime. Dosya degisince kendiliginden gecersizlesir. */
function storeTag() {
  try { const stat = fs.statSync(ACCESS_FILE); return `${stat.size}-${stat.mtimeMs}`; }
  catch (_) { return null; }
}
function resolveStore(shared) {
  const transaction = iamTransaction.getStore();
  // Islem sirasinda aday nesne degisiyor; okuma yolu da olsa klon korunur.
  if (transaction) return JSON.parse(JSON.stringify(transaction.candidate || transaction.base));

  /*
   * HIZLI YOL — v10.16.
   *
   * Eski-depo tasima kontrolu (migrateLegacyAuthStoreIfNeeded) onbellek
   * kontrolunden ONCE calisiyordu ve her cagrida 1 MB'lik user-access.json'i
   * okuyup ayristiriyor, ustelik ust klasoru tarayip bulunan her aday depoyu
   * da ayristiriyordu. Olculen maliyet: izin kontrolu basina 12,8 ms.
   *
   * Bu bir ACILIS/GECIS karari; istek basina is degil. Onbellek sicakken
   * dosya degismemis demektir, dolayisiyla tasima karari da degismez.
   * Soguk onbellekte (ilk cagri ve dosya her degistiginde) asagida aynen
   * calismaya devam eder.
   */
  if (!centralConfigured) {
    const cachedTag = storeTag();
    if (cachedTag && storeCache && storeCache.tag === cachedTag) {
      return shared ? storeCache.value : JSON.parse(JSON.stringify(storeCache.value));
    }
  }
  if (centralConfigured) {
    let restoreSeed = readAccessStoreFile(ACCESS_FILE);
    const cached = restoreSeed && restoreSeed._restoreSeed ? null : getCentralIam().readLocal();
    if (cached) {
      try { const derived = JSON.parse(fs.readFileSync(path.join(AUTH_DATA_ROOT, 'iam-derived.json'), 'utf8')); cached.orderAccess = derived.orderAccess || {}; cached.scopeCatalog = derived.scopeCatalog || {}; } catch (_) {}
      return cached;
    }

    // Central IAM may be enabled before this machine has produced a valid
    // central cache (for example directly after an app update while Shared Hub
    // is unavailable). In that state the old version's local auth store is the
    // only safe login source. Recover it into the version-independent auth
    // directory before declaring the directory empty. Never replace a cache
    // that already carries Central IAM metadata: an invalid central cache must
    // remain fail-closed and available for recovery/diagnostics.
    if (!restoreSeed || !restoreSeed._centralIam) {
      let recovered = false;
      try { recovered = migrateLegacyAuthStoreIfNeeded(); } catch (_) {}
      restoreSeed = readAccessStoreFile(ACCESS_FILE);
      // The strongest recovered candidate may itself be a valid Central IAM
      // cache. readLocal() ran before recovery, so retry once after importing it.
      if (recovered && restoreSeed && restoreSeed._centralIam && !restoreSeed._restoreSeed) {
        const recoveredCentral = getCentralIam().readLocal();
        if (recoveredCentral) {
          try { const derived = JSON.parse(fs.readFileSync(path.join(AUTH_DATA_ROOT, 'iam-derived.json'), 'utf8')); recoveredCentral.orderAccess = derived.orderAccess || {}; recoveredCentral.scopeCatalog = derived.scopeCatalog || {}; } catch (_) {}
          return recoveredCentral;
        }
      }
    }

    // Offline login is valid when ANY active cached account has a verifier.
    // Requiring the Moderator specifically locked out healthy buyer/manager
    // accounts whenever the Moderator had no local password on this device.
    // A full-system restore seed is also intentionally accepted here.
    const raw = restoreSeed || readAccessStoreFile(ACCESS_FILE + '.bak');
    // Son çare: bu cihazda daha önce giriş yapmış kişinin kendi kişisel kaydı.
    if (!raw || raw._centralIam || !hasUsableOfflineAuthStore(raw)) return personalLoginFallbackStore() || { schemaVersion: 8, _revision: 0, users: [], moderator: null, iam: iam.migrateStore({}).iam, orderAccess: {}, scopeCatalog: {} };
  } else if (!((() => { const primary = readAccessStoreFile(ACCESS_FILE); return primary && primary._restoreSeed; })())) migrateLegacyAuthStoreIfNeeded();
  fs.mkdirSync(AUTH_DATA_ROOT, { recursive: true });
  // Tasima dosyayi degistirmis olabilir; imza tasimadan SONRA hesaplanir.
  const tag = storeTag();
  if (tag && storeCache && storeCache.tag === tag) {
    return shared ? storeCache.value : JSON.parse(JSON.stringify(storeCache.value));
  }
  let raw = null;
  for (const candidate of [ACCESS_FILE, ACCESS_FILE + '.bak']) {
    if (!fs.existsSync(candidate)) continue;
    raw = readAccessStoreFile(candidate);
    if (raw) break;
  }
  if (!raw && (fs.existsSync(ACCESS_FILE) || fs.existsSync(ACCESS_FILE + '.bak'))) throw Object.assign(new Error('Kullanıcı deposu ve yedeği doğrulanamadı.'), { code: 'IAM_LOCAL_INVALID', statusCode: 503 });
  if (!raw) raw = defaultStore();
  const base = defaultStore();
  const moderator = normalizeStoredProfile(raw && raw.moderator, base.moderator);
  moderator.id = 'moderator'; moderator.role = 'moderator'; moderator.supervisorId = null;
  if (!clean(moderator.username) || ['MODERATÖR', 'MODERATOR'].includes(norm(moderator.username))) moderator.username = DEFAULT_MODERATOR_NAME;
  if (!clean(moderator.displayName) || ['MODERATÖR', 'MODERATOR'].includes(norm(moderator.displayName))) moderator.displayName = DEFAULT_MODERATOR_NAME;
  const users = (Array.isArray(raw && raw.users) ? raw.users : []).map(user => normalizeStoredProfile(user));
  const usernames = new Set([usernameKey(moderator.username)]);
  for (const user of users) {
    if (user.legacySourceAccount && !clean(user.username)) continue;
    let candidate = clean(user.username) || clean(user.displayName) || `user-${clean(user.id)}`;
    if (!candidate) candidate = `user-${crypto.randomUUID().slice(0, 8)}`;
    let key = usernameKey(candidate), suffix = 2;
    while (usernames.has(key)) { candidate = `${clean(user.username || user.displayName || 'user')} ${suffix++}`; key = usernameKey(candidate); }
    user.username = candidate; usernames.add(key);
  }
  const store = iam.migrateStore({
    ...base, ...(raw && typeof raw === 'object' ? raw : {}), moderator, users,
    schemaVersion: 8,
    orderAccess: raw && raw.orderAccess && typeof raw.orderAccess === 'object' ? raw.orderAccess : {},
    _revision: Number.isInteger(Number(raw && raw._revision)) ? Number(raw._revision) : 0,
  });
  if (tag) storeCache = { tag, value: store };
  /* Iska yolunda da tutarli ol: YAZAN cagiran ozel kopya alir.
     Eski kod burada onbellege aldigi nesnenin KENDISINI donduruyordu;
     cagiran onu degistirdiginde onbellek de bozuluyordu. Iska nadir
     (yalniz dosya degisince) oldugu icin bu klonun maliyeti yok. */
  return shared ? store : JSON.parse(JSON.stringify(store));
}
/* Yazma niyetli cagiranlar: donen nesne cagirana aittir. */
function loadStore() { return resolveStore(false); }
/* SALT-OKUMA cagiranlar: donen nesne ONBELLEGIN KENDISIDIR, degistirilemez. */
function readStore() { return resolveStore(true); }
function backupSafeStore(value = loadStore()) {
  const sensitive = /(?:password|pinHash|secret|token|session|cookie|credential|loginFailures?|lockUntil)/i;
  function cleanValue(input) {
    if (Array.isArray(input)) return input.map(cleanValue);
    if (!input || typeof input !== 'object') return input;
    const out = {};
    for (const [key, item] of Object.entries(input)) if (!sensitive.test(key)) out[key] = cleanValue(item);
    return out;
  }
  return cleanValue(value);
}
function saveStore(store, expectedRevision = null) {
  const transaction = iamTransaction.getStore();
  if (centralConfigured) {
    if (!transaction) throw Object.assign(new Error('Merkezi kullanıcı değişiklikleri çevrimiçi IAM işlemi gerektirir.'), { code: 'IAM_TRANSACTION_REQUIRED', statusCode: 503 });
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision !== transaction.base._revision) throw Object.assign(new Error('Güncel kullanıcı dizinini yeniden yükleyin.'), { code: 'IAM_REVISION_CONFLICT', statusCode: 409 });
    transaction.candidate = { ...iam.migrateStore(store), _revision: expectedRevision + 1, _updatedAt: new Date().toISOString() };
    return transaction.candidate;
  }
  const current = loadStore();
  if (expectedRevision != null && Number(expectedRevision) !== current._revision) {
    const error = new Error('Kullanıcı listesi başka bir işlem tarafından değiştirildi. Güncel listeyi yeniden açın.');
    error.code = 'REVISION_CONFLICT'; error.statusCode = 409; error.currentRevision = current._revision; error.expectedRevision = Number(expectedRevision);
    throw error;
  }
  const saved = { ...iam.migrateStore(store), schemaVersion: 8, _revision: current._revision + 1, _updatedAt: new Date().toISOString() };
  atomicWriteJson(ACCESS_FILE, saved);
  storeCache = null;
  return saved;
}
function workspaceTemplateForRole(store, roleId) {
  const id = clean(roleId);
  if (!Object.prototype.hasOwnProperty.call(iam.SYSTEM_ROLES, id)) return null;
  const templates = iam.normalizeWorkspaceTemplates(store && store.iam && store.iam.workspaceTemplates);
  return templates[id] || null;
}
function roleWorkspaceEntries(profileOrId, store = readStore()) {
  const profile = typeof profileOrId === 'object' && profileOrId
    ? profileOrId
    : profileById(store, clean(profileOrId));
  const roleId = clean(profile && profile.systemRole) || (Object.prototype.hasOwnProperty.call(iam.SYSTEM_ROLES, clean(profileOrId)) ? clean(profileOrId) : 'buyer');
  const template = workspaceTemplateForRole(store, roleId);
  return userPreferences.normalizeWorkspaceEntryMap(template && template.entries, userPreferences.WORKSPACE_CATEGORIES);
}
function workspaceTemplateSummaries(store) {
  const templates = iam.normalizeWorkspaceTemplates(store && store.iam && store.iam.workspaceTemplates);
  return Object.fromEntries(Object.entries(templates).map(([roleId, template]) => {
    const entries = userPreferences.normalizeWorkspaceEntryMap(template.entries, userPreferences.WORKSPACE_CATEGORIES);
    const categoryCounts = {};
    for (const key of Object.keys(entries)) {
      const category = userPreferences.categoryForKey(key);
      if (category) categoryCounts[category] = (categoryCounts[category] || 0) + 1;
    }
    return [roleId, { roleId, sourceUserId: template.sourceUserId, sourceName: template.sourceName, updatedBy: template.updatedBy, updatedAt: template.updatedAt, categories: template.categories, categoryCounts, entryCount: Object.keys(entries).length }];
  }));
}
function authoritativeOrderAccessFromOrders(orders) {
  const grouped = Object.create(null), seen = new Map();
  for (const order of orders || []) {
    // v7.25: boş sipariş kodu Number('') → 0 olduğu için yetki haritasına
    // "0" diye sahte bir sipariş açıyordu. Sipariş kodları pozitiftir; kodsuz
    // satır yetki kaynağına GİRMEZ (seçim kataloğuna ise girer).
    const codeNumber = Number(order && order.ocode);
    if (!Number.isFinite(codeNumber) || codeNumber <= 0) continue;
    const code = String(codeNumber);
    if (!grouped[code]) { grouped[code] = []; seen.set(code, new Set()); }
    const row = { buyer: clean(order.buyer), merch: clean(order.merch), ageGroup: clean(order.ageGroup), buyerGrup: clean(order.buyerGrup) };
    const key = [row.buyer, row.merch, row.ageGroup, row.buyerGrup].map(norm).join('|');
    const codeSeen = seen.get(code); if (codeSeen.has(key)) continue;
    codeSeen.add(key); grouped[code].push(row);
  }
  return grouped;
}
/* ===================================================================
   v7.25 — KULLANICI AYARLARINDAKİ MAG / MMYG / BUYING GROUP LİSTELERİ

   Saha bulgusu (kullanıcı): "kullanıcı ayarlarında ASAS'daki tüm buying
   group'lar, MAG'lar ve MMYG'ler görünmüyor."

   SEBEP: bu listeler orderAccess'ten türetiliyordu. orderAccess bir YETKİ
   kaynağıdır ve bilerek dardır:
     · yalnız SAYISAL sipariş kodu olan satırları alır,
     · beslendiği ASAS satırları zaten "adet > 0" ve "Buyer Grup ≠ YARDIM"
       süzgecinden geçmiştir,
     · veri tabanı modunda Moderatörün ufku kadarını içerir.
   Dolayısıyla adedi sıfırlanmış ya da ufuk dışında kalan bir Buying Group
   kullanıcı kartında hiç görünmüyordu.

   ÇÖZÜM: seçim listeleri için AYRI ve BİRİKİMLİ bir katalog tutulur.
     · Yetki kaynağı olan orderAccess'e DOKUNULMAZ (§32).
     · Katalog her yetkili ASAS okumasında BİRLEŞTİRİLİR, hiç küçülmez:
       bir kez görülmüş değer, sonraki dar bir yenilemede listeden düşmez.
     · Sipariş kodu şartı yoktur; satırın MAG/MMYG/Buying Group bilgisi
       yeterlidir.
   Katalog yalnız seçim listesi doldurur; hiçbir yetki kararına girmez.
   =================================================================== */
function scopeCatalogFromOrders(orders) {
  const mags = new Set(), mmygs = new Set(), buyingGroups = new Set();
  const magMmyg = Object.create(null), magMmygBuyingGroups = Object.create(null);
  for (const order of orders || []) {
    const mag = clean(order && order.merch), mmyg = clean(order && order.ageGroup), group = clean(order && order.buyerGrup);
    if (mag) mags.add(mag);
    if (mmyg) mmygs.add(mmyg);
    if (group) buyingGroups.add(group);
    if (mag && mmyg) { (magMmyg[mag] = magMmyg[mag] || new Set()).add(mmyg); }
    if (mag && group) {
      const key = mmyg || '';
      magMmygBuyingGroups[mag] = magMmygBuyingGroups[mag] || Object.create(null);
      (magMmygBuyingGroups[mag][key] = magMmygBuyingGroups[mag][key] || new Set()).add(group);
    }
  }
  const listOf = set => [...set].sort((a, b) => a.localeCompare(b, 'tr', { sensitivity: 'base' }));
  return {
    mags: listOf(mags), mmygs: listOf(mmygs), buyingGroups: listOf(buyingGroups),
    magMmyg: Object.fromEntries(Object.entries(magMmyg).map(([mag, set]) => [mag, listOf(set)])),
    magMmygBuyingGroups: Object.fromEntries(Object.entries(magMmygBuyingGroups).map(([mag, byMmyg]) =>
      [mag, Object.fromEntries(Object.entries(byMmyg).map(([mmyg, set]) => [mmyg, listOf(set)]))])),
  };
}
function mergeScopeCatalog(previous, next) {
  const prev = previous && typeof previous === 'object' ? previous : {};
  const mergeList = (a, b) => unique([...(Array.isArray(a) ? a : []), ...(Array.isArray(b) ? b : [])])
    .sort((x, y) => x.localeCompare(y, 'tr', { sensitivity: 'base' }));
  const mergeMap = (a, b) => {
    const out = {};
    for (const key of new Set([...Object.keys(a || {}), ...Object.keys(b || {})])) out[key] = mergeList((a || {})[key], (b || {})[key]);
    return out;
  };
  const nestedA = prev.magMmygBuyingGroups || {}, nestedB = next.magMmygBuyingGroups || {};
  const nested = {};
  for (const mag of new Set([...Object.keys(nestedA), ...Object.keys(nestedB)])) nested[mag] = mergeMap(nestedA[mag], nestedB[mag]);
  return {
    mags: mergeList(prev.mags, next.mags),
    mmygs: mergeList(prev.mmygs, next.mmygs),
    buyingGroups: mergeList(prev.buyingGroups, next.buyingGroups),
    magMmyg: mergeMap(prev.magMmyg, next.magMmyg),
    magMmygBuyingGroups: nested,
  };
}
/* ===================================================================
   v7.38 — KATALOĞU DOĞRUDAN ASAS'TAN BESLEME

   Kullanıcı bulgusu (birebir): "Kullanıcı ayarlarında ASAS database'deki
   veriler gelmiyor MAG MMYG ve Buyer Grup alanlarında. Buyer Grup'larda da bir
   kısmı geliyor."

   SEBEP: katalog şimdiye kadar YALNIZ okunmuş sipariş satırlarından
   kuruluyordu (syncProfiles). O satırlar ASAS kaynak filtresinden/ufkundan
   geçmiş satırlardır: kurulum tek bir MAG/MMYG ile sınırlıysa katalog da o
   MAG/MMYG'den ibaret kalır. Ekranda görülen tam olarak buydu — bir MAG, bir
   MMYG ve yalnız o kapsamdaki Buyer Grupları.

   ÇÖZÜM: seçim listeleri için veri modelinden DOĞRUDAN tekil değer okunur;
   bu okuma ufuk/kaynak filtresine TABİ DEĞİLDİR. Sonuç yine BİRLEŞTİRİLİR:
   katalog hiç küçülmez (§142) ve hiçbir yetki kararına girmez (§32).
   =================================================================== */
function mergeCatalogValues(values) {
  const store = loadStore();
  const incoming = {
    mags: unique((values && values.mags) || []),
    mmygs: unique((values && values.mmygs) || []),
    buyingGroups: unique((values && values.buyingGroups) || []),
    magMmyg: {},
    magMmygBuyingGroups: {},
  };
  const scopeCatalog = mergeScopeCatalog(store.scopeCatalog, incoming);
  if (JSON.stringify(store.scopeCatalog || {}) === JSON.stringify(scopeCatalog)) {
    return { store, changed: false, catalog: scopeCatalog };
  }
  if (centralConfigured) {
    centralIam.writeLocalAtomic(path.join(AUTH_DATA_ROOT, 'iam-derived.json'), { orderAccess: store.orderAccess || {}, scopeCatalog });
    return { store: { ...store, scopeCatalog }, changed: true, catalog: scopeCatalog };
  }
  return { store: saveStore({ ...store, scopeCatalog }, store._revision), changed: true, catalog: scopeCatalog };
}

function syncProfiles(orders, options = {}) {
  const authoritative = options && options.authoritative !== false;
  const store = loadStore();
  if (!authoritative) return store;
  const orderAccess = authoritativeOrderAccessFromOrders(orders);
  const scopeCatalog = mergeScopeCatalog(store.scopeCatalog, scopeCatalogFromOrders(orders));
  const orderAccessChanged = JSON.stringify(store.orderAccess || {}) !== JSON.stringify(orderAccess);
  const catalogChanged = JSON.stringify(store.scopeCatalog || {}) !== JSON.stringify(scopeCatalog);
  if (orderAccessChanged || catalogChanged) {
    if (centralConfigured) {
      const generatedAt = new Date().toISOString();
      centralIam.writeLocalAtomic(path.join(AUTH_DATA_ROOT, 'iam-derived.json'), { orderAccess, scopeCatalog, generatedAt });
      publishOrderAuthority(orderAccess, scopeCatalog, generatedAt);
      return { ...store, orderAccess, scopeCatalog };
    }
    return saveStore({ ...store, orderAccess, scopeCatalog }, store._revision);
  }
  // Değişmemiş olsa da hub'da eksikse (hub sonradan bağlandı) yayımlanır;
  // yayın özet karşılaştırmasıyla idempotenttir.
  if (centralConfigured) {
    const local = orderAuthorityShare.readLocalSync(path.join(AUTH_DATA_ROOT, 'iam-derived.json'));
    publishOrderAuthority(orderAccess, scopeCatalog, local && local.generatedAt || new Date().toISOString());
  }
  return store;
}
/* Sipariş sahipliğini Shared Hub'a arka planda yayımlar (bkz.
   order-authority-share.js). Hata yerel başarıyı geri almaz; bir sonraki
   yetkili yenileme yeniden dener. */
function publishOrderAuthority(orderAccess, scopeCatalog, generatedAt) {
  void Promise.resolve().then(async () => {
    const root = await iamSharedRoot();
    return orderAuthorityShare.publishShared(root, { orderAccess, scopeCatalog, generatedBy: 'moderator', generatedAt });
  }).catch(() => {});
}
function mergeScopes(a, b) {
  return {
    buyers: unique([...(a && a.buyers || []), ...(b && b.buyers || [])]),
    mags: unique([...(a && a.mags || []), ...(b && b.mags || [])]),
    mmygs: unique([...(a && a.mmygs || []), ...(b && b.mmygs || [])]),
    buyingGroups: unique([...(a && a.buyingGroups || []), ...(b && b.buyingGroups || [])]),
  };
}
function directEffectiveScopes(profile) {
  if (!profile) return { buyers: [], mags: [], mmygs: [], buyingGroups: [] };
  if (profile.scopeMode === 'custom') {
    const src = profile.customScopes || {};
    return { buyers: unique(src.buyers), mags: unique(src.mags), mmygs: unique(src.mmygs), buyingGroups: unique(src.buyingGroups) };
  }
  if (profile.scopeMode === 'auto') {
    const src = profile.autoScopes || {};
    return { buyers: unique(src.buyers), mags: unique(src.mags), mmygs: unique(src.mmygs), buyingGroups: unique(src.buyingGroups) };
  }
  return {
    buyers: unique([profile.username, profile.displayName]),
    mags: unique(profile.mags), mmygs: unique(profile.mmygs), buyingGroups: unique(profile.buyingGroups),
  };
}
function effectiveScopes(profile, store = readStore()) {
  if (profile && profile.dataScope) return iam.effectiveDataScope(profile, store);
  let scopes = directEffectiveScopes(profile);
  if (profile && ['team_lead', 'manager'].includes(normalizeRole(profile.role))) {
    for (const child of descendantProfiles(store, profile.id)) scopes = mergeScopes(scopes, directEffectiveScopes(child));
  }
  return scopes;
}
function publicProfile(profile, store = readStore()) {
  if (!profile) return null;
  const role = normalizeRole(profile.role), passwordHash = credentialHash(profile);
  return {
    id: profile.id, role, roleLabel: ROLE_LABELS[role], systemRole: profile.systemRole, systemRoleLabel: iam.SYSTEM_ROLES[profile.systemRole],
    centralIamEnabled: centralConfigured, iamRevision: store._revision,
    orgLevel: profile.orgLevel, orgLevelLabel: iam.ORG_LEVELS[profile.orgLevel], status: profile.status,
    username: profile.username,
    displayName: profile.displayName, title: profile.title, email: clean(profile.email),
    legacySourceAccount: Boolean(profile.legacySourceAccount),
    mags: unique(profile.mags), mmygs: unique(profile.mmygs), buyingGroups: unique(profile.buyingGroups),
    enabled: profile.enabled !== false, passwordRequired: Boolean(passwordHash), pinRequired: Boolean(passwordHash),
    needsPasswordSetup: role === 'moderator' && !passwordHash, needsPinSetup: role === 'moderator' && !passwordHash,
    supervisorId: clean(profile.supervisorId) || null,
    scopeMode: profile.scopeMode || 'profile', dataScope: profile.dataScope, scopes: effectiveScopes(profile, store),
    permissions: effectivePermissions(profile, store), accessAreas: effectiveAccessAreas(profile, store),
    capabilities: [...iam.effectivePermissionSet(profile, store)],
    collectionAccess: effectiveCollectionAccess(profile, store),
    delegatedUserIds: descendantProfiles(store, profile.id).map(item => item.id),
    canManageUsers: iam.canAdminUsers(profile, store) || canManageUsers(profile),
  };
}
function findProfile(store, id) { return allProfiles(store).find(u => u.id === id && u.enabled !== false) || null; }
function canEditOrder(profile, order, store = readStore()) {
  if (!profile || !order) return false;
  if (hasPermission(profile, 'manageAllOrders', store)) return true;
  const scopes = effectiveScopes(profile, store);
  if (scopes.all) return true;
  if (scopes.buyers.some(value => norm(value) === norm(order.buyer))) return true;
  const configured = [
    [scopes.mags, order.merch], [scopes.mmygs, order.ageGroup], [scopes.buyingGroups, order.buyerGrup],
  ].filter(([list]) => list.length);
  return configured.length > 0 && configured.every(([list, value]) => clean(value) && list.some(item => norm(item) === norm(value)));
}
function catalogsFromStore(store, options = {}) {
  const mags = [], mmygs = [], buyingGroups = [], titles = [];
  if (options.includeOrderAccess !== false) {
    for (const rows of Object.values(store.orderAccess || {})) for (const row of Array.isArray(rows) ? rows : []) {
      mags.push(row.merch); mmygs.push(row.ageGroup); buyingGroups.push(row.buyerGrup);
    }
  }
  for (const profile of allProfiles(store)) {
    titles.push(profile.title); mags.push(...(profile.mags || [])); mmygs.push(...(profile.mmygs || [])); buyingGroups.push(...(profile.buyingGroups || []));
  }
  titles.push('Buyer', 'Senior Buyer', 'Ekip Lideri', 'Müdür', 'Moderatör');
  return { titles: unique(titles), mags: unique(mags), mmygs: unique(mmygs), buyingGroups: unique(buyingGroups) };
}
function parseCookies(header) {
  const out = {};
  String(header || '').split(';').forEach(part => { const i = part.indexOf('='); if (i < 0) return; const key = part.slice(0, i).trim(); if (key) out[key] = decodeURIComponent(part.slice(i + 1).trim()); });
  return out;
}
function sign(secret, payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${body}.${crypto.createHmac('sha256', secret).update(body).digest('base64url')}`;
}
function verify(secret, token) {
  if (!token || typeof token !== 'string') return null;
  const dot = token.indexOf('.'); if (dot <= 0) return null;
  const body = token.slice(0, dot), sig = token.slice(dot + 1);
  const expected = crypto.createHmac('sha256', secret).update(body).digest();
  let actual; try { actual = Buffer.from(sig, 'base64url'); } catch (_) { return null; }
  if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) return null;
  try { const parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')); return parsed.exp > Date.now() ? parsed : null; } catch (_) { return null; }
}
function initials(name) { return userInitials(clean(name)); }
/* Audit saklama/rotasyon. Varsayılan: aktif dosya 20 MB'ı aşınca zaman damgalı
   arşive TAŞINIR (silinmez); en yeni 24 arşiv tutulur (~500 MB tavan). Ortam:
   BUYER_LOG_AUDIT_MAX_BYTES, BUYER_LOG_AUDIT_MAX_ARCHIVES (0 = arşivleri hiç
   silme). Rotasyon hatası audit yazımını asla engellemez. */
const AUDIT_ARCHIVE_RE = /^user-audit\.(\d{8}T\d{6}Z)(?:-(\d+))?\.jsonl$/;
function auditRetention(env = process.env) {
  const bytes = Number(env.BUYER_LOG_AUDIT_MAX_BYTES), archives = Number(env.BUYER_LOG_AUDIT_MAX_ARCHIVES);
  return {
    maxBytes: Number.isFinite(bytes) && bytes >= 64 * 1024 ? Math.floor(bytes) : 20 * 1024 * 1024,
    maxArchives: Number.isInteger(archives) && archives >= 0 ? archives : 24,
  };
}
function listAuditArchives(dir = AUTH_DATA_ROOT) {
  // Eskiden yeniye: önce zaman damgası, aynı saniyede sayaç (sözlük sırası "-1" ile "."yi ters dizer).
  const key = name => { const m = AUDIT_ARCHIVE_RE.exec(name); return [m[1], Number(m[2] || 0)]; };
  try {
    return fs.readdirSync(dir).filter(name => AUDIT_ARCHIVE_RE.test(name))
      .sort((a, b) => { const [sa, na] = key(a), [sb, nb] = key(b); return sa < sb ? -1 : sa > sb ? 1 : na - nb; });
  } catch (_) { return []; }
}
function rotateAuditIfNeeded(file = AUDIT_FILE, retention = auditRetention()) {
  let size = 0;
  try { size = fs.statSync(file).size; } catch (_) { return false; }
  if (size < retention.maxBytes) return false;
  const dir = path.dirname(file), stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  // Aynı saniyede birden çok rotasyon: sayaç her zaman mevcutların üstüne çıkar ki
  // budanan bir adın yeniden kullanılıp "en eski" sanılması mümkün olmasın.
  const sameStamp = listAuditArchives(dir).map(name => AUDIT_ARCHIVE_RE.exec(name)).filter(m => m[1] === stamp).map(m => Number(m[2] || 0));
  const target = path.join(dir, sameStamp.length ? `user-audit.${stamp}-${Math.max(...sameStamp) + 1}.jsonl` : `user-audit.${stamp}.jsonl`);
  fs.renameSync(file, target);
  if (retention.maxArchives > 0) {
    const archives = listAuditArchives(dir);
    for (const name of archives.slice(0, Math.max(0, archives.length - retention.maxArchives))) {
      try { fs.unlinkSync(path.join(dir, name)); } catch (_) {}
    }
  }
  return target;
}
function appendAudit(profile, action, target, details, requestMeta) {
  const transaction = iamTransaction.getStore();
  if (transaction) { transaction.audit.push({ action, target }); return true; }
  details = backupSafeStore(details);
  try {
    fs.mkdirSync(AUTH_DATA_ROOT, { recursive: true });
    const req = requestMeta && requestMeta.headers ? requestMeta : null;
    const meta = req ? {
      requestId: clean(req.headers['x-request-id']) || crypto.randomUUID(),
      ip: clean(req.headers['x-forwarded-for']).split(',')[0] || clean(req.socket && req.socket.remoteAddress) || null,
      userAgent: clean(req.headers['user-agent']).slice(0, 300) || null,
      method: clean(req.method) || null, path: clean(req.originalUrl || req.path).slice(0, 500) || null,
    } : (requestMeta && typeof requestMeta === 'object' ? requestMeta : null);
    const line = JSON.stringify({ id: `audit-${crypto.randomUUID()}`, at: new Date().toISOString(), actorId: profile && profile.id || null, userId: profile && profile.id || null, actor: profile && profile.displayName || null, user: profile && profile.displayName || null, systemRole: profile && profile.systemRole || null, role: profile && profile.role || null, action, resource: clean(action).split('_')[0] || null, targetId: target || null, target: target || null, oldValue: details && details.oldValue || null, newValue: details && details.newValue || null, reason: details && details.reason || null, details: details || null, request: meta });
    try { rotateAuditIfNeeded(); } catch (rotationError) { console.error('[DATA_INTEGRITY] Audit rotation skipped:', rotationError && rotationError.message || rotationError); }
    fs.appendFileSync(AUDIT_FILE, line + '\n', 'utf8');
    return true;
  } catch (error) {
    // Audit is not the business commit boundary, but losing forensic evidence
    // silently makes recovery impossible to explain. Keep a separate emergency
    // trail and make the actual failure visible in server logs.
    console.error('[DATA_INTEGRITY] Audit record could not be written:', error && error.message || error);
    try {
      fs.mkdirSync(AUTH_DATA_ROOT, { recursive: true });
      fs.appendFileSync(path.join(AUTH_DATA_ROOT, 'user-audit-failures.jsonl'), `${JSON.stringify({
        at: new Date().toISOString(), actorId: profile && profile.id || null,
        action, target: target || null, error: error && error.message || String(error), details: details || null,
      })}\n`, 'utf8');
    } catch (fallbackError) {
      console.error('[DATA_INTEGRITY] Emergency audit trail also failed:', fallbackError && fallbackError.message || fallbackError);
    }
    return false;
  }
}
function readAudit(limit = 200, filters = {}) {
  try {
    const query = clean(filters.query).toLocaleLowerCase('tr-TR'), action = norm(filters.action), actorId = clean(filters.actorId), targetId = clean(filters.targetId);
    const from = Date.parse(filters.from || '') || 0, until = Date.parse(filters.until || '') || Infinity;
    const centralRows = centralConfigured ? getCentralIam().localAudit() : [];
    let legacyRows = []; try { legacyRows = fs.readFileSync(AUDIT_FILE, 'utf8').trim().split('\n').filter(Boolean).reverse().map(line => JSON.parse(line)); } catch (_) {}
    // Rotasyondan hemen sonra görünüm boşalmasın: en yeni arşiv de okunur.
    const latestArchive = listAuditArchives().at(-1);
    if (latestArchive) { try { legacyRows = legacyRows.concat(fs.readFileSync(path.join(AUTH_DATA_ROOT, latestArchive), 'utf8').trim().split('\n').filter(Boolean).reverse().map(line => JSON.parse(line))); } catch (_) {} }
    return [...centralRows, ...legacyRows].filter(item => {
      const at = Date.parse(item.at || '') || 0;
      if (actorId && clean(item.actorId || item.userId) !== actorId) return false;
      if (targetId && clean(item.targetId || item.target) !== targetId) return false;
      if (action && !norm(item.action).includes(action)) return false;
      if (at < from || at > until) return false;
      if (query && !JSON.stringify(item).toLocaleLowerCase('tr-TR').includes(query)) return false;
      return true;
    }).slice(0, Math.max(1, Math.min(2000, Number(limit) || 200)));
  }
  catch (_) { return []; }
}

function buildUserAccess({ ensureDataLoaded, getOrders, centralIam: centralOptions, onIamApplied }) {
  if (typeof onIamApplied === 'function') iamApplied = onIamApplied;
  if (centralOptions) {
    centralConfigured = centralOptions.enabled === true;
    if (typeof centralOptions.getSharedRoot === 'function') iamSharedRoot = centralOptions.getSharedRoot;
    else if (centralOptions.sharedRoot) iamSharedRoot = async () => centralOptions.sharedRoot;
    centralService = centralConfigured ? centralIam.createCentralIam({ ...centralOptions, cacheFile: ACCESS_FILE, onApply: cache => { storeCache = null; reconcilePersonalLogin(cache); iamApplied(cache._revision); }, canApply: () => !restoreActive, canCommit: () => !restoreActive }) : null;
  }
  let authoritySnapshot = readStore().orderAccess || {};
  const runtimeSecret = crypto.randomBytes(32), ttlMs = SESSION_HOURS * 3600 * 1000, loginAttempts = new Map();
  function loginAttemptKey(req, username) {
    const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    return `${forwarded || req.socket && req.socket.remoteAddress || 'local'}|${usernameKey(username)}`;
  }
  function loginLock(req, username) {
    const key = loginAttemptKey(req, username), now = Date.now(), state = loginAttempts.get(key);
    if (!state) return null;
    if (now - state.lastAt > LOGIN_FAILURE_WINDOW_MS) { loginAttempts.delete(key); return null; }
    if (state.lockedUntil > now) return { key, retryAfter: Math.max(1, Math.ceil((state.lockedUntil - now) / 1000)) };
    return { key, retryAfter: 0 };
  }
  function recordLoginFailure(req, username) {
    const key = loginAttemptKey(req, username), now = Date.now(), previous = loginAttempts.get(key);
    const fresh = !previous || now - previous.lastAt > LOGIN_FAILURE_WINDOW_MS;
    const failures = fresh ? 1 : previous.failures + 1;
    loginAttempts.set(key, { failures, lastAt: now, lockedUntil: failures >= LOGIN_FAILURE_LIMIT ? now + LOGIN_LOCK_MS : 0 });
    return failures;
  }
  function clearLoginFailures(req, username) { loginAttempts.delete(loginAttemptKey(req, username)); }
  function sessionProfile(req) {
    const token = parseCookies(req.headers.cookie)[COOKIE_NAME], payload = verify(runtimeSecret, token);
    if (!payload) return null;
    const profile = findProfile(readStore(), payload.uid);
    if (!profile || profile.enabled === false || profile.status !== 'ACTIVE') return null;
    if ((payload.credentialRevision || 1) !== (profile.credentialRevision || 1) ||
      (payload.accessRevision || 1) !== (profile.accessRevision || 1)) return null;
    // Keep request-local mutation isolation without cloning the entire IAM store.
    // Downstream handlers historically received a private profile object from
    // loadStore(); preserving that contract avoids accidental cache mutation.
    return JSON.parse(JSON.stringify(profile));
  }
  function setCookie(req, res, userId) {
    const profile = findProfile(readStore(), userId);
    const parts = [`${COOKIE_NAME}=${encodeURIComponent(sign(runtimeSecret, { uid: userId, userId: profile && profile.userId || userId, credentialRevision: profile && profile.credentialRevision || 1, accessRevision: profile && profile.accessRevision || 1, exp: Date.now() + ttlMs }))}`, 'Path=/', 'HttpOnly', 'SameSite=Strict'];
    if (req.secure || String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim().toLowerCase() === 'https') parts.push('Secure');
    res.append('Set-Cookie', parts.join('; '));
  }
  function clearCookie(req, res) {
    const parts = [`${COOKIE_NAME}=`, 'Path=/', 'HttpOnly', 'SameSite=Strict', 'Max-Age=0'];
    if (req.secure) parts.push('Secure'); res.append('Set-Cookie', parts.join('; '));
  }
  async function sync(userId = 'moderator') {
    const existing = loadStore();
    try {
      await ensureDataLoaded(userId);
      const saved = syncProfiles(getOrders(userId), { authoritative: userId === 'moderator' });
      authoritySnapshot = saved.orderAccess || authoritySnapshot; return saved;
    } catch (_) { return existing; }
  }
  function syncProfilesForAccess(orders, options = {}) {
    const saved = syncProfiles(orders, options); authoritySnapshot = saved.orderAccess || authoritySnapshot; return saved;
  }
  function authoritativeOrderRows(orderCode) {
    const code = String(Number(orderCode));
    return code === 'NaN' ? [] : (Array.isArray(authoritySnapshot[code]) ? authoritySnapshot[code] : []);
  }
  /* Merkezi IAM kipinde Moderatörün hub'a yayımladığı sipariş sahipliğini
     çeker. Yalnız doğrulanmış ve yerelden YENİ belge uygulanır; ağ yoksa son
     yerel kopyayla devam edilir (düzenleme yetkisi çevrimdışında da tutarlı). */
  let orderAuthorityPull = null;
  function refreshOrderAuthority({ timeoutMs = 1500 } = {}) {
    if (!centralConfigured || restoreActive) return Promise.resolve(false);
    if (!orderAuthorityPull) {
      orderAuthorityPull = (async () => {
        const root = await iamSharedRoot();
        const shared = await orderAuthorityShare.readShared(root);
        const localFile = path.join(AUTH_DATA_ROOT, 'iam-derived.json');
        const next = orderAuthorityShare.newerThanLocal(shared, orderAuthorityShare.readLocalSync(localFile));
        if (!next) return false;
        centralIam.writeLocalAtomic(localFile, { orderAccess: next.orderAccess, scopeCatalog: next.scopeCatalog, generatedAt: next.generatedAt });
        storeCache = null; authoritySnapshot = next.orderAccess;
        return true;
      })().catch(() => false).finally(() => { orderAuthorityPull = null; });
    }
    let timer;
    return Promise.race([orderAuthorityPull, new Promise(resolve => { timer = setTimeout(() => resolve(false), timeoutMs); })]).finally(() => clearTimeout(timer));
  }
  const orderAuthorityTimer = setInterval(() => { void refreshOrderAuthority({ timeoutMs: 15000 }); }, 60000);
  if (orderAuthorityTimer.unref) orderAuthorityTimer.unref();
  // Login autocomplete must remain a tiny auth-directory operation. It must not
  // expose role/scope/permission data and must never touch Buyer Log datasets.
  // The index is revision-bound, so User Management changes are visible without
  // restarting the server while repeated keystrokes avoid rebuilding the list.
  let suggestionIndexCache = { revision: null, items: [] };
  function foldLoginSearch(value) {
    return clean(value)
      .toLocaleLowerCase('tr-TR')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/ı/g, 'i')
      .replace(/ş/g, 's')
      .replace(/ğ/g, 'g')
      .replace(/ç/g, 'c')
      .replace(/ö/g, 'o')
      .replace(/ü/g, 'u')
      .replace(/\s+/g, ' ');
  }
  function safeSuggestion(profile) {
    const role = normalizeRole(profile.role);
    return {
      loginName: clean(profile.username),
      displayName: clean(profile.displayName || profile.username),
      needsPasswordSetup: role === 'moderator' && !credentialHash(profile),
    };
  }
  function suggestionIndex(store) {
    const revision = `${Number(store && store._revision) || 0}:${allProfiles(store).length}:${store && store._personalLoginFallback ? 'personal' : 'directory'}`;
    if (suggestionIndexCache.revision === revision) return suggestionIndexCache.items;
    const items = allProfiles(store).filter(profile => profile && profile.enabled !== false).map(profile => {
      const dto = safeSuggestion(profile);
      const username = foldLoginSearch(dto.loginName), displayName = foldLoginSearch(dto.displayName);
      const words = `${username} ${displayName}`.split(/\s+/).filter(Boolean);
      return { dto, username, displayName, words };
    });
    suggestionIndexCache = { revision, items };
    return items;
  }
  function suggestionRank(item, q) {
    const fields = [item.username, item.displayName].filter(Boolean);
    if (fields.some(value => value === q)) return 0;
    if (fields.some(value => value.startsWith(q))) return 1;
    if (item.words.some(value => value.startsWith(q))) return 2;
    if (fields.some(value => value.includes(q))) return 3;
    return 99;
  }
  function suggestions(query) {
    const q = foldLoginSearch(query);
    if (!q) return [];
    const store = readStore();
    return suggestionIndex(store)
      .map(item => ({ item, rank: suggestionRank(item, q) }))
      .filter(entry => entry.rank < 99)
      .sort((a, b) => a.rank - b.rank || a.item.dto.displayName.localeCompare(b.item.dto.displayName, 'tr', { sensitivity: 'base' }))
      .slice(0, 8)
      .map(entry => entry.item.dto);
  }
  function suggestHandler(req, res) {
    res.set('Cache-Control', 'no-store');
    const users = suggestions(req.query && req.query.q);
    res.json({ users, suggestions: users }); // suggestions = legacy response alias
  }
  // Legacy admin/list consumers keep the old response property name, but the
  // payload is deliberately login-safe as well.
  function listHandler(req, res) { res.json({ profiles: suggestions(req.query && req.query.q), revision: readStore()._revision }); }
  async function loginHandler(req, res) {
    try {
      if (centralConfigured) { await getCentralIam().preflight(); await refreshOrderAuthority(); }
      const store = loadStore();
      if (centralConfigured && !allProfiles(store).length) return res.status(503).json({ error: 'Merkezi kullanıcı dizini alınamadı ve geçerli yerel kullanıcı önbelleği yok.', code: 'IAM_NOT_INITIALIZED' });
      const username = clean(req.body && req.body.username);
      const fallbackId = clean(req.body && req.body.userId);
      const profile = username ? profileByUsername(store, username) : findProfile(store, fallbackId);
      const attemptName = username || profile && profile.username || fallbackId;
      const lock = loginLock(req, attemptName);
      if (lock && lock.retryAfter) {
        res.set('Retry-After', String(lock.retryAfter));
        return res.status(429).json({ error: `Çok fazla hatalı deneme. ${lock.retryAfter} saniye sonra tekrar deneyin.`, code: 'LOGIN_TEMPORARILY_LOCKED', retryAfter: lock.retryAfter });
      }
      if (!profile) return res.status(401).json({ error: 'Kullanıcı adı veya şifre hatalı.', code: 'BAD_CREDENTIALS' });
      if (profile.enabled === false) return res.status(403).json({ error: 'Bu kullanıcı hesabı pasif durumda.', code: 'USER_INACTIVE' });
      let stored = credentialHash(profile);
      if (!stored) {
        if (centralConfigured) return res.status(503).json({ error: 'Merkezi kullanıcı dizini için mevcut bir yönetici parolası gereklidir.', code: 'IAM_CREDENTIAL_SETUP_REQUIRED' });
        const newPassword = clean(req.body && (req.body.newPassword || req.body.newPin));
        if (normalizeRole(profile.role) !== 'moderator') return res.status(428).json({ error: 'Bu kullanıcı için bir yönetici tarafından şifre atanmalıdır.', code: 'PASSWORD_ADMIN_SETUP_REQUIRED' });
        if (!newPassword) return res.status(428).json({ error: 'İlk kullanımda Moderatör şifresini oluşturun.', code: 'PASSWORD_SETUP_REQUIRED' });
        if (newPassword.length < PASSWORD_MIN_LENGTH) return res.status(400).json({ error: `Şifre en az ${PASSWORD_MIN_LENGTH} karakter olmalı.`, code: 'PASSWORD_TOO_SHORT' });
        profile.passwordHash = hashPin(newPassword); profile.pinHash = profile.passwordHash; stored = profile.passwordHash;
        saveStore(store, store._revision); appendAudit(profile, 'PASSWORD_SETUP', 'moderator');
      }
      const password = req.body && (req.body.password != null ? req.body.password : req.body.pin);
      if (!verifyPin(password, stored)) {
        const failures = recordLoginFailure(req, attemptName); appendAudit(profile, 'LOGIN_FAILED', 'session', { failures });
        return res.status(401).json({ error: 'Kullanıcı adı veya şifre hatalı.', code: 'BAD_PASSWORD' });
      }
      clearLoginFailures(req, attemptName); setCookie(req, res, profile.id); appendAudit(profile, 'LOGIN', 'session');
      // Giriş bilgisi yalnız bu kişi için yerelde de saklanır; merkezi dizin ve
      // önbellek kaybolsa bile bu cihazda kendi hesabıyla girebilir.
      try { personalLogin.remember(profile, store); } catch (_) {}
      res.json({ ok: true, user: { ...publicProfile(profile, readStore()), initials: initials(profile.displayName) } });
    } catch (err) { res.status(500).json({ error: 'Kullanıcı oturumu başlatılamadı.', code: 'USER_LOGIN_FAILED' }); }
  }
  function logoutHandler(req, res) { const profile = sessionProfile(req); appendAudit(profile, 'LOGOUT', 'session'); clearCookie(req, res); res.json({ ok: true }); }
  function currentHandler(req, res) { const store = readStore(), profile = sessionProfile(req); res.json({ selected: Boolean(profile), user: profile ? { ...publicProfile(profile, store), initials: initials(profile.displayName) } : null }); }
  function requireSelection(req, res, next) {
    const allowed = new Set(['/select-user', '/select-user/', '/select-user.html', '/api/user-profiles', '/api/user-suggestions', '/api/auth/users/suggest', '/api/user-login', '/api/user-logout', '/api/current-user', '/api/health', '/api/status', '/api/iam/health']);
    if (allowed.has(req.path)) return next();
    const profile = sessionProfile(req);
    if (profile) { req.currentUser = profile; return next(); }
    if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Önce kullanıcı adı ve şifreyle giriş yapın.', code: 'USER_LOGIN_REQUIRED' });
    return res.redirect(302, '/select-user.html');
  }
  function requireModerator(req, res, next) {
    const profile = req.currentUser || sessionProfile(req);
    if (profile && profile.systemRole === 'moderator') return next();
    return res.status(403).json({ error: 'Bu işlem yalnız Moderatör tarafından yapılabilir.', code: 'MODERATOR_REQUIRED' });
  }
  function requireUserAdmin(req, res, next) {
    const profile = req.currentUser || sessionProfile(req), store = readStore();
    if (profile && iam.canAdminUsers(profile, store)) return next();
    return res.status(403).json({ error: 'Kullanıcı yönetimi için yönetici yetkisi gerekir.', code: 'USER_ADMIN_REQUIRED' });
  }
  function requireCapability(permission) {
    return (req, res, next) => {
      const profile = req.currentUser || sessionProfile(req), store = readStore();
      if (profile && iam.hasPermission(profile, permission, store)) return next();
      return res.status(403).json({ error: 'Bu işlem için gerekli merkezi yetki bulunmuyor.', code: 'CAPABILITY_REQUIRED', permission });
    };
  }
  function requirePermission(permission) {
    return (req, res, next) => {
      const profile = req.currentUser || sessionProfile(req), store = readStore();
      if (profile && hasPermission(profile, permission, store)) return next();
      return res.status(403).json({ error: 'Bu işlem için gerekli kullanıcı yetkisi bulunmuyor.', code: 'PERMISSION_REQUIRED', permission });
    };
  }
  function requireArea(area) {
    return (req, res, next) => {
      const profile = req.currentUser || sessionProfile(req), store = readStore();
      if (profile && hasArea(profile, area, store)) return next();
      return res.status(403).json({ error: 'Bu yetki alanına erişiminiz bulunmuyor.', code: 'ACCESS_AREA_REQUIRED', area });
    };
  }
  function requireAnyArea(...areas) {
    const allowed = areas.flat().map(clean).filter(key => ACCESS_AREA_KEYS.includes(key));
    return (req, res, next) => {
      const profile = req.currentUser || sessionProfile(req), store = readStore();
      if (profile && allowed.some(area => hasArea(profile, area, store))) return next();
      return res.status(403).json({ error: 'Bu işlem için gerekli yetki alanı bulunmuyor.', code: 'ACCESS_AREA_REQUIRED', areas: allowed });
    };
  }
  function adminUser(profile, store, actor) {
    const role = normalizeRole(profile.role);
    const assigned = iam.assignedPermissionDetails(profile, store), effective = iam.effectivePermissionDetails(profile, store);
    return {
      id: profile.id, role, roleLabel: ROLE_LABELS[role], username: profile.username,
      displayName: profile.displayName, title: profile.title, email: clean(profile.email),
      systemRole: profile.systemRole, systemRoleLabel: iam.SYSTEM_ROLES[profile.systemRole],
      orgLevel: profile.orgLevel, orgLevelLabel: iam.ORG_LEVELS[profile.orgLevel], status: profile.status,
      managerId: clean(profile.managerId || profile.supervisorId) || null, stableIds: profile.stableIds,
      identityKey: profile.identityKey, external: Boolean(profile.external),
      mags: unique(profile.mags), mmygs: unique(profile.mmygs), buyingGroups: unique(profile.buyingGroups),
      enabled: profile.enabled !== false, legacySourceAccount: Boolean(profile.legacySourceAccount),
      hasPassword: Boolean(credentialHash(profile)),
      supervisorId: clean(profile.supervisorId) || null, scopeMode: profile.scopeMode || 'profile',
      ownPermissions: role === 'moderator' ? roleBasePermissions(profile) : normalizePermissions(profile.permissions),
      ownAccessAreas: role === 'moderator' ? normalizeAccessAreas(null, true) : normalizeAccessAreas(profile.accessAreas, true),
      directCollectionAccess: normalizeCollectionAccess(profile.collectionAccess),
      customScopes: directEffectiveScopes({ ...profile, scopeMode: 'custom' }), dataScope: profile.dataScope,
      directPermissions: profile.directPermissions || [], temporaryPermissions: profile.temporaryPermissions || [],
      assignedPermissions: assigned, effectivePermissions: effective,
      canEdit: canManageTarget(actor, profile, store),
      updatedAt: profile.updatedAt || null,
    };
  }
  function visibleAdminProfiles(actor, store) {
    return actor.systemRole === 'moderator' ? allProfiles(store) : [actor, ...descendantProfiles(store, actor.id)];
  }
  // Buyer/personel rehberi: kullanıcı oluşturma otomatik tamamlaması ve MAG/MMYG
  // ön doldurması buradan beslenir. Kaynak, ASAS siparişlerinden türeyen
  // store.orderAccess kayıtlarıdır; kişi başına tek satır üretilir.
  function buyerDirectoryEntries(store) {
    const byName = new Map();
    for (const rows of Object.values(store.orderAccess || {})) for (const row of Array.isArray(rows) ? rows : []) {
      const name = clean(row && row.buyer); if (!name) continue;
      const key = norm(name);
      if (!byName.has(key)) byName.set(key, { displayName: name, mags: new Set(), mmygs: new Set(), buyingGroups: new Set() });
      const entry = byName.get(key);
      if (clean(row.merch)) entry.mags.add(clean(row.merch));
      if (clean(row.ageGroup)) entry.mmygs.add(clean(row.ageGroup));
      if (clean(row.buyerGrup)) entry.buyingGroups.add(clean(row.buyerGrup));
    }
    const byIdentity = new Map(), byUsername = new Map();
    for (const profile of allProfiles(store)) {
      for (const identity of iam.identityKeys(profile.stableIds)) if (!byIdentity.has(identity)) byIdentity.set(identity, profile.id);
      const label = norm(profile.username || profile.displayName); if (label && !byUsername.has(label)) byUsername.set(label, profile.id);
    }
    const sortText = values => [...values].sort((a, b) => a.localeCompare(b, 'tr', { sensitivity: 'base' }));
    return [...byName.values()]
      .sort((a, b) => a.displayName.localeCompare(b.displayName, 'tr', { sensitivity: 'base' }))
      .map(entry => {
        const buyerId = crypto.createHash('sha256').update(norm(entry.displayName)).digest('hex').slice(0, 20);
        const stableIds = { employeeId: '', corporateId: '', buyerId, sourceId: `asas-buyer:${buyerId}`, email: '' };
        // Mükerrer hesap kontrolü isim değil sabit kimlik üzerinden yapılır; isim
        // eşleşmesi yalnız sabit kimliği olmayan eski kayıtlar için yedek yoldur.
        const existingUserId = iam.identityKeys(stableIds).map(key => byIdentity.get(key)).find(Boolean)
          || byUsername.get(norm(entry.displayName)) || null;
        return {
          source: 'ASAS', displayName: entry.displayName, username: entry.displayName, title: 'Buyer',
          mags: sortText(entry.mags), mmygs: sortText(entry.mmygs), buyingGroups: sortText(entry.buyingGroups),
          stableIds, existingUserId, existing: Boolean(existingUserId),
        };
      });
  }
  function identityCandidates(store) {
    return buyerDirectoryEntries(store).map(({ mags, mmygs, buyingGroups, existingUserId, ...rest }) => rest);
  }
  // MAG → MMYG bağımlılığı: MMYG listesi seçilen MAG ile sınırlansın diye
  // gerçek sipariş kayıtlarındaki eşleşmelerden kurulur.
  function magMmygCatalog(store) {
    const map = new Map();
    // v7.25: birikimli katalog ÖNCE gelir; orderAccess yalnız katalog henüz
    // oluşmamış eski kurulumlar için geri düşüş olarak eklenir.
    const catalog = (store && store.scopeCatalog) || {};
    for (const [mag, list] of Object.entries(catalog.magMmyg || {})) {
      const key = clean(mag); if (!key) continue;
      if (!map.has(key)) map.set(key, new Set());
      for (const value of Array.isArray(list) ? list : []) { const mmyg = clean(value); if (mmyg) map.get(key).add(mmyg); }
    }
    for (const value of Array.isArray(catalog.mags) ? catalog.mags : []) { const mag = clean(value); if (mag && !map.has(mag)) map.set(mag, new Set()); }
    for (const rows of Object.values(store.orderAccess || {})) for (const row of Array.isArray(rows) ? rows : []) {
      const mag = clean(row && row.merch); if (!mag) continue;
      if (!map.has(mag)) map.set(mag, new Set());
      const mmyg = clean(row.ageGroup); if (mmyg) map.get(mag).add(mmyg);
    }
    const out = {};
    for (const mag of [...map.keys()].sort((a, b) => a.localeCompare(b, 'tr', { sensitivity: 'base' }))) {
      out[mag] = [...map.get(mag)].sort((a, b) => a.localeCompare(b, 'tr', { sensitivity: 'base' }));
    }
    return out;
  }
  /* v7.23 — MAG / MMYG → BUYING GROUP kataloğu.

     Kullanıcı talebi: "X kullanıcısı Y MAG'ında Z MMYG'sinde D ve B Buying
     Gruplarından sorumlu bilgisi kullanıcı kartlarında oluşturulsun."

     Seçenekler UYDURULMAZ: gerçek sipariş kayıtlarındaki (orderAccess)
     merch / ageGroup / buyerGrup üçlülerinden kurulur. Böylece kullanıcıya
     yalnız o MAG+MMYG'de GERÇEKTEN var olan Buying Group'lar sunulur. */
  function buyingGroupCatalog(store) {
    const byMag = new Map(), all = new Set();
    const catalog = (store && store.scopeCatalog) || {};
    for (const value of Array.isArray(catalog.buyingGroups) ? catalog.buyingGroups : []) { const group = clean(value); if (group) all.add(group); }
    for (const [mag, byMmyg] of Object.entries(catalog.magMmygBuyingGroups || {})) {
      const magKey = clean(mag); if (!magKey) continue;
      if (!byMag.has(magKey)) byMag.set(magKey, new Map());
      for (const [mmyg, list] of Object.entries(byMmyg || {})) {
        const key = clean(mmyg);
        if (!byMag.get(magKey).has(key)) byMag.get(magKey).set(key, new Set());
        for (const value of Array.isArray(list) ? list : []) { const group = clean(value); if (group) byMag.get(magKey).get(key).add(group); }
      }
    }
    for (const rows of Object.values(store.orderAccess || {})) for (const row of Array.isArray(rows) ? rows : []) {
      const group = clean(row && row.buyerGrup); if (!group) continue;
      all.add(group);
      const mag = clean(row.merch), mmyg = clean(row.ageGroup);
      if (!mag) continue;
      if (!byMag.has(mag)) byMag.set(mag, new Map());
      const key = mmyg || '';
      if (!byMag.get(mag).has(key)) byMag.get(mag).set(key, new Set());
      byMag.get(mag).get(key).add(group);
    }
    const sortTr = (a, b) => a.localeCompare(b, 'tr', { sensitivity: 'base' });
    const out = {};
    for (const [mag, mmygMap] of byMag) {
      out[mag] = {};
      for (const [mmyg, groups] of mmygMap) out[mag][mmyg] = [...groups].sort(sortTr);
    }
    return { byMagMmyg: out, all: [...all].sort(sortTr) };
  }
  function adminListHandler(req, res) {
    const store = readStore(), actor = req.currentUser || sessionProfile(req), visible = visibleAdminProfiles(actor, store);
    const mapped = visible.map(profile => adminUser(profile, store, actor));
    const directory = buyerDirectoryEntries(store);
    res.json({
      actor: publicProfile(actor, store), profiles: mapped, centralIam: centralConfigured ? getCentralIam().health() : { enabled: false },
      moderator: mapped.find(item => item.id === 'moderator') || null,
      users: mapped.filter(item => item.id !== 'moderator'),
      roles: ROLE_LABELS, permissionKeys: PERMISSION_KEYS, areaKeys: ACCESS_AREA_KEYS,
      orgLevels: iam.ORG_LEVELS, systemRoles: iam.SYSTEM_ROLES, statuses: iam.USER_STATUSES,
      dataScopeModes: iam.DATA_SCOPE_MODES, permissionRegistry: iam.PERMISSION_REGISTRY,
      resources: iam.RESOURCES, actions: iam.ACTIONS,
      roleDefinitions: iam.normalizeRoles(store.iam && store.iam.roles),
      workspaceTemplates: workspaceTemplateSummaries(store),
      identityCandidates: directory.map(({ mags, mmygs, buyingGroups, existingUserId, ...rest }) => rest),
      directory, magMmyg: magMmygCatalog(store), buyingGroupCatalog: buyingGroupCatalog(store),
      // Buyer Log yerel kullanıcı adı/parola doğrulaması kullanıyor; kurumsal SSO
      // devreye girerse burası değişir ve arayüz parola bölümünü gizler.
      authMode: 'local', passwordMinLength: PASSWORD_MIN_LENGTH,
      // v7.25: seçim listeleri birikimli ASAS kataloğundan da beslenir; böylece
      // adedi sıfırlanmış veya ufuk dışında kalan bir değer listeden düşmez.
      catalogs: (() => {
        const base = catalogsFromStore(store, { includeOrderAccess: false });
        const catalog = (store && store.scopeCatalog) || {};
        return {
          ...base,
          mags: unique([...base.mags, ...(catalog.mags || [])]),
          mmygs: unique([...base.mmygs, ...(catalog.mmygs || [])]),
          buyingGroups: unique([...base.buyingGroups, ...(catalog.buyingGroups || [])]),
        };
      })(), canCreate: canManageUsers(actor), canCopyProfiles: iam.hasPermission(actor, 'USER.PROFILE_COPY', store), revision: store._revision,
      audit: iam.hasPermission(actor, 'AUDIT.VIEW', store) ? readAudit(200) : [],
    });
  }
  function ensureUniqueUsername(store, username, exceptId = '') {
    const key = usernameKey(username);
    if (!key) throw hierarchyError('Kullanıcı adı zorunludur.', 'USERNAME_REQUIRED');
    if (allProfiles(store).some(profile => profile.id !== exceptId && usernameKey(profile.username) === key)) throw hierarchyError('Bu kullanıcı adı zaten kullanılıyor.', 'USERNAME_EXISTS');
  }
  function validateActorAssignment(actor, target, store) {
    if (actor.systemRole === 'moderator' && iam.canAdminUsers(actor, store)) return;
    if (!canManageTarget(actor, target, store)) throw Object.assign(new Error('Yalnız size bağlı kullanıcıları yönetebilirsiniz.'), { statusCode: 403, code: 'USER_NOT_MANAGEABLE' });
    if (ROLE_LEVEL[normalizeRole(target.role)] >= ROLE_LEVEL[normalizeRole(actor.role)]) throw Object.assign(new Error('Kendi rolünüzle aynı veya daha üst bir rol atayamazsınız.'), { statusCode: 403, code: 'ROLE_ESCALATION_DENIED' });
    const supervisor = target.supervisorId ? profileById(store, target.supervisorId) : null;
    if (supervisor && supervisor.id !== actor.id && !descendantProfiles(store, actor.id).some(item => item.id === supervisor.id)) throw Object.assign(new Error('Kullanıcı yalnız kendi yönetim alanınızdaki bir yöneticiye bağlanabilir.'), { statusCode: 403, code: 'SUPERVISOR_SCOPE_DENIED' });
    // The target subtree must not be allowed to bootstrap the manager's own
    // grantable rights. Calculate delegation bounds without the edited user
    // and its descendants; otherwise checking the post-edit effective rights
    // would make privilege escalation self-fulfilling.
    const excluded = new Set([target.id, ...descendantProfiles(store, target.id).map(item => item.id)]);
    const actorAreas = directAccessAreas(actor), actorPermissions = roleBasePermissions(actor);
    for (const child of descendantProfiles(store, actor.id)) {
      if (excluded.has(child.id)) continue;
      const childAreas = directAccessAreas(child), childPermissions = roleBasePermissions(child);
      for (const key of ACCESS_AREA_KEYS) actorAreas[key] = actorAreas[key] || childAreas[key];
      for (const key of PERMISSION_KEYS) actorPermissions[key] = actorPermissions[key] || childPermissions[key];
    }
    for (const key of ACCESS_AREA_KEYS) if (target.accessAreas[key] && !actorAreas[key]) throw Object.assign(new Error('Sahip olmadığınız bir yetki alanını devredemezsiniz.'), { statusCode: 403, code: 'ACCESS_ESCALATION_DENIED' });
    for (const key of PERMISSION_KEYS) if (target.permissions[key] && !actorPermissions[key]) throw Object.assign(new Error('Sahip olmadığınız bir işlem yetkisini devredemezsiniz.'), { statusCode: 403, code: 'PERMISSION_ESCALATION_DENIED' });
  }
  function legacyRoleFromIam(systemRole, orgLevel) {
    if (systemRole === 'moderator') return 'moderator';
    if (systemRole === 'senior_manager') return 'manager';
    if (systemRole === 'manager') return 'team_lead';
    return 'buyer';
  }
  function assertSensitiveChange(actor, target, body, store) {
    const selfPrivilegeChange = actor.id === target.id && (
      (body.systemRole != null && body.systemRole !== target.systemRole) ||
      ['permissionCodes', 'directPermissions', 'temporaryPermissions'].some(key => Object.prototype.hasOwnProperty.call(body, key))
    );
    if (selfPrivilegeChange) throw Object.assign(new Error('Kullanıcı kendi rolünü veya yetkilerini değiştiremez.'), { statusCode: 403, code: 'SELF_ESCALATION_DENIED' });
    if (body.systemRole && (body.__creating || body.systemRole !== target.systemRole)) {
      if (!iam.isPrivilegedRole(actor.systemRole) || !iam.hasPermission(actor, 'USER.GRANT', store)) throw Object.assign(new Error('Sistem rolü atamak için USER.GRANT yetkisi gerekir.'), { statusCode: 403, code: 'ROLE_ESCALATION_DENIED' });
      if (body.systemRole !== 'buyer' && !clean(body.reason)) throw hierarchyError('Yükseltilmiş sistem rolü için gerekçe zorunludur.', 'GRANT_REASON_REQUIRED');
      if (body.systemRole === 'moderator') {
        if (!body.confirmCritical || !clean(body.reason)) throw hierarchyError('Moderatör ataması için onay ve gerekçe zorunludur.', 'CRITICAL_CONFIRMATION_REQUIRED');
      }
    }
    if (body.external === true && actor.systemRole !== 'moderator') throw Object.assign(new Error('Harici kullanıcıyı yalnız Moderatör oluşturabilir.'), { statusCode: 403, code: 'EXTERNAL_USER_ADMIN_REQUIRED' });
    if (Array.isArray(body.permissionCodes)) {
      const previous = new Set((target.directPermissions || []).map(item => item.permission)), next = new Set(body.permissionCodes.map(norm));
      const changed = new Set([...previous, ...next].filter(code => previous.has(code) !== next.has(code)));
      for (const permission of changed) if (!iam.canGrant(actor, permission, store)) throw Object.assign(new Error(`Sahip olmadığınız ${permission} yetkisini veremez veya geri alamazsınız.`), { statusCode: 403, code: 'PERMISSION_ESCALATION_DENIED', permission });
      if ([...next].some(code => iam.isSecurityPermission(code) || /\.(MANAGE|GRANT)$/.test(code)) && !clean(body.reason)) throw hierarchyError('Yüksek yetkiler için gerekçe zorunludur.', 'GRANT_REASON_REQUIRED');
    }
  }
  function applyBodyToTarget(store, target, body, actor) {
    if (centralConfigured) {
      const disabling = body.enabled === false || (body.status && body.status !== 'ACTIVE');
      const resetting = Object.prototype.hasOwnProperty.call(body, 'password') || Object.prototype.hasOwnProperty.call(body, 'pin');
      const demoting = target.systemRole === 'moderator' && body.systemRole && body.systemRole !== 'moderator';
      if (disabling && actor.id === target.id) throw Object.assign(new Error('Kendi hesabınızı pasifleştiremezsiniz.'), { code: 'IAM_SELF_DISABLE_DENIED', statusCode: 403 });
      if ((disabling || resetting || demoting) && body.confirmCritical !== true) throw hierarchyError('Bu hassas değişiklik için açık onay gerekir.', 'CRITICAL_CONFIRMATION_REQUIRED');
    }
    assertSensitiveChange(actor, target, body, store);
    if (body.username != null) { ensureUniqueUsername(store, body.username, target.id); target.username = clean(body.username).slice(0, 120); }
    if (body.displayName != null) target.displayName = (clean(body.displayName) || target.username).slice(0, 120);
    if (body.email != null) {
      const email = clean(body.email).toLocaleLowerCase('tr-TR');
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw hierarchyError('Geçerli bir e-posta adresi girin.', 'INVALID_EMAIL');
      target.email = email.slice(0, 254);
    }
    if (body.title != null) target.title = clean(body.title).slice(0, 120);
    if (body.status != null && target.id !== 'moderator') {
      const status = norm(body.status); if (!Object.prototype.hasOwnProperty.call(iam.USER_STATUSES, status)) throw hierarchyError('Geçersiz kullanıcı durumu.', 'INVALID_USER_STATUS');
      target.status = status; target.enabled = status === 'ACTIVE';
    } else if (body.enabled != null && target.id !== 'moderator') { target.enabled = Boolean(body.enabled); target.status = target.enabled ? 'ACTIVE' : 'INACTIVE'; }
    if (body.systemRole != null && target.id !== 'moderator') {
      if (!Object.prototype.hasOwnProperty.call(iam.SYSTEM_ROLES, body.systemRole)) throw hierarchyError('Geçersiz sistem rolü.', 'INVALID_SYSTEM_ROLE');
      target.systemRole = body.systemRole;
    }
    if (body.orgLevel != null) {
      if (!Object.prototype.hasOwnProperty.call(iam.ORG_LEVELS, body.orgLevel)) throw hierarchyError('Geçersiz organizasyon seviyesi.', 'INVALID_ORG_LEVEL');
      target.orgLevel = body.orgLevel;
    }
    if (body.role != null && target.id !== 'moderator') {
      if (!isKnownRole(body.role)) throw hierarchyError('Geçersiz kullanıcı rolü.', 'INVALID_ROLE');
      target.role = normalizeRole(body.role);
    }
    if (target.id === 'moderator') { target.role = 'moderator'; target.systemRole = 'moderator'; target.status = 'ACTIVE'; target.enabled = true; }
    // v7.25: Moderatör hesabı da bir yöneticiye bağlanabilir.
    if (body.managerId !== undefined || body.supervisorId !== undefined) target.managerId = target.supervisorId = clean(body.managerId !== undefined ? body.managerId : body.supervisorId) || null;
    target.role = legacyRoleFromIam(target.systemRole, target.orgLevel);
    if (body.mags !== undefined) target.mags = unique(body.mags);
    if (body.mmygs !== undefined) target.mmygs = unique(body.mmygs);
    if (body.buyingGroups !== undefined) target.buyingGroups = unique(body.buyingGroups);
    if (body.applyRoleDraft && target.id !== 'moderator') {
      const draft = roleDraft(target.role); target.permissions = draft.permissions; target.accessAreas = draft.accessAreas;
    }
    if (body.permissions && target.id !== 'moderator') target.permissions = normalizePermissions(body.permissions);
    if (body.accessAreas && target.id !== 'moderator') target.accessAreas = normalizeAccessAreas(body.accessAreas, false);
    if (target.id === 'moderator') target.accessAreas = normalizeAccessAreas(null, true);
    if (body.collectionAccess && target.id !== 'moderator') {
      const knownIds = new Set(allProfiles(store).map(item => item.id));
      target.collectionAccess = normalizeCollectionAccess(body.collectionAccess).filter(item => item.ownerId !== target.id && knownIds.has(item.ownerId));
    }
    if (['profile', 'custom', 'auto'].includes(body.scopeMode)) target.scopeMode = body.scopeMode;
    if (body.customScopes && normalizeRole(target.role) !== 'moderator') target.customScopes = {
      buyers: unique(body.customScopes.buyers), mags: unique(body.customScopes.mags),
      mmygs: unique(body.customScopes.mmygs), buyingGroups: unique(body.customScopes.buyingGroups),
    };
    if (body.dataScope && typeof body.dataScope === 'object') {
      const mode = norm(body.dataScope.mode); if (!Object.prototype.hasOwnProperty.call(iam.DATA_SCOPE_MODES, mode)) throw hierarchyError('Geçersiz veri kapsamı.', 'INVALID_DATA_SCOPE');
      target.dataScope = { mode, buyers: unique(body.dataScope.buyers), mags: unique(body.dataScope.mags), mmygs: unique(body.dataScope.mmygs), buyingGroups: unique(body.dataScope.buyingGroups) };
    }
    if (body.stableIds && typeof body.stableIds === 'object') {
      const stableIds = iam.normalizeProfileIam({ ...target, stableIds: body.stableIds }).stableIds;
      const duplicate = iam.findDuplicate(store, stableIds, target.id);
      if (duplicate) throw Object.assign(new Error('Bu kurumsal kimlik zaten Buyer Log kullanıcısına bağlı.'), { statusCode: 409, code: 'IDENTITY_EXISTS', existingUserId: duplicate.id });
      target.stableIds = stableIds;
    }
    if (body.external != null) target.external = Boolean(body.external);
    if (Array.isArray(body.permissionCodes) && target.id !== 'moderator') target.directPermissions = unique(body.permissionCodes).map(permission => iam.normalizeGrant({ permission, source: 'DIRECT', reason: clean(body.reason), grantedBy: actor.id })).filter(Boolean);
    if (Object.prototype.hasOwnProperty.call(body, 'password') || Object.prototype.hasOwnProperty.call(body, 'pin')) {
      const password = clean(body.password != null ? body.password : body.pin);
      if (password && password.length < PASSWORD_MIN_LENGTH) throw hierarchyError(`Şifre en az ${PASSWORD_MIN_LENGTH} karakter olmalı.`, 'PASSWORD_TOO_SHORT');
      target.passwordHash = password ? hashPin(password) : ''; target.pinHash = target.passwordHash;
    }
    Object.assign(target, iam.normalizeProfileIam(target));
    target.displayName = clean(target.displayName) || target.username;
    if (target.enabled !== false && !clean(target.title)) throw hierarchyError('Aktif kullanıcı için Title zorunludur.', 'TITLE_REQUIRED');
    if (target.status === 'ACTIVE' && target.systemRole !== 'moderator' && !credentialHash(target)) throw hierarchyError('Aktif kullanıcı için bir başlangıç şifresi atanmalıdır.', 'PASSWORD_REQUIRED');
    validateHierarchyChange(store, target);
    validateActorAssignment(actor, target, store);
  }
  function adminCreateHandler(req, res) {
    try {
      const store = loadStore(), actor = req.currentUser || sessionProfile(req), body = req.body || {};
      const username = clean(body.username || body.displayName), title = clean(body.title), generatedPassword = !clean(body.password), password = clean(body.password) || crypto.randomBytes(9).toString('base64url');
      ensureUniqueUsername(store, username);
      if (!title) throw hierarchyError('Title zorunludur.', 'TITLE_REQUIRED');
      if (password.length < PASSWORD_MIN_LENGTH) throw hierarchyError(`Şifre en az ${PASSWORD_MIN_LENGTH} karakter olmalı.`, 'PASSWORD_TOO_SHORT');
      if (clean(body.email) && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean(body.email))) throw hierarchyError('Geçerli bir e-posta adresi girin.', 'INVALID_EMAIL');
      const systemRole = Object.prototype.hasOwnProperty.call(iam.SYSTEM_ROLES, body.systemRole) ? body.systemRole : 'buyer';
      const orgLevel = Object.prototype.hasOwnProperty.call(iam.ORG_LEVELS, body.orgLevel) ? body.orgLevel : 'job_title';
      const managerId = clean(body.managerId || body.supervisorId) || null;
      if (systemRole !== 'moderator' && !managerId) throw hierarchyError('Buyer, Manager ve Senior Manager kullanıcıları için bağlı yönetici zorunludur.', 'MANAGER_REQUIRED');
      const newId = crypto.randomUUID();
      const suppliedStableIds = body.stableIds && Object.values(body.stableIds).some(value => clean(value));
      const stableIds = iam.normalizeProfileIam({ id: newId, email: body.email, stableIds: suppliedStableIds ? body.stableIds : { sourceId: `manual:${newId}` } }).stableIds;
      const duplicate = iam.findDuplicate(store, stableIds);
      if (duplicate) return res.status(409).json({ error: 'Bu kişi için zaten bir Buyer Log hesabı var.', code: 'IDENTITY_EXISTS', existingUserId: duplicate.id, existingUser: adminUser(duplicate, store, actor) });
      const target = normalizeStoredProfile({
        id: newId, username,
        iamVersion: 1, displayName: clean(body.displayName) || username, title, email: clean(body.email).toLocaleLowerCase('tr-TR'),
        role: legacyRoleFromIam(systemRole, orgLevel), systemRole, orgLevel, status: body.status || 'ACTIVE', enabled: body.status !== 'INACTIVE' && body.status !== 'SUSPENDED',
        passwordHash: hashPin(password), pinHash: '', managerId, supervisorId: managerId,
        stableIds, external: Boolean(body.external), directPermissions: [], temporaryPermissions: [],
        mags: unique(body.mags), mmygs: unique(body.mmygs), buyingGroups: unique(body.buyingGroups),
        permissions: normalizePermissions({}), accessAreas: normalizeAccessAreas(null, false), collectionAccess: [], scopeMode: 'profile',
        dataScope: body.dataScope || { mode: iam.ROLE_DEFAULT_SCOPE[systemRole] || 'SELF', buyers: [], mags: [], mmygs: [], buyingGroups: [] },
      });
      target.pinHash = target.passwordHash;
      assertSensitiveChange(actor, target, { ...body, __creating: true, systemRole, permissionCodes: body.permissionCodes || [] }, store);
      if (Array.isArray(body.permissionCodes) && body.permissionCodes.length) target.directPermissions = unique(body.permissionCodes).map(permission => iam.normalizeGrant({ permission, source: 'DIRECT', reason: body.reason, grantedBy: actor.id })).filter(Boolean);
      store.users.push(target); validateHierarchyChange(store, target); validateActorAssignment(actor, target, store);
      const saved = saveStore(store, body.expectedRevision);
      appendAudit(actor, 'USER_CREATE', target.id, { targetName: target.displayName || target.username, username: target.username, systemRole: target.systemRole, orgLevel: target.orgLevel, managerId: target.managerId, title: target.title, reason: clean(body.reason), newValue: adminUser(target, saved, actor) }, req);
      res.status(201).json({ ok: true, revision: saved._revision, user: publicProfile(profileById(saved, target.id), saved), temporaryPassword: generatedPassword ? password : undefined });
    } catch (err) { res.status(err.statusCode || 500).json({ error: err.message, code: err.code || 'USER_CREATE_FAILED', currentRevision: err.currentRevision }); }
  }
  function adminUpdateHandler(req, res) {
    try {
      const store = loadStore(), actor = req.currentUser || sessionProfile(req), id = clean(req.params.id), target = profileById(store, id);
      if (!target) return res.status(404).json({ error: 'Kullanıcı bulunamadı.', code: 'USER_NOT_FOUND' });
      if (!canManageTarget(actor, target, store)) return res.status(403).json({ error: 'Bu kullanıcı sizin yönetim alanınızda değil.', code: 'USER_NOT_MANAGEABLE' });
      const body = req.body || {}, oldValue = adminUser(target, store, actor); applyBodyToTarget(store, target, body, actor);
      const enabledModerators = allProfiles(store).filter(profile => profile.status === 'ACTIVE' && profile.systemRole === 'moderator');
      if (!enabledModerators.length) return res.status(400).json({ error: 'En az bir aktif Moderatör bulunmalıdır.', code: 'LAST_MODERATOR_REQUIRED' });
      const saved = saveStore(store, body.expectedRevision);
      appendAudit(actor, 'USER_UPDATE', id, {
        targetName: target.displayName || target.username, username: target.username, status: target.status, systemRole: target.systemRole, orgLevel: target.orgLevel, managerId: target.managerId,
        title: target.title, mags: target.mags, mmygs: target.mmygs, buyingGroups: target.buyingGroups,
        dataScope: target.dataScope, reason: clean(body.reason), oldValue, newValue: adminUser(target, saved, actor),
        passwordChanged: Object.prototype.hasOwnProperty.call(body, 'password') || Object.prototype.hasOwnProperty.call(body, 'pin'),
      }, req);
      res.json({ ok: true, revision: saved._revision, user: publicProfile(profileById(saved, id), saved) });
    } catch (err) { res.status(err.statusCode || 500).json({ error: err.message, code: err.code || 'USER_UPDATE_FAILED', currentRevision: err.currentRevision }); }
  }
  function roleMatrixUpdateHandler(req, res) {
    try {
      const store = loadStore(), actor = req.currentUser || sessionProfile(req), body = req.body || {}, incoming = body.roles && typeof body.roles === 'object' ? body.roles : {};
      if (!clean(body.reason) || !body.confirmCritical) throw hierarchyError('Rol matrisi değişikliği için onay ve gerekçe zorunludur.', 'CRITICAL_CONFIRMATION_REQUIRED');
      const actorBefore = iam.effectivePermissionSet(actor, store);
      const roles = iam.normalizeRoles(store.iam && store.iam.roles);
      for (const [roleId, value] of Object.entries(incoming)) {
        if (!roles[roleId] || !Array.isArray(value && value.permissions)) continue;
        const permissions = unique(value.permissions).map(norm).filter(code => iam.PERMISSION_CODES.has(code));
        const previousPermissions = unique(roles[roleId].permissions).map(norm).sort();
        const nextPermissions = [...permissions].sort();
        const scope = norm(value.defaultDataScope || roles[roleId].defaultDataScope);
        if (!Object.prototype.hasOwnProperty.call(iam.DATA_SCOPE_MODES, scope)) throw hierarchyError('Geçersiz rol veri kapsamı.', 'INVALID_DATA_SCOPE');
        const changed = JSON.stringify(previousPermissions) !== JSON.stringify(nextPermissions) || scope !== roles[roleId].defaultDataScope;
        if (!changed) continue;
        const added = permissions.filter(permission => !previousPermissions.includes(permission));
        for (const permission of added) if (!iam.canGrant(actor, permission, store)) throw Object.assign(new Error(`Sahip olmadığınız ${permission} yetkisini role veremezsiniz.`), { statusCode: 403, code: 'PERMISSION_ESCALATION_DENIED', permission });
        roles[roleId] = { ...roles[roleId], permissions, defaultDataScope: scope };
      }
      const candidateStore = { ...store, iam: { ...(store.iam || {}), version: 5, roles } };
      const actorAfter = iam.effectivePermissionSet(profileById(candidateStore, actor.id), candidateStore);
      const selfEscalation = [...actorAfter].find(permission => !actorBefore.has(permission));
      if (selfEscalation) throw Object.assign(new Error(`Aktif rol değişikliği kendi hesabınıza ${selfEscalation} yetkisini ekleyeceği için kaydedilemez.`), { statusCode: 403, code: 'SELF_ESCALATION_DENIED', permission: selfEscalation });
      store.iam = { ...(store.iam || {}), version: 5, roles };
      const saved = saveStore(store, body.expectedRevision);
      appendAudit(actor, 'ROLE_MATRIX_UPDATE', 'roles', { reason: clean(body.reason), newValue: roles }, req);
      res.json({ ok: true, revision: saved._revision, roles: saved.iam.roles });
    } catch (err) { res.status(err.statusCode || 500).json({ error: err.message, code: err.code || 'ROLE_MATRIX_UPDATE_FAILED', currentRevision: err.currentRevision }); }
  }
  function workspaceTemplateUpdateHandler(req, res) {
    try {
      const store = loadStore(), actor = req.currentUser || sessionProfile(req), body = req.body || {};
      const roleId = clean(req.params && req.params.roleId);
      if (!Object.prototype.hasOwnProperty.call(iam.SYSTEM_ROLES, roleId)) throw hierarchyError('Geçersiz şablon rolü.', 'INVALID_TEMPLATE_ROLE');
      if (!clean(body.reason) || !body.confirmCritical) throw hierarchyError('Workspace şablonu değişikliği için onay ve gerekçe zorunludur.', 'CRITICAL_CONFIRMATION_REQUIRED');
      const source = profileById(store, body.sourceUserId);
      if (!source) throw hierarchyError('Şablon kaynak kullanıcısı bulunamadı.', 'SOURCE_USER_NOT_FOUND');
      if (!canManageTarget(actor, source, store) && actor.id !== source.id && actor.systemRole !== 'moderator') throw Object.assign(new Error('Kaynak kullanıcı yönetim alanınızda değil.'), { statusCode: 403, code: 'USER_NOT_MANAGEABLE' });
      const categories = userPreferences.normalizeCategories(body.categories);
      if (!categories.length) throw hierarchyError('Şablona alınacak en az bir workspace kategorisi seçin.', 'COPY_FIELD_REQUIRED');
      const entries = userPreferences.effectiveWorkspaceEntries(source.id, roleWorkspaceEntries(source, store), categories).entries;
      const templates = iam.normalizeWorkspaceTemplates(store.iam && store.iam.workspaceTemplates);
      const previous = workspaceTemplateSummaries(store)[roleId];
      templates[roleId] = {
        roleId, entries, categories, sourceUserId: source.id, sourceName: source.displayName || source.username,
        updatedBy: actor.id, updatedAt: new Date().toISOString(),
      };
      store.iam = { ...(store.iam || {}), version: 5, workspaceTemplates: templates };
      const saved = saveStore(store, body.expectedRevision);
      appendAudit(actor, 'ROLE_WORKSPACE_TEMPLATE_UPDATE', roleId, { roleId, sourceUserId: source.id, sourceName: source.displayName || source.username, categories, entryCount: Object.keys(entries).length, reason: clean(body.reason), oldValue: previous, newValue: workspaceTemplateSummaries(saved)[roleId] }, req);
      res.json({ ok: true, revision: saved._revision, template: workspaceTemplateSummaries(saved)[roleId] });
    } catch (err) { res.status(err.statusCode || 500).json({ error: err.message, code: err.code || 'WORKSPACE_TEMPLATE_UPDATE_FAILED', currentRevision: err.currentRevision }); }
  }
  function workspaceTemplateResetHandler(req, res) {
    try {
      const store = loadStore(), actor = req.currentUser || sessionProfile(req), body = req.body || {};
      const roleId = clean(req.params && req.params.roleId);
      if (!Object.prototype.hasOwnProperty.call(iam.SYSTEM_ROLES, roleId)) throw hierarchyError('Geçersiz şablon rolü.', 'INVALID_TEMPLATE_ROLE');
      if (!clean(body.reason) || !body.confirmCritical) throw hierarchyError('Workspace şablonunu sıfırlamak için onay ve gerekçe zorunludur.', 'CRITICAL_CONFIRMATION_REQUIRED');
      const templates = iam.normalizeWorkspaceTemplates(store.iam && store.iam.workspaceTemplates), previous = workspaceTemplateSummaries(store)[roleId];
      templates[roleId] = iam.normalizeWorkspaceTemplates({})[roleId];
      store.iam = { ...(store.iam || {}), version: 5, workspaceTemplates: templates };
      const saved = saveStore(store, body.expectedRevision);
      appendAudit(actor, 'ROLE_WORKSPACE_TEMPLATE_RESET', roleId, { roleId, reason: clean(body.reason), oldValue: previous }, req);
      res.json({ ok: true, revision: saved._revision, template: workspaceTemplateSummaries(saved)[roleId] });
    } catch (err) { res.status(err.statusCode || 500).json({ error: err.message, code: err.code || 'WORKSPACE_TEMPLATE_RESET_FAILED', currentRevision: err.currentRevision }); }
  }
  function profileCopyHandler(req, res) {
    try {
      const store = loadStore(), actor = req.currentUser || sessionProfile(req), body = req.body || {};
      const templateRole = clean(body.sourceTemplateRole), template = templateRole ? workspaceTemplateForRole(store, templateRole) : null;
      const source = templateRole ? null : profileById(store, body.sourceUserId), targetIds = unique(body.targetUserIds);
      if (templateRole && (!template || !Object.keys(template.entries || {}).length)) return res.status(404).json({ error: 'Standart rol şablonu bulunamadı veya boş.', code: 'SOURCE_TEMPLATE_NOT_FOUND' });
      if (!templateRole && !source) return res.status(404).json({ error: 'Kaynak kullanıcı bulunamadı.', code: 'SOURCE_USER_NOT_FOUND' });
      if (!targetIds.length) throw hierarchyError('En az bir hedef kullanıcı seçin.', 'TARGET_USER_REQUIRED');
      if (!clean(body.reason)) throw hierarchyError('Profil kopyalama gerekçesi zorunludur.', 'GRANT_REASON_REQUIRED');
      const requested = body.categories && typeof body.categories === 'object' ? body.categories : {};
      const workspaceRequest = requested.workspace && typeof requested.workspace === 'object' ? requested.workspace : {};
      const organizationRequest = requested.organization && typeof requested.organization === 'object' ? requested.organization : {};
      const copyPermissions = templateRole ? false : (requested.userPermissions !== undefined ? Boolean(requested.userPermissions) : body.copyPermissions !== false);
      const workspaceCategories = userPreferences.normalizeCategories(Array.isArray(requested.workspace) ? requested.workspace : Object.entries(workspaceRequest).filter(([, enabled]) => Boolean(enabled)).map(([name]) => name));
      const organization = { role: Boolean(organizationRequest.role), mag: Boolean(organizationRequest.mag || body.copyMagMmyg), mmyg: Boolean(organizationRequest.mmyg || body.copyMagMmyg), buyingGroup: Boolean(organizationRequest.buyingGroup), manager: Boolean(organizationRequest.manager), dataScope: Boolean(organizationRequest.dataScope || body.copyDataScope) };
      if (templateRole && Object.values(organization).some(Boolean)) throw hierarchyError('Standart workspace şablonu organizasyon bilgisi içermez.', 'TEMPLATE_ORGANIZATION_UNAVAILABLE');
      if (!copyPermissions && !workspaceCategories.length && !Object.values(organization).some(Boolean)) throw hierarchyError('Kopyalanacak en az bir alan seçin.', 'COPY_FIELD_REQUIRED');
      const mode = norm(body.mode) === 'REPLACE' ? 'REPLACE' : 'MERGE';
      const sourceCodes = source ? unique((source.directPermissions || []).map(item => item.permission)).map(norm) : [];
      const sourceName = source ? (source.displayName || source.username) : `Standard ${iam.SYSTEM_ROLES[templateRole]}`;
      const sourceId = source ? source.id : `template:${templateRole}`;
      const sourceWorkspaceEntries = source ? null : userPreferences.normalizeWorkspaceEntryMap(template.entries, workspaceCategories);
      const preview = Boolean(body.preview || req.profileCopyPreview), results = [], changed = [], workspaceBackups = new Map();
      for (const targetId of targetIds) {
        const target = profileById(store, targetId);
        const targetName = target && (target.displayName || target.username) || targetId, original = target ? JSON.parse(JSON.stringify(target)) : null;
        try {
          if (!target) throw hierarchyError(`Hedef kullanıcı bulunamadı: ${targetId}`, 'TARGET_USER_NOT_FOUND');
          if (target.id === actor.id || (source && target.id === source.id) || target.id === 'moderator') throw Object.assign(new Error('Kaynak, kendi hesabınız veya korunan Moderatör hedef olarak seçilemez.'), { statusCode: 403, code: 'COPY_TARGET_DENIED' });
          if (!canManageTarget(actor, target, store)) throw Object.assign(new Error(`${targetName} yönetim alanınızda değil.`), { statusCode: 403, code: 'USER_NOT_MANAGEABLE' });
          if (copyPermissions) {
            const existingGrants = mode === 'REPLACE' ? [] : (target.directPermissions || []), keptCodes = new Set(existingGrants.map(item => norm(item.permission)));
            const nextCodes = unique([...keptCodes, ...sourceCodes]).map(norm);
            assertSensitiveChange(actor, target, { permissionCodes: nextCodes, reason: body.reason }, store);
            const added = nextCodes.filter(permission => !keptCodes.has(permission)).map(permission => iam.normalizeGrant({ permission, source: 'DIRECT', reason: `Copied from ${sourceName}: ${clean(body.reason)}`, grantedBy: actor.id })).filter(Boolean);
            target.directPermissions = [...existingGrants, ...added];
          }
          if (organization.role) { assertSensitiveChange(actor, target, { systemRole: source.systemRole, reason: body.reason, confirmCritical: body.confirmCritical }, store); target.systemRole = source.systemRole; target.role = legacyRoleFromIam(source.systemRole, source.orgLevel); target.orgLevel = source.orgLevel; }
          /* v7.23: Buying Group artık AYRI bir kategoridir. Eskiden MAG ile
             birlikte kopyalanıyordu; Buying Group kullanıcı kartında kendi
             başına yönetilen bir alan olduğu için "MAG'ı kopyala" demek onu
             da kopyalamak anlamına gelmemeli. Eski istemcilerle uyum için
             buyingGroup seçilmemişse MAG davranışı korunur. */
          if (organization.mag) { target.mags = unique(source.mags); if (!Object.prototype.hasOwnProperty.call(organizationRequest, 'buyingGroup')) target.buyingGroups = unique(source.buyingGroups); }
          if (organization.mmyg) target.mmygs = unique(source.mmygs);
          if (organization.buyingGroup) target.buyingGroups = unique(source.buyingGroups);
          if (organization.manager) { target.managerId = source.managerId || null; target.supervisorId = source.managerId || null; }
          if (organization.dataScope) target.dataScope = JSON.parse(JSON.stringify(source.dataScope || { mode: 'SELF', buyers: [], mags: [], mmygs: [], buyingGroups: [] }));
          Object.assign(target, iam.normalizeProfileIam(target)); validateHierarchyChange(store, target); validateActorAssignment(actor, target, store);
          if (preview) Object.assign(target, original);
          else if (workspaceCategories.length && !centralConfigured) {
            workspaceBackups.set(target.id, userPreferences.workspaceEntries(target.id));
            if (source) userPreferences.copyWorkspaceSnapshot(source.id, target.id, workspaceCategories, mode);
            else userPreferences.copyWorkspaceEntrySnapshot(sourceWorkspaceEntries, target.id, workspaceCategories, mode);
          }
          if (!preview) changed.push(target.id);
          results.push({ targetUserId: target.id, targetName, status: preview ? 'READY' : 'SUCCESS' });
        } catch (error) { if (target && original) Object.assign(target, original); if (centralConfigured && !preview) throw error; results.push({ targetUserId: targetId, targetName, status: 'FAILED', code: error.code || 'PROFILE_COPY_TARGET_FAILED', reason: error.message }); }
      }
      if (preview) return res.json({ ok: true, preview: true, sourceUserId: source && source.id || null, sourceTemplateRole: templateRole || null, sourceName, mode, categories: { userPermissions: copyPermissions, workspace: workspaceCategories, organization }, targets: results });
      if (centralConfigured && workspaceCategories.length) {
        const transaction = iamTransaction.getStore();
        // Presentation preferences are local; stage their effects until IAM has
        // committed. They are not password/permission payloads or business data.
        for (const id of changed) transaction.effects.push(() => source
          ? userPreferences.copyWorkspaceSnapshot(source.id, id, workspaceCategories, mode)
          : userPreferences.copyWorkspaceEntrySnapshot(sourceWorkspaceEntries, id, workspaceCategories, mode));
      }
      let saved = store;
      try { if (changed.length && (centralConfigured || copyPermissions || Object.values(organization).some(Boolean))) saved = saveStore(store, body.expectedRevision); }
      catch (error) { for (const [targetId, entries] of workspaceBackups) userPreferences.replaceWorkspaceEntries(targetId, entries, userPreferences.WORKSPACE_CATEGORIES, 'REPLACE'); throw error; }
      const success = results.filter(item => item.status === 'SUCCESS').length, failed = results.filter(item => item.status === 'FAILED').length;
      appendAudit(actor, 'USER_PROFILE_COPIED', sourceId, { sourceUserId: source && source.id || null, sourceTemplateRole: templateRole || null, sourceName, targetUserIds: changed, mode, categories: { userPermissions: copyPermissions, workspace: workspaceCategories, organization }, results, success, failed, permissions: copyPermissions ? sourceCodes : [], reason: clean(body.reason) }, req);
      res.json({ ok: failed === 0, revision: saved._revision, copiedTo: changed, mode, success, failed, skipped: 0, results });
    } catch (err) { res.status(err.statusCode || 500).json({ error: err.message, code: err.code || 'PROFILE_COPY_FAILED', currentRevision: err.currentRevision }); }
  }
  function profileCopyPreviewHandler(req, res) { req.profileCopyPreview = true; return profileCopyHandler(req, res); }
  function permissionCopyHandler(req, res) { return profileCopyHandler(req, res); }
  function temporaryGrantHandler(req, res) {
    try {
      const store = loadStore(), actor = req.currentUser || sessionProfile(req), target = profileById(store, req.params.id), body = req.body || {};
      if (!target) return res.status(404).json({ error: 'Kullanıcı bulunamadı.', code: 'USER_NOT_FOUND' });
      if (target.id === actor.id) throw Object.assign(new Error('Kendinize geçici yetki veremezsiniz.'), { statusCode: 403, code: 'SELF_ESCALATION_DENIED' });
      const permission = norm(body.permission);
      if (!iam.PERMISSION_CODES.has(permission)) throw hierarchyError('Geçersiz yetki kodu.', 'INVALID_PERMISSION');
      if (!iam.canGrant(actor, permission, store)) throw Object.assign(new Error('Sahip olmadığınız bir yetkiyi veremezsiniz.'), { statusCode: 403, code: 'PERMISSION_ESCALATION_DENIED' });
      if (!clean(body.reason)) throw hierarchyError('Geçici yetki için gerekçe zorunludur.', 'GRANT_REASON_REQUIRED');
      const from = Date.parse(body.validFrom || new Date().toISOString()), until = Date.parse(body.validUntil || '');
      if (!Number.isFinite(from) || !Number.isFinite(until) || until <= from) throw hierarchyError('Geçici yetkinin başlangıç ve bitiş tarihleri geçerli olmalıdır.', 'INVALID_GRANT_PERIOD');
      const grant = iam.normalizeGrant({ permission, source: 'TEMPORARY', reason: body.reason, validFrom: new Date(from).toISOString(), validUntil: new Date(until).toISOString(), grantedBy: actor.id }, 'TEMPORARY');
      target.temporaryPermissions = [...(target.temporaryPermissions || []), grant];
      const saved = saveStore(store, body.expectedRevision);
      appendAudit(actor, 'TEMPORARY_PERMISSION_GRANT', target.id, { permission, reason: grant.reason, validFrom: grant.validFrom, validUntil: grant.validUntil, newValue: grant }, req);
      res.status(201).json({ ok: true, revision: saved._revision, grant });
    } catch (err) { res.status(err.statusCode || 500).json({ error: err.message, code: err.code || 'TEMPORARY_GRANT_FAILED', currentRevision: err.currentRevision }); }
  }
  function temporaryGrantRevokeHandler(req, res) {
    try {
      const store = loadStore(), actor = req.currentUser || sessionProfile(req), target = profileById(store, req.params.id), body = req.body || {};
      if (!target) return res.status(404).json({ error: 'Kullanıcı bulunamadı.', code: 'USER_NOT_FOUND' });
      if (target.id === actor.id) throw Object.assign(new Error('Kendi geçici yetkinizi değiştiremezsiniz.'), { statusCode: 403, code: 'SELF_ESCALATION_DENIED' });
      const grant = (target.temporaryPermissions || []).find(item => item.id === req.params.grantId);
      if (!grant) return res.status(404).json({ error: 'Geçici yetki bulunamadı.', code: 'GRANT_NOT_FOUND' });
      if (!iam.canGrant(actor, grant.permission, store)) throw Object.assign(new Error('Bu yetkiyi geri alma hakkınız yok.'), { statusCode: 403, code: 'PERMISSION_ESCALATION_DENIED' });
      if (!clean(body.reason)) throw hierarchyError('Yetki geri alma gerekçesi zorunludur.', 'GRANT_REASON_REQUIRED');
      target.temporaryPermissions = target.temporaryPermissions.filter(item => item.id !== grant.id);
      const saved = saveStore(store, body.expectedRevision);
      appendAudit(actor, 'TEMPORARY_PERMISSION_REVOKE', target.id, { permission: grant.permission, reason: clean(body.reason), oldValue: grant }, req);
      res.json({ ok: true, revision: saved._revision });
    } catch (err) { res.status(err.statusCode || 500).json({ error: err.message, code: err.code || 'TEMPORARY_REVOKE_FAILED', currentRevision: err.currentRevision }); }
  }
  function auditListHandler(req, res) {
    const store = readStore(), actor = req.currentUser || sessionProfile(req);
    if (!iam.hasPermission(actor, 'AUDIT.VIEW', store)) return res.status(403).json({ error: 'Audit Log görüntüleme yetkisi gerekli.', code: 'AUDIT_VIEW_REQUIRED' });
    res.set('Cache-Control', 'no-store').json({ items: readAudit(req.query && req.query.limit, req.query || {}) });
  }
  function centralMutation(handler, permission) {
    return (req, res) => {
      if (!centralConfigured || req.profileCopyPreview) return handler(req, res);
      return (async () => {
        try {
          const base = loadStore(), expected = req.body && req.body.expectedRevision;
          const body = req.body || {};
          const permissionSets = [body.permissionCodes, ...Object.values(body.roles || {}).map(role => role && role.permissions)].filter(value => value != null);
          if (permissionSets.some(values => !Array.isArray(values) || values.some(code => !iam.PERMISSION_CODES.has(norm(code))))) throw hierarchyError('Geçersiz izin kodu.', 'INVALID_PERMISSION');
          if (!Number.isSafeInteger(expected)) throw Object.assign(new Error('Beklenen IAM revizyonu zorunludur.'), { code: 'IAM_EXPECTED_REVISION_REQUIRED', statusCode: 400 });
          if (expected !== base._revision) throw Object.assign(new Error('Kullanıcı dizini değişti. Kaydetmeden önce yeniden yükleyin.'), { code: 'IAM_REVISION_CONFLICT', statusCode: 409, currentRevision: base._revision });
          const actor = profileById(base, (req.currentUser || sessionProfile(req) || {}).id);
          if (!actor || !actor.enabled || !(permission === 'USER.ADMIN' ? iam.canAdminUsers(actor, base) : iam.hasPermission(actor, permission, base))) return res.status(403).json({ error: 'Bu işlem için yetkiniz yok.', code: 'CAPABILITY_REQUIRED' });
          req.currentUser = actor;
          const transaction = { base, candidate: null, audit: [], effects: [] };
          const buffered = { statusCode: 200, body: null, status(n) { this.statusCode = n; return this; }, json(value) { this.body = value; return this; } };
          await iamTransaction.run(transaction, () => handler(req, buffered));
          if (buffered.statusCode >= 400 || !transaction.candidate) return res.status(buffered.statusCode).json(buffered.body);
          const saved = await getCentralIam().commit(transaction.candidate, expected, actor, {
            action: transaction.audit[0] && transaction.audit[0].action || 'IAM_UPDATE',
            targetUserIds: transaction.audit.map(a => a.target).filter(id => profileById(transaction.candidate, id)),
          });
          for (const effect of transaction.effects) {
            try { effect(); } catch (_) { buffered.body.workspacePreferencesPending = true; }
          }
          buffered.body.revision = saved._revision;
          // Keep the initiating administrator signed in with the new revisions.
          // Other sessions are invalidated by sessionProfile on their next check.
          if (typeof res.append === 'function') setCookie(req, res, actor.id);
          return res.status(buffered.statusCode).json(buffered.body);
        } catch (err) { return res.status(err.statusCode || 503).json({ error: err.message, code: err.code || 'IAM_WRITE_FAILED', currentRevision: err.currentRevision }); }
      })();
    };
  }
  function iamHealthHandler(_req, res) { res.set('Cache-Control', 'no-store').json(centralConfigured ? getCentralIam().health() : { enabled: false, source: 'local' }); }
  async function iamRefreshHandler(req, res) {
    try { if (centralConfigured) await getCentralIam().refresh(); return iamHealthHandler(req, res); }
    catch (err) { return res.status(err.statusCode || 503).json({ error: 'Kullanıcı dizini yenilenemedi.', code: err.code }); }
  }
  function iamDryRunHandler(req, res) {
    try {
      if (!centralConfigured) return res.status(409).json({ code: 'IAM_FEATURE_DISABLED', error: 'Central IAM yapılandırmada etkin değil.' });
      const store = readStore();
      return res.json({ ...getCentralIam().dryRun(store), revision: store._revision });
    } catch (err) { return res.status(err.statusCode || 503).json({ error: 'IAM geçiş doğrulaması başarısız.', code: err.code }); }
  }
  async function iamInitializeHandler(req, res) {
    try {
      if (!centralConfigured || req.body.confirmCritical !== true) return res.status(400).json({ error: 'Merkezi geçiş için açık onay gerekir.', code: 'CRITICAL_CONFIRMATION_REQUIRED' });
      const store = loadStore(), actor = req.currentUser || sessionProfile(req);
      if (req.body.expectedRevision !== store._revision) return res.status(409).json({ error: 'Yerel kullanıcı dizini değişti.', code: 'IAM_REVISION_CONFLICT' });
      const saved = await getCentralIam().initialize(store, actor);
      return res.json({ ok: true, revision: saved._revision, centralIam: getCentralIam().health() });
    } catch (err) { return res.status(err.statusCode || 503).json({ error: 'Merkezi IAM başlatılamadı.', code: err.code }); }
  }
  function adminBulkHandler(req, res) {
    try {
      const store = loadStore(), actor = req.currentUser || sessionProfile(req), body = req.body || {};
      if (!Array.isArray(body.changes) || !body.changes.length || body.changes.length > 1000) throw hierarchyError('Geçerli kullanıcı değişiklikleri gerekir.', 'IAM_INVALID_BATCH');
      const seen = new Set();
      for (const change of body.changes) {
        const target = profileById(store, clean(change.id));
        if (!target || seen.has(target.id)) throw hierarchyError('Hedef kullanıcı geçersiz veya yineleniyor.', 'IAM_INVALID_BATCH');
        seen.add(target.id);
        if (!canManageTarget(actor, target, store)) throw Object.assign(new Error('Kullanıcı yönetim alanınızda değil.'), { code: 'USER_NOT_MANAGEABLE', statusCode: 403 });
        applyBodyToTarget(store, target, { ...change.patch, confirmCritical: body.confirmCritical === true, reason: body.reason }, actor);
      }
      const saved = saveStore(store, body.expectedRevision);
      appendAudit(actor, 'USER_BULK_UPDATE', null, { targetUserIds: [...seen] }, req);
      return res.json({ ok: true, revision: saved._revision });
    } catch (err) { return res.status(err.statusCode || 503).json({ error: err.message, code: err.code }); }
  }
  function beginRestore() { restoreActive = true; storeCache = null; }
  function endRestore() { restoreActive = false; storeCache = null; }
  function profileIdentity(profile) {
    return [profile && profile.id, profile && profile.userId, profile && profile.legacyId, profile && profile.username, profile && profile.email]
      .map(value => clean(value)).filter(Boolean).map((value, index) => index >= 3 ? usernameKey(value) : value);
  }
  function restoreBackupSnapshot(snapshot, options = {}) {
    if (!snapshot || typeof snapshot !== 'object' || !snapshot.moderator) throw Object.assign(new Error('Backup kullanıcı snapshotı geçersiz.'), { code: 'RESTORE_SECURITY_SNAPSHOT_INVALID', statusCode: 400 });
    const current = loadStore();
    const currentProfiles = allProfiles(current);
    const findExisting = incoming => {
      const keys = new Set(profileIdentity(incoming));
      return currentProfiles.find(candidate => profileIdentity(candidate).some(key => keys.has(key))) || null;
    };
    const restoreProfile = (incoming, fallback) => {
      const existing = fallback || findExisting(incoming);
      const restored = normalizeStoredProfile(incoming, existing || {});
      // backupSafeStore deliberately removes credentials; keep the credentials
      // that belong to this computer and force a reset only for new accounts.
      if (existing && credentialHash(existing)) {
        restored.passwordHash = existing.passwordHash || '';
        restored.pinHash = existing.pinHash || '';
      } else {
        restored.passwordHash = '';
        restored.pinHash = '';
      }
      return restored;
    };
    const moderator = restoreProfile(snapshot.moderator, current.moderator);
    moderator.id = 'moderator'; moderator.role = 'moderator'; moderator.systemRole = 'moderator'; moderator.supervisorId = null; moderator.enabled = true;
    const users = (Array.isArray(snapshot.users) ? snapshot.users : []).map(item => restoreProfile(item));
    const restored = iam.migrateStore({
      ...current, ...snapshot, moderator, users, schemaVersion: 8,
      _revision: Number.isSafeInteger(Number(snapshot._revision)) ? Number(snapshot._revision) : current._revision,
      _restoreSeed: { kind: 'full-system-backup', restoredAt: new Date().toISOString(), sourceRevision: Number(snapshot._revision) || 0, centralIam: centralConfigured },
    });
    // The old central cache marker describes the pre-restore snapshot. Keeping
    // it would make Central IAM treat the recovery seed as a valid stale cache.
    delete restored._centralIam;
    atomicWriteJson(ACCESS_FILE, restored); storeCache = null;
    const restoredProfiles = allProfiles(restored);
    const recoverySeed = centralConfigured || options.centralIamExpected === true;
    return {
      applied: true, centralIam: centralConfigured, recoverySeed,
      restoredUsers: restoredProfiles.length, credentialsPreserved: restoredProfiles.filter(profile => credentialHash(profile)).length,
      credentialsRequired: restoredProfiles.filter(profile => profile.enabled !== false && !credentialHash(profile)).length,
      source: centralConfigured ? 'recovery-seed' : 'local', options,
    };
  }
  return {
    syncProfiles: syncProfilesForAccess, mergeCatalogValues, authoritativeOrderRows, sessionProfile, publicProfile, canEditOrder, effectiveScopes, appendAudit,
    listHandler, suggestHandler, loginHandler, logoutHandler, currentHandler, requireSelection, requireModerator, requireUserAdmin, requirePermission, requireArea, requireAnyArea, requireCapability,
    adminListHandler, adminCreateHandler: centralMutation(adminCreateHandler, 'USER.ADMIN'), adminUpdateHandler: centralMutation(adminUpdateHandler, 'USER.ADMIN'), adminBulkHandler: centralMutation(adminBulkHandler, 'USER.ADMIN'),
    roleMatrixUpdateHandler: centralMutation(roleMatrixUpdateHandler, 'ROLE.MANAGE'), workspaceTemplateUpdateHandler: centralMutation(workspaceTemplateUpdateHandler, 'ROLE.MANAGE'),
    workspaceTemplateResetHandler: centralMutation(workspaceTemplateResetHandler, 'ROLE.MANAGE'), permissionCopyHandler: centralMutation(permissionCopyHandler, 'USER.GRANT'),
    profileCopyHandler: centralMutation(profileCopyHandler, 'USER.PROFILE_COPY'), profileCopyPreviewHandler,
    temporaryGrantHandler: centralMutation(temporaryGrantHandler, 'USER.GRANT'), temporaryGrantRevokeHandler: centralMutation(temporaryGrantRevokeHandler, 'USER.GRANT'), auditListHandler,
    iamHealthHandler, iamRefreshHandler, iamDryRunHandler, iamInitializeHandler,
    refreshIam: options => restoreActive ? Promise.resolve(null) : centralConfigured
      ? getCentralIam().preflight(Math.max(250, Number(options && options.timeoutMs) || 1500), options).then(async result => { await refreshOrderAuthority(); return result; })
      : Promise.resolve(null),
    refreshOrderAuthority,
    // Shared Hub can be selected on the pre-login screen after the process has
    // already started. Central IAM therefore cannot be a boot-time-only flag.
    // Enabling it only swaps the directory transport; credentials remain in
    // the version-independent local cache and refresh still has offline fallback.
    enableCentralIam: () => {
      if (!centralConfigured) { centralConfigured = true; centralService = null; storeCache = null; }
      return getCentralIam().health();
    },
    centralIamHealth: () => centralConfigured ? getCentralIam().health() : { enabled:false, source:'local', status:'disabled', localRevision:Number(readStore()._revision)||0 },
    // A credentialed snapshot is still the strict signal used by Shared Hub
    // bootstrap/recovery decisions. Login availability is intentionally broader:
    // the built-in local Moderator may create its first password even when no
    // Shared Hub exists, and any active cached user with credentials may sign in
    // while the Hub is unavailable.
    hasLocalLoginSnapshot: () => allProfiles(readStore()).some(profile => profile && profile.enabled !== false && profile.status === 'ACTIVE' && Boolean(credentialHash(profile))),
    canLoginLocally: () => allProfiles(readStore()).some(profile => profile && profile.enabled !== false && profile.status === 'ACTIVE' && (Boolean(credentialHash(profile)) || normalizeRole(profile.role) === 'moderator')),
    localIamRevision: () => Number(readStore()._revision) || 0,
    initializeCentralIam: async actor => {
      if (!centralConfigured) { centralConfigured = true; centralService = null; storeCache = null; }
      return getCentralIam().initialize(loadStore(), actor);
    },
    beginRestore, endRestore, restoreBackupSnapshot,
    hasCapability: (profile, permission) => iam.hasPermission(profile, permission, readStore()),
    effectivePermissionDetails: profile => iam.effectivePermissionDetails(profile, readStore()),
    filterRowsByScope: (profile, rows) => iam.filterRows(profile, rows, readStore()),
    hasPermission: (profile, key) => hasPermission(profile, key, readStore()), hasArea: (profile, key) => hasArea(profile, key, readStore()),
    setCollectionAccessResolver: resolver => { collectionAccessResolver = typeof resolver === 'function' ? resolver : null; },
    collectionAccessLevel: (profile, ownerId) => collectionAccessLevel(profile, ownerId, readStore()),
    effectiveCollectionAccess: profile => effectiveCollectionAccess(profile, readStore()),
    roleWorkspaceEntries: profileOrId => roleWorkspaceEntries(profileOrId, readStore()),
    // v7.23 — Horizon ön ayarları kullanıcının MAG/MMYG/Buying Group bilgisine
    // göre eşleştirildiği için profil, id'den de çözülebilmelidir.
    profileById: id => profileById(readStore(), clean(id)),
    // Bir yöneticinin YALNIZ kendi ekibindeki kullanıcıyı yönetebilmesi için;
    // Moderatör hepsini yönetir. Horizon atama bu kapıdan geçer (§32).
    canManageTarget: (actor, target) => { const store = readStore(); return canManageTarget(actor, typeof target === 'object' ? target : profileById(store, clean(target)), store); },
    canAdminUsers: profile => iam.canAdminUsers(profile, readStore()),
    // Modül düzeyinde de dışa açık; kurulmuş nesne üzerinden çağıran uçlar
    // (Horizon ön ayarları) için burada da bulunmalı.
    canManageUsers: profile => canManageUsers(profile),
    allPublicProfiles: () => { const store = readStore(); return allProfiles(store).map(profile => publicProfile(profile, store)); },
    collectionAccessMigrationProfiles: () => {
      const store = readStore();
      return allProfiles(store).map(profile => ({ id: profile.id, enabled: profile.enabled !== false, collectionAccess: normalizeCollectionAccess(profile.collectionAccess) }));
    },
    backupSnapshot: () => backupSafeStore(readStore()),
    usingPersonalLoginFallback: () => Boolean(readStore()._personalLoginFallback),
    COOKIE_NAME,
  };
}

module.exports = {
  getCentralIam, AUTH_DATA_ROOT, ACCESS_FILE, rotateAuditIfNeeded, auditRetention, listAuditArchives,
  buildUserAccess, loadStore, readStore, saveStore, backupSafeStore, syncProfiles, mergeCatalogValues, scopeCatalogFromOrders, effectiveScopes, directEffectiveScopes, canEditOrder, publicProfile,
  hashPin, verifyPin, unique, norm, normalizeRole, isKnownRole, normalizePermissions, normalizeAccessAreas,
  normalizeCollectionAccess, effectivePermissions, hasPermission, directAccessAreas, effectiveAccessAreas, hasArea,
  descendantProfiles, effectiveCollectionAccess, collectionAccessLevel, validateHierarchyChange, canManageUsers,
  titleSuggestedRole, roleDraft, profileDraft, catalogsFromStore, workspaceTemplateForRole, workspaceTemplateSummaries, roleWorkspaceEntries, ROLE_LEVEL, ROLE_LABELS, PERMISSION_KEYS,
  ACCESS_AREA_KEYS, ACCESS_AREA_LABELS, PUBLIC_ACCESS_AREA_KEYS, DEFAULT_MODERATOR_NAME, PASSWORD_MIN_LENGTH, iam,
};
