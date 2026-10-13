'use strict';
const {hash,error}=require('./agent-office-store'),canonical=require('./canonical-fields'),engine=require('../../public/manufacturer-cards-engine');
const fields=['manufacturer','subManufacturer','license','licensor','country','orderQuantity'];
// Project through canonical bindings, then adapt to the EXISTING native motor's
// declared keys. Its Non-DTR identity and weighted-country decisions stay native.
function createManufacturerAsasSource({office,userAccess,dataset,stamp}){
 const sourceStamp=ctx=>hash(JSON.stringify({source:stamp(ctx),bindings:fields.map(id=>canonical.bindingFor('orders',id))}));
 const assert=(ctx,expected)=>{ctx.assertAuthority();if(sourceStamp(ctx)!==expected)throw error('OFFICE_PREVIEW_CHANGED',409);};
 async function currentAgent(ctx){
  if(!ctx.input?.officeAgentId)throw error('OFFICE_TOOL_FORBIDDEN',403);
  const agent=await office.get(ctx.ownerId,'profile',ctx.input.officeAgentId),profile=userAccess.profileById(ctx.ownerId);
  if(agent.deleted||agent.enabled===false)throw error('OFFICE_AGENT_DISABLED',403);
  if(agent.revision!==ctx.input.officeAgentRevision)throw error('OFFICE_PREVIEW_CHANGED',409);
  ctx.assertAuthority();
  if(!profile||!userAccess.hasArea(profile,'orders')||!agent.areas.includes('orders'))throw error('OFFICE_TOOL_FORBIDDEN',403);
  return profile;
 }
 return {assert,read:async(ctx,records)=>{
  const profile=await currentAgent(ctx),sourceFingerprint=sourceStamp(ctx),rows=await dataset(ctx.ownerId,profile,'orders');
  // Cold loading/refresh may legitimately change the source. Require a fresh
  // preview rather than endorsing old rows with the newer source stamp.
  assert(ctx,sourceFingerprint);
  if(!Array.isArray(rows))throw error('OFFICE_SOURCE_UNAVAILABLE',409);
  const projected=rows.map(row=>{const next={};for(const key of engine.KEYS.dtrClass)if(Object.hasOwn(row,key))next[key]=row[key];for(const id of fields){const value=canonical.value(row,'orders',id);if(value!=null)next[engine.KEYS[id][0]]=value;}return next;});
  const directory=engine.buildDirectoryIndex(records),cards=engine.buildCards(projected,[],{today:'1970-01-01'}),all=cards.cards.filter(card=>card.inAsas),items=[];let omittedNames=0;
  for(const card of all){if(!card.name||card.name.length>240||!engine.nameKey(card.name)){omittedNames++;continue;}items.push({manufacturer:card.name,countryName:String(card.countries[0]?.name||'').trim().slice(0,120),linked:directory.has(engine.nameKey(card.name))});}
  items.sort((a,b)=>a.manufacturer.localeCompare(b.manufacturer,'tr'));await currentAgent(ctx);assert(ctx,sourceFingerprint);
  return {items,sourceFingerprint,authorizedRows:cards.stats.rows,unassignedRows:cards.unassigned.rows,omittedNames};
 }};
}
module.exports={createManufacturerAsasSource};
