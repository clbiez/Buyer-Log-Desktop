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
const PERF=read('public/perf-runtime.js');
const UI=read('public/backlog-plan-actual.js');
const CSS=read('public/backlog-plan-actual.css');
// Manifest appearance lives in the shared contract; module CSS retains layout.
const VISUAL=fs.readFileSync(path.join(__dirname,'..','public','ui-components.css'),'utf8').replace(/html\[data-ui-system="manifest"\] /g,'').replace(/\s*\{\s*/g,'{');
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
  assert.match(PERF,/backlogAnalysis:\[[^\]]*backlog-plan-actual\.js/);
  assert.doesNotMatch(HTML,/<script src="backlog-plan-actual\.js/);
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
  assert.match(VISUAL,/\.bpaModule\{[^}]*background:var\(--ui-surface\)[^}]*color:var\(--ui-text\)/);
  assert.match(VISUAL,/\.bpaModuleHead\{[^}]*background:var\(--ui-surface-soft\)/);
  assert.doesNotMatch(CSS,/#fff|#f8fafc|#111827|var\(--(?:card|ink|paper)\b/);
});

test('plan realisation view: plan window, grouped bars with tooltip + drawer, Excel export',()=>{
  const REPORT=read('public/backlog-plan-actual-report.js');
  assert.ok(PERF.indexOf('backlog-plan-actual-report.js')>0&&PERF.indexOf('backlog-plan-actual-report.js')<PERF.indexOf('backlog-plan-actual.js?'),'report engine loads before the panel');
  assert.match(SERVER,/planFrom:dayParam\(req\.query\.planFrom\)/);
  assert.match(SERVER,/plan:comparison\.plan/);
  assert.match(UI,/data-bpa-control="planMode"/);
  assert.match(UI,/data-bpa-group="\$\{d\.key\}"/);
  assert.match(UI,/data-bpa-tip="\$\{t\}" data-bpa-open="\$\{o\}"/);
  assert.match(UI,/function openDrawer\(spec\)/);
  assert.match(UI,/data-bpa-action="export"/);
  assert.match(UI,/ensureLibrary\('exceljs'\)/);
  assert.match(UI,/data-bpa-filter="productMainDefinition"/);
  assert.match(REPORT,/key:'productMainDefinition'/);
  assert.match(CSS,/\.bpaDrawer\{/);
  assert.doesNotMatch(CSS,/var\(--bad\)|var\(--ok\)|var\(--warn\)/,'undefined tone tokens must not be used');
});

test('Plan and Actual keeps its linear measure and percentage label',()=>{
  assert.match(UI,/class="uiMeasure" aria-hidden="true"/);
  assert.match(UI,/transform:scaleX\(/);
  assert.match(UI,/class="bpaRingText"/);
  assert.doesNotMatch(UI,/<circle\b/);
  assert.match(VISUAL,/\.uiMeasure>i\{[^}]*transform-origin:left/);
});

test('Overview circular loaded share clamps invalid values and preserves the visible percentage',()=>{
  const OVERVIEW=read('public/backlog-overview.js');
  const start=OVERVIEW.indexOf('function ring(value){'),end=OVERVIEW.indexOf('\nfunction hero(',start);
  assert.ok(start>=0&&end>start);
  const ring=new Function(OVERVIEW.slice(start,end)+';return ring;')();
  for(const [input,expected] of [[0,0],[.25,25],[.5,50],[1,100],[-.1,0],[1.2,100],[null,0],[NaN,0],[Infinity,0]]){
    const svg=ring(input);
    assert.match(svg,/<svg[^>]*aria-hidden="true"/);
    assert.equal((svg.match(/<circle\b/g)||[]).length,2);
    assert.match(svg,/pathLength="100"/);
    const dash=svg.match(/stroke-dasharray="([\d.]+) 100"/);
    assert.ok(dash,'value arc must encode the same percentage as the summary');
    assert.equal(Number(dash[1]),expected);
    assert.doesNotMatch(svg,/NaN|Infinity|uiMeasure/);
  }
  assert.match(OVERVIEW,/class="bpaRingText"[^]*?pct\(s\.loadedPct\)/);
});
