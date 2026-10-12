'use strict';
const {object,string,array}=require('./agent-capability-contract'),{error,hash}=require('./agent-office-store'),store=require('./email-groups-store'),artifacts=require('./agent-artifact-store');
const kind={enum:['country','type']},id={...string(160),minLength:1,pattern:'^[A-Za-z0-9_.:-]+$'},name={...string(120),minLength:1},count={type:'integer',minimum:0},fingerprint={...string(64),pattern:'^[a-f0-9]{64}$'};
const heading={...object({id,name,order:{type:'integer',minimum:0,maximum:199}}),required:['id','name','order']};
const inputHeading=object({id,name,order:{type:'integer',minimum:0,maximum:1000000}});inputHeading.required=['name'];
const listField=value=>value==='country'?'countries':'types';
function normalizedPlan(args,current){
 const ids=new Set(current[listField(args.kind)].map(item=>item.id)),requested=args.items.filter(item=>item.id).map(item=>item.id),newIds=new Set();
 if(new Set(requested).size!==requested.length)throw error('OFFICE_TOOL_SCHEMA',422);requested.forEach(id=>ids.add(id));
 const list=args.items.map((item,index)=>{if(item.id)return item;let placeholder='agent_preview_new_'+index;while(ids.has(placeholder))placeholder+='_';ids.add(placeholder);newIds.add(placeholder);return {...item,id:placeholder};});
 const plan=store.planHeadings(args.kind,list,current);if(plan.next.length!==args.items.length)throw error('OFFICE_TOOL_SCHEMA',422);return {...plan,newIds};
}
function preview(args){
 const current=store.loadStore(),plan=normalizedPlan(args,current),before=current[plan.field.list],byId=new Map(before.map(item=>[item.id,item])),nextById=new Map(plan.next.map(item=>[item.id,item]));
 return {kind:args.kind,revision:current._revision,sourceFingerprint:hash(JSON.stringify(current)),before:before.slice(0,50),beforeCount:before.length,next:plan.next.slice(0,50).map(item=>({...item,id:plan.newIds.has(item.id)?null:item.id,isNew:plan.newIds.has(item.id)||!byId.has(item.id)})),nextCount:plan.next.length,truncated:before.length>50||plan.next.length>50,
  impact:{shared:true,created:plan.next.filter(item=>!byId.has(item.id)).length,renamed:plan.next.filter(item=>byId.has(item.id)&&byId.get(item.id).name!==item.name).length,reordered:plan.next.filter(item=>byId.has(item.id)&&byId.get(item.id).order!==item.order).length,removed:before.filter(item=>!nextById.has(item.id)).length,affectedRecords:current.records.filter(record=>{const old=byId.get(record[plan.field.ref]),next=nextById.get(record[plan.field.ref]);return old&&(!next||old.name!==next.name||old.order!==next.order);}).length,recordValuesChanged:false}};
}
function registerManufacturerHeadingTools(registry,deps,base){
 const mutation=(ctx,work)=>{if(!deps.withAgentMutation)throw error('OFFICE_APPROVAL_REQUIRED',403);return deps.withAgentMutation(ctx,work);},changed=async(ctx,revision)=>{await deps.flush?.();await deps.changed?.(ctx.profile,'emailGroups',{revision,origin:'agent-headings'});};
 registry.registerCapability({...base,id:'manufacturer.headings.read',operation:'READ',risk:'read',label:{tr:'Üretici ülke ve grup başlıklarını oku',en:'Read manufacturer country and group headings'},inputSchema:{...object({kind}),required:['kind']},outputSchema:{...object({verified:{enum:[true]},data:{...object({kind,revision:count,total:count,items:array(heading,50),truncated:{type:'boolean'}}),required:['kind','revision','total','items','truncated']}}),required:['verified','data']},read:args=>{const current=store.loadStore(),items=current[listField(args.kind)];return {kind:args.kind,revision:current._revision,total:items.length,items:items.slice(0,50),truncated:items.length>50};}});
 registry.registerCapability({...base,id:'manufacturer.headings.replace',operation:'UPDATE',risk:'write',permissions:['manageBusinessRules'],label:{tr:'Üretici başlıklarını etki analiziyle düzenle',en:'Edit manufacturer headings with impact analysis'},inputSchema:{...object({kind,items:array(inputHeading,200)}),required:['kind','items']},outputSchema:{...object({verified:{enum:[true]},data:{...object({kind,revision:count,count,headingIds:array(id,200)}),required:['kind','revision','count','headingIds']},rollbackToken:{...object({kind,artifactId:{...string(32),pattern:'^[a-f0-9]{32}$'},expected:{...object({revision:count,fingerprint}),required:['revision','fingerprint']}}),required:['kind','artifactId','expected']}}),required:['verified','data','rollbackToken']},
  read:args=>preview(args),
  apply:(args,ctx,approved)=>mutation(ctx,()=>store.mutateSharedResource(async lease=>{
   const current=store.loadStore();ctx.assertAuthority();if(current._revision!==approved.revision||hash(JSON.stringify(current))!==approved.sourceFingerprint)throw error('OFFICE_PREVIEW_CHANGED',409);
   const plan=normalizedPlan(args,current),backup=await artifacts.put(ctx.profile,Buffer.from(JSON.stringify({kind:args.kind,items:current[plan.field.list]})),'manufacturer-headings-backup.json','manufacturer-headings-backup');
   const saved=store.replaceHeadings(args.kind,args.items,current._revision,{...lease,assertAuthority:()=>ctx.assertAuthority()});await lease.commit();const actual=store.loadStore(),list=actual[plan.field.list];
   if(actual._revision!==saved.revision||list.length!==plan.next.length||list.some((item,index)=>{const expected=plan.next[index];return item.name!==expected.name||item.order!==expected.order||(!plan.newIds.has(expected.id)?item.id!==expected.id:current[plan.field.list].some(old=>old.id===item.id));}))throw error('OFFICE_RESOURCE_VERIFY_FAILED',409);
   const committedFingerprint=hash(JSON.stringify(list));await changed(ctx,saved.revision);return {verified:true,data:{kind:args.kind,revision:saved.revision,count:list.length,headingIds:list.map(item=>item.id)},rollbackToken:{kind:args.kind,artifactId:backup.id,expected:{revision:saved.revision,fingerprint:committedFingerprint}}};
  })),
  restore:(token,ctx)=>mutation(ctx,()=>store.mutateSharedResource(async lease=>{
   const {buffer}=artifacts.read(ctx.profile,token.artifactId,'manufacturer-headings-backup'),backup=JSON.parse(buffer),current=store.loadStore();ctx.assertAuthority();if(backup.kind!==token.kind)throw error('OFFICE_ROLLBACK_INVALID',409);if(current._revision!==token.expected.revision||hash(JSON.stringify(current[listField(token.kind)]))!==token.expected.fingerprint)throw error('OFFICE_PREVIEW_CHANGED',409);
   const saved=store.replaceHeadings(token.kind,backup.items,current._revision,{...lease,assertAuthority:()=>ctx.assertAuthority()});await lease.commit();if(JSON.stringify(store.loadStore()[listField(token.kind)])!==JSON.stringify(backup.items))throw error('OFFICE_RESOURCE_VERIFY_FAILED',409);await changed(ctx,saved.revision);return {verified:true,revision:saved.revision};
  }))});
}
module.exports={registerManufacturerHeadingTools};
