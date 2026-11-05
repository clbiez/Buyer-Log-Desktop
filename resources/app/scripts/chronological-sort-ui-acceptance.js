/* Real Buyer Log acceptance with isolated ASAS and persisted Collection demo data.
   Run with Playwright available: node scripts/chronological-sort-ui-acceptance.js
   PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH selects a local Chromium binary. */
'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto'),assert=require('node:assert/strict'),{spawn}=require('node:child_process');
const {chromium}=require('playwright');
const app=path.resolve(__dirname,'..'),root=fs.mkdtempSync('/tmp/buyerlog-chronology-ui-'),port=6472,base='http://127.0.0.1:'+port;
const seasons=['W7','S5','W6','S7','W5','S6'],expectedSeasons=['S5','W5','S6','W6','S7','W7'];
const months=['JULY 2027','JUNE 2027','MAY 2027','DECEMBER 2026','JANUARY 2028','AUGUST 2027'];
const expectedMonthCodes=['202612','202705','202706','202707','202708','202801'];
let child,browser,page,logs='';
(async()=>{
  const source=path.join(root,'source');fs.mkdirSync(source);
  const generated=require('node:child_process').spawnSync(process.execPath,[app+'/scripts/generate-demo-data.js',source,'--rows','20'],{cwd:app,encoding:'utf8'});assert.equal(generated.status,0,generated.stderr);
  const XLSX=require(app+'/node_modules/xlsx');
  const asas=seasons.map((season,i)=>({'Sipariş Kod':810001+i,'Model Adı':'DEMO CHRONOLOGY '+(i+1),'Renk Kod':'BLK','Renk':'BLACK','Net Alım Sipariş Miktarı':100,'Kalan Alım Sipariş Miktarı':100,'FOB Fiyatı':5,'Üretici':'DEMO FACTORY','Sezon':season,'Ürün Klasman':'KNIT','Merch Alt Grup Kod':'DEMO','Merch Marka Yaş Grup Kod':'DEMO','Buyer Grup (TR)':'DEMO','Buyer':'DEMO BUYER','Siparişin Üretildiği Ülke':'TURKIYE','Sipariş Yerleştirme MerchTarih':'2026-10-01','Orijinal Exfactory Merch Tarih':'2027-02-01','Retail Depo Tarih Yıl Ay Gün':'2027-03-01','Model Bütçe Tarih Yıl Ay Gün':'2027-04-01'}));
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
  const collection=seasons.map((season,i)=>({id:i+1,plmId:String(900001+i),modelKod:'DEMO CHRONOLOGY '+(i+1),season,inStoreMonth:months[i],urunTipi:'KNIT',buyer:'DEMO BUYER',mag:'DEMO',quantity:100,durum:'Fiyatlamada',colour:'BLACK'}));
  await api('/api/collection-workspaces/moderator',{method:'PUT',body:JSON.stringify({rows:collection,nextId:7,manufacturers:[],customColumns:[],statusCatalog:[]})});
  browser=await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH||undefined,headless:true,args:['--no-sandbox']});const context=await browser.newContext({viewport:{width:1600,height:900},reducedMotion:'reduce'});const [name,...val]=cookie.split('=');await context.addCookies([{name,value:val.join('='),url:base}]);
  await context.addInitScript(()=>localStorage.setItem('bl.releaseNotes.lastSeenStable.v1','99.0.0'));
  page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base,{waitUntil:'domcontentloaded'});await page.waitForSelector('nav.tabs button[data-tab="cp"]',{timeout:60000});
  await page.getByText(/Buyer Log'a devam et|Continue to Buyer Log/).first().click({timeout:6000}).catch(()=>{});await page.waitForFunction(()=>!document.getElementById('blBootGuard'),null,{timeout:60000});
  await page.locator('nav.tabs button[data-tab="cp"]').click();await page.waitForFunction(()=>document.querySelectorAll('#cpTable tbody tr').length>=6);
  assert.deepEqual(await page.locator('#view-cp [data-season]').evaluateAll(els=>els.map(e=>e.dataset.season)),expectedSeasons);
  for(const lang of ['tr','en']){
    await page.evaluate(lang=>applyLanguage(lang),lang);
    for(const dir of [1,-1]){
      const result=await page.evaluate(dir=>sortRows(state.cp.rows,'Season',dir).map(r=>r.Season),dir);assert.deepEqual(result,dir===1?expectedSeasons:expectedSeasons.slice().reverse());
    }
    const vals=await page.evaluate(()=>uniqueColValues('cp','Season'));assert.deepEqual(vals,expectedSeasons);
  }
  await page.locator('nav.tabs button[data-tab="koleksiyon"]').click();await page.waitForFunction(()=>typeof kolRows!=='undefined'&&kolRows.length===6,null,{timeout:60000});
  for(const lang of ['tr','en']){
    await page.evaluate(lang=>applyLanguage(lang),lang);
    for(const key of ['season','inStoreMonth'])for(const dir of [1,-1]){
      const values=await page.evaluate(({key,dir})=>{kolSort={key,dir};renderKol();return filteredKol().map(r=>key==='inStoreMonth'?kolMonthCode(r[key]):r[key]);},{key,dir});
      const expected=key==='season'?expectedSeasons:expectedMonthCodes;assert.deepEqual(values,dir===1?expected:expected.slice().reverse());
    }
    for(const key of ['season','inStoreMonth']){
      const button=page.locator(`#kolTable th[data-kcol="${key}"] .kolThFilterBtn`);await button.scrollIntoViewIfNeeded();await button.click();
      const values=await page.locator('.kolColFilterPanel input[type="checkbox"]').evaluateAll(els=>els.map(e=>e.value));console.log(lang,key,'filter',values);
      const expected=key==='season'?expectedSeasons:expectedMonthCodes;assert.deepEqual(values.filter(v=>v!=='__all__'),expected);
      if(lang==='en'&&key==='inStoreMonth'){
        await page.evaluate(()=>{closeHeaderFilter();kolSort={key:'inStoreMonth',dir:1};renderKol();});
        await page.locator('#kolTable th[data-kcol="inStoreMonth"] .kolThFilterBtn').click();
        await page.screenshot({path:app+'/public/release-notes/next-assets/chronological-month-filter.png'});
      }
      if(lang==='en'&&key==='season')await page.screenshot({path:app+'/public/release-notes/next-assets/chronological-season-filter.png'});
      await page.evaluate(()=>{closeHeaderFilter();document.querySelector('.kolColFilterPanel')?.remove();});
    }
  }
  assert.deepEqual(errors,[]);console.log('PASS: real ASAS import, CP season chips/header values, persisted Collection rows; seasons and MB months in both directions, TR/EN and header filters.');
})().catch(async e=>{console.error(e);if(page){await page.screenshot({path:'/tmp/chronology-ui-failure.png'}).catch(()=>{});console.error((await page.locator('body').innerText()).slice(-1000));}console.error(logs.slice(-1500));process.exitCode=1;}).finally(async()=>{if(browser)await browser.close();if(child&&child.exitCode===null){const ended=new Promise(r=>child.once('exit',r));child.kill('SIGTERM');const timer=setTimeout(()=>child.kill('SIGKILL'),5000);await ended;clearTimeout(timer);}fs.rmSync(root,{recursive:true,force:true});});
