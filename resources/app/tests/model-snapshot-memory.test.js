'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawnSync}=require('node:child_process');
test('saving a snapshot larger than the V8 heap uses bounded JSON chunks and retains the exact checksum',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'bl-snapshot-memory-'));
  try{
    const script=`
      const assert=require('node:assert/strict'),fs=require('node:fs'),zlib=require('node:zlib'),crypto=require('node:crypto');
      const snapshots=require(${JSON.stringify(path.resolve(__dirname,'../server/lib/model-snapshot'))});
      const text='x'.repeat(16384),rows=Array.from({length:12000},(_,i)=>({ocode:i,model:text,ex:new Date('2026-11-08T00:00:00Z')}));
      (async()=>{
        const saved=await snapshots.saveModelSnapshotAsync('memory',{loadedAt:'memory-test',asasOrders:rows,asasOrdersByTarget:{cp:rows,orders:rows},antrepoMap:{}});
        assert.ok(saved.uncompressedBytes>120*1024*1024);
        const raw=zlib.gunzipSync(fs.readFileSync(saved.file)),marker=Buffer.from('"payload":'),offset=raw.indexOf(marker);
        const header=raw.subarray(0,offset).toString('utf8'),digest=header.match(/"checksum":"([a-f0-9]{64})"/)[1];
        assert.equal(crypto.createHash('sha256').update(raw.subarray(offset+marker.length,-1)).digest('hex'),digest);
        assert.ok(raw.includes(Buffer.from('"cp":"asasOrders"')));assert.equal(saved.aliasCount,2);
        console.log(JSON.stringify({uncompressedBytes:saved.uncompressedBytes,heapLimit:require('node:v8').getHeapStatistics().heap_size_limit}));
      })().catch(error=>{console.error(error);process.exitCode=1;});
    `;
    const env={...process.env,BUYER_LOG_DATA_ROOT:path.join(root,'app'),BUYER_LOG_LOCAL_DATA_ROOT:path.join(root,'local'),BUYER_LOG_SERVER_DATA_ROOT:path.join(root,'server'),BUYER_LOG_TEMP_ROOT:path.join(root,'temp')};
    const result=spawnSync(process.execPath,['--max-old-space-size=96','-e',script],{env,encoding:'utf8',timeout:60000,maxBuffer:1024*1024});
    assert.equal(result.status,0,result.stderr||String(result.error||result.signal));
    const metrics=JSON.parse(result.stdout.trim());assert.ok(metrics.uncompressedBytes>metrics.heapLimit,'fixture must exceed its actual V8 heap limit');
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});
