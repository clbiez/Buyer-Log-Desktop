/* Backlog Excel UI acceptance. Runs the real application with isolated demo data.
   Env: BUYER_LOG_BACKLOG_EXCEL_ARTIFACT_ROOT, BUYER_LOG_BACKLOG_EXCEL_TEST_PORT,
   PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH. API fixtures provide only anonymous rows. */
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{spawn}=require('node:child_process'),assert=require('node:assert/strict');
const {chromium}=require('playwright');
const app=path.resolve(__dirname,'..'),root=process.env.BUYER_LOG_BACKLOG_EXCEL_ARTIFACT_ROOT||fs.mkdtempSync(path.join(os.tmpdir(),'buyer-log-backlog-excel-')),port=Number(process.env.BUYER_LOG_BACKLOG_EXCEL_TEST_PORT||6468),base=`http://127.0.0.1:${port}`;
fs.mkdirSync(root,{recursive:true});const dataRoot=fs.mkdtempSync(path.join(root,'data-'));
const env={...process.env,BUYER_LOG_DATA_ROOT:path.join(dataRoot,'app'),BUYER_LOG_SERVER_DATA_ROOT:path.join(dataRoot,'server'),BUYER_LOG_LOCAL_DATA_ROOT:path.join(dataRoot,'local'),BUYER_LOG_TEMP_ROOT:path.join(dataRoot,'temp'),BUYER_LOG_CONFIG_PATH:path.join(dataRoot,'config.json')};
for(const k of ['BUYER_LOG_DATA_ROOT','BUYER_LOG_SERVER_DATA_ROOT','BUYER_LOG_LOCAL_DATA_ROOT','BUYER_LOG_TEMP_ROOT'])fs.mkdirSync(env[k],{recursive:true});
fs.mkdirSync(path.join(dataRoot,'source'),{recursive:true});fs.writeFileSync(env.BUYER_LOG_CONFIG_PATH,JSON.stringify({port,sourceFolder:path.join(dataRoot,'source')}));
const server=spawn(process.execPath,['server/server.js'],{cwd:app,env,stdio:['ignore',fs.openSync(path.join(root,'server.log'),'a'),fs.openSync(path.join(root,'server.log'),'a')]});
(async()=>{let browser;try{
for(let i=0;i<160;i++){try{if((await fetch(base+'/api/health')).status<500)break;}catch{}await new Promise(r=>setTimeout(r,250));}
const login=await fetch(base+'/api/user-login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({userId:'moderator',password:'demo-test-123',newPassword:'demo-test-123'})});assert.equal(login.status,200,await login.text());
const cookie=login.headers.get('set-cookie').split(';')[0];
browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH||undefined,args:['--no-sandbox']});
const context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
const [name,...rest]=cookie.split('=');await context.addCookies([{name,value:rest.join('='),domain:'127.0.0.1',path:'/',httpOnly:true}]);
await context.addInitScript(()=>{localStorage.setItem('bl.releaseNotes.lastSeenStable.v1','99.0.0');setInterval(()=>document.querySelectorAll('.blRnDialog[open]').forEach(d=>d.close()),100);});
const page=await context.newPage();page.on('pageerror',e=>console.log('PAGE ERROR:',e.message));
const sources=[{id:'custom:asas:demo',source:'asas',header:'Demo Quantity',label:'ASAS · Demo Quantity'}];
const rows=[{'Sezon':'S7','Adet':12,'FOB Fiyatı':3,'ASAS · Demo Quantity':20,'GÜNCEL DURUM\n(STATUS)':'Üretimde'}];
await page.route('**/api/backlog-source-columns',r=>r.fulfill({json:{columns:sources}}));
await page.route('**/api/backlog-export?*',r=>r.fulfill({json:{headers:['Sezon','Adet','FOB Fiyatı','ASAS · Demo Quantity'],rows}}));
await page.goto(base,{waitUntil:'domcontentloaded'});
await page.waitForFunction(()=>window.BLPerf&&typeof window.switchTab==='function',null,{timeout:60000});
await page.getByText(/Buyer Log'a devam et|Continue to Buyer Log/).click({timeout:6000}).catch(()=>{});
await page.waitForFunction(()=>!document.getElementById('blBootGuard'),null,{timeout:60000});
await page.evaluate(()=>{switchTab('backlog');saveBacklogExcelColumns(['field:0','field:24','field:27','field:28','field:30','field:32','custom:asas:demo']);openBacklogExportColumns();});
await page.locator('[data-col-fx]').first().waitFor();
await page.locator('[data-col-label="field:0"]').fill('Demo Season');
await page.locator('[data-col-fx="field:24"]').click();
await page.locator('#_formulaColumnModal').waitFor();
await page.locator('[data-fc-mode="advanced"]').click();
await page.locator('[data-fc-formula]').fill('[ASAS · Demo Quantity]*2');
await page.screenshot({path:path.join(root,'formula.png')});
await page.locator('[data-fc-save]').click();
await page.waitForTimeout(300);
assert.equal(await page.locator('#_formulaColumnModal').count(),0,'formula should save to draft');
assert.equal(await page.locator('[data-col-fx="field:24"].is-custom').count(),1);
await page.screenshot({path:path.join(root,'settings.png')});
await page.locator('[data-save]').click();
const result=await page.evaluate(()=>{
const settings=backlogExcelColumnSettings();const data=[{'Sezon':'S7','Adet':12,'FOB Fiyatı':3,'ASAS · Demo Quantity':20}];
const ws=buildBacklogDetailSheet(['Sezon','Adet'],data,null,{});const meta=buildBacklogSettingsSheet(null,ws.__backlogColumnPlan);
return {settings,first:ws.A1,cell:ws.B2,headers:ws['!cols'],meta:Object.values(meta).filter(c=>c&&typeof c==='object'&&c.v).map(c=>c.v)};
});
assert.equal(result.first.v,'Demo Season');assert.equal(result.cell.v,40);assert.ok(result.cell.f);assert.ok(result.headers[2].hidden);assert.ok(result.meta.includes('Demo Quantity'));
console.log('Workbook aliases, formula values, hidden sources and metadata: PASS');
// Adding and cancelling a calculated column must leave no provisional column.
await page.evaluate(()=>openBacklogExportColumns());
const count=await page.locator('[data-col-id]').count();
await page.locator('[data-col-calculated]').click();await page.locator('#_formulaColumnModal').waitFor();
await page.keyboard.press('Escape');
assert.equal(await page.locator('#backlogExportColumnsModal').count(),1);
assert.equal(await page.locator('[data-col-id]').count(),count);
// A saved calculation can depend on another custom calculation.
await page.locator('[data-col-calculated]').click();await page.locator('#_formulaColumnModal').waitFor();
await page.locator('[data-fc-mode="advanced"]').click();await page.locator('[data-fc-formula]').fill('[Adet]*2');
await page.locator('[data-fc-label]').fill('Double units');await page.locator('[data-fc-save]').click();
assert.equal(await page.locator('#_formulaColumnModal').count(),0);
await page.locator('[data-save]').click();
const nested=await page.evaluate(()=>{const id=backlogExcelColumns().find(id=>id.startsWith('calc:'));const ws=buildBacklogDetailSheet([id,'Adet'],[{'Adet':12,'ASAS · Demo Quantity':20}],null,{});return {id,cell:ws.A2,formula:backlogExcelColumnSettings()[id].formula};});
assert.equal(nested.cell.v,80);assert.match(nested.formula,/field:24/);
// Native editing uses the same dialog, then keeps stable references after reorder.
await page.evaluate(()=>openBacklogExportColumns());await page.locator('[data-col-fx="field:28"]').click();
await page.locator('[data-fc-native]').waitFor({state:'attached'});
await page.locator('[data-fc-native]').evaluate(el=>el.closest('details').open=true);
await page.locator('[data-fc-native]').fill('B{row}+1');await page.locator('[data-fc-native-save]').click();
await page.locator('[data-save]').click();
assert.ok(await page.evaluate(()=>backlogExcelColumnSettings()['field:28'].excelFormula.includes('{col:field:24}')));
// Localized drafts persist through language changes.
await page.evaluate(()=>openBacklogExportColumns());await page.locator('[data-col-label="field:0"]').fill('Draft season');
await page.evaluate(()=>{applyLanguage('en');});
await page.waitForTimeout(200);
assert.equal(await page.locator('[data-col-label="field:0"]').inputValue(),'Draft season');
assert.equal(await page.locator('#backlogExportColumnsTitle').innerText(),'Excel options');
assert.match(await page.locator('.backlogDetailMeta').innerText(),/Rename exported columns/);
assert.match(await page.locator('[data-col-calculated]').innerText(),/Calculated column/);
// Common LCW AI panel is mounted within the shared editor.
await page.locator('[data-col-fx="field:24"]').click();
await page.locator('[data-fc-mode="advanced"]').click();await page.locator('[data-fc-formula]').fill('[ASAS · Demo Quantity]*3');
await page.evaluate(()=>applyLanguage('tr'));
assert.equal(await page.locator('[data-fc-formula]').inputValue(),'[ASAS · Demo Quantity]*3');
assert.match(await page.locator('#_fcTitle').innerText(),/Hesaplanan/);
await page.evaluate(()=>applyLanguage('en'));
await page.locator('[data-fc-mode="ai"]').click();
await page.locator('[data-fc-lcwai-host]').waitFor({state:'attached'});
await page.waitForTimeout(500);
await page.screenshot({path:path.join(root,'lcwai.png')});
await page.keyboard.press('Escape');
// Responsive checks: both themes, four viewport sizes, reduced motion.
const screens=[];
for(const theme of ['light','dark'])for(const [width,height] of [[1440,1000],[1280,720],[960,480],[768,720]]){
await page.setViewportSize({width,height});await page.evaluate(theme=>document.documentElement.setAttribute('data-theme',theme),theme);
await page.locator('[data-col-selected]').evaluate(el=>el.scrollTop=0);
await page.screenshot({path:path.join(root,`settings-${theme}-${width}.png`)});
const layout=await page.locator('.backlogExportColumnsCard').evaluate(el=>{const r=el.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,viewport:innerWidth,height:innerHeight};});
assert.ok(layout.left>=0&&layout.right<=layout.viewport+1,JSON.stringify(layout));
assert.ok(layout.top>=0&&layout.bottom<=layout.height+1,JSON.stringify(layout));screens.push({theme,width,height});
}
console.log('New/nested calculated columns, child Escape, native references, language drafts, LCW AI panel and eight responsive layouts: PASS');
await page.setViewportSize({width:1440,height:1000});
await page.evaluate(()=>{document.documentElement.setAttribute('data-theme','light');applyLanguage('tr');});
await page.locator('[data-col-selected]').evaluate(el=>el.scrollTop=0);
await page.screenshot({path:path.join(root,'settings-final.png')});
fs.writeFileSync(path.join(root,'screens.json'),JSON.stringify(screens,null,2));
fs.writeFileSync(path.join(root,'result.json'),JSON.stringify(result,null,2));
}finally{await browser?.close();server.kill();}})().catch(e=>{console.error(e);process.exitCode=1;});
