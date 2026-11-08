'use strict';
// Executable Phase 7 assertions. This file supplies no cancellation implementation.
const assert=require('node:assert/strict');
const base=Object.freeze({query:'demo-query',scope:'demo-buyer-a',generation:'demo-g1',includeSourceDetails:'0'});

// Adapter supplied by the future production integration, using controlled fetch:
// subscribe(params) -> {promise, release()}, release must be idempotent.
// requests -> [{signal, resolve(body)}]; flush() drains async preparation.
// reset() clears state between independent scenarios, publish() is observed by adapter.
// Real HTTP/pool/CPU assertions remain separate; a fake backend cannot pass those gates.
async function runClientContracts(makeAdapter){
  const results=[];
  const check=async(name,body)=>{const a=await makeAdapter();try{await body(a);results.push(name);}finally{await a.dispose();}};
  await check('two subscribers: only last release aborts, and release is idempotent',async a=>{
    const x=a.subscribe(base),y=a.subscribe({...base,groupBy:'season'});
    const settled=Promise.allSettled([x.promise,y.promise]);await a.flush();assert.equal(a.requests.length,1);
    assert.ok(a.requests[0].signal);x.release();assert.equal(a.requests[0].signal.aborted,false);
    x.release();assert.equal(a.requests[0].signal.aborted,false);y.release();assert.equal(a.requests[0].signal.aborted,true);await settled;
  });
  await check('one subscriber closes; the other gets the full response',async a=>{
    const x=a.subscribe(base),y=a.subscribe(base),settled=Promise.allSettled([x.promise,y.promise]);await a.flush();
    x.release();assert.equal(a.requests[0].signal.aborted,false);
    a.requests[0].resolve({rows:[{id:'DEMO-1'}],rowsRevision:'demo-r1'});
    assert.deepEqual((await y.promise).rows,[{id:'DEMO-1'}]);await settled;y.release();assert.equal(a.requests[0].signal.aborted,false,'normal completion is not cancellation');
  });
  await check('single subscriber normal completion does not emit abort',async a=>{
    const x=a.subscribe(base);await a.flush();a.requests[0].resolve({rows:[{id:'DEMO-1'}]});await x.promise;x.release();
    assert.equal(a.requests[0].signal.aborted,false);
  });
  await check('scope/generation/query/details variants never share a transport',async a=>{
    const params=[base,{...base,scope:'demo-buyer-b'},{...base,generation:'demo-g2'},{...base,query:'demo-other'},{...base,includeSourceDetails:'1'}];
    const subscriptions=params.map(p=>a.subscribe(p)),settled=Promise.allSettled(subscriptions.map(s=>s.promise));await a.flush();assert.equal(a.requests.length,5);
    subscriptions[0].release();assert.equal(a.requests[0].signal.aborted,true);assert.ok(a.requests.slice(1).every(r=>!r.signal.aborted));
    a.requests.slice(1).forEach((r,i)=>r.resolve({rows:[{id:`DEMO-${i}`}]}));await settled;subscriptions.slice(1).forEach(s=>s.release());
  });
  await check('ten filter changes cancel obsolete transports and preserve the final response',async a=>{
    const all=[];let current;
    for(let i=0;i<10;i++){current?.release();current=a.subscribe({...base,query:`demo-${i}`});all.push(current);current.promise.catch(()=>{});await a.flush();}
    assert.equal(a.requests.length,10);assert.ok(a.requests.slice(0,9).every(r=>r.signal.aborted));assert.equal(a.requests[9].signal.aborted,false);
    a.requests[9].resolve({rows:[{id:'DEMO-final'}]});assert.deepEqual((await current.promise).rows,[{id:'DEMO-final'}]);
    await Promise.allSettled(all.map(s=>s.promise));current.release();
  });
  return results;
}
module.exports={base,runClientContracts};
