'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

const modelFields = require(path.join(__dirname, '..', 'server', 'lib', 'model-fields.js'));
const modelRefresh = require(path.join(__dirname, '..', 'server', 'lib', 'model-refresh.js'));
const modelHorizon = require(path.join(__dirname, '..', 'server', 'lib', 'modelHorizon.js'));
const parse = require(path.join(__dirname, '..', 'server', 'lib', 'parse.js'));

function iasMapping() {
  return {
    'İthalat Dosya No': { table: 'Ithalat', name: 'İthalat Dosya No', kind: 'column' },
    'Konteyner No': { table: 'Ithalat', name: 'Konteyner No', kind: 'column' },
    'Yükleme Talep Tarih': { table: 'Ithalat', name: 'Yükleme Talep Tarih', kind: 'column' },
    'Sipariş Kod': { table: 'Siparis Bilgileri', name: 'Sipariş Kod', kind: 'column' },
    'Model Adı': { table: 'Siparis Bilgileri', name: 'Ürün Ad', kind: 'column' },
    'Renk Kod': { table: 'Siparis Bilgileri', name: 'Renk Kod', kind: 'column' },
    'Renk Tanım': { table: 'Siparis Bilgileri', name: 'Renk Tanım', kind: 'column' },
    'Supplier Portal Statü': { table: 'Ithalat', name: 'Supplier Portal Statü', kind: 'column' },
    'Tahmini Antrepo Giriş Tarihi': { table: 'Ithalat', name: 'Tahmini Antrepo Giriş Tarihi', kind: 'column' },
    'HANDOVER Tarihi': { table: 'Ithalat', name: 'Handover Tarihi - CutOff Tarihi', kind: 'measure' },
    'Vasita Tanim': { table: 'Ithalat', name: 'Vasita Tanim', kind: 'column' },
    'Yükleme Toplam Adet': { table: 'Ithalat', name: 'Yükleme Toplam Adet', kind: 'measure' },
    'Net Alım Sipariş Miktarı': { table: 'Ithalat', name: 'Net Alım Sipariş Miktarı', kind: 'measure' },
    'Sezon': { table: 'Siparis Bilgileri', name: 'Sezon', kind: 'column' },
  };
}

function iasConnection() {
  return {
    id: 'ias',
    name: 'IAS',
    role: 'antrepo',
    mode: 'auto',
    horizon: {
      table: 'Siparis Bilgileri',
      seasonTable: 'Siparis Bilgileri',
      seasonField: 'Sezon',
      seasons: ['W6'],
      groups: [],
    },
    mapping: iasMapping(),
  };
}

function iasRow(overrides = {}) {
  return {
    'İthalat Dosya No': '2026.000001.T',
    'Konteyner No': 'CONT-1',
    'Sipariş Kod': 'A',
    'Ürün Ad': 'MODEL',
    'Renk Kod': 'C',
    'Renk Tanım': 'SIYAH',
    'Supplier Portal Statü': 'Yol Operasyonları',
    'Tahmini Antrepo Giriş Tarihi': '2026-09-10',
    'Vasita Tanim': 'Gemi',
    'Yükleme Toplam Adet': 100,
    'Net Alım Sipariş Miktarı': 300,
    ...overrides,
  };
}

test('v4.44 IAS fact tablosunu belirleyen İthalat Dosya No Field Mapping içinde zorunludur', () => {
  const field = modelFields.fieldsForRole('antrepo').find(item => item.header === 'İthalat Dosya No');
  assert.ok(field && field.required);
  assert.ok(modelFields.missingRequired('antrepo', {
    'Sipariş Kod': 'Sipariş Kod',
    'Model Adı': 'Ürün Ad',
    'Renk Kod': 'Renk Kod',
    'Supplier Portal Statü': 'Supplier Portal Statü',
    'Tahmini Antrepo Giriş Tarihi': 'Tahmini Antrepo Giriş Tarihi',
    'Yükleme Toplam Adet': 'Yükleme Toplam Adet',
  }).includes('İthalat Dosya No'));
});

test('v4.44 otomatik IAS eşlemesi satır alanlarında ölçü yerine gerçek sütunu seçer', () => {
  const schema = {
    columns: [
      { table: 'Ithalat', name: 'İthalat Dosya No', kind: 'column' },
      { table: 'Siparis', name: 'Sipariş Kod', kind: 'column' },
      { table: 'Siparis', name: 'Ürün Ad', kind: 'column' },
      { table: 'Siparis', name: 'Renk Kod', kind: 'column' },
      { table: 'Ithalat', name: 'Supplier Portal Statü', kind: 'column' },
      { table: 'Ithalat', name: 'Tahmini Antrepo Giriş Tarihi', kind: 'column' },
    ],
    measures: [
      { table: 'Measures', name: 'Supplier Portal Statü', kind: 'measure' },
      { table: 'Measures', name: 'Yükleme Toplam Adet', kind: 'measure' },
      { table: 'Measures', name: 'Net Alım Sipariş Miktarı', kind: 'measure' },
    ],
  };
  const auto = modelFields.autoMapSchema('antrepo', schema);
  assert.strictEqual(auto.mapping['Supplier Portal Statü'].kind, 'column');
  assert.strictEqual(auto.mapping['Supplier Portal Statü'].table, 'Ithalat');
  assert.strictEqual(auto.mapping['Yükleme Toplam Adet'].kind, 'measure');
});

test('v4.44 Yükleme Toplam Adet hem sütun hem ölçüyse satır sütunu tercih edilir', () => {
  const schema = {
    columns: [
      { table: 'Ithalat', name: 'İthalat Dosya No', kind: 'column' },
      { table: 'Siparis', name: 'Sipariş Kod', kind: 'column' },
      { table: 'Siparis', name: 'Ürün Ad', kind: 'column' },
      { table: 'Siparis', name: 'Renk Kod', kind: 'column' },
      { table: 'Ithalat', name: 'Supplier Portal Statü', kind: 'column' },
      { table: 'Ithalat', name: 'Tahmini Antrepo Giriş Tarihi', kind: 'column' },
      { table: 'Ithalat', name: 'Yükleme Toplam Adet', kind: 'column' },
    ],
    measures: [
      { table: 'Measures', name: 'Yükleme Toplam Adet', kind: 'measure' },
      { table: 'Measures', name: 'Net Alım Sipariş Miktarı', kind: 'measure' },
    ],
  };
  const auto = modelFields.autoMapSchema('antrepo', schema);
  assert.strictEqual(auto.mapping['Yükleme Toplam Adet'].kind, 'column');
  assert.strictEqual(auto.mapping['Yükleme Toplam Adet'].table, 'Ithalat');
});

test('v4.44 IAS otomatik sorgusu SUMMARIZECOLUMNS yerine gerçek fact satırlarını projekte eder', () => {
  const built = modelRefresh.buildConnectionQuery(iasConnection());
  assert.match(built.query, /SELECTCOLUMNS\(/);
  assert.match(built.query, /CALCULATETABLE\(\s*'Ithalat'/);
  assert.doesNotMatch(built.query, /SUMMARIZECOLUMNS/);
  assert.doesNotMatch(built.query, new RegExp(modelHorizon.BLANK_ROW_GUARD));
  assert.match(built.query, /"İthalat Dosya No", 'Ithalat'\[İthalat Dosya No\]/);
  assert.match(built.query, /"Sipariş Kod", CALCULATE\(SELECTEDVALUE\('Siparis Bilgileri'\[Sipariş Kod\]\)\)/);
  assert.match(built.query, /"Yükleme Toplam Adet", CALCULATE\(\[Yükleme Toplam Adet\]\)/);
  assert.doesNotMatch(built.query, /"Net Alım Sipariş Miktarı"/);
  assert.match(built.query, /"HANDOVER Tarihi", CALCULATE\(\[Handover Tarihi - CutOff Tarihi\]\)/);
  assert.doesNotMatch(built.query, /"Sezon",/,
    'ufuk sütunu filtrede kullanılmalı fakat IAS çıktı satırlarını gruplamamalı');
});

test('v4.44 fact-row sorgusu Data Source and Filters ve sipariş kodu daraltmasını birlikte korur', () => {
  const extra = `'Siparis Bilgileri'[Sipariş Kod] IN { "A", "B" }`;
  const built = modelRefresh.buildConnectionQuery(iasConnection(), { extraExpression: extra });
  assert.match(built.query, /'Siparis Bilgileri'\[Sezon\] IN \{ "W6" \}/);
  assert.ok(built.query.includes(extra));
});

test('v4.44 aynı İthalat Dosya No ve Konteyner No altındaki farklı parsiyeller tekilleştirilmez', () => {
  const map = parse.parseAntrepoRows([
    iasRow({ 'Yükleme Toplam Adet': 100, 'Yükleme Talep Tarih': '2026-08-01' }),
    iasRow({ 'Yükleme Toplam Adet': 200, 'Yükleme Talep Tarih': '2026-08-02' }),
  ]);
  const hits = parse.findAntrepoHits(map, { ocode: 'A', model: 'MODEL', ccode: 'C' });
  assert.strictEqual(hits.length, 2);
  assert.deepStrictEqual(hits.map(row => row.loadedQty), [100, 200]);
  assert.strictEqual(parse.antrepoParseMeta(map).keyCount, 2);
});

test('v4.44 geçerli çoklu parsiyel veri bütünlüğü kontrolünden geçer', () => {
  const map = parse.parseAntrepoRows([
    iasRow({ 'Yükleme Toplam Adet': 100 }),
    iasRow({ 'Yükleme Toplam Adet': 200, 'Konteyner No': 'CONT-2' }),
  ]);
  assert.doesNotThrow(() => modelRefresh.validateAntrepoIntegrity('backlog', map, [
    { ocode: 'A', model: 'MODEL', ccode: 'C', qty: 300 },
  ]));
});

test('v4.44 IAS toplamı ASAS miktarını aşsa bile tahmini toleransla satır silinmez veya birleştirilmez', () => {
  const map = parse.parseAntrepoRows([
    iasRow({ 'Yükleme Toplam Adet': 100 }),
    iasRow({ 'Yükleme Toplam Adet': 200, 'Konteyner No': 'CONT-2' }),
  ]);
  assert.doesNotThrow(() => modelRefresh.validateAntrepoIntegrity('backlog', map, [
    { ocode: 'A', model: 'MODEL', ccode: 'C', qty: 100 },
  ]));
  assert.strictEqual(parse.findAntrepoHits(map, { ocode: 'A', model: 'MODEL', ccode: 'C' }).length, 2);
});

test('v4.50 IAS Net Alım Sipariş Miktarı boş veya tutarsız olsa da kullanılmadığı için refresh engellenmez', () => {
  const map = parse.parseAntrepoRows([
    iasRow({ 'Net Alım Sipariş Miktarı': '', 'Yükleme Toplam Adet': 100 }),
    iasRow({ 'Net Alım Sipariş Miktarı': 9999, 'Yükleme Toplam Adet': 200, 'Konteyner No': 'CONT-2' }),
  ]);
  assert.doesNotThrow(() => modelRefresh.validateAntrepoIntegrity('backlog', map, [
    { ocode: 'A', model: 'MODEL', ccode: 'C', qty: 300 },
  ]));
});



test('v4.50 aynı anahtardaki birebir aynı IAS satırlarının tamamı bağımsız parsiyel olarak korunur', () => {
  const rows = Array.from({ length: 25 }, () => iasRow({ 'Yükleme Toplam Adet': 100 }));
  const map = parse.parseAntrepoRows(rows);
  const meta = parse.antrepoParseMeta(map);
  assert.strictEqual(meta.matchableRows, 25);
  assert.strictEqual(meta.keyCount, 25);
  assert.strictEqual(parse.findAntrepoHits(map, { ocode: 'A', model: 'MODEL', ccode: 'C' }).length, 25);
  assert.doesNotThrow(() => modelRefresh.validateAntrepoIntegrity('EXCEL', map, [
    { ocode: 'A', model: 'MODEL', ccode: 'C', qty: 2500 },
  ]));
});

test('v4.44 Yükleme Toplam Adet boşsa miktar tahmin edilmeden refresh durdurulur', () => {
  const map = parse.parseAntrepoRows([iasRow({ 'Yükleme Toplam Adet': '' })]);
  assert.throws(() => modelRefresh.validateAntrepoIntegrity('backlog', map, []),
    error => error && error.code === 'MODEL_REFRESH_ANTREPO_LOADED_QTY_MISSING');
});

test('v4.44 IAS Auto Match gerçek İthalat tablosunu seçer ve satır alanlarını aynı tablodan önceliklendirir', () => {
  const schema = {
    columns: [
      // Aynı başlıkların bir rapor/boyut tablosunda önce gelmesi fact tablosunu
      // yanlış seçtirmemeli.
      { table: 'Rapor', name: 'İthalat Dosya No', kind: 'column' },
      { table: 'Rapor', name: 'Sipariş Kod', kind: 'column' },
      { table: 'Rapor', name: 'Ürün Ad', kind: 'column' },
      { table: 'Rapor', name: 'Renk Kod', kind: 'column' },
      { table: 'İthalat', name: 'İthalat Dosya No', kind: 'column' },
      { table: 'İthalat', name: 'Sipariş Kod', kind: 'column' },
      { table: 'İthalat', name: 'Ürün Ad', kind: 'column' },
      { table: 'İthalat', name: 'Renk Kod', kind: 'column' },
      { table: 'İthalat', name: 'Supplier Portal Statü', kind: 'column' },
      { table: 'İthalat', name: 'Tahmini Antrepo Giriş Tarihi', kind: 'column' },
      { table: 'İthalat', name: 'Yükleme Toplam Adet', kind: 'column' },
      { table: 'İthalat', name: 'Net Alım Sipariş Miktarı', kind: 'column' },
    ],
    measures: [],
  };
  const auto = modelFields.autoMapSchema('antrepo', schema);
  for (const header of ['İthalat Dosya No', 'Sipariş Kod', 'Model Adı', 'Renk Kod', 'Supplier Portal Statü', 'Tahmini Antrepo Giriş Tarihi', 'Yükleme Toplam Adet']) {
    assert.strictEqual(auto.mapping[header].table, 'İthalat', `${header} gerçek IAS fact tablosundan seçilmeli`);
  }
  assert.strictEqual(auto.mapping['Net Alım Sipariş Miktarı'], undefined);
});

test('v4.44 IAS sonucu tamamen boşsa bütün siparişler üretimde kabul edilebilir ve refresh engellenmez', () => {
  const map = parse.parseAntrepoRows([]);
  assert.doesNotThrow(() => modelRefresh.validateAntrepoIntegrity('backlog', map, [
    { ocode: 'A', model: 'MODEL', ccode: 'C', qty: 300 },
  ]));
});
