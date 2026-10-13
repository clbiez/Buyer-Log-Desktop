'use strict';
const Rules=require('../../public/cp-rules-engine');
const {fieldCatalog}=require('./cp-agent-tools');
const {id,hash,error,text}=require('./agent-office-store');
const TOOL_IDS=['cp.rule.preview','cp.rule.save','cp.weekly.preview','cp.weekly.draft'];

function attachCp(service,deps) {
  const {toolRegistry,runtime,userAccess,cpData,cpGroups,cpDraftPath}=deps;
  const authorityFingerprint=profile=>hash(JSON.stringify(userAccess.publicProfile?.(profile)||profile));
  const fresh=profile=>{const current=userAccess.profileById(profile.id);if(!current||current.enabled===false||!userAccess.hasArea(current,'cp'))throw error('OFFICE_TOOL_FORBIDDEN',403);return current;};
  async function agentFor(profile,key,weekly=false) {
    profile=fresh(profile);const agent=await service.store.get(profile.id,'profile',key);
    if(agent.enabled===false||agent.deleted||!agent.areas.includes('cp')||weekly&&!userAccess.hasArea(profile,'automations'))throw error('OFFICE_TOOL_FORBIDDEN',403);
    return {profile,agent};
  }
  async function catalog(profile,agentId) {
    const authority=await agentFor(profile,agentId),data=await cpData(authority.profile);
    return {tools:toolRegistry.catalog().filter(tool=>tool.module==='cp'&&tool.contractVersion&&(tool.areas||[tool.area]).every(area=>userAccess.hasArea(authority.profile,area))),rules:Rules.mergeWithDefaults(data.personalRules||[],data.deletedRuleIds||[]),groups:userAccess.hasArea(authority.profile,'automations')?cpGroups(authority.profile):[],sendAvailable:false};
  }
  async function preview(profile,raw) {
    const {agent}=await agentFor(profile,raw.agentId,raw.kind==='weekly');profile=fresh(profile);
    let toolId,args,aiCalls=0,explanation='';
    if(raw.kind==='rule') {
      const data=await cpData(profile),ruleId=raw.ruleId||`office_${id()}`;
      const existing=Rules.mergeWithDefaults(data.personalRules||[],data.deletedRuleIds||[]).find(rule=>rule.id===ruleId);
      if(raw.ruleId&&!existing)throw error('OFFICE_NOT_FOUND',404);
      const kind=existing?.kind||(raw.ruleKind==='checklist'?'checklist':'priority');
      const fields=fieldCatalog(data,ruleId),lang=raw.lang==='en'?'en':'tr';
      const task=text(raw.task,4000);if(!task)throw error('OFFICE_TASK_INVALID');
      const result=await service.engineOf().ask(profile.id,{requestId:id(),source:'rules',task,lang,
        context:{ruleKind:kind,currentFormula:existing?.formula||'',availableFields:fields.map(f=>({id:f.id,name:lang==='en'?f.en:f.tr})),availablePriorities:Rules.SEVERITY.map(key=>({key})),checklistValues:Rules.CHECKLIST_STATES},
        guide:Rules.buildAiGuide({lang,kind,fields,request:task})});
      if(!result.structured?.ok||!result.data?.formula)throw error('OFFICE_AI_CONTRACT_INVALID',422);
      aiCalls=1;explanation=result.data.explanation||'';
      args={rule:{id:ruleId,kind,name:text(raw.name||existing?.name,160),nameEn:text(raw.nameEn||existing?.nameEn,160),formula:Rules.formulaFromDisplay(Rules.extractFormula(result.data.formula),fields),target:Rules.SEVERITY.includes(result.data.priority)?result.data.priority:existing?.target||'ACTION_THIS_WEEK',approvalScope:existing?.approvalScope||'order'}};
      toolId='cp.rule.save';
    } else if(raw.kind==='weekly') {
      args={date:text(raw.date,10),recipientMode:raw.recipientMode,groupId:text(raw.groupId,120),subject:text(raw.subject,200),body:text(raw.body,4000),language:raw.lang==='en'?'en':'tr'};toolId='cp.weekly.draft';
    } else throw error('OFFICE_TASK_INVALID');
    // AI calls can take minutes: reject changed actor/agent scope afterwards.
    const current=await agentFor(profile,agent.id,raw.kind==='weekly');
    if(current.agent.revision!==agent.revision)throw error('OFFICE_PREVIEW_CHANGED',409);
    const previewTool=toolId==='cp.rule.save'?'cp.rule.preview':'cp.weekly.preview';
    const result=await toolRegistry.execute(previewTool,args,{ownerId:profile.id,profile:current.profile,dryRun:true});
    const job=await service.store.save(profile.id,'job',{...service.runtimeContext(profile.id),id:id(),type:'cp-task',profileIds:[agent.id],agentRevision:agent.revision,authorizationFingerprint:authorityFingerprint(current.profile),status:'waiting_approval',toolId,args:{...args,fingerprint:result.fingerprint},preview:result,aiCalls,explanation,task:text(raw.task||raw.subject,4000),execution:'existing-agent-runtime',sourceChanges:toolId==='cp.rule.save'});
    userAccess.appendAudit(current.profile,'AGENT_CP_PREVIEW',job.id,{toolId,aiCalls});return job;
  }
  function workflow(job) {
    const nodes=[{id:'start',type:'trigger.manual',config:{}},{id:'effect',type:'tool.call',config:{toolId:job.toolId,args:job.args}},{id:'verify',type:'verify.result',config:{mode:'equals',path:'verified',value:true}},{id:'result',type:'output.result',config:{}}];
    return {id:`office_${job.id}`,ownerId:job.ownerId,name:job.task,nodes,edges:nodes.slice(1).map((node,i)=>({id:`edge${i}`,from:nodes[i].id,to:node.id,channel:'success'}))};
  }
  async function execute(profile,key,raw) {
    profile=fresh(profile);let job=await service.store.get(profile.id,'job',key);
    if(job.type!=='cp-task'||raw.confirmed!==true||raw.fingerprint!==job.preview.fingerprint)throw error('OFFICE_APPROVAL_REQUIRED',409);
    if(job.runtimeDeviceId!==service.store.db(profile.id).getDeviceId())throw error('OFFICE_TASK_DEVICE',409);
    const authority=await agentFor(profile,job.profileIds[0],job.toolId==='cp.weekly.draft');
    if(job.authorizationFingerprint!==authorityFingerprint(authority.profile))throw error('OFFICE_PREVIEW_CHANGED',409);
    if(authority.agent.revision!==job.agentRevision)throw error('OFFICE_PREVIEW_CHANGED',409);
    if(['completed','partial'].includes(job.status))return job;
    if(job.status!=='waiting_approval')throw error('OFFICE_TASK_RECONCILE',409);
    // A WAL compare-and-swap makes simultaneous browser approvals single-use.
    job=await service.store.save(profile.id,'job',{...job,status:'running'},{expectedRevision:job.revision});
    try {
      let result=await runtime.execute({ownerId:profile.id,profile:authority.profile,workflow:workflow(job),input:{officeJobId:job.id,officeAgentId:authority.agent.id,officeAgentRevision:authority.agent.revision}});
      job=await service.store.save(profile.id,'job',{...job,runtimeRunId:result.run.id});
      if(result.run.status==='waiting_approval')result=await runtime.resumeApproval({ownerId:profile.id,profile:fresh(profile),runId:result.run.id,approved:true});
      const effect=result.run.executionState.nodes.effect?.output;
      if(effect?.emails)for(const mail of effect.emails)mail.draftUrl=`/api/agent-office/cp/jobs/${encodeURIComponent(job.id)}/drafts/${encodeURIComponent(mail.filename)}`;
      const completed=result.run.status==='completed'&&effect?.verified===true;
      job=await service.store.save(profile.id,'job',{...job,status:completed?(effect.unresolved?.length?'partial':'completed'):'failed',result:effect||null,runtimeStatus:result.run.status,errorCode:result.run.output?.code||'',finishedAt:new Date().toISOString()});
      userAccess.appendAudit(authority.profile,'AGENT_CP_TASK_RESULT',job.id,{status:job.status,runtimeRunId:job.runtimeRunId});return job;
    } catch(err) {
      await service.store.save(profile.id,'job',{...job,status:'interrupted',errorCode:err.code||'OFFICE_TASK_RECONCILE'});throw err;
    }
  }
  async function draft(profile,key,filename) {
    profile=fresh(profile);
    if(!userAccess.hasArea(profile,'automations'))throw error('OFFICE_TOOL_FORBIDDEN',403);
    const job=await service.store.get(profile.id,'job',key);
    profile=fresh(profile);if(!userAccess.hasArea(profile,'automations'))throw error('OFFICE_TOOL_FORBIDDEN',403);
    if(job.authorizationFingerprint!==authorityFingerprint(profile))throw error('OFFICE_PREVIEW_CHANGED',409);
    if(job.type!=='cp-task'||job.toolId!=='cp.weekly.draft'||!['completed','partial'].includes(job.status)||!job.result?.emails?.some(mail=>mail.filename===filename))throw error('OFFICE_NOT_FOUND',404);
    const full=cpDraftPath(profile.id,filename);if(!full)throw error('OFFICE_NOT_FOUND',404);
    return full;
  }
  async function rollback(profile,key,raw) {
    profile=fresh(profile);let job=await service.store.get(profile.id,'job',key);
    const authority=await agentFor(profile,job.profileIds[0]);
    if(job.runtimeDeviceId!==service.store.db(profile.id).getDeviceId())throw error('OFFICE_TASK_DEVICE',409);
    if(job.type!=='cp-task'||job.status!=='completed'||job.toolId!=='cp.rule.save'||raw.confirmed!==true||!job.result?.rollbackToken)throw error('OFFICE_ROLLBACK_INVALID',409);
    if(job.rollbackStatus==='completed')return job;
    if(job.rollbackStatus==='running')throw error('OFFICE_TASK_RECONCILE',409);
    job=await service.store.save(profile.id,'job',{...job,rollbackStatus:'running'},{expectedRevision:job.revision});
    try {const restored=await toolRegistry.rollback(job.toolId,job.result.rollbackToken,{ownerId:profile.id,profile:fresh(profile),approvalGranted:true,input:{officeJobId:job.id,officeAgentId:authority.agent.id,officeAgentRevision:authority.agent.revision}});
      job=await service.store.save(profile.id,'job',{...job,rollbackStatus:'completed',restored});userAccess.appendAudit(profile,'AGENT_CP_ROLLBACK',job.id,{});return job;
    } catch(err){await service.store.save(profile.id,'job',{...job,rollbackStatus:'failed'});throw err;}
  }
  return {cpCatalog:catalog,cpPreview:preview,cpExecute:execute,cpRollback:rollback,cpDraft:draft};
}
module.exports={attachCp,TOOL_IDS};
