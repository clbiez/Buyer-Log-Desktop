'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const groups = require('../public/collection-model-groups.js');

const read = name => fs.readFileSync(path.join(__dirname, '../public', name), 'utf8');
const app = read('app-main.js');
const drawer = read('collection-price-drawer.js');
const slice = (source, start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start) + 1));

function setup(rows) {
  const effects = [];
  const context = {
    kolRows: groups.normalizeRows(rows).rows,
    kolWorkspaceCanEdit: true,
    kolNormalizeModelGroups: rows => groups.normalizeRows(rows).rows,
    kolEffectiveValue: (row, key) => groups.effectiveValue(row, key, context.kolRows),
    kolHasVariantOverride: groups.hasVariantOverride,
    kolCellLinkedToModel: row => row.modelGroupRole === 'variant' && !groups.hasVariantOverride(row, 'pricing'),
    editableValuesEqual: (a, b) => String(a ?? '') === String(b ?? ''),
    kolParseMoneyNum: value => Number.parseFloat(String(value).replace(',', '.')),
    norm: value => String(value ?? '').trim(),
    releaseKolTransientTopRow() {},
    kolPushUndo: () => effects.push('undo'),
    kolApplyRulePricing: () => effects.push('recalculate'),
    saveKolRows: () => effects.push('save'),
    renderKol: () => effects.push('render'),
    appLang: 'en',
    showToast() {},
    document: {createElement: () => ({dataset: {}, classList: {add() {}}})},
    window: {BLCollectionModelGroups: groups},
  };
  vm.createContext(context);
  vm.runInContext([
    slice(app, 'function kolWriteGroupedStorageValue', 'let kolRows ='),
    slice(app, 'function commitKolPriceEditor', 'function kolHasActiveTableFilters'),
    slice(app, 'function kolApplyCollectionCellChange', 'const KOL_VARIANT_FIELDS'),
  ].join('\n'), context);
  return {context, effects, remove: (rowId, manufacturer) => context.kolApplyCollectionCellChange({rowId, key: `pricing:${manufacturer}`, value: ''}, {removePrice: true})};
}

test('removes a direct offer and its approval in one undoable Collection edit', () => {
  const {context, effects, remove} = setup([{
    id: 1, _sourceOrderCode: 'DEMO-ORDER', targetPrice: '6,20',
    pricing: {'Demo Textile': '4,87', 'Other supplier': '5,10'},
    confirmedManufacturer: 'Demo Textile',
  }]);
  assert.equal(remove(1, 'Demo Textile'), true);
  const row = context.kolRows[0];
  assert.deepEqual({...row.pricing}, {'Other supplier': '5,10'});
  assert.equal(row.confirmedManufacturer, '');
  assert.equal(row.targetPrice, '6,20');
  assert.equal(row._sourceOrderCode, 'DEMO-ORDER');
  assert.equal(remove(1, 'Demo Textile'), false);
  assert.deepEqual(effects, ['undo', 'recalculate', 'save', 'render']);
});

test('preserves inherited prices and read-only workspaces, and clears an explicit colour offer locally', () => {
  const model = {plmId: '9001', modelKod: 'DEMO', inStoreMonth: '2027-03', pricing: {Demo: '4,87'}, confirmedManufacturer: 'Demo'};
  const {context, remove} = setup([
    {...model, id: 1, colour: 'Blue'},
    {...model, id: 2, colour: 'Red'},
    {...model, id: 3, colour: 'Green', variantOverrides: {pricing: {Demo: '5,00'}, confirmedManufacturer: 'Demo'}},
  ]);
  assert.equal(remove(2, 'Demo'), false);
  assert.equal(remove(3, 'Demo'), true);
  assert.equal(context.kolEffectivePricing(context.kolRows[0]).Demo, '4,87');
  assert.equal(context.kolEffectiveValue(context.kolRows[2], 'confirmedManufacturer'), '');
  assert.equal(Object.hasOwn(context.kolEffectivePricing(context.kolRows[2]), 'Demo'), false);
  context.kolWorkspaceCanEdit = false;
  assert.equal(remove(1, 'Demo'), false);
});

test('removing a shared offer preserves a different approval on a separately priced colour', () => {
  const model = {plmId: '9001', modelKod: 'DEMO', inStoreMonth: '2027-03', pricing: {Demo: '4,87'}};
  const {context, remove} = setup([
    {...model, id: 1, colour: 'Blue', confirmedManufacturer: 'Demo', modelSharedValues: {confirmedManufacturer: 'Demo'}},
    {...model, id: 2, colour: 'Red', confirmedManufacturer: 'Other', variantOverrides: {pricing: {Other: '5,50'}}},
  ]);
  assert.equal(remove(1, 'Demo'), true);
  assert.equal(context.kolEffectiveValue(context.kolRows[0], 'confirmedManufacturer'), '');
  assert.equal(context.kolRows[1].confirmedManufacturer, 'Other');
  assert.equal(context.kolEffectivePricing(context.kolRows[1]).Other, '5,50');
});

test('drawer exposes a delete action for valid direct prices and keeps Pricing Desk offers on their existing path', () => {
  const row = {pricing: {Direct: '4,87', Desk: '5,10', Waiting: '3,00', Linked: '6,20'}};
  const ledger = [
    {line: {manufacturer: 'Desk', price: '5.10'}, valid: true},
    {line: {manufacturer: 'Direct', price: '1.00'}, valid: true},
    {line: {manufacturer: 'Waiting', price: ''}, valid: false},
  ];
  const context = {
    kolEffectivePricing: row => row.pricing,
    kolConfirmedPricing: () => null,
    kolBestPricing: () => null,
    kolParseMoneyNum: value => Number.parseFloat(value.replace(',', '.')),
    kolPriceTargetDelta: () => null,
    kolCellLinkedToModel: (_row, key) => key === 'pricing:Linked',
    canEdit: () => true, money: String, T: (_tr, en) => en, esc: String, norm: String, global: {},
  };
  vm.createContext(context);
  vm.runInContext(slice(drawer, '  function hasLedgerOffer', '  function inputHtml'), context);
  const html = context.offersHtml(row, ledger);
  assert.match(html, /data-cpd-remove="Direct"/);
  assert.match(html, /data-cpd-remove="Waiting"/);
  assert.doesNotMatch(html, /data-cpd-remove="(?:Desk|Linked)"/);
  context.canEdit = () => false;
  assert.doesNotMatch(context.offersHtml(row, ledger), /data-cpd-remove/);
});
