'use strict';
// fresh2 aşama tablosu: koşu/deneme başına SSE, loadFromServer, projeksiyon, cp/computed, CP state/DOM, Siparişler state/DOM (t0 = U2 PATCH).
const fs=require('fs'),path=require('path');const dir=process.argv[2];
const files=fs.readdirSync(dir).filter(f=>/^r\d+-\w+\.json$/.test(f)).sort((a,b)=>parseInt(a.slice(1))-parseInt(b.slice(1)));
const rng=a=>{a=a.filter(x=>typeof x==='number');return a.length?Math.min(...a)+'–'+Math.max(...a):'—';};
const med=a=>{a=a.filter(x=>typeof x==='number').sort((x,y)=>x-y);const n=a.length;return n?(n%2?a[(n-1)/2]:(a[n/2-1]+a[n/2])/2):null;};
const byArm={};
for(const f of files){const r=JSON.parse(fs.readFileSync(path.join(dir,f),'utf8'));const arm=f.split('-')[1].replace('.json','');
  for(const t of r.trials){const sse=(t.cpEvents||[]).find(e=>/^sse/.test(e.via));const bc=(t.ordersEvents||[]).find(e=>e.via==='bc');
    const lfs=(t.cpLfs||[])[0];const pend=(net,re)=>{const x=(net||[]).filter(n=>re.test(n.p)&&n.endMs!=null);return x.length?Math.max(...x.map(n=>n.endMs)):null;};
    const cnt=(net,re)=>(net||[]).filter(n=>re.test(n.p)).length;
    const row={f,ack:t.ackMs,sse:sse&&sse.ms,bc:bc&&bc.ms,lfs:lfs&&lfs.ms,lfsEnd:lfs&&lfs.endMs,projCp:pend(t.cpNet,/page-projection\/cp/),projOr:pend(t.ordersNet,/page-projection\/orders/),
      cpComputed:pend(t.cpNet,/cp\/computed/),cpComputedN:cnt(t.cpNet,/cp\/computed/),ordersCpComputedN:cnt(t.ordersNet,/cp\/computed/),cpState:t.cpState,cpDom:t.cpDom,ordersState:t.ordersState,ordersDom:t.ordersDom};
    (byArm[arm]=byArm[arm]||[]).push(row);console.log(arm.padEnd(4),JSON.stringify(row));}
  if(r.errors&&r.errors.length)console.log('HATA',f,r.errors[0].slice(0,200));}
const K=['ack','sse','bc','lfs','lfsEnd','projCp','projOr','cpComputed','cpComputedN','cpState','cpDom','ordersState','ordersDom'];
console.log('\naşama (ms, t0 = PATCH)        '+Object.keys(byArm).map(a=>a+' aralık | medyan').join('   '));
for(const k of K)console.log(k.padEnd(14),Object.entries(byArm).map(([a,rs])=>rng(rs.map(r=>r[k])).padEnd(14)+'| '+med(rs.map(r=>r[k]))).join('   '));
