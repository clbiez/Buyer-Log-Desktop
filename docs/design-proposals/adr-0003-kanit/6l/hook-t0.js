'use strict';
// #1236 t0 ölçüm kancası (repo dışı): havuz çağrısı (pool.run girişi), işçiye gönderim, sonuç; ana süreç bellek. Date yaması yok.
const fs=require('fs'),wt=require('worker_threads'),Module=require('module');const LOG=process.env.HOOK_LOG;
const w=o=>{try{fs.appendFileSync(LOG,JSON.stringify({t:Date.now(),...o})+'\n');}catch(_){}};
if(wt.isMainThread&&LOG&&/server\.js$/.test(process.argv[1]||'')){const Real=wt.Worker;
  wt.Worker=class extends Real{constructor(f,o){super(f,o);const rm=/read-model-worker/.test(String(f));this.__rm=rm;
    if(rm){w({ev:'spawn'});this.once('exit',c=>w({ev:'exit',code:c}));this.on('message',m=>{if(m&&m.type==='result')w({ev:'result',id:m.id,ok:m.ok,code:m.error&&m.error.code,r:m.metrics&&m.metrics.retainedBytes,ms:m.metrics&&Math.round(m.metrics.executionMs)});});}}
    postMessage(m,t){if(this.__rm&&m&&m.type==='run'){const p=m.payload||{};w({ev:'run',id:m.id,task:m.task,warm:Boolean(p.warmOnly),buffer:Boolean(p.dataset&&p.dataset.buffer)});}return super.postMessage(m,t);}};
  const orig=Module._load;Module._load=function(req){const out=orig.apply(this,arguments);
    if(/read-model-pool$/.test(req)&&out&&out.getReadModelPool&&!out.__h){out.__h=true;const get=out.getReadModelPool;
      out.getReadModelPool=(...a)=>{const pool=get(...a);if(!pool.__h){pool.__h=true;const run=pool.run.bind(pool);
        pool.run=(task,payload,o={})=>{const s=pool.stats();w({ev:'call',task,est:o.estimatedBytes,pending:s.pending,active:s.activeWorkers});
          return run(task,payload,o).then(l=>{w({ev:'lease',task,q:Math.round(l.metrics.queueWaitMs),d:Math.round(l.metrics.durationMs)});return l;},e=>{w({ev:'reject',task,code:e&&e.code});throw e;});};}return pool;};}
    return out;};
  setInterval(()=>{const m=process.memoryUsage();w({ev:'mem',rss:m.rss,heapUsed:m.heapUsed});},1000).unref();}
