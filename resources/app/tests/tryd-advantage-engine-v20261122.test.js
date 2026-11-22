'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const engine = require('../public/tryd-advantage-engine');

const close = (actual, expected, message) => assert.ok(actual != null && Math.abs(actual - expected) < 1e-9, `${message || ''} beklenen ${expected}, gelen ${actual}`);

/* Excel "YD klasman LANDED AVANTAJ DURUMU" hesaplanan alanlarıyla elle hesaplanmış örnek. */
const base = { season: 'S6', buyerGroup: 'KIDS', classification: 'TRİKO', mag: 'CU4C' };
const rows = [
  // M1: TR FOB = (100×5 + 300×6) / 400 = 5,75
  { ...base, order: '1', model: 'M1', colour: 'A', originCountry: 'TÜRKİYE', qty: 100, fob: 5, landedActual: 5.4 },
  { ...base, order: '2', model: 'M1', colour: 'B', originCountry: 'Turkiye', qty: 300, fob: 6 },
  { ...base, order: '3', model: 'M1', colour: 'A', originCountry: 'BANGLADEŞ', qty: 1000, fob: 3, landedActual: 3.5, landedForecast: 3.4 },
  { ...base, order: '4', model: 'M1', colour: 'B', originCountry: 'ÇİN', qty: 500, fob: 3.2, landedActual: 3.9 },
  // Mısır: kıyas dışı (FAS-MISIR-TURKIYE HARİÇ)
  { ...base, order: '5', model: 'M1', colour: 'C', originCountry: 'MISIR', qty: 200, fob: 2, landedActual: 2.3 },
  // Landed yok: kıyasa girmez, kapsamda sayılır
  { ...base, order: '6', model: 'M1', colour: 'D', originCountry: 'BANGLADEŞ', qty: 100, fob: 3, landedActual: null },
  // M2: landed < FOB → hatalı (fiziksel olarak imkânsız)
  { ...base, mag: 'CU4D', order: '7', model: 'M2', colour: 'A', originCountry: 'TÜRKİYE', qty: 200, fob: 4 },
  { ...base, mag: 'CU4D', order: '8', model: 'M2', colour: 'A', originCountry: 'PAKİSTAN', qty: 100, fob: 2.5, landedActual: 2.0 },
  { ...base, mag: 'CU4D', order: '9', model: 'M2', colour: 'B', originCountry: 'PAKİSTAN', qty: 300, fob: 2.5, landedActual: 3.0 },
  // M3 yalnız TR, M4 yalnız YD, M5 TR + yalnız Fas → kıyaslanmaz
  { ...base, order: '10', model: 'M3', colour: 'A', originCountry: 'TÜRKİYE', qty: 50, fob: 5 },
  { ...base, order: '11', model: 'M4', colour: 'A', originCountry: 'BANGLADEŞ', qty: 50, fob: 2, landedActual: 2.4 },
  { ...base, order: '12', model: 'M5', colour: 'A', originCountry: 'TÜRKİYE', qty: 50, fob: 5 },
  { ...base, order: '13', model: 'M5', colour: 'A', originCountry: 'FAS', qty: 50, fob: 3, landedActual: 3.3 },
];

test('ülke sınıfı: Türkiye TR, Fas/Mısır kıyas dışı, diğerleri YD, boş bilinmiyor', () => {
  assert.equal(engine.originClass({ originCountry: 'TÜRKİYE' }), 'tr');
  assert.equal(engine.originClass({ originCountry: 'turkey' }), 'tr');
  assert.equal(engine.originClass({ originCountry: 'MISIR' }), 'excluded');
  assert.equal(engine.originClass({ originCountry: 'Mısır' }), 'excluded');
  assert.equal(engine.originClass({ originCountry: 'FAS' }), 'excluded');
  assert.equal(engine.originClass({ originCountry: 'Morocco' }), 'excluded');
  assert.equal(engine.originClass({ originCountry: 'BANGLADEŞ' }), 'yd');
  assert.equal(engine.originClass({ originCountry: '' }), 'unknown');
});

test('model formülleri Excel hesaplanan alanlarıyla aynı; yalnız TR+YD modelleri kıyaslanır', () => {
  const result = engine.compareModels(rows, { target: 0.36 });
  assert.deepEqual(result.models.map(model => model.model).sort(), ['M1', 'M2']);
  assert.deepEqual(result.skipped, { trOnly: 2, ydOnly: 1, trNoFob: 0 });
  const m1 = result.models.find(model => model.model === 'M1');
  close(m1.trFob, 5.75, 'TR FOB');
  assert.equal(m1.amounts.ydQty, 1500);
  assert.equal(m1.amounts.ydQtyAll, 1600);
  assert.equal(m1.amounts.trQty, 400);
  close(m1.amounts.fobTrAmount, 5.75 * 1500, 'FOB TR TUTAR');
  close(m1.amounts.landedAmount, 3500 + 1950, 'LANDED TUTAR');
  close(m1.amounts.fobYdAmount, 3000 + 1600, 'FOB YD TUTAR');
  close(m1.advantage, 1 - 5450 / 8625, 'avantaj');
  close(m1.fobAdvantage, 1 - 4600 / 8625, 'FOB avantajı');
  close(m1.gap, 1 - 5450 / 8625 - 0.36, 'fark');
  close(m1.ydLanded, 5450 / 1500, 'YD landed');
  close(m1.ydFob, 4600 / 1500, 'YD FOB');
  close(m1.coverage, 1500 / 1600, 'kapsam');
  assert.equal(m1.status, engine.STATUS.noLanded);
  // Bangladeş 3,5/3 = 1,17 ve Çin 3,9/3,2 = 1,22 standart 1,11'in üstünde: uyarı alır, hesapta kalır.
  assert.deepEqual(m1.statusCount, { ok: 0, highMultiplier: 2, noLanded: 1, invalidLanded: 0 });
});

test('landed < FOB hatalıdır ve hesaptan çıkar; model durumu "landed hatalı"', () => {
  const m2 = engine.compareModels(rows).models.find(model => model.model === 'M2');
  assert.equal(m2.status, engine.STATUS.invalid);
  assert.equal(m2.amounts.invalidQty, 100);
  assert.equal(m2.amounts.ydQty, 300);
  close(m2.advantage, 1 - 900 / 1200, 'avantaj');
  assert.equal(engine.rowStatus({ qty: 1, fob: 2, landedActual: 0 }, null, 'actual'), engine.STATUS.noLanded);
  assert.equal(engine.rowStatus({ qty: 1, fob: 2, landedActual: -1 }, null, 'actual'), engine.STATUS.invalid);
  assert.equal(engine.rowStatus({ qty: 1, fob: 2, landedActual: 2.2 }, null, 'actual'), engine.STATUS.ok);
});

test('grup toplamında oran tutarlardan yeniden hesaplanır (satır oranlarının ortalaması değil)', () => {
  const result = engine.analyze(rows, { target: 0.36 });
  const expected = 1 - (5450 + 900) / (8625 + 1200);
  close(result.total.advantage, expected, 'toplam avantaj');
  const mean = (result.models[0].advantage + result.models[1].advantage) / 2;
  assert.ok(Math.abs(result.total.advantage - mean) > 1e-3, 'ortalama ile aynı çıkmamalı');
  close(result.total.fobAdvantage, 1 - (4600 + 750) / 9825, 'toplam FOB avantajı');
  assert.equal(result.total.below, 1);
  assert.equal(result.total.invalid, 1);
  assert.equal(result.total.noLanded, 1);
  const tree = engine.buildTree(result.visible, { target: 0.36 });
  assert.equal(tree.length, 1);
  close(tree[0].advantage, expected, 'buyer grup düğümü');
  const mags = tree[0].children[0].children;
  assert.deepEqual(mags.map(node => node.label), ['CU4C', 'CU4D']);
  close(mags[1].advantage, 0.25, 'MAG düğümü');
  assert.equal(mags[0].children[0].kind, 'model');
  assert.equal(mags[0].children[0].label, 'M1');
});

test('yalnız hedef altı ve arama model düzeyinde süzer; hedef değişince fark değişir', () => {
  const below = engine.analyze(rows, { target: 0.36, belowTargetOnly: true });
  assert.deepEqual(below.visible.map(model => model.model), ['M2']);
  close(below.total.advantage, 0.25);
  close(below.total.gap, 0.25 - 0.36);
  const searched = engine.analyze(rows, { target: 0.2, search: 'm1' });
  assert.deepEqual(searched.visible.map(model => model.model), ['M1']);
  close(searched.visible[0].gap, 1 - 5450 / 8625 - 0.2);
  assert.equal(engine.analyze(rows, { target: 0.2, belowTargetOnly: true }).visible.length, 0);
});

test('öngörü kaynağı yalnız açıkça seçilince kullanılır; iki kaynak karışmaz', () => {
  const actual = engine.compareModels(rows).models.find(model => model.model === 'M1');
  const forecast = engine.compareModels(rows, { landedSource: 'forecast' }).models.find(model => model.model === 'M1');
  assert.equal(actual.amounts.ydQty, 1500);
  // Öngörüde yalnız Bangladeş 1000 adedin değeri var; gerçekleşen 3,9 yerine kullanılmaz.
  assert.equal(forecast.amounts.ydQty, 1000);
  close(forecast.amounts.landedAmount, 3400);
  close(forecast.advantage, 1 - 3400 / 5750);
  assert.equal(engine.compareModels(rows, { landedSource: 'bogus' }).landedSource, 'actual');
});

// Ürün kararı (kullanıcı, 2026-11-22): landed çarpanı yükleme tipine göre değişir
// (gemi < gemi+uçak < uçak). Standardın üstündeki çarpan HATA DEĞİLDİR; gerçek
// maliyettir, hesapta kalır ve "Landed çarpanı yüksek" uyarısı alır. Önceki
// istatistiksel çit (Q3 ± 3×IQR) bu karar nedeniyle hesaptan çıkarma kuralı
// olmaktan çıkarıldı. Hatalı yalnız fiziksel olarak imkânsız olandır: landed < FOB.
test('standart YD çarpanının üstü "landed çarpanı yüksek": hesapta kalır; hatalı yalnız landed < FOB', () => {
  assert.equal(engine.DEFAULT_STANDARD_MULTIPLIER, 1.11);
  const standard = 1.11;
  // 4 × 1,10 = standart içi; 4 × 1,60 = uçak gibi yüksek çarpan; 40 = çok yüksek ama yine hata değil.
  assert.equal(engine.rowStatus({ qty: 1, fob: 4, landedActual: 4.4 }, standard, 'actual'), engine.STATUS.ok);
  assert.equal(engine.rowStatus({ qty: 1, fob: 4, landedActual: 6.4 }, standard, 'actual'), engine.STATUS.high);
  assert.equal(engine.rowStatus({ qty: 1, fob: 4, landedActual: 40 }, standard, 'actual'), engine.STATUS.high);
  assert.equal(engine.rowStatus({ qty: 1, fob: 4, landedActual: 3.9 }, standard, 'actual'), engine.STATUS.invalid);
  assert.equal(engine.rowStatus({ qty: 1, fob: 4, landedActual: 4.4 }, 1.05, 'actual'), engine.STATUS.high);
  // Standart verilmezse varsayılan 1,11 kullanılır.
  assert.equal(engine.rowStatus({ qty: 1, fob: 4, landedActual: 4.6 }, null, 'actual'), engine.STATUS.high);
  const sample = [
    { model: 'A', originCountry: 'TÜRKİYE', qty: 100, fob: 6 },
    { model: 'A', originCountry: 'BANGLADEŞ', qty: 100, fob: 4, landedActual: 4.4 },
    { model: 'A', originCountry: 'ÇİN', qty: 100, fob: 4, landedActual: 6.4 },
    { model: 'A', originCountry: 'HİNDİSTAN', qty: 50, fob: 4, landedActual: 3 },
  ];
  const result = engine.analyze(sample, { target: 0.36, standardMultiplier: standard });
  const model = result.models[0];
  assert.deepEqual(model.statusCount, { ok: 1, highMultiplier: 1, noLanded: 0, invalidLanded: 1 });
  // Yüksek çarpanlı 100 adet hesapta; hatalı 50 adet dışarıda.
  assert.equal(model.amounts.ydQty, 200);
  assert.equal(model.amounts.highMultiplierQty, 100);
  assert.equal(model.amounts.invalidQty, 50);
  close(model.advantage, 1 - (440 + 640) / (6 * 200), 'avantaj yüksek çarpanı içerir');
  close(model.maxRatio, 1.6, 'en yüksek Landed/FOB');
  assert.equal(model.status, engine.STATUS.invalid);
  assert.equal(result.total.high, 0);
  assert.deepEqual(result.standard, { value: 1.11, fallback: false });
  const onlyHigh = engine.analyze(sample.slice(0, 3), { standardMultiplier: standard });
  assert.equal(onlyHigh.models[0].status, engine.STATUS.high);
  assert.equal(onlyHigh.total.high, 1);
  assert.equal(onlyHigh.total.invalid, 0);
  assert.deepEqual(engine.analyze(sample, {}).standard, { value: 1.11, fallback: true });
  assert.equal('landedBounds' in engine, false);
});

test('tercih normalize edilir: varsayılan hedef %36, bilinmeyen kaynak/filtre düşer', () => {
  const prefs = engine.normalizePrefs({ target: '0.4', landedSource: 'x', belowTargetOnly: 'yes', filterValues: { season: ['S6', 'S6', ''], originCountry: ['TR'], mag: ['A'] }, sort: { key: 'drop', dir: -1 } });
  assert.equal(prefs.target, 0.4);
  assert.equal(prefs.landedSource, 'actual');
  assert.equal(prefs.belowTargetOnly, false);
  assert.deepEqual(prefs.filterValues, { season: ['S6'], mag: ['A'] });
  assert.deepEqual(prefs.sort, { key: 'label', dir: -1 });
  assert.equal(engine.normalizePrefs(null).target, 0.36);
  assert.equal(engine.normalizePrefs({ target: 5 }).target, 1);
  assert.equal(engine.normalizePrefs({ target: null }).target, 0.36);
  assert.equal(engine.normalizePrefs({ landedSource: 'forecast' }).landedSource, 'forecast');
});
