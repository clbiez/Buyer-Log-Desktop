'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const Engine=require('../public/cp-readiness-engine');
function harness(useWorker=false){
  const storage=new Map();let revision=1,tick=0;
  const context={console,Date,Intl,Set,Map,WeakMap,Promise,setTimeout,clearTimeout,performance:{now:()=>tick+=2},
    BLCpReadinessEngine:Engine,BLCpChecklistEngine:require('../public/cp-checklist-engine'),BLCpRulesEngine:require('../public/cp-rules-engine'),
    BLCpDecisionRuntime:require('../public/cp-decision-runtime'),BL_USER_CONTEXT:{id:'demo'},appLang:'tr',state:{overrides:{transitRules:[]}},
    BL_CP_DECISION_DATA_REVISION:()=>revision,localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)},
    document:{getElementById:()=>null,querySelectorAll:()=>[],addEventListener:()=>{}},addEventListener:()=>{},dispatchEvent:()=>{},CustomEvent:class{}};
  if(useWorker)context.Worker=function(){return require('./helpers/cp-browser-worker')();};
  context.window=context;vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../public/cp-overview-assistant.js'),'utf8'),context);
  return {context,assistant:context.BLCpAssistant,bump:()=>revision++};
}
function rows(){const F=Engine.FIELDS;return Array.from({length:20},(_,i)=>({[F.orderCode]:String(i),[F.qty]:100,[F.status]:'Üretimde',[F.exFactory]:'2026-10-05',[F.model]:'DEMO',[F.colourCode]:'RED',[F.retail]:'2026-12-01',[F.inStore]:'2026-12-10'}));}
test('background personal decisions match the synchronous canonical engine and reuse final results',async()=>{
  const a=harness(),b=harness(),list=rows();
  const rule=a.context.BLCpRulesEngine.normalizeRule({id:'demo-critical',kind:'priority',target:'CRITICAL',name:'Demo quantity',conditions:[{field:'@qty',operator:'gte',value:100}]});
  a.assistant._state.rules=[rule];b.assistant._state.rules=[rule];
  const sync=a.assistant.computeDecisionsForRows(list),asyncResult=await b.assistant.computeDecisionsForRowsAsync(list);
  assert.deepEqual(JSON.parse(JSON.stringify(asyncResult.model)),JSON.parse(JSON.stringify(sync.model)));
  assert.deepEqual(JSON.parse(JSON.stringify(asyncResult.model.orders)),JSON.parse(JSON.stringify(sync.model.orders)));
  assert.ok(asyncResult.model.orders.every(order=>order.matchedRules.some(rule=>rule.id==='demo-critical')));
  assert.equal(await b.assistant.computeDecisionsForRowsAsync(list),asyncResult);
  assert.equal(b.assistant.computeDecisionsForRows(list),asyncResult);
  list[0]['Order Quantity']=999;b.bump();
  const changed=await b.assistant.computeDecisionsForRowsAsync(list);
  assert.notEqual(changed,asyncResult);assert.equal(changed.byRow.get(list[0]).qty,999);
});
test('a context change during a background pass cannot publish previous personal decisions',async()=>{
  const h=harness(),list=rows();
  const result=h.assistant.computeDecisionsForRowsAsync(list);
  h.context.BL_USER_CONTEXT={id:'another-user'};h.bump();
  assert.equal(await result,null);assert.equal(h.assistant.peekDecisionsForRows(list),null);
});

 test('Web Worker personal priority, checklist formulas, answers and filtered row cache match synchronous decisions',async()=>{
  const sync=harness(),background=harness(true),seed=rows();
  const list=Array.from({length:300},(_,i)=>({...seed[i%seed.length],'Order Code':String(i)}));
  const Rules=sync.context.BLCpRulesEngine;
  const rules=[Rules.normalizeRule({id:'custom-check',kind:'checklist',name:'Demo check',mode:'formula',formula:'[@qty] >= 100'}),
    Rules.normalizeRule({id:'custom-priority',kind:'priority',target:'CRITICAL',name:'Demo critical',conditions:[{field:'@qty',operator:'gte',value:100}]})];
  sync.assistant._state.rules=rules;background.assistant._state.rules=rules;
  for(const h of [sync,background]){
    h.assistant._state.checklistSettings.enabled=true;
    const analysis=Engine.analyzeOrder(list[0],{}),Checklist=h.context.BLCpChecklistEngine;
    h.assistant._state.answers[Checklist.answerKey(analysis.orderKey,'custom-check')]=Checklist.makeAnswer('approved',analysis,{at:'2026-10-11T00:00:00Z'});
  }
  const expected=sync.assistant.computeDecisionsForRows(list),actual=await background.assistant.computeDecisionsForRowsAsync(list);
  const plain=value=>JSON.parse(JSON.stringify(value));
  assert.deepEqual(plain(actual.model),plain(expected.model));assert.deepEqual(plain(actual.model.orders),plain(expected.model.orders));
  assert.equal(actual.model.orders[0].checklistState['custom-check'],'approved');
  assert.equal(background.assistant.decisionRuntimeStats().workerJobs,1);
  assert.equal(background.assistant.decisionRuntimeStats().failed,0);
  list.forEach(row=>assert.equal(actual.byRow.get(row).sourceRow,row));
  const subset=await background.assistant.computeDecisionsForRowsAsync(list.slice(0,150));
  assert.deepEqual(plain(subset.model.orders),plain(expected.model.orders.slice(0,150)));
 });
