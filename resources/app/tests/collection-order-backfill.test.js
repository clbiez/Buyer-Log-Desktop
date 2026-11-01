'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const backfill = require('../public/collection-order-backfill');
const groups = require('../public/collection-model-groups');
const draft = (key, values = {}) => ({key, row: {
  plmId: '100', modelKod: 'DEMO POLO', season: '6W26', inStoreMonth: '202702',
  inStore: '2027-02-01', inStoreWeek: '2027-05', quantity: '100', fob: '5.00',
  targetPrice: '4.00', country: 'TURKEY', confirmedManufacturer: 'DEMO FACTORY',
  pricing: {'DEMO FACTORY': '5.00'}, opd: '2026-10-03', exFactory: '2027-01-01',
  colourCode: 'RED', colour: 'Red', _sourceOrderCode: key, ...values,
}});
test('same model and MB month sums quantities, uses earliest OPD and latest ex-factory, retains source details', () => {
  const a = draft('A'), b = draft('B', {quantity: '250', opd: '2026-09-01', exFactory: '2027-01-15', colourCode: 'BLUE', colour: 'Blue', not: 'Second order'});
  const before = JSON.stringify([a,b]);
  const plan = backfill.plan([a,b], []);
  assert.equal(plan.changes.length, 1);
  const row = plan.changes[0].row;
  assert.equal(row.quantity, '350');
  assert.equal(row.opd, '2026-09-01');
  assert.equal(row.exFactory, '2027-01-15');
  assert.equal(row.confirmedManufacturer, 'DEMO FACTORY');
  assert.equal(row.fob, '5.00');
  assert.equal(row._sourceOrders.length, 2);
  assert.match(row.colourCode, /BLUE/);
  assert.match(row.not, /Second order/);
  assert.equal(JSON.stringify([a,b]), before);
});
test('price, supplier price, MB month, model, season, country and supplier differences remain independent', () => {
  const variants = [{}, {fob: '5.01'}, {targetPrice: '4.01'}, {inStoreMonth: '202703'},
    {plmId: '200'}, {season: '7S27'}, {country: 'CHINA'}, {confirmedManufacturer: 'OTHER FACTORY'}];
  const result = backfill.plan(variants.map((v,i) => draft('O'+i,v)), []);
  assert.equal(result.changes.length, variants.length);
  const normalized = groups.normalizeRows(result.changes.map((c,i) => ({...c.row,id:i+1}))).rows;
  assert.ok(normalized.every(row => row.modelGroupRole === 'single'), 'separate commercial rows must never inherit another price');
});
test('numeric price formats and canonical country aliases merge', () => {
  const result = backfill.plan([draft('A'),draft('B',{fob:'5,00',country:'TR'})], []);
  assert.equal(result.changes.length,1);
  assert.equal(result.changes[0].row.quantity,'200');
});
test('repeated imports skip source lines and add only new orders to the existing aggregate', () => {
  const original = {...backfill.plan([draft('A'),draft('B')],[]).changes[0].row,id:9};
  const unchanged = JSON.stringify(original);
  const result = backfill.plan([draft('A'),draft('C',{quantity:'300'})],[original]);
  assert.equal(result.duplicates,1);
  assert.equal(result.changes.length,1);
  assert.equal(result.changes[0].existingId,9);
  assert.equal(result.changes[0].row.quantity,'500');
  assert.equal(result.changes[0].row._sourceOrders.length,3);
  assert.equal(JSON.stringify(original),unchanged);
  assert.equal(backfill.plan([draft('A'),draft('B')],[original]).changes.length,0);
});
test('legacy imports, manual collection rows and edited commercial data are protected', () => {
  const legacy = {...draft('A').row,id:1};
  const manual = {...draft('M').row,id:2}; delete manual._sourceOrderCode;
  const edited = {...backfill.plan([draft('C')],[]).changes[0].row,id:3,fob:'8'};
  const result = backfill.plan([draft('A'),draft('B'),draft('D')],[legacy,manual,edited],['A']);
  assert.equal(result.duplicates,1);
  assert.ok(result.changes.every(change => change.existingId == null));
});
test('unknown MB periods, missing identities and invalid prices never merge unrelated orders', () => {
  for (const values of [{inStoreMonth:''},{plmId:'',modelKod:''},{fob:''},{quantity:''},{quantity:'invalid'}]) {
    assert.equal(backfill.plan([draft('A',values),draft('B',values)],[]).changes.length,2);
  }
});
test('missing dates do not override valid date bounds and duplicate input is counted once', () => {
  const result = backfill.plan([draft('A'),draft('B',{opd:'',exFactory:''}),draft('A')],[]);
  assert.equal(result.duplicates,1);
  assert.equal(result.changes[0].row.quantity,'200');
  assert.equal(result.changes[0].row.opd,'2026-10-03');
  assert.equal(result.changes[0].row.exFactory,'2027-01-01');
});
test('recalculated Collection FOB does not split a source-price group, while edited approved quotes are protected', () => {
  const original = {...backfill.plan([draft('A',{_sourceOrderDetails:{sourceFob:'5.00'}})],[]).changes[0].row,id:9};
  original.fob='6.25';
  const extended=backfill.plan([draft('B',{_sourceOrderDetails:{sourceFob:'5.00'}})],[original]);
  assert.equal(extended.changes[0].existingId,9);
  assert.equal(extended.changes[0].row.quantity,'200');
  assert.equal(extended.changes[0].row.fob,'6.25');
  original.pricing['DEMO FACTORY']='7';
  const protectedPlan=backfill.plan([draft('B',{_sourceOrderDetails:{sourceFob:'5.00'}})],[original]);
  assert.equal(protectedPlan.changes[0].existingId,null);
});
