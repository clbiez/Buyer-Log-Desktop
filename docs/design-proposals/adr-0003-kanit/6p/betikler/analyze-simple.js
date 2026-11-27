'use strict';
// Kısa koşu özeti (ab3 + hook-mem): 503, işçi, GC, tepe RSS, CPU, ready medyanları, veri özeti.
const fs=require('fs'),path=require('path');const dir=process.argv[2];
const med=a=>{a=a.slice().sort((x,y)=>x-y);const n=a.length;return n?(n%2?a[(n-1)/2]:(a[n/2-1]+a[n/2])/2):null};
for(const f of fs.readdirSync(dir).filter(f=>/^r\d+-\w+\.json$/.test(f)).sort((a,b)=>parseInt(a.slice(1))-parseInt(b.slice(1)))){
 const r=JSON.parse(fs.readFileSync(path.join(dir,f)));const h=fs.readFileSync(path.join(dir,f.replace('.json','.hook')),'utf8').trim().split('\n').map(l=>JSON.parse(l));
 const k=kind=>r.edits.filter(e=>e.kind===kind);const g=h.filter(e=>e.ev==='result'&&e.gc);const res=h.filter(e=>e.ev==='result'&&e.r);
 console.log(f.padEnd(16),'err',(r.errors||[]).length,'503',r.edits.filter(e=>e.cp.status!==200).length+'/'+r.edits.length,'spawn',h.filter(e=>e.ev==='spawn').length,'gc',g.length,JSON.stringify(g.map(e=>Math.round(e.gc.gcMs))),'skip',h.filter(e=>e.skip).length,
  'peakMB',Math.round(Math.max(...h.filter(e=>e.ev==='mem').map(e=>e.hwm))/1048576),'wRetMaxMB',Math.round(Math.max(0,...res.map(e=>e.r))/1048576),'cpuTot',r.edits.reduce((s,e)=>s+e.cpuMs,0),
  'noteReady',Math.round(med(k('note').map(e=>e.cpWaitMs+e.orders.ms))),'fobReady',Math.round(med(k('suppFob').map(e=>e.cpWaitMs+e.orders.ms))),'digest',String(r.final&&r.final.digest||'').slice(0,12));}
