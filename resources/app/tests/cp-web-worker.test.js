'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const Runtime=require('../public/cp-decision-runtime'),Engine=require('../public/cp-readiness-engine');
const workerFactory=require('./helpers/cp-browser-worker');

function rows(count=300){return Array.from({length:count},(_,i)=>({
  'Order Code':String(i),'Order Quantity':100+i,'Shipment Quantity':i%3?20:100+i,'STATUS':['Production','Loading Operations','In Transit','Customs & Port Operations','In Warehouse','Shortage','unknown'][i%7],
  'Ex-factory':i%6?['2026-10-05','2026-10-14','2026-10-21'][i%3]:'invalid','Retail Date':'2026-12-01','In-Store (Model Budget)':'2026-12-10','Country':'TR','Del. Type':'Gemi','Model Name':'DEMO','C.Code':i%2?'RED':'BLUE',
  '_asasExFactory':'2026-10-01','_logisticShortageQty':i%7===5?5:0,'CUSTOM':i,
}));}
function runtime(extra={}){return Runtime.create({contextKey:()=>1,analyzeRow:Engine.analyzeOrder,summarize:Engine.summarizeAnalyses,workerFactory,...extra});}
test('real CP worker matches canonical models, groups, dates, transit rules and source row identity',async()=>{
  const list=rows(),context={today:Engine.defaultOrdinal('2026-10-11'),settings:{targetType:'retail'},transitRules:[{country:'TR',delType:'Gemi',days:40}]};
  const subject=runtime(),actual=await subject.computeAsync(list,context),expected=Engine.analyze(list,context);
  assert.deepEqual(actual,expected);assert.deepEqual(actual.orders,expected.orders);assert.deepEqual(actual.priorityGroups,expected.priorityGroups);
  for(const key of Object.keys(expected.loadingPlan)){
    assert.deepEqual(actual.loadingPlan[key].items,expected.loadingPlan[key].items);
    assert.ok(actual.loadingPlan[key].items.every(item=>actual.orders.includes(item)));
    assert.equal(Object.keys(actual.loadingPlan[key]).includes('items'),false);
  }
  assert.equal(Object.keys(actual).includes('orders'),false);
  actual.orders.forEach((analysis,i)=>assert.equal(analysis.sourceRow,list[i]));
  assert.equal(subject.getStats().workerJobs,1);assert.equal(subject.getStats().failed,0);
  const subset=await subject.computeAsync(list.slice(0,150),context);
  assert.deepEqual(subset,Engine.analyze(list.slice(0,150),context));assert.equal(subset.orders[0],actual.orders[0]);
  subject.dispose();
});
test('authority change during a worker batch discards results and cannot populate the new user cache',async()=>{
  let revision=1;let terminated=0;
  const subject=runtime({contextKey:()=>revision,workerFactory:()=>({postMessage(){},terminate(){terminated++;}})});
  const pending=subject.computeAsync(rows(),{});revision=2;
  assert.equal(await pending,null);assert.equal(terminated,1);
  const next=await subject.computeAsync(rows(2),{});assert.equal(next.totals.rows,2);subject.dispose();
});
test('worker failure falls back to the same canonical engine and subsequent jobs recover',async()=>{
  const subject=runtime({workerFactory:()=>{throw new Error('unavailable');}}),list=rows();
  const context={today:20000};assert.deepEqual((await subject.computeAsync(list,context)).orders,Engine.analyze(list,context).orders);
  assert.equal(subject.getStats().fallbackJobs,1);subject.dispose();
});
test('same rows coalesce and worker admission is bounded; disposal cancels queued references',async()=>{
  const subject=runtime({workerFactory:()=>({postMessage(){},terminate(){}})}),list=rows();
  const active=subject.computeAsync(list,{});assert.equal(subject.computeAsync(list,{}),active);
  const queued=Array.from({length:8},()=>subject.computeAsync(rows(),{}));
  assert.equal(await subject.computeAsync(rows(),{}),null);assert.equal(subject.getStats().queued,8);
  subject.dispose();assert.equal(await active,null);assert.deepEqual(await Promise.all(queued),Array(8).fill(null));
});
test('non-cloneable date adapter uses canonical cooperative computation',async()=>{
  let created=0;const subject=runtime({workerFactory:()=>{created++;return workerFactory();}}),list=rows(),context={today:20000,dateOrdinal:Engine.defaultOrdinal};
  assert.deepEqual((await subject.computeAsync(list,context)).orders,Engine.analyze(list,context).orders);assert.equal(created,0);subject.dispose();
});

test('duplicate row references across worker batches preserve canonical cache identity',async()=>{
  const row=rows(1)[0],list=Array(300).fill(row),subject=runtime(),context={today:20000};
  const model=await subject.computeAsync(list,context);
  assert.deepEqual(model,Engine.analyze(list,context));
  assert.ok(model.orders.every(analysis=>analysis===model.orders[0]));
  assert.equal(subject.compute([row],context).orders[0],model.orders[0]);subject.dispose();
});

test('worker failure between batches is latched and promptly falls back instead of blocking the queue',async()=>{
  let worker,context,first=true;
  const subject=runtime({workerFactory:()=>worker={
    postMessage(message){
      if(message.type==='begin')context=message.payload;
      const result=message.type==='begin'?true:message.payload.map(entry=>Engine.analyzeOrder(entry.row,context));
      queueMicrotask(()=>worker.onmessage?.({data:{id:message.id,ok:true,result}}));
    },terminate(){},
  },yieldTask:async()=>{if(first){first=false;worker.onerror();}}});
  const list=rows(),ctx={today:20000};
  try{
    const result=await Promise.race([subject.computeAsync(list,ctx),new Promise((_,reject)=>{const timer=setTimeout(()=>reject(new Error('worker failure did not settle')),1000);timer.unref();})]);
    assert.deepEqual(result,Engine.analyze(list,ctx));assert.equal(subject.getStats().failed,1);
  }finally{subject.dispose();}
});

test('bounded queue rejection yields so retrying callers cannot starve worker messages',async()=>{
  const subject=runtime({workerFactory:()=>({postMessage(){},terminate(){}}),yieldTask:()=>new Promise(resolve=>setImmediate(resolve))});
  const active=subject.computeAsync(rows(),{}),queued=Array.from({length:8},()=>subject.computeAsync(rows(),{}));
  let taskRan=false;setImmediate(()=>{taskRan=true;});
  assert.equal(await subject.computeAsync(rows(),{}),null);assert.equal(taskRan,true);
  subject.dispose();await active;await Promise.all(queued);
});
test('a cancelled worker\'s late load error is handled and never reaches the global error banner',async()=>{
  // Field/UI acceptance: a CP refresh cancels the running worker; its interrupted
  // importScripts then fired an unhandled error shown as a red "JS HATA" banner.
  let worker;const prevented=[],list=rows(),context={today:20000};
  const subject=runtime({workerFactory:()=>(worker={postMessage(){},terminate(){}})});
  const pending=subject.computeAsync(list,context);
  worker.onerror({preventDefault(){prevented.push('running');}});
  assert.deepEqual((await pending).orders,Engine.analyze(list,context).orders,'handled failure falls back to the canonical engine');
  worker.onerror({preventDefault(){prevented.push('terminated');}});
  assert.deepEqual(prevented,['running','terminated']);subject.dispose();
});
