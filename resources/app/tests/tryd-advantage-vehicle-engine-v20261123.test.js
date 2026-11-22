'use strict';
/* TR/YD motoru: "Landed çarpanı yüksek" satır bazında vasıtaya göre standarda bakar. */
const test = require('node:test');
const assert = require('node:assert/strict');
const engine = require('../public/tryd-advantage-engine');

const close = (actual, expected, message) => assert.ok(actual != null && Math.abs(actual - expected) < 1e-9, `${message || ''} beklenen ${expected}, gelen ${actual}`);
const base = { season: 'S6', buyerGroup: 'KIDS', classification: 'TRİKO', mag: 'CU4C' };
const rows = [
  { ...base, order: '1', model: 'M1', colour: 'A', originCountry: 'TÜRKİYE', qty: 100, fob: 5 },
  // Gemi: 1,10 — gemi standardı 1,08'in üstünde → yüksek
  { ...base, order: '2', model: 'M1', colour: 'A', originCountry: 'BANGLADEŞ', qty: 1000, fob: 3, landedActual: 3.3 },
  // Uçak: 1,40 — uçak standardı 1,50'nin altında → OK (genel 1,11'e göre yüksek olurdu)
  { ...base, order: '3', model: 'M1', colour: 'B', originCountry: 'ÇİN', qty: 200, fob: 3, landedActual: 4.2 },
  // Vasıtası bilinmeyen: genel 1,11 → 1,20 yüksek
  { ...base, order: '4', model: 'M1', colour: 'C', originCountry: 'ÇİN', qty: 100, fob: 3, landedActual: 3.6 },
  { ...base, order: '5', model: 'M2', colour: 'A', originCountry: 'TÜRKİYE', qty: 100, fob: 5 },
  // Karışık sipariş: Gemi 750 / Uçak 250 → standart 1,08×0,75 + 1,5×0,25 = 1,185; oran 1,18 → OK
  { ...base, order: '6', model: 'M2', colour: 'A', originCountry: 'PAKİSTAN', qty: 400, fob: 2, landedActual: 2.36 },
];
const vehicles = { '2': [['GEMI', 'Gemi', 500]], '3': [['UCAK', 'Uçak', 200]], '6': [['GEMI', 'Gemi', 750], ['UCAK', 'Uçak', 250]] };
const byVehicle = { GEMI: 1.08, UCAK: 1.5 };

test('rowStatus: sayı veya {value} standardı kabul eder (geriye uyumlu)', () => {
  const row = { qty: 10, fob: 2, landedActual: 2.4 };
  assert.equal(engine.rowStatus(row, 1.11, 'actual'), 'highMultiplier');
  assert.equal(engine.rowStatus(row, { value: 1.5 }, 'actual'), 'ok');
  assert.equal(engine.rowStatus(row, null, 'actual'), 'highMultiplier');
});

test('rowStandard: vasıtaya göre, karışıkta ağırlıklı, bilinmeyende genel standart', () => {
  const resolve = engine.createStandardResolver({ standardMultiplier: 1.11, byVehicle, vehicles });
  close(resolve(rows[1]).value, 1.08);
  assert.equal(resolve(rows[1]).source, 'vehicle');
  close(resolve(rows[2]).value, 1.5);
  close(resolve(rows[5]).value, 1.08 * 0.75 + 1.5 * 0.25);
  const unknown = resolve(rows[3]);
  close(unknown.value, 1.11);
  assert.equal(unknown.known, false);
  // Eşleme verisi hiç yoksa (eski davranış) bütün satırlar genel standartla değerlendirilir.
  const legacy = engine.createStandardResolver({ standardMultiplier: 1.11 });
  close(legacy(rows[2]).value, 1.11);
});

test('compareModels: durum satırın kendi standardıyla; yüksek çarpan hesapta kalır', () => {
  const result = engine.compareModels(rows, { standardMultiplier: 1.11, byVehicle, vehicles });
  const m1 = result.models.find(model => model.model === 'M1');
  assert.deepEqual(m1.statusCount, { ok: 1, highMultiplier: 2, noLanded: 0, invalidLanded: 0 });
  assert.equal(m1.status, 'highMultiplier');
  assert.equal(m1.amounts.ydQty, 1300);
  // En yüksek oranlı satır uçak siparişidir (1,40); tooltip vasıtasını ve standardını gösterir.
  close(m1.maxRatio, 1.4);
  assert.equal(m1.maxRatioVehicle, 'Uçak');
  close(m1.maxRatioStandard, 1.5);
  // Model düzeyi vasıta: YD adediyle ağırlıklı en sık vasıta.
  assert.equal(m1.vehicle, 'Gemi');
  assert.equal(m1.amounts.vehicleKnownQty, 1200);
  assert.equal(m1.amounts.vehicleUnknownQty, 100);
  const m2 = result.models.find(model => model.model === 'M2');
  assert.equal(m2.status, 'ok');
  // Vasıtasız eski davranış: uçak satırı da genel standarda göre yüksek sayılırdı.
  const legacy = engine.compareModels(rows, { standardMultiplier: 1.11 });
  assert.equal(legacy.models.find(model => model.model === 'M2').status, 'highMultiplier');
  assert.equal(legacy.models.find(model => model.model === 'M1').vehicle, '');
});

test('analyze: vasıta eşleşme kapsamı toplamda raporlanır; vasıta bir pivot satır alanıdır', () => {
  const result = engine.analyze(rows, { standardMultiplier: 1.11, byVehicle, vehicles });
  assert.equal(result.total.amounts.vehicleKnownQty, 1600);
  assert.equal(result.total.amounts.vehicleUnknownQty, 100);
  assert.ok(engine.ROW_FIELDS.includes('vehicle'));
  const tree = engine.buildTree(result.visible, { levels: ['vehicle'] });
  assert.deepEqual(tree.map(node => node.label).sort(), ['Gemi']);
  assert.equal(engine.normalizePrefs({ rows: ['vehicle', 'mag'] }).rows.map(ref => ref.key).join(','), 'vehicle,mag');
  assert.deepEqual(engine.validatePrefs({ rows: ['vehicle'] }), []);
  // Arama vasıtayı da tarar.
  assert.equal(engine.analyze(rows, { standardMultiplier: 1.11, byVehicle, vehicles, search: 'gemi' }).visible.length, 2);
});
