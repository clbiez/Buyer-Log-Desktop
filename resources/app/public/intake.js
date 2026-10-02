(function () {
  'use strict';

  /* INTAKE UI: the data contract is deliberately small.  Source identities
     come from the server and the browser only owns view state (order, label,
     widths, sort and selected filter values). */
  const section = document.getElementById('intakeSection');
  if (!section) return;

  const state = {
    fields: [],
    viewConfig: { version: 3, query: { rows: [], columns: [], measures: [], filters: [], filterValues: {} }, display: { labels: {}, widths: {}, sort: { id: '', dir: 1 }, collapsed: [], grouped: true, showSubtotals: true, collapsedGroups: [], hideZeroCurrentBudget: true } },
    rows: [],
    loaded: false,
    loading: false,
    metadataLoading: false,
    metadataPromise: null,
    offline: false,
    error: '',
    popover: null,
    drag: null,
    fetchedAt: '',
    /* Yarış koruması: her yerel görünüm değişikliği revizyonu artırır. Sunucu
       yanıtı yalnız gönderildiği revizyon hâlâ güncelse görünümün üzerine
       yazılır; aksi hâlde kullanıcının o arada yaptığı değişiklik geri alınırdı. */
    viewRevision: 0,
    rowsVersion: 0,
    tableSignature: '',
    refreshPromise: null,
    refreshQueued: null,
    saveInFlight: null,
    savePending: false,
  };

  const byId = id => document.getElementById(id);
  const isEnglish = () => typeof appLang !== 'undefined' && appLang === 'en';
  const text = (tr, en) => isEnglish() ? en : tr;
  const clean = value => String(value == null ? '' : value).trim();
  const esc = value => clean(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));
  const query = () => state.viewConfig && state.viewConfig.query || { rows: [], columns: [], measures: [], filters: [], filterValues: {} };
  const display = () => state.viewConfig && state.viewConfig.display || { labels: {}, widths: {}, sort: { id: '', dir: 1 }, grouped: true, showSubtotals: true, collapsedGroups: [], hideZeroCurrentBudget: true };
  const fieldLabel = field => clean(display().labels && display().labels[field.id]) || clean(field.defaultLabel || field.name);
  const fieldId = field => clean(field && field.id);
  const configuredFields = () => [...query().rows, ...query().columns, ...query().measures, ...query().filters];
  const allFields = () => {
    const map = new Map();
    [...state.fields, ...configuredFields()].forEach(field => { if (field && field.id) map.set(field.id, field); });
    return [...map.values()];
  };
  const dimensionFields = () => allFields().filter(field => field.fieldType !== 'measure');
  const measureFields = () => allFields().filter(field => field.fieldType === 'measure');
  const axisNames = { rows: 'Satırlar', columns: 'Sütunlar', measures: 'Ölçüler', filters: 'Filtreler' };
  const axisNamesEn = { rows: 'Rows', columns: 'Columns', measures: 'Measures', filters: 'Filters' };

  function setStatus(message, kind) {
    const node = byId('intakeStatus');
    if (!node) return;
    node.hidden = !message;
    node.className = `intakeStatus${kind ? ` ${kind}` : ''}`;
    node.textContent = message || '';
  }

  function setMeta(value) {
    const node = byId('intakeStateMeta');
    if (!node) return;
    node.textContent = value || '';
  }

  async function requestJson(url, options) {
    const response = await fetch(url, { credentials: 'same-origin', cache: 'no-store', ...(options || {}) });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || response.statusText || text('İstek başarısız.', 'Request failed.'));
    return payload;
  }

  function activeColumns() {
    const seen = new Set();
    return [...query().rows, ...query().columns, ...query().measures]
      .filter(field => field && field.id && !seen.has(field.id) && seen.add(field.id));
  }

  /* Veriyi değiştiren görünüm parçasının imzası. Etiket, genişlik, sıralama ve
     özetleme (agg) istemcide uygulanır; bunlar değişince sorgu tekrarlanmaz.
     Değeri seçilmemiş filtre alanı da DAX'a girmez. */
  function intakeQuerySignature(config) {
    const source = config && config.query || {};
    const ids = list => (Array.isArray(list) ? list : []).map(field => clean(field && field.id)).filter(Boolean);
    const values = {};
    Object.keys(source.filterValues || {}).sort().forEach(id => {
      const list = Array.isArray(source.filterValues[id]) ? source.filterValues[id].map(clean).filter(Boolean) : [];
      if (list.length) values[id] = [...new Set(list)].sort();
    });
    return JSON.stringify({
      rows: ids(source.rows), columns: ids(source.columns), measures: ids(source.measures).sort(), values,
      weights: intakeWeightSignature(source.measures),
      hideZero: (config && config.display || {}).hideZeroCurrentBudget !== false,
    });
  }

  /* WAVG ağırlığı sorguya ek measure olarak girer; ağırlık seçimi değişince
     veri yeniden çekilmelidir. Diğer özetlemeler istemcide uygulanır. */
  function intakeWeightSignature(measures) {
    return (Array.isArray(measures) ? measures : [])
      .filter(field => field && clean(field.agg).toUpperCase() === 'WAVG' && clean(field.weightSource))
      .map(field => `${clean(field.id)}:${clean(field.weightSource)}`).sort();
  }

  function setRows(rows) {
    state.rows = Array.isArray(rows) ? rows : [];
    state.rowsVersion += 1;
  }

  function sameValues(left, right) {
    const a = Array.isArray(left) ? left.map(clean).filter(Boolean).sort() : [];
    const b = Array.isArray(right) ? right.map(clean).filter(Boolean).sort() : [];
    return a.length === b.length && a.every((value, index) => value === b[index]);
  }

  function numberText(value) {
    if (value === null || value === undefined || value === '') return '';
    const numeric = typeof value === 'number' ? value : Number(String(value).replace(/\s/g, '').replace(',', '.'));
    if (!Number.isFinite(numeric)) return String(value);
    return numeric.toLocaleString(isEnglish() ? 'en-GB' : 'tr-TR', { maximumFractionDigits: 2 });
  }

  const INTAKE_MONTH_ORDER = Object.freeze([
    'ocak', 'şubat', 'mart', 'nisan', 'mayıs', 'haziran', // i18n-ignore — kaynak alan/ay adı eşleştirmesi (veri)
    'temmuz', 'ağustos', 'eylül', 'ekim', 'kasım', 'aralık', // i18n-ignore — kaynak alan/ay adı eşleştirmesi (veri)
  ]);

  function intakeIsPeriodField(field) {
    const identity = `${clean(field && field.sourceUniqueName)} ${clean(field && field.defaultLabel)} ${clean(field && field.name)}`
      .toLocaleLowerCase('tr-TR');
    return identity.includes('dönem tanim') || identity.includes('dönem tanım') // i18n-ignore — kaynak alan/ay adı eşleştirmesi (veri)
      || (identity.includes('[phase]') && identity.includes('dönem')); // i18n-ignore — kaynak alan/ay adı eşleştirmesi (veri)
  }

  function intakeMonthRank(value) {
    const normalized = clean(value).toLocaleLowerCase('tr-TR');
    return INTAKE_MONTH_ORDER.findIndex(month => normalized.includes(month));
  }

  function intakeCompareValues(field, left, right) {
    if (intakeIsPeriodField(field)) {
      const leftMonth = intakeMonthRank(left);
      const rightMonth = intakeMonthRank(right);
      if (leftMonth >= 0 && rightMonth >= 0 && leftMonth !== rightMonth) return leftMonth - rightMonth;
      if (leftMonth >= 0 && rightMonth < 0) return -1;
      if (leftMonth < 0 && rightMonth >= 0) return 1;
    }
    return clean(left).localeCompare(clean(right), isEnglish() ? 'en' : 'tr', { numeric: true, sensitivity: 'base' });
  }

  function intakeIsCurrentBudgetField(field) {
    if (!field || field.fieldType !== 'measure') return false;
    const wanted = 'güncel alım bütçe'; // i18n-ignore — kaynak alan/ay adı eşleştirmesi (veri)
    return [field.name, field.sourceLabel, field.defaultLabel]
      .map(value => clean(value).toLocaleLowerCase('tr-TR'))
      .some(value => value === wanted);
  }

  function intakeIsNonZeroBudgetRow(row, field) {
    if (!field) return true;
    const value = row && row[field.id];
    if (value === null || value === undefined || value === '') return false;
    const numeric = typeof value === 'number'
      ? value
      : Number(String(value).replace(/\s/g, '').replace(',', '.'));
    return !Number.isFinite(numeric) || numeric !== 0;
  }

  function valuesFromRows(field) {
    return [...new Set(state.rows.map(row => clean(row && row[field.id])).filter(Boolean))]
      .sort((a, b) => intakeCompareValues(field, a, b));
  }

  function renderFilters() {
    const bar = byId('intakeFilterBar');
    if (!bar) return;
    const filters = query().filters;
    const filterFields = filters.map(field => {
      const selected = Array.isArray(query().filterValues && query().filterValues[field.id]) ? query().filterValues[field.id] : [];
      const label = selected.length > 1 ? `${selected.length} ${text('seçim', 'selected')}` : (selected[0] || text('Tümü', 'All'));
      return `<div class="intakeFilterField"><span class="intakeFilterLabel">${esc(fieldLabel(field))}</span><div class="intakeFilterControl"><button type="button" class="oabMultiTrigger intakeFilterTrigger" data-intake-filter="${esc(field.id)}" aria-haspopup="listbox" aria-expanded="false"><span class="oabMultiLabel${selected.length ? ' hasValue' : ''}">${esc(label)}</span><span class="oabMultiChevron" aria-hidden="true">▾</span></button><button type="button" class="intakeFilterRemove" data-intake-filter-remove="${esc(field.id)}" title="${esc(text('Filtreyi kaldır', 'Remove filter'))}" aria-label="${esc(text('Filtreyi kaldır', 'Remove filter'))}">×</button></div></div>`;
    }).join('');
    const available = availableFor('filters', state.viewConfig).length;
    bar.innerHTML = `${filterFields}<button type="button" class="navActionBtn intakeFilterAdd" data-intake-add-filter${available ? '' : ' disabled'}>+ ${esc(text('Filtre ekle', 'Add filter'))}</button>`;
    const filterButton = byId('intakeFiltersBtn');
    if (filterButton) {
      const active = filters.some(field => Array.isArray(query().filterValues && query().filterValues[field.id]) && query().filterValues[field.id].length > 0);
      filterButton.classList.toggle('hasActiveFilters', active);
    }
  }

  const INTAKE_AGGREGATES = ['SUM', 'AVG', 'WAVG', 'COUNT', 'MIN', 'MAX', 'FIRST'];
  const INTAKE_AGG_LABELS = { WAVG: ['Ağırlıklı ort.', 'Weighted avg.'] };
  const INTAKE_DEFAULT_WEIGHT_SOURCE = '[Measures].[Güncel Alım Bütçe]'; // i18n-ignore — kaynak alan/ay adı eşleştirmesi (veri)
  const intakeNumber = value => typeof value === 'number' ? value : Number(String(value == null ? '' : value).replace(/\s/g, '').replace(',', '.'));
  const intakeSourceKey = value => clean(value).toLocaleLowerCase('tr-TR').replace(/\s+/g, ' ');

  /* Ağırlık sütunu: görünümde aynı measure varsa onun sütunu, yoksa sunucunun
     eklediği gizli ağırlık sütunu (weightId). */
  function intakeWeightId(field) {
    const key = intakeSourceKey(field && field.weightSource);
    if (!key) return '';
    const present = (query().measures || []).find(item => item && intakeSourceKey(item.sourceUniqueName) === key);
    return present ? present.id : clean(field.weightId);
  }

  function intakeAggregateRows(rows, field) {
    const source = Array.isArray(rows) ? rows : [];
    const values = source.map(row => row && row[field.id]).filter(value => value !== null && value !== undefined && value !== '');
    const agg = INTAKE_AGGREGATES.includes(clean(field && field.agg).toUpperCase()) ? clean(field.agg).toUpperCase() : 'SUM';
    if (agg === 'FIRST') return values.length ? values[0] : '';
    if (agg === 'COUNT') return values.length;
    if (agg === 'WAVG') {
      /* Oran alt toplamı: Σ(oran × ağırlık) / Σ ağırlık. Oran = pay / ağırlık
         olduğunda bu, alt toplam payının alt toplam paydasına oranına eşittir. */
      const weightId = intakeWeightId(field);
      let weighted = 0, weightSum = 0;
      if (weightId) source.forEach(row => {
        const value = intakeNumber(row && row[field.id]);
        const weight = intakeNumber(row && row[weightId]);
        if (!Number.isFinite(value) || !Number.isFinite(weight)) return;
        weighted += value * weight;
        weightSum += weight;
      });
      if (weightSum) return weighted / weightSum;
    }
    const numbers = values.map(intakeNumber).filter(Number.isFinite);
    if (!numbers.length) return values.length ? values[0] : '';
    if (agg === 'AVG' || agg === 'WAVG') return numbers.reduce((sum, value) => sum + value, 0) / numbers.length;
    if (agg === 'MIN') return Math.min(...numbers);
    if (agg === 'MAX') return Math.max(...numbers);
    return numbers.reduce((sum, value) => sum + value, 0);
  }

  function intakeGroupKey(path) {
    return JSON.stringify((Array.isArray(path) ? path : []).map(value => clean(value)));
  }

  function intakeGroupPathKeys(rows) {
    const rowFields = query().rows || [];
    const columnFields = query().columns || [];
    if (display().grouped === false || !rowFields.length) return [];
    const keys = [];
    const walk = (sourceRows, level, path) => {
      if (level >= rowFields.length) return;
      const field = rowFields[level];
      const groups = new Map();
      sourceRows.forEach(row => {
        const value = row && row[field.id] != null ? row[field.id] : '';
        const key = clean(value);
        if (!groups.has(key)) groups.set(key, { value, rows: [] });
        groups.get(key).rows.push(row);
      });
      groups.forEach(group => {
        const isLeafLevel = level === rowFields.length - 1 && columnFields.length === 0;
        if (isLeafLevel) return;
        const nextPath = [...path, group.value];
        keys.push(intakeGroupKey(nextPath));
        walk(group.rows, level + 1, nextPath);
      });
    };
    walk(Array.isArray(rows) ? rows : [], 0, []);
    return [...new Set(keys)];
  }

  function intakeUpdateGroupButtons(rows) {
    const expand = byId('intakeExpandAllBtn');
    const collapse = byId('intakeCollapseAllBtn');
    const keys = intakeGroupPathKeys(rows);
    const enabled = keys.length > 0;
    const collapsed = new Set(Array.isArray(display().collapsedGroups) ? display().collapsedGroups : []);
    if (expand) { expand.hidden = !enabled; expand.disabled = !enabled || collapsed.size === 0; }
    if (collapse) { collapse.hidden = !enabled; collapse.disabled = !enabled; }
  }

  function intakeExpandAllGroups() {
    const next = clone(state.viewConfig);
    next.display = { ...(next.display || {}), collapsedGroups: [] };
    state.viewConfig = next;
    renderTable();
  }

  function intakeCollapseAllGroups() {
    const next = clone(state.viewConfig);
    next.display = { ...(next.display || {}), collapsedGroups: intakeGroupPathKeys(state.rows) };
    state.viewConfig = next;
    renderTable();
  }

  function intakeDisplayRows(sorted) {
    const rowFields = query().rows || [];
    const columnFields = query().columns || [];
    const measureFields = query().measures || [];
    const grouped = display().grouped !== false && rowFields.length > 0;
    if (!grouped) return sorted.map(row => ({ kind: 'leaf', row, level: rowFields.length }));
    const showSubtotals = display().showSubtotals !== false;
    const collapsed = new Set(Array.isArray(display().collapsedGroups) ? display().collapsedGroups : []);
    const output = [];

    const walk = (sourceRows, level, path) => {
      if (level >= rowFields.length) {
        sourceRows.forEach(row => output.push({ kind: 'leaf', row, level }));
        return;
      }
      const field = rowFields[level];
      const groups = new Map();
      sourceRows.forEach(row => {
        const value = row && row[field.id] != null ? row[field.id] : '';
        const key = clean(value);
        if (!groups.has(key)) groups.set(key, { value, rows: [] });
        groups.get(key).rows.push(row);
      });
      const orderedGroups = [...groups.values()];
      if (intakeIsPeriodField(field)) {
        const direction = display().sort?.id === field.id && Number(display().sort?.dir) === -1 ? -1 : 1;
        orderedGroups.sort((left, right) => intakeCompareValues(field, left.value, right.value) * direction);
      }
      orderedGroups.forEach(group => {
        const isLeafLevel = level === rowFields.length - 1 && columnFields.length === 0;
        if (isLeafLevel) {
          const leaf = { ...(group.rows[0] || {}) };
          leaf[field.id] = group.value;
          measureFields.forEach(item => { leaf[item.id] = intakeAggregateRows(group.rows, item); });
          output.push({ kind: 'leaf', row: leaf, level });
          return;
        }

        const nextPath = [...path, group.value];
        const pathKey = intakeGroupKey(nextPath);
        const aggregateRow = {};
        rowFields.forEach(item => { aggregateRow[item.id] = ''; });
        columnFields.forEach(item => { aggregateRow[item.id] = ''; });
        aggregateRow[field.id] = group.value;
        if (showSubtotals) measureFields.forEach(item => { aggregateRow[item.id] = intakeAggregateRows(group.rows, item); });
        const isCollapsed = collapsed.has(pathKey);
        output.push({ kind: 'group', row: aggregateRow, level, pathKey, collapsed: isCollapsed, subtotal: showSubtotals });
        if (!isCollapsed) walk(group.rows, level + 1, nextPath);
      });
    };

    walk(sorted, 0, []);
    if (showSubtotals && sorted.length) {
      const grand = {};
      rowFields.forEach(item => { grand[item.id] = ''; });
      columnFields.forEach(item => { grand[item.id] = ''; });
      if (rowFields[0]) grand[rowFields[0].id] = text('Genel Toplam', 'Grand Total');
      measureFields.forEach(item => { grand[item.id] = intakeAggregateRows(sorted, item); });
      output.push({ kind: 'grand', row: grand, level: 0 });
    }
    return output;
  }

  function intakeCellHtml(item, field) {
    const row = item.row || {};
    const value = row[field.id];
    if (item.kind === 'group' && field.fieldType !== 'measure') {
      const rowIndex = (query().rows || []).findIndex(candidate => candidate.id === field.id);
      if (rowIndex === item.level) {
        const label = value == null || value === '' ? text('(boş)', '(blank)') : value;
        return `<td class="oabPivotGroupCell" style="padding-left:${Math.max(4, item.level * 14 + 4)}px"><button type="button" class="oabPivotGroupToggle" data-intake-group-key="${esc(item.pathKey)}" title="${esc(item.collapsed ? text('Grubu genişlet', 'Expand group') : text('Grubu daralt', 'Collapse group'))}">${item.collapsed ? '▸' : '▾'}</button><strong>${esc(label)}</strong>${item.subtotal ? `<span class="oabPivotSubtotalTag">${esc(text('Alt toplam', 'Subtotal'))}</span>` : ''}</td>`;
      }
      return '<td></td>';
    }
    if (item.kind === 'grand' && field.fieldType !== 'measure') {
      const firstRowId = (query().rows || [])[0]?.id || '';
      return `<td class="${field.id === firstRowId ? 'oabPivotGrandLabel' : ''}">${field.id === firstRowId ? `<strong>${esc(value)}</strong>` : ''}</td>`;
    }
    return `<td class="${field.fieldType === 'measure' ? 'num' : ''}">${esc(field.fieldType === 'measure' ? numberText(value) : clean(value))}</td>`;
  }

  /* Tablo yalnız gösterdiği veri veya düzen değişince yeniden çizilir. Filtre
     seçimi, kayıt yanıtı ve yükleme durumu gibi tabloya dokunmayan olaylar
     binlerce satırlık tabloyu baştan kurmaz. */
  function intakeTableSignature() {
    const current = display();
    return JSON.stringify([
      state.rowsVersion, isEnglish(),
      activeColumns().map(field => [field.id, fieldLabel(field), field.fieldType, clean(field.agg), clean(field.weightSource)]),
      (query().rows || []).map(fieldId), (query().columns || []).map(fieldId),
      current.sort || {}, current.grouped !== false, current.showSubtotals !== false,
      current.collapsedGroups || [], current.hideZeroCurrentBudget !== false,
    ]);
  }

  function renderTable(options = {}) {
    const body = byId('intakeBody');
    const table = byId('intakeTable');
    if (!body || !table) return;
    body.hidden = false;
    const signature = intakeTableSignature();
    if (!options.force && signature === state.tableSignature && table.firstChild) return;
    state.tableSignature = signature;
    const fields = activeColumns();
    if (!fields.length) {
      intakeUpdateGroupButtons([]);
      table.innerHTML = `<tbody><tr><td class="intakeEmpty" colspan="1">${esc(text('Alan seçilmedi.', 'No fields selected.'))}</td></tr></tbody>`;
      return;
    }
    const currentBudgetField = (query().measures || []).find(intakeIsCurrentBudgetField);
    const sorted = (display().hideZeroCurrentBudget !== false && currentBudgetField
      ? state.rows.filter(row => intakeIsNonZeroBudgetRow(row, currentBudgetField))
      : state.rows
    ).slice();
    const sort = display().sort || {};
    if (sort.id) {
      const direction = Number(sort.dir) === -1 ? -1 : 1;
      const sortField = fields.find(field => field.id === sort.id) || allFields().find(field => field.id === sort.id);
      sorted.sort((left, right) => intakeCompareValues(sortField, left && left[sort.id], right && right[sort.id]) * direction);
    }
    intakeUpdateGroupButtons(sorted);
    const header = fields.map(field => {
      const direction = sort.id === field.id ? (sort.dir === -1 ? ' ↓' : ' ↑') : '';
      return `<th data-intake-sort="${esc(field.id)}" data-intake-rename="${esc(field.id)}" title="${esc(text('Sıralamak için tıklayın · yeniden adlandırmak için çift tıklayın', 'Click to sort · double-click to rename'))}">${esc(fieldLabel(field))}${direction}</th>`;
    }).join('');
    const viewRows = intakeDisplayRows(sorted);
    const rows = viewRows.map(item => {
      const cls = item.kind === 'grand' ? 'oabPivotGrandTotalRow' : (item.kind === 'group' ? (item.subtotal ? 'oabPivotSubtotalRow' : 'oabPivotGroupRow') : '');
      return `<tr class="${cls}">${fields.map(field => intakeCellHtml(item, field)).join('')}</tr>`;
    }).join('');
    table.innerHTML = `<thead><tr>${header}</tr></thead><tbody>${rows || `<tr><td class="intakeEmpty" colspan="${fields.length}">${esc(text('Veri yok.', 'No data.'))}</td></tr>`}</tbody>`;
    attachColumnResize(table, fields);
  }

  /* Sütun genişliği: minimum ALT HÜCRE içeriğine göre belirlenir; uzun başlık
     sütunu geniş tutmaz, daraltılınca satır kırar. */
  function columnType(field) {
    if (field.fieldType === 'measure') return 'num';
    const name = `${clean(field.sourceUniqueName)} ${clean(field.defaultLabel || field.name)}`;
    if (/tarih|date/i.test(name)) return 'date';
    if (/kod|code|\bref\b/i.test(name)) return 'code';
    return 'text';
  }

  let widthSaveTimer = 0;
  /* Genişlikler mevcut viewConfig.display.widths sözleşmesinde saklanır. Kayıt
     sessizdir: saveView() gibi durum mesajı basmaz ve tabloyu yeniden çizmez,
     aksi hâlde sürükleme sonrası tablo altınızdan yenilenir. */
  function persistWidths() {
    clearTimeout(widthSaveTimer);
    widthSaveTimer = setTimeout(() => { void persistView({ silent: true }); }, 600);
  }

  const widthStore = {
    get: id => { const px = Number(display().widths && display().widths[id]); return Number.isFinite(px) ? px : null; },
    set: (id, px) => {
      const target = state.viewConfig.display || (state.viewConfig.display = {});
      if (!target.widths || typeof target.widths !== 'object') target.widths = {};
      target.widths[id] = Math.round(px);
      state.viewRevision += 1;
    },
    save: persistWidths,
  };

  function attachColumnResize(table, fields) {
    try {
      window.BLTableColumnResize?.apply(table, {
        store: widthStore,
        columns: fields.map(field => ({ key: field.id, label: fieldLabel(field), type: columnType(field) })),
      });
    } catch (error) { console.warn('INTAKE sütun genişliği uygulanamadı:', error); }
  }

  /* Yükleme sırasında tablo yerinde kalır ve soluklaşır; durum satırı yalnız
     ekranda henüz veri yokken gösterilir. Böylece her filtrede tablonun üstüne
     bir satır girip çıkması (tüm alanın kayması) önlenir. */
  function renderChrome() {
    renderFilters();
    const refreshButton = byId('intakeRefreshBtn');
    if (refreshButton) refreshButton.disabled = state.loading;
    const body = byId('intakeBody');
    if (body) {
      body.classList.toggle('isBusy', state.loading);
      if (state.loading) body.setAttribute('aria-busy', 'true'); else body.removeAttribute('aria-busy');
    }
    const locale = isEnglish() ? 'en-GB' : 'tr-TR';
    const parts = state.loaded ? [`${state.rows.length.toLocaleString(locale)} ${text('satır', 'rows')}`, `${allFields().length} ${text('alan', 'fields')}`] : [];
    if (state.loaded && state.fetchedAt) parts.push(new Date(state.fetchedAt).toLocaleString(locale));
    if (state.loading && state.loaded) parts.unshift(text('Güncelleniyor…', 'Updating…'));
    setMeta(parts.join(' · '));
  }

  function render() {
    renderChrome();
    renderTable();
  }

  /* Görünüm kaydı sıralıdır ve birleştirilir: art arda gelen değişikliklerde
     her zaman EN SON görünüm gönderilir, eski bir yanıt yeni seçimi ezmez. */
  function persistView(options = {}) {
    state.savePending = true;
    if (state.saveInFlight) return state.saveInFlight;
    state.saveInFlight = (async () => {
      let ok = true;
      while (state.savePending) {
        state.savePending = false;
        const revision = state.viewRevision;
        try {
          const result = await requestJson('/api/intake/settings', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ viewConfig: state.viewConfig }),
          });
          if (result.viewConfig && revision === state.viewRevision && !state.savePending) {
            state.viewConfig = result.viewConfig;
            render();
          }
          ok = true;
        } catch (error) {
          ok = false;
          if (!options.silent) setStatus(error.message || String(error), 'error');
        }
      }
      state.saveInFlight = null;
      return ok;
    })();
    return state.saveInFlight;
  }

  /* Veriyi etkileyen değişiklikte sorgu kendiliğinden tekrarlanır; yalnız
     görünüm (sıralama, etiket, gruplama) değiştiyse tablo yerelde yeniden
     düzenlenir. options.refresh === false otomatik sorguyu kapatır. */
  async function saveView(next, closeModal, options = {}) {
    const queryChanged = intakeQuerySignature(next) !== intakeQuerySignature(state.viewConfig);
    state.viewConfig = next;
    state.viewRevision += 1;
    render();
    const refreshing = queryChanged && options.refresh !== false;
    if (refreshing) void refresh(false);
    const ok = await persistView();
    if (!ok) return false;
    if (options.message && !refreshing) {
      setStatus(text('INTAKE görünümü kaydedildi. Yenile ile veriyi bu düzene göre çekebilirsiniz.', 'INTAKE view saved. Refresh to query data with this layout.'), 'ok');
    }
    if (closeModal) closeModal();
    return true;
  }

  function releaseOverviewFilter(config, fieldIdValue) {
    const sync = config.display && config.display.overviewSync;
    if (!sync || !sync.values || !Object.prototype.hasOwnProperty.call(sync.values, fieldIdValue)) return;
    const values = { ...sync.values };
    delete values[fieldIdValue];
    config.display = { ...config.display, overviewSync: { ...sync, values } };
  }

  function overviewFilters() {
    const getter = window.BL_GET_OVERVIEW_FILTERS;
    try { return typeof getter === 'function' ? (getter() || {}) : {}; } catch (_) { return {}; }
  }

  /* Genel Bakış filtreleri (MAG, Buyer Grup, Sezon) INTAKE filtrelerine
     yansıtılır. Hangi değerlerin bu senkrondan geldiği görünümde
     (display.overviewSync) SAKLANIR:
       · senkron yalnız Genel Bakış filtresi gerçekten DEĞİŞİNCE çalışır;
         Genel Bakış'ın her yeniden çiziminde kullanıcının elle seçimini ezmez,
       · Genel Bakış filtresi kalkınca (uygulama yeniden açılsa da) yalnız
         senkronun yazdığı ve kullanıcının dokunmadığı değerler geri alınır. */
  function syncOverviewFilters() {
    const mapping = {
      merch: '[Dim_Urun].[MerchAltGrupKod]',
      buyerGrup: '[Dim_Urun].[BuyerGrupTanim]',
      season: '[Dim_Sezon].[SezonKod]',
    };
    const globals = overviewFilters();
    const applied = {};
    for (const [globalId, sourceUniqueName] of Object.entries(mapping)) {
      const values = Array.isArray(globals[globalId]) ? globals[globalId].map(clean).filter(Boolean) : [];
      if (!values.length) continue;
      const field = query().filters.find(item => clean(item.sourceUniqueName).toLocaleLowerCase('tr-TR') === sourceUniqueName.toLocaleLowerCase('tr-TR'));
      if (!field) continue;
      applied[field.id] = [...new Set(values)].sort().slice(0, 1000);
    }
    const appliedIds = Object.keys(applied).sort();
    const signature = appliedIds.length ? JSON.stringify(appliedIds.map(id => [id, applied[id]])) : '';
    const previous = display().overviewSync || {};
    if (signature === clean(previous.signature)) return;
    const next = clone(state.viewConfig);
    next.query.filterValues = { ...(next.query.filterValues || {}) };
    for (const [id, values] of Object.entries(previous.values || {})) {
      if (sameValues(next.query.filterValues[id], values)) delete next.query.filterValues[id];
    }
    for (const id of appliedIds) next.query.filterValues[id] = applied[id];
    next.display = { ...(next.display || {}), overviewSync: { signature, values: applied } };
    void saveView(next);
  }

  function copyAxis(config, axis) { return Array.isArray(config.query && config.query[axis]) ? config.query[axis].map(clone) : []; }
  function availableFor(axis, config) {
    const fields = axis === 'measures' ? measureFields() : dimensionFields();
    const current = new Set(copyAxis(config, axis).map(fieldId));
    return fields.filter(field => !current.has(field.id));
  }

  function intakeFieldOptionsHtml(fields, selectedId) {
    const list = Array.isArray(fields) ? fields : [];
    if (!list.length) return `<option value="">${esc(text('Alan yok', 'No fields'))}</option>`;
    return list.map(field => `<option value="${esc(field.id)}"${field.id === selectedId ? ' selected' : ''}>${esc(fieldLabel(field))}</option>`).join('');
  }

  function intakeConfigActionsHtml() {
    return `<div class="oabConfigActions">
      <button type="button" class="oabConfigIconBtn" data-intake-config-move="-1" title="${esc(text('Yukarı taşı', 'Move up'))}" aria-label="${esc(text('Yukarı taşı', 'Move up'))}">↑</button>
      <button type="button" class="oabConfigIconBtn" data-intake-config-move="1" title="${esc(text('Aşağı taşı', 'Move down'))}" aria-label="${esc(text('Aşağı taşı', 'Move down'))}">↓</button>
      <button type="button" class="oabConfigIconBtn danger" data-intake-config-remove title="${esc(text('Sil', 'Remove'))}" aria-label="${esc(text('Sil', 'Remove'))}">×</button>
    </div>`;
  }

  function intakePivotAxisRowHtml(field, axis, fields) {
    return `<div class="oabPivotAxisRow oabConfigRow intakeConfigRow" draggable="true" data-intake-axis="${esc(axis)}">
      <span class="oabConfigDrag" aria-hidden="true">⋮⋮</span>
      <select class="intakePivotAxisField">${intakeFieldOptionsHtml(fields, field && field.id)}</select>
      ${intakeConfigActionsHtml()}
    </div>`;
  }

  function intakeAggOptionsHtml(selected) {
    const preferred = INTAKE_AGGREGATES.includes(clean(selected).toUpperCase()) ? clean(selected).toUpperCase() : 'SUM';
    return INTAKE_AGGREGATES.map(agg => `<option value="${agg}"${agg === preferred ? ' selected' : ''}>${esc(INTAKE_AGG_LABELS[agg] ? text(...INTAKE_AGG_LABELS[agg]) : agg)}</option>`).join('');
  }

  function intakeWeightOptionsHtml(fields, selectedSource) {
    const key = intakeSourceKey(selectedSource || INTAKE_DEFAULT_WEIGHT_SOURCE);
    return (Array.isArray(fields) ? fields : []).map(field => `<option value="${esc(field.sourceUniqueName)}"${intakeSourceKey(field.sourceUniqueName) === key ? ' selected' : ''}>${esc(fieldLabel(field))}</option>`).join('');
  }

  function intakePivotValueRowHtml(field, fields) {
    const weighted = clean(field && field.agg).toUpperCase() === 'WAVG';
    return `<div class="oabPivotValueRow oabConfigRow intakeConfigRow" draggable="true">
      <span class="oabConfigDrag" aria-hidden="true">⋮⋮</span>
      <select class="intakePivotValueField">${intakeFieldOptionsHtml(fields, field && field.id)}</select>
      <select class="intakePivotValueAgg">${intakeAggOptionsHtml(field && field.agg)}</select>
      <select class="intakePivotValueWeight" title="${esc(text('Ağırlık', 'Weight'))}" aria-label="${esc(text('Ağırlık', 'Weight'))}"${weighted ? '' : ' hidden'}>${intakeWeightOptionsHtml(fields, field && field.weightSource)}</select>
      ${intakeConfigActionsHtml()}
    </div>`;
  }

  function intakeRefreshConfigOrderButtons(list) {
    if (!list) return;
    const rows = [...list.querySelectorAll('.oabConfigRow')];
    rows.forEach((row, index) => {
      const up = row.querySelector('[data-intake-config-move="-1"]');
      const down = row.querySelector('[data-intake-config-move="1"]');
      if (up) up.disabled = index === 0;
      if (down) down.disabled = index === rows.length - 1;
    });
  }

  function intakeFirstUnusedField(list, fields, selector) {
    const used = new Set([...list.querySelectorAll(selector)].map(select => select.value).filter(Boolean));
    return (fields || []).find(field => !used.has(field.id)) || (fields || [])[0] || null;
  }

  function intakeMoveConfigRow(row, direction) {
    if (!row || !row.parentElement) return;
    const parent = row.parentElement;
    if (direction < 0 && row.previousElementSibling) parent.insertBefore(row, row.previousElementSibling);
    if (direction > 0 && row.nextElementSibling) parent.insertBefore(row.nextElementSibling, row);
    intakeRefreshConfigOrderButtons(parent);
  }

  function openFields() {
    if (state.metadataLoading) return;
    document.getElementById('_intakeFieldsModal')?.remove();
    const draft = clone(state.viewConfig);
    draft.display = {
      ...(draft.display || {}),
      grouped: draft.display?.grouped !== false,
      showSubtotals: draft.display?.showSubtotals !== false,
      collapsedGroups: Array.isArray(draft.display?.collapsedGroups) ? draft.display.collapsedGroups : [],
      hideZeroCurrentBudget: draft.display?.hideZeroCurrentBudget !== false,
    };
    const dimensionPool = dimensionFields();
    const valuePool = measureFields();
    const modal = document.createElement('div');
    modal.className = 'autoModalOverlay';
    modal.id = '_intakeFieldsModal';
    modal.innerHTML = `<div class="autoModal oabSettingsModal intakeFieldsModal" role="dialog" aria-modal="true" aria-labelledby="_intakeFieldsTitle">
      <header><h3 id="_intakeFieldsTitle">${esc(text('INTAKE Ayarları', 'INTAKE Settings'))}</h3><button type="button" data-intake-close aria-label="${esc(text('Kapat', 'Close'))}">×</button></header>
      <div class="autoModalBody">
        <div class="oabPivotBehaviorGrid">
          <label class="oabCheckField"><input type="checkbox" id="intakeGroupedViewInput"${draft.display.grouped !== false ? ' checked' : ''}><span>${esc(text('Gruplu pivot görünümü', 'Grouped pivot view'))}</span></label>
          <label class="oabCheckField"><input type="checkbox" id="intakeShowSubtotalsInput"${draft.display.showSubtotals !== false ? ' checked' : ''}><span>${esc(text('Alt toplamları ve genel toplamı göster', 'Show subtotals and grand total'))}</span></label>
          <label class="oabCheckField"><input type="checkbox" id="intakeHideZeroBudgetInput"${draft.display.hideZeroCurrentBudget !== false ? ' checked' : ''}><span>${esc(text('Güncel Alım Bütçe = 0 olanları listeleme', 'Hide rows where Current Purchase Budget is 0'))}</span></label>
        </div>

        <div class="oabSettingsSection">
          <div class="oabSettingsSectionHead"><span>${esc(text('Pivot Satırları', 'Pivot Rows'))}</span><button type="button" class="navActionBtn" id="intakeAddRowBtn">+ ${esc(text('Alan ekle', 'Add field'))}</button></div>
          <div class="oabPivotConfigList" id="intakePivotRowsList">${(draft.query.rows || []).map(field => intakePivotAxisRowHtml(field, 'rows', dimensionPool)).join('')}</div>
        </div>

        <div class="oabSettingsSection">
          <div class="oabSettingsSectionHead"><span>${esc(text('Pivot Sütunları', 'Pivot Columns'))}</span><button type="button" class="navActionBtn" id="intakeAddColumnBtn">+ ${esc(text('Alan ekle', 'Add field'))}</button></div>
          <div class="oabPivotConfigList" id="intakePivotColsList">${(draft.query.columns || []).map(field => intakePivotAxisRowHtml(field, 'columns', dimensionPool)).join('')}</div>
        </div>

        <div class="oabSettingsSection">
          <div class="oabSettingsSectionHead"><span>${esc(text('Pivot Değerleri', 'Pivot Values'))}</span><button type="button" class="navActionBtn" id="intakeAddValueBtn">+ ${esc(text('Değer ekle', 'Add value'))}</button></div>
          <div class="oabPivotConfigList" id="intakePivotValuesList">${(draft.query.measures || []).map(field => intakePivotValueRowHtml(field, valuePool)).join('')}</div>
        </div>

        <p class="oabSettingsHint">${esc(text('Satırları tutup sürükleyerek veya oklarla sıralayabilirsiniz. Pivot Values için SUM, AVG, Ağırlıklı ort., COUNT, MIN, MAX ve FIRST özetleme seçenekleri kullanılabilir. Oran/% sütunlarında Ağırlıklı ort. ile paydayı (ör. Güncel Alım Bütçe) seçin; alt toplam oranı doğru hesaplanır.', 'Drag rows to reorder them or use the arrows. Pivot Values support SUM, AVG, Weighted avg., COUNT, MIN, MAX and FIRST summarization. For ratio/% columns choose Weighted avg. with the denominator (e.g. Current Purchase Budget) so subtotals stay correct.'))}</p>
      </div>
      <footer><button type="button" class="tbtn" data-intake-settings-reset>${esc(text('Pivot Varsayılanına Dön', 'Reset Pivot'))}</button><button type="button" class="tbtn" data-intake-close>${esc(text('Vazgeç', 'Cancel'))}</button><button type="button" class="tbtn primary" data-intake-save>${esc(text('Kaydet', 'Save'))}</button></footer>
    </div>`;
    document.body.appendChild(modal);

    const close = () => modal.remove();
    modal.querySelectorAll('[data-intake-close]').forEach(button => button.addEventListener('click', close));
    modal.addEventListener('pointerdown', event => { modal.dataset.backdropDown = event.target === modal ? '1' : '0'; });
    modal.addEventListener('pointerup', event => { if (event.target === modal && modal.dataset.backdropDown === '1') close(); modal.dataset.backdropDown = '0'; });

    const rowList = modal.querySelector('#intakePivotRowsList');
    const colList = modal.querySelector('#intakePivotColsList');
    const valueList = modal.querySelector('#intakePivotValuesList');
    const refreshOrderButtons = () => {
      intakeRefreshConfigOrderButtons(rowList);
      intakeRefreshConfigOrderButtons(colList);
      intakeRefreshConfigOrderButtons(valueList);
    };
    refreshOrderButtons();

    modal.querySelector('#intakeAddRowBtn')?.addEventListener('click', () => {
      const field = intakeFirstUnusedField(rowList, dimensionPool, '.intakePivotAxisField');
      if (!field) return;
      rowList.insertAdjacentHTML('beforeend', intakePivotAxisRowHtml(field, 'rows', dimensionPool));
      refreshOrderButtons();
    });
    modal.querySelector('#intakeAddColumnBtn')?.addEventListener('click', () => {
      const field = intakeFirstUnusedField(colList, dimensionPool, '.intakePivotAxisField');
      if (!field) return;
      colList.insertAdjacentHTML('beforeend', intakePivotAxisRowHtml(field, 'columns', dimensionPool));
      refreshOrderButtons();
    });
    modal.querySelector('#intakeAddValueBtn')?.addEventListener('click', () => {
      const field = intakeFirstUnusedField(valueList, valuePool, '.intakePivotValueField');
      if (!field) return;
      valueList.insertAdjacentHTML('beforeend', intakePivotValueRowHtml({ ...field, agg: field.agg || 'SUM' }, valuePool));
      refreshOrderButtons();
    });

    modal.addEventListener('change', event => {
      const agg = event.target.closest?.('.intakePivotValueAgg');
      const weight = agg && agg.closest('.oabPivotValueRow')?.querySelector('.intakePivotValueWeight');
      if (weight) weight.hidden = clean(agg.value).toUpperCase() !== 'WAVG';
    });
    modal.addEventListener('click', event => {
      const remove = event.target.closest && event.target.closest('[data-intake-config-remove]');
      if (remove && modal.contains(remove)) {
        const row = remove.closest('.oabConfigRow');
        const list = row && row.parentElement;
        row?.remove();
        intakeRefreshConfigOrderButtons(list);
        return;
      }
      const moveButton = event.target.closest && event.target.closest('[data-intake-config-move]');
      if (moveButton && modal.contains(moveButton)) {
        intakeMoveConfigRow(moveButton.closest('.oabConfigRow'), Number(moveButton.dataset.intakeConfigMove));
      }
    });

    let draggedRow = null;
    modal.addEventListener('dragstart', event => {
      const row = event.target.closest && event.target.closest('.oabConfigRow');
      if (!row || !modal.contains(row)) return;
      draggedRow = row;
      row.classList.add('isDragging');
      if (event.dataTransfer) { event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', 'intake-config-row'); }
    });
    modal.addEventListener('dragover', event => {
      const target = event.target.closest && event.target.closest('.oabConfigRow');
      if (!draggedRow || !target || target === draggedRow || target.parentElement !== draggedRow.parentElement) return;
      event.preventDefault();
      const rect = target.getBoundingClientRect();
      target.parentElement.insertBefore(draggedRow, event.clientY > rect.top + rect.height / 2 ? target.nextElementSibling : target);
    });
    modal.addEventListener('drop', event => {
      if (!draggedRow) return;
      event.preventDefault();
      intakeRefreshConfigOrderButtons(draggedRow.parentElement);
    });
    modal.addEventListener('dragend', () => {
      if (draggedRow) draggedRow.classList.remove('isDragging');
      draggedRow = null;
      refreshOrderButtons();
    });

    const selectedAxis = list => {
      const result = [], seen = new Set();
      list.querySelectorAll('.intakePivotAxisField').forEach(select => {
        const field = dimensionPool.find(item => item.id === select.value);
        if (!field || seen.has(field.id)) return;
        seen.add(field.id); result.push(clone(field));
      });
      return result;
    };

    modal.querySelector('[data-intake-save]')?.addEventListener('click', async () => {
      draft.query.rows = selectedAxis(rowList);
      draft.query.columns = selectedAxis(colList);
      draft.query.measures = [...valueList.querySelectorAll('.oabPivotValueRow')].map(row => {
        const field = valuePool.find(item => item.id === row.querySelector('.intakePivotValueField')?.value);
        const agg = clean(row.querySelector('.intakePivotValueAgg')?.value).toUpperCase();
        if (!field) return null;
        const next = { ...clone(field), agg: INTAKE_AGGREGATES.includes(agg) ? agg : 'SUM' };
        delete next.weightSource; delete next.weightId;
        if (next.agg === 'WAVG') next.weightSource = clean(row.querySelector('.intakePivotValueWeight')?.value) || INTAKE_DEFAULT_WEIGHT_SOURCE;
        return next;
      }).filter(Boolean);
      draft.display.grouped = Boolean(modal.querySelector('#intakeGroupedViewInput')?.checked);
      draft.display.showSubtotals = Boolean(modal.querySelector('#intakeShowSubtotalsInput')?.checked);
      draft.display.hideZeroCurrentBudget = Boolean(modal.querySelector('#intakeHideZeroBudgetInput')?.checked);
      draft.display.collapsedGroups = [];
      await saveView(draft, close, { message: true, refresh: state.loaded });
    });

    modal.querySelector('[data-intake-settings-reset]')?.addEventListener('click', async () => {
      try {
        const result = await requestJson('/api/intake/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reset: true }) });
        state.viewConfig = result.viewConfig || state.viewConfig;
        state.viewRevision += 1;
        setRows([]);
        state.loaded = false;
        close();
        render();
        setStatus(text('INTAKE Pivot varsayılan düzenine döndü. Yenile ile veriyi çekin.', 'INTAKE Pivot reset to defaults. Refresh to query data.'), 'ok');
      } catch (error) { setStatus(error.message || String(error), 'error'); }
    });
  }

  function closePopover() {
    if (!state.popover) return;
    state.popover.remove();
    state.popover = null;
    document.querySelectorAll('.intakeFilterTrigger[aria-expanded="true"]').forEach(button => button.setAttribute('aria-expanded', 'false'));
  }

  function openFilterFieldPicker(button) {
    closePopover();
    const fields = availableFor('filters', state.viewConfig);
    if (!fields.length) return;
    const popover = document.createElement('div');
    popover.className = 'oabLocalFilterAddPopover intakeFilterPopover intakeFilterFieldPicker';
    popover.setAttribute('role', 'dialog');
    popover.setAttribute('aria-label', text('INTAKE filtre alanı ekle', 'Add INTAKE filter field'));
    popover.innerHTML = `<div class="intakeFilterPopoverTitle">${esc(text('INTAKE alanından filtre ekle', 'Add filter from INTAKE fields'))}</div><input type="search" class="intakeFilterSearch" placeholder="${esc(text('Alanlarda ara…', 'Search fields…'))}"><div class="intakeFilterValues"></div>`;
    document.body.appendChild(popover);
    state.popover = popover;
    button.setAttribute('aria-expanded', 'true');
    const rect = button.getBoundingClientRect();
    popover.style.left = `${Math.max(8, Math.min(window.innerWidth - popover.offsetWidth - 8, rect.left))}px`;
    popover.style.top = `${Math.min(window.innerHeight - popover.offsetHeight - 8, rect.bottom + 4)}px`;
    const list = popover.querySelector('.intakeFilterValues'), search = popover.querySelector('.intakeFilterSearch');
    const draw = () => {
      const needle = clean(search.value).toLocaleLowerCase(isEnglish() ? 'en' : 'tr');
      const visible = fields.filter(field => !needle || fieldLabel(field).toLocaleLowerCase(isEnglish() ? 'en' : 'tr').includes(needle));
      list.innerHTML = visible.length
        ? visible.map(field => `<button type="button" class="intakeFilterFieldOption" data-intake-add-filter-id="${esc(field.id)}"><span>${esc(fieldLabel(field))}</span><small>${esc(field.sourceUniqueName || '')}</small></button>`).join('')
        : `<div class="intakeConfigEmpty">${esc(text('Eşleşen alan yok.', 'No matching field.'))}</div>`;
    };
    search.addEventListener('input', draw);
    popover.addEventListener('click', event => {
      const option = event.target.closest('[data-intake-add-filter-id]');
      if (!option) return;
      const field = fields.find(item => item.id === option.dataset.intakeAddFilterId);
      if (!field) return;
      const next = clone(state.viewConfig);
      next.query.filters = [...copyAxis(next, 'filters'), clone(field)];
      closePopover();
      void saveView(next);
    });
    draw();
    search.focus({ preventScroll: true });
  }

  function openFilter(button, field) {
    closePopover();
    const popover = document.createElement('div');
    popover.className = 'oabLocalFilterAddPopover intakeFilterPopover';
    popover.setAttribute('role', 'dialog');
    const selected = new Set(Array.isArray(query().filterValues && query().filterValues[field.id]) ? query().filterValues[field.id] : []);
    const localValues = valuesFromRows(field);
    popover.innerHTML = `<div class="intakeFilterPopoverTitle">${esc(fieldLabel(field))}</div><input type="search" class="intakeFilterSearch" placeholder="${esc(text('Değerlerde ara…', 'Search values…'))}"><div class="intakeFilterValues"><div class="intakeConfigEmpty">${esc(text('Değerler yükleniyor…', 'Loading values…'))}</div></div><div class="intakeFilterActions"><button type="button" class="tbtn" data-intake-clear>${esc(text('Temizle', 'Clear'))}</button><button type="button" class="tbtn primary" data-intake-apply>${esc(text('Uygula', 'Apply'))}</button></div>`;
    document.body.appendChild(popover);
    state.popover = popover;
    button.setAttribute('aria-expanded', 'true');
    const rect = button.getBoundingClientRect();
    const left = Math.max(8, Math.min(window.innerWidth - popover.offsetWidth - 8, rect.left));
    popover.style.left = `${left}px`;
    popover.style.top = `${Math.min(window.innerHeight - popover.offsetHeight - 8, rect.bottom + 4)}px`;
    const list = popover.querySelector('.intakeFilterValues');
    const search = popover.querySelector('.intakeFilterSearch');

    const draw = values => {
      const filter = clean(search.value).toLocaleLowerCase(isEnglish() ? 'en' : 'tr');
      const visible = values.filter(value => !filter || value.toLocaleLowerCase(isEnglish() ? 'en' : 'tr').includes(filter));
      list.innerHTML = visible.length ? visible.map(value => `<label class="intakeFilterOption"><input type="checkbox" value="${esc(value)}"${selected.has(value) ? ' checked' : ''}><span>${esc(value)}</span></label>`).join('') : `<div class="intakeConfigEmpty">${esc(text('Eşleşen değer yok.', 'No matching value.'))}</div>`;
    };
    draw(localValues);
    search.addEventListener('input', () => draw(localValues));
    popover.addEventListener('change', event => { if (event.target.matches('input[type="checkbox"]')) event.target.checked ? selected.add(event.target.value) : selected.delete(event.target.value); });
    popover.querySelector('[data-intake-clear]').addEventListener('click', () => { selected.clear(); draw(localValues); });
    popover.querySelector('[data-intake-apply]').addEventListener('click', async () => {
      const next = clone(state.viewConfig);
      next.query.filterValues = { ...(next.query.filterValues || {}) };
      if (selected.size) next.query.filterValues[field.id] = [...selected].slice(0, 1000); else delete next.query.filterValues[field.id];
      // Kullanıcı bu filtreyi elle belirledi; artık Genel Bakış senkronuna ait değil.
      releaseOverviewFilter(next, field.id);
      closePopover();
      void saveView(next);
    });
    void requestJson('/api/intake/distinct', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fieldId: field.id, sourceUniqueName: field.sourceUniqueName, limit: 500 }) })
      .then(result => { const values = Array.isArray(result.values) ? result.values : localValues; draw([...new Set([...values, ...selected])].sort((a, b) => a.localeCompare(b, isEnglish() ? 'en' : 'tr', { numeric: true }))); })
      .catch(error => {
        if (localValues.length) return;
        // Yalnız gerçek kaynak kesintisi "canlı kaynak yok" olarak anlatılır;
        // alan/tip hatası kendi mesajıyla görünür.
        const message = /ulaşılamıyor|VPN/i.test(error && error.message || '') || !(error && error.message)
          ? text('Canlı kaynak kullanılamıyor; filtre değerleri yalnızca yüklenmiş snapshot üzerinden gösterilebilir.', 'Live source is unavailable; filter values can only be shown from a loaded snapshot.')
          : error.message;
        list.innerHTML = `<div class="intakeConfigEmpty">${esc(message)}</div>`;
      });
  }

  function renameHeader(header) {
    const id = clean(header.dataset.intakeRename);
    const field = configuredFields().find(item => item.id === id);
    if (!field || header.querySelector('input')) return;
    const input = document.createElement('input');
    input.className = 'intakeInlineLabel';
    input.value = fieldLabel(field);
    input.maxLength = 160;
    header.textContent = '';
    header.appendChild(input);
    input.focus();
    input.select();
    let done = false;
    const finish = save => {
      if (done) return;
      done = true;
      if (!save) { renderTable({ force: true }); return; }
      const value = clean(input.value);
      if (!value) { renderTable({ force: true }); return; }
      void saveView(window.INTAKE_REPORT_API.updateDisplayLabel(state.viewConfig, id, value));
    };
    input.addEventListener('keydown', event => { if (event.key === 'Enter') finish(true); if (event.key === 'Escape') finish(false); });
    input.addEventListener('blur', () => finish(true));
  }

  /* Tek bir rapor isteği. Yanıt geldiğinde kullanıcı sorguyu (filtre, alan)
     değiştirmişse eski sonuç ekrana basılmaz; en güncel görünümle yeni sorgu
     sıraya alınır. */
  async function runReport(forceRefresh) {
    const sent = clone(state.viewConfig);
    const revision = state.viewRevision;
    const signature = intakeQuerySignature(sent);
    const result = await requestJson('/api/intake/report', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ viewConfig: sent, forceRefresh: Boolean(forceRefresh) }) });
    if (intakeQuerySignature(state.viewConfig) !== signature) {
      if (!state.refreshQueued) state.refreshQueued = { force: false };
      return;
    }
    // Canlı kaynak düştüğünde sunucu son snapshot'ı döndürür; satırlar yoksa
    // ekrandaki veri korunur, tablo boşaltılmaz.
    const rows = Array.isArray(result.rows) ? result.rows
      : (result.snapshot && Array.isArray(result.snapshot.rows) ? result.snapshot.rows : null);
    if (rows) setRows(rows);
    state.fields = Array.isArray(result.fields) && result.fields.length ? result.fields : state.fields;
    if (result.viewConfig && revision === state.viewRevision) state.viewConfig = result.viewConfig;
    state.loaded = true;
    state.offline = Boolean(result.offline);
    state.fetchedAt = result.fetchedAt || (result.snapshot && result.snapshot.fetchedAt) || state.fetchedAt;
    state.error = '';
    setStatus(result.offline ? text('Canlı kaynak kullanılamıyor; son başarılı INTAKE snapshot gösteriliyor. Seçili filtreler bu veriye uygulanmamış olabilir.', 'Live source is unavailable; showing the last successful INTAKE snapshot. The selected filters may not be applied to this data.') : (result.truncated ? text(`Özet görünüm ilk ${(result.rowLimit||state.rows.length).toLocaleString('tr-TR')} satırla sınırlandı. Filtre ekleyerek daraltın.`, `The aggregate view is limited to the first ${(result.rowLimit||state.rows.length).toLocaleString('en-GB')} rows. Narrow it with filters.`) : ''), result.offline || result.truncated ? 'warning' : 'ok');
  }

  /* Yükleme sürerken gelen yenileme istekleri düşürülmez: sıraya alınır ve
     mevcut istek bitince en güncel görünümle bir kez daha sorgulanır. */
  function refresh(forceRefresh) {
    if (state.loading) {
      state.refreshQueued = { force: Boolean(forceRefresh) || Boolean(state.refreshQueued && state.refreshQueued.force) };
      return state.refreshPromise;
    }
    state.loading = true;
    if (!state.loaded) setStatus(text('INTAKE verileri getiriliyor…', 'Loading INTAKE data…'), 'loading');
    renderChrome();
    state.refreshPromise = (async () => {
      let force = Boolean(forceRefresh);
      try {
        do {
          state.refreshQueued = null;
          try {
            await runReport(force);
          } catch (error) {
            state.error = error.message || String(error);
            setStatus(state.error, 'error');
          }
          force = Boolean(state.refreshQueued && state.refreshQueued.force);
        } while (state.refreshQueued);
      } finally {
        state.loading = false;
        state.refreshPromise = null;
        render();
      }
    })();
    return state.refreshPromise;
  }

  async function loadState() {
    const revision = state.viewRevision;
    try {
      const result = await requestJson('/api/intake/state');
      state.fields = Array.isArray(result.fields) ? result.fields : [];
      if (revision === state.viewRevision) state.viewConfig = result.viewConfig || state.viewConfig;
      if (result.snapshot && !state.loaded) {
        state.fetchedAt = result.snapshot.fetchedAt || '';
        setRows(result.snapshot.rows);
        state.loaded = true;
        state.offline = Boolean(result.offline);
        setStatus(result.offline ? text('Canlı kaynak kullanılamıyor; son başarılı snapshot gösteriliyor.', 'Live source is unavailable; showing the last successful snapshot.') : '', result.offline ? 'warning' : 'ok');
      }
      render();
      syncOverviewFilters();
    } catch (error) {
      setStatus(error.message || String(error), 'error');
    }
  }

  async function loadMetadata() {
    // Reuse the in-flight request.  The settings button can be clicked while
    // the initial metadata request is still running; returning early here
    // made `.finally(openFields)` run before `metadataLoading` was cleared,
    // so the modal silently refused to open.
    if (state.metadataLoading) return state.metadataPromise || Promise.resolve();
    state.metadataLoading = true;
    setStatus(text('INTAKE alanları yükleniyor…', 'Loading INTAKE fields…'), 'loading');
    const revision = state.viewRevision;
    state.metadataPromise = (async () => {
      try {
        const result = await requestJson('/api/intake/metadata');
        if (Array.isArray(result.fields) && result.fields.length) state.fields = result.fields;
        if (result.viewConfig && revision === state.viewRevision) state.viewConfig = result.viewConfig;
        setStatus('', '');
        render();
      } catch (error) {
        setStatus(state.fields.length ? text('Canlı şema kullanılamıyor; mevcut alanlar kullanılacak.', 'Live schema is unavailable; using available fields.') : (error.message || String(error)), 'warning');
      } finally {
        state.metadataLoading = false;
        state.metadataPromise = null;
      }
    })();
    return state.metadataPromise;
  }

  function setFilterPanelOpen(open) {
    const panel = byId('intakeFilterPanel');
    const button = byId('intakeFiltersBtn');
    if (!panel || !button) return;
    const next = Boolean(open);
    panel.hidden = !next;
    button.setAttribute('aria-expanded', next ? 'true' : 'false');
    if (next) {
      const sectionRect = section.getBoundingClientRect();
      const buttonRect = button.getBoundingClientRect();
      panel.style.top = `${Math.max(44, buttonRect.bottom - sectionRect.top + 6)}px`;
      panel.style.right = `${Math.max(8, sectionRect.right - buttonRect.right)}px`;
    }
  }

  function bind() {
    byId('intakeFieldsBtn')?.addEventListener('click', () => { void loadMetadata().finally(openFields); });
    byId('intakeResetBtn')?.addEventListener('click', async () => {
      try {
        const result = await requestJson('/api/intake/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reset: true }) });
        state.viewConfig = result.viewConfig || state.viewConfig;
        state.viewRevision += 1;
        setRows([]);
        state.loaded = false;
        render();
        setStatus(text('Varsayılan INTAKE görünümü geri yüklendi. Yenile ile veriyi çekin.', 'Default INTAKE view restored. Refresh to query data.'), 'ok');
      } catch (error) { setStatus(error.message || String(error), 'error'); }
    });
    byId('intakeRefreshBtn')?.addEventListener('click', () => void refresh(true));
    byId('intakeFiltersBtn')?.addEventListener('click', event => {
      event.stopPropagation();
      const panel = byId('intakeFilterPanel');
      setFilterPanelOpen(Boolean(panel && panel.hidden));
    });
    byId('intakeCollapseAllBtn')?.addEventListener('click', intakeCollapseAllGroups);
    byId('intakeExpandAllBtn')?.addEventListener('click', intakeExpandAllGroups);
    byId('intakeFilterBar')?.addEventListener('click', event => {
      const add = event.target.closest('[data-intake-add-filter]');
      if (add) {
        void loadMetadata().then(() => {
          const current = byId('intakeFilterBar')?.querySelector('[data-intake-add-filter]');
          if (current && !current.disabled) openFilterFieldPicker(current);
        });
        return;
      }
      const remove = event.target.closest('[data-intake-filter-remove]');
      if (remove) {
        const next = clone(state.viewConfig);
        next.query.filterValues = { ...(next.query.filterValues || {}) };
        delete next.query.filterValues[remove.dataset.intakeFilterRemove];
        releaseOverviewFilter(next, remove.dataset.intakeFilterRemove);
        void saveView(next);
        return;
      }
      const trigger = event.target.closest('[data-intake-filter]');
      if (trigger) {
        const field = query().filters.find(item => item.id === trigger.dataset.intakeFilter);
        if (field) openFilter(trigger, field);
      }
    });
    byId('intakeTable')?.addEventListener('click', event => {
      const groupToggle = event.target.closest('[data-intake-group-key]');
      if (groupToggle) {
        const next = clone(state.viewConfig);
        next.display = { ...(next.display || {}) };
        const collapsed = new Set(Array.isArray(next.display.collapsedGroups) ? next.display.collapsedGroups : []);
        const key = groupToggle.dataset.intakeGroupKey;
        collapsed.has(key) ? collapsed.delete(key) : collapsed.add(key);
        next.display.collapsedGroups = [...collapsed];
        state.viewConfig = next;
        renderTable();
        return;
      }
      const header = event.target.closest('[data-intake-sort]');
      if (!header || event.detail > 1) return;
      const next = clone(state.viewConfig);
      next.display = { ...(next.display || {}), sort: { id: header.dataset.intakeSort, dir: display().sort?.id === header.dataset.intakeSort && Number(display().sort?.dir) === 1 ? -1 : 1 } };
      void saveView(next);
    });
    byId('intakeTable')?.addEventListener('dblclick', event => { const header = event.target.closest('[data-intake-rename]'); if (header) renameHeader(header); });
    document.addEventListener('click', event => {
      if (state.popover && !state.popover.contains(event.target) && !event.target.closest('[data-intake-filter],[data-intake-add-filter]')) closePopover();
      const panel = byId('intakeFilterPanel');
      if (panel && !panel.hidden && !panel.contains(event.target) && !event.target.closest('#intakeFiltersBtn,.intakeFilterPopover')) setFilterPanelOpen(false);
    });
    document.addEventListener('keydown', event => { if (event.key === 'Escape') { closePopover(); setFilterPanelOpen(false); } });
  }

  window.INTAKE_REPORT_API = window.INTAKE_REPORT_API || { updateDisplayLabel: (config, id, value) => {
    const next = clone(config);
    next.display = { ...(next.display || {}), labels: { ...((next.display || {}).labels || {}) } };
    const field = configuredFields().find(item => item.id === id);
    if (!field || !value || clean(value).toLocaleLowerCase('tr-TR') === clean(field.defaultLabel).toLocaleLowerCase('tr-TR')) delete next.display.labels[id];
    else next.display.labels[id] = clean(value).slice(0, 160);
    return next;
  } };

  bind();
  void loadState();
  window.BLINTAKE = { state, refresh: () => refresh(true), openFields, loadMetadata, onOverviewFiltersChanged: syncOverviewFilters };
})();
