'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm');
const source=require('./helpers/server-source')(),{extractFunction}=require('./helpers/app-main-functions');
function fixture(){
 const f={runtime:{loadedAt:'synthetic-loaded'},calls:[],options:null};
 const pinned={activeGeneration:'page-one',contextHash:'page-context',sourceLoadedAt:'synthetic-loaded',sourceRevisionKey:'revision-one',
  moduleInputKeys:{orders:'input-one'},sourceProjectionKeys:{orders:'projection-one'},modules:{orders:{checksum:'a'.repeat(64),uncompressedBytes:128}}};
 f.current=structuredClone(pinned);f.context={id:'synthetic-owner',contextHash:pinned.contextHash};f.full={manifest:pinned,meta:pinned.modules.orders};
 const router={readyBackground:{close(){f.calls.push(['ready-close']);}}};
 const cache={loadManifest:owner=>{f.calls.push(['manifest',owner]);return f.current;},
  writeViewCompressed:(...args)=>{f.calls.push(['publish',...args]);return 'native-write';}};
 const guard={},sourceFor=profile=>{f.calls.push(['source',profile]);return 'actual-source';};
 const contextFor=profile=>{f.calls.push(['context',profile]);return f.context;};
 const send=()=>{},apiError=()=>{},filters=()=>{};
 const scope={Object,Error,pageProjectionCache:cache,computeReadGuard:guard,computeSourceFor:sourceFor,pageProjectionContext:contextFor,
  assertSourceFilters:filters,sendComputedResponse:send,apiError,express:{Router(){}},
  cacheForUser:owner=>{f.calls.push(['runtime',owner]);return f.runtime;},
  pageProjectionMatchesRuntime:(manifest,runtime,module)=>{f.calls.push(['runtime-match',manifest,runtime,module]);return f.runtimeMatches!==false;},
  serverCompute:()=>({run:(...args)=>{f.calls.push(['run',...args]);return 'actual-pool';}}),
  logRuntimeFailure:(...args)=>f.calls.push(['error',...args]),
  require:name=>{assert.equal(name,'./lib/orders-ready-http');return {createOrdersReadyRouter(options){f.options=options;return router;}};}};
 vm.createContext(scope);
 vm.runInContext(['assertOrdersReadyCacheCurrent','createOrdersReadyRouterForServer'].map(name=>extractFunction(source,name)).join('\n'),scope);
 f.scope=scope;f.router=scope.createOrdersReadyRouterForServer();f.cache=cache;f.guard=guard;f.sourceFor=sourceFor;f.contextFor=contextFor;f.send=send;f.apiError=apiError;f.filters=filters;
 return f;
}
test('actual server installs the bounded ready router without replacing ordinary full/shadow routes',()=>{
 const position=source.indexOf("app.use('/api/page-projection', ordersReadyRouter);");assert.ok(position>0);
 assert.ok(source.includes("const ordersReadyRouter=createOrdersReadyRouterForServer();"));
 assert.ok(source.includes("app.get('/api/page-projection/:module'"));assert.ok(source.includes('createProjectionShadowRouter'));
 const narrow=source.indexOf("app.use('/api/page-projection', express.json({ limit: '64kb' }));");
 assert.ok(narrow>0&&narrow<source.indexOf("app.use(express.json({ limit: '100mb' }));"));
});
test('actual server factory retains the live guard, native owner cache and one existing pool',()=>{
 const f=fixture(),o=f.options;assert.equal(o.cache,f.cache);assert.equal(o.guard,f.guard);assert.equal(o.sourceFor,f.sourceFor);
 assert.equal(o.contextFor,f.contextFor);assert.equal(o.send,f.send);assert.equal(o.apiError,f.apiError);assert.equal(o.assertSourceFilters,f.filters);
 const signal=new AbortController().signal,opts={signal,priority:'background'},payload={synthetic:true};
 assert.equal(o.runTask('projection-ready-orders','descriptor',payload,opts),'actual-pool');assert.deepEqual(f.calls.at(-1),['run','projection-ready-orders','descriptor',payload,opts]);
 const live=()=>{};assert.equal(o.publishReady('owner','orders','pin','entry',{assertCurrent:live}),'native-write');
 assert.equal(f.calls.at(-1)[5].assertCurrent,live,'final writer receives the actual live callback');
});
test('actual server cache guard accepts the exact current source and checks runtime before serving',()=>{
 const f=fixture();assert.doesNotThrow(()=>f.options.assertCachedCurrent({},f.context,f.full));
 const matched=f.calls.find(c=>c[0]==='runtime-match');assert.equal(matched[1],f.current);assert.equal(matched[2],f.runtime);assert.equal(matched[3],'orders');
});
test('every actual parent pin must still match even when generation or gzip bytes alone are unchanged',()=>{
 const mutations=[m=>{m.activeGeneration='other';},m=>{m.contextHash='other';},m=>{m.sourceLoadedAt='other';},m=>{m.sourceRevisionKey='other';},
  m=>{m.moduleInputKeys.orders='other';},m=>{m.sourceProjectionKeys.orders='other';},m=>{m.modules.orders.checksum='b'.repeat(64);},m=>{m.modules.orders.uncompressedBytes++;}];
 for(const mutate of mutations){const f=fixture();mutate(f.current);assert.throws(()=>f.options.assertCachedCurrent({},f.context,f.full),{code:'PROJECTION_VIEW_STALE',statusCode:409});}
});
test('missing source/current manifest, context mismatch and superseded runtime fail closed',()=>{
 for(const mutate of [f=>{f.current=null;},f=>{f.full=null;},f=>{f.runtimeMatches=false;},f=>{f.context={...f.context,contextHash:'other'};}]){
  const f=fixture();mutate(f);assert.throws(()=>f.options.assertCachedCurrent({},f.context,f.full),{code:'PROJECTION_VIEW_STALE',statusCode:409});
 }
});
test('shutdown stops ready background work before closing the shared pool, including dual signals',async()=>{
 const start=source.indexOf('let computeShutdownPromise;'),end=source.indexOf("process.on('SIGTERM', shutdownComputeRuntime);",start)+"process.on('SIGTERM', shutdownComputeRuntime);".length;
 const calls=[],signals=new Map();let finishReady,finishPool;
 const scope={process:{on:(name,fn)=>signals.set(name,fn),exit:code=>calls.push(['exit',code]),exitCode:0},
  httpServer:{close:()=>calls.push(['http'])},computeReads:{clear:()=>calls.push(['reads'])},
  ordersReadyRouter:{readyBackground:{close:()=>{calls.push(['ready']);return new Promise(resolve=>{finishReady=resolve;});}}},
  closeComputeService:()=>{calls.push(['pool']);return new Promise(resolve=>{finishPool=resolve;});},runtimePressureMonitor:null,
  logRuntimeFailure:()=>calls.push(['error']),cleanupOrphanExcel:()=>calls.push(['excel']),setTimeout:()=>({unref(){}}),clearTimeout(){}};
 vm.createContext(scope);vm.runInContext(source.slice(start,end),scope);
 const pending=signals.get('SIGTERM')();signals.get('SIGINT')();await new Promise(setImmediate);
 assert.equal(calls.filter(c=>c[0]==='ready').length,1);assert.equal(calls.some(c=>c[0]==='pool'),false);assert.equal(calls.some(c=>c[0]==='exit'),false);
 finishReady();await new Promise(setImmediate);assert.equal(calls.filter(c=>c[0]==='pool').length,1);assert.equal(calls.some(c=>c[0]==='exit'),false);
 finishPool();await pending;assert.deepEqual(calls.at(-1),['exit',0]);
});

function ordinaryGetSeam(){
 const f={calls:[],lease:{cacheState:'hit',manifest:{activeGeneration:'actual-generation'},value:{buffer:Buffer.from('native-lease-shape')},release(){f.calls.push('release');}}};
 f.bound={...f.lease,assertResponse(){f.calls.push('bound-guard');}};
 const start=source.indexOf("app.get('/api/page-projection/:module',"),end=source.indexOf('\n// Explicit private',start);
 assert.ok(start>=0&&end>start);
 const scope={String,app:{get(route,handler){assert.equal(route,'/api/page-projection/:module');f.handler=handler;}},
  PAGE_PROJECTION_AREAS:{orders:'orders',cp:'cp'},PAGE_PROJECTION_TARGETS:{orders:['orders'],cp:['cp']},
  userAccess:{hasArea:(profile,area)=>profile.areas.includes(area)},sourceFilterReadiness:()=>({ready:true}),
  ensureComputedProjection:async(req,module)=>{f.calls.push(['acquire',module]);return f.lease;},
  ordersReadyRouter:{bindOrdinaryFullResponse(req,lease){f.calls.push(['bind',req,lease]);if(f.bindingFailure){lease.release();throw f.bindingFailure;}return {lease:f.bound,headers:{'X-Orders-Binding-Version':'1'}};}},
  sendComputedResponse:(req,res,lease,options)=>{f.calls.push(['send',lease,options]);return res;},
  apiError:(res,error)=>{f.error=error;return res;}};
 vm.createContext(scope);vm.runInContext(source.slice(start,end),scope);
 f.request=module=>{const res={status(value){f.status=value;return res;},json(value){f.json=value;return res;}};
  return f.handler({params:{module},currentUser:{areas:['orders','cp']}},res);};return f;
}
test('actual ordinary GET seam uses the bound Orders lease and retains CP original response path',async()=>{
 const orders=ordinaryGetSeam();await orders.request('orders');assert.equal(orders.calls.filter(c=>c[0]==='bind').length,1);
 const sent=orders.calls.find(c=>c[0]==='send');assert.equal(sent[1],orders.bound);assert.equal(sent[1].value,orders.lease.value);
 assert.equal(sent[2].headers['X-Orders-Binding-Version'],'1');assert.equal(sent[2].headers['X-Page-Cache'],'hit');assert.equal(sent[2].headers['X-Page-Cache-Generation'],'actual-generation');
 const cp=ordinaryGetSeam();await cp.request('cp');assert.equal(cp.calls.some(c=>c[0]==='bind'),false);assert.equal(cp.calls.find(c=>c[0]==='send')[1],cp.lease);
 assert.equal(cp.calls.find(c=>c[0]==='send')[2].headers['X-Orders-Binding-Version'],undefined);
});
test('actual ordinary GET seam localizes expected Orders binding errors without changing global apiError',async()=>{
 const f=ordinaryGetSeam();f.bindingFailure=Object.assign(Error('stale binding'),{code:'PROJECTION_VIEW_STALE',statusCode:409});
 await f.request('orders');assert.equal(f.error,undefined);assert.equal(f.status,409);assert.equal(f.json.code,'PROJECTION_VIEW_STALE');
 assert.equal(f.json.error,'Sipariş verisi değişti. Görünümü yeniden yükleyin.');assert.equal(f.json.errorEn,'Orders data changed. Reload the view.');
 assert.equal(f.calls.filter(c=>c==='release').length,1);assert.equal(f.calls.some(c=>c[0]==='send'),false);
 const unexpected=ordinaryGetSeam();unexpected.bindingFailure=Object.assign(Error('unexpected IO failure'),{code:'EIO'});
 await unexpected.request('orders');assert.equal(unexpected.error,unexpected.bindingFailure);assert.equal(unexpected.status,undefined);
});
