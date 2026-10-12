'use strict';
const {object,string,array}=require('./agent-capability-contract'),{validate}=require('./agent-tool-schema');
const count={type:'integer',minimum:0},fingerprint={...string(64),pattern:'^[a-f0-9]{64}$'},required=properties=>({...object(properties),required:Object.keys(properties)}),field=required({canonicalId:{type:['string','null'],maxLength:160},sourceKey:string(512),label:string(512),role:string(80),type:string(80),observedTypes:array({enum:['string','number','boolean','object','array','date','undefined','function','symbol','bigint']},4),populatedInSample:{type:'integer',minimum:0,maximum:20}});
const inputSchema=object({offset:{type:'integer',minimum:0,maximum:1000000},limit:{type:'integer',minimum:1,maximum:300},sourceFingerprint:fingerprint});
function outputSchema(source){return required({verified:{enum:[true]},data:required({source:{enum:[source]},sourceFingerprint:fingerprint,rows:count,empty:{type:'boolean'},sampledRows:{type:'integer',minimum:0,maximum:120},fieldCount:count,offset:count,nextOffset:count,fields:array(field,300),truncated:{type:'boolean'},omittedFieldCount:count,omissions:array(required({index:count,reason:{enum:['unsupported-metadata','envelope-limit']}}),50),omissionsTruncated:{type:'boolean'},metadataTruncated:{type:'boolean'},context:object({source:{enum:[source]},refreshedAt:{type:['string','null'],maxLength:40},rowCount:count,dataSource:{type:['string','null'],maxLength:160}}),scope:required({horizonSeasons:array(string(160),100),outsideHorizon:{type:'boolean'},outsideSeasons:array(string(160),100),policy:string(160)})})});}
function project(native,args={}){
 const offset=args.offset||0,limit=args.limit||100,data={source:native.source,sourceFingerprint:native.sourceFingerprint,rows:native.rows,empty:native.rows===0,sampledRows:native.sampledRows,fieldCount:native.fields.length,offset,nextOffset:offset,fields:[],truncated:false,omittedFieldCount:0,omissions:[],omissionsTruncated:false,metadataTruncated:false,context:{source:native.source},scope:{horizonSeasons:[],outsideHorizon:!!native.scope?.outsideHorizon,outsideSeasons:[],policy:'allow'}};
 for(const [key,value]of Object.entries(native.context||{})){
  if(key==='source')continue;
  if(key==='refreshedAt'&&(value===null||typeof value==='string'&&value.length<=40)||key==='rowCount'&&Number.isSafeInteger(value)&&value>=0||key==='dataSource'&&(value===null||typeof value==='string'&&value.length<=160))data.context[key]=value;else data.metadataTruncated=true;
 }
 for(const key of ['horizonSeasons','outsideSeasons'])for(const value of native.scope?.[key]||[]){if(typeof value==='string'&&value.length<=160&&data.scope[key].length<100&&Buffer.byteLength(JSON.stringify(data.scope[key]))+Buffer.byteLength(value)<4096)data.scope[key].push(value);else data.metadataTruncated=true;}
 if(typeof native.scope?.policy==='string'&&native.scope.policy.length<=160)data.scope.policy=native.scope.policy;else if(native.scope?.policy!=null)data.metadataTruncated=true;
 for(let i=offset;i<native.fields.length&&i<offset+limit;i++){
  const value=native.fields[i];let reason='';try{validate(field,value);}catch(_){reason='unsupported-metadata';}
  if(!reason&&Buffer.byteLength(JSON.stringify({...data,fields:[...data.fields,value]}))>120*1024){reason='envelope-limit';}
  if(reason){data.omittedFieldCount++;if(data.omissions.length<50)data.omissions.push({index:i,reason});else data.omissionsTruncated=true;}else data.fields.push(value);
  data.nextOffset=i+1;
 }
 data.truncated=data.nextOffset<native.fields.length;return data;
}
module.exports={inputSchema,outputSchema,project};
