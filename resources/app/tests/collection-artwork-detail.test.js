'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');
const INDEX = read('public/index.html');
const PERF = read('public/perf-runtime.js');
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
  return { api: window.BLCollectionArtworkDetail, requests, window };
}

test('explicit BOM apply replaces a manual note through the existing save/undo bridge and resumes PLM ownership', () => {
  const row = { id: 1, plmId: '2112292', artworkDetail: 'Manual note', artworkDetailPlm: 'Old BOM' };
  const { api, window, requests } = loadModule({ rows: [row] });
  const entry = { plmId: '2112292', hasPrint: true, placements: [{ placementTr: 'Ön', placementEn: 'Front', count: 1, printType: 'Pigment' }] };
  const edits = [];
  Object.assign(window.BLCollectionSpreadsheetBridge, {
    canEdit: () => true,
    validateValue: () => ({ ok: true }),
    batchEdit(ops, summary) {
      edits.push({ before: { ...row }, ops, summary });
      row.artworkDetail = ops[0].value;
      api.project(); // the actual batch edit renders through the artwork projection
      return { ok: true, changed: 1 };
    },
  });
  assert.equal(api.applyBom(row, entry).ok, true);
  assert.equal(edits.length, 1);
  assert.equal(edits[0].before.artworkDetail, 'Manual note', 'undo snapshot must retain the original note');
  assert.equal(edits[0].ops[0].key, 'artworkDetail');
  assert.equal(row.artworkDetail, 'Ön: 1 | Pigment | Toplam: 1');
  assert.equal(row.artworkDetailPlm, row.artworkDetail);
  api.applyToRow(row, 'Arka: 2 | Toplam: 2');
  assert.equal(row.artworkDetail, 'Arka: 2 | Toplam: 2');
  assert.equal(requests.length, 0, 'apply uses the already displayed local BOM; no extra PLM/AI traffic');
});

test('BOM apply rejects absent/mismatched BOM, read-only/linked cells and stale rows without writing', () => {
  const row = { id: 1, plmId: '2112292', artworkDetail: 'Manual', artworkDetailPlm: 'Old' };
  const { api, window } = loadModule({ rows: [row] });
  let writes = 0;
  const b = window.BLCollectionSpreadsheetBridge;
  Object.assign(b, { canEdit: () => true, validateValue: () => ({ ok: true }), batchEdit: () => { writes++; return { ok: false }; } });
  assert.equal(api.applyBom(row, null).ok, false);
  assert.equal(api.applyBom(row, { plmId: '99', hasPrint: false }).ok, false);
  assert.equal(api.applyBom({ ...row }, { plmId: row.plmId, hasPrint: false }).ok, false);
  b.canEdit = () => false;
  assert.equal(api.applyBom(row, { plmId: row.plmId, hasPrint: false }).ok, false);
  b.canEdit = () => true;
  b.validateValue = () => ({ ok: false, reason: 'linked' });
  assert.equal(api.applyBom(row, { plmId: row.plmId, hasPrint: false }).ok, false);
  assert.equal(writes, 0);
  b.validateValue = () => ({ ok: true });
  assert.equal(api.applyBom(row, { plmId: row.plmId, hasPrint: false }).ok, false);
  assert.equal(row.artworkDetail, 'Manual', 'failed save leaves note intact');
  assert.equal(row.artworkDetailPlm, 'Old');
});

test('BOM apply uses localized no-print and intact Set Style summaries', () => {
  for (const lang of ['tr', 'en']) {
    const row = { id: 1, plmId: '2112292', artworkDetail: 'Manual', artworkDetailPlm: 'Old' };
    const { api, window } = loadModule({ rows: [row], lang });
    Object.assign(window.BLCollectionSpreadsheetBridge, {
      canEdit: () => true, validateValue: () => ({ ok: true }),
      batchEdit(ops) { row.artworkDetail = ops[0].value; api.project(); return { ok: true }; },
    });
    api.applyBom(row, { plmId: row.plmId, hasPrint: false });
    assert.equal(row.artworkDetail, lang === 'en' ? 'No print' : 'Baskı yok');
    api.applyBom(row, { plmId: row.plmId, isSetStyle: true, hasPrint: true, artworkSummary: 'A - Front: 1\nB - Back: 1' });
    assert.equal(row.artworkDetail, 'A - Front: 1\nB - Back: 1');
  }
});

test('the shared bulk editor preserves Set Style line breaks before committing Artwork', () => {
  const start = APP.indexOf('function kolSpreadsheetMakeEditor(');
  const end = APP.indexOf('\n/*', start);
  const context = vm.createContext({
    kolSpreadsheetColumnMeta: () => ({ col: {} }),
    document: { createElement(tag) {
      // HTML text inputs strip CR/LF on assignment; textarea values retain LF.
      let value = '';
      return { dataset: {}, set value(next) { value = tag === 'input' ? next.replace(/[\r\n]/g, '') : next; }, get value() { return value; } };
    } },
  });
  vm.runInContext(APP.slice(start, end), context);
  const summary = 'A - Front: 1 | Total: 1\nB - Back: 2 | Total: 2';
  const editor = context.kolSpreadsheetMakeEditor(1, 'artworkDetail', summary);
  assert.equal(editor.value, summary, 'BOM A/B lines must reach commitKolEditor unchanged');
  assert.equal(editor.dataset.k, 'artworkDetail');
});

test('Collection loads Artwork Detail projection after app-main and before spreadsheet wiring', () => {
  const app = INDEX.indexOf('app-main.js');
  const artwork = INDEX.indexOf('collection-artwork-detail.js');
  const spreadsheet = PERF.indexOf('collection-spreadsheet.js');
  assert.ok(app >= 0 && artwork > app, 'Artwork projection must load after Collection core');
  assert.match(APP, /window\.addEventListener\('DOMContentLoaded', async/);
  assert.ok(spreadsheet > PERF.indexOf('collection-spreadsheet-engine.js'), 'Spreadsheet engine loads before its UI');
  assert.doesNotMatch(INDEX, /<script src="collection-spreadsheet\.js/);
  assert.match(PERF, /collectionTools:\[[^\]]*collection-spreadsheet\.js/);
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

test('refresh() during an in-flight read re-reads the BOM store instead of returning the stale request', async () => {
  const rows = [{ id: 1, plmId: '2112292' }];
  const entries = { 2112292: { hasPrint: false } };
  const { api, requests } = loadModule({ rows, entries });
  const first = api.ensureFresh();
  entries[2112292] = { hasPrint: true, totalPrintCount: 1, placements: [{ placementTr: 'Ön', placementEn: 'Front', count: 1, printType: 'Pigment' }] };
  await api.refresh();
  await first;
  assert.equal(requests.length, 2, 'forced refresh must issue its own read after PLM SYNC wrote the store');
  assert.equal(rows[0].artworkDetail, 'Ön: 1 | Pigment | Toplam: 1');
});

test('Collection PLM SYNC (Model Details) force-refreshes Artwork Detail even when no PLM field changed', () => {
  const start = APP.indexOf('async function kolPlmSyncRun(');
  const body = APP.slice(start, APP.indexOf('async function kolPlmSyncButtonRun(', start));
  const refresh = body.indexOf('kolPlmSyncRefreshArtwork()');
  assert.ok(refresh > body.indexOf('kolPlmSyncFetchRecords('), 'artwork refresh runs after the fetch wrote plm-bom.json');
  assert.ok(refresh < body.indexOf('if(!summary.changed.length&&!(summary.newColours||[]).length){'), 'refresh must not depend on Model Details field changes');
  assert.match(APP, /function kolPlmSyncRefreshArtwork\(\)\{[^]*?BLCollectionArtworkDetail[^]*?\.refresh\(\)/);
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
  assert.match(ROUTE, /entries\[plmId\] = plmBomStore\.summaryEntry\(entry\)/, 'batch carries only the summary projection');
  assert.match(ROUTE, /notModified: true/, 'unchanged store revision is not re-sent');
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
