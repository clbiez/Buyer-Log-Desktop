'use strict';
// #1236 t0: t0 = kayıt isteği gönderilmeden hemen önce (istemci Date.now). Mod başına CP / Orders / ikisi hazır (t0'dan), CPU,
// istek bazında sunucu aşamaları (kanca: işçiye gönderim run.t, sonuç result.t; CP için havuz çağrısı call.t ve kuyruk q).
const fs=require('fs'),path=require('path');const dir=process.argv[2];const ARMS=['off','on','offAA'];
const med=a=>{const s=a.filter(x=>typeof x==='number'&&isFinite(x)).sort((x,y)=>x-y),n=s.length;return n?(n%2?s[(n-1)/2]:(s[n/2-1]+s[n/2])/2):null;};const r0=v=>v==null?null:Math.round(v);
const runs=fs.readdirSync(dir).filter(f=>/^r\d+-\w+\.json$/.test(f)).sort((a,b)=>parseInt(a.slice(1))-parseInt(b.slice(1))).map(f=>{const j=JSON.parse(fs.readFileSync(path.join(dir,f),'utf8'));
  const h=fs.readFileSync(path.join(dir,f.replace('.json','.hook')),'utf8').trim().split('\n').map(l=>{try{return JSON.parse(l);}catch(_){return {};}});return {f,...j,h};});
function jobs(h){const open=[],out=[];for(const e of h){if(e.ev==='run')open.push({...e});else if(e.ev==='result'){let k=-1;for(let i=open.length-1;i>=0;i--)if(open[i].id===e.id){k=i;break;}if(k>=0){const r=open.splice(k,1)[0];out.push({task:r.task,warm:r.warm,buffer:r.buffer,runT:r.t,resT:e.t,ms:e.ms,ok:e.ok,code:e.code});}}}return out;}
for(const r of runs){const J=jobs(r.h);const calls=r.h.filter(e=>e.ev==='call'||e.ev==='lease'||e.ev==='reject');
  for(const e of r.edits){const cpStart=e.mode==='ordersOnly'?e.ordersDoneAt:e.saveDoneAt;const cpEnd=e.cpDoneAt,orS=e.ordersStartAt,orE=e.ordersDoneAt;
    const inWin=(s,t,pred)=>J.filter(j=>j.runT>=s-5&&j.runT<=t&&pred(j.task));
    const cpJ=inWin(cpStart,cpEnd,t=>/cp-/.test(t)),orJ=inWin(orS,orE,t=>/read-model-query|orders-facets/.test(t));
    const cpCalls=calls.filter(c=>c.t>=cpStart-5&&c.t<=cpEnd&&/cp-computed/.test(c.task));
    const lastCp=cpJ.filter(j=>!j.warm).pop()||cpJ[cpJ.length-1];const lastOr=orJ.filter(j=>!j.warm).pop()||orJ[orJ.length-1];
    e.st={cp:{preDispatch:cpJ.length?cpJ[0].runT-cpStart:null,workerMs:cpJ.reduce((s,j)=>s+(j.ms||0),0),jobs:cpJ.map(j=>j.task.replace('read-model-','')+(j.warm?'(w)':'')+(j.buffer?'(B)':'')+':'+j.ms).join(','),
        poolQueue:cpCalls.filter(c=>c.ev==='lease').reduce((s,c)=>s+(c.q||0),0),rejects:cpCalls.filter(c=>c.ev==='reject').length,post:lastCp?cpEnd-lastCp.resT:null,attempts:e.cp.attempts},
      or:{preDispatch:orJ.length?orJ[0].runT-orS:null,workerMs:orJ.reduce((s,j)=>s+(j.ms||0),0),jobs:orJ.map(j=>j.task.replace('read-model-','')+(j.warm?'(w)':'')+(j.buffer?'(B)':'')+':'+j.ms).join(','),post:lastOr?orE-lastOr.resT:null,loadMs:e.orders.timing&&r0(e.orders.timing.loadMs),attempts:e.orders.attempts}};}}
const F={cpT0:e=>e.cpWaitMs,ordersT0:e=>e.ordersFromT0,bothT0:e=>e.bothFromT0,save:e=>e.save&&e.save.ms,cpu:e=>e.cpuMs,cpPre:e=>e.st.cp.preDispatch,cpQueue:e=>e.st.cp.poolQueue,cpWorker:e=>e.st.cp.workerMs,orPre:e=>e.st.or.preDispatch,orWorker:e=>e.st.or.workerMs,orLoad:e=>e.st.or.loadMs,orPost:e=>e.st.or.post};
for(const mode of ['seq','par','ordersOnly'])for(const kind of ['suppFob','note']){
  console.log(`\n=== ${mode} / ${kind}`);
  for(const [k,f] of Object.entries(F)){const per=runs.map(r=>({arm:r.arm,v:med(r.edits.filter(e=>e.mode===mode&&e.kind===kind).map(f))}));const by=a=>per.filter(x=>x.arm===a).map(x=>r0(x.v));
    const blocks=[];for(let i=0;i+2<per.length;i+=3){const b=per.slice(i,i+3),g=a=>(b.find(x=>x.arm===a)||{}).v;blocks.push([r0(g('on')-g('off')),r0(g('offAA')-g('off'))]);}
    console.log('  '+k.padEnd(9),ARMS.map(a=>a+JSON.stringify(by(a))).join(' '),'| med',ARMS.map(a=>r0(med(by(a)))).join('/'),'| blok[on-off,AA]',JSON.stringify(blocks));}
  console.log('  ham (t0→CP, t0→Orders, ikisi; CP işler | Orders işler):');
  for(const r of runs)for(const e of r.edits.filter(e=>e.mode===mode&&e.kind===kind))console.log('   ',r.f.padEnd(12),r0(e.cpWaitMs),r0(e.ordersFromT0),r0(e.bothFromT0),'cp['+e.cp.status+(e.cp.attempts>1?'x'+e.cp.attempts:'')+' pre '+r0(e.st.cp.preDispatch)+' q '+e.st.cp.poolQueue+' '+e.st.cp.jobs+']','or[pre '+r0(e.st.or.preDispatch)+' load '+e.st.or.loadMs+' '+e.st.or.jobs+']');}
console.log('\n503/yeniden deneme:',JSON.stringify(runs.map(r=>r.arm+':'+r.edits.map(e=>(e.cp.attempts||1)-1).join(''))));
console.log('final digests',JSON.stringify(runs.map(r=>r.arm+':'+String(r.final&&r.final.digest||'').slice(0,12))));
