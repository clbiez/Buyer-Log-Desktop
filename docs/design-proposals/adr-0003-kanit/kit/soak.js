'use strict';
// Uzun oturum (bellek dayanıklılığı) iş yükü (repo dışı). node soak.js <APP> <SOURCE> <out.json>
// Tek sunucu, 30k. Döngü: Supp. FOB (PATCH, delType yok) / not (/batch) dönüşümlü kayıt → cp/computed since (CP okuma)
// → orders/query (Siparişler okuma), sonra SOAK_GAP_MS bekleme. t0 = kayıt isteği gönderilmeden hemen önce (istemci Date.now).
// Her SOAK_CHECK_MIN dakikada: tam okuma (since yok) özeti ↔ istemci artımlı birikim özeti. Sonda: projeksiyon önbelleği
// silinip sıfırdan tam kurulum özeti ↔ oturumun son tam okuma özeti. SOAK_MIN (varsayılan 100) dakika.
const L=require('./lib.js'),fs=require('fs'),path=require('path'),crypto=require('crypto');
const [APP,SOURCE,OUT]=process.argv.slice(2);
const MIN=Number(process.env.SOAK_MIN)||100,GAP=Number(process.env.SOAK_GAP_MS)||15000,CHECK=Number(process.env.SOAK_CHECK_MIN)||10;
const today=(()=>{const d=new Date(),p=n=>String(n).padStart(2,'0');return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}`;})();
const walk=(d,out=[])=>{for(const e of fs.readdirSync(d,{withFileTypes:true})){const p=path.join(d,e.name);if(e.isDirectory())walk(p,out);else out.push(p);}return out;};
(async()=>{
  const app=await L.createApp({APP,source:SOURCE,env:{},label:'soak'});
  const rep={runtime:{exec:process.execPath,node:process.versions.node,electron:process.versions.electron||null,NODE_OPTIONS:process.env.NODE_OPTIONS||'',
    gcRecheck:process.env.BUYER_LOG_COMPUTE_GC_RECHECK??null,flag:process.env.BUYER_LOG_CP_ROWPATCH_LEGACY??null},minutes:MIN,gapMs:GAP,edits:[],checks:[],errors:[]};
  const save=()=>fs.writeFileSync(OUT,JSON.stringify(rep));
  const post=async(u,body)=>{const t=performance.now();const r=await fetch(app.base+u,{method:'POST',headers:{cookie:app.cookie,'Content-Type':'application/json'},body:JSON.stringify(body)});const text=await r.text();return {ms:performance.now()-t,status:r.status,json:(()=>{try{return JSON.parse(text);}catch(_){return {raw:text.slice(0,200)};}})()};};
  const tuples=new Map();let token=null;
  const digest=()=>crypto.createHash('sha1').update([...tuples.keys()].sort().map(id=>tuples.get(id)).join('\n')).digest('hex');
  const absorb=cols=>{if(!cols)return 0;if(!cols.delta)tuples.clear();for(const r of cols.rows||[])tuples.set(String(r[0]),JSON.stringify(r));for(const id of cols.removed||[])tuples.delete(String(id));token=cols.token;return (cols.rows||[]).length;};
  const retry=async(fn)=>{let r,attempts=0,n503=0;const t=performance.now();for(;;){attempts++;r=await fn();if(r.status===503)n503++;if(r.status!==503||attempts>=20)break;await L.delay(500);}r.ms=performance.now()-t;r.attempts=attempts;r.n503=n503;return r;};
  const computed=async()=>{const r=await retry(()=>post('/api/read-model/cp/computed',{version:1,lang:'tr',...(token?{since:token}:{})}));
    if(r.status!==200)return {ms:r.ms,status:r.status,n503:r.n503,code:r.json&&r.json.code};const n=absorb(r.json.columns);const t=r.json.timing||{};
    return {ms:r.ms,status:200,n503:r.n503,delta:r.json.columns.delta,rows:n,reloaded:t.datasetReloaded,lease:t.service&&t.service.leaseMs,rowPatch:t.service&&t.service.rowPatch||null};};
  const orders=async()=>{const r=await retry(()=>post('/api/read-model/orders/query',{version:1,offset:0,limit:100}));return {ms:r.ms,status:r.status,n503:r.n503,loadMs:r.json&&r.json.timing&&r.json.timing.loadMs};};
  const fullCheck=async label=>{const before=digest(),cnt=tuples.size;token=null;const r=await computed();const after=digest();const c={label,t:Date.now(),incDigest:before,incCount:cnt,fullDigest:after,fullCount:tuples.size,equal:before===after,status:r.status,n503:r.n503,ms:Math.round(r.ms)};rep.checks.push(c);save();console.log('check',JSON.stringify(c));return c;};
  try{
    const bt=Date.now();await L.boot(app);rep.bootMs=Date.now()-bt;rep.serverPid=app.server.pid;
    rep.open=await computed();rep.openOrders=await orders();
    const q=await post('/api/read-model/cp/query',{version:1,lang:'tr',query:{version:1,columns:[],base:[],groups:{},today,offset:0,limit:1000,fields:['_id','Order Code','Model Name','C.Code','Notes','Ek Not','Supp. FOB']}});
    if(q.status!==200)throw Error('cp/query '+q.status);const rows=q.json.result.rows;rep.datasetRows=q.json.result.datasetRows;
    const start=Date.now();rep.start=start;let nextCheck=start+CHECK*60000;save();
    for(let i=0;Date.now()-start<MIN*60000;i++){
      const a=rows[(i*397+11)%rows.length];const kind=i%2?'note':'suppFob';const cpu0=app.cpu();const t0=Date.now();let s;
      if(kind==='suppFob'){const t=performance.now();const r=await fetch(app.base+'/api/overrides/'+a['Order Code'],{method:'PATCH',headers:{cookie:app.cookie,'Content-Type':'application/json'},body:JSON.stringify({model:a['Model Name'],ccode:a['C.Code'],notes:{Notes:a.Notes||'',NotesHtml:'',EkNot:a['Ek Not']||'',EkNotHtml:''},suppFob:100+(i%500)+0.25,suppFobMeta:{source:'manual'}})});await r.text();s={ms:performance.now()-t,status:r.status};}
      else{const t=performance.now();const r=await fetch(app.base+'/api/overrides/batch',{method:'POST',headers:{cookie:app.cookie,'Content-Type':'application/json'},body:JSON.stringify({items:[{orderCode:a['Order Code'],patch:{model:a['Model Name'],ccode:a['C.Code'],notes:{Notes:'soak not '+i,NotesHtml:'soak not '+i}}}]})});await r.text();s={ms:performance.now()-t,status:r.status};}
      const cp=await computed();const cpDone=Date.now();const or=await orders();const orDone=Date.now();
      const rec={i,kind,t0,save:{ms:Math.round(s.ms),status:s.status},cp:{...cp,ms:Math.round(cp.ms)},orders:{...or,ms:Math.round(or.ms)},cpWaitMs:cpDone-t0,ordersFromT0:orDone-t0,readyMs:orDone-t0};
      await L.delay(GAP);rec.cpuMs=app.cpu()-cpu0;rep.edits.push(rec);
      if(i%20===0){save();console.log(new Date().toISOString(),i,kind,JSON.stringify({cp:rec.cpWaitMs,ready:rec.readyMs,n503:cp.n503+or.n503,cpu:rec.cpuMs}));}
      if(Date.now()>=nextCheck){await fullCheck('min'+Math.round((Date.now()-start)/60000));nextCheck+=CHECK*60000;}
    }
    rep.end=Date.now();await L.delay(5000);const fin=await fullCheck('final');
    // Bağımsız taban: projeksiyon önbelleği silinir, sıfırdan tam kurulum
    await app.stop();const removed=[];for(const f of walk(app.root).filter(p=>/page-cache/.test(p)&&/manifest\.json(\.bak)?$/.test(p))){removed.push(path.relative(app.root,path.dirname(f)));fs.rmSync(path.dirname(f),{recursive:true,force:true});}
    await app.start();await app.login();token=null;const r=await computed();rep.baseline={cacheRemoved:removed,status:r.status,digest:digest(),count:tuples.size,equalToFinal:digest()===fin.fullDigest};
  }catch(e){rep.errors.push(String(e.stack||e).slice(0,600));}
  finally{save();await app.stop();}
})();
