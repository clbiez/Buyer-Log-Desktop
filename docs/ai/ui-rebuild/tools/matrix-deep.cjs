'use strict';
const fs=require('node:fs'),path=require('node:path');
(async()=>{
 const out=path.resolve(process.env.BL_MATRIX_OUT||'docs/ai/ui-rebuild/phase-3/matrix/deep');fs.mkdirSync(out,{recursive:true});const file=path.join(out,'capture.json'),report=fs.existsSync(file)?JSON.parse(fs.readFileSync(file)):{screens:[],checks:[],errors:[]};
 const {browser,context,page,tab}=await require('./matrix-commercial-fixture.cjs')();const shot=require('./matrix-shot.cjs')({page,out,report}),save=()=>fs.writeFileSync(file,JSON.stringify(report,null,2)+'\n');page.on('pageerror',e=>report.errors.push(e.message));
 await tab('backlog');await page.locator('#backlogOverviewFilter').click();await page.locator('.blvFilterDrawer').waitFor();await shot('backlog-filter');await page.keyboard.press('Escape');
 if(!await page.locator('#backlogPlanActual').isVisible())await page.locator('#backlogPlanActualToggle').click();await page.locator('#backlogPlanActual').scrollIntoViewIfNeeded();await page.waitForTimeout(500);await shot('backlog-plan-actual');
 await page.evaluate(async()=>{await BLBacklogPresentation.open();});await page.locator('.blpDialog').waitFor();await shot('backlog-presentation');await page.keyboard.press('Escape');
 await tab('opencosting');for(const [name,button,dialog] of [['costing-compare','#ocCompareBtn','#ocCompareOverlay'],['costing-fx','#ocFxBtn','#ocFxOverlay']]){await page.locator(button).click();await page.locator(dialog).waitFor();await shot(name);await page.keyboard.press('Escape');}
 await tab('manufacturers');await page.evaluate(()=>BLEmailGroups.open());await page.locator('[data-eg-add]').click();await shot('manufacturer-editor');await page.keyboard.press('Escape');
 await tab('overview');await page.locator('#ovLayoutEditBtn').click();await shot('overview-layout-selected');await page.locator('#ovLayoutDoneBtn').click();
 await page.locator('[data-home-page-tab="1"]:visible').first().click();await page.locator('#ovCollectionSummary').scrollIntoViewIfNeeded();await shot('overview-collection');await page.locator('#ovCollectionSummaryScopeTrigger').click();await shot('overview-collection-scope');await page.keyboard.press('Escape');await page.locator('#ovCollectionSummaryScopeLabel').dblclick();await shot('overview-collection-columns');await page.keyboard.press('Escape');
 save();await context.close();await browser.close();
})().catch(e=>{console.error(e.stack);process.exit(1);});
