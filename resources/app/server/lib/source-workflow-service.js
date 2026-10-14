'use strict';
const adapter=require('./data-domain/legacy-adapter'),binding=require('./data-domain/binding-writer'),filter=require('./data-domain/filter-writer'),link=require('./data-domain/link-writer'),writer=require('./data-domain/source-writer'),profiles=require('./data-domain/source-profiles'),horizon=require('./modelHorizon');
const clone=value=>JSON.parse(JSON.stringify(value));
const fail=(code,statusCode=409)=>Object.assign(new Error(code),{code,statusCode});
function publicHorizon(value,bounded=true){
 const normalized=horizon.normalizeHorizon(value||{}),{extraExpression,...safe}=normalized;
 if(!bounded)return {...safe,manualExpressionPresent:!!extraExpression};
 let count=0,bytes=0,truncated=false;
 const groups=safe.groups.map(group=>{
  const projected=[];
  for(const condition of group.conditions){
   const next={...condition,values:condition.values.slice(0,20).map(value=>value.slice(0,200)),valueCount:condition.values.length,valuesTruncated:condition.values.length>20||condition.values.some(value=>value.length>200)};
   const size=Buffer.byteLength(JSON.stringify(next));if(count>=40||bytes+size>12000){truncated=true;continue;}count++;bytes+=size;projected.push(next);if(next.valuesTruncated)truncated=true;
  }
  return {...group,conditions:projected,conditionCount:group.conditions.length};
 });
 return {...safe,groups,groupCount:safe.groups.length,conditionCount:safe.groups.reduce((sum,group)=>sum+group.conditions.length,0),seasons:safe.seasons.slice(0,100).map(value=>value.slice(0,200)),seasonCount:safe.seasons.length,definitionTruncated:truncated||safe.seasons.length>100||safe.seasons.some(value=>value.length>200),manualExpressionPresent:!!extraExpression};
}
function filterFields(item){
 const found=new Map(),add=(table,field)=>{if(table&&field)found.set(JSON.stringify([table,field]),{table,field});};
 for(const entry of Object.values(item.mapping||{}))add(entry.table,entry.name);
 for(const scope of item.scopes||[]){const value=horizon.normalizeHorizon(scope.horizon);for(const group of value.groups)for(const condition of group.conditions)add(condition.table||value.table,condition.field);add(value.seasonTable,value.seasonField);add(value.dateTable,value.dateField);}
 for(const entry of item.cpColumns||[])add(entry.table,entry.name);
 return [...found.values()];
}
function publicSource(item,options={}){
 const profile=profiles.fromLegacyRole(item.role);
 const value={id:item.id,name:item.name,profileId:profile?.id||'',role:item.role,sourceRevision:adapter.configRevision(item),refreshEnabled:item.refreshEnabled!==false,requiredModules:binding.lockedTargets(item),linkedTargets:item.linkedTargets||[],
  scopes:(item.scopes||[]).map(scope=>({name:scope.name||'',targets:[...(scope.targets||[])].sort(),enabled:scope.enabled!==false,limitToCpOrders:scope.limitToCpOrders===true,horizon:publicHorizon(scope.horizon,options.bounded!==false)})).sort((a,b)=>a.targets.join('|').localeCompare(b.targets.join('|'))),
  parkedModules:binding.normalizeParked(item.parkedBindings).map(entry=>entry.moduleId).sort(),restoreModules:binding.normalizeParked(item.linkRestore).map(entry=>entry.moduleId).sort(),manualQueryPresent:!!item.query,
  lastRun:item.lastRun?{at:item.lastRun.at,ok:item.lastRun.ok,rowCount:item.lastRun.rowCount,elapsedMs:item.lastRun.elapsedMs}:null};
 if(options.bounded!==false&&Buffer.byteLength(JSON.stringify(value))>48*1024)for(const scope of value.scopes)scope.horizon={...scope.horizon,groups:[],seasons:[],definitionTruncated:true};
 return value;
}
function semanticSource(item,bounded=false){const {sourceRevision,lastRun,...safe}=publicSource(item,{bounded});return safe;}
function affectedModules(before,after){
 const view=(item,moduleId)=>{const scope=item.scopes.find(scope=>scope.targets.includes(moduleId));return {scope:scope||null,linked:item.linkedTargets.includes(moduleId)?item.linkedTargets:[],parked:item.parkedModules.includes(moduleId)};};
 const ids=[...new Set([...before.scopes,...after.scopes].flatMap(scope=>scope.targets).concat(before.parkedModules,after.parkedModules))];
 return ids.filter(id=>before.refreshEnabled!==after.refreshEnabled||JSON.stringify(view(before,id))!==JSON.stringify(view(after,id))).sort();
}
function createSourceWorkflowService({db}){
 if(!db?.mutateModelConnections)throw new TypeError('Native source transaction is required');
 const planner={binding:binding.planBindingChange,filter:filter.planFilterChange,link:link.planLinkChange,rename:writer.planSourceUpdate,enabled:writer.planSourceEnabled,mapping:writer.planMappingChanges};
 const checked=(store,sourceId,expected)=>{
  const matches=store.items.filter(item=>item.id===sourceId),item=matches[0];if(!item)throw fail('SOURCE_NOT_FOUND',404);if(matches.length!==1)throw fail('SOURCE_AMBIGUOUS');
  if(expected&&adapter.configRevision(item)!==expected)throw fail('SOURCE_CHANGED');return item;
 };
 const plan=(kind,items,args)=>{
  if(!planner[kind])throw fail('VALIDATION_ERROR',400);const value=planner[kind](items,args);if(!value.ok)throw fail(value.code,value.code==='SOURCE_NOT_FOUND'?404:['FILTER_INVALID','FILTER_MODE_INVALID','VALIDATION_ERROR'].includes(value.code)?400:409);
  if(kind==='mapping'){
   const normalized=db.normalizeModelConnections(value.items),wanted=checked({items:value.items},args.sourceId),actual=checked({items:normalized},args.sourceId);
   for(const change of args.changes){const before=wanted.mapping?.[change.header],after=actual.mapping?.[change.header];if(JSON.stringify(before)!==JSON.stringify(after))throw fail(before&&!after?'SOURCE_MAPPING_CAPACITY':'OFFICE_FIELD_INVALID',422);}
   return {...value,items:normalized};
  }
  return value;
 };
 const capacity=(store,item,reserve)=>{
  const settings=db.loadSettings(),versions=settings._revisions?.modelConnectionRecords||{};
  for(const value of [settings._revision,store.revision,item._configVersion,versions[item.id]??0])if(!Number.isSafeInteger(value)||value<0||value>Number.MAX_SAFE_INTEGER-reserve)throw fail('OFFICE_RESOURCE_REVISION_INVALID');
 };
 const snapshot=(guard,headroom)=>db.mutateModelConnections(()=>{guard?.assertAuthority?.();const store=db.loadModelConnections();if(headroom)capacity(store,checked(store,headroom.sourceId),headroom.reserve);return store;});
 async function preview(kind,args,guard){
  const store=await snapshot(guard,{sourceId:args.sourceId,reserve:2}),before=checked(store,args.sourceId),planned=plan(kind,store.items,args),after=checked({items:db.normalizeModelConnections(planned.items)},args.sourceId),old=semanticSource(before),next=semanticSource(after);
  return {sourceId:before.id,sourceRevision:adapter.configRevision(before),before:semanticSource(before,true),after:semanticSource(after,true),changed:planned.code!=='NO_CHANGE',warnings:planned.warnings||[],impact:{shared:true,modules:affectedModules(old,next),requiresRefresh:true,executesQuery:false,bounded:kind==='filter'?filter.describeBounds(args.definition).bounded:null}};
 }
 async function update(kind,args,expected,guard={}){
  return db.mutateModelConnections(async lease=>{
   guard.assertAuthority?.();const store=db.loadModelConnections(),before=checked(store,args.sourceId,expected),planned=plan(kind,store.items,args);
   if(planned.code==='NO_CHANGE')return {verified:true,changed:false,revision:store.revision,sourceRevision:adapter.configRevision(before),warnings:planned.warnings||[]};
   capacity(store,before,2);const saved=db.replaceModelConnections(planned.items,store.revision,{...lease,assertAuthority:guard.assertAuthority});await lease.commit();
   const actual=db.loadModelConnections(),own=checked(saved,args.sourceId),current=checked(actual,args.sourceId);
   if(actual.revision!==saved.revision||adapter.configRevision(own)!==adapter.configRevision(current))throw fail('OFFICE_RESOURCE_VERIFY_FAILED');
   return {verified:true,changed:true,revision:saved.revision,sourceRevision:adapter.configRevision(own),warnings:planned.warnings||[],appliedScopeId:planned.appliedScopeId||''};
  });
 }
 async function restore(before,expected,guard={}){
  return db.mutateModelConnections(async lease=>{
   guard.assertAuthority?.();const store=db.loadModelConnections(),current=checked(store,before.id,expected),wanted={...clone(before),lastRun:current.lastRun};
   const enabledPlan=writer.planSourceEnabled(store.items,{sourceId:before.id,enabled:wanted.refreshEnabled!==false});if(!enabledPlan.ok)throw fail(enabledPlan.code);
   capacity(store,current,1);const items=store.items.map(item=>item.id===before.id?wanted:item),saved=db.replaceModelConnections(items,store.revision,{...lease,assertAuthority:guard.assertAuthority});await lease.commit();
   const own=checked(saved,before.id),actual=db.loadModelConnections(),latest=checked(actual,before.id);
   const originalConfig=adapter.configRevision({...before,_configVersion:0}),restoredConfig=adapter.configRevision({...latest,_configVersion:0});
   if(actual.revision!==saved.revision||adapter.configRevision(own)!==adapter.configRevision(latest)||restoredConfig!==originalConfig)throw fail('OFFICE_RESOURCE_VERIFY_FAILED');
   return {verified:true,revision:saved.revision,sourceRevision:adapter.configRevision(own)};
  });
 }
 // CREATE copies the connection target of an already configured source; no host or
 // model name is accepted from the caller. Only manually creatable profiles qualify.
 const manualProfile=profileId=>{const option=writer.createOptions().find(item=>item.id===profileId);if(!option||!option.creationMethods.includes('manual'))throw fail('SOURCE_PROFILE_NOT_ALLOWED',422);return option;};
 const headroom=(store,reserve)=>{const settings=db.loadSettings();for(const value of [settings._revision,store.revision])if(!Number.isSafeInteger(value)||value<0||value>Number.MAX_SAFE_INTEGER-reserve)throw fail('OFFICE_RESOURCE_REVISION_INVALID');};
 const planCreate=(store,args)=>{manualProfile(args.profileId);const target=checked(store,args.targetSourceId),value=writer.planSourceCreate(store.items,{name:args.name,profileId:args.profileId,server:target.server,catalog:target.catalog,moduleIds:args.moduleIds||[]});
  if(!value.ok)throw fail(value.code,['NAME_REQUIRED','PROFILE_UNKNOWN','MODULE_NOT_FEEDABLE','SERVER_INVALID','CATALOG_INVALID'].includes(value.code)?422:409);
  const created=checked({items:db.normalizeModelConnections(value.items)},value.sourceId);return {value,created};};
 const withoutId=item=>{const {id,...rest}=semanticSource(item,true);return rest;};
 async function createPreview(args,guard){
  const store=await db.mutateModelConnections(()=>{guard?.assertAuthority?.();const current=db.loadModelConnections();headroom(current,2);return current;}),{value,created}=planCreate(store,args);
  return {storeRevision:store.revision,targetSourceId:args.targetSourceId,after:withoutId(created),warnings:value.warnings||[],impact:{shared:true,modules:[...new Set((created.scopes||[]).flatMap(scope=>scope.targets||[]))].sort(),refreshEnabled:created.refreshEnabled!==false}};
 }
 async function create(args,expectedStoreRevision,guard={}){
  return db.mutateModelConnections(async lease=>{
   guard.assertAuthority?.();const store=db.loadModelConnections();if(store.revision!==expectedStoreRevision)throw fail('OFFICE_PREVIEW_CHANGED');headroom(store,2);
   const {value}=planCreate(store,args),saved=db.replaceModelConnections(value.items,store.revision,{...lease,assertAuthority:guard.assertAuthority});await lease.commit();
   const actual=db.loadModelConnections(),own=checked(saved,value.sourceId),current=checked(actual,value.sourceId);if(store.items.some(item=>!actual.items.some(next=>next.id===item.id)))throw fail('OFFICE_RESOURCE_VERIFY_FAILED');
   if(actual.revision!==saved.revision||adapter.configRevision(own)!==adapter.configRevision(current))throw fail('OFFICE_RESOURCE_VERIFY_FAILED');
   return {verified:true,changed:true,revision:saved.revision,sourceId:value.sourceId,sourceRevision:adapter.configRevision(own),warnings:value.warnings||[]};
  });
 }
 // DELETE uses the native planner (required-module protection); the complete prior
 // configuration is returned for the caller's private inverse archive.
 const planDelete=(store,args)=>{const value=writer.planSourceDelete(store.items,{sourceId:args.sourceId,expectedName:args.expectedName??null});if(!value.ok)throw fail(value.code,value.code==='SOURCE_NOT_FOUND'?404:409);return value;};
 async function deletePreview(args,guard){
  const store=await snapshot(guard,{sourceId:args.sourceId,reserve:2}),before=checked(store,args.sourceId),value=planDelete(store,args);
  return {sourceId:before.id,sourceRevision:adapter.configRevision(before),before:semanticSource(before,true),warnings:value.warnings||[],removed:value.removed,impact:{shared:true,modules:[...new Set((before.scopes||[]).flatMap(scope=>scope.targets||[]))].sort()}};
 }
 async function remove(args,expectedSourceRevision,guard={}){
  return db.mutateModelConnections(async lease=>{
   guard.assertAuthority?.();const store=db.loadModelConnections(),before=checked(store,args.sourceId,expectedSourceRevision);capacity(store,before,2);
   const value=planDelete(store,args),saved=db.replaceModelConnections(value.items,store.revision,{...lease,assertAuthority:guard.assertAuthority});await lease.commit();
   const actual=db.loadModelConnections();if(actual.revision!==saved.revision||actual.items.some(item=>item.id===args.sourceId))throw fail('OFFICE_RESOURCE_VERIFY_FAILED');
   return {receipt:{verified:true,changed:true,revision:saved.revision,sourceId:args.sourceId,sourceRevision:expectedSourceRevision,warnings:value.warnings||[]},before:clone(before),index:store.items.findIndex(item=>item.id===args.sourceId)};
  });
 }
 // Inverse of CREATE: removes only the created source while it is unchanged.
 async function removeCreated(sourceId,expectedSourceRevision,guard={}){
  return db.mutateModelConnections(async lease=>{
   guard.assertAuthority?.();const store=db.loadModelConnections(),current=checked(store,sourceId,expectedSourceRevision);capacity(store,current,1);
   const saved=db.replaceModelConnections(store.items.filter(item=>item.id!==sourceId),store.revision,{...lease,assertAuthority:guard.assertAuthority});await lease.commit();
   const actual=db.loadModelConnections();if(actual.revision!==saved.revision||actual.items.some(item=>item.id===sourceId))throw fail('OFFICE_RESOURCE_VERIFY_FAILED');
   return {verified:true,revision:saved.revision};
  });
 }
 // Inverse of DELETE: reinserts the exact archived configuration; refuses an id clash
 // or a peer that activated the same role meanwhile.
 async function restoreDeleted(before,index,guard={}){
  return db.mutateModelConnections(async lease=>{
   guard.assertAuthority?.();const store=db.loadModelConnections();if(store.items.some(item=>item.id===before.id))throw fail('SOURCE_EXISTS');headroom(store,1);
   // Native normalization keeps only MAX_SOURCES entries; never let a restore push a peer out.
   if(store.items.length>=writer.MAX_SOURCES)throw fail('SOURCE_LIMIT');
   if(before.refreshEnabled!==false&&store.items.some(item=>item.role===before.role&&item.refreshEnabled!==false))throw fail('ROLE_ALREADY_ACTIVE');
   const items=store.items.slice();items.splice(Math.max(0,Math.min(items.length,Number.isSafeInteger(index)?index:items.length)),0,clone(before));const saved=db.replaceModelConnections(items,store.revision,{...lease,assertAuthority:guard.assertAuthority});await lease.commit();
   const actual=db.loadModelConnections(),latest=checked(actual,before.id),own=checked(saved,before.id);if(store.items.some(item=>!actual.items.some(next=>next.id===item.id)))throw fail('OFFICE_RESOURCE_VERIFY_FAILED');
   if(actual.revision!==saved.revision||adapter.configRevision(own)!==adapter.configRevision(latest)||adapter.configRevision({...before,_configVersion:0})!==adapter.configRevision({...latest,_configVersion:0}))throw fail('OFFICE_RESOURCE_VERIFY_FAILED');
   return {verified:true,revision:saved.revision,sourceRevision:adapter.configRevision(own)};
  });
 }
 return {snapshot,preview,update,restore,createPreview,create,removeCreated,deletePreview,remove,restoreDeleted,publicSource,filterFields,planMapping:(items,args)=>plan('mapping',items,args),createOptions:writer.createOptions};
}
module.exports={createSourceWorkflowService,publicSource,publicHorizon,semanticSource,affectedModules,filterFields};
