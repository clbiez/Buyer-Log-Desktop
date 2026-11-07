'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {Worker}=require('node:worker_threads'),{createComputePool}=require('../server/lib/compute-pool'),{createComputeService}=require('../server/lib/compute-service');
const MiB=1024*1024;
function setup(t){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'buyerlog-compute-utility-')),workers=[];
  class ObservedWorker extends Worker{constructor(...args){super(...args);workers.push(this);}}
  const pool=createComputePool({WorkerClass:ObservedWorker,maxWorkers:2,memoryBudgetBytes:512*MiB,maxPendingBytes:128*MiB});
  const service=createComputeService({pool,root});t.after(async()=>{await service.close();fs.rmSync(root,{recursive:true,force:true});});return {service,workers,root};
}
test('pool startup warms its existing worker slots and repeated FX checks create no more threads',async t=>{
  const {service,workers,root}=setup(t);await service.warm();assert.equal(workers.length,2);assert.equal(service.stats().workerCount,2);
  const a=await service.runExcelUtility('loadFxWorkbookFromDirectories',{directories:[root],current:{}},{ownerId:'a'});
  const b=await service.runExcelUtility('loadFxWorkbookFromDirectories',{directories:[root],current:{}},{ownerId:'a'});
  try{assert.deepEqual(a.value,{found:false,updated:false,reason:'KUR Excel bulunamadı'});assert.deepEqual(b.value,a.value);assert.equal(a.metrics.threadId,b.metrics.threadId);assert.equal(workers.length,2);}
  finally{a.release();b.release();}
});
test('FX preview retains the existing sparse date-aware workbook contract and reads changed bytes afresh',async t=>{
  const {service,root}=setup(t),XLSX=require('xlsx'),fx=require('../server/lib/fxWorkbook'),file=path.join(root,'KUR.xlsx');
  function write(value){const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet([['Currency','Jan 2026'],['USD',1],['EUR',value]]),'Rates');XLSX.writeFile(wb,file);}
  for(const value of [1.12,1.25]){
    write(value);const expected=fx.previewFxWorkbook(file),stat=fs.statSync(file);
    const lease=await service.runExcelUtility('previewFxWorkbookFromDirectories',{directories:[root]},{ownerId:'a'});
    try{assert.deepEqual(lease.value,{...expected,fileName:'KUR.xlsx',sourceModifiedAt:new Date(stat.mtimeMs).toISOString()});}
    finally{lease.release();}
  }
});
test('utility API cannot bypass raw-source admission with arbitrary Excel task names',async t=>{
  const {service,workers}=setup(t);
  await assert.rejects(service.runExcelUtility('parseAsasFile',{fullPath:'SYNTHETIC_PRIVATE_PATH'},{ownerId:'a'}),{code:'COMPUTE_JOB_INVALID'});assert.equal(workers.length,0);
});
