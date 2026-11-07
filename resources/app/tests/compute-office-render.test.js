'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createComputeService}=require('../server/lib/compute-service'),{createComputePool}=require('../server/lib/compute-pool');
const {createOutputService}=require('../server/lib/lcwai-output/output-service');
const MiB=1024*1024;
function workbook(){return {title:'Synthetic table',sheets:[{name:'Demo',columns:[{header:'Order',type:'text'},{header:'Quantity',type:'number'}],rows:[['DEMO-1',12],['DEMO-2',0]]}]};}
function formattedWorkbook(){const data=workbook();data.sheets[0].style={zebra:true,freezeColumns:1};Object.assign(data.sheets[0].columns[1],{total:'sum',bar:true,highlight:[{op:'>',value:10,tone:'risk'}]});return data;}
test('Office generation uses the common persistent pool and preserves canonical XLSX/PPTX bytes',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'buyerlog-office-compute-')),pool=createComputePool({maxWorkers:1,memoryBudgetBytes:768*MiB}),service=createComputeService({pool,root});
 t.after(async()=>{await service.close();fs.rmSync(root,{recursive:true,force:true});});
 const date=new Date('2026-11-05T12:00:00Z'),cases=[['xlsx',workbook(),require('../server/lib/lcwai-output/output-xlsx').renderWorkbook],['xlsx',formattedWorkbook(),require('../server/lib/lcwai-output/output-xlsx').renderWorkbook],['pptx',{title:'Synthetic deck',slides:[{layout:'title',title:'Demo',subtitle:'Synthetic'}]},require('../server/lib/lcwai-output/output-pptx').renderPresentation]];let thread;
 for(const [format,raw,render] of cases){
  const contracts=require('../server/lib/lcwai-output/output-contracts'),normalized=format==='xlsx'?contracts.normalizeWorkbook(raw,{lang:'en'}):contracts.normalizePresentation(raw,{lang:'en'});assert.equal(normalized.ok,true);const data=normalized.data;
  const options={lang:'en',date,images:{},records:{}},lease=await service.runOffice('a',{format,data,options});
  try{assert.deepEqual(Buffer.from(lease.value.buffer),render(data,options));if(thread)assert.equal(lease.metrics.threadId,thread);thread=lease.metrics.threadId;assert.ok(pool.stats().leasedOutputBytes>0);assert.ok(lease.metrics.paramsBytes>0);}finally{lease.release();}
 }
 assert.equal(pool.stats().workerCount,1);assert.equal(pool.stats().leasedOutputBytes,0);
 await assert.rejects(service.runOffice('a',{format:'html',data:{},options:{}}),{code:'COMPUTE_JOB_INVALID'});
});
test('output service keeps the Office lease through async save and checks current authorization before writing',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'buyerlog-office-output-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 let complete,releases=0,valid=true,called;
 const compute={runOffice:(owner,job)=>{called={owner,job};return new Promise(resolve=>{complete=resolve;});}};
 const service=createOutputService({compute:()=>compute,storeOptions:{root:path.join(root,'files')},now:()=>new Date('2026-11-05T12:00:00Z')});
 const pending=service.createTable('a',{data:workbook(),lang:'en',assertCurrent:()=>{if(!valid)throw Error('Synthetic access revoked');}});
 assert.ok(pending instanceof Promise);assert.equal(service.list('a').length,0);assert.equal(called.owner,'a');assert.equal(called.job.format,'xlsx');
 valid=false;complete({value:{buffer:Uint8Array.from(Buffer.from('PK Synthetic Office')).buffer},release:()=>{releases++;}});
 await assert.rejects(pending,/Synthetic access revoked/);assert.equal(service.list('a').length,0);assert.equal(releases,1);
});
