'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { extractFunction } = require('./helpers/app-main-functions');

const ROOT = path.join(__dirname, '..');
const APP = fs.readFileSync(path.join(ROOT, 'public', 'app-main.js'), 'utf8');
const OI_UI = fs.readFileSync(path.join(ROOT, 'public', 'order-importance-ui.js'), 'utf8');
const SERVER = require('./helpers/server-source')();

test('CP satır düzenlemeleri, not silme ve geri-al/ileri-al işlemleri Orders ve OrderSummary satırlarını senkron tutar', () => {
  const cpRow = {
    _id: 1,
    'Order Code': 7001,
    'Model Name': 'MODEL-A',
    'C.Code': 'BLK',
    Manufacturer: 'MAIN MFR',
    'Sub-Manufacturer': 'SUB-1',
    Licensor: 'WARNER',
    License: 'BATMAN',
    'Ex-factory': new Date(2026, 7, 10),
    'Retail Date': new Date(2026, 9, 10),
    'In-Store (Model Budget)': new Date(2026, 8, 26),
    'Del. Type': 'Gemi',
    'Supp. FOB': 10,
    Notes: 'İlk not',
    _notesAt: '2026-10-20T10:00:00.000Z',
    _notesBy: 'u1',
    _notesByName: 'Buyer 1',
    'Ek Not': '',
    note_custom_1: 'Eski değer',
    _baseline: {
      'Ex-factory': new Date(2026, 7, 1),
      'Retail Date': new Date(2026, 9, 1),
      'In-Store (Model Budget)': new Date(2026, 8, 17),
    },
  };
  const ordersRow = { ...cpRow, _id: 101, _canEdit: false };
  const summaryRow = { ...cpRow, _id: 201 };

  const logisticCalls = [];
  const formulaCalls = [];
  const dateSaves = [];
  let ordersRendered = 0;

  const context = {
    state: {
      cp: { rows: [cpRow] },
      orders: { rows: [ordersRow] },
      orderSummary: { rows: [summaryRow] },
      overrides: {
        suppfobmap: {},
        suppfobmetamap: {},
        licensormap: {},
        submap: { '7001|MODEL-A|BLK': 'SUB-1' },
        datemap: {},
      },
    },
    window: { SERVER_BACKED: true },
    CP_NOTE_COLUMN_DEFS: [{ id: 'note_custom_1', label: 'Özel Not' }],
    norm: v => String(v == null ? '' : v).trim(),
    turknorm: v => String(v == null ? '' : v).trim().toLocaleUpperCase('tr-TR'),
    sameOrderLine: (a, b) => a && b && a['Order Code'] === b['Order Code'] && a['Model Name'] === b['Model Name'] && a['C.Code'] === b['C.Code'],
    lineKeyOfRow: r => `${r['Order Code']}|${r['Model Name']}|${r['C.Code']}`,
    editableValuesEqual: (a, b) => {
      if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
      return String(a == null ? '' : a) === String(b == null ? '' : b);
    },
    isAreaFrozen: () => false,
    dateValueISO: t => t.value || '',
    toDateOnly: v => (v instanceof Date ? new Date(v.getFullYear(), v.getMonth(), v.getDate()) : v ? new Date(v) : null),
    addDays: (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n),
    BLRevision: {
      baselineDate: (r, k) => r._baseline && r._baseline[k],
      revisedDateKeys: () => ['Ex-factory'],
    },
    syncCpProductionLogisticSegment: (r, del) => { logisticCalls.push({ row: r, del }); },
    applyFormulas: r => { formulaCalls.push(r); },
    invalidateUnifiedPriorityDecisions: () => {},
    invalidateCoreFacetCaches: () => {},
    refreshCpRowOnly: () => {},
    refreshOverviewNotesLive: () => {},
    scheduleOverviewRender: () => {},
    renderOrders: () => { ordersRendered += 1; },
    markDirty: () => {},
    pushUndo: () => {},
    saveDateOverrides: (r, keys) => { dateSaves.push({ orderCode: r['Order Code'], keys }); },
    normalizeSuppFobMeta: m => m || { source: 'manual' },
    recalcSuppFobForRow: r => {
      if (r.Licensor === 'DTR') r['Supp. FOB'] = 8.5;
    },
    refreshSubmfrList: () => {},
    refreshLicensorList: () => {},
    showToast: () => {},
    L: s => s,
    Number, String, Object, Array, Set, Map, Date, isNaN,
  };

  vm.createContext(context);
  [
    'syncOrderLinePeersFromCpRow',
    'refreshRowEverywhere',
    'applyHistoryAction',
    'clearRowNote',
    'commitCpEditor',
    'propagateOrderPricingFields',
  ].forEach(name => vm.runInContext(extractFunction(APP, name), context));

  // 1) Ex-factory düzenlemesi Orders ve OrderSummary'ye yayılır ve yalnız değişen tarih alt alanını kaydeder.
  assert.equal(
    context.commitCpEditor({ dataset: { id: '1', key: 'Ex-factory', kind: 'exfactory' }, value: '2026-08-20' }),
    true,
  );
  assert.equal(ordersRow['Ex-factory'].getFullYear(), 2026);
  assert.equal(ordersRow['Ex-factory'].getMonth(), 7);
  assert.equal(ordersRow['Ex-factory'].getDate(), 20);
  assert.equal(summaryRow['Ex-factory'].getDate(), 20);
  assert.deepEqual(JSON.parse(JSON.stringify(dateSaves.at(-1))), { orderCode: 7001, keys: ['Ex-factory'] });
  assert.ok(ordersRendered > 0, 'refreshRowEverywhere Orders görünümünü de işaretlemeli');

  // 2) Del. Type düzenlemesi Orders ve OrderSummary'ye yayılır ve lojistik segmentini senkronlar.
  logisticCalls.length = 0;
  assert.equal(
    context.commitCpEditor({ dataset: { id: '1', key: 'Del. Type', kind: 'deltype' }, value: 'Uçak' }),
    true,
  );
  assert.equal(ordersRow['Del. Type'], 'Uçak');
  assert.equal(summaryRow['Del. Type'], 'Uçak');
  assert.ok(logisticCalls.some(item => item.row === ordersRow && item.del === 'Uçak'));

  // 3) Licensor DTR olduğunda Sub-Manufacturer ve Supp. FOB tüm projeksiyonlarda güncellenir.
  assert.equal(
    context.commitCpEditor({ dataset: { id: '1', key: 'Licensor', kind: 'licensor' }, value: 'DTR' }),
    true,
  );
  assert.equal(ordersRow.Licensor, 'DTR');
  assert.equal(ordersRow['Sub-Manufacturer'], 'MAIN MFR');
  assert.equal(summaryRow['Sub-Manufacturer'], 'MAIN MFR');
  assert.equal(ordersRow['Supp. FOB'], 8.5);

  // 4) Özel not sütunu (kind='text') düzenlemesi Orders ve OrderSummary'ye yayılır.
  assert.equal(
    context.commitCpEditor({ dataset: { id: '1', key: 'note_custom_1', kind: 'text' }, value: 'Güncel özel not' }),
    true,
  );
  assert.equal(ordersRow.note_custom_1, 'Güncel özel not');
  assert.equal(summaryRow.note_custom_1, 'Güncel özel not');

  // 5) clearRowNote not metnini ve yazar/zaman damgasını tüm projeksiyonlarda temizler.
  context.clearRowNote(1, 'Notes');
  assert.equal(cpRow.Notes, '');
  assert.equal(cpRow._notesAt, '');
  assert.equal(cpRow._notesBy, '');
  assert.equal(ordersRow.Notes, '');
  assert.equal(ordersRow._notesAt, '');
  assert.equal(ordersRow._notesBy, '');
  assert.equal(summaryRow.Notes, '');

  // 6) applyHistoryAction (Undo/Redo) tarih geri alındığında saveDateOverrides çağırır ve Orders'ı senkronlar.
  const prevEx = new Date(2026, 7, 10);
  const nextEx = new Date(2026, 7, 20);
  context.applyHistoryAction({ id: 1, fields: [{ key: 'Ex-factory', prev: prevEx, next: nextEx }] }, 'undo');
  assert.equal(cpRow['Ex-factory'].getDate(), 10);
  assert.equal(ordersRow['Ex-factory'].getDate(), 10);
  assert.equal(summaryRow['Ex-factory'].getDate(), 10);
  assert.deepEqual(JSON.parse(JSON.stringify(dateSaves.at(-1))), { orderCode: 7001, keys: ['Ex-factory'] });
});

test('saveDateOverrides yalnız değişen tarih alt alanlarını gönderir ve aynı satırdaki ardışık tarih düzenlemelerini birleştirir', () => {
  const timers = new Map();
  let seq = 0;
  const sent = [];
  const row = {
    'Order Code': 9001,
    'Model Name': 'MDL',
    'C.Code': '01',
    'Ex-factory': new Date(2026, 7, 15),
    'Retail Date': new Date(2026, 9, 1),
    'In-Store (Model Budget)': new Date(2026, 8, 17),
  };
  const context = {
    window: { SERVER_BACKED: true },
    state: { overrides: { datemap: {} } },
    BLRevision: {
      revisedDateKeys: () => ['Ex-factory'],
    },
    overrideSyncKey: (r, oc) => `${oc}|${r['Model Name']}|${r['C.Code']}`,
    lineIdentity: r => ({ modelName: r['Model Name'], ccode: r['C.Code'] }),
    toISODate: d => (d instanceof Date ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` : ''),
    enqueueOverrideMutation: (_area, url, opts) => {
      sent.push({ url, body: JSON.parse(opts.body) });
      return Promise.resolve({ ok: true });
    },
    notifyOverrideSaveError: () => {},
    appLang: 'tr',
    setTimeout: fn => { const id = ++seq; timers.set(id, fn); return id; },
    clearTimeout: id => { timers.delete(id); },
    console: { warn() {} },
    Map, Set, Object, Array, String,
  };
  vm.createContext(context);
  vm.runInContext(`
    const _pendingOverrideWrites = new Map();
    const _pendingDateOverrideKeys = new Map();
    ${extractFunction(APP, 'schedulePendingOverrideWrite')}
    ${extractFunction(APP, 'flushPendingOverrideWrites')}
    ${extractFunction(APP, 'saveDateOverrides')}
  `, context);

  context.saveDateOverrides(row, ['Ex-factory']);
  assert.deepEqual(JSON.parse(JSON.stringify(context.state.overrides.datemap['9001|MDL|01'])), { ex: '2026-08-15' });
  context.flushPendingOverrideWrites();
  assert.equal(sent.length, 1);
  assert.deepEqual(
    sent[0].body.dates,
    { exFactory: '2026-08-15' },
    'dokunulmayan Retail/MB alanları null olarak gönderilip eşzamanlı revizyonları silmemeli',
  );
});

test('sunucu ve istemci artımlı yama fonksiyonları Supp. FOB kural bilgisini, özel not sütunlarını ve lojistik segmentlerini korur', () => {
  const parseLib = require('../server/lib/parse');
  const serverCtx = { parseLib, Object, Number, String, Set };
  vm.createContext(serverCtx);
  const serverFnStart = SERVER.indexOf('function applyIncrementalProjectionPatch(');
  const serverFnEnd = SERVER.indexOf('async function rewriteProjectionCacheForRowPatches', serverFnStart);
  vm.runInContext(SERVER.slice(serverFnStart, serverFnEnd), serverCtx);

  const serverRow = { 'Order Code': 1001, 'Supp. FOB': 5 };
  serverCtx.applyIncrementalProjectionPatch(
    serverRow,
    { suppFob: 7.25, suppFobMeta: { source: 'rule', ruleId: 'rule-42' } },
    {},
    false,
  );
  assert.equal(serverRow['Supp. FOB'], 7.25);
  assert.equal(serverRow._suppFobManual, false, 'kural kaynaklı Supp. FOB sunucu önbelleğinde manuel işaretlenmemeli');
  assert.equal(serverRow._suppFobRule, 'rule-42');

  const logisticSynced = [];
  const clientCtx = {
    CP_IMAGE_API: '/api/cp-images',
    CP_NOTE_COLUMN_DEFS: [{ id: 'custom_note_a', label: 'Not A' }],
    BLImageRuntime: { invalidate() {} },
    window: {},
    recalcSuppFobForRow: () => {},
    syncCpProductionLogisticSegment: (r, del) => { logisticSynced.push({ r, del }); },
    applyFormulas: () => {},
    invalidateUnifiedPriorityDecisions: () => {},
    scheduleOverviewRender: () => {},
    Object, Number, String, Set, Array,
  };
  vm.createContext(clientCtx);
  vm.runInContext(extractFunction(APP, 'applyRemoteRowPatch'), clientCtx);

  const clientRow = { 'Order Code': 1001, 'Del. Type': 'Gemi', custom_note_a: '' };
  clientCtx.applyRemoteRowPatch(clientRow, {
    delType: 'Uçak',
    noteColumns: { custom_note_a: 'Uzak not', unknown_col: 'Yok sayılmalı' },
  });
  assert.equal(clientRow.custom_note_a, 'Uzak not');
  assert.equal(clientRow.unknown_col, undefined);
  assert.equal(logisticSynced.length, 1);
  assert.equal(logisticSynced[0].del, 'Uçak');
});

test('Order Importance UI orderSummary satırlarını da günceller ve CP sekmesindeyken Orders çizimini erteler', () => {
  assert.match(OI_UI, /if \(tableKey === 'orderSummary'\) return st\.orderSummary && st\.orderSummary\.rows \|\| \[\];/);
  assert.match(OI_UI, /\[\.\.\.sourceRows\('cp'\), \.\.\.sourceRows\('orders'\), \.\.\.sourceRows\('orderSummary'\)\]/);
  assert.match(OI_UI, /if \(st\.orders && typeof renderOrders === 'function'\) renderOrders\(\);/);
});

test('Collection → Open Costing (ocMetaFromKolRow) onaylı üreticiyi, hedef fiyatı ve model grubu miras alanlarını çözer', () => {
  const context = {
    norm: v => String(v == null ? '' : v).trim(),
    kolEffectiveProjection: r => ({
      ...r,
      season: r.season || '26W',
      country: r.country || 'BANGLADESH',
      lisans: r.lisans || 'DISNEY',
      urunTipi: r.urunTipi || 'SWEATSHIRT',
      confirmedManufacturer: r.confirmedManufacturer || 'CONFIRMED MFR LTD',
    }),
    kolConfirmedPricing: eff => (eff.confirmedManufacturer ? { name: eff.confirmedManufacturer, price: 6.45 } : null),
    String,
  };
  vm.createContext(context);
  vm.runInContext(extractFunction(APP, 'ocMetaFromKolRow'), context);

  const meta = context.ocMetaFromKolRow({
    modelKod: '6W1234Z8',
    colour: 'BLACK',
    plmId: '2109999',
    quantity: 3500,
    targetPrice: '',
    img: '/api/collection-images/test.png',
  });
  assert.equal(meta.manufacturer, 'CONFIRMED MFR LTD');
  assert.equal(meta.country, 'BANGLADESH');
  assert.equal(meta.season, '26W');
  assert.equal(meta.license, 'DISNEY');
  assert.equal(meta.category, 'SWEATSHIRT');
  assert.equal(meta.targetFob, '6.45');
});
