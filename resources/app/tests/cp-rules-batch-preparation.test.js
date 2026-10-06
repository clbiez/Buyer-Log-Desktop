'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const Rules=require('../public/cp-rules-engine');
test('batch preparation preserves default rule/checklist decisions and prepares conditions only once',()=>{
 const rules=Rules.mergeWithDefaults([]),preparedRules=Rules.prepareEvaluation(rules);
 for(const row of [{},{'License':'DEMO','Ex-Factory':'2026-10-12','Order Code':'00123'},{'License':'DISNEY','Loading Type':'Uçak','Order Code':'00345'}]){
  const analysis={sourceRow:row,orderKey:row['Order Code']||'empty',priority:'normal',signals:[],today:'2026-10-06'};
  assert.deepEqual(Rules.evaluateOrder(analysis,{rules,preparedRules,today:'2026-10-06'}),Rules.evaluateOrder(analysis,{rules,today:'2026-10-06'}));
 }
 let reads=0;
 const condition={field:'license',get operator(){reads++;return'eq';},value:'DEMO'};
 const own=[Rules.normalizeRule({id:'test',kind:'priority',target:'critical',conditions:[condition]})];
 own[0].conditions=[condition];reads=0;
 const prepared=Rules.prepareEvaluation(own),afterPrepare=reads;
 for(let i=0;i<1000;i++)assert.equal(Rules.evaluateOrder({sourceRow:{license:'DEMO'},priority:'normal',signals:[]},{rules:own,preparedRules:prepared}).matched.length,1);
 assert.equal(reads,afterPrepare,'condition normalization must not run per order');
});
test('the next batch observes rule edits and does not leak prepared state to other rules',()=>{
 const rules=Rules.normalizeRules([{id:'demo',enabled:true,kind:'priority',target:'critical',conditions:[{field:'License',operator:'eq',value:'DEMO'}]}]);
 const analysis={sourceRow:{License:'DEMO'},orderKey:'demo',priority:'normal',signals:[]};
 assert.equal(Rules.evaluateOrder(analysis,{rules,preparedRules:Rules.prepareEvaluation(rules)}).matched.length,1);
 rules[0].conditions[0].right.value='OTHER';
 assert.equal(Rules.evaluateOrder(analysis,{rules,preparedRules:Rules.prepareEvaluation(rules)}).matched.length,0);
 const other=Rules.normalizeRules([{id:'other',kind:'priority',conditions:[{field:'License',operator:'eq',value:'DEMO'}]}]);
 assert.deepEqual(Rules.evaluateOrder(analysis,{rules:other,preparedRules:Rules.prepareEvaluation(rules)}),Rules.evaluateOrder(analysis,{rules:other}));
});
