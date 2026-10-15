'use strict';
/* Office PLM model images and sample requests: the existing route handlers run
   in-process with the owner's profile (agent-native-route-runs); approval is
   bound to the previewed items, a running job of the same kind refuses a new
   start, the job id is the receipt and the poller returns the route result.
   PLM itself is a stand-in: no corporate session is contacted. */
const test=require('node:test'),assert=require('node:assert/strict');
const {createJobRegistry}=require('../server/lib/job-registry');
const {createRouteRuns,officeCode}=require('../server/lib/agent-native-route-runs');
const {createToolRegistry}=require('../server/lib/agent-tool-registry'),{registerPlmAssetTools}=require('../server/lib/agent-plm-asset-tools');
const settle=()=>new Promise(r=>setTimeout(r,20));

function harness(opts={}){
  const jobs=createJobRegistry(),profile={id:'plm-owner'},calls=[];let release;const gate=new Promise(r=>{release=r;});
  async function withPlmJob(req,meta,fn){const job=jobs.create(req.currentUser.id,meta);
    try{const result=await fn({id:job.id,report:p=>jobs.update(req.currentUser.id,job.id,p||{}),fail:f=>jobs.addFailure(req.currentUser.id,job.id,f||{}),cancelled:()=>jobs.isCancelled(req.currentUser.id,job.id)});jobs.finish(req.currentUser.id,job.id,{status:'succeeded'});return {job:jobs.describe(req.currentUser.id,job.id),result};}
    catch(err){jobs.finish(req.currentUser.id,job.id,{status:'failed',error:err.message});throw err;}}
  // The real sample request route module with a stand-in PLM client.
  const handlers={};
  const service=require('../server/routes/plm-request-routes')({get:()=>{},post:(route,...h)=>{handlers[route]=h.at(-1);}},{
    automationError:(res,err)=>res.status(err.statusCode||500).json({error:err.message,code:err.code}),clearModelOperationProgress:()=>{},setModelOperationProgress:()=>{},
    coreNectumApiClient:{postJson:async()=>({})},express:{json:()=>(_q,_s,n)=>n()},loadPlmStyleLinks:()=>({links:{}}),normalizePlmId:v=>String(v||'').replace(/\D/g,''),
    sampleRequestStore:{},upsertPlmStyleLinks:()=>null,userAccess:{requireAnyArea:()=>(_q,_s,n)=>n(),appendAudit:()=>{}},withPlmJob,
    sampleRequestSync:{syncSampleRequests:async(ids)=>{calls.push(ids);await gate;if(opts.sampleError)throw Object.assign(new Error('DEMO'),{code:opts.sampleError});return {checked:ids.length,synced:ids.length-1,withRequests:1,requestCount:3,notFound:[ids.at(-1)],failed:[],revision:2,updatedAt:'2026-10-15T00:00:00.000Z'};}}});
  // A stand-in image route with the same contract: validation, then the job
  // is created synchronously and reported through req.onPlmJob.
  const imageImport=async(req,res)=>{
    if(!Array.isArray(req.body.items))return res.status(400).json({code:'VALIDATION_ERROR'});
    const job=jobs.create(req.currentUser.id,{kind:'plm-images',scope:'koleksiyon',total:req.body.items.length});
    if(typeof req.onPlmJob==='function')req.onPlmJob(job.id);
    try{calls.push(req.body);await gate;
      // The real route rechecks authority after its local plan, before PLM.
      req.assertAuthority?.();jobs.finish(req.currentUser.id,job.id,{status:'succeeded'});
      res.json({ok:true,mode:req.body.mode,requested:req.body.items.length,imagesSaved:1,imagesDownloaded:1,imagesMissing:1,imagesFailed:0,manualPreserved:0,status:'partial',imageFailedItems:[]});}
    catch(err){jobs.finish(req.currentUser.id,job.id,{status:'failed'});res.status(err.statusCode||500).json({code:err.code});}
  };
  const registry=createToolRegistry({userAccess:{profileById:()=>profile,hasArea:()=>true,hasCapability:()=>true,appendAudit:()=>{}},authorizeCapability:async()=>true,authorizePendingCapability:async()=>true});
  registerPlmAssetTools(registry,{bomStore:{load:()=>({})},normalizePlmId:v=>String(v||'').replace(/\D/g,''),readModelFilesIndex:()=>[],fileExists:()=>false,ownership:require('../server/lib/plm-technical-sheet-ownership'),
    routeRuns:createRouteRuns({jobs}),imageImport,sampleSync:service.runSampleRequestSync,withAgentMutation:(_c,work)=>work()});
  const ctx={ownerId:profile.id,profile,input:{officeJobId:'job-r',officeStepId:'step-r',officeAgentId:'agent-r'},approvalGranted:true,assertAuthority:()=>{}};
  return {registry,ctx,release,calls,jobs,profile,handlers};
}
const IMAGES='collection.plm.images.import',SAMPLES='collection.plm.samples.sync';

test('image import: preview without PLM, approval-bound start, concurrent refusal, pending then partial result; manual images kept',async()=>{
  const h=harness(),args={items:[{plmId:'100001',colourCode:'C1'},{plmId:'100001',colourCode:'C1'},{plmId:'100002'}]};
  const dry=await h.registry.execute(IMAGES,args,{...h.ctx,dryRun:true});
  assert.equal(dry.preview.requested,2,'duplicate identities are merged');assert.equal(dry.preview.impact.keepsManualImages,true);assert.equal(h.calls.length,0);
  const started=await h.registry.execute(IMAGES,{...args,fingerprint:dry.fingerprint},h.ctx);
  assert.equal(started.completionPending,'native-operation');
  assert.equal(h.calls[0].overwriteManual,false);assert.equal(h.calls[0].mode,'missing');
  const again=await h.registry.execute(IMAGES,{items:[{plmId:'100003'}]},{...h.ctx,dryRun:true});
  await assert.rejects(h.registry.execute(IMAGES,{items:[{plmId:'100003'}],fingerprint:again.fingerprint},h.ctx),{code:'OFFICE_OPERATION_IN_PROGRESS'});
  assert.equal((await h.registry.pollPending(IMAGES,started,h.ctx)).completionPending,'native-operation');
  h.release();await settle();
  const done=await h.registry.pollPending(IMAGES,started,h.ctx);
  assert.equal(done.outcome,'partial');assert.deepEqual([done.data.saved,done.data.missing],[1,1]);
  await assert.rejects(h.registry.pollPending(IMAGES,{...started,operation:{...started.operation,id:'job_unknown'}},h.ctx),{code:'OFFICE_NATIVE_RECEIPT_INVALID'});
});

test('sample requests run through the real route module; a PLM session failure maps to its own code; the user route is unchanged',async()=>{
  const h=harness();
  const dry=await h.registry.execute(SAMPLES,{plmIds:['100001','100002']},{...h.ctx,dryRun:true});
  const started=await h.registry.execute(SAMPLES,{plmIds:['100001','100002'],fingerprint:dry.fingerprint},h.ctx);
  h.release();await settle();
  const done=await h.registry.pollPending(SAMPLES,started,h.ctx);
  assert.deepEqual([done.data.synced,done.data.notFound,done.outcome],[1,1,'partial']);
  assert.deepEqual(done.data.failedItems,[{plmId:'100002',code:'PLM_NOT_FOUND'}]);
  const g=harness({sampleError:'CORENECTUM_LOGIN_REQUIRED'});
  const dry2=await g.registry.execute(SAMPLES,{plmIds:['100001']},{...g.ctx,dryRun:true});
  const started2=await g.registry.execute(SAMPLES,{plmIds:['100001'],fingerprint:dry2.fingerprint},g.ctx);
  g.release();await settle();
  await assert.rejects(g.registry.pollPending(SAMPLES,started2,g.ctx),{code:'OFFICE_PLM_SESSION_REQUIRED'});
  const out={};const res={status(c){out.status=c;return this;},json(b){out.body=b;return this;},set(){return this;}};
  await h.handlers['/api/plm-requests/sync']({currentUser:h.profile,body:{}},res);
  assert.deepEqual([out.status,out.body.code],[400,'VALIDATION_ERROR']);
});

test('a lost grant before PLM is contacted fails the job; a route refusal before the job fails the start',async()=>{
  const h=harness();
  const dry=await h.registry.execute(IMAGES,{items:[{plmId:'100001'}]},{...h.ctx,dryRun:true});
  const started=await h.registry.execute(IMAGES,{items:[{plmId:'100001'}],fingerprint:dry.fingerprint},h.ctx);
  h.profile.iamRevision=2;h.release();await settle();
  await assert.rejects(h.registry.pollPending(IMAGES,started,h.ctx),{code:'OFFICE_PREVIEW_CHANGED'});
  assert.equal(h.jobs.describe(h.profile.id,started.operation.id).status,'failed');
  const runs=createRouteRuns({jobs:createJobRegistry()});
  assert.throws(()=>runs.start({id:'x'},async(req,res)=>res.status(400).json({code:'VALIDATION_ERROR'}),{}),{code:'OFFICE_TASK_INVALID'});
  assert.throws(()=>runs.start({id:'x'},async(req,res)=>res.status(403).json({code:'ACCESS_AREA_REQUIRED'}),{}),{code:'OFFICE_TOOL_FORBIDDEN'});
  assert.equal(officeCode('PLM_JOB_CANCELLED'),'OFFICE_NATIVE_OPERATION_CANCELLED');
});
