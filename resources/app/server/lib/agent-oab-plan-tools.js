'use strict';
const {object,string,array}=require('./agent-capability-contract');
const {hash,error}=require('./agent-office-store');
const {validate}=require('./agent-tool-schema');
const count={type:'integer',minimum:0},flag={type:'boolean'},ref={...string(160),minLength:1},fingerprint={...string(64),pattern:'^[a-f0-9]{64}$'};
const required=properties=>({...object(properties),required:Object.keys(properties)});
const combination=required({seasonRef:ref,merchSubGroupRef:ref,buyerGroupRef:ref});
const input=object({seasonRefs:array(ref,200),merchSubGroupRefs:array(ref,200),buyerGroupRefs:array(ref,200),allBuyerGroups:flag,combinations:array(combination,400),offset:count,limit:{type:'integer',minimum:1,maximum:200},sourceFingerprint:fingerprint});
const output=required({verified:{enum:[true]},data:required({origin:{enum:['native-oab-batch-plan']},sourceFingerprint:fingerprint,selection:required({seasonRefs:array(ref,400),merchSubGroupRefs:array(ref,400),buyerGroupRefs:array(ref,400),allBuyerGroups:flag}),error:{enum:['','season-required','mag-required','buyer-group-required','combinations-required']},canStart:flag,maxCombinations:{enum:[400]},combinationCount:count,requestCount:count,cachedCount:count,pendingCount:count,estimateSeconds:{type:'number',minimum:0},worstCaseRequestCount:count,worstCaseSeconds:{type:'number',minimum:0},batchUnproven:flag,useBatched:flag,batchCapability:{enum:['unknown','supported','unsupported']},offset:count,nextOffset:count,hasMore:flag,combinations:array(combination,200),skippedCount:count,skippedTruncated:flag,skipped:array(required({reason:{enum:['season-not-found','mag-not-in-season','buyer-group-not-in-mag','no-buyer-group']},seasonRef:{type:['string','null'],maxLength:160},merchSubGroupRef:{type:['string','null'],maxLength:160},buyerGroupRef:{type:['string','null'],maxLength:160},label:string(500)}),50)})});
function registerOabPlanTools(registry,deps={}){
 registry.registerCapability({id:'oab.batch.plan',module:'overview',areas:['overview'],agentAreas:['overview'],capabilities:['OAB.VIEW'],risk:'read',operation:'READ',dataScope:'native-approved-metadata-selection-and-current-cache-capability; no fetch or authentication',label:{tr:'Native OAB yükleme planını ve en kötü süreyi hesapla',en:'Calculate the native OAB fetch plan and worst-case time'},inputSchema:input,outputSchema:output,read:(args,ctx)=>{
  ctx.assertAuthority();if(ctx.ownerId!==ctx.profile.id)throw error('OFFICE_TOOL_FORBIDDEN',403);
  if(Buffer.byteLength(JSON.stringify(args))>64*1024)throw error('OFFICE_TOOL_SCHEMA',422);
  if(args.combinations!==undefined&&['seasonRefs','merchSubGroupRefs','buyerGroupRefs','allBuyerGroups'].some(key=>args[key]!==undefined)||args.allBuyerGroups&&args.buyerGroupRefs?.length)throw error('OFFICE_TOOL_SCHEMA',422);
  if(typeof deps.service?.buildPlan!=='function')throw error('OFFICE_SOURCE_UNAVAILABLE',503);
  const {offset=0,limit=200,sourceFingerprint:expected,...selection}=args,built=deps.service.buildPlan(selection),sourceFingerprint=hash(JSON.stringify({selection:built.selection,plan:built.plan,capability:built.capability,requestCount:built.requestCount,cachedCount:built.cachedCount}));
  if(expected!==undefined&&expected!==sourceFingerprint)throw error('OFFICE_PREVIEW_CHANGED',409);
  const data={origin:'native-oab-batch-plan',sourceFingerprint,selection:built.selection,error:built.error||'',canStart:!built.error&&built.combinationCount>0&&built.combinationCount<=400,maxCombinations:400,combinationCount:built.combinationCount,requestCount:built.requestCount,cachedCount:built.cachedCount,pendingCount:built.pendingCount,estimateSeconds:built.estimateSeconds,worstCaseRequestCount:built.worstCaseRequestCount,worstCaseSeconds:built.worstCaseSeconds,batchUnproven:built.batchUnproven,useBatched:built.useBatched,batchCapability:built.capability.state,offset,nextOffset:offset,hasMore:offset<built.combinationCount,combinations:[],skippedCount:built.skipped.length,skippedTruncated:built.skipped.length>50,skipped:built.skipped.slice(0,50).map(item=>({reason:item.reason,seasonRef:item.seasonRef??null,merchSubGroupRef:item.merchSubGroupRef??null,buyerGroupRef:item.buyerGroupRef??null,label:item.label}))};
  // Preserve complete native refs; page by actual UTF-8 envelope bytes.
  for(const item of built.plan.combinations.slice(offset,offset+limit)){const page=[...data.combinations,item],next={...data,combinations:page,nextOffset:offset+page.length,hasMore:offset+page.length<built.combinationCount};if(Buffer.byteLength(JSON.stringify({verified:true,data:next}))>128*1024)break;Object.assign(data,next);}
  if(Buffer.byteLength(JSON.stringify({verified:true,data}))>128*1024)throw error('OFFICE_TOOL_SCHEMA',422);
  validate(output,{verified:true,data});ctx.assertAuthority();return data;
 }});
}
module.exports={registerOabPlanTools,input,output};
