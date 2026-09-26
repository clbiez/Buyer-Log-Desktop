/* Buyer Log v9.46 — BACKLOG TESLİMAT RİSKİ ANALİZİ (görünüm katmanı)
 *
 * İş mantığı BURADA DEĞİL: hesap backlog-delivery-engine.js'te, yorumlar
 * backlog-delivery-insights.js'te. Bu dosya yalnız çizer, tıklamayı bağlar ve
 * kullanıcı tercihlerini saklar.
 *
 * TEK VERİ KAYNAĞI: analiz kendi filtresini KURMAZ. Backlog ekranındaki aktif
 * filtre (buildBacklogParams) neyse, satırlar da /api/backlog-export ile tam
 * olarak o filtreyle çekilir — yetki (requireArea + filterRowsByScope) sunucu
 * tarafında analizden ÖNCE uygulanır. Toplamlar Backlog'un kendi
 * lastBacklogData değerleriyle karşılaştırılır; ayrışırsa kullanıcıya söylenir.
 */
(function () {
  'use strict';
  const Engine = window.BLBacklogDeliveryEngine;
  const Insights = window.BLBacklogDeliveryInsights;
  if (!Engine || !Insights) return;

  const STORAGE_KEY = 'lcw.backlog.analysis.v1';
  const DIM_TABS = Engine.DIMENSIONS;

  const state = {
    open: false,
    loading: false,
    error: '',
    rows: null,
    rowsSignature: '',
    model: null,
    insights: [],
    dim: 'buyer',
    measure: 'qty',            // 'qty' | 'orders'
    insightLimit: 3,
    // Rapor sade başlar: yalnız özet, aksiyon gerektirenler ve en riskli siparişler açık.
    folds: { cause: false, insights: true, attention: true, performance: false, stage: false, dimension: false, topRisk: true, quality: false },
    automate: false,
    showAllInsights: false,
    period: { mode: 'all', from: '', to: '' },
    periodRowCount: 0,
    totalRowCount: 0,
    settings: { ...Engine.DEFAULT_SETTINGS },
    preferences: Insights.defaultPreferences(),
    customRules: [],
    parity: null,
  };

  /* ------------------------------------------------------------ yardımcılar */
  const isEn = () => typeof appLang !== 'undefined' && appLang === 'en';
  const L = (tr, en) => (isEn() ? en : tr);
  const lang = () => (isEn() ? 'en' : 'tr');
  const locale = () => (isEn() ? 'en-GB' : 'tr-TR');
  const esc = value => (typeof escapeHtml === 'function' ? escapeHtml(String(value == null ? '' : value))
    : String(value == null ? '' : value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch])));
  const int = value => Math.round(Number(value) || 0).toLocaleString(locale());
  const pct = value => (isEn()
    ? `${(Number(value) || 0).toLocaleString(locale(), { maximumFractionDigits: 1 })}%`
    : `%${(Number(value) || 0).toLocaleString(locale(), { maximumFractionDigits: 1 })}`);
  const outcomeLabel = key => Engine.OUTCOME_LABELS[lang()][key] || key;
  const stageLabel = key => Engine.STAGE_LABELS[lang()][key] || key;
  const causeLabel = key => Engine.RISK_CAUSE_LABELS[lang()][key] || key;
  const loadingLabel = key => Engine.LOADING_LABELS[lang()][key] || key;
  const dimLabel = key => Engine.DIMENSION_LABELS[lang()][key] || key;
  const measureOf = measure => (state.measure === 'orders' ? measure.orders : measure.qty);
  const measureWord = () => (state.measure === 'orders' ? L('sipariş', 'orders') : L('adet', 'units'));

  function load() {
    try {
      const saved = JSON.parse(BLStorage.getItem(STORAGE_KEY) || '{}') || {};
      if (DIM_TABS.includes(saved.dim)) state.dim = saved.dim;
      if (saved.measure === 'orders' || saved.measure === 'qty') state.measure = saved.measure;
      if (Number.isFinite(Number(saved.insightLimit))) state.insightLimit = Math.max(3, Math.min(40, Number(saved.insightLimit)));
      if (saved.preferences && typeof saved.preferences === 'object') state.preferences = { ...state.preferences, ...saved.preferences };
      if (saved.settings && typeof saved.settings === 'object') state.settings = { ...state.settings, ...saved.settings };
      if (Array.isArray(saved.customRules)) state.customRules = saved.customRules.map((rule, index) => Insights.normalizeRule(rule, index));
      if (typeof saved.open === 'boolean') state.open = saved.open;
      if (saved.folds && typeof saved.folds === 'object') Object.keys(state.folds).forEach(key => { if (typeof saved.folds[key] === 'boolean') state.folds[key] = saved.folds[key]; });
    } catch (_) { /* bozuk tercih uygulamayı düşürmez */ }
  }
  function save() {
    try {
      BLStorage.setItem(STORAGE_KEY, JSON.stringify({
        dim: state.dim, measure: state.measure, insightLimit: state.insightLimit,
        preferences: state.preferences, settings: state.settings, customRules: state.customRules, open: state.open, folds: state.folds,
      }));
    } catch (_) {}
  }

  /* ------------------------------------------------------------------ veri */
  function currentSignature() {
    try { return JSON.stringify(backlogExportQueryParams()); } catch (_) { return ''; }
  }

  async function fetchRows() {
    const params = backlogExportQueryParams();
    const qs = new URLSearchParams(params).toString();
    const response = await fetch(`/api/backlog-export?${qs}`, { credentials: 'same-origin' });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data && data.error ? data.error : `HTTP ${response.status}`);
    return Array.isArray(data.rows) ? data.rows : [];
  }

  /* Backlog'un kendi verisi app-main.js'te `let` ile tanımlı; `let` window
     üzerinde ÖZELLİK OLUŞTURMAZ, bu yüzden window.lastBacklogData her zaman
     undefined'dır. Serbest tanımlayıcıyla okunur. */
  function backlogSnapshot() {
    try { return typeof lastBacklogData !== 'undefined' ? lastBacklogData : null; } catch (_) { return null; }
  }

  /* Hedefe göre dönem filtresi: seçili hedefin (Retail Depo / In Store)
     TARİHİNE göre satırları daraltır. Bu, Backlog'un filtresinin yerine
     geçmez — onun döndürdüğü kümeyi daraltır; başlıkta açıkça yazılır. */
  function periodBounds() {
    const period = state.period;
    if (!period || period.mode === 'all') return null;
    const ordinal = typeof dateOrdinal === 'function' ? dateOrdinal : Engine.defaultOrdinal;
    if (period.mode === 'range') {
      const from = period.from ? ordinal(period.from) : null;
      const to = period.to ? ordinal(period.to) : null;
      return (from == null && to == null) ? null : { from, to };
    }
    const today = ordinal(new Date());
    const monday = today - ((new Date().getDay() + 6) % 7);
    if (period.mode === 'thisWeek') return { from: monday, to: monday + 6 };
    if (period.mode === 'nextWeek') return { from: monday + 7, to: monday + 13 };
    if (period.mode === 'twoWeeks') return { from: monday, to: monday + 13 };
    return null;
  }

  function applyPeriod(rows) {
    const bounds = periodBounds();
    if (!bounds) return rows;
    const ordinal = typeof dateOrdinal === 'function' ? dateOrdinal : Engine.defaultOrdinal;
    const field = state.settings.targetType === 'inStore' ? Engine.FIELDS.inStore : Engine.FIELDS.retail;
    return rows.filter(row => {
      const value = ordinal(row[field]);
      if (value == null) return false;
      if (bounds.from != null && value < bounds.from) return false;
      if (bounds.to != null && value > bounds.to) return false;
      return true;
    });
  }

  function computeModel() {
    const ordinal = typeof dateOrdinal === 'function' ? dateOrdinal : Engine.defaultOrdinal;
    const allRows = state.rows || [];
    const rows = applyPeriod(allRows);
    state.periodRowCount = rows.length;
    state.totalRowCount = allRows.length;
    const model = Engine.analyze(rows, {
      settings: state.settings,
      dateOrdinal: ordinal,
      today: ordinal(new Date()),
    });
    state.model = model;
    state.insights = Insights.build(model, {
      lang: lang(), preferences: state.preferences, customRules: state.customRules,
    });
    /* §63 — filtre eşitliği. Analiz, Backlog ekranının gördüğü kümeyi
       görmelidir; sapma varsa gizlenmez, kullanıcıya söylenir. Dönem filtresi
       açıkken karşılaştırma DAR küme üzerinden yapılamaz: bu durumda tüm
       satırların toplamı kullanılır. */
    const backlog = backlogSnapshot();
    if (!backlog) { state.parity = null; return; }
    const allQty = allRows.reduce((total, row) => total + (Number(row[Engine.FIELDS.qty]) || 0), 0);
    const allOrders = new Set(allRows.map(row =>
      `${row[Engine.FIELDS.orderCode]}|${Engine.dimKey(row[Engine.FIELDS.model])}|${Engine.dimKey(row[Engine.FIELDS.colourCode])}`)).size;
    state.parity = {
      backlogQty: Number(backlog.totalQty) || 0,
      backlogOrders: Number(backlog.totalOrders) || 0,
      analysisQty: allQty,
      analysisOrders: allOrders,
      match: (Number(backlog.totalQty) || 0) === allQty && (Number(backlog.totalOrders) || 0) === allOrders,
    };
  }

  async function refresh(force) {
    if (!state.open) return;
    const signature = currentSignature();
    if (!force && state.rows && signature === state.rowsSignature) { computeModel(); render(); return; }
    state.loading = true; state.error = ''; render();
    try {
      state.rows = await fetchRows();
      state.rowsSignature = signature;
      computeModel();
    } catch (error) {
      state.error = error && error.message ? error.message : String(error);
      state.rows = null; state.model = null;
    } finally {
      state.loading = false; render();
    }
  }

  /* -------------------------------------------------------------- drilldown */
  function openOrders(title, orders) {
    const rows = (orders || []).map(order => order.sourceRow).filter(Boolean);
    if (!rows.length) { if (typeof showToast === 'function') showToast(L('Gösterilecek sipariş bulunamadı.', 'No orders to show.')); return; }
    if (typeof openBacklogDetailShell !== 'function' || typeof renderBacklogDetailTable !== 'function') return;
    openBacklogDetailShell(`${title} · ${int(rows.length)} ${L('satır', 'rows')}`, L('Yükleniyor…', 'Loading…'));
    const headers = Object.keys(rows[0]).filter(key => !key.startsWith('_'));
    renderBacklogDetailTable(rows, headers);
  }
  const ordersWhere = predicate => (state.model ? state.model.orders.filter(predicate) : []);

  /* ---------------------------------------------------------------- çizim */
  /* Açılır/kapanır bölüm başlığı. Gövde her zaman çizilir (tıklama anında
     yeniden hesap yok); kapalıyken CSS gizler. Özet, kapalı bölümün tek
     satırlık cevabıdır. */
  function foldHead(key, title, summary, extraClass) {
    const open = state.folds[key] !== false;
    return `<div class="bdaSection bdaFold${extraClass ? ` ${extraClass}` : ''}${open ? ' is-open' : ''}" data-fold="${esc(key)}">
      <button type="button" class="bdaFoldHead" data-fold-toggle="${esc(key)}" aria-expanded="${open ? 'true' : 'false'}">
        <span class="bdaH">${esc(title)}</span>${summary ? `<span class="bdaFoldSummary">${esc(summary)}</span>` : ''}<span class="bdaFoldChevron" aria-hidden="true"></span>
      </button><div class="bdaFoldBody">`;
  }

  function kpiCard(key, measure, total, tone) {
    const value = measureOf(measure);
    const share = total > 0 ? value / total * 100 : 0;
    return `<button type="button" class="bdaKpi is-${tone}" data-outcome="${esc(key)}">
      <span class="bdaKpiLabel">${esc(outcomeLabel(key))}</span>
      <span class="bdaKpiValue">${esc(int(value))}</span>
      <span class="bdaKpiMeta">${esc(int(measure.orders))} ${esc(L('sipariş', 'orders'))} · ${esc(pct(share))}</span>
    </button>`;
  }

  function renderOutcomeRow(model) {
    const total = measureOf(model.totals);
    const tones = { ON_TRACK: 'ok', AT_RISK: 'warn', EXPECTED_LATE: 'bad', ALREADY_LATE: 'bad', UNKNOWN: 'mute' };
    const cards = Engine.OUTCOMES.map(key => kpiCard(key, model.deliveryOutcome[key], total, tones[key])).join('');
    return `<div class="bdaKpiRow">
      <div class="bdaKpi is-total"><span class="bdaKpiLabel">${esc(L('Toplam Backlog', 'Total Backlog'))}</span>
        <span class="bdaKpiValue">${esc(int(total))}</span>
        <span class="bdaKpiMeta">${esc(int(model.totals.orders))} ${esc(L('sipariş', 'orders'))}</span></div>
      ${cards}
    </div>
    <div class="bdaAutomateRow"><button type="button" class="bdaLink bdaAutomateToggle" data-action="toggleAutomate" aria-expanded="${state.automate ? 'true' : 'false'}">✉ ${esc(state.automate ? L('Otomasyon bağlantılarını gizle', 'Hide automation shortcuts') : L('Bu sonuçlardan otomasyon kur', 'Create automation from these results'))}</button>${state.automate ? ['ALREADY_LATE', 'EXPECTED_LATE', 'AT_RISK']
      .filter(key => model.deliveryOutcome[key] && model.deliveryOutcome[key].rows)
      .map(key => `<button type="button" class="bdaLink" data-automate-outcome="${esc(key)}">${esc(outcomeLabel(key))}</button>`).join('') : ''}</div>`;
  }

  function renderCauseRow(model) {
    if (!model.rootCauses.length) return '';
    const total = measureOf(model.totals);
    const cards = model.rootCauses.slice(0, 6).map(cause => {
      const value = state.measure === 'orders' ? cause.orders : cause.qty;
      return `<button type="button" class="bdaCause" data-cause="${esc(cause.key)}">
        <span class="bdaCauseLabel">${esc(causeLabel(cause.key))}</span>
        <span class="bdaCauseValue">${esc(int(value))}</span>
        <span class="bdaCauseMeta">${esc(pct(total > 0 ? (state.measure === 'orders' ? cause.orders : cause.qty) / total * 100 : 0))}</span>
      </button>`;
    }).join('');
    const top = model.rootCauses[0];
    const summary = top ? `${causeLabel(top.key)} · ${int(state.measure === 'orders' ? top.orders : top.qty)} ${measureWord()}` : '';
    return `${foldHead('cause', L('Neden riskli?', 'Why are orders at risk?'), summary)}<div class="bdaCauseRow">${cards}</div>
      ${state.automate ? `<div class="bdaAutomateRow">${model.rootCauses.slice(0, 6).map(cause =>
        `<button type="button" class="bdaLink" data-automate-cause="${esc(cause.key)}">✉ ${esc(causeLabel(cause.key))}</button>`).join('')}</div>` : ''}</div></div>`;
  }

  /* Analiz ekranından otomasyon taslağı. Tarif KAPALI ve zamanlamasız
     oluşturulur; kullanıcı gözden geçirip kendisi etkinleştirir. */
  async function automateFromAnalysis(spec) {
    try {
      await (window.BLPerf && window.BLPerf.ensureFeature ? window.BLPerf.ensureFeature('automations') : Promise.resolve());
      if (!window.BLAutomations || typeof window.BLAutomations.createFromAnalysis !== 'function') {
        throw new Error(L('Otomasyon modülü yüklenemedi.', 'The automation module could not be loaded.'));
      }
      await window.BLAutomations.createFromAnalysis({
        source: 'backlog',
        recipientField: 'Üretici',
        reportFields: ['Sipariş Kod', 'Model Adı', 'Renk Kod', 'Adet', 'REVİZE YÜKLEME TARİHİ\n(EX-FACTORY)', 'Teslimat Sonucu', 'Risk Sebebi'],
        backlog: { targetType: state.settings.targetType, requireTransitRule: state.settings.requireTransitRule !== false },
        ...spec,
      });
    } catch (error) {
      const message = (error && error.message) || L('Otomasyon oluşturulamadı.', 'Could not create the automation.');
      if (typeof showToast === 'function') showToast(message); else alert(message);
    }
  }

  function renderInsights() {
    if (!state.insights.length) return '';
    const shown = state.showAllInsights ? state.insights : state.insights.slice(0, state.insightLimit);
    const items = shown.map((insight, index) => `<li class="bdaInsight is-${esc(insight.severity)}">
      <button type="button" class="bdaInsightBtn" data-insight="${index}">
        <span class="bdaInsightDot" aria-hidden="true"></span>
        <span class="bdaInsightText">${esc(insight.message)}</span>
        <span class="bdaInsightMeta">${esc(int(insight.orderCount))} ${esc(L('sipariş', 'orders'))} · ${esc(int(insight.qty))} ${esc(L('adet', 'units'))}</span>
      </button></li>`).join('');
    const more = state.insights.length > shown.length
      ? `<button type="button" class="bdaLink" data-action="showAllInsights">${esc(L(`Tüm ${state.insights.length} yorumu gör`, `View all ${state.insights.length} insights`))}</button>`
      : (state.showAllInsights && state.insights.length > state.insightLimit
        ? `<button type="button" class="bdaLink" data-action="showFewerInsights">${esc(L('Daha az göster', 'Show fewer'))}</button>` : '');
    return `${foldHead('insights', L('Otomatik Yorumlar', 'Automatic Insights'), L(`${state.insights.length} yorum`, `${state.insights.length} insights`))}
      <ul class="bdaInsightList">${items}</ul>${more}</div></div>`;
  }

  function renderNeedsAttention(model) {
    // Sayılar tam kümeden (groups.counts); liste görüntüsü kısıtlanır.
    const groups = Engine.needsAttention(model, { limit: 500 });
    const labels = {
      CRITICAL: L('Kritik', 'Critical'), ACTION_TODAY: L('Bugün Aksiyon', 'Action Today'),
      ACTION_THIS_WEEK: L('Bu Hafta', 'Action This Week'), WATCH: L('İzle', 'Watch'), ON_TRACK: L('Yolunda', 'On Track'),
    };
    const tone = { CRITICAL: 'bad', ACTION_TODAY: 'bad', ACTION_THIS_WEEK: 'warn', WATCH: 'mute', ON_TRACK: 'ok' };
    const cards = Object.keys(labels).map(key => `<button type="button" class="bdaAttention is-${tone[key]}" data-attention="${key}">
        <span class="bdaAttentionLabel">${esc(labels[key])}</span>
        <span class="bdaAttentionValue">${esc(int(groups.counts[key]))}</span>
        <span class="bdaAttentionMeta">${esc(int(groups.quantities[key]))} ${esc(L('adet', 'units'))}</span></button>`).join('');
    const urgent = (groups.counts.CRITICAL || 0) + (groups.counts.ACTION_TODAY || 0);
    return `${foldHead('attention', L('Aksiyon Gerekenler', 'Needs Attention'), urgent ? L(`${int(urgent)} acil sipariş`, `${int(urgent)} urgent orders`) : L('Acil sipariş yok', 'No urgent orders'))}<div class="bdaAttentionRow">${cards}</div></div></div>`;
  }

  function renderPerformance(model) {
    const loadingCards = Engine.LOADING_OUTCOMES.filter(key => model.loadingPerformance[key].rows)
      .map(key => `<button type="button" class="bdaChip" data-loading="${esc(key)}">
        <span>${esc(loadingLabel(key))}</span><b>${esc(int(measureOf(model.loadingPerformance[key])))}</b></button>`).join('');
    const transit = model.transitPerformance;
    const transitCard = transit.loadedOnTimeButDelayed.rows
      ? `<button type="button" class="bdaChip is-warn" data-action="transitDelayed">
          <span>${esc(L('Zamanında yüklendi · transit aşıldı', 'Loaded on time · transit exceeded'))}</span>
          <b>${esc(int(measureOf(transit.loadedOnTimeButDelayed)))}</b></button>`
      : `<span class="bdaMuted">${esc(L('Transit planını aşan yükleme yok.', 'No shipment has exceeded its planned transit.'))}</span>`;
    return `${foldHead('performance', L('Yükleme & Transit Başarımı', 'Loading & Transit Performance'), '')}<div class="bdaSplit">
      <div><h5 class="bdaSubH">${esc(L('Yükleme', 'Loading'))}</h5><div class="bdaChipRow">${loadingCards || `<span class="bdaMuted">—</span>`}</div></div>
      <div><h5 class="bdaSubH">${esc(L('Transit', 'Transit'))}</h5><div class="bdaChipRow">${transitCard}</div></div>
    </div></div></div>`;
  }

  function renderStageMatrix(model) {
    if (!model.stages.length) return '';
    const head = Engine.OUTCOMES.map(key => `<th class="num">${esc(outcomeLabel(key))}</th>`).join('');
    const body = model.stages.map(stage => {
      const cells = Engine.OUTCOMES.map(key => {
        const measure = stage.outcomes[key];
        const value = measureOf(measure);
        return `<td class="num">${value ? `<button type="button" class="bdaCellBtn" data-stage="${esc(stage.key)}" data-outcome-cell="${esc(key)}">${esc(int(value))}</button>` : '—'}</td>`;
      }).join('');
      return `<tr><td>${esc(stageLabel(stage.key))}</td><td class="num">${esc(int(measureOf(stage.total)))}</td>${cells}</tr>`;
    }).join('');
    return `${foldHead('stage', L('Güncel Durum × Teslimat Riski', 'Current Stage × Delivery Risk'), L(`${model.stages.length} aşama`, `${model.stages.length} stages`))}
      <div class="bdaTableWrap"><table class="bdaTable"><thead><tr>
        <th>${esc(L('Aşama', 'Stage'))}</th><th class="num">${esc(L('Toplam', 'Total'))}</th>${head}
      </tr></thead><tbody>${body}</tbody></table></div></div></div>`;
  }

  function renderDimension(model) {
    const tabs = DIM_TABS.map(dim => `<button type="button" class="bdaTab${dim === state.dim ? ' is-active' : ''}" data-dim="${esc(dim)}">${esc(dimLabel(dim))}</button>`).join('');
    const buckets = (model.dimensions[state.dim] || []).slice(0, 25);
    const body = buckets.map(bucket => {
      const cells = Engine.OUTCOMES.map(key => {
        const value = measureOf(bucket.outcomes[key]);
        return `<td class="num">${value ? `<button type="button" class="bdaCellBtn" data-dim-value="${esc(bucket.name)}" data-outcome-cell="${esc(key)}">${esc(int(value))}</button>` : '—'}</td>`;
      }).join('');
      const lateQty = bucket.outcomes.EXPECTED_LATE.qty + bucket.outcomes.ALREADY_LATE.qty;
      const lateShare = bucket.total.qty > 0 ? lateQty / bucket.total.qty * 100 : 0;
      return `<tr><td>${esc(bucket.name)}</td><td class="num">${esc(int(measureOf(bucket.total)))}</td>${cells}<td class="num">${esc(pct(lateShare))}</td></tr>`;
    }).join('');
    const head = Engine.OUTCOMES.map(key => `<th class="num">${esc(outcomeLabel(key))}</th>`).join('');
    return `${foldHead('dimension', L('Kırılım Analizi', 'Dimension Analysis'), dimLabel(state.dim))}
      <div class="bdaTabs">${tabs}</div>
      <div class="bdaTableWrap"><table class="bdaTable"><thead><tr>
        <th>${esc(dimLabel(state.dim))}</th><th class="num">${esc(L('Toplam', 'Total'))}</th>${head}<th class="num">${esc(L('Gecikme %', 'Late %'))}</th>
      </tr></thead><tbody>${body || `<tr><td colspan="8" class="bdaMuted">—</td></tr>`}</tbody></table></div></div></div>`;
  }

  function renderTopRisk(model) {
    const list = model.topRiskOrders.slice(0, 20);
    if (!list.length) return '';
    const rows = list.map(order => `<tr>
      <td>${esc(order.orderCode)}</td><td>${esc(order.modelName)}</td>
      <td>${esc(stageLabel(order.stage))}</td><td>${esc(order.loadingType || '—')}</td>
      <td class="num">${esc(int(order.qty))}</td>
      <td class="num">${order.scheduleBufferDays == null ? '—' : esc(int(order.scheduleBufferDays))}</td>
      <td>${esc(outcomeLabel(order.deliveryOutcome))}</td>
      <td>${esc(order.riskCause ? causeLabel(order.riskCause) : '—')}</td>
      <td>${esc(order.etaSource === 'ias' ? L('IAS antrepo tarihi', 'IAS warehouse date') : order.etaSource === 'calculated' ? L('Transit kuralından hesaplandı', 'Calculated from transit rule') : '—')}</td>
    </tr>`).join('');
    return `${foldHead('topRisk', L('En Riskli Siparişler', 'Top Risk Orders'), L(`ilk ${list.length}`, `top ${list.length}`))}
      <div class="bdaTableWrap"><table class="bdaTable"><thead><tr>
        <th>${esc(L('Sipariş', 'Order'))}</th><th>${esc(L('Model', 'Model'))}</th><th>${esc(L('Aşama', 'Stage'))}</th>
        <th>${esc(L('Yükleme Tipi', 'Loading Type'))}</th><th class="num">${esc(L('Adet', 'Qty'))}</th>
        <th class="num">${esc(L('Tampon (gün)', 'Buffer (days)'))}</th><th>${esc(L('Sonuç', 'Outcome'))}</th>
        <th>${esc(L('Sebep', 'Cause'))}</th><th>${esc(L('ETA Kaynağı', 'ETA Source'))}</th>
      </tr></thead><tbody>${rows}</tbody></table></div></div></div>`;
  }

  function renderDataQuality(model) {
    const missing = model.dataQuality.missing.slice(0, 8);
    if (!missing.length) return '';
    const items = missing.map(item => `<li>${esc(int(item.rows))} ${esc(L('satırda eksik', 'rows missing'))}: <b>${esc(String(item.field).replace(/\n/g, ' '))}</b></li>`).join('');
    return `${foldHead('quality', L('Veri Kalitesi', 'Data Quality'), L(`${missing.length} eksik alan`, `${missing.length} missing fields`))}
      <ul class="bdaMissing">${items}</ul>
      <p class="bdaMuted">${esc(L('Bu alanlar eksik olduğu için ilgili siparişler "Hesaplanamıyor" olarak sınıflandırıldı; tahmin üretilmedi.',
        'These orders are classified as Unknown because a required field is missing; no prediction was fabricated.'))}</p></div></div>`;
  }

  function renderParity() {
    if (!state.parity) return '';
    if (state.parity.match) {
      return `<span class="bdaParity is-ok">${esc(L('Backlog toplamıyla birebir', 'Matches backlog totals'))}: ${esc(int(state.parity.analysisQty))} ${esc(L('adet', 'units'))} · ${esc(int(state.parity.analysisOrders))} ${esc(L('sipariş', 'orders'))}</span>`;
    }
    return `<span class="bdaParity is-warn">${esc(L('Uyarı: analiz toplamı Backlog ekranından farklı', 'Warning: analysis totals differ from the backlog screen'))} — ${esc(L('Backlog', 'Backlog'))}: ${esc(int(state.parity.backlogQty))}/${esc(int(state.parity.backlogOrders))}, ${esc(L('Analiz', 'Analysis'))}: ${esc(int(state.parity.analysisQty))}/${esc(int(state.parity.analysisOrders))}</span>`;
  }

  function periodNote() {
    if (!state.period || state.period.mode === 'all') return '';
    const labels = { thisWeek: L('Bu hafta', 'This week'), nextWeek: L('Gelecek hafta', 'Next week'), twoWeeks: L('Bu hafta + gelecek hafta', 'This + next week'), range: L('Tarih aralığı', 'Date range') };
    return ` · <b>${esc(labels[state.period.mode] || '')}</b> <span class="bdaMuted">(${esc(int(state.periodRowCount))}/${esc(int(state.totalRowCount))} ${esc(L('satır', 'rows'))})</span>`;
  }

  /* Yol süresi kuralı eksikse: uyarı BANDI. Bu, kullanıcının doğrudan
     eyleme geçebileceği tek şey olduğu için en üstte ve hangi ülke +
     yükleme tipi için kural gerektiğini sayarak gösterilir. */
  function renderTransitRuleWarning(model) {
    const info = model.dataQuality && model.dataQuality.transitRule;
    if (!info || !info.rows) return '';
    const combos = (info.combos || []).slice(0, 6)
      .map(item => `${esc(item.country)} · ${esc(item.loadingType)} (${esc(int(item.rows))})`).join(', ');
    return `<div class="bdaWarnBand">
      <b>${esc(L('Yol süresi bilgisi eksik', 'Transit time information is missing'))}</b>
      <span>${esc(L(
        `${int(info.rows)} satır için "Nakliye Tipine Göre Ülke Bazlı Yol Süreleri" ekranında tanımlı bir kural yok; bu siparişler için teslimat tahmini YAPILMADI.`,
        `${int(info.rows)} rows have no rule defined in "Transit Times by Shipment Type and Country"; no delivery prediction was made for them.`))}</span>
      ${combos ? `<span class="bdaMuted">${esc(L('Kural gereken kombinasyonlar', 'Combinations needing a rule'))}: ${combos}</span>` : ''}
      <button type="button" class="bdaLink" data-action="openTransitRules">${esc(L('Yol sürelerini tanımla', 'Define transit times'))}</button>
    </div>`;
  }

  function renderHeader() {
    const targetLabel = state.settings.targetType === 'inStore' ? L('Model Bütçe / In Store', 'Model Budget / In Store') : L('Retail Depo', 'Retail Warehouse');
    return `<div class="bdaHead">
      <div>
        <div class="bdaTitle">${esc(L('Teslimat Riski Analizi', 'Delivery Risk Analysis'))}</div>
        <div class="bdaSub">${esc(L('Analiz hedefi', 'Analysis target'))}: <b>${esc(targetLabel)}</b>${periodNote()} · ${renderParity()}</div>
      </div>
      <div class="bdaHeadControls">
        <label class="bdaControl"><span>${esc(L('Hedef', 'Target'))}</span>
          <select data-control="targetType">
            <option value="retail"${state.settings.targetType === 'retail' ? ' selected' : ''}>${esc(L('Retail Depo', 'Retail Warehouse'))}</option>
            <option value="inStore"${state.settings.targetType === 'inStore' ? ' selected' : ''}>${esc(L('Model Bütçe / In Store', 'Model Budget / In Store'))}</option>
          </select></label>
        <label class="bdaControl"><span>${esc(L('Ölçü', 'Measure'))}</span>
          <select data-control="measure">
            <option value="qty"${state.measure === 'qty' ? ' selected' : ''}>${esc(L('Adet', 'Quantity'))}</option>
            <option value="orders"${state.measure === 'orders' ? ' selected' : ''}>${esc(L('Sipariş', 'Orders'))}</option>
          </select></label>
        <label class="bdaControl"><span>${esc(L('Dönem', 'Period'))}</span>
          <select data-control="periodMode">
            <option value="all"${state.period.mode === 'all' ? ' selected' : ''}>${esc(L('Tümü', 'All'))}</option>
            <option value="thisWeek"${state.period.mode === 'thisWeek' ? ' selected' : ''}>${esc(L('Bu hafta', 'This week'))}</option>
            <option value="nextWeek"${state.period.mode === 'nextWeek' ? ' selected' : ''}>${esc(L('Gelecek hafta', 'Next week'))}</option>
            <option value="twoWeeks"${state.period.mode === 'twoWeeks' ? ' selected' : ''}>${esc(L('Bu hafta + gelecek hafta', 'This + next week'))}</option>
            <option value="range"${state.period.mode === 'range' ? ' selected' : ''}>${esc(L('Tarih aralığı', 'Date range'))}</option>
          </select></label>
        ${state.period.mode === 'range' ? `<label class="bdaControl"><span>${esc(L('Başlangıç', 'From'))}</span>
          <input type="date" data-control="periodFrom" value="${esc(state.period.from || '')}"></label>
        <label class="bdaControl"><span>${esc(L('Bitiş', 'To'))}</span>
          <input type="date" data-control="periodTo" value="${esc(state.period.to || '')}"></label>` : ''}
        <button type="button" class="tbtn" data-action="settings">${esc(L('Yorum Ayarları', 'Insight Settings'))}</button>
        <button type="button" class="tbtn" data-action="copy">${esc(L('Özeti Kopyala', 'Copy Summary'))}</button>
        <button type="button" class="tbtn" data-action="refresh">${esc(L('Yenile', 'Refresh'))}</button>
      </div>
    </div>`;
  }

  function render() {
    const host = document.getElementById('backlogAnalysis');
    if (!host) return;
    host.hidden = !state.open;
    if (!state.open) return;
    if (state.loading) { host.innerHTML = `${renderHeader()}<div class="bdaMuted bdaPad">${esc(L('Analiz hesaplanıyor…', 'Calculating analysis…'))}</div>`; bind(host); return; }
    if (state.error) { host.innerHTML = `${renderHeader()}<div class="bdaError">${esc(state.error)}</div>`; bind(host); return; }
    const model = state.model;
    if (!model || !model.orders.length) {
      host.innerHTML = `${renderHeader()}<div class="bdaMuted bdaPad">${esc(L('Seçili filtrede analiz edilecek sipariş yok.', 'No orders to analyse in the current filter.'))}</div>`;
      bind(host); return;
    }
    host.innerHTML = `${renderHeader()}
      ${renderTransitRuleWarning(model)}
      ${renderOutcomeRow(model)}
      ${renderCauseRow(model)}
      ${renderInsights()}
      ${renderNeedsAttention(model)}
      ${renderPerformance(model)}
      ${renderStageMatrix(model)}
      ${renderDimension(model)}
      ${renderTopRisk(model)}
      ${renderDataQuality(model)}`;
    bind(host);
  }

  /* --------------------------------------------------------------- olaylar */
  function bind(host) {
    host.querySelectorAll('[data-fold-toggle]').forEach(button => {
      button.addEventListener('click', () => {
        const key = button.dataset.foldToggle;
        const section = button.closest('[data-fold]');
        const open = !(state.folds[key] !== false);
        state.folds[key] = open;
        if (section) section.classList.toggle('is-open', open);
        button.setAttribute('aria-expanded', open ? 'true' : 'false');
        save();
      });
    });
    host.querySelectorAll('[data-control]').forEach(select => {
      select.addEventListener('change', () => {
        const key = select.dataset.control;
        if (key === 'targetType') { state.settings = { ...state.settings, targetType: select.value }; computeModel(); }
        else if (key === 'measure') state.measure = select.value;
        else if (key === 'periodMode') { state.period = { ...state.period, mode: select.value }; computeModel(); }
        else if (key === 'periodFrom') { state.period = { ...state.period, from: select.value }; computeModel(); }
        else if (key === 'periodTo') { state.period = { ...state.period, to: select.value }; computeModel(); }
        save(); render();
      });
    });
    host.querySelectorAll('[data-action]').forEach(button => {
      button.addEventListener('click', () => {
        const action = button.dataset.action;
        if (action === 'refresh') { void refresh(true); return; }
        if (action === 'showAllInsights') { state.showAllInsights = true; render(); return; }
        if (action === 'toggleAutomate') { state.automate = !state.automate; render(); return; }
        if (action === 'showFewerInsights') { state.showAllInsights = false; render(); return; }
        if (action === 'copy') { copySummary(); return; }
        if (action === 'settings') { openSettings(); return; }
        if (action === 'openTransitRules') {
          // Mevcut "Nakliye Tipine Göre Ülke Bazlı Yol Süreleri" ekranı; yenisi kurulmaz.
          const trigger = document.getElementById('transitRulesBtn');
          if (trigger) trigger.click();
          else if (typeof showToast === 'function') showToast(L('Yol süreleri ekranı Kaynak Ayarları altında açılabilir.', 'Transit times can be opened from Source Settings.'));
          return;
        }
        if (action === 'transitDelayed') {
          openOrders(L('Zamanında yüklendi · transit aşıldı', 'Loaded on time · transit exceeded'),
            ordersWhere(order => order.loadingPerformance === 'LOADED_ON_TIME' && order.transitVarianceDays != null && order.transitVarianceDays > 0));
        }
      });
    });
    host.querySelectorAll('[data-outcome]').forEach(button => button.addEventListener('click', () => {
      const key = button.dataset.outcome;
      openOrders(outcomeLabel(key), ordersWhere(order => order.deliveryOutcome === key));
    }));
    /* v9.51 — Analizden doğrudan otomasyon. Ekrandaki kırılım koşula BİREBİR
       aynı alan adıyla taşınır; alan adları server/lib/backlog-automation.js
       ile aynı olmak zorunda, yoksa otomasyon hiçbir şey eşleştirmez. */
    host.querySelectorAll('[data-automate-outcome]').forEach(button => button.addEventListener('click', () => {
      const key = button.dataset.automateOutcome;
      automateFromAnalysis({
        name: `Backlog · ${outcomeLabel(key)}`,
        description: L(`Backlog Teslimat Analizi'ndeki "${outcomeLabel(key)}" kırılımından oluşturuldu.`,
          `Created from the "${outcomeLabel(key)}" breakdown in the Backlog Delivery Analysis.`),
        filters: [{ field: 'Teslimat Sonucu Kodu', operator: 'eq', value: key }],
        subject: outcomeLabel(key),
      });
    }));
    host.querySelectorAll('[data-automate-cause]').forEach(button => button.addEventListener('click', () => {
      const key = button.dataset.automateCause;
      automateFromAnalysis({
        name: `Backlog · ${causeLabel(key)}`,
        description: L(`Backlog Teslimat Analizi'ndeki "${causeLabel(key)}" kök sebebinden oluşturuldu.`,
          `Created from the "${causeLabel(key)}" root cause in the Backlog Delivery Analysis.`),
        filters: [{ field: 'Risk Sebebi Kodu', operator: 'eq', value: key }],
        subject: causeLabel(key),
      });
    }));
    host.querySelectorAll('[data-cause]').forEach(button => button.addEventListener('click', () => {
      const key = button.dataset.cause;
      openOrders(causeLabel(key), ordersWhere(order => order.riskReasons.includes(key)));
    }));
    host.querySelectorAll('[data-loading]').forEach(button => button.addEventListener('click', () => {
      const key = button.dataset.loading;
      openOrders(loadingLabel(key), ordersWhere(order => order.loadingPerformance === key));
    }));
    host.querySelectorAll('[data-attention]').forEach(button => button.addEventListener('click', () => {
      const groups = Engine.needsAttention(state.model, { limit: 500 });
      openOrders(button.querySelector('.bdaAttentionLabel').textContent, groups[button.dataset.attention] || []);
    }));
    host.querySelectorAll('[data-insight]').forEach(button => button.addEventListener('click', () => {
      const insight = state.insights[Number(button.dataset.insight)];
      if (insight) openOrders(insight.message.slice(0, 80), insight.orders);
    }));
    host.querySelectorAll('[data-dim]').forEach(button => button.addEventListener('click', () => {
      state.dim = button.dataset.dim; save(); render();
    }));
    host.querySelectorAll('[data-outcome-cell]').forEach(button => button.addEventListener('click', () => {
      const outcome = button.dataset.outcomeCell;
      const stage = button.dataset.stage, dimValue = button.dataset.dimValue;
      if (stage) openOrders(`${stageLabel(stage)} · ${outcomeLabel(outcome)}`, ordersWhere(order => order.stage === stage && order.deliveryOutcome === outcome));
      else if (dimValue) openOrders(`${dimValue} · ${outcomeLabel(outcome)}`, ordersWhere(order => order.dims[state.dim] === dimValue && order.deliveryOutcome === outcome));
    }));
  }

  /* ------------------------------------------------------------ özet kopya */
  function copySummary() {
    const model = state.model;
    if (!model) return;
    const target = state.settings.targetType === 'inStore' ? L('Model Bütçe / In Store', 'Model Budget / In Store') : L('Retail Depo', 'Retail Warehouse');
    const lines = [
      L('BACKLOG TESLİMAT ÖZETİ', 'BACKLOG DELIVERY SUMMARY'),
      `${L('Hedef', 'Target')}: ${target}`,
      `${L('Toplam', 'Total')}: ${int(model.totals.orders)} ${L('sipariş', 'orders')} / ${int(model.totals.qty)} ${L('adet', 'units')}`,
      '',
    ];
    Engine.OUTCOMES.forEach(key => {
      const measure = model.deliveryOutcome[key];
      if (!measure.rows) return;
      lines.push(`${outcomeLabel(key)}: ${int(measure.orders)} ${L('sipariş', 'orders')} / ${int(measure.qty)} ${L('adet', 'units')}`);
    });
    lines.push('', L('Ana riskler:', 'Main risks:'));
    state.insights.filter(insight => insight.severity === 'critical' || insight.severity === 'warning')
      .slice(0, 6).forEach(insight => lines.push(`• ${insight.message}`));
    const text = lines.join('\n');
    const done = () => { if (typeof showToast === 'function') showToast(L('Özet kopyalandı.', 'Summary copied.')); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done).catch(() => {});
    else { const area = document.createElement('textarea'); area.value = text; document.body.appendChild(area); area.select(); try { document.execCommand('copy'); done(); } catch (_) {} area.remove(); }
  }

  /* ---------------------------------------------------- yorum ayarları (§25) */
  function openSettings() {
    document.getElementById('_bdaSettings')?.remove();
    const modal = document.createElement('div');
    modal.id = '_bdaSettings';
    modal.className = 'warnOverlay';
    const types = Insights.INSIGHT_TYPES.map(type => {
      const label = Insights.INSIGHT_TYPE_LABELS[lang()][type.id] || type.id;
      const checked = state.preferences[type.id] !== false ? ' checked' : '';
      return `<label class="bdaCheck"><input type="checkbox" data-pref="${esc(type.id)}"${checked}><span>${esc(label)}</span></label>`;
    }).join('');
    modal.innerHTML = `<div class="modalCard bdaSettingsCard" role="dialog" aria-modal="true" aria-labelledby="_bdaSettingsTitle">
      <div class="bdaSettingsHead"><div class="modalTitle" id="_bdaSettingsTitle">${esc(L('Yorum ve Eşik Ayarları', 'Insight & Threshold Settings'))}</div>
        <button type="button" class="pricingRuleIconBtn" data-close aria-label="${esc(L('Kapat', 'Close'))}"><svg class="ic"><use href="#i-x"/></svg></button></div>
      <div class="bdaSettingsBody">
        <!-- DİKKAT: burada <section> KULLANILMAZ. app.css'teki genel
             "section{display:none}" kuralı tüm belgeye uygulanıyor; gruplama
             amaçlı masum bir <section> sessizce kaybolur (CLAUDE.md §4). -->
        <div class="bdaSettingsGroup"><h5>${esc(L('Gösterilecek yorum tipleri', 'Insight types to show'))}</h5><div class="bdaCheckGrid">${types}</div></div>
        <div class="bdaSettingsGroup"><h5>${esc(L('Eşikler', 'Thresholds'))}</h5>
          <div class="bdaFieldRow">
            <label class="bdaControl"><span>${esc(L('Riskli tampon (gün)', 'At-risk buffer (days)'))}</span>
              <input type="number" min="0" max="120" data-setting="atRiskBufferDays" value="${esc(state.settings.atRiskBufferDays)}"></label>
            <label class="bdaControl"><span>${esc(L('In Store gerekli tampon (gün)', 'In-Store required buffer (days)'))}</span>
              <input type="number" min="0" max="120" data-setting="requiredBufferInStore" value="${esc(state.settings.requiredBufferInStore)}"></label>
            <label class="bdaControl"><span>${esc(L('Transit toleransı (gün)', 'Transit tolerance (days)'))}</span>
              <input type="number" min="0" max="120" data-setting="transitToleranceDays" value="${esc(state.settings.transitToleranceDays)}"></label>
            <label class="bdaControl"><span>${esc(L('Ekranda yorum sayısı', 'Insights shown'))}</span>
              <input type="number" min="3" max="40" data-setting="insightLimit" value="${esc(state.insightLimit)}"></label>
          </div>
          <label class="bdaCheck bdaCheckWide"><input type="checkbox" data-setting-flag="requireTransitRule"${state.settings.requireTransitRule !== false ? ' checked' : ''}>
            <span>${esc(L('Yol süresi kuralı tanımlı değilse hesaplama yapma (bilgi eksik uyarısı ver)',
              'Do not calculate when no transit-time rule is defined (report missing information)'))}</span></label>
          <p class="bdaMuted">${esc(L('Varsayılanlar uygulamanın kendi iş kurallarından gelir: In Store 14 gün, üretim gecikmesi 9 gün, riskli tampon 5 gün.',
            'Defaults come from the application\'s own business rules: In-Store 14 days, production delay 9 days, at-risk buffer 5 days.'))}</p>
        </div>
      </div>
      <div class="modalFoot"><span></span>
        <button type="button" class="tbtn" data-close>${esc(L('Kapat', 'Close'))}</button>
        <button type="button" class="tbtn primary" data-save>${esc(L('Uygula', 'Apply'))}</button></div>
    </div>`;
    document.body.appendChild(modal);
    const close = () => modal.remove();
    modal.querySelectorAll('[data-close]').forEach(button => button.addEventListener('click', close));
    modal.addEventListener('click', event => { if (event.target === modal) close(); });
    modal.querySelector('[data-save]').addEventListener('click', () => {
      modal.querySelectorAll('[data-pref]').forEach(input => { state.preferences[input.dataset.pref] = input.checked; });
      modal.querySelectorAll('[data-setting-flag]').forEach(input => {
        state.settings = { ...state.settings, [input.dataset.settingFlag]: input.checked };
      });
      modal.querySelectorAll('[data-setting]').forEach(input => {
        const value = Number(input.value);
        if (!Number.isFinite(value)) return;
        if (input.dataset.setting === 'insightLimit') state.insightLimit = Math.max(3, Math.min(40, value));
        else state.settings = { ...state.settings, [input.dataset.setting]: value };
      });
      save(); computeModel(); close(); render();
    });
  }

  /* ------------------------------------------------------------- bağlantı */
  function toggle() {
    state.open = !state.open;
    save();
    const button = document.getElementById('backlogAnalysisToggle');
    if (button) button.setAttribute('aria-expanded', String(state.open));
    if (state.open) void refresh(false); else render();
  }

  function onBacklogRendered() {
    if (!state.open) return;
    // Filtre değişmişse satırlar bayattır; imza karşılaştırması yeniden çekmeye karar verir.
    void refresh(false);
  }

  function init() {
    load();
    const button = document.getElementById('backlogAnalysisToggle');
    if (button && !button.dataset.bdaBound) {
      button.dataset.bdaBound = '1';
      button.addEventListener('click', toggle);
      button.setAttribute('aria-expanded', String(state.open));
    }
    if (state.open) void refresh(false);
  }

  window.BLBacklogAnalysis = { init, toggle, refresh, onBacklogRendered, _state: state };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
