'use strict';
// PREPARED ONLY. Arithmetic/source-pin checks; not an actual receive measurement.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {S,deltaMs,cpuDelta,derive}=require('./observables.cjs'),pins=require('./source-pins.json');
function example(){
 const shared=Array(S.SLOTS).fill('0');shared[S.PAYLOAD_ENTER]='10000000';shared[S.PAYLOAD_EXIT]='100000000';shared[S.CONTROL_ENTER]='101000000';shared[S.CONTROL_EXIT]='102000000';shared[S.CPU_SUPPORTED]='1';shared[S.CPU_USER_BEFORE]='1000';shared[S.CPU_USER_AFTER]='81000';shared[S.CPU_SYS_BEFORE]='2000';shared[S.CPU_SYS_AFTER]='12000';
 const main={controlCallbackEntryNs:'110000000',nativeReceiveEnterNs:'111000000',nativeReceiveExitNs:'161000000',metricsCallbackNs:'162000000',cpuBefore:{user:10,system:20},cpuAfter:{user:40010,system:5020}};
 return {shared,main};
}
test('actual native bracket arithmetic is distinct from sender post and arrival gap',()=>{
 const {shared,main}=example(),out=derive(shared,main,{mainReceiveMs:50.1,workerPostMessageMs:90.1});assert.equal(out.senderPostMessageWallMs,90);assert.equal(out.nativeReceiveWallMs,50);assert.equal(out.postReturnToControlCallbackCombinedMs,10);assert.equal(out.callbackEntryToNativeReceiveEnterMs,1);assert.equal(out.nativeReceiveExitToMetricsCallbackMs,1);assert.equal(out.mainReceiveThreadCpu.totalUs,45000);assert.equal(out.causalOrderValid,true);assert.equal(out.sourceMainReceiveMs,50.1);
});
test('no pure deserialization/serialization/IPC/scheduling metric is fabricated',()=>{
 const {shared,main}=example(),out=derive(shared,main,{});for(const key of ['pureDeserializationMs','pureSenderSerializationMs','ipcQueueOnlyMs','mainSchedulingOnlyMs'])assert.equal(out[key],null);assert.match(out.interpretation,/combined/);assert.match(out.interpretation,/public API/);
});
test('missing timestamps/CPU remain unavailable; zero is not an invented duration',()=>{
 const shared=Array(S.SLOTS).fill('0'),out=derive(shared,{},null);assert.equal(out.senderPostMessageWallMs,null);assert.equal(out.nativeReceiveWallMs,null);assert.equal(out.mainReceiveThreadCpu,null);assert.equal(out.senderThreadCpu,null);assert.equal(out.causalOrderValid,false);assert.equal(cpuDelta(null,{user:1,system:1}),null);
});
test('control post may return after callback on the other thread; no queue split inferred',()=>{
 const {shared,main}=example();shared[S.CONTROL_EXIT]='112000000';const out=derive(shared,main,{});assert.equal(out.controlPostReturnMayOverlapCallback,true);assert.equal(out.causalOrderValid,true);assert.equal(out.ipcQueueOnlyMs,null);
});
test('negative causal spans are not silently clamped into plausible measurements',()=>{
 assert.equal(deltaMs('2000000','1000000'),-1);const {shared,main}=example();main.nativeReceiveEnterNs='9000000';assert.equal(derive(shared,main,{}).causalOrderValid,false);
});
test('pinned actual execution files are checked without importing app/worker/benchmark',()=>{
 for(const [relative,pin] of Object.entries(pins.files))if(pin.requiredOnLaunch){const data=fs.readFileSync(path.join(pins.referenceCheckout,'resources/app',relative));assert.equal(data.length,pin.bytes);assert.equal(crypto.createHash('sha256').update(data).digest('hex'),pin.sha256,relative);}
});
