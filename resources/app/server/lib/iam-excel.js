'use strict';

/* KULLANICI DİZİNİ — EXCEL DIŞA / İÇE AKTARMA ve YETKİ GÖZDEN GEÇİRME RAPORU.

   Dışa aktarma, yönetim ekranındaki görünür kullanıcıları dört sayfaya yazar:
     Kullanıcılar          içe aktarmada geri okunan tek sayfa
     Yetki Gözden Geçirme  kişi başına özet + boş "Onay" sütunu (periyodik denetim)
     Etkin Yetkiler        her yetki ve kaynağı (rol / ek rol / özel / süreli / hiyerarşi)
     Roller                sistem rollerinin yetkileri ve ek roller
   Parola, parola özeti, oturum ve cihaz bilgisi hiçbir sayfaya yazılmaz.

   İçe aktarma yalnız "Kullanıcılar" sayfasını okur ve bu modül YALNIZ PLAN
   üretir: hangi kullanıcı güncellenecek/oluşturulacak, hangi satır hatalı.
   Planın uygulanması user-access içindeki normal doğrulamalardan (rol yükseltme,
   hiyerarşi döngüsü, yönetim alanı, tekil kullanıcı adı) geçer.

   Başlıklar bu dosyanın kendi dışa aktarma biçimidir (TR ve EN); iş verisi
   kaynağı (ASAS/PLM) başlığı değildir. */

let XLSX = null;
function xlsx() { if (!XLSX) XLSX = require('xlsx'); return XLSX; }

const MAX_IMPORT_ROWS = 2000;
const COLUMNS = Object.freeze([
  { key: 'username', tr: 'Kullanıcı adı', en: 'User name' },
  { key: 'displayName', tr: 'Görünen ad', en: 'Display name' },
  { key: 'title', tr: 'Title', en: 'Title' },
  { key: 'email', tr: 'E-posta', en: 'E-mail' },
  { key: 'role', tr: 'Rol', en: 'Role' },
  { key: 'status', tr: 'Durum', en: 'Status' },
  { key: 'mags', tr: 'MAG', en: 'MAG' },
  { key: 'mmygs', tr: 'MMYG', en: 'MMYG' },
  { key: 'buyingGroups', tr: 'Buying Group', en: 'Buying Group' },
  { key: 'manager', tr: 'Yönetici (kullanıcı adı)', en: 'Manager (user name)' },
  { key: 'dataScope', tr: 'Veri kapsamı', en: 'Data scope' },
  { key: 'bundles', tr: 'Ek roller', en: 'Extra roles', readOnly: true },
  { key: 'updatedAt', tr: 'Son güncelleme', en: 'Last updated', readOnly: true },
]);
const ROLE_NAMES = Object.freeze({ buyer: ['buyer'], manager: ['manager'], senior_manager: ['senior manager', 'senior_manager'], moderator: ['moderatör', 'moderator'] });
const STATUS_NAMES = Object.freeze({ ACTIVE: ['aktif', 'active'], INACTIVE: ['inaktif', 'pasif', 'inactive'], SUSPENDED: ['askıda', 'askıya alındı', 'suspended'] });
const SCOPE_NAMES = Object.freeze({ SELF: ['self', 'kendi kayıtları', 'own records'], TEAM: ['team', 'ekibi', 'their team'], MMYG: ['mmyg'], MAG: ['mag'], ALL: ['all', 'tüm veriler', 'all data'], CUSTOM: ['custom', 'özel'] });

const clean = value => String(value == null ? '' : value).trim();
const fold = value => clean(value).toLocaleLowerCase('tr-TR');
const T = (lang, tr, en) => (lang === 'en' ? en : tr);
const splitList = value => clean(value).split(/[;,\n]/).map(clean).filter(Boolean);
function lookup(map, value) {
  const wanted = fold(value);
  if (!wanted) return '';
  for (const [id, names] of Object.entries(map)) if (fold(id) === wanted || names.includes(wanted)) return id;
  return null;
}
const ROLE_LABEL = { buyer: 'Buyer', manager: 'Manager', senior_manager: 'Senior Manager', moderator: ['Moderatör', 'Moderator'] };
function roleLabel(id, lang) { const label = ROLE_LABEL[id] || id; return Array.isArray(label) ? T(lang, label[0], label[1]) : label; }
function statusLabel(id, lang) { return ({ ACTIVE: T(lang, 'Aktif', 'Active'), INACTIVE: T(lang, 'İnaktif', 'Inactive'), SUSPENDED: T(lang, 'Askıda', 'Suspended') })[id] || id; }
function sourceLabel(item, lang) {
  return ({ ROLE: T(lang, 'Rol', 'Role'), BUNDLE: T(lang, 'Ek rol', 'Extra role'), DIRECT: T(lang, 'Kişiye özel', 'Direct'), TEMPORARY: T(lang, 'Süreli', 'Temporary'), HIERARCHY: T(lang, 'Hiyerarşi', 'Hierarchy') })[item.source] || item.source;
}

/* model: { users, roles, bundles, permissionText(code), lang } — users are the
   admin list entries (adminUser), never raw stored profiles. */
function buildWorkbook({ users, roles, bundles, permissionText, lang = 'tr' }) {
  const X = xlsx(), book = X.utils.book_new();
  const byId = new Map(users.map(user => [user.id, user]));
  const bundleName = id => { const bundle = (bundles || []).find(item => item.id === id); return bundle ? T(lang, bundle.nameTr, bundle.nameEn || bundle.nameTr) : id; };
  const userRows = users.map(user => ({
    username: user.username || '', displayName: user.displayName || '', title: user.title || '', email: user.email || '',
    role: roleLabel(user.systemRole, lang), status: statusLabel(user.status, lang),
    mags: (user.mags || []).join('; '), mmygs: (user.mmygs || []).join('; '), buyingGroups: (user.buyingGroups || []).join('; '),
    manager: (byId.get(user.managerId) || {}).username || '', dataScope: (user.dataScope && user.dataScope.mode) || '',
    bundles: (user.roleBundleIds || []).map(bundleName).join('; '), updatedAt: user.updatedAt || '',
  }));
  const sheet = (rows, columns) => X.utils.aoa_to_sheet([columns.map(column => T(lang, column.tr, column.en)), ...rows.map(row => columns.map(column => row[column.key]))]);
  X.utils.book_append_sheet(book, sheet(userRows, COLUMNS), T(lang, 'Kullanıcılar', 'Users'));

  const review = users.map(user => {
    const effective = user.effectivePermissions || [];
    const security = [...new Set(effective.filter(item => /^(USER|ROLE|PERMISSION|SYSTEM|SECURITY|AUDIT)\./.test(item.permission)).map(item => item.permission))];
    const temporary = (user.temporaryPermissions || []).filter(grant => !grant.validUntil || Date.parse(grant.validUntil) > Date.now());
    return {
      user: user.displayName || user.username, username: user.username || '', role: roleLabel(user.systemRole, lang), status: statusLabel(user.status, lang),
      manager: (byId.get(user.managerId) || {}).displayName || '', bundles: (user.roleBundleIds || []).map(bundleName).join('; '),
      direct: (user.directPermissions || []).filter(grant => !String(grant.id || '').startsWith('bundle:')).length,
      temporary: temporary.map(grant => `${grant.permission} → ${clean(grant.validUntil).slice(0, 10)}`).join('; '),
      security: security.join('; '), total: new Set(effective.map(item => item.permission)).size, updatedAt: user.updatedAt || '', approve: '', note: '',
    };
  });
  X.utils.book_append_sheet(book, sheet(review, [
    { key: 'user', tr: 'Kullanıcı', en: 'User' }, { key: 'username', tr: 'Kullanıcı adı', en: 'User name' }, { key: 'role', tr: 'Rol', en: 'Role' },
    { key: 'status', tr: 'Durum', en: 'Status' }, { key: 'manager', tr: 'Yönetici', en: 'Manager' }, { key: 'bundles', tr: 'Ek roller', en: 'Extra roles' },
    { key: 'direct', tr: 'Kişiye özel yetki', en: 'Direct permissions' }, { key: 'temporary', tr: 'Süreli yetkiler', en: 'Temporary permissions' },
    { key: 'security', tr: 'Güvenlik yetkileri', en: 'Security permissions' }, { key: 'total', tr: 'Toplam yetki', en: 'Total permissions' },
    { key: 'updatedAt', tr: 'Son güncelleme', en: 'Last updated' }, { key: 'approve', tr: 'Onay (E/H)', en: 'Approved (Y/N)' }, { key: 'note', tr: 'Not', en: 'Note' },
  ]), T(lang, 'Yetki Gözden Geçirme', 'Access Review'));

  const effectiveRows = users.flatMap(user => (user.effectivePermissions || []).map(item => ({
    user: user.displayName || user.username, code: item.permission, permission: permissionText(item.permission), source: sourceLabel(item, lang),
    detail: item.source === 'BUNDLE' ? T(lang, item.sourceLabel, item.sourceLabelEn || item.sourceLabel) : item.source === 'TEMPORARY' ? clean(item.validUntil).slice(0, 10) : clean(item.sourceLabel || item.reason),
  })));
  X.utils.book_append_sheet(book, sheet(effectiveRows, [
    { key: 'user', tr: 'Kullanıcı', en: 'User' }, { key: 'code', tr: 'Yetki kodu', en: 'Permission code' }, { key: 'permission', tr: 'Yetki', en: 'Permission' },
    { key: 'source', tr: 'Kaynak', en: 'Source' }, { key: 'detail', tr: 'Ayrıntı', en: 'Detail' },
  ]), T(lang, 'Etkin Yetkiler', 'Effective Permissions'));

  const roleRows = [
    ...Object.values(roles || {}).flatMap(role => (role.permissions || []).map(code => ({ role: roleLabel(role.id, lang), kind: T(lang, 'Sistem rolü', 'System role'), code, permission: permissionText(code) }))),
    ...(bundles || []).flatMap(bundle => bundle.permissions.map(code => ({ role: T(lang, bundle.nameTr, bundle.nameEn || bundle.nameTr), kind: T(lang, 'Ek rol', 'Extra role'), code, permission: permissionText(code) }))),
  ];
  X.utils.book_append_sheet(book, sheet(roleRows, [
    { key: 'role', tr: 'Rol', en: 'Role' }, { key: 'kind', tr: 'Tür', en: 'Kind' }, { key: 'code', tr: 'Yetki kodu', en: 'Permission code' }, { key: 'permission', tr: 'Yetki', en: 'Permission' },
  ]), T(lang, 'Roller', 'Roles'));
  return X.write(book, { type: 'buffer', bookType: 'xlsx' });
}

function readUserRows(buffer) {
  const X = xlsx();
  let book;
  try { book = X.read(buffer, { type: 'buffer' }); }
  catch (_) { throw Object.assign(new Error('Excel dosyası okunamadı.'), { statusCode: 400, code: 'IAM_IMPORT_UNREADABLE' }); }
  const name = book.SheetNames.find(item => ['kullanıcılar', 'users'].includes(fold(item))) || book.SheetNames[0];
  const matrix = X.utils.sheet_to_json(book.Sheets[name], { header: 1, defval: '', raw: false });
  const header = (matrix[0] || []).map(fold);
  const index = {};
  for (const column of COLUMNS) {
    const at = header.findIndex(cell => cell === fold(column.tr) || cell === fold(column.en));
    if (at >= 0) index[column.key] = at;
  }
  if (index.username == null) throw Object.assign(new Error('"Kullanıcı adı / User name" sütunu bulunamadı. Önce dışa aktarılan dosyayı kullanın.'), { statusCode: 400, code: 'IAM_IMPORT_HEADER' });
  const rows = [];
  for (let i = 1; i < matrix.length; i += 1) {
    const raw = matrix[i] || [];
    if (!raw.some(cell => clean(cell))) continue;
    const row = { line: i + 1 };
    for (const [key, at] of Object.entries(index)) row[key] = clean(raw[at]);
    rows.push(row);
  }
  if (rows.length > MAX_IMPORT_ROWS) throw Object.assign(new Error(`En fazla ${MAX_IMPORT_ROWS} satır içe aktarılabilir.`), { statusCode: 400, code: 'IAM_IMPORT_TOO_LARGE' });
  return rows;
}

/* Satırları mevcut dizine göre plana çevirir. Boş hücre "değiştirme" demektir.
   helpers: { findByUsername(name) → profile|null, usernameKey(name) } */
function planImport(rows, helpers) {
  const plan = [], seen = new Set();
  for (const row of rows) {
    const errors = [], key = helpers.usernameKey(row.username);
    // Kullanıcı adı olmayan satır (ör. dışa aktarılan ASAS kaynak kaydı) giriş
    // yapamaz ve eşleştirilemez: hata değil, atlanır. Aynı dosyayı geri yüklemek
    // böylece yüzlerce kaynak kaydı yüzünden reddedilmez.
    if (!key) { plan.push({ line: row.line, username: '', action: 'skipped' }); continue; }
    if (seen.has(key)) { plan.push({ line: row.line, username: row.username, action: 'error', errors: ['USERNAME_DUPLICATE'] }); continue; }
    seen.add(key);
    const existing = helpers.findByUsername(row.username);
    const patch = {};
    const set = (field, value, current) => { if (JSON.stringify(value) !== JSON.stringify(current)) patch[field] = value; };
    if (row.displayName) set('displayName', row.displayName, existing && existing.displayName);
    if (row.title) set('title', row.title, existing && existing.title);
    if (row.email) set('email', row.email.toLocaleLowerCase('tr-TR'), existing && clean(existing.email));
    if (row.role) {
      const role = lookup(ROLE_NAMES, row.role);
      if (!role) errors.push('ROLE_UNKNOWN');
      else if (role === 'moderator' && (!existing || existing.systemRole !== 'moderator')) errors.push('ROLE_MODERATOR_NOT_IMPORTABLE');
      else if (existing && existing.systemRole === 'moderator' && role !== 'moderator') errors.push('ROLE_MODERATOR_NOT_IMPORTABLE');
      else set('systemRole', role, existing && existing.systemRole);
    }
    if (row.status) {
      const status = lookup(STATUS_NAMES, row.status);
      if (!status) errors.push('STATUS_UNKNOWN'); else set('status', status, existing && existing.status);
    }
    for (const field of ['mags', 'mmygs', 'buyingGroups']) if (row[field]) set(field, splitList(row[field]), existing && (existing[field] || []));
    if (row.manager) {
      const manager = helpers.findByUsername(row.manager);
      if (!manager) errors.push('MANAGER_UNKNOWN'); else set('managerId', manager.id, existing && (existing.managerId || null));
    }
    if (row.dataScope) {
      const mode = lookup(SCOPE_NAMES, row.dataScope);
      if (!mode) errors.push('DATA_SCOPE_UNKNOWN'); else if (!existing || !existing.dataScope || existing.dataScope.mode !== mode) patch.dataScope = { mode };
    }
    if (!existing) {
      if (!row.title) errors.push('TITLE_REQUIRED');
      if (!patch.managerId) errors.push('MANAGER_REQUIRED');
    }
    if (errors.length) { plan.push({ line: row.line, username: row.username, action: 'error', errors }); continue; }
    if (existing && !Object.keys(patch).length) { plan.push({ line: row.line, username: row.username, userId: existing.id, action: 'unchanged' }); continue; }
    plan.push({ line: row.line, username: row.username, userId: existing ? existing.id : null, action: existing ? 'update' : 'create', patch });
  }
  return plan;
}

module.exports = { COLUMNS, MAX_IMPORT_ROWS, buildWorkbook, readUserRows, planImport };
