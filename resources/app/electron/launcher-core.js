'use strict';
/* Buyer Log persistent launcher / rollback boundary. Application releases are
 * immutable app-core folders; activation is an atomic current-pointer change.
 *
 * Bu modül yalnız tanım içerir; çalıştırmayı electron/launcher.js (stage-0
 * host) start(host) ile başlatır. Host; gerçek kurulum kökünü (bootstrapCore),
 * portable kökü ve başarılı açılış onayını verir. Böylece aynı launcher hem
 * kurulumla gelen kopyadan hem de imzalı release'ten kopyalanmış yönetilen
 * launcher klasöründen (.buyerlog-launcher/<id>) çalışabilir. Yükleme sırasında
 * yan etki olmaması stage-0'ın güvenli geri dönüşü için zorunludur. */
const fs=require('fs');
const path=require('path');

const LAUNCHER_ROOT=path.resolve(__dirname,'..');
const LAUNCHER_INFO=JSON.parse(fs.readFileSync(path.join(__dirname,'update','launcher-version.json'),'utf8'));
const UPDATER_VERSION=String(LAUNCHER_INFO.launcherVersion||'');
if(!/^\d+\.\d+\.\d+$/.test(UPDATER_VERSION))throw Object.assign(new Error('Launcher version is invalid.'),{code:'UPDATE_LAUNCHER_INVALID'});
const HEALTH_TIMEOUT_MS=60000;

function start(host={}){
const { app,dialog }=require('electron');
const { createLauncherState }=require('./update/launcher-state');
const { resolvePortableRoot,desktopPaths }=require('./portable-paths');
const { compareSemver }=require('./update/semver');
const BOOTSTRAP_CORE=path.resolve(host.bootstrapCore||LAUNCHER_ROOT);
const PORTABLE_ROOT=resolvePortableRoot({packaged:app.isPackaged,execPath:process.execPath,appPath:BOOTSTRAP_CORE});
const LOG_FILE=path.join(PORTABLE_ROOT,'data','local','updater','updater.log');
function log(event,meta={}){try{fs.mkdirSync(path.dirname(LOG_FILE),{recursive:true});fs.appendFileSync(LOG_FILE,JSON.stringify({at:new Date().toISOString(),event,...meta})+'\n','utf8');}catch(_){} }
// Saha ölçümü: EXE başlangıcından itibaren geçen süre. Ölçüm hiçbir koşulda açılışı durdurmaz.
const sinceProcessStartMs=()=>{try{return Math.round(process.uptime()*1000);}catch(_){return null;}};
const confirmLauncher=()=>{try{if(typeof host.confirm==='function')host.confirm();}catch(_){} };

/* TEK KOPYA KİLİDİ güncelleme durumuna dokunmadan ÖNCE alınır. Deneme (trial)
 * sürümü açılırken başlatılan ikinci bir BuyerLog.exe, kilit main.js'te alındığı
 * için önce rollbackExistingTrial() çalıştırıyor, çalışan denemeyi "onaylanmamış"
 * sayıp eski sürüme dönüyor, DB checkpointini çalışan backend'in altına geri
 * yüklüyor ve ancak sonra kapanıyordu (7.0.195 TEST). Kilit main.js ile AYNI
 * userData (data\electron-profile) üzerinden alınır; main.js'teki ikinci çağrı
 * aynı süreçte zaten tutulan kilidi döndürür. */
function acquireLaunchLock(){
  try{
    const paths=desktopPaths(PORTABLE_ROOT);
    fs.mkdirSync(paths.electronProfileRoot,{recursive:true});
    app.setPath('userData',paths.electronProfileRoot);
    app.setPath('sessionData',paths.electronProfileRoot);
  }catch(error){log('launch-lock-path-failed',{message:String(error&&error.message||error).slice(0,200)});return true;}
  return !app.isPackaged||app.requestSingleInstanceLock();
}
const primaryInstance=acquireLaunchLock();
if(!primaryInstance){
  // Çalışan kopya 'second-instance' olayıyla penceresini öne getirir.
  log('second-instance-exit',{});
  confirmLauncher();
  app.exit(0);
}else{
// Paint a trusted, self-contained notice before disk-wide integrity checks.
// No application HTML or script is loaded before its integrity is verified.
/* Güncellemenin uygulandığı açılışta (iki çekirdek doğrulaması + yerel veri
 * checkpointi, ana süreçte senkron) bildirim normal açılış gibi görünüyordu.
 * Durum yalnız okunur; okunamazsa normal metin gösterilir, açılış etkilenmez. */
function launchNoticeKind(){
  if(!app.isPackaged)return 'start';
  try{
    const state=createLauncherState({bootstrapCore:BOOTSTRAP_CORE,portableRoot:PORTABLE_ROOT}).readState();
    if(state&&state.activation&&state.activation.status==='trial')return 'rollback';
    if(state&&state.pending&&state.pending.ready)return 'update';
  }catch(_){}
  return 'start';
}
/* EXE başlatıldığı anda görünen bildirim artık bu açılışta launcher'ın yaptığı
 * adımları da gösterir (ör. güncellemede: mevcut sürüm → yeni sürüm doğrulaması →
 * veri yedeği → etkinleştirme). Metinler yalnız bu dosyadadır; ana süreç yalnız
 * adım kimliği gönderir. Dil, main.js'in kapanışta sakladığı arayüz dilidir;
 * kayıt yoksa sistem dili kullanılır. Hiçbir okuma hatası açılışı etkilemez. */
const LAUNCH_NOTICE_TEXT={
  tr:{
    start:{title:'Buyer Log açılıyor…'},
    update:{title:'Güncelleme uygulanıyor…',detail:'Yeni sürüm dosyaları doğrulanıyor ve verinizin yedeği alınıyor. Lütfen kapatmayın.'},
    rollback:{title:'Önceki sürüme dönülüyor…',detail:'Yeni sürüm önceki açılışta tamamlanamadı; verileriniz korunarak geri alınıyor. Lütfen kapatmayın.'},
    steps:{verify:'Program dosyaları doğrulanıyor','verify-current':'Mevcut sürüm doğrulanıyor','verify-new':'Yeni sürüm doğrulanıyor',
      backup:'Verileriniz yedekleniyor',activate:'Yeni sürüm etkinleştiriliyor',rollback:'Önceki sürüm ve veriler geri yükleniyor',start:'Buyer Log başlatılıyor'},
    elapsed:'Geçen süre {0}',slow:'Bu adım normalden uzun sürüyor. Buyer Log çalışıyor; lütfen kapatmayın.'},
  en:{
    start:{title:'Buyer Log is opening…'},
    update:{title:'Applying the update…',detail:'Verifying the new version and backing up your data. Please do not close Buyer Log.'},
    rollback:{title:'Returning to the previous version…',detail:'The new version did not finish starting last time; it is being rolled back with your data preserved. Please do not close Buyer Log.'},
    steps:{verify:'Verifying program files','verify-current':'Verifying the current version','verify-new':'Verifying the new version',
      backup:'Backing up your data',activate:'Activating the new version',rollback:'Restoring the previous version and data',start:'Starting Buyer Log'},
    elapsed:'Elapsed {0}',slow:'This step is taking longer than usual. Buyer Log is working; please do not close it.'},
};
const LAUNCH_NOTICE_STEPS={start:['verify','start'],update:['verify-current','verify-new','backup','activate','start'],rollback:['rollback','verify','start']};
function launchNoticeLanguage(){
  try{
    const file=path.join(desktopPaths(PORTABLE_ROOT).localDataRoot,'desktop-ui-language.json');
    const saved=JSON.parse(fs.readFileSync(file,'utf8'));
    if(saved&&(saved.language==='tr'||saved.language==='en'))return saved.language;
  }catch(_){}
  try{const locale=String((app.getPreferredSystemLanguages?.()||[])[0]||app.getLocale?.()||'');if(locale&&!/^tr\b/i.test(locale))return 'en';}catch(_){}
  return 'tr';
}
const htmlText=value=>String(value).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
function launchNoticeHtml(kind,lang){
  const text=LAUNCH_NOTICE_TEXT[lang]||LAUNCH_NOTICE_TEXT.tr,info=text[kind]||text.start,steps=LAUNCH_NOTICE_STEPS[kind]||LAUNCH_NOTICE_STEPS.start;
  const items=steps.map((id,index)=>`<li data-step="${id}" data-state="${index===0?'active':'pending'}">${htmlText(text.steps[id])}</li>`).join('');
  const script=`(function(){var order=${JSON.stringify(steps)},t0=Date.now()-${Math.max(0,Math.round(sinceProcessStartMs()||0))},since=Date.now(),current=order[0],slow=${JSON.stringify(text.slow)},label=${JSON.stringify(text.elapsed)};
function clock(ms){var s=Math.max(0,Math.floor(ms/1000)),m=Math.floor(s/60);s=s%60;return m+':'+(s<10?'0':'')+s;}
function paint(){var at=order.indexOf(current);document.querySelectorAll('li[data-step]').forEach(function(li){var i=order.indexOf(li.dataset.step);li.dataset.state=i<at?'done':i===at?'active':'pending';});
document.getElementById('e').textContent=label.replace('{0}',clock(Date.now()-t0));document.getElementById('w').textContent=Date.now()-since>20000?slow:'';}
window.BLNotice={step:function(id){var i=order.indexOf(id);if(i<0||i<=order.indexOf(current))return;current=id;since=Date.now();paint();}};
paint();setInterval(paint,1000);})();`;
  return `<!doctype html><html lang="${lang}"><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'"><title>Buyer Log</title><style>html,body{height:100%;margin:0}body{box-sizing:border-box;padding:20px 28px 14px;border:1px solid #d4d4d7;background:#f8f8f9;color:#1d1f20;font-family:system-ui,Segoe UI,sans-serif;display:flex;flex-direction:column;gap:8px;-webkit-app-region:drag;cursor:default;user-select:none}strong{font-size:26px;font-weight:600}p{margin:0;font-size:14px;font-weight:600}small{display:block;margin-top:3px;font-size:11.5px;font-weight:400;line-height:1.35;color:#5d5d60}i{display:block;height:3px;background:#d4d4d7;overflow:hidden;position:relative}i::after{content:"";position:absolute;top:0;bottom:0;width:40%;left:-40%;background:#3f6488;animation:s 1.2s ease-in-out infinite}@keyframes s{to{left:100%}}ol{list-style:none;margin:2px 0 0;padding:0;display:flex;flex-direction:column;gap:3px;font-size:12.5px}li{display:flex;align-items:center;gap:8px;color:#7a7a7d}li::before{content:"";flex:0 0 auto;width:8px;height:8px;border-radius:50%;border:1.5px solid #d4d4d7;box-sizing:border-box}li[data-state="done"]{color:#5d5d60}li[data-state="done"]::before{background:#3d7a57;border-color:#3d7a57}li[data-state="active"]{color:#1d1f20;font-weight:600}li[data-state="active"]::before{background:#3f6488;border-color:#3f6488}footer{margin-top:auto;display:flex;justify-content:space-between;gap:10px;font-size:11px;color:#7a7a7d}@media (prefers-reduced-motion:reduce){i::after{animation:none;left:0;width:100%;opacity:.35}}</style><body><strong>Buyer Log</strong><p role="status">${htmlText(info.title)}${info.detail?`<small>${htmlText(info.detail)}</small>`:''}</p><i aria-hidden="true"></i><ol aria-label="${lang==='en'?'Startup steps':'Açılış adımları'}">${items}</ol><footer><span id="w" aria-live="polite"></span><span id="e"></span></footer><script>${script}</script></body></html>`;
}
let launchNoticeKindValue='start';
async function showLaunchNotice(){
  const {BrowserWindow}=require('electron');
  await app.whenReady();
  launchNoticeKindValue=launchNoticeKind();
  const lang=launchNoticeLanguage(),text=LAUNCH_NOTICE_TEXT[lang][launchNoticeKindValue];
  const notice=new BrowserWindow({width:440,height:launchNoticeKindValue==='update'?320:launchNoticeKindValue==='rollback'?300:250,center:true,show:false,frame:false,
    resizable:false,minimizable:false,maximizable:false,fullscreenable:false,
    backgroundColor:'#f8f8f9',title:'Buyer Log · '+text.title,
    webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true}});
  global.__buyerLogLaunchNotice=notice;
  // Older/rolled-back cores do not know the hand-off global. Close the notice
  // when their own splash, error or main window becomes visible as well.
  const handOff=(_event,window)=>{
    if(window===notice)return;
    window.once('show',()=>{if(!notice.isDestroyed())notice.destroy();});
  };
  app.on('browser-window-created',handOff);
  notice.once('closed',()=>{
    app.removeListener('browser-window-created',handOff);
    if(global.__buyerLogLaunchNotice===notice)delete global.__buyerLogLaunchNotice;
  });
  // Animasyon derleyicide çalışır: ana süreç senkron işteyken de çubuk ilerler.
  const html=launchNoticeHtml(launchNoticeKindValue,lang);
  let timer;
  try{await new Promise((resolve,reject)=>{
    timer=setTimeout(()=>reject(new Error('Launch notice timeout')),3000);
    notice.once('ready-to-show',()=>{notice.show();setImmediate(resolve);});
    notice.once('closed',()=>reject(new Error('Launch notice closed')));
    notice.webContents.once('did-fail-load',(_event,code,description)=>reject(new Error('Launch notice: '+code+' '+description)));
    notice.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent(html)).catch(reject);
  });}catch(error){if(!notice.isDestroyed())notice.destroy();throw error;}
  finally{clearTimeout(timer);}
  log('launch-notice-visible',{kind:launchNoticeKindValue,sinceProcessStartMs:sinceProcessStartMs()});
}
/* Bildirimdeki etkin adımı ilerletir. Senkron bir adımdan (veri yedeği,
 * etkinleştirme) önce çağrıldığında boyamanın tamamlanması kısa süre beklenir;
 * bildirim yoksa ya da yanıt vermezse açılış hiçbir koşulda beklemede kalmaz. */
async function launchStep(id,{paint=false}={}){
  log('launch-step',{step:id,sinceProcessStartMs:sinceProcessStartMs()});
  const notice=global.__buyerLogLaunchNotice;
  if(!notice||notice.isDestroyed()||typeof notice.webContents?.executeJavaScript!=='function')return;
  let timer;
  try{
    await Promise.race([
      notice.webContents.executeJavaScript('window.BLNotice&&window.BLNotice.step('+JSON.stringify(id)+')',false).catch(()=>{}),
      new Promise(resolve=>{timer=setTimeout(resolve,300);}),
    ]);
    if(paint)await new Promise(resolve=>setTimeout(resolve,50));
  }catch(_){}
  finally{clearTimeout(timer);}
}
/* Normal açılışta seçili çekirdeğin bütünlük taraması (~2.500 dosya / 165 MB)
 * ana süreçte senkron çalışıyordu; yavaş disk veya antivirüste açılış penceresi
 * "Yanıt vermiyor" görünebiliyordu. Aynı doğrulayıcı (core-verification.js) bir
 * işçi iş parçacığında çalışır; bütünlük hataları aynı kodla açılışı durdurur.
 * İşçi başlatılamaz ya da beklenmedik biçimde biterse doğrulama ana süreçte
 * aynen yapılır: tarama hiçbir koşulda atlanmaz. Kod satır içidir; böylece
 * imzalı launcher dosya listesi değişmez. */
const OFF_THREAD_VERIFIER=`const {parentPort,workerData}=require('worker_threads');
try{require(workerData.module).verifyPackagedCore(workerData.core,workerData.version);parentPort.postMessage({ok:true});}
catch(error){parentPort.postMessage({ok:false,code:String(error&&error.code||''),message:String(error&&error.message||error)});}`;
function verifyPackagedCoreOffThread(core,version){
  let Worker;
  try{({Worker}=require('worker_threads'));}catch(_){return Promise.resolve(false);}
  return new Promise((resolve,reject)=>{
    let settled=false,worker;
    const settle=(fn,value)=>{if(settled)return;settled=true;fn(value);try{worker&&worker.terminate();}catch(_){}};
    try{worker=new Worker(OFF_THREAD_VERIFIER,{eval:true,workerData:{module:path.join(__dirname,'manual-patch','core-verification.js'),core,version}});}
    catch(_){resolve(false);return;}
    worker.once('message',message=>{
      if(message&&message.ok===true)settle(resolve,true);
      else if(/^(UPDATE|PATCH)_/.test(String(message&&message.code||'')))settle(reject,Object.assign(new Error(String(message.message)),{code:message.code}));
      else settle(resolve,false);
    });
    worker.once('error',()=>settle(resolve,false));
    worker.once('exit',()=>settle(resolve,false));
  });
}
/* Launcher'ın açılış işi (geri alma, doğrulama, etkinleştirme) bittiği ve main.js
 * kendi işleyicilerini kaydettiği ana kadar: bildirim kapatılırsa (Alt+F4)
 * Electron'un varsayılan çıkışı denemedeki sağlam sürümü sonraki açılışta geri
 * aldırabilirdi; ikinci kopya olayı da kaybolurdu. Bu aralıkta açılış sürer ve
 * ikinci kopya bildirimi öne getirir. Dinleyici kaydı en iyi çabadır. */
function holdLaunch(){
  const keepRunning=()=>{};
  const focusNotice=()=>{const notice=global.__buyerLogLaunchNotice;if(notice&&!notice.isDestroyed()){try{notice.show();notice.focus();}catch(_){}}};
  const listen=(name,fn)=>{try{if(typeof app.on==='function')app.on(name,fn);}catch(_){}};
  const unlisten=(name,fn)=>{try{if(typeof app.removeListener==='function')app.removeListener(name,fn);}catch(_){}};
  listen('window-all-closed',keepRunning);listen('second-instance',focusNotice);
  let released=false;
  return ()=>{if(released)return;released=true;unlisten('window-all-closed',keepRunning);unlisten('second-instance',focusNotice);};
}
async function launchCore(){
const release=holdLaunch();
let selected,activation,lifecycle;
try{
lifecycle=createLauncherState({bootstrapCore:BOOTSTRAP_CORE,portableRoot:PORTABLE_ROOT});
const recovered=app.isPackaged?lifecycle.rollbackExistingTrial():null;
if(recovered)log('rollback-on-next-launch',{failedVersion:recovered.failed.version,restoredVersion:recovered.restored.version});
// İmzalı yama güven kökü bu launcher'ın kendi dosyalarıdır (bootstrap.json,
// anahtarlar, doğrulayıcı); kurulum kökü yalnız sürüm/pointer yönetimi içindir.
const patchManager=app.isPackaged?require('./manual-patch/manager').createInstalledManager({bootstrapCore:BOOTSTRAP_CORE,trustRoot:LAUNCHER_ROOT,portableRoot:PORTABLE_ROOT}):null;
const isManualCore=core=>path.relative(path.join(PORTABLE_ROOT,'.buyerlog-versions'),core).split(path.sep)[0].startsWith('manual-');
/* Aynı açılışta aynı paketli çekirdek bir kez taranır. Güncellemede yeni sürüm
 * etkinleştirmeden önce doğrulanır ve seçilen çekirdek odur; eskiden aynı ~165 MB
 * üçüncü kez taranıyordu. İmzalı el yaması çekirdekleri kendi yöneticisiyle
 * doğrulanır (nadir yol) ve bu kümeye girmez. */
const verifiedCores=new Set();
async function verifyCore(target){
  if(!app.isPackaged)return;
  const root=path.resolve(target.appCoreRoot),key=root+'\n'+String(target.version||'');
  if(verifiedCores.has(key))return;
  const started=Date.now();
  if(isManualCore(target.appCoreRoot)){patchManager.verifyInstalled(target);log('core-verified',{version:target.version,durationMs:Date.now()-started,sinceProcessStartMs:sinceProcessStartMs(),manualPatch:true});return;}
  // Tarama işçi iş parçacığında yürür; ana süreç ve bildirim yanıt vermeye devam eder.
  const offThread=await verifyPackagedCoreOffThread(target.appCoreRoot,target.version);
  if(!offThread)require('./manual-patch/core-verification').verifyPackagedCore(target.appCoreRoot,target.version);
  verifiedCores.add(key);
  log('core-verified',{version:target.version,durationMs:Date.now()-started,sinceProcessStartMs:sinceProcessStartMs(),offThread});
}
/* Bekleyen çekirdek bu launcher'dan daha yeni bir etkinleştirme protokolü
 * isterse deneme başlatılmaz; updater önce uygun launcher'ı kurar. */
function pendingNeedsNewerLauncher(pending){
  if(!pending?.ready||pending.manualPatch)return '';
  try{
    const info=JSON.parse(fs.readFileSync(path.join(pending.appCoreRoot,'electron','update','launcher-version.json'),'utf8'));
    const required=String(info&&info.minimumActivationLauncher||'1.0.0');
    return compareSemver(UPDATER_VERSION,required)<0?required:'';
  }catch(error){return error.code==='ENOENT'?'':'invalid';}
}
let activating=false;
if(app.isPackaged){
  const pending=lifecycle.readState().pending;
  if(pending?.ready){
    // Before a real activation, validate the rollback target as well.
    await launchStep('verify-current');
    await verifyCore(lifecycle.currentPointer());
    await launchStep('verify-new');
    if(pending.manualPatch)patchManager.verifyStaged(pending);
    else await verifyCore({appCoreRoot:pending.appCoreRoot,version:pending.version});
    const required=pendingNeedsNewerLauncher(pending);
    if(required){
      lifecycle.writeState({state:'FAILED',pending:null,lastError:{code:'UPDATE_UPDATER_TOO_OLD',required,message:'Bu sürüm daha yeni güncelleme altyapısı gerektiriyor; altyapı yeniden hazırlanacak. / This version requires newer update infrastructure; it will be prepared again.'}});
      log('activation-deferred-launcher-too-old',{version:pending.version,required});
    }else activating=true;
  }
}
// Yerel veri checkpointi ve pointer geçişi senkron ve kısa; adım önce boyanır.
if(activating)await launchStep('backup',{paint:true});
const activationResult=app.isPackaged?lifecycle.activatePending():null;
activation=activationResult&&activationResult.activation||null;
if(activation)await launchStep('activate');
selected=app.isPackaged?lifecycle.currentPointer():lifecycle.bootstrapPointer();
await launchStep('verify');
await verifyCore(selected);
if(activation)log('activation-started',{version:activation.version,previousVersion:activation.previous&&activation.previous.version||''});
process.env.BUYER_LOG_BOOTSTRAP_APP_CORE=BOOTSTRAP_CORE;
process.env.BUYER_LOG_ACTIVE_APP_CORE=selected.appCoreRoot;
process.env.BUYER_LOG_ACTIVE_VERSION=selected.version;
process.env.BUYER_LOG_UPDATER_VERSION=UPDATER_VERSION;
process.env.BUYER_LOG_LAUNCHER_HOST=String(host.protocol||'');
process.env.BUYER_LOG_LAUNCHER_ID=String(host.launcherId||'bundled');
if(activation)process.env.BUYER_LOG_UPDATE_HEALTH_TOKEN=activation.token;
else delete process.env.BUYER_LOG_UPDATE_HEALTH_TOKEN;
if(patchManager)global.__buyerLogPrepareSignedPatch=options=>require('./manual-patch/desktop').prepareFromPicker({...options,manager:patchManager,dialog});

global.__buyerLogLauncherHealthReady=(info={})=>{
  if(!activation)return false;
  const ok=lifecycle.confirmHealth(activation.token,info);
  if(ok)log('health-ok',{version:activation.version});
  return ok;
};

if(activation){
  const healthTimer=setTimeout(()=>{
    const state=lifecycle.readState();if(!state.activation||state.activation.token!==activation.token)return;
    lifecycle.requestRollback(activation,'health-timeout');log('rollback-requested',{failedVersion:activation.version,reason:'health-timeout'});
    // Restore only on the next launch, after normal backend shutdown.
    try{app.relaunch();}catch(_){};app.quit();
  },HEALTH_TIMEOUT_MS);if(healthTimer.unref)healthTimer.unref();
}
await launchStep('start');
}finally{release();}
// Launcher'ın kendi işi (kurtarma, doğrulama, etkinleştirme) tamamlandı. Onay
// çekirdek yüklenmeden verilir: çekirdek hatası sağlam launcher'ı geri düşürmez;
// çekirdek hataları deneme/geri alma mekanizmasıyla ele alınır.
confirmLauncher();
try{
  require(path.join(selected.appCoreRoot,'electron','main.js'));
}catch(error){
  log('active-core-load-failed',{version:selected.version,code:error&&error.code||'',message:String(error&&error.message||error).slice(0,500)});
  if(activation){lifecycle.requestRollback(activation,'main-load-failed');log('rollback-requested',{failedVersion:activation.version,reason:'main-load-failed'});try{app.relaunch();}catch(_){};app.quit();}
  else throw error;
}
}
void showLaunchNotice().catch(error=>log('launch-notice-failed',{message:String(error.message||error)})).then(launchCore).catch(error=>{
  if(/^(UPDATE|PATCH)_/.test(String(error&&error.code||'')))confirmLauncher();
  log('launcher-start-failed',{code:error&&error.code||'',message:String(error.message||error)});
  try{dialog.showErrorBox('Buyer Log',String(error.message||error));}finally{app.exit(1);}
});
}
}
module.exports={start,UPDATER_VERSION,LAUNCHER_ROOT,LAUNCHER_INFO};
