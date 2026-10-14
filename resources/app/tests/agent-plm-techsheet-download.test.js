'use strict';
/* Office PLM technical sheet download: the EXECUTE step runs the same PLM job
   and store write as Collection › PLM Sync › Technical sheet (shared service in
   plm-sync-routes), is approval-bound to the previewed items, refuses a second
   concurrent download and is awaited through the native-operation poller.
   The connector here is a stand-in: no corporate PLM session is contacted. */
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'buyerlog-agent-plm-sheet-'));
test.after(()=>fs.rmSync(root,{recursive:true,force:true}));
const {createJobRegistry}=require('../server/lib/job-registry'),ownership=require('../server/lib/plm-technical-sheet-ownership');
const {createToolRegistry}=require('../server/lib/agent-tool-registry'),{registerPlmAssetTools}=require('../server/lib/agent-plm-asset-tools');

function harness(){
  const files=path.join(root,'files-'+crypto.randomBytes(3).toString('hex'));fs.mkdirSync(files,{recursive:true});
  let index=[],release;const gate=new Promise(resolve=>{release=resolve;});const calls=[];
  const plmJobs=createJobRegistry(),handlers={};
  async function withPlmJob(req,meta,fn){const userId=req.currentUser.id,job=plmJobs.create(userId,meta);
    try{const result=await fn({id:job.id,report:p=>plmJobs.update(userId,job.id,p||{}),fail:f=>plmJobs.addFailure(userId,job.id,f||{}),cancelled:()=>plmJobs.isCancelled(userId,job.id)});plmJobs.finish(userId,job.id,{status:'succeeded'});return {job:plmJobs.describe(userId,job.id),result};}
    catch(err){plmJobs.finish(userId,job.id,{status:'failed',error:err.message});throw err;}}
  const service=require('../server/routes/plm-sync-routes')({post:(route,...h)=>{handlers[route]=h.at(-1);},get:()=>{}},{
    MODEL_FILES_ROOT:files,crypto,fs,express:{json:()=>(_q,_s,n)=>n()},userAccess:{requireArea:()=>(_q,_s,n)=>n(),requireAnyArea:()=>(_q,_s,n)=>n(),appendAudit:()=>{}},
    agentBrowserConnector:{downloadCoreNectumTechnicalSheets:async(_user,items,options)=>{calls.push({items,language:options.language});await gate;
      return {requested:items.length,files:items.filter(i=>i.styleId).map(i=>({plmId:i.plmId,styleId:i.styleId,base64:Buffer.from('%PDF DEMO '+i.plmId).toString('base64')})),failed:items.filter(i=>!i.styleId).map(i=>({plmId:i.plmId,code:'PLM_STYLE_LINK_MISSING',error:'DEMO'}))};}},
    automationError:(res,err)=>res.status(err.statusCode||500).json({code:err.code}),apiError:()=>{},clearModelOperationProgress:()=>{},setModelOperationProgress:()=>{},ensureModelFilesRoot:()=>{},
    loadPlmStyleLinks:()=>({links:{'100001':{styleId:'S-1'},'100002':{styleId:'S-2'}}}),modelStoredFileExists:item=>fs.existsSync(path.join(files,item.storedName)),
    normalizePlmId:v=>String(v||'').replace(/\D/g,''),plmJobs,publicModelFileMeta:item=>({id:item.id,filename:item.filename,plmId:item.plmId}),
    readModelFilesIndex:()=>JSON.parse(JSON.stringify(index)),writeModelFilesIndex:next=>{index=JSON.parse(JSON.stringify(next));},resolveStoredFile:(dir,name)=>path.join(dir,path.basename(name)),
    safeMailFilename:name=>String(name).replace(/[^\w.-]/g,'_'),technicalSheetOwnership:ownership,withPlmJob,getModelImageSettings:()=>({}),qtxStore:{},upsertPlmStyleLinks:()=>null});
  const profile={id:'plm-owner'};
  const registry=createToolRegistry({userAccess:{profileById:()=>profile,hasArea:()=>true,hasCapability:()=>true,appendAudit:()=>{}},authorizeCapability:async()=>true,authorizePendingCapability:async()=>true});
  registerPlmAssetTools(registry,{bomStore:{load:()=>({})},normalizePlmId:v=>String(v||'').replace(/\D/g,''),readModelFilesIndex:()=>index,fileExists:item=>fs.existsSync(path.join(files,item.storedName)),ownership,
    technicalSheets:service.technicalSheets,withAgentMutation:(_c,work)=>work()});
  const ctx={ownerId:profile.id,profile,input:{officeJobId:'job-t',officeStepId:'step-t',officeAgentId:'agent-t'},approvalGranted:true,assertAuthority:()=>{}};
  return {registry,ctx,handlers,release,calls,index:()=>index,files,plmJobs,profile};
}
const TOOL='collection.plm.techsheet.download';

test('preview, approval-bound start, pending poll and verified completion through the shared PLM job',async()=>{
  const h=harness(),args={plmIds:['100001','100002','100003'],language:'tr'};
  const dry=await h.registry.execute(TOOL,args,{...h.ctx,dryRun:true});
  assert.equal(dry.preview.requested,3);assert.equal(dry.preview.withoutStyleLink,1);assert.equal(dry.preview.canStart,true);
  assert.deepEqual(dry.preview.items.map(i=>i.currentStatus),['missing','missing','missing']);
  assert.equal(h.calls.length,0,'preview never contacts PLM');
  const started=await h.registry.execute(TOOL,{...args,fingerprint:dry.fingerprint},h.ctx);
  assert.equal(started.completionPending,'native-operation');assert.equal(started.operation.kind,'plm-technical-sheet');
  assert.equal(h.calls[0].language,'tr');
  // A second download while the first job runs is refused before it starts.
  const again=await h.registry.execute(TOOL,{plmIds:['100001']},{...h.ctx,dryRun:true});
  assert.equal(again.preview.canStart,false);
  await assert.rejects(h.registry.execute(TOOL,{plmIds:['100001'],fingerprint:again.fingerprint},h.ctx),{code:'OFFICE_OPERATION_IN_PROGRESS'});
  const pending=await h.registry.pollPending(TOOL,started,h.ctx);
  assert.equal(pending.completionPending,'native-operation');
  h.release();await new Promise(r=>setImmediate(r));await new Promise(r=>setImmediate(r));
  const done=await h.registry.pollPending(TOOL,started,h.ctx);
  assert.equal(done.completionPending,undefined);assert.equal(done.outcome,'partial','a failed model makes the step partial');
  assert.deepEqual({saved:done.data.saved,failed:done.data.failed,language:done.data.language},{saved:2,failed:1,language:'tr'});
  assert.deepEqual(done.data.failedItems,[{plmId:'100003',code:'PLM_STYLE_LINK_MISSING'}]);
  assert.deepEqual(h.index().map(i=>[i.plmId,i.plmSource,i.plmLanguage]),[['100001','technical-sheet','tr'],['100002','technical-sheet','tr']]);
  const status=await h.registry.execute('collection.plm.techsheet.status',{plmIds:['100001']},h.ctx);
  assert.equal(status.data.items[0].hasTechnicalSheet,true);
});

test('another owner or an unknown receipt cannot read the run; the user route keeps its contract',async()=>{
  const h=harness();
  const dry=await h.registry.execute(TOOL,{plmIds:['100001']},{...h.ctx,dryRun:true});
  const started=await h.registry.execute(TOOL,{plmIds:['100001'],fingerprint:dry.fingerprint},h.ctx);
  await assert.rejects(h.registry.execute(TOOL,{plmIds:['100001']},{...h.ctx,ownerId:'someone-else',dryRun:true}),{code:'OFFICE_TOOL_FORBIDDEN'});
  await assert.rejects(h.registry.pollPending(TOOL,{...started,operation:{...started.operation,id:'999999'}},h.ctx),{code:'OFFICE_NATIVE_RECEIPT_INVALID'});
  h.release();
  const out={};const res={status(code){out.status=code;return this;},json(body){out.body=body;return this;}};
  await h.handlers['/api/plm-sync/model-files']({currentUser:h.profile,body:{items:[]}},res);
  assert.equal(out.body.code,'PLM_ID_REQUIRED');
  await h.handlers['/api/plm-sync/model-files']({currentUser:h.profile,body:{items:[{plmId:'100002'}],language:'en'}},res);
  assert.equal(out.body.ok,true);assert.equal(out.body.saved,1);assert.equal(out.body.language,'en');
});
