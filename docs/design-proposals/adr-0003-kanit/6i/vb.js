'use strict';
// Del. Type yazma niyeti doğrulaması: gerçek tarayıcı DOM olaylarıyla. node vb.js <APP> <SOURCE> <out.json> <rowsave:on|off>
const L=require('../6f/lib.js'),U=require('./ui.js'),fs=require('fs'),path=require('path'),{spawnSync}=require('child_process');
const [APP,SOURCE,OUT,ROWSAVE]=process.argv.slice(2);
const rep={app:APP,rowSave:ROWSAVE,steps:[],errors:[],rows:{}};const save=()=>fs.writeFileSync(OUT,JSON.stringify(rep,null,1));
const iso=d=>{const p=n=>String(n).padStart(2,'0');return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}`;};
(async()=>{
  const app=await L.createApp({APP,source:SOURCE,env:{},label:'vb'});let browser;
  try{
    await L.boot(app);
    const r=await fetch(app.base+'/api/users',{method:'POST',headers:{cookie:app.cookie,'Content-Type':'application/json'},body:JSON.stringify({username:'mod2',displayName:'Mod 2',title:'T',password:'synthetic-startup-only-456',systemRole:'moderator',reason:'doğrulama',confirmCritical:true})});rep.userB=r.status;
    const lb=await fetch(app.base+'/api/user-login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'mod2',password:'synthetic-startup-only-456',newPassword:'synthetic-startup-only-456'})});const cookieB=String(lb.headers.get('set-cookie')||'').split(';')[0];
    ({browser}=await L.newBrowser(app));const context=browser.contexts()[0];
    if(ROWSAVE==='off')await context.addInitScript(()=>{try{localStorage.setItem('bl.cpRowSave.v1','0');}catch(_){}});
    const page=await U.openCp(app,context);
    const reqs=[];page.on('request',q=>{const u=new URL(q.url());if(u.pathname.startsWith('/api/overrides')&&q.method()!=='GET')reqs.push({t:Date.now(),m:q.method(),p:u.pathname,b:q.postData(),done:false,q});});
    page.on('requestfinished',q=>{const e=reqs.find(x=>x.q===q);if(e)e.done=true;});page.on('requestfailed',q=>{const e=reqs.find(x=>x.q===q);if(e){e.done=true;e.failed=true;}});
    rep.rowSaveEnabled=await page.evaluate(()=>typeof cpRowSaveEnabled==='function'?cpRowSaveEnabled():null);
    rep.licensors=await page.evaluate(()=>{const c={};for(const r of state.cp.rows){const k=String(r.Licensor||'');c[k]=(c[k]||0)+1;}return c;});
    const settle=async(n0,ms=20000)=>{const t=Date.now();while(Date.now()-t<ms){await L.delay(300);const mine=reqs.slice(n0);if(mine.length&&mine.every(x=>x.done)&&Date.now()-mine[mine.length-1].t>1500)break;}return reqs.slice(n0).map(x=>({m:x.m,p:x.p,body:(()=>{try{return JSON.parse(x.b);}catch(_){return x.b;}})(),failed:x.failed||false}));};
    const pick=fn=>page.evaluate(src=>{const f=eval(src);const r=state.cp.rows.find(f);return r?{id:r._id,code:r['Order Code'],model:r['Model Name'],ccode:r['C.Code'],dt:r['Del. Type'],lic:r.Licensor,segs:(r._logisticSegments||[]).map(s=>({kind:s.kind,status:s.status,delType:s.delType,arrival:s.arrival}))}:null;},fn);
    const used=new Set();
    const choose=async(label,cond)=>{const r=await pick(`(r=>!${JSON.stringify([...used])}.includes(r._id)&&(${cond})(r))`);if(!r){rep.errors.push('aday yok: '+label);return null;}used.add(r.id);rep.rows[label]=r;return r;};
    const show=async row=>{await page.fill('#cpSearch',String(row.code));await page.waitForSelector(`#cpTable tbody tr[data-id="${row.id}"]`,{timeout:60000});await L.delay(800);await U.clearOverlays(page);await page.click('body',{position:{x:5,y:5}});await L.delay(400);};
    const step=async(name,fn)=>{const n0=reqs.length;let extra={};try{extra=(await fn())||{};}catch(e){extra={error:String(e.message).slice(0,300)};rep.errors.push(name+': '+extra.error);}const sent=await settle(n0);rep.steps.push({name,...extra,sent});save();console.log(name,JSON.stringify(sent.map(s=>({p:s.p,delType:s.body&&(s.body.delType!==undefined?s.body.delType:(s.body.items||[]).map(i=>i.patch&&i.patch.delType))}))).slice(0,300));};
    const prodPartial="r=>Array.isArray(r._logisticSegments)&&r._logisticSegments.some(s=>s.kind==='partial')&&r._logisticSegments.some(s=>s.kind==='production')&&r._canEdit!==false";
    const prodOnly="r=>Array.isArray(r._logisticSegments)&&r._logisticSegments.length&&r._logisticSegments.every(s=>s.kind==='production')&&r._canEdit!==false";
    const nonDtr="r=>String(r.Licensor||'').toUpperCase()!=='DTR'&&r._canEdit!==false&&Array.isArray(r._logisticSegments)";
    const noteEdit=async(row,text)=>{await show(row);await page.dblclick(`.noteCellTrigger[data-id="${row.id}"][data-key="Notes"]`);await page.waitForSelector('#_notesEditorModal .noteEditorArea',{timeout:15000});await page.click('#_notesEditorModal .noteEditorArea');await page.keyboard.type(text);await page.click('#_notesEditorModal .notesEditorSave');await L.delay(400);};
    const fobEdit=async(row,v)=>{await show(row);await page.evaluate(({id,v})=>{const i=document.querySelector(`input.editCell[data-kind="suppfob"][data-id="${id}"]`);if(!i)throw Error('suppfob girişi yok');i.focus();i.value=v;i.dispatchEvent(new Event('input',{bubbles:true}));i.dispatchEvent(new Event('change',{bubbles:true}));i.blur();},{id:row.id,v});};
    const subEdit=async(row,v)=>{await show(row);const sel=`input.editCell[data-kind="submfr"][data-id="${row.id}"]`;await page.click(sel);await page.fill(sel,v);await page.keyboard.press('Tab');};
    const menuOpen=()=>page.evaluate(()=>{const m=document.querySelector('.delTypeMenu');if(!m)return false;const r=m.getBoundingClientRect();return r.width>0&&getComputedStyle(m).visibility!=='hidden';});
    const delEdit=async(row,v)=>{await show(row);let tries=0;for(;tries<5&&!(await menuOpen());tries++){await page.dblclick(`.delTypeTrigger[data-id="${row.id}"]`);await L.delay(700);}
      if(!(await menuOpen()))throw Error('Del. Type menüsü açılmadı');await page.click(`.delTypeMenu .delTypeOption[data-value="${v}"]`);rep.menuTries=(rep.menuTries||[]).concat(tries);};
    const neutral=async row=>{await page.click(`#cpTable tbody tr[data-id="${row.id}"] td:nth-child(3)`);};
    const ONLY=process.env.VB_ONLY==='56';
    if(!ONLY){
    // 1) Not, Supp. FOB, Sub-Manufacturer (parsiyel + üretim satırı)
    const R1=await choose('R1 parsiyel+üretim (not + Supp. FOB)',prodPartial);
    if(R1){await step('1a not kaydı (R1)',()=>noteEdit(R1,'pilot not A'));await step('1b Supp. FOB (R1)',()=>fobEdit(R1,'345,5'));}
    const R2=await choose('R2 lisansör DTR değil (Sub-Manufacturer)',nonDtr);
    if(R2)await step('1c Sub-Manufacturer (R2)',()=>subEdit(R2,'PILOT URETICI'));
    // 2) Açık Del. Type + geri al / yinele
    const R3=await choose('R3 yalnız üretim (açık Del. Type + undo/redo)',prodOnly);
    if(R3){const to=R3.dt==='Uçak'?'Gemi':'Uçak';await step('2a açık Del. Type (R3) → '+to,()=>delEdit(R3,to));
      await step('2b geri al (Ctrl+Z)',async()=>{await neutral(R3);await page.keyboard.press('Control+z');});
      await step('2c yinele (Ctrl+Y)',async()=>{await neutral(R3);await page.keyboard.press('Control+y');});}
    // 3) Bilinçli override korunur: açık Uçak, sonra not
    const R6=await choose('R6 yalnız üretim (override + not)',prodOnly);
    if(R6){const to=R6.dt==='Uçak'?'Gemi':'Uçak';rep.rows['R6 yalnız üretim (override + not)'].to=to;await step('3a açık Del. Type (R6) → '+to,()=>delEdit(R6,to));await step('3b not kaydı (R6)',()=>noteEdit(R6,'override sonrası not'));}
    // 4) Override temizleme: açık Uçak, sonra '—'
    const R5=await choose('R5 yalnız üretim (override + temizle)',prodOnly);
    if(R5){const to=R5.dt==='Uçak'?'Gemi':'Uçak';rep.rows['R5 yalnız üretim (override + temizle)'].to=to;await step('4a açık Del. Type (R5) → '+to,()=>delEdit(R5,to));await step('4b Del. Type temizle (—)',()=>delEdit(R5,''));}
    }
    // 5) Çoklu satır yapıştırma: Notes sütununa 2 satır
    await page.fill('#cpSearch','');await page.waitForFunction(()=>document.querySelectorAll('#cpTable tbody tr[data-id]').length>20,null,{timeout:60000}).catch(()=>{});await L.delay(1500);await page.click('body',{position:{x:5,y:5}});
    const vis=await page.evaluate(()=>[...document.querySelectorAll('#cpTable tbody tr[data-id]')].map(tr=>Number(tr.dataset.id)));
    const pickVis=async label=>{const id=vis.find(i=>!used.has(i));if(id==null){rep.errors.push('aday yok: '+label);return null;}used.add(id);const r=await pick(`(r=>r._id===${id})`);rep.rows[label]=r;return r;};
    const P1=await pickVis('P1 yapıştırma satırı 1'),P2=await pickVis('P2 yapıştırma satırı 2');
    const pasteInto=async(key,text)=>{const a=`#cpTable tbody tr[data-id="${P1.id}"] td[data-key="${key}"]`,b=`#cpTable tbody tr[data-id="${P2.id}"] td[data-key="${key}"]`;
      await page.click(a,{position:{x:3,y:3}});await page.click(b,{position:{x:3,y:3},modifiers:['Shift']});await L.delay(300);
      const selInfo=await page.evaluate(()=>document.body.innerText.match(/Seçili\s*\d+/g));
      await page.evaluate(t=>{const dt=new DataTransfer();dt.setData('text/plain',t);(document.activeElement||document).dispatchEvent(new ClipboardEvent('paste',{clipboardData:dt,bubbles:true,cancelable:true}));},text);await L.delay(2000);
      const overlay=await page.evaluate(()=>[...document.querySelectorAll('.warnOverlay')].map(o=>o.textContent.trim().slice(0,160)));
      const apply=await page.$('[data-bulk-action="apply"]');if(apply){await apply.click();await L.delay(3000);}
      const after=await page.evaluate(()=>[...document.querySelectorAll('[data-bulk-action]')].map(b=>b.dataset.bulkAction));
      for(let k=0;k<3;k++){const close=await page.$('[data-bulk-action]:not([data-bulk-action="apply"])');if(!close)break;await close.click().catch(()=>{});await L.delay(500);}
      await page.keyboard.press('Escape');await L.delay(300);return {selInfo,overlay,applied:Boolean(apply),after};};
    if(P1&&P2){await step('5a not yapıştırma (2 satır)',()=>pasteInto('Notes','yapıştır 1\nyapıştır 2'));
      await step('5b Del. Type yapıştırma (2 satır, Uçak)',()=>pasteInto('Del. Type','Uçak\nUçak'));}
    // 6) Eşzamanlı: A not editörünü açar, B Del. Type yazar, A hemen kaydeder
    const R4=await choose('R4 yalnız üretim (eşzamanlı)',prodOnly);
    if(R4){const to=R4.dt==='Uçak'?'Gemi':'Uçak';rep.rows['R4 yalnız üretim (eşzamanlı)'].to=to;await step('6 B Del. Type yazar, A (bayat satır) hemen Supp. FOB kaydeder (R4)',async()=>{await show(R4);
      const b=await fetch(app.base+'/api/overrides/'+R4.code,{method:'PATCH',headers:{cookie:cookieB,'Content-Type':'application/json'},body:JSON.stringify({model:R4.model,ccode:R4.ccode,delType:to})});
      await page.evaluate(({id})=>{const i=document.querySelector(`input.editCell[data-kind="suppfob"][data-id="${id}"]`);i.focus();i.value='77,7';i.dispatchEvent(new Event('input',{bubbles:true}));i.dispatchEvent(new Event('change',{bubbles:true}));i.blur();},{id:R4.id});
      const aRowDt=await page.evaluate(id=>state.cp.rows.find(r=>r._id===id)['Del. Type'],R4.id);return {bStatus:b.status,bValue:to,aRowDtAtSave:aRowDt};});}
    await L.delay(4000);
    // Son durum: CP okuma modeli segmentleri (R1) ve kayıtlı delmap (sunucu durduktan sonra)
    rep.finalRows={};for(const [label,row] of Object.entries(rep.rows)){const r2=await pick(`(r=>r._id===${row.id})`);rep.finalRows[label]=r2&&{dt:r2.dt,segs:r2.segs};}
  }catch(e){rep.errors.push(String(e.stack||e).slice(0,600));}
  finally{try{await browser?.close();}catch(_){}await app.stop();
    const code=`const db=require(${JSON.stringify(path.join(APP,'server','db.js'))});const o=db.loadOverrides();process.stdout.write(JSON.stringify({delmap:o.delmap||{},notesKeys:Object.keys(o.notesmap||{}).length}));`;
    const out=spawnSync(process.execPath,['-e',code],{cwd:APP,env:app.env,encoding:'utf8'});
    try{rep.store=JSON.parse(out.stdout);}catch(_){rep.storeError=(out.stderr||'').slice(0,500);}
    const keyOf=r=>`${r.code}|${r.model}|${r.ccode}`;rep.delmapByRow={};for(const [label,r] of Object.entries(rep.rows)){const dm=rep.store&&rep.store.delmap||{};const k=Object.keys(dm).find(k=>k.toLowerCase()===keyOf(r).toLowerCase()||k===String(r.code));rep.delmapByRow[label]=k?dm[k]:null;}
    save();}
})();
