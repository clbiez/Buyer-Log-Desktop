'use strict';
/* WS5 (#1078) alt PR 2: CP pencereli okuma — POST /api/read-model/cp/query ve /facets.
   CP alan yetkisi, kapsam yalıtımı (kapsam dışı satır sorgu/sayaç sonucuna girmez),
   hesaplanmış sütunların sorgu ve sayaçlarda kullanılması (paylaşılan satırlara
   yazılmadan), desteklenmeyen filtre → 400, pencere + kimlik isteği, bayat nesil ve
   gerçek compute-pool işçisinde uçtan uca görev. Anlamsal eşitlik (istemcinin gerçek
   cpEvaluateAll/sortRows/KPI fonksiyonlarıyla) read-model-cp-window-parity.test.js'tedir. */
const test=require('node:test'),assert=require('node:assert/strict');
const zlib=require('node:zlib'),crypto=require('node:crypto');
const express=require('express');
const tasks=require('../server/lib/compute-tasks'),access=require('../server/lib/compute-access');
const worker=require('../server/lib/read-model/read-model-worker');
const engine=require('../server/lib/read-model/query-engine');
const task=require('../server/lib/read-model/cp-computed-task');
const queryTask=require('../server/lib/read-model/cp-query-task');
const cpQuery=require('../server/lib/read-model/cp-query');
const {createCpComputedService,createTaskLoader}=require('../server/lib/read-model/cp-computed-service');
const {createContextLoader}=require('../server/lib/read-model/overview-model-service');
const registerRoutes=require('../server/lib/read-model/cp-computed-routes');
const Merge=require('../public/checklist-answer-merge-engine');
const Readiness=require('../public/cp-readiness-engine');

function source(){
  const rows=Array.from({length:60},(_,i)=>({ocode:9000+i,model:'Model '+i,ccode:'R'+(i%3),colour:'Red',buyer:i%2?'Buyer A':'Buyer B',merch:'M',ageGroup:'A',buyerGrup:i%3?'G1':'G2',
    license:['Disney','Marvel'][i%2],manufacturer:'Demo '+(i%4),season:['S6','W6','S7'][i%3],countryRaw:i%5?'TURKIYE':'EGYPT',qty:100+i*90,kalan:i%7?10+i:0,fob:5+i,
    ex:new Date(2026,i%12,3),retail:new Date(2027,6,1),mb:new Date(2027,8,1)}));
  return {loadedAt:'r1',asasOrders:rows,asasOrdersByTarget:{cp:rows,orders:rows},antrepoMap:{},lflRows:[]};
}
function projection(user){
  const src=source();
  const ctx=access.createAccessContext({userId:user.id,systemRole:user.all?'moderator':'buyer',manageAll:user.all,viewScope:{all:user.all,mode:user.all?'ALL':'CUSTOM',buyers:['Buyer A']},
    editScopes:{buyers:['Buyer A']},authority:Object.fromEntries(src.asasOrders.map(row=>[row.ocode,[row]])),profiles:[]});
  const rows=tasks.buildProjections(src,{modules:['cp'],overrides:{},horizons:{},access:ctx}).cp.rows;
  const buffer=zlib.gzipSync(Buffer.from(tasks.serialize({rows},'projection')));
  return {rows,buffer,checksum:crypto.createHash('sha256').update(buffer).digest('hex')};
}
const users={
  moderator:{id:'moderator',all:true,areas:['cp','orders','overview'],status:'ACTIVE',enabled:true},
  buyerA:{id:'buyerA',all:false,areas:['cp','overview'],status:'ACTIVE',enabled:true},
  overviewOnly:{id:'overviewOnly',all:true,areas:['overview'],status:'ACTIVE',enabled:true},
};
let harnessId=0;
function harness({day='2026-11-20'}={}){
  const state={generation:`g${++harnessId}-${process.pid}`,stale:0,revoked:new Set(),own:{},contextRevision:'c1',day,tasks:[],authorizedCalls:0};
  const guard={capture(req,area){
    const profile=req.currentUser;
    if(!profile.areas.includes(area))throw Object.assign(Error('Bu alana erişim yetkiniz yok. / You do not have access to this area.'),{code:'AREA_FORBIDDEN',statusCode:403,errorEn:'You do not have access to this area.'});
    const check=()=>{if(state.revoked.has(profile.id))throw Object.assign(Error('stale / stale'),{code:'COMPUTE_STALE_GENERATION',statusCode:409});};
    return {profile,key:JSON.stringify({userId:profile.id,scope:profile.all?'all':'scoped'}),assertResponse:check};
  }};
  const loadProjection=async req=>{
    if(state.stale>0){state.stale--;throw Object.assign(Error('stale'),{code:'COMPUTE_STALE_GENERATION',statusCode:409});}
    if(!req.currentUser.areas.includes('cp'))throw Object.assign(Error('forbidden'),{code:'AREA_FORBIDDEN',statusCode:403});
    const built=projection(req.currentUser);
    return {value:{buffer:built.buffer,uncompressedBytes:built.buffer.length*10},manifest:{activeGeneration:state.generation,modules:{cp:{checksum:built.checksum}}},assertResponse(){},release(){}};
  };
  const loadContext=createContextLoader({
    preferences:{load:()=>({entries:{'lcw.cp.checklist.v1':{value:JSON.stringify(state.own)},
      'lcw.cp.assistant.v1':{value:JSON.stringify({settings:{targetType:'retail'},checklistSettings:{enabled:true}})}}})},
    roleEntries:()=>({}),managedRules:()=>null,transitRules:()=>[{id:'t',seasons:[],countries:[],delType:'',days:30}],plmPayload:()=>null,
    checklistPayload:()=>({answers:{},tombstones:{}}),revision:()=>state.contextRevision,merge:(own,shared)=>Merge.merge(own,shared)});
  const allOrders=new Map(source().asasOrders.map(row=>[row.ocode,row]));
  const loadTasks=createTaskLoader({list:()=>state.tasks,authorizedOrders:async profile=>{
    state.authorizedCalls++;
    // Kullanıcının yetkili siparişleri (GET /api/test-reports/tasks ile aynı kaynak).
    const rows=projection(profile).rows;return new Map(rows.map(row=>[Readiness.analyzeOrder(row).orderKey,{}]));
  }});
  const calls=[];
  const runCompute=async(name,payload,options)=>{
    calls.push({name,kind:payload.kind,buffer:Boolean(payload.dataset&&payload.dataset.buffer),options});
    const run=name==='read-model-cp-query'?queryTask:task;
    return {value:await run.execute(structuredClone(payload),{cache:worker.cache,engine}),release(){}};
  };
  const service=createCpComputedService({guard,loadProjection,runCompute,loadContext,loadTasks,today:()=>state.day});
  return {state,service,calls,allOrders};
}
const req=user=>({currentUser:user});
const COLUMNS=[{k:'Order Code',type:'ro'},{k:'Model',type:'ro'},{k:'Season',type:'ro'},{k:'STATUS',type:'ro'},{k:'Del. Type',type:'ro'},{k:'Ex-factory',type:'date'},{k:'Order Quantity',type:'num'},{k:'Country',type:'ro'},{k:'License',type:'ro'},{k:'Priority',type:'priority'}];
const TODAY='2026-11-20';
const body=(spec,extra={})=>({version:1,...extra,query:{version:1,columns:COLUMNS,today:TODAY,...spec}});
const facetsBody=(spec,extra={})=>({version:1,...extra,facets:{version:1,columns:COLUMNS,today:TODAY,kpi:true,sums:['Order Quantity'],...spec}});

test('authorization and scope: CP area required; scoped user only sees rows in scope in windows and counters',async()=>{
  worker.cache.clear();task.clearHosts();
  const {service}=harness();
  await assert.rejects(service.query(req(users.overviewOnly),body({})),error=>error.statusCode===403&&error.code==='AREA_FORBIDDEN');
  await assert.rejects(service.facets(req(users.overviewOnly),facetsBody({})),error=>error.statusCode===403);
  const all=await service.query(req(users.moderator),body({limit:1000}));
  const scoped=await service.query(req(users.buyerA),body({limit:1000}));
  const inScope=new Set(projection(users.buyerA).rows.map(row=>String(row._id)));
  assert.equal(all.result.total,projection(users.moderator).rows.length);
  assert.equal(scoped.result.total,inScope.size);assert.ok(scoped.result.total<all.result.total);
  assert.ok(scoped.result.ids.every(id=>inScope.has(id)),'kapsam dışı satır yok');
  assert.ok(scoped.result.rows.every(row=>row.Buyer==null||row.Buyer==='Buyer A'||inScope.has(String(row._id))));
  const facets=await service.facets(req(users.buyerA),facetsBody({}));
  assert.equal(facets.result.total,inScope.size);assert.equal(facets.result.datasetRows,inScope.size);
  assert.equal(facets.result.sums['Order Quantity'],projection(users.buyerA).rows.reduce((sum,row)=>sum+(Number(row['Order Quantity'])||0),0));
});

test('computed columns: window carries tuples, Priority filter/sort/KPI use them without writing shared rows',async()=>{
  worker.cache.clear();task.clearHosts();
  const {service,calls}=harness();
  const computed=JSON.parse((await service.computed(req(users.moderator),{version:1})).body);
  const byId=new Map(computed.rows.map(row=>[row[0],row]));
  const first=await service.query(req(users.moderator),body({limit:5}));
  assert.equal(first.result.rows.length,5);assert.deepEqual(first.result.computedFields,task.FIELDS);
  first.result.ids.forEach((id,i)=>assert.deepEqual(JSON.parse(first.result.computed[i]),byId.get(id),'pencere demeti = hesaplanmış sütun'));
  const projected=new Map(projection(users.moderator).rows.map(row=>[String(row._id),row]));
  assert.ok(first.result.rows.every(row=>row.Priority===projected.get(String(row._id)).Priority&&!('_priorityTags' in row)&&!('_actionPriorityReasons' in row)
    &&!Object.keys(row).some(key=>key.startsWith('__checklist__'))),'paylaşılan satırlara yazılmadı');
  // Hesap önbelleği: aynı bağlamda ikinci sorgu yeniden hesaplamaz.
  const again=await service.query(req(users.moderator),body({limit:5,offset:5}));
  assert.equal(again.timing.reused,true);
  // KPI: satır kodu + etiketler (tekil) = sayaç.
  const facets=(await service.facets(req(users.moderator),facetsBody({}))).result;
  const expected={};
  for(const row of computed.rows)for(const code of new Set([row[1],...row[4],...row[3]]))expected[code]=(expected[code]||0)+1;
  for(const [code,count] of Object.entries(facets.kpi.pri))assert.equal(count,expected[code]||0,code);
  const code=Object.entries(facets.kpi.pri).find(([,n])=>n>0)[0];
  const filtered=await service.query(req(users.moderator),body({groups:{pri:[{op:'cp-priority',flags:[code]}]},limit:1000}));
  assert.equal(filtered.result.total,facets.kpi.pri[code]);
  // Öncelik sıralaması katalog sırasına göre (istemci priorityRank farkı × yön).
  const sorted=await service.query(req(users.moderator),body({sort:{key:'Priority',dir:1},limit:1000}));
  const ranks=sorted.result.computed.map(json=>JSON.parse(json)[1]);
  const order=Object.keys(facets.kpi.pri);
  for(let i=1;i<ranks.length;i++)assert.ok(order.indexOf(ranks[i-1])<=order.indexOf(ranks[i]),`${ranks[i-1]} ≤ ${ranks[i]}`);
  // Çapraz kapsam: grup kendi filtresi hariç sayılır (KPI 'pri' sayacı pri filtresinden etkilenmez).
  const crossed=(await service.facets(req(users.moderator),facetsBody({groups:{pri:[{op:'cp-priority',flags:[code]}]}}))).result;
  assert.deepEqual(crossed.kpi.pri,facets.kpi.pri);assert.equal(crossed.total,facets.kpi.pri[code]);assert.equal(crossed.none,facets.total);
  assert.ok(calls.every(call=>call.name==='read-model-cp-computed'||call.name==='read-model-cp-query'));
});

test('ids-only window, offsets and unsupported filters',async()=>{
  worker.cache.clear();task.clearHosts();
  const {service}=harness();
  const full=await service.query(req(users.moderator),body({sort:{key:'Order Quantity',dir:-1},limit:1000}));
  const page=await service.query(req(users.moderator),body({sort:{key:'Order Quantity',dir:-1},offset:10,limit:7,fields:['_id']}));
  assert.deepEqual(page.result.ids,full.result.ids.slice(10,17));
  assert.ok(page.result.rows.every(row=>Object.keys(row).sort().join()==='_id,_rowIndex'));
  assert.equal(page.result.computed,undefined);
  // WS1'in değerlendiremediği sütun (Priority değer filtresi, lojistik STATUS) sorgu yerine 400.
  for(const filter of [{key:'Priority',op:'in',values:['ON_TRACK']},{key:'STATUS',op:'display-in',values:['Depoda']}])
    await assert.rejects(service.query(req(users.moderator),body({base:[filter]})),error=>error.statusCode===400&&error.code==='READ_MODEL_FILTER_UNSUPPORTED',JSON.stringify(filter));
  for(const bad of [{groups:{x:[]}},{base:[{op:'cp-exf',periods:['tomorrow']}]},{today:'2026-13-01'},{limit:5000},{fields:[]},{sort:{key:'Model',dir:0}}])
    await assert.rejects(service.query(req(users.moderator),body(bad)),error=>error.statusCode===400,JSON.stringify(bad));
  await assert.rejects(service.query(req(users.moderator),{version:1,query:{version:1,columns:COLUMNS,today:TODAY},since:'abc'}),error=>error.statusCode===400);
});

test('route: query/facets JSON envelope, stale-generation retry and errors',async()=>{
  worker.cache.clear();task.clearHosts();
  const {service,state}=harness();
  const app=express();
  const userAccess={sessionProfile:r=>r.currentUser,hasArea:(u,a)=>u.areas.includes(a)};
  app.use((r,_res,next)=>{r.currentUser=users[r.get('x-user')];next();});
  registerRoutes(app,{userAccess,apiError:(res,err)=>res.status(500).json({ok:false,code:err.code}),cpComputedService:service,getComputeReadGuard:()=>null});
  const server=app.listen(0);
  try{
    const post=(path,user,payload)=>fetch(`http://127.0.0.1:${server.address().port}/api/read-model/cp/${path}`,{method:'POST',headers:{'content-type':'application/json','x-user':user},body:JSON.stringify(payload)});
    state.stale=2;
    const ok=await post('query','moderator',body({limit:3}));
    assert.equal(ok.status,200);
    const json=await ok.json();
    assert.equal(json.ok,true);assert.ok(json.generation);assert.equal(json.result.rows.length,3);assert.equal(json.result.total,projection(users.moderator).rows.length);
    const facets=await (await post('facets','buyerA',facetsBody({distinct:['Season','Country']}))).json();
    assert.equal(facets.ok,true);assert.ok(Array.isArray(facets.result.distinct.Season));
    assert.equal((await post('query','overviewOnly',body({}))).status,403);
    const unsupported=await post('query','moderator',body({base:[{key:'Priority',op:'in',values:['x']}]}));
    assert.equal(unsupported.status,400);assert.equal((await unsupported.json()).code,'READ_MODEL_FILTER_UNSUPPORTED');
    state.stale=5;
    assert.equal((await post('facets','moderator',facetsBody({}))).status,409);
    state.stale=0;state.revoked.add('buyerA');
    assert.equal((await post('query','buyerA',body({}))).status,409);
  }finally{server.close();}
});

test('real compute-pool worker: cp-query task is registered and shares the computed cache',async()=>{
  const {createComputePool}=require('../server/lib/compute-pool');
  const MiB=1024*1024;
  const pool=createComputePool({memoryBudgetBytes:1024*MiB,maxWorkers:1,workerFile:require.resolve('../server/lib/read-model/read-model-worker.js')});
  try{
    const {state}=harness();
    const names=[];
    const service=createCpComputedService({
      guard:{capture:r=>({profile:r.currentUser,key:'k-'+r.currentUser.id,assertResponse(){}})},
      loadProjection:async r=>{const built=projection(r.currentUser);return {value:{buffer:built.buffer,uncompressedBytes:built.buffer.length*10},manifest:{activeGeneration:state.generation,modules:{cp:{checksum:built.checksum}}},assertResponse(){},release(){}};},
      loadContext:()=>({key:'c1',value:{userId:'moderator',entries:{},answers:{},managedRules:null,plm:null,transitRules:[]}}),
      runCompute:(name,payload,options)=>{names.push(name+(payload.dataset.buffer?':buffer':''));return pool.run(name,payload,options);},
    });
    const first=await service.query(req(users.moderator),body({limit:10}));
    assert.equal(first.result.total,projection(users.moderator).rows.length);assert.equal(first.result.computed.length,10);
    const facets=await service.facets(req(users.moderator),facetsBody({}));
    assert.equal(facets.result.total,first.result.total);assert.equal(facets.timing.reused,true,'aynı işçide hesap yeniden kullanıldı');
    assert.deepEqual(names,['read-model-cp-query','read-model-cp-query:buffer','read-model-cp-query']);
  }finally{await pool.close();}
});

test('footer totals: the cp-query copy of the accumulator equals WS3 orders-facets on the same rows (edge values)',()=>{
  const ordersFacets=require('../server/lib/read-model/orders-facets');
  const rows=[
    {_id:1,'Order Quantity':0,'FOB ($)':5,'Supp. FOB':'4,5','Remaining Units':'1.234',STATUS:'Üretimde'},
    {_id:2,'Order Quantity':-3,'FOB ($)':7,'Supp. FOB':'','Remaining Units':'1.234,5',STATUS:'Depoda'},
    {_id:3,'Order Quantity':'1.200','FOB ($)':'1.234,50','Supp. FOB':null,'Remaining Units':null},
    {_id:4,'Order Quantity':'2,5','FOB ($)':-1,'Supp. FOB':'3.5','Remaining Units':' 12 '},
    {_id:5,'Order Quantity':10,'FOB ($)':'abc','Supp. FOB':'1.2.3','Remaining Units':'1.000.000'},
    {_id:5,'Order Quantity':4,'FOB ($)':2,'Supp. FOB':2,'Remaining Units':4},
  ];
  const footer={sums:['Order Quantity','Remaining Units'],averages:[{key:'FOB ($)',qtyKey:'Order Quantity'},{key:'Supp. FOB',qtyKey:'Order Quantity'}],selected:['5','2','99']};
  const expected=ordersFacets.runOrdersFacets(engine.prepareDataset(rows),{version:1,today:'2026-11-20',footer}).footer;
  const helpers={computedOf:()=>({priority:'ON_TRACK',priorityTags:[],trackingTags:[]}),code:v=>v||'',rank:()=>0,codes:()=>['ON_TRACK']};
  const actual=cpQuery.runCpFacets({rows},{version:1,today:'2026-11-20',footer},helpers).footer;
  assert.deepEqual(actual,expected);
});
