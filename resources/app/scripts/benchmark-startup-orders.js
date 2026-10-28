'use strict';

// Reproducible, local-only startup measurement with synthetic Excel sources.
// Requires Playwright; CHROMIUM_PATH can select a system Chromium executable.
// node scripts/benchmark-startup-orders.js --rows 30000 --out /tmp/startup.json
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),net=require('node:net');
const {spawn,spawnSync}=require('node:child_process');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const APP=path.resolve(__dirname,'..');
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
// One renderer, as in the desktop app: Overview opens, authorized modules warm in
// the background, then each module switch is timed until its first data row is drawn.
async function measureSameTab(context){
  const {page,measurement}=await open(context,'overview');
  await page.waitForFunction(()=>window.BLPerf?.timeline?.().some(mark=>mark.name==='BACKGROUND_WARMUP_DONE'),null,{timeout:600000});
  const warmup=await page.evaluate(()=>window.BLPerf.timeline().filter(mark=>/^BACKGROUND_WARMUP_/.test(mark.name)));
  const switches=[];
  for(const [module,selector] of [['cp','#cpTable tbody tr[data-id]'],['orders','#ordersTable tbody tr[data-id]'],['koleksiyon','#view-koleksiyon']]){
    // Timed inside the page: Playwright's rAF polling adds seconds under load.
    const ms=await page.evaluate(([module,selector])=>new Promise((resolve,reject)=>{
      const started=performance.now();switchTab(module);
      const tick=()=>{
        if(document.querySelector(selector))return requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(performance.now()-started)));
        if(performance.now()-started>180000)return reject(new Error(module+' switch timed out'));
        setTimeout(tick,20);
      };tick();
    }),[module,selector]);
    switches.push({module,ms});console.log('same-tab switch '+module+': '+Math.round(ms)+' ms');
    await page.screenshot({path:path.join(root,'same-tab-'+module+'.png')});
  }
  await page.close();
  return {overviewReadyMs:measurement.elapsedMs,warmup,switches,rendererRssBytes:await rendererRss()};
}
(async()=>{
  try{
    const socket=net.createServer();await new Promise(resolve=>socket.listen(0,'127.0.0.1',resolve));port=socket.address().port;await new Promise(resolve=>socket.close(resolve));base='http://127.0.0.1:'+port;
    const source=path.join(root,'source');fs.mkdirSync(source,{recursive:true});
    if(!fs.existsSync(path.join(source,'ASAS - Demo.xlsx'))){
      const generated=spawnSync(process.execPath,[path.join(__dirname,'generate-demo-data.js'),source,'--rows',String(count)],{cwd:APP,encoding:'utf8'});
      if(generated.status!==0)throw new Error(generated.stderr||'Demo generation failed');
    }
    fs.writeFileSync(env.BUYER_LOG_CONFIG_PATH,JSON.stringify({port,sourceFolder:source}));
    await start();await login();
    if(!process.argv.includes('--skip-refresh')){
    await api('/api/refresh',{method:'POST',body:'{}'});
    let refreshed=false;
    for(let i=0;i<900;i++){const status=await api('/api/refresh-status');if(!status.running){if(status.error)throw new Error(JSON.stringify(status.error));refreshed=true;break;}await delay(500);}
    if(!refreshed)throw new Error('Synthetic refresh timed out');
    }
    await stop();const backendStartupMs=await start();await login();
    browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||undefined,args:['--no-sandbox',...(process.env.STARTUP_DEBUG_PORT?['--remote-debugging-port='+process.env.STARTUP_DEBUG_PORT]:[])]});
    const context=await browser.newContext({viewport:{width:1600,height:1000}});
    const split=cookie.indexOf('=');await context.addCookies([{name:cookie.slice(0,split),value:cookie.slice(split+1),url:base,httpOnly:true}]);
    const sameTab=process.argv.includes('--skip-same-tab')?null:await measureSameTab(context);
    const measurements=[],pages=[];
    for(const module of requestedModules){
      const result=await open(context,module);pages.push(result.page);measurements.push(result.measurement);
      fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output+'.partial',JSON.stringify({backendStartupMs,measurements},null,2)+'\n');
      console.log(module+': '+Math.round(result.measurement.elapsedMs)+' ms, '+result.measurement.rows+' rows');
      await result.page.evaluate(()=>document.querySelectorAll('dialog[open]').forEach(dialog=>dialog.close()));
      await result.page.screenshot({path:path.join(root,module+'.png')});
    }
    const orders=measurements.find(item=>item.module==='orders');
    if(orders&&orders.rows!==count)throw new Error('Expected '+count+' Orders rows, received '+orders.rows);
    let retained=null;
    if(orders){
      await pages.at(-1).evaluate(()=>{window.__retainedOrders=state.orders.rows;});
      await pages[0].bringToFront();await pages.at(-1).bringToFront();
      retained=await pages.at(-1).evaluate(()=>state.orders.rows===window.__retainedOrders);
    }
    const browserVersion=browser.version();await browser.close();browser=null;
    const report={synthetic:true,platform:process.platform,chromium:browserVersion,cpu:os.cpus()[0]?.model,cpuCount:os.cpus().length,totalMemoryBytes:os.totalmem(),
      requestedRows:count,requestedModules,backendStartupMs,measurements,allTabsRetained:retained,sameTab,
      limitations:['Chromium page measurements; native Electron shell and Windows cold disk/antivirus are not included.','Backend process restarted; OS filesystem cache is not purged.','Collection workspace is empty demo data.','RSS sums include shared renderer pages and are not unique physical memory.']};
    fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');console.log('Report: '+output+'; demo screenshots: '+root);
  }finally{if(browser)await browser.close();await stop();}
})().catch(error=>{console.error(error);process.exitCode=1;});
