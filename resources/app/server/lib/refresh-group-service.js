'use strict';
const Rules=require('./data-domain/refresh-groups'),{error,hash}=require('./agent-office-store'),{isDeepStrictEqual}=require('node:util');
const fingerprint=items=>hash(JSON.stringify(items));
function createRefreshGroupService({db}){
 const read=()=>{const settings=db.loadSettings(),store=db.loadRefreshGroups();return {...store,documentRevision:settings._revision,sectionRevision:settings._revisions?.refreshGroups??0,raw:settings.refreshGroups||[]};};
 const capacity=(value,reserve)=>{if(![value.documentRevision,value.sectionRevision].every(n=>Number.isSafeInteger(n)&&n>=0&&n<=Number.MAX_SAFE_INTEGER-reserve))throw error('OFFICE_RESOURCE_REVISION_INVALID',409);};
 const canonical=value=>{if(!isDeepStrictEqual(value.raw,value.items))throw error('OFFICE_RESOURCE_VERIFY_FAILED',409);};
 const snapshot=ctx=>db.mutateSettings(()=>{ctx.assertAuthority?.();const value=read();return {items:value.items,revision:value.revision,refreshableModules:Rules.refreshableModules(),legacyNormalizationRequired:!isDeepStrictEqual(value.raw,value.items)};});
 function plan(operation,args,current){
  const existing=current.items.find(item=>item.id===args.groupId),id=args.group?.id||args.groupId;
  if(operation==='create'&&current.items.some(item=>item.id===id))throw error('OFFICE_TASK_INVALID',422);
  if(operation!=='create'&&!existing)throw error('OFFICE_NOT_FOUND',404);
  const group=operation==='delete'?null:Rules.normalizeGroup({...existing,...args.group,updatedAt:existing?.updatedAt||''});
  if(group&&group.id!==id)throw error('OFFICE_TASK_INVALID',422);
  const next=operation==='create'?[...current.items,group]:operation==='delete'?current.items.filter(item=>item.id!==id):current.items.map(item=>item.id===id?group:item);
  if(!Rules.validateGroups(next).ok||Rules.normalizeGroups(next).length!==next.length)throw error('OFFICE_TASK_INVALID',422);
  return {next,id,before:existing||null,after:group};
 }
 const preview=(operation,args,ctx)=>db.mutateSettings(()=>{ctx.assertAuthority?.();const current=read();capacity(current,2);canonical(current);const planned=plan(operation,args,current);return {revision:current.revision,fingerprint:fingerprint(current.items),items:current.items,...planned,impact:{shared:true,executesRefresh:false,requiresUserRefresh:true,moduleIds:planned.after?.moduleIds||planned.before.moduleIds}};});
 async function commit(items,expected,ctx,reserve){return db.mutateSettings(async lease=>{
  ctx.assertAuthority?.();const current=read();capacity(current,reserve);canonical(current);if(current.revision!==expected.revision||fingerprint(current.items)!==expected.fingerprint)throw error('OFFICE_PREVIEW_CHANGED',409);
  const saved=db.replaceRefreshGroups(items,current.revision,{...lease,assertAuthority:()=>ctx.assertAuthority?.()});await lease.commit();const actual=read();if(actual.revision!==saved.revision||!isDeepStrictEqual(actual.items,items))throw error('OFFICE_RESOURCE_VERIFY_FAILED',409);
  return {verified:true,items:saved.items,revision:saved.revision,fingerprint:fingerprint(saved.items)};
 });}
 async function replaceAll(items,expectedRevision,ctx){
  if(!Array.isArray(items)||!Rules.validateGroups(items).ok||Rules.normalizeGroups(items).length!==items.length)throw error('REFRESH_GROUP_INVALID',400);
  const normalized=Rules.normalizeGroups(items);return db.mutateSettings(async lease=>{ctx.assertAuthority?.();const current=read();capacity(current,1);if(expectedRevision!=null&&current.revision!==Number(expectedRevision))throw new db.RevisionConflictError('Yenileme grupları',expectedRevision,current.revision,'refreshGroups');const saved=db.replaceRefreshGroups(normalized,current.revision,{...lease,assertAuthority:()=>ctx.assertAuthority?.()});await lease.commit();if(!isDeepStrictEqual(db.loadRefreshGroups(),saved))throw error('OFFICE_RESOURCE_VERIFY_FAILED',409);return saved;});
 }
 return {snapshot,preview,replaceAll,execute:(expected,ctx)=>commit(expected.next,expected,ctx,2),restore:(items,expected,ctx)=>commit(items,expected,ctx,1)};
}
module.exports={createRefreshGroupService,fingerprint};
