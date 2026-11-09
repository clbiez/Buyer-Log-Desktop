'use strict';
// Run under flock /tmp/buyerlog-performance-measurement.lock. Real app/server;
// baseline differs only by the complete Main app-main.js served to the browser.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),net=require('node:net'),assert=require('node:assert/strict');
const {spawn,execFileSync}=require('node:child_process'),{chromium}=require('playwright');
const repo=path.resolve(__dirname,'../../../..'),app=path.join(repo,'resources/app'),out=__dirname;
const root=fs.mkdtempSync(path.join(os.tmpdir(),'buyerlog-shell06-')),baseSha='511cb2fae629cd6e0c1ad31eb773775e5c95841d';
const env={...process.env,BUYER_LOG_CENTRAL_IAM_ENABLED:'0',BUYER_LOG_CONFIG_PATH:path.join(root,'config.json')};
for(const [key,dir] of Object.entries({BUYER_LOG_DATA_ROOT:'app',BUYER_LOG_SERVER_DATA_ROOT:'server',BUYER_LOG_LOCAL_DATA_ROOT:'local',BUYER_LOG_TEMP_ROOT:'temp'})){env[key]=path.join(root,dir);fs.mkdirSync(env[key],{recursive:true});}
env.BUYER_LOG_AUTH_DATA_ROOT=env.BUYER_LOG_SERVER_DATA_ROOT;env.BL_DATA_DIR=env.BUYER_LOG_SERVER_DATA_ROOT;env.BUYER_LOG_LOCAL_DB=path.join(root,'local/BuyerLogLocal.db');
const delay=ms=>new Promise(r=>setTimeout(r,ms)),results={baseSha,node:process.version,platform:process.platform,synthetic:true,nativeElectron:'NOT VERIFIED',scenarios:[]};
let server,browser,base,cookie,context;
async function api(url,body,method){const r=await fetch(base+url,{method:method||(body?'POST':'GET'),signal:AbortSignal.timeout(60000),headers:{cookie:cookie||'','Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});assert.ok(r.ok,url+': '+r.status+' '+await r.clone().text());return r;}
async function until(fn,label,timeout=45000){const end=Date.now()+timeout;while(Date.now()<end){if(await fn())return;await delay(150);}throw Error('Timed out: '+label);}
function save(){fs.writeFileSync(path.join(out,'acceptance.json'),JSON.stringify(results,null,2)+'\n');}
function record(name,details){results.scenarios.push({name,...details});save();console.log(name,JSON.stringify(details));}
async function createContext(baseline=false){
  const ctx=await browser.newContext({viewport:{width:1440,height:900},reducedMotion:'reduce'});
  const split=cookie.indexOf('=');await ctx.addCookies([{name:cookie.slice(0,split),value:cookie.slice(split+1),url:base,httpOnly:true}]);
  await ctx.addInitScript(()=>{
    for(const key of ['bl.releaseNotes.lastSeenStable.v1','bl.user.moderator.bl.releaseNotes.lastSeenStable.v1'])localStorage.setItem(key,'99.0.0');
    window.__revisions=[];window.addEventListener('bl-shared-revision',e=>window.__revisions.push({at:Date.now(),...e.detail}));
    window.__sse=[];const ES=window.EventSource;window.EventSource=class extends ES{constructor(url,options){super(url,options);this.addEventListener('message',e=>window.__sse.push(JSON.parse(e.data)));}};
  });
  await ctx.route('https://**',r=>r.abort());
  if(baseline){const text=execFileSync('git',['show',baseSha+':resources/app/public/app-main.js'],{cwd:repo,encoding:'utf8',maxBuffer:15e6});await ctx.route('**/app-main.js*',r=>r.fulfill({contentType:'application/javascript',body:text}));}
  return ctx;
}
async function openTabs(ctx,count){return Promise.all(Array.from({length:count},async(_,id)=>{
  const p=await ctx.newPage();p._probeId=id;p.on('dialog',d=>d.dismiss());p.on('pageerror',e=>{(results.pageErrors||=[]).push(e.message);});
  await p.goto(base+'/?module=orders',{waitUntil:'domcontentloaded',timeout:90000});
  await p.waitForFunction(()=>typeof initLiveSync==='function'&&window.BL_USER_CONTEXT?.id,null,{timeout:90000});
  const proceed=p.locator('[data-boot-continue]');await proceed.waitFor({state:'visible',timeout:90000});await proceed.click();
  await p.waitForFunction(()=>!document.getElementById('blBootGuard'),null,{timeout:30000});return p;
}));}
async function revisionAt(p,n){return p.evaluate(n=>window.__revisions.some(e=>e.revisions.entities.quotation?.revision>=n),n);}
(async()=>{
  const socket=net.createServer();await new Promise(r=>socket.listen(0,'127.0.0.1',r));const port=socket.address().port;await new Promise(r=>socket.close(r));base='http://127.0.0.1:'+port;
  const source=path.join(root,'source');execFileSync(process.execPath,[path.join(app,'scripts/generate-demo-data.js'),source,'--rows','20','--seed','7'],{cwd:app});
  fs.writeFileSync(env.BUYER_LOG_CONFIG_PATH,JSON.stringify({port,host:'127.0.0.1',sourceFolder:source,updates:{enabled:false}}));
  const log=fs.openSync(path.join(out,'server.log'),'w');server=spawn(process.execPath,['server/server.js'],{cwd:app,env,stdio:['ignore',log,log]});fs.closeSync(log);
  await until(async()=>{try{return (await fetch(base+'/api/status')).ok;}catch{return false;}},'server ready');
  const login=await api('/api/user-login',{userId:'moderator',newPassword:'shell06-demo-only-123',password:'shell06-demo-only-123'});cookie=login.headers.get('set-cookie').split(';')[0];
  await api('/api/refresh',{});await until(async()=>!(await(await api('/api/refresh-status')).json()).running,'demo refresh',90000);
  const {SharedRevisionStore}=require(path.join(app,'server/lib/shared-revision-store'));
  const store=new SharedRevisionStore(path.join(root,'local/shared-data'));await store.update('quotation');
  browser=await chromium.launch({headless:true,executablePath:'/usr/bin/chromium',args:['--no-sandbox','--disable-background-timer-throttling']});results.browser=browser.version();
  for(const baseline of [true,false]){
    context=await createContext(baseline);const pages=await openTabs(context,3),requests=[];
    context.on('request',r=>{if(r.url().includes('/api/shared-revisions'))requests.push({page:r.frame().page()._probeId,at:Date.now()});});
    const start=Date.now();await delay(21000);
    record(baseline?'baseline-three-tabs':'shared-three-tabs',{durationMs:Date.now()-start,requests:requests.map(r=>({...r,offsetMs:r.at-start})),count:requests.length,requestingTabs:[...new Set(requests.map(r=>r.page))]});
    assert.equal(new Set(requests.map(r=>r.page)).size,baseline?3:1);
    if(baseline){await context.close();continue;}
    const baselineCount=results.scenarios.find(s=>s.name==='baseline-three-tabs').count;assert.ok(requests.length<=Math.ceil(baselineCount/3)+1);
    let leader=pages.find(p=>p._probeId===requests.at(-1).page);
    let next=await store.update('quotation');await until(async()=>(await Promise.all(pages.map(p=>revisionAt(p,next.entities.quotation.revision)))).every(Boolean),'revision fanout');
    record('revision-fanout',{revision:next.entities.quotation.revision,received:await Promise.all(pages.map(p=>p.evaluate(()=>__revisions.at(-1))))});
    const cut=requests.length;await leader.close();const followers=pages.filter(p=>p!==leader);
    next=await store.update('quotation');await until(async()=>(await Promise.all(followers.map(p=>revisionAt(p,next.entities.quotation.revision)))).every(Boolean),'handoff catch-up');
    leader=followers.find(p=>p._probeId===requests.at(-1).page);
    record('leader-close-handoff',{newLeader:leader._probeId,requestsAfterClose:requests.slice(cut),revision:next.entities.quotation.revision});
    // Delay a real HTTP response over one polling interval, without replacing its body.
    let slowStarts=0,active=0,maxActive=0,slowEnabled=true;
    await context.route('**/api/shared-revisions*',async route=>{slowStarts++;active++;maxActive=Math.max(maxActive,active);try{const response=await route.fetch();if(slowEnabled)await delay(12000);await route.fulfill({response});}finally{active--;}});
    await until(()=>slowStarts>0,'slow poll start');const slowCount=slowStarts;await delay(8500);assert.equal(slowStarts,slowCount);assert.equal(maxActive,1);slowEnabled=false;
    await until(()=>active===0,'slow poll finish');record('slow-request',{delayMs:12000,startsDuringFirst8500ms:slowStarts-slowCount,maxActive});await context.unroute('**/api/shared-revisions*');
    await context.setOffline(true);await delay(1000);const offlineStart=requests.length;next=await store.update('quotation');await delay(8000);const offlineCount=requests.length-offlineStart;
    await context.setOffline(false);await until(async()=>(await Promise.all(followers.map(p=>revisionAt(p,next.entities.quotation.revision)))).every(Boolean),'online revision catch-up',60000);
    await until(async()=>(await Promise.all(followers.map(p=>p.evaluate(()=>liveSyncConnected)))).every(Boolean),'SSE reconnected',60000);
    record('offline-online',{offlineMs:8000,offlineRevisionRequests:offlineCount,recoveredRevision:next.entities.quotation.revision});assert.equal(offlineCount,0);
    // Make one real API mutation and verify existing SSE updates actual app state.
    const current=await(await api('/api/pricing-rules')).json();const rule={id:'shell06-demo',license:'SHELL06 DEMO',licensor:'DEMO',royalty:5,trCommission:0,ydCommission:0,hologramCost:0,seasons:[],categories:[],opdStart:'2020-01-01',opdEnd:''};
    const changed=await(await api('/api/pricing-rules',{expectedRevision:current.revision,rules:[...current.rules,rule],categorySchemaVersion:1},'PUT')).json();
    await until(async()=>(await Promise.all(followers.map(p=>p.evaluate(rev=>state.storeRevisions.pricingRules>=rev&&state.overrides.pricingRules.some(r=>r.id==='shell06-demo'),changed.revision)))).every(Boolean),'normal SSE pricing state');
    record('normal-SSE',{serverRevision:changed.revision,tabState:await Promise.all(followers.map(p=>p.evaluate(()=>({revision:state.storeRevisions.pricingRules,connected:liveSyncConnected,rules:state.overrides.pricingRules.map(r=>r.id)})))),leaderSSE:await leader.evaluate(()=>__sse.filter(e=>e.area==='pricingRules'))});
    // One 503 exercises HTTP failure/backoff followed by the real endpoint.
    const errors=[];await context.route('**/api/shared-revisions*',async route=>{errors.push(Date.now());if(errors.length===1)await route.fulfill({status:503,body:'synthetic offline service'});else await route.continue();});
    await until(()=>errors.length>=2,'503 retry',45000);assert.ok(errors[1]-errors[0]>=13900);record('HTTP-error-backoff',{statuses:[503,200],retryDelayMs:errors[1]-errors[0]});await context.unroute('**/api/shared-revisions*');
    const screenshot=path.join(app,'public/release-notes/next-assets/shell06-shared-revisions-20261109.png');await followers[0].screenshot({path:screenshot});record('post-change-screenshot',{path:path.relative(repo,screenshot),width:1440,height:900,note:'Actual synthetic Orders screen; polling and SSE behavior proven by request/event logs, not PNG.'});
    await context.close();context=null;
  }
  results.status='PASS';save();
})().catch(e=>{results.status='FAIL';results.error=e.stack;save();console.error(e);process.exitCode=1;}).finally(async()=>{await context?.close().catch(()=>{});await browser?.close();server?.kill();console.log('Synthetic runtime directory:',root);});
