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
  await loaded(page,'koleksiyon','collectionTools','#kolTable');
  await page.evaluate(()=>{kolRows=[migrateKolRow({id:900001,modelKod:'DEMO LAZY',plmId:'DEMO-001',durum:kolStatusDefaultName(),not:'',pricing:{},pricingSent:{}})];renderKol();});
  await page.locator('#kolTable tbody td[data-key="modelKod"]').first().click();
  const selected=await page.evaluate(()=>BLCollectionSpreadsheet.state.active?.key);
  await page.keyboard.press('Escape');
  const escaped=await page.evaluate(()=>({key:BLCollectionSpreadsheet.state.active?.key,editing:Boolean(BLCollectionSpreadsheet.state.editingCell),focus:document.activeElement?.id}));
  if(escaped.key!==selected||escaped.editing||escaped.focus!=='kolTable')throw Error('Escape did not preserve the selected cell and grid focus');
  await page.keyboard.press('ArrowRight');
  const moved=await page.evaluate(()=>BLCollectionSpreadsheet.state.active?.key);
  if(!moved||moved===selected)throw Error('ArrowRight did not move the spreadsheet selection');
  report.grid={selected,escaped,moved};report.checks.push('Escape preserves cell selection and table focus; ArrowRight moves to a different column');report.status='passed';save();console.log(JSON.stringify(report.grid));return;
 }catch(error){if(currentPage)try{await currentPage.screenshot({path:path.dirname(out)+'/failure.png'});}catch(_){}report.status='failed';report.error=error.stack;save();console.error(error);process.exitCode=1;}
 finally{if(browser)await browser.close();server.kill('SIGTERM');await Promise.race([new Promise(r=>server.once('exit',r)),delay(10000)]);if(server.exitCode===null)server.kill('SIGKILL');}
})();
