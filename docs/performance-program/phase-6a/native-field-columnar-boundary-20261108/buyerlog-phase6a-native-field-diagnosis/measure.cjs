'use strict';
const fs=require('node:fs'),path=require('node:path'),zlib=require('node:zlib'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const root='/tmp/buyerlog-first-transition-Hxb1BB',manifestPath=path.join(root,'local/page-cache/moderator/manifest.json');
const marker=JSON.parse(fs.readFileSync(path.join(root,'source/benchmark-fixture.json')));assert.equal(marker.synthetic,true);assert.equal(marker.rows,30000);
const manifest=JSON.parse(fs.readFileSync(manifestPath));const results=[];
for(const module of ['cp','orders']){
 const file=path.join(root,'local/page-cache/moderator',manifest.activeGeneration,module+'.json.gz'),compressed=fs.readFileSync(file),meta=manifest.modules[module];
 assert.equal(crypto.createHash('sha256').update(compressed).digest('hex'),meta.checksum);
 const bytes=zlib.gunzipSync(compressed,{maxOutputLength:128*1024*1024});assert.equal(bytes.length,meta.uncompressedBytes);const payload=JSON.parse(bytes);assert.ok(Array.isArray(payload.rows));
 const fields=new Map();let rowBytes=0;
 for(const row of payload.rows){rowBytes+=Buffer.byteLength(JSON.stringify(row));for(const key of Object.keys(row)){
  let f=fields.get(key);if(!f){f={key,presentRows:0,keyBytes:0,valueBytes:0,memberBytesWithoutSeparator:0};fields.set(key,f);}
  const value=JSON.stringify(row[key]);assert.notEqual(value,undefined);const keySize=Buffer.byteLength(JSON.stringify(key)),valueSize=Buffer.byteLength(value);
  f.presentRows++;f.keyBytes+=keySize;f.valueBytes+=valueSize;f.memberBytesWithoutSeparator+=keySize+1+valueSize;
 }}
 results.push({module,rows:payload.rows.length,sourceGzipSha256:meta.checksum,fullJsonBytes:bytes.length,rowObjectJsonBytes:rowBytes,fields:[...fields.values()].sort((a,b)=>b.memberBytesWithoutSeparator-a.memberBytesWithoutSeparator)});
}
const result={classification:'Source byte attribution only, not omission eligibility, native parser latency or performance gain',synthetic:true,sourceGeneration:manifest.activeGeneration,results};
fs.writeFileSync(path.join(__dirname,'result.json'),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify(results.map(r=>({module:r.module,rows:r.rows,keys:r.fields.length,firstFields:r.fields.slice(0,18)}))));
