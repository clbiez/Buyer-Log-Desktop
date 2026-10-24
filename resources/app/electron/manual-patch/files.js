'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {BOOTSTRAP_VERSION,PRODUCT,IMMUTABLE_RUNTIME,filePath,fail}=require('./signature');
const {atomicWriteJson}=require('../update/json-store');
const ANCHOR='electron/manual-patch/bootstrap.json',RECEIPT='electron/manual-patch-receipt.json';
const BOOTSTRAP_FILES=['electron/launcher.js','electron/portable-paths.js',
 'electron/manual-patch/signature.js','electron/manual-patch/files.js','electron/manual-patch/manager.js','electron/manual-patch/desktop.js','electron/manual-patch/core-verification.js',
 'electron/update/json-store.js','electron/update/launcher-state.js','electron/update/semver.js',
 'electron/update/signature.js','electron/update/release-signing-keys.json','electron/update/zip.js','electron/update/integrity.js','electron/update/trial-backend.js',
 'electron/manual-patch/kernel/shared-file-transaction.js','electron/manual-patch/kernel/lease-worker-registry.js'].sort();
const sha=buffer=>crypto.createHash('sha256').update(buffer).digest('hex');
function regularFile(root,relative){
 filePath(relative);const base=path.resolve(root);let current=base;
 const baseStat=fs.lstatSync(base);if(!baseStat.isDirectory()||baseStat.isSymbolicLink())fail('PATCH_PATH_UNSAFE','Kurulum yolu güvenli değil.','The installation path is unsafe.');
 const parts=relative.split('/');
 for(let i=0;i<parts.length;i++){
  current=path.join(current,parts[i]);const stat=fs.lstatSync(current);
  if(stat.isSymbolicLink()||(i===parts.length-1?!stat.isFile():!stat.isDirectory()))fail('PATCH_PATH_UNSAFE','Yama dosyası normal dosya olmalı.','A patch file must be a regular file.');
 }
 return current;
}
function bytes(root,relative){const file=regularFile(root,relative);if(fs.statSync(file).size>128*1024*1024)fail('PATCH_FILE_LIMIT','Yama dosyası çok büyük.','The patch file is too large.');return fs.readFileSync(file);}
function metadata(root,relative){const value=bytes(root,relative);return {path:relative,size:value.length,sha256:sha(value)};}
function excluded(relative){return relative===RECEIPT||relative==='.release-pending.json'||/^(tests|dist-updates|dist-installer|\.desktop-dev|\.git)(\/|$)/.test(relative)||/^server\/data(\/|$)/.test(relative)||/^node_modules\/(\.bin|\.cache)(\/|$)/.test(relative);}
function inventory(root,{exclude=excluded}={}){
 const out=[];const visit=(folder,relative='')=>{
  for(const entry of fs.readdirSync(folder,{withFileTypes:true})){const rel=relative?relative+'/'+entry.name:entry.name;if(exclude(rel))continue;
   if(entry.isSymbolicLink())fail('PATCH_PATH_UNSAFE','Yama kaynağı bağlantı içeremez.','The patch source cannot contain links.');
   if(entry.isDirectory())visit(path.join(folder,entry.name),rel);else if(entry.isFile())out.push(metadata(root,rel));else fail('PATCH_PATH_UNSAFE','Yama kaynağı normal dosya olmalı.','The patch source must contain regular files.');
  }
 };visit(path.resolve(root));return out.sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);
}
function readBootstrap(root){
 let value;try{value=JSON.parse(bytes(root,ANCHOR));}catch(error){fail('PATCH_BOOTSTRAP_REQUIRED','Güncel imzalı tam kurulum gerekli.','A current signed full installation is required.');}
 if(value?.schemaVersion!==1||value.product!==PRODUCT||value.bootstrapVersion!==BOOTSTRAP_VERSION||!/^[a-f0-9]{40}$/.test(value.sourceCommit))fail('PATCH_BOOTSTRAP_REQUIRED','Kurulu güven kökü desteklenmiyor.','The installed trust root is unsupported.');
 return value;
}
function bootstrapHash(root){return sha(Buffer.from(JSON.stringify(BOOTSTRAP_FILES.map(relative=>{const file=metadata(root,relative);return [file.path,file.size,file.sha256];}))));}
function stampBootstrap(root,sourceCommit){
 if(!/^[a-f0-9]{40}$/.test(sourceCommit))fail('PATCH_SOURCE_INVALID','Kaynak commit kimliği gerekli.','An exact source commit is required.');
 const value={schemaVersion:1,product:PRODUCT,bootstrapVersion:BOOTSTRAP_VERSION,sourceCommit};
 for(const name of ['shared-file-transaction.js','lease-worker-registry.js']){
  const target=path.join(root,'electron','manual-patch','kernel',name);fs.mkdirSync(path.dirname(target),{recursive:true});
  fs.writeFileSync(target,bytes(root,'server/lib/'+name));
 }
 atomicWriteJson(path.join(root,...ANCHOR.split('/')),value);return value;
}
function readJsonStrict(file,maxBytes=16*1024*1024){
 const stat=fs.lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>maxBytes)fail('PATCH_MANIFEST_INVALID','Yama tanımı okunamadı.','The patch manifest could not be read.');
 try{return JSON.parse(fs.readFileSync(file,'utf8'));}catch(_){fail('PATCH_MANIFEST_INVALID','Yama tanımı geçersiz.','The patch manifest is invalid.');}
}
function integrityBytes(files,version){const list=files.filter(file=>file.path!=='electron/app-integrity.json');return Buffer.from(JSON.stringify({schemaVersion:1,version,fileCount:list.length,files:Object.fromEntries(list.map(file=>[file.path,file.sha256]))})+'\n');}
module.exports={ANCHOR,RECEIPT,BOOTSTRAP_FILES,sha,regularFile,bytes,metadata,inventory,excluded,readBootstrap,bootstrapHash,stampBootstrap,readJsonStrict,integrityBytes};
