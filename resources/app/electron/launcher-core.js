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
const confirmLauncher=()=>{try{if(typeof host.confirm==='function')host.confirm();}catch(_){} };

/* TEK KOPYA KİLİDİ güncelleme durumuna dokunmadan ÖNCE alınır. Deneme (trial)
 * sürümü açılırken başlatılan ikinci bir BuyerLog.exe, kilit main.js'te alındığı
 * için önce rollbackExistingTrial() çalıştırıyor, çalışan denemeyi "onaylanmamış"
 * sayıp eski sürüme dönüyor, DB checkpointini çalışan backend'in altına geri
 * yüklüyor ve ancak sonra kapanıyordu (7.0.195 TEST). Kilit main.js ile AYNI
 * userData (data\electron-profile) üzerinden alınır; main.js'teki ikinci çağrı
 * aynı süreçte zaten tutulan kilidi döndürür. */
function acquireLaunchLock(){
  if(!app.isPackaged)return true;
  try{
    const paths=desktopPaths(resolvePortableRoot({packaged:true,execPath:process.execPath}));
    fs.mkdirSync(paths.electronProfileRoot,{recursive:true});
    app.setPath('userData',paths.electronProfileRoot);
  }catch(error){log('launch-lock-path-failed',{message:String(error&&error.message||error).slice(0,200)});return true;}
  return app.requestSingleInstanceLock();
}
const primaryInstance=acquireLaunchLock();
if(!primaryInstance){
  // Çalışan kopya 'second-instance' olayıyla penceresini öne getirir.
  log('second-instance-exit',{});
  confirmLauncher();
  app.exit(0);
}else{
const lifecycle=createLauncherState({bootstrapCore:BOOTSTRAP_CORE,portableRoot:PORTABLE_ROOT});
const recovered=app.isPackaged?lifecycle.rollbackExistingTrial():null;
if(recovered)log('rollback-on-next-launch',{failedVersion:recovered.failed.version,restoredVersion:recovered.restored.version});
// İmzalı yama güven kökü bu launcher'ın kendi dosyalarıdır (bootstrap.json,
// anahtarlar, doğrulayıcı); kurulum kökü yalnız sürüm/pointer yönetimi içindir.
const patchManager=app.isPackaged?require('./manual-patch/manager').createInstalledManager({bootstrapCore:BOOTSTRAP_CORE,trustRoot:LAUNCHER_ROOT,portableRoot:PORTABLE_ROOT}):null;
function verifySelected(selected){
  if(!app.isPackaged)return;
  const relative=path.relative(path.join(PORTABLE_ROOT,'.buyerlog-versions'),selected.appCoreRoot);
  if(relative.split(path.sep)[0].startsWith('manual-'))patchManager.verifyInstalled(selected);
  else require('./manual-patch/core-verification').verifyPackagedCore(selected.appCoreRoot,selected.version);
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
    if(pending.manualPatch)patchManager.verifyStaged(pending);
    else require('./manual-patch/core-verification').verifyPackagedCore(pending.appCoreRoot,pending.version);
    const required=pendingNeedsNewerLauncher(pending);
    if(required){
      lifecycle.writeState({state:'FAILED',pending:null,lastError:{code:'UPDATE_UPDATER_TOO_OLD',required,message:'Bu sürüm daha yeni güncelleme altyapısı gerektiriyor; altyapı yeniden hazırlanacak. / This version requires newer update infrastructure; it will be prepared again.'}});
      log('activation-deferred-launcher-too-old',{version:pending.version,required});
    }
  }
  verifySelected(lifecycle.currentPointer());
}
const activationResult=app.isPackaged?lifecycle.activatePending():null;
const activation=activationResult&&activationResult.activation||null;
const selected=app.isPackaged?lifecycle.currentPointer():lifecycle.bootstrapPointer();
verifySelected(selected);
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
}
module.exports={start,UPDATER_VERSION,LAUNCHER_ROOT,LAUNCHER_INFO};
