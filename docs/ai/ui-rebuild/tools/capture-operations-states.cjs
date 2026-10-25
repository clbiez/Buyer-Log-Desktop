'use strict';
const fs=require('node:fs'),path=require('node:path'),{inspect,contrast}=require('./runtime-probe.cjs');
(async()=>{const out=path.resolve('docs/ai/ui-rebuild/phase-2-operations/states');fs.mkdirSync(out,{recursive:true});const {browser,context,page,tab}=await require('./operations-fixture.cjs')();const report={screens:[],keyboard:[],errors:[]};page.on('pageerror',e=>report.errors.push(e.message));page.on('dialog',d=>d.accept());
 const save=()=>fs.writeFileSync(path.join(out,'capture.json'),JSON.stringify(report,null,2)+'\n');
 const shot=async name=>{await page.waitForTimeout(300);await page.evaluate(()=>document.fonts.ready);await page.mouse.move(0,0);for(const b of await page.locator('[data-ui-feedback-close]:visible').all())await b.click({timeout:400}).catch(()=>{});await page.screenshot({path:path.join(out,name+'.png')});report.screens.push({name,...await page.evaluate(inspect),contrast:await page.evaluate(contrast)});save();console.log(name);};
 const keyboard=async(selector,name)=>{const ids=await page.locator(selector).evaluate(e=>{const list=[...e.querySelectorAll('button,input,select,textarea,a[href],[tabindex]')].filter(e=>!e.disabled&&e.tabIndex>=0&&e.checkVisibility());list.at(-1).focus();return list.length;});await page.keyboard.press('Tab');const forward=await page.locator(selector).evaluate(e=>e.contains(document.activeElement));await page.keyboard.press('Shift+Tab');const backward=await page.locator(selector).evaluate(e=>e.contains(document.activeElement));await page.keyboard.press('Escape');await page.waitForTimeout(150);report.keyboard.push({name,controls:ids,forward,backward,closed:!(await page.locator(selector).isVisible().catch(()=>false))});save();};
 await tab('source');for(const key of ['inspector','automation']){await page.locator('[data-lab-tab="'+key+'"]').click();await shot('data-'+key+'-light');}
 await page.evaluate(()=>BLUserManagement.open());await page.waitForTimeout(600);
 const sections=await page.locator('.umNavItem').evaluateAll(es=>es.map(e=>e.dataset.id));
 for(const key of sections.filter(k=>k!=='users')){await page.locator('.umNavItem[data-id="'+key+'"]').click();await shot('users-'+key+'-light');}
 await keyboard('.umOverlay','users');
 for(const theme of ['light','grey','dark']){await page.evaluate(t=>applyTheme(t),theme);await tab('automations');await page.locator('[data-auto-new]').click();await shot('automation-create-'+theme);await keyboard('#_autoCreate','automation-create-'+theme);
 await page.locator('[data-auto-settings]').click();await shot('automation-settings-'+theme);await keyboard('#_autoSettings','automation-settings-'+theme);
 await tab('lcwai');await page.evaluate(()=>BuyerLogAI.openConnectionDialog());await keyboard('#_lcwaiConnection','lcwai-connection-'+theme);await page.evaluate(()=>openNotificationHistory());await keyboard('#notificationHistoryModal','notifications-'+theme);
 }
 await page.evaluate(()=>applyTheme('light'));await tab('automations');await page.locator('[data-auto-new]').click();await page.locator('[data-create-template]').first().click();await shot('automation-editor-light');
 const col=page.locator('[data-auto-columns-open]');if(await col.isVisible()){await col.click();await shot('automation-columns-light');await keyboard('#_autoReportColumns','automation-columns');}
 await tab('lcwai');await page.evaluate(()=>{const s=BLLcwAiChat._state;s.conversations=[{id:'demo-error',chatId:null,title:'DEMO · Bağlantı',messages:[{role:'user',text:'Demo kayıt kontrolü'},{role:'ai',text:'',error:'Oturum bağlı değil. Bağlantıyı kontrol edin.',login:true}]}];s.activeId='demo-error';BLLcwAiChat.init();});await shot('lcwai-error-light');
 await page.evaluate(()=>{applyLanguage('en');BLUserManagement.open();});await page.waitForTimeout(600);await shot('users-en-light');await keyboard('.umOverlay','users-en');
 save();console.log(JSON.stringify({issues:report.screens.filter(s=>s.failures.length||s.contrast.failures.length||s.overflow),keyboard:report.keyboard,errors:report.errors},null,2));await context.close();await browser.close();
})().catch(e=>{console.error(e.stack);process.exit(1);});
