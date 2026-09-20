'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const registry = require('../public/column-schema.js');

test('v7.65 · valid source dates use the BL display standard and invalid dates stay raw', () => {
  const schema = registry.resolveColumnSchema({ field: 'New Date', label: 'New Date' }, [{ 'New Date': 20261005 }]);
  assert.equal(schema.dataType, 'date');
  assert.equal(schema.format(20261005), '05.10.26');
  assert.equal(schema.format('20261005'), '05.10.26');
  assert.equal(schema.format('2026-10-05'), '05.10.26');
  assert.equal(schema.format('2026/10/05'), '05.10.26');
  assert.equal(schema.parse('20261345'), null);
  assert.equal(schema.format('20261345'), '20261345');
});

test('v7.65 · datetime keeps the time component', () => {
  const schema = registry.resolveColumnSchema({ field: 'Updated At', dataType: 'datetime' });
  assert.equal(schema.dataType, 'datetime');
  assert.match(schema.format('2026-10-05T14:32:10'), /^05\.10\.26 14:32$/);
});

test('v7.65 · schema priority is explicit schema, metadata, alias, safe inference, text', () => {
  assert.equal(registry.resolveColumnSchema({ field: 'Amount', dataType: 'text' }, [{ Amount: '12.5' }]).dataType, 'text');
  assert.equal(registry.resolveColumnSchema({ field: 'Amount' }, [{ Amount: '12.5' }], { dataType: 'currency' }).dataType, 'currency');
  assert.equal(registry.resolveColumnSchema({ field: 'Order Quantity' }).dataType, 'quantity');
  assert.equal(registry.resolveColumnSchema({ field: 'New Amount' }, [{ 'New Amount': '12.5' }]).dataType, 'decimal');
  assert.equal(registry.resolveColumnSchema({ field: 'Unknown' }, [{ Unknown: '12.5' }, { Unknown: 'n/a' }]).dataType, 'text');
});

test('v7.65 · quantity/decimal preserve zero, false and code leading zeroes', () => {
  const quantity = registry.resolveColumnSchema({ field: 'Quantity', dataType: 'quantity' });
  assert.equal(quantity.parse('1500'), 1500);
  assert.equal(quantity.parse(0), 0);
  assert.equal(quantity.exportValue(0), 0);
  const boolean = registry.resolveColumnSchema({ field: 'Approved', dataType: 'boolean' });
  assert.equal(boolean.parse(false), false);
  assert.equal(boolean.parse('N'), false);
  const code = registry.resolveColumnSchema({ field: 'Colour Code' }, [{ 'Colour Code': '001234' }]);
  assert.equal(code.dataType, 'code/id');
  assert.equal(code.parse('001234'), '001234');
});

test('v7.65 · typed sort and date filtering are chronological, not lexical', () => {
  const schema = registry.resolveColumnSchema({ field: 'Ship Date', dataType: 'date' });
  const values = ['2026-10-12', '2026-02-01', '2026-10-05'];
  const sorted = values.slice().sort((a, b) => schema.sortValue(a) - schema.sortValue(b));
  assert.deepEqual(sorted, ['2026-02-01', '2026-10-05', '2026-10-12']);
  const start = schema.filterValue('2026-10-01');
  const end = schema.filterValue('2026-10-10');
  assert.equal(schema.filterValue('20261005') >= start && schema.filterValue('20261005') <= end, true);
  assert.equal(schema.filterValue('2026-11-01') <= end, false);
});

test('v7.65 · dynamic CP/Collection paths use the central registry', () => {
  const app = read('public/app-main.js');
  const formula = read('public/formula-columns.js');
  const index = read('public/index.html');
  assert.match(index, /column-schema\.js\?v=/);
  assert.match(app, /function resolveTableColumnSchemas\(/);
  assert.match(app, /resolveTableColumnSchemas\(tableKey,rows\)/);
  assert.match(app, /c\.modelCustom && schema/);
  assert.match(app, /c\.custom&&schema/);
  assert.match(formula, /window\.resolveColumnSchema/);
});
