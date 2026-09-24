'use strict';

const fs=require('fs');
const path=require('path');
const os=require('os');
const crypto=require('crypto');

const LEASE_RUNTIME_KEY=Symbol.for('buyerlog.sharedFileTransaction.runtime');
const leaseRuntime=globalThis[LEASE_RUNTIME_KEY]||(globalThis[LEASE_RUNTIME_KEY]={
  instanceId:String(process.env.BUYER_LOG_INSTANCE_ID||crypto.randomUUID()),
  queues:new Map(),
  activeTokens:new Set(),
});

function getBuyerLogInstanceId(){return leaseRuntime.instanceId;}
function leaseLog(event,detail={},options={},force=false){
  const logger=typeof options.logger==='function'?options.logger:(force||process.env.BUYER_LOG_DEBUG_LEASE==='1'?console.log:null);
  if(!logger)return;
  const fields={instanceId:leaseRuntime.instanceId,pid:process.pid,...detail};
  try{logger(`[LEASE] ${event} ${Object.entries(fields).map(([key,value])=>`${key}=${String(value)}`).join(' ')}`);}catch(_){}
}
function processAlive(pid){
  const value=Number(pid);
  if(!Number.isInteger(value)||value<=0)return false;
  try{process.kill(value,0);return true;}
  catch(error){return Boolean(error&&error.code==='EPERM');}
}
function serializeLocalWrite(resource,operation){
  const key=process.platform==='win32'?String(resource).toLowerCase():String(resource);
  const previous=leaseRuntime.queues.get(key)||Promise.resolve();
  const run=previous.catch(()=>{}).then(operation);
  const tail=run.catch(()=>{});
  leaseRuntime.queues.set(key,tail);
  return run.finally(()=>{if(leaseRuntime.queues.get(key)===tail)leaseRuntime.queues.delete(key);});
}

const waitArray=new Int32Array(new SharedArrayBuffer(4));
function pause(ms){Atomics.wait(waitArray,0,0,ms);}
function withFileLeaseSync(file,operation,options={}){
  const target=path.resolve(file),lockDir=`${target}.write-lock`,timeoutMs=Math.max(100,Number(options.timeoutMs)||3000),staleMs=Math.max(5000,Number(options.staleMs)||60000),started=Date.now(),token=crypto.randomUUID();
  fs.mkdirSync(path.dirname(target),{recursive:true});
  for(;;){
    try{
      fs.mkdirSync(lockDir);
      fs.writeFileSync(path.join(lockDir,'owner.json'),JSON.stringify({token,instanceId:leaseRuntime.instanceId,machine:os.hostname(),pid:process.pid,createdAt:new Date().toISOString(),startedAt:new Date().toISOString(),expiresAt:new Date(Date.now()+staleMs).toISOString(),resource:target}));
      leaseRuntime.activeTokens.add(token);
      break;
    }catch(error){
      if(error.code!=='EEXIST')throw error;
      let stale=false;try{const stat=fs.statSync(lockDir);stale=Date.now()-stat.mtimeMs>staleMs;}catch(readError){if(readError.code==='ENOENT')continue;throw readError;}
      if(stale){try{fs.rmSync(lockDir,{recursive:true,force:true});continue;}catch(_){} }
      if(Date.now()-started>=timeoutMs)throw Object.assign(new Error('Shared data is being updated by another Buyer Log instance. Please retry.'),{code:'SHARED_WRITE_BUSY',statusCode:409});
      pause(15);
    }
  }
  try{return operation();}
  finally{
    leaseRuntime.activeTokens.delete(token);
    try{const owner=JSON.parse(fs.readFileSync(path.join(lockDir,'owner.json'),'utf8'));if(owner.token===token)fs.rmSync(lockDir,{recursive:true,force:true});}catch(_){}
  }
}

/* ===================================================================
   v7.21 — ASENKRON DOSYA KİRASI

   withFileLeaseSync iki ayrı yerde olay döngüsünü bloke ediyor: kilit
   beklerken (Atomics.wait) ve operasyonun kendisi süresince. Ölçüldü:
   50.000 satırlık bir Koleksiyon kaydı sırasında sunucu 237 ms boyunca
   hiçbir isteğe yanıt vermiyordu; kilit meşgulse buna 3 saniyeye kadar
   bekleme ekleniyordu. Yani bir kullanıcının kaydı bütün ekibi durduruyordu.

   Asenkron sürüm AYNI kilit protokolünü kullanır — aynı lockDir, aynı
   owner.json, aynı bayatlama kuralı — bu yüzden eşzamanlı sürümle aynı
   dosya üzerinde güvenle bir arada çalışır. Fark yalnız beklemenin
   setTimeout ile yapılması ve operasyonun await edilebilmesi.
   =================================================================== */
const fsp=require('fs/promises');
function sleep(ms){return new Promise(resolve=>setTimeout(resolve,ms));}
const TRANSIENT_RENAME_CODES=new Set(['EPERM','EACCES','EBUSY']);
/* options.onRetry(detail), verilirse, her bekleme ÖNCESİ çağrılır — geçici
   bir Windows kilidine (AV taraması, indeksleyici, yedekleme ajanı) gerçekten
   çarpıldığını KANITLAMAK isteyen çağıranlar için (ör. shared-revision-store).
   Var olan çağıranlar bunu geçmiyor; davranışları değişmez. */
async function replaceFileWithRetry(source,target,options={}){
  const attempts=Math.max(1,Number(options.attempts)||6),baseDelayMs=Math.max(1,Number(options.baseDelayMs)||15);
  for(let attempt=1;;attempt+=1){
    try{return await fsp.rename(source,target);}
    catch(error){
      if(!TRANSIENT_RENAME_CODES.has(error&&error.code)||attempt>=attempts)throw error;
      const delayMs=Math.min(240,baseDelayMs*(2**(attempt-1)));
      if(typeof options.onRetry==='function'){try{options.onRetry({attempt,delayMs,error});}catch(_){}}
      await sleep(delayMs);
    }
  }
}
async function withFileLeaseAsync(file,operation,options={}){
  const target=path.resolve(file);
  return serializeLocalWrite(target,async()=>{
    const lockDir=`${target}.write-lock`,timeoutMs=Math.max(100,Number(options.timeoutMs)||3000),staleMs=Math.max(5000,Number(options.staleMs)||60000),ownerGraceMs=Math.max(100,Number(options.ownerGraceMs)||1000),started=Date.now(),token=crypto.randomUUID();
    let waited=false;
    await fsp.mkdir(path.dirname(target),{recursive:true});
    leaseLog('acquire:start',{resource:target,token},options);
    for(;;){
      try{
        await fsp.mkdir(lockDir);
        const now=new Date().toISOString();
        try{await fsp.writeFile(path.join(lockDir,'owner.json'),JSON.stringify({token,instanceId:leaseRuntime.instanceId,machine:os.hostname(),pid:process.pid,createdAt:now,startedAt:now,expiresAt:new Date(Date.now()+staleMs).toISOString(),resource:target}));}
        catch(ownerError){try{await fsp.rm(lockDir,{recursive:true,force:true});}catch(_){}throw ownerError;}
        leaseRuntime.activeTokens.add(token);
        leaseLog('acquire:success',{resource:target,token,waitMs:Date.now()-started},options,waited);
        break;
      }catch(error){
        if(error.code!=='EEXIST')throw error;
        waited=true;
        let stat=null,owner=null;
        try{
          stat=await fsp.stat(lockDir);
          try{owner=JSON.parse(await fsp.readFile(path.join(lockDir,'owner.json'),'utf8'));}catch(readOwnerError){if(readOwnerError.code!=='ENOENT'&&readOwnerError.name!=='SyntaxError')throw readOwnerError;}
        }catch(readError){if(readError.code==='ENOENT')continue;throw readError;}
        const createdMs=Date.parse(owner&&(owner.createdAt||owner.startedAt)||'')||stat.mtimeMs;
        const ageMs=Math.max(0,Date.now()-createdMs);
        const sameMachine=Boolean(owner&&String(owner.machine||'').toLowerCase()===os.hostname().toLowerCase());
        const ownerDead=Boolean(owner&&sameMachine&&owner.pid&&!processAlive(owner.pid));
        const sameOwner=Boolean(owner&&owner.instanceId===leaseRuntime.instanceId&&Number(owner.pid)===process.pid);
        const orphanedSameOwner=Boolean(sameOwner&&!leaseRuntime.activeTokens.has(owner.token));
        const expired=ageMs>staleMs;
        const ownerMissingTooLong=!owner&&ageMs>ownerGraceMs;
        if(ownerDead||orphanedSameOwner||expired||ownerMissingTooLong){
          let unchanged=false;
          try{
            const current=JSON.parse(await fsp.readFile(path.join(lockDir,'owner.json'),'utf8'));
            unchanged=Boolean(owner&&current.token===owner.token);
          }catch(readOwnerError){unchanged=!owner&&readOwnerError.code==='ENOENT';}
          if(unchanged){
            try{
              await fsp.rm(lockDir,{recursive:true,force:true});
              leaseLog('stale:recovered',{resource:target,currentOwner:owner&&owner.instanceId||'unknown',ownerPid:owner&&owner.pid||'unknown',leaseAgeMs:Math.round(ageMs),reason:ownerDead?'dead-pid':orphanedSameOwner?'same-instance-orphan':expired?'expired':'missing-owner'},options,true);
              continue;
            }catch(removeError){leaseLog('stale:remove-failed',{resource:target,error:removeError.message||removeError},options,true);}
          }
        }
        leaseLog('retry',{resource:target,currentOwner:owner&&owner.instanceId||'unknown',ownerPid:owner&&owner.pid||'unknown',leaseAgeMs:Math.round(ageMs)},options);
        if(Date.now()-started>=timeoutMs){
          leaseLog('conflict',{resource:target,currentOwner:owner&&owner.instanceId||'unknown',ownerPid:owner&&owner.pid||'unknown',leaseAgeMs:Math.round(ageMs)},options,true);
          throw Object.assign(new Error('Shared data is being updated by another Buyer Log instance. Please retry.'),{code:'SHARED_WRITE_BUSY',statusCode:409,owner,resource:target});
        }
        await sleep(15);
      }
    }
    try{return await operation();}
    finally{
      leaseRuntime.activeTokens.delete(token);
      try{
        const owner=JSON.parse(await fsp.readFile(path.join(lockDir,'owner.json'),'utf8'));
        if(owner.token===token){await fsp.rm(lockDir,{recursive:true,force:true});leaseLog('release',{resource:target,token},options,waited);}
      }catch(error){if(error.code!=='ENOENT')leaseLog('release:failed',{resource:target,token,error:error.message||error},options,true);}
    }
  });
}

module.exports={withFileLeaseSync,withFileLeaseAsync,replaceFileWithRetry,getBuyerLogInstanceId};
