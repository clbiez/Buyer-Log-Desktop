'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'buyerlog-report-live-authority-'));
process.env.BUYER_LOG_SERVER_DATA_ROOT=root;process.env.BUYER_LOG_LOCAL_DATA_ROOT=path.join(root,'local');
const {createService}=require('../server/lib/test-reports/service');
const store=require('../server/lib/test-reports/store'),checklist=require('../server/lib/checklist-supplier-store');
const {fixture,pdfFromItems}=require('./helpers/external-lab-fixture.cjs');
const actor={id:'demo',displayName:'Demo Buyer'},allowed=()=>new Map([['po1',{orderCode:'4100001',modelName:'DEMO'}]]);
function snapshot(){const result={};function walk(dir){if(!fs.existsSync(dir))return;for(const entry of fs.readdirSync(dir,{withFileTypes:true})){if(entry.name.endsWith('.write-lock')||entry.name.endsWith('.write-fence.json'))continue;const file=path.join(dir,entry.name);if(entry.isDirectory())walk(file);else result[path.relative(root,file)]=crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');}}walk(root);return result;}
let reportSequence=124;
async function prepare(service,existingId){const id=existingId||'DEMSL26'+String(reportSequence++).padStart(7,'0');const data=JSON.parse(JSON.stringify(fixture()).replaceAll('DEMSL260000124',id));const parsed=await service.parse(actor,[{name:'demo.pdf',base64:pdfFromItems(data).toString('base64')}]);assert.equal(parsed.reports.length,1);return {sessionId:parsed.sessionId,items:[{talepNo:parsed.reports[0].talepNo,orderKey:'po1',itemId:'tests'}]};}
test.after(()=>fs.rmSync(root,{recursive:true,force:true}));

test('revocation after preparation blocks the real report commit, attachments and audit; restoring access permits retry',async()=>{
 let live=allowed();const audits=[];
 const service=createService({authorizedOrders:async()=>allowed(),authorizedOrdersNow:()=>live,audit:(...args)=>audits.push(args)});
 const body=await prepare(service),before=snapshot();
 await assert.rejects(service.commit(actor,body,{withCommitGuard:apply=>{live=new Map();return apply();}}),{code:'TEST_REPORT_ORDER_FORBIDDEN'});
 assert.deepEqual(snapshot(),before);assert.equal(audits.length,0);
 live=allowed();const result=await service.commit(actor,body);
 assert.equal(result.results.length,1);assert.equal(audits.length,1);
});

test('authority is checked again under the actual report lease before any attachment is staged',async()=>{
 let live=allowed(),insideLease=false;const service=createService({authorizedOrders:async()=>allowed(),authorizedOrdersNow:()=>live});
 const body=await prepare(service),before=snapshot(),commit=store.commit;
 store.commit=(items,typeMap,profile,attach,options)=>commit(items,typeMap,profile,attach,{...options,assertAuthority:()=>{
   insideLease=fs.existsSync(store.FILE+'.write-lock');live=new Map();options.assertAuthority?.();
 }});
 try{await assert.rejects(service.commit(actor,body),{code:'TEST_REPORT_ORDER_FORBIDDEN'});}finally{store.commit=commit;}
 assert.equal(insideLease,true);assert.deepEqual(snapshot(),before);
});

test('revocation after attachment staging removes only the new unlinked files and leaves reports unchanged',async()=>{
 let live=allowed();const service=createService({authorizedOrders:async()=>allowed(),authorizedOrdersNow:()=>live});
 const body=await prepare(service),before=snapshot(),add=checklist.addAttachmentBuffer;
 let staged=false;
 checklist.addAttachmentBuffer=(...args)=>{const result=add(...args);staged=true;live=new Map();return result;};
 try{await assert.rejects(service.commit(actor,body),{code:'TEST_REPORT_ORDER_FORBIDDEN'});}finally{checklist.addAttachmentBuffer=add;}
 assert.equal(staged,true);assert.deepEqual(snapshot(),before,'denied commit must not retain its staged attachments');
});

test('uncertain committed write keeps every durably referenced attachment',async()=>{
 const service=createService({authorizedOrders:async()=>allowed(),authorizedOrdersNow:allowed});
 const body=await prepare(service),commit=store.commit;let committed;
 store.commit=(...args)=>{committed=commit(...args);throw Object.assign(new Error('synthetic error after commit'),{code:'EIO'});};
 try{await assert.rejects(service.commit(actor,body),{code:'EIO'});}finally{store.commit=commit;}
 assert.ok(committed.results[0].attachments.length>0);
 for(const attachment of committed.results[0].attachments)assert.ok(checklist.getAttachmentPath(attachment.id),'cleanup must never delete committed evidence');
 assert.ok(store.read().reports[body.items[0].talepNo]);
});

test('revoking an existing linked order blocks extension of the same report under its lease',async()=>{
 const both=()=>new Map([...allowed(),['po2',{orderCode:'4100001',modelName:'DEMO'}]]);let live=both();
 const service=createService({authorizedOrders:async()=>both(),authorizedOrdersNow:()=>live});
 const first=await prepare(service);await service.commit(actor,first);
 const body=await prepare(service,first.items[0].talepNo.replace(/-[A-Z]$/,''));body.items[0].orderKey='po2';
 const before=snapshot();
 await assert.rejects(service.commit(actor,body,{withCommitGuard:apply=>{live.delete('po1');return apply();}}),{code:'TEST_REPORT_SHARED_SCOPE_FORBIDDEN'});
 assert.deepEqual(snapshot(),before);
});

test('sibling-order revocation during attachment staging is checked by the final guard',async()=>{
 const both=()=>new Map([...allowed(),['po2',{orderCode:'4100001',modelName:'DEMO'}]]);let live=both();
 const service=createService({authorizedOrders:async()=>both(),authorizedOrdersNow:()=>live});
 const first=await prepare(service);await service.commit(actor,first);
 const body=await prepare(service,first.items[0].talepNo.replace(/-[A-Z]$/,''));body.items[0].orderKey='po2';
 const before=snapshot(),add=checklist.addAttachmentBuffer;let staged=false;
 checklist.addAttachmentBuffer=(...args)=>{const result=add(...args);staged=true;live.delete('po1');return result;};
 try{await assert.rejects(service.commit(actor,body),{code:'TEST_REPORT_SHARED_SCOPE_FORBIDDEN'});}finally{checklist.addAttachmentBuffer=add;}
 assert.equal(staged,true);assert.deepEqual(snapshot(),before);
});

test('failure after last-good publication preserves attachments referenced only by recovery',async()=>{
 const service=createService({authorizedOrders:async()=>allowed(),authorizedOrdersNow:allowed});
 await service.commit(actor,await prepare(service));
 const body=await prepare(service),rename=fs.renameSync;
 fs.renameSync=(source,target,...rest)=>{if(target===store.FILE&&String(source).endsWith('.tmp'))throw Object.assign(new Error('synthetic primary publication failure'),{code:'EIO'});return rename(source,target,...rest);};
 try{await assert.rejects(service.commit(actor,body),{code:'EIO'});}finally{fs.renameSync=rename;}
 const recovery=JSON.parse(fs.readFileSync(path.join(root,'test-reports.last-good.json'),'utf8'));
 assert.ok(recovery.reports[body.items[0].talepNo]);
 assert.equal(Boolean(JSON.parse(fs.readFileSync(store.FILE,'utf8')).reports[body.items[0].talepNo]),false);
 const files=recovery.links[body.items[0].talepNo].files;
 assert.ok(files.length>0);
 for(const file of files)assert.ok(checklist.getAttachmentPath(file.attachmentId),'last-good recovery evidence must remain on disk');
});
