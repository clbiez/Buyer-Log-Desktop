'use strict';
const {hash,error}=require('./agent-office-store'),fields=require('./canonical-fields'),{allowed}=require('./agent-capability-contract'),{validate}=require('./agent-tool-schema');
const sourceSchema={type:'object',additionalProperties:false,required:['source','identity'],properties:{source:{enum:['cp','orders','backlog','lfl','collection']},identity:{type:'object',additionalProperties:false,properties:Object.fromEntries(['orderCode','plmId','colourCode','rowId'].map(key=>[key,{type:'string',minLength:1,maxLength:160}]))},fields:{type:'array',maxItems:24,items:{type:'string',maxLength:160}}}};
function createMemoryPolicy({store,userAccess,registry,dataset}){
 const current=owner=>{const actor=userAccess.profileById(owner);if(!actor||actor.enabled===false)throw error('OFFICE_USER_DISABLED',403);return actor;};
 const fingerprint=actor=>hash(JSON.stringify(userAccess.publicProfile?.(actor)||actor));
 const hasSource=(actor,agents,source)=>userAccess.hasArea(actor,source==='collection'?'koleksiyon':source)&&agents.some(agent=>agent.areas.includes(source));
 async function source(actor,agents,ref,cache=new Map()){
  validate(sourceSchema,ref);if(!Object.keys(ref.identity).length||ref.identity.rowId&&ref.source!=='collection')throw error('OFFICE_MEMORY_SOURCE_INVALID',422);
  if(!dataset||!hasSource(actor,agents,ref.source))throw error('OFFICE_TOOL_FORBIDDEN',403);
  if([...Object.keys(ref.identity).filter(key=>key!=='rowId'),...(ref.fields||[])].some(field=>!fields.bindingFor(ref.source,field)))throw error('OFFICE_FIELD_INVALID',422);
  const before=fingerprint(current(actor.id));if(!cache.has(ref.source))cache.set(ref.source,Promise.resolve(dataset(actor.id,actor,ref.source)));
  const rows=await cache.get(ref.source);if(before!==fingerprint(current(actor.id)))throw error('OFFICE_PREVIEW_CHANGED',409);
  const matches=rows.filter(row=>Object.entries(ref.identity).every(([key,value])=>key==='rowId'?String(row.id||'')===value:fields.normalizedValue(row,ref.source,key)===fields.normalizedValue({[fields.bindingFor(ref.source,key).keys[0]]:value},ref.source,key)));
  if(matches.length!==1)throw error('OFFICE_MEMORY_SOURCE_AMBIGUOUS',409);
  const row=matches[0],all=fields.project(row,ref.source),names=ref.fields?.length?ref.fields:fields.moduleFields(ref.source).slice(0,24);
  const facts={},truncatedFields=[];let chars=0,omittedFields=0;
  for(const [key,value] of Object.entries(fields.project(row,ref.source,names))){const serialized=JSON.stringify(value);if(serialized.length>500)truncatedFields.push(key);const safe=serialized.length>500?serialized.slice(0,500):value;const length=JSON.stringify({[key]:safe}).length;if(chars+length>4000){omittedFields++;continue;}facts[key]=safe;chars+=length;}
  return {reference:JSON.parse(JSON.stringify(ref)),revision:hash(JSON.stringify(all)),facts,omittedFields,truncatedFields,capturedAt:new Date().toISOString()};
 }
 async function context(actor,profileIds,conversationId,query,budget,options={}){
  actor=current(actor.id);const expected=fingerprint(actor),agents=await Promise.all(profileIds.map(key=>store.get(actor.id,'profile',key))),cache=new Map();
  const validateRecord=async doc=>{
   if(expected!==fingerprint(current(actor.id)))throw error('OFFICE_PREVIEW_CHANGED',409);
   if(doc.authorizationFingerprint&&doc.authorizationFingerprint!==expected)return {allowed:false,reason:'scope'};
   if(doc.sourceRecord){try{const parent=await store.get(actor.id,doc.sourceRecord.kind,doc.sourceRecord.id);if(parent.revision!==doc.sourceRecord.revision)return {allowed:false,reason:'stale'};}catch(err){if(err.code==='OFFICE_NOT_FOUND')return {allowed:false,reason:'stale'};throw err;}}
   if((doc.kind==='summary'||doc.origin==='verified-service'||doc.sourceIds?.length)&&!doc.authorizationFingerprint)return {allowed:false,reason:'scope'};
   if(doc.toolIds?.length&&registry){for(const toolId of doc.toolIds){const tool=registry.get(toolId);if(!tool||!allowed(tool,actor,userAccess)||!agents.some(agent=>(tool.agentAreas||tool.areas||[]).every(area=>agent.areas.includes(area==='koleksiyon'?'collection':area))&&(!tool.agentAnyAreas||tool.agentAnyAreas.some(area=>agent.areas.includes(area)))))return {allowed:false,reason:'scope'};}}
   if(doc.verifiedSource){try{const live=await source(actor,agents,doc.verifiedSource.reference,cache);if(live.revision!==doc.verifiedSource.revision)return {allowed:false,reason:'stale'};return {allowed:true,source:live};}catch(err){if(['OFFICE_TOOL_FORBIDDEN','OFFICE_MEMORY_SOURCE_AMBIGUOUS','OFFICE_MEMORY_SOURCE_INVALID','OFFICE_FIELD_INVALID'].includes(err.code))return {allowed:false,reason:err.code==='OFFICE_TOOL_FORBIDDEN'?'scope':'stale'};throw err;}}
   else if(doc.type==='fact'&&doc.sourceRevision)return {allowed:false,reason:'stale'};
   return {allowed:true};
  };
  const result=await store.selectContext(actor.id,profileIds,conversationId,query,budget,{...options,validateRecord});
  const latestAgents=await Promise.all(profileIds.map(key=>store.get(actor.id,'profile',key)));
  if(latestAgents.some((agent,i)=>agent.revision!==agents[i].revision)||expected!==fingerprint(current(actor.id)))throw error('OFFICE_PREVIEW_CHANGED',409);
  return result;
 }
 return {fingerprint,source,context};
}
module.exports={createMemoryPolicy,sourceSchema};
