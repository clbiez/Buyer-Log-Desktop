/* ===================================================================
   SORGU MODU / ELLE YAZILAN DAX (v7.81, §7 — eski ekrandan taşınan yetenek)

   Kaynak ayrıntısındaki "Sorgu" satırından açılır.

   BU EKRANIN TAŞIDIĞI ASIL BİLGİ BİR UYARIDIR

   Elle yazılan sorgu, kaynağın FİLTRELERİNİ DEVRE DIŞI BIRAKIR. Kapsam
   filtreleri (Horizon) artık uygulanmaz; sınır neyse sorgunun içindedir.
   Eski ekranda bu yalnız bir açılır listeydi ve sonucu hiçbir yerde
   yazmıyordu — kullanıcı filtresini değiştirip hiçbir şeyin değişmediğini
   görüyordu. Burada mod değişimi sonucuyla birlikte söylenir.

   KAYDETMEDEN SINANIR. Hatalı bir manuel sorgu kaydedilirse bir sonraki
   yenileme çöker ve hata ancak o zaman görünür. "Sına" sorguyu gerçek
   motorda, birkaç satırla çalıştırır: hiçbir dosya yazmaz, önbelleğe
   dokunmaz. DAX'ı istemcide ayrıştırmaya ÇALIŞILMAZ — tek doğruluk
   kaynağı motorun kendisidir.
   =================================================================== */
(() => {
  'use strict';

  const en = () => typeof appLang !== 'undefined' && appLang === 'en';
  const T = (tr, enText) => (en() ? enText : tr);
  const esc = value => (typeof escapeHtml === 'function'
    ? escapeHtml(String(value == null ? '' : value))
    : String(value == null ? '' : value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch])));

  let host = null;
  let context = null;        // {sourceId, sourceName, server, catalog, engine, revision, mode, query, moduleLabels[]}
  let mode = 'auto';
  let text = '';
  let busy = false;
  let message = '';
  let messageTone = 'info';
  let probe = null;          // {rowCount, columns[], elapsedMs, truncated}
  let onSaved = null;
  let onClosed = null;

  /* ---------------------------------------------------------------- */

  function isRelational() { return context && context.engine === 'relational-sql'; }

  function warningBanner() {
    if (isRelational()) {
      return `<p class="dmfMessage is-warn">${esc(T(
        'SQL sorgusu yalnız salt-okunur SELECT / WITH biçiminde çalıştırılır. Excel bağlantısı yalnız tanımlama kaynağıdır; sorgu doğrudan database üzerinde çalışır.',
        'SQL queries run only as read-only SELECT / WITH statements. Excel is only the discovery origin; the query runs directly against the database.'))}</p>`;
    }
    if (mode !== 'manual') return '';
    const modules = (context.moduleLabels || []).join(', ');
    return `<p class="dmfMessage is-warn">${esc(T(
      `Elle yazılan sorgu, bu kaynağın kapsam filtrelerini DEVRE DIŞI bırakır${modules ? ` (${modules})` : ''}. Sınır ne olacaksa sorgunun içinde olmalı.`,
      `A hand-written query DISABLES this source's scope filters${modules ? ` (${modules})` : ''}. Whatever the limit is, it must live inside the query.`))}</p>`;
  }

  function probeBlock() {
    if (!probe) return '';
    return `<div class="dmqProbe">
      <span class="dmqProbeHead">${esc(T(
        `${probe.rowCount}${probe.truncated ? '+' : ''} satır · ${probe.elapsedMs} ms`,
        `${probe.rowCount}${probe.truncated ? '+' : ''} rows · ${probe.elapsedMs} ms`))}</span>
      ${probe.columns.length
        ? `<span class="dmsHint">${esc(T('Dönen sütunlar', 'Returned columns'))}: ${esc(probe.columns.join(', '))}</span>`
        : `<span class="dmsHint">${esc(T('Sorgu çalıştı ama satır dönmedi.', 'The query ran but returned no rows.'))}</span>`}
    </div>`;
  }

  function render() {
    if (!host) return;
    const relational = isRelational();
    const queryLabel = relational ? T('SQL sorgusu', 'SQL query') : T('DAX sorgusu', 'DAX query');
    const placeholder = relational ? 'SELECT …' : 'EVALUATE …';
    const modeUi = relational ? `<div class="dmqModes"><div class="dmqMode isFixed"><span><strong>${esc(T('Elle yazılır', 'Hand-written'))}</strong><span class="dmsHint">${esc(T('Bu bağımsız database kaynağı doğrudan SQL ile sorgulanır.', 'This standalone database source is queried directly with SQL.'))}</span></span></div></div>` : `<div class="dmqModes" role="radiogroup" aria-label="${esc(T('Sorgu modu', 'Query mode'))}">
        <label class="dmqMode">
          <input type="radio" name="_dmqMode" value="auto" ${mode === 'auto' ? 'checked' : ''} ${busy ? 'disabled' : ''}>
          <span><strong>${esc(T('Otomatik üretilir', 'Generated'))}</strong>
            <span class="dmsHint">${esc(T('Sorgu, alan eşlemesi ve kapsam filtrelerinden kurulur.', 'The query is built from the field mapping and scope filters.'))}</span></span>
        </label>
        <label class="dmqMode">
          <input type="radio" name="_dmqMode" value="manual" ${mode === 'manual' ? 'checked' : ''} ${busy ? 'disabled' : ''}>
          <span><strong>${esc(T('Elle yazılır', 'Hand-written'))}</strong>
            <span class="dmsHint">${esc(T('DAX metnini siz yazarsınız; kapsam filtreleri uygulanmaz.', 'You write the DAX; scope filters are not applied.'))}</span></span>
        </label>
      </div>`;

    host.innerHTML = `<div class="dmQueryEditor" role="region" aria-label="${esc(context.sourceName)}">
      <div class="dmfHead">
        <span class="dmfTitle">${esc(T('Sorgu', 'Query'))} — ${esc(context.sourceName)}</span>
        <span class="dmsHint">${esc(context.server)} / ${esc(context.catalog)}</span>
      </div>

      ${modeUi}
      ${warningBanner()}

      <label class="dmqField">
        <span class="dmLabel">${esc(queryLabel)}</span>
        <textarea id="_dmqText" rows="10" spellcheck="false" ${busy ? 'disabled' : ''}
          placeholder="${esc(placeholder)}">${esc(text)}</textarea>
      </label>
      ${!relational && mode === 'auto' && text.trim() ? `<p class="dmsHint">${esc(T(
        'Otomatik moddasınız; bu metin saklanıyor ama çalıştırılmıyor.',
        'You are in generated mode; this text is stored but not executed.'))}</p>` : ''}

      ${probeBlock()}

      <div class="dmfFoot">
        <button type="button" class="tbtn" data-try ${busy || !text.trim() ? 'disabled' : ''}
          title="${esc(T('Sorguyu birkaç satırla gerçekten çalıştırır; hiçbir şey kaydetmez.', 'Actually runs the query for a few rows; saves nothing.'))}">
          ${esc(T('Sına', 'Test'))}</button>
        <span class="dmfSpacer"></span>
        ${message ? `<span class="dmfMessage is-${esc(messageTone)}">${esc(message)}</span>` : ''}
        <button type="button" class="tbtn" data-close ${busy ? 'disabled' : ''}>${esc(T('Kapat', 'Close'))}</button>
        <button type="button" class="navActionBtn" data-save ${busy ? 'disabled' : ''}>${esc(T('Kaydet', 'Save'))}</button>
      </div>
    </div>`;
  }

  /* ---------------------------------------------------------------- */

  function readText() {
    const field = host && host.querySelector('#_dmqText');
    if (field) text = field.value;
  }

  async function tryQuery() {
    readText();
    busy = true; message = ''; probe = null; render();
    try {
      const relational = isRelational();
      const endpoint = relational
        ? `/api/database-sources/${encodeURIComponent(context.sourceId)}/query`
        : '/api/model-connections/try-query';
      const body = relational
        ? { query: text, maxRows: 20 }
        : { server: context.server, catalog: context.catalog, query: text, maxRows: 20 };
      const response = await fetch(endpoint, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.ok) throw new Error(payload.error || T('Sorgu çalıştırılamadı.', 'The query could not run.'));
      const rows = Array.isArray(payload.rows) ? payload.rows : [];
      probe = {
        rowCount: Number(payload.rowCount != null ? payload.rowCount : rows.length) || 0,
        columns: Array.isArray(payload.columns) ? payload.columns : (rows.length ? Object.keys(rows[0]) : []),
        elapsedMs: Number(payload.elapsedMs) || 0, truncated: Boolean(payload.truncated),
      };
      message = T('Sorgu çalıştı.', 'The query ran.');
      messageTone = 'info';
    } catch (error) {
      message = String(error && error.message || error);
      messageTone = 'bad';
    } finally {
      busy = false;
      render();
    }
  }

  async function save() {
    readText();
    if ((isRelational() || mode === 'manual') && !text.trim()) {
      message = T('Elle yazılan modda sorgu metni boş bırakılamaz.', 'The query cannot be empty in hand-written mode.');
      messageTone = 'warn';
      render();
      return;
    }
    busy = true; message = ''; render();
    try {
      const response = await fetch(`/api/data-management/source/${encodeURIComponent(context.sourceId)}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ queryMode: isRelational() ? 'manual' : mode, query: text, expectedSourceRevision: context.revision }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.ok) throw new Error(payload.error || T('Sorgu kaydedilemedi.', 'Could not save the query.'));
      /* Sunucu uyarıları YUTULMAZ: "artık filtre yerine bu metin geçerli"
         bilgisi kaydın en önemli sonucudur. */
      const warnings = payload.warnings || [];
      const reopen = typeof onSaved === 'function' ? onSaved : null;
      close({ notify: false });
      if (reopen) await reopen(warnings);
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
    if (event.target.closest('[data-try]')) { void tryQuery(); return; }
    if (event.target.closest('[data-save]')) { void save(); return; }
  }

  function onChange(event) {
    const radio = event.target.closest('input[name="_dmqMode"]');
    if (radio && !isRelational()) {
      readText();   // mod değişimi yazılmış metni kaybetmemeli
      mode = radio.value === 'manual' ? 'manual' : 'auto';
      render();
    }
  }

  function onInput(event) {
    if (event.target && event.target.id === '_dmqText') text = event.target.value;
  }

  /* ---------------------------------------------------------------- */

  function close({ notify = true } = {}) {
    if (!host) return;
    const notifier = notify ? onClosed : null;
    host.innerHTML = '';
    host.classList.remove('isOpen');
    host.removeEventListener('click', onClick);
    host.removeEventListener('change', onChange);
    host.removeEventListener('input', onInput);
    host = null;
    context = null;
    probe = null;
    busy = false;
    if (typeof notifier === 'function') notifier();
  }

  function open(container, options = {}) {
    close();
    host = container;
    context = { ...options };
    onSaved = options.onSaved || null;
    onClosed = options.onClosed || null;
    mode = options.engine === 'relational-sql' ? 'manual' : (options.mode === 'manual' ? 'manual' : 'auto');
    text = String(options.query || '');
    message = ''; messageTone = 'info'; busy = false; probe = null;

    host.classList.add('isOpen');
    host.addEventListener('click', onClick);
    host.addEventListener('change', onChange);
    host.addEventListener('input', onInput);
    render();
  }

  window.BLDataQueryEditor = { open, close };
})();
