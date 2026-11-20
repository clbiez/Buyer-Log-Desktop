'use strict';
/* WS2b (#1075): POST /api/read-model/global-flow/model rota sözleşmesi. */
const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const zlib=require('node:zlib');
const express=require('express');
const source=require('./helpers/server-source')();
const captureBacklogRequest=require('./helpers/computed-backlog-request');
const register=require('../server/lib/read-model/global-flow-routes');
const model=require('../server/lib/read-model/global-flow-model');
const flow=require('../public/overview-global-flow');
const {sendComputedResponse}=require('../server/lib/compute-response');

const QUERIES=[
  {format:'json',projection:'global-flow'},
  {format:'json',projection:'global-flow',lazyDimensions:'1',retailFrom:'2026-01-01',retailTo:'2026-06-30',groupBy:'season,antrepoDate',antrepoDateLevels:'year,month',buyerGrup:'G1,G2',
    dimFilters:JSON.stringify({country:['China'],antrepoDate:{granularity:'month',values:['2026-02']}}),analysisFilters:JSON.stringify([{id:'late'}]),sourceColumns:'asas:1, ias:2',exFactoryFrom:'2026-02-01'},
  {format:'json',projection:'global-flow',dimFilters:'{bozuk'},
];

test('seçenekler GET /api/backlog-export satır içi ifadesiyle birebir aynı (sürüklenme bekçisi)',()=>{
  const start=source.indexOf("app.get('/api/backlog-export'"),end=source.indexOf('\n});',start);assert.ok(start>0&&end>start);
  const route=source.slice(start,end),dims=route.match(/let dimFilters=\{\};try\{dimFilters=JSON\.parse\(q\.dimFilters\|\|'\{\}'\);\}catch\{\}/),opts=route.match(/const options=(\{[^\n]*\});\n/);
  assert.ok(dims&&opts,'GET rotasının seçenek ifadesi bulunamadı; global-flow-routes.js backlogExportOptions ile birlikte güncelleyin');
  for(const q of QUERIES){
    const expected=vm.runInNewContext(`(()=>{${dims[0]};return ${opts[1]};})()`,{q,JSON,String});
    assert.deepEqual(JSON.parse(JSON.stringify(register.backlogExportOptions(q))),JSON.parse(JSON.stringify(expected)));
  }
});

test('compute parametreleri GET projection=global-flow isteğiyle aynı (aynı önbellek ve aynı satırlar)',async()=>{
  for(const q of QUERIES){
    const get=await captureBacklogRequest(q);
    let captured;const app={post:(_path,...handlers)=>{app.handler=handlers[handlers.length-1];}};
    register(app,{userAccess:{requireArea:()=>(_q,_s,next)=>next()},assertSourceFilters(){},prepareComputeBacklog:async()=>{},
      backlogReadConsumer:()=>({signal:new AbortController().signal,dispose(){}}),apiError:(_res,error)=>{throw error;},
      sendComputedResponse:()=>{},getComputeReads:()=>({run:async(_req,area,task,parts,options)=>{captured={area,task,parts,cache:options.cache};return {value:{buffer:zlib.gzipSync('{"rows":[]}'),uncompressedBytes:11},release(){},assertResponse(){}};}}),
      runReadModelCompute:async(task,payload)=>({value:model.execute(payload),release(){}})});
    await app.handler({body:{version:1,source:'backlog',query:q}},{});
    assert.equal(captured.task,get.task);assert.equal(captured.area,'backlog');assert.equal(captured.cache,true);
    assert.deepEqual(JSON.parse(JSON.stringify(captured.parts)),JSON.parse(JSON.stringify(get.parts)));
    assert.equal(captured.parts.mapProjection,true);assert.equal(captured.parts.includeSourceDetails,false);
  }
});

test('istek doğrulama: sürüm ve kaynak zorunlu, bilinmeyen anahtar yok sayılır, nesne değer reddedilir',()=>{
  assert.throws(()=>register.normalizeRequest({source:'backlog',query:{}}),{code:'READ_MODEL_QUERY_INVALID',statusCode:400});
  assert.throws(()=>register.normalizeRequest({version:1,source:'cp',query:{}}),{code:'READ_MODEL_QUERY_INVALID'});
  assert.throws(()=>register.normalizeRequest({version:1,query:{dimFilters:{country:['x']}}}),{code:'READ_MODEL_QUERY_INVALID'});
  assert.deepEqual(register.normalizeRequest({version:1,query:{lazyDimensions:'1',format:'json',groupBy:'season',hack:'x'}}),{format:'json',groupBy:'season'});
});

test('kayıt server.js içinde global 100 MB JSON ayrıştırıcısından önce yapılır',()=>{
  const at=source.indexOf("require('./lib/read-model/global-flow-routes')"),parser=source.indexOf("app.use(express.json({ limit: '100mb' }));");
  assert.ok(at>0&&parser>at);
  assert.ok(/getComputeReads: \(\) => computeReads/.test(source.slice(at,parser)),'compute okuma servisi tembel alınmalı (TDZ)');
});

function exportBuffer(){
  const rows=[
    {'Sipariş Kod':101,'Model Adı':'Demo A','Renk Kod':'01','Ülke':'Bangladesh','Güncel Durum':'Yol Operasyonları','Yükleme Tipi':'Gemi','Adet':60,_backlogExcel:{handoverDate:'2026-01-02',transitDays:70},_flowThin:1},
    {'Sipariş Kod':102,'Model Adı':'Demo B','Renk Kod':'02','Ülke':'China','Güncel Durum':'Üretimde','Yükleme Tipi':'Uçak','Adet':40,_flowThin:1},
  ];
  return zlib.gzipSync(JSON.stringify({rows,sourceRevision:'src-1'}));
}
async function serve(t,{stale=0,acquireStale=0}={}){
  const app=express(),buffer=exportBuffer(),state={runs:0,computes:0,releases:0,leases:0,stale,acquireStale};
  const routes=register(app,{userAccess:{requireArea:area=>(req,res,next)=>{assert.equal(area,'backlog');return req.headers['x-deny']?res.status(403).json({code:'ACCESS_AREA_REQUIRED'}):next();}},
    assertSourceFilters(){},prepareComputeBacklog:async()=>{},backlogReadConsumer:()=>({signal:new AbortController().signal,dispose(){}}),
    apiError:(res,error)=>res.status(error.statusCode||500).json({code:error.code}),sendComputedResponse,
    getComputeReads:()=>({run:async()=>{state.runs++;if(state.acquireStale>0){state.acquireStale--;throw Object.assign(new Error('stale build'),{code:'COMPUTE_STALE_GENERATION',statusCode:409});}state.leases++;let staleNow=state.stale>0;if(staleNow)state.stale--;
      return {value:{buffer,uncompressedBytes:1},release(){state.releases++;},assertResponse(){if(staleNow)throw Object.assign(new Error('stale'),{code:'COMPUTE_STALE_GENERATION',statusCode:409});}};}}),
    runReadModelCompute:async(task,payload)=>{assert.equal(task,'global-flow-records');state.computes++;return {value:model.execute(payload),release(){}};}});
  const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const url=`http://127.0.0.1:${server.address().port}/api/read-model/global-flow/model`;
  const post=(body,headers={})=>fetch(url,{method:'POST',headers:{'Content-Type':'application/json',...headers},body:typeof body==='string'?body:JSON.stringify(body)});
  return {post,state,routes};
}

test('gerçek HTTP: gzip kayıt yükü, aynı projeksiyon baytlarında yeniden hesap yok, kiralar bırakılır',async t=>{
  const {post,state,routes}=await serve(t);
  const body={version:1,source:'backlog',query:{format:'json',projection:'global-flow'}};
  const first=await post(body);assert.equal(first.status,200);
  const timing=JSON.parse(first.headers.get('x-read-model-timing'));assert.equal(timing.count,2);
  const payload=await first.json();assert.ok(flow.readModelPayloadValid(payload));assert.equal(payload.sourceRevision,'src-1');
  const records=flow.hydrateReadModelRecords(payload);
  assert.deepEqual(records.map(rec=>[rec.orderCode,rec.state,rec.origin&&rec.origin.name,rec.raw._flowThin,rec.raw._flowSourceRevision]),
    [['101','transit','Bangladesh',1,'src-1'],['102','production','China',1,'src-1']]);
  const second=await post(body);assert.equal(second.status,200);await second.arrayBuffer();
  assert.equal(state.computes,1,'aynı projeksiyon Buffer + gün için işçi yeniden çalışmaz');
  assert.deepEqual(routes.stats(),{requests:2,computed:1,reused:1});
  await new Promise(resolve=>setTimeout(resolve,20));assert.equal(state.releases,state.leases);
});

test('gerçek HTTP: yetki gövdeden önce, geçersiz gövde 400/413, eski nesil yeniden denenir',async t=>{
  const {post,state}=await serve(t,{stale:1});
  assert.equal((await post('{bozuk',{'x-deny':'1'})).status,403);
  const bad=await post('{bozuk');assert.equal(bad.status,400);assert.equal((await bad.json()).code,'READ_MODEL_BODY_INVALID');
  const big=await post({version:1,query:{analysisFilters:'x'.repeat(600*1024)}});assert.equal(big.status,413);
  const wrong=await post({version:2,query:{}});assert.equal(wrong.status,400);assert.equal((await wrong.json()).code,'READ_MODEL_QUERY_INVALID');
  const ok=await post({version:1,source:'backlog',query:{format:'json'}});assert.equal(ok.status,200);await ok.arrayBuffer();
  assert.equal(state.runs,2,'ilk deneme eski nesil → bir kez yeniden');
  await new Promise(resolve=>setTimeout(resolve,20));assert.equal(state.releases,state.leases);
});

test('gerçek HTTP: projeksiyon edinimi sırasında eski nesil de yeniden denenir (Codex #1087)',async t=>{
  const {post,state}=await serve(t,{acquireStale:2});
  const ok=await post({version:1,source:'backlog',query:{format:'json'}});
  assert.equal(ok.status,200);await ok.arrayBuffer();
  assert.equal(state.runs,3,'iki eski nesil edinimi + bir başarılı deneme');
  await new Promise(resolve=>setTimeout(resolve,20));assert.equal(state.releases,state.leases);
  const {post:post2}=await serve(t,{acquireStale:3});
  const fail=await post2({version:1,source:'backlog',query:{format:'json'}});
  assert.equal(fail.status,409);assert.equal((await fail.json()).code,'COMPUTE_STALE_GENERATION');
});

test('gerçek HTTP: aynı projeksiyon için If-None-Match → gövdesiz 304; farklı ETag → tam yük',async t=>{
  const {post,state}=await serve(t);
  const body={version:1,source:'backlog',query:{format:'json'}};
  const first=await post(body),etag=first.headers.get('etag');await first.arrayBuffer();
  assert.match(etag,/^"gf-[0-9a-f-]{36}"$/);
  const same=await post(body,{'If-None-Match':etag});
  assert.equal(same.status,304);assert.equal(same.headers.get('etag'),etag);assert.equal((await same.text()).length,0);
  const other=await post(body,{'If-None-Match':'"gf-eski"'});
  assert.equal(other.status,200);assert.equal(other.headers.get('etag'),etag);await other.arrayBuffer();
  assert.equal(state.computes,1);
  await new Promise(resolve=>setTimeout(resolve,20));assert.equal(state.releases,state.leases,'304 yolunda da kira bırakılır');
});
