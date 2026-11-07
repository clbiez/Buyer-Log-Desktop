'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm');
const source=require('./helpers/server-source')();
test('map detail route requires Backlog authority, bounds selection and delegates an exact identity request',async()=>{
 const start=source.indexOf("app.post('/api/backlog-map-details'");assert.ok(start>0);
 let handler,area,job,sent,prepared=0,status;
 const sandbox={app:{post:(_route,...handlers)=>{handler=handlers.at(-1);}},userAccess:{requireArea:value=>{area=value;}},
  assertSourceFilters:targets=>assert.deepEqual(Array.from(targets),['backlog']),prepareComputeBacklog:async()=>{prepared++;},
  computeReads:{run:async(_req,scope,task,parts)=>{job={scope,task,parts};return {value:{buffer:new ArrayBuffer(1)}};}},sendComputedResponse:(_req,_res,lease)=>{sent=lease;},apiError:(_res,error)=>{throw error;}};
 vm.runInNewContext(source.slice(start,source.indexOf('\n});',start)+4),sandbox);
 const res={status:value=>{status=value;return res;},json:()=>res};
 await handler({body:{identities:[],sourceRevision:'r1'}},res);assert.equal(status,400);assert.equal(prepared,0);assert.equal(job,undefined);
 await handler({body:{identities:Array(5001).fill({}),sourceRevision:'r1'}},res);assert.equal(status,400);assert.equal(job,undefined);
 await handler({body:{identities:[{orderCode:101,modelName:'Demo',colourCode:'01',fallback:{secret:'forged'}}],sourceRevision:'r1'},currentUser:{id:'a'}},res);
 assert.equal(area,'backlog');assert.equal(job.scope,'backlog');assert.equal(job.task,'backlog-map-details');assert.equal(job.parts.expectedSourceRevision,'r1');assert.equal(job.parts.target,'backlog');assert.equal(job.parts.includeSourceDetails,true);assert.equal(job.parts.selector.identities[0].fallback,undefined);assert.ok(sent);
});
