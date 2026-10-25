'use strict';
const fs=require('node:fs'),path=require('node:path');
(async()=>{const {browser,page}=await require('./browser.cjs')(),out=path.resolve(process.argv[2]);fs.mkdirSync(out,{recursive:true});
const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.setViewportSize({width:1440,height:900});await page.emulateMedia({reducedMotion:'reduce'});
if(await page.locator('#blBootGuard').count()){await page.getByText("Buyer Log'a devam et",{exact:false}).click();await page.waitForFunction(()=>!document.getElementById('blBootGuard'));}
await page.locator('[data-rn-close]').first().click({timeout:500}).catch(()=>{});await page.locator('[data-hold-continue]').click({timeout:500}).catch(()=>{});
await page.evaluate(()=>document.fonts.ready);const measurements=[];
for(const theme of ['light','grey','dark']){
await page.evaluate(t=>{applyTheme(t);applyUiFontStep(0);},theme);await page.waitForTimeout(250);
for(const tab of ['overview','cp']){await page.locator('nav.tabs button[data-tab="'+tab+'"]').click();await page.waitForTimeout(600);await page.evaluate(()=>document.fonts.ready);await page.screenshot({path:path.join(out,tab+'-'+theme+'.png')});measurements.push(await page.evaluate(({tab,theme})=>({tab,theme,root:document.documentElement.scrollWidth,viewport:innerWidth,fonts:document.fonts.status,active:document.body.dataset.activeTab,scale:getComputedStyle(document.documentElement).getPropertyValue('--ui-font-add')}),{tab,theme}));}
}
fs.writeFileSync(path.join(out,'capture.json'),JSON.stringify({errors,measurements},null,2)+'\n');console.log({out,errors});await browser.close();})().catch(e=>{console.error(e.message);process.exit(1);});
