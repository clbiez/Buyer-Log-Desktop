'use strict';
// Uzun oturum ölçüm kancası (repo dışı): hook-mem.js + read-model havuz/şerit stats() anlık görüntüsü (5 sn).
// İşçi oluşturma/çıkış, iş sonucu (ok/kod/retained/limit), 1 sn RSS / VmHWM / ana heap. Date veya ürün mantığı yaması yok.
const fs=require('fs'),wt=require('worker_threads'),Module=require('module');const LOG=process.env.HOOK_LOG;
const w=o=>{try{fs.appendFileSync(LOG,JSON.stringify({t:Date.now(),...o})+'\n');}catch(_){}};
if(wt.isMainThread&&LOG&&/server\.js$/.test(process.argv[1]||'')){const Real=wt.Worker;let seq=0;
  wt.Worker=class extends Real{constructor(f,o){super(f,o);const rm=/read-model-worker/.test(String(f));this.__rm=rm;
    if(rm){const wid=++seq;this.__wid=wid;w({ev:'spawn',wid,limit:o&&o.resourceLimits||null});this.once('exit',c=>w({ev:'exit',wid,code:c}));
      this.on('message',m=>{if(m&&m.type==='result')w({ev:'result',wid,id:m.id,ok:m.ok,code:m.error&&m.error.code,r:m.metrics&&m.metrics.retainedBytes,o:m.metrics&&m.metrics.outputBytes,gc:m.metrics&&m.metrics.gcRecheck,ms:m.metrics&&Math.round(m.metrics.executionMs||0)});});}}
    postMessage(m,t){if(this.__rm&&m&&m.type==='run')w({ev:'run',wid:this.__wid,id:m.id,task:m.task,limit:m.retainedLimitBytes});return super.postMessage(m,t);}
    terminate(){if(this.__rm)w({ev:'terminate',wid:this.__wid});return super.terminate();}};
  const pools={};const orig=Module._load;Module._load=function(req){const out=orig.apply(this,arguments);
    if(/read-model-pool$/.test(req)&&out&&!out.__h&&out.getReadModelPool){out.__h=true;
      for(const [k,name] of [['getReadModelPool','main'],['getReadModelQueryLanePool','lane']]){const get=out[k];if(typeof get!=='function')continue;out[k]=(...a)=>{const p=get(...a);pools[name]=p;return p;};}}
    return out;};
  setInterval(()=>{const m=process.memoryUsage();let hwm=null;try{hwm=Number(/VmHWM:\s+(\d+)/.exec(fs.readFileSync('/proc/self/status','utf8'))[1])*1024;}catch(_){}w({ev:'mem',rss:m.rss,heapUsed:m.heapUsed,heapTotal:m.heapTotal,ext:m.external,ab:m.arrayBuffers,hwm});},1000).unref();
  setInterval(()=>{const o={ev:'pool'};for(const [n,p] of Object.entries(pools)){try{const s=p.stats();o[n]={workers:s.workerCount,active:s.activeWorkers,pending:s.pending,retained:s.retainedWorkerBytes,reserved:s.reservedBytes,budget:s.memoryBudgetBytes,completed:s.completed,failed:s.failed,rejected:s.rejected,queued:s.queued,laneIdleReleases:s.laneIdleReleases};}catch(_){}}w(o);},5000).unref();}
