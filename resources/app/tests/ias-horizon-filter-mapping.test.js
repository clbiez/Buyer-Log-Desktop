'use strict';

/* IAS (antrepo) filtre koşulları ASAS kataloğundaki başlıklarla kurulabiliyor
   ('Buyer Grup (TR)', 'Merch Alt Grup Kod' …). Bu başlıklar IAS modelinde
   fiziksel sütun adı değildir; DAX'a yazılmadan önce IAS bağlantısının Field
   Mapping'i ya da canlı şema üzerinden gerçek sütuna çözülmelidir.

   Kullanıcı hatası:
   Query (10, 28) Column 'Buyer Grup (TR)' in table 'Siparis Bilgileri' cannot be found… */

const test = require('node:test');
const assert = require('node:assert/strict');
const modelFields = require('../server/lib/model-fields');
const {
  buildConnectionQuery, repairHorizonAgainstSchema, fieldMappingRepairFromError, queryConnectionRows,
} = require('../server/lib/model-refresh');

const T = 'Siparis Bilgileri';
const F = 'IAS Fact';

function iasMapping(extra = {}) {
  return {
    'İthalat Dosya No': { table: F, name: 'Ithalat Dosya No', kind: 'column' },
    'Sipariş Kod': { table: T, name: 'Siparis Kod', kind: 'column' },
    'Model Adı': { table: T, name: 'Urun Ad', kind: 'column' },
    'Renk Kod': { table: T, name: 'Renk Kod', kind: 'column' },
    'Supplier Portal Statü': { table: F, name: 'Statu', kind: 'column' },
    'Tahmini Antrepo Giriş Tarihi': { table: F, name: 'Tahmini Giris', kind: 'column' },
    'Yükleme Toplam Adet': { table: F, name: 'Adet', kind: 'column' },
    ...extra,
  };
}
function iasItem(field, mapping) {
  return {
    id: 'ias-main', name: 'IAS', role: 'antrepo', mode: 'auto', server: 's', catalog: 'c',
    mapping,
    horizon: { table: T, groups: [{ id: 'g1', conditions: [{ id: 'c1', table: T, field, op: 'in', valueType: 'text', values: ['X'] }] }] },
  };
}

test('IAS filtresi eşlenmiş Ufuk alanını gerçek sütuna yazar (projeksiyondan çıkarılsa bile)', () => {
  const item = iasItem('Merch Alt Grup Kod', iasMapping({
    'Merch Alt Grup Kod': { table: T, name: 'MAG Kodu', kind: 'column' },
  }));
  const built = buildConnectionQuery(item, {});
  assert.match(built.query, /'Siparis Bilgileri'\[MAG Kodu\]\s+IN/);
  assert.doesNotMatch(built.query, /\[Merch Alt Grup Kod\]/);
  // Ufuk alanı hâlâ yalnız filtrede kullanılır; çıktı sütunu olarak projekte edilmez.
  assert.doesNotMatch(built.query, /"Merch Alt Grup Kod"/);
});

test('IAS alan kataloğu Buyer Grup (TR) alanını Ufuk alanı olarak taşır', () => {
  const field = modelFields.fieldsForRole('antrepo').find(entry => entry.header === 'Buyer Grup (TR)');
  assert.ok(field, 'IAS Field Mapping Buying Group alanını sunmalı');
  assert.equal(field.usedBy, 'Ufuk');
  assert.ok(!field.required);
  const auto = modelFields.autoMapSchema('antrepo', {
    columns: [
      { table: F, name: 'Ithalat Dosya No', kind: 'column' },
      { table: T, name: 'Buyer Grup', kind: 'column' },
    ],
    measures: [],
  });
  assert.equal(auto.mapping['Buyer Grup (TR)'] && auto.mapping['Buyer Grup (TR)'].name, 'Buyer Grup');
});

test('IAS Buyer Grup (TR) eşlemesi filtrede kullanılır', () => {
  const item = iasItem('Buyer Grup (TR)', iasMapping({
    'Buyer Grup (TR)': { table: T, name: 'Buyer Grup', kind: 'column' },
  }));
  const built = buildConnectionQuery(item, {});
  assert.match(built.query, /'Siparis Bilgileri'\[Buyer Grup\]\s+IN/);
  assert.doesNotMatch(built.query, /\[Buyer Grup \(TR\)\]/);
});

test('canlı şema onarımı Field Mapping ile çözülen koşulu bozmaz', () => {
  const item = iasItem('Buyer Grup (TR)', iasMapping({
    'Buyer Grup (TR)': { table: T, name: 'Buyer Grup', kind: 'column' },
  }));
  const repaired = repairHorizonAgainstSchema(item, {
    columns: [
      { table: T, name: 'Buyer Grup', kind: 'column', dataType: 'String' },
      { table: T, name: 'Buyer Grup Tanım', kind: 'column', dataType: 'String' },
    ],
  });
  assert.equal(repaired.repaired, false);
  assert.ok(!repaired.unresolved);
  assert.equal(item.horizon.groups[0].conditions[0].name, undefined);
});

test('eşlenmemiş IAS filtre alanının DAX hatası Field Mapping onarım eylemine ve açık mesaja dönüşür', async () => {
  const item = iasItem('Buyer Grup (TR)', iasMapping());
  await assert.rejects(queryConnectionRows(item, {
    columnType: Object.assign(() => '', {
      schema: { columns: [
        { table: T, name: 'Buyer Group Code', kind: 'column', dataType: 'String' },
        { table: T, name: 'Siparis Kod', kind: 'column', dataType: 'String' },
      ] },
    }),
    runModelRows: async () => {
      throw new Error("Query (10, 28) Column 'Buyer Grup (TR)' in table 'Siparis Bilgileri' cannot be found or may not be used in this expression.");
    },
  }), error => {
    assert.equal(error.code, 'MODEL_REFRESH_FIELD_MAPPING_REQUIRED');
    assert.equal(error.repairAction.kind, 'field-mapping');
    assert.equal(error.repairAction.sourceId, 'ias-main');
    assert.equal(error.repairAction.header, 'Buyer Grup (TR)');
    assert.match(error.message, /Buyer Grup \(TR\)/);
    assert.match(error.message, /Field Mapping/);
    return true;
  });
});

test('ModelQuery.ps1 "cannot be found" hatasını sözdizimi hatası diye etiketlemez', () => {
  const ps = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'server', 'lib', 'ModelQuery.ps1'), 'utf8');
  assert.match(ps, /Cannot find column\|cannot be found\|not found/);
});

test('kullanıcının bildirdiği DAX hatası IAS bağlantısında onarım eylemine dönüşür', () => {
  const repair = fieldMappingRepairFromError({ id: 'ias-main', name: 'IAS', role: 'antrepo', horizon: { table: T }, mapping: iasMapping() },
    new Error("Query (10, 28) Column 'Buyer Grup (TR)' in table 'Siparis Bilgileri' cannot be found or may not be used in this expression."));
  assert.ok(repair);
  assert.equal(repair.header, 'Buyer Grup (TR)');
});
