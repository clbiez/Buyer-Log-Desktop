'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {extractBlock,createClient,summarize,validateCampaign}=require('./diagnose.cjs');
const fixture=require('./fixture.json');
const {runClientContracts}=require('./contracts.cjs');

test('source extraction fails closed on missing or ambiguous anchors',()=>{
  assert.equal(extractBlock('aSTARTbodyENDz','START','END'),'STARTbody');
  assert.throws(()=>extractBlock('STARTbody','START','END'));
  assert.throws(()=>extractBlock('STARTxENDSTARTyEND','START','END'));
});
test('shared rows preserve scope, generation and source detail variants; only grouping shares',async()=>{
  let calls=0;
  const client=createClient('shared',async()=>({ok:true,json:async()=>({rows:[{id:++calls}],rowsRevision:String(calls)})}));
  const p={format:'json',scope:fixture.scope,generation:fixture.generation,includeSourceDetails:'0'};
  const a=await client.rows.loadData(p);
  assert.equal(await client.rows.loadData({...p,groupBy:'season'}),a);
  for(const variant of [{scope:'demo-buyer-b'},{generation:'demo-generation-2'},{includeSourceDetails:'1'}]){
    assert.notEqual(await client.rows.loadData({...p,...variant}),a);
  }
  assert.equal(calls,4);
});
test('baseline deduplicates pending consumers and invalidation leaves their transport alive',async()=>{
  let resolve,calls=0,signal;
  const client=createClient('shared',(_url,options)=>{calls++;signal=options.signal;return new Promise(r=>{resolve=r;});});
  const a=client.rows.loadData({q:'a'}),b=client.rows.loadData({q:'a',groupBy:'buyer'});
  assert.equal(a,b);assert.equal(calls,1);
  client.rows.invalidate();assert.equal(signal,undefined);
  resolve({ok:true,json:async()=>({rows:[{id:'demo'}]})});
  assert.equal((await a).rows,(await b).rows);
});
test('plan generation keeps final query while still parsing the older response',async()=>{
  const pending=[];
  const client=createClient('plan',url=>new Promise(resolve=>pending.push({url,resolve})));
  const old=client.start({analysisFilters:'demo-old'}),latest=client.start({analysisFilters:'demo-final'});
  const finish=i=>pending[i].resolve({ok:true,json:async()=>({queryToken:new URL(pending[i].url,'http://localhost').searchParams.get('analysisFilters'),rows:[]})});
  finish(1);await latest;finish(0);await old;
  assert.equal(client.result(),'demo-final');assert.equal(pending.length,2);
});
test('closing overview leaves a shared chart consumer alive on the exact current source',async()=>{
  let resolve,calls=0;
  const client=createClient('shared',()=>{calls++;return new Promise(r=>{resolve=r;});});
  const query={analysisFilters:'demo-final'},pending=client.start(query);
  // Let both real async consumers subscribe before the close.
  await Promise.resolve();await Promise.resolve();
  const consumer=client.rows.loadData(query);
  client.closeOverview();
  resolve({ok:true,json:async()=>({rows:[{_ana12Query:'demo-final'}]})});
  await pending;assert.equal((await consumer).rows[0]._ana12Query,'demo-final');
  assert.deepEqual(client.result(),{overview:'demo-final',chart:'demo-final'});assert.equal(calls,1);
});
test('three per arm, same fixture/source, no overlap and exact final results are mandatory',()=>{
  const run=(arm,index)=>({arm,index,scenario:'plan',fixtureSha:'fixture',sourceHashes:{main:'same-892'},startedAtMs:index*2,endedAtMs:index*2+1,correctFinal:true,metrics:{requests:10,peakActiveRequests:10,parsedBytes:100,staleParsedBytes:90,parseMs:3,processCpuMs:5,wallMs:10,aborts:0,signals:0}});
  const runs=Array.from({length:6},(_,i)=>run(i%2?'after-preparation':'before-preparation',i));
  validateCampaign(runs,['plan']);
  assert.equal(summarize(runs).plan['before-preparation'].requests,10);
  assert.throws(()=>validateCampaign(runs.slice(1),['plan']));
  assert.throws(()=>validateCampaign(runs.map((r,i)=>i===5?{...r,fixtureSha:'different'}:r),['plan']));
  assert.throws(()=>validateCampaign(runs.map((r,i)=>i===5?{...r,sourceHashes:{main:'different'}}:r),['plan']));
  assert.throws(()=>validateCampaign(runs.map((r,i)=>i===5?{...r,startedAtMs:0}:r),['plan']));
  assert.throws(()=>validateCampaign(runs.map((r,i)=>i===5?{...r,correctFinal:false}:r),['plan']));
});
test('future cancellation contract rejects the actual uncancellable baseline',async()=>{
  await assert.rejects(runClientContracts(async()=>{
    const requests=[];
    const client=createClient('shared',(_url,options)=>new Promise(resolve=>requests.push({signal:options.signal,resolve})));
    return {requests,subscribe:p=>({promise:client.rows.loadData(p),release(){}}),flush:async()=>{},dispose:async()=>{for(const r of requests)r.resolve({ok:true,json:async()=>({rows:[]})});}};
  }),/signal/);
});
