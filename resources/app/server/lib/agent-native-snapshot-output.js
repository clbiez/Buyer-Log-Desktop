'use strict';
const {validate}=require('./agent-tool-schema'),Intake=require('./intake-report');
const {object,string,array}=require('./agent-capability-contract'),{hash,error}=require('./agent-office-store');
const MAX_BYTES=128*1024,ROW_BYTES=16*1024,count={type:'integer',minimum:0},flag={type:'boolean'},fingerprint={...string(64),pattern:'^[a-f0-9]{64}$'},required=properties=>({...object(properties),required:Object.keys(properties)});
const input=object({fields:array({...string(160),minLength:1},200),offset:count,limit:{type:'integer',minimum:1,maximum:250},fieldOffset:count,sourceFingerprint:fingerprint});
const fieldInfo=required({field:string(160),label:string(500),kind:{enum:['dimension','measure','unknown']},aggregate:{enum:[null,...Intake.INTAKE_AGGREGATES]},weightFieldId:{type:['string','null'],maxLength:160}});
const issue=required({rowIndex:{type:'integer',minimum:0,maximum:249},field:string(160),reason:{enum:['non-scalar','value-limit','context-budget','unsupported-row']}});
function outputSchema(source){return required({verified:{enum:[true]},data:required({source:{enum:[source]},origin:{enum:['native-owner-snapshot']},available:flag,sourceFingerprint:fingerprint,savedAt:{type:['string','null'],maxLength:80},fetchedAt:{type:['string','null'],maxLength:80},total:count,offset:count,nextOffset:count,hasMore:flag,rows:array({type:'object',additionalProperties:{type:['string','number','boolean','null'],maxLength:1000}},250),fields:array(string(160),200),fieldCount:count,fieldOffset:count,nextFieldOffset:count,fieldsHasMore:flag,omittedFieldCount:count,selectedFields:array(string(160),200),fieldMetadata:array(fieldInfo,200),fieldMetadataCount:count,fieldMetadataTruncated:flag,omittedValueCount:count,omissions:array(issue,50),omissionsTruncated:flag,valuesComplete:flag})});}
const safeField=key=>typeof key==='string'&&key.length>0&&key.length<=160&&!['__proto__','prototype','constructor'].includes(key);
function nativeFieldInfo(source,snapshot,keys){
 const byId=new Map(),config=snapshot?.viewConfig;
 if(source==='intake'&&config?.query){
  const fields=['rows','columns','measures'].flatMap(group=>Array.isArray(config.query[group])?config.query[group]:[]);
  fields.push(...Intake.intakeWeightFields(config,null));for(const field of fields){const native=field&&Intake.createField(field);if(native&&!byId.has(native.id))byId.set(native.id,native);}
 }
 return keys.map(key=>{const native=byId.get(key);return {field:key,label:native?Intake.displayLabel(config,native):key,kind:native?.fieldType||'unknown',aggregate:native?.agg||null,weightFieldId:native?.weightId||null};});
}
function project(source,snapshot,args){
 if(Buffer.byteLength(JSON.stringify(args.fields||[]))>16*1024)throw error('OFFICE_TOOL_SCHEMA',422);
 const timestamp=value=>{if(value==null)return null;if(typeof value!=='string'||value.length>80)throw error('OFFICE_TOOL_SCHEMA',422);return value;},savedAt=timestamp(snapshot?.savedAt),fetchedAt=timestamp(snapshot?.fetchedAt);
 const rows=Array.isArray(snapshot?.rows)?snapshot.rows:[],keys=new Set((snapshot?.fields||[]).filter(key=>typeof key==='string'));
 for(const row of rows)if(row&&typeof row==='object'&&!Array.isArray(row))for(const key of Object.keys(row))keys.add(key);
 const available=[...keys],sourceFingerprint=hash(JSON.stringify({source,rows,fields:available,metadata:nativeFieldInfo(source,snapshot,available),savedAt:snapshot?.savedAt||null,fetchedAt:snapshot?.fetchedAt||null}));
 if(args.sourceFingerprint!==undefined&&sourceFingerprint!==args.sourceFingerprint)throw error('OFFICE_PREVIEW_CHANGED',409);
 if(args.fields?.length&&args.fieldOffset!==undefined||new Set(args.fields||[]).size!==(args.fields||[]).length)throw error('OFFICE_TOOL_SCHEMA',422);
 if(args.fields?.some(key=>!keys.has(key)||!safeField(key)))throw error('OFFICE_FIELD_INVALID',422);
 const offset=args.offset||0,fieldOffset=args.fieldOffset||0,fieldPage=[],fields=[];let fieldBytes=0;
 for(const key of available.slice(fieldOffset)){if(fieldPage.length>=200)break;const bytes=Buffer.byteLength(JSON.stringify(key))+1;if(safeField(key)&&fieldBytes+bytes>8*1024)break;fieldPage.push(key);if(safeField(key)){fields.push(key);fieldBytes+=bytes;}}
 const selected=args.fields?.length?args.fields:fields,allMetadata=nativeFieldInfo(source,snapshot,selected),fieldMetadata=[];let metadataBytes=0;
 for(const item of allMetadata){const bytes=Buffer.byteLength(JSON.stringify(item));if(item.label.length>500||metadataBytes+bytes>16*1024)continue;metadataBytes+=bytes;fieldMetadata.push(item);}
 const data={source,origin:'native-owner-snapshot',available:!!snapshot,sourceFingerprint,savedAt,fetchedAt,total:rows.length,offset,nextOffset:offset,hasMore:offset<rows.length,rows:[],fields,fieldCount:available.length,fieldOffset,nextFieldOffset:fieldOffset+fieldPage.length,fieldsHasMore:fieldOffset+fieldPage.length<available.length,omittedFieldCount:available.filter(key=>!safeField(key)).length,selectedFields:selected,fieldMetadata,fieldMetadataCount:allMetadata.length,fieldMetadataTruncated:fieldMetadata.length<allMetadata.length,omittedValueCount:0,omissions:[],omissionsTruncated:false,valuesComplete:!!args.fields?.length||available.every(safeField)};
 for(const row of rows.slice(offset,offset+(args.limit||50))){
  const projected={},issues=[],index=data.rows.length;
  if(!row||typeof row!=='object'||Array.isArray(row))issues.push({rowIndex:index,field:'',reason:'unsupported-row'});
  else for(const key of selected){if(!Object.hasOwn(row,key))continue;const value=row[key];let reason='';
   if(value!==null&&(!['string','number','boolean'].includes(typeof value)||typeof value==='number'&&!Number.isFinite(value)))reason='non-scalar';
   else if(typeof value==='string'&&value.length>1000)reason='value-limit';
   else if(Buffer.byteLength(JSON.stringify({...projected,[key]:value}))>ROW_BYTES)reason='context-budget';
   if(reason)issues.push({rowIndex:index,field:key,reason});else projected[key]=value;
  }
  const returned=[...data.rows,projected],next={...data,rows:returned,nextOffset:offset+returned.length,hasMore:offset+returned.length<rows.length,omittedValueCount:data.omittedValueCount+issues.length,omissions:[...data.omissions,...issues].slice(0,50),valuesComplete:data.valuesComplete&&!issues.length};next.omissionsTruncated=next.omittedValueCount>next.omissions.length;
  if(Buffer.byteLength(JSON.stringify({verified:true,data:next}))>MAX_BYTES)break;Object.assign(data,next);
 }
 validate(outputSchema(source),{verified:true,data});return data;
}
module.exports={input,outputSchema,project,MAX_BYTES};
