'use strict';
const {object,string}=require('./agent-capability-contract'),{validate}=require('./agent-tool-schema');
const id={...string(24),pattern:'^[a-f0-9]{24}$'},requestId={...string(64),pattern:'^[a-f0-9]{64}$'};
const file={...object({id,fileName:{...string(180),minLength:1},format:{enum:['html','xlsx','pdf']},bytes:{type:'integer',minimum:1},requestId}),required:['id','fileName','format','bytes','requestId']};
const pending={...object({pendingId:id,format:{enum:['pdf']},requestId}),required:['pendingId','format','requestId']};
const verified={enum:[true]},completed={...object({verified,output:file}),required:['verified','output']};
const waiting={...object({verified,completionPending:{enum:['pdf']},output:pending}),required:['verified','completionPending','output']};
const fallback={...object({verified,output:{...file,properties:{...file.properties,format:{enum:['html']}}},fallback:{enum:['html']},requestedFormat:{enum:['pdf']}}),required:['verified','output','fallback','requestedFormat']};
const outputSchema={...object({verified,output:{type:'object'},completionPending:{enum:['pdf']},fallback:{enum:['html']},requestedFormat:{enum:['pdf']}}),required:['verified','output'],anyOf:[completed,waiting,fallback]};
function fileResult(record,{fallback=false}={}){
 const result={verified:true,output:{id:record.id,fileName:record.fileName,format:record.format,bytes:record.bytes,requestId:record.requestId},...(fallback?{fallback:'html',requestedFormat:'pdf'}:{})};
 validate(outputSchema,result);return result;
}
function pendingResult(pendingId,requestId){const result={verified:true,completionPending:'pdf',output:{pendingId,format:'pdf',requestId}};validate(outputSchema,result);return result;}
module.exports={outputSchema,fileResult,pendingResult};
