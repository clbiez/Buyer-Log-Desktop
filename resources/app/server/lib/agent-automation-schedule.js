'use strict';
const {error,hash}=require('./agent-office-store');
const tools=require('./agent-automation-tools');
function createScheduleOptions({store,office,userAccess,authorizeRecipe,emailGroups,sourceStamp}){
 return async function scheduleOptions(profile,recipe){
  const grant=store.loadStore().agentScheduleGrants[recipe.id];if(!grant)return {};
  let expectedSource;
  const validate=agent=>{
   const current=userAccess.profileById(profile.id),state=store.loadStore(),actual=state.recipes.find(r=>r.id===recipe.id&&r.ownerId===profile.id),latest=state.agentScheduleGrants[recipe.id];
   if(!current||current.enabled===false||!actual||!latest||JSON.stringify(latest)!==JSON.stringify(grant)||!tools.grantValid(grant,actual,current,agent,p=>userAccess.publicProfile(p))||['AUTOMATIONS.VIEW','AUTOMATIONS.EDIT','AUTOMATIONS.APPROVE','AUTOMATIONS.MANAGE'].some(code=>!userAccess.hasCapability(current,code))||grant.recipientsFingerprint&&grant.recipientsFingerprint!==hash(JSON.stringify(emailGroups(current))))throw error('OFFICE_SCHEDULE_SCOPE',403);
   if(sourceStamp&&expectedSource!==undefined&&sourceStamp(current,actual)!==expectedSource)throw error('OFFICE_PREVIEW_CHANGED',409);
   return {current,actual};
  };
  const check=async()=>{
   const agent=await office.get(profile.id,'profile',grant.agentId),{current,actual}=validate(agent);
   await authorizeRecipe({ownerId:profile.id,profile:current,input:{officeAgentId:agent.id,officeAgentRevision:grant.agentRevision}},actual);
   return validate(await office.get(profile.id,'profile',grant.agentId)).current;
  };
  await check();
  return {draftOwnerId:profile.id,assertAuthority:check,captureSource:()=>{if(sourceStamp)expectedSource=sourceStamp(userAccess.profileById(profile.id),recipe);},runDraft:work=>office.withProfileGuard(profile.id,grant.agentId,grant.agentRevision,agent=>store.withEffectGuard(()=>validate(agent),work)),draftScope:{agentId:grant.agentId,actorFingerprint:grant.authorizationFingerprint,recipe},draftUrlForRun:run=>name=>'/api/automations/runs/'+encodeURIComponent(run.id)+'/drafts/'+encodeURIComponent(name)};
 };
}
async function ownedDraft(profile,runId,filename,{store,authorizeRecipe,draftPath,publicProfile=p=>p}){
 const run=store.stateForOwner(profile.id).runs.find(item=>item.id===runId),scope=run?.result?.agentScope;
 const messages=run?.result?.emails||[run?.result?.email].filter(Boolean);
 if(!scope||!messages?.some(mail=>mail.filename===filename))throw error('OFFICE_NOT_FOUND',404);
 if(scope.actorFingerprint!==hash(JSON.stringify(publicProfile(profile))))throw error('OFFICE_PREVIEW_CHANGED',409);
 await authorizeRecipe({ownerId:profile.id,profile,input:{officeAgentId:scope.agentId}},scope.recipe);
 if(scope.actorFingerprint!==hash(JSON.stringify(publicProfile(profile))))throw error('OFFICE_PREVIEW_CHANGED',409);
 const file=draftPath(filename,profile.id);if(!file)throw error('OFFICE_NOT_FOUND',404);return file;
}
module.exports={createScheduleOptions,ownedDraft};
