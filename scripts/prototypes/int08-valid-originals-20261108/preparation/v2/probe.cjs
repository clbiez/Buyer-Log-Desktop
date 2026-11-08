'use strict';
// Prepared, not executed. Baseline cost/contract probe against pinned Buyer Log.
// No mock image endpoint, fake decoder, DOM replacement table, or optimization.
const fs = require('node:fs'), path = require('node:path'), net = require('node:net');
const crypto = require('node:crypto'), zlib = require('node:zlib'), assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { chromium } = require('/opt/codex/cua_node/lib/node_modules/playwright');
const ROOT = __dirname;
const arg = name => { const i = process.argv.indexOf(name); assert(i >= 0, name); return process.argv[i+1]; };
const app = path.resolve(arg('--app-root')), run = path.resolve(arg('--run-root')), scenario = arg('--scenario');
const STAGE=path.resolve(arg('--stage-root'));
assert(run.startsWith(path.join(ROOT, 'runs') + path.sep));
assert(['control', 'originals'].includes(scenario));
const fixture = path.join(run, 'fixture');
fs.mkdirSync(path.join(run,'tmp'),{recursive:true});
process.env.TMPDIR=path.join(run,'tmp');
const fixtureManifest=JSON.parse(fs.readFileSync(path.join(STAGE,'fixture-manifest.json')));
const images = fixtureManifest.images;
const pins = JSON.parse(fs.readFileSync(path.join(STAGE, 'source-pins.json')));
assert.equal(app,fixtureManifest.appRoot);assert.equal(fixtureManifest.revision,pins.revision);assert.equal(fixtureManifest.appTree,pins.appTree);
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const report = { schemaVersion:1, synthetic:true, scenario, revision:pins.revision, status:'running',
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
  browser = await chromium.launch({headless:true, executablePath:'/usr/bin/chromium', args:['--no-sandbox']});
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
async function openCp() {
  await page.goto(base+'/?module=cp', {waitUntil:'domcontentloaded', timeout:120000});
  await page.waitForFunction(()=>document.querySelector('[data-boot-continue]') ||
    (!document.getElementById('blBootGuard') && document.querySelector('#cpTable tbody tr[data-id]')), null, {timeout:180000});
  report.continueIntentAtMs = await page.evaluate(()=>performance.now());
  if (await page.locator('[data-boot-continue]').count()) await page.click('[data-boot-continue]');
  await page.waitForFunction(()=>!document.getElementById('blBootGuard') && state.cp?.rows.length>0 &&
    document.querySelector('#cpTable tbody tr[data-id]'), null, {timeout:180000});
}
async function memory(phase) {
  const {metrics} = await cdp.send('Performance.getMetrics');
  const {processInfo} = await browserCdp.send('SystemInfo.getProcessInfo');
  const processes = processInfo.filter(p=>['renderer','GPU','gpu','browser'].includes(p.type)).map(p=>{
    let rssBytes=null;
    try { const m=fs.readFileSync('/proc/'+p.id+'/status','utf8').match(/^VmRSS:\s+(\d+)/m); if(m)rssBytes=Number(m[1])*1024; } catch {}
    return {pid:p.id,type:p.type,rssBytes};
  });
  const snapshot={phase,at:new Date().toISOString(),processes,
    jsHeapUsedBytes:metrics.find(m=>m.name==='JSHeapUsedSize')?.value,
    jsHeapTotalBytes:metrics.find(m=>m.name==='JSHeapTotalSize')?.value,
    app:await page.evaluate(()=>({cache:window.BLModelImageCache?.stats?.(),runtime:window.BLImageRuntime?.stats?.()}))};
  try { snapshot.memoryDump=await browserCdp.send('Tracing.requestMemoryDump',{deterministic:false,levelOfDetail:'detailed'}); }
  catch(error){snapshot.memoryDump={unavailable:error.message};}
  report.phases.push(snapshot); persist();
}
async function scroll(label) {
  const result=await page.evaluate(async ({label,originalUrls})=>{
    const wrap=document.getElementById('cpTableWrap'); if(!wrap)throw Error('Actual CP scroller missing');
    wrap.scrollTop=0;
    const frames=[],coverage=[],sources=new Set(); let last=performance.now();
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
    return {label,wallMs:performance.now()-start,rangePx:range,framesMs:frames,p50Ms:q(.5),p95Ms:q(.95),maxMs:Math.max(...sorted),
      over16_7Ms:sorted.filter(n=>n>16.7).length,over33_3Ms:sorted.filter(n=>n>33.3).length,coverage,uniqueOriginalsVisible:sources.size};
  },{label,originalUrls:mappings.map(m=>m.url)});
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
  const decodes=events.filter(e=>e.ph==='X'&&/decode.*image|image.*decode/i.test(e.name||''));
  const allocators=[];
  for(const event of events){const a=event.args?.dumps?.allocators;if(!a)continue;
    for(const [name,value] of Object.entries(a))if(/image|skia|discardable|gpu/i.test(name))
      allocators.push({pid:event.pid,ts:event.ts,name,attrs:value.attrs});}
  report.trace={file,sha256:sha(fs.readFileSync(file)),decodeCompleteEventCount:decodes.length,
    decodeCpuMs:decodes.reduce((n,e)=>n+(Number(e.dur)||0),0)/1000,
    decodeNames:[...new Set(decodes.map(e=>e.name))],decodeScope:'Complete X events only; CPU durations can overlap threads.',
    decodedImageMemory:{status:allocators.length?'allocator-candidates-require-attribution':'unavailable',allocatorCandidates:allocators}};
  // Compression is the dispatcher's post-exit task. Keep the full raw trace
  // until the application server and browser have exited and the gzip is
  // written, hashed and independently decompressed/verified.
}
function installObservers() {
  const p=window.__int08={imageLoads:[],decodeCalls:[],longTasks:[]};
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
  fs.writeFileSync(env.BUYER_LOG_CONFIG_PATH,JSON.stringify({port,host:'127.0.0.1',sourceFolder:path.join(fixture,'source'),updates:{enabled:false}}));
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
  if(scenario==='originals'){
    await launch();await openCp();
    const rows=await page.evaluate(count=>{const domIds=[...document.querySelectorAll('#cpTable tbody tr[data-id]')].map(e=>String(e.dataset.id));
      const all=state.cp.rows,visible=domIds.map(id=>all.find(r=>String(r._id)===id)).filter(Boolean),seen=new Set(),out=[];
      for(const row of [...visible,...all]){const key=cpImageOverrideKey(row['PLM ID'],row['C.Code']);
        if(!key||seen.has(key)||row._canEdit===false)continue;seen.add(key);out.push({id:row._id,initiallyRendered:domIds.includes(String(row._id))});if(out.length===count)break;}return out;},images.length);
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
      mappings.push({...image,...linked,initiallyRendered:rows[i].initiallyRendered});
    }
    await browser.close();browser=null; // discard upload-warmed image/cache/renderer state
    report.functional.apiByteChecks=[];
    for(const mapping of mappings)for(const endpoint of ['cp-images','collection-images']){
      const response=await api('/api/'+endpoint+'/'+encodeURIComponent(mapping.imageRef));
      const bytes=Buffer.from(await response.arrayBuffer());assert.equal(sha(bytes),mapping.sha256);assert.equal(bytes.length,mapping.encodedBytes);
      assert.equal(response.headers.get('content-type').split(';')[0],mapping.mime);
      assert.equal(Number(response.headers.get('content-length')),bytes.length);
      assert.match(response.headers.get('cache-control'),/immutable/);assert.equal(response.headers.get('pragma'),null);
      report.functional.apiByteChecks.push({index:mapping.index,endpoint,bytesEqual:true,bytes:bytes.length});
    }
    fs.writeFileSync(path.join(run,'attached-images.json'),JSON.stringify(mappings,null,2)+'\n');
  }
  await launch();cdp=await context.newCDPSession(page);browserCdp=await browser.newBrowserCDPSession();
  await cdp.send('Performance.enable');await cdp.send('Network.enable');
  cdp.on('Network.responseReceived',({requestId,response})=>{if(/\/api\/(?:cp|collection)-images\//.test(response.url))report.network.push({requestId,url:response.url,status:response.status,fromDiskCache:response.fromDiskCache,fromServiceWorker:response.fromServiceWorker,mimeType:response.mimeType});});
  await page.addInitScript(installObservers);
  await browserCdp.send('Tracing.start',{transferMode:'ReturnAsStream',traceConfig:{recordMode:'recordContinuously',includedCategories:[
    'devtools.timeline','disabled-by-default-devtools.timeline','disabled-by-default-memory-infra','cc','blink','benchmark'],
    memoryDumpConfig:{triggers:[]}}});traceActive=true;
  await memory('blank-before-navigation');await openCp();
  report.dataset=await page.evaluate(()=>({cpRows:state.cp.rows.length,ordersRows:state.orders?.rows.length,active:document.body.dataset.activeTab,
    tableGeometry:{scrollHeight:document.getElementById('cpTableWrap').scrollHeight,clientHeight:document.getElementById('cpTableWrap').clientHeight,
      firstRowHeights:[...document.querySelectorAll('#cpTable tbody tr[data-id]')].slice(0,40).map(row=>row.getBoundingClientRect().height)}}));
  assert.equal(report.dataset.cpRows,report.inputCache.modules.cp);assert.equal(report.dataset.active,'cp');
  if(scenario==='originals'){
    await page.waitForFunction(urls=>[...document.querySelectorAll('#cpTable img[data-src]')].some(img=>urls.includes(img.dataset.src)&&img.complete&&img.naturalWidth>0&&img.currentSrc===new URL(img.dataset.src,location.href).href),mappings.map(m=>m.url),{timeout:60000});
    report.firstVisibleOriginalObservedAtMs=await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(performance.now())))));
    report.tableOriginals=await page.evaluate(()=>[...document.querySelectorAll('#cpTable img[data-src]')].filter(img=>img.complete&&img.naturalWidth&&img.dataset.src&&img.currentSrc===new URL(img.dataset.src,location.href).href).map(img=>({source:img.dataset.src,currentSrc:img.currentSrc,width:img.naturalWidth,height:img.naturalHeight,cssWidth:img.getBoundingClientRect().width,cssHeight:img.getBoundingClientRect().height})));
    for(const observed of report.tableOriginals){const m=mappings.find(m=>m.url===observed.source);if(m){assert.equal(observed.width,m.width);assert.equal(observed.height,m.height);}}
  }
  await memory('table-first-visible');await scroll('first-scroll');await memory('after-first-scroll');
  await scroll('repeat-scroll');await memory('after-repeat-scroll');
  if(scenario==='originals'){
    assert(report.scroll[0].uniqueOriginalsVisible>=8,'Actual scroll did not expose enough fixture originals; fix fixture placement before measuring');
    await page.evaluate(()=>{document.getElementById('cpTableWrap').scrollTop=0;});
    const thumb=page.locator('#cpTable img[data-has-image="1"][data-src]:visible').first();
    const source=await thumb.getAttribute('data-src');assert(mappings.some(m=>m.url===source));
    const start=performance.now();await thumb.hover();
    await page.waitForFunction(expected=>{const img=document.getElementById('kolImgPopupImg'),pop=document.getElementById('kolImgPopup');return pop?.style.display!=='none'&&img?.dataset.source===expected&&img.complete&&img.naturalWidth>0;},source,{timeout:10000});
    report.hover={elapsedMs:performance.now()-start,...await page.evaluate(()=>{const i=document.getElementById('kolImgPopupImg');return {source:i.dataset.source,width:i.naturalWidth,height:i.naturalHeight};})};
    const hoverOriginal=mappings.find(m=>m.url===source);assert.equal(report.hover.width,hoverOriginal.width);assert.equal(report.hover.height,hoverOriginal.height);
    await memory('after-original-hover');
    await page.evaluate(async ids=>{await window.BLPerf.ensureFeature('deferredUi');
      const rows=state.cp.rows.filter(r=>ids.includes(String(r._id)));
      window.BLDetailDrawer.open({storageKey:'int08.synthetic-originals',moduleId:'cp',source:'cp',tableSetup:'cp',title:'INT08 synthetic originals',rows,images:true,columns:[]});
    },mappings.map(m=>String(m.rowId)));
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
