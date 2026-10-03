'use strict';

const crypto = require('crypto');

const ORG_LEVELS = Object.freeze({
  job_title: 'Görev Tanımı',
  mmyg: 'MMYG',
  mag: 'MAG',
  manager: 'Yönetici',
});
const ORG_LEVEL_RANK = Object.freeze({ job_title: 1, mmyg: 2, mag: 3, manager: 4 });
const SYSTEM_ROLES = Object.freeze({
  buyer: 'Buyer',
  manager: 'Manager',
  senior_manager: 'Senior Manager',
  moderator: 'Moderatör',
});
const ROLE_DEFAULT_SCOPE = Object.freeze({ buyer: 'SELF', manager: 'MMYG', senior_manager: 'MAG', moderator: 'ALL' });
const USER_STATUSES = Object.freeze({ ACTIVE: 'Aktif', INACTIVE: 'Pasif', SUSPENDED: 'Askıya Alındı' });
const DATA_SCOPE_MODES = Object.freeze({ SELF: 'Kendi Verisi', TEAM: 'Ekibi', MMYG: 'MMYG', MAG: 'MAG', ALL: 'Tümü', CUSTOM: 'Özel' });
const ACTIONS = Object.freeze(['VIEW', 'CREATE', 'EDIT', 'DELETE', 'APPROVE', 'EXPORT', 'MANAGE', 'GRANT', 'PROFILE_COPY', 'SEARCH', 'LINK', 'PIN', 'TIMELINE_VIEW', 'ATTACHMENT_VIEW', 'AI_SUMMARY', 'ADMIN']);
const RESOURCES = Object.freeze({
  OVERVIEW: { tr: 'Genel Bakış', en: 'Overview', actions: ['VIEW', 'EXPORT'], safe: true },
  CP: { tr: 'CP', en: 'CP', actions: ['VIEW', 'CREATE', 'EDIT', 'DELETE', 'EXPORT'], safe: true },
  ORDERS: { tr: 'Siparişler', en: 'Orders', actions: ['VIEW', 'CREATE', 'EDIT', 'DELETE', 'APPROVE', 'EXPORT', 'MANAGE'], safe: true },
  COLLECTIONS: { tr: 'Koleksiyon', en: 'Collections', actions: ['VIEW', 'CREATE', 'EDIT', 'DELETE', 'APPROVE', 'EXPORT', 'MANAGE'], safe: true },
  BACKLOG: { tr: 'Backlog', en: 'Backlog', actions: ['VIEW', 'EXPORT'], safe: true },
  OAB: { tr: 'OAB', en: 'OAB', actions: ['VIEW', 'CREATE', 'EDIT', 'DELETE', 'EXPORT', 'MANAGE'], safe: true },
  QUOTATIONS: { tr: 'Quotations', en: 'Quotations', actions: ['VIEW', 'CREATE', 'EDIT', 'DELETE', 'APPROVE', 'EXPORT'], safe: true },
  ANALYSIS: { tr: 'Analizler', en: 'Analysis', actions: ['VIEW', 'EXPORT'], safe: true },
  OPEN_COSTING: { tr: 'Ön Maliyet', en: 'Open Costing', actions: ['VIEW', 'CREATE', 'EDIT', 'DELETE', 'EXPORT'] },
  SHIPPING: { tr: 'Nakliye Kıyaslama', en: 'Shipping Comparison', actions: ['VIEW', 'CREATE', 'EDIT', 'DELETE', 'EXPORT'] },
  AGENTS: { tr: 'Agent Workflow Studio', en: 'Agent Workflow Studio', actions: ['VIEW', 'CREATE', 'EDIT', 'DELETE', 'APPROVE', 'MANAGE'] },
  AUTOMATIONS: { tr: 'Otomasyonlar', en: 'Automations', actions: ['VIEW', 'CREATE', 'EDIT', 'DELETE', 'APPROVE', 'MANAGE'] },
  SOURCE_DATA: { tr: 'Kaynak Veri', en: 'Source Data', actions: ['VIEW', 'CREATE', 'EDIT', 'DELETE', 'EXPORT', 'MANAGE'] },
  USER: { tr: 'Kullanıcı Yönetimi', en: 'User Management', actions: ['VIEW', 'CREATE', 'EDIT', 'MANAGE', 'GRANT', 'PROFILE_COPY'], security: true },
  ROLE: { tr: 'Rol Yönetimi', en: 'Role Management', actions: ['VIEW', 'MANAGE'], security: true },
  PERMISSION: { tr: 'Yetki Yönetimi', en: 'Permission Management', actions: ['VIEW', 'MANAGE', 'GRANT'], security: true },
  SYSTEM: { tr: 'Sistem Ayarları', en: 'System Configuration', actions: ['VIEW', 'MANAGE'], security: true },
  SECURITY: { tr: 'Güvenlik', en: 'Security', actions: ['VIEW', 'MANAGE'], security: true },
  AUDIT: { tr: 'Denetim Kaydı', en: 'Audit Log', actions: ['VIEW', 'EXPORT'], security: true },
});

const PERMISSION_REGISTRY = Object.freeze(Object.entries(RESOURCES).flatMap(([resource, meta]) =>
  meta.actions.map(action => Object.freeze({
    code: `${resource}.${action}`, resource, action,
    labelTr: `${meta.tr} · ${action}`, labelEn: `${meta.en} · ${action}`,
    security: Boolean(meta.security), inheritable: !meta.security,
  }))
));
const PERMISSION_CODES = new Set(PERMISSION_REGISTRY.map(item => item.code));
const SECURITY_PERMISSIONS = new Set(PERMISSION_REGISTRY.filter(item => item.security).map(item => item.code));
const SAFE_VIEW_PERMISSIONS = Object.freeze(['CP.VIEW', 'ORDERS.VIEW', 'COLLECTIONS.VIEW', 'BACKLOG.VIEW', 'OAB.VIEW', 'QUOTATIONS.VIEW', 'ANALYSIS.VIEW']);
/* Buyer kendi ASAS kaynağını yeniler ve fiyat talebi açar/düzenler (kullanıcı
   kararı). Ortak ayarları (kur, royalty, yol süreleri, DTR/non-DTR, e-posta
   grupları, Endeksmatik, veri bağlantıları) değiştirme izni SOURCE_DATA.MANAGE
   hiçbir rolde varsayılan DEĞİLDİR; yalnız Moderatör kişiye özel verir.
   COLLECTIONS.EDIT tek başına başkasının koleksiyonunu açmaz: koleksiyon
   sahibinin açık "düzenleme" grantiyle birlikte gerekir. Varsayılan olmadığında
   sahibin verdiği düzenleme yetkisi buyer'da sessizce salt okunura düşüyordu. */
const BUYER_DEFAULT_PERMISSIONS = Object.freeze([...SAFE_VIEW_PERMISSIONS, 'SOURCE_DATA.VIEW', 'QUOTATIONS.CREATE', 'QUOTATIONS.EDIT', 'COLLECTIONS.EDIT']);
const SHARED_SETTINGS_PERMISSION = 'SOURCE_DATA.MANAGE';
/* Saklanmış rol matrisleri (merkezi IAM dahil) varsayılan değişikliğini bir
   kez alır; rol nesnesindeki defaultsRevision işareti sonraki Moderatör
   düzenlemelerinin geri alınmasını engeller. */
const ROLE_DEFAULTS_REVISION = 3;
const ROLE_DEFAULT_MIGRATIONS = Object.freeze({
  2: Object.freeze({
    buyer: { add: ['SOURCE_DATA.VIEW', 'QUOTATIONS.CREATE', 'QUOTATIONS.EDIT'], remove: [] },
    manager: { add: [], remove: [SHARED_SETTINGS_PERMISSION] },
    senior_manager: { add: [], remove: [SHARED_SETTINGS_PERMISSION] },
  }),
  3: Object.freeze({
    buyer: { add: ['COLLECTIONS.EDIT'], remove: [] },
  }),
});
const LEGACY_AREA_RESOURCE = Object.freeze({
  overview: 'OVERVIEW', cp: 'CP', orders: 'ORDERS', koleksiyon: 'COLLECTIONS', lfl: 'ANALYSIS',
  opencosting: 'OPEN_COSTING', backlog: 'BACKLOG', shipping: 'SHIPPING', agents: 'AGENTS',
  automations: 'AUTOMATIONS', source: 'SOURCE_DATA',
});
const LEGACY_PERMISSION_CODES = Object.freeze({
  manageBackup: ['SYSTEM.MANAGE'],
  manageBusinessRules: ['SOURCE_DATA.MANAGE'],
  manageModelConnections: ['SOURCE_DATA.MANAGE', 'SYSTEM.MANAGE'],
  manageAllOrders: ['ORDERS.MANAGE', 'ORDERS.EDIT'],
  manageCollections: ['COLLECTIONS.MANAGE', 'COLLECTIONS.EDIT'],
});

function clean(value) { return String(value == null ? '' : value).trim(); }
function normalized(value) { return clean(value).toLocaleUpperCase('tr-TR'); }
function uniq(values) {
  const out = [], seen = new Set();
  for (const raw of values || []) { const value = clean(raw); const key = normalized(value); if (value && !seen.has(key)) { seen.add(key); out.push(value); } }
  return out;
}
function normalizeSystemRole(value, legacyRole) {
  const key = clean(value);
  if (Object.prototype.hasOwnProperty.call(SYSTEM_ROLES, key)) return key;
  if (key === 'standard') return 'buyer';
  if (key === 'system_admin') return 'moderator';
  return ({ moderator: 'moderator', manager: 'senior_manager', team_lead: 'manager', buyer: 'buyer' })[clean(legacyRole)] || 'buyer';
}
function normalizeOrgLevel(value, legacyRole) {
  const key = clean(value);
  if (Object.prototype.hasOwnProperty.call(ORG_LEVELS, key)) return key;
  return ({ buyer: 'job_title', team_lead: 'mmyg', manager: 'mag', moderator: 'manager' })[clean(legacyRole)] || 'job_title';
}
function normalizeStatus(value, enabled) {
  const status = normalized(value);
  if (Object.prototype.hasOwnProperty.call(USER_STATUSES, status)) return status;
  return enabled === false ? 'INACTIVE' : 'ACTIVE';
}
function normalizeScopeMode(value, legacyMode, systemRole) {
  const mode = normalized(value);
  if (Object.prototype.hasOwnProperty.call(DATA_SCOPE_MODES, mode)) return mode;
  if (ROLE_DEFAULT_SCOPE[systemRole]) return ROLE_DEFAULT_SCOPE[systemRole];
  if (legacyMode === 'custom') return 'CUSTOM';
  if (legacyMode === 'auto') return 'TEAM';
  return 'SELF';
}
function normalizeStableIds(value, profile) {
  const src = value && typeof value === 'object' ? value : {};
  const out = {
    employeeId: clean(src.employeeId || profile.employeeId), corporateId: clean(src.corporateId || profile.corporateId),
    buyerId: clean(src.buyerId || profile.buyerId), sourceId: clean(src.sourceId || profile.sourceId),
    email: clean(src.email || profile.email).toLocaleLowerCase('tr-TR'),
  };
  if (!Object.values(out).some(Boolean)) out.sourceId = `legacy:${clean(profile.id) || crypto.randomUUID()}`;
  return out;
}
function identityKeys(stableIds) {
  const src = stableIds || {};
  return ['employeeId', 'corporateId', 'buyerId', 'sourceId', 'email'].map(key => src[key] ? `${key}:${normalized(src[key])}` : '').filter(Boolean);
}
function normalizeGrant(item, fallbackSource = 'DIRECT') {
  if (typeof item === 'string') item = { permission: item };
  const permission = normalized(item && (item.permission || item.code));
  if (!PERMISSION_CODES.has(permission)) return null;
  return {
    id: clean(item.id) || `grant-${crypto.randomUUID()}`,
    permission,
    source: ['DIRECT', 'TEMPORARY'].includes(normalized(item.source)) ? normalized(item.source) : fallbackSource,
    reason: clean(item.reason).slice(0, 500),
    validFrom: clean(item.validFrom) || null,
    validUntil: clean(item.validUntil) || null,
    grantedBy: clean(item.grantedBy) || null,
    grantedAt: clean(item.grantedAt) || new Date().toISOString(),
  };
}
function legacyGrants(profile, systemRole) {
  const codes = new Set();
  for (const [area, resource] of Object.entries(LEGACY_AREA_RESOURCE)) if (profile.accessAreas && profile.accessAreas[area]) codes.add(`${resource}.VIEW`);
  for (const [legacy, mapped] of Object.entries(LEGACY_PERMISSION_CODES)) if (profile.permissions && profile.permissions[legacy]) mapped.forEach(code => codes.add(code));
  // The legacy Moderator had unrestricted access. Preserve that exact effective
  // access during migration, especially for the stable Gökberk account.
  if (systemRole === 'moderator' && clean(profile.id) === 'moderator') PERMISSION_REGISTRY.forEach(item => codes.add(item.code));
  return [...codes].map(permission => normalizeGrant({ permission, source: 'DIRECT', reason: 'Legacy access migration', grantedBy: 'migration' }));
}
function normalizeProfileIam(profile) {
  const systemRole = normalizeSystemRole(profile.systemRole, profile.role);
  const orgLevel = normalizeOrgLevel(profile.orgLevel, profile.role);
  const stableIds = normalizeStableIds(profile.stableIds, profile);
  let directPermissions = Array.isArray(profile.directPermissions) ? profile.directPermissions.map(item => normalizeGrant(item, 'DIRECT')).filter(Boolean) : [];
  if (!directPermissions.length && Number(profile.iamVersion || 0) < 1) directPermissions = legacyGrants(profile, systemRole);
  const temporaryPermissions = Array.isArray(profile.temporaryPermissions) ? profile.temporaryPermissions.map(item => normalizeGrant(item, 'TEMPORARY')).filter(Boolean) : [];
  const legacyScope = profile.customScopes || {};
  const dataScope = profile.dataScope && typeof profile.dataScope === 'object' ? profile.dataScope : {};
  return {
    ...profile,
    iamVersion: 1,
    systemRole,
    orgLevel,
    status: normalizeStatus(profile.status, profile.enabled),
    enabled: normalizeStatus(profile.status, profile.enabled) === 'ACTIVE',
    /* v7.25 — MODERATÖRÜN DE YÖNETİCİSİ OLABİLİR (kullanıcı talebi).
       Önceden kök Moderatör hesabının managerId'si her normalizasyonda
       null'a çekiliyordu, yani atansa bile kayboluyordu. Hesabın korunan
       yanları (silinememesi, rolünün ve aktifliğinin sabitliği) yerinde
       kalır; döngü koruması validateHierarchy'de zaten var. */
    managerId: clean(profile.managerId || profile.supervisorId) || null,
    supervisorId: clean(profile.managerId || profile.supervisorId) || null,
    stableIds,
    identityKey: identityKeys(stableIds)[0] || `sourceId:LEGACY:${clean(profile.id)}`,
    external: Boolean(profile.external),
    directPermissions,
    temporaryPermissions,
    dataScope: {
      mode: normalizeScopeMode(dataScope.mode, profile.scopeMode, systemRole),
      buyers: uniq(dataScope.buyers || legacyScope.buyers), mags: uniq(dataScope.mags || legacyScope.mags),
      mmygs: uniq(dataScope.mmygs || legacyScope.mmygs), buyingGroups: uniq(dataScope.buyingGroups || legacyScope.buyingGroups),
    },
  };
}
function defaultRoles() {
  const business = PERMISSION_REGISTRY.filter(item => !item.security).map(item => item.code);
  const businessManage = PERMISSION_REGISTRY.filter(item => !item.security && ['VIEW', 'CREATE', 'EDIT', 'EXPORT', 'APPROVE', 'MANAGE'].includes(item.action)).map(item => item.code);
  return {
    buyer: { id: 'buyer', nameTr: SYSTEM_ROLES.buyer, nameEn: 'Buyer', defaultDataScope: 'SELF', permissions: [...BUYER_DEFAULT_PERMISSIONS], system: true, defaultsRevision: ROLE_DEFAULTS_REVISION },
    manager: { id: 'manager', nameTr: SYSTEM_ROLES.manager, nameEn: 'Manager', defaultDataScope: 'MMYG', permissions: businessManage.filter(code => code !== SHARED_SETTINGS_PERMISSION), system: true, defaultsRevision: ROLE_DEFAULTS_REVISION },
    senior_manager: { id: 'senior_manager', nameTr: SYSTEM_ROLES.senior_manager, nameEn: 'Senior Manager', defaultDataScope: 'MAG', permissions: business.filter(code => code !== SHARED_SETTINGS_PERMISSION), system: true, defaultsRevision: ROLE_DEFAULTS_REVISION },
    moderator: { id: 'moderator', nameTr: SYSTEM_ROLES.moderator, nameEn: 'Moderator', defaultDataScope: 'ALL', permissions: PERMISSION_REGISTRY.map(item => item.code), system: true, defaultsRevision: ROLE_DEFAULTS_REVISION },
  };
}
// v7.16: normalizeRoles her profil için yeniden çağrılıyordu ve her çağrı dört
// rolün tam izin listesini baştan kuruyordu. Aynı roles nesnesi için sonuç
// değişmediğinden WeakMap ile bir kez türetilir.
const normalizedRolesCache = new WeakMap();
function normalizeRoles(value) {
  if (value && typeof value === 'object') {
    const cached = normalizedRolesCache.get(value);
    if (cached) return cached;
    const computed = computeNormalizedRoles(value);
    normalizedRolesCache.set(value, computed);
    return computed;
  }
  return computeNormalizedRoles(value);
}
function computeNormalizedRoles(value) {
  const defaults = defaultRoles(), src = value && typeof value === 'object' ? value : {};
  const aliases = { buyer: ['buyer', 'standard'], manager: ['manager'], senior_manager: ['senior_manager'], moderator: ['moderator', 'system_admin'] };
  const out = {};
  for (const [id, base] of Object.entries(defaults)) {
    const sourceId = aliases[id].find(alias => src[alias] && typeof src[alias] === 'object');
    const role = sourceId ? src[sourceId] : {};
    const explicitScope = clean(role.defaultDataScope).toLocaleUpperCase('tr-TR');
    let permissions = uniq(role.permissions || base.permissions).map(normalized).filter(code => PERMISSION_CODES.has(code));
    if (sourceId && Array.isArray(role.permissions)) {
      for (let revision = (Number(role.defaultsRevision) || 1) + 1; revision <= ROLE_DEFAULTS_REVISION; revision += 1) {
        const step = ROLE_DEFAULT_MIGRATIONS[revision] && ROLE_DEFAULT_MIGRATIONS[revision][id];
        if (!step) continue;
        permissions = uniq([...permissions.filter(code => !step.remove.includes(code)), ...step.add]);
      }
    }
    out[id] = { ...base, ...role, id, nameTr: base.nameTr, nameEn: base.nameEn,
      defaultDataScope: Object.prototype.hasOwnProperty.call(DATA_SCOPE_MODES, explicitScope) ? explicitScope : base.defaultDataScope,
      permissions, defaultsRevision: ROLE_DEFAULTS_REVISION };
  }
  return out;
}
function normalizeWorkspaceTemplates(value) {
  const src = value && typeof value === 'object' ? value : {}, out = {};
  for (const roleId of Object.keys(SYSTEM_ROLES)) {
    const raw = src[roleId] && typeof src[roleId] === 'object' ? src[roleId] : {};
    const entries = raw.entries && typeof raw.entries === 'object' && !Array.isArray(raw.entries) ? raw.entries : {};
    out[roleId] = {
      roleId,
      entries,
      categories: Array.isArray(raw.categories) ? uniq(raw.categories.map(item => clean(item).toLowerCase())) : [],
      sourceUserId: clean(raw.sourceUserId) || null,
      sourceName: clean(raw.sourceName),
      updatedBy: clean(raw.updatedBy) || null,
      updatedAt: clean(raw.updatedAt) || null,
    };
  }
  return out;
}
function migrateStore(store) {
  const next = { ...(store || {}) };
  const previousIamVersion = Number(store && store.iam && store.iam.version) || 0;
  const roles = normalizeRoles(store && store.iam && store.iam.roles);
  if (previousIamVersion < 2 && !roles.moderator.permissions.includes('USER.PROFILE_COPY')) roles.moderator.permissions.push('USER.PROFILE_COPY');
  const workspaceTemplates = normalizeWorkspaceTemplates(store && store.iam && store.iam.workspaceTemplates);
  next.iam = { version: 5, roles, workspaceTemplates, migratedAt: clean(store && store.iam && store.iam.migratedAt) || new Date().toISOString() };
  if (next.moderator) next.moderator = normalizeProfileIam(next.moderator);
  next.users = (Array.isArray(next.users) ? next.users : []).map(normalizeProfileIam);
  next.schemaVersion = Math.max(8, Number(next.schemaVersion) || 0);
  return next;
}
function allProfiles(store) { return [store && store.moderator, ...(store && Array.isArray(store.users) ? store.users : [])].filter(Boolean); }
// v7.16: allProfiles(store) döngünün İÇİNDE çağrılıyordu; her adımda bütün
// profil listesi yeniden kurulup baştan taranıyordu (profil sayısının karesi).
// Yönetici → çocuklar haritası bir kez kurulur, gezinme doğrusal olur. Sonuç
// ve sıralama birebir aynıdır: aynı genişlik-öncelikli sıra korunur.
function childrenByManager(store) {
  const map = new Map();
  for (const profile of allProfiles(store)) {
    const key = clean(profile.managerId || profile.supervisorId);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(profile);
  }
  return map;
}
function descendants(store, id, children = null) {
  const byManager = children || childrenByManager(store);
  const out = [], seen = new Set([clean(id)]), queue = (byManager.get(clean(id)) || []).slice();
  while (queue.length) {
    const profile = queue.shift();
    if (!profile || seen.has(profile.id)) continue;
    seen.add(profile.id); out.push(profile);
    queue.push(...(byManager.get(clean(profile.id)) || []));
  }
  return out;
}
function activeGrant(grant, now = Date.now()) {
  const from = grant.validFrom ? Date.parse(grant.validFrom) : 0, until = grant.validUntil ? Date.parse(grant.validUntil) : Infinity;
  return (!from || from <= now) && (!Number.isFinite(until) || now < until);
}
function assignedPermissionDetails(profile, store, now = Date.now()) {
  const out = [];
  const role = normalizeRoles(store && store.iam && store.iam.roles)[profile.systemRole] || defaultRoles().buyer;
  for (const permission of role.permissions) out.push({ permission, source: 'ROLE', sourceId: role.id, sourceLabel: role.nameTr });
  for (const grant of profile.directPermissions || []) if (activeGrant(grant, now)) out.push({ permission: grant.permission, source: 'DIRECT', sourceId: grant.id, reason: grant.reason });
  for (const grant of profile.temporaryPermissions || []) if (activeGrant(grant, now)) out.push({ permission: grant.permission, source: 'TEMPORARY', sourceId: grant.id, reason: grant.reason, validFrom: grant.validFrom, validUntil: grant.validUntil });
  return out.filter(item => PERMISSION_CODES.has(item.permission));
}
function effectivePermissionDetails(profile, store, now = Date.now()) {
  if (!profile) return [];
  const out = assignedPermissionDetails(profile, store, now), seenHierarchy = new Set();
  for (const child of descendants(store, profile.id, childrenByManager(store))) {
    for (const item of assignedPermissionDetails(child, store, now)) {
      // Ortak ayar yetkisi kişiye özeldir: ekibin yöneticisine miras KALMAZ.
      if (SECURITY_PERMISSIONS.has(item.permission) || item.permission === SHARED_SETTINGS_PERMISSION) continue;
      const key = `${child.id}|${item.permission}`; if (seenHierarchy.has(key)) continue; seenHierarchy.add(key);
      out.push({ permission: item.permission, source: 'HIERARCHY', sourceId: child.id, sourceLabel: child.displayName || child.username, inheritedFrom: child.id });
    }
  }
  return out;
}
function effectivePermissionSet(profile, store, now = Date.now()) { return new Set(effectivePermissionDetails(profile, store, now).map(item => item.permission)); }
function hasPermission(profile, permission, store, now = Date.now()) { return effectivePermissionSet(profile, store, now).has(normalized(permission)); }
function isSecurityPermission(permission) { return SECURITY_PERMISSIONS.has(normalized(permission)); }
function isPrivilegedRole(role) { return role === 'moderator'; }
function canAdminUsers(profile, store) { return Boolean(profile && (hasPermission(profile, 'USER.MANAGE', store) || hasPermission(profile, 'USER.GRANT', store))); }
function canGrant(actor, permission, store) {
  return Boolean(actor && isPrivilegedRole(actor.systemRole) && hasPermission(actor, 'USER.GRANT', store) && hasPermission(actor, permission, store));
}
function validateHierarchy(store, targetId, managerId) {
  const id = clean(targetId), parent = clean(managerId);
  if (!parent) return true;
  if (id === parent) throw Object.assign(new Error('Kullanıcı kendi yöneticisi olamaz.'), { code: 'HIERARCHY_CYCLE', statusCode: 400 });
  const profiles = allProfiles(store), manager = profiles.find(item => item.id === parent);
  if (!manager || manager.status !== 'ACTIVE') throw Object.assign(new Error('Seçilen yönetici bulunamadı veya aktif değil.'), { code: 'MANAGER_NOT_FOUND', statusCode: 400 });
  if (descendants(store, id).some(item => item.id === parent)) throw Object.assign(new Error('Organizasyon ağacında döngü oluşturulamaz.'), { code: 'HIERARCHY_CYCLE', statusCode: 400 });
  return true;
}
function findDuplicate(store, stableIds, exceptId = '') {
  const keys = new Set(identityKeys(stableIds)); if (!keys.size) return null;
  return allProfiles(store).find(profile => profile.id !== exceptId && identityKeys(profile.stableIds).some(key => keys.has(key))) || null;
}
function mergeScopes(a, b) {
  return { buyers: uniq([...(a.buyers || []), ...(b.buyers || [])]), mags: uniq([...(a.mags || []), ...(b.mags || [])]), mmygs: uniq([...(a.mmygs || []), ...(b.mmygs || [])]), buyingGroups: uniq([...(a.buyingGroups || []), ...(b.buyingGroups || [])]) };
}
function ownScope(profile) {
  return { buyers: uniq([profile.username, profile.displayName]), mags: uniq(profile.mags), mmygs: uniq(profile.mmygs), buyingGroups: uniq(profile.buyingGroups) };
}
function effectiveDataScope(profile, store) {
  const mode = profile && profile.dataScope && profile.dataScope.mode || 'SELF';
  if (mode === 'ALL') return { mode, all: true, buyers: [], mags: [], mmygs: [], buyingGroups: [] };
  if (mode === 'CUSTOM') return { mode, all: false, buyers: uniq(profile.dataScope.buyers), mags: uniq(profile.dataScope.mags), mmygs: uniq(profile.dataScope.mmygs), buyingGroups: uniq(profile.dataScope.buyingGroups) };
  let scope = ownScope(profile || {});
  if (mode === 'TEAM') for (const child of descendants(store, profile.id)) scope = mergeScopes(scope, ownScope(child));
  if (mode === 'MMYG') {
    const allowed = new Set((profile.mmygs || []).map(normalized));
    for (const item of allProfiles(store)) if ((item.mmygs || []).some(value => allowed.has(normalized(value)))) scope = mergeScopes(scope, ownScope(item));
  }
  if (mode === 'MAG') {
    const allowed = new Set((profile.mags || []).map(normalized));
    for (const item of allProfiles(store)) if ((item.mags || []).some(value => allowed.has(normalized(value)))) scope = mergeScopes(scope, ownScope(item));
  }
  return { mode, all: false, ...scope };
}
function rowInScope(row, scope) {
  if (scope && scope.all) return true;
  const match = (list, value) => !list.length || list.some(item => normalized(item) === normalized(value));
  const buyer = row && (row.buyer ?? row.Buyer),
    mag = row && (row.merch ?? row.mag ?? row.MAG ?? row['Merch Alt Grup Kod'] ?? row['Merch Alt Grup']),
    mmyg = row && (row.ageGroup ?? row.mmyg ?? row.MMYG ?? row['Merch Marka Yaş Grup Kod'] ?? row['Merch Marka Yas Grup Kod']),
    buyingGroup = row && (row.buyerGrup ?? row.buyingGroup ?? row['Buying Group'] ?? row['Buyer Grup (TR)']);
  const configured = [[scope.buyers || [], buyer], [scope.mags || [], mag], [scope.mmygs || [], mmyg], [scope.buyingGroups || [], buyingGroup]].filter(([list]) => list.length);
  return configured.length > 0 && configured.every(([list, value]) => clean(value) && match(list, value));
}
function filterRows(profile, rows, store) { const scope = effectiveDataScope(profile, store); return (Array.isArray(rows) ? rows : []).filter(row => rowInScope(row, scope)); }

module.exports = {
  ORG_LEVELS, ORG_LEVEL_RANK, SYSTEM_ROLES, ROLE_DEFAULT_SCOPE, USER_STATUSES, DATA_SCOPE_MODES, ACTIONS, RESOURCES,
  PERMISSION_REGISTRY, PERMISSION_CODES, SECURITY_PERMISSIONS, SAFE_VIEW_PERMISSIONS, BUYER_DEFAULT_PERMISSIONS, SHARED_SETTINGS_PERMISSION, ROLE_DEFAULTS_REVISION, LEGACY_AREA_RESOURCE,
  normalizeProfileIam, normalizeRoles, normalizeWorkspaceTemplates, migrateStore, identityKeys, findDuplicate, descendants, validateHierarchy,
  assignedPermissionDetails, effectivePermissionDetails, effectivePermissionSet, hasPermission, isSecurityPermission,
  isPrivilegedRole, canAdminUsers, canGrant, effectiveDataScope, rowInScope, filterRows, normalizeGrant, clean, uniq,
};
