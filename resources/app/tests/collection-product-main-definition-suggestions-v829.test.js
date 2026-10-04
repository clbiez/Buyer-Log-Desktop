'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const APP = fs.readFileSync(path.join(ROOT, 'public', 'app-main.js'), 'utf8');
const SERVER = fs.readFileSync(path.join(ROOT, 'server', 'server.js'), 'utf8');
const canonicalFields = require('../server/lib/canonical-fields');
const parse = require('../server/lib/parse');

function extractBetween(source, startText, endText) {
  const start = source.indexOf(startText);
  const end = source.indexOf(endText, start + startText.length);
  assert.ok(start >= 0, `${startText} bulunamadı`);
  assert.ok(end > start, `${endText} sınırı bulunamadı`);
  return source.slice(start, end);
}

test('Collection Product Main Definition önerileri gerçek ASAS canonical kaynağından distinct üretilir', () => {
  const block = extractBetween(SERVER, 'const COLLECTION_CATALOG_FIELDS', 'async function buildResponse');
  const factory = new Function('canonicalFields', `${block}\nreturn {COLLECTION_CATALOG_FIELDS,buildCollectionCatalogs};`);
  const { COLLECTION_CATALOG_FIELDS, buildCollectionCatalogs } = factory(canonicalFields);

  assert.equal(COLLECTION_CATALOG_FIELDS.productMainDefinition, 'Ürün Ana Tanım');
  assert.equal(canonicalFields.canonicalId('overview', 'Ürün Ana Tanım'), 'productDescription');
  assert.equal(canonicalFields.canonicalId('collection', 'Product Main Definition'), 'productMainDefinition');

  const catalogs = buildCollectionCatalogs([
    { productDescription: '  T-SHIRT  ', Category: 'Tişört' },
    { 'Ürün Ana Tanım': 't-shirt', Category: 'tişört' },
    { productDescription: null, Category: '' },
  ]);

  assert.deepEqual(catalogs.productMainDefinition, ['T-SHIRT']);
  assert.deepEqual(catalogs.category, ['Tişört']);
});

test('Collection Product Main Definition Category ile aynı suggestion editor ve serbest kayıt yolunu kullanır', () => {
  assert.match(APP, /\{k:'productMainDefinition', label:'Product Main Definition', w:170, suggest:'productMainDefinition', group:'[^']+'\}/);
  assert.match(APP, /const KOL_ASAS_CATALOG_KINDS = new Set\(\[[^\]]*'productMainDefinition'/);

  const renderBlock = extractBetween(APP, 'const KOL_COLS = [', 'function kolColDefs');
  assert.match(renderBlock, /productMainDefinition[\s\S]*suggest:'productMainDefinition'/);

  const editorBlock = extractBetween(APP, 'function commitKolEditor', 'function commitKolPriceEditor');
  assert.match(editorBlock, /if\(el\.dataset\.kind&&norm\(val\)\)/);
  assert.match(editorBlock, /const matched=kolCatalogMatch\(el\.dataset\.kind,val\)/);
  assert.match(editorBlock, /row=kolWriteGroupedStorageValue\(row,k,val\)/);
  assert.doesNotMatch(editorBlock, /strict-catalog|must be selected from the ASAS/i);
});

test('Collection suggestion dropdown keyboard navigation selects exact ASAS value while custom Enter remains allowed', () => {
  const dropBlock = extractBetween(APP, 'function closeKolCatalogDrop', "tbody.querySelectorAll('.kolSuggestCell[data-kind]')");
  assert.match(dropBlock, /ArrowDown/);
  assert.match(dropBlock, /ArrowUp/);
  assert.match(dropBlock, /Enter/);
  assert.match(dropBlock, /input\.value=item\.dataset\.value/);
  assert.match(dropBlock, /dispatchEvent\(new Event\('change'/);

  const bindingBlock = extractBetween(APP, "tbody.querySelectorAll('.kolSuggestCell[data-kind]')", "tbody.querySelectorAll('.kolPriceApprove')");
  assert.match(bindingBlock, /showKolCatalogDrop\(input\)/);
  assert.match(bindingBlock, /event\.key==='Escape'/);
  assert.match(bindingBlock, /event\.key==='ArrowDown'|event\.key==='ArrowUp'/);
});

test('Collection Product Main Definition suggestion cache is not fetched per cell edit', () => {
  const block = extractBetween(APP, 'function kolCatalogValues', 'function kolCatalogMatch');
  assert.match(block, /state\.collectionCatalogs/);
  assert.doesNotMatch(block, /fetch\(/);
  assert.doesNotMatch(block, /BLLFLCatalog/);
});


test('raw ASAS normalized row -> lightweight Overview -> Collection catalog zinciri Product Main Definition değerini düşürmez', () => {
  const block = extractBetween(SERVER, 'const COLLECTION_CATALOG_FIELDS', 'async function buildResponse');
  const factory = new Function('canonicalFields', `${block}\nreturn {buildCollectionCatalogs};`);
  const { buildCollectionCatalogs } = factory(canonicalFields);

  const overviewRows = parse.buildOverviewSummaryRowsFromASAS([{
    kalan: 8,
    merch: 'MAG-1', ageGroup: 'MMYG-1', buyerGrup: 'ÖRME', buyer: 'Buyer A',
    season: 'S7', countryRaw: 'Bangladesh', manufacturer: 'Factory A',
    license: '', category: 'Tişört', line: 'Basic', fob: 3.25, qty: 100,
    productDescription: 'T-SHIRT',
  }], { licensormap: {}, submap: {}, pricingRules: [] });

  assert.equal(overviewRows.length, 1);
  assert.equal(overviewRows[0].productDescription, 'T-SHIRT');
  assert.equal(canonicalFields.value(overviewRows[0], 'overview', 'productDescription'), 'T-SHIRT');

  const catalogs = buildCollectionCatalogs(overviewRows);
  assert.deepEqual(catalogs.productMainDefinition, ['T-SHIRT']);
  assert.deepEqual(catalogs.category, ['Tişört']);
});

test('client partial Collection catalog cache hazır sayılmaz, tam catalog tekrar fetch gerektirmez', () => {
  const helperBlock = extractBetween(APP, 'function collectionCatalogsReady', 'function kolCatalogIdentity');
  const kinds = new Set(['category','mag','mmyg','buyingGroup','buyer','manufacturer','season','license','licensor','country','line','productMainDefinition']);
  const ready = new Function('KOL_ASAS_CATALOG_KINDS', `${helperBlock}\nreturn collectionCatalogsReady;`)(kinds);

  assert.equal(ready({ category:['Tişört'], season:['S7'] }), false);
  const full = Object.fromEntries([...kinds].map(key => [key, []]));
  full.productMainDefinition = ['T-SHIRT'];
  assert.equal(ready(full), true);

  const loaderBlock = extractBetween(APP, 'async function ensureCollectionCatalogLoaded', 'function setOrdersLoadingState');
  assert.match(loaderBlock, /collectionCatalogsReady\(state\.collectionCatalogs\)/);
  assert.doesNotMatch(loaderBlock, /Object\.keys\(state\.collectionCatalogs\)\.length/);
});

test('server eski/partial collection-catalog projection cache şemasını reddeder', () => {
  const block = extractBetween(SERVER, 'const COLLECTION_CATALOG_FIELDS', 'async function buildResponse');
  const factory = new Function('canonicalFields', `${block}\nreturn {COLLECTION_CATALOG_FIELDS,COLLECTION_CATALOG_SCHEMA_VERSION,collectionCatalogsComplete,collectionCatalogProjectionComplete};`);
  const api = factory(canonicalFields);
  const full = Object.fromEntries(Object.keys(api.COLLECTION_CATALOG_FIELDS).map(key => [key, []]));

  assert.equal(api.COLLECTION_CATALOG_SCHEMA_VERSION, 3);
  assert.equal(api.collectionCatalogsComplete({ category:[] }), false);
  assert.equal(api.collectionCatalogsComplete(full), true);
  assert.equal(api.collectionCatalogProjectionComplete({ catalogs:full }), false, 'old cache without schema version must rebuild');
  assert.equal(api.collectionCatalogProjectionComplete({ catalogSchemaVersion:1, catalogs:full }), false);
  assert.equal(api.collectionCatalogProjectionComplete({ catalogSchemaVersion:2, catalogs:full }), false, 'pre-manufacturer v2 cache must rebuild');
  assert.equal(api.collectionCatalogProjectionComplete({ catalogSchemaVersion:3, catalogs:full }), true);

  assert.match(SERVER, /collectionCatalogProjectionComplete\(cached\.data\)/);
  assert.match(SERVER, /catalogSchemaVersion:\s*COLLECTION_CATALOG_SCHEMA_VERSION/);
});

test('projection worker da Product Main Definition catalogunu canonical productDescription üzerinden üretir', () => {
  const worker = fs.readFileSync(path.join(ROOT, 'server', 'projection-worker.js'), 'utf8');
  assert.match(worker, /canonicalFields=require\('\.\/lib\/canonical-fields'\)/);
  assert.match(worker, /productMainDefinition:'productDescription'/);
  assert.match(worker, /canonicalFields\.value\(row,'overview',canonicalId\)/);
  assert.match(worker, /catalogSchemaVersion:COLLECTION_CATALOG_SCHEMA_VERSION/);
});
