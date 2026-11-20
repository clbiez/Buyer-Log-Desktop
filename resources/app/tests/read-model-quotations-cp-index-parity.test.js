'use strict';
/* #1079 WS6d parite kapısı: CP Fiyat Çalışmaları satır araması (qFindCpRow).
 *
 * Eski yol: her hücre çağrısında tam state.cp.rows üzerinde sipariş → PLM → model
 * sırasıyla doğrusal find. Yeni yol (BL_READ_MODEL_QUOTATIONS, varsayılan açık):
 * okuma kapsamında (qWithCollectionRead) anahtar türü başına ilk eşleşme dizini.
 * GERÇEK public/quotations.js vm'de anahtar kapalı ve açık yüklenir; aynı satırlar ve
 * aynı teklifler için bulunan satır, hedef fiyat, fark, kategori, kumaş, masa
 * sütunları ve Excel dışa aktarma satırları kanonik hash ile karşılaştırılır.
 *
 * CP satırları gerçek yoldan gelir: WS0 demo → parseASASRows / parseAntrepoRows →
 * buildProjections('cp') → sunucu serileştirmesi → JSON.parse. İki yetki kapsamı:
 * moderatör (tümü) ve alıcı (alıcıların yarısı; diğer kapsamdaki siparişler bu
 * kapsamda bulunmaz ve PLM/model geri düşüşü sınanır).
 * 30k: BL_QUOTATION_PARITY_ROWS=2000,30000 (varsayılan 2000). Hash günlüğü: BL_QUOTATION_PARITY_LOG=1.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createTableSearch } = require('./helpers/bl-table-search');
const parity = require('./helpers/read-model-parity.cjs');
const parse = require('../server/lib/parse');
const tasks = require('../server/lib/compute-tasks');
const access = require('../server/lib/compute-access');

const SOURCE = fs.readFileSync(path.join(__dirname, '..', 'public', 'quotations.js'), 'utf8');
const EXPOSE = 'window.__qTest={qFindCpRow,qWithCollectionRead,qItemTargetPrice,qItemCategory,qItemFabricSummary,qDeskFieldValue,qPriceDeltaMarkup,qBuildExportRows,qUpdateModelPricingCells};\n  window.BL_QUOTATIONS={';
const TODAY = '2026-01-15';
const ROW_SIZES = String(process.env.BL_QUOTATION_PARITY_ROWS || '2000').split(',').map(Number).filter(n => n >= 500);
const LOG = process.env.BL_QUOTATION_PARITY_LOG === '1';
const DESK_KEYS = ['productMainDefinition', 'quantity', 'inStoreMonth', 'fabric', 'Season', 'Order Quantity', 'Category', 'Sub-Manufacturer'];

function loadQuotations({ flag, pref, cpRows, user }) {
  assert.equal(SOURCE.split('  window.BL_QUOTATIONS={').length, 2, 'BL_QUOTATIONS ataması tek olmalı');
  const storage = new Map(pref === undefined ? [] : [['buyerlog.readModel.quotations.v1', pref]]);
  const store = { getItem: key => (storage.has(key) ? storage.get(key) : null), setItem: (key, value) => storage.set(key, String(value)), removeItem: key => storage.delete(key) };
  const window = flag === undefined ? {} : { BL_READ_MODEL_QUOTATIONS: flag };
  const context = {
    BLTableSearch: createTableSearch(), console, window,
    document: { getElementById: () => null, body: { dataset: { activeTab: 'cp' } }, addEventListener() {}, removeEventListener() {}, querySelectorAll: () => [] },
    localStorage: store, BLStorage: store,
    fetch: async () => ({ ok: true, status: 200, json: async () => ({ requests: [], profiles: [] }) }),
    appLang: 'tr', kolRows: [], state: { cp: { rows: cpRows }, currentUser: user },
    showToast() {}, setTimeout, clearTimeout, confirm: () => true,
  };
  vm.createContext(context);
  vm.runInContext(SOURCE.replace('  window.BL_QUOTATIONS={', EXPOSE), context, { filename: 'quotations.js' });
  context.window.__qTest.state = context.state;
  return context.window.__qTest;
}

const scopeCache = new Map();
function cpScopes(rows) {
  if (scopeCache.has(rows)) return scopeCache.get(rows);
  const fx = parity.makeFixture({ rows, today: TODAY });
  const asas = parse.parseASASRows(fx.asas).orders, antrepo = parse.parseAntrepoRows(fx.antrepo);
  const src = { loadedAt: 'r1', asasOrders: asas, asasOrdersByTarget: { cp: asas, orders: asas }, antrepoMap: antrepo, lflRows: [] };
  const buyers = [...new Set(asas.map(row => row.buyer))].sort();
  const users = [{ id: 'moderator', all: true, buyers: [] }, { id: 'buyer-a', all: false, buyers: buyers.slice(0, Math.ceil(buyers.length / 2)) }];
  const out = users.map(user => {
    const ctx = access.createAccessContext({ userId: user.id, systemRole: user.all ? 'moderator' : 'buyer', manageAll: user.all,
      viewScope: { all: user.all, mode: user.all ? 'ALL' : 'CUSTOM', buyers: user.buyers }, editScopes: { buyers: user.buyers },
      authority: Object.fromEntries(asas.map(row => [row.ocode, [row]])), profiles: [] });
    const built = tasks.buildProjections(src, { modules: ['cp'], overrides: {}, horizons: {}, access: ctx });
    return { user, rows: JSON.parse(tasks.serialize({ rows: built.cp.rows }, 'projection')).rows };
  });
  // Tüm kapsamın satırları: alıcı kapsamında olmayan siparişler de teklif satırı olur.
  const result = { scopes: out, all: out[0].rows };
  scopeCache.set(rows, result);
  return result;
}

const s = v => String(v == null ? '' : v).trim();
const upper = v => s(v).toLocaleUpperCase('tr-TR');
/* Teklif satırları: recordRequest biçimi + çekişmeli kimlikler. */
function buildRequests(allRows, ownerId) {
  const n = allRows.length, step = Math.max(1, Math.floor(n / 120)), items = [];
  const push = (row, k, patch) => ['Supplier A', 'Supplier B'].forEach((m, mi) => items.push({
    id: `q-${k}-${mi}`, modelKey: `cp:${k}`, rowId: null,
    orderCode: s(row._sourceOrderCode || row['Order Code']), plmId: s(row.plmId || row['PLM ID']), modelCode: s(row.modelKod || row['Model Name']),
    license: s(row.License), category: '', colour: s(row.Colour), colourCode: s(row['C.Code']), fabric: '', season: s(row.Season),
    picture: '', inStoreMonth: '', quantity: Number(row['Order Quantity']) || null,
    manufacturer: m, manufacturerEmail: '', price: mi ? '' : (k % 3 ? '4,25' : '12.80'), approved: false, dropped: false, ...patch }));
  for (let i = 0, k = 0; i < n; i += step, k++) {
    const row = allRows[i];
    switch (k % 8) {
      case 0: push(row, k, {}); break; // birebir sipariş
      case 1: push(row, k, { orderCode: '  ' + upper(row['Order Code']) + ' ' }); break; // boşluk + büyük harf
      case 2: push(row, k, { orderCode: '' }); break; // sipariş yok → PLM (ilk eşleşen sipariş)
      case 3: push(row, k, { orderCode: 'NO-SUCH-ORDER', plmId: upper(row['PLM ID']) }); break; // sipariş ıskalar → PLM
      case 4: push(row, k, { orderCode: '', plmId: '' }); break; // yalnız model
      case 5: push(row, k, { orderCode: 'x', plmId: 'y', modelCode: 'z-yok' }); break; // eşleşme yok
      case 6: push(row, k, { orderCode: null, plmId: undefined, modelCode: ' ' + s(row['Model Name']).toLocaleLowerCase('tr-TR') }); break;
      default: push(row, k, { category: 'Elle Kategori', fabric: 'Elle Kumaş' }); break; // kalem değeri öncelikli
    }
  }
  const base = { source: 'cp', status: 'active', manufacturers: [{ name: 'Supplier A' }, { name: 'Supplier B' }], editorIds: [] };
  return [{ ...base, id: 'own', ownerId, items }, { ...base, id: 'other', ownerId: 'someone-else', items: items.slice(0, 40) }];
}

function snapshot(api, cpRows, requests) {
  const idx = new Map(cpRows.map((row, i) => [row, i]));
  return api.qWithCollectionRead(() => requests.map(req => ({
    id: req.id,
    lines: req.items.map(item => {
      const row = api.qFindCpRow(item);
      return [row ? idx.get(row) : -1, api.qItemTargetPrice(req, item), api.qItemCategory(req, item), api.qItemFabricSummary(req, item),
        api.qPriceDeltaMarkup(req, item), ...DESK_KEYS.map(key => api.qDeskFieldValue(req, item, key))];
    }),
    exportRows: api.qBuildExportRows(req),
  })));
}

function compare(label, legacy, candidate) {
  const left = parity.canonicalHash(legacy), right = parity.canonicalHash(candidate);
  if (LOG) console.log(`[quotation parity] ${label}: ${left === right ? 'OK' : 'FAIL'} ${left.slice(0, 12)}`);
  if (left !== right) assert.fail(`${label}: ${JSON.stringify(parity.firstDivergence(JSON.parse(parity.canonicalJson(legacy)), JSON.parse(parity.canonicalJson(candidate))))}`);
  return left;
}

for (const rows of ROW_SIZES) {
  test(`CP teklif satır araması: dizin eski doğrusal yol ile aynı (${rows} satır, iki yetki kapsamı)`, () => {
    const { scopes, all } = cpScopes(rows);
    for (const { user, rows: cpRows } of scopes) {
      const current = { id: 'owner-1', role: user.all ? 'moderator' : 'buyer' };
      const requests = buildRequests(all, current.id);
      const legacy = snapshot(loadQuotations({ flag: false, cpRows, user: current }), cpRows, requests);
      const candidate = snapshot(loadQuotations({ cpRows, user: current }), cpRows, requests);
      const hash = compare(`${rows} ${user.id}`, legacy, candidate);
      // Fixture çekişmeli olmalı: bulunan, bulunmayan ve PLM/model geri düşüşü birlikte.
      const found = legacy[0].lines.map(line => line[0]);
      assert.ok(found.some(i => i >= 0) && found.some(i => i < 0), `${user.id}: hem bulunan hem bulunmayan satır olmalı (${hash.slice(0, 12)})`);
      if (!user.all) assert.ok(scopes[1].rows.length < scopes[0].rows.length, 'alıcı kapsamı daha dar olmalı');
    }
  });
}

test('dizin ilk eşleşmeyi döndürür; kapsam dışında eski doğrusal yol çalışır; anahtar ve tercih geri dönüşü', () => {
  const rows = [
    { 'Order Code': 'O-1', 'PLM ID': 'P-1', 'Model Name': 'M-1', marker: 'a' },
    { 'Order Code': 'O-2', 'PLM ID': 'P-1', 'Model Name': 'M-1', marker: 'b' },
    { _sourceOrderCode: 'o-3', 'Order Code': 'IGNORED', 'PLM ID': 'P-3', 'Model Name': 'İNCE', marker: 'c' },
    { 'Order Code': 'O-3', 'PLM ID': 'P-9', 'Model Name': 'M-9', marker: 'd' },
    { 'Order Code': '  O-5\t', 'PLM ID': null, 'Model Name': 0, marker: 'e' },
    { 'Order Code': '', _sourceOrderCode: '', 'PLM ID': ' P-6 ', plmId: '', 'Model Name': undefined, modelKod: ' Iİıi ', marker: 'f' },
  ];
  const user = { id: 'u', role: 'moderator' };
  const lines = [{ orderCode: 'O-2' }, { orderCode: '', plmId: 'p-1' }, { modelCode: 'ince' }, { orderCode: 'O-3' }, { orderCode: 'zz', plmId: 'zz', modelCode: 'm-9' }, {},
    { orderCode: 'o-5' }, { plmId: 'p-6' }, { modelCode: 'ıiıi' }, { modelCode: '0' }, { orderCode: '', plmId: '', modelCode: '' }];
  const expected = ['b', 'a', 'c', 'c', 'd', null, 'e', 'f', 'f', 'e', null];
  for (const opts of [{}, { flag: true }, { flag: false }, { pref: '0' }, { flag: true, pref: '0' }]) {
    const api = loadQuotations({ ...opts, cpRows: rows, user });
    const inside = api.qWithCollectionRead(() => lines.map(line => api.qFindCpRow(line)?.marker ?? null));
    const outside = lines.map(line => api.qFindCpRow(line)?.marker ?? null);
    assert.deepEqual(inside, expected, JSON.stringify(opts));
    assert.deepEqual(outside, expected, JSON.stringify(opts));
  }
});

test('okuma kapsamında CP listesi her anahtar türü için en fazla bir kez taranır', () => {
  let reads = 0;
  const rows = Array.from({ length: 500 }, (_, i) => {
    const row = { 'PLM ID': 'P-' + i, 'Model Name': 'M-' + i };
    Object.defineProperty(row, 'Order Code', { enumerable: true, get() { reads++; return 'O-' + i; } });
    return row;
  });
  const lines = Array.from({ length: 200 }, (_, i) => ({ orderCode: 'O-' + (i * 2) }));
  const user = { id: 'u', role: 'moderator' };
  const fast = loadQuotations({ cpRows: rows, user });
  reads = 0;
  fast.qWithCollectionRead(() => lines.forEach(line => { fast.qFindCpRow(line); fast.qFindCpRow(line); }));
  assert.equal(reads, rows.length, 'dizin bir kez kurulmalı');
  const legacy = loadQuotations({ flag: false, cpRows: rows, user });
  reads = 0;
  legacy.qWithCollectionRead(() => lines.forEach(line => legacy.qFindCpRow(line)));
  assert.ok(reads > rows.length * 50, `eski yol satır başına tarar (${reads})`);
});

test('CP listesi değişince (yeni yükleme) dizin aynı okuma içinde bile yeni listeden kurulur', () => {
  const user = { id: 'u', role: 'moderator' };
  const api = loadQuotations({ cpRows: [{ 'Order Code': 'O-1', marker: 'old' }], user });
  const out = api.qWithCollectionRead(() => {
    const before = api.qFindCpRow({ orderCode: 'O-1' })?.marker;
    api.state.cp = { rows: [{ 'Order Code': 'O-1', marker: 'new' }] };
    return [before, api.qFindCpRow({ orderCode: 'O-1' })?.marker];
  });
  assert.deepEqual(out, ['old', 'new']);
  // Sonraki okuma da yeni listeyi görür; kapsam dışında bayat dizin kalmaz.
  assert.equal(api.qWithCollectionRead(() => api.qFindCpRow({ orderCode: 'O-1' })?.marker), 'new');
});
