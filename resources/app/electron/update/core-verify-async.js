'use strict';
/* Paketli çekirdek bütünlük doğrulamasını (core-verification.js →
 * verifyPackagedCore; ~2.500 dosya / ~165 MB SHA-256) işçi iş parçacığında
 * çalıştırır. Masaüstü ana süreci bu taramayı senkron yaptığında pencereler
 * (özellikle güncellemeden sonraki ilk açılışta giriş ekranı) saniyelerce
 * "yanıt vermiyor" görünüyordu.
 *
 * Güvenlik sözleşmesi launcher-core.js'teki işçi doğrulamasıyla aynıdır:
 *  - Bütünlük hatası (UPDATE_* / PATCH_* kodlu) aynı kodla reddedilir.
 *  - İşçi başlatılamaz, çöker ya da beklenmedik bir hata verirse doğrulama
 *    çağıran iş parçacığında aynen yapılır: tarama hiçbir koşulda atlanmaz. */
const path=require('path');

const CORE_VERIFICATION=path.join(__dirname,'..','manual-patch','core-verification.js');
const WORKER_SOURCE=`const {parentPort,workerData}=require('worker_threads');
try{const result=require(workerData.module).verifyPackagedCore(workerData.core,workerData.version);parentPort.postMessage({ok:true,result});}
catch(error){parentPort.postMessage({ok:false,code:String(error&&error.code||''),message:String(error&&error.message||error)});}`;
const SECURITY_CODE=/^(UPDATE|PATCH)_/;

function verifyPackagedCoreAsync(core,version,options={}){
  const module=options.module||CORE_VERIFICATION;
  const syncVerify=()=>require(module).verifyPackagedCore(core,version);
  let Worker=options.Worker||null;
  if(!Worker){try{({Worker}=require('worker_threads'));}catch(_){Worker=null;}}
  if(typeof Worker!=='function')return Promise.resolve().then(syncVerify);
  return new Promise((resolve,reject)=>{
    let settled=false,worker=null;
    const stop=()=>{try{if(worker)void worker.terminate();}catch(_){}};
    const finish=(fn,value)=>{if(settled)return;settled=true;stop();fn(value);};
    const fallback=()=>{if(settled)return;settled=true;stop();try{resolve(syncVerify());}catch(error){reject(error);}};
    try{worker=new Worker(WORKER_SOURCE,{eval:true,workerData:{module,core:String(core),version:String(version||'')}});}
    catch(_){fallback();return;}
    worker.once('message',message=>{
      if(message&&message.ok===true)finish(resolve,message.result);
      else if(message&&SECURITY_CODE.test(String(message.code||'')))finish(reject,Object.assign(new Error(String(message.message||'')),{code:message.code}));
      else fallback();
    });
    worker.once('error',fallback);
    worker.once('exit',fallback);
  });
}

module.exports={verifyPackagedCoreAsync,CORE_VERIFICATION};
