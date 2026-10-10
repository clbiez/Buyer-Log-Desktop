'use strict';

// Orchestration belongs to Buyer Log, not the model. Each step uses the common
// engine through service.run; model output can never add steps or permissions.
const {id,hash,error,text}=require('./agent-office-store');
function attachWorkflow(service,{userAccess}) {
  const running=new Set();
  async function preview(profile,raw={}) {
    const state=await service.state(profile);
    const profileIds=[...new Set(Array.isArray(raw.profileIds)?raw.profileIds:[])];
    const task=text(raw.task,4000), rounds=raw.rounds===2?2:1;
    if(!task||profileIds.length<2||profileIds.length>4)throw error('OFFICE_TASK_INVALID');
    const agents=profileIds.map(key=>{const agent=state.profiles.find(p=>p.id===key);if(!agent)throw error('OFFICE_NOT_FOUND',404);return agent;});
    const scope=require('./agent-office-service').inferScope(task,raw.scope);
    const steps=[];
    for(let round=1;round<=rounds;round++)for(const agent of agents)steps.push({id:`${round}:${agent.id}`,profileIds:[agent.id],name:agent.name,round,kind:round===1?'analysis':'review'});
    steps.push({id:'synthesis',profileIds,name:agents.map(a=>a.name).join(' + '),round:rounds+1,kind:'synthesis'});
    const authority={areas:service.allowedAreas(profile),agents:agents.map(a=>({id:a.id,revision:a.revision,areas:a.areas})),profile:userAccess.profileById?.(profile.id)||profile};
    const plan={task,profileIds,scope,rounds,steps,calls:steps.length,execution:'sequential-lcw-engine',sourceChanges:false};
    return {...plan,fingerprint:hash(JSON.stringify({plan,authority}))};
  }
  async function run(profile,raw,onProgress=()=>{}) {
    const plan=await preview(profile,raw);
    if(raw.confirmed!==true||raw.fingerprint!==plan.fingerprint)throw error('OFFICE_PREVIEW_CHANGED',409);
    if(running.has(profile.id))throw error('OFFICE_BUSY',429);
    running.add(profile.id);
    let conversation,job;
    try {
    conversation=await service.store.conversation(profile.id,plan.profileIds,plan.task.slice(0,80));
    job=await service.store.save(profile.id,'job',{...service.runtimeContext(profile.id),id:id(),type:'coordination',task:plan.task,profileIds:plan.profileIds,conversationId:conversation.id,status:'running',plannedCalls:plan.calls,calls:0,steps:plan.steps.map(step=>({...step,status:'waiting'})),scope:plan.scope,perspectiveMode:'recorded-multi-step',fingerprint:plan.fingerprint});
      await service.store.appendMessage(profile.id,conversation.id,{role:'user',text:plan.task,requestId:job.id});
      for(let index=0;index<job.steps.length;index++) {
        if(raw.signal?.aborted)throw error('OFFICE_CANCELLED',409);
        // Fresh session-independent IAM and agent revisions gate EVERY step.
        const current=await preview(userAccess.profileById?.(profile.id)||profile,raw);
        if(current.fingerprint!==plan.fingerprint)throw error('OFFICE_PREVIEW_CHANGED',409);
        let step=job.steps[index];step.status='running';step.startedAt=new Date().toISOString();
        job=await service.store.save(profile.id,'job',{...job,steps:job.steps});
        step=job.steps[index];
        onProgress({phase:step.kind,workflowId:job.id,index,total:job.steps.length,profileIds:step.profileIds});
        const previous=job.steps.filter(s=>s.status==='completed'&&s.messageId);
        const handoffs=[];
        for(const prior of previous){const message=await service.store.get(profile.id,'message',prior.messageId);handoffs.push({id:message.id,from:prior.profileIds,round:prior.round,text:message.text.slice(0,Math.floor(6500/Math.max(1,previous.length))),excerpt:message.text.length>Math.floor(6500/Math.max(1,previous.length)),fullCharacters:message.text.length,contentHash:hash(message.text),origin:'agent-proposal',confidence:'LOW',updatedAt:message.createdAt,sourceIds:message.sourceIds});}
        const result=await service.run(profile,{profileIds:step.profileIds,task:plan.task,scope:plan.scope,lang:raw.lang,signal:raw.signal},event=>{if(event.phase==='ai-call')job.calls++;onProgress({...event,workflowId:job.id,index,total:job.steps.length,profileIds:step.profileIds});},{handoffs,orchestration:{id:job.id,kind:step.kind,round:step.round,total:job.steps.length}});
        // Keep a durable, named exchange in the shared conversation, linked to
        // its actual single-agent child job and reply. Never fabricate dialogue.
        const copied=await service.store.appendMessage(profile.id,conversation.id,{role:'assistant',text:result.message.text,requestId:job.id,sourceIds:result.message.sourceIds,provenance:{...result.message.provenance,agentIds:step.profileIds,stage:step.kind,round:step.round,childJobId:result.job.id,sourceReplyId:result.message.id,independentReviews:false}});
        step.status='completed';step.messageId=copied.id;step.childJobId=result.job.id;step.finishedAt=new Date().toISOString();
        job=await service.store.save(profile.id,'job',{...job,steps:job.steps,responseId:copied.id});
      }
      job=await service.store.save(profile.id,'job',{...job,status:'completed',finishedAt:new Date().toISOString()});
      userAccess.appendAudit(profile,'AGENT_COORDINATION_COMPLETE',job.id,{calls:job.calls,participants:plan.profileIds.length});
      return {job,conversation,message:await service.store.get(profile.id,'message',job.responseId)};
    } catch(err) {
      const status=raw.signal?.aborted||err.code==='OFFICE_CANCELLED'?'cancelled':'failed';
      if(job){job=await service.store.save(profile.id,'job',{...job,status,errorCode:/^OFFICE_|^LCWAI_/.test(err.code||'')?err.code:'OFFICE_AI_FAILED',steps:job.steps.map(s=>s.status==='running'?{...s,status}:s),finishedAt:new Date().toISOString()});
      await service.store.appendMessage(profile.id,conversation.id,{role:'system',text:job.errorCode,requestId:job.id,status});}
      throw err;
    } finally {running.delete(profile.id);}
  }
  return {workflowPreview:preview,runWorkflow:run};
}
module.exports={attachWorkflow};
