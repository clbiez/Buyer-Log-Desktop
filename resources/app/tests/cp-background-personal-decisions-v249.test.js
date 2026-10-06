'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const Engine=require('../public/cp-readiness-engine');
function harness(){
  const storage=new Map();let revision=1,tick=0;
  const context={console,Date,Intl,Set,Map,WeakMap,Promise,setTimeout,clearTimeout,performance:{now:()=>tick+=2},
    BLCpReadinessEngine:Engine,BLCpChecklistEngine:require('../public/cp-checklist-engine'),BLCpRulesEngine:require('../public/cp-rules-engine'),
    BLCpDecisionRuntime:require('../public/cp-decision-runtime'),BL_USER_CONTEXT:{id:'demo'},appLang:'tr',state:{overrides:{transitRules:[]}},
    BL_CP_DECISION_DATA_REVISION:()=>revision,localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)},
    document:{getElementById:()=>null,querySelectorAll:()=>[],addEventListener:()=>{}},addEventListener:()=>{},dispatchEvent:()=>{},CustomEvent:class{}};
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
