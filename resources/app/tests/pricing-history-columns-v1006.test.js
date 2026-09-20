const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');
const quotations = read('public/quotations.js');
const engine = read('public/pricing-workspace-engine.js');
const app = read('public/app-main.js');
const pricingEngine = require(path.join(ROOT, 'public/pricing-workspace-engine.js'));

test('pricing history exposes the shared Collection column catalog and safe defaults', () => {
  assert.match(app, /window\.BLCollectionColumns\s*=\s*\{/);
  assert.match(quotations, /PRICING_HISTORY_DEFAULT_COLUMNS\s*=\s*\['picture','inStoreMonth'/);
  assert.match(quotations, /PRICING_HISTORY_COLUMNS_KEY/);
});

test('pricing history renders selectable and reorderable Collection columns', () => {
  assert.match(quotations, /data-ph-columns/);
  assert.match(quotations, /data-ph-column-visible/);
  assert.match(quotations, /data-ph-column-up/);
  assert.match(quotations, /data-ph-column-down/);
  assert.match(quotations, /qHistoryColumnDefinitions/);
});

test('In Store Month is a first-class pricing-history filter and column', () => {
  assert.match(quotations, /data-ph-in-store-month/);
  assert.match(quotations, /inStoreMonth/);
  assert.match(quotations, /qHistoryFilters[\s\S]*r\.inStoreMonth/);
});

test('historical best summary includes the manufacturer that supplied it', () => {
  assert.match(engine, /bestManufacturer/);
  assert.match(quotations, /summary\.bestManufacturer/);
  assert.equal(pricingEngine.historySummary([
    { price: '$2,00', manufacturer: 'Supplier B' },
    { price: '$1,50', manufacturer: 'Supplier A' },
  ]).bestManufacturer, 'Supplier A');
});

test('history rows are rendered from selected columns, including a model image cell', () => {
  assert.match(quotations, /qHistoryCellHtml/);
  assert.match(quotations, /qCachedModelThumb/);
  assert.match(quotations, /qHistoryVisibleColumns/);
});
