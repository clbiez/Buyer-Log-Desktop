'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const Runtime=require('../public/cp-decision-runtime');
const Engine=require('../public/cp-readiness-engine');
test('cooperative CP uses identical canonical results and reuses rows across table and filtered overview',async()=>{
  const F=Engine.FIELDS,rows=Array.from({length:50},(_,i)=>({[F.orderCode]:String(i),[F.qty]:10,[F.exFactory]:'2026-10-05',[F.status]:'Üretimde'}));
  let revision=1,calls=0,yields=0,clock=0;
  const runtime=Runtime.create({contextKey:()=>revision,analyzeRow:(r,c)=>{calls++;return Engine.analyzeOrder(r,c);},summarize:Engine.summarizeAnalyses,now:()=>clock+=2,yieldTask:async()=>{yields++;}});
  const context={today:20000};
  const result=await runtime.computeAsync(rows,context);
  assert.deepEqual(result,Engine.analyze(rows,context));
  assert.deepEqual(result.orders,Engine.analyze(rows,context).orders);
  assert.ok(yields>1);
  const subset=runtime.compute(rows.slice(0,10),context);
  assert.equal(calls,50);assert.equal(subset.totals.rows,10);
  revision++;runtime.compute(rows,context);assert.equal(calls,100);
});
test('data/user/rule changes during an async CP job discard stale results',async()=>{
  let revision=1,clock=0;
  const runtime=Runtime.create({contextKey:()=>revision,analyzeRow:r=>r,summarize:r=>r,now:()=>clock+=9,yieldTask:async()=>{revision++;}});
  assert.equal(await runtime.computeAsync([{},{}],{}),null);
});
