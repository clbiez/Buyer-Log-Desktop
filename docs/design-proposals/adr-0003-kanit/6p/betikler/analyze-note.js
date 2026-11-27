'use strict';
// pre-#1243 / main / mainAA: kayıt türü başına cpWait, ready (t0 = kayıt öncesi), CPU, 503; blok farkları.
const fs=require('fs'),path=require('path');const dir=process.argv[2];const ARMS=['pre','main','mainAA'];
const med=a=>{a=a.filter(x=>typeof x==='number').sort((x,y)=>x-y);const n=a.length;return n?(n%2?a[(n-1)/2]:(a[n/2-1]+a[n/2])/2):null;};const r0=v=>v==null?null:Math.round(v);
const runs=fs.readdirSync(dir).filter(f=>/^r\d+-\w+\.json$/.test(f)).sort((a,b)=>parseInt(a.slice(1))-parseInt(b.slice(1))).map(f=>({f,...JSON.parse(fs.readFileSync(path.join(dir,f),'utf8'))}));
for(const r of runs)console.log(r.f.padEnd(14),'503',r.edits.filter(e=>e.cp.status!==200).length+'/'+r.edits.length,'err',(r.errors||[]).length,'cpuTot',r.edits.reduce((s,e)=>s+e.cpuMs,0),'digest',String(r.final&&r.final.digest||'').slice(0,12));
const W={cpWait:e=>e.cpWaitMs,ready:e=>e.cpWaitMs+e.orders.ms,cpu:e=>e.cpuMs};
for(const kind of ['note','suppFob']){console.log('\n=== '+kind);
 for(const [k,f] of Object.entries(W)){const per=runs.map(r=>({arm:r.arm,v:med(r.edits.filter(e=>e.kind===kind).map(f))}));const by=a=>per.filter(x=>x.arm===a).map(x=>r0(x.v));
  const blocks=[];for(let i=0;i+2<per.length;i+=3){const b=per.slice(i,i+3),g=a=>(b.find(x=>x.arm===a)||{}).v;blocks.push({'main-pre':r0(g('main')-g('pre')),'AA':r0(g('mainAA')-g('main'))});}
  console.log('  '+k.padEnd(7),ARMS.map(a=>a+JSON.stringify(by(a))+'|'+r0(med(by(a)))).join(' '),'bloklar',JSON.stringify(blocks));}
 for(const r of runs)console.log('   ',r.f.padEnd(14),JSON.stringify(r.edits.filter(e=>e.kind===kind).map(e=>[e.cp.status,r0(e.cpWaitMs),r0(e.cpWaitMs+e.orders.ms)])));}
