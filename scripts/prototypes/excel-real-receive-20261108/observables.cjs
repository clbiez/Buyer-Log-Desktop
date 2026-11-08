'use strict';
// Pure arithmetic only. No worker/app/module is loaded by this helper.
const S=Object.freeze({VERSION:0,JOB:1,PAYLOAD_ENTER:2,PAYLOAD_EXIT:3,CONTROL_ENTER:4,CONTROL_EXIT:5,CPU_USER_BEFORE:6,CPU_USER_AFTER:7,CPU_SYS_BEFORE:8,CPU_SYS_AFTER:9,PAYLOAD_COUNT:10,CONTROL_COUNT:11,THREAD_ID:12,CPU_SUPPORTED:13,POST_THREW:14,SLOTS:16});
const deltaMs=(a,b)=>a!=null&&b!=null&&BigInt(a)>0n&&BigInt(b)>0n?Number(BigInt(b)-BigInt(a))/1e6:null;
function cpuDelta(before,after){return before&&after?{userUs:after.user-before.user,systemUs:after.system-before.system,totalUs:after.user-before.user+after.system-before.system}:null;}
function derive(shared,main,sourceMetrics){
 const get=key=>shared[S[key]]==='0'?null:shared[S[key]];
 const senderPost=deltaMs(get('PAYLOAD_ENTER'),get('PAYLOAD_EXIT')),nativeReceive=deltaMs(main.nativeReceiveEnterNs,main.nativeReceiveExitNs);
 const ordered=[get('PAYLOAD_ENTER'),get('PAYLOAD_EXIT'),get('CONTROL_ENTER'),main.controlCallbackEntryNs,main.nativeReceiveEnterNs,main.nativeReceiveExitNs];
 return {
  senderPostMessageWallMs:senderPost,
  senderThreadCpu:shared[S.CPU_SUPPORTED]==='1'?{userUs:Number(BigInt(shared[S.CPU_USER_AFTER])-BigInt(shared[S.CPU_USER_BEFORE])),systemUs:Number(BigInt(shared[S.CPU_SYS_AFTER])-BigInt(shared[S.CPU_SYS_BEFORE]))}:null,
  nativeReceiveWallMs:nativeReceive,mainReceiveThreadCpu:cpuDelta(main.cpuBefore,main.cpuAfter),
  sourceMainReceiveMs:sourceMetrics?.mainReceiveMs??null,sourceWorkerPostMessageMs:sourceMetrics?.workerPostMessageMs??null,
  postReturnToControlCallbackCombinedMs:deltaMs(get('PAYLOAD_EXIT'),main.controlCallbackEntryNs),
  controlSendEnterToCallbackCombinedMs:deltaMs(get('CONTROL_ENTER'),main.controlCallbackEntryNs),
  callbackEntryToNativeReceiveEnterMs:deltaMs(main.controlCallbackEntryNs,main.nativeReceiveEnterNs),
  nativeReceiveExitToMetricsCallbackMs:deltaMs(main.nativeReceiveExitNs,main.metricsCallbackNs),
  controlPostReturnMayOverlapCallback:!!(get('CONTROL_EXIT')&&main.controlCallbackEntryNs&&BigInt(get('CONTROL_EXIT'))>BigInt(main.controlCallbackEntryNs)),
  causalOrderValid:ordered.every(x=>x!=null)&&ordered.every((x,i)=>!i||BigInt(ordered[i-1])<=BigInt(x)),
  pureDeserializationMs:null,pureSenderSerializationMs:null,ipcQueueOnlyMs:null,mainSchedulingOnlyMs:null,
  interpretation:'Native result-port receive wall/thread-CPU are actual combined dequeue/materialization/native-call observables. Control arrival gap combines sender control work, IPC queue/transport, main scheduling and small-control decode; public API does not identify their separate durations.'
 };
}
module.exports={S,deltaMs,cpuDelta,derive};
