'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const engine=require('../public/layout-control-engine'),template=require('../public/layout-control-template'),reader=require('../public/layout-document-reader');
const {createLcwAiClient}=require('../server/lib/lcwai/lcwai-client');
const source=fs.readFileSync(require.resolve('../public/layout-document-reader'),'utf8');
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aC9sAAAAASUVORK5CYII=','base64');
function fixture(count,ask){
 const pdf={numPages:count,getPage:async n=>({getTextContent:async()=>({items:[]}),getViewport:({scale})=>({width:100*scale,height:200*scale}),render:()=>({promise:Promise.resolve()})}),destroy:async()=>{}};
 const root={BLLayoutControlEngine:engine,BLLayoutTemplate:template,BLPerf:{ensureLibrary:async()=>{}},pdfjsLib:{getDocument:()=>({promise:Promise.resolve(pdf)})},document:{createElement:()=>({getContext:()=>({}),toBlob:callback=>callback(new Blob([png],{type:'image/png'}))})},BuyerLogAI:{askWithFiles:ask}};
 const context=vm.createContext({window:root,File,Blob,Uint8Array,WeakMap,Map,Set,Promise,Error,JSON,Array,Number,String,Math,Object});vm.runInContext(source,context);return root.BLLayoutReader;
}
test('test reports and layouts route from content/name without a chooser',()=>{
 assert.equal(reader.kindFromEvidence('TestRequestResultForm_(369392_Lang2).pdf',''),'TEST_REPORT');
 assert.equal(reader.kindFromEvidence('scan.pdf','BEDEN/SIZE SIP NO 1382024 PEŞİN FİYAT 499,99'),'PRICE_TAG');
 assert.equal(reader.kindFromEvidence('scan.pdf','ANA KUMAŞ 100% COTTON MADE IN INDIA'),'CARE_LABEL');
 assert.equal(reader.kindFromEvidence('scan.pdf',''),'UNKNOWN');
 const ui=fs.readFileSync(require.resolve('../public/checklist-supplier-sync'),'utf8');assert.doesNotMatch(ui,/data-cp-document-layout|chooseCpDocumentFlow/);assert.match(ui,/BLLayoutReader\.classify/);
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
