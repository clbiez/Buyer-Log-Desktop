(function () {
  'use strict';

  /* INTAKE UI: the data contract is deliberately small.  Source identities
     come from the server and the browser only owns view state (order, label,
     widths, sort and selected filter values). */
  const section = document.getElementById('intakeSection');
  if (!section) return;

  const state = {
    fields: [],
    viewConfig: { version: 2, query: { rows: [], columns: [], measures: [], filters: [], filterValues: {} }, display: { labels: {}, widths: {}, sort: { id: '', dir: 1 }, collapsed: [], grouped: true, showSubtotals: true, collapsedGroups: [], hideZeroCurrentBudget: true } },
    rows: [],
    loaded: false,
    loading: false,
    metadataLoading: false,
    metadataPromise: null,
    offline: false,
    error: '',
    popover: null,
    drag: null,
    globalFilterIds: new Set(),
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

  function numberText(value) {
    if (value === null || value === undefined || value === '') return '';
    const numeric = typeof value === 'number' ? value : Number(String(value).replace(/\s/g, '').replace(',', '.'));
    if (!Number.isFinite(numeric)) return String(value);
    return numeric.toLocaleString(isEnglish() ? 'en-GB' : 'tr-TR', { maximumFractionDigits: 2 });
  }

  function valuesFromRows(field) {
    return [...new Set(state.rows.map(row => clean(row && row[field.id])).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b, isEnglish() ? 'en' : 'tr', { numeric: true }));
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
  }

  const INTAKE_AGGREGATES = ['SUM', 'AVG', 'COUNT', 'MIN', 'MAX', 'FIRST'];

  function intakeAggregateRows(rows, field) {
    const source = Array.isArray(rows) ? rows : [];
    const values = source.map(row => row && row[field.id]).filter(value => value !== null && value !== undefined && value !== '');
    const agg = INTAKE_AGGREGATES.includes(clean(field && field.agg).toUpperCase()) ? clean(field.agg).toUpperCase() : 'SUM';
    if (agg === 'FIRST') return values.length ? values[0] : '';
    if (agg === 'COUNT') return values.length;
    const numbers = values.map(value => typeof value === 'number' ? value : Number(String(value).replace(/\s/g, '').replace(',', '.'))).filter(Number.isFinite);
    if (!numbers.length) return values.length ? values[0] : '';
    if (agg === 'AVG') return numbers.reduce((sum, value) => sum + value, 0) / numbers.length;
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
      groups.forEach(group => {
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

  function renderTable() {
    const body = byId('intakeBody');
    const table = byId('intakeTable');
    if (!body || !table) return;
    body.hidden = false;
    const fields = activeColumns();
    if (!fields.length) {
      intakeUpdateGroupButtons([]);
      table.innerHTML = `<tbody><tr><td class="intakeEmpty" colspan="1">${esc(text('Alan seçilmedi.', 'No fields selected.'))}</td></tr></tbody>`;
      return;
    }
    const sorted = state.rows.slice();
    const sort = display().sort || {};
    if (sort.id) {
      const direction = Number(sort.dir) === -1 ? -1 : 1;
      sorted.sort((left, right) => String(left && left[sort.id] == null ? '' : left && left[sort.id]).localeCompare(String(right && right[sort.id] == null ? '' : right && right[sort.id]), isEnglish() ? 'en' : 'tr', { numeric: true, sensitivity: 'base' }) * direction);
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
    widthSaveTimer = setTimeout(() => {
      void requestJson('/api/intake/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ viewConfig: state.viewConfig }),
      }).then(result => { if (result.viewConfig) state.viewConfig = result.viewConfig; }).catch(() => {});
    }, 600);
  }

  const widthStore = {
    get: id => { const px = Number(display().widths && display().widths[id]); return Number.isFinite(px) ? px : null; },
    set: (id, px) => {
      const target = state.viewConfig.display || (state.viewConfig.display = {});
      if (!target.widths || typeof target.widths !== 'object') target.widths = {};
      target.widths[id] = Math.round(px);
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

  function render() {
    renderFilters();
    renderTable();
    const refresh = byId('intakeRefreshBtn');
    if (refresh) refresh.disabled = state.loading;
    const fields = allFields().length;
    setMeta(state.loaded ? `${state.rows.length.toLocaleString(isEnglish() ? 'en-GB' : 'tr-TR')} ${text('satır', 'rows')} · ${fields} ${text('alan', 'fields')}` : '');
  }

  async function saveView(next, closeModal) {
    state.viewConfig = next;
    render();
    try {
      const result = await requestJson('/api/intake/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ viewConfig: next }),
      });
      if (result.viewConfig) state.viewConfig = result.viewConfig;
      render();
      setStatus(text('INTAKE görünümü kaydedildi. Yenile ile veriyi bu düzene göre çekebilirsiniz.', 'INTAKE view saved. Refresh to query data with this layout.'), 'ok');
      if (closeModal) closeModal();
      return true;
    } catch (error) {
      setStatus(error.message || String(error), 'error');
      return false;
    }
  }

  function overviewFilters() {
    const getter = window.BL_GET_OVERVIEW_FILTERS;
    try { return typeof getter === 'function' ? (getter() || {}) : {}; } catch (_) { return {}; }
  }

  function syncOverviewFilters() {
    const mapping = {
      merch: '[Dim_Urun].[MerchAltGrupKod]',
      buyerGrup: '[Dim_Urun].[BuyerGrupTanim]',
      season: '[Dim_Sezon].[SezonKod]',
    };
    const globals = overviewFilters();
    const next = clone(state.viewConfig);
    next.query.filterValues = { ...(next.query.filterValues || {}) };
    const before = JSON.stringify(next.query.filterValues);
    for (const id of state.globalFilterIds) { if (Object.prototype.hasOwnProperty.call(next.query.filterValues, id)) delete next.query.filterValues[id]; }
    state.globalFilterIds = new Set();
    for (const [globalId, sourceUniqueName] of Object.entries(mapping)) {
      const values = Array.isArray(globals[globalId]) ? globals[globalId].map(clean).filter(Boolean) : [];
      if (!values.length) continue;
      const field = query().filters.find(item => clean(item.sourceUniqueName).toLocaleLowerCase('tr-TR') === sourceUniqueName.toLocaleLowerCase('tr-TR'));
      if (!field) continue;
      next.query.filterValues[field.id] = [...new Set(values)].slice(0, 1000);
      state.globalFilterIds.add(field.id);
    }
    const changed = before !== JSON.stringify(next.query.filterValues);
    if (changed) { state.viewConfig = next; render(); void saveView(next).then(() => refresh(false)); }
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
    return INTAKE_AGGREGATES.map(agg => `<option value="${agg}"${agg === preferred ? ' selected' : ''}>${agg}</option>`).join('');
  }

  function intakePivotValueRowHtml(field, fields) {
    return `<div class="oabPivotValueRow oabConfigRow intakeConfigRow" draggable="true">
      <span class="oabConfigDrag" aria-hidden="true">⋮⋮</span>
      <select class="intakePivotValueField">${intakeFieldOptionsHtml(fields, field && field.id)}</select>
      <select class="intakePivotValueAgg">${intakeAggOptionsHtml(field && field.agg)}</select>
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

        <p class="oabSettingsHint">${esc(text('Satırları tutup sürükleyerek veya oklarla sıralayabilirsiniz. Pivot Values için SUM, AVG, COUNT, MIN, MAX ve FIRST özetleme seçenekleri kullanılabilir.', 'Drag rows to reorder them or use the arrows. Pivot Values support SUM, AVG, COUNT, MIN, MAX and FIRST summarization.'))}</p>
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
        return field ? { ...clone(field), agg: INTAKE_AGGREGATES.includes(agg) ? agg : 'SUM' } : null;
      }).filter(Boolean);
      draft.display.grouped = Boolean(modal.querySelector('#intakeGroupedViewInput')?.checked);
      draft.display.showSubtotals = Boolean(modal.querySelector('#intakeShowSubtotalsInput')?.checked);
      draft.display.hideZeroCurrentBudget = Boolean(modal.querySelector('#intakeHideZeroBudgetInput')?.checked);
      draft.display.collapsedGroups = [];
      await saveView(draft, close);
    });

    modal.querySelector('[data-intake-settings-reset]')?.addEventListener('click', async () => {
      try {
        const result = await requestJson('/api/intake/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reset: true }) });
        state.viewConfig = result.viewConfig || state.viewConfig;
        state.rows = [];
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
      closePopover();
      if (await saveView(next)) void refresh(false);
    });
    void requestJson('/api/intake/distinct', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fieldId: field.id, limit: 500 }) })
      .then(result => { const values = Array.isArray(result.values) ? result.values : localValues; draw([...new Set([...values, ...selected])].sort((a, b) => a.localeCompare(b, isEnglish() ? 'en' : 'tr', { numeric: true }))); })
      .catch(() => { if (!localValues.length) list.innerHTML = `<div class="intakeConfigEmpty">${esc(text('Canlı kaynak kullanılamıyor; filtre değerleri yalnızca yüklenmiş snapshot üzerinden gösterilebilir.', 'Live source is unavailable; filter values can only be shown from a loaded snapshot.'))}</div>`; });
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
      if (!save) { renderTable(); return; }
      const value = clean(input.value);
      if (!value) { renderTable(); return; }
      void saveView(window.INTAKE_REPORT_API.updateDisplayLabel(state.viewConfig, id, value));
    };
    input.addEventListener('keydown', event => { if (event.key === 'Enter') finish(true); if (event.key === 'Escape') finish(false); });
    input.addEventListener('blur', () => finish(true));
  }

  async function refresh(forceRefresh) {
    if (state.loading) return;
    state.loading = true;
    setStatus(text('INTAKE verileri getiriliyor…', 'Loading INTAKE data…'), 'loading');
    render();
    try {
      const result = await requestJson('/api/intake/report', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ viewConfig: state.viewConfig, forceRefresh: Boolean(forceRefresh) }) });
      state.rows = Array.isArray(result.rows) ? result.rows : [];
      state.fields = Array.isArray(result.fields) && result.fields.length ? result.fields : state.fields;
      state.viewConfig = result.viewConfig || state.viewConfig;
      state.loaded = true;
      state.offline = Boolean(result.offline);
      state.error = '';
      setStatus(result.offline ? text('Canlı kaynak kullanılamıyor; son başarılı INTAKE snapshot gösteriliyor.', 'Live source is unavailable; showing the last successful INTAKE snapshot.') : (result.truncated ? text(`Özet görünüm ilk ${(result.rowLimit||state.rows.length).toLocaleString('tr-TR')} satırla sınırlandı. Filtre ekleyerek daraltın.`, `The aggregate view is limited to the first ${(result.rowLimit||state.rows.length).toLocaleString('en-GB')} rows. Narrow it with filters.`) : (result.fromCache ? text('INTAKE önbellekten gösteriliyor.', 'INTAKE is shown from cache.') : '')), result.offline || result.truncated ? 'warning' : 'ok');
      setMeta(`${state.rows.length.toLocaleString(isEnglish() ? 'en-GB' : 'tr-TR')} ${text('satır', 'rows')} · ${result.fetchedAt ? new Date(result.fetchedAt).toLocaleString(isEnglish() ? 'en-GB' : 'tr-TR') : ''}`);
      render();
    } catch (error) {
      state.error = error.message || String(error);
      setStatus(state.error, 'error');
      render();
    } finally {
      state.loading = false;
      render();
    }
  }

  async function loadState() {
    try {
      const result = await requestJson('/api/intake/state');
      state.fields = Array.isArray(result.fields) ? result.fields : [];
      state.viewConfig = result.viewConfig || state.viewConfig;
      if (result.snapshot) {
        state.rows = Array.isArray(result.snapshot.rows) ? result.snapshot.rows : [];
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
    state.metadataPromise = (async () => {
      try {
        const result = await requestJson('/api/intake/metadata');
        if (Array.isArray(result.fields) && result.fields.length) state.fields = result.fields;
        if (result.viewConfig) state.viewConfig = result.viewConfig;
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

  function bind() {
    byId('intakeConnectionBtn')?.addEventListener('click', () => {
      if (typeof openDataSourceAndFilters === 'function') openDataSourceAndFilters({ target: 'intake' });
    });
    byId('intakeFieldsBtn')?.addEventListener('click', () => { void loadMetadata().finally(openFields); });
    byId('intakeResetBtn')?.addEventListener('click', async () => {
      try {
        const result = await requestJson('/api/intake/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reset: true }) });
        state.viewConfig = result.viewConfig || state.viewConfig;
        state.rows = [];
        state.loaded = false;
        render();
        setStatus(text('Varsayılan INTAKE görünümü geri yüklendi. Yenile ile veriyi çekin.', 'Default INTAKE view restored. Refresh to query data.'), 'ok');
      } catch (error) { setStatus(error.message || String(error), 'error'); }
    });
    byId('intakeRefreshBtn')?.addEventListener('click', () => void refresh(true));
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
        void saveView(next).then(() => refresh(false));
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
    document.addEventListener('click', event => { if (state.popover && !state.popover.contains(event.target) && !event.target.closest('[data-intake-filter],[data-intake-add-filter]')) closePopover(); });
    document.addEventListener('keydown', event => { if (event.key === 'Escape') closePopover(); });
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
