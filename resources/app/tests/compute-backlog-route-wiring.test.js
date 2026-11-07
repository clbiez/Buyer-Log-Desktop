'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm');
const source=require('./helpers/server-source')();
const paths=['/api/backlog','/api/backlog-source-columns','/api/backlog-export','/api/backlog-filter-values'];
function block(route){
  const start=source.indexOf(`app.get('${route}'`);assert.ok(start>0);let next=source.indexOf('\n});',start);assert.ok(next>start);return source.slice(start,next+4);
}
for(const route of paths)test(`${route} delegates its heavy computation and ready response to the common pool`,async()=>{
  let handler,task,sent;const forbidden=()=>{throw Error('Main thread traversal is forbidden');};
  const context={app:{get:(_route,_guard,fn)=>handler=fn},userAccess:{requireArea:()=>null,filterRowsByScope:(_profile,rows)=>rows},
    assertSourceFilters(){},sourceUserId:()=> 'a',sourceFilterReadiness:()=>({ready:true}),cacheForUser:()=>({asasOrders:[]}),
    ensureBacklogSourceFields:async()=>{},ensureBacklogRuntime:async()=>{},ensureDataLoaded:async()=>{},prepareComputeBacklog:async()=>{},
    pageProjectionContext:()=>({id:'a',contextHash:'ctx'}),pageProjectionCache:{readBacklog:async()=>null},backlogCacheKey:()=> 'key',
    effectiveOverridesForUser:()=>({}),loadOverrides:()=>({}),backlogQueryForRequest:forbidden,ordersForTarget:forbidden,
    antrepoForTarget:()=>({}),BACKLOG_TEMPLATE_HEADERS:[],parseLib:{backlogCustomDimensionContext:forbidden},
    computeReads:{run:async(_req,_area,name,parts)=>{task={name,parts};return {value:{buffer:new ArrayBuffer(2)},release(){},assertResponse(){}};}},
    sendComputedResponse:(_req,_res,lease,options)=>{sent={lease,options};},apiError:(_res,error)=>{throw error;}};
  vm.createContext(context);vm.runInContext(block(route),context);
  await handler({query:{format:'json'},currentUser:{id:'a'}},{});
  const expected={'/api/backlog':'backlog-grouped','/api/backlog-source-columns':'backlog-source-columns','/api/backlog-export':'backlog-export','/api/backlog-filter-values':'backlog-filter-values'};
  assert.equal(task.name,expected[route]);assert.ok(sent.lease.value.buffer instanceof ArrayBuffer);
});
