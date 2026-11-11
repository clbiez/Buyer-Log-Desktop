/* ===================================================================
   LCW AI — Doğal dil veri sorgusu (BLDataQuery)

   Kullanıcı "günaydın bana ay bazlı sıparıs gecme tarıhlerını model butce
   ayına göre w6 da cıkarabılır mısın" gibi serbest, eksik ya da hatalı
   yazımlı bir istekte bulunur. İş bölümü:

     LCW AI   → isteği ANLAR ve yapılandırılmış bir sorgu planı (JSON) yazar.
     Buyer Log → planı DOĞRULAR (alan var mı, işlem alan türüne uygun mu),
                 değerleri GERÇEK veride eşleştirir (Türkçe karakter, büyük/
                 küçük harf, boşluk ve tek harflik yazım hatası toleranslı),
                 TÜM kayıtlar üzerinde deterministik olarak hesaplar ve
                 nasıl anladığını kullanıcıya açıkça yazar.

   Rakamlar hiçbir zaman modelden gelmez. Eşleşmeyen bir "dahil et" değeri
   sessizce yok sayılmaz: kullanıcıya benzer değerlerle soru sorulur.

   Dönemler (ay, hafta, çeyrek, yıl) LCW Merch Calendar'a göredir: kaynak
   Buyer Log'un ortak tarih boyutu BLDateDimension (date-dimension.js) ve
   Veri Yönetimi'nden yüklenen takvimdir. Miladi takvim yalnız kullanıcı
   açıkça isterse (calendar: "gregorian") kullanılır.

   Saf modül: DOM'a dokunmaz. Tarayıcıda window.BLDataQuery, testte
   module.exports. Alan anlamları kanonik alan kaydından
   (canonical-fields.js) okunur; ham başlık eşleştirmesi eklenmez.
   =================================================================== */
(function (root, factory) {
  'use strict';
  const canonical = root && root.BLCanonicalFields ? root.BLCanonicalFields : (typeof require === 'function' ? require('./canonical-fields.js') : null);
  const dates = root && root.BLDateDimension ? root.BLDateDimension : (typeof require === 'function' ? require('./date-dimension.js') : null);
  const lfl = root && root.BLLcwAiLflQuery ? root.BLLcwAiLflQuery : (typeof require === 'function' ? require('./lcwai-lfl-query.js') : null);
  const api = factory(canonical, dates, lfl);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.BLDataQuery = api;
})(typeof window !== 'undefined' ? window : null, function (CF, DD, LFL) {
  'use strict';

  const VERSION = 1;
  const LIMITS = Object.freeze({
    rows: 3, columns: 1, measures: 6, filters: 20, values: 60, list: 40,
    pivotColumns: 36, chatRows: 200, sampleRows: 6000, catalogValues: 14, schemaChars: 36000,
    excelSheetRows: 5000, excelSheets: 10, excelCols: 40,
  });
  const BUCKETS = ['day', 'week', 'month', 'quarter', 'year'];
  const AGGS = ['sum', 'count', 'count_distinct', 'avg', 'weighted_avg', 'min', 'max'];
  const TEXT_OPS = ['in', 'not_in', 'contains', 'not_contains', 'empty', 'not_empty'];
  const NUMBER_OPS = ['in', 'not_in', 'between', 'gte', 'lte', 'gt', 'lt', 'empty', 'not_empty'];
  const DATE_OPS = ['in', 'not_in', 'between', 'gte', 'lte', 'gt', 'lt', 'empty', 'not_empty'];
  const DATE_TYPES = new Set(['date', 'exfactory', 'retailEdit', 'instoreEdit']);
  const NUMBER_TYPES = new Set(['int', 'num', 'money', 'moneyEdit', 'pct']);
  // Ekran kimliği → kanonik modül kimliği.
  const MODULE_OF = { orders: 'orders', cp: 'cp', overview: 'cp', koleksiyon: 'collection', shipping: 'logistics', backlog: 'backlog' };
  /* Buyer Log kısaltmaları. LCW AI planlarken alan seçimine yardım eder;
     eşleştirme yine alan kaydından yapılır. */
  const GLOSSARY = Object.freeze({
    // Ay alanı olan veri kümesinde (Koleksiyon) "MB ayı" önce bu alana çözülür;
    // olmayanda (Siparişler/CP) In-Store tarihine düşer.
    inStoreMonth: ['MB ayı', 'MB ay', 'MB month', 'Model Bütçe Ayı', 'Model Budget Month', 'In Store Month'], // i18n-ignore — eş anlamlı arama terimleri
    inStore: ['MB', 'Model Bütçe', 'Model Butce', 'Model Budget', 'MB ayı', 'In-Store'], // i18n-ignore — eş anlamlı arama terimleri
    orderPlacementDate: ['OPD', 'Sipariş geçme tarihi', 'Sipariş tarihi', 'Order date', 'Order placement'], // i18n-ignore — eş anlamlı arama terimleri
    exFactory: ['Ex-F', 'Ex-Factory', 'Yükleme tarihi', 'Loading date'], // i18n-ignore — eş anlamlı arama terimleri
    mag: ['MAG', 'Merch Alt Grup'], // i18n-ignore — eş anlamlı arama terimleri
    mmyg: ['MMYG', 'Yaş grup', 'Age group'], // i18n-ignore — eş anlamlı arama terimleri
    buyingGroup: ['Buying Group', 'BG', 'Buyer grup'], // i18n-ignore — eş anlamlı arama terimleri
    orderQuantity: ['Adet', 'Sipariş adedi', 'Miktar', 'Quantity', 'Qty'], // i18n-ignore — eş anlamlı arama terimleri
    orderCode: ['PO', 'Sipariş no', 'Order no', 'Order number'], // i18n-ignore — eş anlamlı arama terimleri
    country: ['Ülke', 'Country', 'Üretim ülkesi'], // i18n-ignore — eş anlamlı arama terimleri
    season: ['Sezon', 'Season'], // i18n-ignore — eş anlamlı arama terimleri
  });

  const T = (lang, tr, en) => (lang === 'en' ? en : tr);
  const clean = value => String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
  const TR_MAP = { ı: 'I', İ: 'I', ş: 'S', Ş: 'S', ğ: 'G', Ğ: 'G', ü: 'U', Ü: 'U', ö: 'O', Ö: 'O', ç: 'C', Ç: 'C' };
  const token = CF && typeof CF.token === 'function' ? CF.token : value => String(value == null ? '' : value).replace(/[ıİşŞğĞüÜöÖçÇ]/g, ch => TR_MAP[ch] || ch).toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
  const compact = value => token(value).replace(/\s+/g, '');

  /* ---------------- Değer okuma ---------------- */
  const pad = n => String(n).padStart(2, '0');
  function isoOf(year, month, day) {
    if (!(year >= 1900 && year <= 2200 && month >= 1 && month <= 12 && day >= 1 && day <= 31)) return '';
    const date = new Date(Date.UTC(year, month - 1, day));
    return date.getUTCMonth() === month - 1 ? `${year}-${pad(month)}-${pad(day)}` : '';
  }
  /* Date, ISO metni, gg.aa.yyyy, yyyymmdd ve Excel seri sayısı → "YYYY-AA-GG". */
  function parseDate(value) {
    if (value == null || value === '') return '';
    if (value instanceof Date) return Number.isNaN(value.getTime()) ? '' : isoOf(value.getFullYear(), value.getMonth() + 1, value.getDate());
    if (typeof value === 'number' && Number.isFinite(value)) {
      const whole = Math.trunc(value);
      if (whole >= 19000101 && whole <= 22001231) return isoOf(Math.trunc(whole / 10000), Math.trunc((whole % 10000) / 100), whole % 100);
      if (value > 20000 && value < 120000) { const date = new Date(Date.UTC(1899, 11, 30) + Math.round(value) * 86400000); return isoOf(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate()); }
      return '';
    }
    const text = String(value).trim();
    let m;
    if ((m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s]|$)/.exec(text))) return isoOf(+m[1], +m[2], +m[3]);
    if ((m = /^(\d{1,2})[./-](\d{1,2})[./-](\d{4})(?:\s|$)/.exec(text))) return isoOf(+m[3], +m[2], +m[1]);
    if ((m = /^(\d{4})(\d{2})(\d{2})$/.exec(text))) return isoOf(+m[1], +m[2], +m[3]);
    if ((m = /^(\d{4})-(\d{1,2})$/.exec(text))) return isoOf(+m[1], +m[2], 1);
    return '';
  }
  /* 1.234,5 (TR) · 1,234.5 (EN) · 1234 · "12%" → sayı. */
  function parseNumber(value) {
    if (value == null || value === '') return null;
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (typeof value === 'boolean') return null;
    let text = String(value).replace(/[\s ]/g, '').replace(/[%$€₺£]/g, '');
    if (!text || !/^[-+]?[\d.,]+$/.test(text)) return null;
    const comma = text.lastIndexOf(','), dot = text.lastIndexOf('.');
    if (comma >= 0 && dot >= 0) text = comma > dot ? text.replace(/\./g, '').replace(',', '.') : text.replace(/,/g, '');
    // Tek ayırıcı + tam üç hane (12.000 / 12,000) binlik sayılır; 12,5 / 12.50 ondalıktır.
    else if (comma >= 0) text = /^[-+]?\d{1,3}(,\d{3})+$/.test(text) ? text.replace(/,/g, '') : text.replace(',', '.');
    else if (dot >= 0 && /^[-+]?\d{1,3}(\.\d{3})+$/.test(text)) text = text.replace(/\./g, '');
    const number = Number(text);
    return Number.isFinite(number) ? number : null;
  }
  function isoWeek(iso) {
    const [y, m, d] = iso.split('-').map(Number);
    const date = new Date(Date.UTC(y, m - 1, d));
    const day = date.getUTCDay() || 7;
    date.setUTCDate(date.getUTCDate() + 4 - day);
    const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
    return `${date.getUTCFullYear()}-W${pad(Math.ceil(((date - yearStart) / 86400000 + 1) / 7))}`;
  }
  /* Merch Calendar aralığı dışında kalan tarih (LCW dönemi yok). */
  const OUTSIDE = '\u0001';
  /* Tarih → dönem anahtarı. calendar "merch" (varsayılan): LCW yılı/ayı/
     haftası BLDateDimension'dan; çeyrek LCW ayından türetilir. Takvim
     yüklü değilse BLDateDimension Buyer Log'un geçici hafta düzenini verir
     (diğer modüllerle aynı). "gregorian": düz miladi takvim. */
  function bucketOf(iso, bucket, calendar = 'merch') {
    if (!iso) return '';
    if (bucket === 'day' || !bucket) return iso;
    if (calendar !== 'gregorian' && DD && typeof DD.describe === 'function') {
      const d = DD.describe(iso);
      if (!d.valid || !d.businessValid) return OUTSIDE;
      if (bucket === 'year') return String(d.periodYear);
      if (bucket === 'quarter') return `${d.periodYear}-Q${Math.ceil(d.month / 3)}`;
      if (bucket === 'month') return d.monthKey;
      if (bucket === 'week') return d.weekKey;
      return iso;
    }
    if (bucket === 'year') return iso.slice(0, 4);
    if (bucket === 'quarter') return `${iso.slice(0, 4)}-Q${Math.ceil(Number(iso.slice(5, 7)) / 3)}`;
    if (bucket === 'month') return iso.slice(0, 7);
    if (bucket === 'week') return isoWeek(iso);
    return iso;
  }
  const merchActive = () => Boolean(DD && typeof DD.hasMerchCalendar === 'function' && DD.hasMerchCalendar());
  /* Dönem anahtarının görünen adı: LCW ayı "Mart 2026", LCW haftası "12. Hafta Mart 2026". */
  function periodLabel(key, bucket, calendar, lang) {
    if (key === OUTSIDE) return T(lang, '(Merch Calendar dışı)', '(outside Merch Calendar)');
    if (!bucket || bucket === 'day') return key;
    if (bucket === 'quarter') { const m = /^(\d{4})-Q([1-4])$/.exec(key); return m ? `${m[1]} ${T(lang, 'Ç', 'Q')}${m[2]}` : key; }
    if (bucket === 'year') return key;
    if (calendar !== 'gregorian' && DD && typeof DD.bucketLabel === 'function') return DD.bucketLabel(key, bucket, lang);
    if (bucket === 'month' && DD && DD.MONTHS_TR) { const m = /^(\d{4})-(\d{2})$/.exec(key); if (m) return `${(lang === 'en' ? DD.MONTHS_EN : DD.MONTHS_TR)[Number(m[2]) - 1]} ${m[1]}`; }
    return key;
  }
  /* Takvim yüklü değilken BLDateDimension ayı haftanın PAZARINA göre atar
     (geçici düzen). Aralık da aynı kuraldan türetilir: ay = pazarı o ayda
     olan haftalar (ilk pazarın pazartesisi … son pazar). Böylece "in", "between"
     ve gruplama aynı günleri aynı aya koyar. */
  function interimMonthRange(year, month) {
    if (!(month >= 1 && month <= 12)) return null;
    const firstSunday = new Date(Date.UTC(year, month - 1, 1));
    firstSunday.setUTCDate(firstSunday.getUTCDate() + ((7 - firstSunday.getUTCDay()) % 7));
    const lastSunday = new Date(Date.UTC(year, month, 0));
    lastSunday.setUTCDate(lastSunday.getUTCDate() - lastSunday.getUTCDay());
    const start = new Date(firstSunday.getTime() - 6 * 86400000);
    const day = date => date.toISOString().slice(0, 10);
    return { start: day(start), end: day(lastSunday), year, month };
  }
  function monthRange(year, month) { return merchActive() ? DD.businessMonthRange(year, month) : interimMonthRange(year, month); }
  /* LCW dönemi → gün aralığı (Merch Calendar'dan; yoksa geçici hafta düzeninden). */
  function merchRange(period) {
    if (!DD || !period) return null;
    if (period.bucket === 'day') return { start: period.key, end: period.key };
    if (period.bucket === 'month') { const [y, m] = period.key.split('-').map(Number); const range = monthRange(y, m); return range ? { start: range.start, end: range.end } : null; }
    if (period.bucket === 'year' || period.bucket === 'quarter') {
      const y = Number(period.key.slice(0, 4));
      const q = period.bucket === 'quarter' ? Number(period.key.slice(-1)) : 0;
      const first = q ? q * 3 - 2 : 1, last = q ? q * 3 : 12;
      const a = monthRange(y, first), b = monthRange(y, last);
      return a && b ? { start: a.start, end: b.end } : null;
    }
    if (period.bucket === 'week') {
      const m = /^(\d{4})-W(\d{2})$/.exec(period.key);
      const monday = m && DD.mondayFromBusinessWeek(Number(m[1]), Number(m[2]));
      const range = monday && DD.businessWeekRange(monday);
      return range ? { start: range.start, end: range.end } : null;
    }
    return null;
  }
  /* Kullanıcının yazdığı tarih/dönem ("2026-03", "03.2026", "2026", "2026-Q1", "mart 2026") → kova anahtarı. */
  const MONTHS = { OCAK: 1, SUBAT: 2, MART: 3, NISAN: 4, MAYIS: 5, HAZIRAN: 6, TEMMUZ: 7, AGUSTOS: 8, EYLUL: 9, EKIM: 10, KASIM: 11, ARALIK: 12, JANUARY: 1, JAN: 1, FEBRUARY: 2, FEB: 2, MARCH: 3, MAR: 3, APRIL: 4, APR: 4, MAY: 5, JUNE: 6, JUN: 6, JULY: 7, JUL: 7, AUGUST: 8, AUG: 8, SEPTEMBER: 9, SEP: 9, OCTOBER: 10, OCT: 10, NOVEMBER: 11, NOV: 11, DECEMBER: 12, DEC: 12 }; // i18n-ignore — ay adı ayrıştırma anahtarları
  function periodOf(value) {
    const text = clean(value);
    let m;
    const iso = parseDate(text);
    if (iso && /\d{1,2}[./-]\d{1,2}[./-]\d{4}|\d{4}-\d{1,2}-\d{1,2}|^\d{8}$/.test(text)) return { bucket: 'day', key: iso };
    if ((m = /^(\d{4})-(\d{1,2})$/.exec(text)) || (m = /^(\d{1,2})[./](\d{4})$/.exec(text))) {
      const year = m[1].length === 4 ? +m[1] : +m[2], month = m[1].length === 4 ? +m[2] : +m[1];
      return month >= 1 && month <= 12 ? { bucket: 'month', key: `${year}-${pad(month)}` } : null;
    }
    if ((m = /^(\d{4})[-\s]?Q([1-4])$/i.exec(text))) return { bucket: 'quarter', key: `${m[1]}-Q${m[2]}` };
    if ((m = /^Q([1-4])[-\s]?(\d{4})$/i.exec(text))) return { bucket: 'quarter', key: `${m[2]}-Q${m[1]}` };
    if ((m = /^(\d{4})[-\s]?W(\d{1,2})$/i.exec(text))) return { bucket: 'week', key: `${m[1]}-W${pad(+m[2])}` };
    if (/^\d{4}$/.test(text)) return { bucket: 'year', key: text };
    const words = token(text).split(' ');
    const month = words.map(word => MONTHS[word]).find(Boolean);
    const year = words.find(word => /^\d{4}$/.test(word));
    if (month && year) return { bucket: 'month', key: `${year}-${pad(month)}` };
    return null;
  }

  /* Ay dönemi metni ("JULY 2027", "Temmuz 2027", "2027-07", "202707", "07.2027") → "YYYY-AA".
     Koleksiyon ay değeri kaydedildiği andaki dilde saklanır; TR/EN aynı aya iner. */
  function monthKeyOf(value) {
    const text = clean(value);
    if (!text || typeof text !== 'string') return '';
    const m = /^(\d{4})(\d{2})$/.exec(text);
    if (m) return +m[2] >= 1 && +m[2] <= 12 ? `${m[1]}-${m[2]}` : '';
    const period = periodOf(text);
    return period && period.bucket === 'month' ? period.key : '';
  }

  /* ---------------- Veri kümesi ve şema ---------------- */
  /* table: BLAIScreenData.table() çıktısı (columns: {key,label,type,readValue,rawValue}).
     Alan türü önce sütun türünden, sonra kanonik alandan, en son örnek
     değerlerden çıkarılır. */
  function createDataset({ id, label, screen, rows, columns, scope, total, module: moduleId } = {}) {
    const module = moduleId || MODULE_OF[screen || id] || screen || id;
    const list = Array.isArray(rows) ? rows : [];
    const fields = [];
    const seen = new Set();
    for (const col of Array.isArray(columns) ? columns : []) {
      if (!col || !col.key || seen.has(col.key)) continue;
      seen.add(col.key);
      // Sütun anahtarı birebir bir kanonik alanın bu modüldeki anahtarıysa o
      // alan esastır: Koleksiyon "inStoreMonth" anahtarı In-Store tarihinin
      // yedek anahtarı olarak da kayıtlı; tarih sanılırsa ay metni okunamaz.
      const own = CF && CF.field(col.key);
      const ownBinding = own && own.modules && own.modules[module];
      const canonicalId = CF ? ((ownBinding && (ownBinding.keys || []).includes(col.key) ? String(col.key) : null) || CF.canonicalId(module, col.key) || CF.canonicalId(module, col.label)) : null;
      const def = canonicalId && CF ? CF.field(canonicalId) : null;
      const field = { id: String(col.key), label: clean(col.label) || String(col.key), canonical: canonicalId || '', canonicalType: def ? def.type : '', role: def ? def.role : '', type: col.type || '', kind: '', col };
      // Metin türlü tarih rolü = ay dönemi (Model Budget Month): değer "YYYY-AA"ya indirgenir.
      if (def && def.role === 'date' && def.type === 'text') field.period = 'month';
      fields.push(field);
    }
    const dataset = { id: String(id || screen || 'data'), label: clean(label) || String(id || ''), screen: screen || id, module, rows: list, fields, scope: scope || 'all', total: Number.isFinite(total) ? total : list.length, _profile: new Map(), _distinct: new Map() };
    const sample = sampleRows(list, 400);
    for (const field of fields) field.kind = detectKind(field, sample);
    return dataset;
  }
  function datasetFromRecords({ id, screen = id, label, rows = [], module: moduleId = screen, scope = 'all', lang = 'tr' }) {
    const keys = new Set();
    for (const row of rows.slice(0, 100)) for (const key of Object.keys(row)) if (!key.startsWith('_')) keys.add(key);
    const columns = [...keys].map(key => {
      const canonical = CF && CF.canonicalId(moduleId, key), def = canonical && CF.field(canonical);
      return { key, label: def ? CF.label(canonical, lang) : key, type: def && def.type === 'number' ? 'num' : def && def.type === 'date' ? 'date' : 'ro', rawValue: row => row[key], readValue: row => row[key] };
    });
    return createDataset({ id, screen, label, rows, columns, scope, module: moduleId });
  }
  function sampleRows(rows, max) {
    if (rows.length <= max) return rows;
    const step = rows.length / max, out = [];
    for (let i = 0; i < max; i++) out.push(rows[Math.floor(i * step)]);
    return out;
  }
  function display(field, row) {
    try { return field.col && typeof field.col.readValue === 'function' ? field.col.readValue(row) : row && row[field.id]; } catch (_) { return ''; }
  }
  function raw(field, row) {
    try { return field.col && typeof field.col.rawValue === 'function' ? field.col.rawValue(row) : undefined; } catch (_) { return undefined; }
  }
  function detectKind(field, sample) {
    if (DATE_TYPES.has(field.type)) return 'date';
    if (NUMBER_TYPES.has(field.type)) return 'number';
    if (field.canonicalType === 'date') return 'date';
    if (field.canonicalType === 'number') return 'number';
    if (['code', 'text', 'country'].includes(field.canonicalType)) return 'text';
    let filled = 0, dates = 0, numbers = 0;
    for (const row of sample) {
      const value = raw(field, row) !== undefined ? raw(field, row) : display(field, row);
      if (value == null || value === '') continue;
      filled++;
      if (value instanceof Date || (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}|^\d{1,2}[./]\d{1,2}[./]\d{4}$/.test(value.trim()))) dates++;
      else if (parseNumber(value) != null) numbers++;
    }
    if (filled >= 3 && dates / filled >= 0.9) return 'date';
    if (filled >= 3 && numbers / filled >= 0.95) return 'number';
    return 'text';
  }
  /* Türlü değer: tarih → "YYYY-AA-GG" | '', sayı → number | null, metin → string. */
  function read(field, row) {
    if (field.kind === 'date') { const r = raw(field, row); return parseDate(r) || parseDate(display(field, row)); }
    if (field.kind === 'number') { const r = parseNumber(raw(field, row)); return r != null ? r : parseNumber(display(field, row)); }
    const shown = display(field, row);
    if (field.period === 'month') { const text = clean(shown == null ? '' : shown) || clean(raw(field, row)); return monthKeyOf(text) || text; }
    const text = clean(shown == null ? '' : (typeof shown === 'object' ? (shown instanceof Date ? parseDate(shown) : JSON.stringify(shown)) : shown));
    if (text) return text;
    const fallback = raw(field, row);
    return fallback == null || typeof fallback === 'object' ? '' : clean(fallback);
  }
  /* Tam ayrık değer kümesi (metin alanında filtre çözümü için). */
  function distinctValues(dataset, field) {
    if (dataset._distinct.has(field.id)) return dataset._distinct.get(field.id);
    const counts = new Map();
    for (const row of dataset.rows) { const value = read(field, row); if (value !== '' && value != null) counts.set(value, (counts.get(value) || 0) + 1); }
    dataset._distinct.set(field.id, counts);
    return counts;
  }
  /* Şema için örneklenmiş profil (tüm satırları taramaz). */
  function profile(dataset, field) {
    if (dataset._profile.has(field.id)) return dataset._profile.get(field.id);
    const rows = sampleRows(dataset.rows, LIMITS.sampleRows);
    const out = { filled: 0, distinct: 0, top: [], min: null, max: null, sampled: rows.length < dataset.rows.length };
    const counts = new Map();
    for (const row of rows) {
      const value = read(field, row);
      if (value === '' || value == null) continue;
      out.filled++;
      if (field.kind === 'text') counts.set(value, (counts.get(value) || 0) + 1);
      else {
        if (out.min == null || value < out.min) out.min = value;
        if (out.max == null || value > out.max) out.max = value;
      }
    }
    out.distinct = counts.size;
    out.top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, LIMITS.catalogValues);
    dataset._profile.set(field.id, out);
    return out;
  }
  function aliasesOf(field) {
    const def = field.canonical && CF ? CF.field(field.canonical) : null;
    const list = [field.label, ...(def ? [def.label && def.label.tr, def.label && def.label.en, ...(def.aliases || [])] : []), ...(GLOSSARY[field.canonical] || [])];
    const seen = new Set([token(field.id)]);
    return list.filter(Boolean).map(clean).filter(item => { const k = token(item); if (!k || seen.has(k)) return false; seen.add(k); return true; }).slice(0, 10);
  }
  async function schemaTextAsync(datasets, options = {}) {
    let since = Date.now();
    for (const dataset of datasets) for (const field of dataset.fields) {
      if (options.cancelled?.()) throw Object.assign(new Error('cancelled'), { code: 'LCWAI_CANCELLED' });
      profile(dataset, field);
      if (Date.now() - since >= 8) { await new Promise(resolve => setTimeout(resolve, 0)); since = Date.now(); }
    }
    return schemaText(datasets, options);
  }
  const shortValue = value => { const text = clean(value); return text.length > 40 ? `${text.slice(0, 39)}…` : text; };
  /* LCW AI'a giden şema: alan kimliği, tür, eş anlamlılar ve örnek değerler. */
  function schemaText(datasets, { lang = 'tr', maxChars = LIMITS.schemaChars } = {}) {
    const list = (Array.isArray(datasets) ? datasets : []).filter(Boolean);
    const blocks = [];
    const budget = Math.floor(maxChars / Math.max(1, list.length));
    for (const dataset of list) {
      const head = `DATASET "${dataset.id}" — ${dataset.label} · ${dataset.total} records · scope: ${dataset.scope}`;
      const lines = [];
      for (const field of dataset.fields) {
        const p = profile(dataset, field);
        if (!p.filled) continue; // tamamen boş alan plana girmez
        const aliases = aliasesOf(field);
        let values = '';
        if (field.kind === 'text') {
          // Kimlik benzeri alanlarda (sipariş kodu, PLM ID) yalnız biçim örneği yeter.
          const identity = field.role === 'identity' || (p.distinct > 20 && p.distinct >= p.filled * 0.8);
          const top = identity ? p.top.slice(0, 3) : p.top;
          const more = p.distinct > top.length ? ` … (${p.distinct}${p.sampled ? '+' : ''} distinct)` : '';
          values = `${identity ? 'examples' : 'values'}: ${top.map(([value]) => JSON.stringify(shortValue(value))).join(', ')}${more}`;
        } else values = `range: ${p.min} … ${p.max}`;
        lines.push(`- ${JSON.stringify(field.id)} | ${field.kind}${field.canonical ? ` | ${field.canonical}` : ''}${aliases.length ? ` | aka: ${aliases.join(', ')}` : ''} | ${values}`);
      }
      let block = `${head}\nFIELDS:\n${lines.join('\n')}`;
      if (block.length > budget) {
        // Önce örnek değerler kısalır; alan listesi korunur.
        block = `${head}\nFIELDS:\n${lines.map(line => line.replace(/\| values: (.{0,160}).*$/, (_, kept) => `| values: ${kept}…`)).join('\n')}`.slice(0, budget);
      }
      blocks.push(block);
    }
    return blocks.join('\n\n');
  }

  /* ---------------- Alan ve değer çözümü ---------------- */
  function resolveField(dataset, ref) {
    const wanted = clean(ref);
    if (!wanted) return null;
    const exact = dataset.fields.find(field => field.id === wanted);
    if (exact) return exact;
    const key = token(wanted);
    const byId = dataset.fields.find(field => token(field.id) === key) || dataset.fields.find(field => token(field.label) === key);
    if (byId) return byId;
    const canonicalId = CF ? (CF.field(wanted) ? wanted : CF.canonicalId(dataset.module, wanted)) : null;
    if (canonicalId) { const hit = dataset.fields.find(field => field.canonical === canonicalId); if (hit) return hit; }
    for (const glossary of Object.keys(GLOSSARY).filter(id => GLOSSARY[id].some(alias => token(alias) === key))) {
      const hit = dataset.fields.find(field => field.canonical === glossary);
      if (hit) return hit;
    }
    const alias = dataset.fields.filter(field => aliasesOf(field).some(item => token(item) === key));
    return alias.length === 1 ? alias[0] : null;
  }
  function editDistance(a, b, max) {
    if (Math.abs(a.length - b.length) > max) return max + 1;
    let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
      const cur = [i];
      let best = i;
      for (let j = 1; j <= b.length; j++) {
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
        if (cur[j] < best) best = cur[j];
      }
      if (best > max) return max + 1;
      prev = cur;
    }
    return prev[b.length];
  }
  const COUNTRY_KEYS = { TURKEY: 'TR', TURKIYE: 'TR', TR: 'TR', CHINA: 'CN', CIN: 'CN', INDIA: 'IN', HINDISTAN: 'IN', EGYPT: 'EG', MISIR: 'EG', MOROCCO: 'MA', FAS: 'MA', BANGLADESH: 'BD', BANGLADES: 'BD', GEORGIA: 'GE', GURCISTAN: 'GE', PAKISTAN: 'PK', VIETNAM: 'VN', ROMANIA: 'RO', ROMANYA: 'RO', UKRAINE: 'UA', UKRAYNA: 'UA', TUNISIA: 'TN', TUNUS: 'TN', BULGARIA: 'BG', BULGARISTAN: 'BG', CAMBODIA: 'KH', KAMBODYA: 'KH', INDONESIA: 'ID', ENDONEZYA: 'ID', MYANMAR: 'MM', 'SRI LANKA': 'LK', SRILANKA: 'LK' }; // i18n-ignore — ülke adı eşleştirme anahtarları
  const countryKey = value => { const k = token(value); return COUNTRY_KEYS[k] || COUNTRY_KEYS[k.replace(/\s+/g, '')] || ''; };
  /* Kullanıcı değeri → veride geçen gerçek değer(ler).
     Sıra: birebir → Türkçe karakter/büyük-küçük harf → boşluksuz → ülke kodu
     → tam kelime içerme → tek/iki harflik yazım hatası. */
  function matchValue(field, input, counts) {
    const wanted = clean(input);
    if (!wanted) return { input: wanted, values: [], how: 'empty' };
    const values = [...counts.keys()];
    if (field && field.period === 'month') {
      const month = monthKeyOf(wanted);
      if (month && values.includes(month)) return { input: wanted, values: [month], how: month === wanted ? 'exact' : 'normalized' };
    }
    const exact = values.filter(value => value === wanted);
    if (exact.length) return { input: wanted, values: exact, how: 'exact' };
    const key = token(wanted);
    const byToken = values.filter(value => token(value) === key);
    if (byToken.length) return { input: wanted, values: byToken, how: 'normalized' };
    const flat = compact(wanted);
    const byCompact = values.filter(value => compact(value) === flat);
    if (byCompact.length) return { input: wanted, values: byCompact, how: 'normalized' };
    const country = countryKey(wanted);
    if (country) { const hits = values.filter(value => countryKey(value) === country); if (hits.length) return { input: wanted, values: hits, how: 'country' }; }
    if (key.length >= 3) {
      const word = new RegExp(`(^| )${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}( |$)`);
      const contains = values.filter(value => word.test(token(value)));
      if (contains.length && contains.length <= 12) return { input: wanted, values: contains, how: 'contains' };
    }
    if (flat.length >= 4) {
      const max = flat.length >= 9 ? 2 : 1;
      const near = values.map(value => ({ value, d: editDistance(flat, compact(value), max) })).filter(item => item.d <= max).sort((a, b) => a.d - b.d);
      /* Yazım düzeltmesi yalnız kelime değerlerinde: kodda (CU4E/CU4F, W6/W7)
         tek karakter farkı başka bir kayıttır; otomatik düzeltilmez, sorulur. */
      const codeLike = field.canonicalType === 'code' || /\d/.test(flat);
      if (!codeLike && near.length && (near.length === 1 || near[0].d < near[1].d)) return { input: wanted, values: [near[0].value], how: 'typo' };
      if (near.length) return { input: wanted, values: [], how: 'ambiguous', suggestions: near.slice(0, 6).map(item => item.value) };
    }
    return { input: wanted, values: [], how: 'none', suggestions: suggest(wanted, values) };
  }
  function suggest(input, values) {
    const flat = compact(input);
    return values.map(value => {
      const other = compact(value);
      const shared = [...new Set(flat)].filter(ch => other.includes(ch)).length;
      const prefix = other.startsWith(flat.slice(0, 2)) ? 2 : 0;
      return { value, score: shared + prefix - Math.abs(other.length - flat.length) * 0.2 };
    }).sort((a, b) => b.score - a.score).slice(0, 6).map(item => item.value);
  }
  /* Yanlış alana yazılmış değeri (ör. MAG kodunu Line alanına) başka metin
     alanlarında birebir arar; tek bir alanda bulunursa o alan önerilir. */
  function findFieldForValue(dataset, input, except) {
    const key = token(input);
    if (!key) return null;
    const hits = dataset.fields.filter(field => field.kind === 'text' && field !== except && [...distinctValues(dataset, field).keys()].some(value => token(value) === key));
    return hits.length === 1 ? hits[0] : null;
  }

  /* ---------------- Plan doğrulama ---------------- */
  const asArray = value => (Array.isArray(value) ? value : value == null || value === '' ? [] : [value]);
  function parseSpec(value) {
    if (value && typeof value === 'object') return value;
    const text = String(value == null ? '' : value).trim().replace(/^```(?:json)?\s*|```$/g, '');
    if (!text) return null;
    try { const parsed = JSON.parse(text); return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null; } catch (_) { return null; }
  }
  /* Ham plan → doğrulanmış plan. Sonuç:
       { ok, spec, notes[], errors[], clarify: { question, options[] } | null }
     errors: LCW AI'dan düzeltme istenecek yapısal hatalar.
     clarify: kullanıcıya sorulacak belirsizlik (ör. eşleşmeyen değer). */
  function normalizeSpec(rawSpec, datasets, { lang = 'tr', request = '', deferCurrencyCheck = false } = {}) {
    const list = (Array.isArray(datasets) ? datasets : []).filter(Boolean);
    const input = parseSpec(rawSpec);
    const notes = [], errors = [];
    if (!input) return { ok: false, spec: null, notes, errors: ['spec-not-json'], clarify: null };
    if (input.queries) {
      if (!Array.isArray(input.queries) || input.queries.length < 2 || input.queries.length > 4 || input.queries.some(q => !q || q.queries)) return { ok: false, spec: null, notes, errors: ['multi-query-needs-2-to-4-flat-queries'], clarify: null };
      const queries = input.queries.map(q => normalizeSpec(q, list, { lang, deferCurrencyCheck }));
      errors.push(...queries.flatMap(q => q.errors)); notes.push(...queries.flatMap(q => q.notes));
      const fields = new Map(), measures = [];
      for (const q of queries) if (q.dataset && q.spec) {
        for (const f of q.dataset.fields) fields.set(f.canonical || f.id, { ...f, id: f.canonical || f.id });
        for (const m of q.spec.measures) measures.push({ ...m, field: (q.dataset.fields.find(f => f.id === m.field) || {}).canonical || m.field });
      }
      errors.push(...validateRequestedMeasures(request, { measures }, { fields: [...fields.values()] }));
      errors.push(...validateAnalysisIntent(request, queries));
      if (/\bLFL\b|LIKE[ -]FOR[ -]LIKE/i.test(request) && !queries.some(q => q.spec && q.spec.comparison)) errors.push('missing-requested-analysis:lfl');
      return { ok: errors.length === 0, errors, notes: [...new Set(notes)], clarify: queries.find(q => q.clarify)?.clarify || null, dataset: queries[0].dataset, spec: { title: clean(input.title).slice(0, 120), queries: queries.map(q => q.spec) } };
    }
    let dataset = list.find(item => item.id === clean(input.dataset)) || list.find(item => token(item.id) === token(input.dataset) || token(item.label) === token(input.dataset));
    if (!dataset && list.length === 1 && !clean(input.dataset)) dataset = list[0];
    if (!dataset) return { ok: false, spec: null, notes, errors: [`unknown-dataset:${clean(input.dataset)}`], clarify: null };
    // Dönemler varsayılan olarak LCW Merch Calendar'a göredir; miladi yalnız açık istekle.
    const calendar = /^(gregorian|miladi|calendar)$/i.test(clean(input.calendar)) ? 'gregorian' : 'merch';
    const spec = { dataset: dataset.id, calendar, filters: [], rows: [], columns: [], measures: [], list: [], sort: null, limit: 0, title: clean(input.title).slice(0, 120) };
    const fieldOf = (ref, where) => {
      const field = resolveField(dataset, typeof ref === 'object' && ref ? ref.field : ref);
      if (!field) errors.push(`unknown-field:${where}:${clean(typeof ref === 'object' && ref ? ref.field : ref)}`);
      return field;
    };
    const bucketFor = (field, value) => {
      if (field.kind !== 'date') return '';
      const bucket = clean(value).toLowerCase();
      return BUCKETS.includes(bucket) ? bucket : 'month';
    };
    let clarify = null;
    for (const item of asArray(input.filters).slice(0, LIMITS.filters)) {
      if (!item || typeof item !== 'object') continue;
      let field = fieldOf(item.field, 'filter');
      if (!field) continue;
      const op = clean(item.op || 'in').toLowerCase().replace(/[\s-]+/g, '_');
      const allowed = field.kind === 'text' ? TEXT_OPS : field.kind === 'number' ? NUMBER_OPS : DATE_OPS;
      const normalizedOp = { eq: 'in', equals: 'in', '=': 'in', neq: 'not_in', not: 'not_in', exclude: 'not_in', '!=': 'not_in', '>=': 'gte', '<=': 'lte', '>': 'gt', '<': 'lt' }[op] || op;
      if (!allowed.includes(normalizedOp)) { errors.push(`bad-op:${field.id}:${op}`); continue; }
      const values = asArray(item.values != null ? item.values : item.value).map(value => (typeof value === 'number' ? value : clean(value))).filter(value => value !== '').slice(0, LIMITS.values);
      const filter = { field: field.id, op: normalizedOp };
      if (field.kind === 'text' && ['in', 'not_in'].includes(normalizedOp)) {
        if (!values.length) { errors.push(`no-values:${field.id}`); continue; }
        let counts = distinctValues(dataset, field);
        const resolved = [], unmatched = [];
        for (const value of values) {
          let match = matchValue(field, value, counts);
          if (!match.values.length && match.how === 'none') {
            const other = findFieldForValue(dataset, value, field);
            if (other && values.length === 1) {
              notes.push(T(lang, `“${value}” ${field.label} alanında yok; ${other.label} alanında bulundu, o alan kullanıldı.`, `“${value}” is not in ${field.label}; it was found in ${other.label}, which was used.`));
              field = other; filter.field = other.id; counts = distinctValues(dataset, other);
              match = matchValue(other, value, counts);
            }
          }
          if (match.values.length) {
            resolved.push(...match.values);
            if (match.how !== 'exact') notes.push(T(lang, `“${match.input}” → ${match.values.map(v => `“${shortValue(v)}”`).join(', ')} (${field.label})`, `“${match.input}” → ${match.values.map(v => `“${shortValue(v)}”`).join(', ')} (${field.label})`));
          } else unmatched.push(match);
        }
        filter.values = [...new Set(resolved)];
        if (unmatched.length) {
          if (normalizedOp === 'not_in') {
            notes.push(T(lang, `${unmatched.map(m => `“${m.input}”`).join(', ')} ${field.label} alanında bulunamadı; hariç tutma bu değer(ler) için etkisiz.`, `${unmatched.map(m => `“${m.input}”`).join(', ')} was not found in ${field.label}; excluding it has no effect.`));
          } else if (!clarify) {
            const first = unmatched[0];
            const options = (first.suggestions || []).slice(0, 6);
            clarify = {
              question: T(lang,
                `“${first.input}” değerini ${field.label} alanında bulamadım.${options.length ? ' Şunlardan birini mi kastettiniz?' : ' Değeri veride geçtiği gibi yazar mısınız?'}`,
                `I could not find “${first.input}” in ${field.label}.${options.length ? ' Did you mean one of these?' : ' Could you write the value as it appears in the data?'}`),
              options,
            };
          }
        }
        if (normalizedOp === 'in' && !filter.values.length) continue;
        if (normalizedOp === 'not_in' && !filter.values.length) continue;
      } else if (field.kind === 'text' && ['contains', 'not_contains'].includes(normalizedOp)) {
        if (!values.length) { errors.push(`no-values:${field.id}`); continue; }
        filter.values = values.map(String);
      } else if (field.kind === 'date') {
        if (['in', 'not_in'].includes(normalizedOp)) {
          const periods = values.map(periodOf);
          if (!periods.length || periods.some(p => !p)) { errors.push(`bad-date-values:${field.id}`); continue; }
          filter.values = periods.map(p => p.key);
          filter.bucket = periods[0].bucket;
          filter.calendar = spec.calendar;
          if (periods.some(p => p.bucket !== filter.bucket)) { errors.push(`mixed-periods:${field.id}`); continue; }
        } else if (normalizedOp === 'between') {
          const from = periodStart(item.from != null ? item.from : values[0], spec.calendar), to = periodEnd(item.to != null ? item.to : values[1], spec.calendar);
          if (!from || !to) { errors.push(`bad-date-range:${field.id}`); continue; }
          filter.from = from; filter.to = to;
        } else if (!['empty', 'not_empty'].includes(normalizedOp)) {
          // Dönem kenarı: "≥ Mart" Mart'ın ilk günü, "> Mart" son günü; "≤ Mart" son, "< Mart" ilk gün.
          const raw = values[0] != null ? values[0] : (['gte', 'gt'].includes(normalizedOp) ? item.from : item.to);
          const edge = ['gte', 'lt'].includes(normalizedOp) ? periodStart(raw, spec.calendar) : periodEnd(raw, spec.calendar);
          if (!edge) { errors.push(`bad-date:${field.id}`); continue; }
          filter.value = edge;
        }
      } else if (field.kind === 'number') {
        if (['in', 'not_in'].includes(normalizedOp)) {
          const numbers = values.map(parseNumber);
          if (!numbers.length || numbers.some(n => n == null)) { errors.push(`bad-number:${field.id}`); continue; }
          filter.values = numbers;
        } else if (normalizedOp === 'between') {
          const from = parseNumber(item.from != null ? item.from : values[0]), to = parseNumber(item.to != null ? item.to : values[1]);
          if (from == null || to == null) { errors.push(`bad-number-range:${field.id}`); continue; }
          filter.from = Math.min(from, to); filter.to = Math.max(from, to);
        } else if (!['empty', 'not_empty'].includes(normalizedOp)) {
          const n = parseNumber(values[0]);
          if (n == null) { errors.push(`bad-number:${field.id}`); continue; }
          filter.value = n;
        }
      }
      spec.filters.push(filter);
    }
    for (const [key, max] of [['rows', LIMITS.rows], ['columns', LIMITS.columns]]) {
      for (const item of asArray(input[key])) {
        const field = fieldOf(item, key);
        if (!field) continue;
        if (spec[key].length >= max) { errors.push(`too-many-${key}`); break; }
        spec[key].push({ field: field.id, bucket: bucketFor(field, item && item.bucket) });
      }
    }
    if (asArray(input.measures).length > LIMITS.measures) errors.push('too-many-measures');
    for (const item of asArray(input.measures).slice(0, LIMITS.measures)) {
      if (!item || typeof item !== 'object') continue;
      const agg = clean(item.agg || item.op || 'sum').toLowerCase().replace(/[\s-]+/g, '_');
      const aggName = { distinct: 'count_distinct', countdistinct: 'count_distinct', average: 'avg', mean: 'avg', total: 'sum', weighted_average: 'weighted_avg' }[agg] || agg;
      if (!AGGS.includes(aggName)) { errors.push(`bad-agg:${agg}`); continue; }
      if (aggName === 'count' && !item.field) { spec.measures.push({ agg: 'count', field: '' }); continue; }
      const field = fieldOf(item.field, 'measure');
      if (!field) continue;
      if (['sum', 'avg', 'weighted_avg'].includes(aggName) && field.kind !== 'number') { errors.push(`agg-needs-number:${aggName}:${field.id}`); continue; }
      if (['min', 'max'].includes(aggName) && field.kind === 'text') { errors.push(`agg-needs-number-or-date:${aggName}:${field.id}`); continue; }
      const measure = { agg: aggName, field: aggName === 'count' ? '' : field.id };
      if (aggName === 'weighted_avg') {
        if (!clean(item.weightField)) { errors.push('missing-weight-field'); continue; }
        const weight = fieldOf(item.weightField, 'weight');
        if (!weight) continue;
        if (weight.kind !== 'number') { errors.push(`weight-needs-number:${weight.id}`); continue; }
        measure.weightField = weight.id;
      }
      spec.measures.push(measure);
    }
    for (const item of asArray(input.list).slice(0, LIMITS.list)) { const field = fieldOf(item, 'list'); if (field && !spec.list.includes(field.id)) spec.list.push(field.id); }
    if (spec.list.length && (spec.rows.length || spec.measures.length)) { spec.rows = []; spec.columns = []; spec.measures = []; notes.push(T(lang, 'Liste istendiği için gruplama uygulanmadı.', 'A list was requested, so no grouping was applied.')); }
    if (!input.comparison && !spec.list.length && !spec.measures.length) {
      if (spec.rows.length) spec.measures.push({ agg: 'count', field: '' });
      else errors.push('nothing-to-show');
    }
    if (spec.columns.length && !spec.rows.length) { spec.rows = spec.columns; spec.columns = []; }
    const sort = input.sort && typeof input.sort === 'object' ? input.sort : null;
    if (sort) {
      const dir = clean(sort.dir).toLowerCase() === 'asc' ? 'asc' : 'desc';
      const index = Number(sort.by);
      if (Number.isInteger(index) && index >= 0 && index < spec.measures.length) spec.sort = { measure: index, dir };
      else { const field = resolveField(dataset, sort.by); if (field) spec.sort = { field: field.id, dir }; }
    }
    const limit = Math.trunc(Number(input.limit));
    if (limit > 0) spec.limit = Math.min(limit, 100000);
    let reference = null;
    if (input.comparison) {
      if (!LFL || input.comparison.type !== 'lfl') errors.push('unsupported-comparison');
      else {
        const comparison = LFL.normalize(input.comparison, spec, dataset, list, { normalizeSpec, resolveField, read }, lang);
        errors.push(...comparison.errors); notes.push(...comparison.notes); clarify = clarify || comparison.clarify; reference = comparison.reference;
      }
    } else {
      if (/\bLFL\b|LIKE[ -]FOR[ -]LIKE/i.test(request)) errors.push('missing-requested-analysis:lfl');
      errors.push(...validateRequestedMeasures(request, spec, dataset));
      errors.push(...validateAnalysisIntent(request, [{ spec, dataset }]));
      if (!deferCurrencyCheck && !errors.length && !clarify) errors.push(...validatePriceCurrencies(spec, dataset));
    }
    return { ok: errors.length === 0, spec, notes: [...new Set(notes)], errors, clarify, dataset, reference };
  }
  /* Dar bir eksiksizlik kontrolü: açıkça adlandırılmış sayısal alan/işlem
     çiftleri. Filtre/sezon/ürün yorumunu yeniden yapan ikinci bir NL motoru
     değildir; hata mevcut tek plan onarım turuna gider, sayı uydurulmaz. */
  function validateRequestedMeasures(request, spec, dataset) {
    const errors = new Set();
    const need = (field, agg) => {
      if (!spec.measures.some(m => m.field === field.id && m.agg === agg)) errors.add(`missing-requested-measure:${agg}:${field.id}`);
    };
    for (const clause of token(request).split(/\s+(?:VE|AND)\s+/)) {
      const text = ` ${clause} `;
      const weighted = /\b(?:AGIRLIKLI|WEIGHTED)\b/.test(text);
      const fields = dataset.fields.filter(f => f.kind === 'number' && [f.id, ...aliasesOf(f)].some(alias => text.includes(` ${token(alias)} `)));
      const targets = weighted && fields.some(f => f.canonical !== 'orderQuantity') ? fields.filter(f => f.canonical !== 'orderQuantity') : fields;
      for (const field of targets) {
        if (weighted) need(field, 'weighted_avg');
        else if (/\b(?:ORTALAMA\w*|AVERAGE|MEAN|AVG)\b/.test(text)) need(field, 'avg');
        else if (/\b(?:TOPLAM\w*|TOTAL|SUM)\b/.test(text)) need(field, 'sum');
        if (/\b(?:MINIMUM|MIN|EN DUSUK)\b/.test(text)) need(field, 'min');
        if (/\b(?:MAXIMUM|MAKSIMUM|MAX|EN YUKSEK)\b/.test(text)) need(field, 'max');
      }
      // Türkçe iyelik eki: "toplam adetini" alan eş anlamlısına tam eşit değildir.
      if (/\b(?:TOPLAM\w*|TOTAL|SUM)\s+(?:SIPARIS\s+)?(?:ADET\w*|MIKTAR\w*|QUANTITY|QTY)\b|\b(?:ADET\w*|MIKTAR\w*|QUANTITY|QTY)\s+(?:TOPLAM\w*|TOTAL|SUM)\b/.test(text)) {
        const qty = dataset.fields.find(f => f.canonical === 'orderQuantity');
        if (qty) need(qty, 'sum');
      }
    }
    return [...errors];
  }
  function validateAnalysisIntent(request, queries) {
    const text = token(request), errors = [];
    const quoted = /\b(?:TEKLIF\w*|QUOT\w*)\b|FIYAT VER\w*|PRICE OFFER/.test(text) && /EN (?:UYGUN|DUSUK|UCUZ)|LOWEST|CHEAPEST|BEST PRICE/.test(text);
    const volume = /EN COK.*SIPARIS|MOST.*ORDER|HIGHEST.*VOLUME/.test(text);
    const grouping = q => q.dataset && q.spec && q.spec.rows?.some(d => q.dataset.fields.find(f => f.id === d.field)?.canonical === 'manufacturer');
    if (quoted && !queries.some(q => q.dataset?.id === 'quotations' && grouping(q) && q.spec.measures.some(m => m.agg === 'min' && q.dataset.fields.find(f => f.id === m.field)?.canonical === 'fob'))) errors.push('missing-requested-analysis:quotation-supplier-minimum');
    if (volume && !queries.some(q => ['orders', 'cp'].includes(q.dataset?.id) && grouping(q) && q.spec.measures.some(m => (m.agg === 'sum' && q.dataset.fields.find(f => f.id === m.field)?.canonical === 'orderQuantity') || (m.agg === 'count_distinct' && q.dataset.fields.find(f => f.id === m.field)?.canonical === 'orderCode')))) errors.push('missing-requested-analysis:order-volume-by-supplier');
    return errors;
  }
  function validatePriceCurrencies(spec, dataset) {
    if (!spec.measures.some(m => m.agg !== 'count_distinct' && ['fob', 'supplierFob'].includes(dataset.fields.find(f => f.id === m.field)?.canonical))) return [];
    const currency = dataset.fields.find(f => f.canonical === 'currency'), country = dataset.fields.find(f => f.canonical === 'country');
    const dims = [...spec.rows, ...spec.columns];
    if (currency && dims.some(d => d.field === currency.id)) return [];
    if (!currency && country && dims.some(d => d.field === country.id)) return [];
    if (!currency && !country) return [];
    const currencies = new Set();
    for (const row of matchRows(spec, dataset)) {
      const explicit = currency ? token(read(currency, row)) : '';
      const nation = country ? token(read(country, row)) : '';
      const code = explicit || (nation ? (['TR', 'TURKIYE', 'TURKEY'].includes(nation) ? 'TRY' : 'USD') : '');
      currencies.add(code || '?');
      if (currencies.size > 1) return ['mixed-price-currencies:group-by-currency-or-country'];
    }
    return [];
  }
  function periodStart(value, calendar = 'gregorian') {
    const p = typeof value === 'string' || typeof value === 'number' ? periodOf(String(value)) : null;
    if (!p) return '';
    if (calendar !== 'gregorian' && p.bucket !== 'day') { const range = merchRange(p); return range ? range.start : ''; }
    if (p.bucket === 'day') return p.key;
    if (p.bucket === 'month') return `${p.key}-01`;
    if (p.bucket === 'year') return `${p.key}-01-01`;
    if (p.bucket === 'quarter') { const q = Number(p.key.slice(-1)); return `${p.key.slice(0, 4)}-${pad(q * 3 - 2)}-01`; }
    return '';
  }
  function periodEnd(value, calendar = 'gregorian') {
    const p = typeof value === 'string' || typeof value === 'number' ? periodOf(String(value)) : null;
    if (!p) return '';
    if (calendar !== 'gregorian' && p.bucket !== 'day') { const range = merchRange(p); return range ? range.end : ''; }
    const lastDay = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
    if (p.bucket === 'day') return p.key;
    if (p.bucket === 'month') { const [y, m] = p.key.split('-').map(Number); return `${p.key}-${pad(lastDay(y, m))}`; }
    if (p.bucket === 'year') return `${p.key}-12-31`;
    if (p.bucket === 'quarter') { const y = Number(p.key.slice(0, 4)), q = Number(p.key.slice(-1)); return `${y}-${pad(q * 3)}-${pad(lastDay(y, q * 3))}`; }
    return '';
  }

  /* ---------------- Çalıştırma ---------------- */
  function rowMatches(filter, value) {
    const empty = value === '' || value == null;
    if (filter.op === 'empty') return empty;
    if (filter.op === 'not_empty') return !empty;
    if (filter.op === 'in' || filter.op === 'not_in') {
      const target = filter.bucket ? bucketOf(value, filter.bucket, filter.calendar) : value;
      const hit = !empty && filter._set.has(target);
      return filter.op === 'in' ? hit : !hit;
    }
    if (filter.op === 'contains' || filter.op === 'not_contains') {
      const text = token(value);
      const hit = !empty && filter.values.some(part => text.includes(token(part)));
      return filter.op === 'contains' ? hit : !hit;
    }
    if (empty) return false;
    if (filter.op === 'between') return value >= filter.from && value <= filter.to;
    if (filter.op === 'gte') return value >= filter.value;
    if (filter.op === 'gt') return value > filter.value;
    if (filter.op === 'lte') return value <= filter.value;
    if (filter.op === 'lt') return value < filter.value;
    return true;
  }
  const EMPTY = '\u0000';
  function groupKey(field, bucket, row, calendar) {
    const value = read(field, row);
    if (value === '' || value == null) return EMPTY;
    return bucket ? bucketOf(value, bucket, calendar) : value;
  }
  function newAcc(measure) { return { agg: measure.agg, sum: 0, n: 0, min: null, max: null, weightSum: 0, excluded: 0, currencies: measure._price ? new Set() : null, set: measure.agg === 'count_distinct' ? new Set() : null }; }
  function addAcc(acc, value, weight, currency) {
    if (acc.agg === 'count') { acc.n++; return; }
    // FOB: CP/Orders kolWeightedAverage/kolArithmeticAverage ile aynı fiyat kuralı.
    if (acc.currencies && !(value > 0)) { if (acc.agg === 'weighted_avg') acc.excluded++; return; }
    if (acc.agg === 'weighted_avg') {
      // Yalnız geçerli değer + pozitif sonlu ağırlık çifti her iki toplama girer.
      if (!Number.isFinite(value) || !Number.isFinite(weight) || weight <= 0 || !Number.isFinite(value * weight)) { acc.excluded++; return; }
      if (acc.currencies) acc.currencies.add(currency);
      acc.sum += value * weight; acc.weightSum += weight; acc.n++;
      return;
    }
    if (value === '' || value == null) return;
    if (acc.agg === 'count_distinct') { acc.set.add(value); return; }
    if (acc.currencies) acc.currencies.add(currency);
    acc.n++;
    if (typeof value === 'number') acc.sum += value;
    if (acc.min == null || value < acc.min) acc.min = value;
    if (acc.max == null || value > acc.max) acc.max = value;
  }
  function accValue(acc) {
    if (!acc) return null;
    if (acc.currencies && acc.currencies.size > 1) return null;
    if (acc.agg === 'count') return acc.n;
    if (acc.agg === 'count_distinct') return acc.set.size;
    if (acc.agg === 'sum') return acc.n ? acc.sum : 0;
    if (acc.agg === 'avg') return acc.n ? acc.sum / acc.n : null;
    if (acc.agg === 'weighted_avg') return acc.weightSum > 0 && Number.isFinite(acc.sum) && Number.isFinite(acc.weightSum) ? acc.sum / acc.weightSum : null;
    if (acc.agg === 'min') return acc.min;
    if (acc.agg === 'max') return acc.max;
    return null;
  }
  const compareKeys = (a, b) => {
    if (a === b) return 0;
    if (a === EMPTY) return 1;
    if (b === EMPTY) return -1;
    if (a === OUTSIDE) return 1;
    if (b === OUTSIDE) return -1;
    const na = typeof a === 'number' ? a : null, nb = typeof b === 'number' ? b : null;
    if (na != null && nb != null) return na - nb;
    return String(a).localeCompare(String(b), 'tr', { numeric: true, sensitivity: 'base' });
  };
  function measureLabel(dataset, measure, lang) {
    if (measure.agg === 'count') return T(lang, 'Kayıt sayısı', 'Record count');
    const field = dataset.fields.find(item => item.id === measure.field);
    const name = field ? field.label : measure.field;
    if (measure.agg === 'weighted_avg') {
      const weight = dataset.fields.find(item => item.id === measure.weightField);
      return `${name} · ${T(lang, 'Ağırlıklı ortalama', 'Weighted average')} (${weight ? weight.label : measure.weightField})`;
    }
    const word = { sum: T(lang, 'Toplam', 'Total'), avg: T(lang, 'Ortalama', 'Average'), min: 'Min', max: 'Max', count_distinct: T(lang, 'farklı sayı', 'distinct count') }[measure.agg];
    return `${name} · ${word}`;
  }
  function bucketLabel(bucket, lang) {
    const labels = {
      day: { tr: 'gün', en: 'day' },
      week: { tr: 'hafta', en: 'week' },
      month: { tr: 'ay', en: 'month' },
      quarter: { tr: 'çeyrek', en: 'quarter' },
      year: { tr: 'yıl', en: 'year' },
    };
    return labels[bucket] ? labels[bucket][lang === 'en' ? 'en' : 'tr'] : '';
  }
  function dimLabel(dataset, dim, lang, calendar = 'merch') {
    const field = dataset.fields.find(item => item.id === dim.field);
    const name = field ? field.label : dim.field;
    if (!dim.bucket) return name;
    if (dim.bucket === 'day') return `${name} (${bucketLabel('day', lang)})`;
    return calendar === 'gregorian' ? `${name} (${bucketLabel(dim.bucket, lang)}, ${T(lang, 'miladi', 'Gregorian')})` : `${name} (LCW ${bucketLabel(dim.bucket, lang)})`;
  }
  const emptyLabel = lang => T(lang, '(boş)', '(blank)');
  /* Doğrulanmış plan + veri kümesi → tablo. Hiçbir değer tahmin edilmez. */
  function* matchSteps(spec, dataset) {
    const byId = id => dataset.fields.find(field => field.id === id);
    const filters = spec.filters.map(filter => ({ ...filter, _field: byId(filter.field), _set: new Set(filter.values || []) }));
    const matched = [];
    let batch = 0, since = Date.now();
    for (const row of dataset.rows) {
      let ok = true;
      for (const filter of filters) { if (!rowMatches(filter, read(filter._field, row))) { ok = false; break; } }
      if (ok) matched.push(row);
      if (++batch % 256 === 0 && Date.now() - since >= 8) { yield; since = Date.now(); }
    }
    return matched;
  }
  function finishSteps(steps) { let next = steps.next(); while (!next.done) next = steps.next(); return next.value; }
  function matchRows(spec, dataset) { return finishSteps(matchSteps(spec, dataset)); }
  function execute(spec, dataset, options = {}) { return finishSteps(executeSteps(spec, dataset, options)); }
  async function executeAsync(spec, dataset, options = {}) {
    const steps = executeSteps(spec, dataset, options);
    const check = () => { if (options.cancelled?.()) throw Object.assign(new Error('cancelled'), { code: 'LCWAI_CANCELLED' }); };
    check();
    let next = steps.next();
    while (!next.done) { await new Promise(resolve => setTimeout(resolve, 0)); check(); next = steps.next(); }
    return next.value;
  }
  function* executeSteps(spec, dataset, { lang = 'tr', reference = dataset, datasets = [dataset] } = {}) {
    if (spec.queries) {
      const results = [];
      for (const q of spec.queries) {
        const ds = datasets.find(d => d.id === q.dataset), ref = datasets.find(d => d.id === q.comparison?.referenceDataset);
        if (!ds || (q.comparison && !ref)) throw new Error('query-dataset-unavailable');
        const computed = yield* executeSteps(q, ds, { lang, reference: ref });
        results.push({ title: q.title || ds.label, computed, lines: describe(q, ds, computed, lang) });
      }
      return { kind: 'multi', results, rows: results.flatMap(r => r.computed.rows), matched: results.reduce((n,r) => n+r.computed.matched, 0), scanned: results.reduce((n,r) => n+r.computed.scanned, 0) };
    }
    if (spec.comparison) return yield* LFL.steps(spec, dataset, reference, { read, matchRows, matchSteps, token }, lang);
    const byId = id => dataset.fields.find(field => field.id === id);
    const matched = yield* matchSteps(spec, dataset);
    const calendar = spec.calendar === 'gregorian' ? 'gregorian' : 'merch';
    const out = { columns: [], rows: [], total: null, matched: matched.length, scanned: dataset.rows.length, truncatedColumns: 0, outsideCalendar: 0, kind: spec.list.length ? 'list' : 'aggregate' };
    if (spec.list.length) {
      const fields = spec.list.map(byId);
      out.columns = fields.map(field => ({ label: field.label, kind: field.kind }));
      // Kaynak satır, sıralama ve limit sonrası da değer satırıyla hizalı kalır
      // (model görseli anahtarı ve kart bilgisi için; serileştirilmez).
      let pairs = matched.map(row => ({ row, values: fields.map(field => read(field, row)) }));
      if (spec.sort && spec.sort.field) { const i = spec.list.indexOf(spec.sort.field); if (i >= 0) pairs.sort((a, b) => compareKeys(a.values[i] === '' ? EMPTY : a.values[i], b.values[i] === '' ? EMPTY : b.values[i]) * (spec.sort.dir === 'asc' ? 1 : -1)); }
      if (spec.limit) pairs = pairs.slice(0, spec.limit);
      out.rows = pairs.map(pair => pair.values.map(value => (value === '' ? null : value)));
      Object.defineProperty(out, 'sourceRows', { value: pairs.map(pair => pair.row), enumerable: false });
      return out;
    }
    const rowDims = spec.rows.map(dim => ({ ...dim, _field: byId(dim.field) }));
    const colDim = spec.columns[0] ? { ...spec.columns[0], _field: byId(spec.columns[0].field) } : null;
    const measures = spec.measures.map(measure => ({ ...measure, _field: measure.field ? byId(measure.field) : null, _weight: measure.weightField ? byId(measure.weightField) : null, _price: measure.agg !== 'count_distinct' && ['fob', 'supplierFob'].includes(byId(measure.field)?.canonical) }));
    const hasWeights = measures.some(measure => measure._weight);
    const currencyField = measures.some(m => m._price) ? dataset.fields.find(f => f.canonical === 'currency') : null;
    const countryField = measures.some(m => m._price) ? dataset.fields.find(f => f.canonical === 'country') : null;
    const groups = new Map(); // satır anahtarı → { keys, cells: Map(colKey → acc[]), total: acc[] }
    const colTotals = new Map();
    const grand = measures.map(newAcc);
    const colSeen = new Map();
    let batch = 0, since = Date.now();
    for (const row of matched) {
      const keys = rowDims.map(dim => groupKey(dim._field, dim.bucket, row, calendar));
      const key = keys.join('␟');
      if (!groups.has(key)) groups.set(key, { keys, cells: new Map(), total: measures.map(newAcc) });
      const group = groups.get(key);
      const values = measures.map(measure => (measure._field ? read(measure._field, row) : 1));
      const weights = hasWeights ? measures.map(measure => (measure._weight ? read(measure._weight, row) : null)) : null;
      const explicitCurrency = currencyField ? token(read(currencyField, row)) : '';
      const nation = !explicitCurrency && countryField ? token(read(countryField, row)) : '';
      const currency = explicitCurrency || (nation ? (['TR', 'TURKIYE', 'TURKEY'].includes(nation) ? 'TRY' : 'USD') : '?');
      values.forEach((value, i) => { addAcc(group.total[i], value, weights && weights[i], currency); addAcc(grand[i], value, weights && weights[i], currency); });
      if (keys.includes(OUTSIDE)) out.outsideCalendar++;
      if (colDim) {
        const colKey = groupKey(colDim._field, colDim.bucket, row, calendar);
        if (colKey === OUTSIDE && !keys.includes(OUTSIDE)) out.outsideCalendar++;
        colSeen.set(colKey, (colSeen.get(colKey) || 0) + 1);
        if (!group.cells.has(colKey)) group.cells.set(colKey, measures.map(newAcc));
        if (!colTotals.has(colKey)) colTotals.set(colKey, measures.map(newAcc));
        values.forEach((value, i) => { addAcc(group.cells.get(colKey)[i], value, weights && weights[i], currency); addAcc(colTotals.get(colKey)[i], value, weights && weights[i], currency); });
      }
      if (++batch % 256 === 0 && Date.now() - since >= 8) { yield; since = Date.now(); }
    }
    let colKeys = colDim ? [...colSeen.keys()].sort(compareKeys) : [];
    const maxCols = Math.max(1, Math.floor((LIMITS.excelCols - rowDims.length - measures.length) / Math.max(1, measures.length)));
    if (colKeys.length > Math.min(LIMITS.pivotColumns, maxCols)) {
      const keep = new Set([...colSeen.entries()].sort((a, b) => b[1] - a[1]).slice(0, Math.min(LIMITS.pivotColumns, maxCols)).map(([k]) => k));
      out.truncatedColumns = colKeys.length - keep.size;
      colKeys = colKeys.filter(k => keep.has(k));
    }
    // Anahtarlar sıralama içindir; görünen ad LCW dönem adıdır ("Mart 2026").
    const keyText = (value, dim) => (value === EMPTY ? emptyLabel(lang) : dim && dim.bucket ? periodLabel(value, dim.bucket, calendar, lang) : value);
    out.columns = rowDims.map(dim => ({ label: dimLabel(dataset, dim, lang, calendar), kind: 'text' }));
    if (colDim) {
      for (const colKey of colKeys) for (const measure of measures) out.columns.push({ label: measures.length > 1 ? `${keyText(colKey, colDim)} · ${measureLabel(dataset, measure, lang)}` : String(keyText(colKey, colDim)), kind: 'number', pivot: true });
      for (const measure of measures) out.columns.push({ label: measures.length > 1 ? `${T(lang, 'Toplam', 'Total')} · ${measureLabel(dataset, measure, lang)}` : T(lang, 'Toplam', 'Total'), kind: 'number', total: true });
    } else for (const measure of measures) out.columns.push({ label: measureLabel(dataset, measure, lang), kind: measure.agg === 'min' || measure.agg === 'max' ? (measure._field && measure._field.kind === 'date' ? 'date' : 'number') : 'number' });
    let list = [...groups.values()];
    if (spec.sort && spec.sort.measure != null) list.sort((a, b) => ((accValue(a.total[spec.sort.measure]) ?? -Infinity) - (accValue(b.total[spec.sort.measure]) ?? -Infinity)) * (spec.sort.dir === 'asc' ? 1 : -1));
    else {
      // Varsayılan: satır anahtarları artan (tarihler kronolojik, boş en sonda).
      // Bir satır alanına göre sıralama istendiyse o alan önce gelir.
      const first = spec.sort && spec.sort.field ? Math.max(0, spec.rows.findIndex(dim => dim.field === spec.sort.field)) : 0;
      const dir = spec.sort && spec.sort.field && spec.sort.dir === 'desc' ? -1 : 1;
      const order = [first, ...rowDims.map((_, k) => k).filter(k => k !== first)];
      list.sort((a, b) => { for (const k of order) { const c = compareKeys(a.keys[k], b.keys[k]); if (c) return k === first ? c * dir : c; } return 0; });
    }
    if (spec.limit) list = list.slice(0, spec.limit);
    out.rows = list.map(group => {
      const cells = group.keys.map((key, k) => keyText(key, rowDims[k]));
      if (colDim) {
        for (const colKey of colKeys) { const accs = group.cells.get(colKey); measures.forEach((_, i) => cells.push(accs ? accValue(accs[i]) : null)); }
        measures.forEach((_, i) => cells.push(accValue(group.total[i])));
      } else measures.forEach((_, i) => cells.push(accValue(group.total[i])));
      return cells;
    });
    // Toplam satırı: limit uygulanmışsa bile TÜM eşleşen kayıtların toplamıdır.
    const totalCells = rowDims.map((_, i) => (i === 0 ? T(lang, 'Toplam', 'Total') : ''));
    if (colDim) {
      for (const colKey of colKeys) measures.forEach((_, i) => totalCells.push(accValue(colTotals.get(colKey)[i])));
      measures.forEach((_, i) => totalCells.push(accValue(grand[i])));
    } else measures.forEach((_, i) => totalCells.push(accValue(grand[i])));
    out.total = rowDims.length ? totalCells : null;
    if (!rowDims.length) out.rows = [totalCells];
    out.measureStats = grand.map(acc => acc.agg === 'weighted_avg' ? { validRows: acc.n, excludedRows: acc.excluded, weightSum: acc.weightSum } : null);
    out.priceCurrencies = grand.map(acc => acc.currencies ? [...acc.currencies] : []);
    out.currencyConflict = [...groups.values()].some(group => colDim ? [...group.cells.values()].some(accs => accs.some(acc => acc.currencies?.size > 1)) : group.total.some(acc => acc.currencies?.size > 1));
    return out;
  }

  /* ---------------- Açıklama ve çıktı ---------------- */
  const numberFormat = lang => new Intl.NumberFormat(lang === 'en' ? 'en-US' : 'tr-TR', { maximumFractionDigits: 2 });
  function formatCell(value, column, lang) {
    if (value == null || value === '') return '';
    if (typeof value === 'number') return numberFormat(lang).format(value);
    return String(value);
  }
  function filterText(dataset, filter, lang) {
    const field = dataset.fields.find(item => item.id === filter.field);
    const name = field ? field.label : filter.field;
    const values = (filter.values || []).map(value => (typeof value === 'number' ? numberFormat(lang).format(value) : filter.bucket ? periodLabel(value, filter.bucket, filter.calendar, lang) : shortValue(value)));
    const join = values.length > 6 ? `${values.slice(0, 6).join(', ')} +${values.length - 6}` : values.join(', ');
    switch (filter.op) {
      case 'in': return `${name} = ${join}`;
      case 'not_in': return `${name} ≠ ${join}`;
      case 'contains': return T(lang, `${name} içinde “${join}”`, `${name} contains “${join}”`);
      case 'not_contains': return T(lang, `${name} içinde “${join}” yok`, `${name} does not contain “${join}”`);
      case 'between': return `${name}: ${filter.from} … ${filter.to}`;
      case 'gte': return `${name} ≥ ${filter.value}`;
      case 'gt': return `${name} > ${filter.value}`;
      case 'lte': return `${name} ≤ ${filter.value}`;
      case 'lt': return `${name} < ${filter.value}`;
      case 'empty': return T(lang, `${name} boş`, `${name} is blank`);
      case 'not_empty': return T(lang, `${name} dolu`, `${name} is not blank`);
      default: return name;
    }
  }
  function scopeText(dataset, lang) {
    return { all: T(lang, 'tüm kayıtlar (sayfa filtreleri uygulanmadan)', 'all records (page filters not applied)'), visible: T(lang, 'sayfada filtrelenmiş kayıtlar', 'records filtered on the page'), selected: T(lang, 'seçili kayıtlar', 'selected records') }[dataset.scope] || dataset.scope;
  }
  /* "Nasıl anladım" satırları — kullanıcı yorumu tek bakışta doğrular. */
  function describe(spec, dataset, result, lang = 'tr') {
    if (spec.queries) return (result?.results || []).flatMap(r => [r.title, ...r.lines]);
    const n = numberFormat(lang);
    const lines = [`${T(lang, 'Veri', 'Data')}: ${dataset.label} — ${scopeText(dataset, lang)}, ${n.format(dataset.total)} ${T(lang, 'kayıt', 'records')}`];
    lines.push(`${T(lang, 'Filtre', 'Filter')}: ${spec.filters.length ? spec.filters.map(filter => filterText(dataset, filter, lang)).join(' · ') : T(lang, 'yok', 'none')}`);
    if (spec.list.length) lines.push(`${T(lang, 'Liste', 'List')}: ${spec.list.map(id => (dataset.fields.find(f => f.id === id) || { label: id }).label).join(', ')}`);
    if (spec.rows.length) lines.push(`${T(lang, 'Satırlar', 'Rows')}: ${spec.rows.map(dim => dimLabel(dataset, dim, lang, spec.calendar)).join(' › ')}`);
    if (spec.columns.length) lines.push(`${T(lang, 'Sütunlar', 'Columns')}: ${spec.columns.map(dim => dimLabel(dataset, dim, lang, spec.calendar)).join(', ')}`);
    if (spec.measures.length) lines.push(`${T(lang, 'Değer', 'Value')}: ${spec.measures.map(measure => measureLabel(dataset, measure, lang)).join(', ')}`);
    const period = calendarLine(spec, dataset, lang);
    if (period) lines.push(period);
    if (result) lines.push(`${T(lang, 'Eşleşen', 'Matched')}: ${n.format(result.matched)} / ${n.format(result.scanned)} ${T(lang, 'kayıt', 'records')}`);
    spec.measures.forEach((measure, i) => {
      const priceField = dataset.fields.find(f => f.id === measure.field);
      if (measure.agg !== 'count_distinct' && ['fob', 'supplierFob'].includes(priceField?.canonical)) lines.push(T(lang, `${priceField.label}: Buyer Log fiyat ortalamalarıyla aynı şekilde yalnız pozitif fiyatlar kullanıldı; sıfır ve negatif fiyatlar hesaba katılmadı.`, `${priceField.label}: only positive prices were used, matching Buyer Log price averages; zero and negative prices were excluded.`));
      if (result?.priceCurrencies?.[i]?.length > 1) lines.push(T(lang, `${measureLabel(dataset, measure, lang)}: farklı para birimleri (${result.priceCurrencies[i].join(', ')}) birleşmedi; bunları birleştiren toplam/ortalama hücreleri boştur.`, `${measureLabel(dataset, measure, lang)}: different currencies (${result.priceCurrencies[i].join(', ')}) were not combined; total/average cells that would combine them are blank.`));
      if (measure.agg !== 'weighted_avg') return;
      const field = dataset.fields.find(f => f.id === measure.field), weight = dataset.fields.find(f => f.id === measure.weightField);
      const valueName = field ? field.label : measure.field, weightName = weight ? weight.label : measure.weightField;
      lines.push(`${measureLabel(dataset, measure, lang)}: Σ(${valueName} × ${weightName}) / Σ(${weightName})`);
      const stats = result && result.measureStats && result.measureStats[i];
      if (stats) lines.push(T(lang,
        `${valueName}: ${n.format(stats.validRows)} geçerli kayıt, kullanılan ağırlık toplamı ${n.format(stats.weightSum)}; ${n.format(stats.excludedRows)} kayıt boş/geçersiz değer veya pozitif olmayan ağırlık nedeniyle hesaba katılmadı. Geçerli ağırlık yoksa ortalama boştur.`,
        `${valueName}: ${n.format(stats.validRows)} valid records, weight sum used ${n.format(stats.weightSum)}; ${n.format(stats.excludedRows)} records excluded for missing/invalid values or nonpositive weights. Without valid weights the average is blank.`));
    });
    if (result && result.outsideCalendar) lines.push(T(lang, `Merch Calendar dışı: ${n.format(result.outsideCalendar)} kayıt ayrı satır/sütunda gösterildi (tarihi yüklü takvimin aralığında değil).`, `Outside Merch Calendar: ${n.format(result.outsideCalendar)} records are shown in a separate row/column (their date is outside the loaded calendar).`));
    if (spec.comparison) {
      lines.push(T(lang, 'LFL: Like-for-Like fiyat kıyası; geçerli FOB ve adet > 0. Yalnız ortak kırılım/para birimi çiftleri karşılaştırıldı; Türkiye TRY, diğer ülkeler USD. Para birimleri birlikte ortalanmadı.', 'LFL: Like-for-Like price comparison; valid FOB and quantity > 0. Only shared breakdown/currency pairs were compared; Turkey TRY, other countries USD. Currencies were not averaged together.'));
      lines.push(`${T(lang, 'Güncel dönem', 'Current period')}: ${spec.comparison.currentFilters.map(f => filterText(dataset, f, lang)).join(' · ')}`);
      lines.push(`${T(lang, 'Kıyas kaynağı', 'Reference source')}: ${spec.comparison.referenceDataset}; ${spec.comparison.referenceFilters.map(f => filterText(dataset, f, lang)).join(' · ')}`);
      const s = result && result.comparisonStats;
      if (s) lines.push(T(lang, `Karşılaştırılabilir kayıt: güncel ${s.currentComparable}/${result.matched}, kıyas ${s.referenceComparable}/${s.referenceMatched}. Genel FOB değişimi: ${s.change == null ? '—' : n.format(s.change) + '%'}. Ortak çift yoksa fiyat değişimi hesaplanmaz.`, `Comparable records: current ${s.currentComparable}/${result.matched}, reference ${s.referenceComparable}/${s.referenceMatched}. Overall FOB change: ${s.change == null ? '—' : n.format(s.change) + '%'}. Without shared pairs, price change is unavailable.`));
    }
    return lines;
  }
  /* Dönemlerin hangi takvime göre hesaplandığı — kullanıcı her zaman görür. */
  function usesPeriods(spec, dataset) {
    const isDate = id => { const field = dataset.fields.find(item => item.id === id); return field && field.kind === 'date'; };
    return [...spec.rows, ...spec.columns].some(dim => dim.bucket && dim.bucket !== 'day') || spec.filters.some(filter => isDate(filter.field) && filter.op !== 'empty' && filter.op !== 'not_empty');
  }
  function calendarLine(spec, dataset, lang) {
    if (!usesPeriods(spec, dataset)) return '';
    if (spec.calendar === 'gregorian') return T(lang, 'Dönem: miladi takvim (istendiği için; LCW Merch Calendar kullanılmadı)', 'Periods: Gregorian calendar (as requested; LCW Merch Calendar not used)');
    if (!merchActive()) return T(lang, 'Dönem: LCW Merch Calendar yüklü değil — ay ve haftalar Buyer Log’un geçici hafta düzeniyle (pazartesi başlayan hafta, ayı haftanın pazarı belirler) hesaplandı. Kesin LCW dönemleri için Veri Yönetimi › Merch Calendar’ı yükleyin.', 'Periods: LCW Merch Calendar is not loaded — months and weeks use Buyer Log’s interim week layout (Monday-start weeks, the month of the week’s Sunday). Upload it under Data Management › Merch Calendar for exact LCW periods.');
    const meta = DD.merchCalendarMeta() || {};
    const range = meta.minDate && meta.maxDate ? ` ${meta.minDate} … ${meta.maxDate}` : '';
    return T(lang, `Dönem: LCW Merch Calendar (yüklü takvim${range})`, `Periods: LCW Merch Calendar (loaded calendar${range})`);
  }
  const mdCell = value => String(value == null ? '' : value).replace(/\|/g, '¦').replace(/[\r\n]+/g, ' ');
  function toMarkdown(result, { lang = 'tr', maxRows = LIMITS.chatRows } = {}) {
    if (result.kind === 'multi') return result.results.map(r => `**${mdCell(r.title)}**\n\n${toMarkdown(r.computed, { lang, maxRows })}`).join('\n\n');
    if (!result.columns.length) return '';
    const head = `| ${result.columns.map(col => mdCell(col.label)).join(' | ')} |`;
    const sep = `| ${result.columns.map(() => '---').join(' | ')} |`;
    const body = result.rows.slice(0, maxRows).map(row => `| ${row.map((value, i) => mdCell(formatCell(value, result.columns[i], lang))).join(' | ')} |`);
    if (result.total) body.push(`| ${result.total.map((value, i) => mdCell(i === 0 ? `**${formatCell(value, result.columns[i], lang)}**` : formatCell(value, result.columns[i], lang))).join(' | ')} |`);
    return [head, sep, ...body].join('\n');
  }
  /* Excel çalışma kitabı (output-contracts normalizeWorkbook biçimi). Uzun
     listeler 5.000 satırlık sayfalara bölünür. */
  function toWorkbook(result, { title, lines = [], notes = [], lang = 'tr' } = {}) {
    if (result.kind === 'multi') {
      const books = result.results.map(r => toWorkbook(r.computed, { title: r.title, lines: r.lines, notes, lang }));
      const sheets = books.flatMap((b, i) => b.sheets.map(s => ({ ...s, name: `${i + 1} ${s.name}` })));
      if (sheets.length > LIMITS.excelSheets) throw new Error('too-many-excel-sheets');
      return { title: clean(title) || T(lang, 'Buyer Log analizleri', 'Buyer Log analyses'), notes: [...lines, ...notes].slice(0, 30), sheets };
    }
    const columns = result.columns.slice(0, LIMITS.excelCols).map(col => ({ header: col.label.slice(0, 120), type: col.kind === 'number' ? 'number' : col.kind === 'date' ? 'date' : 'text' }));
    const rows = result.rows.map(row => row.slice(0, columns.length));
    if (result.total) rows.push(result.total.slice(0, columns.length));
    const sheets = [];
    for (let start = 0; start < Math.max(1, rows.length) && sheets.length < LIMITS.excelSheets; start += LIMITS.excelSheetRows) {
      sheets.push({ name: `${T(lang, 'Sonuç', 'Result')}${rows.length > LIMITS.excelSheetRows ? ` ${sheets.length + 1}` : ''}`, columns, rows: rows.slice(start, start + LIMITS.excelSheetRows) });
    }
    const omitted = Math.max(0, rows.length - LIMITS.excelSheetRows * LIMITS.excelSheets);
    return {
      title: clean(title).slice(0, 140) || T(lang, 'Buyer Log veri sorgusu', 'Buyer Log data query'),
      subtitle: T(lang, 'Buyer Log tüm kayıtlar üzerinde hesapladı; LCW AI yalnız isteği yorumladı.', 'Calculated by Buyer Log on all records; LCW AI only interpreted the request.'),
      notes: [...lines, ...notes, ...(omitted ? [T(lang, `${omitted} satır Excel sınırı nedeniyle eklenmedi.`, `${omitted} rows were not included because of the Excel limit.`)] : [])].slice(0, 30),
      sheets,
    };
  }

  /* ---------------- Veri isteği sezgisi ----------------
     Mesaj veri hesabı istiyor olabilir mi? (Planlayıcı yine "chat" diyebilir.)
     Türkçe karakter ve yazım hatasına dayanıklı olsun diye kelimeler token'a
     çevrilip kök eşleşmesiyle aranır. */
  const DATA_STEMS = ['LFL', 'ANALIZ', 'ANALYSIS', 'TEKLIF', 'QUOTATION', 'SIPARIS', 'SIPRS', 'ORDER', 'ADET', 'MIKTAR', 'TOPLAM', 'SAYI', 'KAC', 'TABLO', 'LISTE', 'GRUPLA', 'BAZLI', 'BAZINDA', 'PIVOT', 'SEZON', 'SEASON', 'ULKE', 'COUNTRY', 'URETICI', 'TEDARIKCI', 'SUPPLIER', 'LISANS', 'LICENSE', 'BUYING', 'MAG', 'MMYG', 'EXFACTORY', 'EX F', 'MB', 'BUTCE', 'BUDGET', 'TARIH', 'AYLIK', 'HAFTALIK', 'YUKLEME', 'SEVK', 'SHIPMENT', 'QTY', 'QUANTITY', 'COUNT', 'SUM', 'TOTAL', 'PO', 'MODEL', 'RENK', 'FOB', 'KOLEKSIYON', 'COLLECTION', 'BACKLOG', 'CP', 'GECIKEN', 'GECIKME', 'DELAY']; // i18n-ignore — sezgisel arama kökleri
  const SCREEN_STEMS = { orders: ['SIPARIS', 'SIPRS', 'ORDER', 'PO'], cp: ['CP', 'TRACKER'], koleksiyon: ['KOLEKSIYON', 'COLLECTION'], shipping: ['NAKLIYE', 'NAVLUN', 'SHIPPING', 'FREIGHT'], backlog: ['BACKLOG'], overview: ['OVERVIEW', 'GENEL BAKIS'] }; // i18n-ignore — ekran adı kökleri
  function words(text) { return token(text).split(' ').filter(Boolean); }
  function hasStem(list, stems) {
    const joined = ` ${list.join(' ')} `;
    return stems.some(stem => (stem.includes(' ') ? joined.includes(` ${stem} `) : list.some(word => word === stem || (stem.length >= 4 && word.startsWith(stem)))));
  }
  function looksLikeDataRequest(text) {
    const list = words(text);
    if (!list.length) return false;
    let score = 0;
    for (const stem of DATA_STEMS) if (hasStem(list, [stem])) score++;
    return score >= 2 || (score >= 1 && list.length <= 6);
  }
  function screensIn(text) {
    const list = words(text);
    return Object.keys(SCREEN_STEMS).filter(screen => hasStem(list, SCREEN_STEMS[screen]));
  }

  return Object.freeze({
    VERSION, LIMITS, BUCKETS, AGGS, GLOSSARY, token, parseDate, parseNumber, bucketOf, periodOf, periodStart, periodEnd, periodLabel, merchRange, merchActive,
    createDataset, datasetFromRecords, read, distinctValues, profile, schemaText, schemaTextAsync, resolveField, matchValue, normalizeSpec, execute, executeAsync, matchRows,
    describe, toMarkdown, toWorkbook, formatCell, looksLikeDataRequest, screensIn, parseSpec,
  });
});
