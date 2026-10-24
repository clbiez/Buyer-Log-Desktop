'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),sync=require('node:fs'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {withFileLeaseAsync,withFileLeaseSync,replaceFileWithRetry}=require('../server/lib/shared-file-transaction');
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
test('async lease initialization, retry, ownership check and release use nonblocking filesystem I/O',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'bl-lease-async-io-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const target=path.join(root,'data'),staged=path.join(root,'staged');await fs.writeFile(staged,'durable');
 const names=['mkdirSync','openSync','readFileSync','writeFileSync','fsyncSync','closeSync','renameSync','unlinkSync','rmdirSync','readdirSync','statSync','lstatSync','existsSync'];
 const previous=Object.fromEntries(names.map(name=>[name,sync[name]])),rename=fs.rename;let denied=false,timerRan=false;
 for(const name of names)sync[name]=()=>{throw Object.assign(new Error('Async file lease invoked '+name),{code:'ASYNC_USED_SYNC_IO'});};
 fs.rename=async(source,destination)=>{if(!denied&&destination===path.join(target+'.write-lock','owner.json')){denied=true;throw Object.assign(new Error('synthetic Windows sharing violation'),{code:'EPERM'});}return rename(source,destination);};
 const timer=setTimeout(()=>{timerRan=true;},5);
 try{await withFileLeaseAsync(target,async()=>{assert.equal(timerRan,true,'retry must yield to the event loop');await replaceFileWithRetry(staged,target);},{logger:()=>{}});}
 finally{clearTimeout(timer);Object.assign(sync,previous);fs.rename=rename;}
 assert.equal(denied,true);assert.equal(await fs.readFile(target,'utf8'),'durable');await assert.rejects(fs.access(target+'.write-lock'),{code:'ENOENT'});
});
test('new leases after the source callback completes ignore it while direct detached writes stay fenced', {timeout:10000},async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'bl-lease-finishing-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const parent=path.join(root,'parent'),child=path.join(root,'child'),direct=path.join(root,'direct'),staged=path.join(root,'staged'),stagedDirect=path.join(root,'staged-direct');await fs.writeFile(staged,'independent');await fs.writeFile(stagedDirect,'fenced');
 const finishing=deferred(),finish=deferred(),go=deferred();let independent,detached;
 const owner=withFileLeaseAsync(parent,lease=>{
  const complete=lease.finishOperation.bind(lease);lease.finishOperation=async()=>{const verified=complete();finishing.resolve();await finish.promise;await verified;};
  independent=go.promise.then(()=>withFileLeaseAsync(child,()=>replaceFileWithRetry(staged,child)));
  detached=go.promise.then(()=>replaceFileWithRetry(stagedDirect,direct));detached.catch(()=>{});
 });
 await finishing.promise;go.resolve();
 try{await independent;await assert.rejects(detached,{code:'SHARED_LEASE_LOST'});assert.equal(await fs.readFile(child,'utf8'),'independent');await assert.rejects(fs.access(direct),{code:'ENOENT'});}
 finally{finish.resolve();await owner;}
});
test('sync callers cannot block their own async initializer before owner metadata exists', {timeout:10000},async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'bl-lease-initializing-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const target=path.join(root,'data'),open=fs.open,entered=deferred(),resume=deferred();let held=false;
 fs.open=async(...args)=>{if(!held&&String(args[0])===path.join(target+'.write-lock','owner.json')){held=true;entered.resolve();await resume.promise;}return open(...args);};
 const owner=withFileLeaseAsync(target,()=>true);await entered.promise;const wait=Atomics.wait;Atomics.wait=()=>{throw Error('Sync initialization contention must not sleep');};
 try{assert.throws(()=>withFileLeaseSync(target,()=>assert.fail('must stay outside initializer')),{code:'SHARED_WRITE_BUSY'});}
 finally{Atomics.wait=wait;resume.resolve();fs.open=open;await owner;}
});
test('release waits for an in-flight renewal before deleting its own metadata', {timeout:10000},async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'bl-lease-renew-drain-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const target=path.join(root,'data'),rename=fs.rename,staged=deferred(),resume=deferred(),callbackDone=deferred();let publishing=0,acknowledged=false;
 fs.rename=async(source,destination)=>{if(destination===path.join(target+'.write-lock','owner.json')&&++publishing===2){staged.resolve();await resume.promise;}return rename(source,destination);};
 const owner=withFileLeaseAsync(target,async lease=>{lease.renew();await staged.promise;callbackDone.resolve();}).finally(()=>{acknowledged=true;});
 t.after(()=>{resume.resolve();fs.rename=rename;});
 await callbackDone.promise;await new Promise(setImmediate);assert.equal(acknowledged,false);resume.resolve();await owner;await assert.rejects(fs.access(target+'.write-lock'),{code:'ENOENT'});
});
