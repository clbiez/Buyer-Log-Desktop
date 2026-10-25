'use strict';
const fs=require('node:fs'),path=require('node:path'),{inspect,contrast}=require('./runtime-probe.cjs');
(async()=>{const out=path.resolve('docs/ai/ui-rebuild/phase-2-operations/last');fs.mkdirSync(out,{recursive:true});const {browser,context,page,tab}=await require('./operations-fixture.cjs')();const report={screens:[],errors:[]};page.on('pageerror',e=>report.errors.push(e.message));page.on('dialog',d=>d.accept());
 const shot=async name=>{await page.waitForTimeout(200);await page.evaluate(()=>document.fonts.ready);await page.mouse.move(0,0);for(const b of await page.locator('[data-ui-feedback-close]:visible').all())await b.click({timeout:400}).catch(()=>{});await page.screenshot({path:path.join(out,name+'.png')});report.screens.push({name,...await page.evaluate(inspect),contrast:await page.evaluate(contrast)});fs.writeFileSync(path.join(out,'capture.json'),JSON.stringify(report,null,2)+'\n');console.log(name);};
 for(const theme of ['light','grey','dark']){await page.evaluate(t=>applyTheme(t),theme);await tab('automations');await page.locator('[data-auto-new]').click();await shot('automation-create-'+theme);await page.keyboard.press('Escape');await page.evaluate(()=>openNotificationHistory());await shot('notifications-'+theme);await page.keyboard.press('Escape');}
 await page.evaluate(()=>applyTheme('light'));await page.locator('[data-auto-new]').click();await page.locator('[data-create-template]').first().click();await shot('automation-editor-light');
 await tab('source');await page.locator('[data-lab-tab="inspector"]').click();await shot('data-inspector-light');
 await page.setViewportSize({width:1280,height:720});
 for(const step of [-1,0,1,2]){await page.evaluate(n=>applyUiFontStep(n),step);await shot('data-inspector-1280-step'+step);}
 await page.evaluate(()=>{applyLanguage('en');applyUiFontStep(2);});await tab('automations');await page.locator('[data-auto-new]').click();await shot('automation-create-en-1280-xl');await page.keyboard.press('Escape');
 await tab('lcwai');await shot('lcwai-en-1280-xl');
 console.log(JSON.stringify(report.screens.filter(s=>s.failures.length||s.contrast.failures.length||s.overflow),null,2));await context.close();await browser.close();
})().catch(e=>{console.error(e.stack);process.exit(1);});
