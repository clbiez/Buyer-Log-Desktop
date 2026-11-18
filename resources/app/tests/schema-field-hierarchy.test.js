'use strict';

/* MODEL ALANLARININ HİYERARŞİK GÖRÜNÜMÜ
 *
 * KORUNAN KUSUR: "Veri Tabanından Sütun Ekle" penceresi şemadan yalnız
 * SÜTUNLARI (MDSCHEMA_HIERARCHIES) listeliyordu. Excel PivotTable alan
 * listesinde fx simgesiyle görünen ÖLÇÜLER (MDSCHEMA_MEASURES — ör. KPI
 * teslim performansı) sunucudan geldiği hâlde süzülüp atılıyordu; kullanıcı
 * pivotta gördüğü alanı Buyer Log'da bulamıyordu.
 *
 * Ayrıca alanlar Excel'deki gibi Tablo → Görüntü klasörü → Alan düzeninde
 * gruplanır; klasör bilgisi şemadan best-effort okunur.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const tree = require(path.join(ROOT, 'public', 'schema-tree.js'));
const modelQuery = require(path.join(ROOT, 'server', 'lib', 'modelQuery.js'));
const horizonFields = require(path.join(ROOT, 'server', 'lib', 'horizon-fields.js'));
const read = relative => fs.readFileSync(path.join(ROOT, relative), 'utf8');

const ENTRIES = [
  { table: 'KPI', name: 'Retail Depo Tarih Yıl Ay Gün', kind: 'column' },
  { table: 'KPI', name: 'Model Bütçe Tarih Yıl Ay Gün', kind: 'column' },
  { table: 'KPI', name: 'Model Bütçe T.G. Gelmesi Gereken', kind: 'measure', folder: 'KPI - Delivery Performance Acc. to Model Budget' },
  { table: 'KPI', name: 'KPI Üreticiyle Anlaşılan Tarihe Göre Zamanında Teslim Performansı', kind: 'measure', folder: 'KPI - Order Units\\On Time;İkinci Klasör' },
  { table: 'Kumaş', name: 'KPI Kumaş Teslim Performansı (Miktar)', kind: 'measure' },
];

test('ağaç Tablo → Klasör → Alan düzeninde kurulur; sütunlar, ölçüler, klasörler sırasıyla', () => {
  const roots = tree.build(ENTRIES);
  assert.deepStrictEqual(roots.map(node => node.name), ['KPI', 'Kumaş']);
  const kpi = roots[0];
  assert.strictEqual(kpi.count, 4);
  assert.deepStrictEqual(kpi.children.map(node => node.type === 'group' ? `[${node.name}]` : node.entry.name), [
    'Model Bütçe Tarih Yıl Ay Gün',
    'Retail Depo Tarih Yıl Ay Gün',
    '[KPI - Delivery Performance Acc. to Model Budget]',
    '[KPI - Order Units]',
  ]);
  // "\" iç içe klasör, ";" ikinci klasör: alan yalnız ilk klasöründe görünür.
  const orderUnits = kpi.children[3];
  assert.strictEqual(orderUnits.children[0].type, 'group');
  assert.strictEqual(orderUnits.children[0].name, 'On Time');
  assert.strictEqual(orderUnits.children[0].depth, 2);
  assert.strictEqual(orderUnits.children[0].children[0].entry.kind, 'measure');
  const groupNames = tree.flatten(roots).filter(node => node.type === 'group').map(node => node.name);
  assert.ok(!groupNames.includes('İkinci Klasör'));
});

test('arama ad, tablo ve klasörde yapılır; kapalı gruplar düzleştirmede atlanır', () => {
  const byName = tree.flatten(tree.build(ENTRIES, { query: 'performansi' }));
  assert.deepStrictEqual(byName.filter(node => node.type === 'leaf').map(node => node.entry.table), ['KPI', 'Kumaş']);
  const byFolder = tree.flatten(tree.build(ENTRIES, { query: 'delivery performance' })).filter(node => node.type === 'leaf');
  assert.deepStrictEqual(byFolder.map(node => node.entry.name), ['Model Bütçe T.G. Gelmesi Gereken']);
  const collapsed = tree.flatten(tree.build(ENTRIES), () => false);
  assert.deepStrictEqual(collapsed.map(node => node.name), ['KPI', 'Kumaş']);
  assert.deepStrictEqual(tree.ancestorIds(ENTRIES[3]), ['/KPI', '/KPI/KPI - Order Units', '/KPI/KPI - Order Units/On Time']);
});

function schemaRunner(responder) {
  return async args => {
    const query = fs.readFileSync(args[args.indexOf('-QueryFile') + 1], 'utf8');
    const outFile = args[args.indexOf('-OutFile') + 1];
    fs.writeFileSync(outFile, JSON.stringify(responder(query)), 'utf8');
    return { stdout: JSON.stringify({ ok: true, outFile, rowCount: 0, provider: 'test' }) };
  };
}

test('şema keşfi sütunların görüntü klasörünü taşır ve ölçüleri döndürür', async () => {
  const schema = await modelQuery.discoverSchema({ server: 'h1', catalog: 'c1' }, {
    runner: schemaRunner(query => {
      if (/MDSCHEMA_HIERARCHIES/.test(query)) {
        return [
          { DIMENSION_UNIQUE_NAME: '[KPI]', HIERARCHY_NAME: 'Retail Depo Tarih Yıl Ay Gün', HIERARCHY_DISPLAY_FOLDER: 'Tarihler' },
          { DIMENSION_UNIQUE_NAME: '[KPI]', HIERARCHY_NAME: 'Satış Hedef Bölge', HIERARCHY_DISPLAY_FOLDER: '' },
        ];
      }
      if (/MDSCHEMA_MEASURES/.test(query)) {
        return [{ MEASUREGROUP_NAME: 'KPI', MEASURE_NAME: 'Retail Depo T.G. Gelmesi Gereken', MEASURE_DISPLAY_FOLDER: 'KPI - Delivery' }];
      }
      return [];
    }),
  });
  const retail = schema.columns.find(column => column.name === 'Retail Depo Tarih Yıl Ay Gün');
  assert.strictEqual(retail.folder, 'Tarihler');
  assert.ok(!('folder' in schema.columns.find(column => column.name === 'Satış Hedef Bölge')));
  assert.deepStrictEqual(schema.measures.map(entry => [entry.table, entry.folder, entry.name]), [['KPI', 'KPI - Delivery', 'Retail Depo T.G. Gelmesi Gereken']]);
  const field = horizonFields.fromSchema(schema).find(entry => entry.dynamic && entry.name === 'Retail Depo Tarih Yıl Ay Gün');
  assert.strictEqual(field.folder, 'Tarihler');
});

test('klasör sütunu okunamazsa şema keşfi eski sorguya düşer, ÇÖKMEZ', async () => {
  const seen = [];
  const schema = await modelQuery.discoverSchema({ server: 'h2', catalog: 'c2' }, {
    runner: schemaRunner(query => {
      seen.push(query);
      if (/HIERARCHY_DISPLAY_FOLDER/.test(query)) throw new Error('bilinmeyen sütun');
      if (/MDSCHEMA_HIERARCHIES/.test(query)) return [{ DIMENSION_UNIQUE_NAME: '[Dim]', HIERARCHY_NAME: 'Sezon' }];
      return [];
    }),
  });
  assert.deepStrictEqual(schema.columns.map(column => column.name), ['Sezon']);
  assert.ok(seen.some(query => /HIERARCHY_DISPLAY_FOLDER/.test(query)));
});

test('Sütun Ekle penceresi ölçüleri de listeler ve seçilen türü kaydeder', () => {
  const app = read('public/app-main.js');
  const start = app.indexOf('async function openCpModelColumnModal');
  const body = app.slice(start, app.indexOf('window.openCpModelColumnModal = openCpModelColumnModal;', start));
  assert.ok(start > 0 && body.length > 0);
  assert.doesNotMatch(body, /e\.kind==='column'&&/, 'ölçüler süzülüp atılmamalı');
  assert.match(body, /data\.measures/);
  assert.match(body, /BLSchemaTree\.build\(schemaEntries/);
  assert.match(body, /const entry=\{kind:selectedField\.kind==='measure'\?'measure':'column',table:selectedField\.table,name:selectedField\.name,folder:selectedField\.folder\|\|''\};/);
  assert.match(read('public/index.html'), /<script src="schema-tree\.js\?v=__BL_ASSET_VERSION__"><\/script>/);
});

test('Horizon ve eşleme seçicileri aynı yüzen listede Tablo → Klasör başlıkları çizer', () => {
  const picker = read('public/data-management-picker.js');
  assert.match(picker, /class="dmfPickerGroup/);
  assert.match(picker, /Array\.isArray\(items\) \? items\.slice\(\) : \[\]/, 'çağıranın dizisi yerinde sıralanmamalı');
  const filter = read('public/data-management-filter.js');
  assert.match(filter, /function horizonFieldEntries\(fields\)/);
  assert.match(filter, /BLSchemaTree\.entryPath\(entry\)/);
  for (const file of ['public/data-management-mapping.js', 'public/data-management-cpcolumns.js']) {
    assert.match(read(file), /group: schemaPath\(entry\)/, file);
  }
  assert.match(read('public/intake.js'), /<optgroup label=/);
});
