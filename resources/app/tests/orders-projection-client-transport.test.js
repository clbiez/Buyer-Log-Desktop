'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {APP,PACKET,candidate,promotion,fixture,hash,headers,hostFunction,actual,schemaApi}=require('./fixtures/orders-projection-client/runtime.cjs');

async function parentFixture(overrides={}){
  const f=await fixture(),t=f.metadata.token;
  const source=fs.readFileSync(path.join(APP,'server/lib/orders-ready-http.js'),'utf8');
  const extra=hostFunction('fullParentHeaders',{Buffer,stale:()=>Error('stale')},source)(t,
    {pin:{uncompressedBytes:Buffer.byteLength(f.rawText)},schema:{rowCount:f.metadata.schema.rowCount}});
  const live={token:t,fullGzipChecksum:f.h['X-Orders-Full-Gzip-Sha256'],guardStamp:f.metadata.guardStamp,
    sessionId:'session',planHash:'plan',pageContextSha256:f.h['X-Orders-Page-Context-Sha256'],
    broadContextSha256:f.h['X-Orders-Broad-Context-Sha256'],nonce:()=> 'parent_nonce',assertCurrent(){}};
  const expected={ownerId:t.ownerId,sessionId:live.sessionId,sourceId:t.sourceProjectionKey,generation:t.sourceGeneration,
    accessHash:t.accessHash,scopeHash:live.guardStamp,module:'orders',planHash:live.planHash,
    fullProjectionChecksum:hash(f.rawText),fullByteLength:Buffer.byteLength(f.rawText),rowCount:2};
  const responseHeaders=headers(f.h,{...extra,'X-Orders-View-Mode':'full','X-Orders-Request-Nonce':'parent_nonce'});
  const options={promotionApi:promotion,sha256Bytes:async bytes=>hash(bytes),live:()=>live,
    fetch:async()=>new Response(Buffer.from(f.rawText),{headers:responseHeaders}),...overrides};
  return {...f,live,expected,responseHeaders,options,fetchFull:()=>candidate.createFetchFull(options)};
}

test('all original 31 algorithms/assertions and historical receipts remain exact except the reviewed router pin',()=>{
  const original=fs.readFileSync(path.join(PACKET,'tests/orders-projection-client.test.cjs'),'utf8');
  const adopted=fs.readFileSync(path.join(APP,'tests/orders-projection-client.test.js'),'utf8');
  const marker="test('uninitialized";
  const current='21bcb5534f8f5cfa8216ac38661b4b8635cadf0ffda1cba524f77411a138046e';
  const previous='c6caf8daa7bb876976ae13b43186153042a42843ac3c7aa88da559d5cf2e0d01';
  const bodies=adopted.slice(adopted.indexOf(marker));assert.equal(bodies.split(current).length,2,'exactly one reviewed provenance literal');
  assert.equal(bodies.replace(current,previous),original.slice(original.indexOf(marker)));
  const evidence=path.resolve(PACKET,'../root-native-evidence');
  for(const [name,pass,fail] of [['first',30,1],['green',31,0]]){
    const root=path.join(evidence,'buyerlog-phase6a-orders-client-native-'+name);
    const receipt=JSON.parse(fs.readFileSync(path.join(root,'receipt.json')));
    assert.equal(hash(fs.readFileSync(path.join(root,'native.tap'))),receipt.sha256);
    assert.equal(receipt.counts.pass,pass);assert.equal(receipt.counts.fail,fail);
  }
});
test('actual full-parent header/identity/plan producers are byte-exact across the ordinary binding addition',()=>{
  const old=require('node:zlib').gunzipSync(fs.readFileSync(path.join(__dirname,'fixtures/orders-projection-client/router-before-ordinary-binding.js.gz'))).toString('utf8');
  assert.equal(hash(old),'c6caf8daa7bb876976ae13b43186153042a42843ac3c7aa88da559d5cf2e0d01');
  const current=fs.readFileSync(path.join(APP,'server/lib/orders-ready-http.js'),'utf8');
  assert.equal(hash(current),'21bcb5534f8f5cfa8216ac38661b4b8635cadf0ffda1cba524f77411a138046e');
  const {extractFunction}=require('./helpers/app-main-functions');
  for(const name of ['fullParentHeaders','responseIdentityHeaders','planHashFor'])assert.equal(extractFunction(current,name),extractFunction(old,name),name);
});

test('classic browser export and full-parent transport work without Node globals',async()=>{
  const scope={TextEncoder,btoa};
  vm.runInNewContext(fs.readFileSync(path.join(APP,'public/orders-projection-client.js'),'utf8'),scope);
  assert.deepEqual(Object.keys(scope.BLOrdersProjectionClient),Object.keys(candidate));
  const f=await parentFixture();
  const response=await scope.BLOrdersProjectionClient.createFetchFull(f.options)(f.expected,{maxDecodedBytes:f.expected.fullByteLength});
  assert.equal(JSON.stringify(response.identity),JSON.stringify(f.expected));
  assert.equal(hash(response.bytes),f.expected.fullProjectionChecksum);
});

test('accept preserves exact retained values, own presence, insertion order and references',async()=>{
  const f=await fixture();await f.initialize();const wire=await f.ready();
  const original=JSON.stringify(wire.payload),rows=wire.payload.rows;
  const result=await f.client.accept(wire.request,wire);
  assert.strictEqual(result.payload,wire.payload);assert.strictEqual(result.payload.rows,rows);
  assert.equal(JSON.stringify(result.payload),original);
  rows.forEach((row,index)=>{
    const full=f.f.full.rows[index],omitted=wire.request.body.omittedModelKeys;
    assert.deepEqual(Object.keys(row),Object.keys(full).filter(key=>!omitted.includes(key)));
    for(const key of Object.keys(row))assert.deepEqual(row[key],full[key]);
  });
  assert.equal(Object.hasOwn(rows[0],'__proto__'),true);
});

test('ready rejects missing retained union, omitted keys, accessors and unowned requests',async()=>{
  for(const mutate of [w=>w.payload.rows.forEach(row=>delete row.empty),
    w=>{w.payload.rows[0][w.request.body.omittedModelKeys[0]]=0;},
    w=>Object.defineProperty(w.payload.rows[0],'trap',{enumerable:true,get(){throw Error('getter invoked');}})]){
    const f=await fixture();await f.initialize();const wire=await f.ready();mutate(wire);
    await assert.rejects(f.client.accept(wire.request,wire),e=>['MISSING_RETAINED_RAW_KEY','LATE_OR_OMITTED_RAW_KEY','UNKNOWN_CAPTURE'].includes(e.code));
  }
  const f=await fixture();await f.initialize();const wire=await f.ready();
  await assert.rejects(f.client.accept({...wire.request},wire),{code:'UNOWNED_REQUEST'});
});

test('root-supplied hidden extra demand is retained and unknown capture stays full',async()=>{
  const f=await fixture();let unknown=false;
  const client=candidate.create({finiteApi:actual.api,compiler:f.f.compiler,schemaApi,formulaColumns:f.f.formula,
    readCurrent:()=>{if(unknown)throw Error('unknown group configuration');return {...f.capture(),operationKeys:['__CPX_UNUSED']};},
    settleOnFull:async()=>{},sha256:async value=>hash(value)});
  assert.equal((await client.initializeFull({metadata:f.metadata,afterMetadata:actual.clone(f.metadata),headers:headers(f.h),
    fullWire:f.f.full,rawText:f.rawText})).mode,'full-initialized');
  const request=await client.prepare(f.metadata,'extra');assert.equal(request.mode,'ready');
  assert.equal(request.body.omittedModelKeys.includes('__CPX_UNUSED'),false);
  unknown=true;assert.equal((await client.prepare(f.metadata,'again')).mode,'full');
});

test('every parent identity mismatch cancels before decoded read; 409 never retries',async()=>{
  const changes={'X-Orders-Binding-Version':'2','X-Orders-Actor-B64':'b3RoZXI','X-Orders-Owner-B64':'b3RoZXI',
    'X-Orders-Access-Hash':'0'.repeat(64),'X-Orders-Page-Context-Sha256':'0'.repeat(64),
    'X-Orders-Broad-Context-Sha256':'0'.repeat(64),'X-Orders-Guard-Sha256':'0'.repeat(64),
    'X-Orders-Cache-Generation':'other','X-Orders-Full-Gzip-Sha256':'0'.repeat(64),
    'X-Orders-Source-Projection-Key-B64':'b3RoZXI','X-Orders-Module-Input-Key-B64':'b3RoZXI',
    'X-Orders-Source-Revision':'other','X-Orders-Full-Json-Bytes':'1','X-Orders-Full-Row-Count':'1',
    'X-Orders-View-Mode':'ready','X-Orders-Request-Nonce':'other'};
  const f=await parentFixture();
  for(const [key,value] of [...Object.entries(changes),[null,null]]){
    let reads=0,cancels=0,calls=0;
    const h=new Headers(f.responseHeaders);if(key)h.set(key,value);
    const adapter=candidate.createFetchFull({...f.options,
      promotionApi:{readDecodedBytes(){reads++;throw Error('must not read');}},
      fetch:async()=>{calls++;return {ok:!!key,status:key?200:409,headers:h,body:{cancel(){cancels++;}}};}});
    await assert.rejects(adapter(f.expected,{maxDecodedBytes:f.expected.fullByteLength}));
    assert.equal(reads,0,key);assert.equal(calls,1,key);assert.equal(cancels,1,key);
  }
});

test('parent stream rejects oversized, truncated and aborted decoded bodies',async()=>{
  const f=await parentFixture(),bytes=Buffer.from(f.rawText);
  for(const body of [bytes.subarray(1),Buffer.concat([bytes,Buffer.from('x')])]){
    const adapter=candidate.createFetchFull({...f.options,fetch:async()=>new Response(body,{headers:f.responseHeaders})});
    await assert.rejects(adapter(f.expected,{maxDecodedBytes:bytes.length}),{code:'ORDERS_FULL_BYTES'});
  }
  let cancel=0;
  const controller=new AbortController();
  const stream=new ReadableStream({pull(){controller.abort();},cancel(){cancel++;}});
  const adapter=candidate.createFetchFull({...f.options,fetch:async()=>new Response(stream,{headers:f.responseHeaders})});
  await assert.rejects(adapter(f.expected,{maxDecodedBytes:bytes.length,signal:controller.signal}),{code:'ORDERS_FULL_ABORTED'});
  assert.equal(cancel,1);
});

test('abort during hash cannot return a successful parent receipt',async()=>{
  const controller=new AbortController(),f=await parentFixture();
  const adapter=candidate.createFetchFull({...f.options,sha256Bytes:async bytes=>{controller.abort();return hash(bytes);}});
  await assert.rejects(adapter(f.expected,{maxDecodedBytes:f.expected.fullByteLength,signal:controller.signal}),{code:'ORDERS_FULL_ABORTED'});
});

test('independent raw-byte hash never borrows expected digest or gzip checksum',async()=>{
  const f=await parentFixture(),forged={...f.expected,fullProjectionChecksum:'0'.repeat(64)};
  const response=await f.fetchFull()(forged,{maxDecodedBytes:f.expected.fullByteLength});
  assert.equal(response.identity.fullProjectionChecksum,hash(response.bytes));
  assert.notEqual(response.identity.fullProjectionChecksum,forged.fullProjectionChecksum);
  assert.notEqual(response.identity.fullProjectionChecksum,f.live.fullGzipChecksum);
  let state={kind:'thin',rows:f.f.full.rows,selectedRows:[f.f.full.rows[1]],mutationRevision:0,selectionRevision:0,
    dirty:false,identity:forged,requiredKeys:[],ordinals:[0,1]};
  const controller=promotion.create({snapshot:()=>state,fetchFull:f.fetchFull(),normalize:async rows=>({rows,ordinals:[0,1]}),
    publish(){throw Error('must not publish');},isCurrent:()=>true});
  await assert.rejects(controller.ensure(),{code:'ORDERS_FULL_IDENTITY'});
});

test('adapter plus actual promotion restores full rows and duplicate-ID selection by ordinal',async()=>{
  const f=await parentFixture();await f.initialize();const wire=await f.ready();await f.client.accept(wire.request,wire);
  let state={kind:'thin',rows:wire.payload.rows,selectedRows:[wire.payload.rows[1]],mutationRevision:0,selectionRevision:0,
    dirty:false,identity:f.expected,requiredKeys:[],ordinals:[0,1]};
  const selected=state.selectedRows[0];
  const controller=promotion.create({snapshot:()=>state,fetchFull:f.fetchFull(),normalize:async rows=>({rows,ordinals:[0,1]}),
    publish:(next,{expected,assertCurrent})=>{assert.strictEqual(state,expected);assertCurrent();return state=next;},isCurrent:()=>true});
  const result=await controller.ensure();
  assert.equal(JSON.stringify(result.rows),JSON.stringify(f.f.full.rows));
  assert.strictEqual(result.selectedRows[0],result.rows[1]);assert.strictEqual(result.remapRows([selected])[0],result.rows[1]);
  result.assertCurrent();
});
