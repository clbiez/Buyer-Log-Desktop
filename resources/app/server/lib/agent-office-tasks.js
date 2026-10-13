'use strict';
const {id,hash,error,text}=require('./agent-office-store');
const {allowed}=require('./agent-capability-contract');
const {validate}=require('./agent-tool-schema');
const {valueAt}=require('./agent-runtime');
const TERMINAL=new Set(['completed','failed','cancelled','interrupted','rejected','rolled_back']);
const clone=value=>JSON.parse(JSON.stringify(value));
const host=require('os').hostname();
function executorAlive(step,docs){const beat=docs.find(d=>d.id==='executor-'+step.executorInstanceId&&d.kind==='metadata');if(!beat||Date.parse(beat.expiresAt)<=Date.now())return false;if(step.executorHost!==host)return true;try{process.kill(step.executorPid,0);return true;}catch(err){return err.code==='EPERM';}}

function attachTasks(service,deps) {
  const {store}=service,{toolRegistry:registry,runtime,userAccess:access}=deps;
  const inFlight=new Map();let timer;
  const authority=profile=>{const current=access.profileById(profile.id);if(!current||current.enabled===false)throw error('OFFICE_USER_DISABLED',403);return current;};
  const actorHash=profile=>hash(JSON.stringify(access.publicProfile?.(profile)||profile));
  async function heartbeat(owner){const instance=service.runtimeContext(owner).runtimeInstanceId;await store.save(owner,'metadata',{id:'executor-'+instance,type:'task-executor',instanceId:instance,pid:process.pid,host,expiresAt:new Date(Date.now()+120000).toISOString()});return instance;}
  const agentHas=(agent,tool)=>(tool.agentAreas||tool.areas||[]).every(area=>agent.areas.includes(area==='koleksiyon'?'collection':area));
  async function catalog(profile,agentId){profile=authority(profile);const agent=await store.get(profile.id,'profile',agentId);return registry.catalog().filter(tool=>tool.contractVersion>=2&&tool.executionScope==='office-durable-job'&&allowed(tool,profile,access)&&agentHas(agent,tool));}
  async function stepAuthority(profile,step){profile=authority(profile);const agent=await store.get(profile.id,'profile',step.agentId),tool=registry.get(step.toolId);
    if(!(tool?.contractVersion>=2)||!allowed(tool,profile,access)||!agentHas(agent,tool))throw error('OFFICE_TOOL_FORBIDDEN',403);
    return {profile,agent,tool};}
  function resolvedArgs(job,step){const args=clone(step.args);for(const binding of step.bindings||[]){const previous=job.steps.find(item=>item.id===binding.stepId);if(previous?.status!=='completed')throw error('OFFICE_TASK_DEPENDENCY',409);
    const value=valueAt(previous.result,binding.path);if(value===undefined||['__proto__','constructor','prototype'].includes(binding.argument))throw error('OFFICE_TASK_DEPENDENCY',422);args[binding.argument]=clone(value);}return args;}
  async function create(profile,raw,internal={}){profile=authority(profile);if(!Array.isArray(raw.steps)||!raw.steps.length||raw.steps.length>12)throw error('OFFICE_TASK_INVALID');
    const steps=[];for(const input of raw.steps){const step={id:input.id||id(),agentId:input.agentId||raw.agentId,toolId:input.toolId,args:clone(input.args||{}),bindings:input.bindings||[],status:'queued',attempts:0};
      if(steps.some(item=>item.id===step.id)||step.bindings.length>12||step.bindings.some(b=>!steps.some(p=>p.id===b.stepId)||typeof b.argument!=='string'||typeof b.path!=='string'))throw error('OFFICE_TASK_DEPENDENCY');
      const {agent,tool}=await stepAuthority(profile,step);if(tool.executionScope!=='office-durable-job')throw error('OFFICE_TOOL_FORBIDDEN',403);
      if(!step.bindings.length)validate(tool.inputSchema,step.args);step.agentRevision=agent.revision;steps.push(step);}
    const job=await store.save(profile.id,'job',{...service.runtimeContext(profile.id),id:internal.id||id(),type:'capability-task',profileIds:[...new Set(steps.map(s=>s.agentId))],task:text(raw.task||'Buyer Log',4000),steps,status:'queued',aiCalls:raw.aiCalls===1?1:0,execution:'existing-agent-runtime'},{immutable:!!internal.id});
    access.appendAudit(profile,'AGENT_TASK_CREATE',job.id,{steps:steps.map(s=>s.toolId)});return prepare(profile,job.id);}
  async function plan(profile,raw){const tools=await catalog(profile,raw.agentId);if(!tools.length)throw error('OFFICE_TOOL_FORBIDDEN',403);
    const memory=await store.selectContext(profile.id,[raw.agentId],'',raw.task,6000);
    const response=await service.engineOf().ask(profile.id,{requestId:id(),source:'agent-task',lang:raw.lang==='en'?'en':'tr',task:text(raw.task,4000),context:{agentId:raw.agentId,tools:tools.map(t=>({id:t.id,operation:t.operation,inputSchema:t.inputSchema})),memory:memory.selected},guide:'Return planJson as a JSON string: {steps:[{id,toolId,args,bindings:[{argument,stepId,path}]}]}. Use only listed tools. Bindings reference earlier actual results. Never invent identifiers, permissions, successful execution, source facts or approvals. Do not place a fingerprint in args. If required identifiers are missing return {steps:[]}.'});
    if(!response.structured?.ok)throw error('OFFICE_AI_CONTRACT_INVALID',422);let parsed;try{parsed=JSON.parse(response.data.planJson);}catch(_){throw error('OFFICE_AI_CONTRACT_INVALID',422);}
    return create(profile,{...raw,steps:parsed.steps,aiCalls:1});}
  async function prepare(profile,key){profile=authority(profile);let job=await store.get(profile.id,'job',key);if(job.type!=='capability-task')throw error('OFFICE_TASK_INVALID');if(TERMINAL.has(job.status))return job;
    if(job.runtimeDeviceId!==store.db(profile.id).getDeviceId())throw error('OFFICE_TASK_DEVICE',409);
    const index=job.steps.findIndex(step=>step.status!=='completed');if(index<0){job=await store.save(profile.id,'job',{...job,status:'completed',finishedAt:new Date().toISOString()},{expectedRevision:job.revision});
      await store.save(profile.id,'memory',{id:'outcome-'+job.id,profileId:job.profileIds[0],type:'task',category:'task-history',text:JSON.stringify({task:job.task,status:job.status,steps:job.steps.map(s=>({toolId:s.toolId,status:s.status,verified:s.result?.verified===true}))}),sourceId:job.id,toolIds:job.steps.map(s=>s.toolId),taskId:job.id,active:true,approved:false,origin:'verified-service',confidence:'VERIFIED_RESULT',key:'',conflictingIds:[]},{immutable:true});return job;}
    const step=job.steps[index];if(step.status==='running')throw error('OFFICE_TASK_RECONCILE',409);
    const {profile:current,agent,tool}=await stepAuthority(profile,step),args=resolvedArgs(job,step);
    const originalAuthority=actorHash(current),preview=await registry.execute(tool.id,args,{ownerId:profile.id,profile:current,dryRun:true});
    const latest=await stepAuthority(profile,step);if(latest.agent.revision!==agent.revision||actorHash(latest.profile)!==originalAuthority)throw error('OFFICE_PREVIEW_CHANGED',409);
    job.steps[index]={...step,argsResolved:args,preview,agentRevision:agent.revision,authorizationFingerprint:actorHash(latest.profile),status:tool.approval?'waiting_approval':'ready'};
    return store.save(profile.id,'job',{...job,status:tool.approval?'waiting_approval':'queued'},{expectedRevision:job.revision});}
  function graph(job,step){const nodes=[{id:'start',type:'trigger.manual',config:{}},{id:'effect',type:'tool.call',config:{toolId:step.toolId,args:{...step.argsResolved,...(step.preview.fingerprint?{fingerprint:step.preview.fingerprint}:{})}}},{id:'verify',type:'verify.result',config:{mode:'equals',path:'verified',value:true}},{id:'result',type:'output.result',config:{}}];return{id:'task_'+job.id+'_'+step.id,ownerId:job.ownerId,name:job.task,nodes,edges:nodes.slice(1).map((n,i)=>({id:'e'+i,from:nodes[i].id,to:n.id,channel:'success'}))};}
  async function executeOnce(profile,key,raw={}){profile=authority(profile);let job=await store.get(profile.id,'job',key);if(TERMINAL.has(job.status))return job;
    if(job.runtimeDeviceId!==store.db(profile.id).getDeviceId())throw error('OFFICE_TASK_DEVICE',409);
    const index=job.steps.findIndex(step=>step.status!=='completed'),step=job.steps[index];if(!step||!['ready','waiting_approval'].includes(step.status))throw error('OFFICE_TASK_RECONCILE',409);
    const {profile:current,agent,tool}=await stepAuthority(profile,step);
    if(agent.revision!==step.agentRevision||actorHash(current)!==step.authorizationFingerprint)throw error('OFFICE_PREVIEW_CHANGED',409);
    if(tool.approval&&(raw.confirmed!==true||raw.fingerprint!==step.preview.fingerprint))throw error('OFFICE_APPROVAL_REQUIRED',409);
    const executorInstanceId=await heartbeat(profile.id);
    job.steps[index]={...step,status:'running',attempts:step.attempts+1,executorPid:process.pid,executorHost:host,executorInstanceId};job=await store.save(profile.id,'job',{...job,status:'running'},{expectedRevision:job.revision});
    try{let execution=await runtime.execute({ownerId:profile.id,profile:current,workflow:graph(job,step),input:{officeJobId:job.id,officeStepId:step.id},onRunCreated:async run=>{job.steps[index].runtimeRunId=run.id;job=await store.save(profile.id,'job',job,{expectedRevision:job.revision});}});
      if(execution.run.status==='waiting_approval')execution=await runtime.resumeApproval({ownerId:profile.id,profile:authority(profile),runId:execution.run.id,approved:true});
      const result=execution.run.executionState.nodes.effect?.output,ok=execution.run.status==='completed'&&result?.verified===true;
      const retry=!ok&&tool.risk==='read'&&job.steps[index].attempts<3;
      job.steps[index]={...job.steps[index],result:result||null,status:ok?'completed':retry?'queued':'failed',runtimeStatus:execution.run.status,errorCode:execution.run.output?.code||'',finishedAt:new Date().toISOString()};
      job=await store.save(profile.id,'job',{...job,status:ok||retry?'queued':'failed'},{expectedRevision:job.revision});
      access.appendAudit(current,'AGENT_TASK_STEP_RESULT',job.id,{stepId:step.id,toolId:step.toolId,status:job.steps[index].status});
      return ok?prepare(profile,job.id):job;
    }catch(err){const latest=await store.get(profile.id,'job',job.id);latest.steps[index]={...latest.steps[index],status:tool.risk==='read'?'queued':'interrupted',errorCode:err.code||'OFFICE_TASK_RECONCILE'};
      await store.save(profile.id,'job',{...latest,status:tool.risk==='read'&&latest.steps[index].attempts<3?'queued':'interrupted'},{expectedRevision:latest.revision});throw err;}}
  async function execute(profile,key,raw){const token=profile.id+':'+key;if(inFlight.has(token))return inFlight.get(token);const work=executeOnce(profile,key,raw).finally(()=>inFlight.delete(token));inFlight.set(token,work);return work;}
  async function authorize(ctx,args){const job=await store.get(ctx.ownerId,'job',ctx.input?.officeJobId),step=job.steps?.find(s=>s.id===ctx.input?.officeStepId);
    const expected=step?{...step.argsResolved,...(step.preview.fingerprint?{fingerprint:step.preview.fingerprint}:{})}:null;
    if(job.type!=='capability-task'||job.status!=='running'||!step||step.status!=='running'||step.runtimeRunId!==ctx.runId||step.toolId!==ctx.toolId||JSON.stringify(expected)!==JSON.stringify(args))throw error('OFFICE_APPROVAL_REQUIRED',403);
    const {profile,agent}=await stepAuthority({id:ctx.ownerId},step);if(step.authorizationFingerprint!==actorHash(profile)||agent.revision!==step.agentRevision)throw error('OFFICE_PREVIEW_CHANGED',409);}
  async function reject(profile,key,raw){profile=authority(profile);let job=await store.get(profile.id,'job',key);if(!['waiting_approval','queued'].includes(job.status))throw error('OFFICE_TASK_RECONCILE',409);
    job=await store.save(profile.id,'job',{...job,status:'rejected',feedback:text(raw?.feedback||'',2000)},{expectedRevision:job.revision});
    if(job.feedback)await feedback(profile,key,{text:job.feedback,outcome:'rejected'});access.appendAudit(profile,'AGENT_TASK_REJECT',key,{});return job;}
  async function feedback(profile,key,raw){profile=authority(profile);const job=await store.get(profile.id,'job',key);const memory=await store.learn(profile.id,job.profileIds[0],{type:'preference',text:text(raw.text,2000),key:raw.key||'',sourceId:job.id,approved:raw.approved===true});
    return store.save(profile.id,'memory',{...memory,category:'user-preference',feedbackKind:raw.outcome==='rejected'?'rejection':'correction',toolIds:job.steps?.map(s=>s.toolId)||[],taskId:job.id,approved:raw.approved===true});}
  async function rollback(profile,key,raw){profile=authority(profile);let job=await store.get(profile.id,'job',key);const index=job.steps?.findIndex(s=>s.id===raw.stepId),step=job.steps?.[index];
    if(raw.confirmed!==true||!step||!['completed','rolled_back'].includes(step.status)||!step.result?.rollbackToken||job.runtimeDeviceId!==store.db(profile.id).getDeviceId())throw error('OFFICE_ROLLBACK_INVALID',409);
    const {tool,profile:current}=await stepAuthority(profile,step);if(step.rollbackStatus==='completed')return job;if(step.rollbackStatus==='running'||job.status==='running')throw error('OFFICE_TASK_RECONCILE',409);
    // Do not invalidate a completed downstream effect by silently undoing its input.
    if(job.steps.slice(index+1).some(s=>s.status==='completed'))throw error('OFFICE_ROLLBACK_DEPENDENCY',409);
    job.steps[index]={...step,rollbackStatus:'running'};job=await store.save(profile.id,'job',job,{expectedRevision:job.revision});
    try{const restored=await registry.rollback(tool.id,step.result.rollbackToken,{ownerId:profile.id,profile:current,approvalGranted:true});job.steps[index].rollbackStatus='completed';job.steps[index].status='rolled_back';job.steps[index].restored=restored;job.status='rolled_back';
      for(const downstream of job.steps.slice(index+1)){downstream.status='cancelled';delete downstream.preview;delete downstream.argsResolved;}return store.save(profile.id,'job',job,{expectedRevision:job.revision});}
    catch(err){job.steps[index].rollbackStatus='failed';await store.save(profile.id,'job',job,{expectedRevision:job.revision});throw err;}}
  async function schedule(profile,raw){profile=authority(profile);const tools=await catalog(profile,raw.agentId),tool=tools.find(t=>t.id===raw.toolId);if(!tool||tool.risk!=='read'||raw.confirmed!==true)throw error('OFFICE_SCHEDULE_SCOPE',403);
    validate(tool.inputSchema,raw.args||{});const due=Date.parse(raw.nextRunAt),minutes=Number(raw.intervalMinutes);if(!Number.isFinite(due)||!Number.isInteger(minutes)||minutes<15||minutes>525600)throw error('OFFICE_TASK_INVALID');
    try{new Intl.DateTimeFormat('en',{timeZone:raw.timeZone}).format();}catch(_){throw error('OFFICE_TIMEZONE_INVALID');}
    const agent=await store.get(profile.id,'profile',raw.agentId);return store.save(profile.id,'metadata',{id:'schedule-'+id(),type:'capability-schedule',...service.runtimeContext(profile.id),agentId:agent.id,agentRevision:agent.revision,toolId:tool.id,args:raw.args||{},nextRunAt:new Date(due).toISOString(),intervalMinutes:minutes,timeZone:raw.timeZone,missedRunPolicy:raw.missedRunPolicy==='skip'?'skip':'run-once',enabled:true,authorizationFingerprint:actorHash(profile),hostRequirement:'Buyer Log backend must be running'});}
  async function tick(profile){profile=authority(profile);const docs=await store.records(profile.id),device=store.db(profile.id).getDeviceId();
    if(docs.some(d=>d.type==='capability-task'&&!TERMINAL.has(d.status)||d.type==='capability-schedule'&&d.enabled))await heartbeat(profile.id);
    for(let job of docs.filter(d=>d.kind==='job'&&d.type==='capability-task'&&!TERMINAL.has(d.status)&&d.runtimeDeviceId===device)){
      if(inFlight.has(profile.id+':'+job.id))continue;
      const running=job.steps.find(s=>s.status==='running');if(running){const run=deps.runtimeStore?.runForOwner(profile.id,running.runtimeRunId),receipt=run?.executionState?.nodes?.effect?.output;
        if(run?.status==='completed'&&receipt?.verified===true){running.status='completed';running.result=receipt;job=await store.save(profile.id,'job',{...job,status:'queued'},{expectedRevision:job.revision});}
        else if(executorAlive(running,docs))continue;
        else if(registry.get(running.toolId)?.risk==='read'){running.status='queued';job=await store.save(profile.id,'job',{...job,status:'queued'},{expectedRevision:job.revision});}
        else{running.status='interrupted';await store.save(profile.id,'job',{...job,status:'interrupted',errorCode:'OFFICE_TASK_RECONCILE'},{expectedRevision:job.revision});continue;}}
      if(job.status==='queued'){try{job=await prepare(profile,job.id);if(job.status==='queued')await execute(profile,job.id);}catch(err){deps.onBackgroundError?.(err.code||'OFFICE_TASK_FAILED');}}}
    for(const saved of docs.filter(d=>d.kind==='metadata'&&d.type==='capability-schedule'&&d.enabled&&d.runtimeDeviceId===device&&Date.parse(d.nextRunAt)<=Date.now())){
      try{const agent=await store.get(profile.id,'profile',saved.agentId);if(saved.authorizationFingerprint!==actorHash(profile)||saved.agentRevision!==agent.revision)throw error('OFFICE_PREVIEW_CHANGED',409);
        const missed=Date.now()-Date.parse(saved.nextRunAt)>saved.intervalMinutes*60000;
        // The occurrence ID is deterministic and WAL-immutable: a crash between
        // job creation and advancing the schedule returns that same job.
        const occurrence=hash(saved.id+':'+saved.nextRunAt);
        if(!missed||saved.missedRunPolicy==='run-once')await create(profile,{agentId:saved.agentId,task:saved.toolId,steps:[{toolId:saved.toolId,args:saved.args}]},{id:occurrence});
        await store.save(profile.id,'metadata',{...saved,lastOccurrence:occurrence,lastDueAt:saved.nextRunAt,lastOccurrenceStatus:missed&&saved.missedRunPolicy==='skip'?'skipped':'queued',nextRunAt:new Date(Date.now()+saved.intervalMinutes*60000).toISOString()},{expectedRevision:saved.revision});
      }catch(err){deps.onBackgroundError?.(err.code||'OFFICE_SCHEDULE_FAILED');}}
  }
  async function scheduleUpdate(profile,key,raw){profile=authority(profile);const previous=await store.get(profile.id,'metadata',key);if(previous.type!=='capability-schedule')throw error('OFFICE_NOT_FOUND',404);if(!Number.isSafeInteger(raw.revision))throw error('OFFICE_REVISION_CONFLICT',409);if(raw.enabled===true){const tools=await catalog(profile,previous.agentId);if(!tools.some(t=>t.id===previous.toolId&&t.risk==='read')||previous.authorizationFingerprint!==actorHash(profile))throw error('OFFICE_PREVIEW_CHANGED',409);}return store.save(profile.id,'metadata',{...previous,enabled:raw.enabled===true},{expectedRevision:raw.revision});}
  function start(){if(!timer){timer=setInterval(()=>{for(const owner of deps.taskOwners?.()||[]){const profile=access.profileById(owner);if(profile?.enabled!==false&&profile)void tick(profile).catch(err=>deps.onBackgroundError?.(err.code));}},30000);timer.unref?.();}}
  const previousStop=service.stop;service.stop=()=>{if(timer)clearInterval(timer);timer=null;previousStop();};start();
  return {taskCatalog:catalog,taskCreate:create,taskPlan:plan,taskPrepare:prepare,taskExecute:execute,taskAuthorize:authorize,taskReject:reject,taskFeedback:feedback,taskRollback:rollback,taskSchedule:schedule,taskScheduleUpdate:scheduleUpdate,taskTick:tick};
}
module.exports={attachTasks};
