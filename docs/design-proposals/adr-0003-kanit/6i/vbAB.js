'use strict';
// A (iki kullanıcı) ve B (ardışık, ilk yanıt tutulur) senaryoları — gerçek tarayıcı. node vbAB.js <APP> <SOURCE> <out.json> <rowsave:on|off>
const L=require('../6f/lib.js'),U=require('./ui.js'),fs=require('fs'),path=require('path'),{spawnSync}=require('child_process');
const [APP,SOURCE,OUT,ROWSAVE]=process.argv.slice(2);
const KARA='Gemi+Tır'; // DELTYPE_OPTS'ta "Kara" yok; kara taşıması seçeneği
const rep={app:APP,rowSave:ROWSAVE,kara:KARA,scen:{},errors:[],rows:{}};const save=()=>fs.writeFileSync(OUT,JSON.stringify(rep,null,1));
(async()=>{
  const app=await L.createApp({APP,source:SOURCE,env:{},label:'vbab'});let browser;
  try{
    await L.boot(app);
    await fetch(app.base+'/api/users',{method:'POST',headers:{cookie:app.cookie,'Content-Type':'application/json'},body:JSON.stringify({username:'mod2',displayName:'Mod 2',title:'T',password:'synthetic-startup-only-456',systemRole:'moderator',reason:'doğrulama',confirmCritical:true})});
    const lb=await fetch(app.base+'/api/user-login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'mod2',password:'synthetic-startup-only-456',newPassword:'synthetic-startup-only-456'})});const cookieB=String(lb.headers.get('set-cookie')||'').split(';')[0];
    ({browser}=await L.newBrowser(app));const context=browser.contexts()[0];
    if(ROWSAVE==='off')await context.addInitScript(()=>{try{localStorage.setItem('bl.cpRowSave.v1','0');}catch(_){}});
    const used=new Set();
    async function session(label,{blockLive=false}={}){
      if(blockLive)await context.route('**/api/live-events**',r=>r.abort());
      const page=await U.openCp(app,context);
      const reqs=[];page.on('request',q=>{const u=new URL(q.url());if(u.pathname.startsWith('/api/overrides')&&q.method()!=='GET')reqs.push({t:Date.now(),m:q.method(),p:u.pathname,b:q.postData(),done:false,q});});
      page.on('requestfinished',q=>{const e=reqs.find(x=>x.q===q);if(e){e.done=true;e.tDone=Date.now();}});page.on('requestfailed',q=>{const e=reqs.find(x=>x.q===q);if(e){e.done=true;e.failed=true;}});
      const liveSeen=[];page.on('request',q=>{if(new URL(q.url()).pathname==='/api/live-events')liveSeen.push(Date.now());});
      const settle=async(n0,ms=20000)=>{const t=Date.now();while(Date.now()-t<ms){await L.delay(300);const mine=reqs.slice(n0);if(mine.length&&mine.every(x=>x.done)&&Date.now()-mine[mine.length-1].t>1500)break;}return reqs.slice(n0).map(x=>({m:x.m,p:x.p,delType:(()=>{try{const b=JSON.parse(x.b);if(Object.prototype.hasOwnProperty.call(b,'delType'))return b.delType;if(Array.isArray(b.items))return b.items.map(i=>i.patch&&Object.prototype.hasOwnProperty.call(i.patch,'delType')?i.patch.delType:'—');return '—';}catch(_){return '?';}})(),failed:x.failed||false}));};
      const pick=src=>page.evaluate(s=>{const f=eval(s);const r=state.cp.rows.find(f);return r?{id:r._id,code:r['Order Code'],model:r['Model Name'],ccode:r['C.Code'],dt:r['Del. Type']}:null;},src);
      const choose=async name=>{const r=await pick(`(r=>!${JSON.stringify([...used])}.includes(r._id)&&Array.isArray(r._logisticSegments)&&r._logisticSegments.length&&r._logisticSegments.every(s=>s.kind==='production')&&r._canEdit!==false&&r['Del. Type']==='Gemi')`);if(!r)throw Error('aday yok '+name);used.add(r.id);rep.rows[name]=r;return r;};
      const show=async row=>{await page.fill('#cpSearch',String(row.code));await page.waitForSelector(`#cpTable tbody tr[data-id="${row.id}"]`,{timeout:60000});await L.delay(800);await U.clearOverlays(page);await page.click('body',{position:{x:5,y:5}});await L.delay(400);};
      const menuOpen=()=>page.evaluate(()=>{const m=document.querySelector('.delTypeMenu');if(!m)return false;const r=m.getBoundingClientRect();return r.width>0&&getComputedStyle(m).visibility!=='hidden';});
      const delEdit=async(row,v)=>{await show(row);for(let k=0;k<5&&!(await menuOpen());k++){await page.dblclick(`.delTypeTrigger[data-id="${row.id}"]`);await L.delay(700);}if(!(await menuOpen()))throw Error('menü açılmadı');await page.click(`.delTypeMenu .delTypeOption[data-value="${v}"]`);};
      const fobEdit=async(row,v)=>{await show(row);await page.evaluate(({id,v})=>{const i=document.querySelector(`input.editCell[data-kind="suppfob"][data-id="${id}"]`);i.focus();i.value=v;i.dispatchEvent(new Event('input',{bubbles:true}));i.dispatchEvent(new Event('change',{bubbles:true}));i.blur();},{id:row.id,v});};
      const noteEdit=async(row,text)=>{await show(row);for(let k=0;k<5;k++){if(await page.$('#_notesEditorModal .noteEditorArea'))break;await page.dblclick(`.noteCellTrigger[data-id="${row.id}"][data-key="Notes"]`);await L.delay(700);}await page.click('#_notesEditorModal .noteEditorArea');await page.keyboard.type(text);await page.click('#_notesEditorModal .notesEditorSave');};
      const rowDt=id=>page.evaluate(i=>{const r=state.cp.rows.find(r=>r._id===i);return r?{dt:r['Del. Type'],intent:Boolean(r._delTypeWrite)}:null;},id);
      return {page,reqs,settle,choose,delEdit,fobEdit,noteEdit,rowDt,liveSeen,label};
    }
    const putB=row=>fetch(app.base+'/api/overrides/'+row.code,{method:'PATCH',headers:{cookie:cookieB,'Content-Type':'application/json'},body:JSON.stringify({model:row.model,ccode:row.ccode,delType:KARA})}).then(r=>r.status);
    // A: canlı olay normal ve engelli
    for(const blockLive of [false,true]){
      const key='A-'+(blockLive?'canlı-olay-engelli':'canlı-olay-normal');const S=await session(key,{blockLive});const out=rep.scen[key]={steps:[]};
      try{
        for(const kind of ['suppFob','note']){
          const row=await S.choose(key+'-'+kind);
          let n0=S.reqs.length;await S.delEdit(row,'Uçak');out.steps.push({kind,step:'1-2 U1 açık Uçak',sent:await S.settle(n0)});
          const b=await putB(row);await L.delay(blockLive?1500:3000);out.steps.push({kind,step:'3 U2 '+KARA,status:b,u1Row:await S.rowDt(row.id)});
          n0=S.reqs.length;if(kind==='suppFob')await S.fobEdit(row,'55,5');else await S.noteEdit(row,'ilgisiz not');
          out.steps.push({kind,step:'4 U1 ilgisiz '+kind,sent:await S.settle(n0),u1Row:await S.rowDt(row.id)});save();
        }
        out.liveRequests=S.liveSeen.length;
      }catch(e){rep.errors.push(key+': '+String(e.message).slice(0,200));}
      await S.page.close();if(blockLive)await context.unroute('**/api/live-events**');
    }
    // B: ardışık; ilk kayıt yanıt aşamasında tutulur
    {const key='B-ardışık';const S=await session(key);const out=rep.scen[key]={steps:[]};
      try{const row=await S.choose(key);
        let release;const hold=new Promise(r=>release=r);let held=0,heldAt=null,heldBody=null;
        const isSave=u=>/\/api\/overrides\/(rows|\d+)$/.test(new URL(u).pathname);
        await S.page.route('**/api/overrides/**',async route=>{const q=route.request();if(q.method()!=='GET'&&isSave(q.url())&&held===0){held=1;heldBody=q.postData();heldAt=Date.now();const resp=await route.fetch();await hold;await route.fulfill({response:resp});return;}await route.continue();});
        let n0=S.reqs.length;await S.delEdit(row,'Uçak');
        for(let k=0;k<40&&!held;k++)await L.delay(250);out.steps.push({step:'1 Uçak gönderildi (yanıt tutuluyor)',held:Boolean(held),heldDelType:(()=>{try{const b=JSON.parse(heldBody);return b.delType!==undefined?b.delType:(b.items||[]).map(i=>i.patch&&i.patch.delType);}catch(_){return '?';}})(),u1Row:await S.rowDt(row.id)});
        await S.delEdit(row,KARA);await L.delay(2500);out.steps.push({step:'2 '+KARA+' seçildi (kayıt 1 onaylanmadan)',u1Row:await S.rowDt(row.id),requestsSoFar:S.reqs.slice(n0).map(x=>({p:x.p,done:x.done}))});
        release();await L.delay(500);out.steps.push({step:'3 kayıt 1 onaylandı',u1Row:await S.rowDt(row.id)});
        out.steps.push({step:'4 kayıt 2',sent:await S.settle(n0,25000),u1Row:await S.rowDt(row.id)});
        n0=S.reqs.length;await S.fobEdit(row,'66,6');out.steps.push({step:'5 ilgisiz Supp. FOB',sent:await S.settle(n0),u1Row:await S.rowDt(row.id)});
        await S.page.unroute('**/api/overrides/**');
      }catch(e){rep.errors.push(key+': '+String(e.message).slice(0,200));}
      await S.page.close();}
  }catch(e){rep.errors.push(String(e.stack||e).slice(0,600));}
  finally{try{await browser?.close();}catch(_){}await app.stop();
    const code=`const db=require(${JSON.stringify(path.join(APP,'server','db.js'))});const o=db.loadOverrides();process.stdout.write(JSON.stringify({delmap:o.delmap||{}}));`;
    const out=spawnSync(process.execPath,['-e',code],{cwd:APP,env:app.env,encoding:'utf8'});try{rep.store=JSON.parse(out.stdout);}catch(_){rep.storeError=(out.stderr||'').slice(0,400);}
    const dm=rep.store&&rep.store.delmap||{};rep.delmapByRow={};for(const [label,r] of Object.entries(rep.rows)){const kk=`${r.code}|${r.model}|${r.ccode}`.toLowerCase();const k=Object.keys(dm).find(k=>k.toLowerCase()===kk||k===String(r.code));rep.delmapByRow[label]=k?dm[k]:null;}
    save();}
})();
