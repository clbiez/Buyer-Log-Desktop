/* ===================================================================
   NAVLUN HESAPLAMA — "GEMİ+UÇAK VE UÇAK NAVLUN MALİYET BULMA" Exceli.

   Kaynak dosyanın FREIGHT CALCULATE sayfasındaki zincir:

     Toplam Koli      = YUKARI YUVARLA(Adet / Koli Başı Adet)   (L sütunu)
     CBM              = (En × Boy × Yükseklik / 1.000.000) × Toplam Koli
     Brüt Kilogram    = (kg/adet × Adet) + Toplam Koli
     Charchable Weight= MAX(Brüt Kilogram ; CBM × 167)
     Navlun Toplam    = Charchable Weight × birim navlun ücreti
     Birim Navlun     = Navlun Toplam / Adet
     Landed           = Style Price + Birim Navlun

   KAYNAK DOSYADAN BİLEREK AYRILAN NOKTA (v5.77, kullanıcı kararı):
   Toplam Koli her zaman YUKARI yuvarlanır. Excel'de bu hücre `0` biçimiyle
   tam sayı GÖSTERİR ama değeri ondalıklı kalır (ör. 43,54) ve hem CBM hem
   brüt kilogram o ondalıklı değerle hesaplanır. Fiziksel gerçek ise 44
   kolidir: yarım koli yüklenmez, taşıyıcı 44 koli üzerinden yer ve ağırlık
   hesaplar. Bu yüzden sonuçlar kaynak Excel'den bir miktar YÜKSEK çıkar —
   fark kasıtlıdır, hata değildir.

   KAYNAK DOSYADAN AYNEN KORUNAN VARSAYIM (kullanıcı doğruladı):
   Brüt kilograma Toplam Koli eklenir; yani koli başına 1 kg ambalaj ağırlığı
   sayılır.

   167 katsayısı (hacimsel ağırlık) ve navlun ücretleri ayar olarak dışarıdan
   verilir; sabit değildir.
   =================================================================== */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.BLFreight = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // Kaynak Excel'in başındaki üç navlun satırı. Kullanıcı sonradan
  // değiştirebilir, silebilir veya yeni rota ekleyebilir.
  const DEFAULT_RATES = Object.freeze([
    Object.freeze({ id: 'air', mode: 'air', label: 'Uçak (AIR)', rate: 5.3 }),
    Object.freeze({ id: 'seaair-colombo', mode: 'seaAir', label: 'Gemi+Uçak (SEA+AIR) COLOMBO', rate: 5 }),
    Object.freeze({ id: 'seaair-maldives', mode: 'seaAir', label: 'Gemi+Uçak (SEA+AIR) MALDIVES', rate: 3.9 }),
  ]);

  // Hacimsel ağırlık katsayısı: 1 m³ kaç kilograma denk sayılır.
  const DEFAULT_VOLUMETRIC_FACTOR = 167;
  // Landed çarpanı: FOB üzerine binen gümrük/masraf yükü. Kaynak Excel'de yoktu
  // (orada Landed = FOB + birim navlun), bu yüzden varsayılan 1 — yani kapalı.
  // Nakliye Kıyaslama'daki Gemi landed sütunu FOB × 1,11 ile hesaplandığı için
  // burayı 1,11 yapmak üç yükleme tipini aynı tabana oturtur.
  const DEFAULT_LANDED_MULTIPLIER = 1;
  // En yaygın koli ölçüsü; her hesapta elle yazılmasın diye ön dolu gelir.
  const DEFAULT_CARTON = Object.freeze({ cartonL: 58, cartonH: 38, cartonW: 30 });
  const MODES = Object.freeze(['air', 'seaAir']);

  function num(value) {
    if (value == null || value === '') return null;
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    const text = String(value).trim().replace(/[\s\u00a0]/g, '');
    if (!text) return null;
    // "1.234,56" ve "1,234.56" biçimlerinin ikisi de kabul edilir.
    const comma = text.lastIndexOf(','), dot = text.lastIndexOf('.');
    let normalized = text;
    if (comma >= 0 && dot >= 0) normalized = comma > dot ? text.replace(/\./g, '').replace(',', '.') : text.replace(/,/g, '');
    else if (comma >= 0) normalized = text.replace(',', '.');
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function slugId(value, fallback) {
    const text = String(value == null ? '' : value).trim().toLowerCase()
      .replace(/[çğıöşü]/g, ch => ({ 'ç': 'c', 'ğ': 'g', 'ı': 'i', 'ö': 'o', 'ş': 's', 'ü': 'u' }[ch]))
      .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    return text || fallback;
  }

  function normalizeRate(entry, index) {
    const item = entry && typeof entry === 'object' ? entry : {};
    const rate = num(item.rate);
    const label = String(item.label == null ? '' : item.label).trim().slice(0, 80);
    const mode = MODES.includes(item.mode) ? item.mode : 'seaAir';
    return {
      id: slugId(item.id || label, `rate-${index + 1}`).slice(0, 40),
      mode,
      label: label || `Navlun ${index + 1}`,
      rate: rate != null && rate > 0 ? rate : 0,
    };
  }

  // Ayarların her okunuşunda aynı biçime indirger: bozuk/eksik kayıt gelse bile
  // hesap tarafı her zaman geçerli bir liste görür.
  function normalizeSettings(value) {
    const raw = value && typeof value === 'object' ? value : {};
    const list = Array.isArray(raw.rates) ? raw.rates : null;
    const seen = new Set();
    const rates = (list || DEFAULT_RATES).map(normalizeRate).filter(item => {
      if (seen.has(item.id)) return false;
      seen.add(item.id);
      return true;
    }).slice(0, 20);
    const factor = num(raw.volumetricFactor);
    const multiplier = num(raw.landedMultiplier);
    return {
      rates: rates.length ? rates : DEFAULT_RATES.map(normalizeRate),
      volumetricFactor: factor != null && factor > 0 ? factor : DEFAULT_VOLUMETRIC_FACTOR,
      landedMultiplier: multiplier != null && multiplier > 0 ? multiplier : DEFAULT_LANDED_MULTIPLIER,
      carton: {
        cartonL: cartonValue(raw.carton && raw.carton.cartonL, DEFAULT_CARTON.cartonL),
        cartonH: cartonValue(raw.carton && raw.carton.cartonH, DEFAULT_CARTON.cartonH),
        cartonW: cartonValue(raw.carton && raw.carton.cartonW, DEFAULT_CARTON.cartonW),
      },
    };
  }

  function cartonValue(value, fallback) {
    const parsed = num(value);
    return parsed != null && parsed > 0 ? parsed : fallback;
  }

  function defaultSettings() {
    return normalizeSettings({ rates: DEFAULT_RATES.map(item => ({ ...item })), volumetricFactor: DEFAULT_VOLUMETRIC_FACTOR });
  }

  /**
   * @param {object} input  kgPerPiece, qtyTotal, qtyPerCarton, cartonL, cartonH,
   *                        cartonW (cm), stylePrice
   * @param {object} settings normalizeSettings çıktısı
   * @returns {object} ara değerler + her navlun ücreti için sonuç satırı
   */
  function calculate(input, settings) {
    const item = input && typeof input === 'object' ? item0(input) : item0({});
    const config = normalizeSettings(settings);
    const { kgPerPiece, qtyTotal, qtyPerCarton, cartonL, cartonH, cartonW, stylePrice } = item;

    const cartonCount = (qtyTotal != null && qtyPerCarton != null && qtyPerCarton !== 0)
      ? Math.ceil(qtyTotal / qtyPerCarton)
      : null;
    const cartonCbm = (cartonL != null && cartonH != null && cartonW != null)
      ? (cartonL * cartonH * cartonW) / 1000000
      : null;
    const cbm = (cartonCbm != null && cartonCount != null) ? cartonCbm * cartonCount : null;
    const grossWeight = (kgPerPiece != null && qtyTotal != null && cartonCount != null)
      ? (kgPerPiece * qtyTotal) + cartonCount
      : null;
    const volumetricWeight = cbm != null ? cbm * config.volumetricFactor : null;
    const chargeableWeight = (grossWeight != null && volumetricWeight != null)
      ? Math.max(grossWeight, volumetricWeight)
      : null;
    // Hangi ağırlığın faturalandığını göstermek, sonucu tartışılır olmaktan
    // çıkarır: kullanıcı sayının nereden geldiğini kartta görür.
    const chargeableSource = chargeableWeight == null ? null
      : (volumetricWeight > grossWeight ? 'volumetric' : 'gross');

    const results = config.rates.map(rate => {
      const total = (chargeableWeight != null && rate.rate > 0) ? chargeableWeight * rate.rate : null;
      const perPiece = (total != null && qtyTotal != null && qtyTotal !== 0) ? total / qtyTotal : null;
      // Landed = (FOB × landed çarpanı) + birim navlun. Çarpan gümrük/masrafı
      // temsil eder ve navluna uygulanmaz; navlun zaten ayrıca hesaplanıyor.
      const landed = (perPiece != null && stylePrice != null) ? (stylePrice * config.landedMultiplier) + perPiece : null;
      return { ...rate, total, perPiece, landed };
    });

    return {
      cartonCount, cartonCbm, cbm, grossWeight, volumetricWeight,
      chargeableWeight, chargeableSource,
      volumetricFactor: config.volumetricFactor,
      landedMultiplier: config.landedMultiplier,
      stylePrice, qtyTotal,
      complete: chargeableWeight != null,
      results,
    };
  }

  function item0(input) {
    return {
      kgPerPiece: num(input.kgPerPiece),
      qtyTotal: num(input.qtyTotal),
      qtyPerCarton: num(input.qtyPerCarton),
      cartonL: num(input.cartonL),
      cartonH: num(input.cartonH),
      cartonW: num(input.cartonW),
      stylePrice: num(input.stylePrice),
    };
  }

  /**
   * Çoklu hesap: seçilen her satır KENDİ adedi ve KENDİ fiyatıyla ayrı ayrı
   * hesaplanır. Adet satırdan geldiği için koli sayısı, CBM ve charchable weight
   * de satır başına farklıdır — tek bir toplu hesap yapıp adede bölmek yanlış
   * sonuç verirdi (yuvarlanan koli sayısı ve MAX(brüt; hacimsel) seçimi satır
   * bazında değişir).
   *
   * @param {Array<{key?:string,label?:string,input:object}>} items
   * @param {object} settings
   * @returns {{rows:Array, totals:object}} satır sonuçları + rota bazında toplam
   */
  function calculateMany(items, settings) {
    const config = normalizeSettings(settings);
    const list = Array.isArray(items) ? items : [];
    const rows = list.map((entry, index) => {
      const item = entry && typeof entry === 'object' ? entry : {};
      return {
        key: item.key == null ? String(index) : String(item.key),
        label: String(item.label == null ? '' : item.label),
        input: item.input || {},
        result: calculate(item.input || {}, config),
      };
    });

    // Rota toplamları yalnız TAM hesaplanabilen satırlardan toplanır; eksik satır
    // toplamı sessizce küçültmesin diye kaçının eksik olduğu ayrıca sayılır.
    const complete = rows.filter(row => row.result.complete);
    const incomplete = rows.length - complete.length;
    const totals = config.rates.map(rate => {
      let freight = 0, qty = 0, goods = 0, counted = 0;
      complete.forEach(row => {
        const hit = row.result.results.find(entry => entry.id === rate.id);
        const rowQty = row.result.qtyTotal;
        if (!hit || hit.total == null || rowQty == null) return;
        freight += hit.total;
        qty += rowQty;
        if (row.result.stylePrice != null) goods += row.result.stylePrice * config.landedMultiplier * rowQty;
        counted += 1;
      });
      return {
        ...rate,
        rows: counted,
        total: counted ? freight : null,
        qtyTotal: counted ? qty : null,
        // Ağırlıklı ortalama: satırların birim navlunlarının düz ortalaması
        // adetleri görmezden gelirdi.
        perPiece: counted && qty ? freight / qty : null,
        landed: counted && qty ? (goods + freight) / qty : null,
      };
    });
    return { rows, totals, completeRows: complete.length, incompleteRows: incomplete };
  }

  // Sarı (doldurulması gereken) alanların listesi; arayüz bunu tek kaynaktan okur.
  const INPUT_FIELDS = Object.freeze([
    Object.freeze({ key: 'kgPerPiece', tr: 'kg / adet', en: 'kg / piece', hintTr: 'Çeki listesindeki adet başına net kilogram', hintEn: 'Kilograms per piece from the packing list' }),
    Object.freeze({ key: 'qtyTotal', tr: 'Toplam Adet', en: 'Qty Total', hintTr: 'Sipariş adedi', hintEn: 'Order quantity' }),
    Object.freeze({ key: 'qtyPerCarton', tr: 'Koli Başı Adet', en: 'Qty per Carton', hintTr: 'Bir koliye giren adet', hintEn: 'Pieces per carton' }),
    Object.freeze({ key: 'cartonL', tr: 'Koli En (cm)', en: 'Carton L (cm)' }),
    Object.freeze({ key: 'cartonH', tr: 'Koli Yükseklik (cm)', en: 'Carton H (cm)' }),
    Object.freeze({ key: 'cartonW', tr: 'Koli Boy (cm)', en: 'Carton W (cm)' }),
    Object.freeze({ key: 'stylePrice', tr: 'Style Price (FOB, USD)', en: 'Style Price (FOB, USD)', hintTr: 'Landed fiyata eklenecek FOB', hintEn: 'FOB added to the landed price' }),
  ]);

  function missingFields(input) {
    const item = item0(input || {});
    return INPUT_FIELDS.filter(field => item[field.key] == null || (field.key !== 'stylePrice' && item[field.key] === 0)).map(field => field.key);
  }

  return Object.freeze({
    DEFAULT_RATES, DEFAULT_VOLUMETRIC_FACTOR, DEFAULT_LANDED_MULTIPLIER, DEFAULT_CARTON, MODES, INPUT_FIELDS,
    num, normalizeRate, normalizeSettings, defaultSettings, calculate, calculateMany, missingFields,
  });
});
