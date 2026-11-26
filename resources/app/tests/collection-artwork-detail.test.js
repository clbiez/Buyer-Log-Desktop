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

test('untracked manual value is never wiped when there is no PLM summary to replace it', async () => {
  // Excel/kopya ile gelen ve artworkDetailPlm izi olmayan satırlar: PLM ID yok
  // veya BOM kaydı yok. Boş PLM özeti elle yazılmış değeri silmemeli.
  const rows = [
    { id: 1, artworkDetail: 'Front: 1 | Pigment | Total: 1' },
    { id: 2, plmId: '777', artworkDetail: 'Manual note' },
  ];
  const { api } = loadModule({ rows });
  await api.ensureFresh({ force: true, silent: true });
  api.project();
  assert.equal(rows[0].artworkDetail, 'Front: 1 | Pigment | Total: 1');
  assert.equal(rows[1].artworkDetail, 'Manual note');
  assert.equal(rows[0].artworkDetailPlm, '', 'row becomes tracked; value is now recognised as manual');
  api.project();
  assert.equal(rows[0].artworkDetail, 'Front: 1 | Pigment | Total: 1');
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

/* ---- Bölge kartları + dil/sıra tutarlılığı ---- */
const placeOf = (placement, tr, en, printType, count = 1) => ({ placement, placementTr: tr, placementEn: en, count, printType });

test('Artwork summary uses canonical region order regardless of PLM component order', () => {
  const { api } = loadModule({ lang: 'tr' });
  const entry = { hasPrint: true, placements: [placeOf('back_body', 'Arka', 'Back', 'Pigment'), placeOf('front_body', 'Ön', 'Front', 'Pigment')] };
  assert.equal(api.summaryFor(entry), 'Ön: 1 • Arka: 1 | Pigment | Toplam: 2');
  assert.equal(api.summaryFor(entry, 'en'), 'Front: 1 • Back: 1 | Pigment | Total: 2');
});

test('client region order mirrors the server PLACEMENTS order', () => {
  const { PLACEMENTS } = require('../server/lib/corenectum-bom-api');
  const match = COLUMN.match(/const PLACEMENT_ORDER = (\[[^\]]+\]);/);
  assert.ok(match, 'PLACEMENT_ORDER sabiti bulunmalı');
  assert.deepEqual(JSON.parse(match[1].replace(/'/g, '"')), Object.keys(PLACEMENTS));
});

test('Set Style summary is built from structured parts in the active language, A before B', () => {
  const entry = { isSetStyle: true, hasPrint: true, artworkSummary: 'B - Ön: 1 | Pigment | Toplam: 1\nA - Ön: 1 • Arka: 1 | Pigment | Toplam: 2', setParts: [
    { label: 'B', placements: [placeOf('front_body', 'Ön', 'Front', 'Pigment')] },
    { label: 'A', placements: [placeOf('back_body', 'Arka', 'Back', 'Pigment'), placeOf('front_body', 'Ön', 'Front', 'Pigment')] },
  ] };
  const { api } = loadModule({ lang: 'en' });
  assert.equal(api.summaryFor(entry), 'A - Front: 1 • Back: 1 | Pigment | Total: 2\nB - Front: 1 | Pigment | Total: 1');
  assert.equal(api.summaryFor(entry, 'tr'), 'A - Ön: 1 • Arka: 1 | Pigment | Toplam: 2\nB - Ön: 1 | Pigment | Toplam: 1');
  // BOM detay penceresinin tam kaydı setComponents taşır; aynı sonuç çıkmalı.
  const full = { ...entry, setParts: undefined, setComponents: entry.setParts };
  assert.equal(api.summaryFor(full), api.summaryFor(entry));
});

test('PLM text in the other language or legacy order stays PLM-owned; real manual text is kept', async () => {
  const entry = { plmId: '7', hasPrint: true, placements: [placeOf('back_body', 'Arka', 'Back', 'Pigment'), placeOf('front_body', 'Ön', 'Front', 'Pigment')] };
  const rows = [
    { id: 1, plmId: '7', artworkDetail: 'Front: 1 • Back: 1 | Pigment | Total: 2', artworkDetailPlm: 'something else' },
    { id: 2, plmId: '7', artworkDetail: 'Arka: 1 • Ön: 1 | Pigment | Toplam: 2', artworkDetailPlm: 'stale' },
    { id: 3, plmId: '7', artworkDetail: 'Pigment Print', artworkDetailPlm: 'stale' },
  ];
  const { api } = loadModule({ rows, entries: { 7: entry }, lang: 'tr' });
  await api.ensureFresh({ force: true, silent: true });
  assert.equal(rows[0].artworkDetail, 'Ön: 1 • Arka: 1 | Pigment | Toplam: 2');
  assert.equal(rows[1].artworkDetail, 'Ön: 1 • Arka: 1 | Pigment | Toplam: 2');
  assert.equal(rows[2].artworkDetail, 'Pigment Print', 'manual value must survive');
});

test('cellCards renders region chips, technique tag and total for PLM-owned values', async () => {
  const entry = { plmId: '7', hasPrint: true, placements: [placeOf('front_body', 'Ön', 'Front', 'Pigment'), placeOf('both_sleeves', 'Kollar', 'Sleeves', 'Transfer', 2)] };
  const setEntry = { plmId: '8', isSetStyle: true, hasPrint: true, setParts: [
    { label: 'A', placements: [placeOf('front_body', 'Ön', 'Front', '<b>Pigment</b>')] }, { label: 'B', placements: [] },
  ] };
  const rows = [{ id: 1, plmId: '7', artworkDetail: '' }, { id: 2, plmId: '8', artworkDetail: '' }, { id: 3, plmId: '7', artworkDetail: 'Pigment Print', artworkDetailPlm: 'x' }];
  const { api } = loadModule({ rows, entries: { 7: entry, 8: setEntry } });
  await api.ensureFresh({ force: true, silent: true });
  const single = api.cellCards(rows[0], rows[0].artworkDetail);
  assert.match(single.cls, /kolArtworkTd/);
  assert.match(single.inner, /aria-hidden="true"/);
  // Karışık teknik: bölgeler tekniğe göre gruplanır, her grubu kendi etiketi izler.
  assert.match(single.inner, /<b>Ön<\/b><i>1<\/i><\/span><span class="blCellTag" data-tone="\d">Pigment<\/span><span class="blCellChip"><b>Kollar<\/b><i>2<\/i><\/span><span class="blCellTag" data-tone="\d">Transfer</);
  assert.match(single.inner, /<\/span><\/span><span class="blCellTotal">/, 'total sits outside the clipped body');
  assert.match(single.inner, /blCellTotal">3</);
  const set = api.cellCards(rows[1], rows[1].artworkDetail);
  assert.match(set.cls, /isMulti/);
  assert.match(set.inner, /blCellPart">A[\s\S]*blCellPart">B[\s\S]*Baskı yok/);
  assert.match(set.inner, /&lt;b&gt;Pigment&lt;\/b&gt;/, 'PLM text is escaped');
  assert.equal(api.cellCards(rows[2], rows[2].artworkDetail), null, 'free-text manual value stays plain text');
  assert.equal(api.cellCards({ id: 9, plmId: '99' }, 'x'), null, 'no BOM record → plain text');
});

test('manually written summary text renders cards too; free text and inconsistent totals stay plain', () => {
  const rows = [{ id: 1, artworkDetail: '' }, { id: 2, plmId: '7', artworkDetail: '', artworkDetailPlm: 'x' }];
  const { api } = loadModule({ rows, lang: 'en' });
  // PLM ID'siz satır: kullanıcı özet biçimini elle yazar.
  const single = api.cellCards(rows[0], 'Front: 1 | Pigment | Total: 1');
  assert.ok(single, 'manual summary must render cards');
  assert.match(single.cls, /kolArtworkTd/);
  assert.match(single.inner, /<b>Front<\/b><i>1<\/i><\/span><span class="blCellTag" data-tone="1">Pigment<\/span>/);
  assert.match(single.inner, /blCellTotal">1</);
  // Tek teknik son bölgede yazılır ama tüm bölgelere aittir (tekdüze biçim).
  const uniform = api.cellCards(rows[0], 'Front: 1 • Back: 2 | Pigment | Total: 3');
  assert.match(uniform.inner, /<b>Front<\/b><i>1<\/i><\/span><span class="blCellChip"><b>Back<\/b><i>2<\/i><\/span><span class="blCellTag" data-tone="1">Pigment</);
  // Karışık teknik + TR anahtar kelimesi.
  const mixed = api.cellCards(rows[0], 'Ön: 1 | Pigment • Kollar: 2 | Transfer | Toplam: 3');
  assert.match(mixed.inner, /<b>Ön<\/b><i>1<\/i><\/span><span class="blCellTag" data-tone="1">Pigment<\/span><span class="blCellChip"><b>Kollar<\/b><i>2<\/i><\/span><span class="blCellTag" data-tone="2">Transfer/);
  // Set Style biçimi: her satır bir parça.
  const set = api.cellCards(rows[0], 'A - Front: 1 • Back: 1 | Pigment | Total: 2\nB - No print');
  assert.match(set.cls, /isMulti/);
  assert.match(set.inner, /blCellPart">A[\s\S]*blCellTotal">2<[\s\S]*blCellPart">B[\s\S]*No print/);
  // Kayıtlı BOM'u olan satırda farklı ama biçimli manuel değer de kartlanır.
  assert.ok(api.cellCards(rows[1], 'Back: 1 | Foil Print | Total: 1'));
  // Elle yazılan etiket kaçışlanır.
  assert.match(api.cellCards(rows[0], '<b>X</b>: 1 | Pigment | Total: 1').inner, /&lt;b&gt;X&lt;\/b&gt;/);
  for (const text of ['Pigment Print', 'Termin: 12', 'Front: 1 | Pigment', 'Front: 1 | Pigment | Total: 5', 'Front: 0 | Pigment | Total: 0', 'Front: 1 | Total: 1\nnot a part', '']) {
    assert.equal(api.cellCards(rows[0], text), null, `plain text expected for ${JSON.stringify(text)}`);
  }
});

test('Collection cell keeps the textarea editor under the card layer (edit/copy path unchanged)', () => {
  // Tek hücre düzenlemesi tam çizim yapmaz; kart katmanı o hücrede yenilenir.
  assert.match(APP, /if\(k==='artworkDetail'\)window\.BLCollectionArtworkDetail\?\.refreshCell\?\.\(row\);/);
  assert.match(COLUMN, /function refreshCell\(row\)/);
  assert.match(APP, /c\.k==='artworkDetail'\?window\.BLCollectionArtworkDetail\?\.cellCards\?\.\(r,val\):null/);
  assert.match(APP, /\$\{art\?art\.inner:''\}<textarea class="editCell kolTextCell"/);
  const css = read('public/collection-spreadsheet.css');
  assert.match(css, /td\.kolArtworkTd:not\(\.kolSpreadsheetEditing\):not\(:focus-within\) \.editCell\{opacity:0\}/);
  assert.match(css, /\.kolArtworkCards\{[^}]*pointer-events:none/);
  assert.match(read('public/ui-components.css'), /:is\(#kolTable,#cpTable,#ordersTable\) tbody \.blCellTag\[data-tone="1"\] \{color:var\(--ui-chart-3\)/, 'appearance lives in the Manifest layer');
  assert.match(read('public/app.css'), /:is\(#kolTable,#cpTable,#ordersTable\) tbody \.blCellChip\{flex:none;display:inline-flex/, 'shared card layout is global (CP/Orders reuse it)');
});

test('BOM batch summary carries slim Set Style parts for the card view', () => {
  const { summaryEntry } = require('../server/lib/plm-bom-store');
  const summary = summaryEntry({ plmId: '1', isSetStyle: true, setComponents: [
    { label: 'A', components: [{ x: 1 }], placements: [{ placement: 'front_body', placementTr: 'Ön', placementEn: 'Front', count: 1, printType: 'Pigment', description: 'long' }] },
  ] });
  assert.deepEqual(summary.setParts, [{ label: 'A', placements: [{ placement: 'front_body', placementTr: 'Ön', placementEn: 'Front', count: 1, printType: 'Pigment' }] }]);
  assert.deepEqual(summaryEntry({ plmId: '2', placements: [] }).setParts, []);
});
