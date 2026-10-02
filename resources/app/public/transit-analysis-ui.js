/* Buyer Log — Yol Süreleri › İthalat Yol Süresi Analizi paneli.
 *
 * Yol Süreleri penceresi açıldığında lazy yüklenir (perf-runtime: transitAnalysis).
 * Analiz Excel'i istemcide okunur (BLTransitAnalysis.parseWorkbook), sunucuda tek
 * merkezde saklanır (/api/transit-analysis). Panel kuralları KENDİSİ KAYDETMEZ:
 * seçili öneriler pencerenin çalışma listesine aktarılır, kullanıcı mevcut
 * "Kuralları Kaydet" akışıyla onaylar. */
(function attachTransitAnalysisUI(global) {
  'use strict';

  const LOCAL_KEY = 'lcw.transitAnalysis.v1';
  const VIEW_KEY = 'lcw.transitAnalysis.view.v1';
  const store = { loaded: false, analysis: null, revision: 0, pending: null };

  function TA() { return global.BLTransitAnalysis; }
  function esc(value) {
    return String(value == null ? '' : value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function fmt(value, digits = 1) {
    if (value == null || !Number.isFinite(Number(value))) return '—';
    return Number(value).toLocaleString('tr-TR', { minimumFractionDigits: 0, maximumFractionDigits: digits });
  }
  function fmtQty(value) {
    const n = Number(value) || 0;
    if (n >= 1e6) return (n / 1e6).toLocaleString('tr-TR', { maximumFractionDigits: 1 }) + ' M';
    if (n >= 1e3) return (n / 1e3).toLocaleString('tr-TR', { maximumFractionDigits: 0 }) + ' B';
    return n.toLocaleString('tr-TR');
  }
  function fmtPeriod(period, granularity) {
    const p = String(period || '');
    return granularity === 'week' ? p.slice(0, 4) + '-H' + p.slice(4) : p.slice(0, 4) + '/' + p.slice(4);
  }
  function vehicleLabel(vehicle) {
    if (!vehicle) return 'Karma (Tümü)';
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
    if (!global.XLSX) throw new Error('Excel okuyucu yüklenemedi.');
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
    return `<div style="display:flex;height:6px;width:100%;max-width:140px;border-radius:var(--r-full);overflow:hidden;background:var(--card2);margin-top:4px;" aria-hidden="true">${parts.map(p => `<span title="${esc(TA().METRIC_LABELS[p.m])}: ${fmt(p.v)} gün" style="width:${(p.v / scale * 100).toFixed(1)}%;background:${p.color};"></span>`).join('')}</div>`;
  }

  function trendCell(row) {
    if (row.trend == null || row.periods < 2) return '<span style="color:var(--muted);">—</span>';
    const t = Number(row.trend);
    const color = Math.abs(t) < 2 ? 'var(--muted)' : t > 0 ? 'var(--red)' : 'var(--green)';
    const arrow = Math.abs(t) < 2 ? '→' : t > 0 ? '↑' : '↓';
    return `<span style="color:${color};font-weight:600;" title="Son 3 dönem ortalaması ${fmt(row.lastMean)} gün">${arrow} ${t > 0 ? '+' : ''}${fmt(t)}</span>`;
  }

  function detailHtml(row) {
    const max = Math.max(1, ...row.series.map(s => Math.max(0, Number(s.endToEnd) || 0)));
    const series = row.series.map(s => `<div style="display:grid;grid-template-columns:72px 1fr 52px 64px;gap:8px;align-items:center;font-size:11.5px;">
        <span style="color:var(--muted);">${esc(fmtPeriod(s.period, row.granularity))}</span>
        <span style="height:6px;border-radius:var(--r-full);background:var(--card2);overflow:hidden;"><span style="display:block;height:100%;width:${(Math.max(0, Number(s.endToEnd) || 0) / max * 100).toFixed(1)}%;background:var(--acc);"></span></span>
        <span class="num" style="text-align:right;">${fmt(s.endToEnd)}</span>
        <span class="num" style="text-align:right;color:var(--muted);">${fmtQty(s.qty)}</span></div>`).join('');
    const groups = { loading: 'Yükleme', transit: 'Yol', customs: 'Gümrük' };
    const steps = row.steps.length ? row.steps.map(s => `<tr><td style="color:var(--muted);">${esc(groups[s.group] || '')}</td><td>${esc(s.code)}. ${esc(s.label)}${s.informational ? ' <span style="color:var(--muted);">(bilgi — üst adımın içinde)</span>' : ''}</td><td class="num" style="text-align:right;${s.days < 0 ? 'color:var(--red);' : ''}">${fmt(s.days)}</td></tr>`).join('')
      : '<tr><td colspan="3" style="color:var(--muted);">Bu ülke/taşıt için alt süreç kırılımı raporda yok.</td></tr>';
    return `<div style="display:grid;grid-template-columns:minmax(260px,1fr) minmax(320px,1.2fr);gap:18px;padding:10px 6px;">
      <div><div style="font-weight:600;font-size:12px;margin-bottom:6px;">Dönem bazında uçtan uca (gün · adet)</div><div style="display:flex;flex-direction:column;gap:3px;max-height:220px;overflow:auto;">${series}</div></div>
      <div><div style="font-weight:600;font-size:12px;margin-bottom:6px;">Alt süreç ortalamaları (gün)</div><table class="pricingRulesTable" style="min-width:0;"><tbody>${steps}</tbody></table></div>
    </div>`;
  }

  /* ctx: { getRules():Rule[], applyRules(rules), onChange?() } */
  function mount(container, ctx) {
    if (!container || !TA()) return null;
    const view = { basis: '', year: '', vehicle: '*', metric: 'endToEnd', stat: 'mean', ...readView() };
    const selected = new Map();
    const expanded = new Set();
    let busy = false;
    let summary = null;

    function rowId(row) { return row.vehicle + '|' + row.countryKey; }

    function render() {
      const analysis = store.analysis;
      if (!analysis) {
        container.innerHTML = `<div style="border:1px dashed var(--line2);border-radius:var(--r-md);padding:14px 16px;display:flex;gap:14px;align-items:center;justify-content:space-between;flex-wrap:wrap;">
          <div><div style="font-weight:600;">İthalat Yol Süresi Analizi</div><div style="font-size:11.5px;color:var(--muted);margin-top:3px;line-height:1.5;">Global Lojistik "İthalat Yol Süresi Raporu" Excel'ini yükleyin. Ülke ve taşıt bazında Yükleme · Yol · Gümrük · Uçtan Uca süreleri hesaplanır ve kural önerisine dönüştürülür.</div></div>
          <label class="tbtn" style="cursor:pointer;"><svg class="ic"><use href="#i-file-import"/></svg><span>${busy ? 'Okunuyor…' : 'Analiz Excel\'i Yükle'}</span><input type="file" data-ta-file accept=".xlsx,.xlsm,.xls" hidden ${busy ? 'disabled' : ''}></label>
        </div>`;
        bindFile();
        return;
      }
      summary = TA().summarize(analysis, { basis: view.basis, year: view.year, vehicle: view.vehicle });
      view.basis = summary.basis; view.year = summary.year;
      if (view.vehicle !== '*' && !summary.options.vehicles.includes(view.vehicle)) { view.vehicle = '*'; summary = TA().summarize(analysis, { basis: view.basis, year: view.year, vehicle: '*' }); }
      writeView(view);
      const rules = ctx.getRules();
      const suggestions = new Map(TA().suggestRules(summary, view).map(s => [s.delType + '|' + s.countryKey, s]));
      summary.rows.forEach(row => {
        const id = rowId(row);
        if (!selected.has(id)) selected.set(id, !!row.vehicle && !row.lowSample && !row.anomaly && suggestions.has(id));
      });
      const scale = Math.max(1, ...summary.rows.map(r => ['loading', 'transit', 'customs'].reduce((s, m) => s + Math.max(0, Number(r[m]) || 0), 0)));
      const sources = analysis.sources.map(s => `${s.sheet} (${s.role === 'steps' ? 'alt süreç' : 'ana'}, ${TA().BASIS_LABELS[s.basis]}, ${vehicleLabel(s.vehicle)}, ${s.year})`).join(' · ');
      const opt = (value, label, current) => `<option value="${esc(value)}" ${String(value) === String(current) ? 'selected' : ''}>${esc(label)}</option>`;
      const totals = summary.vehicleTotals.map(t => `<div style="border:1px solid var(--line);border-radius:var(--r-sm);padding:8px 12px;background:var(--card);min-width:220px;">
          <div style="font-size:11px;color:var(--muted);">${esc(vehicleLabel(t.vehicle))} · ${t.countries} ülke · ${fmtQty(t.qty)} adet</div>
          <div style="font-size:18px;font-weight:700;margin-top:2px;">${fmt(t.endToEnd)} <span style="font-size:11.5px;font-weight:500;color:var(--muted);">gün uçtan uca</span></div>
          <div style="font-size:11px;color:var(--ink2);margin-top:2px;">Yükleme ${fmt(t.loading)} · Yol ${fmt(t.transit)} · Gümrük ${fmt(t.customs)}</div></div>`).join('');
      const body = summary.rows.map(row => {
        const id = rowId(row);
        const s = suggestions.get(id);
        const current = TA().currentRuleDays(rules, row.vehicle, row.ruleCountry);
        const diff = s && current ? s.days - current.days : null;
        const flags = [row.lowSample ? `<span title="Toplam adet < ${fmtQty(TA().LOW_SAMPLE_QTY)} veya < ${TA().LOW_SAMPLE_PERIODS} dönem" style="color:var(--orange);">düşük örneklem</span>` : '',
          row.anomaly ? '<span title="Kaynak raporda negatif ana süre var (tarih tutarsızlığı)" style="color:var(--red);">veri tutarsız</span>' : ''].filter(Boolean).join(' · ');
        const canSelect = !!row.vehicle && !!s;
        return `<tr data-ta-row="${esc(id)}">
          <td><input type="checkbox" data-ta-pick="${esc(id)}" ${selected.get(id) && canSelect ? 'checked' : ''} ${canSelect ? '' : 'disabled'} title="${canSelect ? 'Öneriyi kurallara aktar' : 'Taşıt tipi karışık (Vasita = All); kurala aktarılamaz'}"></td>
          <td>${esc(vehicleLabel(row.vehicle))}</td>
          <td><strong>${esc(row.ruleCountry)}</strong><div style="font-size:10.5px;color:var(--muted);">${esc(row.country)}${flags ? ' · ' + flags : ''}</div></td>
          <td class="num">${fmtQty(row.qty)}<div style="font-size:10.5px;color:var(--muted);">${row.periods} ${row.granularity === 'week' ? 'hafta' : 'ay'}</div></td>
          <td class="num">${fmt(row.loading)}</td><td class="num">${fmt(row.transit)}</td><td class="num">${fmt(row.customs)}</td>
          <td class="num"><strong>${fmt(row.endToEnd)}</strong>${stackedBar(row, scale)}</td>
          <td class="num">${fmt(row.p80)}</td>
          <td class="num" style="color:var(--muted);">${fmt(row.min)}–${fmt(row.max)}</td>
          <td class="num">${trendCell(row)}</td>
          <td class="num">${current ? `${fmt(current.days, 0)}<div style="font-size:10.5px;color:var(--muted);">${current.source === 'rule' ? 'kural' : 'varsayılan'}</div>` : '—'}</td>
          <td class="num">${s ? `<strong>${fmt(s.days, 0)}</strong>${diff ? `<div style="font-size:10.5px;color:${diff > 0 ? 'var(--red)' : 'var(--green)'};">${diff > 0 ? '+' : ''}${diff}</div>` : ''}` : '—'}</td>
          <td><button type="button" class="pricingRuleIconBtn" data-ta-expand="${esc(id)}" title="Dönem ve alt süreç detayı" aria-expanded="${expanded.has(id)}">${expanded.has(id) ? '▴' : '▾'}</button></td>
        </tr>${expanded.has(id) ? `<tr><td colspan="14" style="background:var(--card2);">${detailHtml(row)}</td></tr>` : ''}`;
      }).join('');
      const picked = summary.rows.filter(r => selected.get(rowId(r)) && suggestions.has(rowId(r))).length;
      container.innerHTML = `<div style="border:1px solid var(--line);border-radius:var(--r-md);padding:14px 16px;display:flex;flex-direction:column;gap:12px;background:var(--card);">
        <div style="display:flex;gap:12px;align-items:flex-start;justify-content:space-between;flex-wrap:wrap;">
          <div><div style="font-weight:600;">İthalat Yol Süresi Analizi</div>
            <div style="font-size:11.5px;color:var(--muted);margin-top:3px;line-height:1.5;">${esc(analysis.fileName || 'Excel')} · ${esc(new Date(analysis.importedAt).toLocaleString('tr-TR'))}${analysis.importedBy ? ' · ' + esc(analysis.importedBy) : ''}</div>
            <div style="font-size:11px;color:var(--muted);margin-top:2px;line-height:1.5;" title="Aynı veri birden çok pivotta tekrar eder; her baz/taşıt/yıl için tek kaynak kullanılır.">Kaynak: ${esc(sources)}</div></div>
          <div style="display:flex;gap:8px;"><label class="tbtn" style="cursor:pointer;"><svg class="ic"><use href="#i-file-import"/></svg><span>${busy ? 'Okunuyor…' : 'Yeni Excel Yükle'}</span><input type="file" data-ta-file accept=".xlsx,.xlsm,.xls" hidden ${busy ? 'disabled' : ''}></label><button type="button" class="tbtn" data-ta-clear title="Kayıtlı analizi kaldır (kurallar değişmez)"><svg class="ic"><use href="#i-trash"/></svg><span>Analizi Kaldır</span></button></div>
        </div>
        <div class="pricingRuleGrid">
          <div class="pricingRuleField"><label>Dönem Bazı</label><select data-ta-view="basis">${summary.options.bases.map(b => opt(b, TA().BASIS_LABELS[b], view.basis)).join('')}</select></div>
          <div class="pricingRuleField"><label>Yıl</label><select data-ta-view="year">${summary.options.years.map(y => opt(y, y, view.year)).join('')}</select></div>
          <div class="pricingRuleField"><label>Taşıt</label><select data-ta-view="vehicle">${opt('*', 'Tüm taşıtlar', view.vehicle)}${summary.options.vehicles.map(v => opt(v, vehicleLabel(v), view.vehicle)).join('')}</select></div>
          <div class="pricingRuleField"><label>Kurala Esas Süre</label><select data-ta-view="metric">${Object.entries(TA().RULE_METRICS).map(([k, l]) => opt(k, l, view.metric)).join('')}</select></div>
          <div class="pricingRuleField"><label>İstatistik</label><select data-ta-view="stat">${Object.entries(TA().RULE_STATS).map(([k, l]) => opt(k, l, view.stat)).join('')}</select></div>
        </div>
        ${totals ? `<div style="display:flex;gap:10px;flex-wrap:wrap;">${totals}</div>` : ''}
        <div style="font-size:11px;color:var(--muted);display:flex;gap:14px;flex-wrap:wrap;"><span><span style="display:inline-block;width:10px;height:6px;border-radius:2px;background:var(--blue);"></span> Yükleme (talep → fiili yükleme)</span><span><span style="display:inline-block;width:10px;height:6px;border-radius:2px;background:var(--teal);"></span> Yol (fiili yükleme → özet beyan)</span><span><span style="display:inline-block;width:10px;height:6px;border-radius:2px;background:var(--orange);"></span> Gümrük (özet beyan → antrepo)</span><span>Süreler gün; adet ağırlıklı ortalama.</span></div>
        <div style="border:1px solid var(--line);border-radius:var(--r-md);overflow:auto;max-height:420px;"><table class="pricingRulesTable"><thead><tr>
          <th><input type="checkbox" data-ta-all title="Tümünü seç" ${picked && picked === summary.rows.filter(r => r.vehicle && suggestions.has(rowId(r))).length ? 'checked' : ''}></th><th>Taşıt</th><th>Ülke</th><th style="text-align:right;">Adet</th><th style="text-align:right;">Yükleme</th><th style="text-align:right;">Yol</th><th style="text-align:right;">Gümrük</th><th style="text-align:right;">Uçtan Uca</th><th style="text-align:right;">P80</th><th style="text-align:right;">Min–Maks</th><th style="text-align:right;">Trend</th><th style="text-align:right;">Mevcut Gün</th><th style="text-align:right;">Önerilen Gün</th><th></th>
        </tr></thead><tbody>${body || '<tr><td colspan="14" style="padding:14px;text-align:center;color:var(--muted);">Bu seçim için veri yok.</td></tr>'}</tbody></table></div>
        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;"><span data-ta-status style="font-size:11.5px;color:var(--muted);">${picked} öneri seçili · Öneri: ${esc(TA().RULE_METRICS[view.metric])}, ${esc(TA().RULE_STATS[view.stat])}. Aktarım yalnız tarihsiz + sezonsuz ülke/taşıt kuralını ekler veya günceller.</span><span style="flex:1"></span>
          <button type="button" class="navActionBtn" data-ta-apply ${picked ? '' : 'disabled'}><svg class="ic"><use href="#i-copy-plus"/></svg><span>Seçili Önerileri Kurallara Aktar</span></button></div>
      </div>`;
      bindFile();
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
        toast(`${result.added} kural eklendi, ${result.updated} güncellendi${result.unchanged ? `, ${result.unchanged} aynı` : ''}. Kalıcı olması için "Kuralları Kaydet".`);
        render();
      });
      container.querySelector('[data-ta-clear]')?.addEventListener('click', async () => {
        if (!global.confirm('Kayıtlı yol süresi analizi kaldırılsın mı? Yol Süreleri kuralları değişmez.')) return;
        try { await save(null); selected.clear(); render(); toast('Yol süresi analizi kaldırıldı.'); }
        catch (err) { toast('Analiz kaldırılamadı: ' + err.message); }
      });
    }

    function bindFile() {
      container.querySelectorAll('[data-ta-file]').forEach(input => input.addEventListener('change', async () => {
        const file = input.files && input.files[0];
        input.value = '';
        if (!file || busy) return;
        busy = true; render();
        try {
          const parsed = await readWorkbookFile(file);
          if (!parsed) throw new Error('Rapor yapısı tanınmadı: "Ürün Menşei" ve "Yıl Ay/Hafta" başlıklı pivot sayfası bulunamadı.');
          await save(parsed);
          selected.clear(); view.basis = ''; view.year = '';
          toast(`${parsed.records.length} ülke/dönem kaydı okundu (${parsed.sources.length} kaynak pivot).`);
        } catch (err) {
          toast('Analiz yüklenemedi: ' + err.message);
        } finally { busy = false; render(); }
      }));
    }

    container.innerHTML = '<div style="padding:12px;color:var(--muted);font-size:11.5px;">Yol süresi analizi yükleniyor…</div>';
    load().then(render).catch(err => {
      container.innerHTML = `<div style="padding:12px;color:var(--red);font-size:11.5px;">Yol süresi analizi okunamadı: ${esc(err.message)}</div>`;
    });
    return { refresh: () => load(true).then(render), render };
  }

  function invalidate() { store.loaded = false; }

  global.BLTransitAnalysisUI = { mount, load, save, invalidate, readWorkbookFile };
})(typeof window !== 'undefined' ? window : globalThis);
