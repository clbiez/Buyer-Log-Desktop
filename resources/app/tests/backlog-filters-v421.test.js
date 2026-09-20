'use strict';
/*
 * v4.20 — Backlog filtreleri CP'den bağımsız.
 *
 * Backlog'un filtre listeleri state.orderSummary üzerinden, yani CP veri kümesinden
 * üretiliyordu. CP kapsamı Backlog kapsamından dar olduğu için (ör. 322'ye karşı
 * 3111 sipariş) Backlog raporunda bulunan MAG ve Buying Group değerleri filtre
 * listesinde hiç görünmüyor, dolayısıyla filtrelenemiyordu.
 *
 * Değerler artık /api/backlog yanıtından gelir: dimValues (tarih penceresindeki tüm
 * değerler) ve dimValuesActive (mevcut filtrelerden sonra hâlâ veri getirenler).
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const parse = require(path.join(__dirname, '..', 'server', 'lib', 'parse.js'));

const OV = {
  notesmap: {}, submap: {}, suppfobmap: {}, suppfobmetamap: {},
  delmap: {}, licensormap: {}, datemap: {}, pricingRules: [], transitRules: [],
};

let seq = 0;
function order(extra) {
  seq += 1;
  return Object.assign({
    ocode: 1000000 + seq, model: 'MODEL ' + seq, ccode: 'C' + seq, colour: 'SIYAH',
    season: 'W6', countryRaw: 'MISIR', manufacturer: 'ÜRETİCİ', license: 'HARRY POTTER',
    category: 'KAZAK', merch: '12', ageGroup: 'A1', buyer: 'BUYER 1', buyerGrup: 'KIDS',
    line: 'LINE 1', qty: 100, kalan: 100, fob: 5,
    opd: new Date(2026, 0, 1), ex: new Date(2026, 7, 1),
    retail: new Date(2026, 9, 7), mb: new Date(2026, 8, 23), merkezSevkeHazirKalan: 0,
  }, extra || {});
}

function backlog(orders, opts) {
  return parse.buildBacklogGrouped(orders, {}, OV, Object.assign({ groupBy: ['buyerGrup'] }, opts || {}));
}

test('yanıt her boyut için değer listesi taşır', () => {
  const report = backlog([order(), order({ merch: '13', buyerGrup: 'MEN' })]);
  assert.ok(report.dimValues, 'dimValues dönmeli');
  for (const dim of ['merch', 'buyerGrup', 'ageGroup', 'season', 'country', 'status', 'buyer', 'category', 'manufacturer', 'line']) {
    assert.ok(Array.isArray(report.dimValues[dim]), `${dim} listesi olmalı`);
  }
});

test('listeler raporun kendi veri kümesini yansıtır — rapora giren her değer listede var', () => {
  const orders = [order({ merch: '12' }), order({ merch: '13' }), order({ merch: '14' })];
  const report = backlog(orders);
  assert.deepStrictEqual(report.dimValues.merch, ['12', '13', '14']);
  assert.deepStrictEqual(report.dimValues.buyerGrup, ['KIDS']);
});

test('Buying Group da diğer boyutlar gibi filtrelenebilir', () => {
  const orders = [order({ buyerGrup: 'KIDS' }), order({ buyerGrup: 'MEN' }), order({ buyerGrup: 'WOMEN' })];
  assert.deepStrictEqual(backlog(orders).dimValues.buyerGrup, ['KIDS', 'MEN', 'WOMEN']);
  const filtered = backlog(orders, { buyerGrup: ['MEN'] });
  assert.strictEqual(filtered.totalOrders, 1);
  assert.deepStrictEqual(filtered.dimValuesActive.buyerGrup, ['MEN']);
});

test('bir boyutu filtrelemek diğer boyutun SEÇENEKLERİNİ kaybettirmez', () => {
  // Seçenek listesi tarih penceresinden üretilir; yalnız "aktif" işareti daralır.
  const orders = [
    order({ merch: '12', buyerGrup: 'KIDS' }),
    order({ merch: '13', buyerGrup: 'MEN' }),
  ];
  const report = backlog(orders, { dimFilters: { merch: ['12'] } });
  assert.deepStrictEqual(report.dimValues.buyerGrup, ['KIDS', 'MEN'], 'seçenekler eksilmemeli');
  assert.deepStrictEqual(report.dimValuesActive.buyerGrup, ['KIDS'], 'aktif küme daralmalı');
});

test('MAG filtresi rapora gerçekten uygulanır', () => {
  const orders = [order({ merch: '12' }), order({ merch: '13' }), order({ merch: '13' })];
  assert.strictEqual(backlog(orders).totalOrders, 3);
  assert.strictEqual(backlog(orders, { dimFilters: { merch: ['13'] } }).totalOrders, 2);
});

test('Buying Group ve boyut filtresi birlikte çalışır', () => {
  const orders = [
    order({ merch: '12', buyerGrup: 'KIDS' }),
    order({ merch: '13', buyerGrup: 'KIDS' }),
    order({ merch: '13', buyerGrup: 'MEN' }),
  ];
  const report = backlog(orders, { buyerGrup: ['KIDS'], dimFilters: { merch: ['13'] } });
  assert.strictEqual(report.totalOrders, 1);
});

test('tarih penceresi dışındaki siparişler seçeneklere girmez', () => {
  const orders = [
    order({ merch: '12', retail: new Date(2026, 9, 7) }),
    order({ merch: '99', retail: new Date(2027, 5, 1) }),
  ];
  const report = backlog(orders, { retailFrom: '2026-10-01', retailTo: '2026-10-31' });
  assert.deepStrictEqual(report.dimValues.merch, ['12']);
});

test('Backlog filtre panelleri CP veri kümesini kullanmıyor', () => {
  const html = (fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf-8') + '\n' + fs.readFileSync(path.join(__dirname, '..', 'public', 'app-main.js'), 'utf-8'));
  const start = html.indexOf('let backlogDimFilters');
  const end = html.indexOf('function fetchCurrentBacklog');
  assert.ok(start > 0 && end > start, 'backlog bölümü bulunamadı');
  const section = html.slice(start, end);
  const hits = section.split('\n').filter(line => line.includes('state.orderSummary') && !line.trim().startsWith('//'));
  assert.deepStrictEqual(hits, [], 'Backlog bölümü CP veri kümesine bağlı kalmamalı');
  assert.ok(section.includes('backlogDimValues'), 'değerler backlog yanıtından okunmalı');
});

test('Satır/Sütun alanındaki her boyut filtre düğmesi alır', () => {
  const html = (fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf-8') + '\n' + fs.readFileSync(path.join(__dirname, '..', 'public', 'app-main.js'), 'utf-8'));
  // v4.21: tarih boyutu da düğme alır (Yıl/Ay/Hafta/Gün akordiyonu ile).
  assert.ok(html.includes('const canFilter = true;'),
    'Buying Group ve Antrepo Giriş Tarihi dahil her boyut filtrelenebilmeli');
});

// ---------------------------------------------------------------------------
// v4.21 — Antrepo Giriş Tarihi kova filtresi (Yıl/Ay/Hafta/Gün)
// ---------------------------------------------------------------------------

test('tarih boyutu için her kademede değer listesi döner', () => {
  const report = backlog([order(), order()]);
  const dv = report.dimValues.antrepoDate;
  assert.ok(dv, 'antrepoDate değerleri dönmeli');
  assert.deepStrictEqual(Object.keys(dv), ['year', 'month', 'week', 'day']);
  assert.ok(dv.month.every(v => /^\d{4}-\d{2}$/.test(v)), 'ay anahtarı YYYY-MM olmalı');
  assert.ok(dv.day.every(v => /^\d{4}-\d{2}-\d{2}$/.test(v)), 'gün anahtarı YYYY-MM-DD olmalı');
});

test('ay kovasına göre filtreleme rapora uygulanır', () => {
  const orders = [order(), order(), order()];
  const all = backlog(orders);
  const month = all.dimValues.antrepoDate.month[0];
  assert.strictEqual(backlog(orders, { dimFilters: { antrepoDate: { granularity: 'month', values: [month] } } }).totalOrders, 3);
  assert.strictEqual(backlog(orders, { dimFilters: { antrepoDate: { granularity: 'month', values: ['1999-01'] } } }).totalOrders, 0);
});

test('tarih filtresi diğer boyut filtreleriyle birlikte çalışır', () => {
  const orders = [order({ merch: '12' }), order({ merch: '13' })];
  const month = backlog(orders).dimValues.antrepoDate.month[0];
  const report = backlog(orders, {
    dimFilters: { merch: ['12'], antrepoDate: { granularity: 'month', values: [month] } },
  });
  assert.strictEqual(report.totalOrders, 1);
});

test('geçersiz kademe yok sayılır, rapor boşalmaz', () => {
  const orders = [order(), order()];
  const report = backlog(orders, { dimFilters: { antrepoDate: { granularity: 'saat', values: ['x'] } } });
  assert.strictEqual(report.totalOrders, 2);
});

test('Backlog ve alan eşlemesi ortak filtre bileşenini kullanıyor', () => {
  const html = (fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf-8') + '\n' + fs.readFileSync(path.join(__dirname, '..', 'public', 'app-main.js'), 'utf-8'));
  assert.ok(html.includes('function openValueFilterPanel('), 'ortak bileşen tanımlı olmalı');
  // Uygula / Geçerli Seçime Ekle / Filtreyi Kaldır / Ara
  for (const label of ['cfpApplySelection', 'cfpAddSelection', 'cfpRemoveSelection', 'cfpSearch']) {
    assert.ok(html.includes(label), `${label} bileşende olmalı`);
  }
  // Üstteki boyut filtresi kısayolları kaldırıldı (aynı filtreler hem üstte hem
  // Grupla listesinde tekrar ediyordu). Korunması gereken garanti aynı: boyut
  // filtre düğmeleri ORTAK paneli açar — artık Grupla ve Hiyerarşi listelerinde.
  assert.ok(html.includes('.backlogDimFilterBtn'), 'boyut filtre düğmeleri tanımlı olmalı');
  assert.ok(html.includes('openBacklogDimFilterPanel(b.dataset.dim, b)'),
    'boyut filtre düğmeleri de aynı ortak paneli açmalı');
  /* v7.81: alan eşlemesi eski bağlantı modalından Veri Yönetimi'ne taşındı.
     Korunan kural aynı: eşleme ARANABİLİR bir seçici kullanır, 50 satırlık
     aranamayan bir açılır liste değil. */
  const mappingUi = fs.readFileSync(path.join(__dirname, '..', 'public', 'data-management-mapping.js'), 'utf-8');
  assert.ok(mappingUi.includes('window.BLDataPicker?.open?.('), 'alan eşlemesi aranabilir seçici kullanmalı');
  assert.ok(!/<select data-map=/.test(html + mappingUi), 'eski aranamayan açılır liste kalmamalı');
});
