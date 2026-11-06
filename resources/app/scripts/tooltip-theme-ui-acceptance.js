/* Real Buyer Log acceptance with isolated ASAS and persisted Collection demo data.
   Run with Playwright available: node scripts/tooltip-theme-ui-acceptance.js
   PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH selects a local Chromium binary. */
'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict'),{spawn}=require('node:child_process');
const {chromium}=require('playwright');
const app=path.resolve(__dirname,'..'),root=fs.mkdtempSync('/tmp/buyerlog-tooltip-ui-'),port=6475,base='http://127.0.0.1:'+port;
const seasons=['W7','S5','W6','S7','W5','S6'];
const months=['JULY 2027','JUNE 2027','MAY 2027','DECEMBER 2026','JANUARY 2028','AUGUST 2027'];
let child,browser,page,logs='';
const results=[];
(async()=>{
  const source=path.join(root,'source');fs.mkdirSync(source);
  const generated=require('node:child_process').spawnSync(process.execPath,[app+'/scripts/generate-demo-data.js',source,'--rows','20'],{cwd:app,encoding:'utf8'});assert.equal(generated.status,0,generated.stderr);
  const XLSX=require(app+'/node_modules/xlsx');
  const asas=seasons.map((season,i)=>({'Sipariş Kod':810001+i,'Model Adı':'DEMO HOVER '+(i+1),'Renk Kod':'BLK','Renk':'BLACK','Net Alım Sipariş Miktarı':100,'Kalan Alım Sipariş Miktarı':100,'FOB Fiyatı':5,'Üretici':'DEMO FACTORY','Sezon':season,'Ürün Klasman':'KNIT','Merch Alt Grup Kod':'DEMO','Merch Marka Yaş Grup Kod':'DEMO','Buyer Grup (TR)':'DEMO','Buyer':'DEMO BUYER','Siparişin Üretildiği Ülke':'TURKIYE','Sipariş Yerleştirme MerchTarih':'2026-10-01','Orijinal Exfactory Merch Tarih':'2027-02-01','Retail Depo Tarih Yıl Ay Gün':'2027-03-01','Model Bütçe Tarih Yıl Ay Gün':'2027-04-01'}));
  const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(asas),'ASAS');XLSX.writeFile(wb,path.join(source,'ASAS.xlsx'));
  const env={...process.env,BUYER_LOG_CONFIG_PATH:path.join(root,'config.json'),BL_KEEP_ALIVE:'1'};
  for(const key of ['BUYER_LOG_DATA_ROOT','BUYER_LOG_SERVER_DATA_ROOT','BUYER_LOG_LOCAL_DATA_ROOT','BUYER_LOG_AUTH_DATA_ROOT','BUYER_LOG_TEMP_ROOT']){env[key]=path.join(root,key.toLowerCase());fs.mkdirSync(env[key],{recursive:true});}
  env.BUYER_LOG_AUTH_DATA_ROOT=path.join(env.BUYER_LOG_SERVER_DATA_ROOT,'auth');fs.mkdirSync(env.BUYER_LOG_AUTH_DATA_ROOT,{recursive:true});
  fs.writeFileSync(env.BUYER_LOG_CONFIG_PATH,JSON.stringify({port,host:'127.0.0.1',sourceFolder:source,refreshWithExcel:false,updates:{enabled:false}}));
  child=spawn(process.execPath,['server/server.js'],{cwd:app,env,stdio:['ignore','pipe','pipe']});child.stdout.on('data',b=>logs+=b);child.stderr.on('data',b=>logs+=b);
  for(let i=0;i<160;i++){try{if((await fetch(base+'/api/user-profiles')).ok)break;}catch{}await new Promise(r=>setTimeout(r,250));}
  const password=crypto.randomBytes(20).toString('hex');const login=await fetch(base+'/api/user-login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({userId:'moderator',newPassword:password,password})});assert.equal(login.status,200,await login.clone().text());const cookie=login.headers.get('set-cookie').split(';')[0];
  const api=async(url,options={})=>{const r=await fetch(base+url,{...options,headers:{cookie,'Content-Type':'application/json'}});assert.ok(r.ok,await r.clone().text());return r.json();};
  await api('/api/refresh',{method:'POST',body:'{}'});for(let i=0;i<120;i++){if(!(await api('/api/refresh-status')).running)break;await new Promise(r=>setTimeout(r,250));}
  assert.equal((await api('/api/data/cp')).rows.length,6);
  const collection=seasons.map((season,i)=>({id:i+1,plmId:String(900001+i),modelKod:'DEMO HOVER '+(i+1),season,inStoreMonth:months[i],urunTipi:'KNIT',buyer:'DEMO BUYER',mag:'DEMO',quantity:100,durum:'Fiyatlamada',colour:'BLACK'}));
  await api('/api/collection-workspaces/moderator',{method:'PUT',body:JSON.stringify({rows:collection,nextId:7,manufacturers:[],customColumns:[],statusCatalog:[]})});
  browser=await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH||undefined,headless:true,args:['--no-sandbox']});const context=await browser.newContext({viewport:{width:1600,height:900},reducedMotion:'reduce'});const [name,...val]=cookie.split('=');await context.addCookies([{name,value:val.join('='),url:base}]);
  await context.addInitScript(()=>localStorage.setItem('bl.releaseNotes.lastSeenStable.v1','99.0.0'));
  page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base,{waitUntil:'domcontentloaded'});await page.waitForSelector('nav.tabs button[data-tab="cp"]',{timeout:60000});
  await page.getByText(/Buyer Log'a devam et|Continue to Buyer Log/).first().click({timeout:6000}).catch(()=>{});await page.waitForFunction(()=>!document.getElementById('blBootGuard'),null,{timeout:60000});
  await page.evaluate(()=>switchTab('koleksiyon'));
  await page.waitForFunction(()=>typeof kolRows!=='undefined'&&kolRows.length===6);
  const paste=page.locator('#kolSpreadsheetPasteBtn'),tip=page.locator('.blTip');
  for(const theme of ['light','dark'])for(const scale of ['compact','standard','large','xl'])for(const lang of ['tr','en']){
    const label=`${theme}/${scale}/${lang}`;
    await page.mouse.move(1000,30);
    await page.evaluate(({theme,scale,lang})=>{applyLanguage(lang);Object.assign(document.documentElement.dataset,{theme,uiScale:scale});},{theme,scale,lang});
    await paste.hover();await tip.waitFor({state:'visible'});
    const seen=await page.evaluate(inspectTip,'.blTip');checkTip(seen,label);
    assert.ok(seen.text.includes(lang==='en'?'Paste':'Yapıştır'),label+': label');
    assert.ok(seen.text.includes(lang==='en'?'clipboard':'panodan'),label+': detail');
    assert.equal(await paste.getAttribute('title'),null,label+': native duplicate suppressed');
    assert.ok(seen.transition.split(',').every(t=>parseFloat(t)===0),label+': reduced motion');
    results.push({label,...seen});
    if(theme==='dark'&&scale==='standard'&&lang==='en')await page.screenshot({path:app+'/public/release-notes/next-assets/dark-hover-tooltip.png'});
    await page.evaluate(t=>document.documentElement.dataset.theme=t,theme==='dark'?'light':'dark');
    checkTip(await page.evaluate(inspectTip,'.blTip'),label+'/live-theme-change');
    await page.keyboard.press('Escape');await tip.waitFor({state:'hidden'});
    assert.ok(await paste.getAttribute('title'),label+': title restored');
  }
  const tabs=await page.locator('nav.tabs>button[data-tab]').evaluateAll(es=>es.map(e=>e.dataset.tab)),covered=[];
  await page.evaluate(()=>{applyLanguage('en');Object.assign(document.documentElement.dataset,{theme:'dark',uiScale:'standard'});});
  for(const tab of tabs){
    await page.evaluate(t=>switchTab(t),tab);await page.waitForTimeout(100);
    const selector='.tableActionToolbar button:not(.primary):not(.tableSearchHelpButton):not(.toolbarMoreMenu *),#shipSecondaryToolbar button,.vfBar button:not(.toolbarMoreMenu *)';
    const indexes=await page.locator(selector).evaluateAll(es=>es.flatMap((e,i)=>e.getClientRects().length&&!e.disabled&&(parseFloat(getComputedStyle(e).fontSize)===0||e.matches('[data-toolbar-compact] [data-tb-compact="icon"]'))&&(e.textContent.trim()||e.title)?[i]:[]).slice(0,2));
    let checked=0;
    for(const i of indexes){
      const button=page.locator(selector).nth(i);
      console.log('Hover',tab,await button.getAttribute('id'));await page.mouse.move(1000,30);await button.hover();await tip.waitFor({state:'visible',timeout:3000});
      checkTip(await page.evaluate(inspectTip,'.blTip'),tab);
      await page.keyboard.press('Escape');checked++;if(checked===2)break;
    }
    if(checked)covered.push({tab,checked});
  }
  for(const tab of ['cp','orders','koleksiyon'])assert.ok(covered.some(x=>x.tab===tab),'actual trigger coverage: '+tab);
  await page.evaluate(()=>switchTab('koleksiyon'));await page.mouse.move(1000,30);
  // Paste is intentionally disabled without an active cell. Use an enabled toolbar trigger.
  const focusButton=page.locator('#kolUndoBtn');assert.equal(await focusButton.isEnabled(),true);
  await page.keyboard.press('Tab');await page.evaluate(()=>document.activeElement?.blur());await focusButton.focus();
  assert.equal(await focusButton.evaluate(e=>e===document.activeElement&&e.matches(':focus-visible')),true,'keyboard-visible toolbar focus');
  await tip.waitFor({state:'visible',timeout:3000});
  checkTip(await page.evaluate(inspectTip,'.blTip'),'keyboard focus');
  await page.keyboard.press('Escape');await tip.waitFor({state:'hidden'});
  await page.setViewportSize({width:960,height:480});await page.mouse.move(900,30);await focusButton.hover();await tip.waitFor({state:'visible'});
  checkTip(await page.evaluate(inspectTip,'.blTip'),'small viewport');
  await page.setViewportSize({width:1600,height:900});await tip.waitFor({state:'hidden'});
  await page.mouse.move(1000,30);await paste.hover();await tip.waitFor({state:'visible'});
  await page.evaluate(()=>window.dispatchEvent(new Event('scroll')));await tip.waitFor({state:'hidden'});
  // CSS probes cover other hover families; these do not exercise their data-dependent triggers.
  const palettes=[],probes=['blTip','backlogChartCrosshairValue','backlogChartTooltip','bpaTip','bpaTip blvTipBox is-chart-style backlogTimelineTip','ovBdTip','ovCollectionMonthTip','globalFlowTooltip','kolTextPreviewPopup','tableSearchHelpPopover'];
  for(const theme of ['light','dark']){
    await page.evaluate(t=>document.documentElement.dataset.theme=t,theme);
    for(const classes of probes){
      await page.evaluate(classes=>{const e=document.createElement('div');e.id='tooltipPaletteProbe';e.className=classes;e.textContent='Demo';document.body.append(e);},classes);
      const colors=await page.evaluate(inspectTip,'#tooltipPaletteProbe');
      // Chart families intentionally use a 96% surface mix; compare their RGB hue.
      assert.equal(colors.backgroundRgb,colors.surfaceRgb,theme+'/'+classes+': surface');
      assert.equal(colors.color,colors.ink,theme+'/'+classes+': ink');
      assert.ok(colors.contrast>=4.5,theme+'/'+classes+': contrast');
      palettes.push({theme,classes,...colors});await page.locator('#tooltipPaletteProbe').evaluate(e=>e.remove());
    }
  }
  await page.emulateMedia({reducedMotion:'no-preference'});await page.mouse.move(1000,30);await paste.hover();await tip.waitFor({state:'visible'});
  checkTip(await page.evaluate(inspectTip,'.blTip'),'normal motion');await page.mouse.move(1000,30);await tip.waitFor({state:'hidden'});
  assert.deepEqual(errors,[],'browser errors');
  fs.writeFileSync('/tmp/buyerlog-tooltip-results.json',JSON.stringify({results,covered,palettes},null,2));
  console.log('PASS 16 Collection hover combinations + live theme changes; module triggers: '+JSON.stringify(covered));
  console.log('PASS keyboard/Escape, title restoration, reduced/normal motion, viewport/scroll and 20 component palette probes.');
})().catch(async e=>{console.error(e);if(page)await page.screenshot({path:'/tmp/tooltip-ui-failure.png'}).catch(()=>{});console.error(logs.slice(-1200));process.exitCode=1;}).finally(async()=>{
  if(browser)await browser.close();if(child&&child.exitCode===null){const ended=new Promise(r=>child.once('exit',r));child.kill('SIGTERM');const timer=setTimeout(()=>child.kill('SIGKILL'),5000);await ended;clearTimeout(timer);}fs.rmSync(root,{recursive:true,force:true});
});

function inspectTip(selector){
  const el=document.querySelector(selector),cs=getComputedStyle(el),r=el.getBoundingClientRect();
  const rgb=c=>{const v=(c.match(/[\d.]+/g)||[]).slice(0,3).map(Number);return c.startsWith('color(srgb')?v.map(x=>255*x):v;};
  const lum=c=>rgb(c).map(x=>{x/=255;return x<=.04045?x/12.92:((x+.055)/1.055)**2.4;}).reduce((sum,x,i)=>sum+x*[.2126,.7152,.0722][i],0);
  const contrast=(a,b)=>{const x=lum(a),y=lum(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);};
  const probe=document.createElement('div');probe.style.background='var(--ui-surface)';probe.style.color='var(--ui-text)';document.body.append(probe);
  const expected=getComputedStyle(probe),surface=expected.backgroundColor,ink=expected.color;probe.remove();
  return {background:cs.backgroundColor,color:cs.color,surface,ink,backgroundRgb:rgb(cs.backgroundColor).map(Math.round).join(','),surfaceRgb:rgb(surface).map(Math.round).join(','),contrast:contrast(cs.backgroundColor,cs.color),text:el.textContent,hidden:el.hidden,transition:cs.transitionDuration,inViewport:r.left>=0&&r.top>=0&&r.right<=innerWidth&&r.bottom<=innerHeight};
}
function checkTip(tip,label){
  assert.equal(tip.background,tip.surface,label+': themed surface');assert.equal(tip.color,tip.ink,label+': themed text');
  assert.ok(tip.contrast>=4.5,label+': contrast '+tip.contrast);assert.equal(tip.hidden,false,label+': visible');assert.ok(tip.inViewport,label+': inside viewport');
}
