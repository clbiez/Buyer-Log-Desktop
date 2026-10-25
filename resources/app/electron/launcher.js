'use strict';
/* Buyer Log launcher host (stage-0).
 *
 * Electron her açılışta resources\app\package.json → bu dosyayı çalıştırır.
 * Kurulum klasörü yalnız tam paketle değişirdi; bu yüzden launcher/updater
 * altyapısı kendi kendini güncelleyemiyor ve yeni release'ler eski launcher'ı
 * UPDATE_UPDATER_TOO_OLD ile reddediyordu (7.0.294 / updater 1.0.0 olayı).
 *
 * Bu dosya bilinçli olarak küçük, bağımlılıksız ve nadiren değişen tek giriş
 * noktasıdır. Asıl launcher'ı (launcher-core.js) şu sırayla seçer:
 *   1. data\local\updater\launcher.json "current": imzalı release'ten
 *      .buyerlog-launcher\<id> altına kopyalanmış ve her dosyası SHA-256 ile
 *      doğrulanan yönetilen launcher.
 *   2. Aynı kaydın "previous" (son onaylı) launcher'ı.
 *   3. Bu kurulumla gelen launcher-core.js.
 *   4. Bu kurulumun önceki giriş dosyası (launcher-legacy.js; eski 1.0/1.1
 *      kurulumlarda geçişte bayt bayt korunur).
 * Yükleme (require) hatası veya iki açılış boyunca onaylanmayan yeni launcher
 * otomatik olarak bir sonraki adaya düşer. Launcher'ın bilinçli güvenlik
 * kapanışları (UPDATE_*, PATCH_* kodlu hatalar) geri dönüşle atlatılmaz. */
const fs=require('fs');
const path=require('path');
const crypto=require('crypto');
const { app }=require('electron');

const HOST_PROTOCOL=1;
const MAX_UNCONFIRMED_STARTS=2;
const BOOTSTRAP_CORE=path.resolve(__dirname,'..');
const ID_PATTERN=/^\d+\.\d+\.\d+-[a-f0-9]{12}$/;
const FILE_PATTERN=/^electron\/[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/;

function portableRoot(){
  const override=String(process.env.BUYER_LOG_PORTABLE_ROOT||'').trim();
  if(override)return path.resolve(override);
  if(app.isPackaged)return path.resolve(path.dirname(process.execPath));
  return path.resolve(BOOTSTRAP_CORE,'.desktop-dev');
}
const PORTABLE_ROOT=portableRoot();
const UPDATER_ROOT=path.join(PORTABLE_ROOT,'data','local','updater');
const POINTER_FILE=path.join(UPDATER_ROOT,'launcher.json');
const BOOT_FILE=path.join(UPDATER_ROOT,'launcher-boot.json');
const MANAGED_ROOT=path.join(PORTABLE_ROOT,'.buyerlog-launcher');

function log(event,meta={}){try{fs.mkdirSync(UPDATER_ROOT,{recursive:true});fs.appendFileSync(path.join(UPDATER_ROOT,'updater.log'),JSON.stringify({at:new Date().toISOString(),event,...meta})+'\n','utf8');}catch(_){} }
function message(error){return String(error&&error.message||error).slice(0,300);}
function readJson(file){
  try{
    const stat=fs.lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>1024*1024)return null;
    const value=JSON.parse(fs.readFileSync(file,'utf8').replace(/^﻿/,''));
    return value&&typeof value==='object'&&!Array.isArray(value)?value:null;
  }catch(_){return null;}
}
// Defter yazımı açılışı asla durdurmaz; yazılamazsa yalnız günlüğe düşer.
function writeJson(file,value){
  const tmp=file+'.tmp-'+process.pid+'-'+crypto.randomBytes(6).toString('hex');
  try{
    fs.mkdirSync(path.dirname(file),{recursive:true});
    const fd=fs.openSync(tmp,'wx');try{fs.writeFileSync(fd,JSON.stringify(value,null,2)+'\n');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
    fs.renameSync(tmp,file);
  }catch(error){log('launcher-ledger-write-failed',{file:path.basename(file),message:message(error)});try{fs.unlinkSync(tmp);}catch(_){}}
}
function removeFile(file){try{fs.unlinkSync(file);}catch(_){} }

function managedCandidate(entry,role){
  if(!entry||typeof entry!=='object'||!ID_PATTERN.test(String(entry.id||''))||!entry.files||typeof entry.files!=='object'||Array.isArray(entry.files))throw new Error('invalid launcher record');
  const root=path.join(MANAGED_ROOT,entry.id),rootStat=fs.lstatSync(root);
  if(!rootStat.isDirectory()||rootStat.isSymbolicLink()||path.dirname(root)!==MANAGED_ROOT)throw new Error('unsafe launcher folder');
  const files=Object.entries(entry.files);
  if(!entry.files['electron/launcher-core.js']||files.length>200)throw new Error('incomplete launcher record');
  for(const [relative,expected] of files){
    if(!FILE_PATTERN.test(relative)||relative.split('/').some(part=>part==='.'||part==='..')||!/^[a-f0-9]{64}$/.test(String(expected)))throw new Error('invalid launcher file record');
    const file=path.join(root,...relative.split('/')),stat=fs.lstatSync(file);
    if(!stat.isFile()||stat.isSymbolicLink())throw new Error('launcher file is not regular: '+relative);
    if(crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')!==expected)throw new Error('launcher file changed: '+relative);
  }
  return {kind:'managed',role,id:entry.id,version:String(entry.version||''),root,entry:path.join(root,'electron','launcher-core.js'),confirmed:Boolean(entry.confirmedAt)};
}
function candidates(){
  const list=[];
  // Eski bir stage-0'dan geri dönüşle çağrılırsak yönetilen kayıtlar zaten denendi.
  if(app.isPackaged&&!global.__buyerLogLauncherHost){
    const pointer=readJson(POINTER_FILE);
    if(pointer&&pointer.schemaVersion===1)for(const role of ['current','previous']){
      if(!pointer[role])continue;
      try{list.push(managedCandidate(pointer[role],role));}
      catch(error){log('launcher-candidate-rejected',{role,id:String(pointer[role].id||'').slice(0,80),message:message(error)});}
    }
  }
  for(const [kind,name] of [['bundled','launcher-core.js'],['legacy','launcher-legacy.js']]){
    const file=path.join(__dirname,name);
    if(fs.existsSync(file))list.push({kind,id:kind,root:BOOTSTRAP_CORE,entry:file,confirmed:true});
  }
  return list;
}
function demote(candidate,reason){
  const pointer=readJson(POINTER_FILE);if(!pointer||pointer.schemaVersion!==1||pointer[candidate.role]?.id!==candidate.id)return;
  const failed={...(pointer.failed&&typeof pointer.failed==='object'?pointer.failed:{}),[candidate.id]:{at:new Date().toISOString(),reason}};
  const next=candidate.role==='current'?{...pointer,current:pointer.previous||null,previous:null,failed}:{...pointer,previous:null,failed};
  writeJson(POINTER_FILE,next);removeFile(BOOT_FILE);
  log('launcher-demoted',{id:candidate.id,role:candidate.role,reason});
}
function admit(candidate){
  if(candidate.kind!=='managed'||candidate.confirmed)return true;
  const boot=readJson(BOOT_FILE),attempts=boot&&boot.id===candidate.id?Math.max(0,Number(boot.attempts)||0):0;
  if(attempts>=MAX_UNCONFIRMED_STARTS){demote(candidate,'unconfirmed-start');return false;}
  writeJson(BOOT_FILE,{schemaVersion:1,id:candidate.id,attempts:attempts+1,at:new Date().toISOString()});
  return true;
}
function confirm(candidate){
  if(candidate.kind!=='managed'||candidate.confirmed)return;
  candidate.confirmed=true;
  const pointer=readJson(POINTER_FILE);
  if(pointer&&pointer.schemaVersion===1&&pointer.current?.id===candidate.id&&!pointer.current.confirmedAt){
    writeJson(POINTER_FILE,{...pointer,current:{...pointer.current,confirmedAt:new Date().toISOString()}});
    log('launcher-confirmed',{id:candidate.id,version:candidate.version});
  }
  if(readJson(BOOT_FILE)?.id===candidate.id)removeFile(BOOT_FILE);
}

function run(){
  for(const candidate of candidates()){
    if(!admit(candidate))continue;
    let launcher;
    // Korunan giriş dosyası daha eski bir stage-0 olabilir; yönetilen kayıtları tekrar denemesin.
    if(candidate.kind==='legacy')global.__buyerLogLauncherHost={protocol:HOST_PROTOCOL,bootstrapCore:BOOTSTRAP_CORE,launcherKind:'legacy'};
    try{launcher=require(candidate.entry);}
    catch(error){
      log('launcher-load-failed',{kind:candidate.kind,id:candidate.id,code:error&&error.code||'',message:message(error)});
      if(candidate.kind==='managed')demote(candidate,'load-failed');
      if(candidate.kind==='legacy')throw error;
      continue;
    }
    // Eski launcher dosyaları require anında çalışır ve start() sunmaz.
    if(candidate.kind==='legacy'&&typeof launcher?.start!=='function')return;
    if(typeof launcher?.start!=='function'){log('launcher-entry-invalid',{kind:candidate.kind,id:candidate.id});if(candidate.kind==='managed')demote(candidate,'entry-invalid');continue;}
    const host={protocol:HOST_PROTOCOL,bootstrapCore:BOOTSTRAP_CORE,portableRoot:PORTABLE_ROOT,launcherRoot:candidate.root,launcherId:candidate.id,launcherKind:candidate.kind,confirm:()=>confirm(candidate)};
    global.__buyerLogLauncherHost=host;
    try{launcher.start(host);}
    catch(error){
      // Bilinçli güvenlik kapanışı launcher'ın doğru çalıştığını gösterir.
      if(/^(UPDATE|PATCH)_/.test(String(error&&error.code||'')))confirm(candidate);
      log('launcher-start-failed',{kind:candidate.kind,id:candidate.id,code:error&&error.code||'',message:message(error)});
      throw error;
    }
    return;
  }
  throw Object.assign(new Error('Buyer Log başlatıcısı yüklenemedi; imzalı tam paketi yeniden kurun. / The Buyer Log launcher could not be loaded; reinstall the signed full package.'),{code:'UPDATE_LAUNCHER_UNAVAILABLE'});
}
run();
module.exports={HOST_PROTOCOL};
