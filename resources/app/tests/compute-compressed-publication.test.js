'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),zlib=require('node:zlib');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'buyerlog-compressed-publication-'));process.env.BUYER_LOG_LOCAL_DATA_ROOT=root;
const cache=require('../server/lib/page-projection-cache');
test.after(()=>fs.rmSync(root,{recursive:true,force:true}));
const entry=value=>({buffer:zlib.gzipSync(JSON.stringify(value)),uncompressedBytes:Buffer.byteLength(JSON.stringify(value))});
const stale=()=>Object.assign(Error('Synthetic source changed'),{code:'COMPUTE_STALE_GENERATION'});
test('compressed publication rejects stale work before creating or replacing the manifest',async()=>{
  const before=await cache.writeCompressedGeneration('a',{contextHash:'ctx',sourceLoadedAt:'r1',projections:{cp:entry({rows:[1]})}});
  await assert.rejects(cache.writeCompressedGeneration('a',{contextHash:'ctx',sourceLoadedAt:'r2',projections:{cp:entry({rows:[2]})},assertCurrent(){throw stale();}}),{code:'COMPUTE_STALE_GENERATION'});
  assert.equal(cache.loadManifest('a').activeGeneration,before.activeGeneration);
});
test('a source change during async writes does not publish the prepared generation',async()=>{
  const before=await cache.writeCompressedGeneration('b',{contextHash:'ctx',sourceLoadedAt:'r1',projections:{cp:entry({rows:[1]})}});
  const original=fs.promises.writeFile;let current=true;
  fs.promises.writeFile=async function(file,...args){const result=await original.call(this,file,...args);if(String(file).includes('.json.gz.')&&String(file).endsWith('.tmp'))current=false;return result;};
  try{await assert.rejects(cache.writeCompressedGeneration('b',{contextHash:'ctx',sourceLoadedAt:'r2',projections:{cp:entry({rows:[2]})},assertCurrent(){if(!current)throw stale();}}),{code:'COMPUTE_STALE_GENERATION'});}
  finally{fs.promises.writeFile=original;}
  assert.equal(cache.loadManifest('b').activeGeneration,before.activeGeneration);
});
test('on-demand compressed publication preserves other modules only from the same source and context',async()=>{
  const first=await cache.writeCompressedGeneration('c',{contextHash:'ctx',sourceLoadedAt:'r1',projections:{cp:entry({rows:[1]})},extra:{sourceRevisionKey:'source-1'}});
  const second=await cache.writeCompressedGeneration('c',{contextHash:'ctx',sourceLoadedAt:'r1',projections:{overview:entry({rows:[2]})},extra:{sourceRevisionKey:'source-1'},mergePrevious:true});
  assert.notEqual(first.activeGeneration,second.activeGeneration);assert.equal(second.modules.cp.checksum,first.modules.cp.checksum);assert.deepEqual((await cache.readProjection('c','cp','ctx')).data,{rows:[1]});
  const third=await cache.writeCompressedGeneration('c',{contextHash:'ctx',sourceLoadedAt:'r2',projections:{overview:entry({rows:[3]})},extra:{sourceRevisionKey:'source-2'},mergePrevious:true});assert.equal(third.modules.cp,undefined);
});
test('a late source change after manifest rename never leaves a manifest pointing to a deleted generation',async()=>{
  await cache.writeCompressedGeneration('d',{contextHash:'ctx',sourceLoadedAt:'r1',projections:{cp:entry({rows:[1]})}});
  const original=fs.promises.rename;let current=true;
  fs.promises.rename=async function(from,to){const result=await original.call(this,from,to);if(String(to).endsWith(path.join('d','manifest.json')))current=false;return result;};
  try{await assert.rejects(cache.writeCompressedGeneration('d',{contextHash:'ctx',sourceLoadedAt:'r2',projections:{cp:entry({rows:[2]})},assertCurrent(){if(!current)throw stale();}}),{code:'COMPUTE_STALE_GENERATION'});}
  finally{fs.promises.rename=original;}
  const manifest=cache.loadManifest('d');assert.ok(fs.existsSync(path.join(root,'page-cache','d',manifest.activeGeneration,'cp.json.gz')));
});
test('reused generations enforce the live guard before and after asynchronous cache reads',async()=>{
 for(const mode of ['already-stale','changed-during-read']){
  const user=mode==='already-stale'?'reuse-stale':'reuse-race',keys={cp:'same-input'};
  const before=await cache.writeCompressedGeneration(user,{contextHash:'ctx',sourceLoadedAt:'r1',projections:{cp:entry({rows:[1]})},extra:{moduleInputKeys:keys}});
  let checks=0;
  await assert.rejects(cache.reuseGeneration(user,{contextHash:'ctx',generation:before.activeGeneration,moduleInputKeys:keys,sourceLoadedAt:'r2',assertCurrent(){checks++;if(mode==='already-stale'||checks>1)throw stale();}}),{code:'COMPUTE_STALE_GENERATION'});
  assert.equal(cache.loadManifest(user).sourceLoadedAt,'r1');assert.equal(cache.loadManifest(user).activeGeneration,before.activeGeneration);
 }
});
