'use strict';
/* Kendi kendini güncelleyen launcher altyapısı (launcher 1.2.0).
 *
 * Launcher dosyaları imzalı release çekirdeğinin içinde gelir. Doğrulanmış bir
 * çekirdekten (çalışan sağlıklı sürüm ya da updater'ın imza + SHA-256 ile
 * hazırladığı sürüm) .buyerlog-launcher\<sürüm>-<özet> klasörüne kopyalanır, her
 * dosya özetiyle data\local\updater\launcher.json kaydına yazılır ve tek atomik
 * pointer yazımıyla etkinleşir. Kurulum kökünde yalnız giriş dosyası bir kez
 * stage-0 host ile değiştirilir; eski giriş dosyası launcher-legacy.js olarak
 * korunur. Yönetici yetkisi, servis veya yeni ikili dosya gerekmez. Kontroller
 * başarısızsa hiçbir pointer değişmez ve mevcut launcher çalışmaya devam eder. */
const fs=require('fs');
const path=require('path');
const crypto=require('crypto');
const F=require('../manual-patch/files');
const { verifyPackagedCore,readHostReceipt,HOST_RECEIPT,HOST_ENTRY,HOST_LEGACY }=require('../manual-patch/core-verification');
const { atomicWriteBuffer,atomicWriteJson,ensureDir,syncDirectory }=require('./json-store');
const { compareSemver,parseSemver }=require('./semver');
const { createLauncherState }=require('./launcher-state');

const VERSION_FILE='electron/update/launcher-version.json';
const LAUNCHER_FILES=[...new Set([...F.BOOTSTRAP_FILES,F.ANCHOR])].sort();
const ID_PATTERN=/^\d+\.\d+\.\d+-[a-f0-9]{12}$/;
const READONLY=new Set(['EACCES','EPERM','EROFS']);
const RETRY_AFTER_MS=24*60*60*1000;

function hostError(code,tr,en,extra={}){return Object.assign(new Error(tr+' / '+en),{code,...extra});}
const sha=buffer=>crypto.createHash('sha256').update(buffer).digest('hex');
function semverOrNull(value){const text=String(value||'');return parseSemver(text)?text:null;}

function readLauncherInfo(core){
  let value;
  try{value=JSON.parse(F.bytes(core,VERSION_FILE).toString('utf8'));}catch(error){
    if(error.code==='ENOENT')return null;
    throw hostError('UPDATE_LAUNCHER_INVALID','Launcher sürüm kaydı okunamadı.','The launcher version record could not be read.');
  }
  if(value?.schemaVersion!==1||!semverOrNull(value.launcherVersion)||!semverOrNull(value.minimumActivationLauncher))throw hostError('UPDATE_LAUNCHER_INVALID','Launcher sürüm kaydı geçersiz.','The launcher version record is invalid.');
  return {launcherVersion:value.launcherVersion,minimumActivationLauncher:value.minimumActivationLauncher};
}

function createLauncherHost(options={}){
  const bootstrapCore=path.resolve(options.bootstrapCore||'');
  const portableRoot=path.resolve(options.portableRoot||'');
  const env=options.env||process.env;
  const runningVersion=semverOrNull(options.runningVersion??env.BUYER_LOG_UPDATER_VERSION)||'1.0.0';
  const runningHost=String(options.runningHost??env.BUYER_LOG_LAUNCHER_HOST??'');
  const runningId=String(options.runningId??env.BUYER_LOG_LAUNCHER_ID??'');
  const now=typeof options.now==='function'?options.now:()=>new Date().toISOString();
  const writeBuffer=typeof options.writeBuffer==='function'?options.writeBuffer:atomicWriteBuffer;
  const updaterRoot=path.join(portableRoot,'data','local','updater');
  const pointerFile=path.join(updaterRoot,'launcher.json');
  const reportFile=path.join(updaterRoot,'launcher-upgrade.json');
  const managedRoot=path.join(portableRoot,'.buyerlog-launcher');

  function readJsonFile(file){
    try{const stat=fs.lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>1024*1024)return null;const value=JSON.parse(fs.readFileSync(file,'utf8').replace(/^﻿/,''));return value&&typeof value==='object'&&!Array.isArray(value)?value:null;}
    catch(_){return null;}
  }
  function readPointer(){const value=readJsonFile(pointerFile);return value&&value.schemaVersion===1?value:{schemaVersion:1,current:null,previous:null,failed:{}};}
  function verifyManaged(entry){
    try{
      if(!entry||!ID_PATTERN.test(String(entry.id||''))||!entry.files||typeof entry.files!=='object')return false;
      const root=path.join(managedRoot,entry.id),stat=fs.lstatSync(root);if(!stat.isDirectory()||stat.isSymbolicLink())return false;
      const names=Object.keys(entry.files);if(!names.includes('electron/launcher-core.js'))return false;
      return names.every(relative=>F.metadata(root,relative).sha256===entry.files[relative]);
    }catch(_){return false;}
  }
  function installedLauncher(){
    const current=readPointer().current;
    return current&&verifyManaged(current)?{id:current.id,version:String(current.version||''),sourceVersion:String(current.sourceVersion||''),confirmed:Boolean(current.confirmedAt)}:null;
  }
  // Yeniden başlatmadan sonra çalışacak launcher sürümü (hazırlanmış olan dahil).
  function effectiveVersion(){const installed=installedLauncher();return installed&&compareSemver(installed.version,runningVersion)>0?installed.version:runningVersion;}

  function sourceLauncher(sourceCore,sourceVersion){
    const info=readLauncherInfo(sourceCore);
    if(!info)return null;
    const files={};
    for(const relative of LAUNCHER_FILES){
      try{files[relative]=F.metadata(sourceCore,relative).sha256;}
      catch(error){throw hostError('UPDATE_LAUNCHER_SOURCE_INCOMPLETE','Release launcher dosyaları eksik: '+relative,'Release launcher files are incomplete: '+relative,{cause:error});}
    }
    const id=info.launcherVersion+'-'+sha(Buffer.from(JSON.stringify(Object.entries(files)))).slice(0,12);
    return {...info,id,files,sourceCore:path.resolve(sourceCore),sourceVersion:String(sourceVersion||'')};
  }
  function needsInstall(source){
    if(!source||compareSemver(source.launcherVersion,runningVersion)<0)return false;
    const installed=installedLauncher();
    if(installed){
      if(installed.id===source.id)return false;
      const order=compareSemver(source.launcherVersion,installed.version);
      if(order<0)return false;
      if(order===0&&(!semverOrNull(installed.sourceVersion)||!semverOrNull(source.sourceVersion)||compareSemver(source.sourceVersion,installed.sourceVersion)<=0))return false;
      return true;
    }
    // Yeni tam kurulum zaten bu çekirdeğin launcher'ı ile çalışıyor.
    if(runningHost&&runningId==='bundled'&&source.sourceCore===bootstrapCore)return false;
    return !(runningHost&&runningId===source.id);
  }

  // Geri dönüş hedefi olabilecek çekirdekler yeni launcher'ın açılış
  // doğrulamasından geçmezse geçiş yapılmaz: launcher hiçbir kurulumu açılamaz bırakmaz.
  function preflight(source){
    verifyPackagedCore(source.sourceCore,source.sourceVersion);
    const lifecycle=createLauncherState({bootstrapCore,portableRoot});
    try{verifyPackagedCore(bootstrapCore,lifecycle.packageVersion(bootstrapCore));}
    catch(error){throw hostError('UPDATE_LAUNCHER_BOOTSTRAP_UNVERIFIED','Kurulum klasörü dosyaları imzalı paketle eşleşmiyor; güncelleme altyapısı otomatik yükseltilmedi. Temiz imzalı tam paket kurun.','Installation files do not match the signed package; the update infrastructure was not upgraded automatically. Install a clean signed full package.',{cause:error});}
    const current=lifecycle.currentPointer(),relative=path.relative(lifecycle.versionsRoot,current.appCoreRoot);
    if(path.resolve(current.appCoreRoot)!==bootstrapCore&&!relative.split(path.sep)[0].startsWith('manual-')){
      try{verifyPackagedCore(current.appCoreRoot,current.version);}
      catch(error){throw hostError('UPDATE_LAUNCHER_CURRENT_UNVERIFIED','Çalışan sürümün dosyaları değişmiş; güncelleme altyapısı yükseltilmedi.','Files of the running version changed; the update infrastructure was not upgraded.',{cause:error});}
    }
  }
  function writeLauncherFolder(source){
    ensureDir(managedRoot);
    const target=path.join(managedRoot,source.id);
    if(path.dirname(target)!==managedRoot)throw hostError('UPDATE_LAUNCHER_INVALID','Launcher yolu güvenli değil.','The launcher path is unsafe.');
    if(fs.existsSync(target)){
      if(verifyManaged({id:source.id,files:source.files}))return target;
      if(runningId===source.id)throw hostError('UPDATE_LAUNCHER_INVALID','Çalışan launcher dosyaları değişmiş.','The running launcher files changed.');
      fs.rmSync(target,{recursive:true,force:true});
    }
    const stage=path.join(managedRoot,'.stage-'+process.pid+'-'+crypto.randomBytes(6).toString('hex'));
    try{
      for(const [relative,expected] of Object.entries(source.files)){
        const buffer=F.bytes(source.sourceCore,relative);
        if(sha(buffer)!==expected)throw hostError('UPDATE_LAUNCHER_SOURCE_CHANGED','Launcher kaynak dosyası kopyalama sırasında değişti.','A launcher source file changed while copying.');
        writeBuffer(path.join(stage,...relative.split('/')),buffer);
      }
      fs.renameSync(stage,target);syncDirectory(managedRoot);
    }finally{fs.rmSync(stage,{recursive:true,force:true});}
    if(!verifyManaged({id:source.id,files:source.files}))throw hostError('UPDATE_LAUNCHER_INVALID','Kopyalanan launcher doğrulanamadı.','The copied launcher could not be verified.');
    return target;
  }
  /* Kurulum kökünde tek değişiklik: giriş dosyası. Sıra kesintiye dayanıklıdır:
   * önce özgün dosya korunur, sonra makbuz yazılır, en son giriş dosyası atomik
   * olarak değiştirilir. Her ara durum hem açılır hem bütünlük kontrolünden geçer. */
  function ensureStage0(stage0){
    const entry=path.join(bootstrapCore,...HOST_ENTRY.split('/')),legacy=path.join(bootstrapCore,...HOST_LEGACY.split('/')),receiptFile=path.join(bootstrapCore,...HOST_RECEIPT.split('/'));
    const current=F.bytes(bootstrapCore,HOST_ENTRY),currentSha=sha(current),stage0Sha=sha(stage0),receipt=readHostReceipt(bootstrapCore);
    if(currentSha===stage0Sha)return false;
    try{
      if(receipt&&currentSha!==receipt.legacySha256&&currentSha!==receipt.stage0Sha256&&currentSha!==receipt.previousStage0Sha256)throw hostError('UPDATE_LAUNCHER_BOOTSTRAP_UNVERIFIED','Kurulum giriş dosyası beklenmeyen biçimde değişmiş.','The installation entry file changed unexpectedly.');
      let legacySha=receipt?receipt.legacySha256:currentSha;
      if(!receipt){
        writeBuffer(legacy,current);
        if(sha(F.bytes(bootstrapCore,HOST_LEGACY))!==legacySha)throw hostError('UPDATE_LAUNCHER_INVALID','Önceki başlatıcı korunamadı.','The previous launcher could not be preserved.');
      }
      const next={schemaVersion:1,stage0Sha256:stage0Sha,legacySha256:legacySha,installedAt:now()};
      if(receipt&&currentSha!==legacySha)next.previousStage0Sha256=currentSha;
      atomicWriteJson(receiptFile,next);
      writeBuffer(entry,stage0);
      if(sha(F.bytes(bootstrapCore,HOST_ENTRY))!==stage0Sha)throw hostError('UPDATE_LAUNCHER_INVALID','Başlatıcı giriş dosyası doğrulanamadı.','The launcher entry file could not be verified.');
    }catch(error){
      if(READONLY.has(error.code))throw hostError('UPDATE_LAUNCHER_BOOTSTRAP_READONLY','Kurulum klasörü yazılamıyor; güncelleme altyapısı yükseltilemedi. Buyer Log yazma izni olan bir klasöre kurulmalı.','The installation folder is not writable; the update infrastructure could not be upgraded. Buyer Log must be installed in a writable folder.',{cause:error});
      throw error;
    }
    return true;
  }
  function cleanup(pointer){
    const keep=new Set([pointer.current?.id,pointer.previous?.id,runningId].filter(Boolean));
    try{for(const name of fs.readdirSync(managedRoot)){
      const full=path.join(managedRoot,name);if(keep.has(name)||path.dirname(full)!==managedRoot)continue;
      const stat=fs.lstatSync(full);if(!stat.isDirectory()||stat.isSymbolicLink())continue;
      if(ID_PATTERN.test(name)||name.startsWith('.stage-'))fs.rmSync(full,{recursive:true,force:true});
    }}catch(_){}
  }
  function report(patch){try{atomicWriteJson(reportFile,{schemaVersion:1,...(readJsonFile(reportFile)||{}),...patch});}catch(_){} }

  /* Kaynak çekirdeğin launcher'ını kurar. Kaynak, çalışan sağlıklı çekirdek ya da
   * updater'ın imzalı manifest + SHA-256 ile doğruladığı hazırlanmış çekirdektir.
   * Dönüş: {changed, version, id, restartRequired}. */
  function install({sourceCore,sourceVersion,force=false,ignoreRecentFailure=false}={}){
    let source=null;
    try{
      source=sourceLauncher(sourceCore,sourceVersion);
      if(!source)return {changed:false,reason:'no-launcher'};
      if(!force&&!needsInstall(source)){return {changed:false,version:effectiveVersion(),id:installedLauncher()?.id||runningId};}
      // Kalıcı engel (değiştirilmiş/yazılamayan kurulum) her açılışta tam
      // bütünlük taraması yaptırmasın; aynı kaynak için günde bir deneme yeter.
      const recent=readJsonFile(reportFile)?.lastError;
      if(!force&&!ignoreRecentFailure&&recent&&recent.sourceId===source.id&&Date.now()-Date.parse(recent.at)<RETRY_AFTER_MS)return {changed:false,skipped:'recent-failure',code:recent.code};
      const pointer=readPointer();
      if(pointer.failed&&pointer.failed[source.id])throw hostError('UPDATE_LAUNCHER_REJECTED','Bu güncelleme altyapısı bu bilgisayarda daha önce açılamadı; önceki altyapı kullanılıyor.','This update infrastructure failed to start on this computer before; the previous one remains in use.');
      preflight(source);
      const folder=writeLauncherFolder(source);
      ensureStage0(F.bytes(folder,HOST_ENTRY));
      const old=pointer.current&&verifyManaged(pointer.current)?pointer.current:null;
      const next={schemaVersion:1,
        current:{id:source.id,version:source.launcherVersion,sourceVersion:source.sourceVersion,files:source.files,installedAt:now(),confirmedAt:null},
        previous:old&&old.id!==source.id&&old.confirmedAt?old:(pointer.previous&&verifyManaged(pointer.previous)?pointer.previous:null),
        failed:pointer.failed&&typeof pointer.failed==='object'?pointer.failed:{}};
      atomicWriteJson(pointerFile,next);
      try{fs.unlinkSync(path.join(updaterRoot,'launcher-boot.json'));}catch(_){}
      cleanup(next);
      report({lastError:null,lastInstall:{id:source.id,version:source.launcherVersion,sourceVersion:source.sourceVersion,at:now()}});
      return {changed:true,version:source.launcherVersion,id:source.id,restartRequired:true};
    }catch(error){
      const code=String(error.code||'UPDATE_LAUNCHER_UPGRADE_FAILED');
      report({lastError:{code:/^UPDATE_/.test(code)?code:'UPDATE_LAUNCHER_UPGRADE_FAILED',message:String(error.message||error).slice(0,500),sourceVersion:String(sourceVersion||''),sourceId:source?.id||'',at:now()}});
      throw /^UPDATE_/.test(code)?error:Object.assign(error,{code:'UPDATE_LAUNCHER_UPGRADE_FAILED'});
    }
  }
  function status(){
    const installed=installedLauncher(),saved=readJsonFile(reportFile);
    return {running:runningVersion,hosted:Boolean(runningHost),installed:installed?installed.version:null,effective:effectiveVersion(),
      restartRequired:Boolean(installed&&installed.id!==runningId),lastError:saved&&saved.lastError||null};
  }
  return {readLauncherInfo,sourceLauncher,needsInstall,installedLauncher,effectiveVersion,install,status,ensureStage0,pointerFile,managedRoot};
}
module.exports={createLauncherHost,readLauncherInfo,LAUNCHER_FILES};
