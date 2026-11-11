'use strict';
// Kapalı (pasif) sipariş CP'de yoktur; önem etiketi Orders'tan düzenlenebilmeli.
// Orders satırları genel olarak salt okunur kalır; yalnız önem etiketi için
// canlı sipariş yetkisi + paylaşılan sahiplikten türetilen ayrı izin açılır.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

test('worker access respects edit scope and shared ownership, including closed orders and malformed codes', () => {
  const access = require('../server/lib/compute-access');
  const authority = { 1001:[{buyer:'Alice'}], 1002:[{buyer:'Bob'}], 1003:[{buyer:'Alice'},{buyer:'Bob'}] };
  const profiles = [{id:'alice',username:'Alice'},{id:'bob',username:'Bob'}];
  const alice = access.createAccessContext({userId:'alice',systemRole:'buyer',manageAll:false,viewScope:{all:true},editScopes:{buyers:['Alice']},authority,profiles});
  assert.deepEqual(access.importanceEditAllowedCodes(alice, [1001,'1001',1002,1003,404,'x|y',null,{}]), ['1001']);
  const manager = access.createAccessContext({userId:'manager',systemRole:'manager',manageAll:true,viewScope:{all:true},editScopes:{all:true},authority,profiles});
  assert.ok(!access.importanceEditAllowedCodes(manager, [1001]).includes('1001'), 'manageAll cannot bypass the shared owner');
  const moderator = access.createAccessContext({userId:'moderator',systemRole:'moderator',manageAll:true,authority:{},profiles:[]});
  assert.deepEqual(access.importanceEditAllowedCodes(moderator, [1001,1002]), ['1001','1002']);
});

test('worker task returns the allowed subset for the importance field and keeps the CP contract', async () => {
  const worker = read('server/workers/compute-worker.js');
  assert.match(worker, /data\.params\.field==='importance'[\s\S]*importanceEditAllowedCodes[\s\S]*sharedEditDeniedCodes/);
  const server = read('server/server.js');
  assert.match(server, /if\(task==='cp-shared-edit-codes'\)return \{codes:parts\.codes,field:parts\.field,access:/);
});

test('Orders HTTP access uses the guarded compute pool under the orders area', async () => {
  const source = read('server/server.js'), start = source.indexOf("app.post('/api/orders-importance-edit'"), end = source.indexOf('\n});', start) + 4;
  assert.ok(start > 0);
  let handler, task, sent, areaGate;
  const context = { app:{post:(_path,...args)=>{handler=args.at(-1);}}, userAccess:{requireArea:area=>{areaGate=area;return null;}}, express:{json:()=>null}, CP_SHARED_EDIT_MAX_CODES:3,
    computeReads:{run:async(_req,area,name,parts,options)=>{task={area,name,parts,options};return {value:{}};}}, sendComputedResponse:(_req,_res,lease)=>{sent=lease;}, apiError:(_res,error)=>{throw error;} };
  vm.runInNewContext(source.slice(start,end), context);
  assert.equal(areaGate, 'orders');
  await handler({body:{codes:['1001','1002']}}, {});
  assert.equal(task.area,'orders'); assert.equal(task.name,'cp-shared-edit-codes'); assert.equal(task.parts.field,'importance'); assert.equal(task.options.cache,false); assert.ok(sent);
  let status; await handler({body:{codes:[1,2,3,4]}}, {status:code=>{status=code;return {json:()=>null};}});
  assert.equal(status, 413);
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
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(sent.length, 1);
  assert.equal(sent[0][1], '/api/overrides/1001');
  assert.deepEqual(JSON.parse(sent[0][2].body), {model:'DEMO', ccode:'BLUE', importance:'bts'});
});

test('view-only and shared-owner-denied orders stay locked; CP editing keeps working', () => {
  for (const permission of [false, undefined]) {
    const row = { _id:8, 'Order Code':1002, _canEdit:false, _canEditImportance:permission };
    const {ui,sent} = uiHarness(row);
    assert.doesNotMatch(ui.cellHtml(row, false, 'orders'), /impTrigger/);
    assert.equal(ui.pasteAssign(row, 'bts'), false);
    assert.equal(sent.length, 0);
  }
  const owned = { _id:9, 'Order Code':1003, _canEdit:false, _canEditImportance:true, _canEditShared:false };
  const denied = uiHarness(owned);
  assert.doesNotMatch(denied.ui.cellHtml(owned, false, 'orders'), /impTrigger/);
  assert.equal(denied.ui.pasteAssign(owned, 'bts'), false);
  const cpRow = { _id:10, 'Order Code':1004, _canEdit:true };
  const {ui} = uiHarness(cpRow);
  assert.match(ui.cellHtml(cpRow, true, 'cp'), /impTrigger/);
  assert.equal(ui.pasteAssign(cpRow, 'bayram'), true);
});

function hydrationSource() {
  const app = read('public/app-main.js');
  return app.slice(app.indexOf('async function applyOrdersImportanceEditAccess('), app.indexOf('async function ensureOrdersLoaded('));
}

test('Orders hydration grants mixed permissions once, without blocking the table, and fails closed', async () => {
  let calls = 0, repaints = 0;
  const rows = [{ 'Order Code':1001, _canEdit:false }, { 'Order Code':1002, _canEdit:false }];
  const context = { state:{orders:{rows}}, window:{BLOrderImportanceUI:{refreshAccess:()=>{repaints++;}}}, console:{warn(){}}, fetch:async (_url, request) => {
    calls++;
    assert.deepEqual(JSON.parse(request.body).codes, ['1001','1002']);
    return {ok:true, json:async () => ({allowed:['1001']})};
  } };
  vm.createContext(context); vm.runInContext(hydrationSource(), context);
  await context.applyOrdersImportanceEditAccess(rows);
  assert.equal(rows[0]._canEditImportance, true);
  assert.equal(rows[1]._canEditImportance, false);
  assert.equal(repaints, 1);
  await context.applyOrdersImportanceEditAccess(rows);
  assert.equal(calls, 1, 'hydrated rows do not request permissions again');
  const stale = [{ 'Order Code':1001, _canEdit:false }];
  context.state.orders = {rows:stale};
  context.fetch = async () => { throw Error('offline'); };
  await context.applyOrdersImportanceEditAccess(stale);
  assert.equal(stale[0]._canEditImportance, undefined, 'network failure keeps importance locked');
  context.fetch = async () => ({ok:false});
  await context.applyOrdersImportanceEditAccess(stale);
  assert.equal(stale[0]._canEditImportance, undefined, 'HTTP failure keeps importance locked');
  const app = read('public/app-main.js');
  assert.equal((app.match(/void applyOrdersImportanceEditAccess\(state\.orders\.rows\);/g) || []).length, 2, 'both Orders hydration paths request field access');
  assert.doesNotMatch(app, /await applyOrdersImportanceEditAccess/, 'field access must not delay the usable table');
});

test('late access responses cannot repaint a newer Orders table', async () => {
  const rows = [{'Order Code':1001, _canEdit:false}], nextRows = [{'Order Code':1002, _canEdit:false}];
  let respond, repaints = 0;
  const context = {state:{orders:{rows}}, window:{BLOrderImportanceUI:{refreshAccess:()=>{repaints++;}}}, console:{warn(){}}, fetch:()=>new Promise(resolve=>{respond=resolve;})};
  vm.createContext(context); vm.runInContext(hydrationSource(), context);
  const pending = context.applyOrdersImportanceEditAccess(rows);
  context.state.orders = {rows:nextRows};
  respond({ok:true, json:async()=>({allowed:['1001']})});
  await pending;
  assert.equal(repaints, 0);
  assert.equal(rows[0]._canEditImportance, undefined);
  assert.equal(nextRows[0]._canEditImportance, undefined);
});
