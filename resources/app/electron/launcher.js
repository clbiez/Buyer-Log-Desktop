'use strict';
/* Buyer Log persistent launcher / rollback boundary. Application releases are
 * immutable app-core folders; activation is an atomic current-pointer change. */
const fs=require('fs');
const path=require('path');
const { app }=require('electron');
const { createLauncherState }=require('./update/launcher-state');
const { resolvePortableRoot,desktopPaths }=require('./portable-paths');

const UPDATER_VERSION='1.0.0';
const BOOTSTRAP_CORE=path.resolve(__dirname,'..');
const PORTABLE_ROOT=app.isPackaged?path.dirname(process.execPath):path.resolve(BOOTSTRAP_CORE,'.desktop-dev');
const LOG_FILE=path.join(PORTABLE_ROOT,'data','local','updater','updater.log');
const HEALTH_TIMEOUT_MS=60000;
function log(event,meta={}){try{fs.mkdirSync(path.dirname(LOG_FILE),{recursive:true});fs.appendFileSync(LOG_FILE,JSON.stringify({at:new Date().toISOString(),event,...meta})+'\n','utf8');}catch(_){} }

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
  app.exit(0);
}else{
const lifecycle=createLauncherState({bootstrapCore:BOOTSTRAP_CORE,portableRoot:PORTABLE_ROOT});
const recovered=app.isPackaged?lifecycle.rollbackExistingTrial():null;
if(recovered)log('rollback-on-next-launch',{failedVersion:recovered.failed.version,restoredVersion:recovered.restored.version});
const activationResult=app.isPackaged?lifecycle.activatePending():null;
const activation=activationResult&&activationResult.activation||null;
const selected=app.isPackaged?lifecycle.currentPointer():lifecycle.bootstrapPointer();
if(activation)log('activation-started',{version:activation.version,previousVersion:activation.previous&&activation.previous.version||''});
process.env.BUYER_LOG_BOOTSTRAP_APP_CORE=BOOTSTRAP_CORE;
process.env.BUYER_LOG_ACTIVE_APP_CORE=selected.appCoreRoot;
process.env.BUYER_LOG_ACTIVE_VERSION=selected.version;
process.env.BUYER_LOG_UPDATER_VERSION=UPDATER_VERSION;
if(activation)process.env.BUYER_LOG_UPDATE_HEALTH_TOKEN=activation.token;

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
try{
  require(path.join(selected.appCoreRoot,'electron','main.js'));
}catch(error){
  log('active-core-load-failed',{version:selected.version,code:error&&error.code||'',message:String(error&&error.message||error).slice(0,500)});
  if(activation){lifecycle.requestRollback(activation,'main-load-failed');log('rollback-requested',{failedVersion:activation.version,reason:'main-load-failed'});try{app.relaunch();}catch(_){};app.quit();}
  else throw error;
}
}
