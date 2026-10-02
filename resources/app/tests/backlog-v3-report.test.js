'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const V3 = require('../public/backlog-v3-report.js');
const ExcelJS = require('../public/vendor/exceljs.min.js');
const JSZip = require('../public/vendor/jszip.min.js');
const Guards = require('../public/excel-workbook-guards.js');

const ROOT = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');

function row(overrides = {}) {
  return {
    'Sezon':'W26', 'Buyer':'Ayşe', 'Buyer Grup (TR)':'LİSANS', 'Üretici':'SUP A', 'Ürün Klasman':'SWEAT',
    'Siparişin Üretildiği Ülke':'Turkey', 'Sipariş Kod':'1001', 'Model Adı':'MODEL', 'Renk Kod':'01', 'Renk':'Siyah',
    'Adet':100, 'GÜNCEL DURUM\n(STATUS)':'Üretimde', 'YÜKLEME TİPİ':'KARA', 'RİSK\n(PRIORITY)':'YOK',
    'REVİZE YÜKLEME TARİHİ\n(EX-FACTORY)':'2026-09-25T00:00:00.000Z', 'Orijinal Exfactory Merch Tarih':'2026-09-25T00:00:00.000Z',
    'ANTREPO GİRİŞ TARİHİ':'2026-10-20T00:00:00.000Z', 'Retail Depo Tarih Yıl Ay Gün':'2026-11-19T00:00:00.000Z',
    ...overrides,
  };
}
const rows = [
  row(),
  row({ 'Sipariş Kod':'1002', 'Adet':50, 'GÜNCEL DURUM\n(STATUS)':'Yolda', 'Buyer':'Mehmet' }),
  row({ 'Sipariş Kod':'1002', 'Adet':30, 'GÜNCEL DURUM\n(STATUS)':'Depoda', 'Buyer':'Mehmet', 'RİSK\n(PRIORITY)':'VAR' }),
  row({ 'Sipariş Kod':'1003', 'Adet':20, 'GÜNCEL DURUM\n(STATUS)':'Eksik Yükleme', 'REVİZE YÜKLEME TARİHİ\n(EX-FACTORY)':'2026-10-10T00:00:00.000Z' }),
];
const TODAY = '2026-10-02';

test('stages, loaded share and overdue-not-loaded are derived from canonical Backlog rows', () => {
  const items = V3.normalizeRows(rows, { today:TODAY });
  assert.deepEqual(items.map(i => i.stage), ['PRODUCTION', 'IN_TRANSIT', 'IN_WAREHOUSE', 'SHORTAGE']);
  assert.equal(items[0].buyer, 'Ayşe', 'dimensions come from the canonical backlog binding');
  assert.equal(items[0].exFactory, '2026-09-25');
  const s = V3.summarize(items);
  assert.equal(s.qty, 200);
  assert.equal(s.orders, 3);
  assert.equal(s.loadedQty, 80);
  assert.equal(s.overdueQty, 100, 'production line whose current Ex-Factory passed is overdue; future shortage is not');
  assert.equal(s.riskQty, 30);
  const groups = V3.groupBy(items, 'buyer');
  assert.deepEqual(groups.map(g => [g.name, g.qty]), [['Ayşe', 120], ['Mehmet', 80]]);
  for (const g of groups) assert.equal(Object.values(g.stages).reduce((a, b) => a + b, 0), g.qty);
  const weeks = V3.timeline(items, 'exFactory', { today:TODAY });
  assert.deepEqual(weeks.map(w => w.start), ['2026-09-21', '2026-10-05']);
  assert.equal(weeks[0].label, 'H39 · 21.09');
});

test('Backlog V3 workbook: V3 sheets first, optional P&A, legacy sheets kept intact as sheet1/sheet2', async () => {
  const legacy = new ExcelJS.Workbook();
  const lw = legacy.addWorksheet('BACKLOG');
  lw.addRow(['Sipariş Kod', 'Adet', 'Kontrol']);
  lw.getCell('A2').value = '1001'; lw.getCell('B2').value = 100; lw.getCell('C2').value = { formula:'B2*2', result:200 };
  legacy.addWorksheet('Ayarlar').getCell('A1').value = 'NAKLİYE YOL SÜRELERİ (gün)';
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(await legacy.xlsx.writeBuffer());

  const planActual = {
    planRows:[{ id:'1', orderCode:'1001', buyer:'Ayşe', planDate:'2026-10-01', plannedQty:100, loadedQty:0, onTimeQty:0, lateQty:0, undatedQty:0, openQty:100, removedQty:0, overdue:true, overdueDays:1, outcome:'notLoaded' }],
    changes:[], activity:[], groupBy:'buyer', planFrom:'2026-09-28', planTo:'2026-10-04',
  };
  const out = await V3.buildXlsx({ rows, headers:Object.keys(rows[0]), groupBy:'buyer', filterText:'Buyer Grup: LİSANS', planActual }, {
    ExcelJS, JSZip, lang:'tr', workbook:book, today:TODAY,
    afterWrite:buffer => Guards.applyWorkbookGuards(buffer, { validations:[{ sheetPath:'xl/worksheets/sheet1.xml', sqref:'A2:A2', values:['VAR', 'YOK'], allowBlank:false }], freezePanes:[{ sheetPath:'xl/worksheets/sheet1.xml', rows:1, topLeftCell:'A2' }] }, JSZip, 'uint8array'),
    onChartError:err => { throw err; },
  });
  assert.deepEqual(out.sheets.legacy, ['BACKLOG', 'Ayarlar']);
  const zip = await JSZip.loadAsync(out.data);
  const sheet1 = await zip.file('xl/worksheets/sheet1.xml').async('string');
  assert.match(sheet1, /<dataValidation/, 'legacy validation rules land on the legacy BACKLOG sheet');
  assert.match(sheet1, /<f>B2\*2<\/f>/, 'legacy formulas survive');
  const charts = Object.keys(zip.files).filter(name => /^xl\/charts\/chart\d+\.xml$/.test(name));
  assert.ok(charts.length >= 7, 'V3 doughnut/flow/breakdown charts plus P&A charts');
  for (const name of Object.keys(zip.files).filter(n => /^xl\/worksheets\/sheet\d+\.xml$/.test(n))) {
    const xml = await zip.file(name).async('string');
    assert.ok((xml.match(/<drawing\b/g) || []).length <= 1, name + ' holds at most one drawing');
  }
  const reread = new ExcelJS.Workbook();
  await reread.xlsx.load(out.data);
  const names = reread.worksheets.map(ws => ws.name);
  assert.deepEqual(names.slice(0, 4), ['Backlog Özet', 'Haftalık Akış', 'Kırılımlar', 'Backlog V3']);
  assert.ok(names.includes('P&A Özet') && names.includes('P&A Plan Gerçekleşme'));
  assert.deepEqual(names.slice(-2), ['BACKLOG', 'Ayarlar']);
  const detail = reread.getWorksheet('Backlog V3');
  assert.equal(detail.rowCount, rows.length + 1);
  assert.equal(detail.getCell('A2').value, 'Üretimde');
  assert.equal(detail.getCell('B2').value, 7, 'overdue days for the production line');
  assert.match(V3.fileName(new Date(2026, 9, 2, 9, 5)), /^Backlog_V3_20261002_0905\.xlsx$/);
});

test('Backlog screen wiring: overview panel, Excel Legacy + Excel Backlog V3 with options, shared rows cache', () => {
  const HTML = read('public/index.html'), APP = read('public/app-main.js'), DELIVERY = read('public/backlog-delivery-analysis.js');
  const OVERVIEW = read('public/backlog-overview.js'), STORAGE = read('public/user-storage.js'), CSS = read('public/backlog-overview.css');
  assert.match(HTML, /id="backlogOverview" class="panel blvModule/);
  assert.match(HTML, /data-i18n-tr="Excel Legacy"/);
  assert.match(HTML, /id="backlogExportV3Btn"/);
  assert.match(HTML, /data-blv-export="includePlanActual"/);
  assert.match(HTML, /data-blv-export="includeLegacy"/);
  const order = ['backlog-plan-actual-report.js', 'backlog-plan-actual.js?', 'backlog-v3-report.js', 'backlog-overview.js'].map(f => HTML.indexOf(f));
  assert.ok(order.every((v, i) => v > 0 && (i === 0 || v > order[i - 1])), 'report engines load before their panels');
  assert.match(APP, /window\.BLBacklogOverview\?\.onBacklogRendered\?\.\(data\)/);
  assert.match(APP, /exportBacklogToExcel\(null,\{buttonId:'backlogExportV3Btn',onLegacyWorkbook:/);
  assert.match(APP, /if\(typeof options\.onLegacyWorkbook==='function'\)\{await options\.onLegacyWorkbook\(/);
  assert.match(APP, /window\.BLBacklogPlanActual\?\.exportReport\?\.\(\)/);
  assert.match(DELIVERY, /window\.BLBacklogRows\.load\(params\)/);
  assert.match(OVERVIEW, /window\.BLBacklogRows\.invalidate\(\);signature='';/);
  assert.equal((STORAGE.match(/'lcw\.backlog\.overview\.'/g) || []).length, 2);
  assert.doesNotMatch(CSS, /#fff|var\(--bad\)|var\(--ok\)/);
});
