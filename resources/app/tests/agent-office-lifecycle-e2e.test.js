'use strict';
/* End-to-end Office task lifecycle with real capabilities, the real Office
   service, Runtime, durable stores and two agents of different modules:
   - cross-module handoff: a CP agent reads stored PLM BOM summaries; a
     Collection agent downloads technical sheets for exactly those PLM IDs
     (binding with list projection data.entries[].plmId);
   - states: queued → waiting_approval → running → waiting_operation →
     partial/completed; approval refusal; undo of a completed write;
   - restart: the Office service, Runtime registry and in-memory PLM job
     registry are rebuilt over the same durable stores. A job that finished
     before the restart is read from its durable result; one that died with
     the process fails closed and never feeds the next step. */
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'bl-office-lifecycle-'));
for(const key of ['BUYER_LOG_DATA_ROOT','BUYER_LOG_LOCAL_DATA_ROOT','BUYER_LOG_SERVER_DATA_ROOT','BUYER_LOG_AUTH_DATA_ROOT'])process.env[key]=root;
const db=require('../server/db');
const {createToolRegistry}=require('../server/lib/agent-tool-registry'),{createAgentOfficeStore}=require('../server/lib/agent-office-store'),{createAgentOfficeService}=require('../server/lib/agent-office-service');
const {createAgentRuntime}=require('../server/lib/agent-runtime'),runtimeStore=require('../server/lib/agent-workflow-store'),{createPolicyEngine}=require('../server/lib/agent-policy-engine');
const {createJobRegistry}=require('../server/lib/job-registry'),{createRouteRuns}=require('../server/lib/agent-native-route-runs'),ownership=require('../server/lib/plm-technical-sheet-ownership');
const {registerPlmAssetTools}=require('../server/lib/agent-plm-asset-tools'),{registerOrderTools,COLUMNS_TOOL_ID}=require('../server/lib/agent-order-tools');
test.after(()=>fs.rmSync(root,{recursive:true,force:true}));
let seq=0;
const settle=()=>new Promise(r=>setTimeout(r,25));

function world(t){
  const profile={id:'lifecycle-'+(++seq),enabled:true,areas:['cp','koleksiyon']};
  const access={profileById:id=>id===profile.id?profile:null,publicProfile:p=>({...p}),hasArea:(p,a)=>p.areas.includes(a),hasCapability:()=>true,appendAudit:()=>{}};
  const store=createAgentOfficeStore({root:path.join(root,profile.id,'office')}),runsRoot=path.join(root,profile.id,'native-runs');
  const files=path.join(root,profile.id,'files');fs.mkdirSync(files,{recursive:true});
  let index=[],release=()=>{};const connector={hold:false};
  const bom={_revision:1,models:{'100001':{plmId:'100001',styleId:'S-1',summary:'DEMO'},'100002':{plmId:'100002',styleId:'S-2',summary:'DEMO'}}};
  let service,jobs,runs,registry,downloads=0;
  // One "process": PLM job registry, route runs, tool registry and Office service.
  function boot(){
    jobs=createJobRegistry();runs=createRouteRuns({jobs,root:runsRoot});
    async function withPlmJob(req,meta,fn){const job=jobs.create(req.currentUser.id,meta);
      try{const result=await fn({id:job.id,report:p=>jobs.update(req.currentUser.id,job.id,p||{}),fail:f=>jobs.addFailure(req.currentUser.id,job.id,f||{}),cancelled:()=>jobs.isCancelled(req.currentUser.id,job.id)});jobs.finish(req.currentUser.id,job.id,{status:'succeeded'});return {job:jobs.describe(req.currentUser.id,job.id),result};}
      catch(err){jobs.finish(req.currentUser.id,job.id,{status:'failed',error:err.message});throw err;}}
    const plm=require('../server/routes/plm-sync-routes')({post:()=>{},get:()=>{}},{
      MODEL_FILES_ROOT:files,crypto,fs,express:{json:()=>(_q,_s,n)=>n()},userAccess:{requireArea:()=>(_q,_s,n)=>n(),requireAnyArea:()=>(_q,_s,n)=>n(),appendAudit:()=>{}},
      agentBrowserConnector:{downloadCoreNectumTechnicalSheets:async(_u,items)=>{downloads++;if(connector.hold)await new Promise(r=>{release=r;});
        return {requested:items.length,files:items.filter(i=>i.plmId==='100001').map(i=>({plmId:i.plmId,styleId:i.styleId,base64:Buffer.from('%PDF DEMO').toString('base64')})),failed:items.filter(i=>i.plmId!=='100001').map(i=>({plmId:i.plmId,code:'CORENECTUM_STYLE_NOT_FOUND'}))};}},
      automationError:(res,err)=>res.status(err.statusCode||500).json({code:err.code}),apiError:()=>{},clearModelOperationProgress:()=>{},setModelOperationProgress:()=>{},ensureModelFilesRoot:()=>{},
      loadPlmStyleLinks:()=>({links:{'100001':{styleId:'S-1'},'100002':{styleId:'S-2'}}}),modelStoredFileExists:item=>fs.existsSync(path.join(files,item.storedName)),
      normalizePlmId:v=>String(v||'').replace(/\D/g,''),plmJobs:jobs,publicModelFileMeta:item=>({id:item.id,plmId:item.plmId}),
      readModelFilesIndex:()=>JSON.parse(JSON.stringify(index)),writeModelFilesIndex:next=>{index=JSON.parse(JSON.stringify(next));},resolveStoredFile:(dir,name)=>path.join(dir,path.basename(name)),
      safeMailFilename:name=>String(name).replace(/[^\w.-]/g,'_'),technicalSheetOwnership:ownership,withPlmJob,getModelImageSettings:()=>({}),qtxStore:{},upsertPlmStyleLinks:()=>null});
    registry=createToolRegistry({userAccess:access,authorizeCapability:(c,a)=>service.taskAuthorize(c,a),authorizePendingCapability:(c,r)=>service.taskAuthorizePending(c,r)});
    const mutation=(ctx,work)=>store.withProfileMutation(ctx.ownerId,ctx.input.officeAgentId,ctx.input.officeAgentRevision,()=>{ctx.assertAuthority();return work();});
    registerPlmAssetTools(registry,{bomStore:{load:()=>bom},normalizePlmId:v=>String(v||'').replace(/\D/g,''),readModelFilesIndex:()=>index,fileExists:item=>fs.existsSync(path.join(files,item.storedName)),ownership,
      technicalSheets:plm.technicalSheets,routeRuns:runs,withAgentMutation:mutation});
    registerOrderTools(registry,{withAgentMutation:mutation,noteColumns:{snapshot:ids=>db.noteColumnSnapshot(ids),normalize:c=>db.normalizeNoteColumnDefs(c),replace:(_p,c,r)=>db.replaceNoteColumnDefs(c,r),restore:(_p,s,r)=>db.restoreNoteColumnDefs(s,r)}});
    const runtime=createAgentRuntime({store:runtimeStore,toolRegistry:registry,policyEngine:createPolicyEngine({userAccess:access})});
    service=createAgentOfficeService({store,userAccess:access,toolRegistry:registry,runtime,runtimeStore,getOperationalData:async()=>({})});
    t.after(()=>service.stop());
  }
  boot();
  return {profile,store,connector,get service(){return service;},get downloads(){return downloads;},index:()=>index,release:()=>release(),
    restart(){service.stop();boot();}};
}
const job=(w,id)=>w.store.get(w.profile.id,'job',id);
async function agents(w){
  const cp=await w.store.createProfile(w.profile.id,{name:'DEMO CP',areas:['cp']});
  const collection=await w.store.createProfile(w.profile.id,{name:'DEMO Collection',areas:['collection']});
  return {cp,collection};
}
function handoffTask(w,a){
  return w.service.taskCreate(w.profile,{agentId:a.cp.id,task:'DEMO handoff',steps:[
    {id:'bom',agentId:a.cp.id,toolId:'collection.plm.bom.read',args:{plmIds:['100001','100002','100003']}},
    {id:'sheets',agentId:a.collection.id,toolId:'collection.plm.techsheet.download',args:{language:'en'},bindings:[{argument:'plmIds',stepId:'bom',path:'data.entries[].plmId'}]},
  ]});
}
// Drives the queue like the background ticker until the task waits on a person or ends.
async function drive(w,id,max=6){let j=await job(w,id);for(let i=0;i<max&&['queued','running','waiting_operation'].includes(j.status);i++){await w.service.taskTick(w.profile);await settle();j=await job(w,id);}return j;}

test('cross-module handoff: CP agent result feeds the Collection agent step; approval, native wait, partial result',async t=>{
  const w=world(t),a=await agents(w);
  let j=await handoffTask(w,a);
  j=await drive(w,j.id);
  assert.equal(j.steps[0].status,'completed','the read step runs without approval');
  assert.deepEqual(j.steps[0].result.data.missing,['100003']);
  assert.equal(j.status,'waiting_approval');assert.equal(j.steps[1].status,'waiting_approval');
  assert.deepEqual(j.steps[1].argsResolved?.plmIds||j.steps[1].preview.preview.items.map(i=>i.plmId),['100001','100002'],'only the PLM IDs the first agent actually found');
  assert.equal(w.downloads,0,'nothing reached PLM before approval');
  await assert.rejects(w.service.taskExecute(w.profile,j.id,{confirmed:true,fingerprint:'0'.repeat(64)}),{code:'OFFICE_APPROVAL_REQUIRED'});
  assert.equal(w.downloads,0,'an approval for another preview does not start anything');
  j=await w.service.taskExecute(w.profile,j.id,{confirmed:true,fingerprint:j.steps[1].preview.fingerprint});
  assert.equal(j.steps[1].status,'waiting_operation');
  await settle();j=await drive(w,j.id);
  assert.equal(j.status,'partial');assert.equal(j.steps[1].status,'partial');
  assert.deepEqual([j.steps[1].result.data.saved,j.steps[1].result.data.failed],[1,1]);
  assert.equal(w.downloads,1,'the approved effect ran exactly once');
  assert.deepEqual(w.index().map(i=>i.plmId),['100001']);
});

test('restart: a job that finished before the restart is completed from its durable result; nothing is repeated',async t=>{
  const w=world(t),a=await agents(w);
  w.connector.hold=true;
  let j=await drive(w,(await handoffTask(w,a)).id);
  j=await w.service.taskExecute(w.profile,j.id,{confirmed:true,fingerprint:j.steps[1].preview.fingerprint});
  assert.equal(j.status,'waiting_operation');
  w.release();await settle();
  // The process stops after the PLM job finished but before Office polled it.
  w.restart();
  j=await drive(w,j.id);
  assert.equal(j.status,'partial');assert.equal(j.steps[1].result.data.saved,1);
  assert.equal(w.downloads,1);
});

test('restart: a job that died with the process fails closed and never feeds anything',async t=>{
  const w=world(t),a=await agents(w);
  w.connector.hold=true;
  let j=await drive(w,(await handoffTask(w,a)).id);
  j=await w.service.taskExecute(w.profile,j.id,{confirmed:true,fingerprint:j.steps[1].preview.fingerprint});
  w.restart();
  j=await drive(w,j.id);
  assert.equal(j.status,'interrupted');assert.equal(j.steps[1].errorCode,'OFFICE_NATIVE_RECEIPT_INVALID');
  assert.deepEqual(w.index(),[],'the stale run did not store anything after the restart');
  w.release();
});

test('waiting approval survives a restart; refusal is terminal; a completed write is undone after a restart',async t=>{
  const w=world(t),a=await agents(w);
  db.replaceNoteColumnDefs([{id:'fit',label:'DEMO Fit'}],Number(db.loadOverrides()._revisions.noteColumnDefs)||0);
  const before=db.loadOverrides().noteColumnDefs;
  let j=await w.service.taskCreate(w.profile,{agentId:a.cp.id,task:'DEMO columns',steps:[{toolId:COLUMNS_TOOL_ID,args:{columns:[{id:'fit',label:'DEMO Fit'},{label:'DEMO Lifecycle'}]}}]});
  assert.equal(j.status,'waiting_approval');
  w.restart();
  j=await job(w,j.id);assert.equal(j.status,'waiting_approval','an unapproved step stays waiting across a restart');
  j=await w.service.taskExecute(w.profile,j.id,{confirmed:true,fingerprint:j.steps[0].preview.fingerprint});
  assert.equal(j.status,'completed');assert.equal(db.loadOverrides().noteColumnDefs.length,2);
  w.restart();
  j=await w.service.taskRollback(w.profile,j.id,{stepId:j.steps[0].id,confirmed:true});
  assert.equal(j.steps[0].status,'rolled_back');
  assert.deepEqual(db.loadOverrides().noteColumnDefs,before);
  const r=await w.service.taskCreate(w.profile,{agentId:a.cp.id,task:'DEMO refuse',steps:[{toolId:COLUMNS_TOOL_ID,args:{columns:[{id:'fit',label:'DEMO Refused'}]}}]});
  const rejected=await w.service.taskReject(w.profile,r.id,{feedback:''});
  assert.equal(rejected.status,'rejected');
  // A terminal task is returned unchanged; nothing is executed.
  const again=await w.service.taskExecute(w.profile,r.id,{confirmed:true,fingerprint:r.steps[0].preview.fingerprint});
  assert.equal(again.status,'rejected');assert.equal(again.steps[0].attempts||0,0);
  assert.deepEqual(db.loadOverrides().noteColumnDefs,before);
});

test('an open task dialog follows a running or waiting job and keeps typed correction text',()=>{
  const src=fs.readFileSync(path.join(__dirname,'..','public','agent-office.js'),'utf8');
  const follow=src.slice(src.indexOf('function followReview(job){'),src.indexOf('function capabilityReview(job){'));
  assert.match(follow,/\['queued','running','waiting_operation'\]\.includes\(job\.status\)/);
  assert.match(follow,/api\('\/state'\)/);
  assert.match(follow,/querySelectorAll\('textarea'\)\]\.some\(el=>el\.value\.trim\(\)\)/,'typed text is never replaced');
  assert.match(follow,/dataset\.aoReview!==job\.id/,'only the dialog of that job is refreshed');
  assert.match(src,/modal\.dataset\.aoReview=job\.id;followReview\(job\);/);
});
