'use strict';
// Nihai doğrulama (B) kullanıcı algılı performans, tek kol tek koşu. node perf3.js <APP> <SOURCE> <arm> <out.json>
// 1) Açılış: soğuk = projeksiyon önbelleği silinmiş yeni süreç (ilk açılış/yenileme sonrası), ılık = önbellek korunmuş yeni süreç;
//    süreç başlangıcı → /api/status, tarayıcı goto → Siparişler ilk görünür satır (Playwright, yeni bağlam).
// 2) Kayıtlar (kendi istemci, gerçek istemci gövdeleri; t0 = istek gönderilmeden hemen önce): Supp. FOB PATCH (#1257 gövdesi:
//    delType yok), not /batch (1), toplu /batch-suppfob (5), toplu not /batch (5), Del. Type PATCH (açık niyet), düzenlenebilir
//    Ex-factory PATCH. Her biri: ack → cp/computed since=<token> (kendi CP hazır) → orders/query (Siparişler hazır); pencere CPU-ms
//    (/proc/<pid>/stat), 503 denemeleri. PERF_REPS (vars. 3) tekrar, PERF_GAP_MS (vars. 12000) aralık. Kolun desteklemediği
//    uç nokta/alan → durum kodu kaydedilir (analizde N/A).
const L=require('./lib.js'),fs=require('fs'),path=require('path'),crypto=require('crypto');
const [APP,SOURCE,ARM,OUT]=process.argv.slice(2);
const REPS=Number(process.env.PERF_REPS)||3,GAP=Number(process.env.PERF_GAP_MS)||12000;
const iso=d=>{const p=n=>String(n).padStart(2,'0');return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}`;};
const walk=(d,out=[])=>{for(const e of fs.readdirSync(d,{withFileTypes:true})){const p=path.join(d,e.name);if(e.isDirectory())walk(p,out);else out.push(p);}return out;};
(async()=>{
  const pkg=JSON.parse(fs.readFileSync(path.join(APP,'package.json'),'utf8'));
  const app=await L.createApp({APP,source:SOURCE,env:{},label:'perf3-'+ARM});
  const rep={arm:ARM,app:APP,version:pkg.version,reps:REPS,gapMs:GAP,runtime:{node:process.versions.node,electron:process.versions.electron||null,NODE_OPTIONS:process.env.NODE_OPTIONS||''},startup:{},saves:[],errors:[]};
  const save=()=>fs.writeFileSync(OUT,JSON.stringify(rep,null,1));
  const call=async(method,u,body)=>{const t=performance.now();let attempts=0,r,text;for(;;){attempts++;r=await fetch(app.base+u,{method,headers:{cookie:app.cookie,'Content-Type':'application/json'},...(body!==undefined?{body:JSON.stringify(body)}:{})});text=await r.text();if(r.status!==503||attempts>=10||!/read-model/.test(u))break; /* yazım 503'te yeniden denenmez: sayılır */await L.delay(500);}
    let json=null;try{json=JSON.parse(text);}catch(_){}return {ms:performance.now()-t,status:r.status,attempts,json,text:r.status===200?'':text.slice(0,200)};};
  const tuples=new Map();let token=null;
  const absorb=cols=>{if(!cols)return 0;if(!cols.delta)tuples.clear();for(const r of cols.rows||[])tuples.set(String(r[0]),JSON.stringify(r));for(const id of cols.removed||[])tuples.delete(String(id));token=cols.token;return (cols.rows||[]).length;};
  const computed=async()=>{const r=await call('POST','/api/read-model/cp/computed',{version:1,lang:'tr',...(token?{since:token}:{})});if(r.status!==200)return {ms:r.ms,status:r.status,attempts:r.attempts,code:r.json&&r.json.code};
    const n=absorb(r.json.columns);const t=r.json.timing||{};return {ms:r.ms,status:200,attempts:r.attempts,delta:r.json.columns.delta,rows:n,rowPatch:t.service&&t.service.rowPatch||null,reloaded:t.datasetReloaded};};
  const ordersQuery=async()=>{const r=await call('POST','/api/read-model/orders/query',{version:1,offset:0,limit:100});return {ms:r.ms,status:r.status,attempts:r.attempts};};
  const openOrders=async label=>{const {browser,context}=await L.newBrowser(app);try{const o=await L.openModule(app,context,'orders');rep.startup[label].ordersFirstRowMs=o.waitMs;rep.startup[label].net=o.net.since(0);rep.startup[label].pageErrors=o.page.__errors||[];}
    catch(e){rep.startup[label].error=String(e.message||e).slice(0,300);}finally{await browser.close();}};
  try{
    const b0=Date.now();await L.boot(app);rep.bootMs=Date.now()-b0;
    // 1 · Açılış
    await app.stop();const removed=walk(app.root).filter(p=>/page-cache/.test(p)&&/manifest\.json(\.bak)?$/.test(p)).map(f=>path.dirname(f));for(const d of removed)fs.rmSync(d,{recursive:true,force:true});
    rep.startup.cold={cacheDirsRemoved:removed.length};rep.startup.cold.serverReadyMs=await app.start();await app.login();await openOrders('cold');save();
    await app.stop();rep.startup.warm={};rep.startup.warm.serverReadyMs=await app.start();await app.login();await openOrders('warm');save();
    await L.delay(5000);
    // 2 · Satır seçimi (tüm sayfalar, aynı fixture → kollar arası aynı satırlar; kodlar raporda)
    const F=['_id','Order Code','Model Name','C.Code','Del. Type','Ex-factory','_logisticSegments','_exFactoryRevision','Notes','Ek Not'];
    const meta=[];for(let off=0;;off+=1000){const r=await call('POST','/api/read-model/cp/query',{version:1,lang:'tr',query:{version:1,columns:[],base:[],groups:{},today:iso(new Date()),offset:off,limit:1000,fields:F}});if(r.status!==200)throw Error('cp/query '+r.status+r.text);meta.push(...r.json.result.rows);if(r.json.result.rows.length<1000)break;}
    rep.rows=meta.length;
    const prod=meta.filter(r=>Array.isArray(r._logisticSegments)&&r._logisticSegments.length&&r._logisticSegments.every(s=>s.kind==='production'));
    const exCand=meta.filter(r=>r['Ex-factory']&&!(r._exFactoryRevision&&r._exFactoryRevision.source==='loading-approval'));
    rep.pool={prodOnly:prod.length,exCandidates:exCand.length};
    let cursor=0;const next=()=>prod[(cursor++*397+11)%prod.length];
    const line=r=>({model:r['Model Name'],ccode:r['C.Code']});
    const keepNotes=r=>({notes:{Notes:r.Notes||'',NotesHtml:'',EkNot:r['Ek Not']||'',EkNotHtml:''}});
    let exIdx=0;
    const KINDS={
      'Supp. FOB':i=>{const r=next();return {codes:[r['Order Code']],send:()=>call('PATCH','/api/overrides/'+r['Order Code'],{...line(r),...keepNotes(r),suppFob:100+i+0.25,suppFobMeta:{source:'manual'}})};},
      'not':i=>{const r=next();return {codes:[r['Order Code']],send:()=>call('POST','/api/overrides/batch',{items:[{orderCode:r['Order Code'],patch:{...line(r),notes:{Notes:'perf not '+i,NotesHtml:'perf not '+i}}}]})};},
      'toplu Supp. FOB (5)':i=>{const rs=[0,1,2,3,4].map(next);return {codes:rs.map(r=>r['Order Code']),send:()=>call('POST','/api/overrides/batch-suppfob',{items:rs.map((r,k)=>({orderCode:r['Order Code'],...line(r),suppFob:300+i+k/10}))})};},
      'toplu not (5)':i=>{const rs=[0,1,2,3,4].map(next);return {codes:rs.map(r=>r['Order Code']),send:()=>call('POST','/api/overrides/batch',{items:rs.map(r=>({orderCode:r['Order Code'],patch:{...line(r),notes:{Notes:'perf toplu '+i,NotesHtml:'perf toplu '+i}}}))})};},
      'Del. Type':i=>{const r=next();return {codes:[r['Order Code']],send:()=>call('PATCH','/api/overrides/'+r['Order Code'],{...line(r),delType:r['Del. Type']==='Uçak'?'Gemi':'Uçak'})};},
      'Ex-factory':async i=>{for(let k=0;k<40;k++){const r=exCand[(exIdx++*37+5)%Math.max(1,exCand.length)];if(!r)break;const d=new Date(r['Ex-factory']);d.setDate(d.getDate()+7+i);
        return {codes:[r['Order Code']],send:()=>call('PATCH','/api/overrides/'+r['Order Code'],{...line(r),dates:{exFactory:iso(d)}})};}return null;},
    };
    const open=await computed();rep.cpOpen=open;await L.delay(3000);
    const seriesCpu0=app.cpu(),seriesT0=Date.now();
    for(let i=0;i<REPS;i++)for(const [kind,make] of Object.entries(KINDS)){
      const plan=await make(i);if(!plan){rep.saves.push({kind,i,na:'aday satır yok'});continue;}
      const cpu0=app.cpu(),t0=performance.now(),w0=Date.now();const rec={kind,i,codes:plan.codes};
      const s=await plan.send();rec.save={ms:s.ms,status:s.status,attempts:s.attempts,code:s.json&&s.json.code||null,text:s.text};rec.ackMs=s.ms;
      if(s.status===200){rec.cp=await computed();rec.cpReadyMs=performance.now()-t0;rec.orders=await ordersQuery();rec.ordersReadyMs=performance.now()-t0;}
      await L.delay(GAP);rec.cpuMs=app.cpu()-cpu0;rec.windowMs=Date.now()-w0;rep.saves.push(rec);save();
      console.log(ARM,i,kind,JSON.stringify({st:s.status,ack:Math.round(rec.ackMs),cp:Math.round(rec.cpReadyMs||-1),orders:Math.round(rec.ordersReadyMs||-1),cpu:rec.cpuMs,rp:rec.cp&&rec.cp.rowPatch&&rec.cp.rowPatch.steps}));}
    rep.serverCpuSeriesMs=app.cpu()-seriesCpu0;rep.seriesWallMs=Date.now()-seriesT0;
    await L.delay(4000);token=null;const fin=await computed();rep.final={status:fin.status,count:tuples.size,digest:crypto.createHash('sha1').update([...tuples.keys()].sort().map(id=>tuples.get(id)).join('\n')).digest('hex')};
    rep.total503Retries=rep.saves.reduce((s,r)=>s+((r.save&&r.save.attempts||1)-1)+((r.cp&&r.cp.attempts||1)-1)+((r.orders&&r.orders.attempts||1)-1),0);
  }catch(e){rep.errors.push(String(e.stack||e).slice(0,600));}
  finally{save();await app.stop();}
})();
