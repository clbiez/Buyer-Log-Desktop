'use strict';
// 3 kol: pre (b7b172d), main (57bb982), intent (3b23455). Koşu medyanları, kol medyanı, çiftler (her üçlü sıra bloğunda intent − main ve intent − pre).
const fs=require('fs'),path=require('path');const dir=process.argv[2];
const runs=fs.readdirSync(dir).filter(f=>/^r\d+-(off|on)\.json$/.test(f)).sort((a,b)=>parseInt(a.slice(1))-parseInt(b.slice(1))).map(f=>({f,...JSON.parse(fs.readFileSync(path.join(dir,f),'utf8'))}));
const med=a=>{const s=a.filter(x=>typeof x==='number').sort((x,y)=>x-y),n=s.length;return n?(n%2?s[(n-1)/2]:(s[n/2-1]+s[n/2])/2):null;};const r0=v=>v==null?null:Math.round(v);
const M={cpWait:e=>e.cpWaitMs,orders:e=>e.orders.ms,ready:e=>e.cpWaitMs+e.orders.ms,lease:e=>e.cp.timing&&e.cp.timing.service?e.cp.timing.service.leaseMs:null,load:e=>e.cp.timing?e.cp.timing.loadMs:null,decision:e=>e.cp.timing&&e.cp.timing.phases?e.cp.timing.phases.decisionMs:null,cpu:e=>e.cpuMs};
for(const kind of ['suppFob','note']){
  console.log('\n=== '+kind);
  for(const r of runs){const ed=r.edits.filter(e=>e.kind===kind);console.log(r.f.padEnd(14),'503',ed.filter(e=>e.cp.status!==200).length+'/'+ed.length,'save',JSON.stringify(ed.map(e=>e.save.status)),Object.entries(M).map(([k,f])=>k+'='+JSON.stringify(ed.map(f).map(r0))).join(' '));}
  for(const k of Object.keys(M)){const per=runs.map(r=>({arm:r.arm,v:med(r.edits.filter(e=>e.kind===kind).map(M[k]))}));const by=a=>per.filter(x=>x.arm===a).map(x=>r0(x.v));
    const blocks=[];for(let i=0;i+1<per.length;i+=2){const b=per.slice(i,i+2),g=a=>(b.find(x=>x.arm===a)||{}).v;blocks.push(r0(g('on')-g('off')));}
    console.log('  '+k.padEnd(9),'off',JSON.stringify(by('off')),'on',JSON.stringify(by('on')),'med off/on',r0(med(by('off'))),r0(med(by('on'))),'çiftler(on-off)',JSON.stringify(blocks));}
}
console.log('\nfinal digests',JSON.stringify(runs.map(r=>r.arm+':'+(r.final&&r.final.digest||'').slice(0,12))));
