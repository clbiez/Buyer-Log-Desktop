'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const dates = require(path.join(ROOT, 'public', 'excel-date-utils.js'));
const schemaRegistry = require(path.join(ROOT, 'public', 'column-schema.js'));
const APP = fs.readFileSync(path.join(ROOT, 'public', 'app-main.js'), 'utf8');
const DETAIL = fs.readFileSync(path.join(ROOT, 'public', 'detail-drawer.js'), 'utf8');
const CAPACITY = fs.readFileSync(path.join(ROOT, 'public', 'capacity-request-export.js'), 'utf8');

function functionBlock(source, name) {
  const start = source.indexOf('function ' + name + '(');
  assert.ok(start >= 0, name + ' must exist');
  const next = source.indexOf('\nfunction ', start + 1);
  return source.slice(start, next < 0 ? source.length : next);
}

test('global Excel date format matches Buyer Log GG.AA.YY display', () => {
  assert.equal(dates.DATE_FORMAT, 'dd.mm.yy');
});

test('shared column schema keeps display and Excel typing in sync', () => {
  const date = schemaRegistry.resolveColumnSchema({ field: 'Ex-Factory', dataType: 'date' });
  assert.equal(date.format('2027-02-10'), '10.02.27');
  assert.equal(date.excelNumberFormat(), 'dd.mm.yy');
  assert.ok(date.excelValue('2027-02-10') instanceof Date);

  const quantity = schemaRegistry.resolveColumnSchema({ field: 'Quantity', dataType: 'quantity' });
  assert.equal(quantity.format(5000), '5.000');
  assert.equal(quantity.excelValue('5000'), 5000);
  assert.equal(quantity.excelNumberFormat(), '#,##0');

  const money = schemaRegistry.resolveColumnSchema({ field: 'FOB', dataType: 'currency' });
  assert.equal(money.format('4.31'), '4,31');
  assert.equal(money.excelValue('4,31'), 4.31);
  assert.equal(money.excelNumberFormat(), '#,##0.00');

  const pct = schemaRegistry.resolveColumnSchema({ field: 'Royalty', dataType: 'percentage', percentageScale: 'percent' });
  assert.equal(pct.format(8), '8%');
  assert.equal(pct.excelValue(8), 0.08);
  assert.equal(pct.excelNumberFormat(), '0.00%');
});

test('Collection clipboard delegates standard columns to the exact UI formatter', () => {
  const block = functionBlock(APP, 'kolCollectionRawCellText');
  assert.match(block, /return kolGroupSummaryFormatBaseValue\(c,row,v\)/);
  assert.match(APP, /if\(column\.date\)return fmtDate\(value\)\|\|'';/);
  assert.match(APP, /if\(column\.qty\)return kolFormatQuantityDisplay\(value\);/);
  assert.match(APP, /if\(column\.percent\)return kolFormatPercentDisplay\(value\);/);
});

test('Collection custom Excel columns use schema value and number format', () => {
  const start = APP.indexOf('async function kolExportWithImages');
  const end = APP.indexOf('function kolStyleExportValue', start);
  const block = APP.slice(start, end);
  assert.match(block, /schema\.excelValue/);
  assert.match(block, /schema\.excelNumberFormat/);
  assert.match(APP, /if\(field\.date&&cell\.value instanceof Date\)cell\.numFmt='dd\.mm\.yy';/);
  assert.doesNotMatch(APP, /numFmt='dd\.mm\.yyyy'/);
});

test('Collection rich clipboard carries Office formats and visible status labels', () => {
  const copy = functionBlock(APP, 'buildCollectionStyledCopy');
  assert.match(copy, /mso-number-format/);
  assert.match(copy, /dd\.mm\.yy/);
  assert.match(copy, /0\.00%/);
  assert.match(copy, /#,##0/);
  assert.match(APP, /if\(column\.status\|\|column\.k==='durum'\)return kolStatusDisplayLabel\(value\);/);
  const start = APP.indexOf('async function kolExportWithImages');
  const end = APP.indexOf('function kolStyleExportValue', start);
  assert.match(APP.slice(start, end), /kolExportSingleLineText\(kolStatusDisplayLabel\(raw\)\)/);
});


test('shared detail drawer no longer serializes visible dates as ISO text', () => {
  const display = functionBlock(DETAIL, 'valueOf');
  assert.doesNotMatch(display, /toISOString\(\)\.slice\(0,10\)/);
  assert.match(display, /schema\.format\(value,\{row\}\)/);
  assert.match(DETAIL, /function excelValueOf\(/);
  assert.match(DETAIL, /function excelFormatOf\(/);
  assert.match(DETAIL, /normalizeExcelJsWorkbookDateColumns/);
});

test('capacity export fallback uses the same two-digit year format', () => {
  assert.match(CAPACITY, /DATE_FORMAT\)\|\|'dd\.mm\.yy'/);
  assert.doesNotMatch(CAPACITY, /DATE_FORMAT\)\|\|'dd\.mm\.yyyy'/);
});
