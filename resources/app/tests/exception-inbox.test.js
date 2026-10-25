'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),Inbox=require('../public/exception-inbox'),Fields=require('../public/canonical-fields'),Native=require('../public/cp-readiness-engine');
const row=(code,model='DEMO')=>({'Order Code':code,'Model Name':model,'C.Code':'01','Ex-factory':'2026-01-01','STATUS':'Üretimde','Order Quantity':25,'Remaining Units':25});
const options={fields:Fields,analyze:()=>({riskReasons:['EX_FACTORY_OVERDUE','DATE_SYNC_MISMATCH','MISSING_DATE']}),allowed:()=>true};
test('inbox exposes exactly two existing native reasons and deduplicates canonical order lines per reason',async()=>{
 const a=row('4100001'),result=await Inbox.project([a,{...a,_id:99},row('4100002')],options);assert.equal(result.total,4);assert.equal(result.counts.EX_FACTORY_OVERDUE,2);assert.equal(result.counts.DATE_SYNC_MISMATCH,2);assert.deepEqual([...new Set(result.items.map(item=>item.type))].sort(),Inbox.TYPES.slice().sort());
});
test('missing identity, denied scope and filtered rows cannot enter counts or item details',async()=>{
 const result=await Inbox.project([row(''),row('1','OTHER'),row('2')],{...options,filter:r=>r['Model Name']==='DEMO'});assert.equal(result.total,2);assert.equal((await Inbox.project([row('2')],{...options,allowed:()=>false})).total,0);
});
test('native engine determines overdue production; delivered or unknown dates are not invented exceptions',async()=>{
 const result=await Inbox.project([row('1'),{...row('2'),'Ex-factory':''},{...row('3'),STATUS:'Retail Depoda'}],{...options,analyze:r=>Native.analyzeOrder(r,{today:Native.defaultOrdinal('2026-10-25')})});assert.ok(result.items.some(item=>item.orderCode==='1'&&item.type==='EX_FACTORY_OVERDUE'));assert.equal(result.items.some(item=>item.orderCode==='2'),false);assert.equal(result.items.some(item=>item.orderCode==='3'&&item.type==='EX_FACTORY_OVERDUE'),false);
});
test('list limit never truncates canonical counts and async projection yields without retaining source rows',async()=>{
 let yields=0;const rows=Array.from({length:450},(_,i)=>row(String(i+1))),result=await Inbox.project(rows,{...options,limit:20,yield:async()=>{yields++;}});assert.equal(result.total,900);assert.equal(result.items.length,40);for(const type of Inbox.TYPES)assert.equal(result.items.filter(item=>item.type===type).length,20);assert.ok(yields>=2);assert.equal(Object.hasOwn(result.items[0],'row'),false);
});
test('aborted or revoked projection cannot publish partial scope',async()=>{
 let allowed=true;const result=await Inbox.project(Array.from({length:410},(_,i)=>row(String(i+1))),{...options,allowed:()=>allowed,yield:async()=>{allowed=false;}});assert.equal(result.cancelled,true);assert.equal(result.total,0);
});
test('only the latest confirmed response for the same user and scope can replace an inbox snapshot',()=>{
 const gate=Inbox.createGate(),a=gate.begin('alice','scope-a'),b=gate.begin('alice','scope-b');assert.equal(gate.accept(a,{total:0},'alice','scope-a'),false);assert.equal(gate.accept(b,{total:2},'bob','scope-b'),false);assert.equal(gate.accept(b,{total:2},'alice','scope-b'),true);assert.equal(gate.snapshot('alice','scope-b').total,2);assert.equal(gate.snapshot('bob','scope-b'),null);gate.clear();assert.equal(gate.snapshot('alice','scope-b'),null);
});
