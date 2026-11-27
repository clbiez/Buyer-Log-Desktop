'use strict';
// Uzak kullanıcı yolu (repo dışı): iki yerel sunucu aynı Shared Hub klasörünü paylaşır (OneDrive aktarımı yok = 0 sn varsayımı).
// Aşamalar: A yerel kayıt → A sync-now (Hub yayımı) → B sync-now (uzak algılama+uygulama) → B canlı olay → B projeksiyon (cp/query değeri).
// node hub.js <APP> <SOURCE> <out.json>
const L=require('../o3/lib.js'),fs=require('fs'),os=require('os'),path=require('path');
const [APP,SOURCE,OUT]=process.argv.slice(2);const rep={trials:[],errors:[],setup:{}};const save=()=>fs.writeFileSync(OUT,JSON.stringify(rep,null,1));
const today=(()=>{const d=new Date(),p=n=>String(n).padStart(2,'0');return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}`;})();
(async()=>{let A,B;const H=fs.mkdtempSync(path.join(os.tmpdir(),'buyerlog-hub-'));
 try{
  A=await L.createApp({APP,source:SOURCE,env:{},label:'hubA'});B=await L.createApp({APP,source:SOURCE,env:{},label:'hubB'});
  await L.boot(A);await L.boot(B);
  const j=async(app,u,init={})=>{const t=performance.now();const r=await fetch(app.base+u,{...init,headers:{cookie:app.cookie,'Content-Type':'application/json',...(init.headers||{})}});const text=await r.text();let json=null;try{json=JSON.parse(text);}catch(_){}return {ms:Math.round(performance.now()-t),status:r.status,json,text:text.slice(0,300)};};
  let t=Date.now();const init=await j(A,'/api/shared-hub/initialize',{method:'POST',body:JSON.stringify({root:H,confirmCritical:true})});rep.setup.initialize={ms:Date.now()-t,status:init.status,err:init.status!==200?init.text:null};save();
  if(init.status!==200)throw Error('initialize '+init.text);
  t=Date.now();const cfg=await j(B,'/api/shared-hub/configure',{method:'POST',body:JSON.stringify({root:H})});rep.setup.configure={status:cfg.status,err:cfg.status>=300?cfg.text:null};
  for(let i=0;i<600;i++){const st=await j(B,'/api/shared-hub/bootstrap-status');rep.setup.lastStatus=st.json&&{status:st.json.status,phase:st.json.phase,message:st.json.message};if(st.json&&st.json.status&&!/syncing|pending|running/i.test(st.json.status))break;await L.delay(1000);}
  rep.setup.bootstrapMs=Date.now()-t;save();
  try{await B.login();rep.setup.bLogin='ok';}catch(e){rep.setup.bLogin=String(e.message);}
  try{await A.login();}catch(_){}
  const q=async app=>{const r=await j(app,'/api/read-model/cp/query',{method:'POST',body:JSON.stringify({version:1,lang:'tr',query:{version:1,columns:[],base:[],groups:{},today,offset:0,limit:200,fields:['_id','Order Code','Model Name','C.Code','Supp. FOB']}})});return r;};
  const qa=await q(A),qb=await q(B);rep.setup.queries={a:qa.status,b:qb.status,bErr:qb.status!==200?qb.text:null};save();
  if(qa.status!==200||qb.status!==200)throw Error('cp/query A '+qa.status+' B '+qb.status);
  const rowsA=qa.json.result.rows;
  // B canlı olay dinleyicisi
  const events=[];const ac=new AbortController();
  (async()=>{try{const r=await fetch(B.base+'/api/live-events',{headers:{cookie:B.cookie,Accept:'text/event-stream'},signal:ac.signal});rep.setup.sse=r.status;const rd=r.body.getReader();const dec=new TextDecoder();let buf='';
    for(;;){const {value,done}=await rd.read();if(done)break;buf+=dec.decode(value,{stream:true});let k;while((k=buf.indexOf('\n\n'))>=0){const blk=buf.slice(0,k);buf=buf.slice(k+2);if(/data:/.test(blk))events.push({t:Date.now(),blk:blk.slice(0,300)});}}}catch(_){}})();
  await L.delay(2000);
  for(let i=0;i<3;i++){
    const row=rowsA[10+i*7];const val=Math.round((200+i+Math.random())*100)/100;const tr={code:row['Order Code'],val};
    const e0=events.length;const t0=Date.now();
    const s=await j(A,'/api/overrides/'+row['Order Code'],{method:'PATCH',body:JSON.stringify({model:row['Model Name'],ccode:row['C.Code'],suppFob:val,suppFobMeta:{source:'manual'}})});tr.saveAck=Date.now()-t0;tr.saveStatus=s.status;
    await L.delay(1000);
    let a=Date.now();const pa=await j(A,'/api/sync-settings/sync-now',{method:'POST',body:'{}'});tr.publishMs=Date.now()-a;tr.publishStatus=pa.status;tr.publishErr=pa.status!==200?pa.text:null;
    tr.hubChanges=(()=>{try{return fs.readdirSync(path.join(H,'BUYER_LOG_SYNC','changes')).map(d=>d+':'+fs.readdirSync(path.join(H,'BUYER_LOG_SYNC','changes',d)).length);}catch(e){return String(e.message);}})();
    a=Date.now();const pb=await j(B,'/api/sync-settings/sync-now',{method:'POST',body:'{}'});tr.applyMs=Date.now()-a;tr.applyStatus=pb.status;tr.applyErr=pb.status!==200?pb.text:null;const bDone=Date.now();
    for(;Date.now()-bDone<60000;){const r=await q(B);const hit=r.status===200&&r.json.result.rows.find(x=>x['Order Code']===row['Order Code']&&x['C.Code']===row['C.Code']&&x['Model Name']===row['Model Name']);
      if(hit&&Number(hit['Supp. FOB'])===val){tr.projectionAfterApplyMs=Date.now()-bDone;tr.projectionQueryMs=r.ms;break;}await L.delay(250);}
    tr.bEvents=events.slice(e0).map(e=>({ms:e.t-t0,blk:e.blk.slice(0,200)}));
    tr.totalFromT0=tr.projectionAfterApplyMs!=null?bDone-t0+tr.projectionAfterApplyMs:null;
    rep.trials.push(tr);save();console.log(JSON.stringify(tr).slice(0,600));await L.delay(3000);}
  ac.abort();
 }catch(e){rep.errors.push(String(e.stack||e).slice(0,600));}
 finally{save();try{await A&&A.stop();}catch(_){}try{await B&&B.stop();}catch(_){}}})();
