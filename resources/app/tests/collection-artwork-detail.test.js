'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');
const INDEX = read('public/index.html');
const APP = read('public/app-main.js');
const COLUMN = read('public/collection-artwork-detail.js');
const SPREADSHEET = read('public/collection-spreadsheet.js');
const CHAT = read('public/lcwai-chat.js');
const LABELS = read('public/canonical-column-labels.js');
const ROUTE = read('server/routes/plm-sync-routes.js');

function loadModule({ rows = [], entries = {}, lang = 'tr' } = {}) {
  const requests = [];
  const window = {
    appLang: lang,
    addEventListener() {},
    BLCollectionSpreadsheetBridge: { rows: () => rows },
    fetch: async (url, options) => {
      const body = JSON.parse(options.body);
      requests.push(body.plmIds);
      const found = {};
      for (const id of body.plmIds) if (entries[id]) found[id] = entries[id];
      return { ok: true, json: async () => ({ ok: true, entries: found }) };
    },
  };
  window.document = {
    readyState: 'complete',
    documentElement: { lang },
    addEventListener() {},
    getElementById() { return null; },
    head: { appendChild() {} },
  };
  const context = vm.createContext({ window, document: window.document, fetch: window.fetch, setTimeout, clearTimeout, Date, Map, Set, Promise, Object, String, Number, Math, Array, JSON });
  vm.runInContext(COLUMN, context);
  return { api: window.BLCollectionArtworkDetail, requests };
}

test('Collection loads Artwork Detail projection after app-main and before spreadsheet wiring', () => {
  const app = INDEX.indexOf('app-main.js');
  const artwork = INDEX.indexOf('collection-artwork-detail.js');
  const spreadsheet = INDEX.indexOf('collection-spreadsheet.js');
  assert.ok(app >= 0 && artwork > app, 'Artwork projection must load after Collection core');
  assert.ok(spreadsheet > artwork, 'Artwork projection must exist before spreadsheet initializes');
});

test('Artwork Detail is a real KOL_COLS column immediately before Fabric (filter, move, edit, AI share one path)', () => {
  const art = APP.indexOf("{k:'artworkDetail', label:'Artwork Detail', w:240, group:'Model Detayları'}");
  const fabric = APP.indexOf("{k:'fabric', label:'Fabric', w:150, group:'Model Detayları'}");
  assert.ok(art > 0 && fabric > art, 'artworkDetail must be declared in KOL_COLS right before fabric');
  const def = APP.slice(art, APP.indexOf('}', art) + 1);
  assert.doesNotMatch(def, /noFilter|readonly|ruleReadonly|formulaReadonly/, 'column must stay filterable and editable');
  assert.match(APP, /'specialCode','line','artworkDetail','fabric'/, 'default display order keeps Artwork before Fabric');
  assert.match(LABELS, /artworkDetail:Object\.freeze\(\{en:'Artwork Detail',tr:'Artwork Detayı'\}\)/);
});

test('Artwork projection no longer injects its own DOM header/cells or read-only meta', () => {
  assert.doesNotMatch(COLUMN, /insertBefore|createElement\('th'\)|createElement\('td'\)|patchGroupRow|columnMeta/);
  assert.doesNotMatch(COLUMN, /noFilter|readonly: true|editable: false/);
});

test('Artwork Detail remains PLM-sourced: reads BOM sidecar, never saves Collection rows itself', () => {
  assert.match(COLUMN, /plm-bom\.json/);
  assert.match(COLUMN, /\/api\/plm-sync\/bom\/batch/);
  assert.doesNotMatch(COLUMN, /saveKolRows\s*\(/, 'PLM-owned artwork data must not create a second Collection source of truth');
});

test('PLM value fills empty/PLM-owned cells, keeps manual edits and returns to PLM when cleared', () => {
  const { api } = loadModule();
  const row = {};
  assert.equal(api.applyToRow(row, 'Front: 1 | Pigment | Toplam: 1'), true);
  assert.equal(row.artworkDetail, 'Front: 1 | Pigment | Toplam: 1');
  assert.equal(row.artworkDetailPlm, 'Front: 1 | Pigment | Toplam: 1');
  // PLM SYNC güncellerse PLM'e ait değer yenilenir.
  api.applyToRow(row, 'Back: 1 | Pigment | Toplam: 1');
  assert.equal(row.artworkDetail, 'Back: 1 | Pigment | Toplam: 1');
  // Kullanıcı düzenlemesi PLM güncellemesinde korunur.
  row.artworkDetail = 'Manuel not';
  assert.equal(api.applyToRow(row, 'Sleeve: 2 | Toplam: 2'), false);
  assert.equal(row.artworkDetail, 'Manuel not');
  assert.equal(row.artworkDetailPlm, 'Sleeve: 2 | Toplam: 2');
  // Temizlenen hücre PLM değerine döner.
  row.artworkDetail = '';
  api.applyToRow(row, 'Sleeve: 2 | Toplam: 2');
  assert.equal(row.artworkDetail, 'Sleeve: 2 | Toplam: 2');
  // Önceki salt-okunur sürümün izlenmeyen projeksiyonu PLM'e ait sayılır.
  const legacy = { artworkDetail: 'Front: 1 | Total: 1' };
  api.applyToRow(legacy, 'Front: 1 | Toplam: 1');
  assert.equal(legacy.artworkDetail, 'Front: 1 | Toplam: 1');
});

test('ensureFresh projects BOM summaries into ALL Collection rows (not only visible ones) for filter and LCW AI', async () => {
  const rows = [
    { id: 1, plmId: '2112292' },
    { id: 2, plmId: '2112292' },
    { id: 3, plmId: '777' },
    { id: 4, plmId: '' },
  ];
  const entries = {
    2112292: { hasPrint: true, totalPrintCount: 1, placements: [{ placementTr: 'Ön', placementEn: 'Front', count: 1, printType: 'Pigment' }] },
  };
  const { api, requests } = loadModule({ rows, entries });
  await api.ensureFresh();
  assert.equal(requests.length, 1);
  assert.deepEqual([...requests[0]].sort(), ['2112292', '777']);
  assert.equal(rows[0].artworkDetail, 'Ön: 1 | Pigment | Toplam: 1');
  assert.equal(rows[1].artworkDetail, 'Ön: 1 | Pigment | Toplam: 1');
  assert.equal(rows[2].artworkDetail ?? '', '', 'no BOM record → empty, not a stale value');
  assert.equal(rows[2].artworkDetailPlm, '', 'row is now tracked so a later manual edit is recognised');
  assert.equal(rows[3].artworkDetail ?? '', '');
});

test('LCW AI Collection context refreshes artwork projection before reading rows', () => {
  assert.match(CHAT, /tab === 'koleksiyon' && window\.BLCollectionArtworkDetail && window\.BLCollectionArtworkDetail\.ensureFresh/);
  assert.match(APP, /koleksiyon: \(\) => kolRows/);
});

test('BOM detail stays reachable from the cell context menu (double click is the editor now)', () => {
  assert.doesNotMatch(COLUMN, /addEventListener\('dblclick'/);
  assert.match(COLUMN, /_loadScript\('plm-bom\.js'\)/);
  assert.match(COLUMN, /BLPlmBom\.openForRow/);
  assert.match(COLUMN, /b\.openArtworkBom = openBom/);
  assert.match(SPREADSHEET, /contextCoord\.key==='artworkDetail'&&bridge\(\)\?\.openArtworkBom/);
  assert.match(SPREADSHEET, /'Open BOM Detail':'BOM Detayını Aç'/);
});

test('visible Collection models read BOM summaries with local batch requests', () => {
  assert.match(ROUTE, /app\.post\('\/api\/plm-sync\/bom\/batch'/);
  assert.match(ROUTE, /plmBomStore\.load\(\)/);
  assert.match(ROUTE, /entries\[plmId\] = entry/);
  const start = ROUTE.indexOf("app.post('/api/plm-sync/bom/batch'");
  const end = ROUTE.indexOf('\n});', start);
  assert.ok(start >= 0 && end > start, 'batch route block must be found');
  const batch = ROUTE.slice(start, end + 4);
  assert.doesNotMatch(batch, /syncPlmBoms\s*\(|coreNectumApiClient\.|getDefaultEngine\s*\(|\.ask\s*\(/,
    'batch projection must not trigger remote PLM/AI work');
  assert.match(COLUMN, /const BATCH = 500/, 'client chunks below the route 1000-id cap');
});

test('Set Style Artwork keeps child A/B summary instead of merging placements', () => {
  assert.match(COLUMN, /entry\.isSetStyle && String\(entry\.artworkSummary/);
  assert.match(COLUMN, /white-space:pre-line/);
});

test('Artwork Detail drops All Over (fabric carries it) and writes per-placement technique when front/back differ', () => {
  const { api } = loadModule({ lang: 'en' });
  const place = (placement, en, printType) => ({ placement, placementTr: en, placementEn: en, count: 1, printType });
  assert.equal(api.summaryFor({ hasPrint: true, totalPrintCount: 2, placements: [
    place('all_over', 'All Over', 'Allover'), place('front_body', 'Front', 'Pigment'),
  ] }), 'Front: 1 | Pigment | Total: 1');
  assert.equal(api.summaryFor({ hasPrint: true, totalPrintCount: 2, placements: [
    place('front_body', 'Front', 'Pigment'), place('back_body', 'Back', 'Transfer'),
  ] }), 'Front: 1 | Pigment • Back: 1 | Transfer | Total: 2');
  assert.equal(api.summaryFor({ hasPrint: true, totalPrintCount: 2, placements: [
    place('front_body', 'Front', 'Pigment'), place('back_body', 'Back', 'Pigment'),
  ] }), 'Front: 1 • Back: 1 | Pigment | Total: 2');
  assert.equal(api.summaryFor({ hasPrint: true, totalPrintCount: 1, placements: [place('all_over', 'All Over', 'Allover')] }), 'No print');
});
