'use strict';
// Exercise the actual application strict schema API; no lookalike reader.
const test=require('node:test'),assert=require('node:assert/strict'),zlib=require('node:zlib'),crypto=require('node:crypto');
const path=require('node:path'),APP=path.resolve(__dirname,'..');
const schemaApi=require(APP+'/public/module-projection-schema');
const {create,MAX_ENTRY_BYTES}=require('../server/lib/page-projection-schema-binding');
const api=create({schemaApi}),hash=value=>crypto.createHash('sha256').update(value).digest('hex');
const copy=value=>JSON.parse(JSON.stringify(value));
function fixture(module='orders'){
  const raw=Buffer.from(JSON.stringify({rows:[{'Order Code':'duplicate',__CPX_SCHEMA_TEST:0},{'Order Code':'duplicate',__CPX_SCHEMA_TEST:false}]}));
  const buffer=zlib.gzipSync(raw,{level:4}),entry={buffer,uncompressedBytes:raw.length};
  const schema=schemaApi.build({module,rows:JSON.parse(raw).rows,modelColumns:[{id:'test',header:'__CPX_SCHEMA_TEST',label:'Synthetic',percentageScale:0,
    sourceMetadata:{zero:0,false:false,nil:null,nested:[0,false,null]}}],modelSchemaKnown:true,canExpose:true,
    scopePolicy:{schemaSource:'target',targetKnown:true,bindingsKnown:true,cpSchemaAllowed:true}});
  assert.equal(schema.status,'known');
  const context={ownerId:'synthetic-owner',contextHash:'context-1',sourceProjectionKeys:{[module]:'source-1'},moduleInputKeys:{[module]:'input-1'}};
  const prepared=api.prepare({...context,projections:{[module]:entry},moduleSchemas:{[module]:schema}});
  const manifest={schemaVersion:2,activeGeneration:'generation-1',contextHash:context.contextHash,
    modules:{[module]:{bytes:buffer.length,uncompressedBytes:raw.length,checksum:hash(buffer)}},
    sourceProjectionKeys:context.sourceProjectionKeys,moduleInputKeys:context.moduleInputKeys};
  manifest.moduleSchemas=api.bindCommitted(manifest,prepared,context.ownerId);
  const cached={buffer,module,meta:manifest.modules[module],manifest:copy(manifest),fallback:false};
  const read=(patch={})=>api.readCurrent({ownerId:context.ownerId,module,manifest,cached,...patch});
  return {module,raw,buffer,entry,schema,context,prepared,manifest,cached,read};
}
test('known schema is own bounded metadata bound to exact full gzip and current manifest',()=>{
  const f=fixture(),result=f.read();assert.ok(result);assert.deepEqual(result.schema,f.schema);
  assert.notEqual(result.schema,f.schema);assert.notEqual(result.schema,f.manifest.moduleSchemas.orders.schema);
  assert.ok(Buffer.byteLength(JSON.stringify(result))<=MAX_ENTRY_BYTES);assert.equal(Object.isFrozen(result.schema.modelColumns[0].sourceMetadata),true);
  assert.deepEqual(result.schema.modelColumns[0].sourceMetadata,{zero:0,false:false,nil:null,nested:[0,false,null]});
  assert.equal(result.schema.modelColumns[0].percentageScale,0);assert.equal(result.pin.fullChecksum,hash(f.buffer));
});
test('prepared schema snapshot does not borrow caller definitions or consume full gzip',()=>{
  const f=fixture(),before=hash(f.buffer);f.schema.modelColumns[0].label='caller changed';
  assert.equal(f.prepared.orders.schema.modelColumns[0].label,'Synthetic');assert.equal(hash(f.buffer),before);
  assert.equal(f.read().schema.modelColumns[0].label,'Synthetic');
});
test('queued mutation of gzip cannot attach original schema to changed committed full checksum',()=>{
  const f=fixture();f.buffer[10]^=1;const changed=copy(f.manifest);changed.modules.orders.checksum=hash(f.buffer);
  assert.deepEqual(api.bindCommitted(changed,f.prepared,f.context.ownerId),{});
  assert.equal(f.read(),null);
});
test('unknown missing legacy malformed other-module and accessor schemas never become known',()=>{
  const f=fixture();let invoked=0;
  const getter={};Object.defineProperty(getter,'schemaVersion',{enumerable:true,get(){invoked++;return 1;}});
  for(const schema of [undefined,null,{schemaVersion:0},schemaApi.read(null,'orders'),fixture('cp').schema,getter,
    {...f.schema,rowCount:-1},new Proxy(f.schema,{get(){invoked++;throw Error('proxy read');}})]){
    assert.deepEqual(api.prepare({...f.context,projections:{orders:f.entry},moduleSchemas:{orders:schema}}),{});
  }
  assert.equal(invoked,0);
});
test('malformed top-level reader/producer options do not execute getters',()=>{
  let invoked=0;const getter={};Object.defineProperty(getter,'ownerId',{enumerable:true,get(){invoked++;return 'owner';}});
  for(const input of [null,undefined,[],getter,new Proxy({},{get(){invoked++;throw Error('proxy');}})]){
    assert.equal(api.readCurrent(input),null);assert.deepEqual(api.prepare(input),{});
  }
  assert.equal(invoked,0);
});
test('schema metadata over 64 KiB is declined rather than truncated or normalized',()=>{
  const f=fixture(),schema=copy(f.schema);schema.modelColumns[0].sourceMetadata.payload='x'.repeat(65536);
  assert.deepEqual(api.prepare({...f.context,projections:{orders:f.entry},moduleSchemas:{orders:schema}}),{});
});
test('unknown catalog properties, inherited entries, getters and wrong record shape fail closed',()=>{
  const f=fixture();let invoked=0;
  assert.deepEqual(api.snapshotPrepared({...f.prepared,other:f.prepared.orders}),{});
  assert.deepEqual(api.snapshotPrepared(Object.create({orders:f.prepared.orders})),{});
  const getter={};Object.defineProperty(getter,'orders',{enumerable:true,get(){invoked++;return f.prepared.orders;}});
  assert.deepEqual(api.snapshotPrepared(getter),{});assert.equal(invoked,0);
  for(const change of [{extra:true},{version:0},{module:'cp'},{schemaChecksum:'0'.repeat(64)}]){
    assert.deepEqual(api.snapshotPrepared({orders:{...f.prepared.orders,...change}}),{});
  }
});
test('every stable binding field including same-generation raw bytes and full checksum must match',()=>{
  const patches=[m=>m.activeGeneration='generation-2',m=>m.contextHash='context-2',m=>m.sourceProjectionKeys.orders='source-2',
    m=>m.moduleInputKeys.orders='input-2',m=>m.modules.orders.checksum='0'.repeat(64),m=>m.modules.orders.uncompressedBytes++,m=>m.modules.orders.bytes++];
  for(const patch of patches){const f=fixture();patch(f.manifest);assert.equal(f.read(),null);}
  const f=fixture();assert.equal(f.read({ownerId:'different-owner'}),null);assert.equal(f.read({module:'cp'}),null);
});
test('fallback true, omitted fallback and legacy manifests cannot supply a schema',()=>{
  const f=fixture();assert.equal(f.read({cached:{...f.cached,fallback:true}}),null);
  const {fallback,...legacyCached}=f.cached;assert.equal(f.read({cached:legacyCached}),null);
  const legacy=copy(f.manifest);delete legacy.moduleSchemas;assert.equal(f.read({manifest:legacy}),null);
  assert.equal(f.read({manifest:null}),null);assert.equal(f.read({manifest:{...f.manifest,schemaVersion:1}}),null);
});
test('primary replacement rejects a still-valid prior cached body even when previous manifest is available',()=>{
  const f=fixture(),current=copy(f.manifest);current.activeGeneration='generation-new';
  assert.equal(f.read({manifest:current}),null);assert.ok(f.read());
});
test('cached module/meta/body each independently must agree with primary and schema binding',()=>{
  const f=fixture();assert.equal(f.read({cached:{...f.cached,module:'cp'}}),null);
  assert.equal(f.read({cached:{...f.cached,meta:{...f.cached.meta,checksum:'0'.repeat(64)}}}),null);
  const changed=Buffer.from(f.buffer);changed[10]^=1;assert.equal(f.read({cached:{...f.cached,buffer:changed}}),null);
  const raw=Buffer.from(f.buffer);raw[0]=0;assert.equal(f.read({cached:{...f.cached,buffer:raw}}),null);
});
test('schema mutation without matching schema checksum is rejected on read and retain',()=>{
  const f=fixture();f.manifest=copy(f.manifest);f.manifest.moduleSchemas.orders.schema.modelColumns[0].label='stale rewrite';
  assert.equal(f.read({manifest:f.manifest}),null);assert.deepEqual(api.retainCurrent(f.manifest,f.manifest,f.context.ownerId),{});
});
test('same generation safe reuse retains only exact existing binding, never caller extra metadata',()=>{
  const f=fixture(),next=copy(f.manifest);next.runtimeMeta={changed:true};
  assert.deepEqual(api.retainCurrent(f.manifest,next,f.context.ownerId),f.manifest.moduleSchemas);
  const old=copy(f.manifest);old.moduleSchemas={};next.moduleSchemas=f.manifest.moduleSchemas;
  assert.deepEqual(api.retainCurrent(old,next,f.context.ownerId),{});
  next.moduleInputKeys.orders='new';assert.deepEqual(api.retainCurrent(f.manifest,next,f.context.ownerId),{});
  const removed=copy(f.manifest);removed.moduleSchemas={};assert.deepEqual(api.retainCurrent(f.manifest,removed,f.context.ownerId),{});
  assert.deepEqual(api.retainCurrent(null,f.manifest,f.context.ownerId),{});
});
test('new generation/rewrite cannot rebind old bound records masquerading as producer candidates',()=>{
  const f=fixture(),next=copy(f.manifest);next.activeGeneration='generation-new';
  assert.deepEqual(api.bindCommitted(next,f.manifest.moduleSchemas,f.context.ownerId),{});
  assert.deepEqual(api.retainCurrent(f.manifest,next,f.context.ownerId),{});
  assert.ok(api.bindCommitted(next,f.prepared,f.context.ownerId).orders);
});
test('drop is one-way across same-generation A→B→A edits unless a fresh producer supplies schema',()=>{
  const f=fixture(),next=copy(f.manifest);next.moduleSchemas=api.drop(next.moduleSchemas,'orders');
  assert.deepEqual(next.moduleSchemas,{});assert.equal(f.read({manifest:next}),null);
  const retained=api.retainCurrent(next,{...next,moduleSchemas:f.manifest.moduleSchemas},f.context.ownerId);assert.deepEqual(retained,{});
});
test('per-module drop preserves only valid other-module metadata',()=>{
  const orders=fixture(),cp=fixture('cp'),catalog={...orders.manifest.moduleSchemas,...cp.manifest.moduleSchemas};
  assert.deepEqual(Object.keys(api.drop(catalog,'orders')),['cp']);assert.deepEqual(Object.keys(api.drop(catalog,'cp')),['orders']);
});
test('single-flight metadata key distinguishes known, unknown and changed-schema preparations',()=>{
  const f=fixture(),known=api.preparedKey(f.prepared);assert.notEqual(known,api.preparedKey({}));
  const changed=copy(f.prepared);changed.orders.schema.modelColumns[0].label='new definition';changed.orders.schemaChecksum=hash(JSON.stringify(changed.orders.schema));
  assert.notEqual(known,api.preparedKey(changed));
});
