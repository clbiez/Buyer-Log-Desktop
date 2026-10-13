'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'bl-agent-sources-'));
for(const key of ['BUYER_LOG_DATA_ROOT','BUYER_LOG_LOCAL_DATA_ROOT','BUYER_LOG_SERVER_DATA_ROOT','BUYER_LOG_AUTH_DATA_ROOT'])process.env[key]=root;
const db=require('../server/db'),adapter=require('../server/lib/data-domain/legacy-adapter'),{createSourceWorkflowService}=require('../server/lib/source-workflow-service');
const {createToolRegistry}=require('../server/lib/agent-tool-registry'),{createAgentOfficeStore}=require('../server/lib/agent-office-store'),{createAgentOfficeService}=require('../server/lib/agent-office-service'),{createAgentRuntime}=require('../server/lib/agent-runtime'),runtimeStore=require('../server/lib/agent-workflow-store'),{createPolicyEngine}=require('../server/lib/agent-policy-engine');
let sequence=0;test.after(()=>fs.rmSync(root,{recursive:true,force:true}));
const horizon=season=>({table:'ASAS',groups:[{id:'g',conditions:[{id:'c',table:'ASAS',field:'Season',op:'in',valueType:'text',values:[season]}]}]});
function setup(){return db.replaceModelConnections([{id:'asas',name:'Demo ASAS',server:'PRIVATE_SERVER',catalog:'PRIVATE_CATALOG',query:'PRIVATE_QUERY',role:'asas',defaultSeasonsApplied:true,scopes:[{id:'core',name:'Core',targets:['orders','backlog','lfl','priceanalysis'],horizon:horizon('W26')},{id:'cp',name:'CP',targets:['cp'],horizon:horizon('S26')}]},{id:'ias',name:'Demo IAS',server:'PRIVATE_IAS',catalog:'PRIVATE_IAS_DB',role:'antrepo',scopes:[{id:'icore',targets:['cp','backlog'],horizon:horizon('W26')},{id:'iorders',targets:['orders'],horizon:horizon('S26')}]}]).items;}
const source=id=>db.loadModelConnections().items.find(item=>item.id===id),values=(item,module)=>item.scopes.find(scope=>scope.targets.includes(module))?.horizon.groups[0]?.conditions[0]?.values;
async function fixture(t,hooks={}){
 setup();const profile={id:'source'+(++sequence),enabled:true,areas:['source'],permissions:['manageModelConnections']},access={profileById:id=>id===profile.id?profile:null,publicProfile:p=>p,hasArea:(p,a)=>p.areas.includes(a),hasPermission:(p,k)=>p.permissions.includes(k),appendAudit:()=>{}};
 let service;const store=createAgentOfficeStore({root:path.join(root,profile.id)}),registry=createToolRegistry({userAccess:access,authorizeCapability:(ctx,args)=>service.taskAuthorize(ctx,args)}),native=createSourceWorkflowService({db}),changes=[];
 require('../server/lib/agent-source-tools').registerSourceTools(registry,{source:native,changed:async()=>changes.push('modelConnections'),beforeBackup:hooks.beforeBackup,withAgentMutation:(ctx,work)=>store.withProfileMutation(ctx.ownerId,ctx.input.officeAgentId,ctx.input.officeAgentRevision,()=>{ctx.assertAuthority();return work();})});
 const runtime=createAgentRuntime({store:runtimeStore,toolRegistry:registry,policyEngine:createPolicyEngine({userAccess:access})});service=createAgentOfficeService({store,userAccess:access,toolRegistry:registry,runtime,runtimeStore,getOperationalData:async()=>({})});t.after(()=>service.stop());
 const agent=await store.createProfile(profile.id,{name:'Source workflows',areas:['source']});return {profile,access,store,registry,service,agent,native,changes};
}
const create=(f,toolId,args)=>f.service.taskCreate(f.profile,{agentId:f.agent.id,steps:[{toolId,args}]}),apply=(f,job)=>f.service.taskExecute(f.profile,job.id,{confirmed:true,fingerprint:job.steps[0].preview.fingerprint}),undo=(f,job)=>f.service.taskRollback(f.profile,job.id,{stepId:job.steps[0].id,confirmed:true});
test('native shared filter approval writes the real source, declares all affected modules, survives unrelated edits and restores only its own source',async t=>{
 const f=await fixture(t),before=source('ias'),job=await create(f,'source.filter.update',{sourceId:'ias',moduleId:'cp',mode:'shared',definition:horizon('W27')});assert.equal(job.status,'waiting_approval');assert.deepEqual(job.steps[0].preview.preview.impact.modules.sort(),['backlog','cp']);
 await assert.rejects(f.service.taskExecute(f.profile,job.id),{code:'OFFICE_APPROVAL_REQUIRED'});
 const list=db.loadModelConnections().items;list.find(item=>item.id==='asas').name='Other native edit';db.replaceModelConnections(list);
 const result=await apply(f,job);assert.equal(result.status,'completed');assert.deepEqual(values(source('ias'),'cp'),['W27']);assert.deepEqual(values(source('ias'),'backlog'),['W27']);assert.equal(source('asas').name,'Other native edit');assert.ok(f.changes.length);
 const later=db.loadModelConnections().items;later.find(item=>item.id==='asas').name='Later independent edit';db.replaceModelConnections(later);db.recordModelConnectionRun('ias',{at:'2026-10-11T12:00:00Z',ok:true,rowCount:12});
 await undo(f,result);assert.deepEqual(values(source('ias'),'cp'),values(before,'cp'));assert.equal(source('ias').lastRun.rowCount,12);assert.equal(source('asas').name,'Later independent edit');assert.equal((await apply(f,job)).steps[0].result.data.sourceRevision,result.steps[0].result.data.sourceRevision);
 assert.doesNotMatch(JSON.stringify(result),/PRIVATE_SERVER|PRIVATE_CATALOG|PRIVATE_QUERY|PRIVATE_IAS/);
});
test('native split preview remains stable despite generated scope IDs and changes only the selected module',async t=>{
 const f=await fixture(t),args={sourceId:'ias',moduleId:'cp',mode:'split',definition:horizon('W28'),name:'Dedicated CP'};
 const first=await f.registry.execute('source.filter.update',args,{ownerId:f.profile.id,profile:f.profile,dryRun:true}),second=await f.registry.execute('source.filter.update',args,{ownerId:f.profile.id,profile:f.profile,dryRun:true});assert.equal(first.fingerprint,second.fingerprint);
 const result=await apply(f,await create(f,'source.filter.update',args));assert.equal(result.status,'completed');assert.deepEqual(values(source('ias'),'cp'),['W28']);assert.deepEqual(values(source('ias'),'backlog'),['W26']);await undo(f,result);assert.deepEqual(values(source('ias'),'cp'),['W26']);
});
test('native binding parks and restores the real filter; required feeds cannot be disabled',async t=>{
 const f=await fixture(t),before=values(source('ias'),'orders');const result=await apply(f,await create(f,'source.binding.update',{sourceId:'ias',moduleId:'orders',enabled:false}));assert.equal(result.status,'completed');assert.equal(values(source('ias'),'orders'),undefined);assert.ok(source('ias').parkedBindings.some(item=>item.moduleId==='orders'));
 const enabled=await apply(f,await create(f,'source.binding.update',{sourceId:'ias',moduleId:'orders',enabled:true}));assert.equal(enabled.status,'completed');assert.deepEqual(values(source('ias'),'orders'),before);
 await assert.rejects(create(f,'source.binding.update',{sourceId:'asas',moduleId:'orders',enabled:false}),e=>e.code==='BINDING_REQUIRED'||e.code==='BINDING_LOCKED');
});
test('native link joins the existing group, preserves its filter and restores the original filter on unlink',async t=>{
 const f=await fixture(t),before=values(source('asas'),'cp'),job=await create(f,'source.link.update',{sourceId:'asas',moduleId:'cp',linked:true}),result=await apply(f,job);assert.equal(result.status,'completed');assert.ok(source('asas').linkedTargets.includes('cp'));assert.deepEqual(values(source('asas'),'cp'),['W26']);
 const split=await apply(f,await create(f,'source.link.update',{sourceId:'asas',moduleId:'cp',linked:false}));assert.equal(split.status,'completed');assert.deepEqual(values(source('asas'),'cp'),before);await undo(f,split);assert.ok(source('asas').linkedTargets.includes('cp'));
});
test('source IAM and agent revision changes prevent effects after asynchronous backup staging',async t=>{
 let f;f=await fixture(t,{beforeBackup:async()=>{await f.store.updateProfile(f.profile.id,f.agent.id,{enabled:false});}});const before=adapter.configRevision(source('ias')),job=await create(f,'source.filter.update',{sourceId:'ias',moduleId:'cp',mode:'shared',definition:horizon('W29')});assert.equal((await apply(f,job)).status,'failed');assert.equal(adapter.configRevision(source('ias')),before);
 const g=await fixture(t),pending=await create(g,'source.binding.update',{sourceId:'ias',moduleId:'orders',enabled:false});g.profile.permissions=[];await assert.rejects(apply(g,pending),{code:'OFFICE_TOOL_FORBIDDEN'});assert.ok(values(source('ias'),'orders'));
});
test('stale source approval and ABA configurations reject writes and inverses without harming native changes',async t=>{
 const f=await fixture(t),before=source('ias'),job=await create(f,'source.filter.update',{sourceId:'ias',moduleId:'cp',mode:'shared',definition:horizon('W30')});
 let list=db.loadModelConnections().items;list.find(item=>item.id==='ias').name='Changed';db.replaceModelConnections(list);list=db.loadModelConnections().items;list[list.findIndex(item=>item.id==='ias')]=before;db.replaceModelConnections(list);
 assert.equal((await apply(f,job)).status,'failed');assert.deepEqual(values(source('ias'),'cp'),['W26']);
 const done=await apply(f,await create(f,'source.filter.update',{sourceId:'ias',moduleId:'cp',mode:'shared',definition:horizon('W30')}));list=db.loadModelConnections().items;list.find(item=>item.id==='ias').name='Newer';db.replaceModelConnections(list);await assert.rejects(undo(f,done),{code:'SOURCE_CHANGED'});assert.equal(source('ias').name,'Newer');
});
test('read projection excludes private connection, query, credential and diagnostic material',async t=>{
 const f=await fixture(t);db.recordModelConnectionRun('asas',{at:'2026-10-11T12:00:00Z',ok:false,error:'PRIVATE_SERVER',outFile:'PRIVATE_FILE'});
 const result=await f.registry.execute('source.configuration.read',{limit:1},{ownerId:f.profile.id,profile:f.profile});assert.equal(result.data.sources.length,1);assert.equal(result.data.truncated,true);assert.doesNotMatch(JSON.stringify(result),/PRIVATE_|server|catalog|connector|password|outFile/);assert.ok(result.data.sources[0].sourceRevision);
});
test('strict filter contracts reject arbitrary expressions, query/connection arguments and forged schema authority',async t=>{
 const f=await fixture(t),args={sourceId:'ias',moduleId:'cp',mode:'shared',definition:horizon('W31')};for(const extra of [{query:'DROP'},{server:'x'}])await assert.rejects(create(f,'source.filter.update',{...args,...extra}),{code:'OFFICE_TOOL_SCHEMA'});
 await assert.rejects(create(f,'source.filter.update',{...args,definition:{...args.definition,extraExpression:'EVALUATE'}}),{code:'OFFICE_TOOL_SCHEMA'});
 const forged=horizon('W31');forged.groups[0].conditions[0].valueTypeSource='schema';await assert.rejects(create(f,'source.filter.update',{...args,definition:forged}),{code:'OFFICE_TOOL_SCHEMA'});
});
test('native same-source concurrent writers use one actual lease; a second stale writer cannot overwrite the first',async t=>{
 const f=await fixture(t),expected=adapter.configRevision(source('ias')),guard={assertAuthority:()=>f.profile};const results=await Promise.allSettled([f.native.update('filter',{sourceId:'ias',moduleId:'cp',mode:'shared',definition:horizon('W32')},expected,guard),f.native.update('binding',{sourceId:'ias',moduleId:'orders',enabled:false},expected,guard)]);assert.equal(results.filter(item=>item.status==='fulfilled').length,1);assert.equal(results.find(item=>item.status==='rejected').reason.code,'SOURCE_CHANGED');assert.ok(values(source('ias'),'orders'));assert.deepEqual(values(source('ias'),'cp'),['W32']);
});
test('model fields are discovered from saved native mappings or horizons; unknown fields and unstable IDs are rejected',async t=>{
 const f=await fixture(t),read=await f.registry.execute('source.configuration.read',{sourceIds:['ias']},{ownerId:f.profile.id,profile:f.profile});assert.ok(read.data.sources[0].fields.some(item=>item.table==='ASAS'&&item.field==='Season'));
 const args={sourceId:'ias',moduleId:'cp',mode:'shared',definition:horizon('W27')};args.definition.groups[0].conditions[0].field='Invented field';await assert.rejects(create(f,'source.filter.update',args),{code:'OFFICE_FIELD_INVALID'});
 args.definition=horizon('W27');args.definition.groups[0].id=' ';await assert.rejects(create(f,'source.filter.update',args),{code:'OFFICE_TOOL_SCHEMA'});args.definition=horizon('W27');args.definition.groups[0].conditions[0].id='g';await assert.rejects(create(f,'source.filter.update',args),{code:'OFFICE_TOOL_SCHEMA'});
 args.definition={table:'ASAS',seasonTable:'ASAS',seasonField:'Invented field',seasons:['W27']};await assert.rejects(create(f,'source.filter.update',args),{code:'OFFICE_FIELD_INVALID'});
});
test('bounded source output and previews report omitted legacy conditions while impact uses complete native definitions',async t=>{
 const f=await fixture(t),list=db.loadModelConnections().items,large={table:'ASAS',groups:Array.from({length:10},(_,g)=>({id:'g'+g,conditions:Array.from({length:40},(_,c)=>({id:'c'+g+'_'+c,table:'ASAS',field:'Season',op:'in',valueType:'text',values:Array.from({length:500},(_,v)=>'W'+v)}))}))};list.find(item=>item.id==='ias').scopes.find(scope=>scope.targets.includes('cp')).horizon=large;db.replaceModelConnections(list);
 const read=await f.registry.execute('source.configuration.read',{sourceIds:['ias']},{ownerId:f.profile.id,profile:f.profile});assert.ok(Buffer.byteLength(JSON.stringify(read))<128*1024);assert.equal(read.data.sources[0].scopes.find(scope=>scope.targets.includes('cp')).horizon.conditionCount,400);assert.equal(read.data.sources[0].scopes.find(scope=>scope.targets.includes('cp')).horizon.definitionTruncated,true);
 const job=await create(f,'source.filter.update',{sourceId:'ias',moduleId:'cp',mode:'shared',definition:horizon('W27')});assert.deepEqual(job.steps[0].preview.preview.impact.modules.sort(),['backlog','cp']);assert.ok(Buffer.byteLength(JSON.stringify(job.steps[0].preview))<128*1024);
 const done=await apply(f,job);assert.equal(done.status,'completed');await undo(f,done);assert.equal(source('ias').scopes.find(scope=>scope.targets.includes('cp')).horizon.groups[9].conditions[39].values.length,500);
});
test('a native source edit during backup staging is retained and prevents the approved effect',async t=>{
 const f=await fixture(t,{beforeBackup:async()=>{const list=db.loadModelConnections().items;list.find(item=>item.id==='ias').name='Concurrent native edit';db.replaceModelConnections(list);}}),job=await create(f,'source.filter.update',{sourceId:'ias',moduleId:'cp',mode:'shared',definition:horizon('W27')});assert.equal((await apply(f,job)).status,'failed');assert.equal(source('ias').name,'Concurrent native edit');assert.deepEqual(values(source('ias'),'cp'),['W26']);assert.equal(f.changes.length,0);
});
test('private inverse bytes are owner isolated even when another user has the same source permissions',async t=>{
 const f=await fixture(t),done=await apply(f,await create(f,'source.binding.update',{sourceId:'ias',moduleId:'orders',enabled:false})),token=done.steps[0].result.rollbackToken,g=await fixture(t);await assert.rejects(g.registry.rollback('source.binding.update',token,{ownerId:g.profile.id,profile:g.profile,approvalGranted:true,input:{officeAgentId:g.agent.id,officeAgentRevision:g.agent.revision}}),{code:'OFFICE_NOT_FOUND'});
});
test('duplicate legacy source IDs fail closed before planning or writing',async t=>{
 const f=await fixture(t),list=db.loadModelConnections().items,copy=JSON.parse(JSON.stringify(source('ias')));list.push({...copy,name:'Duplicate legacy record'});db.replaceModelConnections(list);await assert.rejects(create(f,'source.binding.update',{sourceId:'ias',moduleId:'orders',enabled:false}),{code:'SOURCE_AMBIGUOUS'});assert.equal(db.loadModelConnections().items.filter(item=>item.id==='ias').length,2);assert.ok(values(source('ias'),'orders'));
});
for(const mode of ['delta','delta-only'])test(mode+' rechecks live authority in the actual journal transaction after queue waits, including inverse',async t=>{
 const local=require('../server/lib/local-db').createLocalDb(path.join(root,'commit-authority-'+mode+'.db')),delta=require('../server/lib/delta-store').createDeltaStore({localDb:local,mode});assert.equal((await delta.hydrate()).ok,true);db.attachDeltaStore(delta);t.after(()=>db.attachDeltaStore(null));
 const f=await fixture(t);assert.equal((await delta.flush()).ok,true);const before=adapter.configRevision(source('ias')),job=await create(f,'source.filter.update',{sourceId:'ias',moduleId:'cp',mode:'shared',definition:horizon('W99')}),queue=local.queuePatches.bind(local);let revoke=true;
 local.queuePatches=async(...args)=>{if(revoke){revoke=false;f.profile.permissions=[];await Promise.resolve();}return queue(...args);};const result=await apply(f,job);assert.equal(result.status,'failed');assert.equal(result.steps[0].errorCode,'OFFICE_TOOL_FORBIDDEN');
 const reopened=require('../server/lib/delta-store').createDeltaStore({localDb:require('../server/lib/local-db').createLocalDb(local.file),mode});assert.equal((await reopened.hydrate()).ok,true);db.attachDeltaStore(reopened);assert.equal(adapter.configRevision(source('ias')),before);assert.deepEqual(values(source('ias'),'cp'),['W26']);db.attachDeltaStore(delta);
 f.profile.permissions=['manageModelConnections'];local.queuePatches=queue;const done=await apply(f,await create(f,'source.filter.update',{sourceId:'ias',moduleId:'cp',mode:'shared',definition:horizon('W98')}));assert.equal(done.status,'completed');const committed=adapter.configRevision(source('ias'));revoke=true;local.queuePatches=async(...args)=>{if(revoke){revoke=false;f.profile.permissions=[];await Promise.resolve();}return queue(...args);};await assert.rejects(undo(f,done),{code:'OFFICE_TOOL_FORBIDDEN'});
 const secondReader=require('../server/lib/delta-store').createDeltaStore({localDb:require('../server/lib/local-db').createLocalDb(local.file),mode});assert.equal((await secondReader.hydrate()).ok,true);db.attachDeltaStore(secondReader);assert.equal(adapter.configRevision(source('ias')),committed);assert.deepEqual(values(source('ias'),'cp'),['W98']);db.attachDeltaStore(delta);
});
