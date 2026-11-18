'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {BOOTSTRAP_VERSION,PRODUCT,IMMUTABLE_RUNTIME,filePath,fail}=require('./signature');
const {atomicWriteJson}=require('../update/json-store');
const ANCHOR='electron/manual-patch/bootstrap.json',RECEIPT='electron/manual-patch-receipt.json';
const MAX_FILE_BYTES=128*1024*1024,SCAN_BUFFER_BYTES=512*1024;
const BOOTSTRAP_FILES=['electron/launcher.js','electron/launcher-core.js','electron/portable-paths.js','electron/update/launcher-version.json',
 'electron/manual-patch/signature.js','electron/manual-patch/files.js','electron/manual-patch/manager.js','electron/manual-patch/desktop.js','electron/manual-patch/core-verification.js',
 'electron/update/json-store.js','electron/update/launcher-state.js','electron/update/semver.js',
 'electron/update/signature.js','electron/update/release-signing-keys.json','electron/update/zip.js','electron/update/integrity.js','electron/update/trial-backend.js',
 'electron/manual-patch/kernel/shared-file-transaction.js','electron/manual-patch/kernel/lease-worker-registry.js'].sort();
const sha=buffer=>crypto.createHash('sha256').update(buffer).digest('hex');
function assertDirectory(stat){
 if(!stat.isDirectory()||stat.isSymbolicLink())fail('PATCH_PATH_UNSAFE','Kurulum yolu güvenli değil.','The installation path is unsafe.');
}
function inspectRegularFile(root,relative){
 filePath(relative);const base=path.resolve(root);let current=base;
 let stat=fs.lstatSync(base);
 assertDirectory(stat);
 const parts=relative.split('/');
 for(let i=0;i<parts.length;i++){
  current=path.join(current,parts[i]);stat=fs.lstatSync(current);
  if(stat.isSymbolicLink()||(i===parts.length-1?!stat.isFile():!stat.isDirectory()))fail('PATCH_PATH_UNSAFE','Yama dosyası normal dosya olmalı.','A patch file must be a regular file.');
 }
 return {file:current,stat};
}
function regularFile(root,relative){return inspectRegularFile(root,relative).file;}
function assertFileSize(size){
 if(size>MAX_FILE_BYTES)fail('PATCH_FILE_LIMIT','Yama dosyası çok büyük.','The patch file is too large.');
}
function bytes(root,relative){
 const {file,stat}=inspectRegularFile(root,relative);
 assertFileSize(stat.size);
 return fs.readFileSync(file);
}
function metadata(root,relative){
 const value=bytes(root,relative);
 return {path:relative,size:value.length,sha256:sha(value)};
}
function hashFile(relative,file,stat,buffer){
 assertFileSize(stat.size);
 const fd=fs.openSync(file,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW||0)|(fs.constants.O_NONBLOCK||0));
 try{
  const opened=fs.fstatSync(fd);
  if(!opened.isFile()||opened.dev!==stat.dev||opened.ino!==stat.ino)fail('PATCH_PATH_UNSAFE','Doğrulama sırasında dosya yolu değişti.','The file path changed during verification.');
  const hash=crypto.createHash('sha256');
  let size=0;
  for(let length;(length=fs.readSync(fd,buffer,0,buffer.length,null))>0;){
   size+=length;
   assertFileSize(size);
   hash.update(buffer.subarray(0,length));
  }
  return {path:relative,size,sha256:hash.digest('hex')};
 }finally{fs.closeSync(fd);}
}
/* Paket yalnız çalışma zamanı dosyalarını taşır. Her açılışta her dosya SHA-256
 * ile okunduğu için çalışırken hiç kullanılmayan dosyalar soğuk diskte açılışı
 * uzatıyordu. Paketleyici, imzalı yama üreticisi ve tarama bu listeyi paylaşır.
 * Lisans/NOTICE dosyaları korunur. scripts/ altında yalnız uygulamanın çalıştırdığı
 * taşıma betiği ve kullanıcıya verilen .cmd kurtarma araçları (ve çağırdıkları)
 * kalır; geliştirme, ölçüm ve yayın betikleri pakete girmez. */
const RUNTIME_SCRIPTS=new Set(['scripts/import-legacy-data.js','scripts/setup-release-signing.js']);
const PACKAGE_DEV_FILE=/(^|\/)(?:[^/]+\.(?:md|markdown|map|ts|mts|cts)|(?:readme|changelog|history|authors|contributors?|contributing|security)(?:\.[a-z]+)?|tsconfig[^/]*\.json|bower\.json|\.(?:eslintrc[^/]*|eslintignore|npmignore|editorconfig|nycrc[^/]*|travis\.yml|prettierrc[^/]*|gitattributes|jshintrc|airtap\.yml|taprc))$/i;
const PACKAGE_DEV_DIR=/^node_modules\/(?:@[^/]+\/)?[^/]+\/(?:.*\/)?(?:test|tests|__tests__|\.github)\//i;
function devOnly(relative){
 if(relative.startsWith('scripts/'))return !RUNTIME_SCRIPTS.has(relative)&&!/^scripts\/[^/]+\.cmd$/i.test(relative);
 if(!relative.startsWith('node_modules/'))return false;
 const name=relative.slice(relative.lastIndexOf('/')+1);
 if(/^(?:licen[cs]e|notice|copying)(?:[.-][^/]*)?$/i.test(name))return false;
 return PACKAGE_DEV_DIR.test(relative)||PACKAGE_DEV_FILE.test(name);
}
function excluded(relative){return relative===RECEIPT||relative==='.release-pending.json'||/^(tests|dist-updates|dist-installer|\.desktop-dev|\.git)(\/|$)/.test(relative)||/^server\/data(\/|$)/.test(relative)||/^node_modules\/(\.bin|\.cache)(\/|$)/.test(relative)||devOnly(relative);}
function inventory(root,{exclude=excluded}={}){
 // The same buffer serves every file in a scan, including multi-megabyte assets.
 const out=[],buffer=Buffer.allocUnsafe(SCAN_BUFFER_BYTES);
 walkRegularFiles(root,{exclude,onFile:(rel,file,stat)=>out.push(hashFile(rel,file,stat,buffer))});
 return sortByPath(out);
}
const sortByPath=list=>list.sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);
function walkRegularFiles(root,{exclude=excluded,onFile}){
 const visit=(folder,relative='')=>{
  // Check the tree as we descend, then confirm that the directory is still
  // in place. Each leaf is checked before the scan can pass.
  const opened=fs.lstatSync(folder,{bigint:true});
  assertDirectory(opened);
  for(const entry of fs.readdirSync(folder,{withFileTypes:true})){
   const rel=relative?relative+'/'+entry.name:entry.name;
   if(exclude(rel))continue;
   if(entry.isSymbolicLink())fail('PATCH_PATH_UNSAFE','Yama kaynağı bağlantı içeremez.','The patch source cannot contain links.');
   const file=path.join(folder,entry.name);
   if(entry.isDirectory()){visit(file,rel);continue;}
   filePath(rel);
   const stat=fs.lstatSync(file);
   if(!entry.isFile()||!stat.isFile()||stat.isSymbolicLink())fail('PATCH_PATH_UNSAFE','Yama kaynağı normal dosya olmalı.','The patch source must contain regular files.');
   assertFileSize(stat.size);
   onFile(rel,file,stat);
  }
  const closed=fs.lstatSync(folder,{bigint:true});
  assertDirectory(closed);
  if(closed.dev!==opened.dev||closed.ino!==opened.ino)fail('PATCH_PATH_UNSAFE','Doğrulama sırasında kurulum yolu değişti.','The installation path changed during verification.');
 };visit(path.resolve(root));
}
/* Aynı denetimler, eşzamanlı okuma: soğuk diskte ve dosya başına virüs
 * taramasında süre dosya sayısıyla ölçeklenir. Liste bu iş parçacığında
 * yürünür ve denetlenir; içerik birkaç işçi iş parçacığında, her biri
 * senkron okuyarak, ortak bir sayaçtan sıradaki dosyayı alarak özetlenir.
 * Her dosya açılan tanıtıcının dev/ino kimliği yürüyüşteki lstat ile eşleşerek,
 * boyut sınırıyla ve tam SHA-256 ile denetlenir. İşçi açılamaz ya da güvenlik
 * dışı bir nedenle düşerse tarama bu iş parçacığında baştan yapılır; asla
 * atlanmaz. Profil yalnız tanılama içindir ve yalnız göreli yollar içerir. */
const PARALLEL_MIN_FILES_PER_LANE=48;
const LANE_SOURCE=`const {parentPort,workerData}=require('worker_threads');
const F=require(workerData.module),counter=new Int32Array(workerData.counter),list=workerData.list,results=[];
const buffer=Buffer.allocUnsafe(workerData.bufferBytes);
try{
 for(let index;(index=Atomics.add(counter,0,1))<list.length;){
  const item=list[index],t0=Date.now(),hashed=F.hashFileWithIdentity(item.rel,item.file,item,buffer);
  results.push([index,hashed.size,hashed.sha256,Date.now()-t0]);
 }
 parentPort.postMessage({ok:true,results});
}catch(error){Atomics.store(counter,0,list.length);parentPort.postMessage({ok:false,code:String(error&&error.code||''),message:String(error&&error.message||error)});}`;
const SECURITY_CODE=/^(UPDATE|PATCH)_/;
function hashFileWithIdentity(relative,file,identity,buffer){
 return hashFile(relative,file,{size:Number(identity.size),dev:identity.dev,ino:identity.ino},buffer);
}
function runLanes(list,lanes,Worker){
 const counter=new SharedArrayBuffer(4);
 return new Promise((resolve,reject)=>{
  const workers=[],collected=[];let pending=lanes,settled=false;
  const stop=()=>{for(const worker of workers){try{void worker.terminate();}catch(_){}}};
  const finish=(fn,value)=>{if(settled)return;settled=true;stop();fn(value);};
  const fault=error=>finish(reject,Object.assign(error instanceof Error?error:new Error(String(error)),{laneFault:true}));
  for(let i=0;i<lanes;i++){
   let worker;
   try{worker=new Worker(LANE_SOURCE,{eval:true,workerData:{module:__filename,counter,list,bufferBytes:SCAN_BUFFER_BYTES}});}
   catch(error){fault(error);return;}
   workers.push(worker);
   worker.once('message',message=>{
    if(message&&message.ok===true){collected.push(...message.results);if(--pending===0)finish(resolve,collected);}
    else if(SECURITY_CODE.test(String(message&&message.code||'')))finish(reject,Object.assign(new Error(String(message.message||'')),{code:message.code}));
    else fault(new Error(String(message&&message.message||'lane failed')));
   });
   worker.once('error',fault);
   worker.once('exit',code=>{if(!settled&&pending>0&&code!==0)fault(new Error('lane exited '+code));});
  }
 });
}
// 'auto': mantıksal işlemci sayısına göre 4-8 okuma hattı.
function laneCount(concurrency){
 if(concurrency!=='auto')return concurrency;
 let cpus=4;try{const os=require('node:os');cpus=typeof os.availableParallelism==='function'?os.availableParallelism():os.cpus().length;}catch(_){}
 return Math.min(8,Math.max(4,cpus||4));
}
async function inventoryParallel(root,{exclude=excluded,concurrency='auto',profile=null,Worker}={}){
 concurrency=laneCount(concurrency);
 const startedAt=Date.now(),listed=[];
 walkRegularFiles(root,{exclude,onFile:(rel,file,stat)=>listed.push({rel,file,dev:stat.dev,ino:stat.ino,size:stat.size})});
 const walkMs=Date.now()-startedAt;
 let lanes=Math.max(1,Math.min(16,Math.floor(Number(concurrency))||1,Math.floor(listed.length/PARALLEL_MIN_FILES_PER_LANE)||1));
 if(lanes>1&&!Worker){try{({Worker}=require('node:worker_threads'));}catch(_){Worker=null;}}
 let rows=null;
 if(lanes>1&&typeof Worker==='function'){
  try{rows=await runLanes(listed,lanes,Worker);}
  catch(error){if(!error.laneFault)throw error;rows=null;}
 }
 if(!rows){
  // Sıralı yedek yol: aynı denetimler, aynı iş parçacığında.
  lanes=1;rows=[];const buffer=Buffer.allocUnsafe(SCAN_BUFFER_BYTES);
  listed.forEach((item,index)=>{const t0=Date.now(),hashed=hashFileWithIdentity(item.rel,item.file,item,buffer);rows.push([index,hashed.size,hashed.sha256,Date.now()-t0]);});
 }
 if(rows.length!==listed.length)fail('PATCH_PATH_UNSAFE','Doğrulama tamamlanamadı.','Verification did not complete.');
 const out=new Array(listed.length),timings=new Array(listed.length);
 for(const [index,size,sha256,ms] of rows){
  if(out[index])fail('PATCH_PATH_UNSAFE','Doğrulama tamamlanamadı.','Verification did not complete.');
  out[index]={path:listed[index].rel,size,sha256};timings[index]=ms;
 }
 if(out.some(item=>!item))fail('PATCH_PATH_UNSAFE','Doğrulama tamamlanamadı.','Verification did not complete.');
 if(profile){
  const ms=timings.slice().sort((x,y)=>x-y),pick=q=>ms.length?ms[Math.min(ms.length-1,Math.floor((ms.length-1)*q))]:0;
  Object.assign(profile,{files:listed.length,bytes:out.reduce((sum,file)=>sum+file.size,0),lanes,walkMs,hashMs:Date.now()-startedAt-walkMs,
   fileMsP50:pick(.5),fileMsP95:pick(.95),fileMsMax:pick(1),
   slowest:timings.map((value,index)=>[value,listed[index].rel]).sort((x,y)=>y[0]-x[0]).slice(0,5).map(([value,rel])=>({path:rel,ms:value}))});
 }
 return sortByPath(out);
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
module.exports={ANCHOR,RECEIPT,BOOTSTRAP_FILES,sha,regularFile,bytes,metadata,inventory,inventoryParallel,hashFileWithIdentity,excluded,readBootstrap,bootstrapHash,stampBootstrap,readJsonStrict,integrityBytes};
