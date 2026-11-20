'use strict';
/* WS3 (#1076): POST /api/read-model/orders/facets — Siparişler hızlı filtre
   sayaçları, sayım satırı ve sütun paneli değer listesi. Yetki, önbellek ve
   HTTP sözleşmesi /query ile aynı olmalı; görev yalnız orders modülünde geçerli. */
const test=require('node:test'),assert=require('node:assert/strict');
const zlib=require('node:zlib'),crypto=require('node:crypto');
const express=require('express');
const tasks=require('../server/lib/compute-tasks'),access=require('../server/lib/compute-access');
const worker=require('../server/lib/read-model/read-model-worker');
const {createReadModelService,TASKS}=require('../server/lib/read-model/read-model-service');
const registerRoutes=require('../server/routes/read-model-routes');

const TODAY='2026-03-02';
function source(){
  const rows=Array.from({length:48},(_,i)=>({ocode:9000+i,model:'Model '+i,ccode:'R'+(i%3),colour:'Red',buyer:i%2?'Buyer A':'Buyer B',merch:'M',ageGroup:'A',buyerGrup:'G',
    license:['Disney','Marvel','Barbie'][i%3],manufacturer:'Demo',season:['S6','W6','S7'][i%3],countryRaw:['TURKIYE','MISIR'][i%2],qty:100+i,kalan:10+i,fob:5+i,
    ex:new Date(2026,i%12,3),retail:new Date(2026,6,1),mb:new Date(2026,8,1)}));
  return {loadedAt:'r1',asasOrders:rows,asasOrdersByTarget:{cp:rows,orders:rows},antrepoMap:{},lflRows:[]};
}
function accessContext(src,{all=false,id='a'}={}){
  return access.createAccessContext({userId:id,systemRole:all?'moderator':'buyer',manageAll:all,viewScope:{all,mode:all?'ALL':'CUSTOM',buyers:['Buyer A']},
    editScopes:{buyers:['Buyer A']},authority:Object.fromEntries(src.asasOrders.map(row=>[row.ocode,[row]])),profiles:[]});
}
function projectionFor(user,module){
  const src=source(),rows=tasks.buildProjections(src,{modules:[module],overrides:{},horizons:{},access:accessContext(src,{all:user.all,id:user.id})})[module].rows;
  const buffer=zlib.gzipSync(Buffer.from(tasks.serialize({rows},'projection')));
  return {rows,buffer,checksum:crypto.createHash('sha256').update(buffer).digest('hex')};
}
const users={
  moderator:{id:'moderator',all:true,areas:['cp','orders','overview'],status:'ACTIVE',enabled:true},
  buyerA:{id:'buyerA',all:false,areas:['cp','orders'],status:'ACTIVE',enabled:true},
  viewer:{id:'viewer',all:false,areas:['overview'],status:'ACTIVE',enabled:true},
};
function harness(){
  const state={generation:`g-${process.pid}-${Math.random().toString(16).slice(2)}`};
  const guard={capture(req,area){
    const profile=req.currentUser;
    if(!profile||profile.status!=='ACTIVE')throw Object.assign(Error('Oturum yok / No session'),{code:'SESSION_REQUIRED',statusCode:401});
    if(!profile.areas.includes(area))throw Object.assign(Error('Yetki yok / Forbidden'),{code:'AREA_FORBIDDEN',statusCode:403,errorEn:'Forbidden'});
    return {profile,key:JSON.stringify({userId:profile.id,accessHash:profile.all?'all':'scoped'}),assertBuild(){},assertResponse(){}};
  }};
  const loadProjection=async(req,module)=>{
    const projection=projectionFor(req.currentUser,module);
    return {value:{buffer:projection.buffer,uncompressedBytes:projection.buffer.length*10},manifest:{activeGeneration:state.generation,modules:{[module]:{checksum:projection.checksum}}},assertResponse(){},release(){}};
  };
  const calls=[];
  const runCompute=async(task,payload)=>{calls.push({task,hasBuffer:Boolean(payload.buffer)});return {value:worker.execute(task,{...payload}),release(){}};};
  return {state,guard,loadProjection,runCompute,calls,service:createReadModelService({guard,loadProjection,runCompute})};
}
const req=user=>({currentUser:user});
const FACETS={task:'read-model-orders-facets'};
const body=(extra={})=>({version:1,today:TODAY,kpi:true,sums:['Order Quantity'],...extra});

test('service: facets run in the worker on the user-scoped projection; scoped rows never reach counts',async()=>{
  const {service,calls}=harness();
  const full=JSON.parse((await service.query(req(users.moderator),'orders',body(),FACETS)).body);
  const scoped=JSON.parse((await service.query(req(users.buyerA),'orders',body({distinct:['Country']}),FACETS)).body);
  const all=projectionFor(users.moderator,'orders').rows,visible=all.filter(row=>row.Buyer==='Buyer A');
  assert.ok(visible.length>0&&visible.length<all.length);
  assert.equal(full.datasetRows,all.length);assert.equal(full.total,all.length);
  assert.equal(scoped.datasetRows,visible.length);assert.equal(scoped.total,visible.length);
  assert.equal(scoped.sums['Order Quantity'],visible.reduce((sum,row)=>sum+row['Order Quantity'],0));
  assert.equal(Object.values(scoped.kpi.season).reduce((a,b)=>a+b,0),visible.length);
  // Kapsam dışı ülke seçim kutusuna da sızmaz.
  assert.deepEqual(scoped.distinct.Country,[...new Set(visible.map(row=>row.Country))].sort());
  assert.deepEqual(calls.map(call=>call.task),['read-model-orders-facets','read-model-orders-facets','read-model-orders-facets','read-model-orders-facets']);
});

test('service: facets task is orders-only, validated before the projection is read, and cached apart from /query',async()=>{
  const {service,calls}=harness();
  assert.deepEqual(TASKS,['read-model-query','read-model-orders-facets']);
  await assert.rejects(service.query(req(users.moderator),'cp',body(),FACETS),error=>error.statusCode===404);
  await assert.rejects(service.query(req(users.moderator),'orders',body(),{task:'nope'}),error=>error.statusCode===404);
  await assert.rejects(service.query(req(users.viewer),'orders',{version:99},FACETS),error=>error.statusCode===403);
  await assert.rejects(service.query(req(users.moderator),'orders',{version:1,today:'x'},FACETS),error=>error.code==='READ_MODEL_QUERY_INVALID');
  assert.equal(calls.length,0,'invalid/forbidden requests never reach the worker');
  const first=await service.query(req(users.moderator),'orders',body(),FACETS);
  const again=await service.query(req(users.moderator),'orders',body(),FACETS);
  assert.equal(first.cached,false);assert.equal(again.cached,true);
  // /query ile aynı veri kümesi işçide yeniden kullanılır; sonuçlar ayrı anahtarda.
  const query=await service.query(req(users.moderator),'orders',{version:1,limit:3});
  assert.equal(query.cached,false);assert.equal(JSON.parse(query.body).rows.length,3);
  assert.deepEqual(calls.map(call=>call.hasBuffer),[false,true,false]);
});

test('worker: unknown task is refused; facets body is the serialized result',()=>{
  assert.throws(()=>worker.execute('read-model-everything',{}),{code:'COMPUTE_JOB_INVALID'});
  assert.deepEqual(worker.execute('read-model-orders-facets',{datasetKey:'missing-'+Math.random()}),{missing:true});
});

async function withServer(h,fn){
  const app=express();
  app.use((request,_res,next)=>{request.currentUser=users[request.headers['x-test-user']]||null;next();});
  registerRoutes(app,{userAccess:{prepareComputeAccessContext:async()=>{},sessionProfile:request=>request.currentUser,hasArea:(profile,area)=>profile.areas.includes(area)},
    apiError:(res,err,message)=>res.status(err?.statusCode||500).json({error:message,code:err?.code||'INTERNAL_ERROR'}),
    getComputeReadGuard:()=>h.guard,ensureComputedProjection:h.loadProjection,runReadModelCompute:h.runCompute});
  app.use(express.json({limit:'100mb'}));
  const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
  const base=`http://127.0.0.1:${server.address().port}`;
  const post=(url,payload,user='moderator',raw)=>fetch(`${base}${url}`,{method:'POST',headers:{'content-type':'application/json','x-test-user':user},body:raw??JSON.stringify(payload)});
  try{await fn(post);}finally{await new Promise(resolve=>server.close(resolve));}
}

test('HTTP: /api/read-model/orders/facets shares the /query contract (200/400/401/403/413)',async()=>{
  const h=harness();
  await withServer(h,async post=>{
    const ok=await post('/api/read-model/orders/facets',body({column:{key:'License'}}));
    assert.equal(ok.status,200);assert.equal(ok.headers.get('cache-control'),'no-store');
    const payload=await ok.json();
    assert.equal(payload.ok,true);assert.equal(payload.module,'orders');assert.ok(payload.generation);
    assert.deepEqual(payload.result.column.values,['Barbie','Disney','Marvel']);
    assert.equal(payload.result.kpi.active.Active+payload.result.kpi.active.Inactive,payload.result.total);
    const unsupported=await post('/api/read-model/orders/facets',body({base:[{key:'Priority',op:'in',values:['x']}]}));
    assert.equal(unsupported.status,400);assert.equal((await unsupported.json()).code,'READ_MODEL_FILTER_UNSUPPORTED');
    assert.equal((await post('/api/read-model/orders/facets',null,'moderator','{nope')).status,400);
    assert.equal((await post('/api/read-model/orders/facets',body(),'viewer')).status,403);
    assert.equal((await post('/api/read-model/orders/facets',null,'viewer','{nope')).status,403,'403 precedes body parsing');
    assert.equal((await post('/api/read-model/orders/facets',body(),'nobody')).status,401);
    const oversized=await post('/api/read-model/orders/facets',null,'moderator',JSON.stringify(body({base:[{key:'Buyer',op:'in',values:['x'.repeat(3*1024*1024)]}]})));
    assert.equal(oversized.status,413);
    // /query sözleşmesi değişmedi.
    const query=await post('/api/read-model/orders/query',{version:1,limit:2,fields:['Order Code']});
    assert.equal(query.status,200);assert.equal((await query.json()).result.rows.length,2);
    assert.equal((await post('/api/read-model/cp/facets',body())).status,404);
  });
});
