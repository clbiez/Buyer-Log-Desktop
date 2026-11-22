(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.BLPostFobAnalysis = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  /* FOB SONRASI MALİYET ANALİZİ — saf hesap katmanı (tarayıcı + Node testi).
   *
   * Girdi satırları sipariş × renk × satış ülkesi düzeyindedir (server/lib/
   * postfob-report.js). Birim değerler (FOB, landed, Integral, oranlar) ASLA
   * toplanmaz: her toplamda net sipariş adedi ile ağırlıklandırılır. Oranlar
   * (Landed/FOB gibi) ortalamaların oranı değil, AYNI satır kümesinde
   * Σ(adet×pay) / Σ(adet×payda) olarak hesaplanır; payı veya paydası eksik
   * satır o oranın dışında kalır ve kapsam ayrıca raporlanır.
   */

  const UNIT_KEYS = Object.freeze(['fob', 'landedActual', 'landedForecast', 'integralFirst', 'integralLast', 'financeCost', 'advanceCost', 'customsRate', 'freightRate', 'extraRate', 'tpMultiplier']);
  const DOMESTIC_TOKENS = new Set(['TURKIYE', 'TURKEY', 'TR']);
  const MIN_OUTLIER_SAMPLE = 8;

  function clean(value) { return String(value == null ? '' : value).trim(); }
  function token(value) {
    return clean(value).replace(/[ıİ]/g, 'I').replace(/[şŞ]/g, 'S').replace(/[ğĞ]/g, 'G').replace(/[üÜ]/g, 'U').replace(/[öÖ]/g, 'O').replace(/[çÇ]/g, 'C')
      .toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
  }
  function num(value) { return typeof value === 'number' && Number.isFinite(value) ? value : null; }
  function qtyOf(row) { const q = num(row && row.qty); return q != null && q > 0 ? q : 0; }

  function segmentOf(row) {
    const country = token(row && row.originCountry);
    if (!country) return 'unknown';
    return DOMESTIC_TOKENS.has(country) ? 'domestic' : 'import';
  }

  function rowRatio(row) {
    const landed = num(row && row.landedActual), fob = num(row && row.fob);
    return landed != null && fob != null && fob > 0 && qtyOf(row) > 0 ? landed / fob : null;
  }

  function summarize(rows, extras) {
    const list = Array.isArray(rows) ? rows : [];
    const acc = { qty: 0, lines: 0, orders: new Set() };
    const unit = {}; UNIT_KEYS.forEach(key => { unit[key] = { sum: 0, weight: 0 }; });
    const pair = () => ({ num: 0, den: 0, weight: 0 });
    const landedFob = pair(), integralFob = pair(), forecast = pair(), postFob = { sum: 0, weight: 0 };
    for (const row of list) {
      const q = qtyOf(row);
      acc.lines += 1;
      if (clean(row && row.order)) acc.orders.add(clean(row.order));
      if (!q) continue;
      acc.qty += q;
      for (const key of UNIT_KEYS) {
        const value = num(row[key]);
        if (value == null) continue;
        unit[key].sum += q * value; unit[key].weight += q;
      }
      const fob = num(row.fob), landed = num(row.landedActual), integral = num(row.integralLast), predicted = num(row.landedForecast);
      if (fob != null && fob > 0 && landed != null) {
        landedFob.num += q * landed; landedFob.den += q * fob; landedFob.weight += q;
        postFob.sum += q * (landed - fob); postFob.weight += q;
      }
      if (fob != null && fob > 0 && integral != null) { integralFob.num += q * integral; integralFob.den += q * fob; integralFob.weight += q; }
      if (predicted != null && predicted > 0 && landed != null) { forecast.num += q * (landed - predicted); forecast.den += q * predicted; forecast.weight += q; }
    }
    const metrics = { qty: acc.qty, lines: acc.lines, orders: acc.orders.size };
    for (const key of UNIT_KEYS) metrics[key] = unit[key].weight ? unit[key].sum / unit[key].weight : null;
    metrics.postFob = postFob.weight ? postFob.sum / postFob.weight : null;
    metrics.landedToFob = landedFob.den ? landedFob.num / landedFob.den : null;
    metrics.integralToFob = integralFob.den ? integralFob.num / integralFob.den : null;
    metrics.forecastGap = forecast.den ? forecast.num / forecast.den : null;
    metrics.landedCoverage = acc.qty ? landedFob.weight / acc.qty : null;
    // Pivot düzenleyiciden eklenen ölçüler: SUM, adet ağırlıklı WAVG, AVG, MIN, MAX.
    for (const extra of Array.isArray(extras) ? extras : []) metrics[extra.key] = aggregateExtra(list, extra);
    return metrics;
  }

  function aggregateExtra(rows, extra) {
    const agg = String(extra && extra.agg || 'SUM').toUpperCase();
    let sum = 0, weighted = 0, weight = 0, count = 0, min = null, max = null;
    for (const row of rows) {
      const value = num(row && row[extra.key]);
      if (value == null) continue;
      count += 1; sum += value;
      min = min == null ? value : Math.min(min, value);
      max = max == null ? value : Math.max(max, value);
      const q = qtyOf(row);
      if (q) { weighted += q * value; weight += q; }
    }
    if (!count) return null;
    if (agg === 'WAVG') return weight ? weighted / weight : null;
    if (agg === 'AVG') return sum / count;
    if (agg === 'MIN') return min;
    if (agg === 'MAX') return max;
    return sum;
  }

  /* Arama: sipariş, model, renk, ürün adı, özel kod ve satırdaki bütün metin
     boyutları. Türkçe büyük/küçük harf duyarsız; boşlukla ayrılan her parça
     aynı satırda bulunmalı (VE). */
  // Türkçe küçük harf "KIDS" → "kıds" yapar; arama ı/i farkını yok sayar.
  function fold(value) { return String(value == null ? '' : value).toLocaleLowerCase('tr-TR').replace(/ı/g, 'i'); }
  function searchTokens(value) {
    return fold(value).split(/\s+/).map(part => part.trim()).filter(Boolean);
  }
  function matchesSearch(row, tokens) {
    if (!tokens.length) return true;
    const haystack = Object.values(row || {}).filter(value => typeof value === 'string' && value).join(' \u0001 ');
    const folded = fold(haystack);
    return tokens.every(token => folded.includes(token));
  }

  /* Pivotun gördüğü satır kümesi: kapsam (ithal/yerli) → arama → aykırı süzgeci.
     Aykırı sınırı aramadan ÖNCEKİ kapsamdan hesaplanır; arama eşiği değiştirmez. */
  function prepare(rows, options = {}) {
    const segment = ['import', 'domestic'].includes(options.segment) ? options.segment : 'all';
    const scoped = (Array.isArray(rows) ? rows : []).filter(row => segment === 'all' || segmentOf(row) === segment);
    const bounds = outlierBounds(scoped);
    const tokens = searchTokens(options.search);
    let visible = tokens.length ? scoped.filter(row => matchesSearch(row, tokens)) : scoped;
    if (options.outliersOnly) visible = visible.filter(row => isOutlier(row, bounds));
    const segments = { import: 0, domestic: 0, unknown: 0 };
    for (const row of rows || []) segments[segmentOf(row)] += 1;
    return { scoped, visible, bounds, segments, outlierCount: bounds ? scoped.filter(row => isOutlier(row, bounds)).length : 0 };
  }

  function groupMetrics(rows, bounds, extras) {
    const metrics = summarize(rows, extras);
    metrics.outliers = bounds ? rows.filter(row => isOutlier(row, bounds)).length : null;
    return metrics;
  }

  function quantile(sorted, p) {
    if (!sorted.length) return null;
    const index = (sorted.length - 1) * p, low = Math.floor(index), high = Math.ceil(index);
    return sorted[low] + (sorted[high] - sorted[low]) * (index - low);
  }

  /* Tukey sınırı (Q3 + 1,5×IQR): eşik veriden gelir, elle seçilmiş bir sabit
     kullanıcıya "aykırı" diye yanlış alarm üretmez. Küçük örnekte üretilmez. */
  function outlierBounds(rows) {
    const ratios = (Array.isArray(rows) ? rows : []).map(rowRatio).filter(value => value != null).sort((a, b) => a - b);
    if (ratios.length < MIN_OUTLIER_SAMPLE) return null;
    const q1 = quantile(ratios, 0.25), q3 = quantile(ratios, 0.75), median = quantile(ratios, 0.5), iqr = q3 - q1;
    return { q1, q3, median, upper: q3 + 1.5 * iqr, lower: q1 - 1.5 * iqr, sample: ratios.length };
  }

  function isOutlier(row, bounds) {
    const ratio = rowRatio(row);
    return Boolean(bounds && ratio != null && (ratio > bounds.upper || ratio < bounds.lower));
  }

  function groupKey(row, groupBy) {
    if (groupBy === 'segment') return segmentOf(row);
    return clean(row && row[groupBy]);
  }

  function compare(a, b, key, dir) {
    if (key === 'label') return dir * String(a.label).localeCompare(String(b.label), 'tr', { numeric: true, sensitivity: 'base' });
    const left = num(a.metrics[key]), right = num(b.metrics[key]);
    if (left == null && right == null) return String(a.label).localeCompare(String(b.label), 'tr', { numeric: true });
    if (left == null) return 1;
    if (right == null) return -1;
    return dir * (left - right);
  }

  function analyze(rows, options = {}) {
    const groupBy = clean(options.groupBy) || 'originCountry';
    const segment = ['import', 'domestic'].includes(options.segment) ? options.segment : 'all';
    const scoped = (Array.isArray(rows) ? rows : []).filter(row => segment === 'all' || segmentOf(row) === segment);
    // Sınırlar seçili kapsamın tamamından hesaplanır; "yalnız aykırılar" süzgeci
    // sınırı değiştirmez, aksi hâlde her süzme yeni bir eşik üretirdi.
    const bounds = outlierBounds(scoped);
    const visible = options.outliersOnly ? scoped.filter(row => isOutlier(row, bounds)) : scoped;
    const buckets = new Map();
    for (const row of visible) {
      const key = groupKey(row, groupBy);
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(row);
    }
    const sortKey = clean(options.sort && options.sort.key) || 'qty';
    const sortDir = Number(options.sort && options.sort.dir) === 1 ? 1 : -1;
    const groups = [...buckets.entries()].map(([key, list]) => ({
      key, label: key, rows: list.length,
      outliers: bounds ? list.filter(row => isOutlier(row, bounds)).length : 0,
      metrics: summarize(list),
    })).sort((a, b) => compare(a, b, sortKey, sortDir));
    const segments = { import: 0, domestic: 0, unknown: 0 };
    for (const row of rows || []) segments[segmentOf(row)] += 1;
    return {
      groupBy, segment, bounds,
      total: summarize(visible),
      scopeTotal: summarize(scoped),
      outlierCount: bounds ? scoped.filter(row => isOutlier(row, bounds)).length : 0,
      groups, segments,
    };
  }

  return Object.freeze({ UNIT_KEYS, MIN_OUTLIER_SAMPLE, segmentOf, rowRatio, summarize, outlierBounds, isOutlier, analyze, prepare, groupMetrics, matchesSearch, searchTokens });
});
