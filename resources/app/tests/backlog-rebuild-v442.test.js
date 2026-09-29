'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

const parse = require(path.join(__dirname, '..', 'server', 'lib', 'parse.js'));

// Yerel gece yarısına ayarlı bir Date'te toISOString() UTC'ye çevirir; UTC+X saat
// dilimlerinde bu bir gün geriye kayar (2 Ocak → "2026-01-01"). Takvim gününü
// doğrudan yerel bileşenlerden okuyoruz ki iddia saat diliminden bağımsız olsun.
function calendarDay(value) {
  const p = n => String(n).padStart(2, '0');
  return `${value.getFullYear()}-${p(value.getMonth() + 1)}-${p(value.getDate())}`;
}


function asas(overrides = {}) {
  return {
    'Sipariş Kod': 'A',
    'Model Adı': 'MODEL-1',
    'Renk Kod': 'C01',
    'Renk': 'SİYAH',
    'Net Alım Sipariş Miktarı': 10000,
    'Kalan Alım Sipariş Miktarı': 10000,
    'Antrepoya Giren Miktar': 0,
    'Kalan Alım Sipariş Miktarı_Merkez Sevke Hazır Depo': 0,
    'FOB Fiyatı': 5,
    'Üretici': 'SUPPLIER',
    'Sezon': 'W6',
    'Buyer Grup (TR)': 'BG',
    'Siparişin Üretildiği Ülke': 'CIN',
    'Orijinal Exfactory Merch Tarih': '2026-01-01',
    'Retail Depo Tarih Yıl Ay Gün': '2026-06-01',
    'Model Bütçe Tarih Yıl Ay Gün': '2026-06-15',
    ...overrides,
  };
}

function ias(overrides = {}) {
  return {
    'Sipariş Kod': 'A',
    'Ürün Ad': 'MODEL-1',
    'Renk Kod': 'C01',
    'Renk Tanım': 'SİYAH',
    'Supplier Portal Statü': 'Depoda',
    'Tahmini Antrepo Giriş Tarihi': '2026-03-01',
    'HANDOVER Tarihi': '2026-02-20',
    'Vasita Tanim': 'Gemi',
    'Yükleme Toplam Adet': 3000,
    'Net Alım Sipariş Miktarı': 10000,
    ...overrides,
  };
}

function ov(extra = {}) {
  return {
    antrepoMatchConfig: parse.defaultAntrepoMatchConfig(),
    submap: {}, delmap: {}, suppfobmap: {}, suppfobmetamap: {}, notesmap: {}, licensormap: {},
    pricingRules: [], transitRules: [],
    ...extra,
  };
}

function parsed(asasRows, iasRows, overrides = ov()) {
  const orders = parse.parseASASRows(asasRows, overrides.antrepoMatchConfig).orders;
  const map = parse.parseAntrepoRows(iasRows, overrides.antrepoMatchConfig);
  return { orders, map, overrides };
}

test('v4.42 varsayılan kural ASAS Model Adı ile IAS Ürün Ad alanını birebir eşleştirir', () => {
  const config = parse.defaultAntrepoMatchConfig();
  assert.deepStrictEqual(config.conditions.map(c => [c.asas.header, c.ias.header]), [
    ['Sipariş Kod', 'Sipariş Kod'],
    ['Model Adı', 'Ürün Ad'],
    ['Renk Kod', 'Renk Kod'],
  ]);
  const { orders, map } = parsed([asas()], [ias()]);
  assert.strictEqual(parse.findAntrepoHits(map, orders[0], { config }).length, 1);
});

test('v4.50 IAS parsiyellerinden sonra yüzde 5 ve üzeri bakiye için Üretimde satırı oluşturur', () => {
  const { orders, map, overrides } = parsed([asas()], [
    ias({ 'Supplier Portal Statü': 'Depoda', 'Yükleme Toplam Adet': 3000, 'Tahmini Antrepo Giriş Tarihi': '2026-03-01' }),
    ias({ 'Supplier Portal Statü': 'Yol Operasyonları', 'Yükleme Toplam Adet': 4000, 'Tahmini Antrepo Giriş Tarihi': '2026-03-20' }),
  ]);
  const rows = parse.buildBacklogOperationalRows(orders, map, overrides);
  assert.strictEqual(rows.length, 3);
  assert.deepStrictEqual(rows.map(r => r.qty), [3000, 3000, 4000]);
  assert.deepStrictEqual(rows.map(r => r._status), ['Üretimde', 'Depoda', 'Yol Operasyonları']);
  assert.strictEqual(rows[1]._iasRow.vasita, 'Gemi');
  assert.strictEqual(rows[2]._iasRow.arr.getDate(), 20);
  assert.strictEqual(rows[0]._segmentKind, 'production');
  assert.strictEqual(rows.reduce((sum, row) => sum + row.qty, 0), 10000);
});

test('v4.42 IAS kaydı yoksa siparişin tamamı Üretimde olur ve antrepo tarihi yol süresinden hesaplanır', () => {
  const orderCode = 1001;
  const overrides = ov({ delmap: { [parse.orderLineKey(orderCode, 'MODEL-1', 'C01')]: 'Uçak' } });
  const { orders, map } = parsed([asas({ 'Sipariş Kod': orderCode, 'Net Alım Sipariş Miktarı': 5000 })], [], overrides);
  const rows = parse.buildBacklogOperationalRows(orders, map, overrides);
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].qty, 5000);
  assert.strictEqual(rows[0]._status, 'Üretimde');
  assert.strictEqual(rows[0]._delType, 'Uçak');
  assert.strictEqual(calendarDay(rows[0]._arr), '2026-01-16');
});

test('v4.50 üretimde bakiye yüzde 5in altındaysa Üretimde satırı oluşturmaz', () => {
  const { orders, map, overrides } = parsed([
    asas({ 'Net Alım Sipariş Miktarı': 5000, 'Kalan Alım Sipariş Miktarı': 100 }),
  ], [
    ias({ 'Yükleme Toplam Adet': 2000, 'Net Alım Sipariş Miktarı': 5000, 'Supplier Portal Statü': 'Depoda' }),
    ias({ 'Yükleme Toplam Adet': 2900, 'Net Alım Sipariş Miktarı': 5000, 'Supplier Portal Statü': 'Depoda' }),
  ]);
  const rows = parse.buildBacklogOperationalRows(orders, map, overrides);
  assert.strictEqual(rows.length, 2);
  assert.deepStrictEqual(rows.map(r => r.qty), [2000, 2900]);
  assert.ok(rows.every(r => r._status === 'Depoda'));
});

test('v4.48 merkez sevke hazır depo bakiyesi siparişin yüzde 5ini aşarsa Depoda parsiyelleri Retaile Aktarım Bekleniyor olur', () => {
  const { orders, map, overrides } = parsed([
    asas({
      'Net Alım Sipariş Miktarı': 5000,
      // Parsiyellerin tamamı (5000) antrepoda: ASAS Kalan Alım 0; 251 adet
      // henüz merkez sevke hazır depoya geçmemiş (retaile aktarım bekleyen).
      'Kalan Alım Sipariş Miktarı': 0,
      'Kalan Alım Sipariş Miktarı_Merkez Sevke Hazır Depo': 251,
    }),
  ], [
    ias({ 'Yükleme Toplam Adet': 3000, 'Net Alım Sipariş Miktarı': 5000, 'Supplier Portal Statü': 'Depoda' }),
    ias({ 'Yükleme Toplam Adet': 2000, 'Net Alım Sipariş Miktarı': 5000, 'Supplier Portal Statü': 'Depoda' }),
  ]);
  const rows = parse.buildBacklogOperationalRows(orders, map, overrides);
  assert.strictEqual(rows.length, 2);
  assert.ok(rows.every(r => r._status === 'Retaile Aktarım Bekleniyor'));
});

test('v4.48 eşik tam yüzde 5 ise Depoda korunur ve diğer IAS statüleri değiştirilmez', () => {
  const { orders, map, overrides } = parsed([
    asas({
      'Net Alım Sipariş Miktarı': 5000,
      'Kalan Alım Sipariş Miktarı_Merkez Sevke Hazır Depo': 250,
    }),
  ], [
    ias({ 'Yükleme Toplam Adet': 3000, 'Net Alım Sipariş Miktarı': 5000, 'Supplier Portal Statü': 'Depoda' }),
    ias({ 'Yükleme Toplam Adet': 2000, 'Net Alım Sipariş Miktarı': 5000, 'Supplier Portal Statü': 'Yol Operasyonları' }),
  ]);
  const rows = parse.buildBacklogOperationalRows(orders, map, overrides);
  assert.deepStrictEqual(rows.map(r => r._status), ['Depoda', 'Yol Operasyonları']);
});

test('v4.48 Backlog Excel statüsü aynı yüzde 5 kuralını kullanır', () => {
  const { orders, map, overrides } = parsed([
    asas({
      'Net Alım Sipariş Miktarı': 10000,
      'Kalan Alım Sipariş Miktarı': 0,
      'Kalan Alım Sipariş Miktarı_Merkez Sevke Hazır Depo': 501,
    }),
  ], [ias({ 'Yükleme Toplam Adet': 10000, 'Supplier Portal Statü': 'Depoda' })]);
  const rows = parse.buildBacklogTemplateRows(orders, map, overrides, {});
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0]['GÜNCEL DURUM\n(STATUS)'], 'Retaile Aktarım Bekleniyor');
});

test('v4.50 Backlog Excel net sipariş miktarını sabit, satır miktarını Adet sütununda dışa aktarır', () => {
  // ASAS Kalan Alım = Net Alım - Antrepoya Giren (3000 Depoda) = 7000.
  const { orders, map, overrides } = parsed([asas({ 'Kalan Alım Sipariş Miktarı': 7000, 'Antrepoya Giren Miktar': 3000 })], [
    ias({ 'Yükleme Toplam Adet': 3000, 'Supplier Portal Statü': 'Depoda' }),
    ias({ 'Yükleme Toplam Adet': 4000, 'Supplier Portal Statü': 'Yol Operasyonları' }),
  ]);
  const rows = parse.buildBacklogTemplateRows(orders, map, overrides, {});
  assert.strictEqual(rows.length, 3);
  assert.deepStrictEqual(rows.map(r => r['Net Alım Sipariş Miktarı']), [10000, 10000, 10000]);
  assert.deepStrictEqual(rows.map(r => r['Adet']), [3000, 3000, 4000]);
  // ASAS sipariş düzeyi Kalan Alım (7000) satırlara dağıtılır: önce Üretimde
  // bakiyesi (3000), sonra yoldaki parsiyel (4000); Depoda parsiyeli 0.
  assert.deepStrictEqual(rows.map(r => r['Kalan Alım Sipariş Miktarı']), [3000, 0, 4000]);
  assert.deepStrictEqual(rows.map(r => r['Net Gelen Alım Sipariş Miktarı']), [0, 3000, 4000]);
  assert.strictEqual(rows.reduce((sum, row) => sum + row['Adet'], 0), 10000);
});

test('v4.50 2000 adet ASAS siparişin 700lük parsiyeline karşı 1300 Üretimde satırı ekler', () => {
  const { orders, map, overrides } = parsed([
    asas({ 'Net Alım Sipariş Miktarı': 2000 }),
  ], [
    ias({ 'Net Alım Sipariş Miktarı': 2000, 'Yükleme Toplam Adet': 700, 'Supplier Portal Statü': 'Yol Operasyonları' }),
  ]);
  const rows = parse.buildBacklogTemplateRows(orders, map, overrides, {});
  assert.deepStrictEqual(rows.map(row => [row['Net Alım Sipariş Miktarı'], row['Adet'], row['GÜNCEL DURUM\n(STATUS)']]), [
    [2000, 1300, 'Üretimde'],
    [2000, 700, 'Yol Operasyonları'],
  ]);
  assert.strictEqual(rows.reduce((sum, row) => sum + row['Adet'], 0), 2000);
});

test('v4.50 3000 adet ASAS siparişte iki 1200lük parsiyel ve 600 Üretimde satırı üretir', () => {
  const { orders, map, overrides } = parsed([asas({ 'Net Alım Sipariş Miktarı': 3000 })], [
    ias({ 'Net Alım Sipariş Miktarı': 3000, 'Yükleme Toplam Adet': 1200, 'Supplier Portal Statü': 'Yol Operasyonları' }),
    ias({ 'Net Alım Sipariş Miktarı': 3000, 'Yükleme Toplam Adet': 1200, 'Supplier Portal Statü': 'Yol Operasyonları' }),
  ]);
  const rows = parse.buildBacklogOperationalRows(orders, map, overrides);
  assert.deepStrictEqual(rows.map(row => [row.qty, row._status]), [
    [600, 'Üretimde'],
    [1200, 'Yol Operasyonları'],
    [1200, 'Yol Operasyonları'],
  ]);
  assert.strictEqual(rows.reduce((sum, row) => sum + row.qty, 0), 3000);
});

test('v4.51 bakiye tam yüzde 5 ise sentetik Eksik Yükleme satırı oluşturur', () => {
  const { orders, map, overrides } = parsed([asas({ 'Net Alım Sipariş Miktarı': 2000 })], [
    ias({ 'Net Alım Sipariş Miktarı': 9999, 'Yükleme Toplam Adet': 1900, 'Supplier Portal Statü': 'Yol Operasyonları' }),
  ]);
  const rows = parse.buildBacklogOperationalRows(orders, map, overrides);
  assert.deepStrictEqual(rows.map(row => [row.qty, row._status]), [[100, 'Eksik Yükleme'], [1900, 'Yol Operasyonları']]);
});



test('v4.50 Antrepo Net Alım Sipariş Miktarı farklı olsa bile sipariş toplamını yalnız ASAS belirler', () => {
  const { orders, map, overrides } = parsed([
    asas({ 'Net Alım Sipariş Miktarı': 3000 }),
  ], [
    ias({ 'Net Alım Sipariş Miktarı': 700, 'Yükleme Toplam Adet': 1200, 'Supplier Portal Statü': 'Yol Operasyonları' }),
  ]);
  const rows = parse.buildBacklogTemplateRows(orders, map, overrides, {});
  assert.deepStrictEqual(rows.map(row => [row['Net Alım Sipariş Miktarı'], row['Adet'], row['GÜNCEL DURUM\n(STATUS)']]), [
    [3000, 1800, 'Üretimde'],
    [3000, 1200, 'Yol Operasyonları'],
  ]);
});

test('v4.42 özel eşleştirme koşullarının tamamı AND mantığıyla birebir eşleşir', () => {
  const config = {
    conditions: [
      { id: 'order', asas: { header: 'Sipariş Kod' }, ias: { header: 'Sipariş Kod' } },
      { id: 'model', asas: { header: 'Model Adı' }, ias: { header: 'Ürün Ad' } },
      { id: 'ccode', asas: { header: 'Renk Kod' }, ias: { header: 'Renk Kod' } },
      { id: 'colour', asas: { header: 'Renk' }, ias: { header: 'Renk Tanım' } },
    ],
  };
  const overrides = ov({ antrepoMatchConfig: config });
  const { orders } = parsed([asas()], [], overrides);
  const wrong = parse.parseAntrepoRows([ias({ 'Renk Tanım': 'LACİVERT' })], config);
  assert.strictEqual(parse.findAntrepoHits(wrong, orders[0], { config }).length, 0);
  const exact = parse.parseAntrepoRows([ias()], config);
  assert.strictEqual(parse.findAntrepoHits(exact, orders[0], { config }).length, 1);
});


test('v4.42 eski sistem varsayılanındaki IAS Model Adı koşulunu Ürün Ad koşuluna taşır', () => {
  const legacy = {
    conditions: [
      { id: 'ocode', asas: { header: 'Sipariş Kod' }, ias: { header: 'Sipariş Kod' } },
      { id: 'model', asas: { header: 'Model Adı' }, ias: { header: 'Model Adı', table: 'IAS', name: 'Ürün Adı' } },
      { id: 'ccode', asas: { header: 'Renk Kod' }, ias: { header: 'Renk Kod' } },
    ],
  };
  const normalized = parse.normalizeAntrepoMatchConfig(legacy);
  assert.strictEqual(normalized.conditions[1].ias.header, 'Ürün Ad');
  assert.strictEqual(normalized.conditions[1].ias.canonicalHeader, 'Ürün Ad');
  assert.strictEqual(normalized.conditions[1].ias.name, 'Ürün Adı');
});

test('v4.42 kullanıcının manuel Model Adı koşulunu sistem varsayılanı sanıp değiştirmez', () => {
  const manual = {
    conditions: [
      { id: 'manual-order', asas: { header: 'Sipariş Kod' }, ias: { header: 'Sipariş Kod' } },
      { id: 'manual-model', asas: { header: 'Model Adı' }, ias: { header: 'Model Adı' } },
      { id: 'manual-colour', asas: { header: 'Renk Kod' }, ias: { header: 'Renk Kod' } },
    ],
  };
  const normalized = parse.normalizeAntrepoMatchConfig(manual);
  assert.strictEqual(normalized.conditions[1].ias.header, 'Model Adı');
});

test('v4.49 aynı siparişteki E R T renklerinin parsiyelleri ve üretim bakiyeleri birbirine karışmaz', () => {
  const asasRows = [
    asas({ 'Sipariş Kod': 'W', 'Model Adı': 'Q', 'Renk Kod': 'E', 'Net Alım Sipariş Miktarı': 3000, 'Kalan Alım Sipariş Miktarı': 1000 }),
    asas({ 'Sipariş Kod': 'W', 'Model Adı': 'Q', 'Renk Kod': 'R', 'Net Alım Sipariş Miktarı': 5000, 'Kalan Alım Sipariş Miktarı': 100 }),
    asas({ 'Sipariş Kod': 'W', 'Model Adı': 'Q', 'Renk Kod': 'T', 'Net Alım Sipariş Miktarı': 2000, 'Kalan Alım Sipariş Miktarı': 0 }),
  ];
  const iasRows = [
    ias({ 'Sipariş Kod': 'W', 'Ürün Ad': 'Q', 'Renk Kod': 'E', 'Yükleme Toplam Adet': 2000, 'Net Alım Sipariş Miktarı': 3000, 'Supplier Portal Statü': 'Yükleme Operasyonları' }),
    ias({ 'Sipariş Kod': 'W', 'Ürün Ad': 'Q', 'Renk Kod': 'R', 'Yükleme Toplam Adet': 2000, 'Net Alım Sipariş Miktarı': 5000, 'Supplier Portal Statü': 'Depoda' }),
    ias({ 'Sipariş Kod': 'W', 'Ürün Ad': 'Q', 'Renk Kod': 'R', 'Yükleme Toplam Adet': 2900, 'Net Alım Sipariş Miktarı': 5000, 'Supplier Portal Statü': 'Depoda' }),
    ias({ 'Sipariş Kod': 'W', 'Ürün Ad': 'Q', 'Renk Kod': 'T', 'Yükleme Toplam Adet': 1500, 'Net Alım Sipariş Miktarı': 2000, 'Supplier Portal Statü': 'Depoda' }),
    ias({ 'Sipariş Kod': 'W', 'Ürün Ad': 'Q', 'Renk Kod': 'T', 'Yükleme Toplam Adet': 500, 'Net Alım Sipariş Miktarı': 2000, 'Supplier Portal Statü': 'Yol Operasyonları' }),
  ];
  const { orders, map, overrides } = parsed(asasRows, iasRows);
  const rows = parse.buildBacklogOperationalRows(orders, map, overrides);
  const byColour = code => rows.filter(row => row.ccode === code);

  assert.deepStrictEqual(byColour('E').map(row => [row.qty, row._status]), [
    [1000, 'Üretimde'],
    [2000, 'Yükleme Operasyonları'],
  ]);
  assert.deepStrictEqual(byColour('R').map(row => [row.qty, row._status]), [
    [2000, 'Depoda'],
    [2900, 'Depoda'],
  ]);
  assert.deepStrictEqual(byColour('T').map(row => [row.qty, row._status]), [
    [1500, 'Depoda'],
    [500, 'Yol Operasyonları'],
  ]);
});


test('v4.51 bakiye tam yüzde 10 ise Eksik Yükleme, yüzde 10u aşarsa Üretimde olur', () => {
  const ten = parsed([asas({ 'Net Alım Sipariş Miktarı': 2000 })], [
    ias({ 'Yükleme Toplam Adet': 1800, 'Supplier Portal Statü': 'Yol Operasyonları' }),
  ]);
  assert.deepStrictEqual(parse.buildBacklogOperationalRows(ten.orders, ten.map, ten.overrides).map(row => [row.qty, row._status]), [
    [200, 'Eksik Yükleme'], [1800, 'Yol Operasyonları'],
  ]);

  const over = parsed([asas({ 'Net Alım Sipariş Miktarı': 2000 })], [
    ias({ 'Yükleme Toplam Adet': 1799, 'Supplier Portal Statü': 'Yol Operasyonları' }),
  ]);
  assert.deepStrictEqual(parse.buildBacklogOperationalRows(over.orders, over.map, over.overrides).map(row => [row.qty, row._status]), [
    [201, 'Üretimde'], [1799, 'Yol Operasyonları'],
  ]);
});

test('v4.51 yüzde 5in altındaki fark için sentetik satır oluşturmaz', () => {
  const { orders, map, overrides } = parsed([asas({ 'Net Alım Sipariş Miktarı': 2000 })], [
    ias({ 'Yükleme Toplam Adet': 1901, 'Supplier Portal Statü': 'Yol Operasyonları' }),
  ]);
  assert.deepStrictEqual(parse.buildBacklogOperationalRows(orders, map, overrides).map(row => [row.qty, row._status]), [
    [1901, 'Yol Operasyonları'],
  ]);
});

test('v4.64 Eksik Yükleme operational hesabı geçmiş Ex-Factoryyi bugüne taşımaz', () => {
  const row = {
    'Ex-factory': new Date(2026, 0, 1),
    'Retail Date': new Date(2026, 2, 25),
    'In-Store (Model Budget)': new Date(2026, 3, 20),
    'Ant. Arrival': new Date(2026, 2, 12),
    'HANDOVER Tarihi': null,
    'Buying Son Onay Tarihi': null,
    STATUS: 'Eksik Yükleme',
    'Del. Type': 'Gemi',
    Season: 'W6', Country: 'China',
  };
  const today = new Date(2026, 1, 20);
  const shortage = parse.computeFlags(row, [], today);
  const production = parse.computeFlags({ ...row, STATUS: 'Üretimde' }, [], today);
  assert.equal(shortage.shortage, true);
  assert.equal(shortage.isDelay, false);
  assert.equal(production.discountWarning, true);
  assert.equal(production.signals.some(item=>item.code==='DISCOUNT_DELAY'), true);
  assert.equal(Object.prototype.hasOwnProperty.call(shortage,'priority'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(production,'priority'), false);
});

test('v4.64 tüm parsiyeller Depoda ve bakiye Shortage ise sentetik durum Depoda - Eksik Yükleme olur', () => {
  const { orders, map, overrides } = parsed([asas({ 'Net Alım Sipariş Miktarı': 2000 })], [
    ias({ 'Yükleme Toplam Adet': 900, 'Supplier Portal Statü': 'Depoda' }),
    ias({ 'Yükleme Toplam Adet': 900, 'Supplier Portal Statü': 'Depoda' }),
  ]);
  assert.deepStrictEqual(parse.buildBacklogOperationalRows(orders, map, overrides).map(row => [row.qty, row._status]), [
    [200, 'Depoda - Eksik Yükleme'],
    [900, 'Depoda'],
    [900, 'Depoda'],
  ]);
  assert.equal(parse.isShortageStatus('Depoda - Eksik Yükleme'), true);
  assert.equal(parse.isWarehouseShortageStatus('Depoda - Eksik Yükleme'), true);
});

test('Retaile aktarım bekleyen miktar Kalan_Merkez eksi Kalan Alım: yalnız eksik yükleme kalan siparişte parsiyeller Depoda kalır', () => {
  const { orders, map, overrides } = parsed([
    asas({
      'Net Alım Sipariş Miktarı': 8558,
      'Kalan Alım Sipariş Miktarı': 465,
      'Kalan Alım Sipariş Miktarı_Merkez Sevke Hazır Depo': 465,
    }),
  ], [
    ias({ 'Yükleme Toplam Adet': 2928, 'Supplier Portal Statü': 'Depoda' }),
    ias({ 'Yükleme Toplam Adet': 5165, 'Supplier Portal Statü': 'Depoda' }),
  ]);
  const rows = parse.buildBacklogOperationalRows(orders, map, overrides);
  assert.deepStrictEqual(rows.map(r => r._status), ['Depoda - Eksik Yükleme', 'Depoda', 'Depoda']);
  // 465 henüz antrepoda değil + 430 antrepoda bekleyen = 895; 430 > %5 (427,9).
  const waiting = parsed([
    asas({
      'Net Alım Sipariş Miktarı': 8558,
      'Kalan Alım Sipariş Miktarı': 465,
      'Kalan Alım Sipariş Miktarı_Merkez Sevke Hazır Depo': 895,
    }),
  ], [
    ias({ 'Yükleme Toplam Adet': 2928, 'Supplier Portal Statü': 'Depoda' }),
    ias({ 'Yükleme Toplam Adet': 5165, 'Supplier Portal Statü': 'Depoda' }),
  ]);
  const waitingRows = parse.buildBacklogOperationalRows(waiting.orders, waiting.map, waiting.overrides);
  assert.deepStrictEqual(waitingRows.slice(1).map(r => r._status), ['Retaile Aktarım Bekleniyor', 'Retaile Aktarım Bekleniyor']);
});
