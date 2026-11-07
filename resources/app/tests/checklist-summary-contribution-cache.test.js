'use strict';
// CPR-09: Checklist.summarize can reuse per-order contributions through a
// caller-owned WeakMap. The cached and uncached summaries must be identical,
// and dropping one order's contribution recomputes only that order.
const test=require('node:test'),assert=require('node:assert/strict');
const Checklist=require('../public/cp-checklist-engine.js');

const analyses=Array.from({length:12},(_,i)=>({orderKey:'PO'+i,qty:5+i,daysToLoad:20+i,sourceRow:{'Order Code':'PO'+i,'Product Main Definition':'Kazak'}}));
const custom=[{id:'chk',group:'custom',custom:true,tr:'Kontrol',en:'Check',questionTr:'Kontrol?',questionEn:'Check?',approvalScope:'order'}];
function context(answers,cache){
  return {settings:{enabled:true},answers,customItemsFor:()=>custom,managedItemIds:[],...(cache?{contributionCache:cache}:{})};
}
const plain=summary=>JSON.stringify({...summary,items:summary.items.map(b=>({...b,orders:b.orders.map(o=>o.orderKey),all:b.allOrders.map(o=>o.orderKey)}))});

test('cached and uncached summaries are identical', () => {
  const answers={'PO1::chk':{state:'approved'},'PO2::chk':{state:'rejected'}},cache=new WeakMap();
  const uncached=plain(Checklist.summarize(analyses,context(answers)));
  assert.equal(plain(Checklist.summarize(analyses,context(answers,cache))),uncached);
  assert.equal(plain(Checklist.summarize(analyses,context(answers,cache))),uncached,'second call reuses contributions');
});

test('dropping a contribution recomputes that order with the current answers', () => {
  const answers={'PO3::chk':{state:'rejected'}},cache=new WeakMap();
  Checklist.summarize(analyses,context(answers,cache));
  answers['PO3::chk']={state:'approved'};
  cache.delete(analyses[3]);
  assert.equal(plain(Checklist.summarize(analyses,context(answers,cache))),plain(Checklist.summarize(analyses,context(answers))));
});
