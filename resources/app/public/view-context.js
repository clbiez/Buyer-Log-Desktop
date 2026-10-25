(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.BLViewContext=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
 'use strict';
 const VERSION=1,KEY='buyerlog.workspace.resume.v1',MAX_BYTES=200000;
 const clone=value=>value==null?value:JSON.parse(JSON.stringify(value));
 const safeKey=key=>!['__proto__','constructor','prototype'].includes(key);
 function pack(data,{page,columns=[],canonical=()=>null,density='default',filters=null,context=null}){
  const out=clone(data),view=out?.[page];if(!view)return out;
  out.__viewVersion=VERSION;view.columnIds=Object.fromEntries(columns.map(key=>[key,canonical(page,key)?'field:'+canonical(page,key):'local:'+page+':'+key]));
  view.density=density;out.__filters=clone(filters);out.__context=clone(context);return out;
 }
 function unpack(data,{page,columns=[],canonical=()=>null,filterIds=[]}){
  if(!data||data.__page&&data.__page!==page||data.__viewVersion!=null&&data.__viewVersion!==VERSION)return null;
  const out=clone(data),view=out[page];if(!view)return out;
  const valid=new Set(columns.filter(safeKey)),ids=view.columnIds||{};
  function key(old){if(!safeKey(old))return null;if(valid.has(old))return old;const id=ids[old];if(!id?.startsWith('field:'))return null;const matches=columns.filter(k=>canonical(page,k)&&'field:'+canonical(page,k)===id);return matches.length===1?matches[0]:null;}
  const keys=items=>[...new Set((Array.isArray(items)?items:[]).map(key).filter(Boolean))];
  view.order=keys(view.order);view.hidden=keys(view.hidden);view.widthPx=Object.fromEntries(Object.entries(view.widthPx||{}).flatMap(([old,value])=>{const resolved=key(old),n=Number(value);return resolved&&Number.isFinite(n)&&n>=24&&n<=2400?[[resolved,n]]:[];}));
  if(view.sorting)view.sorting={key:key(view.sorting.key)||null,dir:Number(view.sorting.dir)===-1?-1:1};
  if(out.__context?.active)out.__context.active.key=key(out.__context.active.key);
  const f=out.__filters?.[page];if(f){f.colFilters=Object.fromEntries(Object.entries(f.colFilters||{}).flatMap(([old,value])=>{const resolved=key(old);return resolved?[[resolved,value]]:[];}));f.selects=Object.fromEntries(Object.entries(f.selects||{}).filter(([id])=>filterIds.includes(id)));out.__filters.__page=page;}
  return out;
 }
 function rowBinding(row,{page,owner='',user='',fields}){
  const module=page==='koleksiyon'?'collection':page;
  return {page,user:String(user),workspace:String(owner),owner:String(row?._collectionOwnerId||owner),id:String(row?._collectionSourceId??row?.id??row?._id??''),identity:['orderCode','plmId','modelName','colourCode'].map(id=>fields?.canonicalValue?.(row,module,id)??'')};
 }
 function matchesRow(binding,row,options){return Boolean(binding?.identity?.some(value=>value!==''&&value!=null)&&JSON.stringify(binding)===JSON.stringify(rowBinding(row,options)));}
 function createResume({storage,user,allowed}){
  function read(){try{const raw=storage?.getItem(KEY);if(!raw||raw.length>MAX_BYTES)return null;const record=JSON.parse(raw);return record.version===VERSION&&record.user===String(user())&&typeof record.module==='string'?record:null;}catch(_){return null;}}
  function save(module,data=null){if(!user()||!allowed(module))return false;try{let record={version:VERSION,user:String(user()),module,data:clone(data)};if(JSON.stringify(record).length>MAX_BYTES)record.data=null;storage?.setItem(KEY,JSON.stringify(record));return true;}catch(_){return false;}}
  function target(explicit){if(explicit)return explicit;const record=read();return record&&allowed(record.module)?record.module:'overview';}
  return {read,save,target};
 }
 return {VERSION,KEY,pack,unpack,rowBinding,matchesRow,createResume};
});
