'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {harness,identity,deferred,flush,keyForQuery}=require('./fixtures/ana12-request-lifecycle/controlled.cjs');
const {runClientContracts}=require('./fixtures/ana12-request-lifecycle/preparation/contracts.cjs');
const aborted=promise=>assert.rejects(promise,{name:'AbortError'});

test('all five unchanged #895 client contracts pass through the standalone adapter',async()=>{
  const results=await runClientContracts(async()=>{
    const f=harness();
    return {requests:f.requests,flush,subscribe:params=>f.subscribe(params,identity({scope:params.scope,generation:params.generation})),dispose:()=>f.lifecycle.dispose()};
  });
  assert.equal(results.length,5);
});
test('grouping consumers share one body read, complete object graph and one publication',async()=>{
  const f=harness(),a=f.subscribe({q:'demo',groupBy:'buyer'}),b=f.subscribe({q:'demo',groupBy:'season'});
  await flush();assert.equal(f.requests.length,1);assert.equal(f.lifecycle.inFlight,1);
  const expected={rows:[{id:'DEMO-1',quantity:3,details:{source:'synthetic'}}],headers:['id','quantity'],rowsRevision:'r1',merchCalendar:{weeks:[1]}};
  f.requests[0].respond(expected);
  const [x,y]=await Promise.all([a.promise,b.promise]);
  assert.deepEqual(x,expected);assert.equal(x,y);assert.equal(x.rows,y.rows);assert.equal(x.rows[0].details,y.rows[0].details);
  assert.equal(f.requests[0].textReads,1);assert.equal(f.published.length,1);assert.equal(f.published[0].body,x);
  assert.equal(f.lifecycle.inFlight,0);a.release();b.release();assert.equal(f.requests[0].signal.aborted,false);
  // Completed results belong to BLBacklogRows, never to a second helper cache.
  const next=f.subscribe({q:'demo'});await flush();assert.equal(f.requests.length,2);next.release();await aborted(next.promise);
});
test('closing one panel rejects only its subscription while the remaining panel completes',async()=>{
  const f=harness(),a=f.subscribe(),b=f.subscribe(),cancelled=aborted(a.promise);
  await flush();a.release();a.release();await cancelled;
  assert.equal(f.requests[0].signal.aborted,false);
  f.requests[0].respond({rows:[{id:'DEMO-survivor'}]});assert.equal((await b.promise).rows[0].id,'DEMO-survivor');
  b.release();assert.equal(f.requests[0].signal.aborted,false);
});
test('ten rapid panel queries release only that panel; another consumer retains the first flight',async()=>{
  const f=harness(),other=f.subscribe({q:'demo-0'}),all=[];let panel;
  for(let i=0;i<10;i++){
    panel?.release();panel=f.subscribe({q:'demo-'+i});all.push(panel);panel.promise.catch(()=>{});await flush();
  }
  assert.equal(f.requests.length,10);assert.equal(f.requests[0].signal.aborted,false);
  assert.ok(f.requests.slice(1,9).every(r=>r.signal.aborted));assert.equal(f.requests[9].signal.aborted,false);
  f.requests[9].respond({rows:[{id:'DEMO-final',quantity:17}],rowsRevision:'final'});
  assert.deepEqual(await panel.promise,{rows:[{id:'DEMO-final',quantity:17}],rowsRevision:'final'});
  f.requests[0].respond({rows:[{id:'DEMO-other-panel'}]});assert.equal((await other.promise).rows[0].id,'DEMO-other-panel');
  await Promise.allSettled(all.map(s=>s.promise));assert.equal(f.published.length,2);assert.equal(f.lifecycle.inFlight,0);
});
test('scope, user, session, generation, revision and source details never share',async()=>{
  const f=harness(),subscriptions=[f.subscribe()];
  for(const patch of [{scope:'demo-b'},{user:'demo-b'},{session:'demo-b'},{generation:2},{revision:'demo-r2'}])subscriptions.push(f.subscribe({q:'demo'},identity(patch)));
  subscriptions.push(f.subscribe({q:'demo',includeSourceDetails:'1'}));
  await flush();assert.equal(f.requests.length,7);
  subscriptions[0].release();assert.equal(f.requests[0].signal.aborted,true);assert.ok(f.requests.slice(1).every(r=>!r.signal.aborted));
  f.requests.slice(1).forEach((r,i)=>r.respond({rows:[{id:'DEMO-'+i}]}));await Promise.allSettled(subscriptions.map(s=>s.promise));
  assert.equal(f.published.length,6);
});
test('source details remain distinct even when an adapter key omits them',async()=>{
  const f=harness({keyForQuery:()=> 'same-query'}),a=f.subscribe({includeSourceDetails:'0'}),b=f.subscribe({includeSourceDetails:'1'});
  await flush();assert.equal(f.requests.length,2);a.release();b.release();await Promise.allSettled([a.promise,b.promise]);
});
test('invalid or incomplete local identities fail before transport; identity types stay distinct',async()=>{
  const f=harness();
  for(const name of ['scope','user','session','generation','revision']){
    const invalid=identity();delete invalid[name];assert.throws(()=>f.subscribe({},invalid),TypeError);
  }
  assert.throws(()=>f.subscribe({},identity({generation:NaN})),TypeError);
  const a=f.subscribe({},identity({generation:1})),b=f.subscribe({},identity({generation:'1'}));
  await flush();assert.equal(f.requests.length,2);a.release();b.release();await Promise.allSettled([a.promise,b.promise]);
});
test('last subscriber leaving during preparation prevents transport; preparation rejection is shared',async()=>{
  const gate=deferred(),f=harness({prepare:()=>gate.promise}),a=f.subscribe(),b=f.subscribe();
  a.release();b.release();gate.resolve();await Promise.allSettled([a.promise,b.promise]);await flush();
  assert.equal(f.requests.length,0);assert.equal(f.lifecycle.inFlight,0);
  const error=Error('synthetic pivot preparation failure'),g=harness({prepare:()=>Promise.reject(error)}),c=g.subscribe(),d=g.subscribe();
  for(const result of await Promise.allSettled([c.promise,d.promise]))assert.equal(result.reason,error);
  assert.equal(g.requests.length,0);assert.equal(g.lifecycle.inFlight,0);
});
test('one panel leaving shared preparation preserves the remaining subscriber and its transport',async()=>{
  const gate=deferred();let preparations=0;
  const f=harness({prepare:()=>{preparations++;return gate.promise;}}),a=f.subscribe(),b=f.subscribe();
  await flush();a.release();await aborted(a.promise);assert.equal(f.requests.length,0);assert.equal(f.lifecycle.inFlight,1);
  gate.resolve();await flush();assert.equal(preparations,1);assert.equal(f.requests.length,1);
  f.requests[0].respond({rows:[{id:'DEMO-after-preparation'}]});assert.equal((await b.promise).rows[0].id,'DEMO-after-preparation');
});
test('current rowsQueryKey retains its exact exclusions, order and detail variants',()=>{
  assert.equal(keyForQuery({q:'x',format:'json'}),keyForQuery({format:'json',q:'x',groupBy:'buyer',antrepoDateLevels:'week',lazyDimensions:'1'}));
  for(const variant of [{analysisFilters:'W6'},{includeSourceDetails:'1'},{scope:'b'},{generation:2},{revision:'r2'}])assert.notEqual(keyForQuery({q:'x'}),keyForQuery({q:'x',...variant}));
});
