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
async function showLaunchNotice(){
  const {BrowserWindow}=require('electron');
  await app.whenReady();
  const notice=new BrowserWindow({width:420,height:240,center:true,show:false,frame:false,
    resizable:false,minimizable:false,maximizable:false,fullscreenable:false,
    backgroundColor:'#f8f8f9',title:'Buyer Log açılıyor… / Buyer Log is opening…',
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
  const html=`<!doctype html><html lang="tr"><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><title>Buyer Log</title><style>html,body{height:100%;margin:0}body{box-sizing:border-box;border:1px solid #d4d4d7;background:#f8f8f9;color:#1d1f20;font-family:system-ui,Segoe UI,sans-serif;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;-webkit-app-region:drag}strong{font-size:30px;font-weight:600}p{margin:0;font-size:14px;color:#5d5d60}</style><body><strong>Buyer Log</strong><p role="status">Buyer Log açılıyor…</p><p lang="en">Buyer Log is opening…</p></body></html>`;
  let timer;
  try{await new Promise((resolve,reject)=>{
    timer=setTimeout(()=>reject(new Error('Launch notice timeout')),3000);
    notice.once('ready-to-show',()=>{notice.show();setImmediate(resolve);});
    notice.once('closed',()=>reject(new Error('Launch notice closed')));
    notice.webContents.once('did-fail-load',(_event,code,description)=>reject(new Error('Launch notice: '+code+' '+description)));
    notice.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent(html)).catch(reject);
  });}catch(error){if(!notice.isDestroyed())notice.destroy();throw error;}
  finally{clearTimeout(timer);}
  log('launch-notice-visible',{sinceProcessStartMs:sinceProcessStartMs()});
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
async function launchCore(){
const lifecycle=createLauncherState({bootstrapCore:BOOTSTRAP_CORE,portableRoot:PORTABLE_ROOT});
const recovered=app.isPackaged?lifecycle.rollbackExistingTrial():null;
if(recovered)log('rollback-on-next-launch',{failedVersion:recovered.failed.version,restoredVersion:recovered.restored.version});
// İmzalı yama güven kökü bu launcher'ın kendi dosyalarıdır (bootstrap.json,
// anahtarlar, doğrulayıcı); kurulum kökü yalnız sürüm/pointer yönetimi içindir.
const patchManager=app.isPackaged?require('./manual-patch/manager').createInstalledManager({bootstrapCore:BOOTSTRAP_CORE,trustRoot:LAUNCHER_ROOT,portableRoot:PORTABLE_ROOT}):null;
function verifySelected(selected){
  if(!app.isPackaged)return;
  const started=Date.now();
  const relative=path.relative(path.join(PORTABLE_ROOT,'.buyerlog-versions'),selected.appCoreRoot);
  if(relative.split(path.sep)[0].startsWith('manual-'))patchManager.verifyInstalled(selected);
  else require('./manual-patch/core-verification').verifyPackagedCore(selected.appCoreRoot,selected.version);
  log('core-verified',{version:selected.version,durationMs:Date.now()-started,sinceProcessStartMs:sinceProcessStartMs()});
}
async function verifySelectedOffThread(selected){
  if(!app.isPackaged)return;
  const relative=path.relative(path.join(PORTABLE_ROOT,'.buyerlog-versions'),selected.appCoreRoot);
  // İmzalı el yaması çekirdekleri kendi yöneticisiyle doğrulanır (nadir yol).
  if(relative.split(path.sep)[0].startsWith('manual-'))return verifySelected(selected);
  const started=Date.now();
  if(!await verifyPackagedCoreOffThread(selected.appCoreRoot,selected.version))return verifySelected(selected);
  log('core-verified',{version:selected.version,durationMs:Date.now()-started,sinceProcessStartMs:sinceProcessStartMs(),offThread:true});
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
if(app.isPackaged){
  const pending=lifecycle.readState().pending;
  if(pending?.ready){
    // Before a real activation, validate the rollback target as well. Normal
    // launches validate the final selected core once, below.
    verifySelected(lifecycle.currentPointer());
    if(pending.manualPatch)patchManager.verifyStaged(pending);
    else require('./manual-patch/core-verification').verifyPackagedCore(pending.appCoreRoot,pending.version);
    const required=pendingNeedsNewerLauncher(pending);
    if(required){
      lifecycle.writeState({state:'FAILED',pending:null,lastError:{code:'UPDATE_UPDATER_TOO_OLD',required,message:'Bu sürüm daha yeni güncelleme altyapısı gerektiriyor; altyapı yeniden hazırlanacak. / This version requires newer update infrastructure; it will be prepared again.'}});
      log('activation-deferred-launcher-too-old',{version:pending.version,required});
    }
  }
}
const activationResult=app.isPackaged?lifecycle.activatePending():null;
const activation=activationResult&&activationResult.activation||null;
const selected=app.isPackaged?lifecycle.currentPointer():lifecycle.bootstrapPointer();
await verifySelectedOffThread(selected);
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

let healthTimer=null;
if(activation){
  healthTimer=setTimeout(()=>{
    const state=lifecycle.readState();if(!state.activation||state.activation.token!==activation.token)return;
    lifecycle.requestRollback(activation,'health-timeout');log('rollback-requested',{failedVersion:activation.version,reason:'health-timeout'});
    // Restore only on the next launcher run, after normal backend shutdown.
    try{app.relaunch();}catch(_){};app.quit();
  },HEALTH_TIMEOUT_MS);if(healthTimer.unref)healthTimer.unref();
}
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
