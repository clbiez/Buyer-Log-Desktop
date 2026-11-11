'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

test('Orders response grants only importance editing using live order authority, including old cached rows', () => {
  const server = read('server/server.js');
  const start = server.indexOf('function ordersAccessRows(');
  assert.ok(start >= 0, 'Orders needs a field-specific access decorator');
  const source = server.slice(start, server.indexOf('\nfunction ', start + 1));
  const context = { pageProjectionEditResolver: user => row => user?.codes.includes(row['Order Code']) === true };
  vm.createContext(context); vm.runInContext(source, context);
  const cached = [1001, 1002].map(code => ({ 'Order Code':code, 'Active/Inactive':'Inactive', _canEdit:false, _canEditImportance:true }));
  const rows = context.ordersAccessRows(cached, { codes:[1001] });
  assert.equal(rows[0]._canEditImportance, true);
  assert.equal(rows[1]._canEditImportance, false, 'stale permission must be recomputed');
  assert.ok(rows.every(row => row._canEdit === false), 'unrelated Orders fields keep their existing contract');
  assert.equal(context.ordersAccessRows(cached, null)[0]._canEditImportance, false);
  assert.equal(cached[1]._canEditImportance, true, 'shared cached projection is not mutated');
  assert.match(server, /orders: startup \? null : \(cpDataAllowed \? ordersAccessRows\(orders, currentUser\)/);
  assert.match(server, /orders: ordersAccessRows\(cachedOrderRows, req.currentUser\)/);
  assert.match(server, /orders: ordersAccessRows\(orders, req.currentUser\)/);
});

function uiHarness(row) {
  const sent = [];
  const state = { cp:{rows:[]}, orders:{rows:[row]}, overrides:{} };
  const context = { state, appLang:'en', document:{ addEventListener(){} },
    window:{ BLOrderImportance:require('../public/order-importance'), SERVER_BACKED:true,
      addEventListener(){}, enqueueOverrideMutation:async (...args) => { sent.push(args); } },
    lineKeyOfRow:r => `${r['Order Code']}|${r['Model Name']}|${r['C.Code']}`,
    lineIdentity:r => ({model:r['Model Name'], ccode:r['C.Code']}),
  };
  vm.createContext(context); vm.runInContext(read('public/order-importance-ui.js'), context);
  return { ui:context.window.BLOrderImportanceUI, sent, state };
}

test('closed order absent from CP can pick and persist a tag with its exact line identity', async () => {
  const row = { _id:7, 'Order Code':1001, 'Model Name':'DEMO', 'C.Code':'BLUE', 'Active/Inactive':'Inactive', _canEdit:false, _canEditImportance:true };
  const {ui,sent} = uiHarness(row);
  assert.match(ui.cellHtml(row, false, 'orders'), /impTrigger/);
  assert.equal(ui.pasteAssign(row, 'bts'), true);
  await Promise.resolve();
  assert.equal(row.Importance, 'BTS');
  assert.equal(sent.length, 1);
  assert.equal(sent[0][1], '/api/overrides/1001');
  assert.deepEqual(JSON.parse(sent[0][2].body), {model:'DEMO', ccode:'BLUE', importance:'bts'});
});

test('view-only orders stay locked; CP editing keeps working', () => {
  for (const permission of [false, undefined]) {
    const row = { _id:8, 'Order Code':1002, _canEdit:false, _canEditImportance:permission };
    const {ui,sent} = uiHarness(row);
    assert.doesNotMatch(ui.cellHtml(row, false, 'orders'), /impTrigger/);
    assert.equal(ui.pasteAssign(row, 'bts'), false);
    assert.equal(sent.length, 0);
  }
  const row = { _id:9, 'Order Code':1003, _canEdit:true };
  const {ui} = uiHarness(row);
  assert.match(ui.cellHtml(row, true, 'cp'), /impTrigger/);
  assert.equal(ui.pasteAssign(row, 'bayram'), true);
});

test('compressed Orders hydration handles mixed permissions and fails closed on network errors', async () => {
  const app = read('public/app-main.js');
  const source = app.slice(app.indexOf('async function applyOrdersImportanceEditAccess('), app.indexOf('async function ensureOrdersLoaded('));
  let calls = 0;
  const context = { console:{warn(){}}, fetch:async (_url, request) => {
    calls++;
    assert.deepEqual(JSON.parse(request.body).codes, ['1001','1002']);
    return {ok:true, json:async () => ({allowed:['1001']})};
  } };
  vm.createContext(context); vm.runInContext(source, context);
  const rows = [{ 'Order Code':1001, _canEdit:false, _canEditImportance:false }, { 'Order Code':1002, _canEdit:false }];
  await context.applyOrdersImportanceEditAccess(rows);
  assert.equal(rows[0]._canEditImportance, true);
  assert.equal(rows[1]._canEditImportance, false);
  await context.applyOrdersImportanceEditAccess(rows);
  assert.equal(calls, 1, 'decorated responses do not request permissions again');
  context.fetch = async () => { throw Error('offline'); };
  const stale = [{ 'Order Code':1001, _canEdit:false }];
  await context.applyOrdersImportanceEditAccess(stale);
  assert.equal(stale[0]._canEditImportance, undefined, 'missing access remains locked');
  assert.match(app, /reviveServerDates\(rows\);\s*await applyOrdersImportanceEditAccess\(rows\);/);
  const server = read('server/server.js');
  assert.match(server, /app\.post\('\/api\/orders-importance-edit', userAccess\.requireArea\('orders'\)/);
  assert.match(server, /if \(rejectUnauthorizedOrders\(req, res, \[orderCode\]\)\) return;/, 'mutation still checks live authority');
});
