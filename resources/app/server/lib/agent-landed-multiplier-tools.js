'use strict';
const {object,string,array}=require('./agent-capability-contract'),{error}=require('./agent-office-store'),inverse=require('./agent-native-inverse-artifact');
const count={type:'integer',minimum:0},fingerprint={...string(64),pattern:'^[a-f0-9]{64}$'};
const multipliers={...object({tr:{type:'number',minimum:0},overseas:{type:'number',minimum:0}}),required:['tr','overseas']};
const inputMultipliers={...multipliers,properties:{tr:{type:'number',minimum:Number.MIN_VALUE,maximum:10},overseas:{type:'number',minimum:Number.MIN_VALUE,maximum:10}}};
const impact={...object({shared:{enum:[true]},trDefaultChanged:{type:'boolean'},overseasDefaultChanged:{type:'boolean'},explicitRowFactorsChanged:{enum:[false]},storedPricesChanged:{enum:[false]},recordImpactAvailable:{enum:[false]},recalculates:array(string(80),2)}),required:['shared','trDefaultChanged','overseasDefaultChanged','explicitRowFactorsChanged','storedPricesChanged','recordImpactAvailable','recalculates']};
const preview={...object({multipliers,revision:count,fingerprint,next:inputMultipliers,impact}),required:['multipliers','revision','fingerprint','next','impact']};
const readOutput={...object({verified:{enum:[true]},data:{...object({multipliers,revision:count}),required:['multipliers','revision']}}),required:['verified','data']};
function registerLandedMultiplierTools(registry,deps){
 const base={module:'source',areas:['source'],agentAreas:['source'],dataScope:'native shared landed default factors; no owner rows or private prices are read'},toolId='resource.landed.update';
 const mutation=(ctx,work)=>{if(!deps.withAgentMutation)throw error('OFFICE_APPROVAL_REQUIRED',403);return deps.withAgentMutation(ctx,work);};
 registry.registerCapability({...base,id:'resource.landed.read',operation:'READ',risk:'read',label:{tr:'Ortak Landed çarpanlarını oku',en:'Read shared landed factors'},inputSchema:object({}),outputSchema:readOutput,dryRunOutputSchema:readOutput,read:(_args,ctx)=>deps.service.snapshot(ctx)});
 registry.registerCapability({...base,id:toolId,operation:'UPDATE',risk:'write',permissions:['manageBusinessRules'],label:{tr:'Landed varsayılanlarını etki önizlemesiyle revize et',en:'Revise landed defaults with an impact preview'},inputSchema:{...object({multipliers:inputMultipliers}),required:['multipliers']},
  dryRunOutputSchema:{...object({verified:{enum:[true]},preview,fingerprint}),required:['verified','preview','fingerprint']},
  outputSchema:{...object({verified:{enum:[true]},data:{...object({multipliers,revision:count,shared:{enum:[true]}}),required:['multipliers','revision','shared']},rollbackToken:{...object({artifactId:{...string(32),pattern:'^[a-f0-9]{32}$'},expected:{...object({revision:count,fingerprint}),required:['revision','fingerprint']}}),required:['artifactId','expected']}}),required:['verified','data','rollbackToken']},
  read:(args,ctx)=>deps.service.preview(args.multipliers,ctx),
  apply:async(args,ctx,prepared)=>{const artifactId=await inverse.archive(ctx,toolId,prepared.multipliers);await deps.beforeBackup?.(ctx);return mutation(ctx,async()=>{const receipt=await deps.service.replace(args.multipliers,prepared,ctx);await deps.changed?.(ctx.profile,receipt);return {verified:true,data:{multipliers:receipt.multipliers,revision:receipt.revision,shared:true},rollbackToken:{artifactId,expected:{revision:receipt.revision,fingerprint:receipt.fingerprint}}};});},
  restore:(token,ctx)=>mutation(ctx,async()=>{const bound=inverse.restore(ctx,toolId,token),receipt=await deps.service.restore(bound.before,token.expected,ctx);await deps.changed?.(ctx.profile,receipt);return {verified:true,revision:receipt.revision};})});
}
module.exports={registerLandedMultiplierTools};
