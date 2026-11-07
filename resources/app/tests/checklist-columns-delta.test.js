'use strict';
// CPR-09: every checklist answer rewrote the checklist cells of all CP rows. Rows
// whose analysis object is unchanged and whose order/option answers did not
// change keep their cells; changed answers, new analyses and changed global
// inputs (headings, language, tasks, rules, settings) still rewrite rows.
const test=require('node:test'),assert=require('node:assert/strict');
const Checklist=require('../public/cp-checklist-engine.js');

function load(file){const resolved=require.resolve(file);delete require.cache[resolved];return require(resolved);}
function setup(){
  const rows=[1,2,3].map(n=>({'Order Code':String(n*100),'Product Main Definition':'Kazak'}));
  const rules=[{id:'item0',kind:'checklist',tr:'Madde 0',en:'Item 0'}];
  const answers={};
  const analyses=new Map(rows.map(row=>[row,{orderKey:row['Order Code'],sourceRow:row,checklistState:{item0:'open'}}]));
  const decision=()=>({byRow:new WeakMap([...analyses])});
  const evaluated=[];
  Object.assign(globalThis,{
    BLCpAssistant:{_state:{rules,answers}},BLCpChecklistEngine:Checklist,
    BLCpRulesEngine:{evaluateOrder(analysis){evaluated.push(analysis.orderKey);return {customItems:[{id:'item0'}]};}},
    BLFormulaRows:{cp:()=>rows},COLS_BY_TABLE:{cp:[{k:'Order Code'}]},appLang:'en',
  });
  const bridge=load('../public/checklist-supplier-sync.js');
  return {bridge,rows,answers,analyses,decision,evaluated,state:globalThis.BLCpAssistant._state};
}
function cleanup(){for(const key of ['BLCpAssistant','BLCpChecklistEngine','BLCpRulesEngine','BLFormulaRows','COLS_BY_TABLE','appLang'])delete globalThis[key];}
const cell=row=>row['__checklist__item0'];

test('unchanged rows keep their cells; a changed answer rewrites only its row', () => {
  const s=setup();
  try{
    s.bridge.refreshColumns({render:false,decision:s.decision()});
    assert.deepEqual(s.evaluated,['100','200','300']);
    s.evaluated.length=0;
    s.bridge.refreshColumns({render:false,decision:s.decision()});
    assert.deepEqual(s.evaluated,[],'a new decision with the same analyses rewrites nothing');
    s.answers['200::item0']={state:'approved'};
    s.analyses.get(s.rows[1]).checklistState={item0:'approved'};
    s.bridge.refreshColumns({render:false,decision:s.decision()});
    assert.deepEqual(s.evaluated,['200'],'only the row with a changed answer is rewritten');
    assert.match(cell(s.rows[1]),/Approved/);
    assert.match(cell(s.rows[0]),/Pending|Open/);
  }finally{cleanup();}
});

test('a new analysis object or a changed global input rewrites rows', () => {
  const s=setup();
  try{
    s.bridge.refreshColumns({render:false,decision:s.decision()});
    s.evaluated.length=0;
    s.analyses.set(s.rows[2],{...s.analyses.get(s.rows[2])});
    s.bridge.refreshColumns({render:false,decision:s.decision()});
    assert.deepEqual(s.evaluated,['300'],'a new analysis object is rewritten');
    s.evaluated.length=0;
    s.state.rules=s.state.rules.slice();
    s.bridge.refreshColumns({render:false,decision:s.decision()});
    assert.deepEqual(s.evaluated,['100','200','300'],'a rules change rewrites every row');
    s.evaluated.length=0;
    globalThis.appLang='tr';
    s.bridge.refreshColumns({render:false,decision:s.decision()});
    assert.deepEqual(s.evaluated,['100','200','300'],'a language change rewrites every row');
  }finally{cleanup();}
});
