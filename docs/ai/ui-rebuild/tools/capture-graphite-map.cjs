'use strict';
const path=require('node:path');
(async()=>{const {browser,page}=await require('./browser.cjs')(),out=path.resolve(process.argv[2]);
await page.reload({waitUntil:'domcontentloaded'});await page.getByText("Buyer Log'a devam et",{exact:false}).click();await page.waitForFunction(()=>!document.getElementById('blBootGuard'));await page.locator('[data-rn-close]').first().click({timeout:3000}).catch(()=>{});
await page.emulateMedia({reducedMotion:'reduce'});await page.locator('nav.tabs button[data-tab="overview"]').click();
await page.evaluate(()=>{document.documentElement.dataset.uiPalette='graphite';applyTheme('dark');});
for(const [width,height,step,name] of [[1440,900,0,'overview-graphite.png'],[1280,720,2,'overview-graphite-xl-1280.png']]){
 await page.setViewportSize({width,height});await page.evaluate(step=>applyUiFontStep(step),step);await page.evaluate(()=>document.fonts.ready);await page.waitForTimeout(400);
 while(await page.locator('[data-ui-feedback-close]:visible').count()){await page.locator('[data-ui-feedback-close]:visible').first().click();await page.waitForTimeout(180);}
 await page.mouse.move(1,1);await page.screenshot({path:path.join(out,name)});
}
await page.setViewportSize({width:1440,height:900});await page.evaluate(()=>{delete document.documentElement.dataset.uiPalette;applyTheme('light');applyUiFontStep(0);});await browser.close();console.log('Graphite map palette captures updated: '+out);
})().catch(e=>{console.error(e.message);process.exit(1)});
