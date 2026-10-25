'use strict';
const fs=require('node:fs'),path=require('node:path');
const out=path.resolve(process.argv[2]||'docs/ai/ui-rebuild/evidence/baseline');
(async()=>{
 const {browser,page:existing}=await require('./browser.cjs')(),base=new URL(existing.url()).origin;
 // CDP exposes an incognito target through a synthetic default context. Read
 // cookie metadata from the actual page target, not context.cookies().
 const session=await existing.context().newCDPSession(existing);
 const {cookies}=await session.send('Network.getAllCookies');await session.detach();
 const runs=[];
 for(let i=0;i<5;i++){
  const ctx=await browser.newContext({viewport:{width:1440,height:900},locale:'tr-TR',timezoneId:'UTC',reducedMotion:'reduce'});await ctx.addCookies(cookies.map(({name,value,domain,path,secure,httpOnly,sameSite})=>({name,value,domain,path,secure,httpOnly,sameSite})));const p=await ctx.newPage();
  await p.addInitScript(()=>{localStorage.setItem('bl.user.moderator.lcw_theme','light');localStorage.setItem('bl.user.moderator.lcw_font_step','0');});
  await p.goto(base+'/',{waitUntil:'domcontentloaded'});await p.getByText("Buyer Log'a devam et",{exact:false}).waitFor({timeout:60000});
  const start=await p.evaluate(()=>({metrics:BLPerf.snapshot(),timeline:BLPerf.timeline(),loaded:['lfl','openCosting','manufacturers','licensecards','automations'].map(k=>[k,BLPerf.isFeatureLoaded(k)]),tables:['cpTable','ordersTable'].map(id=>({id,rows:document.getElementById(id)?.tBodies[0]?.rows.length||0}))}));
  await p.getByText("Buyer Log'a devam et",{exact:false}).click();await p.waitForFunction(()=>!document.getElementById('blBootGuard'));await p.locator('[data-rn-close]').first().click({timeout:300}).catch(()=>{});
  await p.evaluate(()=>window.__auditNav=BLPerf.begin('auditFirstCPNavigationMs'));await p.locator('nav.tabs button[data-tab="cp"]').click();await p.locator('#cpTable tbody tr[data-id]').first().waitFor({timeout:30000});
  await p.evaluate(async()=>{await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));BLPerf.end(window.__auditNav);});
  const large=await p.evaluate(async()=>{
   const original=state.cp.rows;
   try{
    state.cp.rows=Array.from({length:5000},(_,i)=>({...original[i%original.length],_id:9000000+i,'Order Code':9000000+i}));
    invalidateCoreFacetCaches();invalidateUnifiedPriorityDecisions('audit-5000',['cp']);
    const token=BLPerf.begin('auditCP5000RenderMs');renderCPNow();
    const deadline=performance.now()+30000;
    while(![...document.querySelectorAll('#cpTable tbody tr[data-id]')].some(e=>Number(e.dataset.id)>=9000000)){if(performance.now()>deadline)throw Error('5000-row projection did not reach DOM');await new Promise(r=>setTimeout(r,20));}
    await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));BLPerf.end(token);
    return {dataRows:state.cp.rows.length,domRows:document.querySelectorAll('#cpTable tbody tr[data-id]').length,metrics:BLPerf.snapshot()};
   }finally{state.cp.rows=original;invalidateCoreFacetCaches();invalidateUnifiedPriorityDecisions('audit-restore',['cp']);renderCPNow();}
  });
  runs.push({run:i+1,start,large});await ctx.close();
 }
 const median=vs=>vs.sort((a,b)=>a-b)[Math.floor(vs.length/2)];
 const summary={startupMs:median(runs.map(r=>r.start.metrics.firstUsableInteractionMs?.lastMs||0)),cpNavigationMs:median(runs.map(r=>r.large.metrics.auditFirstCPNavigationMs.lastMs)),cp5000RenderMs:median(runs.map(r=>r.large.metrics.auditCP5000RenderMs.lastMs)),domRows:runs.map(r=>r.large.domRows)};
 fs.writeFileSync(path.join(out,'performance.json'),JSON.stringify({method:'5 fresh browser contexts, same warm server/process and fixed synthetic dataset; no CPU throttling. Startup is BLPerf firstUsableInteractionMs, excluding reading the boot guide. CP 5000 in-memory canonical rows, normal pagination; two animation frames included. Not a Windows/Electron or cold-disk benchmark.',browser:browser.version(),node:process.version,summary,runs},null,2)+'\n');
 console.log(summary);await browser.close();
})().catch(e=>{console.error(e);process.exit(1);});
