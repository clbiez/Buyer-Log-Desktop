'use strict';
const path=require('node:path');
const F=require('./files'),S=require('./signature');

// Stage-0 host geçişi kurulum kökünde yalnız giriş dosyasını değiştirir. Eski
// giriş dosyası launcher-legacy.js olarak bayt bayt korunur; makbuz her ikisinin
// özetini kaydeder. Diğer tüm uygulama dosyaları kendi bütünlük kaydıyla denetlenir.
const HOST_RECEIPT='electron/launcher-host.json',HOST_ENTRY='electron/launcher.js',HOST_LEGACY='electron/launcher-legacy.js';
const HASH=/^[a-f0-9]{64}$/;
function readHostReceipt(core){
 let file;
 try{file=F.regularFile(core,HOST_RECEIPT);}catch(error){if(error.code==='ENOENT')return null;throw error;}
 const r=F.readJsonStrict(file,64*1024);
 if(r?.schemaVersion!==1||!HASH.test(r.stage0Sha256)||!HASH.test(r.legacySha256)||Object.hasOwn(r,'previousStage0Sha256')&&!HASH.test(r.previousStage0Sha256)||Object.keys(r).some(key=>!['schemaVersion','stage0Sha256','legacySha256','previousStage0Sha256','installedAt'].includes(key)))S.fail('UPDATE_CORE_INTEGRITY','Başlatıcı geçiş kaydı geçersiz.','The launcher migration record is invalid.');
 return r;
}

// The integrity manifest itself is installed inside protected electron/ code.
// Every application byte is checked before main.js or the backend is required.
function verifyPackagedCore(core,version){
 const m=F.readJsonStrict(F.regularFile(core,'electron/app-integrity.json'));
 if(m?.schemaVersion!==1||m.version!==version||!m.files||typeof m.files!=='object'||Array.isArray(m.files)||m.fileCount!==Object.keys(m.files).length||m.fileCount<4)S.fail('UPDATE_CORE_INTEGRITY','Kurulum bütünlük kaydı geçersiz.','The installation integrity record is invalid.');
 const host=readHostReceipt(core),expected={...m.files};
 if(host){
  if(m.files[HOST_ENTRY]!==host.legacySha256||Object.hasOwn(m.files,HOST_LEGACY))S.fail('UPDATE_CORE_INTEGRITY','Başlatıcı geçiş kaydı bu kuruluma ait değil.','The launcher migration record does not belong to this installation.');
  expected[HOST_LEGACY]=host.legacySha256;expected[HOST_ENTRY]=host.stage0Sha256;
 }
 const actual=F.inventory(core,{exclude:rel=>rel==='electron/app-integrity.json'||rel===F.RECEIPT||rel===HOST_RECEIPT});
 if(actual.length!==Object.keys(expected).length)S.fail('UPDATE_CORE_INTEGRITY','Kurulum dosya listesi değişmiş; imzalı tam paketi yeniden kurun.','Installation file inventory changed; reinstall the signed full package.');
 for(const file of actual){
  // Kesintiye uğramış geçişte giriş dosyası henüz özgün ya da önceki stage-0 hâlinde olabilir.
  const interrupted=host&&file.path===HOST_ENTRY&&(file.sha256===host.legacySha256||file.sha256===host.previousStage0Sha256);
  if(expected[file.path]!==file.sha256&&!interrupted)S.fail('UPDATE_CORE_INTEGRITY','Kurulum dosyaları değişmiş; imzalı tam paketi yeniden kurun.','Installation files changed; reinstall the signed full package.');
 }
 return {verified:true,fileCount:actual.length,core:path.resolve(core),launcherHost:Boolean(host)};
}
module.exports={verifyPackagedCore,readHostReceipt,HOST_RECEIPT,HOST_ENTRY,HOST_LEGACY};
