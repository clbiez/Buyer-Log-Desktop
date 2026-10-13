'use strict';
const {object,string,array}=require('./agent-capability-contract'),{error}=require('./agent-office-store'),artifacts=require('./agent-artifact-store'),{definition,publicDefinition,validateFilterDefinition}=require('./agent-source-tools');
const id={...string(160),minLength:1,pattern:'^[a-zA-Z0-9_.:-]+$'},count={type:'integer',minimum:0},fingerprint={...string(64),pattern:'^[a-f0-9]{64}$'},scope={shared:{type:'boolean'}};
const token={...object({artifactId:{...string(32),pattern:'^[a-f0-9]{32}$'},id,shared:{type:'boolean'},expected:object({revision:count,fingerprint})}),required:['artifactId','id','shared','expected']};
const templateDefinition=object({table:definition.properties.table,groups:definition.properties.groups});
function registerHorizonTemplateTools(registry,deps){
 const service=deps.service,base={module:'source',areas:['source'],agentAreas:['source'],permissions:['manageModelConnections'],dataScope:'native owner Horizon templates or explicit shared store; credentials and manual expressions excluded'},mutation=(ctx,work)=>{if(!deps.withAgentMutation)throw error('OFFICE_APPROVAL_REQUIRED',403);return deps.withAgentMutation(ctx,work);};
 registry.registerCapability({...base,id:'source.templates.read',operation:'READ',risk:'read',label:{tr:'Kaydedilmiş Horizon şablonlarını oku',en:'Read saved Horizon templates'},inputSchema:object({...scope,limit:{type:'integer',minimum:1,maximum:50}}),outputSchema:{...object({verified:{enum:[true]},data:object({shared:{type:'boolean'},revision:count,matched:count,truncated:{type:'boolean'},items:array(object({id,name:string(160),definition:publicDefinition,updatedAt:{type:['string','null'],maxLength:40}}),50)})}),required:['verified','data']},read:(args,ctx)=>service.list(args,ctx)});
 for(const operation of ['create','delete','share'])registry.registerCapability({...base,id:'source.template.'+operation,operation:operation==='delete'?'DELETE':'CREATE',risk:'write',label:operation==='create'?{tr:'Horizon şablonu kaydet',en:'Save Horizon template'}:operation==='delete'?{tr:'Horizon şablonu sil',en:'Delete Horizon template'}:{tr:'Kişisel Horizon şablonunu paylaş',en:'Share personal Horizon template'},
  inputSchema:operation==='create'?{...object({...scope,name:{...string(160),minLength:1},sourceId:id,definition:templateDefinition}),required:['name','sourceId','definition']}:{...object({id,...(operation==='delete'?scope:{sourceId:id})}),required:['id',...(operation==='share'?['sourceId']:[])]},
  outputSchema:{...object({verified:{enum:[true]},data:object({id,revision:count,shared:{type:'boolean'}}),rollbackToken:token}),required:['verified','data','rollbackToken']},
  read:async(args,ctx)=>{
   const preview=await service.preview(operation,args,ctx);if(operation!=='delete'){
    const captured=operation==='share'?(await service.capture(operation,args,ctx)).source:null,raw=operation==='share'?captured.items.find(value=>value.id===args.id)?.data:args.definition;
    // Legacy expressions are never copied through an agent request.
    if(raw?.extraExpression||raw?.manualExpression||Object.keys(raw||{}).some(key=>!Object.hasOwn(definition.properties,key)))throw error('OFFICE_TOOL_SCHEMA',422);
    await validateFilterDefinition(deps.source,{sourceId:args.sourceId,definition:raw},ctx);
   }return preview;
  },
  apply:async(args,ctx,preview)=>{
   const captured=await service.capture(operation,args,ctx),file=await artifacts.put(ctx.profile,Buffer.from(JSON.stringify(captured.store)),'horizon-templates-backup.json','horizon-templates-backup');await deps.beforeBackup?.(ctx);
   return mutation(ctx,async()=>{const receipt=await service.execute(operation,args,preview,ctx);await deps.changed?.(ctx.profile);return {verified:true,data:{id:receipt.id,revision:receipt.revision,shared:receipt.shared},rollbackToken:{artifactId:file.id,id:receipt.id,shared:receipt.shared,expected:{revision:receipt.revision,fingerprint:receipt.fingerprint}}};});
  },
  restore:(token,ctx)=>mutation(ctx,async()=>{const {buffer}=artifacts.read(ctx.profile,token.artifactId,'horizon-templates-backup'),result=await service.restore({shared:token.shared,id:token.id},JSON.parse(buffer),token.expected,ctx);await deps.changed?.(ctx.profile);return result;})});
}
module.exports={registerHorizonTemplateTools};
