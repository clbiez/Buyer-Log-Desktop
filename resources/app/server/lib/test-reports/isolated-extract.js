'use strict';
const crypto=require('node:crypto'),Parser=require('../parser-process-client'),Policy=require('../../../public/file-parser-policy'),Engine=require('../../../public/test-report-engine');
async function processFiles(files,options={}){
 const results=[];
 const list=files||[];
 for(let index=0;index<list.length;){
  if(options.signal?.aborted)throw Policy.fail('FILE_PARSE_CANCELLED');
  const batch=[];let inputBytes=0,expandedBytes=0;
  while(index<list.length&&batch.length<Parser.REPORT_BATCH_FILES){
   const file=list[index],buffer=Buffer.from(file.buffer||[]),info=Policy.inspectBytes(buffer),expanded=info.expandedBytes||info.bytes;
   if(batch.length&&(inputBytes+buffer.length>Parser.REPORT_BATCH_BYTES||expandedBytes+expanded>Policy.LIMITS.expandedBytes))break;
   batch.push({name:file.name,buffer});inputBytes+=buffer.length;expandedBytes+=expanded;index++;
   if(inputBytes>Parser.REPORT_BATCH_BYTES)break;
  }
  const multi=batch.length>1;
  const {parsed,staged}=await Parser.run(multi?'test-report-batch':'test-report',multi?{files:batch}:batch[0],{signal:options.signal,priority:'background'});
  const ids=new Map();let bytes=0;
  for(const {id,file:entry} of staged){const value=Buffer.from(entry.buffer);bytes+=value.length;if(bytes>Policy.LIMITS.expandedBytes||crypto.createHash('sha256').update(value).digest('hex')!==entry.hash)throw Policy.fail('FILE_PARSE_RESULT');ids.set(id,typeof options.stage==='function'?options.stage({...entry,buffer:value}):null);}
  function remap(value){if(!value||typeof value!=='object')return;for(const key of Object.keys(value)){if((key==='stagingId'||key==='uploadId'||key==='fileId')&&ids.has(value[key])){const mapped=ids.get(value[key]);if(mapped)value[key]=mapped;else delete value[key];}else remap(value[key]);}}
  remap(parsed);results.push(...parsed.files);
 }
 return {files:results,reports:Engine.groupReports(results.flatMap(file=>file.reports||[]))};
}
module.exports={processFiles};
