'use strict';
// Test-process instrumentation; never loaded by the product launcher.
const path=require('node:path'),fsp=require('node:fs/promises'),{performance}=require('node:perf_hooks'),{isDeepStrictEqual}=require('node:util');
const app=process.cwd(),localModule=require(path.join(app,'server/lib/local-db'));
const deltaModule=require(path.join(app,'server/lib/delta-store'));
let local,store,stats,start,cpu,timer,last,gap=0,peak,transportFilter,ownerResolver,walChunks;
const createLocal=localModule.createLocalDb,createDelta=deltaModule.createDeltaStore;
localModule.createLocalDb=(...args)=>{const db=createLocal(...args);if(!local){local=db;const transport=db.setTransportFilter,owner=db.setSharedOwnerResolver;db.setTransportFilter=filter=>{transportFilter=filter;return transport(filter);};db.setSharedOwnerResolver=resolver=>{ownerResolver=resolver;return owner(resolver);};}return db;};
deltaModule.createDeltaStore=(...args)=>{store=createDelta(...args);return store;};
const open=fsp.open,mkdir=fsp.mkdir,stringify=JSON.stringify;
fsp.open=async(...args)=>{
 const h=await open(...args);
 if(stats&&String(args[0])===local.file+'.wal'&&args[1]==='a'){
  stats.walAppend++;const sync=h.sync.bind(h),write=h.writeFile.bind(h);
  h.sync=async(...a)=>{stats.fsync++;return sync(...a);};
  h.writeFile=async(...a)=>{stats.walBytes+=Buffer.byteLength(a[0]);const result=await write(...a);walChunks.push(String(a[0]));return result;};
 }
 return h;
};
fsp.mkdir=async(...args)=>{if(stats&&String(args[0])===local.file+'.write-lock')stats.lease++;return mkdir(...args);};
JSON.stringify=function(...args){if(stats)stats.serialize++;return stringify.apply(this,args);};
function sample(){const now=performance.now();gap=Math.max(gap,now-last);last=now;const m=process.memoryUsage();for(const k of ['rss','heapUsed'])peak[k]=Math.max(peak[k],m[k]);}
process.on('message',async message=>{
 try{
  if(message.command==='start'){
   await store.flush();await store.hydrate();walChunks=[];stats={walAppend:0,fsync:0,walBytes:0,lease:0,serialize:0};gap=0;peak=process.memoryUsage();last=start=performance.now();cpu=process.cpuUsage();timer=setInterval(sample,1);
   process.send({id:message.id,result:{started:true}});
  }else if(message.command==='finish'){
   await store.flush();sample();clearInterval(timer);const totalMs=performance.now()-start,used=process.cpuUsage(cpu),physical=stats;stats=null;
   const state=await local.read();
   const cpEvents=state.journal.filter(e=>e.entityType==='cp-order');
   const strip=value=>Object.fromEntries(Object.entries(value).filter(([key])=>!key.startsWith('_')));
   const records=Object.fromEntries(Object.entries(state.records).filter(([key])=>key.startsWith('cp-order:')).map(([key,value])=>[key,strip(value)]));
   const reopened=createLocal(local.file);reopened.setTransportFilter(transportFilter);reopened.setSharedOwnerResolver(ownerResolver);const replay=await reopened.read();
   const cpState=s=>({records:Object.fromEntries(Object.entries(s.records).filter(([key])=>key.startsWith('cp-order:'))),events:s.journal.filter(e=>e.entityType==='cp-order')});
   if(!isDeepStrictEqual(cpState(replay),cpState(state)))require('node:fs').writeFileSync(path.join(path.dirname(local.file),'6c-replay-difference.json'),JSON.stringify({live:cpState(state),replay:cpState(replay)},null,2));
   process.send({id:message.id,result:{walChunks,rawJournal:cpEvents,totalMs,cpuMs:(used.user+used.system)/1000,peakRss:peak.rss,peakHeap:peak.heapUsed,eventLoopGapMs:gap,physical,records,events:cpEvents.map(e=>({id:e.id,userId:e.userId,patch:e.patch,subfields:e.subfields,operation:e.operation,localSequence:e.localSequence,baseRevision:e.baseRevision,revision:e.revision,uploaded:e.uploaded,acknowledged:e.acknowledged,synced:e.synced})),replayEqual:isDeepStrictEqual(cpState(replay),cpState(state)),pending:store.isHydrated,mode:store.mode}});
  }
 }catch(error){process.send({id:message.id,error:{message:error.message,code:error.code,stack:error.stack}});}
});
