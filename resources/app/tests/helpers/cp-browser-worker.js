'use strict';
const path=require('node:path'),{Worker}=require('node:worker_threads');
function workerFactory(){
  // Execute the actual browser entry point and its importScripts in a separate
  // V8 isolate, with browser globals rather than the CommonJS engine branch.
  const worker=new Worker(`
    const {parentPort,workerData}=require('node:worker_threads');
    const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
    const scope={performance,self:null};scope.self=scope;
    scope.postMessage=value=>parentPort.postMessage(value);
    scope.importScripts=(...files)=>files.forEach(file=>vm.runInContext(fs.readFileSync(path.join(workerData,file),'utf8'),sandbox,{filename:file}));
    const sandbox=vm.createContext(scope);
    vm.runInContext(fs.readFileSync(path.join(workerData,'cp-decision-worker.js'),'utf8'),sandbox);
    parentPort.on('message',data=>scope.onmessage({data}));
  `,{eval:true,workerData:path.join(__dirname,'../../public')});
  const adapter={postMessage:value=>worker.postMessage(value),terminate:()=>worker.terminate()};
  worker.on('message',data=>adapter.onmessage?.({data}));worker.on('error',error=>adapter.onerror?.(error));
  return adapter;
}
module.exports=workerFactory;
