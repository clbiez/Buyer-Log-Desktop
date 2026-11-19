'use strict';
/* WS2a (#1074): Genel Bakış okuma modeli servisi ve POST /api/read-model/overview/model
   sözleşmesi — yetki, kapsam yalıtımı, CP alanı olmayan kullanıcı, bağlam revizyonu
   ile önbellek, bayat nesil yeniden denemesi, gövde doğrulaması ve işçi yeniden
   gönderimi (eksik veri kümesi / bağlam). */
const test=require('node:test'),assert=require('node:assert/strict');
const zlib=require('node:zlib'),crypto=require('node:crypto');
const express=require('express');
const tasks=require('../server/lib/compute-tasks'),access=require('../server/lib/compute-access');
const worker=require('../server/lib/read-model/read-model-worker');
const engine=require('../server/lib/read-model/query-engine');
const task=require('../server/lib/read-model/overview-model-task');
const {createOverviewModelService,createContextLoader,validateRequest}=require('../server/lib/read-model/overview-model-service');
const registerRoutes=require('../server/lib/read-model/overview-model-routes');
const Merge=require('../public/checklist-answer-merge-engine');

function source(){
  const rows=Array.from({length:60},(_,i)=>({ocode:9000+i,model:'Model '+i,ccode:'R'+(i%3),colour:'Red',buyer:i%2?'Buyer A':'Buyer B',merch:'M',ageGroup:'A',buyerGrup:i%3?'G1':'G2',
    license:['Disney','Marvel'][i%2],manufacturer:'Demo '+(i%4),season:['S6','W6','S7'][i%3],countryRaw:i%5?'TURKIYE':'EGYPT',qty:100+i,kalan:i%7?10+i:0,fob:5+i,
    ex:new Date(2026,i%12,3),retail:new Date(2027,6,1),mb:new Date(2027,8,1)}));
  return {loadedAt:'r1',asasOrders:rows,asasOrdersByTarget:{cp:rows,orders:rows},antrepoMap:{},lflRows:[]};
}
function projection(user,module){
  const src=source();
  const ctx=access.createAccessContext({userId:user.id,systemRole:user.all?'moderator':'buyer',manageAll:user.all,viewScope:{all:user.all,mode:user.all?'ALL':'CUSTOM',buyers:['Buyer A']},
    editScopes:{buyers:['Buyer A']},authority:Object.fromEntries(src.asasOrders.map(row=>[row.ocode,[row]])),profiles:[]});
  const rows=tasks.buildProjections(src,{modules:[module],overrides:{},horizons:{},access:ctx})[module].rows;
  const buffer=zlib.gzipSync(Buffer.from(tasks.serialize({rows},'projection')));
  return {rows,buffer,checksum:crypto.createHash('sha256').update(buffer).digest('hex')};
}
const users={
  moderator:{id:'moderator',all:true,areas:['cp','orders','overview'],status:'ACTIVE',enabled:true},
  buyerA:{id:'buyerA',all:false,areas:['cp','overview'],status:'ACTIVE',enabled:true},
  overviewOnly:{id:'overviewOnly',all:true,areas:['overview'],status:'ACTIVE',enabled:true},
  cpOnly:{id:'cpOnly',all:true,areas:['cp'],status:'ACTIVE',enabled:true},
};
let harnessId=0;
function harness(){
  const state={generation:`g${++harnessId}-${process.pid}`,stale:0,revoked:new Set(),prefs:{},contextRevision:'c1',contextLoads:0};
  const guard={capture(req,area){
    const profile=req.currentUser;
    if(!profile.areas.includes(area))throw Object.assign(Error('Bu alana erişim yetkiniz yok. / You do not have access to this area.'),{code:'AREA_FORBIDDEN',statusCode:403,errorEn:'You do not have access to this area.'});
    const check=()=>{if(state.revoked.has(profile.id))throw Object.assign(Error('stale / stale'),{code:'COMPUTE_STALE_GENERATION',statusCode:409});};
    return {profile,key:JSON.stringify({userId:profile.id,scope:profile.all?'all':'scoped'}),assertResponse:check};
  }};
  const loadProjection=async(req,module)=>{
    if(state.stale>0){state.stale--;throw Object.assign(Error('stale'),{code:'COMPUTE_STALE_GENERATION',statusCode:409});}
    const area=module==='overview'?'overview':module;
    if(!req.currentUser.areas.includes(area))throw Object.assign(Error('forbidden'),{code:'AREA_FORBIDDEN',statusCode:403});
    const built=projection(req.currentUser,module);
    return {value:{buffer:built.buffer,uncompressedBytes:built.buffer.length*10},manifest:{activeGeneration:state.generation,modules:{[module]:{checksum:built.checksum}}},assertResponse(){},release(){}};
  };
  const loadContext=createContextLoader({
    preferences:{load:()=>({entries:Object.fromEntries(Object.entries(state.prefs).map(([k,v])=>[k,{value:v}]))})},
    roleEntries:()=>({}),managedRules:()=>null,transitRules:()=>[{id:'t',seasons:[],countries:[],delType:'',days:30}],plmPayload:()=>null,
    checklistPayload:()=>({answers:{},tombstones:{}}),revision:()=>{state.contextLoads++;return state.contextRevision;},merge:(own,shared)=>Merge.merge(own,shared)});
  const calls=[];
  const runCompute=async(name,payload,options)=>{
    calls.push({cpBuffer:Boolean(payload.cp&&payload.cp.buffer),overviewBuffer:Boolean(payload.overview&&payload.overview.buffer),context:Boolean(payload.context),options});
    return {value:await task.execute(structuredClone(payload),{cache:worker.cache,engine}),release(){}};
  };
  const service=createOverviewModelService({guard,loadProjection,runCompute,loadContext,canAccessCp:req=>req.currentUser.areas.includes('cp')});
  return {state,service,calls};
}
const req=user=>({currentUser:user});
const body=(filters={main:{},bg:{}},lang='tr')=>({version:1,lang,filters});
const model=out=>JSON.parse(out.body);

test('request validation: unknown dimension, bad types and oversize values are 400',()=>{
  for(const bad of [null,[],{},{version:2},{version:1,lang:'de'},{version:1,filters:{main:{nope:['x']}}},{version:1,filters:{main:{country:'x'}}},
    {version:1,filters:{main:{country:[1]}}},{version:1,filters:{bg:{country:Array(501).fill('x')}}},{version:1,filters:{main:[]}}])
    assert.throws(()=>validateRequest(bad),error=>error.code==='READ_MODEL_QUERY_INVALID'&&error.statusCode===400,JSON.stringify(bad));
  // Değer sırası ve tekrar önbellek anahtarını değiştirmez.
  assert.deepEqual(validateRequest({version:1,filters:{main:{country:['b','a','a']}}}).filters.main,{country:['a','b']});
});

test('authorization: overview area is required; scope never leaks into totals; cache never crosses users',async()=>{
  worker.cache.clear();task.clearHosts();
  const {service}=harness();
  await assert.rejects(service.model(req(users.cpOnly),body()),error=>error.statusCode===403&&error.code==='AREA_FORBIDDEN');
  const full=model(await service.model(req(users.moderator),body())),scoped=model(await service.model(req(users.buyerA),body()));
  const all=projection(users.moderator,'cp').rows,visible=all.filter(row=>row.Buyer==='Buyer A');
  assert.ok(visible.length>0&&visible.length<all.length);
  assert.equal(full.cp.rows,all.length);
  assert.equal(scoped.cp.rows,visible.length);
  assert.equal(scoped.orders.kpi.total,projection(users.buyerA,'overview').rows.length);
  assert.ok(scoped.orders.kpi.total<full.orders.kpi.total);
  // CP özeti kapsamdaki satırları sayar: katalog öncelikleri toplamı = kapsam satırı.
  assert.equal(scoped.cp.summary.priorities.filter(item=>item.key!=='UNKNOWN').reduce((sum,item)=>sum+item.rows,0),visible.length);
  // Kapsam dışı satıra yönelik filtre boş döner.
  const probe=model(await service.model(req(users.buyerA),body({main:{buyer:['Buyer B']},bg:{}})));
  assert.equal(probe.cp.rows,0);assert.equal(probe.orders.kpi.total,0);assert.equal(probe.exceptionInbox.total,0);
});

test('user without CP area gets order KPIs only: no CP rows, no decisions, no exception inbox',async()=>{
  worker.cache.clear();task.clearHosts();
  const {service,state,calls}=harness();
  const out=model(await service.model(req(users.overviewOnly),body()));
  assert.equal(out.cp,null);assert.equal(out.exceptionInbox,null);
  assert.ok(out.orders.kpi.total>0);
  assert.equal(state.contextLoads,0,'karar bağlamı okunmadı');
  assert.ok(calls.every(call=>!call.cpBuffer&&!call.context));
});

test('cache: same request hits; filters, language and decision-context revision miss; worker gets buffers/context only once',async()=>{
  worker.cache.clear();task.clearHosts();
  const {service,state,calls}=harness();
  const first=await service.model(req(users.moderator),body());
  assert.equal(first.cached,false);
  assert.deepEqual(calls.map(call=>[call.cpBuffer,call.overviewBuffer,call.context]),[[false,false,false],[true,true,true]],'eksikler bir kez gönderildi');
  assert.equal((await service.model(req(users.moderator),body())).cached,true);
  calls.length=0;
  const filtered=await service.model(req(users.moderator),body({main:{country:['Egypt']},bg:{}}));
  assert.equal(filtered.cached,false);
  assert.deepEqual(calls.map(call=>[call.cpBuffer,call.overviewBuffer,call.context]),[[false,false,false]],'veri kümesi ve barındırıcı işçide yeniden kullanıldı');
  assert.ok(model(filtered).cp.rows<model(first).cp.rows);
  const en=model(await service.model(req(users.moderator),body(undefined,'en')));
  assert.equal(en.cp.summary.lang,'en');
  // Kişisel kural değişti → bağlam revizyonu değişir → yeni hesap, yeni sonuç.
  const OD=require('../public/order-decision-engine'),Rules=require('../public/cp-rules-engine');
  const catalog=OD.normalizePriorityCatalog([{id:'prio:vip',tr:'VIP',en:'VIP',tone:'red',isRisk:true},...OD.DEFAULT_PRIORITY_CATALOG]);
  const rule=Rules.normalizeRule({id:'vip',kind:'priority',target:'prio:vip',name:'VIP',conditions:[{field:'@qty',operator:'gte',value:130}]},{priorityCatalog:catalog});
  state.prefs['lcw.cp.rules.priority.v1']=JSON.stringify({version:1,rules:[rule],deletedRuleIds:[],priorityCatalog:catalog});
  assert.equal((await service.model(req(users.moderator),body())).cached,true,'revizyon değişmeden önbellek');
  state.contextRevision='c2';calls.length=0;
  const changed=await service.model(req(users.moderator),body());
  assert.equal(changed.cached,false);
  assert.ok(calls.some(call=>call.context),'yeni bağlam işçiye gönderildi');
  const vip=model(changed).cp.season.rows.reduce((sum,row)=>sum+(row.priorities['prio:vip']||0),0);
  assert.ok(vip>0,'yeni kural sezon × öncelik kırılımına yansıdı');
});

test('stale generation during the read is a 409 that the route retries',async()=>{
  worker.cache.clear();task.clearHosts();
  const {service,state}=harness();
  const app=express();
  const userAccess={sessionProfile:r=>r.currentUser,hasArea:(u,a)=>u.areas.includes(a)};
  app.use((r,_res,next)=>{r.currentUser=users[r.get('x-user')];next();});
  registerRoutes(app,{userAccess,apiError:(res,err)=>res.status(500).json({ok:false,code:err.code}),overviewModelService:service,getComputeReadGuard:()=>null});
  const server=app.listen(0);
  try{
    const url=`http://127.0.0.1:${server.address().port}/api/read-model/overview/model`;
    const post=(user,payload)=>fetch(url,{method:'POST',headers:{'content-type':'application/json','x-user':user},body:typeof payload==='string'?payload:JSON.stringify(payload)});
    state.stale=2;
    const ok=await post('moderator',body());
    assert.equal(ok.status,200);
    const json=await ok.json();
    assert.equal(json.ok,true);assert.equal(json.version,1);assert.ok(json.model.cp.rows>0);
    state.stale=5;
    const stale=await post('moderator',body());
    assert.equal(stale.status,409);assert.equal((await stale.json()).code,'COMPUTE_STALE_GENERATION');
    state.stale=0;
    assert.equal((await post('cpOnly',body())).status,403);
    assert.equal((await post('moderator','{bad')).status,400);
    const big=await post('moderator',JSON.stringify({version:1,filters:{main:{country:Array(4000).fill('x'.repeat(30))}}}));
    assert.equal(big.status,413);
    const invalid=await post('moderator',{version:1,filters:{main:{nope:['x']}}});
    assert.equal(invalid.status,400);assert.equal((await invalid.json()).code,'READ_MODEL_QUERY_INVALID');
  }finally{server.close();}
});

test('worker admission: inputBytes is the transferred compressed size, not the memory estimate (30k COMPUTE_QUEUE_BUSY regression)',async()=>{
  worker.cache.clear();task.clearHosts();
  const {service,calls}=harness();
  await service.model(req(users.moderator),body());
  const retry=calls.find(call=>call.cpBuffer);
  assert.ok(retry,'veri kümesi gönderildi');
  const transferred=retry.options.transferList.reduce((sum,buffer)=>sum+buffer.byteLength,0);
  assert.equal(retry.options.inputBytes,transferred);
  assert.ok(retry.options.estimatedBytes>transferred*6,'bellek tahmini çözülmüş boyutu kapsar');
  // Gerçek havuz kabulü: 30k CP projeksiyonu (~60 MB çözülmüş, ~5 MB gzip) varsayılan bütçeye sığar.
  const {createComputePool}=require('../server/lib/compute-pool');
  const pool=createComputePool({memoryBudgetBytes:1024*1024*1024,maxWorkers:1,workerFile:require.resolve('../server/lib/read-model/read-model-worker.js')});
  try{
    const {createOverviewModelService}=require('../server/lib/read-model/overview-model-service');
    const big=Buffer.alloc(5*1024*1024,1);
    const lease={value:{buffer:big,uncompressedBytes:60*1024*1024},manifest:{activeGeneration:'g',modules:{}},assertResponse(){},release(){}};
    let admitted=null;
    const svc=createOverviewModelService({guard:{capture:()=>({profile:users.moderator,key:'k',assertResponse(){}})},loadProjection:async()=>lease,
      loadContext:()=>({key:'c',value:{}}),canAccessCp:()=>true,
      runCompute:async(name,payload,options)=>{
        if(!payload.cp.buffer)return {value:{missing:['cp','overview']},release(){}};
        // Havuz kabul kontrolü gerçek; iş çalıştırılmadan reddedilirse hata fırlar.
        const job=pool.run('health',{},options);admitted=await job.then(()=>true,error=>error.code);
        return {value:{body:'{}',timing:{}},release(){}};
      }});
    await svc.model({currentUser:users.moderator},body());
    assert.equal(admitted,true);
  }finally{await pool.close();}
});
