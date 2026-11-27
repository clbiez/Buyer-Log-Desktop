'use strict';
// node analyze.js <dir> — dönüşümlü A/B özet: çift farkları, medyan, ham örnekler, veri eşitliği.
const fs=require('fs'),path=require('path');
const dir=process.argv[2];
const runs=fs.readdirSync(dir).filter(f=>/^r\d+-(on|off)\.json$/.test(f)).sort((a,b)=>parseInt(a.slice(1))-parseInt(b.slice(1))).map(f=>({f,...JSON.parse(fs.readFileSync(path.join(dir,f),'utf8'))}));
const med=a=>{const s=[...a].sort((x,y)=>x-y);const n=s.length;return n?(n%2?s[(n-1)/2]:(s[n/2-1]+s[n/2])/2):null;};
const r0=v=>v==null?null:Math.round(v);
const metric={
  cpWaitMs:e=>e.cpWaitMs,                                  // kayıt başlangıcından CP karar sütunları yanıtına (kullanıcı beklemesi, CP)
  cpStatus:e=>e.cp.status,
  decisionMs:e=>e.cp.timing&&e.cp.timing.phases?e.cp.timing.phases.decisionMs:null,
  sourceMs:e=>e.cp.timing&&e.cp.timing.phases?e.cp.timing.phases.sourceMs:null,
  loadMs:e=>e.cp.timing?e.cp.timing.loadMs:null,          // veri kümesi yeniden yükleme (CP)
  leaseMs:e=>e.cp.timing&&e.cp.timing.service?e.cp.timing.service.leaseMs:null,
  ordersMs:e=>e.orders.ms,
  ordersLoadMs:e=>e.orders.timing?e.orders.timing.loadMs:null,
  cpuMs:e=>e.cpuMs,                                        // pencere (kayıt + okumalar + arka plan yeniden yazım + GAP) toplam sunucu CPU
};
const table=[];
for(const r of runs){
  const row={run:r.f,arm:r.arm,errors:r.errors.length,edits:r.edits.length,final:r.final&&{status:r.final.status,count:r.final.count,digest:r.final.digest&&r.final.digest.slice(0,12),verified:r.final.timing&&r.final.timing.service&&r.final.timing.service.rowPatch},open:r.open&&r.open.ms};
  for(const [k,fn] of Object.entries(metric))row[k]=r.edits.map(fn).map(v=>typeof v==='number'?r0(v):v);
  row.status503=r.edits.filter(e=>e.cp.status===503).length;
  row.rowPatch=r.edits.map(e=>e.cp.timing&&e.cp.timing.service&&e.cp.timing.service.rowPatch?JSON.stringify(e.cp.timing.service.rowPatch):e.cp.code||null);
  row.digests=r.edits.map(e=>e.digest.slice(0,8));
  table.push(row);
}
for(const t of table){console.log('\n'+t.run,'arm',t.arm,'errors',t.errors,'open',r0(t.open),'final',JSON.stringify(t.final));for(const k of [...Object.keys(metric),'status503','rowPatch','digests'])console.log('  ',k.padEnd(12),JSON.stringify(t[k]));}
// Kol özetleri: koşu başına medyan → kol medyanı; çift farkı (sıra: off on on off off on → çiftler (1,2) (4,3) (5,6)).
const perRun=k=>table.map(t=>({arm:t.arm,v:med(t[k].filter(x=>typeof x==='number'))}));
console.log('\nKoşu medyanları ve çiftler');
for(const k of ['cpWaitMs','decisionMs','loadMs','leaseMs','ordersMs','cpuMs']){
  const p=perRun(k);const off=p.filter(x=>x.arm==='off').map(x=>x.v),on=p.filter(x=>x.arm==='on').map(x=>x.v);
  const pairs=[];for(let i=0;i+1<p.length;i+=2){const a=p[i],b=p[i+1];const o=a.arm==='off'?a:b,n=a.arm==='on'?a:b;if(o.arm==='off'&&n.arm==='on'&&o.v!=null&&n.v!=null)pairs.push(r0(n.v-o.v));}
  console.log(k.padEnd(11),'off',JSON.stringify(off.map(r0)),'on',JSON.stringify(on.map(r0)),'medOff',r0(med(off)),'medOn',r0(med(on)),'pairΔ(on-off)',JSON.stringify(pairs));
}
// Veri eşitliği: aynı adımda bütün koşuların özetleri ve son tam okuma özeti.
const steps=Math.max(...table.map(t=>t.digests.length));
const eq=[];for(let i=0;i<steps;i++){const s=new Set(table.map(t=>t.digests[i]).filter(Boolean));eq.push(s.size);}
console.log('\nadım başına farklı özet sayısı (1 = bütün koşular aynı):',JSON.stringify(eq));
console.log('son tam okuma özetleri:',JSON.stringify(table.map(t=>t.final&&t.final.digest)));
