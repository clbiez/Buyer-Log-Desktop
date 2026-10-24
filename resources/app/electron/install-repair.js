'use strict';
/* Tek seferlik kurulum onarımı (7.0.184).
 *
 * Her yeni sürüm ilk açılışında bir kez çalışır ve kullanıcı verisine
 * dokunmadan, güncellemenin "gerçekten" yerine oturmasını engelleyen
 * kalıntıları temizler:
 *   1. Eski arayüz önbelleği: Chromium HTTP önbelleği, Cache Storage ve
 *      service worker kayıtları silinir (localStorage / IndexedDB / çerezler
 *      korunur). Yeni sürümde eski JS/CSS görünmesinin önüne geçer.
 *   2. Güncelleme durumu: çalışan sürümden eski ya da ona eşit sürümler için
 *      kalan "başarısız" kayıtları, eskimiş bekleyen paketi ve eski hata
 *      mesajını temizler. Böylece eski bir geri alma, sonraki sürümleri
 *      engellemez ve panel yanlış hata göstermez.
 *   3. Çekirdek bütünlüğü: çalışan uygulama dosyaları release build'inin
 *      SHA-256 listesiyle karşılaştırılır. Eksik/farklı dosya varsa ve aynı
 *      sürümün doğrulanmış paketi önbellekteyse temiz bir kopya açılır ve bir
 *      sonraki açılışta normal deneme + geri alma güvencesiyle etkinleştirilir.
 * Sonuç data/local/updater/repair-report.json dosyasına yazılır ve güncelleme
 * panelinde gösterilir. Hiçbir adım açılışı durdurmaz. */
const fs=require('fs');
const path=require('path');
const { compareSemver }=require('./update/semver');
const { readJson,atomicWriteJson,ensureDir }=require('./update/json-store');
const { sha256File }=require('./update/crypto');
const { extractZipSafe }=require('./update/zip');
const { verifyIntegrity }=require('./update/integrity');

const REPAIR_SCHEMA=1;
function versionKey(version){return String(version||'').replace(/[^0-9A-Za-z._-]/g,'_');}
function notNewer(version,current){try{return compareSemver(String(version||''),current)<=0;}catch(_){return false;}}
function rmSafe(target){try{fs.rmSync(target,{recursive:true,force:true});}catch(_){} }

function reportFile(localDataRoot){return path.join(localDataRoot,'updater','repair-report.json');}
function readRepairReport(localDataRoot){const r=readJson(reportFile(localDataRoot),null);return r&&r.schemaVersion===REPAIR_SCHEMA?r:null;}

/* Adım 2 — saf durum temizliği; test edilebilir olsun diye ayrı. */
function cleanUpdaterState(state,currentVersion){
  const next={...state},actions=[];
  if(state.activation?.status==='trial')return {state:next,actions};
  const failed={...(state.failedVersions||{})};
  for(const version of Object.keys(failed))if(notNewer(version,currentVersion)&&!failed[version]?.manualPatch){delete failed[version];actions.push('failed-record-cleared:'+version);}
  next.failedVersions=failed;
  if(state.pending&&!state.pending.manualPatch&&notNewer(state.pending.version,currentVersion)){next.pending=null;actions.push('stale-pending-cleared:'+state.pending.version);}
  const stuck=['FAILED','ROLLBACK','INSTALLING'].includes(String(state.state||''));
  const latestIsCurrent=!state.latestVersion||notNewer(state.latestVersion,currentVersion);
  if(stuck&&latestIsCurrent&&!next.pending&&!state.lastError?.manualPatch){next.state='IDLE';next.lastError=null;actions.push('stale-error-cleared');}
  if(state.lastKnownGoodVersion&&compareSemverSafe(state.lastKnownGoodVersion,currentVersion)>0){next.lastKnownGoodVersion=currentVersion;actions.push('last-known-good-corrected');}
  return {state:next,actions};
}
function compareSemverSafe(a,b){try{return compareSemver(String(a||''),String(b||''));}catch(_){return 0;}}

async function clearRendererCache(session,log){
  if(!session||!session.defaultSession)return {ok:false,skipped:'no-session'};
  try{
    await session.defaultSession.clearCache();
    await session.defaultSession.clearStorageData({storages:['serviceworkers','cachestorage','shadercache']});
    return {ok:true};
  }catch(error){log('Onarım: arayüz önbelleği temizlenemedi: '+error.message);return {ok:false,error:String(error.message||error).slice(0,300)};}
}

async function restageDamagedCore({updater,appCoreRoot,currentVersion,log}){
  const versionsRoot=path.resolve(updater.versionsRoot),core=path.resolve(appCoreRoot);
  if(!core.startsWith(versionsRoot+path.sep))return {restaged:false,reason:'bootstrap-core'};
  const release=readJson(path.join(path.dirname(core),'release.json'),null);
  if(!release||release.version!==currentVersion||!/^[0-9a-f]{64}$/.test(String(release.sha256||'')))return {restaged:false,reason:'no-release-record'};
  const cacheFile=path.join(updater.cacheRoot,`${versionKey(currentVersion)}-${release.sha256.slice(0,12)}.zip`);
  if(!fs.existsSync(cacheFile)||await sha256File(cacheFile)!==release.sha256)return {restaged:false,reason:'no-verified-cache'};
  const target=path.join(versionsRoot,`${versionKey(currentVersion)}-repair-${Date.now()}`),stage=target+'.partial';
  rmSafe(stage);ensureDir(stage);
  try{
    extractZipSafe(cacheFile,stage,{maxFiles:30000,maxBytes:1024*1024*1024});
    const pkg=readJson(path.join(stage,'app','package.json'),null);
    if(!pkg||pkg.version!==currentVersion)throw new Error('Onarım paketi sürümü eşleşmiyor.');
    fs.renameSync(stage,target);atomicWriteJson(path.join(target,'release.json'),release);
  }catch(error){rmSafe(stage);log('Onarım: temiz çekirdek açılamadı: '+error.message);return {restaged:false,reason:'extract-failed'};}
  const pending={version:currentVersion,sha256:release.sha256,channel:release.channel||'stable',mandatory:false,releaseNotes:'Kurulum onarımı: aynı sürümün temiz kopyası',ready:true,repair:true,versionRoot:target,appCoreRoot:path.join(target,'app'),preparedAt:new Date().toISOString()};
  updater.saveState({state:'READY_TO_INSTALL',pending,lastError:null});
  updater.appendLog('repair-restaged',{version:currentVersion});
  return {restaged:true};
}

async function runInstallRepair(options={}){
  const {localDataRoot,appCoreRoot,currentVersion,updater=null,session=null,packaged=false}=options;
  const log=typeof options.log==='function'?options.log:()=>{};
  const previous=readRepairReport(localDataRoot);
  // Aynı sürüm aynı çekirdekten bir kez onarılır; onarılmış kopyaya geçildiyse o kopya da bir kez doğrulanır.
  if(previous&&previous.version===currentVersion&&previous.appCoreRoot===path.resolve(appCoreRoot)&&previous.finishedAt&&!options.force)return {skipped:true,report:previous};
  const report={schemaVersion:REPAIR_SCHEMA,version:currentVersion,startedAt:new Date().toISOString(),appCoreRoot:path.resolve(appCoreRoot),steps:{}};
  const save=()=>{try{ensureDir(path.dirname(reportFile(localDataRoot)));atomicWriteJson(reportFile(localDataRoot),report);}catch(_){}};

  report.steps.rendererCache=packaged?await clearRendererCache(session,log):{ok:true,skipped:'development'};

  if(updater){
    try{
      const {state,actions}=cleanUpdaterState(updater.state(),currentVersion);
      if(actions.length){updater.saveState(state);updater.appendLog('repair-state-cleaned',{actions:actions.join(',')});}
      report.steps.updaterState={ok:true,actions};
    }catch(error){report.steps.updaterState={ok:false,error:String(error.message||error).slice(0,300)};}
  }

  save();
  // Bütünlük kontrolü uzun sürebilir; açılış beklemez, sonuç rapora sonra eklenir.
  const integrity=(async()=>{
    try{
      const result=await verifyIntegrity(appCoreRoot,{version:currentVersion});
      const step={status:result.status,checked:result.checked,missing:result.missing.slice(0,20),changed:result.changed.slice(0,20),missingCount:result.missing.length,changedCount:result.changed.length};
      if(result.status==='damaged'){
        log('Onarım: çekirdek bütünlüğü bozuk · eksik '+result.missing.length+' · farklı '+result.changed.length);
        const alreadyRestaged=Boolean(previous&&previous.version===currentVersion&&previous.steps&&previous.steps.integrity&&previous.steps.integrity.restage&&previous.steps.integrity.restage.restaged);
        step.restage=updater&&packaged&&!alreadyRestaged
          ?await restageDamagedCore({updater,appCoreRoot,currentVersion,log}):{restaged:false,reason:'not-applicable'};
      }
      report.steps.integrity=step;
    }catch(error){report.steps.integrity={status:'error',error:String(error.message||error).slice(0,300)};}
    report.finishedAt=new Date().toISOString();save();return report;
  })();
  return {skipped:false,report,integrity};
}

module.exports={runInstallRepair,readRepairReport,cleanUpdaterState,reportFile};
