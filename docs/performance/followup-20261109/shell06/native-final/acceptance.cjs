'use strict';
// Official Electron 44.3.0 main-process probe; production workspace/preloads,
// actual synthetic backend. Run with the shared measurement flock; see README.
const {app,BrowserWindow,WebContentsView,dialog,screen,nativeTheme,session,ipcMain}=require('electron');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),http=require('node:http'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {spawn,execFileSync}=require('node:child_process');
const repo=path.resolve(__dirname,'../../../../..'),appRoot=path.join(repo,'resources/app'),out=process.env.PROBE_OUT||__dirname;
fs.mkdirSync(out,{recursive:true});
const comparison=process.env.PROBE_COMPARE||null;
const root=fs.mkdtempSync('/tmp/buyerlog-shell06-native-'),node=process.env.PROBE_NODE;
app.setPath('userData',path.join(root,'electron-profile'));
app.disableHardwareAcceleration();
app.on('window-all-closed',()=>{});
const delay=ms=>new Promise(r=>setTimeout(r,ms));
const result={synthetic:true,platform:process.platform,arch:process.arch,versions:process.versions,sourceSha:execFileSync('git',['rev-parse','HEAD'],{cwd:repo,encoding:'utf8'}).trim(),baseMain:'57409641',scenarios:[],requests:[],windowEvents:[],errors:[]};
let server,proxy,manager,base,cookie,slow=false,proxyActive=0,maxActive=0,phase='setup';
const save=()=>fs.writeFileSync(path.join(out,'acceptance.json'),JSON.stringify(result,null,2)+'\n');
function record(name,details={}){result.scenarios.push({name,...details});save();console.log('PASS',name,JSON.stringify(details));}
async function until(fn,label,ms=60000){const end=Date.now()+ms;while(Date.now()<end){try{if(await fn())return;}catch(_){}await delay(150);}throw Error('Timeout: '+label);}
const js=(wc,code)=>wc.executeJavaScript(code,true);
async function api(url,body,method){const r=await fetch(base+url,{method:method||(body?'POST':'GET'),signal:AbortSignal.timeout(60000),headers:{cookie:cookie||'','Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});assert.ok(r.ok,url+': '+r.status+' '+await r.clone().text());return r;}
const tabs=()=>manager.allTabContents();
const tabId=wc=>manager.tabForContents(wc).id;
const all=code=>Promise.all(tabs().map(wc=>js(wc,code)));
async function revisionsAt(n){return (await all(`sharedRevisionSnapshot?.entities.quotation?.revision>=${n}`)).every(Boolean);}
const initScript=`(()=>{
 window.__probe={revisions:[],sse:[],activity:[],visibility:[],startup:[],access:[]};
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
async function ready(wc){
 await until(()=>js(wc,"typeof initLiveSync==='function'&&Boolean(window.BL_USER_CONTEXT?.id)"),'application identity');
 await js(wc, 'if(!window.__probe){'+initScript+'}');
 const startup=await js(wc,"new URLSearchParams(location.search).get('startup')==='1'");
 {
   await until(()=>js(wc,"Boolean(document.querySelector('[data-boot-continue]'))"),'startup ready/modules gates',90000);
   const gates=await js(wc,"({startup:window.BL_STARTUP_COMPLETE===true,button:!!document.querySelector('[data-boot-continue]'),preparation:window.BLModulePreparation?.snapshot()})");
   assert.equal(gates.startup,false,'startup needs the real continue action');
   await js(wc,"document.querySelector('[data-boot-continue]').click()");
   record(startup?'first-tab-startup-gate':'native-tab-ready-gate',{wc:wc.id,...gates});
 }
 await until(()=>js(wc,"window.BL_STARTUP_COMPLETE===true&&!document.getElementById('blBootGuard')"),'startup complete');
 assert.equal(await js(wc,'buyerLogDesktop.versions.electron'),'44.3.0');
}
async function wake(wc){await js(wc,"window.dispatchEvent(new Event('online'))");}
(async()=>{
 await app.whenReady();assert.equal(process.versions.electron,'44.3.0');
 const env={...process.env,BUYER_LOG_CENTRAL_IAM_ENABLED:'0',BUYER_LOG_CONFIG_PATH:path.join(root,'config.json')};
 for(const [key,dir] of Object.entries({BUYER_LOG_DATA_ROOT:'app',BUYER_LOG_SERVER_DATA_ROOT:'server',BUYER_LOG_LOCAL_DATA_ROOT:'local',BUYER_LOG_TEMP_ROOT:'temp'})){env[key]=path.join(root,dir);fs.mkdirSync(env[key],{recursive:true});}
 env.BUYER_LOG_AUTH_DATA_ROOT=env.BUYER_LOG_SERVER_DATA_ROOT;env.BL_DATA_DIR=env.BUYER_LOG_SERVER_DATA_ROOT;env.BUYER_LOG_LOCAL_DB=path.join(root,'local/BuyerLogLocal.db');
 const free=http.createServer();await new Promise(r=>free.listen(0,'127.0.0.1',r));const port=free.address().port;await new Promise(r=>free.close(r));
 const source=path.join(root,'source');execFileSync(node,[path.join(appRoot,'scripts/generate-demo-data.js'),source,'--rows','20','--seed','7'],{cwd:appRoot});
 fs.writeFileSync(env.BUYER_LOG_CONFIG_PATH,JSON.stringify({port,host:'127.0.0.1',sourceFolder:source,updates:{enabled:false}}));
 const log=fs.openSync(path.join(out,'server.log'),'w');server=spawn(node,['server/server.js'],{cwd:appRoot,env,stdio:['ignore',log,log]});fs.closeSync(log);
 base='http://127.0.0.1:'+port;
 await until(async()=>{try{return (await fetch(base+'/api/status')).ok;}catch{return false;}},'backend ready');
 const login=await api('/api/user-login',{userId:'moderator',newPassword:'shell06-native-demo-123',password:'shell06-native-demo-123'});cookie=login.headers.get('set-cookie').split(';')[0];
 await api('/api/refresh',{});await until(async()=>!(await(await api('/api/refresh-status')).json()).running,'demo data',90000);
 const {SharedRevisionStore}=require(path.join(appRoot,'server/lib/shared-revision-store'));
 const store=new SharedRevisionStore(path.join(root,'local/shared-data'));await store.update('quotation');
 proxy=http.createServer((req,res)=>{
   if(comparison==='main'&&req.url.startsWith('/app-main.js')){res.writeHead(200,{'Content-Type':'application/javascript','Cache-Control':'no-store'});res.end(execFileSync('git',['show','origin/main:resources/app/public/app-main.js'],{cwd:repo,maxBuffer:15e6}));return;}
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
   if(/\/api\/(shared-revisions|live-events)/.test(d.url))result.requests.push({at:Date.now(),phase,wc:d.webContentsId,url:u.pathname,requestId:d.id});cb({});
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
 const win=manager.createWindow({module:'orders'});
 const first=tabs()[0];await ready(first);
 const second=manager.openModule(win.window.id,'orders',{forceNew:true}).view.webContents;await ready(second);
 const third=manager.openModule(win.window.id,'orders',{forceNew:true}).view.webContents;await ready(third);
 assert.equal(tabs().length,3);
 record('production-native-runtime',{runtime:process.versions.electron,diagnostics:manager.diagnosticsSnapshot(),preferences:tabs().map(w=>({wc:w.id,...w.getLastWebPreferences()})),preload:await all('({isDesktop:buyerLogDesktop.isDesktop,versions:buyerLogDesktop.versions,workspaceTab:new URLSearchParams(location.search).get("workspaceTab"),visibility:document.visibilityState})')});
 phase='steady';await wake(third);await delay(21000);
 const steady=result.requests.filter(r=>r.phase===phase);const pollers=[...new Set(steady.filter(r=>r.url==='/api/shared-revisions').map(r=>r.wc))];if(comparison){
   await until(()=>proxyActive===0,'steady response completion');
   const steadySSE=result.requests.filter(r=>r.url==='/api/live-events');assert.equal(steadySSE.length,1);
   if(comparison==='candidate')assert.equal(pollers.length,1);else assert.equal(pollers.length,3);
   record('comparison-steady',{variant:comparison,durationMs:21000,revisionRequests:steady.filter(r=>r.url==='/api/shared-revisions').length,requestingTabs:pollers,SSE:steadySSE.length,revisionBytes:result.steadyRevisionBytes||0,maxActive});
   phase='cleanup-cycles';const cycles=[];
   for(let i=0;i<5;i++){const w=manager.openModule(win.window.id,'orders',{forceNew:true}).view.webContents;await ready(w);await manager.closeTab(tabId(w));await until(()=>tabs().length===3,'cycle cleanup');const locks=await js(first,'navigator.locks.query()');assert.equal(locks.held.filter(l=>l.name.startsWith('buyerlog-live-sync-leader')).length,1);cycles.push({cycle:i+1,tabs:tabs().length,heldLeaders:1,destroyed:w.isDestroyed()});assert.ok(w.isDestroyed());}
   record('five-native-open-close-cycles',{variant:comparison,cycles});
   const remaining=tabs();manager.destroyAllWindows();assert.equal(tabs().length,0);await until(()=>remaining.every(w=>w.isDestroyed()),'all native views destroyed');
   record('comparison-cleanup',{variant:comparison,remainingTabs:0,destroyed:true});result.status='PASS';save();return;
 }assert.equal(pollers.length,1);
 const sse=result.requests.filter(r=>r.url==='/api/live-events');assert.equal(sse.length,1);
 record('one-SSE-one-revision-leader',{durationMs:21000,requests:steady,SSE:sse,connected:await all('liveSyncConnected')});
 let next=await store.update('quotation');await wake(third);await until(()=>revisionsAt(next.entities.quotation.revision),'revision fanout');
 record('revision-fanout',{revision:next.entities.quotation.revision,events:await all('__probe.revisions')});
 const current=await(await api('/api/pricing-rules')).json();const rule={id:'shell06-native-demo',license:'SHELL06 NATIVE DEMO',licensor:'DEMO',royalty:5,trCommission:0,ydCommission:0,hologramCost:0,seasons:[],categories:[],opdStart:'2020-01-01',opdEnd:''};
 const changed=await(await api('/api/pricing-rules',{expectedRevision:current.revision,rules:[...current.rules,rule],categorySchemaVersion:1},'PUT')).json();
 await until(async()=>(await all(`state.storeRevisions.pricingRules>=${changed.revision}&&state.overrides.pricingRules.some(r=>r.id==='shell06-native-demo')`)).every(Boolean),'normal SSE state');
 record('normal-SSE-state',{revision:changed.revision,states:await all('({revision:state.storeRevisions.pricingRules,events:__probe.sse.filter(e=>e.area==="pricingRules")})')});
 phase='native-switch';const before=tabs().map(w=>w.id);
 next=await store.update('quotation');const switchedAt=Date.now();manager.activateTab(win.window.id,tabId(first));await delay(500);manager.activateTab(win.window.id,tabId(third));await until(()=>revisionsAt(next.entities.quotation.revision),'native activation catch-up without DOM visibility event',2500);record('native-activation-catchup',{delayMs:Date.now()-switchedAt,revision:next.entities.quotation.revision});
 assert.deepEqual(tabs().map(w=>w.id),before);record('active-hidden-switch',{sameWebContents:before,states:await all('({visibility:document.visibilityState,activity:__probe.activity})')});
 phase='slow';slow=true;maxActive=proxyActive;
 await wake(third);await until(()=>proxyActive>0,'slow response starts');const count=result.requests.filter(r=>r.phase===phase&&r.url==='/api/shared-revisions').length;
 await delay(8500);assert.equal(result.requests.filter(r=>r.phase===phase&&r.url==='/api/shared-revisions').length,count);assert.equal(maxActive,1);slow=false;await until(()=>proxyActive===0,'slow response finish');record('slow-single-flight',{delayMs:12000,maxActive,startsDuring8500ms:0});
 phase='offline';
 for(const wc of tabs()){await wc.debugger.sendCommand('Network.enable');await wc.debugger.sendCommand('Network.emulateNetworkConditions',{offline:true,latency:0,downloadThroughput:-1,uploadThroughput:-1});}
 await until(async()=>(await all('navigator.onLine===false')).every(Boolean),'native offline event');await delay(1000);const cut=result.requests.length;next=await store.update('quotation');await delay(8000);
 assert.equal(result.requests.slice(cut).filter(r=>r.url==='/api/shared-revisions').length,0);
 phase='online';for(const wc of tabs())await wc.debugger.sendCommand('Network.emulateNetworkConditions',{offline:false,latency:0,downloadThroughput:-1,uploadThroughput:-1});
 await until(()=>revisionsAt(next.entities.quotation.revision),'online catchup');await until(async()=>(await all('liveSyncConnected')).every(Boolean),'SSE reconnect');record('offline-online',{offlineMs:8000,revisionRequests:0,revision:next.entities.quotation.revision,events:await all('__probe.activity')});
 phase='handoff';const leaderId=result.requests.filter(r=>r.url==='/api/shared-revisions').at(-1).wc;const leader=tabs().find(w=>w.id===leaderId);assert.ok(leader);
 await manager.closeTab(tabId(leader));await until(()=>tabs().length===2,'leader closed');next=await store.update('quotation');await until(()=>revisionsAt(next.entities.quotation.revision),'handoff revision',90000);
 const handoff=result.requests.filter(r=>r.phase===phase);assert.ok(handoff.some(r=>r.url==='/api/live-events'&&r.wc!==leaderId));record('leader-close-handoff',{closed:leaderId,requests:handoff,revision:next.entities.quotation.revision});
 phase='reopen';const reopened=manager.openModule(win.window.id,'orders',{forceNew:true}).view.webContents;await ready(reopened);await until(()=>revisionsAt(next.entities.quotation.revision),'reopen baseline');next=await store.update('quotation');await wake(reopened);await until(()=>revisionsAt(next.entities.quotation.revision),'reopen change');record('reopen-catchup',{newWc:reopened.id,revision:next.entities.quotation.revision});
 phase='dirty';const cp=manager.openModule(win.window.id,'cp',{forceNew:true}).view.webContents;await ready(cp);await until(()=>js(cp,'Array.isArray(state.cp?.rows)&&state.cp.rows.length>0'),'CP rows');
 const dirty=await js(cp,"(()=>{const r=state.cp.rows[0];window.__cpBefore=state.cp;state.cpDirty.add(String(r.__id||r.id||'native-draft'));return {dirty:[...state.cpDirty],rows:state.cp.rows.length,guard:cpClientWorkInProgress()};})()");assert.equal(dirty.guard,true);
 manager.activateTab(win.window.id,tabId(reopened));manager.activateTab(win.window.id,tabId(cp));await js(cp,'liveSyncResyncAfterGap()');await delay(1500);
 assert.equal(await js(cp,'state.cp===window.__cpBefore&&state.cpDirty.size>0&&cpClientWorkInProgress()'),true);record('dirty-CP-catchup-preserved',{...dirty,note:'Real CP state/dirty guard retained across native switch and production gap resync; no draft written to server.'});
 await js(cp,'state.cpDirty.clear()');
 phase='context-isolation';const isolated=reopened;
 const original=await js(isolated,'JSON.parse(JSON.stringify(window.BL_USER_CONTEXT))');
 for(const [label,patch] of [['different-user',{id:'native-other-synthetic-user'}],['different-access',{iamRevision:987654}]]){
   await js(isolated,`window.BL_USER_CONTEXT={...${JSON.stringify(original)},...${JSON.stringify(patch)}};window.dispatchEvent(new Event('bl:user-access-applied'));__probe.revisions=[];`);
   await until(()=>js(isolated,'sharedRevisionSnapshot!==null'),'isolated baseline');
   // Deliberately addressed, synthetic BroadcastChannel marker: same origin,
   // wrong identity/access. The real SSE and HTTP remain the authenticated session.
   const marker=987654321;
   await js(cp,`(()=>{const c=new BroadcastChannel('buyerlog-live-sync:'+sharedRevisionContext);c.postMessage({type:'revisions',context:sharedRevisionContext,revisions:{revision:${marker},entities:{quotation:{revision:${marker}}}}});c.close();})()`);
   await delay(300);assert.equal(await js(isolated,`sharedRevisionSnapshot.revision===${marker}`),false);
   const locks=await js(cp,'navigator.locks.query()');assert.equal(locks.held.filter(l=>l.name.startsWith('buyerlog-live-sync-leader')).length,2);
   record(label+'-context-isolation',{heldLeaderLocks:locks.held.map(l=>l.name),markerRejected:true,note:'Renderer context protocol probe; not a second authenticated HTTP user or an IAM authorization test.'});
   await js(isolated,`window.BL_USER_CONTEXT=${JSON.stringify(original)};window.dispatchEvent(new Event('bl:user-access-applied'));`);await delay(500);
 }
 result.finalTabStates=await all('({wcTab:new URLSearchParams(location.search).get("workspaceTab"),connected:liveSyncConnected,probe:__probe})');
 fs.writeFileSync(path.join(out,'native-post-change.png'),(await cp.capturePage()).toPNG());
 result.status='PASS';save();console.log('NATIVE ACCEPTANCE PASS');
})().catch(e=>{result.status='FAIL';result.error=e.stack;save();console.error(e);process.exitCode=1;}).finally(async()=>{manager?.destroyAllWindows();server?.kill();proxy?.closeAllConnections();proxy?.close();setTimeout(()=>app.exit(process.exitCode||0),200);});
