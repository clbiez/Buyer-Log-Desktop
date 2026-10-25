'use strict';
const fs=require('node:fs'),path=require('node:path');
(async()=>{const out=path.resolve(process.argv[2]);fs.mkdirSync(out,{recursive:true});const {browser,page:existing}=await require('./browser.cjs')();
 const session=await existing.context().newCDPSession(existing),{cookies}=await session.send('Network.getAllCookies');await session.detach();
 const context=await browser.newContext({viewport:{width:1440,height:900},locale:'tr-TR',timezoneId:'UTC',reducedMotion:'reduce'});await context.addCookies(cookies.map(({name,value,domain,path,secure,httpOnly,sameSite})=>({name,value,domain,path,secure,httpOnly,sameSite})));const page=await context.newPage();await page.goto(new URL(existing.url()).origin+'/',{waitUntil:'domcontentloaded'});await page.getByText("Buyer Log'a devam et",{exact:false}).waitFor({timeout:60000});
 if(await page.locator('#blBootGuard').count()){await page.getByText("Buyer Log'a devam et",{exact:false}).click();await page.waitForFunction(()=>!document.getElementById('blBootGuard'));}await page.locator('[data-rn-close]').first().click({timeout:800}).catch(()=>{});
 await page.evaluate(()=>applyUiFontStep(0));await page.setViewportSize({width:1440,height:900});
 await page.locator('nav.tabs [data-tab="cp"]').click();await page.locator('#cpTable tbody tr[data-id]').first().waitFor();
 await page.evaluate(async()=>{await BLChecklistSupplierSync.loadShared();BLChecklistSupplierSync.refreshColumns({render:true});});
 // Exercise the actual canonical mapping against deterministic demo records;
 // keep the comparison in memory, without writing user/server data.
 await page.evaluate(()=>{window.__auditShipOriginal=shipRows;shipRows=state.cp.rows.slice(0,3).map(mapCPRowToShip).map((r,i)=>({...r,_shipId:'demo-'+i,kur:34,trFiyatTl:340,gemiUcak:11,ucak:12}));shipRows.forEach(computeShipFormulas);});
 for(const theme of ['light','grey','dark']){
  console.log('Exporting '+theme);
  await page.evaluate(t=>applyTheme(t),theme);await page.locator('nav.tabs [data-tab="orders"]').click();await page.locator('#ordersTable tbody tr[data-id]').first().waitFor();
  await page.evaluate(()=>{colmgr.orders.hidden=new Set();colmgr.orders.order=COLS_BY_TABLE.orders.map(c=>c.k);renderOrders();});
  const value=await page.evaluate(async()=>({orders:await buildManagedTableStyledCopy('orders',filteredOrders().slice(0,12),new Set()),shipping:{html:shipCopyTableHtml(),plain:shipCopyTablePlain(),flatHtml:shipComparisonFlatHtml(),flatPlain:shipComparisonFlatPlain()}}));
  for(const [kind,copy] of Object.entries(value))for(const [key,data] of Object.entries(copy))if(typeof data==='string')fs.writeFileSync(path.join(out,`${kind}-${theme}-${key}.${key.toLowerCase().includes('html')?'html':'tsv'}`),data);
  const xlsx=await page.evaluate(async()=>{const original=XLSX.writeFile;let captured;XLSX.writeFile=(wb)=>{captured=XLSX.write(wb,{type:'array',bookType:'xlsx',cellStyles:true});};try{document.getElementById('shipExportBtn').click();return Array.from(new Uint8Array(captured));}finally{XLSX.writeFile=original;}});fs.writeFileSync(path.join(out,`shipping-${theme}.xlsx`),Buffer.from(xlsx));
  for(const tab of ['orders','shipping']){
   await page.locator('nav.tabs [data-tab="'+tab+'"]').click();await page.waitForTimeout(200);
   if(tab==='orders')await page.evaluate(()=>{colmgr.orders.hidden=new Set();colmgr.orders.order=COLS_BY_TABLE.orders.map(c=>c.k);renderOrders();});
   const bytes=await page.evaluate(async()=>{const original=URL.createObjectURL,blobs=[];URL.createObjectURL=function(b){blobs.push(b);return original.call(URL,b);};try{await exportActiveTableStyled();return Array.from(new Uint8Array(await blobs.at(-1).arrayBuffer()));}finally{URL.createObjectURL=original;}});fs.writeFileSync(path.join(out,`${tab}-generic-${theme}.xlsx`),Buffer.from(bytes));
  }
 }
 await page.evaluate(()=>{shipRows=window.__auditShipOriginal;delete window.__auditShipOriginal;applyTheme('light');});await context.close();await browser.close();console.log('Three-theme Orders/Shipping clipboard and shipping workbook references saved.');
})().catch(e=>{console.error(e.stack);process.exit(1);});
