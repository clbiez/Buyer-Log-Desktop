'use strict';

// Regresyon: (1) alt opsiyonları silinip tek kalan ana renkte eski
// modelSharedValues/variantOverrides katmanı yeni yazımı gölgeliyordu
// (MB tarihi 2027 yazılıyor, 2026 görünmeye devam ediyordu). (2) Ana renkte
// onaylanan üretici alt opsiyona yalnız "öneri" (Best Price) olarak geçiyordu;
// onaylı üretici ham alandan okunuyor, fiyat ise kalıtımlı okunuyordu.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Groups = require('../public/collection-model-groups.js');

const APP = fs.readFileSync(path.join(__dirname, '..', 'public', 'app-main.js'), 'utf8');
const between = (source, start, end) => {
  const a = source.indexOf(start), b = source.indexOf(end, a + start.length);
  assert.ok(a >= 0 && b > a, `missing block ${start}`);
  return source.slice(a, b);
};

function grouped() {
  return Groups.normalizeRows([
    { id: 1, plmId: '10', modelKod: 'M-1', inStoreMonth: '2026-10', colour: 'BLACK', colourCode: 'BLK', inStore: '2026-10-05' },
    { id: 2, plmId: '10', modelKod: 'M-1', inStoreMonth: '2026-10', colour: 'GREY', colourCode: 'GRY', inStore: '2026-10-05' },
  ]).rows;
}

test('lone parent after deleting its variants: a new write is not shadowed by stale shared value', () => {
  let rows = grouped();
  const parent = rows.find(r => r.modelGroupRole === 'parent');
  rows = Groups.setSharedValue(rows, parent.modelGroupId, 'inStore', '2026-10-05');
  rows = Groups.normalizeRows(rows.filter(r => r.id === parent.id)).rows; // alt opsiyon silindi
  assert.equal(Groups.groupFor(rows, parent.modelGroupId).length, 1);
  rows = Groups.writeGroupedValue(rows, parent.id, 'inStore', '2027-01-04');
  const row = rows[0];
  assert.equal(Groups.effectiveValue(row, 'inStore', rows), '2027-01-04');
  assert.equal(Groups.createValueReader(rows)(row, 'inStore'), '2027-01-04');
});

test('lone detached row: stale colour override no longer shadows a plain write', () => {
  let rows = grouped();
  const variant = rows.find(r => r.modelGroupRole === 'variant');
  rows = Groups.setVariantOverride(rows, variant.id, 'inStore', '2026-11-02');
  rows = Groups.detachVariant(rows, variant.id);
  const row = Groups.writeOwnValue(rows.find(r => r.id === variant.id), 'inStore', '2027-02-01');
  assert.equal(Groups.effectiveValue(row, 'inStore', rows), '2027-02-01');
  assert.equal(Groups.hasVariantOverride(row, 'inStore'), false);
});

test('collection storage writer drops stale layers for ungrouped rows', () => {
  const writer = between(APP, 'function kolWriteGroupedStorageValue(', 'function kolEffectivePricing(');
  assert.match(writer, /api\?\.writeOwnValue\?api\.writeOwnValue\(row,key,value\):row\[key\]=value/);
});

test('variant inherits the parent approved manufacturer instead of falling back to Best Price', () => {
  let rows = grouped();
  const parent = rows.find(r => r.modelGroupRole === 'parent');
  rows = Groups.setSharedValue(rows, parent.modelGroupId, 'pricing', { A: '5,00', B: '4,00' });
  // Eski onay yolu: ana satırın ham alanı.
  rows.find(r => r.id === parent.id).confirmedManufacturer = 'A';
  const reader = Groups.createValueReader(rows);
  const variant = rows.find(r => r.modelGroupRole === 'variant');
  const name = Groups.approvedManufacturer(variant, reader.parentOf(variant));
  const confirmed = Groups.confirmedPricing({ confirmedManufacturer: name }, reader(variant, 'pricing'), Groups.kolParseMoneyNum);
  assert.deepEqual(confirmed, { name: 'A', price: 5 });
  const fn = between(APP, 'function kolConfirmedPricing(', '\n');
  assert.match(fn, /confirmedPricing\(String\(kolApprovedManufacturer\(row\)/, 'approval must be read through model inheritance');
});

test('own colour approval and explicit override are preserved over parent approval', () => {
  let rows = grouped();
  const parent = rows.find(r => r.modelGroupRole === 'parent');
  const variant = rows.find(r => r.modelGroupRole === 'variant');
  parent.confirmedManufacturer = 'A';
  variant.confirmedManufacturer = 'B'; // eski yolla verilmiş renk özel onay
  assert.equal(Groups.approvedManufacturer(variant, parent), 'B');
  rows = Groups.setVariantOverride(rows, variant.id, 'confirmedManufacturer', '');
  const child = rows.find(r => r.id === variant.id);
  assert.equal(Groups.approvedManufacturer(child, rows.find(r => r.id === parent.id)), '', 'explicit empty override = colour-level "not approved"');
  assert.equal(Groups.approvedManufacturer(parent, null), 'A');
});

test('parent approval through grouped storage propagates; differing own approvals become overrides', () => {
  let rows = grouped();
  const parent = rows.find(r => r.modelGroupRole === 'parent');
  rows = Groups.writeGroupedValue(rows, parent.id, 'confirmedManufacturer', 'A');
  const reader = Groups.createValueReader(rows);
  rows.filter(r => r.modelGroupRole === 'variant').forEach(v => assert.equal(Groups.approvedManufacturer(v, reader.parentOf(v)), 'A'));
  const fn = between(APP, 'function kolToggleConfirmedManufacturer(', 'function kolApplyCollectionCellChange(');
  assert.match(fn, /setVariantOverride\(kolRows,member\.id,'confirmedManufacturer',member\.confirmedManufacturer/);
});

test('approve toggle writes confirmed manufacturer through grouped storage and refreshes group FOB', () => {
  const fn = between(APP, 'function kolToggleConfirmedManufacturer(', 'function kolApplyCollectionCellChange(');
  assert.match(fn, /kolWriteGroupedStorageValue\(row,'confirmedManufacturer',/);
  assert.doesNotMatch(fn, /row\.confirmedManufacturer\s*=\s*norm/);
  assert.match(fn, /groupFor\?\.\(kolRows,row\.modelGroupId\)[\s\S]*kolApplyRulePricing/);
});
