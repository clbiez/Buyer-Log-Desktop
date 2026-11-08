'use strict';
// Exercise the actual cache implementation; old full-cache and backup behavior remains authoritative.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),zlib=require('node:zlib'),crypto=require('node:crypto');
const APP=path.resolve(__dirname,'..');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'buyerlog-schema-binding-test-'));
process.env.BUYER_LOG_LOCAL_DATA_ROOT=root;process.env.BUYER_LOG_TEMP_ROOT=path.join(root,'tmp');
const cache=require(APP+'/server/lib/page-projection-cache');
const schemaApi=require(APP+'/public/module-projection-schema');
const sha=buffer=>crypto.createHash('sha256').update(buffer).digest('hex');
test.after(()=>{fs.rmSync(root,{recursive:true,force:true});});
let next=0;
async function fixture(){
  assert.equal(typeof cache.prepareModuleSchemas,'function');assert.equal(typeof cache.readCurrentModuleSchema,'function');
  const user='synthetic-schema-'+(++next),contextHash='context-1';
  const full={rows:[{'Order Code':'same-id',__CPX_SCHEMA:0},{'Order Code':'same-id',__CPX_SCHEMA:false}]};
  const raw=Buffer.from(JSON.stringify(full)),buffer=zlib.gzipSync(raw,{level:4}),entry={buffer,uncompressedBytes:raw.length};
  const schema=schemaApi.build({module:'orders',rows:full.rows,modelColumns:[{header:'__CPX_SCHEMA',label:'Synthetic',meta:{zero:0,false:false,nil:null}}],
    modelSchemaKnown:true,canExpose:true,scopePolicy:{schemaSource:'target',targetKnown:true,bindingsKnown:true,cpSchemaAllowed:true}});
  const keys={sourceProjectionKeys:{orders:'source-1'},moduleInputKeys:{orders:'input-1'}};
  const prepared=cache.prepareModuleSchemas({ownerId:user,contextHash,...keys,projections:{orders:entry},moduleSchemas:{orders:schema}});
  const manifest=await cache.writeCompressedGeneration(user,{contextHash,sourceLoadedAt:'synthetic-loaded',projections:{orders:entry},
    extra:{...keys,sourceRevisionKey:'revision-1',moduleSchemas:prepared}});
  const cached=await cache.readProjectionCompressed(user,'orders',contextHash);
  const read=()=>cache.readCurrentModuleSchema(user,'orders',contextHash,cached);
  return {user,contextHash,full,raw,buffer,entry,schema,keys,prepared,manifest,cached,read};
}
test('native compressed writer atomically publishes bound own schema alongside unchanged gzip',async()=>{
  const f=await fixture(),entry=f.read();assert.ok(entry);assert.deepEqual(entry.schema,f.schema);
  assert.equal(sha(f.cached.buffer),sha(f.buffer));assert.equal(f.manifest.modules.orders.checksum,sha(f.buffer));
  assert.equal(entry.pin.generation,f.manifest.activeGeneration);
  assert.deepEqual(entry.schema.modelColumns[0].meta,{zero:0,false:false,nil:null});
});
test('caller mutation before queued write cannot bind old schema to the newly written full bytes',async()=>{
  const f=await fixture(),entry={...f.entry};
  const pending=cache.writeCompressedGeneration(f.user,{contextHash:f.contextHash,sourceLoadedAt:'synthetic-loaded',projections:{orders:entry},
    extra:{...f.keys,sourceRevisionKey:'revision-1',moduleSchemas:f.prepared}});
  const changed={rows:[{'Order Code':'different',__CPX_SCHEMA:'changed'}]},raw=Buffer.from(JSON.stringify(changed));
  entry.buffer=zlib.gzipSync(raw,{level:4});entry.uncompressedBytes=raw.length;
  await pending;const cached=await cache.readProjectionCompressed(f.user,'orders',f.contextHash);
  assert.deepEqual(JSON.parse(zlib.gunzipSync(cached.buffer)),changed);
  assert.equal(cache.readCurrentModuleSchema(f.user,'orders',f.contextHash,cached),null);
});
test('missing primary cannot obtain schema from a valid .bak even if native full fallback succeeds',async()=>{
  const f=await fixture();fs.copyFileSync(cache.manifestPath(f.user),cache.manifestPath(f.user)+'.bak');fs.unlinkSync(cache.manifestPath(f.user));
  const fallback=await cache.readProjectionCompressed(f.user,'orders',f.contextHash);assert.ok(fallback);
  assert.equal(cache.readCurrentModuleSchema(f.user,'orders',f.contextHash,fallback),null);assert.equal(f.read(),null);
});
test('same-generation rewrite and restoration of original bytes cannot resurrect dropped schema',async()=>{
  const f=await fixture();await cache.writeProjection(f.user,'orders',f.contextHash,{rows:[{'Order Code':'changed',__CPX_SCHEMA:0}]});
  assert.equal(f.read(),null);await cache.writeProjection(f.user,'orders',f.contextHash,f.full);
  const restored=await cache.readProjectionCompressed(f.user,'orders',f.contextHash);
  assert.equal(restored.manifest.activeGeneration,f.manifest.activeGeneration);assert.equal(sha(restored.buffer),sha(f.buffer));
  assert.equal(cache.readCurrentModuleSchema(f.user,'orders',f.contextHash,restored),null);
});
test('same-byte explicit writeProjection still revokes the old schema',async()=>{
  const f=await fixture();await cache.writeProjection(f.user,'orders',f.contextHash,f.full);
  const cached=await cache.readProjectionCompressed(f.user,'orders',f.contextHash);assert.equal(cached.meta.checksum,sha(f.buffer));
  assert.equal(cache.readCurrentModuleSchema(f.user,'orders',f.contextHash,cached),null);
});
test('safe reuse retains exact primary schema; changed source key drops and later extra cannot resurrect',async()=>{
  const f=await fixture();const reuse=extra=>cache.reuseGeneration(f.user,{contextHash:f.contextHash,generation:f.manifest.activeGeneration,
    moduleInputKeys:f.keys.moduleInputKeys,sourceLoadedAt:'synthetic-loaded',extra});
  await reuse({runtimeMeta:{touch:true}});assert.ok(f.read());
  await reuse({sourceProjectionKeys:{orders:'source-changed'}});assert.equal(f.read(),null);
  await reuse({sourceProjectionKeys:f.keys.sourceProjectionKeys,moduleSchemas:f.manifest.moduleSchemas});assert.equal(f.read(),null);
});
test('fallback full-cache reuse cannot promote the backup schema into a new primary',async()=>{
  const f=await fixture();fs.copyFileSync(cache.manifestPath(f.user),cache.manifestPath(f.user)+'.bak');fs.unlinkSync(cache.manifestPath(f.user));
  const reused=await cache.reuseGeneration(f.user,{contextHash:f.contextHash,generation:f.manifest.activeGeneration,moduleInputKeys:f.keys.moduleInputKeys,
    sourceLoadedAt:'synthetic-loaded',extra:{moduleSchemas:f.manifest.moduleSchemas}});
  assert.ok(reused,'Original full-cache fallback semantics remain available');
  const cached=await cache.readProjectionCompressed(f.user,'orders',f.contextHash);assert.equal(cache.readCurrentModuleSchema(f.user,'orders',f.contextHash,cached),null);
});
test('rewriteGeneration preserves full behavior but cannot import old generation schema',async()=>{
  const f=await fixture();const rewritten=await cache.rewriteGeneration(f.user,{fromContextHash:f.contextHash,toContextHash:f.contextHash,transform:(module,value)=>value});
  assert.ok(rewritten);assert.notEqual(rewritten.activeGeneration,f.manifest.activeGeneration);
  const cached=await cache.readProjectionCompressed(f.user,'orders',f.contextHash);assert.deepEqual(JSON.parse(zlib.gunzipSync(cached.buffer)),f.full);
  assert.equal(cache.readCurrentModuleSchema(f.user,'orders',f.contextHash,cached),null);
});
test('new ordinary full generation without opt-in metadata does not inherit known schema',async()=>{
  const f=await fixture();await cache.writeCompressedGeneration(f.user,{contextHash:f.contextHash,sourceLoadedAt:'synthetic-loaded',projections:{orders:f.entry},
    extra:{...f.keys,sourceRevisionKey:'revision-1',moduleSchemas:f.manifest.moduleSchemas}});
  const cached=await cache.readProjectionCompressed(f.user,'orders',f.contextHash);assert.equal(cache.readCurrentModuleSchema(f.user,'orders',f.contextHash,cached),null);
});
test('direct primary schema corruption is rejected without consulting backup',async()=>{
  const f=await fixture();const primary=JSON.parse(fs.readFileSync(cache.manifestPath(f.user),'utf8'));
  fs.copyFileSync(cache.manifestPath(f.user),cache.manifestPath(f.user)+'.bak');primary.moduleSchemas.orders.schema.modelColumns[0].label='corrupt';
  fs.writeFileSync(cache.manifestPath(f.user),JSON.stringify(primary));assert.equal(f.read(),null);
});
test('unrelated native backlog manifest mutation preserves valid primary schema',async()=>{
  const f=await fixture();await cache.writeBacklog(f.user,f.contextHash,'schema-test',{rows:[]});assert.ok(f.read());
});
test('native backlog fallback mutation retains full behavior without resurrecting backup schema',async()=>{
  const f=await fixture();fs.copyFileSync(cache.manifestPath(f.user),cache.manifestPath(f.user)+'.bak');fs.unlinkSync(cache.manifestPath(f.user));
  assert.ok(await cache.writeBacklog(f.user,f.contextHash,'schema-test',{rows:[]}));
  const cached=await cache.readProjectionCompressed(f.user,'orders',f.contextHash);assert.ok(cached);
  assert.equal(cache.readCurrentModuleSchema(f.user,'orders',f.contextHash,cached),null);
});
