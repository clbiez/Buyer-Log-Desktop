'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm');
const source=require('./helpers/server-source')();
const paths=['/api/page-projection/:module','/api/data/overview','/api/data/cp','/api/data/orders','/api/data/collection-catalog'];
for(const route of paths)test(`${route} serves through guarded compressed projections without main-thread snapshot parse`,async()=>{
  let handler,called,sent,status;
  const forbidden=()=>{throw Error('Main thread snapshot parse is forbidden');};
  const context={app:{get:(_route,...args)=>handler=args.at(-1)},userAccess:{requireArea:()=>null,hasArea:()=>true},
    sourceUserId:()=> 'a',sourceFilterReadiness:()=>({ready:true}),assertSourceFilters(){},cacheForUser:()=>({asasOrders:null}),ensureDataLoaded:forbidden,
    pageProjectionContext:()=>({id:'a',contextHash:'ctx'}),pageProjectionCache:{readProjectionCompressed:async()=>null,readProjection:async()=>null},pageProjectionMatchesRuntime:()=>true,
    PAGE_PROJECTION_AREAS:{cp:'cp'},PAGE_PROJECTION_TARGETS:{cp:['cp']},singleFlightPageProjection:(_profile,_module,builder)=>builder({id:'a'}),
    ensureComputedProjection:async(_req,module,options)=>{called={module,options};return {value:{buffer:new ArrayBuffer(1)},manifest:{activeGeneration:'new'},cacheState:'miss'};},
    sendComputedResponse:(_req,_res,lease)=>{sent=lease;},apiError:(_res,error)=>{throw error;}};
  const start=source.indexOf(`app.get('${route}'`);assert.ok(start>0);const end=source.indexOf('\n});',start)+4;
  vm.createContext(context);vm.runInContext(source.slice(start,end),context);
  const res={status:value=>{status=value;return res;},json:()=>{},set:()=>res};
  await handler({params:{module:'cp'},query:{},currentUser:{id:'a'}},res);
  const module=route==='/api/page-projection/:module'?'cp':route.split('/').at(-1);
  assert.equal(called?.module,module);assert.ok(sent?.value.buffer instanceof ArrayBuffer);assert.notEqual(status,404);
});
