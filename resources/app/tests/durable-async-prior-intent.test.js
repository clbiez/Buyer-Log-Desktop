'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),fsp=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {createDurableFileRecovery}=require('../server/lib/durable-file-recovery'),{withFileLeaseAsync}=require('../server/lib/shared-file-transaction');
async function fixture(t){const root=await fsp.mkdtemp(path.join(os.tmpdir(),'bl-async-prior-'));t.after(()=>fsp.rm(root,{recursive:true,force:true}));const target=path.join(root,'data.json'),recovery=path.join(root,'recovery'),writer=createDurableFileRecovery({recoveryRoot:recovery,allowedRoots:[root]});return {root,target,recovery,writer};}

test('async replacement recovers an unfinished prior intent without synchronous filesystem I/O',async t=>{
 const {target,writer}=await fixture(t);writer.prepareSync(target,Buffer.from('prior'));
 const names=['mkdirSync','openSync','readFileSync','writeFileSync','fsyncSync','closeSync','renameSync','unlinkSync','rmdirSync','readdirSync','statSync','lstatSync','existsSync','copyFileSync','appendFileSync'],previous=Object.fromEntries(names.map(name=>[name,fs[name]]));
 for(const name of names)fs[name]=()=>{throw Error('Async recovery called '+name);};
 try{await withFileLeaseAsync(target,()=>writer.replace(target,Buffer.from('latest')));}finally{Object.assign(fs,previous);}
 assert.equal(await fsp.readFile(target,'utf8'),'latest');assert.equal(await fsp.readFile(target+'.bak','utf8'),'prior');
});

for(const damage of ['missing','corrupt'])test('async replacement preserves an unresolved '+damage+' recovery payload rather than overwriting its intent',async t=>{
 const {target,recovery,writer}=await fixture(t),intent=writer.prepareSync(target,Buffer.from('prior')),metadata=fs.readdirSync(recovery).find(name=>name.endsWith('.intent.json')),before=fs.readFileSync(path.join(recovery,metadata));
 if(damage==='missing')await fsp.unlink(path.join(recovery,intent.payload));else await fsp.writeFile(path.join(recovery,intent.payload),'damaged');
 await assert.rejects(withFileLeaseAsync(target,()=>writer.replace(target,Buffer.from('must not replace'))),{code:'DATA_INTEGRITY_ERROR'});
 assert.deepEqual(await fsp.readFile(path.join(recovery,metadata)),before);await assert.rejects(fsp.access(target),{code:'ENOENT'});
});

test('async prior-intent conflict preserves the external target and quarantines recovery evidence',async t=>{
 const {target,recovery,writer}=await fixture(t);writer.prepareSync(target,Buffer.from('prior'));await fsp.writeFile(target,'external');
 await assert.rejects(withFileLeaseAsync(target,()=>writer.replace(target,Buffer.from('must not replace'))),{code:'DATA_INTEGRITY_ERROR'});
 assert.equal(await fsp.readFile(target,'utf8'),'external');const files=await fsp.readdir(path.join(recovery,'quarantine'));assert.ok(files.some(name=>name.endsWith('.intent.json')));assert.ok(files.some(name=>name.endsWith('.payload')));
});
