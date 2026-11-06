'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const backfill = require('../public/collection-order-backfill');
const groups = require('../public/collection-model-groups');
// Mapper çıktısı: onaylı üretici Sub MFR, onaylı fiyat Supp. FOB (nihai FOB değil).
const draft = (key, values = {}) => ({key, row: {
  plmId: '100', modelKod: 'DEMO POLO', season: '6W26', inStoreMonth: '202702',
  inStore: '2027-02-01', inStoreWeek: '2027-05', quantity: '100', fob: '5.00',
  targetPrice: '4.00', country: 'TURKEY', confirmedManufacturer: 'SUB FACTORY',
  pricing: {'SUB FACTORY': '4.00'}, opd: '2026-10-03', exFactory: '2027-01-01',
  colourCode: 'RED', colour: 'Red', mag: 'MAG-1', buyer: 'Demo Buyer', fabric: 'Jersey',
  _sourceOrderCode: key, _sourceOrderDetails: {sourceFob: '5.00', supplierFob: '4.00', deliveryType: ''}, ...values,
}});
const existingRow = (values = {}) => ({
  id: 7, plmId: '100', modelKod: 'DEMO POLO', season: '6W26', inStoreMonth: '202702', colourCode: 'RED',
  quantity: '900', opd: '2026-08-01', exFactory: '2026-12-01', country: 'CHINA', mag: 'OLD MAG', buyer: '',
  delType: 'Uçak', targetPrice: '3.50', fob: '4.62', confirmedManufacturer: 'OLD FACTORY',
  pricing: {'OLD FACTORY': '3.90', 'OTHER QUOTE': '4.20'}, pricingSent: {'OTHER QUOTE': true},
  trPrice: '180', trLandedMult: '1.05', trFx: '41', ydLandedMult: '1.11', endeksmatikData: {previousUsdPrice: '4'},
  imgRef: 'demo.png', durum: 'Fiyatlama', not: 'Manual note', ...values,
});
test('same PLM + colour + MB month aggregates orders into one new row with Supp. FOB as the confirmed price', () => {
  const a = draft('A'), b = draft('B', {quantity: '250', opd: '2026-09-01', exFactory: '2027-01-15', not: 'Second order'});
  const before = JSON.stringify([a, b]);
  const plan = backfill.plan([a, b], []);
  assert.equal(plan.changes.length, 1);
  const {row, price} = plan.changes[0];
  assert.equal(row.quantity, '350');
  assert.equal(row.opd, '2026-09-01');
  assert.equal(row.exFactory, '2027-01-15');
  assert.equal(row.confirmedManufacturer, 'SUB FACTORY');
  assert.deepEqual(row.pricing, {'SUB FACTORY': '4.00'});
  assert.equal(price.requiresApproval, false);
  assert.equal(row._sourceOrders.length, 2);
  assert.match(row.not, /Second order/);
  assert.equal(JSON.stringify([a, b]), before);
  const normalized = groups.normalizeRows([{...row, id: 1}]).rows;
  assert.equal(normalized[0].modelGroupRole, 'single');
});
test('different colours, PLM IDs or MB months stay separate rows', () => {
  const result = backfill.plan([draft('A'), draft('B', {colourCode: 'BLUE'}), draft('C', {plmId: '200'}), draft('D', {inStoreMonth: '202703'})], []);
  assert.equal(result.changes.length, 4);
  assert.ok(result.changes.every(change => change.existingId == null));
});
test('existing record is updated in place, not duplicated, and keeps pricing history inputs', () => {
  const existing = existingRow();
  const snapshot = JSON.stringify(existing);
  const plan = backfill.plan([draft('A', {delType: 'Gemi'})], [existing]);
  assert.equal(plan.changes.length, 1);
  const change = plan.changes[0];
  assert.equal(change.existingId, 7);
  assert.equal(change.patch.quantity, '100');
  assert.equal(change.patch.country, 'TURKEY');
  assert.equal(change.patch.mag, 'MAG-1');
  assert.equal(change.patch.buyer, 'Demo Buyer');
  assert.equal(change.patch.opd, '2026-10-03');
  assert.equal(change.patch.not, 'Manual note');
  // Teslim tipi siparişte boşsa eşleyicinin varsayılanı mevcut değeri ezmez.
  assert.equal('delType' in change.patch, false);
  for (const key of ['pricing', 'pricingSent', 'confirmedManufacturer', 'targetPrice', 'trPrice', 'trLandedMult', 'trFx', 'ydLandedMult', 'endeksmatikData', 'imgRef', 'durum', 'fob', 'id']) {
    assert.equal(key in change.patch, false, key + ' must never be overwritten by source data');
  }
  assert.equal(JSON.stringify(existing), snapshot, 'planning never mutates Collection');
});
test('different confirmed manufacturer or Supp. FOB requires explicit approval', () => {
  const plan = backfill.plan([draft('A')], [existingRow()]);
  const {price} = plan.changes[0];
  assert.equal(price.requiresApproval, true);
  assert.deepEqual([price.current.name, price.current.price], ['OLD FACTORY', 3.9]);
  assert.deepEqual([price.proposed.name, price.proposed.price], ['SUB FACTORY', 4]);
  const same = backfill.plan([draft('A')], [existingRow({confirmedManufacturer: 'SUB FACTORY', pricing: {'SUB FACTORY': '4,00'}})]);
  assert.equal(same.changes[0].price.requiresApproval, false);
});
test('orders with conflicting prices or without Supp. FOB never change the price automatically', () => {
  const conflict = backfill.plan([draft('A'), draft('B', {pricing: {'SUB FACTORY': '4.40'}})], [existingRow()]);
  assert.equal(conflict.changes[0].price.conflict, true);
  assert.equal(conflict.changes[0].price.requiresApproval, false);
  const fresh = backfill.plan([draft('A'), draft('B', {confirmedManufacturer: 'SECOND', pricing: {SECOND: '4.00'}})], []);
  assert.equal(fresh.changes[0].price.conflict, true);
  assert.deepEqual(fresh.changes[0].row.pricing, {});
  assert.equal(fresh.changes[0].row.confirmedManufacturer, '');
  const missing = backfill.plan([draft('A', {pricing: {}})], [existingRow()]);
  assert.equal(missing.changes[0].price.missing, true);
  assert.equal(missing.changes[0].price.requiresApproval, false);
});
test('re-importing the same order replaces its quantity instead of double counting and reports unchanged rows', () => {
  const first = backfill.plan([draft('A')], [existingRow()]).changes[0];
  const merged = {...existingRow(), ...first.patch, _sourceOrders: first.sourceOrders, confirmedManufacturer: 'SUB FACTORY', pricing: {'SUB FACTORY': '4.00'}};
  const again = backfill.plan([draft('A')], [merged]);
  assert.equal(again.changes.length, 0);
  assert.equal(again.unchanged, 1);
  const changedOrder = backfill.plan([draft('A2', {_sourceOrderCode: 'A', quantity: '150'})], [merged]);
  assert.equal(changedOrder.changes[0].patch.quantity, '150');
  const added = backfill.plan([draft('B', {quantity: '50'})], [merged]);
  assert.equal(added.changes[0].patch.quantity, '150');
  assert.equal(added.changes[0].sourceOrders.length, 2);
});
test('blank source values never clear existing Collection values', () => {
  const plan = backfill.plan([draft('A', {mag: '', buyer: '', country: '', fabric: ''})], [existingRow({buyer: 'Kept buyer', fabric: 'Kept fabric'})]);
  const {patch} = plan.changes[0];
  assert.equal('mag' in patch, false);
  assert.equal('buyer' in patch, false);
  assert.equal('country' in patch, false);
  assert.equal('fabric' in patch, false);
});
test('legacy duplicated records: the record with the richest pricing history is updated, others are untouched', () => {
  const rich = existingRow({id: 9});
  const copy = existingRow({id: 3, pricing: {}, confirmedManufacturer: '', _sourceOrders: [{key: 'X', orderCode: 'X'}]});
  const plan = backfill.plan([draft('A')], [copy, rich]);
  assert.equal(plan.changes.length, 1);
  assert.equal(plan.changes[0].existingId, 9);
  assert.equal(plan.changes[0].matches, 2);
});
test('custom month and grouped-value readers are honoured', () => {
  const existing = existingRow({inStoreMonth: 'Şubat 2027', mag: ''});
  const plan = backfill.plan([draft('A')], [existing], [], {
    monthKey: value => (value === 'Şubat 2027' ? '202702' : /^\d{6}$/.test(value) ? value : ''),
    read: (row, key) => (key === 'mag' ? 'PARENT MAG' : row[key]),
  });
  assert.equal(plan.changes[0].existingId, 7);
  assert.deepEqual(plan.changes[0].fieldChanges.find(item => item.key === 'mag'), {key: 'mag', from: 'PARENT MAG', to: 'MAG-1'});
});
test('records without PLM, colour or MB month are not matched and previously imported lines are skipped', () => {
  for (const values of [{inStoreMonth: ''}, {plmId: ''}, {colourCode: ''}]) {
    const plan = backfill.plan([draft('A', values), draft('B', values)], [existingRow()]);
    assert.equal(plan.changes.length, 2);
    assert.ok(plan.changes.every(change => change.existingId == null));
  }
  const legacy = backfill.plan([draft('A', {inStoreMonth: ''})], [], ['A']);
  assert.equal(legacy.changes.length, 0);
  assert.equal(legacy.duplicates, 1);
});
test('duplicate input lines are counted once', () => {
  const result = backfill.plan([draft('A'), draft('B', {opd: '', exFactory: ''}), draft('A')], []);
  assert.equal(result.duplicates, 1);
  assert.equal(result.changes[0].row.quantity, '200');
  assert.equal(result.changes[0].row.opd, '2026-10-03');
  assert.equal(result.changes[0].row.exFactory, '2027-01-01');
});
test('orders already imported into a legacy multi-colour row are not reopened as new rows', () => {
  const legacy = {id: 4, plmId: '100', colourCode: 'RED · BLUE', inStoreMonth: '202702', _sourceOrders: [{key: 'A', orderCode: 'A'}]};
  const plan = backfill.plan([draft('A'), draft('B')], [legacy]);
  assert.equal(plan.duplicates, 1);
  assert.equal(plan.changes.length, 1);
  assert.equal(plan.changes[0].existingId, null);
  assert.equal(plan.changes[0].row._sourceOrders.length, 1);
  assert.equal(plan.changes[0].row._sourceOrders[0].key, 'B');
});
