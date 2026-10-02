/* Buyer Log — Yol Süreleri › İthalat Yol Süresi Analizi paneli.
 *
 * Yol Süreleri penceresi açıldığında lazy yüklenir (perf-runtime: transitAnalysis).
 * Analiz Excel'i istemcide okunur (BLTransitAnalysis.parseWorkbook), sunucuda tek
 * merkezde saklanır (/api/transit-analysis). Panel kuralları KENDİSİ KAYDETMEZ:
 * seçili öneriler pencerenin çalışma listesine aktarılır, kullanıcı mevcut
 * "Kuralları Kaydet" akışıyla onaylar. */
(function attachTransitAnalysisUI(global) {
  'use strict';

  // Arayüz dili her çizimde aktif appLang'dan okunur (app-main).
  const isEn = () => typeof appLang !== 'undefined' && appLang === 'en';
  const L = (tr, en) => (isEn() ? en : tr);
  const loc = () => (isEn() ? 'en-GB' : 'tr-TR');
  const lang = () => (isEn() ? 'en' : 'tr');
  const LOCAL_KEY = 'lcw.transitAnalysis.v1';
  const VIEW_KEY = 'lcw.transitAnalysis.view.v1';
  const store = { loaded: false, analysis: null, revision: 0, pending: null };
  // Excel'siz varsayılan kaynak: Buyer Log'un ASAS + IAS verisinden canlı hesap.
  const live = { loaded: false, analysis: null, message: '', meta: null, warnings: [], params: '', pending: null };

  /* params: { scope: 'filtered'|'company', window: 'w4'|'m3'|'y1'|'all'… }.
     Kapsam/pencere değişince sunucudan yeniden hesaplanır; hata (ör. şirket
     geneli yetkisi yok) panelde mesaj olarak gösterilir, kontroller kalır. */
  async function loadLive(force = false, params = {}) {
    const scope = params.scope === 'company' ? 'company' : 'filtered';
    const win = params.window || 'y1';
    const key = scope + '|' + win;
    if (live.loaded && !force && live.params === key) return live;
    if (live.pending && live.pendingKey === key && !force) return live.pending;
    live.pendingKey = key;
    live.pending = (async () => {
      live.warnings = [];
      if (!global.SERVER_BACKED) {
        live.analysis = null;
        live.message = L('Buyer Log verisinden hesap sunucu modunda çalışır.', 'Calculating from Buyer Log data requires server mode.');
      } else {
        const qs = new URLSearchParams({ scope, window: win, ...(force ? { refresh: '1' } : {}) });
        const res = await fetch('/api/transit-analysis/live?' + qs.toString(), { headers: { Accept: 'application/json' } });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          live.analysis = null;
          live.message = data.error || res.statusText;
        } else {
          live.analysis = data.analysis || null;
          live.message = data.message || '';
          live.warnings = Array.isArray(data.warnings) ? data.warnings : [];
          live.meta = { antrepoSourceMode: data.antrepoSourceMode || '', orderCount: Number(data.orderCount) || 0 };
        }
      }
      live.loaded = true;
      live.params = key;
      return live;
    })().finally(() => { live.pending = null; live.pendingKey = ''; });
    return live.pending;
  }

  function TA() { return global.BLTransitAnalysis; }
  function esc(value) {
    return String(value == null ? '' : value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function fmt(value, digits = 1) {
    if (value == null || !Number.isFinite(Number(value))) return '—';
    return Number(value).toLocaleString(loc(), { minimumFractionDigits: 0, maximumFractionDigits: digits });
  }
  function fmtQty(value) {
    const n = Number(value) || 0;
    if (n >= 1e6) return (n / 1e6).toLocaleString(loc(), { maximumFractionDigits: 1 }) + ' M';
    if (n >= 1e3) return (n / 1e3).toLocaleString(loc(), { maximumFractionDigits: 0 }) + L(' B', ' K');
    return n.toLocaleString(loc());
  }
  function fmtPeriod(period, granularity) {
    const p = String(period || '');
    return granularity === 'week' ? p.slice(0, 4) + L('-H', '-W') + p.slice(4) : p.slice(0, 4) + '/' + p.slice(4);
  }
  function vehicleLabel(vehicle) {
    if (!vehicle) return L('Karma (Tümü)', 'Mixed (All)');
    return typeof global.transitDelTypeDisplay === 'function' ? global.transitDelTypeDisplay(vehicle) : vehicle;
  }
  function toast(message) { if (typeof global.showToast === 'function') global.showToast(message); }
  function readView() {
    try { return JSON.parse((global.BLStorage || global.localStorage).getItem(VIEW_KEY) || '{}') || {}; } catch (_) { return {}; }
  }
  function writeView(view) {
    try { (global.BLStorage || global.localStorage).setItem(VIEW_KEY, JSON.stringify(view)); } catch (_) {}
  }

  async function load(force = false) {
    if (store.loaded && !force) return store;
    if (store.pending) return store.pending;
    store.pending = (async () => {
      if (global.SERVER_BACKED) {
        const res = await fetch('/api/transit-analysis', { headers: { Accept: 'application/json' } });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || res.statusText);
        store.analysis = TA().normalizeAnalysis(data.analysis);
        store.revision = Number(data.revision) || 0;
      } else {
        try { store.analysis = TA().normalizeAnalysis(JSON.parse((global.BLStorage || global.localStorage).getItem(LOCAL_KEY) || 'null')); }
        catch (_) { store.analysis = null; }
      }
      store.loaded = true;
      return store;
    })().finally(() => { store.pending = null; });
    return store.pending;
  }

  async function save(analysis) {
    const clean = analysis == null ? null : TA().normalizeAnalysis(analysis);
    if (global.SERVER_BACKED) {
      const res = await fetch('/api/transit-analysis', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'If-Match': String(store.revision || 0), ...(global.BL_CLIENT_ID ? { 'X-Client-Id': global.BL_CLIENT_ID } : {}) },
        body: JSON.stringify({ analysis: clean }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || res.statusText);
      store.analysis = TA().normalizeAnalysis(data.analysis);
      store.revision = Number(data.revision) || store.revision;
    } else {
      try {
        const storage = global.BLStorage || global.localStorage;
        if (clean) storage.setItem(LOCAL_KEY, JSON.stringify(clean)); else storage.removeItem(LOCAL_KEY);
      } catch (_) {}
      store.analysis = clean;
    }
    store.loaded = true;
    return store.analysis;
  }

  async function readWorkbookFile(file) {
    if (global.BLPerf && global.BLPerf.ensureLibrary) await global.BLPerf.ensureLibrary('xlsx');
    if (!global.XLSX) throw new Error(L('Excel okuyucu yüklenemedi.', 'The Excel reader could not be loaded.'));
    const wb = global.XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: false });
    const sheets = wb.SheetNames.map(name => ({
      name,
      rows: global.XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, defval: null }),
    }));
    return TA().parseWorkbook(sheets, { fileName: file.name, importedAt: new Date().toISOString() });
  }

  function stackedBar(row, scale) {
    const parts = [['loading', 'var(--blue)'], ['transit', 'var(--teal)'], ['customs', 'var(--orange)']]
      .map(([m, color]) => ({ m, color, v: Math.max(0, Number(row[m]) || 0) }));
    if (!scale || !parts.some(p => p.v)) return '';
    return `<div style="display:flex;height:6px;width:100%;max-width:140px;border-radius:var(--r-full);overflow:hidden;background:var(--card2);margin-top:4px;" aria-hidden="true">${parts.map(p => `<span title="${esc(TA().labels(lang()).metric[p.m])}: ${fmt(p.v)} ${L('gün', 'days')}" style="width:${(p.v / scale * 100).toFixed(1)}%;background:${p.color};"></span>`).join('')}</div>`;
  }

  function trendCell(row) {
    if (row.trend == null || row.periods < 2) return '<span style="color:var(--muted);">—</span>';
    const t = Number(row.trend);
    const color = Math.abs(t) < 2 ? 'var(--muted)' : t > 0 ? 'var(--red)' : 'var(--green)';
    const arrow = Math.abs(t) < 2 ? '→' : t > 0 ? '↑' : '↓';
    return `<span style="color:${color};font-weight:600;" title="${L('Son 3 dönem ortalaması', 'Average of the last 3 periods:')} ${fmt(row.lastMean)} ${L('gün', 'days')}">${arrow} ${t > 0 ? '+' : ''}${fmt(t)}</span>`;
  }

  function detailHtml(row, analysis) {
    const max = Math.max(1, ...row.series.map(s => Math.max(0, Number(s.endToEnd) || 0)));
    const series = row.series.map(s => `<div style="display:grid;grid-template-columns:72px 1fr 52px 64px;gap:8px;align-items:center;font-size:11.5px;">
        <span style="color:var(--muted);">${esc(fmtPeriod(s.period, row.granularity))}</span>
        <span style="height:6px;border-radius:var(--r-full);background:var(--card2);overflow:hidden;"><span style="display:block;height:100%;width:${(Math.max(0, Number(s.endToEnd) || 0) / max * 100).toFixed(1)}%;background:var(--acc);"></span></span>
        <span class="num" style="text-align:right;">${fmt(s.endToEnd)}</span>
        <span class="num" style="text-align:right;color:var(--muted);">${fmtQty(s.qty)}</span></div>`).join('');
    const groups = { loading: L('Yükleme', 'Loading'), transit: L('Yol', 'Transit'), customs: L('Gümrük', 'Customs') };
    const steps = row.steps.length ? row.steps.map(s => `<tr><td style="color:var(--muted);">${esc(groups[s.group] || '')}</td><td>${esc(s.code)}. ${esc(TA().stepLabel(s, analysis, lang()))}${s.informational ? ` <span style="color:var(--muted);">${L('(bilgi — üst adımın içinde)', '(info — included in the parent step)')}</span>` : ''}</td><td class="num" style="text-align:right;${s.days < 0 ? 'color:var(--red);' : ''}">${fmt(s.days)}</td></tr>`).join('')
      : `<tr><td colspan="3" style="color:var(--muted);">${L('Bu ülke/taşıt için alt süreç kırılımı raporda yok.', 'The report has no sub-process breakdown for this country/vehicle.')}</td></tr>`;
    return `<div style="display:grid;grid-template-columns:minmax(260px,1fr) minmax(320px,1.2fr);gap:18px;padding:10px 6px;">
      <div><div style="font-weight:600;font-size:12px;margin-bottom:6px;">${L('Dönem bazında uçtan uca (gün · adet)', 'End-to-end by period (days · qty)')}</div><div style="display:flex;flex-direction:column;gap:3px;max-height:220px;overflow:auto;">${series}</div></div>
      <div><div style="font-weight:600;font-size:12px;margin-bottom:6px;">${L('Alt süreç ortalamaları (gün)', 'Sub-process averages (days)')}</div><table class="pricingRulesTable" style="min-width:0;"><tbody>${steps}</tbody></table></div>
    </div>`;
  }

  /* ctx: { getRules():Rule[], applyRules(rules), onChange?() } */
  function mount(container, ctx) {
    if (!container || !TA()) return null;
    const view = { source: 'database', scope: 'filtered', window: 'y1', basis: '', year: '', vehicle: '*', metric: 'endToEnd', stat: 'mean', ...readView() };
    if (!['database', 'excel'].includes(view.source)) view.source = 'database';
    if (!['filtered', 'company'].includes(view.scope)) view.scope = 'filtered';
    if (!TA().WINDOW_KEYS.includes(view.window)) view.window = 'y1';
    const liveParams = () => ({ scope: view.scope, window: view.window });
    const selected = new Map();
    const expanded = new Set();
    let busy = false;
    let summary = null;

    function rowId(row) { return row.vehicle + '|' + row.countryKey; }

    function sourceTabs() {
      const tab = (id, label) => `<button type="button" class="tbtn" data-ta-source="${id}" aria-pressed="${view.source === id}" style="${view.source === id ? 'background:var(--acc-bg);border-color:var(--acc);color:var(--acc-ink);font-weight:600;' : ''}">${label}</button>`;
      return `<div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;"><span style="font-size:11.5px;color:var(--muted);margin-right:4px;">${L('Kaynak', 'Source')}</span>${tab('database', L('Buyer Log verisi (IAS)', 'Buyer Log data (IAS)'))}${tab('excel', L('Rapor Excel\'i (isteğe bağlı)', 'Report Excel (optional)'))}</div>`;
    }
    /* Buyer Log kaynağı: kapsam + tarih penceresi. */
    function dbControls() {
      const tab = (id, label, title) => `<button type="button" class="tbtn" data-ta-scope="${id}" aria-pressed="${view.scope === id}" title="${esc(title)}" style="${view.scope === id ? 'background:var(--acc-bg);border-color:var(--acc);color:var(--acc-ink);font-weight:600;' : ''}">${label}</button>`;
      const group = (label, keys) => `<optgroup label="${esc(label)}">${keys.map(k => `<option value="${k}" ${view.window === k ? 'selected' : ''}>${esc(TA().windowLabel(k, lang()))}</option>`).join('')}</optgroup>`;
      const keys = TA().WINDOW_KEYS;
      return `<div style="display:flex;gap:14px;align-items:flex-end;flex-wrap:wrap;">
        <div style="display:flex;flex-direction:column;gap:4px;"><span style="font-size:11.5px;color:var(--muted);">${L('Veri Kapsamı', 'Data Scope')}</span><div style="display:flex;gap:6px;flex-wrap:wrap;">${tab('filtered', L('Mevcut filtrem', 'My current filter'), L('Kaynak ufkun ve yetki kapsamın (Backlog ile aynı)', 'Your source horizon and access scope (same as Backlog)'))}${tab('company', L('Şirket geneli', 'Company-wide'), L('IAS verisi kullanıcı filtresi olmadan, yalnız tarih aralığıyla çekilir', 'IAS data is fetched without user filters, limited only by the date range'))}</div></div>
        <div class="pricingRuleField" style="min-width:200px;"><label>${L('Tarih Aralığı', 'Date Range')}</label><select data-ta-window>${group(L('Hafta', 'Weeks'), keys.filter(k => k[0] === 'w'))}${group(L('Ay', 'Months'), keys.filter(k => k[0] === 'm'))}${group(L('Yıl', 'Years'), keys.filter(k => k[0] === 'y'))}<option value="all" ${view.window === 'all' ? 'selected' : ''}>${esc(TA().windowLabel('all', lang()))}</option></select></div>
        ${live.analysis && live.analysis.window && live.analysis.window.from ? `<div style="font-size:11px;color:var(--muted);padding-bottom:8px;">${esc(live.analysis.window.from)} → ${esc(live.analysis.window.to)} · ${live.analysis.window.granularity === 'week' ? L('haftalık kırılım', 'weekly breakdown') : L('aylık kırılım', 'monthly breakdown')} · ${L('baz tarih: antrepo giriş', 'basis date: warehouse entry')}</div>` : ''}
      </div>${live.warnings && live.warnings.length ? `<div style="font-size:11px;color:var(--orange);line-height:1.5;">${live.warnings.map(esc).join(' · ')}</div>` : ''}`;
    }
    function statsLine(analysis) {
      const st = analysis && analysis.stats;
      if (!st) return '';
      const n = value => value.toLocaleString(loc());
      const parts = [L(`${n(st.used)} antrepoya girmiş sevkiyat kullanıldı (toplam ${n(st.total)} IAS parsiyeli)`, `${n(st.used)} shipments that entered the bonded warehouse were used (of ${n(st.total)} IAS partials)`)];
      if (st.notArrived) parts.push(L(`${n(st.notArrived)} henüz antrepoda değil`, `${n(st.notArrived)} not yet in the warehouse`));
      if (st.missingDates) parts.push(L(`${n(st.missingDates)} talep/giriş tarihi eksik`, `${n(st.missingDates)} missing request/entry date`));
      if (st.outOfRange) parts.push(L(`${n(st.outOfRange)} tutarsız tarih`, `${n(st.outOfRange)} inconsistent dates`));
      if (st.missingCountry) parts.push(L(`${n(st.missingCountry)} ülkesi yok`, `${n(st.missingCountry)} without a country`));
      if (st.outOfWindow) parts.push(L(`${n(st.outOfWindow)} tarih aralığı dışında`, `${n(st.outOfWindow)} outside the date range`));
      return parts.join(' · ');
    }
    function columnNotes(analysis) {
      const c = analysis && analysis.columns;
      if (!c) return '';
      const notes = [];
      if (!c.loadingRequest) notes.push(L('"Yükleme Talep Tarih" sütunu IAS kaynağında yok — uçtan uca süre hesaplanamaz', 'The IAS source has no "Yükleme Talep Tarih" column — end-to-end time cannot be calculated'));
      if (!c.eta) notes.push(L('"ETA Tarih" sütunu yok — yol/gümrük ayrımı yapılamaz', 'No "ETA Tarih" column — transit and customs cannot be separated'));
      if (!c.actualLoading) notes.push(L('Fiili Yükleme tarihi kaynakta yok; yükleme/yol ayrımı Handover tarihine göre', 'No actual loading date in the source; loading/transit are split by the Handover date'));
      if (!c.actualEntry) notes.push(L('Gerçekleşen antrepo giriş sütunu yok; antrepoya girmiş parsiyelde IAS giriş tarihi kullanılır', 'No actual warehouse entry column; the IAS entry date is used for partials that entered the warehouse'));
      return notes.length ? `<div style="font-size:11px;color:var(--muted);line-height:1.5;">${notes.map(esc).join(' · ')}</div>` : '';
    }

    function render() {
      const analysis = view.source === 'database' ? live.analysis : store.analysis;
      if (view.source === 'database' && !(analysis && analysis.records && analysis.records.length)) {
        container.innerHTML = `<div style="border:1px solid var(--line);border-radius:var(--r-md);padding:14px 16px;display:flex;flex-direction:column;gap:10px;background:var(--card);">
          <div style="display:flex;gap:12px;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;"><div><div style="font-weight:600;">${L('İthalat Yol Süresi Analizi', 'Import Lead Time Analysis')}</div><div style="font-size:11.5px;color:var(--muted);margin-top:3px;line-height:1.5;">${L('Ülke ve taşıt bazlı süreler Buyer Log\'un ASAS + IAS (Antrepo) verisinden doğrudan hesaplanır; Excel gerekmez.', 'Lead times by country and vehicle are calculated directly from Buyer Log\'s ASAS + IAS (Antrepo) data; no Excel needed.')}</div></div>${sourceTabs()}</div>
          ${dbControls()}
          <div style="font-size:12px;color:var(--ink2);">${esc(live.message || (live.loaded ? L('Bu kapsam ve tarih aralığında antrepoya girmiş sevkiyat bulunamadı. Tarih aralığını genişletin veya Şirket geneli kapsamı seçin.', 'No shipments entered the bonded warehouse in this scope and date range. Widen the date range or choose Company-wide.') : L('Buyer Log verisi okunuyor…', 'Reading Buyer Log data…')))}</div>
          ${statsLine(analysis) ? `<div style="font-size:11px;color:var(--muted);">${esc(statsLine(analysis))}</div>` : ''}${columnNotes(analysis)}
          <div><button type="button" class="tbtn" data-ta-refresh><svg class="ic"><use href="#i-refresh"/></svg><span>${L('Yeniden Hesapla', 'Recalculate')}</span></button></div>
        </div>`;
        bindCommon();
        return;
      }
      if (!analysis) {
        container.innerHTML = `<div style="border:1px dashed var(--line2);border-radius:var(--r-md);padding:14px 16px;display:flex;gap:14px;align-items:center;justify-content:space-between;flex-wrap:wrap;">
          <div><div style="font-weight:600;">${L('İthalat Yol Süresi Analizi', 'Import Lead Time Analysis')}</div><div style="font-size:11.5px;color:var(--muted);margin-top:3px;line-height:1.5;">${L('Global Lojistik "İthalat Yol Süresi Raporu" Excel\'ini yükleyin. Ülke ve taşıt bazında Yükleme · Yol · Gümrük · Uçtan Uca süreleri hesaplanır ve kural önerisine dönüştürülür.', 'Upload the Global Logistics "İthalat Yol Süresi Raporu" Excel. Loading · Transit · Customs · End-to-end times are calculated by country and vehicle and turned into rule suggestions.')}</div></div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">${sourceTabs()}<label class="tbtn" style="cursor:pointer;"><svg class="ic"><use href="#i-file-import"/></svg><span>${busy ? L('Okunuyor…', 'Reading…') : L('Analiz Excel\'i Yükle', 'Upload Analysis Excel')}</span><input type="file" data-ta-file accept=".xlsx,.xlsm,.xls" hidden ${busy ? 'disabled' : ''}></label></div>
        </div>`;
        bindCommon();
        return;
      }
      // Buyer Log kaynağında dönem kapsamını tarih aralığı belirler; yıl süzmesi yok.
      const yearFilter = analysis.source === 'database' ? '*' : view.year;
      summary = TA().summarize(analysis, { basis: view.basis, year: yearFilter, vehicle: view.vehicle });
      view.basis = summary.basis; if (analysis.source !== 'database') view.year = summary.year;
      if (view.vehicle !== '*' && !summary.options.vehicles.includes(view.vehicle)) { view.vehicle = '*'; summary = TA().summarize(analysis, { basis: view.basis, year: yearFilter, vehicle: '*' }); }
      writeView(view);
      const rules = ctx.getRules();
      const suggestions = new Map(TA().suggestRules(summary, view).map(s => [s.delType + '|' + s.countryKey, s]));
      summary.rows.forEach(row => {
        const id = rowId(row);
        if (!selected.has(id)) selected.set(id, !!row.vehicle && !row.lowSample && !row.anomaly && suggestions.has(id));
      });
      const scale = Math.max(1, ...summary.rows.map(r => ['loading', 'transit', 'customs'].reduce((s, m) => s + Math.max(0, Number(r[m]) || 0), 0)));
      const isDb = analysis.source === 'database';
      const labels = TA().metricLabels(analysis, lang());
      const text = TA().labels(lang());
      const sources = isDb ? statsLine(analysis)
        : analysis.sources.map(s => `${s.sheet} (${s.role === 'steps' ? L('alt süreç', 'sub-process') : L('ana', 'main')}, ${text.basis[s.basis]}, ${vehicleLabel(s.vehicle)}, ${s.year})`).join(' · ');
      const opt = (value, label, current) => `<option value="${esc(value)}" ${String(value) === String(current) ? 'selected' : ''}>${esc(label)}</option>`;
      const totals = summary.vehicleTotals.map(t => `<div style="border:1px solid var(--line);border-radius:var(--r-sm);padding:8px 12px;background:var(--card);min-width:220px;">
          <div style="font-size:11px;color:var(--muted);">${esc(vehicleLabel(t.vehicle))} · ${t.countries} ${L('ülke', 'countries')} · ${fmtQty(t.qty)} ${L('adet', 'pcs')}</div>
          <div style="font-size:18px;font-weight:700;margin-top:2px;">${fmt(t.endToEnd)} <span style="font-size:11.5px;font-weight:500;color:var(--muted);">${L('gün uçtan uca', 'days end-to-end')}</span></div>
          <div style="font-size:11px;color:var(--ink2);margin-top:2px;">${L('Yükleme', 'Loading')} ${fmt(t.loading)} · ${L('Yol', 'Transit')} ${fmt(t.transit)} · ${L('Gümrük', 'Customs')} ${fmt(t.customs)}</div></div>`).join('');
      const body = summary.rows.map(row => {
        const id = rowId(row);
        const s = suggestions.get(id);
        const current = TA().currentRuleDays(rules, row.vehicle, row.ruleCountry);
        const diff = s && current ? s.days - current.days : null;
        const flags = [row.lowSample ? `<span title="${row.shipments != null ? L(`${TA().LOW_SAMPLE_SHIPMENTS} sevkiyattan az`, `Fewer than ${TA().LOW_SAMPLE_SHIPMENTS} shipments`) : L(`Toplam adet < ${fmtQty(TA().LOW_SAMPLE_QTY)} veya < ${TA().LOW_SAMPLE_PERIODS} dönem`, `Total qty < ${fmtQty(TA().LOW_SAMPLE_QTY)} or < ${TA().LOW_SAMPLE_PERIODS} periods`)}" style="color:var(--orange);">${L('düşük örneklem', 'low sample')}</span>` : '',
          row.anomaly ? `<span title="${L('Kaynak raporda negatif ana süre var (tarih tutarsızlığı)', 'The source report has a negative main duration (date inconsistency)')}" style="color:var(--red);">${L('veri tutarsız', 'inconsistent data')}</span>` : ''].filter(Boolean).join(' · ');
        const canSelect = !!row.vehicle && !!s;
        return `<tr data-ta-row="${esc(id)}">
          <td><input type="checkbox" data-ta-pick="${esc(id)}" ${selected.get(id) && canSelect ? 'checked' : ''} ${canSelect ? '' : 'disabled'} title="${canSelect ? L('Öneriyi kurallara aktar', 'Transfer the suggestion to the rules') : L('Taşıt tipi karışık (Vasita = All); kurala aktarılamaz', 'Mixed vehicle type (Vasita = All); cannot be transferred to a rule')}"></td>
          <td>${esc(vehicleLabel(row.vehicle))}</td>
          <td><strong>${esc(row.ruleCountry)}</strong><div style="font-size:10.5px;color:var(--muted);">${esc(row.country)}${flags ? ' · ' + flags : ''}</div></td>
          <td class="num">${fmtQty(row.qty)}<div style="font-size:10.5px;color:var(--muted);">${row.shipments != null ? row.shipments.toLocaleString(loc()) + L(' sevkiyat · ', ' shipments · ') : ''}${row.periods} ${row.granularity === 'week' ? L('hafta', 'weeks') : L('ay', 'months')}</div></td>
          <td class="num">${fmt(row.loading)}</td><td class="num">${fmt(row.transit)}</td><td class="num">${fmt(row.customs)}</td>
          <td class="num"><strong>${fmt(row.endToEnd)}</strong>${stackedBar(row, scale)}</td>
          <td class="num">${fmt(row.p80)}</td>
          <td class="num" style="color:var(--muted);">${fmt(row.min)}–${fmt(row.max)}</td>
          <td class="num">${trendCell(row)}</td>
          <td class="num">${current ? `${fmt(current.days, 0)}<div style="font-size:10.5px;color:var(--muted);">${current.source === 'rule' ? L('kural', 'rule') : L('varsayılan', 'default')}</div>` : '—'}</td>
          <td class="num">${s ? `<strong>${fmt(s.days, 0)}</strong>${diff ? `<div style="font-size:10.5px;color:${diff > 0 ? 'var(--red)' : 'var(--green)'};">${diff > 0 ? '+' : ''}${diff}</div>` : ''}` : '—'}</td>
          <td><button type="button" class="pricingRuleIconBtn" data-ta-expand="${esc(id)}" title="${L('Dönem ve alt süreç detayı', 'Period and sub-process detail')}" aria-expanded="${expanded.has(id)}">${expanded.has(id) ? '▴' : '▾'}</button></td>
        </tr>${expanded.has(id) ? `<tr><td colspan="14" style="background:var(--card2);">${detailHtml(row, analysis)}</td></tr>` : ''}`;
      }).join('');
      const picked = summary.rows.filter(r => selected.get(rowId(r)) && suggestions.has(rowId(r))).length;
      container.innerHTML = `<div style="border:1px solid var(--line);border-radius:var(--r-md);padding:14px 16px;display:flex;flex-direction:column;gap:12px;background:var(--card);">
        <div style="display:flex;gap:12px;align-items:flex-start;justify-content:space-between;flex-wrap:wrap;">
          <div><div style="font-weight:600;">${L('İthalat Yol Süresi Analizi', 'Import Lead Time Analysis')}</div>
            <div style="font-size:11.5px;color:var(--muted);margin-top:3px;line-height:1.5;">${esc(analysis.fileName || 'Excel')} · ${esc(new Date(analysis.importedAt).toLocaleString(loc()))}${analysis.importedBy ? ' · ' + esc(analysis.importedBy) : ''}</div>
            <div style="font-size:11px;color:var(--muted);margin-top:2px;line-height:1.5;" title="${isDb ? L('Antrepoya girmiş IAS parsiyelleri; ülke eşleşen ASAS siparişinden, taşıt Vasita Tanim alanından.', 'IAS partials that entered the bonded warehouse; country from the matching ASAS order, vehicle from the Vasita Tanim field.') : L('Aynı veri birden çok pivotta tekrar eder; her baz/taşıt/yıl için tek kaynak kullanılır.', 'The same data repeats across pivots; one source is used per basis/vehicle/year.')}">${isDb ? '' : L('Kaynak: ', 'Source: ')}${esc(sources)}</div>${isDb ? columnNotes(analysis) : ''}</div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">${sourceTabs()}${isDb
            ? `<button type="button" class="tbtn" data-ta-refresh><svg class="ic"><use href="#i-refresh"/></svg><span>${L('Yeniden Hesapla', 'Recalculate')}</span></button>`
            : `<label class="tbtn" style="cursor:pointer;"><svg class="ic"><use href="#i-file-import"/></svg><span>${busy ? L('Okunuyor…', 'Reading…') : L('Yeni Excel Yükle', 'Upload New Excel')}</span><input type="file" data-ta-file accept=".xlsx,.xlsm,.xls" hidden ${busy ? 'disabled' : ''}></label><button type="button" class="tbtn" data-ta-clear title="${L('Kayıtlı analizi kaldır (kurallar değişmez)', 'Remove the saved analysis (rules are unchanged)')}"><svg class="ic"><use href="#i-trash"/></svg><span>${L('Analizi Kaldır', 'Remove Analysis')}</span></button>`}</div>
        </div>
        ${isDb ? dbControls() : ''}
        <div class="pricingRuleGrid">
          <div class="pricingRuleField"><label>${L('Dönem Bazı', 'Period Basis')}</label><select data-ta-view="basis">${summary.options.bases.map(b => opt(b, text.basis[b], view.basis)).join('')}</select></div>
          ${isDb ? '' : `<div class="pricingRuleField"><label>${L('Yıl', 'Year')}</label><select data-ta-view="year">${summary.options.years.map(y => opt(y, y, view.year)).join('')}</select></div>`}
          <div class="pricingRuleField"><label>${L('Taşıt', 'Vehicle')}</label><select data-ta-view="vehicle">${opt('*', L('Tüm taşıtlar', 'All vehicles'), view.vehicle)}${summary.options.vehicles.map(v => opt(v, vehicleLabel(v), view.vehicle)).join('')}</select></div>
          <div class="pricingRuleField"><label>${L('Kurala Esas Süre', 'Rule Duration Basis')}</label><select data-ta-view="metric">${Object.entries(labels.rule).map(([k, l]) => opt(k, l, view.metric)).join('')}</select></div>
          <div class="pricingRuleField"><label>${L('İstatistik', 'Statistic')}</label><select data-ta-view="stat">${Object.entries(text.ruleStat).map(([k, l]) => opt(k, l, view.stat)).join('')}</select></div>
        </div>
        ${totals ? `<div style="display:flex;gap:10px;flex-wrap:wrap;">${totals}</div>` : ''}
        <div style="font-size:11px;color:var(--muted);display:flex;gap:14px;flex-wrap:wrap;"><span><span style="display:inline-block;width:10px;height:6px;border-radius:2px;background:var(--blue);"></span> ${L('Yükleme', 'Loading')} (${esc(labels.loading)})</span><span><span style="display:inline-block;width:10px;height:6px;border-radius:2px;background:var(--teal);"></span> ${L('Yol', 'Transit')} (${esc(labels.transit)})</span><span><span style="display:inline-block;width:10px;height:6px;border-radius:2px;background:var(--orange);"></span> ${L('Gümrük', 'Customs')} (${esc(labels.customs)})</span><span>${L('Süreler gün; adet ağırlıklı ortalama.', 'Durations in days; quantity-weighted average.')}</span></div>
        <div style="border:1px solid var(--line);border-radius:var(--r-md);overflow:auto;max-height:420px;"><table class="pricingRulesTable"><thead><tr>
          <th><input type="checkbox" data-ta-all title="${L('Tümünü seç', 'Select all')}" ${picked && picked === summary.rows.filter(r => r.vehicle && suggestions.has(rowId(r))).length ? 'checked' : ''}></th><th>${L('Taşıt', 'Vehicle')}</th><th>${L('Ülke', 'Country')}</th><th style="text-align:right;">${L('Adet', 'Qty')}</th><th style="text-align:right;">${L('Yükleme', 'Loading')}</th><th style="text-align:right;">${L('Yol', 'Transit')}</th><th style="text-align:right;">${L('Gümrük', 'Customs')}</th><th style="text-align:right;">${L('Uçtan Uca', 'End-to-End')}</th><th style="text-align:right;">P80</th><th style="text-align:right;">${L('Min–Maks', 'Min–Max')}</th><th style="text-align:right;">Trend</th><th style="text-align:right;">${L('Mevcut Gün', 'Current Days')}</th><th style="text-align:right;">${L('Önerilen Gün', 'Suggested Days')}</th><th></th>
        </tr></thead><tbody>${body || `<tr><td colspan="14" style="padding:14px;text-align:center;color:var(--muted);">${L('Bu seçim için veri yok.', 'No data for this selection.')}</td></tr>`}</tbody></table></div>
        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;"><span data-ta-status style="font-size:11.5px;color:var(--muted);">${L(`${picked} öneri seçili · Öneri:`, `${picked} suggestion(s) selected · Suggestion:`)} ${esc(labels.rule[view.metric] || text.ruleMetric[view.metric])}, ${esc(text.ruleStat[view.stat])}. ${L('Aktarım yalnız tarihsiz + sezonsuz ülke/taşıt kuralını ekler veya günceller.', 'Transfer only adds or updates the undated, season-less country/vehicle rule.')}</span><span style="flex:1"></span>
          <button type="button" class="navActionBtn" data-ta-apply ${picked ? '' : 'disabled'}><svg class="ic"><use href="#i-copy-plus"/></svg><span>${L('Seçili Önerileri Kurallara Aktar', 'Transfer Selected Suggestions to Rules')}</span></button></div>
      </div>`;
      bindCommon();
      container.querySelectorAll('[data-ta-view]').forEach(el => el.addEventListener('change', () => {
        view[el.dataset.taView] = el.value;
        if (el.dataset.taView === 'basis') view.year = '';
        selected.clear();
        render();
      }));
      container.querySelectorAll('[data-ta-pick]').forEach(el => el.addEventListener('change', () => { selected.set(el.dataset.taPick, el.checked); render(); }));
      container.querySelector('[data-ta-all]')?.addEventListener('change', e => {
        summary.rows.forEach(r => { if (r.vehicle && suggestions.has(rowId(r))) selected.set(rowId(r), e.target.checked); });
        render();
      });
      container.querySelectorAll('[data-ta-expand]').forEach(el => el.addEventListener('click', () => {
        const id = el.dataset.taExpand;
        if (expanded.has(id)) expanded.delete(id); else expanded.add(id);
        render();
      }));
      container.querySelector('[data-ta-apply]')?.addEventListener('click', () => {
        const chosen = summary.rows.filter(r => selected.get(rowId(r))).map(r => suggestions.get(rowId(r))).filter(Boolean);
        const result = TA().applySuggestions(ctx.getRules(), chosen);
        ctx.applyRules(result.rules);
        toast(L(`${result.added} kural eklendi, ${result.updated} güncellendi${result.unchanged ? `, ${result.unchanged} aynı` : ''}. Kalıcı olması için "Kuralları Kaydet".`,
          `${result.added} rule(s) added, ${result.updated} updated${result.unchanged ? `, ${result.unchanged} unchanged` : ''}. Use "Save Rules" to keep them.`));
        render();
      });
      container.querySelector('[data-ta-clear]')?.addEventListener('click', async () => {
        if (!global.confirm(L('Kayıtlı yol süresi analizi kaldırılsın mı? Yol Süreleri kuralları değişmez.', 'Remove the saved lead time analysis? Transit time rules are not changed.'))) return;
        try { await save(null); selected.clear(); render(); toast(L('Yol süresi analizi kaldırıldı.', 'Lead time analysis removed.')); }
        catch (err) { toast(L('Analiz kaldırılamadı: ', 'Could not remove the analysis: ') + err.message); }
      });
    }

    function bindCommon() {
      bindFile();
      container.querySelectorAll('[data-ta-source]').forEach(el => el.addEventListener('click', () => {
        if (view.source === el.dataset.taSource) return;
        view.source = el.dataset.taSource; view.basis = ''; view.year = ''; view.vehicle = '*';
        selected.clear(); writeView(view);
        ensureLoaded().then(render).catch(showError);
      }));
      container.querySelector('[data-ta-refresh]')?.addEventListener('click', () => {
        container.querySelector('[data-ta-refresh]').disabled = true;
        loadLive(true, liveParams()).then(() => { selected.clear(); render(); }).catch(showError);
      });
      const reloadLive = () => {
        writeView(view); selected.clear(); expanded.clear();
        container.querySelectorAll('[data-ta-scope],[data-ta-window],[data-ta-refresh]').forEach(el => { el.disabled = true; });
        const note = document.createElement('div');
        note.style.cssText = 'font-size:11.5px;color:var(--muted);';
        note.textContent = view.scope === 'company' ? L('Şirket geneli IAS verisi sorgulanıyor…', 'Querying company-wide IAS data…') : L('Hesaplanıyor…', 'Calculating…');
        container.firstElementChild?.appendChild(note);
        loadLive(false, liveParams()).then(render).catch(showError);
      };
      container.querySelectorAll('[data-ta-scope]').forEach(el => el.addEventListener('click', () => {
        if (view.scope === el.dataset.taScope) return;
        view.scope = el.dataset.taScope; reloadLive();
      }));
      container.querySelector('[data-ta-window]')?.addEventListener('change', e => { view.window = e.target.value; reloadLive(); });
    }
    function ensureLoaded() { return view.source === 'database' ? loadLive(false, liveParams()) : load(); }
    function showError(err) {
      container.innerHTML = `<div style="padding:12px;color:var(--red);font-size:11.5px;">${L('Yol süresi analizi okunamadı:', 'Could not read the lead time analysis:')} ${esc(err.message)}</div>`;
    }

    function bindFile() {
      container.querySelectorAll('[data-ta-file]').forEach(input => input.addEventListener('change', async () => {
        const file = input.files && input.files[0];
        input.value = '';
        if (!file || busy) return;
        busy = true; render();
        try {
          const parsed = await readWorkbookFile(file);
          if (!parsed) throw new Error(L('Rapor yapısı tanınmadı: "Ürün Menşei" ve "Yıl Ay/Hafta" başlıklı pivot sayfası bulunamadı.', 'Report layout not recognised: no pivot sheet with "Ürün Menşei" and "Yıl Ay/Hafta" headers was found.'));
          await save(parsed);
          selected.clear(); view.basis = ''; view.year = '';
          toast(L(`${parsed.records.length} ülke/dönem kaydı okundu (${parsed.sources.length} kaynak pivot).`, `${parsed.records.length} country/period record(s) read (${parsed.sources.length} source pivot(s)).`));
        } catch (err) {
          toast(L('Analiz yüklenemedi: ', 'Could not load the analysis: ') + err.message);
        } finally { busy = false; render(); }
      }));
    }

    container.innerHTML = `<div style="padding:12px;color:var(--muted);font-size:11.5px;">${L('Yol süresi analizi yükleniyor…', 'Loading lead time analysis…')}</div>`;
    // Pencere her açıldığında güncel runtime'dan yeniden hesaplanır (şirket
    // sorgusu sunucuda 15 dk önbellekli; "Yeniden Hesapla" önbelleği atlar).
    live.loaded = false;
    (view.source === 'database' ? loadLive(false, liveParams()) : load()).then(render).catch(showError);
    return { refresh: () => (view.source === 'database' ? loadLive(true, liveParams()) : load(true)).then(render), render };
  }

  function invalidate() { store.loaded = false; live.loaded = false; }

  global.BLTransitAnalysisUI = { mount, load, loadLive, save, invalidate, readWorkbookFile };
})(typeof window !== 'undefined' ? window : globalThis);
