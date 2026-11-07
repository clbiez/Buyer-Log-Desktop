'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),http=require('node:http'),zlib=require('node:zlib');
const {sendComputedResponse}=require('../server/lib/compute-response');
async function request(port,encoding){return new Promise((resolve,reject)=>{http.get({host:'127.0.0.1',port,path:'/',headers:{'Accept-Encoding':encoding}},res=>{const chunks=[];res.on('data',chunk=>chunks.push(chunk));res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,bytes:Buffer.concat(chunks)}));res.on('error',reject);}).on('error',reject);});}
test('ready gzip and identity clients receive equal JSON; leases end with the real HTTP response',async t=>{
  const raw=Buffer.from(JSON.stringify({rows:[{text:'Synthetic Türkçe',date:'2026-04-05'}]})),gzip=zlib.gzipSync(raw);let releases=0,checks=0;
  const completions=[];
  const server=http.createServer((req,res)=>{completions.push(new Promise(resolve=>res.once('finish',resolve)));sendComputedResponse(req,res,{value:{buffer:Uint8Array.from(gzip).buffer,uncompressedBytes:raw.length},metrics:{queueWaitMs:2,executionMs:3},assertResponse:()=>checks++,release:()=>releases++});});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
  const zipped=await request(server.address().port,'gzip');assert.equal(zipped.status,200);assert.equal(zipped.headers['cache-control'],'no-store');assert.equal(zipped.headers['content-encoding'],'gzip');assert.deepEqual(zlib.gunzipSync(zipped.bytes),raw);
  const identity=await request(server.address().port,'gzip;q=0, identity');assert.equal(identity.headers['content-encoding'],undefined);assert.deepEqual(identity.bytes,raw);assert.equal(Number(identity.headers['content-length']),raw.length);
  await Promise.all(completions);
  assert.equal(releases,2);assert.equal(checks,2);
});
test('a final authorization failure releases bytes and sends none of the completed result',async t=>{
  let released=0;const bytes=Buffer.from('SYNTHETIC_PRIVATE_RESULT');
  const server=http.createServer((req,res)=>{try{sendComputedResponse(req,res,{value:{buffer:Uint8Array.from(bytes).buffer},assertResponse(){throw Object.assign(Error('Denied'),{statusCode:403});},release:()=>released++});}catch(error){res.statusCode=error.statusCode;res.end('Denied');}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
  const response=await request(server.address().port,'gzip');assert.equal(response.status,403);assert.equal(response.bytes.toString(),'Denied');assert.equal(released,1);
});
test('ready Office bytes retain their MIME type and are not treated as gzip JSON',async t=>{
  const bytes=Buffer.from('PK\u0003\u0004Synthetic Office archive');let released=0;
  const server=http.createServer((req,res)=>sendComputedResponse(req,res,{value:{buffer:Uint8Array.from(bytes).buffer},assertResponse(){},release:()=>released++},{contentType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',filename:'Backlog_Report.xlsx',gzip:false}));
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
  const response=await request(server.address().port,'gzip');assert.deepEqual(response.bytes,bytes);assert.equal(response.headers['content-encoding'],undefined);assert.match(response.headers['content-disposition'],/Backlog_Report.xlsx/);assert.equal(released,1);
});
test('a client disconnected before worker completion releases ready bytes without writing response headers',async t=>{
 let started,completed,released=0,headers,error;
 const ready=new Promise(resolve=>started=resolve),done=new Promise(resolve=>completed=resolve);
 const server=http.createServer((req,res)=>{
  res.on('error',()=>{});res.once('close',()=>{
   try{sendComputedResponse(req,res,{value:{buffer:zlib.gzipSync('SYNTHETIC_RESULT')},assertResponse(){},release(){released++;}});headers=res.getHeader('Content-Type');}
   catch(e){error=e;}finally{queueMicrotask(completed);}
  });started();
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
 const client=http.get({host:'127.0.0.1',port:server.address().port,path:'/'},()=>{});client.on('error',()=>{});
 await ready;client.destroy();await done;assert.equal(error,undefined);assert.equal(released,1);assert.equal(headers,undefined);
});
