'use strict';
const {hash,error}=require('./agent-office-store');
function createResourceImpact({office,userAccess,dataset}){
 return async(profile,section,before,next,ctx={})=>{
  if(!ctx.input?.officeAgentId)return {available:false,reason:'agent-scope',shared:true};
  const currentAgent=async()=>{
   const agent=await office.get(ctx.ownerId,'profile',ctx.input.officeAgentId);
   if(agent.deleted||agent.enabled===false)throw error('OFFICE_AGENT_DISABLED',403);
   if(agent.revision!==ctx.input.officeAgentRevision)throw error('OFFICE_PREVIEW_CHANGED',409);
   ctx.assertAuthority();return agent;
  };
  const agent=await currentAgent(),source=['backlog','cp','orders'].find(area=>agent.areas.includes(area)&&userAccess.hasArea(profile,area));
  if(!source)return {available:false,reason:'current-IAM-and-agent-scope',shared:true};
  const rows=await dataset(ctx.ownerId,profile,source);await currentAgent();
  if(section==='transitRules')return require('./agent-resource-tools').transitImpact(rows,source,before,next);
  return {available:true,source,sourceFingerprint:hash(JSON.stringify(rows)),authorizedRows:rows.length,changedLicenses:[...new Set([...before,...next].map(r=>r.license))],recalculates:['royalty','FOB','Collection landed']};
 };
}
module.exports={createResourceImpact};
