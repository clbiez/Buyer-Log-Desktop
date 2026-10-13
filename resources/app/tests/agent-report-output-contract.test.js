'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'bl-report-contract-'));
for(const key of ['BUYER_LOG_DATA_ROOT','BUYER_LOG_LOCAL_DATA_ROOT','BUYER_LOG_SERVER_DATA_ROOT','BUYER_LOG_AUTH_DATA_ROOT'])process.env[key]=root;
const {createToolRegistry}=require('../server/lib/agent-tool-registry'),{registerAnalyticsTools,registerReportCapability}=require('../server/lib/agent-analytics-tools');
const {validate}=require('../server/lib/agent-tool-schema'),{createOutputService}=require('../server/lib/lcwai-output/output-service'),{createOutputStore}=require('../server/lib/lcwai-output/output-store');
const {createAgentOfficeStore}=require('../server/lib/agent-office-store'),{createAgentOfficeService}=require('../server/lib/agent-office-service'),{createAgentRuntime}=require('../server/lib/agent-runtime');
const runtimeStore=require('../server/lib/agent-workflow-store'),{createPolicyEngine}=require('../server/lib/agent-policy-engine');
test.after(()=>fs.rmSync(root,{recursive:true,force:true}));let serial=0;
async function fixture(t){
 const owner='report'+(++serial),profile={id:owner,enabled:true,areas:['backlog']},access={profileById:()=>profile,publicProfile:p=>p,hasArea:(p,a)=>p.areas.includes(a),appendAudit:()=>{}},store=createAgentOfficeStore({root:path.join(root,owner)});let service;
 const rows=[{'Order Code':1234567,Manufacturer:'DEMO','Order Quantity':12,'Ex-factory':'2026-10-01'}],dataset=async()=>rows,outputOptions={root:path.join(root,owner,'outputs'),indexFile:path.join(root,owner,'index.json')};
 const output=createOutputService({store:createOutputStore(outputOptions),engine:{chat:()=>{throw new Error('Deterministic exports must not invoke AI');}}});
 const registry=createToolRegistry({userAccess:access,getDataset:dataset,authorizeCapability:(ctx,args)=>service.taskAuthorize(ctx,args)});registerAnalyticsTools(registry,{dataset,outputService:()=>output});
 const runtime=createAgentRuntime({store:runtimeStore,toolRegistry:registry,policyEngine:createPolicyEngine({userAccess:access})});
 service=createAgentOfficeService({store,userAccess:access,toolRegistry:registry,runtime,runtimeStore,outputService:()=>output,taskOwners:()=>[],getOperationalData:async()=>({})});t.after(()=>service.stop());
 const agent=await store.createProfile(owner,{name:'Backlog',areas:['backlog']});return {profile,store,service,output,outputOptions,agent,registry};
}
async function job(f,format){return f.service.taskCreate(f.profile,{agentId:f.agent.id,steps:[{toolId:'backlog.analysis.export',args:{query:{dimensions:['manufacturer'],measures:[{op:'sum',field:'orderQuantity',as:'quantity'}]},format,title:'DEMO report',language:'en'}}]});}
const approve=(f,j)=>f.service.taskExecute(f.profile,j.id,{confirmed:true,fingerprint:j.steps[0].preview.fingerprint});
const resultSchema=f=>f.registry.get('backlog.analysis.export').outputSchema;
test('schema alternatives enforce a branch while still enforcing the surrounding strict object',()=>{
 const schema={type:'object',properties:{kind:{enum:['a','b']},value:{type:['number','string']}},required:['kind','value'],additionalProperties:false,anyOf:[{type:'object',properties:{kind:{enum:['a']},value:{type:'number'}},required:['kind','value']},{type:'object',properties:{kind:{enum:['b']},value:{type:'string'}},required:['kind','value']}]};
 validate(schema,{kind:'a',value:1});validate(schema,{kind:'b',value:'x'});
 assert.throws(()=>validate(schema,{kind:'a',value:'x'}),{code:'OFFICE_TOOL_SCHEMA'});
 assert.throws(()=>validate(schema,{kind:'b',value:'x',private:'secret'}),{code:'OFFICE_TOOL_SCHEMA'});
});
test('all twelve native report exporters declare the same strict, discriminated receipt contract',()=>{
 const registry=createToolRegistry({getDataset:async()=>[]}),registerReport=spec=>registerReportCapability(registry,spec,()=>({}));registerAnalyticsTools(registry,{dataset:async()=>[],outputService:()=>({})});
 require('../server/lib/agent-collection-tools').registerCollectionTools(registry,{registerReport});require('../server/lib/agent-open-costing-tools').registerOpenCostingTools(registry,{registerReport});require('../server/lib/agent-shipping-tools').registerShippingTools(registry,{registerReport});
 const tools=registry.catalog().filter(t=>t.operation==='EXPORT');assert.equal(tools.length,12);
 for(const tool of tools){assert.equal(tool.outputSchema.additionalProperties,false,tool.id);assert.equal(tool.outputSchema.anyOf.length,3,tool.id);}
});
for(const format of ['html','xlsx'])test(format+' export returns a verified receipt for the actual owner file without private paths',async t=>{
 const f=await fixture(t),j=await approve(f,await job(f,format)),result=j.steps[0].result;assert.equal(j.status,'completed');validate(resultSchema(f),result);
 const record=await f.service.taskOutputFile(f.profile,j.id,j.steps[0].id);assert.equal(result.output.bytes,fs.statSync(record.path).size);assert.equal(result.output.requestId,record.requestId);assert.equal(result.output.fileName,record.fileName);assert.equal(result.output.format,format);assert.equal(f.output.get('someone-else',result.output.id),null);
 assert.deepEqual(Object.keys(result.output).sort(),['bytes','fileName','format','id','requestId']);assert.equal(record.attempts,0);
 if(format==='xlsx'){const xlsx=require('xlsx'),book=xlsx.readFile(record.path);assert.equal(xlsx.utils.sheet_to_json(book.Sheets.Report)[0].quantity,12);}else assert.match(fs.readFileSync(record.path,'utf8'),/DEMO/);
});
test('PDF pending receipt remains typed and private after output-store restart',async t=>{
 const f=await fixture(t),j=await approve(f,await job(f,'pdf')),result=j.steps[0].result;assert.equal(j.status,'waiting_output');validate(resultSchema(f),result);assert.equal(result.completionPending,'pdf');assert.deepEqual(Object.keys(result.output).sort(),['format','pendingId','requestId']);
 const restored=createOutputStore(f.outputOptions),pending=restored.takePending(f.profile.id,result.output.pendingId,{keep:true});assert.equal(pending.stage,'pdf');assert.equal(pending.requestId,result.output.requestId);assert.match(pending.html,/DEMO/);assert.equal(restored.takePending('someone-else',result.output.pendingId,{keep:true}),null);
});
for(const fallback of [false,true])test('finalized '+(fallback?'explicit HTML fallback':'PDF')+' receipt satisfies the exported tool contract',async t=>{
 const f=await fixture(t);let j=await approve(f,await job(f,'pdf'));const record=await f.service.taskPrintOutput(f.profile,j.id,j.steps[0].id,fallback?null:Buffer.from('%PDF-'+'.'.repeat(100)));
 if(fallback)await assert.rejects(f.service.taskCompleteOutput(f.profile,j.id,{stepId:j.steps[0].id,outputId:record.id}),{code:'OFFICE_OUTPUT_INVALID'});
 j=await f.service.taskCompleteOutput(f.profile,j.id,{stepId:j.steps[0].id,outputId:record.id,acceptFallback:fallback});assert.equal(j.status,'completed');validate(resultSchema(f),j.steps[0].result);assert.equal(j.steps[0].result.output.format,fallback?'html':'pdf');assert.equal(j.steps[0].result.fallback,fallback?'html':undefined);
});
test('receipt contract rejects contradictory states, malformed IDs, missing fields and private metadata',async t=>{
 const f=await fixture(t),j=await approve(f,await job(f,'html')),schema=resultSchema(f),result=j.steps[0].result;
 for(const invalid of [{...result,completionPending:'pdf'},{...result,output:{...result.output,pendingId:'a'.repeat(24)}},{...result,output:{...result.output,id:'another'}},{...result,output:{...result.output,bytes:0}},{...result,output:{...result.output,path:'/private/file'}},{...result,fallback:'html'},{...result,fallback:'html',requestedFormat:'xlsx'}, {verified:true,completionPending:'pdf',output:{pendingId:'a'.repeat(24),format:'html',requestId:'b'.repeat(64)}}])assert.throws(()=>validate(schema,invalid),{code:'OFFICE_TOOL_SCHEMA'});
});
