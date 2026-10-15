'use strict';
/* Runs an existing Buyer Log route handler in-process for Office, with the
   owner's own profile, and keeps its response for the native-operation poller.
   The handler creates its PLM job synchronously (before its first await) and
   reports the id through req.onPlmJob; that id is the operation receipt. A
   handler that refuses the request before creating a job fails the start with
   the mapped code. After a server restart a receipt is unknown and the poll
   fails closed. */
const {error}=require('./agent-office-store');
const LIMIT=50;
// Native route codes that keep their meaning for the Office user.
function officeCode(code,cancelled){
  const value=String(code||'');
  if(cancelled||value==='PLM_JOB_CANCELLED')return 'OFFICE_NATIVE_OPERATION_CANCELLED';
  if(/^CORENECTUM_(API_TOKEN_(REQUIRED|INVALID|INVALID_FORMAT)|LOGIN_REQUIRED)$/.test(value))return 'OFFICE_PLM_SESSION_REQUIRED';
  if(value==='ACCESS_AREA_REQUIRED'||value==='OFFICE_TOOL_FORBIDDEN')return 'OFFICE_TOOL_FORBIDDEN';
  if(value==='VALIDATION_ERROR'||value==='PLM_ID_REQUIRED')return 'OFFICE_TASK_INVALID';
  if(value==='OFFICE_PREVIEW_CHANGED')return value;
  return 'OFFICE_NATIVE_OPERATION_FAILED';
}
function createRouteRuns({jobs}){
  const runs=new Map();
  function start(profile,handler,body,options={}){
    let jobId='',abandoned=false;
    const res={statusCode:200,body:null,status(code){this.statusCode=code;return this;},json(payload){this.body=payload;return this;},set(){return this;}};
    const req={currentUser:profile,body,query:{},headers:{},
      assertAuthority:typeof options.assertAuthority==='function'?options.assertAuthority:undefined,
      onPlmJob:id=>{
        // A job id that arrives after the start was refused never reaches PLM.
        if(abandoned)throw Object.assign(new Error('PLM job abandoned.'),{code:'OFFICE_NATIVE_OPERATION_FAILED'});
        jobId=String(id);
      }};
    const promise=Promise.resolve(handler(req,res));
    if(!jobId){
      abandoned=true;promise.catch(()=>{});
      const code=officeCode(res.body&&res.body.code);
      throw error(code,code==='OFFICE_TOOL_FORBIDDEN'?403:code==='OFFICE_TASK_INVALID'?422:409);
    }
    const run={ownerId:profile.id,done:false,res};
    runs.set(jobId,run);
    // Only finished runs are evicted; a running receipt stays pollable.
    for(const [id,old]of runs){if(runs.size<=LIMIT)break;if(old.done)runs.delete(id);}
    promise.then(()=>{run.done=true;},()=>{run.done=true;});
    return {jobId,job:jobs.describe(profile.id,jobId)};
  }
  function run(profile,jobId){
    const entry=runs.get(String(jobId));
    if(!entry||entry.ownerId!==profile.id)return null;
    return {done:entry.done,statusCode:entry.res.statusCode,body:entry.res.body,job:jobs.describe(profile.id,jobId)};
  }
  const running=(profile,kind)=>jobs.list(profile.id,{running:true}).find(job=>job.kind===kind)||null;
  return {start,run,running};
}
module.exports={officeCode,createRouteRuns};
