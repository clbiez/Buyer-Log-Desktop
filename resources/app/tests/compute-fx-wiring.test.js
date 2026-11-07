'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),path=require('node:path');
const {extractFunction}=require('./helpers/app-main-functions'),source=require('./helpers/server-source')();
test('automatic folder FX checks reuse a serialized background pool job and release it after the decision',async()=>{
  let calls=0,released=0;
  const context={require:require('node:module').createRequire(path.join(__dirname,'../server/server.js')),__dirname:path.join(__dirname,'../server'),path,
    sourceUserId:()=> 'a',sourceFolderForUser:()=> '/synthetic/source',loadFx:()=>({_revision:1}),folderFxSyncStatus:null,
    runExcelTask:()=>{throw Error('Fresh Excel worker is forbidden on the opening path');},
    serverCompute:()=>({runExcelUtility:async(task,payload,options)=>{calls++;assert.equal(task,'loadFxWorkbookFromDirectories');assert.deepEqual(Array.from(payload.directories),['/synthetic/source']);assert.equal(options.serializationKey,'shared-fx');assert.equal(options.priority,'background');return {value:{found:false,updated:false},release:()=>released++};}}),
    logRuntimeFailure:(_key,error)=>{throw error;}};
  vm.createContext(context);vm.runInContext(extractFunction(source,'syncFxFromKurWorkbook')+';globalThis.run=syncFxFromKurWorkbook;',context);
  const result=await context.run('a');assert.equal(result.found,false);assert.equal(calls,1);assert.equal(released,1);
});
