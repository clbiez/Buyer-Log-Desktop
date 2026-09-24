/* ===================================================================
   CP SÜTUNLARI DÜZENLEYİCİSİ (v7.81, §7 — eski ekrandan taşınan yetenek)

   Kaynak ayrıntısındaki "CP sütunları" buraya açılır.

   ALAN EŞLEMESİYLE KARIŞTIRILMAMALI — ve ekran bunu açıkça söyler:
     eşleme  → uygulamanın BEKLEDİĞİ bir başlığı bir model sütununa bağlar
     CP sütunu → uygulamanın hiç bilmediği bir sütunu CP Tracker'a taşır
   İkisini aynı listede göstermek, "neden bu alanı eşleyemiyorum?" sorusunu
   üreten karışıklığın ta kendisiydi.

   TEK İŞLEM YAZILIR. Tam listeyi göndermek, bayat bir görünümde başka bir
   pencerede eklenmiş sütunun sessizce düşmesi demekti (eşleme yazmasıyla
   aynı gerekçe).

   ŞEMA VE SEÇİCİ PAYLAŞILIR. Sütun listesi /api/model-connections/schema'dan,
   arama kutusu window.BLDataPicker'dan gelir — eşleme düzenleyicisi de aynı
   ikisini kullanıyor. İkinci bir kopya §9'a aykırı olurdu.
   =================================================================== */
(() => {
  'use strict';

  const en = () => typeof appLang !== 'undefined' && appLang === 'en';
  const T = (tr, enText) => (en() ? enText : tr);
  const esc = value => (typeof escapeHtml === 'function'
    ? escapeHtml(String(value == null ? '' : value))
    : String(value == null ? '' : value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch])));

  let host = null;
  let context = null;        // {sourceId, sourceName, server, catalog, revision, columns[]}
  let schema = null;
  /* Şema (sunucu+katalog) başına önbelleklenir: ekran her kayıttan sonra
     yeniden çizildiği için düzenleyici de yeniden açılır. Hata ÖNBELLEKLENMEZ —
     geçici bir arıza kalıcı bir engel olmamalı. */
  const schemaCache = new Map();
  let schemaError = '';
  let busy = false;
  let message = '';
  let messageTone = 'info';
  let draft = null;          // {id, label, group, entry} — düzenlenen satır
  let onSaved = null;
  let onClosed = null;

  /* ---------------------------------------------------------------- */

  async function loadSchema() {
    schemaError = '';
    const key = `${context.server}|${context.catalog}`;
    const cached = schemaCache.get(key);
    if (cached) { schema = cached; return; }
    try {
      const response = await fetch('/api/model-connections/schema', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ server: context.server, catalog: context.catalog }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.ok) throw new Error(payload.error || T('şema okunamadı', 'schema could not be read'));
      schema = { columns: payload.columns || [], measures: payload.measures || [] };
      schemaCache.set(key, schema);
    } catch (error) {
      /* Şema okunamazsa düzenleyici KAPANMAZ: kullanıcı sütun adını elle
         yazabilir. Kaynağa erişilemediği için var olan sütunların silinemez
         olması, kurtarılabilir bir durumu çıkmaza çevirirdi. */
      schema = null;
      schemaError = String(error && error.message || error);
    }
  }

  function columnEntries() {
    if (!schema) return [];
    const measures = (schema.measures || []).map(entry => ({
      value: `measure|${entry.table || ''}|${entry.name}`,
      label: entry.name,
      hint: `${T('ölçü', 'measure')}${entry.table ? ` · ${entry.table}` : ''}`,
    }));
    const columns = (schema.columns || []).map(entry => ({
      value: `column|${entry.table || ''}|${entry.name}`,
      label: entry.name,
      hint: entry.table || '',
    }));
    return measures.concat(columns);
  }

  function parseEntry(value) {
    const parts = String(value).split('|');
    return parts.length >= 3
      ? { kind: parts[0], table: parts[1], name: parts.slice(2).join('|') }
      : { kind: 'column', table: '', name: String(value) };
  }

  /* ---------------------------------------------------------------- */

  function row(column) {
    return `<li class="dmcRow">
      <span class="dmcLabel">${esc(column.label)}</span>
      <span class="dmcArrow" aria-hidden="true">←</span>
      <span class="dmcColumn">${esc(column.column)}${column.table ? `<span class="dmsHint"> · ${esc(column.table)}</span>` : ''}</span>
      <span class="dmcGroup">${column.group ? esc(column.group) : `<em>${esc(T('başlık bandı yok', 'no header band'))}</em>`}</span>
      <button type="button" class="tbtn" data-edit="${esc(column.id)}" ${busy ? 'disabled' : ''}>${esc(T('Düzenle', 'Edit'))}</button>
      <button type="button" class="dmfDrop" data-remove="${esc(column.id)}" ${busy ? 'disabled' : ''}
        title="${esc(T('Sütunu kaldır', 'Remove column'))}">🗑</button>
    </li>`;
  }

  function draftForm() {
    if (!draft) return '';
    const picked = draft.entry && draft.entry.name;
    return `<div class="dmcDraft">
      <label class="dmfNameField">
        <span class="dmLabel">${esc(T('Başlık', 'Label'))}</span>
        <input type="text" id="_dmcLabel" value="${esc(draft.label)}" maxlength="120"
          placeholder="${esc(T('CP’de görünecek ad', 'Name shown on CP'))}" autocomplete="off">
      </label>
      <label class="dmfNameField">
        <span class="dmLabel">${esc(T('Başlık bandı', 'Header band'))}</span>
        <input type="text" id="_dmcGroup" value="${esc(draft.group)}" maxlength="40"
          placeholder="${esc(T('boş bırakılabilir', 'optional'))}" autocomplete="off">
      </label>
      <div class="dmcPick">
        <span class="dmLabel">${esc(T('Model sütunu', 'Model column'))}</span>
        <button type="button" class="dmmColumn" data-pick ${busy ? 'disabled' : ''}>
          ${picked ? esc(draft.entry.name) : `<em>${esc(T('sütun seç', 'select column'))}</em>`}
        </button>
      </div>
      <div class="dmfFoot">
        <span class="dmfSpacer"></span>
        <button type="button" class="tbtn" data-cancel-draft ${busy ? 'disabled' : ''}>${esc(T('Vazgeç', 'Cancel'))}</button>
        <button type="button" class="navActionBtn" data-save-draft ${busy ? 'disabled' : ''}>${esc(T('Kaydet', 'Save'))}</button>
      </div>
    </div>`;
  }

  function render() {
    if (!host) return;
    const columns = context.columns || [];

    host.innerHTML = `<div class="dmCpColumns" role="region" aria-label="${esc(context.sourceName)}">
      <div class="dmfHead">
        <span class="dmfTitle">${esc(T('CP sütunları', 'CP columns'))} — ${esc(context.sourceName)}</span>
        <span class="dmsHint">${esc(T(
          'Alan eşlemesinden farklıdır: bunlar uygulamanın beklemediği, CP Tracker’a ek olarak taşınan model sütunlarıdır.',
          'Different from field mapping: these are model columns the application does not expect, carried onto CP Tracker as extras.'))}</span>
      </div>

      ${schemaError ? `<p class="dmfMessage is-warn">${esc(T(
        `Model şeması okunamadı (${schemaError}). Sütun adını elle yazabilirsiniz.`,
        `Model schema could not be read (${schemaError}). You can type the column name.`))}</p>` : ''}

      ${columns.length
        ? `<ul class="dmcList">${columns.map(row).join('')}</ul>`
        : `<p class="dmfEmpty">${esc(T('Henüz ek sütun yok.', 'No extra columns yet.'))}</p>`}

      ${draftForm()}

      <div class="dmfFoot">
        ${!draft ? `<button type="button" class="dmfAdd" data-new ${busy ? 'disabled' : ''}>+ ${esc(T('Sütun ekle', 'Add column'))}</button>` : ''}
        <span class="dmfSpacer"></span>
        ${message ? `<span class="dmfMessage is-${esc(messageTone)}">${esc(message)}</span>` : ''}
        <button type="button" class="tbtn" data-close ${busy ? 'disabled' : ''}>${esc(T('Kapat', 'Close'))}</button>
      </div>
    </div>`;
  }

  /* ---------------------------------------------------------------- */

  async function write(cpColumn) {
    busy = true; message = ''; render();
    try {
      const response = await fetch(`/api/data-management/source/${encodeURIComponent(context.sourceId)}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cpColumn, expectedSourceRevision: context.revision }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.ok) throw new Error(payload.error || T('Sütun kaydedilemedi.', 'Could not save the column.'));
      /* Yazdıktan sonra BU MODÜL bir şey çizmez: ekran tazelenince kendi DOM'unu
         baştan kurar ve düzenleyicinin yuvası silinir; burada render() çağırmak
         öksüz bir düğüme yazmak olurdu. Yeniden açmak çağıranın işi. */
      const reopen = typeof onSaved === 'function' ? onSaved : null;
      close({ notify: false });
      if (reopen) await reopen();
      return;
    } catch (error) {
      message = String(error && error.message || error);
      messageTone = 'bad';
    } finally {
      if (host) { busy = false; render(); }
    }
  }

  function onClick(event) {
    if (event.target.closest('[data-close]')) { close(); return; }

    if (event.target.closest('[data-new]')) {
      draft = { id: '', label: '', group: '', entry: null };
      render();
      return;
    }

    const edit = event.target.closest('[data-edit]');
    if (edit) {
      const column = (context.columns || []).find(entry => entry.id === edit.dataset.edit);
      if (column) {
        draft = {
          id: column.id, label: column.label, group: column.group,
          entry: { kind: column.kind, table: column.table, name: column.column, folder: column.folder },
        };
        render();
      }
      return;
    }

    const remove = event.target.closest('[data-remove]');
    if (remove) { void write({ op: 'remove', id: remove.dataset.remove }); return; }

    if (event.target.closest('[data-cancel-draft]')) { draft = null; message = ''; render(); return; }

    if (event.target.closest('[data-save-draft]')) {
      readDraft();
      /* Doğrulama sunucuda da var (istemciye güvenilmez, §10). Burada yapılması
         kullanıcıyı boşuna bir gidiş-dönüş beklemekten kurtarır. */
      if (!draft.label.trim()) { message = T('Sütuna bir başlık verin.', 'Give the column a label.'); messageTone = 'warn'; render(); return; }
      if (!draft.entry || !draft.entry.name) { message = T('Hangi model sütunundan geleceğini seçin.', 'Select which model column it comes from.'); messageTone = 'warn'; render(); return; }
      void write({ op: draft.id ? 'update' : 'add', id: draft.id, label: draft.label, group: draft.group, entry: draft.entry });
      return;
    }

    const pick = event.target.closest('[data-pick]');
    if (pick) {
      readDraft();
      window.BLDataPicker?.open?.(pick, columnEntries(), value => {
        draft.entry = parseEntry(value);
        // Başlık boşsa sütun adı ÖNERİLİR, dayatılmaz: kullanıcı hemen değiştirebilir.
        if (!draft.label.trim()) draft.label = draft.entry.name;
        render();
      }, {
        placeholder: schema ? T('Sütun veya ölçü ara…', 'Search columns or measures…')
          : T('Sütun adını yazıp Enter…', 'Type the column name and press Enter…'),
        allowFree: true,
      });
    }
  }

  /* Taslak alanları her yeniden çizimde sıfırlanmamalı: kullanıcı başlığı
     yazarken sütun seçerse yazdığı kaybolurdu. */
  function readDraft() {
    if (!draft || !host) return;
    const label = host.querySelector('#_dmcLabel');
    const group = host.querySelector('#_dmcGroup');
    if (label) draft.label = label.value;
    if (group) draft.group = group.value;
  }

  function onInput(event) {
    if (!draft) return;
    if (event.target && event.target.id === '_dmcLabel') draft.label = event.target.value;
    if (event.target && event.target.id === '_dmcGroup') draft.group = event.target.value;
  }

  /* ---------------------------------------------------------------- */

  function close({ notify = true } = {}) {
    window.BLDataPicker?.close?.();
    if (!host) return;
    const notifier = notify ? onClosed : null;
    host.innerHTML = '';
    host.classList.remove('isOpen');
    host.removeEventListener('click', onClick);
    host.removeEventListener('input', onInput);
    host = null;
    context = null;
    draft = null;
    busy = false;
    if (typeof notifier === 'function') notifier();
  }

  async function open(container, options = {}) {
    close();
    host = container;
    context = { ...options };
    onSaved = options.onSaved || null;
    onClosed = options.onClosed || null;
    message = ''; messageTone = 'info'; busy = false; schema = null; draft = null;

    host.classList.add('isOpen');
    host.addEventListener('click', onClick);
    host.addEventListener('input', onInput);
    host.innerHTML = `<p class="dmsHint">${esc(T('Model şeması okunuyor…', 'Reading the model schema…'))}</p>`;
    await loadSchema();
    render();
  }

  window.BLDataCpColumns = { open, close };
})();
