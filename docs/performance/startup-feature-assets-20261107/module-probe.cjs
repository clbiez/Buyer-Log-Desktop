const fs=require('node:fs'),path=require('node:path'),{spawn}=require('node:child_process');
const {chromium}=require('/opt/codex/cua_node/lib/node_modules/playwright');
const app=process.argv[2],root=process.argv[3],out=process.argv[4],visual=process.argv.includes('--visual');
const config=JSON.parse(fs.readFileSync(path.join(root,'config.json'))),base='http://127.0.0.1:'+config.port;
const env={...process.env,BUYER_LOG_CENTRAL_IAM_ENABLED:'0',BUYER_LOG_SERVER_DATA_ROOT:root+'/data',BUYER_LOG_AUTH_DATA_ROOT:root+'/data',BUYER_LOG_DATA_ROOT:root+'/app',BUYER_LOG_LOCAL_DATA_ROOT:root+'/local',BUYER_LOG_LOCAL_DB:root+'/local/BuyerLogLocal.db',BUYER_LOG_CONFIG_PATH:root+'/config.json',BUYER_LOG_TEMP_ROOT:root+'/tmp'};
const log=fs.openSync(root+'/module-server.log','a'),server=spawn(process.execPath,[app+'/server/server.js'],{cwd:app,env,stdio:['ignore',log,log]});fs.closeSync(log);
const delay=ms=>new Promise(r=>setTimeout(r,ms));
let browser,currentPage;const report={synthetic:true,modules:[],errors:[],checks:[],screenshots:[]};
const save=()=>fs.writeFileSync(out,JSON.stringify(report,null,2)+'\n');
async function loaded(page,module,feature,selector){
  const timing=await page.evaluate(async({module,feature})=>{
    const started=performance.now();switchTab(module);await window.BLPerf.ensureFeature(feature);
    await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
    return {featureReadyMs:performance.now()-started,started};
  },{module,feature});
  if(selector)await page.waitForSelector(selector,{state:'visible',timeout:120000});
  if(module==='manufacturers')await page.waitForFunction(()=>Boolean(window.BLManufacturersPage?.state?.result),null,{timeout:120000});
  if(module==='backlog')await page.waitForFunction(()=>typeof lastBacklogData!=='undefined'&&lastBacklogData?.totalRows>0,null,{timeout:120000});
  const uiReadyMs=await page.evaluate(s=>performance.now()-s,timing.started);
  report.modules.push({module,feature,featureReadyMs:timing.featureReadyMs,uiReadyMs});save();console.log('opened '+module+' '+Math.round(uiReadyMs)+'ms');
}
async function startup(page){
  await page.goto(base+'/?module=overview',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>document.getElementById('blBootGuard')?.dataset.ready==='1',null,{timeout:120000});
  await page.evaluate(()=>BLBootGuard.continue());
  await page.waitForFunction(()=>!document.getElementById('blBootGuard'),null,{timeout:120000});
  await page.waitForTimeout(1800);
  await page.evaluate(()=>document.querySelectorAll('dialog[open]').forEach(d=>d.close()));
}
async function shot(page,name){
  const file=path.dirname(out)+'/'+name+'.png';await page.screenshot({path:file,timeout:120000});report.screenshots.push(file);save();
}
(async()=>{
 try{
  for(let i=0;i<100;i++){try{if((await fetch(base+'/api/status')).ok)break;}catch(_){}await delay(250);}
  const password='synthetic-startup-only-123';const login=await fetch(base+'/api/user-login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({userId:'moderator',password,newPassword:password})});
  if(!login.ok)throw Error('login '+login.status);
  const cookie=login.headers.get('set-cookie').split(';')[0],split=cookie.indexOf('=');
  browser=await chromium.launch({headless:true,executablePath:'/usr/bin/chromium',args:['--no-sandbox','--remote-debugging-port=9223']});
  const context=await browser.newContext({viewport:{width:1600,height:1000},acceptDownloads:true});
  await context.addCookies([{name:cookie.slice(0,split),value:cookie.slice(split+1),url:base,httpOnly:true}]);
  const page=currentPage=await context.newPage();page.on('pageerror',error=>report.errors.push(error.message));
  await page.route('https://**',r=>r.abort());await startup(page);
  if(!visual)await page.waitForFunction(()=>BLPerf.timeline().some(m=>m.name==='BACKGROUND_WARMUP_DONE'),null,{timeout:180000});
  if(process.argv.includes('--lfl-visual-only')){
    for(const lang of ['tr','en'])for(const theme of ['light','dark']){
      await page.evaluate(({lang,theme})=>{if(appLang!==lang)document.getElementById('railLangBtn').click();document.documentElement.dataset.theme=theme;switchTab('lfl');}, {lang,theme});
      await page.evaluate(()=>BLPerf.ensureFeature('lfl'));
      await page.waitForFunction(()=>document.getElementById('lflLoadingState').hidden&&document.getElementById('lflKpis').textContent.length>0,null,{timeout:120000});
      await page.waitForTimeout(1200);const holds=page.locator('.blTriviaHold:not([hidden]) [data-hold-continue]');for(let i=0;i<await holds.count();i++)if(await holds.nth(i).isVisible())await holds.nth(i).click();await page.waitForTimeout(350);
      await page.waitForSelector('#lflContent',{state:'visible'});await page.waitForTimeout(700);await shot(page,'lazy-lfl-'+lang+'-'+theme);
    }
    report.status='passed';save();return;
  }
  const unopened=await page.evaluate(()=>performance.getEntriesByType('resource').filter(r=>/\/(excel-import-(workbook|wizard)|collection-spreadsheet|backlog-plan-actual|backlog-presentation)\.(js|css)/.test(new URL(r.name).pathname)).map(r=>r.name));
  report.unopenedResources=unopened;
  await loaded(page,'source','dataManagement','#dataManagementRoot button');
  // Open a collapsible source card and verify its controls are live.
  await page.locator('#dataManagementRoot button').first().click();report.checks.push('data-management controls');
  await loaded(page,'manufacturers','manufacturers','.mfpSearch');
  await page.locator('.mfpSearch').fill('SUPPLIER');await page.locator('.mfpSearch').fill('');report.checks.push('manufacturer search');
  await loaded(page,'licensecards','licensecards','.lcPage:not([aria-busy="true"])');
  await page.waitForFunction(()=>!document.querySelector('.lcPage[aria-busy="true"]'),null,{timeout:120000});
  report.checks.push('license cards loaded');
  await loaded(page,'lfl','lfl','#lflKpis');
  await page.waitForFunction(()=>document.getElementById('lflLoadingState').hidden,null,{timeout:120000});
  report.checks.push('LFL data and KPI controls');
  await loaded(page,'opencosting','openCosting','#ocNewBtn');
  await page.locator('#ocNewBtn').click();await page.waitForSelector('#ocEditor:not([hidden])');report.checks.push('new costing editor');
  // Close the unsaved local editor without creating a persistent cost record.
  await page.evaluate(()=>{document.querySelector('#ocEditor input')?.blur();});
  page.on('dialog',d=>d.accept());
  await loaded(page,'automations','automations','.autoShell');report.checks.push('automation studio controls');
  await loaded(page,'quotations','collectionTools','.pdShell');
  await page.locator('[data-pd-tab="history"]').click();report.checks.push('pricing desk history tab');
  await loaded(page,'koleksiyon','collectionTools','#kolTable');
  await page.evaluate(()=>{kolRows=[migrateKolRow({id:900001,modelKod:'DEMO LAZY',plmId:'DEMO-001',durum:kolStatusDefaultName(),not:'',pricing:{},pricingSent:{}})];renderKol();});
  await page.waitForSelector('#kolTable tbody tr[data-id]');
  const cell=page.locator('#kolTable tbody td[data-key="modelKod"]').first();await cell.click();
  await page.keyboard.press('ArrowRight');
  const active=await page.evaluate(()=>Boolean(BLCollectionSpreadsheet.state.active));if(!active)throw Error('Spreadsheet active-cell navigation failed');
  report.checks.push('spreadsheet single click and arrow navigation');
  await loaded(page,'backlog','backlogAnalysis','#backlogPlanActualToggle');
  await page.waitForFunction(()=>typeof lastBacklogData!=='undefined'&&lastBacklogData?.totalRows>0,null,{timeout:120000});
  let reportStarted=await page.evaluate(()=>performance.now());
  await page.evaluate(()=>BLBacklogPlanActual.open());
  await page.waitForSelector('[data-bpa-control="planMode"]',{timeout:120000});report.checks.push('plan/actual data and period controls');report.modules.push({module:'backlogPlanActual',uiReadyMs:await page.evaluate(s=>performance.now()-s,reportStarted)});
  reportStarted=await page.evaluate(()=>performance.now());
  await page.evaluate(()=>BLBacklogPresentation.open());
  await page.waitForSelector('.blpOverlay iframe',{timeout:120000});report.checks.push('presentation report preview');report.modules.push({module:'backlogPresentation',uiReadyMs:await page.evaluate(s=>performance.now()-s,reportStarted)});
  await page.evaluate(()=>BLBacklogPresentation.close());
  await page.evaluate(()=>switchTab('cp'));
  await page.waitForSelector('#cpTable tbody tr[data-id]',{timeout:120000});
  let t=await page.evaluate(()=>performance.now());
  await page.locator('#cpExcelBtn').click();
  await page.locator('[data-excel-import="cp"]').click();await page.waitForSelector('#excelImportWizard');
  report.modules.push({module:'excelImport',uiReadyMs:await page.evaluate(s=>performance.now()-s,t)});
  const XLSX=require(app+'/node_modules/xlsx');const book=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet([['Order Code','Buyer Note'],['DEMO-001','Synthetic import preview']]),'Demo');
  const file=path.dirname(out)+'/smoke-import.xlsx';XLSX.writeFile(book,file);
  await page.locator('[data-xim="file"]').setInputFiles(file);
  await page.waitForFunction(()=>document.querySelector('[data-xim="next"]')?.disabled===false,null,{timeout:120000});
  await page.locator('[data-xim="next"]').click();report.checks.push('Excel workbook parsed and wizard advanced');
  await page.evaluate(()=>BLExcelImportWizard.close());
  t=await page.evaluate(()=>performance.now());
  await page.evaluate(async()=>{await BLPerf.ensureFeature('userManagement');BLUserManagement.open();});
  await page.waitForSelector('.umShell');report.modules.push({module:'userManagement',uiReadyMs:await page.evaluate(s=>performance.now()-s,t)});
  report.checks.push('user-management dialog');await page.evaluate(()=>BLUserManagement.close());
  await loaded(page,'overview','exceptionInbox','#view-overview');
  await page.evaluate(()=>BLExceptionInboxView.sync());report.checks.push('exception inbox sync');
  await page.keyboard.press('F1');await page.waitForSelector('[data-guide-search]');
  await page.locator('[data-guide-search]').fill('Excel');report.checks.push('F1 guide search');await page.locator('[data-guide-close]').click();
  if(visual){
    for(const lang of ['tr','en'])for(const theme of ['light','dark']){
      await page.evaluate(({lang,theme})=>{if(appLang!==lang)document.getElementById('railLangBtn').click();BLStorage.setItem('lcw_theme',theme);document.documentElement.dataset.theme=theme;}, {lang,theme});
      for(const tab of ['source','manufacturers','licensecards','lfl','quotations','koleksiyon','backlog','opencosting','automations','priceanalysis']){
        await page.evaluate(tab=>switchTab(tab),tab);await page.waitForTimeout(700);await shot(page,'lazy-'+tab+'-'+lang+'-'+theme);
      }
      await page.evaluate(()=>switchTab('source'));
      
      await page.evaluate(()=>{const b=document.querySelector('[data-tool="maintenance"]')?.closest('[data-dm-panel]')?.querySelector('[data-dm-panel-toggle]');if(b?.getAttribute('aria-expanded')==='false')b.click();});
      if(!(await page.locator('.blDataMaintCard').isVisible())){if(await page.locator('[data-tool="maintenance"]').evaluate(el=>el.closest('.dmToolRow').classList.contains('isOpen')))await page.locator('[data-tool="maintenance"]').click();await page.locator('[data-tool="maintenance"]').click();}await page.waitForSelector('.blDataMaintCard');await shot(page,'lazy-maintenance-'+lang+'-'+theme);
      await page.evaluate(()=>switchTab('backlog'));await page.evaluate(()=>BLBacklogPresentation.open());await page.waitForTimeout(700);await shot(page,'lazy-presentation-'+lang+'-'+theme);await page.evaluate(()=>BLBacklogPresentation.close());
      await page.evaluate(()=>switchTab('cp'));await page.evaluate(()=>BLExcelImportWizard.open('cp'));await shot(page,'lazy-excel-'+lang+'-'+theme);await page.evaluate(()=>BLExcelImportWizard.close());
      await page.evaluate(()=>BLUserManagement.open());await page.waitForTimeout(400);await shot(page,'lazy-users-'+lang+'-'+theme);await page.evaluate(()=>BLUserManagement.close());
      await page.evaluate(()=>switchTab('overview'));await page.evaluate(async()=>{document.getElementById('ovExceptionInbox').classList.remove('ovHomeOff');await BLExceptionInboxView.refresh();});await page.locator('#ovExceptionInbox').scrollIntoViewIfNeeded();await shot(page,'lazy-inbox-'+lang+'-'+theme);
    }
    // A delayed first stylesheet must hide the new view, then reveal a styled screen.
    const cold=await context.newPage();await cold.route('https://**',r=>r.abort());await startup(cold);
    let release,requested;const seen=new Promise(r=>requested=r),held=new Promise(r=>release=r);
    await cold.route('**/manufacturers.css?*',async r=>{requested();await held;await r.continue();});
    await cold.evaluate(()=>switchTab('manufacturers'));await seen;
    const hidden=await cold.evaluate(()=>getComputedStyle(document.getElementById('view-manufacturers')).visibility==='hidden');
    if(!hidden)throw Error('Unstyled module was visible while CSS was pending');release();
    await cold.waitForSelector('.mfpSearch');report.checks.push('delayed CSS prevents unstyled first paint');
    await cold.close();
  }
  if(!visual){
    await page.close();
    const collection=await context.newPage();await collection.route('https://**',r=>r.abort());await startup(collection);
    await collection.waitForFunction(()=>BLPerf.timeline().some(m=>m.name==='BACKGROUND_WARMUP_DONE'),null,{timeout:180000});
    await loaded(collection,'koleksiyon','collectionTools','#kolTable');report.modules[report.modules.length-1].module='koleksiyonCold';await collection.close();
  }
  report.status='passed';save();console.log(JSON.stringify({status:report.status,errors:report.errors,checks:report.checks,modules:report.modules}));
 }catch(error){if(currentPage)try{await currentPage.screenshot({path:path.dirname(out)+'/failure.png'});}catch(_){}report.status='failed';report.error=error.stack;save();console.error(error);process.exitCode=1;}
 finally{if(browser)await browser.close();server.kill('SIGTERM');await Promise.race([new Promise(r=>server.once('exit',r)),delay(10000)]);if(server.exitCode===null)server.kill('SIGKILL');}
})();
