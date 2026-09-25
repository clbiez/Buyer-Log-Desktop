'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const XLSX = require('xlsx');
const JSZip = require('../public/vendor/jszip.min.js');
const dateDimension = require('../public/date-dimension.js');

global.BLDateDimension = dateDimension;
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

test('Backlog chart uses the shared Collection month/week date dimension', () => {
  const model = chart.buildModel(rows, headers, state());
  assert.equal(model.categories.length, 2);
  assert.equal(model.categories[0].label, '36. Hafta Eylül 2026');
  assert.equal(model.categories[1].label, '37. Hafta Eylül 2026');
  const a = model.series.find(item => item.name === 'A');
  const b = model.series.find(item => item.name === 'B');
  assert.deepEqual(a.values, [15,3]);
  assert.deepEqual(b.values, [7,0]);

  const month = chart.buildModel(rows, headers, state({granularity:'month'}));
  assert.deepEqual(month.categories.map(item=>item.label), ['Eylül 2026']);
  assert.deepEqual(month.series.find(item=>item.name==='A').values, [18]);
  assert.deepEqual(month.series.find(item=>item.name==='B').values, [7]);
  assert.equal(chart.bucketFor(chart.parseDate('31.08.2026'),'month').label,'Eylül 2026');
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
  assert.match(INDEX,/src="date-dimension\.js\?v=__BL_ASSET_VERSION__/);
  assert.match(INDEX,/src="backlog-chart\.js\?v=__BL_ASSET_VERSION__/);
  assert.match(CSS,/\.backlogChartPanel/);
  assert.match(CSS,/\.backlogChartSettingsGrid/);
});

test('Backlog render refreshes chart and Excel export appends chart sheets', () => {
  assert.match(APP,/window\.BLBacklogChart\?\.onBacklogRendered\?\.\(data\)/);
  assert.match(APP,/window\.BLBacklogChartContext=/);
  assert.match(APP,/prepareQuery:\(\)=>fetchBacklogSourceColumns\(\)/);
  assert.match(APP,/appendWorkbookSheets\?\.\(/);
  assert.match(APP,/const chartSpecs=chartExport&&Array\.isArray\(chartExport\.charts\)\?chartExport\.charts:\[\]/);\n  assert.match(APP,/charts:chartSpecs/);
  assert.match(APP,/window\.BLBacklogChart\.applyExcelCharts\(patched,charts,JSZip,'blob'\)/);
  assert.match(APP,/backlogExpandDateDimensions\(exportHeaders,data\.rows\|\|\[\]\)/);
});

test('Excel export creates Grafik and Grafik Verisi sheets with native chart formulas', () => {
  const wb=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet([['BACKLOG']]),'BACKLOG');
  const result=chart.appendWorkbookSheets(wb,rows,headers,{XLSX,state:state()});
  assert.ok(result);
  assert.ok(wb.SheetNames.includes('Grafik'));
  assert.ok(wb.SheetNames.includes('Grafik Verisi'));
  assert.equal(result.charts.length,1);
  assert.match(result.charts[0].categoriesFormula,/'Grafik Verisi'!\$A\$2:\$A\$3/);
  assert.equal(result.charts[0].series.length,2);
  const generated=chart.chartXml(result.charts[0],0);
  assert.match(generated,/<c:lineChart>/);
  assert.match(generated,/<c:strRef><c:f>&apos;Grafik Verisi&apos;!\$A\$2:\$A\$3<\/c:f>/);
  assert.match(generated,/<c:numRef>/);
});

test('native Excel chart package contains drawing relationships and reopens as XLSX', async () => {
  const wb=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet([['BACKLOG'],['sample']]),'BACKLOG');
  const result=chart.appendWorkbookSheets(wb,rows,headers,{XLSX,state:state()});
  const raw=XLSX.write(wb,{type:'buffer',bookType:'xlsx',cellStyles:true});
  const patched=await chart.applyExcelCharts(raw,result.charts,JSZip,'nodebuffer');
  const zip=await JSZip.loadAsync(patched);
  assert.ok(zip.file('xl/charts/chart1.xml'));
  assert.ok(zip.file('xl/drawings/drawing1.xml'));
  assert.ok(zip.file('xl/drawings/_rels/drawing1.xml.rels'));
  const sheet=await zip.file(result.charts[0].sheetPath).async('string');
  assert.match(sheet,/<drawing r:id="rId\d+"\/>/);
  const relPath=result.charts[0].sheetPath.replace(/\/[^/]+$/, '/_rels/'+result.charts[0].sheetPath.split('/').pop()+'.rels');
  const rels=await zip.file(relPath).async('string');
  assert.match(rels,/relationships\/drawing/);
  const chartXml=await zip.file('xl/charts/chart1.xml').async('string');
  assert.match(chartXml,/<c:lineChart>/);
  assert.match(chartXml,/Grafik Verisi/);
  const reopened=XLSX.read(patched,{type:'buffer'});
  assert.ok(reopened.SheetNames.includes('Grafik'));
  assert.ok(reopened.SheetNames.includes('Grafik Verisi'));
});
