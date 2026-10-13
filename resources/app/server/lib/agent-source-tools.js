'use strict';
const {object,string,array}=require('./agent-capability-contract'),{error}=require('./agent-office-store'),artifacts=require('./agent-artifact-store'),conditions=require('./model-conditions');
const id={...string(160),minLength:1,pattern:'^[a-zA-Z0-9_.:-]+$'},smallId={...string(40),minLength:1,pattern:'^[a-zA-Z0-9_.:-]+$'};
const condition={...object({id:smallId,table:string(200),field:{...string(200),minLength:1},name:string(200),op:{enum:Object.keys(conditions.OPERATORS)},valueType:{enum:conditions.VALUE_TYPES},values:array(string(400),conditions.MAX_VALUES),from:string(40),to:string(40)}),required:['id','field','op','valueType']};
const definition=object({table:string(200),seasonTable:string(200),seasonField:string(200),seasons:array(string(200),500),dateTable:string(200),dateField:string(200),dateStart:string(40),dateEnd:string(40),groups:array({...object({id:smallId,conditions:array(condition,conditions.MAX_CONDITIONS)}),required:['id','conditions']},conditions.MAX_GROUPS)});
const count={type:'integer',minimum:0},revision={...string(16),pattern:'^[a-f0-9]{16}$'},strings=array(string(160),20);
const publicCondition=object({...condition.properties,valueTypeSource:{enum:['','schema','heuristic']},valueCount:count,valuesTruncated:{type:'boolean'}});
const publicDefinition=object({...definition.properties,groups:array(object({id:string(40),conditions:array(publicCondition,40),conditionCount:count}),10),seasonCount:count,groupCount:count,conditionCount:count,definitionTruncated:{type:'boolean'},manualExpressionPresent:{type:'boolean'}});
const sourceSchema=object({id:string(160),name:string(80),profileId:string(80),role:string(40),sourceRevision:revision,refreshEnabled:{type:'boolean'},requiredModules:strings,linkedTargets:strings,scopes:array(object({name:string(80),targets:strings,enabled:{type:'boolean'},limitToCpOrders:{type:'boolean'},horizon:publicDefinition}),20),parkedModules:strings,restoreModules:strings,manualQueryPresent:{type:'boolean'},lastRun:{...object({at:string(40),ok:{type:'boolean'},rowCount:{type:'number'},elapsedMs:{type:'number'}}),type:['object','null']},fields:array(object({table:string(200),field:string(200)}),200),fieldCount:count,fieldsTruncated:{type:'boolean'}});
const receipt=object({verified:{enum:[true]},changed:{type:'boolean'},revision:count,sourceRevision:revision,warnings:array(string(2048),100),appliedScopeId:string(160)});
const writeResult={...object({verified:{enum:[true]},data:receipt,rollbackToken:object({sourceId:id,expectedSourceRevision:revision,artifactId:{...string(32),pattern:'^[a-f0-9]{32}$'}})}),required:['verified','data']};
function registerSourceTools(registry,deps){
 const source=deps.source,base={module:'source',areas:['source'],agentAreas:['source'],dataScope:'native source configuration; private connection/query/credential material excluded'},write={...base,permissions:['manageModelConnections']};
 const mutation=(ctx,work)=>{if(typeof deps.withAgentMutation!=='function')throw error('OFFICE_APPROVAL_REQUIRED',403);return deps.withAgentMutation(ctx,work);};
 registry.registerCapability({...base,id:'source.configuration.read',operation:'READ',risk:'read',label:{tr:'Kaynak bağlantıları ve filtre kapsamını oku',en:'Read source bindings and filter scope'},inputSchema:object({sourceIds:array(id,20),limit:{type:'integer',minimum:1,maximum:20}}),outputSchema:{...object({verified:{enum:[true]},data:{...object({sources:array(sourceSchema,20),matched:count,truncated:{type:'boolean'}}),required:['sources','matched','truncated']}}),required:['verified','data']},read:async(args,ctx)=>{
  const current=await source.snapshot(ctx),matched=current.items.filter(item=>!args.sourceIds?.length||args.sourceIds.includes(item.id)),limit=args.limit||20,sources=[];let bytes=0;
  for(const item of matched.slice(0,limit)){const fields=source.filterFields(item),value={...source.publicSource(item),fields:fields.slice(0,200),fieldCount:fields.length,fieldsTruncated:fields.length>200},size=Buffer.byteLength(JSON.stringify(value));if(bytes+size>128*1024)break;bytes+=size;sources.push(value);}
  return {sources,matched:matched.length,truncated:matched.length>sources.length};
 }});
 for(const kind of ['binding','link','filter'])registry.registerCapability({...write,id:'source.'+kind+'.update',operation:'UPDATE',risk:'write',label:kind==='binding'?{tr:'Modül kaynak bağlantısını değiştir',en:'Change module source binding'}:kind==='link'?{tr:'Bağlı gruba katıl veya gruptan ayrıl',en:'Join or leave a linked group'}:{tr:'Ortak modül filtresini düzenle veya ayır',en:'Revise or split a shared module filter'},
  outputSchema:writeResult,
  inputSchema:{...object({sourceId:id,moduleId:id,...(kind==='binding'?{enabled:{type:'boolean'}}:kind==='link'?{linked:{type:'boolean'}}:{mode:{enum:['shared','split']},definition,name:string(80)})}),required:['sourceId','moduleId',...(kind==='binding'?['enabled']:kind==='link'?['linked']:['mode','definition'])]},
  read:async(args,ctx)=>{
   if(kind==='filter'){
    if(Buffer.byteLength(JSON.stringify(args.definition))>256*1024)throw error('OFFICE_TOOL_SCHEMA',413);
    const current=await source.snapshot(ctx),item=current.items.find(item=>item.id===args.sourceId);if(!item)throw error('SOURCE_NOT_FOUND',404);
    const fields=source.filterFields(item),known=new Set(fields.map(field=>JSON.stringify([field.table,field.field]))),ids=new Set();
    const normalized=require('./modelHorizon').normalizeHorizon(args.definition);
    for(const group of normalized.groups){if(ids.has(group.id))throw error('OFFICE_TOOL_SCHEMA',422);ids.add(group.id);for(const condition of group.conditions){if(ids.has(condition.id))throw error('OFFICE_TOOL_SCHEMA',422);ids.add(condition.id);if(!known.has(JSON.stringify([condition.table||normalized.table,condition.field])))throw error('OFFICE_FIELD_INVALID',422);}}
    for(const [active,table,field]of [[normalized.seasons.length,normalized.seasonTable,normalized.seasonField],[normalized.dateStart||normalized.dateEnd,normalized.dateTable,normalized.dateField]])if(active&&!known.has(JSON.stringify([table,field])))throw error('OFFICE_FIELD_INVALID',422);
   }
   return source.preview(kind,args,ctx);
  },
  apply:async(args,ctx,preview)=>{
   const current=await source.snapshot(ctx),before=current.items.find(item=>item.id===args.sourceId);if(!before||require('./data-domain/legacy-adapter').configRevision(before)!==preview.sourceRevision)throw error('OFFICE_PREVIEW_CHANGED',409);
   const archive=preview.changed?await artifacts.put(ctx.profile,Buffer.from(JSON.stringify(before)),'source-backup.json','source-configuration-backup'):null;
   await deps.beforeBackup?.(ctx);
   return mutation(ctx,async()=>{ctx.assertAuthority();const receipt=await source.update(kind,args,preview.sourceRevision,ctx);if(receipt.changed)await deps.changed?.(ctx.profile,'modelConnections',{sourceId:args.sourceId,sourceRevision:receipt.sourceRevision,modules:preview.impact.modules});return {verified:true,data:receipt,...(receipt.changed?{rollbackToken:{sourceId:args.sourceId,expectedSourceRevision:receipt.sourceRevision,artifactId:archive.id}}:{})};});
  },
  restore:async(token,ctx)=>mutation(ctx,async()=>{const {buffer}=artifacts.read(ctx.profile,token.artifactId,'source-configuration-backup'),before=JSON.parse(buffer);if(before.id!==token.sourceId)throw error('OFFICE_ROLLBACK_INVALID',409);const receipt=await source.restore(before,token.expectedSourceRevision,ctx);await deps.changed?.(ctx.profile,'modelConnections',{sourceId:token.sourceId,sourceRevision:receipt.sourceRevision,restored:true});return receipt;})});
}
module.exports={registerSourceTools,definition};
