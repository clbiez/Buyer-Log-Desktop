'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),fsp=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'bl-workspace-async-'));process.env.BUYER_LOG_SERVER_DATA_ROOT=root;
const prefs=require('../server/lib/user-preferences'),{withFileLeaseAsync}=require('../server/lib/shared-file-transaction');
const file=id=>path.join(root,'user-preferences',prefs.safeId(id)+'.json');
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
const key='lcw.cp.dimFilters.demo',horizon=prefs.horizonKey('cp');
test.after(()=>fs.rmSync(root,{recursive:true,force:true}));

test('async workspace copy and restore retain whitelist, replacement tombstones and horizon generations',async()=>{
 await prefs.mergeAsync('source',{[key]:{value:'source'},[horizon]:{value:'{}'}});
 await prefs.mergeAsync('target',{'lcw.cp.dimFilters.old':{value:'old'},'lcw.todo.keep':{value:'keep'}});
 const saved=await prefs.copyWorkspaceSnapshotAsync('source','target',['filters'],'REPLACE');
 assert.equal(saved.entries[key].value,'source');assert.equal(saved.entries['lcw.todo.keep'].value,'keep');assert.equal(saved.entries['lcw.cp.dimFilters.old'],undefined);assert.ok(saved.deletions['lcw.cp.dimFilters.old']);assert.equal(saved.entries[horizon],undefined);
 const restored=await prefs.restoreSnapshotAsync('target',{entries:{[horizon]:{value:'{"groups":[]}'},unknown:{value:'ignored'}},deletions:{[key]:'old'}});
 assert.equal(restored.entries[horizon].value,'{"groups":[]}');assert.equal(restored._horizonRevisions[horizon],1);assert.equal(restored.entries.unknown,undefined);assert.deepEqual(restored.rejected,[{key:'unknown',reason:'not-synced'}]);assert.ok(restored.deletions[key]);
});

test('queued async horizon writes merge different connections from the current leased snapshot',async()=>{
 await Promise.all([prefs.saveHorizonAsync('connections','cp',{groups:['A']},{connectionId:'first'}),prefs.saveHorizonAsync('connections','cp',{groups:['B']},{connectionId:'second'})]);
 const saved=await prefs.loadAsync('connections'),value=JSON.parse(saved.entries[horizon].value);
 assert.deepEqual(value.byConnection.first.groups,['A']);assert.deepEqual(value.byConnection.second.groups,['B']);assert.equal(saved._horizonRevisions[horizon],2);
 await prefs.saveAppliedHorizonAsync('connections','cp',{groups:['A']});assert.deepEqual(JSON.parse((await prefs.loadAsync('connections')).entries[prefs.appliedHorizonKey('cp')].value).groups,['A']);
});

test('async entry CAS rejects stale horizon generations without writing preferences',async()=>{
 await prefs.saveHorizonsAsync('cas',['cp','orders'],{groups:['A']});const before=await prefs.loadAsync('cas'),bytes=await fsp.readFile(file('cas'));
 await assert.rejects(prefs.applyEntryChangesAsync('cas',{[horizon]:'{}'},[],{expectedHorizonRevisions:{[horizon]:0}}),{code:'OFFICE_PREVIEW_CHANGED'});
 assert.deepEqual(await fsp.readFile(file('cas')),bytes);assert.equal(before._horizonRevisions[horizon],1);
});

const writers={
 restoreSnapshot:(id,options)=>prefs.restoreSnapshotAsync(id,{entries:{}},options),
 applyEntryChanges:(id,options)=>prefs.applyEntryChangesAsync(id,{[key]:'changed'},[],options),
 replaceWorkspaceEntries:(id,options)=>prefs.replaceWorkspaceEntriesAsync(id,{[key]:{value:'changed'}},['filters'],'REPLACE',options),
 copyWorkspaceSnapshot:(id,options)=>prefs.copyWorkspaceSnapshotAsync('source',id,['filters'],'MERGE',options),
 copyWorkspaceEntrySnapshot:(id,options)=>prefs.copyWorkspaceEntrySnapshotAsync({[key]:{value:'changed'}},id,['filters'],'MERGE',options),
 saveHorizon:(id,options)=>prefs.saveHorizonAsync(id,'cp',{}, {},options),
 saveHorizons:(id,options)=>prefs.saveHorizonsAsync(id,['cp'],{}, {},options),
 saveAppliedHorizon:(id,options)=>prefs.saveAppliedHorizonAsync(id,'cp',{}, {},options),
 resetWorkspace:(id,options)=>prefs.resetWorkspaceAsync(id,'all',['filters'],options),
 supersedePersonalHorizons:(id,options)=>prefs.supersedePersonalHorizonsAsync(id,[horizon],'2099-01-01T00:00:00.000Z',options),
};
for(const [name,write] of Object.entries(writers))test('queued '+name+' rechecks authority and preserves the target',async()=>{
 const id='denied-'+name;await prefs.mergeAsync(id,{[key]:{value:'original'},[horizon]:{value:'{}'}});const before=await fsp.readFile(file(id)),entered=deferred(),release=deferred();
 const hold=withFileLeaseAsync(file(id),async()=>{entered.resolve();await release.promise;});await entered.promise;
 let allowed=true;const pending=write(id,{assertAuthority:()=>{if(!allowed)throw Object.assign(Error('Denied'),{code:'DENIED'});}}),denied=assert.rejects(pending,{code:'DENIED'});
 allowed=false;release.resolve();await hold;await denied;assert.deepEqual(await fsp.readFile(file(id)),before);
});

test('async workspace writer family uses no synchronous filesystem calls after startup',async()=>{
 const names=['mkdirSync','openSync','readFileSync','writeFileSync','fsyncSync','closeSync','renameSync','unlinkSync','rmdirSync','readdirSync','statSync','lstatSync','existsSync'],previous=Object.fromEntries(names.map(name=>[name,fs[name]]));
 for(const name of names)fs[name]=()=>{throw Error('Async workspace called '+name);};
 try{
  await prefs.restoreSnapshotAsync('io',{entries:{[key]:{value:'initial'}}});
  await prefs.applyEntryChangesAsync('io',{[key]:'updated'});
  await prefs.replaceWorkspaceEntriesAsync('io',{[key]:{value:'replaced'}},['filters'],'REPLACE');
  await prefs.copyWorkspaceSnapshotAsync('source','io',['filters']);
  await prefs.copyWorkspaceEntrySnapshotAsync({[key]:{value:'copied'}},'io',['filters']);
  await prefs.saveHorizonAsync('io','cp',{groups:['A']});await prefs.saveHorizonsAsync('io',['orders'],{groups:['B']});await prefs.saveAppliedHorizonAsync('io','cp',{});
  await prefs.resetWorkspaceAsync('io','cp',['horizon']);await prefs.supersedePersonalHorizonsAsync('io',[prefs.horizonKey('orders')],'2099-01-01T00:00:00.000Z');
 }finally{Object.assign(fs,previous);}
 const saved=await prefs.loadAsync('io');assert.equal(saved.entries[key].value,'copied');assert.equal(saved.entries[horizon],undefined);assert.ok(saved.deletions[prefs.horizonKey('orders')]);
});
