'use strict';
// PREPARED, UNRUN. Native local DB/lease/replay + real small synthetic files.
const nativeTest=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto'),{spawnSync}=require('node:child_process');
const {createLocalDb}=require('./helpers/native-verifier-subject.cjs');
const test=(name,body)=>nativeTest(name,{timeout:10000,concurrency:false},body);
const key='native-test:receipt',record=id=>({doc:{kind:'native-test',transactionId:id,value:{zero:0,no:false,empty:'',nil:null}}});
const frame=(op,payload)=>{const entry={v:1,op,payload};entry.sha256=crypto.createHash('sha256').update(JSON.stringify(entry)).digest('hex');return JSON.stringify(entry)+'\n';};
async function fixture(t){const directory=await fs.mkdtemp(path.join(os.tmpdir(),'bl-native-proof-')),file=path.join(directory,'BuyerLogLocal.db'),db=createLocalDb(file,{walMaxBytes:64*1024*1024});t.after(()=>fs.rm(directory,{recursive:true,force:true}));await db.privateRecordTransaction(()=>({records:{[key]:record('one')},result:'committed'}));return {db,file,directory};}
async function bytes(file){const result={};for(const suffix of ['', '.wal','.wal.bak'])try{result[suffix]=(await fs.readFile(file+suffix)).toString('base64');}catch(error){if(error.code!=='ENOENT')throw error;result[suffix]=null;}return result;}
async function readOnly(db,action=state=>db.verifyPrivateRecordDurability(state)){
 const stop=new Error('read-only prepare sentinel');let result;
 try{await db.privateRecordTransaction(async state=>{result=await action(state);throw stop;});}catch(error){if(error!==stop)throw error;}
 return result;
}
async function interceptOpen(action,decorate){const original=fs.open;fs.open=async function(target,...args){const handle=await original.call(this,target,...args);decorate(handle,String(target));return handle;};try{return await action();}finally{fs.open=original;}}
function failSync(target,code='EIO'){return (handle,file)=>{if(file===target)handle.sync=async()=>{throw Object.assign(Error('injected sync failure'),{code});};};}
test('verified duplicate appends no frame, creates no revision/event and preserves exact native member bytes',async t=>{
 const f=await fixture(t),before=await bytes(f.file),state=await f.db.read(),revision=state.revision,sequence=state.localSequence,journal=state.journal.length;
 const proof=await readOnly(f.db);assert.deepEqual(proof,{verified:true,nativeRevision:revision});assert.deepEqual(await bytes(f.file),before);
 const after=await f.db.read();assert.equal(after.revision,revision);assert.equal(after.localSequence,sequence);assert.equal(after.journal.length,journal);
});
test('db.read and a raw state reference are not a verification scope',async t=>{
 const f=await fixture(t),state=await f.db.read();await assert.rejects(f.db.verifyPrivateRecordDurability(state),e=>e.code==='PRIVATE_DURABILITY_SCOPE_REQUIRED');
});
test('copied/foreign state and another DB instance fail even inside a genuine native prepare',async t=>{
 const f=await fixture(t),other=createLocalDb(path.join(f.directory,'Other.db'));
 await assert.rejects(readOnly(f.db,state=>f.db.verifyPrivateRecordDurability({...state})),e=>e.code==='PRIVATE_DURABILITY_SCOPE_REQUIRED');
 await assert.rejects(readOnly(f.db,state=>other.verifyPrivateRecordDurability(state)),e=>e.code==='PRIVATE_DURABILITY_SCOPE_REQUIRED');
});
test('escaped prepare callback cannot reuse a completed lease context',async t=>{
 const f=await fixture(t);let later;await readOnly(f.db,state=>{later=()=>f.db.verifyPrivateRecordDurability(state);return null;});
 await assert.rejects(later(),e=>e.code==='PRIVATE_DURABILITY_SCOPE_REQUIRED');
});
test('prepare mutation without a revision bump cannot manufacture a durable state',async t=>{
 const f=await fixture(t),before=await bytes(f.file);await assert.rejects(readOnly(f.db,state=>{state.records[key].doc.value.zero=99;return f.db.verifyPrivateRecordDurability(state);}),e=>e.code==='PRIVATE_DURABILITY_STATE_CHANGED');assert.deepEqual(await bytes(f.file),before);
});
test('prepare revision mutation cannot manufacture a matching receipt',async t=>{
 const f=await fixture(t);await assert.rejects(readOnly(f.db,state=>{state.revision++;return f.db.verifyPrivateRecordDurability(state);}),e=>e.code==='PRIVATE_DURABILITY_STATE_CHANGED');
});
test('native file generation replacement after prepare begins fails before proof',async t=>{
 const f=await fixture(t);await assert.rejects(readOnly(f.db,async state=>{await fs.appendFile(f.file+'.wal','\n');return f.db.verifyPrivateRecordDurability(state);}),e=>e.code==='PRIVATE_DURABILITY_STATE_CHANGED');
});
test('fsync EIO after native append leaves an unknown result; db.read alone cannot resolve it',async t=>{
 const f=await fixture(t);
 await assert.rejects(interceptOpen(()=>f.db.privateRecordTransaction(()=>({records:{[key]:record('lost-ack')}})),failSync(f.file+'.wal')),e=>e.code==='EIO');
 assert.equal((await f.db.read()).records[key].doc.transactionId,'lost-ack');const before=await bytes(f.file);
 await assert.rejects(readOnly(f.db,state=>interceptOpen(()=>f.db.verifyPrivateRecordDurability(state),failSync(f.file))),e=>e.code==='EIO');
 const proof=await readOnly(f.db);assert.equal(proof.verified,true);assert.equal(proof.nativeRevision,(await f.db.read()).revision);assert.deepEqual(await bytes(f.file),before);
});
test('a lost ACK after successful native commit resolves through verification without another frame',async t=>{
 const f=await fixture(t);await f.db.privateRecordTransaction(()=>({records:{[key]:record('ack-lost')},result:{ok:true}}));const before=await bytes(f.file);
 const cold=createLocalDb(f.file);assert.equal((await cold.read()).records[key].doc.transactionId,'ack-lost');await readOnly(cold);assert.deepEqual(await bytes(f.file),before);
});
test('every required snapshot/current WAL sync error declines proof, including optional recovery error codes',async t=>{
 const f=await fixture(t);for(const suffix of ['', '.wal'])for(const code of ['EIO','EINVAL','EPERM','ENOSYS','ENOTSUP']){
  await assert.rejects(readOnly(f.db,state=>interceptOpen(()=>f.db.verifyPrivateRecordDurability(state),failSync(f.file+suffix,code))),e=>e.code===code);
 }
});
test('directory and recovery-directory sync failures are not silently accepted',async t=>{
 const f=await fixture(t);for(const directory of [f.directory,path.join(f.directory,'.buyerlog-db-recovery')])await assert.rejects(readOnly(f.db,state=>interceptOpen(()=>f.db.verifyPrivateRecordDurability(state),failSync(directory))),e=>e.code==='EIO');
});
test('close failure after a successful sync still declines proof',async t=>{
 const f=await fixture(t);await assert.rejects(readOnly(f.db,state=>interceptOpen(()=>f.db.verifyPrivateRecordDurability(state),(handle,file)=>{if(file===f.file){const close=handle.close.bind(handle);handle.close=async()=>{await close();throw Object.assign(Error('close failed'),{code:'EIO'});};}})),e=>e.code==='EIO');
});
test('valid previous WAL is verified and synced even if its records were already snapshotted',async t=>{
 const f=await fixture(t);await f.db.transaction(()=>{});const before=await bytes(f.file);assert.notEqual(before['.wal.bak'],null);
 await assert.rejects(readOnly(f.db,state=>interceptOpen(()=>f.db.verifyPrivateRecordDurability(state),failSync(f.file+'.wal.bak'))),e=>e.code==='EIO');
 await readOnly(f.db);assert.deepEqual(await bytes(f.file),before);
});
test('a corrupt previous WAL cannot be ignored in favor of a valid current snapshot',async t=>{
 const f=await fixture(t);await f.db.transaction(()=>{});await fs.appendFile(f.file+'.wal.bak','{"broken":');let entered=false;
 await assert.rejects(readOnly(f.db,state=>{entered=true;return f.db.verifyPrivateRecordDurability(state);}),e=>e.code==='DATA_INTEGRITY_ERROR');assert.equal(entered,true);
});
test('unknown checksummed WAL operation is rejected instead of accepted as a native no-op',async t=>{
 const f=await fixture(t);await fs.appendFile(f.file+'.wal',frame('unknown-native-operation',{}));await assert.rejects(readOnly(f.db),e=>e.code==='DATA_INTEGRITY_ERROR');
});
test('invalid private WAL document schema cannot be certified by matching revision alone',async t=>{
 const f=await fixture(t);await fs.appendFile(f.file+'.wal',frame('private-records',{records:{wrong:{doc:{kind:'native-test'}}},conflicts:[],revision:2}));await assert.rejects(readOnly(f.db),e=>e.code==='DATA_INTEGRITY_ERROR');
});
test('pending native recovery intent blocks proof without invoking a replacement/recovery write',async t=>{
 const f=await fixture(t),intent=path.join(f.directory,'.buyerlog-db-recovery','synthetic.intent.json');await fs.writeFile(intent,'{}');const before=await bytes(f.file);
 await assert.rejects(readOnly(f.db),e=>e.code==='PRIVATE_DURABILITY_RECOVERY_PENDING');assert.deepEqual(await bytes(f.file),before);assert.equal(await fs.readFile(intent,'utf8'),'{}');
});
test('lease loss during file sync is checked again and never produces a receipt',async t=>{
 const f=await fixture(t),owner=path.join(f.file+'.write-lock','owner.json');let restored;
 try{await assert.rejects(readOnly(f.db,state=>interceptOpen(()=>f.db.verifyPrivateRecordDurability(state),(handle,file)=>{if(file===f.file){const sync=handle.sync.bind(handle);handle.sync=async()=>{await sync();restored=await fs.readFile(owner,'utf8');const value=JSON.parse(restored);value.token=crypto.randomUUID();await fs.writeFile(owner,JSON.stringify(value));};}})),e=>e.code==='SHARED_LEASE_LOST');}
 finally{if(restored)try{await fs.writeFile(owner,restored);}catch(error){if(error.code!=='ENOENT')throw error;}}
});
test('process exit before append fsync acknowledgement resolves only through a later strict cold proof',async t=>{
 const f=await fixture(t),child=spawnSync(process.execPath,[path.join(__dirname,'native-verifier-crash-child.cjs'),f.file],{env:process.env,encoding:'utf8',timeout:5000});
 assert.equal(child.error,undefined,String(child.error));assert.equal(child.status,91,child.stderr);const cold=createLocalDb(f.file),state=await cold.read();assert.equal(state.records[key].doc.transactionId,'child-unconfirmed');
 const before=await bytes(f.file);await readOnly(cold);assert.deepEqual(await bytes(f.file),before);
});
test('a valid checksummed final WAL frame without newline is verified without changing its bytes',async t=>{
 const f=await fixture(t),wal=await fs.readFile(f.file+'.wal');await fs.writeFile(f.file+'.wal',wal.subarray(0,wal.length-1));const before=await bytes(f.file);await readOnly(f.db);assert.deepEqual(await bytes(f.file),before);
});
test('state mutation during the final lease await is caught before returning proof',async t=>{
 const f=await fixture(t),owner=path.join(f.file+'.write-lock','owner.json');let afterDirectories=false;
 await assert.rejects(readOnly(f.db,state=>interceptOpen(async()=>{
  const original=fs.readFile;fs.readFile=async function(target,...args){const value=await original.call(this,target,...args);if(String(target)===owner&&afterDirectories){state.records[key].doc.value.zero=77;afterDirectories=false;}return value;};
  try{return await f.db.verifyPrivateRecordDurability(state);}finally{fs.readFile=original;}
 },(handle,file)=>{if(file===f.directory){const close=handle.close.bind(handle);handle.close=async()=>{await close();afterDirectories=true;};}})),e=>e.code==='PRIVATE_DURABILITY_STATE_CHANGED');
});
test('a real prepared native recovery intent must finish through native recovery before cold verification',async t=>{
 const f=await fixture(t),{appRoot}=require('./helpers/native-verifier-subject.cjs'),{createDurableFileRecovery}=require(path.join(appRoot,'server/lib/durable-file-recovery'));
 await assert.rejects(readOnly(f.db,async state=>{
  const recovery=createDurableFileRecovery({recoveryRoot:path.join(f.directory,'.buyerlog-db-recovery'),allowedRoots:[f.directory]});
  await recovery.prepare(f.file,Buffer.from(JSON.stringify({...state,revision:state.revision+1,recoveryTest:'native-pending'})));
  return f.db.verifyPrivateRecordDurability(state);
 }),e=>e.code==='PRIVATE_DURABILITY_RECOVERY_PENDING');
 const cold=createLocalDb(f.file);const proof=await readOnly(cold);assert.equal(proof.verified,true);assert.equal((await cold.read()).recoveryTest,'native-pending');
 const before=await bytes(f.file);await readOnly(cold);assert.deepEqual(await bytes(f.file),before);
});
