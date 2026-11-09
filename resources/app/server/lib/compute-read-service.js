'use strict';
// Bir hesaplama birçok HTTP tüketicisine hizmet edebilir. İlk tüketicinin
// oturumu ortak işi iptal etmez; opt-in iptal yalnız son tüketici ayrılınca yayılır.
function createComputeReadService({compute,guard,sourceFor,paramsFor,maxBytes=48*1024*1024,maxEntries=12,ttlMs=60000,now=Date.now}){
  const flights=new Map(),cache=new Map();let cachedBytes=0,epoch=0;
  const aborted=()=>Object.assign(new Error('Hesaplama iptal edildi. / Compute operation cancelled.'),{code:'COMPUTE_ABORTED',statusCode:499});
  function releaseEntry(entry){if(entry.refs===0&&entry.lease&&!entry.released){entry.released=true;entry.lease?.release();}}
  function remove(key){const entry=cache.get(key);if(!entry)return;cache.delete(key);cachedBytes-=entry.bytes;entry.refs--;releaseEntry(entry);}
  function prune(){const at=now();for(const [key,entry] of cache)if(at-entry.at>=ttlMs)remove(key);}
  function cacheEntry(key,entry){
    if(entry.bytes>maxBytes||maxEntries<1)return;
    if(cache.has(key))remove(key);entry.at=now();entry.refs++;cache.set(key,entry);cachedBytes+=entry.bytes;
    while(cache.size>maxEntries||cachedBytes>maxBytes)remove(cache.keys().next().value);
  }
  async function run(req,area,task,keyParts={},options={}){
    const captured=guard.capture(req,area),key=JSON.stringify([captured.key,task,keyParts]),signal=options.signal;
    if(signal?.aborted)throw aborted();prune();
    let entry=cache.get(key)||flights.get(key);
    if(entry&&cache.has(key)){cache.delete(key);cache.set(key,entry);}
    if(!entry){
      entry={refs:0,bytes:0,released:false,epoch,settled:false,controller:signal?new AbortController():null};flights.set(key,entry);
      entry.promise=Promise.resolve().then(async()=>{
        let lease;
        const assertActive=()=>{if(entry.controller?.signal.aborted)throw aborted();};
        try{
          assertActive();
          const source=await sourceFor(captured.profile);assertActive();
          const params=await paramsFor(captured.profile,source,task,{...keyParts,...options.payload});
          // Body parsing, context preparation and encoded IPC must not all
          // accumulate in one event-loop turn. Check live authority after the
          // cooperative handoff, immediately before admitting worker input.
          await new Promise(setImmediate);assertActive();captured.assertBuild();
          lease=await compute.run(task,source,params,entry.controller?{...options.computeOptions,signal:entry.controller.signal}:options.computeOptions);assertActive();captured.assertBuild();
          entry.lease=lease;entry.bytes=lease.metrics.outputBytes||0;
          if(options.cache!==false&&entry.epoch===epoch)cacheEntry(key,entry);
          return lease;
        }catch(error){lease?.release();throw error;}
        finally{entry.settled=true;if(flights.get(key)===entry)flights.delete(key);}
      });
    }
    entry.refs++;let released=false,onAbort;
    const release=()=>{
      if(released)return;released=true;entry.refs--;releaseEntry(entry);
      if(entry.refs===0&&!entry.settled&&entry.controller){
        // Retire immediately: a rapid repeat query must get a fresh flight.
        if(flights.get(key)===entry)flights.delete(key);
        entry.controller.abort();
      }
    };
    try{
      const lease=await (signal?new Promise((resolve,reject)=>{
        onAbort=()=>{release();reject(aborted());};
        signal.addEventListener('abort',onAbort,{once:true});
        if(signal.aborted)onAbort();
        entry.promise.then(resolve,reject);
      }):entry.promise);
      if(signal?.aborted)throw aborted();captured.assertResponse();
      return {value:lease.value,metrics:lease.metrics,assertBuild:captured.assertBuild,assertResponse:captured.assertResponse,release};
    }catch(error){release();throw error;}
    finally{if(onAbort)signal.removeEventListener('abort',onAbort);}
  }

  function clear(){epoch++;for(const key of [...cache.keys()])remove(key);}
  function stats(){return {entries:cache.size,bytes:cachedBytes,inFlight:flights.size,maxBytes,maxEntries};}
  return {run,clear,stats};
}
module.exports={createComputeReadService};
