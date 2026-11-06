'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm');
const source=require('./helpers/server-source')();
test('shutdown stops admission and waits for worker exit/private replica cleanup before process exit',async()=>{
 const start=source.indexOf('let computeShutdownPromise;');assert.ok(start>0);
 const calls=[],signals=new Map();let complete;
 const context={process:{on:(event,callback)=>signals.set(event,callback),exit:code=>calls.push(['exit',code]),exitCode:0},httpServer:{close:()=>calls.push(['http'])},computeReads:{clear:()=>calls.push(['cache'])},
  closeComputeService:()=>{calls.push(['pool']);return new Promise(resolve=>{complete=resolve;});},cleanupOrphanExcel:()=>calls.push(['excel']),logRuntimeFailure(){},setTimeout:()=>({unref(){}}),clearTimeout(){}};
 const end=source.indexOf("process.on('SIGTERM', shutdownComputeRuntime);",start)+"process.on('SIGTERM', shutdownComputeRuntime);".length;
 vm.createContext(context);vm.runInContext(source.slice(start,end),context);
 const pending=signals.get('SIGTERM')();signals.get('SIGINT')();await Promise.resolve();
 assert.equal(calls.filter(item=>item[0]==='pool').length,1);assert.equal(calls.filter(item=>item[0]==='cache').length,1);assert.equal(calls.filter(item=>item[0]==='http').length,1);assert.equal(calls.some(item=>item[0]==='exit'),false);
 complete();await pending;assert.deepEqual(calls.at(-1),['exit',0]);assert.equal(calls.filter(item=>item[0]==='excel').length,1);
});
