'use strict';
const {randomUUID}=require('node:crypto');
const {performance}=require('node:perf_hooks');

function aborted(){
  return Object.assign(new Error('Hesaplama iptal edildi. / Compute operation cancelled.'),
    {code:'COMPUTE_ABORTED',statusCode:499,errorEn:'Compute operation cancelled.'});
}

// Pending flights only. The existing read service remains the completed-cache owner.
// build must forward context.signal to compute.run, never to shared source preparation.
// publish is synchronous and takes ownership of one independent output lease.
function createBacklogComputeLifecycle({onEvent}={}){
  const flights=new Map();let disposed=false;
  function emit(type,flight,subscriber){
    // Opaque correlation only: no keys, query, authority, user or source descriptor.
    try{onEvent?.(Object.freeze({type,jobId:flight.jobId,...(subscriber?{requestId:subscriber.requestId}:{}),atMs:performance.now()}));}catch{}
  }
  function remove(flight){if(flights.get(flight.key)===flight)flights.delete(flight.key);}
  function stopIfEmpty(flight){
    if(flight.state!=='pending'||flight.subscribers.size)return;
    flight.state='cancelled';remove(flight);
    emit('job-abort',flight);flight.controller.abort();
  }
  function detach(flight,subscriber,error=aborted()){
    if(!subscriber.active)return;
    subscriber.active=false;subscriber.cleanup();flight.subscribers.delete(subscriber);
    if(subscriber.output)subscriber.output.release();else subscriber.reject(error);
    emit('request-release',flight,subscriber);stopIfEmpty(flight);
  }
  function check(subscriber){subscriber.captured.assertBuild();subscriber.captured.assertResponse();}
  function assertCurrent(flight){
    for(const subscriber of [...flight.subscribers]){
      try{check(subscriber);}catch(error){detach(flight,subscriber,error);}
    }
    if(flight.state!=='pending'||flight.controller.signal.aborted||!flight.subscribers.size||flights.get(flight.key)!==flight)throw aborted();
  }
  async function execute(flight,build,publish){
    let lease,refs=1;
    const drop=()=>{if(--refs===0)lease.release();};
    function retain(subscriber){
      refs++;let released=false;
      return {value:lease.value,metrics:lease.metrics,
        assertBuild:subscriber?()=>{if(!subscriber.active)throw aborted();subscriber.captured.assertBuild();}:undefined,
        assertResponse:subscriber?()=>{if(!subscriber.active)throw aborted();check(subscriber);}:undefined,
        release(){if(released)return;released=true;drop();if(subscriber)detach(flight,subscriber);}};
    }
    try{
      assertCurrent(flight);emit('job-build',flight);
      lease=await build(Object.freeze({signal:flight.controller.signal,jobId:flight.jobId,parts:flight.parts,assertCurrent:()=>assertCurrent(flight)}));
      assertCurrent(flight);
      if(publish){
        const retained=retain();
        try{const result=publish(retained);if(result&&typeof result.then==='function')throw new TypeError('publish must be synchronous');}
        catch(error){retained.release();throw error;}
      }
      // No await between the authority/subscriber gate and cache publication/delivery.
      flight.state='completed';remove(flight);
      for(const subscriber of flight.subscribers){subscriber.output=retain(subscriber);subscriber.resolve(subscriber.output);}
      emit('job-complete',flight);
    }catch(error){
      if(flight.state==='pending'){
        flight.state='failed';remove(flight);
        for(const subscriber of [...flight.subscribers])detach(flight,subscriber,error);
        flight.controller.abort();emit('job-failed',flight);
      }
    }finally{if(lease)drop();}
  }
  function subscribe({req,res,captured,task,parts={},build,publish}){
    if(disposed)throw new Error('Compute lifecycle disposed');
    if(!req||!res||typeof captured?.key!=='string'||!captured.key||typeof captured.assertBuild!=='function'||typeof captured.assertResponse!=='function'
      ||typeof task!=='string'||!task||typeof build!=='function'||(publish!==undefined&&typeof publish!=='function'))throw new TypeError('Invalid compute lifecycle adapter');
    // Copy before asynchronous preparation. Query/projection/details all belong in parts.
    const query=structuredClone(parts),key=JSON.stringify([captured.key,task,query,[typeof query.includeSourceDetails,query.includeSourceDetails]]);
    let flight=flights.get(key),created=false;
    if(!flight){
      flight={key,jobId:randomUUID(),parts:query,state:'pending',controller:new AbortController(),subscribers:new Set()};
      flights.set(key,flight);created=true;
    }
    const subscriber={captured,requestId:randomUUID(),active:true};
    const promise=new Promise((resolve,reject)=>{subscriber.resolve=resolve;subscriber.reject=reject;});promise.catch(()=>{});
    const release=()=>detach(flight,subscriber);
    const close=()=>{if(!res.writableFinished)release();};
    subscriber.cleanup=()=>{req.removeListener('aborted',release);res.removeListener('close',close);res.removeListener('finish',release);};
    flight.subscribers.add(subscriber);
    req.once('aborted',release);res.once('close',close);res.once('finish',release);
    emit('request-join',flight,subscriber);
    try{check(subscriber);if(req.aborted||res.destroyed||res.writableEnded)release();}
    catch(error){detach(flight,subscriber,error);}
    if(created)Promise.resolve().then(()=>execute(flight,build,publish));
    return {requestId:subscriber.requestId,jobId:flight.jobId,promise,release};
  }
  // Call on live authority/source invalidation. Checks each capture, never bumps a
  // pool owner generation for a single HTTP request or cancels unrelated scopes.
  function revalidate(){for(const flight of [...flights.values()])try{assertCurrent(flight);}catch{}}
  function dispose(){
    if(disposed)return;disposed=true;
    for(const flight of [...flights.values()])for(const subscriber of [...flight.subscribers])detach(flight,subscriber);
  }
  return {subscribe,revalidate,dispose,get inFlight(){return flights.size;}};
}
module.exports={createBacklogComputeLifecycle};
