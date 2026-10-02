/* Buyer Log — Planlanan & Gerçekleşen RAPOR MODELİ + EXCEL YAZICISI
 *
 * Saf modül: DOM yok, fetch yok. Hem panel (grafikler, kırılım barları,
 * sağ detay paneli) hem de Excel dışa aktarımı aynı segment ve kırılım
 * hesabını BURADAN okur; böylece ekranda görülen sayı ile Excel'deki sayı
 * ayrışamaz. İş gerçeği sunucudaki server/lib/backlog-plan-actual.js plan
 * satırlarıdır; bu modül yalnız toplulaştırır ve biçimlendirir.
 *
 * Excel: ExcelJS ile biçimli sayfalar yazılır, yerel (düzenlenebilir) Excel
 * grafikleri JSZip ile DrawingML parçası olarak eklenir (injectCharts).
 */
(function attachPlanActualReport(root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.BLPlanActualReport = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createPlanActualReport(root) {
  'use strict';

  /* Segment sırası yatay bardaki görsel sıradır: önce sorun, sonra başarı. */
  const SEGMENTS = Object.freeze([
    { key:'overdue', color:'A8453A', tr:'Tarihi geçmiş · yüklenmedi', en:'Overdue · not loaded' },
    { key:'late', color:'8C6A1F', tr:'Geç yüklendi', en:'Loaded late' },
    { key:'undated', color:'C4AE86', tr:'Yüklendi · tarih yok', en:'Loaded · no date' },
    { key:'pending', color:'5980A6', tr:'Vadesi gelmedi · açık', en:'Not yet due · open' },
    { key:'onTime', color:'3F7757', tr:'Zamanında yüklendi', en:'Loaded on time' },
    { key:'removed', color:'98A2B3', tr:"Backlog'dan çıktı", en:'Left Backlog' },
  ]);
  const OUTCOMES = Object.freeze({
    notLoaded:{ tr:'Yüklenmedi · tarihi geçti', en:'Not loaded · overdue', segment:'overdue' },
    partial:{ tr:'Kısmi yüklendi', en:'Partially loaded', segment:'late' },
    late:{ tr:'Geç yüklendi', en:'Loaded late', segment:'late' },
    pending:{ tr:'Vadesi gelmedi', en:'Not yet due', segment:'pending' },
    onTime:{ tr:'Zamanında', en:'On time', segment:'onTime' },
    removed:{ tr:"Backlog'dan çıktı", en:'Left Backlog', segment:'removed' },
  });
  const DIMENSIONS = Object.freeze([
    { key:'buyer', tr:'Buyer', en:'Buyer' },
    { key:'buyingGroup', tr:'Buying Group', en:'Buying Group' },
    { key:'mag', tr:'MAG', en:'MAG' },
    { key:'mmyg', tr:'MMYG', en:'MMYG' },
    { key:'productMainDefinition', tr:'Ürün Ana Tanım', en:'Product Main Definition' },
    { key:'manufacturer', tr:'Üretici', en:'Manufacturer' },
    { key:'season', tr:'Sezon', en:'Season' },
  ]);
  const REVISION_BUCKETS = Object.freeze([
    { key:'e15', min:-Infinity, max:-15, tr:'≥15 gün öne', en:'≥15 days earlier', tone:'good' },
    { key:'e8', min:-14, max:-8, tr:'8–14 gün öne', en:'8–14 days earlier', tone:'good' },
    { key:'e1', min:-7, max:-1, tr:'1–7 gün öne', en:'1–7 days earlier', tone:'good' },
    { key:'l1', min:1, max:7, tr:'1–7 gün ileri', en:'1–7 days later', tone:'bad' },
    { key:'l8', min:8, max:14, tr:'8–14 gün ileri', en:'8–14 days later', tone:'bad' },
    { key:'l15', min:15, max:Infinity, tr:'≥15 gün ileri', en:'≥15 days later', tone:'bad' },
  ]);
  const EXF_LABEL = 'Planlanan Ex-Factory';

  const num = value => { const n = Number(value); return Number.isFinite(n) ? n : 0; };
  const round = value => Math.round((num(value) + Number.EPSILON) * 100) / 100;
  const pick = (lang, item) => (lang === 'en' ? item.en : item.tr);
  function emptySegments() { const out = {}; SEGMENTS.forEach(s => { out[s.key] = 0; }); return out; }

  function rowSegments(row) {
    const open = num(row && row.openQty);
    return {
      overdue: row && row.overdue ? open : 0,
      late: num(row && row.lateQty),
      undated: num(row && row.undatedQty),
      pending: row && row.overdue ? 0 : open,
      onTime: num(row && row.onTimeQty),
      removed: num(row && row.removedQty),
    };
  }
  function rowHasSegment(row, key) { return rowSegments(row)[key] > 0; }

  function summarize(rows) {
    const out = { lines:0, planned:0, loaded:0, open:0, overdueLines:0, segments:emptySegments(), outcomes:{} };
    Object.keys(OUTCOMES).forEach(k => { out.outcomes[k] = 0; });
    (rows || []).forEach(row => {
      out.lines += 1;
      out.planned += num(row.plannedQty); out.loaded += num(row.loadedQty); out.open += num(row.openQty);
      if (row.overdue) out.overdueLines += 1;
      out.outcomes[row.outcome] = (out.outcomes[row.outcome] || 0) + 1;
      const seg = rowSegments(row);
      SEGMENTS.forEach(s => { out.segments[s.key] += seg[s.key]; });
    });
    SEGMENTS.forEach(s => { out.segments[s.key] = round(out.segments[s.key]); });
    out.planned = round(out.planned); out.loaded = round(out.loaded); out.open = round(out.open);
    out.pct = out.planned > 0 ? out.loaded / out.planned : null;
    out.onTimePct = out.planned > 0 ? out.segments.onTime / out.planned : null;
    return out;
  }

  function groupBy(rows, key, options) {
    const opts = options || {}, blank = opts.blank || '(boş)';
    const map = new Map();
    (rows || []).forEach(row => {
      const name = String(row && row[key] || '').trim() || blank;
      if (!map.has(name)) map.set(name, []);
      map.get(name).push(row);
    });
    const list = [...map.entries()].map(([name, items]) => ({ name, rows:items, ...summarize(items) }));
    list.sort((a, b) => (b.segments.overdue - a.segments.overdue) || (b.planned - a.planned) || a.name.localeCompare(b.name, 'tr', { numeric:true }));
    return opts.limit ? list.slice(0, opts.limit) : list;
  }

  function dailySeries(rows) {
    const map = new Map();
    (rows || []).forEach(row => {
      const day = String(row && row.planDate || '').slice(0, 10) || '—';
      if (!map.has(day)) map.set(day, []);
      map.get(day).push(row);
    });
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([day, items]) => ({ day, rows:items, ...summarize(items) }));
  }

  function exFactoryRevisions(changes) {
    const buckets = REVISION_BUCKETS.map(b => ({ ...b, count:0, items:[] }));
    (changes || []).forEach(change => {
      const field = (change.fields || []).find(f => f.label === EXF_LABEL && Number.isFinite(Number(f.days)) && Number(f.days) !== 0);
      if (!field) return;
      const days = Number(field.days);
      const bucket = buckets.find(b => days >= b.min && days <= b.max);
      if (bucket) { bucket.count += 1; bucket.items.push({ change, days }); }
    });
    return buckets;
  }

  /* Sunucu kovaları "2026-03-14 · 39641 | Depoda · 9959" biçiminde yazar
     (tarih/statü · adet). Ekranda ve Excel'de okunur biçime çevrilir:
     "14.03.2026 · 39.641 adet". Metin dışı değerler aynen döner. */
  function formatFieldText(value, lang) {
    if (value == null || value === '') return value;
    const unit = lang === 'en' ? 'pcs' : 'adet';
    const nf = n => Number(n).toLocaleString(lang === 'en' ? 'en-GB' : 'tr-TR', { maximumFractionDigits:2 });
    return String(value)
      .replace(/(\d{4})-(\d{2})-(\d{2})(?![\d:T])/g, '$3.$2.$1')
      .replace(/ · (\d+(?:\.\d+)?)(?= \||$)/g, (m, q) => ' · ' + nf(q) + ' ' + unit);
  }

  /* -------------------------------------------------------------- Excel */
  const FONT = 'Segoe UI';
  const C = {
    navy:'FF2A3E52', ink:'FF101828', ink2:'FF475467', muted:'FF98A2B3', line:'FFE4E7EC', paper:'FFF6F7F9', band:'FFFAFBFC', white:'FFFFFFFF',
    acc:'FF5980A6', accBg:'FFE9EFF5', red:'FFA8453A', redBg:'FFF4E7E4', gold:'FF8C6A1F', goldBg:'FFF2EAD6', green:'FF3F7757', greenBg:'FFE3EDE6', grayBg:'FFEDEFF1',
  };
  const OUTCOME_STYLE = {
    notLoaded:[C.red, C.redBg], partial:[C.gold, C.goldBg], late:[C.gold, C.goldBg],
    pending:[C.acc, C.accBg], onTime:[C.green, C.greenBg], removed:[C.ink2, C.grayBg],
  };
  const thin = { style:'thin', color:{ argb:C.line } };

  function excelSerial(iso) {
    const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return null;
    // Takvim günü doğrudan tam sayı seriye çevrilir: saat dilimi kayması olmaz (bkz. excel-date-utils).
    return Math.round(Date.UTC(+m[1], +m[2] - 1, +m[3]) / 86400000) + 25569;
  }
  function setDate(cell, iso) {
    const serial = excelSerial(iso);
    if (serial == null) { cell.value = iso || null; return; }
    cell.value = serial; cell.numFmt = 'dd.mm.yyyy';
  }
  function colName(index) { let n = index, out = ''; while (n > 0) { const r = (n - 1) % 26; out = String.fromCharCode(65 + r) + out; n = Math.floor((n - 1) / 26); } return out; }
  function quoteSheet(name) { return "'" + String(name).replace(/'/g, "''") + "'"; }
  function xml(value) {
    return String(value == null ? '' : value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
  }

  function styleHeader(row, options) {
    const opts = options || {};
    row.height = opts.height || 30;
    row.eachCell({ includeEmpty:false }, cell => {
      cell.font = { name:FONT, bold:true, size:9.5, color:{ argb:C.white } };
      cell.fill = { type:'pattern', pattern:'solid', fgColor:{ argb:opts.fill || C.navy } };
      cell.alignment = { vertical:'middle', horizontal:'center', wrapText:true };
      cell.border = { bottom:{ style:'medium', color:{ argb:opts.fill || C.navy } } };
    });
  }
  function styleBody(ws, fromRow, toRow, fromCol, toCol) {
    for (let r = fromRow; r <= toRow; r += 1) {
      const row = ws.getRow(r);
      row.height = 19;
      for (let c = fromCol; c <= toCol; c += 1) {
        const cell = row.getCell(c);
        cell.font = Object.assign({ name:FONT, size:9.5, color:{ argb:C.ink } }, cell.font && cell.font.bold ? { bold:true } : {}, cell.font && cell.font.color ? { color:cell.font.color } : {});
        cell.border = { bottom:thin };
        if (!cell.fill || cell.fill.type !== 'pattern') { if ((r - fromRow) % 2 === 1) cell.fill = { type:'pattern', pattern:'solid', fgColor:{ argb:C.band } }; }
        if (!cell.alignment) cell.alignment = { vertical:'middle' };
      }
    }
  }
  function dataBar(ws, ref, argb) {
    ws.addConditionalFormatting({ ref, rules:[{ type:'dataBar', priority:1, gradient:false, minLength:0, maxLength:100, cfvo:[{ type:'num', value:0 }, { type:'max' }], color:{ argb } }] });
  }
  function sheetTitle(ws, title, subtitle, lastCol) {
    ws.mergeCells(1, 2, 1, lastCol);
    const t = ws.getCell(1, 2);
    t.value = title; t.font = { name:FONT, size:16, bold:true, color:{ argb:C.white } };
    t.fill = { type:'pattern', pattern:'solid', fgColor:{ argb:C.navy } }; t.alignment = { vertical:'middle', indent:1 };
    ws.getRow(1).height = 34;
    ws.mergeCells(2, 2, 2, lastCol);
    const s = ws.getCell(2, 2);
    s.value = subtitle; s.font = { name:FONT, size:9, color:{ argb:C.ink2 } };
    s.fill = { type:'pattern', pattern:'solid', fgColor:{ argb:C.paper } }; s.alignment = { vertical:'middle', indent:1, wrapText:true };
    ws.getRow(2).height = 30;
  }
  function sectionTitle(ws, rowNo, fromCol, toCol, text) {
    ws.mergeCells(rowNo, fromCol, rowNo, toCol);
    const cell = ws.getCell(rowNo, fromCol);
    cell.value = text; cell.font = { name:FONT, size:11, bold:true, color:{ argb:C.navy } };
    cell.border = { bottom:{ style:'medium', color:{ argb:C.acc } } };
    ws.getRow(rowNo).height = 22;
  }

  /* Yerel Excel grafik XML'leri (DrawingML). Renkler segment paletinden gelir. */
  function chartShell(title, body, lang, legend) {
    const lng = lang === 'en' ? 'en-US' : 'tr-TR';
    const titleXml = '<c:title><c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="1100" b="1"><a:solidFill><a:srgbClr val="2A3E52"/></a:solidFill><a:latin typeface="Segoe UI"/></a:defRPr></a:pPr><a:r><a:rPr lang="' + lng + '" sz="1100" b="1"><a:solidFill><a:srgbClr val="2A3E52"/></a:solidFill><a:latin typeface="Segoe UI"/></a:rPr><a:t>' + xml(title) + '</a:t></a:r></a:p></c:rich></c:tx><c:overlay val="0"/></c:title>';
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><c:date1904 val="0"/><c:lang val="' + lng + '"/><c:roundedCorners val="0"/><c:chart>'
      + titleXml + '<c:autoTitleDeleted val="0"/><c:plotArea><c:layout/>' + body + '</c:plotArea>'
      + (legend === false ? '' : '<c:legend><c:legendPos val="b"/><c:overlay val="0"/><c:txPr><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="800"><a:solidFill><a:srgbClr val="475467"/></a:solidFill><a:latin typeface="Segoe UI"/></a:defRPr></a:pPr><a:endParaRPr lang="' + lng + '"/></a:p></c:txPr></c:legend>')
      + '<c:plotVisOnly val="1"/><c:dispBlanksAs val="gap"/></c:chart><c:spPr><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill><a:ln w="9525"><a:solidFill><a:srgbClr val="E4E7EC"/></a:solidFill></a:ln></c:spPr>'
      + '<c:txPr><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="800"><a:solidFill><a:srgbClr val="475467"/></a:solidFill><a:latin typeface="Segoe UI"/></a:defRPr></a:pPr><a:endParaRPr lang="' + lng + '"/></a:p></c:txPr></c:chartSpace>';
  }
  function fill(color) { return '<c:spPr><a:solidFill><a:srgbClr val="' + color + '"/></a:solidFill><a:ln w="6350"><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill></a:ln></c:spPr>'; }
  function barChartXml(spec) {
    const catAx = 510001, valAx = 510002;
    const series = (spec.series || []).map((s, i) => '<c:ser><c:idx val="' + i + '"/><c:order val="' + i + '"/><c:tx><c:v>' + xml(s.name) + '</c:v></c:tx>' + fill(s.color) + '<c:invertIfNegative val="0"/><c:cat><c:strRef><c:f>' + xml(spec.categoriesRef) + '</c:f></c:strRef></c:cat><c:val><c:numRef><c:f>' + xml(s.ref) + '</c:f></c:numRef></c:val></c:ser>').join('');
    const grouping = spec.grouping || 'stacked';
    const body = '<c:barChart><c:barDir val="' + (spec.dir === 'bar' ? 'bar' : 'col') + '"/><c:grouping val="' + grouping + '"/><c:varyColors val="0"/>' + series
      + '<c:gapWidth val="' + (spec.gapWidth || 45) + '"/>' + (grouping === 'clustered' ? '' : '<c:overlap val="100"/>') + '<c:axId val="' + catAx + '"/><c:axId val="' + valAx + '"/></c:barChart>'
      + '<c:catAx><c:axId val="' + catAx + '"/><c:scaling><c:orientation val="' + (spec.reverse ? 'maxMin' : 'minMax') + '"/></c:scaling><c:delete val="0"/><c:axPos val="' + (spec.dir === 'bar' ? 'l' : 'b') + '"/><c:numFmt formatCode="General" sourceLinked="1"/><c:majorTickMark val="none"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/><c:spPr><a:ln><a:solidFill><a:srgbClr val="D0D5DD"/></a:solidFill></a:ln></c:spPr><c:crossAx val="' + valAx + '"/><c:crosses val="autoZero"/><c:auto val="1"/><c:lblAlgn val="ctr"/><c:lblOffset val="100"/><c:noMultiLvlLbl val="0"/></c:catAx>'
      + '<c:valAx><c:axId val="' + valAx + '"/><c:scaling><c:orientation val="minMax"/>' + (grouping === 'percentStacked' ? '<c:max val="1"/>' : '') + '<c:min val="0"/></c:scaling><c:delete val="0"/><c:axPos val="' + (spec.dir === 'bar' ? (spec.reverse ? 't' : 'b') : 'l') + '"/><c:majorGridlines><c:spPr><a:ln><a:solidFill><a:srgbClr val="EEF0F3"/></a:solidFill></a:ln></c:spPr></c:majorGridlines><c:numFmt formatCode="' + (grouping === 'percentStacked' ? '0%' : '#,##0') + '" sourceLinked="0"/><c:majorTickMark val="none"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/><c:spPr><a:ln><a:noFill/></a:ln></c:spPr><c:crossAx val="' + catAx + '"/><c:crosses val="' + (spec.reverse && spec.dir === 'bar' ? 'max' : 'autoZero') + '"/><c:crossBetween val="between"/></c:valAx>';
    return chartShell(spec.title, body, spec.lang);
  }
  function doughnutXml(spec) {
    const points = (spec.colors || []).map((color, i) => '<c:dPt><c:idx val="' + i + '"/><c:bubble3D val="0"/>' + fill(color).replace('w="6350"', 'w="19050"') + '</c:dPt>').join('');
    const body = '<c:doughnutChart><c:varyColors val="1"/><c:ser><c:idx val="0"/><c:order val="0"/><c:tx><c:v>' + xml(spec.title) + '</c:v></c:tx>' + points
      + '<c:dLbls><c:numFmt formatCode="0%" sourceLinked="0"/><c:spPr><a:noFill/><a:ln><a:noFill/></a:ln></c:spPr><c:txPr><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="800" b="1"><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill></a:defRPr></a:pPr><a:endParaRPr lang="tr-TR"/></a:p></c:txPr><c:showLegendKey val="0"/><c:showVal val="0"/><c:showCatName val="0"/><c:showSerName val="0"/><c:showPercent val="1"/><c:showBubbleSize val="0"/><c:showLeaderLines val="0"/></c:dLbls>'
      + '<c:cat><c:strRef><c:f>' + xml(spec.categoriesRef) + '</c:f></c:strRef></c:cat><c:val><c:numRef><c:f>' + xml(spec.valuesRef) + '</c:f></c:numRef></c:val></c:ser><c:firstSliceAng val="0"/><c:holeSize val="' + (spec.holeSize || 60) + '"/></c:doughnutChart>';
    return chartShell(spec.title, body, spec.lang);
  }

  function groupColumns(L) {
    return [
      [L('Planlanan adet', 'Planned qty'), g => g.planned, '#,##0'],
      [L('Yüklenen adet', 'Loaded qty'), g => g.loaded, '#,##0'],
      [L('Gerçekleşme', 'Realisation'), g => g.pct == null ? null : g.pct, '0.0%'],
      ...SEGMENTS.map(s => [pick(L.lang, s), g => g.segments[s.key], '#,##0', s]),
      [L('Sipariş satırı', 'Order lines'), g => g.lines, '#,##0'],
    ];
  }
  /* Kırılım tablosu yazar; döndürdüğü aralıklar grafik referansları içindir. */
  function writeGroupTable(ws, startRow, groups, dimLabel, L) {
    const cols = groupColumns(L);
    const head = ws.getRow(startRow);
    ws.mergeCells(startRow, 2, startRow, 3);
    head.getCell(2).value = dimLabel;
    cols.forEach((c, i) => { head.getCell(4 + i).value = c[0]; });
    styleHeader(head, { height:34 });
    cols.forEach((c, i) => { if (c[3]) head.getCell(4 + i).fill = { type:'pattern', pattern:'solid', fgColor:{ argb:'FF' + c[3].color } }; });
    groups.forEach((g, gi) => {
      const r = startRow + 1 + gi, row = ws.getRow(r);
      ws.mergeCells(r, 2, r, 3);
      row.getCell(2).value = g.name; row.getCell(2).font = { bold:true };
      cols.forEach((c, i) => { const cell = row.getCell(4 + i); cell.value = c[1](g); cell.numFmt = c[2]; cell.alignment = { vertical:'middle', horizontal:'right' }; });
    });
    const last = startRow + Math.max(1, groups.length);
    if (groups.length) {
      styleBody(ws, startRow + 1, last, 2, 3 + cols.length);
      dataBar(ws, colName(6) + (startRow + 1) + ':' + colName(6) + last, C.green);
      const overdueCol = 7 + SEGMENTS.findIndex(s => s.key === 'overdue');
      dataBar(ws, colName(overdueCol) + (startRow + 1) + ':' + colName(overdueCol) + last, C.red);
    }
    return { firstRow:startRow + 1, lastRow:last, segmentFirstCol:7, cols };
  }

  function buildWorkbook(report, ExcelJS, options) {
    const opts = options || {}, lang = opts.lang === 'en' ? 'en' : 'tr';
    const L = (tr, en) => (lang === 'en' ? en : tr); L.lang = lang;
    if (!ExcelJS || typeof ExcelJS.Workbook !== 'function') throw new Error(L('ExcelJS yüklenmedi.', 'ExcelJS is not loaded.'));
    const planRows = report.planRows || [], changes = report.changes || [], activity = report.activity || [];
    const total = summarize(planRows);
    const dimKey = report.groupBy || 'buyer';
    const dim = DIMENSIONS.find(d => d.key === dimKey) || DIMENSIONS[0];
    // Backlog V3 aynı sayfaları kendi çalışma kitabına ekler: options.workbook +
    // options.prefix ile sayfa adları çakışmadan (ör. "P&A Özet") yazılır.
    const wb = opts.workbook || new ExcelJS.Workbook();
    if (!opts.workbook) { wb.creator = 'Buyer Log'; wb.created = new Date(); }
    const prefix = String(opts.prefix || '');
    const sheetName = name => (prefix + name).slice(0, 31);
    const added = [];
    const addSheet = (name, config) => { const ws = wb.addWorksheet(sheetName(name), config); added.push(ws); return ws; };
    const charts = [];
    const subtitle = [
      L('Analiz dönemi', 'Analysis period') + ': ' + (report.periodText || '—'),
      L('Plan penceresi', 'Plan window') + ': ' + (report.planWindowText || '—'),
      L('Snapshot', 'Snapshots') + ': ' + (report.snapshotText || '—'),
      report.filterText ? L('Filtre', 'Filter') + ': ' + report.filterText : '',
    ].filter(Boolean).join('   ·   ');

    /* ---- 1) Özet / Dashboard ---- */
    const dash = addSheet(L('Özet', 'Summary'), { views:[{ showGridLines:false, zoomScale:90 }], properties:{ tabColor:{ argb:C.navy } } });
    dash.getColumn(1).width = 2;
    for (let c = 2; c <= 17; c += 1) dash.getColumn(c).width = 11.5;
    sheetTitle(dash, L('Planlanan & Gerçekleşen Analizi', 'Planned vs Actual Analysis'), subtitle, 17);
    const revisions = exFactoryRevisions(changes);
    const pushedLater = revisions.filter(b => b.tone === 'bad').reduce((t, b) => t + b.count, 0);
    const tiles = [
      [L('Plan gerçekleşme', 'Plan realisation'), total.pct, '0.0%', C.navy],
      [L('Zamanında oranı', 'On-time rate'), total.onTimePct, '0.0%', C.green],
      [L('Planlanan adet', 'Planned qty'), total.planned, '#,##0', C.acc],
      [L('Yüklenen adet', 'Loaded qty'), total.loaded, '#,##0', C.green],
      [L('Geç yüklenen', 'Loaded late'), total.segments.late, '#,##0', C.gold],
      [L('Tarihi geçmiş · açık', 'Overdue · open'), total.segments.overdue, '#,##0', C.red],
      [L('Vadesi gelmemiş · açık', 'Not yet due · open'), total.segments.pending, '#,##0', C.acc],
      [L('Ex-Factory ileri ötelenen', 'Ex-Factory pushed later'), pushedLater, '#,##0', C.red],
    ];
    tiles.forEach((tile, i) => {
      const c0 = 2 + i * 2, c1 = c0 + 1;
      dash.mergeCells(4, c0, 4, c1); dash.mergeCells(5, c0, 5, c1); dash.mergeCells(6, c0, 6, c1);
      const label = dash.getCell(4, c0), value = dash.getCell(5, c0), foot = dash.getCell(6, c0);
      label.value = tile[0]; label.font = { name:FONT, size:8.5, bold:true, color:{ argb:C.ink2 } };
      value.value = tile[1] == null ? '—' : tile[1]; value.numFmt = tile[2]; value.font = { name:FONT, size:20, bold:true, color:{ argb:tile[3] } };
      foot.value = i === 0 ? L(total.lines + ' sipariş satırı', total.lines + ' order lines') : (i === 5 ? L(total.overdueLines + ' satır', total.overdueLines + ' lines') : '');
      foot.font = { name:FONT, size:8, color:{ argb:C.muted } };
      [label, value, foot].forEach(cell => {
        cell.fill = { type:'pattern', pattern:'solid', fgColor:{ argb:C.paper } };
        cell.alignment = { vertical:'middle', horizontal:'left', indent:1 };
      });
      for (let c = c0; c <= c1; c += 1) dash.getCell(4, c).border = { top:{ style:'thick', color:{ argb:tile[3] } } };
    });
    dash.getRow(4).height = 22; dash.getRow(5).height = 32; dash.getRow(6).height = 16;

    sectionTitle(dash, 8, 2, 17, L('Plan gerçekleşme dağılımı', 'Plan realisation mix'));
    const segHead = dash.getRow(9);
    dash.mergeCells(9, 2, 9, 3);
    segHead.getCell(2).value = L('Segment', 'Segment'); segHead.getCell(4).value = L('Adet', 'Qty'); segHead.getCell(5).value = L('Pay', 'Share');
    styleHeader(segHead, { height:24 });
    SEGMENTS.forEach((s, i) => {
      const r = 10 + i, row = dash.getRow(r);
      dash.mergeCells(r, 2, r, 3);
      row.getCell(2).value = pick(lang, s);
      row.getCell(2).font = { bold:true, color:{ argb:'FF' + s.color } };
      row.getCell(2).border = { left:{ style:'thick', color:{ argb:'FF' + s.color } } };
      row.getCell(4).value = total.segments[s.key]; row.getCell(4).numFmt = '#,##0';
      row.getCell(5).value = total.planned > 0 ? total.segments[s.key] / total.planned : 0; row.getCell(5).numFmt = '0.0%';
    });
    styleBody(dash, 10, 9 + SEGMENTS.length, 2, 5);
    SEGMENTS.forEach((s, i) => { dash.getCell(10 + i, 2).border = { left:{ style:'thick', color:{ argb:'FF' + s.color } }, bottom:thin }; });
    dataBar(dash, 'E10:E' + (9 + SEGMENTS.length), C.acc);
    const dashName = quoteSheet(dash.name);
    charts.push({ worksheet:dash, anchor:{ fromCol:5, fromRow:8, toCol:10, toRow:25 }, xml:doughnutXml({ lang, title:L('Planlanan adedin durumu', 'Status of planned qty'), categoriesRef:dashName + '!$B$10:$B$' + (9 + SEGMENTS.length), valuesRef:dashName + '!$D$10:$D$' + (9 + SEGMENTS.length), colors:SEGMENTS.map(s => s.color) }) });

    /* ---- Günlük plan sayfası (grafik kaynağı da budur) ---- */
    const days = dailySeries(planRows);
    const daily = addSheet(L('Günlük Plan', 'Daily Plan'), { views:[{ state:'frozen', ySplit:4, showGridLines:false }], properties:{ tabColor:{ argb:C.acc } } });
    daily.getColumn(1).width = 2;
    daily.getColumn(2).width = 14;
    for (let c = 3; c <= 3 + SEGMENTS.length + 3; c += 1) daily.getColumn(c).width = 15;
    sheetTitle(daily, L('Plan tarihine göre yükleme performansı', 'Loading performance by planned date'), subtitle, 3 + SEGMENTS.length + 3);
    const dHead = daily.getRow(4);
    [L('Plan Ex-Factory', 'Planned Ex-Factory'), L('Planlanan', 'Planned'), L('Yüklenen', 'Loaded'), L('Gerçekleşme', 'Realisation'), ...SEGMENTS.map(s => pick(lang, s))].forEach((label, i) => { dHead.getCell(2 + i).value = label; });
    styleHeader(dHead, { height:34 });
    SEGMENTS.forEach((s, i) => { dHead.getCell(6 + i).fill = { type:'pattern', pattern:'solid', fgColor:{ argb:'FF' + s.color } }; });
    days.forEach((d, i) => {
      const row = daily.getRow(5 + i);
      setDate(row.getCell(2), d.day);
      row.getCell(3).value = d.planned; row.getCell(4).value = d.loaded; row.getCell(5).value = d.pct == null ? null : d.pct;
      row.getCell(5).numFmt = '0.0%';
      SEGMENTS.forEach((s, si) => { row.getCell(6 + si).value = d.segments[s.key]; });
      [3, 4, ...SEGMENTS.map((_, si) => 6 + si)].forEach(c => { row.getCell(c).numFmt = '#,##0'; });
    });
    const dLast = 4 + Math.max(1, days.length);
    if (days.length) { styleBody(daily, 5, dLast, 2, 5 + SEGMENTS.length); dataBar(daily, 'E5:E' + dLast, C.green); }
    if (days.length) {
      const dn = quoteSheet(daily.name);
      // Kategori ekseni metin olsun diye tarih ayrıca gizli bir etiket sütununa yazılır.
      const labelCol = 6 + SEGMENTS.length;
      daily.getColumn(labelCol).hidden = true;
      days.forEach((d, i) => { daily.getRow(5 + i).getCell(labelCol).value = d.day.length === 10 ? d.day.slice(8, 10) + '.' + d.day.slice(5, 7) : d.day; });
      const spec = { lang, dir:'col', grouping:'stacked', title:L('Plan tarihine göre yükleme', 'Loading by planned date'), categoriesRef:dn + '!$' + colName(labelCol) + '$5:$' + colName(labelCol) + '$' + dLast,
        series:SEGMENTS.map((s, si) => ({ name:pick(lang, s), color:s.color, ref:dn + '!$' + colName(6 + si) + '$5:$' + colName(6 + si) + '$' + dLast })) };
      charts.push({ worksheet:dash, anchor:{ fromCol:10, fromRow:8, toCol:17, toRow:25 }, xml:barChartXml(spec) });
      charts.push({ worksheet:daily, anchor:{ fromCol:1, fromRow:dLast + 1, toCol:12, toRow:dLast + 22 }, xml:barChartXml(spec) });
    }

    /* ---- Seçili kırılım (Özet altında) + yatay yığılmış bar grafik ---- */
    const groups = groupBy(planRows, dim.key, { blank:L('(boş)', '(blank)') });
    sectionTitle(dash, 27, 2, 17, L(pick('tr', dim) + ' kırılımı', pick('en', dim) + ' breakdown'));
    const gt = writeGroupTable(dash, 28, groups, pick(lang, dim), L);
    if (groups.length) {
      const top = Math.min(groups.length, 25), from = gt.firstRow, to = gt.firstRow + top - 1;
      const height = Math.max(14, Math.round(top * 1.6) + 6);
      charts.push({ worksheet:dash, anchor:{ fromCol:1, fromRow:gt.lastRow + 1, toCol:17, toRow:gt.lastRow + 1 + height }, xml:barChartXml({
        lang, dir:'bar', grouping:'percentStacked', reverse:true, gapWidth:35,
        title:L(pick('tr', dim) + ' bazında plan gerçekleşme (%)', 'Plan realisation by ' + pick('en', dim) + ' (%)'),
        categoriesRef:dashName + '!$B$' + from + ':$B$' + to,
        series:SEGMENTS.map((s, si) => ({ name:pick(lang, s), color:s.color, ref:dashName + '!$' + colName(gt.segmentFirstCol + si) + '$' + from + ':$' + colName(gt.segmentFirstCol + si) + '$' + to })),
      }) });
    }

    /* ---- Kırılımlar: Buyer / Buying Group / MAG / MMYG / Ürün Ana Tanım ---- */
    const br = addSheet(L('Kırılımlar', 'Breakdowns'), { views:[{ showGridLines:false }], properties:{ tabColor:{ argb:C.green } } });
    br.getColumn(1).width = 2; br.getColumn(2).width = 18; br.getColumn(3).width = 18;
    for (let c = 4; c <= 4 + groupColumns(L).length; c += 1) br.getColumn(c).width = 14;
    sheetTitle(br, L('Kırılım bazında plan gerçekleşme', 'Plan realisation by dimension'), subtitle, 3 + groupColumns(L).length);
    let cursor = 4;
    DIMENSIONS.filter(d => ['buyer', 'buyingGroup', 'mag', 'mmyg', 'productMainDefinition'].includes(d.key)).forEach(d => {
      sectionTitle(br, cursor, 2, 3 + groupColumns(L).length, pick(lang, d));
      const list = groupBy(planRows, d.key, { blank:L('(boş)', '(blank)') });
      const res = writeGroupTable(br, cursor + 1, list, pick(lang, d), L);
      cursor = res.lastRow + 3;
    });

    /* ---- Plan gerçekleşme detayı ---- */
    const pd = addSheet(L('Plan Gerçekleşme', 'Plan Realisation'), { views:[{ state:'frozen', ySplit:1, xSplit:3 }], properties:{ tabColor:{ argb:C.red } } });
    const pdCols = [
      [L('Sonuç', 'Outcome'), 22, r => pick(lang, OUTCOMES[r.outcome] || { tr:r.outcome, en:r.outcome })],
      [L('Sipariş', 'Order'), 16, r => r.orderCode], [L('Model', 'Model'), 26, r => r.modelName], [L('Renk Kod', 'Colour Code'), 10, r => r.colourCode], [L('Renk', 'Colour'), 16, r => r.colour],
      ['Buyer', 18, r => r.buyer], ['Buying Group', 14, r => r.buyingGroup], ['MAG', 10, r => r.mag], ['MMYG', 10, r => r.mmyg], [L('Ürün Ana Tanım', 'Product Main Definition'), 18, r => r.productMainDefinition],
      [L('Üretici', 'Manufacturer'), 24, r => r.manufacturer], [L('Sezon', 'Season'), 8, r => r.season],
      [L('Plan Ex-Factory', 'Planned Ex-Factory'), 13, r => r.planDate, 'date'], [L('Güncel Ex-Factory', 'Current Ex-Factory'), 13, r => r.currentPlanDate, 'date'],
      [L('Plan kayması (gün)', 'Plan shift (days)'), 11, r => r.planShiftDays, 'days'],
      [L('Planlanan', 'Planned'), 11, r => r.plannedQty, 'qty'], [L('Yüklenen', 'Loaded'), 11, r => r.loadedQty, 'qty'], [L('Zamanında', 'On time'), 11, r => r.onTimeQty, 'qty'],
      [L('Geç', 'Late'), 10, r => r.lateQty, 'qty'], [L('Tarihsiz', 'No date'), 10, r => r.undatedQty, 'qty'], [L('Açık', 'Open'), 10, r => r.openQty, 'qty'],
      [L('Gerçekleşme', 'Realisation'), 12, r => (num(r.plannedQty) > 0 ? num(r.loadedQty) / num(r.plannedQty) : null), 'pct'],
      [L('Tarihi geçti (gün)', 'Overdue (days)'), 11, r => r.overdueDays || null, 'days'], [L('Geç yükleme (gün)', 'Late by (days)'), 11, r => r.lateDays || null, 'days'],
      [L('Son yükleme', 'Last load'), 13, r => r.lastLoadDate, 'date'], [L('Güncel statü', 'Current status'), 30, r => r.status], [L('Antrepo ETA', 'Warehouse ETA'), 13, r => r.eta, 'date'],
    ];
    writeTable(pd, pdCols, planRows, (row, item) => {
      const style = OUTCOME_STYLE[item.outcome];
      if (style) { const cell = row.getCell(1); cell.font = { name:FONT, size:9.5, bold:true, color:{ argb:style[0] } }; cell.fill = { type:'pattern', pattern:'solid', fgColor:{ argb:style[1] } }; }
    });
    if (planRows.length) {
      const pctCol = colName(pdCols.findIndex(c => c[3] === 'pct') + 1);
      dataBar(pd, pctCol + '2:' + pctCol + (planRows.length + 1), C.green);
    }

    /* ---- Net değişiklikler (alan başına bir satır) ---- */
    const nc = addSheet(L('Net Değişiklikler', 'Net Changes'), { views:[{ state:'frozen', ySplit:1, xSplit:2 }], properties:{ tabColor:{ argb:C.gold } } });
    const flat = [];
    changes.forEach((change, ci) => {
      const fields = change.fields && change.fields.length ? change.fields : [{ label:L('Net fark yok · dönem içi revizyon', 'No net difference · revised during period'), before:'', after:'' }];
      fields.forEach(f => flat.push({ change, field:f, band:ci % 2 }));
    });
    const ncCols = [
      [L('Sipariş', 'Order'), 16, x => x.change.orderCode], [L('Model', 'Model'), 26, x => x.change.modelName], [L('Renk', 'Colour'), 16, x => [x.change.colourCode, x.change.colour].filter(Boolean).join(' · ')],
      ['Buyer', 18, x => x.change.buyer], ['Buying Group', 14, x => x.change.buyingGroup], [L('Üretici', 'Manufacturer'), 24, x => x.change.manufacturer], [L('Sezon', 'Season'), 8, x => x.change.season],
      [L('Alan', 'Field'), 24, x => x.field.label], [L('Başlangıç', 'Start'), 30, x => formatFieldText(x.field.before, lang)], [L('Bitiş', 'End'), 30, x => formatFieldText(x.field.after, lang)],
      [L('Gün farkı', 'Day delta'), 10, x => (Number.isFinite(Number(x.field.days)) && x.field.days !== null ? Number(x.field.days) : null), 'days'],
      [L('Sinyal', 'Signal'), 22, x => [x.change.repeatedRevision ? L('çoklu revizyon', 'multiple revisions') : '', x.change.revertedRevision ? L('geri alındı', 'reverted') : '', x.change.lateQty > 0 ? L('geç yükleme', 'late load') : ''].filter(Boolean).join(' · ')],
    ];
    writeTable(nc, ncCols, flat, (row, item) => {
      const days = Number(item.field.days);
      const dayCell = row.getCell(11);
      if (Number.isFinite(days) && item.field.days !== null && days !== 0) dayCell.font = { name:FONT, size:9.5, bold:true, color:{ argb:days > 0 ? C.red : C.green } };
      row.getCell(8).font = { name:FONT, size:9.5, bold:true, color:{ argb:C.navy } };
    }, item => item.band === 1);

    /* ---- Dönem içi değişiklik trafiği ---- */
    const at = addSheet(L('Değişiklik Trafiği', 'Change Activity'), { views:[{ state:'frozen', ySplit:1 }], properties:{ tabColor:{ argb:C.muted } } });
    const atCols = [
      [L('Sipariş', 'Order'), 16, r => r.orderCode], [L('Model', 'Model'), 26, r => r.modelName], [L('Renk Kod', 'Colour Code'), 10, r => r.colourCode],
      ['Buyer', 18, r => r.buyer], [L('Alan', 'Field'), 24, r => r.field], [L('Revizyon', 'Revisions'), 10, r => r.eventCount, 'qty'],
      [L('İlk değer', 'First value'), 22, r => r.firstBefore], [L('Son değer', 'Last value'), 22, r => r.lastAfter],
      [L('İlk zaman', 'First at'), 18, r => fmtStamp(r.firstAt)], [L('Son zaman', 'Last at'), 18, r => fmtStamp(r.lastAt)],
      [L('Not', 'Note'), 24, r => [r.repeated ? L('tekrar revize', 'revised repeatedly') : '', r.reverted ? L('başlangıca döndü', 'returned to start') : ''].filter(Boolean).join(' · ')],
    ];
    writeTable(at, atCols, activity, (row, item) => { if (item.repeated) row.getCell(6).font = { name:FONT, size:9.5, bold:true, color:{ argb:C.red } }; });

    added.forEach(ws => { ws.pageSetup = Object.assign({}, ws.pageSetup, { orientation:'landscape', fitToPage:true, fitToWidth:1, fitToHeight:0 }); });
    return { workbook:wb, charts, worksheets:added };
  }

  function fmtStamp(value) {
    const d = new Date(value || '');
    if (Number.isNaN(d.getTime())) return value || '';
    const p = n => String(n).padStart(2, '0');
    return p(d.getDate()) + '.' + p(d.getMonth() + 1) + '.' + d.getFullYear() + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }
  function writeTable(ws, cols, items, decorate, bandFn) {
    ws.columns = cols.map(c => ({ header:c[0], width:c[1] }));
    styleHeader(ws.getRow(1), { height:32 });
    items.forEach((item, i) => {
      const row = ws.getRow(i + 2);
      row.height = 18;
      cols.forEach((c, ci) => {
        const cell = row.getCell(ci + 1), value = c[2](item), kind = c[3];
        if (kind === 'date') setDate(cell, value);
        else cell.value = value === undefined || value === '' ? null : value;
        if (kind === 'qty') cell.numFmt = '#,##0';
        if (kind === 'pct') cell.numFmt = '0.0%';
        if (kind === 'days') cell.numFmt = '+0;-0;0';
        cell.font = { name:FONT, size:9.5, color:{ argb:C.ink } };
        cell.alignment = { vertical:'middle', horizontal:kind ? 'right' : 'left' };
        cell.border = { bottom:thin };
        const banded = bandFn ? bandFn(item, i) : i % 2 === 1;
        if (banded) cell.fill = { type:'pattern', pattern:'solid', fgColor:{ argb:C.band } };
      });
      if (decorate) decorate(row, item);
    });
    if (items.length) ws.autoFilter = { from:{ row:1, column:1 }, to:{ row:items.length + 1, column:cols.length } };
  }

  /* ExcelJS sayfa dosyası adı, çalışma kitabındaki sırasıyla eşleşir. */
  function chartSpecsFor(workbook, charts) {
    return (charts || []).map(item => {
      // ExcelJS sayfa dosyasını kimliğiyle (sheet<id>.xml) adlandırır; sekme
      // sırası (orderNo) değişse de dosya adı değişmez.
      const id = item.worksheet && item.worksheet.id ? item.worksheet.id : workbook.worksheets.indexOf(item.worksheet) + 1;
      return { sheetPath:'xl/worksheets/sheet' + id + '.xml', anchor:item.anchor, xml:item.xml };
    });
  }

  /* Yerel grafik enjeksiyonu. Bir sayfada birden çok grafik olabildiği için
     her sayfaya TEK drawing parçası yazılır ve grafikler onun içinde ayrı
     ankrajlar olarak durur (OOXML sayfa başına tek <drawing> kabul eder). */
  function drawingXml(anchors) {
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">'
      + anchors.map((a, i) => '<xdr:twoCellAnchor editAs="oneCell"><xdr:from><xdr:col>' + a.fromCol + '</xdr:col><xdr:colOff>76200</xdr:colOff><xdr:row>' + a.fromRow + '</xdr:row><xdr:rowOff>76200</xdr:rowOff></xdr:from><xdr:to><xdr:col>' + a.toCol + '</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>' + a.toRow + '</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to>'
        + '<xdr:graphicFrame macro=""><xdr:nvGraphicFramePr><xdr:cNvPr id="' + (i + 2) + '" name="Buyer Log Chart ' + (i + 1) + '"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr><xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm>'
        + '<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:id="rId' + (i + 1) + '"/></a:graphicData></a:graphic></xdr:graphicFrame><xdr:clientData/></xdr:twoCellAnchor>').join('')
      + '</xdr:wsDr>';
  }
  function relsXml(items) {
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + items.join('') + '</Relationships>';
  }
  function nextPart(zip, re) {
    let max = 0;
    Object.keys(zip.files || {}).forEach(name => { const m = name.match(re); if (m) max = Math.max(max, +m[1]); });
    return max + 1;
  }
  async function injectCharts(data, specs, JSZip, outputType) {
    const list = (specs || []).filter(s => s && s.xml && s.sheetPath);
    if (!list.length) return data;
    const zip = await JSZip.loadAsync(data);
    const typesEntry = zip.file('[Content_Types].xml');
    if (!typesEntry) throw new Error('Excel content types file was not found.');
    let types = await typesEntry.async('string');
    const override = (part, type) => { if (!types.includes('PartName="' + part + '"')) types = types.replace(/<\/Types>\s*$/i, '<Override PartName="' + part + '" ContentType="' + type + '"/></Types>'); };
    let chartNo = nextPart(zip, /^xl\/charts\/chart(\d+)\.xml$/i), drawingNo = nextPart(zip, /^xl\/drawings\/drawing(\d+)\.xml$/i);
    const bySheet = new Map();
    list.forEach(spec => { if (!bySheet.has(spec.sheetPath)) bySheet.set(spec.sheetPath, []); bySheet.get(spec.sheetPath).push(spec); });
    for (const [sheetPath, items] of bySheet) {
      const sheetEntry = zip.file(sheetPath);
      if (!sheetEntry) throw new Error('Excel chart worksheet was not found: ' + sheetPath);
      let sheetXml = await sheetEntry.async('string');
      if (/<drawing\b/i.test(sheetXml)) throw new Error('Worksheet already has a drawing: ' + sheetPath);
      const relPath = sheetPath.replace(/\/([^/]+)$/, '/_rels/$1.rels');
      const relEntry = zip.file(relPath);
      let rels = relEntry ? await relEntry.async('string') : relsXml([]);
      let maxId = 0; rels.replace(/Id="rId(\d+)"/g, (whole, n) => { maxId = Math.max(maxId, +n); return whole; });
      const rid = 'rId' + (maxId + 1), drawingPath = 'xl/drawings/drawing' + drawingNo + '.xml';
      rels = rels.replace(/<\/Relationships>\s*$/i, '<Relationship Id="' + rid + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing' + drawingNo + '.xml"/></Relationships>');
      sheetXml = sheetXml.replace(/<worksheet\b([^>]*)>/i, (whole, attrs) => (/xmlns:r=/.test(attrs) ? whole : '<worksheet' + attrs + ' xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'));
      const marker = /<(?:legacyDrawing|legacyDrawingHF|picture|oleObjects|controls|webPublishItems|tableParts|extLst)\b/i.exec(sheetXml);
      const at = marker ? marker.index : sheetXml.lastIndexOf('</worksheet>');
      sheetXml = sheetXml.slice(0, at) + '<drawing r:id="' + rid + '"/>' + sheetXml.slice(at);
      zip.file(sheetPath, sheetXml); zip.file(relPath, rels);
      const chartRels = [];
      items.forEach((spec, i) => {
        const chartPath = 'xl/charts/chart' + chartNo + '.xml';
        zip.file(chartPath, spec.xml);
        chartRels.push('<Relationship Id="rId' + (i + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart" Target="../charts/chart' + chartNo + '.xml"/>');
        override('/' + chartPath, 'application/vnd.openxmlformats-officedocument.drawingml.chart+xml');
        chartNo += 1;
      });
      zip.file(drawingPath, drawingXml(items.map(spec => spec.anchor || { fromCol:0, fromRow:0, toCol:8, toRow:18 })));
      zip.file('xl/drawings/_rels/drawing' + drawingNo + '.xml.rels', relsXml(chartRels));
      override('/' + drawingPath, 'application/vnd.openxmlformats-officedocument.drawing+xml');
      drawingNo += 1;
    }
    zip.file('[Content_Types].xml', types);
    return zip.generateAsync({ type:outputType || 'uint8array', compression:'DEFLATE', compressionOptions:{ level:6 } });
  }

  async function buildXlsx(report, deps) {
    const d = deps || {};
    const built = buildWorkbook(report, d.ExcelJS, { lang:d.lang });
    let data = await built.workbook.xlsx.writeBuffer();
    if (d.JSZip && built.charts.length) {
      // Grafik enjeksiyonu başarısız olursa biçimli tablolar yine teslim edilir.
      try { data = await injectCharts(data, chartSpecsFor(built.workbook, built.charts), d.JSZip, d.outputType || 'uint8array'); }
      catch (err) { if (d.onChartError) d.onChartError(err); }
    }
    return data;
  }

  function fileName(report) {
    const a = String(report.planFrom || '').slice(0, 10), b = String(report.planTo || '').slice(0, 10);
    return 'Planlanan-Gerceklesen' + (a ? '_' + a : '') + (b ? '_' + b : '') + '.xlsx';
  }

  return Object.freeze({
    SEGMENTS, OUTCOMES, DIMENSIONS, REVISION_BUCKETS,
    rowSegments, rowHasSegment, summarize, groupBy, dailySeries, exFactoryRevisions, formatFieldText,
    buildWorkbook, buildXlsx, chartSpecsFor, injectCharts, barChartXml, doughnutXml, excelSerial, fileName,
    // Ortak Excel stil kiti: Backlog V3 aynı görsel dili buradan kullanır.
    excelKit:Object.freeze({ FONT, COLORS:C, styleHeader, styleBody, dataBar, sheetTitle, sectionTitle, setDate, colName, quoteSheet, writeTable, thin }),
  });
});
