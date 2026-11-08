'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),zlib=require('node:zlib'),crypto=require('node:crypto'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createComputePool}=require('../server/lib/compute-pool');
const {createComputeService}=require('../server/lib/compute-service');
const {createShadowCoordinator}=require('../public/projection-shadow-hydration');
const {loadReference}=require('./helpers/projection-current-normalizer');
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
async function fixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'buyerlog-projection-private-'));
 const pool=createComputePool({maxWorkers:1,memoryBudgetBytes:512*1024*1024});
 const service=createComputeService({pool,root});t.after(async()=>{await service.close();fs.rmSync(root,{recursive:true,force:true});});
 const source={loadedAt:'2026-11-08T00:00:00Z',asasOrders:[],antrepoMap:{}};
 const descriptor=await service.seedSource({ownerId:'demo-owner',generation:'demo-g1',source,uncompressedBytes:1024});
 const token={ownerId:'demo-owner',actorId:'demo-actor',module:'cp',sourceGeneration:'page-g1',sourceRevision:'wire-r1',moduleInputKey:'cp-i1',
   sourceProjectionKey:'cp-s1',accessHash:'access-1',contextHash:'context-1',planRevision:'cp-orders-full-shadow-v1',requestGeneration:'request-1'};
 const raw={rows:[{_id:0,'Order Code':'0001',Probe:0,OPD:'2026-01-01','Ex-factory':'2026-03-01','Buying Son Onay Tarihi':null,_logisticSegments:[],tail:false},
   {_id:1,'Order Code':'0001',Probe:false,OPD:'2026-01-01','Ex-factory':'2026-03-01','Buying Son Onay Tarihi':null,_logisticSegments:[],tail:false}],cpModelColumns:[]};
 const projection=Buffer.from(JSON.stringify(raw)),projectionBuffer=zlib.gzipSync(projection);
 const params={projectionBuffer,projectionBytes:projection.length,projectionChecksum:sha(projectionBuffer),token,secret:crypto.randomBytes(32)};
 const run=async(task,extra={})=>{const lease=await service.run(task,descriptor,{...params,...extra});try{return JSON.parse(zlib.gunzipSync(Buffer.from(lease.value.buffer)));}finally{lease.release();}};
 return {raw,params,token,run,pool};
}
test('real shared worker returns a private full/full view and bounded details with exact row identity/value/key order',async t=>{
 const f=await fixture(t),before=JSON.stringify(f.raw),view=await f.run('projection-private-view');
 assert.equal(view.profile,'cp-orders-private-view-v1');assert.equal(view.mode,'shadow');assert.deepEqual(view.token,f.token);
 assert.deepEqual(view.rows,f.raw.rows);assert.deepEqual(view.cpModelColumns,[]);
 assert.notEqual(view.completeness[0].handle,view.completeness[1].handle);
 assert.equal(view.completeness[0].handle.length,32);
 const records=[...view.completeness].reverse().map(({ordinal,handle})=>({ordinal,handle}));
 const details=await f.run('projection-private-details',{records,maxBytes:4*1024*1024});
 assert.equal(details.profile,'cp-orders-full-details-v1');assert.equal(details.complete,true);assert.deepEqual(details.token,f.token);
 assert.deepEqual(details.records.map(x=>JSON.stringify(x.row)),records.map(x=>JSON.stringify(f.raw.rows[x.ordinal])));
 assert.equal(JSON.stringify(f.raw),before);assert.equal(JSON.stringify(view).includes(f.params.secret.toString('hex')),false);
 assert.equal(f.pool.stats().leasedOutputBytes,0);
});
test('real worker details feed the actual current normalizer and private coordinator without publishing into view rows',async t=>{
 const f=await fixture(t),view=await f.run('projection-private-view'),reference=loadReference();
 const control=JSON.parse(JSON.stringify(f.raw.rows));reference.normalize(control);
 const coordinator=createShadowCoordinator({fetchDetails:request=>f.run('projection-private-details',request),prepareFull:rows=>{reference.normalize(rows);},
   isCurrent:()=>true,getDirty:()=>({dirty:false,revision:0})});
 const session=coordinator.accept(view),full=await session.requireFull([1,0,1]);
 assert.deepEqual(JSON.stringify(full.rows),JSON.stringify([control[1],control[0],control[1]]));
 assert.equal(full.rows[0],full.rows[2]);assert.equal(full.rows[1].OPD instanceof Date,true);
 assert.equal(typeof view.rows[0].OPD,'string');assert.deepEqual(view.rows,f.raw.rows);
});
test('real shared worker refuses another source owner and corrupt pinned compressed projection',async t=>{
 const f=await fixture(t);
 await assert.rejects(f.run('projection-private-view',{token:{...f.token,ownerId:'other-owner'}}),{code:'COMPUTE_SOURCE_OWNER_MISMATCH'});
 await assert.rejects(f.run('projection-private-view',{projectionChecksum:'0'.repeat(64)}),{code:'PROJECTION_VIEW_STALE'});
 assert.equal(f.pool.stats().leasedOutputBytes,0);
});
