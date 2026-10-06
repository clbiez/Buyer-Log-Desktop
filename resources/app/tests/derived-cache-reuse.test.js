'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'bl-derived-reuse-'));
process.env.BUYER_LOG_LOCAL_DATA_ROOT=root;
const cache=require('../server/lib/page-projection-cache'),backlog=require('../server/lib/backlog-plan-actual');
test.after(()=>fs.rmSync(root,{recursive:true,force:true}));
test('unchanged projections retain verified bytes and generation; context, input and corruption reject reuse',async()=>{
  const old=await cache.writeGeneration('u',{contextHash:'scope',sourceLoadedAt:'old',projections:{cp:{rows:[{id:1}]},orders:{rows:[{id:2}]}},extra:{moduleInputKeys:{cp:'a',orders:'b'}}});
  const hit=await cache.readReusableProjections('u','scope',{cp:'a',orders:'b'});assert.deepEqual(Object.keys(hit.projections).sort(),['cp','orders']);
  const updated=await cache.reuseGeneration('u',{contextHash:'scope',generation:old.activeGeneration,moduleInputKeys:{cp:'a',orders:'b'},sourceLoadedAt:'new',extra:{sourceRevisionKey:'new-revision'}});
  assert.equal(updated.activeGeneration,old.activeGeneration);assert.equal(updated.sourceLoadedAt,'new');
  assert.deepEqual(Object.keys((await cache.readReusableProjections('u','scope',{cp:'changed',orders:'b'})).projections),['orders']);
  assert.deepEqual(Object.keys((await cache.readReusableProjections('u','other',{cp:'a',orders:'b'})).projections),[]);
  const file=path.join(cache.ROOT,'u',old.activeGeneration,'orders.json.gz');fs.writeFileSync(file,'corrupted');
  assert.equal((await cache.readReusableProjections('u','scope',{orders:'b'})).projections.orders,undefined);
  assert.equal(await cache.reuseGeneration('u',{contextHash:'scope',generation:old.activeGeneration,moduleInputKeys:{cp:'a',orders:'b'}}),null);
  assert.equal(cache.loadManifest('u').sourceLoadedAt,'new');
});
test('mixed generations preserve unchanged module bytes and publish changed records atomically',async()=>{
  const old=await cache.writeGeneration('mixed',{contextHash:'s',projections:{cp:{rows:[{qty:1}]},orders:{rows:[{qty:2}]}},extra:{moduleInputKeys:{cp:'a',orders:'b'}}});
  const reused=await cache.readReusableProjections('mixed','s',{cp:'changed',orders:'b'});
  const next=await cache.writeGeneration('mixed',{contextHash:'s',projections:{cp:{rows:[{qty:3}]}},reused:reused.projections,extra:{moduleInputKeys:{cp:'changed',orders:'b'}}});
  assert.notEqual(next.activeGeneration,old.activeGeneration);assert.equal(next.modules.orders.checksum,old.modules.orders.checksum);
  assert.equal((await cache.readProjection('mixed','cp','s')).data.rows[0].qty,3);
  assert.equal((await cache.readProjection('mixed','orders','s')).data.rows[0].qty,2);
});
test('unchanged Backlog records still append every refresh boundary; stale keys cannot create empty history',async()=>{
  const row={id:'O',orderCode:'O',qty:10},first='2026-10-06T08:00:00Z',second='2026-10-06T09:00:00Z';
  await backlog.appendSnapshot('b',{capturedAt:first,rows:[row],inputKey:'same'});
  assert.equal(await backlog.appendSnapshot('b',{capturedAt:second,reuseInputKey:'wrong'}),null);
  const reused=await backlog.appendSnapshot('b',{capturedAt:second,reuseInputKey:'same',sourceGenerationId:'fresh'});assert.equal(reused.reused,true);
  const archive=await backlog.readArchive('b');assert.equal(backlog.markerList(archive).length,2);assert.deepEqual(archive.deltas[0].upserts,[]);
  assert.deepEqual(backlog.rowsAtMarker(archive,1),[row]);
  await backlog.appendSnapshot('b',{capturedAt:'2026-10-06T10:00:00Z',rows:[{...row,qty:20}],inputKey:'changed'});
  assert.equal(backlog.rowsAtMarker(await backlog.readArchive('b'),2)[0].qty,20);
});
