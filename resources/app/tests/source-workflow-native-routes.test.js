'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'bl-source-routes-'));for(const key of ['BUYER_LOG_DATA_ROOT','BUYER_LOG_LOCAL_DATA_ROOT','BUYER_LOG_SERVER_DATA_ROOT','BUYER_LOG_AUTH_DATA_ROOT'])process.env[key]=root;
const db=require('../server/db'),{createSourceWorkflowService}=require('../server/lib/source-workflow-service'),adapter=require('../server/lib/data-domain/legacy-adapter');test.after(()=>fs.rmSync(root,{recursive:true,force:true}));
const H=season=>({table:'ASAS',groups:[{id:'g',conditions:[{id:'c',table:'ASAS',field:'Season',op:'in',valueType:'text',values:[season]}]}]});
function fixture(){
 db.replaceModelConnections([{id:'ias',name:'Demo IAS',server:'s',catalog:'c',role:'antrepo',scopes:[{id:'core',targets:['cp','backlog'],horizon:H('W26')},{id:'orders',targets:['orders'],horizon:H('S26')}]},{id:'asas',name:'Demo ASAS',server:'s',catalog:'c',role:'asas',scopes:[{id:'cp',targets:['cp'],horizon:H('S26')},{id:'core',targets:['orders','backlog','lfl','priceanalysis'],horizon:H('W26')}]}]);
 const routes=new Map(),app=Object.fromEntries(['get','post','put','patch','delete'].map(method=>[method,(url,...handlers)=>routes.set(method+' '+url,handlers.at(-1))])),profile={id:'native',enabled:true,areas:['source'],permissions:['manageModelConnections']},access={profileById:()=>profile,hasArea:(p,a)=>p.areas.includes(a),hasPermission:(p,a)=>p.permissions.includes(a),requireArea:()=>()=>{},requirePermission:()=>()=>{},appendAudit:()=>{}},events=[],service=createSourceWorkflowService({db});
 require('../server/routes/horizon-template-routes')(app,{...db,sourceWorkflowService:service,userAccess:access,express:{json:()=>()=>{}},publishSharedMasterChange:section=>events.push(section),apiError:(res,err)=>res.status(err.statusCode||500).json({code:err.code}),dataManagementAdapter:adapter});
 const invoke=async(kind,body)=>{let response,status=200;const res={status:code=>{status=code;return res;},json:value=>{response=value;return res;}};await routes.get('post /api/data-management/'+kind)({body,currentUser:profile},res);return {status,response};};return {profile,invoke,events};
}
const source=id=>db.loadModelConnections().items.find(item=>item.id===id);
test('actual native UI shared-filter route uses the same source transaction and real per-source CAS',async()=>{
 const f=fixture(),expected=adapter.configRevision(source('ias')),response=await f.invoke('filter',{sourceId:'ias',moduleId:'cp',mode:'shared',definition:H('W27'),expectedSourceRevision:expected});assert.equal(response.status,200);assert.equal(response.response.verified,true);assert.deepEqual(source('ias').scopes.find(s=>s.targets.includes('cp')).horizon.groups[0].conditions[0].values,['W27']);assert.deepEqual(f.events,['modelConnections']);
 const stale=await f.invoke('filter',{sourceId:'ias',moduleId:'cp',mode:'shared',definition:H('W28'),expectedSourceRevision:expected});assert.equal(stale.status,409);assert.equal(stale.response.code,'SOURCE_CHANGED');assert.equal(f.events.length,1);
});
test('actual native binding and link route semantics remain unchanged, including no-op receipts and parked filters',async()=>{
 const f=fixture();let result=await f.invoke('binding',{sourceId:'ias',moduleId:'orders',enabled:false});assert.equal(result.status,200);assert.equal(result.response.changed,true);assert.ok(source('ias').parkedBindings.length);result=await f.invoke('binding',{sourceId:'ias',moduleId:'orders',enabled:false});assert.equal(result.response.changed,false);assert.equal(f.events.length,1);
 result=await f.invoke('link',{sourceId:'asas',moduleId:'cp',linked:true});assert.equal(result.status,200);assert.ok(source('asas').linkedTargets.includes('cp'));assert.ok(source('asas').linkRestore.some(entry=>entry.moduleId==='cp'));
 result=await f.invoke('link',{sourceId:'asas',moduleId:'cp',linked:false});assert.equal(result.status,200);assert.deepEqual(source('asas').scopes.find(scope=>scope.targets.includes('cp')).horizon.groups[0].conditions[0].values,['S26']);
});
test('native lease rechecks current IAM after route middleware and before any persistence',async()=>{
 const f=fixture(),before=adapter.configRevision(source('ias')),original=db.mutateModelConnections;db.mutateModelConnections=work=>{f.profile.areas=[];return original(work);};try{const response=await f.invoke('binding',{sourceId:'ias',moduleId:'orders',enabled:false});assert.equal(response.status,403);assert.equal(response.response.code,'PERMISSION_REQUIRED');assert.equal(adapter.configRevision(source('ias')),before);assert.equal(f.events.length,0);}finally{db.mutateModelConnections=original;}
});
