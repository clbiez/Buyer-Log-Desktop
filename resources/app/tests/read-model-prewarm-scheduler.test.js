'use strict';
// #1077 — arka uç ön ısıtması: oturum tetikleyicisi, tercihlerden Genel Bakış gövdesi,
// 'background' önceliği, tek uçuş (istemci süren ön ısıtmaya katılır) ve tek işçide
// kullanıcı sorgusunun spekülatif ön ısıtmanın arkasında beklememesi (gerçek compute-pool).
const test=require('node:test'),assert=require('node:assert/strict');
const {Worker}=require('node:worker_threads');
const {createComputePool}=require('../server/lib/compute-pool');
const {createReadModelPrewarm,overviewBodyFor,prewarmEnabled}=require('../server/lib/read-model/prewarm-scheduler');

const tick=()=>new Promise(resolve=>setImmediate(resolve));
async function until(check,ms=5000){const end=Date.now()+ms;while(!check()){if(Date.now()>end)throw Error('timeout');await new Promise(r=>setTimeout(r,5));}}
function access({areas=['overview','cp','orders','koleksiyon'],session=true}={}){
  const state={session,prepared:0,revoked:new Set()};
  return {state,prepareComputeAccessContext:async()=>{state.prepared++;},
    sessionProfile:req=>state.session&&/bl=/.test(req.headers.cookie||'')&&!state.revoked.has(req.headers.cookie)?{id:'u1',enabled:true,status:'ACTIVE'}:null,
    hasArea:(profile,area)=>areas.includes(area)};
}
// compute-read-guard ile aynı sözleşme: damga kullanıcı/bağlamdır (aynı kullanıcının iki
// oturumu aynı damgayı taşır); assertResponse canlı oturumu yeniden okur.
function fakeGuard(userAccess){
  const fail=()=>Object.assign(Error('session'),{code:'SESSION_REQUIRED',statusCode:401});
  return {capture(r){
    const profile=userAccess.sessionProfile(r);if(!profile)throw fail();
    return {profile,key:JSON.stringify({userId:profile.id}),assertResponse(){if(!userAccess.sessionProfile(r))throw fail();}};
  }};
}
const req=(cookie='bl=abc')=>({headers:{cookie},currentUser:{id:'u1'},socket:{remoteAddress:'127.0.0.1'}});

test('overview body mirrors the client body from saved language and filters',()=>{
  const prefs={'lcw.lang.v1':'en','lcw.overview.dimFilters.v1':JSON.stringify({season:['SS26',7],bogus:['x'],buyer:[]}),'lcw.overview.bgDimFilters.v1':'{bad json'};
  assert.deepEqual(overviewBodyFor(key=>prefs[key]??null,'full'),{version:1,lang:'en',parts:'full',filters:{main:{season:['SS26','7']},bg:{}}});
  assert.deepEqual(overviewBodyFor(()=>null,'fast'),{version:1,lang:'tr',parts:'fast',filters:{main:{},bg:{}}});
  assert.equal(prewarmEnabled({}),true);assert.equal(prewarmEnabled({BL_READ_MODEL_PREWARM:'0'}),false);
});

function fakePool(){
  const jobs=[];
  return {jobs,stats:()=>({pending:jobs.filter(j=>!j.done).length,activeWorkers:0}),
    run(task,payload,options){
      return new Promise((resolve,reject)=>{
        const job={task,payload,options,done:false,resolve:value=>{job.done=true;resolve({value,release(){}});}};
        options.signal?.addEventListener('abort',()=>{if(!job.done){job.done=true;reject(Object.assign(Error('aborted'),{code:'COMPUTE_ABORTED'}));}},{once:true});
        jobs.push(job);
      });
    }};
}
function setup({areas,session,quietMs=0,cp=false,prefs={}}={}){
  const pool=fakePool(),userAccess=access({areas,session}),calls=[],projections=[];let prewarm;
  // Gerçek servis gibi: önce oturum/alan yakalanır (geçersiz oturum hesap başlatmaz).
  const service={async model(r,body,options){fakeGuard(userAccess).capture(r,'overview');calls.push({body,cookie:r.headers.cookie});const out=await prewarm.runCompute('read-model-overview',{parts:body.parts},{...options,ownerKey:'read-model',generation:'1',estimatedBytes:1});return {generation:'g',cached:false,body:JSON.stringify(out.value),timing:{}};}};
  // CP hesaplanmış sütun servisi (#1078): gerçek servis gibi önce oturum/alan, sonra havuz.
  // Gerçek servis gibi istemci sinyalini işçi işine iletmez (cp-computed-service workerOptions).
  const cpService={async computed(r,body,options){fakeGuard(userAccess).capture(r,'cp');calls.push({cp:body});const {signal,...rest}=options||{};void signal;const out=await prewarm.runCompute('read-model-cp-computed',{lang:body.lang},{...rest,ownerKey:'read-model',generation:'1',estimatedBytes:1});return {generation:'g',cached:false,body:JSON.stringify(out.value),timing:{}};}};
  prewarm=createReadModelPrewarm({getPool:()=>pool,userAccess,guard:fakeGuard(userAccess),preferenceValue:(_profile,key)=>prefs[key]??null,getOverviewService:()=>service,
    getCpComputedService:cp?()=>cpService:null,quietMs,
    loadProjection:async(r,module)=>{projections.push(module);return {release(){}};},defer:fn=>fn(),wait:()=>tick()});
  return {pool,userAccess,calls,projections,prewarm,proxy:prewarm.overviewServiceProxy()};
}

test('workspace opening starts one prewarm per session with background priority',async()=>{
  const h=setup();
  assert.equal(h.prewarm.noteSession({headers:{},currentUser:{id:'u1'}}),false,'no session cookie');
  assert.equal(h.prewarm.noteSession({headers:{cookie:'bl=abc'}}),false,'no authenticated user');
  assert.equal(h.prewarm.noteSession(req()),true);assert.equal(h.prewarm.noteSession(req()),false,'same session runs once');
  await until(()=>h.pool.jobs.length===1);
  assert.equal(h.pool.jobs[0].options.priority,'background');assert.equal(h.pool.jobs[0].payload.parts,'fast');
  h.pool.jobs[0].resolve({});await until(()=>h.pool.jobs.length===2);
  assert.equal(h.pool.jobs[1].payload.parts,'full');assert.equal(h.pool.jobs[1].options.priority,'background');
  h.pool.jobs[1].resolve({});
  await until(()=>h.prewarm.statusFor(req()).state==='done');
  assert.deepEqual(h.projections,['cp','orders','collection-catalog']);
  assert.deepEqual(h.prewarm.statusFor(req()).overview,{fast:'ready',full:'ready'});
  // Yeni oturum (yeniden giriş) tekrar ısıtır.
  assert.equal(h.prewarm.noteSession(req('bl=def')),true);
});

test('areas, logged-out sessions and the server switch gate the prewarm',async()=>{
  const none=setup({areas:['orders']});none.prewarm.noteSession(req());
  await until(()=>none.prewarm.statusFor(req()).state==='done');
  assert.equal(none.pool.jobs.length,0,'no overview area → no overview model');
  assert.deepEqual(none.projections,['orders']);
  const out=setup({session:false});out.prewarm.noteSession(req());
  await until(()=>out.prewarm.statusFor(req()).state==='skipped');
  assert.equal(out.pool.jobs.length,0);assert.deepEqual(out.projections,[]);
  const off=createReadModelPrewarm({getPool:fakePool,userAccess:access(),enabled:()=>false,defer:fn=>fn()});
  assert.equal(off.noteSession(req()),false);assert.deepEqual(off.statusFor(req()),{state:'disabled'});
});

test('a client asking for the same Overview body joins the running prewarm instead of computing twice',async()=>{
  const h=setup();h.prewarm.noteSession(req());
  await until(()=>h.pool.jobs.length===1);
  const client=h.proxy.model(req(),{version:1,lang:'tr',parts:'fast',filters:{main:{},bg:{}}},{});
  await tick();
  assert.equal(h.calls.length,1,'joined, no second service call');
  // Katılınan koşu artık spekülatif değil: Siparişler sorgusu onu iptal etmez.
  const orders=h.prewarm.runCompute('read-model-query',{},{ownerKey:'read-model',generation:'1',estimatedBytes:1});
  await tick();assert.equal(h.pool.jobs[0].done,false,'joined prewarm keeps running');
  h.pool.jobs[0].resolve({fast:true});
  assert.equal((await client).body,'{"fast":true}');
  await until(()=>h.pool.jobs.length===3);
  assert.equal(h.pool.jobs[2].payload.parts,'full');assert.equal(h.pool.jobs[2].options.priority,'interactive','joined run continues as interactive');
  h.pool.jobs[1].resolve({});h.pool.jobs[2].resolve({});await orders;
  // Farklı gövde katılmaz; servis doğrudan çağrılır.
  const other=h.proxy.model(req(),{version:1,lang:'en',parts:'fast',filters:{}},{});await tick();
  assert.equal(h.calls.length,3);h.pool.jobs.at(-1).resolve({});await other;
  assert.ok(h.prewarm.stats().joined>=1);
});

test('a second session that joins a prewarm is revalidated before it receives the shared model',async()=>{
  const h=setup();h.prewarm.noteSession(req('bl=first'));
  await until(()=>h.pool.jobs.length===1);
  const body={version:1,lang:'tr',parts:'fast',filters:{main:{},bg:{}}};
  const second=h.proxy.model(req('bl=second'),body,{}).then(value=>({value}),error=>({error}));
  await tick();assert.equal(h.calls.length,1,'same user and context: the second session joins');
  h.userAccess.state.revoked.add('bl=second');
  h.pool.jobs[0].resolve({fast:true});
  const out=await second;
  assert.equal(out.error?.code,'SESSION_REQUIRED','revoked joining session must not receive the model');
  // Ön ısıtmanın kendi oturumu geçerli: koşu tamamlanır.
  await until(()=>h.pool.jobs.length===2);h.pool.jobs[1].resolve({});
  await until(()=>h.prewarm.statusFor(req('bl=first')).state==='done');
  // Geçersiz oturum hiç katılmaz (yakalama başarısız): servis kendi 401'ini verir.
  h.userAccess.state.revoked.add('bl=third');
  const before=h.calls.length,third=await h.proxy.model(req('bl=third'),body,{}).then(()=>null,error=>error);
  assert.equal(third?.code,'SESSION_REQUIRED');assert.equal(h.calls.length,before,'no computation for an invalid session');
});

test('an interactive read model job preempts a speculative prewarm; a different Overview body does not',async()=>{
  const h=setup();h.prewarm.noteSession(req());
  await until(()=>h.pool.jobs.length===1);
  const overview=h.prewarm.runCompute('read-model-overview',{},{ownerKey:'read-model',generation:'1',estimatedBytes:1});
  await tick();assert.equal(h.pool.jobs[0].done,false,'same-screen Overview work does not reset the worker');
  h.pool.jobs.at(-1).resolve({});await overview;
  const orders=h.prewarm.runCompute('read-model-query',{},{ownerKey:'read-model',generation:'1',estimatedBytes:1});
  await tick();
  assert.equal(h.pool.jobs[0].done,true,'speculative prewarm aborted');
  assert.equal(h.pool.jobs.at(-1).options.priority,undefined,'user job keeps the pool default (interactive)');
  h.pool.jobs.at(-1).resolve({rows:1});await orders;
  // Okuma modeli sessizleşince ön ısıtma yeniden dener ve tamamlanır.
  await until(()=>h.pool.jobs.filter(j=>!j.done).length===1);
  assert.equal(h.pool.jobs.at(-1).payload.parts,'fast');h.pool.jobs.at(-1).resolve({});
  await until(()=>h.pool.jobs.filter(j=>!j.done).length===1);h.pool.jobs.at(-1).resolve({});
  await until(()=>h.prewarm.statusFor(req()).state==='done');
  assert.equal(h.prewarm.stats().preempted,1);
});

// Gerçek compute-pool, tek işçi: ön ısıtma işi işçiyi ~4 sn meşgul tutar.
const BUSY_WORKER=`const {parentPort}=require('node:worker_threads');
parentPort.on('message',m=>{if(m.type!=='run')return;const end=Date.now()+(m.payload.busyMs||0);while(Date.now()<end){}
  parentPort.postMessage({type:'result',id:m.id,ok:true,value:{task:m.task},metrics:{retainedBytes:0,outputBytes:0}});});`;
class BusyWorker extends Worker{constructor(_file,options){super(BUSY_WORKER,{...options,eval:true});}}

test('with the real single-worker pool a user query does not wait behind a speculative prewarm',async()=>{
  const pool=createComputePool({maxWorkers:1,memoryBudgetBytes:256*1024*1024,WorkerClass:BusyWorker,timeoutMs:20000});
  try{
    const prewarm=createReadModelPrewarm({getPool:()=>pool,userAccess:access(),defer:fn=>fn()});
    const opts={ownerKey:'read-model',generation:'1',estimatedBytes:1024};
    // Sıcak işçi (ilk kurulum ölçümü bozmasın).
    (await pool.run('warm',{},opts)).release();
    const run={controller:new AbortController(),speculative:true,jobs:0};
    // Ön ısıtma koşusu bağlamında bir iş (scheduler'ın test kancası).
    const speculative=prewarm._runInPrewarm(run,()=>prewarm.runCompute('read-model-overview',{busyMs:4000},{...opts,signal:run.controller.signal})).then(()=>null,error=>error);
    await new Promise(r=>setTimeout(r,150));
    const started=Date.now();
    const user=await prewarm.runCompute('read-model-query',{busyMs:20},opts);user.release();
    const waited=Date.now()-started;
    assert.equal((await speculative)?.code,'COMPUTE_ABORTED');
    assert.ok(waited<2500,`user query waited ${waited} ms behind the prewarm`);
    // Katılınmış (spekülatif olmayan) ön ısıtma kesilmez: kullanıcı işi sırasını bekler.
    const joined={controller:new AbortController(),speculative:false,jobs:0};
    const kept=prewarm._runInPrewarm(joined,()=>prewarm.runCompute('read-model-overview',{busyMs:600},{...opts,signal:joined.controller.signal}));
    await new Promise(r=>setTimeout(r,50));
    const after=await prewarm.runCompute('read-model-query',{busyMs:1},opts);after.release();
    (await kept).release();
  }finally{await pool.close();}
});

/* #1078 satır yaması: CP hesabı oturum açılınca ısıtılır (ilk CP açılışı/filtre soğuk hesap beklemez).
   Kullanıcının CP okuması süren CP ısıtmasını kesmez (kesmek işçiyi emekli eder; aynı hesap soğuk baştan). */
test('CP computed columns are warmed after Overview with the saved language; CP reads join a running CP warm',async()=>{
  const h=setup({cp:true,prefs:{'lcw.lang.v1':'en'}});h.prewarm.noteSession(req());
  await until(()=>h.pool.jobs.length===1);h.pool.jobs[0].resolve({});
  await until(()=>h.pool.jobs.length===2);h.pool.jobs[1].resolve({});
  await until(()=>h.pool.jobs.length===3);
  const warm=h.pool.jobs[2];
  assert.equal(warm.task,'read-model-cp-computed');assert.equal(warm.options.priority,'background');
  assert.deepEqual(h.calls.at(-1),{cp:{version:1,lang:'en'}},'istemcinin ilk gövdesi (kayıtlı dil)');
  // Kullanıcının CP okuması ısıtmayı kesmez; Siparişler sorgusu keserdi.
  const read=h.prewarm.runCompute('read-model-cp-query',{},{ownerKey:'read-model',generation:'1',estimatedBytes:1});
  await tick();
  assert.equal(warm.done,false,'CP ısıtması iptal edilmedi');assert.equal(h.prewarm.stats().preempted,0);
  warm.resolve({});h.pool.jobs.at(-1).resolve({});await read;
  await until(()=>h.prewarm.statusFor(req()).state==='done');
  assert.equal(h.prewarm.statusFor(req()).cp,'ready');
  assert.deepEqual(h.projections,['cp','orders','collection-catalog']);
});
test('CP warm is skipped without the CP area or when the user turned server computed columns off',async()=>{
  const noArea=setup({cp:true,areas:['overview']});noArea.prewarm.noteSession(req());
  await until(()=>noArea.pool.jobs.length===1);noArea.pool.jobs[0].resolve({});
  await until(()=>noArea.pool.jobs.length===2);noArea.pool.jobs[1].resolve({});
  await until(()=>noArea.prewarm.statusFor(req()).state==='done');
  assert.equal(noArea.prewarm.statusFor(req()).cp,'skipped');assert.equal(noArea.pool.jobs.length,2);
  const optOut=setup({cp:true,prefs:{'bl.cpComputed.v1':'0'}});optOut.prewarm.noteSession(req());
  await until(()=>optOut.pool.jobs.length===1);optOut.pool.jobs[0].resolve({});
  await until(()=>optOut.pool.jobs.length===2);optOut.pool.jobs[1].resolve({});
  await until(()=>optOut.prewarm.statusFor(req()).state==='done');
  assert.equal(optOut.prewarm.statusFor(req()).cp,'disabled');assert.equal(optOut.pool.jobs.length,2);
});

/* Codex #1096 P2: CP servisi istemci sinyalini işçiye iletmez; spekülatif CP ısıtmasının iptali zamanlayıcının kendi
   sinyaliyle havuza ulaşmalı. Aksi halde Siparişler gibi bir kullanıcı işi soğuk CP hesabının arkasında bekler. */
test('a speculative CP warm job carries the scheduler signal: a non-CP user job preempts it',async()=>{
  const h=setup({cp:true});h.prewarm.noteSession(req());
  await until(()=>h.pool.jobs.length===1);h.pool.jobs[0].resolve({});
  await until(()=>h.pool.jobs.length===2);h.pool.jobs[1].resolve({});
  await until(()=>h.pool.jobs.length===3);
  const warm=h.pool.jobs[2];
  assert.equal(warm.task,'read-model-cp-computed');assert.ok(warm.options.signal,'işçi işinde iptal sinyali var');
  const orders=h.prewarm.runCompute('read-model-query',{},{ownerKey:'read-model',generation:'1',estimatedBytes:1});
  await tick();
  assert.equal(warm.done,true,'spekülatif CP ısıtması iptal edildi');assert.equal(h.prewarm.stats().preempted,1);
  h.pool.jobs.at(-1).resolve({rows:1});await orders;
});
