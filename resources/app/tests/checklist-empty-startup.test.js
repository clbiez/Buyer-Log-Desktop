'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),express=require('express');
const register=require('../server/routes/checklist-supplier-routes');

test('empty checklist startup skips Orders models and rechecks area after async storage read',async()=>{
  let area=true,authorityCalls=0,denyDuringRead=false;
  let saved={definitions:[{id:'definition'}],answers:{},tombstones:{}};
  const app=express();app.use((req,_res,next)=>{req.currentUser={id:'demo',status:'ACTIVE'};next();});
  const store={_readAsync:async()=>{if(denyDuringRead)area=false;return saved;},publicPayload:(allowed,value)=>({definitions:value.definitions,
    answers:Object.fromEntries(Object.entries(value.answers).filter(([,answer])=>allowed.has(answer.orderKey))),
    tombstones:Object.fromEntries(Object.entries(value.tombstones).filter(([,answer])=>allowed.has(answer.orderKey)))})};
  register(app,{express,checklistSupplierStore:store,automationError:(res,error)=>res.status(error.statusCode||500).json({code:error.code}),
    userAccess:{requireAnyArea:()=> (_req,res,next)=>area?next():res.sendStatus(403),sessionProfile:()=>({id:'demo',status:'ACTIVE'}),hasArea:()=>area},
    authorizedOrders:async()=>{authorityCalls++;return new Map([['allowed',{}]]);},authorizedOrdersNow:()=>new Map([['allowed',{}]])});
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  const url='http://127.0.0.1:'+server.address().port+'/api/checklist-supplier';
  try{
    assert.deepEqual(await (await fetch(url)).json(),saved);assert.equal(authorityCalls,0);
    saved={...saved,tombstones:{keep:{orderKey:'allowed'},hide:{orderKey:'forbidden'}}};
    const result=await (await fetch(url)).json();assert.deepEqual(result.tombstones,{keep:{orderKey:'allowed'}});assert.equal(authorityCalls,1);
    saved={...saved,tombstones:{}};denyDuringRead=true;assert.equal((await fetch(url)).status,403);assert.equal(authorityCalls,1);
  }finally{await new Promise(resolve=>server.close(resolve));}
});
