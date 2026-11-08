'use strict';
// Prepared, not executed. Baseline cost/contract probe against pinned Buyer Log.
// No mock image endpoint, fake decoder, DOM replacement table, or optimization.
const fs = require('node:fs'), path = require('node:path'), net = require('node:net');
const crypto = require('node:crypto'), zlib = require('node:zlib'), assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const ROOT = __dirname;
const arg = name => { const i = process.argv.indexOf(name); assert(i >= 0, name); return process.argv[i+1]; };
const { chromium } = require(path.resolve(arg('--playwright-module')));
const WORK=path.resolve(arg('--work-root')), MODULE=arg('--module');
assert(['cp','orders'].includes(MODULE));
const app = path.resolve(arg('--app-root')), run = path.resolve(arg('--run-root')), scenario = arg('--scenario');
const STAGE=path.resolve(arg('--stage-root'));
assert(run.startsWith(path.join(WORK, 'runs') + path.sep));
assert(['control', 'originals'].includes(scenario));
const fixture = path.join(run, 'fixture');
fs.mkdirSync(path.join(run,'tmp'),{recursive:true});
// Unix-domain sockets have a 108-byte path limit. This short /proc alias
// still resolves to this run's private directory; no external temp root.
const tempFd=fs.openSync(path.join(run,'tmp'),'r');
process.env.TMPDIR='/proc/'+process.pid+'/fd/'+tempFd;
const fixtureManifest=JSON.parse(fs.readFileSync(path.join(STAGE,'fixture-manifest.json')));
const images = fixtureManifest.images;
const pins = JSON.parse(fs.readFileSync(path.join(STAGE, 'source-pins.json')));
assert.equal(app,fixtureManifest.appRoot);assert.equal(fixtureManifest.revision,pins.revision);assert.equal(fixtureManifest.appTree,pins.appTree);
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const report = { schemaVersion:1, synthetic:true, measurementModule:MODULE, scope:'Main179 diagnostic; not post908 acceptance', scenario, revision:pins.revision, status:'running',
  node:process.version,probeSha256:sha(fs.readFileSync(__filename)),fixtureManifestSha256:sha(fs.readFileSync(path.join(STAGE,'fixture-manifest.json'))),
  appTree:pins.appTree,stageRoot:STAGE,
  startedAt:new Date().toISOString(), sourcePins:pins, phases:[], network:[], functional:{}, limitations:[
    'Prepared probe: first smoke and runtime validation remain required.',
    'Synthetic size/codec strata do not establish the production image distribution.',
    'Linux headless Chromium; Windows/Electron, GPU drivers, AV, cold OS disk and real workstation behavior are unmeasured.',
    'RGBA pixel estimates, JS heap and renderer RSS are not decoded-image-memory measurements.',
    'Tracing allocator candidates require attribution; absent/ambiguous image allocators leave that acceptance item open.',
    'Tracing and small observers add overhead; all paired cases use the same instrumentation.',
    'Placeholder and original cells can have different row geometry; scroll deltas alone do not isolate decode cost.',
    'First image can load behind the startup curtain; navigation, load and post-Continue visibility are reported separately.',
    'No preview optimization or 96/192/384 quality verdict is implemented by this baseline probe.'
  ] };
const persist = () => fs.writeFileSync(path.join(run, 'result.json'), JSON.stringify(report, null, 2)+'\n');
let server, browser, context, page, cdp, browserCdp, cookie='', base='', traceActive=false, mappings=[],serverStartTicks=null;
async function api(url, options={}) {
  const response = await fetch(base+url, { ...options, signal:AbortSignal.timeout(60000),
    headers:{cookie, 'Content-Type':'application/json', ...options.headers} });
  assert(response.ok, url+': '+response.status);
  return response;
}
async function launch() {
  browser = await chromium.launch({headless:true, executablePath:path.resolve(arg('--chromium')), args:['--no-sandbox']});
  report.chromium = browser.version();
  context = await browser.newContext({viewport:{width:1600,height:1000}, deviceScaleFactor:1});
  await context.route('**/*', route => {
    const u = new URL(route.request().url());
    return ['data:','blob:','about:'].includes(u.protocol) || u.origin === base ? route.continue() : route.abort('blockedbyclient');
  });
  const split=cookie.indexOf('=');
  await context.addCookies([{name:cookie.slice(0,split), value:cookie.slice(split+1), url:base, httpOnly:true}]);
  await context.addInitScript(() => localStorage.setItem('bl.releaseNotes.lastSeenStable.v1','99.0.0'));
  page = await context.newPage();
  page.on('dialog', dialog=>dialog.dismiss());
  page.on('pageerror', error=>{ (report.pageErrors??=[]).push(error.message); });
}
async function openCp(target='cp') {
  await page.goto(base+'/?module='+target, {waitUntil:'domcontentloaded', timeout:120000});
  await page.waitForFunction(target=>document.querySelector('[data-boot-continue]') ||
    (!document.getElementById('blBootGuard') && document.querySelector('#'+target+'Table tbody tr[data-id]')), target, {timeout:180000});
  report.continueIntentAtMs = await page.evaluate(()=>performance.now());
  if (await page.locator('[data-boot-continue]').count()) await page.click('[data-boot-continue]');
  await page.waitForFunction(target=>!document.getElementById('blBootGuard') && state[target]?.rows.length>0 &&
    document.querySelector('#'+target+'Table tbody tr[data-id]'), target, {timeout:180000});
}
async function memory(phase) {
  const {metrics} = await cdp.send('Performance.getMetrics');
  const {processInfo} = await browserCdp.send('SystemInfo.getProcessInfo');
  const processes = processInfo.filter(p=>['renderer','GPU','gpu','browser'].includes(p.type)).map(p=>{
    let rssBytes=null;
    try { const m=fs.readFileSync('/proc/'+p.id+'/status','utf8').match(/^VmRSS:\s+(\d+)/m); if(m)rssBytes=Number(m[1])*1024; } catch {}
    return {pid:p.id,type:p.type,rssBytes};
  });
  await page.evaluate(phase=>performance.mark('int08-memory-'+phase),phase);
  const heapUsage=await cdp.send('Runtime.getHeapUsage');
  const snapshot={phase,at:new Date().toISOString(),processes,heapUsage,
    jsHeapUsedBytes:metrics.find(m=>m.name==='JSHeapUsedSize')?.value,
    jsHeapTotalBytes:metrics.find(m=>m.name==='JSHeapTotalSize')?.value,
    app:await page.evaluate(()=>({cache:window.BLModelImageCache?.stats?.(),runtime:window.BLImageRuntime?.stats?.()}))};
  try { snapshot.memoryDump=await browserCdp.send('Tracing.requestMemoryDump',{deterministic:false,levelOfDetail:'detailed'}); }
  catch(error){snapshot.memoryDump={unavailable:error.message};}
  report.phases.push(snapshot); persist();
}
async function scroll(label) {
  const result=await page.evaluate(async ({label,originalUrls,module})=>{
    const wrap=document.getElementById(module+'TableWrap'); if(!wrap)throw Error('Actual CP scroller missing');
    wrap.scrollTop=0;
    const frames=[],coverage=[],sources=new Set(); let last=performance.now();
    performance.mark('int08-'+module+'-'+label+'-start');
    const start=last, range=Math.min(2200,Math.max(0,wrap.scrollHeight-wrap.clientHeight));
    for(let i=0;i<180;i++) await new Promise(resolve=>requestAnimationFrame(now=>{
      frames.push(now-last);last=now;
      const progress=i/179;wrap.scrollTop=Math.round((progress<.5?progress*2:2-progress*2)*range);
      if(i%15===0){let visible=0;const box=wrap.getBoundingClientRect();
        for(const img of wrap.querySelectorAll('img[data-src]')){const r=img.getBoundingClientRect();
          if(r.bottom>box.top&&r.top<box.bottom&&img.complete&&img.naturalWidth&&originalUrls.includes(img.dataset.src)&&img.currentSrc===new URL(img.dataset.src,location.href).href){visible++;sources.add(img.dataset.src);}}
        coverage.push({frame:i,scrollTop:wrap.scrollTop,visibleOriginals:visible});}
      resolve();
    }));
    const sorted=frames.slice(1).sort((a,b)=>a-b),q=p=>sorted[Math.max(0,Math.ceil(p*sorted.length)-1)];
    performance.mark('int08-'+module+'-'+label+'-end');
    const end=performance.now(),tasks=(window.__int08?.longTasks||[]).map(t=>({...t,overlapMs:Math.max(0,Math.min(end,t.startTime+t.duration)-Math.max(start,t.startTime))})).filter(t=>t.overlapMs>0);
    return {label,startMs:start,endMs:end,longTasks:tasks,longTaskOverlapMs:tasks.reduce((n,t)=>n+t.overlapMs,0),wallMs:end-start,rangePx:range,framesMs:frames,p50Ms:q(.5),p95Ms:q(.95),maxMs:Math.max(...sorted),
      over16_7Ms:sorted.filter(n=>n>16.7).length,over33_3Ms:sorted.filter(n=>n>33.3).length,coverage,uniqueOriginalsVisible:sources.size};
  },{label,originalUrls:mappings.map(m=>m.url),module:MODULE});
  report.scroll??=[];report.scroll.push(result);persist();
}
async function finishTrace() {
  if(!traceActive)return;
  const completed=new Promise(resolve=>browserCdp.once('Tracing.tracingComplete',resolve));
  await browserCdp.send('Tracing.end');
  const {stream}=await completed;
  const file=path.join(run,'chromium-trace.json'),fd=fs.openSync(file,'w');
  try { while(true){const chunk=await browserCdp.send('IO.read',{handle:stream});
    fs.writeSync(fd,chunk.base64Encoded?Buffer.from(chunk.data,'base64'):Buffer.from(chunk.data));if(chunk.eof)break;}
  } finally {fs.closeSync(fd);await browserCdp.send('IO.close',{handle:stream});traceActive=false;}
  const trace=JSON.parse(fs.readFileSync(file,'utf8')),events=trace.traceEvents||[];
  const decodes=events.filter(e=>e.ph==='X'&&e.name==='Decode Image');
  const allocators=[];
  for(const event of events){const a=event.args?.dumps?.allocators;if(!a)continue;
    for(const [name,value] of Object.entries(a))if(['cc/image_memory','discardable','web_cache/Image_resources','v8/main/heap/external','gpu/shared_images'].includes(name))
      allocators.push({pid:event.pid,ts:event.ts,name,attrs:value.attrs});}
  report.trace={file,sha256:sha(fs.readFileSync(file)),decodeCompleteEventCount:decodes.length,
    decodeElapsedThreadSumMs:decodes.reduce((n,e)=>n+(Number(e.dur)||0),0)/1000,
    decodeCpuMs:decodes.length&&decodes.every(e=>Number.isFinite(e.tdur))?decodes.reduce((n,e)=>n+e.tdur,0)/1000:null,
    decodeEventsWithThreadCpu:decodes.filter(e=>Number.isFinite(e.tdur)).length,
    decodeNames:[...new Set(decodes.map(e=>e.name))],decodeScope:'Complete X events only; dur is elapsed duration summed across threads, tdur is thread CPU when supplied; neither is UI latency.',
    decodedImageMemory:{status:allocators.length?'allocator-candidates-require-attribution':'unavailable',allocatorCandidates:allocators}};
  // Compression is the dispatcher's post-exit task. Keep the full raw trace
  // until the application server and browser have exited and the gzip is
  // written, hashed and independently decompressed/verified.
}
function installObservers() {
  const p=window.__int08={imageLoads:[],decodeCalls:[],longTasks:[]};
  const observeVisible=()=>requestAnimationFrame(()=>requestAnimationFrame(()=>{
    if(p.firstVisibleOriginal||document.getElementById('blBootGuard'))return;
    for(const img of document.querySelectorAll('table img[data-src]')){const r=img.getBoundingClientRect();
      if(img.complete&&img.naturalWidth&&/\/api\/(?:cp|collection)-images\//.test(img.currentSrc)&&r.width>0&&r.height>0&&r.bottom>0&&r.top<innerHeight&&r.right>0&&r.left<innerWidth){
        p.firstVisibleOriginal={atMs:performance.now(),source:img.dataset.src,width:img.naturalWidth,height:img.naturalHeight,table:img.closest('table')?.id,curtainAbsent:true,viewportIntersection:true};break;}
    }
  }));
  window.addEventListener('bl:startup-complete',observeVisible);
  document.addEventListener('load',observeVisible,true);
  try{new PerformanceObserver(list=>{for(const e of list.getEntries())p.longTasks.push({startTime:e.startTime,duration:e.duration});}).observe({type:'longtask',buffered:true});}catch{}
  document.addEventListener('load',event=>{const img=event.target;
    if(img instanceof HTMLImageElement && /\/api\/(?:cp|collection)-images\//.test(img.currentSrc||img.src))
      p.imageLoads.push({at:performance.now(),source:img.dataset.src||img.currentSrc,width:img.naturalWidth,height:img.naturalHeight,
        table:img.closest('table')?.id||null,behindCurtain:Boolean(document.getElementById('blBootGuard'))});},true);
  if(HTMLImageElement.prototype.decode){const original=HTMLImageElement.prototype.decode;
    HTMLImageElement.prototype.decode=function(...args){const start=performance.now(),source=this.currentSrc||this.src;
      return original.apply(this,args).then(value=>{p.decodeCalls.push({source,startMs:start,elapsedMs:performance.now()-start,ok:true});return value;},error=>{
        p.decodeCalls.push({source,startMs:start,elapsedMs:performance.now()-start,ok:false});throw error;});};}
}
(async()=>{
  for(const [name,pin] of Object.entries({...pins.files,...pins.preservedCpGuards}))assert.equal(sha(fs.readFileSync(path.join(app,name))),pin.sha256,'source pin '+name);
  const admission=JSON.parse(fs.readFileSync(path.join(run,'app-start-admission.json')));
  assert.equal(admission.stageFixtureManifestSha256,report.fixtureManifestSha256);
  assert.equal(admission.sufficient,true,'An admitted serial dispatcher launch is required');
  const cacheManifest=JSON.parse(fs.readFileSync(path.join(fixture,'local/page-cache/moderator/manifest.json')));
  report.inputCache={generation:cacheManifest.activeGeneration,sourceRevisionKey:cacheManifest.sourceRevisionKey,modules:{}};
  for(const module of ['cp','orders']){const bytes=fs.readFileSync(path.join(fixture,'local/page-cache/moderator',cacheManifest.activeGeneration,module+'.json.gz'));
    assert.equal(sha(bytes),cacheManifest.modules[module].checksum,module+' cache checksum');
    report.inputCache.modules[module]=JSON.parse(zlib.gunzipSync(bytes)).rows.length;}
  assert.equal(report.inputCache.modules.orders,30000);
  assert.equal(report.inputCache.modules.cp,24982);
  const socket=net.createServer();await new Promise(resolve=>socket.listen(0,'127.0.0.1',resolve));
  const port=socket.address().port;await new Promise(resolve=>socket.close(resolve));base='http://127.0.0.1:'+port;
  // Do not forward service credentials or external app-data locations to the
  // synthetic app. Its normal image/auth/cache paths all stay inside this copy.
  const safeInherited=Object.fromEntries(['PATH','LANG','LC_ALL','TZ'].filter(key=>process.env[key]!==undefined).map(key=>[key,process.env[key]]));
  const env={...safeInherited,TMPDIR:path.join(fixture,'tmp'),TMP:path.join(fixture,'tmp'),TEMP:path.join(fixture,'tmp'),
    BUYER_LOG_CENTRAL_IAM_ENABLED:'0',BUYER_LOG_SERVER_DATA_ROOT:path.join(fixture,'data'),
    BUYER_LOG_AUTH_DATA_ROOT:path.join(fixture,'data'),BUYER_LOG_DATA_ROOT:path.join(fixture,'app'),
    BUYER_LOG_LOCAL_DATA_ROOT:path.join(fixture,'local'),BUYER_LOG_LOCAL_DB:path.join(fixture,'local/BuyerLogLocal.db'),
    BUYER_LOG_PORTABLE_DATA_ROOT:path.join(fixture,'portable'),APPDATA:path.join(fixture,'appdata'),LOCALAPPDATA:path.join(fixture,'localappdata'),
    BL_HOST_APPDATA:'',BL_HOST_LOCALAPPDATA:'',
    BUYER_LOG_CONFIG_PATH:path.join(fixture,'config.json'),BUYER_LOG_TEMP_ROOT:path.join(fixture,'tmp'),
    BUYER_LOG_IAM_SHARED_ROOT:path.join(fixture,'iam-disabled'),INT08_GUARD_LOG:path.join(run,'network-guard.log')};
  env.INT08_SOURCE_READONLY_ROOTS=JSON.stringify([path.join(fixture,'source'),path.join(fixtureManifest.sourceCacheRoot,'source')]);
  env.NODE_OPTIONS='--require='+path.join(ROOT,'local-only.cjs');
  for(const name of ['tmp','iam-disabled','shared-disabled','portable','appdata','localappdata'])fs.mkdirSync(path.join(fixture,name),{recursive:true});
  fs.writeFileSync(env.BUYER_LOG_CONFIG_PATH,JSON.stringify({port,host:'127.0.0.1',sourceFolder:path.join(fixtureManifest.sourceCacheRoot,'source'),updates:{enabled:false}}));
  const log=fs.openSync(path.join(run,'server.log'),'a');
  const disk=fs.statfsSync(run),free=Number(disk.bavail)*Number(disk.bsize);
  assert(free>=admission.appStartRequiredFreeBytes,'Available disk changed after admission; abort before server start');
  server=spawn(process.execPath,[path.join(app,'server/server.js')],{cwd:app,env,stdio:['ignore',log,log]});fs.closeSync(log);
  try{serverStartTicks=fs.readFileSync('/proc/'+server.pid+'/stat','utf8').split(') ')[1].split(' ')[19];}catch{}
  fs.writeFileSync(path.join(run,'process-lifecycle.json'),JSON.stringify({probePid:process.pid,serverPid:server.pid,serverStartTicks,serverExitConfirmed:false}));
  let spawnError;server.on('error',error=>{spawnError=error;});
  for(let i=0;i<120;i++){if(spawnError)throw spawnError;assert.equal(server.exitCode,null,'server exited');
    try{await api('/api/status');break;}catch(error){if(i===119)throw error;await delay(250);}}
  const login=await api('/api/user-login',{method:'POST',body:JSON.stringify({userId:'moderator',password:'synthetic-startup-only-123',newPassword:'synthetic-startup-only-123'})});
  cookie=String(login.headers.get('set-cookie')||'').split(';')[0];assert(cookie.includes('='));
  const initial=await (await api('/api/data?mode=initial')).json();
  report.inputRevisions={orders:Number(initial.storeRevisions.orders)||0,suppFob:Number(initial.storeRevisions.suppFob)||0};
  report.initialDataAudit={sourceFolder:initial.sourceFolder,userScope:{id:initial.currentUser.id,scopes:initial.currentUser.scopes},sourceFilterStatus:initial.sourceFilterStatus,pageCache:initial.pageCache};
  // Main179 deliberately omits generation from mode=initial; validate the
  // actual projection response generation below, as the Faz0 harness does.
  assert.equal(initial.sourceFolder,path.join(fixtureManifest.sourceCacheRoot,'source'));
  if(scenario==='originals'){
    await launch();await openCp('cp');
    if(MODULE==='orders'){await page.evaluate(()=>switchTab('orders'));await page.waitForFunction(()=>state.orders?.rows.length>0&&document.querySelector('#ordersTable tbody tr[data-id]'),null,{timeout:180000});}
    const rows=await page.evaluate(({count,module})=>{const domIds=[...document.querySelectorAll('#'+module+'Table tbody tr[data-id]')].map(e=>String(e.dataset.id));
      const all=state.cp.rows, visible=domIds.map(id=>state[module].rows.find(r=>String(r._id)===id)).filter(Boolean).map(r=>all.find(c=>cpImageOverrideKey(c['PLM ID'],c['C.Code'])===cpImageOverrideKey(r['PLM ID'],r['C.Code']))).filter(Boolean),seen=new Set(),out=[];
      for(const row of [...visible,...all]){const key=cpImageOverrideKey(row['PLM ID'],row['C.Code']);
        if(!key||seen.has(key)||row._canEdit===false)continue;seen.add(key);out.push({id:row._id,initiallyRendered:visible.includes(row)});if(out.length===count)break;}return out;},{count:images.length,module:MODULE});
    assert.equal(rows.length,images.length,'32 valid editable canonical image identities required');
    for(let i=0;i<images.length;i++){
      const image=images[i],raw=fs.readFileSync(path.join(STAGE,'originals',image.file));assert.equal(sha(raw),image.sha256);
      const linked=await page.evaluate(async input=>{const row=state.cp.rows.find(r=>String(r._id)===String(input.rowId));
        const bytes=Uint8Array.from(atob(input.base64),c=>c.charCodeAt(0));
        const payload={rowId:cpImageOverrideKey(row['PLM ID'],row['C.Code']),filename:input.file,mimeType:input.mime,base64:input.base64};
        const payloadBytes=new TextEncoder().encode(JSON.stringify(payload)).length;
        if(payloadBytes>=input.bodyLimit)throw Error('Native upload JSON exceeds its source-pinned parser budget');
        await cpSaveRowImage(row,new File([bytes],input.file,{type:input.mime}));
        if(!row._imageRef)throw Error('Native CP upload did not persist a reference');
        return {rowId:row._id,modelId:row['PLM ID'],colourCode:row['C.Code'],imageRef:row._imageRef,url:tableRowImageSource(row).source,uploadJsonBodyBytes:payloadBytes};
      },{rowId:rows[i].id,base64:raw.toString('base64'),file:image.file,mime:image.mime,bodyLimit:fixtureManifest.uploadLimits.cpEffectiveJsonBytes});
      linked.canonicalKey=await page.evaluate(({modelId,colourCode})=>cpImageOverrideKey(modelId,colourCode),linked);
      mappings.push({...image,...linked,initiallyRendered:rows[i].initiallyRendered});
    }
    await browser.close();browser=null; // discard upload-warmed image/cache/renderer state
    report.functional.apiByteChecks=[];
    for(const mapping of mappings)for(const endpoint of ['cp-images','collection-images']){
      const imagePath='/api/'+endpoint+'/'+encodeURIComponent(mapping.imageRef);
      if(mapping.index===0){const denied=await fetch(base+imagePath,{signal:AbortSignal.timeout(60000)});assert.equal(denied.status,401,'Original endpoint must require a session');(report.functional.unauthenticatedOriginals??=[]).push({endpoint,status:denied.status});}
      const response=await api(imagePath);
      const bytes=Buffer.from(await response.arrayBuffer());assert.equal(sha(bytes),mapping.sha256);assert.equal(bytes.length,mapping.encodedBytes);
      assert.equal(response.headers.get('content-type').split(';')[0],mapping.mime);
      assert.equal(Number(response.headers.get('content-length')),bytes.length);
      assert.match(response.headers.get('cache-control'),/immutable/);assert.equal(response.headers.get('pragma'),null);
      report.functional.apiByteChecks.push({index:mapping.index,endpoint,bytesEqual:true,bytes:bytes.length});
    }
    fs.writeFileSync(path.join(run,'attached-images.json'),JSON.stringify(mappings,null,2)+'\n');
  }
  // Image PATCHes legitimately increment Orders revision (one per identity).
  // Warm both real projections in both arms, then freeze their post-ingest
  // generation/checksums/revisions before a fresh measured Chromium starts.
  for(const module of ['cp','orders']){const response=await api('/api/page-projection/'+module);const value=await response.json();assert.equal(value.rows.length,report.inputCache.modules[module]);}
  const measuredManifest=JSON.parse(fs.readFileSync(path.join(fixture,'local/page-cache/moderator/manifest.json')));
  assert.equal(measuredManifest.sourceRevisionKey,report.inputCache.sourceRevisionKey);
  const postIngest=await (await api('/api/data?mode=initial')).json();
  report.measurementRevisions={orders:Number(postIngest.storeRevisions.orders)||0,suppFob:Number(postIngest.storeRevisions.suppFob)||0};
  assert.equal(report.measurementRevisions.orders,report.inputRevisions.orders+(scenario==='originals'?32:0));
  assert.equal(report.measurementRevisions.suppFob,report.inputRevisions.suppFob);
  report.measurementCache={generation:measuredManifest.activeGeneration,sourceRevisionKey:measuredManifest.sourceRevisionKey,modules:{}};
  for(const module of ['cp','orders']){const file=path.join(fixture,'local/page-cache/moderator',measuredManifest.activeGeneration,module+'.json.gz'),bytes=fs.readFileSync(file);assert.equal(sha(bytes),measuredManifest.modules[module].checksum);const rows=JSON.parse(zlib.gunzipSync(bytes)).rows;assert.equal(rows.length,report.inputCache.modules[module]);report.measurementCache.modules[module]={rows:rows.length,checksum:sha(bytes)};}
  persist();
  await launch();cdp=await context.newCDPSession(page);browserCdp=await browser.newBrowserCDPSession();
  await cdp.send('Performance.enable');await cdp.send('Network.enable');
  report.projectionGenerations=[];
  cdp.on('Network.responseReceived',({response})=>{if(new URL(response.url).pathname.startsWith('/api/page-projection/')&&response.status===200){const entry=Object.entries(response.headers).find(([k])=>k.toLowerCase()==='x-page-cache-generation');report.projectionGenerations.push(entry?.[1]||'');}});
  cdp.on('Network.responseReceived',({requestId,response})=>{if(/\/api\/(?:cp|collection)-images\//.test(response.url))report.network.push({requestId,url:response.url,status:response.status,fromDiskCache:response.fromDiskCache,fromServiceWorker:response.fromServiceWorker,mimeType:response.mimeType});});
  await page.addInitScript(installObservers);
  await page.addInitScript(()=>{const original=Response.prototype.json;Response.prototype.json=async function(...args){const value=await original.apply(this,args);if(new URL(this.url,location.href).pathname==='/api/data'&&value.pageCache)window.__int08.initialGeneration=value.pageCache.generation;return value;};});
  await browserCdp.send('Tracing.start',{transferMode:'ReturnAsStream',traceConfig:{recordMode:'recordContinuously',includedCategories:[
    'devtools.timeline','blink.user_timing','disabled-by-default-devtools.timeline','disabled-by-default-memory-infra','cc','blink','benchmark'],
    memoryDumpConfig:{triggers:[]}}});traceActive=true;
  await memory('blank-before-navigation');await openCp(MODULE);
  report.dataset=await page.evaluate(module=>({generation:window.__int08.initialGeneration,revisions:{orders:Number(state.storeRevisions.orders)||0,suppFob:Number(state.storeRevisions.suppFob)||0},cpRows:state.cp?.rows.length??null,ordersRows:state.orders?.rows.length??null,active:document.body.dataset.activeTab,
    tableGeometry:{scrollHeight:document.getElementById(module+'TableWrap').scrollHeight,clientHeight:document.getElementById(module+'TableWrap').clientHeight,
      firstRowHeights:[...document.querySelectorAll('#'+module+'Table tbody tr[data-id]')].slice(0,40).map(row=>row.getBoundingClientRect().height)}}),MODULE);
  assert(report.projectionGenerations.length>0);for(const generation of report.projectionGenerations)assert.equal(generation,report.measurementCache.generation);assert.deepEqual(report.dataset.revisions,report.measurementRevisions);assert.equal(report.dataset[MODULE==='cp'?'cpRows':'ordersRows'],report.inputCache.modules[MODULE]);assert.equal(report.dataset.active,MODULE);
  if(scenario==='originals'){
    await page.waitForFunction(({urls,module})=>[...document.querySelectorAll('#'+module+'Table img[data-src]')].some(img=>urls.includes(img.dataset.src)&&img.complete&&img.naturalWidth>0&&img.currentSrc===new URL(img.dataset.src,location.href).href),{urls:mappings.map(m=>m.url),module:MODULE},{timeout:60000});
    report.firstVisibleOriginalObservedAtMs=await page.evaluate(module=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>{const box=document.getElementById(module+'TableWrap').getBoundingClientRect();const visible=[...document.querySelectorAll('#'+module+'Table img[data-src]')].filter(i=>{const r=i.getBoundingClientRect();return i.complete&&i.naturalWidth&&r.bottom>box.top&&r.top<box.bottom&&r.right>0&&r.left<innerWidth;});if(document.getElementById('blBootGuard')||!visible.length)throw Error('No visible original after Continue');resolve(performance.now());}))),MODULE);
    report.tableOriginals=await page.evaluate(module=>[...document.querySelectorAll('#'+module+'Table img[data-src]')].filter(img=>img.complete&&img.naturalWidth&&img.dataset.src&&img.currentSrc===new URL(img.dataset.src,location.href).href).map(img=>({source:img.dataset.src,currentSrc:img.currentSrc,width:img.naturalWidth,height:img.naturalHeight,cssWidth:img.getBoundingClientRect().width,cssHeight:img.getBoundingClientRect().height})),MODULE);
    for(const observed of report.tableOriginals){const m=mappings.find(m=>m.url===observed.source);if(m){assert.equal(observed.width,m.width);assert.equal(observed.height,m.height);}}
  }
  await memory('table-first-visible');await scroll('first-scroll');await memory('after-first-scroll');
  await scroll('repeat-scroll');await memory('after-repeat-scroll');
  if(scenario==='originals'){
    assert(report.scroll[0].uniqueOriginalsVisible>=8,'Actual scroll did not expose enough fixture originals; fix fixture placement before measuring');
    await page.evaluate(module=>{document.getElementById(module+'TableWrap').scrollTop=0;},MODULE);
    const thumb=page.locator('#'+MODULE+'Table img[data-has-image="1"][data-src]:visible').first();
    const source=await thumb.getAttribute('data-src');assert(mappings.some(m=>m.url===source));
    const start=performance.now();await thumb.hover();
    await page.waitForFunction(expected=>{const img=document.getElementById('kolImgPopupImg'),pop=document.getElementById('kolImgPopup');return pop?.style.display!=='none'&&img?.dataset.source===expected&&img.complete&&img.naturalWidth>0;},source,{timeout:10000});
    report.hover={elapsedMs:performance.now()-start,...await page.evaluate(()=>{const i=document.getElementById('kolImgPopupImg');return {source:i.dataset.source,width:i.naturalWidth,height:i.naturalHeight};})};
    const hoverOriginal=mappings.find(m=>m.url===source);assert.equal(report.hover.width,hoverOriginal.width);assert.equal(report.hover.height,hoverOriginal.height);
    await memory('after-original-hover');
    await page.evaluate(async ({keys,module})=>{await window.BLPerf.ensureFeature('deferredUi');
      const rows=state[module].rows.filter(r=>keys.includes(cpImageOverrideKey(r['PLM ID'],r['C.Code'])));
      window.BLDetailDrawer.open({storageKey:'int08.synthetic-originals',moduleId:module,source:module,tableSetup:module,title:'INT08 synthetic originals',rows,images:true,columns:[]});
    },{keys:mappings.map(m=>m.canonicalKey),module:MODULE});
    await page.waitForFunction(()=>[...document.querySelectorAll('#blSharedDetailDrawer img[data-src]')].some(i=>i.complete&&i.naturalWidth>0&&i.currentSrc===new URL(i.dataset.src,location.href).href),null,{timeout:60000});
    report.drawer=await page.evaluate(()=>[...document.querySelectorAll('#blSharedDetailDrawer img[data-src]')].filter(i=>i.complete&&i.naturalWidth&&i.currentSrc===new URL(i.dataset.src,location.href).href).map(i=>({source:i.dataset.src,width:i.naturalWidth,height:i.naturalHeight})));
    assert(report.drawer.length);for(const observed of report.drawer){const m=mappings.find(m=>m.url===observed.source);assert(m,'Drawer must resolve real persisted original refs');assert.equal(observed.width,m.width);assert.equal(observed.height,m.height);}
    await memory('after-original-drawer');
  }
  report.browserObservations=await page.evaluate(()=>({...window.__int08,resources:performance.getEntriesByType('resource').filter(e=>/\/api\/(?:cp|collection)-images\//.test(e.name)).map(e=>e.toJSON())}));
  await finishTrace(); // all byte/export checks below are excluded from performance trace
  if(scenario==='originals'){
    const functional=await page.evaluate(async entries=>{
      const hash=async dataUrl=>{const blob=await (await fetch(dataUrl)).blob();return [...new Uint8Array(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer()))].map(b=>b.toString(16).padStart(2,'0')).join('');};
      const checks=[],representatives=[],seen=new Set();
      await window.BLPerf.ensureLibrary('exceljs');const wb=new ExcelJS.Workbook(),ws=wb.addWorksheet('Originals');ws.columns=[{header:'Original',key:'image',width:20}];
      for(const item of entries){const input={source:item.url,modelId:item.modelId,colourCode:item.colourCode};
        if(await BLModelImageCache.getThumbnail(input)!==item.url)throw Error('Baseline table source changed');
        const clipboard=await BLModelImageCache.getClipboardDataUrl(input),prepared=await BLDetailImages.prepareForExcel(item.url);
        if(!prepared)throw Error('Actual export preparation failed');
        const c=await hash(clipboard),e=await hash(prepared.dataUrl);
        if(c!==item.sha256||e!==item.sha256||prepared.width!==item.width||prepared.height!==item.height)throw Error('Original clipboard/export bytes or dimensions changed');
        checks.push({index:item.index,clipboardBytesEqual:true,excelPreparedBytesEqual:true,width:prepared.width,height:prepared.height});
        const key=item.class+'|'+item.mime;if(!seen.has(key)){seen.add(key);const row=representatives.length+2;ws.getRow(row).height=90;
          BLDetailImages.addToExcel(ws,wb,prepared,row,1,null,{moveAndSizeWithCells:true});representatives.push(item.sha256);}
      }
      const bytes=new Uint8Array(await wb.xlsx.writeBuffer());let binary='';for(let offset=0;offset<bytes.length;offset+=32768)binary+=String.fromCharCode(...bytes.subarray(offset,offset+32768));
      return {checks,workbookExpectedHashes:representatives,workbookBase64:btoa(binary)};
    },mappings);
    fs.writeFileSync(path.join(run,'original-export.xlsx'),Buffer.from(functional.workbookBase64,'base64'));delete functional.workbookBase64;
    Object.assign(report.functional,functional);
  }
  assert.deepEqual(report.pageErrors||[],[],'Browser errors invalidate the sample');
  const guardEvents=fs.existsSync(path.join(run,'network-guard.log'))?fs.readFileSync(path.join(run,'network-guard.log'),'utf8').trim().split('\n').filter(Boolean):[];
  report.networkGuardDeniedConnects=guardEvents.filter(line=>line==='NONLOCAL_CONNECT_BLOCKED').length;
  report.immutableSourceWriteBlocks=guardEvents.filter(line=>line==='IMMUTABLE_SOURCE_WRITE_BLOCKED').length;
  assert.equal(report.immutableSourceWriteBlocks,0,'Any attempted source write invalidates the sample');
  report.status='baseline-captured-requires-analysis';
})().catch(error=>{report.status='failed';report.error={message:error.message,stack:error.stack};process.exitCode=1;}).finally(async()=>{
  try{if(traceActive)await finishTrace();}catch(error){report.traceError=error.message;}
  try{await browser?.close();report.browserExitConfirmed=true;}catch(error){report.browserCleanupError=error.message;process.exitCode=1;report.status='failed';}finally{
    const running=()=>server&&server.exitCode===null&&server.signalCode===null;
    if(running()){const ended=new Promise(resolve=>server.once('exit',resolve));server.kill('SIGTERM');await Promise.race([ended,delay(10000)]);if(running()){server.kill('SIGKILL');await ended;}}
    report.serverExitConfirmed=!running();
    fs.writeFileSync(path.join(run,'process-lifecycle.json'),JSON.stringify({probePid:process.pid,serverPid:server?.pid,serverStartTicks,serverExitConfirmed:report.serverExitConfirmed,serverExitCode:server?.exitCode,serverSignal:server?.signalCode,browserExitConfirmed:report.browserExitConfirmed}));
  }
  report.finishedAt=new Date().toISOString();persist();
});
