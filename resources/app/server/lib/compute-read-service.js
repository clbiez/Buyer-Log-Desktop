'use strict';
// Bir hesaplama birçok HTTP tüketicisine hizmet edebilir. İlk tüketicinin
// oturumu/abort'u ortak işi iptal etmez; her yanıt kendi canlı kapısını geçer.
function createComputeReadService({compute,guard,sourceFor,paramsFor,maxBytes=48*1024*1024,maxEntries=12,ttlMs=60000,now=Date.now}){
  const flights=new Map(),cache=new Map();let cachedBytes=0,epoch=0;
  function releaseEntry(entry){if(entry.refs===0&&!entry.released){entry.released=true;entry.lease?.release();}}
  function remove(key){const entry=cache.get(key);if(!entry)return;cache.delete(key);cachedBytes-=entry.bytes;entry.refs--;releaseEntry(entry);}
  function prune(){const at=now();for(const [key,entry] of cache)if(at-entry.at>=ttlMs)remove(key);}
  function cacheEntry(key,entry){
    if(entry.bytes>maxBytes||maxEntries<1)return;
    if(cache.has(key))remove(key);entry.at=now();entry.refs++;cache.set(key,entry);cachedBytes+=entry.bytes;
    while(cache.size>maxEntries||cachedBytes>maxBytes)remove(cache.keys().next().value);
  }
  async function run(req,area,task,keyParts={},options={}){
    const captured=guard.capture(req,area),key=JSON.stringify([captured.key,task,keyParts]);prune();
    let entry=cache.get(key)||flights.get(key);
    if(entry&&cache.has(key)){cache.delete(key);cache.set(key,entry);}
    if(!entry){
      entry={refs:0,bytes:0,released:false,epoch};flights.set(key,entry);
      entry.promise=Promise.resolve().then(async()=>{
        let lease;
        try{
          const source=await sourceFor(captured.profile),params=await paramsFor(captured.profile,source,task,{...keyParts,...options.payload});
          // Body parsing, context preparation and encoded IPC must not all
          // accumulate in one event-loop turn. Check live authority after the
          // cooperative handoff, immediately before admitting worker input.
          await new Promise(setImmediate);captured.assertBuild();
          lease=await compute.run(task,source,params,options.computeOptions);captured.assertBuild();
          entry.lease=lease;entry.bytes=lease.metrics.outputBytes||0;
          if(options.cache!==false&&entry.epoch===epoch)cacheEntry(key,entry);
          return lease;
        }catch(error){lease?.release();throw error;}
        finally{if(flights.get(key)===entry)flights.delete(key);}
      });
    }
    entry.refs++;
    try{
      const lease=await entry.promise;captured.assertResponse();let released=false;
      return {value:lease.value,metrics:lease.metrics,assertBuild:captured.assertBuild,assertResponse:captured.assertResponse,release(){if(released)return;released=true;entry.refs--;releaseEntry(entry);}};
    }catch(error){entry.refs--;releaseEntry(entry);throw error;}
  }
  function clear(){epoch++;for(const key of [...cache.keys()])remove(key);}
  function stats(){return {entries:cache.size,bytes:cachedBytes,inFlight:flights.size,maxBytes,maxEntries};}
  return {run,clear,stats};
}
module.exports={createComputeReadService};
