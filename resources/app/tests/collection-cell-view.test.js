'use strict';

// Artwork / Kumaş hücre görünümü: kart ya da düz metin (hücre bazında, paylaşılan).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');
const APP = read('public/app-main.js');
const COLUMN = read('public/collection-artwork-detail.js');
const SHEET = read('public/collection-spreadsheet.js');

function loadArtwork() {
  const window = { appLang: 'tr', addEventListener() {}, BLCollectionSpreadsheetBridge: { rows: () => [] } };
  window.document = { readyState: 'complete', documentElement: { lang: 'tr' }, addEventListener() {}, getElementById() { return null; }, head: { appendChild() {} } };
  vm.runInContext(COLUMN, vm.createContext({ window, document: window.document, setTimeout, clearTimeout, Date, Map, Set, Promise, Object, String, Number, Math, Array, JSON, WeakMap }));
  return window.BLCollectionArtworkDetail;
}

test('text view flag keeps an Artwork cell as plain text (render and single-cell refresh)', () => {
  const api = loadArtwork();
  const text = 'Ön: 1 | Pigment | Toplam: 1';
  assert.ok(api.cellCards({ id: 1 }, text));
  assert.equal(api.cellCards({ id: 1, artworkDetailView: 'text' }, text), null);
  assert.equal(api.viewKey, 'artworkDetailView');
});

test('view flags are plain row fields shared through the normal save/undo path', () => {
  assert.match(APP, /const KOL_CELL_VIEW_KEYS=\{artworkDetail:'artworkDetailView',fabric:'fabricView'\};/);
  const setView = APP.slice(APP.indexOf('function kolSetCellView('), APP.indexOf('function kolCellViewActions('));
  assert.match(setView, /kolPushUndo\(\);/);
  assert.match(setView, /saveKolRows\(\);renderKol\(\);/);
  assert.match(setView, /if\(mode==='text'\)row\[flag\]='text';else delete row\[flag\];/);
});

test('Fabric text view skips the card cell; double-click keeps text editing in text view', () => {
  assert.match(APP, /else if\(c\.k==='fabric'&&!kolCellViewIsText\(r,'fabric'\)&&kolFabricParts\(val\)\.length\)\{/);
  const fabricDbl = APP.slice(APP.indexOf(`tbody.querySelectorAll('textarea.editCell[data-k="fabric"]')`), APP.indexOf(`tbody.querySelectorAll('textarea.editCell[data-k="artworkDetail"]')`));
  assert.match(fabricDbl, /kolCellViewIsText\(kolRows\.find\(item=>String\(item\.id\)===String\(el\.dataset\.id\)\),'fabric'\)\)return;/);
  const artDbl = APP.slice(APP.indexOf(`tbody.querySelectorAll('textarea.editCell[data-k="artworkDetail"]')`));
  assert.match(artDbl.slice(0, 600), /if\(kolCellViewIsText\(row,'artworkDetail'\)\)return;/);
});

test('right-click offers Convert to plain text / Convert to cards for Artwork and Fabric selections', () => {
  assert.match(SHEET, /bridge\(\)\?\.cellViewActions\?\.\(contextRow,contextCoord\.key,viewRowIds\)/);
  assert.match(APP, /cellViewActions:kolCellViewActions/);
  const actions = APP.slice(APP.indexOf('function kolCellViewActions('), APP.indexOf('function kolConvertCellsToCards('));
  assert.match(actions, /'Convert to plain text':'Düz metne çevir'/);
  assert.match(actions, /'Convert to cards':'Karta çevir'/);
  const convert = APP.slice(APP.indexOf('function kolConvertCellsToCards('), APP.indexOf('function kolConvertCellsToCards(') + 900);
  assert.match(convert, /openEditor\?\.\(live/, 'unparseable Artwork opens the card editor');
  assert.match(convert, /openKolFabricTextDialog\(live\.id/, 'free-text Fabric opens the fabric card dialog');
});
