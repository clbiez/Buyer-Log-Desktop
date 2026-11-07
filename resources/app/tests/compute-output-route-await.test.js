'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const register=require('../server/routes/lcwai-routes');
for(const [path,method] of [['/api/lcwai/outputs/table','createTable'],['/api/lcwai/output-drafts/:id/render','renderDraft'],['/api/lcwai/outputs/:pendingId/images','completeImages']])
test(`${path} waits for Office completion and rechecks the live session before publishing`,async()=>{
 const routes=new Map(),app={};for(const method of ['get','post','patch','put','delete'])app[method]=(path,...handlers)=>routes.set(path,handlers.at(-1));
 let live={id:'a',enabled:true,status:'ACTIVE',accessRevision:1},complete,guard,response,status=200;
 const outputService={[method]:(...args)=>{guard=method==='completeImages'?args[4]?.assertCurrent:args.at(-1)?.assertCurrent;return new Promise(resolve=>{complete=resolve;});}};
 register(app,{express:{json:()=>null,raw:()=>null},userAccess:{sessionProfile:()=>live,appendAudit(){}},outputService});
 const res={set:()=>res,status:value=>{status=value;return res;},json:value=>{response=value;return res;}},req={currentUser:{...live},body:{data:{}},params:{id:'demo',pendingId:'demo'}};
 const pending=routes.get(path)(req,res);assert.equal(response,undefined);assert.equal(typeof guard,'function');
 live=null;complete(method==='renderDraft'?{output:{format:'xlsx',path:'Synthetic private file'}}:{format:'xlsx',path:'Synthetic private file'});await pending;
 assert.equal(response.ok,false);assert.equal(response.code,'LCWAI_CANCELLED');assert.doesNotMatch(JSON.stringify(response),/Synthetic private file/);assert.ok(status>=400);
 live={id:'a',enabled:true,status:'ACTIVE',accessRevision:1};response=undefined;req.currentUser={...live};
 const second=routes.get(path)(req,res);live.accessRevision=2;complete(method==='renderDraft'?{output:{format:'xlsx'}}:{format:'xlsx'});await second;assert.equal(response.ok,false);assert.equal(response.code,'LCWAI_CANCELLED');
});
