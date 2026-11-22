(function () {
  'use strict';

  /* TR/YD LANDED AVANTAJ — Genel Bakış › Ticari widget'ı.
     Aynı modelin Türkiye siparişinin FOB'u ile yurtdışı siparişinin landed
     maliyetini kıyaslar. Veri FOB Sonrası Maliyet sorgusu ve önbelleğidir
     (/api/postfob/tryd/*, server/routes/postfob-routes.js); hesap
     public/tryd-advantage-engine.js içindedir. Görünüm OAB/INTAKE/FOB Sonrası
     pivot sınıflarını (oabPivot*, intake*) kullanır. Widget görünmeden sunucuya
     istek atılmaz; canlı model sorgusu yalnız Yenile ile çalışır. Hedef, landed
     kaynağı, "yalnız hedef altı" ve arama yüklü satırlarda yeniden hesaplanır. */
  const section = document.getElementById('trydAdvantageSection');
  if (!section || window.BLTrydAdvantage) return;
  const engine = window.BLTrydAdvantageEngine;
  if (!engine) return;

  const MAX_TABLE_ROWS = 1500;
  const state = {
    view: engine.normalizePrefs(null), filters: [], rows: [], fetchedAt: '', missing: [], truncated: false, rowLimit: 10000, stale: false,
    connection: null, horizon: false, loaded: false, loading: false, started: false, status: null, popover: null,
    viewRevision: 0, exporting: false, search: '', displayItems: [], analysis: null,
  };

  const byId = id => document.getElementById(id);
  const isEnglish = () => typeof appLang !== 'undefined' && appLang === 'en';
  const text = (tr, en) => isEnglish() ? en : tr;
  const clean = value => String(value == null ? '' : value).trim();
  const esc = value => clean(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  const locale = () => isEnglish() ? 'en-GB' : 'tr-TR';
  const view = () => state.view;
  const isForecast = () => view().landedSource === 'forecast';

  /* ---------- Etiketler ---------- */
  const DIMS = [
    { key: 'buyerGroup', tr: 'Buyer grup', en: 'Buyer group' },
    { key: 'classification', tr: 'Ürün klasmanı', en: 'Product class' },
    { key: 'mag', tr: 'MAG', en: 'MAG' },
    { key: 'model', tr: 'Model', en: 'Model' },
  ];
  const VALUES = () => [
    { key: 'trFob', tr: 'TR FOB USD', en: 'TR FOB USD', format: 'usd', hint: ['TR siparişlerinin adet ağırlıklı FOB’u. Grup satırında YD adediyle ağırlıklıdır (FOB TR TUTAR / YD adet).', 'Quantity-weighted FOB of the TR orders. On group rows it is weighted by YD quantity (TR FOB amount / YD qty).'] },
    { key: 'ydFob', tr: 'YD FOB USD', en: 'Abroad FOB USD', format: 'usd', hint: ['Kıyaslanan YD satırlarında Σ(adet×FOB) / Σadet', 'Σ(qty×FOB) / Σqty on the compared abroad rows'] },
    { key: 'ydLanded', tr: isForecast() ? 'YD landed öngörü USD' : 'YD landed USD', en: isForecast() ? 'Abroad forecast landed USD' : 'Abroad landed USD', format: 'usd', hint: isForecast() ? ['Öngörü landed (gerçekleşmemiş): Σ(adet×öngörü) / Σadet', 'Forecast landed (not realized): Σ(qty×forecast) / Σqty'] : ['Gerçekleşen landed: Σ(adet×landed) / Σadet', 'Actual landed: Σ(qty×landed) / Σqty'] },
    { key: 'advantage', tr: isForecast() ? 'Öngörü avantajı' : 'Gerçekleşen avantaj', en: isForecast() ? 'Forecast advantage' : 'Realized advantage', format: 'pct', hint: ['1 − LANDED TUTAR / FOB TR TUTAR (tutarlardan; ortalama alınmaz)', '1 − landed amount / TR FOB amount (from amounts; never averaged)'] },
    { key: 'target', tr: 'Hedef', en: 'Target', format: 'pct' },
    { key: 'gap', tr: 'Fark (puan)', en: 'Gap (pts)', format: 'signedPct', hint: ['Avantaj − hedef, yüzde puan', 'Advantage − target, percentage points'] },
    { key: 'fobAdvantage', tr: 'FOB avantajı', en: 'FOB advantage', format: 'pct', hint: ['1 − FOB YD TUTAR / FOB TR TUTAR (aynı kıyaslanan satırlar)', '1 − abroad FOB amount / TR FOB amount (same compared rows)'] },
    { key: 'trQty', tr: 'TR adet', en: 'TR qty', format: 'qty' },
    { key: 'ydQty', tr: 'YD adet', en: 'Abroad qty', format: 'qty', hint: ['Kıyasa giren YD adedi (landed’i olan ve hatalı olmayan satırlar)', 'Compared abroad quantity (rows with a valid landed)'] },
    { key: 'coverage', tr: 'Landed kapsamı', en: 'Landed coverage', format: 'pct', hint: ['Kıyasa giren YD adedi / toplam YD adedi', 'Compared abroad qty / total abroad qty'] },
    { key: 'status', tr: 'Durum', en: 'Status', format: 'status' },
  ];
  const STATUS_COPY = { ok: ['OK', 'OK'], noLanded: ['Landed yok', 'No landed'], invalidLanded: ['Landed hatalı', 'Invalid landed'] };
  const statusText = status => STATUS_COPY[status] ? text(...STATUS_COPY[status]) : '';

  const ERROR_COPY = {
    POSTFOB_SEASON_REQUIRED: ['Sorgu için en az bir sezon seçin veya Veri Yönetimi’nde FOB Sonrası Maliyet ufku tanımlayın.', 'Select at least one season or define a Post-FOB Cost horizon in Data Management.'],
    POSTFOB_HORIZON_INVALID: ['Veri Yönetimi’ndeki FOB Sonrası Maliyet ufku uygulanamadı; filtreyi orada düzeltin.', 'The Post-FOB Cost horizon in Data Management could not be applied; fix the filter there.'],
    POSTFOB_SOURCE_UNAVAILABLE: ['FOB sonrası maliyet modeline şu anda ulaşılamıyor. Şirket ağı veya VPN bağlantısını kontrol edin.', 'The post-FOB cost model is unreachable right now. Check the company network or VPN connection.'],
    POSTFOB_SCHEMA_MISMATCH: ['Model beklenen FOB/adet alanlarını içermiyor; bağlantının kataloğunu kontrol edin.', 'The model does not contain the expected FOB/quantity fields; check the connection catalog.'],
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
    const node = byId('trydAdvantageStatus');
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
    usd: value => fmt(value, 2),
    pct: value => value == null ? '' : `%${fmt(value * 100, 1)}`,
    signedPct: value => value == null ? '' : `${value > 0 ? '+' : (value < 0 ? '−' : '')}${fmt(Math.abs(value) * 100, 1)}`,
    status: value => value || '',
  };
  const pctEn = value => value == null ? '' : `${fmt(value * 100, 1)}%`;
  const format = (key, value) => (key === 'pct' && isEnglish() ? pctEn : FORMATS[key])(value);

  /* ---------- Hesap ---------- */
  function compute() {
    state.analysis = engine.analyze(state.rows, { target: view().target, landedSource: view().landedSource, belowTargetOnly: view().belowTargetOnly, search: state.search });
    return state.analysis;
  }
  // Grup ve model satırının hücre değerleri; oranlar her düzeyde tutarlardan.
  function metricsOf(node) {
    const amounts = node.amounts || {};
    const isModel = node.kind === 'model';
    const groupStatus = () => {
      if (node.invalid) return text(`${node.invalid} hatalı`, `${node.invalid} invalid`);
      if (node.noLanded) return text(`${node.noLanded} landed yok`, `${node.noLanded} no landed`);
      return 'OK';
    };
    return {
      trFob: isModel ? node.trFob : (amounts.ydQty > 0 ? amounts.fobTrAmount / amounts.ydQty : null),
      ydFob: node.ydFob, ydLanded: node.ydLanded, advantage: node.advantage, target: view().target, gap: node.gap,
      fobAdvantage: node.fobAdvantage, trQty: amounts.trQty, ydQty: amounts.ydQty, coverage: node.coverage,
      status: isModel ? statusText(node.status) : groupStatus(),
    };
  }
  function flatten(tree) {
    const collapsed = new Set(view().collapsedGroups || []);
    const out = [];
    const walk = nodes => nodes.forEach(node => {
      if (node.kind === 'model') { out.push(node); return; }
      const isCollapsed = collapsed.has(node.pathKey);
      out.push({ ...node, collapsed: isCollapsed });
      if (!isCollapsed) walk(node.children);
    });
    walk(tree);
    return out;
  }
  function groupKeys(tree) {
    const keys = [];
    const walk = nodes => nodes.forEach(node => { if (node.kind === 'group') { keys.push(node.pathKey); walk(node.children); } });
    walk(tree);
    return keys;
  }
  const sourceRowsOf = node => node.kind === 'model' ? node.rows : (node.modelsList || []).flatMap(model => model.rows);

  /* ---------- Çizim ---------- */
  function renderMeta() {
    const node = byId('trydAdvantageStateMeta');
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
    const source = byId('trydAdvantageLandedSource');
    if (source) {
      source.innerHTML = [['actual', text('Gerçekleşen landed', 'Actual landed')], ['forecast', text('Öngörü landed (gerçekleşmemiş)', 'Forecast landed (not realized)')]]
        .map(([key, label]) => `<option value="${key}"${view().landedSource === key ? ' selected' : ''}>${esc(label)}</option>`).join('');
    }
    const target = byId('trydAdvantageTarget');
    if (target && document.activeElement !== target) target.value = String(Math.round(view().target * 1000) / 10);
    const below = byId('trydAdvantageBelowOnly');
    if (below) below.checked = Boolean(view().belowTargetOnly);
    const search = byId('trydAdvantageSearch');
    if (search && document.activeElement !== search) search.value = state.search;
    if (search) search.placeholder = text('Model, MAG, klasman ara…', 'Search model, MAG, class…');
  }

  function renderFilters() {
    const bar = byId('trydAdvantageFilterBar');
    if (!bar) return;
    const filters = state.filters.length ? state.filters : engine.FILTER_KEYS.map(key => ({ key, tr: key, en: key, required: key === 'season' }));
    bar.innerHTML = filters.map(ref => {
      const selected = view().filterValues[ref.key] || [];
      const label = selected.length > 1 ? `${selected.length} ${text('seçim', 'selected')}` : (selected[0] || text('Tümü', 'All'));
      const required = ref.key === 'season' && !state.horizon ? ` <span class="postFobRequired">${esc(text('(zorunlu)', '(required)'))}</span>` : '';
      return `<div class="intakeFilterField"><span class="intakeFilterLabel">${esc(text(ref.tr, ref.en))}${required}</span><div class="intakeFilterControl"><button type="button" class="oabMultiTrigger intakeFilterTrigger" data-tryd-filter="${esc(ref.key)}" aria-haspopup="listbox" aria-expanded="false"><span class="oabMultiLabel${selected.length ? ' hasValue' : ''}">${esc(label)}</span><span class="oabMultiChevron" aria-hidden="true">▾</span></button>${selected.length ? `<button type="button" class="intakeFilterRemove" data-tryd-filter-clear="${esc(ref.key)}" title="${esc(text('Seçimi temizle', 'Clear selection'))}" aria-label="${esc(text('Seçimi temizle', 'Clear selection'))}">×</button>` : ''}</div></div>`;
    }).join('') + `<p class="postFobNote trydAdvantageFilterNote">${esc(text('Üretici ülke filtrelenmez: kıyas Türkiye ve yurtdışı siparişlerini birlikte ister. Fas ve Mısır kıyas dışıdır.', 'Origin country is not filtered: the comparison needs Turkey and abroad orders together. Morocco and Egypt are excluded.'))}</p>`;
    const button = byId('trydAdvantageFiltersBtn');
    if (button) button.classList.toggle('hasActiveFilters', Object.keys(view().filterValues || {}).length > 0);
  }

  function kpi(value, label, title, cls) {
    return `<div class="kpi postFobKpi${cls ? ` ${cls}` : ''}"${title ? ` title="${esc(title)}"` : ''}><span class="n">${esc(value || '—')}</span><span class="l">${esc(label)}</span></div>`;
  }

  function updateGroupButtons(keys) {
    const collapsed = new Set(view().collapsedGroups || []);
    const expand = byId('trydAdvantageExpandAllBtn'), collapse = byId('trydAdvantageCollapseAllBtn');
    if (expand) { expand.hidden = !keys.length; expand.disabled = !keys.length || collapsed.size === 0; }
    if (collapse) { collapse.hidden = !keys.length; collapse.disabled = !keys.length; }
  }

  function dimCell(item, dimIndex) {
    if (item.kind === 'grand') return dimIndex === 0 ? `<td class="oabPivotGrandLabel" colspan="${DIMS.length}"><strong>${esc(text('Genel Toplam', 'Grand Total'))}</strong></td>` : '';
    if (item.kind === 'group') {
      if (dimIndex > item.level) return '';
      if (dimIndex < item.level) return '<td></td>';
      const label = item.label === '' ? text('(boş)', '(blank)') : item.label;
      const span = DIMS.length - item.level;
      const count = `<span class="oabPivotSubtotalTag">${esc(`${item.models} ${text('model', 'models')}`)}</span>`;
      return `<td class="oabPivotGroupCell trydAdvantageLabelCell"${span > 1 ? ` colspan="${span}"` : ''} title="${esc(label)}"><button type="button" class="oabPivotGroupToggle" data-tryd-group-key="${esc(item.pathKey)}" title="${esc(item.collapsed ? text('Grubu genişlet', 'Expand group') : text('Grubu daralt', 'Collapse group'))}">${item.collapsed ? '▸' : '▾'}</button><strong>${esc(label)}</strong>${count}</td>`;
    }
    return dimIndex === DIMS.length - 1 ? `<td class="trydAdvantageLabelCell">${esc(item.label)}</td>` : '<td></td>';
  }

  function valueCell(item, ref) {
    const metrics = metricsOf(item);
    const value = metrics[ref.key];
    const classes = ['num'];
    // Genel toplam satırı koyu zeminlidir; vurgu KPI'dadır, hücre renklendirilmez.
    if (ref.key === 'gap' && value != null && item.kind !== 'grand') classes.push(value < 0 ? 'trydAdvantageBelow' : 'trydAdvantageAbove');
    if (ref.key === 'status') { classes.splice(0, 1); if (item.kind === 'model' && item.status !== 'ok') classes.push(item.status === 'invalidLanded' ? 'trydAdvantageInvalid' : 'trydAdvantageNoLanded'); }
    const title = ref.key === 'status' && item.kind === 'model'
      ? text(`${item.statusCount.ok} OK · ${item.statusCount.noLanded} landed yok · ${item.statusCount.invalidLanded} hatalı satır`, `${item.statusCount.ok} OK · ${item.statusCount.noLanded} no landed · ${item.statusCount.invalidLanded} invalid rows`)
      : '';
    return `<td class="${classes.join(' ')}"${title ? ` title="${esc(title)}"` : ''}>${esc(format(ref.format, value))}</td>`;
  }

  function emptyMessage() {
    if (state.loaded) return text('Seçili filtrelerde satır yok. Filtreleri genişletip Yenile’ye basın.', 'No rows for the selected filters. Widen the filters and press Refresh.');
    if (state.horizon) return text('Veri Yönetimi’ndeki FOB Sonrası Maliyet ufku uygulanır. İsterseniz filtreleri daraltıp Yenile’ye basın.', 'The Post-FOB Cost horizon in Data Management applies. Optionally narrow the filters and press Refresh.');
    return text('Filtrelerden en az bir sezon seçip Yenile’ye basın. Veri FOB Sonrası Maliyet sorgusundan gelir; aynı filtrede o widget’ın önbelleği kullanılır.', 'Select at least one season in the filters and press Refresh. Data comes from the Post-FOB Cost query; for the same filters that widget’s cache is reused.');
  }

  function renderBody() {
    const body = byId('trydAdvantageBody'), table = byId('trydAdvantageTable'), kpis = byId('trydAdvantageKpis'), note = byId('trydAdvantageNote');
    if (!body || !table || !kpis) return;
    body.hidden = false;
    if (!state.rows.length) {
      kpis.innerHTML = '';
      if (note) note.hidden = true;
      updateGroupButtons([]);
      state.displayItems = [];
      table.innerHTML = `<tbody><tr><td class="intakeEmpty">${esc(emptyMessage())}</td></tr></tbody>`;
      return;
    }
    const result = compute();
    const total = result.total;
    const partial = state.truncated ? ` (${text('kısmi veri', 'partial data')})` : '';
    const advLabel = isForecast() ? text('Öngörü avantajı', 'Forecast advantage') : text('Gerçekleşen avantaj', 'Realized advantage');
    kpis.innerHTML = [
      kpi(format('pct', total.advantage), advLabel + partial, text('1 − Σ LANDED TUTAR / Σ FOB TR TUTAR', '1 − Σ landed amount / Σ TR FOB amount'), total.gap != null && total.gap < 0 ? 'trydAdvantageKpiBelow' : ''),
      kpi(format('pct', view().target), text('Hedef', 'Target')),
      kpi(FORMATS.signedPct(total.gap), text('Fark (puan)', 'Gap (pts)') + partial),
      kpi(format('pct', total.fobAdvantage), text('FOB avantajı', 'FOB advantage') + partial),
      kpi(`${total.compared.toLocaleString(locale())}`, text('Kıyaslanan model', 'Compared models'), text(`Yalnız TR: ${result.skipped.trOnly} · yalnız YD: ${result.skipped.ydOnly}`, `TR only: ${result.skipped.trOnly} · abroad only: ${result.skipped.ydOnly}`)),
      kpi(`${total.below.toLocaleString(locale())}`, text('Hedef altı model', 'Models below target'), '', total.below ? 'trydAdvantageKpiBelow' : ''),
      kpi(format('pct', total.coverage), text('Landed kapsamı (YD adet)', 'Landed coverage (abroad qty)')),
      kpi(`${total.invalid} / ${total.noLanded}`, text('Hatalı / landed yok model', 'Invalid / no-landed models'),
        result.bounds.upper != null
          ? text(`Hatalı: landed < FOB veya Landed/FOB > ${fmt(result.bounds.upper, 3)} / < ${fmt(result.bounds.lower, 3)} (Q3 + 3×IQR, ${result.bounds.sample} YD satırı)`, `Invalid: landed < FOB or Landed/FOB > ${fmt(result.bounds.upper, 3)} / < ${fmt(result.bounds.lower, 3)} (Q3 + 3×IQR, ${result.bounds.sample} abroad rows)`)
          : text('Hatalı: landed < FOB. Oran sınırı için en az 8 YD satırı gerekir.', 'Invalid: landed < FOB. At least 8 abroad rows are needed for a ratio bound.')),
    ].join('');
    const values = VALUES();
    const sort = view().sort || {};
    const arrow = key => sort.key === key ? (Number(sort.dir) === 1 ? ' ↑' : ' ↓') : '';
    const head = [...DIMS.map((dim, index) => `<th${index === DIMS.length - 1 ? ' data-tryd-sort="label"' : ''} title="${esc(index === DIMS.length - 1 ? text('Sıralamak için tıklayın', 'Click to sort') : '')}">${esc(text(dim.tr, dim.en))}${index === DIMS.length - 1 ? arrow('label') : ''}</th>`),
      ...values.map(ref => `<th class="num" data-tryd-sort="${esc(ref.key)}" title="${esc(ref.hint ? text(ref.hint[0], ref.hint[1]) : text('Sıralamak için tıklayın', 'Click to sort'))}">${esc(text(ref.tr, ref.en))}${arrow(ref.key)}</th>`)].join('');
    const tree = engine.buildTree(result.visible, { target: view().target, sort: { key: sort.key === 'target' || sort.key === 'status' ? 'label' : sort.key, dir: sort.dir } });
    const items = [...flatten(tree)];
    if (result.visible.length) items.push({ kind: 'grand', ...total, modelsList: result.visible });
    const shown = items.length > MAX_TABLE_ROWS ? [...items.slice(0, MAX_TABLE_ROWS - 1), items[items.length - 1]] : items;
    state.displayItems = shown;
    const rowClass = item => {
      const base = item.kind === 'grand' ? 'oabPivotGrandTotalRow' : (item.kind === 'group' ? 'oabPivotSubtotalRow' : '');
      return engine.isBelowTarget(item, view().target) ? `${base} trydAdvantageBelowRow`.trim() : base;
    };
    const bodyHtml = shown.map((item, index) => `<tr class="${rowClass(item)}" data-tryd-row="${index}">${DIMS.map((dim, dimIndex) => dimCell(item, dimIndex)).join('')}${values.map(ref => valueCell(item, ref)).join('')}</tr>`).join('');
    const emptyCopy = view().belowTargetOnly ? text('Hedefin altında kalan model yok.', 'No model is below the target.') : (state.search ? text('Aramayla eşleşen model yok.', 'No model matches the search.') : text('Hem Türkiye hem yurtdışı siparişi olan model yok.', 'No model has both Turkey and abroad orders.'));
    table.innerHTML = `<thead><tr>${head}</tr></thead><tbody>${bodyHtml || `<tr><td class="intakeEmpty" colspan="${DIMS.length + values.length}">${esc(emptyCopy)}</td></tr>`}</tbody>`;
    updateGroupButtons(groupKeys(tree));
    const drillTitle = text('Kaynak satırları görmek için çift tıklayın', 'Double-click to see the source rows');
    table.querySelectorAll('tbody tr[data-tryd-row] > td').forEach(td => { td.classList.add('oabPivotDrillCell'); if (!td.title) td.title = drillTitle; });
    try {
      const wordPx = label => Math.max(...String(label).split(/\s+/).map(word => word.length)) * 10 + 28;
      window.BLTableColumnResize?.apply(table, { store: widthStore, columns: [...DIMS.map((dim, index) => ({ key: `tryd_${dim.key}`, label: text(dim.tr, dim.en), type: 'text', minPx: index < DIMS.length - 1 ? 96 : 100 })), ...values.map(ref => ({ key: `tryd_${ref.key}`, label: text(ref.tr, ref.en), type: 'num', minPx: wordPx(text(ref.tr, ref.en)) }))] });
    } catch (error) { console.warn('TR/YD avantaj sütun genişliği uygulanamadı:', error); }
    const notes = [];
    if (state.truncated) notes.push(text(`Sorgu ${state.rowLimit.toLocaleString(locale())} satır sınırına ulaştı: bazı modellerin TR veya YD siparişleri eksik olabilir, avantaj oranları KISMİDİR. Sezon/MAG filtrelerini daraltıp Yenile’ye basın.`, `The query hit the ${state.rowLimit.toLocaleString(locale())} row limit: some models may miss TR or abroad orders, so the advantage ratios are PARTIAL. Narrow the season/MAG filters and press Refresh.`));
    if (isForecast()) notes.push(text('Öngörü landed kullanılıyor; bu gerçekleşmiş avantaj değildir.', 'Forecast landed is used; this is not the realized advantage.'));
    if (state.stale) notes.push(text('Son kayıtlı sonuç gösteriliyor; güncellemek için Yenile’ye basın.', 'Showing the last saved result; press Refresh to update.'));
    if (total.coverage != null && total.coverage < 0.95) notes.push(text(`Landed değeri kıyaslanan modellerin YD adedinin %${fmt(total.coverage * 100, 0)} kısmında geçerli; oranlar yalnız bu kısımdan hesaplandı.`, `A valid landed exists for ${fmt(total.coverage * 100, 0)}% of the abroad quantity of compared models; ratios use only that part.`));
    if (items.length > shown.length) notes.push(text(`İlk ${MAX_TABLE_ROWS.toLocaleString(locale())} satır gösteriliyor; grupları daraltın veya filtreleyin.`, `Showing the first ${MAX_TABLE_ROWS.toLocaleString(locale())} rows; collapse groups or filter.`));
    if (note) { note.hidden = !notes.length; note.textContent = notes.join(' '); note.classList.toggle('trydAdvantagePartial', state.truncated); }
  }

  /* ---------- Alt detay (OAB ile aynı ortak sağ çekmece) ---------- */
  const DETAIL_LABELS = {
    _side: ['Taraf', 'Side'], _status: ['Durum', 'Status'], _ratio: ['Landed/FOB', 'Landed/FOB'],
    order: ['Sipariş', 'Order'], model: ['Model', 'Model'], colour: ['Renk', 'Colour'], productName: ['Ürün adı', 'Product name'], season: ['Sezon', 'Season'],
    mag: ['MAG', 'MAG'], buyerGroup: ['Buyer grup', 'Buyer group'], classification: ['Ürün klasmanı', 'Product class'], originCountry: ['Üretici ülke', 'Origin country'],
    qty: ['Net sipariş adedi', 'Net order quantity'], fob: ['FOB USD', 'FOB USD'], landedActual: ['Landed gerçekleşen USD', 'Actual landed USD'], landedForecast: ['Landed öngörü USD', 'Forecast landed USD'],
  };
  const DETAIL_KEYS = ['_side', 'model', 'order', 'colour', 'originCountry', 'qty', 'fob', 'landedActual', 'landedForecast', '_ratio', '_status', 'mag', 'classification', 'buyerGroup', 'season', 'productName'];
  const detailLabel = key => DETAIL_LABELS[key] ? text(...DETAIL_LABELS[key]) : key;
  function annotate(rows) {
    const bounds = state.analysis ? state.analysis.bounds : null;
    return rows.map(row => {
      const side = engine.originClass(row);
      const status = side === 'yd' ? engine.rowStatus(row, bounds, view().landedSource) : null;
      return { ...row, _side: side === 'tr' ? 'TR' : 'YD', _status: status ? statusText(status) : '', _ratio: engine.rowRatio(row, view().landedSource) };
    });
  }
  function openDetail(item, ref) {
    const source = sourceRowsOf(item);
    if (!source.length) { setStatus(() => text('Bu satır için kaynak satır bulunamadı.', 'No source rows were found for this row.'), 'warning'); return; }
    if (!window.BLDetailDrawer || typeof window.BLDetailDrawer.open !== 'function') { setStatus(() => text('Alt detay çekmecesi yüklenemedi.', 'The drill-down drawer could not be loaded.'), 'error'); return; }
    const rows = annotate(source);
    const numeric = key => rows.some(row => typeof row[key] === 'number');
    const columns = DETAIL_KEYS.filter(key => rows.some(row => row[key] !== undefined)).map(key => ({
      key, label: detailLabel(key), type: numeric(key) ? 'number' : 'text',
      ...(numeric(key) ? { format: value => value == null || value === '' ? '' : (key === 'qty' ? FORMATS.qty(value) : (key === '_ratio' ? `${fmt(value, 3)}×` : fmt(value, 2))) } : {}),
    }));
    const context = item.kind === 'grand' ? text('Genel Toplam', 'Grand Total')
      : (item.path || []).map((value, index) => `${text(DIMS[index].tr, DIMS[index].en)}: ${value === '' ? text('(boş)', '(blank)') : value}`).join(' › ');
    const metrics = metricsOf(item);
    const valueRef = ref && VALUES().find(entry => entry.key === ref);
    const note = [valueRef ? `${text(valueRef.tr, valueRef.en)}: ${format(valueRef.format, metrics[valueRef.key])}` : '', `${rows.length.toLocaleString(locale())} ${text('kaynak satır', 'source rows')}`].filter(Boolean).join(' · ');
    window.BLDetailDrawer.open({
      storageKey: 'tryd.advantage.detail', pageScope: 'overview.trydAdvantage', moduleId: 'overview', source: 'trydAdvantage',
      title: text('TR/YD Landed Avantaj Alt Detay', 'TR/Abroad Landed Advantage Drill-down'),
      subtitle: context, note, rows, columns,
      defaultVisible: DETAIL_KEYS.filter(key => columns.some(column => column.key === key)).slice(0, 11),
      exactDefaultVisible: true, flatColumns: true, images: false, fileName: 'TR_YD_Landed_Avantaj_Alt_Detay',
    });
  }

  /* ---------- Excel (pivot + modeller + kaynak satırlar + özet) ---------- */
  async function exportExcel() {
    if (state.exporting || !state.rows.length) return;
    state.exporting = true;
    paintExportButton();
    try {
      if (!window.XLSX && window.BLPerf?.ensureLibrary) await window.BLPerf.ensureLibrary('xlsx');
      const X = window.XLSX;
      if (!X) throw new Error('XLSX');
      const result = compute();
      const values = VALUES();
      const round = value => typeof value === 'number' && Number.isFinite(value) ? Math.round(value * 1000000) / 1000000 : (value == null ? null : value);
      const tree = engine.buildTree(result.visible, { target: view().target });
      const all = [];
      const walk = nodes => nodes.forEach(node => { all.push(node); if (node.kind === 'group') walk(node.children); });
      walk(tree);
      if (result.visible.length) all.push({ kind: 'grand', ...result.total, modelsList: result.visible });
      const pivot = all.map(item => {
        const out = { [text('Satır tipi', 'Row type')]: item.kind === 'grand' ? text('Genel toplam', 'Grand total') : (item.kind === 'group' ? text('Alt toplam', 'Subtotal') : text('Model', 'Model')) };
        DIMS.forEach((dim, index) => {
          out[text(dim.tr, dim.en)] = item.kind === 'grand' ? '' : (item.kind === 'model' ? (index === DIMS.length - 1 ? item.model : item[dim.key]) : (index <= item.level ? item.path[index] : ''));
        });
        const metrics = metricsOf(item);
        values.forEach(ref => { out[text(ref.tr, ref.en)] = ref.key === 'status' ? metrics.status : round(metrics[ref.key]); });
        const amounts = item.amounts || {};
        out[text('FOB TR TUTAR', 'TR FOB amount')] = round(amounts.fobTrAmount);
        out[text('LANDED TUTAR', 'Landed amount')] = round(amounts.landedAmount);
        out[text('FOB YD TUTAR', 'Abroad FOB amount')] = round(amounts.fobYdAmount);
        out[text('Toplam YD adet', 'Total abroad qty')] = round(amounts.ydQtyAll);
        return out;
      });
      const source = annotate(result.visible.flatMap(model => model.rows)).map(row => Object.fromEntries(DETAIL_KEYS.filter(key => row[key] !== undefined).map(key => [detailLabel(key), round(row[key])])));
      const summaryRow = (field, value) => ({ [text('Alan', 'Field')]: field, [text('Değer', 'Value')]: value });
      const summary = [
        ...state.filters.filter(ref => (view().filterValues[ref.key] || []).length).map(ref => summaryRow(text(ref.tr, ref.en), view().filterValues[ref.key].join(', '))),
        summaryRow(text('Landed kaynağı', 'Landed source'), isForecast() ? text('Öngörü (gerçekleşmemiş)', 'Forecast (not realized)') : text('Gerçekleşen', 'Actual')),
        summaryRow(text('Hedef', 'Target'), view().target),
        summaryRow(text('Yalnız hedef altı', 'Below target only'), view().belowTargetOnly ? text('Evet', 'Yes') : text('Hayır', 'No')),
        ...(state.search ? [summaryRow(text('Arama', 'Search'), state.search)] : []),
        summaryRow(text('Kapsam', 'Scope'), text('TR = Türkiye; YD = diğer ülkeler, Fas ve Mısır hariç; yalnız TR+YD siparişi olan modeller', 'TR = Turkey; abroad = other countries except Morocco and Egypt; only models with both TR and abroad orders')),
        summaryRow(text('Hatalı landed kuralı', 'Invalid landed rule'), result.bounds.upper != null ? `landed < FOB | Landed/FOB > ${round(result.bounds.upper)} | < ${round(result.bounds.lower)} (Q3 ± 3×IQR)` : 'landed < FOB'),
        summaryRow(text('Yalnız TR / yalnız YD model', 'TR only / abroad only models'), `${result.skipped.trOnly} / ${result.skipped.ydOnly}`),
        ...(state.horizon ? [summaryRow(text('Veri Yönetimi ufku', 'Data Management horizon'), text('Uygulandı', 'Applied'))] : []),
        summaryRow(text('Son yenileme', 'Last refresh'), state.fetchedAt),
        summaryRow(text('Kaynak', 'Source'), state.connection ? `${state.connection.server} / ${state.connection.catalog}` : ''),
        ...(state.truncated ? [summaryRow(text('Uyarı', 'Warning'), text('Sorgu satır sınırına ulaştı; avantaj oranları kısmidir.', 'The query hit the row limit; advantage ratios are partial.'))] : []),
      ];
      const book = X.utils.book_new();
      X.utils.book_append_sheet(book, X.utils.json_to_sheet(pivot), 'Pivot');
      X.utils.book_append_sheet(book, X.utils.json_to_sheet(source), text('Kaynak satırlar', 'Source rows').slice(0, 31));
      X.utils.book_append_sheet(book, X.utils.json_to_sheet(summary), text('Özet', 'Summary'));
      X.writeFile(book, `TR_YD_Landed_Avantaj_${new Date().toISOString().slice(0, 10).replace(/-/g, '')}.xlsx`, { compression: true });
    } catch (error) {
      setStatus(() => text('Excel dosyası oluşturulamadı.', 'The Excel file could not be created.'), 'error');
    } finally { state.exporting = false; paintExportButton(); }
  }
  function paintExportButton() {
    const button = byId('trydAdvantageExcelExportBtn');
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
    const refresh = byId('trydAdvantageRefreshBtn');
    if (refresh) { refresh.disabled = state.loading; refresh.setAttribute('aria-busy', state.loading ? 'true' : 'false'); }
    byId('trydAdvantageBody')?.classList.toggle('isBusy', state.loading);
    paintExportButton();
  }

  const widths = {};
  const widthStore = { get: id => (Number.isFinite(widths[id]) ? widths[id] : null), set: (id, px) => { widths[id] = Math.round(px); }, save: () => {} };

  function applyData(payload) {
    state.rows = Array.isArray(payload && payload.rows) ? payload.rows : [];
    state.fetchedAt = clean(payload && payload.fetchedAt);
    state.missing = Array.isArray(payload && payload.missing) ? payload.missing : [];
    state.truncated = Boolean(payload && payload.truncated);
    state.rowLimit = Number(payload && payload.rowLimit) || state.rowLimit;
    state.stale = Boolean(payload && payload.stale);
  }

  /* ---------- Veri ---------- */
  async function loadState() {
    try {
      const payload = await requestJson('/api/postfob/tryd/state');
      state.view = engine.normalizePrefs(payload.view);
      state.filters = Array.isArray(payload.filters) ? payload.filters : [];
      state.connection = payload.connection || null;
      state.horizon = Boolean(payload.horizon);
      state.rowLimit = Number(payload.rowLimit) || state.rowLimit;
      if (payload.data) { applyData(payload.data); state.loaded = true; }
      setStatus(state.truncated ? truncatedStatus : null, state.truncated ? 'warning' : '');
    } catch (error) { setStatus(error.message || String(error), 'error'); }
    render();
  }
  const truncatedStatus = () => text('Veri satır sınırında kesildi; avantaj oranları kısmidir.', 'Data was cut at the row limit; advantage ratios are partial.');

  /* Tercih sunucuya kaydedilir; yanıt ancak gönderildiği revizyon güncelse uygulanır. */
  let saveTimer = 0;
  function saveView(options = {}) {
    state.viewRevision += 1;
    const revision = state.viewRevision;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      try {
        const result = await requestJson('/api/postfob/tryd/view', jsonBody('PUT', { view: view() }));
        if (revision === state.viewRevision && result.view) state.view = engine.normalizePrefs(result.view);
      } catch (error) { if (!options.silent) setStatus(error.message || String(error), 'error'); }
    }, options.immediate ? 0 : 300);
  }

  async function refresh(force) {
    if (state.loading) return;
    if (!state.horizon && !(view().filterValues.season || []).length) {
      setStatus(() => text('Sorgu için en az bir sezon seçin veya Veri Yönetimi’nde FOB Sonrası Maliyet ufku tanımlayın.', 'Select at least one season or define a Post-FOB Cost horizon in Data Management.'), 'warning');
      setFilterPanelOpen(true);
      return;
    }
    state.loading = true;
    setStatus(() => text('FOB sonrası maliyet modeli sorgulanıyor…', 'Querying the post-FOB cost model…'), 'loading');
    render();
    try {
      clearTimeout(saveTimer);
      const revision = state.viewRevision;
      const payload = await requestJson('/api/postfob/tryd/report', jsonBody('POST', { view: view(), forceRefresh: Boolean(force) }));
      if (payload.view && revision === state.viewRevision) state.view = engine.normalizePrefs(payload.view);
      applyData(payload);
      state.loaded = true;
      if (payload.offline) setStatus(() => text('Model şu anda erişilemiyor; son kayıtlı sonuç gösteriliyor.', 'The model is unreachable; showing the last saved result.'), 'warning');
      else if (state.truncated) setStatus(truncatedStatus, 'warning');
      else setStatus(payload.fromCache ? () => text('Son 30 dakikadaki aynı FOB Sonrası sorgusunun sonucu gösteriliyor.', 'Showing the result of the same Post-FOB query from the last 30 minutes.') : null, payload.fromCache ? 'ok' : '');
    } catch (error) { setStatus(error.message || String(error), 'error'); }
    finally { state.loading = false; render(); }
  }

  /* ---------- Filtre paneli ve değer seçici ---------- */
  function setFilterPanelOpen(open) {
    const panel = byId('trydAdvantageFilterPanel'), button = byId('trydAdvantageFiltersBtn');
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
    section.querySelectorAll('[data-tryd-filter][aria-expanded="true"]').forEach(button => button.setAttribute('aria-expanded', 'false'));
  }
  function openFilter(button, key) {
    closePopover();
    const ref = state.filters.find(entry => entry.key === key) || { key, tr: key, en: key };
    const selected = new Set(view().filterValues[key] || []);
    let values = [...new Set([...state.rows.map(row => clean(row && row[key])).filter(Boolean), ...selected])].sort((a, b) => a.localeCompare(b, 'tr', { numeric: true }));
    const popover = document.createElement('div');
    popover.className = 'oabLocalFilterAddPopover intakeFilterPopover';
    popover.setAttribute('role', 'dialog');
    popover.setAttribute('aria-label', text(ref.tr, ref.en));
    popover.innerHTML = `<div class="intakeFilterPopoverTitle">${esc(text(ref.tr, ref.en))}</div><input type="search" class="intakeFilterSearch" placeholder="${esc(text('Değerlerde ara…', 'Search values…'))}" aria-label="${esc(text('Değerlerde ara', 'Search values'))}"><div class="intakeFilterValues"><div class="intakeConfigEmpty">${esc(text('Değerler yükleniyor…', 'Loading values…'))}</div></div><div class="intakeFilterActions"><button type="button" class="tbtn" data-tryd-clear>${esc(text('Temizle', 'Clear'))}</button><button type="button" class="tbtn primary" data-tryd-apply>${esc(text('Uygula', 'Apply'))}</button></div>`;
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
        : `<div class="intakeConfigEmpty">${esc(text('Değer bulunamadı.', 'No values found.'))}</div>`;
    };
    search.addEventListener('input', draw);
    popover.addEventListener('change', event => { if (event.target.matches('input[type="checkbox"]')) { if (event.target.checked) selected.add(event.target.value); else selected.delete(event.target.value); } });
    popover.querySelector('[data-tryd-clear]').addEventListener('click', () => { selected.clear(); draw(); });
    popover.querySelector('[data-tryd-apply]').addEventListener('click', () => {
      const next = { ...view().filterValues };
      if (selected.size) next[key] = [...selected]; else delete next[key];
      state.view = { ...view(), filterValues: next };
      closePopover();
      saveView();
      renderFilters();
      setStatus(() => text('Filtre değişti. Veriyi çekmek için Yenile’ye basın.', 'Filters changed. Press Refresh to query data.'), 'ok');
    });
    requestJson('/api/postfob/distinct', jsonBody('POST', { key }))
      .then(result => { values = [...new Set([...(Array.isArray(result.values) ? result.values : []), ...selected])]; if (state.popover === popover) draw(); })
      .catch(() => { if (state.popover === popover) draw(); });
    search.focus();
  }

  /* ---------- Olaylar ---------- */
  function setCollapsed(keys) {
    state.view = { ...view(), collapsedGroups: keys };
    const table = byId('trydAdvantageTable');
    if (window.BLMotionPlus?.pivotChange && table) window.BLMotionPlus.pivotChange(table, renderBody); else renderBody();
    saveView({ silent: true });
  }
  function currentTreeKeys() {
    if (!state.rows.length) return [];
    return groupKeys(engine.buildTree(compute().visible, { target: view().target }));
  }
  function bind() {
    new MutationObserver(render).observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });
    byId('trydAdvantageRefreshBtn')?.addEventListener('click', () => void refresh(true));
    byId('trydAdvantageExcelExportBtn')?.addEventListener('click', () => void exportExcel());
    byId('trydAdvantageFiltersBtn')?.addEventListener('click', event => {
      event.stopPropagation();
      const panel = byId('trydAdvantageFilterPanel');
      setFilterPanelOpen(Boolean(panel && panel.hidden));
    });
    byId('trydAdvantageCollapseAllBtn')?.addEventListener('click', () => setCollapsed(currentTreeKeys()));
    byId('trydAdvantageExpandAllBtn')?.addEventListener('click', () => setCollapsed([]));
    byId('trydAdvantageLandedSource')?.addEventListener('change', event => { state.view = { ...view(), landedSource: event.target.value === 'forecast' ? 'forecast' : 'actual' }; saveView(); render(); });
    byId('trydAdvantageBelowOnly')?.addEventListener('change', event => { state.view = { ...view(), belowTargetOnly: event.target.checked }; saveView(); renderBody(); });
    byId('trydAdvantageTarget')?.addEventListener('change', event => {
      const percent = Number(String(event.target.value).replace(',', '.'));
      if (!Number.isFinite(percent)) { event.target.value = String(Math.round(view().target * 1000) / 10); return; }
      state.view = engine.normalizePrefs({ ...view(), target: percent / 100 });
      saveView();
      render();
    });
    let searchTimer = 0;
    byId('trydAdvantageSearch')?.addEventListener('input', event => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => { state.search = clean(event.target.value).slice(0, 200); renderBody(); }, 150);
    });
    byId('trydAdvantageFilterBar')?.addEventListener('click', event => {
      const clear = event.target.closest('[data-tryd-filter-clear]');
      if (clear) {
        const next = { ...view().filterValues };
        delete next[clear.dataset.trydFilterClear];
        state.view = { ...view(), filterValues: next };
        saveView();
        renderFilters();
        return;
      }
      const trigger = event.target.closest('[data-tryd-filter]');
      if (trigger) openFilter(trigger, trigger.dataset.trydFilter);
    });
    byId('trydAdvantageTable')?.addEventListener('dblclick', event => {
      if (event.target.closest('[data-tryd-group-key],thead')) return;
      const cell = event.target.closest('td'), row = cell && cell.closest('tr[data-tryd-row]');
      if (!row) return;
      event.preventDefault();
      const item = state.displayItems[Number(row.dataset.trydRow)];
      let column = 0;
      for (const td of row.cells) { if (td === cell) break; column += td.colSpan || 1; }
      const ref = column >= DIMS.length ? (VALUES()[column - DIMS.length] || {}).key : null;
      if (item) openDetail(item, ref);
    });
    byId('trydAdvantageTable')?.addEventListener('click', event => {
      const toggle = event.target.closest('[data-tryd-group-key]');
      if (toggle) {
        const collapsed = new Set(view().collapsedGroups || []);
        const key = toggle.dataset.trydGroupKey;
        if (collapsed.has(key)) collapsed.delete(key); else collapsed.add(key);
        setCollapsed([...collapsed]);
        return;
      }
      const header = event.target.closest('[data-tryd-sort]');
      if (!header || event.detail > 1) return;
      const key = header.dataset.trydSort;
      const current = view().sort || {};
      state.view = engine.normalizePrefs({ ...view(), sort: { key, dir: current.key === key ? -Number(current.dir || 1) : (key === 'label' ? 1 : -1) } });
      saveView({ silent: true });
      renderBody();
    });
    document.addEventListener('click', event => {
      if (state.popover && !state.popover.contains(event.target) && !event.target.closest('[data-tryd-filter]')) closePopover();
      const panel = byId('trydAdvantageFilterPanel');
      if (panel && !panel.hidden && !panel.contains(event.target) && !event.target.closest('#trydAdvantageFiltersBtn,#trydAdvantageRefreshBtn,.intakeFilterPopover')) setFilterPanelOpen(false);
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
  window.BLTrydAdvantage = Object.freeze({ state, refresh: () => refresh(true), reload: loadState });
})();
