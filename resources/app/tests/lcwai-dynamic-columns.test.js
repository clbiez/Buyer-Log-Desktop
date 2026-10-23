'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const main = fs.readFileSync(path.join(__dirname, '../public/app-main.js'), 'utf8');
const chatSource = fs.readFileSync(path.join(__dirname, '../public/lcwai-chat.js'), 'utf8');
const modelGroups = require('../public/collection-model-groups');
function section(start, end) {
  const a = main.indexOf(start), b = main.indexOf(end, a);
  assert.ok(a >= 0 && b > a, `Production section: ${start}`);
  return main.slice(a, b);
}
function fixture() {
  const cpCols = [
    { k: 'Model', label: 'Model', type: 'ro' },
    { k: 'note_demo', label: 'Legacy', labelTr: 'Takip', labelEn: 'Follow-up', noteCustom: true, type: 'text' },
    { k: '__CPX_demo', label: 'DB amount', labelTr: 'Veritabanı tutarı', labelEn: 'Database amount', modelCustom: true, type: 'ro' },
    { k: '__f_demo', label: 'Calculated', labelTr: 'Hesaplanan tutar', labelEn: 'Calculated amount', formulaCustom: true, type: 'formula', formulaDef: { decimals: 2 } },
    { k: '_private', label: 'Private', type: 'ro' },
    { k: '__picture', label: 'Picture', type: 'cpImage' },
  ];
  const cpRows = [{ _id: 'cp1', Model: 'DEMO', note_demo: 'Ready', __CPX_demo: 0, __f_demo: 12.5, _private: 'must stay local' }];
  const kolCols = [{ k: 'modelKod', label: 'Model Code' }, { k: 'cx_demo', label: 'Legacy', labelTr: 'Renk takibi', labelEn: 'Colour follow-up', custom: true }];
  const kolRows = [{ id: 1, modelKod: 'DEMO', cx_demo: 'Raw', variantOverrides: { cx_demo: 'Displayed' }, pricing: { Demo: 19.5 } }];
  const providers = new Map();
  const window = { appLang: 'tr', addEventListener() {}, BLCollectionModelGroups: modelGroups,
    BLChecklistComponents: require('../public/checklist-components-engine'),
    BLFormulaColumns: { formatValue: value => value == null ? '' : Number(value).toFixed(2) },
    BuyerLogAI: { registerContextProvider: provider => providers.set(provider.id, provider) } };
  const env = {
    window, console, File, document: { documentElement: { lang: 'tr' }, getElementById() { return null; } },
    state: { cp: { rows: cpRows }, orders: { rows: cpRows } }, kolRows, appLang: 'tr',
    APP_PAGE_META: { cp: { tr: 'CP', en: 'CP' }, orders: { tr: 'Siparişler', en: 'Orders' }, koleksiyon: { tr: 'Koleksiyon', en: 'Collection' } },
    KOL_SYNTHETIC_COL_KEYS: ['__bestPrice__', '__confirmedName__', '__confirmedPrice__'],
    KOL_SYNTHETIC_COL_META: { __bestPrice__: { kind: 'best', label: 'Best Price' }, __confirmedName__: { kind: 'confirmedName', label: 'Conf. Manufacturer' }, __confirmedPrice__: { kind: 'confirmedPrice', label: 'Approved Mfr. Price' } },
    kolHiddenCols: new Set(['cx_demo', '__confirmedPrice__']),
    kolColOrder: ['modelKod', 'cx_demo', '__bestPrice__', '__confirmedName__', '__confirmedPrice__'],
    L: value => value, kolColDefs: () => kolCols, kolAllOrderedCols: () => kolCols, kolNormalizeDisplayOrder: value => value,
    kolColumnLabel: col => col[env.appLang === 'en' ? 'labelEn' : 'labelTr'] || col.label,
    tableColumnLabel: (_key, col) => col[env.appLang === 'en' ? 'labelEn' : 'labelTr'] || col.label,
    visibleCols: () => cpCols.filter(col => col.k !== '__CPX_demo'),
    tableInfoForTab(tab) { return { tableKey: tab, cols: () => tab === 'koleksiyon' ? kolCols : cpCols,
      rowsFn: () => tab === 'koleksiyon' ? kolRows : cpRows, selSet: () => new Set([tab === 'koleksiyon' ? kolRows[0].id : 'cp1']) }; },
    ovFilteredCpRows: () => cpRows,
    cpSubManufacturerValue: row => row['Sub-Manufacturer'], norm: value => value == null ? '' : String(value),
    columnSchemaFor: () => ({ format: value => value == null ? '' : String(value) }), cpLogisticHasDetails: () => false,
    kolEffectivePricing: row => row.pricing, kolParseMoneyNum: Number, kolFormatMoneyDisplay: value => Number(value).toFixed(2),
    kolBestPricing: () => ({ name: 'Demo', price: 19.5 }), kolConfirmedDisplay: () => ({ name: 'Demo', price: 19.5 }),
    kolGroupSummaryFormatBaseValue: (_col, _row, value) => value == null ? '' : String(value),
    kolChecklistStatus: value => value, kolChecklistStatusLabel: value => `status:${value}`,
    endeksmatikCompactText: row => String(row.endeksmatikData?.result?.prices?.usd ?? ''),
    kolLandedCalc: row => ({ trPrice: row.trPrice, fx: row.trFx, trMult: 1, trLanded: Number(row.trPrice) / Number(row.trFx), ydLanded: 9, supp: { price: 9, source: 'best' }, ydMult: 1, profitPct: null }),
    kolMoney2: value => Number(value).toFixed(2),
  };
  const context = vm.createContext(env);
  for (const [start, end] of [
    ['function kolChecklistParts(', 'function kolConfigureChecklistParts('],
    ['function cellPlainText(', 'function escapeHtml('],
    ['function kolDescriptorCatalog(', 'function kolDescriptorDefaultWidth('],
    ['function kolEffectiveValue(', 'function kolWriteGroupedStorageValue('],
    ['const KOL_LANDED_EFFECTIVE_KEYS =', 'function kolGroupSummaryWeighted('],
    ['function kolCollectionRawCellText(', 'function kolCollectionExportCellText('],
    ['window.BLAIScreenData = {', '// Üst çubuktaki LCW AI düğmesi:'],
  ]) vm.runInContext(section(start, end), context);
  window.BLAIScreenData.rowImage = () => null;
  // Register the production providers without mounting the DOM chat panel.
  vm.runInContext(chatSource.replace('window.initLcwAiChat = initLcwAiChat;', 'registerDefaultProviders();\n  window.initLcwAiChat = initLcwAiChat;'), context);
  return { env, window, chat: window.BLLcwAiChat, cpCols, cpRows, kolCols, kolRows, providers };
}
const plain = value => JSON.parse(JSON.stringify(value));
test('CP and Orders include declared formulas/database columns with current labels and formatted values', async () => {
  const { chat } = fixture();
  for (const tab of ['cp', 'orders']) {
    const data = chat.tableContext(tab, 'all');
    assert.deepEqual(plain(data.columns), ['Model', 'Takip', 'Hesaplanan tutar', 'Veritabanı tutarı']);
    assert.deepEqual(plain(data.rows), [['DEMO', 'Ready', '12.50', '0']]);
    const csv = await chat.contextAsFile(data).file.text();
    assert.ok(csv.includes('Hesaplanan tutar'));
    assert.ok(csv.includes('12.50,0'));
    assert.ok(!csv.includes('must stay local'));
  }
});
test('each build sees newly added columns and the current language', () => {
  const { env, window, chat, cpCols, cpRows } = fixture();
  chat.tableContext('cp', 'all');
  cpCols.push({ k: 'note_later', label: 'Old', labelTr: 'Yeni takip', labelEn: 'New follow-up', noteCustom: true, type: 'text' });
  cpRows[0].note_later = 'Later';
  env.appLang = window.appLang = 'en';
  const data = chat.tableContext('cp', 'all');
  assert.ok(data.columns.includes('New follow-up'));
  assert.ok(data.columns.includes('Follow-up'));
  assert.equal(data.rows[0][data.columns.indexOf('New follow-up')], 'Later');
});
test('Collection all includes hidden custom and synthetic columns, effective values, and remains read-only', () => {
  const { chat, kolRows } = fixture();
  const before = JSON.stringify(kolRows);
  const data = chat.tableContext('koleksiyon', 'all');
  assert.deepEqual(plain(data.columns), ['Model Code', 'Renk takibi', 'Best Price', 'Conf. Manufacturer', 'Approved Mfr. Price']);
  assert.deepEqual(plain(data.rows), [['DEMO', 'Displayed', '$19.50', 'Demo', '$19.50']]);
  const visible = chat.tableContext('koleksiyon', 'visible');
  assert.deepEqual(plain(visible.columns), ['Model Code', 'Best Price', 'Conf. Manufacturer']);
  assert.equal(JSON.stringify(kolRows), before);
});
test('Collection selection uses id including zero rather than CP _id', () => {
  const { chat, kolRows } = fixture();
  assert.equal(chat.tableContext('koleksiyon', 'selected').rows.length, 1);
  kolRows[0].id = 0;
  assert.equal(chat.tableContext('koleksiyon', 'selected').rows.length, 1);
});
test('Overview all uses the full current CP catalog and the same value reader', () => {
  const { window, providers } = fixture();
  assert.ok(window.BLAIScreenData.cpColumns({ all: true }).some(col => col.key === '__CPX_demo'));
  const data = providers.get('overview').build('all');
  assert.ok(data.columns.includes('Hesaplanan tutar'));
  assert.ok(data.columns.includes('Veritabanı tutarı'));
  assert.ok(data.rows[0].includes('12.50'));
});
test('CP column metadata is available even when the CP filter matches no rows', () => {
  const { env, window } = fixture();
  const original = env.tableInfoForTab;
  env.tableInfoForTab = tab => ({ ...original(tab), rowsFn: () => [] });
  assert.equal(window.BLAIScreenData.table('cp'), null);
  assert.ok(window.BLAIScreenData.cpColumns().some(col => col.key === '__f_demo'));
  env.tableInfoForTab = tab => ({ ...original(tab), rowsFn: () => { throw new Error('Metadata must not filter CP rows'); } });
  assert.ok(window.BLAIScreenData.cpColumns().some(col => col.key === 'note_demo'));
});
test('Collection effective zero/false values, checklist labels and image identities survive CSV conversion', async () => {
  const { env, window, chat, kolCols, kolRows } = fixture();
  kolCols.push({ k: 'cx_zero', label: 'Zero', custom: true }, { k: 'cx_false', label: 'False', custom: true }, { k: 'cx_check', label: 'Check', checklist: true });
  env.kolColOrder.push('cx_zero', 'cx_false', 'cx_check');
  Object.assign(kolRows[0].variantOverrides, { cx_zero: 0, cx_false: false, cx_check: 'done' });
  window.BLAIScreenData.rowImage = () => ({ source: '/api/demo-image', modelId: 'DEMO', colourCode: 'BLUE' });
  const data = chat.tableContext('koleksiyon', 'all');
  assert.equal(data.columns[0], 'BL Image');
  assert.match(data.rows[0][0], /^KOL-/);
  assert.equal(data.rows[0][data.columns.indexOf('Zero')], '0');
  assert.equal(data.rows[0][data.columns.indexOf('False')], 'false');
  assert.equal(data.rows[0][data.columns.indexOf('Check')], 'status:done');
  const converted = chat.contextAsFile(data);
  const csv = await converted.file.text();
  assert.ok(!csv.includes('/api/demo-image'));
  assert.deepEqual(plain(converted.images), plain(data.images));
  assert.equal(chat.tableContext('koleksiyon', 'filters').rows.length, 0);
});
test('Collection card-detail records carry hidden and empty columns while the LCW AI CSV keeps visible columns', () => {
  const { window, chat, kolRows } = fixture();
  kolRows[0].modelKod = '';
  window.BLAIScreenData.rowImage = () => ({ source: '/api/demo-image', modelId: 'DEMO', colourCode: 'BLUE' });
  const data = chat.tableContext('koleksiyon', 'visible');
  assert.deepEqual(plain(data.columns), ['BL Image', 'Model Code', 'Best Price', 'Conf. Manufacturer'], 'CSV columns stay visible-only');
  const record = plain(Object.values(data.records)[0]);
  assert.deepEqual(record.map(pair => pair[0]), ['Model Code', 'Renk takibi', 'Best Price', 'Conf. Manufacturer', 'Approved Mfr. Price'], 'hidden columns are offered on cards');
  assert.deepEqual(record[0], ['Model Code', ''], 'an empty column keeps its header');
  assert.equal(record[1][1], 'Displayed');
  assert.ok(!('records' in chat.contextAsFile(data).context), 'records never enter the LCW AI context');
});
test('grouped Collection derived cells use inherited and overridden calculation inputs', () => {
  const { env, chat, kolCols, kolRows } = fixture();
  kolCols.push({ k: 'endeksmatik', label: 'Benchmark', endeksmatik: true }, { k: 'trLanded', label: 'TR Landed', trLanded: true });
  env.kolColOrder.push('endeksmatik', 'trLanded');
  Object.assign(kolRows[0], { modelGroupId: 'group', modelGroupRole: 'parent', trPrice: 100, trFx: 10, endeksmatikData: { result: { prices: { usd: 42 } } } });
  kolRows.push({ id: 2, modelGroupId: 'group', modelGroupRole: 'variant', modelKod: 'DEMO', trPrice: 999, trFx: 999, variantOverrides: { trPrice: 200 }, pricing: {} });
  const before = JSON.stringify(kolRows), data = chat.tableContext('koleksiyon', 'all');
  assert.equal(data.rows[1][data.columns.indexOf('Benchmark')], '42');
  assert.equal(data.rows[1][data.columns.indexOf('TR Landed')], '$20.00 (₺200.00 ÷ 10.00 × 1.00)');
  assert.equal(JSON.stringify(kolRows), before);
});
test('indexed effective reader scans parents once and keeps canonical inheritance semantics', () => {
  const rows = Array.from({ length: 1000 }, (_, id) => ({ id, modelGroupId: String(Math.floor(id / 2)), modelGroupRole: id % 2 ? 'variant' : 'parent', modelSharedValues: { cx_shared: id }, cx_raw: id }));
  rows[1].variantOverrides = { cx_zero: 0, cx_false: false, cx_empty: '', cx_null: null };
  const expected = ['cx_shared', 'cx_raw', 'cx_zero', 'cx_false', 'cx_empty', 'cx_null'].map(key => modelGroups.effectiveValue(rows[1], key, rows));
  let scans = 0;
  rows.filter = () => { throw new Error('An indexed read must not scan all rows'); };
  rows.forEach = callback => { scans++; Array.prototype.forEach.call(rows, callback); };
  const read = modelGroups.createValueReader(rows);
  for (const row of rows) for (let col = 0; col < 20; col++) read(row, `cx_${col}`);
  assert.equal(scans, 1);
  assert.deepEqual(['cx_shared', 'cx_raw', 'cx_zero', 'cx_false', 'cx_empty', 'cx_null'].map(key => read(rows[1], key)), expected);
});
test('Collection context uses one fresh group index per build without per-cell full scans', () => {
  const { chat, kolRows } = fixture();
  let scans = 0;
  kolRows.filter = () => { throw new Error('Context must use the indexed reader'); };
  kolRows.forEach = callback => { scans++; Array.prototype.forEach.call(kolRows, callback); };
  chat.tableContext('koleksiyon', 'all');
  assert.equal(scans, 1);
  kolRows[0].variantOverrides.cx_demo = 'Updated';
  assert.equal(chat.tableContext('koleksiyon', 'all').rows[0][1], 'Updated');
  assert.equal(scans, 2);
});
