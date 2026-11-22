(function () {
  'use strict';

  /* FOB SONRASI MALİYET — Genel Bakış › Ticari widget'ı.
     Görünüm INTAKE/OAB pivotuyla aynı tablo sözleşmesini (oabPivot* sınıfları,
     alt/genel toplam, grup katlama, kalemle pivot düzenleme, + Filtre ekle)
     kullanır; INTAKE'in kodu paylaşılmaz, aynı sınıflar ve davranış paylaşılır.
     Veri sözleşmesi sunucudadır (server/lib/postfob-report.js); hesaplar
     public/postfob-analysis.js içindedir. Widget görünür olmadan sunucuya istek
     atılmaz; canlı model sorgusu yalnız Yenile veya sorguyu değiştiren pivot
     kaydında çalışır. Arama yalnız yüklü satırlarda yapılır, sorgu atmaz. */
  const section = document.getElementById('postFobSection');
  if (!section || window.BLPostFob) return;
  const analysis = window.BLPostFobAnalysis;

  const MAX_TABLE_ROWS = 1500;
  const state = {
    catalog: { dimensions: [], measures: [], values: [], defaults: null, aggregates: ['SUM', 'WAVG', 'AVG', 'MIN', 'MAX'] },
    view: null,
    rows: [], fetchedAt: '', missing: [], truncated: false, rowLimit: 10000,
    connection: null, horizon: false, horizonApplied: false, loaded: false, loading: false, started: false,
    status: null, popover: null, viewRevision: 0, exporting: false, metadata: null, metadataPromise: null, search: '',
  };

  const byId = id => document.getElementById(id);
  const isEnglish = () => typeof appLang !== 'undefined' && appLang === 'en';
  const text = (tr, en) => isEnglish() ? en : tr;
  const clean = value => String(value == null ? '' : value).trim();
  const esc = value => clean(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));
  const locale = () => isEnglish() ? 'en-GB' : 'tr-TR';
  const view = () => state.view || state.catalog.defaults || { rows: [{ key: 'originCountry' }], columns: [], values: [], filters: [], filterValues: {}, display: { grouped: true, showSubtotals: true, collapsedGroups: [], sort: { key: '', dir: -1 }, widths: {} }, segment: 'all', outliersOnly: false };
  const display = () => view().display || {};

  /* ---------- Alan etiketleri ---------- */
  const baseDim = key => state.catalog.dimensions.find(item => item.key === key);
  const baseValue = key => state.catalog.values.find(item => item.key === key);
  const refLabel = ref => {
    if (!ref) return '';
    if (ref.source) return clean(ref.label) || clean(ref.source);
    const item = baseDim(ref.key) || baseValue(ref.key);
    return item ? text(item.tr, item.en) : ref.key;
  };
  const missingLabels = () => state.missing.map(key => {
    const ref = [...view().rows, ...view().columns, ...view().values, ...view().filters].find(item => item.key === key);
    if (ref) return refLabel(ref);
    const measure = state.catalog.measures.find(item => item.key === key);
    return measure ? text(measure.tr, measure.en) : refLabel({ key });
  }).join(', ');

  const ERROR_COPY = {
    POSTFOB_SEASON_REQUIRED: ['Sorgu için en az bir sezon seçin veya Veri Yönetimi’nde ufuk tanımlayın.', 'Select at least one season or define a horizon in Data Management.'],
    POSTFOB_HORIZON_INVALID: ['Veri Yönetimi’ndeki FOB Sonrası Maliyet ufku uygulanamadı; filtreyi orada düzeltin.', 'The Post-FOB Cost horizon in Data Management could not be applied; fix the filter there.'],
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

  function setStatus(copy, kind) { state.status = copy ? { copy, kind } : null; paintStatus(); }
  function paintStatus() {
    const node = byId('postFobStatus');
    if (!node) return;
    const current = state.status;
    node.hidden = !current;
    node.className = `intakeStatus${current && current.kind ? ` ${current.kind}` : ''}`;
    node.textContent = current ? (typeof current.copy === 'function' ? current.copy() : current.copy) : '';
  }

  /* ---------- Biçimlendirme ---------- */
  const fmt = (value, digits) => value == null || !Number.isFinite(value) ? '' : value.toLocaleString(locale(), { minimumFractionDigits: digits, maximumFractionDigits: digits });
  const FORMATS = {
    qty: value => value == null ? '' : Math.round(value).toLocaleString(locale()),
    count: value => value == null ? '' : Math.round(value).toLocaleString(locale()),
    usd: value => fmt(value, 2),
    ratio: value => value == null ? '' : `${fmt(value, 3)}×`,
    pct: value => value == null ? '' : `${value > 0 ? '+' : ''}${fmt(value * 100, 1)}%`,
    rate: value => fmt(value, 3),
    extra: value => value == null ? '' : value.toLocaleString(locale(), { maximumFractionDigits: 2 }),
  };
  const valueFormat = ref => ref.source ? FORMATS.extra : (FORMATS[(baseValue(ref.key) || {}).format] || FORMATS.extra);
  const VALUE_HINTS = {
    postFob: ['Adet ağırlıklı (Landed − FOB)', 'Quantity-weighted (Landed − FOB)'],
    landedActual: ['Net sipariş adedine göre ağırlıklı ortalama. Küpün kendi landed toplamı teslim edilen adede göre ağırlıklı olabilir; satır değerleri küpten birebir gelir.', 'Average weighted by net order quantity. The cube’s own landed total may be weighted by delivered quantity; row values come straight from the cube.'],
    landedToFob: ['Σ(adet×landed) / Σ(adet×FOB)', 'Σ(qty×landed) / Σ(qty×FOB)'],
    integralToFob: ['Σ(adet×Integral son) / Σ(adet×FOB)', 'Σ(qty×Integral final) / Σ(qty×FOB)'],
    forecastGap: ['(Gerçekleşen − öngörü) / öngörü landed', '(Actual − forecast) / forecast landed'],
    outliers: ['Landed/FOB oranı Q3 + 1,5×IQR dışında kalan satır sayısı', 'Rows with Landed/FOB outside Q3 + 1.5×IQR'],
  };

  /* ---------- Hesaplanan değerler (public/pivot-calculated-values.js) ----------
     Tanım yoksa değerlendirici null'dır ve pivot sıcak yolu değişmez. Kaynak
     satır sipariş × renk düzeyindedir; satır bazlı mod burada anlamlıdır.
     Bütün hazır ölçüler her sorguda gelir; tanım sorguyu değiştirmez. */
  const PCV = () => window.BLPivotCalculatedValues || null;
  const calcDefs = () => (PCV() && Array.isArray(view().calculated) ? view().calculated : []);
  let calcCache = { signature: '', evaluator: null };
  let activeCalc = null;
  let calcEnginePending = false;
  function calcEvaluator() {
    const defs = calcDefs();
    if (!defs.length) return null;
    const signature = `${window.BLFormulaEngine ? 1 : 0}|${isEnglish() ? 'en' : 'tr'}|${JSON.stringify(defs)}`;
    if (calcCache.signature !== signature) {
      calcCache = { signature, evaluator: PCV().createEvaluator(defs, { isTextKey: key => Boolean(baseDim(key)), label: key => detailLabel(key) }) };
    }
    if (!window.BLFormulaEngine && !calcEnginePending) {
      calcEnginePending = true;
      PCV().ensureEngine(false).then(ok => { calcEnginePending = false; if (ok) renderBody(); });
    }
    return calcCache.evaluator;
  }
  const withCalc = (metrics, rows) => (activeCalc ? activeCalc.apply(metrics, rows) : metrics);
  const calcHeadKey = def => `pcv-${def.id}`;
  function calcCellHtml(item, def) {
    if (item.kind === 'group' && !item.subtotal) return '<td class="num"></td>';
    const cell = PCV().cell(item.metrics, def);
    return `<td class="num pcvCell${cell.error ? ' pcvError' : ''}" title="${esc(cell.title)}">${esc(cell.text)}</td>`;
  }

  /* ---------- Pivot hesabı (INTAKE intakeDisplayRows ile aynı yapı) ---------- */
  const extraValues = () => view().values.filter(ref => ref.source).map(ref => ({ key: ref.key, agg: ref.agg }));
  const groupKeyOf = path => JSON.stringify(path.map(clean));
  function sortSiblings(groups, level) {
    const sort = display().sort || {};
    const dir = Number(sort.dir) === 1 ? 1 : -1;
    const dims = [...view().rows, ...view().columns];
    if (!sort.key) return groups.sort((a, b) => String(a.value).localeCompare(String(b.value), 'tr', { numeric: true, sensitivity: 'base' }));
    if (dims.some(ref => ref.key === sort.key)) {
      if (dims[level] && dims[level].key !== sort.key) return groups.sort((a, b) => String(a.value).localeCompare(String(b.value), 'tr', { numeric: true, sensitivity: 'base' }));
      return groups.sort((a, b) => dir * String(a.value).localeCompare(String(b.value), 'tr', { numeric: true, sensitivity: 'base' }));
    }
    return groups.sort((a, b) => {
      const left = a.metrics[sort.key], right = b.metrics[sort.key];
      if (left == null && right == null) return 0;
      if (left == null) return 1;
      if (right == null) return -1;
      return dir * (left - right);
    });
  }
  function bucket(rows, key, bounds, extras) {
    const map = new Map();
    for (const row of rows) {
      const value = clean(row && row[key]);
      if (!map.has(value)) map.set(value, []);
      map.get(value).push(row);
    }
    return [...map.entries()].map(([value, list]) => ({ value, rows: list, metrics: withCalc(analysis.groupMetrics(list, bounds, extras), list) }));
  }
  function displayRows(prepared) {
    activeCalc = calcEvaluator();
    const rowRefs = view().rows, colRefs = view().columns;
    const dims = [...rowRefs, ...colRefs];
    const extras = extraValues();
    const bounds = prepared.bounds;
    const collapsed = new Set(display().collapsedGroups || []);
    const showSubtotals = display().showSubtotals !== false;
    const grouped = display().grouped !== false && rowRefs.length > 0;
    const out = [];
    const leafCombos = (rows, fromLevel, path) => {
      // Kalan boyutların kombinasyonu tek satır olur (INTAKE sütun ekseni gibi).
      const walk = (list, level, values) => {
        if (level >= dims.length) {
          const leaf = {}; dims.forEach((ref, index) => { leaf[ref.key] = values[index]; });
          out.push({ kind: 'leaf', dims: leaf, metrics: analysis.groupMetrics(list, bounds, extras), level: fromLevel, rows: list });
          withCalc(out[out.length - 1].metrics, list);
          return;
        }
        sortSiblings(bucket(list, dims[level].key, bounds, extras), level).forEach(group => walk(group.rows, level + 1, [...values, group.value]));
      };
      walk(rows, fromLevel, path);
    };
    if (!grouped) { leafCombos(prepared.visible, 0, []); }
    else {
      const walk = (rows, level, path) => {
        const ref = rowRefs[level];
        sortSiblings(bucket(rows, ref.key, bounds, extras), level).forEach(group => {
          const nextPath = [...path, group.value];
          const isLeafLevel = level === rowRefs.length - 1 && colRefs.length === 0;
          if (isLeafLevel) {
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
      walk(prepared.visible, 0, []);
    }
    if (showSubtotals && prepared.visible.length) {
      const grand = {}; if (dims[0]) grand[dims[0].key] = text('Genel Toplam', 'Grand Total');
      out.push({ kind: 'grand', dims: grand, metrics: analysis.groupMetrics(prepared.visible, bounds, extras), level: 0, rows: prepared.visible });
      withCalc(out[out.length - 1].metrics, prepared.visible);
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

  /* ---------- Çizim ---------- */
  function renderMeta() {
    const node = byId('postFobStateMeta');
    if (!node) return;
    const parts = [];
    if (state.loading && state.loaded) parts.push(text('Güncelleniyor…', 'Updating…'));
    if (state.loaded) parts.push(`${state.rows.length.toLocaleString(locale())} ${text('satır', 'rows')}`);
    if (state.fetchedAt) { const date = new Date(state.fetchedAt); if (!Number.isNaN(date.getTime())) parts.push(date.toLocaleString(locale())); }
    if (state.connection && state.connection.catalog) parts.push(state.connection.catalog);
    if (state.horizon) parts.push(text('Veri Yönetimi ufku', 'Data Management horizon'));
    node.textContent = parts.join(' · ');
  }

  function renderToolbar() {
    const segment = byId('postFobSegment');
    if (segment) {
      const labels = { all: text('Tüm üretim', 'All production'), import: text('İthal', 'Import'), domestic: text('Yerli', 'Domestic') };
      segment.innerHTML = ['all', 'import', 'domestic'].map(key => `<option value="${key}"${view().segment === key ? ' selected' : ''}>${esc(labels[key])}</option>`).join('');
    }
    const outliers = byId('postFobOutliersOnly');
    if (outliers) outliers.checked = Boolean(view().outliersOnly);
    const search = byId('postFobSearch');
    if (search && document.activeElement !== search) search.value = state.search;
    if (search) search.placeholder = text('Sipariş kodu, model, özel kod ara…', 'Search order code, model, special code…');
  }

  function renderFilters() {
    const bar = byId('postFobFilterBar');
    if (!bar) return;
    const fields = view().filters.map(ref => {
      const selected = view().filterValues[ref.key] || [];
      const label = selected.length > 1 ? `${selected.length} ${text('seçim', 'selected')}` : (selected[0] || text('Tümü', 'All'));
      const required = ref.key === 'season' && !state.horizon ? ` <span class="postFobRequired">${esc(text('(zorunlu)', '(required)'))}</span>` : '';
      return `<div class="intakeFilterField"><span class="intakeFilterLabel">${esc(refLabel(ref))}${required}</span><div class="intakeFilterControl"><button type="button" class="oabMultiTrigger intakeFilterTrigger" data-postfob-filter="${esc(ref.key)}" aria-haspopup="listbox" aria-expanded="false"><span class="oabMultiLabel${selected.length ? ' hasValue' : ''}">${esc(label)}</span><span class="oabMultiChevron" aria-hidden="true">▾</span></button><button type="button" class="intakeFilterRemove" data-postfob-filter-remove="${esc(ref.key)}" title="${esc(text('Filtreyi kaldır', 'Remove filter'))}" aria-label="${esc(text('Filtreyi kaldır', 'Remove filter'))}">×</button></div></div>`;
    }).join('');
    bar.innerHTML = `${fields}<button type="button" class="navActionBtn intakeFilterAdd" data-postfob-add-filter>+ ${esc(text('Filtre ekle', 'Add filter'))}</button>`;
    const button = byId('postFobFiltersBtn');
    if (button) button.classList.toggle('hasActiveFilters', Object.keys(view().filterValues || {}).length > 0);
  }

  function kpi(value, label, title) {
    return `<div class="kpi postFobKpi"${title ? ` title="${esc(title)}"` : ''}><span class="n">${esc(value || '—')}</span><span class="l">${esc(label)}</span></div>`;
  }

  function updateGroupButtons(prepared) {
    const keys = prepared ? groupPathKeys(prepared.visible) : [];
    const collapsed = new Set(display().collapsedGroups || []);
    const expand = byId('postFobExpandAllBtn'), collapse = byId('postFobCollapseAllBtn');
    if (expand) { expand.hidden = !keys.length; expand.disabled = !keys.length || collapsed.size === 0; }
    if (collapse) { collapse.hidden = !keys.length; collapse.disabled = !keys.length; }
  }

  function cellHtml(item, ref, dims, isValue) {
    if (isValue) {
      const value = ref.key === 'outliers' ? item.metrics.outliers : item.metrics[ref.key];
      const cls = ref.key === 'outliers' && value ? 'num postFobOutlierCell' : 'num';
      return `<td class="${cls}">${esc(valueFormat(ref)(value == null ? null : value))}</td>`;
    }
    const index = dims.findIndex(entry => entry.key === ref.key);
    const value = item.dims[ref.key];
    if (item.kind === 'group') {
      if (index > item.level) return '';
      if (index === item.level) {
        const label = value == null || value === '' ? text('(boş)', '(blank)') : value;
        const span = Math.max(1, dims.length - item.level);
        return `<td class="oabPivotGroupCell"${span > 1 ? ` colspan="${span}"` : ''} title="${esc(label)}"><button type="button" class="oabPivotGroupToggle" data-postfob-group-key="${esc(item.pathKey)}" title="${esc(item.collapsed ? text('Grubu genişlet', 'Expand group') : text('Grubu daralt', 'Collapse group'))}">${item.collapsed ? '▸' : '▾'}</button><strong>${esc(label)}</strong>${item.subtotal ? `<span class="oabPivotSubtotalTag">${esc(text('Alt toplam', 'Subtotal'))}</span>` : ''}</td>`;
      }
      return '<td></td>';
    }
    if (item.kind === 'grand') return `<td class="${index === 0 ? 'oabPivotGrandLabel' : ''}">${index === 0 ? `<strong>${esc(value)}</strong>` : ''}</td>`;
    if (display().grouped !== false && index >= 0 && index < item.level) return '<td></td>';
    return `<td>${esc(value == null || value === '' ? text('(boş)', '(blank)') : value)}</td>`;
  }

  function renderBody() {
    const body = byId('postFobBody'), table = byId('postFobTable'), kpis = byId('postFobKpis'), note = byId('postFobNote');
    if (!body || !table || !kpis) return;
    body.hidden = false;
    if (!state.rows.length) {
      kpis.innerHTML = '';
      if (note) note.hidden = true;
      updateGroupButtons(null);
      const message = state.loaded
        ? text('Seçili filtrelerde satır yok. Filtreleri genişletip Yenile’ye basın.', 'No rows for the selected filters. Widen the filters and press Refresh.')
        : (state.horizon
          ? text('Veri Yönetimi’ndeki ufuk uygulanır. İsterseniz filtreleri daraltıp Yenile’ye basın.', 'The Data Management horizon applies. Optionally narrow the filters and press Refresh.')
          : text('Filtrelerden en az bir sezon seçip Yenile’ye basın ya da Veri Yönetimi’nde ufuk tanımlayın. Sorgu FiyatMaliyetKontrolRapor modeline sizin Windows kimliğinizle gider.', 'Select at least one season in the filters and press Refresh, or define a horizon in Data Management. The query runs against the FiyatMaliyetKontrolRapor model with your Windows identity.'));
      table.innerHTML = `<tbody><tr><td class="intakeEmpty">${esc(message)}</td></tr></tbody>`;
      return;
    }
    const prepared = analysis.prepare(state.rows, { segment: view().segment, outliersOnly: view().outliersOnly, search: state.search });
    const total = analysis.groupMetrics(prepared.visible, prepared.bounds, extraValues());
    kpis.innerHTML = [
      kpi(FORMATS.qty(total.qty), text('Net adet', 'Net quantity')),
      kpi(FORMATS.usd(total.fob), text('Ağırlıklı FOB USD', 'Weighted FOB USD')),
      kpi(FORMATS.usd(total.postFob), text('FOB sonrası USD / adet', 'Post-FOB USD / unit')),
      kpi(FORMATS.ratio(total.landedToFob), text('Landed / FOB', 'Landed / FOB')),
      kpi(FORMATS.ratio(total.integralToFob), text('Integral / FOB', 'Integral / FOB')),
      kpi(FORMATS.pct(total.forecastGap), text('Landed öngörü sapması', 'Landed forecast gap')),
      kpi(prepared.bounds ? String(prepared.outlierCount) : '', text('Aykırı satır', 'Outlier rows'),
        prepared.bounds ? text(`Landed/FOB > ${fmt(prepared.bounds.upper, 3)} veya < ${fmt(prepared.bounds.lower, 3)} (Q3 + 1,5×IQR)`, `Landed/FOB > ${fmt(prepared.bounds.upper, 3)} or < ${fmt(prepared.bounds.lower, 3)} (Q3 + 1.5×IQR)`) : text('Aykırı sınırı için en az 8 satır gerekir.', 'At least 8 rows are needed for an outlier bound.')),
      kpi(`${prepared.segments.import} / ${prepared.segments.domestic}`, text('İthal / yerli satır', 'Import / domestic rows')),
    ].join('');
    const dims = [...view().rows, ...view().columns];
    const values = view().values;
    const calcs = calcDefs();
    const sort = display().sort || {};
    const arrow = key => sort.key === key ? (Number(sort.dir) === 1 ? ' ↑' : ' ↓') : '';
    const head = [...dims.map(ref => `<th data-postfob-sort="${esc(ref.key)}" title="${esc(text('Sıralamak için tıklayın', 'Click to sort'))}">${esc(refLabel(ref))}${arrow(ref.key)}</th>`),
      ...values.map(ref => { const hint = VALUE_HINTS[ref.key]; return `<th class="num" data-postfob-sort="${esc(ref.key)}" title="${esc(hint ? text(hint[0], hint[1]) : (ref.source ? `${ref.source} · ${ref.agg}` : text('Sıralamak için tıklayın', 'Click to sort')))}">${esc(refLabel(ref))}${arrow(ref.key)}</th>`; }),
      ...calcs.map(def => `<th class="num pcvHead" data-postfob-sort="${esc(PCV().keyOf(def))}" title="${esc(`${PCV().modeText(def.mode)} · ${text('Sıralamak için tıklayın', 'Click to sort')}`)}"><span class="pcvHeadMark" aria-hidden="true">ƒx</span> ${esc(PCV().labelOf(def))}${arrow(PCV().keyOf(def))}</th>`)].join('');
    const items = displayRows(prepared);
    const shown = items.length > MAX_TABLE_ROWS ? [...items.slice(0, MAX_TABLE_ROWS - 1), items[items.length - 1]] : items;
    const rowClass = item => item.kind === 'grand' ? 'oabPivotGrandTotalRow' : (item.kind === 'group' ? (item.subtotal ? 'oabPivotSubtotalRow' : 'oabPivotGroupRow') : '');
    state.displayItems = shown;
    const bodyHtml = shown.map((item, index) => `<tr class="${rowClass(item)}" data-postfob-row="${index}">${dims.map(ref => cellHtml(item, ref, dims, false)).join('')}${values.map(ref => cellHtml(item, ref, dims, true)).join('')}${calcs.length ? calcs.map(def => calcCellHtml(item, def)).join('') : ''}</tr>`).join('');
    table.innerHTML = `<thead><tr>${head}</tr></thead><tbody>${bodyHtml || `<tr><td class="intakeEmpty" colspan="${dims.length + values.length + calcs.length}">${esc(text('Aramayla eşleşen satır yok.', 'No rows match the search.'))}</td></tr>`}</tbody>`;
    updateGroupButtons(prepared);
    const drillTitle = text('Alt detayı görmek için çift tıklayın', 'Double-click to see drill-down details');
    table.querySelectorAll('tbody tr[data-postfob-row] > td').forEach(td => { td.classList.add('oabPivotDrillCell'); if (!td.title) td.title = drillTitle; });
    try {
      /* Sütun, başlığın en uzun kelimesinden dar olmaz: sığmayan tablo kelime
         ortasından kırılmak yerine kendi kabında yatay kayar. */
      const wordPx = label => Math.max(...String(label).split(/\s+/).map(word => word.length)) * 10 + 28;
      // Boyut sütunu en uzun değeri (sınırlı) ve grup satırında ▾ + Alt toplam etiketini taşır.
      const dimPx = (ref, index) => {
        const longest = prepared.visible.reduce((max, row) => Math.max(max, clean(row && row[ref.key]).length), 0);
        const groupExtra = index < view().rows.length - 1 || view().columns.length ? 120 : 0;
        return Math.min(360, Math.max(wordPx(refLabel(ref)), longest * 8 + 28 + groupExtra));
      };
      window.BLTableColumnResize?.apply(table, { store: widthStore, columns: [...dims.map((ref, index) => ({ key: ref.key, label: refLabel(ref), type: 'text', minPx: dimPx(ref, index) })), ...values.map(ref => ({ key: ref.key, label: refLabel(ref), type: 'num', minPx: wordPx(refLabel(ref)) })), ...calcs.map(def => ({ key: calcHeadKey(def), label: PCV().labelOf(def), type: 'num', minPx: wordPx(PCV().labelOf(def)) + 18 }))] });
    } catch (error) { console.warn('FOB sonrası maliyet sütun genişliği uygulanamadı:', error); }
    const notes = [];
    if (state.search) notes.push(text(`Arama: ${prepared.visible.length.toLocaleString(locale())} / ${prepared.scoped.length.toLocaleString(locale())} satır eşleşti.`, `Search: ${prepared.visible.length.toLocaleString(locale())} / ${prepared.scoped.length.toLocaleString(locale())} rows match.`));
    if (items.length > shown.length) notes.push(text(`İlk ${MAX_TABLE_ROWS.toLocaleString(locale())} satır gösteriliyor; grupları daraltın veya filtreleyin.`, `Showing the first ${MAX_TABLE_ROWS.toLocaleString(locale())} rows; collapse groups or filter.`));
    if (state.truncated) notes.push(text(`Sorgu ${state.rowLimit.toLocaleString(locale())} satır sınırına ulaştı; toplamlar eksik olabilir. Filtreleri daraltın.`, `The query hit the ${state.rowLimit.toLocaleString(locale())} row limit; totals may be incomplete. Narrow the filters.`));
    if (total.landedCoverage != null && total.landedCoverage < 0.95) notes.push(text(`Landed değeri adetin %${fmt(total.landedCoverage * 100, 0)} kısmında var; oranlar yalnız bu kısımdan hesaplandı.`, `Landed is available for ${fmt(total.landedCoverage * 100, 0)}% of the quantity; ratios use only that part.`));
    if (note) { note.hidden = !notes.length; note.textContent = notes.join(' '); }
  }

  /* ---------- Alt detay (OAB ile aynı ortak sağ çekmece) ---------- */
  const DETAIL_LABELS = {
    specialCode: ['Özel kod', 'Special code'], modelName: ['Model adı', 'Model name'],
    _postFob: ['FOB sonrası USD (satır)', 'Post-FOB USD (row)'], _landedToFob: ['Landed/FOB (satır)', 'Landed/FOB (row)'],
    _outlier: ['Aykırı', 'Outlier'], _segment: ['Kapsam', 'Scope'],
  };
  const DEFAULT_DETAIL = ['order', 'model', 'colour', 'productName', 'specialCode', 'originCountry', 'salesCountry', 'qty', 'fob', 'landedActual', '_postFob', '_landedToFob', 'integralLast', '_outlier'];
  function detailLabel(key) {
    if (DETAIL_LABELS[key]) return text(...DETAIL_LABELS[key]);
    const calc = PCV() && PCV().isKey(key) ? calcDefs().find(def => PCV().keyOf(def) === key) : null;
    if (calc) return PCV().labelOf(calc);
    const dim = baseDim(key); if (dim) return text(dim.tr, dim.en);
    const measure = state.catalog.measures.find(item => item.key === key); if (measure) return text(measure.tr, measure.en);
    const ref = [...view().rows, ...view().columns, ...view().filters, ...view().values].find(item => item.key === key);
    return ref ? refLabel(ref) : key;
  }
  function openDetail(item, ref) {
    const source = Array.isArray(item && item.rows) ? item.rows : [];
    if (!source.length) { setStatus(() => text('Bu hücre için alt detay bulunamadı.', 'No drill-down detail was found for this cell.'), 'warning'); return; }
    const prepared = analysis.prepare(state.rows, { segment: view().segment });
    const segmentText = { import: text('İthal', 'Import'), domestic: text('Yerli', 'Domestic'), unknown: text('Bilinmiyor', 'Unknown') };
    // Satır bazlı hesaplanan değer çekmecede her kaynak satırın kendi değeridir.
    const calcRowDefs = calcDefs().filter(def => def.mode === 'row');
    const rowEval = calcRowDefs.length ? calcEvaluator() : null;
    const rows = source.map(row => {
      const ratio = analysis.rowRatio(row);
      const landed = typeof row.landedActual === 'number' ? row.landedActual : null, fob = typeof row.fob === 'number' ? row.fob : null;
      const out = { ...row, _postFob: landed != null && fob != null ? landed - fob : null, _landedToFob: ratio, _outlier: analysis.isOutlier(row, prepared.bounds) ? text('Evet', 'Yes') : '', _segment: segmentText[analysis.segmentOf(row)] };
      if (rowEval) calcRowDefs.forEach(def => { out[PCV().keyOf(def)] = rowEval.rowValue(PCV().keyOf(def), row); });
      return out;
    });
    const keys = [];
    const add = key => { if (key && !keys.includes(key)) keys.push(key); };
    DEFAULT_DETAIL.forEach(add);
    rows.slice(0, 200).forEach(row => Object.keys(row).forEach(add));
    const numeric = key => rows.some(row => typeof row[key] === 'number');
    const formatOf = key => key === '_landedToFob' ? FORMATS.ratio : (key === 'qty' ? FORMATS.qty : (numeric(key) ? FORMATS.extra : null));
    const columns = keys.filter(key => rows.some(row => row[key] !== undefined)).map(key => {
      const format = formatOf(key);
      return { key, label: detailLabel(key), type: numeric(key) ? 'number' : 'text', ...(format ? { format: value => value == null || value === '' ? '' : format(value) } : {}) };
    });
    const dims = [...view().rows, ...view().columns];
    const context = item.kind === 'grand'
      ? text('Genel Toplam', 'Grand Total')
      : (item.kind === 'group' ? item.path : dims.map(entry => item.dims[entry.key]).filter(value => value != null))
        .map((value, index) => `${refLabel(dims[index])}: ${value === '' ? text('(boş)', '(blank)') : value}`).join(' › ');
    const metric = ref && (ref.key === 'outliers' ? item.metrics.outliers : item.metrics[ref.key]);
    const calcCell = ref && ref.calc ? PCV().cell(item.metrics, ref.calc) : null;
    const note = [calcCell ? `${PCV().labelOf(ref.calc)}: ${calcCell.error ? calcCell.title : calcCell.text}` : (ref && metric != null ? `${refLabel(ref)}: ${valueFormat(ref)(metric)}` : ''), `${rows.length.toLocaleString(locale())} ${text('kaynak satır', 'source rows')}`, state.search ? `${text('Arama', 'Search')}: ${state.search}` : ''].filter(Boolean).join(' · ');
    if (!window.BLDetailDrawer || typeof window.BLDetailDrawer.open !== 'function') { setStatus(() => text('Alt detay çekmecesi yüklenemedi.', 'The drill-down drawer could not be loaded.'), 'error'); return; }
    window.BLDetailDrawer.open({
      storageKey: 'postfob.pivot.detail',
      pageScope: 'overview.postfob',
      moduleId: 'overview',
      source: 'postfob',
      title: `${text('FOB Sonrası Maliyet Alt Detay', 'Post-FOB Cost Drill-down')}${ref ? ` · ${ref.calc ? PCV().labelOf(ref.calc) : refLabel(ref)}` : ''}`,
      subtitle: context,
      note,
      rows,
      columns,
      defaultVisible: DEFAULT_DETAIL.filter(key => columns.some(column => column.key === key)),
      exactDefaultVisible: true,
      flatColumns: true,
      images: false,
      fileName: 'FOB_Sonrasi_Maliyet_Alt_Detay',
    });
  }

  /* ---------- Excel (pivot + kaynak satırlar + filtre özeti) ---------- */
  async function exportExcel() {
    if (state.exporting || !state.rows.length) return;
    state.exporting = true;
    paintExportButton();
    try {
      if (!window.XLSX && window.BLPerf?.ensureLibrary) await window.BLPerf.ensureLibrary('xlsx');
      const X = window.XLSX;
      if (!X) throw new Error('XLSX');
      const prepared = analysis.prepare(state.rows, { segment: view().segment, outliersOnly: view().outliersOnly, search: state.search });
      const dims = [...view().rows, ...view().columns], values = view().values;
      const round = value => typeof value === 'number' && Number.isFinite(value) ? Math.round(value * 10000) / 10000 : (value == null ? null : value);
      // Pivot sayfası ekrandaki düzendir; 1.500 satır görüntü sınırı dosyaya uygulanmaz.
      // Hesaplanan değer başlığı boyut/değer/sabit başlıkla çakışırsa "(ƒx)" alır; sütun ezilmez.
      const calcList = calcDefs();
      const calcHeaders = calcList.length ? PCV().uniqueHeaders([text('Satır tipi', 'Row type'), ...dims.map(refLabel), ...values.map(refLabel)], calcList) : [];
      const pivot = displayRows(prepared).map(item => {
        const out = {};
        out[text('Satır tipi', 'Row type')] = item.kind === 'grand' ? text('Genel toplam', 'Grand total') : (item.kind === 'group' ? text('Alt toplam', 'Subtotal') : text('Detay', 'Detail'));
        dims.forEach((ref, index) => {
          const value = item.kind === 'group' ? (index === item.level ? item.dims[ref.key] : (index < item.level ? item.path[index] : '')) : (item.dims[ref.key] ?? '');
          out[refLabel(ref)] = value;
        });
        values.forEach(ref => { out[refLabel(ref)] = round(ref.key === 'outliers' ? item.metrics.outliers : item.metrics[ref.key]); });
        // Hesaplanan değer Excel'e DEĞER olarak yazılır; hatalı hücre boştur.
        calcList.forEach((def, index) => { out[calcHeaders[index]] = item.kind === 'group' && !item.subtotal ? null : PCV().exportValue(item.metrics, def); });
        return out;
      });
      const rowKeys = [];
      prepared.visible.slice(0, 200).forEach(row => Object.keys(row).forEach(key => { if (!rowKeys.includes(key)) rowKeys.push(key); }));
      const source = prepared.visible.map(row => {
        const out = {};
        rowKeys.forEach(key => { out[detailLabel(key)] = round(row[key]); });
        out[detailLabel('_landedToFob')] = round(analysis.rowRatio(row));
        out[detailLabel('_outlier')] = analysis.isOutlier(row, prepared.bounds) ? text('Evet', 'Yes') : '';
        return out;
      });
      const summary = [
        ...view().filters.filter(ref => (view().filterValues[ref.key] || []).length).map(ref => ({ [text('Alan', 'Field')]: refLabel(ref), [text('Değer', 'Value')]: view().filterValues[ref.key].join(', ') })),
        { [text('Alan', 'Field')]: text('Kapsam', 'Scope'), [text('Değer', 'Value')]: view().segment },
        ...(state.search ? [{ [text('Alan', 'Field')]: text('Arama', 'Search'), [text('Değer', 'Value')]: state.search }] : []),
        ...(state.horizon ? [{ [text('Alan', 'Field')]: text('Veri Yönetimi ufku', 'Data Management horizon'), [text('Değer', 'Value')]: text('Uygulandı', 'Applied') }] : []),
        { [text('Alan', 'Field')]: text('Son yenileme', 'Last refresh'), [text('Değer', 'Value')]: state.fetchedAt },
        { [text('Alan', 'Field')]: text('Kaynak', 'Source'), [text('Değer', 'Value')]: state.connection ? `${state.connection.server} / ${state.connection.catalog}` : '' },
        ...(state.truncated ? [{ [text('Alan', 'Field')]: text('Uyarı', 'Warning'), [text('Değer', 'Value')]: text('Sorgu satır sınırına ulaştı; toplamlar eksik olabilir.', 'The query hit the row limit; totals may be incomplete.') }] : []),
      ];
      const book = X.utils.book_new();
      X.utils.book_append_sheet(book, X.utils.json_to_sheet(pivot), 'Pivot');
      X.utils.book_append_sheet(book, X.utils.json_to_sheet(source), text('Kaynak satırlar', 'Source rows').slice(0, 31));
      X.utils.book_append_sheet(book, X.utils.json_to_sheet(summary), text('Filtreler', 'Filters'));
      X.writeFile(book, `FOB_Sonrasi_Maliyet_${new Date().toISOString().slice(0, 10).replace(/-/g, '')}.xlsx`, { compression: true });
    } catch (error) {
      setStatus(() => text('Excel dosyası oluşturulamadı.', 'The Excel file could not be created.'), 'error');
    } finally { state.exporting = false; paintExportButton(); }
  }
  function paintExportButton() {
    const button = byId('postFobExcelExportBtn');
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
    const refresh = byId('postFobRefreshBtn');
    if (refresh) { refresh.disabled = state.loading; refresh.setAttribute('aria-busy', state.loading ? 'true' : 'false'); }
    byId('postFobBody')?.classList.toggle('isBusy', state.loading);
    paintExportButton();
  }

  const widthStore = {
    get: id => { const px = Number(display().widths && display().widths[id]); return Number.isFinite(px) ? px : null; },
    set: (id, px) => { const current = view(); current.display = current.display || {}; current.display.widths = { ...(current.display.widths || {}), [id]: Math.round(px) }; state.view = current; },
    save: () => saveView({ silent: true }),
  };

  function applyPayload(payload) {
    state.rows = Array.isArray(payload && payload.rows) ? payload.rows : [];
    state.fetchedAt = clean(payload && payload.fetchedAt);
    state.missing = Array.isArray(payload && payload.missing) ? payload.missing : [];
    state.truncated = Boolean(payload && payload.truncated);
    state.rowLimit = Number(payload && payload.rowLimit) || state.rowLimit;
    state.horizonApplied = Boolean(payload && payload.horizonApplied);
  }

  /* ---------- Veri ---------- */
  async function loadState() {
    try {
      const payload = await requestJson('/api/postfob/state');
      state.catalog = { ...state.catalog, ...(payload.catalog || {}) };
      state.view = payload.view || clone(state.catalog.defaults);
      state.connection = payload.connection || null;
      state.horizon = Boolean(payload.horizon);
      if (payload.snapshot) { applyPayload(payload.snapshot); state.loaded = true; }
      setStatus(null);
    } catch (error) { setStatus(error.message || String(error), 'error'); }
    render();
  }

  /* Görünüm sunucuya kaydedilir; yanıt ancak gönderildiği revizyon hâlâ
     güncelse görünümün yerine geçer (INTAKE ile aynı yarış koruması). */
  /* Art arda gelen kayıtlar birleşir; her çağıranın sözü en son kaydın
     sonucuyla çözülür (önceki zamanlayıcı iptal edilince söz askıda kalmaz). */
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
          const result = await requestJson('/api/postfob/view', jsonBody('PUT', { view: view() }));
          if (revision === state.viewRevision && result.view) state.view = result.view;
          flushSaveWaiters(result.view || null);
        } catch (error) { if (!options.silent) setStatus(error.message || String(error), 'error'); flushSaveWaiters(null); }
      }, options.immediate ? 0 : 250);
    });
  }

  async function refresh(force) {
    if (state.loading) return;
    if (!state.horizon && !(view().filterValues.season || []).length) {
      setStatus(() => text('Sorgu için en az bir sezon seçin veya Veri Yönetimi’nde ufuk tanımlayın.', 'Select at least one season or define a horizon in Data Management.'), 'warning');
      setFilterPanelOpen(true);
      return;
    }
    state.loading = true;
    setStatus(() => text('FOB sonrası maliyet modeli sorgulanıyor…', 'Querying the post-FOB cost model…'), 'loading');
    render();
    try {
      // Bekleyen görünüm kaydı rapor isteğine dahildir (sunucu görünümü kaydeder).
      clearTimeout(saveTimer);
      const revision = state.viewRevision;
      // Bu isteğe dahil edilen kayıtların bekleyenleri; sonradan başlayan kayıt kendi sözünü korur.
      pendingSaves = saveWaiters; saveWaiters = [];
      const payload = await requestJson('/api/postfob/report', jsonBody('POST', { view: view(), forceRefresh: Boolean(force) }));
      pendingSaves.forEach(resolve => resolve(payload.view || null)); pendingSaves = [];
      // Sorgu sürerken kullanıcının yaptığı görünüm değişikliği ezilmez.
      if (payload.view && revision === state.viewRevision) state.view = payload.view;
      applyPayload(payload);
      state.loaded = true;
      if (payload.offline) setStatus(() => text('Model şu anda erişilemiyor; son kayıtlı sonuç gösteriliyor.', 'The model is unreachable; showing the last saved result.'), 'warning');
      else if (state.missing.length) setStatus(() => text(`Modelde bulunmayan alanlar boş gösterildi: ${missingLabels()}.`, `Fields missing from the model are shown blank: ${missingLabels()}.`), 'warning');
      else setStatus(payload.fromCache ? () => text('Son 30 dakikadaki aynı sorgunun sonucu gösteriliyor.', 'Showing the result of the same query from the last 30 minutes.') : null, payload.fromCache ? 'ok' : '');
    } catch (error) { setStatus(error.message || String(error), 'error'); }
    finally { pendingSaves.forEach(resolve => resolve(null)); pendingSaves = []; state.loading = false; render(); }
  }

  function loadMetadata() {
    if (state.metadata) return Promise.resolve(state.metadata);
    if (state.metadataPromise) return state.metadataPromise;
    state.metadataPromise = requestJson('/api/postfob/metadata')
      .then(result => { state.metadata = { dimensions: result.dimensions || [], measures: result.measures || [] }; return state.metadata; })
      .catch(error => { setStatus(text(`Model alan listesi okunamadı; yalnız hazır alanlar kullanılabilir. ${error.message || ''}`, `The model field list could not be read; only built-in fields are available. ${error.message || ''}`), 'warning'); return null; })
      .finally(() => { state.metadataPromise = null; });
    return state.metadataPromise;
  }

  /* Pivot alan havuzu: hazır alanlar + canlı modelin diğer alanları. id: temel
     anahtar veya 'src:' + kaynak adı (kalıcı anahtarı sunucu türetir). */
  function dimensionPool() {
    const pool = state.catalog.dimensions.map(item => ({ id: item.key, ref: { key: item.key }, label: text(item.tr, item.en), group: text('Hazır alanlar', 'Built-in fields') }));
    for (const ref of [...view().rows, ...view().columns, ...view().filters]) if (ref.source && !pool.some(entry => entry.id === ref.key)) pool.push({ id: ref.key, ref: clone(ref), label: refLabel(ref), group: text('Model alanları', 'Model fields') });
    for (const field of (state.metadata && state.metadata.dimensions) || []) {
      if (field.baseKey) continue;
      const known = pool.find(entry => entry.ref.source === field.source);
      if (!known) pool.push({ id: `src:${field.source}`, ref: { source: field.source, label: field.label }, label: `${field.table} › ${field.label}`, group: text('Model alanları', 'Model fields') });
    }
    return pool;
  }
  function valuePool() {
    const pool = state.catalog.values.map(item => ({ id: item.key, ref: { key: item.key }, label: text(item.tr, item.en), group: text('Hesaplanan değerler', 'Calculated values'), builtIn: true }));
    for (const ref of view().values) if (ref.source && !pool.some(entry => entry.id === ref.key)) pool.push({ id: ref.key, ref: clone(ref), label: refLabel(ref), group: text('Model ölçüleri', 'Model measures') });
    for (const field of (state.metadata && state.metadata.measures) || []) {
      if (field.baseKey) continue;
      if (!pool.some(entry => entry.ref.source === field.source)) pool.push({ id: `src:${field.source}`, ref: { source: field.source, label: field.label }, label: field.label, group: text('Model ölçüleri', 'Model measures') });
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
      <button type="button" class="oabConfigIconBtn" data-postfob-config-move="-1" title="${esc(text('Yukarı taşı', 'Move up'))}" aria-label="${esc(text('Yukarı taşı', 'Move up'))}">↑</button>
      <button type="button" class="oabConfigIconBtn" data-postfob-config-move="1" title="${esc(text('Aşağı taşı', 'Move down'))}" aria-label="${esc(text('Aşağı taşı', 'Move down'))}">↓</button>
      <button type="button" class="oabConfigIconBtn danger" data-postfob-config-remove title="${esc(text('Sil', 'Remove'))}" aria-label="${esc(text('Sil', 'Remove'))}">×</button>
    </div>`;
  const axisRowHtml = (id, pool) => `<div class="oabPivotAxisRow oabConfigRow intakeConfigRow"><span class="oabConfigDrag" aria-hidden="true">⋮⋮</span><select class="postFobAxisField" aria-label="${esc(text('Alan', 'Field'))}">${optionsHtml(pool, id)}</select>${actionsHtml()}</div>`;
  const AGG_LABELS = { SUM: ['Toplam', 'Sum'], WAVG: ['Adet ağırlıklı ort.', 'Qty-weighted avg.'], AVG: ['Ortalama', 'Average'], MIN: ['En küçük', 'Min'], MAX: ['En büyük', 'Max'] };
  function valueRowHtml(id, agg, pool) {
    const entry = pool.find(item => item.id === id);
    const builtIn = !entry || entry.builtIn;
    const aggOptions = state.catalog.aggregates.map(item => `<option value="${item}"${item === (agg || 'SUM') ? ' selected' : ''}>${esc(text(...(AGG_LABELS[item] || [item, item])))}</option>`).join('');
    return `<div class="oabPivotValueRow oabConfigRow intakeConfigRow"><span class="oabConfigDrag" aria-hidden="true">⋮⋮</span><select class="postFobValueField" aria-label="${esc(text('Değer', 'Value'))}">${optionsHtml(pool, id)}</select><select class="postFobValueAgg" aria-label="${esc(text('Özetleme', 'Summarization'))}"${builtIn ? ' hidden' : ''}>${aggOptions}</select>${actionsHtml()}</div>`;
  }
  function refreshOrderButtons(list) {
    const rows = [...list.querySelectorAll('.oabConfigRow')];
    rows.forEach((row, index) => {
      const up = row.querySelector('[data-postfob-config-move="-1"]'), down = row.querySelector('[data-postfob-config-move="1"]');
      if (up) up.disabled = index === 0;
      if (down) down.disabled = index === rows.length - 1;
    });
  }
  /* Sorgu düzeyi: satır/sütundaki model alanları gruplanır, yalnız filtredeki
     alanlar gruplanmaz. İkisi ayrı izlenir; alan filtreden satıra taşınınca da
     sorgu yenilenir, aksi hâlde yeni sütun boş görünürdü. */
  const queryShape = current => JSON.stringify([
    [...current.rows, ...current.columns].filter(ref => ref.source).map(ref => ref.source).sort(),
    current.filters.filter(ref => ref.source).map(ref => ref.source).sort(),
    current.values.filter(ref => ref.source).map(ref => ref.source).sort(),
  ]);

  async function openFields() {
    document.getElementById('_postFobFieldsModal')?.remove();
    await loadMetadata();
    const draft = clone(view());
    const dims = dimensionPool(), vals = valuePool();
    const modal = document.createElement('div');
    modal.className = 'autoModalOverlay';
    modal.id = '_postFobFieldsModal';
    const sectionHtml = (id, title, addLabel, body) => `<div class="oabSettingsSection"><div class="oabSettingsSectionHead"><span>${esc(title)}</span><button type="button" class="navActionBtn" data-postfob-add="${id}">+ ${esc(addLabel)}</button></div><div class="oabPivotConfigList" id="${id}">${body}</div></div>`;
    modal.innerHTML = `<div class="autoModal oabSettingsModal intakeFieldsModal" role="dialog" aria-modal="true" aria-labelledby="_postFobFieldsTitle">
      <header><h3 id="_postFobFieldsTitle">${esc(text('FOB Sonrası Maliyet Ayarları', 'Post-FOB Cost Settings'))}</h3><button type="button" data-postfob-close aria-label="${esc(text('Kapat', 'Close'))}">×</button></header>
      <div class="autoModalBody">
        <div class="oabPivotBehaviorGrid">
          <label class="oabCheckField"><input type="checkbox" id="postFobGroupedInput"${draft.display.grouped !== false ? ' checked' : ''}><span>${esc(text('Gruplu pivot görünümü', 'Grouped pivot view'))}</span></label>
          <label class="oabCheckField"><input type="checkbox" id="postFobSubtotalsInput"${draft.display.showSubtotals !== false ? ' checked' : ''}><span>${esc(text('Alt toplamları ve genel toplamı göster', 'Show subtotals and grand total'))}</span></label>
        </div>
        ${sectionHtml('postFobRowsList', text('Pivot Satırları', 'Pivot Rows'), text('Alan ekle', 'Add field'), draft.rows.map(ref => axisRowHtml(poolIdOf(ref), dims)).join(''))}
        ${sectionHtml('postFobColsList', text('Pivot Sütunları', 'Pivot Columns'), text('Alan ekle', 'Add field'), draft.columns.map(ref => axisRowHtml(poolIdOf(ref), dims)).join(''))}
        ${sectionHtml('postFobValuesList', text('Pivot Değerleri', 'Pivot Values'), text('Değer ekle', 'Add value'), draft.values.map(ref => valueRowHtml(poolIdOf(ref), ref.agg, vals)).join(''))}
        ${PCV() ? PCV().sectionHtml() : ''}
        ${sectionHtml('postFobFiltersList', text('Filtre Alanları', 'Filter Fields'), text('Alan ekle', 'Add field'), draft.filters.map(ref => axisRowHtml(poolIdOf(ref), dims)).join(''))}
        <p class="oabSettingsHint">${esc(text('Satırları oklarla sıralayabilirsiniz. Hesaplanan değerler (FOB, landed, oranlar) adet ağırlıklıdır. Modelden eklenen ölçüler için özetleme seçin; birim fiyat/oran ölçülerinde “Adet ağırlıklı ort.” kullanın. Modelden eklenen satır/sütun alanı sorgu düzeyini değiştirir ve kayıtta veri yeniden çekilir; ilişkisiz bir tablo satırları çoğaltabilir.', 'Reorder rows with the arrows. Calculated values (FOB, landed, ratios) are quantity-weighted. Choose a summarization for measures added from the model; use “Qty-weighted avg.” for unit price/rate measures. A row/column field added from the model changes the query level and data is re-queried on save; an unrelated table can duplicate rows.'))}</p>
      </div>
      <footer><button type="button" class="tbtn" data-postfob-settings-reset>${esc(text('Pivot Varsayılanına Dön', 'Reset Pivot'))}</button><button type="button" class="tbtn" data-postfob-close>${esc(text('Vazgeç', 'Cancel'))}</button><button type="button" class="tbtn primary" data-postfob-save>${esc(text('Kaydet', 'Save'))}</button></footer>
    </div>`;
    document.body.appendChild(modal);
    const dialog = modal.querySelector('[role="dialog"]');
    window.BLMotionPlus?.play?.('overlay', dialog);
    const close = () => modal.remove();
    modal.querySelectorAll('[data-postfob-close]').forEach(button => button.addEventListener('click', close));
    modal.addEventListener('keydown', event => { if (event.key === 'Escape') { event.stopPropagation(); close(); } });
    modal.addEventListener('pointerdown', event => { modal.dataset.backdropDown = event.target === modal ? '1' : '0'; });
    modal.addEventListener('pointerup', event => { if (event.target === modal && modal.dataset.backdropDown === '1') close(); modal.dataset.backdropDown = '0'; });
    const lists = ['postFobRowsList', 'postFobColsList', 'postFobValuesList', 'postFobFiltersList'].map(id => modal.querySelector(`#${id}`));
    lists.forEach(refreshOrderButtons);
    /* Hesaplanan değerler: toplam modunda pencerede SEÇİLİ değer alanları,
       satır modunda sipariş × renk satırının sayısal ölçüleri. */
    const draftValueFields = () => [...lists[2].querySelectorAll('.oabPivotValueRow')].map(row => vals.find(item => item.id === row.querySelector('.postFobValueField').value))
      .filter(entry => entry && entry.ref.key).map(entry => ({ key: entry.ref.key, label: entry.label }));
    const rowValueFields = () => [
      ...state.catalog.measures.map(item => ({ key: item.key, label: text(item.tr, item.en) })),
      ...view().values.filter(ref => ref.source && ref.key).map(ref => ({ key: ref.key, label: refLabel(ref) })),
    ];
    const sampleLabel = item => item.kind === 'grand' ? text('Genel Toplam', 'Grand Total') : (item.kind === 'group' ? item.path : [...view().rows, ...view().columns].map(entry => item.dims[entry.key])).map(value => value === '' ? text('(boş)', '(blank)') : value).join(' › ');
    const calcSection = PCV() ? PCV().mountSection(modal.querySelector('[data-pcv-section]'), {
      defs: draft.calculated || [],
      allowRow: true,
      widget: { tr: 'FOB Sonrası Maliyet', en: 'Post-FOB Cost' },
      isTextKey: key => Boolean(baseDim(key)),
      // Boyut, değer, ölçü ve Excel sabit başlıkları ayrılmıştır (TR + EN).
      reserved: () => ['Satır tipi', 'Row type', ...[...state.catalog.dimensions, ...state.catalog.values, ...state.catalog.measures].flatMap(item => [item.tr, item.en]), ...[...view().rows, ...view().columns, ...view().filters, ...view().values].map(refLabel)], // i18n-ignore: ayrılmış ad listesi (iki dil birlikte)
      fields: mode => (mode === 'row' ? rowValueFields() : draftValueFields()),
      samples: mode => {
        if (!state.rows.length) return [];
        if (mode === 'row') return state.rows.slice(0, 6).map(row => ({ label: [row.order, row.colour].filter(Boolean).join(' · ') || text('Kaynak satır', 'Source row'), values: row }));
        const items = displayRows(analysis.prepare(state.rows, { segment: view().segment, outliersOnly: view().outliersOnly, search: state.search })).filter(item => item.kind !== 'group' || item.subtotal);
        return [...items.slice(0, 5), ...items.slice(-1)].filter((item, index, list) => list.indexOf(item) === index).map(item => ({ label: sampleLabel(item), values: item.metrics, rows: item.rows }));
      },
    }) : null;
    modal.addEventListener('click', event => {
      const add = event.target.closest('[data-postfob-add]');
      if (add) {
        const list = modal.querySelector(`#${add.dataset.postfobAdd}`);
        const isValue = add.dataset.postfobAdd === 'postFobValuesList';
        const pool = isValue ? vals : dims;
        const used = new Set([...list.querySelectorAll('select.postFobAxisField,select.postFobValueField')].map(select => select.value));
        const next = pool.find(entry => !used.has(entry.id)) || pool[0];
        if (!next) return;
        list.insertAdjacentHTML('beforeend', isValue ? valueRowHtml(next.id, 'SUM', vals) : axisRowHtml(next.id, dims));
        refreshOrderButtons(list);
        return;
      }
      const remove = event.target.closest('[data-postfob-config-remove]');
      if (remove) { const row = remove.closest('.oabConfigRow'), list = row.parentElement; row.remove(); refreshOrderButtons(list); return; }
      const move = event.target.closest('[data-postfob-config-move]');
      if (move) {
        const row = move.closest('.oabConfigRow'), list = row.parentElement;
        if (Number(move.dataset.postfobConfigMove) < 0 && row.previousElementSibling) list.insertBefore(row, row.previousElementSibling);
        if (Number(move.dataset.postfobConfigMove) > 0 && row.nextElementSibling) list.insertBefore(row.nextElementSibling, row);
        refreshOrderButtons(list);
      }
    });
    modal.addEventListener('change', event => {
      const select = event.target.closest('.postFobValueField');
      if (!select) return;
      const entry = vals.find(item => item.id === select.value);
      const agg = select.closest('.oabConfigRow').querySelector('.postFobValueAgg');
      if (agg) agg.hidden = !entry || Boolean(entry.builtIn);
    });
    const collect = (list, pool) => {
      const out = [], seen = new Set();
      list.querySelectorAll('select.postFobAxisField').forEach(select => {
        const entry = pool.find(item => item.id === select.value);
        if (!entry || seen.has(entry.id)) return;
        seen.add(entry.id); out.push(clone(entry.ref));
      });
      return out;
    };
    modal.querySelector('[data-postfob-save]').addEventListener('click', async () => {
      const before = queryShape(view());
      const next = clone(view());
      next.rows = collect(lists[0], dims);
      next.columns = collect(lists[1], dims);
      next.filters = collect(lists[3], dims);
      next.values = [...lists[2].querySelectorAll('.oabPivotValueRow')].map(row => {
        const entry = vals.find(item => item.id === row.querySelector('.postFobValueField').value);
        if (!entry) return null;
        const ref = clone(entry.ref);
        if (!entry.builtIn) ref.agg = row.querySelector('.postFobValueAgg').value || 'SUM';
        return ref;
      }).filter(Boolean);
      next.display = { ...(next.display || {}), grouped: modal.querySelector('#postFobGroupedInput').checked, showSubtotals: modal.querySelector('#postFobSubtotalsInput').checked, collapsedGroups: [] };
      if (calcSection) next.calculated = calcSection.value();
      if (!next.rows.length && !next.columns.length) { setStatus(() => text('En az bir satır veya sütun alanı seçin.', 'Select at least one row or column field.'), 'warning'); return; }
      state.view = next;
      close();
      const saved = await saveView({ immediate: true });
      render();
      if (saved && queryShape(saved) !== before && state.loaded) void refresh(false);
      else setStatus(() => text('Pivot ayarları kaydedildi.', 'Pivot settings saved.'), 'ok');
    });
    modal.querySelector('[data-postfob-settings-reset]').addEventListener('click', async () => {
      const keep = view().filterValues;
      // Hesaplanan değerler kullanıcının tanımlarıdır; düzen sıfırlanınca silinmez.
      state.view = { ...clone(state.catalog.defaults), filterValues: Object.fromEntries(Object.entries(keep || {}).filter(([key]) => state.catalog.defaults.filters.some(ref => ref.key === key))), calculated: clone(view().calculated || []) };
      close();
      await saveView({ immediate: true });
      render();
      setStatus(() => text('Pivot varsayılan düzenine döndü.', 'Pivot reset to defaults.'), 'ok');
    });
    dialog.querySelector('select,button')?.focus();
  }

  /* ---------- Filtre paneli, değer seçici, alan ekleme ---------- */
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
    section.querySelectorAll('[data-postfob-filter][aria-expanded="true"],[data-postfob-add-filter][aria-expanded="true"]').forEach(button => button.setAttribute('aria-expanded', 'false'));
  }
  /* Ortak yerleştirici: değerler yüklenip panel büyüyünce de pencere içinde kalır. */
  function placePopover(popover, button) {
    window.BLFloatingPlacement?.place(popover, button);
    window.BLMotionPlus?.play?.('overlay', popover);
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
    popover.innerHTML = `<div class="intakeFilterPopoverTitle">${esc(refLabel(ref))}</div><input type="search" class="intakeFilterSearch" placeholder="${esc(text('Değerlerde ara…', 'Search values…'))}" aria-label="${esc(text('Değerlerde ara', 'Search values'))}"><div class="intakeFilterValues"><div class="intakeConfigEmpty">${esc(text('Değerler yükleniyor…', 'Loading values…'))}</div></div><div class="intakeFilterActions"><button type="button" class="tbtn" data-postfob-clear>${esc(text('Temizle', 'Clear'))}</button><button type="button" class="tbtn primary" data-postfob-apply>${esc(text('Uygula', 'Apply'))}</button></div>`;
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
    popover.querySelector('[data-postfob-clear]').addEventListener('click', () => { selected.clear(); draw(); });
    popover.querySelector('[data-postfob-apply]').addEventListener('click', () => {
      const next = { ...view().filterValues };
      if (selected.size) next[key] = [...selected].slice(0, 500); else delete next[key];
      state.view = { ...view(), filterValues: next };
      closePopover();
      void saveView();
      render();
      setStatus(() => text('Filtre değişti. Veriyi çekmek için Yenile’ye basın.', 'Filters changed. Press Refresh to query data.'), 'ok');
    });
    search.focus();
    void requestJson('/api/postfob/distinct', jsonBody('POST', { key, source: ref.source || '', limit: 1000 }))
      .then(result => { values = [...new Set([...(Array.isArray(result.values) ? result.values : []), ...selected])]; if (state.popover === popover) draw(); })
      .catch(error => {
        if (state.popover !== popover) return;
        if (values.length) { draw(); return; }
        list.innerHTML = `<div class="intakeConfigEmpty">${esc(error.message || text('Değerler alınamadı.', 'Values could not be loaded.'))}</div>`;
      });
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
    popover.innerHTML = `<div class="intakeFilterPopoverTitle">${esc(text('Model alanından filtre ekle', 'Add filter from model fields'))}</div><input type="search" class="intakeFilterSearch" placeholder="${esc(text('Alanlarda ara…', 'Search fields…'))}" aria-label="${esc(text('Alanlarda ara', 'Search fields'))}"><div class="intakeFilterValues"></div>`;
    document.body.appendChild(popover);
    state.popover = popover;
    button.setAttribute('aria-expanded', 'true');
    placePopover(popover, button);
    const list = popover.querySelector('.intakeFilterValues'), search = popover.querySelector('.intakeFilterSearch');
    const draw = () => {
      const needle = clean(search.value).toLocaleLowerCase(locale());
      const visible = fields.filter(entry => !needle || entry.label.toLocaleLowerCase(locale()).includes(needle));
      list.innerHTML = visible.length
        ? visible.slice(0, 400).map(entry => `<button type="button" class="intakeFilterFieldOption" data-postfob-add-filter-id="${esc(entry.id)}"><span>${esc(entry.label)}</span><small>${esc(entry.ref.source || entry.group)}</small></button>`).join('')
        : `<div class="intakeConfigEmpty">${esc(text('Eşleşen alan yok.', 'No matching field.'))}</div>`;
    };
    draw();
    search.addEventListener('input', draw);
    popover.addEventListener('click', async event => {
      const option = event.target.closest('[data-postfob-add-filter-id]');
      if (!option) return;
      const entry = fields.find(item => item.id === option.dataset.postfobAddFilterId);
      if (!entry) return;
      closePopover();
      state.view = { ...view(), filters: [...view().filters, clone(entry.ref)] };
      await saveView({ immediate: true });
      render();
      const added = view().filters[view().filters.length - 1];
      const trigger = added && byId('postFobFilterBar')?.querySelector(`[data-postfob-filter="${CSS.escape(added.key)}"]`);
      if (trigger) openFilter(trigger, added.key);
    });
    search.focus();
  }

  /* ---------- Olaylar ---------- */
  function setCollapsed(keys) {
    state.view = { ...view(), display: { ...display(), collapsedGroups: keys } };
    const table = byId('postFobTable');
    if (window.BLMotionPlus?.pivotChange && table) window.BLMotionPlus.pivotChange(table, renderBody); else renderBody();
    void saveView({ silent: true });
  }
  function bind() {
    new MutationObserver(render).observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });
    byId('postFobRefreshBtn')?.addEventListener('click', () => void refresh(true));
    byId('postFobFieldsBtn')?.addEventListener('click', () => void openFields());
    byId('postFobExcelExportBtn')?.addEventListener('click', () => void exportExcel());
    byId('postFobResetBtn')?.addEventListener('click', async () => {
      state.view = clone(state.catalog.defaults);
      state.search = '';
      await saveView({ immediate: true });
      render();
      setStatus(() => text('Varsayılan görünüm geri yüklendi.', 'Default view restored.'), 'ok');
    });
    byId('postFobFiltersBtn')?.addEventListener('click', event => {
      event.stopPropagation();
      const panel = byId('postFobFilterPanel');
      setFilterPanelOpen(Boolean(panel && panel.hidden));
    });
    byId('postFobCollapseAllBtn')?.addEventListener('click', () => {
      const prepared = analysis.prepare(state.rows, { segment: view().segment, outliersOnly: view().outliersOnly, search: state.search });
      setCollapsed(groupPathKeys(prepared.visible));
    });
    byId('postFobExpandAllBtn')?.addEventListener('click', () => setCollapsed([]));
    byId('postFobSegment')?.addEventListener('change', event => { state.view = { ...view(), segment: event.target.value }; void saveView(); renderBody(); });
    byId('postFobOutliersOnly')?.addEventListener('change', event => { state.view = { ...view(), outliersOnly: event.target.checked }; void saveView(); renderBody(); });
    let searchTimer = 0;
    byId('postFobSearch')?.addEventListener('input', event => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => { state.search = clean(event.target.value).slice(0, 200); renderBody(); }, 150);
    });
    byId('postFobFilterBar')?.addEventListener('click', event => {
      const add = event.target.closest('[data-postfob-add-filter]');
      if (add) { void openFilterFieldPicker(add); return; }
      const remove = event.target.closest('[data-postfob-filter-remove]');
      if (remove) {
        const key = remove.dataset.postfobFilterRemove;
        const next = { ...view().filterValues };
        delete next[key];
        state.view = { ...view(), filterValues: next, filters: view().filters.filter(ref => ref.key !== key || !ref.source) };
        void saveView();
        render();
        return;
      }
      const trigger = event.target.closest('[data-postfob-filter]');
      if (trigger) openFilter(trigger, trigger.dataset.postfobFilter);
    });
    byId('postFobTable')?.addEventListener('dblclick', event => {
      if (event.target.closest('[data-postfob-group-key],thead')) return;
      const cell = event.target.closest('td'), row = cell && cell.closest('tr[data-postfob-row]');
      if (!row) return;
      event.preventDefault();
      const item = (state.displayItems || [])[Number(row.dataset.postfobRow)];
      const dims = [...view().rows, ...view().columns];
      // Değer sütunu: colspan'lı grup hücresi sonrası gerçek sütun indeksi hesaplanır.
      let column = 0;
      for (const td of row.cells) { if (td === cell) break; column += td.colSpan || 1; }
      const values = view().values, calcs = calcDefs();
      const calc = column >= dims.length + values.length ? calcs[column - dims.length - values.length] : null;
      const ref = calc ? { key: PCV().keyOf(calc), calc } : (column >= dims.length ? values[column - dims.length] : null);
      if (item) openDetail(item, ref);
    });
    byId('postFobTable')?.addEventListener('click', event => {
      const toggle = event.target.closest('[data-postfob-group-key]');
      if (toggle) {
        const collapsed = new Set(display().collapsedGroups || []);
        const key = toggle.dataset.postfobGroupKey;
        collapsed.has(key) ? collapsed.delete(key) : collapsed.add(key);
        setCollapsed([...collapsed]);
        return;
      }
      const header = event.target.closest('[data-postfob-sort]');
      if (!header || event.detail > 1) return;
      const key = header.dataset.postfobSort;
      const current = display().sort || {};
      const isDim = [...view().rows, ...view().columns].some(ref => ref.key === key);
      state.view = { ...view(), display: { ...display(), sort: { key, dir: current.key === key ? -Number(current.dir || -1) : (isDim ? 1 : -1) } } };
      void saveView({ silent: true });
      renderBody();
    });
    document.addEventListener('click', event => {
      if (state.popover && !state.popover.contains(event.target) && !event.target.closest('[data-postfob-filter],[data-postfob-add-filter]')) closePopover();
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
  window.BLPostFob = Object.freeze({ state, refresh: () => refresh(true), reload: loadState, openFields });
})();
