/* ===================================================================
   LCW AI — Çıktı Düzenleyici ve Çıktı Şablonları

   LCW AI'ın ürettiği PDF / PowerPoint / Excel / HTML dosyası, Buyer Log
   içinde düzenlenip yeniden oluşturulur; LCW AI'a tekrar gidilmez.

   - Taslak = dosyanın doğrulanmış yapısı (/api/lcwai/output-drafts/:id).
     PowerPoint: slayt listesi + düzen formu; Excel: sayfa listesi + tablo
     ızgarası; PDF/HTML: rapor önizlemesinde doğrudan metin düzenleme.
   - "Dosyayı Oluştur" düzenlemeyi sunucuya gönderir; sunucu AYNI
     doğrulayıcıdan geçirip yeni dosya üretir (eski dosya silinmez).
   - Rapor HTML'i ana DOM'a GİRMEZ: betiksiz (sandbox, allow-scripts YOK)
     ve katı CSP'li ayrı bir iframe belgesinde çizilir. Gövde, oluşturma
     sırasında sunucuda yeniden temizlenir.
   - Şablon = veri taşımayan yapı (bölüm/slayt sırası, başlıklar, sütunlar,
     kısaltılmayacak alanlar, ek talimat). Kişisel ya da ekip şablonu
     olarak kaydedilir; ekip şablonu tüm kullanıcılara görünür.
   =================================================================== */
(function () {
  'use strict';
  if (window.BLOutputEditor) return;

  const isEn = () => String(window.appLang || document.documentElement.lang || 'tr').toLowerCase().startsWith('en');
  const L = (trText, enText) => (isEn() ? enText : trText);
  const esc = value => String(value == null ? '' : value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const AI = () => window.BuyerLogAI || null;
  const toast = (text, kind) => { if (typeof window.showToast === 'function') window.showToast(text, kind ? { kind } : undefined); };
  const clone = value => JSON.parse(JSON.stringify(value == null ? null : value));
  const FORMAT_NAME = { pdf: 'PDF', pptx: 'PowerPoint', xlsx: 'Excel', html: 'HTML' };
  const FORMAT_ICON = { pdf: 'PDF', pptx: 'PPT', xlsx: 'XLSX', html: 'HTML' };
  // Sunucu sınırlarıyla aynı (output-contracts LIMITS); aşan kısım istemcide engellenir.
  const LIMITS = { slides: 40, bullets: 8, kpis: 6, tableCols: 8, tableRows: 60, chartCategories: 12, chartSeries: 3, gallery: 6, sheets: 10, sheetCols: 40, sheetRows: 5000, sheetKpis: 20 };
  const PAGE_ROWS = 100;

  const LAYOUTS = () => [
    { key: 'title', label: L('Kapak', 'Cover') },
    { key: 'section', label: L('Bölüm ayracı', 'Section divider') },
    { key: 'bullets', label: L('Maddeler', 'Bullets') },
    { key: 'kpis', label: L('KPI kartları', 'KPI cards') },
    { key: 'table', label: L('Tablo', 'Table') },
    { key: 'chart', label: L('Grafik', 'Chart') },
    { key: 'comparison', label: L('Karşılaştırma', 'Comparison') },
    { key: 'summary', label: L('Özet / aksiyonlar', 'Summary / actions') },
    { key: 'gallery', label: L('Model galerisi', 'Model gallery') },
  ];
  const layoutLabel = key => (LAYOUTS().find(item => item.key === key) || { label: key }).label;
  const TONES = () => [
    { key: 'info', label: L('Bilgi', 'Info') },
    { key: 'ok', label: L('İyi', 'Good') },
    { key: 'warn', label: L('Dikkat', 'Warning') },
    { key: 'risk', label: L('Risk', 'Risk') },
  ];
  const COLUMN_TYPES = () => [
    { key: 'text', label: L('Metin', 'Text') },
    { key: 'integer', label: L('Tam sayı', 'Integer') },
    { key: 'number', label: L('Sayı', 'Number') },
    { key: 'percent', label: L('Yüzde', 'Percent') },
    { key: 'currency', label: L('Para', 'Currency') },
    { key: 'date', label: L('Tarih', 'Date') },
    { key: 'image', label: L('Model görseli', 'Model image') },
  ];
  const PARTS = () => [
    { key: 'text', label: L('Metin', 'Text') }, { key: 'kpis', label: 'KPI' }, { key: 'table', label: L('Tablo', 'Table') },
    { key: 'bars', label: L('Bar grafik', 'Bar chart') }, { key: 'rings', label: L('Halka', 'Rings') }, { key: 'cards', label: L('Kartlar', 'Cards') },
    { key: 'timeline', label: L('Zaman çizelgesi', 'Timeline') }, { key: 'steps', label: L('Aksiyon listesi', 'Action list') },
    { key: 'callout', label: L('Not kutusu', 'Callout') }, { key: 'images', label: L('Model görselleri', 'Model images') },
  ];
  const DETAILS = () => [{ key: 'summary', label: L('Kısa', 'Brief') }, { key: 'standard', label: L('Standart', 'Standard') }, { key: 'detailed', label: L('Detaylı', 'Detailed') }];
  const options = (list, current) => list.map(item => `<option value="${esc(item.key)}"${item.key === current ? ' selected' : ''}>${esc(item.label)}</option>`).join('');

  function getPath(object, path) { return String(path).split('.').reduce((node, key) => (node == null ? undefined : node[key]), object); }
  function setPath(object, path, value) {
    const keys = String(path).split('.');
    let node = object;
    for (let i = 0; i < keys.length - 1; i++) {
      if (node[keys[i]] == null || typeof node[keys[i]] !== 'object') node[keys[i]] = /^\d+$/.test(keys[i + 1]) ? [] : {};
      node = node[keys[i]];
    }
    node[keys[keys.length - 1]] = value;
  }
  function readValue(el) {
    const kind = el.dataset.kind || '';
    if (el.type === 'checkbox') return el.checked;
    if (kind === 'lines') return String(el.value || '').split('\n').map(line => line.trim()).filter(Boolean);
    if (kind === 'number') { const number = Number(String(el.value || '').replace(',', '.')); return Number.isFinite(number) ? number : 0; }
    if (kind === 'cell') { const text = String(el.value == null ? '' : el.value); return text.startsWith('=') && text.length > 1 ? { f: text.slice(1) } : text; }
    return String(el.value == null ? '' : el.value);
  }
  const cellText = value => (value && typeof value === 'object' && typeof value.f === 'string' ? `=${value.f}` : value == null ? '' : String(value));
  const move = (list, from, to) => { if (to < 0 || to >= list.length || from === to) return false; const [item] = list.splice(from, 1); list.splice(to, 0, item); return true; };

  /* TSV (Excel'den kopyalanan hücreler) → satır × sütun. */
  function parseTsv(text) {
    const rows = [];
    let row = [], cell = '', quoted = false;
    const source = String(text || '').replace(/\r\n?/g, '\n').replace(/\n$/, '');
    for (let i = 0; i < source.length; i++) {
      const char = source[i];
      if (quoted) {
        if (char === '"' && source[i + 1] === '"') { cell += '"'; i++; } else if (char === '"') quoted = false; else cell += char;
      } else if (char === '"' && cell === '') quoted = true;
      else if (char === '\t') { row.push(cell); cell = ''; }
      else if (char === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
      else cell += char;
    }
    row.push(cell);
    rows.push(row);
    return rows;
  }

  /* ================= Düzenleyici durumu ================= */
  let ed = null;
  const root = () => document.getElementById('_lcwaiOutputEditor');
  const $ = selector => root() && root().querySelector(selector);

  function markDirty() {
    if (!ed) return;
    ed.dirty = true;
    ed.result = null;
    renderFoot();
  }
  function pushHistory() {
    if (!ed || ed.format === 'pdf' || ed.format === 'html') return;
    ed.history.push(JSON.stringify(ed.data));
    if (ed.history.length > 60) ed.history.shift();
  }
  let typingTimer = 0;
  function historyOnTyping() {
    if (!typingTimer) pushHistory();
    clearTimeout(typingTimer);
    typingTimer = setTimeout(() => { typingTimer = 0; }, 900);
  }
  function undo() {
    if (!ed) return;
    if (ed.format === 'pdf' || ed.format === 'html') { const doc = frameDoc(); if (doc) doc.execCommand('undo'); return; }
    const last = ed.history.pop();
    if (!last) { toast(L('Geri alınacak değişiklik yok.', 'Nothing to undo.')); return; }
    ed.data = JSON.parse(last);
    clampSelection();
    renderRail(); renderMain(); markDirty();
  }
  function clampSelection() {
    if (ed.format === 'pptx') ed.selected = Math.max(0, Math.min(ed.selected, ed.data.slides.length - 1));
    if (ed.format === 'xlsx' && ed.selected !== 'summary') ed.selected = ed.data.sheets.length ? Math.max(0, Math.min(Number(ed.selected) || 0, ed.data.sheets.length - 1)) : 'summary';
  }

  /* ================= Açma / kapama ================= */
  async function open(options = {}) {
    const api = AI();
    if (!api || !options.draftId) return;
    if (ed && ed.dirty && !window.confirm(L('Açık düzenleyicide oluşturulmamış değişiklikler var. Kapatıp bu dosyayı açalım mı?', 'The open editor has changes that were not turned into a file. Close it and open this file?'))) return;
    close(true);
    let draft;
    try { draft = await api.getDraft(options.draftId); }
    catch (error) { toast(api.errorText(error), 'error'); return; }
    ed = {
      draft, format: draft.format, data: clone(draft.data), title: draft.title || '', orientation: draft.orientation || 'portrait',
      selected: draft.format === 'pptx' ? Math.min(1, Math.max(0, (draft.data.slides || []).length - 1)) : draft.format === 'xlsx' ? ((draft.data.sheets || []).length ? 0 : 'summary') : 0,
      dirty: false, busy: false, history: [], pages: {}, issues: [], result: null, sourceMode: false,
      onRendered: typeof options.onRendered === 'function' ? options.onRendered : () => {},
      onTemplatesChanged: typeof options.onTemplatesChanged === 'function' ? options.onTemplatesChanged : () => {},
    };
    mount();
  }

  function close(force) {
    if (!root()) { ed = null; return true; }
    if (!force && ed && ed.dirty && !window.confirm(L('Oluşturulmamış değişiklikler kaybolacak. Kapatılsın mı?', 'Changes that were not turned into a file will be lost. Close?'))) return false;
    root().remove();
    document.removeEventListener('keydown', onKeydown, true);
    ed = null;
    return true;
  }

  function mount() {
    const overlay = document.createElement('div');
    overlay.id = '_lcwaiOutputEditor';
    overlay.className = 'warnOverlay lcwaiEdOverlay';
    // Metinler L() ile zaten TR/EN; sözlük katmanı kullanıcı verisini
    // (slayt başlığı, sütun adı, şablon adı) çevirmesin.
    overlay.setAttribute('data-no-i18n', '');
    const icon = FORMAT_ICON[ed.format] || ed.format.toUpperCase();
    const orientation = ed.format === 'pdf' || ed.format === 'html'
      ? `<select data-ed-orientation aria-label="${esc(L('Sayfa yönü', 'Page orientation'))}">${options([{ key: 'portrait', label: L('Dikey', 'Portrait') }, { key: 'landscape', label: L('Yatay', 'Landscape') }], ed.orientation)}</select>` : '';
    overlay.innerHTML = `<div class="modalCard lcwaiEd" role="dialog" aria-modal="true" aria-label="${esc(L('Çıktı Düzenleyici', 'Output Editor'))}">
      <header class="lcwaiEdHead">
        <span class="lcwaiFileIcon is-${esc(ed.format)}">${esc(icon)}</span>
        <div class="lcwaiEdHeadTitle"><small>${esc(L(`${FORMAT_NAME[ed.format] || ''} düzenleyici`, `${FORMAT_NAME[ed.format] || ''} editor`))}${ed.draft.templateLabel ? ` · ${esc(ed.draft.templateLabel)}` : ''}</small><input data-ed-title value="${esc(ed.title)}" aria-label="${esc(L('Dosya başlığı', 'File title'))}" placeholder="${esc(L('Dosya başlığı', 'File title'))}"></div>
        ${orientation}
        <button type="button" class="lcwaiBtn" data-ed-undo title="${esc(L('Geri al', 'Undo'))}">↶ ${esc(L('Geri al', 'Undo'))}</button>
        <button type="button" class="lcwaiBtn" data-ed-save-template>${esc(L('Şablon olarak kaydet', 'Save as template'))}</button>
        <button type="button" class="lcwaiBtn" data-ed-close>${esc(L('Kapat', 'Close'))}</button>
        <button type="button" class="lcwaiBtn is-primary" data-ed-render>${esc(L('Dosyayı Oluştur', 'Create File'))}</button>
      </header>
      <div class="lcwaiEdBody">
        <aside class="lcwaiEdRail" data-ed-rail aria-label="${esc(L('İçindekiler', 'Contents'))}"></aside>
        <main class="lcwaiEdMain" data-ed-main></main>
      </div>
      <footer class="lcwaiEdFoot" data-ed-foot></footer>
    </div>`;
    document.body.appendChild(overlay);
    overlay.addEventListener('click', onClick);
    overlay.addEventListener('input', onInput);
    overlay.addEventListener('change', onChange);
    overlay.addEventListener('paste', onPaste);
    overlay.addEventListener('dragstart', onDragStart);
    overlay.addEventListener('dragover', onDragOver);
    overlay.addEventListener('dragleave', event => { const item = event.target.closest && event.target.closest('[data-rail]'); if (item) item.classList.remove('is-drop'); });
    overlay.addEventListener('drop', onDrop);
    document.addEventListener('keydown', onKeydown, true);
    renderRail(); renderMain(); renderFoot();
    $('[data-ed-title]')?.focus();
  }

  function onKeydown(event) {
    if (!ed || !root()) return;
    if (root().querySelector('.lcwaiEdDialog')) {
      if (event.key === 'Escape') { event.preventDefault(); closeDialog(); }
      return;
    }
    if (event.key === 'Escape') { event.preventDefault(); close(false); }
    else if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); renderFile(); }
  }

  /* ================= Sol liste ================= */
  function railItem(index, title, meta, { active = false, draggable = true, ops = true, dup = true } = {}) {
    return `<li class="lcwaiEdRailItem${active ? ' is-active' : ''}" data-rail="${esc(index)}"${draggable ? ' draggable="true"' : ''}>
      <button type="button" class="lcwaiEdRailPick" data-rail-pick="${esc(index)}"><span class="lcwaiEdRailNo">${typeof index === 'number' ? index + 1 : '∑'}</span><span class="lcwaiEdRailText"><b>${esc(title || L('(başlıksız)', '(untitled)'))}</b><small>${esc(meta)}</small></span></button>
      ${ops ? `<span class="lcwaiEdRailOps"><button type="button" data-rail-up="${esc(index)}" title="${esc(L('Yukarı taşı', 'Move up'))}" aria-label="${esc(L('Yukarı taşı', 'Move up'))}">↑</button><button type="button" data-rail-down="${esc(index)}" title="${esc(L('Aşağı taşı', 'Move down'))}" aria-label="${esc(L('Aşağı taşı', 'Move down'))}">↓</button>${dup ? `<button type="button" data-rail-dup="${esc(index)}" title="${esc(L('Çoğalt', 'Duplicate'))}" aria-label="${esc(L('Çoğalt', 'Duplicate'))}">⧉</button>` : ''}<button type="button" data-rail-del="${esc(index)}" title="${esc(L('Sil', 'Delete'))}" aria-label="${esc(L('Sil', 'Delete'))}">×</button></span>` : ''}
    </li>`;
  }

  function renderRail() {
    const rail = $('[data-ed-rail]');
    if (!rail || !ed) return;
    if (ed.format === 'pptx') {
      const slides = ed.data.slides || [];
      rail.innerHTML = `<div class="lcwaiEdRailHead"><b>${esc(L('Slaytlar', 'Slides'))}</b><small>${esc(L(`${slides.length} slayt · sürükleyip sıralayın`, `${slides.length} slides · drag to reorder`))}</small></div>
        <ol class="lcwaiEdRailList">${slides.map((slide, index) => railItem(index, slide.title, layoutLabel(slide.layout), { active: index === ed.selected })).join('')}</ol>
        <select class="lcwaiEdAdd" data-rail-add aria-label="${esc(L('Slayt ekle', 'Add slide'))}"><option value="">＋ ${esc(L('Slayt ekle…', 'Add slide…'))}</option>${options(LAYOUTS().filter(item => item.key !== 'title'), '')}</select>`;
      return;
    }
    if (ed.format === 'xlsx') {
      const sheets = ed.data.sheets || [];
      rail.innerHTML = `<div class="lcwaiEdRailHead"><b>${esc(L('Sayfalar', 'Sheets'))}</b><small>${esc(L(`${sheets.length} sayfa`, `${sheets.length} sheets`))}</small></div>
        <ol class="lcwaiEdRailList">${railItem('summary', L('Özet sayfası', 'Summary sheet'), L(`${(ed.data.kpis || []).length} KPI · ${(ed.data.notes || []).length} not`, `${(ed.data.kpis || []).length} KPIs · ${(ed.data.notes || []).length} notes`), { active: ed.selected === 'summary', draggable: false, ops: false })}
        ${sheets.map((sheet, index) => railItem(index, sheet.name, L(`${sheet.columns.length} sütun · ${sheet.rows.length} satır`, `${sheet.columns.length} columns · ${sheet.rows.length} rows`), { active: index === ed.selected })).join('')}</ol>
        <button type="button" class="lcwaiBtn lcwaiEdAdd" data-sheet-add>＋ ${esc(L('Sayfa ekle', 'Add sheet'))}</button>`;
      return;
    }
    renderSectionRail();
  }

  /* ================= Ana panel ================= */
  function renderMain() {
    const main = $('[data-ed-main]');
    if (!main || !ed) return;
    if (ed.format === 'pptx') main.innerHTML = slideForm(ed.data.slides[ed.selected], ed.selected);
    else if (ed.format === 'xlsx') main.innerHTML = ed.selected === 'summary' ? summaryForm() : sheetForm(ed.data.sheets[ed.selected], ed.selected);
    else renderReportEditor(main);
    autoSize(main);
  }
  function autoSize(scope) {
    (scope || document).querySelectorAll('textarea[data-autosize]').forEach(area => { area.style.height = 'auto'; area.style.height = `${Math.min(area.scrollHeight + 2, 320)}px`; });
  }

  const field = (label, control, hint = '') => `<label class="lcwaiEdField"><span>${esc(label)}</span>${control}${hint ? `<small>${esc(hint)}</small>` : ''}</label>`;
  const input = (path, value, { placeholder = '', kind = '' } = {}) => `<input data-path="${esc(path)}"${kind ? ` data-kind="${esc(kind)}"` : ''} value="${esc(value == null ? '' : value)}" placeholder="${esc(placeholder)}">`;
  const area = (path, value, { placeholder = '', kind = '', rows = 3 } = {}) => `<textarea data-autosize data-path="${esc(path)}"${kind ? ` data-kind="${esc(kind)}"` : ''} rows="${rows}" placeholder="${esc(placeholder)}">${esc(value == null ? '' : value)}</textarea>`;
  const select = (path, list, current) => `<select data-path="${esc(path)}">${options(list, current)}</select>`;
  const linesHint = max => L(`Her satır bir madde · en fazla ${max}`, `One item per line · up to ${max}`);

  function slideForm(slide, index) {
    if (!slide) return `<p class="lcwaiNote">${esc(L('Slayt yok. Soldan bir slayt ekleyin.', 'No slides. Add a slide on the left.'))}</p>`;
    const base = `slides.${index}`;
    const head = `<div class="lcwaiEdSlideBand"><div class="lcwaiEdRow">
        ${field(L('Düzen', 'Layout'), `<select data-ed-layout="${index}">${options(LAYOUTS(), slide.layout)}</select>`)}
        ${field(L('Slayt başlığı', 'Slide title'), input(`${base}.title`, slide.title, { placeholder: L('Başlık', 'Title') }))}
      </div>
      ${field(L('Alt başlık', 'Subtitle'), input(`${base}.subtitle`, slide.subtitle, { placeholder: L('İsteğe bağlı', 'Optional') }))}</div>`;
    const bullets = (label, hint = linesHint(LIMITS.bullets)) => field(label, area(`${base}.bullets`, (slide.bullets || []).join('\n'), { kind: 'lines', placeholder: L('Bir madde yazın…', 'Type an item…') }), hint);
    const callout = slide.layout === 'title' || slide.layout === 'gallery' ? '' : `<details class="lcwaiEdMore"${slide.callout && slide.callout.text ? ' open' : ''}><summary>${esc(L('Vurgu kutusu', 'Highlight box'))}</summary><div class="lcwaiEdRow">
        ${field(L('Metin', 'Text'), input(`${base}.callout.text`, slide.callout && slide.callout.text, { placeholder: L('Ör. Hedef: 15 Kasım’a kadar sevkiyat', 'E.g. Target: ship by 15 November') }))}
        ${field(L('Ton', 'Tone'), select(`${base}.callout.tone`, TONES(), slide.callout && slide.callout.tone || 'info'))}</div></details>`;
    let body = '';
    if (slide.layout === 'bullets' || slide.layout === 'summary') {
      body = bullets(slide.layout === 'summary' ? L('Aksiyonlar / özet maddeleri', 'Actions / summary items') : L('Maddeler', 'Bullets'));
      if (slide.layout === 'bullets') body += field(L('Model görseli anahtarı', 'Model image key'), `${input(`${base}.image`, slide.image, { placeholder: L('Ör. KOL-3 (isteğe bağlı)', 'E.g. KOL-3 (optional)') })}`, imageKeysHint());
    } else if (slide.layout === 'kpis') {
      body = kpiEditor(`${base}.kpis`, slide.kpis || [], LIMITS.kpis, true) + bullets(L('Alt notlar', 'Notes below'), linesHint(4));
    } else if (slide.layout === 'table') {
      body = gridEditor({ base: `${base}.table`, columns: slide.table.columns, rows: slide.table.rows, typed: false, maxCols: LIMITS.tableCols, maxRows: LIMITS.tableRows })
        + (slide.table.omitted ? `<p class="lcwaiNote">${esc(L(`Kaynak veride ${slide.table.omitted} satır daha var (slaytta not olarak gösterilir).`, `${slide.table.omitted} more rows exist in the source (shown as a note on the slide).`))}</p>` : '')
        + bullets(L('Tablo altı notları', 'Notes below the table'), linesHint(2));
    } else if (slide.layout === 'chart') {
      body = chartEditor(base, slide.chart) + bullets(L('Yan notlar', 'Side notes'), linesHint(LIMITS.bullets));
    } else if (slide.layout === 'comparison') {
      const side = key => `<div class="lcwaiEdCol">${field(L('Sütun başlığı', 'Column title'), input(`${base}.${key}.title`, slide[key] && slide[key].title))}${field(L('Maddeler', 'Bullets'), area(`${base}.${key}.bullets`, (slide[key] && slide[key].bullets || []).join('\n'), { kind: 'lines' }), linesHint(LIMITS.bullets))}</div>`;
      body = `<div class="lcwaiEdCols">${side('left')}${side('right')}</div>`;
    } else if (slide.layout === 'gallery') {
      body = galleryEditor(base, slide.items || []);
    } else {
      body = `<p class="lcwaiNote">${esc(slide.layout === 'title' ? L('Kapak slaytı: başlık ve alt başlık yeterli. Tarih ve Buyer Log teması otomatik eklenir.', 'Cover slide: a title and subtitle are enough. The date and Buyer Log theme are added automatically.') : L('Bölüm ayracı: yalnız başlık ve alt başlık gösterilir.', 'Section divider: only the title and subtitle are shown.'))}</p>`;
    }
    return `<div class="lcwaiEdCard lcwaiEdSlide">${head}<div class="lcwaiEdSlideBody">${body}${callout}</div></div>`;
  }

  function imageKeysHint() {
    const keys = ed.draft.imageKeys || Object.keys(ed.draft.images || {});
    return keys.length ? L(`Kullanılabilir görseller: ${keys.slice(0, 12).join(', ')}`, `Available images: ${keys.slice(0, 12).join(', ')}`) : L('Görsel anahtarı bağlam tablosunun “BL Image” sütunundan gelir.', 'Image keys come from the “BL Image” column of the context table.');
  }

  function kpiEditor(path, kpis, max, withTone) {
    const rows = kpis.map((kpi, index) => `<div class="lcwaiEdKpi">
        ${input(`${path}.${index}.label`, kpi.label, { placeholder: L('Etiket', 'Label') })}
        ${input(`${path}.${index}.value`, kpi.value, { placeholder: L('Değer', 'Value') })}
        ${input(`${path}.${index}.note`, kpi.note, { placeholder: L('Not (isteğe bağlı)', 'Note (optional)') })}
        ${withTone ? select(`${path}.${index}.tone`, TONES(), kpi.tone || 'info') : ''}
        <button type="button" class="lcwaiEdIconBtn" data-list-del="${esc(path)}" data-index="${index}" aria-label="${esc(L('Sil', 'Delete'))}" title="${esc(L('Sil', 'Delete'))}">×</button></div>`).join('');
    return `<div class="lcwaiEdBlock"><div class="lcwaiEdBlockHead"><b>${esc(L('KPI kartları', 'KPI cards'))}</b><small>${esc(L(`${kpis.length}/${max}`, `${kpis.length}/${max}`))}</small></div>${rows || `<p class="lcwaiNote">${esc(L('Henüz KPI yok.', 'No KPIs yet.'))}</p>`}
      <button type="button" class="lcwaiBtn" data-list-add="${esc(path)}" data-template="kpi" data-max="${max}"${kpis.length >= max ? ' disabled' : ''}>＋ ${esc(L('KPI ekle', 'Add KPI'))}</button></div>`;
  }

  function galleryEditor(base, items) {
    const rows = items.map((item, index) => `<div class="lcwaiEdKpi is-gallery">
        ${input(`${base}.items.${index}.image`, item.image, { placeholder: L('Görsel (ör. KOL-3)', 'Image (e.g. KOL-3)') })}
        ${input(`${base}.items.${index}.title`, item.title, { placeholder: L('Model / başlık', 'Model / title') })}
        ${input(`${base}.items.${index}.subtitle`, item.subtitle, { placeholder: L('Alt başlık', 'Subtitle') })}
        ${input(`${base}.items.${index}.note`, item.note, { placeholder: L('Not', 'Note') })}
        ${select(`${base}.items.${index}.tone`, TONES(), item.tone || 'info')}
        <button type="button" class="lcwaiEdIconBtn" data-list-del="${esc(base)}.items" data-index="${index}" aria-label="${esc(L('Sil', 'Delete'))}" title="${esc(L('Sil', 'Delete'))}">×</button></div>`).join('');
    return `<div class="lcwaiEdBlock"><div class="lcwaiEdBlockHead"><b>${esc(L('Galeri kartları', 'Gallery cards'))}</b><small>${esc(`${items.length}/${LIMITS.gallery}`)}</small></div>${rows}
      <button type="button" class="lcwaiBtn" data-list-add="${esc(base)}.items" data-template="gallery" data-max="${LIMITS.gallery}"${items.length >= LIMITS.gallery ? ' disabled' : ''}>＋ ${esc(L('Kart ekle', 'Add card'))}</button><small class="lcwaiNote">${esc(imageKeysHint())}</small></div>`;
  }

  function chartEditor(base, chart) {
    const categories = chart.categories || [];
    const series = chart.series || [];
    const head = series.map((item, index) => `<th><div class="lcwaiEdColHead">${input(`${base}.chart.series.${index}.name`, item.name, { placeholder: L('Seri adı', 'Series name') })}<button type="button" class="lcwaiEdIconBtn" data-chart-delseries="${index}" aria-label="${esc(L('Seriyi sil', 'Delete series'))}" title="${esc(L('Seriyi sil', 'Delete series'))}">×</button></div></th>`).join('');
    const rows = categories.map((category, row) => `<tr><td class="lcwaiEdRowNo"><button type="button" class="lcwaiEdIconBtn" data-chart-delcat="${row}" aria-label="${esc(L('Kategoriyi sil', 'Delete category'))}" title="${esc(L('Kategoriyi sil', 'Delete category'))}">×</button></td><td>${input(`${base}.chart.categories.${row}`, category, { placeholder: L('Kategori', 'Category') })}</td>${series.map((item, index) => `<td>${input(`${base}.chart.series.${index}.values.${row}`, (item.values || [])[row], { kind: 'number' })}</td>`).join('')}</tr>`).join('');
    return `<div class="lcwaiEdBlock"><div class="lcwaiEdBlockHead"><b>${esc(L('Grafik verisi', 'Chart data'))}</b>${field(L('Birim', 'Unit'), input(`${base}.chart.unit`, chart.unit, { placeholder: L('ör. %, adet', 'e.g. %, pcs') }))}</div>
      <div class="lcwaiEdGridWrap"><table class="lcwaiEdGrid"><thead><tr><th class="lcwaiEdRowNo"></th><th>${esc(L('Kategori', 'Category'))}</th>${head}</tr></thead><tbody>${rows}</tbody></table></div>
      <div class="lcwaiEdGridTools"><button type="button" class="lcwaiBtn" data-chart-addcat${categories.length >= LIMITS.chartCategories ? ' disabled' : ''}>＋ ${esc(L('Kategori', 'Category'))}</button><button type="button" class="lcwaiBtn" data-chart-addseries${series.length >= LIMITS.chartSeries ? ' disabled' : ''}>＋ ${esc(L('Seri', 'Series'))}</button><small class="lcwaiNote">${esc(L(`En fazla ${LIMITS.chartCategories} kategori, ${LIMITS.chartSeries} seri. Değerler sayıdır.`, `Up to ${LIMITS.chartCategories} categories, ${LIMITS.chartSeries} series. Values are numbers.`))}</small></div></div>`;
  }

  /* Tablo ızgarası: PowerPoint tablosu (sütun = metin) ya da Excel sayfası
     (sütun = { header, type }). Excel'den çoklu hücre yapıştırma desteklenir. */
  function gridEditor({ base, columns, rows, typed, maxCols, maxRows, page = 0 }) {
    const start = typed ? page * PAGE_ROWS : 0;
    const visible = typed ? rows.slice(start, start + PAGE_ROWS) : rows;
    const colPath = index => (typed ? `${base}.columns.${index}.header` : `${base}.columns.${index}`);
    const head = columns.map((column, index) => `<th><div class="lcwaiEdColHead">${input(colPath(index), typed ? column.header : column, { placeholder: L('Sütun adı', 'Column name') })}<button type="button" class="lcwaiEdIconBtn" data-grid-delcol="${index}" aria-label="${esc(L('Sütunu sil', 'Delete column'))}" title="${esc(L('Sütunu sil', 'Delete column'))}">×</button></div>${typed ? select(`${base}.columns.${index}.type`, COLUMN_TYPES(), column.type || 'text') : ''}</th>`).join('');
    const body = visible.map((row, offset) => {
      const index = start + offset;
      return `<tr><td class="lcwaiEdRowNo"><span>${index + 1}</span><button type="button" class="lcwaiEdIconBtn" data-grid-delrow="${index}" aria-label="${esc(L('Satırı sil', 'Delete row'))}" title="${esc(L('Satırı sil', 'Delete row'))}">×</button></td>${columns.map((_, col) => `<td><textarea data-autosize rows="1" data-path="${esc(base)}.rows.${index}.${col}" data-kind="${typed ? 'cell' : ''}" data-cell="${index},${col}">${esc(cellText(row[col]))}</textarea></td>`).join('')}</tr>`;
    }).join('');
    const pages = typed ? Math.max(1, Math.ceil(rows.length / PAGE_ROWS)) : 1;
    const pager = pages > 1 ? `<span class="lcwaiEdPager"><button type="button" class="lcwaiBtn" data-grid-page="${page - 1}"${page <= 0 ? ' disabled' : ''}>‹</button><small>${esc(L(`Sayfa ${page + 1}/${pages} · ${rows.length} satır`, `Page ${page + 1}/${pages} · ${rows.length} rows`))}</small><button type="button" class="lcwaiBtn" data-grid-page="${page + 1}"${page >= pages - 1 ? ' disabled' : ''}>›</button></span>` : '';
    return `<div class="lcwaiEdBlock" data-grid="${esc(base)}" data-grid-typed="${typed ? '1' : ''}" data-grid-maxcols="${maxCols}" data-grid-maxrows="${maxRows}">
      <div class="lcwaiEdGridWrap"><table class="lcwaiEdGrid"><thead><tr><th class="lcwaiEdRowNo">#</th>${head}</tr></thead><tbody>${body || ''}</tbody></table></div>
      <div class="lcwaiEdGridTools"><button type="button" class="lcwaiBtn" data-grid-addrow${rows.length >= maxRows ? ' disabled' : ''}>＋ ${esc(L('Satır', 'Row'))}</button><button type="button" class="lcwaiBtn" data-grid-addcol${columns.length >= maxCols ? ' disabled' : ''}>＋ ${esc(L('Sütun', 'Column'))}</button>${pager}<small class="lcwaiNote">${esc(typed ? L('Excel’den hücre kopyalayıp yapıştırabilirsiniz. “=” ile başlayan hücre formüldür (ör. =SUM(B2:B10)).', 'You can paste cells copied from Excel. A cell starting with “=” is a formula (e.g. =SUM(B2:B10)).') : L(`Excel’den hücre kopyalayıp yapıştırabilirsiniz. Uzun tablo PowerPoint’te devam slaytlarına bölünür (en fazla ${maxRows} satır × ${maxCols} sütun).`, `You can paste cells copied from Excel. Long tables continue on extra slides in PowerPoint (up to ${maxRows} rows × ${maxCols} columns).`))}</small></div></div>`;
  }

  function sheetForm(sheet, index) {
    if (!sheet) return summaryForm();
    return `<div class="lcwaiEdCard"><div class="lcwaiEdSlideBand">${field(L('Sayfa adı', 'Sheet name'), input(`sheets.${index}.name`, sheet.name), L('En fazla 31 karakter', 'Up to 31 characters'))}</div>
      <div class="lcwaiEdSlideBody">${gridEditor({ base: `sheets.${index}`, columns: sheet.columns, rows: sheet.rows, typed: true, maxCols: LIMITS.sheetCols, maxRows: LIMITS.sheetRows, page: ed.pages[index] || 0 })}</div></div>`;
  }

  function summaryForm() {
    const currencies = [{ key: '', label: L('Yok', 'None') }, { key: 'TRY', label: 'TRY' }, { key: 'USD', label: 'USD' }, { key: 'EUR', label: 'EUR' }, { key: 'GBP', label: 'GBP' }];
    return `<div class="lcwaiEdCard"><div class="lcwaiEdSlideBand"><div class="lcwaiEdRow">${field(L('Alt başlık', 'Subtitle'), input('subtitle', ed.data.subtitle))}${field(L('Para birimi', 'Currency'), select('currency', currencies, ed.data.currency || ''))}</div></div>
      <div class="lcwaiEdSlideBody">${kpiEditor('kpis', ed.data.kpis || [], LIMITS.sheetKpis, false)}
      ${field(L('Notlar', 'Notes'), area('notes', (ed.data.notes || []).join('\n'), { kind: 'lines', placeholder: L('Her satır bir not', 'One note per line') }))}
      <p class="lcwaiNote">${esc(L('KPI ve notlar çalışma kitabının ilk “Özet” sayfasına yazılır; boş bırakılırsa Özet sayfası yalnız başlığı taşır.', 'KPIs and notes go to the workbook’s first “Summary” sheet; if empty it only carries the title.'))}</p></div></div>`;
  }

  /* ================= Rapor (PDF/HTML) düzenleyici =================
     Önizleme iframe'i: sandbox (allow-same-origin, allow-scripts YOK) +
     CSP. Betik çalışmaz; ebeveyn belgeyi designMode ile düzenler. */
  const FRAME_CSP = "default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; script-src 'none'; base-uri 'none'; form-action 'none'";
  // Yalnız rapor temasının kendi değişkenleri (--acc); yeni renk yok.
  const EDIT_CSS = '[data-bl-edit-root] section:hover,[data-bl-edit-root]>h1:hover{outline:1px dashed color-mix(in srgb,var(--acc) 45%,transparent);outline-offset:4px}[data-bl-edit-root] .bl-active{outline:2px solid var(--acc);outline-offset:4px}[data-bl-edit-root]:focus{outline:none}*{animation:none!important;transition:none!important}';
  const frame = () => $('[data-ed-frame]');
  const frameDoc = () => { try { return frame() && frame().contentDocument; } catch (_) { return null; } };
  const editRoot = () => { const doc = frameDoc(); return doc && doc.querySelector('[data-bl-edit-root]'); };

  function reportSrcdoc(body) {
    const styles = (ed.data.styles || []).map(css => `<style>${String(css).replace(/<\/style/gi, '')}</style>`).join('');
    return `<!DOCTYPE html><html lang="${isEn() ? 'en' : 'tr'}"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${FRAME_CSP}"><style>${String(ed.draft.previewCss || '').replace(/<\/style/gi, '')}</style>${styles}<style>${EDIT_CSS}</style></head><body><div class="bl-page"><div class="bl-report" data-bl-edit-root>${body}</div></div></body></html>`;
  }

  function renderReportEditor(main) {
    const tools = [
      ['bold', 'B', L('Kalın', 'Bold')], ['italic', 'I', L('İtalik', 'Italic')], ['underline', 'U', L('Altı çizili', 'Underline')],
      ['h2', 'H2', L('Bölüm başlığı', 'Section heading')], ['p', '¶', L('Paragraf', 'Paragraph')],
      ['insertUnorderedList', '•', L('Madde listesi', 'Bulleted list')], ['insertOrderedList', '1.', L('Numaralı liste', 'Numbered list')],
      ['redo', '↷', L('Yinele', 'Redo')],
    ];
    main.innerHTML = `<div class="lcwaiEdReport">
      <div class="lcwaiEdToolbar" role="toolbar" aria-label="${esc(L('Biçimlendirme', 'Formatting'))}">${tools.map(([cmd, text, label]) => `<button type="button" data-cmd="${cmd}" title="${esc(label)}" aria-label="${esc(label)}">${esc(text)}</button>`).join('')}
        <span class="lcwaiEdSep"></span><button type="button" data-section-add title="${esc(L('Sona yeni bölüm ekle', 'Add a new section at the end'))}">＋ ${esc(L('Bölüm', 'Section'))}</button>
        <span style="flex:1"></span><button type="button" data-source-toggle class="${ed.sourceMode ? 'is-active' : ''}" title="${esc(L('HTML kaynağını düzenle', 'Edit the HTML source'))}">&lt;/&gt; ${esc(ed.sourceMode ? L('Görsel düzen', 'Visual edit') : L('Kaynak', 'Source'))}</button></div>
      ${ed.sourceMode
        ? `<textarea class="lcwaiEdSource" data-source spellcheck="false" aria-label="${esc(L('HTML kaynağı', 'HTML source'))}">${esc(ed.data.body || '')}</textarea><p class="lcwaiNote">${esc(L('Betik, dış bağlantı ve olay öznitelikleri dosya oluşturulurken temizlenir.', 'Scripts, external links and event attributes are removed when the file is created.'))}</p>`
        : `<iframe class="lcwaiEdFrame${ed.orientation === 'landscape' ? ' is-landscape' : ''}" data-ed-frame sandbox="allow-same-origin" title="${esc(L('Rapor önizlemesi', 'Report preview'))}"></iframe><p class="lcwaiNote">${esc(L('Metne tıklayıp doğrudan yazın. Bölümleri soldan sıralayın ya da silin.', 'Click the text and type directly. Reorder or delete sections on the left.'))}</p>`}
    </div>`;
    if (ed.sourceMode) return;
    const iframe = frame();
    iframe.addEventListener('load', () => {
      const doc = frameDoc();
      if (!doc) return;
      const images = ed.draft.images || {};
      doc.querySelectorAll('img[data-bl-image]').forEach(img => { const src = images[String(img.getAttribute('data-bl-image') || '').toUpperCase()]; if (src) img.setAttribute('src', src); });
      doc.designMode = 'on';
      doc.addEventListener('input', () => { markDirty(); scheduleSectionRail(); });
      doc.addEventListener('keydown', event => { if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); renderFile(); } else if (event.key === 'Escape') { event.preventDefault(); close(false); } });
      renderSectionRail();
    }, { once: true });
    iframe.srcdoc = reportSrcdoc(ed.data.body || '');
  }

  /* Düzenlenmiş rapor gövdesi: önizleme için eklenen görsel src'leri ve
     editör işaretleri çıkarılır; asıl temizlik sunucudadır. */
  function reportBody() {
    if (ed.sourceMode) { const source = $('[data-source]'); return source ? source.value : ed.data.body; }
    const rootEl = editRoot();
    if (!rootEl) return ed.data.body;
    const copy = rootEl.cloneNode(true);
    copy.querySelectorAll('img[data-bl-image]').forEach(img => img.removeAttribute('src'));
    copy.querySelectorAll('.bl-active').forEach(el => el.classList.remove('bl-active'));
    copy.querySelectorAll('[class=""]').forEach(el => el.removeAttribute('class'));
    return copy.innerHTML;
  }

  function reportSections() {
    const rootEl = editRoot();
    if (!rootEl) return [];
    const list = Array.from(rootEl.children).filter(el => /^(SECTION|H1|DIV)$/.test(el.tagName) && (el.tagName !== 'DIV' || /\bbl-(kpis|grid|callout)\b/.test(el.className)));
    return list.map(el => {
      const heading = el.tagName === 'H1' ? el : el.querySelector('h2, h3');
      const kind = el.tagName === 'H1' ? L('Rapor başlığı', 'Report title') : el.tagName === 'SECTION' ? L('Bölüm', 'Section') : L('Blok', 'Block');
      return { el, title: (heading ? heading.textContent : el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80), kind };
    });
  }
  let railTimer = 0;
  function scheduleSectionRail() { clearTimeout(railTimer); railTimer = setTimeout(renderSectionRail, 350); }
  function renderSectionRail() {
    const rail = $('[data-ed-rail]');
    if (!rail || !ed || (ed.format !== 'pdf' && ed.format !== 'html')) return;
    if (ed.sourceMode) { rail.innerHTML = `<div class="lcwaiEdRailHead"><b>${esc(L('Bölümler', 'Sections'))}</b><small>${esc(L('Kaynak düzenleniyor', 'Editing source'))}</small></div>`; return; }
    const sections = reportSections();
    rail.innerHTML = `<div class="lcwaiEdRailHead"><b>${esc(L('Bölümler', 'Sections'))}</b><small>${esc(L(`${sections.length} öğe · sürükleyip sıralayın`, `${sections.length} items · drag to reorder`))}</small></div>
      <ol class="lcwaiEdRailList">${sections.map((section, index) => railItem(index, section.title, section.kind, { dup: true })).join('')}</ol>`;
  }
  function sectionOp(op, index) {
    const sections = reportSections();
    const item = sections[index];
    if (!item) return;
    if (op === 'pick') {
      item.el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      const doc = frameDoc();
      doc.querySelectorAll('.bl-active').forEach(el => el.classList.remove('bl-active'));
      item.el.classList.add('bl-active');
      setTimeout(() => item.el.classList.remove('bl-active'), 1600);
      return;
    }
    if (op === 'del') item.el.remove();
    else if (op === 'dup') item.el.after(item.el.cloneNode(true));
    else if (op === 'up' && sections[index - 1]) sections[index - 1].el.before(item.el);
    else if (op === 'down' && sections[index + 1]) sections[index + 1].el.after(item.el);
    else return;
    markDirty();
    renderSectionRail();
  }
  function moveSection(from, to) {
    const sections = reportSections();
    if (!sections[from] || !sections[to] || from === to) return;
    if (from < to) sections[to].el.after(sections[from].el); else sections[to].el.before(sections[from].el);
    markDirty();
    renderSectionRail();
  }
  function runCommand(cmd) {
    const doc = frameDoc();
    if (!doc) return;
    frame().contentWindow.focus();
    if (cmd === 'h2' || cmd === 'p') doc.execCommand('formatBlock', false, cmd === 'h2' ? 'h2' : 'p');
    else doc.execCommand(cmd, false, null);
    markDirty();
    scheduleSectionRail();
  }
  function addSection() {
    const rootEl = editRoot();
    if (!rootEl) return;
    const doc = frameDoc();
    const section = doc.createElement('section');
    section.className = 'bl-section';
    const heading = doc.createElement('h2');
    heading.textContent = L('Yeni bölüm', 'New section');
    const text = doc.createElement('p');
    text.textContent = L('Metni buraya yazın.', 'Write the text here.');
    section.append(heading, text);
    rootEl.appendChild(section);
    section.scrollIntoView({ behavior: 'smooth', block: 'start' });
    markDirty();
    renderSectionRail();
  }

  /* ================= Alt bilgi ================= */
  function renderFoot() {
    const foot = $('[data-ed-foot]');
    if (!foot || !ed) return;
    const issues = ed.issues.length ? `<ul class="lcwaiIssues">${ed.issues.map(item => `<li>${esc(item)}</li>`).join('')}</ul>` : '';
    let status;
    if (ed.busy) status = `<span class="lcwaiStatus is-busy">${esc(ed.busyText || L('Dosya oluşturuluyor…', 'Creating the file…'))}</span>`;
    else if (ed.error) status = `<span class="lcwaiStatus is-error">${esc(ed.error)}</span>`;
    else if (ed.result) status = `<span class="lcwaiStatus is-ok">✓ ${esc(L(`${ed.result.fileName} oluşturuldu`, `${ed.result.fileName} created`))}</span> <button type="button" class="lcwaiBtn is-link" data-ed-open>${esc(L('Aç', 'Open'))}</button> <button type="button" class="lcwaiBtn is-link" data-ed-reveal>${esc(L('Klasörde Göster', 'Show in folder'))}</button>${ed.result.fallback === 'html' ? ` <small class="lcwaiNote">${esc(L('PDF basımı bu ortamda yapılamadı; HTML olarak kaydedildi.', 'PDF printing is not available here; saved as HTML.'))}</small>` : ''}`;
    else if (ed.dirty) status = `<span class="lcwaiStatus is-warn">● ${esc(L('Değişiklikler henüz dosyaya yansımadı', 'Changes are not in a file yet'))}</span>`;
    else status = `<span class="lcwaiStatus">${esc(L('Düzenleyin, sonra “Dosyayı Oluştur”a basın. Her oluşturma yeni bir dosyadır; eski dosya korunur.', 'Edit, then press “Create File”. Each creation is a new file; the old file is kept.'))}</span>`;
    const warnings = ed.warnings && ed.warnings.length ? `<small class="lcwaiNote">${esc(L(`${ed.warnings.length} küçük düzeltme uygulandı (sınır aşımı/boş öğe).`, `${ed.warnings.length} small adjustment(s) applied (limits/empty items).`))}</small>` : '';
    foot.innerHTML = `<div class="lcwaiEdFootStatus">${status}${warnings}${issues}</div><small class="lcwaiNote">${esc(L('Ctrl+Enter: Dosyayı oluştur · Esc: Kapat', 'Ctrl+Enter: Create file · Esc: Close'))}</small>`;
    const render = $('[data-ed-render]');
    if (render) render.disabled = Boolean(ed.busy);
  }

  /* ================= Veri toplama + oluşturma ================= */
  function collectData() {
    if (ed.format === 'pdf' || ed.format === 'html') {
      const body = reportBody();
      ed.data.body = body;
      return { body, styles: ed.data.styles || [] };
    }
    return clone(ed.data);
  }

  async function renderFile() {
    const api = AI();
    if (!ed || ed.busy || !api) return;
    const data = collectData();
    ed.busy = true; ed.error = ''; ed.issues = []; ed.warnings = []; ed.result = null;
    ed.busyText = L('Dosya oluşturuluyor…', 'Creating the file…');
    renderFoot();
    try {
      const result = await api.renderDraft(ed.draft.id, { data, title: ed.title, orientation: ed.orientation }, { onProgress: event => { if (event && event.step === 'pdf' && ed) { ed.busyText = L('PDF basılıyor…', 'Printing the PDF…'); renderFoot(); } } });
      if (!ed) return;
      ed.result = result.output;
      ed.warnings = result.warnings || [];
      ed.dirty = false;
      try { ed.onRendered(result.output); } catch (_) {}
    } catch (error) {
      if (!ed) return;
      ed.error = api.errorText(error);
      ed.issues = Array.isArray(error && error.issues) ? error.issues : [];
    } finally {
      if (ed) { ed.busy = false; renderFoot(); }
    }
  }

  /* ================= Olaylar ================= */
  function blankSlide(layout) {
    const slide = { layout, title: L('Yeni slayt', 'New slide'), subtitle: '', bullets: [], callout: null };
    return ensureLayout(slide);
  }
  function ensureLayout(slide) {
    if (slide.layout === 'kpis' && !(slide.kpis || []).length) slide.kpis = [{ label: '', value: '', note: '', tone: 'info' }];
    if (slide.layout === 'table' && !(slide.table && slide.table.columns && slide.table.columns.length)) slide.table = { columns: [L('Sütun 1', 'Column 1'), L('Sütun 2', 'Column 2')], rows: [['', '']], omitted: 0 };
    if (slide.layout === 'chart' && !(slide.chart && slide.chart.categories && slide.chart.categories.length)) slide.chart = { categories: ['A', 'B'], series: [{ name: L('Seri 1', 'Series 1'), values: [0, 0] }], unit: '' };
    if (slide.layout === 'comparison') { slide.left = slide.left || { title: 'A', bullets: [] }; slide.right = slide.right || { title: 'B', bullets: [] }; }
    if (slide.layout === 'gallery' && !(slide.items || []).length) slide.items = [{ title: '', subtitle: '', note: '', image: '', tone: 'info' }];
    if ((slide.layout === 'bullets' || slide.layout === 'summary') && !(slide.bullets || []).length) slide.bullets = [L('Yeni madde', 'New item')];
    return slide;
  }
  const NEW_ITEM = {
    kpi: () => ({ label: '', value: '', note: '', tone: 'info' }),
    gallery: () => ({ title: '', subtitle: '', note: '', image: '', tone: 'info' }),
  };

  function listFor(kind) {
    if (ed.format === 'pptx') return ed.data.slides;
    if (ed.format === 'xlsx') return ed.data.sheets;
    return null;
  }
  function railOp(op, index) {
    if (ed.format === 'pdf' || ed.format === 'html') { sectionOp(op, index); return; }
    if (index === 'summary') { if (op === 'pick') { ed.selected = 'summary'; renderRail(); renderMain(); } return; }
    const list = listFor();
    const i = Number(index);
    if (op === 'pick') { ed.selected = i; renderRail(); renderMain(); return; }
    pushHistory();
    if (op === 'up' && move(list, i, i - 1)) ed.selected = i - 1;
    else if (op === 'down' && move(list, i, i + 1)) ed.selected = i + 1;
    else if (op === 'dup') {
      if (ed.format === 'pptx' && list.length >= LIMITS.slides) { toast(L(`En fazla ${LIMITS.slides} slayt.`, `Up to ${LIMITS.slides} slides.`), 'warn'); ed.history.pop(); return; }
      if (ed.format === 'xlsx' && list.length >= LIMITS.sheets) { toast(L(`En fazla ${LIMITS.sheets} sayfa.`, `Up to ${LIMITS.sheets} sheets.`), 'warn'); ed.history.pop(); return; }
      const copy = clone(list[i]);
      if (ed.format === 'xlsx') copy.name = `${copy.name} (2)`.slice(0, 31);
      list.splice(i + 1, 0, copy);
      ed.selected = i + 1;
    } else if (op === 'del') {
      if (list.length <= 1) { toast(L('Son öğe silinemez.', 'The last item cannot be deleted.'), 'warn'); ed.history.pop(); return; }
      list.splice(i, 1);
      if (ed.format === 'xlsx') ed.pages = {};
      ed.selected = Math.max(0, Math.min(i, list.length - 1));
    } else { ed.history.pop(); return; }
    renderRail(); renderMain(); markDirty();
  }

  function gridContext(el) {
    const box = el.closest('[data-grid]');
    if (!box) return null;
    const base = box.dataset.grid;
    const target = getPath(ed.data, base);
    return { box, base, target, typed: box.dataset.gridTyped === '1', maxCols: Number(box.dataset.gridMaxcols) || 8, maxRows: Number(box.dataset.gridMaxrows) || 60 };
  }
  const newColumn = (grid, n) => (grid.typed ? { header: L(`Sütun ${n}`, `Column ${n}`), type: 'text' } : L(`Sütun ${n}`, `Column ${n}`));

  function onClick(event) {
    if (!ed) return;
    const target = event.target.closest('button');
    if (!target) return;
    if (target.matches('[data-ed-close]')) { close(false); return; }
    if (target.matches('[data-ed-render]')) { renderFile(); return; }
    if (target.matches('[data-ed-undo]')) { undo(); return; }
    if (target.matches('[data-ed-save-template]')) { openSaveTemplate(); return; }
    if (target.matches('[data-ed-open], [data-ed-reveal]')) {
      const api = AI();
      if (api && ed.result) (target.matches('[data-ed-open]') ? api.openOutput(ed.result.id, ed.result.fileName) : api.revealOutput(ed.result.id, ed.result.fileName)).catch(error => toast(api.errorText(error), 'error'));
      return;
    }
    for (const op of ['pick', 'up', 'down', 'dup', 'del']) {
      const key = `rail${op[0].toUpperCase()}${op.slice(1)}`;
      if (target.dataset[key] != null) { railOp(op, target.dataset[key] === 'summary' ? 'summary' : Number(target.dataset[key])); return; }
    }
    if (target.matches('[data-sheet-add]')) {
      if (ed.data.sheets.length >= LIMITS.sheets) { toast(L(`En fazla ${LIMITS.sheets} sayfa.`, `Up to ${LIMITS.sheets} sheets.`), 'warn'); return; }
      pushHistory();
      ed.data.sheets.push({ name: L(`Sayfa ${ed.data.sheets.length + 1}`, `Sheet ${ed.data.sheets.length + 1}`), columns: [{ header: L('Sütun 1', 'Column 1'), type: 'text' }], rows: [['']] });
      ed.selected = ed.data.sheets.length - 1;
      renderRail(); renderMain(); markDirty();
      return;
    }
    if (target.matches('[data-cmd]')) { runCommand(target.dataset.cmd); return; }
    if (target.matches('[data-section-add]')) { addSection(); return; }
    if (target.matches('[data-source-toggle]')) {
      if (ed.sourceMode) { const source = $('[data-source]'); ed.data.body = source ? source.value : ed.data.body; }
      else ed.data.body = reportBody();
      ed.sourceMode = !ed.sourceMode;
      renderMain(); renderSectionRail();
      return;
    }
    if (target.matches('[data-list-add]')) {
      const path = target.dataset.listAdd;
      const list = getPath(ed.data, path) || [];
      if (list.length >= Number(target.dataset.max || 99)) return;
      pushHistory();
      setPath(ed.data, path, [...list, (NEW_ITEM[target.dataset.template] || NEW_ITEM.kpi)()]);
      renderMain(); markDirty();
      return;
    }
    if (target.matches('[data-list-del]')) {
      const path = target.dataset.listDel;
      const list = getPath(ed.data, path) || [];
      pushHistory();
      list.splice(Number(target.dataset.index), 1);
      renderMain(); markDirty();
      return;
    }
    if (target.matches('[data-chart-addcat], [data-chart-addseries], [data-chart-delcat], [data-chart-delseries]')) {
      const chart = ed.data.slides[ed.selected].chart;
      pushHistory();
      if (target.matches('[data-chart-addcat]')) { chart.categories.push(String.fromCharCode(65 + (chart.categories.length % 26))); chart.series.forEach(series => series.values.push(0)); }
      else if (target.matches('[data-chart-addseries]')) chart.series.push({ name: L(`Seri ${chart.series.length + 1}`, `Series ${chart.series.length + 1}`), values: chart.categories.map(() => 0) });
      else if (target.matches('[data-chart-delcat]')) { if (chart.categories.length <= 1) { ed.history.pop(); return; } const i = Number(target.dataset.chartDelcat); chart.categories.splice(i, 1); chart.series.forEach(series => series.values.splice(i, 1)); }
      else { if (chart.series.length <= 1) { ed.history.pop(); return; } chart.series.splice(Number(target.dataset.chartDelseries), 1); }
      renderMain(); markDirty();
      return;
    }
    const grid = gridContext(target);
    if (grid) {
      const { target: table } = grid;
      if (target.matches('[data-grid-page]')) { ed.pages[ed.selected] = Math.max(0, Number(target.dataset.gridPage) || 0); renderMain(); return; }
      pushHistory();
      if (target.matches('[data-grid-addrow]')) {
        if (table.rows.length >= grid.maxRows) { ed.history.pop(); return; }
        table.rows.push(table.columns.map(() => ''));
        if (grid.typed) ed.pages[ed.selected] = Math.floor((table.rows.length - 1) / PAGE_ROWS);
      } else if (target.matches('[data-grid-addcol]')) {
        if (table.columns.length >= grid.maxCols) { ed.history.pop(); return; }
        table.columns.push(newColumn(grid, table.columns.length + 1));
        table.rows.forEach(row => row.push(''));
      } else if (target.matches('[data-grid-delrow]')) {
        table.rows.splice(Number(target.dataset.gridDelrow), 1);
      } else if (target.matches('[data-grid-delcol]')) {
        if (table.columns.length <= 1) { toast(L('Tabloda en az bir sütun kalmalı.', 'A table needs at least one column.'), 'warn'); ed.history.pop(); return; }
        const i = Number(target.dataset.gridDelcol);
        table.columns.splice(i, 1);
        table.rows.forEach(row => row.splice(i, 1));
      } else { ed.history.pop(); return; }
      renderMain(); markDirty();
      if (ed.format === 'xlsx') renderRail();
    }
  }

  function onInput(event) {
    if (!ed) return;
    const el = event.target;
    if (el.matches('[data-ed-title]')) { ed.title = el.value; markDirty(); return; }
    if (el.matches('[data-source]')) { markDirty(); return; }
    if (el.matches('textarea[data-autosize]')) autoSize(el.parentElement);
    if (!el.dataset.path || el.tagName === 'SELECT') return;
    historyOnTyping();
    setPath(ed.data, el.dataset.path, readValue(el));
    markDirty();
    // Başlık / ad değişince sol listedeki metin güncellenir (odak kaybolmaz).
    if (/^(slides\.\d+\.title|sheets\.\d+\.name)$/.test(el.dataset.path)) {
      const index = Number(el.dataset.path.split('.')[1]);
      const label = root().querySelector(`[data-rail="${index}"] .lcwaiEdRailText b`);
      if (label) label.textContent = el.value || L('(başlıksız)', '(untitled)');
    }
  }

  function onChange(event) {
    if (!ed) return;
    const el = event.target;
    if (el.matches('[data-ed-orientation]')) {
      if (ed.format === 'pdf' || ed.format === 'html') ed.data.body = reportBody();
      ed.orientation = el.value === 'landscape' ? 'landscape' : 'portrait';
      markDirty(); renderMain();
      return;
    }
    if (el.matches('[data-ed-layout]')) {
      pushHistory();
      const slide = ed.data.slides[Number(el.dataset.edLayout)];
      slide.layout = el.value;
      ensureLayout(slide);
      renderRail(); renderMain(); markDirty();
      return;
    }
    if (el.matches('[data-rail-add]')) {
      if (!el.value) return;
      if (ed.data.slides.length >= LIMITS.slides) { toast(L(`En fazla ${LIMITS.slides} slayt.`, `Up to ${LIMITS.slides} slides.`), 'warn'); el.value = ''; return; }
      pushHistory();
      const at = Math.min(ed.data.slides.length, (Number(ed.selected) || 0) + 1);
      ed.data.slides.splice(at, 0, blankSlide(el.value));
      ed.selected = at;
      renderRail(); renderMain(); markDirty();
      return;
    }
    if (el.tagName === 'SELECT' && el.dataset.path) {
      pushHistory();
      setPath(ed.data, el.dataset.path, el.value);
      markDirty();
      if (/\.type$/.test(el.dataset.path)) renderRail();
    }
  }

  /* Excel'den çok hücreli yapıştırma: ızgarayı seçili hücreden itibaren doldurur. */
  function onPaste(event) {
    if (!ed) return;
    const el = event.target;
    if (!el.matches || !el.matches('textarea[data-cell]')) return;
    const text = event.clipboardData && event.clipboardData.getData('text/plain');
    if (!text || (!text.includes('\t') && !/\n./.test(text.replace(/\r\n?/g, '\n').replace(/\n$/, '')))) return;
    const grid = gridContext(el);
    if (!grid) return;
    event.preventDefault();
    pushHistory();
    const [startRow, startCol] = el.dataset.cell.split(',').map(Number);
    const cells = parseTsv(text);
    const table = grid.target;
    let clipped = false;
    cells.forEach((values, r) => {
      const rowIndex = startRow + r;
      if (rowIndex >= grid.maxRows) { clipped = true; return; }
      while (table.rows.length <= rowIndex) table.rows.push(table.columns.map(() => ''));
      values.forEach((value, c) => {
        const colIndex = startCol + c;
        if (colIndex >= grid.maxCols) { clipped = true; return; }
        while (table.columns.length <= colIndex) { table.columns.push(newColumn(grid, table.columns.length + 1)); table.rows.forEach(row => row.push('')); }
        table.rows[rowIndex][colIndex] = grid.typed && value.startsWith('=') && value.length > 1 ? { f: value.slice(1) } : value;
      });
    });
    if (clipped) toast(L(`Yapıştırılan veri sınırı aştı; ${grid.maxRows} satır × ${grid.maxCols} sütuna kadar alındı.`, `The pasted data exceeded the limit; up to ${grid.maxRows} rows × ${grid.maxCols} columns were kept.`), 'warn');
    renderMain(); markDirty();
    if (ed.format === 'xlsx') renderRail();
  }

  /* Sol listede sürükle-bırak sıralama. */
  function onDragStart(event) {
    const item = event.target.closest && event.target.closest('[data-rail]');
    if (!item || !ed || item.dataset.rail === 'summary') return;
    ed.drag = Number(item.dataset.rail);
    event.dataTransfer.effectAllowed = 'move';
    try { event.dataTransfer.setData('text/plain', String(ed.drag)); } catch (_) {}
  }
  function onDragOver(event) {
    const item = event.target.closest && event.target.closest('[data-rail]');
    if (!item || !ed || ed.drag == null || item.dataset.rail === 'summary') return;
    event.preventDefault();
    item.classList.add('is-drop');
  }
  function onDrop(event) {
    const item = event.target.closest && event.target.closest('[data-rail]');
    if (!item || !ed || ed.drag == null) return;
    event.preventDefault();
    item.classList.remove('is-drop');
    const from = ed.drag, to = Number(item.dataset.rail);
    ed.drag = null;
    if (item.dataset.rail === 'summary' || from === to) return;
    if (ed.format === 'pdf' || ed.format === 'html') { moveSection(from, to); return; }
    pushHistory();
    move(listFor(), from, to);
    ed.selected = to;
    renderRail(); renderMain(); markDirty();
  }

  /* ================= Şablon formu (kaydet / düzenle / yeni) ================= */
  let dialog = null;
  function closeDialog() { const el = document.querySelector('.lcwaiEdDialog'); if (el) el.remove(); dialog = null; }

  function kindOptions(format) {
    if (format === 'pptx') return LAYOUTS();
    if (format === 'xlsx') return [{ key: 'sheet', label: L('Sayfa', 'Sheet') }, { key: 'summary', label: L('Özet sayfası', 'Summary sheet') }];
    return [{ key: 'section', label: L('Bölüm', 'Section') }];
  }
  function structureRows(format, structure) {
    return structure.map((item, index) => `<li class="lcwaiTplItem" data-tpl-item="${index}">
      <span class="lcwaiEdRailNo">${index + 1}</span>
      <select data-tpl-field="kind" aria-label="${esc(L('Tür', 'Type'))}">${options(kindOptions(format), item.kind)}</select>
      <input data-tpl-field="title" value="${esc(item.title || '')}" placeholder="${esc(L('Başlık', 'Title'))}" aria-label="${esc(L('Başlık', 'Title'))}">
      <input data-tpl-field="columns" value="${esc((item.columns || []).map(column => column.name).join(', '))}" placeholder="${esc(L('Sütunlar (virgülle)', 'Columns (comma separated)'))}" aria-label="${esc(L('Sütunlar', 'Columns'))}">
      ${format === 'pdf' || format === 'html' ? `<span class="lcwaiTplParts">${PARTS().map(part => `<label><input type="checkbox" data-tpl-part="${part.key}"${(item.parts || []).includes(part.key) ? ' checked' : ''}> ${esc(part.label)}</label>`).join('')}</span>` : ''}
      <span class="lcwaiEdRailOps is-visible"><button type="button" data-tpl-up="${index}" aria-label="${esc(L('Yukarı taşı', 'Move up'))}">↑</button><button type="button" data-tpl-down="${index}" aria-label="${esc(L('Aşağı taşı', 'Move down'))}">↓</button><button type="button" data-tpl-del="${index}" aria-label="${esc(L('Sil', 'Delete'))}">×</button></span>
    </li>`).join('');
  }

  /* Formdaki yapıyı okur (tür, başlık, sütunlar, bileşenler). Sütun tipleri
     (Excel) mevcut kayıttan korunur. */
  function readStructure() {
    return Array.from(document.querySelectorAll('.lcwaiEdDialog [data-tpl-item]')).map(row => {
      const index = Number(row.dataset.tplItem);
      const previous = dialog.definition.structure[index] || {};
      const types = new Map((previous.columns || []).map(column => [column.name, column.type]));
      const columns = String(row.querySelector('[data-tpl-field="columns"]').value || '').split(',').map(name => name.trim()).filter(Boolean).map(name => (types.get(name) ? { name, type: types.get(name) } : { name }));
      const parts = Array.from(row.querySelectorAll('[data-tpl-part]')).filter(box => box.checked).map(box => box.dataset.tplPart);
      return { kind: row.querySelector('[data-tpl-field="kind"]').value, title: row.querySelector('[data-tpl-field="title"]').value.trim(), columns, parts };
    });
  }
  function readForm() {
    const form = document.querySelector('.lcwaiEdDialog');
    const value = name => { const el = form.querySelector(`[name="${name}"]`); return el ? el.value : ''; };
    const format = value('format') || dialog.definition.format;
    return {
      name: value('name').trim(),
      shared: Boolean(form.querySelector('[name="shared"]') && form.querySelector('[name="shared"]').checked),
      definition: {
        format,
        orientation: value('orientation') || dialog.definition.orientation || 'portrait',
        detail: value('detail') || dialog.definition.detail || 'standard',
        base: dialog.definition.base || '',
        instructions: value('instructions'),
        keepFull: value('keepFull').split(',').map(item => item.trim()).filter(Boolean),
        structure: readStructure(),
      },
    };
  }

  function renderDialog() {
    const host = dialog.host;
    const def = dialog.definition;
    const format = def.format;
    const columns = [...new Set(def.structure.flatMap(item => (item.columns || []).map(column => column.name)))].slice(0, 24);
    const title = dialog.mode === 'edit' ? L('Şablonu düzenle', 'Edit template') : dialog.mode === 'new' ? L('Yeni çıktı şablonu', 'New output template') : L('Şablon olarak kaydet', 'Save as template');
    const formatField = dialog.mode === 'new'
      ? field(L('Dosya biçimi', 'File format'), `<select name="format" data-tpl-format>${options(Object.keys(FORMAT_NAME).map(key => ({ key, label: FORMAT_NAME[key] })), format)}</select>`)
      : `<input type="hidden" name="format" value="${esc(format)}">`;
    host.innerHTML = `<div class="lcwaiEdDialogCard" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <div class="lcwaiEdDialogHead"><b>${esc(title)}</b><span class="lcwaiFileIcon is-${esc(format)}">${esc(FORMAT_ICON[format])}</span></div>
      <div class="lcwaiEdDialogBody">
        <div class="lcwaiEdRow">${field(L('Şablon adı', 'Template name'), `<input name="name" value="${esc(dialog.name || '')}" maxlength="80" placeholder="${esc(L('Ör. Haftalık kumaş durum sunumu', 'E.g. Weekly fabric status deck'))}">`)}${formatField}</div>
        <div class="lcwaiEdRow">
          ${format === 'xlsx' ? '' : field(L('Detay seviyesi', 'Level of detail'), `<select name="detail">${options(DETAILS(), def.detail)}</select>`)}
          ${format === 'pdf' || format === 'html' ? field(L('Sayfa yönü', 'Page orientation'), `<select name="orientation">${options([{ key: 'portrait', label: L('Dikey', 'Portrait') }, { key: 'landscape', label: L('Yatay', 'Landscape') }], def.orientation)}</select>`) : ''}
        </div>
        ${dialog.mode === 'edit' ? '' : `<label class="lcwaiEdCheck"><input type="checkbox" name="shared"${dialog.shared ? ' checked' : ''}> <span><b>${esc(L('Ekiple paylaş', 'Share with the team'))}</b><small>${esc(L('Ekip şablonları tüm Buyer Log kullanıcılarına görünür. Yalnız yapı paylaşılır; tablo satırları, rakamlar ve görseller paylaşılmaz.', 'Team templates are visible to all Buyer Log users. Only the structure is shared; table rows, figures and images are not.'))}</small></span></label>`}
        ${field(L('Kısaltılmayacak alanlar', 'Fields never to shorten'), `<input name="keepFull" value="${esc((def.keepFull || []).join(', '))}" placeholder="${esc(L('Ör. Kumaş, Kompozisyon, Açıklama', 'E.g. Fabric, Composition, Description'))}">`, L('LCW AI bu alanların değerlerini kaynak verideki gibi tam yazar. Virgülle ayırın.', 'LCW AI writes these fields exactly as in the source data. Separate with commas.'))}
        ${columns.length ? `<div class="lcwaiTplChips">${columns.map(name => `<button type="button" class="lcwaiChip" data-tpl-keep="${esc(name)}">＋ ${esc(name)}</button>`).join('')}</div>` : ''}
        ${field(L('Ek talimat', 'Additional instructions'), `<textarea name="instructions" rows="3" maxlength="3000" placeholder="${esc(L('Ör. Tabloyu termin tarihine göre sırala; geciken satırları risk rozetiyle göster.', 'E.g. Sort the table by due date; mark late rows with a risk badge.'))}">${esc(def.instructions || '')}</textarea>`)}
        <div class="lcwaiEdBlock"><div class="lcwaiEdBlockHead"><b>${esc(L('Yapı', 'Structure'))}</b><small>${esc(L('LCW AI bu sırayı, başlıkları ve sütunları izler; içeriği güncel veriyle doldurur.', 'LCW AI follows this order, these titles and columns, and fills them with current data.'))}</small></div>
          <ol class="lcwaiTplList">${structureRows(format, def.structure) || `<p class="lcwaiNote">${esc(L('Yapı boş: LCW AI yapıyı kendisi seçer.', 'No structure: LCW AI chooses the structure.'))}</p>`}</ol>
          <button type="button" class="lcwaiBtn" data-tpl-add${def.structure.length >= 40 ? ' disabled' : ''}>＋ ${esc(L('Öğe ekle', 'Add item'))}</button></div>
      </div>
      <div class="lcwaiEdDialogFoot"><span class="lcwaiStatus is-error" data-tpl-error></span><span style="flex:1"></span><button type="button" class="lcwaiBtn" data-tpl-cancel>${esc(L('Vazgeç', 'Cancel'))}</button><button type="button" class="lcwaiBtn is-primary" data-tpl-save>${esc(L('Kaydet', 'Save'))}</button></div>
    </div>`;
    host.querySelector('[name="name"]')?.focus();
  }

  function openTemplateForm({ mode, definition, name = '', shared = false, id = '', sharedStore = false, container, onSaved }) {
    closeDialog();
    const host = document.createElement('div');
    host.className = 'lcwaiEdDialog';
    host.setAttribute('data-no-i18n', '');
    (container || document.body).appendChild(host);
    dialog = { host, mode, definition: { format: 'pptx', orientation: 'portrait', detail: 'standard', base: '', instructions: '', keepFull: [], structure: [], ...clone(definition) }, name, shared, id, sharedStore, onSaved };
    renderDialog();
    host.addEventListener('click', onDialogClick);
    host.addEventListener('change', event => {
      if (!event.target.matches('[data-tpl-format]')) return;
      const state = readForm();
      dialog.name = state.name;
      dialog.definition = { ...state.definition, format: event.target.value, structure: [] };
      renderDialog();
    });
  }

  async function onDialogClick(event) {
    const target = event.target.closest('button');
    if (!target || !dialog) return;
    if (target.matches('[data-tpl-cancel]')) { closeDialog(); return; }
    if (target.matches('[data-tpl-keep]')) {
      const box = dialog.host.querySelector('[name="keepFull"]');
      const list = box.value.split(',').map(item => item.trim()).filter(Boolean);
      if (!list.includes(target.dataset.tplKeep)) list.push(target.dataset.tplKeep);
      box.value = list.join(', ');
      return;
    }
    const sync = () => { const state = readForm(); dialog.name = state.name; dialog.shared = state.shared; dialog.definition = state.definition; };
    if (target.matches('[data-tpl-add]')) { sync(); dialog.definition.structure.push({ kind: kindOptions(dialog.definition.format)[dialog.definition.format === 'pptx' ? 2 : 0].key, title: '', columns: [], parts: [] }); renderDialog(); return; }
    for (const op of ['up', 'down', 'del']) {
      const key = `tpl${op[0].toUpperCase()}${op.slice(1)}`;
      if (target.dataset[key] == null) continue;
      sync();
      const i = Number(target.dataset[key]);
      const list = dialog.definition.structure;
      if (op === 'del') list.splice(i, 1); else move(list, i, op === 'up' ? i - 1 : i + 1);
      renderDialog();
      return;
    }
    if (target.matches('[data-tpl-save]')) {
      const api = AI();
      const state = readForm();
      const error = dialog.host.querySelector('[data-tpl-error]');
      if (!state.name) { error.textContent = L('Şablon adı zorunlu.', 'A template name is required.'); dialog.host.querySelector('[name="name"]').focus(); return; }
      target.disabled = true;
      try {
        const lists = dialog.mode === 'edit'
          ? await api.outputTemplates.update(dialog.id, dialog.sharedStore, { name: state.name, definition: state.definition })
          : await api.outputTemplates.create({ name: state.name, shared: state.shared, definition: state.definition });
        const saved = dialog.onSaved;
        const mode = dialog.mode;
        closeDialog();
        toast(mode === 'edit' ? L('Şablon güncellendi.', 'Template updated.') : state.shared ? L('Şablon kaydedildi ve ekiple paylaşıldı.', 'Template saved and shared with the team.') : L('Şablon kaydedildi. Yanıt biçimi çubuğundan seçebilirsiniz.', 'Template saved. Pick it from the answer format bar.'), 'success');
        if (typeof saved === 'function') saved(lists);
      } catch (failure) {
        target.disabled = false;
        error.textContent = api.errorText(failure);
      }
    }
  }

  async function openSaveTemplate() {
    const api = AI();
    if (!ed || !api) return;
    let definition;
    try { definition = await api.draftSkeleton(ed.draft.id, collectData()); }
    catch (error) { toast(api.errorText(error), 'error'); return; }
    definition.orientation = ed.orientation;
    openTemplateForm({ mode: 'save', definition, name: ed.title, container: root(), onSaved: lists => { try { ed && ed.onTemplatesChanged(lists); } catch (_) {} } });
  }

  /* ================= Şablon yöneticisi ================= */
  let manager = null;
  async function openTemplates(options = {}) {
    const api = AI();
    if (!api) return;
    document.getElementById('_lcwaiTemplates')?.remove();
    const overlay = document.createElement('div');
    overlay.id = '_lcwaiTemplates';
    overlay.className = 'warnOverlay lcwaiTplOverlay';
    overlay.setAttribute('data-no-i18n', '');
    overlay.innerHTML = `<div class="modalCard verHistCard lcwaiTplCard" role="dialog" aria-modal="true" aria-label="${esc(L('Çıktı şablonları', 'Output templates'))}">
      <div class="verHistTop"><div><h2>${esc(L('Çıktı şablonları', 'Output templates'))}</h2><p class="lcwaiNote">${esc(L('Şablon dosyanın yapısını saklar; LCW AI her seferinde güncel veriyle doldurur. Ekip şablonları tüm kullanıcılara görünür.', 'A template stores the file’s structure; LCW AI fills it with current data each time. Team templates are visible to all users.'))}</p></div><button type="button" class="verHistClose" data-tpl-close aria-label="${esc(L('Kapat', 'Close'))}"><svg class="ic"><use href="#i-x"/></svg></button></div>
      <div class="lcwaiTplTabs" role="tablist"><button type="button" role="tab" data-tpl-tab="personal">${esc(L('Şablonlarım', 'My templates'))}</button><button type="button" role="tab" data-tpl-tab="shared">${esc(L('Ekip şablonları', 'Team templates'))}</button><span style="flex:1"></span><button type="button" class="lcwaiBtn is-primary" data-tpl-new>＋ ${esc(L('Yeni şablon', 'New template'))}</button></div>
      <div class="lcwaiTplBody" data-tpl-body><p class="lcwaiNote">${esc(L('Yükleniyor…', 'Loading…'))}</p></div>
    </div>`;
    document.body.appendChild(overlay);
    manager = { overlay, tab: options.tab || 'personal', lists: { personal: [], shared: [] }, onUse: options.onUse, onChanged: options.onChanged };
    overlay.addEventListener('click', onManagerClick);
    overlay.addEventListener('keydown', event => { if (event.key === 'Escape' && !overlay.querySelector('.lcwaiEdDialog')) closeManager(); });
    try { setLists(await api.outputTemplates.list()); }
    catch (error) { overlay.querySelector('[data-tpl-body]').innerHTML = `<p class="lcwaiStatus is-error">${esc(api.errorText(error))}</p>`; }
  }
  function closeManager() { if (manager) { manager.overlay.remove(); manager = null; } }
  function setLists(lists) {
    if (!manager) return;
    manager.lists = { personal: lists.personal || [], shared: lists.shared || [] };
    try { if (typeof manager.onChanged === 'function') manager.onChanged(lists); } catch (_) {}
    renderManager();
  }
  function renderManager() {
    if (!manager) return;
    manager.overlay.querySelectorAll('[data-tpl-tab]').forEach(button => { const active = button.dataset.tplTab === manager.tab; button.classList.toggle('is-active', active); button.setAttribute('aria-selected', active ? 'true' : 'false'); });
    const list = manager.lists[manager.tab] || [];
    const body = manager.overlay.querySelector('[data-tpl-body]');
    if (!list.length) {
      body.innerHTML = `<div class="lcwaiChatEmpty"><b>${esc(manager.tab === 'shared' ? L('Henüz ekip şablonu yok', 'No team templates yet') : L('Henüz şablonunuz yok', 'You have no templates yet'))}</b><p>${esc(L('Bir LCW AI dosyasını açın, “Düzenle” ile istediğiniz hâle getirin ve “Şablon olarak kaydet” deyin. Ya da “Yeni şablon” ile sıfırdan oluşturun.', 'Open an LCW AI file, shape it with “Edit” and choose “Save as template”. Or start from scratch with “New template”.'))}</p></div>`;
      return;
    }
    body.innerHTML = `<ul class="lcwaiTplCards">${list.map(item => {
      const def = item.definition;
      const meta = [FORMAT_NAME[def.format], L(`${def.structure.length} öğe`, `${def.structure.length} items`), def.keepFull.length ? L(`${def.keepFull.length} tam alan`, `${def.keepFull.length} full fields`) : '', item.shared && item.ownerName ? L(`Paylaşan: ${item.ownerName}`, `Shared by: ${item.ownerName}`) : '', item.updatedAt ? String(item.updatedAt).slice(0, 10) : ''].filter(Boolean).join(' · ');
      const preview = def.structure.slice(0, 6).map(entry => entry.title || entry.kind).join(' → ');
      return `<li class="lcwaiTplRow"><span class="lcwaiFileIcon is-${esc(def.format)}">${esc(FORMAT_ICON[def.format])}</span>
        <div class="lcwaiFileInfo"><b>${esc(item.name)}</b><small>${esc(meta)}</small>${preview ? `<small class="lcwaiTplPreview">${esc(preview)}${def.structure.length > 6 ? ' …' : ''}</small>` : ''}${def.instructions ? `<small class="lcwaiTplPreview" title="${esc(def.instructions)}">${esc(L('Ek talimat', 'Additional instructions'))}: ${esc(def.instructions.slice(0, 160))}${def.instructions.length > 160 ? '…' : ''}</small>` : ''}</div>
        <div class="lcwaiFileActions">
          ${typeof manager.onUse === 'function' ? `<button type="button" class="lcwaiBtn is-primary" data-tpl-use="${esc(item.id)}">${esc(L('Kullan', 'Use'))}</button>` : ''}
          ${item.canEdit ? `<button type="button" class="lcwaiBtn" data-tpl-edit="${esc(item.id)}">${esc(L('Düzenle', 'Edit'))}</button>` : ''}
          ${item.shared ? `<button type="button" class="lcwaiBtn" data-tpl-copy="${esc(item.id)}">${esc(L('Kopyasını al', 'Make a copy'))}</button>` : `<button type="button" class="lcwaiBtn" data-tpl-share="${esc(item.id)}">${esc(L('Ekiple paylaş', 'Share with team'))}</button>`}
          ${item.canEdit ? `<button type="button" class="lcwaiBtn" data-tpl-remove="${esc(item.id)}">${esc(L('Sil', 'Delete'))}</button>` : ''}
        </div></li>`;
    }).join('')}</ul>`;
  }
  async function onManagerClick(event) {
    if (!manager) return;
    if (event.target === manager.overlay) { closeManager(); return; }
    const target = event.target.closest('button');
    if (!target || target.closest('.lcwaiEdDialog')) return;
    const api = AI();
    const shared = manager.tab === 'shared';
    const item = id => (manager.lists[manager.tab] || []).find(entry => entry.id === id);
    if (target.matches('[data-tpl-close]')) { closeManager(); return; }
    if (target.matches('[data-tpl-tab]')) { manager.tab = target.dataset.tplTab; renderManager(); return; }
    if (target.matches('[data-tpl-new]')) { openTemplateForm({ mode: 'new', definition: {}, container: manager.overlay, onSaved: setLists }); return; }
    if (target.matches('[data-tpl-use]')) { const chosen = item(target.dataset.tplUse); if (chosen) { const use = manager.onUse; closeManager(); use(chosen); } return; }
    if (target.matches('[data-tpl-edit]')) { const chosen = item(target.dataset.tplEdit); if (chosen) openTemplateForm({ mode: 'edit', definition: chosen.definition, name: chosen.name, id: chosen.id, sharedStore: shared, container: manager.overlay, onSaved: setLists }); return; }
    const run = async (promise, message) => {
      target.disabled = true;
      try { setLists(await promise); toast(message, 'success'); }
      catch (error) { target.disabled = false; toast(api.errorText(error), 'error'); }
    };
    if (target.matches('[data-tpl-share]')) { await run(api.outputTemplates.share(target.dataset.tplShare), L('Şablon ekip şablonlarına kopyalandı.', 'Template copied to team templates.')); return; }
    if (target.matches('[data-tpl-copy]')) { await run(api.outputTemplates.copy(target.dataset.tplCopy), L('Şablonun kopyası Şablonlarım’a eklendi.', 'A copy was added to My templates.')); return; }
    if (target.matches('[data-tpl-remove]')) {
      const chosen = item(target.dataset.tplRemove);
      if (!chosen || !window.confirm(L(`“${chosen.name}” şablonu silinsin mi?${shared ? ' Ekip şablonu herkesten kaldırılır.' : ''}`, `Delete the “${chosen.name}” template?${shared ? ' A team template is removed for everyone.' : ''}`))) return;
      await run(api.outputTemplates.remove(chosen.id, shared), L('Şablon silindi.', 'Template deleted.'));
    }
  }

  window.BLOutputEditor = { open, close: () => close(false), openTemplates, _parseTsv: parseTsv, _state: () => ed };
})();
