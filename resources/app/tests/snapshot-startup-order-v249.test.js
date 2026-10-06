'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const app=fs.readFileSync(path.join(__dirname,'../public/app-main.js'),'utf8');
const clocks=fs.readFileSync(path.join(__dirname,'../public/overview-launchpad.js'),'utf8');
test('the snapshot refresh timestamp is visible despite the global section tab rule',()=>{
  const css=fs.readFileSync(path.join(__dirname,'../public/app.css'),'utf8');
  assert.match(css,/\.ovRefreshResult\{display:block;/);
  assert.match(css,/\.ovRefreshResult\[hidden\]\{display:none!important;/);
});
test('the first screen awaits its prepared projection before secondary tasks can consume HTTP slots',()=>{
  const start=app.indexOf("window.addEventListener('DOMContentLoaded', async ()");
  const boot=app.slice(start,app.indexOf('async function refreshFolderLabel()',start));
  assert.ok(boot.indexOf('await waitForStartupPrimaryScreen()')<boot.indexOf('schedulePostUiStartupTasks()'));
  assert.ok(boot.indexOf("mark?.('UI_READY')")<boot.indexOf("new CustomEvent('bl:primary-screen-ready')"));
  assert.match(app,/if\(mode!=='error'&&startupReadySignaled\)void ensureOverviewCpDependency\(\)/);
  assert.match(clocks,/if\(!primaryScreenReady\)return;/);
  assert.match(clocks,/addEventListener\('bl:primary-screen-ready'/);
  assert.doesNotMatch(clocks,/Promise\.all\(nodes\.map/);
});
test('CP rendering schedules canonical decisions and rejects results for replaced data, rules or days',()=>{
  const schedule=app.slice(app.indexOf('function scheduleUnifiedPrioritiesForTable('),app.indexOf('function renderCorePageLoadingState('));
  assert.match(schedule,/computeDecisionsForRowsAsync\(rows\)/);
  assert.match(schedule,/state\.cp\?\.rows!==rows/);
  assert.match(schedule,/revision!==_unifiedPriorityTableRevision\.cp/);
  assert.match(schedule,/contextRevision!==assistant\.decisionContextRevision\(\)/);
  assert.match(schedule,/day!==new Date\(\)\.toDateString\(\)/);
  const ensure=app.slice(app.indexOf('function ensureUnifiedPrioritiesForTable('),app.indexOf("window.addEventListener('bl:cp-decision-context-changed'"));
  assert.doesNotMatch(ensure,/syncUnifiedPrioritiesForTable\(tableKey\)/);
  assert.match(ensure,/scheduleUnifiedPrioritiesForTable\(tableKey\)/);
});
