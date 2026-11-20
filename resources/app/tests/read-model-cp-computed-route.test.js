'use strict';
/* WS5 (#1078): CP hesaplanmış sütun servisi ve POST /api/read-model/cp/computed
   sözleşmesi — CP alan yetkisi, kapsam yalıtımı (kapsam dışı satır yanıta girmez),
   önbelleğin kullanıcılar arasında paylaşılmaması, bağlam/dil/gün ile önbellek,
   boş ve dolu delta, test raporu görevi süzmesi, bayat nesil yeniden denemesi,
   gövde doğrulaması ve gerçek compute-pool işçisinde uçtan uca görev. */
const test=require('node:test'),assert=require('node:assert/strict');
const zlib=require('node:zlib'),crypto=require('node:crypto');
const express=require('express');
const tasks=require('../server/lib/compute-tasks'),access=require('../server/lib/compute-access');
const worker=require('../server/lib/read-model/read-model-worker');
const engine=require('../server/lib/read-model/query-engine');
const task=require('../server/lib/read-model/cp-computed-task');
const {createCpComputedService,createTaskLoader,validateRequest}=require('../server/lib/read-model/cp-computed-service');
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
function harness({day='2026-11-20',realGuard=false}={}){
  const state={generation:`g${++harnessId}-${process.pid}`,stale:0,revoked:new Set(),own:{},contextRevision:'c1',day,tasks:[],authorizedCalls:0,contextHash:'h1',mutate:null};
  const guard={capture(req,area){
    const profile=req.currentUser;
    if(!profile.areas.includes(area))throw Object.assign(Error('Bu alana erişim yetkiniz yok. / You do not have access to this area.'),{code:'AREA_FORBIDDEN',statusCode:403,errorEn:'You do not have access to this area.'});
    const check=()=>{if(state.revoked.has(profile.id))throw Object.assign(Error('stale / stale'),{code:'COMPUTE_STALE_GENERATION',statusCode:409});};
    // compute-read-guard ile aynı biçim: veri sürümü (contextHash/sourceToken) her yazmada değişir.
    if(realGuard){const initial={userId:profile.id,contextHash:state.contextHash,accessHash:profile.all?'all':'scoped',sourceToken:state.generation};return {profile,key:JSON.stringify(initial),...initial,assertResponse:check};}
    return {profile,key:JSON.stringify({userId:profile.id,scope:profile.all?'all':'scoped'}),assertResponse:check};
  }};
  const loadProjection=async req=>{
    if(state.stale>0){state.stale--;throw Object.assign(Error('stale'),{code:'COMPUTE_STALE_GENERATION',statusCode:409});}
    if(!req.currentUser.areas.includes('cp'))throw Object.assign(Error('forbidden'),{code:'AREA_FORBIDDEN',statusCode:403});
    let built=projection(req.currentUser);
    if(state.mutate){const rows=structuredClone(built.rows);state.mutate(rows);const buffer=zlib.gzipSync(Buffer.from(tasks.serialize({rows},'projection')));built={rows,buffer,checksum:crypto.createHash('sha256').update(buffer).digest('hex')};}
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
    assert.equal(name,'read-model-cp-computed');
    calls.push({buffer:Boolean(payload.dataset&&payload.dataset.buffer),since:payload.since,tasks:payload.tasks,options});
    return {value:await task.execute(structuredClone(payload),{cache:worker.cache,engine}),release(){}};
  };
  const service=createCpComputedService({guard,loadProjection,runCompute,loadContext,loadTasks,today:()=>state.day});
  return {state,service,calls,allOrders};
}
const req=user=>({currentUser:user});
const columns=out=>JSON.parse(out.body);

test('request validation: version, lang, since token and unknown keys',()=>{
  for(const bad of [null,[],{},{version:2},{version:1,lang:'de'},{version:1,since:5},{version:1,since:'x'.repeat(65)},{version:1,since:'a b'},{version:1,rows:[]}])
    assert.throws(()=>validateRequest(bad),error=>error.code==='READ_MODEL_QUERY_INVALID'&&error.statusCode===400,JSON.stringify(bad));
  assert.deepEqual(validateRequest({version:1}),{lang:'tr',since:null,answers:null});
  assert.deepEqual(validateRequest({version:1,lang:'en',since:'abc_-9'}),{lang:'en',since:'abc_-9',answers:null});
  for(const answers of [[],'x',{nokey:{state:'open'}},{'a::b':{state:5}},{'a::b':[]},{'a::b':{state:'x'.repeat(65)}},{'a::b':{state:'open',note:'x'.repeat(17000)}},
    Object.fromEntries(Array.from({length:5001},(_,i)=>[`o${i}::pps`,null]))])
    assert.throws(()=>validateRequest({version:1,answers}),error=>error.statusCode===400,JSON.stringify(answers).slice(0,80));
  assert.deepEqual(validateRequest({version:1,answers:{'b::x':null,'a::y':{state:'open'}}}).answers,{'a::y':{state:'open'},'b::x':null});
  assert.equal(validateRequest({version:1,answers:{}}).answers,null);
});

test('authorization: CP area is required; scoped user gets only rows in scope; cache never crosses users',async()=>{
  worker.cache.clear();task.clearHosts();
  const {service}=harness();
  await assert.rejects(service.computed(req(users.overviewOnly),{version:1}),error=>error.statusCode===403&&error.code==='AREA_FORBIDDEN');
  const all=columns(await service.computed(req(users.moderator),{version:1}));
  const scoped=columns(await service.computed(req(users.buyerA),{version:1}));
  const allIds=new Set(all.rows.map(row=>row[0])),scopedIds=scoped.rows.map(row=>row[0]);
  const inScope=new Set(projection(users.buyerA).rows.map(row=>String(row._id)));
  assert.equal(all.total,projection(users.moderator).rows.length);assert.equal(scoped.total,inScope.size);
  assert.ok(scoped.total>0&&scoped.total<all.total,'kapsam daraltıldı');
  assert.ok(scopedIds.every(id=>inScope.has(id)&&allIds.has(id)),'kapsam dışı satır yanıta girmedi');
  assert.deepEqual(scoped.fields,task.FIELDS);
  // Satır demeti: öncelik kodu ve checklist hücreleri dolu.
  assert.ok(all.rows.every(row=>typeof row[1]==='string'&&row[1]&&row[8]&&typeof row[8].cells==='object'));
});

test('cache and delta: same request hits; language, context revision and day miss; unchanged since is an empty delta without the worker',async()=>{
  worker.cache.clear();task.clearHosts();
  const {service,state,calls}=harness();
  const first=await service.computed(req(users.moderator),{version:1});
  assert.equal(first.cached,false);assert.equal(calls.length,2,'ilk istek veri kümesini bir kez gönderdi (eksik → yeniden)');
  assert.equal(calls[0].buffer,false);assert.equal(calls[1].buffer,true);
  const head=columns(first);
  assert.equal((await service.computed(req(users.moderator),{version:1})).cached,true);
  const empty=await service.computed(req(users.moderator),{version:1,since:head.token});
  assert.equal(calls.length,2,'değişmeyen bağlamda işçiye gidilmedi');
  assert.deepEqual(columns(empty).rows,[]);assert.equal(columns(empty).delta,true);
  // Dil: hücre etiketleri dile bağlıdır.
  const en=columns(await service.computed(req(users.moderator),{version:1,lang:'en'}));
  assert.equal(en.lang,'en');assert.equal(calls.length,3);
  assert.ok(JSON.stringify(en.rows).includes('Pending')&&JSON.stringify(head.rows).includes('Bekliyor'),'checklist etiketleri dile göre');
  // Gün değişimi: kararlar yerel güne bağlıdır.
  state.day='2026-11-21';
  assert.equal((await service.computed(req(users.moderator),{version:1})).cached,false);
  assert.equal(calls.length,4);
  // Checklist cevabı (bağlam revizyonu) → delta yalnız etkilenen satırları taşır, barındırıcı korunur.
  const latest=columns(await service.computed(req(users.moderator),{version:1}));
  // Satıra uygulanan (hücresi dolu) bir checklist kalemi seçilir.
  const pick=latest.rows.find(row=>row[8]&&Object.keys(row[8].status).length);
  assert.ok(pick,'uygulanan checklist kalemi var');
  const item=Object.keys(pick[8].status)[0];
  const target=projection(users.moderator).rows.find(row=>String(row._id)===pick[0]),key=Readiness.analyzeOrder(target).orderKey;
  state.own={[`${key}::${item}`]:{state:'approved',at:'2026-11-20T10:00:00.000Z',by:'moderator'}};state.contextRevision='c2';
  const hosts=task.hostCount();
  const delta=await service.computed(req(users.moderator),{version:1,since:latest.token});
  const body=columns(delta);
  assert.equal(body.delta,true);assert.equal(task.hostCount(),hosts,'cevap değişikliğinde yeni barındırıcı kurulmadı');
  assert.ok(body.rows.length>=1&&body.rows.length<body.total,`yalnız değişen satırlar (${body.rows.length}/${body.total})`);
  const changed=body.rows.find(row=>row[0]===String(target._id));
  assert.ok(changed,'cevabı değişen satır deltada');assert.equal(changed[8].status[item],'approved');
  assert.equal(delta.timing.phases.hostMs,0);
  // Bilinmeyen token: tam yanıt.
  state.contextRevision='c3';
  const full=columns(await service.computed(req(users.moderator),{version:1,since:'unknown-token'}));
  assert.equal(full.delta,false);assert.equal(full.rows.length,full.total);
});

test('test report tasks: only authorized orders reach the worker; empty task store skips authorization',async()=>{
  worker.cache.clear();task.clearHosts();
  const {service,state,calls}=harness();
  await service.computed(req(users.buyerA),{version:1});
  assert.equal(state.authorizedCalls,0,'görev yoksa yetki modeli kurulmadı');
  const mod=projection(users.moderator).rows,inScope=new Set(projection(users.buyerA).rows.map(row=>Readiness.analyzeOrder(row).orderKey));
  const visible=mod.map(row=>Readiness.analyzeOrder(row).orderKey).find(key=>inScope.has(key));
  const hidden=mod.map(row=>Readiness.analyzeOrder(row).orderKey).find(key=>!inScope.has(key));
  state.tasks=[{id:'a',orderKey:visible,itemId:'tests',title:'Görünür'},{id:'b',orderKey:hidden,itemId:'tests',title:'Gizli'}];
  const out=columns(await service.computed(req(users.buyerA),{version:1}));
  assert.deepEqual(calls.at(-1).tasks.map(item=>item.id),['a'],'yetkisiz siparişin görevi işçiye gitmedi');
  assert.ok(!JSON.stringify(out).includes('Gizli'));
  assert.ok(out.rows.some(row=>row[8]&&row[8].tasks.tests&&row[8].tasks.tests[0].id==='a'),'görev hücrede');
});

test('stale generation during the read is a 409 that the route retries; body, size and area errors',async()=>{
  worker.cache.clear();task.clearHosts();
  const {service,state}=harness();
  const app=express();
  const userAccess={sessionProfile:r=>r.currentUser,hasArea:(u,a)=>u.areas.includes(a)};
  app.use((r,_res,next)=>{r.currentUser=users[r.get('x-user')];next();});
  registerRoutes(app,{userAccess,apiError:(res,err)=>res.status(500).json({ok:false,code:err.code}),cpComputedService:service,getComputeReadGuard:()=>null});
  const server=app.listen(0);
  try{
    const url=`http://127.0.0.1:${server.address().port}/api/read-model/cp/computed`;
    const post=(user,payload)=>fetch(url,{method:'POST',headers:{'content-type':'application/json','x-user':user},body:typeof payload==='string'?payload:JSON.stringify(payload)});
    state.stale=2;
    const ok=await post('moderator',{version:1});
    assert.equal(ok.status,200);
    const json=await ok.json();
    assert.equal(json.ok,true);assert.equal(json.version,1);assert.equal(json.columns.total,projection(users.moderator).rows.length);assert.equal(json.columns.rows.length,json.columns.total);
    state.stale=5;
    const stale=await post('moderator',{version:1});
    assert.equal(stale.status,409);assert.equal((await stale.json()).code,'COMPUTE_STALE_GENERATION');
    state.stale=0;
    assert.equal((await post('overviewOnly',{version:1})).status,403);
    assert.equal((await post('moderator','{bad')).status,400);
    assert.equal((await post('moderator',JSON.stringify({version:1,since:'x'.repeat(1100*1024)}))).status,413);
    const invalid=await post('moderator',{version:1,lang:'de'});
    assert.equal(invalid.status,400);assert.equal((await invalid.json()).code,'READ_MODEL_QUERY_INVALID');
    // Yetki okuma sırasında düşerse yanıt verilmez (409).
    state.revoked.add('moderator');
    assert.equal((await post('moderator',{version:1,lang:'en'})).status,409);
  }finally{server.close();}
});

test('real compute-pool worker: async task runs once, shares the dataset cache and reserves decision memory',async()=>{
  const {createComputePool}=require('../server/lib/compute-pool');
  const MiB=1024*1024;
  const pool=createComputePool({memoryBudgetBytes:1024*MiB,maxWorkers:1,workerFile:require.resolve('../server/lib/read-model/read-model-worker.js')});
  try{
    const {state}=harness();
    const estimates=[];
    const service=createCpComputedService({
      guard:{capture:r=>({profile:r.currentUser,key:'k-'+r.currentUser.id,assertResponse(){}})},
      loadProjection:async r=>{const built=projection(r.currentUser);return {value:{buffer:built.buffer,uncompressedBytes:built.buffer.length*10},manifest:{activeGeneration:state.generation,modules:{cp:{checksum:built.checksum}}},assertResponse(){},release(){}};},
      loadContext:()=>({key:'c1',value:{userId:'moderator',entries:{},answers:{},managedRules:null,plm:null,transitRules:[]}}),
      runCompute:(name,payload,options)=>{estimates.push(options.estimatedBytes);return pool.run(name,payload,options);},
      today:()=>state.day,
    });
    const out=await service.computed(req(users.moderator),{version:1});
    const body=columns(out);
    assert.equal(body.total,projection(users.moderator).rows.length);assert.equal(body.rows.length,body.total);
    assert.ok(estimates.every(value=>value>96*MiB),'karar katmanı payı ayrıldı');
    // Önbellekteki veri kümesiyle ikinci hesap (bağlam değişti): veri kümesi yeniden gönderilmez.
    const second=await createCpComputedService({
      guard:{capture:r=>({profile:r.currentUser,key:'k-'+r.currentUser.id,assertResponse(){}})},
      loadProjection:async r=>{const built=projection(r.currentUser);return {value:{buffer:built.buffer,uncompressedBytes:built.buffer.length*10},manifest:{activeGeneration:state.generation,modules:{cp:{checksum:built.checksum}}},assertResponse(){},release(){}};},
      loadContext:()=>({key:'c2',value:{userId:'moderator',entries:{},answers:{},managedRules:null,plm:null,transitRules:[]}}),
      runCompute:(name,payload,options)=>{estimates.push(payload.dataset.buffer?'buffer':'cached');return pool.run(name,payload,options);},
      today:()=>state.day,
    }).computed(req(users.moderator),{version:1});
    assert.equal(estimates.at(-1),'cached');
    assert.equal(columns(second).total,body.total);
    // Sorgu görevi aynı işçide hâlâ çalışır (eşzamanlı dinleyici bu görevi yanıtlamaz).
    assert.deepEqual((await pool.run('health',{},{estimatedBytes:MiB,ownerKey:'read-model',generation:'1'})).value,{ok:true});
  }finally{await pool.close();}
});

test('pending-answer overlay: applies only to this request and user, is part of the cache key, never persisted',async()=>{
  worker.cache.clear();task.clearHosts();
  const {service,state}=harness();
  const base=columns(await service.computed(req(users.moderator),{version:1}));
  const pick=base.rows.find(row=>row[8]&&Object.keys(row[8].status).length),item=Object.keys(pick[8].status)[0];
  const target=projection(users.moderator).rows.find(row=>String(row._id)===pick[0]),key=`${Readiness.analyzeOrder(target).orderKey}::${item}`;
  const overlay={[key]:{state:'rejected',at:'2026-11-20T12:00:00.000Z',by:'moderator',note:'Renk'}};
  const delta=columns(await service.computed(req(users.moderator),{version:1,since:base.token,answers:overlay}));
  assert.equal(delta.delta,true);
  assert.equal(delta.rows.find(row=>row[0]===pick[0])[8].status[item],'rejected','katman uygulandı');
  assert.deepEqual(state.own,{},'sunucu kaydı değişmedi');
  // Katmansız aynı istek önbellekteki katmanlı sonucu almaz.
  const plain=columns(await service.computed(req(users.moderator),{version:1}));
  assert.equal(plain.rows.find(row=>row[0]===pick[0])[8].status[item],pick[8].status[item]);
  // Başka kullanıcı etkilenmez.
  const other=columns(await service.computed(req(users.buyerA),{version:1}));
  assert.ok(!JSON.stringify(other).includes('rejected'));
  // Katman kaldırılınca (senkron tamamlandı, sunucu cevabı yok) önceki değere döner.
  const back=columns(await service.computed(req(users.moderator),{version:1,since:delta.token}));
  assert.equal(back.rows.find(row=>row[0]===pick[0])[8].status[item],pick[8].status[item]);
  // İstemci araya giren bir sonucu atmış olabilir: daha eski (geçmişteki) token da delta alır.
  const older=columns(await service.computed(req(users.moderator),{version:1,since:base.token,answers:overlay}));
  assert.equal(older.delta,true,'geçmişteki token ile delta');
  assert.deepEqual(older.rows.map(row=>row[0]),[pick[0]],'yalnız tabana göre değişen satır');
});

test('an edit (new generation, new data version) keeps the decision host and recomputes only the affected rows (#1078 alt PR 3)',async()=>{
  worker.cache.clear();task.clearHosts();
  const {service,state}=harness({realGuard:true});
  const first=await service.computed(req(users.moderator),{version:1});
  assert.equal(first.timing.phases.incremental,undefined);
  const before=new Map(columns(first).rows.map(row=>[row[0],JSON.stringify(row)]));
  // Düzenleme: yeni projeksiyon nesli + guard veri sürümü değişir (override yazımı); bir satırın notu.
  state.generation+='-e1';state.contextHash='h2';state.mutate=rows=>{rows[5].Notes='düzenlendi';};
  const second=await service.computed(req(users.moderator),{version:1});
  assert.equal(second.cached,false);
  assert.ok(!(second.timing.phases.hostMs>0),'barındırıcı yeniden kurulmadı');
  assert.equal(second.timing.phases.incremental.changed,1,JSON.stringify(second.timing.phases.incremental));
  assert.ok(second.timing.phases.incremental.targets<before.size,'yalnız etkilenen satırlar');
  // Tam hesapla aynı sonuç.
  worker.cache.clear();task.clearHosts();
  const fresh=harness({realGuard:true});fresh.state.mutate=state.mutate;
  const full=await fresh.service.computed(req(users.moderator),{version:1});
  assert.equal(full.timing.phases.incremental,undefined);
  assert.deepEqual(columns(second).rows,columns(full).rows);
  // Takvim/gün bağımlılığı (revision) ya da yetki kapsamı değişince barındırıcı paylaşılmaz.
  state.contextRevision='c2';state.generation+='-e2';
  const third=await service.computed(req(users.moderator),{version:1});
  assert.equal(third.timing.phases.incremental,undefined,'revision değişti → tam hesap');
  const scoped=await service.computed(req(users.buyerA),{version:1});
  assert.equal(scoped.timing.phases.incremental,undefined,'başka yetki kapsamı → ayrı barındırıcı');
});
