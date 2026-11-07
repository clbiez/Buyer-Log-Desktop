'use strict';
// Faz 5 B1 FX tanısı (clbiez/Buyer-Log-Desktop#893): otomatik
// klasör KUR okuması ortak compute havuzuna verildiğinde, iki worker 5 sn'den
// uzun projeksiyonlarla doluyken 5000 ms bütçe işe hiç başlanmadan kuyrukta
// doldu; geçerli KUR eski revizyonda kaldı. Main'in ayrı Excel worker yolu aynı
// yük altında 18/18 başarılıydı. FX bu nedenle ayrı Excel worker'da kalır ve
// ortak havuzun doluluğu kur güncellemesini engellemez.
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),path=require('node:path');
const {extractFunction}=require('./helpers/app-main-functions'),source=require('./helpers/server-source')();

function harness(runExcelTask){
  const calls={pool:0};
  const context={require:require('node:module').createRequire(path.join(__dirname,'../server/server.js')),__dirname:path.join(__dirname,'../server'),path,
    sourceUserId:()=> 'a',sourceFolderForUser:()=> '/synthetic/source',loadFx:()=>({_revision:1}),folderFxSyncStatus:null,runExcelTask,
    // Doygun ortak havuz: kabul edilen iş hiç başlamaz.
    serverCompute:()=>({runExcelUtility:()=>{calls.pool++;return new Promise(()=>{});},run:()=>{calls.pool++;return new Promise(()=>{});}}),
    logRuntimeFailure:(_key,error)=>{throw error;}};
  vm.createContext(context);vm.runInContext(extractFunction(source,'syncFxFromKurWorkbook')+';globalThis.run=syncFxFromKurWorkbook;',context);
  return {context,calls};
}

test('automatic folder FX uses the dedicated Excel worker and is not starved by a saturated compute pool',async()=>{
  const seen=[];
  const {context,calls}=harness(async(task,payload,options)=>{seen.push({task,payload,options});return {found:false,updated:false};});
  const result=await Promise.race([context.run('a'),new Promise(resolve=>setTimeout(()=>resolve('starved'),500))]);
  assert.notEqual(result,'starved','FX must not wait for the shared compute pool');
  assert.equal(result.found,false);
  assert.equal(calls.pool,0,'the shared compute pool is not used for FX');
  assert.equal(seen.length,1);
  assert.equal(seen[0].task,'loadFxWorkbookFromDirectories');
  assert.deepEqual(Array.from(seen[0].payload.directories),['/synthetic/source']);
  assert.equal(seen[0].options.timeoutMs,5000);
  assert.equal(seen[0].options.serializationKey,'shared-fx');
});
