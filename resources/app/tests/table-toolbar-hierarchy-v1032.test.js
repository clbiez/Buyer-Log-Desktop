'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const APP = read('public/app-main.js');
const CSS = require('./helpers/manifest-css')();
const INDEX = read('public/index.html');

function sliceBetween(source, start, end) {
  return source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));
}

test('v10.32 Orders ve Collection veri bağlamını araçlardan önce gösterir', () => {
  const orders = sliceBetween(INDEX, 'id="view-orders"', 'id="view-koleksiyon"');
  const collection = sliceBetween(INDEX, 'id="view-koleksiyon"', 'id="view-lfl"');
  assert.ok(orders.indexOf('class="workspaceContextBar"') < orders.indexOf('id="ordersTableToolbar"'));
  assert.ok(collection.indexOf('class="workspaceContextBar"') < collection.indexOf('id="kolTableToolbar"'));
  assert.match(orders, /id="ordersWorkspaceMeta"/);
  assert.match(collection, /id="kolWorkspaceMeta"/);
});

test('v10.32 Orders birincil yenileme eylemi gerçek Orders yenilemesini çalıştırır', () => {
  const orders = sliceBetween(INDEX, 'id="ordersTableToolbar"', 'id="ordersTableWrap"');
  assert.match(orders, /id="ordersRefreshBtn"[^>]*class="tbtn primary"[^>]*data-action-role="primary"/);
  assert.match(APP, /document\.getElementById\('ordersRefreshBtn'\)\?\.addEventListener\('click'/);
  // v20260930 — Orders düğmesi yalnız Orders'ı ister; bağlı grup (tek sorgu) birlikte gelir, CP gelmez.
  const click = APP.slice(APP.indexOf("document.getElementById('ordersRefreshBtn')?.addEventListener('click'"), APP.indexOf("document.getElementById('ordersRefreshBtn')?.addEventListener('click'") + 220);
  assert.match(click, /loadFromServer\(true,\['orders'\]\)/);
});

test('v10.32 Collection birincil eylemi önde, seçili kapsamı açık ve silme eylemi ayrıdır', () => {
  const actions = sliceBetween(INDEX, 'id="kolTableActions"', 'id="kolIoWrap"');
  assert.ok(actions.indexOf('id="kolAddRowBtn"') < actions.indexOf('id="kolUndoBtn"'));
  assert.match(actions, /id="kolAddRowBtn"[^>]*class="tbtn primary"[^>]*data-action-role="primary"[^>]*data-tb-compact="icon"/);
  assert.doesNotMatch(actions, /kolSelectedGroupLabel/);
  assert.match(actions, /id="kolDelRowBtn"[^>]*class="tbtn actionDanger"[^>]*data-action-role="danger"/);
});

test('v10.32 çalışma alanı meta bilgisi her çizimde gerçek satır kapsamından güncellenir', () => {
  assert.match(APP, /ordersWorkspaceMeta/);
  assert.match(APP, /kolWorkspaceMeta/);
  assert.match(APP, /const totalRowCount=partialViewEnabled\('orders'\)\?partialViewRows\('orders',state\.orders\.rows\)\.length:state\.orders\.rows\.length;/);
  assert.match(APP, /rows\.length.*totalRowCount/);
  assert.match(APP, /logicalRows\.length.*kolRows\.length/);
});

test('v10.32 ortak eylem rolleri token tabanlı, odak görünür ve küçük ekranda erişilebilirdir', () => {
  assert.match(CSS, /\.workspaceContextBar\{/);
  assert.match(CSS,/\.toolbar\.tableActionToolbar button\.tbtn\[data-action-role="primary"\],[^{]*\{[^}]*background:var\(--ui-accent\)/);
  assert.match(CSS,/\.toolbar\.tableActionToolbar button\.tbtn\[data-action-role="danger"\],[^{]*\{[^}]*color:var\(--ui-danger\)/);
  require('./helpers/manifest-css').assertFocus();
  assert.match(CSS, /@media\(max-width:900px\)[^{]*\{[^}]*\.workspaceContextBar/s);
  assert.doesNotMatch(CSS.match(/\/\* v10\.32[\s\S]*?(?=\/\* =====================|$)/)?.[0]||'', /#[0-9a-f]{3,8}/i);
});
