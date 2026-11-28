'use strict';
// Aynı sunucu, iki kullanıcı: U2'nin Del. Type kaydı U1'in iki sekmesinde (CP + Siparişler) aşama aşama ne zaman görünür.
// Aşamalar (t0 = U2 PATCH gönderimi): ack, canlı olayın sekmeye ulaşması (SSE lider / BroadcastChannel takipçi), loadFromServer çağrısı,
// istek başlangıç/bitişleri, state güncellemesi, DOM güncellemesi (CP satırı aramayla görünür tutulur). node fresh2.js <APP> <SOURCE> <out.json>
const L=require('./lib.js'),U=require('./ui.js'),fs=require('fs');
const [APP,SOURCE,OUT]=process.argv.slice(2);const rep={trials:[],errors:[]};const save=()=>fs.writeFileSync(OUT,JSON.stringify(rep,null,1));
(async()=>{const app=await L.createApp({APP,source:SOURCE,env:{},label:'fresh2'});let browser;
 try{await L.boot(app);
  await fetch(app.base+'/api/users',{method:'POST',headers:{cookie:app.cookie,'Content-Type':'application/json'},body:JSON.stringify({username:'mod2',displayName:'Mod 2',title:'T',password:'synthetic-startup-only-456',systemRole:'moderator',reason:'doğrulama',confirmCritical:true})});
  const lb=await fetch(app.base+'/api/user-login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'mod2',password:'synthetic-startup-only-456',newPassword:'synthetic-startup-only-456'})});const cookieB=String(lb.headers.get('set-cookie')||'').split(';')[0];
  ({browser}=await L.newBrowser(app));const context=browser.contexts()[0];
  await context.addInitScript(()=>{window.__ev=[];
    const ES=window.EventSource;if(ES){window.EventSource=function(...a){const es=new ES(...a);es.addEventListener('message',e=>window.__ev.push({t:Date.now(),via:'sse',d:String(e.data).slice(0,160)}));['change','live','update'].forEach(n=>es.addEventListener(n,e=>window.__ev.push({t:Date.now(),via:'sse:'+n,d:String(e.data).slice(0,160)})));return es;};window.EventSource.prototype=ES.prototype;}
    const BC=window.BroadcastChannel;if(BC){window.BroadcastChannel=function(name){const bc=new BC(name);if(/live-sync/.test(name))bc.addEventListener('message',e=>window.__ev.push({t:Date.now(),via:'bc',d:JSON.stringify(e.data).slice(0,160)}));return bc;};window.BroadcastChannel.prototype=BC.prototype;}});
  const instrument=async(page,name)=>{const net=[];page.on('request',q=>{const p=new URL(q.url()).pathname;if(/^\/api\/(data|read-model\/|page-projection|shared-revisions)/.test(p)){net.push({q,t:Date.now(),p});}});
    page.on('requestfinished',q=>{const e=net.find(x=>x.q===q);if(e)e.tEnd=Date.now();});
    await page.evaluate(()=>{window.__lfs=[];const orig=window.loadFromServer;if(typeof orig==='function'&&!orig.__wrapped){const w=function(...a){const rec={t:Date.now(),args:a};window.__lfs.push(rec);const p=orig.apply(this,a);Promise.resolve(p).then(()=>{rec.tEnd=Date.now();},()=>{rec.tEnd=Date.now();rec.failed=true;});return p;};w.__wrapped=true;window.loadFromServer=w;}});
    return {page,name,net};};
  const cp=await instrument(await U.openCp(app,context),'CP');
  const SINGLE=process.env.SINGLE==='1';rep.single=SINGLE;const op=SINGLE?null:await context.newPage();if(op)await op.goto(app.base+'/?module=orders',{waitUntil:'domcontentloaded',timeout:180000});if(op){await L.waitRows(op,'orders');await U.clearOverlays(op);await L.delay(3000);}
  const orders=op?await instrument(op,'Siparişler'):null;
  rep.lfsWrapped=[await cp.page.evaluate(()=>Boolean(window.loadFromServer&&window.loadFromServer.__wrapped))];
  const cand=await cp.page.evaluate(()=>state.cp.rows.filter(r=>Array.isArray(r._logisticSegments)&&r._logisticSegments.length&&r._logisticSegments.every(s=>s.kind==='production')&&r['Del. Type']==='Gemi').slice(5,9).map(r=>({id:r._id,code:r['Order Code'],model:r['Model Name'],ccode:r['C.Code']})));
  for(const row of cand){
    await cp.page.fill('#cpSearch',String(row.code));if(orders)await orders.page.fill('#ordersSearch',String(row.code));await L.delay(3000);
    const domBefore=await cp.page.evaluate(id=>{const el=document.querySelector(`.delTypeTrigger[data-id="${id}"]`);return el?el.dataset.value:null;},row.id);
    for(const p of [cp,orders].filter(Boolean))await p.page.evaluate(()=>{window.__lfs=[];window.__ev=[];});const n0={cp:cp.net.length,orders:orders?orders.net.length:0};
    const t0=Date.now();const b=await fetch(app.base+'/api/overrides/'+row.code,{method:'PATCH',headers:{cookie:cookieB,'Content-Type':'application/json'},body:JSON.stringify({model:row.model,ccode:row.ccode,delType:'Uçak'})});
    const tr={code:row.code,domBefore,bStatus:b.status,ackMs:Date.now()-t0,cpState:null,cpDom:null,ordersState:null,ordersDom:null};
    while(Date.now()-t0<90000&&(tr.cpState==null||tr.cpDom==null||(orders&&(tr.ordersState==null||tr.ordersDom==null)))){
      const c=await cp.page.evaluate(id=>{const r=state.cp.rows.find(r=>r._id===id);const el=document.querySelector(`.delTypeTrigger[data-id="${id}"]`);return {s:r&&r['Del. Type'],d:el?el.dataset.value:null,txt:el?el.textContent.trim():null};},row.id).catch(()=>({}));
      const o=!orders?{}:await orders.page.evaluate(({code,ccode})=>{const r=(state.orders&&state.orders.rows||[]).find(r=>String(r['Order Code'])===String(code)&&r['C.Code']===ccode);const tr=[...document.querySelectorAll('#ordersTable tbody tr')].find(t=>t.textContent.includes(String(code)));return {s:r&&r['Del. Type'],d:tr?tr.textContent:null};},{code:row.code,ccode:row.ccode}).catch(()=>({}));
      const now=Date.now()-t0;if(tr.cpState==null&&c.s==='Uçak')tr.cpState=now;if(tr.cpDom==null&&(c.d==='Uçak'||c.txt==='Uçak'))tr.cpDom=now;if(tr.ordersState==null&&o.s==='Uçak')tr.ordersState=now;if(tr.ordersDom==null&&/Uçak|Air/.test(o.d||''))tr.ordersDom=now;tr.lastCpDom=c.d;tr.lastCpTxt=c.txt;tr.lastOrdersState=o.s===undefined?'<satır yok>':o.s;tr.lastOrdersDom=o.d==null?null:String(o.d).replace(/\s+/g,' ').slice(0,240);
      await L.delay(150);}
    tr.ordersRowsInState=orders?await orders.page.evaluate(()=>(typeof state!=='undefined'&&state.orders&&state.orders.rows||[]).length).catch(()=>null):null;
    for(const [k,p] of [['cp',cp],['orders',orders]].filter(x=>x[1])){tr[k+'Events']=await p.page.evaluate(t=>window.__ev.map(x=>({ms:x.t-t,via:x.via,d:x.d})),t0);tr[k+'Lfs']=await p.page.evaluate(t=>window.__lfs.map(x=>({ms:x.t-t,endMs:x.tEnd?x.tEnd-t:null,args:x.args})),t0);
      tr[k+'Net']=p.net.slice(n0[k]).map(x=>({ms:x.t-t0,endMs:x.tEnd?x.tEnd-t0:null,p:x.p}));}
    rep.trials.push(tr);save();console.log(JSON.stringify({code:tr.code,cpState:tr.cpState,cpDom:tr.cpDom,ordersState:tr.ordersState,ordersDom:tr.ordersDom,lfs:[tr.cpLfs.length,tr.ordersLfs?tr.ordersLfs.length:null]}));await L.delay(4000);}
 }catch(e){rep.errors.push(String(e.stack||e).slice(0,500));}finally{save();try{await browser?.close();}catch(_){}await app.stop();}})();
