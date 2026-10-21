'use strict';
const {error,hash}=require('./operation-utils'),{pageOf}=require('./profile-store'),{validate}=require('./schema-validation'),{viewSettings,filterSettings}=require('./table-profile-contract');
const clone=v=>JSON.parse(JSON.stringify(v)),ordered=v=>Array.isArray(v)?v.map(ordered):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,ordered(v[k])])):v,stamp=v=>hash(JSON.stringify(ordered(v))),PAGE_AREAS={cp:'cp',orders:'orders',ship:'shipping',koleksiyon:'koleksiyon'};
function nativeData(kind,page,settings,before={}){
 const next={...clone(before),__page:page},entry={...clone(before[page]||{})};
 if(kind==='view'){
  for(const key of ['order','hidden','freeze','pictureHidden','imgSize'])if(Object.hasOwn(settings,key))entry[key]=clone(settings[key]);
  if(settings.widths)entry.widthPx=Object.fromEntries(settings.widths.map(v=>[v.field,v.pixels]));
  if(Object.hasOwn(settings,'sort'))entry.sorting=settings.sort?{key:settings.sort.field,dir:settings.sort.direction}:null;
 }else{
  for(const key of ['search','checkFilter','quickExf','quickActive'])if(Object.hasOwn(settings,key))entry[key]=clone(settings[key]);
  if(settings.selects)entry.selects=Object.fromEntries(settings.selects.map(v=>[v.id,v.value]));
  if(settings.dimensions)entry.dimensionFilters=Object.fromEntries(settings.dimensions.map(v=>[v.id,v.values]));
  if(settings.columns)entry.colFilters=Object.fromEntries(settings.columns.map(({field,...value})=>[field,page==='koleksiyon'?value.values:value]));
 }
 next[page]=entry;return next;
}
function publicDefinition(kind,value,page){
 const raw=value?.[page]||{},out={},copy=key=>{if(Object.hasOwn(raw,key))out[key]=clone(raw[key]);};
 if(kind==='view'){
  for(const key of ['order','hidden','freeze','pictureHidden','imgSize'])copy(key);
  if(raw.widthPx)out.widths=Object.entries(raw.widthPx).map(([field,pixels])=>({field,pixels}));
  if(raw.sorting)out.sort={field:raw.sorting.key??null,direction:raw.sorting.dir};
 }else{
  for(const key of ['search','quickExf','quickActive'])copy(key);
  if(Object.hasOwn(raw,'checkFilter'))out.checkFilter=raw.checkFilter===true?'checked':raw.checkFilter||'';
  if(raw.selects)out.selects=Object.entries(raw.selects).map(([id,value])=>({id,value}));
  if(raw.dimensionFilters)out.dimensions=Object.entries(raw.dimensionFilters).map(([id,values])=>({id,values}));
  if(raw.colFilters)out.columns=Object.entries(raw.colFilters).map(([field,entry])=>page==='koleksiyon'?{field,values:entry}:{field,...Object.fromEntries(['values','granularity','numericRule','quickPriority','quickExf'].filter(key=>Object.hasOwn(entry||{},key)).map(key=>[key,entry[key]]))});
 }
 let truncated=Object.keys(raw).some(key=>!(kind==='view'?['order','hidden','widthPx','freeze','sorting','pictureHidden','imgSize']:['search','checkFilter','quickExf','quickActive','selects','dimensionFilters','colFilters']).includes(key));
 const schema=kind==='view'?viewSettings:filterSettings;
 for(const key of Object.keys(out)){try{validate(schema.properties[key],out[key]);}catch{delete out[key];truncated=true;}}
 for(const key of Object.keys(out).sort((a,b)=>JSON.stringify(out[b]).length-JSON.stringify(out[a]).length)){if(Buffer.byteLength(JSON.stringify(out))<=24*1024)break;delete out[key];truncated=true;}
 return {settings:out,truncated};
}
function validateSettings(kind,page,settings){
 validate(kind==='view'?viewSettings:filterSettings,settings);
 if(Buffer.byteLength(JSON.stringify(settings))>128*1024)throw error('OFFICE_TEXT_TOO_LONG',413);
 for(const key of ['order','hidden','widths','columns','selects','dimensions','quickActive'])if(settings[key]){
  const identities=settings[key].map(v=>typeof v==='string'?v:v.field||v.id);
  if(new Set(identities).size!==identities.length)throw error('OFFICE_TOOL_SCHEMA',422);
 }
 if(kind==='view'){
  if(page!=='koleksiyon'&&['pictureHidden','imgSize'].some(k=>Object.hasOwn(settings,k)))throw error('OFFICE_TOOL_SCHEMA',422);
  if(!['cp','orders'].includes(page)&&Object.hasOwn(settings,'sort'))throw error('OFFICE_TOOL_SCHEMA',422);
 }else{
  const selects={cp:['cpFPriority','cpFCountry','cpFLicense','cpFDelType','cpFStatus','cpFSeason'],orders:['ordersFCountry','ordersFLicense','ordersFDelType','ordersFStatus','ordersFSeason'],ship:[],koleksiyon:[]};
  if((settings.selects||[]).some(v=>!selects[page]?.includes(v.id)))throw error('OFFICE_TOOL_SCHEMA',422);
  if((settings.dimensions||[]).some(v=>!['cp','orders'].includes(page)||!['buyerGrup','buyer','country','merch','ageGroup'].includes(v.id)))throw error('OFFICE_TOOL_SCHEMA',422);
  if(page!=='orders'&&settings.quickActive?.length)throw error('OFFICE_TOOL_SCHEMA',422);
  if(page==='koleksiyon'&&(settings.columns||[]).some(v=>Object.keys(v).some(k=>!['field','values'].includes(k))))throw error('OFFICE_TOOL_SCHEMA',422);
  for(const entry of settings.columns||[]){const rule=entry.numericRule;if(!rule)continue;const keys=['aboveAvg','belowAvg'].includes(rule.op)?['avg']:rule.op==='between'?['a','b']:['a'];if(keys.some(k=>!Number.isFinite(rule[k])))throw error('OFFICE_TOOL_SCHEMA',422);}
 }
}
function createTableProfileService({db,userAccess}){
 const owner=ctx=>{const current=ctx.assertAuthority?.()||userAccess.profileById(ctx.ownerId);if(!current||current.enabled===false||current.id!==ctx.ownerId||ctx.profile.id!==ctx.ownerId)throw error('OFFICE_TOOL_FORBIDDEN',403);return ctx.ownerId;};
 const authorize=(ctx,page)=>{const current=ctx.assertAuthority?.()||userAccess.profileById(ctx.ownerId);owner(ctx);if(!PAGE_AREAS[page]||!userAccess.hasArea(current,PAGE_AREAS[page]))throw error('OFFICE_TOOL_FORBIDDEN',403);};
 const selected=(store,id,page)=>{const items=store.items.filter(v=>v.id===id);if(items.length!==1)throw error(items.length?'OFFICE_RESOURCE_VERIFY_FAILED':'NOT_FOUND',items.length?409:404);if(page&&(pageOf(items[0])!==page||items[0].data?.__page!==page))throw error('OFFICE_TOOL_FORBIDDEN',403);return items[0];};
 const expect=(store,expected)=>{if(expected&&(store._revision!==expected.revision||stamp(store)!==expected.fingerprint))throw error('OFFICE_PREVIEW_CHANGED',409);};
 async function capture(kind,ctx){return db.mutateTableProfiles(kind,owner(ctx),api=>{owner(ctx);return api.load();});}
 async function preview(kind,operation,args,ctx){
  authorize(ctx,args.page);const store=await capture(kind,ctx),item=operation==='create'?args.copyId?selected(store,args.copyId,args.page):null:selected(store,args.id,args.page);
  let data=null;if(['create','update'].includes(operation)){const settings=args.settings||{};validateSettings(kind,args.page,settings);data=nativeData(kind,args.page,settings,item?.data);}
  return {revision:store._revision,fingerprint:stamp(store),before:item?{id:item.id,name:String(item.name).slice(0,160),...publicDefinition(kind,item.data,args.page)}:null,after:data?publicDefinition(kind,data,args.page):null,impact:{ownerOnly:true,page:args.page,recordCount:store.items.filter(v=>pageOf(v)===args.page&&v.data?.__page===args.page).length,savedOnly:true,appliesToOpenRenderer:false}};
 }
 async function execute(kind,operation,args,expected,ctx,{native=false,revision=null}={}){
  owner(ctx);if(!native){authorize(ctx,args.page);if(['create','update'].includes(operation))validateSettings(kind,args.page,args.settings||{});}return db.mutateTableProfiles(kind,ctx.ownerId,async api=>{
   owner(ctx);if(!native)authorize(ctx,args.page);const before=api.load();expect(before,expected);const wanted=db.expectedNumber(revision);if(wanted!=null&&wanted!==before._revision)throw new db.RevisionConflictError(kind,wanted,before._revision);
   const guard={assertAuthority:()=>{owner(ctx);if(!native)authorize(ctx,args.page);}},ids=new Set(before.items.map(v=>v.id));let saved;
   if(operation==='create'){const original=!native&&args.copyId?selected(before,args.copyId,args.page):null;const data=native?args.data:nativeData(kind,args.page,args.settings||{},original?.data);saved=api.add(args.name,data,before._revision,guard);}
   else{
    const item=native?before.items.find(v=>v.id===args.id):selected(before,args.id,args.page);
    if(operation==='update')saved=api.update(args.id,native?args.data:nativeData(kind,args.page,args.settings||{},item.data),before._revision,args.name,guard);
    else if(operation==='delete')saved=api.remove(args.id,before._revision,guard);
    else if(operation==='favorite')saved=api.favorite(args.id,before._revision,guard);
    else if(operation==='use')saved=api.use(args.id,before._revision,guard);
    else throw error('OFFICE_TASK_INVALID',422);
   }
   await api.commit();const committed=api.load();if(stamp(saved)!==stamp(committed))throw error('OFFICE_RESOURCE_VERIFY_FAILED',409);
   const newItems=operation==='create'?committed.items.filter(v=>!ids.has(v.id)):[];if(operation==='create'&&newItems.length!==1)throw error('OFFICE_RESOURCE_VERIFY_FAILED',409);
   return native?committed:{verified:true,id:operation==='create'?newItems[0].id:args.id,revision:committed._revision,fingerprint:stamp(committed)};
  });
 }
 async function restore(kind,page,backup,expected,ctx){authorize(ctx,page);return db.mutateTableProfiles(kind,owner(ctx),async api=>{authorize(ctx,page);const current=api.load();expect(current,expected);const saved=api.replace(backup,current._revision,{assertAuthority:()=>authorize(ctx,page)});await api.commit();if(stamp(saved)!==stamp(api.load()))throw error('OFFICE_RESOURCE_VERIFY_FAILED',409);return {verified:true};});}
 async function list(kind,args,ctx){authorize(ctx,args.page);const store=await capture(kind,ctx),matched=store.items.filter(v=>pageOf(v)===args.page&&v.data?.__page===args.page),items=[];let bytes=0;for(const value of matched.slice(0,args.limit||50)){const item={id:value.id,name:String(value.name).slice(0,160),isFavorite:value.isFavorite,lastUsed:store.lastUsedByPage[args.page]===value.id,...publicDefinition(kind,value.data,args.page)},size=Buffer.byteLength(JSON.stringify(item));if(bytes+size>128*1024)break;bytes+=size;items.push(item);}return {revision:store._revision,matched:matched.length,truncated:items.length<matched.length,items};}
 return {capture,preview,execute,restore,list,stamp,nativeData};
}
module.exports={createTableProfileService,nativeData,publicDefinition};
