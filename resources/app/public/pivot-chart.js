/* Buyer Log — OAB / INTAKE pivot grafiği.
   Pivot ayarından grafik üretir: ilk satır alanı kategori eksenidir; sütun
   alanı varsa onun değerleri, yoksa ikinci satır alanı seri (lejant) olur.
   Görsel dil Backlog grafiğiyle aynıdır (backlogChart* sınıfları, --ui-chart-*
   tokenları). Toplama burada yapılmaz: kaynak modül `measure` geri çağrısıyla
   kendi motorunu (INTAKE WAVG/AVG, OAB pivot motoru) kullanır. */
(function attachPivotChart(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.BLPivotChart = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createPivotChart() {
  'use strict';

  const SERIES_LIMIT = 8;
  const COLUMN_SERIES_LIMIT = 12;
  const esc = value => String(value == null ? '' : value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
  const finite = value => value !== null && value !== '' && value !== undefined && Number.isFinite(Number(value));
  const keyOf = value => String(value == null ? '' : value);

  /* records: kaynak satırlar. measure(records, seriesKey) kaynak motorla tek bir
     hücreyi hesaplar. columnSeries verilirse seriler sütun alanı değerleridir. */
  function buildModel(input) {
    const options = input || {};
    const records = Array.isArray(options.records) ? options.records : [];
    const measure = typeof options.measure === 'function' ? options.measure : () => null;
    const blank = options.blankLabel || '(boş)'; // i18n-ignore — çağıran dil etiketini verir
    const labelOf = value => keyOf(value).trim() || blank;
    const categories = new Map();
    for (const record of records) {
      const value = options.categoryOf ? options.categoryOf(record) : '';
      const key = keyOf(value);
      if (!categories.has(key)) categories.set(key, { key, label: labelOf(value), value, records: [] });
      categories.get(key).records.push(record);
    }
    const orderedCategories = [...categories.values()];
    if (typeof options.compareCategory === 'function') orderedCategories.sort((a, b) => options.compareCategory(a.value, b.value));

    let series = [];
    let totalSeries = 0;
    if (Array.isArray(options.columnSeries) && options.columnSeries.length) {
      const ranked = options.columnSeries.map(entry => {
        const key = keyOf(entry && entry.key);
        return { key, name: labelOf(entry && entry.label != null ? entry.label : key), rank: Math.abs(Number(measure(records, key)) || 0) };
      }).sort((a, b) => b.rank - a.rank);
      totalSeries = ranked.length;
      const shown = ranked.slice(0, COLUMN_SERIES_LIMIT);
      if (typeof options.compareSeries === 'function') shown.sort((a, b) => options.compareSeries(a.key, b.key));
      series = shown.map(item => ({
        key: item.key, name: item.name,
        values: orderedCategories.map(category => { const v = measure(category.records, item.key); return finite(v) ? Number(v) : null; }),
      }));
    } else if (typeof options.seriesOf === 'function') {
      const groups = new Map();
      for (const record of records) {
        const value = options.seriesOf(record);
        const key = keyOf(value);
        if (!groups.has(key)) groups.set(key, { key, name: labelOf(value), records: [] });
        groups.get(key).records.push(record);
      }
      const ranked = [...groups.values()].map(group => ({ ...group, rank: Math.abs(Number(measure(group.records, null)) || 0) }))
        .sort((a, b) => b.rank - a.rank);
      totalSeries = ranked.length;
      const top = ranked.length > SERIES_LIMIT ? ranked.slice(0, SERIES_LIMIT - 1) : ranked.slice();
      // En büyük seriler seçildikten sonra lejant pivot sırasını izler (ör. aylar kronolojik).
      if (typeof options.compareSeries === 'function') top.sort((a, b) => options.compareSeries(a.records[0] && options.seriesOf(a.records[0]), b.records[0] && options.seriesOf(b.records[0])));
      const topKeys = new Set(top.map(group => group.key));
      series = top.map(group => ({
        key: group.key, name: group.name,
        values: orderedCategories.map(category => {
          const subset = category.records.filter(record => keyOf(options.seriesOf(record)) === group.key);
          if (!subset.length) return null;
          const v = measure(subset, null); return finite(v) ? Number(v) : null;
        }),
      }));
      if (ranked.length > top.length) {
        series.push({
          key: '__other', name: options.otherLabel || 'Diğer', other: true, // i18n-ignore — çağıran dil etiketini verir
          values: orderedCategories.map(category => {
            const subset = category.records.filter(record => !topKeys.has(keyOf(options.seriesOf(record))));
            if (!subset.length) return null;
            const v = measure(subset, null); return finite(v) ? Number(v) : null;
          }),
        });
      }
    } else {
      totalSeries = 1;
      series = [{
        key: '__value', name: options.singleLabel || '',
        values: orderedCategories.map(category => { const v = measure(category.records, null); return finite(v) ? Number(v) : null; }),
      }];
    }
    /* Kategori toplamı da kaynak motordan gelir (ortalama ölçüler toplanmaz). */
    const totals = orderedCategories.map(category => { const v = measure(category.records, null); return finite(v) ? Number(v) : null; });
    return {
      categories: orderedCategories.map(({ key, label, records: rows }) => ({ key, label, records: rows })),
      series, totals, totalSeries,
      categoryLabel: options.categoryLabel || '', seriesLabel: options.seriesLabel || '',
      additive: options.additive !== false,
    };
  }

  function niceStep(span, ticks) {
    const raw = Math.max(span, 1) / Math.max(1, ticks);
    const power = Math.pow(10, Math.floor(Math.log10(raw)));
    const unit = raw / power;
    return (unit <= 1 ? 1 : unit <= 2 ? 2 : unit <= 2.5 ? 2.5 : unit <= 5 ? 5 : 10) * power;
  }

  /* Negatif değerler (ör. OTB) sıfır çizgisinin altına iner; yığılmış görünümde
     pozitif ve negatif parçalar ayrı yığılır. */
  function scaleFor(model, type, hidden) {
    const visible = model.series.filter(serie => !(hidden && hidden.has(serie.key)));
    let lo = 0, hi = 0;
    model.categories.forEach((_, index) => {
      if (type === 'stacked') {
        let pos = 0, neg = 0;
        visible.forEach(serie => { const v = Number(serie.values[index]) || 0; if (v > 0) pos += v; else neg += v; });
        hi = Math.max(hi, pos); lo = Math.min(lo, neg);
      } else {
        visible.forEach(serie => { const v = Number(serie.values[index]); if (Number.isFinite(v)) { hi = Math.max(hi, v); lo = Math.min(lo, v); } });
      }
      if (model.additive && type === 'stacked' && Number.isFinite(model.totals[index])) { hi = Math.max(hi, model.totals[index]); lo = Math.min(lo, model.totals[index]); }
    });
    const step = niceStep(hi - lo, 5);
    const max = hi > 0 ? Math.ceil(hi / step) * step : 0;
    const min = lo < 0 ? Math.floor(lo / step) * step : 0;
    const ticks = [];
    for (let v = min; v <= max + step / 2; v += step) ticks.push(Math.round(v * 1e6) / 1e6);
    return { min, max: max === min ? min + step : max, ticks, step };
  }

  const CHART_TOKENS = Object.freeze(['var(--ui-chart-1)', 'var(--ui-chart-2)', 'var(--ui-chart-3)', 'var(--ui-chart-4)', 'var(--ui-chart-5)', 'var(--ui-chart-6)', 'var(--ui-chart-7)', 'var(--ui-chart-8)']);
  function seriesColor(serie, index) {
    return serie.other ? 'var(--ui-text-muted)' : CHART_TOKENS[index % CHART_TOKENS.length];
  }

  function truncate(text, maxChars) {
    const value = String(text || '');
    return value.length > maxChars ? `${value.slice(0, Math.max(1, maxChars - 1))}…` : value;
  }

  function svg(model, options) {
    const opts = options || {};
    const type = ['stacked', 'grouped', 'line'].includes(opts.type) ? opts.type : 'stacked';
    const hidden = opts.hidden instanceof Set ? opts.hidden : new Set();
    const format = typeof opts.format === 'function' ? opts.format : value => String(value);
    const axisFormat = typeof opts.axisFormat === 'function' ? opts.axisFormat : format;
    const width = 1080, height = 360, left = 24, right = 78, top = 30, bottom = 56;
    const pw = width - left - right, ph = height - top - bottom, plotRight = width - right;
    const scale = scaleFor(model, type, hidden);
    const y = value => top + ph * (1 - (value - scale.min) / (scale.max - scale.min));
    const n = Math.max(1, model.categories.length), step = pw / n;
    const visible = model.series.map((serie, index) => ({ serie, index })).filter(item => !hidden.has(item.serie.key));
    let out = `<svg class="backlogChartSvg pivotChartSvg" viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(opts.title || '')}">`;
    out += `<rect x="0" y="0" width="${width}" height="${height}" class="backlogChartBg"/>`;
    out += `<rect x="${plotRight}" y="${top}" width="${right}" height="${ph}" class="backlogChartPriceAxis"/>`;
    scale.ticks.forEach(value => {
      const ty = y(value);
      out += `<line x1="${left}" x2="${plotRight}" y1="${ty.toFixed(2)}" y2="${ty.toFixed(2)}" class="backlogChartGrid${value === 0 ? ' pivotChartZero' : ''}"/>`;
      out += `<text x="${plotRight + 10}" y="${(ty + 4).toFixed(2)}" text-anchor="start" class="backlogChartAxisText">${esc(axisFormat(value))}</text>`;
    });
    const maxChars = Math.max(3, Math.floor(step / 6.4));
    const labelStep = Math.max(1, Math.ceil(n / Math.max(1, Math.floor(pw / 46))));
    model.categories.forEach((category, i) => {
      if (i % labelStep !== 0 && i !== n - 1) return;
      const x = left + step * (i + 0.5);
      out += `<text x="${x.toFixed(2)}" y="${top + ph + 22}" text-anchor="middle" class="backlogChartAxisText"><title>${esc(category.label)}</title>${esc(truncate(category.label, maxChars))}</text>`;
    });
    const zero = y(0);
    const tip = (serie, i, v) => `<title>${esc(`${model.categories[i].label}${serie.name ? ` · ${serie.name}` : ''}: ${format(v)}`)}</title>`;
    const barAttrs = (i, serie, index) => `class="backlogChartBar pivotChartBar" data-pivot-chart-cat="${i}" data-pivot-chart-series="${esc(serie.key)}" style="fill:${seriesColor(serie, index)}" tabindex="-1"`;
    if (type === 'line') {
      visible.forEach(({ serie, index }) => {
        const points = serie.values.map((v, i) => finite(v) ? `${(left + step * (i + 0.5)).toFixed(2)},${y(Number(v)).toFixed(2)}` : null).filter(Boolean).join(' ');
        if (points) out += `<polyline points="${points}" fill="none" style="stroke:${seriesColor(serie, index)}" stroke-width="2" vector-effect="non-scaling-stroke" stroke-linejoin="round" stroke-linecap="round"/>`;
        serie.values.forEach((v, i) => {
          if (!finite(v)) return;
          const x = left + step * (i + 0.5), py = y(Number(v));
          out += `<rect x="${(x - 3).toFixed(2)}" y="${(py - 3).toFixed(2)}" width="6" height="6" ${barAttrs(i, serie, index).replace('backlogChartBar pivotChartBar', 'backlogChartPoint pivotChartBar')}>${tip(serie, i, v)}</rect>`;
        });
      });
    } else if (type === 'grouped') {
      const group = step * 0.76, bw = Math.max(1, group / Math.max(1, visible.length));
      visible.forEach(({ serie, index }, si) => {
        serie.values.forEach((v, i) => {
          if (!finite(v) || Number(v) === 0) return;
          const x = left + step * (i + 0.5) - group / 2 + si * bw, vy = y(Number(v));
          out += `<rect x="${x.toFixed(2)}" y="${Math.min(vy, zero).toFixed(2)}" width="${Math.max(0.8, bw - 1).toFixed(2)}" height="${Math.abs(zero - vy).toFixed(2)}" ${barAttrs(i, serie, index)}>${tip(serie, i, v)}</rect>`;
        });
      });
    } else {
      const bw = Math.max(3, Math.min(64, step * 0.56));
      model.categories.forEach((_, i) => {
        let pos = 0, neg = 0;
        visible.forEach(({ serie, index }) => {
          const v = Number(serie.values[i]) || 0;
          if (!v) return;
          const from = v > 0 ? pos : neg, to = from + v;
          if (v > 0) pos = to; else neg = to;
          const y1 = y(from), y2 = y(to), x = left + step * (i + 0.5) - bw / 2;
          out += `<rect x="${x.toFixed(2)}" y="${Math.min(y1, y2).toFixed(2)}" width="${bw.toFixed(2)}" height="${Math.abs(y1 - y2).toFixed(2)}" ${barAttrs(i, serie, index)}>${tip(serie, i, v)}</rect>`;
        });
      });
    }
    if (type !== 'line' && n <= 40) {
      model.categories.forEach((_, i) => {
        const total = model.totals[i];
        if (!finite(total)) return;
        let peak;
        if (type === 'stacked') {
          let pos = 0, neg = 0;
          visible.forEach(({ serie }) => { const v = Number(serie.values[i]) || 0; if (v > 0) pos += v; else neg += v; });
          peak = total < 0 && pos === 0 ? neg : pos;
        } else {
          const values = visible.map(({ serie }) => Number(serie.values[i])).filter(Number.isFinite);
          peak = total < 0 ? Math.min(0, ...values) : Math.max(0, ...values);
        }
        const x = left + step * (i + 0.5), ty = total < 0 && peak <= 0 ? Math.min(top + ph - 4, y(peak) + 13) : Math.max(top + 10, y(peak) - 7);
        out += `<text x="${x.toFixed(2)}" y="${ty.toFixed(2)}" text-anchor="middle" class="backlogChartColumnTotal">${esc(format(total))}</text>`;
      });
    }
    out += '</svg>';
    return out;
  }

  function legendHtml(model, hidden, labels) {
    if (model.series.length < 2) return '';
    const off = hidden instanceof Set ? hidden : new Set();
    const hint = labels && labels.legendHint || '';
    return `<div class="backlogChartLegend pivotChartLegend">${model.series.map((serie, index) => `<button type="button" class="backlogChartLegendItem${off.has(serie.key) ? ' is-muted' : ''}" data-pivot-chart-legend="${esc(serie.key)}" style="--ui-series-color:${seriesColor(serie, index)}" title="${esc(hint)}"><span></span><b>${esc(serie.name)}</b></button>`).join('')}</div>`;
  }

  return { buildModel, scaleFor, svg, legendHtml, niceStep, SERIES_LIMIT, COLUMN_SERIES_LIMIT };
});
