'use strict';
// Extra process-death boundaries; no production hook/code changes.
const fs=require('node:fs'), fsp=require('node:fs/promises');
const os=require('node:os'),path=require('node:path');
const {fork}=require('node:child_process');
const assert=require('node:assert/strict');
const {open}=require('./adapters.cjs');
const {event,projection,hash}=require('./workload.cjs');
const {backupRestore}=require('./backup.cjs');
const {child}=require('./benchmark.cjs');
const {oracle}=require('./oracle.cjs');
async function barrier(name){process.send({barrier:name});await new Promise(()=>{});}
async function probe({engine,folder,scenario,size}){
 const db=open(engine,folder);await db.ensure();
 for(let i=0;i<5;i++)await db.queuePatch(event(size+i,size,'ack'));
 if(scenario==='checkpoint'){
  if(engine==='sqlite'){
   // Real checkpoint completes, then process dies before any subsequent API.
   db.db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
   await barrier('sqlite-after-checkpoint');
  }else{
   const rename=fsp.rename;
   fsp.rename=async(...args)=>{
    const result=await rename(...args);
    if(String(args[1])===path.join(folder,'BuyerLogLocal.db'))await barrier('json-after-primary-rename');
    return result;
   };
   await db.compact();
  }
 }else{
  const copy=fsp.copyFile;
  fsp.copyFile=async(...args)=>{
   const result=await copy(...args);
   if(path.basename(path.dirname(String(args[1]))).startsWith('backup-'))await barrier('backup-partial-before-manifest');
   return result;
  };
  await backupRestore(db,engine,folder,hash(projection(await db.records())));
 }
 throw Error('Boundary was not reached');
}
function killProbe(args){return new Promise((resolve,reject)=>{
 const p=fork(__filename,[JSON.stringify(args)],{silent:true,execArgv:['--expose-gc']});
 let boundary,stdout='',stderr='';
 const timer=setTimeout(()=>{p.kill('SIGKILL');reject(Error('Boundary timeout'));},120000);
 p.stdout.on('data',b=>stdout+=b);p.stderr.on('data',b=>stderr+=b);
 p.on('message',m=>{if(m.barrier){boundary=m.barrier;p.kill('SIGKILL');}});
 p.on('error',reject);p.on('exit',(code,signal)=>{clearTimeout(timer);if(boundary&&signal==='SIGKILL')resolve({boundary,signal,stdout,stderr});else reject(Error(`${code}/${signal}: ${stderr}`));});
});}
async function main(){
 const out=process.argv[2];assert(out);
 const scratch=await fsp.mkdtemp(path.join(os.tmpdir(),'bl-sqlite952-boundaries-'));
 const result={versions:process.versions,size:10000,probes:[],validation:'incomplete'};
 const save=()=>fs.writeFileSync(out,JSON.stringify(result,null,2)+'\n');save();
 try{
  for(const engine of ['local','sqlite']){
   const seed=path.join(scratch,`seed-${engine}`);await fsp.mkdir(seed);
   await child({mode:'seed',engine,folder:seed,size:10000});
   for(const scenario of ['checkpoint','backup']){
    const folder=path.join(scratch,`${engine}-${scenario}`);await fsp.cp(seed,folder,{recursive:true});
    const before=await child({mode:'verify',engine,folder,size:10000});
    const killed=await killProbe({engine,folder,scenario,size:10000});
    const recovered=await child({mode:'verify',engine,folder,size:10000});
    assert(recovered.ackRetained.every(Boolean),'Acknowledged write lost');
    assert.equal(recovered.digest,oracle(10000,5),'Post-crash independent business oracle');
    assert.equal(recovered.counts.sequence,before.counts.sequence+5);
    if(engine==='sqlite')assert.equal(recovered.integrity,'ok');
    let incompleteBackupRejected = null;
    if(scenario==='backup'){
      const dirs=(await fsp.readdir(scratch)).filter(n=>n.startsWith('backup-'));
      assert(dirs.length>0);
      for(const d of dirs)assert.equal(fs.existsSync(path.join(scratch,d,'manifest.json')),false,'Partial backup must have no completion manifest');
      incompleteBackupRejected=true;
    }
    result.probes.push({engine,scenario,...killed,recovered,incompleteBackupRejected});save();
   }
  }
  result.validation='subset-passed';save();
 }catch(error){result.validation='failed';result.error=error.stack;save();throw error;}
 finally{await fsp.rm(scratch,{recursive:true,force:true});}
}
if(process.send)probe(JSON.parse(process.argv[2])).catch(e=>{console.error(e);process.exitCode=1;process.disconnect();});
else main().catch(e=>{console.error(e);process.exitCode=1;});
