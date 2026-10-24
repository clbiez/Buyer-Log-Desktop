'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const threads=require('node:worker_threads');
const KEY='buyerlog.file-lease.worker-registry.v1',SLOTS=4096;
const userKey=typeof process.getuid==='function'?String(process.getuid()):'user';
let registry=threads.getEnvironmentData(KEY);
if(threads.isMainThread&&(!registry||registry.pid!==process.pid)){
  const id=crypto.randomUUID();
  registry={pid:process.pid,id,states:new SharedArrayBuffer(SLOTS*4),file:path.join(os.tmpdir(),'BuyerLog-lease-workers-'+userKey,process.pid+'-'+id+'.json')};
  threads.setEnvironmentData(KEY,registry);
}
const states=registry&&new Int32Array(registry.states);
let persisted=false;
function validRoot(folder){
  const stat=fs.lstatSync(folder);
  return stat.isDirectory()&&!stat.isSymbolicLink()&&(typeof process.getuid!=='function'||stat.uid===process.getuid());
}
function persist(){
  const folder=path.dirname(registry.file);fs.mkdirSync(folder,{recursive:true,mode:0o700});
  if(!validRoot(folder))throw Error('Lease worker registry root is not private or is linked.');
  const temporary=registry.file+'.'+crypto.randomUUID()+'.tmp';let fd;
  try{fd=fs.openSync(temporary,'wx',0o600);fs.writeFileSync(fd,JSON.stringify({schemaVersion:1,pid:process.pid,id:registry.id,states:Array.from(states)}));try{fs.fsyncSync(fd);}catch(error){if(!['EPERM','EINVAL','ENOSYS','ENOTSUP','EOPNOTSUPP'].includes(error.code))throw error;}fs.closeSync(fd);fd=null;fs.renameSync(temporary,registry.file);persisted=true;}
  finally{if(fd!=null)fs.closeSync(fd);try{fs.unlinkSync(temporary);}catch(error){if(error.code!=='ENOENT')throw error;}}
}
if(threads.isMainThread)process.once('exit',()=>{if(persisted)try{fs.unlinkSync(registry.file);}catch(_){} });
function registerLeaseWorker(worker){
  const id=Number(worker&&worker.threadId);
  if(!Number.isInteger(id)||id<=0||!worker||typeof worker.once!=='function')return worker;
  if(!threads.isMainThread||!states)throw Error('Lease workers must be registered by the main thread.');
  let slot=-1;
  for(let i=0;i<states.length;i++){
    const prior=Atomics.load(states,i);
    if(prior<=0&&Atomics.compareExchange(states,i,prior,id+1)===prior){slot=i;break;}
  }
  if(slot<0)throw Object.assign(new Error('Lease worker registry capacity reached.'),{code:'SHARED_WORKER_REGISTRY_FULL'});
  // Exit bookkeeping precedes client callbacks and promise settlement. Shared
  // memory protects same-process readers; the bounded ledger lets a different
  // local process verify a dead thread while its parent PID remains alive.
  worker.once('exit',()=>{
    Atomics.compareExchange(states,slot,id+1,-(id+1));
    try{persist();}catch(error){console.error('[LEASE] worker-retirement-unavailable',error.code||error.message);}
  });
  try{persist();}catch(error){Atomics.compareExchange(states,slot,id+1,-(id+1));try{worker.terminate().catch(()=>{});}catch(_){}throw error;}return worker;
}
function workerIdentity(){
  if(threads.isMainThread)return {processLeaseId:registry.id,threadId:0};
  if(states){for(let i=0;i<states.length;i++)if(Atomics.load(states,i)===threads.threadId+1)return {processLeaseId:registry.id,threadId:threads.threadId,threadSlot:i,leaseWorkerRegistry:registry.file};}
  throw Object.assign(new Error('Dosya yazma iş parçacığı kayıtlı değil. / File-writing worker is not registered.'),{code:'SHARED_LEASE_WORKER_UNREGISTERED',statusCode:503});
}
function retiredThread(owner){
  if(!owner||!Number.isInteger(owner.threadId)||owner.threadId<=0||!Number.isInteger(owner.threadSlot)||owner.threadSlot<0||owner.threadSlot>=SLOTS)return false;
  const expected=owner.threadId+1;
  if(Number(owner.pid)===process.pid&&registry){
    if(owner.processLeaseId!==registry.id)return Boolean(owner.processLeaseId);
    const value=Atomics.load(states,owner.threadSlot);return value!==0&&value!==expected;
  }
  try{
    const file=String(owner.leaseWorkerRegistry||''),folder=path.dirname(file);
    if(!/^[a-f0-9-]{36}$/.test(owner.processLeaseId||'')||path.basename(file)!==owner.pid+'-'+owner.processLeaseId+'.json'||path.basename(folder)!=='BuyerLog-lease-workers-'+userKey||!validRoot(folder))return false;
    const stat=fs.lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>65536)return false;
    const saved=JSON.parse(fs.readFileSync(file,'utf8'));
    if(saved.schemaVersion!==1||saved.pid!==Number(owner.pid)||saved.id!==owner.processLeaseId||!Array.isArray(saved.states)||saved.states.length!==SLOTS)return false;
    const value=saved.states[owner.threadSlot];return Number.isInteger(value)&&value!==0&&value!==expected;
  }catch(_){return false;}
}
module.exports={registerLeaseWorker,workerIdentity,retiredThread};
