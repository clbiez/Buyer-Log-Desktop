'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const GridClipboard = require('../public/grid-clipboard.js');
const Exporter = require('../public/table-export.js');

const rows = [
  { _id: 30, a: 'A3', b: 'B3', c: 'C3' },
  { _id: 10, a: 'A1', b: 'B1', c: 'C1' },
  { _id: 20, a: 'A2', b: 'B2', c: 'C2' },
];
const columns = [
  { k: 'a', label: 'A Header' },
  { k: 'b', label: 'B Header' },
  { k: 'c', label: 'C Header' },
];

test('stable row/column identities normalize forward and reverse rectangular ranges', () => {
  const options = { rows, columns, rowId: row => row._id, columnId: col => col.k };
  assert.deepEqual(
    GridClipboard.resolveRange({ rowId: 30, columnId: 'b' }, { rowId: 20, columnId: 'c' }, options),
    { startRow: 0, endRow: 2, startColumn: 1, endColumn: 2 },
  );
  assert.deepEqual(
    GridClipboard.resolveRange({ rowId: 20, columnId: 'c' }, { rowId: 30, columnId: 'b' }, options),
    { startRow: 0, endRow: 2, startColumn: 1, endColumn: 2 },
  );
});

test('sort/filter reconciliation never falls back to stale array indexes', () => {
  const options = { rows: [rows[2], rows[0], rows[1]], columns, rowId: row => row._id, columnId: col => col.k };
  assert.deepEqual(
    GridClipboard.resolveRange({ rowId: 30, columnId: 'a' }, { rowId: 10, columnId: 'b' }, options),
    { startRow: 1, endRow: 2, startColumn: 0, endColumn: 1 },
  );
  assert.equal(
    GridClipboard.resolveRange({ rowId: 999, columnId: 'a' }, { rowId: 10, columnId: 'b' }, options),
    null,
  );
});

test('grid shortcuts leave native editors and modal/search fields alone', () => {
  assert.equal(GridClipboard.nativeEditingTarget({ closest: selector => selector.includes('input') ? {} : null }), true);
  assert.equal(GridClipboard.nativeEditingTarget({ closest: () => null }), false);
});

test('selected rectangle contains only selected rows/columns and includes matching headers', () => {
  const range = GridClipboard.resolveRange(
    { rowId: 30, columnId: 'b' },
    { rowId: 10, columnId: 'c' },
    { rows, columns, rowId: row => row._id, columnId: col => col.k },
  );
  const matrix = GridClipboard.buildMatrix({
    rows,
    columns,
    range,
    header: col => col.label,
    value: (row, col) => row[col.k],
    exporter: Exporter,
  });
  assert.deepEqual(matrix.headers, ['B Header', 'C Header']);
  assert.deepEqual(matrix.rows, [['B3', 'C3'], ['B1', 'C1']]);
  assert.equal(Exporter.toTSV(matrix), 'B Header\tC Header\r\nB3\tC3\r\nB1\tC1');
  const html = Exporter.toSafeHTML(matrix);
  assert.equal((html.match(/<tbody><tr>|<tr>/g) || []).length, 3);
  assert.equal((html.match(/<td /g) || []).length, 4);
  assert.doesNotMatch(html, /rowspan|colspan/i);
});

test('copy payload supports headers on/off and reports normalized selection size', () => {
  const range={startRow:0,endRow:1,startColumn:1,endColumn:2};
  const matrix=GridClipboard.buildMatrix({rows,columns,range,header:col=>col.label,value:(row,col)=>row[col.k],exporter:Exporter});
  assert.deepEqual(GridClipboard.selectionSize(range),{rows:2,columns:2,cells:4,label:'2×2'});
  const withHeaders=GridClipboard.serialize(matrix,Exporter,{includeHeaders:true});
  const withoutHeaders=GridClipboard.serialize(matrix,Exporter,{includeHeaders:false});
  assert.match(withHeaders.plain,/^B Header\tC Header/);
  assert.doesNotMatch(withoutHeaders.plain,/B Header/);
  assert.match(withHeaders.html,/<thead>/);
  assert.doesNotMatch(withoutHeaders.html,/<thead>/);
});

test('clipboard diagnostics is bounded and never stores clipboard cell payloads', () => {
  const diagnostics=GridClipboard.createDiagnostics(2);
  diagnostics.record({module:'cp',operation:'copy',plain:'SECRET',html:'<td>SECRET</td>',selection:{rows:1,columns:1}});
  diagnostics.record({module:'orders',operation:'copy',error:new Error('SECRET failure')});
  diagnostics.record({module:'collection',operation:'paste',clipboard:{rows:2,columns:3}});
  diagnostics.record({module:'cp',operation:'copy',ok:false});
  const entries=diagnostics.list();
  assert.equal(entries.length,2);
  assert.doesNotMatch(JSON.stringify(entries),/SECRET|<td>/);
  assert.equal(entries[0].clipboard.rows,2);
  assert.equal(entries[1].error,'ClipboardWriteFailed');
  diagnostics.clear();assert.equal(diagnostics.list().length,0);
});

test('clipboard serialization keeps each logical row on one TSV row and sanitizes unsafe scalars', () => {
  const matrix = GridClipboard.buildMatrix({
    rows: [{ id: 'r1', a: 'line 1\r\nline 2', b: null, c: {} }],
    columns,
    range: { startRow: 0, endRow: 0, startColumn: 0, endColumn: 2 },
    header: col => col.label,
    value: (row, col) => row[col.k],
    exporter: Exporter,
  });
  const plain = Exporter.toTSV(matrix);
  assert.equal(plain.split('\r\n').length, 2);
  assert.doesNotMatch(plain, /undefined|null|NaN|\[object Object\]/);
  assert.match(plain, /line 1 line 2/);
});

test('CP and Orders are wired to the shared stable selection lifecycle', () => {
  const html = fs.readFileSync('public/index.html', 'utf8');
  const app = fs.readFileSync('public/app-main.js', 'utf8');
  const css = fs.readFileSync('public/app.css', 'utf8');
  assert.match(html, /grid-clipboard\.js/);
  assert.match(app, /registerManagedGridClipboard\('cpTable','cp'\)/);
  assert.match(app, /registerManagedGridClipboard\('ordersTable','orders'\)/);
  assert.match(app, /BLGridClipboard\?\.afterRender\?\.\(tableId\)/);
  assert.match(app, /table\._blRenderedRows\s*=\s*rows/);
  assert.match(app, /removeEventListener\('copy',copyHandler,true\)/);
  assert.match(app, /savedRanges\.forEach\(range=>selection\.addRange\(range\)\)/);
  assert.match(css, /blGridRangeCell/);
});

test('copy options, selection measure and metadata-only diagnostics are exposed in the shared toolbar', () => {
  const html = fs.readFileSync('public/index.html', 'utf8');
  const app = fs.readFileSync('public/app-main.js', 'utf8');
  assert.match(html,/id="navCopyMenuBtn"/);
  assert.match(html,/id="gridSelectionStatus"/);
  assert.match(app,/Copy without headers|Başlıksız kopyala/);
  assert.match(app,/openClipboardDiagnostics/);
  assert.match(app,/Metadata only; copied values are never recorded/);
  assert.match(app,/BLGridClipboard\.serialize\(matrix,BLTableExport,options\)/);
});
