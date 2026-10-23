'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const APP_PATH = path.join(__dirname, '..', 'public', 'app-main.js');
const OI_UI_PATH = path.join(__dirname, '..', 'public', 'order-importance-ui.js');
const APP = fs.readFileSync(APP_PATH, 'utf8');
const OI_UI = fs.readFileSync(OI_UI_PATH, 'utf8');

function extractFunction(source, name) {
  const patterns = [`async function ${name}(`, `function ${name}(`];
  let start = -1;
  for (const p of patterns) {
    start = source.indexOf(p);
    if (start >= 0) break;
  }
  assert.ok(start >= 0, `Missing function ${name}`);
  let parenDepth = 0;
  let bodyOpen = -1;
  for (let i = source.indexOf('(', start); i < source.length; i += 1) {
    if (source[i] === '(') parenDepth += 1;
    else if (source[i] === ')') {
      parenDepth -= 1;
      if (parenDepth === 0) {
        bodyOpen = source.indexOf('{', i);
        break;
      }
    }
  }
  assert.ok(bodyOpen > start, `Missing body for ${name}`);
  let depth = 0;
  let inSingle = false;
  let inDouble = false;
  let inTemplate = false;
  let inLineComment = false;
  let inBlockComment = false;
  let escaped = false;
  for (let i = bodyOpen; i < source.length; i += 1) {
    const ch = source[i];
    const next = source[i + 1];
    if (inLineComment) { if (ch === '\n') inLineComment = false; continue; }
    if (inBlockComment) { if (ch === '*' && next === '/') { inBlockComment = false; i += 1; } continue; }
    if (escaped) { escaped = false; continue; }
    if (ch === '\\') { escaped = true; continue; }
    if (inSingle) { if (ch === "'") inSingle = false; continue; }
    if (inDouble) { if (ch === '"') inDouble = false; continue; }
    if (inTemplate) { if (ch === '`') inTemplate = false; continue; }
    if (ch === '/' && next === '/') { inLineComment = true; i += 1; continue; }
    if (ch === '/' && next === '*') { inBlockComment = true; i += 1; continue; }
    if (ch === "'") { inSingle = true; continue; }
    if (ch === '"') { inDouble = true; continue; }
    if (ch === '`') { inTemplate = true; continue; }
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error(`Unclosed function ${name}`);
}

test('B1 · syncOrderLinePeersFromCpRow state.orders.rows ve state.orderSummary.rows eşleşen satırlarını bellekte eşitler ve tarih/Del. Type değişiminde formülleri + renderOrders çalıştırır', () => {
  const calls = { logistic: 0, formulas: 0, invalidate: [], renderOrders: 0 };
  const cpRow = {
    _id: 1,
    'Order Code': 4100010,
    'Model Name': 'MDL-1',
    'C.Code': 'C1',
    'Ex-factory': new Date(2026, 7, 25),
    'Retail Date': new Date(2026, 9, 10),
    'In-Store (Model Budget)': new Date(2026, 8, 26),
    'Del. Type': 'Uçak',
    Licensor: 'DISNEY',
    _licensorManual: true,
    'Sub-Manufacturer': 'ALT-1',
    'Supp. FOB': 6.4,
    _suppFobMeta: { source: 'manual' },
    _suppFobManual: true,
    _suppFobRule: null,
    _suppFobOverride: true,
    Notes: 'Güncel CP notu',
    _notesAt: '2026-10-23T12:00:00Z',
    _notesBy: 'u1',
    _notesByName: 'Buyer One',
    'Ek Not': 'Ek bilgi',
    _ekNotAt: '2026-10-23T12:01:00Z',
    _ekNotBy: 'u1',
    _ekNotByName: 'Buyer One',
    note_col_1: 'Özel sütun notu',
  };
  const orderRow = {
    _id: 101,
    _canEdit: false,
    'Order Code': 4100010,
    'Model Name': 'MDL-1',
    'C.Code': 'C1',
    'Del. Type': 'Gemi',
  };
  const summaryRow = {
    _id: 201,
    'Order Code': 4100010,
    'Model Name': 'MDL-1',
    'C.Code': 'C1',
    'Del. Type': 'Gemi',
  };
  const ctx = {
    state: {
      cp: { rows: [cpRow] },
      orders: { rows: [orderRow] },
      orderSummary: { rows: [summaryRow] },
    },
    CP_NOTE_COLUMN_DEFS: [{ id: 'note_col_1' }],
    sameOrderLine: (a, b) => a && b && a['Order Code'] === b['Order Code'] && a['Model Name'] === b['Model Name'] && a['C.Code'] === b['C.Code'],
    syncCpProductionLogisticSegment: () => { calls.logistic += 1; return true; },
    applyFormulas: () => { calls.formulas += 1; },
    invalidateUnifiedPriorityDecisions: (_reason, scopes) => { calls.invalidate.push(scopes); },
    renderOrders: () => { calls.renderOrders += 1; },
    Set, Array, Object,
  };
  vm.createContext(ctx);
  vm.runInContext(extractFunction(APP, 'syncOrderLinePeersFromCpRow'), ctx);

  ctx.syncOrderLinePeersFromCpRow(cpRow, [
    'Ex-factory', 'Retail Date', 'In-Store (Model Budget)', 'Del. Type',
    'Licensor', 'Sub-Manufacturer', 'Supp. FOB', 'Notes', 'Ek Not', 'note_col_1',
  ]);

  for (const peer of [orderRow, summaryRow]) {
    assert.equal(peer['Ex-factory'], cpRow['Ex-factory']);
    assert.equal(peer['Retail Date'], cpRow['Retail Date']);
    assert.equal(peer['In-Store (Model Budget)'], cpRow['In-Store (Model Budget)']);
    assert.equal(peer['Del. Type'], 'Uçak');
    assert.equal(peer.Licensor, 'DISNEY');
    assert.equal(peer['Sub-Manufacturer'], 'ALT-1');
    assert.equal(peer['Supp. FOB'], 6.4);
    assert.deepEqual(JSON.parse(JSON.stringify(peer._suppFobMeta)), { source: 'manual' });
    assert.equal(peer._suppFobManual, true);
    assert.equal(peer._suppFobOverride, true);
    assert.equal(peer.Notes, 'Güncel CP notu');
    assert.equal(peer._notesByName, 'Buyer One');
    assert.equal(peer['Ek Not'], 'Ek bilgi');
    assert.equal(peer.note_col_1, 'Özel sütun notu');
  }
  assert.equal(orderRow._canEdit, false);
  assert.equal(calls.logistic, 2);
  assert.equal(calls.formulas, 2);
  assert.deepEqual(JSON.parse(JSON.stringify(calls.invalidate)), [['orders']]);
  assert.equal(calls.renderOrders, 1);
});

test('B2 · commitCpEditor, clearRowNote, applyHistoryAction, applyCpGridPaste ve fiyat yayılım fonksiyonları state.orders.rows ile senkron çalışır', () => {
  const commitSrc = extractFunction(APP, 'commitCpEditor');
  const clearNoteSrc = extractFunction(APP, 'clearRowNote');
  const historySrc = extractFunction(APP, 'applyHistoryAction');
  const pasteSrc = extractFunction(APP, 'applyCpGridPaste');
  const propSrc = extractFunction(APP, 'propagateOrderPricingFields');
  const ruleSingleSrc = extractFunction(APP, 'applySuppFobRuleToMatchingOrders');
  const ruleAllSrc = extractFunction(APP, 'applyAllSuppFobRules');

  assert.match(commitSrc, /syncOrderLinePeersFromCpRow/);
  assert.match(clearNoteSrc, /syncOrderLinePeersFromCpRow/);
  assert.match(historySrc, /syncOrderLinePeersFromCpRow/);
  assert.match(pasteSrc, /renderOrders\(\)/);
  assert.match(propSrc, /state\.orders\s*&&\s*state\.orders\.rows/);
  assert.match(propSrc, /Sub-Manufacturer/);
  assert.match(ruleSingleSrc, /state\.orders\s*&&\s*state\.orders\.rows/);
  assert.match(ruleAllSrc, /state\.orders\s*&&\s*state\.orders\.rows/);

  // propagateOrderPricingFields runtime: Licensor DTR -> Manufacturer, aksi halde submap değeri
  const cpRow = { 'Order Code': 4100020, 'Model Name': 'M2', 'C.Code': 'K1', Manufacturer: 'ANA ÜRETİCİ', Licensor: 'DISNEY', 'Sub-Manufacturer': 'ALT-A' };
  const ordRow = { 'Order Code': 4100020, 'Model Name': 'M2', 'C.Code': 'K1', Manufacturer: 'ANA ÜRETİCİ', Licensor: 'DISNEY', 'Sub-Manufacturer': 'ALT-A' };
  const sumRow = { 'Order Code': 4100020, 'Model Name': 'M2', 'C.Code': 'K1', Manufacturer: 'ANA ÜRETİCİ', Licensor: 'DISNEY', 'Sub-Manufacturer': 'ALT-A' };
  const ctx = {
    state: {
      cp: { rows: [cpRow] },
      orders: { rows: [ordRow] },
      orderSummary: { rows: [sumRow] },
      overrides: { submap: { '4100020|M2|K1': 'ALT-SUBMAP' } },
    },
    sameOrderLine: (a, b) => a['Order Code'] === b['Order Code'] && a['Model Name'] === b['Model Name'] && a['C.Code'] === b['C.Code'],
    lineKeyOfRow: r => `${r['Order Code']}|${r['Model Name']}|${r['C.Code']}`,
    norm: v => String(v == null ? '' : v).trim(),
    turknorm: v => String(v == null ? '' : v).trim().toUpperCase(),
    normalizeSuppFobMeta: m => m,
    recalcSuppFobForRow: () => {},
    Object,
  };
  vm.createContext(ctx);
  vm.runInContext( propSrc, ctx);

  ctx.propagateOrderPricingFields(cpRow, { licensor: 'DTR' });
  assert.equal(ordRow.Licensor, 'DTR');
  assert.equal(ordRow['Sub-Manufacturer'], 'ANA ÜRETİCİ');
  assert.equal(sumRow['Sub-Manufacturer'], 'ANA ÜRETİCİ');

  ctx.propagateOrderPricingFields(cpRow, { licensor: 'MARVEL' });
  assert.equal(ordRow.Licensor, 'MARVEL');
  assert.equal(ordRow['Sub-Manufacturer'], 'ALT-SUBMAP');
  assert.equal(sumRow['Sub-Manufacturer'], 'ALT-SUBMAP');
});

test('B3 · ensureOrdersLoaded force:true ile yüklü state.orders varlığında yeniden çeker ve cpSetShortageMark yüklü state.orders için force yenileme çağırır', async () => {
  const shortageSrc = extractFunction(APP, 'cpSetShortageMark');
  assert.match(shortageSrc, /if\s*\(\s*state\.orders\s*\)\s*await\s+ensureOrdersLoaded\(\{\s*force:\s*true\s*\}\)/);

  let fetchCalls = 0;
  const ctx = {
    state: {
      orders: { fname: 'Eski', rows: [{ 'Order Code': 1 }] },
      ordersLogisticExpanded: new Set(),
    },
    ordersLoadPromise: null,
    appLang: 'tr',
    setOrdersLoadingState: () => {},
    fetchOrdersProjection: async () => {
      fetchCalls += 1;
      return { cancelled: false, payload: { rows: [{ 'Order Code': 2 }] } };
    },
    reviveServerDates: () => {},
    invalidateUnifiedPriorityDecisions: () => {},
    applyPricingRulesToLoadedRows: () => {},
    ensureCollectionCatalogLoaded: () => Promise.resolve(true),
    buildOrdersFilters: () => {},
    applyCoreAutoFilterState: () => {},
    renderOrders: () => {},
    showToast: () => {},
    Array,
  };
  vm.createContext(ctx);
  vm.runInContext(extractFunction(APP, 'ensureOrdersLoaded'), ctx);

  // force verilmezse mevcut state.orders korunur, yeni istek atılmaz.
  await ctx.ensureOrdersLoaded();
  assert.equal(fetchCalls, 0);
  assert.equal(ctx.state.orders.rows[0]['Order Code'], 1);

  // force:true verilirse yeniden çekilir.
  await ctx.ensureOrdersLoaded({ force: true });
  assert.equal(fetchCalls, 1);
  assert.equal(ctx.state.orders.rows[0]['Order Code'], 2);
});

test('B4 · order-importance-ui.js state.orderSummary.rows satırlarını kapsar ve repaint içinde renderOrders koşulsuz çağrılır', () => {
  const oiPath = path.join(__dirname, '..', 'public', 'order-importance.js');
  const BLOrderImportance = require(oiPath);

  let renderOrdersCalls = 0;
  const cpRow = { _id: 1, 'Order Code': 4100030, Line: 'L1', Season: 'W26' };
  const ordRow = { _id: 2, 'Order Code': 4100030, Line: 'L1', Season: 'W26' };
  const sumRow = { _id: 3, 'Order Code': 4100030, Line: 'L1', Season: 'W26' };

  const ctx = {
    window: {
      BLOrderImportance,
      SERVER_BACKED: false,
      addEventListener() {},
    },
    document: {
      documentElement: { lang: 'tr' },
      body: { dataset: { activeTab: 'cp' } },
      addEventListener() {},
    },
    state: {
      cp: { rows: [cpRow] },
      orders: { rows: [ordRow] },
      orderSummary: { rows: [sumRow] },
      overrides: {},
    },
    appLang: 'tr',
    lineKeyOfRow: r => String(r && r['Order Code'] || ''),
    invalidateCoreFacetCaches: () => {},
    refreshRowEverywhere: () => {},
    renderCP: () => {},
    renderOrders: () => { renderOrdersCalls += 1; },
    showToast: () => {},
  };
  vm.createContext(ctx);
  vm.runInContext(OI_UI, ctx);

  const settings = BLOrderImportance.defaultSettings();
  const tagId = settings.tags[0].id;
  ctx.window.BLOrderImportanceUI.setSettings(settings, 1);
  ctx.window.BLOrderImportanceUI.pasteAssign(cpRow, tagId);

  assert.equal(cpRow._importanceId, tagId);
  assert.equal(ordRow._importanceId, tagId);
  assert.equal(sumRow._importanceId, tagId, 'orderSummary satırı da aynı önem etiketini almalı');
  assert.equal(renderOrdersCalls, 1, 'aktif sekme cp iken de renderOrders (ertelenmiş çizim için) çağrılmalı');
});

test('B5 · ocMetaFromKolRow onaylı üreticiyi, hedef fiyatı ve model grubundan miras alınan alanları çözer; onaylı fiyatı targetFob alanına yazmaz', () => {
  const parentRow = {
    id: 10,
    modelGroupId: 'mg_1',
    modelGroupRole: 'parent',
    modelKod: '6W1234Z8',
    plmId: 'PLM-900',
    colour: 'SİYAH',
    country: 'Bangladeş',
    season: 'W26',
    lisans: 'Disney Mickey',
    urunTipi: 'Kazak',
    buyingSampleManufacturer: 'NUMUNE ÜRETİCİSİ',
    confirmedManufacturer: 'ONAYLI ÜRETİCİ A.Ş.',
    pricing: { 'ONAYLI ÜRETİCİ A.Ş.': '5.80' },
    targetPrice: '5.25',
    quantity: 3000,
    img: 'img-parent.png',
    modelSharedValues: {
      modelKod: '6W1234Z8',
      plmId: 'PLM-900',
      country: 'Bangladeş',
      season: 'W26',
      lisans: 'Disney Mickey',
      urunTipi: 'Kazak',
      buyingSampleManufacturer: 'NUMUNE ÜRETİCİSİ',
      confirmedManufacturer: 'ONAYLI ÜRETİCİ A.Ş.',
      pricing: { 'ONAYLI ÜRETİCİ A.Ş.': '5.80' },
      targetPrice: '5.25',
    },
  };
  const variantRow = {
    id: 11,
    modelGroupId: 'mg_1',
    modelGroupRole: 'variant',
    modelKod: '6W1234Z8',
    plmId: 'PLM-900',
    colour: 'EKRU',
    country: '',
    season: '',
    lisans: '',
    urunTipi: '',
    buyingSampleManufacturer: '',
    confirmedManufacturer: 'ONAYLI ÜRETİCİ A.Ş.',
    pricing: {},
    targetPrice: '',
    quantity: 1850,
    img: 'img-variant.png',
    variantOverrides: {},
  };

  const BLCollectionModelGroups = require('../public/collection-model-groups');
  const ctx = {
    window: { BLCollectionModelGroups },
    kolRows: [parentRow, variantRow],
    kolColDefs: () => [
      { k: 'modelKod' }, { k: 'plmId' }, { k: 'colour' }, { k: 'country' },
      { k: 'season' }, { k: 'lisans' }, { k: 'urunTipi' },
      { k: 'buyingSampleManufacturer' }, { k: 'targetPrice' }, { k: 'quantity' },
    ],
    kolParseMoneyNum: BLCollectionModelGroups.kolParseMoneyNum,
    norm: v => String(v == null ? '' : v).trim(),
    Set, Object, String, Array, Boolean,
  };
  vm.createContext(ctx);
  vm.runInContext(`
    ${extractFunction(APP, 'kolEffectiveValue')}
    ${extractFunction(APP, 'kolEffectivePricing')}
    ${extractFunction(APP, 'kolConfirmedPricing')}
    ${extractFunction(APP, 'kolEffectiveProjection')}
    ${extractFunction(APP, 'ocMetaFromKolRow')}
  `, ctx);

  const meta = JSON.parse(JSON.stringify(ctx.ocMetaFromKolRow(variantRow)));
  assert.deepEqual(meta, {
    title: '6W1234Z8 · EKRU',
    modelCode: '6W1234Z8',
    plmId: 'PLM-900',
    manufacturer: 'ONAYLI ÜRETİCİ A.Ş.',
    country: 'Bangladeş',
    season: 'W26',
    license: 'Disney Mickey',
    category: 'Kazak',
    quantity: '1850',
    targetFob: '5.25',
    image: 'img-variant.png',
  });

  // Onaylı üretici yoksa buyingSampleManufacturer kullanılır.
  variantRow.confirmedManufacturer = '';
  parentRow.confirmedManufacturer = '';
  parentRow.modelSharedValues.confirmedManufacturer = '';
  const fallbackMeta = JSON.parse(JSON.stringify(ctx.ocMetaFromKolRow(variantRow)));
  assert.equal(fallbackMeta.manufacturer, 'NUMUNE ÜRETİCİSİ');
  assert.equal(fallbackMeta.targetFob, '5.25');
});
