'use strict';
// Ölçüm kancası (repo dışı): read-model işçi oluşturma/çıkış, iş sonucu (retained, gc), ana süreç bellek örnekleri.
// Date/modül yaması yok. NODE_OPTIONS'taki --max-old-space-size korunarak eklenmeli (aksi halde işçi heap sınırı değişir).
const fs=require('fs'),wt=require('worker_threads');const LOG=process.env.HOOK_LOG;
const w=o=>{try{fs.appendFileSync(LOG,JSON.stringify({t:Date.now(),...o})+'\n');}catch(_){}};
if(wt.isMainThread&&LOG&&/server\.js$/.test(process.argv[1]||'')){const Real=wt.Worker;
  wt.Worker=class extends Real{constructor(f,o){super(f,o);const rm=/read-model-worker/.test(String(f));this.__rm=rm;
    if(rm){w({ev:'spawn'});this.once('exit',c=>w({ev:'exit',code:c}));this.on('message',m=>{if(m&&m.type==='result')w({ev:'result',id:m.id,ok:m.ok,code:m.error&&m.error.code,r:m.metrics&&m.metrics.retainedBytes,o:m.metrics&&m.metrics.outputBytes,gc:m.metrics&&m.metrics.gcRecheck,skip:m.metrics&&m.metrics.gcRecheckSkipped});});}}
    postMessage(m,t){if(this.__rm&&m&&m.type==='run')w({ev:'run',id:m.id,task:m.task,limit:m.retainedLimitBytes});return super.postMessage(m,t);}};
  setInterval(()=>{const m=process.memoryUsage();let hwm=null;try{hwm=Number(/VmHWM:\s+(\d+)/.exec(fs.readFileSync('/proc/self/status','utf8'))[1])*1024;}catch(_){}w({ev:'mem',rss:m.rss,heapUsed:m.heapUsed,ext:m.external,ab:m.arrayBuffers,hwm});},1000).unref();}
