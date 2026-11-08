'use strict';
const crypto=require('node:crypto'),Policy=require('../../public/file-parser-policy');
process.once('message',async({operation,payload})=>{try{
 const limits=['endeksmatik','endeksmatik-legacy'].includes(operation)?Policy.ENDEKSMATIK_LIMITS:Policy.LIMITS;
 require('../lib/workbook-parser-guards').install(require('xlsx'),{limits});
 const buffer=Buffer.from(payload?.buffer||[]);let result;
 const batch=operation==='test-report-batch'?payload?.files:null;
 if(operation==='test-report-batch'){
  const {REPORT_BATCH_FILES,REPORT_BATCH_BYTES}=require('../lib/parser-process-client');
  if(!Array.isArray(batch)||!batch.length||batch.length>REPORT_BATCH_FILES)throw Policy.fail();
  let bytes=0,expanded=0;
  for(const file of batch){const info=require('../lib/zip-parser-validation').verify(Buffer.from(file.buffer),limits);bytes+=file.buffer.byteLength;expanded+=info.expandedBytes||file.buffer.byteLength;}
  if(bytes>REPORT_BATCH_BYTES||expanded>limits.expandedBytes)throw Policy.fail();
 }else require('../lib/zip-parser-validation').verify(buffer,limits);
 if(operation==='endeksmatik')result=require('../lib/endeksmatik').parseImportWorkbook(buffer,payload.name);
 else if(operation==='endeksmatik-legacy')result=require('../lib/endeksmatik').parseWorkbookBuffer(buffer,payload.name);
 else if(operation==='test-report'||operation==='test-report-batch'){
  const staged=[];let bytes=0;
  const parsed=await require('../lib/test-reports/extract').processFilesInline(batch||[{name:payload.name,buffer}],{stage:file=>{bytes+=file.buffer.length;if(staged.length>=200||bytes>Policy.LIMITS.expandedBytes)throw Policy.fail();const id=crypto.randomBytes(12).toString('hex');staged.push({id,file});return id;}});
  result={parsed,staged};
 }else if(operation==='iam')result=require('../lib/iam-excel').readUserRows(buffer);
 else if(operation==='merch-calendar')result=require('../lib/merch-calendar-store').parseBuffer(buffer,payload.name);
 else if(operation==='connection-discovery')result=require('../lib/excel-connection-discovery').discoverBuffer(buffer,{workbookName:payload.name});
 else throw Policy.fail('FILE_PARSE_OPERATION');
 process.send({ok:true,result});
}catch(error){process.send({ok:false,error:{code:error.code,message:error.message,statusCode:error.statusCode,details:error.details}});}});
