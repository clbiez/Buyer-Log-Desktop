'use strict';
/* WS6c (#1079) parite kapısı: Backlog Genel Bakış (V3) panel modeli arka uçta.
 *
 * Eski yol (tarayıcı): /api/backlog-export?format=json satırları → JSON.parse →
 *   BLBacklogV3Report.normalizeRows → öncelik dizini (satır başına) → panelModel /
 *   selectItems + drawerPayload.
 * Yeni yol: compute-tasks buildBacklog('v3-items') (hesap işçisi; aynı satırlar,
 *   JSON eşdeğeri klon + aynı normalizeRows) → compute işçisinin serileştirmesi + gzip →
 *   okuma modeli işçisi görevi (backlog-v3-model.execute) → gzip JSON yanıt.
 * Girdi gerçek veri yolundan gelir (generate-demo-data → parseASASRows/parseAntrepoRows).
 * İki yetki kapsamı: ALL (moderatör) ve CUSTOM (iki buyer; compute-access süzmesi) +
 * ek ASAS kaynak sütunları ve bir analiz filtresi. Öncelik etiketleri gerçek
 * BLOrderDecisionEngine ile, deterministik bir dizin isabetiyle.
 * Varsayılan 2k ASAS satırı. Tam kanıt:
 *   BL_BACKLOG_V3_PARITY_ROWS=2000,30000 BL_BACKLOG_V3_PARITY_LOG=1 npm test -- read-model-backlog-v3-parity
 */
const test = require('node:test'), assert = require('node:assert/strict'), zlib = require('node:zlib');
const parity = require('./helpers/read-model-parity.cjs');
const parse = require('../server/lib/parse');
const tasks = require('../server/lib/compute-tasks');
const access = require('../server/lib/compute-access');
const V3 = require('../public/backlog-v3-report.js');
const OD = require('../public/order-decision-engine.js');
const items = require('../server/lib/read-model/backlog-v3-items');
const model = require('../server/lib/read-model/backlog-v3-model');

const COUNTS = String(process.env.BL_BACKLOG_V3_PARITY_ROWS || '2000').split(',').map(Number).filter(n => Number.isSafeInteger(n) && n > 0);
const LOG = process.env.BL_BACKLOG_V3_PARITY_LOG === '1';
const TODAY = parity.DEFAULT_TODAY;

function backlogSource(count) {
  const fixture = parity.makeFixture({ rows: count });
  const orders = parse.parseASASRows(fixture.asas).orders, antrepo = parse.parseAntrepoRows(fixture.antrepo);
  return { orders, source: { loadedAt: 'r1', asasOrders: orders, asasOrdersByTarget: { backlog: orders }, antrepoMap: antrepo, antrepoMapByTarget: { backlog: antrepo }, lflRows: [] } };
}
function scopeContext(orders, all) {
  const buyers = [...new Set(orders.map(order => order.buyer))].sort().slice(0, 2);
  return { buyers, ctx: access.createAccessContext({ userId: 'a', systemRole: all ? 'moderator' : 'buyer', manageAll: all,
    viewScope: { all, mode: all ? 'ALL' : 'CUSTOM', buyers: all ? [] : buyers }, editScopes: { buyers },
    authority: Object.fromEntries(orders.map(order => [order.ocode, [order]])), profiles: [{ id: 'a', username: buyers[0] }] }) };
}
function computeData({ orders, source }, scope, extra = {}) {
  const all = scope === 'all', { ctx, buyers } = scopeContext(orders, all);
  const custom = parse.backlogCustomDimensionContext(access.filterRows(ctx, orders), source.antrepoMap);
  const sourceColumns = all ? [] : custom.customDimensions.filter(column => column.source === 'asas').slice(0, 3).map(column => column.id);
  const columns = custom.customDimensions.filter(column => sourceColumns.includes(column.id));
  // Özel sipariş kapsamı (önem etiketi) gerçek kural yolundan: iki Line değeri BTS etiketli.
  const lines = [...new Set(orders.map(order => order.line).filter(Boolean))].sort().slice(0, 2);
  const overrides = { importanceSettings: { tags: [{ id: 'bts', label: 'BTS' }, { id: 'bayram', label: 'Bayram' }], rules: [{ tagId: 'bts', lines: [lines[0]] }, { tagId: 'bayram', lines: [lines[1]] }] } };
  return { buyers, columns, data: { access: ctx, overrides, horizons: {}, headers: ['Demo'], sourceRevision: 'r', rowsRevision: 'r', calendar: { configured: false }, options: {}, sourceColumns, today: TODAY, ...extra } };
}
// Eski yol: tarayıcının aldığı satırlar (sunucu serileştirmesi + JSON.parse).
function legacyRows(data) { return JSON.parse(tasks.serialize(tasks.buildBacklog('export', data.source, data.data))).rows; }
// Yeni yol: hesap işçisinin yükü (compute-worker compress: serialize 'api' + gzip).
function candidateBuffer(data) { return zlib.gzipSync(Buffer.from(tasks.serialize(tasks.buildBacklog('v3-items', data.source, data.data), 'api'))); }

// Deterministik öncelik dizini isabeti (CP + Siparişler kaynağı, ana öncelik + takip etiketleri).
const CODES = ['', 'CRITICAL', 'ACTION_TODAY', 'ACTION_THIS_WEEK', 'WATCH', 'ON_TRACK'];
function hitFor(orderCode, modelName, colourCode) {
  if (!String(orderCode || '').trim()) return null;
  let h = 0; for (const ch of `${orderCode}|${modelName}|${colourCode}`) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const code = CODES[h % CODES.length]; if (!code) return null;
  return { priority: code, source: h % 3 === 0 ? 'orders' : 'cp', trackingTags: h % 4 === 0 ? ['WATCH'] : h % 5 === 0 ? ['ACTION_THIS_WEEK', code] : [], ...(h % 7 === 0 ? { priorityTags: ['ACTION_TODAY'] } : {}) };
}
const resolveTags = (...args) => OD.resolvePriorityTags(...args);
const RANKS = Object.fromEntries(OD.getPriorityCatalog().map(entry => [entry.id, OD.priorityRank(entry.id)]));
const EMPTY = V3.priorityAnnotation(null, resolveTags);
function legacyItems(rows, ready) {
  const list = V3.normalizeRows(rows, { today: TODAY });
  for (const item of list) V3.applyPriorityAnnotation(item, ready ? V3.priorityAnnotation(hitFor(item.orderCode, item.modelName, item.colourCode), resolveTags) : EMPTY);
  return list;
}
// İstemcinin anahtar listesinden kurduğu tablo (backlog-overview.js priorityPayload ile aynı biçim).
function priorityTable(keys) {
  const table = [], seen = new Map(), index = [];
  for (const key of keys) {
    const [orderCode, modelName, colourCode] = key.split('\u001f');
    const annotation = V3.priorityAnnotation(hitFor(orderCode, modelName, colourCode), resolveTags), sig = JSON.stringify(annotation);
    let at = seen.get(sig); if (at === undefined) { at = table.length; table.push(annotation); seen.set(sig, at); }
    index.push(at);
  }
  return { table, index: index.join(',') };
}
let datasetSeq = 0;
function run(buffer, request, key) {
  const out = model.execute({ datasetKey: key, buffer, request });
  return JSON.parse(zlib.gunzipSync(Buffer.from(out.buffer)).toString('utf8'));
}
// Aynı veri kümesinde önce anahtarlar, sonra öncelik tablosuyla model (istemci akışı).
function candidateModel(buffer, view, ready) {
  const key = 'k' + (++datasetSeq);
  const priority = { ready, empty: EMPTY, ranks: RANKS };
  let out = run(buffer, { view, priority }, key);
  if (ready) {
    assert.equal(out.priority.needKeys, true, 'anahtar listesi istenir');
    const withTable = { ...priority, keysToken: key, ...priorityTable(out.keys) };
    out = run(null, { view, priority: withTable }, key);
    assert.equal(out.priority.ready, true);
    return { key, priority: withTable, out };
  }
  return { key, priority, out };
}
// Yalnız aktarılan alanlar: çekmece satırları ve kimlikler (satırın kendisi kimlik projeksiyonudur).
const drillShape = payload => ({ summary: payload.summary, count: payload.count, rows: payload.rows.map(({ row, ...rest }) => rest) });

const VIEWS = [
  { lang: 'tr', groupBy: 'buyer', timeField: 'exFactory', granularity: 'week', timelineDimension: 'buyingGroup', importanceScope: 'all' },
  { lang: 'en', groupBy: 'priority', timeField: 'retail', granularity: 'month', timelineDimension: 'priority', importanceScope: 'all' },
  { lang: 'tr', groupBy: 'season', timeField: 'antrepo', granularity: 'week', timelineDimension: 'buyer', importanceScope: 'regular' },
  { lang: 'en', groupBy: 'importance', timeField: 'inStore', granularity: 'week', timelineDimension: 'priority', importanceScope: 'special' },
];

for (const count of COUNTS) {
  test(`Backlog V3 panel modeli: arka uç = tarayıcı yolu (${count} ASAS satırı, iki kapsam)`, { timeout: 900000 }, async () => {
    const data = backlogSource(count);
    for (const scope of ['all', 'custom']) {
      const { data: computeParams, buyers, columns } = computeData(data, scope);
      const input = { source: data.source, data: computeParams };
      const rows = legacyRows(input), buffer = candidateBuffer(input);
      if (scope === 'custom') {
        assert.ok(columns.length > 0, 'CUSTOM kapsamı farklı başlık şeması (ek ASAS sütunları) taşır');
        // Yetki: kapsam dışı satır kayıtlara girmez.
        const decoded = items.decodeItems(JSON.parse(zlib.gunzipSync(buffer).toString('utf8'))).items;
        assert.ok(decoded.length > 0 && decoded.length === rows.length);
        assert.ok(decoded.every(item => buyers.includes(item.buyer)), 'yalnız yetkili buyer satırları');
      }
      assert.ok(V3.normalizeRows(rows.slice(0, 4000), { today: TODAY }).some(item => item.special), 'özel sipariş kapsamı sınanır');
      // Kayıtların kendisi (row hariç türetilmiş alanlar) aynı.
      const legacyList = V3.normalizeRows(rows, { today: TODAY }).map(({ row, ...rest }) => rest);
      const candidateList = items.decodeItems(JSON.parse(zlib.gunzipSync(buffer).toString('utf8'))).items.map(({ row, ...rest }) => rest);
      const itemsParity = await parity.assertParity({ name: `items ${scope} ${count}`, legacy: () => legacyList, candidate: () => candidateList });
      if (LOG) console.log(itemsParity.message, `rows=${rows.length}`);
      for (const [vi, view] of VIEWS.entries()) {
        for (const ready of [false, true]) {
          const full = { ...view, today: TODAY };
          const opts = { ...full, priorityReady: ready, ranks: RANKS, filters: [], filterKinds: {} };
          let candidate = null;
          const result = await parity.assertParity({
            name: `model ${scope} ${count} v${vi} priority=${ready}`,
            legacy: () => V3.panelModel(legacyItems(rows, ready), opts),
            candidate: () => { candidate = candidateModel(buffer, full, ready); return candidate.out.model; },
          });
          if (LOG) console.log(result.message, `rows=${rows.length}`);
          // Boş kapsam (ör. özel sipariş yok) da eşit; çizilecek öğe yoksa drill-down denenmez.
          if (!candidate.out.model.count) { assert.equal(candidate.out.model.total, undefined); continue; }
          assert.ok(candidate.out.model.total.qty > 0);
          // Drill-down: her tıklanabilir öğe türünden biri; aynı veri kümesi önbellekten.
          const m = candidate.out.model, specs = [{ k: 'all' }, { k: 'stages', stages: ['IN_TRANSIT', 'CUSTOMS'] }, { k: 'overdue' }, { k: 'special' },
            { k: 'group', dim: m.group.key, ...(m.group.key === 'priority' ? { code: m.group.groups[0].code } : { name: m.group.groups[0].name }), stage: 'PRODUCTION' }];
          if (m.quality.length) specs.push({ k: 'quality', key: m.quality[0].key });
          if (m.special.length) specs.push({ k: 'risk', name: m.special[0].name });
          if (m.priority && m.priority.tags.length) specs.push({ k: 'tags', codes: m.priority.tags.slice(0, 2).map(t => t.code) });
          const bucket = m.timeline.buckets[Math.floor(m.timeline.buckets.length / 2)];
          if (bucket) {
            specs.push({ k: 'bucket', field: m.timeline.field, granularity: m.timeline.granularity, key: bucket.key, stage: 'LOADING' });
            if (bucket.dims[0]) specs.push({ k: 'bucket', field: m.timeline.field, granularity: m.timeline.granularity, key: bucket.key, dim: m.timeline.dimension, ...bucket.dims[0] });
          }
          for (const spec of specs) {
            const drill = await parity.assertParity({
              name: `drill ${scope} ${count} v${vi} ${spec.k}`,
              legacy: () => drillShape(V3.drawerPayload(V3.selectItems(legacyItems(rows, ready), spec, opts), model.ROW_LIMIT)),
              candidate: () => drillShape(run(null, { view: full, priority: candidate.priority, drill: spec }, candidate.key)),
            });
            if (LOG && vi === 0 && !ready) console.log(drill.message);
          }
        }
      }
    }
  });
}

test('Backlog V3 panel modeli: analiz filtresi (değer ve tarih) ve çekmece kimlikleri eski yolla aynı', async () => {
  const data = backlogSource(400);
  const { data: computeParams } = computeData(data, 'all');
  const sample = legacyRows({ source: data.source, data: computeParams });
  const buyer = sample.find(row => row.Buyer)?.Buyer, dateKey = Object.keys(sample[0]).find(key => /Retail Depo Tarih/.test(key));
  assert.ok(buyer && dateKey);
  const filters = [{ id: 'cp:Buyer', source: 'cp', header: 'Buyer', rowKey: 'Buyer', label: 'Buyer', values: [buyer], from: '', to: '' },
    { id: 'cp:' + dateKey, source: 'cp', header: dateKey, rowKey: dateKey, label: dateKey, values: [], from: '2025-06-01', to: '2027-12-31' }];
  // Sunucu export'u analiz filtresini zaten uygular; panel aynı filtreyi satır anahtarıyla tekrar uygular.
  const input = { source: data.source, data: { ...computeParams, options: { analysisFilters: JSON.stringify(filters) } } };
  const rows = legacyRows(input), buffer = candidateBuffer(input);
  for (const filterKinds of [{}, { 'cp:Buyer': 'values', ['cp:' + dateKey]: 'date' }]) {
    const view = { ...VIEWS[0], today: TODAY, filters, filterKinds };
    const opts = { ...view, priorityReady: false, ranks: RANKS };
    let key = null;
    await parity.assertParity({ name: 'model filters', legacy: () => V3.panelModel(legacyItems(rows, false), opts),
      candidate: () => { const out = candidateModel(buffer, view, false); key = out.key; return out.out.model; } });
    // Çekmece kimliği: projeksiyonlu satırdan okunan kanonik kimlik tam satırla aynı (sıra korunur).
    const legacyPayload = V3.drawerPayload(V3.selectItems(legacyItems(rows, false), { k: 'all' }, opts), model.ROW_LIMIT);
    const drill = run(null, { view, priority: { ready: false, empty: EMPTY }, drill: { k: 'all' } }, key);
    const canonical = require('../server/lib/canonical-fields');
    // Kimlik: kanonik alanlar + çekmecenin birebir okuduğu anahtarlar + kayıt alanları.
    const identity = it => JSON.stringify([items.IDENTITY_FIELDS.map(id => canonical.canonicalValue(it.row, 'backlog', id) ?? null),
      items.DRAWER_ROW_KEYS.map(k => it.row?.[k] ?? null), ['orderCode', 'modelName', 'colourCode', 'colour', 'season'].map(k => it[k])]);
    assert.equal(drill.count, legacyPayload.count);
    assert.equal(drill.rows.length, Math.min(model.ROW_LIMIT, legacyPayload.count));
    // Projeksiyonlu satır kimliği değiştirmez; yinelenen kimlik yalnız ilk sırasıyla taşınır.
    const firstIndex = new Map();
    legacyPayload.list.forEach((item, index) => { const sig = identity(item); if (!firstIndex.has(sig)) firstIndex.set(sig, index); });
    assert.deepEqual(drill.identities.map(([index, item]) => [index, identity(item)]), [...firstIndex].map(([sig, index]) => [index, sig]));
    drill.rows.forEach((row, index) => assert.equal(identity(row), identity(legacyPayload.rows[index])));
  }
});

test('Backlog V3 kayıtları: JSON eşdeğeri klon sunucu serileştirmesi + JSON.parse ile aynı', () => {
  const data = backlogSource(300);
  const { data: computeParams } = computeData(data, 'custom');
  const out = tasks.buildBacklog('export', data.source, computeParams);
  const apiDate = value => JSON.parse(tasks.serialize({ v: value })).v;
  const expected = JSON.parse(tasks.serialize(out.rows));
  assert.deepEqual(out.rows.map(row => items.jsonValue(row, apiDate)), expected);
  // Şema başına derlenmiş klon: aynı sonuç; anahtar adları (Excel başlıkları) kod olarak çalışmaz.
  const clone = items.createRowCloner(apiDate);
  assert.deepEqual(out.rows.map(clone), expected);
  const hostile = [{ 'a"b': 1, "c'd": 2, 'e\n(F)': new Date(2026, 0, 2), '\u2028x': 'y', '1': 'n', '`${process.exit(1)}`': 'z', '];process.exit(1);//': 3 },
    { 'a"b': undefined, "c'd": 2 }, { __proto__: null, ok: 1 }, Object.defineProperty({ ok: 2 }, '__proto__', { value: { polluted: true }, enumerable: true }),
    { nested: { d: new Date('2026-03-09T21:00:00.000Z'), f: () => 1 }, arr: [undefined, NaN] }, null, 'text', [1, 2]];
  assert.deepEqual(hostile.map(clone), hostile.map(row => JSON.parse(tasks.serialize(row))));
  assert.equal(({}).polluted, undefined, 'prototip kirlenmez');
  // Çekişmeli değerler: undefined/işlev düşer, NaN/Infinity → null, dizi boşluğu → null, toJSON, kutulu ilkeller, geçersiz tarih.
  const tricky = { a: undefined, b: () => 1, c: NaN, d: Infinity, e: [1, undefined, () => 2, new Date('2026-03-09T21:00:00.000Z')], f: { toJSON: () => 'x' },
    g: new Number(3), h: new String('s'), i: new Boolean(false), j: new Date('x'), k: new Map([[1, 2]]), l: null, m: { n: { o: new Date(2026, 0, 2) } }, sym: Symbol('s') };
  assert.deepEqual(items.jsonValue(tricky, apiDate), JSON.parse(tasks.serialize(tricky)));
});

test('Backlog V3 okuma modeli: geçersiz öncelik tablosu modeli bozmaz; veri kümesi düşerse yük istenir', () => {
  const data = backlogSource(200);
  const { data: computeParams } = computeData(data, 'all');
  const buffer = candidateBuffer({ source: data.source, data: computeParams });
  const view = { ...VIEWS[0], today: TODAY };
  const first = run(buffer, { view, priority: { ready: true, empty: EMPTY, ranks: RANKS } }, 'bad');
  assert.equal(first.priority.needKeys, true);
  // Yanlış belirteç, eksik/aralık dışı indeks: öncelik hazır sayılmaz, anahtarlar yeniden istenir.
  for (const bad of [{ keysToken: 'other', ...priorityTable(first.keys) }, { keysToken: 'bad', table: [], index: '0' }, { keysToken: 'bad', table: [{}], index: first.keys.map(() => 5).join(',') }]) {
    const out = run(null, { view, priority: { ready: true, empty: EMPTY, ranks: RANKS, ...bad } }, 'bad');
    assert.equal(out.priority.ready, false); assert.equal(out.priority.needKeys, true); assert.equal(out.model.priority, undefined);
  }
  assert.deepEqual(model.execute({ datasetKey: 'never-sent', request: { view } }), { missing: true });
  assert.throws(() => model.execute({ request: { view } }), /Invalid Backlog V3 request/);
});
