'use strict';
/* WS6c (#1079): Teslimat Riski paneli istemcisi — okuma modeli yolu (anahtar açık).
 * Satır listesi ve tarayıcı işçisi kullanılmaz; tarih sırası bu tarayıcının dateOrdinal'ı;
 * Genel Bakış isteği beklenir; eski yanıt yenisini ezmez; drill-down satırları tıklanınca gelir. */
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const Engine = require('../public/backlog-delivery-engine.js');
const Insights = require('../public/backlog-delivery-insights.js');
const OD = require('../public/order-decision-engine.js');
const V3 = require('../public/backlog-v3-report.js');
const SOURCE = fs.readFileSync(path.join(__dirname, '../public/backlog-delivery-analysis.js'), 'utf8');

function harness({ gate = null } = {}) {
  const requests = [], pending = [], drawers = [], toasts = [];
  const host = { hidden: false, innerHTML: '', querySelectorAll: () => [], querySelector: () => null };
  const fetch = (url, init = {}) => new Promise((resolve, reject) => {
    const body = init.body ? JSON.parse(init.body) : null;
    requests.push({ url: String(url), body });
    pending.push({ url: String(url), body, reply: data => resolve({ ok: true, status: 200, json: async () => data }), fail: reject });
  });
  const context = {
    window: { BL_READ_MODEL_BACKLOG_V3: true, BLBacklogDeliveryEngine: Engine, BLBacklogDeliveryInsights: Insights, BLBacklogV3Report: V3, BLOrderDecisionEngine: OD,
      BLBacklogOverview: { modelGate: () => gate }, BLDetailDrawer: { open: spec => drawers.push(spec) } },
    document: { readyState: 'complete', addEventListener() {}, getElementById: id => (id === 'backlogAnalysis' ? host : null), baseURI: 'http://localhost/' },
    Worker: class { constructor() { throw new Error('tarayıcı işçisi kullanılmamalı'); } }, URL, fetch, BLStorage: { getItem: () => null, setItem() {} },
    backlogExportQueryParams: () => ({ format: 'json', groupBy: 'status' }), dateOrdinal: value => (value == null || value === '' ? null : Engine.defaultOrdinal(value) + 1000),
    showToast: message => toasts.push(message), setTimeout, clearTimeout, Date, console, JSON, AbortController, Promise,
  };
  context.window.window = context.window;
  vm.createContext(context);
  vm.runInContext(SOURCE, context);
  // Yüklemede init() bir yenileme başlatır; testler kendi yenilemelerinden başlar (o istek eskir).
  return { view: context.window.BLBacklogAnalysis, requests, pending, drawers, toasts, ready: async () => { await turn(); requests.splice(0); pending.splice(0); } };
}
const turn = () => new Promise(resolve => setTimeout(resolve, 5));
const MODEL = { orders: [], topRiskOrders: [], orderCount: 2, totals: { qty: 10, orders: 2, rows: 2 }, deliveryOutcome: Object.fromEntries(Engine.OUTCOMES.map(key => [key, { qty: 0, orders: 0, rows: 0, qtyShare: 0 }])),
  rootCauses: [], stages: [], dimensions: {}, dataQuality: { missing: [], transitRule: null } };

test('anahtar açık: Genel Bakış ilk yanıtını bekler, tarih sözlüğünü bu tarayıcının dateOrdinal\'ıyla doldurur, satır indirmez', async () => {
  let release; const gate = new Promise(resolve => { release = resolve; });
  const h = harness({ gate }); await h.ready();
  void h.view.refresh(false); await turn();
  assert.equal(h.requests.length, 0, 'Genel Bakış isteği bitmeden gönderilmez');
  release(); await turn();
  assert.equal(h.requests.length, 1); assert.equal(h.requests[0].url, '/api/read-model/backlog/delivery');
  assert.equal(h.requests[0].body.view.today, V3.dayIso(new Date()), 'Genel Bakış ile aynı gün → aynı satır belleği anahtarı');
  h.pending.shift().reply({ needDates: true, dataset: 'ds1', dateKeys: ['string:2026-02-01', 'object:null', 'number:46000'] });
  await turn();
  const ordinals = h.requests[1].body.delivery.ordinals;
  assert.deepEqual(ordinals, { token: 'ds1', values: [Engine.defaultOrdinal('2026-02-01') + 1000, null, Engine.defaultOrdinal(46000) + 1000] });
  h.pending.shift().reply({ kind: 'delivery', model: MODEL, attention: { counts: {}, quantities: {} }, insights: [], periodRowCount: 2, totalRowCount: 2, parity: { qty: 10, orders: 2 } });
  await turn();
  assert.equal(h.view._state.model.orderCount, 2); assert.equal(h.view._state.loading, false); assert.equal(h.view._state.rows, null);
  assert.ok(h.requests.every(request => !request.url.includes('backlog-export')));
  // Ayar değişince sözlük yeniden istenmez (aynı veri kümesi belirteci gönderilir).
  void h.view.refresh(false); await turn();
  assert.deepEqual(h.requests.at(-1).body.delivery.ordinals, ordinals);
});

test('anahtar açık: eski yanıt yenisinin yerine geçmez; drill-down satırları tıklanınca yüklenir', async () => {
  const h = harness(); await h.ready();
  void h.view.refresh(false); await turn();
  const old = h.pending.shift();
  void h.view.refresh(true); await turn();
  const current = h.pending.shift();
  current.reply({ kind: 'delivery', model: { ...MODEL, orderCount: 7 }, attention: { counts: {}, quantities: {} }, insights: [], periodRowCount: 7, totalRowCount: 7, parity: { qty: 1, orders: 1 } });
  await turn();
  old.reply({ kind: 'delivery', model: { ...MODEL, orderCount: 1 }, attention: { counts: {}, quantities: {} }, insights: [], periodRowCount: 1, totalRowCount: 1, parity: { qty: 1, orders: 1 } });
  await turn();
  assert.equal(h.view._state.error, '', String(h.view._state.error));
  assert.equal(h.view._state.model.orderCount, 7);
  const drillSource = SOURCE.slice(SOURCE.indexOf('function openDrill('), SOURCE.indexOf('function openRows('));
  assert.match(drillSource, /loadRemote\(\{ drill: spec \}\)/);
  for (const spec of ["{ k: 'outcome', key }", "{ k: 'cause', key }", "{ k: 'attention', key }", "{ k: 'stageOutcome', stage, outcome }", "{ k: 'dimOutcome', dim: state.dim, value: dimValue, outcome }"])
    assert.ok(SOURCE.includes(spec), 'drill-down tanımı: ' + spec);
});

test('anahtar kapalı: eski yol (satır listesi + tarayıcı işçisi) aynen kalır', () => {
  const refresh = SOURCE.slice(SOURCE.indexOf('  async function refresh(force) {'), SOURCE.indexOf('  /* -------------------------------------------------------------- drilldown */'));
  assert.match(refresh, /if \(backendModelEnabled\(\)\) return refreshRemote\(force\);/);
  assert.match(refresh, /const rows=await fetchRows\(\);/);
  assert.match(SOURCE, /function openDrill\(title, spec, local\) \{\n    if \(!backendModelEnabled\(\)\) \{ openOrders\(title, local\(\)\); return; \}/);
});
