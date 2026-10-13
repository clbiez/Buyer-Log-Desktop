'use strict';
function createScheduledRunner({store,scheduleOptions,dataset,execute,executor}){
 return async function runScheduled(profile,recipe,key,{allowMissed=false,now=new Date()}={}){
  const options=await scheduleOptions(profile,recipe),claim=store.markSchedule(profile.id,recipe.id,key,{expectedRecipeRevision:recipe.revision,strict:true,allowMissed,now,executor:{...executor,expiresAt:new Date(Date.now()+120000).toISOString()}}).result;
  if(!claim)return {reserved:false,status:'skipped'};
  const run=claim.reservation;
  try{
   store.updateRun(profile.id,run.id,{status:'running'});
   await options.assertAuthority?.();
   options.captureSource?.();
   const data=await dataset(profile.id,profile,claim);
   await options.assertAuthority?.();
   if(claim.source!=='manual'&&!data.matched&&!data.change?.configured){store.updateRun(profile.id,run.id,{status:'skipped',message:'AUTOMATION_NO_MATCH',finishedAt:new Date().toISOString()});return {reserved:true,runId:run.id,status:'skipped',processed:0};}
   const result=await execute(profile.id,profile,claim,{trigger:'schedule',dataset:data,...options,draftUrl:options.draftUrlForRun?.(run)}),status=result.outcome==='partial'?'partial':result.failed?'failed':'completed';
   if(result.changeBaseline&&status==='completed')store.setChangeBaseline(profile.id,recipe.id,result.changeBaseline);
   store.updateRun(profile.id,run.id,{status,matched:result.matched,processed:result.processed,failed:result.failed,result,finishedAt:new Date().toISOString()});
   return {reserved:true,runId:run.id,status,processed:result.processed};
  }catch(err){const receipt=err.details?.automationReceipt;store.updateRun(profile.id,run.id,{status:receipt?'partial':'failed',failed:1,result:receipt||null,message:err.code||'AUTOMATION_FAILED',finishedAt:new Date().toISOString()});throw err;}
 };
}
module.exports={createScheduledRunner};
