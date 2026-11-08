'use strict';
// Diagnostic preload INSIDE the one actual production Excel Worker, not a new worker.
const {workerData,parentPort,MessagePort,threadId,isMainThread}=require('node:worker_threads');
const {S}=require('./observables.cjs'),d=workerData?.__blExcelRealReceiveProbe;
if(!isMainThread){
 if(!d||!(d.telemetry instanceof SharedArrayBuffer)||d.telemetry.byteLength!==S.SLOTS*8||typeof d.expectedWorker!=='string')throw Error('Unexpected real Excel worker preload target');
 const slots=new BigInt64Array(d.telemetry),native=MessagePort.prototype.postMessage,now=()=>process.hrtime.bigint();
 const cpu=()=>typeof process.threadCpuUsage==='function'?process.threadCpuUsage():null;
 Atomics.store(slots,S.VERSION,1n);Atomics.store(slots,S.THREAD_ID,BigInt(threadId));
 MessagePort.prototype.postMessage=function(message){
  const same=message&&Number.isSafeInteger(message.id)&&BigInt(message.id)===Atomics.load(slots,S.JOB);
  const payload=same&&this!==parentPort&&Object.prototype.hasOwnProperty.call(message,'result');
  const control=same&&this===parentPort&&message.type==='result-ready';
  if(!payload&&!control)return native.apply(this,arguments);
  const before=payload?cpu():null;
  if(payload){Atomics.add(slots,S.PAYLOAD_COUNT,1n);if(before){Atomics.store(slots,S.CPU_SUPPORTED,1n);Atomics.store(slots,S.CPU_USER_BEFORE,BigInt(before.user));Atomics.store(slots,S.CPU_SYS_BEFORE,BigInt(before.system));}Atomics.store(slots,S.PAYLOAD_ENTER,now());}
  else{Atomics.add(slots,S.CONTROL_COUNT,1n);Atomics.store(slots,S.CONTROL_ENTER,now());}
  try{return native.apply(this,arguments);}
  catch(error){Atomics.store(slots,S.POST_THREW,1n);throw error;}
  finally{
   if(payload){Atomics.store(slots,S.PAYLOAD_EXIT,now());const after=cpu();if(after){Atomics.store(slots,S.CPU_USER_AFTER,BigInt(after.user));Atomics.store(slots,S.CPU_SYS_AFTER,BigInt(after.system));}}
   else Atomics.store(slots,S.CONTROL_EXIT,now());
  }
 };
}
