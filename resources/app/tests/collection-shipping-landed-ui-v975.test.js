const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const APP = fs.readFileSync('public/app-main.js', 'utf8');
const SPREADSHEET = fs.readFileSync('public/collection-spreadsheet.js', 'utf8');
const CSS = require('./helpers/manifest-css')();
const HTML = fs.readFileSync('public/index.html', 'utf8');
const DB = fs.readFileSync('server/db.js', 'utf8');
const SERVER = require('./helpers/server-source')();

function functionBlock(source, name, nextName) {
  const start = source.indexOf(`function ${name}`);
  assert.ok(start >= 0, `${name} exists`);
  const end = nextName ? source.indexOf(`function ${nextName}`, start) : source.length;
  assert.ok(end > start, `${nextName || 'end'} follows ${name}`);
  return source.slice(start, end);
}

test('Collection shipping transfer uses stable model identity and existing ingestion', () => {
  const keyBlock = functionBlock(APP, 'collectionShippingModelKey', 'mapCollectionRowToShip');
  const key = new Function('BLShippingEngine',`${keyBlock}; return collectionShippingModelKey;`)(require('../public/shipping-engine'));
  assert.equal(key({ plmId: 'İD-13', modelKod: 'A', season: '26' }), 'PLM:ID-13');
  assert.equal(key({ modelKod: 'A-100', season: '26' }), 'MODEL:A-100\u001f26');
  assert.equal(key({ modelKod: 'A-100', season: '27' }), 'MODEL:A-100\u001f27');
  assert.equal(key({ id: 99 }), '');
  assert.match(APP, /filteredKol\(\)\.filter\(row=>selectionHasId\(kolSelected,row\.id\)\)/);
  assert.match(APP, /new Map\(\)/);
  assert.match(APP, /enqueueShipMutation\('\/api\/shipping-comparison'/);
  assert.match(APP, /kolSendShippingBtn/);
  assert.match(HTML, /id="kolSendShippingBtn"[^>]+disabled/);
});

test('server shipping ingestion deduplicates by canonical model and preserves existing rows', () => {
  const dbBlock = functionBlock(DB, 'shippingModelKey', 'addShippingRows');
  const addBlock = functionBlock(DB, 'addShippingRows', 'patchShippingRow');
  const recordBlock = functionBlock(SERVER, 'recordOrderCode', 'withOrderAccess');
  const recordOrderCode = new Function(`${recordBlock}; return recordOrderCode;`)();
  const shippingModelKey = new Function(`${dbBlock}; return shippingModelKey;`)();
  assert.equal(shippingModelKey({ plm: 'P-1', styleName: 'new' }), 'PLM:P-1');
  assert.equal(shippingModelKey({ plmId: 'P-1', styleName: 'changed' }), 'PLM:P-1');
  assert.equal(shippingModelKey({ styleName: 'A-100', season: '26' }), 'MODEL:A-100\u001f26');
  assert.equal(shippingModelKey({ orderCode: 123 }), 'ORDER:123');
  assert.equal(recordOrderCode({ orderCode: '1.234' }), 1234);
  assert.match(addBlock, /existingKeys/);
  assert.match(addBlock, /skippedCount/);
  assert.match(DB, /shippingModelKey, addShippingRows/);
  assert.match(SERVER, /row\._sourceModule\s*!==\s*'collection'/);
});

test('calculated Collection cells are flat, hide Overseas FOB, and make symbols non-interactive', () => {
  assert.match(CSS, /td\.endeksmatikTd[\s\S]*td\.kolLandedTd\{background:transparent!important/);
  assert.match(CSS, /\.endeksmatikCellBtn,\s*#kolTable tbody \.kolLandedCard\{border:0/);
  assert.match(APP, /kolLandedInputGroup/);
  assert.doesNotMatch(APP, /<span class="kolSuppSrc/);
  assert.match(APP, /<i aria-hidden="true">×<\/i><input/);
  assert.match(APP, /<i aria-hidden="true">₺<\/i><input/);
  assert.match(APP, /<i aria-hidden="true">\$<\/i><input/);
});

test('Landed compound-cell inputs stay editable through the shared spreadsheet pointer handler', () => {
  const handlerBlock = functionBlock(SPREADSHEET, 'kolSpreadsheetHandlePointerEdit', 'kolSpreadsheetResumePendingPointerEdit');
  const state = { pendingPointerEdit: null };
  const calls = [];
  const bridgeValue = {
    canEdit: () => true,
    columnMeta: key => ({ editable: key !== 'trLanded' && key !== 'ydLanded' }),
  };
  const handler = new Function(
    'bridgeValue', 'state', 'pointerEditIdentity', 'markPointerEditing',
    'schedulePendingPointerFallback', 'beginEdit', 'setActive',
    `const bridge=()=>bridgeValue;${handlerBlock};return kolSpreadsheetHandlePointerEdit;`,
  )(
    bridgeValue,
    state,
    () => ({ rowId: 'row-1', key: 'trLanded' }),
    () => calls.push('mark'),
    () => calls.push('fallback'),
    () => calls.push('begin'),
    () => calls.push('set-active'),
  );
  const editor = {
    dataset: { k: 'trPrice' },
    closest: selector => selector === '.editCell:not(:disabled)' ? editor : null,
  };
  let prevented = false;
  const result = handler({
    shiftKey: false,
    target: editor,
    preventDefault: () => { prevented = true; },
    stopImmediatePropagation: () => { prevented = true; },
  }, { dataset: { key: 'trLanded' } });

  assert.equal(result, true);
  assert.equal(prevented, false);
  assert.deepEqual(calls, ['mark', 'fallback']);
});

test('Landed manual input metadata is editable while calculated output metadata stays read-only', () => {
  const metaBlock = functionBlock(APP, 'kolSpreadsheetColumnMeta', 'kolSpreadsheetRawValue');
  const landedCols = Object.fromEntries(['trPrice', 'trLandedMult', 'trFx', 'ydLandedMult'].map(key => [key, { k: key, label: key }]));
  const metadata = new Function(
    'L', 'KOL_LANDED_INPUT_COLS', 'kolFieldDescriptorByKey', 'kolStyleFieldLabel', 'kolSpreadsheetFormulaInfo', 'kolFieldMetadata',
    `${metaBlock};return kolSpreadsheetColumnMeta;`,
  )(
    value => value,
    landedCols,
    key => key === 'trLanded' ? { kind: 'base', label: key, col: { k: key, trLanded: true } } : { kind: 'synthetic', label: key },
    field => field.label,
    () => 'calculated',
    () => ({ inheritance: 'model' }),
  );

  for (const key of Object.keys(landedCols)) assert.equal(metadata(key).editable, true, key);
  assert.equal(metadata('trLanded').editable, false);
});

test('Endeksmatik date labels are presentation-only and retain technical In Store keys', () => {
  assert.match(APP, /const retailDepot='RETAIL Depo'/);
  assert.match(APP, /overlay\.innerHTML=overlay\.innerHTML\.replace\(\/In Store\/g,retailDepot\)/);
  assert.match(APP, /previousInStoreMonth/);
  assert.match(APP, /newInStoreMonth/);
  assert.match(APP, /monthField\('previousInStoreMonth'/);
  assert.match(APP, /monthField\('newInStoreMonth'/);
  assert.match(HTML + APP, /In Store/);
});
