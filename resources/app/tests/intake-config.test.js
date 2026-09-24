'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const intake = require('../server/lib/intake-report');
const db = require('../server/db');
const modelScopes = require('../server/lib/model-scopes');
const modelFields = require('../server/lib/model-fields');

test('INTAKE veritabanı bağlantısı model bağlantı ayarlarında ayrı rol olarak korunur', () => {
  const connection = db.normalizeModelConnection({
    id: 'mc_intake',
    name: 'INTAKE',
    server: intake.INTAKE_CONNECTION.server,
    catalog: intake.INTAKE_CONNECTION.catalog,
    role: 'intake',
    refreshEnabled: true,
  });

  assert.equal(connection.role, 'intake');
  assert.deepEqual(modelScopes.allowedTargets('intake'), ['intake']);
  assert.deepEqual(connection.scopes[0].targets, ['intake']);
  assert.equal(db.normalizeModelConnections([]).find(item => item.role === 'intake').catalog, intake.INTAKE_CONNECTION.catalog);
});

test('INTAKE Field Mapping kataloğu yalnız INTAKE datasource alanlarından oluşur',()=>{
  const fields=modelFields.fieldsForRole('intake');
  assert.ok(fields.some(field=>field.header==='Tedarik Cluster'));
  assert.ok(fields.some(field=>field.header==='Güncel Alım Bütçe'));
  assert.equal(fields.some(field=>field.header==='Sipariş Kod'),false);
});

test('INTAKE runtime metadata can feed Field Mapping without a duplicate schema',()=>{
  const fields=intake.defaultFields().slice(0,2),mapped=modelFields.intakeFieldsForMapping(fields);
  assert.equal(mapped.length,2);
  assert.equal(mapped[0].sourceUniqueName,fields[0].sourceUniqueName);
  assert.equal(mapped[0].header,fields[0].defaultLabel);
});

test('INTAKE canlı şema veri tipini Horizon metadata için korur', () => {
  const [field] = intake.normalizeSchema({
    columns: [{ table: 'SupplyBasket', name: 'Son Guncelleme Tarihi', dataType: 'DateTime' }],
  });

  assert.equal(field.dataType, 'DateTime');
});

test('INTAKE varsayılan görünüm Excel hiyerarşisini ve measure sırasını taşır', () => {
  const config = intake.defaultViewConfig();

  assert.deepEqual(
    config.query.rows.map(field => field.defaultLabel),
    ['Tedarik Cluster', 'Dönem Tanim', 'UrunKlasmanTanim']
  );
  assert.deepEqual(
    config.query.measures.map(field => field.defaultLabel),
    [
      'Güncel Alım Bütçe',
      'Sezon Öncesi Güncel Alım Bütçe',
      'Sezon Öncesi Aylık Plan Sipariş Miktarı',
      'FT Ayrılan Güncel Alım Bütçe',
      'Kümülatif Sipariş Miktar',
      'Sezon Öncesi WSSI Sipariş Miktarı',
      'Yedek Bütçe Sipariş',
      'Sezon Öncesi Güncel Alım Bütçe OTB Miktar',
      'Sezon Öncesi Güncel Alım Bütçe OTB Miktar ( Terminal )',
      'SEZON OTB (REZERV DAHİL)',
    ]
  );
  assert.equal(config.query.measures[9].sourceUniqueName, '[Measures].[Güncel Alım Bütçe OTB Oranı]');
});

test('INTAKE varsayılan filtreleri sadeleştirilir ve sıfır Güncel Alım Bütçe gizleme açık gelir', () => {
  const config = intake.defaultViewConfig();

  assert.deepEqual(
    config.query.filters.map(field => field.defaultLabel),
    ['Merch Yil Ay', 'Satış Cluster', 'Versiyon Tanim', 'SezonKod', 'MerchAltGrupKod', 'BuyerGrupTanim']
  );
  assert.equal(config.display.hideZeroCurrentBudget, true);
});

test('INTAKE v1 boş eski varsayılan filtreleri v2 görünümüne taşırken temizler', () => {
  const saved = intake.defaultViewConfig();
  saved.version = 1;
  const legacyFields = intake.defaultFields();
  const bySource = new Map(legacyFields.map(field => [field.sourceUniqueName, field]));
  saved.query.filters.push(
    bySource.get('[Dim_Urun].[MerchAltGrupTanim]'),
    bySource.get('[Dim_Tarih].[Son Guncelleme Tarihi]'),
    bySource.get('[Dim_Urun].[UrunKlasmanKod]'),
  );

  const resolved = intake.reconcileViewConfig(saved, legacyFields);
  const sources = new Set(resolved.query.filters.map(field => field.sourceUniqueName));

  assert.equal(resolved.version, 2);
  assert.equal(sources.has('[Dim_Urun].[MerchAltGrupTanim]'), false);
  assert.equal(sources.has('[Dim_Tarih].[Son Guncelleme Tarihi]'), false);
  assert.equal(sources.has('[Dim_Urun].[UrunKlasmanKod]'), false);
});

test('INTAKE v1 eski varsayılan filtresinde seçili değer varsa migration filtreyi korur', () => {
  const fields = intake.defaultFields();
  const legacy = fields.find(field => field.sourceUniqueName === '[Dim_Urun].[UrunKlasmanKod]');
  const saved = intake.defaultViewConfig();
  saved.version = 1;
  saved.query.filters.push(legacy);
  saved.query.filterValues[legacy.id] = ['123'];

  const resolved = intake.reconcileViewConfig(saved, fields);

  assert.ok(resolved.query.filters.some(field => field.id === legacy.id));
  assert.deepEqual(resolved.query.filterValues[legacy.id], ['123']);
});

test('INTAKE custom label yalnız display katmanında tutulur ve reset ile silinir', () => {
  const base = intake.defaultViewConfig();
  const target = base.query.measures.find(field => field.defaultLabel === 'Kümülatif Sipariş Miktar');
  const changed = intake.updateDisplayLabel(base, target.id, 'Toplam Sipariş');

  assert.equal(changed.display.labels[target.id], 'Toplam Sipariş');
  assert.equal(changed.query.measures.find(field => field.id === target.id).sourceUniqueName, target.sourceUniqueName);
  assert.equal(intake.displayLabel(changed, target), 'Toplam Sipariş');
  assert.equal(intake.displayLabel(intake.resetView(changed), target), target.defaultLabel);
});

test('INTAKE metadata değişince kayıtlı olmayan alanlar sessizce görünümden çıkarılır', () => {
  const saved = intake.defaultViewConfig();
  const liveFields = intake.normalizeSchema({
    columns: [{ table: 'SupplyBasket', name: 'Tedarik Cluster', kind: 'column' }],
    measures: [{ table: 'Measures', name: 'Güncel Alım Bütçe', kind: 'measure' }],
  });
  const resolved = intake.reconcileViewConfig(saved, liveFields);

  assert.deepEqual(resolved.query.rows.map(field => field.defaultLabel), ['Tedarik Cluster']);
  assert.deepEqual(resolved.query.measures.map(field => field.defaultLabel), ['Güncel Alım Bütçe']);
  assert.doesNotThrow(() => intake.buildIntakeQuery({ fields: liveFields, viewConfig: resolved }));
});

test('INTAKE canlı şema yokken kayıtlı özel alanları korur', () => {
  const custom = intake.createField({
    id: 'intake-custom-phase',
    table: 'CustomPhase',
    name: 'Planning Phase',
    defaultLabel: 'Planning Phase',
    fieldType: 'dimension',
  });
  const saved = intake.defaultViewConfig();
  saved.query.columns = [custom];

  const resolved = intake.reconcileViewConfig(saved, []);

  assert.deepEqual(resolved.query.columns.map(field => field.id), ['intake-custom-phase']);
  assert.equal(resolved.query.columns[0].sourceUniqueName, '[CustomPhase].[Planning Phase]');
});
