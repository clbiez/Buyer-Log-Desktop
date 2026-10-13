'use strict';

/* Çekirdek hesapların DAVRANIŞ testleri.
   Para/adet ayrıştırma, ağırlıklı ortalama, lisanslı (non-DTR) landed fiyat,
   Excel uyumlu yuvarlama ve fiyat kuralı sezon eşleşmesi tüm ekranların
   (CP, Siparişler, Koleksiyon, Nakliye, Endeksmatik) sonuçlarını belirler.
   Bu testler app-main.js'teki GERÇEK fonksiyonları çalıştırır (kaynağı
   çıkarılıp vm'de yürütülür); metin eşleştirmesi değil, girdi → çıktı
   sözleşmesi korunur. */
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadAppMainFunctions } = require('./helpers/app-main-functions');

const fn = loadAppMainFunctions([
  'norm', 'turknorm', 'toNum', 'isTurkeyCountry', 'fmtMoney', 'fmtPct', 'formatQuantityTotal',
  'normalizeDecimalText', 'numericFilterValue', 'numericFilterRulePasses', 'tableNumericValue',
  'kolParseQuantityNum', 'kolParseMoneyNum', 'kolFormatMoneyDisplay', 'kolFormatPercentDisplay', 'kolFormatQuantityDisplay',
  'kolWeightedAverage', 'kolArithmeticAverage', 'kolWeightedLandedChange',
  'kolLandedIsNonDtr', 'kolLandedPriceWithRule', 'kolComputeFobFromConfirmed',
  'shipRoundHalfUp2', 'endeksmatikRound2Excel', 'endeksmatikNumber',
  'normalizePricingRuleSeasons', 'pricingRuleSeasonMatches', 'pricingRuleSeasonSetsOverlap',
  'sameOrderCode', 'kolPlmLevenshtein', 'kolPlmSeason',
], { window: { BLCollectionModelGroups: require('../public/collection-model-groups') }, BLShippingEngine: require('../public/shipping-engine') });

const close = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < 1e-9, `${message || ''} ${actual} ≠ ${expected}`);

test('Sayı ayrıştırma: Türkçe ve İngilizce ondalık/binlik gösterimleri doğru okunur', () => {
  assert.equal(fn.numericFilterValue('1.234,56'), 1234.56);
  assert.equal(fn.numericFilterValue('1,234.56'), 1234.56);
  assert.equal(fn.numericFilterValue('$ 12,50'), 12.5);
  assert.equal(fn.numericFilterValue('1.234.567'), 1234567, 'birden çok nokta binlik ayırıcıdır');
  assert.equal(fn.numericFilterValue('2.364'), 2.364, 'tipsiz alanda tek nokta ondalıktır');
  assert.equal(fn.numericFilterValue('2.364', { type: 'quantity' }), 2364, 'adet alanında 2.364 = iki bin üç yüz altmış dört');
  assert.equal(fn.numericFilterValue('2.364', { schema: { dataType: 'int' } }), 2364);
  assert.equal(fn.numericFilterValue(42), 42);
  for (const empty of ['', null, undefined, 'abc', NaN, Infinity]) assert.equal(fn.numericFilterValue(empty), null, String(empty));
  assert.equal(fn.tableNumericValue('1.234,5'), 1234.5);
  assert.equal(fn.tableNumericValue(''), 0, 'tablo toplamında boş hücre 0 sayılır');
  assert.equal(fn.tableNumericValue(NaN), 0);
});

test('Sayısal filtre kuralları: aralık sınırları ters girilse de çalışır, geçersiz değer elenir', () => {
  const passes = (rule, value) => fn.numericFilterRulePasses(rule, value);
  assert.equal(passes(null, 'x'), true, 'kural yoksa her satır geçer');
  assert.equal(passes({ op: 'between', a: '10', b: '5' }, 7), true);
  assert.equal(passes({ op: 'between', a: '5', b: '10' }, 10), true, 'sınırlar dahil');
  assert.equal(passes({ op: 'between', a: '5', b: '10' }, 11), false);
  assert.equal(passes({ op: 'gte', a: '3' }, '3'), true);
  assert.equal(passes({ op: 'lt', a: '3' }, '3'), false);
  assert.equal(passes({ op: 'neq', a: '3' }, 4), true);
  assert.equal(passes({ op: 'aboveAvg', avg: 5 }, 6), true);
  assert.equal(passes({ op: 'aboveAvg', avg: 5 }, 5), false);
  assert.equal(passes({ op: 'gt', a: '1' }, 'yok'), false, 'sayı olmayan hücre sayısal filtreyi geçmez');
  assert.equal(passes({ op: 'bilinmeyen', a: 1 }, 2), false);
});

test('Koleksiyon para/adet biçimleri: virgüllü gösterim, binlik ayırıcı, sayı dışı değer korunur', () => {
  assert.equal(fn.kolParseQuantityNum('1.200'), 1200);
  assert.equal(fn.kolParseQuantityNum('12 adet'), 12);
  assert.equal(fn.kolParseQuantityNum('-35'), -35);
  assert.ok(Number.isNaN(fn.kolParseQuantityNum('')));
  assert.equal(fn.kolParseMoneyNum('12,5'), 12.5);
  assert.equal(fn.kolParseMoneyNum('15%'), 15);
  assert.equal(fn.kolFormatMoneyDisplay('12.5'), '12,50');
  assert.equal(fn.kolFormatMoneyDisplay('TBD'), 'TBD', 'sayı olmayan metin olduğu gibi kalır');
  assert.equal(fn.kolFormatMoneyDisplay(''), '');
  assert.equal(fn.kolFormatPercentDisplay('7'), '7,00%');
  assert.equal(fn.kolFormatQuantityDisplay('12000'), '12.000');
  assert.equal(fn.formatQuantityTotal(1234.5), '1.234,5');
  assert.equal(fn.formatQuantityTotal(999.9999999999), '1.000', 'kayan nokta artığı tam sayıya yuvarlanır');
});

test('Ülke para birimi: Türkiye ₺, diğerleri $ ile yazılır', () => {
  assert.equal(fn.isTurkeyCountry('Türkiye'), true);
  assert.equal(fn.isTurkeyCountry(' turkey '), true);
  assert.equal(fn.isTurkeyCountry('Germany'), false);
  assert.equal(fn.fmtMoney(12.5, 'Türkiye'), '12.50 ₺');
  assert.equal(fn.fmtMoney('12.5', 'USA'), '$12.50');
  assert.equal(fn.fmtMoney('x', 'USA'), '');
  assert.equal(fn.fmtPct(0.256), '26%');
});

test('Ağırlıklı ortalama FOB: adetle ağırlıklandırır, adetsiz/fiyatsız satırı dışarıda bırakır', () => {
  const rows = [
    { quantity: 100, fob: '10' },
    { quantity: '300', fob: '20,00' },
    { quantity: 0, fob: '999' },
    { quantity: 50, fob: '' },
    { quantity: 50, fob: '0' },
  ];
  close(fn.kolWeightedAverage(rows, row => row.fob), 17.5);
  assert.equal(fn.kolWeightedAverage([], row => row.fob), null);
  assert.equal(fn.kolWeightedAverage(null, row => row.fob), null);
  // CP/Siparişler kendi adet alanını verir.
  close(fn.kolWeightedAverage([{ q: '1.000', p: 2 }, { q: '3.000', p: 4 }], row => row.p, row => row.q), 3.5);
  close(fn.kolArithmeticAverage([{ p: '10' }, { p: '20' }, { p: 'x' }, { p: '0' }], row => row.p), 15);
  assert.equal(fn.kolArithmeticAverage([{ p: '' }], row => row.p), null);
});

test('Landed değişimi: TR landed ağırlıklı ortalamasına göre yüzde fark', () => {
  const a = { quantity: 100 }, b = { quantity: 100 }, skipped = { quantity: 500 };
  const landed = new Map([[a, { ydLanded: '10', trLanded: '12' }], [b, { ydLanded: '20', trLanded: '28' }], [skipped, { ydLanded: '5', trLanded: '' }]]);
  close(fn.kolWeightedLandedChange([a, b, skipped], landed), 25); // YD 15, TR 20 → (20-15)/20
  assert.equal(fn.kolWeightedLandedChange([skipped], landed), null);
});

test('Lisanslı (non-DTR) landed fiyat: royalty paydadan, hologram eklenerek hesaplanır', () => {
  assert.equal(fn.kolLandedIsNonDtr({ licensor: 'dtr' }), false);
  assert.equal(fn.kolLandedIsNonDtr({ licensor: 'Disney' }), true);
  assert.equal(fn.kolLandedIsNonDtr({}), false);
  const rule = { royalty: 20, hologramCost: 0.05 };
  assert.equal(fn.kolLandedPriceWithRule(10, { licensor: 'DTR' }, null), 10, 'DTR ürününde kural gerekmez');
  assert.equal(fn.kolLandedPriceWithRule(10, { licensor: 'Disney' }, null), null, 'kural yoksa lisanslı fiyat UYDURULMAZ');
  close(fn.kolLandedPriceWithRule(10, { licensor: 'Disney' }, rule), 12.55);
  close(fn.kolLandedPriceWithRule(10, { licensor: 'Disney' }, { royalty: -5, hologramCost: 'x' }), 10, 'geçersiz oranlar yok sayılır');
  assert.equal(fn.kolLandedPriceWithRule(10, { licensor: 'Disney' }, { royalty: 100 }), null, '%100 royalty sıfıra bölmez');
  assert.equal(fn.kolLandedPriceWithRule(0, { licensor: 'DTR' }, rule), null);
  assert.equal(fn.kolComputeFobFromConfirmed('8', '20', '0,1'), '10,10');
  assert.equal(fn.kolComputeFobFromConfirmed('8', '', ''), '8,00');
  assert.equal(fn.kolComputeFobFromConfirmed('x', '20', '0'), '');
  assert.equal(fn.kolComputeFobFromConfirmed('8', '100', '0'), '');
});

test('Excel uyumlu yuvarlama: 1.005 gibi ikili kayan nokta sınırları yukarı yuvarlanır', () => {
  assert.equal(fn.shipRoundHalfUp2(1.005), 1.01);
  assert.equal(fn.shipRoundHalfUp2(2.675), 2.68);
  assert.equal(fn.shipRoundHalfUp2(-1.005), -1.01, 'negatifte mutlak değer yukarı');
  assert.equal(fn.shipRoundHalfUp2(1.004), 1);
  assert.equal(fn.shipRoundHalfUp2('x'), null);
  assert.equal(fn.endeksmatikRound2Excel(1.005), 1.01);
  assert.equal(fn.endeksmatikRound2Excel(-2.345), -2.35);
  assert.ok(Number.isNaN(fn.endeksmatikRound2Excel('x')));
  assert.equal(fn.endeksmatikNumber('₺1.234,50'), 1234.5);
  assert.equal(fn.endeksmatikNumber('%12'), 12);
  assert.equal(fn.endeksmatikNumber(''), null);
  assert.equal(fn.endeksmatikNumber('abc'), null);
});

test('Fiyat kuralı sezonları: Türkçe büyük/küçük harf duyarsız, tekrarsız; boş liste tüm sezonlar demektir', () => {
  assert.deepEqual([...fn.normalizePricingRuleSeasons(['6W26', '6s27', ' 6S27 ', '', null])], ['6s27', '6W26']);
  assert.deepEqual([...fn.normalizePricingRuleSeasons('6W26')], ['6W26']);
  assert.deepEqual([...fn.normalizePricingRuleSeasons(null)], []);
  assert.equal(fn.pricingRuleSeasonMatches({ seasons: [] }, '6S27'), true);
  assert.equal(fn.pricingRuleSeasonMatches({ season: '6S27' }, '6s27'), true);
  assert.equal(fn.pricingRuleSeasonMatches({ seasons: ['6W26'] }, '6S27'), false);
  assert.equal(fn.pricingRuleSeasonMatches({ seasons: ['6W26'] }, ''), false, 'sezonu olmayan satır sezonlu kurala uymaz');
  assert.equal(fn.pricingRuleSeasonSetsOverlap({ seasons: ['A', 'B'] }, { season: 'b' }), true);
  assert.equal(fn.pricingRuleSeasonSetsOverlap({ season: 'A' }, { season: 'C' }), false);
  assert.equal(fn.pricingRuleSeasonSetsOverlap({ seasons: [] }, { season: 'C' }), true, 'sezonsuz kural tüm sezonlarla çakışır');
});

test('Kimlik/metin eşleştirme: sipariş kodu, Türkçe normalizasyon, PLM sezon ve benzerlik', () => {
  assert.equal(fn.sameOrderCode('00123', 123), true, 'baştaki sıfırlar aynı siparişi değiştirmez');
  assert.equal(fn.sameOrderCode('A1', ' A1 '), true);
  assert.equal(fn.sameOrderCode('A1', 'A2'), false);
  assert.equal(fn.turknorm('  şişli   çğü  '), 'SISLI CGU');
  assert.equal(fn.turknorm('İstanbul'), 'ISTANBUL');
  assert.equal(fn.turknorm(null), '');
  assert.equal(fn.kolPlmSeason('w26 core'), 'W26');
  assert.equal(fn.kolPlmSeason('Yaz'), 'Yaz');
  assert.equal(fn.kolPlmSeason(''), '');
  assert.equal(fn.kolPlmLevenshtein('kitten', 'sitting'), 3);
  assert.equal(fn.kolPlmLevenshtein('', 'abc'), 3);
  assert.equal(fn.kolPlmLevenshtein('aynı', 'aynı'), 0);
});
