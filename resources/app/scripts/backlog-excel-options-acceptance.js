'use strict';
// Real Buyer Log on isolated demo data. Requires Playwright + Chromium.
// NODE_PATH can point at an external Playwright installation. No production data is read.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict'),{spawn}=require('node:child_process');
const {chromium}=require('playwright');
const app=path.resolve(__dirname,'..'),root=fs.mkdtempSync(path.join(os.tmpdir(),'buyerlog-backlog-excel-options-'));
const port=Number(process.env.BUYER_LOG_BACKLOG_OPTIONS_PORT||6494),base=`http://127.0.0.1:${port}`;
const env={...process.env,BUYER_LOG_CONFIG_PATH:path.join(root,'config.json')};
for(const [key,dir] of Object.entries({BUYER_LOG_DATA_ROOT:'app',BUYER_LOG_SERVER_DATA_ROOT:'server',BUYER_LOG_LOCAL_DATA_ROOT:'local',BUYER_LOG_TEMP_ROOT:'temp'})){
  env[key]=path.join(root,dir);fs.mkdirSync(env[key],{recursive:true});
}
env.BUYER_LOG_AUTH_DATA_ROOT=env.BUYER_LOG_SERVER_DATA_ROOT;
env.BL_DATA_DIR=env.BUYER_LOG_SERVER_DATA_ROOT;
const source=path.join(root,'source');fs.mkdirSync(source);
fs.writeFileSync(env.BUYER_LOG_CONFIG_PATH,JSON.stringify({port,host:'127.0.0.1',sourceFolder:source,updates:{enabled:false}}));
const demo=require('./generate-demo-data').build({rows:20,seed:7,today:new Date('2026-11-03T00:00:00Z')});
demo.asas[2].push('Demo Extra Column');
for(let i=3;i<demo.asas.length;i++)demo.asas[i].push('EXTRA-'+i);
const XLSX=require('xlsx');
for(const [name,rows] of [['ASAS',demo.asas],['Antrepo',demo.antrepo]]){
  const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(rows),name);XLSX.writeFile(wb,path.join(source,`${name} - Demo.xlsx`));
}
const log=fs.openSync(path.join(root,'server.log'),'a');
const server=spawn(process.execPath,['server/server.js'],{cwd:app,env,stdio:['ignore',log,log]});
let browser,cookie;
async function api(url,body){
  const res=await fetch(base+url,{method:body?'POST':'GET',headers:{cookie:cookie||'','Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});
  assert.ok(res.ok,await res.clone().text());return res;
}
(async()=>{
  console.log('Artifacts:',root);
  let ready=false;
  for(let i=0;i<120;i++){try{ready=(await fetch(base+'/api/health')).status<500;if(ready)break;}catch{}await new Promise(r=>setTimeout(r,250));}
  assert.ok(ready,'demo server did not start; see server.log');
  const login=await api('/api/user-login',{userId:'moderator',newPassword:'demo-excel-options-123',password:'demo-excel-options-123'});
  cookie=login.headers.get('set-cookie').split(';')[0];
  await api('/api/refresh',{});
  for(let i=0;i<120;i++){if(!(await (await api('/api/refresh-status')).json()).running)break;await new Promise(r=>setTimeout(r,250));}
  const original=await (await api('/api/backlog-export?format=json')).json();assert.ok(original.rows.length>0);
  browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH||'/usr/bin/chromium',args:['--no-sandbox']});
  const context=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true,reducedMotion:'reduce'});
  const split=cookie.indexOf('=');await context.addCookies([{name:cookie.slice(0,split),value:cookie.slice(split+1),domain:'127.0.0.1',path:'/',httpOnly:true}]);
  await context.addInitScript(()=>localStorage.setItem('bl.releaseNotes.lastSeenStable.v1','99.0.0'));
  const page=await context.newPage(),errors=[],results=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.dismiss());
  await page.goto(base,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>typeof switchTab==='function',null,{timeout:60000});
  await page.getByText(/Buyer Log'a devam et|Continue to Buyer Log/).click({timeout:4000}).catch(()=>{});
  await page.waitForFunction(()=>!document.getElementById('blBootGuard'),null,{timeout:60000});
  await page.evaluate(async()=>{switchTab('backlog');await BLPerf.ensureFeature('backlogAnalysis');});
  await page.locator('#backlogOverview .bpaTile').first().waitFor();

  await page.locator('#backlogExcelOptionsBtn').click();
  const modal=page.locator('#backlogExportColumnsModal');
  await modal.waitFor();
  assert.equal(await modal.locator('[data-formula-list]').isVisible(),false,'formula editor starts collapsed');
  assert.equal(await modal.locator('[data-col-available]').isVisible(),false,'catalog starts collapsed');
  const initial=await modal.locator('[data-col-id]').count();
  await modal.locator('[data-col-remove="field:0"]').click();
  assert.equal(await modal.locator('[data-col-id="field:0"]').count(),0,'default column removed');
  await modal.locator('[data-col-toggle-add]').click();
  await modal.locator('[data-col-search]').fill('Demo Extra Column');
  await page.waitForFunction(()=>[...document.querySelectorAll('[data-col-add-id]')].some(e=>e.textContent.includes('Demo Extra Column')));
  const extra=modal.locator('[data-col-add-id]').filter({hasText:'Demo Extra Column'});
  const extraId=await extra.getAttribute('data-col-add-id');
  await extra.click();
  assert.equal(await modal.locator('[data-col-id]').count(),initial,'one removed and one added');
  assert.equal(await modal.locator('[data-col-add-id]').count(),0,'selected column cannot be added twice');
  await modal.locator('[data-col-up="'+extraId+'"]').focus();
  await page.keyboard.press('Enter');
  assert.equal(await page.evaluate(()=>document.activeElement.dataset.colUp),extraId,'keyboard focus survives reordering');
  const selected=await modal.locator('[data-col-id]').evaluateAll(els=>els.map(e=>e.dataset.colId));
  await modal.locator('[data-save]').click();
  await page.locator('#backlogExcelOptionsBtn').click();
  assert.deepEqual(await modal.locator('[data-col-id]').evaluateAll(els=>els.map(e=>e.dataset.colId)),selected,'saved order persists');
  await modal.locator('[data-col-reset-selection]').click();
  assert.equal(await modal.locator('[data-col-id="field:0"]').count(),1,'restore defaults');
  await page.keyboard.press('Escape');
  assert.deepEqual(await page.evaluate(()=>backlogExcelColumns()),selected,'cancel leaves saved choice intact');
  await page.locator('#backlogExcelOptionsBtn').click();
  await modal.evaluate(el=>{while(el.querySelector('[data-col-remove]'))el.querySelector('[data-col-remove]').click();});
  assert.equal(await modal.locator('[data-save]').isDisabled(),true,'empty report cannot be saved');
  await modal.locator('[data-col-reset-selection]').click();
  assert.equal(await modal.locator('[data-save]').isEnabled(),true);
  await page.keyboard.press('Escape');
  const expectedDataHeaders=await page.evaluate(()=>backlogSelectedDataHeaders([...backlogExcelColumnCatalog().values()].map(item=>item.header)));
  const expectedHeaders=await page.evaluate(async()=>{
    const data=await fetchJSON('/api/backlog-export?'+new URLSearchParams(backlogExportQueryParams()));
    return backlogExpandDateDimensions(backlogSelectedDataHeaders(data.headers),[]).headers;
  });
  // Check actual downloaded Excel headers and values through both entry points.
  for(const button of ['backlogExportBtn','backlogExportV3Btn']){
    const downloadPromise=page.waitForEvent('download');await page.locator('#'+button).click();
    const download=await downloadPromise,file=path.join(root,button+'.xlsx');await download.saveAs(file);
    const wb=XLSX.readFile(file,{cellStyles:true}),sheet=wb.Sheets.BACKLOG;
    const rows=XLSX.utils.sheet_to_json(sheet),headers=XLSX.utils.sheet_to_json(sheet,{header:1})[0];
    const visibleHeaders=headers.filter((_,index)=>!sheet['!cols']?.[index]?.hidden);
    assert.deepEqual(visibleHeaders,expectedHeaders,'saved visible column order in '+button);
    assert.ok(!headers.includes('Sezon'),'removed default stays out of '+button);
    assert.ok(headers.some(h=>h.includes('Demo Extra Column')),'extra column in '+button);
    assert.ok(rows.some(row=>Object.entries(row).some(([h,v])=>h.includes('Demo Extra Column')&&String(v).startsWith('EXTRA-'))),'real source values in '+button);
    if(button==='backlogExportV3Btn'){
      const v3=wb.Sheets['Backlog V3'],v3Headers=XLSX.utils.sheet_to_json(v3,{header:1})[0];
      assert.deepEqual(v3Headers.slice(2),expectedDataHeaders.map(header=>header.replace(/\n/g,' ')),'V3 detail follows the saved selection');
      const extraHeader=v3Headers.find(header=>header.includes('Demo Extra Column'));
      assert.ok(XLSX.utils.sheet_to_json(v3).some(row=>String(row[extraHeader]).startsWith('EXTRA-')),'V3 detail has the extra values');
    }
    results.push({export:button,rows:rows.length,pass:true});
  }

  await page.evaluate(()=>document.querySelectorAll('[data-ui-feedback-close]').forEach(button=>button.click()));
  await page.locator('#backlogExcelOptionsBtn').click();
  await page.screenshot({path:path.join(root,'excel-options-simple.png')});
  await page.keyboard.press('Escape');
  // TR/EN, both themes, all scales, keyboard and overflow; actual app, demo data.
  for(const lang of ['tr','en'])for(const theme of ['light','dark'])for(const scale of ['standard','large','xl','compact']){
    await page.evaluate(({lang,theme,scale})=>{applyLanguage(lang);document.documentElement.dataset.theme=theme;document.documentElement.dataset.uiScale=scale;},{lang,theme,scale});
    await page.locator('#backlogExcelOptionsBtn').click();
    assert.equal(await modal.locator('[data-formula-list]').isVisible(),false);
    await modal.locator('[data-col-toggle-add]').click();
    const layout=await modal.evaluate(el=>{const card=el.querySelector('[role="dialog"]');return {overflow:card.scrollWidth>card.clientWidth+1,bounds:card.getBoundingClientRect().right>innerWidth};});
    assert.deepEqual(layout,{overflow:false,bounds:false},`${lang}/${theme}/${scale}`);
    assert.equal(await modal.locator('[data-col-toggle-add]').innerText(),lang==='tr'?'Sütun ekle':'Add column');
    assert.equal(await modal.locator('.backlogColGroupLabel').first().textContent(),lang==='tr'?'Sabit alanlar':'Fixed fields');
    if(scale==='standard')await page.screenshot({path:path.join(root,`excel-options-${lang}-${theme}.png`)});
    await page.keyboard.press('Escape');
  }
  await page.setViewportSize({width:980,height:740});
  await page.evaluate(()=>applyLanguage('tr'));
  await page.locator('#backlogExcelOptionsBtn').click();
  await modal.locator('[data-col-toggle-add]').click();
  const compactLayout=await modal.evaluate(el=>{const card=el.querySelector('[role="dialog"]');return {overflow:card.scrollWidth>card.clientWidth+1,footer:el.querySelector('[data-save]').getBoundingClientRect().bottom<=innerHeight};});
  assert.deepEqual(compactLayout,{overflow:false,footer:true},'smaller window');
  await page.keyboard.press('Escape');
  await page.setViewportSize({width:1440,height:1000});
  // Language change keeps unsaved edits, search and formula input intact.
  await page.locator('#backlogExcelOptionsBtn').click();
  await modal.locator('[data-col-remove="field:1"]').click();
  await modal.locator('[data-formula-settings] summary').click();
  await modal.locator('[data-formula-header]').first().fill('=42');
  await page.evaluate(()=>applyLanguage('tr'));
  assert.equal(await modal.locator('[data-col-id="field:1"]').count(),0);
  assert.equal(await modal.locator('[data-formula-header]').first().inputValue(),'=42');
  await page.evaluate(()=>applyLanguage('en'));
  assert.equal(await modal.locator('[data-formula-header]').first().inputValue(),'=42');
  assert.equal(await modal.locator('[data-col-toggle-add]').innerText(),'Add column');
  await page.keyboard.press('Escape');
  await page.emulateMedia({reducedMotion:'no-preference'});
  await page.locator('#backlogExcelOptionsBtn').click();
  await modal.locator('[data-col-toggle-add]').click();
  await page.waitForFunction(()=>!document.getElementById('backlogExcelAddColumns').hidden);
  await modal.locator('[data-col-toggle-add]').click();
  assert.equal(await modal.locator('[data-col-toggle-add]').getAttribute('aria-expanded'),'false');
  await page.keyboard.press('Escape');
  assert.deepEqual(errors,[],'no browser errors');
  fs.writeFileSync(path.join(root,'results.json'),JSON.stringify(results,null,2));console.log(JSON.stringify({root,results}));
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{if(browser)await browser.close();server.kill('SIGTERM');});
