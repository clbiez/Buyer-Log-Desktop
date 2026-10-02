'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Report = require('../public/backlog-plan-actual-report.js');
const ExcelJS = require('../public/vendor/exceljs.min.js');
const JSZip = require('../public/vendor/jszip.min.js');

function planRow(overrides = {}) {
  return {
    id:'1', orderCode:'1001', modelName:'MODEL', colourCode:'01', colour:'Siyah',
    buyer:'Ayşe', buyingGroup:'LİSANS', mag:'M1', mmyg:'Y1', productMainDefinition:'SWEATSHIRT', manufacturer:'SUP', season:'W26',
    planDate:'2026-10-01', currentPlanDate:'2026-10-01', planShiftDays:0,
    plannedQty:100, loadedQty:0, onTimeQty:0, lateQty:0, undatedQty:0, openQty:100, removedQty:0,
    overdue:true, overdueDays:3, lateDays:0, lastLoadDate:'', status:'Üretimde · 100', eta:'2026-11-01', outcome:'notLoaded',
    ...overrides,
  };
}
const rows = [
  planRow(),
  planRow({ id:'2', buyer:'Mehmet', productMainDefinition:'HOODIE', loadedQty:100, onTimeQty:100, openQty:0, overdue:false, overdueDays:0, outcome:'onTime' }),
  planRow({ id:'3', buyer:'Mehmet', planDate:'2026-10-02', loadedQty:60, lateQty:40, undatedQty:20, openQty:40, outcome:'partial' }),
  planRow({ id:'4', buyer:'Ayşe', planDate:'2026-10-09', overdue:false, overdueDays:0, outcome:'pending' }),
];

test('segments add up to planned quantity for every grouping', () => {
  for (const dim of Report.DIMENSIONS) {
    for (const group of Report.groupBy(rows, dim.key)) {
      const total = Object.values(group.segments).reduce((sum, value) => sum + value, 0);
      assert.equal(total, group.planned, `${dim.key}/${group.name}`);
    }
  }
  const all = Report.summarize(rows);
  assert.equal(all.planned, 400);
  assert.equal(all.segments.overdue, 140);
  assert.equal(all.segments.pending, 100);
  assert.equal(all.segments.onTime, 100);
  assert.ok(Report.DIMENSIONS.some(dim => dim.key === 'productMainDefinition'));
  const pmd = Report.groupBy(rows, 'productMainDefinition').map(g => g.name).sort();
  assert.deepEqual(pmd, ['HOODIE', 'SWEATSHIRT']);
});

test('daily series and ex-factory revision buckets are deterministic', () => {
  const days = Report.dailySeries(rows);
  assert.deepEqual(days.map(d => d.day), ['2026-10-01', '2026-10-02', '2026-10-09']);
  const buckets = Report.exFactoryRevisions([
    { fields:[{ label:'Planlanan Ex-Factory', days:-5 }] },
    { fields:[{ label:'Planlanan Ex-Factory', days:9 }] },
    { fields:[{ label:'Planlanan Ex-Factory', days:21 }] },
    { fields:[{ label:'Retail', days:30 }] },
  ]);
  const count = key => buckets.find(b => b.key === key).count;
  assert.equal(count('e1'), 1);
  assert.equal(count('l8'), 1);
  assert.equal(count('l15'), 1);
  assert.equal(buckets.reduce((t, b) => t + b.count, 0), 3);
});

test('styled workbook carries dashboard, breakdowns, detail sheets and native charts', async () => {
  const data = await Report.buildXlsx({
    planRows:rows,
    changes:[{ orderCode:'1001', fields:[{ label:'Planlanan Ex-Factory', category:'exfactory', before:'2026-10-01', after:'2026-10-04', days:3 }] }],
    activity:[{ orderCode:'1001', field:'Ex-Factory', eventCount:2, repeated:true }],
    groupBy:'productMainDefinition', planFrom:'2026-09-28', planTo:'2026-10-10',
    periodText:'a → b', planWindowText:'c → d', snapshotText:'e → f',
  }, { ExcelJS, JSZip, lang:'tr', onChartError:err => { throw err; } });

  const zip = await JSZip.loadAsync(data);
  const charts = Object.keys(zip.files).filter(name => /^xl\/charts\/chart\d+\.xml$/.test(name));
  assert.equal(charts.length, 4, 'doughnut + daily + breakdown on summary, daily on its own sheet');
  const sheet1 = await zip.file('xl/worksheets/sheet1.xml').async('string');
  assert.equal((sheet1.match(/<drawing\b/g) || []).length, 1, 'a worksheet may hold exactly one drawing part');
  assert.ok(sheet1.indexOf('<drawing') < sheet1.indexOf('<extLst'), 'drawing must precede extLst');
  const drawing = await zip.file('xl/drawings/drawing1.xml').async('string');
  assert.equal((drawing.match(/<xdr:twoCellAnchor/g) || []).length, 3);
  const chartXml = await Promise.all(charts.map(name => zip.file(name).async('string')));
  assert.ok(chartXml.some(xml => xml.includes('<c:doughnutChart>')));
  assert.ok(chartXml.some(xml => xml.includes('<c:grouping val="percentStacked"/>') && xml.includes('<c:barDir val="bar"/>')));
  assert.ok(chartXml.every(xml => xml.includes('A8453A')), 'segment palette is applied');
  const types = await zip.file('[Content_Types].xml').async('string');
  assert.match(types, /drawingml\.chart\+xml/);

  const reread = new ExcelJS.Workbook();
  await reread.xlsx.load(data);
  assert.deepEqual(reread.worksheets.map(ws => ws.name), ['Özet', 'Günlük Plan', 'Kırılımlar', 'Plan Gerçekleşme', 'Net Değişiklikler', 'Değişiklik Trafiği']);
  const detail = reread.getWorksheet('Plan Gerçekleşme');
  assert.equal(detail.rowCount, rows.length + 1);
  assert.equal(detail.getCell('A2').value, 'Yüklenmedi · tarihi geçti');
  const planDateCol = detail.getRow(1).values.indexOf('Plan Ex-Factory');
  // Tam sayı seri + tarih biçimi geri okunduğunda aynı takvim günü çıkmalı.
  assert.equal(detail.getRow(2).getCell(planDateCol).value.toISOString().slice(0, 10), '2026-10-01');
  assert.equal(detail.getRow(2).getCell(planDateCol).numFmt, 'dd.mm.yyyy');
  const breakdowns = reread.getWorksheet('Kırılımlar');
  const labels = [];
  breakdowns.eachRow(row => labels.push(String(row.getCell(2).value || '')));
  for (const label of ['Buyer', 'Buying Group', 'MAG', 'MMYG', 'Ürün Ana Tanım']) assert.ok(labels.includes(label), label);
  assert.equal(Report.fileName({ planFrom:'2026-09-28', planTo:'2026-10-10' }), 'Planlanan-Gerceklesen_2026-09-28_2026-10-10.xlsx');
});

test('excel serial is an integer calendar day without timezone drift', () => {
  assert.equal(Report.excelSerial('2026-01-02'), 46024);
  assert.equal(Report.excelSerial(''), null);
  assert.equal(path.basename(require.resolve('../public/backlog-plan-actual-report.js')), 'backlog-plan-actual-report.js');
});
