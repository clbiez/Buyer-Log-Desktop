'use strict';

// Reproducible, local-only startup measurement with synthetic Excel sources.
// Requires Playwright; CHROMIUM_PATH can select a system Chromium executable.
// node scripts/benchmark-startup-orders.js --rows 30000 --out /tmp/startup.json
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),net=require('node:net');
const {spawn,spawnSync}=require('node:child_process');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const APP=path.resolve(__dirname,'../../../resources/app');
const arg=(name,fallback)=>{const index=process.argv.indexOf(name);return index<0?fallback:process.argv[index+1];};
const count=Math.max(1,Number(arg('--rows',30000))||30000);
const requestedModules=arg('--module','')?[arg('--module','')]:['overview','koleksiyon','cp','orders'];
if(requestedModules.some(module=>!['overview','koleksiyon','cp','orders'].includes(module)))throw new Error('Unsupported benchmark module');
const root=arg('--fixture-root','')||fs.mkdtempSync(path.join(os.tmpdir(),'buyerlog-startup-'));
if(path.dirname(path.resolve(root))!==path.resolve(os.tmpdir())||!path.basename(root).startsWith('buyerlog-startup-'))throw new Error('Benchmark fixture must be a buyerlog-startup-* directory directly under the system temp directory');
const output=arg('--out',path.join(root,'measurement.json'));
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let server,browser,cookie='',port,base;
const env={...process.env,BUYER_LOG_SERVER_DATA_ROOT:path.join(root,'data'),BUYER_LOG_DATA_ROOT:path.join(root,'app'),
  BUYER_LOG_LOCAL_DATA_ROOT:path.join(root,'local'),BUYER_LOG_CONFIG_PATH:path.join(root,'config.json'),BUYER_LOG_TEMP_ROOT:path.join(root,'tmp')};
async function api(url,options={}){
  const response=await fetch(base+url,{...options,headers:{cookie,'Content-Type':'application/json',...options.headers}});
  const payload=await response.json();if(!response.ok)throw new Error(url+': '+response.status+' '+JSON.stringify(payload));return payload;
}
async function start(){
  const started=performance.now();
  const log=fs.openSync(path.join(root,'server.log'),'a');
  server=spawn(process.execPath,[path.join(APP,'server/server.js')],{cwd:APP,env,stdio:['ignore',log,log]});fs.closeSync(log);
  for(let i=0;i<240;i++){
    if(server.exitCode!==null)throw new Error('Server exited: '+server.exitCode);
    try{if((await fetch(base+'/api/health')).status<500)return performance.now()-started;}catch(_){}
    await delay(250);
  }
  throw new Error('Server startup timed out');
}
async function stop(){
  if(!server||server.exitCode!==null)return;
  const done=new Promise(resolve=>server.once('exit',resolve));server.kill('SIGTERM');
  await Promise.race([done,delay(10000)]);if(server.exitCode===null){server.kill('SIGKILL');await done;}
}
async function login(){
  const password='synthetic-startup-only-123';
  const response=await fetch(base+'/api/user-login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({userId:'moderator',password,newPassword:password})});
  if(!response.ok)throw new Error('Synthetic login failed: '+response.status);
  cookie=String(response.headers.get('set-cookie')||'').split(';')[0];
}
async function rendererRss(){
  const cdp=await browser.newBrowserCDPSession();
  const {processInfo}=await cdp.send('SystemInfo.getProcessInfo');await cdp.detach();
  return processInfo.filter(p=>p.type==='renderer').reduce((total,p)=>{
    try{const match=fs.readFileSync('/proc/'+p.id+'/status','utf8').match(/^VmRSS:\s+(\d+)/m);return total+(match?Number(match[1])*1024:0);}catch(_){return total;}
  },0);
}
async function open(context,module){
  const page=await context.newPage(),errors=[];
  const network=await context.newCDPSession(page);await network.send('Network.enable');
  await network.send('Network.setBlockedURLs',{urls:['https://*']});
  page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript(()=>{
    window.__startupProbe={readyAt:null,longTasks:[]};
    window.addEventListener('bl:primary-screen-ready',()=>{window.__startupProbe.readyAt=performance.now();},{once:true});
    new PerformanceObserver(list=>window.__startupProbe.longTasks.push(...list.getEntries().map(task=>task.duration))).observe({type:'longtask',buffered:true});
  });
  const started=performance.now();
  await page.goto(base+'/?module='+module,{waitUntil:'domcontentloaded',timeout:120000});
  await page.waitForFunction(()=>window.__startupProbe?.readyAt!==null,null,{timeout:180000});
  await page.waitForFunction(()=>!document.getElementById('blBootGuard')||document.getElementById('blBootGuard').dataset.ready==='1',null,{timeout:180000});
  await page.evaluate(()=>window.BLBootGuard?.continue());
  if(module==='orders')await page.waitForFunction(()=>state.orders?.rows.length>0&&document.querySelector('#ordersTable tbody tr[data-id]'),null,{timeout:180000});
  if(module==='cp')await page.waitForFunction(()=>state.cp?.rows.length>0&&document.querySelector('#cpTable tbody tr[data-id]'),null,{timeout:180000});
  const elapsedMs=performance.now()-started;
  await page.waitForFunction(()=>!document.getElementById('blBootGuard'),null,{timeout:30000});
  const data=await page.evaluate(module=>({module,readyAtMs:window.__startupProbe.readyAt,
    rows:module==='orders'?state.orders?.rows.length:module==='cp'?state.cp?.rows.length:module==='koleksiyon'?kolRows.length:0,
    domRows:document.querySelectorAll(module==='orders'?'#ordersTable tbody tr[data-id]':module==='cp'?'#cpTable tbody tr[data-id]':'#kolTable tbody tr[data-id]').length,
    longTaskTotalMs:window.__startupProbe.longTasks.reduce((sum,value)=>sum+value,0),maxLongTaskMs:Math.max(0,...window.__startupProbe.longTasks),
    resources:performance.getEntriesByType('resource').filter(entry=>entry.name.includes('/api/data')||entry.name.includes('/api/page-projection/')).map(entry=>({path:new URL(entry.name).pathname,ms:entry.duration,decodedBytes:entry.decodedBodySize,encodedBytes:entry.encodedBodySize})),
    timeline:window.BLPerf?.timeline?.(),
  }),module);
  const cdp=await context.newCDPSession(page);await cdp.send('HeapProfiler.collectGarbage');
  await cdp.send('Performance.enable');const {metrics}=await cdp.send('Performance.getMetrics');
  data.retainedJsHeapBytes=metrics.find(metric=>metric.name==='JSHeapUsedSize')?.value;
  data.dom=await cdp.send('Memory.getDOMCounters');await cdp.detach();
  return {page,measurement:{...data,elapsedMs,rendererRssBytes:await rendererRss(),errors}};
}
const assert=require('node:assert/strict');
(async()=>{
 try{
  const socket=net.createServer();await new Promise(resolve=>socket.listen(0,'127.0.0.1',resolve));port=socket.address().port;await new Promise(resolve=>socket.close(resolve));base='http://127.0.0.1:'+port;
  fs.writeFileSync(env.BUYER_LOG_CONFIG_PATH,JSON.stringify({port,sourceFolder:path.join(root,'source')}));await start();await login();
  browser=await chromium.launch({headless:true,executablePath:'/usr/bin/chromium',args:['--no-sandbox']});
  const results=[];
  for(const module of arg('--module','')?[arg('--module','')]:['orders','cp']){
   const context=await browser.newContext({viewport:{width:1600,height:1000}}),split=cookie.indexOf('=');
   await context.addInitScript(()=>localStorage.setItem('bl.releaseNotes.lastSeenStable.v1','7.0.359'));
   await context.addCookies([{name:cookie.slice(0,split),value:cookie.slice(split+1),url:base,httpOnly:true}]);
   const {page}=await open(context,module);await page.waitForFunction(()=>window.BLPerf?.timeline?.().some(mark=>mark.name==='BACKGROUND_WARMUP_DONE'),null,{timeout:600000});await delay(1000);await page.evaluate(()=>{(window.BLStorage||localStorage).setItem('bl.releaseNotes.lastSeenStable.v1','7.0.359');document.querySelectorAll('dialog[open]').forEach(dialog=>dialog.close());});
   await page.exposeFunction('__captureSelection',()=>page.screenshot({path:path.join(root,module+'-selection-ui.png')}));
   const result=await page.evaluate(async module=>{
    const checks=[];const check=(condition,label)=>{if(!condition)throw new Error(module+': '+label);checks.push(label);};
    const wait=()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    const render=()=>module==='orders'?renderOrdersNow():renderCPNow();
    const table=document.getElementById(module==='orders'?'ordersTable':'cpTable');
    const selected=state[module+'Selected'];selected.clear();
    const range=_tableRangeViews.get(table);range.controller.setSize(200);render();await wait();
    let boxes=[...table.querySelectorAll('input.rowChk')];check(boxes.length===200,'200-row page');
    boxes[0].click();await wait();check(selected.size===1,'single checkbox updates Set');
    check(table.tFoot.querySelector('.selectionFooterNumber').textContent==='1','footer count');
    check(!document.getElementById(module+'EndeksmatikBtn').disabled,'visible single Endeksmatik enabled');
    boxes[199].dispatchEvent(new MouseEvent('click',{bubbles:true,shiftKey:true}));await wait();
    check(selected.size===200,'shift range selects 200');
    check(document.getElementById(module+'EndeksmatikBtn').disabled,'Endeksmatik disabled for multiple');
    check(!document.querySelector(`[data-order-license-atlas="${module}"]`).disabled,'atlas retains multiple visible selections');
    selected.clear();boxes[0].checked=false;boxes[0].click();await wait();
    selected.add('__synthetic_hidden_selection__');updateShippingBtnVisibility();await wait();
    check(!document.getElementById(module+'EndeksmatikBtn').disabled,'one visible order stays enabled with other hidden selections');
    selected.delete('__synthetic_hidden_selection__');
    if(module==='cp'){
      const id=[...selected][0];refreshRowsEverywhere([id]);await wait();
      const meta=table.tBodies[0]._chkMeta,original=meta.onSelectionChange;let updates=0;meta.onSelectionChange=function(...args){updates++;return original(...args);};
      table.querySelector('input.rowChk').click();await wait();meta.onSelectionChange=original;
      check(selected.size===0&&updates===1,'row-only refresh retains one delegated action update');
      table.querySelector('input.rowChk').click();await wait();
    }
    const search=document.getElementById(module==='orders'?'ordersSearch':'cpSearch');
    search.value='__synthetic_no_matching_row__';render();await wait();
    check(BLManagedSelection.summary(module).hidden===BLManagedSelection.snapshot(module).hidden.length,'hidden badge equals full snapshot');
    check(!!document.querySelector('#blSelectionBar [data-selection-details].blSelectionHidden'),'outside-filter badge');
    document.querySelector('#blSelectionBar [data-selection-details]').click();await wait();
    check(!document.querySelector('.blSelectionPopover').hidden,'details opens');
    check(document.querySelectorAll('.blSelectionPopoverRow').length===1,'details lists selected row');await window.__captureSelection();
    document.querySelector('[data-selection-close]').click();
    document.querySelector('#blSelectionBar [data-selection-dismiss]').click();await wait();
    check(selected.size===0&&document.getElementById('blSelectionBar').hidden,'clear closes bar');
    const undo=document.querySelector('[data-ui-feedback-action="undo"]');check(!!undo,'undo action exists');undo.click();await wait();
    check(selected.size===1&&!document.getElementById('blSelectionBar').hidden,'undo restores selection and bar');
    search.value='';render();await wait();
    applyLanguage('en');await wait();
    check(document.getElementById('blSelectionBar').textContent.includes('rows selected'),'English bar');
    applyLanguage('tr');await wait();
    check(document.getElementById('blSelectionBar').textContent.includes('satır seçili'),'Turkish bar');
    selected.clear();state.checkFilter[module]='unchecked';render();await wait();
    table.querySelector('input.rowChk').click();await wait();
    check(BLManagedSelection.summary(module).hidden===BLManagedSelection.snapshot(module).hidden.length,'unchecked-filter hidden count');
    check(document.getElementById(module+'EndeksmatikBtn').disabled,'unchecked filter disables Endeksmatik for checked rows');
    check(table.tFoot.querySelector('.selectionFooterNumber').textContent==='1','unchecked-filter footer retains rendered scope');
    state.checkFilter[module]='';render();await wait();
    selected.clear();await new Promise(resolve=>setTimeout(resolve,850));await wait();
    check(document.getElementById('blSelectionBar').hidden,'programmatic clear detected by cheap poll');
    return {module,checks,rows:state[module].rows.length};
   },module);
   const tableId=module==='orders'?'ordersTable':'cpTable';
   await page.locator('#'+tableId+' input.rowChk').first().click();
   await page.locator('#'+tableId+' input.rowChk').nth(199).click({modifiers:['Shift']});
   await page.waitForFunction(([module,tableId])=>state[module+'Selected'].size===200&&document.querySelector('#'+tableId+' .selectionFooterNumber')?.textContent==='200',[module,tableId]);
   result.checks.push('trusted Chromium click and Shift click select 200 rows');
   const code=await page.evaluate(module=>{const ids=state[module+'Selected'];const row=state[module].rows.find(row=>ids.has(row._id));return window.BLCanonicalFields.canonicalValue(row,module,'orderCode');},module);
   assert.ok(code,'Synthetic order must have a canonical order code');
   await page.locator(module==='orders'?'#ordersSearch':'#cpSearch').fill(String(code));
   await page.waitForFunction(module=>window.BLManagedSelection.summary(module)?.hidden===199,module);
   await page.locator('#'+tableId+' input.rowChk').first().uncheck();
   await page.locator('#'+tableId+' input.rowChk').first().check();
   try{await page.waitForFunction(module=>!document.getElementById(module+'EndeksmatikBtn').disabled&&window.BLManagedSelection.summary(module)?.hidden===199,module,{timeout:5000});}catch(error){console.log('UI DIAGNOSTIC',JSON.stringify(await page.evaluate(module=>{const table=document.getElementById(module==='orders'?'ordersTable':'cpTable'),view=table._blSelectionView,selected=state[module+'Selected'];return {module,code:document.getElementById(module==='orders'?'ordersSearch':'cpSearch').value,active:document.body.dataset.activeTab,navActive:document.querySelector('nav.tabs button.active')?.dataset.tab,selected:[...selected].slice(0,4),count:selected.size,summary:BLManagedSelection.summary(module),visible: view.fullRows.map(row=>({id:row._id,partial:row._partialViewActive,index:row._partialViewIndex,checked:selected.has(row._id)})),sourceSame:view.sourceRows===state[module].rows,mode:view.checkMode,helper:selectedEndeksmatikRows(module).map(row=>row._id),disabled:document.getElementById(module+'EndeksmatikBtn').disabled};},module)));throw error;}
   result.checks.push('trusted search leaves one visible order and 199 hidden selections with Endeksmatik enabled');
   await page.screenshot({path:path.join(root,module+'-selection-filtered.png')});
   results.push(result);fs.writeFileSync(output,JSON.stringify(results,null,2));console.log(JSON.stringify(result));await page.screenshot({path:path.join(root,module+'-selection-complete.png')});await context.close();
  }
  fs.writeFileSync(output,JSON.stringify(results,null,2));
 }finally{if(browser)await browser.close();await stop();}
})().catch(error=>{console.error(error);process.exitCode=1;});
