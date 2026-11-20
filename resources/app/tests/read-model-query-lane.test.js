'use strict';
/* #1071 WS7: kullanıcının açtığı Siparişler okuma isteği, ana okuma modeli
   işçisindeki uzun hesabın (CP hesaplanmış sütunlar, Genel Bakış…) arkasında
   beklemez. Siparişler veri kümesi sorguları ayrı tek işçili "kısa sorgu
   şeridine" gider; sonuç tek havuz yoluyla birebir aynıdır (parite hash'i).
   BL_LANE_PARITY_ROWS=30000 ile 30k parite koşulur (varsayılan 2k). */
const test=require('node:test'),assert=require('node:assert/strict');
const crypto=require('node:crypto'),zlib=require('node:zlib');
const express=require('express');
const access=require('../server/lib/compute-access');
const tasks=require('../server/lib/compute-tasks');
const worker=require('../server/lib/read-model/read-model-worker');
const {createComputePool}=require('../server/lib/compute-pool');
const lanes=require('../server/lib/read-model/read-model-pool');
const registerRoutes=require('../server/routes/read-model-routes');

const ROWS=Number(process.env.BL_LANE_PARITY_ROWS)||2000;
function source(n){
  const rows=Array.from({length:n},(_,i)=>({ocode:100000+i,model:'Model '+(i%997),ccode:'R'+(i%7),colour:['Red','Blue','Ecru'][i%3],buyer:['Buyer A','Buyer B','Buyer C'][i%3],
    merch:'M'+(i%4),ageGroup:'A',buyerGrup:'G'+(i%2),license:['Disney','Marvel','Barbie','Sanrio'][i%4],manufacturer:'Demo '+(i%11),season:['S6','W6','S7'][(i>>2)%3],
    countryRaw:['TURKIYE','MISIR'][i%2],qty:100+(i*37)%900,kalan:(i*13)%120,fob:5+(i%40)/4,ex:new Date(2026,i%12,1+(i%27)),retail:new Date(2026,6,1),mb:new Date(2026,8,1)}));
  return {loadedAt:'r1',asasOrders:rows,asasOrdersByTarget:{cp:rows,orders:rows},antrepoMap:{},lflRows:[]};
}
const SOURCE=source(ROWS);
function accessContext(src,{all,id}){
  return access.createAccessContext({userId:id,systemRole:all?'moderator':'buyer',manageAll:all,viewScope:{all,mode:all?'ALL':'CUSTOM',buyers:['Buyer A','Buyer C']},
    editScopes:{buyers:['Buyer A']},authority:Object.fromEntries(src.asasOrders.map(row=>[row.ocode,[row]])),profiles:[]});
}
const projections=new Map();
function projectionFor(user,module){
  const key=user.id+'|'+module;
  if(!projections.has(key)){
    const rows=tasks.buildProjections(SOURCE,{modules:[module],overrides:{},horizons:{},access:accessContext(SOURCE,{all:user.all,id:user.id})})[module].rows;
    const raw=Buffer.from(tasks.serialize({rows},'projection')),buffer=zlib.gzipSync(raw);
    projections.set(key,{rows,buffer,uncompressedBytes:raw.length,checksum:crypto.createHash('sha256').update(buffer).digest('hex')});
  }
  return projections.get(key);
}
const users={
  moderator:{id:'moderator',all:true,areas:['cp','orders','overview'],status:'ACTIVE',enabled:true},
  buyerA:{id:'buyerA',all:false,areas:['cp','orders'],status:'ACTIVE',enabled:true},
};
const guard={capture(req){const p=req.currentUser;return {profile:p,key:JSON.stringify({userId:p.id,accessHash:p.all?'all':'scoped'}),assertBuild(){},assertResponse(){}};}};
const loadProjection=async(req,module)=>{
  const projection=projectionFor(req.currentUser,module);
  return {value:{buffer:projection.buffer,uncompressedBytes:projection.uncompressedBytes},manifest:{activeGeneration:'g1',modules:{[module]:{checksum:projection.checksum}}},assertResponse(){},release(){}};
};
const userAccess={prepareComputeAccessContext:async()=>{},sessionProfile:r=>r.currentUser,hasArea:(p,a)=>p.areas.includes(a)};
const apiError=(res,err,message)=>res.status(err?.statusCode||500).json({error:message,code:err?.code||'INTERNAL_ERROR'});

async function withServer(deps,fn){
  const app=express();
  app.use((request,_res,next)=>{request.currentUser=users[request.headers['x-test-user']]||null;next();});
  registerRoutes(app,{userAccess,apiError,getComputeReadGuard:()=>guard,ensureComputedProjection:loadProjection,...deps});
  const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
  const base=`http://127.0.0.1:${server.address().port}`;
  const post=(url,payload,user='moderator',signal)=>fetch(`${base}${url}`,{method:'POST',headers:{'content-type':'application/json','x-test-user':user},body:JSON.stringify(payload),signal});
  try{await fn(post);}finally{server.closeAllConnections?.();await new Promise(resolve=>server.close(resolve));}
}
const inline=calls=>async(task,payload,options)=>{calls.push({task,module:options&&options.module});return {value:worker.execute(task,{...payload}),release(){}};};
// Ana işçi meşgul: CP hesaplanmış sütun gibi uzun bir iş bitmeden hiçbir iş başlamaz.
function busyMain(calls){
  const waiters=[],state={busy:true};
  return {waiters,release(){state.busy=false;waiters.splice(0).forEach(fn=>fn());},run:(task,payload,options)=>{calls.push({task,module:options&&options.module});return new Promise((resolve,reject)=>{
    const done=()=>resolve({value:worker.execute(task,{...payload}),release(){}});
    if(!state.busy)return done();
    waiters.push(done);
    options?.signal?.addEventListener('abort',()=>reject(Object.assign(Error('aborted'),{code:'COMPUTE_ABORTED',statusCode:499})),{once:true});
  });}};
}
const Q={version:1,filters:[{key:'Season',op:'eq',value:'W6'}],sort:{key:'Order Quantity',dir:-1},offset:0,limit:50,aggregates:{sums:['Order Quantity']}};

test('lane routing: only orders dataset queries/facets use the lane; flag and env switch back',()=>{
  assert.equal(lanes.usesQueryLane('read-model-query','orders'),true);
  assert.equal(lanes.usesQueryLane('read-model-orders-facets','orders'),true);
  for(const [task,module] of [['read-model-query','cp'],['read-model-query','overview'],['read-model-cp-query','cp'],['read-model-cp-computed','cp'],['read-model-overview','overview'],['read-model-query',undefined]])
    assert.equal(lanes.usesQueryLane(task,module),false,`${task}/${module} stays on the main worker`);
  assert.equal(lanes.queryLaneEnabled({}),true,'default ON');
  assert.equal(lanes.queryLaneEnabled({BL_READ_MODEL_QUERY_LANE:'0'}),false,'rollback switch');
  assert.equal(lanes.queryLaneEnabled({BL_READ_MODEL_QUERY_LANE:'1'}),true);
});

test('HTTP: orders query and facets answer while the main read-model worker is busy (CP compute)',async()=>{
  const mainCalls=[],laneCalls=[],main=busyMain(mainCalls);
  await withServer({runReadModelCompute:main.run,runQueryLaneCompute:inline(laneCalls),queryLaneEnabled:()=>true},async post=>{
    const query=await post('/api/read-model/orders/query',Q);
    assert.equal(query.status,200);
    const payload=await query.json();
    assert.equal(payload.ok,true);assert.ok(payload.result.total>0);
    const facets=await post('/api/read-model/orders/facets',{version:1,today:'2026-03-02',kpi:true,sums:['Order Quantity'],column:{key:'License'}});
    assert.equal(facets.status,200);
    assert.deepEqual(mainCalls,[],'main worker untouched by orders reads');
    assert.ok(laneCalls.length>=2&&laneCalls.every(c=>c.module==='orders'));
    // CP sorgusu ana işçide kalır (hesaplanmış sütun önbelleği orada).
    const controller=new AbortController();
    const cp=post('/api/read-model/cp/query',Q,'moderator',controller.signal).catch(()=>null);
    for(let i=0;i<50&&!mainCalls.length;i++)await new Promise(r=>setTimeout(r,10));
    assert.deepEqual(mainCalls.map(c=>c.module),['cp'],'CP query waits on the main worker');
    main.release();
    const cpRes=await cp;assert.equal(cpRes&&cpRes.status,200);
  });
});

test('HTTP: lane switched off → orders reads use the single main pool (today\'s path)',async()=>{
  const mainCalls=[],laneCalls=[];
  await withServer({runReadModelCompute:inline(mainCalls),runQueryLaneCompute:inline(laneCalls),queryLaneEnabled:()=>false},async post=>{
    assert.equal((await post('/api/read-model/orders/query',Q)).status,200);
    assert.equal((await post('/api/read-model/orders/facets',{version:1,today:'2026-03-02',kpi:true,sums:['Order Quantity'],column:{key:'License'}})).status,200);
  });
  assert.equal(laneCalls.length,0);assert.ok(mainCalls.length>=2);
});

// Parite: gerçek işçiler; şeritli yol (ana + şerit havuzu) ile tek havuz yolu aynı
// sorgu/yüzey kümesinde, iki yetki kapsamında aynı sonucu verir.
const SCENARIOS=[
  ['query',Q],
  ['query',{version:1,filters:[],sort:{key:'Ex-factory',dir:1},offset:0,limit:200,aggregates:{sums:['Order Quantity'],groupBy:[{key:'License',sums:['Order Quantity']}]}}],
  ['query',{version:1,filters:[{key:'License',op:'in',values:['Disney','Sanrio']}],search:{text:'Model 1'},sort:{key:'Buyer',dir:1},offset:20,limit:100}],
  ['query',{version:1,filters:[{key:'Order Quantity',op:'range',min:500,max:null}],sort:{key:'Order Quantity',dir:1},offset:Math.max(0,ROWS/4|0),limit:200}],
  ['facets',{version:1,today:'2026-03-02',kpi:true,sums:['Order Quantity'],column:{key:'License'}}],
  ['facets',{version:1,today:'2026-03-02',base:[{key:'Season',op:'eq',value:'s6'}],column:{key:'Buyer'},kpi:true,distinct:['Country']}],
];
async function collect(deps){
  const out=[];
  await withServer(deps,async post=>{
    for(const user of Object.keys(users))for(const [kind,body] of SCENARIOS){
      const res=await post(`/api/read-model/orders/${kind}`,body,user);
      const payload=await res.json();
      assert.equal(res.status,200,`${user} ${kind} ${JSON.stringify(payload).slice(0,200)}`);
      out.push([user,kind,payload.result]);
    }
  });
  return out;
}
const digest=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');

test(`parity (${ROWS} rows, moderator + scoped buyer): lane path == single-pool path`,{timeout:600000},async()=>{
  const opts=lanes.readModelPoolOptions({BL_READ_MODEL_MEMORY_MB:'1024'});
  const single=createComputePool(opts),main=createComputePool(opts),lane=createComputePool(opts);
  const threads={main:new Set(),lane:new Set()};
  const track=(pool,set)=>async(task,payload,options)=>{const lease=await pool.run(task,payload,options);set.add(lease.metrics.threadId);return lease;};
  try{
    const before=await collect({runReadModelCompute:(t,p,o)=>single.run(t,p,o),queryLaneEnabled:()=>false});
    const after=await collect({runReadModelCompute:track(main,threads.main),runQueryLaneCompute:track(lane,threads.lane),queryLaneEnabled:()=>true});
    assert.equal(after.length,before.length);
    // Boş sonuçla geçmesin: kapsamlı kullanıcı daha az satır görür, sorgular satır döndürür.
    const totals=before.filter(([,kind])=>kind==='query').map(([user,,r])=>[user,r.total]);
    assert.ok(totals.every(([,t])=>t>0),JSON.stringify(totals));
    assert.ok(before[0][2].total>before[SCENARIOS.length][2].total,'scoped buyer sees fewer rows');
    for(let i=0;i<before.length;i++)assert.equal(digest(after[i]),digest(before[i]),`scenario ${i} (${before[i][0]} ${before[i][1]})`);
    assert.equal(digest(after),digest(before));
    assert.equal(threads.main.size,0,'orders reads never reached the main worker');
    assert.equal(threads.lane.size,1);
  }finally{await Promise.all([single.close(),main.close(),lane.close()]);}
});
