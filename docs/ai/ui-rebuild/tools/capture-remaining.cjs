'use strict';
const fs=require('node:fs'),path=require('node:path'),{inspect,contrast}=require('./runtime-probe.cjs');
(async()=>{const out=path.resolve('docs/ai/ui-rebuild/phase-2-remaining/screens');fs.mkdirSync(out,{recursive:true});const {browser,context,page,tab}=await require('./operations-fixture.cjs')();const report=process.env.BL_CAPTURE_MISSING?JSON.parse(fs.readFileSync(path.join(out,'capture.json'),'utf8')):{screens:[],keyboard:[],errors:[]};page.on('pageerror',e=>report.errors.push(e.message));
 const save=()=>fs.writeFileSync(path.join(out,'capture.json'),JSON.stringify(report,null,2)+'\n');
 const shot=async name=>{if(process.env.BL_CAPTURE_MISSING&&report.screens.some(s=>s.name===name))return;await page.waitForTimeout(400);await page.evaluate(()=>document.fonts.ready);await page.mouse.move(0,0);for(const b of await page.locator('[data-ui-feedback-close]:visible').all())await b.click({timeout:400}).catch(()=>{});await page.screenshot({path:path.join(out,name+'.png')});report.screens.push({name,...await page.evaluate(inspect),contrast:await page.evaluate(contrast)});save();console.log(name);};
 const close=async selector=>{await page.keyboard.press('Escape');await page.waitForTimeout(100);if(await page.locator(selector).isVisible().catch(()=>false))throw Error('Escape did not close '+selector);};
 for(const theme of ['light','grey','dark']){await page.evaluate(t=>applyTheme(t),theme);await tab('cp');await page.locator('#cpTable tbody tr[data-id]').first().waitFor();
 await page.evaluate(()=>BLCommandPalette.open());await page.locator('.blCmdInput').fill('koleksiyon');await shot('command-'+theme);await close('.blCmdOverlay');
 await page.locator('.tableSearchHelpButton[data-search-help-for="cpSearch"]').click();await shot('search-help-'+theme);await close('.tableSearchHelpPopover');
 await page.evaluate(()=>BLExcelImportWizard.open('cp'));await shot('excel-import-'+theme);await close('#excelImportWizard');
 await page.evaluate(()=>BLExcelTemplates.open());await page.locator('#excelTemplateManager [data-mapping] tbody tr').first().waitFor();await shot('excel-templates-'+theme);await close('#excelTemplateManager');
 await page.evaluate(()=>openBacklogPivotSettings());const date=page.locator('#backlogSettingsRetailFrom');await date.evaluate(e=>BLDualWeekDatePicker.open(e));await page.locator('.blDualDatePicker').waitFor();await shot('date-picker-'+theme);await close('.blDualDatePicker');await page.locator('[data-backlog-settings-close]').first().click({timeout:500}).catch(()=>{});
 await page.evaluate(async()=>{await BLPerf.ensureFeature('layoutControl');BLLayoutControl.open();});await shot('layout-control-'+theme);await close('.layoutControlOverlay');
 await page.evaluate(async()=>{await BLPerf.ensureFeature('lcwaiOutputEditor');await BLOutputEditor.openTemplates();});await shot('output-templates-'+theme);await close('#_lcwaiTemplates');
 await tab('overview');await page.locator('#ovLayoutEditBtn').click();await page.locator('#ovHomeAddWidgetBtn').click();await shot('overview-widgets-'+theme);await close('.ovHomeDrawerOverlay');await page.locator('#ovLayoutDoneBtn').click();
 }
 save();console.log(JSON.stringify({issues:report.screens.filter(s=>s.failures.length||s.contrast.failures.length||s.overflow),errors:report.errors},null,2));await context.close();await browser.close();
})().catch(e=>{console.error(e.stack);process.exit(1);});
