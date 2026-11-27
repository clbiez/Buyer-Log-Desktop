'use strict';
// O3 ölçüm aracı (repo dışı). Sentetik 30k fixture, gerçek server.js, Playwright Chromium.
const fs=require('fs'),os=require('os'),path=require('path'),net=require('net'),crypto=require('crypto');
const {spawn,spawnSync}=require('child_process');
const {chromium}=require('playwright');
const delay=ms=>new Promise(r=>setTimeout(r,ms));
function cpuMs(pid){try{const st=fs.readFileSync(`/proc/${pid}/stat`,'utf8');const f=st.slice(st.lastIndexOf(')')+2).split(' ');return (Number(f[11])+Number(f[12]))*10;}catch(_){return null;}}
function ensureSource(APP,rows,dir){
  if(fs.existsSync(path.join(dir,'ASAS - Demo.xlsx')))return dir;fs.mkdirSync(dir,{recursive:true});
  const g=spawnSync(process.execPath,[path.join(APP,'scripts/generate-demo-data.js'),dir,'--rows',String(rows),'--seed','7'],{cwd:APP,encoding:'utf8'});
  if(g.status!==0)throw Error(g.stderr||'gen failed');return dir;}
async function createApp({APP,source,env:extra={},label}){
  const {initializeBenchmarkState,requestJson,compactRefreshStatus}=require(path.join(APP,'scripts/lib/startup-benchmark'));
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'buyerlog-startup-o3-'));
  const env={...process.env,...extra,BUYER_LOG_CENTRAL_IAM_ENABLED:'0',BUYER_LOG_SERVER_DATA_ROOT:path.join(root,'data'),BUYER_LOG_AUTH_DATA_ROOT:path.join(root,'data'),
    BUYER_LOG_DATA_ROOT:path.join(root,'app'),BUYER_LOG_LOCAL_DATA_ROOT:path.join(root,'local'),BUYER_LOG_LOCAL_DB:path.join(root,'local','BuyerLogLocal.db'),
    BUYER_LOG_CONFIG_PATH:path.join(root,'config.json'),BUYER_LOG_TEMP_ROOT:path.join(root,'tmp')};
  fs.cpSync(source,path.join(root,'source'),{recursive:true});initializeBenchmarkState(root);
  const s=net.createServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));const port=s.address().port;await new Promise(r=>s.close(r));
  const base='http://127.0.0.1:'+port;fs.writeFileSync(env.BUYER_LOG_CONFIG_PATH,JSON.stringify({port,sourceFolder:path.join(root,'source'),host:'127.0.0.1'}));
  const app={root,base,env,label,server:null,cookie:'',logFile:path.join(root,'server.log')};
  app.api=(u,init={})=>requestJson(base+u,{...init,headers:{cookie:app.cookie,'Content-Type':'application/json',...init.headers}});
  app.start=async()=>{const fd=fs.openSync(app.logFile,'a');app.server=spawn(process.execPath,[path.join(APP,'server/server.js')],{cwd:APP,env,stdio:['ignore',fd,fd]});fs.closeSync(fd);
    const t=Date.now();for(let i=0;i<240;i++){if(app.server.exitCode!==null)throw Error('exit '+app.server.exitCode);try{await app.api('/api/status');return Date.now()-t;}catch(_){await delay(250);}}throw Error('start timeout');};
  app.stop=async(sig='SIGTERM')=>{if(!app.server||app.server.exitCode!==null)return;const d=new Promise(r=>app.server.once('exit',r));app.server.kill(sig);await Promise.race([d,delay(10000)]);if(app.server.exitCode===null){app.server.kill('SIGKILL');await d;}};
  app.login=async()=>{const p='synthetic-startup-only-123';const r=await fetch(base+'/api/user-login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({userId:'moderator',password:p,newPassword:p})});if(!r.ok)throw Error('login '+r.status);app.cookie=String(r.headers.get('set-cookie')||'').split(';')[0];};
  app.refresh=async()=>{await app.api('/api/refresh',{method:'POST',body:'{}'});for(let i=0;i<1200;i++){const st=compactRefreshStatus(await app.api('/api/refresh-status'));if(!st.running){if(st.error)throw Error(JSON.stringify(st.error));return;}await delay(500);}throw Error('refresh timeout');};
  app.cpu=()=>cpuMs(app.server.pid);
  app.logOffset=()=>{try{return fs.statSync(app.logFile).size;}catch(_){return 0;}};
  app.compactionsSince=off=>{let t='';try{const b=fs.readFileSync(app.logFile);t=b.subarray(off).toString('utf8');}catch(_){}
    const out=[];for(const m of t.matchAll(/patch-log compact reason=(\w+) entries=(\d+) steps=(\d+) bytes=(\d+) ms=(\d+)/g))out.push({reason:m[1],entries:+m[2],steps:+m[3],ms:+m[5]});
    return {compactions:out,appends:(t.match(/patch-log append/g)||[]).length,discarded:(t.match(/patch-log discarded/g)||[]).length};};
  return app;}
async function boot(app){await app.start();await app.login();await app.refresh();await app.stop();await app.start();await app.login();}
async function newBrowser(app){const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
  const context=await browser.newContext({viewport:{width:1600,height:1000}});const i=app.cookie.indexOf('=');
  await context.addCookies([{name:app.cookie.slice(0,i),value:app.cookie.slice(i+1),url:app.base,httpOnly:true}]);return {browser,context};}
// Sayfa başına ağ sayacı (CDP: encodedDataLength = aktarılan bayt).
async function trackPage(context,page){const cdp=await context.newCDPSession(page);await cdp.send('Network.enable');const reqs=new Map();const log=[];
  cdp.on('Network.requestWillBeSent',e=>{const u=new URL(e.request.url);if(u.pathname.startsWith('/api/'))reqs.set(e.requestId,{path:u.pathname,method:e.request.method,t0:Date.now()});});
  cdp.on('Network.loadingFinished',e=>{const r=reqs.get(e.requestId);if(r){r.bytes=e.encodedDataLength;r.ms=Date.now()-r.t0;log.push(r);reqs.delete(e.requestId);}});
  return {log,mark:()=>log.length,since:i=>summarize(log.slice(i))};}
function cat(p){if(p.startsWith('/api/page-projection/'))return 'page-projection:'+p.split('/').pop();if(p.startsWith('/api/read-model/'))return 'read-model:'+p.slice(16);if(p==='/api/data'||p.startsWith('/api/data/'))return 'data:'+p.slice(9);if(p.startsWith('/api/overrides'))return 'save:'+p.slice(15);return null;}
function summarize(list){const out={};let bytes=0;for(const r of list){const c=cat(r.path);bytes+=r.bytes||0;if(!c)continue;const o=out[c]||(out[c]={n:0,bytes:0,maxMs:0});o.n++;o.bytes+=r.bytes||0;o.maxMs=Math.max(o.maxMs,r.ms||0);}return {byKind:out,totalApiBytes:bytes,apiRequests:list.length};}
async function openModule(app,context,module,{continueBoot=true}={}){const page=await context.newPage();const net=await trackPage(context,page);const t=Date.now();
  page.on('pageerror',e=>(page.__errors||(page.__errors=[])).push(e.message));
  await page.goto(app.base+'/?module='+module,{waitUntil:'domcontentloaded',timeout:180000});
  if(continueBoot){await page.waitForFunction(()=>window.BLBootGuard!=null,null,{timeout:180000}).catch(()=>{});await page.evaluate(()=>{try{window.BLBootGuard?.continue?.({intentAtMs:performance.now()});}catch(_){}}).catch(()=>{});}
  await waitRows(page,module);return {page,net,waitMs:Date.now()-t};}
async function waitRows(page,module,timeout=240000){const sel=module==='orders'?'#ordersTable tbody tr[data-id]':'#cpTable tbody tr[data-id]';
  await page.waitForFunction(s=>{const el=document.querySelector(s);return el&&el.offsetParent!==null;},sel,{timeout,polling:50});}
module.exports={delay,ensureSource,createApp,boot,newBrowser,trackPage,openModule,waitRows,summarize};
