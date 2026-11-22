(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.BLTrydAdvantageEngine = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  /* TR/YD LANDED AVANTAJ — saf hesap katmanı (tarayıcı + Node testi).
   *
   * İş kuralı LCW "YD klasman LANDED AVANTAJ DURUMU" Excel pivotunun hesaplanan
   * alanlarından alınmıştır. Girdi satırları FOB Sonrası Maliyet sorgusunun
   * sipariş × renk satırlarıdır (server/lib/postfob-report.js).
   *
   *   TR  = üretici ülke Türkiye.
   *   YD  = diğer ülkeler; Fas ve Mısır HARİÇ ("FAS-MISIR-TURKIYE HARİÇ").
   *   Yalnız hem TR hem YD siparişi olan modeller (Modelkod) kıyaslanır.
   *
   *   TR FOB USD        = TR satırlarının adet ağırlıklı FOB'u
   *   FOB TR TUTAR      = TR FOB USD × YD adedi
   *   LANDED TUTAR      = Σ(YD adet × YD landed)
   *   FOB YD TUTAR      = Σ(YD adet × YD FOB)
   *   AVANTAJ           = 1 − LANDED TUTAR / FOB TR TUTAR
   *   FOB AVANTAJI      = 1 − FOB YD TUTAR / FOB TR TUTAR
   *   FARK              = AVANTAJ − HEDEF
   *
   * Excel'den bilinçli iki fark:
   *  1) Landed'i olmayan veya hatalı YD satırı kıyasa girmez (Excel'de boş landed
   *     0 sayılır ve avantajı şişirirdi). FOB TR TUTAR ve FOB YD TUTAR da AYNI
   *     kıyaslanan YD satırlarından hesaplanır; payda ile pay aynı adet tabanında
   *     kalır. Dışarıda kalan adet kapsam olarak ayrıca raporlanır.
   *  2) Grup toplamlarında oran, satır oranlarının ortalaması değil, tutarların
   *     toplamından yeniden hesaplanır (pivot hesaplanan alanıyla aynı).
   *
   * YD satırının durumu (ürün kararı, 2026-11-22):
   *  - Landed hatalı: landed < FOB. Fiziksel olarak mümkün değildir (landed =
   *    FOB + navlun + gümrük + ek maliyet); hesaptan çıkar.
   *  - Landed çarpanı yüksek: Landed/FOB, Buyer Log'un ortak standart yurtdışı
   *    landed çarpanının (/api/landed-multipliers → overseas, varsayılan 1,11)
   *    üstünde. Çarpan yükleme tipine göre değişir (gemi < gemi+uçak < uçak);
   *    bu bir hata DEĞİLDİR, gerçek maliyettir: hesapta KALIR, yalnız uyarıdır.
   *  - Landed yok: landed boş veya 0; hesaptan çıkar.
   * Önceki istatistiksel çit (Q3 ± 3×IQR) uçak gibi gerçek maliyetleri hatalı
   * sayıp hesaptan attığı ve avantajı şişirdiği için kaldırıldı.
   */

  const DEFAULT_TARGET = 0.36;
  const DEFAULT_STANDARD_MULTIPLIER = 1.11;
  const MIN_LANDED_TO_FOB = 1;
  const LANDED_SOURCES = Object.freeze(['actual', 'forecast']);
  const FILTER_KEYS = Object.freeze(['season', 'buyerGroup', 'classification', 'mag']);
  const LEVELS = Object.freeze(['buyerGroup', 'classification', 'mag', 'model']);
  const STATUS = Object.freeze({ ok: 'ok', high: 'highMultiplier', noLanded: 'noLanded', invalid: 'invalidLanded' });
  const TR_TOKENS = new Set(['TURKIYE', 'TURKEY', 'TR', 'TURKIYE CUMHURIYETI']);
  const EXCLUDED_TOKENS = new Set(['FAS', 'MOROCCO', 'MAROC', 'FAS MOROCCO', 'MISIR', 'EGYPT', 'EGIPT', 'MISIR EGYPT']);

  function clean(value) { return String(value == null ? '' : value).trim(); }
  function token(value) {
    return clean(value).replace(/[ıİ]/g, 'I').replace(/[şŞ]/g, 'S').replace(/[ğĞ]/g, 'G').replace(/[üÜ]/g, 'U').replace(/[öÖ]/g, 'O').replace(/[çÇ]/g, 'C')
      .toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
  }
  function num(value) { return typeof value === 'number' && Number.isFinite(value) ? value : null; }
  function qtyOf(row) { const q = num(row && row.qty); return q != null && q > 0 ? q : 0; }
  function landedKey(source) { return source === 'forecast' ? 'landedForecast' : 'landedActual'; }
  function sourceOf(options) { return options && options.landedSource === 'forecast' ? 'forecast' : 'actual'; }

  /* 'tr' | 'yd' | 'excluded' (Fas, Mısır) | 'unknown' (ülke boş) */
  function originClass(row) {
    const country = token(row && row.originCountry);
    if (!country) return 'unknown';
    if (TR_TOKENS.has(country)) return 'tr';
    if (EXCLUDED_TOKENS.has(country)) return 'excluded';
    return 'yd';
  }

  function rowRatio(row, source) {
    const landed = num(row && row[landedKey(source)]), fob = num(row && row.fob);
    return landed != null && landed > 0 && fob != null && fob > 0 && qtyOf(row) > 0 ? landed / fob : null;
  }

  /* Standart YD landed çarpanı: geçerli bir sayı verilmediyse varsayılan. */
  function standardOf(value) {
    const n = num(typeof value === 'string' ? Number(value) : value);
    return n != null && n > 0 && n <= 10 ? { value: n, fallback: false } : { value: DEFAULT_STANDARD_MULTIPLIER, fallback: true };
  }

  /* YD satırının durumu: 'ok' | 'highMultiplier' | 'noLanded' | 'invalidLanded'
     (adet/FOB yoksa null). standard: standart YD landed çarpanı (sayı). */
  function rowStatus(row, standard, source) {
    if (!qtyOf(row)) return null;
    const fob = num(row && row.fob);
    if (fob == null || fob <= 0) return null;
    const landed = num(row && row[landedKey(source)]);
    // Küpte gelmemiş landed boş veya 0 gelir: ikisi de "landed yok".
    if (landed == null || landed === 0) return STATUS.noLanded;
    if (landed < 0) return STATUS.invalid;
    const ratio = landed / fob;
    if (ratio < MIN_LANDED_TO_FOB) return STATUS.invalid;
    return ratio > standardOf(standard).value ? STATUS.high : STATUS.ok;
  }

  function emptyAmounts() {
    return { fobTrAmount: 0, landedAmount: 0, fobYdAmount: 0, trQty: 0, ydQty: 0, ydQtyAll: 0, noLandedQty: 0, invalidQty: 0, highMultiplierQty: 0 };
  }
  function addAmounts(target, source) {
    for (const key of Object.keys(emptyAmounts())) target[key] += source[key] || 0;
    return target;
  }
  /* Oranlar her düzeyde tutarlardan yeniden hesaplanır (ortalama alınmaz). */
  function ratios(amounts, target) {
    const den = amounts.fobTrAmount;
    const advantage = den > 0 ? 1 - amounts.landedAmount / den : null;
    const fobAdvantage = den > 0 ? 1 - amounts.fobYdAmount / den : null;
    const tgt = num(target);
    return {
      advantage, fobAdvantage,
      gap: advantage != null && tgt != null ? advantage - tgt : null,
      ydFob: amounts.ydQty > 0 ? amounts.fobYdAmount / amounts.ydQty : null,
      ydLanded: amounts.ydQty > 0 ? amounts.landedAmount / amounts.ydQty : null,
      coverage: amounts.ydQtyAll > 0 ? amounts.ydQty / amounts.ydQtyAll : null,
    };
  }

  function mode(map) {
    let best = '', weight = -1;
    map.forEach((value, key) => { if (value > weight || (value === weight && key.localeCompare(best, 'tr') < 0)) { best = key; weight = value; } });
    return best;
  }

  /* Model düzeyi kıyas. Model kırılım alanları (buyer grup, klasman, MAG) model
     satırlarında adet ağırlıklı en sık değerden alınır (küpte modelin tek
     değeri olması beklenir; çelişki varsa kararlı seçim). */
  function compareModels(rows, options = {}) {
    const source = sourceOf(options);
    const target = num(options.target) == null ? DEFAULT_TARGET : num(options.target);
    const list = Array.isArray(rows) ? rows : [];
    const standard = standardOf(options.standardMultiplier);
    const byModel = new Map();
    const counts = { rows: list.length, tr: 0, yd: 0, excluded: 0, unknown: 0, noModel: 0 };
    for (const row of list) {
      const origin = originClass(row);
      counts[origin] += 1;
      if (origin !== 'tr' && origin !== 'yd') continue;
      const model = clean(row && row.model);
      if (!model) { counts.noModel += 1; continue; }
      if (!byModel.has(model)) byModel.set(model, { model, tr: [], yd: [], attrs: { buyerGroup: new Map(), classification: new Map(), mag: new Map() } });
      const entry = byModel.get(model);
      entry[origin].push(row);
      const weight = qtyOf(row) || 0.000001;
      for (const key of ['buyerGroup', 'classification', 'mag']) {
        const value = clean(row && row[key]);
        if (value) entry.attrs[key].set(value, (entry.attrs[key].get(value) || 0) + weight);
      }
    }
    const models = [];
    const skipped = { trOnly: 0, ydOnly: 0, trNoFob: 0 };
    for (const entry of byModel.values()) {
      let trQty = 0, trFobSum = 0;
      for (const row of entry.tr) {
        const q = qtyOf(row), fob = num(row.fob);
        if (q && fob != null && fob > 0) { trQty += q; trFobSum += q * fob; }
      }
      const ydActive = entry.yd.filter(row => qtyOf(row) && num(row.fob) != null && row.fob > 0);
      if (!entry.tr.length) { skipped.ydOnly += 1; continue; }
      if (!ydActive.length) { skipped.trOnly += 1; continue; }
      if (!trQty) { skipped.trNoFob += 1; continue; }
      const trFob = trFobSum / trQty;
      const amounts = emptyAmounts();
      amounts.trQty = trQty;
      const statusCount = { ok: 0, highMultiplier: 0, noLanded: 0, invalidLanded: 0 };
      let maxRatio = null;
      for (const row of ydActive) {
        const q = qtyOf(row);
        const status = rowStatus(row, standard.value, source);
        statusCount[status] += 1;
        amounts.ydQtyAll += q;
        if (status === STATUS.noLanded) { amounts.noLandedQty += q; continue; }
        if (status === STATUS.invalid) { amounts.invalidQty += q; continue; }
        // Yüksek çarpan gerçek maliyettir: hesapta kalır, ayrıca sayılır.
        if (status === STATUS.high) amounts.highMultiplierQty += q;
        const ratio = row[landedKey(source)] / row.fob;
        if (maxRatio == null || ratio > maxRatio) maxRatio = ratio;
        amounts.ydQty += q;
        amounts.landedAmount += q * row[landedKey(source)];
        amounts.fobYdAmount += q * row.fob;
        amounts.fobTrAmount += trFob * q;
      }
      const status = statusCount.invalidLanded ? STATUS.invalid : (statusCount.noLanded ? STATUS.noLanded : (statusCount.highMultiplier ? STATUS.high : STATUS.ok));
      models.push({
        model: entry.model,
        buyerGroup: mode(entry.attrs.buyerGroup), classification: mode(entry.attrs.classification), mag: mode(entry.attrs.mag),
        trFob, status, statusCount, maxRatio, amounts, ...ratios(amounts, target),
        rows: [...entry.tr, ...entry.yd],
      });
    }
    return { models, standard, counts, skipped, target, landedSource: source };
  }

  function summarize(models, target) {
    const amounts = emptyAmounts();
    let below = 0, invalid = 0, noLanded = 0, high = 0, compared = 0;
    for (const model of models) {
      addAmounts(amounts, model.amounts);
      if (model.amounts.ydQty > 0) compared += 1;
      if (model.advantage != null && model.advantage < target) below += 1;
      if (model.status === STATUS.invalid) invalid += 1;
      else if (model.status === STATUS.noLanded) noLanded += 1;
      else if (model.status === STATUS.high) high += 1;
    }
    return { amounts, ...ratios(amounts, target), models: models.length, compared, below, invalid, noLanded, high };
  }

  const isBelowTarget = (model, target) => model.advantage != null && model.advantage < target;

  function fold(value) { return String(value == null ? '' : value).toLocaleLowerCase('tr-TR').replace(/ı/g, 'i'); }

  /* Görünür modeller: filtre (yalnız hedef altı, arama) model düzeyinde uygulanır;
     grup toplamları her zaman görünür modellerin tutarlarından hesaplanır. */
  function analyze(rows, options = {}) {
    const result = compareModels(rows, options);
    const target = result.target;
    const tokens = fold(options.search).split(/\s+/).filter(Boolean);
    let visible = result.models;
    if (options.belowTargetOnly) visible = visible.filter(model => isBelowTarget(model, target));
    if (tokens.length) visible = visible.filter(model => {
      const hay = fold([model.model, model.buyerGroup, model.classification, model.mag].join(' '));
      return tokens.every(part => hay.includes(part));
    });
    return { ...result, visible, total: summarize(visible, target), scopeTotal: summarize(result.models, target) };
  }

  function sortValue(node, key) {
    if (key === 'label') return node.label;
    if (key === 'trQty' || key === 'ydQty') return node.amounts[key];
    return node[key];
  }
  function compare(a, b, sort) {
    const key = sort && sort.key || 'label';
    const dir = Number(sort && sort.dir) === 1 ? 1 : -1;
    const left = sortValue(a, key), right = sortValue(b, key);
    if (key === 'label') return dir * String(left == null ? '' : left).localeCompare(String(right == null ? '' : right), 'tr', { numeric: true, sensitivity: 'base' });
    if (left == null && right == null) return String(a.label).localeCompare(String(b.label), 'tr', { numeric: true });
    if (left == null) return 1;
    if (right == null) return -1;
    return dir * (left - right);
  }

  /* Hiyerarşi: Buyer grup › Ürün klasmanı › MAG › Model. Her grup düğümü kendi
     modellerinin tutar toplamından oran üretir. */
  function buildTree(models, options = {}) {
    const target = num(options.target) == null ? DEFAULT_TARGET : num(options.target);
    const levels = Array.isArray(options.levels) && options.levels.length ? options.levels.filter(key => LEVELS.includes(key) && key !== 'model') : LEVELS.slice(0, 3);
    const sort = options.sort || { key: 'label', dir: 1 };
    const walk = (list, depth, path) => {
      if (depth >= levels.length) {
        return list.map(model => ({ kind: 'model', level: depth, label: model.model, path: [...path, model.model], model, ...model, amounts: model.amounts }))
          .sort((a, b) => compare(a, b, sort));
      }
      const key = levels[depth];
      const groups = new Map();
      for (const model of list) {
        const value = clean(model[key]);
        if (!groups.has(value)) groups.set(value, []);
        groups.get(value).push(model);
      }
      return [...groups.entries()].map(([value, members]) => {
        const nextPath = [...path, value];
        const summary = summarize(members, target);
        return { kind: 'group', level: depth, field: key, label: value, path: nextPath, pathKey: JSON.stringify(nextPath), ...summary, children: walk(members, depth + 1, nextPath), modelsList: members };
      }).sort((a, b) => compare(a, b, sort));
    };
    return walk(Array.isArray(models) ? models : [], 0, []);
  }

  /* Kullanıcı tercihi (lcw.postfob.tryd.v1): sunucu ve istemci aynı normalize'ı kullanır. */
  function normalizePrefs(raw) {
    const source = raw && typeof raw === 'object' ? raw : {};
    const filterValues = {};
    const rawFilters = source.filterValues && typeof source.filterValues === 'object' ? source.filterValues : {};
    for (const key of FILTER_KEYS) {
      const values = Array.isArray(rawFilters[key]) ? rawFilters[key] : [];
      const list = [...new Set(values.map(clean).filter(Boolean))].slice(0, 500);
      if (list.length) filterValues[key] = list;
    }
    const rawTarget = Number(source.target);
    const target = source.target !== null && source.target !== '' && Number.isFinite(rawTarget) ? Math.max(-1, Math.min(1, Math.round(rawTarget * 10000) / 10000)) : DEFAULT_TARGET;
    const sort = source.sort && typeof source.sort === 'object' ? source.sort : {};
    const sortKeys = ['label', 'trFob', 'ydFob', 'ydLanded', 'advantage', 'fobAdvantage', 'gap', 'trQty', 'ydQty', 'coverage'];
    return {
      version: 1,
      filterValues,
      target,
      landedSource: LANDED_SOURCES.includes(source.landedSource) ? source.landedSource : 'actual',
      belowTargetOnly: source.belowTargetOnly === true,
      collapsedGroups: Array.isArray(source.collapsedGroups) ? [...new Set(source.collapsedGroups.map(clean).filter(Boolean))].slice(0, 2000) : [],
      sort: { key: sortKeys.includes(clean(sort.key)) ? clean(sort.key) : 'label', dir: Number(sort.dir) === -1 ? -1 : 1 },
    };
  }

  return Object.freeze({
    DEFAULT_TARGET, DEFAULT_STANDARD_MULTIPLIER, MIN_LANDED_TO_FOB, LANDED_SOURCES, FILTER_KEYS, LEVELS, STATUS,
    originClass, rowRatio, standardOf, rowStatus, compareModels, summarize, analyze, buildTree, normalizePrefs, isBelowTarget,
  });
});
