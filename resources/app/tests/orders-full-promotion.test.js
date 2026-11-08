'use strict';
// Native full-before-use ownership, bounds, ordinal and cancellation contracts.
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {create,readDecodedBytes}=require('../public/orders-full-promotion.js');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const encode=rows=>Buffer.from(JSON.stringify({rows}));
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
function fixture(options={}){
  const raw=options.raw||[
    {'Order Code':7,'Model Name':'Duplicate','C.Code':'A',__CPX_HIDDEN:0,nullable:null,flag:false},
    {'Order Code':7,'Model Name':'Duplicate','C.Code':'A',__CPX_HIDDEN:12,nullable:null,flag:false},
  ];
  const bytes=encode(raw),identity={ownerId:'buyer-a',sessionId:'session-a',sourceId:'source-a',generation:'generation-a',accessHash:'access-a',scopeHash:'scope-a',module:'orders',planHash:'plan-a',fullProjectionChecksum:sha(bytes),fullByteLength:bytes.length,rowCount:raw.length};
  const thin=raw.map(({__CPX_HIDDEN,...row})=>row);
  let state={kind:'thin',identity,rows:thin,ordinals:thin.map((_,index)=>index),selectedRows:thin.length?[thin.at(-1)]:[],requiredKeys:['Order Code','nullable','flag'],mutationRevision:1,selectionRevision:1,dirty:false};
  let calls=0,publishes=0,requestSignal,contextCurrent=true;
  const gate=deferred(),started=deferred();
  const coordinator=create({snapshot:()=>state,maxFullBytes:options.maxFullBytes,maxRows:options.maxRows,
    fetchFull:async(id,{signal,maxDecodedBytes})=>{calls++;requestSignal=signal;started.resolve();assert.equal(id.module,'orders');assert.equal(maxDecodedBytes,id.fullByteLength);return gate.promise;},
    normalize:options.normalize||((rows,{ordinals})=>({rows:rows.map(row=>({...row,_canEdit:false})),ordinals:[...ordinals]})),
    isCurrent:(captured,id)=>contextCurrent&&(options.isCurrent?options.isCurrent(captured,id,state):true),
    publish:(next,{assertCurrent,expected})=>{assertCurrent();assert.equal(state,expected);publishes++;state=next;return next;},
  });
  return {coordinator,raw,thin,identity,bytes,gate,started,
    response:()=>({identity:{...identity},bytes:new Uint8Array(bytes)}),
    resolve(value){gate.resolve(value||this.response());},get state(){return state;},set state(value){state=value;},
    get calls(){return calls;},get publishes(){return publishes;},get requestSignal(){return requestSignal;},
    revoke(){contextCurrent=false;}};
}
test('ordinary full source passes through exact state and row references without fetching',async()=>{
  const f=fixture();f.state={...f.state,kind:'full'};
  const state=f.state,result=await f.coordinator.ensure();
  assert.equal(result.state,state);assert.equal(result.rows,state.rows);assert.equal(result.selectedRows,state.selectedRows);assert.equal(result.remapRows(state.selectedRows),state.selectedRows);assert.equal(f.calls,0);
});
test('ordinary legacy full source does not require thin transport metadata',async()=>{
  const f=fixture();f.state={...f.state,kind:'full'};delete f.state.identity;delete f.state.ordinals;
  const previous=f.state,result=await f.coordinator.ensure();assert.equal(result.state,previous);assert.equal(result.rows,previous.rows);assert.equal(f.calls,0);
});
test('hard byte, row and identity-string caps reject before fetch or allocation',async()=>{
  for(const [key,value]of [['fullByteLength',128*1024*1024+1],['rowCount',50001],['sessionId','s'.repeat(1025)],['sourceId','s'.repeat(1025)]]){
    const f=fixture();f.state.identity={...f.identity,[key]:value};await assert.rejects(f.coordinator.ensure());assert.equal(f.calls,0);assert.equal(f.publishes,0);
  }
});
test('configuration can lower admission limits but cannot raise hard caps',async()=>{
  for(const options of [{maxFullBytes:16},{maxRows:1}]){
    const f=fixture(options);await assert.rejects(f.coordinator.ensure(),{code:'ORDERS_FULL_TOO_LARGE'});assert.equal(f.calls,0);
  }
  for(const options of [{maxFullBytes:128*1024*1024+1},{maxRows:50001},{maxRows:0},{maxFullBytes:NaN}])assert.throws(()=>fixture(options),{code:'ORDERS_FULL_LIMIT'});
});
test('transport output length must exactly match admitted decoded bytes',async()=>{
  const f=fixture(),pending=f.coordinator.ensure();pending.catch(()=>{});await f.started.promise;
  const response=f.response();response.bytes=new Uint8Array(f.bytes.length+1);f.resolve(response);
  await assert.rejects(pending,{code:'ORDERS_FULL_BYTES'});assert.equal(f.publishes,0);
});
test('bounded decoded stream rejects overflow before retaining or reading more chunks',async()=>{
  let reads=0,cancels=0,releases=0;
  const response={arrayBuffer(){throw Error('unbounded full-body read forbidden');},body:{getReader:()=>({
    read:async()=>{reads++;return {done:false,value:new Uint8Array(3)};},cancel(){cancels++;},releaseLock(){releases++;},
  })}};
  await assert.rejects(readDecodedBytes(response,{maxDecodedBytes:5}),{code:'ORDERS_FULL_BYTES'});
  assert.equal(reads,2);assert.equal(cancels,1);assert.equal(releases,1);
});
test('bounded decoded stream assembles exact bytes and rejects truncation',async()=>{
  for(const expected of [4,5]){
    const parts=[Uint8Array.from([1,2]),Uint8Array.from([3,4])];let i=0;
    const response={body:{getReader:()=>({read:async()=>i<parts.length?{done:false,value:parts[i++]}:{done:true},cancel(){},releaseLock(){}})}};
    if(expected===4)assert.deepEqual(await readDecodedBytes(response,{maxDecodedBytes:expected}),Uint8Array.from([1,2,3,4]));
    else await assert.rejects(readDecodedBytes(response,{maxDecodedBytes:expected}),{code:'ORDERS_FULL_BYTES'});
  }
});
test('decoded stream cancellation releases a pending read without accepting a partial body',async()=>{
  const read=deferred(),controller=new AbortController();let cancelled=0,released=0;
  const response={body:{getReader:()=>({read:()=>read.promise,cancel(){cancelled++;read.resolve({done:true});},releaseLock(){released++;}})}};
  const pending=readDecodedBytes(response,{maxDecodedBytes:20,signal:controller.signal});pending.catch(()=>{});controller.abort();
  await assert.rejects(pending,{name:'AbortError'});assert.equal(cancelled,1);assert.equal(released,1);
});
test('whole module promotes once and preserves duplicate business IDs by original ordinal',async()=>{
  const f=fixture(),before=JSON.stringify(f.thin),selected=f.state.selectedRows;
  const one=f.coordinator.ensure(),two=f.coordinator.ensure();await f.started.promise;f.resolve();
  const [a,b]=await Promise.all([one,two]);
  assert.equal(a,b);assert.equal(f.calls,1);assert.equal(f.publishes,1);assert.equal(a.rows[0].__CPX_HIDDEN,0);assert.equal(a.rows[1].__CPX_HIDDEN,12);
  assert.equal(a.selectedRows[0],a.rows[1]);assert.deepEqual(a.remapRows(selected),[a.rows[1]]);assert.equal(f.state.rows,a.rows);assert.equal(JSON.stringify(f.thin),before);
  assert.ok(f.thin.every(row=>!Object.hasOwn(row,'__CPX_HIDDEN')));assert.equal(a.rows[0].nullable,null);assert.equal(a.rows[0].flag,false);
  const again=await f.coordinator.ensure();assert.equal(again.rows,a.rows);assert.equal(f.calls,1);
});
test('235 selections require one full request and zero detail reparses',async()=>{
  const f=fixture({raw:Array.from({length:235},(_,index)=>({'Order Code':7,nullable:null,flag:false,__CPX_HIDDEN:index}))});
  f.state.selectedRows=f.thin.slice();const pending=f.coordinator.ensure();await f.started.promise;f.resolve();const result=await pending;
  assert.equal(f.calls,1);assert.equal(result.selectedRows.length,235);assert.deepEqual(result.selectedRows.map(row=>row.__CPX_HIDDEN),Array.from({length:235},(_,i)=>i));
});
test('reordered thin source and normalization map only by original ordinals',async()=>{
  const f=fixture({normalize:(rows,{ordinals})=>({rows:rows.slice().reverse(),ordinals:ordinals.slice().reverse()})});
  f.state.rows=[f.thin[1],f.thin[0]];f.state.ordinals=[1,0];f.state.selectedRows=[f.thin[1]];
  const pending=f.coordinator.ensure();await f.started.promise;f.resolve();const result=await pending;
  assert.equal(result.selectedRows[0].__CPX_HIDDEN,12);assert.equal(result.remapRows([f.thin[0]])[0].__CPX_HIDDEN,0);
  assert.throws(()=>result.remapRows([{'Order Code':7}]),{code:'ORDERS_FULL_SELECTION'});
});
for(const key of ['ownerId','sessionId','sourceId','generation','accessHash','scopeHash','module','planHash','fullProjectionChecksum','fullByteLength','rowCount']){
  test(`changed ${key} during fetch fails closed before publication`,async()=>{
    const f=fixture(),pending=f.coordinator.ensure();pending.catch(()=>{});await f.started.promise;
    const original=f.response();f.state={...f.state,identity:{...f.identity,[key]:typeof f.identity[key]==='number'?f.identity[key]+1:'different'}};
    f.resolve(original);await assert.rejects(pending);assert.equal(f.publishes,0);assert.equal(f.state.rows,f.thin);
  });
  test(`response ${key} must match the exact requested full artifact`,async()=>{
    const f=fixture(),pending=f.coordinator.ensure();pending.catch(()=>{});await f.started.promise;
    const response=f.response();response.identity[key]=typeof response.identity[key]==='number'?response.identity[key]+1:'different';
    f.resolve(response);await assert.rejects(pending);assert.equal(f.publishes,0);
  });
}
test('same business IDs and claimed checksum cannot authenticate changed full bytes',async()=>{
  const f=fixture(),pending=f.coordinator.ensure();pending.catch(()=>{});await f.started.promise;
  const response=f.response(),text=Buffer.from(response.bytes).toString().replace('__CPX_HIDDEN":12','__CPX_HIDDEN":99');response.bytes=Buffer.from(text);
  assert.equal(response.bytes.length,f.bytes.length);f.resolve(response);await assert.rejects(pending,{code:'ORDERS_FULL_CHECKSUM'});assert.equal(f.publishes,0);
});
test('one subscriber abort does not cancel the other consumer or shared fetch',async()=>{
  const f=fixture(),controller=new AbortController(),one=f.coordinator.ensure({signal:controller.signal}),two=f.coordinator.ensure();one.catch(()=>{});
  await f.started.promise;controller.abort();assert.equal(f.requestSignal.aborted,false);f.resolve();
  await assert.rejects(one,{name:'AbortError'});const result=await two;assert.equal(result.rows.length,2);assert.equal(f.calls,1);assert.equal(f.publishes,1);
});
test('last subscriber abort before dispatch prevents the queued full request',async()=>{
  const f=fixture(),controller=new AbortController(),pending=f.coordinator.ensure({signal:controller.signal});pending.catch(()=>{});
  controller.abort();f.resolve();await assert.rejects(pending,{name:'AbortError'});await tick();assert.equal(f.calls,0);assert.equal(f.publishes,0);
});
test('last subscriber abort signals running fetch and blocks a late successful reply',async()=>{
  const f=fixture(),controller=new AbortController(),pending=f.coordinator.ensure({signal:controller.signal});pending.catch(()=>{});
  await f.started.promise;controller.abort();assert.equal(f.requestSignal.aborted,true);f.resolve();await assert.rejects(pending,{name:'AbortError'});await tick();assert.equal(f.publishes,0);assert.equal(f.state.rows,f.thin);
});
test('dirty state or tracked mutation during await cannot be overwritten',async()=>{
  for(const change of [f=>{f.state.dirty=true;},f=>{f.thin[0].nullable='edited';f.state.mutationRevision++;},f=>{f.state.selectionRevision++;},f=>{f.state.selectedRows=[f.thin[0]];},f=>f.revoke()]){
    const f=fixture(),pending=f.coordinator.ensure();pending.catch(()=>{});await f.started.promise;change(f);f.resolve();
    await assert.rejects(pending);assert.equal(f.publishes,0);assert.equal(f.state.rows,f.thin);
  }
});
test('mutation after fetch during async normalization prevents publication',async()=>{
  const normalizing=deferred(),continueNormalize=deferred();
  const f=fixture({normalize:async(rows,{ordinals})=>{normalizing.resolve();await continueNormalize.promise;return {rows,ordinals:[...ordinals]};}});
  const pending=f.coordinator.ensure();pending.catch(()=>{});await f.started.promise;f.resolve();await normalizing.promise;
  f.state.mutationRevision++;continueNormalize.resolve();await assert.rejects(pending);assert.equal(f.publishes,0);
});
test('all rows and own presence are validated, including the last row',async()=>{
  for(const raw of [[{'Order Code':1,nullable:null,flag:false},null],[{'Order Code':1,nullable:null,flag:false},{'Order Code':2,flag:false}]]){
    // Build the transport from malformed rows without using the fixture's thin transform.
    const f=fixture(),bytes=encode(raw);f.identity.fullProjectionChecksum=sha(bytes);f.identity.fullByteLength=bytes.length;
    const pending=f.coordinator.ensure();pending.catch(()=>{});await f.started.promise;f.resolve({identity:{...f.identity},bytes});await assert.rejects(pending,{code:'ORDERS_FULL_PRESENCE'});assert.equal(f.publishes,0);
  }
});
test('normalizer cannot drop full-row fields, duplicate ordinals, or borrow thin row references',async()=>{
  for(const mode of ['drop','ordinals','thin']){
    let f;f=fixture({normalize:(rows,{ordinals})=>{
      if(mode==='drop')delete rows.at(-1).__CPX_HIDDEN;
      return {rows:mode==='thin'?f.thin:rows,ordinals:mode==='ordinals'?[0,0]:[...ordinals]};
    }});
    const pending=f.coordinator.ensure();pending.catch(()=>{});await f.started.promise;f.resolve();await assert.rejects(pending);assert.equal(f.publishes,0);
  }
});
test('unknown selected reference and malformed thin ordinals fail before fetch',async()=>{
  for(const change of [f=>{f.state.selectedRows=[{...f.thin[0]}];},f=>{f.state.ordinals=[0,0];},f=>{f.state.ordinals=[0];}]){
    const f=fixture();change(f);f.resolve();await assert.rejects(f.coordinator.ensure());assert.equal(f.calls,0);assert.equal(f.publishes,0);
  }
});
test('returned guard refuses later source replacement before downstream side effects',async()=>{
  const f=fixture(),pending=f.coordinator.ensure();await f.started.promise;f.resolve();const result=await pending;
  f.state={...f.state,rows:f.state.rows.slice(),mutationRevision:2};assert.throws(()=>result.assertCurrent(),{code:'ORDERS_FULL_STALE'});
  assert.throws(()=>result.remapRows(f.thin),{code:'ORDERS_FULL_STALE'});
});
test('failed full request leaves every existing thin reference untouched',async()=>{
  const f=fixture(),before=JSON.stringify(f.thin),pending=f.coordinator.ensure();pending.catch(()=>{});await f.started.promise;
  f.gate.reject(new Error('synthetic transport failure'));await assert.rejects(pending,/synthetic transport/);assert.equal(f.publishes,0);assert.equal(f.state.rows,f.thin);assert.equal(JSON.stringify(f.thin),before);
});
