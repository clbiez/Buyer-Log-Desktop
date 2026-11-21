(function () {
  'use strict';

  /* FOB SONRASI MALİYET — Genel Bakış › Ticari widget'ı.
     Veri sözleşmesi sunucudadır (server/lib/postfob-report.js); hesaplar
     public/postfob-analysis.js içindedir. Bu dosya yalnız görünüm durumu
     (filtre, gruplama, kapsam, sıralama) ve çizimden sorumludur.
     Widget görünür olmadan sunucuya istek atılmaz; canlı model sorgusu
     yalnız kullanıcı Yenile'ye bastığında çalışır. */
  const section = document.getElementById('postFobSection');
  if (!section || window.BLPostFob) return;
  const analysis = window.BLPostFobAnalysis;

  const MAX_GROUP_ROWS = 500;
  const state = {
    catalog: { dimensions: [], measures: [], groupKeys: [], segments: [] },
    view: { version: 1, filterValues: {}, groupBy: 'originCountry', segment: 'all', outliersOnly: false, sort: { key: 'qty', dir: -1 } },
    rows: [], fetchedAt: '', missing: [], truncated: false, rowLimit: 10000,
    connection: null, loaded: false, loading: false, started: false,
    status: null, popover: null, viewRevision: 0,
  };

  const byId = id => document.getElementById(id);
  const isEnglish = () => typeof appLang !== 'undefined' && appLang === 'en';
  const text = (tr, en) => isEnglish() ? en : tr;
  const clean = value => String(value == null ? '' : value).trim();
  const esc = value => clean(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  const locale = () => isEnglish() ? 'en-US' : 'tr-TR';
  const missingLabels = () => state.missing.map(key => { const item = [...state.catalog.dimensions, ...state.catalog.measures].find(entry => entry.key === key); return item ? text(item.tr, item.en) : key; }).join(', ');
  const dimLabel = key => { const item = state.catalog.dimensions.find(entry => entry.key === key); return item ? text(item.tr, item.en) : key; };

  const ERROR_COPY = {
    POSTFOB_SEASON_REQUIRED: ['Sorgu için en az bir sezon seçin.', 'Select at least one season to query.'],
    POSTFOB_SOURCE_UNAVAILABLE: ['FOB sonrası maliyet modeline şu anda ulaşılamıyor. Şirket ağı veya VPN bağlantısını kontrol edin.', 'The post-FOB cost model is unreachable right now. Check the company network or VPN connection.'],
    POSTFOB_SCHEMA_MISMATCH: ['Model beklenen FOB/adet alanlarını içermiyor; bağlantının kataloğunu kontrol edin.', 'The model does not contain the expected FOB/quantity fields; check the connection catalog.'],
    POSTFOB_FILTER_UNAVAILABLE: ['Seçilen filtre alanı canlı modelde bulunamadı.', 'The selected filter field was not found in the live model.'],
    POSTFOB_FILTER_VALUE_TYPE: ['Filtre değeri alanın tipiyle uyuşmuyor; filtreyi yeniden seçin.', 'A filter value does not match the field type; select the filter again.'],
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

  function setStatus(copy, kind) {
    state.status = copy ? { copy, kind } : null;
    paintStatus();
  }
  function paintStatus() {
    const node = byId('postFobStatus');
    if (!node) return;
    const current = state.status;
    node.hidden = !current;
    node.className = `intakeStatus${current && current.kind ? ` ${current.kind}` : ''}`;
    node.textContent = current ? (typeof current.copy === 'function' ? current.copy() : current.copy) : '';
  }

  /* ---------- Biçimlendirme ---------- */
  const fmt = (value, digits) => value == null || !Number.isFinite(value) ? '—' : value.toLocaleString(locale(), { minimumFractionDigits: digits, maximumFractionDigits: digits });
  const fmtQty = value => value == null ? '—' : Math.round(value).toLocaleString(locale());
  const fmtRatio = value => value == null ? '—' : `${fmt(value, 3)}×`;
  const fmtPct = value => value == null ? '—' : `${value > 0 ? '+' : ''}${fmt(value * 100, 1)}%`;

  const COLUMNS = [
    { key: 'qty', tr: 'Adet', en: 'Qty', format: fmtQty },
    { key: 'orders', tr: 'Sipariş', en: 'Orders', format: fmtQty },
    { key: 'fob', tr: 'FOB USD', en: 'FOB USD', format: value => fmt(value, 2) },
    { key: 'landedActual', tr: 'Landed USD', en: 'Landed USD', format: value => fmt(value, 2) },
    { key: 'postFob', tr: 'FOB sonrası USD', en: 'Post-FOB USD', format: value => fmt(value, 2), hint: ['Adet ağırlıklı (Landed − FOB)', 'Quantity-weighted (Landed − FOB)'] },
    { key: 'landedToFob', tr: 'Landed/FOB', en: 'Landed/FOB', format: fmtRatio, hint: ['Σ(adet×landed) / Σ(adet×FOB)', 'Σ(qty×landed) / Σ(qty×FOB)'] },
    { key: 'integralLast', tr: 'Integral son USD', en: 'Integral final USD', format: value => fmt(value, 2) },
    { key: 'integralToFob', tr: 'Integral/FOB', en: 'Integral/FOB', format: fmtRatio },
    { key: 'forecastGap', tr: 'Öngörü sapması', en: 'Forecast gap', format: fmtPct, hint: ['(Gerçekleşen − öngörü) / öngörü landed', '(Actual − forecast) / forecast landed'] },
    { key: 'customsRate', tr: 'Gümrük', en: 'Customs', format: value => fmt(value, 3) },
    { key: 'freightRate', tr: 'Navlun', en: 'Freight', format: value => fmt(value, 3) },
    { key: 'extraRate', tr: 'Ek maliyet', en: 'Extra cost', format: value => fmt(value, 3) },
  ];

  /* ---------- Çizim ---------- */
  function renderMeta() {
    const node = byId('postFobStateMeta');
    if (!node) return;
    const parts = [];
    if (state.fetchedAt) {
      const date = new Date(state.fetchedAt);
      if (!Number.isNaN(date.getTime())) parts.push(`${text('Son yenileme', 'Last refresh')}: ${date.toLocaleString(locale(), { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}`);
      parts.push(`${state.rows.length.toLocaleString(locale())} ${text('satır', 'rows')}`);
    }
    if (state.connection && state.connection.catalog) parts.push(state.connection.catalog);
    node.textContent = parts.join(' · ');
  }

  function renderControls() {
    const group = byId('postFobGroupBy');
    if (group) {
      const keys = state.catalog.groupKeys.length ? state.catalog.groupKeys : ['originCountry'];
      group.innerHTML = keys.map(key => `<option value="${esc(key)}"${state.view.groupBy === key ? ' selected' : ''}>${esc(dimLabel(key))}</option>`).join('');
    }
    const segment = byId('postFobSegment');
    if (segment) {
      const labels = { all: text('Tüm üretim', 'All production'), import: text('İthal', 'Import'), domestic: text('Yerli', 'Domestic') };
      segment.innerHTML = ['all', 'import', 'domestic'].map(key => `<option value="${key}"${state.view.segment === key ? ' selected' : ''}>${esc(labels[key])}</option>`).join('');
    }
    const outliers = byId('postFobOutliersOnly');
    if (outliers) outliers.checked = Boolean(state.view.outliersOnly);
  }

  function renderFilters() {
    const bar = byId('postFobFilterBar');
    if (!bar) return;
    const filters = state.catalog.dimensions.filter(item => item.filter);
    bar.innerHTML = filters.map(item => {
      const selected = state.view.filterValues[item.key] || [];
      const label = selected.length > 1 ? `${selected.length} ${text('seçim', 'selected')}` : (selected[0] || text('Tümü', 'All'));
      const required = item.required ? ` <span class="postFobRequired">${esc(text('(zorunlu)', '(required)'))}</span>` : '';
      return `<div class="intakeFilterField"><span class="intakeFilterLabel">${esc(text(item.tr, item.en))}${required}</span><div class="intakeFilterControl"><button type="button" class="oabMultiTrigger intakeFilterTrigger" data-postfob-filter="${esc(item.key)}" aria-haspopup="listbox" aria-expanded="false"><span class="oabMultiLabel${selected.length ? ' hasValue' : ''}">${esc(label)}</span><span class="oabMultiChevron" aria-hidden="true">▾</span></button>${selected.length ? `<button type="button" class="intakeFilterRemove" data-postfob-filter-remove="${esc(item.key)}" title="${esc(text('Filtreyi temizle', 'Clear filter'))}" aria-label="${esc(text('Filtreyi temizle', 'Clear filter'))}">×</button>` : ''}</div></div>`;
    }).join('');
    const button = byId('postFobFiltersBtn');
    if (button) button.classList.toggle('hasActiveFilters', Object.keys(state.view.filterValues).length > 0);
  }

  function kpi(value, label, title) {
    return `<div class="kpi postFobKpi"${title ? ` title="${esc(title)}"` : ''}><span class="n">${esc(value)}</span><span class="l">${esc(label)}</span></div>`;
  }

  function renderBody() {
    const body = byId('postFobBody'), table = byId('postFobTable'), kpis = byId('postFobKpis');
    if (!body || !table || !kpis) return;
    if (!state.rows.length) {
      body.hidden = false;
      kpis.innerHTML = '';
      const message = state.loaded
        ? text('Seçili filtrelerde satır yok. Filtreleri genişletip Yenile’ye basın.', 'No rows for the selected filters. Widen the filters and press Refresh.')
        : text('Filtrelerden en az bir sezon seçip Yenile’ye basın. Sorgu FiyatMaliyetKontrolRapor modeline sizin Windows kimliğinizle gider.', 'Select at least one season in the filters and press Refresh. The query runs against the FiyatMaliyetKontrolRapor model with your Windows identity.');
      table.innerHTML = `<tbody><tr><td class="intakeEmpty">${esc(message)}</td></tr></tbody>`;
      return;
    }
    const result = analysis.analyze(state.rows, state.view);
    const total = result.total;
    const segments = result.segments;
    kpis.innerHTML = [
      kpi(fmtQty(total.qty), text('Net adet', 'Net quantity')),
      kpi(fmt(total.fob, 2), text('Ağırlıklı FOB USD', 'Weighted FOB USD')),
      kpi(fmt(total.postFob, 2), text('FOB sonrası USD / adet', 'Post-FOB USD / unit')),
      kpi(fmtRatio(total.landedToFob), text('Landed / FOB', 'Landed / FOB')),
      kpi(fmtRatio(total.integralToFob), text('Integral / FOB', 'Integral / FOB')),
      kpi(fmtPct(total.forecastGap), text('Landed öngörü sapması', 'Landed forecast gap')),
      kpi(result.bounds ? `${result.outlierCount}` : '—', text('Aykırı satır', 'Outlier rows'),
        result.bounds ? text(`Landed/FOB > ${fmt(result.bounds.upper, 3)} veya < ${fmt(result.bounds.lower, 3)} (Q3 + 1,5×IQR)`, `Landed/FOB > ${fmt(result.bounds.upper, 3)} or < ${fmt(result.bounds.lower, 3)} (Q3 + 1.5×IQR)`) : text('Aykırı sınırı için en az 8 satır gerekir.', 'At least 8 rows are needed for an outlier bound.')),
      kpi(`${segments.import} / ${segments.domestic}`, text('İthal / yerli satır', 'Import / domestic rows')),
    ].join('');
    const sort = state.view.sort || { key: 'qty', dir: -1 };
    const arrow = key => sort.key === key ? (sort.dir === 1 ? ' ▲' : ' ▼') : '';
    const head = `<thead><tr><th data-postfob-sort="label">${esc(dimLabel(state.view.groupBy))}${arrow('label')}</th>${COLUMNS.map(column => `<th class="num" data-postfob-sort="${column.key}"${column.hint ? ` title="${esc(text(column.hint[0], column.hint[1]))}"` : ''}>${esc(text(column.tr, column.en))}${arrow(column.key)}</th>`).join('')}<th class="num" data-postfob-sort="outliers">${esc(text('Aykırı', 'Outliers'))}${arrow('outliers')}</th></tr></thead>`;
    const groups = sort.key === 'outliers'
      ? [...result.groups].sort((a, b) => (sort.dir === 1 ? 1 : -1) * (a.outliers - b.outliers))
      : result.groups;
    const shown = groups.slice(0, MAX_GROUP_ROWS);
    const row = (label, metrics, outliers, cls) => `<tr${cls ? ` class="${cls}"` : ''}><td>${esc(label || text('(boş)', '(blank)'))}</td>${COLUMNS.map(column => `<td class="num">${esc(column.format(metrics[column.key]))}</td>`).join('')}<td class="num">${outliers ? esc(outliers) : '—'}</td></tr>`;
    const bodyRows = shown.map(group => row(group.label, group.metrics, group.outliers, group.outliers ? 'postFobHasOutlier' : '')).join('');
    const foot = `<tfoot><tr class="postFobTotal"><td>${esc(text('Toplam', 'Total'))}</td>${COLUMNS.map(column => `<td class="num">${esc(column.format(total[column.key]))}</td>`).join('')}<td class="num">${result.bounds ? esc(result.outlierCount) : '—'}</td></tr></tfoot>`;
    table.innerHTML = `${head}<tbody>${bodyRows}</tbody>${foot}`;
    body.hidden = false;
    const notes = [];
    if (groups.length > shown.length) notes.push(text(`İlk ${MAX_GROUP_ROWS} grup gösteriliyor (${groups.length} grup).`, `Showing the first ${MAX_GROUP_ROWS} groups (${groups.length} groups).`));
    if (state.truncated) notes.push(text(`Sorgu ${state.rowLimit.toLocaleString(locale())} satır sınırına ulaştı; toplamlar eksik olabilir. Filtreleri daraltın.`, `The query hit the ${state.rowLimit.toLocaleString(locale())} row limit; totals may be incomplete. Narrow the filters.`));
    if (total.landedCoverage != null && total.landedCoverage < 0.95) notes.push(text(`Landed değeri adetin %${fmt(total.landedCoverage * 100, 0)} kısmında var; oranlar yalnız bu kısımdan hesaplandı.`, `Landed is available for ${fmt(total.landedCoverage * 100, 0)}% of the quantity; ratios use only that part.`));
    const note = byId('postFobNote');
    if (note) { note.hidden = !notes.length; note.textContent = notes.join(' '); }
  }

  function render() {
    renderMeta();
    renderControls();
    renderFilters();
    renderBody();
    paintStatus();
    const refresh = byId('postFobRefreshBtn');
    if (refresh) { refresh.disabled = state.loading; refresh.setAttribute('aria-busy', state.loading ? 'true' : 'false'); }
    byId('postFobBody')?.classList.toggle('isBusy', state.loading);
  }

  function applyPayload(payload) {
    state.rows = Array.isArray(payload && payload.rows) ? payload.rows : [];
    state.fetchedAt = clean(payload && payload.fetchedAt);
    state.missing = Array.isArray(payload && payload.missing) ? payload.missing : [];
    state.truncated = Boolean(payload && payload.truncated);
    state.rowLimit = Number(payload && payload.rowLimit) || state.rowLimit;
  }

  /* ---------- Veri ---------- */
  async function loadState() {
    try {
      const payload = await requestJson('/api/postfob/state');
      state.catalog = payload.catalog || state.catalog;
      state.view = payload.view || state.view;
      state.connection = payload.connection || null;
      if (payload.snapshot) { applyPayload(payload.snapshot); state.loaded = true; }
      setStatus(null);
    } catch (error) {
      setStatus(error.message || String(error), 'error');
    }
    render();
  }

  let saveTimer = 0;
  function saveView() {
    state.viewRevision += 1;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      void requestJson('/api/postfob/view', jsonBody('PUT', { view: state.view })).catch(error => setStatus(error.message || String(error), 'error'));
    }, 300);
  }

  async function refresh(force) {
    if (state.loading) return;
    if (!(state.view.filterValues.season || []).length) {
      setStatus(() => text('Sorgu için en az bir sezon seçin.', 'Select at least one season to query.'), 'warning');
      setFilterPanelOpen(true);
      return;
    }
    state.loading = true;
    setStatus(() => text('FOB sonrası maliyet modeli sorgulanıyor…', 'Querying the post-FOB cost model…'), 'loading');
    render();
    try {
      const payload = await requestJson('/api/postfob/report', jsonBody('POST', { view: state.view, forceRefresh: Boolean(force) }));
      applyPayload(payload);
      state.loaded = true;
      if (payload.offline) setStatus(() => text('Model şu anda erişilemiyor; son kayıtlı sonuç gösteriliyor.', 'The model is unreachable; showing the last saved result.'), 'warning');
      else if (state.missing.length) setStatus(() => text(`Modelde bulunmayan alanlar boş gösterildi: ${missingLabels()}.`, `Fields missing from the model are shown blank: ${missingLabels()}.`), 'warning');
      else setStatus(payload.fromCache ? () => text('Son 30 dakikadaki aynı sorgunun sonucu gösteriliyor.', 'Showing the result of the same query from the last 30 minutes.') : null, payload.fromCache ? 'ok' : '');
    } catch (error) {
      setStatus(error.message || String(error), 'error');
    } finally {
      state.loading = false;
      render();
    }
  }

  /* ---------- Filtre paneli ve değer seçici ---------- */
  function setFilterPanelOpen(open) {
    const panel = byId('postFobFilterPanel'), button = byId('postFobFiltersBtn');
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
    section.querySelectorAll('[data-postfob-filter][aria-expanded="true"]').forEach(button => button.setAttribute('aria-expanded', 'false'));
  }
  function localValues(key) {
    return [...new Set(state.rows.map(row => clean(row && row[key])).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'tr', { numeric: true }));
  }
  function openFilter(button, key) {
    closePopover();
    const item = state.catalog.dimensions.find(entry => entry.key === key);
    if (!item) return;
    const selected = new Set(state.view.filterValues[key] || []);
    let values = [...new Set([...localValues(key), ...selected])];
    const popover = document.createElement('div');
    popover.className = 'oabLocalFilterAddPopover intakeFilterPopover';
    popover.setAttribute('role', 'dialog');
    popover.setAttribute('aria-label', text(item.tr, item.en));
    popover.innerHTML = `<div class="intakeFilterPopoverTitle">${esc(text(item.tr, item.en))}</div><input type="search" class="intakeFilterSearch" placeholder="${esc(text('Değerlerde ara…', 'Search values…'))}" aria-label="${esc(text('Değerlerde ara', 'Search values'))}"><div class="intakeFilterValues"><div class="intakeConfigEmpty">${esc(text('Değerler yükleniyor…', 'Loading values…'))}</div></div><div class="intakeFilterActions"><button type="button" class="tbtn" data-postfob-clear>${esc(text('Temizle', 'Clear'))}</button><button type="button" class="tbtn primary" data-postfob-apply>${esc(text('Uygula', 'Apply'))}</button></div>`;
    document.body.appendChild(popover);
    state.popover = popover;
    button.setAttribute('aria-expanded', 'true');
    const rect = button.getBoundingClientRect();
    popover.style.left = `${Math.max(8, Math.min(innerWidth - popover.offsetWidth - 8, rect.left))}px`;
    popover.style.top = `${Math.max(8, Math.min(innerHeight - popover.offsetHeight - 8, rect.bottom + 4))}px`;
    window.BLMotionPlus?.play?.('overlay', popover);
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
    popover.querySelector('[data-postfob-clear]').addEventListener('click', () => { selected.clear(); draw(); });
    popover.querySelector('[data-postfob-apply]').addEventListener('click', () => {
      const next = { ...state.view.filterValues };
      if (selected.size) next[key] = [...selected].slice(0, 500); else delete next[key];
      state.view = { ...state.view, filterValues: next };
      closePopover();
      saveView();
      render();
      setStatus(() => text('Filtre değişti. Veriyi çekmek için Yenile’ye basın.', 'Filters changed. Press Refresh to query data.'), 'ok');
    });
    search.focus();
    void requestJson('/api/postfob/distinct', jsonBody('POST', { key, limit: 1000 }))
      .then(result => { values = [...new Set([...(Array.isArray(result.values) ? result.values : []), ...selected])]; if (state.popover === popover) draw(); })
      .catch(error => {
        if (state.popover !== popover) return;
        if (values.length) { draw(); return; }
        list.innerHTML = `<div class="intakeConfigEmpty">${esc(error.message || text('Değerler alınamadı.', 'Values could not be loaded.'))}</div>`;
      });
  }

  /* ---------- Olaylar ---------- */
  function bind() {
    new MutationObserver(render).observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });
    byId('postFobRefreshBtn')?.addEventListener('click', () => void refresh(true));
    byId('postFobFiltersBtn')?.addEventListener('click', event => {
      event.stopPropagation();
      const panel = byId('postFobFilterPanel');
      setFilterPanelOpen(Boolean(panel && panel.hidden));
    });
    byId('postFobGroupBy')?.addEventListener('change', event => { state.view = { ...state.view, groupBy: event.target.value }; saveView(); renderBody(); });
    byId('postFobSegment')?.addEventListener('change', event => { state.view = { ...state.view, segment: event.target.value }; saveView(); renderBody(); });
    byId('postFobOutliersOnly')?.addEventListener('change', event => { state.view = { ...state.view, outliersOnly: event.target.checked }; saveView(); renderBody(); });
    byId('postFobFilterBar')?.addEventListener('click', event => {
      const remove = event.target.closest('[data-postfob-filter-remove]');
      if (remove) {
        const next = { ...state.view.filterValues };
        delete next[remove.dataset.postfobFilterRemove];
        state.view = { ...state.view, filterValues: next };
        saveView();
        render();
        return;
      }
      const trigger = event.target.closest('[data-postfob-filter]');
      if (trigger) openFilter(trigger, trigger.dataset.postfobFilter);
    });
    byId('postFobTable')?.addEventListener('click', event => {
      const header = event.target.closest('[data-postfob-sort]');
      if (!header) return;
      const key = header.dataset.postfobSort;
      const current = state.view.sort || {};
      state.view = { ...state.view, sort: { key, dir: current.key === key ? -Number(current.dir || -1) : (key === 'label' ? 1 : -1) } };
      saveView();
      renderBody();
    });
    document.addEventListener('click', event => {
      if (state.popover && !state.popover.contains(event.target) && !event.target.closest('[data-postfob-filter]')) closePopover();
      const panel = byId('postFobFilterPanel');
      if (panel && !panel.hidden && !panel.contains(event.target) && !event.target.closest('#postFobFiltersBtn,#postFobRefreshBtn,.intakeFilterPopover')) setFilterPanelOpen(false);
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
  window.BLPostFob = Object.freeze({ state, refresh: () => refresh(true), reload: loadState });
})();
