'use strict';
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),net=require('node:net'),crypto=require('node:crypto');
const {spawn,spawnSync,execFileSync}=require('node:child_process'),assert=require('node:assert/strict');
const {chromium,_electron}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const app=path.resolve(__dirname,'../../../../resources/app'),out=__dirname;
const root=fs.mkdtempSync(path.join(os.tmpdir(),'buyerlog-shell05-'));
const delay=ms=>new Promise(r=>setTimeout(r,ms));
const env={...process.env,BUYER_LOG_CENTRAL_IAM_ENABLED:'0',BUYER_LOG_SERVER_DATA_ROOT:path.join(root,'data'),BUYER_LOG_AUTH_DATA_ROOT:path.join(root,'data'),BUYER_LOG_DATA_ROOT:path.join(root,'app'),BUYER_LOG_LOCAL_DATA_ROOT:path.join(root,'local'),BUYER_LOG_LOCAL_DB:path.join(root,'local/BuyerLogLocal.db'),BUYER_LOG_CONFIG_PATH:path.join(root,'config.json'),BUYER_LOG_TEMP_ROOT:path.join(root,'tmp')};
const baseline=process.argv.includes('--baseline');
const baselineSource=baseline?execFileSync('git',['show','511cb2fae629cd6e0c1ad31eb773775e5c95841d:resources/app/public/app-main.js'],{cwd:app,maxBuffer:8*1024*1024}):null;
let server,browser,electron,cookie='',base;
const report={synthetic:true,mode:baseline?'base-main':'post-change',node:process.version,platform:process.platform,sourceSha256:Object.fromEntries(['public/app-main.js','electron/workspace-manager.js'].map(p=>[p,crypto.createHash('sha256').update((baseline&&p==='public/app-main.js'?baselineSource:fs.readFileSync(path.join(app,p)))).digest('hex')])),cases:[]};
async function api(url,body){const r=await fetch(base+url,{method:body?'POST':'GET',headers:{cookie,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(60000)});assert.ok(r.ok,url+': '+r.status);return r;}
function probe(){
  window.__shell05={done:false,starts:[],gates:[],errors:[]};
  let guard;Object.defineProperty(window,'BLBootGuard',{configurable:true,get:()=>guard,set(value){guard=value;const ready=value.ready;value.ready=function(gate){window.__shell05.gates.push(gate);return ready.apply(this,arguments);};}});
  addEventListener('bl:background-warmup-done',()=>window.__shell05.done=true);
  addEventListener('bl:startup-progress',e=>{if(e.detail?.stage==='modules')window.__shell05.starts.push(e.detail.module);});
  addEventListener('error',e=>window.__shell05.errors.push(e.message));
  localStorage.setItem('bl.user.moderator.bl.releaseNotes.lastSeenStable.v1','99.0.0');
}
async function snapshot(page){return page.evaluate(()=>({active:currentActiveTab(),cp:state.cp?.rows.length??null,orders:state.orders?.rows.length??null,catalog:collectionCatalogsReady(state.collectionCatalogs),states:BLModulePreparation.snapshot(),probe:window.__shell05,dirty:[...state.cpDirty]}));}
async function openReady(page,label){
  await page.waitForSelector('[data-boot-continue]',{timeout:180000});
  const before=await page.evaluate(()=>({active:currentActiveTab(),ready:document.getElementById('blBootGuard')?.dataset.ready,probe:window.__shell05}));
  assert.equal(before.ready,'1',label+' primary ready');assert.deepEqual(before.probe.starts,[],label+' no warmup under curtain');
  await page.click('[data-boot-continue]');await page.waitForFunction(()=>!document.getElementById('blBootGuard'),null,{timeout:180000});
  await page.waitForFunction(()=>window.__shell05.done,null,{timeout:90000});assert.equal(await page.evaluate(()=>window.__shell05.gates.includes('modules')),true,label+' releases modules gate');return before;
}
(async()=>{
  const socket=net.createServer();await new Promise(r=>socket.listen(0,'127.0.0.1',r));const port=socket.address().port;await new Promise(r=>socket.close(r));base='http://127.0.0.1:'+port;
  const source=path.join(root,'source');assert.equal(spawnSync(process.execPath,[path.join(app,'scripts/generate-demo-data.js'),source,'--rows','20','--seed','7'],{cwd:app}).status,0);
  require(path.join(app,'scripts/lib/startup-benchmark')).initializeBenchmarkState(root);
  fs.writeFileSync(env.BUYER_LOG_CONFIG_PATH,JSON.stringify({port,host:'127.0.0.1',sourceFolder:source,updates:{enabled:false}}));
  const fd=fs.openSync(path.join(root,'server.log'),'a');server=spawn(process.execPath,['server/server.js'],{cwd:app,env,stdio:['ignore',fd,fd]});fs.closeSync(fd);
  let ready=false;for(let i=0;i<120;i++){try{await api('/api/status');ready=true;break;}catch{}await delay(250);}assert.ok(ready);
  const login=await api('/api/user-login',{userId:'moderator',password:'synthetic-shell05-only-123',newPassword:'synthetic-shell05-only-123'});cookie=login.headers.get('set-cookie').split(';')[0];
  await api('/api/refresh',{});for(let i=0;i<240;i++){const s=await(await api('/api/refresh-status')).json();if(!s.running){assert.equal(s.error,null);ready=true;break;}await delay(250);}
  console.log('Synthetic server refreshed');
  // Real Electron/WebContentsView + shipped manager and preload, no fake desktop flag.
  electron=await _electron.launch({executablePath:process.env.ELECTRON_PATH,args:['--no-sandbox',path.join(out,'electron-main.cjs')],env:{...process.env,DISPLAY:':95',XDG_CACHE_HOME:path.join(root,'cache'),SHELL05_PROFILE:path.join(root,'electron-profile'),SHELL05_ORIGIN:base,SHELL05_APP:app,SHELL05_COOKIE:cookie},timeout:60000});
  electron.context().setDefaultTimeout(30000);
  await electron.context().addInitScript(probe);
  if(baseline)await electron.context().route('**/app-main.js*',route=>route.fulfill({contentType:'application/javascript',body:baselineSource}));
  const requests=[];electron.context().on('request',r=>{if(r.url().startsWith(base+'/api/'))requests.push({url:new URL(r.url()).pathname,page:r.frame().url()});});
  await electron.evaluate(async()=>{while(!global.shell05Ready)await new Promise(r=>setTimeout(r,20));});
  report.electron=await electron.evaluate(()=>({...process.versions}));
  await electron.evaluate(()=>{global.host=global.workspace.createWindow({module:'orders'});});
  const page=await electron.waitForEvent('window',{predicate:p=>p.url().startsWith(base),timeout:60000});
  const before=await openReady(page,'one native orders');let snap=await snapshot(page);
  assert.equal(snap.cp,baseline?17:null);assert.equal(snap.orders,20);assert.deepEqual(snap.probe.starts,baseline?['cp']:[]);
  report.cases.push({name:'one-native-orders-cold',before,after:snap,requests:requests.splice(0)});console.log('One native tab: '+snap.probe.starts.length+' background module(s)');
  // Navigate through the real user button; the on-demand loader must still run.
  await page.locator('nav.tabs button[data-tab="cp"]').dispatchEvent('click');
  await page.waitForFunction(()=>state.cp?.rows.length>0&&document.querySelector('#cpTable tbody tr[data-id]'),null,{timeout:90000});
  const edit=await page.evaluate(()=>{const input=document.querySelector('#cpTable input.editCell[data-kind="suppfob"]');if(!input)throw Error('No authorized synthetic CP editor');const id=Number(input.dataset.id),key=input.dataset.key;input.value='12.34';input.dispatchEvent(new Event('change',{bubbles:true}));return {id,key,value:state.cp.rows.find(r=>r._id===id)[key]};});assert.equal(edit.value,12.34);
  const dirty=await snapshot(page);assert.equal(dirty.dirty.length,1);
  await page.locator('nav.tabs button[data-tab="orders"]').dispatchEvent('click');await page.waitForFunction(()=>state.orders?.rows.length===20,null,{timeout:90000});
  await page.locator('nav.tabs button[data-tab="cp"]').dispatchEvent('click');assert.deepEqual((await snapshot(page)).dirty,dirty.dirty);
  assert.equal(await page.evaluate(edit=>state.cp.rows.find(r=>r._id===edit.id)[edit.key],edit),edit.value);
  report.cases.push({name:'on-demand-user-switch-and-dirty-retention',after:await snapshot(page),requests:requests.splice(0)});
  // Leave the dirty renderer live while opening two more native views.
  await electron.evaluate(()=>{global.workspace.openModule(global.host.window.id,'orders');global.workspace.openModule(global.host.window.id,'koleksiyon');});
  await delay(1000);
  const pages=electron.windows().filter(p=>p.url().startsWith(base));assert.equal(pages.length,3);
  for(const p of pages.filter(p=>p!==page)){await electron.evaluate(({ },url)=>{const c=global.workspace.allTabContents().find(c=>c.getURL()===url),tab=global.workspace.tabForContents(c);global.workspace.activateTab(tab.windowId,tab.id);},p.url());await openReady(p,'additional native');}
  for(const p of pages){const s=await snapshot(p);const module=new URL(p.url()).searchParams.get('module');if(!baseline)assert.ok(s.probe.starts.every(m=>m===s.active));report.cases.push({name:'three-native-'+s.active,openingModule:module,after:s});}
  assert.deepEqual((await snapshot(page)).dirty,dirty.dirty);report.threeNativeRequests=requests.splice(0);
  console.log('Three actual native views, dirty CP retained');
  // Snapshot/cache reopening of an Orders native view.
  const orders=pages.find(p=>p!==page&&new URL(p.url()).searchParams.get('module')==='orders');await electron.evaluate(({},url)=>{const c=global.workspace.allTabContents().find(c=>c.getURL()===url),tab=global.workspace.tabForContents(c);global.workspace.activateTab(tab.windowId,tab.id);},orders.url());await orders.reload({waitUntil:'domcontentloaded'});const snapshotBefore=await openReady(orders,'native snapshot');snap=await snapshot(orders);assert.equal(snap.cp,baseline?17:null);assert.equal(snap.orders,20);
  report.cases.push({name:'native-orders-snapshot-reopen',before:snapshotBefore,after:snap,requests:requests.splice(0)});

  await orders.evaluate(()=>document.querySelectorAll('dialog[open]').forEach(d=>d.close()));if(!baseline)await orders.screenshot({path:path.join(app,'public/release-notes/next-assets/shell05-native-module-warmup-20261109.png')});
  // Actual Chromium is a separate browser-control case, never called native acceptance.
  browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox'],env:{...process.env,XDG_CACHE_HOME:path.join(root,'browser-cache')}});
  const ctx=await browser.newContext({viewport:{width:1440,height:900}});const split=cookie.indexOf('=');await ctx.addCookies([{name:cookie.slice(0,split),value:cookie.slice(split+1),url:base,httpOnly:true}]);await ctx.addInitScript(probe);
  const control=await ctx.newPage();await control.goto(base+'/?module=orders');await openReady(control,'browser control');snap=await snapshot(control);assert.ok(snap.cp>0);assert.equal(snap.orders,20);assert.equal(snap.catalog,true);report.cases.push({name:'chromium-browser-control',after:snap});
  report.status='passed';console.log('Chromium control: all authorized modules still prepare');
})().catch(error=>{report.status='failed';report.error=error.stack;console.error(error);process.exitCode=1;}).finally(async()=>{
  fs.writeFileSync(path.join(out,baseline?'baseline-acceptance.json':'acceptance.json'),JSON.stringify(report,null,2)+'\n');
  await browser?.close();if(electron){await electron.evaluate(()=>global.workspace?.destroyAllWindows()).catch(()=>{});await electron.close();}server?.kill('SIGTERM');
});
