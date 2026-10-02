'use strict';
// Hata yalnız UTC+X saat diliminde görünür: TR yerel gece yarısı JSON'da önceki
// günün 21:00Z'sidir. Testler bu yüzden İstanbul saat diliminde koşar.
process.env.TZ = 'Europe/Istanbul';

const test = require('node:test');
const assert = require('node:assert/strict');
const Engine = require('../server/lib/backlog-plan-actual');
const Snapshot = require('../server/lib/model-snapshot');
const V3 = require('../public/backlog-v3-report.js');

const local = iso => new Date(iso + 'T00:00:00');
function order(code, overrides = {}) {
  return {
    ocode:code, model:'MODEL-' + code, ccode:'01', colour:'Siyah', buyer:'Ayşe', buyerGrup:'WOMEN', manufacturer:'SUP', season:'W6',
    merch:'M1', ageGroup:'A1', countryRaw:'TR', qty:100, kalan:100,
    ex:local('2026-03-10'), _asasEx:local('2026-03-10'), retail:local('2026-06-15'), mb:local('2026-07-06'), opd:local('2026-04-15'),
    ...overrides,
  };
}
function row(code, overrides = {}) {
  return {
    'Sezon':'W6', 'Buyer':'Ayşe', 'Buyer Grup (TR)':'WOMEN', 'Üretici':'SUP', 'Sipariş Kod':code, 'Model Adı':'MODEL-' + code, 'Renk Kod':'01', 'Renk':'Siyah',
    'Orijinal Exfactory Merch Tarih':local('2026-03-10'), 'Retail Depo Tarih Yıl Ay Gün':local('2026-06-15'), 'Model Bütçe Tarih Yıl Ay Gün':local('2026-07-06'),
    'Net Alım Sipariş Miktarı':100, 'Adet':100, 'Net Gelen Alım Sipariş Miktarı':100, 'Kalan Alım Sipariş Miktarı':0,
    'GÜNCEL DURUM\n(STATUS)':'Yolda', 'ANTREPO GİRİŞ TARİHİ':local('2026-04-20'), _backlogExcel:{ handoverDate:local('2026-03-14'), actualLoadDate:local('2026-03-14') },
    ...overrides,
  };
}
const codes = Array.from({ length:40 }, (_, i) => String(1300000 + i));
const liveOrders = codes.map(code => order(code));
const liveRows = codes.map(code => row(code));

test('calendar day of a JSON timestamp is the local day, not the UTC prefix', () => {
  assert.equal(Engine.dateIso('2026-03-09T21:00:00.000Z'), '2026-03-10');
  assert.equal(Engine.dateIso(local('2026-03-10')), '2026-03-10');
  assert.equal(Engine.dateIso(new Date(Date.UTC(2026, 2, 10))), '2026-03-10', 'UTC-midnight dates keep their calendar day');
  assert.equal(Engine.dateIso('20260310'), '2026-03-10');
  assert.equal(Engine.dateIso('10.03.2026'), '2026-03-10');
  assert.equal(V3.dayIso('2026-03-09T21:00:00.000Z'), '2026-03-10');
});

test('a snapshot captured after a cold start (JSON-hydrated data) equals the live snapshot', () => {
  const live = Engine.projectSnapshot(liveOrders, liveRows, { capturedAt:'a' });
  const cold = Engine.projectSnapshot(JSON.parse(JSON.stringify(liveOrders)), JSON.parse(JSON.stringify(liveRows)), { capturedAt:'a' });
  assert.deepEqual(cold.rows, live.rows);
  assert.equal(live.rows[0].planExFactory, '2026-03-10');
  assert.deepEqual(live.rows[0].handoverDates, { '2026-03-14':100 });
});

test('model snapshot hydration restores Date fields so every consumer sees live-identical data', () => {
  const payload = { loadedAt:'2026-10-02T05:38:00.000Z', asasOrders:liveOrders, asasOrdersByTarget:{ backlog:liveOrders }, antrepoMap:{ k:[{ handover:local('2026-03-14') }] }, antrepoMapByTarget:null };
  const stored = JSON.parse(JSON.stringify(Snapshot.compactSnapshotPayload(payload).value));
  const hydrated = Snapshot.expandSnapshotPayload(stored);
  const revived = Snapshot.reviveSnapshotDates(hydrated);
  assert.ok(revived >= liveOrders.length * 5);
  assert.ok(hydrated.asasOrders[0].opd instanceof Date, 'order placement date is a Date again (was a raw "…T21:00:00.000Z" string)');
  assert.equal(hydrated.asasOrders[0].opd.getDate(), 15);
  assert.ok(hydrated.antrepoMap.k[0].handover instanceof Date);
  assert.equal(hydrated.asasOrdersByTarget.backlog, hydrated.asasOrders, 'target aliases keep identity');
  assert.equal(typeof hydrated.loadedAt, 'string', 'metadata outside order/IAS data is untouched');
});

function shifted(rows) {
  // 7.0.204 öncesi davranışın taklidi: soğuk açılış snapshot'ında bütün ASAS/IAS tarihleri bir gün geri.
  const back = iso => new Date(Date.parse(iso + 'T00:00:00Z') - 86400000).toISOString().slice(0, 10);
  const buckets = map => Object.fromEntries(Object.entries(map || {}).map(([k, v]) => [back(k), v]));
  return rows.map(r => ({ ...r, planExFactory:back(r.planExFactory), originalExFactory:back(r.originalExFactory), retail:back(r.retail), inStore:back(r.inStore), handoverDates:buckets(r.handoverDates), loadDates:buckets(r.loadDates), etaDates:buckets(r.etaDates) }));
}

test('archived snapshots written one day early are repaired on read and no false Ex-Factory revisions appear', () => {
  const good = Engine.projectSnapshot(liveOrders, liveRows, { capturedAt:'2026-09-28T07:00:00.000Z' }).rows;
  const bad = shifted(good);
  const archive = {
    schemaVersion:1,
    base:{ capturedAt:'2026-09-28T07:00:00.000Z', rows:good },
    deltas:[
      { capturedAt:'2026-09-30T07:00:00.000Z', ...Engine._test.deltaBetween(good, bad) },
      { capturedAt:'2026-10-01T07:00:00.000Z', ...Engine._test.deltaBetween(bad, good) },
      { capturedAt:'2026-10-02T07:00:00.000Z', ...Engine._test.deltaBetween(good, bad) },
    ],
  };
  assert.deepEqual(Engine._test.markerDayOffsets(archive), [0, -1, 0, -1]);
  const resolved = Engine.resolveRange(archive, '2026-09-28T08:00:00.000Z', '2026-10-02T08:00:00.000Z');
  assert.equal(resolved.end.dateRepair, -1);
  assert.equal(resolved.repairedMarkers, 2);
  assert.deepEqual(resolved.end.rows, resolved.start.rows, 'repaired end snapshot equals the correct one');
  const result = Engine.compareSnapshots(resolved.start.rows, resolved.end.rows, { from:'2026-09-28T07:00:00.000Z', to:'2026-10-02T07:00:00.000Z', activity:[] });
  assert.equal(result.summary.exFactoryDelayed + result.summary.exFactoryAdvanced, 0);
  assert.ok(!result.changes.some(change => change.fields.some(field => field.label === 'Retail' || field.label === 'Planlanan Ex-Factory')));
});

test('a genuine one-day revision on a few orders is not mistaken for a date shift', () => {
  const good = Engine.projectSnapshot(liveOrders, liveRows, { capturedAt:'a' }).rows;
  const revised = good.map((r, i) => (i < 3 ? { ...r, planExFactory:'2026-03-09' } : r));
  const archive = { schemaVersion:1, base:{ capturedAt:'2026-09-28T07:00:00.000Z', rows:good }, deltas:[{ capturedAt:'2026-09-30T07:00:00.000Z', ...Engine._test.deltaBetween(good, revised) }] };
  assert.deepEqual(Engine._test.markerDayOffsets(archive), [0, 0]);
});
