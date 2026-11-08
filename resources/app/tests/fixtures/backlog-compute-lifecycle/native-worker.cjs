'use strict';
// Observation only: execute the unchanged production worker and Backlog builder.
const {parentPort}=require('node:worker_threads');
const tasks=require('../../../server/lib/compute-tasks');
const build=tasks.buildBacklog;
let id;
parentPort.on('message',message=>{if(message?.type==='run')id=message.id;});
tasks.buildBacklog=function(...args){
  const tid=Number(require('node:fs').readFileSync('/proc/thread-self/stat','utf8').split(' ')[0]);
  parentPort.postMessage({type:'ana12-checkpoint',phase:'build-start',id,tid});
  const result=build.apply(this,args);
  parentPort.postMessage({type:'ana12-checkpoint',phase:'build-end',id,tid});
  return result;
};
require('../../../server/workers/compute-worker');
