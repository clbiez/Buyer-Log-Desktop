'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const out=path.resolve('docs/ai/ui-rebuild/phase-1/final'),baseline=require('../evidence/palette-baseline.json');
(async()=>{
 const {browser,page}=await require('./browser.cjs')(),base=new URL(page.url()).origin,report={headers:[],scales:[],fonts:[],boot:[]};
 await page.emulateMedia({reducedMotion:'reduce'});
 if(await page.locator('#blBootGuard').count()){await page.getByText("Buyer Log'a devam et",{exact:false}).click();await page.waitForFunction(()=>!document.getElementById('blBootGuard'));}
 await page.locator('[data-rn-close]').first().click({timeout:1000}).catch(()=>{});
 await page.setViewportSize({width:1440,height:900});
 for(const theme of ['light','grey','dark']){
  await page.evaluate(t=>{applyTheme(t);applyUiFontStep(0);},theme);await page.locator('nav.tabs button[data-tab="cp"]').click();await page.locator('#cpTable tbody tr[data-id]').first().waitFor();
  const headers=await page.evaluate(()=>[...document.querySelectorAll('#cpTable thead th')].map(e=>({text:e.textContent.trim(),bg:getComputedStyle(e).backgroundColor,color:getComputedStyle(e).color})));
  const old=baseline.find(x=>x.theme===theme).headers;assert.deepEqual(headers,old.map(({text,bg,color})=>({text,bg,color})));report.headers.push({theme,count:headers.length,identical:true});
  const copy=await page.evaluate(()=>buildManagedTableStyledCopy('cp',filteredCP().slice(0,12),new Set()));fs.writeFileSync(path.join(out,'cp-copy-'+theme+'.html'),copy.html);fs.writeFileSync(path.join(out,'cp-copy-'+theme+'.tsv'),copy.plain);
  const bytes=await page.evaluate(async()=>{const original=URL.createObjectURL,blobs=[];URL.createObjectURL=function(b){blobs.push(b);return original.call(URL,b);};try{await exportCpTableWithLightTheme();return Array.from(new Uint8Array(await blobs.at(-1).arrayBuffer()));}finally{URL.createObjectURL=original;}});fs.writeFileSync(path.join(out,'cp-export-'+theme+'.xlsx'),Buffer.from(bytes));
 }
 await page.setViewportSize({width:1280,height:720});
 for(const theme of ['light','grey','dark']){
  await page.evaluate(t=>{applyTheme(t);applyUiFontStep(2);},theme);await page.reload();await page.getByText("Buyer Log'a devam et",{exact:false}).waitFor();
  const boot=await page.evaluate(()=>{const s=getComputedStyle(document.querySelector('#blBootGuard')),c=getComputedStyle(document.querySelector('.blBootCard'));const normalize=v=>{let e=document.createElement('i');e.style.color=v;document.body.appendChild(e);let r=getComputedStyle(e).color;e.remove();return r;};return {canvasMatches:s.backgroundColor===normalize(s.getPropertyValue('--ui-canvas')),surfaceMatches:c.backgroundColor===normalize(c.getPropertyValue('--ui-surface'))};});assert.ok(boot.canvasMatches&&boot.surfaceMatches);report.boot.push({theme,...boot});
  await page.screenshot({path:path.join(out,'startup-'+theme+'-xl-1280.png')});
  await page.getByText("Buyer Log'a devam et",{exact:false}).click();await page.waitForFunction(()=>!document.getElementById('blBootGuard'));await page.locator('[data-rn-close]').first().click({timeout:700}).catch(()=>{});await page.locator('nav.tabs button[data-tab="overview"]').click();await page.waitForTimeout(300);
  const size=await page.evaluate(()=>({overflow:document.documentElement.scrollWidth>innerWidth,controlsOverflow:[...document.querySelectorAll('.appTop,.globalFlowControls')].some(e=>e.scrollWidth>e.clientWidth+2),scale:document.documentElement.dataset.uiScale}));assert.equal(size.overflow,false);assert.equal(size.controlsOverflow,false);report.scales.push({screen:'overview',theme,...size});await page.screenshot({path:path.join(out,'overview-'+theme+'-xl-1280.png')});
  const ctx=await browser.newContext({viewport:{width:1280,height:720},reducedMotion:'reduce'});await ctx.addInitScript(t=>localStorage.setItem('buyerlog.ui.appearance',JSON.stringify({theme:t,step:2})),theme);const login=await ctx.newPage();await login.goto(base+'/select-user.html');await login.evaluate(()=>document.fonts.ready);const ls=await login.evaluate(()=>({overflow:document.documentElement.scrollWidth>innerWidth,scale:document.documentElement.dataset.uiScale}));assert.equal(ls.overflow,false);report.scales.push({screen:'login',theme,...ls});await login.screenshot({path:path.join(out,'login-'+theme+'-xl-1280.png')});await ctx.close();
 }
 report.fonts=await page.evaluate(async()=>{const families=['BL Plex Sans','BL Plex Mono','Barlow Condensed'];return await Promise.all(families.map(async family=>{await document.fonts.load('14px "'+family+'"','İıŞşĞğÇçÖöÜü');return {family,turkishLoaded:document.fonts.check('14px "'+family+'"','İıŞşĞğÇçÖöÜü')};}));});assert.ok(report.fonts.every(f=>f.turkishLoaded));
 report.reducedMotion=await page.evaluate(()=>({enabled:matchMedia('(prefers-reduced-motion:reduce)').matches,animations:document.getAnimations().filter(a=>a.playState==='running').length}));
 await page.evaluate(()=>{applyTheme('light');applyUiFontStep(0);});await page.setViewportSize({width:1440,height:900});fs.writeFileSync(path.join(out,'supplement.json'),JSON.stringify(report,null,2)+'\n');console.log(report);await browser.close();
})().catch(e=>{console.error(e.stack);process.exit(1);});
