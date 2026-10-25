'use strict';
const crypto=require('node:crypto'),Parser=require('../parser-process-client'),Policy=require('../../../public/file-parser-policy'),Engine=require('../../../public/test-report-engine');
async function processFiles(files,options={}){
 const results=[];
 for(const file of files||[]){
  const buffer=Buffer.from(file.buffer||[]);Policy.inspectBytes(buffer);
  const {parsed,staged}=await Parser.run('test-report',{name:file.name,buffer},{signal:options.signal});
  const ids=new Map();let bytes=0;
  for(const {id,file:entry} of staged){const value=Buffer.from(entry.buffer);bytes+=value.length;if(bytes>Policy.LIMITS.expandedBytes||crypto.createHash('sha256').update(value).digest('hex')!==entry.hash)throw Policy.fail('FILE_PARSE_RESULT');ids.set(id,typeof options.stage==='function'?options.stage({...entry,buffer:value}):null);}
  function remap(value){if(!value||typeof value!=='object')return;for(const key of Object.keys(value)){if((key==='stagingId'||key==='uploadId'||key==='fileId')&&ids.has(value[key])){const mapped=ids.get(value[key]);if(mapped)value[key]=mapped;else delete value[key];}else remap(value[key]);}}
  remap(parsed);results.push(...parsed.files);
 }
 return {files:results,reports:Engine.groupReports(results.flatMap(file=>file.reports||[]))};
}
module.exports={processFiles};
