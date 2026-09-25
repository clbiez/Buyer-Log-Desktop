'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const XLSX = require('xlsx');

const ROOT = path.join(__dirname, '..');
const chart = require(path.join(ROOT, 'public', 'backlog-chart.js'));
const INDEX = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
const APP = fs.readFileSync(path.join(ROOT, 'public', 'app-main.js'), 'utf8');
const CSS = fs.readFileSync(path.join(ROOT, 'public', 'app.css'), 'utf8');

const headers = ['Model Bütçe Tarihi','Adet','Buyer','MAG'];
const rows = [
  {'Model Bütçe Tarihi':'31.08.2026',Adet:10,Buyer:'A',MAG:'M1'},
  {'Model Bütçe Tarihi':'01.09.2026',Adet:5,Buyer:'A',MAG:'M1'},
  {'Model Bütçe Tarihi':'02.09.2026',Adet:7,Buyer:'B',MAG:'M2'},
  {'Model Bütçe Tarihi':'08.09.2026',Adet:3,Buyer:'A',MAG:'M2'},
];

function state(extra={}) {
  return Object.assign({
    enabled:true,timeField:'Model Bütçe Tarihi',granularity:'week',
    metricField:'Adet',aggregation:'sum',seriesField:'Buyer',
    chartType:'line',seriesLimit:'20',title:'',
  },extra);
}

test('Backlog chart week aggregation uses selectable date, value and series fields', () => {
  const model = chart.buildModel(rows, headers, state());
  assert.equal(model.categories.length, 2);
  assert.match(model.categories[0].label, /36\. Hafta 2026/);
  assert.match(model.categories[1].label, /37\. Hafta 2026/);
  const a = model.series.find(item => item.name === 'A');
  const b = model.series.find(item => item.name === 'B');
  assert.deepEqual(a.values, [15,3]);
  assert.deepEqual(b.values, [7,0]);
});

test('Backlog chart supports count, distinct count, sum and average aggregations', () => {
  assert.deepEqual(chart.buildModel(rows,headers,state({aggregation:'count'})).series.find(s=>s.name==='A').values,[2,1]);
  assert.deepEqual(chart.buildModel(rows,headers,state({aggregation:'distinct',metricField:'MAG'})).series.find(s=>s.name==='A').values,[1,1]);
  assert.deepEqual(chart.buildModel(rows,headers,state({aggregation:'avg'})).series.find(s=>s.name==='A').values,[7.5,3]);
  const records=chart.buildModel(rows,headers,state({metricField:'__records',aggregation:'count',seriesField:''}));
  assert.deepEqual(records.series[0].values,[3,1]);
});

test('Chart builder detects date columns and can infer Buyer / quantity defaults', () => {
  assert.ok(chart.detectDateHeaders(headers,rows).includes('Model Bütçe Tarihi'));
  const inferred=chart.inferState(headers,rows,{enabled:false});
  assert.equal(inferred.timeField,'Model Bütçe Tarihi');
  assert.equal(inferred.metricField,'Adet');
  assert.equal(inferred.aggregation,'sum');
  assert.equal(inferred.seriesField,'Buyer');
});

test('Backlog page exposes chart toolbar control, panel, styles and module', () => {
  const section=INDEX.slice(INDEX.indexOf('<section id="view-backlog">'),INDEX.indexOf('<section id="view-automations">'));
  assert.match(section,/id="backlogChartBtn"/);
  assert.match(section,/id="backlogChartPanel"/);
  assert.match(INDEX,/src="backlog-chart\.js\?v=__BL_ASSET_VERSION__/);
  assert.match(CSS,/\.backlogChartPanel/);
  assert.match(CSS,/\.backlogChartSettingsGrid/);
});

test('Backlog render refreshes chart and Excel export appends chart sheets', () => {
  assert.match(APP,/window\.BLBacklogChart\?\.onBacklogRendered\?\.\(data\)/);
  assert.match(APP,/window\.BLBacklogChartContext=/);
  assert.match(APP,/appendWorkbookSheets\?\.\(wb,data\.rows\|\|\[\],data\.headers\|\|\[\]/);
  assert.match(APP,/charts:chartExport&&Array\.isArray\(chartExport\.charts\)/);
  assert.match(APP,/window\.BLBacklogChart\.applyExcelCharts\(patched,charts,JSZip,'blob'\)/);
});

test('Excel export creates Chart and Chart Data sheets with native chart formulas', () => {
  const wb=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet([['BACKLOG']]),'BACKLOG');
  const result=chart.appendWorkbookSheets(wb,rows,headers,{XLSX,state:state()});
  assert.ok(result);
  assert.ok(wb.SheetNames.includes('Grafik'));
  assert.ok(wb.SheetNames.includes('Grafik Verisi'));
  assert.equal(result.charts.length,1);
  assert.match(result.charts[0].categoriesFormula,/'Grafik Verisi'!\$A\$2:\$A\$3/);
  assert.equal(result.charts[0].series.length,2);
  const xml=chart.chartXml(result.charts[0],0);
  assert.match(xml,/<c:lineChart>/);
  assert.match(xml,/<c:strRef><c:f>&apos;Grafik Verisi&apos;!\$A\$2:\$A\$3<\/c:f>/);
  assert.match(xml,/<c:numRef>/);
});
