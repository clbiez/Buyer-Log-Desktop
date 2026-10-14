'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'bl-agent-saved-query-'));
for(const key of ['BUYER_LOG_DATA_ROOT','BUYER_LOG_LOCAL_DATA_ROOT','BUYER_LOG_SERVER_DATA_ROOT','BUYER_LOG_AUTH_DATA_ROOT'])process.env[key]=root;
const db=require('../server/db'),adapter=require('../server/lib/data-domain/legacy-adapter'),{createSourceWorkflowService}=require('../server/lib/source-workflow-service');
const {createToolRegistry}=require('../server/lib/agent-tool-registry'),{createAgentOfficeStore}=require('../server/lib/agent-office-store'),{createAgentOfficeService}=require('../server/lib/agent-office-service'),{createAgentRuntime}=require('../server/lib/agent-runtime'),runtimeStore=require('../server/lib/agent-workflow-store'),{createPolicyEngine}=require('../server/lib/agent-policy-engine');
let sequence=0;test.after(()=>fs.rmSync(root,{recursive:true,force:true}));
const {createSourceMetadataService}=require('../server/lib/source-metadata-service');
function setup(){return db.replaceModelConnections([{id:'asas',name:'Demo ASAS',server:'PRIVATE_SERVER',catalog:'PRIVATE_CATALOG',role:'asas',scopes:[]},{id:'db1',name:'Demo DB',server:'PRIVATE_SQL',catalog:'PRIVATE_DB',role:'custom',refreshEnabled:false,connector:{kind:'sqlserver',server:'PRIVATE_SQL',database:'PRIVATE_DB'},query:'SELECT PRIVATE_QUERY',scopes:[]}]).items;}
async function fixture(t,hooks={}){
 setup();const profile={id:'query'+(++sequence),enabled:true,areas:['source'],permissions:['manageModelConnections']},access={profileById:id=>id===profile.id?profile:null,publicProfile:p=>p,hasArea:(p,a)=>p.areas.includes(a),hasPermission:(p,k)=>p.permissions.includes(k),appendAudit:()=>{}};
 let service;const store=createAgentOfficeStore({root:path.join(root,profile.id)}),registry=createToolRegistry({userAccess:access,authorizeCapability:(ctx,args)=>service.taskAuthorize(ctx,args)}),native=createSourceWorkflowService({db}),runs=[],outputs=[];
 const runner=hooks.runner||(async(item,{maxRows,beforeQuery})=>{await beforeQuery();runs.push({id:item.id,query:item.query,maxRows});return {rows:Array.from({length:Math.min(maxRows,3)},(_,i)=>({Order:'PO'+i,Qty:i+1,Note:'x'.repeat(600),__proto__x:1})),rowCount:3,provider:'demo'};});
 const metadata=createSourceMetadataService({source:native,runSavedQuery:runner});
 const outputService=()=>({renderStructured:(owner,spec)=>{const record={id:'a'.repeat(24),fileName:'saved-query.xlsx',format:spec.format,bytes:100,requestId:spec.requestId,owner,spec};outputs.push(record);return {id:record.id};},get:(owner,id)=>outputs.find(r=>r.id===id&&r.owner===owner),store:{takePending(){}}});
 require('../server/lib/agent-source-metadata-tools').registerSavedQueryTools(registry,{metadata,registerReport:spec=>require('../server/lib/agent-analytics-tools').registerReportCapability(registry,spec,outputService)});
 const runtime=createAgentRuntime({store:runtimeStore,toolRegistry:registry,policyEngine:createPolicyEngine({userAccess:access})});service=createAgentOfficeService({store,userAccess:access,toolRegistry:registry,runtime,runtimeStore,getOperationalData:async()=>({})});t.after(()=>service.stop());
 const agent=await store.createProfile(profile.id,{name:'Saved queries',areas:['source']});return {profile,registry,service,agent,runs,outputs};
}
const ctx=f=>({ownerId:f.profile.id,profile:f.profile});
test('saved query READ runs only the stored query with bounded rows and never exposes connection or query text',async t=>{
 const f=await fixture(t),r=await f.registry.execute('source.query.read',{sourceId:'db1',maxRows:2},ctx(f));
 assert.equal(r.verified,true);assert.equal(f.runs[0].query,'SELECT PRIVATE_QUERY');assert.equal(f.runs[0].maxRows,2);assert.equal(r.data.rows.length,2);
 assert.equal(r.data.rows[0].Note.length,500);assert.doesNotMatch(JSON.stringify(r),/PRIVATE_/);assert.deepEqual([...r.data.columns].sort(),['Note','Order','Qty','__proto__x'].sort());
 await assert.rejects(f.registry.execute('source.query.read',{sourceId:'db1',query:'DROP TABLE x'},ctx(f)),{code:'OFFICE_TOOL_SCHEMA'});
 await assert.rejects(f.registry.execute('source.query.read',{sourceId:'asas'},ctx(f)),{code:'SOURCE_QUERY_UNAVAILABLE'});
 f.profile.permissions=[];await assert.rejects(f.registry.execute('source.query.read',{sourceId:'db1'},ctx(f)),{code:'OFFICE_TOOL_FORBIDDEN'});
});
test('a source revision change during the provider call fails the read instead of returning mixed data',async t=>{
 const f=await fixture(t,{runner:async(item,{beforeQuery})=>{await beforeQuery();const list=db.loadModelConnections().items;list.find(i=>i.id==='db1').name='Renamed during query';db.replaceModelConnections(list);return {rows:[{A:1}]};}});
 await assert.rejects(f.registry.execute('source.query.read',{sourceId:'db1'},ctx(f)),{code:'SOURCE_CHANGED'});
 const g=await fixture(t,{runner:async()=>{throw Object.assign(new Error('provider PRIVATE detail'),{code:'X'});}});
 await assert.rejects(g.registry.execute('source.query.read',{sourceId:'db1'},ctx(g)),e=>e.code==='SOURCE_QUERY_FAILED'&&!/PRIVATE/.test(e.message));
});
test('saved query EXPORT is approval-gated, writes one native output file and refuses a changed result',async t=>{
 const f=await fixture(t),job=await f.service.taskCreate(f.profile,{agentId:f.agent.id,steps:[{toolId:'source.query.export',args:{query:{sourceId:'db1',maxRows:3},format:'xlsx',title:'DEMO saved query',language:'en'}}]});
 assert.equal(job.status,'waiting_approval');await assert.rejects(f.service.taskExecute(f.profile,job.id),{code:'OFFICE_APPROVAL_REQUIRED'});assert.equal(f.outputs.length,0);
 const done=await f.service.taskExecute(f.profile,job.id,{confirmed:true,fingerprint:job.steps[0].preview.fingerprint});assert.equal(done.status,'completed');assert.equal(f.outputs.length,1);assert.equal(done.steps[0].result.output.format,'xlsx');
 const sheet=f.outputs[0].spec.data.sheets.find(s=>s.name==='Report');assert.equal(sheet.rows.length,3);assert.doesNotMatch(JSON.stringify(f.outputs[0].spec),/PRIVATE_/);
 let n=0;const g=await fixture(t,{runner:async(item,{beforeQuery})=>{await beforeQuery();return {rows:[{A:++n}]};}}),j=await g.service.taskCreate(g.profile,{agentId:g.agent.id,steps:[{toolId:'source.query.export',args:{query:{sourceId:'db1'},format:'xlsx',title:'DEMO',language:'tr'}}]});
 assert.equal((await g.service.taskExecute(g.profile,j.id,{confirmed:true,fingerprint:j.steps[0].preview.fingerprint})).status,'failed');assert.equal(g.outputs.length,0);
});
test('Office HTTP errors keep the native source codes so the UI can explain them in TR/EN',()=>{
 const routes=fs.readFileSync(path.join(__dirname,'../server/routes/agent-office-routes.js'),'utf8'),ui=fs.readFileSync(path.join(__dirname,'../public/agent-office.js'),'utf8');
 for(const code of ['SOURCE_QUERY_UNAVAILABLE','SOURCE_QUERY_FAILED','SOURCE_PROFILE_NOT_ALLOWED','SOURCE_CREDENTIAL_PRESENT','SOURCE_LIMIT','SOURCE_EXISTS','SOURCE_REQUIRED','NAME_MISMATCH','MODULE_NOT_FEEDABLE']){assert.match(routes,new RegExp(`'${code}'`));assert.match(ui,new RegExp(`${code}:L\\('`));}
});
