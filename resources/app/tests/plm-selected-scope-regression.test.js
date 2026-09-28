'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const APP = fs.readFileSync(path.join(ROOT, 'public', 'app-main.js'), 'utf8');
const scopeApi = require(path.join(ROOT, 'public', 'model-asset-scope.js'));

test('PLM selected scope reads Collection, CP and Orders selections with type-safe row identity', () => {
  const rowsStart = APP.indexOf('function plmToolRows');
  const rowsEnd = APP.indexOf('window.BLGetPlmToolRows', rowsStart);
  const block = APP.slice(rowsStart, rowsEnd);
  assert.ok(rowsStart >= 0 && rowsEnd > rowsStart, 'plmToolRows bulunamadı');
  assert.match(block, /source==='orders'[\s\S]*state\.ordersSelected/);
  assert.match(block, /source==='koleksiyon'[\s\S]*kolSelected/);
  assert.match(block, /state\.cpSelected/);
  assert.match(block, /scope==='selected'[\s\S]*selectionHasId\(selected,idOf\(row\)\)/);
  assert.doesNotMatch(block, /selected\.has\(idOf\(row\)\)/);
});

test('checkbox selection keeps the source row id instead of coercing every id to Number', () => {
  const frameworkStart = APP.indexOf('// Satır checkbox\'ları: her birine ayrı listener');
  const frameworkEnd = APP.indexOf('// v10.11 — CP/Orders özet satırı', frameworkStart);
  const framework = APP.slice(frameworkStart, frameworkEnd);
  assert.ok(frameworkStart >= 0 && frameworkEnd > frameworkStart, 'CP/Orders checkbox delegasyonu bulunamadı');
  assert.match(framework, /selectionActualId\(meta\.rows,meta\.getId,chk\.dataset\.id\)/);
  assert.match(framework, /selectionSetId\(meta\.selSet,id,chk\.checked\)/);
  assert.doesNotMatch(framework, /Number\(chk\.dataset\.id\)/);

  const collectionStart = APP.indexOf("tbody.querySelectorAll('.rowChk').forEach", APP.indexOf('function renderKol'));
  const collection = APP.slice(collectionStart, collectionStart + 700);
  assert.match(collection, /selectionActualId\(logicalRows,row=>row\.id,chk\.dataset\.id\)/);
  assert.match(collection, /selectionSetId\(kolSelected,id,chk\.checked\)/);
  assert.doesNotMatch(collection, /Number\(chk\.dataset\.id\)/);
});


test('selection identity helpers preserve numeric, numeric-string and UUID-like ids end to end', () => {
  const start = APP.indexOf('function selectionIdKey');
  const end = APP.indexOf('// Ortak tablo araması:', start);
  assert.ok(start >= 0 && end > start, 'selection helper block bulunamadı');
  const helpers = new Function(`${APP.slice(start, end)}; return { selectionHasId, selectionActualId, selectionSetId };`)();

  const collectionSelection = new Set([2131745]);
  assert.equal(helpers.selectionHasId(collectionSelection, '2131745'), true, 'Collection numeric/string id eşleşmeli');

  const cpRows = [{ _id: 'cp:MAGIX-YI:Q6K' }, { _id: 'cp:OTHER' }];
  const cpSelection = new Set();
  const cpId = helpers.selectionActualId(cpRows, row => row._id, 'cp:MAGIX-YI:Q6K');
  helpers.selectionSetId(cpSelection, cpId, true);
  assert.equal(cpId, 'cp:MAGIX-YI:Q6K');
  assert.equal(helpers.selectionHasId(cpSelection, cpRows[0]._id), true, 'CP string id Number/NaN dönüşümünde kaybolmamalı');

  const orderRows = [{ _id: 'ORDER-2026-00017' }];
  const orderSelection = new Set([Number.NaN]);
  const orderId = helpers.selectionActualId(orderRows, row => row._id, 'ORDER-2026-00017');
  helpers.selectionSetId(orderSelection, orderId, true);
  assert.equal(helpers.selectionHasId(orderSelection, 'ORDER-2026-00017'), true, 'Orders string id gerçek kaynak kimliğiyle saklanmalı');
  assert.equal(orderSelection.has(Number.NaN), true, 'başka/bayat seçim girdileri yeni seçimi bozmamalı');
});

test('page-root PLM Sync resolves its own provider even when a higher-priority view is active', () => {
  const offTable = scopeApi.registerProvider('test-plm-page', {
    priority: 1,
    isActive: () => true,
    resolve: () => ({
      contextType: 'koleksiyon',
      viewToken: 'collection#1',
      identities: [{ plmId: '100', colourCode: 'A' }, { plmId: '200', colourCode: 'B' }],
      selectedIdentities: [{ plmId: '200', colourCode: 'B' }],
    }),
  });
  const offOverlay = scopeApi.registerProvider('test-plm-overlay', {
    priority: 20,
    isActive: () => true,
    resolve: () => ({
      contextType: 'detail',
      viewToken: 'detail#1',
      identities: [{ plmId: '999', colourCode: 'Z' }],
      selectedIdentities: [],
    }),
  });
  try {
    assert.equal(scopeApi.currentScope().providerId, 'test-plm-overlay');
    const pageScope = scopeApi.scopeForProvider('test-plm-page');
    assert.equal(pageScope.providerId, 'test-plm-page');
    assert.deepEqual(pageScope.selectedIdentities.map(item => item.plmId), ['200']);
  } finally {
    offOverlay();
    offTable();
  }

  const start = APP.indexOf('async function openPlmSyncCategoryPanel');
  const end = APP.indexOf("document.addEventListener('click'", start);
  const block = APP.slice(start, end);
  assert.match(APP, /function plmSyncPageProvider\(page\)\{return page==='kol'\?'koleksiyon':page;\}/);
  assert.match(APP, /scopeForProvider\?\.\(plmSyncPageProvider\(page\)\)/);
  assert.match(block, /scope=plmSyncPageScope\(page\)/);
  assert.match(block, /disabled:!scope\?\.selectedIdentities\?\.length/);
});
