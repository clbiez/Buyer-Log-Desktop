'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const parse = require(path.join(ROOT, 'server', 'lib', 'parse.js'));
const lfl = require(path.join(ROOT, 'server', 'lib', 'lfl.js'));
const modelFields = require(path.join(ROOT, 'server', 'lib', 'model-fields.js'));
const modelScopes = require(path.join(ROOT, 'server', 'lib', 'model-scopes.js'));
const html = (fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8') + '\n' + fs.readFileSync(path.join(ROOT, 'public', 'app-main.js'), 'utf8'));
const lflSource = fs.readFileSync(path.join(ROOT, 'public', 'lfl.js'), 'utf8');
const serverSource = fs.readFileSync(path.join(ROOT, 'server', 'server.js'), 'utf8');
const workerSource = fs.readFileSync(path.join(ROOT, 'server', 'workers', 'excel-worker.js'), 'utf8');
const findFilesSource = fs.readFileSync(path.join(ROOT, 'server', 'lib', 'findFiles.js'), 'utf8');

const FABRIC_FIELDS = [
  'Ana Kumaş Mı', 'Kumaş Kategorisi', 'Kumaşçı Ülkesi', 'Kumaşçı',
  'Kumaş Tipi', 'İplik No', 'Gramaj', 'Karışım',
];

function asasRow(extra = {}) {
  return {
    'Sipariş Kod': '1234567',
    'Model Adı': 'MODEL A',
    'Renk Kod': 'C01',
    Renk: 'SİYAH',
    'Net Alım Sipariş Miktarı': 1000,
    'Kalan Alım Sipariş Miktarı': 1000,
    'FOB Fiyatı': 5.5,
    Üretici: 'ÜRETİCİ A',
    Sezon: 'S7',
    'Ürün Klasman': 'ÜST GİYİM',
    'Merch Alt Grup Kod': 'MAG1',
    'Merch Marka Yaş Grup Kod': 'MMYG1',
    'Buyer Grup (TR)': 'GRUP A',
    'Siparişin Üretildiği Ülke': 'TÜRKİYE',
    Lisans: 'MARVEL',
    'Orijinal Exfactory Merch Tarih': '2027-01-01',
    'Model Bütçe Tarih Yıl Ay Gün': '2027-02-01',
    Buyer: 'BUYER A',
    ...extra,
  };
}

function sideFabric(extra = {}) {
  return asasRow({
    'Ana Kumaş Mı': 0,
    'Kumaş Kategorisi': 'YAN KUMAŞ',
    'Kumaşçı Ülkesi': 'X',
    Kumaşçı: 'YAN FABRIC',
    'Kumaş Tipi': 'RIB',
    'İplik No': '10/1',
    Gramaj: 400,
    Karışım: '%100 YANLIŞ',
    ...extra,
  });
}

function mainFabric(extra = {}) {
  return asasRow({
    'Ana Kumaş Mı': 1,
    'Kumaş Kategorisi': 'ÖRME',
    'Kumaşçı Ülkesi': 'TÜRKİYE',
    Kumaşçı: 'ANA FABRIC',
    'Kumaş Tipi': 'SÜPREM',
    'İplik No': '30/1',
    Gramaj: 180,
    Karışım: '%100 PAMUK',
    ...extra,
  });
}

test('v4.72 CP kumaş bilgisini doğrudan ASAS içindeki Ana Kumaş Mı = 1 satırından alır', () => {
  const parsed = parse.parseASASRows([
    sideFabric(),
    mainFabric(),
    sideFabric({ 'Kumaş Tipi': 'INTERLOK' }),
  ]);

  assert.equal(parsed.orders.length, 1, 'kumaş bileşenleri siparişi çoğaltmamalı');
  const row = parsed.orders[0];
  assert.deepEqual(
    [row.fabricCategory, row.fabricSupplierCountry, row.fabricSupplier, row.kumasTipi, row.iplikNo, row.fabricWeight, row.karisim],
    ['ÖRME', 'TÜRKİYE', 'ANA FABRIC', 'SÜPREM', '30/1', '180', '%100 PAMUK'],
  );
  assert.equal(parsed.fabricHeaderInfo.source, 'ASAS');
  assert.equal(parsed.fabricHeaderInfo.mainRowCount, 1);
  assert.equal(parsed.fabricHeaderInfo.ignoredNonMainRows, 2);
  assert.equal(parsed.fabricHeaderInfo.matchingRule, 'Sipariş Kod + Model Adı + Renk Kod; yalnız Ana Kumaş Mı = 1');
});

test('v4.72 ana kumaş satırı kaynakta sonra gelse de üçlü sipariş kimliğine uygulanır', () => {
  const parsed = parse.parseASASRows([
    sideFabric(),
    mainFabric(),
    mainFabric({ 'Renk Kod': 'C02', Renk: 'BEYAZ', Kumaşçı: 'BEYAZ FABRIC', Karışım: '%95 PAMUK %5 EA' }),
  ]);
  assert.equal(parsed.orders.length, 2);
  const byColour = new Map(parsed.orders.map(row => [row.ccode, row]));
  assert.equal(byColour.get('C01').fabricSupplier, 'ANA FABRIC');
  assert.equal(byColour.get('C02').fabricSupplier, 'BEYAZ FABRIC');
  assert.equal(byColour.get('C02').karisim, '%95 PAMUK %5 EA');
});

test('v4.72 Ana Kumaş Mı alanı yoksa CP yan kumaş bilgisini kullanmaz ve uyarır', () => {
  const source = sideFabric();
  delete source['Ana Kumaş Mı'];
  const parsed = parse.parseASASRows([source]);
  assert.equal(parsed.orders.length, 1);
  assert.equal(parsed.orders[0].fabricCategory, '');
  assert.equal(parsed.orders[0].fabricSupplier, '');
  assert.ok(parsed.fabricHeaderInfo.warnings.some(message => message.includes('Ana Kumaş Mı')));
});

test('v4.72 LFL aynı ASAS satırlarından yalnız ana kumaşı alır ve siparişi tekilleştirir', () => {
  const parsed = lfl.parseLFLRows([
    sideFabric(),
    mainFabric(),
    sideFabric({ Kumaşçı: 'BAŞKA YAN FABRIC' }),
  ], 'ASAS');

  assert.equal(parsed.rows.length, 1);
  const row = parsed.rows[0];
  assert.equal(row.orderCode, '1234567');
  assert.equal(row.modelName, 'MODEL A');
  assert.equal(row.colourCode, 'C01');
  assert.deepEqual(
    [row.fabricCategory, row.fabricSupplierCountry, row.fabricSupplier, row.kumasTipi, row.iplikNo, row.fabricWeight, row.karisim],
    ['ÖRME', 'TÜRKİYE', 'ANA FABRIC', 'SÜPREM', '30/1', '180', '%100 PAMUK'],
  );
  assert.equal(parsed.meta.mainFabricRows, 1);
  assert.equal(parsed.meta.ignoredNonMainFabricRows, 2);
  assert.deepEqual(parsed.meta.dimensions.fabricCategories, ['ÖRME']);
  assert.deepEqual(parsed.meta.dimensions.fabricTypes, ['SÜPREM']);
  assert.deepEqual(parsed.meta.dimensions.fabricWeights, ['180']);
  assert.deepEqual(parsed.meta.dimensions.fabricBlends, ['%100 PAMUK']);
});

test('v4.72 Ana Kumaş Mı alanı yoksa LFL kumaş detaylarını kabul etmez', () => {
  const source = mainFabric();
  delete source['Ana Kumaş Mı'];
  const parsed = lfl.parseLFLRows([source], 'ASAS');
  assert.equal(parsed.rows.length, 1);
  assert.equal(parsed.rows[0].fabricCategory, '');
  assert.equal(parsed.rows[0].karisim, '');
  assert.equal(parsed.meta.missingMainFabricSheets, 1);
  assert.ok(parsed.meta.warnings.some(message => message.includes('Ana Kumaş Mı')));
});

test('v4.72 kumaş alanları ayrı Fabric rolünde değil ana ASAS alan eşlemesindedir', () => {
  const columns = [
    'Sipariş Kod', 'Renk', 'Renk Kod', 'FOB Fiyatı', 'Üretici', 'Sezon',
    'Model Adı', 'Orijinal Exfactory Merch Tarih', ...FABRIC_FIELDS,
  ];
  const auto = modelFields.autoMapColumns('asas', columns);
  assert.deepEqual(modelFields.missingRequired('asas', auto.mapping), []);
  for (const header of FABRIC_FIELDS) assert.ok(auto.mapping[header], `${header} ASAS rolünde eşlenmeli`);
  assert.deepEqual(modelFields.fieldsForRole('fabric'), []);
  assert.deepEqual(modelScopes.allowedTargets('fabric'), []);
});

test('v4.72 CP kumaş sütunları istenen sırada ve yan yana bulunur', () => {
  // v7.0.229 — Kumaş Detayları sırası kullanıcı talebiyle güncellendi.
  const fields = ['Kumaş Tipi', 'Kumaş Kategorisi', 'Kumaşçı Ülkesi', 'Kumaşçı', 'Karışım', 'İplik No', 'Gramaj'];
  const positions = fields.map(field => html.indexOf(`{k:'${field}'`));
  positions.forEach((position, index) => assert.ok(position >= 0, `${fields[index]} CP sütunu bulunmalı`));
  assert.deepEqual([...positions].sort((a, b) => a - b), positions, 'kumaş sütun sırası korunmalı');
  for (let index = 0; index < positions.length - 1; index++) {
    const between = html.slice(positions[index], positions[index + 1]);
    assert.equal((between.match(/\{k:'/g) || []).length, 1, `${fields[index]} ile ${fields[index + 1]} arasında başka CP sütunu olmamalı`);
  }
});

test('v4.72 LFL filtreleri, kırılımları ve kumaş detay düğmesi korunur', () => {
  for (const dim of ['fabricCategory', 'fabricSupplierCountry', 'fabricSupplier', 'kumasTipi', 'iplikNo', 'fabricWeight', 'karisim']) {
    assert.ok(lflSource.includes(`${dim}:{label:`), `${dim} filtre meta alanında bulunmalı`);
    assert.ok(html.includes(`data-lfldim="${dim}"`), `${dim} filtre düğmesi bulunmalı`);
  }
  for (const dim of ['fabricCategory', 'kumasTipi', 'fabricWeight', 'karisim']) {
    assert.ok(lflSource.includes(`${dim}:{tr:`), `${dim} kırılım alanında bulunmalı`);
  }
  assert.ok(html.includes('id="lflFabricDetailsBtn"'));
  assert.ok(lflSource.includes('...(state.showFabricDetails?fabricDetailColumns():[])'));
});

test('v4.72 ayrı Update Fabric Informations işlevi ve Fabric bağlantı rolü kaldırılmıştır', () => {
  assert.doesNotMatch(html, /\/api\/fabric\/refresh/);
  assert.doesNotMatch(serverSource, /\/api\/fabric\/refresh/);
  assert.doesNotMatch(workerSource, /parseFabricFile|parseFabricWorkbook/);
  assert.doesNotMatch(html, /refreshFabricInformation|fabricRefreshBtn|value="fabric"/);
  assert.match(html, /MODEL_ROLE_TARGETS=\{asas:\['cp','orders','backlog','lfl'\],antrepo:\['cp','orders','backlog'\],intake:\['intake'\]\}/);
  assert.match(findFilesSource, /Eski ASAS - Fabric dosyası artık kaynak değildir/);
});

test('v4.72 Excel fallback ve tarayıcı yükleme akışları da kumaşı ana ASAS kaynağından üretir', () => {
  assert.match(workerSource, /parsedLfl = parseLFLWorkbook\(asasWorkbook\)/);
  assert.match(serverSource, /fabricHeaderInfo: parsedAsas\.fabricHeaderInfo \|\| null/);
  assert.match(html, /const mainFabricHeader=findHeader\(\['Ana Kumaş Mı'\]/);
  assert.match(html, /'Kumaş Kategorisi':o\.fabricCategory\|\|''/);
  assert.match(html, /'Karışım':o\.karisim\|\|''/);
});
