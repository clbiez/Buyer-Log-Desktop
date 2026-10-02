/* Buyer Log — BACKLOG V3 RAPOR MODELİ + EXCEL YAZICISI
 *
 * Saf modül: DOM yok, fetch yok. Backlog Genel Bakış paneli ve "Excel Backlog
 * V3" aynı toplulaştırmayı buradan okur; ekrandaki sayı ile Excel'deki sayı
 * ayrışamaz.
 *
 * Alan okuma kuralı:
 *  - Ortak boyutlar (Buyer, Buying Group, Üretici, Sezon, Klasman, Ülke,
 *    Yükleme Tipi, sipariş kimlikleri) BLCanonicalFields 'backlog' bağlamasıyla.
 *  - Operasyon alanları (statü, Adet, Antrepo, revize Ex-Factory, risk)
 *    teslimat motorunun kanonik Backlog şablon anahtarlarından (FIELDS);
 *    aşama sınıflandırması da onun stageOf'u ile yapılır (tek kaynak).
 *
 * Excel görsel dili Planlanan & Gerçekleşen raporuyla ortaktır
 * (BLPlanActualReport.excelKit + yerel grafik enjeksiyonu).
 */
(function attachBacklogV3Report(root, factory) {
  const isNode = typeof module === 'object' && module.exports && typeof require === 'function';
  let canonical = root && root.BLCanonicalFields;
  let planActual = root && root.BLPlanActualReport;
  if (isNode) {
    canonical = require('./canonical-fields.js');
    try { require('./canonical-module-bindings.js')(canonical); } catch (_) { /* tarayıcı paketi zaten bağlar */ }
    planActual = require('./backlog-plan-actual-report.js');
  }
  const api = factory(root, () => canonical || (root && root.BLCanonicalFields), () => planActual || (root && root.BLPlanActualReport),
    () => (root && root.BLBacklogDeliveryEngine) || (isNode ? require('./backlog-delivery-engine.js') : null));
  if (isNode) module.exports = api;
  if (root) root.BLBacklogV3Report = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createBacklogV3Report(root, canonicalApi, planActualApi, engineApi) {
  'use strict';

  /* Aşamalar boru hattı sırasıyla: önce yüklenmemiş, sonra yolda, en sonda depo. */
  const STAGES = Object.freeze([
    { key:'SHORTAGE', color:'A8453A', tr:'Eksik Yükleme', en:'Shortage', preLoad:true },
    { key:'PRODUCTION', color:'5980A6', tr:'Üretimde', en:'In Production', preLoad:true },
    { key:'LOADING', color:'8C6A1F', tr:'Yükleme Operasyonları', en:'Loading Operations' },
    { key:'IN_TRANSIT', color:'6D53A8', tr:'Yolda', en:'In Transit' },
    { key:'CUSTOMS', color:'C4AE86', tr:'Gümrük-Liman', en:'Customs & Port' },
    { key:'AWAITING_RETAIL_TRANSFER', color:'3F7A6C', tr:'Retaile Aktarım Bekliyor', en:'Awaiting Retail Transfer' },
    { key:'IN_WAREHOUSE', color:'3F7757', tr:'Depoda', en:'In Warehouse' },
    { key:'UNKNOWN', color:'98A2B3', tr:'Durum Belirsiz', en:'Status Unknown' },
  ]);
  const STAGE_KEYS = STAGES.map(s => s.key);
  const PRE_LOAD = new Set(STAGES.filter(s => s.preLoad).map(s => s.key));
  /* Kırılım boyutları: kanonik alan kimlikleri. */
  const DIMENSIONS = Object.freeze(['buyer', 'buyingGroup', 'manufacturer', 'subManufacturer', 'season', 'category', 'country', 'deliveryType', 'line']);
  const TIMELINE_FIELDS = Object.freeze([
    { key:'exFactory', tr:'Ex-Factory (güncel)', en:'Ex-Factory (current)' },
    { key:'antrepo', tr:'Antrepo Giriş', en:'Warehouse Arrival' },
    { key:'retail', tr:'Retail Depo', en:'Retail Warehouse' },
    { key:'inStore', tr:'In-Store', en:'In-Store' },
  ]);
  /* Delivery engine yüklenmemişse kullanılan şablon anahtarları; engine
     yüklüyse onun FIELDS sözlüğü esas alınır. */
  const FALLBACK_FIELDS = Object.freeze({
    status:'GÜNCEL DURUM\n(STATUS)', revisedLoad:'REVİZE YÜKLEME TARİHİ\n(EX-FACTORY)', plannedLoad:'Orijinal Exfactory Merch Tarih',
    antrepo:'ANTREPO GİRİŞ TARİHİ', retail:'Retail Depo Tarih Yıl Ay Gün', inStore:'Model Bütçe Tarih Yıl Ay Gün', qty:'Adet',
  });
  const RISK_HEADER = 'RİSK\n(PRIORITY)';

  const num = value => { const n = Number(value); return Number.isFinite(n) ? n : 0; };
  const round = value => Math.round((num(value) + Number.EPSILON) * 100) / 100;
  const text = value => String(value == null ? '' : value).trim();
  const pick = (lang, item) => (lang === 'en' ? item.en : item.tr);
  function fields() { const eng = engineApi(); return (eng && eng.FIELDS) || FALLBACK_FIELDS; }
  function turk(value) {
    return text(value).toLocaleUpperCase('tr-TR').replace(/İ/g, 'I').replace(/Ş/g, 'S').replace(/Ğ/g, 'G').replace(/Ü/g, 'U').replace(/Ö/g, 'O').replace(/Ç/g, 'C').replace(/\s+/g, ' ');
  }
  function stageOf(status) {
    const eng = engineApi();
    if (eng && typeof eng.stageOf === 'function') { const s = eng.stageOf(status); if (STAGE_KEYS.includes(s)) return s; }
    const key = turk(status);
    if (!key) return 'UNKNOWN';
    if (key.includes('EKSIK')) return 'SHORTAGE';
    if (key.includes('URETIM')) return 'PRODUCTION';
    if (key.includes('YUKLEME')) return 'LOADING';
    if (key.includes('YOL')) return 'IN_TRANSIT';
    if (key.includes('GUMRUK')) return 'CUSTOMS';
    if (key.includes('RETAIL')) return 'AWAITING_RETAIL_TRANSFER';
    if (key.includes('DEPO')) return 'IN_WAREHOUSE';
    return 'UNKNOWN';
  }
  function stageLabel(key, lang) {
    const eng = engineApi(), labels = eng && eng.STAGE_LABELS && eng.STAGE_LABELS[lang === 'en' ? 'en' : 'tr'];
    if (labels && labels[key]) return labels[key];
    const s = STAGES.find(item => item.key === key);
    return s ? pick(lang, s) : key;
  }
  function dimLabel(id, lang) {
    const c = canonicalApi();
    return c && typeof c.label === 'function' ? c.label(id, lang) : id;
  }
  function canon(row, id) {
    const c = canonicalApi();
    return c && typeof c.value === 'function' ? text(c.value(row, 'backlog', id)) : '';
  }
  /* Tarih değeri takvim gününe (YYYY-MM-DD) çevrilir; saat dilimi kaydırmaz. */
  function dayIso(value) {
    if (value == null || value === '') return '';
    if (value instanceof Date) {
      if (Number.isNaN(value.getTime())) return '';
      const utcMidnight = value.getUTCHours() === 0 && value.getUTCMinutes() === 0;
      const localMidnight = value.getHours() === 0 && value.getMinutes() === 0;
      const d = utcMidnight && !localMidnight
        ? [value.getUTCFullYear(), value.getUTCMonth() + 1, value.getUTCDate()]
        : [value.getFullYear(), value.getMonth() + 1, value.getDate()];
      return d[0] + '-' + String(d[1]).padStart(2, '0') + '-' + String(d[2]).padStart(2, '0');
    }
    const raw = text(value);
    // JSON zaman damgası ("2026-03-09T21:00:00.000Z" = TR'de 10.03) önce Date'e
    // çevrilir; ilk 10 karakter UTC günüdür ve UTC+X'te bir gün geride kalır.
    if (/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(raw)) { const parsed = new Date(raw); if (!Number.isNaN(parsed.getTime())) return dayIso(parsed); }
    let m = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return m[1] + '-' + m[2] + '-' + m[3];
    m = raw.match(/^(\d{4})(\d{2})(\d{2})$/);
    if (m) return m[1] + '-' + m[2] + '-' + m[3];
    m = raw.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/);
    if (m) return m[3] + '-' + m[2].padStart(2, '0') + '-' + m[1].padStart(2, '0');
    return '';
  }
  function ordinal(iso) {
    const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    return m ? Math.floor(Date.UTC(+m[1], +m[2] - 1, +m[3]) / 86400000) : null;
  }
  function isoFromOrdinal(ord) { return new Date(ord * 86400000).toISOString().slice(0, 10); }
  function todayIso(now) { return dayIso(now instanceof Date ? now : new Date()); }

  /* Bir Backlog şablon satırını rapor kaydına çevirir. */
  function normalizeRow(row, context) {
    const F = fields(), ctx = context || {};
    const status = text(row && row[F.status]);
    const stage = stageOf(status);
    const exFactory = dayIso(row && row[F.revisedLoad]) || dayIso(canonicalApi() && canonicalApi().value(row, 'backlog', 'exFactory')) || dayIso(row && row[F.plannedLoad]);
    const meta = row && row._backlogExcel && typeof row._backlogExcel === 'object' ? row._backlogExcel : {};
    const item = {
      row, status, stage, qty:Math.max(0, num(row && row[F.qty])),
      orderCode:canon(row, 'orderCode'), modelName:canon(row, 'modelName'), colourCode:canon(row, 'colourCode'), colour:canon(row, 'colour'),
      exFactory, plannedExFactory:dayIso(row && row[F.plannedLoad]),
      antrepo:dayIso(row && row[F.antrepo]), retail:dayIso(row && row[F.retail]), inStore:dayIso(row && row[F.inStore]),
      risk:turk(row && row[RISK_HEADER]) === 'VAR',
      transitOverdue:meta.transitOverdue === true,
      exInheritedFrom:text(meta.exFactoryInheritedFrom),
    };
    DIMENSIONS.forEach(id => { item[id] = canon(row, id); });
    item.season = canon(row, 'season');
    // Sunucu tarihleri gün metni olarak gönderir; saatli ham değer bir veri yolu hatasıdır.
    item.rawTimestampFields = Object.keys(row || {}).filter(key => key[0] !== '_' && typeof row[key] === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(row[key]));
    item.lineId = [item.orderCode, item.modelName, item.colourCode].join('\u001f');
    const today = ordinal(ctx.today || todayIso());
    const exOrd = ordinal(exFactory);
    item.overdueNotLoaded = PRE_LOAD.has(stage) && exOrd != null && today != null && exOrd < today;
    item.overdueDays = item.overdueNotLoaded ? today - exOrd : 0;
    return item;
  }
  function normalizeRows(rows, context) { return (Array.isArray(rows) ? rows : []).map(row => normalizeRow(row, context)); }

  function emptyStages() { const out = {}; STAGE_KEYS.forEach(k => { out[k] = 0; }); return out; }
  function summarize(items) {
    const out = { qty:0, lines:0, orders:0, rows:0, stages:emptyStages(), stageLines:emptyStages(), riskQty:0, overdueQty:0, overdueLines:0, transitOverdueQty:0, loadedQty:0, preLoadQty:0 };
    const lines = new Set(), orders = new Set(), overdueLines = new Set(), stageLines = {};
    STAGE_KEYS.forEach(k => { stageLines[k] = new Set(); });
    (items || []).forEach(item => {
      out.rows += 1; out.qty += item.qty;
      out.stages[item.stage] += item.qty;
      stageLines[item.stage].add(item.lineId);
      lines.add(item.lineId); if (item.orderCode) orders.add(item.orderCode);
      if (item.risk) out.riskQty += item.qty;
      if (item.transitOverdue) out.transitOverdueQty += item.qty;
      if (item.overdueNotLoaded) { out.overdueQty += item.qty; overdueLines.add(item.lineId); }
      if (PRE_LOAD.has(item.stage)) out.preLoadQty += item.qty; else out.loadedQty += item.qty;
    });
    out.lines = lines.size; out.orders = orders.size; out.overdueLines = overdueLines.size;
    STAGE_KEYS.forEach(k => { out.stages[k] = round(out.stages[k]); out.stageLines[k] = stageLines[k].size; });
    ['qty', 'riskQty', 'overdueQty', 'transitOverdueQty', 'loadedQty', 'preLoadQty'].forEach(k => { out[k] = round(out[k]); });
    out.loadedPct = out.qty > 0 ? out.loadedQty / out.qty : null;
    return out;
  }
  function groupBy(items, key, options) {
    const opts = options || {}, blank = opts.blank || '(boş)', map = new Map();
    (items || []).forEach(item => {
      const name = text(item[key]) || blank;
      if (!map.has(name)) map.set(name, []);
      map.get(name).push(item);
    });
    const list = [...map.entries()].map(([name, list2]) => ({ name, items:list2, ...summarize(list2) }));
    list.sort((a, b) => (b.qty - a.qty) || a.name.localeCompare(b.name, 'tr', { numeric:true }));
    return opts.limit ? list.slice(0, opts.limit) : list;
  }
  /* ISO hafta: Pazartesi başlangıçlı; anahtar haftanın Pazartesi günüdür. */
  function bucketOf(iso, granularity) {
    const ord = ordinal(iso);
    if (ord == null) return null;
    if (granularity === 'month') { const key = iso.slice(0, 7) + '-01'; return { key, start:key }; }
    const weekday = (new Date(ord * 86400000).getUTCDay() + 6) % 7;
    const start = isoFromOrdinal(ord - weekday);
    return { key:start, start };
  }
  function isoWeekNo(startIso) {
    const d = new Date(startIso + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + 3);
    const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
    return 1 + Math.round(((d - firstThursday) / 86400000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
  }
  function bucketLabel(bucket, granularity, lang) {
    if (!bucket) return lang === 'en' ? 'No date' : 'Tarih yok';
    const [y, m, d] = bucket.start.split('-');
    if (granularity === 'month') return m + '.' + y;
    return (lang === 'en' ? 'W' : 'H') + isoWeekNo(bucket.start) + ' · ' + d + '.' + m;
  }
  function timeline(items, field, options) {
    const opts = options || {}, granularity = opts.granularity === 'month' ? 'month' : 'week', map = new Map();
    (items || []).forEach(item => {
      const b = bucketOf(item[field] || '', granularity), key = b ? b.key : '';
      if (!key && opts.skipBlank !== false) return;
      if (!map.has(key)) map.set(key, { bucket:b, items:[] });
      map.get(key).items.push(item);
    });
    const today = ordinal(opts.today || todayIso());
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([key, v]) => ({
      key, start:v.bucket ? v.bucket.start : '', label:bucketLabel(v.bucket, granularity, opts.lang),
      past:v.bucket ? ordinal(v.bucket.start) + (granularity === 'month' ? 27 : 6) < today : false,
      items:v.items, ...summarize(v.items),
    }));
  }

  /* Veri kalitesi: rapora girmeden önce yakalanması gereken hatalı kayıtlar.
     Her kontrol satır listesini taşır; panel tıklanınca bu satırları açar,
     Excel'de "Veri Kalitesi" sayfası olarak yazılır. */
  const QUALITY_CHECKS = Object.freeze([
    { key:'blankSeason', tr:'Sezon boş', en:'Season blank', test:it => !text(it.season) },
    { key:'blankExFactory', tr:'Ex-Factory tarihi yok', en:'Ex-Factory date missing', test:it => !it.exFactory },
    { key:'exInherited', tr:'ASAS\'ta Ex-Factory yok · aynı PO\'nun diğer renginden alındı', en:'No Ex-Factory in ASAS · taken from another colour of the PO', test:it => Boolean(it.exInheritedFrom) },
    { key:'blankRetail', tr:'Retail Depo tarihi yok', en:'Retail warehouse date missing', test:it => !it.retail },
    { key:'retailBeforeEx', tr:'Retail tarihi Ex-Factory\'den önce', en:'Retail date before Ex-Factory', test:it => it.retail && it.exFactory && it.retail < it.exFactory },
    { key:'rawTimestamp', tr:'Tarih alanında saatli ham değer', en:'Raw timestamp in a date field', test:it => it.rawTimestampFields && it.rawTimestampFields.length > 0 },
  ]);
  function dataQuality(items) {
    return QUALITY_CHECKS.map(check => {
      const rows = (items || []).filter(check.test);
      return { key:check.key, tr:check.tr, en:check.en, count:rows.length, qty:round(rows.reduce((t, it) => t + it.qty, 0)), items:rows };
    }).filter(issue => issue.count > 0);
  }

  /* -------------------------------------------------------------- Excel */
  function kit() {
    const pa = planActualApi();
    if (!pa || !pa.excelKit) throw new Error('Planlanan & Gerçekleşen Excel kiti yüklenmedi.');
    return pa;
  }
  function buildWorkbook(input, ExcelJS, options) {
    if (!ExcelJS || typeof ExcelJS.Workbook !== 'function') throw new Error('ExcelJS yüklenmedi.');
    const PA = kit(), K = PA.excelKit, C = K.COLORS, FONT = K.FONT;
    const opts = options || {}, lang = opts.lang === 'en' ? 'en' : 'tr';
    const L = (tr, en) => (lang === 'en' ? en : tr);
    const today = opts.today || todayIso();
    const items = normalizeRows(input.rows, { today });
    const total = summarize(items);
    const wb = opts.workbook || new ExcelJS.Workbook();
    if (!opts.workbook) { wb.creator = 'Buyer Log'; wb.created = new Date(); }
    const legacySheets = wb.worksheets.slice();
    const v3Sheets = [], charts = [];
    const addSheet = (name, config) => { const ws = wb.addWorksheet(name.slice(0, 31), config); v3Sheets.push(ws); return ws; };
    const stageFill = key => 'FF' + (STAGES.find(s => s.key === key) || STAGES[STAGES.length - 1]).color;
    const subtitle = [
      input.filterText ? L('Filtre', 'Filter') + ': ' + input.filterText : L('Filtre: Backlog ekranındaki aktif kapsam', 'Filter: active Backlog scope'),
      L('Rapor tarihi', 'Report date') + ': ' + today.split('-').reverse().join('.'),
      L(total.rows + ' operasyon satırı', total.rows + ' operational rows'),
    ].join('   ·   ');

    /* ---- 1) Backlog Özet ---- */
    const dash = addSheet(L('Backlog Özet', 'Backlog Summary'), { views:[{ showGridLines:false, zoomScale:90 }], properties:{ tabColor:{ argb:C.navy } } });
    dash.getColumn(1).width = 2;
    for (let c = 2; c <= 17; c += 1) dash.getColumn(c).width = 11.5;
    K.sheetTitle(dash, L('Backlog V3 · Operasyon Görünümü', 'Backlog V3 · Operations View'), subtitle, 17);
    const transitQty = total.stages.IN_TRANSIT + total.stages.CUSTOMS;
    const arrivedQty = total.stages.IN_WAREHOUSE + total.stages.AWAITING_RETAIL_TRANSFER;
    const tiles = [
      [L('Toplam adet', 'Total qty'), total.qty, '#,##0', C.navy, L(total.orders + ' sipariş · ' + total.lines + ' satır', total.orders + ' orders · ' + total.lines + ' lines')],
      [L('Yüklenen oranı', 'Loaded share'), total.loadedPct, '0.0%', C.green, L('Üretim/eksik dışı', 'Beyond production/shortage')],
      [L('Üretimde', 'In production'), total.stages.PRODUCTION, '#,##0', 'FF5980A6', ''],
      [L('Yükleme operasyonları', 'Loading operations'), total.stages.LOADING, '#,##0', C.gold, ''],
      [L('Yolda + Gümrük', 'In transit + customs'), transitQty, '#,##0', 'FF6D53A8', ''],
      [L('Depoda + Retail bekleyen', 'Warehouse + awaiting retail'), arrivedQty, '#,##0', C.green, ''],
      [L('Ex-F geçti · yüklenmedi', 'Ex-F passed · not loaded'), total.overdueQty, '#,##0', C.red, L(total.overdueLines + ' satır', total.overdueLines + ' lines')],
      [L('Riskli adet', 'At-risk qty'), total.riskQty, '#,##0', C.red, L('Transit gecikmiş: ', 'Transit overdue: ') + total.transitOverdueQty],
    ];
    tiles.forEach((tile, i) => {
      const c0 = 2 + i * 2, c1 = c0 + 1;
      [4, 5, 6].forEach(r => dash.mergeCells(r, c0, r, c1));
      const label = dash.getCell(4, c0), value = dash.getCell(5, c0), foot = dash.getCell(6, c0);
      label.value = tile[0]; label.font = { name:FONT, size:8.5, bold:true, color:{ argb:C.ink2 } };
      value.value = tile[1] == null ? '—' : tile[1]; value.numFmt = tile[2]; value.font = { name:FONT, size:20, bold:true, color:{ argb:tile[3] } };
      foot.value = tile[4] || ''; foot.font = { name:FONT, size:8, color:{ argb:C.muted } };
      [label, value, foot].forEach(cell => { cell.fill = { type:'pattern', pattern:'solid', fgColor:{ argb:C.paper } }; cell.alignment = { vertical:'middle', horizontal:'left', indent:1 }; });
      for (let c = c0; c <= c1; c += 1) dash.getCell(4, c).border = { top:{ style:'thick', color:{ argb:tile[3] } } };
    });
    dash.getRow(4).height = 22; dash.getRow(5).height = 32; dash.getRow(6).height = 16;

    K.sectionTitle(dash, 8, 2, 17, L('Operasyon durumu', 'Operational status'));
    const sh = dash.getRow(9);
    dash.mergeCells(9, 2, 9, 3);
    sh.getCell(2).value = L('Aşama', 'Stage'); sh.getCell(4).value = L('Adet', 'Qty'); sh.getCell(5).value = L('Pay', 'Share'); sh.getCell(6).value = L('Satır', 'Lines');
    K.styleHeader(sh, { height:24 });
    STAGES.forEach((s, i) => {
      const r = 10 + i, row = dash.getRow(r);
      dash.mergeCells(r, 2, r, 3);
      row.getCell(2).value = stageLabel(s.key, lang);
      row.getCell(2).font = { bold:true, color:{ argb:'FF' + s.color } };
      row.getCell(4).value = total.stages[s.key]; row.getCell(4).numFmt = '#,##0';
      row.getCell(5).value = total.qty > 0 ? total.stages[s.key] / total.qty : 0; row.getCell(5).numFmt = '0.0%';
      row.getCell(6).value = total.stageLines[s.key]; row.getCell(6).numFmt = '#,##0';
    });
    const stageLast = 9 + STAGES.length;
    K.styleBody(dash, 10, stageLast, 2, 6);
    STAGES.forEach((s, i) => { dash.getCell(10 + i, 2).border = { left:{ style:'thick', color:{ argb:'FF' + s.color } }, bottom:K.thin }; });
    K.dataBar(dash, 'E10:E' + stageLast, C.acc);
    const dn = K.quoteSheet(dash.name);
    charts.push({ worksheet:dash, anchor:{ fromCol:6, fromRow:8, toCol:11, toRow:25 }, xml:PA.doughnutXml({ lang, title:L('Adetin operasyon aşamaları', 'Quantity by operational stage'), categoriesRef:dn + '!$B$10:$B$' + stageLast, valuesRef:dn + '!$D$10:$D$' + stageLast, colors:STAGES.map(s => s.color) }) });

    /* ---- 2) Haftalık Akış ---- */
    const flow = addSheet(L('Haftalık Akış', 'Weekly Flow'), { views:[{ showGridLines:false }], properties:{ tabColor:{ argb:C.acc } } });
    flow.getColumn(1).width = 2; flow.getColumn(2).width = 16;
    for (let c = 3; c <= 4 + STAGES.length + 2; c += 1) flow.getColumn(c).width = 13;
    K.sheetTitle(flow, L('Haftalık operasyon akışı', 'Weekly operational flow'), subtitle, 4 + STAGES.length + 1);
    const flowLastCol = 4 + STAGES.length + 1;
    let cursor = 4;
    const flowCharts = [];
    [['exFactory', L('Ex-Factory haftası (güncel plan)', 'Ex-Factory week (current plan)')], ['antrepo', L('Antrepo giriş haftası', 'Warehouse arrival week')]].forEach(([field, title]) => {
      const series = timeline(items, field, { lang, today });
      K.sectionTitle(flow, cursor, 2, flowLastCol, title);
      const head = flow.getRow(cursor + 1);
      [L('Hafta', 'Week'), L('Toplam', 'Total'), L('Ex-F geçti · yüklenmedi', 'Ex-F passed · not loaded'), ...STAGES.map(s => stageLabel(s.key, lang))].forEach((label, i) => { head.getCell(2 + i).value = label; });
      K.styleHeader(head, { height:34 });
      STAGES.forEach((s, i) => { head.getCell(5 + i).fill = { type:'pattern', pattern:'solid', fgColor:{ argb:'FF' + s.color } }; });
      const first = cursor + 2;
      series.forEach((b, i) => {
        const row = flow.getRow(first + i);
        row.getCell(2).value = b.label; row.getCell(3).value = b.qty; row.getCell(4).value = b.overdueQty || null;
        STAGES.forEach((s, si) => { row.getCell(5 + si).value = b.stages[s.key] || null; });
        for (let c = 3; c <= flowLastCol; c += 1) row.getCell(c).numFmt = '#,##0';
        if (b.overdueQty) row.getCell(4).font = { bold:true, color:{ argb:C.red } };
      });
      const last = first + Math.max(1, series.length) - 1;
      if (series.length) {
        K.styleBody(flow, first, last, 2, flowLastCol);
        series.forEach((b, i) => { if (b.overdueQty) flow.getCell(first + i, 4).font = { name:FONT, size:9.5, bold:true, color:{ argb:C.red } }; });
        K.dataBar(flow, 'C' + first + ':C' + last, C.acc);
        const fn = K.quoteSheet(flow.name);
        const spec = { lang, dir:'col', grouping:'stacked', title, categoriesRef:fn + '!$B$' + first + ':$B$' + last,
          series:STAGES.map((s, si) => ({ name:stageLabel(s.key, lang), color:s.color, ref:fn + '!$' + K.colName(5 + si) + '$' + first + ':$' + K.colName(5 + si) + '$' + last })) };
        const chartTop = last + 1, chartBottom = chartTop + 20;
        flowCharts.push({ worksheet:flow, anchor:{ fromCol:1, fromRow:chartTop, toCol:flowLastCol, toRow:chartBottom }, xml:PA.barChartXml(spec) });
        if (field === 'exFactory') charts.push({ worksheet:dash, anchor:{ fromCol:11, fromRow:8, toCol:17, toRow:25 }, xml:PA.barChartXml(spec) });
        cursor = chartBottom + 2;
      } else cursor = last + 3;
    });
    charts.push(...flowCharts);

    /* ---- Özet altı: seçili kırılım + %100 yığılmış yatay bar ---- */
    const dimKey = DIMENSIONS.includes(input.groupBy) ? input.groupBy : 'buyer';
    const groups = groupBy(items, dimKey, { blank:L('(boş)', '(blank)') });
    K.sectionTitle(dash, 27, 2, 17, dimLabel(dimKey, lang) + L(' kırılımı', ' breakdown'));
    const gt = writeStageTable(dash, 28, groups, dimLabel(dimKey, lang));
    if (groups.length) {
      const top = Math.min(groups.length, 25), from = gt.firstRow, to = gt.firstRow + top - 1;
      charts.push({ worksheet:dash, anchor:{ fromCol:1, fromRow:gt.lastRow + 1, toCol:17, toRow:gt.lastRow + 1 + Math.max(14, Math.round(top * 1.6) + 6) }, xml:PA.barChartXml({
        lang, dir:'bar', grouping:'percentStacked', reverse:true, gapWidth:35,
        title:dimLabel(dimKey, lang) + L(' bazında operasyon dağılımı (%)', ' operational mix (%)'),
        categoriesRef:dn + '!$B$' + from + ':$B$' + to,
        series:STAGES.map((s, si) => ({ name:stageLabel(s.key, lang), color:s.color, ref:dn + '!$' + K.colName(gt.stageFirstCol + si) + '$' + from + ':$' + K.colName(gt.stageFirstCol + si) + '$' + to })),
      }) });
    }

    /* ---- 3) Kırılımlar ---- */
    const br = addSheet(L('Kırılımlar', 'Breakdowns'), { views:[{ showGridLines:false }], properties:{ tabColor:{ argb:C.green } } });
    br.getColumn(1).width = 2; br.getColumn(2).width = 18; br.getColumn(3).width = 18;
    for (let c = 4; c <= 4 + STAGES.length + 4; c += 1) br.getColumn(c).width = 13;
    K.sheetTitle(br, L('Kırılım bazında operasyon durumu', 'Operational status by dimension'), subtitle, 3 + 5 + STAGES.length);
    let bc = 4;
    ['buyer', 'buyingGroup', 'manufacturer', 'season', 'category', 'deliveryType', 'country'].forEach(id => {
      K.sectionTitle(br, bc, 2, 3 + 5 + STAGES.length, dimLabel(id, lang));
      const res = writeStageTable(br, bc + 1, groupBy(items, id, { blank:L('(boş)', '(blank)') }), dimLabel(id, lang));
      bc = res.lastRow + 3;
    });

    function writeStageTable(ws, startRow, list, label) {
      const cols = [
        [L('Toplam adet', 'Total qty'), g => g.qty, '#,##0'],
        [L('Yüklenen oranı', 'Loaded share'), g => g.loadedPct, '0.0%'],
        [L('Ex-F geçti · yüklenmedi', 'Ex-F passed · not loaded'), g => g.overdueQty || null, '#,##0'],
        ...STAGES.map(s => [stageLabel(s.key, lang), g => g.stages[s.key] || null, '#,##0', s]),
        [L('Sipariş', 'Orders'), g => g.orders, '#,##0'],
        [L('Riskli adet', 'At-risk qty'), g => g.riskQty || null, '#,##0'],
      ];
      const head = ws.getRow(startRow);
      ws.mergeCells(startRow, 2, startRow, 3);
      head.getCell(2).value = label;
      cols.forEach((c, i) => { head.getCell(4 + i).value = c[0]; });
      K.styleHeader(head, { height:34 });
      cols.forEach((c, i) => { if (c[3]) head.getCell(4 + i).fill = { type:'pattern', pattern:'solid', fgColor:{ argb:'FF' + c[3].color } }; });
      list.forEach((g, gi) => {
        const r = startRow + 1 + gi, row = ws.getRow(r);
        ws.mergeCells(r, 2, r, 3);
        row.getCell(2).value = g.name; row.getCell(2).font = { bold:true };
        cols.forEach((c, i) => { const cell = row.getCell(4 + i); cell.value = c[1](g); cell.numFmt = c[2]; cell.alignment = { vertical:'middle', horizontal:'right' }; });
      });
      const last = startRow + Math.max(1, list.length);
      if (list.length) {
        K.styleBody(ws, startRow + 1, last, 2, 3 + cols.length);
        list.forEach((g, gi) => { if (g.overdueQty) ws.getCell(startRow + 1 + gi, 6).font = { name:FONT, size:9.5, bold:true, color:{ argb:C.red } }; });
        K.dataBar(ws, 'D' + (startRow + 1) + ':D' + last, C.acc);
        K.dataBar(ws, 'E' + (startRow + 1) + ':E' + last, C.green);
      }
      return { firstRow:startRow + 1, lastRow:last, stageFirstCol:7 };
    }

    /* ---- 4) Backlog V3 detay ---- */
    const detail = addSheet('Backlog V3', { views:[{ state:'frozen', ySplit:1, xSplit:2 }], properties:{ tabColor:{ argb:C.gold } } });
    const headers = (Array.isArray(input.headers) && input.headers.length ? input.headers : Object.keys((input.rows || [])[0] || {})).filter(h => h && h[0] !== '_');
    const F = fields();
    const dateHeaders = new Set([F.revisedLoad, F.plannedLoad, F.antrepo, F.retail, F.inStore, ...(input.dateHeaders || [])]);
    const cols = [
      [L('Aşama', 'Stage'), 22, it => stageLabel(it.stage, lang)],
      [L('Ex-F geçti (gün)', 'Ex-F passed (days)'), 11, it => it.overdueDays || null, 'qty'],
      ...headers.map(h => [String(h).replace(/\n/g, ' '), Math.min(34, Math.max(10, String(h).length + 2)), it => it.row[h], dateHeaders.has(h) ? 'date' : 'auto']),
    ];
    detail.columns = cols.map(c => ({ header:c[0], width:c[1] }));
    K.styleHeader(detail.getRow(1), { height:36 });
    items.forEach((it, i) => {
      const row = detail.getRow(i + 2);
      row.height = 18;
      cols.forEach((c, ci) => {
        const cell = row.getCell(ci + 1), raw = c[2](it), kind = c[3];
        if (kind === 'date') K.setDate(cell, dayIso(raw));
        else if (kind === 'qty') { cell.value = raw; cell.numFmt = '#,##0'; }
        else if (typeof raw === 'number') { cell.value = raw; cell.numFmt = Number.isInteger(raw) ? '#,##0' : '#,##0.00'; }
        else if (raw instanceof Date) K.setDate(cell, dayIso(raw));
        // Sunucu tarihleri gün metni (YYYY-MM-DD) olarak gönderir; ham zaman damgaları da tarih yazılır.
        else if (typeof raw === 'string' && /^\d{4}-\d{2}-\d{2}(?:$|[T ]\d{2}:\d{2})/.test(raw)) K.setDate(cell, dayIso(raw));
        else cell.value = raw == null || raw === '' ? null : (typeof raw === 'object' ? JSON.stringify(raw) : raw);
        cell.font = { name:FONT, size:9.5, color:{ argb:C.ink } };
        cell.border = { bottom:K.thin };
        if (i % 2 === 1) cell.fill = { type:'pattern', pattern:'solid', fgColor:{ argb:C.band } };
      });
      const stageCell = row.getCell(1);
      stageCell.font = { name:FONT, size:9.5, bold:true, color:{ argb:'FFFFFFFF' } };
      stageCell.fill = { type:'pattern', pattern:'solid', fgColor:{ argb:stageFill(it.stage) } };
      if (it.overdueDays) row.getCell(2).font = { name:FONT, size:9.5, bold:true, color:{ argb:C.red } };
    });
    if (items.length) {
      detail.autoFilter = { from:{ row:1, column:1 }, to:{ row:items.length + 1, column:cols.length } };
      const qtyIndex = headers.indexOf(F.qty);
      if (qtyIndex >= 0) { const col = K.colName(qtyIndex + 3); K.dataBar(detail, col + '2:' + col + (items.length + 1), C.acc); }
    }

    /* ---- Veri Kalitesi (yalnız sorun varsa) ---- */
    const quality = dataQuality(items);
    if (quality.length) {
      const dq = addSheet(L('Veri Kalitesi', 'Data Quality'), { views:[{ state:'frozen', ySplit:1 }], properties:{ tabColor:{ argb:C.red } } });
      const qRows = [];
      quality.forEach(issue => issue.items.forEach(it => qRows.push({ issue, it })));
      K.writeTable(dq, [
        [L('Sorun', 'Issue'), 30, x => pick(lang, x.issue)],
        [L('Sipariş', 'Order'), 14, x => x.it.orderCode], [L('Model', 'Model'), 24, x => x.it.modelName], [L('Renk Kod', 'Colour Code'), 10, x => x.it.colourCode],
        ['Buyer', 18, x => x.it.buyer], [L('Üretici', 'Manufacturer'), 22, x => x.it.manufacturer], [L('Sezon', 'Season'), 8, x => x.it.season],
        ['Ex-Factory', 12, x => x.it.exFactory, 'date'], ['Retail', 12, x => x.it.retail, 'date'], [L('Adet', 'Qty'), 10, x => x.it.qty, 'qty'],
        [L('Saatli alanlar', 'Timestamp fields'), 30, x => (x.it.rawTimestampFields || []).map(f => f.replace(/\n/g, ' ')).join(', ')],
      ], qRows, (row, x) => { row.getCell(1).font = { name:FONT, size:9.5, bold:true, color:{ argb:C.red } }; });
    }

    v3Sheets.forEach(ws => { ws.pageSetup = Object.assign({}, ws.pageSetup, { orientation:'landscape', fitToPage:true, fitToWidth:1, fitToHeight:0 }); });

    /* ---- 5) Planlanan & Gerçekleşen raporu (isteğe bağlı) ---- */
    let paSheets = [];
    if (input.planActual) {
      const pa = PA.buildWorkbook(input.planActual, ExcelJS, { lang, workbook:wb, prefix:'P&A ' });
      paSheets = pa.worksheets || [];
      charts.push(...pa.charts);
    }

    /* Sekme sırası: V3 → P&A → Legacy. Dosya adları (sheet<id>.xml) değişmez. */
    let order = 0;
    [...v3Sheets, ...paSheets, ...legacySheets].forEach(ws => { ws.orderNo = order++; });
    legacySheets.forEach(ws => { if (!ws.properties.tabColor) ws.properties.tabColor = { argb:C.muted }; });
    return { workbook:wb, charts, summary:total, sheets:{ v3:v3Sheets.map(ws => ws.name), planActual:paSheets.map(ws => ws.name), legacy:legacySheets.map(ws => ws.name) } };
  }

  async function buildXlsx(input, deps) {
    const d = deps || {}, PA = kit();
    const built = buildWorkbook(input, d.ExcelJS, { lang:d.lang, workbook:d.workbook, today:d.today });
    let data = await built.workbook.xlsx.writeBuffer();
    if (typeof d.afterWrite === 'function') data = await d.afterWrite(data);
    if (d.JSZip && built.charts.length) {
      try { data = await PA.injectCharts(data, PA.chartSpecsFor(built.workbook, built.charts), d.JSZip, d.outputType || 'uint8array'); }
      catch (err) { if (d.onChartError) d.onChartError(err); }
    }
    return { data, summary:built.summary, sheets:built.sheets };
  }

  function fileName(now) {
    const d = now instanceof Date ? now : new Date(), p = n => String(n).padStart(2, '0');
    return 'Backlog_V3_' + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '_' + p(d.getHours()) + p(d.getMinutes()) + '.xlsx';
  }

  return Object.freeze({
    STAGES, DIMENSIONS, TIMELINE_FIELDS, PRE_LOAD,
    stageOf, stageLabel, dimLabel, dayIso, normalizeRow, normalizeRows, summarize, groupBy, timeline, isoWeekNo,
    QUALITY_CHECKS, dataQuality,
    buildWorkbook, buildXlsx, fileName,
  });
});
