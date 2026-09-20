const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const APP = fs.readFileSync('public/app-main.js', 'utf8');
const DB = fs.readFileSync('server/db.js', 'utf8');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'buyerlog-shipping-colours-'));
process.env.BUYER_LOG_SERVER_DATA_ROOT = path.join(root, 'server');
process.env.BUYER_LOG_DATA_ROOT = path.join(root, 'app');
process.env.BUYER_LOG_LOCAL_DATA_ROOT = path.join(root, 'local');
process.env.BUYER_LOG_CONFIG_PATH = path.join(root, 'config.json');
const db = require('../server/db');
test.after(() => fs.rmSync(root, { recursive: true, force: true }));

function functionBlock(source, name, nextName) {
  const start = source.indexOf(`function ${name}`);
  assert.ok(start >= 0, `${name} exists`);
  const end = nextName ? source.indexOf(`function ${nextName}`, start) : source.length;
  assert.ok(end > start, `${nextName || 'end'} follows ${name}`);
  return source.slice(start, end);
}

function exactFunction(source, name) {
  const start = source.indexOf(`function ${name}`);
  assert.ok(start >= 0, `${name} exists`);
  const open = source.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  assert.fail(`${name} does not close`);
}

test('Collection shipping aggregation keeps every unique colour/code pair in one model row', () => {
  const block = [
    exactFunction(APP, 'collectionShippingColourOptions'),
    exactFunction(APP, 'mergeCollectionShippingColourOptions'),
    exactFunction(APP, 'mergeCollectionShippingRows'),
  ].join('\n');
  const mergeRows = new Function(`${block}; return mergeCollectionShippingRows;`)();
  const rows = mergeRows([
    { _modelKey: 'PLM:P-1', orderCode: 100, colour: 'WHITE', colorCode: 'WHT' },
    { _modelKey: 'PLM:P-1', orderCode: 100, colour: 'GREY', colorCode: 'GRY' },
    { _modelKey: 'PLM:P-1', orderCode: 100, colour: 'BLACK', colorCode: 'BLK' },
    { _modelKey: 'PLM:P-1', orderCode: 100, colour: 'WHITE', colorCode: 'WHT' },
    { _modelKey: 'PLM:P-2', orderCode: 200, colour: 'BLACK', colorCode: 'BLK' },
  ]);

  assert.equal(rows.length, 2, 'model/order grouping remains one row per model');
  assert.deepEqual(rows[0]._colourOptions, [
    { colour: 'WHITE', colorCode: 'WHT' },
    { colour: 'GREY', colorCode: 'GRY' },
    { colour: 'BLACK', colorCode: 'BLK' },
  ]);
  assert.equal(rows[0].colour, 'WHITE, GREY, BLACK');
  assert.equal(rows[0].colorCode, 'WHT, GRY, BLK');
  assert.deepEqual(rows[1]._colourOptions, [{ colour: 'BLACK', colorCode: 'BLK' }]);
});

test('Shipping persistence merges duplicate model rows without creating rows or losing colours', () => {
  const block = [exactFunction(DB, 'shippingColourOptions'), exactFunction(DB, 'mergeShippingColourOptions')].join('\n');
  const merge = new Function(`${block}; return mergeShippingColourOptions;`)();
  const target = { _modelKey: 'PLM:P-1', colour: 'WHITE', colorCode: 'WHT' };

  merge(target, { _modelKey: 'PLM:P-1', colour: 'GREY', colorCode: 'GRY' });
  merge(target, { _modelKey: 'PLM:P-1', colour: 'WHITE', colorCode: 'WHT' });

  assert.deepEqual(target._colourOptions, [
    { colour: 'WHITE', colorCode: 'WHT' },
    { colour: 'GREY', colorCode: 'GRY' },
  ]);
  assert.equal(target.colour, 'WHITE, GREY');
  assert.equal(target.colorCode, 'WHT, GRY');
  assert.match(DB, /mergeShippingColourOptions\(existingByKey\.get\(key\), row\)/);
});

test('Shipping save and reload preserves three colours per model without duplicate rows', () => {
  const userId = 'multi-colour-reload-user';
  const saved = db.addShippingRows([
    { _modelKey: 'PLM:P-1', orderCode: 100, colour: 'WHITE', colorCode: 'WHT' },
    { _modelKey: 'PLM:P-1', orderCode: 100, colour: 'GREY', colorCode: 'GRY' },
    { _modelKey: 'PLM:P-1', orderCode: 100, colour: 'BLACK', colorCode: 'BLK' },
    { _modelKey: 'PLM:P-1', orderCode: 100, colour: 'WHITE', colorCode: 'WHT' },
    { _modelKey: 'PLM:P-2', orderCode: 200, colour: 'NAVY', colorCode: 'NVY' },
  ], null, userId);
  assert.equal(saved.addedCount, 2);
  assert.equal(saved.skippedCount, 3);

  const reloaded = db.loadShipping(userId);
  assert.equal(reloaded.rows.length, 2);
  const first = reloaded.rows.find(row => row._modelKey === 'PLM:P-1');
  assert.deepEqual(first._colourOptions, [
    { colour: 'WHITE', colorCode: 'WHT' },
    { colour: 'GREY', colorCode: 'GRY' },
    { colour: 'BLACK', colorCode: 'BLK' },
  ]);
  assert.equal(first.colour, 'WHITE, GREY, BLACK');
  assert.equal(first.colorCode, 'WHT, GRY, BLK');
  assert.deepEqual(reloaded.rows.find(row => row._modelKey === 'PLM:P-2')._colourOptions, [
    { colour: 'NAVY', colorCode: 'NVY' },
  ]);
});
