'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),fsp=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const leases=require('../server/lib/shared-file-transaction');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'bl-request-policy-'));test.after(()=>fs.rmSync(root,{recursive:true,force:true}));
function remote(name){const target=path.join(root,name),folder=target+'.write-lock';fs.mkdirSync(folder);fs.writeFileSync(path.join(folder,'owner.json'),JSON.stringify({token:'remote-token',machine:'unverified-remote-device',pid:100,createdAt:new Date().toISOString()}));return target;}
function denyWait(){const wait=Atomics.wait;Atomics.wait=()=>{throw Error('Blocking lease wait reached');};return()=>{Atomics.wait=wait;};}

test('request policy survives async boundaries and rejects contended sync stores without sleeping',async()=>{
 const target=remote('busy'),before=fs.readFileSync(path.join(target+'.write-lock','owner.json')),restore=denyWait();
 try{await leases.runWithNonblockingFileLeases(async()=>{await new Promise(setImmediate);assert.throws(()=>leases.withFileLeaseSync(target,()=>assert.fail('must not enter foreign lease')),{code:'SHARED_WRITE_BUSY',statusCode:409,status:409});});}
 finally{restore();}
 assert.deepEqual(fs.readFileSync(path.join(target+'.write-lock','owner.json')),before);
});

test('request policy also prevents sync metadata sharing-violation retry waits',()=>{
 const target=remote('sharing'),read=fs.readFileSync,restore=denyWait();
 fs.readFileSync=(file,...args)=>{if(String(file)===path.join(target+'.write-lock','owner.json'))throw Object.assign(Error('sharing violation'),{code:'EPERM'});return read(file,...args);};
 try{leases.runWithNonblockingFileLeases(()=>assert.throws(()=>leases.withFileLeaseSync(target,()=>assert.fail('no ownership')),{code:'SHARED_WRITE_BUSY',statusCode:409}));}
 finally{fs.readFileSync=read;restore();}
});

test('request policy leaves uncontended synchronous persistence and startup lease behavior compatible',()=>{
 const target=path.join(root,'uncontended');
 assert.equal(leases.runWithNonblockingFileLeases(()=>leases.withFileLeaseSync(target,()=>{fs.writeFileSync(target,'complete');return 'saved';})),'saved');assert.equal(fs.readFileSync(target,'utf8'),'complete');
 const occupied=remote('startup'),wait=Atomics.wait;Atomics.wait=()=>{throw Object.assign(Error('Startup still has its original wait policy'),{code:'STARTUP_WAIT'});};
 try{assert.throws(()=>leases.withFileLeaseSync(occupied,()=>{}),{code:'STARTUP_WAIT'});}finally{Atomics.wait=wait;}
});

test('async request writers retain awaited serialization rather than the sync busy fallback',async()=>{
 const target=path.join(root,'async'),entered=Promise.withResolvers(),release=Promise.withResolvers();
 const held=leases.withFileLeaseAsync(target,async()=>{entered.resolve();await release.promise;});await entered.promise;
 let completed=false;const pending=leases.runWithNonblockingFileLeases(()=>leases.withFileLeaseAsync(target,async()=>{await fsp.writeFile(target,'awaited');})).finally(()=>{completed=true;});
 await new Promise(setImmediate);assert.equal(completed,false);release.resolve();await held;await pending;assert.equal(await fsp.readFile(target,'utf8'),'awaited');
});

test('normal server installs the policy before authentication or other request handlers',()=>{
 const source=fs.readFileSync(path.join(__dirname,'../server/server.js'),'utf8'),start=source.indexOf('const app = express();'),block=source.slice(start,source.indexOf('app.use(auth.requireAuth)',start));
 assert.match(block,/app\.use\(\(_req,_res,next\)=>require\('\.\/lib\/shared-file-transaction'\)\.runWithNonblockingFileLeases\(next\)\)/);
});
