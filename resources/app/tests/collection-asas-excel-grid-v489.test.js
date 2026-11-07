'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const INDEX = (fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8') + '\n' + fs.readFileSync(path.join(ROOT, 'public', 'app-main.js'), 'utf8'));
const CSS = require('./helpers/manifest-css')(['ui-tokens.css','app.css','design.css','experience.css','ui-components.css'] );
const SERVER = fs.readFileSync(path.join(ROOT, 'server', 'server.js'), 'utf8');
const serverCatalog = require('./helpers/server-collection-catalog');

function extractBetween(source, startText, endText) {
  const start = source.indexOf(startText);
  const end = source.indexOf(endText, start + startText.length);
  assert.ok(start >= 0, `${startText} bulunamadı`);
  assert.ok(end > start, `${endText} sınırı bulunamadı`);
  return source.slice(start, end);
}

test('v4.89 Collection option catalogs are produced once from ASAS-backed Orders rows', () => {
  const { COLLECTION_CATALOG_FIELDS, COLLECTION_CATALOG_SCHEMA_VERSION, collectionCatalogsComplete, buildCollectionCatalogs } = serverCatalog();

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
  // The same cache/build contract now runs in the common worker. Keep the
  // dispatch, verified Orders reuse, permission gate and v3 publication checks.
  // collection-catalog-compute-contract also exercises these paths natively.
  const worker = fs.readFileSync(path.join(ROOT, 'server/workers/compute-worker.js'), 'utf8');
  const tasks = fs.readFileSync(path.join(ROOT, 'server/lib/compute-tasks.js'), 'utf8');
  assert.match(SERVER, /catalogOrdersBuffer:wanted\.has\('collection-catalog'\)\?reused\.projections\.orders\?\.buffer:null/);
  assert.match(worker, /if\(params\.catalogOrdersBuffer\)\{const raw=await promisify\(zlib\.gunzip\)\(Buffer\.from\(params\.catalogOrdersBuffer\)\);params\.catalogRows=JSON\.parse\(raw\.toString\('utf8'\)\)\.rows\|\|\[\];\}/);
  assert.match(tasks, /out\['collection-catalog'\]=\{catalogs:allowed\?buildCollectionCatalogs\(rows\.length\?rows:overview\):\{\},catalogSchemaVersion:COLLECTION_CATALOG_SCHEMA_VERSION\}/);
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
