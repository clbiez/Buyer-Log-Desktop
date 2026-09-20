(function () {
  'use strict';

  /* INTAKE UI: the data contract is deliberately small.  Source identities
     come from the server and the browser only owns view state (order, label,
     widths, sort and selected filter values). */
  const section = document.getElementById('intakeSection');
  if (!section) return;

  const state = {
    fields: [],
    viewConfig: { version: 1, query: { rows: [], columns: [], measures: [], filters: [], filterValues: {} }, display: { labels: {}, widths: {}, sort: { id: '', dir: 1 }, collapsed: [] } },
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
  const display = () => state.viewConfig && state.viewConfig.display || { labels: {}, widths: {}, sort: { id: '', dir: 1 } };
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

  function renderTable() {
    const body = byId('intakeBody');
    const table = byId('intakeTable');
    if (!body || !table) return;
    body.hidden = false;
    const fields = activeColumns();
    if (!fields.length) {
      table.innerHTML = `<tbody><tr><td class="intakeEmpty" colspan="1">${esc(text('Alan seçilmedi.', 'No fields selected.'))}</td></tr></tbody>`;
      return;
    }
    const sorted = state.rows.slice();
    const sort = display().sort || {};
    if (sort.id) {
      const direction = Number(sort.dir) === -1 ? -1 : 1;
      sorted.sort((left, right) => String(left && left[sort.id] == null ? '' : left && left[sort.id]).localeCompare(String(right && right[sort.id] == null ? '' : right && right[sort.id]), isEnglish() ? 'en' : 'tr', { numeric: true, sensitivity: 'base' }) * direction);
    }
    const header = fields.map(field => {
      const direction = sort.id === field.id ? (sort.dir === -1 ? ' ↓' : ' ↑') : '';
      // Genişlik artık <colgroup> üzerinden verilir (bkz. attachColumnResize).
      return `<th data-intake-sort="${esc(field.id)}" data-intake-rename="${esc(field.id)}" title="${esc(text('Sıralamak için tıklayın · yeniden adlandırmak için çift tıklayın', 'Click to sort · double-click to rename'))}">${esc(fieldLabel(field))}${direction}</th>`;
    }).join('');
    const rows = sorted.map(row => `<tr>${fields.map(field => `<td class="${field.fieldType === 'measure' ? 'num' : ''}">${esc(field.fieldType === 'measure' ? numberText(row && row[field.id]) : clean(row && row[field.id]))}</td>`).join('')}</tr>`).join('');
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

  function axisEditorHtml(axis, config) {
    const fields = copyAxis(config, axis);
    const pool = availableFor(axis, config);
    const title = isEnglish() ? axisNamesEn[axis] : axisNames[axis];
    const options = pool.map(field => `<option value="${esc(field.id)}">${esc(fieldLabel(field))}</option>`).join('');
    const items = fields.map((field, index) => `<div class="intakeConfigRow" draggable="true" data-intake-axis="${esc(axis)}" data-intake-index="${index}"><span class="intakeDrag" aria-hidden="true">⋮⋮</span><span class="intakeConfigName">${esc(fieldLabel(field))}<small>${esc(field.sourceUniqueName || '')}</small></span><button type="button" class="navActionBtn intakeConfigMove" data-intake-move="-1"${index === 0 ? ' disabled' : ''} aria-label="${esc(text('Yukarı taşı', 'Move up'))}">↑</button><button type="button" class="navActionBtn intakeConfigMove" data-intake-move="1"${index === fields.length - 1 ? ' disabled' : ''} aria-label="${esc(text('Aşağı taşı', 'Move down'))}">↓</button><button type="button" class="navActionBtn intakeConfigRemove" data-intake-remove="1" aria-label="${esc(text('Kaldır', 'Remove'))}">×</button></div>`).join('');
    return `<div class="intakeConfigSection" data-intake-config-section="${esc(axis)}"><div class="intakeConfigHead"><h4>${esc(title)}</h4><span>${fields.length}</span></div><div class="intakeConfigList">${items || `<p class="intakeConfigEmpty">${esc(text('Henüz alan seçilmedi.', 'No fields selected yet.'))}</p>`}</div><div class="intakeConfigAdd"><select data-intake-add-select aria-label="${esc(text(`${title} alanı ekle`, `Add ${title.toLowerCase()} field`))}><option value="">${esc(text('Alan seç…', 'Select a field…'))}</option>${options}</select><button type="button" class="navActionBtn" data-intake-add="${esc(axis)}">+ ${esc(text('Ekle', 'Add'))}</button></div></div>`;
  }

  function openFields() {
    if (state.metadataLoading) return;
    const modal = document.createElement('div');
    modal.className = 'autoModalOverlay';
    modal.id = '_intakeFieldsModal';
    const draft = clone(state.viewConfig);
    modal.innerHTML = `<div class="autoModal intakeFieldsModal" role="dialog" aria-modal="true" aria-labelledby="_intakeFieldsTitle"><header><h3 id="_intakeFieldsTitle">${esc(text('INTAKE Ayarları', 'INTAKE Settings'))}</h3><button type="button" data-intake-close aria-label="${esc(text('Kapat', 'Close'))}">×</button></header><div class="autoModalBody"><p class="intakeModalHint">${esc(text('INTAKE veritabanı alanlarını Pivot Satırları, Pivot Sütunları, Pivot Ölçüleri ve Filtreler arasında ekleyip çıkarabilir; sıralamayı sürükleyerek veya oklarla değiştirebilirsiniz. Kaynak kimlikleri sabit kalır, görünen başlıklar ayrı saklanır.', 'Add or remove INTAKE database fields from Pivot Rows, Pivot Columns, Pivot Measures and Filters. Reorder them by dragging or using the arrows. Source identities remain stable and visible labels are stored separately.'))}</p><div class="intakeSettingsLegend"><span>${esc(text('Alanlar canlı INTAKE şemasından gelir.', 'Fields come from the live INTAKE schema.'))}</span><span>${esc(text('Ölçüler ayrı tutulur; sorgu aggregate’ı model belirler.', 'Measures stay separate; aggregation is defined by the model.'))}</span></div><div id="intakeConfigSections"></div></div><footer><button type="button" class="tbtn" data-intake-close>${esc(text('Vazgeç', 'Cancel'))}</button><button type="button" class="tbtn primary" data-intake-save>${esc(text('Kaydet', 'Save'))}</button></footer></div>`;
    document.body.appendChild(modal);

    const close = () => modal.remove();
    modal.querySelectorAll('[data-intake-close]').forEach(button => button.addEventListener('click', close));
    modal.addEventListener('pointerdown', event => { modal.dataset.backdropDown = event.target === modal ? '1' : '0'; });
    modal.addEventListener('pointerup', event => { if (event.target === modal && modal.dataset.backdropDown === '1') close(); modal.dataset.backdropDown = '0'; });

    const draw = () => { byId('intakeConfigSections').innerHTML = ['rows', 'columns', 'measures', 'filters'].map(axis => axisEditorHtml(axis, draft)).join(''); };
    const move = (axis, index, direction) => {
      const values = copyAxis(draft, axis), target = index + direction;
      if (target < 0 || target >= values.length) return;
      [values[index], values[target]] = [values[target], values[index]];
      draft.query[axis] = values;
      draw();
    };
    draw();
    modal.addEventListener('click', event => {
      const add = event.target.closest('[data-intake-add]');
      if (add) {
        const axis = add.dataset.intakeAdd;
        const select = add.closest('.intakeConfigAdd')?.querySelector('[data-intake-add-select]');
        const field = allFields().find(item => item.id === select?.value);
        if (!field) return;
        draft.query[axis] = [...copyAxis(draft, axis), clone(field)];
        select.value = '';
        draw();
        return;
      }
      const remove = event.target.closest('[data-intake-remove]');
      if (remove) {
        const row = remove.closest('[data-intake-axis]');
        const axis = row?.dataset.intakeAxis;
        const index = Number(row?.dataset.intakeIndex);
        if (!axis || !Number.isInteger(index)) return;
        draft.query[axis] = copyAxis(draft, axis).filter((_, itemIndex) => itemIndex !== index);
        draw();
        return;
      }
      const moveButton = event.target.closest('[data-intake-move]');
      if (moveButton) {
        const row = moveButton.closest('[data-intake-axis]');
        move(row?.dataset.intakeAxis, Number(row?.dataset.intakeIndex), Number(moveButton.dataset.intakeMove));
      }
    });
    modal.addEventListener('dragstart', event => {
      const row = event.target.closest('[data-intake-axis]');
      if (!row) return;
      state.drag = { axis: row.dataset.intakeAxis, index: Number(row.dataset.intakeIndex) };
      event.dataTransfer?.setData('text/plain', `${state.drag.axis}:${state.drag.index}`);
    });
    modal.addEventListener('dragover', event => { if (event.target.closest('[data-intake-axis]')) event.preventDefault(); });
    modal.addEventListener('drop', event => {
      event.preventDefault();
      const target = event.target.closest('[data-intake-axis]');
      if (!target || !state.drag || target.dataset.intakeAxis !== state.drag.axis) return;
      const axis = state.drag.axis, values = copyAxis(draft, axis), from = state.drag.index, to = Number(target.dataset.intakeIndex);
      if (!Number.isInteger(from) || !Number.isInteger(to) || from === to) return;
      const [item] = values.splice(from, 1); values.splice(to, 0, item); draft.query[axis] = values; state.drag = null; draw();
    });
    modal.querySelector('[data-intake-save]').addEventListener('click', () => void saveView(draft, close));
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
