'use strict';

// IAM commits are immutable, nonempty revision directories. A single directory
// rename publishes snapshot + integrity metadata + audit together. Renaming a
// directory over an existing NONEMPTY revision fails, fencing expired writers.
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const iam = require('./iam-core');
const { withFileLeaseAsync } = require('./shared-file-transaction');

const PROFILE_FIELDS = Object.freeze(('username displayName title email role systemRole orgLevel status enabled passwordHash pinHash supervisorId managerId permissions accessAreas collectionAccess scopeMode autoScopes customScopes mags mmygs buyingGroups legacySourceAccount sourceBuyer iamVersion stableIds identityKey external directPermissions temporaryPermissions dataScope createdAt createdBy updatedAt updatedBy credentialRevision accessRevision').split(' '));
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const clone = value => JSON.parse(JSON.stringify(value));
const profiles = store => [store && store.moderator, ...(store && store.users || [])].filter(Boolean);
const normalizeUsername = value => String(value == null ? '' : value).trim().toLocaleLowerCase('tr-TR');
const digest = value => crypto.createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
/* Oturumu etkileyen etkin erişim: kişinin kendi erişim alanları, rol
   matrisinden ve hiyerarşiden gelen etkin izinler ile ekibinin erişim alanları
   (yönetici ekibin kapsamını/alanlarını devralır). */
const ACCESS_FIELDS = ['status', 'enabled', 'systemRole', 'role', 'orgLevel', 'managerId', 'supervisorId', 'accessAreas', 'permissions', 'directPermissions', 'temporaryPermissions', 'dataScope', 'scopeMode', 'customScopes', 'autoScopes', 'mags', 'mmygs', 'buyingGroups', 'collectionAccess', 'external'];
function accessFingerprint(user, store) {
  const own = u => ACCESS_FIELDS.map(key => u && u[key] === undefined ? null : u && u[key]);
  let effective = [];
  try { effective = [...iam.effectivePermissionSet(user, store)].sort(); } catch (_) { effective = ['<unavailable>']; }
  let team = [];
  try { team = iam.descendants(store, user.id).map(child => [child.id, own(child)]).sort((x, y) => String(x[0]).localeCompare(String(y[0]))); } catch (_) { team = ['<unavailable>']; }
  return digest({ own: own(user), effective, team });
}
function error(code, statusCode = 503) { return Object.assign(new Error(code), { code, statusCode }); }
function stableUuid(id) {
  if (UUID.test(id)) return id;
  const bytes = crypto.createHash('sha256').update(`buyerlog:iam:identity:v1:${id}`).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 15) | 80; bytes[8] = (bytes[8] & 63) | 128;
  const h = bytes.toString('hex'); return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
function pick(object, fields) {
  const result = {};
  for (const key of fields) if (object[key] !== undefined) result[key] = clone(object[key]);
  return result;
}
function snapshotFromStore(store, revision, actor = {}) {
  const source = profiles(store), ids = new Map(source.map(u => [u.id, u.userId || stableUuid(u.id)]));
  const ref = id => id ? ids.get(id) || id : null;
  return {
    schemaVersion: 2, revision, previousRevision: revision - 1,
    updatedAt: new Date().toISOString(), updatedBy: { userId: ref(actor.id), userName: actor.displayName || '' },
    users: source.map(u => ({ ...pick(u, PROFILE_FIELDS), id: ids.get(u.id), legacyId: u.id,
      normalizedUsername: normalizeUsername(u.username), managerId: ref(u.managerId), supervisorId: ref(u.supervisorId),
      collectionAccess: (u.collectionAccess || []).map(a => ({ ownerId: ref(a.ownerId), level: a.level })),
      credentialRevision: u.credentialRevision || 1, accessRevision: u.accessRevision || 1 })),
    roles: clone(store.iam.roles), workspacePolicies: clone(store.iam.workspaceTemplates || {}),
    iamVersion: store.iam.version, iamMigratedAt: store.iam.migratedAt,
  };
}
function storeFromSnapshot(snapshot, local = {}) {
  const ids = new Map(snapshot.users.map(u => [u.id, u.legacyId]));
  const users = snapshot.users.map(u => ({ ...pick(u, PROFILE_FIELDS), id: u.legacyId, userId: u.id,
    managerId: ids.get(u.managerId) || null, supervisorId: ids.get(u.supervisorId) || null,
    collectionAccess: u.collectionAccess.map(a => ({ ownerId: ids.get(a.ownerId), level: a.level })) }));
  return { schemaVersion: 8, _revision: snapshot.revision, _updatedAt: snapshot.updatedAt,
    moderator: users.find(u => u.id === 'moderator') || null, users: users.filter(u => u.id !== 'moderator'),
    iam: { version: snapshot.iamVersion, migratedAt: snapshot.iamMigratedAt, roles: clone(snapshot.roles), workspaceTemplates: clone(snapshot.workspacePolicies) },
    orderAccess: local.orderAccess || {}, scopeCatalog: local.scopeCatalog || {},
  };
}
function validateSnapshot(s) {
  // detail names the failed rule/field (never a value) so a device that
  // rejects the directory can say why instead of a bare IAM_REMOTE_INVALID.
  const invalid = (detail = 'snapshot') => { throw Object.assign(error('IAM_REMOTE_INVALID'), { detail }); };
  if (!s || s.schemaVersion !== 2 || !Number.isSafeInteger(s.revision) || s.revision < 1 ||
    s.previousRevision !== s.revision - 1 || !Array.isArray(s.users) || !s.users.length || !s.roles || !s.workspacePolicies ||
    s.iamVersion !== 5 || !Number.isFinite(Date.parse(s.updatedAt))) invalid('snapshot.header');
  const top = new Set(['schemaVersion','revision','previousRevision','updatedAt','updatedBy','users','roles','workspacePolicies','iamVersion','iamMigratedAt']);
  const extraTop = Object.keys(s).find(k => !top.has(k));
  if (extraTop) invalid(`snapshot.unknownField:${extraTop}`);
  const ids = new Set(), legacy = new Set(), names = new Set();
  for (const [index, u] of s.users.entries()) {
    const at = `users[${index}]`;
    if (!u || !UUID.test(u.id) || ids.has(u.id) || !u.legacyId || legacy.has(u.legacyId)) invalid(`${at}.id`);
    const extra = Object.keys(u).find(k => !PROFILE_FIELDS.includes(k) && !['id','legacyId','normalizedUsername'].includes(k));
    if (extra) invalid(`${at}.unknownField:${extra}`);
    ids.add(u.id); legacy.add(u.legacyId);
    const name = normalizeUsername(u.username);
    // Disabled source-directory records historically have no login name.
    if ((!name && !(u.legacySourceAccount && u.enabled === false)) || (name && names.has(name)) || u.normalizedUsername !== name) invalid(`${at}.username`);
    if (name) names.add(name);
    if (!s.roles[u.systemRole]) invalid(`${at}.systemRole`);
    if (!iam.ORG_LEVELS[u.orgLevel]) invalid(`${at}.orgLevel`);
    if (!iam.USER_STATUSES[u.status] || u.enabled !== (u.status === 'ACTIVE')) invalid(`${at}.status`);
    if (!Number.isSafeInteger(u.credentialRevision) || u.credentialRevision < 1 ||
      !Number.isSafeInteger(u.accessRevision) || u.accessRevision < 1) invalid(`${at}.revision`);
    for (const key of ['passwordHash','pinHash']) if (u[key] && !/^scrypt\$[a-f0-9]{32}\$[a-f0-9]{64}$/i.test(u[key])) invalid(`${at}.${key}`);
    if (u.passwordHash && u.pinHash && u.passwordHash !== u.pinHash) invalid(`${at}.pinHash`);
    if (u.enabled && !(u.passwordHash || u.pinHash)) invalid(`${at}.passwordHash`);
    for (const key of ['directPermissions','temporaryPermissions']) {
      if (!Array.isArray(u[key])) invalid(`${at}.${key}`);
      for (const grant of u[key]) if (!grant || !iam.PERMISSION_CODES.has(grant.permission)) invalid(`${at}.${key}`);
    }
  }
  for (const [id, role] of Object.entries(s.roles)) if (!iam.SYSTEM_ROLES[id] || role.id !== id ||
    !Array.isArray(role.permissions) || role.permissions.some(p => !iam.PERMISSION_CODES.has(p))) invalid(`roles.${id}`);
  for (const role of Object.keys(iam.SYSTEM_ROLES)) if (!s.roles[role]) invalid(`roles.${role}`);
  const byId = new Map(s.users.map(u => [u.id, u]));
  for (const [index, u] of s.users.entries()) {
    if ((u.managerId && !ids.has(u.managerId)) || (u.supervisorId && !ids.has(u.supervisorId))) invalid(`users[${index}].managerId`);
    if (!Array.isArray(u.collectionAccess)) invalid(`users[${index}].collectionAccess`);
    for (const a of u.collectionAccess) if (!ids.has(a.ownerId) || !['view','edit'].includes(a.level)) invalid(`users[${index}].collectionAccess`);
    const seen = new Set([u.id]); let parent = u.managerId;
    while (parent) { if (seen.has(parent)) invalid(`users[${index}].managerCycle`); seen.add(parent); parent = byId.get(parent).managerId; }
  }
  // Recursively reject device/session/config material, even inside a workspace
  // preference value. Verifiers are allowed ONLY at the profile's top level.
  function noSecrets(value, at) {
    if (!value || typeof value !== 'object') return;
    for (const [key, item] of Object.entries(value)) {
      if (/password|pinHash|secret|token|cookie|session|oauth|deviceId|localPath|config/i.test(key)) invalid(`${at}.secretKey:${key}`);
      noSecrets(item, `${at}.${key}`);
    }
  }
  noSecrets(s.roles, 'roles'); noSecrets(s.workspacePolicies, 'workspacePolicies');
  for (const [index, u] of s.users.entries()) for (const [key, value] of Object.entries(u)) if (!['passwordHash','pinHash'].includes(key)) noSecrets(value, `users[${index}].${key}`);
  const restored = storeFromSnapshot(s);
  if (!profiles(restored).some(u => u.enabled && u.systemRole === 'moderator' && (u.passwordHash || u.pinHash) &&
    iam.hasPermission(u, 'USER.MANAGE', restored) && iam.hasPermission(u, 'USER.GRANT', restored))) throw error('IAM_LAST_ADMIN_REQUIRED', 400);
  return s;
}
function baseline(store) {
  const users = profiles(store), records = users.map(u => ({
    id: u.id, username: u.username, enabled: u.enabled, status: u.status, role: u.role, systemRole: u.systemRole,
    passwordHash: u.passwordHash || '', pinHash: u.pinHash || '', managerId: u.managerId || null,
    orgLevel: u.orgLevel, mags: u.mags, mmygs: u.mmygs, buyingGroups: u.buyingGroups,
    permissions: u.permissions, accessAreas: u.accessAreas, collectionAccess: u.collectionAccess,
    dataScope: u.dataScope, effective: [...iam.effectivePermissionSet(u, store)].sort(),
  }));
  return { users: users.length, enabled: users.filter(u => u.enabled).length,
    admins: users.filter(u => u.enabled && u.systemRole === 'moderator' && iam.canAdminUsers(u, store)).length,
    roles: Object.keys(store.iam.roles).length, passwordHashCount: users.filter(u => u.passwordHash || u.pinHash).length,
    semanticSha256: digest({ records, roles: store.iam.roles, policies: store.iam.workspaceTemplates }) };
}
function validateCache(store) {
  if (!store || !store.iam || !Array.isArray(store.users)) throw error('IAM_LOCAL_INVALID');
  const marker = store._centralIam;
  if (!marker || !marker.snapshot) throw error('IAM_LOCAL_INVALID');
  validateSnapshot(marker.snapshot);
  if (digest(marker.snapshot) !== marker.sourceSha256) throw error('IAM_LOCAL_INVALID');
  const expected = storeFromSnapshot(marker.snapshot, store);
  if (store._revision !== expected._revision || digest(profiles(store)) !== digest(profiles(expected)) || digest(store.iam) !== digest(expected.iam)) throw error('IAM_LOCAL_INVALID');
  return store;
}
function writeLocalAtomic(file, value, validate = () => {}) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${crypto.randomUUID()}.tmp`, serialized = JSON.stringify(value);
  try {
    const fd = fs.openSync(tmp, 'wx', 0o600);
    try { fs.writeFileSync(fd, serialized); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    const checked = JSON.parse(fs.readFileSync(tmp, 'utf8')); validate(checked);
    if (digest(checked) !== digest(value)) throw error('IAM_LOCAL_INVALID');
    renameWithRetry(tmp, file);
  } finally { try { fs.unlinkSync(tmp); } catch (e) { if (e.code !== 'ENOENT') throw e; } }
}
/* Windows'ta antivirüs, OneDrive veya aynı anda okuyan bir istek hedef dosyayı
   kısa süre kilitler; rename EPERM/EACCES/EBUSY ile düşer. Tek denemede
   vazgeçmek merkezi dizinin bu cihaza hiç uygulanamamasına (Revizyon 0 ·
   salt okunur) yol açabiliyordu. Kısa ve sınırlı bekleme ile yeniden denenir;
   kalıcı hata eskisi gibi yukarı iletilir. */
const TRANSIENT_RENAME_CODES = new Set(['EPERM', 'EACCES', 'EBUSY']);
function renameWithRetry(from, to, delays = [25, 50, 100, 200, 400], rename = fs.renameSync) {
  for (let attempt = 0; ; attempt += 1) {
    try { return rename(from, to); }
    catch (e) {
      if (!TRANSIENT_RENAME_CODES.has(e && e.code) || attempt >= delays.length) throw e;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, delays[attempt]);
    }
  }
}
async function writeStaged(file, value) {
  const handle = await fsp.open(file, 'wx', 0o600);
  try { await handle.writeFile(JSON.stringify(value)); await handle.sync(); } finally { await handle.close(); }
  if (digest(JSON.parse(await fsp.readFile(file, 'utf8'))) !== digest(value)) throw error('IAM_REMOTE_INVALID');
}
function remoteInvalid(detail) { return Object.assign(error('IAM_REMOTE_INVALID'), { detail }); }
// A revision that cannot be read is skipped only for at most this many older
// revisions; the reader never goes below its own synced revision floor.
const MAX_REVISION_FALLBACK = 20;
function createCentralIam({ sharedRoot, cacheFile, getSharedRoot, onApply = () => {}, fault = async () => {}, canApply = () => true, canCommit = () => true } = {}) {
  const metrics = { remoteReads: 0, snapshotReads: 0, cacheWrites: 0 };
  const health = { enabled: true, localRevision: 0, remoteRevision: null, status: 'uninitialized', lastSyncAt: null, source: 'local', lastError: null, lastErrorDetail: null };
  let memo = null, memoTag = '', pending = null;
  const auditFile = path.join(path.dirname(cacheFile), 'iam-audit.json');
  function localAudit() { try { return JSON.parse(fs.readFileSync(auditFile, 'utf8')); } catch (_) { return []; } }
  function readLocal() {
    let tag = '';
    try { const stat = fs.statSync(cacheFile); tag = `${stat.size}:${stat.mtimeMs}`; } catch (_) {}
    if (tag && memo && tag === memoTag) return clone(memo);
    // A full-system restore may intentionally leave a portable recovery seed
    // while the shared IAM is offline. Do not fall back to the older .bak and
    // silently shrink the restored directory on the next read.
    try { if (JSON.parse(fs.readFileSync(cacheFile, 'utf8'))._restoreSeed) return null; } catch (_) {}
    for (const file of [cacheFile, cacheFile + '.bak']) {
      try {
        const store = validateCache(JSON.parse(fs.readFileSync(file, 'utf8')));
        if (file !== cacheFile) {
          if (fs.existsSync(cacheFile)) fs.copyFileSync(cacheFile, `${cacheFile}.invalid-${crypto.randomUUID()}`, fs.constants.COPYFILE_EXCL);
          writeLocalAtomic(cacheFile, store, validateCache); health.lastError = 'IAM_LOCAL_RECOVERY';
        }
        memo = store; const stat = fs.statSync(cacheFile); memoTag = `${stat.size}:${stat.mtimeMs}`;
        health.localRevision = store._revision; health.lastSyncAt = store._centralIam.syncedAt;
        return clone(store);
      } catch (_) {}
    }
    return null;
  }
  function apply(snapshot, local, audit, { adopted = false } = {}) {
    const sourceSha256 = digest(snapshot), syncedAt = new Date().toISOString();
    // A download can finish after a concurrent local commit. Recheck at the
    // synchronous apply boundary, not only before the asynchronous download.
    // Yalnız Moderatörün açık "merkezi dizini esas al" kararı (adopt) bu tabanı aşar.
    if (!adopted) revisionSafety({ revision: snapshot.revision, sha256: sourceSha256 }, readLocal());
    const cache = { ...storeFromSnapshot(snapshot, local), _centralIam: { iamRevision: snapshot.revision, sourceSha256, syncedAt, snapshot } };
    validateCache(cache);
    // The backup is a validated last-known-good, never a copy of a corrupt file.
    const prior = readLocal();
    if (prior) writeLocalAtomic(cacheFile + '.bak', prior, validateCache);
    writeLocalAtomic(cacheFile, cache, validateCache);
    writeLocalAtomic(cacheFile + '.bak', cache, validateCache);
    writeLocalAtomic(cacheFile.replace(/\.json$/, '.meta.json'), { iamRevision: snapshot.revision, syncedAt, sourceSha256 });
    if (audit) writeLocalAtomic(auditFile, [audit, ...localAudit().filter(a => a.revision !== audit.revision)].slice(0, 1000));
    metrics.cacheWrites++; memo = null;
    Object.assign(health, { localRevision: snapshot.revision, remoteRevision: snapshot.revision, lastSyncAt: syncedAt, status: 'synced', source: 'central', lastError: null, lastErrorDetail: null });
    onApply(cache); return cache;
  }
  async function root() {
    const selected = getSharedRoot ? await getSharedRoot() : sharedRoot;
    if (!selected) throw error('IAM_OFFLINE');
    // Never recreate a missing share as a new local directory.
    try { if (!(await fsp.stat(selected)).isDirectory()) throw error('IAM_OFFLINE'); }
    catch (_) { throw error('IAM_OFFLINE'); }
    return path.join(selected, 'iam');
  }
  async function listRevisions(base) {
    metrics.remoteReads++;
    let entries;
    try { entries = await fsp.readdir(path.join(base, 'revisions'), { withFileTypes: true }); }
    catch (e) { if (e.code === 'ENOENT') throw error('IAM_NOT_INITIALIZED'); throw error('IAM_OFFLINE'); }
    // OneDrive/SharePoint "Files On-Demand" klasörleri Windows'ta reparse point
    // taşır; Node bunları Dirent'te isDirectory()=false, isSymbolicLink()=true
    // bildirir. Yalnız isDirectory() ile süzmek, Shared Hub'ı OneDrive'dan
    // eşitleyen cihazda bütün revizyonları gizleyip IAM_NOT_INITIALIZED
    // üretiyordu (kullanıcı listesi boş). Klasör olmayan bir kayıt zaten
    // meta.json okunurken reddedilir.
    const revisions = entries.filter(e => (e.isDirectory() || e.isSymbolicLink()) && /^\d{16}$/.test(e.name)).map(e => e.name).sort();
    if (!revisions.length) throw error('IAM_NOT_INITIALIZED');
    return revisions;
  }
  async function readMeta(base, name) {
    const dir = path.join(base, 'revisions', name);
    let meta;
    try { meta = JSON.parse(await fsp.readFile(path.join(dir, 'meta.json'), 'utf8')); }
    catch (e) { throw remoteInvalid(`rev ${Number(name)} meta.json ${e.code || 'PARSE'}`); }
    if (!meta || meta.revision !== Number(name) || !/^[a-f0-9]{64}$/.test(meta.sha256)) throw remoteInvalid(`rev ${Number(name)} meta.json fields`);
    return { ...meta, dir };
  }
  async function head(base) {
    const revisions = await listRevisions(base);
    return readMeta(base, revisions.at(-1));
  }
  function revisionSafety(meta, local) {
    let floor = local && local._revision || 0;
    try { floor = Math.max(floor, JSON.parse(fs.readFileSync(cacheFile.replace(/\.json$/, '.meta.json'), 'utf8')).iamRevision || 0); } catch (_) {}
    if (meta.revision < floor) throw error('IAM_REMOTE_REVISION_REGRESSION');
    if (!local) return;
    if (meta.revision === local._revision && meta.sha256 !== local._centralIam.sourceSha256) throw error('IAM_REVISION_HASH_CONFLICT');
  }
  async function readSnapshot(meta) {
    metrics.snapshotReads++;
    let snapshot;
    try { snapshot = JSON.parse(await fsp.readFile(path.join(meta.dir, 'snapshot.json'), 'utf8')); }
    catch (e) { throw remoteInvalid(`rev ${meta.revision} snapshot.json ${e.code || 'PARSE'}`); }
    try { validateSnapshot(snapshot); }
    catch (e) { throw remoteInvalid(`rev ${meta.revision} ${e.detail || e.code || 'snapshot'}`); }
    if (snapshot.revision !== meta.revision || digest(snapshot) !== meta.sha256) throw remoteInvalid(`rev ${meta.revision} snapshot.sha256`);
    return snapshot;
  }
  /* audit.json yalnız denetim kaydıdır: meta.sha256 onu kapsamaz ve girişte
     kullanılmaz. Yazan cihaz kendi revizyonunun audit'ini hiç okumadığından
     eksik/okunamayan/eski biçimli bir audit yalnız önbelleği olmayan YENİ
     cihazda görünüyor ve sha256'sı doğrulanmış snapshot'ı da reddettirip
     kullanıcı listesini boşaltıyordu. Artık audit atlanır (yerel denetim
     günlüğüne yazılmaz), snapshot uygulanır; neden sağlıkta bildirilir. */
  let auditSkipDetail = null;
  async function readRevisionAudit(meta) {
    try { return safeAudit(JSON.parse(await fsp.readFile(path.join(meta.dir, 'audit.json'), 'utf8'))); }
    catch (e) { auditSkipDetail = `rev ${meta.revision} audit.json ${e.code && e.code !== 'IAM_REMOTE_INVALID' ? e.code : 'PARSE'}`; return null; }
  }
  function failed(e) {
    health.lastError = e.code || 'IAM_OFFLINE';
    health.lastErrorDetail = e.detail || null;
    health.status = health.lastError === 'IAM_NOT_INITIALIZED' ? 'uninitialized' : health.lastError.includes('CONFLICT') ? 'conflict' : health.lastError === 'IAM_OFFLINE' ? 'offline' : 'invalid';
    return e;
  }
  async function refresh(options = {}) {
    if (pending) return pending;
    pending = (async () => {
      const base = await root(), revisions = await listRevisions(base), local = readLocal();
      health.remoteRevision = Number(revisions.at(-1));
      // The newest revision folder can be unreadable on this device while the
      // rest of the directory is fine: OneDrive/SharePoint may still be
      // downloading it (folder visible, files not yet), or a newer Buyer Log
      // build wrote a field this build does not know. Previously one such
      // folder made the whole directory unavailable (IAM_REMOTE_INVALID) and
      // a device without a cache could not show any user. Use the newest
      // VALID revision instead, never below this device's synced floor, and
      // report the skipped head as 'stale' so a later refresh moves forward.
      let floor = local && local._revision || 0;
      try { floor = Math.max(floor, JSON.parse(fs.readFileSync(cacheFile.replace(/\.json$/, '.meta.json'), 'utf8')).iamRevision || 0); } catch (_) {}
      if (Number(revisions.at(-1)) < floor) throw error('IAM_REMOTE_REVISION_REGRESSION');
      let headError = null, meta = null, snapshot = null, audit;
      auditSkipDetail = null;
      for (const name of revisions.slice(-MAX_REVISION_FALLBACK).reverse()) {
        if (Number(name) < floor) break;
        try {
          const candidate = await readMeta(base, name);
          revisionSafety(candidate, local);
          if (local && candidate.revision === local._revision) {
            // Nothing newer than this device's cache is readable: keep the
            // original failure (the cache stays the login source).
            if (headError) throw headError;
            meta = candidate; break;
          }
          snapshot = await readSnapshot(candidate);
          audit = await readRevisionAudit(candidate);
          meta = candidate; break;
        } catch (e) {
          if (e.code !== 'IAM_REMOTE_INVALID' || e === headError) throw e;
          headError = headError || e; snapshot = null;
        }
      }
      if (!meta) throw headError || error('IAM_REMOTE_INVALID');
      const stale = () => Object.assign(health, { status: 'stale', lastError: headError.code, lastErrorDetail: headError.detail || null, remoteRevision: Number(revisions.at(-1)) });
      if (!snapshot) { Object.assign(health, { status: 'synced', lastError: null, lastErrorDetail: null }); return local; }
      if (!canApply()) throw error('IAM_RESTORE_IN_PROGRESS', 409);
      if (!local && fs.existsSync(cacheFile)) {
        // Existing independently managed directories must not silently lose
        // users on first central download (including a feature-flag rollback).
        // A brand-new Buyer Log install is the one exception: its generated
        // one-user Moderator placeholder is not an independently managed
        // directory. When an authoritative Central IAM is strictly richer,
        // bootstrap may replace that placeholder, but never a real multi-user
        // local directory.
        let legacy;
        try { legacy = JSON.parse(fs.readFileSync(cacheFile, 'utf8')); } catch (_) {}
        if (legacy && !legacy._centralIam && legacy.moderator) {
          try {
            const normalized = iam.migrateStore(legacy);
            const localBase = baseline(normalized);
            const remoteBase = baseline(storeFromSnapshot(snapshot, normalized));
            const same = localBase.semanticSha256 === remoteBase.semanticSha256;
            const freshPlaceholder = options.allowBootstrapPlaceholderReplace === true
              && localBase.users <= 1
              && localBase.enabled <= 1
              && localBase.admins === 1
              && remoteBase.users > localBase.users
              && remoteBase.admins >= 1
              && remoteBase.passwordHashCount >= localBase.passwordHashCount;
            if (!same && !freshPlaceholder) throw error('IAM_MIGRATION_CONFLICT', 409);
          } catch (e) {
            if (e && e.code === 'IAM_MIGRATION_CONFLICT') throw e;
            throw error('IAM_MIGRATION_CONFLICT', 409);
          }
        }
        // Retain unparseable original evidence before remote recovery too.
        if (!legacy || legacy._centralIam) fs.copyFileSync(cacheFile, `${cacheFile}.invalid-${crypto.randomUUID()}`, fs.constants.COPYFILE_EXCL);
      }
      const applied = apply(snapshot, local || {}, audit);
      if (headError) stale();
      if (!audit && auditSkipDetail) health.lastErrorDetail = [health.lastErrorDetail, auditSkipDetail].filter(Boolean).join(' · ');
      return applied;
    })().catch(e => { throw failed(e); }).finally(() => { pending = null; });
    return pending;
  }
  /* MODERATÖR ONAYLI KURTARMA: "MERKEZİ DİZİNİ ESAS AL".

     Otomatik yenileme bilerek durur: bu cihazın eski yerel listesi merkezle
     uyuşmuyorsa (IAM_MIGRATION_CONFLICT), yerel taban merkezden yeniyse
     (IAM_REMOTE_REVISION_REGRESSION — ör. Shared Hub değişti/geri yüklendi)
     ya da aynı revizyon farklı içerik taşıyorsa (IAM_REVISION_HASH_CONFLICT).
     Çıkış yolu yoktu; cihaz kalıcı olarak salt okunur kalıyordu.

     adopt yalnız şu koşullarda çalışır:
       · merkezin en yeni GEÇERLİ revizyonu okunup doğrulanabiliyor,
       · işlemi yapan kişi o dizinde aktif ve kullanıcı yönetimi yetkili
         (kimse yetkisi olmadığı bir dizini benimseyip kendini kilitleyemez),
       · bu cihazın mevcut kullanıcı dosyası ve revizyon tabanı önce zaman
         damgalı yedeğe kopyalanır (hiçbir şey silinmez).
     Merkezdeki dizine YAZMAZ; yalnız bu cihazın önbelleğini merkezle hizalar. */
  async function adopt({ actorId } = {}) {
    if (pending) { try { await pending; } catch (_) {} }
    if (!canApply()) throw error('IAM_RESTORE_IN_PROGRESS', 409);
    const base = await root(), revisions = await listRevisions(base);
    let candidate = null, snapshot = null, audit = null, firstError = null;
    for (const name of revisions.slice(-MAX_REVISION_FALLBACK).reverse()) {
      try {
        const meta = await readMeta(base, name);
        snapshot = await readSnapshot(meta); audit = await readRevisionAudit(meta); candidate = meta; break;
      } catch (e) {
        if (e.code !== 'IAM_REMOTE_INVALID') throw failed(e);
        firstError = firstError || e; snapshot = null;
      }
    }
    if (!candidate || !snapshot) throw failed(firstError || error('IAM_REMOTE_INVALID'));
    const restored = storeFromSnapshot(snapshot);
    const actor = profiles(restored).find(u => u.id === String(actorId || ''));
    if (!actor || !actor.enabled || !iam.canAdminUsers(actor, restored)) throw error('IAM_ADOPT_ADMIN_REQUIRED', 403);
    const stamp = new Date().toISOString().replace(/[-:.]/g, '');
    const metaFile = cacheFile.replace(/\.json$/, '.meta.json');
    const backups = [];
    for (const file of [cacheFile, metaFile]) {
      if (!fs.existsSync(file)) continue;
      const target = file.replace(/\.json$/, `.pre-adopt-${stamp}.json`);
      fs.copyFileSync(file, target, fs.constants.COPYFILE_EXCL); backups.push(path.basename(target));
    }
    let sidecar = {};
    try { const parsed = JSON.parse(fs.readFileSync(cacheFile, 'utf8')); sidecar = { orderAccess: parsed.orderAccess || {}, scopeCatalog: parsed.scopeCatalog || {} }; } catch (_) {}
    const applied = apply(snapshot, sidecar, audit, { adopted: true });
    return { store: applied, revision: snapshot.revision, backups };
  }
  async function preflight(timeoutMs = 1500, options = {}) {
    let timer;
    try { return await Promise.race([refresh(options), new Promise(resolve => { timer = setTimeout(() => { health.status = 'offline'; resolve(null); }, timeoutMs); })]); }
    catch (_) { return null; } finally { clearTimeout(timer); }
  }
  function dryRun(store) {
    const snapshot = snapshotFromStore(store, 1, { id: 'moderator' }); validateSnapshot(snapshot);
    const before = baseline(store), after = baseline(storeFromSnapshot(snapshot, store));
    if (before.semanticSha256 !== after.semanticSha256) throw error('IAM_MIGRATION_MISMATCH');
    return before;
  }
  async function publish(store, expectedRevision, actor, event, initializing) {
    try {
      if (!canCommit()) throw error('IAM_RESTORE_IN_PROGRESS', 409);
      if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) throw error('IAM_EXPECTED_REVISION_REQUIRED', 400);
      if (initializing && (readLocal() || store._centralIam)) throw error('IAM_ALREADY_INITIALIZED', 409);
      if (initializing) {
        try { if (JSON.parse(fs.readFileSync(cacheFile.replace(/\.json$/, '.meta.json'), 'utf8')).iamRevision > 0) throw error('IAM_ALREADY_INITIALIZED', 409); }
        catch (e) { if (e.code === 'IAM_ALREADY_INITIALIZED') throw e; }
      }
      const base = await root();
      await fsp.mkdir(path.join(base, 'revisions'), { recursive: true });
      return await withFileLeaseAsync(path.join(base, 'locks', 'mutation'), async () => {
        let remote = null;
        try { remote = await head(base); } catch (e) { if (e.code !== 'IAM_NOT_INITIALIZED') throw e; }
        if (!remote && !initializing) throw error('IAM_NOT_INITIALIZED');
        if ((remote && remote.revision || 0) !== expectedRevision || (initializing && remote)) throw Object.assign(error('IAM_REVISION_CONFLICT', 409), { currentRevision: remote && remote.revision || 0 });
        let previous = null;
        if (remote) { revisionSafety(remote, readLocal()); previous = storeFromSnapshot(await readSnapshot(remote)); }
        const authority = previous || store;
        const actorProfile = profiles(authority).find(u => u.id === actor.id);
        if (!actorProfile || !actorProfile.enabled || !iam.canAdminUsers(actorProfile, authority)) throw error('IAM_ADMIN_REQUIRED', 403);
        if (initializing) {
          dryRun(store);
          const backup = path.join(path.dirname(cacheFile), 'user-access.pre-iam-migration.json');
          fs.mkdirSync(path.dirname(backup), { recursive: true });
          if (!fs.existsSync(backup)) {
            const source = fs.existsSync(cacheFile) ? JSON.parse(fs.readFileSync(cacheFile, 'utf8')) : store;
            writeLocalAtomic(backup, source);
          }
        }
        const next = clone(store);
        for (const user of profiles(next)) {
          const old = previous && profiles(previous).find(u => u.id === user.id);
          user.userId = old && old.userId || user.userId || stableUuid(user.id);
          user.credentialRevision = (old && old.credentialRevision || 1) + (old && (old.passwordHash !== user.passwordHash || old.pinHash !== user.pinHash) ? 1 : 0);
          // A directory change can affect hierarchy/role inheritance. Sessions
          // are invalidated for every user whose EFFECTIVE access changed
          // (own fields, role matrix, inherited team rights, data scope);
          // unrelated edits (another user's title, a new account) no longer
          // log the whole team out.
          const accessChanged = !old || accessFingerprint(old, authority) !== accessFingerprint(user, next);
          user.accessRevision = (old && old.accessRevision || 1) + (old && accessChanged ? 1 : 0);
          user.updatedAt = new Date().toISOString(); user.updatedBy = actorProfile.id;
        }
        const snapshot = snapshotFromStore(next, expectedRevision + 1, actorProfile); validateSnapshot(snapshot);
        const sha256 = digest(snapshot), name = String(snapshot.revision).padStart(16, '0');
        const staging = path.join(base, `pending-${crypto.randomUUID()}`), target = path.join(base, 'revisions', name);
        await fsp.mkdir(staging);
        const audit = { id: crypto.randomUUID(), at: snapshot.updatedAt, revision: snapshot.revision,
          actorUserId: actorProfile.userId || stableUuid(actorProfile.id), action: event && /^[A-Z_]+$/.test(event.action) ? event.action : initializing ? 'IAM_INIT' : 'IAM_UPDATE',
          targetUserIds: (event && event.targetUserIds || []).map(id => stableUuid(id)),
          changes: { usersBefore: profiles(authority).length, usersAfter: snapshot.users.length,
            credentialsChanged: previous ? profiles(next).filter(u => { const old = profiles(previous).find(p => p.id === u.id); return old && old.passwordHash !== u.passwordHash; }).length : 0 } };
        audit.before = previous ? auditSummary(previous) : null;
        audit.after = auditSummary(next);
        await writeStaged(path.join(staging, 'snapshot.json'), snapshot);
        await writeStaged(path.join(staging, 'meta.json'), { revision: snapshot.revision, sha256, updatedAt: snapshot.updatedAt, parentSha256: remote && remote.sha256 || null });
        await writeStaged(path.join(staging, 'audit.json'), audit);
        await fault('beforeCommit', { staging, target });
        try { await fsp.rename(staging, target); }
        catch (e) {
          if (['EEXIST','ENOTEMPTY','EPERM','EACCES'].includes(e.code) && fs.existsSync(path.join(target, 'meta.json'))) throw error('IAM_REVISION_CONFLICT', 409);
          throw e;
        }
        // No mutable HEAD: an expired writer cannot regress the pointer.
        try { await fault('afterCommit', { target }); return apply(snapshot, store, audit); }
        catch (_) { throw error('IAM_COMMITTED_CACHE_PENDING'); }
      }, { staleMs: 45000, timeoutMs: 1500, logger: () => {} });
    } catch (e) { throw failed(e.code && e.code.startsWith('IAM_') ? e : error('IAM_WRITE_FAILED')); }
  }
  async function readAudit(limit = 200) {
    const base = await root();
    const entries = (await fsp.readdir(path.join(base, 'revisions'))).filter(n => /^\d{16}$/.test(n)).sort().reverse().slice(0, Math.min(2000, limit));
    return Promise.all(entries.map(n => fsp.readFile(path.join(base, 'revisions', n, 'audit.json'), 'utf8').then(text => safeAudit(JSON.parse(text)))));
  }
  return { cacheFile, metrics, readLocal, refresh, preflight, adopt, dryRun, readAudit, localAudit,
    health: () => ({ ...health }),
    initialize: (store, actor) => publish(store, 0, actor, { action: 'IAM_INIT' }, true),
    commit: (store, revision, actor, event) => publish(store, revision, actor, event, false) };
}
function auditSummary(store) {
  return { users: profiles(store).map(u => ({ userId: u.userId || stableUuid(u.id), enabled: u.enabled,
    systemRole: u.systemRole, managerId: u.managerId ? stableUuid(u.managerId) : null,
    permissions: (u.directPermissions || []).map(g => g.permission),
    accessAreas: u.accessAreas || {}, dataScope: u.dataScope || {}, collectionAccess: u.collectionAccess || [] })),
    roles: Object.fromEntries(Object.entries(store.iam.roles).map(([id, role]) => [id, role.permissions])) };
}
function safeAudit(audit) {
  if (!audit || !Number.isSafeInteger(audit.revision) || !/^[A-Z_]+$/.test(audit.action)) throw error('IAM_REMOTE_INVALID');
  function check(value) {
    if (!value || typeof value !== 'object') return;
    for (const [key, item] of Object.entries(value)) { if (/passwordHash|pinHash|sessionSecret|oauth|token|cookie/i.test(key)) throw error('IAM_REMOTE_INVALID'); check(item); }
  }
  check(audit);
  return audit;
}

module.exports = { createCentralIam, snapshotFromStore, storeFromSnapshot, validateSnapshot, validateCache, writeLocalAtomic, renameWithRetry, baseline, digest, stableUuid, normalizeUsername };
