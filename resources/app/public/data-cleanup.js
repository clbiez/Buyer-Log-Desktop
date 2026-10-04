/* ===================================================================
   DATA TEMİZLİĞİ — Veri Yönetimi › Depolama ve bakım aracı.

   Sunucu (server/lib/data-cleanup.js) kurulum klasörünü ya da Shared Sync
   klasörünü tarar ve silinebilir öğeleri listeler. Bu yüzey yalnız:
     · özeti ve listeyi gösterir,
     · kullanıcının seçtiği KİMLİKLERİ gönderir (yol değil),
     · sonucu özetler.
   Sync kapsamı yalnız Moderatöre görünür; sunucu da ayrıca reddeder.
   Görsel dil Data Maintenance paneliyle ortaktır (blDataMaint* sınıfları);
   paralel bir bileşen sistemi kurulmadı.
   =================================================================== */
(function () {
  'use strict';

  const en = () => (typeof appLang !== 'undefined' ? appLang : window.appLang) === 'en';
  const T = (tr, enText) => (en() ? enText : tr);
  const esc = value => String(value == null ? '' : value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const bytes = value => {
    const n = Math.max(0, Number(value) || 0);
    if (n < 1024) return `${n} B`;
    const units = ['KB', 'MB', 'GB', 'TB']; let v = n / 1024, i = 0;
    while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
    return `${v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v.toFixed(2)} ${units[i]}`;
  };
  const isModerator = () => Boolean(window.BLIsModerator && window.BLIsModerator());

  const KIND_LABELS = {
    archive: ['Kurulum arşivi', 'Setup archive'],
    installer: ['Kurulum dosyası', 'Installer'],
    temp: ['Geçici dosya', 'Temporary file'],
    'old-copy': ['Eski kurulum kopyası', 'Old install copy'],
    'stale-backup': ['Eski yedek', 'Stale backup'],
    'stale-checkpoint': ['Eski checkpoint', 'Old checkpoint'],
    'dev-artifact': ['Build çıktısı', 'Build output'],
    'old-version': ['Eski sürüm', 'Old version'],
    cache: ['Önbellek', 'Cache'],
    'browser-cache': ['Tarayıcı önbelleği', 'Browser cache'],
    export: ['Eski export', 'Old export'],
    log: ['Eski log', 'Old log'],
    unknown: ['Tanınmayan', 'Unrecognised'],
  };
  const REASONS = {
    'setup-archive': ['Kurulum ya da güncelleme sırasında kalmış arşiv; program çalışmak için kullanmıyor.', 'Archive left over from setup or an update; the program does not use it.'],
    'setup-installer': ['Programın kendisi olmayan kurulum dosyası.', 'An installer that is not the program itself.'],
    'temp-file': ['Geçici/yarım kalmış dosya.', 'Temporary or incomplete file.'],
    'old-install-copy': ['Eski bir Buyer Log kopyası; son 7 günde kullanılmamış.', 'An old Buyer Log copy; not used in the last 7 days.'],
    'copy-recently-used': ['Buyer Log kopyası son 7 günde kullanılmış; kontrol etmeden silmeyin.', 'This Buyer Log copy was used in the last 7 days; check before deleting.'],
    'older-data-backup': ['Daha yeni bir data yedeği var; en yeni yedek korunur.', 'A newer data backup exists; the newest backup is kept.'],
    'build-output': ['Geliştirici/release build çıktısı; çalışma için gerekmez.', 'Developer/release build output; not needed to run.'],
    'old-app-version': ['Aktif, son sağlam ve bekleyen sürüm dışında kalan eski uygulama sürümü.', 'An old app version other than the active, last-known-good and pending ones.'],
    'old-update-package': ['Eski sürümün indirilmiş güncelleme paketi.', 'Downloaded update package of an old version.'],
    'partial-update': ['Yarım kalmış güncelleme açma işlemi.', 'An incomplete update extraction.'],
    'app-temp': ['Uygulamanın 24 saatten eski geçici dosyaları.', 'App temporary files older than 24 hours.'],
    'rebuildable-cache': ['Yeniden üretilebilir önbellek.', 'Rebuildable cache.'],
    'expired-export': ['Süresi dolmuş export.', 'Expired export.'],
    'old-log': ['30 günden eski log.', 'Log older than 30 days.'],
    'unknown-install-item': ['Programın çalışmasıyla ilgili değil; sizin dosyanız olabilir, kontrol edip seçin.', 'Not related to running the program; it may be your file, review before selecting.'],
    'older-user-backup': ['Kullanıcının daha yeni bir yedeği var; son yedek korunur.', 'The user has a newer backup; the latest backup is kept.'],
    'old-checkpoint': ['Referans verilmeyen eski checkpoint nesli.', 'Unreferenced old checkpoint generation.'],
    'abandoned-temp': ['24 saatten eski, terk edilmiş geçici dosya ve kilitler.', 'Abandoned temporary files and locks older than 24 hours.'],
    'stray-archive': ['Sync klasörüne bırakılmış arşiv; senkron kullanmıyor.', 'Archive dropped into the sync folder; sync does not use it.'],
    'unknown-sync-item': ['Sync yapısının parçası değil; kontrol edip seçin.', 'Not part of the sync layout; review before selecting.'],
  };
  const KEPT_LABELS = {
    'program-files': ['Program dosyaları', 'Program files'],
    'latest-data-backup': ['En yeni data yedeği', 'Newest data backup'],
    'latest-user-backup': ['Kullanıcının son yedeği', 'User latest backup'],
    'sync-packages': ['Senkron paketleri (diğer kullanıcılar kullanıyor)', 'Sync packages (used by other users)'],
    'shared-iam': ['Ortak yetki verisi', 'Shared access data'],
    'shared-master': ['Ortak ana veri', 'Shared master data'],
    'shared-business': ['Ortak iş verisi', 'Shared business data'],
    'shared-images': ['Ortak model görselleri', 'Shared model images'],
  };
  const ERRORS = {
    MODERATOR_REQUIRED: ['Sync klasörünü yalnız Moderatör temizleyebilir.', 'Only the Moderator can clean the sync folder.'],
    SYNC_NOT_CONFIGURED: ['Sync klasörü ayarlanmamış.', 'The sync folder is not configured.'],
    SYNC_ACTIVE_BLOCKS_CLEANUP: ['Senkron sürüyor; aktarım bitince tekrar deneyin.', 'Sync is running; try again after the transfer finishes.'],
    CLEANUP_EMPTY_SELECTION: ['Silinecek öğe seçilmedi.', 'No items are selected.'],
  };
  const pick = (map, key, fallback) => { const pair = map[key]; return pair ? T(pair[0], pair[1]) : (fallback == null ? key : fallback); };

  async function request(url, opts = {}) {
    const response = await fetch(url, opts);
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.ok === false) {
      const error = new Error(pick(ERRORS, data.code, data.error || response.statusText));
      error.code = data.code; throw error;
    }
    return data;
  }

  function open(host, { onClose } = {}) {
    if (!host) return;
    const state = { scope: 'local', plan: null, selected: new Set(), busy: false, result: null };
    const wrap = document.createElement('div');
    wrap.className = 'blDataMaintInline';
    wrap.id = '_blDataCleanup';
    host.innerHTML = '';
    host.appendChild(wrap);

    const close = () => { wrap.remove(); if (typeof onClose === 'function') onClose(); };

    function selectionTotals() {
      let count = 0, size = 0;
      for (const item of (state.plan && state.plan.items) || []) if (state.selected.has(item.id)) { count += 1; size += item.size; }
      return { count, size };
    }

    function render(statusText = '', statusKind = '') {
      const plan = state.plan, moderator = isModerator();
      const sum = plan ? plan.summary : null, sel = selectionTotals();
      const items = plan ? plan.items : [];
      const scopeBtn = (scope, label, title) => `<button type="button" class="tbtn" data-dc-scope="${scope}" aria-pressed="${state.scope === scope}" title="${esc(title)}" ${state.busy ? 'disabled' : ''}>${esc(label)}</button>`;
      const result = state.result;
      wrap.innerHTML = `<div class="modalCard blDataMaintCard isInline" role="region" aria-labelledby="_blDataCleanupTitle">
        <div class="blDataMaintHead"><div><h2 id="_blDataCleanupTitle">${esc(T('Data Temizliği', 'Data Cleanup'))}</h2>
          <p>${esc(T('Programın çalışmasıyla ilgisi olmayan dosyaları bulur ve özetler. Hiçbir şey siz onaylamadan silinmez; başka kullanıcıların kullandığı veri ve son yedekler korunur.', 'Finds and summarises files that are not needed to run the program. Nothing is deleted without your confirmation; data other users rely on and the latest backups are kept.'))}</p></div>
          <button type="button" class="pricingRuleIconBtn blDataMaintClose" data-dc-close title="${esc(T('Kapat', 'Close'))}"><svg class="ic"><use href="#i-x"/></svg></button></div>
        <div class="blDataMaintToolbar">
          <span data-bl-choicebar role="group" aria-label="${esc(T('Temizlik kapsamı', 'Cleanup scope'))}">${scopeBtn('local', T('Yerel · kurulum klasörü', 'Local · install folder'), T('Buyer Log\'un kurulu olduğu klasör ve yerel önbellekler', 'The Buyer Log install folder and local caches'))}
          ${moderator ? scopeBtn('sync', T('Sync klasörü', 'Sync folder'), T('Ortak sync klasörü — yalnız Moderatör', 'Shared sync folder — Moderator only')) : `<span class="blDataCleanupHint">${esc(T('Sync klasörü temizliği yalnız Moderatöre açıktır.', 'Sync folder cleanup is available to the Moderator only.'))}</span>`}</span>
          <span style="flex:1"></span>
          <button type="button" class="tbtn" data-dc="scan" ${state.busy ? 'disabled' : ''}><svg class="ic"><use href="#i-search"/></svg>${esc(T('Yeniden Tara', 'Rescan'))}</button>
          <button type="button" class="tbtn" data-dc="recommended" ${state.busy || !items.length ? 'disabled' : ''}>${esc(T('Önerilenleri Seç', 'Select Recommended'))}</button>
          <button type="button" class="tbtn" data-dc="all" ${state.busy || !items.length ? 'disabled' : ''}>${esc(T('Tümünü Seç', 'Select All'))}</button>
          <button type="button" class="tbtn" data-dc="none" ${state.busy || !items.length ? 'disabled' : ''}>${esc(T('Seçimi Kaldır', 'Clear Selection'))}</button>
          <button type="button" class="tbtn actionDanger" data-action-role="danger" data-dc="apply" ${state.busy || !sel.count ? 'disabled' : ''}><svg class="ic"><use href="#i-trash"/></svg>${esc(T('Seçilenleri Sil', 'Delete Selected'))}</button>
        </div>
        <div class="blDataMaintBody">
          <div class="blDataMaintStatus${statusKind ? ` ${statusKind}` : ''}" data-dc-status role="status">${esc(statusText || T('Hazır.', 'Ready.'))}</div>
          ${result ? `<div class="blDataMaintSummary">
            <div class="blDataMaintMetric"><span>${esc(T('Silinen', 'Deleted'))}</span><strong>${Number(result.removed) || 0}</strong></div>
            <div class="blDataMaintMetric"><span>${esc(T('Boşalan alan', 'Space freed'))}</span><strong>${esc(bytes(result.freed))}</strong></div>
            <div class="blDataMaintMetric"><span>${esc(T('Başarısız', 'Failed'))}</span><strong>${Number(result.failed) || 0}</strong></div>
            <div class="blDataMaintMetric"><span>${esc(T('Atlanan', 'Skipped'))}</span><strong>${Number(result.skipped) || 0}</strong></div>
          </div>` : ''}
          ${plan ? `<div class="blDataMaintSummary">
            <div class="blDataMaintMetric"><span>${esc(T('Bulunan', 'Found'))}</span><strong>${Number(sum.count) || 0} · ${esc(bytes(sum.size))}</strong></div>
            <div class="blDataMaintMetric"><span>${esc(T('Seçili', 'Selected'))}</span><strong data-dc-selected>${sel.count} · ${esc(bytes(sel.size))}</strong></div>
            <div class="blDataMaintMetric"><span>${esc(T('Korunan', 'Kept'))}</span><strong>${esc(bytes(sum.keptSize))}</strong></div>
            <div class="blDataMaintMetric" title="${esc(plan.root || '')}"><span>${esc(T('Klasör', 'Folder'))}</span><strong>${esc(plan.root ? plan.root.split(/[\\/]/).filter(Boolean).pop() : T('Algılanamadı', 'Not detected'))}</strong></div>
          </div>
          ${Object.keys(sum.byKind || {}).length ? `<div class="blDataCleanupKinds">${Object.entries(sum.byKind).map(([kind, v]) => `<span class="blDataMaintTag${kind === 'unknown' ? ' UNKNOWN' : ' CACHE'}">${esc(pick(KIND_LABELS, kind))} · ${v.count} · ${esc(bytes(v.size))}</span>`).join('')}</div>` : ''}
          <div class="blDataMaintSection"><div class="blDataMaintSectionHead">${esc(T('Silinebilir öğeler', 'Removable items'))}</div>
            ${items.length ? `<div style="max-height:420px;overflow:auto"><table class="blDataMaintTable"><thead><tr>
              <th><input type="checkbox" data-dc-toggle-all aria-label="${esc(T('Tümünü seç', 'Select all'))}" ${sel.count && sel.count === items.length ? 'checked' : ''}></th>
              <th>${esc(T('Tür', 'Type'))}</th><th>${esc(T('Yol', 'Path'))}</th>${state.scope === 'sync' ? `<th>${esc(T('Kullanıcı', 'User'))}</th>` : ''}<th>${esc(T('Dosya', 'Files'))}</th><th>${esc(T('Boyut', 'Size'))}</th><th>${esc(T('Neden', 'Reason'))}</th>
            </tr></thead><tbody>${items.map(item => `<tr>
              <td><input type="checkbox" data-dc-item="${esc(item.id)}" ${state.selected.has(item.id) ? 'checked' : ''} aria-label="${esc(T('Seç', 'Select'))}"></td>
              <td><span class="blDataMaintTag${item.kind === 'unknown' ? ' UNKNOWN' : ' CACHE'}">${esc(pick(KIND_LABELS, item.kind))}</span></td>
              <td class="path" title="${esc(item.path)}">${esc(item.relPath || item.path)}</td>${state.scope === 'sync' ? `<td>${esc(item.owner || '—')}</td>` : ''}
              <td class="num">${Number(item.files) || 0}</td><td class="num">${esc(bytes(item.size))}</td>
              <td>${esc(pick(REASONS, item.reason, ''))}</td></tr>`).join('')}</tbody></table></div>`
              : `<div class="blDataCleanupEmpty">${esc(T('Temizlenecek gereksiz dosya bulunamadı.', 'No unnecessary files were found.'))}</div>`}
          </div>
          ${(plan.kept || []).length ? `<details class="blDataMaintSection blDataCleanupKept"><summary class="blDataMaintSectionHead">${esc(T('Korunanlar', 'Kept'))} · ${esc(bytes(sum.keptSize))}</summary>
            <table class="blDataMaintTable"><tbody>${plan.kept.map(k => `<tr><td>${esc(pick(KEPT_LABELS, k.label))}${k.owner ? ` · ${esc(k.owner)}` : ''}</td><td class="path" title="${esc(k.path)}">${esc(k.relPath || k.path)}</td><td class="num">${Number(k.files) || 0}</td><td class="num">${esc(bytes(k.size))}</td></tr>`).join('')}</tbody></table></details>` : ''}`
          : ''}
        </div>
      </div>`;
      bind();
    }

    async function scan() {
      state.busy = true; render(T('Taranıyor…', 'Scanning…'));
      try {
        const data = await request(`/api/data-cleanup/scan?scope=${encodeURIComponent(state.scope)}`);
        state.plan = data.result;
        state.selected = new Set(state.plan.items.filter(item => item.selected).map(item => item.id));
        state.busy = false;
        const note = state.scope === 'local' && !state.plan.installRootDetected
          ? T('Kurulum klasörü algılanamadı; yalnız yerel önbellekler tarandı.', 'Install folder not detected; only local caches were scanned.')
          : T('Tarama tamamlandı. Henüz hiçbir şey silinmedi.', 'Scan complete. Nothing has been deleted yet.');
        render(note, 'isOk');
      } catch (error) {
        state.busy = false; state.plan = null; render(error.message || String(error), 'isError');
      }
    }

    async function apply() {
      const sel = selectionTotals();
      if (!sel.count) return;
      const unknown = state.plan.items.filter(item => item.kind === 'unknown' && state.selected.has(item.id)).length;
      const where = state.scope === 'sync' ? T('sync klasöründen', 'from the sync folder') : T('bu bilgisayardan', 'from this computer');
      const message = T(`${sel.count} öğe (${bytes(sel.size)}) ${where} kalıcı olarak silinsin mi?`, `Permanently delete ${sel.count} items (${bytes(sel.size)}) ${where}?`)
        + (unknown ? '\n\n' + T(`Dikkat: ${unknown} tanınmayan öğe seçili.`, `Warning: ${unknown} unrecognised items are selected.`) : '');
      if (!confirm(message)) return;
      state.busy = true; render(T('Siliniyor…', 'Deleting…'));
      try {
        const data = await request('/api/data-cleanup/apply', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ scope: state.scope, ids: [...state.selected] }) });
        state.result = data.result;
        state.busy = false;
        await scan();
        const r = state.result;
        render(T(`Temizlendi: ${r.removed} öğe · ${bytes(r.freed)} boşaldı${r.failed ? ` · ${r.failed} başarısız` : ''}.`, `Cleaned: ${r.removed} items · ${bytes(r.freed)} freed${r.failed ? ` · ${r.failed} failed` : ''}.`), r.failed ? 'isError' : 'isOk');
      } catch (error) {
        state.busy = false; render(error.message || String(error), 'isError');
      }
    }

    function bind() {
      wrap.querySelector('[data-dc-close]')?.addEventListener('click', close);
      wrap.querySelectorAll('[data-dc-scope]').forEach(btn => btn.addEventListener('click', () => {
        if (state.scope === btn.dataset.dcScope) return;
        state.scope = btn.dataset.dcScope; state.plan = null; state.result = null; void scan();
      }));
      wrap.querySelectorAll('[data-dc]').forEach(btn => btn.addEventListener('click', () => {
        const action = btn.dataset.dc, items = (state.plan && state.plan.items) || [];
        if (action === 'scan') { state.result = null; void scan(); }
        else if (action === 'apply') void apply();
        else {
          state.selected = new Set(action === 'all' ? items.map(i => i.id) : action === 'recommended' ? items.filter(i => i.selected).map(i => i.id) : []);
          render(T('Seçim güncellendi.', 'Selection updated.'));
        }
      }));
      wrap.querySelector('[data-dc-toggle-all]')?.addEventListener('change', e => {
        state.selected = new Set(e.target.checked ? state.plan.items.map(i => i.id) : []);
        render(T('Seçim güncellendi.', 'Selection updated.'));
      });
      wrap.querySelectorAll('[data-dc-item]').forEach(box => box.addEventListener('change', () => {
        if (box.checked) state.selected.add(box.dataset.dcItem); else state.selected.delete(box.dataset.dcItem);
        // Tabloyu yeniden çizmeden yalnız özet ve düğme güncellenir; kaydırma konumu korunur.
        const sel = selectionTotals(), out = wrap.querySelector('[data-dc-selected]'), applyBtn = wrap.querySelector('[data-dc="apply"]');
        if (out) out.textContent = `${sel.count} · ${bytes(sel.size)}`;
        if (applyBtn) applyBtn.disabled = state.busy || !sel.count;
      }));
    }

    wrap.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
    void scan();
  }

  window.BLDataCleanup = { open };
})();
