'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),zlib=require('node:zlib');
const {readyFixture,sha,clone}=require('./helpers/projection-ready-descriptor-fixture');

test('actual ready-json-builder info persists separately from exact registry keys and body checksum',async t=>{
 const f=await readyFixture(t),before=f.manifest(),meta=await f.write(f.p,f.e);assert.ok(meta,'descriptor write is supported');
 const hit=await f.read(f.p,{requireInfo:true});assert.ok(hit);assert.deepEqual(hit.info,f.result.info);
 assert.deepEqual(hit.meta.registryKeys,f.result.registryKeys);assert.deepEqual(hit.registryKeys,undefined);
 assert.deepEqual(JSON.parse(zlib.gunzipSync(hit.buffer)).projection,hit.info);
 assert.equal(hit.meta.checksum,sha(f.result.buffer));assert.equal(hit.meta.infoChecksum,hit.infoChecksum);assert.match(hit.infoChecksum,/^[a-f0-9]{64}$/);
 assert.equal(f.manifest().activeGeneration,before.activeGeneration);assert.deepEqual(f.manifest().modules,before.modules);
});

test('legacy entry remains readable, but descriptor-required read cannot receive missing info',async t=>{
 const f=await readyFixture(t),{info,...legacy}=f.e;assert.ok(await f.write(f.p,legacy));assert.ok(await f.read(f.p));
 assert.equal(await f.read(f.p,{requireInfo:true}),null);
 assert.equal(await f.read(f.p,{infoChecksum:sha('expected descriptor')}),null);
});

test('caller mutations after enqueue and after read cannot modify cached JSON descriptor',async t=>{
 const f=await readyFixture(t),input=clone(f.e.info),expected=clone(input),entry={...f.e,info:input};
 const pending=f.write(f.p,entry);input.viewInfo.actorId='mutated';input.schema.modelColumns[0].sourceMetadata.zero=999;
 const meta=await pending;assert.ok(meta);assert.deepEqual(meta.info,expected);assert.notStrictEqual(meta.info,input);
 const hit=await f.read(f.p,{requireInfo:true});assert.ok(hit);assert.notStrictEqual(hit.info,hit.meta.info);
 hit.info.viewInfo.actorId='read-mutated';hit.meta.info.schema.modelColumns[0].sourceMetadata.flag='changed';
 hit.manifest.derivedViews.orders[f.p.planHash].info.omittedKeys.push('not real');
 const again=await f.read(f.p,{requireInfo:true});assert.ok(again);assert.deepEqual(again.info,expected);
});

test('ordered JSON info has stable identity bound to exact pins and compressed bytes',async t=>{
 const f=await readyFixture(t),first=await f.write(f.p,f.e);assert.ok(first);
 const same=await f.write(f.p,{...f.e,info:clone(f.e.info)});assert.ok(same);assert.equal(same.infoChecksum,first.infoChecksum);
 const otherPin={...f.p,planHash:sha('other certified plan')},other=await f.write(otherPin,f.e);assert.ok(other);
 assert.notEqual(other.infoChecksum,first.infoChecksum);
 assert.ok(await f.read(f.p,{infoChecksum:first.infoChecksum}));assert.equal(await f.read(f.p,{infoChecksum:other.infoChecksum}),null);
});

test('raw model definitions retain own-key order and0/false/null/__proto__/constructor through detached metadata',async t=>{
 const f=await readyFixture(t);assert.ok(await f.write(f.p,f.e));const hit=await f.read(f.p,{requireInfo:true});assert.ok(hit);
 assert.equal(JSON.stringify(hit.info),JSON.stringify(f.e.info));const definition=hit.info.schema.modelColumns[0];
 assert.deepEqual(Object.keys(definition),Object.keys(f.e.info.schema.modelColumns[0]));assert.equal(definition.percentageScale,0);
 assert.deepEqual(definition.sourceMetadata,{zero:0,flag:false,nil:null});assert.ok(Object.hasOwn(definition,'__proto__'));
 assert.deepEqual(definition.__proto__,{own:true});assert.equal(definition.constructor,'raw');assert.equal(Object.hasOwn(hit.info.viewInfo,'requestNonce'),false);
});

test('undefined/nonfinite/Date/function/symbol/sparse/cyclic/nonplain/accessor/Proxy info fails before publish',async t=>{
 const f=await readyFixture(t),before=fs.readFileSync(f.cache.manifestPath(f.owner));let invoked=0;
 const variants=[{x:undefined},{x:NaN},{x:new Date(0)},{x:()=>1},{x:Symbol('x')},{x:[,1]},Object.assign(Object.create({inherited:true}),{x:0})];
 const cycle={};cycle.self=cycle;variants.push(cycle);
 const getter={};Object.defineProperty(getter,'x',{enumerable:true,get(){invoked++;return 1;}});variants.push(getter);
 const hook={toJSON(){invoked++;return{};}};variants.push(hook);
 variants.push(new Proxy({x:1},{ownKeys(){invoked++;throw Error('must not invoke');}}));
 for(const info of variants)assert.equal(await f.write(f.p,{...f.e,info}),null);
 assert.equal(invoked,0);assert.deepEqual(fs.readFileSync(f.cache.manifestPath(f.owner)),before);
});

test('64KiB metadata and caller-lowered catalogue bound include descriptor bytes',async t=>{
 const f=await readyFixture(t),before=fs.readFileSync(f.cache.manifestPath(f.owner));
 assert.equal(await f.write(f.p,{...f.e,info:{text:'x'.repeat(65536)}}),null);
 assert.equal(await f.write(f.p,f.e,{limits:{maxMetadataBytes:32}}),null);
 assert.deepEqual(fs.readFileSync(f.cache.manifestPath(f.owner)),before);
 const stored=await f.write(f.p,f.e);assert.ok(stored);
 assert.ok(Buffer.byteLength(JSON.stringify(f.manifest().derivedViews.orders))<=65536);
});

test('swapped/missing/corrupted descriptor checksum or payload fails closed without full-source mutation',async t=>{
 const mutations=[m=>{delete m.info;},m=>{delete m.infoChecksum;},m=>{delete m.info;delete m.infoChecksum;},m=>{m.info.viewInfo.actorId='wrong';},m=>{m.infoChecksum=sha('corrupt');},
  m=>{m.info.viewInfo.sourceGeneration='stale';},m=>{m.checksum=sha('different wire');}];
 for(const mutate of mutations){const f=await readyFixture(t);assert.ok(await f.write(f.p,f.e));const fullChecksum=f.manifest().modules.orders.checksum;
  f.patch(m=>mutate(m.derivedViews.orders[f.p.planHash]));assert.equal(await f.read(f.p,{requireInfo:true}),null);
  assert.equal(f.manifest().modules.orders.checksum,fullChecksum);}
});

test('descriptor from another plan cannot be copied under an otherwise matching view',async t=>{
 const f=await readyFixture(t),a=await f.write(f.p,f.e);assert.ok(a);const q={...f.p,planHash:sha('plan2')};assert.ok(await f.write(q,f.e));
 f.patch(m=>{m.derivedViews.orders[q.planHash].infoChecksum=a.infoChecksum;});assert.equal(await f.read(q,{requireInfo:true}),null);
});

test('generation/full-checksum staleness or corrupt PRIMARY never substitutes old descriptor',async t=>{
 const f=await readyFixture(t);assert.ok(await f.write(f.p,f.e));await f.cache.writeProjection(f.owner,'orders',f.context,{rows:[{new:0}]});
 assert.equal(await f.read(f.p,{requireInfo:true}),null);assert.equal(await f.read(f.pin(),{requireInfo:true}),null);
 const g=await readyFixture(t);assert.ok(await g.write(g.p,g.e));await g.start();assert.equal(await g.read(g.p,{requireInfo:true}),null);
 fs.writeFileSync(g.cache.manifestPath(g.owner),'{partial');assert.equal(await g.read(g.p,{requireInfo:true}),null);
});

test('descriptor file/manifest publication failure cannot expose an uncommitted info identity',async t=>{
 const f=await readyFixture(t),before=fs.readFileSync(f.cache.manifestPath(f.owner));
 f.hooks.set('rename',async(original,from,to)=>{if(to===f.cache.manifestPath(f.owner))throw Error('synthetic manifest fail');return original(from,to);});
 assert.equal(await f.write(f.p,f.e),null);assert.deepEqual(fs.readFileSync(f.cache.manifestPath(f.owner)),before);
 assert.equal(await f.read(f.p,{requireInfo:true}),null);assert.equal(f.files().length,0);
});

test('invalid descriptor read predicates fail closed and cannot be changed while queued',async t=>{
 const f=await readyFixture(t);assert.ok(await f.write(f.p,f.e));
 for(const options of [{requireInfo:'yes'},{infoChecksum:'bad'},{unknown:true}])assert.equal(await f.read(f.p,options),null);
 const options={requireInfo:true,infoChecksum:sha('wrong')},pending=f.read(f.p,options);delete options.infoChecksum;options.requireInfo=false;
 assert.equal(await pending,null);
});
