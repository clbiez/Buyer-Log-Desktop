'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {keys}=require('../server/lib/derived-input-keys');
const opts={version:'7.0.248',day:'2026-10-06'};
test('identical content survives refreshed clocks, cloned snapshots and unrelated LFL reads',()=>{
  const runtime={loadedAt:'before',asasOrders:[{ocode:'001',qty:1}],antrepoMap:{A:[{qty:1}]}};
  const a=keys(runtime,'buyer-scope',{},opts),copy=JSON.parse(JSON.stringify(runtime));
  copy.loadedAt='after';copy.lflRows=[{arbitrary:1}];copy.sources={lfl:'new'};copy.modelRefresh={sourceGenerationId:'new'};
  assert.deepEqual(keys(copy,'buyer-scope',{},opts),a);
  copy.asasOrders[0].qty=2;assert.notEqual(keys(copy,'buyer-scope',{},opts).orders,a.orders);
});
test('per-target data, authorization, overrides, applied horizons, date and engine version invalidate reuse',()=>{
  const runtime={asasOrders:[{qty:1}],asasOrdersByTarget:{cp:[{qty:2}],orders:[{qty:3}],backlog:[{qty:4}]},antrepoMap:{}};
  const before=keys(runtime,'scope',{},opts);
  runtime.asasOrdersByTarget.cp[0].qty=5;const after=keys(runtime,'scope',{},opts);
  assert.notEqual(after.cp,before.cp);assert.equal(after.orders,before.orders);assert.equal(after.backlog,before.backlog);
  for(const value of [keys(runtime,'other-user',{},opts),keys(runtime,'scope',{datemap:{X:1}},opts),keys(runtime,'scope',{}, {...opts,day:'2026-10-07'}),keys(runtime,'scope',{}, {...opts,version:'next'})])assert.notEqual(value.orders,after.orders);
  runtime.modelRefresh={appliedHorizons:{orders:{season:'26W'}}};assert.notEqual(keys(runtime,'scope',{},opts).orders,after.orders);
});
