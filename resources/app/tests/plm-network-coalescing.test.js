'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const client=require('../server/lib/corenectum-api-client');
const api=require('../server/lib/corenectum-bom-api');
const setApi=require('../server/lib/corenectum-set-style-api');
const sheetUrl=client.TECHNICAL_SHEET_URL;
function transport(t){
  const original=global.fetch,calls=[];
  global.fetch=(url,options)=>new Promise(resolve=>calls.push({url,options,resolve}));
  t.after(()=>{global.fetch=original;});
  const respond=(index,payload={data:{value:1}},status=200)=>calls[index].resolve({ok:status===200,status,text:async()=>JSON.stringify(payload)});
  return {calls,respond};
}
const options={token:'fixture-authority-a',retries:1,language:'en'};
test('identical concurrent PLM reads use one request, clone results and fetch again after settlement',async t=>{
  const f=transport(t),body={styleId:'123'};
  const first=client.postJson('owner-a',api.GET_STYLE_BOM_INFORMATION_URL,body,options);
  const second=client.postJson('owner-a',api.GET_STYLE_BOM_INFORMATION_URL,body,options);
  const count=f.calls.length;t.diagnostic(`Concurrent identical BOM reads: ${count} network request(s)`);
  for(let i=0;i<count;i++)f.respond(i);
  const [a,b]=await Promise.all([first,second]);a.data.value=99;assert.equal(b.data.value,1);
  const third=client.postJson('owner-a',api.GET_STYLE_BOM_INFORMATION_URL,body,options);f.respond(count);await third;
  assert.equal(count,1);assert.equal(f.calls.length,2);
});
test('owner, token, language, body and retry policy boundaries never share pending PLM reads',async t=>{
  const f=transport(t),url=api.GET_STYLE_BOM_INFORMATION_URL;
  const inputs=[['owner-a',{styleId:'1'},options],['owner-b',{styleId:'1'},options],['owner-a',{styleId:'1'},{...options,token:'fixture-authority-b'}],['owner-a',{styleId:'1'},{...options,language:'tr'}],['owner-a',{styleId:'2'},options],['owner-a',{styleId:'1'},{...options,retries:2}]];
  const requests=inputs.map(([owner,body,opts])=>client.postJson(owner,url,body,opts));
  assert.equal(f.calls.length,inputs.length);inputs.forEach((_,i)=>f.respond(i,{owner:i}));
  assert.deepEqual((await Promise.all(requests)).map(item=>item.owner),[0,1,2,3,4,5]);
});
test('failed pending reads are removed and report creation requests are never coalesced',async t=>{
  const f=transport(t),url=api.GET_STYLE_BOM_INFORMATION_URL;
  const reads=[client.postJson('owner-a',url,{styleId:'1'},options),client.postJson('owner-a',url,{styleId:'1'},options)];
  const count=f.calls.length;for(let i=0;i<count;i++)f.respond(i,{},401);
  const failed=await Promise.allSettled(reads);assert.ok(failed.every(item=>item.status==='rejected'&&item.reason.code==='CORENECTUM_API_TOKEN_INVALID'));
  const retry=client.postJson('owner-a',url,{styleId:'1'},options);f.respond(count);await retry;
  const before=f.calls.length,reports=[client.postJson('owner-a',sheetUrl,{},options),client.postJson('owner-a',sheetUrl,{},options)];
  assert.equal(f.calls.length-before,2);f.respond(before);f.respond(before+1);await Promise.all(reports);
});
test('GET association reads coalesce only the same query and the registry remains bounded',async t=>{
  const f=transport(t),url=setApi.SET_STYLE_CHILD_ASSOCIATION_URL;
  const one=client.getJson('owner-a',url,{styleId:'1'},options),same=client.getJson('owner-a',url,{styleId:'1'},options),other=client.getJson('owner-a',url,{styleId:'2'},options);
  assert.equal(f.calls.length,2);f.respond(0);f.respond(1);await Promise.all([one,same,other]);
  const reads=Array.from({length:130},(_,i)=>client.getJson('owner-a',url,{styleId:String(i)},options));
  const shared=client.getJson('owner-a',url,{styleId:'0'},options),overflow=client.getJson('owner-a',url,{styleId:'129'},options);
  assert.equal(f.calls.length,133,'registered reads share; overflow bypasses the bounded registry');
  for(let i=2;i<f.calls.length;i++)f.respond(i);await Promise.all([...reads,shared,overflow]);
  const retry=client.getJson('owner-a',url,{styleId:'0'},options);f.respond(133);await retry;assert.equal(f.calls.length,134);
});
