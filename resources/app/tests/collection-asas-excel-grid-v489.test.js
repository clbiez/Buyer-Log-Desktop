'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const INDEX = (fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8') + '\n' + fs.readFileSync(path.join(ROOT, 'public', 'app-main.js'), 'utf8'));
const CSS = fs.readFileSync(path.join(ROOT, 'public', 'app.css'), 'utf8');
const SERVER = fs.readFileSync(path.join(ROOT, 'server', 'server.js'), 'utf8');
const canonicalFields = require('../server/lib/canonical-fields');

function extractBetween(source, startText, endText) {
  const start = source.indexOf(startText);
  const end = source.indexOf(endText, start + startText.length);
  assert.ok(start >= 0, `${startText} bulunamadı`);
  assert.ok(end > start, `${endText} sınırı bulunamadı`);
  return source.slice(start, end);
}

test('v4.89 Collection option catalogs are produced once from ASAS-backed Orders rows', () => {
  const block = extractBetween(SERVER, 'const COLLECTION_CATALOG_FIELDS', 'async function buildResponse');
  const factory = new Function('canonicalFields', `${block}\nreturn {COLLECTION_CATALOG_FIELDS,COLLECTION_CATALOG_SCHEMA_VERSION,collectionCatalogsComplete,buildCollectionCatalogs};`);
  const { COLLECTION_CATALOG_FIELDS, COLLECTION_CATALOG_SCHEMA_VERSION, collectionCatalogsComplete, buildCollectionCatalogs } = factory(canonicalFields);

  assert.equal(COLLECTION_CATALOG_FIELDS.category, 'Category');
  assert.equal(COLLECTION_CATALOG_FIELDS.mag, 'Merch Alt Grup Kod');
  assert.equal(COLLECTION_CATALOG_FIELDS.mmyg, 'Merch Marka Yaş Grup Kod');
  assert.equal(COLLECTION_CATALOG_FIELDS.buyingGroup, 'Buyer Grup (TR)');
  assert.equal(COLLECTION_CATALOG_FIELDS.buyer, 'Buyer');
  assert.equal(COLLECTION_CATALOG_FIELDS.manufacturer, 'Manufacturer');
  assert.equal(COLLECTION_CATALOG_FIELDS.season, 'Season');
  assert.equal(COLLECTION_CATALOG_SCHEMA_VERSION, 3);
  const completeShape = Object.fromEntries(Object.keys(COLLECTION_CATALOG_FIELDS).map(key => [key, []]));
  assert.equal(collectionCatalogsComplete(completeShape), true, 'current schema catalog must be complete');
  const staleShape = { ...completeShape }; delete staleShape.manufacturer;
  assert.equal(collectionCatalogsComplete(staleShape), false, 'pre-v3 catalog without manufacturer must be rebuilt');

  const catalogs = buildCollectionCatalogs([
    {Category:'Tişört','Merch Alt Grup Kod':'MAG 2','Merch Marka Yaş Grup Kod':'MMYG 4','Buyer Grup (TR)':'BG A',Buyer:'AYŞE',Manufacturer:'SUPPLIER B',Season:'S7'},
    {Category:'tişört','Merch Alt Grup Kod':'MAG 1','Merch Marka Yaş Grup Kod':'MMYG 4','Buyer Grup (TR)':'BG A',Buyer:'AYŞE',Manufacturer:'supplier b',Season:'S7'},
  ]);
  assert.deepEqual(catalogs.category, ['Tişört']);
  assert.deepEqual(catalogs.mag, ['MAG 1','MAG 2']);
  assert.deepEqual(catalogs.manufacturer, ['SUPPLIER B']);
  assert.deepEqual(catalogs.season, ['S7']);
  // Katalog artık Refresh sonunda page projection cache'e bir kez yazılıyor.
  // Schema version eski/partial collection-catalog cache'lerinin güvenle
  // yalnız bu projection için rebuild edilmesini sağlar.
  assert.match(SERVER, /let catalogRows=ordersRows/);
  assert.match(SERVER, /catalogRows=\(await pageProjectionCache\.decodeProjection\(reused\.projections\.orders\.buffer\)\)\.rows\|\|\[\]/);
  assert.match(SERVER, /'collection-catalog': \{[\s\S]{0,240}?catalogs: cpDataAllowed \? buildCollectionCatalogs\(catalogRows\.length \? catalogRows : overviewRows\) : \{\},[\s\S]{0,120}?catalogSchemaVersion: COLLECTION_CATALOG_SCHEMA_VERSION/);
});

test('v4.89 Collection cells use ASAS suggestions without an LFL dependency or strict selection', () => {
  const block = extractBetween(INDEX, 'const KOL_ASAS_CATALOG_KINDS', 'function migrateKolRow');
  assert.match(block, /state\.collectionCatalogs/);
  assert.doesNotMatch(block, /BLLFLCatalog/);
  assert.match(INDEX, /\{k:'season', label:'Season', w:100, suggest:'season', group:'[^']+'\}/);
  assert.match(INDEX, /\{k:'country', label:'Country', w:120, suggest:'country', group:'[^']+'\}/);
  assert.match(INDEX, /\{k:'line', label:'Line', w:100, suggest:'line', group:'[^']+'\}/);
  assert.doesNotMatch(INDEX, /data-strict-catalog/);
  assert.doesNotMatch(INDEX, /Category must be selected from the LFL/);
});

test('v4.89 Collection grid supports Excel-style navigation, active-cell focus and matrix paste', () => {
  assert.match(INDEX, /function kolHandleSpreadsheetKey\(e,el,snap\)/);
  assert.match(INDEX, /e\.key==='Enter'[\s\S]*?kolCaptureRowEditorTarget/);
  assert.match(INDEX, /e\.key==='Tab'[\s\S]*?kolCaptureAdjacentEditorTarget/);
  assert.match(INDEX, /function kolPasteMatrix\(startEl,text\)/);
  assert.match(INDEX, /commitKolEditor\(editor,\{rerender:false,pushUndo:false,save:false\}\)/);
  assert.match(INDEX, /document\.addEventListener\('paste'[\s\S]*?#kolTable \.editCell\[data-k\]/);
  assert.match(CSS, /#kolTable tbody td\.kolActiveGridCell/);
  assert.match(CSS, /#kolTable thead th\.kolActiveGridHeader/);
  assert.match(CSS, /#kolTable tbody td\{border-right:/);
});
