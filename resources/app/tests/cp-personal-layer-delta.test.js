'use strict';
// CPR-09: a single checklist answer re-evaluated all 24,982 synthetic CP orders
// (and rebuilt the checklist summary) although only the same order or the same
// product option can be affected. The personal layer now re-evaluates only
// orders whose answers (or option answers) changed while every non-answer input
// is unchanged, and must stay identical to a full recomputation.
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const ROOT=path.resolve(__dirname,'..');
const Checklist=require('../public/cp-checklist-engine'),RulesEngine=require('../public/cp-rules-engine');

function browser(){
  const saved=new Map(),listeners=new Map();
  const storage={getItem:k=>saved.has(k)?saved.get(k):null,setItem:(k,v)=>saved.set(k,String(v)),removeItem:k=>saved.delete(k)};
  const counter={evaluations:0};
  const Rules=Object.assign({},RulesEngine,{evaluateOrder(...args){counter.evaluations++;return RulesEngine.evaluateOrder(...args);}});
  const ctx={console,Map,Set,WeakMap,WeakSet,Date,JSON,Blob,Promise,localStorage:storage,
    BLStorage:{...storage,actualKey:k=>'user.'+k,native:storage},BL_USER_CONTEXT:{id:'buyer'},
    BLCpChecklistEngine:Checklist,BLCpRulesEngine:Rules,
    BLCpReadinessEngine:{
      analyzeOrder:row=>({orderKey:row.orderKey,sourceRow:row,qty:row.qty,plmId:row.plmId,modelName:row.modelName,colourCode:row.colourCode,
        priority:'ON_TRACK',daysToLoad:row.daysToLoad,stage:'production',dims:{},riskReasons:[],signals:[]}),
      summarizeAnalyses:orders=>({orders,loadingPlan:{}}),recount:model=>({...model,counted:(model.orders||[]).length}),
    },
    BLCpDecisionRuntime:require('../public/cp-decision-runtime'),
    document:{documentElement:{lang:'en'},querySelector:()=>null,getElementById:()=>null},
    fetch:async()=>({ok:true,json:async()=>({answers:{},tombstones:{}})}),setTimeout:()=>0,clearTimeout:()=>{},
    CustomEvent:class{constructor(type,props){this.type=type;Object.assign(this,props);}},
    addEventListener:(name,f)=>{if(!listeners.has(name))listeners.set(name,[]);listeners.get(name).push(f);},
    dispatchEvent:e=>{(listeners.get(e.type)||[]).forEach(f=>f(e));},showToast:()=>{},
  };
  ctx.window=ctx;ctx.globalThis=ctx;vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(ROOT,'public/cp-overview-assistant.js'),'utf8'),ctx);
  return {assistant:ctx.BLCpAssistant,counter};
}
// Pairs of orders share a product option (same PLM + model + colour).
const rows=Array.from({length:40},(_,i)=>({orderKey:'PO'+i,qty:10+i,plmId:String(1000+Math.floor(i/2)),modelName:'Model '+Math.floor(i/2),colourCode:'C'+Math.floor(i/2),daysToLoad:30}));
function describe(result){
  return JSON.stringify([rows.map(row=>{const a=result.byRow.get(row);return a&&[a.orderKey,a.priority,a.trackingTags,a.checklistState,a.ruleState,(a.matchedRules||[]).map(r=>r.id)];}),
    (result.checklist.items||[]).map(b=>[b.id,b.rows,b.qty,b.rejected,(b.allOrders||[]).map(o=>o.orderKey)]),
    result.checklist.openTotal,result.checklist.answeredTotal,result.checklist.rejectedTotal,result.model.counted]);
}
function full(b,list=rows){b.assistant._resetDecisionDelta();return describe(b.assistant.computeDecisionsForRows(list.slice()));}
// The app's own default for a new checklist heading: asked within 365 days to loading.
function rule(b){
  const added=RulesEngine.normalizeRule({kind:'checklist',name:'Delta Check',nameEn:'Delta Check',tr:'Delta Check',en:'Delta Check',
    conditions:[{field:'@daysToLoad',operator:'lte',value:365}],expressionVersion:RulesEngine.EXPRESSION_VERSION,approvalScope:'order'});
  b.assistant._state.rules=[...b.assistant._state.rules,added];
  return added;
}

test('one changed answer re-evaluates only its order and matches a full recomputation', () => {
  const b=browser(),A=b.assistant,id=rule(b).id;
  A.computeDecisionsForRows(rows.slice());
  b.counter.evaluations=0;
  A.computeDecisionsForRows(rows.slice());
  assert.equal(b.counter.evaluations,0,'unchanged answers reuse every evaluation');
  const before=A.computeDecisionsForRows(rows.slice()),beforeText=describe(before);
  assert.notEqual(before.byRow.get(rows[7]).checklistState[id],'notApplicable','the rule must apply to the changed order');
  A.setChecklistAnswer(before.byRow.get(rows[7]),id,'rejected');
  b.counter.evaluations=0;
  const delta=describe(A.computeDecisionsForRows(rows.slice()));
  assert.equal(b.counter.evaluations,1,'only the changed order is evaluated');
  assert.notEqual(delta,beforeText,'the answer must change the decision');
  assert.equal(delta,full(b),'delta result equals a full recomputation');
});

test('an option-scoped approval re-evaluates every order of that option', () => {
  const b=browser(),A=b.assistant,id=rule(b).id;
  A._state.rules=A._state.rules.map(r=>r&&r.id===id?{...r,approvalScope:'option'}:r);
  const before=A.computeDecisionsForRows(rows.slice());
  A.setChecklistAnswer(before.byRow.get(rows[4]),id,'approved');
  b.counter.evaluations=0;
  const delta=describe(A.computeDecisionsForRows(rows.slice()));
  assert.equal(b.counter.evaluations,2,'the order and its option sibling are evaluated');
  const after=A.computeDecisionsForRows(rows.slice());
  assert.equal(after.byRow.get(rows[5]).checklistState[id],'approved','the sibling inherits the option approval');
  assert.equal(delta,full(b));
});

test('a change consumed by a subset computation is still applied to the full list', () => {
  const b=browser(),A=b.assistant,id=rule(b).id,subset=rows.slice(0,10);
  const before=A.computeDecisionsForRows(rows.slice());
  A.computeDecisionsForRows(subset.slice());
  A.setChecklistAnswer(before.byRow.get(rows[30]),id,'rejected');
  A.computeDecisionsForRows(subset.slice());
  const result=A.computeDecisionsForRows(rows.slice()),delta=describe(result);
  assert.equal(result.byRow.get(rows[30]).checklistState[id],'rejected');
  assert.equal(delta,full(b),'the outside order must not keep a stale decision');
});

test('a non-answer change recomputes every order', () => {
  const b=browser(),A=b.assistant;
  A.computeDecisionsForRows(rows.slice());
  A._state.rules=A._state.rules.slice();
  b.counter.evaluations=0;
  A.computeDecisionsForRows(rows.slice());
  assert.equal(b.counter.evaluations,rows.length);
});
