/* Ön Ayar Paylaşımı — kullanıcı menüsünden açılır (user-access-ui.js).
 *
 * Kullanıcı başka bir aktif kullanıcıyı seçer, onun kişisel görünüm
 * ayarlarından hangilerini alacağını işaretler ve KENDİ çalışma alanına
 * uygular. Kaynak kullanıcının ayarları değişmez. Seçenekler ve sayılar
 * sunucudan gelir (server/lib/preset-share.js); istemci yalnız seçtirir.
 *
 * Uygulanan anahtarlar BLStorage.adoptRemote ile sunucunun zaman damgasıyla
 * yerel kopyaya işlenir ve sayfa yenilenir: kapanış sırasındaki otomatik
 * kaydetmeler eski değeri geri itemez. Son aktarım "Geri Al" ile döner.
 */
(() => {
  'use strict';
  const tr = (a, b) => (typeof appLang !== 'undefined' && appLang === 'en') ? b : a;
  const esc = value => typeof escapeHtml === 'function' ? escapeHtml(String(value == null ? '' : value)) : String(value == null ? '' : value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
  const toast = message => { if (typeof showToast === 'function') showToast(message); else alert(message); };
  const PAGE_LABELS = {
    default: ['Tüm modüller', 'All modules'], overview: ['Genel Bakış', 'Overview'], cp: ['CP', 'CP'], orders: ['Siparişler', 'Orders'],
    backlog: ['Backlog', 'Backlog'], koleksiyon: ['Koleksiyon', 'Collections'], collections: ['Koleksiyon', 'Collections'],
    quotations: ['Quotations', 'Quotations'], lfl: ['Analizler', 'Analysis'], priceanalysis: ['Fiyat & Üretici Analizi', 'Price & Supplier Analysis'],
    oab: ['OAB', 'OAB'], intake: ['Intake', 'Intake'], dashboard: ['Dashboard', 'Dashboard'], reports: ['Raporlar', 'Reports'],
  };
  const pageLabel = page => { const label = PAGE_LABELS[String(page || '').toLowerCase()]; return label ? tr(label[0], label[1]) : String(page || ''); };

  async function request(url, options = {}) {
    const response = await fetch(url, { credentials: 'same-origin', cache: 'no-store', ...options, headers: { Accept: 'application/json', ...(options.body ? { 'Content-Type': 'application/json' } : {}) } });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || tr('İşlem tamamlanamadı.', 'The operation could not be completed.'));
    return result;
  }

  let modal = null;
  function close() {
    if (!modal) return;
    document.removeEventListener('keydown', modal._onKey, true);
    modal.remove(); modal = null;
  }

  function adoptAndReload(result, message, notice) {
    try { if (window.BLStorage && typeof BLStorage.adoptRemote === 'function') BLStorage.adoptRemote(result.entries || {}, result.removedKeys || []); } catch (_) {}
    const status = modal && modal.querySelector('[data-ps-status]');
    if (status) { status.textContent = message; status.hidden = false; }
    modal && modal.querySelectorAll('button,input').forEach(control => { control.disabled = true; });
    try { sessionStorage.setItem('bl.presetShare.notice', notice || message); } catch (_) {}
    setTimeout(() => location.reload(), 400);
  }

  async function open() {
    close();
    const state = { users: [], undo: { available: false }, search: '', sourceId: '', preview: null, selected: new Set(), mode: 'MERGE', busy: false };
    modal = document.createElement('div'); modal.className = 'warnOverlay'; modal.id = 'presetShareModal';
    modal.innerHTML = `<div class="modalCard presetShareCard" role="dialog" aria-modal="true" aria-labelledby="presetShareTitle">
      <div class="modalTitle" id="presetShareTitle">${esc(tr('Ön Ayar Paylaşımı', 'Preset Sharing'))}</div>
      <div class="muted presetShareHelp">${esc(tr('Bir kullanıcı seçin ve onun kişisel görünüm ayarlarından hangilerini kendi çalışma alanınıza alacağınızı işaretleyin. Kaynak kullanıcının ayarları değişmez; yetki ve veri kapsamınız etkilenmez.', 'Choose a user and tick which of their personal view settings to bring into your own workspace. The source user’s settings are not changed; your permissions and data scope are not affected.'))}</div>
      <div class="presetShareBody">
        <div class="presetShareUsers" role="group" aria-label="${esc(tr('Kullanıcılar', 'Users'))}">
          <input type="search" class="presetShareSearch" data-ps-search placeholder="${esc(tr('Kullanıcı ara…', 'Search users…'))}" autocomplete="off">
          <div class="presetShareUserList" data-ps-users role="radiogroup" aria-label="${esc(tr('Kaynak kullanıcı', 'Source user'))}"><div class="muted presetShareEmpty">${esc(tr('Yükleniyor…', 'Loading…'))}</div></div>
        </div>
        <div class="presetShareItems" data-ps-items aria-live="polite"></div>
      </div>
      <div class="presetShareStatus" data-ps-status hidden></div>
      <div class="modalFoot"><button type="button" class="tbtn" data-ps-undo hidden>${esc(tr('Son aktarımı geri al', 'Undo last transfer'))}</button><span></span><button type="button" class="tbtn" data-ps-close>${esc(tr('Vazgeç', 'Cancel'))}</button><button type="button" class="tbtn primary" data-ps-apply disabled>${esc(tr('Seçilenleri Al', 'Take Selected'))}</button></div>
    </div>`;
    document.body.appendChild(modal);
    modal._onKey = event => { if (event.key === 'Escape') { event.stopPropagation(); close(); } };
    document.addEventListener('keydown', modal._onKey, true);
    modal.addEventListener('click', event => { if (event.target === modal) close(); });
    modal.querySelector('[data-ps-close]').addEventListener('click', close);
    const searchInput = modal.querySelector('[data-ps-search]');
    searchInput.addEventListener('input', () => { state.search = searchInput.value; renderUsers(); });
    searchInput.focus();

    function renderUsers() {
      const host = modal && modal.querySelector('[data-ps-users]'); if (!host) return;
      const q = state.search.trim().toLocaleLowerCase('tr-TR');
      const users = state.users.filter(user => !q || [user.name, user.title, user.role].some(value => String(value || '').toLocaleLowerCase('tr-TR').includes(q)));
      host.innerHTML = users.length ? users.map(user => `<label class="presetShareUser${state.sourceId === user.id ? ' isActive' : ''}"><input type="radio" name="presetShareSource" value="${esc(user.id)}" ${state.sourceId === user.id ? 'checked' : ''}><span class="presetShareUserName">${esc(user.name)}</span><span class="presetShareUserMeta">${esc([...new Set([user.title, user.role].filter(Boolean))].join(' · '))}</span></label>`).join('')
        : `<div class="muted presetShareEmpty">${esc(state.users.length ? tr('Eşleşen kullanıcı yok.', 'No matching user.') : tr('Ayarlarını alabileceğiniz başka aktif kullanıcı yok.', 'There is no other active user to take settings from.'))}</div>`;
    }
    function renderItems() {
      const host = modal && modal.querySelector('[data-ps-items]'); if (!host) return;
      const apply = modal.querySelector('[data-ps-apply]');
      if (!state.sourceId) { host.innerHTML = `<div class="muted presetShareEmpty">${esc(tr('Önce ayarlarını almak istediğiniz kullanıcıyı seçin.', 'First choose the user whose settings you want to take.'))}</div>`; apply.disabled = true; return; }
      if (!state.preview) { host.innerHTML = `<div class="muted presetShareEmpty">${esc(tr('Kullanıcının ayarları okunuyor…', 'Reading the user’s settings…'))}</div>`; apply.disabled = true; return; }
      const items = state.preview.items || [];
      host.innerHTML = `<fieldset class="presetShareFieldset"><legend>${esc(tr(`${state.preview.user.name} kullanıcısından alınacaklar`, `What to take from ${state.preview.user.name}`))}</legend>${items.map(item => {
        const empty = !item.count, pages = (item.pages || []).map(pageLabel).filter(Boolean);
        const meta = empty ? tr('Bu kullanıcıda kayıt yok', 'Nothing saved by this user') : [pages.length ? pages.join(', ') : '', `${item.count} ${tr('ayar', 'setting(s)')}`].filter(Boolean).join(' · ');
        return `<label class="presetShareItem${empty ? ' isEmpty' : ''}"><input type="checkbox" data-ps-item="${esc(item.id)}" ${state.selected.has(item.id) ? 'checked' : ''} ${empty ? 'disabled' : ''}><span><span class="presetShareItemLabel">${esc(tr(item.labelTr, item.labelEn))}</span><small>${esc(tr(item.hintTr, item.hintEn))}</small><small class="presetShareItemMeta">${esc(meta)}</small></span></label>`;
      }).join('')}</fieldset>
      <fieldset class="presetShareFieldset presetShareMode"><legend>${esc(tr('Aktarım biçimi', 'Transfer mode'))}</legend>
        <label class="presetShareItem"><input type="radio" name="presetShareMode" value="MERGE" ${state.mode === 'MERGE' ? 'checked' : ''}><span><span class="presetShareItemLabel">${esc(tr('Birleştir (önerilen)', 'Merge (recommended)'))}</span><small>${esc(tr('Kaynağın ayarı olan sayfalar alınır; kendi diğer sayfalarınız, sütunlarınız ve görünümleriniz korunur.', 'Pages the source has settings for are taken; your other pages, columns and views are kept.'))}</small></span></label>
        <label class="presetShareItem"><input type="radio" name="presetShareMode" value="REPLACE" ${state.mode === 'REPLACE' ? 'checked' : ''}><span><span class="presetShareItemLabel">${esc(tr('Değiştir', 'Replace'))}</span><small>${esc(tr('Seçili alanlardaki mevcut ayarlarınız tamamen kaynağınkiyle değiştirilir.', 'Your current settings in the selected areas are fully replaced by the source’s.'))}</small></span></label>
      </fieldset>`;
      apply.disabled = state.busy || !state.selected.size;
    }
    function renderUndo() {
      const button = modal && modal.querySelector('[data-ps-undo]'); if (!button) return;
      button.hidden = !(state.undo && state.undo.available);
      if (state.undo && state.undo.createdAt) button.title = new Date(state.undo.createdAt).toLocaleString();
    }

    async function selectSource(id) {
      state.sourceId = id; state.preview = null; state.selected = new Set();
      renderUsers(); renderItems();
      try {
        const preview = await request(`/api/preset-share/preview/${encodeURIComponent(id)}`);
        if (!modal || state.sourceId !== id) return;
        state.preview = preview;
        state.selected = new Set((preview.items || []).filter(item => item.defaultSelected && item.count).map(item => item.id));
        renderItems();
      } catch (error) { if (modal && state.sourceId === id) { state.sourceId = ''; renderUsers(); renderItems(); toast(error.message); } }
    }

    modal.addEventListener('change', event => {
      const source = event.target.closest('input[name="presetShareSource"]'); if (source) { void selectSource(source.value); return; }
      const item = event.target.closest('[data-ps-item]'); if (item) { if (item.checked) state.selected.add(item.dataset.psItem); else state.selected.delete(item.dataset.psItem); renderItems(); return; }
      const mode = event.target.closest('input[name="presetShareMode"]'); if (mode) state.mode = mode.value === 'REPLACE' ? 'REPLACE' : 'MERGE';
    });
    modal.querySelector('[data-ps-apply]').addEventListener('click', async () => {
      if (state.busy || !state.sourceId || !state.selected.size) return;
      if (state.mode === 'REPLACE' && !confirm(tr('Seçili alanlardaki mevcut kişisel ayarlarınız kaynağınkiyle değiştirilecek. Devam edilsin mi? (Son aktarım geri alınabilir.)', 'Your current personal settings in the selected areas will be replaced by the source’s. Continue? (The last transfer can be undone.)'))) return;
      state.busy = true; renderItems();
      try {
        const result = await request('/api/preset-share/apply', { method: 'POST', body: JSON.stringify({ sourceUserId: state.sourceId, items: [...state.selected], mode: state.mode }) });
        if (!result.changed) { state.busy = false; renderItems(); toast(tr('Ayarlarınız zaten bu kullanıcınınkiyle aynı; değişiklik yapılmadı.', 'Your settings already match this user’s; nothing was changed.')); return; }
        const horizonNote = state.selected.has('horizon') ? tr(' Yeni Horizon bir sonraki veri yenilemesinde uygulanır.', ' The new Horizon applies on the next data refresh.') : '';
        const done = tr(`${result.sourceName || ''} kullanıcısının ayarları alındı.`, `Settings were taken from ${result.sourceName || ''}.`);
        adoptAndReload(result, `${done} ${tr('Sayfa yenileniyor…', 'Reloading…')}`, done + horizonNote + tr(' Geri almak için: Kullanıcı menüsü → Ön Ayar Paylaşımı → Son aktarımı geri al.', ' To undo: user menu → Preset Sharing → Undo last transfer.'));
      } catch (error) { state.busy = false; renderItems(); toast(error.message); }
    });
    modal.querySelector('[data-ps-undo]').addEventListener('click', async () => {
      if (state.busy) return;
      if (!confirm(tr('Son ön ayar aktarımından önceki ayarlarınız geri yüklensin mi?', 'Restore your settings from before the last preset transfer?'))) return;
      state.busy = true;
      try {
        const result = await request('/api/preset-share/undo', { method: 'POST', body: '{}' });
        adoptAndReload(result, tr('Önceki ayarlarınız geri yüklendi. Sayfa yenileniyor…', 'Your previous settings were restored. Reloading…'), tr('Önceki ayarlarınız geri yüklendi.', 'Your previous settings were restored.'));
      } catch (error) { state.busy = false; toast(error.message); }
    });

    renderItems();
    try {
      const result = await request('/api/preset-share/users');
      if (!modal) return;
      state.users = Array.isArray(result.users) ? result.users : [];
      state.undo = result.undo || { available: false };
      renderUsers(); renderUndo();
    } catch (error) { if (modal) { state.users = []; renderUsers(); toast(error.message); } }
  }

  window.BLPresetShare = { open, close };
})();
