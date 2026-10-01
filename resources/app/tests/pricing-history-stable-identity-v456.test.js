'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'public', 'quotations.js'), 'utf8');

function loadIdentityHelpers() {
  const names = [
    'qhModelKeys', 'qhItemKey', 'qhStableRowKeys', 'qhStableItemKeys',
    'qhRowMeta', 'qhSelectionIndex', 'qIdentityCompatible', 'qhStableMatchValid', 'qhSelectedMeta',
  ];
  const blocks = names.map((name) => {
    const match = SRC.match(new RegExp(`function ${name}\\([^)]*\\)\\{[\\s\\S]*?\\n  \\}`));
    assert.ok(match, `${name} bulunamadı`);
    return match[0];
  }).join('\n');
  const factory = new Function('qNorm', 'qMoneyNumber', 'qCurrentUserId', `${blocks}\nreturn {${names.join(',')}};`);
  return factory(
    value => String(value == null ? '' : value).trim(),
    value => {
      if (value == null || (typeof value === 'string' && !value.trim())) return NaN;
      const n = Number(value);
      return Number.isFinite(n) ? n : NaN;
    },
    () => '',
  );
}

// Model kartının tek kimlik alanı (model adı, kategori vb.) revize edilse de
// geçmiş stable rowId ile bulunur. PLM ID ve Model adı İKİSİ BİRDEN farklıysa
// rowId yeniden kullanılmış (veri taşıma / yeniden import) sayılır; bkz.
// quotations-best-price.test.js.
test('v4.56 model kartı alanları değişse de Pricing History stable rowId ile bulunur', () => {
  const { qhSelectionIndex, qhSelectedMeta } = loadIdentityHelpers();
  const currentRow = { id: 41, plmId: 'OLD-PLM', modelKod: 'NEW MODEL', urunTipi: 'NEW CATEGORY' };
  const oldQuotationItem = {
    rowId: 41,
    modelKey: 'kol:41',
    plmId: 'OLD-PLM',
    modelCode: 'OLD MODEL',
  };
  const index = qhSelectionIndex([currentRow]);
  const meta = qhSelectedMeta({ source: 'collection' }, oldQuotationItem, index);
  assert.ok(meta, 'eski quotation satırı güncel model kartına bağlanmalı');
  assert.equal(meta.model, 'NEW MODEL');
  assert.equal(meta.plmId, 'OLD-PLM');
  assert.equal(meta.identityKey, 'row:41');
});

test('Pricing History yeniden kullanılan rowId ile başka modelin geçmişini bağlamaz', () => {
  const { qhSelectionIndex, qhSelectedMeta } = loadIdentityHelpers();
  const reimportedRow = { id: 41, plmId: 'NEW-PLM', modelKod: 'NEW MODEL' };
  const staleItem = { rowId: 41, modelKey: 'kol:41', plmId: 'OLD-PLM', modelCode: 'OLD MODEL' };
  const index = qhSelectionIndex([reimportedRow]);
  assert.equal(qhSelectedMeta({ source: 'collection' }, staleItem, index), null);
  assert.equal(qhSelectedMeta({ source: 'collection', ownerId: 'other-user' },
    { ...staleItem, plmId: 'NEW-PLM', modelCode: 'NEW MODEL' }, index), null,
    'başka kullanıcının aynı rowId taşıyan kalemi bağlanmamalı');
});

test('v4.56 Duplicate Model eski modelin fiyat geçmişini devralmaz', () => {
  const { qhSelectionIndex, qhSelectedMeta } = loadIdentityHelpers();
  const duplicateRow = { id: 42, plmId: 'PLM-1', modelKod: 'MODEL A' };
  const sourceQuotationItem = {
    rowId: 41,
    modelKey: 'kol:41',
    plmId: 'PLM-1',
    modelCode: 'MODEL A',
  };
  const index = qhSelectionIndex([duplicateRow]);
  assert.equal(qhSelectedMeta({ source: 'collection' }, sourceQuotationItem, index), null,
    'stable kimliği farklı olan duplicate satıra legacy PLM/model fallback uygulanmamalı');
});

test('v4.56 rowId/modelKey taşımayan eski quotation kayıtları geriye uyumlu kalır', () => {
  const { qhSelectionIndex, qhSelectedMeta } = loadIdentityHelpers();
  const row = { id: 51, plmId: 'PLM-OLD', modelKod: 'LEGACY MODEL' };
  const legacyItem = { rowId: null, modelKey: '', plmId: 'PLM-OLD', modelCode: 'LEGACY MODEL' };
  const index = qhSelectionIndex([row]);
  assert.ok(qhSelectedMeta({ source: 'collection' }, legacyItem, index));
});

test('v4.56 Pricing History pivot mutable model adı yerine stable identityKey ile gruplanır', () => {
  assert.ok(SRC.includes("const key=r.identityKey||r.plmId+'\\u0000'+r.model;"));
  assert.ok(SRC.includes('identityKey:meta.identityKey'));
});
