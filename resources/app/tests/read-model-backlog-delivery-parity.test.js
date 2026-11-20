'use strict';
/* WS6c (#1079) parite kapısı: Backlog Teslimat Riski paneli arka uçta.
 *
 * Eski yol (tarayıcı): /api/backlog-export satırları → Engine.projectRow + tarih anahtarı
 *   başına istemci dateOrdinal → Web Worker (varsayılan öncelik kataloğu) analyzeDataset →
 *   ana iş parçacığında (kullanıcı kataloğu) needsAttention, Insights.build, parityTotals;
 *   drill-down: seçilen siparişlerin sourceRow'u (tam export satırı).
 * Yeni yol: compute-tasks 'v3-items' (aynı satırların motor izdüşümü) → okuma modeli işçisi
 *   (backlog-v3-model, panel 'delivery'): tarih anahtarları istemciye gider, sıralar geri
 *   gelir; drill-down satır sıraları → compute-tasks 'rows' (aynı tam satırlar).
 * İki kapsam (ALL, CUSTOM + ek ASAS sütunları), iki hedef, dönem süzmesi, iki dil, özel
 * yorum kuralı ve kullanıcıya özel öncelik kataloğu. Varsayılan 2k; tam kanıt:
 *   BL_BACKLOG_V3_PARITY_ROWS=2000,30000 BL_BACKLOG_V3_PARITY_LOG=1 npm test -- read-model-backlog-delivery
 */
const test = require('node:test'), assert = require('node:assert/strict'), zlib = require('node:zlib');
const parity = require('./helpers/read-model-parity.cjs');
const parse = require('../server/lib/parse');
const tasks = require('../server/lib/compute-tasks');
const access = require('../server/lib/compute-access');
const Engine = require('../public/backlog-delivery-engine.js');
const Insights = require('../public/backlog-delivery-insights.js');
const OD = require('../public/order-decision-engine.js');
const model = require('../server/lib/read-model/backlog-v3-model');
const items = require('../server/lib/read-model/backlog-v3-items');

const COUNTS = String(process.env.BL_BACKLOG_V3_PARITY_ROWS || '2000').split(',').map(Number).filter(n => Number.isSafeInteger(n) && n > 0);
const LOG = process.env.BL_BACKLOG_V3_PARITY_LOG === '1';
const TODAY = parity.DEFAULT_TODAY;

function backlogSource(count) {
  const fixture = parity.makeFixture({ rows: count });
  const orders = parse.parseASASRows(fixture.asas).orders, antrepo = parse.parseAntrepoRows(fixture.antrepo);
  return { orders, source: { loadedAt: 'r1', asasOrders: orders, asasOrdersByTarget: { backlog: orders }, antrepoMap: antrepo, antrepoMapByTarget: { backlog: antrepo }, lflRows: [] } };
}
function computeData({ orders, source }, scope) {
  const all = scope === 'all', buyers = [...new Set(orders.map(order => order.buyer))].sort().slice(0, 2);
  const ctx = access.createAccessContext({ userId: 'a', systemRole: all ? 'moderator' : 'buyer', manageAll: all, viewScope: { all, mode: all ? 'ALL' : 'CUSTOM', buyers: all ? [] : buyers },
    editScopes: { buyers }, authority: Object.fromEntries(orders.map(order => [order.ocode, [order]])), profiles: [{ id: 'a', username: buyers[0] }] });
  const custom = parse.backlogCustomDimensionContext(access.filterRows(ctx, orders), source.antrepoMap);
  const sourceColumns = all ? [] : custom.customDimensions.filter(column => column.source === 'asas').slice(0, 3).map(column => column.id);
  return { buyers, data: { access: ctx, overrides: {}, horizons: {}, headers: ['Demo'], sourceRevision: 'r-' + scope, rowsRevision: 'r', calendar: { configured: false }, options: {}, sourceColumns, today: TODAY } };
}
// Kullanıcıya özel katalog: sıralar değişik (aksiyon grubu sırası ana iş parçacığında bu katalogla).
const CATALOG = OD.normalizePriorityCatalog([
  { id: 'WATCH', tr: 'İzle', en: 'Watch' }, { id: 'CRITICAL', tr: 'Kritik', en: 'Critical' },
  { id: 'ACTION_THIS_WEEK', tr: 'Bu hafta', en: 'This week' }, { id: 'ACTION_TODAY', tr: 'Bugün', en: 'Today' }, { id: 'ON_TRACK', tr: 'Yolunda', en: 'On track' }]);
const ordinalOf = Engine.defaultOrdinal;
const RULES = [Insights.normalizeRule({ name: 'Çin riskli', conditions: [{ field: 'country', operator: 'eq', value: 'China' }, { field: 'deliveryOutcome', operator: 'eq', value: 'AT_RISK' }], severity: 'warning', message: 'Çin {orders}' }, 0)];

function legacy(rows, inputs) {
  const projected = rows.map(row => Engine.projectRow(row)), map = new Map();
  for (const row of rows) for (const value of Engine.rowDateValues(row)) map.set(Engine.dateKey(value), ordinalOf(value));
  const ordinal = value => map.get(Engine.dateKey(value)) ?? null;
  OD.setPriorityCatalog(null);
  const result = Engine.analyzeDataset(projected, { settings: inputs.settings, bounds: inputs.bounds, today: inputs.today, dateOrdinal: ordinal });
  OD.setPriorityCatalog(CATALOG);
  try {
    const groups = Engine.needsAttention(result.model, { limit: 500 });
    const insights = Insights.build(result.model, { lang: inputs.lang, preferences: inputs.preferences, customRules: inputs.customRules });
    const { orders, topRiskOrders, ...rest } = result.model;
    const sourceRows = new Map(result.model.orders.map((order, index) => [order, rows[result.rowIndices[index]]]));
    const drill = spec => Engine.selectOrders(result.model, spec).map(order => sourceRows.get(order));
    return { out: { model: { ...rest, orders: [], topRiskOrders: [], orderCount: orders.length }, attention: { counts: groups.counts, quantities: groups.quantities },
      insights: insights.map(({ orders: _, ...insight }) => insight), periodRowCount: result.periodRowCount, totalRowCount: result.totalRowCount, parity: Engine.parityTotals(projected) }, drill, model: result.model };
  } finally { OD.setPriorityCatalog(null); }
}
// context.generatedAt analiz anının zaman damgasıdır (her koşuda farklı); karşılaştırmadan çıkarılır.
const timeless = out => ({ ...out, model: { ...out.model, context: { ...out.model.context, generatedAt: '<time>' } } });
const strip = body => { const { kind, dataset, ...rest } = body; return timeless(rest); };
function run(buffer, request, key) { return JSON.parse(zlib.gunzipSync(Buffer.from(model.execute({ datasetKey: key, buffer, request }).buffer)).toString('utf8')); }
let seq = 0;
function candidate(buffer, inputs) {
  const key = 'd' + (++seq);
  const request = { panel: 'delivery', delivery: { ...inputs, catalog: CATALOG, ordinals: null } };
  const first = run(buffer, request, key);
  assert.equal(first.needDates, true, 'tarih anahtarları istemciye sorulur');
  // İstemci: anahtardan değeri kurar, kendi dateOrdinal'ını çalıştırır.
  for (const dateKey of first.dateKeys) assert.equal(Engine.dateKey(Engine.valueOfDateKey(dateKey)), dateKey, 'anahtar değere geri döner: ' + dateKey);
  request.delivery.ordinals = { token: key, values: first.dateKeys.map(dateKey => { const v = ordinalOf(Engine.valueOfDateKey(dateKey)); return Number.isFinite(v) ? v : null; }) };
  return { key, request, body: run(null, request, key) };
}

for (const count of COUNTS) {
  test(`Teslimat Riski: arka uç analizi = tarayıcı işçisi + ana iş parçacığı (${count} ASAS satırı, iki kapsam)`, { timeout: 900000 }, async () => {
    const data = backlogSource(count);
    for (const scope of ['all', 'custom']) {
      const { data: computeParams, buyers } = computeData(data, scope);
      tasks._clearRowsMemo();
      const rows = JSON.parse(tasks.serialize(tasks.buildBacklog('export', data.source, computeParams))).rows;
      const buffer = zlib.gzipSync(Buffer.from(tasks.serialize(tasks.buildBacklog('delivery-items', data.source, computeParams), 'api')));
      // İzdüşüm: tarayıcı işçisine yüklenen nesnelerin aynısı (undefined alanlar dahil, yapılandırılmış klon gibi).
      assert.deepStrictEqual(items.decodeItems(JSON.parse(zlib.gunzipSync(buffer).toString('utf8'))).delivery, rows.map(row => Engine.projectRow(row)));
      if (scope === 'custom') assert.ok(rows.length > 0 && rows.every(row => buyers.includes(row.Buyer)), 'yalnız yetkili buyer satırları');
      const today = ordinalOf(TODAY + 'T12:00:00');
      const variants = [
        { settings: { ...Engine.DEFAULT_SETTINGS, targetType: 'retail' }, bounds: null, today, lang: 'tr', preferences: Insights.defaultPreferences(), customRules: [] },
        { settings: { ...Engine.DEFAULT_SETTINGS, targetType: 'inStore', requireTransitRule: false }, bounds: { from: today - 30, to: today + 120 }, today, lang: 'en', preferences: Insights.defaultPreferences(), customRules: RULES },
      ];
      for (const [vi, inputs] of variants.entries()) {
        const old = legacy(rows, inputs);
        let cand;
        const result = await parity.assertParity({ name: `delivery ${scope} ${count} v${vi}`, legacy: () => timeless(old.out), candidate: () => { cand = candidate(buffer, inputs); return strip(cand.body); } });
        if (LOG) console.log(result.message, `rows=${rows.length}`);
        assert.ok(old.out.model.orderCount > 0);
        const specs = [{ k: 'outcome', key: 'AT_RISK' }, { k: 'outcome', key: 'ON_TRACK' }, { k: 'cause', key: (old.model.rootCauses[0] || {}).key || 'TRANSIT_DELAY' },
          ...['CRITICAL', 'ACTION_TODAY', 'WATCH'].map(key => ({ k: 'attention', key })),
          ...old.model.stages.slice(0, 3).map(stage => ({ k: 'stageOutcome', stage: stage.key, outcome: Engine.OUTCOMES.find(key => stage.outcomes[key].rows > 0) })),
          ...old.model.dimensions.buyer.slice(0, 2).map(bucket => ({ k: 'dimOutcome', dim: 'buyer', value: bucket.name, outcome: Engine.OUTCOMES.find(key => bucket.outcomes[key].rows > 0) }))];
        assert.ok(specs.filter(spec => spec.k === 'stageOutcome' || spec.k === 'dimOutcome').length >= 3);
        assert.ok(old.out.insights.some(insight => insight.custom) || vi === 0, 'özel yorum kuralı değerlendirilir');
        for (const spec of specs) {
          const drill = await parity.assertParity({
            name: `delivery drill ${scope} ${count} v${vi} ${spec.k}`,
            legacy: () => old.drill(spec),
            candidate: () => {
              const indices = run(null, { ...cand.request, drill: spec }, cand.key).indices;
              return JSON.parse(tasks.serialize(tasks.buildBacklog('rows', data.source, { ...computeParams, rowIndices: indices }))).rows;
            },
          });
          if (LOG && vi === 0) console.log(drill.message);
        }
      }
    }
    tasks._clearRowsMemo();
  });
}

test('Teslimat Riski okuma modeli: geçersiz tarih sözlüğü analize girmez; katalog değişikliği işçiye sızmaz', () => {
  const data = backlogSource(200);
  const { data: computeParams } = computeData(data, 'all');
  const buffer = zlib.gzipSync(Buffer.from(tasks.serialize(tasks.buildBacklog('delivery-items', data.source, computeParams), 'api')));
  assert.throws(() => model.execute({ datasetKey: 'bad-dates', buffer, request: { view: {} } }), /Invalid Backlog V3 request/, 'V3 isteği Teslimat Riski veri kümesini kullanamaz');
  model._datasets.clear();
  const inputs = { settings: Engine.DEFAULT_SETTINGS, bounds: null, today: 20000, lang: 'tr', catalog: CATALOG };
  const first = run(buffer, { panel: 'delivery', delivery: inputs }, 'bad-dates');
  for (const ordinals of [{ token: 'other', values: first.dateKeys.map(() => 1) }, { token: 'bad-dates', values: [1] }, { token: 'bad-dates', values: first.dateKeys.map(() => 'x') }]) {
    const out = run(null, { panel: 'delivery', delivery: { ...inputs, ordinals } }, 'bad-dates');
    assert.equal(out.needDates, true); assert.equal(out.model, undefined);
  }
  const before = JSON.stringify(OD.getPriorityCatalog());
  run(null, { panel: 'delivery', delivery: { ...inputs, ordinals: { token: 'bad-dates', values: first.dateKeys.map(() => 20000) } } }, 'bad-dates');
  assert.equal(JSON.stringify(OD.getPriorityCatalog()), before, 'işçinin kataloğu geri yüklenir');
});
