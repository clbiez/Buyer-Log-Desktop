(function () {
  'use strict';

  /* OAB (KÜP) — Genel Bakış › Ticari widget'ı.
     PASS'li OAB widget'ıyla aynı Order-Assortment-Budget verisini doğrudan
     OAB_Cube SSAS küpünden okur; PASS OAB'ye (oab.js davranışına) dokunmaz,
     iki kaynak yan yana çalışır.
     - Toplamlar PASS OAB'nin kendi pivot motoruyla (window.OABPivotEngine)
       hesaplanır; kopya motor yoktur. Kod alanları (Renk/Model kodu, MAG)
       motorun kuralıyla asla sayıya çevrilmez.
     - Görünüm INTAKE/OAB pivot tablo sözleşmesini (oabPivot* sınıfları, alt/genel
       toplam, grup katlama, kalemle pivot düzenleme, + Filtre ekle) paylaşır.
     - Veri sözleşmesi sunucudadır (server/lib/oab-cube-report.js). Widget
       görünür olmadan sunucuya istek atılmaz; canlı küp sorgusu yalnız Yenile
       veya sorgu düzeyini değiştiren pivot kaydında çalışır. Arama yalnız yüklü
       satırlarda yapılır. */
  const section = document.getElementById('oabCubeSection');
  if (!section || window.BLOabCube) return;

  const MAX_TABLE_ROWS = 1500;
  const state = {
    catalog: { dimensions: [], measures: [], passOnlyFields: [], defaults: null, aggregates: ['SUM', 'AVG', 'MIN', 'MAX'] },
    view: null,
    rows: [], fetchedAt: '', missing: [], truncated: false, rowLimit: 20000, dataDate: '', dataDateSource: '',
    dataFilterValues: null, dataMeasures: null, dataDimensions: null,
    connection: null, loaded: false, loading: false, started: false,
    status: null, popover: null, viewRevision: 0, exporting: false, metadata: null, metadataPromise: null, search: '', displayItems: [],
  };

  const byId = id => document.getElementById(id);
  const isEnglish = () => typeof appLang !== 'undefined' && appLang === 'en';
  const text = (tr, en) => isEnglish() ? en : tr;
  const clean = value => String(value == null ? '' : value).trim();
  const esc = value => clean(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));
  const locale = () => isEnglish() ? 'en-GB' : 'tr-TR';
  const EMPTY_VIEW = { rows: [{ key: 'classGroup' }], columns: [], values: [], filters: [{ key: 'season' }], filterValues: {}, display: { grouped: true, showSubtotals: true, collapsedGroups: [], sort: { key: '', dir: -1 }, widths: {} } };
  const view = () => state.view || state.catalog.defaults || EMPTY_VIEW;
  const display = () => view().display || {};
  const engine = () => window.OABPivotEngine;

  /* ---------- Alan etiketleri ---------- */
  const baseDim = key => state.catalog.dimensions.find(item => item.key === key);
  const baseMeasure = key => state.catalog.measures.find(item => item.key === key);
  const refLabel = ref => {
    if (!ref) return '';
    if (ref.source) return clean(ref.label) || clean(ref.source);
    const item = baseDim(ref.key) || baseMeasure(ref.key);
    return item ? text(item.tr, item.en) : ref.key;
  };
  const missingLabels = () => state.missing.map(key => {
    const ref = [...view().rows, ...view().columns, ...view().values, ...view().filters].find(item => item.key === key);
    return ref ? refLabel(ref) : refLabel({ key });
  }).join(', ');

  const ERROR_COPY = {
    OAB_CUBE_SEASON_REQUIRED: ['Sorgu için filtrelerden en az bir sezon seçin.', 'Select at least one season in the filters.'],
    OAB_CUBE_SOURCE_UNAVAILABLE: ['OAB küpüne şu anda ulaşılamıyor. Şirket ağı veya VPN bağlantısını kontrol edin.', 'The OAB cube is unreachable right now. Check the company network or VPN connection.'],
    OAB_CUBE_SCHEMA_MISMATCH: ['Küp beklenen OAB alanlarını (sezon, model, renk, WSSI/onaylı/plan adet) içermiyor; bağlantının kataloğunu kontrol edin.', 'The cube does not contain the expected OAB fields (season, model, colour, WSSI/approved/plan quantity); check the connection catalog.'],
    OAB_CUBE_FILTER_UNAVAILABLE: ['Seçilen filtre alanı canlı küpte bulunamadı.', 'The selected filter field was not found in the live cube.'],
    OAB_CUBE_FILTER_VALUE_TYPE: ['Filtre değeri alanın tipiyle uyuşmuyor; filtreyi yeniden seçin.', 'A filter value does not match the field type; select the filter again.'],
    CAPABILITY_REQUIRED: ['Bu rapor için OAB görüntüleme yetkisi gerekiyor.', 'This report requires the OAB view permission.'],
  };
  function errorText(payload, fallback) {
    const copy = ERROR_COPY[payload && payload.code];
    if (copy) return text(copy[0], copy[1]);
    return clean(isEnglish() ? (payload && (payload.errorEn || payload.error)) : (payload && payload.error)) || fallback;
  }
  async function requestJson(url, options) {
    const response = await fetch(url, { credentials: 'same-origin', cache: 'no-store', ...(options || {}) });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw Object.assign(new Error(errorText(payload, text('İstek başarısız.', 'Request failed.'))), { payload });
    return payload;
  }
  const jsonBody = (method, body) => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

  function setStatus(copy, kind) { state.status = copy ? { copy, kind } : null; paintStatus(); }
  function paintStatus() {
    const node = byId('oabCubeStatus');
    if (!node) return;
    const current = state.status;
    node.hidden = !current;
    node.className = `intakeStatus${current && current.kind ? ` ${current.kind}` : ''}`;
    node.textContent = current ? (typeof current.copy === 'function' ? current.copy() : current.copy) : '';
  }

  /* ---------- Biçimlendirme ---------- */
  const formatQty = value => value == null || !Number.isFinite(value) ? '' : Math.round(value).toLocaleString(locale());
  const formatDecimal = value => value == null || !Number.isFinite(value) ? '' : value.toLocaleString(locale(), { maximumFractionDigits: 2 });
  const valueFormat = ref => {
    const measure = !ref.source && baseMeasure(ref.key);
    return measure && measure.kind === 'quantity' && (ref.agg || 'SUM') === 'SUM' ? formatQty : formatDecimal;
  };
  const AGG_LABELS = { SUM: ['Toplam', 'Sum'], AVG: ['Ortalama', 'Average'], MIN: ['En küçük', 'Min'], MAX: ['En büyük', 'Max'] };
  const aggLabel = agg => text(...(AGG_LABELS[agg] || [agg, agg]));
  function valueHint(ref) {
    const measure = !ref.source && baseMeasure(ref.key);
    if (measure && measure.kind !== 'quantity') return text(`Toplanabilir bir adet değildir; özetleme: ${aggLabel(ref.agg)} (satır değerleri küpten birebir gelir).`, `Not an additive quantity; summarization: ${aggLabel(ref.agg)} (row values come straight from the cube).`);
    if (ref.source) return `${ref.source} · ${aggLabel(ref.agg)}`;
    return text('Sıralamak için tıklayın', 'Click to sort');
  }
  function dataDateText() {
    const raw = clean(state.dataDate);
    if (!raw) return '';
    const date = new Date(raw);
    return Number.isNaN(date.getTime()) ? raw : date.toLocaleString(locale(), { dateStyle: 'short', timeStyle: 'short' });
  }

  /* ---------- Pivot hesabı: OABPivotEngine toplamları ---------- */
  function groupMetrics(rows) {
    const out = {};
    const pivot = engine();
    if (!pivot) return out;
    // Hiç sayısal değeri olmayan grup boş kalır; motorun boş SUM/AVG sonucu (0) gösterilmez.
    const numeric = window.OABDataUtils && window.OABDataUtils.fieldNumericValue;
    const hasValue = key => rows.some(row => numeric ? numeric(row, key) != null : typeof (row && row[key]) === 'number');
    view().values.forEach(ref => { out[ref.key] = hasValue(ref.key) ? pivot.verifyTotal(rows, ref.key, ref.agg || 'SUM') : null; });
    return out;
  }
  const searchKeys = ['modelCode', 'modelName', 'colourCode', 'colourName'];
  function visibleRows() {
    const terms = state.search && window.BLTableSearch ? window.BLTableSearch.parseTerms(state.search) : [];
    if (!terms.length) return state.rows;
    return state.rows.filter(row => window.BLTableSearch.matches(searchKeys.map(key => clean(row && row[key])).join(' '), terms, { plainMode: 'contains' }));
  }
  const groupKeyOf = path => JSON.stringify(path.map(clean));
  const compareText = (a, b) => String(a).localeCompare(String(b), 'tr', { numeric: true, sensitivity: 'base' });
  function sortSiblings(groups, level) {
    const sort = display().sort || {};
    const dir = Number(sort.dir) === 1 ? 1 : -1;
    const dims = [...view().rows, ...view().columns];
    if (!sort.key) return groups.sort((a, b) => compareText(a.value, b.value));
    if (dims.some(ref => ref.key === sort.key)) {
      if (dims[level] && dims[level].key !== sort.key) return groups.sort((a, b) => compareText(a.value, b.value));
      return groups.sort((a, b) => dir * compareText(a.value, b.value));
    }
    return groups.sort((a, b) => {
      const left = a.metrics[sort.key], right = b.metrics[sort.key];
      if (left == null && right == null) return 0;
      if (left == null) return 1;
      if (right == null) return -1;
      return dir * (left - right);
    });
  }
  function bucket(rows, key) {
    const map = new Map();
    for (const row of rows) {
      const value = clean(row && row[key]);
      if (!map.has(value)) map.set(value, []);
      map.get(value).push(row);
    }
    return [...map.entries()].map(([value, list]) => ({ value, rows: list, metrics: groupMetrics(list) }));
  }
  function displayRows(rows) {
    const rowRefs = view().rows, colRefs = view().columns;
    const dims = [...rowRefs, ...colRefs];
    const collapsed = new Set(display().collapsedGroups || []);
    const showSubtotals = display().showSubtotals !== false;
    const grouped = display().grouped !== false && rowRefs.length > 0;
    const out = [];
    const leafCombos = (list, fromLevel, path) => {
      const walk = (items, level, values) => {
        if (level >= dims.length) {
          const leaf = {}; dims.forEach((ref, index) => { leaf[ref.key] = values[index]; });
          out.push({ kind: 'leaf', dims: leaf, metrics: groupMetrics(items), level: fromLevel, rows: items });
          return;
        }
        sortSiblings(bucket(items, dims[level].key), level).forEach(group => walk(group.rows, level + 1, [...values, group.value]));
      };
      walk(list, fromLevel, path);
    };
    if (!grouped) { leafCombos(rows, 0, []); }
    else {
      const walk = (list, level, path) => {
        const ref = rowRefs[level];
        sortSiblings(bucket(list, ref.key), level).forEach(group => {
          const nextPath = [...path, group.value];
          if (level === rowRefs.length - 1 && colRefs.length === 0) {
            const leaf = {}; rowRefs.forEach((item, index) => { leaf[item.key] = nextPath[index]; });
            out.push({ kind: 'leaf', dims: leaf, metrics: group.metrics, level, rows: group.rows });
            return;
          }
          const pathKey = groupKeyOf(nextPath);
          const isCollapsed = collapsed.has(pathKey);
          const groupDims = {}; groupDims[ref.key] = group.value;
          out.push({ kind: 'group', dims: groupDims, metrics: showSubtotals ? group.metrics : {}, level, pathKey, collapsed: isCollapsed, subtotal: showSubtotals, rows: group.rows, path: nextPath });
          if (isCollapsed) return;
          if (level < rowRefs.length - 1) walk(group.rows, level + 1, nextPath);
          else leafCombos(group.rows, level + 1, nextPath);
        });
      };
      walk(rows, 0, []);
    }
    if (showSubtotals && rows.length) {
      const grand = {}; if (dims[0]) grand[dims[0].key] = text('Genel Toplam', 'Grand Total');
      out.push({ kind: 'grand', dims: grand, metrics: groupMetrics(rows), level: 0, rows });
    }
    return out;
  }
  function groupPathKeys(rows) {
    const rowRefs = view().rows, colRefs = view().columns;
    if (display().grouped === false || !rowRefs.length) return [];
    const keys = [];
    const walk = (list, level, path) => {
      if (level >= rowRefs.length) return;
      const groups = new Map();
      list.forEach(row => { const value = clean(row && row[rowRefs[level].key]); if (!groups.has(value)) groups.set(value, []); groups.get(value).push(row); });
      groups.forEach((items, value) => {
        if (level === rowRefs.length - 1 && colRefs.length === 0) return;
        const next = [...path, value];
        keys.push(groupKeyOf(next));
        walk(items, level + 1, next);
      });
    };
    walk(rows, 0, []);
    return keys;
  }

  /* Gösterilen veri görünümle aynı filtre ve alanlarla mı çekildi? Filtre
     uygulama/kaldırma yalnız görünümü kaydeder; sayfa yenilenince eski
     snapshot yeni filtrelerin altında sessizce görünmesin. */
  const filterSignature = values => JSON.stringify(Object.keys(values || {}).sort().map(key => [key, [...(values[key] || [])].map(clean).sort()]).filter(([, list]) => list.length));
  function staleReason() {
    if (!state.loaded || !state.rows.length) return '';
    if (state.dataFilterValues && filterSignature(state.dataFilterValues) !== filterSignature(view().filterValues)) return 'filters';
    if (state.dataMeasures && view().values.some(ref => !state.dataMeasures.includes(ref.key))) return 'fields';
    if (state.dataDimensions && [...view().rows, ...view().columns].some(ref => !state.dataDimensions.includes(ref.key))) return 'fields';
    return '';
  }

  /* ---------- Çizim ---------- */
  function renderMeta() {
    const node = byId('oabCubeStateMeta');
    if (!node) return;
    const parts = [];
    if (state.loading && state.loaded) parts.push(text('Güncelleniyor…', 'Updating…'));
    if (state.loaded) parts.push(`${state.rows.length.toLocaleString(locale())} ${text('satır', 'rows')}`);
    const dataDate = dataDateText();
    if (dataDate) parts.push(`${text('Veri tarihi', 'Data date')}: ${dataDate}`);
    else if (state.loaded) parts.push(text('Veri tarihi okunamadı', 'Data date unavailable'));
    if (state.fetchedAt) { const date = new Date(state.fetchedAt); if (!Number.isNaN(date.getTime())) parts.push(`${text('Sorgu', 'Queried')}: ${date.toLocaleString(locale())}`); }
    if (state.connection && state.connection.catalog) parts.push(state.connection.catalog);
    node.textContent = parts.join(' · ');
    node.title = text('Küp ETL ile dolar, canlı değildir. Veri tarihi küpteki GuncellemeTarih (yoksa etl_time) değeridir.', 'The cube is loaded by ETL and is not live. The data date is the cube’s GuncellemeTarih (or etl_time) value.');
  }

  function renderToolbar() {
    const search = byId('oabCubeSearch');
    if (search && document.activeElement !== search) search.value = state.search;
    if (search) search.placeholder = text('Model kodu, model adı, renk ara…', 'Search model code, model name, colour…');
  }

  function renderFilters() {
    const bar = byId('oabCubeFilterBar');
    if (!bar) return;
    const fields = view().filters.map(ref => {
      const selected = view().filterValues[ref.key] || [];
      const label = selected.length > 1 ? `${selected.length} ${text('seçim', 'selected')}` : (selected[0] || text('Tümü', 'All'));
      const required = ref.key === 'season' ? ` <span class="oabCubeRequired">${esc(text('(zorunlu)', '(required)'))}</span>` : '';
      const removable = ref.key !== 'season';
      return `<div class="intakeFilterField"><span class="intakeFilterLabel">${esc(refLabel(ref))}${required}</span><div class="intakeFilterControl"><button type="button" class="oabMultiTrigger intakeFilterTrigger" data-oab-cube-filter="${esc(ref.key)}" aria-haspopup="listbox" aria-expanded="false"><span class="oabMultiLabel${selected.length ? ' hasValue' : ''}">${esc(label)}</span><span class="oabMultiChevron" aria-hidden="true">▾</span></button>${removable ? `<button type="button" class="intakeFilterRemove" data-oab-cube-filter-remove="${esc(ref.key)}" title="${esc(text('Filtreyi kaldır', 'Remove filter'))}" aria-label="${esc(text('Filtreyi kaldır', 'Remove filter'))}">×</button>` : ''}</div></div>`;
    }).join('');
    bar.innerHTML = `${fields}<button type="button" class="navActionBtn intakeFilterAdd" data-oab-cube-add-filter>+ ${esc(text('Filtre ekle', 'Add filter'))}</button>`;
    const button = byId('oabCubeFiltersBtn');
    if (button) button.classList.toggle('hasActiveFilters', Object.keys(view().filterValues || {}).length > 0);
  }

  function updateGroupButtons(rows) {
    const keys = rows ? groupPathKeys(rows) : [];
    const collapsed = new Set(display().collapsedGroups || []);
    const expand = byId('oabCubeExpandAllBtn'), collapse = byId('oabCubeCollapseAllBtn');
    if (expand) { expand.hidden = !keys.length; expand.disabled = !keys.length || collapsed.size === 0; }
    if (collapse) { collapse.hidden = !keys.length; collapse.disabled = !keys.length; }
  }

  function cellHtml(item, ref, dims, isValue) {
    if (isValue) return `<td class="num">${esc(valueFormat(ref)(item.metrics[ref.key] == null ? null : item.metrics[ref.key]))}</td>`;
    const index = dims.findIndex(entry => entry.key === ref.key);
    const value = item.dims[ref.key];
    if (item.kind === 'group') {
      if (index > item.level) return '';
      if (index === item.level) {
        const label = value == null || value === '' ? text('(boş)', '(blank)') : value;
        const span = Math.max(1, dims.length - item.level);
        return `<td class="oabPivotGroupCell"${span > 1 ? ` colspan="${span}"` : ''} title="${esc(label)}"><button type="button" class="oabPivotGroupToggle" data-oab-cube-group-key="${esc(item.pathKey)}" title="${esc(item.collapsed ? text('Grubu genişlet', 'Expand group') : text('Grubu daralt', 'Collapse group'))}">${item.collapsed ? '▸' : '▾'}</button><strong>${esc(label)}</strong>${item.subtotal ? `<span class="oabPivotSubtotalTag">${esc(text('Alt toplam', 'Subtotal'))}</span>` : ''}</td>`;
      }
      return '<td></td>';
    }
    if (item.kind === 'grand') return `<td class="${index === 0 ? 'oabPivotGrandLabel' : ''}">${index === 0 ? `<strong>${esc(value)}</strong>` : ''}</td>`;
    if (display().grouped !== false && index >= 0 && index < item.level) return '<td></td>';
    return `<td>${esc(value == null || value === '' ? text('(boş)', '(blank)') : value)}</td>`;
  }

  function renderPassGap() {
    const node = byId('oabCubePassGap');
    if (!node) return;
    const fields = (state.catalog.passOnlyFields || []).map(item => text(item.tr, item.en));
    node.hidden = !fields.length;
    node.textContent = fields.length ? text(`PASS OAB raporunda olup bu küpte bulunmayan alanlar (gösterilmez, uydurulmaz): ${fields.join(', ')}.`, `Fields in the PASS OAB report that this cube does not have (not shown, never invented): ${fields.join(', ')}.`) : '';
  }

  function renderBody() {
    const body = byId('oabCubeBody'), table = byId('oabCubeTable'), note = byId('oabCubeNote');
    if (!body || !table) return;
    body.hidden = false;
    renderPassGap();
    if (!engine()) {
      if (note) note.hidden = true;
      table.innerHTML = `<tbody><tr><td class="intakeEmpty">${esc(text('OAB pivot motoru yüklenemedi; sayfayı yenileyin.', 'The OAB pivot engine could not be loaded; reload the page.'))}</td></tr></tbody>`;
      return;
    }
    if (!state.rows.length) {
      if (note) note.hidden = true;
      updateGroupButtons(null);
      const message = state.loaded
        ? text('Seçili filtrelerde satır yok. Filtreleri genişletip Yenile’ye basın.', 'No rows for the selected filters. Widen the filters and press Refresh.')
        : text('Filtrelerden en az bir sezon (isterseniz MAG ve Buyer grup) seçip Yenile’ye basın. Sorgu OAB_Cube küpüne sizin Windows kimliğinizle tek DAX sorgusu olarak gider.', 'Select at least one season (optionally MAG and Buyer group) in the filters and press Refresh. The query runs against the OAB_Cube cube as a single DAX query with your Windows identity.');
      table.innerHTML = `<tbody><tr><td class="intakeEmpty">${esc(message)}</td></tr></tbody>`;
      return;
    }
    const rows = visibleRows();
    const dims = [...view().rows, ...view().columns];
    const values = view().values;
    const sort = display().sort || {};
    const arrow = key => sort.key === key ? (Number(sort.dir) === 1 ? ' ↑' : ' ↓') : '';
    const head = [...dims.map(ref => `<th data-oab-cube-sort="${esc(ref.key)}" title="${esc(text('Sıralamak için tıklayın', 'Click to sort'))}">${esc(refLabel(ref))}${arrow(ref.key)}</th>`),
      ...values.map(ref => `<th class="num" data-oab-cube-sort="${esc(ref.key)}" title="${esc(valueHint(ref))}">${esc(refLabel(ref))}${arrow(ref.key)}</th>`)].join('');
    const items = displayRows(rows);
    const shown = items.length > MAX_TABLE_ROWS ? [...items.slice(0, MAX_TABLE_ROWS - 1), items[items.length - 1]] : items;
    const rowClass = item => item.kind === 'grand' ? 'oabPivotGrandTotalRow' : (item.kind === 'group' ? (item.subtotal ? 'oabPivotSubtotalRow' : 'oabPivotGroupRow') : '');
    state.displayItems = shown;
    const bodyHtml = shown.map((item, index) => `<tr class="${rowClass(item)}" data-oab-cube-row="${index}">${dims.map(ref => cellHtml(item, ref, dims, false)).join('')}${values.map(ref => cellHtml(item, ref, dims, true)).join('')}</tr>`).join('');
    table.innerHTML = `<thead><tr>${head}</tr></thead><tbody>${bodyHtml || `<tr><td class="intakeEmpty" colspan="${dims.length + values.length}">${esc(text('Aramayla eşleşen satır yok.', 'No rows match the search.'))}</td></tr>`}</tbody>`;
    updateGroupButtons(rows);
    const drillTitle = text('Alt detayı görmek için çift tıklayın', 'Double-click to see drill-down details');
    table.querySelectorAll('tbody tr[data-oab-cube-row] > td').forEach(td => { td.classList.add('oabPivotDrillCell'); if (!td.title) td.title = drillTitle; });
    try {
      const wordPx = label => Math.max(...String(label).split(/\s+/).map(word => word.length)) * 10 + 28;
      const dimPx = (ref, index) => {
        const longest = rows.reduce((max, row) => Math.max(max, clean(row && row[ref.key]).length), 0);
        const groupExtra = index < view().rows.length - 1 || view().columns.length ? 120 : 0;
        return Math.min(360, Math.max(wordPx(refLabel(ref)), longest * 8 + 28 + groupExtra));
      };
      window.BLTableColumnResize?.apply(table, { store: widthStore, columns: [...dims.map((ref, index) => ({ key: ref.key, label: refLabel(ref), type: 'text', minPx: dimPx(ref, index) })), ...values.map(ref => ({ key: ref.key, label: refLabel(ref), type: 'num', minPx: wordPx(refLabel(ref)) }))] });
    } catch (error) { console.warn('OAB (Küp) sütun genişliği uygulanamadı:', error); }
    const notes = [];
    const stale = staleReason();
    if (stale === 'filters') notes.push(text('Gösterilen veri farklı filtrelerle çekildi; seçili filtreler için Yenile’ye basın.', 'The data shown was queried with different filters; press Refresh for the selected filters.'));
    if (stale === 'fields') notes.push(text('Görünümdeki bazı alanlar son sorguda yoktu (boş görünür); Yenile’ye basın.', 'Some fields in the view were not in the last query (shown blank); press Refresh.'));
    if (state.search) notes.push(text(`Arama: ${rows.length.toLocaleString(locale())} / ${state.rows.length.toLocaleString(locale())} satır eşleşti.`, `Search: ${rows.length.toLocaleString(locale())} / ${state.rows.length.toLocaleString(locale())} rows match.`));
    if (items.length > shown.length) notes.push(text(`İlk ${MAX_TABLE_ROWS.toLocaleString(locale())} satır gösteriliyor; grupları daraltın veya filtreleyin.`, `Showing the first ${MAX_TABLE_ROWS.toLocaleString(locale())} rows; collapse groups or filter.`));
    if (state.truncated) notes.push(text(`Sorgu ${state.rowLimit.toLocaleString(locale())} satır sınırına ulaştı; toplamlar eksik olabilir. Filtreleri daraltın.`, `The query hit the ${state.rowLimit.toLocaleString(locale())} row limit; totals may be incomplete. Narrow the filters.`));
    if (note) { note.hidden = !notes.length; note.textContent = notes.join(' '); }
  }

  /* ---------- Alt detay (OAB ile aynı ortak sağ çekmece) ---------- */
  const DEFAULT_DETAIL = ['season', 'mag', 'buyerGroup', 'classGroup', 'classification', 'modelCode', 'modelName', 'colourCode', 'colourName', 'wssi', 'approved', 'plan', 'unapproved', 'poQty'];
  function detailLabel(key) {
    const dim = baseDim(key); if (dim) return text(dim.tr, dim.en);
    const measure = baseMeasure(key); if (measure) return text(measure.tr, measure.en);
    const ref = [...view().rows, ...view().columns, ...view().filters, ...view().values].find(item => item.key === key);
    return ref ? refLabel(ref) : key;
  }
  function openDetail(item, ref) {
    const rows = Array.isArray(item && item.rows) ? item.rows : [];
    if (!rows.length) { setStatus(() => text('Bu hücre için alt detay bulunamadı.', 'No drill-down detail was found for this cell.'), 'warning'); return; }
    const keys = [];
    const add = key => { if (key && !keys.includes(key)) keys.push(key); };
    DEFAULT_DETAIL.forEach(add);
    rows.slice(0, 200).forEach(row => Object.keys(row).forEach(add));
    const numeric = key => !baseDim(key) && rows.some(row => typeof row[key] === 'number');
    const columns = keys.filter(key => rows.some(row => row[key] !== undefined)).map(key => ({
      key, label: detailLabel(key), type: numeric(key) ? 'number' : 'text',
      ...(numeric(key) ? { format: value => value == null || value === '' ? '' : formatDecimal(value) } : {}),
    }));
    const dims = [...view().rows, ...view().columns];
    const context = item.kind === 'grand'
      ? text('Genel Toplam', 'Grand Total')
      : (item.kind === 'group' ? item.path : dims.map(entry => item.dims[entry.key]).filter(value => value != null))
        .map((value, index) => `${refLabel(dims[index])}: ${value === '' ? text('(boş)', '(blank)') : value}`).join(' › ');
    const metric = ref && item.metrics[ref.key];
    const note = [ref && metric != null ? `${refLabel(ref)}: ${valueFormat(ref)(metric)}` : '', `${rows.length.toLocaleString(locale())} ${text('kaynak satır', 'source rows')}`, dataDateText() ? `${text('Veri tarihi', 'Data date')}: ${dataDateText()}` : ''].filter(Boolean).join(' · ');
    if (!window.BLDetailDrawer || typeof window.BLDetailDrawer.open !== 'function') { setStatus(() => text('Alt detay çekmecesi yüklenemedi.', 'The drill-down drawer could not be loaded.'), 'error'); return; }
    window.BLDetailDrawer.open({
      storageKey: 'oabcube.pivot.detail',
      pageScope: 'overview.oabcube',
      moduleId: 'overview',
      source: 'oabcube',
      title: `${text('OAB (Küp) Alt Detay', 'OAB (Cube) Drill-down')}${ref ? ` · ${refLabel(ref)}` : ''}`,
      subtitle: context,
      note,
      rows,
      columns,
      defaultVisible: DEFAULT_DETAIL.filter(key => columns.some(column => column.key === key)),
      exactDefaultVisible: true,
      flatColumns: true,
      images: false,
      fileName: 'OAB_Kup_Alt_Detay',
    });
  }

  /* ---------- Excel (pivot + kaynak satırlar + filtre/kaynak özeti) ---------- */
  async function exportExcel() {
    if (state.exporting || !state.rows.length || !engine()) return;
    state.exporting = true;
    paintExportButton();
    try {
      if (!window.XLSX && window.BLPerf?.ensureLibrary) await window.BLPerf.ensureLibrary('xlsx');
      const X = window.XLSX;
      if (!X) throw new Error('XLSX');
      const rows = visibleRows();
      const dims = [...view().rows, ...view().columns], values = view().values;
      const round = value => typeof value === 'number' && Number.isFinite(value) ? Math.round(value * 10000) / 10000 : (value == null ? null : value);
      const pivot = displayRows(rows).map(item => {
        const out = {};
        out[text('Satır tipi', 'Row type')] = item.kind === 'grand' ? text('Genel toplam', 'Grand total') : (item.kind === 'group' ? text('Alt toplam', 'Subtotal') : text('Detay', 'Detail'));
        dims.forEach((ref, index) => {
          out[refLabel(ref)] = item.kind === 'group' ? (index === item.level ? item.dims[ref.key] : (index < item.level ? item.path[index] : '')) : (item.dims[ref.key] ?? '');
        });
        values.forEach(ref => { out[refLabel(ref)] = round(item.metrics[ref.key]); });
        return out;
      });
      const rowKeys = [];
      rows.slice(0, 200).forEach(row => Object.keys(row).forEach(key => { if (!rowKeys.includes(key)) rowKeys.push(key); }));
      // Boyutlar (kod alanları dahil) metin hücre olarak yazılır; sayıya çevrilmez.
      const source = rows.map(row => {
        const out = {};
        rowKeys.forEach(key => { out[detailLabel(key)] = baseDim(key) ? clean(row[key]) : round(row[key]); });
        return out;
      });
      const field = text('Alan', 'Field'), valueLabel = text('Değer', 'Value');
      // Özet, dışa aktarılan satırları ÜRETEN filtreleri yazar (ekrandaki seçim
      // Yenile'den sonra değişmiş olabilir); uyuşmazlık ayrıca uyarı satırıdır.
      const dataFilters = state.dataFilterValues || view().filterValues || {};
      const filterLabel = key => { const ref = view().filters.find(item => item.key === key); return ref ? refLabel(ref) : refLabel({ key }); };
      const stale = staleReason();
      const summary = [
        ...Object.entries(dataFilters).filter(([, values]) => Array.isArray(values) && values.length).map(([key, values]) => ({ [field]: filterLabel(key), [valueLabel]: values.join(', ') })),
        ...(stale ? [{ [field]: text('Uyarı', 'Warning'), [valueLabel]: stale === 'filters' ? text('Ekrandaki filtre seçimi bu verinin çekildiği filtrelerden farklı; yukarıdaki filtreler dışa aktarılan satırlarındır.', 'The on-screen filter selection differs from the filters this data was queried with; the filters above belong to the exported rows.') : text('Görünümdeki bazı alanlar son sorguda yoktu.', 'Some fields in the view were not in the last query.') }] : []),
        ...(state.search ? [{ [field]: text('Arama', 'Search'), [valueLabel]: state.search }] : []),
        { [field]: text('Veri tarihi', 'Data date'), [valueLabel]: state.dataDate || text('Okunamadı', 'Unavailable') },
        { [field]: text('Son sorgu', 'Last query'), [valueLabel]: state.fetchedAt },
        { [field]: text('Kaynak', 'Source'), [valueLabel]: state.connection ? `${state.connection.server} / ${state.connection.catalog}` : '' },
        { [field]: text('Küpte olmayan PASS alanları', 'PASS fields missing in the cube'), [valueLabel]: (state.catalog.passOnlyFields || []).map(item => text(item.tr, item.en)).join(', ') },
        ...(state.truncated ? [{ [field]: text('Uyarı', 'Warning'), [valueLabel]: text('Sorgu satır sınırına ulaştı; toplamlar eksik olabilir.', 'The query hit the row limit; totals may be incomplete.') }] : []),
      ];
      const book = X.utils.book_new();
      X.utils.book_append_sheet(book, X.utils.json_to_sheet(pivot), 'Pivot');
      X.utils.book_append_sheet(book, X.utils.json_to_sheet(source), text('Kaynak satırlar', 'Source rows').slice(0, 31));
      X.utils.book_append_sheet(book, X.utils.json_to_sheet(summary), text('Filtreler', 'Filters'));
      X.writeFile(book, `OAB_Kup_${new Date().toISOString().slice(0, 10).replace(/-/g, '')}.xlsx`, { compression: true });
    } catch (error) {
      setStatus(() => text('Excel dosyası oluşturulamadı.', 'The Excel file could not be created.'), 'error');
    } finally { state.exporting = false; paintExportButton(); }
  }
  function paintExportButton() {
    const button = byId('oabCubeExcelExportBtn');
    if (!button) return;
    button.disabled = state.loading || state.exporting || !state.rows.length;
    button.setAttribute('aria-busy', state.exporting ? 'true' : 'false');
  }

  function render() {
    renderMeta();
    renderToolbar();
    renderFilters();
    renderBody();
    paintStatus();
    const refresh = byId('oabCubeRefreshBtn');
    if (refresh) { refresh.disabled = state.loading; refresh.setAttribute('aria-busy', state.loading ? 'true' : 'false'); }
    byId('oabCubeBody')?.classList.toggle('isBusy', state.loading);
    paintExportButton();
  }

  const widthStore = {
    get: id => { const px = Number(display().widths && display().widths[id]); return Number.isFinite(px) ? px : null; },
    set: (id, px) => { const current = state.view || clone(view()); current.display = current.display || {}; current.display.widths = { ...(current.display.widths || {}), [id]: Math.round(px) }; state.view = current; },
    save: () => saveView({ silent: true }),
  };

  function applyPayload(payload) {
    state.rows = Array.isArray(payload && payload.rows) ? payload.rows : [];
    state.fetchedAt = clean(payload && payload.fetchedAt);
    state.missing = Array.isArray(payload && payload.missing) ? payload.missing : [];
    state.truncated = Boolean(payload && payload.truncated);
    state.rowLimit = Number(payload && payload.rowLimit) || state.rowLimit;
    state.dataDate = clean(payload && payload.dataDate);
    state.dataFilterValues = payload && payload.filterValues && typeof payload.filterValues === 'object' ? payload.filterValues : null;
    state.dataMeasures = Array.isArray(payload && payload.measures) ? payload.measures : null;
    state.dataDimensions = Array.isArray(payload && payload.dimensions) ? payload.dimensions : null;
    state.dataDateSource = clean(payload && payload.dataDateSource);
  }

  /* ---------- Veri ---------- */
  async function loadState() {
    try {
      const payload = await requestJson('/api/oab-cube/state');
      state.catalog = { ...state.catalog, ...(payload.catalog || {}) };
      state.view = payload.view || clone(state.catalog.defaults);
      state.connection = payload.connection || null;
      if (payload.snapshot) { applyPayload(payload.snapshot); state.loaded = true; }
      setStatus(null);
    } catch (error) { setStatus(error.message || String(error), 'error'); }
    render();
  }

  /* Görünüm sunucuya kaydedilir; yanıt ancak gönderildiği revizyon hâlâ
     güncelse görünümün yerine geçer. Art arda gelen kayıtlar birleşir; her
     çağıranın sözü en son kaydın sonucuyla çözülür. */
  let saveTimer = 0;
  let saveWaiters = [];
  let pendingSaves = [];
  function flushSaveWaiters(value) { const waiters = saveWaiters; saveWaiters = []; waiters.forEach(resolve => resolve(value)); }
  function saveView(options = {}) {
    state.viewRevision += 1;
    const revision = state.viewRevision;
    clearTimeout(saveTimer);
    return new Promise(resolve => {
      saveWaiters.push(resolve);
      saveTimer = setTimeout(async () => {
        try {
          const result = await requestJson('/api/oab-cube/view', jsonBody('PUT', { view: view() }));
          if (revision === state.viewRevision && result.view) state.view = result.view;
          flushSaveWaiters(result.view || null);
        } catch (error) { if (!options.silent) setStatus(error.message || String(error), 'error'); flushSaveWaiters(null); }
      }, options.immediate ? 0 : 250);
    });
  }

  async function refresh(force) {
    if (state.loading) return;
    if (!(view().filterValues.season || []).length) {
      setStatus(() => text('Sorgu için filtrelerden en az bir sezon seçin.', 'Select at least one season in the filters.'), 'warning');
      setFilterPanelOpen(true);
      return;
    }
    state.loading = true;
    setStatus(() => text('OAB küpü sorgulanıyor…', 'Querying the OAB cube…'), 'loading');
    render();
    try {
      clearTimeout(saveTimer);
      const revision = state.viewRevision;
      pendingSaves = saveWaiters; saveWaiters = [];
      const payload = await requestJson('/api/oab-cube/report', jsonBody('POST', { view: view(), forceRefresh: Boolean(force) }));
      pendingSaves.forEach(resolve => resolve(payload.view || null)); pendingSaves = [];
      if (payload.view && revision === state.viewRevision) state.view = payload.view;
      applyPayload(payload);
      state.loaded = true;
      if (payload.offline) setStatus(() => text('Küp şu anda erişilemiyor; son kayıtlı sonuç gösteriliyor.', 'The cube is unreachable; showing the last saved result.'), 'warning');
      else if (state.missing.length) setStatus(() => text(`Küpte bulunmayan alanlar boş gösterildi: ${missingLabels()}.`, `Fields missing from the cube are shown blank: ${missingLabels()}.`), 'warning');
      else setStatus(payload.fromCache ? () => text('Son 30 dakikadaki aynı sorgunun sonucu gösteriliyor.', 'Showing the result of the same query from the last 30 minutes.') : null, payload.fromCache ? 'ok' : '');
    } catch (error) { setStatus(error.message || String(error), 'error'); }
    finally { pendingSaves.forEach(resolve => resolve(null)); pendingSaves = []; state.loading = false; render(); }
  }

  function loadMetadata() {
    if (state.metadata) return Promise.resolve(state.metadata);
    if (state.metadataPromise) return state.metadataPromise;
    state.metadataPromise = requestJson('/api/oab-cube/metadata')
      .then(result => { state.metadata = { dimensions: result.dimensions || [], measures: result.measures || [] }; return state.metadata; })
      .catch(error => { setStatus(text(`Küp alan listesi okunamadı; yalnız hazır alanlar kullanılabilir. ${error.message || ''}`, `The cube field list could not be read; only built-in fields are available. ${error.message || ''}`), 'warning'); return null; })
      .finally(() => { state.metadataPromise = null; });
    return state.metadataPromise;
  }

  /* Pivot alan havuzu: hazır alanlar + canlı küpün diğer alanları. Boyutlar
     yalnız ilişkisi kanıtlı tablolardan gelir (sunucu filtreler ve doğrular). */
  function dimensionPool() {
    const pool = state.catalog.dimensions.map(item => ({ id: item.key, ref: { key: item.key }, label: text(item.tr, item.en), group: text('Hazır alanlar', 'Built-in fields') }));
    for (const ref of [...view().rows, ...view().columns, ...view().filters]) if (ref.source && !pool.some(entry => entry.id === ref.key)) pool.push({ id: ref.key, ref: clone(ref), label: refLabel(ref), group: text('Küp alanları', 'Cube fields') });
    for (const field of (state.metadata && state.metadata.dimensions) || []) {
      if (field.baseKey || pool.some(entry => entry.ref.source === field.source)) continue;
      pool.push({ id: `src:${field.source}`, ref: { source: field.source, label: field.label }, label: `${field.table} › ${field.label}`, group: text('Küp alanları', 'Cube fields') });
    }
    return pool;
  }
  function valuePool() {
    const pool = state.catalog.measures.map(item => ({ id: item.key, ref: { key: item.key, agg: item.agg }, label: text(item.tr, item.en), group: text('Hazır ölçüler', 'Built-in measures') }));
    for (const ref of view().values) if (ref.source && !pool.some(entry => entry.id === ref.key)) pool.push({ id: ref.key, ref: clone(ref), label: refLabel(ref), group: text('Küp ölçüleri', 'Cube measures') });
    for (const field of (state.metadata && state.metadata.measures) || []) {
      if (field.baseKey || pool.some(entry => entry.ref.source === field.source)) continue;
      pool.push({ id: `src:${field.source}`, ref: { source: field.source, label: field.label, agg: 'SUM' }, label: field.label, group: text('Küp ölçüleri', 'Cube measures') });
    }
    return pool;
  }
  const poolIdOf = ref => ref.source ? ref.key || `src:${ref.source}` : ref.key;

  /* ---------- Pivot düzenleyici (INTAKE Ayarları ile aynı kabuk) ---------- */
  function optionsHtml(pool, selectedId) {
    const groups = new Map();
    pool.forEach(entry => { if (!groups.has(entry.group)) groups.set(entry.group, []); groups.get(entry.group).push(entry); });
    return [...groups.entries()].map(([group, entries]) => `<optgroup label="${esc(group)}">${entries.map(entry => `<option value="${esc(entry.id)}"${entry.id === selectedId ? ' selected' : ''}>${esc(entry.label)}</option>`).join('')}</optgroup>`).join('');
  }
  const actionsHtml = () => `<div class="oabConfigActions">
      <button type="button" class="oabConfigIconBtn" data-oab-cube-config-move="-1" title="${esc(text('Yukarı taşı', 'Move up'))}" aria-label="${esc(text('Yukarı taşı', 'Move up'))}">↑</button>
      <button type="button" class="oabConfigIconBtn" data-oab-cube-config-move="1" title="${esc(text('Aşağı taşı', 'Move down'))}" aria-label="${esc(text('Aşağı taşı', 'Move down'))}">↓</button>
      <button type="button" class="oabConfigIconBtn danger" data-oab-cube-config-remove title="${esc(text('Sil', 'Remove'))}" aria-label="${esc(text('Sil', 'Remove'))}">×</button>
    </div>`;
  const axisRowHtml = (id, pool) => `<div class="oabPivotAxisRow oabConfigRow intakeConfigRow"><span class="oabConfigDrag" aria-hidden="true">⋮⋮</span><select class="oabCubeAxisField" aria-label="${esc(text('Alan', 'Field'))}">${optionsHtml(pool, id)}</select>${actionsHtml()}</div>`;
  function valueRowHtml(id, agg, pool) {
    const aggOptions = state.catalog.aggregates.map(item => `<option value="${item}"${item === (agg || 'SUM') ? ' selected' : ''}>${esc(aggLabel(item))}</option>`).join('');
    return `<div class="oabPivotValueRow oabConfigRow intakeConfigRow"><span class="oabConfigDrag" aria-hidden="true">⋮⋮</span><select class="oabCubeValueField" aria-label="${esc(text('Değer', 'Value'))}">${optionsHtml(pool, id)}</select><select class="oabCubeValueAgg" aria-label="${esc(text('Özetleme', 'Summarization'))}">${aggOptions}</select>${actionsHtml()}</div>`;
  }
  function refreshOrderButtons(list) {
    const rows = [...list.querySelectorAll('.oabConfigRow')];
    rows.forEach((row, index) => {
      const up = row.querySelector('[data-oab-cube-config-move="-1"]'), down = row.querySelector('[data-oab-cube-config-move="1"]');
      if (up) up.disabled = index === 0;
      if (down) down.disabled = index === rows.length - 1;
    });
  }
  /* Sorgu düzeyi: satır/sütundaki isteğe bağlı/küp alanları gruplanır, filtre-yalnız
     alanlar gruplanmaz; eklenen küp ölçüsü sorguya girer. Değişince veri yeniden çekilir. */
  const queryShape = current => JSON.stringify([
    [...current.rows, ...current.columns].filter(ref => ref.source || Boolean((baseDim(ref.key) || {}).optionalGrain)).map(ref => ref.source || ref.key).sort(),
    current.filters.filter(ref => ref.source).map(ref => ref.source).sort(),
    current.values.filter(ref => ref.source).map(ref => ref.source).sort(),
  ]);

  async function openFields() {
    document.getElementById('_oabCubeFieldsModal')?.remove();
    await loadMetadata();
    const draft = clone(view());
    const dims = dimensionPool(), vals = valuePool();
    const modal = document.createElement('div');
    modal.className = 'autoModalOverlay';
    modal.id = '_oabCubeFieldsModal';
    const sectionHtml = (id, title, addLabel, body) => `<div class="oabSettingsSection"><div class="oabSettingsSectionHead"><span>${esc(title)}</span><button type="button" class="navActionBtn" data-oab-cube-add="${id}">+ ${esc(addLabel)}</button></div><div class="oabPivotConfigList" id="${id}">${body}</div></div>`;
    modal.innerHTML = `<div class="autoModal oabSettingsModal intakeFieldsModal" role="dialog" aria-modal="true" aria-labelledby="_oabCubeFieldsTitle">
      <header><h3 id="_oabCubeFieldsTitle">${esc(text('OAB (Küp) Ayarları', 'OAB (Cube) Settings'))}</h3><button type="button" data-oab-cube-close aria-label="${esc(text('Kapat', 'Close'))}">×</button></header>
      <div class="autoModalBody">
        <div class="oabPivotBehaviorGrid">
          <label class="oabCheckField"><input type="checkbox" id="oabCubeGroupedInput"${draft.display.grouped !== false ? ' checked' : ''}><span>${esc(text('Gruplu pivot görünümü', 'Grouped pivot view'))}</span></label>
          <label class="oabCheckField"><input type="checkbox" id="oabCubeSubtotalsInput"${draft.display.showSubtotals !== false ? ' checked' : ''}><span>${esc(text('Alt toplamları ve genel toplamı göster', 'Show subtotals and grand total'))}</span></label>
        </div>
        ${sectionHtml('oabCubeRowsList', text('Pivot Satırları', 'Pivot Rows'), text('Alan ekle', 'Add field'), draft.rows.map(ref => axisRowHtml(poolIdOf(ref), dims)).join(''))}
        ${sectionHtml('oabCubeColsList', text('Pivot Sütunları', 'Pivot Columns'), text('Alan ekle', 'Add field'), draft.columns.map(ref => axisRowHtml(poolIdOf(ref), dims)).join(''))}
        ${sectionHtml('oabCubeValuesList', text('Pivot Değerleri', 'Pivot Values'), text('Değer ekle', 'Add value'), draft.values.map(ref => valueRowHtml(poolIdOf(ref), ref.agg, vals)).join(''))}
        ${sectionHtml('oabCubeFiltersList', text('Filtre Alanları', 'Filter Fields'), text('Alan ekle', 'Add field'), draft.filters.map(ref => axisRowHtml(poolIdOf(ref), dims)).join(''))}
        <p class="oabSettingsHint">${esc(text('Satırları oklarla sıralayabilirsiniz. Adet ölçüleri toplanır; mağaza sayısı, landed fiyat ve markup toplanabilir değildir (varsayılan en büyük/ortalama). Küp alanı yalnız ölçülerle ilişkisi kanıtlı tablolardan (Data, DummyUrun, Sezon) eklenebilir; satır/sütuna eklenen alan sorgu düzeyini değiştirir ve kayıtta veri yeniden çekilir. Sezon filtresi zorunludur.', 'Reorder rows with the arrows. Quantity measures are summed; store count, landed price and markup are not additive (default max/average). Cube fields can be added only from tables with a proven relationship to the measures (Data, DummyUrun, Sezon); a field added to rows/columns changes the query level and data is re-queried on save. The season filter is required.'))}</p>
      </div>
      <footer><button type="button" class="tbtn" data-oab-cube-settings-reset>${esc(text('Pivot Varsayılanına Dön', 'Reset Pivot'))}</button><button type="button" class="tbtn" data-oab-cube-close>${esc(text('Vazgeç', 'Cancel'))}</button><button type="button" class="tbtn primary" data-oab-cube-save>${esc(text('Kaydet', 'Save'))}</button></footer>
    </div>`;
    document.body.appendChild(modal);
    const dialog = modal.querySelector('[role="dialog"]');
    window.BLMotionPlus?.play?.('overlay', dialog);
    const close = () => modal.remove();
    modal.querySelectorAll('[data-oab-cube-close]').forEach(button => button.addEventListener('click', close));
    modal.addEventListener('keydown', event => { if (event.key === 'Escape') { event.stopPropagation(); close(); } });
    modal.addEventListener('pointerdown', event => { modal.dataset.backdropDown = event.target === modal ? '1' : '0'; });
    modal.addEventListener('pointerup', event => { if (event.target === modal && modal.dataset.backdropDown === '1') close(); modal.dataset.backdropDown = '0'; });
    const lists = ['oabCubeRowsList', 'oabCubeColsList', 'oabCubeValuesList', 'oabCubeFiltersList'].map(id => modal.querySelector(`#${id}`));
    lists.forEach(refreshOrderButtons);
    modal.addEventListener('click', event => {
      const add = event.target.closest('[data-oab-cube-add]');
      if (add) {
        const list = modal.querySelector(`#${add.dataset.oabCubeAdd}`);
        const isValue = add.dataset.oabCubeAdd === 'oabCubeValuesList';
        const pool = isValue ? vals : dims;
        const used = new Set([...list.querySelectorAll('select.oabCubeAxisField,select.oabCubeValueField')].map(select => select.value));
        const next = pool.find(entry => !used.has(entry.id)) || pool[0];
        if (!next) return;
        list.insertAdjacentHTML('beforeend', isValue ? valueRowHtml(next.id, next.ref.agg || 'SUM', vals) : axisRowHtml(next.id, dims));
        refreshOrderButtons(list);
        return;
      }
      const remove = event.target.closest('[data-oab-cube-config-remove]');
      if (remove) { const row = remove.closest('.oabConfigRow'), list = row.parentElement; row.remove(); refreshOrderButtons(list); return; }
      const move = event.target.closest('[data-oab-cube-config-move]');
      if (move) {
        const row = move.closest('.oabConfigRow'), list = row.parentElement;
        if (Number(move.dataset.oabCubeConfigMove) < 0 && row.previousElementSibling) list.insertBefore(row, row.previousElementSibling);
        if (Number(move.dataset.oabCubeConfigMove) > 0 && row.nextElementSibling) list.insertBefore(row.nextElementSibling, row);
        refreshOrderButtons(list);
      }
    });
    modal.addEventListener('change', event => {
      const select = event.target.closest('.oabCubeValueField');
      if (!select) return;
      const entry = vals.find(item => item.id === select.value);
      const agg = select.closest('.oabConfigRow').querySelector('.oabCubeValueAgg');
      if (agg && entry && entry.ref.agg) agg.value = entry.ref.agg;
    });
    const collect = (list, pool) => {
      const out = [], seen = new Set();
      list.querySelectorAll('select.oabCubeAxisField').forEach(select => {
        const entry = pool.find(item => item.id === select.value);
        if (!entry || seen.has(entry.id)) return;
        seen.add(entry.id); out.push(clone(entry.ref));
      });
      return out;
    };
    modal.querySelector('[data-oab-cube-save]').addEventListener('click', async () => {
      const before = queryShape(view());
      const next = clone(view());
      next.rows = collect(lists[0], dims);
      next.columns = collect(lists[1], dims);
      next.filters = collect(lists[3], dims);
      const seenValues = new Set();
      next.values = [...lists[2].querySelectorAll('.oabPivotValueRow')].map(row => {
        const entry = vals.find(item => item.id === row.querySelector('.oabCubeValueField').value);
        if (!entry || seenValues.has(entry.id)) return null;
        seenValues.add(entry.id);
        return { ...clone(entry.ref), agg: row.querySelector('.oabCubeValueAgg').value || 'SUM' };
      }).filter(Boolean);
      next.display = { ...(next.display || {}), grouped: modal.querySelector('#oabCubeGroupedInput').checked, showSubtotals: modal.querySelector('#oabCubeSubtotalsInput').checked, collapsedGroups: [] };
      if (!next.rows.length && !next.columns.length) { setStatus(() => text('En az bir satır veya sütun alanı seçin.', 'Select at least one row or column field.'), 'warning'); return; }
      state.view = next;
      close();
      const saved = await saveView({ immediate: true });
      render();
      if (saved && state.loaded && (queryShape(saved) !== before || staleReason())) void refresh(false);
      else setStatus(() => text('Pivot ayarları kaydedildi.', 'Pivot settings saved.'), 'ok');
    });
    modal.querySelector('[data-oab-cube-settings-reset]').addEventListener('click', async () => {
      const keep = view().filterValues;
      state.view = { ...clone(state.catalog.defaults), filterValues: Object.fromEntries(Object.entries(keep || {}).filter(([key]) => state.catalog.defaults.filters.some(ref => ref.key === key))) };
      close();
      await saveView({ immediate: true });
      render();
      setStatus(() => text('Pivot varsayılan düzenine döndü.', 'Pivot reset to defaults.'), 'ok');
    });
    dialog.querySelector('select,button')?.focus();
  }

  /* ---------- Filtre paneli, değer seçici, alan ekleme ---------- */
  function setFilterPanelOpen(open) {
    const panel = byId('oabCubeFilterPanel'), button = byId('oabCubeFiltersBtn');
    if (!panel || !button) return;
    panel.hidden = !open;
    button.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (open) {
      const rect = button.getBoundingClientRect();
      panel.style.top = `${Math.max(16, Math.min(rect.bottom + 6, innerHeight - panel.offsetHeight - 16))}px`;
      panel.style.right = `${Math.max(16, Math.min(innerWidth - rect.right, innerWidth - panel.offsetWidth - 16))}px`;
      window.BLMotionPlus?.play?.('overlay', panel);
    }
  }
  function closePopover() {
    if (!state.popover) return;
    state.popover.remove();
    state.popover = null;
    section.querySelectorAll('[data-oab-cube-filter][aria-expanded="true"],[data-oab-cube-add-filter][aria-expanded="true"]').forEach(button => button.setAttribute('aria-expanded', 'false'));
  }
  /* Değerler yüklenince popover büyür; yeniden konumlandırma yalnız konumu
     düzeltir, giriş hareketini tekrarlamaz (ekran dışına taşmayı önler). */
  function placePopover(popover, button, animate = true) {
    const rect = button.getBoundingClientRect();
    popover.style.left = `${Math.max(8, Math.min(innerWidth - popover.offsetWidth - 8, rect.left))}px`;
    popover.style.top = `${Math.max(8, Math.min(innerHeight - popover.offsetHeight - 8, rect.bottom + 4))}px`;
    if (animate) window.BLMotionPlus?.play?.('overlay', popover);
  }
  function localValues(key) {
    return [...new Set(state.rows.map(row => clean(row && row[key])).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'tr', { numeric: true }));
  }
  function openFilter(button, key) {
    closePopover();
    const ref = view().filters.find(entry => entry.key === key);
    if (!ref) return;
    const selected = new Set(view().filterValues[key] || []);
    let values = [...new Set([...localValues(key), ...selected])];
    const popover = document.createElement('div');
    popover.className = 'oabLocalFilterAddPopover intakeFilterPopover';
    popover.setAttribute('role', 'dialog');
    popover.setAttribute('aria-label', refLabel(ref));
    popover.innerHTML = `<div class="intakeFilterPopoverTitle">${esc(refLabel(ref))}</div><input type="search" class="intakeFilterSearch" placeholder="${esc(text('Değerlerde ara…', 'Search values…'))}" aria-label="${esc(text('Değerlerde ara', 'Search values'))}"><div class="intakeFilterValues"><div class="intakeConfigEmpty">${esc(text('Değerler yükleniyor…', 'Loading values…'))}</div></div><div class="intakeFilterActions"><button type="button" class="tbtn" data-oab-cube-clear>${esc(text('Temizle', 'Clear'))}</button><button type="button" class="tbtn primary" data-oab-cube-apply>${esc(text('Uygula', 'Apply'))}</button></div>`;
    document.body.appendChild(popover);
    state.popover = popover;
    button.setAttribute('aria-expanded', 'true');
    placePopover(popover, button);
    const list = popover.querySelector('.intakeFilterValues'), search = popover.querySelector('.intakeFilterSearch');
    const draw = () => {
      const needle = clean(search.value).toLocaleLowerCase(locale());
      const visible = values.filter(value => !needle || value.toLocaleLowerCase(locale()).includes(needle)).sort((a, b) => Number(selected.has(b)) - Number(selected.has(a)));
      list.innerHTML = visible.length
        ? visible.map(value => `<label class="intakeFilterOption"><input type="checkbox" value="${esc(value)}"${selected.has(value) ? ' checked' : ''}><span>${esc(value)}</span></label>`).join('')
        : `<div class="intakeConfigEmpty">${esc(text('Eşleşen değer yok.', 'No matching value.'))}</div>`;
    };
    search.addEventListener('input', draw);
    popover.addEventListener('change', event => { if (event.target.matches('input[type="checkbox"]')) { event.target.checked ? selected.add(event.target.value) : selected.delete(event.target.value); } });
    popover.querySelector('[data-oab-cube-clear]').addEventListener('click', () => { selected.clear(); draw(); });
    popover.querySelector('[data-oab-cube-apply]').addEventListener('click', () => {
      const next = { ...view().filterValues };
      if (selected.size) next[key] = [...selected].slice(0, 500); else delete next[key];
      state.view = { ...view(), filterValues: next };
      closePopover();
      void saveView();
      render();
      setStatus(() => text('Filtre değişti. Veriyi çekmek için Yenile’ye basın.', 'Filters changed. Press Refresh to query data.'), 'ok');
    });
    search.focus();
    /* İlk liste en fazla 1.000 değerdir (ör. model kodu bundan fazla olabilir);
       yazılan arama küpte de aranır. Yanıtlar birleşir, hiçbir değer kaybolmaz;
       geç gelen eski arama yanıtı yenisinin üzerine yazmaz. */
    const local = localValues(key);
    let requestSeq = 0, searchTimer = 0;
    const note = document.createElement('div');
    note.className = 'intakeConfigEmpty oabCubeDistinctNote';
    note.hidden = true;
    list.after(note);
    /* Kesilme durumu aramaya göre tutulur: dar bir arama tam dönse bile arama
       silinince ilk (kesik) listenin uyarısı geri gelir. */
    const truncation = new Map();
    const showNote = needle => {
      const info = truncation.get(needle);
      note.hidden = !(info && info.truncated);
      note.textContent = note.hidden ? '' : text(`İlk ${info.limit.toLocaleString(locale())} değer gösteriliyor; aramayı daraltın.`, `Showing the first ${info.limit.toLocaleString(locale())} values; narrow the search.`);
    };
    const fetchValues = needle => {
      const seq = ++requestSeq;
      return requestJson('/api/oab-cube/distinct', jsonBody('POST', { key, source: ref.source || '', search: needle, limit: 1000 }))
        .then(result => {
          if (state.popover !== popover) return;
          values = [...new Set([...values, ...(Array.isArray(result.values) ? result.values : []), ...local, ...selected])];
          truncation.set(needle, { truncated: Boolean(result.truncated), limit: Number(result.limit) || 1000 });
          if (seq !== requestSeq) return;
          showNote(needle);
          draw(); placePopover(popover, button, false);
        })
        .catch(error => {
          if (state.popover !== popover || seq !== requestSeq) return;
          if (values.length) { draw(); placePopover(popover, button, false); return; }
          list.innerHTML = `<div class="intakeConfigEmpty">${esc(error.message || text('Değerler alınamadı.', 'Values could not be loaded.'))}</div>`;
        });
    };
    search.addEventListener('input', () => {
      clearTimeout(searchTimer);
      const needle = clean(search.value);
      if (needle) searchTimer = setTimeout(() => void fetchValues(needle), 300);
      else { requestSeq += 1; showNote(''); }
    });
    void fetchValues('');
  }
  async function openFilterFieldPicker(button) {
    closePopover();
    await loadMetadata();
    const used = new Set(view().filters.map(ref => ref.source || ref.key));
    const fields = dimensionPool().filter(entry => !used.has(entry.ref.source || entry.ref.key));
    const popover = document.createElement('div');
    popover.className = 'oabLocalFilterAddPopover intakeFilterPopover intakeFilterFieldPicker';
    popover.setAttribute('role', 'dialog');
    popover.setAttribute('aria-label', text('Filtre alanı ekle', 'Add filter field'));
    popover.innerHTML = `<div class="intakeFilterPopoverTitle">${esc(text('Küp alanından filtre ekle', 'Add filter from cube fields'))}</div><input type="search" class="intakeFilterSearch" placeholder="${esc(text('Alanlarda ara…', 'Search fields…'))}" aria-label="${esc(text('Alanlarda ara', 'Search fields'))}"><div class="intakeFilterValues"></div>`;
    document.body.appendChild(popover);
    state.popover = popover;
    button.setAttribute('aria-expanded', 'true');
    placePopover(popover, button);
    const list = popover.querySelector('.intakeFilterValues'), search = popover.querySelector('.intakeFilterSearch');
    const draw = () => {
      const needle = clean(search.value).toLocaleLowerCase(locale());
      const visible = fields.filter(entry => !needle || entry.label.toLocaleLowerCase(locale()).includes(needle));
      list.innerHTML = visible.length
        ? visible.slice(0, 400).map(entry => `<button type="button" class="intakeFilterFieldOption" data-oab-cube-add-filter-id="${esc(entry.id)}"><span>${esc(entry.label)}</span><small>${esc(entry.ref.source || entry.group)}</small></button>`).join('')
        : `<div class="intakeConfigEmpty">${esc(text('Eşleşen alan yok.', 'No matching field.'))}</div>`;
    };
    draw();
    search.addEventListener('input', draw);
    popover.addEventListener('click', async event => {
      const option = event.target.closest('[data-oab-cube-add-filter-id]');
      if (!option) return;
      const entry = fields.find(item => item.id === option.dataset.oabCubeAddFilterId);
      if (!entry) return;
      closePopover();
      state.view = { ...view(), filters: [...view().filters, clone(entry.ref)] };
      await saveView({ immediate: true });
      render();
      const added = view().filters[view().filters.length - 1];
      const trigger = added && byId('oabCubeFilterBar')?.querySelector(`[data-oab-cube-filter="${CSS.escape(added.key)}"]`);
      if (trigger) openFilter(trigger, added.key);
    });
    search.focus();
  }

  /* ---------- Olaylar ---------- */
  function setCollapsed(keys) {
    state.view = { ...view(), display: { ...display(), collapsedGroups: keys } };
    const table = byId('oabCubeTable');
    if (window.BLMotionPlus?.pivotChange && table) window.BLMotionPlus.pivotChange(table, renderBody); else renderBody();
    void saveView({ silent: true });
  }
  function bind() {
    new MutationObserver(render).observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });
    byId('oabCubeRefreshBtn')?.addEventListener('click', () => void refresh(true));
    byId('oabCubeFieldsBtn')?.addEventListener('click', () => void openFields());
    byId('oabCubeExcelExportBtn')?.addEventListener('click', () => void exportExcel());
    byId('oabCubeResetBtn')?.addEventListener('click', async () => {
      state.view = clone(state.catalog.defaults);
      state.search = '';
      await saveView({ immediate: true });
      render();
      setStatus(() => text('Varsayılan görünüm geri yüklendi.', 'Default view restored.'), 'ok');
    });
    byId('oabCubeFiltersBtn')?.addEventListener('click', event => {
      event.stopPropagation();
      const panel = byId('oabCubeFilterPanel');
      setFilterPanelOpen(Boolean(panel && panel.hidden));
    });
    byId('oabCubeCollapseAllBtn')?.addEventListener('click', () => setCollapsed(groupPathKeys(visibleRows())));
    byId('oabCubeExpandAllBtn')?.addEventListener('click', () => setCollapsed([]));
    let searchTimer = 0;
    byId('oabCubeSearch')?.addEventListener('input', event => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => { state.search = clean(event.target.value).slice(0, 200); renderBody(); }, 150);
    });
    byId('oabCubeFilterBar')?.addEventListener('click', event => {
      const add = event.target.closest('[data-oab-cube-add-filter]');
      if (add) { void openFilterFieldPicker(add); return; }
      const remove = event.target.closest('[data-oab-cube-filter-remove]');
      if (remove) {
        const key = remove.dataset.oabCubeFilterRemove;
        const next = { ...view().filterValues };
        delete next[key];
        state.view = { ...view(), filterValues: next, filters: view().filters.filter(ref => ref.key !== key) };
        void saveView();
        render();
        return;
      }
      const trigger = event.target.closest('[data-oab-cube-filter]');
      if (trigger) openFilter(trigger, trigger.dataset.oabCubeFilter);
    });
    byId('oabCubeTable')?.addEventListener('dblclick', event => {
      if (event.target.closest('[data-oab-cube-group-key],thead')) return;
      const cell = event.target.closest('td'), row = cell && cell.closest('tr[data-oab-cube-row]');
      if (!row) return;
      event.preventDefault();
      const item = (state.displayItems || [])[Number(row.dataset.oabCubeRow)];
      const dims = [...view().rows, ...view().columns];
      let column = 0;
      for (const td of row.cells) { if (td === cell) break; column += td.colSpan || 1; }
      const ref = column >= dims.length ? view().values[column - dims.length] : null;
      if (item) openDetail(item, ref);
    });
    byId('oabCubeTable')?.addEventListener('click', event => {
      const toggle = event.target.closest('[data-oab-cube-group-key]');
      if (toggle) {
        const collapsed = new Set(display().collapsedGroups || []);
        const key = toggle.dataset.oabCubeGroupKey;
        collapsed.has(key) ? collapsed.delete(key) : collapsed.add(key);
        setCollapsed([...collapsed]);
        return;
      }
      const header = event.target.closest('[data-oab-cube-sort]');
      if (!header || event.detail > 1) return;
      const key = header.dataset.oabCubeSort;
      const current = display().sort || {};
      const isDim = [...view().rows, ...view().columns].some(ref => ref.key === key);
      state.view = { ...view(), display: { ...display(), sort: { key, dir: current.key === key ? -Number(current.dir || -1) : (isDim ? 1 : -1) } } };
      void saveView({ silent: true });
      renderBody();
    });
    document.addEventListener('click', event => {
      if (state.popover && !state.popover.contains(event.target) && !event.target.closest('[data-oab-cube-filter],[data-oab-cube-add-filter]')) closePopover();
      const panel = byId('oabCubeFilterPanel');
      if (panel && !panel.hidden && !panel.contains(event.target) && !event.target.closest('#oabCubeFiltersBtn,#oabCubeRefreshBtn,.intakeFilterPopover')) setFilterPanelOpen(false);
    });
    document.addEventListener('keydown', event => {
      if (event.key !== 'Escape') return;
      if (state.popover) { closePopover(); return; }
      setFilterPanelOpen(false);
    });
  }

  /* Widget sayfada görünene kadar sunucuya gidilmez (perf-runtime lazy sözleşmesi). */
  function startWhenVisible() {
    const start = () => { if (state.started) return; state.started = true; void loadState(); };
    if (typeof IntersectionObserver !== 'function') { start(); return; }
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) { observer.disconnect(); start(); }
    });
    observer.observe(section);
  }

  bind();
  render();
  startWhenVisible();
  window.BLOabCube = Object.freeze({ state, refresh: () => refresh(true), reload: loadState, openFields });
})();
