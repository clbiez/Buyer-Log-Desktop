'use strict';
// Official Electron 44.3.0 main-process probe; production workspace/preloads,
// actual synthetic backend. Run with the shared measurement flock; see README.
const {app,BrowserWindow,WebContentsView,dialog,screen,nativeTheme,session,ipcMain}=require('electron');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),http=require('node:http'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {spawn,execFileSync}=require('node:child_process');
const repo=path.resolve(__dirname,'../../..'),appRoot=path.join(repo,'resources/app'),out=process.env.PROBE_OUT||path.join(repo,'work/persistent-background-pages');
fs.mkdirSync(out,{recursive:true});
const comparison=process.env.PROBE_COMPARE||'candidate';const count=Number(process.env.PROBE_ROWS||2000);
const root=fs.mkdtempSync(path.join(out,'demo-')),node=process.env.PROBE_NODE;
app.setPath('userData',path.join(root,'electron-profile'));
app.disableHardwareAcceleration();
app.on('window-all-closed',()=>{});
const delay=ms=>new Promise(r=>setTimeout(r,ms));
const result={synthetic:true,platform:process.platform,arch:process.arch,versions:process.versions,sourceSha:execFileSync('git',['rev-parse','HEAD'],{cwd:repo,encoding:'utf8'}).trim(),baseMain:'9e667430',variant:comparison,rows:count,scenarios:[],requests:[],windowEvents:[],errors:[]};
let server,proxy,manager,base,cookie,slow=false,proxyActive=0,maxActive=0,phase='setup';
const save=()=>fs.writeFileSync(path.join(out,'acceptance.json'),JSON.stringify(result,null,2)+'\n');
function record(name,details={}){result.scenarios.push({name,...details});save();console.log('PASS',name,JSON.stringify(details));}
async function until(fn,label,ms=60000){const end=Date.now()+ms;while(Date.now()<end){try{if(await fn())return;}catch(_){}await delay(150);}result.timeoutState=await Promise.all(tabs().map(async w=>({id:w.id,url:w.getURL(),state:await js(w,"({title:document.title,body:document.body?.innerText.slice(-5000),probe:window.__probe,user:window.BL_USER_CONTEXT,ready:typeof switchTab})").catch(e=>String(e))})));for(const w of tabs())fs.writeFileSync(path.join(out,'timeout-'+w.id+'.png'),(await w.capturePage()).toPNG());throw Error('Timeout: '+label);}
const js=(wc,code)=>wc.executeJavaScript(code,true);
async function api(url,body,method){const r=await fetch(base+url,{method:method||(body?'POST':'GET'),signal:AbortSignal.timeout(60000),headers:{cookie:cookie||'','Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});assert.ok(r.ok,url+': '+r.status+' '+await r.clone().text());return r;}
const tabs=()=>manager?.allTabContents()||[];
const tabId=wc=>manager.tabForContents(wc).id;
const all=code=>Promise.all(tabs().map(wc=>js(wc,code)));
async function revisionsAt(n){return (await all(`sharedRevisionSnapshot?.entities.quotation?.revision>=${n}`)).every(Boolean);}
const initScript=`(()=>{
 window.__probe={revisions:[],sse:[],activity:[],visibility:[],startup:[],access:[],warmup:[],tasks:[]};window.addEventListener('bl:startup-progress',e=>{if(e.detail.stage==='modules')__probe.warmup.push(e.detail.module)});window.addEventListener('bl:background-warmup-done',()=>__probe.warmDone=true);new PerformanceObserver(l=>__probe.tasks.push(...l.getEntries().map(e=>({at:e.startTime,ms:e.duration})))).observe({type:'longtask',buffered:false});
 for(const k of ['bl.releaseNotes.lastSeenStable.v1','bl.user.moderator.bl.releaseNotes.lastSeenStable.v1'])localStorage.setItem(k,'99.0.0');
 window.addEventListener('bl-shared-revision',e=>__probe.revisions.push({at:Date.now(),...e.detail}));
 window.addEventListener('bl:startup-complete',()=>__probe.startup.push(Date.now()));
 document.addEventListener('visibilitychange',()=>__probe.visibility.push({at:Date.now(),state:document.visibilityState}));
 window.addEventListener('online',()=>__probe.activity.push({at:Date.now(),online:true}));
 window.addEventListener('offline',()=>__probe.activity.push({at:Date.now(),online:false}));
 window.buyerLogDesktop?.workspace.onTabActivity(e=>__probe.activity.push({at:Date.now(),...e}));
 const ES=window.EventSource;window.EventSource=class extends ES{constructor(url,options){super(url,options);this.addEventListener('message',e=>__probe.sse.push(JSON.parse(e.data)));}};
})();`;
app.on('web-contents-created',(_e,wc)=>{
 wc.on('console-message',(_e,...args)=>{if(args.some(x=>String(x).includes('Uncaught')))result.errors.push(args.map(String));});
 wc.on('render-process-gone',(_e,d)=>result.errors.push({wc:wc.id,...d}));
 wc.debugger.attach('1.3');
 wc.debugger.sendCommand('Page.enable').then(()=>wc.debugger.sendCommand('Page.addScriptToEvaluateOnNewDocument',{source:initScript})).catch(e=>result.errors.push(e.message));
});
(async()=>{
 await app.whenReady();assert.equal(process.versions.electron,'44.3.0');
 let port;
 if(process.env.PROBE_BACKEND_PORT){
 port=Number(process.env.PROBE_BACKEND_PORT);base='http://127.0.0.1:'+port;
 await until(async()=>{try{return (await fetch(base+'/api/status')).ok}catch{return false}},'prepared backend',300000);
 const login=await api('/api/user-login',{userId:'moderator',password:'shell06-native-demo-123'});cookie=login.headers.get('set-cookie').split(';')[0];
 const prefs=await(await api('/api/user-preferences')).json();const keys=Object.keys(prefs.entries||{});if(keys.length)await api('/api/user-preferences/delete',{keys});
 result.backendProtocol='shared prepared synthetic server; fresh renderer/profile and reset user preferences per arm';
 result.fixtureHash=crypto.createHash('sha256').update(JSON.stringify(require(path.join(appRoot,'scripts/generate-demo-data')).build({rows:count,seed:7,today:new Date('2026-11-09T00:00:00Z')}))).digest('hex');
 }else{
 const env={...process.env,BUYER_LOG_CENTRAL_IAM_ENABLED:'0',BUYER_LOG_CONFIG_PATH:path.join(root,'config.json')};
 for(const [key,dir] of Object.entries({BUYER_LOG_DATA_ROOT:'app',BUYER_LOG_SERVER_DATA_ROOT:'server',BUYER_LOG_LOCAL_DATA_ROOT:'local',BUYER_LOG_TEMP_ROOT:'temp'})){env[key]=path.join(root,dir);fs.mkdirSync(env[key],{recursive:true});}
 env.BUYER_LOG_AUTH_DATA_ROOT=env.BUYER_LOG_SERVER_DATA_ROOT;env.BL_DATA_DIR=env.BUYER_LOG_SERVER_DATA_ROOT;env.BUYER_LOG_LOCAL_DB=path.join(root,'local/BuyerLogLocal.db');
 const free=http.createServer();await new Promise(r=>free.listen(0,'127.0.0.1',r));port=free.address().port;await new Promise(r=>free.close(r));
 const source=path.join(root,'source');execFileSync(node,[path.join(appRoot,'scripts/generate-demo-data.js'),source,'--rows',String(count),'--seed','7'],{cwd:appRoot});
 result.fixtureHash=crypto.createHash('sha256').update(JSON.stringify(require(path.join(appRoot,'scripts/generate-demo-data')).build({rows:count,seed:7,today:new Date('2026-11-09T00:00:00Z')}))).digest('hex');
 fs.writeFileSync(env.BUYER_LOG_CONFIG_PATH,JSON.stringify({port,host:'127.0.0.1',sourceFolder:source,updates:{enabled:false}}));
 const log=fs.openSync(path.join(out,'server.log'),'w');server=spawn(node,['server/server.js'],{cwd:appRoot,env,stdio:['ignore',log,log]});fs.closeSync(log);
 base='http://127.0.0.1:'+port;
 await until(async()=>{try{return (await fetch(base+'/api/status')).ok;}catch{return false;}},'backend ready');
 const login=await api('/api/user-login',{userId:'moderator',newPassword:'shell06-native-demo-123',password:'shell06-native-demo-123'});cookie=login.headers.get('set-cookie').split(';')[0];
 await api('/api/refresh',{});await until(async()=>!(await(await api('/api/refresh-status')).json()).running,'demo data',90000);
 const workspace=await(await api('/api/collection-workspaces/moderator')).json();
 await api('/api/collection-workspaces/moderator',{...workspace.workspace,rows:Array.from({length:40},(_,i)=>({id:i+1,modelKod:'DEMO '+(i+1),season:'6W26',mag:'CU4E',urunTipi:'KNIT',quantity:100,pricing:{},colour:'BLUE'})),nextId:41},'PUT');
 const {SharedRevisionStore}=require(path.join(appRoot,'server/lib/shared-revision-store'));
 const store=new SharedRevisionStore(path.join(root,'local/shared-data'));await store.update('quotation');
 }
 proxy=http.createServer((req,res)=>{
   if(comparison==='main'&&/^\/(app-main|startup-module-preparation)\.js/.test(req.url)){res.writeHead(200,{'Content-Type':'application/javascript','Cache-Control':'no-store'});res.end(execFileSync('git',['show',(process.env.PROBE_MAIN_SHA||'9e667430')+':resources/app/public/'+req.url.split('?')[0].slice(1)],{cwd:repo,maxBuffer:15e6}));return;}
   const revision=req.url.startsWith('/api/shared-revisions');
   const delayed=revision&&slow;
   if(revision){proxyActive++;maxActive=Math.max(maxActive,proxyActive);res.once('close',()=>proxyActive--);}
   const upstream=http.request({host:'127.0.0.1',port,path:req.url,method:req.method,headers:{...req.headers,host:'127.0.0.1:'+port}},incoming=>{
     if(revision)incoming.on('data',chunk=>{if(phase==='steady')result.steadyRevisionBytes=(result.steadyRevisionBytes||0)+chunk.length;});
     const forward=()=>{if(res.destroyed){incoming.destroy();return;}res.writeHead(incoming.statusCode,incoming.headers);incoming.pipe(res);};
     if(delayed){incoming.pause();setTimeout(forward,12000);}else forward();
   });upstream.on('error',e=>{if(!res.destroyed){res.writeHead(502);res.end(e.message);}});req.pipe(upstream);res.on('close',()=>upstream.destroy());
 });await new Promise(r=>proxy.listen(0,'127.0.0.1',r));base='http://127.0.0.1:'+proxy.address().port;
 const ses=session.defaultSession;
 const split=cookie.indexOf('=');await ses.cookies.set({url:base,name:cookie.slice(0,split),value:cookie.slice(split+1),httpOnly:true});
 ses.webRequest.onBeforeRequest((d,cb)=>{
   const u=new URL(d.url);if(!['127.0.0.1','localhost'].includes(u.hostname)&&u.protocol!=='file:'&&u.protocol!=='devtools:'){cb({cancel:true});return;}
   if(u.pathname.startsWith('/api/'))result.requests.push({at:Date.now(),phase,wc:d.webContentsId,url:u.pathname,query:u.search,requestId:d.id});cb({});
 });
 const {createWorkspaceManager}=require(path.join(appRoot,'electron/workspace-manager'));
 manager=createWorkspaceManager({BrowserWindow,WebContentsView,dialog,screen,path,crypto,nativeTheme,origin:base,shellFile:path.join(appRoot,'electron/workspace.html'),shellPreload:path.join(appRoot,'electron/workspace-preload.js'),contentPreload:path.join(appRoot,'electron/preload.js'),loadWindowState:()=>({width:1440,height:928}),saveWindowState:()=>{},applyNavigationPolicy:wc=>wc.setWindowOpenHandler(()=>({action:'deny'})),log:msg=>console.log('workspace',msg),onFirstRendererReady:wc=>result.windowEvents.push({event:'first-renderer-ready',wc:wc.id})});
 ipcMain.handle('buyerlog:workspace-snapshot',e=>manager.shellSnapshot(e));
 ipcMain.handle('buyerlog:workspace-set-module',(e,m)=>manager.updateTabModule(e.sender,m));
 ipcMain.handle('buyerlog:workspace-theme',(_e,t)=>manager.setTheme(t));
 ipcMain.handle('buyerlog:render-profile',()=>({softwareCompositing:true}));
 ipcMain.handle('buyerlog:startup-transition',()=>false);
 ipcMain.handle('buyerlog:update-status',()=>({enabled:false}));
 ipcMain.handle('buyerlog:workspace-activate',(e,id)=>manager.activateTab(manager.windowForShellContents(e.sender).window.id,id));

 const started=Date.now(),win=manager.createWindow({module:'overview'}),wc=tabs()[0];
 await until(()=>js(wc,"typeof switchTab==='function'&&Boolean(window.BL_USER_CONTEXT?.id)"),'application');
 await js(wc,'if(!window.__probe){'+initScript+'}');
 await until(()=>js(wc,"!!document.querySelector('[data-boot-continue]')"),'Continue',120000);
 result.continueReadyMs=Date.now()-started;console.log('Continue',result.continueReadyMs);save();
 const continueAt=Date.now();await js(wc,"document.querySelector('[data-boot-continue]').click()");
 await until(()=>js(wc,"!document.getElementById('blBootGuard')"),'usable first screen');result.firstScreenMs=Date.now()-continueAt;console.log('First screen',result.firstScreenMs);save();
 await until(()=>js(wc,'__probe.warmDone===true'),'background completion',120000);result.warmupMs=Date.now()-continueAt;console.log('Warmup',result.warmupMs);save();
 result.initial=await js(wc,'({tasks:__probe.tasks,preparation:BLModulePreparation.snapshot(),queue:__probe.warmup,cp:state.cp?.rows.length,orders:state.orders?.rows.length,backlog:!!backlogPrefetch,collection:kolRows.length})');
 if(comparison==='candidate'){
  assert.deepEqual(result.initial.queue,['koleksiyon','cp','orders','backlog'].filter(m=>result.initial.queue.includes(m)));assert.ok(Object.values(result.initial.preparation).every(s=>s.status==='ready'));
  assert.ok(result.initial.cp>0&&result.initial.orders>0&&result.initial.backlog);assert.equal(tabs().length,1);
 }
 const heap=async()=>{await wc.debugger.sendCommand('HeapProfiler.collectGarbage');return (await wc.debugger.sendCommand('Runtime.getHeapUsage')).usedSize;};
 result.preparedHeap=await heap();assert.ok(result.preparedHeap<1073741824);
 result.visits=[];
 const navigate=async(tab,round)=>{
  phase=`round-${round}-${tab}`;const cut=result.requests.length;
  if(round===0&&tab==='koleksiyon'&&comparison==='candidate'&&count===30000){await wc.debugger.sendCommand('Profiler.enable');await wc.debugger.sendCommand('Profiler.start');}
  const timing=await js(wc,`(async()=>{__probe.tasks=[];const t=performance.now();switchTab('${tab}');const switchMs=performance.now()-t;
   if(${process.env.PROBE_COLLECTION_ONLY==='1'}&&${JSON.stringify(tab)}==='koleksiyon')await Promise.all([__probe.profilePending,window.BLPerf.ensureFeature('collectionTools'),window.BLPerf.ensureFeature('deferredUi'),ensureCollectionCatalogLoaded(),ensureCollectionMasterCatalogLoaded()]);
   const ready=()=>${JSON.stringify(tab)}==='cp'?!!document.querySelector('#cpTable tbody tr td')&&!!_unifiedPriorityCache.cp:${JSON.stringify(tab)}==='orders'?!!document.querySelector('#ordersTable tbody tr td'):${JSON.stringify(tab)}==='backlog'?backlogLoadedOnce:!!document.querySelector('#kolTable tbody tr td');
   while(!ready()){if(performance.now()-t>120000)throw Error('table timeout ${tab}');await new Promise(r=>setTimeout(r,20));}
   const dataMs=performance.now()-t;await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));return {switchMs,dataMs,frameMs:performance.now()-t};})()`);
  await delay(500);
  if(round===0&&tab==='koleksiyon'&&comparison==='candidate'&&count===30000){const profile=await wc.debugger.sendCommand('Profiler.stop');fs.writeFileSync(path.join(out,'collection-first.cpuprofile'),JSON.stringify(profile));}
  const dataRequests=result.requests.slice(cut).filter(r=>/^\/api\/(data\/(cp|orders)|compute\/(cp|orders)|page-projection\/(cp|orders|collection-catalog)|collection-workspaces|backlog$|collection-(catalog|master-catalog)|views$|filter-profiles$)/.test(r.url));
  const metrics=await js(wc,'({tasks:__probe.tasks,cp:state.cp?.rows.length,orders:state.orders?.rows.length,collection:kolRows.length})');
  const visit={tab,round,...timing,...metrics,dataRequests};result.visits.push(visit);console.log('Visit',tab,round,timing.dataMs);save();
  return visit;
 };
 if(process.env.PROBE_COLLECTION_ONLY==='1'){
 await js(wc,"window.__profileOriginal=applyProfilesForCurrentPage;window.applyProfilesForCurrentPage=function(...args){return (__probe.profilePending=__profileOriginal(...args));};document.querySelector('[data-rn-close]')?.click();");
 await navigate('koleksiyon',0);result.status='PASS';save();return;
 }
 for(const tab of ['koleksiyon','cp','orders','backlog'])await navigate(tab,0);
 await delay(1500);
 await js(wc,"window.__resident={cp:state.cp,orders:state.orders,cpRow:document.querySelector('#cpTable tbody tr'),ordersRow:document.querySelector('#ordersTable tbody tr'),kolRow:document.querySelector('#kolTable tbody tr'),cpBody:document.querySelector('#cpTable tbody'),ordersBody:document.querySelector('#ordersTable tbody'),kolBody:document.querySelector('#kolTable tbody')};");
 result.heapCycles=[await heap()];result.domCycles=[await wc.debugger.sendCommand('Memory.getDOMCounters')];
 for(let round=1;round<=5;round++){
  for(const tab of ['koleksiyon','cp','orders','backlog'])await navigate(tab,round);
  result.heapCycles.push(await heap());result.domCycles.push(await wc.debugger.sendCommand('Memory.getDOMCounters'));
 }
 result.identity=await js(wc,"({cp:state.cp===__resident.cp,orders:state.orders===__resident.orders,cpRow:document.querySelector('#cpTable tbody tr')===__resident.cpRow,ordersRow:document.querySelector('#ordersTable tbody tr')===__resident.ordersRow,kolRow:document.querySelector('#kolTable tbody tr')===__resident.kolRow,cpBody:document.querySelector('#cpTable tbody')===__resident.cpBody,ordersBody:document.querySelector('#ordersTable tbody')===__resident.ordersBody,kolBody:document.querySelector('#kolTable tbody')===__resident.kolBody})");
 result.warmDataRequests=result.visits.filter(v=>v.round>0).flatMap(v=>v.dataRequests);
 if(comparison==='candidate')assert.equal(result.warmDataRequests.length,0,'warm pages must not fetch data again');
 if(comparison==='candidate')assert.ok(Object.values(result.identity).every(Boolean),'resident page/state identity');
 const dirty=await js(wc,"window.__cpKeep=state.cp;state.cpDirty.add('native-synthetic-draft');cpClientWorkInProgress()");assert.ok(dirty);
 await js(wc,"switchTab('orders');switchTab('cp')");await delay(800);assert.equal(await js(wc,"state.cp===__cpKeep&&state.cpDirty.has('native-synthetic-draft')"),true);await js(wc,'state.cpDirty.clear()');
 result.dirtyEditRetained=true;result.native=manager.diagnosticsSnapshot();result.lastHeap=await heap();
 result.preload=await js(wc,'({versions:buyerLogDesktop.versions,workspaceTab:new URLSearchParams(location.search).get("workspaceTab")})');
 await js(wc,"document.querySelector('[data-rn-close]')?.click();switchTab('orders');applyLanguage('en')");await delay(700);
 fs.writeFileSync(path.join(out,'native-post-change.png'),(await wc.capturePage()).toPNG());
 const remaining=tabs();manager.destroyAllWindows();await until(()=>remaining.every(w=>w.isDestroyed()),'native cleanup');assert.equal(tabs().length,0);result.remainingViews=0;
 result.status='PASS';save();console.log('NATIVE PASS',JSON.stringify({variant:comparison,rows:count,firstScreenMs:result.firstScreenMs,warmupMs:result.warmupMs,preparedHeap:result.preparedHeap,heapCycles:result.heapCycles,identity:result.identity}));
})().catch(e=>{result.status='FAIL';result.error=e.stack;save();console.error(e);process.exitCode=1;}).finally(async()=>{manager?.destroyAllWindows();server?.kill();proxy?.closeAllConnections();proxy?.close();setTimeout(()=>app.exit(process.exitCode||0),500);});
