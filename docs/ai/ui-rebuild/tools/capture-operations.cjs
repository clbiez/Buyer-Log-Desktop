'use strict';
const fs=require('node:fs'),path=require('node:path'),{inspect,contrast}=require('./runtime-probe.cjs');
(async()=>{const out=path.resolve(process.argv[2]||'docs/ai/ui-rebuild/phase-2-operations/screens');fs.mkdirSync(out,{recursive:true});const {browser,context,page,tab}=await require('./operations-fixture.cjs')();const report=process.env.BL_CAPTURE_MISSING&&fs.existsSync(path.join(out,'capture.json'))?JSON.parse(fs.readFileSync(path.join(out,'capture.json'))):{screens:[],errors:[]};page.on('pageerror',e=>report.errors.push(e.message));
 const shot=async name=>{if(process.env.BL_CAPTURE_MISSING&&report.screens.some(s=>s.name===name))return;await page.evaluate(()=>document.fonts.ready);await page.mouse.move(0,0);for(const b of await page.locator('.uiFeedback.isIn:not(.isLeaving) [data-ui-feedback-close]:visible').all())await b.click({timeout:500}).catch(()=>{});await page.screenshot({path:path.join(out,name+'.png')});report.screens.push({name,...await page.evaluate(inspect),contrast:await page.evaluate(contrast)});fs.writeFileSync(path.join(out,'capture.json'),JSON.stringify(report,null,2)+'\n');console.log(name);};
 for(const theme of ['light','grey','dark']){
 await page.evaluate(t=>applyTheme(t),theme);
 for(const key of ['source','automations','lcwai']){await tab(key);await shot(key+'-'+theme);}
 await page.evaluate(()=>{BLLcwAiChat._state.conversations=[{id:'demo-record',chatId:null,title:'DEMO · Sevkiyat kontrolü',messages:[{role:'user',text:'DEMO-TRIKO-001 için sevkiyat kontrol adımlarını özetle.'},{role:'ai',text:'## Sevkiyat kontrolü\n\n1. Sipariş miktarını manifestoyla karşılaştırın.\n2. Onaylı numune ve ürün etiketini kontrol edin.\n3. Teslim tarihini sevkiyat planında doğrulayın.\n\nBu örnek, anonim arayüz verisidir.'}]}];BLLcwAiChat._state.activeId='demo-record';BLLcwAiChat.init();});await page.waitForTimeout(350);await shot('lcwai-records-'+theme);
 for(const [name,open,close] of [
 ['users',()=>BLUserManagement.open(),'.umTopClose'],
 ['guide',()=>BLGuide.open(),'[data-guide-close]'],
 ['release-notes',()=>BLReleaseNotes.open(),'[data-rn-close]'],
 ['notifications',()=>openNotificationHistory(),'#notificationHistoryModal [data-close],#notificationHistoryModal .verHistClose'],
 ['sync-guide',()=>BLSyncGuide.show(),'[data-syncguide-close]'],
 ['lcwai-connection',()=>BuyerLogAI.openConnectionDialog(),'[data-lcwai-close]'],
 ]){await page.evaluate(open);await page.waitForTimeout(700);await shot(name+'-'+theme);if(await page.locator(close).count())await page.locator(close).first().click();else await page.keyboard.press('Escape');await page.waitForTimeout(150);}
 }
 console.log(JSON.stringify({issues:report.screens.filter(s=>s.failures.length||s.contrast.failures.length||s.overflow).map(s=>({name:s.name,geometry:s.failures,contrast:s.contrast.failures,overflow:s.overflow})),errors:report.errors},null,2));await context.close();await browser.close();
})().catch(e=>{console.error(e.stack);process.exit(1);});
