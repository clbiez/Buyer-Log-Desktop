'use strict';
const {object,string,array}=require('./agent-capability-contract');
const MAX_BYTES=128*1024,MAX_VALUE=1000,count={type:'integer',minimum:0},field=string(160),scalar={type:['string','number','boolean','null'],maxLength:MAX_VALUE};
const measure={...object({op:{enum:['count','sum','avg','min','max','distinctCount']},field:{...field,type:['string','null']},as:string(64)}),required:['op','field','as']};
const scope={...object({horizonSeasons:array(field,100),outsideHorizon:{type:'boolean'},outsideSeasons:array(field,100),policy:field}),required:['horizonSeasons','outsideHorizon','outsideSeasons','policy']};
const hint=object({fields:array(object({field,label:string(300),requested:{anyOf:[scalar,array(scalar,100)]},actualValues:array(string(MAX_VALUE),25)}),50),note:string(MAX_VALUE)});
function outputSchema(source){const data={...object({source:{enum:[source]},matchedRows:count,groupCount:count,rawRowsReturned:{enum:[0]},dimensions:array(field,5),measures:array(measure,8),currencies:array(field,20),currencyListAtNativeLimit:{type:'boolean'},context:object({source:{enum:[source]},refreshedAt:{type:['string','null'],maxLength:40},rowCount:count,dataSource:{type:['string','null'],maxLength:160}}),scope,noMatchHint:hint,metadataTruncated:{type:'boolean'},rows:array({type:'object',additionalProperties:scalar},500),engineTruncated:{type:'boolean'},truncated:{type:'boolean'},omittedValueCount:count,omissions:array({...object({rowIndex:{type:'integer',minimum:0,maximum:499},field:string(512),fieldTruncated:{type:'boolean'},reason:{enum:['non-finite','value-limit','unsupported-type','unsafe-key']}}),required:['rowIndex','field','fieldTruncated','reason']},50),omissionsTruncated:{type:'boolean'},valuesComplete:{type:'boolean'}}),required:['source','matchedRows','groupCount','rawRowsReturned','dimensions','measures','currencies','currencyListAtNativeLimit','context','scope','metadataTruncated','rows','engineTruncated','truncated','omittedValueCount','omissions','omissionsTruncated','valuesComplete']};return {...object({verified:{enum:[true]},data}),required:['verified','data']};}
function project(report){
 const data={source:report.source,matchedRows:report.matchedRows,groupCount:report.groupCount,rawRowsReturned:report.rawRowsReturned,dimensions:[],measures:[],currencies:[],currencyListAtNativeLimit:report.currencies.length===20,context:{source:report.source},scope:{horizonSeasons:[],outsideHorizon:!!report.scope?.outsideHorizon,outsideSeasons:[],policy:'allow'},metadataTruncated:false,rows:[],engineTruncated:!!report.truncated,truncated:false,omittedValueCount:0,omissions:[],omissionsTruncated:false,valuesComplete:true};
 const strings=(values,limit,max)=>{const result=[];let bytes=0;for(const value of values||[]){if(typeof value!=='string'||value.length>max){data.metadataTruncated=true;continue;}const size=Buffer.byteLength(JSON.stringify(value))+1;if(result.length>=limit||bytes+size>4096){data.metadataTruncated=true;break;}result.push(value);bytes+=size;}return result;};
 data.dimensions=strings(report.dimensions,5,160);data.currencies=strings(report.currencies,20,160);
 for(const m of report.measures){if(typeof m.as==='string'&&m.as.length<=64&&(m.field===null||typeof m.field==='string'&&m.field.length<=160))data.measures.push({op:m.op,field:m.field,as:m.as});else data.metadataTruncated=true;}
 const context=report.context||{};for(const [key,value]of Object.entries(context)){
  if(key==='source')continue;
  if(key==='refreshedAt'&&(value===null||typeof value==='string'&&value.length<=40)||key==='rowCount'&&Number.isSafeInteger(value)&&value>=0||key==='dataSource'&&(value===null||typeof value==='string'&&value.length<=160))data.context[key]=value;else data.metadataTruncated=true;
 }
 data.scope.horizonSeasons=strings(report.scope?.horizonSeasons,100,160);data.scope.outsideSeasons=strings(report.scope?.outsideSeasons,100,160);
 if(typeof report.scope?.policy==='string'&&report.scope.policy.length<=160)data.scope.policy=report.scope.policy;else if(report.scope?.policy!=null)data.metadataTruncated=true;
 if(report.noMatchHint){
  const fields=[];for(const item of report.noMatchHint.fields||[]){if(typeof item.field!=='string'||item.field.length>160||typeof item.label!=='string'||item.label.length>300){data.metadataTruncated=true;continue;}
   const shown={field:item.field,label:item.label,actualValues:strings(item.actualValues,25,MAX_VALUE)},validScalar=v=>v===null||typeof v==='string'&&v.length<=MAX_VALUE||typeof v==='number'&&Number.isFinite(v)||typeof v==='boolean';
   if((validScalar(item.requested)||Array.isArray(item.requested)&&item.requested.length<=100&&item.requested.every(validScalar))&&Buffer.byteLength(JSON.stringify(item.requested))<=4096)shown.requested=item.requested;else data.metadataTruncated=true;
   if(fields.length>=50||Buffer.byteLength(JSON.stringify([...fields,shown]))>12*1024){data.metadataTruncated=true;break;}fields.push(shown);
  }
  data.noMatchHint={fields:fields.slice(0,50)};if(fields.length>50)data.metadataTruncated=true;
  if(typeof report.noMatchHint.note==='string'&&report.noMatchHint.note.length<=MAX_VALUE)data.noMatchHint.note=report.noMatchHint.note;else data.metadataTruncated=true;
 }
 for(const native of report.rows){
  const row={},issues=[];for(const [key,value]of Object.entries(native)){let reason='';if(['__proto__','constructor','prototype'].includes(key))reason='unsafe-key';else if(typeof value==='number'&&!Number.isFinite(value))reason='non-finite';else if(value!==null&&!['string','number','boolean'].includes(typeof value))reason='unsupported-type';else if(typeof value==='string'&&value.length>MAX_VALUE)reason='value-limit';
   if(reason)issues.push({rowIndex:data.rows.length,field:key.slice(0,512),fieldTruncated:key.length>512,reason});else row[key]=value;
  }
  const next={...data,rows:[...data.rows,row],omittedValueCount:data.omittedValueCount+issues.length,omissions:[...data.omissions,...issues].slice(0,50),valuesComplete:data.valuesComplete&&!issues.length};next.omissionsTruncated=next.omittedValueCount>next.omissions.length;next.truncated=data.engineTruncated||next.rows.length<report.rows.length;
  if(Buffer.byteLength(JSON.stringify(next))>MAX_BYTES)break;Object.assign(data,next);
 }
 data.truncated=data.engineTruncated||data.rows.length<report.rows.length;return data;
}
module.exports={outputSchema,project};
