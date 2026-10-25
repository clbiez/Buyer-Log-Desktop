'use strict';
// Anonymous, authenticated browser context. No corporate network/login calls.
module.exports=async()=>{
 const {browser,page:existing}=await require('./browser.cjs')();
 const session=await existing.context().newCDPSession(existing),{cookies}=await session.send('Network.getAllCookies');await session.detach();
 const context=await browser.newContext({viewport:{width:1440,height:900},locale:'tr-TR',timezoneId:'UTC',reducedMotion:'reduce'});
 await context.addCookies(cookies.map(({name,value,domain,path,secure,httpOnly,sameSite})=>({name,value,domain,path,secure,httpOnly,sameSite})));
 // Replace only built-in seed display labels in this isolated browser; IDs and
 // permissions remain unchanged. No real profile data enters evidence.
 await context.route(new URL(existing.url()).origin+'/api/**',async route=>{if(new URL(route.request().url()).pathname==='/api/live-events')return route.continue();try{const response=await route.fetch();const type=response.headers()['content-type']||'';if(type.includes('application/json')){const body=(await response.text()).replace(/Gökberk|Gokberk/g,'Demo Kullanıcı').replace(/lcwtabular_s20/g,'DEMO-MODEL').replace(/WSSI Intake Raporu4/g,'Demo Intake');await route.fulfill({response,body});}else await route.fulfill({response});}catch(error){if(page.isClosed())return;await route.abort().catch(()=>{});}});
 const page=await context.newPage();page.setDefaultTimeout(15000);
 await page.goto(new URL(existing.url()).origin+'/',{waitUntil:'domcontentloaded'});
 await page.getByText("Buyer Log'a devam et",{exact:false}).waitFor({timeout:60000});await page.getByText("Buyer Log'a devam et",{exact:false}).click();await page.waitForFunction(()=>!document.getElementById('blBootGuard'));
 await page.waitForTimeout(4000);await page.locator('[data-rn-close]').first().click({timeout:800}).catch(()=>{});
 await page.evaluate(()=>applyUiFontStep(0));
 const tab=async key=>{await page.locator('nav.tabs [data-tab="'+key+'"]').click();await page.waitForTimeout(900);const hold=page.locator('[data-hold-continue]:visible').first();if(await hold.count())await hold.click();await page.evaluate(()=>{window.scrollTo(0,0);document.querySelector('main')?.scrollTo(0,0);});};
 return {browser,context,page,tab};
};
