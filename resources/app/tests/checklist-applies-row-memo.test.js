'use strict';
// The production decision layer does not attach `checklistItemIds` to CP
// analyses, so refreshColumns resolved which checklist items apply with a full
// Rules.evaluateOrder call per row × checklist item. On 24,982 synthetic CP rows
// that was ~80 s of renderer CPU. The applicable set depends on the row (rules,
// answers and settings are fixed within one synchronous pass), so it is
// evaluated once per row and reused for every item in the same pass.
const test=require('node:test'),assert=require('node:assert/strict');
const Checklist=require('../public/cp-checklist-engine.js');

function load(file){
  const resolved=require.resolve(file);delete require.cache[resolved];
  return require(resolved);
}
function scenario(itemCount){
  const rows=[
    {'Order Code':'100','Product Main Definition':'Kazak','Category':'Knit'},
    {'Order Code':'200','Product Main Definition':'Kazak','Category':'Knit'},
    {'Order Code':'300','Product Main Definition':'Kazak','Category':'Knit'},
  ];
  const rules=Array.from({length:itemCount},(_,i)=>({id:'item'+i,kind:'checklist',tr:'Madde '+i,en:'Item '+i}));
  const answers={'100::item1':{state:'approved'},'300::item0':{state:'rejected'}};
  // Production shape: no precomputed checklistItemIds on the analysis.
  const byRow=new WeakMap(rows.map(row=>[row,{orderKey:row['Order Code'],sourceRow:row}]));
  // Row 100 asks every item, row 200 only even items, row 300 none.
  const appliesFor=analysis=>rules.filter((rule,index)=>analysis.orderKey==='100'||(analysis.orderKey==='200'&&index%2===0));
  return {rows,rules,answers,decision:{byRow},appliesFor};
}
function run(itemCount,{withRows}={}){
  const s=scenario(itemCount),calls=[];
  const Rules={evaluateOrder(analysis,options){
    calls.push(analysis.orderKey);
    assert.equal(options.rules,s.rules);assert.equal(options.answers,s.answers);
    return {customItems:s.appliesFor(analysis).map(rule=>({id:rule.id}))};
  }};
  Object.assign(globalThis,{
    BLCpAssistant:{_state:{rules:s.rules,answers:s.answers}},BLCpChecklistEngine:Checklist,BLCpRulesEngine:Rules,
    BLFormulaRows:{cp:()=>s.rows},COLS_BY_TABLE:{cp:[{k:'Order Code'}]},appLang:'en',
  });
  try{
    const bridge=load('../public/checklist-supplier-sync.js');
    assert.equal(bridge.refreshColumns({render:false,decision:s.decision}),true);
  }finally{for(const key of ['BLCpAssistant','BLCpChecklistEngine','BLCpRulesEngine','BLFormulaRows','COLS_BY_TABLE','appLang'])delete globalThis[key];}
  if(withRows)withRows(s);
  return {rows:s.rows,calls};
}
const cell=(row,id)=>row['__checklist__'+id];

test('applicable checklist items are evaluated once per row, not per row × item', () => {
  const few=run(2).calls,many=run(12).calls;
  assert.deepEqual(few.slice().sort(),['100','200','300']);
  assert.equal(many.length,3,`evaluateOrder ran ${many.length} times for 3 rows × 12 items`);
});

test('row-level reuse keeps every cell identical to per-item evaluation', () => {
  run(5,{withRows:s=>{
    const [all,even,none]=s.rows;
    for(let i=0;i<5;i++){
      assert.notEqual(cell(all,'item'+i),'',`row 100 asks item${i}`);
      assert.equal(cell(even,'item'+i)!=='',i%2===0,`row 200 item${i} follows its own applicable set`);
      assert.equal(cell(none,'item'+i),'',`row 300 never asks item${i}`);
    }
    // Answers stay attached to the right row and item.
    assert.equal(all._checklistStatus.item1,'approved');
    assert.deepEqual(none._checklistStatus,{},'a row with no applicable item has no statuses');
  }});
});
