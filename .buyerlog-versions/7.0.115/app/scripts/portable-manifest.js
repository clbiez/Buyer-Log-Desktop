'use strict';
const fs=require('fs');
const path=require('path');
const crypto=require('crypto');
const { APP_ROOT,PORTABLE_ROOT,readPackage,atomicWriteJson }=require('./release-common');

function sha256(file){const h=crypto.createHash('sha256');h.update(fs.readFileSync(file));return h.digest('hex');}
function excluded(rel){
  const r=String(rel||'').replace(/\\/g,'/');
  return r==='dist-updates'||r.startsWith('dist-updates/')||r==='.release-pending.json'||r==='.desktop-dev'||r.startsWith('.desktop-dev/')||r==='server/data'||r.startsWith('server/data/');
}
function walk(root){
  const out=[];
  function visit(dir){
    for(const entry of fs.readdirSync(dir,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){
      const full=path.join(dir,entry.name),rel=path.relative(root,full).replace(/\\/g,'/');
      if(excluded(rel))continue;
      if(entry.isDirectory())visit(full);
      else if(entry.isFile())out.push({path:`resources/app/${rel}`,bytes:fs.statSync(full).size,sha256:sha256(full)});
    }
  }
  visit(root);return out;
}
function main(){
  const pkg=readPackage();
  const electronVersion=String(fs.readFileSync(path.join(PORTABLE_ROOT,'version'),'utf8')).trim();
  const manifest={
    format:'buyer-log-desktop-portable',schemaVersion:1,appVersion:pkg.version,electronVersion,
    chromiumFrom:`electron ${electronVersion}`,createdAt:new Date().toISOString(),distributionMode:'same-pc',
    adminRequired:false,installerRequired:false,runtimeEmbedded:true,runtimeDownloadRequired:false,asar:false,
    bind:'127.0.0.1:6194',mutableDataRoot:'data/',appCoreRoot:'resources/app/',
    excluded:['server/data (çalışma verisi)','kullanıcı veritabanı ve cihaz kimliği (ilk açılışta oluşur veya taşınır)','Edge/Chrome kurumsal tarayıcı profilleri','dist-updates ve release-pending (geliştirici build çıktıları)'],
    appCoreFiles:walk(APP_ROOT)
  };
  atomicWriteJson(path.join(PORTABLE_ROOT,'manifest.json'),manifest);
  console.log(JSON.stringify({appVersion:manifest.appVersion,electronVersion:manifest.electronVersion,files:manifest.appCoreFiles.length,manifest:path.join(PORTABLE_ROOT,'manifest.json')},null,2));
}
if(require.main===module){try{main();}catch(error){console.error(error&&error.stack||error);process.exitCode=1;}}
module.exports={main,walk,excluded};
