(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.BLBacklogExcel = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const FORMULA_HEADERS = Object.freeze([
    'Net Gelen Alım Sipariş Miktarı',
    'ANTREPO GİRİŞ TARİHİ',
    'ANTREPO-RETAIL',
    'Üretici Tükleme Tipi Teyidi',
    'RİSK\n(PRIORITY)',
  ]);

  const DEFAULT_VISIBLE_HEADERS = Object.freeze([
    'Sezon',
    'Sipariş Yerleştirme MerchTarih',
    'Siparişin Üretildiği Ülke',
    'Buyer',
    'Buyer Grup (TR)',
    'Üretici',
    'Alt Üretici',
    'Line',
    'Ürün Klasman',
    'Sipariş Kod',
    'Özel Kod 1',
    'Model Adı',
    'Renk Kod',
    'Renk',
    'Orijinal Exfactory Merch Tarih',
    'Retail Depo Tarih Yıl Ay Gün',
    'Model Bütçe Tarih Yıl Ay Gün',
    'Net Alım Sipariş Miktarı',
    'Adet',
    'Gelen Alım Sipariş Miktarı Merkez Sevke Hazır Depo',
    'Kalan Alım Sipariş Miktarı',
    'Net Gelen Alım Sipariş Miktarı',
    'Kalan Alım Sipariş Miktarı_Merkez Sevke Hazır Depo',
    'GÜNCEL DURUM\n(STATUS)',
    'REVİZE YÜKLEME TARİHİ\n(EX-FACTORY)',
    'ANTREPO GİRİŞ TARİHİ',
    'YÜKLEME TİPİ',
    'ANTREPO-RETAIL',
    'Üretici Tükleme Tipi Teyidi',
    'RİSK\n(PRIORITY)',
    'buying note',
  ]);

  const EMPHASIS_HEADERS = Object.freeze(['Sipariş Kod', 'Model Adı']);
  const DEFAULT_HEADER_FILL_RGB = 'FFF2F4F7';
  const DEFAULT_HEADER_FONT_RGB = 'FF475467';
  const EMPHASIS_HEADER_FILL_RGB = 'FFFFF2CC';
  const EMPHASIS_HEADER_FONT_RGB = 'FF665200';

  function headerStyleSpec(header) {
    const emphasized = EMPHASIS_HEADERS.includes(String(header == null ? '' : header));
    return Object.freeze({
      fillRgb: emphasized ? EMPHASIS_HEADER_FILL_RGB : DEFAULT_HEADER_FILL_RGB,
      fontRgb: emphasized ? EMPHASIS_HEADER_FONT_RGB : DEFAULT_HEADER_FONT_RGB,
      // All Backlog column headers stay bold, including the two emphasized
      // yellow headers (Sipariş Kod and Model Adı).
      bold: true,
    });
  }

  function isDefaultVisibleHeader(header) {
    return DEFAULT_VISIBLE_HEADERS.includes(String(header == null ? '' : header));
  }

  function columnSpec(header, options) {
    const item = options || {};
    if (item.helper) return { hidden: true, wch: 2 };
    const visible = isDefaultVisibleHeader(header);
    const spec = { hidden: !visible };
    if (!visible) spec.level = 1;
    return spec;
  }

  const STATUS_OPTIONS = Object.freeze([
    'Üretimde',
    'Üretimde - Kesimde',
    'Eksik Yükleme',
    'Depoda - Eksik Yükleme',
    'Yükleme Operasyonları',
    'Yol Operasyonları',
    'Gümrük-Liman Operasyonları',
    'Yolda',
    'Retaile Aktarım Bekleniyor',
    'Depoda',
  ]);

  function statusOptions(rows, header) {
    const key = header || 'GÜNCEL DURUM\n(STATUS)';
    const seen = new Set();
    const out = [];
    function add(value) {
      const text = String(value == null ? '' : value).trim();
      if (!text || seen.has(text)) return;
      const nextLength = out.reduce((sum, item) => sum + item.length, 0) + Math.max(0, out.length) + text.length + 2;
      if (nextLength > 250) return; // Excel inline list validation has a 255-character limit.
      seen.add(text); out.push(text);
    }
    STATUS_OPTIONS.forEach(add);
    (Array.isArray(rows) ? rows : []).forEach(row => add(row && row[key]));
    return out;
  }

  const HELPER_HEADERS = Object.freeze([
    '_BL_TRANSIT_DAYS',
    '_BL_ACTUAL_ANTREPO',
    '_BL_HANDOVER_DATE',
    '_BL_SHIP_CONFIRMATION_DATE',
    '_BL_ORIGINAL_DEL_TYPE',
    '_BL_DELAY',
    '_BL_MB_DELAY',
    '_BL_HANDOVER',
    '_BL_ANT_DELAY',
    '_BL_TRANSIT_OVERDUE',
    '_BL_DISCOUNT',
  ]);

  function columnName(index) {
    let n = Number(index) + 1;
    let out = '';
    while (n > 0) {
      const r = (n - 1) % 26;
      out = String.fromCharCode(65 + r) + out;
      n = Math.floor((n - 1) / 26);
    }
    return out;
  }

  function excelString(value) {
    return `"${String(value == null ? '' : value).replace(/"/g, '""')}"`;
  }

  function dateDimensionFormula(sourceRef, kind, language) {
    const ref=String(sourceRef||'').trim();
    if(!ref)return '';
    const lang=String(language||'tr').toLowerCase().startsWith('en')?'en':'tr';
    const sunday='('+ref+'-WEEKDAY('+ref+',2)+7)';
    const months=lang==='en'
      ? ['January','February','March','April','May','June','July','August','September','October','November','December']
      : ['Ocak','Şubat','Mart','Nisan','Mayıs','Haziran','Temmuz','Ağustos','Eylül','Ekim','Kasım','Aralık'];
    const monthExpr='CHOOSE(MONTH('+sunday+'),'+months.map(excelString).join(',')+')&" "&YEAR('+sunday+')';
    if(String(kind).toLowerCase()==='week'){
      return 'IF('+ref+'="","",'+(lang==='en'?'"Week "&':'')+'WEEKNUM('+ref+',21)&'+(lang==='en'?'" "&':'". Hafta "&')+monthExpr+')';
    }
    return 'IF('+ref+'="","",'+monthExpr+')';
  }

  function refMap(headers, excelRow) {
    const all = [...headers, ...HELPER_HEADERS];
    const refs = {};
    all.forEach((header, index) => { refs[header] = `${columnName(index)}${excelRow}`; });
    return refs;
  }

  function normalizedDate(value) {
    if (!value) return null;
    if (value instanceof Date && !isNaN(value)) return value;
    const text = String(value).trim();
    let match = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (match) return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    match = text.match(/^(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{4})$/);
    if (match) return new Date(Number(match[3]), Number(match[2]) - 1, Number(match[1]));
    const parsed = new Date(value);
    return isNaN(parsed) ? null : parsed;
  }

  /* ------------------------------------------------------------------
     NAKLİYE YOL SÜRELERİ — Ayarlar sayfası (v5.87)

     Yol süresi eskiden BACKLOG sayfasındaki formüle SAYI olarak gömülüydü
     (ör. `IF(...,70,...)`). Kullanıcı süreyi değiştirmek istediğinde raporu
     yeniden üretmesi gerekiyordu.

     Artık her ayrı yol süresi Ayarlar sayfasında bir satır: hem uygulamada
     tanımlı Transfer Lead Time kuralları hem de kural bulunamayan yükleme
     tipleri için varsayılanlar. BACKLOG'daki yardımcı sütun bu hücrelere
     BAĞLANIR, dolayısıyla Ayarlar'daki Gün hücresini elle değiştirmek
     Antrepo Giriş Tarihi'ni, gecikme bayraklarını ve Risk'i yeniden hesaplar.

     Anahtar eşleşmesi satır bazındadır: bir siparişe hangi kural uygulandıysa
     formülü o kuralın hücresine bakar. Kullanıcı sayfada YÜKLEME TİPİ'ni
     değiştirirse kural artık geçerli değildir; o durumda varsayılan satırlara
     düşülür (aşağıdaki defaults refleri).
     ------------------------------------------------------------------ */
  const TRANSIT_DEFAULT_TYPES = Object.freeze(['Gemi', 'Gemi+Uçak', 'Uçak', 'Gemi+Tır']);
  const TRANSIT_DEFAULT_DAYS = Object.freeze({ 'Gemi': 70, 'Gemi+Uçak': 35, 'Uçak': 15, 'Gemi+Tır': 25 });

  // Serbest metin yükleme tipini varsayılan tablo anahtarına indirger.
  function normalizeDelTypeKey(value) {
    const key = String(value == null ? '' : value).toLocaleUpperCase('tr').replace(/\s+/g, '');
    const ship = key.includes('GEMI') || key.includes('GEMİ') || key.includes('SEA');
    const air = key.includes('UCAK') || key.includes('UÇAK') || key.includes('AIR');
    const truck = key.includes('TIR') || key.includes('TRUCK');
    if (ship && air) return 'Gemi+Uçak';
    if (ship && truck) return 'Gemi+Tır';
    if (air) return 'Uçak';
    if (ship) return 'Gemi';
    return '';
  }
  function transitListText(value) {
    if (Array.isArray(value)) return value.filter(item => item != null && item !== '').join(', ');
    return value == null ? '' : String(value);
  }
  function transitRuleKey(rule) {
    if (!rule) return '';
    return [
      String(rule.delType || ''),
      transitListText(rule.seasons),
      transitListText(rule.countries),
      rule.exfStart ? String(rule.exfStart).slice(0, 10) : '',
      rule.exfEnd ? String(rule.exfEnd).slice(0, 10) : '',
      Number(rule.days),
    ].join('|');
  }

  /**
   * Rapordaki satırlardan Ayarlar sayfasına yazılacak yol süresi tablosunu ve
   * her satırın hangi hücreye bağlanacağını çıkarır.
   *
   * @param {Array} rows  BACKLOG detay satırları (_backlogExcel taşırlar)
   * @param {string} sheetName  Ayarlar sayfasının adı
   * @param {number} startRow  tablonun ilk VERİ satırının 1 tabanlı Excel satırı
   * @param {number} daysColumn  Gün sütununun 0 tabanlı indeksi
   */
  function transitSettingsPlan(rows, sheetName, startRow, daysColumn) {
    const list = Array.isArray(rows) ? rows : [];
    const sheet = String(sheetName || 'Ayarlar');
    const firstRow = Math.max(1, Math.floor(Number(startRow) || 1));
    const colLetter = columnName(Math.max(0, Math.floor(Number(daysColumn) || 0)));
    const entries = [];
    const byKey = new Map();

    // Varsayılanlar her zaman yazılır: kullanıcı sayfada yükleme tipini
    // değiştirdiğinde formülün düşeceği satırlar bunlardır.
    TRANSIT_DEFAULT_TYPES.forEach(type => {
      const key = `VARSAYILAN|${type}`;
      byKey.set(key, entries.length);
      entries.push({ key, kind: 'default', delType: type, seasons: '', countries: '', exfStart: '', exfEnd: '', days: TRANSIT_DEFAULT_DAYS[type] });
    });

    list.forEach(row => {
      const rule = row && row._backlogExcel && row._backlogExcel.transitRule;
      if (!rule || !Number.isFinite(Number(rule.days))) return;
      const key = transitRuleKey(rule);
      if (!key || byKey.has(key)) return;
      byKey.set(key, entries.length);
      entries.push({
        key, kind: 'rule',
        delType: String(rule.delType || ''),
        seasons: transitListText(rule.seasons),
        countries: transitListText(rule.countries),
        exfStart: rule.exfStart ? String(rule.exfStart).slice(0, 10) : '',
        exfEnd: rule.exfEnd ? String(rule.exfEnd).slice(0, 10) : '',
        days: Number(rule.days),
      });
    });

    const refOf = index => `${sheet}!$${colLetter}$${firstRow + index}`;
    const defaults = {};
    TRANSIT_DEFAULT_TYPES.forEach(type => { defaults[type] = refOf(byKey.get(`VARSAYILAN|${type}`)); });

    return {
      entries,
      defaults,
      firstRow,
      lastRow: firstRow + entries.length - 1,
      // Bir satırın hangi hücreye bağlanacağı: uygulanan kural varsa onun
      // hücresi, yoksa yükleme tipinin varsayılan hücresi.
      refForRow(row) {
        const rule = row && row._backlogExcel && row._backlogExcel.transitRule;
        const index = rule ? byKey.get(transitRuleKey(rule)) : undefined;
        if (index != null) return refOf(index);
        return null;
      },
    };
  }

  function formulaPlan(headers, row, excelRow, options) {
    const refs = refMap(headers, excelRow);
    const r = header => refs[header];
    const meta = row && row._backlogExcel || {};
    const originalDelType = String(meta.originalDelType || row['YÜKLEME TİPİ'] || '');
    const resolvedDays = Number(meta.transitDays);
    const currentDays = Number.isFinite(resolvedDays) ? resolvedDays : 70;
    const del = r('YÜKLEME TİPİ');
    const status = r('GÜNCEL DURUM\n(STATUS)');
    const revisedEx = r('REVİZE YÜKLEME TARİHİ\n(EX-FACTORY)');
    const antDate = r('ANTREPO GİRİŞ TARİHİ');
    const retailDate = r('Retail Depo Tarih Yıl Ay Gün');
    const mbDate = r('Model Bütçe Tarih Yıl Ay Gün');
    const transit = r('_BL_TRANSIT_DAYS');
    const actualAntrepo = r('_BL_ACTUAL_ANTREPO');
    const handoverDate = r('_BL_HANDOVER_DATE');
    const shipConfirmation = r('_BL_SHIP_CONFIRMATION_DATE');
    const originalTypeRef = r('_BL_ORIGINAL_DEL_TYPE');
    const delayFlag = r('_BL_DELAY');
    const mbDelayFlag = r('_BL_MB_DELAY');
    const handoverFlag = r('_BL_HANDOVER');
    const antDelayFlag = r('_BL_ANT_DELAY');
    const transitOverdueFlag = r('_BL_TRANSIT_OVERDUE');
    const discountFlag = r('_BL_DISCOUNT');
    const productionExpr = `OR(${status}="Üretimde",${status}="Production")`;
    const warehouseShortageExpr = `OR(${status}="Depoda - Eksik Yükleme",${status}="In Warehouse - Shortage")`;
    const shortageExpr = `OR(${status}="Eksik Yükleme",${status}="Shortage",${warehouseShortageExpr})`;
    const syntheticExpr = `OR(${productionExpr},${shortageExpr})`;
    const airExpr = `OR(ISNUMBER(SEARCH("Uçak",${del})),ISNUMBER(SEARCH("Air",${del})))`;
    const mixedExpr = `OR(ISNUMBER(SEARCH("+",${del})),ISNUMBER(SEARCH("Gemi",${del})),ISNUMBER(SEARCH("Sea",${del})))`;
    // Ayarlar sayfasındaki yol süresi tablosu varsa süreler oradan okunur;
    // yoksa (ör. Ayarlar sayfası olmayan detay dışa aktarımı) eski sabitler.
    const transitPlan = options && options.transit ? options.transit : null;
    const transitDefaults = transitPlan && transitPlan.defaults ? transitPlan.defaults : null;
    const seaAirRef = transitDefaults && transitDefaults['Gemi+Uçak'] ? transitDefaults['Gemi+Uçak'] : '35';
    const airRef = transitDefaults && transitDefaults['Uçak'] ? transitDefaults['Uçak'] : '15';
    const seaRef = transitDefaults && transitDefaults['Gemi'] ? transitDefaults['Gemi'] : '70';
    const defaultTransitExpr = `IF(${airExpr},IF(${mixedExpr},${seaAirRef},${airRef}),IF(${del}="","",${seaRef}))`;
    // Satıra uygulanan kuralın Gün hücresi; yoksa yükleme tipinin varsayılanı.
    const rowTransitRef = (transitPlan && typeof transitPlan.refForRow === 'function' ? transitPlan.refForRow(row) : null)
      || (transitDefaults && transitDefaults[normalizeDelTypeKey(originalDelType)])
      || String(currentDays);

    // These fields intentionally remain direct values. Locale-specific Excel
    // formula names/format strings previously produced values such as `2026-mm`
    // and `#AD?` on Turkish Excel installations. Revised Ex-Factory remains a
    // source snapshot by business decision. Priority is intentionally formula-driven
    // from ANTREPO-RETAIL so the exported report always follows the requested rule.
    const formulas = {
      'Net Gelen Alım Sipariş Miktarı': {
        kind: 'number',
        // Net sipariş miktarı her parsiyelde sabit kaldığı için gelen miktar artık
        // yeni Adet sütunundan okunur. Sentetik Üretimde satırında gelen miktar 0'dır.
        formula: `IF(${syntheticExpr},0,MAX(0,${r('Adet')}))`,
        cached: row['Net Gelen Alım Sipariş Miktarı'],
      },
      'ANTREPO GİRİŞ TARİHİ': {
        kind: 'date',
        formula: `IF(${syntheticExpr},IF(OR(${revisedEx}="",${transit}=""),"",${revisedEx}+${transit}),${actualAntrepo})`,
        cached: row['ANTREPO GİRİŞ TARİHİ'],
      },
      'ANTREPO-RETAIL': {
        kind: 'number',
        formula: `IF(OR(${status}="Depoda",${warehouseShortageExpr},${antDate}="",${retailDate}=""),"",${antDate}-${retailDate})`,
        cached: row['ANTREPO-RETAIL'],
      },
      'RİSK\n(PRIORITY)': {
        kind: 'text',
        // Hedef tarihe göre mevcut ANTREPO-RETAIL riski korunur. Buna ek olarak
        // üretim sonrası yüklenmiş, planlanan transit süresi dolmuş ama hâlâ
        // depoya girmemiş parsiyel doğrudan Risk Var'dır.
        formula: `IF(OR(${delayFlag},${mbDelayFlag},${handoverFlag},${antDelayFlag},${discountFlag},${transitOverdueFlag}),"VAR","YOK")`,
        cached: String(row['RİSK\n(PRIORITY)'] || '').trim() || (meta.transitOverdue === true ? 'VAR' : 'YOK'),
      },
    };

    const helperCells = {
      '_BL_TRANSIT_DAYS': {
        kind: 'number',
        formula: `IF(${del}=${originalTypeRef},${rowTransitRef},${defaultTransitExpr})`,
        cached: currentDays,
      },
      '_BL_ACTUAL_ANTREPO': { kind: 'date', value: meta.actualAntrepoDate || null },
      '_BL_HANDOVER_DATE': { kind: 'date', value: meta.handoverDate || null },
      '_BL_SHIP_CONFIRMATION_DATE': { kind: 'date', value: meta.shipConfirmationDate || null },
      '_BL_ORIGINAL_DEL_TYPE': { kind: 'text', value: originalDelType },
      '_BL_DELAY': {
        kind: 'boolean',
        // Üretimde satırında geçmiş Ex-Factory bugüne taşınır. Shortage satırında
        // siparişin tamamı Ex-Factory tarihinde yüklenmiş kabul edilir; TODAY()
        // düzeltmesi yapılmaz.
        formula: `OR(AND(${productionExpr},${revisedEx}<>"",${retailDate}<>"",${transit}<>"",IF(${revisedEx}<TODAY(),TODAY(),${revisedEx})+${transit}>${retailDate}),AND(${shortageExpr},${revisedEx}<>"",${retailDate}<>"",${transit}<>"",${revisedEx}+${transit}>${retailDate}))`,
        cached: false,
      },
      '_BL_MB_DELAY': {
        kind: 'boolean',
        formula: `AND(${mbDate}<>"",IF(${productionExpr},AND(${revisedEx}<>"",${transit}<>"",${mbDate}-(IF(${revisedEx}<TODAY(),TODAY(),${revisedEx})+${transit})<14),IF(${shortageExpr},AND(${revisedEx}<>"",${transit}<>"",${mbDate}-(${revisedEx}+${transit})<14),AND(${antDate}<>"",${mbDate}-${antDate}<14))))`,
        cached: false,
      },
      '_BL_HANDOVER': {
        kind: 'boolean',
        formula: `AND(${shipConfirmation}<>"",${handoverDate}="",NOT(${syntheticExpr}),${status}<>"Depoda",TODAY()-${shipConfirmation}>=3)`,
        cached: false,
      },
      '_BL_ANT_DELAY': {
        kind: 'boolean',
        formula: `AND(${actualAntrepo}<>"",${actualAntrepo}<TODAY(),NOT(${shortageExpr}),${status}<>"Depoda",${status}<>"Retaile Aktarım Bekleniyor")`,
        cached: false,
      },
      '_BL_TRANSIT_OVERDUE': {
        kind: 'boolean',
        // Non-synthetic (IAS) satırda revisedEx gerçek HANDOVER'a, handover
        // yoksa geçerli Ex-Factory'ye düşer. Tahmini antrepo tarihi özellikle
        // kullanılmaz: transit ETA'sı sonradan ileri alınsa bile yükleme + plan
        // süresi aşıldıysa risk görünür kalmalıdır.
        formula: `AND(NOT(${syntheticExpr}),${revisedEx}<>"",${transit}<>"",${status}<>"Depoda",${status}<>"In Warehouse",${status}<>"Retaile Aktarım Bekleniyor",${status}<>"Awaiting Retail Transfer",TODAY()>${revisedEx}+${transit})`,
        cached: meta.transitOverdue === true,
      },
      '_BL_DISCOUNT': {
        kind: 'boolean',
        formula: `AND(${productionExpr},${revisedEx}<>"",TODAY()-${revisedEx}>9)`,
        cached: false,
      },
    };

    return { formulas, helperCells, helperHeaders: HELPER_HEADERS, refs, normalizedDate };
  }

  // Excel serial date (1900 date system, the Excel-compatible 1900 leap-year quirk
  // included). Written as a plain number so no locale-specific function name can
  // break the rule on a Turkish Excel installation.
  function excelSerialDate(value) {
    const date = normalizedDate(value) || new Date();
    const utc = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
    return Math.round(utc / 86400000) + 25569;
  }

  const SOFT_YELLOW_FILL_RGB = 'FFFFF2CC';

  // Both Backlog highlights are written as Excel conditional-formatting rules
  // instead of baked-in cell fills. The workbook therefore re-evaluates them
  // after every manual edit: revising the Ex-Factory date to a day that is no
  // longer late clears its highlight, and switching a Sea shipment to Sea+Air
  // clears the loading-type highlight as soon as RİSK drops back to "YOK".
  function conditionalFormats(headers, lastRow, options) {
    const list = Array.isArray(headers) ? headers : [];
    const item = options || {};
    const sheetPath = item.sheetPath || 'xl/worksheets/sheet1.xml';
    const endRow = Math.max(2, Math.floor(Number(lastRow) || 0));
    const ref = header => {
      const index = list.indexOf(header);
      return index < 0 ? null : `$${columnName(index)}2`;
    };
    const range = header => {
      const index = list.indexOf(header);
      if (index < 0) return null;
      const col = columnName(index);
      return `${col}2:${col}${endRow}`;
    };

    const revisedRange = range('REVİZE YÜKLEME TARİHİ\n(EX-FACTORY)');
    const revisedRef = ref('REVİZE YÜKLEME TARİHİ\n(EX-FACTORY)');
    const statusRef = ref('GÜNCEL DURUM\n(STATUS)');
    const deliveryRange = range('YÜKLEME TİPİ');
    const deliveryRef = ref('YÜKLEME TİPİ');
    const riskRef = ref('RİSK\n(PRIORITY)');
    const antRetailRef = ref('ANTREPO-RETAIL');
    const reportSerial = excelSerialDate(item.reportDate);

    const formats = [];
    if (revisedRange && revisedRef && statusRef) {
      // Late only means "still sitting before the day the report was produced".
      // The report date is frozen as a serial number so an archived file keeps
      // showing the picture it was created with instead of drifting with TODAY().
      const productionExpr = `OR(${statusRef}="Üretimde",${statusRef}="Production")`;
      formats.push({
        sheetPath,
        sqref: revisedRange,
        rules: [{
          type: 'expression',
          formula: `AND(${revisedRef}<>"",${revisedRef}<${reportSerial},${productionExpr})`,
          style: { fillColor: SOFT_YELLOW_FILL_RGB },
        }],
      });
    }
    if (deliveryRange && deliveryRef && riskRef && antRetailRef) {
      // ANTREPO-RETAIL is blank for delivered orders and Excel ranks text above
      // any number, so RİSK alone would read "VAR" on those rows. ISNUMBER keeps
      // the highlight on genuinely measured delays.
      const seaExpr = `OR(ISNUMBER(SEARCH("Gemi",${deliveryRef})),ISNUMBER(SEARCH("Sea",${deliveryRef})))`;
      formats.push({
        sheetPath,
        sqref: deliveryRange,
        rules: [{
          type: 'expression',
          formula: `AND(${seaExpr},ISNUMBER(${antRetailRef}),${riskRef}="VAR")`,
          style: { fillColor: SOFT_YELLOW_FILL_RGB },
        }],
      });
    }
    return formats;
  }

  return Object.freeze({
    FORMULA_HEADERS, HELPER_HEADERS, DEFAULT_VISIBLE_HEADERS, EMPHASIS_HEADERS,
    DEFAULT_HEADER_FILL_RGB, DEFAULT_HEADER_FONT_RGB,
    EMPHASIS_HEADER_FILL_RGB, EMPHASIS_HEADER_FONT_RGB, headerStyleSpec,
    STATUS_OPTIONS, statusOptions, SOFT_YELLOW_FILL_RGB, conditionalFormats, excelSerialDate,
    TRANSIT_DEFAULT_TYPES, TRANSIT_DEFAULT_DAYS, transitSettingsPlan, transitRuleKey, normalizeDelTypeKey,
    isDefaultVisibleHeader, columnSpec, columnName, formulaPlan, normalizedDate, excelString, dateDimensionFormula,
  });
});
