'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const XLSX = require('xlsx');
const intake = require('../server/lib/intake-report');
const excel = require('../server/lib/intake-excel');
const packagePart = (buffer, name) => Buffer.from(XLSX.CFB.find(XLSX.CFB.read(buffer, { type: 'buffer' }), '/' + name).content);

function fixture() {
  const fields = intake.defaultFields();
  const viewConfig = intake.defaultViewConfig();
  const plan = excel.prepare({ fields, viewConfig });
  const rows = [1, 2].map(n => Object.fromEntries([
    ...plan.config.query.rows.map(field => [field.id, 'DEMO & <' + n + '>']),
    ...plan.config.query.measures.map(field => [field.id, n * 100]),
  ]));
  const buffer = excel.createWorkbook({ connection: { server: 'DEMO;Source', catalog: 'Demo "Catalog"', password: 'NEVER-EXPORT', token: 'NEVER-EXPORT' }, plan, rows });
  const part = name => packagePart(buffer, name)?.toString('utf8');
  return { fields, viewConfig, plan, rows, buffer, part };
}

test('INTAKE export is a real external native pivot, with a typed cache and direct DAX refresh', () => {
  const f = fixture();
  const connection = f.part('xl/connections.xml');
  assert.match(connection, /Provider=MSOLAP/);
  assert.match(connection, /Integrated Security=SSPI/);
  assert.match(connection, /commandType="8"/);
  assert.match(connection, /refreshOnLoad="1"/);
  assert.match(connection, /savePassword="0"/);
  assert.doesNotMatch(connection, /NEVER-EXPORT|localhost|127\.0\.0\.1/);
  assert.match(connection, /Data Source=&quot;DEMO;Source&quot;/);
  assert.match(f.part('xl/pivotCache/pivotCacheDefinition1.xml'), /cacheSource type="external" connectionId="1"/);
  assert.match(f.part('xl/pivotCache/pivotCacheRecords1.xml'), /count="2"/);
  assert.match(f.part('xl/pivotCache/pivotCacheRecords1.xml'), /<n v="100"\/>/);
  assert.match(f.part('xl/pivotTables/pivotTable1.xml'), /dataFields count="/);
  assert.match(f.part('xl/_rels/workbook.xml.rels'), /pivotCacheDefinition/);
  assert.match(f.part('xl/worksheets/_rels/sheet1.xml.rels'), /pivotTable1.xml/);
  assert.doesNotMatch(f.part('xl/worksheets/sheet1.xml'), /pivotTableParts/);
  assert.match(f.part('[Content_Types].xml'), /pivotCacheRecords\+xml/);
  const wb = XLSX.read(f.buffer, { type: 'buffer' });
  assert.deepEqual(wb.SheetNames, ['INTAKE Pivot', 'Yenileme Bilgisi']);
});

test('custom labels stay out of DAX, and active filters and the server row cap survive export', () => {
  const fields = intake.defaultFields(), viewConfig = intake.defaultViewConfig();
  const filter = viewConfig.query.rows[0];
  viewConfig.query.filters.push(filter);
  viewConfig.query.filterValues[filter.id] = ['DEMO "filter"'];
  viewConfig.display.labels[viewConfig.query.measures[0].id] = 'CUSTOM CAPTION';
  const plan = excel.prepare({ fields, viewConfig });
  assert.match(plan.query, /TOPN\(10000/);
  assert.match(plan.query, /TREATAS/);
  assert.match(plan.query, /DEMO ""filter""/);
  assert.doesNotMatch(plan.query, /CUSTOM CAPTION/);
  assert.match(plan.query, /SELECTCOLUMNS/);
  const buffer = excel.createWorkbook({ connection: { server: 'demo', catalog: 'demo' }, plan, rows: [] });
  assert.match(packagePart(buffer, 'xl/pivotTables/pivotTable1.xml').toString(), /CUSTOM CAPTION/);
});

test('weighted ratios use summed products and weights, including the zero-weight average fallback', () => {
  const f = fixture();
  assert.ok(f.plan.calculated.length > 0);
  const weighted = f.plan.calculated[0];
  assert.match(weighted.formula, /_weight'=0/);
  assert.match(weighted.formula, /_count'/);
  assert.match(weighted.formula, /_product'/);
  assert.match(f.plan.query, /NOT ISBLANK/);
  assert.match(f.part('xl/pivotCache/pivotCacheDefinition1.xml'), /databaseField="0" formula="IF/);
  const totals = f.plan.columns.filter(col => col.name.startsWith(weighted.field.id));
  const row = { [weighted.field.id]: 0.25, [weighted.field.weightId]: 400 };
  assert.equal(totals.find(col => col.name.endsWith('_product')).value(row), 100);
  assert.equal(totals.find(col => col.name.endsWith('_weight')).value(row), 400);
});

test('empty results and XML-sensitive source values remain valid and formula-like data is literal', () => {
  const f = fixture();
  const empty = excel.createWorkbook({ connection: { server: 'demo', catalog: 'demo' }, plan: f.plan, rows: [], language: 'en' });
  assert.match(packagePart(empty, 'xl/pivotCache/pivotCacheRecords1.xml').toString(), /count="0"/);
  const row = { ...f.rows[0], [f.plan.config.query.rows[0].id]: '=HYPERLINK("demo")' };
  const buffer = excel.createWorkbook({ connection: { server: 'demo', catalog: 'demo' }, plan: f.plan, rows: [row] });
  const wb = XLSX.read(buffer, { type: 'buffer' });
  assert.equal(wb.Sheets['INTAKE Pivot'].A2.t, 's');
  assert.equal(wb.Sheets['INTAKE Pivot'].A2.f, undefined);
  assert.match(f.part('xl/pivotCache/pivotCacheDefinition1.xml'), /DEMO &amp; &lt;1&gt;/);
});

test('unsupported FIRST is explicit instead of silently summing first-value measures', () => {
  const f = fixture();f.viewConfig.query.measures[0].agg = 'FIRST';
  assert.throws(() => excel.prepare({ fields: f.fields, viewConfig: f.viewConfig }), { code: 'INTAKE_EXCEL_FIRST_UNSUPPORTED' });
});

test('export keeps the Overview authorization boundary and reads current database data without mutating preferences', () => {
  const server = fs.readFileSync(path.join(__dirname, '../server/server.js'), 'utf8');
  const block = server.slice(server.indexOf("app.post('/api/intake/export'"), server.indexOf("app.post('/api/intake/report'"));
  assert.match(block, /requireAnyArea\('overview'\)/);
  assert.match(block, /requireCapability\('OAB.VIEW'\)/);
  assert.match(block, /horizon: intakeHorizon\(\)/);
  assert.match(block, /modelQuery\.runModelRows/);
  assert.doesNotMatch(block, /intakeSave|saveSnapshot|intakeStore\.set/);
});
