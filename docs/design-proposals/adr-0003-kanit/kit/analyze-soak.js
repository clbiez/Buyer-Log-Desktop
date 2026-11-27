'use strict';
// soak.js + hook-soak.js özeti: dakika serisi (CSV) + özet. node analyze-soak.js <soak.json> <soak.hook> <out-dir>
const fs=require('fs'),path=require('path');const [J,H,D]=process.argv.slice(2);
const rep=JSON.parse(fs.readFileSync(J,'utf8'));const h=fs.readFileSync(H,'utf8').trim().split('\n').map(l=>{try{return JSON.parse(l);}catch(_){return null;}}).filter(Boolean);
const MB=b=>b==null?null:Math.round(b/1048576);const med=a=>{const s=a.filter(x=>typeof x==='number'&&isFinite(x)).sort((x,y)=>x-y),n=s.length;return n?(n%2?s[(n-1)/2]:(s[n/2-1]+s[n/2])/2):null;};
const pct=(a,p)=>{const s=a.filter(x=>typeof x==='number').sort((x,y)=>x-y);return s.length?s[Math.min(s.length-1,Math.floor(p*s.length))]:null;};
const start=rep.start,end=rep.end||Math.max(...rep.edits.map(e=>e.t0));const inS=t=>t>=start&&t<=end;
const mem=h.filter(e=>e.ev==='mem'&&inS(e.t)),pool=h.filter(e=>e.ev==='pool'&&inS(e.t));
const spawns=h.filter(e=>e.ev==='spawn'&&inS(e.t)),exits=h.filter(e=>e.ev==='exit'&&inS(e.t)),terms=h.filter(e=>e.ev==='terminate'&&inS(e.t));
// Emeklilik nedeni çıkarımı: terminate öncesi aynı işçinin son sonucu (ok:false → kod; retained > limit → ESTIMATE/retained); şerit boşta bırakma sayacı artışı → lane-idle.
const runs=h.filter(e=>e.ev==='run'),results=h.filter(e=>e.ev==='result');
const reasons={};const term=[];
for(const t of terms){const lastRes=results.filter(r=>r.wid===t.wid&&r.t<=t.t).pop();const lastRun=lastRes&&runs.filter(r=>r.wid===t.wid&&r.id===lastRes.id&&r.t<=lastRes.t).pop();
  const pb=pool.filter(p=>p.t<=t.t).pop(),pa=pool.filter(p=>p.t>=t.t)[0];
  let reason='other';if(lastRes&&lastRes.ok===false)reason='fail:'+lastRes.code;else if(lastRes&&lastRun&&lastRun.limit&&lastRes.r>lastRun.limit)reason='retained>limit';
  else if(pb&&pa&&pb.lane&&pa.lane&&pa.lane.laneIdleReleases>pb.lane.laneIdleReleases)reason='lane-idle';
  else if(lastRes&&t.t-lastRes.t<50)reason='after-result(budget/generation)';else reason='idle(generation/budget)';
  reasons[reason]=(reasons[reason]||0)+1;term.push({t:t.t-start,wid:t.wid,reason,lastTask:lastRun&&lastRun.task,r:lastRes&&MB(lastRes.r),limit:lastRun&&MB(lastRun.limit)});}
// Dakika serisi
const rows=[];const N=Math.ceil((end-start)/60000);
for(let m=0;m<N;m++){const a=start+m*60000,b=a+60000;const mm=mem.filter(e=>e.t>=a&&e.t<b);const pp=pool.filter(e=>e.t>=a&&e.t<b);const ed=rep.edits.filter(e=>e.t0>=a&&e.t0<b);
  const last=pp[pp.length-1]||{};
  rows.push({min:m,rssMax:MB(Math.max(...mm.map(e=>e.rss))),rssMed:MB(med(mm.map(e=>e.rss))),heapMed:MB(med(mm.map(e=>e.heapUsed))),heapMax:MB(Math.max(...mm.map(e=>e.heapUsed))),hwm:MB(mm.length?mm[mm.length-1].hwm:null),
    mainRetained:MB(last.main&&last.main.retained),laneRetained:MB(last.lane&&last.lane.retained),mainWorkers:last.main&&last.main.workers,laneWorkers:last.lane&&last.lane.workers,
    spawns:spawns.filter(e=>e.t>=a&&e.t<b).length,exits:exits.filter(e=>e.t>=a&&e.t<b).length,edits:ed.length,n503:ed.reduce((s,e)=>s+(e.cp.n503||0)+(e.orders.n503||0),0),
    cpWaitMed:med(ed.map(e=>e.cpWaitMs)),readyMed:med(ed.map(e=>e.readyMs)),cpuMs:ed.reduce((s,e)=>s+(e.cpuMs||0),0)});}
const cols=Object.keys(rows[0]||{});fs.mkdirSync(D,{recursive:true});
fs.writeFileSync(path.join(D,'seri-dakika.csv'),[cols.join(','),...rows.map(r=>cols.map(c=>r[c]??'').join(','))].join('\n')+'\n');
// Eğim (MB/saat) — en küçük kareler; ilk 30 / son 30 dk / tümü
const slope=(pts)=>{const n=pts.length;if(n<2)return null;const mx=pts.reduce((s,p)=>s+p[0],0)/n,my=pts.reduce((s,p)=>s+p[1],0)/n;const num=pts.reduce((s,p)=>s+(p[0]-mx)*(p[1]-my),0),den=pts.reduce((s,p)=>s+(p[0]-mx)**2,0);return den?Math.round(num/den*60*10)/10:null;};
const ser=(k,from,to)=>rows.filter(r=>r.min>=from&&r.min<to&&r[k]!=null).map(r=>[r.min,r[k]]);
const sl={};for(const k of ['rssMed','heapMed','mainRetained','laneRetained','rssMax'])sl[k]={first30:slope(ser(k,0,30)),last30:slope(ser(k,N-30,N)),all:slope(ser(k,0,N))};
const slices=[[0,30],[30,60],[60,90],[90,N]].filter(([a])=>a<N).map(([a,b])=>{const ed=rep.edits.filter(e=>e.t0>=start+a*60000&&e.t0<start+b*60000);const mm=mem.filter(e=>e.t>=start+a*60000&&e.t<start+b*60000);
  return {dk:`${a}-${Math.min(b,N)}`,edits:ed.length,cpWaitMed:med(ed.map(e=>e.cpWaitMs)),cpWaitP90:pct(ed.map(e=>e.cpWaitMs),0.9),readyMed:med(ed.map(e=>e.readyMs)),readyP90:pct(ed.map(e=>e.readyMs),0.9),
    suppFobReadyMed:med(ed.filter(e=>e.kind==='suppFob').map(e=>e.readyMs)),noteReadyMed:med(ed.filter(e=>e.kind==='note').map(e=>e.readyMs)),
    n503:ed.reduce((s,e)=>s+(e.cp.n503||0)+(e.orders.n503||0),0),cpuMsPerEdit:med(ed.map(e=>e.cpuMs)),rssMedMB:MB(med(mm.map(e=>e.rss))),heapMedMB:MB(med(mm.map(e=>e.heapUsed)))};});
const out={runtime:rep.runtime,bootMs:rep.bootMs,datasetRows:rep.datasetRows,durationMin:Math.round((end-start)/60000),edits:rep.edits.length,
  saveStatus:rep.edits.reduce((o,e)=>(o[e.save.status]=(o[e.save.status]||0)+1,o),{}),nonOkReads:rep.edits.filter(e=>e.cp.status!==200||e.orders.status!==200).length,
  total503:rep.edits.reduce((s,e)=>s+(e.cp.n503||0)+(e.orders.n503||0),0),editsWith503:rep.edits.filter(e=>(e.cp.n503||0)+(e.orders.n503||0)>0).length,
  memory:{rssStartMB:rows[0]&&rows[0].rssMed,rssEndMB:rows[rows.length-1]&&rows[rows.length-1].rssMed,rssPeakMB:MB(Math.max(...mem.map(e=>e.rss))),hwmEndMB:MB(mem.length?mem[mem.length-1].hwm:null),
    heapStartMB:rows[0]&&rows[0].heapMed,heapEndMB:rows[rows.length-1]&&rows[rows.length-1].heapMed,heapPeakMB:MB(Math.max(...mem.map(e=>e.heapUsed))),
    mainRetainedMaxMB:MB(Math.max(0,...pool.map(p=>p.main&&p.main.retained||0))),laneRetainedMaxMB:MB(Math.max(0,...pool.map(p=>p.lane&&p.lane.retained||0)))},
  slopeMBperHour:sl,workers:{spawns:spawns.length,exits:exits.length,terminates:terms.length,reasons,exitCodes:exits.reduce((o,e)=>(o[e.code]=(o[e.code]||0)+1,o),{})},
  waits:{cpWaitMed:med(rep.edits.map(e=>e.cpWaitMs)),cpWaitP90:pct(rep.edits.map(e=>e.cpWaitMs),0.9),readyMed:med(rep.edits.map(e=>e.readyMs)),readyP90:pct(rep.edits.map(e=>e.readyMs),0.9),readyMax:Math.max(...rep.edits.map(e=>e.readyMs))},
  slices,checks:rep.checks.map(c=>({label:c.label,equal:c.equal,count:c.fullCount,inc:String(c.incDigest).slice(0,12),full:String(c.fullDigest).slice(0,12)})),baseline:rep.baseline,errors:rep.errors};
fs.writeFileSync(path.join(D,'emeklilik.json'),JSON.stringify(term,null,1));fs.writeFileSync(path.join(D,'ozet.json'),JSON.stringify(out,null,1));console.log(JSON.stringify(out,null,1));
