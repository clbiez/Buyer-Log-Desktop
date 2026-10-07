'use strict';
// Regression (7.0.251): Yenile (33 bin siparişlik demo veri, değişen içerik)
// 58 sn sürüyordu; Excel dışı iç işler ~34 sn'ydi:
//  - model snapshot aynı veriyi iki kez sıkıştırıp serileştiriyor/hash'liyor,
//    açılışta da yüklenen snapshot için aynı işi tekrarlıyordu,
//  - değişmemiş içerik kontrolü değişen yenilemede bile iki tam hash alıyordu,
//  - sayfa önbelleği tek işçide, alan başına replacer'lı JSON ile yazılıyordu,
//  - Planlanan & Gerçekleşen zaman işareti yenilemenin bitişini bekletiyordu.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'buyerlog-refresh-perf-251-'));
process.env.BUYER_LOG_LOCAL_DATA_ROOT = root;
const snapshots = require('../server/lib/model-snapshot');
const { sameJson, unchangedRefreshSummary } = require('../server/lib/refresh-content-equality');
const { runProjectionWorker, splitPlan } = require('../server/lib/projection-worker-client');
test.after(() => fs.rmSync(root, { recursive: true, force: true }));
const read = rel => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');

test('member-wise source equality matches full JSON equality and stops early on change', () => {
  const samples = [
    [[{ a: 1, d: new Date(0) }, { b: [1, 2] }], [{ a: 1, d: new Date(0) }, { b: [1, 2] }]],
    [[{ a: 1 }], [{ a: 1, extra: undefined }]],
    [[{ a: 1, b: 2 }], [{ b: 2, a: 1 }]],
    [{ 10: { q: 1 }, x: null }, { 10: { q: 1 }, x: null }],
    [{ 10: { q: 1 } }, { 10: { q: 2 } }],
    [[1, undefined, null], [1, null, null]],
    [[], {}],
  ];
  for (const [a, b] of samples) assert.equal(sameJson(a, b), JSON.stringify(a) === JSON.stringify(b), JSON.stringify([a, b]));
  let touched = 0;
  const trap = { toJSON() { touched++; return 'x'; } };
  assert.equal(sameJson([{ v: 1 }, trap], [{ v: 2 }, trap]), false);
  assert.equal(touched, 0, 'the first differing row ends the comparison');
  assert.equal(unchangedRefreshSummary([{ ocode: 1 }], {}, [{ ocode: 2 }], {}), null);
});

const payload = (model = 'DEMO', loadedAt = '2026-10-06T10:00:00.000Z') => {
  const orders = [{ ocode: 1, model, date: new Date('2026-10-05T21:00:00.000Z') }];
  return { asasOrders: orders, asasOrdersByTarget: { cp: orders, orders }, antrepoMap: {}, lflRows: [{ model }], loadedAt };
};

test('snapshot header carries the content key so a cold start can reuse unchanged data without re-hashing', async () => {
  const first = await snapshots.saveModelSnapshotAsync('cold', payload());
  const text = zlib.gunzipSync(fs.readFileSync(first.file)).toString('utf8');
  assert.match(text, /^\{"schemaVersion":2,"checksum":"[0-9a-f]{64}","contentKey":"[0-9a-f]{64}","payload":\{/);
  const loaded = await snapshots.loadModelSnapshotAsync('cold');
  assert.ok(loaded.asasOrders[0].date instanceof Date);
  assert.equal(loaded.asasOrdersByTarget.cp, loaded.asasOrders);
  // Simulate a fresh process: forget in-memory verification, then cold-load.
  delete require.cache[require.resolve('../server/lib/model-snapshot')];
  const fresh = require('../server/lib/model-snapshot');
  await fresh.loadModelSnapshotAsync('cold');
  const again = await fresh.saveModelSnapshotAsync('cold', payload('DEMO', '2026-10-06T11:00:00.000Z'));
  assert.equal(again.reused, true, 'unchanged content after a cold load reuses the verified file');
  assert.equal((await fresh.loadModelSnapshotAsync('cold')).loadedAt, '2026-10-06T11:00:00.000Z');
  assert.equal((await fresh.saveModelSnapshotAsync('cold', payload('OTHER'))).reused, false);
});

test('snapshots written by older versions (no content key) still load', async () => {
  const body = JSON.stringify({ savedAt: '2026-10-01T00:00:00.000Z', ...payload('LEGACY') });
  const digest = require('node:crypto').createHash('sha256').update(body).digest('hex');
  fs.mkdirSync(path.dirname(snapshots.snapshotPath('legacy')), { recursive: true });
  fs.writeFileSync(snapshots.snapshotPath('legacy'), zlib.gzipSync(`{"schemaVersion":2,"checksum":"${digest}","payload":${body}}`));
  const loaded = await snapshots.loadModelSnapshotAsync('legacy');
  assert.equal(loaded.asasOrders[0].model, 'LEGACY');
  assert.equal((await snapshots.saveModelSnapshotAsync('legacy', payload('LEGACY'))).reused, false, 'without a stored key the first save is a full write');
});

test('snapshot writes validate by byte round-trip instead of re-parsing the whole snapshot', () => {
  const source = read('server/lib/model-snapshot.js');
  assert.match(source, /assertRoundTrip\(raw, encoded\);/);
  assert.doesNotMatch(source, /splitSnapshotPayload/);
  assert.throws(() => snapshots.saveModelSnapshot('bad', { asasOrders: null }), /Snapshot ana sipariş verisi eksik/);
});

const rows = Array.from({ length: 6000 }, (_, i) => ({ ocode: 100000 + (i % 3000), kalan: i % 3 ? 10 : 0, qty: 20, antrepo: 10, fob: 5.25, license: 'Marvel',
  manufacturer: 'Demo ' + (i % 7), season: 'S1', countryRaw: 'TURKIYE', category: 'Cat', model: `Model ${i % 900}`, ccode: `C${i % 40}`, colour: 'Red',
  opd: new Date(2026, 0, 1), ex: new Date(2026, 0, 5 + (i % 20)), retail: new Date(2026, 0, 10), mb: new Date(2026, 0, 12) }));
const base = { cpSource: rows, ordersSource: rows, cpAntrepo: {}, ordersAntrepo: {}, overrides: {}, shared: true, orderSummaryAllowed: true, editableOrderCodes: rows.map(r => r.ocode) };
const decode = entry => JSON.parse(zlib.gunzipSync(Buffer.from(entry.buffer)));

test('page projections built by two parallel workers are identical to single-module builds', async () => {
  const plan = splitPlan(base);
  if ((os.availableParallelism ? os.availableParallelism() : os.cpus().length) >= 3) {
    assert.deepEqual(plan, { primary: ['cp', 'orders', 'collection-catalog'], summary: ['overview', 'order-summary'] });
  }
  assert.equal(splitPlan({ ...base, cpSource: rows.slice(0, 10), ordersSource: rows.slice(0, 10) }), null, 'small data stays in one worker');
  assert.equal(splitPlan({ ...base, modules: ['cp'] }), null);
  const all = await runProjectionWorker(base);
  assert.deepEqual(Object.keys(all.compressed).sort(), ['collection-catalog', 'cp', 'order-summary', 'orders', 'overview']);
  for (const module of Object.keys(all.compressed)) {
    const single = await runProjectionWorker({ ...base, modules: [module] });
    assert.deepEqual(decode(all.compressed[module]), decode(single.compressed[module]), module);
  }
  assert.equal(all.metrics.orderSummaryRows, 6000);
});

test('projection worker serialises dates as local YYYY-MM-DD without a per-field replacer', () => {
  const worker = read('server/projection-worker.js');
  assert.match(worker, /const converted=replaceDatesInPlace\(value,new WeakSet\(\)\);/);
  assert.match(worker, /converted\?JSON\.stringify\(value\):JSON\.stringify\(value,dateSafeReplacer\)/);
});

test('the Plan vs Actual boundary is written after the refresh finishes, with the refresh time', () => {
  const server = read('server/server.js');
  assert.match(server, /scheduleBacklogPlanActualCapture\(id, \(\) =>\s*captureBacklogPlanActualSnapshot\(id, activeSnapshot, planActualOverrides, \{ capturedAt: planActualCapturedAt \}\)/);
  assert.match(server, /const capturedAt=options\.capturedAt\|\|new Date\(\)\.toISOString\(\)/);
  assert.match(server, /async function ensureBacklogPlanActualArchive\(id\) \{\n  await pendingBacklogPlanActualCapture\(id\);/);
  assert.doesNotMatch(server, /await runRefreshTelemetry\(telemetry, 'Local storage', 'backlog-plan-actual-snapshot'/);
});

test('the new-user installer packages the version that was actually promoted to STABLE', () => {
  const workflow = fs.readFileSync(path.join(__dirname, '..', '..', '..', '.github', 'workflows', 'buyerlog-installer.yml'), 'utf8');
  assert.match(workflow, /contents\/stable\/latest\.json/);
  assert.ok(workflow.indexOf('stable/latest.json') < workflow.indexOf("release-requests/stable.json').version"), 'release repo manifest wins over the request file');
});
