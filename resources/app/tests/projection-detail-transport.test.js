'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { createDetailFetcher } = require('../public/projection-detail-transport');
const token = () => ({ ownerId:'owner', actorId:'actor', module:'cp', sourceGeneration:'g1', sourceRevision:'r1',
  moduleInputKey:'i1', sourceProjectionKey:'s1', accessHash:'a1', contextHash:'c1', planRevision:'p1', requestGeneration:'q1' });
const request = changes => ({ token:token(), records:[{ordinal:0,handle:'h0'}], maxBytes:4096, ...changes });
const detail = () => ({profile:'cp-orders-full-details-v1',complete:true,token:token(),records:[{ordinal:0,handle:'h0',row:{label:'Sentetik İplik',zero:0,flag:false}}]});
function response(bytes, {chunks=7, status=200, onRead=()=>{}}={}) {
  bytes=typeof bytes==='string'?Buffer.from(bytes):bytes;let offset=0,cancelled=0,released=0,jsonCalls=0;
  return {ok:status>=200&&status<300,status,headers:new Headers({'Content-Type':'application/json','Content-Encoding':'gzip','Content-Length':'1'}),
    body:{getReader(){return {async read(){onRead();if(offset>=bytes.length)return {done:true};const value=bytes.subarray(offset,offset+=chunks);return {done:false,value};},async cancel(){cancelled++;},releaseLock(){released++;}};}},
    json(){jsonCalls++;throw Error('Unbounded response.json is forbidden');},
    stats:()=>({cancelled,released,jsonCalls})};
}
const rejects=(promise,code)=>assert.rejects(promise,error=>error.code===code);

test('bounded decoded stream preserves native JSON values and split UTF-8 without using compressed Content-Length as a budget',async()=>{
  let call;const body=response(JSON.stringify(detail()),{chunks:1});
  const fetcher=createDetailFetcher({isCurrent:()=>true,fetchImpl:async(url,options)=>{call={url,options};return body;}});
  const input=request(),result=await fetcher(input);
  assert.deepEqual(result,detail());assert.equal(call.url,'/api/page-projection/cp/details');assert.equal(call.options.method,'POST');
  assert.equal(call.options.credentials,'same-origin');assert.equal(call.options.cache,'no-store');
  assert.deepEqual(JSON.parse(call.options.body),{token:input.token,records:input.records,maxBytes:input.maxBytes});
  assert.deepEqual(body.stats(),{cancelled:0,released:1,jsonCalls:0});
});

test('decoded response overflow cancels the reader and never retries the request',async()=>{
  let calls=0;const body=response(' '.repeat(8192),{chunks:1024});
  const fetcher=createDetailFetcher({isCurrent:()=>true,fetchImpl:async()=>{calls++;return body;}});
  await rejects(fetcher(request()),'DETAIL_RESPONSE_TOO_LARGE');assert.equal(calls,1);
  assert.deepEqual(body.stats(),{cancelled:1,released:1,jsonCalls:0});
});

test('caller can lower the decoded budget but cannot raise the fixed transport limit',async()=>{
  let calls=0;const body=response(' '.repeat(513));
  const fetcher=createDetailFetcher({isCurrent:()=>true,fetchImpl:async()=>{calls++;return body;}});
  await rejects(fetcher(request({maxBytes:512})),'DETAIL_RESPONSE_TOO_LARGE');
  await rejects(fetcher(request({maxBytes:4*1024*1024+1})),'INVALID_DETAIL_REQUEST');assert.equal(calls,1);
});

test('stale context before submission admits no fetch; stale context while reading cannot publish parsed data',async()=>{
  let current=false,calls=0;const body=response(JSON.stringify(detail()),{onRead:()=>{current=false;}});
  const fetcher=createDetailFetcher({isCurrent:()=>current,fetchImpl:async()=>{calls++;return body;}});
  await rejects(fetcher(request()),'STALE_CONTEXT');assert.equal(calls,0);
  current=true;await rejects(fetcher(request()),'STALE_CONTEXT');assert.equal(calls,1);
  assert.deepEqual(body.stats(),{cancelled:1,released:1,jsonCalls:0});
});

test('already-aborted subscribers admit no fetch; late noncooperative response is discarded',async()=>{
  const controller=new AbortController();let calls=0;const body=response(JSON.stringify(detail()));
  const fetcher=createDetailFetcher({isCurrent:()=>true,fetchImpl:async()=>{calls++;controller.abort();return body;}});
  await rejects(fetcher(request({signal:controller.signal})),'ABORTED');assert.equal(calls,1);
  await rejects(fetcher(request({signal:controller.signal})),'ABORTED');assert.equal(calls,1);
});

test('server denial retains its code and status without converting to complete or empty details',async()=>{
  const fetcher=createDetailFetcher({isCurrent:()=>true,fetchImpl:async()=>response(JSON.stringify({code:'AREA_FORBIDDEN',error:'Erişim yok',errorEn:'Access denied'}),{status:403})});
  await assert.rejects(fetcher(request()),error=>error.code==='AREA_FORBIDDEN'&&error.statusCode===403&&error.errorEn==='Access denied');
});

test('a transport without a bounded reader fails instead of allocating response.json or arrayBuffer',async()=>{
  let unbounded=0;const fetcher=createDetailFetcher({isCurrent:()=>true,fetchImpl:async()=>({ok:true,status:200,body:null,
    json(){unbounded++;},arrayBuffer(){unbounded++;}})});
  await rejects(fetcher(request()),'DETAIL_STREAM_UNAVAILABLE');assert.equal(unbounded,0);
});

test('invalid module, oversized record count, duplicate ordinal and excessive request JSON admit no fetch',async()=>{
  let calls=0;const fetcher=createDetailFetcher({isCurrent:()=>true,fetchImpl:async()=>{calls++;throw Error('Unexpected network');}});
  for(const input of [request({token:{...token(),module:'other'}}),request({records:Array.from({length:129},(_,ordinal)=>({ordinal,handle:'x'}))}),
    request({records:[{ordinal:0,handle:'a'},{ordinal:0,handle:'b'}]}),request({records:[{ordinal:0,handle:'x'.repeat(70000)}]})])
    await rejects(fetcher(input),'INVALID_DETAIL_REQUEST');
  assert.equal(calls,0);
});
