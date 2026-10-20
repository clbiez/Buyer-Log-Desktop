'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const engine=require('../public/layout-control-engine'),template=require('../public/layout-control-template'),reader=require('../public/layout-document-reader');
const {createLcwAiClient}=require('../server/lib/lcwai/lcwai-client');
const source=fs.readFileSync(require.resolve('../public/layout-document-reader'),'utf8');
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aC9sAAAAASUVORK5CYII=','base64');
function fixture(count,ask,extra={}){
 const pdf={numPages:count,getPage:async n=>({getTextContent:async()=>({items:[]}),getViewport:({scale})=>({width:100*scale,height:200*scale}),render:()=>({promise:Promise.resolve()})}),destroy:async()=>{}};
 const root={BLLayoutControlEngine:engine,BLLayoutTemplate:template,BLPerf:{ensureLibrary:async()=>{}},pdfjsLib:{getDocument:()=>({promise:Promise.resolve(pdf)})},document:{createElement:()=>({getContext:()=>({}),toBlob:callback=>callback(new Blob([png],{type:'image/png'}))})},BuyerLogAI:{askWithFiles:ask},...extra};
 const context=vm.createContext({window:root,File,Blob,Uint8Array,WeakMap,Map,Set,Promise,Error,JSON,Array,Number,String,Math,Object});vm.runInContext(source,context);return root.BLLayoutReader;
}
test('test reports and layouts route from content/name without a chooser',()=>{
 assert.equal(reader.kindFromEvidence('TestRequestResultForm_(369392_Lang2).pdf',''),'TEST_REPORT');
 assert.equal(reader.kindFromEvidence('scan.pdf','BEDEN/SIZE SIP NO 1382024 PEŞİN FİYAT 499,99'),'PRICE_TAG');
 assert.equal(reader.kindFromEvidence('scan.pdf','ANA KUMAŞ 100% COTTON MADE IN INDIA'),'CARE_LABEL');
 assert.equal(reader.kindFromEvidence('scan.pdf',''),'UNKNOWN');
 const ui=fs.readFileSync(require.resolve('../public/checklist-supplier-sync'),'utf8');assert.doesNotMatch(ui,/data-cp-document-layout|chooseCpDocumentFlow/);assert.match(ui,/BLLayoutReader\.classify/);
});
test('LCW AI review receives exact CP facts, both original standards and layout with vision, not Buyer Log verdicts',async()=>{
 const uploads=[],calls=[],client=createLcwAiClient({auth:{getAuthorization:async()=>''}});
 const cpOrders=[{orderCode:'9000001',modelName:'DEMO-YD',country:'India',line:'LSN-DEMO',mag:'CU4E',fabricComposition:'100% Cotton'}];
 const ask=async input=>{
  calls.push(input);assert.equal(input.source,'layout-review');assert.deepEqual(input.context.cpOrders,cpOrders);assert.equal(input.attachments.length,3);assert.ok(input.files.length<=2);
  const payload=client.messagePayload({content:input.guide,attachments:[...input.attachments,...input.files.map(f=>({blobName:f.name,contentType:f.type,fileName:f.name,size:f.size}))]});assert.equal(payload.visionEnabled,true);assert.ok(payload.attachments.length<=5);
  assert.ok(!('checks' in input.context));assert.ok(!('verdict' in input.context));
  return {data:{documentType:'MIXED',summary:'AI review',inspectedPages:input.context.imagePages.map(String),findings:[JSON.stringify({section:'PRICE_TAG',title:'Model',field:'modelName',verdict:'ERROR',actual:'DEMO-Y',expected:'DEMO-YD',comment:'Final letter missing.'})]}};
 };
 const api=fixture(5,ask,{fetch:async()=>({ok:true,blob:async()=>new Blob(['%PDF standard'],{type:'application/pdf'})}),BuyerLogAI:{askWithFiles:ask,uploadFile:async file=>{uploads.push(file);return {blobName:file.name,fileName:file.name,contentType:file.type,size:file.size};}}});
 const file=new File(['%PDF layout'],'mixed.pdf',{type:'application/pdf'}),info=await api.readPdf(file),out=await api.review(file,info,{cpOrders,reference:{status:'MATCH',orderCodes:['9000001']},requestId:'r'});
 assert.equal(out.error,null);assert.equal(out.batches.length,3);assert.equal(uploads.length,3);assert.strictEqual(uploads[2],file);
 assert.deepEqual(uploads.slice(0,2).map(f=>f.name),['LC.KSU.ST.004_rev4.pdf','LC.KSU.ST.003_rev5.pdf']);assert.deepEqual(calls.map(c=>Array.from(c.context.imagePages)),[[1,2],[3,4],[5]]);
});
test('image-only PDF produces real PNG attachments, vision enabled and all page batches within upload limit',async()=>{
 const client=createLcwAiClient({auth:{getAuthorization:async()=>''}}),calls=[];
 const api=fixture(7,async input=>{
  calls.push(input);assert.ok(input.files.length<=5);
  for(const file of input.files){assert.equal(file.type,'image/png');assert.deepEqual(Buffer.from(await file.arrayBuffer()).subarray(0,8),png.subarray(0,8));}
  const payload=client.messagePayload({content:input.guide,attachments:input.files.map(f=>({blobName:f.name,contentType:f.type,fileName:f.name,size:f.size}))});assert.equal(payload.visionEnabled,true);
  return {data:{documentType:'PRICE_TAG',modelCodes:['MINECRAFT-9-YD'],orderNumbers:['1382024'],countries:['INDIA'],cashPrices:['₺499,99'],inspectedPages:input.context.imagePages.map(String)}};
 });
 const file=new File([Buffer.from('%PDF demo')],'scan.pdf',{type:'application/pdf'}),info=await api.readPdf(file);assert.equal(info.text,'');
 const result=await api.analyse(file,info,{requestId:'r'});assert.equal(calls.length,2);assert.deepEqual(Array.from(calls[0].context.imagePages),[1,2,3,4]);assert.deepEqual(Array.from(calls[1].context.imagePages),[5,6,7]);
 assert.equal(result.data._reading.readPages.length,7);assert.equal(result.data._reading.failedPages.length,0);assert.ok(calls.every(c=>!c.files.some(f=>f.type==='application/pdf')));
});
test('review context cannot silently exceed the shared pretty-JSON or per-string limit',async()=>{
 let calls=0;const api=fixture(1,async()=>{calls++;return {};},{fetch:async()=>({ok:true,blob:async()=>new Blob(['%PDF standard'])}),BuyerLogAI:{askWithFiles:async()=>{calls++;return {};},uploadFile:async f=>({blobName:f.name,contentType:f.type})}});
 const file=new File(['%PDF'],'layout.pdf',{type:'application/pdf'}),info=await api.readPdf(file);
 for(const cpOrders of [[{orderCode:'1',modelName:'x'.repeat(2001)}],Array.from({length:40},()=>Object.fromEntries(Array.from({length:17},(_,i)=>['key'+i,'x'.repeat(16)])))]){
  const out=await api.review(file,info,{cpOrders,requestId:'r'});assert.equal(out.error.message,'LAYOUT_CONTEXT_LIMIT');assert.equal(out.batches.length,0);
 }
 assert.equal(calls,0);
});
test('failed or unacknowledged pages stay incomplete rather than claiming a successful full review',()=>{
 const data=reader.mergeBatches([{pages:[1,2],data:{documentType:'CARE_LABEL',modelCodes:['MINECRAFT-9-YD'],inspectedPages:['1']}}],6);
 assert.deepEqual(data._reading.readPages,[1]);assert.deepEqual(data._reading.failedPages,[2,3,4,5,6]);
 const empty=reader.mergeBatches([{pages:[1],data:{documentType:'UNKNOWN',explanation:'Unreadable'}}],1);assert.deepEqual(empty._reading.failedPages,[1]);
 const contact=reader.mergeBatches([{pages:[1],data:{documentType:'CARE_LABEL',modelCodes:['MODEL'],inspectedPages:['1']}},{pages:[2],data:{documentType:'CARE_LABEL',companyAddresses:['LC WAIKIKI address'],websites:['www.lcwaikiki.com'],inspectedPages:['2']}}],2);assert.deepEqual(contact._reading.failedPages,[]);
});
test('AI compliant assessment survives history normalization while buyer approval remains pending',()=>{
 const store=require('../server/lib/layout-control-store');
 const run=store.normalizeRun({checks:[{rule:'STD_CARE_CONTACT',category:'STANDARD',source:'LCW AI',status:'MATCH',assessmentStatus:'MATCH',decision:'PENDING'}]});
 assert.equal(run.checks[0].status,'MATCH');assert.equal(run.reviewStatus,'PENDING');
 const legacy=store.normalizeRun({modelCodes:['OLDER-MODEL'],colourCodes:['BLU'],reading:{readPages:'bad',failedPages:{}}});assert.deepEqual(legacy.extraction.modelCodes,['OLDER-MODEL']);assert.deepEqual(legacy.reading.readPages,[]);
});
