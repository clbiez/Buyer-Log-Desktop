'use strict';
// Regression: Product Main Definition must use the same confirmed PLM -> ASAS
// learning pathway as Category and License (Excel, direct fetch and drag).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const APP = fs.readFileSync(path.join(__dirname, '..', 'public', 'app-main.js'), 'utf8');
const DRAG = fs.readFileSync(path.join(__dirname, '..', 'public', 'collection-plm-drag-import.js'), 'utf8');

function block(start, end) {
  const a = APP.indexOf(start), b = APP.indexOf(end, a + start.length);
  assert.ok(a >= 0 && b > a, 'Missing client block: ' + start);
  return APP.slice(a, b);
}
const norm = value => String(value == null ? '' : value).trim();
const turknorm = value => norm(value).toUpperCase().replace(/[İI]/g, 'I')
  .replace(/Ş/g, 'S').replace(/Ç/g, 'C').replace(/Ö/g, 'O')
  .replace(/Ü/g, 'U').replace(/Ğ/g, 'G').replace(/\s+/g, ' ').trim();

test('both PLM adapters route Product Main Definition through confirmed translations', () => {
  const excel = block('function kolPlmParseWorkbook', 'function kolPlmImportTouchedKeys');
  assert.match(block('function kolPlmNormalizeDirectRecord', 'async function kolPlmNormalizeAndTranslate'), /window\.BLCollectionModelGroups\.kolPlmNormalizeDirectRecord\(record,/);
  const shared = fs.readFileSync(path.join(__dirname, '..', 'public', 'collection-model-groups.js'), 'utf8');
  const direct = shared.slice(shared.indexOf('function kolPlmNormalizeDirectRecord'), shared.indexOf('function kolBuildPlmImportPlan'));
  for (const adapter of [excel, direct]) {
    assert.match(adapter, /productMainDefinition:kolPlmTranslate\('productMainDefinition',source\.productMainDefinition\)/);
    assert.match(adapter, /productMainDefinition:norm\(/);
  }
  const workflow = block('async function kolPlmNormalizeAndTranslate', 'function kolBuildPlmImportPlan');
  assert.match(workflow, /kolPlmTranslationQuestions\(rows/);
  assert.match(workflow, /showKolPlmTranslationReview\(questions\)/);
  assert.match(workflow, /kolPlmApplyReviewedMappings\(rows/);
  assert.match(DRAG, /kolPlmNormalizeAndTranslate\(records\)/);
});

test('ASAS Product Main Definition catalog and prior user choices appear in review', () => {
  const meta = block('const KOL_PLM_TRANSLATION_FIELD_META', 'function kolPlmConfidenceLabel');
  const catalog = { productMainDefinition: ['T-Shirt', 'Tank Top', 'Sweatshirt'] };
  const remembered = (field, source) => field === 'productMainDefinition' && source === 'TANK TOP'
    ? { keepAsIs: false, target: 'Tank Top' } : null;
  const ask = new Function('norm', 'turknorm', 'kolUniqueCatalogValues', 'kolCatalogValues',
    'kolPlmIsDirectField', 'kolPlmRememberedChoice',
    meta + '\nreturn kolPlmTranslationQuestions;')(
    norm, turknorm, values => [...new Set(values)], field => catalog[field] || [],
    field => field === 'line', remembered);
  const make = mode => ({ _plmSource: { productMainDefinition: 'TANK TOP' },
    _plmTranslations: { productMainDefinition: { source: 'TANK TOP', target: '', mode } } });
  const question = ask([make('approved-rule')])[0];
  assert.equal(question.field, 'productMainDefinition');
  assert.equal(question.label, 'Product Main Definition');
  assert.equal(question.catalog.length, 3);
  assert.equal(question.remembered.target, 'Tank Top');
  assert.equal(question.candidates[0].target, 'Tank Top');
  assert.equal(ask([make('approved-rule')], { includeRemembered: false }).length, 0);
});

test('real ASAS productDescription takes precedence over previously approved PMD rule', () => {
  const source = block('function kolPlmApplyAsasTranslations', 'function kolPlmResolveZipPath');
  const fromOrders = orders => [...new Set((orders || []).map(order => norm(order.productDescription)).filter(Boolean))];
  const translate = new Function('kolPlmAsasIndex', 'kolPlmAsasModelIndex',
    'kolPlmInferTranslationSuggestions', 'kolPlmIsDirectField', 'kolPlmUniqueAsasValues',
    'kolPlmTranslate', 'kolPlmNormalizeId', 'turknorm', 'norm',
    source + '\nreturn kolPlmApplyAsasTranslations;')(
    () => new Map([['200', [{ productDescription: 'Tank Top' }]],
      ['202', [{ productDescription: 'Tank Top' }, { productDescription: 'Sweatshirt' }]]]),
    () => new Map(),
    () => ({ suggestions: [] }),
    field => field === 'line',
    (orders, prop) => prop === 'productDescription' ? fromOrders(orders) : [],
    (field, input) => field === 'productMainDefinition' && input === 'TANK TOP' ? 'Sweatshirt' : '',
    norm, turknorm, norm);
  const row = plmId => ({ plmId, modelKod: 'MODEL-1', productMainDefinition: '',
    _plmSource: { productMainDefinition: 'TANK TOP' } });
  const exact = row('200'), approved = row('201'), conflicting = row('202');
  // A prior mapping may have prefilled a value before exact ASAS evidence is read.
  conflicting.productMainDefinition = 'Sweatshirt';
  translate([exact, approved, conflicting], { suggestions: [] });
  assert.equal(exact.productMainDefinition, 'Tank Top');
  assert.equal(exact._plmTranslations.productMainDefinition.mode, 'exact-plm');
  assert.equal(approved.productMainDefinition, 'Sweatshirt');
  assert.equal(approved._plmTranslations.productMainDefinition.mode, 'approved-rule');
  assert.equal(conflicting.productMainDefinition, '', 'ASAS conflicts must not leak prefilled rules');
  assert.equal(conflicting._plmTranslations.productMainDefinition.mode, 'conflict');
  assert.match(APP, /productMainDefinition:'productMainDefinition'/);
});

test('shared translation store preserves legacy fields and remembers PMD choices', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bl-pmd-translation-'));
  const previous = process.env.BUYER_LOG_SERVER_DATA_ROOT;
  process.env.BUYER_LOG_SERVER_DATA_ROOT = root;
  const storeModule = require.resolve('../server/lib/plm-translations');
  const userDataModule = require.resolve('../server/user-data');
  delete require.cache[storeModule];
  delete require.cache[userDataModule];
  try {
    const store = require('../server/lib/plm-translations');
    let result = store.upsertPlmTranslations([
      { field: 'category', source: 'C2', target: 'KEY ORME' },
      { field: 'productMainDefinition', source: 'TANK TOP', target: 'Tank Top' },
    ], { id: 'tester' });
    assert.equal(result.updated, 2);
    assert.equal(result.rules.productMainDefinition[0].target, 'Tank Top');
    result = store.upsertPlmTranslations([
      { field: 'PRODUCTMAINDEFINITION', source: 'TANK TOP', keepAsIs: true },
    ], { id: 'tester' }, result.revision);
    assert.equal(result.updated, 1);
    const reloaded = store.publicRules(store.loadPlmTranslations());
    assert.equal(reloaded.rules.category[0].target, 'KEY ORME');
    assert.equal(reloaded.rules.productMainDefinition[0].keepAsIs, true);
    assert.equal(reloaded.rules.productMainDefinition[0].target, 'TANK TOP');
  } finally {
    delete require.cache[storeModule];
    delete require.cache[userDataModule];
    if (previous === undefined) delete process.env.BUYER_LOG_SERVER_DATA_ROOT;
    else process.env.BUYER_LOG_SERVER_DATA_ROOT = previous;
    fs.rmSync(root, { recursive: true, force: true });
  }
});
