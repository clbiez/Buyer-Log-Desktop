'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{fork}=require('node:child_process');
const metadataFs=require('node:fs/promises');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'bl-lease-integrity-'));
Object.assign(process.env,{BUYER_LOG_SERVER_DATA_ROOT:root,BUYER_LOG_LOCAL_DATA_ROOT:path.join(root,'local'),BUYER_LOG_DATA_ROOT:path.join(root,'app'),BUYER_LOG_CONFIG_PATH:path.join(root,'config.json')});
const lease=require('../server/lib/shared-file-transaction');
const {atomicWriteJsonAsync}=require('../server/user-data');
let next=0;
function target(){const file=path.join(root,'case-'+(++next)+'.json');fs.writeFileSync(file,'0');return file;}
function seed(file,extra={}){
 const lock=file+'.write-lock';fs.mkdirSync(lock);
 const owner={token:'fixture-token',instanceId:'fixture-instance',machine:os.hostname(),pid:process.pid,createdAt:new Date(Date.now()-120000).toISOString(),...extra};
 fs.writeFileSync(path.join(lock,'owner.json'),JSON.stringify(owner));const old=new Date(Date.now()-120000);fs.utimesSync(lock,old,old);return owner;
}
function worker(mode,file,count=1,timeoutMs=10000){const child=fork(path.join(__dirname,'helpers/file-lease-worker.cjs'),[mode,file,String(count),String(timeoutMs)],{stdio:['ignore','ignore','inherit','ipc']});let detail;child.on('message',value=>{detail=value});const exited=new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',code=>code===0?resolve():reject(Error('worker exit '+code+' '+JSON.stringify(detail))))});exited.catch(()=>{});return {child,exited,message:()=>new Promise((resolve,reject)=>{child.once('message',resolve);child.once('error',reject)})};}
test.after(()=>fs.rmSync(root,{recursive:true,force:true}));
for(const kind of ['Sync','Async'])test(kind+' refuses age-only takeover of a live owner',async()=>{
 const file=target();seed(file);let entered=false;
 if(kind==='Sync')assert.throws(()=>lease.withFileLeaseSync(file,()=>{entered=true},{timeoutMs:100,staleMs:5000,logger:()=>{}}),{code:'SHARED_WRITE_BUSY'});
 else await assert.rejects(lease.withFileLeaseAsync(file,()=>{entered=true},{timeoutMs:100,staleMs:5000,logger:()=>{}}),{code:'SHARED_WRITE_BUSY'});
 assert.equal(entered,false);
});
test('two real processes do not overlap after the actual five-second threshold',async()=>{
 const file=target(),held=worker('hold',file);await held.message();
 try{if(process.platform!=='win32')held.child.kill('SIGSTOP');await new Promise(resolve=>setTimeout(resolve,5200));let entered=false;await assert.rejects(lease.withFileLeaseAsync(file,()=>{entered=true},{timeoutMs:150,staleMs:5000,logger:()=>{}}),{code:'SHARED_WRITE_BUSY'});assert.equal(entered,false);}
 finally{if(process.platform!=='win32')held.child.kill('SIGCONT');held.child.send('release');await held.exited;}
});
test('unknown remote liveness is not treated as proof of owner death',async()=>{
 const file=target();seed(file,{machine:'synthetic-other-machine'});
 await assert.rejects(lease.withFileLeaseAsync(file,()=>assert.fail('unsafe remote takeover'),{timeoutMs:100,staleMs:5000,logger:()=>{}}),{code:'SHARED_WRITE_BUSY'});
});
test('dead owner recovery with concurrent sync/async reclaimers preserves every write and generation',async()=>{
 const file=target(),held=worker('hold',file);await held.message();held.child.kill('SIGKILL');await new Promise(resolve=>held.child.once('exit',resolve));
 // This is an integrity stress test, not a ten-second throughput requirement.
 // NTFS metadata flushes under full-suite load can serialize 64 writes for
 // longer than that. Keep production timeouts and the short busy tests intact.
 const workers=Array.from({length:8},(_,i)=>worker(i%2?'sync':'async',file,8,60000));
 const outputs=await Promise.all(workers.map(async w=>{const data=await w.message();await w.exited;assert.equal(data.error,undefined);return data.generations}));
 assert.equal(Number(fs.readFileSync(file,'utf8')),64);
 const generations=outputs.flat();assert.equal(new Set(generations).size,64);assert.ok(generations.every(Number.isSafeInteger));
 assert.equal(fs.existsSync(file+'.write-lock'),false);
});
test('a stale token cannot commit through the durable writer or delete its successor lock',async()=>{
 const file=target();let staleCommit=false;
 await assert.rejects(lease.withFileLeaseAsync(file,async()=>{
  const ownerFile=path.join(file+'.write-lock','owner.json'),owner=JSON.parse(fs.readFileSync(ownerFile,'utf8'));
  fs.writeFileSync(ownerFile,JSON.stringify({...owner,token:'successor-token'}));
  await atomicWriteJsonAsync(file,{stale:true});staleCommit=true;
 },{logger:()=>{}}),{code:'SHARED_LEASE_LOST'});
 assert.equal(staleCommit,false);assert.equal(fs.readFileSync(file,'utf8'),'0');
 assert.equal(JSON.parse(fs.readFileSync(path.join(file+'.write-lock','owner.json'),'utf8')).token,'successor-token');
 const separate=target();await atomicWriteJsonAsync(separate,{healthy:true});assert.deepEqual(JSON.parse(fs.readFileSync(separate,'utf8')),{healthy:true});
});
test('generations increase across sync/async acquisition and failed callbacks release their own lease',async()=>{
 const file=target(),generations=[];
 lease.withFileLeaseSync(file,l=>{generations.push(l.generation);l.assertOwned();});
 await assert.rejects(lease.withFileLeaseAsync(file,l=>{generations.push(l.generation);throw Error('synthetic failure')},{logger:()=>{}}),/synthetic failure/);
 await lease.withFileLeaseAsync(file,l=>{generations.push(l.generation);l.assertOwned();},{logger:()=>{}});
 assert.ok(generations[0]<generations[1]&&generations[1]<generations[2]);
 assert.equal(fs.existsSync(file+'.write-lock'),false);
});

test('crash during metadata publication leaves no debris that can permanently block reclamation',async()=>{
 const file=target(),processFixture=worker('kill-metadata',file),staged=await processFixture.message();
 assert.equal(path.dirname(staged.staged),path.dirname(file),'metadata staging stays outside the lease directory');
 processFixture.child.kill('SIGKILL');await new Promise(resolve=>processFixture.child.once('exit',resolve));
 let ran=false;await lease.withFileLeaseAsync(file,()=>{ran=true},{timeoutMs:300,logger:()=>{}});
 assert.equal(ran,true);assert.equal(fs.existsSync(file+'.write-lock'),false);
});

test('a transient maintenance-pin unlink failure does not strand the live process',async()=>{
 const file=target(),original=metadataFs.unlink;let injected=false;
 metadataFs.unlink=function(candidate,...args){if(!injected&&String(candidate).startsWith(file+'.write-lock')&&path.basename(candidate).startsWith('.maint-')){injected=true;throw Object.assign(Error('synthetic AV lock'),{code:'EACCES'});}return original.call(this,candidate,...args);};
 try{await lease.withFileLeaseAsync(file,()=>{}, {logger:()=>{}});}finally{metadataFs.unlink=original;}
 assert.equal(injected,true);await lease.withFileLeaseAsync(file,()=>{}, {timeoutMs:200,logger:()=>{}});assert.equal(fs.existsSync(file+'.write-lock'),false);
});
test('terminated worker-thread ownership is recovered while its parent PID remains alive, also by another process',async()=>{
 const {Worker}=require('node:worker_threads'),{registerLeaseWorker}=require('../server/lib/lease-worker-registry');
 const file=target(),moduleFile=require.resolve('../server/lib/shared-file-transaction');
 const thread=registerLeaseWorker(new Worker(`const {parentPort,workerData}=require('node:worker_threads');require(workerData.moduleFile).withFileLeaseAsync(workerData.file,async()=>{parentPort.on('message',()=>{});parentPort.postMessage('held');await new Promise(()=>{});});`,{eval:true,workerData:{file,moduleFile},env:{...process.env,BUYER_LOG_INSTANCE_ID:lease.getBuyerLogInstanceId()}}));
 await new Promise((resolve,reject)=>{thread.once('message',resolve);thread.once('error',reject);});
 const owner=JSON.parse(fs.readFileSync(path.join(file+'.write-lock','owner.json'),'utf8'));assert.equal(owner.pid,process.pid);assert.ok(owner.threadId>0);
 await assert.rejects(lease.withFileLeaseAsync(file,()=>assert.fail('live worker is not an orphan'),{timeoutMs:100,logger:()=>{}}),{code:'SHARED_WRITE_BUSY'});
 await thread.terminate();
 const contender=worker('sync',file);const result=await contender.message();await contender.exited;assert.equal(result.error,undefined);assert.equal(fs.readFileSync(file,'utf8'),'1');
});

test('abandoned initialization marker after persistent unlink failure is recoverable once access returns',async()=>{
 const file=target(),original=metadataFs.unlink;let deny=true;
 metadataFs.unlink=function(candidate,...args){if(deny&&String(candidate).startsWith(file+'.write-lock')&&path.basename(candidate).startsWith('.init-')&&!String(candidate).endsWith('.released'))throw Object.assign(Error('synthetic AV denial'),{code:'EACCES'});return original.call(this,candidate,...args);};
 try{await assert.rejects(lease.withFileLeaseAsync(file,()=>assert.fail('initialization did not finish'),{logger:()=>{}}),{code:'EACCES'});}
 finally{deny=false;metadataFs.unlink=original;}
 await lease.withFileLeaseAsync(file,()=>{}, {timeoutMs:500,ownerGraceMs:100,logger:()=>{}});assert.equal(fs.existsSync(file+'.write-lock'),false);
});
test('a live sibling worker initialization pin stays protected and is reclaimed after thread exit',async()=>{
 const {Worker}=require('node:worker_threads'),{registerLeaseWorker}=require('../server/lib/lease-worker-registry');
 const file=target(),moduleFile=require.resolve('../server/lib/shared-file-transaction');
 const thread=registerLeaseWorker(new Worker(`const fs=require('node:fs/promises'),path=require('node:path'),{parentPort,workerData}=require('node:worker_threads');const rename=fs.rename;fs.rename=(source,destination)=>{if(destination===path.join(workerData.file+'.write-lock','owner.json')){parentPort.postMessage('initializing');Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,60000);}return rename(source,destination);};require(workerData.moduleFile).withFileLeaseAsync(workerData.file,()=>{});`,{eval:true,workerData:{file,moduleFile}}));
 await new Promise((resolve,reject)=>{thread.once('message',resolve);thread.once('error',reject);});
 try{
  const initialPins=fs.readdirSync(file+'.write-lock').filter(name=>name.startsWith('.init-'));assert.equal(initialPins.length,1);
  const old=new Date(Date.now()-120000);fs.utimesSync(file+'.write-lock',old,old);
  await assert.rejects(lease.withFileLeaseAsync(file,()=>assert.fail('sibling initialization is active'),{timeoutMs:100,ownerGraceMs:100,logger:()=>{}}),{code:'SHARED_WRITE_BUSY'});
  assert.ok(fs.existsSync(path.join(file+'.write-lock',initialPins[0])),'sibling thread pin must not be treated as a same-thread orphan');
 }finally{await thread.terminate();}
 const contender=worker('sync',file);const result=await contender.message();await contender.exited;assert.equal(result.error,undefined);assert.equal(fs.readFileSync(file,'utf8'),'1');
});
test('fenced native database mutators cannot expose uncommitted cached state',async()=>{
 const {createLocalDb}=require('../server/lib/local-db');const file=path.join(root,'native-fenced.db'),db=createLocalDb(file);await db.ensure();
 await assert.rejects(db.transaction(async state=>{state.migrations={stale:true};const ownerFile=path.join(file+'.write-lock','owner.json'),owner=JSON.parse(fs.readFileSync(ownerFile,'utf8'));fs.writeFileSync(ownerFile,JSON.stringify({...owner,token:'synthetic-successor'}));}),{code:'SHARED_LEASE_LOST'});
 assert.equal((await db.read()).migrations?.stale,undefined,'failed mutator reloads durable state rather than returning its dirty cache');
});

for(const code of ['EPERM','EACCES','EBUSY'])test('transient retirement-marker '+code+' is retried without losing the fenced write',async()=>{
 const file=target();seed(file,{pid:2147483647});const original=metadataFs.access;let denied=false,entered=0;
 metadataFs.access=async function(candidate,...args){if(!denied&&String(candidate).startsWith(file+'.write-lock')&&path.basename(candidate).startsWith('.retired-owner-')){denied=true;throw Object.assign(Error('synthetic transient Windows metadata denial'),{code});}return original.call(this,candidate,...args);};
 try{await lease.withFileLeaseAsync(file,async token=>{entered++;await token.assertOwnedAsync();await metadataFs.writeFile(file,'1');},{timeoutMs:1000,logger:()=>{}});}finally{metadataFs.access=original;}
 assert.equal(denied,true);assert.equal(entered,1);assert.equal(fs.readFileSync(file,'utf8'),'1');assert.equal(fs.existsSync(file+'.write-lock'),false);
});
test('transient retirement-marker denial does not authorize takeover of a live owner',async()=>{
 const file=target();seed(file);const ownerFile=path.join(file+'.write-lock','owner.json'),before=fs.readFileSync(ownerFile,'utf8'),original=metadataFs.access;let denied=false,entered=false;
 metadataFs.access=async function(candidate,...args){if(!denied&&String(candidate).startsWith(file+'.write-lock')&&path.basename(candidate).startsWith('.retired-owner-')){denied=true;throw Object.assign(Error('synthetic transient metadata denial'),{code:'EPERM'});}return original.call(this,candidate,...args);};
 try{await assert.rejects(lease.withFileLeaseAsync(file,()=>{entered=true},{timeoutMs:100,logger:()=>{}}),{code:'SHARED_WRITE_BUSY'});}finally{metadataFs.access=original;}
 assert.equal(denied,true);assert.equal(entered,false);assert.equal(fs.readFileSync(ownerFile,'utf8'),before);assert.equal(fs.readFileSync(file,'utf8'),'0');
});
test('persistent retirement-marker denial fails closed with the original owner and data',async()=>{
 const file=target();seed(file,{pid:2147483647});const ownerFile=path.join(file+'.write-lock','owner.json'),before=fs.readFileSync(ownerFile,'utf8'),original=metadataFs.access;let denied=0,entered=false;
 metadataFs.access=async function(candidate,...args){if(String(candidate).startsWith(file+'.write-lock')&&path.basename(candidate).startsWith('.retired-owner-')){denied++;throw Object.assign(Error('synthetic persistent metadata denial'),{code:'EPERM'});}return original.call(this,candidate,...args);};
 try{await assert.rejects(lease.withFileLeaseAsync(file,()=>{entered=true},{timeoutMs:1000,logger:()=>{}}),{code:'EPERM'});}finally{metadataFs.access=original;}
 assert.ok(denied>1,'transient classification must permit a bounded recheck before failing');assert.equal(entered,false);assert.equal(fs.readFileSync(ownerFile,'utf8'),before);assert.equal(fs.readFileSync(file,'utf8'),'0');assert.equal(fs.existsSync(file+'.write-fence.json'),false);
});
test('unclassified retirement-marker I/O failure cannot authorize takeover',async()=>{
 const file=target();seed(file,{pid:2147483647});const ownerFile=path.join(file+'.write-lock','owner.json'),before=fs.readFileSync(ownerFile,'utf8'),original=metadataFs.access;let entered=false;
 metadataFs.access=async function(candidate,...args){if(String(candidate).startsWith(file+'.write-lock')&&path.basename(candidate).startsWith('.retired-owner-'))throw Object.assign(Error('synthetic metadata I/O error'),{code:'EIO'});return original.call(this,candidate,...args);};
 try{await assert.rejects(lease.withFileLeaseAsync(file,()=>{entered=true},{timeoutMs:1000,logger:()=>{}}),{code:'EIO'});}finally{metadataFs.access=original;}
 assert.equal(entered,false);assert.equal(fs.readFileSync(ownerFile,'utf8'),before);assert.equal(fs.readFileSync(file,'utf8'),'0');
});

// Windows TEST regression 7.0.318: a concurrent reclaimer's rmdir got a transient
// EPERM while the other still held a directory handle, failing the fenced write.
for(const code of ['EPERM','EACCES','EBUSY'])test('transient lock-directory rmdir '+code+' is retried and the write completes (sync and async)',async()=>{
 for(const kind of ['Sync','Async']){
  const file=target(),originalSync=fs.rmdirSync,originalAsync=metadataFs.rmdir;let denied=0;
  const deny=candidate=>String(candidate)===file+'.write-lock'&&denied<2&&++denied;
  fs.rmdirSync=function(candidate,...args){if(deny(candidate))throw Object.assign(Error('synthetic transient rmdir denial'),{code});return originalSync.call(this,candidate,...args);};
  metadataFs.rmdir=async function(candidate,...args){if(deny(candidate))throw Object.assign(Error('synthetic transient rmdir denial'),{code});return originalAsync.call(this,candidate,...args);};
  try{
   if(kind==='Sync')lease.withFileLeaseSync(file,()=>fs.writeFileSync(file,'1'),{timeoutMs:1000,logger:()=>{}});
   else await lease.withFileLeaseAsync(file,async()=>{await metadataFs.writeFile(file,'1');},{timeoutMs:1000,logger:()=>{}});
  }finally{fs.rmdirSync=originalSync;metadataFs.rmdir=originalAsync;}
  assert.equal(denied,2,kind);assert.equal(fs.readFileSync(file,'utf8'),'1');assert.equal(fs.existsSync(file+'.write-lock'),false,kind+' lock directory removed after retry');
 }
});
test('a persistent lock-directory rmdir denial still fails closed',()=>{
 const file=target(),original=fs.rmdirSync;let denied=0;
 fs.rmdirSync=function(candidate,...args){if(String(candidate)===file+'.write-lock'){denied++;throw Object.assign(Error('synthetic persistent rmdir denial'),{code:'EPERM'});}return original.call(this,candidate,...args);};
 try{assert.throws(()=>lease.withFileLeaseSync(file,()=>fs.writeFileSync(file,'1'),{timeoutMs:1000,logger:()=>{}}),{code:'EPERM'});}finally{fs.rmdirSync=original;}
 assert.ok(denied>1,'bounded retry before failing');
});
