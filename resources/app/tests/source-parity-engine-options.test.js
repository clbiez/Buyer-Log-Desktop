'use strict';

/* Kaynak doğrulama (ASAS / IAS / Excel parity) için motora eklenen İKİ
   SEÇENEĞİN sözleşmesi:

   1) iasLookup: 'related' — IAS fact-row sorgusunda fact dışındaki tablo
      alanları RELATED() ile okunur (aday sorgu). VARSAYILAN DEĞİŞMEZ: seçenek
      verilmezse üretim sorgusu birebir bugünkü CALCULATE(SELECTEDVALUE(...))
      ifadesini üretir.
   2) excludeFabric: true — ASAS sorgusundan kumaş alanları çıkarılır (ölçüm
      için). VARSAYILAN DEĞİŞMEZ: seçenek verilmezse kumaş alanları sorgudadır.

   Bu seçenekler yalnız scripts/source-parity-check.js tarafından açılır;
   üretim yenilemesi hiçbirini geçmez. */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const root = path.join(__dirname, '..');
const modelHorizon = require(path.join(root, 'server', 'lib', 'modelHorizon.js'));
const modelRefresh = require(path.join(root, 'server', 'lib', 'model-refresh.js'));
const modelFields = require(path.join(root, 'server', 'lib', 'model-fields.js'));

const T = 'Siparis Bilgileri';

function iasMapping() {
  return {
    'İthalat Dosya No': { table: 'Ithalat', name: 'İthalat Dosya No', kind: 'column' },
    'Konteyner No': { table: 'Ithalat', name: 'Konteyner No', kind: 'column' },
    'Sipariş Kod': { table: T, name: 'Sipariş Kod', kind: 'column' },
    'Model Adı': { table: T, name: 'Ürün Ad', kind: 'column' },
    'Renk Kod': { table: T, name: 'Renk Kod', kind: 'column' },
    'Supplier Portal Statü': { table: 'Ithalat', name: 'Supplier Portal Statü', kind: 'column' },
    'Tahmini Antrepo Giriş Tarihi': { table: 'Ithalat', name: 'Tahmini Antrepo Giriş Tarihi', kind: 'column' },
    'HANDOVER Tarihi': { table: 'Ithalat', name: 'Handover Tarihi - CutOff Tarihi', kind: 'measure' },
    'Yükleme Toplam Adet': { table: 'Ithalat', name: 'Yükleme Toplam Adet', kind: 'measure' },
    'Sezon': { table: T, name: 'Sezon', kind: 'column' },
  };
}
function iasItem() {
  return {
    id: 'ias', name: 'IAS', role: 'antrepo', mode: 'auto', server: 's', catalog: 'c',
    horizon: { table: T, seasonTable: T, seasonField: 'Sezon', seasons: ['W6'], groups: [] },
    mapping: iasMapping(),
  };
}

const ASAS_TABLE = 'ASAS';
function asasMapping() {
  const mapping = {};
  for (const field of modelFields.fieldsForRole('asas')) {
    mapping[field.header] = { table: ASAS_TABLE, name: field.header, kind: 'column' };
  }
  mapping['Net Alım Sipariş Miktarı'] = { table: ASAS_TABLE, name: 'Net Alım Sipariş Miktarı', kind: 'measure' };
  return mapping;
}
function asasItem() {
  return {
    id: 'asas', name: 'ASAS', role: 'asas', mode: 'auto', server: 's', catalog: 'c',
    horizon: { table: ASAS_TABLE, seasonTable: ASAS_TABLE, seasonField: 'Sezon', seasons: ['W6'], groups: [] },
    mapping: asasMapping(),
  };
}

test('IAS fact-row sorgusu varsayılan olarak bugünkü SELECTEDVALUE ifadesini korur', () => {
  const built = modelHorizon.buildFactRowQuery(iasItem().horizon, iasMapping(), { grainTable: 'Ithalat' });
  assert.match(built.query, /CALCULATE\(SELECTEDVALUE\('Siparis Bilgileri'\[Sipariş Kod\]\), CALCULATETABLE\('Ithalat'\)\)/);
  assert.doesNotMatch(built.query, /RELATED\(/);
});

test('relatedLookup: fact dışı sütunlar RELATED ile, fact sütunları ve ölçüler aynen okunur', () => {
  const built = modelHorizon.buildFactRowQuery(iasItem().horizon, iasMapping(), { grainTable: 'Ithalat', relatedLookup: true });
  assert.match(built.query, /"Sipariş Kod", RELATED\('Siparis Bilgileri'\[Sipariş Kod\]\)/);
  assert.match(built.query, /"Model Adı", RELATED\('Siparis Bilgileri'\[Ürün Ad\]\)/);
  assert.match(built.query, /"İthalat Dosya No", 'Ithalat'\[İthalat Dosya No\]/);
  assert.match(built.query, /"Yükleme Toplam Adet", CALCULATE\(\[Yükleme Toplam Adet\]\)/);
  assert.doesNotMatch(built.query, /SELECTEDVALUE/);
  // Satır evreni (kaynak tablo ve filtre) iki varyantta birebir aynıdır.
  const current = modelHorizon.buildFactRowQuery(iasItem().horizon, iasMapping(), { grainTable: 'Ithalat' });
  const source = query => query.split('),\n        "')[0].split('SELECTCOLUMNS(')[1].split('\n        "')[0];
  assert.equal(source(built.query), source(current.query));
});

test('buildConnectionQuery IAS adayını yalnız iasLookup=related ile üretir', () => {
  const current = modelRefresh.buildConnectionQuery(iasItem(), { columnType: null });
  const candidate = modelRefresh.buildConnectionQuery(iasItem(), { columnType: null, iasLookup: 'related' });
  assert.doesNotMatch(current.query, /RELATED\(/);
  assert.match(candidate.query, /RELATED\('Siparis Bilgileri'\[Renk Kod\]\)/);
});

test('ASAS sorgusu varsayılan olarak kumaş alanlarını içerir; excludeFabric yalnız kumaşı çıkarır', () => {
  const withFabric = modelRefresh.buildConnectionQuery(asasItem(), { columnType: null });
  const withoutFabric = modelRefresh.buildConnectionQuery(asasItem(), { columnType: null, excludeFabric: true });
  for (const header of modelFields.FABRIC_HEADERS) {
    assert.ok(withFabric.query.includes(`[${header}]`), `${header} varsayılan sorguda olmalı`);
    assert.ok(!withoutFabric.query.includes(`[${header}]`), `${header} kumaşsız sorguda olmamalı`);
  }
  // Kumaş dışındaki bütün alanlar korunur.
  for (const header of ['Sipariş Kod', 'Model Adı', 'Renk Kod', 'FOB Fiyatı', 'Net Alım Sipariş Miktarı']) {
    assert.ok(withoutFabric.query.includes(`[${header}]`), `${header} kumaşsız sorguda kalmalı`);
  }
});

test('excludeFabric IAS sorgusunu, iasLookup ASAS sorgusunu değiştirmez', () => {
  assert.equal(
    modelRefresh.buildConnectionQuery(iasItem(), { columnType: null, excludeFabric: true }).query,
    modelRefresh.buildConnectionQuery(iasItem(), { columnType: null }).query);
  assert.equal(
    modelRefresh.buildConnectionQuery(asasItem(), { columnType: null, iasLookup: 'related' }).query,
    modelRefresh.buildConnectionQuery(asasItem(), { columnType: null }).query);
});

test('loadFromModelConnections seçenekleri gerçek sorguya taşır; seçeneksiz çağrı üretimle aynıdır', async () => {
  const seen = [];
  const run = async (extra) => modelRefresh.loadFromModelConnections(
    [{ ...asasItem(), refreshEnabled: true }, { ...iasItem(), refreshEnabled: true }],
    {
      targets: ['cp'], includeLfl: false, columnType: false,
      discoverSchema: async () => ({ columns: [], measures: [] }),
      runModelRows: async (plan) => { seen.push(plan.query); return { rows: [], rowCount: 0 }; },
      ...extra,
    }).catch(() => null);
  await run({});
  const baseline = seen.splice(0);
  await run({ iasLookup: 'related', excludeFabric: true });
  const optioned = seen.splice(0);
  assert.ok(baseline.some(query => /SELECTEDVALUE/.test(query)), 'varsayılan IAS sorgusu');
  assert.ok(baseline.some(query => query.includes('[Ana Kumaş Mı]')), 'varsayılan ASAS sorgusu kumaşlı');
  assert.ok(optioned.some(query => /RELATED\(/.test(query)), 'aday IAS sorgusu');
  assert.ok(optioned.every(query => !query.includes('[Ana Kumaş Mı]')), 'kumaşsız ASAS sorgusu');
});

test('üretim yenilemesi (server.js) aday seçeneklerini açmaz', () => {
  const source = require('fs').readFileSync(path.join(root, 'server', 'server.js'), 'utf8');
  assert.doesNotMatch(source, /iasLookup\s*:/);
  assert.doesNotMatch(source, /excludeFabric\s*:/);
});
