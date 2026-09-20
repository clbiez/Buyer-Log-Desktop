'use strict';

/*
 * COPILOT — KAPSAM SÜZGECİ VE ARAÇ ÇEŞİTLİLİĞİ
 *
 * Bu dosyanın varlık sebebi ilk sürümde bulunan sessiz bir yanlış:
 *
 *   bestSupplierPrice kapsamı (sezon, ürün) YALNIZ Horizon kontrolünde ve
 *   kanıt panelinde kullanıyordu. Hesap ise gelen kayıtların TAMAMI üzerinden
 *   yapılıyordu. Kullanıcı "Sezon: S7 · Ürün: T-Shirt" yazan bir kanıt
 *   panelinin yanında, bambaşka bir kümeden gelen bir fiyat görüyordu.
 *
 * Bu, kullanıcının kendi koyduğu kuralın tam ihlaliydi: "Yanlış ama kendinden
 * emin cevap, cevap vermemekten daha kötüdür." Aşağıdaki testler kapsamın
 * gerçekten UYGULANDIĞINI ve her yeni aracın aynı kapıdan geçtiğini kilitler.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const tools = require('../public/copilot-tools.js');
const COPILOT = fs.readFileSync(path.join(__dirname, '..', 'public', 'copilot.js'), 'utf8');

/* Kapsam dışında KASITLI olarak farklı fiyat düzeyleri var: süzgeç
   uygulanmazsa sonuç gözle görülür biçimde kayar. */
function dataset() {
  const rows = [];
  const add = (season, classification, manufacturer, price, modelKey, currency = 'USD') =>
    rows.push({ season, classification, manufacturer, price, currency, modelKey, quantity: 100 });

  // Kapsam: S7 · T-Shirt  → ABC ucuz (10, 11), DEF pahalı (14, 15)
  add('S7', 'T-Shirt', 'ABC', 10, 'm1'); add('S7', 'T-Shirt', 'ABC', 11, 'm2');
  add('S7', 'T-Shirt', 'DEF', 14, 'm3'); add('S7', 'T-Shirt', 'DEF', 15, 'm4');
  // Başka sezon, aynı ürün — süzülmezse trendi ve medyanı bozar.
  add('S6', 'T-Shirt', 'ABC', 8, 'm5'); add('S6', 'T-Shirt', 'DEF', 9, 'm6');
  add('S6', 'T-Shirt', 'GHI', 9.5, 'm7');
  // Aynı sezon, başka ürün — süzülmezse "en ucuz üretici" cevabını değiştirir.
  add('S7', 'Sweat', 'XYZ', 30, 'm8'); add('S7', 'Sweat', 'XYZ', 31, 'm9');
  add('S7', 'Sweat', 'ABC', 33, 'm10');
  return rows;
}

const BASE = () => ({
  observations: dataset(),
  horizon: { bounded: false },
  freshness: { lastRefreshAt: new Date().toISOString() },
});

const S7_TSHIRT = { season: 'S7', product: 'T-Shirt' };

/* ------------------------------------------------------- KAPSAM SÜZGECİ */

test('kapsam kayıtlara GERÇEKTEN uygulanır', () => {
  const result = tools.bestSupplierPrice({ ...BASE(), scope: S7_TSHIRT });
  assert.equal(result.answerable, true);
  assert.equal(result.provenance.scopedRecordCount, 4, 'yalnız S7 T-Shirt kayıtları hesaba girmeli');
  assert.equal(result.provenance.searchedRecordCount, 10, 'kaç kayıt tarandığı da söylenmeli');
  assert.equal(result.coverage.recordCount, 4);
});

test('kapsam dışı kayıtlar cevabı DEĞİŞTİREMEZ', () => {
  /* S6 T-Shirt'te GHI 9.5 ile en ucuz; süzgeç olmasaydı S7 sorusunun cevabı
     hiç S7'de üretim yapmayan bir üretici olabilirdi. */
  const result = tools.bestSupplierPrice({ ...BASE(), scope: S7_TSHIRT });
  assert.equal(result.best.manufacturer, 'ABC');
  assert.equal(result.best.medianPrice, 10.5);
  assert.deepEqual(result.ranking.map(item => item.manufacturer), ['ABC', 'DEF']);
});

test('kapsam TAM eşleşir, içerme ile değil', () => {
  /* "Shirt" kapsamı "T-Shirt" kayıtlarını toplasaydı, aynı sınıf hata başka
     kılıkta geri gelirdi. */
  const result = tools.bestSupplierPrice({ ...BASE(), scope: { season: 'S7', product: 'Shirt' } });
  assert.equal(result.answerable, false);
  assert.equal(result.state, tools.STATES.NO_DATA);
});

test('boş kapsamda "veri yok" ile "bu kapsamda yok" ayrılır', () => {
  const result = tools.bestSupplierPrice({ ...BASE(), scope: { season: 'S9', product: 'T-Shirt' } });
  assert.equal(result.state, tools.STATES.NO_DATA);
  assert.match(result.message, /S9/, 'hangi kapsamda bulunamadığı söylenmeli');
  assert.equal(result.searchedRecordCount, 10, 'kaç kayda bakıldığı söylenmeli');
});

test('kapsam süzgeci büyük/küçük harfe takılmaz', () => {
  const result = tools.bestSupplierPrice({ ...BASE(), scope: { season: 's7', product: 't-shirt' } });
  assert.equal(result.answerable, true);
  assert.equal(result.provenance.scopedRecordCount, 4);
});

/* ------------------------------------------------------------- ARAÇLAR */

test('fiyat özeti kapsam içinde hesaplanır', () => {
  const result = tools.priceSummary({ ...BASE(), scope: S7_TSHIRT });
  assert.equal(result.answerable, true);
  assert.equal(result.summary.median, 12.5);
  assert.equal(result.summary.min, 10);
  assert.equal(result.summary.max, 15);
  assert.equal(result.summary.spreadPercent, 40);
});

test('yoğunlaşma payları modele göre ve toplamı %100', () => {
  const result = tools.supplierConcentration({ ...BASE(), scope: S7_TSHIRT });
  assert.equal(result.answerable, true);
  assert.equal(result.shares.length, 2);
  assert.equal(Math.round(result.shares.reduce((sum, item) => sum + item.sharePercent, 0)), 100);
});

test('tek üretici varsa yoğunlaşma BULGUSU üretilmez', () => {
  /* Tek üreticiye "%100 yoğunlaşmış" demek bir bulgu değil, kapsamın kendisini
     bulgu diye sunmaktır. */
  const result = tools.supplierConcentration({ ...BASE(), scope: { season: 'S6', product: 'T-Shirt', manufacturer: 'ABC' } });
  assert.equal(result.answerable, false);
  assert.equal(result.state, tools.STATES.INSUFFICIENT_DATA);
});

test('sapan fiyat yoksa bu bir cevapsızlık değil, cevabın kendisidir', () => {
  const result = tools.priceOutliers({ ...BASE(), scope: S7_TSHIRT });
  assert.equal(result.answerable, true);
  assert.equal(result.clean, true);
  assert.deepEqual(result.outliers, []);
});

test('iki üretici karşılaştırılır ve ucuz olan işaretlenir', () => {
  const result = tools.compareSuppliers({ ...BASE(), scope: S7_TSHIRT, manufacturers: ['ABC', 'DEF'] });
  assert.equal(result.answerable, true);
  assert.equal(result.cheapest.manufacturer, 'ABC');
  assert.equal(result.compared.length, 2);
  assert.ok(result.gapPercent > 0);
});

test('kayıtlarda olmayan üretici UYDURULMAZ', () => {
  const result = tools.compareSuppliers({ ...BASE(), scope: S7_TSHIRT, manufacturers: ['ABC', 'YOK A.Ş.'] });
  assert.equal(result.answerable, false);
  assert.equal(result.state, tools.STATES.NO_DATA);
  assert.deepEqual(result.missing, ['YOK A.Ş.']);
});

test('tek üretici adıyla karşılaştırma istenmez', () => {
  const result = tools.compareSuppliers({ ...BASE(), scope: S7_TSHIRT, manufacturers: ['ABC'] });
  assert.equal(result.state, tools.STATES.AMBIGUOUS);
});

test('sezon seyri sezonu kapsamdan DÜŞÜRÜR', () => {
  /* Sezon kapsamda kalsaydı süzgeç tek sezona indirir ve "seyir" hiç
     hesaplanamazdı — araç kendi girdisini yok ederdi. */
  const result = tools.seasonTrend({ ...BASE(), scope: S7_TSHIRT });
  assert.equal(result.answerable, true);
  assert.deepEqual(result.seasons.map(item => item.season), ['S6', 'S7']);
  assert.equal(result.from.season, 'S6');
  assert.equal(result.to.season, 'S7');
  assert.ok(result.changePercent > 0);
});

test('tek sezondan TREND çıkarılmaz', () => {
  const rows = dataset().filter(item => item.season === 'S7');
  const result = tools.seasonTrend({ ...BASE(), observations: rows, scope: { product: 'T-Shirt' } });
  assert.equal(result.answerable, false);
  assert.equal(result.state, tools.STATES.INSUFFICIENT_DATA);
});

/* ---------------------------------------------------------- ORTAK KAPI */

test('her araç aynı kapıdan geçer: yetki reddi hiçbirinde atlanmaz', () => {
  const denied = { permission: { allowed: false, reason: 'yetki yok' } };
  for (const id of ['bestSupplierPrice', 'priceSummary', 'supplierConcentration',
    'priceOutliers', 'seasonTrend']) {
    const result = tools[id]({ ...BASE(), ...denied, scope: S7_TSHIRT });
    assert.equal(result.state, tools.STATES.PERMISSION_DENIED, id);
  }
  const compare = tools.compareSuppliers({ ...BASE(), ...denied, scope: S7_TSHIRT, manufacturers: ['ABC', 'DEF'] });
  assert.equal(compare.state, tools.STATES.PERMISSION_DENIED, 'compareSuppliers');
});

test('her araç Horizon dışını reddeder', () => {
  const horizon = { bounded: true, seasons: ['S6'] };
  for (const id of ['bestSupplierPrice', 'priceSummary', 'supplierConcentration', 'priceOutliers']) {
    const result = tools[id]({ ...BASE(), horizon, scope: S7_TSHIRT });
    assert.equal(result.state, tools.STATES.OUT_OF_HORIZON, id);
    assert.equal(result.canOfferTemporaryScope, true, id);
  }
});

test('her cevap kendi dayanağını taşır', () => {
  for (const id of ['bestSupplierPrice', 'priceSummary', 'supplierConcentration', 'priceOutliers']) {
    const result = tools[id]({ ...BASE(), scope: S7_TSHIRT });
    assert.equal(result.answerable, true, id);
    assert.ok(result.provenance && result.provenance.module, `${id}: kaynak modül`);
    assert.ok(result.coverage, `${id}: kapsam sayıları`);
    assert.equal(result.currency, 'USD', `${id}: para birimi`);
    assert.ok(result.freshness, `${id}: tazelik`);
  }
});

test('bayat veri hâlâ cevaplanır ama yaşı söylenir', () => {
  const stale = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const result = tools.priceSummary({ ...BASE(), freshness: { lastRefreshAt: stale }, scope: S7_TSHIRT });
  assert.equal(result.answerable, true);
  assert.equal(result.state, tools.STATES.STALE_DATA);
  assert.equal(result.freshness.stale, true);
});

test('karışık para biriminde baskın olanda karşılaştırılır, kalanı açıkça dışarıda', () => {
  const rows = dataset();
  rows.push({ season: 'S7', classification: 'T-Shirt', manufacturer: 'TRY Co', price: 300, currency: 'TRY', modelKey: 'm11', quantity: 10 });
  const result = tools.priceSummary({ ...BASE(), observations: rows, scope: S7_TSHIRT });
  assert.equal(result.currency, 'USD');
  assert.deepEqual(result.excludedCurrencies, ['TRY']);
  assert.equal(result.excludedRecordCount, 1);
  assert.equal(result.summary.max, 15, '300 TRY dolar medyanına karışmamalı');
});

/* -------------------------------------------------------- YÖNLENDİRME */

/* copilot.js tarayıcı IIFE'si; yönlendirici saf olduğu için asgari bir
   global ile yüklenebiliyor. */
function loadCopilot() {
  const context = {
    console, setTimeout,
    document: { addEventListener() {} },
    fetch: () => Promise.reject(new Error('ağ yok')),
    BLCopilotTools: tools,
    BLCopilotGrounding: require('../public/copilot-grounding.js'),
    BLCopilotActions: require('../public/copilot-actions.js'),
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(COPILOT, context, { filename: 'copilot.js' });
  return context.BLCopilot._test;
}

const copilot = loadCopilot();

/* vm bağlamındaki diziler farklı bir realm'e ait; deepStrictEqual prototip
   kimliğine de bakar. JSON'a indirgemek yapı karşılaştırmasını sürdürürken
   bu yanlış negatifi kaldırır. */
const plain = value => JSON.parse(JSON.stringify(value));

test('soru doğru araca yönlendirilir', () => {
  const cases = [
    ['S7 T-Shirt için en uygun üretici kim?', 'bestSupplierPrice'],
    ['S7 T-Shirt ortalama fiyat kaç?', 'priceSummary'],
    ['S7 T-Shirt ABC ile DEF karşılaştır', 'compareSuppliers'],
    ['S7 T-Shirt üretimi hangi üreticide yoğunlaşmış?', 'supplierConcentration'],
    ['S7 T-Shirt içinde sapan fiyat var mı?', 'priceOutliers'],
    ['T-Shirt fiyatları sezonlara göre nasıl değişmiş?', 'seasonTrend'],
  ];
  for (const [question, expected] of cases) {
    const route = copilot.routeFor(question);
    assert.ok(route, `yönlendirilemedi: ${question}`);
    assert.equal(route.id, expected, question);
  }
});

test('tanınmayan soru en yakın araca ZORLANMAZ', () => {
  /* Bilinmeyen bir soruyu en yakın araca itmek, kullanıcının sormadığı soruya
     kendinden emin bir cevap vermektir. */
  for (const question of ['bugün hava nasıl?', 'gemi ne zaman gelir', 'stok durumu']) {
    assert.equal(copilot.routeFor(question), null, question);
  }
});

test('cevaplayamadığında ne yapabildiğini söyler', () => {
  const html = copilot.renderCapabilities();
  for (const item of tools.capabilities()) {
    assert.ok(html.includes(item.tr.replace(/&/g, '&amp;')), `yetenek listede yok: ${item.tr}`);
  }
  assert.match(html, /data-bcp-ask/, 'tıklanabilir örnek soru sunmalı');
});

test('yetenek listesi araç katmanıyla AYNI adları kullanır', () => {
  /* Elle yazılmış bir liste, araç eklenince sessizce eskir ve kullanıcıya
     yapabildiğinden azını ya da yapamadığını vaat eder. */
  const analytic = tools.capabilities().map(item => item.id).filter(id => typeof tools[id] === 'function');
  const routed = copilot.ROUTES.map(route => route.id);
  assert.deepEqual([...analytic].sort(), [...routed].sort(),
    'yönlendirilen her araç yeteneklerde, her analitik yetenek yönlendirmede olmalı');
});

test('üretici adları cümleden değil VERİDEN tanınır', () => {
  const rows = dataset();
  assert.deepEqual(plain(copilot.manufacturersIn('ABC ile DEF karşılaştır', rows)).sort(), ['ABC', 'DEF']);
  assert.deepEqual(plain(copilot.manufacturersIn('KAYITTA OLMAYAN ile DEF karşılaştır', rows)), ['DEF']);
});

test('kapsamdaki üretici listesi araç katmanının süzgecinden geçer', () => {
  assert.deepEqual(plain(copilot.scopeNames(dataset(), S7_TSHIRT)), ['ABC', 'DEF']);
  assert.deepEqual(plain(copilot.scopeNames(dataset(), { season: 'S6', product: 'T-Shirt' })), ['ABC', 'DEF', 'GHI']);
});

test('her araç için bir çizici vardır', () => {
  for (const route of copilot.ROUTES) {
    assert.equal(typeof copilot.RENDERERS[route.id], 'function', `çizici eksik: ${route.id}`);
  }
});
