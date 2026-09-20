'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const APP = fs.readFileSync(path.join(root, 'public', 'app-main.js'), 'utf8');
const connector = require('../server/lib/agent-browser-connector');

test('model image updates use the complete filtered rows for CP, Orders and Collection', () => {
  const start = APP.indexOf('function plmToolRows');
  const end = APP.indexOf('function applySyncedPlmImages', start);
  const block = APP.slice(start, end);
  assert.match(block, /function plmToolRows\(source,scope='filtered'\)/);
  assert.match(block, /source==='orders'[\s\S]*filteredOrders\(\)/);
  assert.match(block, /source==='koleksiyon'[\s\S]*filteredKol\(\)/);
  assert.match(block, /filteredCP\(\)/);
  assert.doesNotMatch(block, /slice\(0,\s*250\)/);
});

test('selected update mode sends only visible selected table rows and refreshes them', () => {
  const rowsStart = APP.indexOf('function plmToolRows');
  const rowsEnd = APP.indexOf('function applySyncedPlmImages', rowsStart);
  const rowsBlock = APP.slice(rowsStart, rowsEnd);
  const chooserStart = APP.indexOf('function openModelImageSourceChooser');
  const chooserBlock = APP.slice(chooserStart, chooserStart + 4000);
  assert.match(rowsBlock, /scope==='selected'/);
  assert.match(rowsBlock, /state\.ordersSelected/);
  assert.match(rowsBlock, /state\.cpSelected/);
  assert.match(rowsBlock, /kolSelected/);
  assert.match(chooserBlock, /data-image-mode="selected"/);
  assert.match(chooserBlock, /Refresh Selected/);
  assert.match(chooserBlock, /Seçilenleri Yenile/);
  // Seçim boşken düğme KAPALI açılır; sessizce "tümü"ne düşmez.
  assert.match(chooserBlock, /data-image-mode="selected"\$\{selected\?'':' disabled'\}/);
  // v11.10 — "seçilenler" kapsamı artık kapsam çözümleyicisinden gelir ve
  // istek modu yalnız missing/all olur; seçim, kimlik KÜMESİNİ daraltır.
  assert.match(APP, /mode==='missing'\?'missing':'all'/);
  const SCOPE = fs.readFileSync(path.join(root, 'public', 'model-asset-scope.js'), 'utf8');
  assert.match(SCOPE, /mode === 'selected' \? scope\.selectedIdentities : scope\.identities/);
});

test('CoreNectum pagination removes persisted UI filters without mutating the captured request', () => {
  const body = { pageIndex:0, pageSize:250, filters:[{field:'Season',value:'S7'}], securityScope:{id:4} };
  const replay = connector.coreNectumUnfilteredRequestBody(body);
  assert.deepEqual(replay.filters, []);
  assert.deepEqual(replay.securityScope, {id:4});
  assert.equal(body.filters.length, 1);
});
