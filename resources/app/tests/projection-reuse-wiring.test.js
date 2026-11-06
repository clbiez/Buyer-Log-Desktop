'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),vm=require('node:vm');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'bl-projection-wiring-'));process.env.BUYER_LOG_LOCAL_DATA_ROOT=root;
const pageProjectionCache=require('../server/lib/page-projection-cache'),derivedInputKeys=require('../server/lib/derived-input-keys'),backlogPlanActual=require('../server/lib/backlog-plan-actual');
const source=fs.readFileSync(path.join(__dirname,'../server/server.js'),'utf8');
function fn(name){const start=source.indexOf(`function ${name}(`),asyncStart=source.indexOf(`async function ${name}(`);const at=asyncStart>=0?asyncStart:start;assert.ok(at>=0);return source.slice(at,source.indexOf('\n}',at)+2);}
test.after(()=>fs.rmSync(root,{recursive:true,force:true}));
test('incremental date/delivery edits retain logistics without reintroducing Orders priority',()=>{
  const parseLib=require('../server/lib/parse'),c={parseLib};vm.createContext(c);
  vm.runInContext(fn('applyIncrementalProjectionPatch')+'\nglobalThis.patch=applyIncrementalProjectionPatch;',c);
  const row={'Order Code':1000,'Order Quantity':20,'Remaining Units':20,'Ex-factory':'2026-10-06','Retail Date':'2026-10-20',Country:'Turkey',Priority:'old'};
  const cp={...row},orders={...row},patch={dates:{exFactory:'2026-10-07'},delType:'Gemi'};
  c.patch(cp,patch,{});c.patch(orders,patch,{},false);
  assert.ok(cp.Priority);assert.equal(Object.hasOwn(orders,'Priority'),false);
  delete cp.Priority;assert.deepEqual(orders,cp);
});
test('source identity survives appended Excel telemetry and unrelated LFL metadata, but rejects new source publications',()=>{
  const crypto=require('node:crypto');const c={crypto,WeakSet,JSON};vm.createContext(c);
  vm.runInContext([fn('stableHashValue'),fn('projectionSourceRevision')].join('\n')+'\nglobalThis.key=projectionSourceRevision;',c);
  const r={loadedAt:'published',sources:{asas:'A',antrepo:'B',lfl:'old'},excelRefresh:{operations:[]}},key=c.key(r);
  r.excelRefresh.operations.push({phase:'backlog-snapshot',ms:100});r.sources.lfl='new';assert.equal(c.key(r),key);
  r.loadedAt='next';assert.notEqual(c.key(r),key);
});
test('actual server orchestration skips unchanged builders and rebuilds only changed target modules',async()=>{
  let builds=0,scope='authorized',currentRuntime,prepared=false;const build=rows=>{builds++;return rows.map(r=>({qty:r.qty}));};
  const context={APP_VERSION:'test',process,Set,Map,Buffer,pageProjectionCache,derivedInputKeys,
    userAccess:{prepareComputeAccessContext:async()=>{await new Promise(setImmediate);prepared=true;}},
    pageProjectionContext:()=>{assert.equal(prepared,true);return {id:'u',contextHash:scope,filterStatus:{ready:true}};},effectiveOverridesForUser:()=>({}),
    pageCacheRuntimeMeta:r=>({loadedAt:r.loadedAt}),projectionSourceRevision:r=>r.loadedAt,
    ordersForTarget:(r,t)=>r.asasOrdersByTarget?.[t]||r.asasOrders,antrepoForTarget:()=>({}),
    buildCPRowsFromASAS:build,buildOrdersRowsFromASAS:build,buildOrderSummaryRowsFromASAS:build,buildOverviewSummaryRowsFromASAS:build,
    buildCollectionCatalogs:rows=>({qty:rows.map(r=>r.qty)}),loadModelConnections:()=>({items:[]}),COLLECTION_CATALOG_SCHEMA_VERSION:2,
    buildSharedOrderProjectionRowsFromASAS:rows=>({cp:build(rows),orders:build(rows)}),logRuntimeFailure:(_name,e)=>{throw e;}};
  // Native worker mechanics and parser equivalence are covered separately. This
  // fixture keeps the original builder counters at the orchestration boundary.
  context.computeSourceToken=()=>currentRuntime.loadedAt;
  context.computeSourceFor=async()=>({runtime:currentRuntime});
  context.computeParamsFor=(_profile,descriptor,_task,parts)=>({...parts,runtime:descriptor.runtime});
  context.serverCompute=()=>({run:async(_task,_descriptor,params)=>{
    const r=params.runtime,cp=r.asasOrdersByTarget?.cp||r.asasOrders,orders=r.asasOrdersByTarget?.orders||r.asasOrders,values={},wanted=new Set(params.modules);
    if(wanted.has('cp'))values.cp={rows:build(cp).map(row=>({...row,_canEdit:true})),cpModelColumns:[]};
    if(wanted.has('orders'))values.orders={rows:build(orders).map(row=>({...row,_canEdit:false}))};
    if(wanted.has('overview'))values.overview={rows:build(cp)};
    if(wanted.has('order-summary'))values['order-summary']={rows:build(cp).map(row=>({...row,_canEdit:true}))};
    if(wanted.has('collection-catalog')){const catalogRows=values.orders?.rows||JSON.parse(require('node:zlib').gunzipSync(Buffer.from(params.catalogOrdersBuffer))).rows;values['collection-catalog']={catalogs:context.buildCollectionCatalogs(catalogRows),catalogSchemaVersion:2};}
    const compressed=Object.fromEntries(Object.entries(values).map(([module,value])=>{const json=Buffer.from(JSON.stringify(value)),gz=require('node:zlib').gzipSync(json);return [module,{buffer:Uint8Array.from(gz).buffer,uncompressedBytes:json.length}];}));
    return {value:{compressed},metrics:{},release(){}};
  }});
  vm.createContext(context);vm.runInContext([fn('sameProjectionSourceRows'),fn('buildCpAndOrdersProjectionRows'),fn('buildAndWritePageProjectionCache'),fn('buildAndWriteComputedPageProjectionCache')].join('\n')+'\nglobalThis.run=buildAndWritePageProjectionCache;',context);
  const actualRun=context.run;context.run=(profile,runtime)=>{currentRuntime=runtime;prepared=false;return actualRun(profile,runtime);};
  const runtime={loadedAt:'old',asasOrders:[{qty:1}],asasOrdersByTarget:{cp:[{qty:2}],orders:[{qty:3}],backlog:[{qty:4}]}};
  const first=await context.run(null,runtime);assert.equal(builds,4);
  const copy=JSON.parse(JSON.stringify(runtime));copy.loadedAt='fresh';
  const warm=await context.run(null,copy);assert.equal(builds,4);assert.equal(warm.activeGeneration,first.activeGeneration);assert.equal(warm.sourceLoadedAt,'fresh');
  await pageProjectionCache.writeBacklog('u',scope,'same-filter',{qty:4});
  assert.equal((await pageProjectionCache.readBacklog('u',scope,'same-filter')).data.qty,4);
  copy.asasOrdersByTarget.backlog[0].qty=40;
  const backlogChanged=await context.run(null,copy);assert.equal(builds,4);
  assert.equal(backlogChanged.activeGeneration,first.activeGeneration);
  assert.notEqual(backlogChanged.backlogInputKey,warm.backlogInputKey);
  assert.equal(await pageProjectionCache.readBacklog('u',scope,'same-filter'),null,'old variant cannot return from the backup manifest');
  copy.asasOrdersByTarget.cp[0].qty=20;copy.loadedAt='changed';
  const changed=await context.run(null,copy);assert.equal(builds,7);assert.equal(changed.modules.orders.checksum,first.modules.orders.checksum);
  assert.equal((await pageProjectionCache.readProjection('u','cp',scope)).data.rows[0].qty,20);
  assert.equal((await pageProjectionCache.readProjection('u','orders',scope)).data.rows[0].qty,3);
  scope='new-authorized-context';await context.run(null,copy);assert.equal(builds,11);
});
test('actual Backlog capture stores the input key and preserves a new marker without rebuilding identical records',async()=>{
  let builds=0;const context={APP_VERSION:'test',derivedInputKeys,backlogPlanActual,
    effectiveOverridesForUser:()=>({}),ordersForTarget:r=>r.asasOrders,antrepoForTarget:r=>r.antrepoMap,
    buildBacklogTemplateRows:()=>{builds++;return [{'Sipariş Kod':'O','Model Adı':'M','Renk Kod':'C',Renk:'Blue'}];}};
  vm.createContext(context);vm.runInContext(fn('captureBacklogPlanActualSnapshot')+'\nglobalThis.capture=captureBacklogPlanActualSnapshot;',context);
  const runtime={loadedAt:'first',asasOrders:[{ocode:'O',model:'M',ccode:'C',colour:'Blue',qty:10}],antrepoMap:{}};
  await context.capture('b',runtime);assert.equal(builds,1);assert.ok((await backlogPlanActual.readArchive('b')).inputKey);
  const clone=JSON.parse(JSON.stringify(runtime));clone.loadedAt='second';
  const second=await context.capture('b',clone);assert.equal(builds,1);assert.equal(second.reused,true);
  const archive=await backlogPlanActual.readArchive('b');assert.equal(backlogPlanActual.markerList(archive).length,2);assert.deepEqual(archive.deltas[0].upserts,[]);
  clone.asasOrders[0].qty=20;await context.capture('b',clone);assert.equal(builds,2);
});
