'use strict';
const {object,string,array}=require('./agent-capability-contract'),{validate}=require('./agent-tool-schema');
const req=properties=>({...object(properties),required:Object.keys(properties)}),count={type:'integer',minimum:0},flag={type:'boolean'},field=string(160),scalar={type:['string','number','boolean','null'],maxLength:1000},fingerprint={...string(64),pattern:'^[a-f0-9]{64}$'};
const common={sourceFingerprint:fingerprint,groupCount:count,rows:array({type:'object',additionalProperties:scalar},250),nativeTruncated:flag,truncated:flag,omittedRowCount:count,omittedValueCount:count,omissions:array(req({path:string(300),reason:{enum:['unsupported-type','non-finite','value-limit','unsafe-key','metadata-limit']}}),50),omissionsTruncated:flag,valuesComplete:flag,metadataTruncated:flag};
const supplier={matchedRows:count,observations:count,dimensions:array(field,5),metrics:array(field,8),currencies:array(field,20),currencyCount:count,currenciesTruncated:flag,excludedCalculations:{...count,type:['integer','null']},calculationIssues:array(req({recordId:string(160),code:{enum:['TR_ROYALTY_RULE_MISSING','FX_MISSING','TR_PRICE_MISSING','ROYALTY_RULE_MISSING','SUPPLIER_PRICE_MISSING','PRICE_MISSING']}}),50),calculationIssuesTruncated:flag,cpContextAvailable:{type:['boolean','null']},derivedCalculation:flag};
const lfl=Object.fromEntries(['currentRows','referenceRows','comparableCurrentRows','comparableReferenceRows','excludedCurrentRows','excludedReferenceRows'].map(key=>[key,count]));
const numeric={type:['number','null']},nullableText={type:['string','null'],maxLength:1000};
function rowSchema(kind){const properties=kind==='supplier'?Object.fromEntries(['weightedAverage','average','median','min','max','totalQuantity','totalAmount','modelCount','recordCount'].flatMap(key=>[[key,numeric],[key+'Currency',nullableText],[key+'Mixed',{type:'boolean'}]])):{...Object.fromEntries(['currentAverage','referenceAverage','currentQuantity','referenceQuantity','changePercent','improvementPercent'].map(key=>[key,numeric])),mbMonth:string(2),currency:string(160)};return {type:'object',properties,additionalProperties:scalar};}
function outputSchema(kind){return req({verified:{enum:[true]},data:req({...common,rows:array(rowSchema(kind),250),...(kind==='supplier'?supplier:lfl)})});}
function project(kind,report,sourceFingerprint){
 const data={sourceFingerprint,groupCount:report.groupCount,rows:[],nativeTruncated:!!report.truncated,truncated:false,omittedRowCount:0,omittedValueCount:0,omissions:[],omissionsTruncated:false,valuesComplete:true,metadataTruncated:false};
 function omit(path,reason){data.omittedValueCount++;if(data.omissions.length<50)data.omissions.push({path:path.slice(0,300),reason});else data.omissionsTruncated=true;data.valuesComplete=false;}
 function strings(values,limit,path){const result=[];let bytes=0;for(const [i,value]of (values||[]).entries()){const size=Buffer.byteLength(JSON.stringify(value)??'');if(typeof value!=='string'||value.length>160||result.length>=limit||bytes+size>4096){data.metadataTruncated=true;omit(path+'['+i+']','metadata-limit');continue;}result.push(value);bytes+=size;}return result;}
 if(kind==='supplier'){
  Object.assign(data,{matchedRows:report.matchedRows,observations:report.observations,dimensions:strings(report.dimensions,5,'dimensions'),metrics:strings(report.metrics,8,'metrics'),currencies:strings(report.currencies,20,'currencies'),currencyCount:report.currencies.length,currenciesTruncated:false,excludedCalculations:report.excludedCalculations??null,calculationIssues:[],calculationIssuesTruncated:!!report.calculationIssuesTruncated,cpContextAvailable:report.cpContextAvailable??null,derivedCalculation:report.excludedCalculations!==undefined});
  data.currenciesTruncated=data.currencies.length<data.currencyCount;
  for(const [i,item]of (report.calculationIssues||[]).entries()){try{validate(supplier.calculationIssues.items,item);if(data.calculationIssues.length>=50)throw Error('limit');data.calculationIssues.push({...item});}catch(_){omit('calculationIssues['+i+']','metadata-limit');data.calculationIssuesTruncated=true;data.metadataTruncated=true;}}
 }else for(const key of Object.keys(lfl))data[key]=report[key];
 for(const [i,native]of report.rows.entries()){
  const row={};for(const [key,original]of Object.entries(native)){
   let value=original,reason='';if(['__proto__','prototype','constructor'].includes(key)||key.length>160)reason='unsafe-key';else if(typeof value==='number'&&!Number.isFinite(value))reason='non-finite';else if(value!==null&&!['string','number','boolean'].includes(typeof value))reason='unsupported-type';else if(typeof value==='string'&&value.length>1000)reason='value-limit';
   if(reason){omit('rows['+i+'].'+key,reason);if(reason!=='unsafe-key')row[key]=null;}else row[key]=value;
  }
  if(data.rows.length>=250||Buffer.byteLength(JSON.stringify({verified:true,data:{...data,rows:[...data.rows,row]}}))>120*1024)break;data.rows.push(row);
 }
 data.omittedRowCount=Math.max(0,report.groupCount-data.rows.length);data.truncated=data.nativeTruncated||data.omittedRowCount>0;validate(outputSchema(kind),{verified:true,data});return data;
}
module.exports={outputSchema,project};
