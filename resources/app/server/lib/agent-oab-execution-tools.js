'use strict';
const zlib=require('node:zlib'),{object,string,array}=require('./agent-capability-contract'),{error}=require('./agent-office-store'),{validate}=require('./agent-tool-schema'),artifacts=require('./agent-artifact-store'),{publicJob,jobSchema}=require('./agent-oab-job-tools');
const required=properties=>({...object(properties),required:Object.keys(properties)}),flag={type:'boolean'},count={type:'integer',minimum:0},fingerprint={...string(64),pattern:'^[a-f0-9]{64}$'},jobId={...string(100),pattern:'^[A-Za-z0-9_-]{1,100}$'},artifactId={...string(32),pattern:'^[a-f0-9]{32}$'},ref={...string(160),minLength:1},combination=required({seasonRef:ref,merchSubGroupRef:ref,buyerGroupRef:ref});
const operation=required({id:jobId,kind:{enum:['oab-fetch','oab-continue','oab-cancel']},artifactId:{type:['string','null'],maxLength:32}}),token=required({jobId,artifactId}),summary=required({jobId,resultAvailable:{type:['boolean','null']},rowCount:count,sourceCount:{...count,type:['integer','null']},fieldCount:{...count,type:['integer','null']},snapshotSaved:{type:['boolean','null']},cancelled:flag,stopped:flag,sourceFingerprint:fingerprint});
const pending=required({verified:{enum:[true]},completionPending:{enum:['native-operation']},operation,job:jobSchema}),finished={...required({verified:{enum:[true]},operation,data:summary}),properties:{verified:{enum:[true]},operation,data:summary,outcome:{enum:['partial']},rollbackToken:token}},output={...object({verified:{enum:[true]},completionPending:{enum:['native-operation']},operation,job:jobSchema,data:summary,outcome:{enum:['partial']},rollbackToken:token}),required:['verified','operation'],anyOf:[pending,finished]};
const startInput=object({seasonRefs:array(ref,200),merchSubGroupRefs:array(ref,200),buyerGroupRefs:array(ref,200),allBuyerGroups:flag,combinations:array(combination,400),forceRefresh:flag});
const selection=required({seasonRefs:array(ref,400),merchSubGroupRefs:array(ref,400),buyerGroupRefs:array(ref,400),allBuyerGroups:flag}),basePreview={origin:{enum:['native-oab-start-plan','native-oab-continuation-plan','native-oab-cancel-plan']},jobId:{...jobId,type:['string','null']},sourceFingerprint:fingerprint,baselineFingerprint:{...fingerprint,type:['string','null']},canStart:flag,activeJobId:{...jobId,type:['string','null']},forceRefresh:flag,combinationCount:count,requestCount:count,estimateSeconds:{type:'number',minimum:0},worstCaseRequestCount:count,worstCaseSeconds:{type:'number',minimum:0},retainedCombinationCount:count,selection:{...selection,type:['object','null']},combinations:array(combination,400),combinationsTruncated:flag,limits:required({maxCombinations:{enum:[400]},backupBytes:{enum:[80*1024*1024]},backupHours:{enum:[48]}})};
const previewSchema=required(basePreview),dryRun=required({verified:{enum:[true]},preview:previewSchema,fingerprint});
function registerOabExecutionTools(registry,deps={}){
 const base={module:'overview',areas:['overview'],agentAreas:['overview'],capabilities:['OAB.VIEW'],risk:'write',operation:'EXECUTE',dataScope:'current owner native report/job; current IAM and exact agent/task/run; existing worker and short native commit guard',outputSchema:output,dryRunOutputSchema:dryRun};
 const owner=ctx=>{ctx.assertAuthority();if(ctx.ownerId!==ctx.profile.id||!/^[A-Za-z0-9_-]{1,100}$/.test(ctx.ownerId))throw error('OFFICE_TOOL_FORBIDDEN',403);};
 const guard=(ctx,work)=>{owner(ctx);if(typeof deps.guard!=='function')throw error('OFFICE_APPROVAL_REQUIRED',403);return deps.guard(ctx,work);};
 async function preview(kind,args,ctx){
  owner(ctx);if(typeof deps.native?.startPlan!=='function')throw error('OFFICE_SOURCE_UNAVAILABLE',503);
  const p={origin:'native-oab-cancel-plan',jobId:args.jobId||null,sourceFingerprint:'',baselineFingerprint:null,canStart:true,activeJobId:null,forceRefresh:false,combinationCount:0,requestCount:0,estimateSeconds:0,worstCaseRequestCount:0,worstCaseSeconds:0,retainedCombinationCount:0,selection:null,combinations:[],combinationsTruncated:false,limits:{maxCombinations:400,backupBytes:80*1024*1024,backupHours:48}};
  if(kind==='start'){
   if(Buffer.byteLength(JSON.stringify(args))>64*1024||args.combinations!==undefined&&['seasonRefs','merchSubGroupRefs','buyerGroupRefs','allBuyerGroups'].some(k=>args[k]!==undefined)||args.allBuyerGroups&&args.buyerGroupRefs?.length)throw error('OFFICE_TOOL_SCHEMA',422);
   const value=deps.native.startPlan(ctx.profile,args,{transport:deps.transport});Object.assign(p,{origin:'native-oab-start-plan',sourceFingerprint:value.sourceFingerprint,baselineFingerprint:value.baselineFingerprint,canStart:value.canStart,activeJobId:value.activeJobId,forceRefresh:value.forceRefresh,combinationCount:value.combinationCount,requestCount:value.requestCount,estimateSeconds:value.estimateSeconds,worstCaseRequestCount:value.worstCaseRequestCount,worstCaseSeconds:value.worstCaseSeconds,selection:value.selection,combinations:value.combinations,combinationsTruncated:value.combinationsTruncated});
  }else if(kind==='continue'){
   const value=deps.native.continuationPlan(ctx.profile,args.jobId,{transport:deps.transport,includeBaseline:true});Object.assign(p,{origin:'native-oab-continuation-plan',sourceFingerprint:value.sourceFingerprint,baselineFingerprint:value.baselineFingerprint,forceRefresh:value.forceRefresh,combinationCount:value.combinationCount,requestCount:value.requestCount,estimateSeconds:value.estimateSeconds,worstCaseRequestCount:value.worstCaseRequestCount,worstCaseSeconds:value.worstCaseSeconds,retainedCombinationCount:value.retainedCombinationCount,combinations:value.combinations});
  }else{
   const value=deps.native.receipt(ctx.profile,args.jobId),latest=deps.native.receipt(ctx.profile);if(!value.job)throw error('OFFICE_NOT_FOUND',404);if(value.job.jobId!==latest.job?.jobId)throw error('OFFICE_PREVIEW_CHANGED',409);
   p.sourceFingerprint=require('./agent-office-store').hash(JSON.stringify({jobId:args.jobId,current:true}));p.activeJobId=value.job.running?value.job.jobId:null;
  }
  owner(ctx);validate(previewSchema,p);return p;
 }
 async function backup(ctx,p){
  await guard(ctx);const before=deps.native.snapshotState(ctx.profile,p.baselineFingerprint);await guard(ctx);
  const frame={ownerId:ctx.ownerId,officeJobId:ctx.input.officeJobId,officeStepId:ctx.input.officeStepId,before:before.state},bytes=zlib.gzipSync(Buffer.from(JSON.stringify(frame)),{level:6});
  return artifacts.put(ctx.profile,bytes,'oab-before-snapshot.json.gz','oab-before-snapshot');
 }
 const nativeOptions=(ctx,archive)=>({transport:deps.transport,assertAuthority:()=>ctx.assertAuthority(),assertAsyncAuthority:()=>guard(ctx),withCommitGuard:work=>guard(ctx,work),...(archive?{rollbackArtifactId:archive.id}:{})});
 function ack(kind,id,archive,job){return{verified:true,completionPending:'native-operation',operation:{id,kind,artifactId:archive?.id||null},job:publicJob(job)};}
 async function poll(receipt,ctx){
  await guard(ctx);const cancel=receipt.operation.kind==='oab-cancel',actual=cancel?deps.native.receipt(ctx.profile,receipt.operation.id):deps.native.resultReport(ctx.profile,receipt.operation.id);await guard(ctx);
  if(!actual.job)throw error('OFFICE_NATIVE_RECEIPT_INVALID',409);
  if(actual.job.running)return ack(receipt.operation.kind,receipt.operation.id,receipt.operation.artifactId?{id:receipt.operation.artifactId}:null,actual.job);
  if(!cancel&&(actual.job.interrupted||actual.job.errorCode||actual.job.snapshotSaved!==true||!actual.resultAvailable))throw error('OFFICE_NATIVE_OPERATION_FAILED',409);
  const partial=!cancel&&(actual.job.cancelled||actual.job.failures.length>0),result={verified:true,operation:receipt.operation,data:{jobId:receipt.operation.id,resultAvailable:cancel?null:actual.resultAvailable,rowCount:actual.job.rowCount,sourceCount:cancel?null:actual.sources?.length||0,fieldCount:cancel?null:actual.fields?.length||0,snapshotSaved:actual.job.snapshotSaved,cancelled:actual.job.cancelled,stopped:true,sourceFingerprint:actual.sourceFingerprint},...(partial?{outcome:'partial'}:{})};
  if(!cancel&&actual.job.snapshotSaved===true&&receipt.operation.artifactId)result.rollbackToken={jobId:receipt.operation.id,artifactId:receipt.operation.artifactId};
  return result;
 }
 async function restore(token,ctx){
  owner(ctx);const {buffer}=artifacts.read(ctx.profile,token.artifactId,'oab-before-snapshot');let frame;try{frame=JSON.parse(zlib.gunzipSync(buffer,{maxOutputLength:256*1024*1024}));}catch(_){throw error('OFFICE_ROLLBACK_INVALID',409);}
  if(frame.ownerId!==ctx.ownerId||frame.officeJobId!==ctx.input.officeJobId||frame.officeStepId!==ctx.input.officeStepId)throw error('OFFICE_ROLLBACK_INVALID',409);
  if(typeof deps.restoreGuard!=='function')throw error('OFFICE_APPROVAL_REQUIRED',403);
  return deps.restoreGuard(ctx,()=>deps.native.restoreSnapshot(ctx.profile,token.jobId,frame.before,{artifactId:token.artifactId,assertAuthority:()=>ctx.assertAuthority()}));
 }
 for(const kind of ['start','continue','cancel'])registry.registerCapability({...base,id:'oab.batch.'+kind,label:kind==='start'?{tr:'OAB yüklemesini başlat ve gerçek sonucu bekle',en:'Start OAB fetching and await its actual result'}:kind==='continue'?{tr:'Eksik OAB yüklemesine onayla devam et',en:'Continue incomplete OAB fetching with approval'}:{tr:'OAB işini durdur ve durduğunu doğrula',en:'Cancel OAB work and verify it stopped'},inputSchema:kind==='start'?startInput:{...object({jobId}),required:['jobId']},read:(args,ctx)=>preview(kind,args,ctx),apply:async(args,ctx,p)=>{
  if(!p.canStart)throw error('OFFICE_PREVIEW_CHANGED',409);
  if(kind==='cancel'){const r=await guard(ctx,()=>deps.native.cancel(ctx.profile,{expectedJobId:args.jobId,assertAuthority:()=>ctx.assertAuthority()}));return ack('oab-cancel',args.jobId,null,r.job);}
  const archive=await backup(ctx,p),options=nativeOptions(ctx,archive),r=await guard(ctx,()=>kind==='start'?deps.native.start(ctx.profile,args,{...options,expectedStartFingerprint:p.sourceFingerprint,commandKey:ctx.input.officeJobId+':'+ctx.input.officeStepId}):deps.native.continueJob(ctx.profile,{jobId:args.jobId,sourceFingerprint:p.sourceFingerprint},{...options,confirmed:true}));
  return ack(kind==='start'?'oab-fetch':'oab-continue',r.job.jobId,archive,r.job);
 },poll,...(kind==='cancel'?{}:{restore})});
}
module.exports={registerOabExecutionTools,output,previewSchema,startInput};
