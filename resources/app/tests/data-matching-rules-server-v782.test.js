'use strict';

/* VERİ EŞLEŞTİRME KURALLARI — SUNUCU TARAFI (v7.82).
 *
 * Bu dosya server.js'i AYAĞA KALDIRMAZ; eşleştirme bloğunu bağımlılıkları
 * enjekte edilmiş bir kapsamda ÇALIŞTIRIR. Kaynak-sözleşme testi "şu metin
 * duruyor mu" diye sorar; burada asıl soru "bu kod ne yapıyor" olduğu için
 * davranış ölçülür: katalog gerçekten profillerden mi üretiliyor, kaybolan
 * sütun gerçekten reddediliyor mu, üçüncü bir bağlantı kod değişmeden
 * listeye giriyor mu.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const parseLib = require(path.join(ROOT, 'server', 'lib', 'parse.js'));
const modelFields = require(path.join(ROOT, 'server', 'lib', 'model-fields.js'));
const sourceProfiles = require(path.join(ROOT, 'server', 'lib', 'data-domain', 'source-profiles.js'));

const SERVER = fs.readFileSync(path.join(ROOT, 'server', 'server.js'), 'utf8');

/** Eşleştirme bloğunu enjekte edilmiş bağımlılıklarla yükler. */
function loadMatchBlock({ overrides, connections, schema = null }) {
  const start = SERVER.indexOf('function modelRole(item) {');
  const end = SERVER.indexOf("app.get('/api/match-rule'", start);
  assert.ok(start > 0 && end > start, 'eşleştirme bloğu bulunamadı');
  const body = SERVER.slice(start, end);
  const factory = new Function(
    'modelFields', 'modelQuery', 'parseLib', 'dataManagementSourceProfiles', 'loadOverrides', 'loadModelConnections',
    `${body}\nreturn { matchRuleSourceCatalog, enrichMatchConfigForSources, validateMatchConfig, suggestedMatchConfig, resolveMatchSource, primaryMatchConnection };`);
  return factory(
    modelFields,
    { discoverSchema: async () => (schema || { columns: [], errors: [] }) },
    parseLib,
    sourceProfiles,
    () => overrides,
    () => ({ items: connections }));
}

const LEGACY_CONFIG = {
  version: 1,
  conditions: [
    { id: 'ocode', asas: { header: 'Sipariş Kod' }, ias: { header: 'Sipariş Kod' } },
    { id: 'model', asas: { header: 'Model Adı' }, ias: { header: 'Ürün Ad' } },
    { id: 'ccode', asas: { header: 'Renk Kod' }, ias: { header: 'Renk Kod' } },
  ],
};

function asasConnection(overrides = {}) {
  return {
    id: 'conn-asas', name: 'ASAS', role: 'asas', server: 'srv1', catalog: 'ASAS_30', refreshEnabled: true,
    horizon: { table: 'Orders' },
    mapping: {
      'Sipariş Kod': { table: 'Orders', name: 'Order Code', kind: 'column' },
      'Model Adı': { table: 'Orders', name: 'Model', kind: 'column' },
      'Renk Kod': { table: 'Orders', name: 'Colour Code', kind: 'column' },
    },
    ...overrides,
  };
}
function iasConnection(overrides = {}) {
  return {
    id: 'conn-ias', name: 'IAS', role: 'antrepo', server: 'srv2', catalog: 'IASv2', refreshEnabled: true,
    horizon: { table: 'Shipments' },
    mapping: {
      'Sipariş Kod': { table: 'Shipments', name: 'Order Code', kind: 'column' },
      'Ürün Ad': { table: 'Shipments', name: 'Product', kind: 'column' },
      'Renk Kod': { table: 'Shipments', name: 'Colour Code', kind: 'column' },
    },
    ...overrides,
  };
}

const DB_MODE = { antrepoSourceMode: 'database', asasSourceMode: 'database', antrepoMatchConfig: LEGACY_CONFIG, _revisions: {} };
const EXCEL_MODE = { antrepoSourceMode: 'excel', asasSourceMode: 'excel', antrepoMatchConfig: LEGACY_CONFIG, _revisions: {} };

test('katalog kayıtlı bağlantılardan üretilir; kaynak adı koda gömülmez', async () => {
  const block = loadMatchBlock({ overrides: DB_MODE, connections: [asasConnection(), iasConnection()] });
  const catalog = await block.matchRuleSourceCatalog({}, { full: false });
  assert.deepStrictEqual(catalog.map(source => source.id), ['conn-asas', 'conn-ias']);
  assert.deepStrictEqual(catalog.map(source => source.role), ['asas', 'antrepo']);
  assert.deepStrictEqual(catalog.map(source => source.profileId), ['asas-orders', 'ias-warehouse']);
  // Açılışta tam şema TARANMAZ: yalnız kayıtlı alan eşlemesi listelenir.
  assert.deepStrictEqual(catalog[0].columns.map(column => column.name), ['Order Code', 'Model', 'Colour Code']);
  assert.strictEqual(catalog[0].authoritative, false);
});

test('üçüncü bağlantı listeye kod değişmeden girer', async () => {
  const third = asasConnection({ id: 'conn-asas-2', name: 'ASAS Arşiv', catalog: 'ASAS_ARCHIVE' });
  const block = loadMatchBlock({ overrides: DB_MODE, connections: [asasConnection(), iasConnection(), third] });
  const catalog = await block.matchRuleSourceCatalog({}, { full: false });
  assert.deepStrictEqual(catalog.map(source => source.id), ['conn-asas', 'conn-ias', 'conn-asas-2']);
  // Mantıksal takma ad YALNIZ birincil bağlantıya verilir; ikinci ASAS kendi
  // kimliğiyle seçilir, eski kayıtları çalmaz.
  assert.deepStrictEqual(catalog[0].aliases, ['asas']);
  assert.deepStrictEqual(catalog[2].aliases, []);
});

test('Excel modunda kaynak yine listelenir; veritabanı bağlantısı sorgulanmaz', async () => {
  const block = loadMatchBlock({ overrides: EXCEL_MODE, connections: [asasConnection(), iasConnection()] });
  const catalog = await block.matchRuleSourceCatalog({ antrepoHeaderInfo: { columns: ['Sipariş Kod', 'Ürün Ad', 'Renk Kod'] } }, { full: false });
  assert.deepStrictEqual(catalog.map(source => source.id), ['asas-excel', 'antrepo-excel']);
  // Gerçek başlıklar okunduysa antrepo listesi OTORİTERDİR; ASAS kataloğu değil
  // (Excel'de katalog dışı ek sütunlar olabiliyor).
  assert.strictEqual(catalog[1].authoritative, true);
  assert.strictEqual(catalog[0].authoritative, false);
});

test('eski ASAS/IAS kaydı yeni kaynak kimlikleriyle çözülür ve çözülemeyen alan bırakmaz', async () => {
  const block = loadMatchBlock({ overrides: DB_MODE, connections: [asasConnection(), iasConnection()] });
  const catalog = await block.matchRuleSourceCatalog({}, { full: false });
  const config = block.enrichMatchConfigForSources(LEGACY_CONFIG, catalog);
  assert.deepStrictEqual(config.conditions[0].operands.map(operand => operand.sourceId), ['conn-asas', 'conn-ias']);
  // Kanonik başlık gerçek model sütununa çözülür.
  assert.strictEqual(config.conditions[0].operands[0].name, 'Order Code');
  assert.strictEqual(config.conditions[1].operands[1].name, 'Product');
  assert.deepStrictEqual(parseLib.unresolvedMatchOperands(config), []);
  assert.doesNotThrow(() => block.validateMatchConfig(config));
});

test('kaybolan sütun çözülemez işaretlenir ve kayıt reddedilir', async () => {
  // IAS bağlantısının alan eşlemesinden "Ürün Ad" kaldırıldı: kuralın işaret
  // ettiği sütun artık yok.
  const broken = iasConnection();
  delete broken.mapping['Ürün Ad'];
  const block = loadMatchBlock({ overrides: DB_MODE, connections: [asasConnection(), broken] });
  const catalog = await block.matchRuleSourceCatalog({}, { full: false });
  const config = block.enrichMatchConfigForSources(LEGACY_CONFIG, catalog);
  const unresolved = parseLib.unresolvedMatchOperands(config);
  assert.strictEqual(unresolved.length, 1);
  assert.strictEqual(unresolved[0].label, 'Ürün Ad');
  assert.strictEqual(unresolved[0].reason, 'column');
  // BAŞKA BİR ALANA KAYMAZ: kural kullanıcı düzeltene kadar kaydedilemez.
  assert.throws(() => block.validateMatchConfig(config), error => error.code === 'MATCH_COLUMN_UNRESOLVED');
});

test('tam şema okunduğunda modelde olmayan sütun çözülemez sayılır', async () => {
  const block = loadMatchBlock({
    overrides: DB_MODE,
    connections: [asasConnection(), iasConnection()],
    schema: { columns: [{ table: 'Orders', name: 'Order Code', kind: 'column' }], errors: [] },
  });
  const catalog = await block.matchRuleSourceCatalog({}, { full: true });
  assert.strictEqual(catalog[0].authoritative, true);
  const config = block.enrichMatchConfigForSources({
    version: 2,
    conditions: [{
      id: 'ghost',
      operands: [
        { sourceId: 'conn-asas', role: 'asas', table: 'Orders', name: 'Silinmiş Sütun', header: 'Silinmiş Sütun' },
        { sourceId: 'conn-ias', role: 'antrepo', header: 'Sipariş Kod' },
      ],
    }],
  }, catalog);
  assert.strictEqual(config.conditions[0].operands[0].unresolved, 'column');
  assert.throws(() => block.validateMatchConfig(config), error => error.code === 'MATCH_COLUMN_UNRESOLVED');
});

test('birebir aynı koşul iki kez kaydedilemez', async () => {
  const block = loadMatchBlock({ overrides: DB_MODE, connections: [asasConnection(), iasConnection()] });
  const catalog = await block.matchRuleSourceCatalog({}, { full: false });
  const config = block.enrichMatchConfigForSources({
    version: 2,
    conditions: [
      { id: 'ocode', operands: [{ sourceId: 'conn-asas', role: 'asas', header: 'Sipariş Kod' }, { sourceId: 'conn-ias', role: 'antrepo', header: 'Sipariş Kod' }] },
      { id: 'ocode-again', operands: [{ sourceId: 'conn-asas', role: 'asas', header: 'Sipariş Kod' }, { sourceId: 'conn-ias', role: 'antrepo', header: 'Sipariş Kod' }] },
    ],
  }, catalog);
  assert.throws(() => block.validateMatchConfig(config), error => error.code === 'MATCH_CONDITION_DUPLICATE');
});

test('koşulsuz kural reddedilir', async () => {
  const block = loadMatchBlock({ overrides: DB_MODE, connections: [asasConnection(), iasConnection()] });
  assert.throws(() => block.validateMatchConfig({ version: 2, sources: [], conditions: [] }),
    error => error.code === 'MATCH_CONDITION_REQUIRED');
});

test('alan ekleyip kaydetmek yeni koşulu kuralın parçası yapar', async () => {
  const block = loadMatchBlock({
    overrides: DB_MODE,
    connections: [
      asasConnection({ mapping: { ...asasConnection().mapping, 'Renk': { table: 'Orders', name: 'Colour', kind: 'column' } } }),
      iasConnection({ mapping: { ...iasConnection().mapping, 'Renk Tanım': { table: 'Shipments', name: 'Colour Name', kind: 'column' } } }),
    ],
  });
  const catalog = await block.matchRuleSourceCatalog({}, { full: false });
  const edited = {
    version: 2,
    conditions: [
      ...LEGACY_CONFIG.conditions,
      { id: 'colour', operands: [{ sourceId: 'conn-asas', role: 'asas', header: 'Renk' }, { sourceId: 'conn-ias', role: 'antrepo', header: 'Renk Tanım' }] },
    ],
  };
  const saved = block.validateMatchConfig(block.enrichMatchConfigForSources(edited, catalog));
  assert.strictEqual(saved.conditions.length, 4);
  assert.strictEqual(saved.conditions[3].operands[0].name, 'Colour');
  assert.strictEqual(saved.conditions[3].operands[1].name, 'Colour Name');
  // Kaydedilen kural yeniden okunduğunda eşleştirmeye gerçekten katılır.
  assert.strictEqual(parseLib.matchConditionsForPair(saved, 'asas', 'antrepo').length, 4);
  assert.strictEqual(parseLib.isDefaultAntrepoMatchConfig(saved), false);
});

test('öneri rolden üretilir; taraflardan biri yoksa öneri yoktur', async () => {
  const both = loadMatchBlock({ overrides: DB_MODE, connections: [asasConnection(), iasConnection()] });
  const catalog = await both.matchRuleSourceCatalog({}, { full: false });
  const suggested = both.suggestedMatchConfig(catalog);
  assert.strictEqual(suggested.conditions.length, 3);
  assert.strictEqual(suggested.conditions[0].operands[0].sourceId, 'conn-asas');

  const onlyAsas = loadMatchBlock({
    overrides: { ...DB_MODE, antrepoSourceMode: 'database' },
    connections: [asasConnection()],
  });
  const thin = await onlyAsas.matchRuleSourceCatalog({}, { full: false });
  assert.strictEqual(onlyAsas.suggestedMatchConfig(thin), null);
});
