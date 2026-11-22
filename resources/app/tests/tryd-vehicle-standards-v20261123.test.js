'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const V = require('../public/landed-vehicle-standards');

const close = (actual, expected, message) => assert.ok(actual != null && Math.abs(actual - expected) < 1e-9, `${message || ''} beklenen ${expected}, gelen ${actual}`);

test('vasıta anahtarı: büyük/küçük harf, Türkçe karakter ve "+" çevresi boşluk aynı anahtara iner', () => {
  assert.equal(V.normalizeVehicleKey('Gemi+Uçak'), 'GEMI+UCAK');
  assert.equal(V.normalizeVehicleKey('GEMI + UCAK'), 'GEMI+UCAK');
  assert.equal(V.normalizeVehicleKey('  gemi  +  uçak '), 'GEMI+UCAK');
  assert.equal(V.normalizeVehicleKey('Uçak'), 'UCAK');
  assert.equal(V.normalizeVehicleKey('TIR'), 'TIR');
  assert.equal(V.normalizeVehicleKey('Tır'), 'TIR');
  assert.equal(V.normalizeVehicleKey('Kara  Yolu'), 'KARA YOLU');
  assert.equal(V.normalizeVehicleKey(''), '');
  assert.equal(V.normalizeVehicleKey(null), '');
  assert.equal(V.normalizeVehicleKey('__proto__'), 'PROTO');
});

test('byVehicle normalize: geçersiz değer ve boş anahtar düşer, anahtar normalize edilir, boş nesne {} döner', () => {
  assert.deepEqual(V.normalizeByVehicle(null), {});
  assert.deepEqual(V.normalizeByVehicle([]), {});
  assert.deepEqual(V.normalizeByVehicle({ 'Gemi + Uçak': 1.2, Gemi: '1.08', Uçak: 0, Tır: 11, '': 1.1, Kamyon: 'x' }), { 'GEMI+UCAK': 1.2, GEMI: 1.08 });
  const out = V.normalizeByVehicle({ __proto__: null, constructor: 1.3 });
  assert.equal(out.CONSTRUCTOR, 1.3);
  assert.equal(Object.getPrototypeOf(out), Object.prototype);
});

test('byVehicle sıkı denetim: geçersiz değer reddedilir, eşdeğer anahtar çakışması reddedilir', () => {
  assert.deepEqual(V.validateByVehicle({ Gemi: 1.08, 'Gemi+Uçak': 1.25 }), { ok: true, value: { GEMI: 1.08, 'GEMI+UCAK': 1.25 } });
  assert.equal(V.validateByVehicle({ Gemi: 0 }).ok, false);
  assert.equal(V.validateByVehicle({ Gemi: 10.5 }).ok, false);
  assert.equal(V.validateByVehicle({ Gemi: 'abc' }).ok, false);
  assert.equal(V.validateByVehicle({ '': 1.1 }).ok, false);
  assert.equal(V.validateByVehicle({ 'Gemi+Uçak': 1.2, 'GEMI + UCAK': 1.3 }).ok, false);
  assert.equal(V.validateByVehicle([1.1]).ok, false);
  assert.equal(V.validateByVehicle(Object.fromEntries(Array.from({ length: V.MAX_VEHICLES + 1 }, (_, i) => [`V${i}`, 1.1]))).ok, false);
  assert.deepEqual(V.validateByVehicle({}), { ok: true, value: {} });
});

test('sipariş standardı: parsiyellerin yükleme adediyle ağırlıklı ortalama', () => {
  const byVehicle = { GEMI: 1.1, UCAK: 1.5 };
  const parts = [{ key: 'GEMI', label: 'Gemi', qty: 750 }, { key: 'UCAK', label: 'Uçak', qty: 250 }];
  const result = V.orderStandard(parts, byVehicle, 1.11);
  close(result.value, 1.1 * 0.75 + 1.5 * 0.25);
  assert.equal(result.source, 'vehicle');
  assert.equal(result.known, true);
  assert.equal(result.weighting, 'qty');
  assert.equal(result.label, 'Gemi %75 · Uçak %25');
});

test('sipariş standardı: adet eksikse eşit ağırlık', () => {
  const result = V.orderStandard([{ key: 'GEMI', label: 'Gemi', qty: 500 }, { key: 'UCAK', label: 'Uçak', qty: null }], { GEMI: 1.1, UCAK: 1.5 }, 1.11);
  close(result.value, 1.3);
  assert.equal(result.weighting, 'equal');
});

test('sipariş standardı: vasıta için standart tanımlı değilse o parsiyel genel yurtdışı standardını kullanır', () => {
  const mixed = V.orderStandard([{ key: 'GEMI', label: 'Gemi', qty: 500 }, { key: 'UCAK', label: 'Uçak', qty: 500 }], { UCAK: 1.5 }, 1.11);
  close(mixed.value, (1.11 + 1.5) / 2);
  assert.equal(mixed.source, 'mixed');
  const none = V.orderStandard([{ key: 'GEMI', label: 'Gemi', qty: 500 }], {}, 1.11);
  close(none.value, 1.11);
  assert.equal(none.source, 'overseas');
  assert.equal(none.known, true);
});

test('sipariş standardı: vasıta bilinmiyorsa genel yurtdışı standardı ve known=false', () => {
  for (const parts of [null, [], [{ key: '', label: '', qty: 10 }]]) {
    const result = V.orderStandard(parts, { GEMI: 1.05 }, 1.11);
    close(result.value, 1.11);
    assert.equal(result.known, false);
    assert.equal(result.source, 'unknown');
  }
  // Bilinmeyen parsiyel ağırlığa girmez; bilinen parsiyeller standardı belirler.
  const partial = V.orderStandard([{ key: 'GEMI', label: 'Gemi', qty: 100 }, { key: '', label: '', qty: 900 }], { GEMI: 1.05 }, 1.11);
  close(partial.value, 1.05);
  assert.equal(partial.known, true);
});

test('öneri: o vasıtadaki satırların adet ağırlıklı Landed/FOB medyanı, örnek sayısı ve tarih kapsamı', () => {
  const samples = [];
  for (let i = 0; i < 25; i += 1) samples.push({ key: 'GEMI', label: 'Gemi', order: `O${i % 6}`, qty: i === 0 ? 10000 : 10, ratio: i === 0 ? 1.2 : 1.05 + i / 1000, dates: [`2026-0${1 + (i % 5)}-10`] });
  const out = V.suggest(samples);
  const gemi = out.find(item => item.key === 'GEMI');
  assert.equal(gemi.count, 25);
  assert.equal(gemi.orders, 6);
  assert.equal(gemi.enough, true);
  // 10.000 adetlik satır ağırlığın çoğunu taşır: adet ağırlıklı medyan 1,2'dir (düz medyan 1,062 olurdu).
  close(gemi.suggestion, 1.2);
  assert.equal(gemi.from, '2026-01-10');
  assert.equal(gemi.to, '2026-05-10');
});

test('öneri: adet ağırlıklı medyan eşit ağırlıkta orta değeri verir', () => {
  const samples = [1.1, 1.2, 1.3, 1.4, 1.5].flatMap((ratio, index) => Array.from({ length: 4 }, (_, j) => ({ key: 'UCAK', label: 'Uçak', order: `O${index}-${j}`, qty: 100, ratio })));
  close(V.suggest(samples)[0].suggestion, 1.3);
});

test('öneri: az örnekte öneri verilmez ve neden kodu döner', () => {
  const few = Array.from({ length: V.MIN_SAMPLE_ROWS - 1 }, (_, i) => ({ key: 'UCAK', label: 'Uçak', order: `O${i}`, qty: 10, ratio: 1.5 }));
  const thin = V.suggest(few)[0];
  assert.equal(thin.enough, false);
  assert.equal(thin.suggestion, null);
  assert.equal(thin.reason, 'fewRows');
  const oneOrder = Array.from({ length: 30 }, (_, i) => ({ key: 'TIR', label: 'Tır', order: i < 27 ? 'A' : `B${i}`, qty: 10, ratio: 1.2 }));
  const narrow = V.suggest(oneOrder)[0];
  assert.equal(narrow.enough, false);
  assert.equal(narrow.reason, 'fewOrders');
});

test('öneri yüzdeliği tek sabittir (varsayılan P50 = medyan); P90 seçilebilir ve sonuçta yazılır', () => {
  assert.equal(V.SUGGEST_PERCENTILE, 0.5);
  const samples = Array.from({ length: 10 }, (_, i) => ({ key: 'GEMI', label: 'Gemi', order: `O${i}`, qty: 100, ratio: 1.01 + i / 100 })).flatMap(item => [item, { ...item }]);
  const p50 = V.suggest(samples)[0];
  assert.equal(p50.percentile, 0.5);
  close(p50.suggestion, (1.05 + 1.06) / 2);
  const p90 = V.suggest(samples, { percentile: 0.9 })[0];
  assert.equal(p90.percentile, 0.9);
  close(p90.suggestion, (1.09 + 1.1) / 2);
});
