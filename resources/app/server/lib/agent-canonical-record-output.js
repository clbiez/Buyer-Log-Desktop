'use strict';
const {object,string,array}=require('./agent-capability-contract'),canonical=require('./canonical-fields');
const MAX_BYTES=128*1024,MAX_VALUE=1000,MAX_FIELDS=1000,MAX_OMISSIONS=50,count={type:'integer',minimum:0},field=string(160),reasons=['unsupported-type','non-finite','invalid-date','value-limit'];
function outputSchema(source){return {...object({verified:{enum:[true]},data:{...object({source:{enum:[source]},total:count,matched:count,rows:array({type:'object',additionalProperties:{type:['string','number','boolean','null'],maxLength:MAX_VALUE}},250),truncated:{type:'boolean'},fields:array(field,MAX_FIELDS),fieldCount:count,fieldsTruncated:{type:'boolean'},selectedFields:array(field,MAX_FIELDS),selectedFieldCount:count,selectedFieldsTruncated:{type:'boolean'},omittedValueCount:count,omissions:array({...object({rowIndex:{type:'integer',minimum:0,maximum:249},field,reason:{enum:reasons}}),required:['rowIndex','field','reason']},MAX_OMISSIONS),omissionsTruncated:{type:'boolean'},valuesComplete:{type:'boolean'}}),required:['source','total','matched','rows','truncated','fields','fieldCount','fieldsTruncated','selectedFields','selectedFieldCount','selectedFieldsTruncated','omittedValueCount','omissions','omissionsTruncated','valuesComplete']}}),required:['verified','data']};}
function boundedFields(available){
 const fields=[];let bytes=0;
 for(const key of available){if(key.length>160)continue;const size=Buffer.byteLength(JSON.stringify(key))+1;if(fields.length>=MAX_FIELDS||bytes+size>16*1024)break;fields.push(key);bytes+=size;}
 return fields;
}
function projectRecords(source,allRows,matched,selectedFields,limit,formatDate){
 const available=canonical.moduleFields(source),fields=boundedFields(available),requested=[...new Set(selectedFields)],displayRequested=boundedFields(requested),data={source,total:allRows.length,matched:matched.length,rows:[],truncated:false,fields,fieldCount:available.length,fieldsTruncated:fields.length<available.length,selectedFields:displayRequested,selectedFieldCount:requested.length,selectedFieldsTruncated:displayRequested.length<requested.length,omittedValueCount:0,omissions:[],omissionsTruncated:false,valuesComplete:true};
 for(const native of matched.slice(0,limit)){
  const projected=canonical.project(native,source,requested),row={},issues=[];
  for(const [key,original]of Object.entries(projected)){
   let value=original,reason='';
   if(value instanceof Date){if(!Number.isFinite(value.getTime()))reason='invalid-date';else value=canonical.field(key)?.type==='datetime'?value.toISOString():formatDate(value);}
   if(!reason&&typeof value==='number'&&!Number.isFinite(value))reason='non-finite';
   if(!reason&&value!==null&&!['string','number','boolean'].includes(typeof value))reason='unsupported-type';
   if(!reason&&typeof value==='string'&&value.length>MAX_VALUE)reason='value-limit';
   if(reason)issues.push({rowIndex:data.rows.length,field:key,reason});else row[key]=value;
  }
  const next={...data,rows:[...data.rows,row],omittedValueCount:data.omittedValueCount+issues.length,omissions:[...data.omissions,...issues].slice(0,MAX_OMISSIONS),valuesComplete:data.valuesComplete&&!issues.length};next.omissionsTruncated=next.omittedValueCount>next.omissions.length;next.truncated=next.rows.length<matched.length;
  if(Buffer.byteLength(JSON.stringify(next))>MAX_BYTES)break;
  Object.assign(data,next);
 }
 data.truncated=data.rows.length<matched.length;
 return data;
}
module.exports={outputSchema,projectRecords,MAX_BYTES,MAX_VALUE};
