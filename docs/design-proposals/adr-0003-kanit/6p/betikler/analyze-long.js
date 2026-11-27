'use strict';
// Uzun oturum özeti (ab3 + hook-mem, tek koşu): 5 dk dilimler, bellek eğimi, GC/503/işçi zaman serisi.
const fs=require('fs');const [json,hook]=process.argv.slice(2);const r=JSON.parse(fs.readFileSync(json,'utf8'));
const h=fs.readFileSync(hook,'utf8').trim().split('\n').map(l=>{try{return JSON.parse(l);}catch(_){return {};}});
const t0=h[0].t,MB=v=>v==null?null:Math.round(v/1048576);const med=a=>{const s=a.filter(x=>typeof x==='number').sort((x,y)=>x-y),n=s.length;return n?(n%2?s[(n-1)/2]:(s[n/2-1]+s[n/2])/2):null;};
const edits=r.edits;const editStart=Date.now()-0;// not used
const mem=h.filter(e=>e.ev==='mem'),res=h.filter(e=>e.ev==='result'),spawn=h.filter(e=>e.ev==='spawn'),exit=h.filter(e=>e.ev==='exit');
const end=h[h.length-1].t;const B=300000;console.log('süre dk',((end-t0)/60000).toFixed(1),'kayıt',edits.length,'hata',(r.errors||[]).length);
console.log('dilim(dk) rssMed rssMax hwm mainHeapMed mainHeapMax wRetMed wRetMax jobs gc gcSkip exceeded spawn exit');
for(let a=t0;a<end;a+=B){const f=e=>e.t>=a&&e.t<a+B;const m=mem.filter(f),x=res.filter(f);
  console.log(String(Math.round((a-t0)/60000)).padEnd(9),MB(med(m.map(e=>e.rss))),MB(Math.max(...m.map(e=>e.rss))),MB(Math.max(...m.map(e=>e.hwm||0))),MB(med(m.map(e=>e.heapUsed))),MB(Math.max(...m.map(e=>e.heapUsed))),
  MB(med(x.filter(e=>e.r).map(e=>e.r))),MB(Math.max(0,...x.filter(e=>e.r).map(e=>e.r))),x.length,x.filter(e=>e.gc).length,x.filter(e=>e.skip).length,x.filter(e=>e.code==='COMPUTE_ESTIMATE_EXCEEDED').length,spawn.filter(f).length,exit.filter(f).length);}
// Eğim: ilk 5 dk hariç, en küçük kareler (MB / 10 dk).
const slope=(pts)=>{const n=pts.length;if(n<2)return null;const mx=pts.reduce((s,p)=>s+p[0],0)/n,my=pts.reduce((s,p)=>s+p[1],0)/n;let a=0,b=0;for(const [x,y] of pts){a+=(x-mx)*(y-my);b+=(x-mx)**2;}return a/b;};
const late=mem.filter(e=>e.t>=t0+B);const k=600000/1048576;
console.log('eğim (5. dk sonrası, MB/10dk): rss',(slope(late.map(e=>[e.t,e.rss]))*k).toFixed(1),'mainHeap',(slope(late.map(e=>[e.t,e.heapUsed]))*k).toFixed(1),'workerRetained',(slope(res.filter(e=>e.t>=t0+B&&e.r).map(e=>[e.t,e.r]))*k).toFixed(1));
const gcs=res.filter(e=>e.gc);console.log('GC zamanları (dk):',gcs.map(e=>((e.t-t0)/60000).toFixed(1)).join(' '));console.log('GC ms:',gcs.map(e=>Math.round(e.gc.gcMs)).join(' '),'serbest MB:',gcs.map(e=>MB(e.gc.beforeBytes-e.r)).join(' '));
const gaps=gcs.slice(1).map((e,i)=>e.t-gcs[i].t);console.log('GC arası sn min/med:',gaps.length?Math.round(Math.min(...gaps)/1000):null,gaps.length?Math.round(med(gaps)/1000):null);
console.log('işçi oluşturma (dk):',spawn.map(e=>((e.t-t0)/60000).toFixed(1)).join(' '));
const n503=edits.filter(e=>e.cp.status!==200),o503=edits.filter(e=>e.orders.status!==200);console.log('CP okuma 503:',n503.length,'/',edits.length,'Siparişler !200:',o503.length,'kayıt !2xx:',edits.filter(e=>!(e.save.status>=200&&e.save.status<300)).length);
for(const kind of ['suppFob','note']){const es=edits.filter(e=>e.kind===kind&&e.cp.status===200);console.log(kind,'n',es.length,'cpWait med',Math.round(med(es.map(e=>e.cpWaitMs))),'ready med',Math.round(med(es.map(e=>e.cpWaitMs+e.orders.ms))));}
console.log('final digest',String(r.final&&r.final.digest||'').slice(0,12),'count',r.final&&r.final.count);
