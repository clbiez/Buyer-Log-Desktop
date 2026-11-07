'use strict';
const assert=require('node:assert/strict'),vm=require('node:vm'),source=require('./server-source')();
module.exports=async function captureBacklogRequest(query,route='/api/backlog-export'){
  const start=source.indexOf(`app.get('${route}'`),end=source.indexOf('\n});',start);assert.ok(start>=0&&end>start);
  let handler,captured,prepared=false,sent=false;
  const context={app:{get:(_path,_guard,fn)=>{handler=fn;}},userAccess:{requireArea:area=>{assert.equal(area,'backlog');return null;}},
    assertSourceFilters:targets=>assert.deepEqual(Array.from(targets),['backlog']),prepareComputeBacklog:async()=>{await new Promise(setImmediate);prepared=true;},
    sourceUserId:()=> 'demo',sourceFilterReadiness:()=>({ready:true}),pageProjectionContext:()=>({id:'demo',contextHash:'ctx'}),
    pageProjectionCache:{readBacklog:async()=>null},backlogCacheKey:()=> 'synthetic-query',
    computeReads:{run:async(_req,area,task,parts,options)=>{assert.equal(prepared,true);assert.equal(area,'backlog');captured={task,parts:structuredClone(parts),options:structuredClone(options)};return {value:{buffer:new ArrayBuffer(1)}};}},
    sendComputedResponse:()=>{sent=true;},apiError:(_res,error)=>{throw error;}};
  vm.createContext(context);vm.runInContext(source.slice(start,end+4),context);await handler({query,currentUser:{id:'demo'}},{});
  assert.equal(sent,true);assert.ok(captured);return captured;
};
