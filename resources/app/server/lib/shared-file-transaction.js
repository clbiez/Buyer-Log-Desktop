'use strict';

const fs=require('fs');
const path=require('path');
const os=require('os');
const crypto=require('crypto');
const {AsyncLocalStorage}=require('node:async_hooks');
const {threadId}=require('node:worker_threads');
const {workerIdentity,retiredThread}=require('./lease-worker-registry');

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
leaseRuntime.context ||= new AsyncLocalStorage();
leaseRuntime.completedScopes ||= new WeakSet();
leaseRuntime.activePins ||= new Set();
const machine=String(os.hostname()).toLowerCase();
const machineKey=crypto.createHash('sha256').update(machine).digest('hex').slice(0,16);
const pinPattern=/^\.(init|maint)-([a-f0-9]{16})-(\d+)-(\d+)-(\d+)-([a-f0-9-]{36})-([a-f0-9-]{36})$/;
function lost(resource){return Object.assign(new Error('Dosya yazma sahipliği değişti; kayıt durduruldu. / File lease ownership changed; the write was stopped.'),{code:'SHARED_LEASE_LOST',statusCode:409,resource});}
function readOwner(lockDir){
  let raw=null;
  for(let attempt=0;;attempt++)try{raw=fs.readFileSync(path.join(lockDir,'owner.json'),'utf8');break;}catch(error){if(error.code==='ENOENT')break;if(!['EACCES','EPERM','EBUSY'].includes(error.code)||attempt>=5)throw error;pause(Math.min(120,15*(2**attempt)));}
  let owner=null;try{owner=JSON.parse(raw);}catch(_){}
  if(!owner||typeof owner!=='object'||Array.isArray(owner)||!(/^[A-Za-z0-9-]{1,160}$/.test(owner.token||''))||!owner.machine||!Number.isInteger(Number(owner.pid))||Number(owner.pid)<=0)owner=null;
  return {raw,owner};
}
function pin(lockDir,kind){
  const identity=workerIdentity();
  const file=path.join(lockDir,`.${kind}-${machineKey}-${process.pid}-${identity.threadId}-${identity.threadSlot||0}-${identity.processLeaseId}-${crypto.randomUUID()}`);
  const fd=fs.openSync(file,'wx');
  try{fs.writeFileSync(fd,JSON.stringify(identity));}finally{fs.closeSync(fd);}
  leaseRuntime.activePins.add(file);return file;
}
function unlinkWithRetry(file){
  for(let attempt=0;;attempt++)try{fs.unlinkSync(file);return;}catch(error){if(error.code==='ENOENT')return;if(!['EACCES','EPERM','EBUSY'].includes(error.code)||attempt>=3)throw error;pause(15*(attempt+1));}
}
function unpin(file){
  leaseRuntime.activePins.delete(file);
  try{unlinkWithRetry(file);}
  catch(error){
    // A persistent unlink denial must not make this completed marker look live
    // forever to another process once access recovers. Names are unique, so a
    // retirement marker can never authorize deletion of a later owner's pin.
    try{fs.closeSync(fs.openSync(file+'.released','wx'));}catch(markError){if(markError.code!=='EEXIST')leaseLog('pin-retirement-failed',{error:markError.code}, {}, true);}
    throw error;
  }
}
function removeEmpty(lockDir){try{fs.rmdirSync(lockDir);return true;}catch(error){if(['ENOENT','ENOTEMPTY','EEXIST'].includes(error.code))return error.code==='ENOENT';throw error;}}
function pinsProtectInitialization(lockDir){
  let protect=false;
  for(const name of fs.readdirSync(lockDir)){
    const base=name.endsWith('.released')?name.slice(0,-9):name;
    const match=pinPattern.exec(base);if(!match)continue;
    const file=path.join(lockDir,base),local=match[2]===machineKey,alive=local&&processAlive(match[3]);
    let identity={pid:Number(match[3]),threadId:Number(match[4]),threadSlot:Number(match[5]),processLeaseId:match[6]};
    try{const saved=JSON.parse(fs.readFileSync(file,'utf8'));identity.leaseWorkerRegistry=saved.leaseWorkerRegistry;}catch(error){if(!['ENOENT'].includes(error.code)&&!(error instanceof SyntaxError))throw error;}
    const retired=fs.existsSync(file+'.released')||(local&&Number(match[3])===process.pid&&Number(match[4])===threadId&&!leaseRuntime.activePins.has(file))||(local&&retiredThread(identity));
    if(retired||(local&&!alive)){unlinkWithRetry(file);unlinkWithRetry(file+'.released');}
    else if(match[1]==='init')protect=true;
  }
  return protect;
}
function inspect(lockDir,options){
  const stat=fs.statSync(lockDir),snapshot=readOwner(lockDir),owner=snapshot.owner;
  const ageMs=Math.max(0,Date.now()-(Date.parse(owner&&(owner.createdAt||owner.startedAt)||'')||stat.mtimeMs));
  const local=owner&&String(owner.machine).toLowerCase()===machine;
  const orphan=owner&&local&&Number(owner.pid)===process.pid&&owner.threadId===threadId&&owner.instanceId===leaseRuntime.instanceId&&!leaseRuntime.activeTokens.has(owner.token);
  const retired=owner&&fs.existsSync(path.join(lockDir,'.retired-owner-'+owner.token));
  const recoverable=owner?Boolean(retired||local&&(!processAlive(owner.pid)||orphan||retiredThread(owner))):ageMs>options.ownerGraceMs;
  return {...snapshot,ageMs,recoverable,reason:owner?(retired?'released-owner':orphan?'same-instance-orphan':retiredThread(owner)?'retired-worker':'dead-pid'):'missing-owner'};
}
function recover(lockDir,observed,options,target){
  let marker;
  try{
    marker=pin(lockDir,'maint');
    // The marker pins this exact nonempty directory. Every upgraded releaser
    // and reclaimer uses rmdir, never recursive rm, so it cannot disappear and
    // be replaced beneath this ownership comparison.
    const current=readOwner(lockDir);
    if(current.raw!==observed.raw||pinsProtectInitialization(lockDir))return false;
    if(current.raw!=null)unlinkWithRetry(path.join(lockDir,'owner.json'));
    for(const name of fs.readdirSync(lockDir))if(/^\.retired-owner-[A-Za-z0-9-]{1,160}$/.test(name))unlinkWithRetry(path.join(lockDir,name));
    leaseLog('stale:recovered',{resource:target,currentOwner:observed.owner?.instanceId||'unknown',leaseAgeMs:Math.round(observed.ageMs),reason:observed.reason},options,true);
    return true;
  }catch(error){if(error.code==='ENOENT')return false;throw error;}
  finally{if(marker){unpin(marker);removeEmpty(lockDir);}}
}
const optionalSyncCodes=new Set(['EPERM','EINVAL','ENOSYS','ENOTSUP','EOPNOTSUPP']);
function syncMetadata(fd){try{fs.fsyncSync(fd);}catch(error){if(!optionalSyncCodes.has(error.code))throw error;}}
function writeMetadata(file,value){
  const folder=path.basename(file)==='owner.json'?path.dirname(path.dirname(file)):path.dirname(file);
  const temporary=path.join(folder,'.buyerlog-lease-metadata-'+process.pid+'-'+crypto.randomUUID()+'.tmp');let fd;
  try{fd=fs.openSync(temporary,'wx');fs.writeFileSync(fd,JSON.stringify(value));syncMetadata(fd);fs.closeSync(fd);fd=null;
    for(let attempt=0;;attempt++)try{fs.renameSync(temporary,file);break;}catch(error){if(!['EACCES','EPERM','EBUSY'].includes(error.code)||attempt>=5)throw error;pause(Math.min(120,15*(2**attempt)));}
    let directory;try{directory=fs.openSync(path.dirname(file),'r');syncMetadata(directory);}catch(error){if(!optionalSyncCodes.has(error.code)&&!['EISDIR','EBADF'].includes(error.code))throw error;}finally{if(directory!=null)fs.closeSync(directory);}
  }
  finally{if(fd!=null)fs.closeSync(fd);try{fs.unlinkSync(temporary);}catch(error){if(error.code!=='ENOENT')throw error;}}
}
function nextGeneration(target){
  const file=target+'.write-fence.json';let previous=0;
  try{const raw=JSON.parse(fs.readFileSync(file,'utf8'));previous=raw.generation;if(raw.schemaVersion!==1||!Number.isSafeInteger(previous)||previous<0||previous>=Number.MAX_SAFE_INTEGER)throw Error('invalid generation');}
  catch(error){if(error.code!=='ENOENT')throw Object.assign(new Error('Dosya kilidi kuşağı okunamadı; mevcut veri korundu. / File lease generation is unreadable; existing data was preserved.'),{code:'SHARED_LEASE_GENERATION_INVALID',statusCode:503,cause:error});}
  writeMetadata(file,{schemaVersion:1,generation:previous+1});return previous+1;
}
function leaseOptions(options){return {...options,timeoutMs:Math.max(100,Number(options.timeoutMs)||3000),staleMs:Math.max(5000,Number(options.staleMs)||60000),ownerGraceMs:Math.max(100,Number(options.ownerGraceMs)||1000)};}
function acquire(target,options){
  const lockDir=target+'.write-lock';
  try{fs.mkdirSync(lockDir);}catch(error){if(error.code==='EEXIST')return null;throw error;}
  const token=crypto.randomUUID();let initialization,claimed=false,fd,owner;
  try{
    initialization=pin(lockDir,'init');
    // Exclusive owner creation is also the final initialization claim: an old
    // initializer resuming after an empty-directory recovery cannot overwrite
    // the successor's metadata, even if its earlier mkdir had succeeded.
    for(let attempt=0;;attempt++)try{fd=fs.openSync(path.join(lockDir,'owner.json'),'wx');break;}catch(error){if(!['EACCES','EPERM','EBUSY'].includes(error.code)||attempt>=5)throw error;pause(Math.min(120,15*(2**attempt)));}
    claimed=true;
    const now=new Date().toISOString();
    owner={protocolVersion:2,...workerIdentity(),token,instanceId:leaseRuntime.instanceId,machine:os.hostname(),pid:process.pid,createdAt:now,startedAt:now,expiresAt:new Date(Date.now()+options.staleMs).toISOString(),resource:target};
    leaseRuntime.activeTokens.add(token);
    fs.writeFileSync(fd,JSON.stringify(owner));syncMetadata(fd);fs.closeSync(fd);fd=null;
    owner.generation=nextGeneration(target);writeMetadata(path.join(lockDir,'owner.json'),owner);
    const lease={token,generation:owner.generation,resource:target,assertOwned(){
      let current;try{current=readOwner(lockDir).owner;}catch(_){throw lost(target);}
      if(!leaseRuntime.activeTokens.has(token)||current?.token!==token||current?.generation!==lease.generation)throw lost(target);
    },renew(){
      lease.assertOwned();const marker=pin(lockDir,'maint');
      try{lease.assertOwned();owner={...owner,renewedAt:new Date().toISOString(),expiresAt:new Date(Date.now()+options.staleMs).toISOString()};writeMetadata(path.join(lockDir,'owner.json'),owner);}
      finally{unpin(marker);removeEmpty(lockDir);}
    }};
    return lease;
  }catch(error){
    if(fd!=null){fs.closeSync(fd);fd=null;}
    if(claimed){const current=readOwner(lockDir);if(!current.owner||current.owner.token===token)try{fs.unlinkSync(path.join(lockDir,'owner.json'));}catch(cleanError){if(cleanError.code!=='ENOENT')throw cleanError;}}
    leaseRuntime.activeTokens.delete(token);
    if(error.code==='EEXIST'||error.code==='ENOENT')return null;
    throw error;
  }finally{
    try{if(initialization)unpin(initialization);}
    catch(error){if(claimed)release({token,resource:target},options);leaseRuntime.activeTokens.delete(token);throw error;}
    finally{removeEmpty(lockDir);}
  }
}
function release(lease,options){
  leaseRuntime.completedScopes.add(lease);
  const lockDir=lease.resource+'.write-lock';let marker;
  try{marker=pin(lockDir,'maint');if(readOwner(lockDir).owner?.token===lease.token)unlinkWithRetry(path.join(lockDir,'owner.json'));}
  catch(error){if(error.code!=='ENOENT'){
    leaseLog('release:failed',{resource:lease.resource,error:error.message},options,true);
    try{if(readOwner(lockDir).owner?.token===lease.token)fs.closeSync(fs.openSync(path.join(lockDir,'.retired-owner-'+lease.token),'wx'));}catch(markError){if(!['ENOENT','EEXIST'].includes(markError.code))leaseLog('release:retirement-failed',{resource:lease.resource,error:markError.code},options,true);}
  }}
  finally{
    try{if(marker)unpin(marker);removeEmpty(lockDir);}
    catch(error){leaseLog('release:cleanup-failed',{resource:lease.resource,error:error.code||error.message},options,true);}
    finally{leaseRuntime.activeTokens.delete(lease.token);}
  }
}
function assertHeldFileLeases(){for(const lease of leaseRuntime.context.getStore()||[])lease.assertOwned();}
// Deferred mirrors acquire their own lease after the source callback finishes.
// AsyncLocalStorage still carries that completed callback's old context. Drop
// only completed scopes on entry to a NEW lease; keep active parents fenced,
// and keep direct detached writes (without a new lease) fenced as before.
function inheritedFileLeases(){return (leaseRuntime.context.getStore()||[]).filter(lease=>!leaseRuntime.completedScopes.has(lease));}
function contention(target,options,started){
  const lockDir=target+'.write-lock';let observed;
  try{observed=inspect(lockDir,options);if(observed.recoverable&&recover(lockDir,observed,options,target))return;}
  catch(error){if(error.code==='ENOENT')return;throw error;}
  if(Date.now()-started>=options.timeoutMs){
    const remote=observed.owner&&String(observed.owner.machine).toLowerCase()!==machine;
    throw Object.assign(new Error(remote?'Başka cihazdaki yazıcının kapandığı doğrulanmadan kilit devralınamaz. / Verify that the writer on the other device has stopped before recovering its lease.':'Veri başka bir Buyer Log sürecinde kullanılıyor; yeniden deneyin. / Shared data is in use by another Buyer Log process; please retry.'),{code:'SHARED_WRITE_BUSY',statusCode:409,owner:observed.owner,resource:target,recoveryRequired:Boolean(remote)});
  }
}
function withFileLeaseSync(file,operation,settings={}){
  const target=path.resolve(file),options=leaseOptions(settings),started=Date.now();fs.mkdirSync(path.dirname(target),{recursive:true});let lease;
  while(!(lease=acquire(target,options))){contention(target,options,started);pause(15);}
  try{return leaseRuntime.context.run([...inheritedFileLeases(),lease],()=>{lease.assertOwned();const result=operation(lease);if(result&&typeof result.then==='function')throw Object.assign(new Error('Synchronous file lease callback must not return a Promise.'),{code:'SHARED_SYNC_LEASE_ASYNC'});lease.assertOwned();return result;});}
  finally{release(lease,options);}
}

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
    try{assertHeldFileLeases();return await fsp.rename(source,target);}
    catch(error){
      if(!TRANSIENT_RENAME_CODES.has(error&&error.code)||attempt>=attempts)throw error;
      const delayMs=Math.min(240,baseDelayMs*(2**(attempt-1)));
      if(typeof options.onRetry==='function'){try{options.onRetry({attempt,delayMs,error});}catch(_){}}
      await sleep(delayMs);
    }
  }
}
async function withFileLeaseAsync(file,operation,settings={}){
  const target=path.resolve(file),options=leaseOptions(settings);
  return serializeLocalWrite(target,async()=>{
    const started=Date.now();fs.mkdirSync(path.dirname(target),{recursive:true});let lease;
    while(!(lease=acquire(target,options))){contention(target,options,started);await sleep(15);}
    const timer=setInterval(()=>{try{lease.renew();}catch(error){leaseLog('renew:failed',{resource:target,error:error.code||error.message},options,true);}},Math.max(1000,Math.floor(options.staleMs/3)));timer.unref();
    try{return await leaseRuntime.context.run([...inheritedFileLeases(),lease],async()=>{lease.assertOwned();const result=await operation(lease);lease.assertOwned();return result;});}
    finally{clearInterval(timer);release(lease,options);}
  });
}

module.exports={withFileLeaseSync,withFileLeaseAsync,replaceFileWithRetry,getBuyerLogInstanceId,assertHeldFileLeases};
