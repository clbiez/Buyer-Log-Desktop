'use strict';
/*
 * ASAS ↔ IAS eşleştirme regresyonları.
 * Sipariş Kod + Model/Ürün Adı + Renk Kod üçlüsü birlikte eşleşir. Sipariş kodu
 * Excel/DAX temsil farkları (sayı, .00, binlik ayraç) için iş koduna çevrilir;
 * model adı ve renk kodu ise hiçbir tolerans uygulanmadan birebir karşılaştırılır.
 */
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

const parse = require(path.join(__dirname, '..', 'server', 'lib', 'parse.js'));
const modelScopes = require(path.join(__dirname, '..', 'server', 'lib', 'model-scopes.js'));
const modelRefresh = require(path.join(__dirname, '..', 'server', 'lib', 'model-refresh.js'));

function antrepoRow(code, colour, statu, model = 'MODEL', ccode = 'C01') {
  return {
    'Sipariş Kod': code,
    'Ürün Adı': model,
    'Renk Kod': ccode,
    'Renk Tanım': colour,
    'Supplier Portal Statü': statu,
    'Tahmini Antrepo Giriş Tarihi': '2026-09-01',
    'Vasita Tanim': 'Gemi',
    'Yükleme Toplam Adet': 1000,
  };
}

test('eski sipariş kodu yardımcı normalizasyonu diğer modüller için korunur', () => {
  const cases = [
    ['1234567', '1234567'], [1234567, '1234567'], ['1234567.00', '1234567'],
    ['1.234.567', '1234567'], ['0001234567', '1234567'], ['1.23456700E+06', '1234567'],
  ];
  for (const [input, expected] of cases) assert.strictEqual(parse.orderCodeKey(input), expected);
});

test('IAS kaydı yalnız aynı ham sipariş kodu + model + renk kodu ile bulunur', () => {
  const rows = [
    antrepoRow('1234567', 'SIYAH', 'Yükleme Operasyonları', 'M1', 'C1'),
    antrepoRow('1234568.00', 'BEYAZ', 'Yol Operasyonları', 'M2', 'C2'),
    antrepoRow('1.234.569', 'MAVI', 'Depoda', 'M3', 'C3'),
  ];
  const map = parse.parseAntrepoRows(rows);
  for (const row of rows) {
    const hit = parse.findAntrepoHit(map, {
      ocode: row['Sipariş Kod'], _matchOcode: row['Sipariş Kod'],
      model: row['Ürün Adı'], ccode: row['Renk Kod'], colour: row['Renk Tanım'],
    });
    assert.ok(hit);
    assert.strictEqual(hit.statu, row['Supplier Portal Statü']);
  }
});

test('sipariş kodunun Excel/DAX gösterim farkları aynı iş kodu olarak eşleşir', () => {
  const map = parse.parseAntrepoRows([antrepoRow('1.234.569', 'MAVI', 'Depoda', 'M3', 'C3')]);
  assert.ok(parse.findAntrepoHit(map, { ocode: '1.234.569', model: 'M3', ccode: 'C3' }));
  assert.ok(parse.findAntrepoHit(map, { ocode: 1234569, model: 'M3', ccode: 'C3' }));
  assert.ok(parse.findAntrepoHit(map, { ocode: '1234569.00', model: 'M3', ccode: 'C3' }));
  assert.strictEqual(parse.findAntrepoHit(map, { ocode: '1234569', model: 'm3', ccode: 'C3' }), null);
  assert.strictEqual(parse.findAntrepoHit(map, { ocode: '1234569', model: 'M3', ccode: 'c3' }), null);
});

test('CP satırı tam üçlü eşleşmede gerçek IAS durumunu alır', () => {
  const antrepoMap = parse.parseAntrepoRows([
    antrepoRow('1.234.569', 'MAVI', 'Yükleme Operasyonları', 'M1', 'C1'),
  ]);
  const asasOrders = [{
    ocode: parse.toOrderCodeNumber('1.234.569'), _matchOcode: '1.234.569', colour: 'MAVI', season: 'W6', countryRaw: 'MISIR',
    manufacturer: 'X', license: 'HARRY POTTER', category: 'KAZAK', model: 'M1', ccode: 'C1',
    qty: 1000, kalan: 1000, fob: 5, opd: new Date('2026-05-01'), ex: new Date('2026-08-01'),
    retail: new Date('2026-11-01'), mb: new Date('2026-11-15'), merkezSevkeHazirKalan: 0,
  }];
  const overrides = {
    notesmap: {}, submap: {}, suppfobmap: {}, delmap: {}, licensormap: {},
    suppfobmetamap: {}, pricingRules: [], transitRules: [], antrepoMatchRule: 'auto',
  };
  assert.strictEqual(parse.buildCPRowsFromASAS(asasOrders, antrepoMap, overrides)[0].STATUS, 'Yükleme Operasyonları');
});

test('Antrepo rolünde CP sipariş kodu daraltması kalmadı', () => {
  const scopes = modelScopes.normalizeScopes([{ targets: ['cp'], limitToCpOrders: true }], 'antrepo', {}, h => h || {});
  assert.strictEqual(scopes[0].limitToCpOrders, false);
  assert.strictEqual(modelScopes.normalizeScopes([], 'antrepo', {}, h => h || {})[0].limitToCpOrders, false);
  assert.strictEqual(modelRefresh.effectiveScopes({ id: 'c1', role: 'antrepo', horizon: {} })[0].limitToCpOrders, false);
  assert.deepEqual(modelScopes.normalizeScopes([], 'fabric', {}, h => h || {}), []);
});

test('IAS kimlik sütunları desteklenen ad farklarıyla çözülür', () => {
  const variants = [
    { 'Sipariş Kod': '1234567', 'Ürün Adı': 'M1', 'Renk Kod': 'C1', 'Renk Tanım': 'SIYAH', 'Supplier Portal Statü': 'Depoda' },
    { 'Sipariş Kodu': '1234567', 'Model Adı': 'M1', 'Renk Kodu': 'C1', 'Renk Tanımı': 'SIYAH', 'Supplier Portal Statü': 'Depoda' },
    { 'Order Code': '1234567', 'Product Name': 'M1', 'Colour Code': 'C1', 'Colour Description': 'SIYAH', 'Supplier Portal Status': 'Depoda' },
  ];
  for (const row of variants) {
    const map = parse.parseAntrepoRows([row]);
    const hit = parse.findAntrepoHit(map, { ocode: '1234567', model: 'M1', ccode: 'C1' });
    assert.ok(hit);
    assert.strictEqual(hit.statu, 'Depoda');
  }
});

test('Renk Kod alanı renk tanımı sanılmaz', () => {
  const map = parse.parseAntrepoRows([antrepoRow('1234567', 'SIYAH', 'Depoda', 'M1', 'BLK')]);
  const meta = parse.antrepoParseMeta(map);
  assert.strictEqual(meta.resolved.colour, 'Renk Tanım');
  assert.strictEqual(meta.resolved.ccode, 'Renk Kod');
  assert.ok(parse.findAntrepoHit(map, { ocode: '1234567', model: 'M1', ccode: 'BLK' }));
});

test('kimlik sütunları çözülemezse sessiz kalmaz', () => {
  const map = parse.parseAntrepoRows([{ Kod: '1', Aciklama: 'x' }]);
  const meta = parse.antrepoParseMeta(map);
  assert.strictEqual(meta.ok, false);
  assert.deepStrictEqual(meta.columns, ['Kod', 'Aciklama']);
  assert.ok(meta.reason.includes('Sipariş Kod'));
});

test('teşhis tam kimlikli satır ve boş statü sayılarını raporlar', () => {
  const map = parse.parseAntrepoRows([
    antrepoRow('1234567', 'SIYAH', 'Yükleme Operasyonları', 'M1', 'C1'),
    antrepoRow('1234568', 'BEYAZ', '', 'M2', 'C2'),
  ]);
  const meta = parse.antrepoParseMeta(map);
  assert.strictEqual(meta.ok, true);
  assert.strictEqual(meta.dataRows, 2);
  assert.strictEqual(meta.lineKeyRows, 2);
  assert.strictEqual(meta.keyCount, 2);
  assert.strictEqual(meta.blankStatus, 1);
});

test('teşhis alanı haritanın enumerable anahtarlarına karışmaz', () => {
  const map = parse.parseAntrepoRows([antrepoRow('1234567', 'SIYAH', 'Depoda', 'M1', 'C1')]);
  assert.deepStrictEqual(Object.keys(map), ['__ias_row_1']);
  assert.strictEqual(JSON.parse(JSON.stringify(map)).__antrepoMeta, undefined);
});

test('modelden gelen statü dağılımı yalnız kabul edilen üçlü satırlardan hesaplanır', () => {
  const map = parse.parseAntrepoRows([
    antrepoRow('1001', 'SIYAH', 'Depoda', 'M1', 'C1'),
    antrepoRow('1002', 'BEYAZ', 'Yol Operasyonları', 'M2', 'C2'),
    antrepoRow('1003', 'MAVI', 'Yol Operasyonları', 'M3', 'C3'),
    antrepoRow('1004', 'GRI', '', 'M4', 'C4'),
  ]);
  assert.deepStrictEqual(parse.antrepoParseMeta(map).statusCounts, [
    ['Yol Operasyonları', 2], ['Depoda', 1], ['(boş)', 1],
  ]);
});

test('model veya renk kodu eksik IAS sonucu reddedilir', () => {
  const noModel = parse.parseAntrepoRows([{ 'Sipariş Kod': '1001', 'Renk Kod': 'C1', 'Supplier Portal Statü': 'Depoda' }]);
  const noCcode = parse.parseAntrepoRows([{ 'Sipariş Kod': '1001', 'Ürün Adı': 'M1', 'Supplier Portal Statü': 'Depoda' }]);
  assert.strictEqual(parse.antrepoParseMeta(noModel).ok, false);
  assert.strictEqual(parse.antrepoParseMeta(noCcode).ok, false);
  assert.strictEqual(Object.keys(noModel).length, 0);
  assert.strictEqual(Object.keys(noCcode).length, 0);
});

/* ---------------------------------------------------------------------------
 * v4.12: SUMMARIZECOLUMNS boş-ölçü satırı eleme koruması.
 *
 * SUMMARIZECOLUMNS, bütün genişletme sütunları BLANK olan grupları sonuçtan
 * TAMAMEN çıkarır. Antrepo sorgusunda tek genişletme sütunu "HANDOVER Tarihi"
 * ölçüsü olduğu için, handover tarihi henüz oluşmamış siparişler (Yükleme
 * Operasyonları) hiç dönmüyordu — 2855 satırın yalnız 3'ü bu statüdeydi.
 * Uygulama bunları "Antrepo kaydı yok" sayıp CP'de Üretimde gösteriyordu.
 * ------------------------------------------------------------------------- */
const modelHorizon = require(path.join(__dirname, '..', 'server', 'lib', 'modelHorizon.js'));

const IAS_MAPPING = {
  'Sipariş Kod': { table: 'Siparis Bilgileri', name: 'Sipariş Kod', kind: 'column' },
  'Model Adı': { table: 'Siparis Bilgileri', name: 'Ürün Adı', kind: 'column' },
  'Renk Kod': { table: 'Siparis Bilgileri', name: 'Renk Kod', kind: 'column' },
  'Renk Tanım': { table: 'Siparis Bilgileri', name: 'Renk Tanım', kind: 'column' },
  'Supplier Portal Statü': { table: 'Ithalat', name: 'Supplier Portal Statü', kind: 'column' },
  'Tahmini Antrepo Giriş Tarihi': { table: 'Ithalat', name: 'Tahmini Antrepo Giriş Tarihi', kind: 'column' },
  'HANDOVER Tarihi': { table: 'Ithalat', name: 'Handover Tarihi - CutOff Tarihi', kind: 'measure' },
};

test('ölçü içeren SUMMARIZECOLUMNS satır eleme koruması alır', () => {
  const built = modelHorizon.buildMappedQuery({ table: 'Siparis Bilgileri', groups: [] }, IAS_MAPPING);
  assert.match(built.query, /SUMMARIZECOLUMNS/);
  assert.ok(built.query.includes(modelHorizon.BLANK_ROW_GUARD),
    'koruma sütunu eklenmeli, yoksa boş ölçülü satırlar sessizce elenir');
  // Koruma, ölçüden SONRA gelmeli: genişletme sütunları filtre argümanlarından sonradır.
  assert.ok(built.query.indexOf(modelHorizon.BLANK_ROW_GUARD) > built.query.indexOf('HANDOVER Tarihi'));
});

/*
 * v4.13: koruma SABİT DEĞER OLAMAZ.
 *
 * v4.12'de koruma `"__BLRowGuard", 1` idi. Sabit değer, SUMMARIZECOLUMNS'ın boş
 * satır elemesini kapatır; ama o eleme aynı zamanda farklı tablolardan gelen
 * gruplama sütunlarını birbirine bağlayan mekanizmadır. Kapatılınca iki tablonun
 * TAM KARTEZYEN ÇARPIMI üretildi ve sunucu bellek hatası verdi
 * ("There's not enough memory to complete this operation").
 */
test('koruma sabit değer değil, varlık ölçüsüdür', () => {
  const built = modelHorizon.buildMappedQuery({ table: 'Siparis Bilgileri', groups: [] }, IAS_MAPPING);
  assert.ok(!built.query.includes(`"${modelHorizon.BLANK_ROW_GUARD}", 1)`),
    'sabit 1 koruması kartezyen çarpım üretir; kullanılmamalı');
  assert.match(built.query, /__BLRowGuard", IF\(/);
  assert.match(built.query, /COUNTROWS/);
});

test('koruma, gruplamaya katılan HER tabloyu kapsar', () => {
  const built = modelHorizon.buildMappedQuery({ table: 'Siparis Bilgileri', groups: [] }, IAS_MAPPING);
  const guardLine = built.query.split('\n').find(line => line.includes(modelHorizon.BLANK_ROW_GUARD));
  assert.ok(guardLine.includes("COUNTROWS('Siparis Bilgileri')"));
  assert.ok(guardLine.includes("COUNTROWS('Ithalat')"));
  assert.ok(guardLine.includes('&&'), 'tabloların hepsi birlikte var olmalı');
});

test('ölçüsüz eşlemede koruma sütunu eklenmez', () => {
  const mapping = {
    'Sipariş Kod': { table: 'Siparis Bilgileri', name: 'Sipariş Kod', kind: 'column' },
    'Supplier Portal Statü': { table: 'Ithalat', name: 'Supplier Portal Statü', kind: 'column' },
  };
  const built = modelHorizon.buildSummarizeQuery({ table: 'Siparis Bilgileri', groups: [] }, mapping);
  assert.ok(!built.query.includes(modelHorizon.BLANK_ROW_GUARD));
});

test('koruma sütunu Antrepo ayrıştırmasını etkilemez', () => {
  const map = parse.parseAntrepoRows([{
    'Sipariş Kod': '1234567', 'Ürün Adı': 'M1', 'Renk Kod': 'C1', 'Renk Tanım': 'SIYAH',
    'Supplier Portal Statü': 'Yükleme Operasyonları',
    [modelHorizon.BLANK_ROW_GUARD]: '1',
  }]);
  const hit = parse.findAntrepoHit(map, { ocode: '1234567', model: 'M1', ccode: 'C1', colour: 'SIYAH' });
  assert.ok(hit);
  assert.strictEqual(hit.statu, 'Yükleme Operasyonları');
  assert.deepStrictEqual(Object.keys(map), ['__ias_row_1']);
});

/* ---------------------------------------------------------------------------
 * v4.14: ufuk rozeti için koşul özeti.
 *
 * İki filtre katmanı var: model ufku (veriyi ÇEKEN sınır) ve sayfa filtreleri
 * (çekileni GÖSTEREN sınır). Sayfa filtresi seçenekleri yalnız çekilmiş
 * satırlardan üretildiği için ufkun dışarıda bıraktığı değer listede hiç
 * görünmez. Rozet bu sınırı görünür kılar; bu testler özet metnini korur.
 * ------------------------------------------------------------------------- */

test('ufuk koşulları okunabilir metne çevrilir', () => {
  const described = modelHorizon.describeHorizon({
    table: 'Siparis Bilgileri',
    groups: [{
      conditions: [
        { table: 'Siparis Bilgileri', field: 'Sezon', op: 'in', valueType: 'text', values: ['W5', 'W6'] },
        { table: 'Siparis Bilgileri', field: 'Ex-factory', op: 'between', valueType: 'date', from: '2026-01-01', to: '2026-12-31' },
      ],
    }],
  });
  assert.strictEqual(described.bounded, true);
  assert.ok(described.text.includes('Sezon: W5, W6'));
  assert.ok(described.text.includes('Ex-factory: 2026-01-01 – 2026-12-31'));
  assert.ok(described.text.includes(' ve '), 'grup içi koşullar VE ile birleşir');
});

test('gruplar arası VEYA olarak yazılır', () => {
  const described = modelHorizon.describeHorizon({
    table: 'T',
    groups: [
      { conditions: [{ table: 'T', field: 'Sezon', op: 'in', valueType: 'text', values: ['W5'] }] },
      { conditions: [{ table: 'T', field: 'MAG', op: 'in', valueType: 'text', values: ['12'] }] },
    ],
  });
  assert.ok(described.text.includes(' VEYA '));
});

test('uzun değer listesi kısaltılır', () => {
  const described = modelHorizon.describeHorizon({
    table: 'T',
    groups: [{ conditions: [{ table: 'T', field: 'MAG', op: 'in', valueType: 'text', values: ['1', '2', '3', '4', '5', '6'] }] }],
  });
  assert.ok(described.text.includes('+3 değer'), 'dört üstü değer kısaltılmalı');
});

test('koşulsuz ufuk sınırsız olarak işaretlenir', () => {
  const described = modelHorizon.describeHorizon({ table: 'T', groups: [] });
  assert.strictEqual(described.bounded, false);
  assert.strictEqual(described.text, '');
});
