'use strict';
/* Runs an existing Buyer Log route handler in-process for Office, with the
   owner's own profile, and keeps its result for the native-operation poller.
   The handler creates its PLM job synchronously (before its first await) and
   reports the id through req.onPlmJob; that id is the operation receipt. A
   handler that refuses the request before creating a job fails the start with
   the mapped code.

   Durable completion: when the handler finishes, a reduced result (only the
   keys the capability reports, never the full response) is written to an
   owner-isolated file, so a poll after a server restart returns the actual
   outcome of a job that finished. A job that was still running when the
   process stopped has no result file; its receipt is unknown and the poll
   fails closed. */
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {error}=require('./agent-office-store');
const LIMIT=50,TTL=7*24*3600000;
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
// Only success/code and the capability's own summary are kept.
function reduce(body){
  const source=body&&typeof body==='object'?body:{};
  return {ok:source.ok===true,code:typeof source.code==='string'?source.code.slice(0,80):''};
}
function createRouteRuns({jobs,root}){
  const runs=new Map();
  const ownerDir=ownerId=>root?path.join(root,crypto.createHash('sha256').update(String(ownerId)).digest('hex')):null;
  const fileOf=(ownerId,jobId)=>{const dir=ownerDir(ownerId);return dir&&/^[A-Za-z0-9_.:-]{1,100}$/.test(String(jobId))?path.join(dir,String(jobId).replace(/[:]/g,'_')+'.json'):null;};
  function persist(ownerId,jobId,record){
    const file=fileOf(ownerId,jobId);if(!file)return;
    try{fs.mkdirSync(path.dirname(file),{recursive:true});const tmp=file+'.'+process.pid+'.tmp';fs.writeFileSync(tmp,JSON.stringify(record));fs.renameSync(tmp,file);}
    catch(_){/* memory still holds the result for this process */}
  }
  function prune(ownerId){
    const dir=ownerDir(ownerId);if(!dir)return;
    try{for(const name of fs.readdirSync(dir)){const full=path.join(dir,name);try{if(Date.now()-fs.statSync(full).mtimeMs>TTL)fs.unlinkSync(full);}catch(_){}}}catch(_){}
  }
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
    const run={ownerId:profile.id,done:false,statusCode:200,body:null};
    runs.set(jobId,run);
    // Only finished runs are evicted; a running receipt stays pollable.
    for(const [id,old]of runs){if(runs.size<=LIMIT)break;if(old.done)runs.delete(id);}
    const settle=failed=>{
      run.done=true;run.statusCode=failed&&res.statusCode<400?500:res.statusCode;run.body=reduce(res.body);
      // A summary that cannot be built is a failed operation, never an unhandled rejection.
      try{if(typeof options.summary==='function'&&run.body.ok)Object.assign(run.body,JSON.parse(JSON.stringify(options.summary(res.body))));}
      catch(_){run.statusCode=500;run.body={ok:false,code:'OFFICE_NATIVE_OPERATION_FAILED'};}
      const job=jobs.describe(profile.id,jobId);
      persist(profile.id,jobId,{ownerId:profile.id,jobId,statusCode:run.statusCode,body:run.body,jobStatus:job&&job.status||'',finishedAt:new Date().toISOString()});
    };
    promise.then(()=>settle(false),()=>settle(true)).catch(()=>{});
    prune(profile.id);
    return {jobId,job:jobs.describe(profile.id,jobId)};
  }
  function run(profile,jobId){
    const entry=runs.get(String(jobId));
    if(entry){if(entry.ownerId!==profile.id)return null;return {done:entry.done,statusCode:entry.statusCode,body:entry.body,job:jobs.describe(profile.id,jobId)};}
    // After a restart: the durable result of a job that finished.
    const file=fileOf(profile.id,jobId);if(!file)return null;
    let record;try{record=JSON.parse(fs.readFileSync(file,'utf8'));}catch(_){return null;}
    if(record.ownerId!==profile.id||record.jobId!==String(jobId))return null;
    return {done:true,statusCode:record.statusCode,body:record.body,job:jobs.describe(profile.id,jobId)||{status:record.jobStatus}};
  }
  const running=(profile,kind)=>jobs.list(profile.id,{running:true}).find(job=>job.kind===kind)||null;
  return {start,run,running};
}
module.exports={officeCode,createRouteRuns};
