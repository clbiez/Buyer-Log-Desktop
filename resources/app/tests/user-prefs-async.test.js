'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),fsp=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'bl-prefs-async-'));process.env.BUYER_LOG_SERVER_DATA_ROOT=root;
const prefs=require('../server/lib/user-preferences'),{withFileLeaseAsync}=require('../server/lib/shared-file-transaction');
const file=id=>path.join(root,'user-preferences',prefs.safeId(id)+'.json');
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
test.after(()=>fs.rmSync(root,{recursive:true,force:true}));
test('async preference plans preserve synchronous whitelist, timestamps, tombstones and horizon generations',async()=>{
 const key=prefs.horizonKey('cp'),incoming={'lcw.todo.note':{value:'Synthetic note',updatedAt:'2026-10-24T10:00:00.000Z'},[key]:{value:'{}',updatedAt:'2026-10-24T10:00:00.000Z'},'not-allowed':{value:'ignored'}};
 const sync=prefs.merge('sync',incoming),async=await prefs.mergeAsync('async',incoming);
 assert.deepEqual(async.entries,sync.entries);assert.deepEqual(async.rejected,sync.rejected);assert.deepEqual(async._horizonRevisions,sync._horizonRevisions);
 const removed=await prefs.removeKeysAsync('async',[key]);assert.equal(removed.entries[key],undefined);assert.ok(removed.deletions[key]);assert.equal(removed._horizonRevisions[key],2);
 const stale=await prefs.mergeAsync('async',{[key]:incoming[key]});assert.equal(stale.entries[key],undefined);assert.deepEqual(stale.rejected,[{key,reason:'deleted'}]);
});
test('concurrent asynchronous preference updates preserve both independent entries',async()=>{
 await Promise.all([prefs.mergeAsync('concurrent',{'lcw.todo.a':{value:'A'}}),prefs.mergeAsync('concurrent',{'lcw.todo.b':{value:'B'}})]);
 const saved=await prefs.loadAsync('concurrent');assert.equal(saved.entries['lcw.todo.a'].value,'A');assert.equal(saved.entries['lcw.todo.b'].value,'B');
});
test('queued preference mutation rechecks authority after the lock and preserves every byte on denial',async()=>{
 await prefs.mergeAsync('revoked',{'lcw.todo.a':{value:'Original'}});const before=fs.readFileSync(file('revoked'),'utf8'),entered=deferred(),release=deferred();
 const holding=withFileLeaseAsync(file('revoked'),async()=>{entered.resolve();await release.promise;});await entered.promise;
 let allowed=true;const pending=prefs.mergeAsync('revoked',{'lcw.todo.a':{value:'Denied'}},{assertAuthority:()=>{if(!allowed)throw Object.assign(new Error('denied'),{code:'DENIED'});}});
 allowed=false;release.resolve();await holding;await assert.rejects(pending,{code:'DENIED'});assert.equal(fs.readFileSync(file('revoked'),'utf8'),before);
});
test('async preference completion waits for the real durable target fsync', {timeout:10000},async t=>{
 const target=file('flush'),stalled=deferred(),release=deferred(),open=fsp.open;let intercepted=false,completed=false;
 fsp.open=async(...args)=>{const handle=await open(...args);if(!intercepted&&String(args[0]).startsWith(target+'.')&&String(args[0]).endsWith('.tmp')){intercepted=true;const sync=handle.sync.bind(handle);handle.sync=async()=>{stalled.resolve();await release.promise;return sync();};}return handle;};
 t.after(()=>{release.resolve();fsp.open=open;});
 const pending=prefs.mergeAsync('flush',{'lcw.todo.a':{value:'After flush'}}).finally(()=>{completed=true;});
 await stalled.promise;await new Promise(setImmediate);assert.equal(completed,false);assert.equal(fs.existsSync(target),false);
 release.resolve();await pending;assert.equal((await prefs.loadAsync('flush')).entries['lcw.todo.a'].value,'After flush');
});
test('async preference backup reads are nonmutating and leased writes recover without losing existing keys',async()=>{
 await prefs.mergeAsync('recover',{'lcw.todo.a':{value:'Preserved'}});const good=fs.readFileSync(file('recover'));fs.writeFileSync(file('recover')+'.bak',good);fs.writeFileSync(file('recover'),'broken');
 assert.equal((await prefs.loadAsync('recover')).entries['lcw.todo.a'].value,'Preserved');assert.equal(fs.readFileSync(file('recover'),'utf8'),'broken');
 await prefs.mergeAsync('recover',{'lcw.todo.b':{value:'New'}});const saved=await prefs.loadAsync('recover');assert.equal(saved.entries['lcw.todo.a'].value,'Preserved');assert.equal(saved.entries['lcw.todo.b'].value,'New');
});
