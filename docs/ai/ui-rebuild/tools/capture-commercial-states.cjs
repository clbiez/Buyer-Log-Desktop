'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{inspect,contrast}=require('./runtime-probe.cjs');
(async()=>{const out=path.resolve(process.argv[2]||'docs/ai/ui-rebuild/phase-2-commercial/states');fs.mkdirSync(out,{recursive:true});const {browser,context,page,tab}=await require('./commercial-fixture.cjs')();const report={screens:[],keyboard:[],errors:[]};page.on('pageerror',e=>report.errors.push(e.message));
 const save=()=>fs.writeFileSync(path.join(out,'capture.json'),JSON.stringify(report,null,2)+'\n');
 const shot=async name=>{await page.evaluate(()=>document.fonts.ready);await page.mouse.move(0,0);await page.screenshot({path:path.join(out,name+'.png')});report.screens.push({name,...await page.evaluate(inspect),contrast:await page.evaluate(contrast)});save();console.log(name);};
 const trap=async selector=>{const bounds=await page.locator(selector).evaluate(root=>{const items=[...root.querySelectorAll('button,input,select,textarea,a[href],[tabindex]')].filter(e=>!e.disabled&&e.tabIndex>=0&&e.checkVisibility());items.at(-1)?.focus();return items.length;});assert.ok(bounds);await page.keyboard.press('Tab');let inside=await page.locator(selector).evaluate(e=>e.contains(document.activeElement));assert.ok(inside,selector+' Tab');await page.keyboard.press('Shift+Tab');inside=await page.locator(selector).evaluate(e=>e.contains(document.activeElement));assert.ok(inside,selector+' Shift+Tab');report.keyboard.push({selector,tab:true,shiftTab:true});save();};
 for(const theme of ['light','grey','dark']){await page.evaluate(t=>applyTheme(t),theme);await tab('koleksiyon');await page.evaluate(()=>BLCollectionPriceDrawer.open(kolRows[0]));await shot('price-drawer-'+theme);await trap('.cpdDrawer');await page.keyboard.press('Escape');await page.locator('.cpdDrawer').waitFor({state:'detached'});
  await tab('licensecards');await page.locator('[data-lc-act="map"]').first().click();await shot('license-map-'+theme);await trap('.lmDrawer');await page.keyboard.press('Escape');await page.locator('.lmScrim').waitFor({state:'detached'});
 }
 await page.evaluate(()=>applyTheme('light'));await tab('quotations');for(const key of ['rounds','history','analysis']){await page.locator('[data-pd-tab="'+key+'"]:visible').click();await shot('pricing-'+key);}
 await tab('lfl');await page.locator('#lflCurrentPortfolioBtn').click();await shot('lfl-portfolio');await page.keyboard.press('Escape');
 await page.locator('#lflScenarioAddBtn').click();await shot('lfl-scenario');await page.keyboard.press('Escape');
 await tab('koleksiyon');for(const step of [3,1,2]){await page.evaluate(s=>applyUiFontStep(s),step);if(step===2)await page.setViewportSize({width:1280,height:720});await shot('collection-size-'+step);}
 await page.evaluate(()=>applyUiFontStep(0));await page.setViewportSize({width:1440,height:900});
 console.log(JSON.stringify({issues:report.screens.filter(s=>s.failures.length||s.contrast.failures.length||s.overflow),keyboard:report.keyboard,errors:report.errors},null,2));await context.close();await browser.close();
})().catch(e=>{console.error(e.stack);process.exit(1);});
