'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const INDEX = (fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8') + '\n' + fs.readFileSync(path.join(ROOT, 'public', 'app-main.js'), 'utf8'));
const CSS = fs.readFileSync(path.join(ROOT, 'public', 'app.css'), 'utf8');
const SERVER = fs.readFileSync(path.join(ROOT, 'server', 'server.js'), 'utf8');
const parse = require(path.join(ROOT, 'server', 'lib', 'parse.js'));

function asasRow(overrides = {}) {
  return {
    'Sipariş Kod': 1001001,
    'Model Adı': 'MODEL A',
    'Renk Kod': 'C01',
    'Renk': 'BLACK',
    'Net Alım Sipariş Miktarı': 1000,
    'Buyer Grup (TR)': 'GROUP',
    'Üretici': 'MFR A',
    'Ana Kumaş Mı': 1,
    ...overrides,
  };
}

test('v4.78 duplicate main-fabric warning contains drill-down rows', () => {
  const parsed = parse.parseASASRows([
    asasRow({ 'Kumaş Kategorisi': 'KNIT', 'Kumaşçı': '' }),
    asasRow({ 'Kumaş Kategorisi': '', 'Kumaşçı': 'FABRIC SUPPLIER' }),
  ]);
  const detail = parsed.fabricHeaderInfo.warningDetails.find(item => item.id === 'asas-duplicate-main-fabric');
  assert.ok(detail);
  assert.match(detail.message, /birden fazla Ana Kumaş Mı = 1/);
  assert.equal(detail.rows.length, 1);
  assert.equal(detail.rows[0].orderCode, '1001001');
  assert.equal(detail.rows[0].model, 'MODEL A');
  assert.equal(detail.rows[0].colourCode, 'C01');
  assert.equal(detail.rows[0].fabricSupplier, 'FABRIC SUPPLIER');
  assert.match(detail.rows[0].sourceRows, /2, 3/);
});

test('v4.78 invalid IAS quantities retain source rows for warning details', () => {
  const map = parse.parseAntrepoRows([
    {
      'Sipariş Kod': 1001001,
      'Ürün Ad': 'MODEL A',
      'Renk Kod': 'C01',
      'Renk': 'BLACK',
      'Supplier Portal Statü': 'Depoda',
      'Yükleme Toplam Adet': 400,
      'Net Alım Sipariş Miktarı': '',
      'İthalat Dosya No': 'IMP-1',
    },
  ]);
  const meta = parse.antrepoParseMeta(map);
  assert.equal(meta.blankIasOrderQty, 1);
  assert.equal(meta.warningDetailRows.blankIasOrderQty.length, 1);
  assert.equal(meta.warningDetailRows.blankIasOrderQty[0].orderCode, '1001001');
  assert.equal(meta.warningDetailRows.blankIasOrderQty[0].model, 'MODEL A');
  assert.equal(meta.warningDetailRows.blankIasOrderQty[0].sourceRow, 2);
});

test('v4.78 warning list opens related rows on double-click', () => {
  assert.match(INDEX, /let appWarningDetails = new Map\(\)/);
  assert.match(INDEX, /ov\.addEventListener\('dblclick'/);
  assert.match(INDEX, /showWarningDetailTable\(detail\)/);
  assert.match(INDEX, /class="warningDetailTable"/);
  assert.match(CSS, /\.warningDetailTableWrap\{[^}]*overflow:auto/s);
  assert.match(SERVER, /warningDetails:/);
  assert.match(SERVER, /antrepoQuantityWarningInfo/);
});

test('v4.78 search inputs suppress browser Saved Info suggestions', () => {
  assert.match(INDEX, /function suppressSavedInfo\(root\)/);
  assert.match(INDEX, /input\.setAttribute\('autocomplete','off'\)/);
  assert.match(INDEX, /input\.setAttribute\('data-form-type','other'\)/);
  assert.match(INDEX, /new MutationObserver\(mutations=>mutations\.forEach/);
});

test('v4.78 right-button drag pans the nearest scrollable areas', () => {
  assert.match(INDEX, /window\.addEventListener\('pointerdown'/);
  assert.match(INDEX, /if\(event\.button!==2/);
  assert.match(INDEX, /pan\.xTarget\.scrollLeft=pan\.xStart-totalDx/);
  assert.match(INDEX, /pan\.yTarget\.scrollTop=pan\.yStart-totalDy/);
  assert.match(INDEX, /document\.addEventListener\('contextmenu'/);
  assert.match(CSS, /body\.blRightPanActive/);
});

test('v4.78 freeze state stores only a left boundary and toggles off from the same button', () => {
  assert.match(INDEX, /return \{ left: Math\.max\(0,Number\(f&&f\.left\)\|\|0\)\|0, right: 0 \}/);
  assert.match(INDEX, /if\(alreadyFrozen\|\|alreadyArmed\)\{[\s\S]*setFreeze\(tableKey,0\)/);
  assert.match(INDEX, /freezeColumnAtX\(table,event\.clientX\)/);
  assert.doesNotMatch(INDEX, /doneLR|pickTwo|freezeApply/);
});
