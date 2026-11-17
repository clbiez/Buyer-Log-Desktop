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
  page.on('pageerror',error=>errors.push(error.message));page.on('console',msg=>{if(msg.text().startsWith('single measured'))console.log(msg.text());});
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
const {execFileSync}=require('node:child_process');
const REPO=path.resolve(APP,'../..');
const baselineRef=execFileSync('git',['rev-parse',arg('--baseline','origin/main')],{cwd:REPO,encoding:'utf8'}).trim();
const files=['app-main.js','selection-action-bar.js','grid-range-select.js'];
const baseline=Object.fromEntries(files.map(file=>[file,execFileSync('git',['show',baselineRef+':resources/app/public/'+file],{cwd:REPO,encoding:'utf8',maxBuffer:8*1024*1024})]));
async function prepare(page,module){
 await page.evaluate(async module=>{
  const tableId=module==='orders'?'ordersTable':'cpTable';
  const wait=()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
  state[module+'Selected'].clear();state.checkFilter[module]='';state.colFilters[module]={};const search=document.getElementById(module==='orders'?'ordersSearch':'cpSearch');if(search)search.value='';state[module+'Sort']={key:'Priority',dir:1};
  // Exercise a 200-row range in the current page; full scope remains 30k.
  const range=_tableRangeViews.get(document.getElementById(tableId));range.controller.setSize(200);
  window.__selectionModule=module;
  window.__selectionRender=()=>module==='orders'?renderOrdersNow():renderCPNow();
  window.__selectionRender();await wait();
  window.__selectionCalls={filtered:0,sorted:0,footer:0,shipping:0};
  for(const [name,metric] of [['filteredOrders','filtered'],['filteredCP','filtered'],['sortRows','sorted'],['updateSelectionFooterCount','footer'],['updateShippingBtnVisibility','shipping']]){
   const original=window[name];window[name]=function(...args){window.__selectionCalls[metric]++;return original.apply(this,args);};
  }
 },module);
}
async function scenario(page,module){
 const tableId=module==='orders'?'ordersTable':'cpTable';
 return await page.evaluate(async tableId=>{
  const wait=()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
  const selected=state[window.__selectionModule+'Selected'];
  const reset=async()=>{selected.clear();window.__selectionRender();await wait();for(const key in window.__selectionCalls)window.__selectionCalls[key]=0;};
  const boxes=()=>[...document.querySelectorAll('#'+tableId+' input.rowChk')];
  await reset();let start=performance.now();performance.mark('__selection_single_start');boxes()[0].click();await wait();performance.mark('__selection_single_end');
  const single={ms:performance.now()-start,calls:{...window.__selectionCalls},count:selected.size};console.log('single measured',JSON.stringify(single));
  await reset();boxes()[0].click();await wait();
  for(const key in window.__selectionCalls)window.__selectionCalls[key]=0;
  const target=boxes()[199];if(!target)throw new Error('Expected 200 visible row boxes');
  start=performance.now();
  performance.mark('__selection_range_start');target.dispatchEvent(new MouseEvent('click',{bubbles:true,shiftKey:true}));await wait();performance.mark('__selection_range_end');
  const range={ms:performance.now()-start,calls:{...window.__selectionCalls},count:selected.size};
  await new Promise(resolve=>setTimeout(resolve,1500));
  for(const key in window.__selectionCalls)window.__selectionCalls[key]=0;
  const tasks=[];const observer=new PerformanceObserver(list=>tasks.push(...list.getEntries().map(e=>e.duration)));observer.observe({type:'longtask'});
  const idleMetricsBefore=await window.__selectionMetrics();
  const idleStart=performance.now();
  await new Promise(resolve=>setTimeout(resolve,10000));observer.disconnect();
  const idleMetricsAfter=await window.__selectionMetrics();
  const idle={taskDurationSeconds:idleMetricsAfter.TaskDuration-idleMetricsBefore.TaskDuration,ms:performance.now()-idleStart,calls:{...window.__selectionCalls},longTasks:tasks,totalLongTaskMs:tasks.reduce((a,b)=>a+b,0)};
  return {single,range,idle,domRows:boxes().length,scopeRows:document.getElementById(tableId).tBodies[0]._chkMeta.rows.length,rows:state[window.__selectionModule].rows.length};
 },tableId);
}
(async()=>{
 try{
  const socket=net.createServer();await new Promise(resolve=>socket.listen(0,'127.0.0.1',resolve));port=socket.address().port;await new Promise(resolve=>socket.close(resolve));base='http://127.0.0.1:'+port;
  const source=path.join(root,'source');fs.mkdirSync(source,{recursive:true});
  if(!fs.existsSync(path.join(source,'ASAS - Demo.xlsx'))){
   const generated=spawnSync(process.execPath,[path.join(APP,'scripts/generate-demo-data.js'),source,'--rows',String(count)],{cwd:APP,encoding:'utf8'});
   if(generated.status!==0)throw new Error(generated.stderr||'Demo generation failed');
  }
  fs.writeFileSync(env.BUYER_LOG_CONFIG_PATH,JSON.stringify({port,sourceFolder:source}));await start();await login();
  if(!process.argv.includes('--skip-refresh')){
   await api('/api/refresh',{method:'POST',body:'{}'});
   let ready=false;for(let i=0;i<900;i++){const status=await api('/api/refresh-status');if(!status.running){if(status.error)throw new Error(JSON.stringify(status.error));ready=true;break;}await delay(500);}if(!ready)throw new Error('Refresh timed out');
  }
  browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});
  const samples=[];const crypto=require('node:crypto');const metadata={baselineRef,root,runtime:browser.version(),platform:process.platform,cpu:os.cpus()[0].model,cpuCount:os.cpus().length,sourceCommit:execFileSync('git',['rev-parse','HEAD'],{cwd:REPO,encoding:'utf8'}).trim(),sort:'Priority',settled:process.argv.includes('--settled'),fixtureSha256:crypto.createHash('sha256').update(fs.readFileSync(path.join(root,'source','ASAS - Demo.xlsx'))).digest('hex'),sourceSha256:Object.fromEntries(files.map(file=>[file,crypto.createHash('sha256').update(fs.readFileSync(path.join(APP,'public',file))).digest('hex')]))};
  for(let pair=0;pair<3;pair++)for(const variant of pair%2?['main','candidate']:['candidate','main'])for(const module of ['orders','cp']){
   const context=await browser.newContext({viewport:{width:1600,height:1000}});
   if(variant==='main')await context.route(/\/(app-main|selection-action-bar|grid-range-select)\.js(?:\?|$)/,route=>route.fulfill({status:200,contentType:'application/javascript',body:baseline[new URL(route.request().url()).pathname.split('/').pop()]}));
   const split=cookie.indexOf('=');await context.addCookies([{name:cookie.slice(0,split),value:cookie.slice(split+1),url:base,httpOnly:true}]);
   console.log('opening',pair,variant,module);const {page}=await open(context,module);if(process.argv.includes('--settled')){await page.waitForFunction(()=>window.BLPerf?.timeline?.().some(mark=>mark.name==='BACKGROUND_WARMUP_DONE'),null,{timeout:600000});await delay(2000);}await page.evaluate(()=>{(window.BLStorage||localStorage).setItem('bl.releaseNotes.lastSeenStable.v1','7.0.359');document.querySelectorAll('dialog[open]').forEach(dialog=>dialog.close());});await prepare(page,module);await page.evaluate(module=>{if(document.querySelector('dialog[open]'))throw new Error('Unexpected modal obscures measurement');const box=document.querySelector((module==='orders'?'#ordersTable':'#cpTable')+' input.rowChk'),rect=box.getBoundingClientRect();if(document.elementFromPoint(rect.x+rect.width/2,rect.y+rect.height/2)!==box)throw new Error('Checkbox is not directly hittable');},module);if(pair===0)await page.screenshot({path:path.join(root,variant+'-'+module+'-unobscured.png')});const cdp=await context.newCDPSession(page);await cdp.send('Performance.enable');const before=await cdp.send('Performance.getMetrics');await page.exposeFunction('__selectionMetrics',async()=>Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(m=>[m.name,m.value])));console.log('scenario start',pair,variant,module);const tracingDone=new Promise(resolve=>cdp.once('Tracing.tracingComplete',resolve));await cdp.send('Tracing.start',{categories:'devtools.timeline,blink.user_timing',transferMode:'ReturnAsStream'});const result=await scenario(page,module);await cdp.send('Tracing.end');const {stream}=await tracingDone;let traceText='';for(;;){const chunk=await cdp.send('IO.read',{handle:stream});traceText+=chunk.base64Encoded?Buffer.from(chunk.data,'base64').toString():chunk.data;if(chunk.eof)break;}await cdp.send('IO.close',{handle:stream});const events=JSON.parse(traceText).traceEvents;result.paint={};for(const phase of ['single','range']){const start=events.find(e=>e.name==='__selection_'+phase+'_start'),end=events.find(e=>e.name==='__selection_'+phase+'_end');const paints=start&&end?events.filter(e=>e.name==='Paint'&&e.pid===start.pid&&e.ts>=start.ts&&e.ts<=end.ts):[];const first=paints[0];result.paint[phase]={firstPaintMs:first?(first.ts+(first.dur||0)-start.ts)/1000:null,marks:{start,end},paints:paints.map(e=>({ts:e.ts,dur:e.dur,pid:e.pid,tid:e.tid}))};}result.paint.range.timeline={};const mark=result.paint.range.marks;for(const e of events){if(e.ph!=='X'||!mark.start||!mark.end||e.pid!==mark.start.pid||e.tid!==mark.start.tid||e.ts<mark.start.ts||e.ts>mark.end.ts)continue;const metric=result.paint.range.timeline[e.name]||(result.paint.range.timeline[e.name]={count:0,totalMs:0,maxMs:0});metric.count++;metric.totalMs+=(e.dur||0)/1000;metric.maxMs=Math.max(metric.maxMs,(e.dur||0)/1000);}const after=await cdp.send('Performance.getMetrics');result.taskDurationSeconds=after.metrics.find(x=>x.name==='TaskDuration').value-before.metrics.find(x=>x.name==='TaskDuration').value;await cdp.send('HeapProfiler.collectGarbage');result.retainedHeapBytes=(await cdp.send('Performance.getMetrics')).metrics.find(x=>x.name==='JSHeapUsedSize').value;result.loaded=await page.evaluate(()=>({orders:state.orders?.rows.length,cp:state.cp?.rows.length,warmupDone:window.BLPerf?.timeline?.().some(mark=>mark.name==='BACKGROUND_WARMUP_DONE')}));
   await page.evaluate(module=>{state.checkFilter[module]='unchecked';window.__selectionRender();},module);result.unchecked=await scenario(page,module);await cdp.send('HeapProfiler.collectGarbage');result.unchecked.retainedHeapBytes=(await cdp.send('Performance.getMetrics')).metrics.find(x=>x.name==='JSHeapUsedSize').value;result.unchecked.parity=await page.evaluate(module=>{const full=window.BLManagedSelection.snapshot(module),cheap=window.BLManagedSelection.summary?.(module);return {hidden:cheap?cheap.hidden:full.hidden.length,snapshotHidden:full.hidden.length,footer:Number(document.querySelector((module==='orders'?'#ordersTable':'#cpTable')+' .selectionFooterNumber')?.textContent),endeksmatikDisabled:document.getElementById(module+'EndeksmatikBtn').disabled};},module);result.renderCycles=[];for(let cycle=0;cycle<5;cycle++){const started=performance.now();await page.evaluate(()=>{window.__selectionRender();return new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));});const beforeGc=await cdp.send('Performance.getMetrics');await cdp.send('HeapProfiler.collectGarbage');const afterGc=await cdp.send('Performance.getMetrics');result.renderCycles.push({ms:performance.now()-started,heapBeforeGc:beforeGc.metrics.find(x=>x.name==='JSHeapUsedSize').value,retainedHeapBytes:afterGc.metrics.find(x=>x.name==='JSHeapUsedSize').value});}samples.push({pair,variant,module,...result});console.log(JSON.stringify({pair,variant,module,singleMs:result.single.ms,rangeMs:result.range.ms,paint:Object.fromEntries(Object.entries(result.paint).map(([key,value])=>[key,value.firstPaintMs])),idle:result.idle.calls,unchecked:result.unchecked.parity}));fs.writeFileSync(output,JSON.stringify({...metadata,samples},null,2));await context.close();
  }
 }finally{if(browser)await browser.close();await stop();}
})().catch(error=>{console.error(error);process.exitCode=1;});
