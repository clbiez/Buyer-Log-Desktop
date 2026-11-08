'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {harness,flush,identity,deferred}=require('./fixtures/ana12-request-lifecycle/controlled.cjs');
const aborted=promise=>assert.rejects(promise,{name:'AbortError'});

test('a cancelled flight cannot accept a new subscriber; late completion cannot delete its replacement',async()=>{
  const f=harness({ignoreAbort:true}),old=f.subscribe(),oldResult=aborted(old.promise);await flush();
  old.release();const current=f.subscribe();await oldResult;await flush();
  assert.equal(f.requests.length,2);assert.equal(f.requests[0].signal.aborted,true);assert.equal(f.requests[1].signal.aborted,false);
  f.requests[0].respond({rows:[{id:'DEMO-stale'}]});await flush();
  assert.equal(f.requests[0].textReads,0,'unstarted JSON/body read must not begin after last release');
  assert.equal(f.published.length,0);assert.equal(f.lifecycle.inFlight,1);
  const joined=f.subscribe();await flush();assert.equal(f.requests.length,2,'old finally cannot delete current flight');
  f.requests[1].respond({rows:[{id:'DEMO-new'}]});const [a,b]=await Promise.all([current.promise,joined.promise]);
  assert.equal(a,b);assert.equal(a.rows[0].id,'DEMO-new');assert.equal(f.published.length,1);assert.equal(f.lifecycle.inFlight,0);
});
test('abort after body read began blocks JSON parsing even if body transport ignores abort',async()=>{
  const f=harness({ignoreAbort:true,observeParse:true}),old=f.subscribe();await flush();f.requests[0].respond();await flush();
  assert.equal(f.requests[0].textReads,1);const result=aborted(old.promise);old.release();
  // Invalid JSON would throw SyntaxError if parsing began; stale subscriber stays aborted.
  f.requests[0].body.resolve('{invalid JSON');await result;await flush();
  assert.equal(f.parseCalls,0);assert.equal(f.published.length,0);assert.equal(f.lifecycle.inFlight,0);
});
test('body completion queued immediately before release cannot publish or parse',async()=>{
  const f=harness({observeParse:true}),s=f.subscribe();await flush();f.requests[0].respond();await flush();
  const result=aborted(s.promise);f.requests[0].body.resolve('{invalid JSON');s.release();await result;await flush();
  assert.equal(f.parseCalls,0);assert.equal(f.published.length,0);assert.equal(f.lifecycle.inFlight,0);
});
test('late failure from a cancelled flight cannot delete a new same-key flight',async()=>{
  const f=harness({ignoreAbort:true}),old=f.subscribe();await flush();old.release();await aborted(old.promise);
  const current=f.subscribe();await flush();f.requests[0].fail(Error('late synthetic transport failure'));await flush();
  const join=f.subscribe();await flush();assert.equal(f.requests.length,2);assert.equal(f.lifecycle.inFlight,1);
  f.requests[1].respond({rows:[{id:'DEMO-new'}]});assert.equal(await current.promise,await join.promise);
});
test('an abort listener can resubscribe to the same key before old cleanup finishes',async()=>{
  const f=harness({ignoreAbort:true}),old=f.subscribe();await flush();let next;
  f.requests[0].signal.addEventListener('abort',()=>{next=f.subscribe();},{once:true});
  old.release();await aborted(old.promise);await flush();
  assert.equal(f.requests.length,2);assert.equal(f.lifecycle.inFlight,1);
  f.requests[0].respond({rows:[{id:'DEMO-stale'}]});await flush();assert.equal(f.published.length,0);
  f.requests[1].respond({rows:[{id:'DEMO-next'}]});assert.equal((await next.promise).rows[0].id,'DEMO-next');
});
test('live generation and session gates stop stale publication without cancelling another identity',async()=>{
  let current=identity();const f=harness({ignoreAbort:true,isCurrent:captured=>Object.keys(current).every(k=>current[k]===captured[k])});
  const old=f.subscribe();await flush();f.requests[0].respond();await flush();
  current=identity({generation:2,session:'demo-next-session'});const next=f.subscribe({},current);await flush();
  f.requests[0].body.resolve(JSON.stringify({rows:[{id:'DEMO-stale'}]}));await aborted(old.promise);
  assert.equal(f.published.length,0);assert.equal(f.requests[1].signal.aborted,false);assert.equal(f.lifecycle.inFlight,1);
  f.requests[1].respond({rows:[{id:'DEMO-current'}]});await next.promise;assert.equal(f.published.length,1);
});
test('post-parse calendar readiness is shared and cancellation still guards publication',async()=>{
  const gate=deferred();let waits=0;
  const f=harness({beforePublish:()=>{waits++;return gate.promise;}}),old=f.subscribe(),other=f.subscribe();
  await flush();f.requests[0].respond({rows:[{id:'DEMO-stale'}]});await flush();
  assert.equal(waits,1);assert.equal(f.published.length,0,'existing calendar readiness must precede cache/calendar commit');
  old.release();other.release();await Promise.all([aborted(old.promise),aborted(other.promise)]);
  const current=f.subscribe();await flush();gate.resolve();await flush();
  assert.equal(f.published.length,0);assert.equal(f.lifecycle.inFlight,1);
  f.requests[1].respond({rows:[{id:'DEMO-current'}]});assert.equal((await current.promise).rows[0].id,'DEMO-current');
  assert.equal(f.published.length,1);
});
test('stale identity before start prevents fetch and a stale admission never joins a current flight',async()=>{
  let live=true;const f=harness({isCurrent:()=>live}),a=f.subscribe();await flush();live=false;
  const rejected=f.subscribe();await aborted(rejected.promise);assert.equal(f.requests.length,1);
  a.release();await aborted(a.promise);assert.equal(f.requests[0].signal.aborted,true);
  const g=harness({isCurrent:()=>false}),b=g.subscribe();await aborted(b.promise);assert.equal(g.requests.length,0);
});
test('transport, HTTP, JSON and publication failures release flight state and allow retry',async()=>{
  for(const failure of ['transport','http','json','publish']){
    const error=Error('synthetic publication failure'),f=harness({publish:()=>{if(failure==='publish')throw error;}}),a=f.subscribe(),b=f.subscribe();await flush();
    if(failure==='transport')f.requests[0].fail(Error('synthetic network failure'));
    else if(failure==='http')f.requests[0].respond({error:'synthetic forbidden'},{ok:false,status:403});
    else if(failure==='json'){f.requests[0].respond();f.requests[0].body.resolve('{invalid JSON');}
    else f.requests[0].respond({rows:[]});
    const results=await Promise.allSettled([a.promise,b.promise]);
    assert.ok(results.every(r=>r.status==='rejected'));assert.equal(results[0].reason,results[1].reason);
    if(failure==='http')assert.match(results[0].reason.message,/synthetic forbidden/);
    if(failure==='json')assert.equal(results[0].reason.name,'SyntaxError');
    assert.equal(f.lifecycle.inFlight,0);const retry=f.subscribe();await flush();assert.equal(f.requests.length,2);retry.release();await aborted(retry.promise);
  }
});
test('even a transport rejection without an Error stays rejected and cannot publish',async()=>{
  for(const reason of [undefined,null,false,0,'']){
    const f=harness(),s=f.subscribe();await flush();f.requests[0].fail(reason);
    const [result]=await Promise.allSettled([s.promise]);
    assert.equal(result.status,'rejected');assert.equal(result.reason,reason);
    assert.equal(f.published.length,0);assert.equal(f.lifecycle.inFlight,0);
  }
});
test('dispose aborts each pending flight once, rejects all subscribers and prevents further subscriptions',async()=>{
  const f=harness(),a=f.subscribe(),b=f.subscribe(),c=f.subscribe({q:'another'});await flush();
  f.lifecycle.dispose();f.lifecycle.dispose();await Promise.all([a,b,c].map(s=>aborted(s.promise)));
  assert.ok(f.requests.every(r=>r.signal.aborted));assert.equal(f.lifecycle.inFlight,0);assert.throws(()=>f.subscribe(),/disposed/i);
});
