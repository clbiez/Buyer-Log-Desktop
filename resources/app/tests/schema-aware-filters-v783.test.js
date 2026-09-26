'use strict';

/* ŞEMA FARKINDA VERİTABANI FİLTRELERİ (v7.83).
 *
 * KORUNAN KUSUR: filtre değeri üç katman boyunca METİN taşınıyordu (distinct
 * sorgusu → arayüz → kayıt) ve predicate üreticisi onu DAX'a yine metin olarak
 * yazıyordu. Model sütunu sayıysa `IN { "123" }` tip hatasıyla düşüyor; sütun
 * metinse ve "sayı gibi duran" bir değer sayıya çevrilirse baştaki sıfırlar
 * yok oluyor ve filtre HİÇBİR satırı tutmuyordu. İkisi de sessizdi.
 *
 * ZİNCİR: şema metadata → kanonik tipli değer → sağlayıcıya özgü predicate
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const types = require(path.join(ROOT, 'server', 'lib', 'filter-value-types.js'));
const modelHorizon = require(path.join(ROOT, 'server', 'lib', 'modelHorizon.js'));
const modelQuery = require(path.join(ROOT, 'server', 'lib', 'modelQuery.js'));
const modelConditions = require(path.join(ROOT, 'server', 'lib', 'model-conditions.js'));
const horizonFields = require(path.join(ROOT, 'server', 'lib', 'horizon-fields.js'));
const filterMapping = require(path.join(ROOT, 'server', 'lib', 'horizon-filter-mapping.js'));
const intakeReport = require(path.join(ROOT, 'server', 'lib', 'intake-report.js'));

/* --- Kanonik tipli değer ------------------------------------------------ */

test('şema tipi değerin DAX gösterimini belirler', () => {
  const literal = (value, type) => types.daxLiteral(types.toCanonical(value, type));
  // metin
  assert.strictEqual(literal('CK1E', 'text'), '"CK1E"');
  // tam sayı
  assert.strictEqual(literal('123', 'number'), '123');
  // ondalık — hem nokta hem virgül aynı sayıdır
  assert.strictEqual(literal('12.5', 'number'), '12.5');
  assert.strictEqual(literal('12,5', 'number'), '12.5');
  // tarih
  assert.strictEqual(literal('2026-01-05', 'date'), 'DATE(2026, 1, 5)');
  // boolean
  assert.strictEqual(literal('evet', 'boolean'), 'TRUE()');
});

test('SAYI GİBİ DURAN METİN sayıya çevrilmez; baştaki sıfırlar korunur', () => {
  /* Bu testin koruduğu kusur en pahalısıdır: "00123" sayıya çevrilirse 123
     olur, model tarafında hiçbir satır tutmaz ve hata da vermez. */
  assert.strictEqual(types.daxLiteral(types.toCanonical('00123', 'text')), '"00123"');
  assert.strictEqual(types.toCanonical('00123', 'text').text, '00123');
  // Sıfırla başlamayan ama sayısal görünen metin de metin kalır.
  assert.strictEqual(types.daxLiteral(types.toCanonical('123', 'text')), '"123"');
  // Alfasayısal kod hiçbir koşulda sayıya çevrilmez.
  assert.strictEqual(types.daxLiteral(types.toCanonical('A-001', 'text')), '"A-001"');
});

test('tipe uymayan değer sessizce düşmez, geçersiz işaretlenir', () => {
  const bad = types.toCanonical('CK1E', 'number');
  assert.strictEqual(bad.ok, false);
  assert.strictEqual(bad.reason, 'NOT_A_NUMBER');
  assert.strictEqual(types.daxLiteral(bad), null);
  assert.strictEqual(types.toCanonical('05.01.2026', 'date').ok, false);
});

test('parametreli SQL için değer GÖMÜLMEZ, tipli olarak döner', () => {
  assert.strictEqual(types.sqlParam(types.toCanonical('123', 'number')), 123);
  assert.strictEqual(types.sqlParam(types.toCanonical('00123', 'text')), '00123');
  assert.strictEqual(types.sqlParam(types.toCanonical('2026-01-05', 'date')), '2026-01-05');
  assert.strictEqual(types.sqlParam(types.toCanonical('hayır', 'boolean')), false);
  const many = types.sqlParams(['1', 'x', '2'], 'number');
  assert.deepStrictEqual(many.params, [1, 2]);
  assert.strictEqual(many.invalid.length, 1);
});

/* --- Şema metadata okuma ------------------------------------------------ */

test('OLE DB tip kodları kanonik tipe çevrilir', () => {
  assert.strictEqual(types.typeFromMetadata('130'), 'text');   // WSTR
  assert.strictEqual(types.typeFromMetadata('20'), 'number');  // I8
  assert.strictEqual(types.typeFromMetadata('5'), 'number');   // R8
  assert.strictEqual(types.typeFromMetadata('7'), 'date');     // DATE
  assert.strictEqual(types.typeFromMetadata('11'), 'boolean'); // BOOL
  // Bilinmeyen kod METİNE DÜŞMEZ; tip çözülmemiş sayılır.
  assert.strictEqual(types.typeFromMetadata('9999'), '');
});

test('şemadan gelen tip OTORİTER, addan tahmin edilen DEĞİL', () => {
  assert.deepStrictEqual(types.resolveType({ name: 'UrunKlasmanKod', dataType: '20' }),
    { type: 'number', confidence: 'schema' });
  // Metadata yoksa ad tahmini kullanılır ama güven düşüktür.
  assert.deepStrictEqual(types.resolveType({ name: 'Antrepo Giriş Tarihi' }),
    { type: 'date', confidence: 'heuristic' });
  assert.deepStrictEqual(types.resolveType({ name: 'UrunKlasmanKod' }),
    { type: 'text', confidence: 'none' });
});

test('sütun tipi çözücüsü YALNIZ otoriter tip döndürür', () => {
  const columnType = types.columnTypeIndex({
    columns: [
      { table: 'Dim_Urun', name: 'UrunKlasmanKod', kind: 'column', dataType: '20' },
      { table: 'Dim_Urun', name: 'MerchAltGrupKod', kind: 'column', dataType: '130' },
      // Tip metadata'sı yok: tahminle predicate zorlanmamalı.
      { table: 'Dim_Tarih', name: 'Merch Yil Ay', kind: 'column' },
    ],
  });
  assert.strictEqual(columnType('Dim_Urun', 'UrunKlasmanKod'), 'number');
  assert.strictEqual(columnType('Dim_Urun', 'MerchAltGrupKod'), 'text');
  assert.strictEqual(columnType('Dim_Tarih', 'Merch Yil Ay'), '');
  // Bilinmeyen sütun da boş döner; uydurma tip üretmez.
  assert.strictEqual(columnType('Dim_Urun', 'Yok Böyle Bir Sütun'), '');
});

test('aynı ad birden çok tabloda farklı tipteyse tablo bilinmeden çözülmez', () => {
  const columnType = types.columnTypeIndex({
    columns: [
      { table: 'A', name: 'Kod', kind: 'column', dataType: '20' },
      { table: 'B', name: 'Kod', kind: 'column', dataType: '130' },
    ],
  });
  assert.strictEqual(columnType('A', 'Kod'), 'number');
  assert.strictEqual(columnType('B', 'Kod'), 'text');
  // Tablo verilmezse TEKİLLİK yoktur; rastgele birini seçmek yerine çözmeyiz.
  assert.strictEqual(columnType('', 'Kod'), '');
});

/* --- Şema keşfi sütun tiplerini getiriyor mu --------------------------- */

function schemaRunner(responder) {
  return async args => {
    const query = fs.readFileSync(args[args.indexOf('-QueryFile') + 1], 'utf8');
    const outFile = args[args.indexOf('-OutFile') + 1];
    fs.writeFileSync(outFile, JSON.stringify(responder(query)), 'utf8');
    return { stdout: JSON.stringify({ ok: true, outFile, rowCount: 0, provider: 'test' }) };
  };
}
const HIERARCHY_ROWS = [
  { DIMENSION_UNIQUE_NAME: '[Dim_Urun]', HIERARCHY_NAME: 'UrunKlasmanKod' },
  { DIMENSION_UNIQUE_NAME: '[Dim_Urun]', HIERARCHY_NAME: 'MerchAltGrupKod' },
];

test('şema keşfi sütun veri tiplerini de okur', async () => {
  const schema = await modelQuery.discoverSchema({ server: 's', catalog: 'c' }, {
    runner: schemaRunner(query => {
      if (/MDSCHEMA_HIERARCHIES/.test(query)) return HIERARCHY_ROWS;
      if (/MDSCHEMA_LEVELS/.test(query)) {
        return [
          // "(All)" seviyesi gerçek sütun değildir ve tipi yanıltır.
          { DIMENSION_UNIQUE_NAME: '[Dim_Urun]', HIERARCHY_NAME: 'UrunKlasmanKod', LEVEL_NAME: '(All)', LEVEL_NUMBER: 0, LEVEL_DBTYPE: 130 },
          { DIMENSION_UNIQUE_NAME: '[Dim_Urun]', HIERARCHY_NAME: 'UrunKlasmanKod', LEVEL_NAME: 'UrunKlasmanKod', LEVEL_NUMBER: 1, LEVEL_DBTYPE: 20 },
          { DIMENSION_UNIQUE_NAME: '[Dim_Urun]', HIERARCHY_NAME: 'MerchAltGrupKod', LEVEL_NAME: 'MerchAltGrupKod', LEVEL_NUMBER: 1, LEVEL_DBTYPE: 130 },
        ];
      }
      return [];
    }),
  });
  const byName = Object.fromEntries(schema.columns.map(column => [column.name, column.dataType]));
  assert.strictEqual(byName.UrunKlasmanKod, '20');
  assert.strictEqual(byName.MerchAltGrupKod, '130');
  assert.strictEqual(schema.columnTypeMethod, 'mdschema-levels');
});

test('tip görünümü okunamazsa şema keşfi ÇÖKMEZ, tipsiz döner', () => {
  /* Yetki ya da ağ yüzünden tip görünümü okunamayabilir. Tip metadata'sı için
     şema keşfini düşürmek, yenilemeyi düzelttiğinden çok daha fazla bozardı. */
  return modelQuery.discoverSchema({ server: 's2', catalog: 'c2' }, {
    runner: schemaRunner(query => {
      if (/MDSCHEMA_HIERARCHIES/.test(query)) return HIERARCHY_ROWS;
      if (/MDSCHEMA_LEVELS|DBSCHEMA_COLUMNS/.test(query)) throw new Error('yetki yok');
      return [];
    }),
  }).then(schema => {
    assert.strictEqual(schema.columns.length, 2);
    assert.ok(schema.columns.every(column => !column.dataType));
    assert.ok(!schema.columnTypeMethod);
  });
});

/* --- Predicate üretimi -------------------------------------------------- */

const columnType = types.columnTypeIndex({
  columns: [
    { table: 'Dim_Urun', name: 'UrunKlasmanKod', kind: 'column', dataType: '20' },
    { table: 'Dim_Urun', name: 'MerchAltGrupKod', kind: 'column', dataType: '130' },
    { table: 'Dim_Urun', name: 'Fiyat', kind: 'column', dataType: '5' },
    { table: 'Dim_Tarih', name: 'Exfactory', kind: 'column', dataType: '7' },
  ],
});
function horizonWith(conditions) {
  return { table: 'Dim_Urun', groups: [{ id: 'g1', conditions }] };
}
function expressionFor(conditions, options = { columnType }) {
  return modelHorizon.buildHorizonFilter(horizonWith(conditions), null, options).expression;
}

test('sayısal sütuna sayısal literal yazılır (Klasman Kod kusuru)', () => {
  const expression = expressionFor([{
    id: 'c1', table: 'Dim_Urun', field: 'UrunKlasmanKod', name: 'UrunKlasmanKod',
    op: 'in', valueType: 'text', values: ['123', '456'],
  }]);
  assert.strictEqual(expression, `'Dim_Urun'[UrunKlasmanKod] IN { 123, 456 }`);
});

test('metin sütununda baştaki sıfır KORUNUR, kayıtlı tip sayı dese bile', () => {
  const expression = expressionFor([{
    id: 'c1', table: 'Dim_Urun', field: 'MerchAltGrupKod', name: 'MerchAltGrupKod',
    op: 'in', valueType: 'number', values: ['00123'],
  }]);
  assert.strictEqual(expression, `'Dim_Urun'[MerchAltGrupKod] IN { "00123" }`);
});

test('ondalık ve tarih sütunları kendi literalleriyle yazılır', () => {
  assert.match(expressionFor([{
    id: 'c1', table: 'Dim_Urun', field: 'Fiyat', name: 'Fiyat', op: 'between',
    valueType: 'text', values: [], from: '10,5', to: '20',
  }]), /\[Fiyat\] >= 10\.5 && 'Dim_Urun'\[Fiyat\] <= 20/);
  assert.match(expressionFor([{
    id: 'c1', table: 'Dim_Tarih', field: 'Exfactory', name: 'Exfactory', op: 'gte',
    valueType: 'text', values: [], from: '2026-01-05', to: '',
  }]), /\[Exfactory\] >= DATE\(2026, 1, 5\)/);
});

test('ŞEMA YOKSA bugünkü davranış korunur — tahminle predicate zorlanmaz', () => {
  const conditions = [{
    id: 'c1', table: 'Dim_Urun', field: 'UrunKlasmanKod', name: 'UrunKlasmanKod',
    op: 'in', valueType: 'text', values: ['123'],
  }];
  assert.strictEqual(expressionFor(conditions, {}), `'Dim_Urun'[UrunKlasmanKod] IN { "123" }`);
  // Çözücü patlasa bile kayıtlı tipe düşülür; sorgu üretimi durmaz.
  assert.strictEqual(
    expressionFor(conditions, { columnType: () => { throw new Error('şema yok'); } }),
    `'Dim_Urun'[UrunKlasmanKod] IN { "123" }`);
});

test('metin işleçleri sayısal sütunda BOZUK DAX üretmez, alan adıyla hata verir', () => {
  assert.throws(() => expressionFor([{
    id: 'c1', table: 'Dim_Urun', field: 'UrunKlasmanKod', name: 'UrunKlasmanKod',
    op: 'contains', valueType: 'text', values: ['12'],
  }]), error => error.code === 'CONDITION_TYPE_UNSUPPORTED' && /UrunKlasmanKod/.test(error.message));
  // Metin sütununda aynı işleç çalışmaya devam eder.
  assert.match(expressionFor([{
    id: 'c1', table: 'Dim_Urun', field: 'MerchAltGrupKod', name: 'MerchAltGrupKod',
    op: 'contains', valueType: 'text', values: ['CK'],
  }]), /SEARCH\("CK"/);
});

test('boşluk sınaması sayısal sütunda metin karşılaştırması yapmaz', () => {
  assert.strictEqual(expressionFor([{
    id: 'c1', table: 'Dim_Urun', field: 'UrunKlasmanKod', name: 'UrunKlasmanKod',
    op: 'empty', valueType: 'text', values: [],
  }]), `ISBLANK('Dim_Urun'[UrunKlasmanKod])`);
  assert.match(expressionFor([{
    id: 'c1', table: 'Dim_Urun', field: 'MerchAltGrupKod', name: 'MerchAltGrupKod',
    op: 'empty', valueType: 'text', values: [],
  }]), /ISBLANK\('Dim_Urun'\[MerchAltGrupKod\]\) \|\| 'Dim_Urun'\[MerchAltGrupKod\] = ""/);
});

test('ÇOK KOŞULLU filtre her koşulu kendi sütun tipiyle yazar', () => {
  const expression = expressionFor([
    { id: 'c1', table: 'Dim_Urun', field: 'UrunKlasmanKod', name: 'UrunKlasmanKod', op: 'in', valueType: 'text', values: ['123'] },
    { id: 'c2', table: 'Dim_Urun', field: 'MerchAltGrupKod', name: 'MerchAltGrupKod', op: 'in', valueType: 'text', values: ['00123'] },
    { id: 'c3', table: 'Dim_Tarih', field: 'Exfactory', name: 'Exfactory', op: 'gte', valueType: 'text', values: [], from: '2026-01-05' },
  ]);
  assert.match(expression, /\[UrunKlasmanKod\] IN \{ 123 \}/);
  assert.match(expression, /\[MerchAltGrupKod\] IN \{ "00123" \}/);
  assert.match(expression, /\[Exfactory\] >= DATE\(2026, 1, 5\)/);
});

test('KAYDEDİLİP YENİDEN YÜKLENEN filtre canlı şema tipiyle çalışır', () => {
  /* Kayıt, koşul kurulduğu andaki arayüz tahminini taşır. Alanın tipi
     sonradan öğrenildiğinde (ya da modelde değiştiğinde) kayıt eskimiş olur;
     predicate canlı şemayı esas almazsa aynı filtre yeniden yüklenince
     çalışmayı bırakır. */
  const saved = JSON.parse(JSON.stringify(modelConditions.normalizeGroups([{
    id: 'g1',
    conditions: [{ table: 'Dim_Urun', field: 'UrunKlasmanKod', name: 'UrunKlasmanKod', op: 'in', valueType: 'text', values: ['123'] }],
  }], 'Dim_Urun')));
  const reloaded = modelConditions.normalizeGroups(saved, 'Dim_Urun');
  const expression = modelHorizon.buildHorizonFilter(
    { table: 'Dim_Urun', groups: reloaded }, null, { columnType }).expression;
  assert.strictEqual(expression, `'Dim_Urun'[UrunKlasmanKod] IN { 123 }`);
});

test('tipin kaynağı kayıtta saklanır', () => {
  const [group] = modelConditions.normalizeGroups([{
    conditions: [{ field: 'Kod', op: 'in', valueType: 'number', valueTypeSource: 'schema', values: ['1'] }],
  }], 'T');
  assert.strictEqual(group.conditions[0].valueTypeSource, 'schema');
  // Uydurma bir kaynak kabul edilmez.
  const [other] = modelConditions.normalizeGroups([{
    conditions: [{ field: 'Kod', op: 'in', valueType: 'number', valueTypeSource: 'uydurma', values: ['1'] }],
  }], 'T');
  assert.strictEqual(other.conditions[0].valueTypeSource, '');
});

/* --- Birden çok veritabanı --------------------------------------------- */

test('İKİ AYRI BAĞLANTI kendi şemasıyla çözülür', () => {
  const asas = types.columnTypeIndex({ columns: [{ table: 'Siparis', name: 'Kod', kind: 'column', dataType: '130' }] });
  const ias = types.columnTypeIndex({ columns: [{ table: 'Sevkiyat', name: 'Kod', kind: 'column', dataType: '20' }] });
  const conditionFor = table => [{ id: 'c1', table, field: 'Kod', name: 'Kod', op: 'in', valueType: 'text', values: ['00123'] }];
  assert.strictEqual(
    modelHorizon.buildHorizonFilter({ table: 'Siparis', groups: [{ id: 'g', conditions: conditionFor('Siparis') }] }, null, { columnType: asas }).expression,
    `'Siparis'[Kod] IN { "00123" }`);
  assert.strictEqual(
    modelHorizon.buildHorizonFilter({ table: 'Sevkiyat', groups: [{ id: 'g', conditions: conditionFor('Sevkiyat') }] }, null, { columnType: ias }).expression,
    `'Sevkiyat'[Kod] IN { 123 }`);
});

test('modeller arası taşınan koşul HEDEFİN tipini alır', () => {
  /* ASAS'ta metin olan bir alanın IAS karşılığı sayı olabilir. Koşul
     kopyalanırken kaynağın tipi de geliyordu ve taşınan filtre hedefte tip
     hatasıyla düşüyordu. */
  const proposed = filterMapping.proposeMapping({
    groups: [{ id: 'g1', conditions: [{ id: 'c1', field: 'UrunKlasmanKod', name: 'UrunKlasmanKod', op: 'in', valueType: 'text', values: ['123'] }] }],
    targetFields: [{ header: 'UrunKlasmanKod', name: 'UrunKlasmanKod', table: 'Dim_Urun', type: 'number', typeSource: 'schema', dynamic: true }],
  });
  const mapped = proposed.groups[0].conditions[0];
  assert.strictEqual(mapped.valueType, 'number');
  assert.strictEqual(mapped.valueTypeSource, 'schema');
  // Uyuşmazlık yine de kullanıcıya söylenir; sessizce değiştirilmiş sayılmaz.
  assert.strictEqual(proposed.proposals[0].typeMismatch, 'text → number');
});

test('hedefin tipi TAHMİNSE kaynağın tipi korunur', () => {
  const proposed = filterMapping.proposeMapping({
    groups: [{ id: 'g1', conditions: [{ id: 'c1', field: 'Kod', name: 'Kod', op: 'in', valueType: 'text', values: ['00123'] }] }],
    targetFields: [{ header: 'Kod', name: 'Kod', table: 'T', type: 'number', typeSource: 'heuristic', dynamic: true }],
  });
  assert.strictEqual(proposed.groups[0].conditions[0].valueType, 'text');
});

/* --- Alan listesi ve INTAKE -------------------------------------------- */

test('şema alanları tipi ve tipin kaynağını birlikte taşır', () => {
  const fields = horizonFields.fromSchema({
    columns: [
      { table: 'Dim_Urun', name: 'UrunKlasmanKod', kind: 'column', dataType: '20' },
      { table: 'Dim_Urun', name: 'Serbest Alan', kind: 'column' },
    ],
  });
  const klasman = fields.find(field => field.name === 'UrunKlasmanKod');
  assert.strictEqual(klasman.type, 'number');
  assert.strictEqual(klasman.typeSource, 'schema');
  const serbest = fields.find(field => field.name === 'Serbest Alan');
  assert.strictEqual(serbest.type, 'text');
  assert.strictEqual(serbest.typeSource, 'none');
});

function intakeFields() {
  return [
    { sourceUniqueName: '[Dim_Urun].[UrunKlasmanKod]', fieldType: 'dimension', defaultLabel: 'UrunKlasmanKod', table: 'Dim_Urun', name: 'UrunKlasmanKod', dataType: '20' },
    { sourceUniqueName: '[Dim_Urun].[MerchAltGrupKod]', fieldType: 'dimension', defaultLabel: 'MerchAltGrupKod', table: 'Dim_Urun', name: 'MerchAltGrupKod', dataType: '130' },
    { sourceUniqueName: '[Phase].[Dönem Tanim].[Dönem Tanim]', fieldType: 'dimension', defaultLabel: 'Dönem Tanim', table: 'Phase', name: 'Dönem Tanim', dataType: '130' },
    { sourceUniqueName: '[Measures].[Güncel Alım Bütçe]', fieldType: 'measure', defaultLabel: 'Güncel Alım Bütçe', table: 'Measures', name: 'Güncel Alım Bütçe' },
  ];
}
function intakeView(fields, filterValues) {
  const byLabel = Object.fromEntries(fields.map(field => [field.defaultLabel, intakeReport.createField(field)]));
  return {
    config: {
      version: 1,
      query: {
        rows: [byLabel['Dönem Tanim']], columns: [],
        measures: [byLabel['Güncel Alım Bütçe']],
        filters: [byLabel.UrunKlasmanKod, byLabel.MerchAltGrupKod],
        filterValues: Object.fromEntries(Object.entries(filterValues).map(([label, values]) => [byLabel[label].id, values])),
      },
      display: {},
    },
    byLabel,
  };
}

test('INTAKE filtresi TREATAS değerlerini alanın şema tipiyle yazar', () => {
  const fields = intakeFields();
  const { config } = intakeView(fields, { UrunKlasmanKod: ['123', '456'], MerchAltGrupKod: ['00123', 'CK1E'] });
  const built = intakeReport.buildIntakeQuery({ fields, viewConfig: config });
  assert.match(built.query, /TREATAS\(\{ 123, 456 \}, 'Dim_Urun'\[UrunKlasmanKod\]\)/);
  assert.match(built.query, /TREATAS\(\{ "00123", "CK1E" \}, 'Dim_Urun'\[MerchAltGrupKod\]\)/);
});

test('INTAKE tipine uymayan değer sessizce atılmaz, düzeltmesi istenir', () => {
  const fields = intakeFields();
  const { config } = intakeView(fields, { UrunKlasmanKod: ['CK1E'], MerchAltGrupKod: ['CK1E'] });
  assert.throws(
    () => intakeReport.buildIntakeQuery({ fields, viewConfig: config }),
    error => error.code === 'INTAKE_FILTER_VALUE_TYPE' && /UrunKlasmanKod/.test(error.message));
});

test('INTAKE tip metadata yoksa eski davranış (metin) korunur', () => {
  const fields = intakeFields().map(field => ({ ...field, dataType: '' }));
  const { config } = intakeView(fields, { UrunKlasmanKod: ['123'] });
  const built = intakeReport.buildIntakeQuery({ fields, viewConfig: config });
  assert.match(built.query, /TREATAS\(\{ "123" \}, 'Dim_Urun'\[UrunKlasmanKod\]\)/);
});

/* --- Distinct değer, tipiyle birlikte ---------------------------------- */

test('distinct uçları değerin ALAN TİPİNİ de döndürür', () => {
  const server = require('./helpers/server-source')();
  const distinct = server.slice(
    server.indexOf('async function queryModelDistinctValues('),
    server.indexOf('/* VERİ YÖNETİMİ ÖZETİ (P2)'));
  assert.match(distinct, /valueType/, 'seçilen değer tipiyle birlikte dönmeli');
  /* Gösterim METİN kalır: "00123" sayıya çevrilseydi baştaki sıfırlar yok
     olurdu. Taşınan şey değerin biçimi değil, alanın tipidir. */
  assert.match(distinct, /String\(first\)\.trim\(\)/);
  // Metin araması sayısal sütunda DAX'a yazılmaz.
  assert.match(distinct, /supportsTextOperators/);
  assert.match(server, /valueType: distinct\.valueType/);
});

test('ekran koşulu distinct yanıtından gelen tiple damgalar', () => {
  const ui = fs.readFileSync(path.join(ROOT, 'public', 'data-management-filter.js'), 'utf8');
  assert.match(ui, /payload\.valueType/, 'değer listesi tipi koşula yazılmalı');
  assert.match(ui, /condition\.valueTypeSource = 'schema'/);
  assert.match(ui, /meta\.typeSource/, 'alan seçiminde tipin kaynağı taşınmalı');
});

test('kaynak adı ya da alan adı koda GÖMÜLMEZ', () => {
  const module = fs.readFileSync(path.join(ROOT, 'server', 'lib', 'filter-value-types.js'), 'utf8');
  const code = module.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  for (const forbidden of ['ASAS', 'IAS', 'Klasman', 'UrunKlasman', 'Antrepo']) {
    assert.ok(!code.includes(forbidden), `${forbidden} tip katmanına gömülmemeli`);
  }
});

/* --- Tip, SORGU ÜRETEN HER YOLA ulaşmalı -------------------------------
   Çözücü yalnız ana yenileme yolunda bağlıydı. Eşlemesiz sorgu, satır sayımı
   ve Test/Run kendi yollarında `options`u düşürüyordu: aynı ufuk yenilemede
   çalışıp denemede tip hatasıyla düşüyordu — kullanıcı için sebebi görünmez
   bir tutarsızlık. */

const numericKod = (table, name) => (String(name) === 'Kod' ? 'number' : '');
const kodCondition = table => modelConditions.normalizeGroups(
  [{ conditions: [{ field: 'Kod', name: 'Kod', table, op: 'in', valueType: 'text', values: ['123'] }] }], table);

test('EŞLEMESİZ sorgu yolu da şema tipini kullanır', () => {
  const horizon = { table: 'Siparis', groups: kodCondition('Siparis') };
  assert.match(
    modelHorizon.buildHorizonQuery(horizon, { columnType: numericKod }).query,
    /IN \{ 123 \}/);
  // Şema verilmezse bugünkü davranış (kayıtlı valueType) korunur.
  assert.match(modelHorizon.buildHorizonQuery(horizon, {}).query, /IN \{ "123" \}/);
});

test('SATIR SAYIMI sorgusu veri sorgusuyla aynı tipi yazar', () => {
  const horizon = { table: 'Siparis', groups: kodCondition('Siparis') };
  assert.match(
    modelHorizon.buildCountQuery(horizon, null, { columnType: numericKod }).query,
    /IN \{ 123 \}/);
  assert.match(modelHorizon.buildCountQuery(horizon, null).query, /IN \{ "123" \}/);
});

test('önizleme, sayım ve Test/Run uçları sütun tipini şemadan çözer', () => {
  const source = require('./helpers/server-source')();
  assert.match(source, /require\('\.\/lib\/model-refresh'\)/);
  assert.ok(/\{[^}]*resolveColumnTypes[^}]*\} = require\('\.\/lib\/model-refresh'\)/.test(source),
    'çözücü model-refresh.js\'ten alınmalı; ikinci bir kopya yazılmamalı');
  // Üç uç da çözücüyü çağırır: önizleme, sayım, Test/Run.
  const calls = source.match(/await resolveColumnTypes\(\{/g) || [];
  assert.ok(calls.length >= 3, `çözücü ${calls.length} uçta bağlı, en az 3 bekleniyor`);
  assert.match(source, /buildCountQuery\(aligned\.horizon, mapping, \{ columnType \}\)/);
  assert.match(source, /buildMappedQuery\(horizon, mapping, \{ topN: Number\(body\.topN\) \|\| 0, columnType \}\)/);
  assert.match(source, /buildHorizonQuery\(horizon, \{ topN: Number\(body\.topN\) \|\| 0, columnType \}\)/);
});
