'use strict';
// Unstable networks drop the 184 MB update download mid-way. The GitHub provider
// retries transient failures and resumes the same partial file with HTTP Range;
// permanent 4xx answers are not retried, and the network root cause is reported.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {GitHubReleaseProvider}=require('../electron/update/github-provider');
const FULL=Buffer.from('0123456789abcdefghij');

function respond(status,chunks,{headers={},failAfter=false}={}){
  // The connection drops only after the delivered chunks were read, like a real mid-transfer reset.
  const queue=chunks.slice();
  const body=new ReadableStream({pull(c){if(queue.length){c.enqueue(new Uint8Array(queue.shift()));return;}if(failAfter)c.error(Object.assign(new TypeError('terminated'),{cause:{code:'ECONNRESET',message:'socket hang up'}}));else c.close();}});
  const response=new Response(body,{status,headers});
  Object.defineProperty(response,'url',{value:'https://release-assets.githubusercontent.com/x'});
  return response;
}
async function run(script,options={}){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'bl-resume-')),dest=path.join(dir,'u.zip.partial'),calls=[],original=global.fetch;
  global.fetch=async(url,opts)=>{const call={url,range:opts.headers.Range||null};calls.push(call);return script(call,calls.length);};
  try{
    const provider=new GitHubReleaseProvider('github:clbiez/Buyer-Log-Releases',{wait:async()=>{},maxAttempts:options.maxAttempts||6});
    const result=await provider.copyArtifact('stable','releases/BuyerLog-7.0.322.zip',dest,'7.0.322').catch(error=>({error}));
    return {result,calls,file:fs.existsSync(dest)?fs.readFileSync(dest):null};
  }finally{global.fetch=original;fs.rmSync(dir,{recursive:true,force:true});}
}
const isRaw=call=>call.url.includes('raw.githubusercontent.com');

test('a dropped download resumes from the bytes already written',async()=>{
  const {result,calls,file}=await run((call)=>{
    if(isRaw(call))return respond(404,[]);
    if(!call.range)return respond(200,[FULL.subarray(0,8)],{failAfter:true});
    assert.equal(call.range,'bytes=8-');
    return respond(206,[FULL.subarray(8)],{headers:{'Content-Range':'bytes 8-19/20'}});
  });
  assert.ok(!result.error,result.error&&result.error.message);
  assert.deepEqual(file,FULL);
  assert.equal(result.attempts,2);assert.equal(result.artifactSource,'github-release');
  assert.equal(calls.filter(isRaw).length,1,'404 raw mirror is not retried');
});
test('a server that ignores Range (200) restarts the file instead of appending',async()=>{
  const {result,file}=await run((call)=>{
    if(isRaw(call))return respond(404,[]);
    if(!call.range)return respond(200,[FULL.subarray(0,5)],{failAfter:true});
    return respond(200,[FULL]);
  });
  assert.ok(!result.error);assert.deepEqual(file,FULL);
});
test('a mismatched 206 range never appends at the wrong offset',async()=>{
  let n=0;
  const {result,file}=await run((call)=>{
    if(isRaw(call))return respond(404,[]);
    n++;
    if(n===1)return respond(200,[FULL.subarray(0,6)],{failAfter:true});
    if(n===2)return respond(206,[FULL.subarray(3)],{headers:{'Content-Range':'bytes 3-19/20'}});
    return respond(200,[FULL]);
  });
  assert.ok(!result.error);assert.deepEqual(file,FULL);
});
test('connection failures are retried, then reported with the network cause and attempt count',async()=>{
  const {result,calls,file}=await run((call)=>{
    if(isRaw(call))return respond(404,[]);
    throw Object.assign(new TypeError('fetch failed'),{cause:{code:'ETIMEDOUT',message:'connect ETIMEDOUT 140.82.121.4:443'}});
  },{maxAttempts:3});
  assert.equal(calls.filter(c=>!isRaw(c)).length,3);
  assert.equal(result.error.transportCode,'ETIMEDOUT');
  assert.match(result.error.transportCause,/ETIMEDOUT/);
  assert.match(result.error.transportFailures,/node-fetch:ETIMEDOUT/);
  assert.equal(result.error.attempts,3);assert.equal(result.error.artifactSource,'github-release');
  assert.equal(file,null,'partial file is removed after the last attempt');
});
test('permanent HTTP errors are not retried',async()=>{
  const {result,calls}=await run(()=>respond(403,[]));
  assert.equal(calls.length,2,'one try per candidate');assert.equal(result.error.status,403);
});
test('updater logs the root cause, attempts and a resumed download',()=>{
  const src=fs.readFileSync(path.join(__dirname,'../electron/update/updater.js'),'utf8');
  assert.match(src,/transportCode:String\(error&&\(error\.transportCode\|\|error\.code\)\|\|''\)/);
  assert.match(src,/if\(error\.transportCause\)detail\.transportCause=/);
  assert.match(src,/appendLog\('download-resumed',\{version:manifest\.version,attempts:/);
});
