'use strict';
// #1236 t0 ölçümü (repo dışı). node ab8.js <APP> <SOURCE> <arm> <out.json>; AB_FLAG=1 → BUYER_LOG_CP_ROWPATCH_LEGACY=1. t0 = kayıt isteği gönderilmeden hemen önce (istemci saati). Mod: i<2 sıralı (CP sonra Orders), 2-3 paralel (kayıt yanıtı sonrası CP+Orders aynı anda), 4-5 yalnız Orders.
// Her koşu: taze sunucu (30k), CP açılışı (tam cp/computed), sonra E düzenleme: gerçek istemci gövdesiyle
// PATCH /api/overrides/:kod → hemen cp/computed since=<token> (istemcinin onay sonrası isteği) → orders/query (Siparişler).
const L=require('../o3/lib.js'),fs=require('fs'),crypto=require('crypto');
const [APP,SOURCE,ARM,OUT]=process.argv.slice(2);
const env=process.env.AB_FLAG==='1'?{BUYER_LOG_CP_ROWPATCH_LEGACY:'1'}:{};
const GAP=Number(process.env.AB_GAP_MS)||14000;
const today=(()=>{const d=new Date(),p=n=>String(n).padStart(2,'0');return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}`;})();
(async()=>{
  const app=await L.createApp({APP,source:SOURCE,env,label:ARM});
  const rep={arm:ARM,app:APP,gapMs:GAP,edits:[],errors:[]};const save=()=>fs.writeFileSync(OUT,JSON.stringify(rep,null,1));
  const post=async(u,body)=>{const t=performance.now();const r=await fetch(app.base+u,{method:'POST',headers:{cookie:app.cookie,'Content-Type':'application/json'},body:JSON.stringify(body)});const text=await r.text();return {ms:performance.now()-t,status:r.status,json:(()=>{try{return JSON.parse(text);}catch(_){return {raw:text.slice(0,200)};}})()};};
  const patch=async(code,body)=>{const t=performance.now();const r=await fetch(app.base+'/api/overrides/'+code,{method:'PATCH',headers:{cookie:app.cookie,'Content-Type':'application/json'},body:JSON.stringify(body)});const text=await r.text();return {ms:performance.now()-t,status:r.status,body:text.slice(0,160)};};
  const tuples=new Map();let token=null;
  const absorb=cols=>{if(!cols)return 0;if(!cols.delta)tuples.clear();for(const r of cols.rows||[])tuples.set(String(r[0]),JSON.stringify(r));for(const id of cols.removed||[])tuples.delete(String(id));token=cols.token;return (cols.rows||[]).length;};
  const computed=async()=>{let r,attempts=0,t503=performance.now();for(;;){attempts++;r=await post('/api/read-model/cp/computed',{version:1,lang:'tr',...(token?{since:token}:{})});if(r.status!==503||attempts>=10)break;await L.delay(500);}if(attempts>1)r.ms=performance.now()-t503;r.attempts=attempts;
    if(r.status!==200)return {ms:r.ms,status:r.status,code:r.json.code,attempts:r.attempts};const n=absorb(r.json.columns);const t=r.json.timing||{};
    return {ms:r.ms,attempts:r.attempts,status:200,delta:r.json.columns.delta,rows:n,timing:{loadMs:t.loadMs,queryMs:t.queryMs,totalMs:t.totalMs,reused:t.reused,phases:t.phases,datasetReloaded:t.datasetReloaded,rowPatch:t.rowPatch,service:t.service,route:t.route}};};
  const ordersQuery=async()=>{let r,attempts=0;const t=performance.now();for(;;){attempts++;r=await post('/api/read-model/orders/query',{version:1,offset:0,limit:100});if(r.status!==503||attempts>=10)break;await L.delay(500);}return {ms:performance.now()-t,status:r.status,attempts,timing:r.json&&r.json.timing||null};};
  try{
    const bootT=Date.now();await L.boot(app);rep.bootMs=Date.now()-bootT;
    // CP açılışı: hesaplanmış sütunlar (tam) + satır kimlikleri.
    const open=await computed();rep.open=open;
    const q=await post('/api/read-model/cp/query',{version:1,lang:'tr',query:{version:1,columns:[],base:[],groups:{},today,offset:0,limit:1000,fields:['_id','Order Code','Model Name','C.Code','Del. Type','Notes','Ek Not','Supp. FOB']}});
    if(q.status!==200)throw Error('cp/query '+q.status+' '+JSON.stringify(q.json).slice(0,200));
    const rows=q.json.result.rows;rep.datasetRows=q.json.result.datasetRows;
    const pick=i=>rows[(i*397+11)%rows.length];
    const INTENT=process.env.AB_INTENT==='1';const body=(row,v)=>({model:row['Model Name'],ccode:row['C.Code'],notes:{Notes:row.Notes||'',NotesHtml:'',EkNot:row['Ek Not']||'',EkNotHtml:''},...(INTENT?{}:{delType:row['Del. Type']||undefined}),suppFob:v,suppFobMeta:{source:'manual'}});
    await L.delay(4000);
    const E=Number(process.env.AB_EDITS)||6;
    for(let i=0;i<E;i++){
      const double=false;
      const cpu0=app.cpu(),t0=Date.now();const rec={i,double};
      const a=pick(i);rec.code=a['Order Code'];rec.kind=i%2?'note':'suppFob';
      if(rec.kind==='suppFob')rec.save=await patch(a['Order Code'],body(a,100+i+0.25));
      else{const t=performance.now();const r=await fetch(app.base+'/api/overrides/batch',{method:'POST',headers:{cookie:app.cookie,'Content-Type':'application/json'},body:JSON.stringify({items:[{orderCode:a['Order Code'],patch:{model:a['Model Name'],ccode:a['C.Code'],notes:{Notes:'L2 not '+i,NotesHtml:'L2 not '+i}}}]})});rec.save={ms:performance.now()-t,status:r.status,body:(await r.text()).slice(0,160)};}
      rec.t0=t0;rec.saveDoneAt=Date.now();rec.mode=i<2?'seq':i<4?'par':'ordersOnly';
      const cpRun=async()=>{rec.cp=await computed();rec.cpDoneAt=Date.now();rec.cpWaitMs=rec.cpDoneAt-t0;
        const ids=[...tuples.keys()];rec.digest=crypto.createHash('sha1').update(ids.sort().map(id=>tuples.get(id)).join('\n')).digest('hex');
        };
      const orRun=async()=>{rec.ordersStartAt=Date.now();rec.orders=await ordersQuery();rec.ordersDoneAt=Date.now();rec.ordersFromT0=rec.ordersDoneAt-t0;};
      if(rec.mode==='seq'){await cpRun();await orRun();}else if(rec.mode==='par'){await Promise.all([cpRun(),orRun()]);}else{await orRun();await cpRun();}
      rec.bothFromT0=Math.max(rec.cpDoneAt,rec.ordersDoneAt)-t0;
      await L.delay(GAP);rec.cpuMs=app.cpu()-cpu0;rec.windowMs=Date.now()-t0;
      rep.edits.push(rec);save();
      console.log(ARM,i,rec.kind,JSON.stringify({save:Math.round(rec.save.ms),cp:Math.round(rec.cp.ms),orders:Math.round(rec.orders.ms),cpu:rec.cpuMs,lease:rec.cp.timing?.service?.leaseMs,rp:rec.cp.timing?.service?.rowPatch,dec:rec.cp.timing?.phases?.decisionMs,src:rec.cp.timing?.phases?.sourceMs,reload:rec.cp.timing?.datasetReloaded,load:rec.cp.timing?.loadMs}));
    }
    // Son durum: yeniden yazımlar bittikten sonra tam okuma (delta yok) — kollar arası veri eşitliği ve sanal doğrulama.
    await L.delay(4000);token=null;const fin=await computed();rep.final={...fin,count:tuples.size,digest:crypto.createHash('sha1').update([...tuples.keys()].sort().map(id=>tuples.get(id)).join('\n')).digest('hex')};
    const v=await computed();rep.verifyRead=v;
  }catch(e){rep.errors.push(String(e.stack||e).slice(0,500));}
  finally{save();await app.stop();}
})();
