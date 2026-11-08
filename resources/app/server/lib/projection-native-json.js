'use strict';
// Private input contract: already-parsed date-safe JSON; not an arbitrary-graph validator.
const {gzip}=require('node:zlib'),{promisify}=require('node:util');
function serializeThin(fullWire,options){
 const {columnDefs,plan,contextKey,fullJson}=options&&typeof options==='object'?options:{};
 const fallback=reason=>({kind:'legacy',reason,fullWire,fullJson});
 if(!plan||plan.version!==1||plan.mode!=='explicit-hidden-model-keys'||plan.dependencyClosureKnown!==true
  ||typeof contextKey!=='string'||!contextKey||plan.contextKey!==contextKey||!Array.isArray(plan.omittedKeys)
  ||plan.omittedKeys.length>64||new Set(plan.omittedKeys).size!==plan.omittedKeys.length)return fallback('UNKNOWN_OR_INVALID_PLAN');
 if(!fullWire||typeof fullWire!=='object'||!Array.isArray(fullWire.rows)||fullWire.rows.length>50000
  ||fullWire.rows.some(row=>!row||typeof row!=='object'||Array.isArray(row)))return fallback('UNSUPPORTED_PARSED_ROWS');
 if(!Array.isArray(columnDefs)||columnDefs.length>512)return fallback('UNKNOWN_REGISTRATION');
 const registered=new Map();
 for(const definition of columnDefs){
  if(!definition||typeof definition!=='object'||typeof definition.k!=='string'||registered.has(definition.k))return fallback('AMBIGUOUS_REGISTRATION');
  registered.set(definition.k,definition);
 }
 for(const key of plan.omittedKeys){
  const definition=registered.get(key);
  if(typeof key!=='string'||key.length>256||!key.startsWith('__CPX_')||!definition
   ||definition.modelCustom!==true||definition.hidden!==true)return fallback('NOT_EXPLICIT_REGISTERED_HIDDEN_MODEL');
 }
 const rows=new WeakSet(fullWire.rows),omitted=new Set(plan.omittedKeys);
 const json=JSON.stringify(fullWire,function(key,value){return rows.has(this)&&omitted.has(key)?undefined:value;});
 return {kind:'thin-json',json,rowCount:fullWire.rows.length,omittedKeys:[...plan.omittedKeys]};
}
async function buildThinGzip(fullWire,options){
 const selected=serializeThin(fullWire,options);if(selected.kind==='legacy')return selected;
 const buffer=await promisify(gzip)(Buffer.from(selected.json,'utf8'),{level:4});
 return {kind:'thin',buffer,rawBytes:Buffer.byteLength(selected.json),rowCount:selected.rowCount,omittedKeys:selected.omittedKeys};
}
module.exports=Object.freeze({serializeThin,buildThinGzip});
