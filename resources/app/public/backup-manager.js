'use strict';

// Buyer Log — Backup & Restore (v2): günlük otomatik yedek, seçmeli yedek ve
// bileşen bazlı seçmeli geri yükleme. Arayüz durum nesnesinden çizilir; dil
// değişince (bl:language-changed) aynı durumla yeniden çizilir.
function buyerLogBackupTr(tr, en) { return typeof appLang !== 'undefined' && appLang === 'en' ? en : tr; }
function buyerLogRestoreBytes(value) {
  const bytes = Math.max(0, Number(value) || 0), units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let amount = bytes, unit = 0; while (amount >= 1024 && unit < units.length - 1) { amount /= 1024; unit += 1; }
  return `${amount >= 100 || unit === 0 ? Math.round(amount) : amount.toFixed(1)} ${units[unit]}`;
}
function buyerLogBackupEsc(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}
function buyerLogBackupDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString(typeof appLang !== 'undefined' && appLang === 'en' ? 'en-GB' : 'tr-TR', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}
function buyerLogBrowserStorageSnapshot() {
  const out = {}, profile = window.BL_USER_CONTEXT || {}, uid = String(profile.id || 'anonymous').replace(/[^A-Za-z0-9_-]/g, '_');
  const prefix = `bl.user.${uid}.`, storage = window.BLStorage && window.BLStorage.native || window.localStorage;
  for (let index = 0; storage && index < storage.length; index++) {
    const key = storage.key(index); if (key && key.startsWith(prefix)) out[key] = storage.getItem(key);
  }
  return out;
}
function buyerLogApplyBrowserStorageSnapshot(snapshot) {
  const profile = window.BL_USER_CONTEXT || {}, uid = String(profile.id || 'anonymous').replace(/[^A-Za-z0-9_-]/g, '_');
  const prefix = `bl.user.${uid}.`, storage = window.BLStorage && window.BLStorage.native || window.localStorage;
  if (!storage) return;
  const remove = [];
  for (let index = 0; index < storage.length; index++) {
    const key = storage.key(index); if (key && key.startsWith(prefix)) remove.push(key);
  }
  remove.forEach(key => { try { storage.removeItem(key); } catch (_) {} });
  for (const [key, value] of Object.entries(snapshot && typeof snapshot === 'object' ? snapshot : {})) {
    if (!String(key).startsWith(prefix)) continue;
    try { storage.setItem(String(key), String(value == null ? '' : value)); } catch (_) {}
  }
}

let buyerLogSharedPersonalBackupBusy = false;
let buyerLogSharedPersonalBackupLastAttempt = 0;
async function buyerLogSharedPersonalBackupNow(force = false) {
  const profile = window.BL_USER_CONTEXT || {};
  if (!profile.id || buyerLogSharedPersonalBackupBusy) return { skipped: true, reason: !profile.id ? 'no-user' : 'busy' };
  const now = Date.now();
  if (!force && now - buyerLogSharedPersonalBackupLastAttempt < 14 * 60 * 1000) return { skipped: true, reason: 'throttled' };
  buyerLogSharedPersonalBackupLastAttempt = now;
  buyerLogSharedPersonalBackupBusy = true;
  try {
    const response = await fetch('/api/backups/shared-personal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ browserStorage: buyerLogBrowserStorageSnapshot() }),
      cache: 'no-store',
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || response.statusText);
    window.dispatchEvent(new CustomEvent('buyerlog:shared-personal-backup', { detail: data }));
    return data;
  } catch (error) {
    console.warn('[BuyerLog] Shared personal backup:', error && error.message || error);
    return { ok: false, error: error && error.message || String(error) };
  } finally {
    buyerLogSharedPersonalBackupBusy = false;
  }
}
window.buyerLogSharedPersonalBackupNow = buyerLogSharedPersonalBackupNow;

function buyerLogBackupScopeDefinitions(moderator) {
  const items = [
    { id:'preferences', tr:'Arayüz ve kullanıcı tercihleri', en:'Interface & user preferences', checked:true },
    { id:'collection', tr:'Collection', en:'Collection', checked:true },
    { id:'views-filters', tr:'Görünümler ve filtreler', en:'Views & filters', checked:true },
    { id:'shipping', tr:'Shipping Comparison', en:'Shipping Comparison', checked:true },
    { id:'refresh-history', tr:'Yenileme geçmişi', en:'Refresh history', checked:true },
    { id:'source-data', tr:'Kişisel kaynak dosyaları', en:'Personal source data', checked:true },
  ];
  if (moderator) items.push({ id:'cp-exfactory', tr:'CP Tracker · Ex-Factory revizyonları', en:'CP Tracker · Ex-Factory revisions', shared:true, checked:false });
  return items;
}
// Ortak seçim listesi: yedek kapsamı, kişisel restore ve tam restore aynı
// bileşeni kullanır. attributeName checkbox'ın veri özniteliğidir.
function buyerLogBackupScopeHtml(items, attributeName, selected = null) {
  return items.map(item => {
    const id = buyerLogBackupEsc(item.id), disabled = item.canRestore === false;
    const checked = !disabled && (selected ? selected.has(item.id) : item.checked !== false);
    const label = buyerLogBackupTr(item.tr || item.labelTr || item.id, item.en || item.labelEn || item.id);
    const meta = [];
    if (item.fileCount != null) meta.push(`${Number(item.fileCount).toLocaleString()} ${buyerLogBackupTr('dosya','files')} · ${buyerLogRestoreBytes(item.bytes)}`);
    if (item.scopeLabelTr && item.scope !== 'special') meta.push(buyerLogBackupTr(item.scopeLabelTr, item.scopeLabelEn || item.scopeLabelTr));
    const badges = [
      item.shared ? `<em class="blBkBadge">${buyerLogBackupTr('paylaşılan veri','shared data')}</em>` : '',
      item.auto ? `<em class="blBkBadge is-new">${buyerLogBackupTr('otomatik algılandı','auto-detected')}</em>` : '',
      disabled ? `<em class="blBkBadge is-locked">${buyerLogBackupTr('yetki gerekli','permission required')}</em>` : '',
    ].join('');
    return `<label class="blBkOption" data-search="${buyerLogBackupEsc(`${item.labelTr || item.tr || ''} ${item.labelEn || item.en || ''} ${item.top || item.id}`.toLocaleLowerCase('tr-TR'))}"><input type="checkbox" ${attributeName}="${id}" ${checked ? 'checked' : ''} ${disabled ? 'disabled' : ''}/><span class="blBkOptionText"><b>${buyerLogBackupEsc(label)}</b>${meta.length ? `<small>${buyerLogBackupEsc(meta.join(' · '))}</small>` : ''}</span>${badges}</label>`;
  }).join('');
}
function buyerLogBackupGroupedHtml(components, categories, attributeName, selected) {
  const order = (categories || []).map(item => item.id);
  const groups = new Map();
  for (const item of components) {
    const key = item.category || 'other';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  const keys = [...groups.keys()].sort((a, b) => (order.indexOf(a) === -1 ? 99 : order.indexOf(a)) - (order.indexOf(b) === -1 ? 99 : order.indexOf(b)));
  return keys.map(key => {
    const category = (categories || []).find(item => item.id === key) || { tr: key, en: key };
    const items = groups.get(key);
    return `<section class="blBkGroup" data-backup-group="${buyerLogBackupEsc(key)}"><header><b>${buyerLogBackupEsc(buyerLogBackupTr(category.tr, category.en))}</b><button type="button" class="blBkLink" data-backup-group-toggle="${buyerLogBackupEsc(key)}">${buyerLogBackupTr('Grubu seç / bırak','Toggle group')}</button></header><div class="blBkOptions">${buyerLogBackupScopeHtml(items, attributeName, selected)}</div></section>`;
  }).join('');
}

const buyerLogBackupState = { modal: null, tab: 'auto', restoreKind: 'user' };
function buyerLogBackupFreshState() {
  return {
    auto: { loading: true, data: null, error: '', busy: false, message: '', folderDraft: null },
    backup: { job: null, error: '', busy: false, selected: new Set(buyerLogBackupScopeDefinitions(true).filter(item => item.checked !== false).map(item => item.id)) },
    shared: { data: null, error: '', busy: false },
    user: { file: null, uploadId: '', plan: null, selected: new Set(), status: '', busy: false },
    full: { file: null, source: null, uploadId: '', plan: null, selected: new Set(), status: '', busy: false, safety: true, jobId: '', commitStarted: false },
  };
}

function buyerLogBackupModal(options = {}) {
  document.getElementById('_buyerLogBackupModal')?.remove();
  const moderator = Boolean(window.BLIsModerator && window.BLIsModerator());
  const canManage = moderator || (typeof window.BLHasPermission === 'function' && window.BLHasPermission('manageBackup'));
  // Otomatik yedek bu bilgisayarın tam sistem yedeğidir; yönetimi moderatöre aittir.
  const autoManage = moderator;
  const st = buyerLogBackupFreshState();
  buyerLogBackupState.tab = options.tab || buyerLogBackupState.tab || 'auto';
  if (!moderator && !canManage) buyerLogBackupState.restoreKind = 'user';
  const modal = document.createElement('div'); modal.id = '_buyerLogBackupModal'; modal.className = 'warnOverlay';
  buyerLogBackupState.modal = modal;
  document.body.appendChild(modal);
  const T = buyerLogBackupTr;
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const stages = ['Hazırlanıyor', 'Veriler', 'Ayarlar', 'Doğrulanıyor', 'Tamamlandı']; // i18n-ignore — sunucu faz anahtarları
  const stageLabels = () => [T('Hazırlanıyor','Preparing'), T('Veriler','Data'), T('Ayarlar','Settings'), T('Doğrulanıyor','Validating'), T('Tamamlandı','Completed')];
  const close = () => { modal.remove(); window.removeEventListener('bl:language-changed', onLang); };
  const onLang = () => { if (document.body.contains(modal)) render(); };
  window.addEventListener('bl:language-changed', onLang);
  modal.addEventListener('click', event => { if (event.target === modal) close(); });

  // ---- Otomatik yedek ----------------------------------------------------
  function autoTargetHtml(key, target, title, icon) {
    const data = target || {};
    let body;
    if (!data.configured) body = `<div class="blBkEmpty">${key === 'sync' ? T('Buyer Log Sync klasörü bağlı değil. Data Management üzerinden Sync klasörünü seçtiğinizde yedekler buraya da yazılır.','Buyer Log Sync folder is not connected. Once you select it in Data Management, backups are written there too.') : T('Klasör hazırlanamadı.','Folder is not ready.')}</div>`;
    else if (data.error) body = `<div class="blBkEmpty is-error">${buyerLogBackupEsc(data.error)}</div>`;
    else if (!data.backups.length) body = `<div class="blBkEmpty">${T('Henüz otomatik yedek yok. İlk yedek bugün içinde otomatik alınır.','No automatic backup yet. The first one is taken automatically today.')}</div>`;
    else body = `<ul class="blBkList">${data.backups.map(item => `<li><div class="blBkListMain"><b>${buyerLogBackupEsc(buyerLogBackupDate(item.createdAt))}</b><small>${buyerLogRestoreBytes(item.bytes)}${item.fileCount ? ` · ${Number(item.fileCount).toLocaleString()} ${T('dosya','files')}` : ''}${item.appVersion ? ` · v${buyerLogBackupEsc(item.appVersion)}` : ''}</small></div>${autoManage ? `<div class="blBkListActions"><button class="tbtn" type="button" data-auto-download="${key}|${buyerLogBackupEsc(item.filename)}" title="${T('İndir','Download')}"><svg class="ic"><use href="#i-download"/></svg><span>${T('İndir','Download')}</span></button>${item.verifiable ? `<button class="tbtn" type="button" data-auto-restore="${key}|${buyerLogBackupEsc(item.filename)}"><svg class="ic"><use href="#i-refresh"/></svg><span>${T('Geri yükle…','Restore…')}</span></button>` : `<em class="blBkBadge is-locked" title="${T('Bu cihaz tarafından üretildiği doğrulanamadı; indirip dosyadan geri yükleyebilirsiniz.','Could not be verified as produced by this device; download it and restore from file.')}">${T('doğrulanamadı','unverified')}</em>`}</div>` : ''}</li>`).join('')}</ul>`;
    const folder = data.folder ? `<code class="blBkPath" title="${buyerLogBackupEsc(data.folder)}">${buyerLogBackupEsc(data.folder)}</code>` : '';
    const ok = data.lastSuccessDay && st.auto.data && data.lastSuccessDay === st.auto.data.today;
    return `<article class="blBkTarget"><header><span class="blBkTargetIcon"><svg class="ic"><use href="#${icon}"/></svg></span><div><b>${title}</b>${folder}</div><span class="blBkPill ${ok ? 'is-ok' : (data.configured ? 'is-wait' : 'is-off')}">${ok ? T('Bugün alındı','Done today') : (data.configured ? T('Bekliyor','Pending') : T('Bağlı değil','Not connected'))}</span></header>${body}</article>`;
  }
  function autoPanel() {
    const a = st.auto, data = a.data;
    if (a.loading && !data) return `<div class="blBkEmpty">${T('Otomatik yedek durumu okunuyor…','Reading automatic backup status…')}</div>`;
    if (!data) return `<div class="blBkEmpty is-error">${T('Otomatik yedek durumu okunamadı','Automatic backup status unavailable')}: ${buyerLogBackupEsc(a.error)}</div>`;
    const last = data.lastRun;
    const lastText = last ? `${buyerLogBackupDate(last.finishedAt || last.startedAt)}${last.bytes ? ` · ${buyerLogRestoreBytes(last.bytes)}` : ''}` : T('Henüz yok','None yet');
    const lastErrors = last ? Object.entries(last.results || {}).filter(([, r]) => r && !r.ok && !r.skipped).map(([k, r]) => `${k === 'sync' ? T('Sync klasörü','Sync folder') : T('Bu bilgisayar','This computer')}: ${r.error}`) : [];
    if (last && last.error) lastErrors.unshift(last.error);
    const folderValue = a.folderDraft != null ? a.folderDraft : (data.customLocalFolder ? data.localFolder : '');
    return `
      <div class="blBkSummary">
        <div class="blBkStat"><span>${T('Durum','Status')}</span><b class="${data.enabled ? 'is-ok' : 'is-off'}">${data.enabled ? T('Açık · her gün','On · daily') : T('Kapalı','Off')}</b></div>
        <div class="blBkStat"><span>${T('Son yedek','Last backup')}</span><b>${buyerLogBackupEsc(lastText)}</b></div>
        <div class="blBkStat"><span>${T('Saklama','Retention')}</span><b>${T(`Son ${data.retentionDays} gün`, `Last ${data.retentionDays} days`)}</b></div>
        <div class="blBkStat"><span>${T('Kapsam','Scope')}</span><b>${T('Tüm veriler · model, görsel, PDF ve arşiv dosyaları hariç','All data · model, image, PDF & archive files excluded')}</b></div>
      </div>
      ${lastErrors.length ? `<div class="blBkAlert is-error">${lastErrors.map(buyerLogBackupEsc).join('<br>')}</div>` : ''}
      ${a.message ? `<div class="blBkAlert">${buyerLogBackupEsc(a.message)}</div>` : ''}
      <div class="blBkTargets">
        ${autoTargetHtml('local', data.targets && data.targets.local, T('Bu bilgisayar (Buyer Log dışı klasör)','This computer (folder outside Buyer Log)'), 'i-folder')}
        ${autoTargetHtml('sync', data.targets && data.targets.sync, T('Buyer Log Sync klasörü','Buyer Log Sync folder'), 'i-cloud')}
      </div>
      ${autoManage ? `<div class="blBkSettings">
        <label class="blBkSwitch"><input type="checkbox" data-auto-enabled ${data.enabled ? 'checked' : ''} ${a.busy ? 'disabled' : ''}/><span>${T('Günlük otomatik yedek','Daily automatic backup')}</span></label>
        <div class="blBkFolderRow"><input type="text" data-auto-folder placeholder="${buyerLogBackupEsc(data.defaultLocalFolder)}" value="${buyerLogBackupEsc(folderValue)}" aria-label="${T('Yedek klasörü','Backup folder')}"/><button class="tbtn" type="button" data-auto-folder-save ${a.busy ? 'disabled' : ''}>${T('Klasörü kaydet','Save folder')}</button></div>
        <small class="blBkHint">${T('Boş bırakılırsa varsayılan klasör kullanılır. Klasör Buyer Log veri klasörlerinin dışında olmalıdır.','Leave empty to use the default folder. The folder must be outside Buyer Log data folders.')}</small>
        <div class="blBkActions"><button class="navActionBtn" type="button" data-auto-run ${a.busy || data.running ? 'disabled' : ''}><svg class="ic"><use href="#i-database-import"/></svg><span>${a.busy || data.running ? T('Yedekleniyor…','Backing up…') : T('Şimdi yedekle','Back up now')}</span></button></div>
      </div>` : `<div class="blBkHint">${T('Otomatik yedek ayarlarını ve listeden geri yüklemeyi yalnız moderatör yönetebilir.','Only the moderator can manage automatic backup settings and restore from the list.')}</div>`}`;
  }

  // ---- Yedek al -----------------------------------------------------------
  function backupPanel() {
    const b = st.backup, job = b.job || {};
    const activeIndex = Math.max(0, stages.indexOf(job.phase));
    const labels = stageLabels();
    const progressText = b.error ? `${T('Hata','Error')}: ${b.error}` : (job.phase ? `${labels[activeIndex] || job.phase} • ${Number(job.current || 0).toLocaleString()}/${Number(job.total || 0).toLocaleString()}${job.item ? ` • ${job.item}` : ''}` : T('Yedekleme başlatılmadı.','Backup has not started.'));
    const shared = st.shared, sd = shared.data;
    let sharedText;
    if (shared.error) sharedText = `${T('Ortak yedek durumu okunamadı','Shared backup status unavailable')}: ${shared.error}`;
    else if (!sd) sharedText = T('Kontrol ediliyor…','Checking…');
    else if (sd.configured === false) sharedText = T('Shared Hub henüz bağlı değil. Yerel kişisel veriler korunmaya devam ediyor.','Shared Hub is not connected yet. Personal data remains stored locally.');
    else if (!sd.available && !sd.latest) sharedText = T('Shared Hub bağlı; henüz kişisel ortak yedek yok.','Shared Hub is connected; no shared personal backup exists yet.');
    else sharedText = `${T('Son ortak yedek','Latest shared backup')}: ${buyerLogBackupDate(sd.latest && sd.latest.createdAt)}${sd.latest && sd.latest.bytes ? ` • ${buyerLogRestoreBytes(sd.latest.bytes)}` : ''}`;
    return `
      <div class="blBkCols">
        <article class="blBkCard" data-user-backup-scope>
          <header><b>${T('Kişisel verilerim','My personal data')}</b><div class="blBkInline"><button class="blBkLink" type="button" data-backup-scope-all>${T('Tümünü seç','Select all')}</button><button class="blBkLink" type="button" data-backup-scope-personal>${T('Kişisel varsayılan','Personal default')}</button></div></header>
          <div class="blBkOptions" data-backup-scope-options>${buyerLogBackupScopeHtml(buyerLogBackupScopeDefinitions(moderator), 'data-backup-scope-id', b.selected)}</div>
          ${moderator ? `<small class="blBkHint">${T('CP Ex-Factory revizyonları paylaşılan veridir ve varsayılan olarak seçili değildir.','CP Ex-Factory revisions are shared data and are not selected by default.')}</small>` : ''}
          <div class="blBkActions"><button class="navActionBtn" type="button" data-backup-mode="user" ${b.busy ? 'disabled' : ''}><svg class="ic"><use href="#i-download"/></svg><span>${T('Verilerimi Yedekle','Back Up My Data')}</span></button></div>
        </article>
        <div class="blBkStack">
          ${moderator ? `<article class="blBkCard"><header><b>${T('Tam Sistem Yedeği','Full System Backup')}</b></header><p class="blBkHint">${T('Bu bilgisayardaki tüm Buyer Log verisi, kullanıcı/rol yapısı ve ayarlar tek ZIP olarak indirilir. Model dosyaları, görseller, PDF ve arşiv dosyaları boyutu şişirmemek için yedeğe alınmaz.','All Buyer Log data on this computer, the user/role structure and settings are downloaded as one ZIP. Model files, images, PDF and archive files are excluded to keep the size small.')}</p><div class="blBkActions"><button class="tbtn" type="button" data-backup-mode="full" ${b.busy ? 'disabled' : ''}><svg class="ic"><use href="#i-database-import"/></svg><span>${T('Tam Sistem Yedeği','Full System Backup')}</span></button></div></article>` : ''}
          <article class="blBkCard backupSharedPanel"><div><b>${T('Ortak kişisel yedek','Shared personal backup')}</b><div data-shared-personal-status>${buyerLogBackupEsc(sharedText)}</div></div><div class="backupRestoreActions"><button class="tbtn" type="button" data-shared-personal-now ${shared.busy ? 'disabled' : ''}>${T('Şimdi güncelle','Back up now')}</button>${sd && sd.available && sd.latest ? `<button class="tbtn" type="button" data-shared-personal-download>${T('Ortak yedeği indir','Download shared backup')}</button>` : ''}</div></article>
        </div>
      </div>
      <div class="backupStages">${labels.map((label, index) => `<div class="backupStage ${job.phase && (index < activeIndex || job.ready) ? 'done' : ''} ${job.phase && index === activeIndex && !b.error ? 'active' : ''} ${b.error && index === activeIndex ? 'error' : ''}" data-stage="${stages[index]}"><span>${index + 1}</span><b>${label}</b></div>`).join('')}</div>
      <div class="backupProgress" id="_backupStatus" aria-live="polite">${buyerLogBackupEsc(progressText)}</div>`;
  }

  // ---- Geri yükle ---------------------------------------------------------
  function fileField(attr, file, label) {
    return `<label class="backupFilePicker"><span><svg class="ic"><use href="#i-upload"/></svg> ${label}</span><em>${file ? buyerLogBackupEsc(file.name) : T('Dosya seçilmedi','No file chosen')}</em><input type="file" ${attr} accept=".zip,application/zip"/></label>`;
  }
  function selectionToolbar(prefix, count, total) {
    return `<div class="blBkToolbar"><input type="search" data-${prefix}-search placeholder="${T('Veri alanı ara…','Search data areas…')}" aria-label="${T('Veri alanı ara','Search data areas')}"/><span class="blBkCount" data-${prefix}-count>${T(`${count}/${total} seçili`, `${count}/${total} selected`)}</span><button class="blBkLink" type="button" data-${prefix}-all>${T('Tümünü seç','Select all')}</button><button class="blBkLink" type="button" data-${prefix}-none>${T('Hiçbirini seçme','Select none')}</button></div>`;
  }
  function userRestorePanel() {
    const u = st.user, plan = u.plan;
    const components = plan && Array.isArray(plan.components) ? plan.components : [];
    const owner = plan && plan.user || {};
    return `<div class="backupRestorePanel" data-user-restore-panel>
      <p class="blBkHint">${T('Kişisel backup ZIP dosyanızı seçin, ön kontrolden sonra geri yüklenecek alanları tek tek işaretleyin. Yalnız seçtiğiniz alanlar değişir.','Choose your personal backup ZIP, then tick the areas to restore one by one after the preflight. Only the selected areas change.')}</p>
      ${fileField('data-user-restore-file', u.file, T('Kişisel Backup ZIP seçin','Choose a Personal Backup ZIP'))}
      <div class="backupRestoreActions"><button class="tbtn" type="button" data-user-restore-inspect ${u.busy || !u.file ? 'disabled' : ''}>${T('Ön kontrol yap','Run preflight')}</button></div>
      ${plan ? `<div class="blBkPlanMeta"><span>${buyerLogBackupEsc(owner.displayName || owner.username || owner.id || '—')}</span><span>${buyerLogBackupDate(plan.createdAt)}</span><span>v${buyerLogBackupEsc(plan.appVersion || '—')}</span><span>${Number(plan.fileCount || 0).toLocaleString()} ${T('dosya','files')} · ${buyerLogRestoreBytes(plan.totalBytes)}</span></div>
      <div data-user-restore-scope>${selectionToolbar('user-restore', components.filter(item => u.selected.has(item.id)).length, components.length)}<div class="blBkOptions" data-user-restore-scope-options>${buyerLogBackupScopeHtml(components, 'data-user-restore-scope-id', u.selected)}</div></div>
      ${(plan.warnings || []).length ? `<div class="blBkAlert">${plan.warnings.map(buyerLogBackupEsc).join('<br>')}</div>` : ''}
      <div class="backupRestoreActions"><button class="navActionBtn" type="button" data-user-restore-confirm ${u.busy || !u.uploadId || !u.selected.size ? 'disabled' : ''}>${T('Seçilenleri geri yükle','Restore selected')}</button></div>` : ''}
      <div class="backupRestoreStatus" data-user-restore-status aria-live="polite">${buyerLogBackupEsc(u.status || T('Bir kişisel backup seçin.','Choose a personal backup.'))}</div>
    </div>`;
  }
  function fullRestorePanel() {
    const f = st.full, plan = f.plan;
    const components = plan && Array.isArray(plan.components) ? plan.components : [];
    const inventory = plan && plan.inventory || {}, connections = inventory.connections || {};
    const found = value => value ? T('Var','Found') : T('Yok','Missing');
    const sourceText = f.source ? `${f.source.target === 'sync' ? T('Sync klasörü','Sync folder') : T('Bu bilgisayar','This computer')} · ${f.source.filename}` : '';
    return `<div class="backupRestorePanel" data-restore-panel>
      <p class="blBkHint">${T('Tam sistem yedeğini bir ZIP dosyasından veya Otomatik yedek listesinden seçin. Ön kontrolden sonra hangi veri alanlarının geri yükleneceğini tek tek işaretleyin; seçilmeyen alanlar olduğu gibi kalır.','Pick a full system backup from a ZIP file or from the Automatic backup list. After the preflight, tick each data area to restore; unselected areas stay as they are.')}</p>
      ${f.source ? `<div class="blBkSource"><svg class="ic"><use href="#i-clock"/></svg><span>${buyerLogBackupEsc(sourceText)}</span><button class="blBkLink" type="button" data-restore-source-clear>${T('Dosyadan seç','Choose from file')}</button></div>` : fileField('data-restore-file', f.file, T('Full System Backup ZIP seçin','Choose a Full System Backup ZIP'))}
      <div class="backupRestoreActions"><label><input type="checkbox" data-restore-safety-backup ${f.safety ? 'checked' : ''}/> ${T('Önce güvenlik yedeği al (createSafetyBackup)','Take a safety backup first (createSafetyBackup)')}</label><button class="tbtn" type="button" data-restore-inspect ${f.busy || (!f.file && !f.source) ? 'disabled' : ''}>${T('Ön kontrol yap','Run preflight')}</button></div>
      ${plan ? `<div class="blBkPlanMeta"><span>${buyerLogBackupDate(plan.createdAt)}</span><span>v${buyerLogBackupEsc(plan.appVersion || '—')}</span><span>${Number(plan.fileCount || 0).toLocaleString()} ${T('dosya','files')} · ${buyerLogRestoreBytes(plan.totalBytes)}</span><span>${T('Kullanıcı','Users')}: ${Number(inventory.users || 0).toLocaleString()} · ${T('Rol','Roles')}: ${Number(inventory.roles || 0).toLocaleString()}</span><span>Local DB: ${found(inventory.localDb)} · ASAS: ${found(connections.asas)} · IAS: ${found(connections.ias)} · INTAKE: ${found(connections.intake)}</span>${plan.excludedAssets && plan.excludedAssets.count ? `<span>${T(`${Number(plan.excludedAssets.count).toLocaleString()} model/görsel dosyası (${buyerLogRestoreBytes(plan.excludedAssets.bytes)}) yedek dışı`, `${Number(plan.excludedAssets.count).toLocaleString()} model/image files (${buyerLogRestoreBytes(plan.excludedAssets.bytes)}) not in backup`)}</span>` : ''}</div>
      <div data-full-restore-scope>${selectionToolbar('full-restore', components.filter(item => f.selected.has(item.id)).length, components.length)}<div class="blBkGroups">${buyerLogBackupGroupedHtml(components, plan.componentCategories, 'data-full-restore-scope-id', f.selected)}</div></div>
      ${(plan.warnings || []).length ? `<div class="blBkAlert">${plan.warnings.map(buyerLogBackupEsc).join('<br>')}</div>` : ''}
      <div class="backupRestoreActions"><button class="navActionBtn" type="button" data-restore-confirm ${f.busy || !f.uploadId || !f.selected.size ? 'disabled' : ''}>${T('Seçilenleri geri yükle','Restore selected')}</button>${f.jobId && !f.commitStarted && f.busy ? `<button class="tbtn" type="button" data-restore-cancel>${T('İptal','Cancel')}</button>` : ''}</div>` : ''}
      <div class="backupRestoreStatus" data-restore-status aria-live="polite">${buyerLogBackupEsc(f.status || T('Bir backup seçin.','Choose a backup.'))}</div>
    </div>`;
  }
  function restorePanel() {
    const fullAllowed = moderator || canManage;
    const kind = fullAllowed ? buyerLogBackupState.restoreKind : 'user';
    return `${fullAllowed ? `<div class="blBkSegment" role="tablist"><button type="button" role="tab" data-restore-kind="user" data-user-restore aria-selected="${kind === 'user'}" class="${kind === 'user' ? 'active' : ''}">${T('Verilerimi Geri Yükle','Restore My Data')}</button><button type="button" role="tab" data-restore-kind="full" data-backup-restore aria-selected="${kind === 'full'}" class="${kind === 'full' ? 'active' : ''}">${T('Tam Sistem Geri Yükleme','Full System Restore')}</button></div>` : ''}
      ${kind === 'full' ? fullRestorePanel() : userRestorePanel()}`;
  }

  function render() {
    const tab = buyerLogBackupState.tab;
    const tabs = [
      { id: 'auto', icon: 'i-clock', label: T('Otomatik yedek','Automatic backup') },
      { id: 'backup', icon: 'i-download', label: T('Yedek al','Back up') },
      { id: 'restore', icon: 'i-refresh', label: T('Geri yükle','Restore') },
    ];
    const scrollTop = modal.querySelector('.blBkBody') ? modal.querySelector('.blBkBody').scrollTop : 0;
    modal.innerHTML = `<div class="modalCard backupCard blBkCard2" role="dialog" aria-modal="true" aria-labelledby="_backupTitle">
      <div class="backupHead"><div><div class="modalTitle" id="_backupTitle">${T('Yedekleme ve Geri Yükleme','Backup & Restore')}</div><div class="backupIntro">${T('Verileriniz her gün otomatik yedeklenir. Model dosyaları, görseller, PDF ve arşiv dosyaları yedeği şişirmemek için kapsam dışıdır.','Your data is backed up automatically every day. Model files, images, PDF and archive files are excluded to keep backups small.')}</div></div><button class="pricingRuleIconBtn _backupClose" type="button" aria-label="${T('Kapat','Close')}"><svg class="ic"><use href="#i-x"/></svg></button></div>
      <div class="blBkTabs" role="tablist">${tabs.map(item => `<button type="button" role="tab" data-backup-tab="${item.id}" aria-selected="${tab === item.id}" class="${tab === item.id ? 'active' : ''}"><svg class="ic"><use href="#${item.icon}"/></svg><span>${item.label}</span></button>`).join('')}</div>
      <div class="backupBody blBkBody">${tab === 'auto' ? autoPanel() : tab === 'backup' ? backupPanel() : restorePanel()}</div>
    </div>`;
    const body = modal.querySelector('.blBkBody'); if (body) body.scrollTop = scrollTop;
    bind();
  }

  function updateCount(prefix, container, attr) {
    const all = [...container.querySelectorAll(`[${attr}]:not(:disabled)`)];
    const counter = modal.querySelector(`[data-${prefix}-count]`);
    if (counter) counter.textContent = T(`${all.filter(input => input.checked).length}/${all.length} seçili`, `${all.filter(input => input.checked).length}/${all.length} selected`);
  }
  function bindSelection(prefix, attr, set, onChange) {
    const root = modal.querySelector(`[data-${prefix}-scope]`);
    if (!root) return;
    const inputs = () => [...root.querySelectorAll(`[${attr}]:not(:disabled)`)];
    const sync = () => { set.clear(); inputs().filter(input => input.checked).forEach(input => set.add(input.getAttribute(attr))); updateCount(prefix, root, attr); onChange(); };
    root.addEventListener('change', event => { if (event.target.matches(`[${attr}]`)) sync(); });
    modal.querySelector(`[data-${prefix}-all]`)?.addEventListener('click', () => { inputs().forEach(input => { if (!input.closest('[hidden]')) input.checked = true; }); sync(); });
    modal.querySelector(`[data-${prefix}-none]`)?.addEventListener('click', () => { inputs().forEach(input => { if (!input.closest('[hidden]')) input.checked = false; }); sync(); });
    root.querySelectorAll('[data-backup-group-toggle]').forEach(button => button.addEventListener('click', () => {
      const group = button.closest('.blBkGroup'), list = [...group.querySelectorAll(`[${attr}]:not(:disabled)`)];
      const next = !list.every(input => input.checked); list.forEach(input => { input.checked = next; }); sync();
    }));
    // Arama yeniden çizim yapmaz: odak ve seçimler korunur.
    modal.querySelector(`[data-${prefix}-search]`)?.addEventListener('input', event => {
      const query = String(event.target.value || '').trim().toLocaleLowerCase('tr-TR');
      root.querySelectorAll('.blBkOption').forEach(option => { option.hidden = Boolean(query) && !String(option.dataset.search || '').includes(query); });
      root.querySelectorAll('.blBkGroup').forEach(group => { group.hidden = ![...group.querySelectorAll('.blBkOption')].some(option => !option.hidden); });
    });
  }
  function confirmButtonState() {
    const userBtn = modal.querySelector('[data-user-restore-confirm]'); if (userBtn) userBtn.disabled = st.user.busy || !st.user.uploadId || !st.user.selected.size;
    const fullBtn = modal.querySelector('[data-restore-confirm]'); if (fullBtn) fullBtn.disabled = st.full.busy || !st.full.uploadId || !st.full.selected.size;
  }

  function bind() {
    modal.querySelector('._backupClose')?.addEventListener('click', close);
    modal.querySelectorAll('[data-backup-tab]').forEach(button => button.addEventListener('click', () => { buyerLogBackupState.tab = button.dataset.backupTab; render(); if (buyerLogBackupState.tab === 'auto') void refreshAuto(); if (buyerLogBackupState.tab === 'backup') void refreshShared(); }));
    modal.querySelectorAll('[data-restore-kind]').forEach(button => button.addEventListener('click', () => { buyerLogBackupState.restoreKind = button.dataset.restoreKind; render(); }));
    // Otomatik yedek
    modal.querySelector('[data-auto-run]')?.addEventListener('click', runAutoNow);
    modal.querySelector('[data-auto-enabled]')?.addEventListener('change', event => saveAutoSettings({ enabled: event.target.checked }));
    modal.querySelector('[data-auto-folder]')?.addEventListener('input', event => { st.auto.folderDraft = event.target.value; });
    modal.querySelector('[data-auto-folder-save]')?.addEventListener('click', () => saveAutoSettings({ localFolder: String(st.auto.folderDraft != null ? st.auto.folderDraft : modal.querySelector('[data-auto-folder]').value || '').trim() }));
    modal.querySelectorAll('[data-auto-download]').forEach(button => button.addEventListener('click', () => {
      const [target, filename] = button.dataset.autoDownload.split('|');
      const link = document.createElement('a'); link.href = `/api/backups/auto/download?target=${encodeURIComponent(target)}&filename=${encodeURIComponent(filename)}`; link.download = filename; document.body.appendChild(link); link.click(); link.remove();
    }));
    modal.querySelectorAll('[data-auto-restore]').forEach(button => button.addEventListener('click', () => {
      const [target, filename] = button.dataset.autoRestore.split('|');
      Object.assign(st.full, { file: null, source: { target, filename }, uploadId: '', plan: null, selected: new Set(), status: '' });
      buyerLogBackupState.tab = 'restore'; buyerLogBackupState.restoreKind = 'full'; render();
      void inspectFull();
    }));
    // Yedek al
    const scopeOptions = modal.querySelector('[data-backup-scope-options]');
    if (scopeOptions) {
      const syncScope = () => { st.backup.selected = new Set([...scopeOptions.querySelectorAll('[data-backup-scope-id]:checked')].map(input => input.getAttribute('data-backup-scope-id'))); };
      scopeOptions.addEventListener('change', syncScope);
      modal.querySelector('[data-backup-scope-all]')?.addEventListener('click', () => { scopeOptions.querySelectorAll('[data-backup-scope-id]').forEach(input => { input.checked = true; }); syncScope(); });
      modal.querySelector('[data-backup-scope-personal]')?.addEventListener('click', () => { scopeOptions.querySelectorAll('[data-backup-scope-id]').forEach(input => { input.checked = input.getAttribute('data-backup-scope-id') !== 'cp-exfactory'; }); syncScope(); });
    }
    modal.querySelectorAll('[data-backup-mode]').forEach(button => button.addEventListener('click', () => runBackup(button.dataset.backupMode)));
    modal.querySelector('[data-shared-personal-now]')?.addEventListener('click', async () => {
      st.shared.busy = true; st.shared.error = ''; render();
      const data = await buyerLogSharedPersonalBackupNow(true);
      st.shared.busy = false;
      if (data && data.ok === false) { st.shared.error = data.error || '—'; render(); } else await refreshShared();
    });
    modal.querySelector('[data-shared-personal-download]')?.addEventListener('click', () => {
      const link = document.createElement('a'); link.href = '/api/backups/shared-personal/latest'; link.download = ''; document.body.appendChild(link); link.click(); link.remove();
    });
    // Kişisel restore
    modal.querySelector('[data-user-restore-file]')?.addEventListener('change', event => { Object.assign(st.user, { file: event.target.files && event.target.files[0] || null, uploadId: '', plan: null, status: '' }); render(); });
    modal.querySelector('[data-user-restore-inspect]')?.addEventListener('click', inspectUser);
    modal.querySelector('[data-user-restore-confirm]')?.addEventListener('click', confirmUser);
    bindSelection('user-restore', 'data-user-restore-scope-id', st.user.selected, confirmButtonState);
    // Tam restore
    modal.querySelector('[data-restore-file]')?.addEventListener('change', event => { Object.assign(st.full, { file: event.target.files && event.target.files[0] || null, source: null, uploadId: '', plan: null, status: '' }); render(); });
    modal.querySelector('[data-restore-source-clear]')?.addEventListener('click', () => { Object.assign(st.full, { source: null, uploadId: '', plan: null, status: '' }); render(); });
    modal.querySelector('[data-restore-safety-backup]')?.addEventListener('change', event => { st.full.safety = event.target.checked; if (st.full.uploadId) { Object.assign(st.full, { uploadId: '', plan: null, status: T('Güvenlik yedeği tercihi değişti; ön kontrolü yeniden çalıştırın.','Safety backup preference changed; run the preflight again.') }); render(); } });
    modal.querySelector('[data-restore-inspect]')?.addEventListener('click', inspectFull);
    modal.querySelector('[data-restore-confirm]')?.addEventListener('click', confirmFull);
    modal.querySelector('[data-restore-cancel]')?.addEventListener('click', cancelFull);
    bindSelection('full-restore', 'data-full-restore-scope-id', st.full.selected, confirmButtonState);
  }

  // ---- Ağ işlemleri -------------------------------------------------------
  async function refreshAuto() {
    st.auto.loading = true;
    try {
      const response = await fetch('/api/backups/auto/status', { cache: 'no-store' });
      const data = await response.json().catch(() => ({})); if (!response.ok) throw new Error(data.error || response.statusText);
      st.auto.data = data; st.auto.error = '';
    } catch (error) { st.auto.error = error.message; }
    finally { st.auto.loading = false; if (buyerLogBackupState.tab === 'auto' && document.body.contains(modal)) render(); }
  }
  async function saveAutoSettings(patch) {
    st.auto.busy = true; st.auto.message = ''; render();
    try {
      const response = await fetch('/api/backups/auto/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) });
      const data = await response.json().catch(() => ({})); if (!response.ok) throw new Error(data.error || response.statusText);
      st.auto.data = data; st.auto.folderDraft = null; st.auto.message = T('Otomatik yedek ayarları kaydedildi.','Automatic backup settings saved.');
    } catch (error) { st.auto.message = `${T('Hata','Error')}: ${error.message}`; }
    finally { st.auto.busy = false; render(); }
  }
  async function runAutoNow() {
    st.auto.busy = true; st.auto.message = T('Yedek alınıyor; bu işlem veri boyutuna göre birkaç dakika sürebilir…','Backing up; this can take a few minutes depending on data size…'); render();
    try {
      const response = await fetch('/api/backups/auto/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      const data = await response.json().catch(() => ({})); if (!response.ok) throw new Error(data.error || response.statusText);
      st.auto.data = data.status || st.auto.data;
      const failed = Object.values(data.lastRun && data.lastRun.results || {}).some(item => item && !item.ok && !item.skipped);
      st.auto.message = data.lastRun && data.lastRun.error ? `${T('Hata','Error')}: ${data.lastRun.error}` : failed ? T('Yedek alındı ancak bazı hedeflere yazılamadı.','Backup created but some targets could not be written.') : T('Yedek alındı ve hedef klasörlere yazıldı.','Backup created and written to the target folders.');
    } catch (error) { st.auto.message = `${T('Hata','Error')}: ${error.message}`; }
    finally { st.auto.busy = false; render(); }
  }
  async function refreshShared() {
    try {
      const response = await fetch('/api/backups/shared-personal/status', { cache: 'no-store' });
      const data = await response.json().catch(() => ({})); if (!response.ok) throw new Error(data.error || response.statusText);
      st.shared.data = data; st.shared.error = '';
    } catch (error) { st.shared.error = error.message; }
    if (buyerLogBackupState.tab === 'backup' && document.body.contains(modal)) render();
  }
  async function runBackup(mode) {
    const components = mode === 'user' ? [...st.backup.selected] : null;
    if (mode === 'user' && !components.length) { st.backup.error = T('Yedeklenecek en az bir veri alanı seçin.','Select at least one data area to back up.'); st.backup.job = { phase: 'Hazırlanıyor' }; render(); return; }
    st.backup.busy = true; st.backup.error = ''; st.backup.job = { phase: 'Hazırlanıyor', current: 0, total: 0 }; render();
    try {
      const response = await fetch('/api/backups', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode, components, browserStorage: mode === 'user' ? buyerLogBrowserStorageSnapshot() : {} }) });
      const initial = await response.json().catch(() => ({})); if (!response.ok) throw new Error(initial.error || response.statusText);
      let job = initial;
      while (!job.ready && !job.error) { await wait(300); const poll = await fetch(`/api/backups/${encodeURIComponent(job.id)}/status`, { cache: 'no-store' }); job = await poll.json().catch(() => ({})); if (!poll.ok) throw new Error(job.error || poll.statusText); st.backup.job = job; if (buyerLogBackupState.tab === 'backup') render(); }
      st.backup.job = job; if (job.error) throw new Error(job.error);
      const link = document.createElement('a'); link.href = `/api/backups/${encodeURIComponent(job.id)}/download`; link.download = job.filename || 'BuyerLog_Backup.zip'; document.body.appendChild(link); link.click(); link.remove();
    } catch (error) { st.backup.error = error.message; }
    finally { st.backup.busy = false; if (document.body.contains(modal)) render(); }
  }
  async function inspectUser() {
    const u = st.user;
    if (!u.file) { u.status = T('Önce bir kişisel backup ZIP seçin.','Choose a personal backup ZIP first.'); render(); return; }
    Object.assign(u, { busy: true, uploadId: '', plan: null, status: T('Ön kontrol yapılıyor…','Running preflight…') }); render();
    try {
      const response = await fetch('/api/backups/user-restore/inspect', { method: 'POST', headers: { 'Content-Type': 'application/zip' }, body: u.file });
      const data = await response.json().catch(() => ({})); if (!response.ok) throw new Error(data.error || response.statusText);
      u.uploadId = data.uploadId; u.plan = data.preflight || {};
      u.selected = new Set((u.plan.components || []).filter(item => item.canRestore !== false).map(item => item.id));
      u.status = T('Ön kontrol tamamlandı. Geri yüklenecek alanları seçin.','Preflight complete. Choose the areas to restore.');
    } catch (error) { u.status = `${T('Hata','Error')}: ${error.message}`; }
    finally { u.busy = false; render(); }
  }
  async function confirmUser() {
    const u = st.user, userUploadId = u.uploadId;
    if (!userUploadId) return;
    const components = [...u.selected];
    if (!components.length) { u.status = T('Geri yüklenecek en az bir veri alanı seçin.','Select at least one data area to restore.'); render(); return; }
    if (!confirm(T('Yalnız seçtiğiniz veri alanları backup içeriğiyle değiştirilecek. Devam edilsin mi?','Only the selected data areas will be replaced with the backup contents. Continue?'))) return;
    u.busy = true; render();
    try {
      const response = await fetch('/api/backups/user-restore/start', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ uploadId: userUploadId, components }) });
      let job = await response.json().catch(() => ({})); if (!response.ok) throw new Error(job.error || response.statusText);
      const userRestoreJobId = job.id;
      while (!job.done && !job.error) {
        await wait(350);
        const poll = await fetch(`/api/backups/user-restore/${encodeURIComponent(userRestoreJobId)}/status`, { cache: 'no-store' });
        job = await poll.json().catch(() => ({})); if (!poll.ok) throw new Error(job.error || poll.statusText);
        u.status = `${job.phase || ''} • ${Number(job.current || 0).toLocaleString()}/${Number(job.total || 0).toLocaleString()}${job.bytesTotal ? ` • ${buyerLogRestoreBytes(job.bytesDone)}/${buyerLogRestoreBytes(job.bytesTotal)}` : ''}${job.item ? ` • ${job.item}` : ''}`;
        const statusNode = modal.querySelector('[data-user-restore-status]'); if (statusNode) statusNode.textContent = u.status;
      }
      if (job.error) throw new Error(job.error);
      const result = job.result || {};
      if (result.browserStorage && typeof result.browserStorage === 'object') buyerLogApplyBrowserStorageSnapshot(result.browserStorage);
      u.status = `${T('Kişisel restore tamamlandı. Arayüz yenileniyor…','Personal restore completed. Reloading the interface…')}${(result.warnings || []).length ? ` • ${result.warnings.join(' ')}` : ''}`;
      render();
      await wait(700); location.reload();
    } catch (error) {
      u.status = `${T('Hata','Error')}: ${error.message}`; u.busy = false; render();
    }
  }
  async function inspectFull() {
    const f = st.full;
    if (!f.file && !f.source) { f.status = T('Önce bir ZIP seçin.','Choose a ZIP first.'); render(); return; }
    Object.assign(f, { busy: true, uploadId: '', plan: null, status: T('Ön kontrol yapılıyor; büyük yedeklerde birkaç dakika sürebilir…','Running preflight; large backups can take a few minutes…') }); render();
    try {
      const response = f.source
        ? await fetch('/api/backups/auto/restore/inspect', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...f.source, createSafetyBackup: f.safety }) })
        : await fetch(`/api/backups/restore/inspect?createSafetyBackup=${f.safety ? '1' : '0'}`, { method: 'POST', headers: { 'Content-Type': 'application/zip' }, body: f.file });
      const data = await response.json().catch(() => ({})); if (!response.ok) throw new Error(data.error || response.statusText);
      f.uploadId = data.uploadId; f.plan = data.preflight || {};
      f.selected = new Set((f.plan.components || []).map(item => item.id));
      f.status = T('Ön kontrol tamamlandı. Geri yüklenecek veri alanlarını seçin.','Preflight complete. Choose the data areas to restore.');
    } catch (error) { f.status = `${T('Hata','Error')}: ${error.message}`; }
    finally { f.busy = false; render(); }
  }
  async function confirmFull() {
    const f = st.full, uploadId = f.uploadId;
    if (!uploadId || !f.selected.size) return;
    const components = [...f.selected];
    const total = (f.plan && f.plan.components || []).length;
    if (!confirm(T(`${components.length}/${total} veri alanı backup içeriğiyle değiştirilecek. Seçilmeyen alanlara dokunulmaz. Devam edilsin mi?`, `${components.length}/${total} data areas will be replaced with the backup contents. Unselected areas are not touched. Continue?`))) return;
    Object.assign(f, { busy: true, commitStarted: false, jobId: '' }); render();
    try {
      const response = await fetch('/api/backups/restore/start', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ uploadId, createSafetyBackup: f.safety, components }) });
      let job = await response.json().catch(() => ({})); if (!response.ok) throw new Error(job.error || response.statusText);
      f.jobId = job.id; render();
      while (!job.done && !job.error) {
        await wait(400); const poll = await fetch(`/api/backups/restore/${encodeURIComponent(f.jobId)}/status`, { cache: 'no-store' }); job = await poll.json().catch(() => ({})); if (!poll.ok) throw new Error(job.error || poll.statusText);
        const commitStarted = Boolean(job.commitStarted);
        f.status = `${job.phase || ''} • ${Number(job.current || 0).toLocaleString()}/${Number(job.total || 0).toLocaleString()}${job.bytesTotal ? ` • ${buyerLogRestoreBytes(job.bytesDone)}/${buyerLogRestoreBytes(job.bytesTotal)}` : ''}${job.item ? ` • ${job.item}` : ''}`;
        if (commitStarted !== f.commitStarted) { f.commitStarted = commitStarted; render(); }
        else { const statusNode = modal.querySelector('[data-restore-status]'); if (statusNode) statusNode.textContent = f.status; }
      }
      if (job.error) throw new Error(job.error);
      Object.assign(f, { uploadId: '', plan: null, status: `${T('Restore tamamlandı. Sunucuyu yeniden başlatın.','Restore completed. Restart the server.')}${job.result && (job.result.warnings || []).length ? ` • ${job.result.warnings.join(' ')}` : ''}` });
    } catch (error) { f.status = `${T('Hata','Error')}: ${error.message}`; }
    finally { Object.assign(f, { busy: false, jobId: '', commitStarted: false }); if (document.body.contains(modal)) render(); }
  }
  async function cancelFull() {
    const f = st.full;
    if (!f.jobId || f.commitStarted) return;
    await fetch(`/api/backups/restore/${encodeURIComponent(f.jobId)}/cancel`, { method: 'POST' }).catch(() => {});
    f.status = T('İptal istendi.','Cancellation requested.');
    const statusNode = modal.querySelector('[data-restore-status]'); if (statusNode) statusNode.textContent = f.status;
  }

  render();
  void refreshAuto();
  void refreshShared();
}
window.buyerLogBackupModal = buyerLogBackupModal;
document.getElementById('backupRestoreBtn')?.addEventListener('click', () => buyerLogBackupModal());
document.getElementById('backupSettingsBtn')?.addEventListener('click', () => buyerLogBackupModal());

(function startSharedPersonalBackupSchedule(){
  const run = () => { void buyerLogSharedPersonalBackupNow(false); };
  setTimeout(run, 45 * 1000);
  const timer = setInterval(run, 15 * 60 * 1000);
  if (timer && typeof timer.unref === 'function') timer.unref();
  window.addEventListener('online', run);
  window.addEventListener('focus', () => {
    if (Date.now() - buyerLogSharedPersonalBackupLastAttempt >= 14 * 60 * 1000) run();
  });
})();
