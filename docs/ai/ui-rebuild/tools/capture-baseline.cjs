'use strict';
const fs=require('node:fs'),path=require('node:path');
const out=path.resolve(process.argv[2]||'docs/ai/ui-rebuild/evidence/baseline');fs.mkdirSync(out,{recursive:true});
const write=(name,data)=>fs.writeFileSync(path.join(out,name),JSON.stringify(data,null,2)+'\n');
(async()=>{
 const {browser,context,page}=await require('./browser.cjs')();
 const errors=[],captures=[],navigation=[];page.on('pageerror',e=>errors.push(e.message));
 const theme=async value=>{await page.evaluate(v=>applyTheme(v),value);await page.waitForTimeout(240);};
 const shot=async name=>{await page.screenshot({path:path.join(out,name+'.png')});captures.push(name+'.png');};
 await page.setViewportSize({width:1440,height:900});
 await page.emulateMedia({reducedMotion:'reduce'});
 const before=await page.evaluate(()=>({metrics:BLPerf.snapshot(),timeline:BLPerf.timeline(),features:['lfl','openCosting','manufacturers','licensecards','automations'].map(k=>[k,BLPerf.isFeatureLoaded(k)]),hiddenTables:[...document.querySelectorAll('.view:not(.active) table')].map(t=>({id:t.id,rows:t.tBodies[0]?.rows.length||0}))}));write('startup-initial.json',before);
 for(const t of ['light','grey','dark']){
  await theme(t);await page.reload({waitUntil:'domcontentloaded'});await page.locator('[data-boot-continue],.blGuideContinue').first().waitFor({timeout:2000}).catch(()=>{});
  await page.getByText("Buyer Log'a devam et",{exact:false}).waitFor({timeout:60000});
  await shot('startup-'+t);
  await page.getByText("Buyer Log'a devam et",{exact:false}).click();await page.waitForFunction(()=>!document.getElementById('blBootGuard'));
  await page.locator('[data-rn-close]').first().click({timeout:500}).catch(()=>{});
  await theme(t);
  const tabs=await page.locator('nav.tabs button[data-tab]').evaluateAll(es=>es.map(e=>e.dataset.tab));
  for(const tab of tabs){
   const start=Date.now();
   try{await page.locator('nav.tabs button[data-tab="'+tab+'"]').click();await page.waitForFunction(tab=>document.body.dataset.activeTab===tab,tab);await page.waitForTimeout(1000);
    if(tab==='cp')await page.locator('#cpTable tbody tr').first().waitFor({timeout:30000});
    await shot(tab+'-'+t);navigation.push({tab,theme:t,wallMs:Date.now()-start,active:await page.locator('#pageTitle').innerText(),textLength:(await page.locator('#view-'+tab).innerText()).length});
    if(tab==='overview'){await page.locator('.ovHomePageTab').nth(1).click();await page.waitForTimeout(450);await shot('overview-commercial-'+t);await page.locator('.ovHomePageTab').nth(0).click();}
   }catch(e){navigation.push({tab,theme:t,error:e.message.slice(0,300)});}
  }
 }
 // The actual sign-in page uses a separate unauthenticated context.
 const loginContext=await browser.newContext({viewport:{width:1440,height:900},locale:'tr-TR',reducedMotion:'reduce'}),login=await loginContext.newPage();
 await login.goto(new URL('/select-user.html',page.url()).href,{waitUntil:'networkidle'});
 for(const t of ['light','grey','dark']){await login.evaluate(v=>document.documentElement.dataset.theme=v,t);await login.screenshot({path:path.join(out,'sign-in-'+t+'.png')});captures.push('sign-in-'+t+'.png');}
 await loginContext.close();
 write('capture-manifest.json',{viewport:'1440x900',scale:'standard',data:'generate-demo-data.build({rows:220,seed:7,today:2026-10-25}); 191 active CP rows',browser:browser.version(),captures,navigation,errors});
 await page.locator('nav.tabs button[data-tab="overview"]').click();await theme('light');
 console.log(JSON.stringify({captures:captures.length,errors,navigationErrors:navigation.filter(x=>x.error)}));await browser.close();
})().catch(e=>{console.error(e);process.exitCode=1;});
