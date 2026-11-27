'use strict';
// Başka kullanıcının Del. Type değişikliği diğer istemcide kaç sn'de görünür (CP ve Siparişler ayrı)? node fresh.js <APP> <SOURCE> <out.json>
const L=require('../6f/lib.js'),U=require('../6i/ui.js'),fs=require('fs');
const [APP,SOURCE,OUT]=process.argv.slice(2);const rep={trials:[],errors:[]};const save=()=>fs.writeFileSync(OUT,JSON.stringify(rep,null,1));
(async()=>{const app=await L.createApp({APP,source:SOURCE,env:{},label:'fresh'});let browser;
 try{await L.boot(app);
  await fetch(app.base+'/api/users',{method:'POST',headers:{cookie:app.cookie,'Content-Type':'application/json'},body:JSON.stringify({username:'mod2',displayName:'Mod 2',title:'T',password:'synthetic-startup-only-456',systemRole:'moderator',reason:'doğrulama',confirmCritical:true})});
  const lb=await fetch(app.base+'/api/user-login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'mod2',password:'synthetic-startup-only-456',newPassword:'synthetic-startup-only-456'})});const cookieB=String(lb.headers.get('set-cookie')||'').split(';')[0];
  ({browser}=await L.newBrowser(app));const context=browser.contexts()[0];
  const instrument=async(page,name)=>{const net=[];page.on('request',q=>{const p=new URL(q.url()).pathname;if(/^\/api\/(data|read-model\/(cp|orders)\/(query|computed)|page-projection)/.test(p))net.push({t:Date.now(),p});});
    await page.evaluate(()=>{window.__lfs=[];const orig=window.loadFromServer;if(typeof orig==='function'&&!orig.__wrapped){const w=function(...a){window.__lfs.push({t:Date.now(),args:a});return orig.apply(this,a);};w.__wrapped=true;window.loadFromServer=w;}window.__live=[];const OE=window.dispatchEvent;});
    return {page,name,net};};
  const cp=await instrument(await U.openCp(app,context),'CP');
  const op=await context.newPage();await op.goto(app.base+'/?module=orders',{waitUntil:'domcontentloaded',timeout:180000});await L.waitRows(op,'orders');await U.clearOverlays(op);await L.delay(3000);
  const orders=await instrument(op,'Siparişler');
  rep.lfsWrapped=await cp.page.evaluate(()=>Boolean(window.loadFromServer&&window.loadFromServer.__wrapped));
  const cand=await cp.page.evaluate(()=>state.cp.rows.filter(r=>Array.isArray(r._logisticSegments)&&r._logisticSegments.length&&r._logisticSegments.every(s=>s.kind==='production')&&r['Del. Type']==='Gemi').slice(5,8).map(r=>({id:r._id,code:r['Order Code'],model:r['Model Name'],ccode:r['C.Code']})));
  for(const row of cand){
    await orders.page.fill('#ordersSearch',String(row.code));await L.delay(2500);
    const n0={cp:cp.net.length,or:orders.net.length};await cp.page.evaluate(()=>{window.__lfs=[];});await orders.page.evaluate(()=>{window.__lfs=[];});
    const t0=Date.now();const b=await fetch(app.base+'/api/overrides/'+row.code,{method:'PATCH',headers:{cookie:cookieB,'Content-Type':'application/json'},body:JSON.stringify({model:row.model,ccode:row.ccode,delType:'Uçak'})});
    const tr={code:row.code,bStatus:b.status,ackMs:Date.now()-t0,cpState:null,cpDom:null,ordersState:null,ordersDom:null};
    while(Date.now()-t0<60000&&(tr.cpState==null||tr.cpDom==null||tr.ordersState==null||tr.ordersDom==null)){
      const c=await cp.page.evaluate(id=>{const r=state.cp.rows.find(r=>r._id===id);const el=document.querySelector(`.delTypeTrigger[data-id="${id}"]`);return {s:r&&r['Del. Type'],d:el?el.dataset.value:null};},row.id).catch(()=>({}));
      const o=await orders.page.evaluate(({code,ccode})=>{const r=(state.orders&&state.orders.rows||[]).find(r=>String(r['Order Code'])===String(code)&&r['C.Code']===ccode);const tr=[...document.querySelectorAll('#ordersTable tbody tr[data-id]')].find(t=>t.querySelector('td[data-key="Order Code"]')?.textContent.trim()===String(code));const td=tr&&tr.querySelector('td[data-key="Del. Type"]');return {s:r?r['Del. Type']:null,d:td?td.textContent.trim():null,rm:typeof ordersReadModelEnabled==='function'?ordersReadModelEnabled():null};},row).catch(()=>({}));
      const now=Date.now()-t0;if(tr.cpState==null&&c.s==='Uçak')tr.cpState=now;if(tr.cpDom==null&&c.d==='Uçak')tr.cpDom=now;if(tr.ordersState==null&&o.s==='Uçak')tr.ordersState=now;if(tr.ordersDom==null&&/Uçak|Air/.test(o.d||''))tr.ordersDom=now;tr.ordersRM=o.rm;tr.lastOrdersDom=o.d;tr.lastCpDom=c.d;
      await L.delay(200);}
    tr.cpLoadFromServer=await cp.page.evaluate(t=>window.__lfs.map(x=>({ms:x.t-t,args:x.args})),t0);tr.ordersLoadFromServer=await orders.page.evaluate(t=>window.__lfs.map(x=>({ms:x.t-t,args:x.args})),t0);
    tr.cpNet=cp.net.slice(n0.cp).map(x=>({ms:x.t-t0,p:x.p}));tr.ordersNet=orders.net.slice(n0.or).map(x=>({ms:x.t-t0,p:x.p}));
    rep.trials.push(tr);save();console.log(JSON.stringify(tr).slice(0,500));await L.delay(3000);}
 }catch(e){rep.errors.push(String(e.stack||e).slice(0,500));}finally{save();try{await browser?.close();}catch(_){}await app.stop();}})();
