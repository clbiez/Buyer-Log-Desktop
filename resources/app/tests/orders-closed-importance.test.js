'use strict';
// Eski Orders alan yetkisi API'si canlı sipariş sahipliğini korur.
// Tablodaki editör için güncel kanonik CP satırı ayrıca zorunludur.
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
    cpEditorIdentityAttributes:r=>' data-line-key="'+r['Order Code']+'|DEMO|BLUE" data-edit-owner="alice"',
    lineIdentity:r => ({model:r['Model Name'], ccode:r['C.Code']}),
  };
  vm.createContext(context); vm.runInContext(read('public/order-importance-ui.js'), context);
  return { ui:context.window.BLOrderImportanceUI, sent, state };
}

test('closed order absent from CP stays view only even with a legacy importance permission', () => {
  const row = { _id:7, 'Order Code':1001, 'Model Name':'DEMO', 'C.Code':'BLUE', 'Active/Inactive':'Inactive', _canEdit:false, _canEditImportance:true };
  const {ui,sent} = uiHarness(row);
  assert.match(ui.cellHtml(row, false, 'orders', null), /viewOnlyCell/);
  assert.doesNotMatch(ui.cellHtml(row, false, 'orders', null), /impTrigger/);
  assert.equal(ui.pasteAssign(row, 'bts'), false);
  assert.deepEqual(sent, []);
});

test('Orders importance uses the canonical CP editor binding and persists an exact line identity', async () => {
  const display = { _id:7, 'Order Code':1001, 'Model Name':'DEMO', 'C.Code':'BLUE', _canEdit:false };
  const row = {...display,_id:12,_canEdit:true,_canEditShared:true};
  const {ui,sent,state} = uiHarness(display);
  state.cp.rows=[row];
  assert.match(ui.cellHtml(display, true, 'orders', row), /impTrigger" data-id="12" data-line-key="1001\|DEMO\|BLUE" data-edit-owner="alice"/);
  assert.equal(ui.pasteAssign(row, 'bts'), true);
  await new Promise(resolve => setImmediate(resolve));
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

test('Orders hydration does not request a separate permission or repaint from its response', () => {
  const app=read('public/app-main.js'),ui=read('public/order-importance-ui.js');
  assert.doesNotMatch(app,/applyOrdersImportanceEditAccess|\/api\/orders-importance-edit/);
  assert.doesNotMatch(ui,/_canEditImportance|refreshAccess/);
  assert.match(ui,/const row=resolveCpEditorRow\(btn\)/);
  assert.match(ui,/void assign\(findRow\(btn\), el\.dataset\.impValue/);
});
