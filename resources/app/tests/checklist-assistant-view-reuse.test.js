'use strict';
// After a checklist answer, refreshAssistantView received the same cached
// decision that the synchronous pass had already written into the CP cells and
// still forced a second full refreshColumns pass (~3 s on 24,982 synthetic rows).
// The same decision, rows, test tasks, headings and language now reuse the
// applied cells; any difference still triggers a full pass.
const test=require('node:test'),assert=require('node:assert/strict');
const Checklist=require('../public/cp-checklist-engine.js');

function load(file){const resolved=require.resolve(file);delete require.cache[resolved];return require(resolved);}
function setup(){
  const rows=[{'Order Code':'100','Product Main Definition':'Kazak'},{'Order Code':'200','Product Main Definition':'Kazak'}];
  const rules=[{id:'item0',kind:'checklist',tr:'Madde 0',en:'Item 0'},{id:'item1',kind:'checklist',tr:'Madde 1',en:'Item 1'}];
  const makeDecision=()=>({byRow:new WeakMap(rows.map(row=>[row,{orderKey:row['Order Code'],sourceRow:row}]))});
  let current=makeDecision(),evaluations=0;
  Object.assign(globalThis,{
    BLCpAssistant:{_state:{rules,answers:{}},computeDecisionsForRowsAsync:()=>Promise.resolve(current),onOverviewRendered:()=>{}},
    BLCpChecklistEngine:Checklist,
    BLCpRulesEngine:{evaluateOrder(){evaluations++;return {customItems:rules.map(rule=>({id:rule.id}))};}},
    BLFormulaRows:{cp:()=>rows},COLS_BY_TABLE:{cp:[{k:'Order Code'}]},appLang:'en',
  });
  const bridge=load('../public/checklist-supplier-sync.js');
  return {bridge,rows,get evaluations(){return evaluations;},get decision(){return current;},replaceDecision(){current=makeDecision();}};
}
function cleanup(){for(const key of ['BLCpAssistant','BLCpChecklistEngine','BLCpRulesEngine','BLFormulaRows','COLS_BY_TABLE','appLang'])delete globalThis[key];}
const settle=()=>new Promise(resolve=>setImmediate(resolve));

test('an already applied decision is not rewritten by the assistant view refresh', async () => {
  const s=setup();
  try{
    assert.equal(s.bridge.refreshColumns({render:false,decision:s.decision}),true);
    const afterFirst=s.evaluations;assert.equal(afterFirst,2,'one evaluation per row');
    s.bridge.refreshAssistantView();await settle();
    assert.equal(s.evaluations,afterFirst,'same decision, rows and tasks must reuse the applied cells');
  }finally{cleanup();}
});

test('a new decision still triggers a full pass', async () => {
  const s=setup();
  try{
    s.bridge.refreshColumns({render:false,decision:s.decision});
    const afterFirst=s.evaluations;
    s.replaceDecision();
    s.bridge.refreshAssistantView();await settle();
    assert.equal(s.evaluations,afterFirst+2,'a different decision object re-evaluates every row');
  }finally{cleanup();}
});
