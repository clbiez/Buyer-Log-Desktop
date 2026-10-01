'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const intake = require('../server/lib/intake-report');

/* Canlı şema (MDSCHEMA_HIERARCHIES) alanları iki parçalı [Tablo].[Sütun]
   kimliği taşır; varsayılan tanımlar ise üç parçalı hiyerarşi biçimindedir.
   Kayıt sırasında canlı şema olmadan yapılan uzlaştırma etiket eşleşmesiyle
   alanı varsayılan kimliğe çeviriyor, snapshot satırları ise canlı kimlikle
   tutulduğu için tablo boyut değerlerini "(boş)" gösteriyordu. */
const liveFields = intake.normalizeSchema({
  columns: [
    { table: 'SupplyBasket', name: 'Tedarik Cluster', kind: 'column' },
    { table: 'Phase', name: 'Dönem Tanim', kind: 'column' },
    { table: 'Dim_Urun', name: 'UrunKlasmanTanim', kind: 'column' },
  ],
  measures: intake.DEFAULT_MEASURE_DEFINITIONS.map(def => ({ table: 'Measures', name: intake.sourceParts(def.sourceUniqueName).name, kind: 'measure' })),
});

function liveView() {
  const view = intake.reconcileViewConfig(intake.defaultViewConfig(), liveFields);
  const cluster = view.query.rows.shift();
  view.query.filters.push(cluster);
  view.query.filterValues[cluster.id] = ['Örme'];
  view.display.labels[view.query.rows[0].id] = 'Dönem';
  return view;
}

test('INTAKE canlı şema olmadan kaydedilen görünüm alan kimliklerini, etiketleri ve filtre değerlerini korur', () => {
  const view = liveView();
  const saved = intake.reconcileViewConfig(view, []);
  assert.deepEqual(saved.query.rows.map(f => f.id), view.query.rows.map(f => f.id));
  assert.deepEqual(saved.query.filters.map(f => f.id), view.query.filters.map(f => f.id));
  assert.deepEqual(saved.query.filterValues, view.query.filterValues);
  assert.equal(saved.display.labels[view.query.rows[0].id], 'Dönem');
});

test('INTAKE üç parçalı hiyerarşi kimliği iki parçalı canlı sütuna etiketten bağımsız eşlenir', () => {
  const view = intake.defaultViewConfig();
  view.query.rows = view.query.rows.map(f => ({ ...f, defaultLabel: `${f.defaultLabel} (özel)` }));
  const resolved = intake.reconcileViewConfig(view, liveFields);
  assert.deepEqual(resolved.query.rows.map(f => f.id), liveFields.filter(f => f.fieldType === 'dimension').map(f => f.id));
});

test('INTAKE snapshot satırları farklı kimlikli görünüme kaynak adıyla yeniden eşlenir', () => {
  const live = liveView();
  const legacy = intake.defaultViewConfig();
  const phaseLive = live.query.rows[0];
  const phaseLegacy = legacy.query.rows.find(f => f.defaultLabel === 'Dönem Tanim');
  assert.notEqual(phaseLive.id, phaseLegacy.id);
  const rows = intake.remapRows([{ [phaseLegacy.id]: 'Martta Başlayanlar' }], legacy, live);
  assert.equal(rows[0][phaseLive.id], 'Martta Başlayanlar');
});

test('INTAKE OTB oranı varsayılan olarak Güncel Alım Bütçe ağırlıklı ortalama ile özetlenir', () => {
  const config = intake.reconcileViewConfig(intake.defaultViewConfig(), liveFields);
  const otb = config.query.measures.find(f => f.sourceUniqueName === '[Measures].[Güncel Alım Bütçe OTB Oranı]');
  assert.equal(otb.agg, 'WAVG');
  assert.equal(otb.weightSource, '[Measures].[Güncel Alım Bütçe]');
  const legacy = intake.defaultViewConfig();
  legacy.version = 2;
  legacy.query.measures = legacy.query.measures.map(f => ({ ...f, agg: 'SUM', weightSource: undefined }));
  const migrated = intake.reconcileViewConfig(legacy, liveFields).query.measures.find(f => f.id === otb.id);
  assert.equal(migrated.agg, 'WAVG');
});

test('INTAKE ağırlık measure görünümde olmasa da sorguya ve satırlara eklenir', () => {
  const view = intake.reconcileViewConfig(intake.defaultViewConfig(), liveFields);
  view.query.measures = view.query.measures.filter(f => f.agg === 'WAVG');
  const built = intake.buildIntakeQuery({ fields: liveFields, viewConfig: view });
  const weightId = intake.stableFieldId('[Measures].[Güncel Alım Bütçe]');
  assert.match(built.query, new RegExp(`"${weightId}", \\[Güncel Alım Bütçe\\]`));
  const rows = intake.normalizeRows([{ [weightId]: 120, [view.query.measures[0].id]: 0.5 }], built.viewConfig);
  assert.equal(rows[0][weightId], 120);
});

test('INTAKE istemci WAVG özetini ağırlıkla hesaplar ve ağırlık değişince yeniden sorgular', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'public', 'intake.js'), 'utf8');
  assert.match(source, /'WAVG'/);
  assert.match(source, /agg === 'WAVG'/);
  assert.match(source, /intakeWeightSignature/);
});

test('INTAKE eski id ile kaydedilmiş filtre değeri ve etiket canlı id\'ye taşınır', () => {
  const legacy = intake.defaultViewConfig();
  const cluster = legacy.query.rows.shift();
  legacy.query.filters.push(cluster);
  legacy.query.filterValues[cluster.id] = ['Örme'];
  legacy.display.labels[legacy.query.rows[0].id] = 'Dönem';
  legacy.display.sort = { id: legacy.query.rows[0].id, dir: -1 };
  const resolved = intake.reconcileViewConfig(legacy, liveFields);
  const liveCluster = resolved.query.filters.find(f => f.defaultLabel === 'Tedarik Cluster');
  assert.notEqual(liveCluster.id, cluster.id);
  assert.deepEqual(resolved.query.filterValues[liveCluster.id], ['Örme']);
  assert.equal(resolved.display.labels[resolved.query.rows[0].id], 'Dönem');
  assert.deepEqual(resolved.display.sort, { id: resolved.query.rows[0].id, dir: -1 });
});
