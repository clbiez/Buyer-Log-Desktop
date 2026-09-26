'use strict';
// Final regression gate marker for the complete Planlanan & Gerçekleşen feature head.

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const ROOT=path.join(__dirname,'..');
const read=file=>fs.readFileSync(path.join(ROOT,file),'utf8');
const SERVER=read('server/server.js');
const HTML=read('public/index.html');
const UI=read('public/backlog-plan-actual.js');
const CSS=read('public/backlog-plan-actual.css');
const STORAGE=read('public/user-storage.js');

test('plan actual API is Backlog-authorized and snapshots the Backlog target',()=>{
  assert.match(SERVER,/app\.get\('\/api\/backlog-plan-actual', userAccess\.requireArea\('backlog'\)/);
  assert.match(SERVER,/ordersForTarget\(active, 'backlog'/);
  assert.match(SERVER,/antrepoForTarget\(active, 'backlog'\)/);
  assert.match(SERVER,/userAccess\.filterRowsByScope\(req\.currentUser, resolved\.start\.rows\)/);
  assert.match(SERVER,/userAccess\.filterRowsByScope\(req\.currentUser, Array\.isArray\(item && item\.details\)/);
});

test('every successful refresh records a boundary marker without making analysis failure fatal',()=>{
  const clear=SERVER.indexOf('clearDeliveryOverridesForOrders((active.asasOrders || []).map(order => order.ocode))');
  const capture=SERVER.indexOf("captureBacklogPlanActualSnapshot(id, active");
  const history=SERVER.indexOf('if (summary.hasChanges)',clear);
  assert.ok(clear>0&&capture>clear&&capture<history,'snapshot capture must occur after final overrides and before history finalization');
  assert.match(SERVER,/logRuntimeFailure\('backlogPlanActualSnapshot'/);
});

test('Backlog mounts a movable collapsible panel and loads its isolated assets',()=>{
  assert.match(HTML,/id="backlogPlanActualModule"/);
  assert.match(HTML,/id="backlogPlanActualToggle"/);
  assert.match(HTML,/id="backlogPlanActualMoveUp"/);
  assert.match(HTML,/backlog-plan-actual\.css/);
  assert.match(HTML,/backlog-plan-actual\.js/);
  assert.match(UI,/type="datetime-local"/);
  assert.match(UI,/data-bpa-filter="buyer"/);
  assert.match(UI,/data-bpa-filter="buyingGroup"/);
  assert.match(UI,/data-bpa-filter="manufacturer"/);
  assert.match(UI,/data-bpa-filter="season"/);
  assert.match(UI,/head\.draggable=true/);
});

test('only changed rows are rendered and intermediate revision traffic remains separate',()=>{
  assert.match(UI,/visibleChanges\(\)/);
  assert.match(UI,/Net değişiklikler/);
  assert.match(UI,/Dönem içi değişiklik trafiği/);
  assert.match(UI,/değişmeyen Backlog satırları gösterilmez/);
});

test('panel preferences are user scoped and synced like existing Backlog analysis',()=>{
  const count=(STORAGE.match(/'lcw\.backlog\.planactual\.'/g)||[]).length;
  assert.equal(count,2,'prefix must exist in both scoped and synced registries');
  assert.match(UI,/STORAGE_KEY='lcw\.backlog\.planactual\.v1'/);
});


test('plan actual module uses shared theme tokens without light-theme fallbacks',()=>{
  assert.match(CSS,/\.bpaModule\{[^}]*background:var\(--card\);color:var\(--ink\)/);
  assert.match(CSS,/\.bpaModuleHead\{[^}]*background:var\(--card2\)/);
  assert.match(CSS,/background:var\(--paper,var\(--card2\)\)/);
  assert.doesNotMatch(CSS,/#fff|#f8fafc|#111827/);
});
