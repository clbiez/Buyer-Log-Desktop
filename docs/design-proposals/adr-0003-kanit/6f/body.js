'use strict';
// Gerçek istemcinin CP Supp. FOB kaydında gönderdiği gövdeyi yakalar. node body.js <APP> <SOURCE>
const L=require('./lib.js');
const [APP,SOURCE]=process.argv.slice(2);
(async()=>{
  const app=await L.createApp({APP,source:SOURCE,env:{},label:'body'});
  try{
    await L.boot(app);const {browser,context}=await L.newBrowser(app);
    const page=await context.newPage();const bodies=[];
    page.on('request',req=>{const u=new URL(req.url());if(u.pathname.startsWith('/api/overrides')&&req.method()!=='GET')bodies.push({m:req.method(),p:u.pathname,b:req.postData()});});
    await page.goto(app.base+'/?module=cp',{waitUntil:'domcontentloaded',timeout:180000});
    await page.waitForFunction(()=>window.BLBootGuard!=null,null,{timeout:180000}).catch(()=>{});
    await page.evaluate(()=>{try{window.BLBootGuard?.continue?.({intentAtMs:performance.now()});}catch(_){}}).catch(()=>{});
    await L.waitRows(page,'cp');
    const info=await page.evaluate(()=>{const out=[];const inputs=[...document.querySelectorAll('#cpTable tbody input.editCell[data-kind="suppfob"]')].slice(0,40);
      for(const input of inputs){const tr=input.closest('tr');out.push({code:tr.querySelector('td[data-key="Order Code"]')?.textContent.trim(),lic:tr.querySelector('td[data-key="Licensor"]')?.textContent.trim()});}return out;});
    const lic={};for(const r of info)lic[r.lic]=(lic[r.lic]||0)+1;console.log('licensors(first 40 visible)',JSON.stringify(lic));
    const pick=[info.find(r=>r.lic!=='DTR'),info.find(r=>r.lic==='DTR')].filter(Boolean);
    for(const r of pick){
      await page.evaluate(({code})=>{const tr=[...document.querySelectorAll('#cpTable tbody tr[data-id]')].find(tr=>tr.querySelector('td[data-key="Order Code"]')?.textContent.trim()===code);
        const input=tr.querySelector('input.editCell[data-kind="suppfob"]');input.focus();input.value='432,1';input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));input.blur();},r);
      const n=bodies.length;const t=Date.now();while(bodies.length===n&&Date.now()-t<20000)await L.delay(50);
      console.log('licensor',r.lic,'code',r.code,JSON.stringify(bodies.slice(n)));
    }
    await browser.close();
  }finally{await app.stop();}
})().catch(e=>{console.error(e);process.exit(1);});
