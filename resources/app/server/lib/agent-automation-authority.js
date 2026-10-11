'use strict';
const {error}=require('./agent-office-store');
async function assertRecipeAuthority(ctx,recipe,{userAccess,agent,sourceArea}){
 const actualAgent=ctx.input?.officeAgentId?await agent(ctx):null;
 return assertRecipeAuthorityNow(ctx,recipe,{userAccess,sourceArea,actualAgent});
}
function assertRecipeAuthorityNow(ctx,recipe,{userAccess,sourceArea,actualAgent}){
 const profile=userAccess.profileById(ctx.ownerId);
 if(!profile||profile.enabled===false||!userAccess.hasArea(profile,'automations')||actualAgent&&ctx.input.officeAgentRevision!==undefined&&actualAgent.revision!==ctx.input.officeAgentRevision)throw error('OFFICE_TOOL_FORBIDDEN',403);
 const needed=[recipe.source,recipe.join?.source].filter(source=>source&&source!=='manual').map(sourceArea);
 for(const action of recipe.appActions||[]){
  if(action.action==='refresh_source')needed.push('source',action.source==='priceanalysis'?'priceanalysis':sourceArea(action.source||recipe.source));
  if(action.action==='open_page'){const module=require('./module-registry').list().find(m=>m.id===action.page||m.area===action.page);if(!module)throw error('OFFICE_AUTOMATION_SCOPE',403);needed.push(module.area);}
 }
 if(needed.some(area=>!area||!userAccess.hasArea(profile,area)||actualAgent&&!actualAgent.areas.includes(area==='koleksiyon'?'collection':area))||recipe.source==='intake'&&!userAccess.hasCapability(profile,'OAB.VIEW'))throw error('OFFICE_TOOL_FORBIDDEN',403);
 ctx.assertAuthority?.();return profile;
}
module.exports={assertRecipeAuthority,assertRecipeAuthorityNow};
