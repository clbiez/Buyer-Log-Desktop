'use strict';

// v5.76 — Navlun hesaplama motoru. v5.77'de Toplam Koli yukarı yuvarlamaya
// geçildi (kullanıcı kararı), referans sayılar buna göre güncellendi.
//
// Gerekçe: sayılar kullanıcının "GEMİ+UÇAK VE UÇAK NAVLUN MALİYET BULMA"
// Excel'inden geliyor. Bu testler o dosyanın FREIGHT CALCULATE sayfasındaki
// LIVERPOOL-1-YD satırını referans alır; formül zinciri bozulursa burada
// yakalanır. Kaynak Excel koli sayısını ondalıklı bırakıyordu (43,53787…);
// biz 44'e yuvarladığımız için CBM'den sonraki her değer kaynak dosyadan bir
// miktar YÜKSEK çıkar. Aşağıdaki beklenen değerler bu kasıtlı farkı içerir.

const test = require('node:test');
const assert = require('node:assert/strict');
const freight = require('../public/freight-calc');

// Kaynak dosyanın 9. satırındaki sarı (girdi) hücreler.
const SOURCE_ROW = {
  kgPerPiece: 0.132,   // C9
  qtyTotal: 5747,      // D9
  qtyPerCarton: 132,   // E9
  cartonL: 58,         // I9
  cartonH: 38,         // J9
  cartonW: 40,         // K9
  stylePrice: 1.65,    // B9
};

function close(actual, expected, message) {
  assert.ok(Math.abs(actual - expected) < 1e-9, `${message}: ${actual} != ${expected}`);
}

test('v5.77 Toplam Koli yukarı yuvarlanır, ara değerler buna göre çıkar', () => {
  const out = freight.calculate(SOURCE_ROW, freight.defaultSettings());
  // 5747 / 132 = 43,537… → 44. Yarım koli yüklenmez; taşıyıcı 44 koli
  // üzerinden yer ve ağırlık hesaplar.
  assert.equal(out.cartonCount, 44, 'Toplam Koli (L9) yukarı yuvarlanmalı');
  close(out.cbm, 3.8790400000000003, 'CBM (M9)');
  close(out.grossWeight, 802.604, 'Brüt Kilogram (N9) — koli başı 1 kg ambalaj dahil');
  close(out.chargeableWeight, 802.604, 'Charchable Weight (O9)');
  // Bu satırda brüt kilogram hacimsel ağırlıktan büyük; MAX brütü seçer.
  assert.equal(out.chargeableSource, 'gross');
  assert.equal(out.volumetricFactor, 167);
  assert.equal(out.complete, true);
});

test('v5.77 üç navlun rotası için toplam, birim ve landed doğru', () => {
  const out = freight.calculate(SOURCE_ROW, freight.defaultSettings());
  const by = id => out.results.find(item => item.id === id);

  close(by('air').total, 4253.8012, 'AIR COST (T9)');
  close(by('air').perPiece, 0.7401776927092396, 'AIR Per Piece (U9)');
  close(by('air').landed, 2.3901776927092397, 'Air Landed (H9)');

  close(by('seaair-colombo').total, 4013.0200000000004, 'COLOMBO (P9)');
  close(by('seaair-colombo').perPiece, 0.698280842178528, 'COLOMBO Per Piece (Q9)');
  close(by('seaair-colombo').landed, 2.3482808421785277, 'Sea+Air Landed Colombo (F9)');

  close(by('seaair-maldives').total, 3130.1556, 'MALDIVES (R9)');
  close(by('seaair-maldives').perPiece, 0.5446590568992518, 'MALDIVES Per Piece (S9)');
  close(by('seaair-maldives').landed, 2.1946590568992517, 'Sea+Air Landed Maldives (G9)');
});

test('v5.77 tam bölünen adet fazladan koli üretmez', () => {
  // 5280 / 132 = 40 tam. Yuvarlama burada hiçbir şey eklememeli; aksi halde
  // her siparişe görünmez bir koli maliyeti binerdi.
  const out = freight.calculate({ ...SOURCE_ROW, qtyTotal: 5280 }, freight.defaultSettings());
  assert.equal(out.cartonCount, 40);
  // Tek adet bile taşsa yeni koli açılır.
  assert.equal(freight.calculate({ ...SOURCE_ROW, qtyTotal: 5281 }, freight.defaultSettings()).cartonCount, 41);
});

test('v5.76 hacimsel ağırlık brütü aşarsa charchable weight ona döner', () => {
  // Hafif ama hacimli yük: aynı koli ölçüsü, adet başına 1 gram.
  const light = freight.calculate({ ...SOURCE_ROW, kgPerPiece: 0.001 }, freight.defaultSettings());
  close(light.volumetricWeight, 3.8790400000000003 * 167, 'CBM × 167');
  assert.equal(light.chargeableSource, 'volumetric');
  close(light.chargeableWeight, 3.8790400000000003 * 167, 'MAX hacimseli seçmeli');
});

test('v5.76 eksik alanla hesap yapılmaz, hangi alanların eksik olduğu bildirilir', () => {
  const out = freight.calculate({ qtyTotal: 100 }, freight.defaultSettings());
  assert.equal(out.complete, false);
  assert.equal(out.chargeableWeight, null);
  assert.deepEqual(freight.missingFields({ qtyTotal: 100 }).sort(), [
    'cartonH', 'cartonL', 'cartonW', 'kgPerPiece', 'qtyPerCarton', 'stylePrice',
  ]);
  // Koli başı adet sıfırsa bölme yapılmaz.
  assert.equal(freight.calculate({ ...SOURCE_ROW, qtyPerCarton: 0 }, freight.defaultSettings()).cartonCount, null);
});

test('v5.76 ücret ayarları normalize edilir; bozuk kayıt varsayılana düşmez ama geçerli hale gelir', () => {
  const settings = freight.normalizeSettings({
    rates: [
      { label: 'Yeni Rota', mode: 'air', rate: '4,25' },
      { label: '', mode: 'gemi', rate: -3 },
    ],
    volumetricFactor: '0',
  });
  assert.equal(settings.rates.length, 2);
  assert.equal(settings.rates[0].id, 'yeni-rota');
  assert.equal(settings.rates[0].rate, 4.25, 'virgüllü ondalık okunmalı');
  assert.equal(settings.rates[1].mode, 'seaAir', 'tanınmayan tip Gemi+Uçak olur');
  assert.equal(settings.rates[1].rate, 0, 'negatif ücret sıfırlanır');
  assert.equal(settings.volumetricFactor, 167, 'geçersiz katsayı varsayılana döner');
});

test('v5.76 ücreti sıfır olan rota hesaba katılmaz ama listede kalır', () => {
  const settings = freight.normalizeSettings({ rates: [{ id: 'x', label: 'X', mode: 'air', rate: 0 }] });
  const out = freight.calculate(SOURCE_ROW, settings);
  assert.equal(out.results.length, 1);
  assert.equal(out.results[0].total, null);
  assert.equal(out.results[0].landed, null);
});

test('v5.76 varsayılan ayar kaynak Excel’in tablo başındaki üç ücretidir', () => {
  const settings = freight.defaultSettings();
  assert.deepEqual(settings.rates.map(r => [r.id, r.mode, r.rate]), [
    ['air', 'air', 5.3],
    ['seaair-colombo', 'seaAir', 5],
    ['seaair-maldives', 'seaAir', 3.9],
  ]);
});
