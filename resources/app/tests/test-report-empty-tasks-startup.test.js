'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),express=require('express');
const store=require('../server/lib/test-reports/store');
const register=require('../server/routes/test-report-routes');

test('empty startup tasks avoid Orders construction; nonempty tasks retain current row authorization',async()=>{
  const original=store.tasks;let tasks=[],authorityCalls=0,areaCalls=0,areaAllowed=true;
  store.tasks=()=>tasks;
  const app=express();app.use((req,_res,next)=>{req.currentUser={id:'synthetic'};next();});
  register(app,{express,automationError:(res,error)=>res.status(500).json({error:error.message}),
    userAccess:{requireAnyArea:()=> (_req,res,next)=>{areaCalls++;if(areaAllowed)next();else res.sendStatus(403);},appendAudit(){}},
    authorizedOrders:async()=>{authorityCalls++;return new Map([['allowed',{}]]);}});
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  const url='http://127.0.0.1:'+server.address().port+'/api/test-reports/tasks';
  try{
    const empty=await fetch(url);assert.deepEqual(await empty.json(),{tasks:[]});
    assert.equal(empty.headers.get('cache-control'),'no-store');assert.equal(authorityCalls,0);assert.equal(areaCalls,1);
    tasks=[{orderKey:'allowed',itemId:'test'},{orderKey:'forbidden',itemId:'other'}];
    assert.deepEqual(await (await fetch(url)).json(),{tasks:[tasks[0]]});assert.equal(authorityCalls,1);
    tasks=[];areaAllowed=false;assert.equal((await fetch(url)).status,403);assert.equal(authorityCalls,1);
  }finally{store.tasks=original;await new Promise(resolve=>server.close(resolve));}
});
