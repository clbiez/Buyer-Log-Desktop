/* ===================================================================
   OVERVIEW > OAB (Order-Assortment-Budget) — İSTEMCİ MODÜLÜ

   Katmanlar (kullanıcı talimatındaki isimlerle):
     OABLocalFilterEngine — PASS'e yeni istek atmadan, çekilmiş dataset
       üzerinde çalışan filtreler (Klasman Grup, Line, Fit, ... ).
     OABPivotEngine        — Rows/Columns/Values/aggregate ile dinamik pivot.
     OAB UI                — filtre zinciri, pivot/raw tablo ve ayarlar.
       API servisleriyle (fetch çağrıları) BURADA karışmaz; state
       ve render burada, sunucu iletişimi oabApi.* fonksiyonlarında.

   Veri doğruluğu (kullanıcı talimatı): Renk Kodu, Özel Kod gibi kod alanları
   KESİNLİKLE sayıya çevrilmez ("3E8" gibi değerler bilimsel gösterime
   kaymasın diye). Sayısal alanlar KPI/pivot hesaplamasında normalize edilir
   ama response'taki orijinal değer HİÇ değiştirilmez; normalize edilmiş
   değer ayrı bir shadow alanında (satırın kendisinde değil, hesaplama
   sırasında türetilen bir değişkende) tutulur.
   =================================================================== */
(function (global) {
  'use strict';

  const parseTableSearchTerms=global.BLTableSearch.parseTerms;
  const tableSearchMatches=global.BLTableSearch.matches;

  /* ------------------------------------------------------------ 1) VERİ DOĞRULUĞU */

  // "3E8", "Q6K" gibi kod alanları asla numeric sayılmamalı. Bir alanın
  // "kod alanı" olup olmadığını İSİMDEN anlarız (Kod/Code/Ref içeren adlar);
  // bunun dışındaki alanlar için değer GERÇEKTEN sayısal görünüyorsa (yalnız
  // rakam, virgül/nokta, boşluk, eksi işareti) sayı sayılır.
  function isLikelyCodeField(fieldName) {
    return /kod|code|\bref\b/i.test(String(fieldName || ''));
  }
  // Locale kaynaklı ondalık biçimlerini (1.234,56 / 1,234.56 / 1234,56) ve
  // "null"/"undefined"/boş string'i güvenli biçimde sayıya çevirir. Ayrıştırma
  // başarısız olursa (kod alanı, serbest metin, vb.) null döner — 0 UYDURULMAZ.
  function toSafeNumber(value) {
    if (value == null) return null;
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    let text = String(value).trim();
    if (!text || /^(null|undefined|nan|-)$/i.test(text)) return null;
    const hasComma = text.includes(','), hasDot = text.includes('.');
    if (hasComma && hasDot) {
      // Hangisi ondalık ayıracı: SONUNCU görülen ayıraç ondalıktır.
      text = text.lastIndexOf(',') > text.lastIndexOf('.')
        ? text.replace(/\./g, '').replace(',', '.')
        : text.replace(/,/g, '');
    } else if (hasComma && !hasDot) {
      // Tek virgül + iki basamak sonrası -> ondalık; aksi halde binlik ayıracı.
      text = /,\d{1,2}$/.test(text) ? text.replace(',', '.') : text.replace(/,/g, '');
    } else if (hasDot && !hasComma && /^-?\d{1,3}(?:\.\d{3})+$/.test(text)) {
      // OAB adet alanlarında Türkçe gösterimden gelebilen "2.908" biçimi
      // binlik ayırıcıdır. Mevcut tek sayı normalize hattında 2908'e çevrilir;
      // ikinci/paralel bir parser oluşturulmaz.
      text = text.replace(/\./g, '');
    }
    const num = Number(text);
    return Number.isFinite(num) ? num : null;
  }
  // Bir satırdaki bir alanın "hesaplamaya uygun sayısal değeri". Kod alanları
  // için HER ZAMAN null döner (kesinlikle sayıya çevrilmez).
  function fieldNumericValue(row, fieldName) {
    if (isLikelyCodeField(fieldName)) return null;
    return toSafeNumber(row ? row[fieldName] : null);
  }
  // response satırlarındaki alan adlarını (81 civarı) BİRLEŞİK KÜME olarak
  // üretir; hard-code alan listesi YOKTUR. Sıra: ilk satırda görülme sırası,
  // sonra diğer satırlarda görülen ek alanlar eklenir.
  function deriveFieldList(rows) {
    const seen = new Set(), ordered = [];
    (rows || []).forEach(row => {
      if (!row || typeof row !== 'object') return;
      Object.keys(row).forEach(key => { if (!seen.has(key)) { seen.add(key); ordered.push(key); } });
    });
    return ordered;
  }
  function availableLocalFilterFields(fields) {
    return [...new Set((Array.isArray(fields) ? fields : [])
      .map(field => String(field == null ? '' : field))
      .filter(Boolean))];
  }
  // Bir alanın SAYISAL sayılıp sayılmayacağını, örnek satırlara bakarak
  // otomatik belirler (pivot Values seçici için "hangi alanlar SUM/AVG
  // alabilir" listesini üretmede kullanılır). Kod alanları HER ZAMAN hariç.
  function isNumericField(rows, fieldName) {
    if (isLikelyCodeField(fieldName)) return false;
    const sample = (rows || []).slice(0, 200);
    let seen = 0, numeric = 0;
    for (const row of sample) {
      const raw = row ? row[fieldName] : undefined;
      if (raw == null || raw === '') continue;
      seen++;
      if (toSafeNumber(raw) != null) numeric++;
    }
    return seen > 0 && numeric / seen >= 0.8;
  }


  /* -------------------------------------------------- BUYER KARAR METRİKLERİ */

  // PASS response'u ham olarak korunur; Buyer Log'a özel karar metrikleri yeni
  // bir satır nesnesinde türetilir. Böylece cache/ham veri ile raporlama katmanı
  // birbirine karışmaz ve kaynak alanlar hiçbir zaman overwrite edilmez.
  // Kullanıcı kararı: kaynak OAB başlıkları dışında yalnız aşağıdaki dört
  // Buyer Log alanı tutulur. Eski yüzde/risk/kalan vb. türetilmiş başlıklar
  // artık veri modeline veya Pivot field listesine eklenmez.
  const OAB_FORMULA_PERCENT_FIELDS = new Set([]);
  const DEFAULT_OAB_PIVOT_VALUES = Object.freeze([
    'Plan Başlangıç Ayı',
    'Klasman Tanımı',
    'Toplam WSSI Sipariş Miktarı',
    'Toplam Onaylı Sipariş Miktarı',
    'Toplam Onaylanmış - Sipariş Geçilmemiş Adet',
  ]);
  const OAB_AUTO_COLLAPSE_ZERO_FIELD = 'Toplam Onaylanmış - Sipariş Geçilmemiş Adet';
  function defaultOabPivotValueDefs() {
    return DEFAULT_OAB_PIVOT_VALUES.map(field => ({
      field,
      agg: (field === 'Plan Başlangıç Ayı' || field === 'Klasman Tanımı') ? 'FIRST' : 'SUM',
    }));
  }

  const OAB_DERIVED_FIELDS = Object.freeze([
    'Toplam WSSI Sipariş Miktarı',
    'Toplam Onaylı Sipariş Miktarı',
    'Toplam Onaylanmış - Sipariş Geçilmemiş Adet',
    'Toplam Klasman Analize Konu Olan Toplam Adet',
  ]);

  // Önceki sürümlerde Buyer Log tarafından eklenen fakat artık OAB'da
  // görünmemesi gereken başlıklar. Bu liste yalnız eski kayıtlı pivot
  // düzenlerini temizlemek için tutulur; veri satırlarına eklenmez.
  const OAB_REMOVED_DERIVED_FIELDS = Object.freeze([
    'Sipariş Geçiş %', 'Kalan Sipariş Adet', 'Kalan Sipariş %', 'Fazla Sipariş Adet',
    'Plan Sapma %', 'Onaylı Sipariş %', 'Onay Bekleyen Adet', 'Sipariş Pipeline',
    'Depo Giriş %', 'Uygun Giriş %', 'Dönem Kalan Sipariş', 'Dönem Gerçekleşme %',
    "WSSI'ye Göre Kalan", 'WSSI Sipariş Geçilmemiş Adet', 'WSSI Sipariş Geçiş %',
    'WSSI Kalan Sipariş Adet', 'WSSI Kalan Sipariş %', 'WSSI Fazla Sipariş Adet',
    'WSSI Sipariş Sapma %', 'Plan–WSSI Sapma %', "Retail'e Kalan Gün",
    'Sipariş Geçilmemiş Adet', 'Sipariş Durumu', 'Sipariş Risk Durumu',
  ]);
  const OAB_REMOVED_DERIVED_FIELD_SET = new Set(OAB_REMOVED_DERIVED_FIELDS);

  function safeSubtract(a, b) {
    return a == null || b == null ? null : a - b;
  }
  function safeAdd(a, b) {
    if (a == null && b == null) return null;
    return (a || 0) + (b || 0);
  }
  function safePct(numerator, denominator) {
    return numerator == null || denominator == null || denominator === 0 ? null : (numerator / denominator) * 100;
  }
  function oabParseDate(value) {
    if (value == null || value === '') return null;
    if (value instanceof Date && !Number.isNaN(value.getTime())) return new Date(value.getFullYear(), value.getMonth(), value.getDate());
    if (typeof value === 'number' && Number.isFinite(value)) {
      // Excel seri tarihi ihtimalini de destekle; PASS çoğunlukla ISO döndürür.
      if (value > 20000 && value < 80000) {
        const d = new Date(Date.UTC(1899, 11, 30) + value * 86400000);
        return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
      }
    }
    const text = String(value).trim();
    let m = text.match(/^(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{4})$/);
    if (m) {
      const d = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
      return Number.isNaN(d.getTime()) ? null : d;
    }
    m = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (m) {
      const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
      return Number.isNaN(d.getTime()) ? null : d;
    }
    const parsed = new Date(text);
    return Number.isNaN(parsed.getTime()) ? null : new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate());
  }
  function oabDaysBetweenCalendar(from, to) {
    if (!from || !to) return null;
    const a = Date.UTC(from.getFullYear(), from.getMonth(), from.getDate());
    const b = Date.UTC(to.getFullYear(), to.getMonth(), to.getDate());
    return Math.round((b - a) / 86400000);
  }
  function deriveBuyerMetrics(row, todayValue) {
    void todayValue;
    const source = row && typeof row === 'object' ? row : {};
    const approved = fieldNumericValue(source, 'Onaylı Sipariş Miktarı');
    const wssi = fieldNumericValue(source, 'WSSI Sipariş Miktarı');

    // Excel OAB Pivot mantığıyla birebir dört izinli alan SATIR BAZINDA üretilir.
    // Null/undefined/boş adetler bu dört alan için 0 kabul edilir.
    const toplamWssi = wssi == null ? 0 : wssi;
    const toplamOnayli = approved == null ? 0 : approved;
    const toplamOnaylanmisGecilmemis = toplamWssi === 0 ? toplamOnayli : 0;
    const toplamKlasmanAnaliz = toplamWssi + toplamOnaylanmisGecilmemis;

    return {
      ...source,
      'Toplam WSSI Sipariş Miktarı': toplamWssi,
      'Toplam Onaylı Sipariş Miktarı': toplamOnayli,
      'Toplam Onaylanmış - Sipariş Geçilmemiş Adet': toplamOnaylanmisGecilmemis,
      'Toplam Klasman Analize Konu Olan Toplam Adet': toplamKlasmanAnaliz,
    };
  }
  function withDerivedBuyerMetrics(rows, todayValue) {
    return (Array.isArray(rows) ? rows : []).map(row => deriveBuyerMetrics(row, todayValue));
  }
  function sumNumericField(rows, fieldName) {
    let sum = 0, seen = false;
    (rows || []).forEach(row => {
      const value = fieldNumericValue(row, fieldName);
      if (value == null) return;
      seen = true; sum += value;
    });
    return seen ? sum : null;
  }
  function derivedFormulaValue(rows, fieldName) {
    void rows; void fieldName;
    return null;
  }
  function isFormulaMetric(fieldName) { return OAB_FORMULA_PERCENT_FIELDS.has(String(fieldName || '')); }

  /* ------------------------------------------------------- 2) LOCAL FILTER ENGINE */

  // filters: { [fieldName]: Set<string> } — boş/eksik Set o alan için filtre
  // yok demektir. Karşılaştırma metin bazlıdır (kod alanları dahil TÜM
  // alanlar için güvenli); sayısal alanlar da metne çevrilip karşılaştırılır.
  function OABLocalFilterEngine(rows) {
    this.rows = Array.isArray(rows) ? rows : [];
  }
  OABLocalFilterEngine.prototype.distinctValues = function (fieldName) {
    const values = new Set();
    this.rows.forEach(row => { const v = row ? row[fieldName] : undefined; if (v != null && v !== '') values.add(String(v)); });
    return [...values].sort((a, b) => a.localeCompare(b, 'tr'));
  };
  OABLocalFilterEngine.prototype.apply = function (filters) {
    const active = Object.entries(filters || {}).filter(([, set]) => set && set.size);
    if (!active.length) return this.rows.slice();
    return this.rows.filter(row => active.every(([field, set]) => set.has(String(row ? row[field] : ''))));
  };

  // OAB yerel filtre çubuğundaki görünür alanları deterministik biçimde yönetir.
  // Kullanıcının sırası korunur; aynı alan ikinci kez eklenmez ve yalnız mevcut
  // raporda bulunan alanlar kabul edilir.
  function updateLocalFilterFields(current, action, field, available) {
    const allowed = new Set((Array.isArray(available) ? available : []).map(String));
    const next = [...new Set((Array.isArray(current) ? current : []).map(String))]
      .filter(item => allowed.has(item));
    const value = String(field || '');
    if (action === 'add' && value && allowed.has(value) && !next.includes(value)) next.push(value);
    if (action === 'remove') return next.filter(item => item !== value);
    return next;
  }

  /* ------------------------------------------------------------ 3) PIVOT ENGINE */

  const AGGREGATES = {
    SUM: values => values.reduce((sum, v) => sum + v, 0),
    AVG: values => values.length ? values.reduce((sum, v) => sum + v, 0) / values.length : 0,
    COUNT: (values, rawCount) => rawCount,
    MIN: values => values.length ? Math.min(...values) : null,
    MAX: values => values.length ? Math.max(...values) : null,
    FIRST: values => values.length ? values[0] : null,
    // CALC, oran/yüzde gibi türetilmiş metriklerde grubun TOPLAM baz
    // alanlarından yeniden hesaplanır; basit satır yüzdeleri toplanmaz.
    CALC: values => values.length ? values[0] : null,
  };
  // config: { rows:[field,...], columns:[field,...], values:[{field,agg}], calculatedFields:[{key,label,fn}] }
  // fn(sumsByKey) -> number; hesaplanmış alanlar toplam SATIRLARDAN DEĞİL,
  // aynı grubun ZATEN toplanmış Values sonuçlarından türetilir (v6'daki
  // "Landed hücresi hesaplanan sayıyı taşır" dersiyle tutarlı: türetilmiş
  // değer, ham veriden değil, zaten doğrulanmış ara sonuçtan hesaplanır).
  function OABPivotEngine(rows) {
    this.rows = Array.isArray(rows) ? rows : [];
  }
  OABPivotEngine.prototype.compute = function (config) {
    const rowFields = (config && config.rows) || [];
    const colFields = (config && config.columns) || [];
    const valueDefs = (config && config.values) || [];
    const calcFields = (config && config.calculatedFields) || [];
    const groupKeyOf = (row, fields) => fields.map(field => String(row ? row[field] ?? '' : '')).join('␟');
    const groups = new Map(); // groupKey(rows+cols) -> { rowKey, colKey, rowsRaw:[] }
    this.rows.forEach(row => {
      const rowKey = groupKeyOf(row, rowFields), colKey = groupKeyOf(row, colFields);
      const key = rowKey + '␞' + colKey;
      if (!groups.has(key)) groups.set(key, { rowKey, colKey, rows: [] });
      groups.get(key).rows.push(row);
    });
    const cells = [];
    for (const group of groups.values()) {
      const results = {};
      valueDefs.forEach(def => {
        const requestedAgg = def.agg || (isFormulaMetric(def.field) ? 'CALC' : 'SUM');
        let result;
        if (requestedAgg === 'CALC' && isFormulaMetric(def.field)) {
          result = derivedFormulaValue(group.rows, def.field);
        } else if (requestedAgg === 'FIRST') {
          const rawValues = group.rows.map(row => row ? row[def.field] : null).filter(v => v != null && v !== '');
          result = AGGREGATES.FIRST(rawValues, group.rows.length);
        } else {
          const numeric = group.rows.map(row => fieldNumericValue(row, def.field)).filter(v => v != null);
          const agg = AGGREGATES[requestedAgg] || AGGREGATES.SUM;
          result = agg(numeric, group.rows.length);
        }
        results[`${def.field}::${requestedAgg}`] = result;
      });
      calcFields.forEach(calc => {
        try { results[calc.key] = calc.fn(results); } catch (_) { results[calc.key] = null; }
      });
      cells.push({ rowKey: group.rowKey, colKey: group.colKey, rowValues: rowFields.map((f, i) => group.rows[0][f]), colValues: colFields.map((f) => group.rows[0][f]), results, rowCount: group.rows.length, sourceRows: group.rows.slice() });
    }
    return { cells, rowFields, colFields, valueDefs, calcFields };
  };
  // Doğruluk kontrolü (kullanıcının test senaryosu 8): pivot toplamlarının
  // filtrelenmiş ham verinin toplamıyla birebir uyuşması. Bu yardımcı,
  // testlerin ve isteğe bağlı bir "Verify" düğmesinin kullanabileceği saf
  // bir kontrol fonksiyonudur.
  OABPivotEngine.verifyTotal = function (rows, field, agg) {
    const requestedAgg = agg || (isFormulaMetric(field) ? 'CALC' : 'SUM');
    if (requestedAgg === 'CALC' && isFormulaMetric(field)) return derivedFormulaValue(rows, field);
    if (requestedAgg === 'FIRST') {
      const rawValues = rows.map(row => row ? row[field] : null).filter(v => v != null && v !== '');
      return AGGREGATES.FIRST(rawValues, rows.length);
    }
    const numeric = rows.map(row => fieldNumericValue(row, field)).filter(v => v != null);
    return (AGGREGATES[requestedAgg] || AGGREGATES.SUM)(numeric, rows.length);
  };

  global.OABLocalFilterEngine = OABLocalFilterEngine;
  global.OABPivotEngine = OABPivotEngine;
  global.OABDataUtils = {
    isLikelyCodeField, toSafeNumber, fieldNumericValue, deriveFieldList, availableLocalFilterFields, isNumericField, AGGREGATES,
    OAB_DERIVED_FIELDS, OAB_REMOVED_DERIVED_FIELDS, DEFAULT_OAB_PIVOT_VALUES, isFormulaMetric, deriveBuyerMetrics, withDerivedBuyerMetrics, derivedFormulaValue, defaultCollapsedPivotGroupKeys, updateLocalFilterFields,
  };
  // Tarayıcıda window property'leri global identifier olarak da çözülür; test
  // harness'i ise ayrı bir window nesnesi verdiği için açık yerel referans tut.
  const OABDataUtils = global.OABDataUtils;

  /* ================================================================
     4) OAB API — sunucu iletişimi. UI kodundan kasıtlı olarak ayrı: bu
     bölüm hiçbir DOM işlemi yapmaz, yalnız fetch çağırıp JSON döndürür.
     ================================================================ */
  function oabIsAuthErrorCode(code) {
    return code === 'OAB_AUTH_REQUIRED' || code === 'OAB_AUTH_EXPIRED';
  }
  let oabDesktopAuthInFlight = null;
  async function oabEnsureAuthentication() {
    const bridge = global.buyerLogDesktop;
    if (!bridge || typeof bridge.ensureOabAuth !== 'function') {
      const err = new Error(oabT('OAB oturumu Buyer Log masaüstü uygulamasından açılmalıdır.', 'OAB sign-in must be opened from the Buyer Log desktop app.'));
      err.code = 'OAB_DESKTOP_AUTH_UNAVAILABLE';
      throw err;
    }
    if (!oabDesktopAuthInFlight) {
      const request = Promise.resolve(bridge.ensureOabAuth({ interactive:true }))
        .then(result => {
          if (result && result.ok && result.authenticated) return result;
          const err = new Error((result && result.error) || oabT('OAB kullanıcı girişi tamamlanmadı.', 'OAB sign-in was not completed.'));
          err.code = (result && result.code) || 'OAB_AUTH_REQUIRED';
          throw err;
        })
        .finally(() => {
          if (oabDesktopAuthInFlight === request) oabDesktopAuthInFlight = null;
        });
      oabDesktopAuthInFlight = request;
    }
    return oabDesktopAuthInFlight;
  }
  async function oabJson(url, options, allowAuthRetry = true) {
    const res = await fetch(url, options);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.error || res.statusText);
      err.code = data.code;
      err.details = data.details;
      if (allowAuthRetry && oabIsAuthErrorCode(err.code)) {
        await oabEnsureAuthentication();
        return oabJson(url, options, false);
      }
      throw err;
    }
    return data;
  }
  const OABApi = {
    authStatus: () => oabJson('/api/oab/auth/status'),
    seasons: () => oabJson('/api/oab/seasons'),
    mag: seasonRef => oabJson('/api/oab/mag', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ seasonRef }) }),
    buyerGroups: merchSubGroupRef => oabJson('/api/oab/buyer-groups', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ merchSubGroupRef }) }),
    report: (seasonRef, merchSubGroupRef, buyerGroupRef, forceRefresh) => oabJson('/api/oab/report', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ seasonRef, merchSubGroupRef, buyerGroupRef, forceRefresh: Boolean(forceRefresh) }) }),
    // v7.20 — çoklu seçim: plan (maliyet tahmini) ve arka plan toplu çekme.
    plan: selection => oabJson('/api/oab/plan', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(selection) }),
    batchStart: selection => oabJson('/api/oab/batch', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(selection) }),
    batchStatus: () => oabJson('/api/oab/batch-status'),
    batchCancel: () => oabJson('/api/oab/batch/cancel', { method: 'POST' }),
    state: () => oabJson('/api/oab/state'),
    getSettings: () => oabJson('/api/oab/settings'),
    saveSettings: settings => oabJson('/api/oab/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(settings) }),
  };
  global.OABApi = OABApi;

  /* ================================================================
     5) OAB UI — Overview > OAB. Yalnız bu bölüm DOM'a dokunur.
     ================================================================ */
  const S = {
    seasons: [], mag: [], buyerGroups: [],
    // v7.20 — üç filtre de ÇOKLU. Tek seçim, uzunluğu 1 olan bir dizidir;
    // ayrı bir "tek seçim modu" yoktur, dolayısıyla bakılacak ikinci bir kod
    // yolu da yoktur. Eski tekil alanlar geriye dönük uyum için türetilir.
    seasonRefs: [], magRefs: [], buyerGroupRefs: [], allBuyerGroups: false,
    plan: null, planToken: 0, batchJob: null, batchTimer: 0, batchFailures: [],
    rows: [], fields: [], fromCache: false, fromSnapshot: false, fetchedAt: '',
    view: 'pivot', // 'pivot' | 'raw'
    localFilters: {}, // {field: Set<string>}
    localFilterFields: null, // kullanıcı tarafından görünür tutulan yerel filtre alanları
    pivotConfig: null,
    settings: { ttlMinutes: 30 },
    metadataInfo: null,
    busy: false,
    pivotSort: { key: '', dir: 1 },
    pivotFilters: {},
    hiddenColumns: { raw: new Set(), pivot: new Set() },
    collapsedGroups: new Set(),
    autoCollapseZeroGroupsKey: '',
  };
  const oabFilterRowsCache=(global.BLAnalysisCache?.create||global.BLPerf?.createBoundedCache)?.(4)||new Map();
  const oabPivotViewCache=(global.BLAnalysisCache?.create||global.BLPerf?.createBoundedCache)?.(6)||new Map();
  const oabRowsIdentity=new WeakMap();
  let oabDataRevision=0;
  let oabRowsIdentityNext=0;
  function oabRowsKey(rows){
    if (!rows || typeof rows !== 'object') return String(rows || '');
    if (!oabRowsIdentity.has(rows)) oabRowsIdentity.set(rows,++oabRowsIdentityNext);
    return oabRowsIdentity.get(rows);
  }

  function oabLang() { return typeof appLang !== 'undefined' && appLang === 'en'; }
  function oabT(tr, en) { return oabLang() ? en : tr; }
  function oabEsc(value) { return String(value == null ? '' : value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  function oabOptionLabel(opt) { return String((opt && (opt.Name || opt.name)) || ''); }
  function oabOptionRef(opt) {
    if (!opt) return '';
    const key = Object.keys(opt).find(k => /ref$/i.test(k));
    return key ? opt[key] : '';
  }
  function oabEl(id) { return document.getElementById(id); }

  /* Her durum mesajı, ŞERİDİN TIKLANABİLİRLİĞİNİ SIFIRLAR.

     className tamamen yeniden yazıldığı için "isClickable" zaten silinirdi;
     eldeki hata listesi de birlikte temizlenmezse şerit tıklanabilir
     GÖRÜNMEZ ama tıklanınca artık geçerli olmayan bir kombinasyon listesini
     açardı. Görünen ile yapılan ayrışamaz. */
  function oabSetStatus(message, kind) {
    S.batchFailures = [];
    const el = oabEl('oabStatus');
    if (!el) return;
    el.classList.remove('isClickable');
    el.tabIndex = -1;
    el.setAttribute('role', 'status');
    if (!message) { el.hidden = true; el.textContent = ''; return; }
    el.hidden = false; el.textContent = message; el.className = `oabStatus${kind ? ' is' + kind : ''}`;
  }
  function oabBusyElapsedMs() {
    return S.busyStartedAt ? Math.max(0, Math.round(performance.now() - S.busyStartedAt)) : 0;
  }
  /* v7.33 — sayaç biçimi uygulamanın geri kalanıyla aynı: "30,5 sn".
     app-main.js yüklüyse onun biçimlendiricisi kullanılır; OAB'nin ayrı bir
     biçim üretmesi kullanıcıya iki farklı sayaç gibi görünürdü. */
  function oabBusyElapsedText() {
    const ms = oabBusyElapsedMs();
    if (typeof global.fmtDurationSn === 'function') return global.fmtDurationSn(ms);
    return `${(ms / 1000).toLocaleString(oabLang() ? 'en-GB' : 'tr-TR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} ${oabLang() ? 's' : 'sn'}`;
  }
  function oabSetBusyStatus(message, kind) {
    S.busyStatusMessage = String(message || '');
    S.busyStatusKind = kind || '';
    if (!S.busy) { oabSetStatus(message, kind); return; }
    oabSetStatus(`${S.busyStatusMessage} · ${oabBusyElapsedText()}`, S.busyStatusKind);
  }

  function oabToast(message) {
    if (typeof showToast === 'function') { showToast(message); return; }
    // Do not mirror arbitrary server/auth text into the renderer console.
    // eslint-disable-next-line no-console
    console.log('[OAB] notification');
  }

  function oabAuthErrorMessage(err) {
    const code = err && err.code;
    if (code === 'OAB_AUTH_REQUIRED') return oabT('OAB oturumu gerekli. Buyer Log giriş ekranını açacak.', 'OAB sign-in is required. Buyer Log will open the sign-in window.');
    if (code === 'OAB_AUTH_EXPIRED') return oabT('OAB oturumu sona erdi. Buyer Log tekrar giriş isteyecek.', 'OAB session expired. Buyer Log will ask you to sign in again.');
    if (code === 'OAB_AUTH_CANCELLED') return oabT('OAB kullanıcı girişi iptal edildi.', 'OAB sign-in was cancelled.');
    if (code === 'OAB_AUTH_TIMEOUT') return oabT('OAB oturum açma işlemi zamanında tamamlanmadı.', 'OAB sign-in did not complete in time.');
    if (code === 'OAB_AUTH_NAVIGATION_FAILED' || code === 'OAB_AUTH_RENDERER_FAILED') return oabT('OAB giriş ekranı açılamadı.', 'The OAB sign-in window could not be opened.');
    if (code === 'OAB_AUTH_CAPTURE_UNAVAILABLE') return oabT('OAB oturumu doğrulanamadı.', 'The OAB session could not be validated.');
    return String((err && err.message) || err || oabT('Bilinmeyen hata.', 'Unknown error.'));
  }
  function oabAuthProgressMessage(status) {
    const state = status && status.status || status || {};
    if (state.authenticated) return oabT('OAB oturumu hazır.', 'OAB session is ready.');
    if (state.loginRequired) {
      return oabT(
        'OAB oturumu gerekli. Buyer Log kendi giriş ekranını açacak ve giriş tamamlanınca otomatik devam edecek.',
        'OAB sign-in is required. Buyer Log will open its own sign-in window and continue automatically after sign-in.',
      );
    }
    return '';
  }

  /* ================================================================
     v7.20 — ÇOKLU SEÇİM BİLEŞENİ

     OAB sitesi Season/MAG/Buyer Group filtrelerini tek seçime kapatıyor.
     Buyer Log çoklu seçtirir, arka planda seçilen kombinasyonların tamamını
     çeker ve tek raporda birleştirir.

     Bileşen bilinçli olarak <select multiple> DEĞİL: MAG listesi 130'u,
     Buyer Group listesi 60'ı aşabiliyor. Ctrl+tık ile çoklu seçim bu
     boyutta kullanılabilir değil — arama kutusu, "Tümü/Hiçbiri" ve seçili
     sayacı olan bir açılır liste gerekiyor.
     ================================================================ */
  const OAB_MULTI = {
    season: { trigger: 'oabSeasonTrigger', label: 'oabSeasonLabel', title: () => oabT('Season', 'Season'), options: () => S.seasons, selected: () => S.seasonRefs, onChange: () => oabOnSeasonSelectionChange() },
    mag: { trigger: 'oabMagTrigger', label: 'oabMagLabel', title: () => oabT('MAG', 'MAG'), options: () => S.mag, selected: () => S.magRefs, onChange: () => oabOnMagSelectionChange() },
    buyerGroup: { trigger: 'oabBuyerGroupTrigger', label: 'oabBuyerGroupLabel', title: () => oabT('Buyer Group', 'Buyer Group'), options: () => S.buyerGroups, selected: () => S.buyerGroupRefs, onChange: () => oabOnBuyerGroupSelectionChange() },
  };
  function oabMultiSetSelected(kind, refs) {
    const list = [...new Set((refs || []).map(value => String(value)))];
    if (kind === 'season') S.seasonRefs = list;
    else if (kind === 'mag') S.magRefs = list;
    else S.buyerGroupRefs = list;
  }
  function oabMultiRenderLabel(kind) {
    const spec = OAB_MULTI[kind];
    const el = oabEl(spec.label);
    if (!el) return;
    const selected = spec.selected(), options = spec.options();
    if (!selected.length) { el.textContent = oabT('Seçin…', 'Select…'); el.classList.remove('hasValue'); return; }
    el.classList.add('hasValue');
    if (selected.length === 1) {
      const match = options.find(opt => String(oabOptionRef(opt)) === String(selected[0]));
      el.textContent = match ? oabOptionLabel(match) : String(selected[0]);
      return;
    }
    if (kind === 'buyerGroup' && S.allBuyerGroups) { el.textContent = oabT(`Tümü (${selected.length})`, `All (${selected.length})`); return; }
    el.textContent = oabT(`${selected.length} seçili`, `${selected.length} selected`);
  }
  /* Seçim yazma tek kapıdan geçer: hazır "kind" varsa üst filtrelerin
     durumuna, yoksa spec'in kendi setSelected'ına. Popover'ın iki yazma
     noktası (checkbox ve Tümü/Hiçbiri) böylece ayrışmıyor. */
  function oabApplySelection(spec, kind, refs) {
    if (kind) { oabMultiSetSelected(kind, refs); oabMultiRenderLabel(kind); return; }
    if (spec && typeof spec.setSelected === 'function') spec.setSelected(refs);
  }
  function oabCloseMultiPopover() {
    document.getElementById('_oabMultiPopover')?.remove();
    document.querySelectorAll('.oabMultiTrigger[aria-expanded="true"]').forEach(btn => btn.setAttribute('aria-expanded', 'false'));
  }
  function oabCloseLocalFilterFieldPopover() {
    document.getElementById('_oabLocalFilterFieldPopover')?.remove();
  }
  // Kısa pencerelerde popover viewport altına taşıp erişilemez kalmasın diye
  // dikey yerleşim + max-height burada tek yerden hesaplanır (iki popover da kullanır).
  function oabPositionDropdown(popover, trigger) {
    const margin = 8;
    const rect = trigger.getBoundingClientRect();
    popover.style.left = `${Math.max(margin, Math.min(rect.left, window.innerWidth - popover.offsetWidth - margin))}px`;
    const spaceBelow = window.innerHeight - rect.bottom - margin - 4;
    const spaceAbove = rect.top - margin - 4;
    if (spaceBelow >= spaceAbove) {
      popover.style.top = `${rect.bottom + 4}px`;
      popover.style.maxHeight = `${Math.max(120, spaceBelow)}px`;
    } else {
      popover.style.maxHeight = `${Math.max(120, spaceAbove)}px`;
      const height = Math.min(popover.offsetHeight, spaceAbove);
      popover.style.top = `${Math.max(margin, rect.top - height - 4)}px`;
    }
  }
  function oabOpenLocalFilterFieldPopover(trigger) {
    if (!trigger || trigger.disabled) return;
    oabCloseMultiPopover();
    oabCloseLocalFilterFieldPopover();
    const engine = new OABLocalFilterEngine(S.rows);
    const usable = oabAvailableLocalFilterFields(engine);
    const visible = oabLocalFilterFields(usable);
    const choices = usable.filter(field => !visible.includes(field) && engine.distinctValues(field).length > 0);
    const popover = document.createElement('div');
    popover.id = '_oabLocalFilterFieldPopover';
    popover.className = 'oabLocalFilterAddPopover';
    popover.setAttribute('role', 'menu');
    const choiceMarkup = choices.length
      ? choices.map(field => `<button type="button" role="menuitem" data-oab-add-field="${oabEsc(field)}">${oabEsc(field)}</button>`).join('')
      : `<div class="oabLocalFilterAddEmpty" role="status">${oabEsc(oabT('Eklenebilecek filtre alanı yok.', 'No additional filter fields available.'))}</div>`;
    popover.innerHTML = `<div class="oabLocalFilterAddTitle">${oabEsc(oabT('Filtre alanı ekle', 'Add filter field'))}</div>${choiceMarkup}`;
    document.body.appendChild(popover);
    oabPositionDropdown(popover, trigger);
    popover.addEventListener('click', event => {
      const button = event.target.closest('[data-oab-add-field]');
      if (!button) return;
      oabChangeLocalFilterField(button.dataset.oabAddField, 'add');
      oabCloseLocalFilterFieldPopover();
      oabRenderLocalFilterBar();
    });
    setTimeout(() => window.addEventListener('pointerdown', function outside(event) {
      if (popover.contains(event.target) || event.target === trigger) return;
      oabCloseLocalFilterFieldPopover();
      window.removeEventListener('pointerdown', outside, true);
    }, true), 0);
  }
  /* Açılır liste iki yerde kullanılır: üst filtreler (Season/MAG/Buyer Group)
     ve pivot yerel filtreleri (Klasman Tanımı vb.). İkinci bir seçim deseni
     icat etmemek için aynı bileşen parametrik hâle getirildi — çağıran ya
     hazır bir "kind" verir ya da kendi spec'ini. */
  function oabOpenMultiPopover(kindOrSpec, triggerEl) {
    const spec = typeof kindOrSpec === 'string' ? OAB_MULTI[kindOrSpec] : kindOrSpec;
    const kind = typeof kindOrSpec === 'string' ? kindOrSpec : '';
    const trigger = triggerEl || (spec && spec.trigger ? oabEl(spec.trigger) : null);
    if (!spec || !trigger || trigger.disabled) return;
    const alreadyOpen = trigger.getAttribute('aria-expanded') === 'true';
    oabCloseMultiPopover();
    if (alreadyOpen) return;
    trigger.setAttribute('aria-expanded', 'true');

    const popover = document.createElement('div');
    popover.id = '_oabMultiPopover';
    popover.className = 'oabMultiPopover';
    popover.setAttribute('role', 'listbox');
    popover.innerHTML = `
      <div class="oabMultiHead">
        <input type="search" class="oabMultiSearch" id="_oabMultiSearch" placeholder="${oabEsc(oabT('Ara…', 'Search…'))}" autocomplete="off">
        <div class="oabMultiActions">
          <button type="button" class="oabMultiAction" data-oab-multi-all>${oabEsc(oabT('Tümü', 'All'))}</button>
          <button type="button" class="oabMultiAction" data-oab-multi-none>${oabEsc(oabT('Hiçbiri', 'None'))}</button>
        </div>
      </div>
      <div class="oabMultiList" id="_oabMultiList"></div>
      <div class="oabMultiFoot" id="_oabMultiFoot"></div>`;
    document.body.appendChild(popover);
    oabPositionDropdown(popover, trigger);

    const renderList = () => {
      const terms = parseTableSearchTerms(oabEl('_oabMultiSearch').value || '');
      const options = spec.options();
      const selected = new Set(spec.selected().map(String));
      const visible = options.filter(opt => tableSearchMatches(oabOptionLabel(opt),terms,{plainMode:'contains'}));
      const list = oabEl('_oabMultiList');
      list.innerHTML = visible.length
        ? visible.map(opt => {
          const ref = String(oabOptionRef(opt));
          return `<label class="oabMultiItem"><input type="checkbox" value="${oabEsc(ref)}"${selected.has(ref) ? ' checked' : ''}><span>${oabEsc(oabOptionLabel(opt))}</span></label>`;
        }).join('')
        : `<div class="oabMultiEmpty">${oabEsc(oabT('Eşleşen kayıt yok.', 'No matching entry.'))}</div>`;
      const foot = oabEl('_oabMultiFoot');
      // "Tümü" düğmesi ARANAN listeyi seçer; filtreyi görmezden gelip 130 MAG'ı
      // birden işaretlemek, kullanıcının kastetmediği devasa bir iş demek olurdu.
      foot.textContent = oabT(
        `${spec.selected().length} seçili · ${visible.length} görünen`,
        `${spec.selected().length} selected · ${visible.length} shown`,
      );
    };
    renderList();

    popover.addEventListener('input', event => {
      if (event.target.id === '_oabMultiSearch') { renderList(); return; }
      if (event.target.type !== 'checkbox') return;
      const ref = String(event.target.value);
      const next = new Set(spec.selected().map(String));
      if (event.target.checked) next.add(ref); else next.delete(ref);
      if (kind === 'buyerGroup') S.allBuyerGroups = false;
      oabApplySelection(spec, kind, [...next]);
      renderList();
      spec.onChange();
    });
    popover.addEventListener('click', event => {
      const all = event.target.closest('[data-oab-multi-all]');
      const none = event.target.closest('[data-oab-multi-none]');
      if (!all && !none) return;
      const terms = parseTableSearchTerms(oabEl('_oabMultiSearch').value || '');
      const visibleRefs = spec.options()
        .filter(opt => tableSearchMatches(oabOptionLabel(opt),terms,{plainMode:'contains'}))
        .map(opt => String(oabOptionRef(opt)));
      const next = new Set(spec.selected().map(String));
      if (all) visibleRefs.forEach(ref => next.add(ref)); else visibleRefs.forEach(ref => next.delete(ref));
      // Buyer Group'ta filtresiz "Tümü", her (Sezon, MAG) için o ikilinin
      // GERÇEK listesini istemek anlamına gelir; sunucu bunu kendi metadata'sından
      // genişletir. İstemcideki birleşik liste bu iş için yeterince kesin değil.
      if (kind === 'buyerGroup') S.allBuyerGroups = Boolean(all && !query);
      oabApplySelection(spec, kind, [...next]);
      renderList();
      spec.onChange();
    });
    setTimeout(() => oabEl('_oabMultiSearch')?.focus(), 0);
  }
  document.addEventListener('click', event => {
    if (event.target.closest('#_oabMultiPopover')) return;
    if (event.target.closest('#_oabLocalFilterFieldPopover')) return;
    const addFilter = event.target.closest('[data-oab-local-filter-add]');
    if (addFilter) { event.preventDefault(); oabOpenLocalFilterFieldPopover(addFilter); return; }
    const removeFilter = event.target.closest('[data-oab-local-filter-remove]');
    if (removeFilter) {
      event.preventDefault();
      oabChangeLocalFilterField(removeFilter.dataset.oabLocalFilterRemove, 'remove');
      oabCloseMultiPopover();
      oabRenderLocalFilterBar();
      oabRenderTable();
      return;
    }
    const trigger = event.target.closest('.oabMultiTrigger');
    if (trigger && trigger.dataset.oabMulti) { event.preventDefault(); oabOpenMultiPopover(trigger.dataset.oabMulti); return; }
    if (trigger && trigger.dataset.oabLocalFilter) {
      event.preventDefault();
      oabOpenMultiPopover(oabLocalFilterSpec(trigger.dataset.oabLocalFilter), trigger);
      return;
    }
    oabCloseMultiPopover();
  });
  document.addEventListener('keydown', event => { if (event.key === 'Escape') oabCloseMultiPopover(); });

  async function oabLoadSeasons() {
    const trigger = oabEl('oabSeasonTrigger');
    if (!trigger) return;
    trigger.disabled = true;
    oabEl('oabAuthBar').innerHTML = ''; oabEl('oabAuthBar').hidden = true;
    try {
      const data = await OABApi.seasons();
      S.seasons = data.seasons || [];
      S.metadataInfo = data.metadata || S.metadataInfo;
      oabMultiRenderLabel('season');
      trigger.disabled = false;
      // Filtre metadata'sı artık Buyer Log ile paketlenen JSON'dan gelir.
      // Season/MAG/Buyer seçimleri sırasında PASS metadata isteği yapılmaz.
      oabSetStatus('');
      return data;
    } catch (err) {
      oabEl('oabSeasonLabel').textContent = oabT('Yüklenemedi', 'Failed to load');
      oabShowRetry(oabAuthErrorMessage(err), oabLoadSeasons);
      return null;
    }
  }

  // Bağlantı/metadata hatası olduğunda, kullanıcının SEBEBİNİ görüp aynı
  // eylemi (Season/MAG/BuyerGroup yükleme veya rapor çekme) tek tıkla tekrar
  // deneyebileceği bir şerit. "PASS'e Bağlan" artık AYRI bir ön adım değil —
  // yalnızca bir işlem PASS bağlantısı gerektirip başarısız olduğunda çıkar.
  function oabShowRetry(message, retryFn) {
    const bar = oabEl('oabAuthBar');
    if (!bar) { oabSetStatus(message, 'error'); return; }
    bar.innerHTML = `<span>${oabEsc(message)}</span><button type="button" class="navActionBtn" id="oabRetryBtn">${oabEsc(oabT('Tekrar Dene', 'Retry'))}</button>`;
    bar.hidden = false;
    oabEl('oabRetryBtn')?.addEventListener('click', () => { bar.hidden = true; void retryFn(); });
  }

  /* Zincirleme kural ÇOKLU seçimde de korunur, ama artık "sıfırla" yerine
     "geçerli kalanları koru" biçiminde: kullanıcı S6+S7 seçip MAG'ları
     işaretledikten sonra S7'yi kaldırırsa, hâlâ S6'da bulunan MAG seçimleri
     silinmemeli. Yalnız artık hiçbir seçili sezonda bulunmayan MAG'lar düşer.
     Aynı kural MAG → Buyer Group için de geçerlidir. */
  function oabUnionOptions(lists) {
    const seen = new Set(), out = [];
    for (const list of lists) for (const opt of list || []) {
      const ref = String(oabOptionRef(opt));
      if (!ref || seen.has(ref)) continue;
      seen.add(ref); out.push(opt);
    }
    // Ad sırası: 130 MAG arasında aranan kaydı bulmayı kolaylaştırır.
    return out.sort((a, b) => oabOptionLabel(a).localeCompare(oabOptionLabel(b), 'tr', { sensitivity: 'base' }));
  }
  function oabKeepValid(selected, options) {
    const valid = new Set(options.map(opt => String(oabOptionRef(opt))));
    return selected.filter(ref => valid.has(String(ref)));
  }
  async function oabOnSeasonSelectionChange() {
    const magTrigger = oabEl('oabMagTrigger'), bgTrigger = oabEl('oabBuyerGroupTrigger');
    if (!S.seasonRefs.length) {
      S.mag = []; S.buyerGroups = []; S.magRefs = []; S.buyerGroupRefs = []; S.allBuyerGroups = false;
      magTrigger.disabled = true; bgTrigger.disabled = true;
      oabMultiRenderLabel('mag'); oabMultiRenderLabel('buyerGroup');
      oabUpdateActionButtons(); return;
    }
    try {
      const lists = await Promise.all(S.seasonRefs.map(ref => OABApi.mag(ref).then(data => data.mag || [])));
      S.mag = oabUnionOptions(lists);
      S.magRefs = oabKeepValid(S.magRefs, S.mag);
      magTrigger.disabled = false;
      oabMultiRenderLabel('mag');
      await oabOnMagSelectionChange();
    } catch (err) { oabShowRetry(oabAuthErrorMessage(err), oabOnSeasonSelectionChange); }
  }
  async function oabOnMagSelectionChange() {
    const bgTrigger = oabEl('oabBuyerGroupTrigger');
    if (!S.magRefs.length) {
      S.buyerGroups = []; S.buyerGroupRefs = []; S.allBuyerGroups = false;
      bgTrigger.disabled = true;
      oabMultiRenderLabel('buyerGroup');
      oabUpdateActionButtons(); return;
    }
    try {
      const lists = await Promise.all(S.magRefs.map(ref => OABApi.buyerGroups(ref).then(data => data.buyerGroups || [])));
      S.buyerGroups = oabUnionOptions(lists);
      S.buyerGroupRefs = oabKeepValid(S.buyerGroupRefs, S.buyerGroups);
      if (S.allBuyerGroups) S.buyerGroupRefs = S.buyerGroups.map(opt => String(oabOptionRef(opt)));
      bgTrigger.disabled = false;
      oabMultiRenderLabel('buyerGroup');
      oabOnBuyerGroupSelectionChange();
    } catch (err) { oabShowRetry(oabAuthErrorMessage(err), oabOnMagSelectionChange); }
  }
  function oabOnBuyerGroupSelectionChange() {
    oabUpdateActionButtons();
    oabSchedulePlan();
  }
  function oabCurrentSelection(forceRefresh) {
    return {
      seasonRefs: S.seasonRefs, merchSubGroupRefs: S.magRefs,
      buyerGroupRefs: S.buyerGroupRefs, allBuyerGroups: Boolean(S.allBuyerGroups),
      forceRefresh: Boolean(forceRefresh),
    };
  }
  /* Maliyet tahmini SUNUCUDAKİ PLANDAN gelir. İstemcide ayrıca hesaplamak,
     ekranda görünen sayı ile gerçekte çekilen sayının ayrışması demekti —
     kullanıcı 8 kombinasyon sanıp 164 kombinasyonluk iş başlatabilirdi. */
  function oabSchedulePlan() {
    const token = ++S.planToken;
    clearTimeout(oabSchedulePlan._timer);
    oabSchedulePlan._timer = setTimeout(async () => {
      if (!S.seasonRefs.length || !S.magRefs.length || (!S.buyerGroupRefs.length && !S.allBuyerGroups)) {
        S.plan = null; oabRenderPlanBar(); return;
      }
      try {
        const plan = await OABApi.plan(oabCurrentSelection(false));
        if (token !== S.planToken) return; // daha yeni bir seçim var
        S.plan = plan;
      } catch (_) { S.plan = null; }
      oabRenderPlanBar();
      oabUpdateActionButtons();
    }, 250);
  }
  // Onay eşiği DAİMA en kötü duruma bakar. Yetenek 'unknown' iken 164
  // kombinasyon "4 istek · ~80 sn" görünüyor; doğrulama başarısız olursa aynı
  // iş ~55 dakika. İyimser sayıya göre onay atlamak, kullanıcıyı habersiz
  // biçimde saatlik bir işe sokardı.
  function oabPlanHeavySeconds(plan) {
    if (!plan) return 0;
    return Math.max(Number(plan.estimateSeconds) || 0, Number(plan.worstCaseSeconds) || 0);
  }
  function oabFormatDuration(seconds) {
    const total = Math.max(0, Math.round(Number(seconds) || 0));
    if (!total) return oabT('anında', 'instant');
    if (total < 90) return oabT(`~${total} sn`, `~${total} s`);
    return oabT(`~${Math.round(total / 60)} dk`, `~${Math.round(total / 60)} min`);
  }
  function oabRenderPlanBar() {
    const bar = oabEl('oabPlanBar');
    if (!bar) return;
    const plan = S.plan;
    if (!plan || !plan.combinationCount) { bar.hidden = true; bar.innerHTML = ''; return; }
    const parts = [];
    parts.push(oabT(`${plan.combinationCount} kombinasyon`, `${plan.combinationCount} combinations`));
    if (plan.useBatched && plan.requestCount < plan.combinationCount) {
      parts.push(oabT(`${plan.requestCount} OAB isteği (toplu)`, `${plan.requestCount} OAB requests (batched)`));
    } else {
      parts.push(oabT(`${plan.requestCount} OAB isteği`, `${plan.requestCount} OAB requests`));
    }
    if (plan.cachedCount) parts.push(oabT(`${plan.cachedCount} önbellekten`, `${plan.cachedCount} from cache`));
    parts.push(oabFormatDuration(plan.estimateSeconds));
    // Toplu istek henüz DOĞRULANMADIYSA iyimser sayıyı tek başına göstermek
    // yanıltıcı olur: doğrulama başarısız olursa aynı seçim kombinasyon başına
    // isteğe düşer. İki durum da yazılır ve eşik EN KÖTÜ duruma bakar.
    if (plan.batchUnproven) {
      parts.push(oabT(
        `toplu istek doğrulanmazsa ${plan.worstCaseRequestCount} istek ${oabFormatDuration(plan.worstCaseSeconds)}`,
        `if batching is not confirmed: ${plan.worstCaseRequestCount} requests ${oabFormatDuration(plan.worstCaseSeconds)}`,
      ));
    }
    const heavy = oabPlanHeavySeconds(plan) >= OAB_HEAVY_SECONDS;
    const skipNote = plan.skippedCount
      ? `<button type="button" class="oabPlanLink" id="oabPlanSkippedBtn">${oabEsc(oabT(`${plan.skippedCount} kombinasyon OAB'da karşılıksız`, `${plan.skippedCount} combinations have no OAB match`))}</button>`
      : '';
    const capabilityNote = plan.capability && plan.capability.state === 'unsupported'
      ? `<span class="oabPlanNote">${oabEsc(oabT('OAB toplu Buyer Group isteğini kabul etmiyor; kombinasyon başına çekiliyor.', 'OAB does not accept batched Buyer Group requests; fetching per combination.'))}</span>`
      : '';
    bar.hidden = false;
    bar.className = `oabPlanBar${heavy ? ' isHeavy' : ''}`;
    bar.innerHTML = `<span class="oabPlanMain">${oabEsc(parts.join(' · '))}</span>${skipNote}${capabilityNote}`;
    oabEl('oabPlanSkippedBtn')?.addEventListener('click', () => oabShowSkippedCombinations(plan));
  }
  function oabShowSkippedCombinations(plan) {
    const items = (plan && plan.skipped) || [];
    const reasons = {
      'season-not-found': oabT('Sezon metadata\'da yok', 'Season not in metadata'),
      'mag-not-in-season': oabT('MAG bu sezonda yok', 'MAG not in this season'),
      'buyer-group-not-in-mag': oabT('Buyer Group bu MAG\'da yok', 'Buyer Group not in this MAG'),
      'no-buyer-group': oabT('Bu MAG\'ın Buyer Group\'u yok', 'This MAG has no Buyer Group'),
    };
    const lines = items.slice(0, 100).map(item => `<li>${oabEsc(item.label || '')} — ${oabEsc(reasons[item.reason] || item.reason)}</li>`).join('');
    const more = items.length > 100 ? `<p class="oabMultiEmpty">${oabEsc(oabT(`… ve ${items.length - 100} kayıt daha`, `… and ${items.length - 100} more`))}</p>` : '';
    const modal = document.createElement('div');
    modal.className = 'warnOverlay';
    modal.innerHTML = `<div class="modalCard" role="dialog" aria-modal="true">
      <div class="modalTitle">${oabEsc(oabT('Karşılıksız kombinasyonlar', 'Combinations with no OAB match'))}</div>
      <p class="oabPlanNote">${oabEsc(oabT('Bu kombinasyonlar OAB metadata\'sında bulunmadığı için istenmeyecek. Rapor eksik değildir; bu üçlüler OAB\'da zaten yoktur.', 'These combinations are not in the OAB metadata, so they will not be requested. The report is not missing data; these triples do not exist in OAB.'))}</p>
      <ul class="oabSkippedList">${lines}</ul>${more}
      <div class="modalActions"><button type="button" class="navActionBtn" data-close>${oabEsc(oabT('Kapat', 'Close'))}</button></div>
    </div>`;
    document.body.appendChild(modal);
    const close = () => modal.remove();
    modal.querySelector('[data-close]').addEventListener('click', close);
    modal.addEventListener('click', event => { if (event.target === modal) close(); });
  }
  // Filtre bağımlılık zinciri: Season -> MAG -> Buyer Group -> Get/Refresh OAB.
  function oabUpdateActionButtons() {
    const getBtn = oabEl('oabGetBtn'), refreshBtn = oabEl('oabRefreshBtn'), exportBtn = oabEl('oabExcelExportBtn');
    const ready = Boolean(S.seasonRefs.length && S.magRefs.length && (S.buyerGroupRefs.length || S.allBuyerGroups));
    if (getBtn) getBtn.disabled = !ready || S.busy;
    if (refreshBtn) refreshBtn.disabled = !ready || S.busy;
    if (exportBtn) exportBtn.disabled = !S.rows.length || S.busy;
    const cancelBtn = oabEl('oabCancelBtn');
    if (cancelBtn) cancelBtn.hidden = !(S.batchJob && S.batchJob.running);
  }

  function sanitizeOabPivotConfig(config) {
    const source = config && typeof config === 'object' ? config : defaultPivotConfigClient();
    const removed = OAB_REMOVED_DERIVED_FIELD_SET;
    const keepField = field => field && !removed.has(String(field));
    const rows = (Array.isArray(source.rows) ? source.rows : []).filter(keepField);
    const columns = (Array.isArray(source.columns) ? source.columns : []).filter(keepField);
    const values = (Array.isArray(source.values) ? source.values : []).filter(v => v && keepField(v.field));
    const localFilters = Object.fromEntries(Object.entries(source.localFilters || {}).filter(([field]) => keepField(field)));
    const calculatedFields = (Array.isArray(source.calculatedFields) ? source.calculatedFields : []).filter(v => !v || keepField(v.field || v.key || v.label));
    return {
      ...source,
      rows,
      columns,
      values,
      localFilters,
      calculatedFields,
      grouped: source.grouped !== false,
      showSubtotals: source.showSubtotals !== false,
    };
  }

  async function oabApplyReportData(data, options = {}) {
    const rawRows = Array.isArray(data && data.rows) ? data.rows : [];
    oabDataRevision+=1;oabFilterRowsCache.clear();oabPivotViewCache.clear();
    S.rows = OABDataUtils.withDerivedBuyerMetrics(rawRows);
    const rawFields = data && data.fields && data.fields.length ? data.fields : OABDataUtils.deriveFieldList(rawRows);
    S.fields = [...new Set([...rawFields, ...OABDataUtils.OAB_DERIVED_FIELDS])];
    S.fromCache = Boolean(data && data.fromCache);
    S.fromSnapshot = Boolean(options.fromSnapshot);
    S.fetchedAt = (data && data.fetchedAt) || '';
    S.localFilters = {}; S.pivotFilters = {}; S.pivotSort = { key: '', dir: 1 };
    // v7.31 — kayıtlı yerel filtre seçimleri geri yüklenir (bkz.
    // oabRestoreLocalFilters: veride kalmayan değerler uygulanmaz).
    const restoredFilters = oabRestoreLocalFilters();
    if (restoredFilters.dropped.length) {
      oabToast(oabT(
        `Kayıtlı filtrelerden ${restoredFilters.dropped.length} tanesi bu raporda bulunmadığı için uygulanmadı: ${restoredFilters.dropped.join(', ')}`,
        `${restoredFilters.dropped.length} saved filter(s) were not applied because they are not in this report: ${restoredFilters.dropped.join(', ')}`));
    }
    if (!S.pivotConfig) {
      const settingsData = await OABApi.getSettings().catch(() => null);
      S.pivotConfig = sanitizeOabPivotConfig((settingsData && settingsData.settings && settingsData.settings.pivotConfig) || defaultPivotConfigClient());
      S.settings = (settingsData && settingsData.settings) || S.settings;
    }
    oabEl('oabBody').hidden = false;
    oabRenderBody();
  }

  async function oabRestoreLastSnapshot() {
    let payload = null;
    try { payload = await OABApi.state(); }
    catch (_) { return false; } // snapshot yokluğu/açılış hatası OAB ekranını bloke etmez.
    const state = payload && payload.state;
    const selection = state && state.selection;
    const snapshot = state && state.snapshot;
    if (!selection || !snapshot || !Array.isArray(snapshot.rows)) return false;

    // v7.20 — snapshot iki biçimi de taşıyabilir: v7.19 ve öncesi tekil ref
    // yazıyordu, v7.20 dizi yazıyor. Eski snapshot'lar okunabilir kalmalı,
    // aksi halde yükseltmeden sonra herkesin son raporu kaybolurdu.
    const asList = (plural, single) => {
      if (Array.isArray(plural) && plural.length) return plural.map(String);
      const one = String(single == null ? '' : single);
      return one ? [one] : [];
    };
    const seasonRefs = asList(selection.seasonRefs, selection.seasonRef);
    const magRefs = asList(selection.merchSubGroupRefs, selection.merchSubGroupRef);
    const buyerGroupRefs = asList(selection.buyerGroupRefs, selection.buyerGroupRef);
    if (!seasonRefs.length || !magRefs.length || !buyerGroupRefs.length) return false;
    const knownSeasons = new Set(S.seasons.map(opt => String(oabOptionRef(opt))));
    if (!seasonRefs.some(ref => knownSeasons.has(ref))) return false;

    S.seasonRefs = seasonRefs.filter(ref => knownSeasons.has(ref));
    S.allBuyerGroups = Boolean(selection.allBuyerGroups);
    oabMultiRenderLabel('season');
    await oabOnSeasonSelectionChange();
    S.magRefs = oabKeepValid(magRefs, S.mag);
    if (!S.magRefs.length) return false;
    oabMultiRenderLabel('mag');
    await oabOnMagSelectionChange();
    if (!S.allBuyerGroups) {
      S.buyerGroupRefs = oabKeepValid(buyerGroupRefs, S.buyerGroups);
      if (!S.buyerGroupRefs.length) return false;
    }
    oabMultiRenderLabel('buyerGroup');
    oabOnBuyerGroupSelectionChange();

    await oabApplyReportData({
      rows: snapshot.rows,
      fields: snapshot.fields,
      fetchedAt: snapshot.fetchedAt,
      fromCache: Boolean(snapshot.fromCache),
    }, { fromSnapshot: true });
    oabUpdateActionButtons();
    return true;
  }

  async function oabFetchReport(forceRefresh) {
    if (S.busy) return;
    S.busy = true;
    S.busyStartedAt = performance.now();
    S.busyStatusMessage = '';
    S.busyStatusKind = '';
    oabUpdateActionButtons();
    // Get/Refresh OAB first tries the backend RAM session. If authentication
    // is missing/expired, oabJson opens Buyer Log's internal Chromium sign-in
    // and automatically retries the original request after successful login.
    oabSetBusyStatus(forceRefresh ? oabT('OAB yenileniyor', 'Refreshing OAB') : oabT('OAB getiriliyor', 'Getting OAB'));
    if (!S.rows.length) oabEl('oabBody').hidden = true;
    let authPollBusy = false;
    const elapsedTimer = setInterval(() => {
      if (S.busy && S.busyStatusMessage) oabSetStatus(`${S.busyStatusMessage} · ${oabBusyElapsedText()}`, S.busyStatusKind);
    }, 50);
    const authPoll = setInterval(async () => {
      if (!S.busy || authPollBusy) return;
      authPollBusy = true;
      try {
        const status = await OABApi.authStatus();
        const message = oabAuthProgressMessage(status);
        if (message) oabSetBusyStatus(message, status && status.status && status.status.loginRequired ? 'warning' : '');
      } catch (_) { /* progress polling ana rapor isteğini asla bozmaz */ }
      finally { authPollBusy = false; }
    }, 900);
    let retryAfterAuth = false;
    try {
      const single = S.seasonRefs.length === 1 && S.magRefs.length === 1 && !S.allBuyerGroups && S.buyerGroupRefs.length === 1;
      if (single) {
        const data = await OABApi.report(S.seasonRefs[0], S.magRefs[0], S.buyerGroupRefs[0], forceRefresh);
        await oabApplyReportData(data, { fromSnapshot: false });
        oabSetStatus('');
      } else {
        await oabRunBatch(forceRefresh);
      }
    } catch (err) {
      if (oabIsAuthErrorCode(err && err.code)) {
        try {
          await oabEnsureAuthentication();
          retryAfterAuth = true;
        } catch (authError) {
          oabShowRetry(oabReportErrorMessage(authError), () => oabFetchReport(forceRefresh));
        }
      } else {
        oabShowRetry(oabReportErrorMessage(err), () => oabFetchReport(forceRefresh));
      }
    } finally {
      clearInterval(authPoll);
      clearInterval(elapsedTimer);
      S.busy = false;
      S.busyStartedAt = 0;
      S.busyStatusMessage = '';
      S.busyStatusKind = '';
      oabUpdateActionButtons();
    }
    if (retryAfterAuth) return oabFetchReport(forceRefresh);
  }

  /* ================================================================
     v7.20 — ARKA PLAN TOPLU ÇEKME (çoklu seçim)

     Tek OAB çağrısı 15-25 saniye ve PASS istekleri tek tarayıcı sayfası
     üzerinden gittiği için paralelleştirilemiyor. Bu yüzden iş sunucuda
     kimlikli bir arka plan işi olarak yürür; burada yalnız ilerleme okunur.
     İptal edilen iş, o ana kadar çekilen kombinasyonları YİNE döndürür.
     ================================================================ */
  const OAB_HEAVY_SECONDS = 180; // bu eşiği aşan işler önce onay ister
  function oabRenderProgress(job) {
    const wrap = oabEl('oabProgressBar'), fill = oabEl('oabProgressFill'), text = oabEl('oabProgressText');
    if (!wrap || !fill || !text) return;
    if (!job) { wrap.hidden = true; return; }
    wrap.hidden = false;
    const total = Math.max(1, Number(job.total) || 1);
    const done = Math.min(total, Number(job.completed) || 0);
    fill.style.width = `${Math.round((done / total) * 100)}%`;
    const remaining = Math.max(0, total - done);
    const parts = [oabT(`${done} / ${total}`, `${done} / ${total}`)];
    if (job.currentLabel) parts.push(job.currentLabel);
    if (job.running && remaining) parts.push(oabFormatDuration(remaining * 20));
    if (job.fromCache) parts.push(oabT(`${job.fromCache} önbellekten`, `${job.fromCache} from cache`));
    if (job.failures && job.failures.length) parts.push(oabT(`${job.failures.length} başarısız`, `${job.failures.length} failed`));
    text.textContent = parts.join(' · ');
  }
  async function oabConfirmHeavyRun(plan) {
    return new Promise(resolve => {
      const modal = document.createElement('div');
      modal.className = 'warnOverlay';
      modal.innerHTML = `<div class="modalCard" role="dialog" aria-modal="true">
        <div class="modalTitle">${oabEsc(oabT('Bu rapor uzun sürecek', 'This report will take a while'))}</div>
        <p>${oabEsc(oabT(
          `Seçiminiz ${plan.combinationCount} kombinasyon üretiyor ve ${plan.requestCount} OAB isteği gerektiriyor. Tahmini süre ${oabFormatDuration(plan.estimateSeconds)}.`,
          `Your selection produces ${plan.combinationCount} combinations and needs ${plan.requestCount} OAB requests. Estimated time ${oabFormatDuration(plan.estimateSeconds)}.`,
        ))}</p>
        ${plan.batchUnproven ? `<p>${oabEsc(oabT(
          `OAB'ın toplu Buyer Group isteğini kabul edip etmediği henüz denenmedi. Kabul etmiyorsa aynı seçim ${plan.worstCaseRequestCount} isteğe ve ${oabFormatDuration(plan.worstCaseSeconds)} süreye çıkar. Buyer Log bunu ilk istekte anlayıp buna göre devam eder.`,
          `Whether OAB accepts a batched Buyer Group request has not been tried yet. If it does not, the same selection becomes ${plan.worstCaseRequestCount} requests and ${oabFormatDuration(plan.worstCaseSeconds)}. Buyer Log finds this out on the first request and continues accordingly.`,
        ))}</p>` : ''}
        <p class="oabPlanNote">${oabEsc(oabT('İşlem arka planda yürür; istediğiniz an iptal edebilirsiniz. İptal ederseniz o ana kadar çekilen veriler korunur.', 'The job runs in the background and you can cancel at any time. If you cancel, everything fetched so far is kept.'))}</p>
        <div class="modalActions">
          <button type="button" class="navActionBtn" data-cancel>${oabEsc(oabT('Vazgeç', 'Cancel'))}</button>
          <button type="button" class="navActionBtn primary" data-confirm>${oabEsc(oabT('Devam et', 'Continue'))}</button>
        </div>
      </div>`;
      document.body.appendChild(modal);
      const done = value => { modal.remove(); resolve(value); };
      modal.querySelector('[data-cancel]').addEventListener('click', () => done(false));
      modal.querySelector('[data-confirm]').addEventListener('click', () => done(true));
      modal.addEventListener('click', event => { if (event.target === modal) done(false); });
    });
  }
  async function oabRunBatch(forceRefresh) {
    const plan = await OABApi.plan(oabCurrentSelection(forceRefresh));
    S.plan = plan; oabRenderPlanBar();
    if (!plan.combinationCount) {
      oabSetStatus(oabT('Seçilen filtreler OAB metadata ile eşleşen hiçbir kombinasyon üretmiyor.', 'The selected filters produce no combination that matches the OAB metadata.'), 'error');
      return;
    }
    if (oabPlanHeavySeconds(plan) >= OAB_HEAVY_SECONDS && !(await oabConfirmHeavyRun(plan))) {
      oabSetStatus('');
      return;
    }
    const started = await OABApi.batchStart(oabCurrentSelection(forceRefresh));
    S.batchJob = started.job;
    oabRenderProgress(S.batchJob);
    oabUpdateActionButtons();
    oabSetBusyStatus(oabT('OAB kombinasyonları çekiliyor', 'Fetching OAB combinations'));
    const finished = await oabPollBatch();
    S.batchJob = finished.job;
    oabRenderProgress(S.batchJob);
    oabUpdateActionButtons();
    if (!finished.rows) {
      oabSetStatus(oabT('OAB toplu çekme sonuç döndürmedi.', 'The OAB batch fetch returned no result.'), 'error');
      return;
    }
    await oabApplyReportData({ rows: finished.rows, fields: finished.fields, fetchedAt: finished.fetchedAt, fromCache: false }, { fromSnapshot: false });
    oabReportBatchOutcome(finished);
  }
  function oabPollBatch() {
    return new Promise((resolve, reject) => {
      const tick = async () => {
        try {
          const status = await OABApi.batchStatus();
          if (!status.job) { resolve({ job: null, rows: null }); return; }
          S.batchJob = status.job;
          oabRenderProgress(status.job);
          if (status.job.running) { S.batchTimer = setTimeout(tick, 1000); return; }
          if (oabIsAuthErrorCode(status.job.errorCode)) {
            const error = new Error(status.job.error || oabT('OAB oturumu gerekli.', 'OAB sign-in is required.'));
            error.code = status.job.errorCode;
            reject(error);
            return;
          }
          resolve(status);
        } catch (error) { reject(error); }
      };
      void tick();
    });
  }
  /* Kısmi başarı SESSİZ GEÇİLMEZ: kaç kombinasyon çekildi, kaçı başarısız,
     hangileri — kullanıcı raporun kapsamını bilerek okumalı.

     v7.23 — Saha bulgusu (kullanıcı): "9 combinations merged · 1 combinations
     failed hatası alıyorum. Fail olan kombinasyonun detayını görmek, ...
     yeniden dene diyerek pivot alanına dahil etmek istiyorum."

     Artık uyarı şeridi TIKLANABİLİR: hangi kombinasyonun neden alınamadığı
     açılır ve oradan yalnız o kombinasyonlar yeniden denenip mevcut rapora
     EKLENİR. Baştan tam çekim yapılmaz; eldeki veri kaybolmaz. */
  function oabReportBatchOutcome(finished, options = {}) {
    const job = finished.job || {};
    const sources = finished.sources || [];
    const failures = job.failures || [];
    const notes = [];
    /* Yeniden denemede sayı, RAPORUN TAMAMI değil EKLENENDİR. "1 kombinasyon
       birleştirildi" yazmak, ekranda 3 kombinasyonluk veri dururken raporun
       tek kombinasyona düştüğü izlenimi verirdi. */
    notes.push(options.merged
      ? oabT(`${sources.length} kombinasyon rapora eklendi`, `${sources.length} combinations added to the report`)
      : oabT(`${sources.length} kombinasyon birleştirildi`, `${sources.length} combinations merged`));
    if (job.cancelled) notes.push(oabT('iş iptal edildi', 'job cancelled'));
    if (failures.length) notes.push(oabT(`${failures.length} kombinasyon alınamadı`, `${failures.length} combinations failed`));
    if (job.batchedBuyerGroups === 'supported') notes.push(oabT('toplu Buyer Group isteği kullanıldı', 'batched Buyer Group request used'));
    if (failures.length) notes.push(oabT('— detay için tıklayın', '— click for details'));
    // Sıra önemli: oabSetStatus listeyi temizler, sonra dolduruyoruz.
    oabSetStatus(notes.join(' · '), failures.length || job.cancelled ? 'warning' : '');
    S.batchFailures = failures;
    oabBindFailureDetails();
  }
  // Uyarı şeridini tıklanabilir yapar. Tek tık yeterli: çift tık, dokunmatik
  // ve klavye kullanıcıları için erişilemez bir etkileşim olurdu.
  function oabBindFailureDetails() {
    const el = oabEl('oabStatus');
    if (!el) return;
    const has = Array.isArray(S.batchFailures) && S.batchFailures.length > 0;
    el.classList.toggle('isClickable', has);
    el.tabIndex = has ? 0 : -1;
    el.setAttribute('role', has ? 'button' : 'status');
    if (el._oabFailureBound) return;
    el._oabFailureBound = true;
    const open = () => { if (Array.isArray(S.batchFailures) && S.batchFailures.length) oabShowFailureDetails(); };
    el.addEventListener('click', open);
    el.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); open(); } });
  }
  function oabRetryableCombinations() {
    const out = [], seen = new Set();
    for (const failure of Array.isArray(S.batchFailures) ? S.batchFailures : []) {
      for (const item of Array.isArray(failure.combinations) ? failure.combinations : []) {
        const key = `${item.seasonRef}|${item.merchSubGroupRef}|${item.buyerGroupRef}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(item);
      }
    }
    return out;
  }
  function oabShowFailureDetails() {
    const failures = Array.isArray(S.batchFailures) ? S.batchFailures : [];
    const retryable = oabRetryableCombinations();
    const rows = failures.map(failure => `<tr>
      <td>${oabEsc(failure.label || '—')}</td>
      <td><code>${oabEsc(failure.code || '')}</code></td>
      <td>${oabEsc(failure.message || '')}</td>
    </tr>`).join('');
    const modal = document.createElement('div');
    modal.className = 'warnOverlay';
    modal.innerHTML = `<div class="modalCard oabFailureCard" role="dialog" aria-modal="true">
      <div class="modalTitle">${oabEsc(oabT('Alınamayan kombinasyonlar', 'Combinations that could not be retrieved'))}</div>
      <p class="oabPlanNote">${oabEsc(oabT(
        'Bu kombinasyonlar OAB’dan alınamadı; rapor onlar olmadan gösteriliyor. Yeniden denediğinizde YALNIZ bunlar çekilir ve mevcut rapora eklenir — baştan tam çekim yapılmaz.',
        'These combinations could not be retrieved from OAB; the report is shown without them. Retrying fetches ONLY these and adds them to the current report — no full re-fetch.',
      ))}</p>
      <div class="tablewrap oabFailureTableWrap"><table class="miniTable">
        <thead><tr>
          <th>${oabEsc(oabT('Kombinasyon', 'Combination'))}</th>
          <th>${oabEsc(oabT('Kod', 'Code'))}</th>
          <th>${oabEsc(oabT('Hata', 'Error'))}</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table></div>
      <div class="modalActions">
        <button type="button" class="navActionBtn" data-close>${oabEsc(oabT('Kapat', 'Close'))}</button>
        <button type="button" class="navActionBtn primary" data-retry${retryable.length ? '' : ' disabled'}>${oabEsc(oabT(`Yeniden dene (${retryable.length})`, `Retry (${retryable.length})`))}</button>
      </div>
    </div>`;
    document.body.appendChild(modal);
    const close = () => modal.remove();
    modal.querySelector('[data-close]').addEventListener('click', close);
    modal.addEventListener('click', event => { if (event.target === modal) close(); });
    modal.querySelector('[data-retry]').addEventListener('click', () => { close(); void oabRetryFailedCombinations(); });
  }
  /* Yalnız başarısız kombinasyonları çeker ve MEVCUT rapora ekler.

     Eldeki satırlar korunur; yeniden denenen kombinasyonun eski satırları
     (varsa) çıkarılıp yenileriyle değiştirilir, böylece tekrar oluşmaz. */
  async function oabRetryFailedCombinations() {
    const combinations = oabRetryableCombinations();
    if (!combinations.length) return;
    if (S.busy) return;
    S.busy = true; S.busyStartedAt = performance.now();
    oabUpdateActionButtons();
    oabSetBusyStatus(oabT(`${combinations.length} kombinasyon yeniden deneniyor`, `Retrying ${combinations.length} combinations`));
    let retryAfterAuth = false;
    try {
      const started = await OABApi.batchStart({ combinations, forceRefresh: true });
      S.batchJob = started.job;
      oabRenderProgress(S.batchJob);
      const finished = await oabPollBatch();
      S.batchJob = finished.job;
      oabRenderProgress(S.batchJob);
      if (!finished.rows) { oabSetStatus(oabT('Yeniden deneme sonuç döndürmedi.', 'The retry returned no result.'), 'error'); return; }
      await oabMergeRetryRows(finished);
      oabReportBatchOutcome(finished, { merged: true });
    } catch (error) {
      if (oabIsAuthErrorCode(error && error.code)) {
        try {
          await oabEnsureAuthentication();
          retryAfterAuth = true;
        } catch (authError) {
          oabShowRetry(oabReportErrorMessage(authError), () => oabRetryFailedCombinations());
        }
      } else {
        oabShowRetry(oabReportErrorMessage(error), () => oabRetryFailedCombinations());
      }
    } finally {
      S.busy = false; S.busyStartedAt = 0;
      oabUpdateActionButtons();
    }
    if (retryAfterAuth) return oabRetryFailedCombinations();
  }
  // Yeni satırları mevcut raporun ÜZERİNE ekler. Aynı kombinasyondan gelen
  // eski satırlar önce çıkarılır: aksi halde yeniden denenen bir kombinasyon
  // raporda iki kez sayılırdı.
  async function oabMergeRetryRows(finished) {
    const incoming = Array.isArray(finished.rows) ? finished.rows : [];
    const sources = Array.isArray(finished.sources) ? finished.sources : [];
    // Ayraç U+001F: alan değerlerinde bulunmaz, bu yüzden "AB|C" ile "A|BC"
    // aynı anahtara düşemez.
    const keyOf = row => [
      String(row && row[OAB_SEASON_FIELD] || ''),
      String(row && row[OAB_MAG_FIELD] || ''),
      String(row && row[OAB_BUYER_GROUP_FIELD] || ''),
    ].join('');
    const replaced = new Set(incoming.map(keyOf));
    const kept = S.rows.filter(row => !replaced.has(keyOf(row)));
    const merged = kept.concat(incoming);
    const fields = [...new Set([...(S.fields || []), ...(finished.fields || [])])];
    /* Kullanıcının pivot yerel filtreleri KORUNUR. oabApplyReportData yeni bir
       rapor geldiğini varsayıp filtreleri sıfırlar; burada yapılan iş ise aynı
       raporu TAMAMLAMAKTIR — ekranın altından filtre çekmek, kullanıcının
       baktığı kırılımı sebepsiz kaybettirirdi. */
    const keepLocalFilters = S.localFilters;
    const keepPivotFilters = S.pivotFilters;
    const keepPivotSort = S.pivotSort;
    await oabApplyReportData({ rows: merged, fields, fetchedAt: finished.fetchedAt, fromCache: false }, { fromSnapshot: false });
    S.localFilters = keepLocalFilters; S.pivotFilters = keepPivotFilters; S.pivotSort = keepPivotSort;
    oabRenderBody();
    void sources;
    oabToast(oabT(
      `Rapor güncellendi · toplam ${merged.length.toLocaleString('tr-TR')} satır`,
      `Report updated · ${merged.length.toLocaleString('en-GB')} rows total`,
    ));
  }
  const OAB_SEASON_FIELD = 'Sezon';
  const OAB_MAG_FIELD = 'Merch Alt Grup';
  const OAB_BUYER_GROUP_FIELD = 'Buyer Grup Tanımı';
  async function oabCancelBatch() {
    try { await OABApi.batchCancel(); oabSetBusyStatus(oabT('İptal ediliyor; eldeki veriler korunacak…', 'Cancelling; data fetched so far will be kept…'), 'warning'); }
    catch (error) { oabToast(oabAuthErrorMessage(error)); }
  }
  function defaultPivotConfigClient() {
    return {
      rows: ['Klasman Grup Tanımı', 'Klasman Tanımı'], columns: [],
      values: defaultOabPivotValueDefs(),
      localFilters: {}, calculatedFields: [], grouped: true, showSubtotals: true,
    };
  }
  function oabReportErrorMessage(err) {
    const code = err && err.code;
    if (oabIsAuthErrorCode(code) || String(code || '').startsWith('OAB_AUTH_')) return oabAuthErrorMessage(err);
    if (code === 'OAB_HTTP_ERROR' || code === 'OAB_REPORT_FETCH_FAILED') return oabPassHttpErrorMessage(err);
    return oabAuthErrorMessage(err);
  }
  function oabPassHttpErrorMessage(err) {
    const details = err && err.details;
    if (details && details.url && details.status) {
      let path = details.url;
      try { path = new URL(details.url).pathname; } catch (_) { /* URL değilse olduğu gibi göster */ }
      return oabT(
        `PASS isteği başarısız: ${details.method || 'POST'} ${path} → HTTP ${details.status}.`,
        `PASS request failed: ${details.method || 'POST'} ${path} → HTTP ${details.status}.`,
      );
    }
    return oabT('OAB raporu alınamadı. Bir süre sonra tekrar deneyin.', 'Could not retrieve the OAB report. Try again in a moment.');
  }

  function oabFilteredRows() {
    const filterKey=global.BLAnalysisCache?.key?global.BLAnalysisCache.key({data:oabDataRevision,filters:S.localFilters}):`${oabDataRevision}|${JSON.stringify(S.localFilters)}`;
    const cached=oabFilterRowsCache.get(filterKey);if(cached)return cached;
    const engine = new OABLocalFilterEngine(S.rows),filtered=engine.apply(S.localFilters);
    oabFilterRowsCache.set(filterKey,filtered);return filtered;
  }

  function oabRenderBody() {
    oabRenderLocalFilterBar();
    oabRenderTable();
  }

  function oabRenderLocalFilterBar() {
    const bar = oabEl('oabLocalFilterBar');
    if (!bar) return;
    const engine = new OABLocalFilterEngine(S.rows);
    /* v7.23 — PIVOT YEREL FİLTRELERİNDE ÇOKLU SEÇİM.

       Saha bulgusu (kullanıcı): "OAB pivot tablosundaki Klasman Tanımı gibi
       filtreleme alanlarında çoklu seçim yapmama izin ver."

       Süzme motoru zaten çoklu değeri destekliyordu (filtre bir Set'tir);
       kısıtlama yalnız arayüzdeydi — tek seçimli <select>. Season/MAG/Buyer
       Group için yazılan çoklu seçim bileşeni burada yeniden kullanılıyor,
       böylece ikinci bir seçim deseni doğmuyor. */
    S.localFilterOptions = {};
    const usable = oabAvailableLocalFilterFields(engine);
    const visible = oabLocalFilterFields(usable);
    bar.innerHTML = visible.map(field => {
      const values = engine.distinctValues(field);
      S.localFilterOptions[field] = values.map(value => ({ Ref: value, Name: value }));
      const active = S.localFilters[field];
      const count = active ? active.size : 0;
      const label = oabLocalFilterLabelText(field);
      return `<div class="oabLocalFilterField oabMultiField"><span class="oabLocalFilterFieldLabel">${oabEsc(field)}</span><div class="oabLocalFilterControl"><button type="button" class="oabMultiTrigger" data-oab-local-filter="${oabEsc(field)}" aria-haspopup="listbox" aria-expanded="false"><span class="oabMultiLabel${count ? ' hasValue' : ''}">${oabEsc(label)}</span><span class="oabMultiChevron" aria-hidden="true">▾</span></button><button type="button" class="oabLocalFilterRemoveBtn" data-oab-local-filter-remove="${oabEsc(field)}" aria-label="${oabEsc(oabT(`${field} filtresini kaldır`, `Remove ${field} filter`))}" title="${oabEsc(oabT('Filtreyi kaldır', 'Remove filter'))}">×</button></div>
      </div>`;
    }).join('') + `<button type="button" class="oabLocalFilterAddBtn" data-oab-local-filter-add aria-haspopup="menu"${usable.length ? '' : ' disabled'}><span aria-hidden="true">+</span>${oabEsc(oabT('Filtre ekle', 'Add filter'))}</button>`;
  }
  // Yerel filtre açılırı, üst filtrelerdeki bileşenin aynısıdır; yalnız
  // seçimi S.localFilters üzerine yazar ve PASS'e YENİ İSTEK ATMAZ —
  // hesaplama tamamen çekilmiş dataset üzerinde yapılır.
  function oabLocalFilterLabelText(field) {
    const active = S.localFilters[field];
    const count = active ? active.size : 0;
    if (!count) return oabT('Tümü', 'All');
    if (count === 1) return [...active][0];
    return oabT(`${count} seçili`, `${count} selected`);
  }
  // Etiketi YERİNDE günceller. Bar'ı baştan çizmek, açık popover'ın dayandığı
  // düğmeyi DOM'dan silip seçimi yarıda kesiyordu.
  function oabLocalFilterRenderLabel(field) {
    const triggers = document.querySelectorAll('.oabMultiTrigger[data-oab-local-filter]');
    for (const trigger of triggers) {
      if (trigger.dataset.oabLocalFilter !== field) continue;
      const el = trigger.querySelector('.oabMultiLabel');
      if (!el) continue;
      el.textContent = oabLocalFilterLabelText(field);
      el.classList.toggle('hasValue', Boolean(S.localFilters[field] && S.localFilters[field].size));
    }
  }
  function oabLocalFilterSpec(field) {
    return {
      trigger: '', label: '',
      options: () => (S.localFilterOptions && S.localFilterOptions[field]) || [],
      selected: () => [...(S.localFilters[field] || [])],
      setSelected: refs => {
        const list = [...new Set((refs || []).map(value => String(value)))];
        if (list.length) S.localFilters[field] = new Set(list);
        else delete S.localFilters[field];
        oabSaveLocalFilters(); // v7.31 — seçim bir sonraki açılışta geri gelsin
        oabLocalFilterRenderLabel(field);
      },
      // Bar'ı yeniden çizmeden yalnız sonucu tazeler; seçim penceresi açık kalır.
      onChange: () => { oabRenderTable(); },
    };
  }

  /* ===================================================================
     YEREL PİVOT FİLTRELERİ HATIRLANIR (v7.31)

     Kullanıcı talebi (birebir): "OAB alanı kullanıcı bazlı pivot alanı filtre
     seçimlerini bir sonraki açılışta hatırlasın. Klasman Tanımı, Tedarik
     Sepeti, Alım Bütçe Tipi gibi."

     Seçim KULLANICIYA özeldir ve 'lcw.oab.' önekiyle saklandığı için hesapla
     birlikte taşınır (başka bilgisayardan girince de durur).

     KAYITLI DEĞER KÖRÜ KÖRÜNE UYGULANMAZ. Yeni raporda artık bulunmayan bir
     değer geri yüklenirse pivot bomboş görünür ve kullanıcı sebebini göremez.
     Bu yüzden geri yükleme sırasında kayıtlı değerler o anki veride VAR OLAN
     değerlerle kesiştirilir; hiçbiri kalmazsa o alanın filtresi düşer. Düşen
     alanlar sayılır ve kullanıcıya bildirilir — sessizce farklı bir sonuç
     göstermek yerine. */
  const OAB_LOCAL_FILTER_PREF_KEY = 'lcw.oab.localFilters.v1';
  function oabStorageGet(key) {
    try {
      if (global.BLStorage && global.BLStorage.getItem) return global.BLStorage.getItem(key);
      return global.localStorage ? global.localStorage.getItem(key) : null;
    } catch (_) { return null; }
  }
  function oabStorageSet(key, value) {
    try {
      if (global.BLStorage && global.BLStorage.setItem) global.BLStorage.setItem(key, value);
      else if (global.localStorage) global.localStorage.setItem(key, value);
    } catch (_) { /* kota dolu: seçim ekranda çalışır, yalnız hatırlanmaz */ }
  }
  function oabSaveLocalFilters() {
    const payload = {};
    for (const [field, values] of Object.entries(S.localFilters || {})) {
      const list = [...(values || [])].map(String);
      if (list.length) payload[field] = list;
    }
    oabStorageSet(OAB_LOCAL_FILTER_PREF_KEY, JSON.stringify(payload));
  }
  function oabReadSavedLocalFilters() {
    try {
      const parsed = JSON.parse(oabStorageGet(OAB_LOCAL_FILTER_PREF_KEY) || '{}');
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch (_) { return {}; }
  }
  /* Kayıtlı seçimi o anki veriyle kesiştirir. Dönen 'dropped', artık veride
     bulunmadığı için uygulanamayan alanların listesidir. */
  function oabRestoreLocalFilters() {
    const saved = oabReadSavedLocalFilters();
    const fields = Object.keys(saved);
    if (!fields.length) return { restored: 0, dropped: [] };
    const engine = new OABLocalFilterEngine(S.rows);
    let restored = 0;
    const dropped = [];
    for (const field of fields) {
      if (!S.fields.includes(field)) { dropped.push(field); continue; }
      const available = new Set(engine.distinctValues(field).map(String));
      const keep = (saved[field] || []).map(String).filter(value => available.has(value));
      if (!keep.length) { dropped.push(field); continue; }
      S.localFilters[field] = new Set(keep);
      restored += 1;
    }
    return { restored, dropped };
  }

  const OAB_DEFAULT_LOCAL_FILTER_FIELDS = ['Klasman Grup Tanımı', 'Klasman Tanımı', 'Line Tanımı', 'Alım Bütçe Tipi', 'Fit', 'Persona', 'Siluet', 'Tedarik Sepeti'];
  const OAB_LOCAL_FILTER_FIELDS_PREF_KEY = 'lcw.oab.localFilterFields.v1';

  function oabAvailableLocalFilterFields(engine) {
    const candidates = OABDataUtils.availableLocalFilterFields(S.fields);
    return candidates.filter(field => !engine || engine.distinctValues(field).length > 0);
  }

  function oabReadSavedLocalFilterFields() {
    try {
      const raw = oabStorageGet(OAB_LOCAL_FILTER_FIELDS_PREF_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.map(String) : null;
    } catch (_) { return null; }
  }
  function oabSaveLocalFilterFields() {
    oabStorageSet(OAB_LOCAL_FILTER_FIELDS_PREF_KEY, JSON.stringify(S.localFilterFields || []));
  }
  function oabLocalFilterFields(usable) {
    const available = (Array.isArray(usable) ? usable : []).map(String);
    if (!Array.isArray(S.localFilterFields)) {
      const saved = oabReadSavedLocalFilterFields();
      S.localFilterFields = Array.isArray(saved)
        ? saved.filter(field => available.includes(field))
        : OAB_DEFAULT_LOCAL_FILTER_FIELDS.filter(field => available.includes(field));
    }
    S.localFilterFields = OABDataUtils.updateLocalFilterFields(S.localFilterFields, 'keep', '', available);
    return S.localFilterFields.slice();
  }
  function oabChangeLocalFilterField(field, action) {
    const usable = oabAvailableLocalFilterFields(new OABLocalFilterEngine(S.rows));
    S.localFilterFields = oabLocalFilterFields(usable);
    S.localFilterFields = OABDataUtils.updateLocalFilterFields(S.localFilterFields, action, field, usable);
    if (action === 'remove') {
      delete S.localFilters[field];
      oabSaveLocalFilters();
    }
    oabSaveLocalFilterFields();
  }

  function oabRenderTable() {
    const table = oabEl('oabTable');
    if (!table) return;
    const filtered = oabFilteredRows();
    table.parentElement?.querySelectorAll('.oabTableNote').forEach(note => note.remove());
    if (S.view === 'raw') { oabRenderRawTable(table, filtered); oabUpdateGroupButtons(null); return; }
    oabRenderPivotTable(table, filtered);
  }

  const OAB_MONTHS = Object.freeze({
    'ocak':1,'şubat':2,'subat':2,'mart':3,'nisan':4,'mayıs':5,'mayis':5,'haziran':6,'temmuz':7,'ağustos':8,'agustos':8,'eylül':9,'eylul':9,'ekim':10,'kasım':11,'kasim':11,'aralık':12,'aralik':12,
    'january':1,'jan':1,'february':2,'feb':2,'march':3,'mar':3,'april':4,'apr':4,'may':5,'june':6,'jun':6,'july':7,'jul':7,'august':8,'aug':8,'september':9,'sep':9,'october':10,'oct':10,'november':11,'nov':11,'december':12,'dec':12,
  });
  function oabTemporalSortKey(value) {
    if (value == null || value === '') return null;
    const d = oabParseDate(value);
    const text = String(value).trim();
    if (d && /\d{1,4}[.\/-]\d{1,2}|\d{1,2}[.\/-]\d{4}/.test(text)) return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
    const lower = text.toLocaleLowerCase('tr-TR');
    const tokens = lower.split(/[^a-zçğıöşü]+/i).filter(Boolean);
    const monthToken = tokens.find(token => OAB_MONTHS[token] != null);
    if (monthToken) {
      const yearMatch = text.match(/\b(19|20)\d{2}\b/);
      const year = yearMatch ? Number(yearMatch[0]) : 0;
      return year * 100 + OAB_MONTHS[monthToken];
    }
    return null;
  }
  function oabSmartCompare(a, b) {
    if (a == null || a === '') return (b == null || b === '') ? 0 : 1;
    if (b == null || b === '') return -1;
    const na = typeof a === 'number' ? a : toSafeNumber(a);
    const nb = typeof b === 'number' ? b : toSafeNumber(b);
    if (na != null && nb != null && /^[-+]?\s*[\d.,\s]+$/.test(String(a)) && /^[-+]?\s*[\d.,\s]+$/.test(String(b))) return na - nb;
    const ta = oabTemporalSortKey(a), tb = oabTemporalSortKey(b);
    if (ta != null && tb != null && ta !== tb) return ta - tb;
    return String(a).localeCompare(String(b), 'tr', { numeric: true, sensitivity: 'base' });
  }
  OABDataUtils.smartCompare = oabSmartCompare;

  function oabVisibleColumns(view, descriptors) {
    const hidden = S.hiddenColumns[view] || new Set();
    return descriptors.filter(d => !hidden.has(d.key));
  }
  /* Sütun genişliği tipi: minimum genişlik ALT HÜCRE içeriğine göre belirlenir,
     başlık uzunluğu hesaba girmez (uzun başlık daraltılınca satır kırar). */
  function oabPivotColumnType(descriptor) {
    if (descriptor.numeric) return String(descriptor.label || '').includes('%') ? 'pct' : 'num';
    const field = String(descriptor.sourceField || descriptor.label || '');
    if (/tarih|date/i.test(field)) return 'date';
    if (OABDataUtils.isLikelyCodeField(field)) return 'code';
    return 'text';
  }
  function oabRawColumnType(field, rows) {
    if (/tarih|date/i.test(field)) return 'date';
    if (OABDataUtils.isLikelyCodeField(field)) return 'code';
    if (OABDataUtils.isNumericField(rows, field)) return String(field).includes('%') ? 'pct' : 'num';
    return 'text';
  }
  /* Genişlikler descriptor key'i üzerinden kalıcıdır; Pivot ve Raw Data ayrı
     kapsamlarda tutulur, çünkü sütun kimlikleri farklıdır. */
  function oabAttachColumnResize(table, scope, columns) {
    try { global.BLTableColumnResize?.apply(table, { scope, columns }); }
    catch (error) { console.warn('OAB sütun genişliği uygulanamadı:', error); }
  }

  let oabColumnMenu = null;
  function oabCloseColumnMenu() {
    if (oabColumnMenu) { oabColumnMenu.remove(); oabColumnMenu = null; }
  }
  function oabOpenColumnMenu(event, view, currentKey, descriptors, rerender) {
    event.preventDefault(); event.stopPropagation();
    oabCloseColumnMenu();
    const hidden = S.hiddenColumns[view] || (S.hiddenColumns[view] = new Set());
    const current = descriptors.find(d => d.key === currentKey);
    const visibleCount = descriptors.filter(d => !hidden.has(d.key)).length;
    const hiddenDescriptors = descriptors.filter(d => hidden.has(d.key));
    const menu = document.createElement('div');
    menu.className = 'oabColumnContextMenu';
    menu.innerHTML = `<button type="button" data-hide${visibleCount <= 1 ? ' disabled' : ''}>${oabEsc(oabT('Sütunu gizle', 'Hide column'))}${current ? ` · ${oabEsc(current.label)}` : ''}</button>
      ${hiddenDescriptors.length ? `<div class="oabColumnContextTitle">${oabEsc(oabT('Gizli sütunları göster', 'Show hidden columns'))}</div>${hiddenDescriptors.map(d => `<button type="button" data-show="${oabEsc(d.key)}">${oabEsc(d.label)}</button>`).join('')}<button type="button" data-show-all>${oabEsc(oabT('Tüm sütunları göster', 'Show all columns'))}</button>` : ''}`;
    menu.style.left = `${Math.min(event.clientX, Math.max(8, window.innerWidth - 300))}px`;
    menu.style.top = `${Math.min(event.clientY, Math.max(8, window.innerHeight - 360))}px`;
    document.body.appendChild(menu); oabColumnMenu = menu;
    menu.querySelector('[data-hide]')?.addEventListener('click', () => { if (visibleCount > 1 && currentKey) hidden.add(currentKey); oabCloseColumnMenu(); rerender(); });
    menu.querySelectorAll('[data-show]').forEach(btn => btn.addEventListener('click', () => { hidden.delete(btn.dataset.show); oabCloseColumnMenu(); rerender(); }));
    menu.querySelector('[data-show-all]')?.addEventListener('click', () => { hidden.clear(); oabCloseColumnMenu(); rerender(); });
    const outside = e => { if (oabColumnMenu && !oabColumnMenu.contains(e.target)) { oabCloseColumnMenu(); document.removeEventListener('pointerdown', outside, true); } };
    setTimeout(() => document.addEventListener('pointerdown', outside, true), 0);
  }

  function oabIsOptionNameField(field) {
    return String(field || '').trim().toLocaleLowerCase('tr-TR') === 'option adı';
  }
  function oabOptionPlmLinkHtml(value) {
    const modelName = String(value == null ? '' : value).trim();
    if (!modelName) return '';
    const linkHtml = global.BLPlmModelLinks && typeof global.BLPlmModelLinks.html === 'function' ? global.BLPlmModelLinks.html : global.plmModelLinkHtml;
    if (typeof linkHtml === 'function') {
      try {
        const html = linkHtml(modelName, { allowNameMatch: true });
        if (html) return html;
      } catch (_) {}
    }
    return oabEsc(modelName);
  }
  function oabDataCellHtml(field, value, displayValue) {
    if (oabIsOptionNameField(field)) return oabOptionPlmLinkHtml(value);
    return oabEsc(displayValue == null ? '' : displayValue);
  }

  function oabRenderRawTable(table, rows) {
    const fields = S.fields.length ? S.fields : OABDataUtils.deriveFieldList(rows);
    const descriptors = fields.map(field => ({ key: field, label: field }));
    const visible = oabVisibleColumns('raw', descriptors);
    const limited = rows.slice(0, 500); // büyük dataset'te DOM'a binlerce satır basılmaz
    table.innerHTML = `<thead><tr>${visible.map(d => `<th data-oab-raw-key="${oabEsc(d.key)}">${oabEsc(d.label)}</th>`).join('')}</tr></thead>
      <tbody>${limited.map(row => `<tr>${visible.map(d => `<td${oabIsOptionNameField(d.key) ? ' class="oabOptionPlmCell"' : ''}>${oabDataCellHtml(d.key, row[d.key], oabRawDisplayValue(d.key, row[d.key]))}</td>`).join('')}</tr>`).join('')}</tbody>`;
    table.querySelectorAll('thead th[data-oab-raw-key]').forEach(th => th.addEventListener('contextmenu', event => oabOpenColumnMenu(event, 'raw', th.dataset.oabRawKey, descriptors, () => oabRenderRawTable(table, rows))));
    oabAttachColumnResize(table, 'oab.raw', visible.map(d => ({ key: d.key, label: d.label, type: oabRawColumnType(d.key, limited) })));
    if (rows.length > limited.length) {
      const note = document.createElement('div');
      note.className = 'oabTableNote';
      note.textContent = oabT(`İlk ${limited.length} satır gösteriliyor (toplam ${rows.length}).`, `Showing first ${limited.length} rows (of ${rows.length}).`);
      table.parentElement.appendChild(note);
    }
  }
  function oabRawDisplayValue(field, value) {
    if (value == null) return '';
    if (field.includes('%') && typeof value === 'number') return `${value.toLocaleString('tr-TR', { maximumFractionDigits: 2 })}%`;
    return value;
  }
  function oabValueResultKey(def) {
    const agg = def.agg || (OABDataUtils.isFormulaMetric(def.field) ? 'CALC' : 'SUM');
    return `${def.field}::${agg}`;
  }
  function oabPivotDescriptorValue(row, descriptor) { return row ? row[descriptor.key] : null; }
  function oabPivotRowPassesFilters(row, exceptKey = '') {
    for (const [key, filter] of Object.entries(S.pivotFilters || {})) {
      if (!filter || key === exceptKey) continue;
      const value = row[key];
      if (filter.kind === 'range') {
        const n = toSafeNumber(value);
        if (n == null) return false;
        if (filter.min != null && n < filter.min) return false;
        if (filter.max != null && n > filter.max) return false;
      } else if (filter.kind === 'values' && filter.values && filter.values.size) {
        if (!filter.values.has(String(value == null ? '' : value))) return false;
      }
    }
    return true;
  }
  function oabOpenPivotFilter(anchor, descriptor, displayRows) {
    if (!anchor || !descriptor) return;
    if (typeof closeHeaderFilter === 'function') closeHeaderFilter();
    if (descriptor.numeric) {
      const old = S.pivotFilters[descriptor.key];
      const panel = document.createElement('div');
      panel.className = 'colFilterPanel oabPivotFilterPanel';
      const rect = anchor.getBoundingClientRect();
      panel.style.left = `${Math.max(4, rect.left - 130)}px`; panel.style.top = `${rect.bottom + 4}px`;
      panel.innerHTML = `<div class="cfpRange"><div class="cfpRangeHead">${oabEsc(oabT('Değer aralığı', 'Value range'))}</div>
        <div class="oabPivotRangeGrid"><label>${oabEsc(oabT('En az', 'Minimum'))}<input type="text" inputmode="decimal" data-min value="${oabEsc(old && old.kind === 'range' && old.min != null ? old.min : '')}"></label><label>${oabEsc(oabT('En çok', 'Maximum'))}<input type="text" inputmode="decimal" data-max value="${oabEsc(old && old.kind === 'range' && old.max != null ? old.max : '')}"></label></div>
        <div class="cfpApplyRow"><button type="button" class="cfpRangeApply">${oabEsc(oabT('Uygula', 'Apply'))}</button><button type="button" class="numFilterClear cfpRangeClear">${oabEsc(oabT('Filtreyi Kaldır', 'Remove Filter'))}</button></div></div>`;
      document.body.appendChild(panel);
      const read = sel => { const raw = String(panel.querySelector(sel)?.value || '').trim().replace(',', '.'); return raw === '' ? null : (Number.isFinite(Number(raw)) ? Number(raw) : null); };
      const close = () => panel.remove();
      panel.querySelector('.cfpRangeApply')?.addEventListener('click', () => { let min = read('[data-min]'), max = read('[data-max]'); if (min != null && max != null && min > max) [min, max] = [max, min]; if (min == null && max == null) delete S.pivotFilters[descriptor.key]; else S.pivotFilters[descriptor.key] = { kind: 'range', min, max }; close(); oabRenderTable(); });
      panel.querySelector('.cfpRangeClear')?.addEventListener('click', () => { delete S.pivotFilters[descriptor.key]; close(); oabRenderTable(); });
      const outside = e => { if (!panel.contains(e.target) && e.target !== anchor) { close(); document.removeEventListener('pointerdown', outside, true); } };
      setTimeout(() => document.addEventListener('pointerdown', outside, true), 0);
      return;
    }
    const values = [...new Set(displayRows.map(row => String(oabPivotDescriptorValue(row, descriptor) ?? '')))].sort(oabSmartCompare);
    const existing = S.pivotFilters[descriptor.key];
    if (typeof openValueFilterPanel === 'function') {
      openValueFilterPanel({
        anchorEl: anchor,
        title: descriptor.label,
        values,
        selected: existing && existing.kind === 'values' ? existing.values : new Set(),
        labelFor: value => value === '' ? oabT('(boş)', '(blank)') : value,
        onApply: selected => { if (!selected || selected.size === 0 || selected.size === values.length) delete S.pivotFilters[descriptor.key]; else S.pivotFilters[descriptor.key] = { kind: 'values', values: new Set(selected) }; oabRenderTable(); },
        onRemove: () => { delete S.pivotFilters[descriptor.key]; oabRenderTable(); },
      });
    }
  }

  function oabPivotGroupKey(values) {
    return (values || []).map(value => String(value == null ? '' : value)).join('␟');
  }

  function defaultCollapsedPivotGroupKeys(rows, config) {
    const rowFields = Array.isArray(config && config.rows) ? config.rows : [];
    if (!rowFields.length) return [];
    const groups = new Map();
    (Array.isArray(rows) ? rows : []).forEach(row => {
      const values = rowFields.map(field => row && row[field] != null ? row[field] : '');
      const metric = fieldNumericValue(row, OAB_AUTO_COLLAPSE_ZERO_FIELD);
      for (let level = 0; level < values.length; level += 1) {
        const key = oabPivotGroupKey(values.slice(0, level + 1));
        const group = groups.get(key) || { total: 0, known: true };
        if (metric == null) group.known = false;
        else group.total += metric;
        groups.set(key, group);
      }
    });
    return [...groups].filter(([, group]) => group.known && group.total === 0).map(([key]) => key);
  }

  function oabSeedDefaultCollapsedGroups(rows, config) {
    const key = `${oabDataRevision}|${JSON.stringify(config || {})}`;
    if (S.autoCollapseZeroGroupsKey === key) return;
    S.autoCollapseZeroGroupsKey = key;
    S.collapsedGroups = new Set(defaultCollapsedPivotGroupKeys(rows, config));
  }

  function oabPivotAggregateMap(sourceRows, config) {
    const subtotalConfig = {
      rows: [],
      columns: (config && config.columns) || [],
      values: (config && config.values) || [],
      calculatedFields: (config && config.calculatedFields) || [],
    };
    const subtotal = new OABPivotEngine(sourceRows || []).compute(subtotalConfig);
    const byCol = new Map();
    subtotal.cells.forEach(cell => byCol.set(cell.colKey, cell.results));
    return byCol;
  }

  function oabBuildPivotBase(rows, config) {
    const pivot = new OABPivotEngine(rows).compute(config);
    const colKeys = [...new Set(pivot.cells.map(c => c.colKey))].sort(oabSmartCompare);
    const byRowKey = new Map();
    pivot.cells.forEach(cell => {
      if (!byRowKey.has(cell.rowKey)) byRowKey.set(cell.rowKey, { rowKey: cell.rowKey, rowValues: cell.rowValues, byCol: new Map(), sourceRows: [] });
      const group = byRowKey.get(cell.rowKey);
      group.byCol.set(cell.colKey, cell.results);
      if (Array.isArray(cell.sourceRows)) group.sourceRows.push(...cell.sourceRows);
    });
    const valueMetas = [
      ...pivot.valueDefs.map(def => {
        const valueKey = oabValueResultKey(def);
        const agg = def.agg || (OABDataUtils.isFormulaMetric(def.field) ? 'CALC' : 'SUM');
        return { valueKey, sourceField: def.field, agg, numeric: agg !== 'FIRST', calculated: false };
      }),
      ...pivot.calcFields.map(calc => ({ valueKey: calc.key, sourceField: '', agg: 'CALC', calculated: true })),
    ];
    const rowDescriptors = pivot.rowFields.map((field, i) => ({ key: `row:${i}:${field}`, label: field, numeric: false, rowIndex: i, sourceField: field }));
    const displayColKeys = colKeys.length && pivot.colFields.length ? colKeys : [''];
    const valueDescriptors = displayColKeys.flatMap(colKey => valueMetas.map(meta => ({
      key: `value:${colKey}::${meta.valueKey}`,
      label: pivot.colFields.length ? `${String(colKey || oabT('(boş)', '(blank)')).split('␟').join(' / ')} · ${meta.valueKey}` : meta.valueKey,
      numeric: meta.numeric !== false, colKey, valueKey: meta.valueKey, sourceField: meta.sourceField, agg: meta.agg, calculated: meta.calculated,
    })));
    const descriptors = [...rowDescriptors, ...valueDescriptors];
    const leaves = [...byRowKey.values()].map(group => {
      const display = {};
      rowDescriptors.forEach(d => { display[d.key] = group.rowValues[d.rowIndex]; });
      valueDescriptors.forEach(d => { const results = group.byCol.get(d.colKey) || {}; display[d.key] = results[d.valueKey]; });
      return { ...group, display };
    });
    return { pivot, colKeys: displayColKeys, rowDescriptors, valueDescriptors, descriptors, leaves };
  }

  function oabBuildPivotTree(leaves, rowFields) {
    const root = { level: -1, value: '', path: [], pathKey: '', children: new Map(), leaves: [] };
    for (const leaf of leaves) {
      root.leaves.push(leaf);
      let node = root;
      (rowFields || []).forEach((field, level) => {
        const value = leaf.rowValues[level];
        const key = String(value == null ? '' : value);
        if (!node.children.has(key)) {
          const path = [...node.path, value];
          node.children.set(key, { level, field, value, path, pathKey: oabPivotGroupKey(path), children: new Map(), leaves: [] });
        }
        node = node.children.get(key);
        node.leaves.push(leaf);
      });
    }
    return root;
  }

  function oabPivotRowFromAggregate(path, level, base, aggregateByCol, options = {}) {
    const out = {};
    base.rowDescriptors.forEach(d => { out[d.key] = d.rowIndex === level ? (path[d.rowIndex] ?? '') : ''; });
    base.valueDescriptors.forEach(d => { const results = aggregateByCol.get(d.colKey) || {}; out[d.key] = results[d.valueKey]; });
    out.__oabKind = options.kind || 'group';
    out.__oabLevel = level;
    out.__oabPathKey = options.pathKey || '';
    out.__oabPath = Array.isArray(path) ? path.slice() : [];
    out.__oabSourceRows = Array.isArray(options.sourceRows) ? options.sourceRows.slice() : [];
    out.__oabHasChildren = Boolean(options.hasChildren);
    out.__oabCollapsed = Boolean(options.collapsed);
    out.__oabSubtotal = Boolean(options.subtotal);
    out.__oabGrandTotal = Boolean(options.grandTotal);
    return out;
  }

  function oabBuildPivotViewModelUncached(rows, options = {}) {
    const config = S.pivotConfig || defaultPivotConfigClient();
    const base = oabBuildPivotBase(rows, config);
    if (!base.pivot.cells.length) return { ...base, displayRows: [], groupPathKeys: [], grouped: false };

    const visibleLeaves = base.leaves.filter(leaf => oabPivotRowPassesFilters(leaf.display));
    const sortDescriptor = base.descriptors.find(d => d.key === S.pivotSort.key);
    const sortDir = S.pivotSort.dir || 1;
    const grouped = config.grouped !== false && base.rowDescriptors.length > 0;
    const showSubtotals = config.showSubtotals !== false;
    const respectCollapse = options.respectCollapse !== false;
    if (grouped) oabSeedDefaultCollapsedGroups(rows, config);

    if (!grouped) {
      const displayRows = visibleLeaves.map(leaf => ({ ...leaf.display, __oabKind: 'leaf', __oabLevel: Math.max(0, base.rowDescriptors.length - 1), __oabPath: (leaf.rowValues || []).slice(), __oabSourceRows: (leaf.sourceRows || []).slice() }));
      displayRows.sort((a, b) => {
        if (sortDescriptor) return oabSmartCompare(a[sortDescriptor.key], b[sortDescriptor.key]) * sortDir;
        for (const d of base.rowDescriptors) { const cmp = oabSmartCompare(a[d.key], b[d.key]); if (cmp) return cmp; }
        return 0;
      });
      if (showSubtotals && visibleLeaves.length) {
        const sourceRows = visibleLeaves.flatMap(leaf => leaf.sourceRows || []);
        const aggregate = oabPivotAggregateMap(sourceRows, config);
        const grand = oabPivotRowFromAggregate([], 0, base, aggregate, { kind: 'grand', grandTotal: true, subtotal: true, sourceRows });
        if (base.rowDescriptors[0]) grand[base.rowDescriptors[0].key] = oabT('Genel Toplam', 'Grand Total');
        displayRows.push(grand);
      }
      return { ...base, displayRows, groupPathKeys: [], grouped: false, showSubtotals };
    }

    const tree = oabBuildPivotTree(visibleLeaves, base.pivot.rowFields);
    const displayRows = [];
    const groupPathKeys = [];

    function nodeDisplay(node) {
      const sourceRows = node.leaves.flatMap(leaf => leaf.sourceRows || []);
      const aggregate = oabPivotAggregateMap(sourceRows, config);
      return oabPivotRowFromAggregate(node.path, node.level, base, aggregate, {
        kind: node.children.size ? 'group' : 'leaf',
        pathKey: node.pathKey,
        hasChildren: node.children.size > 0,
        collapsed: S.collapsedGroups.has(node.pathKey),
        subtotal: node.children.size > 0 && showSubtotals,
        sourceRows,
      });
    }

    function sortNodes(nodes) {
      return nodes.sort((a, b) => {
        if (sortDescriptor && sortDescriptor.numeric) {
          const da = nodeDisplay(a), db = nodeDisplay(b);
          const cmp = oabSmartCompare(da[sortDescriptor.key], db[sortDescriptor.key]);
          if (cmp) return cmp * sortDir;
        }
        if (sortDescriptor && !sortDescriptor.numeric && sortDescriptor.rowIndex === a.level) {
          const cmp = oabSmartCompare(a.value, b.value);
          if (cmp) return cmp * sortDir;
        }
        return oabSmartCompare(a.value, b.value);
      });
    }

    function walk(node) {
      const children = sortNodes([...node.children.values()]);
      for (const child of children) {
        const hasChildren = child.children.size > 0;
        if (hasChildren) groupPathKeys.push(child.pathKey);
        const row = nodeDisplay(child);
        if (hasChildren && !showSubtotals) base.valueDescriptors.forEach(d => { row[d.key] = null; });
        displayRows.push(row);
        if (hasChildren && !(respectCollapse && S.collapsedGroups.has(child.pathKey))) walk(child);
      }
    }
    walk(tree);

    if (showSubtotals && visibleLeaves.length) {
      const sourceRows = visibleLeaves.flatMap(leaf => leaf.sourceRows || []);
      const aggregate = oabPivotAggregateMap(sourceRows, config);
      const grand = oabPivotRowFromAggregate([], 0, base, aggregate, { kind: 'grand', grandTotal: true, subtotal: true, sourceRows });
      if (base.rowDescriptors[0]) grand[base.rowDescriptors[0].key] = oabT('Genel Toplam', 'Grand Total');
      displayRows.push(grand);
    }
    return { ...base, displayRows, groupPathKeys, grouped: true, showSubtotals };
  }

  function oabBuildPivotViewModel(rows, options = {}) {
    const cacheKey=global.BLAnalysisCache?.key?global.BLAnalysisCache.key({data:oabDataRevision,rows:oabRowsKey(rows),config:S.pivotConfig,filters:S.pivotFilters,sort:S.pivotSort,collapsed:[...S.collapsedGroups].sort(),options}):`${oabDataRevision}|${oabRowsKey(rows)}|${JSON.stringify({config:S.pivotConfig,filters:S.pivotFilters,sort:S.pivotSort,collapsed:[...S.collapsedGroups].sort(),options})}`;
    const cached=oabPivotViewCache.get(cacheKey);if(cached)return cached;
    const model=oabBuildPivotViewModelUncached(rows,options);oabPivotViewCache.set(cacheKey,model);return model;
  }

  function oabUpdateGroupButtons(model) {
    const expand = oabEl('oabExpandAllBtn'), collapse = oabEl('oabCollapseAllBtn');
    const enabled = Boolean(S.view === 'pivot' && model && model.grouped && model.groupPathKeys && model.groupPathKeys.length);
    if (expand) { expand.hidden = !enabled; expand.disabled = !enabled || S.collapsedGroups.size === 0; }
    if (collapse) { collapse.hidden = !enabled; collapse.disabled = !enabled; }
  }

  function oabExpandAllGroups() {
    S.collapsedGroups.clear();
    oabRenderTable();
  }

  function oabCollapseAllGroups() {
    const model = oabBuildPivotViewModel(oabFilteredRows(), { respectCollapse: false });
    S.collapsedGroups = new Set(model.groupPathKeys || []);
    oabRenderTable();
  }

  function oabPivotCellHtml(row, descriptor) {
    const value = row[descriptor.key];
    if (!descriptor.numeric && row.__oabHasChildren && descriptor.rowIndex === row.__oabLevel) {
      const collapsed = Boolean(row.__oabCollapsed);
      const label = value == null || value === '' ? oabT('(boş)', '(blank)') : value;
      const labelHtml = oabIsOptionNameField(descriptor.label) ? oabOptionPlmLinkHtml(label) : oabEsc(label);
      return `<td class="oabPivotGroupCell${oabIsOptionNameField(descriptor.label) ? ' oabOptionPlmCell' : ''}"><button type="button" class="oabPivotGroupToggle" data-oab-group-key="${oabEsc(row.__oabPathKey)}" title="${oabEsc(collapsed ? oabT('Grubu genişlet', 'Expand group') : oabT('Grubu daralt', 'Collapse group'))}">${collapsed ? '▸' : '▾'}</button><strong>${labelHtml}</strong>${row.__oabSubtotal ? `<span class="oabPivotSubtotalTag">${oabEsc(oabT('Alt toplam', 'Subtotal'))}</span>` : ''}</td>`;
    }
    if (!descriptor.numeric && row.__oabGrandTotal && descriptor.rowIndex === 0) return `<td class="oabPivotGrandLabel"><strong>${oabEsc(value)}</strong></td>`;
    if (!descriptor.numeric && oabIsOptionNameField(descriptor.label)) return `<td class="oabOptionPlmCell">${oabOptionPlmLinkHtml(value)}</td>`;
    return `<td>${oabFormatPivotValue(value, descriptor.label)}</td>`;
  }

  const OAB_DRILL_ID_FIELDS = Object.freeze([
    'Sezon', 'Merch Alt Grup', 'Buyer Grup Tanımı', 'Klasman Grup Tanımı', 'Klasman Kod', 'Klasman Tanımı', 'Line Tanımı',
    'Option Adı', 'Renk Kodu', 'Renk Adı', 'Özel Kod', 'Alım Dönem', 'Sipariş Onaylama Ayı', 'Retail Depo Tarihi',
  ]);
  const OAB_DRILL_METRIC_DEPENDENCIES = Object.freeze({
    'Toplam WSSI Sipariş Miktarı': ['WSSI Sipariş Miktarı'],
    'Toplam Onaylı Sipariş Miktarı': ['Onaylı Sipariş Miktarı'],
    'Toplam Onaylanmış - Sipariş Geçilmemiş Adet': ['WSSI Sipariş Miktarı', 'Onaylı Sipariş Miktarı'],
    'Toplam Klasman Analize Konu Olan Toplam Adet': ['WSSI Sipariş Miktarı', 'Onaylı Sipariş Miktarı'],
  });

  function oabPivotCellSourceRows(row, descriptor, model) {
    let rows = Array.isArray(row && row.__oabSourceRows) ? row.__oabSourceRows.slice() : [];
    if (!rows.length || !descriptor || !descriptor.numeric || !model || !model.pivot || !model.pivot.colFields.length) return rows;
    const targetColKey = String(descriptor.colKey == null ? '' : descriptor.colKey);
    return rows.filter(source => oabPivotGroupKey(model.pivot.colFields.map(field => source ? source[field] : '')) === targetColKey);
  }

  function oabDrillContextText(row, descriptor, model) {
    if (row && row.__oabGrandTotal) return oabT('Genel Toplam', 'Grand Total');
    const path = Array.isArray(row && row.__oabPath) ? row.__oabPath : [];
    const parts = [];
    ((model && model.pivot && model.pivot.rowFields) || []).forEach((field, index) => {
      const value = path[index];
      if (value != null && String(value) !== '') parts.push(`${field}: ${value}`);
    });
    if (descriptor && descriptor.numeric && model && model.pivot && model.pivot.colFields.length) {
      const values = String(descriptor.colKey == null ? '' : descriptor.colKey).split('␟');
      model.pivot.colFields.forEach((field, index) => { if (values[index] != null && values[index] !== '') parts.push(`${field}: ${values[index]}`); });
    }
    return parts.join(' · ') || oabT('Seçili pivot hücresi', 'Selected pivot cell');
  }

  function oabDrillSummaryFields(rows, descriptor, model) {
    const available = new Set(OABDataUtils.deriveFieldList(rows || []));
    const candidates = [];
    const push = field => { const key = String(field || ''); if (key && available.has(key) && !candidates.includes(key)) candidates.push(key); };
    ((model && model.pivot && model.pivot.rowFields) || []).forEach(push);
    ((model && model.pivot && model.pivot.colFields) || []).forEach(push);
    OAB_DRILL_ID_FIELDS.forEach(push);
    const sourceField = descriptor && descriptor.sourceField;
    (OAB_DRILL_METRIC_DEPENDENCIES[sourceField] || []).forEach(push);
    ['Plan Sipariş Miktarı', 'Onaylı Sipariş Miktarı', 'PO Miktarı'].forEach(push);
    push(sourceField);
    if (!candidates.length) OABDataUtils.deriveFieldList(rows || []).slice(0, 12).forEach(push);
    return candidates;
  }

  function oabDrillSortRows(rows, descriptor) {
    const field = descriptor && descriptor.sourceField;
    if (!field || !OABDataUtils.isNumericField(rows || [], field)) return (rows || []).slice();
    return (rows || []).slice().sort((a, b) => {
      const av = fieldNumericValue(a, field), bv = fieldNumericValue(b, field);
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      return bv - av;
    });
  }

  function oabDrillCellText(field, value) {
    if (value == null) return '';
    if (String(field || '').includes('%') && typeof value === 'number') return `${value.toLocaleString('tr-TR', { maximumFractionDigits: 2 })}%`;
    if (typeof value === 'number') return value.toLocaleString('tr-TR', { maximumFractionDigits: 2 });
    return String(value);
  }

  function oabDrillFilterKey(value) {
    if (value == null || value === '') return '__OAB_BLANK__';
    if (value instanceof Date) return `date:${value.toISOString()}`;
    return `${typeof value}:${String(value)}`;
  }

  function oabDrillRowsForState(rows, searchText, filters, exceptField) {
    const terms = parseTableSearchTerms(searchText || '');
    const entries = filters instanceof Map ? [...filters.entries()] : [];
    return (rows || []).filter(source => {
      if (terms.length && !tableSearchMatches(Object.values(source || {}).join(' '),terms,{plainMode:'contains'})) return false;
      for (const [field, allowed] of entries) {
        if (field === exceptField || !allowed || !allowed.size) continue;
        if (!allowed.has(oabDrillFilterKey(source && source[field]))) return false;
      }
      return true;
    });
  }

  // Excel dışa aktarımında kaynak boş/null hücreleri GERÇEK boş hücre olarak
  // bırakılır. Boş string ('') SheetJS tarafından sharedStrings tablosuna
  // yazılır ve worksheet XML'inde <v>115</v> gibi bir shared-string indeksine
  // dönüşebilir. Bu sayı hücre DEĞERİ değildir; ancak ham XML karşılaştırmalarında
  // yanlışlıkla veri gibi algılanabilir. null döndürmek hücreyi hiç üretmez ve
  // PASS kaynağındaki boşluk semantiğini birebir korur.
  function oabExcelPreserveBlank(value) {
    return value == null || value === '' ? null : value;
  }
  function oabDrillExportCell(field, value) {
    const preserved = oabExcelPreserveBlank(value);
    if (preserved == null) return null;
    if (isLikelyCodeField(field)) return String(preserved);
    return preserved;
  }

  const OAB_DRILL_IMAGES_PREF_KEY = 'lcw.oab.drill.images.v1';
  function oabDrillImagesInitialState() {
    try {
      const stored = global.BLStorage && global.BLStorage.getItem ? global.BLStorage.getItem(OAB_DRILL_IMAGES_PREF_KEY) : global.localStorage && global.localStorage.getItem(OAB_DRILL_IMAGES_PREF_KEY);
      if (stored === '1' || stored === '0') return stored === '1';
    } catch (_) {}
    return false;
  }
  function oabSaveDrillImagesState(on) {
    try {
      if (global.BLStorage && global.BLStorage.setItem) global.BLStorage.setItem(OAB_DRILL_IMAGES_PREF_KEY, on ? '1' : '0');
      else if (global.localStorage) global.localStorage.setItem(OAB_DRILL_IMAGES_PREF_KEY, on ? '1' : '0');
    } catch (_) {}
  }
  function oabDrillImageIndex() {
    try { return global.BLDetailImages && typeof global.BLDetailImages.buildIndex === 'function' ? global.BLDetailImages.buildIndex() : null; }
    catch (_) { return null; }
  }
  function oabDrillModelIdentity(source) {
    const row = source || {};
    const styleName = row['Option Adı'] || row['Model Adı'] || row['Model Name'] || '';
    const rawPlmId = row['PLM ID'] || row['Plm Kod'] || row['PLM Kod'] || row['PLM Code'] || row.plmId || '';
    const plmId = global.BLDetailImages && typeof global.BLDetailImages.resolvePlmId === 'function'
      ? (global.BLDetailImages.resolvePlmId(rawPlmId, styleName) || String(rawPlmId || '').trim())
      : String(rawPlmId || '').trim();
    return {
      plmId,
      styleName,
      colourCode: row['Renk Kodu'] || row['Renk Kod'] || row.colourCode || '',
      colour: row['Renk Adı'] || row['Renk'] || row.colour || '',
      orderCode: row['Sipariş Kod'] || row['Sipariş Kodu'] || row['Order Code'] || row.orderCode || '',
    };
  }
  function oabDrillImageUrl(source, imageIndex) {
    if (!source || !imageIndex || !global.BLDetailImages || typeof global.BLDetailImages.urlFrom !== 'function') return '';
    try {
      const id = oabDrillModelIdentity(source);
      return global.BLDetailImages.urlFrom(imageIndex, {
        plmId: id.plmId,
        colourCode: id.colourCode,
        colour: id.colour,
        modelName: id.styleName,
      }) || '';
    } catch (_) { return ''; }
  }
  function oabDrillImageCellHtml(source, imageIndex) {
    const id = oabDrillModelIdentity(source);
    const url = oabDrillImageUrl(source, imageIndex);
    const title = oabT('Büyük önizleme için üzerine gelin', 'Hover for large preview');
    if (!global.BLDetailImages || typeof global.BLDetailImages.thumbHtml !== 'function') {
      if (!url) return `<td class="oabDrillImageCell"><span class="oabDrillImageEmpty">—</span></td>`;
      return `<td class="oabDrillImageCell"><img class="oabDrillModelThumb detailModelThumb" src="${oabEsc(url)}" alt="" loading="lazy" title="${oabEsc(title)}"></td>`;
    }
    const thumb = global.BLDetailImages.thumbHtml(
      url,
      { modelId: id.plmId || id.styleName, colourCode: id.colourCode, plmId: id.plmId, modelName: id.styleName, colour: id.colour },
      { classes: 'oabDrillModelThumb detailModelThumb', title, allowEmpty: true }
    );
    return `<td class="oabDrillImageCell">${thumb || `<span class="oabDrillImageEmpty">—</span>`}</td>`;
  }
  function oabDrillFieldsWithImage(fields, showImages) {
    const list = Array.isArray(fields) ? fields.slice() : [];
    if (!showImages) return list.map(field => ({ kind: 'field', field }));
    const out = []; let inserted = false;
    list.forEach(field => {
      out.push({ kind: 'field', field });
      if (!inserted && oabIsOptionNameField(field)) { out.push({ kind: 'image', field: '__OAB_IMAGE__' }); inserted = true; }
    });
    if (!inserted) out.unshift({ kind: 'image', field: '__OAB_IMAGE__' });
    return out;
  }

  function oabOpenPivotDetail(row, descriptor, model) {
    const sourceRows = oabDrillSortRows(oabPivotCellSourceRows(row, descriptor, model), descriptor);
    if (!sourceRows.length) { oabToast(oabT('Bu pivot hücresi için alt detay bulunamadı.', 'No drill-down detail was found for this pivot cell.')); return; }
    document.getElementById('_oabDrillModal')?.remove();
    const modal = document.createElement('div');
    modal.className = 'autoModalOverlay'; modal.id = '_oabDrillModal';
    const metricLabel = descriptor && descriptor.sourceField ? descriptor.sourceField : (descriptor && descriptor.label) || oabT('Pivot Detayı', 'Pivot Detail');
    const clickedValue = row ? row[descriptor.key] : null;
    const valueText = oabPivotPlainValue(clickedValue, descriptor && descriptor.label);
    const context = oabDrillContextText(row, descriptor, model);
    const summaryFields = oabDrillSummaryFields(sourceRows, descriptor, model);
    const allFields = OABDataUtils.deriveFieldList(sourceRows);
    modal.innerHTML = `<div class="autoModal oabDrillModal" role="dialog" aria-modal="true" aria-labelledby="_oabDrillTitle">
      <header><div class="oabDrillHeadText"><h3 id="_oabDrillTitle">${oabEsc(oabT('OAB Alt Detay', 'OAB Drill-down'))} · ${oabEsc(metricLabel)}</h3><p>${oabEsc(context)}</p></div><button type="button" data-oab-drill-close title="${oabEsc(oabT('Kapat', 'Close'))}">×</button></header>
      <div class="autoModalBody">
        <div class="oabDrillSummary"><span class="oabDrillChip">${oabEsc(oabT('Seçili değer', 'Selected value'))}<strong>${oabEsc(valueText)}</strong></span><span class="oabDrillChip">${oabEsc(oabT('Alt satır', 'Source rows'))}<strong>${sourceRows.length.toLocaleString(oabLang() ? 'en-GB' : 'tr-TR')}</strong></span>${descriptor && descriptor.agg ? `<span class="oabDrillChip">${oabEsc(oabT('Hesap', 'Aggregate'))}<strong>${oabEsc(descriptor.agg)}</strong></span>` : ''}</div>
        <div class="oabDrillToolbar"><input type="search" data-oab-drill-search placeholder="${oabEsc(oabT('Alt detayda ara…', 'Search drill-down…'))}"><button type="button" class="navActionBtn active" data-oab-drill-mode="summary">${oabEsc(oabT('Özet Alanlar', 'Key Fields'))}</button><button type="button" class="navActionBtn" data-oab-drill-mode="all">${oabEsc(oabT('Tüm Alanlar', 'All Fields'))}</button><button type="button" class="navActionBtn oabDrillImagesBtn" data-oab-drill-images aria-pressed="false">▣ ${oabEsc(oabT('Görselleri Göster', 'Show Images'))}</button><button type="button" class="navActionBtn oabDrillModelImagesBtn" data-oab-drill-model-images>↻ PLM SYNC</button><button type="button" class="navActionBtn oabDrillExportBtn" data-oab-drill-export>↗ ${oabEsc(oabT('Excel’e Aktar', 'Export Excel'))}</button><span class="oabDrillCount" data-oab-drill-count></span></div>
        <div class="oabDrillTableWrap"><table class="miniTable" data-oab-drill-table></table></div>
        <p class="oabDrillHint">${oabEsc(oabT('Sütun başlıklarındaki ▾ düğmesiyle CP tablosundaki gibi değer bazlı filtre uygulayabilir; başlığa tıklayarak sıralayabilirsiniz. Excel aktarımı aktif arama ve sütun filtrelerini dikkate alır.', 'Use the ▾ button in column headers to filter by values like the CP table, and click the header label to sort. Excel export respects the active search and column filters.'))}</p>
      </div>
      <footer><button type="button" class="tbtn" data-oab-drill-close>${oabEsc(oabT('Kapat', 'Close'))}</button></footer>
    </div>`;
    document.body.appendChild(modal);

    let mode = 'summary';
    let drillSort = { field: descriptor && descriptor.sourceField ? descriptor.sourceField : '', dir: -1 };
    const drillFilters = new Map();
    let drillFilterPanel = null;
    const search = modal.querySelector('[data-oab-drill-search]');
    const table = modal.querySelector('[data-oab-drill-table]');
    const count = modal.querySelector('[data-oab-drill-count]');
    const imagesBtn = modal.querySelector('[data-oab-drill-images]');
    let showImages = oabDrillImagesInitialState();
    let imageIndex = null;
    const syncImagesButton = () => {
      if (!imagesBtn) return;
      imagesBtn.classList.toggle('active', showImages);
      imagesBtn.setAttribute('aria-pressed', showImages ? 'true' : 'false');
      imagesBtn.innerHTML = `${showImages ? '▣' : '▢'} ${oabEsc(showImages ? oabT('Görselleri Gizle', 'Hide Images') : oabT('Görselleri Göster', 'Show Images'))}`;
    };
    syncImagesButton();

    const closeDrillFilterPanel = () => {
      if (drillFilterPanel) { drillFilterPanel.remove(); drillFilterPanel = null; }
    };
    const filteredRows = (exceptField = '') => oabDrillRowsForState(sourceRows, search && search.value, drillFilters, exceptField);
    const sortedFilteredRows = () => {
      const rows = filteredRows().slice();
      if (!drillSort.field) return rows;
      const dir = drillSort.dir === -1 ? -1 : 1;
      rows.sort((a, b) => dir * oabSmartCompare(a && a[drillSort.field], b && b[drillSort.field]));
      return rows;
    };

    const openDrillFilter = (field, anchor) => {
      closeDrillFilterPanel();
      const universe = filteredRows(field);
      const valueMap = new Map();
      universe.forEach(source => {
        const value = source && source[field];
        const key = oabDrillFilterKey(value);
        if (!valueMap.has(key)) valueMap.set(key, value);
      });
      const values = [...valueMap.entries()].sort((a, b) => oabSmartCompare(a[1], b[1]));
      const current = drillFilters.get(field);
      const panel = document.createElement('div');
      panel.className = 'colFilterPanel colFilterPanelModal oabDrillFilterPanel';
      panel.innerHTML = `<div class="cfpSortBar"><button type="button" class="cfpSortBtn" data-oab-drill-dir="1">${oabEsc(oabT('A→Z Sırala', 'Sort A→Z'))}</button><button type="button" class="cfpSortBtn" data-oab-drill-dir="-1">${oabEsc(oabT('Z→A Sırala', 'Sort Z→A'))}</button><button type="button" class="cfpClearCol" data-oab-drill-filter-clear>${oabEsc(oabT('Filtreyi Temizle', 'Clear Filter'))}</button></div>
        <input type="text" class="cfpSearch" placeholder="${oabEsc(oabT('Ara…', 'Search…'))}">
        <div class="cfpHeader"><button type="button" class="cfpAll" data-v="all">${oabEsc(oabT('Tümü', 'All'))}</button><button type="button" class="cfpAll" data-v="none">${oabEsc(oabT('Temizle', 'Clear'))}</button></div>
        <div class="cfpList">${values.map(([key, value]) => { const display = value == null || value === '' ? oabT('(boş)', '(blank)') : oabDrillCellText(field, value); const checked = !current || current.has(key); return `<label class="cfpItem" data-txt="${oabEsc(String(display).toLocaleLowerCase('tr-TR'))}"><input type="checkbox" value="${oabEsc(key)}" ${checked ? 'checked' : ''}> ${oabEsc(display)}</label>`; }).join('')}</div>
        <div class="cfpApplyRow"><button type="button" class="cfpApplySelection">${oabEsc(oabT('Uygula', 'Apply'))}</button><button type="button" class="numFilterClear" data-oab-drill-filter-remove>${oabEsc(oabT('Filtreyi Kaldır', 'Remove Filter'))}</button></div>`;
      document.body.appendChild(panel);
      drillFilterPanel = panel;
      const rect = anchor.getBoundingClientRect();
      const panelWidth = Math.min(380, Math.max(250, panel.offsetWidth || 280));
      panel.style.left = `${Math.max(8, Math.min(window.innerWidth - panelWidth - 8, rect.right - panelWidth))}px`;
      panel.style.top = `${Math.min(window.innerHeight - (panel.offsetHeight || 360) - 8, rect.bottom + 4)}px`;
      if (parseFloat(panel.style.top) < 8) panel.style.top = '8px';

      const listItems = () => [...panel.querySelectorAll('.cfpItem')];
      const visibleChecks = () => listItems().filter(item => item.style.display !== 'none').map(item => item.querySelector('input')).filter(Boolean);
      panel.querySelector('[data-v="all"]')?.addEventListener('click', () => visibleChecks().forEach(input => { input.checked = true; }));
      panel.querySelector('[data-v="none"]')?.addEventListener('click', () => visibleChecks().forEach(input => { input.checked = false; }));
      const filterSearch = panel.querySelector('.cfpSearch');
      filterSearch?.addEventListener('input', () => {
        const terms = parseTableSearchTerms(filterSearch.value || '');
        listItems().forEach(item => { item.style.display = tableSearchMatches(item.dataset.txt || '',terms,{plainMode:'contains'}) ? '' : 'none'; });
      });
      panel.querySelectorAll('[data-oab-drill-dir]').forEach(btn => btn.addEventListener('click', () => {
        drillSort = { field, dir: Number(btn.dataset.oabDrillDir) === -1 ? -1 : 1 };
        closeDrillFilterPanel(); render();
      }));
      panel.querySelector('[data-oab-drill-filter-clear]')?.addEventListener('click', () => {
        drillFilters.delete(field); closeDrillFilterPanel(); render();
      });
      panel.querySelector('[data-oab-drill-filter-remove]')?.addEventListener('click', () => {
        drillFilters.delete(field); closeDrillFilterPanel(); render();
      });
      panel.querySelector('.cfpApplySelection')?.addEventListener('click', () => {
        const selected = new Set([...panel.querySelectorAll('.cfpList input[type="checkbox"]:checked')].map(input => input.value));
        if (selected.size === values.length) drillFilters.delete(field);
        else drillFilters.set(field, selected);
        closeDrillFilterPanel(); render();
      });
      setTimeout(() => filterSearch?.focus(), 0);
    };

    const render = () => {
      closeDrillFilterPanel();
      const fields = mode === 'all' ? allFields : summaryFields;
      const columns = oabDrillFieldsWithImage(fields, showImages);
      const filtered = sortedFilteredRows();
      const shown = filtered.slice(0, 1000);
      if (showImages) imageIndex = oabDrillImageIndex();
      count.textContent = filtered.length > shown.length
        ? oabT(`${shown.length} / ${filtered.length} satır`, `${shown.length} / ${filtered.length} rows`)
        : oabT(`${filtered.length} satır`, `${filtered.length} rows`);
      table.innerHTML = `<thead><tr>${columns.map(col => {
        if (col.kind === 'image') return `<th class="oabDrillImageCell"><span class="thLabel">${oabEsc(oabT('Görsel', 'Image'))}</span></th>`;
        const field = col.field, active = drillFilters.has(field), arrow = drillSort.field === field ? (drillSort.dir === 1 ? '▲' : '▼') : '';
        return `<th class="${active ? 'columnFilterActive' : ''}" data-oab-drill-field="${oabEsc(field)}"><div class="thInner"><button type="button" class="oabDrillSortLabel thLabel" data-oab-drill-sort="${oabEsc(field)}">${oabEsc(field)}<span class="arrow">${arrow}</span></button><button type="button" class="thFilterBtn${active ? ' filterActive' : ''}" data-oab-drill-filter="${oabEsc(field)}" title="${oabEsc(oabT('Filtrele', 'Filter'))}">▾</button></div></th>`;
      }).join('')}</tr></thead><tbody>${shown.map(source => `<tr>${columns.map(col => {
        if (col.kind === 'image') return oabDrillImageCellHtml(source, imageIndex);
        const field = col.field, cls = `${descriptor && descriptor.sourceField === field ? ' oabDrillMetricCell' : ''}${oabIsOptionNameField(field) ? ' oabOptionPlmCell' : ''}`.trim();
        const content = oabIsOptionNameField(field) ? oabOptionPlmLinkHtml(source && source[field]) : oabEsc(oabDrillCellText(field, source && source[field]));
        return `<td${cls ? ` class="${cls}"` : ''}>${content}</td>`;
      }).join('')}</tr>`).join('')}</tbody>`;
      if (!shown.length) table.innerHTML = `<thead><tr>${columns.map(col => `<th>${oabEsc(col.kind === 'image' ? oabT('Görsel', 'Image') : col.field)}</th>`).join('')}</tr></thead><tbody><tr><td colspan="${Math.max(1, columns.length)}">${oabEsc(oabT('Eşleşen alt detay yok.', 'No matching drill-down rows.'))}</td></tr></tbody>`;
      table.querySelectorAll('[data-oab-drill-sort]').forEach(btn => btn.addEventListener('click', event => {
        event.stopPropagation();
        const field = btn.dataset.oabDrillSort;
        if (drillSort.field === field) drillSort.dir = drillSort.dir === 1 ? -1 : 1;
        else drillSort = { field, dir: 1 };
        render();
      }));
      table.querySelectorAll('[data-oab-drill-filter]').forEach(btn => btn.addEventListener('click', event => {
        event.stopPropagation(); openDrillFilter(btn.dataset.oabDrillFilter, btn);
      }));
      // OAB drill-down tablo gövdeleri her filtre/sıralama/render işleminde yeniden
      // üretildiği için görsel hover bağını render sonunda deterministik olarak kur.
      // MutationObserver yedek olarak kalır; bu çağrı, modal katmanında thumbnail'ların
      // CP/Koleksiyon ile aynı büyük model önizlemesini kesin olarak kullanmasını sağlar.
      if (showImages && global.BLDetailImages && typeof global.BLDetailImages.bindThumbs === 'function') {
        try { global.BLDetailImages.bindThumbs(table); } catch (_) {}
      }
      /* ORTAK MODEL VARLIK KAPSAMI. Alt detay yalnız "Option Adı"nı bilir;
         kanonik PLM ID'yi ortak katman çözer. Kapsam DOM'daki thumb'lardan
         değil GERÇEK satırlardan verilir: "Eksikleri Tamamla" tam da görseli
         OLMAYAN modelleri ister ve görsel sütunu kapalıyken de çalışmalıdır. */
      if (global.BLDetailImages && typeof global.BLDetailImages.registerScope === 'function') {
        try {
          global.BLDetailImages.registerScope(modal.querySelector('.autoModal'), {
            contextType: 'oab-drilldown',
            label: oabT('OAB Alt Detay', 'OAB Drill-down'),
            identities: filtered.map((source, index) => ({
              ...oabDrillModelIdentity(source),
              rowId: String(index),
              /* Görsel sütunu açıksa ekranın GERÇEĞİ bildirilir; kapalıysa
                 karar kanonik kayda bırakılır (null). */
              hasImage: showImages ? Boolean(oabDrillImageUrl(source, imageIndex)) : null,
            })),
            repaint: render,
          });
        } catch (err) { console.warn('OAB model varlık kapsamı kaydedilemedi:', err); }
      }
    };

    const exportDrill = () => {
      if (typeof XLSX === 'undefined') { oabToast(oabT('Excel kütüphanesi yüklenemedi.', 'Excel library could not be loaded.')); return; }
      const fields = mode === 'all' ? allFields : summaryFields;
      const rows = sortedFilteredRows();
      if (!rows.length) { oabToast(oabT('Excel’e aktarılacak alt detay yok.', 'There is no drill-down data to export.')); return; }
      try {
        const dataRows = rows.map(source => fields.map(field => oabDrillExportCell(field, source && source[field])));
        const ws = XLSX.utils.aoa_to_sheet([fields, ...dataRows], { cellDates: true });
        oabExcelApplyCommonFormatting(ws, fields, dataRows, null);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'OAB Alt Detay');
        const d = new Date(), pad = n => String(n).padStart(2, '0');
        const metric = oabExcelFilePart(metricLabel);
        const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}`;
        const fileName = `OAB_Alt_Detay_${metric}_${stamp}.xlsx`;
        XLSX.writeFile(wb, fileName, { compression: true });
        oabToast(oabT(`OAB alt detay Excel’e aktarıldı: ${fileName}`, `OAB drill-down exported to Excel: ${fileName}`));
      } catch (err) {
        oabToast(oabT(`OAB alt detay Excel aktarımı başarısız: ${String(err && err.message || err)}`, `OAB drill-down Excel export failed: ${String(err && err.message || err)}`));
      }
    };

    render();
    search?.addEventListener('input', render);
    modal.querySelectorAll('[data-oab-drill-mode]').forEach(btn => btn.addEventListener('click', () => {
      mode = btn.dataset.oabDrillMode === 'all' ? 'all' : 'summary';
      modal.querySelectorAll('[data-oab-drill-mode]').forEach(other => other.classList.toggle('active', other === btn));
      render();
    }));
    imagesBtn?.addEventListener('click', () => {
      showImages = !showImages;
      oabSaveDrillImagesState(showImages);
      syncImagesButton();
      render();
    });
    modal.querySelector('[data-oab-drill-export]')?.addEventListener('click', exportDrill);
    /* Güncel görünüm görsel eylemi: bu alt detaydan ÇIKMADAN eksik model
       görselleri tamamlanır. Kapsam OAB’a özel bir çözümleyiciden değil, ortak
       güncel görünüm kayıt defterinden gelir. */
    modal.querySelector('[data-oab-drill-model-images]')?.addEventListener('click', event => {
      global.BLModelAssets?.openCurrentViewImageAction?.(event.currentTarget);
    });
    const onDocumentMouseDown = event => {
      if (drillFilterPanel && !drillFilterPanel.contains(event.target) && !event.target.closest?.('[data-oab-drill-filter]')) closeDrillFilterPanel();
    };
    document.addEventListener('mousedown', onDocumentMouseDown);
    const close = () => { closeDrillFilterPanel(); document.removeEventListener('keydown', onKey); document.removeEventListener('mousedown', onDocumentMouseDown); modal.remove(); };
    const onKey = event => { if (event.key === 'Escape') { if (drillFilterPanel) closeDrillFilterPanel(); else close(); } };
    document.addEventListener('keydown', onKey);
    modal.querySelectorAll('[data-oab-drill-close]').forEach(btn => btn.addEventListener('click', close));
    let downOnBackdrop = false;
    modal.addEventListener('pointerdown', event => { downOnBackdrop = event.target === modal; });
    modal.addEventListener('pointerup', event => { if (downOnBackdrop && event.target === modal) close(); downOnBackdrop = false; });
    setTimeout(() => search?.focus(), 0);
  }

  function oabRenderPivotTable(table, rows) {
    const model = oabBuildPivotViewModel(rows, { respectCollapse: true });
    if (!model.displayRows.length) {
      table.innerHTML = `<tbody><tr><td>${oabEsc(oabT('Veri yok.', 'No data.'))}</td></tr></tbody>`;
      oabUpdateGroupButtons(model);
      return;
    }
    const visible = oabVisibleColumns('pivot', model.descriptors);
    table.innerHTML = `<thead><tr>${visible.map(d => {
      const arrow = S.pivotSort.key === d.key ? (S.pivotSort.dir === 1 ? '▲' : '▼') : '';
      const active = S.pivotFilters[d.key] ? ' filterActive' : '';
      return `<th data-oab-pivot-key="${oabEsc(d.key)}" class="${S.pivotFilters[d.key] ? 'columnFilterActive' : ''}"><div class="thInner"><span class="thLabel">${oabEsc(d.label)}<span class="arrow">${arrow}</span></span><button type="button" class="thFilterBtn${active}" title="${oabEsc(oabT('Filtrele', 'Filter'))}">▾</button></div></th>`;
    }).join('')}</tr></thead><tbody>${model.displayRows.map(row => {
      const cls = row.__oabGrandTotal ? 'oabPivotGrandTotalRow' : (row.__oabSubtotal ? 'oabPivotSubtotalRow' : (row.__oabHasChildren ? 'oabPivotGroupRow' : ''));
      return `<tr class="${cls}" data-oab-group-level="${row.__oabLevel == null ? '' : row.__oabLevel}">${visible.map(d => oabPivotCellHtml(row, d)).join('')}</tr>`;
    }).join('')}</tbody>`;

    table.querySelectorAll('tbody tr').forEach((tr, rowIndex) => {
      [...tr.children].forEach((td, colIndex) => {
        td.dataset.oabDrillRow = String(rowIndex);
        td.dataset.oabDrillCol = String(colIndex);
        td.classList.add('oabPivotDrillCell');
        td.title = oabT('Alt detayı görmek için çift tıklayın', 'Double-click to see drill-down details');
        td.addEventListener('dblclick', event => {
          if (event.target && event.target.closest && event.target.closest('[data-oab-group-key]')) return;
          event.preventDefault(); event.stopPropagation();
          const pivotRow = model.displayRows[rowIndex], descriptor = visible[colIndex];
          if (pivotRow && descriptor) oabOpenPivotDetail(pivotRow, descriptor, model);
        });
      });
    });

    table.querySelectorAll('[data-oab-group-key]').forEach(btn => btn.addEventListener('click', event => {
      event.stopPropagation();
      const key = btn.dataset.oabGroupKey || '';
      if (!key) return;
      if (S.collapsedGroups.has(key)) S.collapsedGroups.delete(key); else S.collapsedGroups.add(key);
      oabRenderTable();
    }));
    table.querySelectorAll('thead th[data-oab-pivot-key]').forEach(th => {
      const descriptor = model.descriptors.find(d => d.key === th.dataset.oabPivotKey); if (!descriptor) return;
      th.querySelector('.thLabel')?.addEventListener('click', event => { event.stopPropagation(); S.pivotSort = { key: descriptor.key, dir: S.pivotSort.key === descriptor.key ? -S.pivotSort.dir : 1 }; oabRenderTable(); });
      th.querySelector('.thFilterBtn')?.addEventListener('click', event => {
        event.stopPropagation();
        const candidates = model.leaves.map(leaf => leaf.display).filter(row => oabPivotRowPassesFilters(row, descriptor.key));
        oabOpenPivotFilter(event.currentTarget, descriptor, candidates);
      });
      th.addEventListener('contextmenu', event => oabOpenColumnMenu(event, 'pivot', descriptor.key, model.descriptors, () => oabRenderPivotTable(table, rows)));
    });
    oabAttachColumnResize(table, 'oab.pivot', visible.map(d => ({ key: d.key, label: d.label, type: oabPivotColumnType(d) })));
    oabUpdateGroupButtons(model);
  }
  function oabPivotPlainValue(value, label) {
    if (value == null) return '—';
    if (typeof value === 'number') {
      const formatted = value.toLocaleString('tr-TR', { maximumFractionDigits: String(label || '').includes('%') ? 1 : 2 });
      return String(label || '').includes('%') ? `${formatted}%` : formatted;
    }
    return String(value);
  }
  function oabFormatPivotValue(value, label) { return oabEsc(oabPivotPlainValue(value, label)); }


  function oabExcelColumnWidths(headers, rows) {
    return (headers || []).map((header, colIndex) => {
      let width = Math.max(10, Math.min(34, String(header || '').length + 2));
      for (const row of (rows || []).slice(0, 120)) {
        const value = Array.isArray(row) ? row[colIndex] : '';
        if (value == null) continue;
        width = Math.max(width, Math.min(34, String(value).length + 2));
      }
      return { wch: width };
    });
  }

  function oabExcelApplyCommonFormatting(ws, headers, dataRows, rowMeta) {
    if (!ws || !ws['!ref']) return;
    const range = XLSX.utils.decode_range(ws['!ref']);
    const headerStyle = { font: { bold: true, color: { rgb: 'FFFFFFFF' } }, fill: { patternType: 'solid', fgColor: { rgb: 'FF17324D' } }, alignment: { vertical: 'center' } };
    const subtotalStyle = { font: { bold: true }, fill: { patternType: 'solid', fgColor: { rgb: 'FFEAF0F6' } } };
    const grandStyle = { font: { bold: true, color: { rgb: 'FFFFFFFF' } }, fill: { patternType: 'solid', fgColor: { rgb: 'FF27445F' } } };
    for (let c = range.s.c; c <= range.e.c; c++) {
      const cell = ws[XLSX.utils.encode_cell({ r: 0, c })];
      if (cell) cell.s = headerStyle;
    }
    for (let r = 1; r <= range.e.r; r++) {
      const meta = rowMeta && rowMeta[r - 1];
      for (let c = range.s.c; c <= range.e.c; c++) {
        const cell = ws[XLSX.utils.encode_cell({ r, c })];
        if (!cell) continue;
        const header = headers[c] || '';
        if (isLikelyCodeField(header)) { cell.t = 's'; cell.v = String(cell.v == null ? '' : cell.v); cell.z = '@'; }
        if (String(header).includes('%') && cell.t === 'n') cell.z = '0.0"%"';
        if (meta && meta.grand) cell.s = grandStyle;
        else if (meta && meta.subtotal) cell.s = subtotalStyle;
      }
    }
    ws['!autofilter'] = { ref: XLSX.utils.encode_range({ r: 0, c: 0 }, { r: Math.max(0, range.e.r), c: Math.max(0, range.e.c) }) };
    ws['!cols'] = oabExcelColumnWidths(headers, dataRows);
  }

  function oabExcelFilePart(value) {
    return String(value == null ? '' : value).trim().replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, '_').slice(0, 70) || 'OAB';
  }

  // v7.20 — dosya adı için seçim özeti. Tek seçimde ADI, çoklu seçimde
  // "3secim" biçiminde sayı yazılır; 40 Buyer Group adını dosya adına dizmek
  // Windows'ta kullanılamaz uzunluklar üretirdi.
  function oabSelectionFileLabel(kind) {
    const spec = OAB_MULTI[kind];
    if (!spec) return '';
    const selected = spec.selected();
    if (!selected.length) return '';
    if (selected.length === 1) {
      const match = spec.options().find(opt => String(oabOptionRef(opt)) === String(selected[0]));
      return match ? oabOptionLabel(match) : String(selected[0]);
    }
    if (kind === 'buyerGroup' && S.allBuyerGroups) return `tum${selected.length}`;
    return `${selected.length}secim`;
  }

  function oabRawExportMatrix(rows) {
    const fields = S.fields.length ? S.fields.slice() : OABDataUtils.deriveFieldList(rows);
    const dataRows = (rows || []).map(row => fields.map(field => {
      const value = oabExcelPreserveBlank(row ? row[field] : null);
      if (value == null) return null;
      if (isLikelyCodeField(field)) return String(value);
      return value;
    }));
    return { headers: fields, dataRows };
  }

  function oabPivotExportMatrix(rows) {
    const model = oabBuildPivotViewModel(rows, { respectCollapse: false });
    const descriptors = oabVisibleColumns('pivot', model.descriptors);
    const headers = descriptors.map(d => d.label);
    const dataRows = model.displayRows.map(row => descriptors.map(d => oabExcelPreserveBlank(row[d.key])));
    const rowMeta = model.displayRows.map(row => ({ subtotal: Boolean(row.__oabSubtotal), grand: Boolean(row.__oabGrandTotal), level: row.__oabLevel || 0 }));
    return { model, descriptors, headers, dataRows, rowMeta };
  }

  async function oabExportExcel() {
    if (!S.rows.length) { oabToast(oabT('Excel’e aktarılacak OAB verisi yok.', 'There is no OAB data to export.')); return; }
    if (typeof XLSX === 'undefined') { oabToast(oabT('Excel kütüphanesi yüklenemedi.', 'Excel library could not be loaded.')); return; }
    try {
      const filteredRows = oabFilteredRows();
      const raw = oabRawExportMatrix(filteredRows);
      const pivot = oabPivotExportMatrix(filteredRows);
      const wb = XLSX.utils.book_new();
      const wsRaw = XLSX.utils.aoa_to_sheet([raw.headers, ...raw.dataRows], { cellDates: true });
      oabExcelApplyCommonFormatting(wsRaw, raw.headers, raw.dataRows, null);
      XLSX.utils.book_append_sheet(wb, wsRaw, 'OAB Raw Data');

      const pivotRows = pivot.dataRows.length ? pivot.dataRows : [[oabT('Veri yok', 'No data')]];
      const pivotHeaders = pivot.headers.length ? pivot.headers : [oabT('Pivot', 'Pivot')];
      const wsPivot = XLSX.utils.aoa_to_sheet([pivotHeaders, ...pivotRows], { cellDates: true });
      oabExcelApplyCommonFormatting(wsPivot, pivotHeaders, pivotRows, pivot.rowMeta);
      if (pivot.model && pivot.model.grouped) {
        wsPivot['!rows'] = [{}].concat((pivot.rowMeta || []).map(meta => ({ level: Math.max(0, Math.min(7, Number(meta.level) || 0)) })));
      }
      XLSX.utils.book_append_sheet(wb, wsPivot, 'OAB Pivot');

      const d = new Date(), pad = n => String(n).padStart(2, '0');
      const season = oabExcelFilePart(oabSelectionFileLabel('season'));
      const mag = oabExcelFilePart(oabSelectionFileLabel('mag'));
      const buyer = oabExcelFilePart(oabSelectionFileLabel('buyerGroup'));
      const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}`;
      const fileName = `OAB_${season}_${mag}_${buyer}_${stamp}.xlsx`;
      XLSX.writeFile(wb, fileName, { compression: true });
      oabToast(oabT(`OAB Raw Data ve Pivot Excel’e aktarıldı: ${fileName}`, `OAB Raw Data and Pivot exported to Excel: ${fileName}`));
    } catch (err) {
      oabToast(oabT(`OAB Excel dışa aktarımı başarısız: ${String(err && err.message || err)}`, `OAB Excel export failed: ${String(err && err.message || err)}`));
    }
  }

  function oabSwitchView(view) {
    S.view = view;
    document.querySelectorAll('[data-oab-view]').forEach(btn => btn.classList.toggle('active', btn.dataset.oabView === view));
    oabRenderTable();
  }

  function oabMetadataInfoHtml() {
    const info = S.metadataInfo;
    if (!info) return '';
    let generated = info.generatedAt || '';
    if (generated) {
      try { generated = new Date(generated).toLocaleString(oabLang() ? 'en-GB' : 'tr-TR'); } catch (_) { /* olduğu gibi göster */ }
    }
    const counts = info.counts || {};
    const summary = [
      counts.seasons != null ? `${counts.seasons} Season` : '',
      counts.uniqueMags != null ? `${counts.uniqueMags} MAG` : '',
      counts.uniqueBuyerGroups != null ? `${counts.uniqueBuyerGroups} Buyer Group` : '',
    ].filter(Boolean).join(' · ');
    return `<div class="oabSettingsHint"><strong>${oabEsc(oabT('OAB Filtre Metadata', 'OAB Filter Metadata'))}</strong><br>${oabEsc(summary)}${generated ? `<br>${oabEsc(oabT('Son güncelleme', 'Last updated'))}: ${oabEsc(generated)}` : ''}</div>`;
  }

  /* ---------------------------------------------------------- AYARLAR MODALI */
  // v6.58 — Önceki sürüm modalı STATİK HTML'de #oabSettingsModalOverlay olarak
  // tanımlayıp hidden attribute'uyla açıp kapatıyordu. Bu YANLIŞTI: element
  // hem [hidden] hem .autoModalOverlay{display:grid;...} taşıyordu; ikisi de
  // aynı özgüllükte (0,1,0) olduğu için SAYFA CSS'İ (özgüllükte eşitlik
  // durumunda sonra gelen kazanır) tarayıcının [hidden]{display:none}
  // kuralını EZDİ — modal uygulama açılır açılmaz, hiçbir zaman gizlenmeden
  // görünür kaldı, içeriği de (yalnız açma fonksiyonu çağrıldığında dolan
  // oabSettingsBody) hiç doldurulmadı. Düzeltme: automations.js'teki KANITLI
  // desen — modal yalnız GEREKTİĞİNDE document.createElement ile oluşturulur,
  // kapatılınca DOM'dan tamamen kaldırılır (remove()); statik/gizli bir kopya
  // hiçbir zaman DOM'da beklemez.
  function oabSettingsFieldPool(config) {
    // Ayarlar, rapor yüklendikten sonra response'taki GERÇEK tablo başlıklarını
    // kullanır. Mevcut config'te olup o anki dataset'te görünmeyen alanları da
    // sessizce kaybetmemek için havuzun sonuna ekleriz.
    const configured = [];
    ((config && config.rows) || []).forEach(field => configured.push(field));
    ((config && config.columns) || []).forEach(field => configured.push(field));
    ((config && config.values) || []).forEach(def => { if (def && def.field) configured.push(def.field); });
    return [...new Set([...(S.fields || []), ...configured].filter(Boolean))];
  }

  function oabFieldOptionsHtml(fields, selected) {
    const list = Array.isArray(fields) ? fields : [];
    if (!list.length) return `<option value="">${oabEsc(oabT('Alan yok', 'No fields'))}</option>`;
    return list.map(field => `<option value="${oabEsc(field)}"${field === selected ? ' selected' : ''}>${oabEsc(field)}</option>`).join('');
  }

  function oabConfigActionsHtml() {
    return `<div class="oabConfigActions">
      <button type="button" class="oabConfigIconBtn" data-oab-config-move="-1" title="${oabEsc(oabT('Yukarı taşı', 'Move up'))}" aria-label="${oabEsc(oabT('Yukarı taşı', 'Move up'))}">↑</button>
      <button type="button" class="oabConfigIconBtn" data-oab-config-move="1" title="${oabEsc(oabT('Aşağı taşı', 'Move down'))}" aria-label="${oabEsc(oabT('Aşağı taşı', 'Move down'))}">↓</button>
      <button type="button" class="oabConfigIconBtn danger" data-oab-config-remove title="${oabEsc(oabT('Sil', 'Remove'))}" aria-label="${oabEsc(oabT('Sil', 'Remove'))}">×</button>
    </div>`;
  }

  function oabPivotAxisRowHtml(field, axis, fields) {
    return `<div class="oabPivotAxisRow oabConfigRow" draggable="true" data-axis="${oabEsc(axis)}">
      <span class="oabConfigDrag" aria-hidden="true">⋮⋮</span>
      <select class="oabPivotAxisField">${oabFieldOptionsHtml(fields, field)}</select>
      ${oabConfigActionsHtml()}
    </div>`;
  }

  function oabRefreshConfigOrderButtons(list) {
    if (!list) return;
    const rows = [...list.querySelectorAll('.oabConfigRow')];
    rows.forEach((row, index) => {
      const up = row.querySelector('[data-oab-config-move="-1"]');
      const down = row.querySelector('[data-oab-config-move="1"]');
      if (up) up.disabled = index === 0;
      if (down) down.disabled = index === rows.length - 1;
    });
  }

  function oabFirstUnusedField(list, fields, selector) {
    const used = new Set([...list.querySelectorAll(selector)].map(select => select.value).filter(Boolean));
    return (fields || []).find(field => !used.has(field)) || (fields || [])[0] || '';
  }

  function oabMoveConfigRow(row, direction) {
    if (!row || !row.parentElement) return;
    const parent = row.parentElement;
    if (direction < 0 && row.previousElementSibling) parent.insertBefore(row, row.previousElementSibling);
    if (direction > 0 && row.nextElementSibling) parent.insertBefore(row.nextElementSibling, row);
    oabRefreshConfigOrderButtons(parent);
  }

  function oabOpenSettings() {
    document.getElementById('_oabSettingsModal')?.remove();
    const config = S.pivotConfig || defaultPivotConfigClient();
    const allFields = oabSettingsFieldPool(config);
    // Pivot Values artık Excel benzeri biçimde hem sayısal ölçüleri hem de
    // mevcut metin alanlarını (örn. Plan Başlangıç Ayı / Klasman Tanımı)
    // destekler. Metin alanları FIRST/COUNT ile, sayısallar normal aggregate
    // seçenekleriyle çalışır. Alanlar response/model havuzundan gelir.
    const valueFields = allFields.slice();
    const modal = document.createElement('div');
    modal.id = '_oabSettingsModal';
    modal.className = 'autoModalOverlay';
    modal.innerHTML = `<div class="autoModal oabSettingsModal">
      <header><h3>${oabEsc(oabT('OAB Ayarları', 'OAB Settings'))}</h3><button type="button" data-oab-settings-close>×</button></header>
      <div class="autoModalBody">
        ${oabMetadataInfoHtml()}
        <label class="autoField"><span>${oabEsc(oabT('Cache süresi (dakika)', 'Cache duration (minutes)'))}</span>
          <input type="number" id="oabTtlInput" min="1" max="1440" value="${oabEsc(S.settings.ttlMinutes || 30)}">
        </label>

        <div class="oabPivotBehaviorGrid">
          <label class="oabCheckField"><input type="checkbox" id="oabGroupedViewInput"${config.grouped !== false ? ' checked' : ''}><span>${oabEsc(oabT('Gruplu pivot görünümü', 'Grouped pivot view'))}</span></label>
          <label class="oabCheckField"><input type="checkbox" id="oabShowSubtotalsInput"${config.showSubtotals !== false ? ' checked' : ''}><span>${oabEsc(oabT('Alt toplamları ve genel toplamı göster', 'Show subtotals and grand total'))}</span></label>
        </div>

        <div class="oabSettingsSection">
          <div class="oabSettingsSectionHead">
            <span>${oabEsc(oabT('Pivot Satırları', 'Pivot Rows'))}</span>
            <button type="button" class="navActionBtn" id="oabAddRowBtn">+ ${oabEsc(oabT('Alan ekle', 'Add field'))}</button>
          </div>
          <div class="oabPivotConfigList" id="oabPivotRowsList">${(config.rows || []).map(field => oabPivotAxisRowHtml(field, 'rows', allFields)).join('')}</div>
        </div>

        <div class="oabSettingsSection">
          <div class="oabSettingsSectionHead">
            <span>${oabEsc(oabT('Pivot Sütunları', 'Pivot Columns'))}</span>
            <button type="button" class="navActionBtn" id="oabAddColumnBtn">+ ${oabEsc(oabT('Alan ekle', 'Add field'))}</button>
          </div>
          <div class="oabPivotConfigList" id="oabPivotColsList">${(config.columns || []).map(field => oabPivotAxisRowHtml(field, 'columns', allFields)).join('')}</div>
        </div>

        <div class="oabSettingsSection">
          <div class="oabSettingsSectionHead">
            <span>${oabEsc(oabT('Pivot Değerleri', 'Pivot Values'))}</span>
            <button type="button" class="navActionBtn" id="oabAddValueBtn">+ ${oabEsc(oabT('Değer ekle', 'Add value'))}</button>
          </div>
          <div class="oabPivotConfigList" id="oabPivotValuesList">${(config.values || []).map((v, i) => oabPivotValueRowHtml(v, i, valueFields)).join('')}</div>
        </div>

        <p class="oabSettingsHint">${oabEsc(oabT(
          S.rows.length
            ? 'Satır alanlarının sırası gruplama hiyerarşisini belirler: örneğin önce Sipariş Onaylama Ayı, sonra Klasman seçerseniz aylar tek grup halinde görünür ve klasmanlar altında açılır. Gruplar daraltılıp genişletilebilir; alt toplamlar her seviyede yeniden hesaplanır. Pivot Values tüm OAB alanlarını kullanabilir; sayısal alanlar SUM/AVG gibi, metin alanları FIRST/COUNT ile çalışır.'
            : 'Henüz OAB verisi yüklenmediği için yalnız kayıtlı pivot alanları gösteriliyor. OAB verisini çektikten sonra tüm tablo başlıkları seçim listelerinde kullanılabilir.',
          S.rows.length
            ? 'The order of Row fields defines the grouping hierarchy: for example, Approval Month followed by Classification groups months once and expands classifications underneath. Groups can be collapsed/expanded and subtotals are recalculated at every level. Pivot Values can use all OAB fields; numeric fields use SUM/AVG and text fields use FIRST/COUNT.'
            : 'No OAB data is loaded yet, so only saved pivot fields are shown. After retrieving OAB data, all table headers become available in the selectors.'
        ))}</p>
      </div>
      <footer><button type="button" class="tbtn" data-oab-settings-reset>${oabEsc(oabT('Pivot Varsayılanına Dön', 'Reset Pivot'))}</button><button type="button" class="tbtn" data-oab-settings-close>${oabEsc(oabT('Vazgeç', 'Cancel'))}</button><button type="button" class="tbtn primary" data-oab-settings-save>${oabEsc(oabT('Kaydet', 'Save'))}</button></footer>
    </div>`;
    document.body.appendChild(modal);

    modal.querySelectorAll('[data-oab-settings-close]').forEach(btn => btn.addEventListener('click', () => modal.remove()));
    // Modal yalnız BASMA ve BIRAKMA işlemlerinin ikisi de backdrop üzerinde
    // gerçekleşirse kapanır. İçeride basıp fareyi dışarı sürükleyerek bırakmak
    // artık ayarlar penceresini yanlışlıkla kapatmaz.
    let pressedOnBackdrop = false;
    modal.addEventListener('pointerdown', event => { pressedOnBackdrop = event.target === modal; });
    modal.addEventListener('pointerup', event => { if (pressedOnBackdrop && event.target === modal) modal.remove(); pressedOnBackdrop = false; });

    const rowList = modal.querySelector('#oabPivotRowsList');
    const colList = modal.querySelector('#oabPivotColsList');
    const valueList = modal.querySelector('#oabPivotValuesList');

    const refreshOrderButtons = () => {
      oabRefreshConfigOrderButtons(rowList);
      oabRefreshConfigOrderButtons(colList);
      oabRefreshConfigOrderButtons(valueList);
    };
    refreshOrderButtons();

    modal.querySelector('#oabAddRowBtn')?.addEventListener('click', () => {
      const field = oabFirstUnusedField(rowList, allFields, '.oabPivotAxisField');
      if (!field) { oabToast(oabT('Seçilebilecek OAB alanı bulunamadı.', 'No OAB field is available to select.')); return; }
      rowList.insertAdjacentHTML('beforeend', oabPivotAxisRowHtml(field, 'rows', allFields));
      refreshOrderButtons();
    });
    modal.querySelector('#oabAddColumnBtn')?.addEventListener('click', () => {
      const field = oabFirstUnusedField(colList, allFields, '.oabPivotAxisField');
      if (!field) { oabToast(oabT('Seçilebilecek OAB alanı bulunamadı.', 'No OAB field is available to select.')); return; }
      colList.insertAdjacentHTML('beforeend', oabPivotAxisRowHtml(field, 'columns', allFields));
      refreshOrderButtons();
    });
    modal.querySelector('#oabAddValueBtn')?.addEventListener('click', () => {
      const field = valueFields[0] || '';
      if (!field) { oabToast(oabT('Seçilebilecek sayısal OAB alanı bulunamadı.', 'No numeric OAB field is available to select.')); return; }
      const idx = valueList.children.length;
      valueList.insertAdjacentHTML('beforeend', oabPivotValueRowHtml({ field, agg: OABDataUtils.isNumericField(S.rows, field) ? 'SUM' : 'FIRST' }, idx, valueFields));
      refreshOrderButtons();
    });

    modal.addEventListener('click', event => {
      const removeBtn = event.target.closest && event.target.closest('[data-oab-config-remove]');
      if (removeBtn && modal.contains(removeBtn)) {
        const row = removeBtn.closest('.oabConfigRow');
        const list = row && row.parentElement;
        row?.remove();
        oabRefreshConfigOrderButtons(list);
        return;
      }
      const moveBtn = event.target.closest && event.target.closest('[data-oab-config-move]');
      if (moveBtn && modal.contains(moveBtn)) {
        const row = moveBtn.closest('.oabConfigRow');
        oabMoveConfigRow(row, Number(moveBtn.dataset.oabConfigMove));
      }
    });
    let draggedConfigRow = null;
    modal.addEventListener('dragstart', event => {
      const row = event.target.closest && event.target.closest('.oabConfigRow');
      if (!row || !modal.contains(row)) return;
      draggedConfigRow = row;
      row.classList.add('isDragging');
      if (event.dataTransfer) { event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', 'oab-config-row'); }
    });
    modal.addEventListener('dragover', event => {
      const target = event.target.closest && event.target.closest('.oabConfigRow');
      if (!draggedConfigRow || !target || target === draggedConfigRow || target.parentElement !== draggedConfigRow.parentElement) return;
      event.preventDefault();
      const rect = target.getBoundingClientRect();
      target.parentElement.insertBefore(draggedConfigRow, event.clientY > rect.top + rect.height / 2 ? target.nextElementSibling : target);
    });
    modal.addEventListener('drop', event => {
      if (!draggedConfigRow) return;
      event.preventDefault();
      oabRefreshConfigOrderButtons(draggedConfigRow.parentElement);
    });
    modal.addEventListener('dragend', () => {
      if (draggedConfigRow) draggedConfigRow.classList.remove('isDragging');
      draggedConfigRow = null;
      refreshOrderButtons();
    });

    modal.addEventListener('change', event => {
      const fieldSelect = event.target.closest && event.target.closest('.oabPivotValueField');
      if (!fieldSelect || !modal.contains(fieldSelect)) return;
      const row = fieldSelect.closest('.oabPivotValueRow');
      const aggSelect = row && row.querySelector('.oabPivotValueAgg');
      if (!aggSelect) return;
      const field = fieldSelect.value;
      const formula = OABDataUtils.isFormulaMetric(field);
      const numeric = formula || OABDataUtils.isNumericField(S.rows, field);
      const nextAgg = formula ? 'CALC' : (numeric ? 'SUM' : 'FIRST');
      aggSelect.innerHTML = oabAggOptionsHtml(field, nextAgg);
      aggSelect.value = nextAgg;
    });

    modal.querySelector('[data-oab-settings-reset]')?.addEventListener('click', () => oabResetPivotSettings(modal));
    modal.querySelector('[data-oab-settings-save]')?.addEventListener('click', () => oabSaveSettingsFromModal(modal));
  }

  function oabAggOptionsHtml(field, selected) {
    const formula = OABDataUtils.isFormulaMetric(field);
    const numeric = formula || OABDataUtils.isNumericField(S.rows, field);
    const preferred = selected || (formula ? 'CALC' : (numeric ? 'SUM' : 'FIRST'));
    let names = formula
      ? ['CALC', 'AVG', 'MIN', 'MAX', 'COUNT', 'SUM']
      : (numeric ? ['SUM', 'AVG', 'COUNT', 'MIN', 'MAX', 'FIRST'] : ['FIRST', 'COUNT']);
    // Kayıtlı eski/özel aggregate seçimi veri henüz yüklenmemişken kaybolmasın.
    if (preferred && !names.includes(preferred)) names = [preferred, ...names];
    return names.map(agg => `<option value="${agg}"${agg === preferred ? ' selected' : ''}>${agg}</option>`).join('');
  }
  function oabPivotValueRowHtml(value, index, numericFields) {
    const selectedField = value && value.field;
    const selectedAgg = value && value.agg ? value.agg : (OABDataUtils.isFormulaMetric(selectedField) ? 'CALC' : (OABDataUtils.isNumericField(S.rows, selectedField) ? 'SUM' : 'FIRST'));
    return `<div class="oabPivotValueRow oabConfigRow" draggable="true" data-idx="${index}">
      <span class="oabConfigDrag" aria-hidden="true">⋮⋮</span>
      <select class="oabPivotValueField">${oabFieldOptionsHtml(numericFields, value.field)}</select>
      <select class="oabPivotValueAgg">${oabAggOptionsHtml(value.field, selectedAgg)}</select>
      ${oabConfigActionsHtml()}
    </div>`;
  }

  function oabUniqueSelectedFields(modal, listSelector) {
    const result = [];
    const seen = new Set();
    modal.querySelectorAll(`${listSelector} .oabPivotAxisField`).forEach(select => {
      const field = String(select.value || '').trim();
      if (!field || seen.has(field)) return;
      seen.add(field);
      result.push(field);
    });
    return result;
  }

  async function oabResetPivotSettings(modal) {
    const ttlMinutes = Number(modal && modal.querySelector('#oabTtlInput')?.value) || 30;
    const pivotConfig = defaultPivotConfigClient();
    try {
      const data = await OABApi.saveSettings({ ttlMinutes, pivotConfig });
      S.settings = data.settings;
      S.pivotConfig = data.settings.pivotConfig;
      S.collapsedGroups.clear();
      modal?.remove();
      oabToast(oabT('OAB Pivot varsayılan düzenine döndü.', 'OAB Pivot reset to defaults.'));
      if (S.rows.length) oabRenderTable();
    } catch (err) { oabToast(oabAuthErrorMessage(err)); }
  }

  async function oabSaveSettingsFromModal(modal) {
    const ttlMinutes = Number(modal.querySelector('#oabTtlInput').value) || 30;
    const rows = oabUniqueSelectedFields(modal, '#oabPivotRowsList');
    const columns = oabUniqueSelectedFields(modal, '#oabPivotColsList');
    const values = [...modal.querySelectorAll('.oabPivotValueRow')].map(row => ({
      field: row.querySelector('.oabPivotValueField').value,
      agg: row.querySelector('.oabPivotValueAgg').value,
    })).filter(v => v.field);
    const grouped = Boolean(modal.querySelector('#oabGroupedViewInput')?.checked);
    const showSubtotals = Boolean(modal.querySelector('#oabShowSubtotalsInput')?.checked);
    const pivotConfig = { rows, columns, values, localFilters: {}, calculatedFields: (S.pivotConfig && S.pivotConfig.calculatedFields) || [], grouped, showSubtotals };
    try {
      const data = await OABApi.saveSettings({ ttlMinutes, pivotConfig });
      S.settings = data.settings; S.pivotConfig = data.settings.pivotConfig; S.collapsedGroups.clear();
      modal.remove();
      oabToast(oabT('OAB ayarları kaydedildi.', 'OAB settings saved.'));
      if (S.rows.length) oabRenderTable();
    } catch (err) { oabToast(oabAuthErrorMessage(err)); }
  }

  global.BLOAB = global.BLOAB || {};
  global.BLOAB.refreshPlmLinks = function () {
    if (!S.rows.length) return;
    try { oabRenderTable(); } catch (_) {}
  };

  /* --------------------------------------------------------------- INIT */
  async function oabInit() {
    if (!oabEl('oabSection')) return; // Overview HTML'i henüz yoksa sessizce çık.
    // v7.20: üç filtre de çoklu seçim açılırı; tıklama gövde düzeyinde
    // yakalanıyor (oabOpenMultiPopover), burada ayrı dinleyici gerekmiyor.
    oabEl('oabGetBtn')?.addEventListener('click', () => oabFetchReport(false));
    oabEl('oabRefreshBtn')?.addEventListener('click', () => oabFetchReport(true));
    oabEl('oabCancelBtn')?.addEventListener('click', () => void oabCancelBatch());
    document.querySelectorAll('[data-oab-view]').forEach(btn => btn.addEventListener('click', () => oabSwitchView(btn.dataset.oabView)));
    oabEl('oabSettingsBtn')?.addEventListener('click', oabOpenSettings);
    oabEl('oabExpandAllBtn')?.addEventListener('click', oabExpandAllGroups);
    oabEl('oabCollapseAllBtn')?.addEventListener('click', oabCollapseAllGroups);
    oabEl('oabExcelExportBtn')?.addEventListener('click', () => void oabExportExcel());
    oabUpdateActionButtons();
    const loaded = await oabLoadSeasons();
    if (loaded) await oabRestoreLastSnapshot();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', oabInit, { once: true });
  else oabInit();
})(typeof window !== 'undefined' ? window : globalThis);
