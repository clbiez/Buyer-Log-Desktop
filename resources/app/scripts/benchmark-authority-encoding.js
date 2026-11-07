'use strict';
// Sadece üretilmiş yetki girdisi; dosya, kullanıcı deposu veya credential okunmaz.
const {performance}=require('node:perf_hooks'),v8=require('node:v8'),crypto=require('node:crypto');
const mode=process.argv[2];if(!['before','after'].includes(mode))throw Error('Expected before or after');
const authority=Object.fromEntries(Array.from({length:30000},(_,i)=>[String(i+100000),[{buyer:'Demo Buyer '+i%8,merch:'MAG '+i%4,ageGroup:'MMYG '+i%6,buyerGrup:'BG '+i%9}]]));
(async()=>{
 const start=performance.now();let bytes,workMs,maxSliceMs,chunks,decode;
 if(mode==='before'){
  bytes=Uint8Array.from(v8.serialize(authority)).buffer;workMs=performance.now()-start;maxSliceMs=workMs;chunks=1;decode=bytes=>v8.deserialize(Buffer.from(bytes));
 }else{
  const codec=require('../server/lib/compute-authority-codec'),result=await codec.encodeAuthority(authority);
  ({bytes}=result);workMs=result.paramsSerializeMs;maxSliceMs=result.maxSerializeSliceMs;chunks=result.paramsChunks;decode=codec.decodeAuthority;
 }
 const elapsedMs=performance.now()-start,hash=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
 const expected=hash(authority),actual=hash(decode(bytes));if(actual!==expected)throw Error('Authority encoding changed the canonical digest');
 process.stdout.write(JSON.stringify({synthetic:true,mode,rows:30000,node:process.version,platform:process.platform,elapsedMs,workMs,maxSliceMs,chunks,bytes:bytes.byteLength,sha256:actual})+'\n');
})().catch(error=>{process.stderr.write(error.stack+'\n');process.exitCode=1;});
