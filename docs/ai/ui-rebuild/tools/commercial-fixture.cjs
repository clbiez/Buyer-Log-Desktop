'use strict';
// Isolated anonymous session; canonical CP→Collection mapping, no production data.
module.exports=async()=>{
 const {browser,page:existing}=await require('./browser.cjs')();
 const session=await existing.context().newCDPSession(existing),{cookies}=await session.send('Network.getAllCookies');await session.detach();
 const context=await browser.newContext({viewport:{width:1440,height:900},locale:'tr-TR',timezoneId:'UTC',reducedMotion:'reduce'});
 await context.addCookies(cookies.map(({name,value,domain,path,secure,httpOnly,sameSite})=>({name,value,domain,path,secure,httpOnly,sameSite})));
 const page=await context.newPage();page.setDefaultTimeout(15000);
 await page.goto(new URL(existing.url()).origin+'/',{waitUntil:'domcontentloaded'});
 await page.getByText("Buyer Log'a devam et",{exact:false}).waitFor({timeout:60000});
 await page.getByText("Buyer Log'a devam et",{exact:false}).click();await page.waitForFunction(()=>!document.getElementById('blBootGuard'));
 await page.locator('[data-rn-close]').first().click({timeout:800}).catch(()=>{});
 await page.evaluate(()=>applyUiFontStep(0));
 const tab=async key=>{if(key==='pricinghistory')await page.evaluate(()=>switchTab('pricinghistory'));else await page.locator('nav.tabs [data-tab="'+key+'"]').click();await page.waitForTimeout(600);const hold=page.locator('[data-hold-continue]:visible').first();if(await hold.count())await hold.click();};
 await tab('cp');await page.locator('#cpTable tbody tr[data-id]').first().waitFor();
 await tab('koleksiyon');await page.evaluate(()=>{kolNextId=100001;kolRows=state.cp.rows.slice(0,12).map(cpRowToKolRow);kolPictureHidden=true;renderKol();});
 return {browser,context,page,tab};
};
