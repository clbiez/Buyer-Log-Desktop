'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),zlib=require('node:zlib');
const {fixture,sha,clone,deferred}=require('./helpers/projection-view-cache-fixture');

test('actual baseline full-cache generation/read still preserves duplicate IDs,0,false,null and absence',async t=>{
 const f=fixture(t),m=await f.start(),read=await f.cache.readProjection(f.owner,'orders',f.context);
 assert.deepEqual(read.data,f.full);assert.equal(m.modules.orders.checksum,sha(read.buffer));
 assert.deepEqual(Object.keys(read.data.rows[1]),['Order Code','flag']);
});

test('derived single-gzip roundtrip keeps exact bytes,primary generation,full module meta and backup unchanged',async t=>{
 const f=fixture(t);await f.start();await f.start();const before=f.manifest(),backup=fs.readFileSync(f.cache.manifestPath(f.owner)+'.bak');
 const p=f.pin(),e=f.entry(),meta=await f.requireWrite(p,e),hit=await f.read(p);
 assert.deepEqual(f.cache.VIEW_LIMITS,{maxEntries:2,maxCompressedBytes:32*1024*1024,maxRawBytes:128*1024*1024,maxMetadataBytes:64*1024,maxRegistryKeys:512});
 assert.ok(hit);assert.equal(hit.fallback,false);assert.equal(hit.meta.checksum,e.checksum);assert.deepEqual(hit.buffer,e.buffer);
 assert.deepEqual(JSON.parse(zlib.gunzipSync(hit.buffer)),JSON.parse(zlib.gunzipSync(e.buffer)));
 assert.equal(f.manifest().activeGeneration,before.activeGeneration);assert.deepEqual(f.manifest().modules,before.modules);
 assert.deepEqual(fs.readFileSync(f.cache.manifestPath(f.owner)+'.bak'),backup);assert.deepEqual(meta.registryKeys,e.registryKeys);
});

test('every generation/context/input/source/full checksum/revision/plan mismatch is a miss and cannot publish',async t=>{
 const f=fixture(t);await f.start();const p=f.pin();await f.requireWrite(p);const before=fs.readFileSync(f.cache.manifestPath(f.owner));
 for(const key of Object.keys(p)){const bad={...p,[key]:['fullChecksum','planHash'].includes(key)?sha('wrong'):p[key]+'-wrong'};
  assert.equal(await f.read(bad),null,key);
  if(key!=='planHash')assert.equal(await f.write(bad,f.entry()),null,key);}
 assert.deepEqual(fs.readFileSync(f.cache.manifestPath(f.owner)),before);
});

test('PRIMARY only: previous valid derived view never supplies a new generation or missing/corrupt primary',async t=>{
 const f=fixture(t);await f.start();const old=f.pin();await f.requireWrite(old);await f.start();
 assert.equal(await f.read(old),null);assert.equal(await f.read(f.pin()),null);
 const primary=fs.readFileSync(f.cache.manifestPath(f.owner)),active=f.manifest().activeGeneration;
 fs.writeFileSync(f.cache.manifestPath(f.owner),'{partial');assert.equal(await f.read(old),null);
 // Keep the original true assertion: now arrange the real legacy index1 fallback before it.
 fs.writeFileSync(f.cache.manifestPath(f.owner),primary);
 fs.writeFileSync(path.join(f.cache.ROOT,f.owner,active,'orders.json.gz'),'synthetic corrupt CURRENT full gzip');
 assert.equal((await f.cache.readProjection(f.owner,'orders',f.context)).fallback,true,'legacy fallback remains unchanged');
 fs.unlinkSync(f.cache.manifestPath(f.owner));assert.equal(await f.read(old),null);
});

test('same-generation full rewrite changes checksum and invalidates earlier derived metadata naturally',async t=>{
 const f=fixture(t);await f.start();const old=f.pin();await f.requireWrite(old);const generation=old.generation;
 await f.cache.writeProjection(f.owner,'orders',f.context,{rows:[{changed:0}]});
 assert.equal(f.manifest().activeGeneration,generation);assert.notEqual(f.manifest().modules.orders.checksum,old.fullChecksum);
 assert.equal(await f.read(old),null);const current=f.pin();assert.equal(await f.read(current),null);
 await f.requireWrite(current,f.entry('new'));assert.ok(await f.read(current));assert.equal(f.files().length,1);
 assert.deepEqual((await f.cache.readProjection(f.owner,'orders',f.context)).data,{rows:[{changed:0}]});
});

test('rewriteGeneration and new generation never inherit derived views or switch back to an old generation',async t=>{
 const f=fixture(t);await f.start();const old=f.pin();await f.requireWrite(old);
 const rewritten=await f.cache.rewriteGeneration(f.owner,{fromContextHash:f.context,toContextHash:'ctx2',transform:(_m,data)=>data});
 assert.notEqual(rewritten.activeGeneration,old.generation);assert.equal(rewritten.derivedViews,undefined);assert.equal(await f.read(old),null);
 const current=f.manifest().activeGeneration;assert.equal(await f.write(old,f.entry()),null);assert.equal(f.manifest().activeGeneration,current);
});

test('corrupt/missing/truncated derived files return null without altering or rebuilding full source',async t=>{
 for(const mode of ['corrupt','missing','truncate']){const f=fixture(t);await f.start();const p=f.pin();await f.requireWrite(p);await f.read(p);
  const before=f.manifest().modules.orders.checksum,file=f.viewFile();
  if(mode==='missing')fs.unlinkSync(file);else if(mode==='truncate')fs.truncateSync(file,5);else{const b=fs.readFileSync(file);b[12]^=1;fs.writeFileSync(file,b);fs.utimesSync(file,new Date(0),new Date(0));}
  assert.equal(await f.read(p),null,mode);assert.equal(f.manifest().modules.orders.checksum,before);
  assert.deepEqual((await f.cache.readProjection(f.owner,'orders',f.context)).data,f.full);}
});

test('returned LRU buffer is read-only by contract; an accidental mutation is detected,not returned as valid',async t=>{
 const f=fixture(t);await f.start();const p=f.pin(),e=f.entry();await f.requireWrite(p,e);const first=await f.read(p);assert.ok(first);
 first.buffer[10]^=1;assert.equal(await f.read(p),null);assert.deepEqual((await f.read(p)).buffer,e.buffer,'disk can recover next optional read');
});

test('partial temp-file write never publishes derived metadata or changes primary full bytes',async t=>{
 const f=fixture(t);await f.start();const p=f.pin(),before=fs.readFileSync(f.cache.manifestPath(f.owner));
 f.hooks.set('writeFile',async(original,file,data,options)=>original(file,String(file).includes('orders-view-')?data.subarray(0,5):data,options));
 assert.equal(await f.write(p,f.entry()),null);assert.deepEqual(fs.readFileSync(f.cache.manifestPath(f.owner)),before);assert.equal(f.files().length,0);
});

test('new derived rename failure is a miss with no copy fallback; legacy atomicWrite remains untouched',async t=>{
 const f=fixture(t);await f.start();const p=f.pin(),before=fs.readFileSync(f.cache.manifestPath(f.owner));let copies=0;
 f.hooks.set('copyFile',async(original,...args)=>{copies++;return original(...args);});
 f.hooks.set('rename',async(original,from,to)=>{if(String(to).includes('orders-view-'))throw Object.assign(Error('synthetic'),{code:'EACCES'});return original(from,to);});
 assert.equal(await f.write(p,f.entry()),null);assert.equal(copies,0);assert.deepEqual(fs.readFileSync(f.cache.manifestPath(f.owner)),before);
});

test('derived file exists and verifies before manifest patch; manifest failure leaves no published entry',async t=>{
 const f=fixture(t);await f.start();const p=f.pin(),before=fs.readFileSync(f.cache.manifestPath(f.owner));let verifiedFile=false;
 f.hooks.set('rename',async(original,from,to)=>{if(String(to).includes('orders-view-')){const value=await original(from,to);verifiedFile=true;return value;}
  if(to===f.cache.manifestPath(f.owner)){assert.equal(verifiedFile,true);assert.equal(f.files().length,1);throw Error('synthetic manifest rename failure');}return original(from,to);});
 assert.equal(await f.write(p,f.entry()),null);assert.deepEqual(fs.readFileSync(f.cache.manifestPath(f.owner)),before);assert.equal(f.files().length,0);
});

test('pin advance during async write is detected before manifest publication,without rolling it back',async t=>{
 const f=fixture(t);await f.start();const p=f.pin();let advanced=false;
 f.hooks.set('writeFile',async(original,file,...args)=>{const result=await original(file,...args);
  if(!advanced&&String(file).includes('orders-view-')){advanced=true;f.patch(m=>{m.contextHash='new-context';});}return result;});
 assert.equal(await f.write(p,f.entry()),null);assert.equal(advanced,true);assert.equal(f.manifest().contextHash,'new-context');assert.equal(f.manifest().derivedViews,undefined);
});

test('pin advance during derived read is rejected by post-read primary check',async t=>{
 const f=fixture(t);await f.start();const p=f.pin();await f.requireWrite(p);let changed=false;
 f.hooks.set('lstat',async(original,file,...args)=>{const result=await original(file,...args);
  if(String(file).includes('orders-view-')&&!changed){changed=true;f.patch(m=>{m.moduleInputKeys.orders='changed-input';});}return result;});
 assert.equal(await f.read(p),null);assert.equal(changed,true);
});

test('max2 FIFO eviction removes only derived files and keeps already returned read buffers live',async t=>{
 const f=fixture(t);await f.start();const a=f.pin('A'),b=f.pin('B'),c=f.pin('C');await f.requireWrite(a,f.entry('A'));
 const lease=await f.read(a),saved=Buffer.from(lease.buffer);await f.requireWrite(b,f.entry('B'));await f.requireWrite(c,f.entry('C'));
 assert.equal(await f.read(a),null);assert.ok(await f.read(b));assert.ok(await f.read(c));assert.equal(f.files().length,2);
 assert.deepEqual(lease.buffer,saved);assert.equal(JSON.parse(zlib.gunzipSync(lease.buffer)).label,'A');
 assert.deepEqual((await f.cache.readProjection(f.owner,'orders',f.context)).data,f.full);
});

test('aggregate compressed budget and raw/registry/metadata limits are bounded and caller can only lower',async t=>{
 const f=fixture(t);await f.start();const a=f.pin('A'),b=f.pin('B'),e=f.entry();await f.requireWrite(a,e);
 await f.requireWrite(b,f.entry('B'),{limits:{maxCompressedBytes:Math.max(e.bytes,f.entry('B').bytes)+1}});
 assert.equal(await f.read(a),null);assert.ok(await f.read(b));
 const before=fs.readFileSync(f.cache.manifestPath(f.owner));
 for(const limits of [{maxCompressedBytes:e.bytes-1},{maxRawBytes:e.uncompressedBytes-1},{maxRegistryKeys:1},{maxMetadataBytes:20},
  {maxEntries:3},{maxCompressedBytes:32*1024*1024+1},{maxRawBytes:128*1024*1024+1}])assert.equal(await f.write(f.pin('bad'),e,{limits}),null);
 assert.deepEqual(fs.readFileSync(f.cache.manifestPath(f.owner)),before);
});

test('byte/checksum/gzip envelope/registry errors reject before touching the generation',async t=>{
 const f=fixture(t);await f.start();const p=f.pin(),before=fs.readFileSync(f.cache.manifestPath(f.owner));
 const variants=[e=>{e.bytes++;},e=>{e.checksum=sha('wrong');},e=>{e.uncompressedBytes++;},e=>{e.registryKeys.push(e.registryKeys[0]);},
  e=>{e.registryKeys=Array.from({length:513},(_,i)=>'k'+i);},e=>{e.registryKeys=['x'.repeat(513)];},
  e=>{e.registryKeys=Array.from({length:512},(_,i)=>String(i).padStart(4,'0')+'x'.repeat(508));},
  e=>{e.buffer=Buffer.from('invalid gzip bytes!');e.bytes=e.buffer.length;e.checksum=sha(e.buffer);},e=>{e.extra=true;}];
 for(const change of variants){const e=f.entry();change(e);assert.equal(await f.write(p,e),null);}
 assert.deepEqual(fs.readFileSync(f.cache.manifestPath(f.owner)),before);assert.equal(f.files().length,0);
});

test('same-owner derived writes share actual mutation queue with full writeProjection',async t=>{
 const f=fixture(t);await f.start();const p=f.pin(),entered=deferred(),release=deferred();let fullStarted=false;
 f.hooks.set('writeFile',async(original,file,...args)=>{if(String(file).includes('orders-view-')){entered.resolve();await release.promise;}
  if(String(file).includes('orders.json.gz.'))fullStarted=true;return original(file,...args);});
 const derived=f.write(p,f.entry());
 if(typeof f.cache.writeViewCompressed!=='function'){assert.ok(await derived,'legacy cache misses this new optional ready-view behavior');return;}
 await Promise.race([entered.promise,derived.then(()=>assert.fail('derived write must enter queued IO before completing'))]);
 const full=f.cache.writeProjection(f.owner,'orders',f.context,{rows:[{new:true}]});await Promise.resolve();assert.equal(fullStarted,false);
 release.resolve();assert.ok(await derived);await full;assert.equal(fullStarted,true);assert.equal(await f.read(p),null);
});

test('queued full mutation cannot delete/change a file during its derived read; returned buffer outlives generation cleanup',async t=>{
 const f=fixture(t);await f.start();const p=f.pin();await f.requireWrite(p);const entered=deferred(),release=deferred();let fullStarted=false;
 f.hooks.set('readFile',async(original,file,...args)=>{if(String(file).includes('orders-view-')){entered.resolve();await release.promise;}return original(file,...args);});
 // Force readCompressed off its in-memory hit so the actual queued disk read is gated.
 const file=f.viewFile();fs.utimesSync(file,new Date(0),new Date(0));
 f.hooks.set('writeFile',async(original,file,...args)=>{if(String(file).includes('orders.json.gz.'))fullStarted=true;return original(file,...args);});
 const reading=f.read(p);await Promise.race([entered.promise,reading.then(()=>assert.fail('derived read must enter gated disk IO'))]);
 const refresh=f.start();await Promise.resolve();assert.equal(fullStarted,false);
 release.resolve();const lease=await reading;assert.ok(lease);await refresh;await f.start();
 assert.equal(fs.existsSync(file),false);assert.equal(JSON.parse(zlib.gunzipSync(lease.buffer)).label,'view1');
});

test('concurrent derived variants retain both records and queued input buffer/pin/registry mutation cannot alter published bytes',async t=>{
 const f=fixture(t);await f.start();const a=f.pin('A'),b=f.pin('B'),e=f.entry('A'),saved=Buffer.from(e.buffer);
 const pending=f.write(a,e);e.buffer.fill(0);e.registryKeys.push('mutated');a.contextHash='caller-mutated';
 const other=f.write(b,f.entry('B'));assert.ok(await pending);assert.ok(await other);
 const hit=await f.read(f.pin('A'));assert.ok(hit);assert.deepEqual(hit.buffer,saved);assert.equal(hit.meta.registryKeys.includes('mutated'),false);assert.ok(await f.read(b));
});

test('owner/module/path/schema metadata mismatch never chooses another entry; old orphan cleanup leaves canonical files',async t=>{
 const f=fixture(t);await f.start();const p=f.pin();await f.requireWrite(p);
 if(typeof f.cache.readViewCompressed==='function'){
  assert.equal(await f.cache.readViewCompressed('other','orders',p),null);assert.equal(await f.cache.readViewCompressed(f.owner,'cp',p),null);}
 for(const bad of [{...p,generation:'../../escape'},{...p,planHash:'../'+p.planHash},{...p,fullChecksum:'bad'}])assert.equal(await f.read(bad),null);
 const dir=path.dirname(f.viewFile()),sentinel=path.join(dir,'unrelated.json.gz');fs.writeFileSync(sentinel,'do-not-delete');
 const fullFile=path.join(dir,'orders.json.gz'),fullBytes=fs.readFileSync(fullFile);await f.start();await f.requireWrite(f.pin('current'));
 assert.equal(fs.existsSync(sentinel),true);assert.deepEqual(fs.readFileSync(fullFile),fullBytes);
 f.patch(m=>{m.derivedViews.orders[f.pin('current').planHash].schemaVersion=99;});assert.equal(await f.read(f.pin('current')),null);
});
