/* ===================================================================
   BAĞLANTI DÜZENLEYİCİSİ (v7.81, §7 — eski ekrandan taşınan yetenek)

   Kaynak ayrıntısındaki "Bağlantı" satırından açılır: ad, sunucu, model
   ve "yenilemede kullan" anahtarı.

   SUNUCU/MODEL DEĞİŞİMİ SESSİZ BİR OLAY DEĞİLDİR. Başka bir modele
   geçmek, kayıtlı alan eşlemesinin var olmayan sütunlara işaret etmesi
   demek olabilir. Eşleme SİLİNMEZ (kullanıcı kopyalanmış bir modele
   geçiyor olabilir) ama uyarı yutulmaz — sunucunun döndürdüğü uyarı
   ekrana taşınır.

   SINAMA KAYDETMEDEN YAPILIR. Yanlış yazılmış bir sunucu adı ancak bir
   sonraki yenilemede patlardı; "Sına" gerçekten bağlanır ve kaç tablo
   gördüğünü söyler. Hiçbir şey yazmaz.

   AÇ/KAPAT AYRI BİR KARARDIR. Rol başına tek aktif kaynak kuralı db.js'de
   yaşar ve ikinci aktif kaydı sessizce kapatır; bu yüzden sunucu reddi
   (ROLE_ALREADY_ACTIVE) yutulmaz, olduğu gibi gösterilir — kullanıcı
   "açtım ama kapalı kaldı" dememeli.
   =================================================================== */
(() => {
  'use strict';

  const en = () => typeof appLang !== 'undefined' && appLang === 'en';
  const T = (tr, enText) => (en() ? enText : tr);
  const esc = value => (typeof escapeHtml === 'function'
    ? escapeHtml(String(value == null ? '' : value))
    : String(value == null ? '' : value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch])));

  let host = null;
  let context = null;     // {sourceId, name, server, catalog, enabled, revision, moduleLabels[]}
  let draft = null;
  let busy = false;
  let messages = [];
  let messageTone = 'info';
  let probe = null;       // {tableCount, provider, elapsedMs}
  let onSaved = null;
  let onClosed = null;

  const TONE_RANK = { info: 0, warn: 1, bad: 2 };
  function say(text, tone = 'info') {
    const value = String(text || '').trim();
    if (!value) return;
    if (!messages.includes(value)) messages.push(value);
    if (TONE_RANK[tone] > TONE_RANK[messageTone]) messageTone = tone;
  }

  /* ---------------------------------------------------------------- */

  function readDraft() {
    if (!host || !draft) return;
    const get = id => (host.querySelector(id) || {}).value;
    const name = get('#_dmcnName'); if (name != null) draft.name = name;
    const server = get('#_dmcnServer'); if (server != null) draft.server = server;
    const catalog = get('#_dmcnCatalog'); if (catalog != null) draft.catalog = catalog;
  }

  function changed() {
    return draft.name.trim() !== context.name.trim()
      || draft.server.trim() !== context.server.trim()
      || draft.catalog.trim() !== context.catalog.trim();
  }

  function render() {
    if (!host) return;
    const modelMoved = draft.server.trim() !== context.server.trim() || draft.catalog.trim() !== context.catalog.trim();

    host.innerHTML = `<div class="dmConnEditor" role="region" aria-label="${esc(context.name)}">
      <div class="dmfHead">
        <span class="dmfTitle">${esc(T('Bağlantı', 'Connection'))} — ${esc(context.name)}</span>
      </div>

      <div class="dmcnGrid">
        <label class="dmfNameField">
          <span class="dmLabel">${esc(T('Ad', 'Name'))}</span>
          <input type="text" id="_dmcnName" value="${esc(draft.name)}" maxlength="80" autocomplete="off">
        </label>
        <label class="dmfNameField">
          <span class="dmLabel">${esc(T('Sunucu', 'Server'))}</span>
          <input type="text" id="_dmcnServer" value="${esc(draft.server)}" maxlength="128" spellcheck="false" autocomplete="off">
        </label>
        <label class="dmfNameField">
          <span class="dmLabel">${esc(T('Model', 'Model'))}</span>
          <input type="text" id="_dmcnCatalog" value="${esc(draft.catalog)}" maxlength="128" spellcheck="false" autocomplete="off">
        </label>
      </div>

      ${modelMoved ? `<p class="dmfMessage is-warn">${esc(T(
        'Sunucu veya model değişiyor. Alan eşlemesi SİLİNMEZ ama yeni modelde var olmayan sütunlara işaret ediyor olabilir; kaydettikten sonra gözden geçirin.',
        'The server or model is changing. The field mapping is NOT deleted, but it may point at columns that do not exist in the new model; review it after saving.'))}</p>` : ''}

      <label class="dmcnToggle">
        <input type="checkbox" id="_dmcnEnabled" ${draft.enabled ? 'checked' : ''} ${busy ? 'disabled' : ''}>
        <span><strong>${esc(T('Yenilemede kullan', 'Use in refresh'))}</strong>
          <span class="dmsHint">${esc(draft.enabled
            ? T(`Kapatırsanız ${context.moduleLabels.length ? context.moduleLabels.join(', ') : 'bu kaynağa bağlı modüller'} bu kaynaktan veri almaz; ayarlar korunur.`,
              `If you turn this off, ${context.moduleLabels.length ? context.moduleLabels.join(', ') : 'the modules bound to it'} stop receiving data from this source; settings are kept.`)
            : T('Bu kaynak şu an yenileme akışının dışında.', 'This source is currently outside the refresh flow.'))}</span></span>
      </label>

      ${probe ? `<div class="dmqProbe">
        <span class="dmqProbeHead">${esc(T(`Bağlandı · ${probe.tableCount} tablo · ${probe.elapsedMs} ms`, `Connected · ${probe.tableCount} tables · ${probe.elapsedMs} ms`))}</span>
        ${probe.provider ? `<span class="dmsHint">${esc(probe.provider)}</span>` : ''}
      </div>` : ''}

      <div class="dmfFoot">
        <button type="button" class="tbtn" data-try ${busy ? 'disabled' : ''}
          title="${esc(T('Yazdığınız sunucu ve modele gerçekten bağlanır; hiçbir şey kaydetmez.', 'Actually connects to the server and model you typed; saves nothing.'))}">
          ${esc(T('Sına', 'Test'))}</button>
        <span class="dmfSpacer"></span>
        ${messages.length ? `<span class="dmfMessage is-${esc(messageTone)}">${messages.map(esc).join(' ')}</span>` : ''}
        <button type="button" class="tbtn" data-close ${busy ? 'disabled' : ''}>${esc(T('Kapat', 'Close'))}</button>
        <button type="button" class="navActionBtn" data-save ${busy ? 'disabled' : ''}>${esc(T('Kaydet', 'Save'))}</button>
      </div>
    </div>`;
  }

  /* ---------------------------------------------------------------- */

  async function tryConnect() {
    readDraft();
    busy = true; messages = []; messageTone = 'info'; probe = null; render();
    try {
      const response = await fetch('/api/model-connections/inspect', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ server: draft.server, catalog: draft.catalog }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.ok) throw new Error(payload.error || T('Bağlanılamadı.', 'Could not connect.'));
      probe = { tableCount: payload.tableCount, provider: payload.provider || '', elapsedMs: payload.elapsedMs };
    } catch (error) {
      say(String(error && error.message || error), 'bad');
    } finally {
      busy = false; render();
    }
  }

  async function patch(body) {
    const response = await fetch(`/api/data-management/source/${encodeURIComponent(context.sourceId)}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...body, expectedSourceRevision: context.revision }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.ok) throw new Error(payload.error || T('Kaydedilemedi.', 'Could not save.'));
    /* Sürüm TAZELENİR: aynı oturumda iki ayrı yazma (alanlar + anahtar)
       yapıyoruz ve ikincisi birincinin değiştirdiği sürümle çarpışmamalı. */
    if (payload.revision) context.revision = payload.revision;
    return payload;
  }

  async function save() {
    readDraft();
    const enabledBox = host.querySelector('#_dmcnEnabled');
    if (enabledBox) draft.enabled = enabledBox.checked;

    if (!draft.name.trim()) { say(T('Kaynağa bir ad verin.', 'Give the source a name.'), 'warn'); render(); return; }

    busy = true; messages = []; messageTone = 'info'; render();
    try {
      /* İKİ AYRI YAZMA, İKİ AYRI KARAR. Alanlar ile "yenilemede kullan"
         anahtarını tek gövdede göndermek, sunucunun aç/kapat reddini
         (ROLE_ALREADY_ACTIVE) ad değişikliğiyle birlikte geri almak demekti.
         Ayrı gidince ad kaydedilir, anahtar reddi ayrıca söylenir. */
      if (changed()) {
        const saved = await patch({ name: draft.name, server: draft.server, catalog: draft.catalog });
        (saved.warnings || []).forEach(text => say(text, 'warn'));
      }
      if (draft.enabled !== context.enabled) {
        const saved = await patch({ enabled: draft.enabled });
        (saved.warnings || []).forEach(text => say(text, 'warn'));
      }
      const reopen = typeof onSaved === 'function' ? onSaved : null;
      const carried = messages.slice();
      close({ notify: false });
      if (reopen) await reopen(carried);
      return;
    } catch (error) {
      say(String(error && error.message || error), 'bad');
    } finally {
      if (host) { busy = false; render(); }
    }
  }

  function onClick(event) {
    if (event.target.closest('[data-close]')) { close(); return; }
    if (event.target.closest('[data-try]')) { void tryConnect(); return; }
    if (event.target.closest('[data-save]')) { void save(); return; }
  }

  function onInput(event) {
    const id = event.target && event.target.id;
    if (id === '_dmcnName') draft.name = event.target.value;
    if (id === '_dmcnServer' || id === '_dmcnCatalog') {
      draft[id === '_dmcnServer' ? 'server' : 'catalog'] = event.target.value;
      // Uyarı bandı sunucu/model değişince belirmeli; yazarken yeniden çizmek
      // imleci kaybettireceği için YALNIZ banda karar veren durum güncellenir.
      const note = host.querySelector('.dmfMessage.is-warn');
      const moved = draft.server.trim() !== context.server.trim() || draft.catalog.trim() !== context.catalog.trim();
      if (moved && !note) render();
    }
  }

  function onChange(event) {
    if (event.target && event.target.id === '_dmcnEnabled') draft.enabled = event.target.checked;
  }

  /* ---------------------------------------------------------------- */

  function close({ notify = true } = {}) {
    if (!host) return;
    const notifier = notify ? onClosed : null;
    host.innerHTML = '';
    host.classList.remove('isOpen');
    host.removeEventListener('click', onClick);
    host.removeEventListener('input', onInput);
    host.removeEventListener('change', onChange);
    host = null;
    context = null;
    draft = null;
    probe = null;
    busy = false;
    if (typeof notifier === 'function') notifier();
  }

  function open(container, options = {}) {
    close();
    host = container;
    context = { ...options, moduleLabels: options.moduleLabels || [] };
    onSaved = options.onSaved || null;
    onClosed = options.onClosed || null;
    draft = {
      name: String(options.name || ''),
      server: String(options.server || ''),
      catalog: String(options.catalog || ''),
      enabled: options.enabled !== false,
    };
    messages = []; messageTone = 'info'; busy = false; probe = null;

    host.classList.add('isOpen');
    host.addEventListener('click', onClick);
    host.addEventListener('input', onInput);
    host.addEventListener('change', onChange);
    render();
  }

  window.BLDataConnection = { open, close };
})();
