'use strict';

/* PLM Sync / PLM içe aktarma, çok renkli modelde kullanıcının daha önce elle
   düzenlediği model düzeyindeki alanı (ör. kumaş) GERÇEKTEN güncellemelidir.
   Hata: içe aktarma yalnız ham row[key] yazıp onu kıyaslıyordu; tablo ise
   modelSharedValues / variantOverrides katmanını okuyordu. Elle düzenleme
   yapılmış çalışma alanında PLM kumaşı görünmüyor, ikinci sync "güncel"
   diyordu — aynı model bir kullanıcıda kumaş alırken diğerinde almıyordu. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Groups = require('../public/collection-model-groups.js');

const norm = value => String(value == null ? '' : value).trim();
const turknorm = value => norm(value).toLocaleUpperCase('tr-TR');
const FABRIC = '3859-Jersey,30,Ne Compact Combed 150 gsm,100%Cotton';

function plan(rows, parsed) {
  return Groups.kolBuildPlmImportPlan(rows, parsed, {
    norm, turknorm,
    kolImportMatchKey: (plmId, modelKod) => `${norm(plmId)}|${turknorm(modelKod)}`,
    kolPlmNormalizeId: norm,
    kolPlmImportColourKey: row => turknorm(row && row.colourCode),
    kolImportReadField: (row, key) => Groups.kolImportReadField(row, key, { norm, turknorm }),
    kolImportFieldLabel: key => key,
    knownByKey: {},
    touched: ['fabric'],
  });
}
function apply(rows, item) {
  Groups.kolApplyApprovedPlmUpdate(item, (row, key, value) => {
    row[key] = value;
    Groups.adoptImportedValue(rows, row, key);
  });
}
const groupedRows = extra => [
  { id: 1, plmId: 'P1', modelKod: 'M', colourCode: 'A', modelGroupId: 'g', modelGroupRole: 'parent', fabric: '', ...extra },
  { id: 2, plmId: 'P1', modelKod: 'M', colourCode: 'B', modelGroupId: 'g', modelGroupRole: 'variant', fabric: '' },
];
const parsedRows = () => [
  { plmId: 'P1', modelKod: 'M', colourCode: 'A', fabric: FABRIC },
  { plmId: 'P1', modelKod: 'M', colourCode: 'B', fabric: FABRIC },
];

test('PLM fabric reaches a model whose fabric was edited manually (shared value)', () => {
  const rows = groupedRows({ modelSharedValues: { fabric: '' } });
  plan(rows, parsedRows()).existing.forEach(item => apply(rows, item));
  assert.deepEqual(rows.map(row => Groups.effectiveValue(row, 'fabric', rows)), [FABRIC, FABRIC]);
  assert.equal(rows[0].modelSharedValues.fabric, FABRIC);
});

test('a workspace already stuck in the masked state is detected as a change', () => {
  // Önceki sürüm ham değeri yazmış, paylaşılan katman eski kalmıştı.
  const rows = groupedRows({ fabric: FABRIC, modelSharedValues: { fabric: '' } });
  rows[1].fabric = FABRIC;
  const result = plan(rows, parsedRows());
  assert.deepEqual(result.existing.map(item => item.changes.map(change => [change.from, change.to])), [[['', FABRIC]], [['', FABRIC]]]);
  result.existing.forEach(item => apply(rows, item));
  assert.deepEqual(rows.map(row => Groups.effectiveValue(row, 'fabric', rows)), [FABRIC, FABRIC]);
  assert.ok(plan(rows, parsedRows()).existing.every(item => !item.changes.length));
});

test('an approved PLM value replaces a colour-level override instead of being masked by it', () => {
  const rows = groupedRows({ modelSharedValues: {} });
  rows[1].variantOverrides = { fabric: '1111-Old' };
  rows[1].fabric = '1111-Old';
  plan(rows, parsedRows()).existing.forEach(item => apply(rows, item));
  assert.equal(Groups.effectiveValue(rows[1], 'fabric', rows), FABRIC);
});

test('ungrouped and colour-specific values keep plain row storage', () => {
  const rows = [{ id: 1, plmId: 'P1', modelKod: 'M', fabric: '' }];
  assert.equal(Groups.adoptImportedValue(rows, rows[0], 'fabric'), false);
  const grouped = groupedRows({ modelSharedValues: { colour: 'X' } });
  grouped[0].colour = 'NEW';
  Groups.adoptImportedValue(grouped, grouped[0], 'colour');
  assert.equal(grouped[0].modelSharedValues.colour, 'X');
});

test('app import writer and PLM sync use effective values and create cards for every synced row', () => {
  const APP = fs.readFileSync(path.join(__dirname, '../public/app-main.js'), 'utf8');
  const writer = APP.slice(APP.indexOf('function kolImportWriteField('), APP.indexOf('// Iceri alinan satirlari mevcut'));
  assert.match(writer, /adoptImportedValue(?:\?\.)?\(kolRows,row,key\)/);
  const modelLevel = APP.slice(APP.indexOf('function kolPlmSyncModelLevelItem('), APP.indexOf('function kolPlmSyncBuildSummary('));
  assert.match(modelLevel, /kolImportReadTargetField\(row,fieldKey\)/);
  const run = APP.slice(APP.indexOf('async function kolPlmSyncRun('), APP.indexOf('async function kolPlmSyncRefreshArtwork('));
  assert.equal((run.match(/kolFabricCardsAfterImport\(/g) || []).length, 2, 'up-to-date and applied paths both create missing cards');
  const create = APP.slice(APP.indexOf('async function kolFabricCardsCreateForRows('), APP.indexOf('let kolFabricAutoQueue'));
  assert.match(create, /kolEffectiveValue\(row,'fabric'\)/);
});

test('a variant that kept stale shared metadata after a merge does not overwrite its group', () => {
  // mergeGroups() leaves the old parent's modelSharedValues on the row that becomes a variant.
  const rows = [
    { id: 1, plmId: 'P1', modelKod: 'M', colourCode: 'A', modelGroupId: 'g', modelGroupRole: 'parent', fabric: '1111-A' },
    { id: 2, plmId: 'P1', modelKod: 'M', colourCode: 'B', modelGroupId: 'g', modelGroupRole: 'variant', fabric: '2222-B',
      modelSharedValues: { fabric: '2222-B' }, variantOverrides: { fabric: '2222-B' } },
  ];
  rows[1].fabric = '3333-C';
  Groups.adoptImportedValue(rows, rows[1], 'fabric');
  assert.equal(Groups.effectiveValue(rows[1], 'fabric', rows), '3333-C');
  assert.equal(rows[0].fabric, '1111-A');
  assert.equal(Groups.effectiveValue(rows[0], 'fabric', rows), '1111-A');
});
