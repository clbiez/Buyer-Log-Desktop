'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),fsp=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),{EventEmitter,once}=require('node:events');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'bl-fabric-async-'));process.env.BUYER_LOG_SERVER_DATA_ROOT=root;
const express=require('express'),fabric=require('../server/lib/fabric-cards'),{withFileLeaseAsync}=require('../server/lib/shared-file-transaction'),{atomicWriteJsonAsync}=require('../server/user-data');
const app=express(),arrivals=new EventEmitter();let enabled=true,sessionValid=true,base,server;
app.use((req,_res,next)=>{req.currentUser={id:'demo',enabled:true};if(req.method==='POST')arrivals.emit('post');next();});
require('../server/routes/fabric-card-routes')(app,{express,fabricCards:fabric,requestRevision:req=>req.body?.expectedRevision??null,apiError:(res,error)=>res.status(error.statusCode||500).json({code:error.code}),userAccess:{requireArea:()=> (_req,_res,next)=>next(),profileById:()=>({id:'demo',enabled}),sessionProfile:()=>sessionValid?{id:'demo',enabled}:null,hasArea:()=>true,effectiveCollectionAccess:()=>[{level:'edit'}],appendAudit:()=>{}}});
app.get('/health',(_req,res)=>res.json({ok:true}));
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
async function call(items,revision){const response=await fetch(base+'/api/fabric-cards',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({items,expectedRevision:revision})});return {status:response.status,body:await response.json()};}
async function hold(work){const entered=deferred(),release=deferred();const done=withFileLeaseAsync(fabric.FILE,async()=>{entered.resolve();await release.promise;await work?.();});await entered.promise;return {release:release.resolve,done};}
test.before(async()=>{server=app.listen(0,'127.0.0.1');await once(server,'listening');base='http://127.0.0.1:'+server.address().port;});
test.after(async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));fs.rmSync(root,{recursive:true,force:true});});
test('actual fabric route rechecks current permission after a queued lease and leaves bytes unchanged',async()=>{
 await fabric.upsertFabricCards([{code:'1001',summary:'Original'}],{id:'demo'});const before=fs.readFileSync(fabric.FILE,'utf8'),lock=await hold();
 const arrived=once(arrivals,'post'),request=call([{code:'1001',summary:'Unauthorized'}],fabric.loadFabricCards()._revision);await arrived;
 enabled=false;lock.release();await lock.done;const response=await request;
 assert.equal(response.status,403);assert.equal(response.body.code,'COLLECTION_EDIT_DENIED');assert.equal(fs.readFileSync(fabric.FILE,'utf8'),before);enabled=true;
});
test('queued fabric CAS reads the latest committed revision and does not overwrite the newer writer',async()=>{
 const before=fabric.loadFabricCards(),lock=await hold(async()=>{const next=JSON.parse(JSON.stringify(before));next.cards['1001'].summary='Other writer';next._revision++;await atomicWriteJsonAsync(fabric.FILE,next);});
 const arrived=once(arrivals,'post'),request=call([{code:'1001',summary:'Stale overwrite'}],before._revision);await arrived;lock.release();await lock.done;
 const response=await request;assert.equal(response.status,409);assert.equal(fabric.loadFabricCards().cards['1001'].summary,'Other writer');
});
test('fabric HTTP success waits for the actual durable target fsync and health remains available', {timeout:10000},async t=>{
 const before=fabric.loadFabricCards(),stalled=deferred(),release=deferred(),open=fsp.open;let intercepted=false,acknowledged=false;
 fsp.open=async(...args)=>{const handle=await open(...args);if(!intercepted&&String(args[0]).startsWith(fabric.FILE+'.')&&String(args[0]).endsWith('.tmp')){intercepted=true;const sync=handle.sync.bind(handle);handle.sync=async()=>{stalled.resolve();await release.promise;return sync();};}return handle;};
 t.after(()=>{release.resolve();fsp.open=open;});
 const request=call([{code:'1001',summary:'After durable flush'}],before._revision).finally(()=>{acknowledged=true;});
 await stalled.promise;assert.equal((await fetch(base+'/health')).status,200);assert.equal(acknowledged,false);assert.equal(fabric.loadFabricCards().cards['1001'].summary,'Other writer');
 release.resolve();const response=await request;assert.equal(response.status,200);assert.equal(fabric.loadFabricCards().cards['1001'].summary,'After durable flush');
});
test('async fabric reads preserve a corrupt primary, while a leased mutation recovers its validated backup',async()=>{
 const good=fabric.loadFabricCards();fs.writeFileSync(fabric.FILE+'.bak',JSON.stringify(good));fs.writeFileSync(fabric.FILE,'corrupt primary');
 assert.equal((await fabric.loadFabricCardsAsync())._revision,good._revision);assert.equal(fs.readFileSync(fabric.FILE,'utf8'),'corrupt primary');
 const response=await call([{code:'1002',summary:'Recovered'}],good._revision);assert.equal(response.status,200);assert.equal(fabric.loadFabricCards().cards['1002'].summary,'Recovered');
});
test('fabric read does not return records after its session is invalidated during async I/O', {timeout:10000},async t=>{
 const read=fsp.readFile,stalled=deferred(),release=deferred();let intercepted=false;
 fsp.readFile=async(...args)=>{const bytes=await read(...args);if(!intercepted&&String(args[0])===fabric.FILE){intercepted=true;stalled.resolve();await release.promise;}return bytes;};
 t.after(()=>{release.resolve();fsp.readFile=read;sessionValid=true;});
 const pending=fetch(base+'/api/fabric-cards');await stalled.promise;sessionValid=false;release.resolve();const response=await pending;
 assert.equal(response.status,403);assert.equal((await response.json()).code,'COLLECTION_EDIT_DENIED');
});
