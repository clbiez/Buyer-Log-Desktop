'use strict';
const fs=require('node:fs');
const {chromium}=require('/opt/codex/cua_node/lib/node_modules/playwright');
(async()=>{
 const info=JSON.parse(fs.readFileSync('/tmp/buyerlog-authority-ui-ai7l7x2a/info.json','utf8')),base='http://127.0.0.1:'+info.port;
 const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
 try{
 const context=await browser.newContext({viewport:{width:1560,height:1000},reducedMotion:'reduce'});
 await context.route('**/*',route=>{const u=route.request().url();return u.startsWith(base)||u.startsWith('data:')||u.startsWith('blob:')?route.continue():route.abort();});
 const login=await context.request.post(base+'/api/user-login',{data:{username:'demo-moderator',password:'Synthetic-authority-ui-123'}});
 if(!login.ok()) throw Error('Demo login failed: '+login.status()+' '+await login.text());
 const page=await context.newPage(), errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(base,{waitUntil:'domcontentloaded',timeout:60000});
 await page.waitForFunction(()=>window.BLPerf,{timeout:60000});
 await page.evaluate(()=>window.BLPerf.ensureFeature('userManagement'));
 console.log(JSON.stringify({body:(await page.locator('body').innerText()).slice(0,5000),errors}));
 await page.locator('[data-boot-continue]').click();
 await page.locator('#blBootGuard').waitFor({state:'hidden',timeout:15000});
 await page.waitForTimeout(700);
 const releaseDialog=page.locator('.blRnDialog[open]');
 if(await releaseDialog.count()) {console.log(await releaseDialog.locator('button').evaluateAll(bs=>bs.map(b=>({text:b.innerText,html:b.outerHTML.slice(0,450)}))));await releaseDialog.getByRole('button',{name:/^(Kapat|Close)$/i}).click();}
 await page.evaluate(()=>window.BLUserManagement.open());
 await page.locator('.umRow[data-id="u0"]').waitFor({state:'visible',timeout:30000});
 await page.locator('.umRow[data-id="u0"]').click();
 await page.locator('.umDrawer').waitFor({state:'visible',timeout:10000});
 await page.locator('.umDrawerTab[data-act="detailTab"][data-id="permissions"]').click();
 await page.screenshot({path:'/tmp/buyerlog-authority-ui-ai7l7x2a/authority-tr.png',fullPage:false});
 await page.evaluate(()=>{window.BLUserManagement.close();applyLanguage('en');window.BLUserManagement.open();});
 await page.locator('.umRow[data-id="u0"]').click();
 await page.locator('.umDrawerTab[data-id="permissions"]').click();
 await page.screenshot({path:'/tmp/buyerlog-authority-ui-ai7l7x2a/authority-en.png',fullPage:false});
 console.log(JSON.stringify({url:page.url(),dialog:(await page.locator('.umShell').innerText()).slice(-8500),errors}));
 }finally{await browser.close();}
})().catch(e=>{console.error(e.stack);process.exitCode=1;});
