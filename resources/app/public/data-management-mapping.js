/* ===================================================================
   ALAN EŞLEME DÜZENLEYİCİSİ (v7.81, P4-yazma)

   Kaynak ayrıntısındaki "N alanı gözden geçir" buraya açılır.

   NE GÖSTERİR — ve neyi göstermez:

   Varsayılan görünüm YALNIZ sorunlu alanları listeler. Eski ekran 37–50
   satırlık tam listeyi açıyordu ve bakılması gereken bir avuç alan içinde
   kayboluyordu. Tam liste isteyen açabilir ama bu ikinci bir karardır.

   TEK ALAN YAZILIR. İstemci bütün eşlemeyi geri göndermez: bayat bir
   görünüm üzerinden tam eşleme göndermek, o arada eklenmiş başka bir alanı
   SESSİZCE düşürürdü. Kullanıcı üç alanı düzeltirken dördüncüyü kaybetmemeli.

   SÜTUN LİSTESİ ŞEMADAN GELİR, UYDURULMAZ. Ölçüler ve sütunlar ayrı
   işaretlenir: ikisini karıştırmak DAX üretiminde sessizce yanlış sonuç
   verir (ör. FOB bir ölçüdür, aynı adlı bir boyut sütunu varsa bile).
   =================================================================== */
(() => {
  'use strict';

  const en = () => typeof appLang !== 'undefined' && appLang === 'en';
  const T = (tr, enText) => (en() ? enText : tr);
  const esc = value => (typeof escapeHtml === 'function'
    ? escapeHtml(String(value == null ? '' : value))
    : String(value == null ? '' : value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch])));

  const STATUS = {
    foreign: { tr: 'Beklenen adla örtüşmüyor', en: 'Does not match the expected name', tone: 'warn' },
    weak: { tr: 'Yalnız kısmi ad benzerliğiyle tuttu', en: 'Matched only by partial name similarity', tone: 'warn' },
    unmapped: { tr: 'Eşlenmemiş', en: 'Not mapped', tone: 'bad' },
  };

  let host = null;
  let context = null;       // {sourceId, sourceName, server, catalog, revision, problems}
  let schema = null;        // {columns:[], measures:[]}
  /* Şema (sunucu+katalog) başına önbelleklenir. Ekran her kayıttan sonra
     yeniden çizildiği için düzenleyici de yeniden açılır; her açılışta şemayı
     tekrar okumak gereksiz bir DMV sorgusu demek olurdu. */
  const schemaCache = new Map();
  let schemaError = '';
  let busy = false;
  let messages = [];
  let messageTone = 'info';
  let onSaved = null;
  let onClosed = null;
  let catalogue = [];
  let original = {};
  let draft = {};
  let searchText = '';
  const copy = value => JSON.parse(JSON.stringify(value || {}));
  const same = (a, b) => JSON.stringify(a || null) === JSON.stringify(b || null);
  function changes() {
    const keys = new Set([...Object.keys(original), ...Object.keys(draft)]);
    return [...keys].filter(header => !same(original[header], draft[header]))
      .map(header => ({ header, entry: draft[header] || null }));
  }


  const TONE_RANK = { info: 0, warn: 1, bad: 2 };
  function say(text, tone = 'info') {
    const value = String(text || '').trim();
    if (!value) return;
    if (!messages.includes(value)) messages.push(value);
    if (TONE_RANK[tone] > TONE_RANK[messageTone]) messageTone = tone;
  }

  /* ---------------------------------------------------------------- */

  async function loadSchema() {
    schemaError = '';
    const key = `${context.server}|${context.catalog}`;
    const cached = schemaCache.get(key);
    if (cached) { schema = cached.schema; schemaError = cached.error; return; }
    try {
      const response = await fetch('/api/model-connections/schema', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ server: context.server, catalog: context.catalog }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.ok) throw new Error(payload.error || T('şema okunamadı', 'schema could not be read'));
      schema = { columns: payload.columns || [], measures: payload.measures || [] };
      schemaCache.set(key, { schema, error: '' });
    } catch (error) {
      /* Şema okunamazsa düzenleyici KAPANMAZ: kullanıcı sütun adını elle
         yazabilir. Kaynağa erişilemediği için eşleme düzeltilemez demek,
         kurtarılabilir bir durumu çıkmaza çevirirdi. */
      schema = null;
      schemaError = String(error && error.message || error);
      // Hata ÖNBELLEKLENMEZ: geçici bir arıza kalıcı bir engel olmamalı.
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
    /* Ölçüler ÖNCE. autoMapSchema da öyle yapıyor: FOB ve miktar alanları
       tabular modelde genellikle ölçüdür ve aynı adı taşıyan bir boyut sütunu
       varsa bile doğru olan ölçüdür. */
    return measures.concat(columns);
  }


  async function loadFields() {
    const response = await fetch(`/api/model-fields?role=${encodeURIComponent(context.role)}`, { cache: 'no-store' });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !Array.isArray(payload.fields)) {
      throw new Error(T('Alan kataloğu yüklenemedi.', 'Could not load the field catalogue.'));
    }
    catalogue = payload.fields.slice();
    // Eski kurulumda katalog dışı özel alan varsa silinmesin: ayrı satırda yönetilsin.
    for (const header of Object.keys(original)) {
      if (!catalogue.some(field => field.header === header)) catalogue.push({ header, required: false });
    }
    if (context.repair && !catalogue.some(field => field.header === context.repair.header)) {
      catalogue.unshift({ header: context.repair.header, required: true });
    }
  }

  function row(field) {
    const header = String(field.header || '');
    const entry = draft[header] || null;
    const problem = (context.problems || []).find(item => item.header === header) || null;
    const required = Boolean(field.required);
    const missing = required && !entry;
    const dirty = !same(original[header], entry);
    const status = problem ? STATUS[problem.status] : null;
    const hint = entry
      ? `${entry.table ? entry.table + ' / ' : ''}${entry.kind === 'measure' ? T('Ölçü', 'Measure') : T('Sütun', 'Column')}`
      : (missing ? T('Zorunlu eşleme eksik', 'Required mapping missing')
          : T('Eşleştirilmedi', 'Not mapped'));
    return `<li class="dmmRow${missing ? ' isBlocking' : ''}${dirty ? ' isChanged' : ''}" data-header="${esc(header)}">
      <span class="dmmMark" aria-hidden="true">${missing ? '⛔' : (dirty ? '●' : (status ? '⚠' : '✓'))}</span>
      <span class="dmmField">${esc(header)}${required ? `<span class="dmReq">${esc(T('zorunlu', 'required'))}</span>` : ''}</span>
      <button type="button" class="dmmColumn" data-pick="${esc(header)}" ${busy ? 'disabled' : ''}>
        ${entry ? esc(entry.name) : `<em>${esc(T('Sütun seç', 'Select column'))}</em>`}
      </button>
      <span class="dmmWhy">${esc(hint)}${status ? ` · ${esc(status[en() ? 'en' : 'tr'])}` : ''}</span>
      ${entry ? `<button type="button" class="dmfDrop" data-clear="${esc(header)}" ${busy ? 'disabled' : ''} title="${esc(T('Eşlemeyi kaldır', 'Remove mapping'))}">×</button>` : '<span></span>'}
    </li>`;
  }

  function render() {
    if (!host) return;
    const changed = changes();
    const requiredMissing = catalogue.filter(field => field.required && !draft[field.header]).length;
    const rows = catalogue.map(row).join('');
    host.innerHTML = `<div class="dmMappingEditor" role="region" aria-label="${esc(context.sourceName)}">
      <div class="dmfHead">
        <span class="dmfTitle">${esc(T('Alan eşlemesi', 'Field mapping'))} — ${esc(context.sourceName)}</span>
        <span class="dmsHint">${esc(context.server)} / ${esc(context.catalog)}</span>
      </div>
      <p class="dmsHint">${esc(T('Sütunları seçin, değişiklikleri gözden geçirin ve Kaydet ile uygulayın.',
        'Choose columns, review your changes, then apply them with Save.'))}</p>
      ${schemaError ? `<p class="dmfMessage is-warn">${esc(T(
        `Model şeması okunamadı (${schemaError}). Sütun adını elle yazabilirsiniz.`,
        `Model schema could not be read (${schemaError}). You can type the column name.`))}</p>` : ''}
      <div class="dmmToolbar">
        <input type="search" data-search aria-label="${esc(T('Alan ara', 'Search fields'))}"
          placeholder="${esc(T('Alan ara…', 'Search fields…'))}" value="${esc(searchText)}">
        <button type="button" class="tbtn" data-auto ${busy ? 'disabled' : ''}>${esc(T('Otomatik eşle', 'Auto-map'))}</button>
        <button type="button" class="tbtn" data-reset ${busy || !changed.length ? 'disabled' : ''}>${esc(T('Değişiklikleri geri al', 'Discard changes'))}</button>
      </div>
      <div class="dmmSummary">${esc(T(
        `${catalogue.length} alan · ${changed.length} kaydedilmemiş değişiklik · ${requiredMissing} zorunlu alan eksik`,
        `${catalogue.length} fields · ${changed.length} unsaved changes · ${requiredMissing} required fields missing`))}</div>
      <ul class="dmmList" data-map-list>${rows}</ul>
      <div class="dmfFoot">
        ${messages.length ? `<span class="dmfMessage is-${esc(messageTone)}">${messages.map(esc).join(' ')}</span>` : ''}
        <span class="dmfSpacer"></span>
        <button type="button" class="tbtn" data-close ${busy ? 'disabled' : ''}>${esc(T('Kapat', 'Close'))}</button>
        <button type="button" class="tbtn primary" data-save ${busy || !changed.length ? 'disabled' : ''}>${esc(T('Kaydet', 'Save'))}</button>
      </div>
    </div>`;
    filterRows();
  }

  function filterRows() {
    if (!host) return;
    const query = String(searchText).toLocaleLowerCase();
    for (const el of host.querySelectorAll('[data-header]')) {
      el.hidden = Boolean(query) && !String(el.dataset.header || '').toLocaleLowerCase().includes(query);
    }
  }

  async function autoMap() {
    busy = true; messages = []; messageTone = 'info'; render();
    try {
      const response = await fetch('/api/model-connections/automap', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ server: context.server, catalog: context.catalog, role: context.role }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.ok) throw new Error(payload.error || T('Otomatik eşleme başarısız.', 'Auto-mapping failed.'));
      let filled = 0;
      for (const [header, entry] of Object.entries(payload.mapping || {})) {
        if (!draft[header] && entry && entry.name && catalogue.some(field => field.header === header)) {
          draft[header] = entry;
          filled++;
        }
      }
      say(T(
        `${filled} boş alan için öneri eklendi. Mevcut eşlemeler korunur; kaydetmeden önce kontrol edin.`,
        `${filled} suggestions added to unmapped fields. Existing mappings are preserved; review before saving.`));
      if ((payload.missingRequired || []).some(header => !draft[header])) {
        say(T('Bazı zorunlu alanlar otomatik bulunamadı.', 'Some required fields could not be auto-mapped.'), 'warn');
      }
    } catch (error) { say(String(error && error.message || error), 'bad'); }
    finally { busy = false; render(); }
  }

  async function saveDraft() {
    const edits = changes();
    if (!edits.length) return;
    // Kullanıcı çalışan ZORUNLU bir eşlemeyi yanlışlıkla silemesin.
    if (catalogue.some(field => field.required && original[field.header] && !draft[field.header])) {
      say(T('Zorunlu bir eşlemeyi boş bırakamazsınız.', 'You cannot clear an existing required mapping.'), 'bad');
      render(); return;
    }
    busy = true; messages = []; messageTone = 'info'; render();
    try {
      const response = await fetch(`/api/data-management/source/${encodeURIComponent(context.sourceId)}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        // Sadece değişen alanlar: atomik, revizyon korumalı, diğer alanları silmez.
        body: JSON.stringify({ mappingChanges: edits, expectedSourceRevision: context.revision }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.ok) throw new Error(payload.error ||
        T('Değişiklikler kaydedilemedi.', 'Could not save changes.'));
      const reopen = typeof onSaved === 'function' ? onSaved : null;
      close({ notify: false });
      if (reopen) await reopen(payload.warnings || [], {
        header: context && context.repair && edits.some(x => x.header === context.repair.header) ? context.repair.header : '',
        changes: edits.length,
      });
    } catch (error) {
      say(String(error && error.message || error), 'bad');
    } finally {
      if (host) { busy = false; render(); }
    }
  }

  /* ---------------------------------------------------------------- */

  async function write(header, entry) {
    busy = true; render();
    try {
      const response = await fetch(`/api/data-management/source/${encodeURIComponent(context.sourceId)}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          // TEK alan gönderilir; tam eşleme değil (bkz. dosya başlığı).
          mappingEntry: { header, entry },
          expectedSourceRevision: context.revision,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.ok) throw new Error(payload.error || T('Eşleme kaydedilemedi.', 'Could not save the mapping.'));
      /* Yazdıktan sonra BU MODÜL bir şey çizmez. Ekran tazelenince kendi
         DOM'unu baştan kurar ve düzenleyicinin bağlı olduğu yuva silinir;
         burada render() çağırmak öksüz bir düğüme yazmak olurdu (canlı
         ölçümde tam olarak bu oldu). Yeniden açmak çağıranın işi. */
      const reopen = typeof onSaved === 'function' ? onSaved : null;
      close({ notify: false });
      // İkinci argüman geriye dönük uyumludur: eski çağıranlar yalnız ilk
      // argümandaki warnings listesini okumaya devam eder. Onarım akışı ise
      // gerçekten hedeflenen alanın kaydedildiğini buradan doğrular.
      if (reopen) await reopen(payload.warnings || [], { header, entry });
      return;
    } catch (error) {
      say(String(error && error.message || error), 'bad');
    } finally {
      if (host) { busy = false; render(); }
    }
  }


  function onClick(event) {
    if (event.target.closest('[data-save]')) { void saveDraft(); return; }
    if (event.target.closest('[data-auto]')) { void autoMap(); return; }
    if (event.target.closest('[data-reset]')) {
      draft = copy(original); messages = []; messageTone = 'info'; render(); return;
    }
    if (event.target.closest('[data-close]')) {
      if (changes().length && !window.confirm(T(
        'Kaydedilmemiş eşleme değişikliklerini iptal etmek istiyor musunuz?',
        'Discard unsaved field mapping changes?'))) return;
      close(); return;
    }

    const clear = event.target.closest('[data-clear]');
    if (clear) {
      delete draft[clear.dataset.clear];
      render();
      return;
    }

    const pick = event.target.closest('[data-pick]');
    if (!pick || busy) return;
    const header = pick.dataset.pick;
    const entries = columnEntries();
    window.BLDataPicker?.open?.(pick, entries, value => {
      const parts = String(value).split('|');
      const entry = parts.length >= 3
        ? { kind: parts[0], table: parts[1], name: parts.slice(2).join('|') }
        : { kind: 'column', table: '', name: String(value) };
      // Canlı refresh onarımı eski TEK alan yazma sözleşmesini korur.
      if (context.repair && header === context.repair.header) {
        void write(header, entry); return;
      }
      draft[header] = entry;
      render();
    }, {
      placeholder: schema ? T('Sütun veya ölçü ara…', 'Search columns or measures…')
        : T('Sütun adını yazıp Enter…', 'Type the column name and press Enter…'),
      allowFree: true,
    });
  }

  function onInput(event) {
    if (event.target.matches('[data-search]')) {
      searchText = event.target.value;
      filterRows();
    }
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
    busy = false;
    if (typeof notifier === 'function') notifier();
  }

  async function open(container, options = {}) {
    close();
    host = container;
    context = { ...options };
    onSaved = options.onSaved || null;
    onClosed = options.onClosed || null;
    messages = []; messageTone = 'info'; busy = false; schema = null;
    original = copy(context.mappingEntries);
    draft = copy(original);
    catalogue = [];
    searchText = '';

    host.classList.add('isOpen');
    host.addEventListener('click', onClick);
    host.addEventListener('input', onInput);
    host.innerHTML = `<p class="dmsHint">${esc(T('Model şeması okunuyor…', 'Reading the model schema…'))}</p>`;
    await Promise.all([loadSchema(), loadFields().catch(error => {
      say(String(error && error.message || error), 'warn');
      catalogue = Object.keys(original).map(header => ({ header, required: false }));
    })]);
    render();
  }

  window.BLDataMappingEditor = { open, close };
})();
