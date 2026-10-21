'use strict';
const {error,hash}=require('./operation-utils'),horizon=require('./modelHorizon'),{publicHorizon}=require('./source-workflow-service');
const ordered=value=>Array.isArray(value)?value.map(ordered):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,ordered(value[key])])):value;
const stamp=store=>hash(JSON.stringify(ordered(store)));
function normalizeDefinition(definition){
 if(!definition||typeof definition!=='object'||Array.isArray(definition))throw error('HORIZON_TEMPLATE_INVALID',422);
 return {table:String(definition.table||''),groups:horizon.conditions.normalizeGroups(definition.groups,String(definition.table||''))};
}
function createHorizonTemplateService({db,userAccess}){
 const owner=ctx=>{ctx.assertAuthority?.();if(!ctx.ownerId||ctx.profile.id!==ctx.ownerId)throw error('OFFICE_TOOL_FORBIDDEN',403);return ctx.ownerId;};
 const scope=(args,ctx)=>args.shared===true?null:owner(ctx);
 const guard=(ctx,sharedItem)=>({assertAuthority:()=>{owner(ctx);if(sharedItem)requireSharedManager(ctx,sharedItem);}});
 const requireSharedManager=(ctx,selected)=>{const current=ctx.assertAuthority?.()||userAccess.profileById(ctx.ownerId);if(!current||!(selected?.userId===ctx.ownerId||userAccess.hasPermission(current,'manageAllOrders')))throw error('NOT_OWNER',403);};
 const item=(store,id)=>{const found=store.items.filter(value=>value.id===id);if(!found.length)throw error('NOT_FOUND',404);if(found.length!==1)throw error('OFFICE_RESOURCE_VERIFY_FAILED',409);return found[0];};
 const publicItem=value=>({id:value.id,name:String(value.name).slice(0,160),definition:publicHorizon(value.data),updatedAt:value.updatedAt||value.createdAt||null});
 const expect=(current,expected)=>{if(expected&&(current._revision!==expected.revision||stamp(current)!==expected.fingerprint))throw error('OFFICE_PREVIEW_CHANGED',409);};
 const readScope=async(args,ctx)=>{owner(ctx);return db.mutateHorizonTemplates(scope(args,ctx),api=>{owner(ctx);return api.load();});};
 async function capture(operation,args,ctx){
  const store=await readScope({...args,shared:operation==='share'?true:args.shared},ctx),source=operation==='share'?await readScope({shared:false},ctx):null;
  return {store,source};
 }
 async function preview(operation,args,ctx){
  const {store,source}=await capture(operation,args,ctx);let before=null,definition=null,name=null;
  if(operation==='delete'){before=item(store,args.id);if(args.shared)requireSharedManager(ctx,before);}
  if(operation==='create'){name=String(args.name||'').trim();definition=normalizeDefinition(args.definition);if(!name)throw error('VALIDATION_ERROR',422);}
  if(operation==='share'){before=item(source,args.id);name=before.name;definition=normalizeDefinition(before.data);}
  return {revision:store._revision,fingerprint:stamp(store),...(source?{sourceRevision:source._revision,sourceFingerprint:stamp(source)}:{}),name,definition:definition?publicHorizon(definition):null,before:before?publicItem(before):null,impact:{shared:operation==='share'||args.shared===true,ownerOnly:operation!=='share'&&args.shared!==true,appliesFilter:false,copiesPersonal:operation==='share'}};
 }
 async function execute(operation,args,expected,ctx){
  owner(ctx);const shared=operation==='share'||args.shared===true,ownerId=shared?null:ctx.ownerId;
  const write=async definition=>db.mutateHorizonTemplates(ownerId,async api=>{
   owner(ctx);const current=api.load();expect(current,expected);if(operation==='delete'&&shared)requireSharedManager(ctx,item(current,args.id));const previousIds=new Set(current.items.map(value=>value.id));
   const saved=operation==='delete'?api.remove(item(current,args.id).id,current._revision,guard(ctx,shared?item(current,args.id):null)):api.add(String(operation==='share'?definition.name:args.name).trim(),operation==='share'?definition.data:normalizeDefinition(args.definition),current._revision,guard(ctx));
   await api.commit();owner(ctx);const committed=api.load();if(stamp(committed)!==stamp(saved))throw error('OFFICE_RESOURCE_VERIFY_FAILED',409);
   const added=operation==='delete'?null:committed.items.filter(value=>!previousIds.has(value.id));if(added&&added.length!==1)throw error('OFFICE_RESOURCE_VERIFY_FAILED',409);
   return {verified:true,revision:committed._revision,fingerprint:stamp(committed),id:operation==='delete'?args.id:added[0].id,shared};
  });
  if(operation!=='share')return write();
  return db.mutateHorizonTemplates(ctx.ownerId,async api=>{owner(ctx);const current=api.load();if(expected&&(current._revision!==expected.sourceRevision||stamp(current)!==expected.sourceFingerprint))throw error('OFFICE_PREVIEW_CHANGED',409);return write(item(current,args.id));});
 }
 async function restore(args,backup,expected,ctx){
  owner(ctx);return db.mutateHorizonTemplates(args.shared?null:ctx.ownerId,async api=>{owner(ctx);const current=api.load();expect(current,expected);const selected=args.shared?(current.items.find(value=>value.id===args.id)||backup.items.find(value=>value.id===args.id)):null;if(args.shared)requireSharedManager(ctx,selected);const saved=api.replace(backup,current._revision,guard(ctx,selected));await api.commit();const committed=api.load();if(stamp(committed)!==stamp(saved))throw error('OFFICE_RESOURCE_VERIFY_FAILED',409);return {verified:true};});
 }
 async function list(args,ctx){const store=await readScope(args,ctx),matched=store.items.length,items=[];let bytes=0;for(const value of store.items.slice(0,args.limit||50)){const selected=publicItem(value),size=Buffer.byteLength(JSON.stringify(selected));if(bytes+size>128*1024)break;bytes+=size;items.push(selected);}return {shared:args.shared===true,revision:store._revision,matched,truncated:matched>items.length,items};}
 return {capture,preview,execute,restore,list,normalizeDefinition};
}
module.exports={createHorizonTemplateService};
