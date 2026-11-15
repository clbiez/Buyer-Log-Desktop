'use strict';
// Not kaydı yavaşlığı: sunucu, kalıcı override yazımından sonra sayfa
// projeksiyon önbelleğinin (tüm modüller gunzip → dönüştür → gzip) yeniden
// yazılmasını yanıt vermeden önce bekliyordu. Kayıt onayı artık bu işi
// beklemez; tutarlılık için önbellek okumaları bekleyen yeniden yazımı bekler.
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');

const ROOT=path.join(__dirname,'..');
const cacheRoot=fs.mkdtempSync(path.join(os.tmpdir(),'buyerlog-note-rewrite-'));
process.env.BUYER_LOG_LOCAL_DATA_ROOT=cacheRoot;
const pageCache=require('../server/lib/page-projection-cache');
const SERVER=fs.readFileSync(path.join(ROOT,'server','server.js'),'utf8');
test.after(()=>fs.rmSync(cacheRoot,{recursive:true,force:true}));

test('a projection read issued while a row rewrite is pending returns the rewritten generation',async()=>{
  await pageCache.writeGeneration('note-user',{contextHash:'before',projections:{cp:{rows:[{'Order Code':1,Notes:'old'}]}}});
  let release;const gate=new Promise(resolve=>{release=resolve;});
  const rewrite=pageCache.rewriteGeneration('note-user',{fromContextHash:'before',toContextHash:'after',transform:async(module,payload)=>{
    await gate;if(module==='cp')payload.rows[0].Notes='new';return payload;
  }});
  const read=pageCache.readProjection('note-user','cp','after');
  release();
  const [result]=await Promise.all([read,rewrite]);
  assert.ok(result,'pending rewrite must not turn a fresh read into a cache miss');
  assert.equal(result.data.rows[0].Notes,'new');
  // Other users are not blocked by this user's rewrite.
  assert.equal(await pageCache.readProjection('someone-else','cp','after'),null);
});

test('override write endpoints acknowledge without awaiting the projection cache rewrite',()=>{
  assert.doesNotMatch(SERVER,/await rewriteProjectionCacheForRowPatches\(/);
  for(const route of ["app.post('/api/overrides/batch'","app.patch('/api/overrides/:orderCode'","app.post('/api/overrides/batch-suppfob'"]){
    const start=SERVER.indexOf(route);assert.ok(start>=0,route);
    const body=SERVER.slice(start,SERVER.indexOf('\napp.',start+10));
    assert.match(body,/queueProjectionCacheRowPatches\(/,route);
  }
});
