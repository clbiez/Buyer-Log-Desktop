'use strict';

// Durable facts for the existing native worker, not another scheduler/queue.
// Report rows stay in native result/snapshot services; this records actual
// acknowledged commands, progress, cancellation and uncertain executor loss.
const fs=require('fs'),path=require('path'),crypto=require('crypto'),os=require('os'),zlib=require('zlib');
const {LOCAL_DATA_ROOT,atomicWriteJson,atomicWriteBuffer}=require('../user-data');
const {withFileLeaseSync,getBuyerLogInstanceId}=require('./shared-file-transaction');
const activeKey=Symbol.for('buyerlog.nativeOabActiveJobs');
const active=globalThis[activeKey]||(globalThis[activeKey]=new Set());
const hash=value=>crypto.createHash('sha256').update(String(value)).digest('hex');
const fail=(code,statusCode=409)=>Object.assign(new Error(code),{code,statusCode});
const copy=value=>JSON.parse(JSON.stringify(value));
const planFields=['plannedCombinations','queue','probe','forceRefresh','transport','mergeWithSnapshot'];
const fields=['jobId','running','cancelled','startedAt','finishedAt','total','completed','fromCacheCount','rowCount','currentLabel','failures','skipped','batchedBuyerGroups','error','errorCode','snapshotSaved','snapshotErrorCode','selection','snapshotFingerprint','interrupted','resumedFrom','continuationFingerprint','savedSnapshotFingerprint'];
function createOabJobStore({root=path.join(LOCAL_DATA_ROOT,'oab-job-receipts')}={}){
 root=path.resolve(root);
 const knownResults=new WeakMap();
 const folder=owner=>{if(typeof owner!=='string'||!owner)throw fail('OAB_JOB_OWNER_INVALID',422);return path.join(root,hash(owner));};
 const jobFile=(owner,id)=>{if(!/^[A-Za-z0-9_-]{1,100}$/.test(id||''))throw fail('OAB_JOB_ID_INVALID',422);return path.join(folder(owner),id+'.json');};
 const pointer=owner=>path.join(folder(owner),'latest.json');
 const key=(owner,id)=>process.platform==='win32'?jobFile(owner,id).toLowerCase():jobFile(owner,id);
 function read(file){
  if(!fs.existsSync(file)){if(fs.existsSync(file+'.bak'))throw fail('OAB_JOB_STORE_INVALID');return null;}
  try{const value=JSON.parse(fs.readFileSync(file,'utf8'));if(value?.schemaVersion===1)return value;}catch(_){}
  throw fail('OAB_JOB_STORE_INVALID');
 }
 function doc(owner,id){
  const value=read(jobFile(owner,id));
  if(value&&(value.ownerId!==owner||value.jobId!==id||!Number.isSafeInteger(value.revision)||value.revision<1||typeof value.running!=='boolean'||typeof value.cancelled!=='boolean'||['total','completed','rowCount','fromCacheCount'].some(name=>!Number.isSafeInteger(value[name])||value[name]<0)||![true,false,null].includes(value.snapshotSaved)))throw fail('OAB_JOB_STORE_INVALID');
  return value;
 }

 function planFile(owner,id){return jobFile(owner,id).replace(/\.json$/,'.plan.json');}
 function withPlan(owner,value,options={}){
  if(!value||options.includePlan===false||!value.planHash)return value;
  const plan=read(planFile(owner,value.jobId));
  if(!plan||plan.ownerId!==owner||plan.jobId!==value.jobId||hash(JSON.stringify(plan))!==value.planHash)throw fail('OAB_JOB_STORE_INVALID');
  return {...value,...plan.plan};
 }
 function resultFile(owner,id,index){return jobFile(owner,id).replace(/\.json$/,'.result-'+index+'.json.gz');}
 function freeze(value,seen=new WeakSet()){
  if(!value||typeof value!=='object'||seen.has(value))return value;seen.add(value);
  for(const child of Object.values(value))freeze(child,seen);return Object.freeze(value);
 }
 function saveResults(owner,job,previous){
  if(!Array.isArray(job.results))return previous.resultRefs??null;
  if(job.results.length>400||job.results.length<(previous.resultRefs?.length||0))throw fail('OAB_JOB_RESULT_INVALID');
  const refs=[];
  for(let index=0;index<job.results.length;index++){
   const result=job.results[index],before=previous.resultRefs?.[index],identity=key(owner,job.jobId)+':'+index,known=result&&knownResults.get(result);
   if(before&&known?.identity===identity){if(known.sha!==before.sha)throw fail('OAB_JOB_RESULT_INVALID');refs.push(before);continue;}
   if(!result||!Array.isArray(result.rows)||!Array.isArray(result.fields))throw fail('OAB_JOB_RESULT_INVALID');
   const selected=Object.fromEntries(['rows','fields','seasonRef','merchSubGroupRef','buyerGroupRef','buyerGroupRefs','fromCache','fetchedAt'].filter(name=>result[name]!==undefined).map(name=>[name,result[name]]));
   const bytes=zlib.gzipSync(Buffer.from(JSON.stringify({schemaVersion:1,ownerId:owner,jobId:job.jobId,index,result:selected})),{level:6}),sha=crypto.createHash('sha256').update(bytes).digest('hex'),file=resultFile(owner,job.jobId,index);
   if(before&&before.sha!==sha)throw fail('OAB_JOB_RESULT_INVALID');
   if(fs.existsSync(file)){if(crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')!==sha)throw fail('OAB_JOB_RESULT_INVALID');}
   else atomicWriteBuffer(file,bytes);
   if(crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')!==sha)throw fail('OAB_JOB_RESULT_INVALID');
   freeze(result);knownResults.set(result,{identity,sha});refs.push({index,sha,bytes:bytes.length,rows:result.rows.length});
  }
  return refs;
 }
 function readResults(owner,value){
  if(!value||value.resultRefs==null)return null;
  const id=value.jobId;
  if(!Array.isArray(value.resultRefs)||value.resultRefs.length>400)throw fail('OAB_JOB_RESULT_INVALID');
  const result=[];let count=0;
  for(let index=0;index<value.resultRefs.length;index++){
   const ref=value.resultRefs[index];if(ref?.index!==index||!/^[a-f0-9]{64}$/.test(ref.sha||'')||!Number.isSafeInteger(ref.rows)||ref.rows<0||!Number.isSafeInteger(ref.bytes)||ref.bytes<=0)throw fail('OAB_JOB_RESULT_INVALID');
   try{
    const bytes=fs.readFileSync(resultFile(owner,id,index));if(bytes.length!==ref.bytes||crypto.createHash('sha256').update(bytes).digest('hex')!==ref.sha)throw fail('OAB_JOB_RESULT_INVALID');
    const chunk=JSON.parse(zlib.gunzipSync(bytes,{maxOutputLength:256*1024*1024}).toString('utf8'));
    if(chunk?.schemaVersion!==1||chunk.ownerId!==owner||chunk.jobId!==id||chunk.index!==index||!Array.isArray(chunk.result?.rows)||!Array.isArray(chunk.result?.fields)||chunk.result.rows.length!==ref.rows)throw fail('OAB_JOB_RESULT_INVALID');
    result.push(chunk.result);count+=ref.rows;
   }catch(_){throw fail('OAB_JOB_RESULT_INVALID');}
  }
  if(count!==value.rowCount)throw fail('OAB_JOB_RESULT_INVALID');return result;
 }
 function results(owner,id){return locked(owner,()=>readResults(owner,reconcile(owner,doc(owner,id))));}
 function resultReceipt(owner,id){return locked(owner,()=>{const job=reconcile(owner,doc(owner,id));return {job:copy(job),results:readResults(owner,job)};});}
 function latestDoc(owner){const ref=read(pointer(owner));if(!ref)return null;if(ref.ownerId!==owner)throw fail('OAB_JOB_STORE_INVALID');const value=doc(owner,ref.jobId);if(!value)throw fail('OAB_JOB_STORE_INVALID');return value;}
 function executorAlive(owner,value){
  if(!value.running)return false;
  const executor=value.executor;
  if(!executor?.pid||!executor.host)throw fail('OAB_JOB_STORE_INVALID');
  if(executor.host!==os.hostname())return true; // Unknown remote liveness cannot authorize a replay.
  if(executor.pid===process.pid)return active.has(key(owner,value.jobId));
  try{process.kill(executor.pid,0);return true;}catch(error){return error.code==='EPERM';}
 }
 function write(owner,value){if(!Number.isSafeInteger(value.revision)||value.revision<1)throw fail('OAB_JOB_STORE_INVALID');const bytes=Buffer.byteLength(JSON.stringify(value));if(bytes>4*1024*1024)throw fail('OAB_JOB_RECEIPT_TOO_LARGE',413);atomicWriteJson(jobFile(owner,value.jobId),value);return copy(value);}
 function reconcile(owner,value){
  if(!value||!value.running||executorAlive(owner,value))return value;
  // No automatic network request or snapshot mutation after uncertain loss.
  return write(owner,{...value,revision:value.revision+1,running:false,interrupted:true,finishedAt:new Date().toISOString(),errorCode:'OAB_BATCH_INTERRUPTED',error:'OAB_BATCH_INTERRUPTED',snapshotSaved:null,snapshotErrorCode:'OAB_BATCH_INTERRUPTED'});
 }
 function locked(owner,work){return withFileLeaseSync(pointer(owner),work);}
 function get(owner,id,options={}){return locked(owner,()=>withPlan(owner,reconcile(owner,doc(owner,id)),options));}
 function latest(owner,options={}){if(!fs.existsSync(pointer(owner))&&!fs.existsSync(pointer(owner)+'.bak'))return null;return locked(owner,()=>withPlan(owner,reconcile(owner,latestDoc(owner)),options));}
 function reserve(owner,job,options={}){
  return locked(owner,()=>{
   options.assertAuthority?.();if(job.userId!==owner)throw fail('OAB_JOB_OWNER_INVALID',403);
   const previous=doc(owner,job.jobId);
   if(previous){if(previous.requestFingerprint!==(options.requestFingerprint||null))throw fail('OAB_JOB_COMMAND_CHANGED');return {reused:true,job:reconcile(owner,previous)};}
   const current=reconcile(owner,latestDoc(owner));if(current?.running)throw Object.assign(fail('OAB_BATCH_IN_PROGRESS'),{job:copy(current)});
   if(options.expectedLatest&&(current?.jobId!==options.expectedLatest.jobId||current?.revision!==options.expectedLatest.revision))throw fail('OAB_CONTINUATION_CHANGED');
   const value={schemaVersion:1,ownerId:owner,revision:1,requestFingerprint:options.requestFingerprint||null,executor:{pid:process.pid,host:os.hostname(),instanceId:getBuyerLogInstanceId()},...Object.fromEntries(fields.filter(name=>job[name]!==undefined).map(name=>[name,copy(job[name])]))};
   const plan={schemaVersion:1,ownerId:owner,jobId:job.jobId,plan:Object.fromEntries(planFields.filter(name=>job[name]!==undefined).map(name=>[name,copy(job[name])]))};
   value.planHash=hash(JSON.stringify(plan));value.resultRefs=Array.isArray(job.results)?[]:null;
   const priorPlan=read(planFile(owner,job.jobId));if(priorPlan&&hash(JSON.stringify(priorPlan))!==value.planHash)throw fail('OAB_JOB_COMMAND_CHANGED');
   options.beforeReserve?.();options.assertAuthority?.();
   value.resultRefs=saveResults(owner,job,value);
   if(!priorPlan)atomicWriteJson(planFile(owner,job.jobId),plan);
   options.assertAuthority?.();
   write(owner,value);atomicWriteJson(pointer(owner),{schemaVersion:1,ownerId:owner,jobId:job.jobId});active.add(key(owner,job.jobId));
   return {reused:false,job:copy(value)};
  });
 }
 function checkpoint(owner,job,options={}){
  return locked(owner,()=>{
   options.assertAuthority?.();const previous=doc(owner,job.jobId);if(!previous||job.userId!==owner)throw fail('OAB_JOB_OWNER_INVALID',403);
   const value={...previous,...Object.fromEntries(fields.filter(name=>job[name]!==undefined).map(name=>[name,copy(job[name])])),revision:previous.revision+1,cancelled:!!(job.cancelled||previous.cancelled)};
   value.resultRefs=saveResults(owner,job,previous);
   return write(owner,value);
  });
 }
 function cancel(owner,options={}){return locked(owner,()=>{options.assertAuthority?.();const current=reconcile(owner,latestDoc(owner));options.assertAuthority?.();if(!current||!current.running)return {cancelled:false,job:copy(current)};options.beforeCancel?.(copy(current));options.assertAuthority?.();const value=write(owner,{...current,revision:current.revision+1,cancelled:true});return{cancelled:true,job:value};});}
 function release(owner,id){active.delete(key(owner,id));}
 return Object.freeze({reserve,checkpoint,latest,get,cancel,release,results,resultReceipt});
}
module.exports={createOabJobStore};
