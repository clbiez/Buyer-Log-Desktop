/* Buyer Log — İthalat Yol Süresi Analizi (tarayıcı + Node.js, bağımlılıksız).
 *
 * Kaynak: Global Lojistik "İthalat Yol Süresi Raporu" pivot Excel'i. Sayfalar
 * ülke (Ürün Menşei) × dönem (Fiili Yükleme / Tema Depo Giriş Yıl Ay|Hafta)
 * kırılımında Yükleme / Yol / Gümrük / Uçtan Uca süreleri ve alt süreç
 * adımlarını taşır. Pivot filtre bloğundaki "Vasita Tanim" taşıt tipidir.
 *
 * Bu modül yalnız deterministik iş gerçeğini üretir:
 *   parseWorkbook  → ham sayfa satırlarından normalize analiz kaydı
 *   normalizeAnalysis → sunucu/istemci ortak doğrulama (kalıcı şekil)
 *   summarize      → ülke × taşıt özet (adet ağırlıklı ortalama, P80, trend)
 *   suggestRules / applySuggestions → Yol Süreleri kurallarına aktarım
 * Kural motoru (business-rules.js) değişmez; analiz yalnız kural üretir. */
(function attachTransitAnalysis(root, factory) {
  const api = factory(root && root.BLBusinessRules
    ? root.BLBusinessRules
    : (typeof require === 'function' ? require('./business-rules.js') : null));
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.BLTransitAnalysis = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createTransitAnalysis(rules) {
  'use strict';

  const VERSION = 1;
  const MAX_RECORDS = 20000;
  const MAX_STEPS = 20000;
  const MAX_SOURCES = 60;
  const BASES = Object.freeze(['loading', 'warehouse']);
  const GRANULARITIES = Object.freeze(['month', 'week']);
  const MAIN_METRICS = Object.freeze(['loading', 'transit', 'customs', 'endToEnd']);
  // Etiketler [Türkçe, English] çiftidir; *_LABELS / RULE_* sabitleri Türkçe
  // (geriye uyumlu) kalır, labels(lang) aktif dilin karşılığını verir.
  const TEXT = Object.freeze({
    metric: {
      loading: ['Yükleme Süresi', 'Loading Time'], transit: ['Yol Süresi', 'Transit Time'],
      customs: ['Gümrük Süresi (Antrepo)', 'Customs Time (Bonded Warehouse)'], endToEnd: ['Uçtan Uca Yol Süresi', 'End-to-End Lead Time'],
    },
    basis: { loading: ['Fiili Yükleme bazlı', 'Based on actual loading'], warehouse: ['Tema Depo Giriş bazlı', 'Based on Tema warehouse entry'] },
    /* Kural gün sayısı Ex-Factory'ye eklenir (Tahmini Antrepo = Ex-Factory + gün).
       Hangi analiz aralığının bu güne karşılık geleceği kullanıcı seçimidir. */
    ruleMetric: {
      endToEnd: ['Uçtan Uca (Yükleme Talep → Antrepo)', 'End-to-end (Loading Request → Antrepo)'],
      handoverToWarehouse: ['Handover → Antrepo (Uçtan Uca − Üretici teslim)', 'Handover → Antrepo (end-to-end − supplier handover)'],
      loadingToWarehouse: ['Fiili Yükleme → Antrepo (Yol + Gümrük)', 'Actual Loading → Antrepo (transit + customs)'],
    },
    ruleStat: { mean: ['Adet ağırlıklı ortalama', 'Quantity-weighted average'], p80: ['P80 (temkinli)', 'P80 (conservative)'] },
  });
  const langIndex = lang => (lang === 'en' ? 1 : 0);
  function pickText(map, lang) {
    const i = langIndex(lang);
    return Object.freeze(Object.fromEntries(Object.entries(map).map(([key, pair]) => [key, pair[i]])));
  }
  function labels(lang) {
    return { metric: pickText(TEXT.metric, lang), basis: pickText(TEXT.basis, lang), ruleMetric: pickText(TEXT.ruleMetric, lang), ruleStat: pickText(TEXT.ruleStat, lang) };
  }
  const METRIC_LABELS = pickText(TEXT.metric, 'tr');
  const BASIS_LABELS = pickText(TEXT.basis, 'tr');
  const RULE_METRICS = pickText(TEXT.ruleMetric, 'tr');
  const RULE_STATS = pickText(TEXT.ruleStat, 'tr');
  const LOW_SAMPLE_QTY = 50000;
  const LOW_SAMPLE_PERIODS = 3;
  const LOW_SAMPLE_SHIPMENTS = 5;

  // Excel'deki Türkçe ülke adı → Buyer Log CP "Country" görünen adı.
  const COUNTRY_NAMES = Object.freeze({
    BANGLADES: 'Bangladesh', BANGLADESH: 'Bangladesh', CIN: 'China', CHINA: 'China',
    HINDISTAN: 'India', INDIA: 'India', MISIR: 'Egypt', EGYPT: 'Egypt', MYANMAR: 'Myanmar',
    ENDONEZYA: 'Indonesia', INDONESIA: 'Indonesia', PAKISTAN: 'Pakistan',
    KAMBOCYA: 'Cambodia', CAMBODIA: 'Cambodia', RUANDA: 'Rwanda', RWANDA: 'Rwanda',
    VIETNAM: 'Vietnam', 'VIET NAM': 'Vietnam', FAS: 'Morocco', MOROCCO: 'Morocco',
    TURKIYE: 'Turkey', TURKEY: 'Turkey', TURKMENISTAN: 'Turkmenistan', 'SRI LANKA': 'Sri Lanka', TUNUS: 'Tunisia', TUNISIA: 'Tunisia',
    ETIYOPYA: 'Ethiopia', ETHIOPIA: 'Ethiopia', OZBEKISTAN: 'Uzbekistan', UZBEKISTAN: 'Uzbekistan',
  });

  const TR_MAP = { 'İ': 'I', 'I': 'I', 'ı': 'I', 'Ş': 'S', 'ş': 'S', 'Ç': 'C', 'ç': 'C', 'Ö': 'O', 'ö': 'O', 'Ü': 'U', 'ü': 'U', 'Ğ': 'G', 'ğ': 'G' };
  function text(value) { return String(value == null ? '' : value).replace(/\s+/g, ' ').trim(); }
  function key(value) {
    return text(value).replace(/[İIıŞşÇçÖöÜüĞğ]/g, c => TR_MAP[c] || c).toUpperCase().replace(/\s+/g, ' ').trim();
  }
  function clip(value, max = 120) { return text(value).slice(0, max); }
  function num(value) {
    if (value == null || value === '') return null;
    const n = typeof value === 'number' ? value : Number(String(value).replace(/\s/g, '').replace(',', '.'));
    return Number.isFinite(n) ? n : null;
  }
  function round(value, digits = 2) {
    if (!Number.isFinite(value)) return null;
    const f = 10 ** digits;
    const out = Math.round(value * f) / f;
    return out === 0 ? 0 : out; // -0 → 0 ("-0" gösterilmesin)
  }

  function countryKey(value) {
    return rules && rules.transitCountryKey ? rules.transitCountryKey(value) : key(value);
  }
  function countryRuleName(value) {
    const k = key(value);
    if (COUNTRY_NAMES[k]) return COUNTRY_NAMES[k];
    // Bilinmeyen ülke: ASCII başlık biçimi (Türkçe küçük harf "ı" üretmesin).
    return k.toLowerCase().replace(/(^|[\s-])([a-z])/g, (m, sep, c) => sep + c.toUpperCase());
  }
  function vehicleType(value) {
    const t = key(value);
    if (!t || t === 'ALL' || t === 'TUMU' || t.includes('BIRDEN COK')) return '';
    return rules && rules.normalizeTransitDelType ? rules.normalizeTransitDelType(value) : text(value);
  }

  /* ---------- Excel pivot okuma ---------- */
  function headerKind(label) {
    const k = key(label);
    if (!k) return null;
    if (k === 'URUN MENSEI') return { type: 'country' };
    const period = k.match(/(FIILI YUKLEME|TEMA DEPO GIRIS).*YIL (AY|HAFTA)$/);
    if (period) return { type: 'period', basis: period[1] === 'FIILI YUKLEME' ? 'loading' : 'warehouse', granularity: period[2] === 'AY' ? 'month' : 'week' };
    if (k === 'YUKLEME SURESI') return { type: 'metric', metric: 'loading' };
    if (k === 'YOL SURESI') return { type: 'metric', metric: 'transit' };
    if (k === 'FIILI YUKLEME - ETA') return { type: 'alias' };
    if (k.startsWith('GUMRUK SURESI')) return { type: 'metric', metric: 'customs' };
    if (k === 'UCTAN UCA YOL SURESI') return { type: 'metric', metric: 'endToEnd' };
    if (k === 'YUKLEME TOPLAM ADET') return { type: 'qty' };
    if (k.startsWith('ANTREPO/DEPO KABUL')) return { type: 'acceptance' };
    const step = text(label).match(/^(\d+(?:\.\d+)?)\.?\s+(.+)$/);
    if (step) {
      const code = step[1];
      const major = Number(code.split('.')[0]);
      const group = major <= 3 ? 'loading' : major === 4 ? 'transit' : 'customs';
      // 1.2 ve 4.1 bilgi amaçlıdır; üst adımın içinde yer alır (Açıklamalar sayfası).
      return { type: 'step', code, label: clip(step[2], 90), group, informational: code.includes('.') };
    }
    return null;
  }

  function readFilters(rows, headerIndex) {
    const filters = {};
    for (let i = 0; i < headerIndex; i += 1) {
      const row = rows[i] || [];
      const label = text(row[0]);
      if (!label || row[1] == null || row[1] === '') continue;
      if (!Object.prototype.hasOwnProperty.call(filters, label)) filters[label] = text(row[1]);
    }
    return filters;
  }

  function findHeader(rows) {
    const limit = Math.min(rows.length, 40);
    for (let i = 0; i < limit; i += 1) {
      const kinds = (rows[i] || []).map(headerKind);
      const country = kinds.findIndex(k => k && k.type === 'country');
      const period = kinds.findIndex(k => k && k.type === 'period');
      const metrics = kinds.filter(k => k && (k.type === 'metric' || k.type === 'step')).length;
      if (country >= 0 && period >= 0 && metrics) return { index: i, kinds, country, period };
    }
    return null;
  }

  function filterValue(filters, wanted) {
    const hit = Object.keys(filters).find(label => key(label) === wanted);
    return hit ? filters[hit] : '';
  }

  /* sheets: [{ name, rows }] — rows SheetJS sheet_to_json(header:1) dizisi. */
  function parseSheet(sheet) {
    const rows = Array.isArray(sheet && sheet.rows) ? sheet.rows : [];
    const header = findHeader(rows);
    if (!header) return null;
    const periodKind = header.kinds[header.period];
    const filters = readFilters(rows, header.index);
    const vehicleRaw = filterValue(filters, 'VASITA TANIM');
    const vehicle = vehicleType(vehicleRaw);
    const records = [];
    const stepRows = [];
    for (let r = header.index + 1; r < rows.length; r += 1) {
      const row = rows[r] || [];
      const country = clip(row[header.country], 60);
      const periodText = text(row[header.period]).replace(/\.0+$/, '');
      if (!country || !/^\d{6}$/.test(periodText) || key(country) === 'GENEL TOPLAM') continue;
      const record = { country, period: periodText, qty: 0, loading: null, transit: null, customs: null, endToEnd: null };
      const steps = {};
      header.kinds.forEach((kind, col) => {
        if (!kind) return;
        const value = num(row[col]);
        if (kind.type === 'qty') record.qty = value != null && value > 0 ? Math.round(value) : 0;
        else if (kind.type === 'metric') record[kind.metric] = value == null ? null : round(value, 2);
        else if (kind.type === 'step' && value != null) steps[kind.code] = round(value, 2);
      });
      if (!MAIN_METRICS.some(m => record[m] != null) && !Object.keys(steps).length) continue;
      records.push(record);
      if (Object.keys(steps).length) stepRows.push({ country, period: periodText, qty: record.qty, steps });
    }
    if (!records.length) return null;
    const stepDefs = header.kinds.filter(k => k && k.type === 'step')
      .map(k => ({ code: k.code, label: k.label, group: k.group, informational: !!k.informational }));
    return {
      sheet: clip(sheet.name, 80),
      basis: periodKind.basis,
      granularity: periodKind.granularity,
      vehicle,
      vehicleLabel: clip(vehicleRaw || 'Tümü', 40),
      finalDestination: clip(filterValue(filters, 'FINAL DESTINATION'), 40),
      hasMain: records.some(rec => rec.endToEnd != null),
      records,
      stepDefs,
      stepRows,
    };
  }

  function weightedMean(items, pick) {
    let sum = 0, weight = 0, plainSum = 0, plainCount = 0;
    for (const item of items) {
      const v = pick(item);
      if (v == null || !Number.isFinite(v)) continue;
      const w = Number(item.qty) > 0 ? Number(item.qty) : 0;
      sum += v * w; weight += w; plainSum += v; plainCount += 1;
    }
    if (weight > 0) return sum / weight;
    return plainCount ? plainSum / plainCount : null;
  }

  function yearOf(period) { return String(period || '').slice(0, 4); }

  /* Aynı veri farklı pivotlarda (aylık/haftalık, ana/alt süreç) tekrar eder.
     Çift sayımı önlemek için her (baz, taşıt, yıl) için tek ana veri seti
     (aylık > haftalık, sonra en çok satır) ve tek adım veri seti seçilir. */
  function metricRichness(slice) {
    return MAIN_METRICS.filter(m => slice.rows.some(row => row[m] != null)).length;
  }
  function pickBest(candidates) {
    return candidates.slice().sort((a, b) => {
      const g = GRANULARITIES.indexOf(a.granularity) - GRANULARITIES.indexOf(b.granularity);
      if (g) return g;
      const rich = metricRichness(b) - metricRichness(a);
      if (rich) return rich;
      return b.rows.length - a.rows.length;
    })[0] || null;
  }

  function parseWorkbook(sheets, meta = {}) {
    const parsed = (Array.isArray(sheets) ? sheets : []).map(parseSheet).filter(Boolean);
    const slices = new Map();
    for (const sheet of parsed) {
      const byYear = new Map();
      sheet.records.forEach(rec => { const y = yearOf(rec.period); if (!byYear.has(y)) byYear.set(y, []); byYear.get(y).push(rec); });
      for (const [year, rows] of byYear) {
        const id = [sheet.basis, sheet.vehicle, year].join('|');
        if (!slices.has(id)) slices.set(id, { main: [], steps: [] });
        const slice = { sheet, year, granularity: sheet.granularity, rows };
        if (sheet.hasMain) slices.get(id).main.push(slice);
        if (sheet.stepDefs.length) slices.get(id).steps.push({ ...slice, rows: sheet.stepRows.filter(s => yearOf(s.period) === year) });
      }
    }
    const records = [];
    const steps = [];
    const sources = [];
    for (const [id, slice] of slices) {
      const [basis, vehicle, year] = id.split('|');
      const main = pickBest(slice.main);
      if (main) {
        main.rows.forEach(rec => {
          if (rec.endToEnd == null && rec.loading == null && rec.transit == null && rec.customs == null) return;
          records.push({ basis, vehicle, year, granularity: main.granularity, period: rec.period, country: rec.country,
            qty: rec.qty, loading: rec.loading, transit: rec.transit, customs: rec.customs, endToEnd: rec.endToEnd });
        });
        sources.push({ sheet: main.sheet.sheet, role: 'main', basis, vehicle, vehicleLabel: main.sheet.vehicleLabel, year, granularity: main.granularity, rows: main.rows.length });
      }
      const stepSlice = pickBest(slice.steps);
      if (stepSlice) {
        const byCountry = new Map();
        stepSlice.rows.forEach(row => { if (!byCountry.has(row.country)) byCountry.set(row.country, []); byCountry.get(row.country).push(row); });
        for (const [country, rows] of byCountry) {
          for (const def of stepSlice.sheet.stepDefs) {
            const mean = weightedMean(rows, row => row.steps[def.code]);
            if (mean == null) continue;
            const qty = rows.reduce((s, row) => s + (row.steps[def.code] != null ? (Number(row.qty) || 0) : 0), 0);
            steps.push({ basis, vehicle, year, country, code: def.code, label: def.label, group: def.group,
              informational: def.informational, days: round(mean, 2), qty });
          }
        }
        sources.push({ sheet: stepSlice.sheet.sheet, role: 'steps', basis, vehicle, vehicleLabel: stepSlice.sheet.vehicleLabel, year, granularity: stepSlice.granularity, rows: stepSlice.rows.length });
      }
    }
    return normalizeAnalysis({
      version: VERSION,
      fileName: meta.fileName,
      importedAt: meta.importedAt || new Date().toISOString(),
      importedBy: meta.importedBy,
      sheetCount: Array.isArray(sheets) ? sheets.length : 0,
      parsedSheets: parsed.map(s => s.sheet),
      sources, records, steps,
    });
  }

  /* ---------- Buyer Log IAS (Antrepo) parsiyellerinden doğrudan analiz ----------
     Excel gerekmez: Buyer Log'un ASAS + IAS kaynağından (Database / Dashboard /
     Excel) zaten okuduğu her parsiyel bir sevkiyattır. Antrepoya girmiş
     parsiyellerin tarih farkları ülke (ASAS üretim ülkesi) × taşıt (Vasita
     Tanim) × antrepo giriş ayı kırılımında adet ağırlıklı toplanır.
     shipment: { country, vehicle, qty, loadingRequest, handover, actualLoading?,
                 eta, warehouseEntry, arrived }  — tarihler 'YYYY-MM-DD'. */
  const SHIPMENT_STEPS = Object.freeze([
    { code: '1', label: 'Yükleme Talep → Handover (üretici teslim)', labelEn: 'Loading Request → Handover (supplier handover)', group: 'loading' },
    { code: '2', label: 'Handover → ETA (yükleme + deniz/hava yolu)', labelEn: 'Handover → ETA (loading + sea/air transit)', group: 'transit' },
    { code: '2.1', label: 'Handover → Fiili Yükleme', labelEn: 'Handover → Actual Loading', group: 'loading', informational: true },
    { code: '2.2', label: 'Fiili Yükleme → ETA', labelEn: 'Actual Loading → ETA', group: 'transit', informational: true },
    { code: '3', label: 'ETA → Antrepo Giriş (gümrük + iç nakliye)', labelEn: 'ETA → Antrepo Entry (customs + inland haulage)', group: 'customs' },
  ]);
  /* Buyer Log verisinden üretilen adımların etiketi aktif dilde gösterilir;
     Excel raporundan gelen adım adları kaynak verisidir, olduğu gibi kalır. */
  function stepLabel(step, analysis, lang) {
    if (lang !== 'en' || !step || !analysis || analysis.source !== 'database') return step ? step.label : '';
    const def = SHIPMENT_STEPS.find(s => s.code === step.code && s.label === step.label);
    return def ? def.labelEn : step.label;
  }
  const MIN_SPAN = -60;
  const MAX_SPAN = 365;
  function dayOrdinal(value) {
    const m = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m ? Math.round(Date.UTC(+m[1], +m[2] - 1, +m[3]) / 86400000) : null;
  }
  function span(from, to) {
    const a = dayOrdinal(from), b = dayOrdinal(to);
    if (a == null || b == null) return null;
    const d = b - a;
    return d < MIN_SPAN || d > MAX_SPAN ? null : d;
  }
  function monthOf(value) { const m = String(value || '').match(/^(\d{4})-(\d{2})/); return m ? m[1] + m[2] : ''; }

  function buildFromShipments(shipments, meta = {}) {
    const today = dayOrdinal(meta.today || new Date().toISOString().slice(0, 10));
    const stats = { total: 0, used: 0, notArrived: 0, missingDates: 0, outOfRange: 0, missingVehicle: 0, missingCountry: 0 };
    const groups = new Map();
    const stepGroups = new Map();
    const add = (map, id, seed) => { if (!map.has(id)) map.set(id, { ...seed, items: [] }); return map.get(id); };
    for (const raw of Array.isArray(shipments) ? shipments : []) {
      stats.total += 1;
      const s = raw || {};
      if (!s.arrived) { stats.notArrived += 1; continue; }
      const country = clip(s.country, 60);
      if (!country) { stats.missingCountry += 1; continue; }
      const vehicle = vehicleType(s.vehicle);
      if (!vehicle) stats.missingVehicle += 1;
      const entry = dayOrdinal(s.warehouseEntry);
      if (entry == null || dayOrdinal(s.loadingRequest) == null) { stats.missingDates += 1; continue; }
      if (today != null && entry > today) { stats.notArrived += 1; continue; }
      const endToEnd = span(s.loadingRequest, s.warehouseEntry);
      if (endToEnd == null || endToEnd < 0) { stats.outOfRange += 1; continue; }
      const departure = s.actualLoading || s.handover;
      const item = {
        qty: Math.max(0, Math.round(num(s.qty) || 0)),
        endToEnd,
        loading: span(s.loadingRequest, departure),
        transit: span(departure, s.eta),
        customs: span(s.eta, s.warehouseEntry),
        steps: {
          1: span(s.loadingRequest, s.handover),
          2: span(s.handover, s.eta),
          2.1: s.actualLoading ? span(s.handover, s.actualLoading) : null,
          2.2: s.actualLoading ? span(s.actualLoading, s.eta) : null,
          3: span(s.eta, s.warehouseEntry),
        },
      };
      stats.used += 1;
      const period = monthOf(s.warehouseEntry);
      add(groups, ['warehouse', vehicle, country, period].join('|'), { basis: 'warehouse', vehicle, country, period }).items.push(item);
      add(stepGroups, ['warehouse', vehicle, country, period.slice(0, 4)].join('|'), { basis: 'warehouse', vehicle, country, year: period.slice(0, 4) }).items.push(item);
      if (s.actualLoading && dayOrdinal(s.actualLoading) != null) {
        const lp = monthOf(s.actualLoading);
        add(groups, ['loading', vehicle, country, lp].join('|'), { basis: 'loading', vehicle, country, period: lp }).items.push(item);
        add(stepGroups, ['loading', vehicle, country, lp.slice(0, 4)].join('|'), { basis: 'loading', vehicle, country, year: lp.slice(0, 4) }).items.push(item);
      }
    }
    const records = [...groups.values()].map(g => {
      const out = { basis: g.basis, vehicle: g.vehicle, year: g.period.slice(0, 4), granularity: 'month', period: g.period, country: g.country,
        qty: g.items.reduce((sum, it) => sum + it.qty, 0), shipments: g.items.length };
      MAIN_METRICS.forEach(m => { out[m] = round(weightedMean(g.items, it => it[m]), 2); });
      return out;
    });
    const steps = [];
    for (const g of stepGroups.values()) {
      for (const def of SHIPMENT_STEPS) {
        const mean = weightedMean(g.items, it => it.steps[def.code]);
        if (mean == null) continue;
        steps.push({ basis: g.basis, vehicle: g.vehicle, year: g.year, country: g.country, code: def.code, label: def.label,
          group: def.group, informational: !!def.informational, days: round(mean, 2),
          qty: g.items.reduce((sum, it) => sum + (it.steps[def.code] != null ? it.qty : 0), 0) });
      }
    }
    const sources = [];
    const seen = new Set();
    records.forEach(r => {
      const id = [r.basis, r.vehicle, r.year].join('|');
      if (seen.has(id)) return; seen.add(id);
      sources.push({ sheet: meta.sourceLabel || 'Buyer Log IAS parsiyelleri', role: 'main', basis: r.basis, vehicle: r.vehicle,
        vehicleLabel: r.vehicle || 'Belirsiz', year: r.year, granularity: 'month',
        rows: records.filter(x => x.basis === r.basis && x.vehicle === r.vehicle && x.year === r.year).length });
    });
    const analysis = normalizeAnalysis({
      version: VERSION, source: 'database', fileName: meta.sourceLabel || 'Buyer Log IAS (Antrepo) verisi',
      importedAt: meta.generatedAt || new Date().toISOString(), importedBy: '', sheetCount: 0, parsedSheets: [],
      sources, records, steps, stats,
    });
    return analysis || { version: VERSION, source: 'database', records: [], steps: [], sources: [], stats: normalizeStats(stats),
      fileName: meta.sourceLabel || 'Buyer Log IAS (Antrepo) verisi', importedAt: new Date().toISOString(), importedBy: '', sheetCount: 0, parsedSheets: [] };
  }

  function normalizeStats(input) {
    if (!input || typeof input !== 'object') return null;
    const out = {};
    ['total', 'used', 'notArrived', 'missingDates', 'outOfRange', 'missingVehicle', 'missingCountry'].forEach(k => {
      out[k] = Math.max(0, Math.round(num(input[k]) || 0));
    });
    return out;
  }

  /* Kaynağa göre süre tanımları: rapor (Excel) ile IAS parsiyelinin kesitleri farklıdır. */
  function metricLabels(analysis, lang) {
    const i = langIndex(lang);
    if (analysis && analysis.source === 'database') {
      return {
        loading: ['Yükleme Talep → Handover/Fiili Yükleme', 'Loading Request → Handover/Actual Loading'][i],
        transit: ['Handover/Fiili Yükleme → ETA', 'Handover/Actual Loading → ETA'][i],
        customs: ['ETA → Antrepo Giriş', 'ETA → Antrepo Entry'][i],
        endToEnd: ['Yükleme Talep → Antrepo Giriş', 'Loading Request → Antrepo Entry'][i],
        rule: {
          endToEnd: TEXT.ruleMetric.endToEnd[i],
          handoverToWarehouse: TEXT.ruleMetric.handoverToWarehouse[i],
          loadingToWarehouse: ['Handover/Fiili Yükleme → Antrepo', 'Handover/Actual Loading → Antrepo'][i],
        },
      };
    }
    return {
      loading: ['Yükleme Talep → Fiili Yükleme', 'Loading Request → Actual Loading'][i],
      transit: ['Fiili Yükleme → Özet Beyan', 'Actual Loading → Summary Declaration'][i],
      customs: ['Özet Beyan → Antrepo', 'Summary Declaration → Antrepo'][i],
      endToEnd: ['Yükleme Talep → Tema Depo/Antrepo Giriş', 'Loading Request → Tema Warehouse/Antrepo Entry'][i],
      rule: { ...pickText(TEXT.ruleMetric, lang) },
    };
  }

  /* ---------- Kalıcı şekil (sunucu ve istemci aynı doğrulamayı kullanır) ---------- */
  function cleanMetric(value) {
    const n = num(value);
    return n == null || Math.abs(n) > 3650 ? null : round(n, 2);
  }
  function normalizeAnalysis(input) {
    if (!input || typeof input !== 'object') return null;
    const records = (Array.isArray(input.records) ? input.records : []).slice(0, MAX_RECORDS).map(rec => {
      const period = text(rec && rec.period);
      const basis = BASES.includes(rec && rec.basis) ? rec.basis : null;
      const granularity = GRANULARITIES.includes(rec && rec.granularity) ? rec.granularity : null;
      const country = clip(rec && rec.country, 60);
      if (!basis || !granularity || !country || !/^\d{6}$/.test(period)) return null;
      const out = { basis, vehicle: vehicleType(rec.vehicle), year: period.slice(0, 4), granularity, period, country,
        qty: Math.max(0, Math.round(num(rec.qty) || 0)) };
      if (rec.shipments != null) out.shipments = Math.max(0, Math.round(num(rec.shipments) || 0));
      MAIN_METRICS.forEach(m => { out[m] = cleanMetric(rec[m]); });
      return MAIN_METRICS.some(m => out[m] != null) ? out : null;
    }).filter(Boolean);
    if (!records.length) return null;
    const steps = (Array.isArray(input.steps) ? input.steps : []).slice(0, MAX_STEPS).map(step => {
      const basis = BASES.includes(step && step.basis) ? step.basis : null;
      const code = text(step && step.code);
      const days = cleanMetric(step && step.days);
      const country = clip(step && step.country, 60);
      if (!basis || !/^\d+(\.\d+)?$/.test(code) || days == null || !country) return null;
      return { basis, vehicle: vehicleType(step.vehicle), year: text(step.year).slice(0, 4), country, code,
        label: clip(step.label, 90), group: ['loading', 'transit', 'customs'].includes(step.group) ? step.group : 'customs',
        informational: !!step.informational, days, qty: Math.max(0, Math.round(num(step.qty) || 0)) };
    }).filter(Boolean);
    const sources = (Array.isArray(input.sources) ? input.sources : []).slice(0, MAX_SOURCES).map(src => ({
      sheet: clip(src && src.sheet, 80), role: src && src.role === 'steps' ? 'steps' : 'main',
      basis: BASES.includes(src && src.basis) ? src.basis : 'loading', vehicle: vehicleType(src && src.vehicle),
      vehicleLabel: clip(src && src.vehicleLabel, 40), year: text(src && src.year).slice(0, 4),
      granularity: GRANULARITIES.includes(src && src.granularity) ? src.granularity : 'month',
      rows: Math.max(0, Math.round(num(src && src.rows) || 0)),
    }));
    const importedAt = text(input.importedAt);
    return {
      version: VERSION,
      source: input.source === 'database' ? 'database' : 'excel',
      stats: normalizeStats(input.stats),
      fileName: clip(input.fileName, 200),
      importedAt: Number.isFinite(Date.parse(importedAt)) ? new Date(importedAt).toISOString() : new Date().toISOString(),
      importedBy: clip(input.importedBy, 120),
      sheetCount: Math.max(0, Math.round(num(input.sheetCount) || 0)),
      parsedSheets: (Array.isArray(input.parsedSheets) ? input.parsedSheets : []).slice(0, MAX_SOURCES).map(s => clip(s, 80)),
      sources, records, steps,
    };
  }

  /* ---------- Özet ---------- */
  function weightedPercentile(items, pick, p) {
    const values = items.map(item => ({ v: pick(item), w: Number(item.qty) > 0 ? Number(item.qty) : 1 }))
      .filter(x => x.v != null && Number.isFinite(x.v)).sort((a, b) => a.v - b.v);
    if (!values.length) return null;
    const total = values.reduce((s, x) => s + x.w, 0);
    let acc = 0;
    for (const x of values) { acc += x.w; if (acc / total >= p) return x.v; }
    return values[values.length - 1].v;
  }

  function options(analysis, basis) {
    const all = analysis && Array.isArray(analysis.records) ? analysis.records : [];
    const uniq = list => [...new Set(list)];
    const bases = uniq(all.map(r => r.basis)).sort((a, b) => BASES.indexOf(a) - BASES.indexOf(b));
    // Yıl ve taşıt listeleri seçili baza göre daralır; böylece varsayılan yıl
    // seçili bazda gerçekten veri olan en güncel yıldır.
    const records = basis ? all.filter(r => r.basis === basis) : all;
    return {
      bases,
      years: uniq(records.map(r => r.year)).sort().reverse(),
      vehicles: uniq(records.map(r => r.vehicle)).sort((a, b) => (a === '') - (b === '') || a.localeCompare(b, 'tr')),
    };
  }

  function summarize(analysis, filter = {}) {
    const records = analysis && Array.isArray(analysis.records) ? analysis.records : [];
    const steps = analysis && Array.isArray(analysis.steps) ? analysis.steps : [];
    const bases = options(analysis).bases;
    const basis = filter.basis && bases.includes(filter.basis) ? filter.basis : (bases[0] || 'loading');
    const opts = options(analysis, basis);
    const year = filter.year && opts.years.includes(String(filter.year)) ? String(filter.year) : (opts.years[0] || '');
    const scoped = records.filter(r => r.basis === basis && (!year || r.year === year)
      && (filter.vehicle == null || filter.vehicle === '*' || r.vehicle === filter.vehicle));
    const groups = new Map();
    scoped.forEach(rec => {
      const id = rec.vehicle + '|' + countryKey(rec.country);
      if (!groups.has(id)) groups.set(id, []);
      groups.get(id).push(rec);
    });
    const rows = [];
    for (const [, list] of groups) {
      const first = list[0];
      const ordered = list.slice().sort((a, b) => a.period.localeCompare(b.period));
      const qty = list.reduce((s, r) => s + (Number(r.qty) || 0), 0);
      const metrics = {};
      MAIN_METRICS.forEach(m => { metrics[m] = round(weightedMean(list, r => r[m]), 1); });
      const loadingToWarehouse = rec => (rec.transit == null && rec.customs == null) ? null : (Number(rec.transit) || 0) + (Number(rec.customs) || 0);
      const stepList = steps.filter(s => s.basis === basis && (!year || s.year === year) && s.vehicle === first.vehicle && countryKey(s.country) === countryKey(first.country))
        .sort((a, b) => Number(a.code.split('.')[0]) - Number(b.code.split('.')[0]) || a.code.localeCompare(b.code));
      const producerStep = stepList.find(s => s.code === '1');
      const last = ordered.slice(-3);
      const lastMean = weightedMean(last, r => r.endToEnd);
      const e2eValues = list.map(r => r.endToEnd).filter(v => v != null);
      rows.push({
        vehicle: first.vehicle,
        country: first.country,
        countryKey: countryKey(first.country),
        ruleCountry: countryRuleName(first.country),
        qty,
        periods: ordered.length,
        shipments: list.some(r => r.shipments != null) ? list.reduce((s, r) => s + (Number(r.shipments) || 0), 0) : null,
        granularity: first.granularity,
        ...metrics,
        p50: round(weightedPercentile(list, r => r.endToEnd, 0.5), 1),
        p80: round(weightedPercentile(list, r => r.endToEnd, 0.8), 1),
        min: e2eValues.length ? round(Math.min(...e2eValues), 1) : null,
        max: e2eValues.length ? round(Math.max(...e2eValues), 1) : null,
        loadingToWarehouse: round(weightedMean(list, loadingToWarehouse), 1),
        loadingToWarehouseP80: round(weightedPercentile(list, loadingToWarehouse, 0.8), 1),
        producerDays: producerStep ? round(producerStep.days, 1) : null,
        lastMean: round(lastMean, 1),
        trend: lastMean != null && metrics.endToEnd != null ? round(lastMean - metrics.endToEnd, 1) : null,
        // IAS kaynağında örneklem sevkiyat (parsiyel) sayısıdır; raporda adet/dönem.
        lowSample: list.some(r => r.shipments != null)
          ? list.reduce((s, r) => s + (Number(r.shipments) || 0), 0) < LOW_SAMPLE_SHIPMENTS
          : (qty < LOW_SAMPLE_QTY || ordered.length < LOW_SAMPLE_PERIODS),
        // Negatif ana süre, kaynak tarihlerinde tutarsızlık demektir (ör. ETA < fiili yükleme).
        anomaly: ['loading', 'transit', 'customs'].some(m => metrics[m] != null && metrics[m] < 0),
        series: ordered.map(r => ({ period: r.period, endToEnd: r.endToEnd, loading: r.loading, transit: r.transit, customs: r.customs, qty: r.qty })),
        steps: stepList.map(s => ({ code: s.code, label: s.label, group: s.group, informational: s.informational, days: round(s.days, 1) })),
      });
    }
    rows.sort((a, b) => (a.vehicle === '') - (b.vehicle === '') || a.vehicle.localeCompare(b.vehicle, 'tr') || b.qty - a.qty);
    const totals = new Map();
    rows.forEach(row => {
      if (!totals.has(row.vehicle)) totals.set(row.vehicle, []);
      totals.get(row.vehicle).push(row);
    });
    const vehicleTotals = [...totals].map(([vehicle, list]) => {
      const flat = scoped.filter(r => r.vehicle === vehicle);
      const out = { vehicle, countries: list.length, qty: list.reduce((s, r) => s + r.qty, 0) };
      MAIN_METRICS.forEach(m => { out[m] = round(weightedMean(flat, r => r[m]), 1); });
      return out;
    });
    return { basis, year, rows, vehicleTotals, options: opts };
  }

  /* ---------- Kural önerisi ve aktarım ---------- */
  function ruleDays(row, metric = 'endToEnd', stat = 'mean') {
    if (!row) return null;
    let value = null;
    if (metric === 'loadingToWarehouse') value = stat === 'p80' ? row.loadingToWarehouseP80 : row.loadingToWarehouse;
    else {
      value = stat === 'p80' ? row.p80 : row.endToEnd;
      if (metric === 'handoverToWarehouse') value = value == null || row.producerDays == null ? null : value - row.producerDays;
    }
    if (value == null || !Number.isFinite(value)) return null;
    return Math.min(3650, Math.max(0, Math.round(value)));
  }

  function suggestRules(summary, settings = {}) {
    const metric = RULE_METRICS[settings.metric] ? settings.metric : 'endToEnd';
    const stat = RULE_STATS[settings.stat] ? settings.stat : 'mean';
    return (summary && Array.isArray(summary.rows) ? summary.rows : [])
      .filter(row => row.vehicle && row.ruleCountry)
      .map(row => ({ delType: row.vehicle, country: row.ruleCountry, countryKey: row.countryKey, days: ruleDays(row, metric, stat), lowSample: row.lowSample }))
      .filter(s => s.days != null);
  }

  function isAnalysisScope(rule, delType, cKey) {
    if (!rule || rule.exfStart || rule.exfEnd) return false;
    if (Array.isArray(rule.seasons) && rule.seasons.length) return false;
    const countries = Array.isArray(rule.countries) ? rule.countries : [];
    const type = rules && rules.normalizeTransitDelType ? rules.normalizeTransitDelType(rule.delType) : rule.delType;
    return countries.length === 1 && countryKey(countries[0]) === cKey && type === delType;
  }

  /* Yalnız "tarihsiz + sezonsuz + tek ülke + taşıt" kapsamlı kuralı günceller ya
     da ekler. Tarih/sezon kısıtlı elle girilmiş özel kurallara dokunmaz; onlar
     motor tarafından zaten daha özel sayılır. */
  function applySuggestions(currentRules, suggestions) {
    const next = (Array.isArray(currentRules) ? currentRules : []).map(r => ({ ...r }));
    let added = 0, updated = 0, unchanged = 0;
    (Array.isArray(suggestions) ? suggestions : []).forEach(s => {
      const delType = rules && rules.normalizeTransitDelType ? rules.normalizeTransitDelType(s.delType) : s.delType;
      const cKey = countryKey(s.country);
      const days = Number(s.days);
      if (!delType || !cKey || !Number.isInteger(days) || days < 0 || days > 3650) return;
      const hit = next.find(r => isAnalysisScope(r, delType, cKey));
      if (hit) {
        if (Number(hit.days) === days) unchanged += 1;
        else { hit.days = days; updated += 1; }
        return;
      }
      next.push({
        id: 'transit-analysis-' + key(delType).replace(/[^A-Z0-9]+/g, '-').toLowerCase() + '-' + cKey.replace(/[^A-Z0-9]+/g, '-').toLowerCase(),
        exfStart: '', exfEnd: '', seasons: [], countries: [s.country], delType, days,
      });
      added += 1;
    });
    return { rules: next, added, updated, unchanged };
  }

  function currentRuleDays(currentRules, delType, country) {
    if (!delType) return null;
    const cKey = countryKey(country);
    const hit = (Array.isArray(currentRules) ? currentRules : []).find(r => isAnalysisScope(r, delType, cKey));
    if (hit) return { days: Number(hit.days), source: 'rule' };
    const fallback = rules && rules.defaultTransitDays ? rules.defaultTransitDays(delType) : null;
    return fallback == null ? null : { days: fallback, source: 'default' };
  }

  return {
    VERSION, BASES, BASIS_LABELS, METRIC_LABELS, RULE_METRICS, RULE_STATS, LOW_SAMPLE_QTY, LOW_SAMPLE_PERIODS, LOW_SAMPLE_SHIPMENTS,
    headerKind, parseSheet, parseWorkbook, buildFromShipments, labels, metricLabels, stepLabel, normalizeAnalysis, options, summarize,
    ruleDays, suggestRules, applySuggestions, currentRuleDays, countryRuleName, vehicleType,
  };
});
