'use strict';
const adapter=require('./data-domain/legacy-adapter'),binding=require('./data-domain/binding-writer'),filter=require('./data-domain/filter-writer'),link=require('./data-domain/link-writer'),profiles=require('./data-domain/source-profiles'),horizon=require('./modelHorizon');
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
 return ids.filter(id=>JSON.stringify(view(before,id))!==JSON.stringify(view(after,id))).sort();
}
function createSourceWorkflowService({db}){
 if(!db?.mutateModelConnections)throw new TypeError('Native source transaction is required');
 const planner={binding:binding.planBindingChange,filter:filter.planFilterChange,link:link.planLinkChange};
 const checked=(store,sourceId,expected)=>{
  const matches=store.items.filter(item=>item.id===sourceId),item=matches[0];if(!item)throw fail('SOURCE_NOT_FOUND',404);if(matches.length!==1)throw fail('SOURCE_AMBIGUOUS');
  if(expected&&adapter.configRevision(item)!==expected)throw fail('SOURCE_CHANGED');return item;
 };
 const plan=(kind,items,args)=>{if(!planner[kind])throw fail('VALIDATION_ERROR',400);const value=planner[kind](items,args);if(!value.ok)throw fail(value.code,value.code==='SOURCE_NOT_FOUND'?404:['FILTER_INVALID','FILTER_MODE_INVALID','VALIDATION_ERROR'].includes(value.code)?400:409);return value;};
 const snapshot=guard=>db.mutateModelConnections(()=>{guard?.assertAuthority?.();return db.loadModelConnections();});
 async function preview(kind,args,guard){
  const store=await snapshot(guard),before=checked(store,args.sourceId),planned=plan(kind,store.items,args),after=checked({items:db.normalizeModelConnections(planned.items)},args.sourceId),old=semanticSource(before),next=semanticSource(after);
  return {sourceId:before.id,sourceRevision:adapter.configRevision(before),before:semanticSource(before,true),after:semanticSource(after,true),changed:planned.code!=='NO_CHANGE',warnings:planned.warnings||[],impact:{shared:true,modules:affectedModules(old,next),requiresRefresh:true,executesQuery:false,bounded:kind==='filter'?filter.describeBounds(args.definition).bounded:null}};
 }
 async function update(kind,args,expected,guard={}){
  return db.mutateModelConnections(async lease=>{
   guard.assertAuthority?.();const store=db.loadModelConnections(),before=checked(store,args.sourceId,expected),planned=plan(kind,store.items,args);
   if(planned.code==='NO_CHANGE')return {verified:true,changed:false,revision:store.revision,sourceRevision:adapter.configRevision(before),warnings:planned.warnings||[]};
   const saved=db.replaceModelConnections(planned.items,store.revision,{...lease,assertAuthority:guard.assertAuthority});await lease.commit();guard.assertAuthority?.();
   const actual=db.loadModelConnections(),own=checked(saved,args.sourceId),current=checked(actual,args.sourceId);
   if(actual.revision!==saved.revision||adapter.configRevision(own)!==adapter.configRevision(current))throw fail('OFFICE_RESOURCE_VERIFY_FAILED');
   return {verified:true,changed:true,revision:saved.revision,sourceRevision:adapter.configRevision(own),warnings:planned.warnings||[],appliedScopeId:planned.appliedScopeId||''};
  });
 }
 async function restore(before,expected,guard={}){
  return db.mutateModelConnections(async lease=>{
   guard.assertAuthority?.();const store=db.loadModelConnections(),current=checked(store,before.id,expected),wanted={...clone(before),lastRun:current.lastRun};
   const items=store.items.map(item=>item.id===before.id?wanted:item),saved=db.replaceModelConnections(items,store.revision,{...lease,assertAuthority:guard.assertAuthority});await lease.commit();guard.assertAuthority?.();
   const own=checked(saved,before.id),actual=db.loadModelConnections(),latest=checked(actual,before.id);
   const originalConfig=adapter.configRevision({...before,_configVersion:0}),restoredConfig=adapter.configRevision({...latest,_configVersion:0});
   if(actual.revision!==saved.revision||adapter.configRevision(own)!==adapter.configRevision(latest)||restoredConfig!==originalConfig)throw fail('OFFICE_RESOURCE_VERIFY_FAILED');
   return {verified:true,revision:saved.revision,sourceRevision:adapter.configRevision(own)};
  });
 }
 return {snapshot,preview,update,restore,publicSource,filterFields};
}
module.exports={createSourceWorkflowService,publicSource,publicHorizon,semanticSource,affectedModules,filterFields};
