'use strict';
const modelQueryDefault=require('./modelQuery'),fields=require('./model-fields'),adapter=require('./data-domain/legacy-adapter');
const {hash,error}=require('./agent-office-store');
const safeEntry=entry=>{
 if(!entry||!['column','measure'].includes(entry.kind)||typeof entry.name!=='string'||!entry.name||entry.name.length>300||typeof entry.table!=='string'||entry.table.length>200)return null;
 const folder=entry.folder??'',dataType=entry.dataType==null?'':String(entry.dataType);
 if(typeof folder!=='string'||folder.length>200||dataType.length>40)return null;
 return {table:entry.table,name:entry.name,kind:entry.kind,folder,dataType};
};
function page(items,args,project){
 const offset=args.offset||0,limit=args.limit||100,values=[];let scanned=0,omitted=0,bytes=0;
 for(const item of items.slice(offset,offset+limit)){
  const value=project(item);if(value===null){scanned++;omitted++;continue;}
  const size=Buffer.byteLength(JSON.stringify(value));if(bytes+size>64*1024)break;
  scanned++;bytes+=size;values.push(value);
 }
 return {items:values,matched:items.length,offset,nextOffset:offset+scanned,truncated:offset+scanned<items.length,omitted};
}
function createSourceMetadataService({source,modelQuery=modelQueryDefault,modelOptions={},assertAgentAuthority=async()=>{}}){
 const checked=async(sourceId,ctx,reserve=0)=>{
  const store=await source.snapshot(ctx,reserve?{sourceId,reserve}:undefined),matches=store.items.filter(item=>item.id===sourceId);
  if(!matches.length)throw error('SOURCE_NOT_FOUND',404);if(matches.length!==1)throw error('SOURCE_AMBIGUOUS',409);return matches[0];
 };
 async function discover(kind,args,ctx){
  const before=await checked(args.sourceId,ctx),revision=adapter.configRevision(before);
  const connector=before.connector;
  if(connector&&connector.kind!=='analysis-services'||before.engine&&before.engine!=='tabular-dax'&&before.engine!=='tabular-pivot')throw error('SOURCE_SCHEMA_UNSUPPORTED',409);
  const target=connector?{server:connector.server,catalog:connector.database}:{server:before.server,catalog:before.catalog};
  const beforeQuery=async()=>{ctx.assertAuthority();const latest=await checked(args.sourceId,ctx);if(adapter.configRevision(latest)!==revision)throw error('SOURCE_CHANGED',409);await assertAgentAuthority(ctx);ctx.assertAuthority();};
  await beforeQuery();let result;
  try{result=await modelQuery[{tables:'discoverTables',columns:'discoverColumns',schema:'discoverSchema'}[kind]]({...target,...(kind==='columns'?{table:args.table}:{})},{...modelOptions,beforeQuery,assertAuthority:()=>ctx.assertAuthority()});}
  catch(err){ctx.assertAuthority();if(err.nativeQueryAuthorityDenied)throw err;throw error(['MODEL_QUERY_UNSUPPORTED','REFRESH_CANCELLED'].includes(err.code)?err.code:'MODEL_SCHEMA_UNAVAILABLE',err.code==='MODEL_QUERY_UNSUPPORTED'?409:502);}
  ctx.assertAuthority();const current=await checked(args.sourceId,ctx);if(adapter.configRevision(current)!==revision)throw error('SOURCE_CHANGED',409);
  return {item:current,sourceRevision:revision,result};
 }
 async function read(kind,args,ctx){
  const found=await discover(kind,args,ctx),schema=found.result;
  if(kind!=='schema')return {sourceId:args.sourceId,sourceRevision:found.sourceRevision,...page(schema[kind]||[],args,value=>typeof value==='string'&&value.length<=200?value:null),...(kind==='columns'?{table:args.table}:{})};
  const errors=[...new Set((schema.errors||[]).map(e=>e.source).filter(v=>['columns','measures','columnTypes'].includes(v)))];
  const items=args.kind==='column'?schema.columns||[]:args.kind==='measure'?schema.measures||[]:[...(schema.columns||[]),...(schema.measures||[])];
  return {sourceId:args.sourceId,sourceRevision:found.sourceRevision,...page(items,args,safeEntry),partial:errors.length>0,unavailable:errors};
 }
 async function autoMap(args,ctx){
  const found=await discover('schema',args,ctx),mapped=fields.autoMapSchema(found.item.role,found.result);
  return {sourceId:args.sourceId,sourceRevision:found.sourceRevision,...page(Object.entries(mapped.mapping),args,([header,entry])=>{const value=safeEntry(entry);return value&&header.length<=200?{header,entry:value}:null;}),missingRequired:fields.missingRequired(found.item.role,mapped.mapping),unmatchedCount:mapped.unmatched.length,appliesMapping:false,partial:(found.result.errors||[]).length>0};
 }
 async function mappingPreview(args,ctx){
  const item=await checked(args.sourceId,ctx,2),revision=adapter.configRevision(item),known=new Set(fields.fieldsForRole(item.role).map(field=>field.header));
  if(args.changes.some(change=>!known.has(change.header)))throw error('OFFICE_FIELD_INVALID',422);
  const planned=source.planMapping([item],args);
  const next=planned.items[0];
  let schemaHash='';
  if(args.changes.some(change=>change.entry)){
   const found=await discover('schema',args,ctx);if(found.sourceRevision!==revision)throw error('SOURCE_CHANGED',409);
   const entries=[...(found.result.columns||[]),...(found.result.measures||[])],key=e=>JSON.stringify([e.table,e.name,e.kind]),keys=new Set(entries.map(key));
   for(const change of args.changes)if(change.entry&&!keys.has(key(next.mapping[change.header])))throw error('OFFICE_FIELD_INVALID',422);
   schemaHash=hash(JSON.stringify(entries.map(safeEntry)));
  }
  const projection=value=>args.changes.map(change=>({header:change.header,entry:value.mapping?.[change.header]?safeEntry(value.mapping[change.header]):null}));
  return {sourceId:args.sourceId,sourceRevision:revision,schemaHash,before:projection(item),after:projection(next),missingRequiredBefore:fields.missingRequired(item.role,item.mapping),missingRequiredAfter:fields.missingRequired(item.role,next.mapping),impact:{shared:true,modules:[...new Set((item.scopes||[]).flatMap(scope=>scope.targets||[]))].sort(),requiresRefresh:true,executesQuery:false}};
 }
 return {read,autoMap,mappingPreview};
}
module.exports={createSourceMetadataService,safeEntry,page};
