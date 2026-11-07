'use strict';
// A personal decision-context change (checklist answer, rule) is not CP row data.
// It must still invalidate the unified priority table revision used by app-main,
// but must not bump BL_CP_DECISION_DATA_REVISION: that revision keys the base
// decision cache and the personal-layer delta, and bumping it re-analysed all
// 24,982 synthetic CP rows (~8 s) for every single checklist answer.
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const SOURCE=fs.readFileSync(path.join(__dirname,'..','public','app-main.js'),'utf8');

function load(){
  const start=SOURCE.indexOf('const _unifiedPriorityTableRevision=');
  const end=SOURCE.indexOf('function unifiedPriorityRowActive(');
  assert.ok(start>0&&end>start,'revision block must stay discoverable');
  const events=[];
  const ctx={CustomEvent:class{constructor(type,props){this.type=type;Object.assign(this,props);}},
    _unifiedPriorityCache:{cp:{},orders:{}},_unifiedPriorityDataRevision:0,events};
  ctx.window={dispatchEvent:e=>events.push(e.detail&&e.detail.reason),BLPerf:null};
  vm.createContext(ctx);
  vm.runInContext('var _unifiedPriorityCache={cp:{},orders:{}};var _unifiedPriorityDataRevision=0;'+SOURCE.slice(start,end)
    +';this.api={invalidate:invalidateUnifiedPriorityDecisions,table:()=>({..._unifiedPriorityTableRevision}),cache:()=>_unifiedPriorityCache};',ctx);
  return {api:ctx.api,decisionRevision:()=>ctx.window.BL_CP_DECISION_DATA_REVISION(),events};
}

test('personal decision context invalidates priorities but not the decision input revision', () => {
  const s=load(),before=s.decisionRevision(),table=s.api.table().cp;
  assert.ok(before>0,'decision input revision starts positive like the table revision');
  s.api.invalidate('personal-decision-context',['cp']);
  assert.equal(s.decisionRevision(),before,'answers/rules are not CP row data');
  assert.equal(s.api.table().cp,table+1,'unified priority consumers still see a new table revision');
  assert.equal(s.api.cache().cp,null,'the unified priority cache is still cleared');
  assert.deepEqual(s.events,['personal-decision-context'],'Global Flow is still notified');
});

test('real CP data changes still bump the decision input revision', () => {
  const s=load(),before=s.decisionRevision();
  s.api.invalidate('cp-load',['cp']);
  assert.equal(s.decisionRevision(),before+1);
  s.api.invalidate('data');
  assert.equal(s.decisionRevision(),before+2,'an all-table invalidation includes CP');
  s.api.invalidate('orders-load',['orders']);
  assert.equal(s.decisionRevision(),before+2,'an Orders-only change is not CP input');
});
