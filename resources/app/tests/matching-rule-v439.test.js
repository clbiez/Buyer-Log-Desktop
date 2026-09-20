'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const parse = require(path.join(__dirname, '..', 'server', 'lib', 'parse.js'));
const modelRefresh = require(path.join(__dirname, '..', 'server', 'lib', 'model-refresh.js'));

function asas(overrides = {}) {
  return {
    'Sipariş Kod': 'A',
    'Model Adı': 'MODEL-1',
    'Renk Kod': 'C01',
    'Renk': 'SİYAH',
    'Net Alım Sipariş Miktarı': 100,
    'FOB Fiyatı': 5,
    'Üretici': 'SUPPLIER',
    'Sezon': 'W6',
    'Orijinal Exfactory Merch Tarih': '2026-09-01',
    ...overrides,
  };
}
function ias(overrides = {}) {
  return {
    'Sipariş Kod': 'A',
    'Ürün Adı': 'MODEL-1',
    'Renk Kod': 'C01',
    'Renk Tanım': 'SİYAH',
    'Supplier Portal Statü': 'Depoda',
    'Tahmini Antrepo Giriş Tarihi': '2026-09-10',
    'Yükleme Toplam Adet': 100,
    ...overrides,
  };
}
const fourConditions = {
  version: 1,
  conditions: [
    { id: 'order', asas: { header: 'Sipariş Kod' }, ias: { header: 'Sipariş Kod' } },
    { id: 'model', asas: { header: 'Model Adı' }, ias: { header: 'Model Adı' } },
    { id: 'ccode', asas: { header: 'Renk Kod' }, ias: { header: 'Renk Kod' } },
    { id: 'colour', asas: { header: 'Renk' }, ias: { header: 'Renk Tanım' } },
  ],
};

test('v4.39 dört manuel koşulu AND ile ve birebir uygular', () => {
  const orders = parse.parseASASRows([asas()], fourConditions).orders;
  const map = parse.parseAntrepoRows([ias()], fourConditions);
  const hit = parse.findAntrepoHit(map, orders[0], { config: fourConditions });
  assert.ok(hit);
  assert.strictEqual(hit.statu, 'Depoda');
  assert.strictEqual(hit._matchConditionCount, 4);
  assert.strictEqual(hit._matchLevel, 'all-conditions');

  const wrongColour = parse.parseAntrepoRows([ias({ 'Renk Tanım': 'LACİVERT' })], fourConditions);
  assert.strictEqual(parse.findAntrepoHit(wrongColour, orders[0], { config: fourConditions }), null);
});

test('v4.39 tek koşullu özel sütun eşleştirmesini destekler', () => {
  const config = {
    version: 1,
    conditions: [{
      id: 'custom-line',
      asas: { table: 'ASAS Table', name: 'Line Key', header: 'Line Key' },
      ias: { table: 'IAS Table', name: 'Line Ref', header: 'Line Ref' },
    }],
  };
  const orders = parse.parseASASRows([asas({ '__MATCH_custom-line': 'KEY-01' })], config).orders;
  const map = parse.parseAntrepoRows([ias({ '__MATCH_custom-line': 'KEY-01' })], config);
  assert.strictEqual(parse.findAntrepoHit(map, orders[0], { config }).statu, 'Depoda');

  const caseMismatch = parse.parseAntrepoRows([ias({ '__MATCH_custom-line': 'key-01' })], config);
  assert.strictEqual(parse.findAntrepoHit(caseMismatch, orders[0], { config }), null);
});

test('v4.39 seçili koşul boşsa IAS satırını eşleştirmeye almaz', () => {
  const config = {
    conditions: [{
      id: 'custom',
      asas: { table: 'A', name: 'Key', header: 'Key' },
      ias: { table: 'I', name: 'Key', header: 'Key' },
    }],
  };
  const orders = parse.parseASASRows([asas({ '__MATCH_custom': 'X' })], config).orders;
  const map = parse.parseAntrepoRows([ias({ '__MATCH_custom': '' })], config);
  assert.strictEqual(parse.antrepoParseMeta(map).matchableRows, 0);
  assert.strictEqual(parse.findAntrepoHit(map, orders[0], { config }), null);
});

test('v4.39 aynı sabit üçlü altındaki farklı özel koşul satırlarını ASAS tarafında korur', () => {
  const config = {
    conditions: [{
      id: 'variant',
      asas: { table: 'A', name: 'Variant', header: 'Variant' },
      ias: { table: 'I', name: 'Variant', header: 'Variant' },
    }],
  };
  const parsed = parse.parseASASRows([
    asas({ '__MATCH_variant': 'V1' }),
    asas({ '__MATCH_variant': 'V2' }),
  ], config);
  assert.strictEqual(parsed.orders.length, 2);
});


test('v4.39 Backlog Excel aynı sabit üçlüdeki özel koşul satırlarının IAS bilgilerini karıştırmaz', () => {
  const config = {
    conditions: [{
      id: 'variant',
      asas: { table: 'A', name: 'Variant', header: 'Variant' },
      ias: { table: 'I', name: 'Variant', header: 'Variant' },
    }],
  };
  const orders = parse.parseASASRows([
    asas({
      '__MATCH_variant': 'V1',
      'FOB Fiyatı': 5,
      'Kalan Alım Sipariş Miktarı': 0,
      'Retail Depo Tarih Yıl Ay Gün': '2026-10-01',
    }),
    asas({
      '__MATCH_variant': 'V2',
      'FOB Fiyatı': 6,
      'Kalan Alım Sipariş Miktarı': 100,
      'Retail Depo Tarih Yıl Ay Gün': '2026-10-01',
    }),
  ], config).orders;
  const map = parse.parseAntrepoRows([
    ias({ '__MATCH_variant': 'V1', 'Supplier Portal Statü': 'Depoda', 'Tahmini Antrepo Giriş Tarihi': '2026-09-10' }),
    ias({ '__MATCH_variant': 'V2', 'Supplier Portal Statü': 'Yol Operasyonları', 'Tahmini Antrepo Giriş Tarihi': '2026-09-20' }),
  ], config);
  const overrides = {
    antrepoMatchConfig: config,
    licensormap: {}, submap: {}, suppfobmap: {}, suppfobmetamap: {},
    delmap: {}, notesmap: {}, pricingRules: [], transitRules: [],
  };
  const rows = parse.buildBacklogTemplateRows(orders, map, overrides, {});
  assert.strictEqual(rows.length, 2);
  const byFob = new Map(rows.map(row => [row['FOB Fiyatı'], row]));
  assert.strictEqual(byFob.get(5)['GÜNCEL DURUM\n(STATUS)'], 'Depoda');
  assert.strictEqual(byFob.get(5)['ANTREPO GİRİŞ TARİHİ'].getDate(), 10);
  assert.strictEqual(byFob.get(6)['GÜNCEL DURUM\n(STATUS)'], 'Yol Operasyonları');
  assert.strictEqual(byFob.get(6)['ANTREPO GİRİŞ TARİHİ'].getDate(), 20);
});

test('v4.39 seçilen model sütununu otomatik sorguya iç eşleştirme alanı olarak ekler', () => {
  const item = {
    id: 'asas', name: 'ASAS', role: 'asas', mode: 'auto',
    horizon: { table: 'Orders', conditions: [{ id: 'scope', groups: [{ items: [{ table: 'Orders', field: 'Season', values: ['W6'] }] }] }] },
    mapping: {
      'Sipariş Kod': { table: 'Orders', name: 'Order Code', kind: 'column' },
      'Renk': { table: 'Orders', name: 'Colour', kind: 'column' },
      'Renk Kod': { table: 'Orders', name: 'Colour Code', kind: 'column' },
      'Net Alım Sipariş Miktarı': { table: 'Orders', name: 'Qty', kind: 'measure' },
      'FOB Fiyatı': { table: 'Orders', name: 'FOB', kind: 'measure' },
      'Üretici': { table: 'Orders', name: 'Supplier', kind: 'column' },
      'Sezon': { table: 'Orders', name: 'Season', kind: 'column' },
      'Model Adı': { table: 'Orders', name: 'Model', kind: 'column' },
      'Orijinal Exfactory Merch Tarih': { table: 'Orders', name: 'ExFactory', kind: 'column' },
      'Ana Kumaş Mı': { table: 'Orders', name: 'Is Main Fabric', kind: 'column' },
    },
  };
  const config = { conditions: [{ id: 'manual', asas: { table: 'Orders', name: 'Manual Key' }, ias: { table: 'IAS', name: 'Manual Key' } }] };
  const built = modelRefresh.buildConnectionQuery(item, { matchRule: config });
  assert.match(built.query, /Manual Key/);
  assert.strictEqual(built.headerMap['Orders[Manual Key]'], '__MATCH_manual');
});

test('v4.39 Backlog Excel aktif Backlog kapsamı ve filtrelerini kullanır', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'server', 'server.js'), 'utf8');
  const start = source.indexOf("app.get('/api/backlog-export'");
  const end = source.indexOf("app.post('/api/backlog-detail'", start);
  const route = source.slice(start, end);
  assert.match(route, /ordersForTarget\(active,'backlog',overrides\)/);
  assert.match(route, /antrepoForTarget\(active,'backlog'\)/);
  assert.match(route, /buildBacklogTemplateRows\(backlogOrders,backlogAntrepo,overrides,filterOpts,sourceColumns,/);
  assert.doesNotMatch(route, /buildBacklogTemplateRows\(active\.asasOrders/);
});

test('v4.39 eşleştirme ekranı koşul ekleme, arama, öneri ve kesin eşleşme bilgisini içerir', () => {
  /* v7.81: ekran eski bağlantı modalından Veri Yönetimi'ne taşındı
     (data-management-matchrule.js). Korunan yetenekler birebir aynı; yalnız
     yerleri ve sınıf adları değişti. */
  const ui = fs.readFileSync(path.join(__dirname, '..', 'public', 'data-management-matchrule.js'), 'utf8');
  const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'data-management.css'), 'utf8');

  assert.match(ui, /data-suggest/, 'alan eşlemesinden türetilen öneri (Auto Match) olmalı');
  assert.match(ui, /data-add/, 'koşul eklenebilmeli');
  assert.match(ui, /window\.BLDataPicker\?\.open\?\.\(/, 'sütun seçimi aranabilir olmalı');
  assert.match(ui, /Karşılaştırma birebirdir/, 'birebir eşleşme kuralı yazılı olmalı');
  assert.match(ui, /birlikte sağlanmalıdır \(VE\)/, 'AND mantığı yazılı olmalı');
  assert.match(css, /\.dmMatchRule/);
  assert.match(css, /\.dmrRow/);
});

test('v7.81 öneri DOĞRUDAN KAYDEDİLMEZ; kaydetmek de yenileme başlatmaz', () => {
  /* İki bilinçli fark:

     1) "Öneriyi uygula" forma yazar, sunucuya değil. Eşleştirme kuralını
        sessizce değiştirmek, kullanıcının görmediği bir Backlog değişimi
        demektir — kural yanlışsa eşleşme çöker ve kimse nedenini bilmez.

     2) Kaydetmek yenileme TETİKLEMEZ. Eski ekranın "Kaydet ve Yenile"si tek
        tıkla dakikalar süren bir sorgu başlatıyordu; kullanıcı kuralı
        düzeltirken bunu istemeyebilir. Ne zaman geçerli olacağı açıkça
        söylenir. */
  const ui = fs.readFileSync(path.join(__dirname, '..', 'public', 'data-management-matchrule.js'), 'utf8');
  const suggest = ui.slice(ui.indexOf("data-suggest]')"), ui.indexOf("data-drop]')"));
  assert.doesNotMatch(suggest, /fetch\(/, 'öneri sunucuya yazmamalı');
  assert.match(ui, /Öneri forma yazıldı/);
  assert.match(ui, /bir sonraki yenilemede geçerli olur/);
  const save = ui.slice(ui.indexOf('async function save()'), ui.indexOf('function onClick'));
  // Metin DEĞİL, ÇAĞRI aranır: başarı mesajının kendisi "next refresh" diyor.
  assert.doesNotMatch(save, /loadFromServer\(|BLRefresh|\/api\/refresh/, 'kaydetmek yenileme başlatmamalı');
});
