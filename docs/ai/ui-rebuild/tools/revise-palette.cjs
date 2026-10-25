'use strict';
// Targeted palette review. Retain old evidence; write the revision separately.
const fs=require('node:fs'),path=require('node:path');
const contrast=new Function('return '+fs.readFileSync(path.join(__dirname,'evidence.cjs'),'utf8').split('\nfunction contrastSample(){')[1].replace(/^/,'function contrastSample(){'))();
(async()=>{
 const {browser,page}=await require('./browser.cjs')(),out=path.resolve(process.argv[2]),followup=process.argv.includes('--followup');fs.mkdirSync(out,{recursive:true});
 await page.reload({waitUntil:'domcontentloaded'});await page.getByText("Buyer Log'a devam et",{exact:false}).click();await page.waitForFunction(()=>!document.getElementById('blBootGuard'));
 await page.locator('[data-rn-close]').first().click({timeout:3000}).catch(()=>{});await page.locator('[data-hold-continue]').click({timeout:300}).catch(()=>{});
 await page.emulateMedia({reducedMotion:'reduce'});await page.setViewportSize({width:1440,height:900});
 const report={contrast:[],headers:[],tokens:[],indicators:[],sizes:[]};
 async function palette(name){await page.evaluate(name=>{delete document.documentElement.dataset.uiPalette;applyTheme(name==='graphite'?'dark':name);if(name==='graphite')document.documentElement.dataset.uiPalette='graphite';applyUiFontStep(0);},name);}
 async function settle(){await page.evaluate(()=>document.fonts.ready);await page.waitForTimeout(220);while(await page.locator('[data-ui-feedback-close]:visible').count()){await page.locator('[data-ui-feedback-close]:visible').first().click();await page.waitForTimeout(180);}await page.mouse.move(1,1);}
 for(const theme of followup?['light','grey']:['light','grey','dark','graphite']){
  await palette(theme);
  report.tokens.push(await page.evaluate(theme=>{const s=getComputedStyle(document.documentElement);return {theme,values:Object.fromEntries(['paper','rail-bg','card','card2','card2-strong','acc','thead-bg','thead-ink'].map(k=>[k,s.getPropertyValue('--'+k).trim()]))};},theme));
  for(const tab of ['overview','cp']){
   await page.locator('nav.tabs button[data-tab="'+tab+'"]').click();await settle();
   await page.screenshot({path:path.join(out,tab+'-'+theme+'.png')});report.contrast.push({theme,tab,...await page.evaluate(contrast)});
  }
  report.headers.push(await page.evaluate(theme=>({theme,cells:[...document.querySelectorAll('#cpTable thead th')].map(e=>({text:e.textContent.trim(),bg:getComputedStyle(e).backgroundColor,color:getComputedStyle(e).color,group:e.dataset.grp||null,accent:getComputedStyle(e,'::before').backgroundColor}))}),theme));
  await page.keyboard.press('Control+k');await page.waitForFunction(()=>document.activeElement.id==='cpSearch');
  report.indicators.push(await page.evaluate(theme=>{const e=document.activeElement,cs=getComputedStyle(e),cb=document.querySelector('#cpTable tbody input[type="checkbox"]');return {theme,focus:{outline:cs.outlineColor,backdrop:getComputedStyle(e.closest('.tableActionToolbar')).backgroundColor,width:cs.outlineWidth},checkbox:{foreground:getComputedStyle(cb).backgroundColor,backdrop:getComputedStyle(cb.closest('td')).backgroundColor}};},theme));
  await page.locator('#pageTitle').click();
  if(!followup||theme==='light'){
  const copy=await page.evaluate(()=>buildManagedTableStyledCopy('cp',filteredCP().slice(0,12),new Set()));fs.writeFileSync(path.join(out,'cp-copy-'+theme+'.html'),copy.html);fs.writeFileSync(path.join(out,'cp-copy-'+theme+'.tsv'),copy.plain);
  const bytes=await page.evaluate(async()=>{const original=URL.createObjectURL,blobs=[];URL.createObjectURL=function(blob){blobs.push(blob);return original.call(URL,blob);};try{await exportCpTableWithLightTheme();return Array.from(new Uint8Array(await blobs.at(-1).arrayBuffer()));}finally{URL.createObjectURL=original;}});fs.writeFileSync(path.join(out,'cp-export-'+theme+'.xlsx'),Buffer.from(bytes));
  }
 }
 for(const theme of followup?['grey']:['grey','graphite']){
  await palette(theme);await page.setViewportSize({width:1280,height:720});await page.evaluate(()=>applyUiFontStep(2));
  for(const tab of ['overview','cp']){await page.locator('nav.tabs button[data-tab="'+tab+'"]').click();await settle();await page.screenshot({path:path.join(out,tab+'-'+theme+'-xl-1280.png')});report.sizes.push(await page.evaluate(({theme,tab})=>({theme,tab,overflow:document.documentElement.scrollWidth>innerWidth,toolbars:[...document.querySelectorAll('.appTop,#view-'+tab+' .workspaceContextBar,#view-'+tab+' .tableActionToolbar')].filter(e=>e.checkVisibility()&&e.scrollWidth>e.clientWidth+2).map(e=>e.id||e.className)}),{theme,tab}));}
 }
 await page.setViewportSize({width:1440,height:900});await palette('light');await page.locator('nav.tabs button[data-tab="overview"]').click();
 fs.writeFileSync(path.join(out,followup?'palette-followup.json':'palette-review.json'),JSON.stringify(report,null,2)+'\n');console.log({out,contrast:report.contrast.map(c=>({theme:c.theme,tab:c.tab,failures:c.failures})),sizes:report.sizes});await browser.close();
})().catch(e=>{console.error(e.message);process.exit(1)});
