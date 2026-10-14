'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'bl-agent-source-lifecycle-'));
for(const key of ['BUYER_LOG_DATA_ROOT','BUYER_LOG_LOCAL_DATA_ROOT','BUYER_LOG_SERVER_DATA_ROOT','BUYER_LOG_AUTH_DATA_ROOT'])process.env[key]=root;
const db=require('../server/db'),adapter=require('../server/lib/data-domain/legacy-adapter'),{createSourceWorkflowService}=require('../server/lib/source-workflow-service');
const {createToolRegistry}=require('../server/lib/agent-tool-registry'),{createAgentOfficeStore}=require('../server/lib/agent-office-store'),{createAgentOfficeService}=require('../server/lib/agent-office-service'),{createAgentRuntime}=require('../server/lib/agent-runtime'),runtimeStore=require('../server/lib/agent-workflow-store'),{createPolicyEngine}=require('../server/lib/agent-policy-engine');
let sequence=0;test.after(()=>fs.rmSync(root,{recursive:true,force:true}));
function setup(){return db.replaceModelConnections([{id:'asas',name:'Demo ASAS',server:'PRIVATE_SERVER',catalog:'PRIVATE_CATALOG',query:'PRIVATE_QUERY',role:'asas',defaultSeasonsApplied:true,scopes:[{id:'core',name:'Core',targets:['orders','backlog','lfl','priceanalysis'],horizon:{}},{id:'cp',name:'CP',targets:['cp'],horizon:{}}]},{id:'ias',name:'Demo IAS',server:'PRIVATE_IAS',catalog:'PRIVATE_IAS_DB',role:'antrepo',refreshEnabled:false,scopes:[]},{id:'custom1',name:'Demo Custom',server:'PRIVATE_CUSTOM',catalog:'PRIVATE_CUSTOM_DB',query:'PRIVATE_QUERY',role:'custom',refreshEnabled:false,scopes:[]}]).items;}
const source=id=>db.loadModelConnections().items.find(item=>item.id===id),ids=()=>db.loadModelConnections().items.map(item=>item.id);
async function fixture(t,hooks={}){
 setup();const profile={id:'lifecycle'+(++sequence),enabled:true,areas:['source'],permissions:['manageModelConnections']},access={profileById:id=>id===profile.id?profile:null,publicProfile:p=>p,hasArea:(p,a)=>p.areas.includes(a),hasPermission:(p,k)=>p.permissions.includes(k),appendAudit:()=>{}};
 let service;const store=createAgentOfficeStore({root:path.join(root,profile.id)}),registry=createToolRegistry({userAccess:access,authorizeCapability:(ctx,args)=>service.taskAuthorize(ctx,args)}),native=createSourceWorkflowService({db}),changes=[],credentials=new Set(hooks.credentials||[]);
 require('../server/lib/agent-source-tools').registerSourceLifecycleTools(registry,{source:native,hasCredential:id=>credentials.has(id),changed:async(_p,_s,detail)=>changes.push(detail),beforeBackup:hooks.beforeBackup,withAgentMutation:(ctx,work)=>store.withProfileMutation(ctx.ownerId,ctx.input.officeAgentId,ctx.input.officeAgentRevision,()=>{ctx.assertAuthority();return work();})});
 const runtime=createAgentRuntime({store:runtimeStore,toolRegistry:registry,policyEngine:createPolicyEngine({userAccess:access})});service=createAgentOfficeService({store,userAccess:access,toolRegistry:registry,runtime,runtimeStore,getOperationalData:async()=>({})});t.after(()=>service.stop());
 const agent=await store.createProfile(profile.id,{name:'Source lifecycle',areas:['source']});return {profile,store,registry,service,agent,native,changes,credentials};
}
const create=(f,toolId,args)=>f.service.taskCreate(f.profile,{agentId:f.agent.id,steps:[{toolId,args}]}),apply=(f,job)=>f.service.taskExecute(f.profile,job.id,{confirmed:true,fingerprint:job.steps[0].preview.fingerprint}),undo=(f,job)=>f.service.taskRollback(f.profile,job.id,{stepId:job.steps[0].id,confirmed:true});
const newSource={name:'DEMO IAS Lines',profileId:'ias-warehouse',targetSourceId:'ias',moduleIds:['backlog']};

test('CREATE copies an existing configured target, never exposes it, needs approval and inverses only the created source',async t=>{
 const f=await fixture(t),before=ids(),job=await create(f,'source.connection.create',newSource),preview=job.steps[0].preview.preview;
 assert.equal(job.status,'waiting_approval');assert.doesNotMatch(JSON.stringify(job),/PRIVATE_/);assert.ok(preview.impact.modules.includes('backlog'));assert.equal(preview.after.name,'DEMO IAS Lines');
 await assert.rejects(f.service.taskExecute(f.profile,job.id),{code:'OFFICE_APPROVAL_REQUIRED'});assert.deepEqual(ids(),before);
 const done=await apply(f,job);assert.equal(done.status,'completed');const createdId=done.steps[0].result.data.sourceId,created=source(createdId);
 assert.ok(done.steps[0].result.data.warnings.every(w=>w.includes(' / ')),'bilingual native warnings');assert.equal(created.server,'PRIVATE_IAS');assert.equal(created.catalog,'PRIVATE_IAS_DB');assert.equal(created.role,'antrepo');assert.doesNotMatch(JSON.stringify(done.steps[0].result),/PRIVATE_/);
 const list=db.loadModelConnections().items;list.find(item=>item.id==='asas').name='Peer edit';db.replaceModelConnections(list);
 await undo(f,done);assert.deepEqual(ids(),before);assert.equal(source('asas').name,'Peer edit');
});
test('CREATE accepts no host, model, SQL or credential and rejects non-manual profiles, unknown targets and unfeedable modules before effects',async t=>{
 const f=await fixture(t),before=JSON.stringify(db.loadModelConnections().items);
 for(const extra of [{server:'evil'},{catalog:'x'},{query:'DROP'},{password:'p'}])await assert.rejects(create(f,'source.connection.create',{...newSource,...extra}),{code:'OFFICE_TOOL_SCHEMA'});
 await assert.rejects(create(f,'source.connection.create',{...newSource,profileId:'custom-database'}),{code:'SOURCE_PROFILE_NOT_ALLOWED'});
 await assert.rejects(create(f,'source.connection.create',{...newSource,targetSourceId:'missing'}),{code:'SOURCE_NOT_FOUND'});
 await assert.rejects(create(f,'source.connection.create',{...newSource,moduleIds:['intake']}),{code:'MODULE_NOT_FEEDABLE'});
 assert.equal(JSON.stringify(db.loadModelConnections().items),before);
});
test('CREATE refuses a stale preview and an edited created source cannot be removed by its inverse',async t=>{
 const f=await fixture(t),job=await create(f,'source.connection.create',newSource);
 const list=db.loadModelConnections().items;list.find(item=>item.id==='asas').name='Moved';db.replaceModelConnections(list);
 assert.equal((await apply(f,job)).status,'failed');
 const done=await apply(f,await create(f,'source.connection.create',newSource)),createdId=done.steps[0].result.data.sourceId;
 const edited=db.loadModelConnections().items;edited.find(item=>item.id===createdId).name='User renamed';db.replaceModelConnections(edited);
 await assert.rejects(undo(f,done),{code:'SOURCE_CHANGED'});assert.equal(source(createdId).name,'User renamed');
});
test('DELETE uses native required-module protection, refuses credential-bearing sources and restores the exact configuration at its position',async t=>{
 const f=await fixture(t,{credentials:['secured']});
 await assert.rejects(create(f,'source.connection.delete',{sourceId:'asas'}),{code:'SOURCE_REQUIRED'});await assert.rejects(create(f,'source.connection.delete',{sourceId:'ias'}),{code:'SOURCE_REQUIRED'});
 const list=db.loadModelConnections().items;list.push({id:'secured',name:'Secured',server:'S',catalog:'C',role:'custom',refreshEnabled:false,scopes:[]});db.replaceModelConnections(list);
 await assert.rejects(create(f,'source.connection.delete',{sourceId:'secured'}),{code:'SOURCE_CREDENTIAL_PRESENT'});
 await assert.rejects(create(f,'source.connection.delete',{sourceId:'custom1',expectedName:'Wrong'}),{code:'NAME_MISMATCH'});
 const before=JSON.stringify(source('custom1')),order=ids(),job=await create(f,'source.connection.delete',{sourceId:'custom1',expectedName:'Demo Custom'});
 assert.doesNotMatch(JSON.stringify(job),/PRIVATE_/);const done=await apply(f,job);assert.equal(done.status,'completed');assert.ok(!ids().includes('custom1'));
 await undo(f,done);assert.deepEqual(ids(),order);const restored=source('custom1');assert.equal(restored.server,'PRIVATE_CUSTOM');assert.equal(restored.query,'PRIVATE_QUERY');
 assert.equal(require('../server/lib/data-domain/legacy-adapter').configRevision({...restored,_configVersion:0}),require('../server/lib/data-domain/legacy-adapter').configRevision({...JSON.parse(before),_configVersion:0}));
});
test('DELETE inverse refuses an id clash and IAM loss stops create and delete before effects',async t=>{
 const f=await fixture(t),done=await apply(f,await create(f,'source.connection.delete',{sourceId:'custom1'}));
 const list=db.loadModelConnections().items;list.push({id:'custom1',name:'Recreated by user',server:'X',catalog:'Y',role:'custom',refreshEnabled:false,scopes:[]});db.replaceModelConnections(list);
 await assert.rejects(undo(f,done),{code:'SOURCE_EXISTS'});assert.equal(source('custom1').name,'Recreated by user');
 const g=await fixture(t),before=ids(),c=await create(g,'source.connection.create',newSource),d=await create(g,'source.connection.delete',{sourceId:'custom1'});g.profile.permissions=[];
 await assert.rejects(apply(g,c),{code:'OFFICE_TOOL_FORBIDDEN'});await assert.rejects(apply(g,d),{code:'OFFICE_TOOL_FORBIDDEN'});assert.deepEqual(ids(),before);
});
