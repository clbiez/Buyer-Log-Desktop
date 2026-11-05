'use strict';
// Real Buyer Log on isolated demo data. Requires Playwright + Chromium.
// NODE_PATH can point at an external Playwright installation. No production data is read.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict'),{spawn}=require('node:child_process');
const {chromium}=require('playwright');
const app=path.resolve(__dirname,'..'),root=fs.mkdtempSync(path.join(os.tmpdir(),'buyerlog-excel-ai-'));
const port=Number(process.env.BUYER_LOG_MENU_MOTION_PORT||6497),base=`http://127.0.0.1:${port}`;
const env={...process.env,BUYER_LOG_CONFIG_PATH:path.join(root,'config.json')};
for(const [key,dir] of Object.entries({BUYER_LOG_DATA_ROOT:'app',BUYER_LOG_SERVER_DATA_ROOT:'server',BUYER_LOG_LOCAL_DATA_ROOT:'local',BUYER_LOG_TEMP_ROOT:'temp'})){
  env[key]=path.join(root,dir);fs.mkdirSync(env[key],{recursive:true});
}
env.BUYER_LOG_AUTH_DATA_ROOT=env.BUYER_LOG_SERVER_DATA_ROOT;
env.BL_DATA_DIR=env.BUYER_LOG_SERVER_DATA_ROOT;
const source=path.join(root,'source');fs.mkdirSync(source);
fs.writeFileSync(env.BUYER_LOG_CONFIG_PATH,JSON.stringify({port,host:'127.0.0.1',sourceFolder:source,updates:{enabled:false}}));
const demo=require(app+'/scripts/generate-demo-data').build({rows:20,seed:7,today:new Date('2026-11-03T00:00:00Z')});
const XLSX=require(app+'/node_modules/xlsx');
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
  const login=await api('/api/user-login',{userId:'moderator',newPassword:'demo-borders-123',password:'demo-borders-123'});
  cookie=login.headers.get('set-cookie').split(';')[0];
  await api('/api/refresh',{});
  for(let i=0;i<120;i++){if(!(await (await api('/api/refresh-status')).json()).running)break;await new Promise(r=>setTimeout(r,250));}
  browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH||'/usr/bin/chromium',args:['--no-sandbox']});
  const context=await browser.newContext({viewport:{width:1600,height:1000},reducedMotion:'reduce'});
  const split=cookie.indexOf('=');await context.addCookies([{name:cookie.slice(0,split),value:cookie.slice(split+1),domain:'127.0.0.1',path:'/',httpOnly:true}]);
  await context.addInitScript(()=>localStorage.setItem('bl.releaseNotes.lastSeenStable.v1','99.0.0'));
  const page=await context.newPage(),errors=[],results=[];
  await context.addInitScript(()=>{
    window.menuMotionCalls=[];
    const animate=Element.prototype.animate;
    Element.prototype.animate=function(frames,options){
      const result=animate.call(this,frames,options);
      menuMotionCalls.push({target:this,frames,options,animation:result});return result;
    };
  });
  page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.dismiss());
  await page.goto(base,{waitUntil:'domcontentloaded',timeout:60000});
  await page.waitForFunction(()=>typeof switchTab==='function',null,{timeout:60000});
  await page.getByText(/Buyer Log'a devam et|Continue to Buyer Log/).click({timeout:4000}).catch(()=>{});
  await page.waitForFunction(()=>!document.getElementById('blBootGuard'),null,{timeout:60000});

  await page.evaluate(()=>switchTab('koleksiyon'));
  await page.waitForFunction(()=>window.BLExcelImportBridge?.get('collection')?.canEdit());
  const file=path.join(root,'Excel-Demo.xlsx'),workbook=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook,XLSX.utils.aoa_to_sheet([
    ['PLM ID','Target Price'],['001234','$ 12,50'],['001235','$ 18,75']
  ]),'Demo');
  XLSX.writeFile(workbook,file);
  let requests=0, mode='ok',workspaceWrites=0;
  page.on('request',request=>{if(/\/api\/collection-workspaces\//.test(request.url())&&['PATCH','PUT'].includes(request.method()))workspaceWrites++;});
  await page.route('**/api/lcwai/status*',route=>route.fulfill({json:{ok:true,status:{connected:true}}}));
  await page.route('**/api/lcwai/ask',async route=>{
    requests++;
    const body=route.request().postDataJSON();
    assert.equal(body.source,'excel-import');
    assert.equal(body.context.coverage.totalRows,2);
    assert.ok(body.context.sampleRows.some(row=>row.values.includes('001234')));
    const event=mode==='error'?{type:'error',error:{code:'LCWAI_NETWORK'}}:{type:'result',result:{structured:{ok:true},data:{
      explanation:body.lang==='en'?'The sample has currency marks in the price column. Use PLM ID for matching and normalize prices.':'Örnek satırlardaki fiyatlarda para birimi işaretleri var. PLM ID ile eşleştirin ve fiyat biçimini düzeltin.',
      warnings:[],operationsJson:JSON.stringify([{op:'map',columnId:'col:1',targetId:'targetPrice',action:'update'},{op:'normalize',columnId:'col:1'}])
    }}};
    await route.fulfill({contentType:'application/x-ndjson',body:JSON.stringify(event)+'\n'});
  });
  await page.evaluate(()=>BLExcelImportWizard.open('collection'));
  await page.locator('[data-xim="file"]').setInputFiles(file);
  await page.locator('[data-xim="ai-review"]').waitFor();
  const original=await page.evaluate(()=>JSON.stringify(BLExcelImportWizard._state().table.rows));
  async function ask(){
    await page.locator('[data-xim="ai-review"]').click();
    await page.locator('[data-lcwai-ask]').click();
    await page.locator('[data-lcwai-suggestion]').waitFor({state:'visible'});
    assert.equal(await page.locator('[data-lcwai-apply]').isEnabled(),true);
  }
  await ask();
  assert.match(await page.locator('[data-lcwai-result]').innerText(),/12.5/);
  assert.equal(await page.evaluate(()=>JSON.stringify(BLExcelImportWizard._state().table.rows)),original,'AI response does not mutate source');
  assert.equal(workspaceWrites,0,'no persistence before acceptance');
  const captureRoot=process.env.BUYER_LOG_EXCEL_AI_CAPTURE_ROOT||root;
  fs.mkdirSync(captureRoot,{recursive:true});
  await page.screenshot({path:path.join(captureRoot,'excel-import-lcw-ai.png')});
  await page.locator('[data-lcwai-apply]').click();
  assert.equal(await page.evaluate(()=>BLExcelImportWizard._state().plan.summary.creates),2);
  assert.equal(workspaceWrites,0,'AI apply stages a plan, without saving');
  await page.locator('[data-xim="ai-undo"]').click();
  assert.equal(await page.evaluate(()=>JSON.stringify(BLExcelImportWizard._state().table.rows)),original,'undo restores original Excel values');
  await ask();
  // An external revision/config change after the answer invalidates acceptance.
  await page.evaluate(()=>{BLExcelImportWizard._state().options.createNew=false;});
  await page.locator('[data-lcwai-apply]').click();
  await page.waitForFunction(()=>document.querySelector('[data-lcwai-status]').classList.contains('is-error'));
  assert.equal(await page.evaluate(()=>JSON.stringify(BLExcelImportWizard._state().table.rows)),original);
  await page.locator('[data-lcwai-panel-close]').click();
  await page.evaluate(()=>{BLExcelImportWizard._state().options.createNew=true;});
  await ask();
  await page.locator('[data-lcwai-apply]').click();
  for(const lang of ['tr','en'])for(const theme of ['light','dark'])for(const scale of ['compact','standard','large','xl']){
    await page.evaluate(({lang,theme,scale})=>{applyLanguage(lang);Object.assign(document.documentElement.dataset,{theme,uiScale:scale});},{lang,theme,scale});
    const button=page.locator('[data-xim="ai-review"]');
    assert.match(await button.innerText(),lang==='en'?/Review Excel/:/Exceli/);
    assert.ok(await button.isVisible());
    const geometry=await page.locator('.ximCard').evaluate(el=>({width:el.getBoundingClientRect().width,viewport:innerWidth,scroll:document.documentElement.scrollWidth}));
    assert.ok(geometry.width<=geometry.viewport&&geometry.scroll<=geometry.viewport+1,JSON.stringify({lang,theme,scale,geometry}));
    results.push({lang,theme,scale});
  }
  await page.locator('[data-xim="next"]').click();
  await page.waitForFunction(()=>BLExcelImportWizard._state()?.result?.status==='success');
  assert.equal(workspaceWrites,1,'final import uses the real collection workspace writer once');
  let saved=await page.evaluate(()=>{const adapter=BLExcelImportBridge.get('collection');return adapter.rows().map(row=>({plmId:row.plmId,targetPrice:adapter.readValue(row,'targetPrice')}));});
  assert.equal(saved.length,2);
  assert.deepEqual(saved.map(row=>row.plmId).sort(),['001234','001235']);
  assert.deepEqual(saved.map(row=>Number(row.targetPrice)).sort((a,b)=>a-b),[12.5,18.75]);
  await page.evaluate(()=>BLExcelImportWizard.close());
  await page.reload({waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>window.BLExcelImportBridge);
  await page.getByText(/Buyer Log'a devam et|Continue to Buyer Log/).click({timeout:4000}).catch(()=>{});
  await page.evaluate(()=>switchTab('koleksiyon'));
  await page.waitForFunction(()=>BLExcelImportBridge.get('collection').rows().length===2);
  await page.evaluate(()=>BLExcelImportWizard.open('collection'));
  await page.locator('[data-xim="file"]').setInputFiles(file);
  mode='error';
  await page.locator('[data-xim="ai-review"]').click();
  await page.locator('[data-lcwai-ask]').click();
  await page.waitForFunction(()=>document.querySelector('[data-lcwai-status]').classList.contains('is-error'));
  await page.locator('[data-lcwai-panel-close]').click();
  assert.ok(await page.locator('[data-xim="next"]').isEnabled(),'manual import remains available when AI fails');
  await page.locator('[data-xim="ai-review"]').click();
  await page.keyboard.press('Escape');
  assert.ok(await page.locator('#excelImportWizard').isVisible(),'Escape dismisses the AI child without closing the workbook');
  assert.equal(errors.length,0,errors.join('\n'));
  fs.writeFileSync(path.join(root,'results.json'),JSON.stringify({requests,workspaceWrites,matrix:results,errors},null,2));
  console.log('PASS: real workbook, AI preview, undo, stale acceptance, final persisted import and reload, AI failure, Escape; TR/EN × 2 themes × 4 scales');
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{
  if(browser)await browser.close();
  server.kill('SIGTERM');
});
