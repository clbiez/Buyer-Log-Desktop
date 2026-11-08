'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const api=require('../public/orders-owned-json'),promotion=require('../public/orders-full-promotion');
const digest=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const reader=options=>api.create({promotionApi:promotion,sha256Bytes:async bytes=>digest(bytes),...options});
function response(text,headers={}){return new Response(text,{status:200,headers:{'Content-Type':'application/json','X-Orders-View-Mode':'full','X-Orders-View-Json-Bytes':String(Buffer.byteLength(text)),...headers}});}
const current=()=>true;
test('owned parser rejects a truncated declared decoded body before returning any row graph',async()=>{
  const text='{"rows":[{"zero":0}]}',res=response(text,{'X-Orders-View-Json-Bytes':String(Buffer.byteLength(text)+1)});
  await assert.rejects(reader().read(res,{current}),{code:'ORDERS_FULL_BYTES'});
});
test('owned parser rejects an unbounded decoded length before admitting or reading the stream',async()=>{
  const res=response('{"rows":[]}',{'X-Orders-View-Json-Bytes':'134217729'});let read=false;
  res.json=async()=>{read=true;return {rows:[]};};
  await assert.rejects(reader().read(res,{current}),{code:'ORDERS_JSON_LENGTH'});assert.equal(read,false);
});
test('owned parser rejects an already aborted request before consuming JSON',async()=>{
  const abort=new AbortController();abort.abort();
  await assert.rejects(reader().read(response('{"rows":[]}'),{current,signal:abort.signal}),e=>e.name==='AbortError');
});
test('one owned parse preserves exact row values, insertion order, own __proto__ and sparse keys',async()=>{
  const text='{"rows":[{"__proto__":{"safe":true},"zero":0,"no":false,"nil":null},{"empty":""}],"extra":0}';
  const res=response(text),r=reader();res.json=()=>assert.fail('must not create a second JSON graph with response.json');res.text=()=>assert.fail('must not use an unbounded response.text');
  const got=await r.read(res,{current});assert.equal(got.rawText,text);assert.equal(got.rawSha256,digest(Buffer.from(text)));
  assert.equal(got.decodedBytes,Buffer.byteLength(text));assert.equal(got.mode,'full');assert.ok(Object.isFrozen(got));
  assert.equal(JSON.stringify(got.payload),text);assert.equal(Object.hasOwn(got.payload.rows[0],'__proto__'),true);assert.equal({}.safe,undefined);
  assert.deepEqual(Object.keys(got.payload.rows[1]),['empty']);assert.equal(r.owns(got),true);
  assert.equal(r.owns({...got}),false);assert.equal(reader().owns(got),false);assert.equal(r.owns(null),false);
});
test('ready mode and exact UTF-8 byte lengths are distinct from string length or compressed Content-Length',async()=>{
  const text='{"profile":"orders-ready-model-v1","rows":[{"label":"İş 🎨"}]}';
  const got=await reader().read(response(text,{'X-Orders-View-Mode':'ready','Content-Length':'9'}),{current});
  assert.equal(got.decodedBytes,Buffer.byteLength(text));assert.notEqual(got.decodedBytes,text.length);assert.equal(got.mode,'ready');
});
test('ordinary certified full response may use its existing decoded full length header',async()=>{
  const text='{"rows":[]}',res=response(text);res.headers.delete('X-Orders-View-Json-Bytes');res.headers.set('X-Orders-Full-Json-Bytes',String(Buffer.byteLength(text)));
  assert.equal((await reader().read(res,{current})).rawText,text);
});
test('missing, noncanonical, negative, fractional and oversized length claims never fall back to Content-Length',async()=>{
  for(const claim of [null,'0','-1','01','1.2','1e3','Infinity','134217729']){
    const res=response('{"rows":[]}');if(claim===null)res.headers.delete('X-Orders-View-Json-Bytes');else res.headers.set('X-Orders-View-Json-Bytes',claim);
    res.headers.set('Content-Length','11');let read=false;const original=res.body.getReader.bind(res.body);res.body.getReader=(...args)=>{read=true;return original(...args);};
    await assert.rejects(reader().read(res,{current}),{code:'ORDERS_JSON_LENGTH'});assert.equal(read,false);
  }
});
test('a lower admitted byte budget is enforced before allocating the full declared body',async()=>{
  await assert.rejects(reader({maxDecodedBytes:5}).read(response('{"rows":[]}'),{current}),{code:'ORDERS_JSON_LENGTH'});
});
test('a stream longer than its exact decoded claim is rejected',async()=>{
  await assert.rejects(reader().read(response('{"rows":[]}',{'X-Orders-View-Json-Bytes':'5'}),{current}),{code:'ORDERS_FULL_BYTES'});
});
test('abort during hash cannot return an owned parsed graph',async()=>{
  const control=new AbortController(),r=reader({sha256Bytes:async bytes=>{control.abort();return digest(bytes);}});
  await assert.rejects(r.read(response('{"rows":[]}'),{current,signal:control.signal}),e=>e.name==='AbortError');
});
test('abort of a pending real stream cancels the reader and does not parse a partial body',async()=>{
  const control=new AbortController();let started,cancelled=0;
  const began=new Promise(resolve=>{started=resolve;});
  const stream=new ReadableStream({pull(){started();},cancel(){cancelled++;}});
  const res=response('{"rows":[]}'),pending=reader().read(new Response(stream,{headers:res.headers}),{current,signal:control.signal});
  await began;control.abort();await assert.rejects(pending,e=>e.name==='AbortError');assert.equal(cancelled,1);
});
test('source retirement during digest rejects even if the response bytes themselves are valid',async()=>{
  let live=true;const r=reader({sha256Bytes:async bytes=>{live=false;return digest(bytes);}});
  await assert.rejects(r.read(response('{"rows":[]}'),{current:()=>live}),{code:'ORDERS_FULL_STALE'});
});
test('current guard must synchronously prove true; rejected thenables are drained, never treated as permission',async()=>{
  for(const guard of [undefined,()=>Promise.reject(Error('synthetic guard rejection')),()=>Promise.resolve(true)])
    await assert.rejects(reader().read(response('{"rows":[]}'),{current:guard}),{code:'ORDERS_JSON_GUARD'});
  for(const value of [false,undefined,1,'yes'])await assert.rejects(reader().read(response('{"rows":[]}'),{current:()=>value}),{code:'ORDERS_FULL_STALE'});
  await new Promise(setImmediate);
});
test('invalid JSON, invalid UTF-8, wrong envelope and too many rows fail closed',async()=>{
  await assert.rejects(reader().read(response('{"rows":['),{current}),{code:'ORDERS_JSON_SYNTAX'});
  const raw=Uint8Array.from([123,34,114,111,119,115,34,58,91,93,44,34,120,34,58,34,255,34,125]);
  const res=response('x');res.headers.set('X-Orders-View-Json-Bytes',String(raw.byteLength));
  await assert.rejects(reader().read(new Response(raw,{headers:res.headers}),{current}),{code:'ORDERS_JSON_UTF8'});
  for(const value of ['[]','null','{"orders":[]}','{"rows":{}}','{"rows":[{},{}]}'])
    await assert.rejects(reader({maxRows:1}).read(response(value),{current}),{code:'ORDERS_JSON_PAYLOAD'});
});
test('full and ready profile markers cannot be interchanged',async()=>{
  for(const value of ['{"profile":"full","rows":[]}','{"projection":{},"rows":[]}'])
    await assert.rejects(reader().read(response(value),{current}),{code:'ORDERS_JSON_MODE'});
  await assert.rejects(reader().read(response('{"rows":[]}',{'X-Orders-View-Mode':'ready'}),{current}),{code:'ORDERS_JSON_MODE'});
  await assert.rejects(reader().read(response('{"rows":[]}',{'X-Orders-View-Mode':'unknown'}),{current}),{code:'ORDERS_JSON_MODE'});
});
test('HTTP status, MIME type, native stream and digest are required independently',async()=>{
  await assert.rejects(reader().read(new Response('{}',{status:409}),{current}),{code:'ORDERS_JSON_RESPONSE'});
  await assert.rejects(reader().read(response('{"rows":[]}',{'Content-Type':'text/html'}),{current}),{code:'ORDERS_JSON_CONTENT_TYPE'});
  const res=response('{"rows":[]}');Object.defineProperty(res,'body',{value:null});await assert.rejects(reader().read(res,{current}),{code:'ORDERS_FULL_STREAM'});
  await assert.rejects(reader({sha256Bytes:async()=> 'gzip-is-not-raw-json'}).read(response('{"rows":[]}'),{current}),{code:'ORDERS_JSON_DIGEST'});
});
test('the same native reader may serve independent concurrent receipts without sharing row graphs',async()=>{
  const r=reader(),[a,b]=await Promise.all([r.read(response('{"rows":[{"id":0}]}'),{current}),r.read(response('{"rows":[{"id":0}]}'),{current})]);
  assert.equal(r.owns(a),true);assert.equal(r.owns(b),true);assert.notEqual(a.payload.rows,b.payload.rows);assert.notEqual(a.payload.rows[0],b.payload.rows[0]);
});
test('runtime callbacks and budget options are validated without changing shared promotion limits',()=>{
  for(const options of [{},{promotionApi:promotion},{promotionApi:{},sha256Bytes:digest}])assert.throws(()=>api.create(options),{code:'ORDERS_JSON_RUNTIME'});
  for(const options of [{maxDecodedBytes:0},{maxDecodedBytes:134217729},{maxRows:0},{maxRows:50001}])assert.throws(()=>reader(options),{code:'ORDERS_JSON_LIMIT'});
  assert.equal(promotion.LIMITS.maxFullBytes,134217728);assert.equal(promotion.LIMITS.maxRows,50000);
});
test('classic browser export works without Node globals and uses the same actual native reader',async()=>{
  const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),scope={TextDecoder,Uint8Array};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../public/orders-owned-json.js'),'utf8'),scope);
  const r=scope.BLOrdersOwnedJson.create({promotionApi:promotion,sha256Bytes:async bytes=>digest(bytes)});
  const got=await r.read(response('{"rows":[{"v":false}]}'),{current});assert.equal(JSON.stringify(got.payload),'{"rows":[{"v":false}]}');assert.equal(r.owns(got),true);
});
