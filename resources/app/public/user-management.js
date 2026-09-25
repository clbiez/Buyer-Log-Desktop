/* Buyer Log v7.02 — Kullanıcı & Yetki Yönetimi (User & Authorization Management)
 * ---------------------------------------------------------------------------
 * Bu dosya, eski yönetim arayüzünün yerine sıfırdan yazılmış tek merkezli
 * çalışma alanıdır. Beş bölüm vardır: Kullanıcılar · Roller & Yetkiler ·
 * Organizasyon · Profil Kopyalama · Değişiklik Geçmişi.
 *
 * Üç tasarım kararı bütün dosyayı belirliyor:
 *
 * 1) TEK MERKEZİ DEPO. Kullanıcı listesi, detay paneli, organizasyon ağacı ve
 *    yetki ekranları aynı `store` üzerinden çizilir. Sunucuya yazan her işlem
 *    bitince depo tek bir GET ile tazelenir, böylece bir ekranda yapılan
 *    değişiklik diğerlerinde anında görünür ve sayfa yenilemesi gerekmez.
 *
 * 2) OLAY DELEGASYONU. Bütün tıklama/değişiklik olayları kabuğun kökünde tek
 *    dinleyiciyle, `data-act` niteliği üzerinden yakalanır. Böylece bir bölüm
 *    yeniden çizildiğinde düğmeler dinleyicisiz kalmaz — eski arayüzdeki
 *    "butona basıyorum bir şey olmuyor" hatasının kök nedeni buydu.
 *
 * 3) TEKNİK TERİM YOK. Ana ekranlarda SELF/TEAM/MAG gibi ifadeler yerine
 *    "Kendi Kayıtları / Ekibi / MAG" gibi karşılıklar gösterilir; izin kodları
 *    yalnız ipucu (tooltip) içinde yer alır.
 */
(() => {
  'use strict';

  /* ===================== 0 · Yardımcılar ===================== */

  const T = (tr, en) => (typeof appLang !== 'undefined' && appLang === 'en') ? en : tr;
  const esc = value => String(value == null ? '' : value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
  const clean = value => String(value == null ? '' : value).trim();
  const norm = value => clean(value).toLocaleLowerCase('tr-TR');
  const list = values => Array.isArray(values) ? values.filter(Boolean) : [];
  const joinText = values => list(values).join(', ');
  const dash = value => clean(value) || '—';
  const initials = name => clean(name).split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]).join('').toLocaleUpperCase('tr-TR') || '?';
  const sortTr = (a, b) => String(a).localeCompare(String(b), 'tr', { sensitivity: 'base' });
  const toast = message => { try { if (typeof showToast === 'function') return showToast(message); } catch (_) {} console.log('[Buyer Log]', message); };

  function formatDateTime(value) {
    const time = Date.parse(value || '');
    if (!Number.isFinite(time)) return '—';
    const date = new Date(time), pad = number => String(number).padStart(2, '0');
    return `${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${date.getFullYear()} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }

  /* ===================== 1 · Sözlükler ===================== */

  const ROLE_ORDER = ['buyer', 'manager', 'senior_manager', 'moderator'];
  const roleLabel = id => ({ buyer: 'Buyer', manager: 'Manager', senior_manager: 'Senior Manager', moderator: T('Moderatör', 'Moderator') })[id] || id || '—';
  // Organizasyon seviyesi arayüzde sorulmaz; sistem rolünden türetilir. Seviye
  // sıralaması sunucudaki hiyerarşi doğrulamasının kullandığı kuraldır.
  const ROLE_ORG_LEVEL = { buyer: 'job_title', manager: 'mmyg', senior_manager: 'mag', moderator: 'manager' };
  const ORG_LEVEL_RANK = { job_title: 1, mmyg: 2, mag: 3, manager: 4 };

  const statusLabel = status => ({ ACTIVE: T('Aktif', 'Active'), INACTIVE: T('İnaktif', 'Inactive'), SUSPENDED: T('Askıda', 'Suspended') })[status] || status || '—';
  const scopeLabel = mode => ({
    SELF: T('Kendi Kayıtları', 'Own Records'), TEAM: T('Ekibi', 'Their Team'),
    MMYG: 'MMYG', MAG: 'MAG', ALL: T('Tüm Veriler', 'All Data'), CUSTOM: T('Özel', 'Custom'),
  })[mode] || T('Kendi Kayıtları', 'Own Records');
  const SCOPE_ORDER = ['SELF', 'TEAM', 'MMYG', 'MAG', 'ALL', 'CUSTOM'];

  const actionLabel = action => ({
    VIEW: T('Görüntüle', 'View'), CREATE: T('Oluştur', 'Create'), EDIT: T('Düzenle', 'Edit'),
    DELETE: T('Sil', 'Delete'), APPROVE: T('Onayla', 'Approve'), EXPORT: T('Dışa Aktar', 'Export'),
    MANAGE: T('Yönet', 'Manage'), GRANT: T('Yetki Ver', 'Grant'), PROFILE_COPY: T('Profil Kopyala', 'Copy Profile'),
    SEARCH: T('Ara', 'Search'),
  })[action] || action;
  const actionHint = action => ({
    VIEW: T('Kullanıcı bu modüldeki kayıtları görebilir.', 'The user can see records in this module.'),
    CREATE: T('Kullanıcı bu modülde yeni kayıt oluşturabilir.', 'The user can create new records in this module.'),
    EDIT: T('Kullanıcı bu modüldeki mevcut kayıtları değiştirebilir.', 'The user can change existing records in this module.'),
    DELETE: T('Kullanıcı kayıt silme işlemi yapabilir.', 'The user can delete records.'),
    APPROVE: T('Kullanıcı bu modüldeki kayıtları onaylayabilir.', 'The user can approve records in this module.'),
    EXPORT: T('Kullanıcı veriyi Excel veya diğer dış formatlara aktarabilir.', 'The user can export data to Excel or other external formats.'),
    MANAGE: T('Kullanıcı bu modülün ayarlarını ve tüm kayıtlarını yönetebilir.', 'The user can manage this module’s settings and all of its records.'),
    GRANT: T('Kullanıcı başka kullanıcılara bu alanda yetki verebilir.', 'The user can grant others permission in this area.'),
    PROFILE_COPY: T('Kullanıcı seçilen yetki ve çalışma alanı snapshot’ını başka kullanıcılara kopyalayabilir.', 'The user can copy a selected permission and workspace snapshot to other users.'),
    SEARCH: T('Kullanıcı kendi bağlı hesabında siparişle ilgili arama yapabilir.', 'The user can search order-related content in their own connected account.'),
  })[action] || '';
  const ACTION_ORDER = ['VIEW', 'CREATE', 'EDIT', 'DELETE', 'APPROVE', 'EXPORT', 'MANAGE', 'GRANT', 'PROFILE_COPY', 'SEARCH'];

  // Modül kategorileri — uzun tek tablo yerine katlanabilir gruplar (§41).
  const CATEGORIES = [
    { id: 'planning', tr: 'Planlama', en: 'Planning', resources: ['OVERVIEW', 'CP', 'OAB'] },
    { id: 'orders', tr: 'Sipariş', en: 'Orders', resources: ['ORDERS', 'BACKLOG'] },
    { id: 'product', tr: 'Ürün', en: 'Product', resources: ['COLLECTIONS', 'QUOTATIONS'] },
    { id: 'cost', tr: 'Maliyet & Lojistik', en: 'Cost & Logistics', resources: ['OPEN_COSTING', 'SHIPPING'] },
    { id: 'reporting', tr: 'Raporlama', en: 'Reporting', resources: ['ANALYSIS'] },
    { id: 'automation', tr: 'Otomasyon', en: 'Automation', resources: ['AUTOMATIONS', 'AGENTS'] },
    { id: 'integrations', tr: 'Entegrasyonlar', en: 'Integrations', resources: ['OUTLOOK'] },
    { id: 'admin', tr: 'Yönetim', en: 'Administration', resources: ['SOURCE_DATA', 'USER', 'ROLE', 'PERMISSION', 'SYSTEM', 'SECURITY', 'AUDIT'] },
  ];

  const SECTIONS = [
    { id: 'users', tr: 'Kullanıcılar', en: 'Users', icon: 'users-group' },
    { id: 'roles', tr: 'Roller & Yetkiler', en: 'Roles & Permissions', icon: 'rosette-discount-check' },
    { id: 'templates', tr: 'Workspace Şablonları', en: 'Workspace Templates', icon: 'layout-dashboard' },
    { id: 'organization', tr: 'Organizasyon', en: 'Organization', icon: 'hierarchy' },
    { id: 'copy', tr: 'Profil Kopyalama', en: 'Copy User Profile', icon: 'copy' },
    { id: 'history', tr: 'Değişiklik Geçmişi', en: 'Change History', icon: 'bl-history' },
  ];

  /* ===================== 2 · Merkezi depo ===================== */

  const store = {
    status: 'idle',            // idle | loading | ready | error
    error: null,
    revision: 0,
    centralIam: { enabled: false },
    actor: null,
    users: [],
    permissionRegistry: [],
    resources: {},
    roleDefinitions: {},
    workspaceTemplates: {},
    roleDraft: {},
    roleDirty: false,
    directory: [],
    magMmyg: {},
    catalogs: {},
    audit: [],
    authMode: 'local',
    passwordMinLength: 6,
    section: 'users',
    statusFilter: 'all',
    search: '',
    filters: { role: '', mag: '', mmyg: '', buyingGroup: '', managerId: '' },
    filtersOpen: false,
    selectedIds: new Set(),
    detailId: null,
    detailTab: 'summary',       // summary | edit | permissions
    orgSelectedId: null,
    roleTab: 'buyer',
    permissionSearch: '',
    collapsedCategories: new Set(),
    template: { roleId: 'buyer', sourceId: '', search: '', categories: { horizon: true, filters: true, columns: true, views: true, dashboard: true, favorites: true } },
    copy: { sourceType: 'user', sourceId: '', templateRole: 'buyer', targetIds: new Set(), mode: 'MERGE', categories: { userPermissions: true, workspace: { horizon: true, filters: true, columns: true, views: true, dashboard: true, favorites: true }, organization: { role: false, mag: false, mmyg: false, buyingGroup: false, manager: false, dataScope: false } } },
    copySearch: '', copySourceSearch: '', canCopyProfiles: false,
    historyQuery: '',

    modelConnections: { items: [], loaded: false },
    horizonModule: 'cp',
    horizonConnectionId: '',
  };

  const userById = id => store.users.find(item => item.id === clean(id)) || null;
  const userName = user => user ? clean(user.displayName || user.username) : '';
  const nameOf = id => userName(userById(id)) || '';

  // Yönetici seçicilerinde tek biçim: Ad — Rol — MAG / MMYG (boş alanlar yazılmaz).
  function managerOptionLabel(user) {
    const scope = [joinText(user.mags), joinText(user.mmygs)].filter(Boolean).join(' / ');
    return [userName(user), roleLabel(user.systemRole), scope].filter(Boolean).join(' — ');
  }
  function childrenOf(id) { return store.users.filter(item => clean(item.managerId) === clean(id)); }
  function descendantIds(id) {
    const found = new Set(), queue = [clean(id)];
    while (queue.length) {
      for (const child of childrenOf(queue.shift())) if (!found.has(child.id)) { found.add(child.id); queue.push(child.id); }
    }
    return found;
  }

  /* ===================== 3 · Sunucu iletişimi ===================== */

  async function api(url, options) {
    const response = await fetch(url, Object.assign({ credentials: 'same-origin' }, options));
    let data = {};
    try { data = await response.json(); } catch (_) { data = {}; }
    if (!response.ok) {
      const error = new Error(data.error || response.statusText || T('İstek tamamlanamadı.', 'The request could not be completed.'));
      Object.assign(error, data);
      throw error;
    }
    return data;
  }
  const send = (url, method, body) => {
    if (store.centralIam.enabled && store.centralIam.status !== 'synced' && url !== '/api/iam/initialize') return Promise.reject(new Error(T('Kullanıcı dizini salt okunur. Önce dizini yenileyin.', 'The user directory is read-only. Refresh it first.')));
    return api(url, {
    method, headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(Object.assign({ expectedRevision: store.revision }, body || {})),
    }).catch(error => {
      if (error.code === 'IAM_REVISION_CONFLICT') { store.centralIam.status = 'conflict'; error.message = T('Daha yeni kullanıcı dizini bulundu. Kaydetmeden önce dizini yeniden yükleyin.', 'A newer user directory was detected. Reload before saving.'); }
      if (error.code === 'IAM_OFFLINE') store.centralIam.status = 'offline';
      throw error;
    });
  };

  function absorb(model) {
    store.revision = Number(model.revision) || 0;
    store.centralIam = model.centralIam || { enabled: false };
    store.actor = model.actor || null;
    store.users = (model.profiles || []).slice().sort((a, b) => sortTr(userName(a), userName(b)));
    store.permissionRegistry = model.permissionRegistry || [];
    store.resources = model.resources || {};
    store.roleDefinitions = model.roleDefinitions || {};
    store.workspaceTemplates = model.workspaceTemplates || {};
    store.directory = model.directory || [];
    store.magMmyg = model.magMmyg || {};
    store.buyingGroupCatalog = model.buyingGroupCatalog || { byMagMmyg: {}, all: [] };
    store.catalogs = model.catalogs || {};
    store.audit = model.audit || [];
    store.authMode = model.authMode || 'local';
    store.passwordMinLength = Number(model.passwordMinLength) || 6;
    store.canCopyProfiles = Boolean(model.canCopyProfiles);
    /* v7.38 — Seçenekleri ASAS'tan okumak veri modeli bağlantısı yetkisi ister
       (sunucu da aynı yetkiyi arar, §32). Yetkisi olmayana düğme gösterip 403
       aldırmak, ne yapması gerektiğini söylemezdi. */
    store.canRefreshCatalog = typeof window.BLHasPermission === 'function'
      ? window.BLHasPermission('manageModelConnections')
      : Boolean(model.actor && model.actor.permissions && model.actor.permissions.manageModelConnections);
    if (!store.roleDirty) store.roleDraft = JSON.parse(JSON.stringify(store.roleDefinitions));
    for (const id of [...store.selectedIds]) if (!userById(id)) store.selectedIds.delete(id);
    if (store.detailId && !userById(store.detailId)) store.detailId = null;
    if (store.orgSelectedId && !userById(store.orgSelectedId)) store.orgSelectedId = null;
    if (!store.copy.sourceId || !userById(store.copy.sourceId)) store.copy.sourceId = store.detailId || '';
    if (!store.template.sourceId || !userById(store.template.sourceId)) store.template.sourceId = store.detailId || (store.users[0] && store.users[0].id) || '';
    for (const id of [...store.copy.targetIds]) if (!userById(id)) store.copy.targetIds.delete(id);
  }

  async function reload({ silent = false } = {}) {
    if (!silent) { store.status = 'loading'; store.error = null; render(); }
    try {
      absorb(await api('/api/users/admin'));
      store.status = 'ready'; store.error = null;
    } catch (error) {
      store.status = 'error'; store.error = error.message;
    }
    render();
  }

  /* v7.38 — SEÇENEKLERİ DOĞRUDAN ASAS'TAN TAZELE.

     Kullanıcının bildirdiği kusurun kaynağı, kataloğun yalnız OKUNMUŞ (kaynak
     filtresinden geçmiş) sipariş satırlarından kurulmasıydı. Bu düğme, tekil
     değerleri veri modelinden doğrudan okutur.

     SONUÇ ALAN BAŞINA YAZILIR. "Tazelendi" demek, bir alanın hiç okunamadığını
     gizlemek olurdu; kullanıcı yine boş liste görür ve sebebini bilemezdi. */
  async function refreshScopeCatalog(trigger) {
    if (trigger) trigger.disabled = true;
    store.catalogStatus = T('ASAS’tan okunuyor…', 'Reading from ASAS…');
    render();
    try {
      const result = await api('/api/user-scope-catalog/refresh', { method: 'POST', body: JSON.stringify({}) });
      const parts = (result.fields || []).map(field => field.error
        ? T(`${field.label}: okunamadı — ${field.error}`, `${field.label}: could not be read — ${field.error}`)
        : T(`${field.label}: ${field.count} değer`, `${field.label}: ${field.count} values`));
      const totals = result.totals || {};
      store.catalogStatus = `${parts.join(' · ')}${parts.length ? ' · ' : ''}${T(
        `listede toplam ${totals.mags || 0} MAG, ${totals.mmygs || 0} MMYG, ${totals.buyingGroups || 0} Buying Group`,
        `${totals.mags || 0} MAGs, ${totals.mmygs || 0} MMYGs, ${totals.buyingGroups || 0} Buying Groups in the list`)}`;
      await reload({ silent: true });
    } catch (error) {
      store.catalogStatus = T(`Tazelenemedi: ${error.message}`, `Could not refresh: ${error.message}`);
      render();
    } finally {
      if (trigger) trigger.disabled = false;
    }
  }

  /* ===================== 4 · Kabuk ===================== */

  let shell = null, overlay = null;

  function open() {
    if (overlay) return;
    overlay = document.createElement('div');
    overlay.className = 'umOverlay';
    overlay.innerHTML = `
      <div class="umShell" role="dialog" aria-modal="true" aria-label="${esc(T('Kullanıcı ve Yetki Yönetimi', 'User and Authorization Management'))}">
        <header class="umTop">
          <div class="umTopText">
            <h2>${esc(T('Kullanıcı & Yetki Yönetimi', 'User & Authorization Management'))}</h2>
            <p>${esc(T('Kişiyi bul, rolünü belirle, yöneticisini ata, yetkisini düzenle.', 'Find the person, set the role, assign the manager, adjust the permissions.'))}</p>
          </div>
          <button type="button" class="umTopClose" data-act="close" aria-label="${esc(T('Kapat', 'Close'))}">×</button>
        </header>
        <div class="umBody">
          <nav class="umNav" data-um-nav></nav>
          <main class="umMain" data-um-main></main>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    shell = overlay.querySelector('.umShell');
    shell.addEventListener('click', onClick);
    shell.addEventListener('input', onInput);
    shell.addEventListener('change', onChange);
    shell.addEventListener('submit', onSubmit);
    shell.addEventListener('keydown', onKeyDown);
    overlay.addEventListener('mousedown', event => { if (event.target === overlay) close(); });
    render();
    reload();
  }

  function close() {
    if (!overlay) return;
    if (store.roleDirty && !confirm(T('Rol yetkilerinde kaydedilmemiş değişiklikler var. Kapatılsın mı?', 'Role permissions have unsaved changes. Close anyway?'))) return;
    closeDialog();
    overlay.remove(); overlay = null; shell = null;
    store.roleDirty = false;
  }

  /* ===================== 5 · Çizim ===================== */

  function render() {
    if (!shell) return;
    shell.querySelector('[data-um-nav]').innerHTML = navHtml();
    const main = shell.querySelector('[data-um-main]');
    if (store.status === 'loading') { main.innerHTML = loadingState(); return; }
    if (store.status === 'error') { main.innerHTML = errorState(store.error); return; }
    if (store.status !== 'ready') { main.innerHTML = loadingState(); return; }
    main.innerHTML = centralStatusHtml() + `<fieldset class="umIamFields" ${store.centralIam.enabled && store.centralIam.status !== 'synced' ? 'disabled' : ''}>` + ({
      users: usersSection, roles: rolesSection, templates: templatesSection, organization: organizationSection,
      copy: copySection, history: historySection,
    })[store.section]() + '</fieldset>';
    restoreFocus();
  }
  function centralStatusHtml() {
    const h = store.centralIam;
    if (!h.enabled) return '';
    const label = h.status === 'synced' ? T('Senkronize', 'Synced') : h.status === 'conflict'
      ? T('Dizin değişti; yeniden yükleyin', 'Directory changed; reload') : h.status === 'uninitialized'
      ? T('Merkezi dizin başlatılmadı', 'Central directory not initialized') : T('Salt okunur / çevrimdışı', 'Read-only / offline');
    return `<div class="umToolbar" data-um-iam-status role="status"><span class="umNote">${esc(T('Merkezi Kullanıcı Yönetimi', 'Central User Management'))} · ${esc(T('Revizyon', 'Revision'))} ${Number(h.localRevision) || 0} · ${esc(label)} · ${esc(formatDateTime(h.lastSyncAt))}</span>
      <button class="umBtn umBtnSmall" data-act="iamRefresh">${esc(T('Kullanıcı Dizinini Yenile', 'Refresh User Directory'))}</button>
      ${h.status === 'uninitialized' && store.actor && store.actor.systemRole === 'moderator' ? `<button class="umBtn umBtnPrimary" data-act="iamInitialize">${esc(T('Merkezi Geçişi Doğrula', 'Validate Central Migration'))}</button>` : ''}</div>`;
  }
  async function refreshDirectory() {
    if (!confirm(T('Dizin yeniden yüklenecek. Açık form ve rol taslaklarındaki kaydedilmemiş değişiklikler bırakılsın mı?', 'Reload the directory and discard unsaved form and role drafts?'))) return;
    try { await api('/api/iam/refresh', { method: 'POST' }); closeDialog(); store.roleDirty = false; await reload(); }
    catch (error) { toast(error.message); }
  }
  async function initializeDirectory() {
    try {
      const result = await api('/api/iam/migration/dry-run');
      openDialog(T('Merkezi Kullanıcı Dizinini Başlat', 'Initialize Central User Directory'),
        `<p class="umConfirmText">${esc(T('Doğrulanan mevcut kayıtlar', 'Verified existing records'))}: ${result.users} ${esc(T('kullanıcı', 'users'))} · ${result.roles} ${esc(T('rol', 'roles'))} · ${result.enabled} ${esc(T('aktif', 'enabled'))} · ${result.admins} ${esc(T('yönetici', 'admins'))}</p>`,
        { confirmLabel: T('Revizyon 1 Olarak Başlat', 'Initialize Revision 1'), onSubmit: async () => {
          await send('/api/iam/initialize', 'POST', { expectedRevision: result.revision, confirmCritical: true }); closeDialog(); await reload();
        } });
    } catch (error) { toast(error.message); }
  }

  function navHtml() {
    const counts = statusCounts();
    return SECTIONS.filter(section => section.id !== 'copy' || store.canCopyProfiles).map(section => `
      <button type="button" class="umNavItem${store.section === section.id ? ' isActive' : ''}" data-act="section" data-id="${section.id}">
        <span class="umNavIcon" aria-hidden="true"><svg class="ic"><use href="#i-${esc(section.icon)}"/></svg></span>
        <span class="umNavLabel">${esc(T(section.tr, section.en))}</span>
        ${section.id === 'users' && store.status === 'ready' ? `<span class="umNavCount">${counts.all}</span>` : ''}
      </button>`).join('');
  }

  function loadingState() {
    return `<div class="umState"><div class="umSpinner" aria-hidden="true"></div><p>${esc(T('Kullanıcılar yükleniyor…', 'Loading users…'))}</p></div>`;
  }
  function errorState(message) {
    return `<div class="umState umStateError">
      <h3>${esc(T('Kullanıcılar yüklenemedi.', 'Users could not be loaded.'))}</h3>
      <p>${esc(message || '')}</p>
      <button type="button" class="umBtn umBtnPrimary" data-act="retry">${esc(T('Tekrar Dene', 'Try Again'))}</button>
    </div>`;
  }
  function emptyState(title, note, action) {
    return `<div class="umEmpty">
      <p class="umEmptyTitle">${esc(title)}</p>
      ${note ? `<p class="umEmptyNote">${esc(note)}</p>` : ''}
      ${action ? `<button type="button" class="umBtn umBtnPrimary" data-act="${esc(action.act)}">${esc(action.label)}</button>` : ''}
    </div>`;
  }

  /* ===================== 6 · Kullanıcılar ===================== */

  function statusCounts() {
    const all = store.users.length;
    const active = store.users.filter(item => item.status === 'ACTIVE').length;
    return { all, active, inactive: all - active };
  }

  function visibleUsers() {
    const query = norm(store.search);
    return store.users.filter(user => {
      if (store.statusFilter === 'active' && user.status !== 'ACTIVE') return false;
      if (store.statusFilter === 'inactive' && user.status === 'ACTIVE') return false;
      if (store.filters.role && user.systemRole !== store.filters.role) return false;
      if (store.filters.mag && !list(user.mags).some(value => norm(value) === norm(store.filters.mag))) return false;
      if (store.filters.mmyg && !list(user.mmygs).some(value => norm(value) === norm(store.filters.mmyg))) return false;
      if (store.filters.buyingGroup && !list(user.buyingGroups).some(value => norm(value) === norm(store.filters.buyingGroup))) return false;
      if (store.filters.managerId && clean(user.managerId) !== store.filters.managerId) return false;
      if (!query) return true;
      const haystack = [userName(user), user.username, user.email, roleLabel(user.systemRole), joinText(user.mags), joinText(user.mmygs), nameOf(user.managerId)].map(norm).join(' ');
      return haystack.includes(query);
    });
  }

  function usersSection() {
    const counts = statusCounts();
    const rows = visibleUsers();
    const activeFilterCount = Object.values(store.filters).filter(Boolean).length;
    return `
    <section class="umSection umUsers">
      <div class="umToolbar">
        <div class="umSearchWrap">
          <input type="search" class="umSearch" data-um-search value="${esc(store.search)}" placeholder="${esc(T('Kullanıcı ara…', 'Search users…'))}" aria-label="${esc(T('Kullanıcı Ara', 'Search Users'))}">
        </div>
        <button type="button" class="umBtn${activeFilterCount ? ' isOn' : ''}" data-act="toggleFilters">
          ${esc(T('Filtreler', 'Filters'))}${activeFilterCount ? ` · ${activeFilterCount}` : ''}
        </button>
        ${/* v7.40 — Bu düğme v7.39'da FİLTRE panelinin içindeydi; panel varsayılan
              olarak KAPALI olduğu için kullanıcı düğmeyi bulamadı. Artık her
              zaman görünen araç çubuğunda, arama kutusunun yanında. */ ''}
        ${store.canRefreshCatalog === false ? '' : `<button type="button" class="umBtn" data-act="refreshScopeCatalog" title="${esc(T(
          'MAG, MMYG ve Buying Group seçeneklerini ASAS veri modelinden doğrudan okur. Bu okuma kaynak filtresine/ufka tabi değildir.',
          'Reads the MAG, MMYG and Buying Group options straight from the ASAS data model. This read is not subject to the source filter or horizon.',
        ))}"><svg class="ic"><use href="#i-refresh"/></svg>${esc(T('Seçenekleri ASAS’tan Tazele', 'Refresh options from ASAS'))}</button>`}
        ${store.actor && store.actor.canManageUsers ? `<button type="button" class="umBtn umBtnPrimary" data-act="newUser">＋ ${esc(T('Yeni Kullanıcı', 'New User'))}</button>` : ''}
      </div>
      ${store.catalogStatus ? `<p class="umNote umCatalogStatus">${esc(store.catalogStatus)}</p>` : ''}
      <div class="umStatusTabs" data-bl-choicebar role="group" aria-label="${esc(T('Kullanıcı durumu filtresi', 'User status filter'))}">
        ${statusTab('all', T('Tümü', 'All'), counts.all)}
        ${statusTab('active', T('Aktif', 'Active'), counts.active)}
        ${statusTab('inactive', T('İnaktif', 'Inactive'), counts.inactive)}
      </div>
      ${store.filtersOpen ? filtersPanel() : ''}
      ${store.selectedIds.size ? bulkBar() : ''}
      <div class="umUsersBody">
        <div class="umTableWrap">${usersTable(rows)}</div>
        ${store.detailId ? detailDrawer(userById(store.detailId)) : ''}
      </div>
    </section>`;
  }

  function statusTab(id, label, count) {
    return `<button type="button" aria-pressed="${store.statusFilter === id}" class="umStatusTab${store.statusFilter === id ? ' isActive' : ''}" data-act="statusFilter" data-id="${id}">
      <span>${esc(label)}</span><b>${count}</b></button>`;
  }

  function selectHtml(name, options, selected, placeholder) {
    const items = options.map(option => {
      const value = typeof option === 'string' ? option : option.value;
      const label = typeof option === 'string' ? option : option.label;
      return `<option value="${esc(value)}"${clean(value) === clean(selected) ? ' selected' : ''}>${esc(label)}</option>`;
    }).join('');
    return `<select ${name}>${placeholder != null ? `<option value="">${esc(placeholder)}</option>` : ''}${items}</select>`;
  }

  /* v7.25 — MAG / MMYG artık serbest metin de kabul eder.

     Kullanıcı bulgusu: "kullanıcı ayarlarında ASAS'daki tüm buying group'lar,
     MAG'lar ve MMYG'ler görünmüyor." Asıl düzeltme sunucudaki birikimli
     katalogtur; bu ise emniyet supabıdır: listede olmayan bir değer yine de
     yazılabilir, kimse eksik katalog yüzünden tıkanmaz. Yazılan değer
     kullanıcı kartında olduğu gibi saklanır. */
  function comboHtml(attrs, options, selected, listId, placeholder) {
    const items = options.map(option => {
      const value = typeof option === 'string' ? option : option.value;
      return `<option value="${esc(value)}"></option>`;
    }).join('');
    return `<input type="text" ${attrs} list="${esc(listId)}" value="${esc(selected || '')}" placeholder="${esc(placeholder || '')}" autocomplete="off">
      <datalist id="${esc(listId)}">${items}</datalist>`;
  }

  /* ===================================================================
     v7.37 — MAG / MMYG / BUYING GROUP: ÇOKTAN SEÇMELİ, VERİ TABANINDAN

     Kullanıcı talebi (birebir): "Kullanıcı ayarlarında Buying Group, ASAS'daki
     Buyer Grup'dan beslensin, MAG Merch Marka Alt Grup'dan, MMYG Merch Marka
     Yaş Grup'dan beslensin. Giriş yaparken database'deki seçenekleri sunsun.
     Çoktan seçmeli olsun ve istenildiği kadar alan kullanıcıya atanabilsin.
     Manuel el ile girişe de açık olsun bu alanlar."

     Üç alan da AYNI denetimi kullanır: seçilenler çip olarak durur, listeden
     seçilir ya da elle yazılır, sayı sınırı yoktur.

     BİÇİM SEÇİMİ: her çip GİZLİ BİR FORM ALANIDIR (name="mag" gibi). Böylece
     kaydetme yolu değişmez — FormData.getAll aynı adı taşıyan tüm değerleri
     zaten döndürür. Ayrı bir durum nesnesi tutmak, formla senkron kalmayan
     ikinci bir gerçek kaynağı demekti.

     KAYITLI DEĞER DÜŞMEZ: katalogda olmayan bir değer (elle yazılmış ya da
     ASAS'tan artık gelmeyen) çip olarak durmaya devam eder; liste tazelenince
     sessizce silinmez (§142). */
  function chipRowHtml(name, value) {
    return `<span class="umChip" data-um-chip="${esc(value)}">
      <input type="hidden" name="${esc(name)}" value="${esc(value)}">
      <span class="umChipText">${esc(value)}</span>
      <button type="button" class="umChipX" data-act="chipRemove" title="${esc(T('Kaldır', 'Remove'))}" aria-label="${esc(T('Kaldır', 'Remove'))}">✕</button>
    </span>`;
  }
  /* v7.38 — LİSTE HİÇBİR ŞEYİ GİZLEMEZ.

     Kullanıcı bulgusu: "Buyer Grup'larda da bir kısmı geliyor." Sebep, listenin
     seçili MAG/MMYG ile SINIRLANMASIYDI; o kapsamda görünmeyen bir grup hiç
     seçilemiyordu. Artık kataloğun TAMAMI listelenir, ilgili değerler yalnız
     ÜSTTE gruplanır. Böylece hem sık kullanılan değer elde kalır hem de hiçbir
     değer erişilemez olmaz. */
  function chipOptionsHtml(related, all, chosen) {
    const taken = value => chosen.some(item => norm(item) === norm(value));
    const top = list(related).filter(item => !taken(item));
    const rest = list(all).filter(item => !taken(item) && !top.some(value => norm(value) === norm(item)));
    const option = item => `<option value="${esc(item)}">${esc(item)}</option>`;
    if (!top.length && !rest.length) return '';
    if (!top.length || !rest.length) return [...top, ...rest].map(option).join('');
    return `<optgroup label="${esc(T('Seçili MAG / MMYG kapsamında', 'Within the selected MAG / MMYG'))}">${top.map(option).join('')}</optgroup>`
      + `<optgroup label="${esc(T('ASAS’taki diğer değerler', 'Other values in ASAS'))}">${rest.map(option).join('')}</optgroup>`;
  }
  function chipFieldHtml(options) {
    const name = options.name;
    const values = list(options.values);
    const body = chipOptionsHtml(options.options, options.allOptions || options.options, values);
    return `<fieldset class="umChipField" data-um-chipfield="${esc(name)}"${options.tag ? ` data-um-chiptag="${esc(options.tag)}"` : ''}>
      <legend>${esc(options.label)}</legend>
      ${options.note ? `<p class="umNote">${esc(options.note)}</p>` : ''}
      <div class="umChipList" data-um-chiplist>${values.map(value => chipRowHtml(name, value)).join('')
        || `<span class="umChipEmpty">${esc(T('Seçilmedi', 'Not set'))}</span>`}</div>
      <div class="umChipAdd">
        <select data-um-chippick aria-label="${esc(T('Listeden seç', 'Pick from the list'))}">
          <option value="">${esc(body
            ? T('Veri tabanından seç…', 'Pick from the database…')
            : T('Veri tabanında seçenek yok — “ASAS’tan Tazele” ile okuyun', 'No database option — read them with “Refresh from ASAS”'))}</option>
          ${body}
        </select>
        <input type="text" data-um-chipnew placeholder="${esc(T('Listede yok — elle yaz', 'Not listed — type manually'))}" autocomplete="off">
        <button type="button" class="umBtn umBtnSmall" data-act="chipAdd">${esc(T('Ekle', 'Add'))}</button>
      </div>
    </fieldset>`;
  }
  // Bir alanın o an seçili değerleri (formdaki gizli alanlardan okunur).
  function chipValues(field) {
    if (!field) return [];
    return [...field.querySelectorAll('input[type="hidden"]')].map(input => clean(input.value)).filter(Boolean);
  }
  function chipFieldOf(root, name) {
    return root ? root.querySelector(`[data-um-chipfield="${name}"]`) : null;
  }
  /* Seçim listesi tazelenir; SEÇİLİ değerler listeden çıkarılır (iki kez
     görünmesin) ama çipleri korunur. */
  function refreshChipChoices(field, related, all) {
    if (!field) return;
    const picker = field.querySelector('[data-um-chippick]');
    if (!picker) return;
    const body = chipOptionsHtml(related, all || related, chipValues(field));
    picker.innerHTML = `<option value="">${esc(body
      ? T('Veri tabanından seç…', 'Pick from the database…')
      : T('Veri tabanında seçenek yok — “ASAS’tan Tazele” ile okuyun', 'No database option — read them with “Refresh from ASAS”'))}</option>` + body;
  }
  function chipAdd(field, value) {
    const text = clean(value);
    if (!field || !text) return false;
    if (chipValues(field).some(item => norm(item) === norm(text))) return false; // aynı değer iki kez eklenmez
    const holder = field.querySelector('[data-um-chiplist]');
    if (!holder) return false;
    holder.querySelector('.umChipEmpty')?.remove();
    const name = field.dataset.umChipfield;
    holder.insertAdjacentHTML('beforeend', chipRowHtml(name, text));
    return true;
  }

  function allMags() {
    const values = new Set(Object.keys(store.magMmyg || {}));
    for (const user of store.users) for (const value of list(user.mags)) values.add(value);
    for (const value of list(store.catalogs.mags)) values.add(value);
    return [...values].filter(Boolean).sort(sortTr);
  }
  function mmygsForMag(mag) {
    if (clean(mag)) {
      const key = Object.keys(store.magMmyg || {}).find(item => norm(item) === norm(mag));
      if (key) return (store.magMmyg[key] || []).slice().sort(sortTr);
      return [];
    }
    const values = new Set();
    for (const items of Object.values(store.magMmyg || {})) for (const value of items) values.add(value);
    for (const user of store.users) for (const value of list(user.mmygs)) values.add(value);
    for (const value of list(store.catalogs.mmygs)) values.add(value);
    return [...values].filter(Boolean).sort(sortTr);
  }
  /* v7.37 — Kullanıcıya birden çok MAG atanabildiği için MMYG listesi
     SEÇİLİ MAG'ların BİRLEŞİMİdir. Tek bir MAG'a bakmak, ikinci MAG'ın
     MMYG'lerini listede hiç göstermemek demekti. Hiç MAG seçilmemişse tüm
     katalog gösterilir — kullanıcı sırayı ters kurabilmeli. */
  function mmygsForMags(mags) {
    const selected = list(mags).filter(Boolean);
    if (!selected.length) return mmygsForMag('');
    const values = new Set();
    for (const mag of selected) for (const value of mmygsForMag(mag)) values.add(value);
    return [...values].filter(Boolean).sort(sortTr);
  }
  function buyingGroupsForScope(mags, mmygs, extra) {
    const selectedMags = list(mags).filter(Boolean);
    const selectedMmygs = list(mmygs).filter(Boolean);
    if (!selectedMags.length) return buyingGroupsFor('', selectedMmygs[0] || '', extra);
    const values = new Set(list(extra));
    for (const mag of selectedMags) {
      if (selectedMmygs.length) for (const mmyg of selectedMmygs) for (const value of buyingGroupsFor(mag, mmyg, [])) values.add(value);
      else for (const value of buyingGroupsFor(mag, '', [])) values.add(value);
    }
    return [...values].filter(Boolean).sort(sortTr);
  }

  /* v7.23 — BUYING GROUP kataloğu.
     Kullanıcı talebi: "Kullanıcılara Buying Group alanı da ekleyelim.
     X kullanıcısı Y MAG'ında Z MMYG'sinde D ve B Buying Gruplarından sorumlu."
     Liste, seçilen MAG+MMYG'de gerçekten var olan gruplarla sınırlanır;
     seçim yoksa tüm katalog gösterilir. Kullanıcının hâlihazırda kayıtlı
     grupları listede yoksa bile DÜŞÜRÜLMEZ — aksi halde kaydedilmiş bir
     sorumluluk sessizce silinirdi. */
  function buyingGroupsFor(mag, mmyg, extra) {
    const catalog = store.buyingGroupCatalog || { byMagMmyg: {}, all: [] };
    const values = new Set();
    const magKey = Object.keys(catalog.byMagMmyg || {}).find(item => norm(item) === norm(mag));
    if (magKey) {
      const groupsByMmyg = catalog.byMagMmyg[magKey] || {};
      const mmygKey = Object.keys(groupsByMmyg).find(item => norm(item) === norm(mmyg));
      if (clean(mmyg) && mmygKey) for (const value of groupsByMmyg[mmygKey]) values.add(value);
      else for (const items of Object.values(groupsByMmyg)) for (const value of items) values.add(value);
    } else {
      for (const value of list(catalog.all)) values.add(value);
      for (const user of store.users) for (const value of list(user.buyingGroups)) values.add(value);
    }
    for (const value of list(extra)) values.add(value);
    return [...values].filter(Boolean).sort(sortTr);
  }
  function allBuyingGroups() {
    const values = new Set(list((store.buyingGroupCatalog || {}).all));
    for (const user of store.users) for (const value of list(user.buyingGroups)) values.add(value);
    for (const value of list(store.catalogs.buyingGroups)) values.add(value);
    return [...values].filter(Boolean).sort(sortTr);
  }

  function filtersPanel() {
    const managers = store.users.filter(user => childrenOf(user.id).length).map(user => ({ value: user.id, label: userName(user) }));
    return `<div class="umFilters">
      <label>${esc(T('Rol', 'Role'))}${selectHtml('data-um-filter="role"', ROLE_ORDER.map(id => ({ value: id, label: roleLabel(id) })), store.filters.role, T('Tümü', 'All'))}</label>
      <label>MAG${selectHtml('data-um-filter="mag"', allMags(), store.filters.mag, T('Tümü', 'All'))}</label>
      <label>MMYG${selectHtml('data-um-filter="mmyg"', mmygsForMag(store.filters.mag), store.filters.mmyg, T('Tümü', 'All'))}</label>
      <label>${esc(T('Buying Group', 'Buying Group'))}${selectHtml('data-um-filter="buyingGroup"', allBuyingGroups(), store.filters.buyingGroup, T('Tümü', 'All'))}</label>
      <label>${esc(T('Yönetici', 'Manager'))}${selectHtml('data-um-filter="managerId"', managers, store.filters.managerId, T('Tümü', 'All'))}</label>
      <button type="button" class="umBtn umBtnGhost" data-act="clearFilters">${esc(T('Filtreleri Temizle', 'Clear Filters'))}</button>
    </div>`;
  }

  function bulkBar() {
    const ids = [...store.selectedIds];
    const anyInactive = ids.some(id => (userById(id) || {}).status !== 'ACTIVE');
    const anyActive = ids.some(id => (userById(id) || {}).status === 'ACTIVE');
    return `<div class="umBulkBar">
      <span class="umBulkCount">${ids.length} ${esc(T('kullanıcı seçildi', 'users selected'))}</span>
      ${anyInactive ? `<button type="button" class="umBtn umBtnSmall" data-act="bulkActivate">${esc(T('Aktifleştir', 'Activate'))}</button>` : ''}
      ${anyActive ? `<button type="button" class="umBtn umBtnSmall" data-act="bulkDeactivate">${esc(T('Pasife Al', 'Deactivate'))}</button>` : ''}
      <button type="button" class="umBtn umBtnSmall" data-act="bulkManager">${esc(T('Yönetici Ata', 'Assign Manager'))}</button>
      <button type="button" class="umBtn umBtnSmall" data-act="bulkScope">${esc(T('MAG/MMYG Değiştir', 'Change MAG/MMYG'))}</button>
      ${store.canCopyProfiles ? `<button type="button" class="umBtn umBtnSmall" data-act="bulkCopy">${esc(T('Profil Kopyala', 'Copy Profile'))}</button>` : ''}
      <button type="button" class="umBtn umBtnGhost umBtnSmall" data-act="clearSelection">${esc(T('Seçimi Bırak', 'Clear Selection'))}</button>
    </div>`;
  }

  function usersTable(rows) {
    if (!rows.length) {
      if (store.statusFilter === 'inactive') return emptyState(T('İnaktif kullanıcı bulunmuyor.', 'There are no inactive users.'), T('Bir kullanıcıyı pasife aldığınızda burada listelenir ve tek tıkla yeniden aktifleştirebilirsiniz.', 'When you deactivate a user they appear here and can be reactivated with one click.'));
      if (store.search || Object.values(store.filters).some(Boolean)) return emptyState(T('Aramanıza uyan kullanıcı yok.', 'No user matches your search.'), T('Arama metnini kısaltmayı veya filtreleri temizlemeyi deneyin.', 'Try shortening the search text or clearing the filters.'), { act: 'clearFilters', label: T('Filtreleri Temizle', 'Clear Filters') });
      return emptyState(T('Henüz kullanıcı yok.', 'There are no users yet.'), T('İlk kullanıcıyı oluşturarak başlayın.', 'Start by creating the first user.'), { act: 'newUser', label: T('Yeni Kullanıcı', 'New User') });
    }
    const allChecked = rows.every(user => store.selectedIds.has(user.id));
    return `<table class="umTable">
      <thead><tr>
        <th class="umColCheck"><input type="checkbox" data-act="selectAll" ${allChecked ? 'checked' : ''} aria-label="${esc(T('Tümünü seç', 'Select all'))}"></th>
        <th>${esc(T('Kullanıcı', 'User'))}</th>
        <th>${esc(T('Kullanıcı adı', 'User name'))}</th>
        <th>${esc(T('Rol', 'Role'))}</th>
        <th>MAG</th><th>MMYG</th>
        <th>${esc(T('Yönetici', 'Manager'))}</th>
        <th>${esc(T('Durum', 'Status'))}</th>
        <th>${esc(T('Son Güncelleme', 'Last Updated'))}</th>
        <th class="umColActions">${esc(T('İşlemler', 'Actions'))}</th>
      </tr></thead>
      <tbody>${rows.map(userRow).join('')}</tbody>
    </table>`;
  }

  /* Avatar tonu kimlikten türetilir: aynı kişi her ekranda aynı renkte. */
  function avatarHue(value) {
    let hash = 0;
    for (const ch of String(value || '')) hash = (hash * 31 + ch.codePointAt(0)) >>> 0;
    return hash % 360;
  }
  // Kök Moderatör hesabı pasife alınamaz (sunucu da reddeder); düğmeyi hiç gösterme.
  const statusLocked = user => user.id === 'moderator';
  function userRow(user) {
    const active = user.status === 'ACTIVE';
    return `<tr class="umRow${store.detailId === user.id ? ' isOpen' : ''}${active ? '' : ' isInactive'}" data-act="openDetail" data-id="${esc(user.id)}">
      <td class="umColCheck"><input type="checkbox" data-act="selectRow" data-id="${esc(user.id)}" ${store.selectedIds.has(user.id) ? 'checked' : ''} aria-label="${esc(userName(user))}"></td>
      <td class="umCellUser"><span class="umAvatar" style="--um-hue:${avatarHue(user.id || userName(user))}">${esc(initials(userName(user)))}</span><span class="umCellUserText"><b>${esc(userName(user))}</b><small>${esc(dash(user.email || user.title))}</small></span></td>
      ${/* v7.39 — kullanıcı adı listede görünür; tanımsız olanı bulmanın tek
            yolu tek tek kartları açmaktı. */ ''}
      <td class="umCellWrap">${clean(user.username) ? esc(user.username)
        : `<span class="umWarn" title="${esc(T('Giriş ekranında seçilebiliyor ama giriş yapamıyor.', 'Can be picked on the login screen but cannot sign in.'))}">${esc(T('tanımsız', 'not set'))}</span>`}</td>
      <td><span class="umRole is-${esc(user.systemRole || 'buyer')}">${esc(roleLabel(user.systemRole))}</span></td>
      <td class="umCellWrap">${esc(dash(joinText(user.mags)))}</td>
      <td class="umCellWrap">${esc(dash(joinText(user.mmygs)))}</td>
      <td>${esc(dash(nameOf(user.managerId)))}</td>
      <td><span class="umPill ${active ? 'isActive' : 'isInactive'}">${esc(statusLabel(user.status))}</span></td>
      <td>${esc(formatDateTime(user.updatedAt))}</td>
      <td class="umColActions">
        ${user.canEdit === false ? `<span class="umLocked">${esc(T('Salt görüntü', 'Read only'))}</span>` : `
          ${statusLocked(user) ? '' : (active
            ? `<button type="button" class="umBtn umBtnSmall" data-act="deactivate" data-id="${esc(user.id)}">${esc(T('Pasife Al', 'Deactivate'))}</button>`
            : `<button type="button" class="umBtn umBtnSmall umBtnPrimary" data-act="activate" data-id="${esc(user.id)}">${esc(T('Aktifleştir', 'Activate'))}</button>`)}
          <button type="button" class="umBtn umBtnSmall umBtnGhost" data-act="openEdit" data-id="${esc(user.id)}">${esc(T('Düzenle', 'Edit'))}</button>`}
      </td>
    </tr>`;
  }

  /* ===================== 7 · Detay paneli ===================== */

  function detailDrawer(user) {
    if (!user) return '';
    const active = user.status === 'ACTIVE';
    const tabs = [['summary', T('Özet', 'Summary')], ['edit', T('Düzenle', 'Edit')], ['horizon', 'Horizon'], ['permissions', T('Yetkiler', 'Permissions')]];
    return `<aside class="umDrawer" data-um-drawer>
      <header class="umDrawerHead">
        <div class="umDrawerTitle">
          <span class="umAvatar umAvatarLarge">${esc(initials(userName(user)))}</span>
          <div>
            <h3>${esc(userName(user))}</h3>
            <span class="umPill ${active ? 'isActive' : 'isInactive'}">${esc(statusLabel(user.status))}</span>
          </div>
        </div>
        <button type="button" class="umDrawerClose" data-act="closeDetail" aria-label="${esc(T('Kapat', 'Close'))}">×</button>
      </header>
      <nav class="umDrawerTabs">${tabs.map(([id, label]) => `<button type="button" class="umDrawerTab${store.detailTab === id ? ' isActive' : ''}" data-act="detailTab" data-id="${id}">${esc(label)}</button>`).join('')}</nav>
      <div class="umDrawerBody">${
        store.detailTab === 'edit' ? detailEdit(user)
        : store.detailTab === 'horizon' ? detailHorizon(user)
        : store.detailTab === 'permissions' ? detailPermissions(user)
        : detailSummary(user)
      }</div>
    </aside>`;
  }

  function detailSummary(user) {
    const active = user.status === 'ACTIVE';
    const reports = childrenOf(user.id).filter(item => item.status === 'ACTIVE');
    const editable = user.canEdit !== false;
    return `
      <dl class="umFacts">
        <div><dt>${esc(T('Kullanıcı adı', 'User name'))}</dt><dd>${clean(user.username)
          ? esc(user.username)
          : `<span class="umWarn">${esc(T('tanımsız', 'not set'))}</span>`}</dd></div>
        <div><dt>${esc(T('Rol', 'Role'))}</dt><dd>${esc(roleLabel(user.systemRole))}</dd></div>
        <div><dt>MAG</dt><dd>${esc(dash(joinText(user.mags)))}</dd></div>
        <div><dt>MMYG</dt><dd>${esc(dash(joinText(user.mmygs)))}</dd></div>
        <div><dt>${esc(T('Buying Group', 'Buying Group'))}</dt><dd>${esc(dash(joinText(user.buyingGroups)))}</dd></div>
        <div><dt>${esc(T('Yönetici', 'Manager'))}</dt><dd>${esc(dash(nameOf(user.managerId)))}</dd></div>
        <div><dt>${esc(T('Veri Kapsamı', 'Data Scope'))}</dt><dd>${esc(scopeLabel(user.dataScope && user.dataScope.mode))}</dd></div>
        <div><dt>${esc(T('Alt Kullanıcılar', 'Reports'))}</dt><dd>${reports.length ? esc(reports.map(userName).join(', ')) : '—'}</dd></div>
      </dl>
      ${editable ? `<div class="umDrawerActions">
        <button type="button" class="umBtn" data-act="detailTab" data-id="edit">${esc(T('Düzenle', 'Edit'))}</button>
        ${store.authMode === 'local'
          ? `<button type="button" class="umBtn" data-act="password" data-id="${esc(user.id)}">${esc(user.hasPassword ? T('Parolayı Sıfırla', 'Reset Password') : T('Parola Belirle', 'Set Password'))}</button>`
          : `<span class="umNote">${esc(T('Kurumsal Hesap ile Giriş', 'Signs in with corporate account'))}</span>`}
        <button type="button" class="umBtn" data-act="detailTab" data-id="permissions">${esc(T('Yetkiler', 'Permissions'))}</button>
        ${store.canCopyProfiles ? `<button type="button" class="umBtn" data-act="copyFrom" data-id="${esc(user.id)}">${esc(T('Profili Kopyala', 'Copy Profile'))}</button>` : ''}
        ${statusLocked(user) ? '' : (active
          ? `<button type="button" class="umBtn umBtnDanger" data-act="deactivate" data-id="${esc(user.id)}">${esc(T('Pasife Al', 'Deactivate'))}</button>`
          : `<button type="button" class="umBtn umBtnPrimary" data-act="activate" data-id="${esc(user.id)}">${esc(T('Aktifleştir', 'Activate'))}</button>`)}
      </div>` : `<p class="umNote">${esc(T('Bu kullanıcı sizin yönetim alanınızda olmadığı için yalnız görüntülenebilir.', 'This user is outside your management scope and is read only.'))}</p>`}
      ${!user.hasPassword && store.authMode === 'local' ? `<p class="umWarn">${esc(T('Bu kullanıcı için henüz parola tanımlanmadı. Aktifleştirmeden önce parola belirleyin.', 'No password has been set for this user yet. Set one before activating.'))}</p>` : ''}
      ${clean(user.username) ? '' : `<p class="umWarn">${esc(T('Kullanıcı adı tanımsız: bu kişi giriş ekranında seçilebiliyor ama giriş yapamıyor. Düzenle > Kullanıcı adı alanından tanımlayın.', 'No user name: this person can be picked on the login screen but cannot sign in. Set it under Edit > User name.'))}</p>`}
      <h4 class="umSubHead">${esc(T('Toplam Yetkiler', 'Total Permissions'))}</h4>
      ${effectiveList(user, 6)}
    `;
  }

  function sourceBadge(source) {
    const label = { ROLE: T('Rol', 'Role'), DIRECT: T('Özel', 'Direct'), HIERARCHY: T('Hiyerarşi', 'Hierarchy'), TEMPORARY: T('Süreli', 'Temporary') }[source] || source;
    return `<span class="umSource is${esc(String(source || '').toLowerCase())}">${esc(label)}</span>`;
  }
  const RESOURCE_ORDER = CATEGORIES.flatMap(category => category.resources);
  function permissionText(code) {
    const item = store.permissionRegistry.find(entry => entry.code === code);
    if (!item) return code;
    const resource = store.resources[item.resource] || {};
    const name = T(resource.tr || item.resource, resource.en || item.resource);
    return `${name} · ${actionLabel(item.action)}`;
  }
  // Listeler alfabetik değil, matristeki okuma sırasıyla dizilir: önce Planlama,
  // sonra Sipariş… ve her modül içinde Görüntüle → Yetki Ver.
  function permissionRank(code) {
    const item = store.permissionRegistry.find(entry => entry.code === code);
    if (!item) return 9999;
    const resource = RESOURCE_ORDER.indexOf(item.resource);
    const action = ACTION_ORDER.indexOf(item.action);
    return (resource < 0 ? RESOURCE_ORDER.length : resource) * 100 + (action < 0 ? 99 : action);
  }
  function effectiveList(user, limit) {
    const seen = new Map();
    for (const item of user.effectivePermissions || []) {
      const previous = seen.get(item.permission);
      const rank = { ROLE: 1, DIRECT: 2, HIERARCHY: 3, TEMPORARY: 4 };
      if (!previous || (rank[item.source] || 9) < (rank[previous.source] || 9)) seen.set(item.permission, item);
    }
    const items = [...seen.values()].sort((a, b) => permissionRank(a.permission) - permissionRank(b.permission));
    if (!items.length) return `<p class="umNote">${esc(T('Bu kullanıcının henüz hiçbir yetkisi yok.', 'This user has no permissions yet.'))}</p>`;
    const shown = limit && items.length > limit ? items.slice(0, limit) : items;
    return `<ul class="umEffective">${shown.map(item => `<li><span title="${esc(item.permission)}">${esc(permissionText(item.permission))}</span>${sourceBadge(item.source)}</li>`).join('')}
      ${limit && items.length > limit ? `<li class="umEffectiveMore"><button type="button" class="umLink" data-act="detailTab" data-id="permissions">${esc(T('Tümünü göster', 'Show all'))} (${items.length})</button></li>` : ''}</ul>`;
  }

  function detailEdit(user) {
    const root = user.id === 'moderator';
    const self = store.actor && store.actor.id === user.id;
    // v7.37 — üç alan da çoktan seçmeli: kullanıcının TÜM değerleri korunur.
    const mags = list(user.mags);
    const mmygs = list(user.mmygs);
    const ownedGroups = list(user.buyingGroups);
    const blocked = descendantIds(user.id);
    const managers = store.users
      .filter(item => item.id !== user.id && item.status === 'ACTIVE' && !blocked.has(item.id))
      .map(item => ({ value: item.id, label: managerOptionLabel(item) }));
    return `<form class="umForm" data-um-form="profile" data-id="${esc(user.id)}">
      <label>${esc(T('Görünen ad', 'Display name'))}<input name="displayName" required value="${esc(userName(user))}"></label>
      ${/* v7.39 — KULLANICI ADI ALANI. Sunucu bu alanı zaten kabul ediyordu ama
            arayüzde hiçbir yerde YOKTU: yeni kullanıcıda sessizce görünen addan
            türetiliyor, sonradan değiştirilemiyordu. Kullanıcı adı boş kalan bir
            kayıt varsa giriş ekranında "kullanıcı adı tanımlı değil" uyarısı
            alınıyor ve düzeltilecek yer bulunamıyordu. */ ''}
      <label>${esc(T('Kullanıcı adı', 'User name'))}
        <input name="username" required value="${esc(user.username || '')}" autocomplete="off" placeholder="${esc(T('Giriş ekranında yazılacak ad', 'The name typed on the login screen'))}">
      </label>
      <p class="umNote">${esc(clean(user.username)
        ? T('Giriş ekranında bu ad yazılır. Değiştirirseniz kullanıcı yeni adıyla girer; parolası değişmez.', 'This is the name typed on the login screen. If you change it the user signs in with the new name; their password does not change.')
        : T('Bu kullanıcının adı TANIMSIZ — giriş ekranında seçildiğinde “kullanıcı adı tanımlı değil” uyarısı alınır. Buradan tanımlayın.', 'This user has NO user name — selecting them on the login screen gives the “no user name defined” warning. Set it here.'))}</p>
      <label>${esc(T('E-posta', 'E-mail'))}<input name="email" type="email" value="${esc(user.email || '')}"></label>
      <label>${esc(T('Rol', 'Role'))}${selectHtml(`name="systemRole"${root || self ? ' disabled' : ''}`, ROLE_ORDER.map(id => ({ value: id, label: roleLabel(id) })), user.systemRole)}</label>
      ${chipFieldHtml({ name: 'mag', tag: 'mag', label: 'MAG', values: mags, options: allMags(),
        note: T('ASAS’taki Merch Alt Grup değerlerinden beslenir. Birden çok MAG atanabilir; listede olmayan bir değeri elle de yazabilirsiniz.',
          'Fed from the Merch Sub Group values in ASAS. Several MAGs can be assigned; a value not in the list can be typed manually.') })}
      ${chipFieldHtml({ name: 'mmyg', tag: 'mmyg', label: 'MMYG', values: mmygs, options: mmygsForMags(mags), allOptions: mmygsForMag(''),
        note: T('ASAS’taki Merch Marka Yaş Grup değerlerinden beslenir; seçili MAG’lara göre daralır.',
          'Fed from the Merch Brand Age Group values in ASAS; narrows to the selected MAGs.') })}
      ${chipFieldHtml({ name: 'buyingGroup', tag: 'buyingGroup', label: T('Buying Group', 'Buying Group'),
        values: ownedGroups, options: buyingGroupsForScope(mags, mmygs, ownedGroups), allOptions: allBuyingGroups(),
        note: T('ASAS’taki Buyer Grup değerlerinden beslenir. Kullanıcı birden fazla Buying Group’tan sorumlu olabilir; seçim, Model Data Connection’daki Horizon ön ayarını da belirler.',
          'Fed from the Buyer Group values in ASAS. A user can be responsible for several Buying Groups; the selection also drives the default Horizon preset in Model Data Connection.') })}
      <label>${esc(T('Yönetici', 'Manager'))}${selectHtml('name="managerId"', managers, user.managerId || '', T('Yönetici seçin (boş bırakılabilir)', 'Select manager (may be left empty)'))}</label>
      ${managers.length ? '' : `<p class="umNote">${esc(T(
        'Bu kullanıcıya bağlanabilecek bir yönetici yok: listedeki herkes zaten ona bağlı. Yalnız Moderatör hesapları yöneticisiz kalabildiği için bir Moderatöre ancak başka bir Moderatör yönetici olabilir.',
        'There is no one this user can report to: everyone else already reports to them. Only Moderator accounts may exist without a manager, so a Moderator can only report to another Moderator.',
      ))}</p>`}
      <label>${esc(T('Veri Kapsamı', 'Data Scope'))}${selectHtml(`name="scopeMode"${root ? ' disabled' : ''}`, SCOPE_ORDER.map(id => ({ value: id, label: scopeLabel(id) })), (user.dataScope && user.dataScope.mode) || 'SELF')}</label>
      ${root ? `<p class="umNote">${esc(T('Korunan kök Moderatör hesabının rolü, durumu ve yöneticisi değiştirilemez.', 'The protected root Moderator account keeps its role, status and manager.'))}</p>` : ''}
      <div class="umFormActions">
        <button type="button" class="umBtn umBtnGhost" data-act="detailTab" data-id="summary">${esc(T('Vazgeç', 'Cancel'))}</button>
        <button type="submit" class="umBtn umBtnPrimary">${esc(T('Kaydet', 'Save'))}</button>
      </div>
    </form>`;
  }

  /* ===================== 7b · Kullanıcı Horizon'u =====================

     Kullanıcı talepleri:
       · "Kullanıcı bazlı horizon ve model data connectionları Moderatör ve
          Yöneticiler kullanıcıların yönetildiği sayfada ayarlayabilsin."
       · "Ön tanımlı ayarlar olsun, her kullanıcı için bağlı olduğu MAG ve
          MMYG bilgisine göre Horizon ön tanımlı filtreli gelsin."

     Panel iki şeyi ayırır ve İKİSİNİ DE gösterir:
       1) Kullanıcının MAG/MMYG/Buying Group bilgisinden GELEN ön tanım
          (hiçbir şey yazılmadan geçerli olan).
       2) Kullanıcıya ÖZEL yazılmış ufuk (ön tanımı ezer).
     Sıfırlamak, kullanıcıyı (1)'e geri döndürür — veriyi silmez, yalnız
     kişisel tercihi kaldırır. */
  const HORIZON_MODULES = [
    ['cp', 'CP'],
    ['orders', T('Siparişler', 'Orders')],
    ['backlog', 'Backlog'],
    ['lfl', 'LFL'],
    ['priceanalysis', T('Fiyat & Üretici Analizi', 'Price & Supplier Analysis')],
  ];
  /* v7.81 — HORIZON ÖN AYARLARI KALDIRILDI (kullanıcı kararı).

     Ön ayar, kullanıcının MAG/MMYG/Buying Group profiline göre ona otomatik
     bir ufuk atıyordu. Kullanıcı bunu hiç seçmemişti ve ekranında göremiyordu;
     Veri Yönetimi'nden ortak filtre değiştirildiğinde de bir şey değişmiyordu.

     Bu panelde geriye yönetici için ANLAMLI olan tek eylem kaldı: bir
     kullanıcının kişisel ufkunu SIFIRLAMAK. Sıfırlanınca o kullanıcı Veri
     Yönetimi'ndeki ortak filtreyi görür — yani herkesin gördüğünü. */
  function detailHorizon(user) {
    const module = store.horizonModule;
    const editable = user.canEdit !== false && (store.actor && (store.actor.canManageUsers || store.actor.systemRole === 'moderator'));
    return `<div class="umHorizonPane">
      <p class="umNote">${esc(T(
        'Kişisel ufuk, Veri Yönetimi’ndeki ortak filtreyi ezer. Buradan sıfırlarsanız kullanıcı ortak filtreye döner ve ekranı herkesinkiyle aynı olur. Ufkun kendisi kullanıcının kendi ekranından ayarlanır.',
        'A personal horizon overrides the shared filter in Data Management. Resetting it here returns the user to the shared filter, so their screen matches everyone else’s. The horizon itself is set from the user’s own screen.',
      ))}</p>
      <div class="umHorizonRow">
        <label>${esc(T('Ekran', 'Screen'))}${selectHtml('data-um-horizonmodule', HORIZON_MODULES.map(([id, label]) => ({ value: id, label })), module)}</label>
      </div>
      <dl class="umFacts">
        <div><dt>${esc(T('MAG / MMYG / Buying Group', 'MAG / MMYG / Buying Group'))}</dt><dd>${esc([dash(joinText(user.mags)), dash(joinText(user.mmygs)), dash(joinText(user.buyingGroups))].join(' · '))}</dd></div>
        <div><dt>${esc(T('Kişisel ufku', 'Personal horizon'))}</dt><dd>${user.hasHorizon ? esc(T('var — ortak filtreyi eziyor', 'set — overrides the shared filter')) : esc(T('yok — ortak filtreyi görüyor', 'none — sees the shared filter'))}</dd></div>
      </dl>
      ${editable ? `<div class="umDrawerActions">
        <button type="button" class="umBtn umBtnDanger" data-act="horizonReset" data-id="${esc(user.id)}">${esc(T('Kişisel Ufku Sıfırla', 'Reset Personal Horizon'))}</button>
      </div>` : `<p class="umNote">${esc(T('Bu kullanıcının ufkunu değiştirme yetkiniz yok.', 'You are not allowed to change this user’s horizon.'))}</p>`}
    </div>`;
  }

  async function loadHorizonConnections() {
    if (store.modelConnections.loaded) return;
    try {
      const data = await api('/api/model-connections', { headers: { Accept: 'application/json' } });
      store.modelConnections = { items: (data.items || []).filter(item => item && item.role !== 'fabric'), loaded: true };
    } catch (_) { store.modelConnections = { items: [], loaded: true }; }
    if (store.detailTab === 'horizon') render();
  }

  function detailPermissions(user) {
    const direct = new Set((user.directPermissions || []).map(item => item.permission));
    const roleCodes = new Set((user.assignedPermissions || []).filter(item => item.source === 'ROLE').map(item => item.permission));
    const editable = user.canEdit !== false && store.actor && store.actor.id !== user.id;
    return `<div class="umPermPane">
      <h4 class="umSubHead">${esc(T('Toplam Yetkiler', 'Total Permissions'))}</h4>
      ${effectiveList(user)}
      <h4 class="umSubHead">${esc(T('Kullanıcıya Özel Yetkiler', 'User-specific Permissions'))}</h4>
      <p class="umNote">${esc(T('Rolden gelen yetkiler burada işaretlenmez; bu liste yalnız kişiye ayrıca verilen izinleri yönetir.', 'Role permissions are not listed here; this list manages only the permissions granted to this person separately.'))}</p>
      ${editable ? `<form class="umForm" data-um-form="grants" data-id="${esc(user.id)}">
        <div class="umGrantGrid">${store.permissionRegistry.map(item => `
          <label class="umGrant${item.security ? ' isSecurity' : ''}" title="${esc(item.code + ' — ' + actionHint(item.action))}">
            <input type="checkbox" name="permission" value="${esc(item.code)}" ${direct.has(item.code) ? 'checked' : ''}>
            <span>${esc(permissionText(item.code))}${roleCodes.has(item.code) ? ` <em>${esc(T('rolde var', 'in role'))}</em>` : ''}</span>
          </label>`).join('')}</div>
        <div class="umFormActions"><button type="submit" class="umBtn umBtnPrimary">${esc(T('Kişisel Yetkileri Kaydet', 'Save Personal Permissions'))}</button></div>
      </form>` : `<p class="umNote">${esc(T('Kendi yetkilerinizi değiştiremezsiniz.', 'You cannot change your own permissions.'))}</p>`}
    </div>`;
  }

  /* ===================== 8 · Roller & Yetkiler ===================== */

  function rolesSection() {
    const roleId = store.roleTab;
    const draft = store.roleDraft[roleId] || { permissions: [], defaultDataScope: 'SELF' };
    const query = norm(store.permissionSearch);
    const categories = CATEGORIES.map(category => {
      const resources = category.resources.filter(resource => store.resources[resource]);
      const rows = resources.filter(resource => {
        if (!query) return true;
        const meta = store.resources[resource] || {};
        const text = [resource, meta.tr, meta.en, ...(meta.actions || []).map(actionLabel), ...(meta.actions || [])].map(norm).join(' ');
        return text.includes(query);
      });
      return { category, rows };
    }).filter(entry => entry.rows.length);

    return `<section class="umSection umRoles">
      <div class="umToolbar">
        <div class="umRoleTabs" data-bl-tabs="segment" role="tablist" aria-label="${esc(T('Yetki rolü', 'Permission role'))}">${ROLE_ORDER.map(id => `<button type="button" id="umPermissionsRoleTab-${id}" role="tab" aria-controls="umPermissionsRolePanel" aria-selected="${roleId === id}" tabindex="${roleId === id ? '0' : '-1'}" class="umRoleTab${roleId === id ? ' isActive' : ''}" data-act="roleTab" data-id="${id}">${esc(roleLabel(id))}</button>`).join('')}</div>
        <div class="umSearchWrap umSearchNarrow"><input type="search" class="umSearch" data-um-permsearch value="${esc(store.permissionSearch)}" placeholder="${esc(T('Modül veya yetki ara…', 'Search module or permission…'))}"></div>
        <label class="umInlineField">${esc(T('Varsayılan Veri Kapsamı', 'Default Data Scope'))}${selectHtml('data-um-rolescope', SCOPE_ORDER.map(id => ({ value: id, label: scopeLabel(id) })), draft.defaultDataScope || 'SELF')}</label>
      </div>
      ${store.roleDirty ? `<p class="umUnsaved">${esc(T('Kaydedilmemiş değişiklikler var.', 'There are unsaved changes.'))}</p>` : ''}
      <div class="umMatrixWrap" id="umPermissionsRolePanel" role="tabpanel" aria-labelledby="umPermissionsRoleTab-${roleId}" tabindex="0">
        ${categories.length ? `<table class="umMatrix">
          <thead><tr>
            <th class="umMatrixModule">${esc(T('Modül', 'Module'))}</th>
            ${ACTION_ORDER.map(action => `<th title="${esc(actionHint(action))}"><span>${esc(actionLabel(action))}</span><button type="button" class="umLink umColToggle" data-act="toggleColumn" data-id="${action}">${esc(T('tümü', 'all'))}</button></th>`).join('')}
          </tr></thead>
          ${categories.map(({ category, rows }) => matrixGroup(category, rows, draft)).join('')}
        </table>` : emptyState(T('Aramanıza uyan modül veya yetki yok.', 'No module or permission matches your search.'))}
      </div>
      <footer class="umMatrixFooter">
        <span class="umNote">${esc(T('Değişiklikler yalnız Kaydet dendiğinde uygulanır.', 'Changes are applied only when you press Save.'))}</span>
        <button type="button" class="umBtn umBtnGhost" data-act="discardRoles" ${store.roleDirty ? '' : 'disabled'}>${esc(T('Vazgeç', 'Discard'))}</button>
        <button type="button" class="umBtn umBtnPrimary" data-act="saveRoles" ${store.roleDirty ? '' : 'disabled'}>${esc(T('Değişiklikleri Kaydet', 'Save Changes'))}</button>
      </footer>
    </section>`;
  }

  function matrixGroup(category, resources, draft) {
    const collapsed = store.collapsedCategories.has(category.id);
    return `<tbody class="umMatrixGroup">
      <tr class="umMatrixGroupHead"><th class="umMatrixModule" colspan="${ACTION_ORDER.length + 1}">
        <button type="button" class="umGroupToggle" data-act="toggleCategory" data-id="${category.id}" aria-expanded="${!collapsed}">
          <span class="umChevron${collapsed ? ' isClosed' : ''}" aria-hidden="true">▾</span>${esc(T(category.tr, category.en))}
        </button></th></tr>
      ${collapsed ? '' : resources.map(resource => matrixRow(resource, draft)).join('')}
    </tbody>`;
  }

  function matrixRow(resource, draft) {
    const meta = store.resources[resource] || { actions: [] };
    const permissions = new Set(draft.permissions || []);
    return `<tr>
      <th class="umMatrixModule">
        ${esc(T(meta.tr || resource, meta.en || resource))}
        ${meta.security ? `<small>${esc(T('Güvenlik · hiyerarşiyle devredilmez', 'Security · not inherited'))}</small>` : ''}
      </th>
      ${ACTION_ORDER.map(action => {
        if (!(meta.actions || []).includes(action)) return '<td class="umMatrixNa">–</td>';
        const code = `${resource}.${action}`;
        return `<td><input type="checkbox" data-um-rolecell="${esc(code)}" ${permissions.has(code) ? 'checked' : ''} aria-label="${esc(T(meta.tr || resource, meta.en || resource) + ' ' + actionLabel(action))}" title="${esc(actionHint(action))}"></td>`;
      }).join('')}
    </tr>`;
  }

  /* ===================== 9 · Rol Workspace Şablonları ===================== */
  function templatesSection() {
    const roleId = store.template.roleId;
    const current = store.workspaceTemplates[roleId] || { entryCount: 0, categoryCounts: {}, categories: [] };
    const sourceOptions = store.users.filter(item => !store.template.search || norm(userName(item)).includes(norm(store.template.search))).map(item => ({ value: item.id, label: `${userName(item)} — ${roleLabel(item.systemRole)}` }));
    const categoryRows = [['horizon','Horizon','Horizon'],['filters','Filtreler','Filters'],['columns','Kolon düzenleri','Column layouts'],['views','Kayıtlı görünümler','Saved views'],['dashboard','Dashboard','Dashboard'],['favorites','Favoriler','Favorites']];
    const counts = current.categoryCounts || {};
    return `<section class="umSection umTemplates"><div class="umToolbar"><div class="umRoleTabs" data-bl-tabs="segment" role="tablist" aria-label="${esc(T('Şablon rolü', 'Template role'))}">${ROLE_ORDER.map(id => `<button type="button" id="umTemplateRoleTab-${id}" role="tab" aria-controls="umTemplateRolePanel" aria-selected="${roleId === id}" tabindex="${roleId === id ? '0' : '-1'}" class="umRoleTab${roleId === id ? ' isActive' : ''}" data-act="templateRole" data-id="${id}">${esc(`Standard ${roleLabel(id)}`)}</button>`).join('')}</div></div><div class="umTemplateGrid" id="umTemplateRolePanel" role="tabpanel" aria-labelledby="umTemplateRoleTab-${roleId}" tabindex="0"><div class="umCopyBlock"><h3>${esc(T('Aktif Rol Varsayılanı', 'Active Role Default'))}</h3><p class="umNote">${esc(T('Fallback: Kullanıcı Modülü → Kullanıcı Varsayılanı → Rol Modülü → Rol Varsayılanı → Uygulama Varsayılanı.', 'Fallback: User Module → User Default → Role Module → Role Default → Application Default.'))}</p>${current.entryCount ? `<dl class="umFacts"><div><dt>${esc(T('Kaynak', 'Source'))}</dt><dd>${esc(current.sourceName || '—')}</dd></div><div><dt>${esc(T('Ayar sayısı', 'Preference count'))}</dt><dd>${current.entryCount}</dd></div><div><dt>${esc(T('Son güncelleme', 'Last update'))}</dt><dd>${esc(current.updatedAt ? new Date(current.updatedAt).toLocaleString() : '—')}</dd></div></dl><ul class="umPreviewList">${categoryRows.filter(([key])=>counts[key]).map(([key,tr,en])=>`<li>${esc(T(tr,en))}: ${counts[key]}</li>`).join('')}</ul>` : `<p class="umWarn">${esc(T('Bu rol için henüz standart workspace şablonu oluşturulmadı.', 'No standard workspace template has been created for this role yet.'))}</p>`}</div><div class="umCopyBlock"><h3>${esc(T('Kullanıcıdan Şablon Oluştur', 'Create Template from User'))}</h3><input type="search" class="umSearch" data-um-templatesearch placeholder="${esc(T('Kaynak kullanıcı ara…', 'Search source users…'))}" value="${esc(store.template.search)}">${selectHtml('data-um-templatesource', sourceOptions, store.template.sourceId, T('Kullanıcı seçin', 'Select a user'))}<div class="umCopyCategories"><fieldset><legend>${esc(T('Workspace Kategorileri', 'Workspace Categories'))}</legend>${categoryRows.map(([key,tr,en])=>`<label class="umCheck"><input type="checkbox" data-um-templatecat="${key}" ${store.template.categories[key]?'checked':''}><span>${esc(T(tr,en))}</span></label>`).join('')}</fieldset></div><p class="umNote">${esc(T('Şablon bir snapshot olarak kaydedilir. Kullanıcının sonraki değişiklikleri şablonu otomatik değiştirmez.', 'The template is saved as a snapshot. Later user changes do not modify it automatically.'))}</p><div class="umFormActions"><button type="button" class="umBtn umBtnGhost" data-act="resetTemplate" ${current.entryCount?'':'disabled'}>${esc(T('Şablonu Sıfırla', 'Reset Template'))}</button><button type="button" class="umBtn umBtnPrimary" data-act="saveTemplate" ${store.template.sourceId?'':'disabled'}>${esc(T('Standard Şablonu Kaydet', 'Save Standard Template'))}</button></div></div></div></section>`;
  }

  /* ===================== 10 · Organizasyon ===================== */

  function organizationSection() {
    // Organization is an operational hierarchy view: inactive accounts remain
    // preserved in User Management/Audit, but they must not appear in this tree.
    const activeUsers = store.users.filter(user => user.status === 'ACTIVE');
    const known = new Set(activeUsers.map(user => user.id));
    // If an active account still references an inactive/missing manager (legacy
    // data), surface it as a root instead of silently losing it from the tree.
    const roots = activeUsers.filter(user => !clean(user.managerId) || !known.has(clean(user.managerId)));
    const requested = userById(store.orgSelectedId);
    const selected = requested && requested.status === 'ACTIVE' ? requested : (roots[0] || activeUsers[0] || null);
    if (!activeUsers.length) {
      return `<section class="umSection umOrg">${emptyState(T('Aktif kullanıcı bulunmuyor.', 'There are no active users.'), T('Organizasyon alanında yalnız aktif kullanıcılar gösterilir.', 'Only active users are shown in Organization.'), { act: 'newUser', label: T('Aktif kullanıcı ekle', 'Add active user') })}</section>`;
    }
    return `<section class="umSection umOrg">
      <div class="umToolbar"><p class="umNote">${esc(T('Yalnız aktif kullanıcılar gösterilir. Kartı seçip yöneticisini değiştirin veya kartı yeni yöneticisinin üzerine sürükleyin.', 'Only active users are shown. Select a card and change its manager, or drag the card onto its new manager.'))}</p></div>
      <div class="umOrgLayout">
        <div class="umTree">${roots.map(user => orgBranch(user, new Set())).join('')}</div>
        ${selected ? orgPanel(selected) : ''}
      </div>
    </section>`;
  }

  function orgBranch(user, seen) {
    if (seen.has(user.id) || user.status !== 'ACTIVE') return '';
    const next = new Set(seen); next.add(user.id);
    const children = childrenOf(user.id).filter(item => item.status === 'ACTIVE').sort((a, b) => sortTr(userName(a), userName(b)));
    const active = true;
    return `<div class="umTreeNode">
      <button type="button" class="umNode${store.orgSelectedId === user.id ? ' isActive' : ''}${active ? '' : ' isInactive'}"
        draggable="true" data-act="orgSelect" data-id="${esc(user.id)}" data-um-node="${esc(user.id)}">
        <span class="umAvatar">${esc(initials(userName(user)))}</span>
        <span class="umNodeText">
          <b>${esc(userName(user))}</b>
          <small>${esc(roleLabel(user.systemRole))}</small>
          <small>MAG: ${esc(dash(joinText(user.mags)))}</small>
          <small>MMYG: ${esc(dash(joinText(user.mmygs)))}</small>
          ${list(user.buyingGroups).length ? `<small>${esc(T('Buying Group', 'Buying Group'))}: ${esc(joinText(user.buyingGroups))}</small>` : ''}
        </span>
        <span class="umNodeStatus ${active ? 'isActive' : 'isInactive'}" title="${esc(statusLabel(user.status))}"></span>
      </button>
      ${children.length ? `<div class="umTreeChildren">${children.map(child => orgBranch(child, next)).join('')}</div>` : ''}
    </div>`;
  }

  function orgPanel(user) {
    const root = user.id === 'moderator';
    const blocked = descendantIds(user.id);
    const managers = store.users
      .filter(item => item.id !== user.id && item.status === 'ACTIVE' && !blocked.has(item.id))
      .map(item => ({ value: item.id, label: managerOptionLabel(item) }));
    const reports = childrenOf(user.id);
    return `<aside class="umOrgPanel">
      <header class="umOrgPanelHead">
        <span class="umAvatar umAvatarLarge">${esc(initials(userName(user)))}</span>
        <div><h3>${esc(userName(user))}</h3><p>${esc(roleLabel(user.systemRole))}</p></div>
      </header>
      <dl class="umFacts">
        <div><dt>MAG</dt><dd>${esc(dash(joinText(user.mags)))}</dd></div>
        <div><dt>MMYG</dt><dd>${esc(dash(joinText(user.mmygs)))}</dd></div>
        <div><dt>${esc(T('Buying Group', 'Buying Group'))}</dt><dd>${esc(dash(joinText(user.buyingGroups)))}</dd></div>
        <div><dt>${esc(T('Yönetici', 'Manager'))}</dt><dd>${esc(dash(nameOf(user.managerId)))}</dd></div>
        <div><dt>${esc(T('Alt Kullanıcılar', 'Reports'))}</dt><dd>${reports.length ? esc(reports.map(userName).join(', ')) : '—'}</dd></div>
      </dl>
      <form class="umForm" data-um-form="manager" data-id="${esc(user.id)}">
        <label>${esc(T('Yönetici Değiştir', 'Change Manager'))}${selectHtml('name="managerId"', managers, user.managerId || '', T('Yönetici seçin (boş bırakılabilir)', 'Select manager (may be left empty)'))}</label>
        <div class="umFormActions"><button type="submit" class="umBtn umBtnPrimary">${esc(T('Kaydet', 'Save'))}</button></div>
      </form>
      <div class="umDrawerActions">
        <button type="button" class="umBtn" data-act="newUserUnder" data-id="${esc(user.id)}">${esc(T('Alt Kullanıcı Ekle', 'Add Report'))}</button>
        <button type="button" class="umBtn" data-act="openEdit" data-id="${esc(user.id)}">${esc(T('Kullanıcıyı Düzenle', 'Edit User'))}</button>
      </div>
    </aside>`;
  }

  /* ===================== 10 · Profil Kopyalama ===================== */

  function copySection() {
    const templateMode = store.copy.sourceType === 'template';
    const source = templateMode ? null : userById(store.copy.sourceId);
    const sourceTemplate = templateMode ? store.workspaceTemplates[store.copy.templateRole] : null;
    const sourceReady = templateMode ? Boolean(sourceTemplate && sourceTemplate.entryCount) : Boolean(source);
    const codes = source ? (source.directPermissions || []).map(item => item.permission) : [];
    const categories = store.copy.categories;
    const targets = store.users.filter(item => item.id !== 'moderator' && item.id !== (source && source.id) && item.id !== (store.actor && store.actor.id) && item.canEdit !== false);
    return `<section class="umSection umCopy">
      <div class="umCopyGrid">
        <div class="umCopyBlock">
          <h3>${esc(T('Kaynak', 'Source'))}</h3><div class="umRoleTabs"><button type="button" class="umRoleTab${templateMode?'':' isActive'}" data-act="copySourceType" data-id="user">${esc(T('Kullanıcı', 'User'))}</button><button type="button" class="umRoleTab${templateMode?' isActive':''}" data-act="copySourceType" data-id="template">${esc(T('Standart Şablon', 'Standard Template'))}</button></div>
          ${templateMode ? selectHtml('data-um-copytemplate', ROLE_ORDER.filter(id=>(store.workspaceTemplates[id]||{}).entryCount).map(id=>({value:id,label:`Standard ${roleLabel(id)} — ${(store.workspaceTemplates[id]||{}).entryCount} ${T('ayar','preferences')}`})), store.copy.templateRole, T('Şablon seçin', 'Select a template')) : `<input type="search" class="umSearch" data-um-copysourcesearch placeholder="${esc(T('Kaynak kullanıcı ara…', 'Search source users…'))}" value="${esc(store.copySourceSearch || '')}">${selectHtml('data-um-copysource', store.users.filter(item => !store.copySourceSearch || norm(userName(item)).includes(norm(store.copySourceSearch))).map(item => ({ value: item.id, label: `${userName(item)} — ${roleLabel(item.systemRole)}` })), store.copy.sourceId, T('Kullanıcı seçin', 'Select a user'))}`}
          <h4 class="umSubHead">${esc(T('Kopyalama Kategorileri', 'Copy Categories'))}</h4>
          <div class="umCopyCategories">
            <fieldset><legend>${esc(T('Yetkiler', 'Permissions'))}</legend><label class="umCheck"><input type="checkbox" data-um-copycat="userPermissions" ${categories.userPermissions ? 'checked' : ''} ${templateMode?'disabled':''}><span>${esc(T('Kullanıcıya Özel Yetkiler', 'User-specific Permissions'))}<small>${esc(templateMode?T('Standart workspace şablonu yetki içermez.','Standard workspace templates do not contain permissions.'):T('Rol yetkileri kopyalanmaz.', 'Role permissions are not copied.'))}</small></span></label></fieldset>
            <fieldset><legend>${esc(T('Kişisel Workspace', 'Personal Workspace'))}</legend>${[['horizon','Horizon','Horizon'],['filters','Filtreler','Filters'],['columns','Kolon düzenleri','Column layouts'],['views','Kayıtlı görünümler','Saved views'],['dashboard','Dashboard','Dashboard'],['favorites','Favoriler','Favorites']].map(([key,tr,en]) => `<label class="umCheck"><input type="checkbox" data-um-copyworkspace="${key}" ${categories.workspace[key] ? 'checked' : ''}><span>${esc(T(tr,en))}</span></label>`).join('')}</fieldset>
            <fieldset><legend>${esc(T('Organizasyon · varsayılan kapalı', 'Organization · off by default'))}</legend>${[['role','Rol','Role'],['mag','MAG','MAG'],['mmyg','MMYG','MMYG'],['buyingGroup','Buying Group','Buying Group'],['manager','Yönetici','Manager'],['dataScope','Veri kapsamı','Data scope']].map(([key,tr,en]) => `<label class="umCheck"><input type="checkbox" data-um-copyorg="${key}" ${categories.organization[key] ? 'checked' : ''} ${templateMode?'disabled':''}><span>${esc(T(tr,en))}</span></label>`).join('')}</fieldset>
          </div>
          <h4 class="umSubHead">${esc(templateMode?T('Şablon Özeti','Template Summary'):T('Kaynak Kişisel Yetkileri', 'Source Personal Permissions'))}</h4>
          ${templateMode ? `<p class="umNote">${esc(sourceTemplate&&sourceTemplate.entryCount?`${sourceTemplate.entryCount} ${T('workspace ayarı snapshot olarak uygulanacak.','workspace preferences will be applied as a snapshot.')}`:T('Seçili standart şablon boş veya oluşturulmamış.','The selected standard template is empty or has not been created.'))}</p>` : codes.length
            ? `<ul class="umEffective">${[...codes].sort((a, b) => permissionRank(a) - permissionRank(b)).map(code => `<li><span title="${esc(code)}">${esc(permissionText(code))}</span>${sourceBadge('DIRECT')}</li>`).join('')}</ul>`
            : `<p class="umNote">${esc(T('Bu kullanıcıya özel verilmiş bir yetki yok. Rolden gelen yetkiler kopyalanmaz — hedef kullanıcı zaten kendi rolünün yetkilerini alır.', 'This user has no personally granted permissions. Role permissions are not copied — the target already receives its own role’s permissions.'))}</p>`}
        </div>
        <div class="umCopyBlock">
          <h3>${esc(T('Hedef Kullanıcılar', 'Target Users'))}</h3>
          <input type="search" class="umSearch" data-um-copysearch placeholder="${esc(T('Hedef kullanıcı ara…', 'Search target users…'))}" value="${esc(store.copySearch || '')}">
          <div class="umCopyTargets" data-um-copytargets>${
            targets.filter(item => !store.copySearch || norm(userName(item)).includes(norm(store.copySearch)))
              .map(item => `<label class="umCopyTarget"><input type="checkbox" data-um-copytarget="${esc(item.id)}" ${store.copy.targetIds.has(item.id) ? 'checked' : ''}><span><b>${esc(userName(item))}</b><small>${esc(roleLabel(item.systemRole))} · ${esc(dash(joinText(item.mags)))}</small></span></label>`).join('')
              || emptyState(T('Uygun hedef kullanıcı yok.', 'There are no eligible target users.'))
          }</div>
          <h4 class="umSubHead">${esc(T('Kopyalama Biçimi', 'Copy Mode'))}</h4>
          <label class="umRadio"><input type="radio" name="umCopyMode" data-um-copymode="MERGE" ${store.copy.mode === 'MERGE' ? 'checked' : ''}>
            <span><b>${esc(T('Mevcut Ayarlara Ekle', 'Merge with Existing'))}</b><small>${esc(T('Hedefin seçilmeyen ve farklı anahtarlardaki ayarları korunur.', 'The target keeps unselected settings and unrelated keys.'))}</small></span></label>
          <label class="umRadio"><input type="radio" name="umCopyMode" data-um-copymode="REPLACE" ${store.copy.mode === 'REPLACE' ? 'checked' : ''}>
            <span><b>${esc(T('Seçilen Kategorileri Değiştir', 'Replace Selected Categories'))}</b><small class="umWarnText">${esc(T('Riskli: yalnız seçilen kategoriler kaynak snapshot’ıyla değiştirilir.', 'Risky: only selected categories are replaced by the source snapshot.'))}</small></span></label>
          <div class="umFormActions">
            <button type="button" class="umBtn umBtnPrimary" data-act="copyPreview" ${store.copy.targetIds.size && sourceReady ? '' : 'disabled'}>${esc(T('Önizle', 'Preview'))}</button>
          </div>
        </div>
      </div>
    </section>`;
  }

  /* ===================== 11 · Değişiklik Geçmişi ===================== */

  function historySentence(item) {
    const actor = clean(item.actor || item.user) || T('Sistem', 'System');
    const details = item.details || {};
    const target = clean(details.targetName) || nameOf(item.targetId || item.target) || clean(item.targetId || item.target);
    const old = details.oldValue || {}, next = details.newValue || {};
    const parts = [];
    switch (item.action) {
      case 'USER_CREATE':
        return T(`${actor}, ${target} kullanıcısını oluşturdu.`, `${actor} created the user ${target}.`);
      case 'USER_UPDATE': {
        // Durum değişikliği ayrı cümle olur: Türkçede "kullanıcısının ... aktifleştirdi"
        // bozuk okunuyor, "kullanıcısını aktifleştirdi" doğru biçim.
        const sentences = [];
        if (old.status && next.status && old.status !== next.status) {
          sentences.push(next.status === 'ACTIVE'
            ? T(`${actor}, ${target} kullanıcısını aktifleştirdi.`, `${actor} activated the user ${target}.`)
            : T(`${actor}, ${target} kullanıcısını pasife aldı.`, `${actor} deactivated the user ${target}.`));
        }
        if (old.systemRole && next.systemRole && old.systemRole !== next.systemRole) parts.push(T(`rolünü ${roleLabel(old.systemRole)} → ${roleLabel(next.systemRole)} olarak değiştirdi`, `changed the role from ${roleLabel(old.systemRole)} to ${roleLabel(next.systemRole)}`));
        if (clean(old.managerId) !== clean(next.managerId)) parts.push(T(`yöneticisini ${dash(nameOf(next.managerId))} olarak ayarladı`, `set the manager to ${dash(nameOf(next.managerId))}`));
        if (joinText(old.mags) !== joinText(next.mags)) parts.push(T(`MAG bilgisini ${dash(joinText(next.mags))} yaptı`, `set MAG to ${dash(joinText(next.mags))}`));
        if (joinText(old.mmygs) !== joinText(next.mmygs)) parts.push(T(`MMYG bilgisini ${dash(joinText(next.mmygs))} yaptı`, `set MMYG to ${dash(joinText(next.mmygs))}`));
        if (joinText(old.buyingGroups) !== joinText(next.buyingGroups)) parts.push(T(`Buying Group bilgisini ${dash(joinText(next.buyingGroups))} yaptı`, `set Buying Group to ${dash(joinText(next.buyingGroups))}`));
        if (details.passwordChanged) parts.push(T('parolasını yeniledi', 'reset the password'));
        {
          const before = new Set((old.directPermissions || []).map(entry => entry.permission));
          const after = new Set((next.directPermissions || []).map(entry => entry.permission));
          const added = [...after].filter(code => !before.has(code)), removed = [...before].filter(code => !after.has(code));
          if (added.length) parts.push(T(`${added.map(permissionText).join(', ')} yetkisini verdi`, `granted ${added.map(permissionText).join(', ')}`));
          if (removed.length) parts.push(T(`${removed.map(permissionText).join(', ')} yetkisini kaldırdı`, `removed ${removed.map(permissionText).join(', ')}`));
        }
        if (parts.length) sentences.push(T(`${actor}, ${target} kullanıcısının ${parts.join(', ')}.`, `${actor} ${parts.join(', ')} for ${target}.`));
        if (!sentences.length) sentences.push(T(`${actor}, ${target} kullanıcısının bilgilerini güncelledi.`, `${actor} updated the details of ${target}.`));
        return sentences.join(' ');
      }
      case 'ROLE_MATRIX_UPDATE':
        return T(`${actor}, rol yetkilerini güncelledi.`, `${actor} updated the role permissions.`);
      case 'ROLE_WORKSPACE_TEMPLATE_UPDATE':
        return T(`${actor}, Standard ${roleLabel(details.roleId)} workspace şablonunu ${clean(details.sourceName) || '—'} kullanıcısından güncelledi.`, `${actor} updated the Standard ${roleLabel(details.roleId)} workspace template from ${clean(details.sourceName) || '—'}.`);
      case 'ROLE_WORKSPACE_TEMPLATE_RESET':
        return T(`${actor}, Standard ${roleLabel(details.roleId)} workspace şablonunu sıfırladı.`, `${actor} reset the Standard ${roleLabel(details.roleId)} workspace template.`);
      case 'USER_PERMISSION_COPY': {
        const targets = list(details.targetNames).length ? list(details.targetNames) : list(details.targetUserIds).map(nameOf);
        const names = targets.join(', ');
        const suffix = targets.length > 1 ? T('kullanıcılarına', 'users') : T('kullanıcısına', 'user');
        const mode = details.mode === 'REPLACE' ? T('kaynakla aynı yaparak', 'making them identical to the source') : T('mevcut yetkilerine ekleyerek', 'adding to their existing permissions');
        return T(`${actor}, ${clean(details.sourceName) || target} kullanıcısının yetkilerini ${mode} ${names} ${suffix} kopyaladı.`, `${actor} copied the permissions of ${clean(details.sourceName) || target} to ${names}, ${mode}.`);
      }
      case 'USER_PROFILE_COPIED': {
        const results = list(details.results), successful = results.filter(entry => entry && entry.status === 'SUCCESS');
        const targetNames = successful.length
          ? successful.map(entry => clean(entry.targetName) || nameOf(entry.targetUserId)).filter(Boolean)
          : list(details.targetUserIds).map(nameOf);
        const workspace = list(details.categories && details.categories.workspace);
        const organization = details.categories && details.categories.organization || {};
        const copied = [];
        if (details.categories && details.categories.userPermissions) copied.push(T('kişisel yetkiler', 'personal permissions'));
        if (workspace.length) copied.push(T('çalışma alanı', 'workspace'));
        if (Object.values(organization).some(Boolean)) copied.push(T('organizasyon bilgileri', 'organization details'));
        const mode = details.mode === 'REPLACE' ? 'REPLACE' : 'MERGE';
        return T(
          `${actor}, ${clean(details.sourceName) || target} profilinin ${copied.join(', ') || 'seçilen alanlarını'} ${targetNames.join(', ')} kullanıcılarına ${mode} modunda kopyaladı.`,
          `${actor} copied ${copied.join(', ') || 'the selected profile fields'} from ${clean(details.sourceName) || target} to ${targetNames.join(', ')} in ${mode} mode.`,
        );
      }
      default:
        return `${actor} · ${item.action}${target ? ` · ${target}` : ''}`;
    }
  }

  const HISTORY_ACTIONS = new Set(['USER_CREATE', 'USER_UPDATE', 'ROLE_MATRIX_UPDATE', 'ROLE_WORKSPACE_TEMPLATE_UPDATE', 'ROLE_WORKSPACE_TEMPLATE_RESET', 'USER_PERMISSION_COPY', 'USER_PROFILE_COPIED', 'TEMPORARY_PERMISSION_GRANT', 'TEMPORARY_PERMISSION_REVOKE']);

  function historySection() {
    const query = norm(store.historyQuery);
    const items = (store.audit || [])
      .filter(item => HISTORY_ACTIONS.has(item.action))
      .map(item => ({ item, text: historySentence(item) }))
      .filter(entry => !query || norm(entry.text).includes(query) || norm(entry.item.reason || '').includes(query));
    return `<section class="umSection umHistory">
      <div class="umToolbar">
        <div class="umSearchWrap"><input type="search" class="umSearch" data-um-historysearch value="${esc(store.historyQuery)}" placeholder="${esc(T('Kullanıcı, işlem veya gerekçe ara…', 'Search user, change or reason…'))}"></div>
      </div>
      ${items.length ? `<ul class="umHistoryList">${items.map(({ item, text }) => `
        <li><time>${esc(formatDateTime(item.at))}</time><p>${esc(text)}</p>${item.reason ? `<small>${esc(T('Gerekçe', 'Reason'))}: ${esc(item.reason)}</small>` : ''}</li>`).join('')}</ul>`
        : emptyState(T('Görüntülenecek değişiklik kaydı yok.', 'There is no change record to show.'), T('Kullanıcı, rol veya yetki değişiklikleri burada okunabilir cümlelerle listelenir.', 'User, role and permission changes are listed here as readable sentences.'))}
    </section>`;
  }

  /* ===================== 12 · Diyaloglar ===================== */

  let dialog = null;
  function openDialog(title, bodyHtml, options = {}) {
    const returnTarget = document.activeElement || null;
    closeDialog({ restoreFocus: false });
    dialog = document.createElement('div');
    dialog.className = 'umDialogOverlay';
    dialog.innerHTML = `<div class="umDialog" role="dialog" aria-modal="true" aria-labelledby="umDialogTitle">
      <header><h3 id="umDialogTitle">${esc(title)}</h3><button type="button" class="umDrawerClose" data-act="dialogClose" aria-label="${esc(T('Kapat', 'Close'))}">×</button></header>
      <form class="umDialogBody" data-um-dialog>${bodyHtml}
        <footer class="umDialogFooter">
          <button type="button" class="umBtn umBtnGhost" data-act="dialogClose" data-bl-dialog-fallback>${esc(options.cancelLabel || T('Vazgeç', 'Cancel'))}</button>
          <button type="submit" class="umBtn ${options.danger ? 'umBtnDanger' : 'umBtnPrimary'}">${esc(options.confirmLabel || T('Onayla', 'Confirm'))}</button>
        </footer>
      </form>
    </div>`;
    document.body.appendChild(dialog);
    dialog.addEventListener('mousedown', event => { if (event.target === dialog) closeDialog(); });
    dialog.addEventListener('click', event => {
      if (event.target.closest('[data-act="dialogClose"]')) { closeDialog(); return; }
      // "Kullanıcıyı Aç" düğmesi pencerenin içindedir; kabuğun delegasyonu buraya
      // ulaşmadığı için ayrıca burada karşılanır.
      const existing = event.target.closest('[data-act="openExisting"]');
      if (existing) { closeDialog(); showUser(existing.dataset.id); }
      /* v7.37 — çip düğmeleri de pencerenin içindedir; kabuğun delegasyonu
         buraya ulaşmaz. Aynı işlevler burada da bağlanır, yoksa yeni kullanıcı
         penceresinde ekleme/çıkarma sessizce çalışmazdı. */
      const chipAddBtn = event.target.closest('[data-act="chipAdd"]');
      if (chipAddBtn) {
        const field = chipAddBtn.closest('[data-um-chipfield]');
        const input = field && field.querySelector('[data-um-chipnew]');
        if (input) { if (chipAdd(field, input.value)) refreshScopeChoices(field.closest('form')); input.value = ''; }
        return;
      }
      const chipRemoveBtn = event.target.closest('[data-act="chipRemove"]');
      if (chipRemoveBtn) {
        const field = chipRemoveBtn.closest('[data-um-chipfield]');
        const holder = field && field.querySelector('[data-um-chiplist]');
        chipRemoveBtn.closest('[data-um-chip]')?.remove();
        if (holder && !holder.querySelector('[data-um-chip]')) holder.innerHTML = `<span class="umChipEmpty">${esc(T('Seçilmedi', 'Not set'))}</span>`;
        refreshScopeChoices(field ? field.closest('form') : null);
      }
    });
    dialog.addEventListener('keydown', event => {
      if (event.key !== 'Enter') return;
      const chipNew = event.target.closest('[data-um-chipnew]');
      if (!chipNew) return;
      event.preventDefault();
      const field = chipNew.closest('[data-um-chipfield]');
      if (chipAdd(field, chipNew.value)) refreshScopeChoices(field ? field.closest('form') : null);
      chipNew.value = '';
    });
    dialog.addEventListener('input', onDialogInput);
    dialog.addEventListener('change', event => {
      const chipPick = event.target.closest('[data-um-chippick]');
      if (chipPick) {
        const field = chipPick.closest('[data-um-chipfield]');
        if (clean(chipPick.value)) chipAdd(field, chipPick.value);
        chipPick.value = '';
        refreshScopeChoices(field ? field.closest('form') : null);
        return;
      }
      onDialogInput(event);
    });
    dialog.addEventListener('submit', async event => {
      event.preventDefault();
      // Dinleyici formun kendisinde değil, onu saran katmanda duruyor; bu yüzden
      // form event.currentTarget ile DEĞİL, olayın kaynağından çözülmelidir.
      const form = event.target.closest('[data-um-dialog]');
      if (!form) return;
      const button = form.querySelector('button[type="submit"]');
      button.disabled = true;
      try { await options.onSubmit(new FormData(form), form); }
      catch (error) { showDialogError(error.message); button.disabled = false; return; }
      button.disabled = false;
    });
    const managed = window.BLLayerSystem?.openDialog(dialog, {
      trigger: returnTarget,
      onClose: closeDialog,
      initialFocus: options.danger ? '[data-bl-dialog-fallback]' : null,
    });
    if (!managed) {
      dialog.querySelector('input:not([type="hidden"]), select, textarea, [data-bl-dialog-fallback]')?.focus();
    }
    return dialog;
  }
  function closeDialog(options = {}) {
    if (!dialog) return;
    const current = dialog;
    window.BLLayerSystem?.closeDialog(dialog, options);
    current.remove();
    dialog = null;
  }
  function showDialogError(message) {
    if (!dialog) return;
    let box = dialog.querySelector('[data-um-dialogerror]');
    if (!box) {
      box = document.createElement('p'); box.className = 'umWarn'; box.setAttribute('data-um-dialogerror', '');
      dialog.querySelector('.umDialogFooter').before(box);
    }
    box.textContent = message;
  }
  /* MAG/MMYG değişince Buying Group listesi yenilenir. İŞARETLİ DEĞERLER
     KORUNUR: yeni listede olmayan bir grup, kullanıcı bilerek kaldırmadıkça
     düşürülmez — aksi halde bir MAG düzeltmesi, kayıtlı sorumluluğu sessizce
     silerdi (§142). Listede kalmayan seçili gruplar "listede yok" işaretiyle
     gösterilir. */
  /* v7.37 — MAG/MMYG değişince aşağıdaki seçim listeleri daralır. YALNIZ
     LİSTE değişir: seçili çipler hiçbir koşulda düşürülmez, aksi hâlde bir
     MAG değiştirmek kullanıcının kayıtlı Buying Group'unu sessizce silerdi
     (§142). Katalogda olmayan çip de yerinde kalır. */
  function refreshScopeChoices(form) {
    if (!form) return;
    const magField = chipFieldOf(form, 'mag');
    const mmygField = chipFieldOf(form, 'mmyg');
    const groupField = chipFieldOf(form, 'buyingGroup');
    const mags = chipValues(magField);
    const mmygs = chipValues(mmygField);
    refreshChipChoices(magField, allMags(), allMags());
    refreshChipChoices(mmygField, mmygsForMags(mags), mmygsForMag(''));
    refreshChipChoices(groupField, buyingGroupsForScope(mags, mmygs, []), allBuyingGroups());
  }

  function onDialogInput(event) {
    /* v7.39 — Ad Soyad yazıldıkça kullanıcı adı kendiliğinden dolar. Kullanıcı
       alana ELLE dokunduysa bir daha üzerine yazılmaz; yazdığını silmek, alanı
       hiç sunmamaktan beterdi. */
    const nameField = event.target.closest('[name="displayName"]');
    if (nameField && dialog) {
      const usernameField = dialog.querySelector('[data-um-username]');
      if (usernameField && usernameField.dataset.umTouched !== '1') usernameField.value = nameField.value;
    }
    if (event.target.closest('[data-um-username]')) event.target.dataset.umTouched = '1';
    const candidate = event.target.closest('[data-um-candidate]');
    if (candidate && dialog) applyDirectoryCandidate(candidate.value);
  }

  /* ===================== 13 · Kullanıcı oluşturma ===================== */

  function applyDirectoryCandidate(index) {
    const form = dialog && dialog.querySelector('[data-um-dialog]');
    if (!form) return;
    const duplicate = form.querySelector('[data-um-duplicate]');
    const submit = form.querySelector('button[type="submit"]');
    // DİKKAT: Number('') sıfırdır. Boş seçim listenin ilk kaydını getirmesin diye
    // önce boşluk kontrolü yapılır (elle giriş yolu bu daldan geçer).
    const entry = clean(index) === '' ? null : store.directory[Number(index)];
    if (!entry) {
      if (duplicate) duplicate.innerHTML = '';
      if (submit) submit.disabled = false;
      delete form.dataset.stableIds;
      return;
    }
    const nameField = form.querySelector('[name="displayName"]');
    if (nameField) nameField.value = entry.displayName;
    // v7.39 — kullanıcı adı da dolar; elle değiştirilmişse dokunulmaz.
    const usernameField = form.querySelector('[data-um-username]');
    if (usernameField && usernameField.dataset.umTouched !== '1') usernameField.value = entry.displayName;
    form.dataset.stableIds = JSON.stringify(entry.stableIds || {});
    /* v7.37 — dizinden gelen adayın TÜM MAG ve MMYG'leri çip olarak eklenir.
       Eskiden yalnız ilki alınıyordu; birden çok MAG'ı olan bir buyer'ın geri
       kalanı sessizce düşüyordu. */
    const magField = chipFieldOf(form, 'mag');
    const mmygField = chipFieldOf(form, 'mmyg');
    list(entry.mags).forEach(value => chipAdd(magField, value));
    list(entry.mmygs).forEach(value => chipAdd(mmygField, value));
    refreshScopeChoices(form);
    if (duplicate) {
      duplicate.innerHTML = entry.existingUserId
        ? `<p class="umWarn">${esc(T(`${entry.displayName} zaten Buyer Log kullanıcısıdır.`, `${entry.displayName} is already a Buyer Log user.`))}
             <button type="button" class="umLink" data-act="openExisting" data-id="${esc(entry.existingUserId)}">${esc(T('Kullanıcıyı Aç', 'Open User'))}</button></p>`
        : '';
    }
    if (submit) submit.disabled = Boolean(entry.existingUserId);
  }

  function openCreateDialog(managerId) {
    const managers = store.users.filter(item => item.status === 'ACTIVE').map(item => ({ value: item.id, label: managerOptionLabel(item) }));
    const candidates = store.directory.map((entry, index) => ({
      value: String(index),
      label: `${entry.displayName}${entry.mags && entry.mags.length ? ` — MAG: ${entry.mags.join(', ')}` : ''}${entry.mmygs && entry.mmygs.length ? ` — MMYG: ${entry.mmygs.join(', ')}` : ''}${entry.existingUserId ? ` — ${T('kayıtlı', 'already a user')}` : ''}`,
    }));
    openDialog(T('Yeni Kullanıcı', 'New User'), `
      <label>${esc(T('Kullanıcı', 'User'))}
        ${candidates.length
          ? selectHtml('data-um-candidate', candidates, '', T('Listeden seçin veya elle yazın', 'Pick from the list or type manually'))
          : `<span class="umNote">${esc(T('Buyer listesi henüz yüklenmedi; adı elle yazabilirsiniz.', 'The buyer list is not loaded yet; you can type the name manually.'))}</span>`}
      </label>
      <div data-um-duplicate></div>
      <label>${esc(T('Ad Soyad', 'Full name'))}<input name="displayName" required autocomplete="off"></label>
      <label>${esc(T('Kullanıcı adı', 'User name'))}<input name="username" data-um-username required autocomplete="off" placeholder="${esc(T('Giriş ekranında yazılacak ad', 'The name typed on the login screen'))}"></label>
      <p class="umNote">${esc(T('Ad Soyad yazdıkça kendiliğinden dolar; istediğiniz gibi değiştirebilirsiniz.', 'It fills in as you type the full name; you can change it however you like.'))}</p>
      <label>${esc(T('E-posta', 'E-mail'))}<input name="email" type="email" autocomplete="off"></label>
      <label>${esc(T('Rol', 'Role'))}${selectHtml('name="systemRole"', ROLE_ORDER.map(id => ({ value: id, label: roleLabel(id) })), 'buyer')}</label>
      ${chipFieldHtml({ name: 'mag', tag: 'mag', label: 'MAG', values: [], options: allMags() })}
      ${chipFieldHtml({ name: 'mmyg', tag: 'mmyg', label: 'MMYG', values: [], options: mmygsForMags([]) })}
      ${chipFieldHtml({ name: 'buyingGroup', tag: 'buyingGroup', label: T('Buying Group', 'Buying Group'), values: [], options: buyingGroupsForScope([], [], []) })}
      <label>${esc(T('Yönetici', 'Manager'))}${selectHtml('name="managerId" required', managers, managerId || '', T('Yönetici seçin', 'Select manager'))}</label>
      ${store.authMode === 'local' ? `<label>${esc(T('Parola', 'Password'))}<input name="password" type="password" autocomplete="new-password" minlength="${store.passwordMinLength}" placeholder="${esc(T(`En az ${store.passwordMinLength} karakter`, `At least ${store.passwordMinLength} characters`))}"></label>
        <p class="umNote">${esc(T('Boş bırakırsanız güvenli bir başlangıç parolası üretilir ve size gösterilir.', 'If left blank a secure initial password is generated and shown to you.'))}</p>` : ''}
      <label>${esc(T('Durum', 'Status'))}${selectHtml('name="status"', [{ value: 'ACTIVE', label: statusLabel('ACTIVE') }, { value: 'INACTIVE', label: statusLabel('INACTIVE') }], 'ACTIVE')}</label>
      ${store.canCopyProfiles ? `<label>${esc(T('Mevcut Kullanıcıdan Ayarları Kopyala · isteğe bağlı', 'Copy Settings from Existing User · optional'))}${selectHtml('name="copySourceUserId"', store.users.map(item => ({ value: item.id, label: `${userName(item)} — ${roleLabel(item.systemRole)}` })), '', T('Rolün standart şablonunu kullan', 'Use the role standard template'))}</label><p class="umNote">${esc(T('Kaynak seçilmezse kullanıcının rolüne ait Standard Workspace fallback olarak uygulanır. Kaynak seçilirse Horizon, filtreler, kolon/görünüm ve kişisel yetkiler snapshot olarak kopyalanır; organizasyon kopyalanmaz.', 'If no source is selected, the role’s Standard Workspace is used as a fallback. If a source is selected, Horizon, filters, column/view settings and personal permissions are copied as a snapshot; organization is not copied.'))}</p>` : ''}
    `, {
      confirmLabel: T('Kullanıcıyı Oluştur', 'Create User'),
      onSubmit: async (data, form) => {
        const systemRole = data.get('systemRole');
        const body = {
          displayName: clean(data.get('displayName')),
          // v7.39 — kullanıcı adı artık kendi alanı; boş bırakılırsa eski davranış (ad soyad).
          username: clean(data.get('username')) || clean(data.get('displayName')),
          email: clean(data.get('email')), title: roleLabel(systemRole),
          systemRole, orgLevel: ROLE_ORG_LEVEL[systemRole] || 'job_title',
          managerId: clean(data.get('managerId')) || null,
          mags: data.getAll('mag').map(clean).filter(Boolean),
          mmygs: data.getAll('mmyg').map(clean).filter(Boolean),
          buyingGroups: data.getAll('buyingGroup').map(clean).filter(Boolean),
          status: data.get('status'),
          dataScope: { mode: { buyer: 'SELF', manager: 'MMYG', senior_manager: 'MAG', moderator: 'ALL' }[systemRole] || 'SELF' },
          reason: T('Yeni kullanıcı oluşturuldu.', 'New user created.'),
          confirmCritical: systemRole === 'moderator',
        };
        const password = clean(data.get('password'));
        if (password) body.password = password;
        if (form.dataset.stableIds) body.stableIds = JSON.parse(form.dataset.stableIds);
        let result;
        try { result = await send('/api/users', 'POST', body); }
        catch (error) {
          if (error.code === 'IDENTITY_EXISTS' && error.existingUserId) {
            closeDialog();
            toast(T(`${body.displayName} zaten Buyer Log kullanıcısıdır.`, `${body.displayName} is already a Buyer Log user.`));
            await reload({ silent: true });
            showUser(error.existingUserId);
            return;
          }
          throw error;
        }
        store.revision = Number(result.revision) || store.revision;
        const copySourceUserId = clean(data.get('copySourceUserId')); let copyWarning = '';
        if (copySourceUserId && result.user && result.user.id) try { await send('/api/iam/profile-copy', 'POST', { sourceUserId: copySourceUserId, targetUserIds: [result.user.id], mode: 'MERGE', categories: { userPermissions: true, workspace: { horizon: true, filters: true, columns: true, views: true, dashboard: true, favorites: true }, organization: {} }, reason: T('Yeni kullanıcı başlangıç profili.', 'New user starter profile.') }); } catch (error) { copyWarning = error.message || String(error); }
        closeDialog();
        if (result.temporaryPassword) {
          alert(`${T('Başlangıç parolası', 'Initial password')}: ${result.temporaryPassword}`);
        }
        toast(T(`${body.displayName} oluşturuldu.`, `${body.displayName} was created.`));
        if (copyWarning) toast(`${T('Kullanıcı oluşturuldu; profil kopyalanamadı', 'User created; profile could not be copied')}: ${copyWarning}`);
        await reload({ silent: true });
        showUser(result.user && result.user.id);
      },
    });
    applyDirectoryCandidate('');
  }

  /* ===================== 14 · İşlemler ===================== */

  function showUser(id) {
    if (!id) return;
    store.section = 'users';
    store.detailId = id;
    store.detailTab = 'summary';
    store.horizonConnectionId = '';
    store.statusFilter = 'all';
    render();
  }

  async function mutate(work, { successMessage, rollback } = {}) {
    try {
      await work();
      await reload({ silent: true });
      if (successMessage) toast(successMessage);
      return true;
    } catch (error) {
      if (typeof rollback === 'function') rollback();
      if (store.centralIam.enabled) {
        const status = shell && shell.querySelector('[data-um-iam-status]');
        if (status) status.outerHTML = centralStatusHtml();
      } else render();
      toast(error.message || T('İşlem tamamlanamadı.', 'The operation could not be completed.'));
      if (error.code === 'REVISION_CONFLICT' && !store.centralIam.enabled) await reload({ silent: true });
      return false;
    }
  }

  function saveUser(id, patch) { return send(`/api/users/${encodeURIComponent(id)}`, 'PUT', patch); }

  // Organizasyon seviyesi asla DÜŞÜRÜLMEZ: mevcut kayıtlarda seviye rolden bağımsız
  // olabiliyor ve düşürmek o kullanıcının altındaki bağlantıları geçersiz kılabilir.
  function orgLevelFor(user, systemRole) {
    const derived = ROLE_ORG_LEVEL[systemRole] || 'job_title';
    const current = user && user.orgLevel;
    return (ORG_LEVEL_RANK[current] || 0) > (ORG_LEVEL_RANK[derived] || 0) ? current : derived;
  }

  function setStatus(id, status) {
    const user = userById(id);
    if (!user) return;
    const name = userName(user);
    if (status === 'INACTIVE') {
      const reports = childrenOf(id);
      if (reports.length) {
        toast(T(`${name} pasife alınmadan önce bağlı kullanıcılar başka bir yöneticiye atanmalıdır.`, `Before deactivating ${name}, its reports must be assigned to another manager.`));
        return;
      }
      openDialog(T('Kullanıcıyı Pasife Al', 'Deactivate User'),
        `<p class="umConfirmText">${esc(T(`${name} kullanıcısı pasife alınsın mı?`, `Deactivate the user ${name}?`))}</p>
         <p class="umNote">${esc(T('Kullanıcı silinmez; İnaktif sekmesinde kalır ve istediğiniz zaman yeniden aktifleştirilebilir.', 'The user is not deleted; they stay in the Inactive tab and can be reactivated at any time.'))}</p>`,
        { confirmLabel: T('Pasife Al', 'Deactivate'), danger: true, onSubmit: async () => {
          const ok = await mutate(() => saveUser(id, { status: 'INACTIVE', confirmCritical: true, reason: T('Kullanıcı pasife alındı.', 'User deactivated.') }), { successMessage: T(`${name} pasife alındı.`, `${name} was deactivated.`) });
          if (ok) closeDialog();
        } });
      return;
    }
    const needsPassword = store.authMode === 'local' && !user.hasPassword;
    openDialog(T('Kullanıcıyı Aktifleştir', 'Activate User'),
      `<p class="umConfirmText">${esc(T(`${name} kullanıcısı aktifleştirilsin mi?`, `Activate the user ${name}?`))}</p>
       ${needsPassword ? `<label>${esc(T('Parola', 'Password'))}<input name="password" type="password" required minlength="${store.passwordMinLength}" autocomplete="new-password" placeholder="${esc(T(`En az ${store.passwordMinLength} karakter`, `At least ${store.passwordMinLength} characters`))}"></label>
         <p class="umNote">${esc(T('Bu kullanıcının parolası yok; aktifleştirmek için bir parola belirleyin.', 'This user has no password; set one to activate the account.'))}</p>` : ''}`,
      { confirmLabel: T('Aktifleştir', 'Activate'), onSubmit: async data => {
        const patch = { status: 'ACTIVE', confirmCritical: true, reason: T('Kullanıcı aktifleştirildi.', 'User activated.') };
        const password = clean(data.get('password'));
        if (password) patch.password = password;
        const ok = await mutate(() => saveUser(id, patch), { successMessage: T(`${name} aktifleştirildi.`, `${name} was activated.`) });
        if (ok) closeDialog();
      } });
  }

  function openPasswordDialog(id) {
    const user = userById(id);
    if (!user) return;
    openDialog(user.hasPassword ? T('Parolayı Sıfırla', 'Reset Password') : T('Parola Belirle', 'Set Password'),
      `<p class="umConfirmText">${esc(userName(user))}</p>
       <label>${esc(T('Yeni Parola', 'New Password'))}<input name="password" type="password" required minlength="${store.passwordMinLength}" autocomplete="new-password"></label>
       <label>${esc(T('Yeni Parola Tekrar', 'Repeat New Password'))}<input name="confirm" type="password" required minlength="${store.passwordMinLength}" autocomplete="new-password"></label>
       <p class="umNote">${esc(T(`Parola en az ${store.passwordMinLength} karakter olmalıdır. Parola şifrelenerek saklanır, hiçbir yerde açık metin tutulmaz.`, `The password must be at least ${store.passwordMinLength} characters. It is stored hashed and never kept in plain text.`))}</p>`,
      { confirmLabel: T('Kaydet', 'Save'), onSubmit: async data => {
        const password = clean(data.get('password'));
        if (password !== clean(data.get('confirm'))) throw new Error(T('Parolalar birbiriyle uyuşmuyor.', 'The passwords do not match.'));
        const ok = await mutate(() => saveUser(id, { password, confirmCritical: true, reason: T('Parola güncellendi.', 'Password updated.') }), { successMessage: T('Parola güncellendi.', 'The password was updated.') });
        if (ok) closeDialog();
      } });
  }

  function openBulkManagerDialog() {
    const ids = [...store.selectedIds];
    const blocked = new Set(ids.flatMap(id => [...descendantIds(id), id]));
    const managers = store.users.filter(item => item.status === 'ACTIVE' && !blocked.has(item.id)).map(item => ({ value: item.id, label: managerOptionLabel(item) }));
    openDialog(T('Yönetici Ata', 'Assign Manager'),
      `<p class="umConfirmText">${esc(T(`${ids.length} kullanıcı için yönetici seçin.`, `Choose a manager for ${ids.length} users.`))}</p>
       <label>${esc(T('Yönetici', 'Manager'))}${selectHtml('name="managerId" required', managers, '', T('Yönetici seçin', 'Select manager'))}</label>`,
      { confirmLabel: T('Ata', 'Assign'), onSubmit: async data => {
        const managerId = clean(data.get('managerId'));
        await saveBulk(ids, { managerId, reason: T('Toplu yönetici ataması.', 'Bulk manager assignment.') });
        closeDialog();
      } });
  }

  function openBulkScopeDialog() {
    const ids = [...store.selectedIds];
    openDialog(T('MAG / MMYG Değiştir', 'Change MAG / MMYG'),
      `<p class="umConfirmText">${esc(T(`${ids.length} kullanıcı güncellenecek.`, `${ids.length} users will be updated.`))}</p>
       <label>MAG${selectHtml('name="mag" data-um-dialogmag', allMags(), '', T('Değiştirme', 'Leave unchanged'))}</label>
       <label>MMYG${selectHtml('name="mmyg" data-um-dialogmmyg', mmygsForMag(''), '', T('Değiştirme', 'Leave unchanged'))}</label>`,
      { confirmLabel: T('Uygula', 'Apply'), onSubmit: async data => {
        const mag = clean(data.get('mag')), mmyg = clean(data.get('mmyg'));
        if (!mag && !mmyg) throw new Error(T('En az bir alan seçin.', 'Choose at least one field.'));
        const patch = { reason: T('Toplu MAG/MMYG güncellemesi.', 'Bulk MAG/MMYG update.') };
        if (mag) patch.mags = [mag];
        if (mmyg) patch.mmygs = [mmyg];
        await saveBulk(ids, patch);
        closeDialog();
      } });
  }

  // Toplu işlemlerde her yazma sunucunun revizyonunu ilerletir; bu yüzden
  // istekler SIRAYLA gönderilir ve her adımdan sonra revizyon güncellenir.
  async function runSequential(ids, work) {
    const failures = [];
    for (const id of ids) {
      try { const result = await work(id); if (result && result.revision) store.revision = Number(result.revision); }
      catch (error) { failures.push(`${nameOf(id) || id}: ${error.message}`); }
    }
    await reload({ silent: true });
    if (failures.length) toast(`${T('Bazı kullanıcılar güncellenemedi', 'Some users could not be updated')}: ${failures.join(' · ')}`);
    else toast(T(`${ids.length} kullanıcı güncellendi.`, `${ids.length} users were updated.`));
  }
  async function saveBulk(ids, patch) {
    if (!store.centralIam.enabled) return runSequential(ids, id => saveUser(id, patch));
    await send('/api/iam/users/bulk', 'POST', { changes: ids.map(id => ({ id, patch })), confirmCritical: true, reason: patch.reason });
    await reload({ silent: true });
  }

  async function openCopyPreview() {
    const templateMode = store.copy.sourceType === 'template';
    const source = templateMode ? null : userById(store.copy.sourceId);
    const sourceTemplate = templateMode ? store.workspaceTemplates[store.copy.templateRole] : null;
    const targets = [...store.copy.targetIds].map(userById).filter(Boolean);
    if ((!source && !(sourceTemplate && sourceTemplate.entryCount)) || !targets.length) return;
    const sourceName = templateMode ? `Standard ${roleLabel(store.copy.templateRole)}` : userName(source);
    const codes = source ? (source.directPermissions || []).map(item => item.permission) : [];
    const replace = store.copy.mode === 'REPLACE';
    const categories = JSON.parse(JSON.stringify(store.copy.categories));
    if (templateMode) { categories.userPermissions = false; categories.organization = {}; }
    const selected = [...(categories.userPermissions ? [T('Kullanıcıya Özel Yetkiler', 'User-specific Permissions')] : []), ...Object.entries(categories.workspace).filter(([,v])=>v).map(([key])=>key), ...Object.entries(categories.organization).filter(([,v])=>v).map(([key])=>key)];
    if (!selected.length) { toast(T('Kopyalanacak en az bir kategori seçin.', 'Select at least one category to copy.')); return; }
    const request = { ...(templateMode ? { sourceTemplateRole: store.copy.templateRole } : { sourceUserId: source.id }), targetUserIds: targets.map(item => item.id), categories, mode: store.copy.mode, reason: T(`${sourceName} profil snapshot’ı`, `Profile snapshot from ${sourceName}`) };
    let serverPreview; try { serverPreview = await send('/api/iam/profile-copy/preview', 'POST', request); } catch (error) { toast(error.message); return; }
    openDialog(T('Profil Kopyalama Önizlemesi', 'Profile Copy Preview'), `
      <p class="umConfirmText"><b>${esc(T('Kaynak', 'Source'))}:</b> ${esc(sourceName)}</p>
      <h4 class="umSubHead">${esc(T('Hedef Kullanıcılar', 'Target Users'))}</h4>
      <ul class="umPreviewList">${(serverPreview.targets||[]).map(item=>`<li>${esc(item.targetName)} ${item.status==='FAILED'?`— ${esc(item.reason)}`:'✓'}</li>`).join('')}</ul>
      <h4 class="umSubHead">${esc(T('Kopyalanacaklar', 'Will Be Copied'))}</h4><ul class="umPreviewList">${selected.map(label=>`<li>✓ ${esc(label)}</li>`).join('')}</ul>
      ${categories.userPermissions?`<p class="umNote">${esc(T(`${codes.length} kişisel yetki dahil; rol yetkileri kopyalanmaz.`, `${codes.length} personal permissions included; role permissions are not copied.`))}</p>`:''}
      <p class="${replace ? 'umWarn' : 'umNote'}">${esc(replace
        ? T('REPLACE risklidir: yalnız seçilen kategoriler kaynak snapshot’ıyla değiştirilecek.', 'REPLACE is risky: only selected categories will be replaced by the source snapshot.')
        : T('MERGE hedefin mevcut ayarlarını korur ve ilgili anahtarları uygular.', 'MERGE retains existing settings and applies matching keys.'))}</p>
      <label>${esc(T('Gerekçe', 'Reason'))}<input name="reason" required value="${esc(request.reason)}"></label>
    `, {
      confirmLabel: T('Uygula', 'Apply'), danger: replace,
      onSubmit: async data => {
        if(replace&&!confirm(T('REPLACE işlemini onaylıyor musunuz?', 'Confirm REPLACE?')))return;
        const result=await send('/api/iam/profile-copy','POST',{...request,reason:clean(data.get('reason'))});store.copy.targetIds.clear();await reload({silent:true});
        const rows=(result.results||[]).map(item=>`<li><b>${esc(item.targetName)}</b> — ${esc(item.status==='SUCCESS'?T('Başarılı','Successful'):T('Başarısız','Failed'))}${item.reason?` · ${esc(item.reason)}`:''}</li>`).join('');
        openDialog(T('Profil Kopyalama Tamamlandı','Profile Copy Completed'),`<p class="umConfirmText">${esc(`${result.success||0} ${T('başarılı','successful')} · ${result.failed||0} ${T('başarısız','failed')}`)}</p><ul class="umPreviewList">${rows}</ul>`,{confirmLabel:T('Kapat','Close'),cancelLabel:T('Kapat','Close'),onSubmit:async()=>closeDialog()});
      },
    });
  }

  function openTemplateSaveDialog() {
    const roleId = store.template.roleId, source = userById(store.template.sourceId);
    const categories = Object.entries(store.template.categories).filter(([, enabled]) => enabled).map(([name]) => name);
    if (!source || !categories.length) { toast(T('Kaynak kullanıcı ve en az bir kategori seçin.', 'Select a source user and at least one category.')); return; }
    openDialog(T('Standart Workspace Şablonunu Kaydet', 'Save Standard Workspace Template'), `<p class="umConfirmText"><b>${esc(`Standard ${roleLabel(roleId)}`)}</b> ← ${esc(userName(source))}</p><ul class="umPreviewList">${categories.map(item=>`<li>✓ ${esc(item)}</li>`).join('')}</ul><p class="umNote">${esc(T('Kaynak kullanıcının seçili etkin workspace ayarları snapshot olarak kaydedilecek. Yetki, parola ve organizasyon bilgileri alınmayacak.', 'The source user’s selected effective workspace preferences will be saved as a snapshot. Permissions, passwords and organization data are excluded.'))}</p><label>${esc(T('Gerekçe', 'Reason'))}<input name="reason" required value="${esc(`Standard ${roleLabel(roleId)} workspace template`)}"></label>`, { confirmLabel: T('Kaydet', 'Save'), onSubmit: async data => { const result = await send(`/api/iam/workspace-templates/${encodeURIComponent(roleId)}`, 'PUT', { sourceUserId: source.id, categories, reason: clean(data.get('reason')), confirmCritical: true }); store.revision = Number(result.revision) || store.revision; closeDialog(); await reload({ silent: true }); toast(T('Workspace şablonu kaydedildi.', 'Workspace template was saved.')); } });
  }
  function openTemplateResetDialog() {
    const roleId = store.template.roleId;
    openDialog(T('Workspace Şablonunu Sıfırla', 'Reset Workspace Template'), `<p class="umWarn">${esc(T(`Standard ${roleLabel(roleId)} şablonu kaldırılacak. Kişisel kullanıcı ayarları etkilenmeyecek.`, `The Standard ${roleLabel(roleId)} template will be removed. Personal user preferences will not be affected.`))}</p><label>${esc(T('Gerekçe', 'Reason'))}<input name="reason" required></label>`, { confirmLabel: T('Sıfırla', 'Reset'), danger: true, onSubmit: async data => { const result = await send(`/api/iam/workspace-templates/${encodeURIComponent(roleId)}`, 'DELETE', { reason: clean(data.get('reason')), confirmCritical: true }); store.revision = Number(result.revision) || store.revision; closeDialog(); await reload({ silent: true }); toast(T('Workspace şablonu sıfırlandı.', 'Workspace template was reset.')); } });
  }

  function roleDiffSummary() {
    const lines = [];
    for (const roleId of ROLE_ORDER) {
      const before = new Set((store.roleDefinitions[roleId] || {}).permissions || []);
      const after = new Set((store.roleDraft[roleId] || {}).permissions || []);
      const added = [...after].filter(code => !before.has(code));
      const removed = [...before].filter(code => !after.has(code));
      const scopeBefore = (store.roleDefinitions[roleId] || {}).defaultDataScope;
      const scopeAfter = (store.roleDraft[roleId] || {}).defaultDataScope;
      const parts = [];
      if (added.length) parts.push(`${T('eklenen', 'added')}: ${added.map(permissionText).join(', ')}`);
      if (removed.length) parts.push(`${T('kaldırılan', 'removed')}: ${removed.map(permissionText).join(', ')}`);
      if (scopeBefore !== scopeAfter) parts.push(`${T('veri kapsamı', 'data scope')}: ${scopeLabel(scopeAfter)}`);
      if (parts.length) lines.push(`${roleLabel(roleId)} — ${parts.join(' · ')}`);
    }
    return lines;
  }

  function openRoleSaveDialog() {
    const lines = roleDiffSummary();
    if (!lines.length) { store.roleDirty = false; render(); return; }
    openDialog(T('Rol Yetkilerini Kaydet', 'Save Role Permissions'), `
      <ul class="umPreviewList">${lines.map(line => `<li>${esc(line)}</li>`).join('')}</ul>
      <label>${esc(T('Gerekçe', 'Reason'))}<input name="reason" required value="${esc(lines.join(' | ').slice(0, 200))}"></label>
    `, {
      confirmLabel: T('Kaydet', 'Save'),
      onSubmit: async data => {
        const ok = await mutate(async () => {
          const result = await send('/api/iam/roles', 'PUT', { roles: store.roleDraft, reason: clean(data.get('reason')), confirmCritical: true });
          store.revision = Number(result.revision) || store.revision;
          store.roleDirty = false;
        }, { successMessage: T('Rol yetkileri kaydedildi.', 'Role permissions were saved.') });
        if (ok) closeDialog();
      },
    });
  }

  /* ===================== 15 · Olaylar ===================== */

  let focusTarget = null;
  function restoreFocus() {
    if (!focusTarget || !shell) return;
    const node = shell.querySelector(focusTarget.selector);
    if (node) { node.focus(); if (node.setSelectionRange && node.type === 'search') { try { node.setSelectionRange(node.value.length, node.value.length); } catch (_) {} } }
    focusTarget = null;
  }

  function onClick(event) {
    const trigger = event.target.closest('[data-act]');
    if (!trigger || !shell.contains(trigger)) return;
    const act = trigger.dataset.act, id = trigger.dataset.id;
    // Satıra tıklamak detayı açar, ancak satır içindeki düğmeler kendi işini yapar.
    if (act === 'openDetail' && event.target.closest('button, input, a')) return;

    switch (act) {
      case 'close': close(); return;
      case 'retry': reload(); return;
      case 'iamRefresh': void refreshDirectory(); return;
      case 'iamInitialize': void initializeDirectory(); return;
      case 'section':
        if (store.roleDirty && store.section === 'roles' && id !== 'roles' && !confirm(T('Rol yetkilerinde kaydedilmemiş değişiklikler var. Bırakılsın mı?', 'Role permissions have unsaved changes. Discard them?'))) return;
        if (id !== 'roles') { store.roleDirty = false; store.roleDraft = JSON.parse(JSON.stringify(store.roleDefinitions)); }
        store.section = id; render(); return;
      case 'statusFilter': store.statusFilter = id; store.selectedIds.clear(); render(); return;
      case 'toggleFilters': store.filtersOpen = !store.filtersOpen; render(); return;
      case 'clearFilters': store.filters = { role: '', mag: '', mmyg: '', managerId: '' }; store.search = ''; render(); return;
      case 'clearSelection': store.selectedIds.clear(); render(); return;
      case 'newUser': openCreateDialog(''); return;
      case 'newUserUnder': openCreateDialog(id); return;
      case 'openDetail': store.detailId = id; store.detailTab = 'summary'; render(); return;
      case 'openEdit': store.section = 'users'; store.detailId = id; store.detailTab = 'edit'; render(); return;
      case 'closeDetail': store.detailId = null; render(); return;
      case 'detailTab':
        store.detailTab = id; render();
        if (id === 'horizon') {
          if (!store.modelConnections.loaded) void loadHorizonConnections();
        }
        return;
      case 'chipAdd': {
        /* Elle giriş. Katalogda olmayan bir değer de eklenebilir — talebin
           açık parçası buydu ("manuel el ile girişe de açık olsun"). */
        const field = trigger.closest('[data-um-chipfield]');
        const input = field && field.querySelector('[data-um-chipnew]');
        if (!input) return;
        if (chipAdd(field, input.value)) { input.value = ''; refreshScopeChoices(field.closest('form')); }
        else input.value = '';
        return;
      }
      case 'chipRemove': {
        const chip = trigger.closest('[data-um-chip]');
        const field = trigger.closest('[data-um-chipfield]');
        const holder = field && field.querySelector('[data-um-chiplist]');
        chip?.remove();
        if (holder && !holder.querySelector('[data-um-chip]')) {
          holder.innerHTML = `<span class="umChipEmpty">${esc(T('Seçilmedi', 'Not set'))}</span>`;
        }
        refreshScopeChoices(field ? field.closest('form') : null);
        return;
      }
      /* v7.81: 'horizonApply' ve 'horizonCreatePreset' KALDIRILDI — ön ayar
         kavramı yok. Geriye yöneticinin anlamlı tek eylemi kaldı: kullanıcıyı
         ortak filtreye döndürmek. */
      case 'horizonReset':
        if (!confirm(T('Bu kullanıcının kişisel ufku silinsin ve Veri Yönetimi’ndeki ortak filtreye dönülsün mü?', 'Remove this user’s personal horizon and return to the shared filter from Data Management?'))) return;
        mutate(() => api(`/api/iam/users/${encodeURIComponent(id)}/horizon/reset`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ module: store.horizonModule }),
        }), { successMessage: T('Kişisel ufuk sıfırlandı.', 'The personal horizon was reset.') });
        return;
      case 'activate': setStatus(id, 'ACTIVE'); return;
      case 'deactivate': setStatus(id, 'INACTIVE'); return;
      case 'password': openPasswordDialog(id); return;
      case 'copyFrom': store.section = 'copy'; store.copy.sourceType = 'user'; store.copy.sourceId = id; store.copy.targetIds.clear(); render(); return;
      case 'openExisting': closeDialog(); showUser(id); return;
      case 'bulkActivate': bulkStatus('ACTIVE'); return;
      case 'bulkDeactivate': bulkStatus('INACTIVE'); return;
      case 'bulkManager': openBulkManagerDialog(); return;
      case 'refreshScopeCatalog': void refreshScopeCatalog(trigger); return;
      case 'bulkScope': openBulkScopeDialog(); return;
      case 'bulkCopy': store.section = 'copy'; store.copy.targetIds = new Set(store.selectedIds); render(); return;
      case 'roleTab': store.roleTab = id; render(); return;
      case 'templateRole': store.template.roleId = id; render(); return;
      case 'saveTemplate': openTemplateSaveDialog(); return;
      case 'resetTemplate': openTemplateResetDialog(); return;
      case 'copySourceType': store.copy.sourceType = id === 'template' ? 'template' : 'user'; if (store.copy.sourceType === 'template') { store.copy.categories.userPermissions = false; Object.keys(store.copy.categories.organization).forEach(key => { store.copy.categories.organization[key] = false; }); if (!(store.workspaceTemplates[store.copy.templateRole] || {}).entryCount) store.copy.templateRole = ROLE_ORDER.find(role => (store.workspaceTemplates[role] || {}).entryCount) || 'buyer'; } render(); return;
      case 'toggleCategory':
        if (store.collapsedCategories.has(id)) store.collapsedCategories.delete(id); else store.collapsedCategories.add(id);
        render(); return;
      case 'toggleColumn': toggleColumn(id); return;
      case 'saveRoles': openRoleSaveDialog(); return;
      case 'discardRoles': store.roleDraft = JSON.parse(JSON.stringify(store.roleDefinitions)); store.roleDirty = false; render(); return;
      case 'orgSelect': store.orgSelectedId = id; render(); return;
      case 'copyPreview': openCopyPreview(); return;
      default: return;
    }
  }

  function bulkStatus(status) {
    const ids = [...store.selectedIds].filter(id => {
      const user = userById(id);
      return user && user.status !== status && !statusLocked(user);
    });
    if (!ids.length) return;
    const activating = status === 'ACTIVE';
    openDialog(activating ? T('Kullanıcıları Aktifleştir', 'Activate Users') : T('Kullanıcıları Pasife Al', 'Deactivate Users'),
      `<p class="umConfirmText">${esc(T(`${ids.length} kullanıcı ${activating ? 'aktifleştirilsin' : 'pasife alınsın'} mı?`, `${activating ? 'Activate' : 'Deactivate'} ${ids.length} users?`))}</p>
       <ul class="umPreviewList">${ids.map(id => `<li>${esc(nameOf(id))}</li>`).join('')}</ul>`,
      { confirmLabel: activating ? T('Aktifleştir', 'Activate') : T('Pasife Al', 'Deactivate'), danger: !activating, onSubmit: async () => {
        await saveBulk(ids, { status, reason: activating ? T('Toplu aktifleştirme.', 'Bulk activation.') : T('Toplu pasife alma.', 'Bulk deactivation.') });
        store.selectedIds.clear();
        closeDialog();
      } });
  }

  function toggleColumn(action) {
    const draft = store.roleDraft[store.roleTab];
    if (!draft) return;
    const codes = Object.entries(store.resources)
      .filter(([, meta]) => (meta.actions || []).includes(action))
      .map(([resource]) => `${resource}.${action}`);
    const permissions = new Set(draft.permissions || []);
    const allOn = codes.every(code => permissions.has(code));
    for (const code of codes) { if (allOn) permissions.delete(code); else permissions.add(code); }
    draft.permissions = [...permissions];
    store.roleDirty = true;
    render();
  }

  function onInput(event) {
    const search = event.target.closest('[data-um-search]');
    if (search) { store.search = search.value; store.selectedIds.clear(); focusTarget = { selector: '[data-um-search]' }; render(); return; }
    const permSearch = event.target.closest('[data-um-permsearch]');
    if (permSearch) { store.permissionSearch = permSearch.value; focusTarget = { selector: '[data-um-permsearch]' }; render(); return; }
    const historySearch = event.target.closest('[data-um-historysearch]');
    if (historySearch) { store.historyQuery = historySearch.value; focusTarget = { selector: '[data-um-historysearch]' }; render(); return; }
    const copySearch = event.target.closest('[data-um-copysearch]');
    if (copySearch) { store.copySearch = copySearch.value; focusTarget = { selector: '[data-um-copysearch]' }; render(); return; }
    const copySourceSearch = event.target.closest('[data-um-copysourcesearch]');
    if (copySourceSearch) { store.copySourceSearch = copySourceSearch.value; focusTarget = { selector: '[data-um-copysourcesearch]' }; render(); return; }
    const templateSearch = event.target.closest('[data-um-templatesearch]');
    if (templateSearch) { store.template.search = templateSearch.value; focusTarget = { selector: '[data-um-templatesearch]' }; render(); return; }
  }

  function onChange(event) {
    const filter = event.target.closest('[data-um-filter]');
    if (filter) {
      store.filters[filter.dataset.umFilter] = filter.value;
      if (filter.dataset.umFilter === 'mag') store.filters.mmyg = '';
      store.selectedIds.clear(); render(); return;
    }
    const selectAll = event.target.closest('[data-act="selectAll"]');
    if (selectAll) {
      const rows = visibleUsers();
      if (selectAll.checked) rows.forEach(user => store.selectedIds.add(user.id));
      else rows.forEach(user => store.selectedIds.delete(user.id));
      render(); return;
    }
    const selectRow = event.target.closest('[data-act="selectRow"]');
    if (selectRow) {
      if (selectRow.checked) store.selectedIds.add(selectRow.dataset.id); else store.selectedIds.delete(selectRow.dataset.id);
      render(); return;
    }
    const roleCell = event.target.closest('[data-um-rolecell]');
    if (roleCell) {
      const draft = store.roleDraft[store.roleTab];
      const permissions = new Set(draft.permissions || []);
      if (roleCell.checked) permissions.add(roleCell.dataset.umRolecell); else permissions.delete(roleCell.dataset.umRolecell);
      draft.permissions = [...permissions];
      store.roleDirty = true;
      updateRoleFooter(); return;
    }
    const roleScope = event.target.closest('[data-um-rolescope]');
    if (roleScope) { store.roleDraft[store.roleTab].defaultDataScope = roleScope.value; store.roleDirty = true; updateRoleFooter(); return; }
    // v7.37 — listeden seçim: çip eklenir, aşağıdaki listeler daralır.
    const chipPick = event.target.closest('[data-um-chippick]');
    if (chipPick) {
      const field = chipPick.closest('[data-um-chipfield]');
      if (clean(chipPick.value)) chipAdd(field, chipPick.value);
      chipPick.value = '';
      refreshScopeChoices(field ? field.closest('form') : null);
      return;
    }
    const horizonModule = event.target.closest('[data-um-horizonmodule]');
    if (horizonModule) { store.horizonModule = horizonModule.value; store.horizonConnectionId = ''; render(); return; }
    const horizonConnection = event.target.closest('[data-um-horizonconnection]');
    if (horizonConnection) { store.horizonConnectionId = horizonConnection.value; return; }
    const copySource = event.target.closest('[data-um-copysource]');
    if (copySource) { store.copy.sourceId = copySource.value; store.copy.targetIds.delete(copySource.value); render(); return; }
    const copyTemplate = event.target.closest('[data-um-copytemplate]');
    if (copyTemplate) { store.copy.templateRole = copyTemplate.value; render(); return; }
    const templateSource = event.target.closest('[data-um-templatesource]');
    if (templateSource) { store.template.sourceId = templateSource.value; render(); return; }
    const templateCategory = event.target.closest('[data-um-templatecat]');
    if (templateCategory) { store.template.categories[templateCategory.dataset.umTemplatecat] = templateCategory.checked; return; }
    const copyTarget = event.target.closest('[data-um-copytarget]');
    if (copyTarget) {
      if (copyTarget.checked) store.copy.targetIds.add(copyTarget.dataset.umCopytarget); else store.copy.targetIds.delete(copyTarget.dataset.umCopytarget);
      const button = shell.querySelector('[data-act="copyPreview"]');
      const sourceReady = store.copy.sourceType === 'template' ? Boolean((store.workspaceTemplates[store.copy.templateRole] || {}).entryCount) : Boolean(userById(store.copy.sourceId));
      if (button) button.disabled = !(store.copy.targetIds.size && sourceReady);
      return;
    }
    const copyMode = event.target.closest('[data-um-copymode]');
    if (copyMode && copyMode.checked) { store.copy.mode = copyMode.dataset.umCopymode; return; }
    const copyCategory = event.target.closest('[data-um-copycat]'); if (copyCategory) { store.copy.categories[copyCategory.dataset.umCopycat] = copyCategory.checked; return; }
    const copyWorkspace = event.target.closest('[data-um-copyworkspace]'); if (copyWorkspace) { store.copy.categories.workspace[copyWorkspace.dataset.umCopyworkspace] = copyWorkspace.checked; return; }
    const copyOrganization = event.target.closest('[data-um-copyorg]'); if (copyOrganization) { store.copy.categories.organization[copyOrganization.dataset.umCopyorg] = copyOrganization.checked; return; }
  }

  // Matris çizimini her tıklamada baştan kurmak seçim ve kaydırmayı sıfırlardı;
  // yalnız alt şerit ile uyarı satırı tazelenir.
  function updateRoleFooter() {
    const footer = shell.querySelector('.umMatrixFooter');
    if (footer) footer.querySelectorAll('button').forEach(button => { button.disabled = !store.roleDirty; });
    let warn = shell.querySelector('.umUnsaved');
    if (store.roleDirty && !warn) {
      warn = document.createElement('p'); warn.className = 'umUnsaved';
      warn.textContent = T('Kaydedilmemiş değişiklikler var.', 'There are unsaved changes.');
      const wrap = shell.querySelector('.umMatrixWrap');
      if (wrap) wrap.before(warn);
    } else if (!store.roleDirty && warn) warn.remove();
  }

  function onSubmit(event) {
    const form = event.target.closest('[data-um-form]');
    if (!form) return;
    event.preventDefault();
    const kind = form.dataset.umForm, id = form.dataset.id, data = new FormData(form);
    if (kind === 'profile') {
      const user = userById(id);
      const systemRole = data.get('systemRole') || (user && user.systemRole);
      const patch = {
        displayName: clean(data.get('displayName')),
        /* v7.39 — kullanıcı adı gönderilir. BOŞSA HİÇ GÖNDERİLMEZ: sunucu boş
           adı reddediyor ve tüm kaydetme işlemi hataya düşerdi; kullanıcının
           adı değişmesin diye alan tamamen atlanır. */
        ...(clean(data.get('username')) ? { username: clean(data.get('username')) } : {}),
        email: clean(data.get('email')),
        mags: data.getAll('mag').map(clean).filter(Boolean),
        mmygs: data.getAll('mmyg').map(clean).filter(Boolean),
        buyingGroups: data.getAll('buyingGroup').map(clean).filter(Boolean),
        reason: T('Kullanıcı bilgileri güncellendi.', 'User details updated.'),
      };
      // v7.25 — Moderatörün de yöneticisi olabilir; yönetici alanı role bakılmaksızın yazılır.
      patch.managerId = clean(data.get('managerId')) || null;
      if (id !== 'moderator') {
        patch.systemRole = systemRole;
        patch.orgLevel = orgLevelFor(user, systemRole);
        patch.dataScope = Object.assign({}, user && user.dataScope, { mode: data.get('scopeMode') });
        if (systemRole === 'moderator') patch.confirmCritical = true;
        if (store.centralIam.enabled && user && user.systemRole === 'moderator' && systemRole !== 'moderator') {
          if (!confirm(T('Bu kullanıcının yönetici yetkileri kaldırılsın mı?', 'Remove this user’s administrator privileges?'))) return;
          patch.confirmCritical = true;
        }
      }
      mutate(() => saveUser(id, patch), { successMessage: T('Kullanıcı kaydedildi.', 'The user was saved.') })
        .then(ok => { if (ok) { store.detailTab = 'summary'; render(); } });
      return;
    }
    if (kind === 'grants') {
      const codes = [...form.querySelectorAll('input[name="permission"]:checked')].map(input => input.value);
      mutate(() => saveUser(id, { permissionCodes: codes, reason: T('Kişisel yetkiler güncellendi.', 'Personal permissions updated.') }),
        { successMessage: T('Kişisel yetkiler kaydedildi.', 'Personal permissions were saved.') });
      return;
    }
    if (kind === 'manager') {
      const managerId = clean(data.get('managerId'));
      mutate(() => saveUser(id, { managerId: managerId || null, reason: T('Yönetici değiştirildi.', 'Manager changed.') }),
        { successMessage: managerId
          ? T(`${nameOf(id)} artık ${nameOf(managerId)} yöneticisine bağlı.`, `${nameOf(id)} now reports to ${nameOf(managerId)}.`)
          : T(`${nameOf(id)} artık bir yöneticiye bağlı değil.`, `${nameOf(id)} no longer reports to anyone.`) });
    }
  }

  function onKeyDown(event) {
    if (event.key !== 'Enter') return;
    /* v7.37 — elle yazılan değer Enter ile de eklenir. Bu satır olmadan Enter
       FORMU GÖNDERİRDİ: kullanıcı yazdığı değeri hiç eklemeden kaydı
       kapatırdı, yazdığı da kaybolurdu. */
    const chipNew = event.target.closest('[data-um-chipnew]');
    if (chipNew) {
      event.preventDefault();
      const field = chipNew.closest('[data-um-chipfield]');
      if (chipAdd(field, chipNew.value)) refreshScopeChoices(field ? field.closest('form') : null);
      chipNew.value = '';
      return;
    }
    const search = event.target.closest('[data-um-search], [data-um-permsearch], [data-um-historysearch], [data-um-copysearch], [data-um-copysourcesearch]');
    if (search) event.preventDefault();
  }

  /* ===================== 16 · Sürükle & bırak ===================== */

  document.addEventListener('dragstart', event => {
    const node = event.target.closest && event.target.closest('[data-um-node]');
    if (!node || !shell || !shell.contains(node)) return;
    event.dataTransfer.setData('text/plain', node.dataset.umNode);
    event.dataTransfer.effectAllowed = 'move';
  });
  document.addEventListener('dragover', event => {
    const node = event.target.closest && event.target.closest('[data-um-node]');
    if (!node || !shell || !shell.contains(node)) return;
    event.preventDefault();
    node.classList.add('isDropTarget');
  });
  document.addEventListener('dragleave', event => {
    const node = event.target.closest && event.target.closest('[data-um-node]');
    if (node) node.classList.remove('isDropTarget');
  });
  document.addEventListener('drop', event => {
    const node = event.target.closest && event.target.closest('[data-um-node]');
    if (!node || !shell || !shell.contains(node)) return;
    event.preventDefault();
    node.classList.remove('isDropTarget');
    const movedId = event.dataTransfer.getData('text/plain'), managerId = node.dataset.umNode;
    if (!movedId || movedId === managerId) return;
    if (descendantIds(movedId).has(managerId)) {
      toast(T('Bir kullanıcı, kendi altındaki bir kullanıcıya bağlanamaz.', 'A user cannot report to one of their own reports.'));
      return;
    }
    mutate(() => saveUser(movedId, { managerId, reason: T('Organizasyon ağacında taşındı.', 'Moved in the organization tree.') }),
      { successMessage: T(`${nameOf(movedId)} artık ${nameOf(managerId)} yöneticisine bağlı.`, `${nameOf(movedId)} now reports to ${nameOf(managerId)}.`) });
  });

  /* ===================== 17 · Dış arayüz ===================== */

  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    if (dialog) {
      if (window.BLLayerSystem) return;
      closeDialog(); event.stopPropagation(); return;
    }
    if (overlay) { close(); event.stopPropagation(); }
  }, true);

  window.addEventListener('beforeunload', event => {
    if (store.roleDirty) { event.preventDefault(); event.returnValue = ''; }
  });

  window.BLUserManagement = { open, close, reload };
})();
