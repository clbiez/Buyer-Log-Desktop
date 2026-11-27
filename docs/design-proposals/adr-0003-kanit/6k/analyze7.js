'use strict';
// ab7: kol başına 503, işçi oluşturma, GC yeniden ölçüm, bellek (RSS/tepe/heap/işçi retained), CPU, bekleme. Blok farkları ve A/A.
const fs=require('fs'),path=require('path');const dir=process.argv[2];const ARMS=['mainoff','maingc','mainoffAA','preoff','pregc'];
const runs=fs.readdirSync(dir).filter(f=>/^r\d+-\w+\.json$/.test(f)).sort((a,b)=>parseInt(a.slice(1))-parseInt(b.slice(1))).map(f=>{const j=JSON.parse(fs.readFileSync(path.join(dir,f),'utf8'));const h=fs.readFileSync(path.join(dir,f.replace('.json','.hook')),'utf8').trim().split('\n').map(l=>{try{return JSON.parse(l);}catch(_){return {};}});return {f,...j,h};});
const med=a=>{const s=a.filter(x=>typeof x==='number').sort((x,y)=>x-y),n=s.length;return n?(n%2?s[(n-1)/2]:(s[n/2-1]+s[n/2])/2):null;};const r0=v=>v==null?null:Math.round(v);const MB=v=>v==null?null:Math.round(v/1048576);
for(const r of runs){const mem=r.h.filter(e=>e.ev==='mem');const res=r.h.filter(e=>e.ev==='result');const gcs=res.filter(e=>e.gc);
  r.m={n503:r.edits.filter(e=>e.cp.status!==200).length,spawn:r.h.filter(e=>e.ev==='spawn').length,exceeded:res.filter(e=>e.code==='COMPUTE_ESTIMATE_EXCEEDED').length,gc:gcs.length,gcMsMed:r0(med(gcs.map(e=>e.gc.gcMs))),gcFreedMB:gcs.map(e=>MB(e.gc.beforeBytes-e.r)),
    peakRssMB:MB(Math.max(...mem.map(e=>e.hwm||0))),rssMedMB:MB(med(mem.map(e=>e.rss))),rssMaxMB:MB(Math.max(...mem.map(e=>e.rss))),mainHeapMaxMB:MB(Math.max(...mem.map(e=>e.heapUsed))),workerRetMaxMB:MB(Math.max(...res.filter(e=>e.r).map(e=>e.r))),
    cpuTot:r.edits.reduce((s,e)=>s+(e.cpuMs||0),0),boot:r.bootMs,errors:(r.errors||[]).length,digest:String(r.final&&r.final.digest||'').slice(0,12)};}
console.log('koşu             503 spawn gc gcMs  peakRSS rssMed rssMax mainHeap wRetMax cpuTot  digest');
for(const r of runs){const m=r.m;console.log(r.f.padEnd(17),String(m.n503).padEnd(3),String(m.spawn).padEnd(5),String(m.gc).padEnd(2),String(m.gcMsMed).padEnd(5),String(m.peakRssMB).padEnd(7),String(m.rssMedMB).padEnd(6),String(m.rssMaxMB).padEnd(6),String(m.mainHeapMaxMB).padEnd(8),String(m.workerRetMaxMB).padEnd(7),String(m.cpuTot).padEnd(7),m.digest,m.errors?'HATA':'',m.gcFreedMB.length?'gcFreedMB='+JSON.stringify(m.gcFreedMB):'');}
const K=['n503','spawn','gc','peakRssMB','rssMedMB','mainHeapMaxMB','workerRetMaxMB','cpuTot'];
console.log('\nkol medyanları (ham koşular)');for(const a of ARMS){const rs=runs.filter(r=>r.arm===a);console.log(a.padEnd(10),K.map(k=>k+'='+r0(med(rs.map(r=>r.m[k])))+JSON.stringify(rs.map(r=>r.m[k]))).join(' '));}
const W={cpWait:e=>e.cpWaitMs,orders:e=>e.orders.ms,ready:e=>e.cpWaitMs+e.orders.ms,cpu:e=>e.cpuMs};
for(const kind of ['suppFob','note']){console.log('\n=== '+kind+' (koşu medyanı; kol: ham koşu medyanları | kol medyanı)');
  for(const [k,f] of Object.entries(W)){const per=runs.map(r=>({arm:r.arm,v:med(r.edits.filter(e=>e.kind===kind).map(f))}));const by=a=>per.filter(x=>x.arm===a).map(x=>r0(x.v));
    console.log('  '+k.padEnd(7),ARMS.map(a=>a+JSON.stringify(by(a))+'|'+r0(med(by(a)))).join(' '));
    const blocks=[];for(let i=0;i+4<per.length;i+=5){const b=per.slice(i,i+5),g=a=>(b.find(x=>x.arm===a)||{}).v;blocks.push({'gc-off':r0(g('maingc')-g('mainoff')),'AA':r0(g('mainoffAA')-g('mainoff')),'pgc-poff':r0(g('pregc')-g('preoff')),'mgc-pgc':r0(g('maingc')-g('pregc')),'moff-poff':r0(g('mainoff')-g('preoff'))});}
    console.log('          bloklar',JSON.stringify(blocks));}
  console.log('  ham cpWait/ready örnekleri:');for(const r of runs)console.log('   ',r.f.padEnd(17),JSON.stringify(r.edits.filter(e=>e.kind===kind).map(e=>[e.cp.status,r0(e.cpWaitMs),r0(e.cpWaitMs+e.orders.ms)])));}
