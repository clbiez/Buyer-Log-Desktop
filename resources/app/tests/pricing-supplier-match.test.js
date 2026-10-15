'use strict';
/* Fiyata gönderme önerisi: klasman bazında ortalamanın altında fiyat veren
   (yeterli örneği olan) üreticiler, aynı klasmandaki koleksiyon modelleriyle
   eşlenir. Motor Fiyat & Üretici Analizi ekranıyla aynıdır. */
const test = require('node:test'), assert = require('node:assert/strict');
const fields = require('../server/lib/canonical-fields');
const { suggestSuppliers } = require('../server/lib/pricing-supplier-match');

const key = (module, field) => fields.bindingFor(module, field).keys[0];
const order = (i, manufacturer, category, fob) => ({ _id: 'o' + i, [key('orders', 'plmId')]: String(700000 + i), [key('orders', 'orderCode')]: String(4200000 + i), [key('orders', 'manufacturer')]: manufacturer,
  [key('orders', 'category')]: category, [key('orders', 'fob')]: fob, [key('orders', 'country')]: 'Bangladesh', [key('orders', 'season')]: '6S26', [key('orders', 'orderQuantity')]: 1000 });
const option = (id, plmId, category) => ({ id, [key('collection', 'plmId')]: plmId, [key('collection', 'modelName')]: 'DEMO ' + plmId, [key('collection', 'colourCode')]: 'C1', [key('collection', 'category')]: category });

test('models go to suppliers pricing below their classification average, cheapest first, with reasons for the rest', () => {
  let i = 0;
  const priceRows = [
    // KAZAK: average 10; DEMO A 8 (-20%), DEMO B 9 (-10%), DEMO C 13 (+30%)
    order(i++, 'DEMO A', 'KAZAK', 8), order(i++, 'DEMO A', 'KAZAK', 8), order(i++, 'DEMO B', 'KAZAK', 9), order(i++, 'DEMO B', 'KAZAK', 9), order(i++, 'DEMO C', 'KAZAK', 13), order(i++, 'DEMO C', 'KAZAK', 13),
    // HIRKA: only one supplier, so not comparable
    order(i++, 'DEMO A', 'HIRKA', 12), order(i++, 'DEMO A', 'HIRKA', 12),
  ];
  const collectionRows = [option('r1', '900001', 'KAZAK'), option('r2', '900002', 'Kazak'), option('r3', '900003', 'HIRKA'), option('r4', '900004', 'ELBISE'), option('r5', '900005', '')];
  const out = suggestSuppliers({ collectionRows, priceRows, fields });
  assert.equal(out.currentSeason, '6S26');
  assert.deepEqual(out.suppliers.map(s => [s.name, s.modelCount]), [['DEMO A', 2], ['DEMO B', 2]], 'DEMO C prices above the average and is not suggested');
  assert.deepEqual(out.suppliers[0].classifications, [{ name: 'KAZAK', index: -20, price: 8, groupPrice: 10, pricedModels: 2 }]);
  assert.deepEqual(out.suppliers[0].models.map(m => [m.rowId, m.plmId, m.classification]), [['r1', '900001', 'KAZAK'], ['r2', '900002', 'Kazak']], 'classification matches case-insensitively');
  assert.equal(out.assignedModels, 2);
  assert.deepEqual(Object.fromEntries(Object.entries(out.unmatched).map(([k, v]) => [k, v.models.map(m => m.rowId)])),
    { 'no-classification': ['r5'], 'no-price-data': ['r4'], 'not-comparable': ['r3'], 'none-below-threshold': [] });
  const strict = suggestSuppliers({ collectionRows, priceRows, fields, maxIndex: -15, perGroup: 1 });
  assert.deepEqual(strict.suppliers.map(s => s.name), ['DEMO A'], 'a stricter threshold and one supplier per classification');
});

test('review follow-ups: many classifications and long names stay within the tool schema; the season falls back to one that matches', async () => {
  const { createToolRegistry } = require('../server/lib/agent-tool-registry'), { registerPriceAnalysisTools } = require('../server/lib/agent-price-analysis-tools');
  const long = 'DEMO ' + 'X'.repeat(400);
  let i = 0;
  const priceRows = [], collectionRows = [];
  for (let c = 0; c < 32; c++) {
    const cat = 'CLASS ' + c;
    priceRows.push(order(i++, long, cat, 5), order(i++, long, cat, 5), order(i++, 'DEMO OTHER', cat, 9), order(i++, 'DEMO OTHER', cat, 9));
    collectionRows.push(option('c' + c, String(950000 + c), cat));
  }
  // one unrelated, newer season order must not empty the result
  priceRows.push({ ...order(i++, 'DEMO NEW', 'UNRELATED', 7), [key('orders', 'season')]: '6W27' });
  const profile = { id: 'demo', enabled: true }, registry = createToolRegistry({ userAccess: { profileById: () => profile, hasArea: () => true, appendAudit: () => {} } });
  registerPriceAnalysisTools(registry, { rows: async () => ({ rows: priceRows }), collectionRows: async () => collectionRows });
  const result = await registry.execute('pricing.suppliers.suggest', {}, { ownerId: profile.id, profile });
  require('../server/lib/agent-tool-schema').validate(registry.get('pricing.suppliers.suggest').outputSchema, result);
  const top = result.data.suppliers[0];
  assert.equal(result.data.currentSeason, '6S26', 'the newest season (6W27) has no match, so the newest matching season is used');
  assert.deepEqual(result.data.seasons, ['6S26', '6W27']);
  assert.equal(top.name.length, 300);assert.equal(top.classifications.length, 30);assert.equal(top.classificationsTruncated, true);
  assert.equal(top.modelCount, 32);assert.equal(top.classifications[0].pricedModels, 2);
  const pinned = await registry.execute('pricing.suppliers.suggest', { currentSeason: '6W27' }, { ownerId: profile.id, profile });
  assert.equal(pinned.data.currentSeason, '6W27');assert.equal(pinned.data.suppliers.length, 0, 'an explicit season is respected');
});
