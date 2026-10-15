'use strict';
const {id,hash,error,text}=require('./agent-office-store');
const {allowed}=require('./agent-capability-contract');
const {validate}=require('./agent-tool-schema');
const {valueAt}=require('./agent-runtime');
const TERMINAL=new Set(['completed','partial','failed','cancelled','interrupted','rejected','rolled_back']);
const clone=value=>JSON.parse(JSON.stringify(value));
const host=require('os').hostname();
function executorAlive(step,docs){const beat=docs.find(d=>d.id==='executor-'+step.executorInstanceId&&d.kind==='metadata');if(!beat||Date.parse(beat.expiresAt)<=Date.now())return false;if(step.executorHost!==host)return true;try{process.kill(step.executorPid,0);return true;}catch(err){return err.code==='EPERM';}}

function attachTasks(service,deps) {
  const {store}=service,{toolRegistry:registry,runtime,userAccess:access}=deps;
  const inFlight=new Map(),ticks=new Map();let timer;
  const inverseRunning=job=>job.steps?.some(step=>step.rollbackStatus==='running');
  const assertTaskAvailable=job=>{if(inverseRunning(job))throw error('OFFICE_TASK_RECONCILE',409);};
  const authority=profile=>{const current=access.profileById(profile.id);if(!current||current.enabled===false)throw error('OFFICE_USER_DISABLED',403);return current;};
  const actorHash=profile=>hash(JSON.stringify(access.publicProfile?.(profile)||profile));
  function receiptState(result,toolId){
    if(result.completionPending==='pdf')return 'waiting_output';
    if(result.completionPending==='native-operation'&&registry.hasPendingPoller?.(toolId))return 'waiting_operation';
    if(result.completionPending!==undefined)throw error('OFFICE_NATIVE_RECEIPT_INVALID',409);
    return result.outcome==='partial'?'partial':'completed';
  }
  function receiptGuard(profile,job,step){return state=>{
    const current=authority(profile),agent=requireEnabledAgent(state.records['profile:'+step.agentId]?.doc),tool=registry.get(step.toolId);
    if(agent.revision!==step.agentRevision||actorHash(current)!==step.authorizationFingerprint)throw error('OFFICE_PREVIEW_CHANGED',409);
    if(!allowed(tool,current,access)||!agentHas(agent,tool))throw error('OFFICE_TOOL_FORBIDDEN',403);
    if(job.runtimeDeviceId!==store.db(profile.id).getDeviceId())throw error('OFFICE_TASK_DEVICE',409);
  };}
  // Persist the fact of an already-authorized completed native effect. Current
  // IAM still gates publication, new effects, polling and inverses below.
  // This private receipt may only acknowledge this exact running Runtime step.
  function committedReceiptGuard(profile,job,step,run,result){return state=>{
    const latest=state.records['job:'+job.id]?.doc,active=latest?.steps?.find(value=>value.id===step.id),actual=(deps.runtimeStore||require('./agent-workflow-store')).runForOwner(profile.id,run.id);
    if(!latest||latest.ownerId!==profile.id||latest.type!=='capability-task'||latest.status!=='running'||!active||active.status!=='running'||active.runtimeRunId!==run.id||step.runtimeRunId!==run.id||active.toolId!==step.toolId||active.agentId!==step.agentId||active.agentRevision!==step.agentRevision||JSON.stringify(active.argsResolved)!==JSON.stringify(step.argsResolved))throw error('OFFICE_TASK_RECONCILE',409);
    if(!actual||actual.status!=='completed'||actual.input?.officeJobId!==job.id||actual.input?.officeStepId!==step.id||actual.input?.officeAgentId!==step.agentId||actual.input?.officeAgentRevision!==step.agentRevision||actual.ownerId!==profile.id||actual.dryRun===true||actual.workflowId!=='task_'+job.id+'_'+step.id||actual.executionState?.nodes?.effect?.status!=='success'||actual.executionState?.nodes?.verify?.status!=='success'||JSON.stringify(actual.executionState?.nodes?.effect?.output)!==JSON.stringify(result)||result?.verified!==true)throw error('OFFICE_NATIVE_RECEIPT_INVALID',409);
    if(job.runtimeDeviceId!==store.db(profile.id).getDeviceId()||latest.runtimeDeviceId!==job.runtimeDeviceId)throw error('OFFICE_TASK_DEVICE',409);
  };}
  async function receiptPublication(profile,job,step){
    await store.db(profile.id).privateRecordTransaction(state=>{receiptGuard(profile,job,step)(state);return {result:true};});
    const current=authority(profile);
    if(actorHash(current)!==step.authorizationFingerprint)throw error('OFFICE_PREVIEW_CHANGED',409);
    if(!allowed(registry.get(step.toolId),current,access))throw error('OFFICE_TOOL_FORBIDDEN',403);
  }
  async function taskReceiptPublication(profile,job,{completedOnly=false}={}){
    const steps=(job.steps||[]).filter(step=>step.result||step.restored||!completedOnly&&step.preview);
    for(const step of steps)await receiptPublication(profile,job,step);
    if(steps.length)await store.db(profile.id).privateRecordTransaction(state=>{
      const latest=state.records['job:'+job.id]?.doc;
      if(!latest||latest.revision!==job.revision)throw error('OFFICE_REVISION_CONFLICT',409);
      for(const step of steps)receiptGuard(profile,job,step)(state);
      return {result:true};
    });
    const current=authority(profile);
    for(const step of steps){if(actorHash(current)!==step.authorizationFingerprint)throw error('OFFICE_PREVIEW_CHANGED',409);if(!allowed(registry.get(step.toolId),current,access))throw error('OFFICE_TOOL_FORBIDDEN',403);}
  }
  async function heartbeat(owner){const instance=service.runtimeContext(owner).runtimeInstanceId;await store.save(owner,'metadata',{id:'executor-'+instance,type:'task-executor',instanceId:instance,pid:process.pid,host,expiresAt:new Date(Date.now()+120000).toISOString()});return instance;}
  async function publicRecords(profile,jobs,memories=[]){
    const stamp=actorHash(authority(profile));
    const result=await store.db(profile.id).privateRecordTransaction(state=>{
      const visibility=new Map(),project=job=>{
      if(job.type!=='capability-task')return job;
      try{
        if(job.ownerId!==profile.id)throw error('OFFICE_TOOL_FORBIDDEN',403);
        for(const step of job.steps||[]){
          const tool=registry.get(step.toolId),current=authority(profile),agent=requireEnabledAgent(state.records['profile:'+step.agentId]?.doc);
          if(!allowed(tool,current,access)||!agentHas(agent,tool))throw error('OFFICE_TOOL_FORBIDDEN',403);
          if(step.preview||step.result||step.restored)receiptGuard(profile,job,step)(state);
        }
        return job;
      }catch(err){
        if(!['OFFICE_AGENT_DISABLED','OFFICE_TOOL_FORBIDDEN','OFFICE_PREVIEW_CHANGED','OFFICE_TASK_DEVICE'].includes(err.code))throw err;
        return {id:job.id,type:job.type,status:job.status,createdAt:job.createdAt,updatedAt:job.updatedAt,profileIds:job.profileIds,steps:(job.steps||[]).map(step=>({toolId:step.toolId,agentId:step.agentId,status:step.status,rollbackStatus:step.rollbackStatus,...(step.errorCode?{errorCode:publicFailure({code:step.errorCode},'OFFICE_TASK_FAILED')}:{})})),accessRestricted:true,errorCode:'OFFICE_PREVIEW_CHANGED'};
      }
      };
      const projected=jobs.map(job=>{const value=project(job);visibility.set(job.id,!value.accessRestricted);return value;});
      const memory=memories.filter(item=>{
        if(!item.taskId)return true;
        if(!visibility.has(item.taskId)){const job=state.records['job:'+item.taskId]?.doc;visibility.set(item.taskId,!!job&&!project(job).accessRestricted);}
        return visibility.get(item.taskId);
      });
      return {result:{jobs:projected,memory}};
    });
    if(actorHash(authority(profile))!==stamp)throw error('OFFICE_PREVIEW_CHANGED',409);
    return result;
  }
  const publicJobs=async(profile,jobs)=>(await publicRecords(profile,jobs)).jobs;
  const requireEnabledAgent=agent=>{if(!agent||agent.enabled===false||agent.deleted)throw error('OFFICE_AGENT_DISABLED',403);return agent;};
  const agentHas=(agent,tool)=>(tool.agentAreas||tool.areas||[]).every(area=>agent.areas.includes(area==='koleksiyon'?'collection':area))&&(!tool.agentAnyAreas||tool.agentAnyAreas.some(area=>agent.areas.includes(area)));
  async function catalog(profile,agentId){profile=authority(profile);const agent=requireEnabledAgent(await store.get(profile.id,'profile',agentId));return registry.catalog().filter(tool=>tool.contractVersion>=2&&tool.executionScope==='office-durable-job'&&allowed(tool,profile,access)&&agentHas(agent,tool));}
  async function stepAuthority(profile,step){profile=authority(profile);const agent=requireEnabledAgent(await store.get(profile.id,'profile',step.agentId)),tool=registry.get(step.toolId);
    if(!(tool?.contractVersion>=2)||!allowed(tool,profile,access)||!agentHas(agent,tool))throw error('OFFICE_TOOL_FORBIDDEN',403);
    return {profile,agent,tool};}
  async function resolvedArgs(profile,job,step){const args=clone(step.args);for(const binding of step.bindings||[]){const previous=job.steps.find(item=>item.id===binding.stepId);if(previous?.status!=='completed')throw error('OFFICE_TASK_DEPENDENCY',409);
    await receiptPublication(profile,job,previous);
    const value=valueAt(previous.result,binding.path);if(value===undefined||['__proto__','constructor','prototype'].includes(binding.argument))throw error('OFFICE_TASK_DEPENDENCY',422);args[binding.argument]=clone(value);}return args;}
  async function create(profile,raw,internal={}){profile=authority(profile);if(!Array.isArray(raw.steps)||!raw.steps.length||raw.steps.length>12)throw error('OFFICE_TASK_INVALID');
    const steps=[];for(const input of raw.steps){const step={id:input.id||id(),agentId:input.agentId||raw.agentId,toolId:input.toolId,args:clone(input.args||{}),bindings:input.bindings||[],status:'queued',attempts:0};
      if(steps.some(item=>item.id===step.id)||step.bindings.length>12||step.bindings.some(b=>!steps.some(p=>p.id===b.stepId)||typeof b.argument!=='string'||typeof b.path!=='string'))throw error('OFFICE_TASK_DEPENDENCY');
      const {agent,tool}=await stepAuthority(profile,step);if(tool.executionScope!=='office-durable-job')throw error('OFFICE_TOOL_FORBIDDEN',403);
      if(!step.bindings.length)validate(tool.inputSchema,step.args);step.agentRevision=agent.revision;steps.push(step);}
    const job=await store.save(profile.id,'job',{...service.runtimeContext(profile.id),id:internal.id||id(),type:'capability-task',profileIds:[...new Set(steps.map(s=>s.agentId))],task:text(raw.task||'Buyer Log',4000),steps,status:'queued',aiCalls:raw.aiCalls===1?1:0,execution:'existing-agent-runtime'},{immutable:!!internal.id,assertAuthority:internal.assertAuthority});
    access.appendAudit(profile,'AGENT_TASK_CREATE',job.id,{steps:steps.map(s=>s.toolId)});return prepare(profile,job.id);}
  async function plan(profile,raw){
    profile=authority(profile);const initialActor=actorHash(profile),initialAgent=requireEnabledAgent(await store.get(profile.id,'profile',raw.agentId));
    const check=agent=>{requireEnabledAgent(agent);if(agent.revision!==initialAgent.revision||actorHash(authority(profile))!==initialActor)throw error('OFFICE_PREVIEW_CHANGED',409);};
    const checkCurrent=async()=>check(await store.get(profile.id,'profile',raw.agentId)),allTools=await catalog(profile,raw.agentId);if(!allTools.length)throw error('OFFICE_TOOL_FORBIDDEN',403);
    // Sohbet yönlendiricisi aday araçları seçtiyse planlayıcı yalnız onların şemasını görür; tüm katalog bağlam sınırında kesiliyordu.
    const wanted=new Set(Array.isArray(raw.toolIds)?raw.toolIds.map(String):[]),picked=allTools.filter(tool=>wanted.has(tool.id)),tools=picked.length?picked:allTools;
    const memory=await service.memoryContext(profile,[raw.agentId],'',raw.task,6000,{toolIds:tools.map(tool=>tool.id)});
    await checkCurrent();
    const response=await service.engineOf().ask(profile.id,{requestId:id(),source:'agent-task',lang:raw.lang==='en'?'en':'tr',task:text(raw.task,4000),context:{agentId:raw.agentId,tools:tools.map(t=>({id:t.id,operation:t.operation,label:t.label,description:t.description,inputSchema:t.inputSchema})),memory:memory.selected},guide:'Return planJson as a JSON string: {steps:[{id,toolId,args,bindings:[{argument,stepId,path}]}]}. Use only listed tools. Bindings reference earlier actual results; a path may project a list, e.g. data.items[].plmId, so the result of one module feeds a step of another module. Never invent identifiers, permissions, successful execution, source facts or approvals. Do not place a fingerprint in args. If required identifiers are missing return {steps:[]}.'});
    await checkCurrent();
    if(!response.structured?.ok)throw error('OFFICE_AI_CONTRACT_INVALID',422);let parsed;try{parsed=JSON.parse(response.data.planJson);}catch(_){throw error('OFFICE_AI_CONTRACT_INVALID',422);}
    if(!parsed||typeof parsed!=='object'||Array.isArray(parsed)||!Array.isArray(parsed.steps)||parsed.steps.some(step=>!step||typeof step!=='object'||Array.isArray(step)||!tools.some(tool=>tool.id===step.toolId)))throw error('OFFICE_AI_CONTRACT_INVALID',422);
    return create(profile,{...raw,steps:parsed.steps,aiCalls:1},{assertAuthority:state=>check(state.records['profile:'+raw.agentId]?.doc)});
  }
  async function prepare(profile,key){profile=authority(profile);let job=await store.get(profile.id,'job',key);if(job.type!=='capability-task')throw error('OFFICE_TASK_INVALID');assertTaskAvailable(job);if(TERMINAL.has(job.status)){await taskReceiptPublication(profile,job);return job;}await taskReceiptPublication(profile,job,{completedOnly:true});
    if(job.runtimeDeviceId!==store.db(profile.id).getDeviceId())throw error('OFFICE_TASK_DEVICE',409);
    const index=job.steps.findIndex(step=>step.status!=='completed');if(index<0){for(const step of job.steps)await receiptPublication(profile,job,step);job=await store.save(profile.id,'job',{...job,status:'completed',finishedAt:new Date().toISOString()},{expectedRevision:job.revision});
      for(const step of job.steps)await receiptPublication(profile,job,step);
      for(const profileId of job.profileIds){const steps=job.steps.filter(step=>step.agentId===profileId);await store.save(profile.id,'memory',{id:'outcome-'+job.id+'-'+profileId,profileId,type:'task',category:'task-history',text:JSON.stringify({task:job.task,status:job.status,steps:steps.map(s=>({toolId:s.toolId,status:s.status,verified:s.result?.verified===true}))}),sourceId:job.id,toolIds:steps.map(s=>s.toolId),taskId:job.id,active:true,approved:false,origin:'verified-service',authorizationFingerprint:steps.every(step=>step.authorizationFingerprint===steps[0]?.authorizationFingerprint)?steps[0]?.authorizationFingerprint:hash(JSON.stringify(steps.map(step=>step.authorizationFingerprint))),confidence:'VERIFIED_RESULT',key:'',conflictingIds:[]},{immutable:true});}
      for(const step of job.steps)await receiptPublication(profile,job,step);return job;}
    const step=job.steps[index];if(['waiting_output','waiting_operation'].includes(step.status))return job;if(step.status==='running')throw error('OFFICE_TASK_RECONCILE',409);
    const {profile:current,agent,tool}=await stepAuthority(profile,step),args=await resolvedArgs(profile,job,step);
    const originalAuthority=actorHash(current),preview=await registry.execute(tool.id,args,{ownerId:profile.id,profile:current,dryRun:true,input:{officeAgentId:step.agentId,officeAgentRevision:agent.revision}});
    const latest=await stepAuthority(profile,step);if(latest.agent.revision!==agent.revision||actorHash(latest.profile)!==originalAuthority)throw error('OFFICE_PREVIEW_CHANGED',409);
    job.steps[index]={...step,argsResolved:args,preview,agentRevision:agent.revision,authorizationFingerprint:actorHash(latest.profile),status:tool.approval?'waiting_approval':'ready',prepareFailures:0,errorCode:''};
    const saved=await store.save(profile.id,'job',{...job,status:tool.approval?'waiting_approval':'queued',errorCode:'',nextPrepareAt:null},{expectedRevision:job.revision});await taskReceiptPublication(profile,saved);return saved;}
  function executionArgs(step){return {...step.argsResolved,...(registry.get(step.toolId)?.approval&&step.preview.fingerprint?{fingerprint:step.preview.fingerprint}:{})};}
  function graph(job,step){const nodes=[{id:'start',type:'trigger.manual',config:{}},{id:'effect',type:'tool.call',config:{toolId:step.toolId,args:executionArgs(step)}},{id:'verify',type:'verify.result',config:{mode:'equals',path:'verified',value:true}},{id:'result',type:'output.result',config:{}}];return{id:'task_'+job.id+'_'+step.id,ownerId:job.ownerId,name:job.task,nodes,edges:nodes.slice(1).map((n,i)=>({id:'e'+i,from:nodes[i].id,to:n.id,channel:'success'}))};}
  async function executeOnce(profile,key,raw={}){profile=authority(profile);let job=await store.get(profile.id,'job',key);assertTaskAvailable(job);if(TERMINAL.has(job.status)){await taskReceiptPublication(profile,job);return job;}await taskReceiptPublication(profile,job,{completedOnly:true});
    if(job.runtimeDeviceId!==store.db(profile.id).getDeviceId())throw error('OFFICE_TASK_DEVICE',409);
    const index=job.steps.findIndex(step=>step.status!=='completed'),step=job.steps[index];if(!step||!['ready','waiting_approval'].includes(step.status))throw error('OFFICE_TASK_RECONCILE',409);
    const {profile:current,agent,tool}=await stepAuthority(profile,step);
    if(agent.revision!==step.agentRevision||actorHash(current)!==step.authorizationFingerprint)throw error('OFFICE_PREVIEW_CHANGED',409);
    if(tool.approval&&(raw.confirmed!==true||raw.fingerprint!==step.preview.fingerprint))throw error('OFFICE_APPROVAL_REQUIRED',409);
    const executorInstanceId=await heartbeat(profile.id);
    job.steps[index]={...step,status:'running',attempts:step.attempts+1,executorPid:process.pid,executorHost:host,executorInstanceId};job=await store.save(profile.id,'job',{...job,status:'running'},{expectedRevision:job.revision});
    let receiptCommitted=false;
    try{let execution=await runtime.execute({ownerId:profile.id,profile:current,workflow:graph(job,step),input:{officeJobId:job.id,officeStepId:step.id,officeAgentId:step.agentId,officeAgentRevision:step.agentRevision},onRunCreated:async run=>{job.steps[index].runtimeRunId=run.id;job=await store.save(profile.id,'job',job,{expectedRevision:job.revision});}});
      if(execution.run.status==='waiting_approval')execution=await runtime.resumeApproval({ownerId:profile.id,profile:authority(profile),runId:execution.run.id,approved:true});
      const result=execution.run.executionState.nodes.effect?.output,ok=execution.run.status==='completed'&&result?.verified===true;
      const retry=!ok&&tool.risk==='read'&&job.steps[index].attempts<3;
      const verifiedState=ok?receiptState(result,tool.id):null,pending=verifiedState?.startsWith('waiting_'),partial=verifiedState==='partial';
      job.steps[index]={...job.steps[index],result:result||null,status:verifiedState|| (retry?'queued':'failed'),runtimeStatus:execution.run.status,errorCode:execution.run.output?.code||'',finishedAt:pending?null:new Date().toISOString()};
      job=await store.save(profile.id,'job',{...job,status:pending?verifiedState:partial?'partial':ok||retry?'queued':'failed'},{expectedRevision:job.revision,...(ok?{assertAuthority:committedReceiptGuard(profile,job,job.steps[index],execution.run,result)}:{})});
      receiptCommitted=ok;
      if(ok)await taskReceiptPublication(profile,job);
      access.appendAudit(current,'AGENT_TASK_STEP_RESULT',job.id,{stepId:step.id,toolId:step.toolId,status:job.steps[index].status});
      return ok&&!pending&&!partial?prepare(profile,job.id):(await publicJobs(profile,[job]))[0];
    }catch(err){if(receiptCommitted)throw err;const latest=await store.get(profile.id,'job',job.id);latest.steps[index]={...latest.steps[index],status:tool.risk==='read'?'queued':'interrupted',errorCode:err.code||'OFFICE_TASK_RECONCILE'};
      await store.save(profile.id,'job',{...latest,status:tool.risk==='read'&&latest.steps[index].attempts<3?'queued':'interrupted'},{expectedRevision:latest.revision});throw err;}}
  async function execute(profile,key,raw){const token=profile.id+':'+key;if(inFlight.has(token))return inFlight.get(token);const work=executeOnce(profile,key,raw).finally(()=>inFlight.delete(token));inFlight.set(token,work);return work;}
  async function outputAccess(profile,key,stepId){profile=authority(profile);const job=await store.get(profile.id,'job',key),step=job.steps?.find(s=>s.id===stepId);if(!step||job.type!=='capability-task')throw error('OFFICE_NOT_FOUND',404);
    const live=await stepAuthority(profile,step);if(step.agentRevision!==live.agent.revision||step.authorizationFingerprint!==actorHash(live.profile)||job.runtimeDeviceId!==store.db(profile.id).getDeviceId())throw error('OFFICE_PREVIEW_CHANGED',409);
    await taskReceiptPublication(profile,job);const output=deps.outputService?.();if(!output)throw error('OFFICE_OUTPUT_INVALID',409);return {job,step,output,profile:live.profile};}
  async function pendingOutput(profile,key,stepId){const state=await outputAccess(profile,key,stepId);if(state.step.status!=='waiting_output')throw error('OFFICE_TASK_RECONCILE',409);
    const saved=state.output.store.byRequest(state.profile.id,state.step.result.output.requestId);if(saved)return {output:saved};
    const pending=state.output.store.takePending(state.profile.id,state.step.result.output.pendingId,{keep:true});if(!pending)throw error('OFFICE_OUTPUT_EXPIRED',409);
    return {output:{pending:'pdf',pendingId:state.step.result.output.pendingId,html:pending.html,landscape:pending.orientation==='landscape'}};}
  async function completeOutput(profile,key,raw){const state=await outputAccess(profile,key,raw.stepId);let {job,step}=state;
    assertTaskAvailable(job);
    if(step.status==='completed'&&step.result.output.id===raw.outputId)return job;
    if(step.status!=='waiting_output')throw error('OFFICE_TASK_RECONCILE',409);
    const record=state.output.get(state.profile.id,raw.outputId);if(!record||record.requestId!==step.result.output.requestId||!(record.format==='pdf'||record.format==='html'&&raw.acceptFallback===true))throw error('OFFICE_OUTPUT_INVALID',409);
    const bytes=require('fs').readFileSync(record.path);if(bytes.length!==record.bytes||record.format==='pdf'&&bytes.subarray(0,5).toString()!=='%PDF-')throw error('OFFICE_OUTPUT_INVALID',409);
    step.result=require('./agent-report-output-contract').fileResult(record,{fallback:record.format==='html'});step.status='completed';step.finishedAt=new Date().toISOString();
    job=await store.save(state.profile.id,'job',{...job,status:'queued'},{expectedRevision:job.revision});access.appendAudit(state.profile,'AGENT_OUTPUT_COMPLETE',job.id,{stepId:step.id,format:record.format});return prepare(state.profile,job.id);}
  async function printOutput(profile,key,stepId,bytes){const state=await outputAccess(profile,key,stepId);assertTaskAvailable(state.job);if(state.step.status!=='waiting_output')throw error('OFFICE_TASK_RECONCILE',409);
    const saved=state.output.store.byRequest(state.profile.id,state.step.result.output.requestId);if(saved)return saved;
    const pendingId=state.step.result.output.pendingId;return bytes?state.output.completePdf(state.profile.id,pendingId,bytes,{officeAuthorized:true}):state.output.fallbackHtml(state.profile.id,pendingId,{officeAuthorized:true});}
  async function outputFile(profile,key,stepId){const state=await outputAccess(profile,key,stepId),record=state.output.get(state.profile.id,state.step.result?.output?.id);if(state.step.status!=='completed'||!record||record.requestId!==state.step.result.output.requestId)throw error('OFFICE_NOT_FOUND',404);return record;}
  async function authorize(ctx,args){const job=await store.get(ctx.ownerId,'job',ctx.input?.officeJobId),step=job.steps?.find(s=>s.id===ctx.input?.officeStepId);
    assertTaskAvailable(job);
    const expected=step?executionArgs(step):null;
    if(job.type!=='capability-task'||job.status!=='running'||!step||step.status!=='running'||step.runtimeRunId!==ctx.runId||step.toolId!==ctx.toolId||ctx.input.officeAgentId!==step.agentId||ctx.input.officeAgentRevision!==step.agentRevision||JSON.stringify(expected)!==JSON.stringify(args))throw error('OFFICE_APPROVAL_REQUIRED',403);
    const {profile,agent}=await stepAuthority({id:ctx.ownerId},step);if(step.authorizationFingerprint!==actorHash(profile)||agent.revision!==step.agentRevision)throw error('OFFICE_PREVIEW_CHANGED',409);
    for(const binding of step.bindings||[]){const previous=job.steps.find(s=>s.id===binding.stepId);if(previous?.status!=='completed')throw error('OFFICE_TASK_DEPENDENCY',409);await receiptPublication(profile,job,previous);}
    await receiptPublication(profile,job,step);
  }
  async function authorizePending(ctx,receipt){
    const job=await store.get(ctx.ownerId,'job',ctx.input?.officeJobId),step=job.steps?.find(s=>s.id===ctx.input?.officeStepId);assertTaskAvailable(job);
    if(job.type!=='capability-task'||job.status!=='waiting_operation'||!step||step.status!=='waiting_operation'||step.runtimeRunId!==ctx.runId||step.toolId!==ctx.toolId||ctx.input.officeAgentId!==step.agentId||ctx.input.officeAgentRevision!==step.agentRevision||JSON.stringify(step.result)!==JSON.stringify(receipt))throw error('OFFICE_APPROVAL_REQUIRED',403);
    if(job.runtimeDeviceId!==store.db(ctx.ownerId).getDeviceId())throw error('OFFICE_TASK_DEVICE',409);
    const {profile,agent}=await stepAuthority({id:ctx.ownerId},step);
    if(step.authorizationFingerprint!==actorHash(profile)||agent.revision!==step.agentRevision)throw error('OFFICE_PREVIEW_CHANGED',409);
  }
  async function nativeGuard(ctx,work){
    if(work!==undefined&&typeof work!=='function')throw error('OFFICE_APPROVAL_REQUIRED',403);
    return store.db(ctx.ownerId).privateRecordTransaction(state=>{
      const job=state.records['job:'+ctx.input?.officeJobId]?.doc,step=job?.steps?.find(s=>s.id===ctx.input?.officeStepId);
      if(!job||job.ownerId!==ctx.ownerId||job.deleted||job.type!=='capability-task'||!['running','waiting_operation'].includes(job.status)||!step||!['running','waiting_operation'].includes(step.status)||step.toolId!==ctx.toolId||step.runtimeRunId!==ctx.runId||step.agentId!==ctx.input.officeAgentId||step.agentRevision!==ctx.input.officeAgentRevision)throw error('OFFICE_APPROVAL_REQUIRED',403);
      assertTaskAvailable(job);receiptGuard({id:ctx.ownerId},job,step)(state);ctx.assertAuthority();
      for(const binding of step.bindings||[]){const previous=job.steps.find(s=>s.id===binding.stepId);if(previous?.status!=='completed')throw error('OFFICE_TASK_DEPENDENCY',409);receiptGuard({id:ctx.ownerId},job,previous)(state);}
      const result=work?work():true;
      if(result&&typeof result.then==='function')throw error('OFFICE_TASK_RECONCILE',409);
      return {result};
    });
  }
  async function pollOnce(profile,key){
    profile=authority(profile);let job=await store.get(profile.id,'job',key);assertTaskAvailable(job);
    if(job.runtimeDeviceId!==store.db(profile.id).getDeviceId())throw error('OFFICE_TASK_DEVICE',409);
    if(job.status!=='waiting_operation'){await taskReceiptPublication(profile,job);return job;}
    const index=job.steps.findIndex(step=>step.status!=='completed'),step=job.steps[index];
    if(step?.status!=='waiting_operation')throw error('OFFICE_TASK_RECONCILE',409);
    let receiptCommitted=false;
    try{
      const result=await registry.pollPending(step.toolId,step.result,{ownerId:profile.id,profile,runId:step.runtimeRunId,input:{officeJobId:job.id,officeStepId:step.id,officeAgentId:step.agentId,officeAgentRevision:step.agentRevision}}),status=receiptState(result,step.toolId),pending=status==='waiting_operation';
      job.steps[index]={...step,result,status,pollFailures:0,errorCode:'',finishedAt:pending?null:new Date().toISOString()};
      job=await store.save(profile.id,'job',{...job,status:pending?'waiting_operation':status==='partial'?'partial':'queued',errorCode:''},{expectedRevision:job.revision,assertAuthority:receiptGuard(profile,job,step)});
      receiptCommitted=true;
      await receiptPublication(profile,job,step);
      return status==='completed'?prepare(profile,job.id):job;
    }catch(err){
      if(receiptCommitted)throw err;
      if(err.code==='OFFICE_REVISION_CONFLICT')return store.get(profile.id,'job',key);
      const retry=err.code==='OFFICE_SOURCE_UNAVAILABLE'&&(step.pollFailures||0)<2,code=/^(OFFICE_[A-Z_]+|OAB_[A-Z_]+|SHARED_WRITE_BUSY)$/.test(err.code||'')?err.code:'OFFICE_NATIVE_OPERATION_FAILED';
      job.steps[index]={...step,status:retry?'waiting_operation':'interrupted',pollFailures:(step.pollFailures||0)+1,errorCode:code};
      try{const saved=await store.save(profile.id,'job',{...job,status:retry?'waiting_operation':'interrupted',errorCode:code},{expectedRevision:job.revision});if(actorHash(authority(profile))!==step.authorizationFingerprint)throw error('OFFICE_PREVIEW_CHANGED',409);return saved;}
      catch(conflict){if(conflict.code==='OFFICE_REVISION_CONFLICT')return store.get(profile.id,'job',key);throw conflict;}
    }
  }
  async function poll(profile,key){const token=profile.id+':'+key;if(inFlight.has(token))return inFlight.get(token);const work=pollOnce(profile,key).finally(()=>inFlight.delete(token));inFlight.set(token,work);return work;}
  async function reject(profile,key,raw){profile=authority(profile);let job=await store.get(profile.id,'job',key);await taskReceiptPublication(profile,job);if(!['waiting_approval','queued'].includes(job.status))throw error('OFFICE_TASK_RECONCILE',409);
    assertTaskAvailable(job);
    job=await store.save(profile.id,'job',{...job,status:'rejected',feedback:text(raw?.feedback||'',2000)},{expectedRevision:job.revision});
    if(job.feedback)await feedback(profile,key,{text:job.feedback,outcome:'rejected'});access.appendAudit(profile,'AGENT_TASK_REJECT',key,{});await taskReceiptPublication(profile,job);return job;}
  async function feedback(profile,key,raw){profile=authority(profile);const expected=actorHash(profile),job=await store.get(profile.id,'job',key);await taskReceiptPublication(profile,job);
    return store.learn(profile.id,job.profileIds[0],{type:'preference',text:text(raw.text,2000),key:raw.key||'',sourceId:job.id,approved:raw.approved===true},{assertAuthority:()=>{if(actorHash(authority(profile))!==expected)throw error('OFFICE_PREVIEW_CHANGED',409);},metadata:{feedbackKind:raw.outcome==='rejected'?'rejection':'correction',toolIds:job.steps?.map(s=>s.toolId)||[],taskId:job.id,authorizationFingerprint:expected}});}
  async function rollback(profile,key,raw){profile=authority(profile);let job=await store.get(profile.id,'job',key);const index=job.steps?.findIndex(s=>s.id===raw.stepId),step=job.steps?.[index];
    if(raw.confirmed!==true||!step||!['completed','partial','rolled_back'].includes(step.status)||!step.result?.rollbackToken||job.runtimeDeviceId!==store.db(profile.id).getDeviceId())throw error('OFFICE_ROLLBACK_INVALID',409);
    const {tool,profile:current,agent}=await stepAuthority(profile,step);if(step.rollbackStatus==='completed')return (await publicJobs(profile,[job]))[0];assertTaskAvailable(job);if(job.status==='running')throw error('OFFICE_TASK_RECONCILE',409);
    if(!tool.rollbackable||typeof tool.rollback!=='function')throw error('OFFICE_ROLLBACK_INVALID',409);
    // Later receipts and attempted mutations can represent real or uncertain
    // effects, even when their task status is not completed. Undo them first.
    if(job.steps.slice(index+1).some(s=>['completed','partial','waiting_output','waiting_operation','running'].includes(s.status)||s.status!=='rolled_back'&&s.attempts>0&&registry.get(s.toolId)?.risk!=='read'))throw error('OFFICE_ROLLBACK_DEPENDENCY',409);
    job.steps[index]={...step,rollbackStatus:'running'};job=await store.save(profile.id,'job',job,{expectedRevision:job.revision});let restoredReceiptCommitted=false;
    try{const restored=await registry.rollback(tool.id,step.result.rollbackToken,{ownerId:profile.id,profile:current,approvalGranted:true,input:{officeAgentId:step.agentId,officeJobId:job.id,officeStepId:step.id,officeAgentRevision:agent.revision}});if(restored?.verified!==true)throw error('OFFICE_ROLLBACK_VERIFY_FAILED',409);job.steps[index].rollbackStatus='completed';delete job.steps[index].rollbackErrorCode;job.steps[index].status='rolled_back';job.steps[index].restored=restored;job.status='rolled_back';
      for(const downstream of job.steps.slice(index+1)){if(downstream.status!=='rolled_back')downstream.status='cancelled';delete downstream.preview;delete downstream.argsResolved;}job=await store.save(profile.id,'job',job,{expectedRevision:job.revision});restoredReceiptCommitted=true;return (await publicJobs(profile,[job]))[0];}
    catch(err){if(restoredReceiptCommitted)throw err;job.steps[index].rollbackStatus='failed';job.steps[index].rollbackErrorCode=err.code||'OFFICE_TASK_RECONCILE';await store.save(profile.id,'job',job,{expectedRevision:job.revision});throw err;}}
  async function schedule(profile,raw){profile=authority(profile);const tools=await catalog(profile,raw.agentId),tool=tools.find(t=>t.id===raw.toolId);if(!tool||tool.risk!=='read'||raw.confirmed!==true)throw error('OFFICE_SCHEDULE_SCOPE',403);
    validate(tool.inputSchema,raw.args||{});const due=Date.parse(raw.nextRunAt),minutes=Number(raw.intervalMinutes);if(!Number.isFinite(due)||!Number.isInteger(minutes)||minutes<15||minutes>525600)throw error('OFFICE_TASK_INVALID');
    try{new Intl.DateTimeFormat('en',{timeZone:raw.timeZone}).format();}catch(_){throw error('OFFICE_TIMEZONE_INVALID');}
    const agent=requireEnabledAgent(await store.get(profile.id,'profile',raw.agentId)),saved={id:'schedule-'+id(),type:'capability-schedule',...service.runtimeContext(profile.id),agentId:agent.id,agentRevision:agent.revision,toolId:tool.id,args:raw.args||{},nextRunAt:new Date(due).toISOString(),intervalMinutes:minutes,timeZone:raw.timeZone,missedRunPolicy:raw.missedRunPolicy==='skip'?'skip':'run-once',enabled:true,authorizationFingerprint:actorHash(profile),hostRequirement:'Buyer Log backend must be running'};return store.save(profile.id,'metadata',saved,{assertAuthority:scheduleGuard(profile,saved)});}
  const transientPreview=code=>['OFFICE_SOURCE_UNAVAILABLE','SHARED_WRITE_BUSY','OFFICE_WORKER_UNAVAILABLE'].includes(code);
  const publicFailure=(err,fallback)=>/^(OFFICE_[A-Z_]+|AI_AUTOMATION_[A-Z_]+|OAB_[A-Z_]+|SHARED_WRITE_BUSY)$/.test(err?.code||'')?err.code:fallback;
  function scheduleGuard(profile,saved,{active=false}={}){return state=>{
    if(active){const current=state.records['metadata:'+saved.id]?.doc;if(!current?.enabled||current.revision!==saved.revision)throw error('OFFICE_REVISION_CONFLICT',409);}
    const agent=requireEnabledAgent(state.records['profile:'+saved.agentId]?.doc),current=authority(profile),tool=registry.get(saved.toolId);
    if(actorHash(current)!==saved.authorizationFingerprint||agent.revision!==saved.agentRevision)throw error('OFFICE_PREVIEW_CHANGED',409);
    if(tool?.risk!=='read'||tool.executionScope!=='office-durable-job'||!allowed(tool,current,access)||!agentHas(agent,tool))throw error('OFFICE_SCHEDULE_SCOPE',403);
  };}
  async function backgroundFailure(profile,kind,snapshot,err){
    if(err.code==='OFFICE_REVISION_CONFLICT')return;
    const latest=await store.get(profile.id,kind,snapshot.id);
    if(latest.revision!==snapshot.revision)return;
    const code=publicFailure(err,kind==='job'?'OFFICE_TASK_FAILED':'OFFICE_SCHEDULE_FAILED'),at=new Date().toISOString();
    let update;
    if(kind==='job'){
      if(latest.status!=='queued')return;
      const index=latest.steps.findIndex(step=>step.status!=='completed'),step=latest.steps[index];
      if(!step||!['queued','ready'].includes(step.status))return;
      const failures=(step.prepareFailures||0)+1,retry=registry.get(step.toolId)?.risk==='read'&&transientPreview(code)&&failures<3;
      latest.steps[index]={...step,status:retry?'queued':'failed',prepareFailures:failures,errorCode:code,...(!retry?{finishedAt:at}:{})};
      update={...latest,status:retry?'queued':'failed',errorCode:code,nextPrepareAt:retry?new Date(Date.now()+30000*2**(failures-1)).toISOString():null,...(!retry?{finishedAt:at}:{})};
    }else{
      if(!latest.enabled)return;
      const failures=(latest.backgroundFailures||0)+1,retry=transientPreview(code)&&failures<3;
      update={...latest,enabled:retry,errorCode:code,backgroundFailures:failures,nextAttemptAt:retry?new Date(Date.now()+30000*2**(failures-1)).toISOString():null,...(!retry?{pausedAt:at}:{})};
    }
    try{await store.save(profile.id,kind,update,{expectedRevision:latest.revision});access.appendAudit(authority(profile),kind==='job'?'AGENT_TASK_BACKGROUND_FAILURE':'AGENT_SCHEDULE_BACKGROUND_FAILURE',latest.id,{code,retry:kind==='job'?update.status==='queued':update.enabled});}
    catch(failure){if(failure.code!=='OFFICE_REVISION_CONFLICT')throw failure;}
  }
  async function tickOnce(profile){profile=authority(profile);const docs=await store.records(profile.id),device=store.db(profile.id).getDeviceId();
    if(docs.some(d=>d.type==='capability-task'&&!TERMINAL.has(d.status)||d.type==='capability-schedule'&&d.enabled))await heartbeat(profile.id);
    for(let job of docs.filter(d=>d.kind==='job'&&d.type==='capability-task'&&!TERMINAL.has(d.status)&&d.runtimeDeviceId===device)){
      if(inFlight.has(profile.id+':'+job.id)||inverseRunning(job))continue;
      const running=job.steps.find(s=>s.status==='running');if(running){const run=deps.runtimeStore?.runForOwner(profile.id,running.runtimeRunId),receipt=run?.executionState?.nodes?.effect?.output;
        if(run?.status==='completed'&&receipt?.verified===true){
          try{validate(registry.get(running.toolId).outputSchema,receipt);running.status=receiptState(receipt,running.toolId);running.result=receipt;job=await store.save(profile.id,'job',{...job,status:['waiting_output','waiting_operation','partial'].includes(running.status)?running.status:'queued'},{expectedRevision:job.revision,assertAuthority:receiptGuard(profile,job,running)});}
          catch(err){running.status='interrupted';await store.save(profile.id,'job',{...job,status:'interrupted',errorCode:err.code||'OFFICE_NATIVE_RECEIPT_INVALID'},{expectedRevision:job.revision});continue;}
        }
        else if(executorAlive(running,docs))continue;
        else if(registry.get(running.toolId)?.risk==='read'){running.status='queued';job=await store.save(profile.id,'job',{...job,status:'queued'},{expectedRevision:job.revision});}
        else{running.status='interrupted';await store.save(profile.id,'job',{...job,status:'interrupted',errorCode:'OFFICE_TASK_RECONCILE'},{expectedRevision:job.revision});continue;}}
      if(job.status==='waiting_operation')job=await poll(profile,job.id);
      if(job.status==='queued'&&(!job.nextPrepareAt||Date.parse(job.nextPrepareAt)<=Date.now())){try{job=await prepare(profile,job.id);if(job.status==='queued')await execute(profile,job.id);}catch(err){await backgroundFailure(profile,'job',job,err);deps.onBackgroundError?.(publicFailure(err,'OFFICE_TASK_FAILED'));}}}
    for(const saved of docs.filter(d=>d.kind==='metadata'&&d.type==='capability-schedule'&&d.enabled&&d.runtimeDeviceId===device&&Date.parse(d.nextRunAt)<=Date.now()&&(!d.nextAttemptAt||Date.parse(d.nextAttemptAt)<=Date.now()))){
      try{await store.db(profile.id).privateRecordTransaction(state=>{scheduleGuard(profile,saved,{active:true})(state);return {result:true};});
        const missed=Date.now()-Date.parse(saved.nextRunAt)>saved.intervalMinutes*60000;
        // The occurrence ID is deterministic and WAL-immutable: a crash between
        // job creation and advancing the schedule returns that same job.
        const occurrence=hash(saved.id+':'+saved.nextRunAt);
        if(!missed||saved.missedRunPolicy==='run-once')await create(profile,{agentId:saved.agentId,task:saved.toolId,steps:[{toolId:saved.toolId,args:saved.args}]},{id:occurrence,assertAuthority:scheduleGuard(profile,saved,{active:true})});
        await store.save(profile.id,'metadata',{...saved,lastOccurrence:occurrence,lastDueAt:saved.nextRunAt,lastOccurrenceStatus:missed&&saved.missedRunPolicy==='skip'?'skipped':'queued',backgroundFailures:0,errorCode:'',nextAttemptAt:null,nextRunAt:new Date(Date.now()+saved.intervalMinutes*60000).toISOString()},{expectedRevision:saved.revision,assertAuthority:scheduleGuard(profile,saved,{active:true})});
      }catch(err){await backgroundFailure(profile,'metadata',saved,err);deps.onBackgroundError?.(publicFailure(err,'OFFICE_SCHEDULE_FAILED'));}}
  }
  async function tick(profile){const key=profile.id;if(ticks.has(key))return ticks.get(key);const work=tickOnce(profile).finally(()=>ticks.delete(key));ticks.set(key,work);return work;}
  async function scheduleUpdate(profile,key,raw){
    profile=authority(profile);const previous=await store.get(profile.id,'metadata',key);
    if(previous.type!=='capability-schedule')throw error('OFFICE_NOT_FOUND',404);
    if(!Number.isSafeInteger(raw.revision))throw error('OFFICE_REVISION_CONFLICT',409);
    if(raw.enabled!==true)return store.save(profile.id,'metadata',{...previous,enabled:false},{expectedRevision:raw.revision});
    if(raw.confirmed!==true)throw error('OFFICE_APPROVAL_REQUIRED',409);
    const tools=await catalog(profile,previous.agentId);if(!tools.some(t=>t.id===previous.toolId&&t.risk==='read'))throw error('OFFICE_SCHEDULE_SCOPE',403);
    const agent=requireEnabledAgent(await store.get(profile.id,'profile',previous.agentId)),renewed={...previous,enabled:true,agentRevision:agent.revision,authorizationFingerprint:actorHash(profile),errorCode:'',backgroundFailures:0,nextAttemptAt:null,pausedAt:null};
    validate(registry.get(previous.toolId).inputSchema,previous.args);
    return store.save(profile.id,'metadata',renewed,{expectedRevision:raw.revision,assertAuthority:scheduleGuard(profile,renewed)});
  }
  function start(){if(!timer){timer=setInterval(()=>{for(const owner of deps.taskOwners?.()||[]){const profile=access.profileById(owner);if(profile?.enabled!==false&&profile)void tick(profile).catch(err=>deps.onBackgroundError?.(err.code));}},30000);timer.unref?.();}}
  const previousStop=service.stop;service.stop=()=>{if(timer)clearInterval(timer);timer=null;previousStop();};start();
  async function draftAccess(profile,key,filename){profile=authority(profile);const job=await store.get(profile.id,'job',key),step=job.steps?.find(item=>['cp.weekly.draft','quality.fail.drafts','automation.recipe.execute'].includes(item.toolId)&&['completed','partial'].includes(item.status)&&item.result?.verified===true&&item.result.emails?.some(mail=>mail.filename===filename));if(!step)throw error('OFFICE_TOOL_FORBIDDEN',403);await receiptPublication(profile,job,step);return {job,step};}
  return {taskPublicState:publicRecords,taskPublicJobs:publicJobs,taskDraftAccess:draftAccess,taskCatalog:catalog,taskCreate:create,taskPlan:plan,taskPrepare:prepare,taskExecute:execute,taskAuthorize:authorize,taskAuthorizePending:authorizePending,taskNativeGuard:nativeGuard,taskPollOperation:poll,taskReject:reject,taskFeedback:feedback,taskRollback:rollback,taskSchedule:schedule,taskScheduleUpdate:scheduleUpdate,taskTick:tick,taskPendingOutput:pendingOutput,taskCompleteOutput:completeOutput,taskOutputFile:outputFile,taskPrintOutput:printOutput};
}
module.exports={attachTasks};
