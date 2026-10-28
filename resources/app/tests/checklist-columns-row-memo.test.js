'use strict';
// CP's first render spent ~85% of its time (≈7.7 s for 25k rows) re-deriving
// each row's set/part identity once per checklist item and again per helper.
// The identity depends on the row only, so it is derived once per row.
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const Checklist=require('../public/cp-checklist-engine.js');

function load(file){
  const resolved=require.resolve(file);delete require.cache[resolved];
  return require(resolved);
}
function scenario(itemCount,probe){
  const counted=row=>new Proxy(row,{getOwnPropertyDescriptor(target,key){probe.lookups++;return Reflect.getOwnPropertyDescriptor(target,key);},ownKeys(target){probe.lookups++;return Reflect.ownKeys(target);}});
  const rows=[
    {'Order Code':'100','Product Main Definition':'2 Parça Takım','Category':'Set'},
    {'Order Code':'200','Product Main Definition':'Kazak','Category':'Knit'},
    {'Order Code':'300','Product Main Definition':'Kazak','setPieceCount':3},
  ].map(counted);
  const rules=Array.from({length:itemCount},(_,i)=>({id:'item'+i,kind:'checklist',tr:'Madde '+i,en:'Item '+i}));
  const answers={'100::item0~part~A':{state:'approved'},'200::item0':{state:'rejected'},'300::item1~part~C':{state:'notRequired'}};
  const byRow=new WeakMap(rows.map(row=>[row,{orderKey:row['Order Code'],sourceRow:row,checklistItemIds:rules.map(rule=>rule.id)}]));
  return {rows,rules,answers,decision:{byRow}};
}
function run(itemCount){
  const probe={lookups:0},s=scenario(itemCount,probe);
  Object.assign(globalThis,{
    BLCpAssistant:{_state:{rules:s.rules,answers:s.answers}},BLCpChecklistEngine:Checklist,
    BLFormulaRows:{cp:()=>s.rows},COLS_BY_TABLE:{cp:[{k:'Order Code'}]},appLang:'en',
  });
  try{
    const bridge=load('../public/checklist-supplier-sync.js');
    assert.equal(bridge.refreshColumns({render:false,decision:s.decision}),true);
  }finally{for(const key of ['BLCpAssistant','BLCpChecklistEngine','BLFormulaRows','COLS_BY_TABLE','appLang'])delete globalThis[key];}
  return {rows:s.rows,calls:probe.lookups};
}

test('checklist cells keep their set, part and plain statuses', () => {
  const {rows}=run(2);
  assert.deepEqual(rows[0]._checklistParts.item0.parts.map(part=>[part.id,part.state]),[['A','approved'],['B','open']]);
  assert.equal(rows[0]._checklistStatus.item0,'open');
  assert.equal(rows[1]._checklistStatus.item0,'rejected');
  assert.equal(rows[1]._checklistParts.item0,undefined,'a plain row has no part cells');
  assert.deepEqual(rows[2]._checklistParts.item1.parts.map(part=>[part.id,part.state]),[['A','open'],['B','open'],['C','notRequired']]);
});

const s3PerItem=3*2; // 3 rows, at most two own-cell lookups per extra item
test('set identity is derived per row, not per row × checklist item', () => {
  const few=run(2).calls,many=run(12).calls;
  assert.ok(few>0);
  // Each extra item only adds its own answer/cell work, never another set-identity scan.
  assert.ok(many-few<=(12-2)*s3PerItem,`row field lookups grew from ${few} to ${many}`);
});
