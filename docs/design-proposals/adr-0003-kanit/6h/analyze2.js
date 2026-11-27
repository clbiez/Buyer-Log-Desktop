'use strict';
const fs=require('fs'),path=require('path');const dir=process.argv[2];
const runs=fs.readdirSync(dir).filter(f=>/^r\d+-(base|fix)\.json$/.test(f)).sort((a,b)=>parseInt(a.slice(1))-parseInt(b.slice(1))).map(f=>({f,...JSON.parse(fs.readFileSync(path.join(dir,f),'utf8'))}));
const med=a=>{const s=a.filter(x=>typeof x==='number').sort((x,y)=>x-y),n=s.length;return n?(n%2?s[(n-1)/2]:(s[n/2-1]+s[n/2])/2):null;};const r0=v=>v==null?null:Math.round(v);
const M={cpWait:e=>e.cpWaitMs,orders:e=>e.orders.ms,ready:e=>e.cpWaitMs+e.orders.ms,lease:e=>e.cp.timing&&e.cp.timing.service?e.cp.timing.service.leaseMs:null,load:e=>e.cp.timing?e.cp.timing.loadMs:null,decision:e=>e.cp.timing&&e.cp.timing.phases?e.cp.timing.phases.decisionMs:null,cpu:e=>e.cpuMs,save:e=>e.save.ms};
for(const kind of ['delType','suppFob']){
  console.log('\n=== '+kind);
  for(const r of runs){const ed=r.edits.filter(e=>e.kind===kind);console.log(r.f.padEnd(13),'err',r.errors.length,'503',ed.filter(e=>e.cp.status!==200).length+'/'+ed.length,'save',JSON.stringify(ed.map(e=>e.save.status)),Object.entries(M).map(([k,f])=>k+'='+JSON.stringify(ed.map(f).map(r0))).join(' '));}
  for(const k of Object.keys(M)){const p=runs.map(r=>({arm:r.arm,v:med(r.edits.filter(e=>e.kind===kind).map(M[k]))}));const b=p.filter(x=>x.arm==='base').map(x=>r0(x.v)),f=p.filter(x=>x.arm==='fix').map(x=>r0(x.v));const pairs=[];for(let i=0;i+1<p.length;i+=2){const a=p[i],c=p[i+1];const B=a.arm==='base'?a:c,F=a.arm==='fix'?a:c;if(B.v!=null&&F.v!=null)pairs.push(r0(F.v-B.v));}
    console.log('  '+k.padEnd(9),'base',JSON.stringify(b),'fix',JSON.stringify(f),'medBase',r0(med(b)),'medFix',r0(med(f)),'pairΔ(fix-base)',JSON.stringify(pairs));}
}
console.log('\nfinal digests',JSON.stringify(runs.map(r=>r.arm+':'+(r.final&&r.final.digest||'').slice(0,12))));
