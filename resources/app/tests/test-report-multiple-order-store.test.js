'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'bl-multiple-orders-'));
process.env.BUYER_LOG_SERVER_DATA_ROOT=root;
const E=require('../public/test-report-engine'),store=require('../server/lib/test-reports/store'),{createService}=require('../server/lib/test-reports/service'),staging=require('../server/lib/test-reports/staging'),express=require('express'),register=require('../server/routes/test-report-routes');
const profile={id:'scope-user'},all=new Map(['1000011','1000012','1000013'].map(orderCode=>[orderCode+'|DEMO|NVY',{orderCode,modelName:'DEMO',colour:'NAVY',colourCode:'NVY'}]));let allowed=all;
const service=createService({authorizedOrders:async()=>allowed});
const eml=Buffer.from('From: labright@example.com\nSubject: [RESULT REPORT] TALEP NO: 4400011\nContent-Type: text/plain; charset=utf-8\n\nTest Talep Bilgileri\nTalep No / Request no\t4400011\tSipariş Kodu / Order No\t1000011\nModel\tDEMO\tRenk / Color\tNAVY\nAçıklama / Description\t100% COTTON, ORDER: 1000011/1000012/1000013\nGenel Değerlendirme\tPass');
const parse=()=>service.parse(profile,[{name:'multi-demo.eml',base64:eml.toString('base64')}]);
const pick=(orderCode,extra={})=>({talepNo:'4400011',orderKey:orderCode+'|DEMO|NVY',itemId:'tests',...extra});
test.after(()=>{staging.clearAll?.();fs.rmSync(root,{recursive:true,force:true});});
test('one report persists multiple independent targets, target attachments and idempotent reimports',async()=>{
 const session=await parse();assert.equal(fs.existsSync(store.FILE),false);
 await assert.rejects(service.commit(profile,{sessionId:session.sessionId,items:[pick('1000012')]}),{code:'TEST_REPORT_SCOPE_CONFIRMATION_REQUIRED'});
 await assert.rejects(service.commit(profile,{sessionId:session.sessionId,items:[pick('1000011'),pick('1000011')]}),{code:'TEST_REPORT_DUPLICATE_TARGET'});
 const result=await service.commit(profile,{sessionId:session.sessionId,items:[pick('1000011'),pick('1000012',{confirmMatch:true})]});
 assert.equal(result.results.length,2);assert.ok(result.results.every(r=>r.attachments.length===1));
 assert.notEqual(result.results[0].attachments[0].id,result.results[1].attachments[0].id);
 let saved=store.read();assert.equal(Object.keys(saved.reports).length,1);
 assert.equal(E.reportLinks(saved.links['4400011']).length,2);
 assert.ok(E.reportLinks(saved.links['4400011']).every(l=>l.files[0].attachmentId));
 const again=await parse();const repeated=await service.commit(profile,{sessionId:again.sessionId,items:[pick('1000011'),pick('1000012',{confirmMatch:true}),pick('1000013',{confirmMatch:true})]});
 assert.deepEqual(repeated.results.map(r=>r.attachments.length),[0,0,1]);
 saved=store.read();assert.equal(E.reportLinks(saved.links['4400011']).length,3);
 assert.equal(saved.reports['4400011'].dosyalar.length,1);
});
test('an authorized but unmentioned PO and an unauthorized secondary PO cannot receive the report',async()=>{
 const session=await parse();allowed=new Map([...all,['9999999|DEMO|NVY',{orderCode:'9999999'}]]);
 await assert.rejects(service.commit(profile,{sessionId:session.sessionId,items:[pick('9999999',{confirmMatch:true})]}),{code:'TEST_REPORT_ORDER_MISMATCH'});
 allowed=new Map([all.entries().next().value]);
 await assert.rejects(service.commit(profile,{sessionId:session.sessionId,items:[pick('1000012',{confirmMatch:true})]}),{code:'TEST_REPORT_ORDER_FORBIDDEN'});
 allowed=all;
});
test('read scope exposes only authorized target links and corresponding attachment IDs',async()=>{
 allowed=new Map([[...all][1]]);const app=express();app.use((req,res,next)=>{req.currentUser=profile;next();});
 register(app,{express,authorizedOrders:async()=>allowed,automationError:(res,err)=>res.status(500).json({code:err.code}),userAccess:{requireAnyArea:()=> (_req,_res,next)=>next(),appendAudit:()=>{}}});
 const server=app.listen(0);await new Promise(r=>server.once('listening',r));
 try {const payload=await(await fetch('http://127.0.0.1:'+server.address().port+'/api/test-reports')).json();
  const links=E.reportLinks(payload.links['4400011']);assert.equal(links.length,1);assert.equal(links[0].orderKey,'1000012|DEMO|NVY');
  const files=payload.reports['4400011'].dosyalar;assert.equal(files.length,1);assert.equal(files[0].attachmentId,links[0].files[0].attachmentId);
  const privateIds=E.reportLinks(store.read().links['4400011']).filter(l=>l.orderKey!==links[0].orderKey).map(l=>l.files[0].attachmentId);
  assert.ok(privateIds.every(id=>!JSON.stringify(payload).includes(id)));
 }finally{server.close();allowed=all;}
});

test('shared evidence cannot be changed without edit access to every existing target',async()=>{
 const session=await parse(),before=store.read();allowed=new Map([[...all][0]]);
 // Changed parser evidence would affect all shared targets, even when only A
 // was selected. The API must reject before attachment or report writes.
 const staged=service.sessionFor(profile,session.sessionId);staged.reports[0].genelSonuc='Fail';
 await assert.rejects(service.commit(profile,{sessionId:session.sessionId,items:[pick('1000011')]}),{code:'TEST_REPORT_SHARED_SCOPE_FORBIDDEN'});
 assert.deepEqual(store.read(),before);allowed=all;
});
test('reimporting one target preserves stable legacy primary link and every sibling',async()=>{
 const before=store.read(),primary=before.links['4400011'].orderKey,session=await parse();
 await service.commit(profile,{sessionId:session.sessionId,items:[pick('1000011')]});
 const after=store.read();assert.equal(after.links['4400011'].orderKey,primary);
 assert.deepEqual(E.reportLinks(after.links['4400011']).map(l=>l.orderKey),E.reportLinks(before.links['4400011']).map(l=>l.orderKey));
});
