'use strict';
/* Okuma modeli ön ısıtması (#1077, WS4).
 *
 * Eskiden açılıştan sonra arayüz iş parçacığı Koleksiyon → CP → Siparişler →
 * Backlog'u tam veriyle hazırlıyordu (scheduleBackgroundModuleWarmup). Anahtar
 * açıkken bu iş yerel arka uca taşınır: oturumun ilk kimlikli isteğinde arka uç
 * kullanıcının erişebildiği okuma modeli önbelleğini kendi işçisinde ısıtır.
 * Tetikleyici yalnız çalışma alanı açılışıdır (server.js: GET / ve /api/data?mode=initial);
 * diğer API çağrıları ön ısıtma başlatmaz.
 *
 * Sıra (oturum başına bir kez, kullanıcı başına tek koşu):
 *  1. Genel Bakış modeli 'fast' ve 'full' aşamaları: kullanıcının sunucudaki dil
 *     ve Genel Bakış filtre tercihleriyle, istemcinin isteyeceği gövdenin aynısı.
 *     Sonuç Genel Bakış servisinin önbelleğine girer; işçide veri kümeleri ve
 *     karar barındırıcısı sıcak kalır (filtre değişse de pahalı karar işi tekrar
 *     edilmez).
 *  2. CP hesaplanmış sütunları (#1078): kullanıcının dili, istemcinin ilk isteğiyle aynı gövde. Sonuç CP
 *     servisinin önbelleğine girer; işçide CP karar barındırıcısı sıcak kalır (ilk filtre/CP açılışı soğuk
 *     hesap beklemez). CP alanı yoksa atlanır. 'bl.cpComputed.v1' tercihi cihazda kalır (sunucuya eşitlenmez);
 *     sunucuda '0' kaydı varsa atlanır, yoksa ısıtılır: iş 'background' önceliklidir ve CP dışı her
 *     kullanıcı işi onu keser (kapatmış kullanıcıda maliyet boşta geçen işçi zamanıdır).
 *  3. CP / Siparişler / Koleksiyon sayfa projeksiyonları (sayfa önbelleği).
 *
 * Tek işçi (maxWorkers:1) güvenceleri:
 *  - Ön ısıtma işleri havuza 'background' önceliğiyle girer; kuyrukta bekleyen
 *    kullanıcı isteği her zaman önce başlar.
 *  - Kimsenin beklemediği (spekülatif) bir ön ısıtma işi çalışırken ya da kuyruktayken
 *    kullanıcıdan yeni bir okuma modeli işi (Siparişler sorgusu, CP hesaplanmış sütunlar,
 *    Akış Haritası…)
 *    gelirse ön ısıtma iptal edilir (istisna: CP okuması süren CP ısıtmasını kesmez, ona katılır —
 *    iptal işçiyi emekli eder ve CP isteği aynı hesabı soğuk baştan yapardı)
 *    (havuz çalışan işi işçiyi emekli ederek keser). Kullanıcı sorgusu ön ısıtmanın
 *    arkasında beklemez; ön ısıtma okuma modeli sessizleşince yeniden dener.
 *  - İstemci aynı Genel Bakış gövdesini isterse ikinci bir hesap başlatılmaz:
 *    istek süren ön ısıtmaya katılır ve o koşu artık spekülatif sayılmaz
 *    (iptal edilmez, kalan işleri 'interactive' önceliğe geçer).
 * Yetki: koşu, oturumun çerez başlığının bir kopyasıyla aynı servisleri çağırır.
 * Her okuma guard.capture + assertResponse ile canlı oturumu doğrular; çıkış
 * yapılmış ya da yetkisi düşmüş oturum için hiçbir şey hesaplanmaz.
 * Anahtar: BL_READ_MODEL_PREWARM=0 ön ısıtmayı kapatır (istemci anahtarı ayrı:
 * window.BL_READ_MODEL_PREWARM=false eski arayüz hazırlığına döner).
 */
const crypto=require('node:crypto');
const {AsyncLocalStorage}=require('node:async_hooks');
const {validateRequest}=require('./overview-model-service');
const Model=require('../../../public/overview-model');

// Sayfa projeksiyonu → alan. Genel Bakış projeksiyonu istemci açılışta zaten ister.
const PROJECTIONS=Object.freeze([['cp','cp'],['orders','orders'],['collection-catalog','koleksiyon']]);
const LANG_KEY='lcw.lang.v1';
const CP_COMPUTED_PREF='bl.cpComputed.v1';
const CP_TASKS=new Set(['read-model-cp-computed','read-model-cp-query']);
const FILTER_KEYS=Object.freeze({main:'lcw.overview.dimFilters.v1',bg:'lcw.overview.bgDimFilters.v1'});
const hash=value=>crypto.createHash('sha256').update(String(value)).digest('hex').slice(0,32);
const abortedError=()=>Object.assign(new Error('Ön ısıtma iptal edildi. / Prewarm cancelled.'),{code:'COMPUTE_ABORTED',statusCode:499});

function prewarmEnabled(env=process.env){return String(env.BL_READ_MODEL_PREWARM??'1')!=='0';}

/* İstemcinin overviewModelBody() ile aynı gövde: kayıtlı dil + kayıtlı filtreler.
   Bilinmeyen boyut/boş değer istemcideki loadOvDimFilters gibi atılır. */
function overviewBodyFor(read,parts){
  const lang=read(LANG_KEY)==='en'?'en':'tr',filters={};
  for(const [scope,key] of Object.entries(FILTER_KEYS)){
    const clean={};
    try{
      const raw=read(key),parsed=raw?JSON.parse(raw):null;
      if(parsed&&typeof parsed==='object'&&!Array.isArray(parsed))for(const [dim,values] of Object.entries(parsed)){
        if(Object.hasOwn(Model.DIM_COLUMNS,dim)&&Array.isArray(values)&&values.length)clean[dim]=values.map(String);
      }
    }catch(_){/* bozuk tercih: filtresiz */}
    filters[scope]=clean;
  }
  return {version:1,lang,parts,filters};
}

function createReadModelPrewarm({getPool,userAccess,preferenceValue=()=>null,loadProjection=null,getOverviewService=null,getCpComputedService=null,guard=null,
  enabled=()=>prewarmEnabled(),quietMs=1500,maxAttempts=3,maxUsers=64,now=()=>Date.now(),
  defer=fn=>{const timer=setTimeout(fn,0);timer.unref?.();},wait=ms=>new Promise(resolve=>{const timer=setTimeout(resolve,ms);timer.unref?.();}),
  onFailure=()=>{}}={}){
  if(typeof getPool!=='function'||!userAccess)throw TypeError('Invalid read model prewarm dependencies');
  const als=new AsyncLocalStorage();
  const runs=new Set(),flights=new Map(),users=new Map();
  let interactiveActive=0,lastInteractiveAt=0;
  const counters={sessions:0,runs:0,completed:0,failed:0,preempted:0,joined:0,backgroundJobs:0,interactiveJobs:0};

  function preemptSpeculative(task){
    for(const run of runs){
      if(!run.speculative||run.jobs<=0||run.controller.signal.aborted)continue;
      // CP okuması CP ısıtmasının hesabını kullanır: iptal yerine katılır (koşu artık spekülatif değil).
      if(run.kind==='cp'&&CP_TASKS.has(task)){run.speculative=false;counters.joined++;continue;}
      counters.preempted++;run.controller.abort();
    }
  }
  /* Okuma modeli servislerinin ortak havuz girişi. Ön ısıtma bağlamındaki işler
     'background' önceliği alır; diğer her iş kullanıcı işidir. */
  function runCompute(task,payload,options={}){
    const store=als.getStore(),pool=getPool();
    if(store&&store.run){
      const run=store.run;
      if(run.controller.signal.aborted)return Promise.reject(abortedError());
      counters.backgroundJobs++;run.jobs++;
      return pool.run(task,payload,{...options,priority:run.speculative?'background':'interactive'}).finally(()=>{run.jobs--;});
    }
    counters.interactiveJobs++;interactiveActive++;lastInteractiveAt=now();
    // Bekleyen kullanıcı işi ön ısıtmanın arkasında kalmaz. Farklı gövdeli bir Genel Bakış
    // isteği istisnadır: aynı ekranın işidir ve ön ısıtmanın kurduğu veri kümesi/karar
    // barındırıcısını kullanır; işçiyi sıfırlamak onu yalnız geciktirir.
    if(task!=='read-model-overview')preemptSpeculative(task);
    return pool.run(task,payload,options).finally(()=>{interactiveActive--;lastInteractiveAt=now();});
  }
  function poolIdle(){
    const stats=typeof getPool().stats==='function'?getPool().stats():null;
    return !stats||(stats.pending===0&&stats.activeWorkers===0);
  }
  function quiet(){return interactiveActive===0&&now()-lastInteractiveAt>=quietMs&&poolIdle();}
  async function waitQuiet(session){
    // Yerel zamanlayıcı; ağ/IPC yoklaması yok. Oturum düşerse bekleme biter.
    for(let i=0;!quiet();i++){
      if(i>=240||!live(session))return false;
      await wait(Math.max(50,Math.floor(quietMs/2)));
    }
    return true;
  }
  function live(session){
    try{const profile=userAccess.sessionProfile(session.req);if(!profile)return false;session.req.currentUser=profile;return true;}
    catch(_){return false;}
  }

  /* Genel Bakış servisi vekili: aynı yetki damgası (kullanıcı, bağlam, yetki, kaynak;
     compute-read-guard) + aynı normalize gövde için tek uçuş. Katılan her istek kendi
     oturumunu yakalar ve paylaşılan sonucu almadan önce yeniden doğrular. */
  function capture(req){
    if(!guard||typeof guard.capture!=='function')return null;
    try{return guard.capture(req,'overview');}catch(_){return null;}
  }
  function flightKey(captured,body){
    if(!captured||!captured.key)return null;
    let request;try{request=validateRequest(body);}catch(_){return null;}
    return JSON.stringify([captured.key,request.parts,request.lang,request.filters]);
  }
  function overviewServiceProxy(){
    return {
      async model(req,body,options={}){
        const service=getOverviewService(),captured=capture(req),key=flightKey(captured,body),flight=key&&flights.get(key);
        if(flight&&!flight.run.controller.signal.aborted){
          // İstemci ön ısıtmayı bekliyor: koşu artık iptal edilmez.
          counters.joined++;flight.run.speculative=false;if(flight.run.session)flight.run.session.joined=true;
          let out=null;
          try{out=await flight.promise;}
          catch(error){if(error?.code!=='COMPUTE_ABORTED'||options.signal?.aborted)throw error;}
          // Ön ısıtmanın doğrulaması kendi çerez kopyası içindir; katılan oturum ayrıca doğrulanır.
          if(out){captured.assertResponse();return out;}
        }
        return service.model(req,body,options);
      },
      clear(){getOverviewService().clear?.();},
      stats(){return {...getOverviewService().stats?.(),prewarm:stats()};},
    };
  }
  function prewarmOverview(session,run,parts){
    const body=overviewBodyFor(key=>preferenceValue(session.req.currentUser,key),parts);
    const key=flightKey(capture(session.req),body);
    const promise=als.run({run},()=>getOverviewService().model(session.req,body,{signal:run.controller.signal}));
    const flight={run,promise};
    if(key)flights.set(key,flight);
    promise.catch(()=>{}).finally(()=>{if(key&&flights.get(key)===flight)flights.delete(key);});
    return promise;
  }

  /* CP hesaplanmış sütunları: istemcinin ilk isteğiyle aynı gövde (dil; bekleyen cevap katmanı yok). */
  async function warmCpComputed(session,status){
    const profile=session.req.currentUser,service=typeof getCpComputedService==='function'?getCpComputedService():null;
    if(!service||!userAccess.hasArea(profile,'cp')){status.cp='skipped';return;}
    if(String(preferenceValue(profile,CP_COMPUTED_PREF)??'')==='0'){status.cp='disabled';return;}
    const lang=preferenceValue(profile,LANG_KEY)==='en'?'en':'tr';
    for(let attempt=1;;attempt++){
      const run={controller:new AbortController(),speculative:!session.joined,jobs:0,session,kind:'cp'};runs.add(run);
      try{
        if(attempt>1&&!await waitQuiet(session))throw abortedError();
        const out=await als.run({run},()=>service.computed(session.req,{version:1,lang},{signal:run.controller.signal}));
        status.cp=out&&out.cached?'cached':'ready';return;
      }catch(error){
        if(error?.code!=='COMPUTE_ABORTED'||attempt>=maxAttempts||!live(session)){
          status.cp=error?.code==='COMPUTE_ABORTED'?'preempted':error?.code==='SOURCE_FILTER_REQUIRED'||error?.statusCode===403?'skipped':'error';
          if(status.cp==='error')onFailure('cp-computed',error);
          return;
        }
        status.cp='preempted';
      }finally{runs.delete(run);}
    }
  }
  async function warmProjections(session,status){
    if(typeof loadProjection!=='function')return;
    for(const [module,area] of PROJECTIONS){
      if(!live(session)||!userAccess.hasArea(session.req.currentUser,area)){status[module]='skipped';continue;}
      try{const lease=await loadProjection(session.req,module);lease?.release?.();status[module]='ready';}
      catch(error){status[module]=error?.code==='SOURCE_FILTER_REQUIRED'||error?.statusCode===403?'skipped':'error';if(status[module]==='error')onFailure('projection:'+module,error);}
    }
  }
  async function runSession(session){
    const status=session.status;
    try{
      if(typeof userAccess.prepareComputeAccessContext==='function')await userAccess.prepareComputeAccessContext();
      if(!live(session)){status.state='skipped';return;}
      const profile=session.req.currentUser;
      if(getOverviewService&&userAccess.hasArea(profile,'overview')){
        for(const parts of ['fast','full']){
          status.overview[parts]='pending';
          for(let attempt=1;;attempt++){
            // İstemcinin katıldığı oturumda sonraki aşamalar da spekülatif değildir.
            const run={controller:new AbortController(),speculative:!session.joined,jobs:0,session};runs.add(run);
            try{
              if(attempt>1&&!await waitQuiet(session))throw abortedError();
              const out=await prewarmOverview(session,run,parts);
              status.overview[parts]=out&&out.cached?'cached':'ready';break;
            }catch(error){
              if(error?.code!=='COMPUTE_ABORTED'||attempt>=maxAttempts||!live(session)){
                status.overview[parts]=error?.code==='COMPUTE_ABORTED'?'preempted':'error';
                if(status.overview[parts]==='error')onFailure('overview:'+parts,error);
                break;
              }
              status.overview[parts]='preempted';
            }finally{runs.delete(run);}
          }
          if(status.overview[parts]!=='ready'&&status.overview[parts]!=='cached')break;
        }
      }
      if(live(session))await warmCpComputed(session,status);
      await warmProjections(session,status.projections);
      status.state='done';counters.completed++;
    }catch(error){status.state='error';counters.failed++;onFailure('session',error);}
    finally{status.finishedAt=now();session.running=false;}
  }

  /* Çalışma alanı açılışı tetikleyicisi: O(1) denetim, aynı oturum için bir kez. */
  function noteSession(req){
    if(!enabled()||!req||!req.currentUser||req.currentUser.id==null)return false;
    const cookie=String(req.headers&&req.headers.cookie||'');if(!cookie)return false;
    const userId=String(req.currentUser.id),sessionKey=hash(cookie),known=users.get(userId);
    if(known&&(known.running||known.sessionKey===sessionKey))return false;
    const session={sessionKey,running:true,joined:false,req:{headers:{cookie},currentUser:req.currentUser,socket:{remoteAddress:req.socket&&req.socket.remoteAddress}},
      status:{state:'running',startedAt:now(),finishedAt:null,overview:{},projections:{}}};
    users.delete(userId);users.set(userId,session);
    while(users.size>maxUsers)users.delete(users.keys().next().value);
    counters.sessions++;counters.runs++;
    defer(()=>{void runSession(session);});
    return true;
  }
  function statusFor(req){
    const id=req&&req.currentUser&&String(req.currentUser.id),session=id&&users.get(id);
    if(!enabled())return {state:'disabled'};
    if(!session)return {state:'idle'};
    const {state,startedAt,finishedAt,overview,projections,cp}=session.status;
    return {state,startedAt,finishedAt,overview:{...overview},...(cp?{cp}:{}),projections:{...projections}};
  }
  function stats(){return {...counters,activeRuns:runs.size,flights:flights.size,users:users.size,interactiveActive};}
  // Test kancası: fn'i verilen ön ısıtma koşusunun bağlamında çalıştırır.
  function runInPrewarm(run,fn){runs.add(run);return Promise.resolve().then(()=>als.run({run},fn)).finally(()=>runs.delete(run));}
  return {runCompute,overviewServiceProxy,noteSession,statusFor,stats,_runInPrewarm:runInPrewarm};
}
module.exports={createReadModelPrewarm,prewarmEnabled,overviewBodyFor,PROJECTIONS};
