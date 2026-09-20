'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Groups = require('../public/collection-model-groups.js');

const row = (id, colourCode, colour, extra = {}) => ({
  id, plmId: '2105001', modelKod: 'MINECRAFT-14-YD', inStoreMonth: 'JUNE 2027',
  colourCode, colour, quantity: id === 1 ? '6' : '4', targetPrice: '3.85',
  ...extra,
});

test('groups only exact PLM + normalized model + exact in-store month rows', () => {
  const rows = [row(1, 'WHT', 'WHITE'), row(2, 'GRY', 'GREY')];
  const result = Groups.normalizeRows(rows);
  assert.equal(result.groups.length, 1);
  assert.equal(result.groups[0].rows.length, 2);
  assert.ok(result.rows.every(item => item.modelGroupId && item.variantId));
  assert.equal(result.rows[0].modelGroupId, result.rows[1].modelGroupId);
});

test('does not auto-group incomplete or ambiguous identities', () => {
  const incomplete = Groups.normalizeRows([row(1, 'WHT', 'WHITE'), row(2, 'GRY', 'GREY', { inStoreMonth: '' })]);
  assert.equal(incomplete.groups.length, 0);
  const duplicateColour = Groups.normalizeRows([row(1, 'WHT', 'WHITE'), row(2, 'WHT', 'WHITE')]);
  assert.equal(duplicateColour.groups.length, 0);
  assert.ok(duplicateColour.rows.every(item => item.modelGroupId));
});

test('shared values inherit until a variant override is set', () => {
  const rows = [row(1, 'WHT', 'WHITE'), row(2, 'GRY', 'GREY')];
  const normalized = Groups.normalizeRows(rows).rows;
  const groupId = normalized[0].modelGroupId;
  const shared = Groups.setSharedValue(normalized, groupId, 'fabric', 'Single Jersey');
  assert.equal(Groups.effectiveValue(shared[1], 'fabric', shared), 'Single Jersey');
  const overridden = Groups.setVariantOverride(shared, 2, 'fabric', 'Two Thread');
  assert.equal(Groups.effectiveValue(overridden[1], 'fabric', overridden), 'Two Thread');
  assert.equal(Groups.effectiveValue(overridden[0], 'fabric', overridden), 'Single Jersey');
});

test('detaching and relinking preserve row data while changing membership', () => {
  const normalized = Groups.normalizeRows([row(1, 'WHT', 'WHITE'), row(2, 'GRY', 'GREY')]).rows;
  const oldGroup = normalized[1].modelGroupId;
  const detached = Groups.detachVariant(normalized, 2);
  assert.notEqual(detached[1].modelGroupId, oldGroup);
  assert.equal(detached[1].colourCode, 'GRY');
  const relinked = Groups.relinkVariant(detached, 2);
  assert.equal(relinked[1].modelGroupId, oldGroup);
});

test('pricing fields can be made color-specific without changing unrelated fields', () => {
  const normalized = Groups.normalizeRows([row(1, 'WHT', 'WHITE', { pricing: { 'ACME LTD': '3.20' } }), row(2, 'GRY', 'GREY', { pricing: { 'ACME LTD': '3.40' } })]).rows;
  const updated = Groups.setPricingOverrides(normalized, 2, ['targetPrice', 'fob']);
  assert.deepEqual(Object.keys(updated[1].variantOverrides).sort(), ['fob', 'pricing', 'targetPrice']);
  assert.deepEqual(updated[1].variantOverrides.pricing, { 'ACME LTD': '3.40' });
  assert.equal(updated[1].fabric, undefined);
});
