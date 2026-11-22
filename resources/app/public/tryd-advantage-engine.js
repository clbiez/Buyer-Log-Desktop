(function (root, factory) {
  'use strict';
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.BLTrydAdvantageEngine = api;
})(typeof window !== 'undefined' ? window : globalThis, function (root) {
  'use strict';
  /* Hesaplanan değer doğrulaması ortak modüldedir (public/pivot-calculated-values.js).
     Tarayıcıda modül bu betikten önce yüklenir (app-main TR/YD zinciri). */
  const pivotCalculated = () => (typeof module === 'object' && module.exports && typeof require === 'function'
    ? require('./pivot-calculated-values.js')
    : (root && root.BLPivotCalculatedValues) || null);
  /* Vasıtaya göre standart (public/landed-vehicle-standards.js). Tarayıcıda bu
     betikten önce yüklenir; yüklenemezse bütün satırlar genel standarda düşer. */
  const vehicleStandards = () => (typeof module === 'object' && module.exports && typeof require === 'function'
    ? require('./landed-vehicle-standards.js')
    : (root && root.BLLandedVehicleStandards) || null);

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
   *  - Landed çarpanı yüksek: Landed/FOB, SATIRIN KENDİ standart yurtdışı landed
   *    çarpanının üstünde. Çarpan yükleme tipine göre değişir (gemi < gemi+uçak <
   *    uçak): siparişin IAS vasıtası için ortak ayarda (/api/landed-multipliers →
   *    byVehicle) standart varsa o, parsiyeller farklı vasıtayla gittiyse yükleme
   *    adediyle ağırlıklı ortalaması; vasıta bilinmiyor veya standardı boşsa genel
   *    overseas (varsayılan 1,11). Bu bir hata DEĞİLDİR, gerçek maliyettir:
   *    hesapta KALIR, yalnız uyarıdır.
   *  - Landed yok: landed boş veya 0; hesaptan çıkar.
   * Önceki istatistiksel çit (Q3 ± 3×IQR) uçak gibi gerçek maliyetleri hatalı
   * sayıp hesaptan attığı ve avantajı şişirdiği için kaldırıldı.
   */

  const DEFAULT_TARGET = 0.36;
  const DEFAULT_STANDARD_MULTIPLIER = 1.11;
  const MIN_LANDED_TO_FOB = 1;
  const LANDED_SOURCES = Object.freeze(['actual', 'forecast']);
  /* Görünüm v2 (kalemle pivot düzenleme):
     - Satır ekseni model düzeyinde anlamlı alanlardan seçilir; Model her zaman
       en alt kırılımdır. Kıyas birimi modeldir (TR FOB modelin TR satırlarından
       ağırlıklanır ve aynı modelin YD adediyle çarpılır); modelin altında oran
       üretilebilecek bir düzey yoktur ve model gizlenirse hedef altı satırın
       kaynağı görünmez.
     - Filtre: FOB Sonrası sorgusunun boyutları. Üretici ülke ve sipariş kodu
       YASAK: ikisi de kıyasın bir tarafını (TR veya YD) siler.
     - Değerler {key} referans dizisidir; ileride hesaplanan değer gibi yeni
       referans türleri aynı diziye eklenebilir. */
  /* vehicle: model düzeyi vasıta (YD adediyle ağırlıklı en sık vasıta; karışık
     siparişte en büyük paylı vasıta). Model tek gruba düştüğü için kıyas birimi
     bozulmaz. Sorgu filtresi DEĞİLDİR: FOB Sonrası küpünde vasıta yoktur. */
  const ROW_FIELDS = Object.freeze(['buyerGroup', 'classification', 'mag', 'season', 'productName', 'vehicle']);
  const DEFAULT_ROWS = Object.freeze(['buyerGroup', 'classification', 'mag']);
  const LEVELS = Object.freeze([...ROW_FIELDS, 'model']);
  const VALUE_KEYS = Object.freeze(['trFob', 'ydFob', 'ydLanded', 'advantage', 'target', 'gap', 'fobAdvantage', 'trQty', 'ydQty', 'coverage', 'status']);
  const DEFAULT_VALUES = VALUE_KEYS;
  const FILTER_KEYS = Object.freeze(['season', 'mag', 'buyerGroup', 'classification', 'productName', 'model', 'colour', 'salesCountry']);
  const DEFAULT_FILTERS = Object.freeze(['season', 'mag', 'buyerGroup', 'classification']);
  const BLOCKED_FILTER_KEYS = Object.freeze(['originCountry', 'order']);
  const REQUIRED_FILTER = 'season';
  const PREF_VERSION = 2;
  const PREF_KEYS = Object.freeze(['version', 'rows', 'values', 'filters', 'filterValues', 'target', 'landedSource', 'belowTargetOnly', 'collapsedGroups', 'sort', 'calculated']);
  /* ƒx hesaplanan değer alanları: her düzeyde (model, grup, genel toplam)
     TUTARLARDAN gelen sayısal değerler. Durum metindir, hesaba girmez.
     Yalnız "toplamlar üzerinden" mod vardır: kaynak satırlar sipariş × renk
     düzeyindedir ve kıyas birimi modeldir (TR FOB aynı modelin YD adediyle
     çarpılır); satır bazlı formül TR/YD ayrımını, Fas/Mısır dışlamasını ve
     hatalı/landed yok kuralını aşardı. */
  const CALC_FIELDS = Object.freeze(['trFob', 'ydFob', 'ydLanded', 'advantage', 'target', 'gap', 'fobAdvantage', 'trQty', 'ydQty', 'coverage', 'fobTrAmount', 'landedAmount', 'fobYdAmount', 'ydQtyAll']);
  const CALC_ITEM_FIELDS = Object.freeze(['id', 'label', 'labelTr', 'labelEn', 'formula', 'mode', 'format', 'decimals', 'refs', 'group']);
  const SORT_KEYS = Object.freeze(['label', 'trFob', 'ydFob', 'ydLanded', 'advantage', 'fobAdvantage', 'gap', 'trQty', 'ydQty', 'coverage']);
  const MODEL_ATTRS = Object.freeze(['buyerGroup', 'classification', 'mag', 'season', 'productName']);
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

  const isEnglishLabel = options => options && options.lang === 'en';
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
    if (standard && typeof standard === 'object') standard = standard.value;
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

  /* Satırın standardı: (row) => { value, source, known, label, labelEn, parts }.
     options.vehicles: /api/postfob/tryd/* yanıtındaki vehicles.byOrder
     ({ [ham sipariş kodu]: [[anahtar, etiket, adet], ...] }); options.byVehicle:
     ortak ayarın vasıta standartları. Sipariş başına bir kez hesaplanır. */
  const RESOLVER_CACHE = new WeakMap();
  function createStandardResolver(options = {}) {
    const overall = standardOf(options.standardMultiplier);
    const V = vehicleStandards();
    const table = V ? V.normalizeByVehicle(options.byVehicle) : {};
    const byOrder = options.vehicles && typeof options.vehicles === 'object' ? options.vehicles : null;
    const generic = { value: overall.value, source: 'unknown', known: false, label: '', labelEn: '', parts: [] };
    if (!V || !byOrder) return () => generic;
    /* Çözümleyici vasıta eki nesnesine bağlı önbellektedir: sıralama, arama ve hedef
       değişimi gibi yeniden çizimler aynı eki ve ayarı kullanır; siparişler yeniden
       çözülmez. Ek (yeni sorgu) veya ayar değişince yeniden kurulur. */
    const signature = `${overall.value}|${JSON.stringify(table)}`;
    const cached = RESOLVER_CACHE.get(byOrder);
    if (cached && cached.signature === signature) return cached.resolve;
    // Sipariş başına bir kez; tek vasıtalı siparişler (çoğunluk) vasıta başına tek sonucu paylaşır.
    const memo = new Map(), single = new Map();
    const resolve = row => {
      // Sunucu eki ham String(order) ile anahtarlıdır (server/lib/tryd-vehicle-index.js payloadFor).
      const order = row == null || row.order == null ? '' : (typeof row.order === 'string' ? row.order : String(row.order));
      let hit = memo.get(order);
      if (!hit) {
        const raw = Object.prototype.hasOwnProperty.call(byOrder, order) && Array.isArray(byOrder[order]) ? byOrder[order] : [];
        if (raw.length === 1 && Array.isArray(raw[0])) {
          const signature = `${raw[0][0]}\u0001${raw[0][1]}\u0001${typeof raw[0][2] === 'number' && raw[0][2] > 0 ? 1 : 0}`;
          hit = single.get(signature);
          if (!hit) { hit = V.orderStandard([{ key: raw[0][0], label: raw[0][1], qty: raw[0][2] }], table, overall.value); single.set(signature, hit); }
        } else {
          const parts = raw.map(item => Array.isArray(item) ? { key: item[0], label: item[1], qty: item[2] } : item);
          hit = parts.length ? V.orderStandard(parts, table, overall.value) : generic;
        }
        memo.set(order, hit);
      }
      return hit;
    };
    RESOLVER_CACHE.set(byOrder, { signature, resolve });
    return resolve;
  }

  function emptyAmounts() {
    return { fobTrAmount: 0, landedAmount: 0, fobYdAmount: 0, trQty: 0, ydQty: 0, ydQtyAll: 0, noLandedQty: 0, invalidQty: 0, highMultiplierQty: 0, vehicleKnownQty: 0, vehicleUnknownQty: 0 };
  }
  // Sıcak yol (grup başına model sayısı kadar): anahtar listesi bir kez kurulur.
  const AMOUNT_KEYS = Object.freeze(Object.keys(emptyAmounts()));
  function addAmounts(target, source) {
    for (let index = 0; index < AMOUNT_KEYS.length; index += 1) { const key = AMOUNT_KEYS[index]; target[key] += source[key] || 0; }
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

  const modeOf = slot => slot.map ? mode(slot.map) : slot.value;
  // [değer, ağırlık, …] dizisinde en ağır değer; eşitlikte Türkçe sıralamada önce gelen (mode ile aynı kural).
  function pairMode(pairs) {
    let best = '', weight = -1;
    for (let index = 0; index < pairs.length; index += 2) {
      const key = pairs[index], value = pairs[index + 1];
      if (value > weight || (value === weight && key.localeCompare(best, 'tr') < 0)) { best = key; weight = value; }
    }
    return best;
  }
  function mode(map) {
    let best = '', weight = -1;
    map.forEach((value, key) => { if (value > weight || (value === weight && key.localeCompare(best, 'tr') < 0)) { best = key; weight = value; } });
    return best;
  }

  /* Model düzeyi kıyas. Model kırılım alanları (buyer grup, klasman, MAG, sezon,
     ürün adı) model satırlarında adet ağırlıklı en sık değerden alınır (küpte
     modelin tek değeri olması beklenir; çelişki varsa kararlı seçim). */
  function compareModels(rows, options = {}) {
    const source = sourceOf(options);
    const target = num(options.target) == null ? DEFAULT_TARGET : num(options.target);
    const list = Array.isArray(rows) ? rows : [];
    const standard = standardOf(options.standardMultiplier);
    const standardFor = createStandardResolver(options);
    const vehicleActive = Boolean(options.vehicles && typeof options.vehicles === 'object' && vehicleStandards());
    const byModel = new Map();
    const counts = { rows: list.length, tr: 0, yd: 0, excluded: 0, unknown: 0, noModel: 0 };
    for (const row of list) {
      const origin = originClass(row);
      counts[origin] += 1;
      if (origin !== 'tr' && origin !== 'yd') continue;
      const model = clean(row && row.model);
      if (!model) { counts.noModel += 1; continue; }
      let entry = byModel.get(model);
      if (!entry) { entry = { model, tr: [], yd: [], attrs: MODEL_ATTRS.map(() => ({ value: '', weight: 0, map: null })) }; byModel.set(model, entry); }
      entry[origin].push(row);
      const weight = qtyOf(row) || 0.000001;
      // Sıcak yol: modelin alan değeri çoğunlukla tektir; Map yalnız ikinci farklı değerde açılır.
      for (let index = 0; index < MODEL_ATTRS.length; index += 1) {
        const value = clean(row[MODEL_ATTRS[index]]);
        if (!value) continue;
        const slot = entry.attrs[index];
        if (!slot.map && (slot.value === '' || slot.value === value)) { slot.value = value; slot.weight += weight; continue; }
        if (!slot.map) slot.map = new Map([[slot.value, slot.weight]]);
        slot.map.set(value, (slot.map.get(value) || 0) + weight);
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
      let maxRatio = null, maxRatioVehicle = '', maxRatioStandard = null;
      // Model vasıtası: [etiket, adet] çiftleri (vasıta sayısı küçüktür; Map açılmaz).
      const vehicleWeights = [];
      for (const row of ydActive) {
        const q = qtyOf(row);
        const rowStandard = standardFor(row);
        const status = rowStatus(row, rowStandard.value, source);
        statusCount[status] += 1;
        amounts.ydQtyAll += q;
        if (rowStandard.known) {
          amounts.vehicleKnownQty += q;
          const dominant = rowStandard.parts[0].label;
          let found = false;
          for (let index = 0; index < vehicleWeights.length; index += 2) if (vehicleWeights[index] === dominant) { vehicleWeights[index + 1] += q; found = true; break; }
          if (!found) vehicleWeights.push(dominant, q);
        } else amounts.vehicleUnknownQty += q;
        if (status === STATUS.noLanded) { amounts.noLandedQty += q; continue; }
        if (status === STATUS.invalid) { amounts.invalidQty += q; continue; }
        // Yüksek çarpan gerçek maliyettir: hesapta kalır, ayrıca sayılır.
        if (status === STATUS.high) amounts.highMultiplierQty += q;
        const ratio = row[landedKey(source)] / row.fob;
        if (maxRatio == null || ratio > maxRatio) { maxRatio = ratio; maxRatioVehicle = isEnglishLabel(options) ? rowStandard.labelEn : rowStandard.label; maxRatioStandard = rowStandard.value; }
        amounts.ydQty += q;
        amounts.landedAmount += q * row[landedKey(source)];
        amounts.fobYdAmount += q * row.fob;
        amounts.fobTrAmount += trFob * q;
      }
      const status = statusCount.invalidLanded ? STATUS.invalid : (statusCount.noLanded ? STATUS.noLanded : (statusCount.highMultiplier ? STATUS.high : STATUS.ok));
      models.push({
        model: entry.model,
        // entry.attrs MODEL_ATTRS sırasındadır.
        buyerGroup: modeOf(entry.attrs[0]), classification: modeOf(entry.attrs[1]), mag: modeOf(entry.attrs[2]), season: modeOf(entry.attrs[3]), productName: modeOf(entry.attrs[4]),
        vehicle: vehicleActive ? pairMode(vehicleWeights) : '',
        trFob, status, statusCount, maxRatio, maxRatioVehicle, maxRatioStandard, amounts, ...ratios(amounts, target),
        rows: [...entry.tr, ...entry.yd],
      });
    }
    return { models, standard, counts, skipped, target, landedSource: source, vehicleActive };
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
      const hay = fold([model.model, ...MODEL_ATTRS.map(key => model[key]), model.vehicle].join(' '));
      return tokens.every(part => hay.includes(part));
    });
    return { ...result, visible, total: summarize(visible, target), scopeTotal: summarize(result.models, target) };
  }

  function sortValue(node, key) {
    if (key === 'label') return node.label;
    if (key === 'trQty' || key === 'ydQty') return node.amounts[key];
    return node[key];
  }
  /* Bir düğümün (model, grup, genel toplam) hesaplanan değer alanları. Grupta
     TR FOB, YD adediyle ağırlıklıdır (FOB TR TUTAR / YD adet) — tablodaki
     sütunla aynı. */
  function calcFieldValues(node, target) {
    const amounts = (node && node.amounts) || {};
    const pick = value => (typeof value === 'number' && Number.isFinite(value) ? value : null);
    return {
      trFob: node && node.kind === 'model' ? pick(node.trFob) : (amounts.ydQty > 0 ? amounts.fobTrAmount / amounts.ydQty : null),
      ydFob: pick(node && node.ydFob), ydLanded: pick(node && node.ydLanded), advantage: pick(node && node.advantage),
      target: pick(num(target) == null ? DEFAULT_TARGET : num(target)), gap: pick(node && node.gap), fobAdvantage: pick(node && node.fobAdvantage),
      trQty: pick(amounts.trQty), ydQty: pick(amounts.ydQty), coverage: pick(node && node.coverage),
      fobTrAmount: pick(amounts.fobTrAmount), landedAmount: pick(amounts.landedAmount), fobYdAmount: pick(amounts.fobYdAmount), ydQtyAll: pick(amounts.ydQtyAll),
    };
  }
  function compare(a, b, sort, custom) {
    const key = sort && sort.key || 'label';
    const dir = Number(sort && sort.dir) === 1 ? 1 : -1;
    // Hesaplanan değer (calc:<id>) çağıranın değerlendiricisinden okunur.
    const calc = custom != null && key.startsWith('calc:');
    const left = calc ? custom(a, key) : sortValue(a, key), right = calc ? custom(b, key) : sortValue(b, key);
    if (key === 'label') return dir * String(left == null ? '' : left).localeCompare(String(right == null ? '' : right), 'tr', { numeric: true, sensitivity: 'base' });
    if (left == null && right == null) return String(a.label).localeCompare(String(b.label), 'tr', { numeric: true });
    if (left == null) return 1;
    if (right == null) return -1;
    return dir * (left - right);
  }

  /* Hiyerarşi: seçili satır alanları › Model (varsayılan Buyer grup › Ürün
     klasmanı › MAG › Model). Her grup düğümü kendi modellerinin tutar
     toplamından oran üretir; eksen sırası oranı değiştirmez. levels: [] düz
     model listesidir. */
  function buildTree(models, options = {}) {
    const target = num(options.target) == null ? DEFAULT_TARGET : num(options.target);
    const levels = Array.isArray(options.levels) ? [...new Set(options.levels.filter(key => ROW_FIELDS.includes(key)))] : DEFAULT_ROWS.slice();
    const sort = options.sort || { key: 'label', dir: 1 };
    const custom = typeof options.sortValue === 'function' ? options.sortValue : null;
    const walk = (list, depth, path) => {
      if (depth >= levels.length) {
        return list.map(model => ({ kind: 'model', level: depth, label: model.model, path: [...path, model.model], model, ...model, amounts: model.amounts }))
          .sort((a, b) => compare(a, b, sort, custom));
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
      }).sort((a, b) => compare(a, b, sort, custom));
    };
    return walk(Array.isArray(models) ? models : [], 0, []);
  }

  /* Kullanıcı tercihi (lcw.postfob.tryd.v1): sunucu ve istemci aynı normalize'ı
     kullanır. v1 kaydında eksen/değer/filtre listesi yoktur; varsayılanlar
     (eski sabit görünüm) atanır, diğer alanlar aynen taşınır. Bilinmeyen üst
     anahtar, alan ve referans düşer. */
  function refKey(item) { return typeof item === 'string' ? clean(item) : (item && typeof item === 'object' ? clean(item.key) : ''); }
  function refList(raw, allowed, fallback, max) {
    if (!Array.isArray(raw)) return fallback.map(key => ({ key }));
    const out = [], seen = new Set();
    for (const item of raw) {
      const key = refKey(item);
      if (!allowed.includes(key) || seen.has(key)) continue;
      seen.add(key); out.push({ key });
      if (out.length >= max) break;
    }
    return out;
  }
  function normalizePrefs(raw) {
    const source = raw && typeof raw === 'object' ? raw : {};
    const rows = refList(source.rows, ROW_FIELDS, DEFAULT_ROWS, ROW_FIELDS.length);
    let values = refList(source.values, VALUE_KEYS, DEFAULT_VALUES, VALUE_KEYS.length);
    if (!values.length) values = DEFAULT_VALUES.map(key => ({ key }));
    const filters = refList(source.filters, FILTER_KEYS, DEFAULT_FILTERS, FILTER_KEYS.length);
    // Sezon, Veri Yönetimi ufku yoksa sorgu için zorunludur; alan hiç kaldırılamaz.
    if (!filters.some(ref => ref.key === REQUIRED_FILTER)) filters.unshift({ key: REQUIRED_FILTER });
    const filterValues = {};
    const rawFilters = source.filterValues && typeof source.filterValues === 'object' ? source.filterValues : {};
    for (const { key } of filters) {
      const values = Array.isArray(rawFilters[key]) ? rawFilters[key] : [];
      const list = [...new Set(values.map(clean).filter(Boolean))].slice(0, 500);
      if (list.length) filterValues[key] = list;
    }
    const rawTarget = Number(source.target);
    const target = source.target !== null && source.target !== '' && Number.isFinite(rawTarget) ? Math.max(-1, Math.min(1, Math.round(rawTarget * 10000) / 10000)) : DEFAULT_TARGET;
    const sort = source.sort && typeof source.sort === 'object' ? source.sort : {};
    const calculated = normalizeCalculated(source.calculated);
    const calcKeys = new Set(calculated.map(item => `calc:${item.id}`));
    const sortKey = SORT_KEYS.includes(clean(sort.key)) || calcKeys.has(clean(sort.key)) ? clean(sort.key) : 'label';
    return {
      version: PREF_VERSION,
      rows, values, filters,
      filterValues,
      target,
      landedSource: LANDED_SOURCES.includes(source.landedSource) ? source.landedSource : 'actual',
      belowTargetOnly: source.belowTargetOnly === true,
      collapsedGroups: Array.isArray(source.collapsedGroups) ? [...new Set(source.collapsedGroups.map(clean).filter(Boolean))].slice(0, 2000) : [],
      sort: { key: sortKey, dir: Number(sort.dir) === -1 ? -1 : 1 },
      // Tanım yoksa alan yazılmaz: eski tercihin şekli aynen kalır.
      ...(calculated.length ? { calculated } : {}),
    };
  }
  function normalizeCalculated(raw) {
    if (!Array.isArray(raw) || !raw.length) return [];
    const PCV = pivotCalculated();
    // Ortak modül yüklenmemişse tanımlar silinmez (kayıtta veri kaybı olmasın).
    if (!PCV) return raw.filter(item => item && typeof item === 'object').slice(0, 20).map(item => JSON.parse(JSON.stringify(item)));
    return PCV.normalizeList(raw, { allowRow: false, aggregateKeys: CALC_FIELDS });
  }

  /* İstemciden gelen görünümün sıkı denetimi (PUT /tryd/view, POST /tryd/report).
     normalizePrefs eski/senkronlanmış kayıtları yumuşak biçimde taşır; buradaki
     denetim ise yeni yazımda bilinmeyen anahtarı, alanı ve yasak filtreyi açıkça
     reddeder. Boş dizi = sorun yok. */
  function validatePrefs(raw) {
    const problems = [];
    const add = (code, detail) => problems.push({ code, detail: String(detail) });
    if (raw == null) return problems;
    if (typeof raw !== 'object' || Array.isArray(raw)) { add('invalidShape', 'view'); return problems; }
    for (const key of Object.keys(raw)) if (!PREF_KEYS.includes(key)) add('unknownKey', key);
    const checkRefs = (name, allowed, code) => {
      if (raw[name] === undefined) return;
      if (!Array.isArray(raw[name])) { add('invalidShape', name); return; }
      for (const item of raw[name]) {
        if (item && typeof item === 'object' && Object.keys(item).some(field => field !== 'key')) { add('unknownRefField', `${name}:${refKey(item)}`); continue; }
        const key = refKey(item);
        if (name === 'filters' && BLOCKED_FILTER_KEYS.includes(key)) { add('blockedFilter', key); continue; }
        if (!allowed.includes(key)) add(code, `${name}:${key}`);
      }
    };
    checkRefs('rows', ROW_FIELDS, 'unknownRow');
    checkRefs('values', VALUE_KEYS, 'unknownValue');
    checkRefs('filters', FILTER_KEYS, 'unknownFilter');
    if (raw.calculated !== undefined) validateCalculated(raw.calculated, add);
    if (raw.filterValues !== undefined) {
      if (!raw.filterValues || typeof raw.filterValues !== 'object' || Array.isArray(raw.filterValues)) add('invalidShape', 'filterValues');
      else for (const key of Object.keys(raw.filterValues)) {
        if (BLOCKED_FILTER_KEYS.includes(key)) add('blockedFilter', key);
        else if (!FILTER_KEYS.includes(key)) add('unknownFilter', key);
      }
    }
    return problems;
  }

  /* Hesaplanan değerlerin sıkı denetimi: bilinmeyen alan, satır modu,
     tanınmayan başvuru ve ortak doğrulamadan geçmeyen tanım reddedilir. */
  function validateCalculated(list, add) {
    if (!Array.isArray(list)) { add('invalidShape', 'calculated'); return; }
    const PCV = pivotCalculated();
    if (PCV && list.length > PCV.LIMITS.max) { add('tooManyCalculated', list.length); return; }
    const calcKeys = new Set(list.map(item => `calc:${clean(item && item.id)}`));
    for (const item of list) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) { add('invalidShape', 'calculated'); continue; }
      const extra = Object.keys(item).filter(field => !CALC_ITEM_FIELDS.includes(field));
      if (extra.length) { add('unknownCalcField', `${clean(item.id)}:${extra.join(',')}`); continue; }
      if (item.mode !== undefined && item.mode !== 'aggregate') { add('calcRowMode', clean(item.id)); continue; }
      const refs = item.refs && typeof item.refs === 'object' && !Array.isArray(item.refs) ? Object.keys(item.refs) : [];
      const unknown = refs.filter(key => !CALC_FIELDS.includes(key) && !calcKeys.has(key));
      if (unknown.length) { add('unknownCalcRef', `${clean(item.id)}:${unknown.join(',')}`); continue; }
      if (PCV && PCV.normalizeList([item], { allowRow: false, aggregateKeys: CALC_FIELDS }).length !== 1) add('invalidCalculated', clean(item.id));
    }
  }

  return Object.freeze({
    DEFAULT_TARGET, DEFAULT_STANDARD_MULTIPLIER, MIN_LANDED_TO_FOB, LANDED_SOURCES, FILTER_KEYS, LEVELS, STATUS,
    ROW_FIELDS, DEFAULT_ROWS, VALUE_KEYS, DEFAULT_VALUES, DEFAULT_FILTERS, BLOCKED_FILTER_KEYS, REQUIRED_FILTER, PREF_VERSION, SORT_KEYS,
    originClass, rowRatio, standardOf, rowStatus, createStandardResolver, compareModels, summarize, analyze, buildTree, normalizePrefs, validatePrefs, isBelowTarget,
    CALC_FIELDS, calcFieldValues,
  });
});
