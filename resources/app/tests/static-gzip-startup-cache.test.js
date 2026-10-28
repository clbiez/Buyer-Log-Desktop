'use strict';
// Every renderer boot requests ~155 compressible startup assets. The gzip LRU
// used to hold 48, so each boot re-read and re-compressed almost all of them,
// even for 304 revalidations that never send a body.
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),zlib=require('node:zlib');
const { createStaticGzip, DEFAULT_MAX_ENTRIES }=require('../server/lib/static-gzip');

function fixture(count){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'bl-static-gzip-'));
  for(let i=0;i<count;i++)fs.writeFileSync(path.join(root,`asset-${i}.js`),`/* ${i} */\n`+'x'.repeat(2048));
  return root;
}
function request(handler,url,headers={}){
  return new Promise((resolve,reject)=>{
    const res={statusCode:200,headers:{},headersSent:false,writableEnded:false,
      setHeader(name,value){this.headers[name.toLowerCase()]=value;},
      end(body){this.writableEnded=true;resolve({status:this.statusCode,headers:this.headers,body});}};
    handler({method:'GET',url,originalUrl:url,headers:{'accept-encoding':'gzip',...headers}},res,()=>resolve({status:'next'})).catch(reject);
  });
}
function countGzip(t){
  const original=zlib.gzip;let calls=0;
  zlib.gzip=function(...args){calls++;return original.apply(this,args);};
  t.after(()=>{zlib.gzip=original;});
  return ()=>calls;
}

test('a renderer boot worth of startup assets stays compressed in memory', async t => {
  const count=160;assert.ok(DEFAULT_MAX_ENTRIES>=count);
  const calls=countGzip(t);
  // createStaticGzip binds util.promisify(zlib.gzip) at module load; reload it.
  delete require.cache[require.resolve('../server/lib/static-gzip')];
  const fresh=require('../server/lib/static-gzip').createStaticGzip(fixture(count));
  for(let i=0;i<count;i++)await request(fresh,`/asset-${i}.js?v=7.0.318`);
  const afterFirstBoot=calls();
  assert.equal(afterFirstBoot,count);
  for(let i=0;i<count;i++){
    const res=await request(fresh,`/asset-${i}.js?v=7.0.318`);
    assert.equal(res.status,200);assert.ok(zlib.gunzipSync(res.body).toString().startsWith(`/* ${i} */`));
  }
  assert.equal(calls(),afterFirstBoot,'second renderer boot must not recompress any asset');
});

test('a matching revalidation is answered 304 from file metadata without compressing', async t => {
  const calls=countGzip(t);
  delete require.cache[require.resolve('../server/lib/static-gzip')];
  const handler=require('../server/lib/static-gzip').createStaticGzip(fixture(1));
  const first=await request(handler,'/asset-0.js');
  const etag=first.headers.etag;assert.match(etag,/^W\/"gz-/);
  const before=calls();
  const res=await request(handler,'/asset-0.js',{'if-none-match':etag});
  assert.equal(res.status,304);assert.equal(res.body,undefined);
  assert.equal(res.headers['content-encoding'],'gzip');
  assert.equal(calls(),before);
});

test('304 after a server restart does not compress the unchanged file', async t => {
  const calls=countGzip(t);
  delete require.cache[require.resolve('../server/lib/static-gzip')];
  const { createStaticGzip:create }=require('../server/lib/static-gzip');
  const root=fixture(1);
  const etag=(await request(create(root),'/asset-0.js')).headers.etag;
  const before=calls();
  const res=await request(create(root),'/asset-0.js',{'if-none-match':etag});
  assert.equal(res.status,304);
  assert.equal(calls(),before,'fresh process must not gzip a file only to answer 304');
});

test('changed file content invalidates the stat ETag', async () => {
  const root=fixture(1),handler=createStaticGzip(root);
  const etag=(await request(handler,'/asset-0.js')).headers.etag;
  fs.writeFileSync(path.join(root,'asset-0.js'),'/* changed */\n'+'y'.repeat(4096));
  const res=await request(handler,'/asset-0.js',{'if-none-match':etag});
  assert.equal(res.status,200);assert.ok(zlib.gunzipSync(res.body).toString().startsWith('/* changed */'));
});
