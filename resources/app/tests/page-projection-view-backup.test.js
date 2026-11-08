'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {fixture,sha}=require('./helpers/projection-view-cache-fixture'),pins=require('./fixtures/projection-view-cache-pins.json');

test('actual baseline AND candidate corrupt-primary JSON promotes backup to index0: fallbackfalse,oldergeneration,exactfullrows',async t=>{
 const paths={baseline:path.resolve(__dirname,'fixtures/projection-view-cache-f076.js'),
  candidate:path.resolve(__dirname,'../server/lib/page-projection-cache.js')};
 for(const [label,source] of Object.entries(paths)){
  assert.equal(sha(fs.readFileSync(source)),pins[label].sha256,label+' exact actual source');
  const f=fixture(t,source),first=await f.start(),second=await f.start();
  assert.notEqual(first.activeGeneration,second.activeGeneration,label+' distinct real generations');
  fs.writeFileSync(f.cache.manifestPath(f.owner),'{partial');
  const legacy=await f.cache.readProjection(f.owner,'orders',f.context);
  assert.ok(legacy,label+' legacy backup remains available');
  assert.equal(legacy.fallback,false,label+' backup is the sole candidate at index0');
  assert.equal(legacy.manifest.activeGeneration,first.activeGeneration,label+' older generation is returned');
  assert.notEqual(legacy.manifest.activeGeneration,second.activeGeneration,label+' it is not the corrupt primary');
  assert.deepEqual(legacy.data,f.full,label+' exact legacy full rows/presence/values');
 }
});
