'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),http=require('node:http');
const {createRequestLifecycle}=require('../public/backlog-request-lifecycle');
const {keyForQuery,identity,deferred}=require('./fixtures/ana12-request-lifecycle/controlled.cjs');

test('last release aborts a real fetch during body read and closes incomplete loopback HTTP',{timeout:5000},async t=>{
  const reading=deferred(),readAborted=deferred(),closed=deferred();
  const server=http.createServer((_req,res)=>{
    res.on('close',()=>closed.resolve(!res.writableFinished));
    res.setHeader('Content-Type','application/json');res.write('{"rows":[');
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));});
  let signal,published=0,fetches=0;
  const lifecycle=createRequestLifecycle({keyForQuery,isCurrent:()=>true,publish(){published++;},
    async request(_params,context){
      signal=context.signal;fetches++;
      const response=await fetch(`http://127.0.0.1:${server.address().port}/synthetic`,{signal});
      return {ok:response.ok,status:response.status,async text(){
        const pending=response.text();reading.resolve();
        try{return await pending;}catch(error){readAborted.resolve(error.name);throw error;}
      }};
    }
  });
  t.after(()=>lifecycle.dispose());
  const a=lifecycle.subscribe({q:'demo'},identity()),b=lifecycle.subscribe({q:'demo'},identity());
  await reading.promise;assert.equal(fetches,1);
  a.release();assert.equal(signal.aborted,false);b.release();assert.equal(signal.aborted,true);
  for(const subscription of [a,b])await assert.rejects(subscription.promise,{name:'AbortError'});
  assert.equal(await readAborted.promise,'AbortError','native Response.text must observe actual fetch abort');
  assert.equal(await closed.promise,true,'server observes an incomplete HTTP response');
  assert.equal(published,0);assert.equal(lifecycle.inFlight,0);
});

test('normal loopback completion matches an independent uncancelled full-response oracle',{timeout:5000},async t=>{
  const expected={rows:[{id:'DEMO-1',quantity:17,source:{id:'DEMO-SOURCE'}},{id:'DEMO-2',quantity:3}],headers:['id','quantity'],rowsRevision:'demo-r1',merchCalendar:{weeks:['2026-45']},total:20};
  const server=http.createServer((_req,res)=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(expected));});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));});
  const url=`http://127.0.0.1:${server.address().port}/synthetic`,oracle=await (await fetch(url)).json();let signal,fetches=0;
  const lifecycle=createRequestLifecycle({keyForQuery,isCurrent:()=>true,request(_params,context){signal=context.signal;fetches++;return fetch(url,{signal});}});
  t.after(()=>lifecycle.dispose());
  const a=lifecycle.subscribe({q:'demo',groupBy:'buyer'},identity()),b=lifecycle.subscribe({q:'demo',groupBy:'season'},identity());
  const [first,second]=await Promise.all([a.promise,b.promise]);
  assert.deepEqual(first,oracle);assert.deepEqual(first,expected);assert.equal(first,second);assert.equal(fetches,1);
  a.release();b.release();assert.equal(signal.aborted,false);assert.equal(lifecycle.inFlight,0);
});
