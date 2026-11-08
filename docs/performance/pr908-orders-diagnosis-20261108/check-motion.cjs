'use strict';
// Real-browser contract check only; calls the existing public Motion+ API.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),net=require('node:net'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {spawn,execFileSync}=require('node:child_process');
const {chromium}=require('/opt/codex/cua_node/lib/node_modules/playwright');
const repo=path.resolve(__dirname,'../../..'),app=path.join(repo,'resources/app');
const input=JSON.parse(fs.readFileSync(process.argv[2],'utf8')),out=path.resolve(process.argv[3]);fs.mkdirSync(out,{recursive:true});
const root=fs.mkdtempSync(path.join(os.tmpdir(),'buyerlog-pr908-motion-'));
assert.equal(input.synthetic,true);assert.equal(input.status,'passed');assert.equal(input.requestedRows,30000);
fs.cpSync(input.fixtureRoot,root,{recursive:true});
const env={...process.env,BUYER_LOG_CENTRAL_IAM_ENABLED:'0',BUYER_LOG_SERVER_DATA_ROOT:path.join(root,'data'),BUYER_LOG_AUTH_DATA_ROOT:path.join(root,'data'),BUYER_LOG_DATA_ROOT:path.join(root,'app'),BUYER_LOG_LOCAL_DATA_ROOT:path.join(root,'local'),BUYER_LOG_LOCAL_DB:path.join(root,'local/BuyerLogLocal.db'),BUYER_LOG_CONFIG_PATH:path.join(root,'config.json'),BUYER_LOG_TEMP_ROOT:path.join(root,'tmp')};
const sha=s=>crypto.createHash('sha256').update(s).digest('hex');
const save=()=>fs.writeFileSync(path.join(out,'motion.json'),JSON.stringify(report,null,2)+'\n');
const report={synthetic:true,status:'running',fixtureRoot:root,appTree:execFileSync('git',['rev-parse','HEAD:resources/app'],{cwd:repo,encoding:'utf8'}).trim(),runs:[],startedAt:new Date().toISOString()};
const {installProbe}=require(path.join(app,'scripts/lib/startup-benchmark'));
const delay=ms=>new Promise(r=>setTimeout(r,ms));let server,browser;
(async()=>{
 const socket=net.createServer();await new Promise(r=>socket.listen(0,'127.0.0.1',r));const port=socket.address().port;await new Promise(r=>socket.close(r));
 const config=JSON.parse(fs.readFileSync(env.BUYER_LOG_CONFIG_PATH,'utf8'));Object.assign(config,{port,host:'127.0.0.1',updates:{enabled:false}});fs.writeFileSync(env.BUYER_LOG_CONFIG_PATH,JSON.stringify(config));
 const base='http://127.0.0.1:'+port,log=fs.openSync(path.join(out,'server.log'),'a');server=spawn(process.execPath,['server/server.js'],{cwd:app,env,stdio:['ignore',log,log]});fs.closeSync(log);
 let ready=false;for(let i=0;i<120;i++){try{ready=(await fetch(base+'/api/status')).ok;if(ready)break;}catch{}await delay(250);}assert.ok(ready);
 const login=await fetch(base+'/api/user-login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({userId:'moderator',password:'synthetic-startup-only-123'})});assert.ok(login.ok);const cookie=login.headers.get('set-cookie').split(';')[0],split=cookie.indexOf('=');
 browser=await chromium.launch({headless:true,executablePath:'/usr/bin/chromium',args:['--no-sandbox']});
 for(const arm of ['A','B']){
  const context=await browser.newContext({viewport:{width:1600,height:1000},timezoneId:'Europe/Istanbul',reducedMotion:'no-preference'});
  try{
   await context.addCookies([{name:cookie.slice(0,split),value:cookie.slice(split+1),url:base,httpOnly:true}]);await context.route('https://**',r=>r.abort());
   await context.route(/\/api\/user-preferences(?:\/[^?]*)?(?:\?.*)?$/,route=>route.fulfill({contentType:'application/json',body:JSON.stringify(route.request().method()==='GET'?{entries:{},roleDefaults:{},deletions:{}}:{ok:true})}));
   await context.route(/\/(table-header-tracking|workspace-blur)\.js(?:\?|$)/,route=>{
    const name=new URL(route.request().url()).pathname.split('/').pop();const source=arm==='A'?execFileSync('git',['show','1796193f:resources/app/public/'+name],{cwd:repo}):fs.readFileSync(path.join(app,'public',name));
    return route.fulfill({contentType:'text/javascript',body:source});
   });
   await context.addInitScript(installProbe,{sampleWindowMs:10000});await context.addInitScript(()=>{for(const key of ['bl.releaseNotes.lastSeenStable.v1','bl.user.moderator.bl.releaseNotes.lastSeenStable.v1'])localStorage.setItem(key,'99.0.0');});
   const page=await context.newPage(),run={arm,errors:[],states:[]};report.runs.push(run);page.on('pageerror',e=>run.errors.push(e.message));
   await page.goto(base+'/?module=cp',{waitUntil:'domcontentloaded',timeout:120000});
   await page.waitForFunction(()=>Number.isFinite(window.__startupProbe?.startupReadyMs),null,{timeout:900000});await page.evaluate(()=>BLBootGuard.continue());
   await page.waitForFunction(()=>window.BLPerf?.timeline?.().some(e=>e.name==='BACKGROUND_WARMUP_DONE')&&state.cp?.rows.length===24982&&state.orders?.rows.length===30000,null,{timeout:900000});
   // Background-loaded Orders has not yet run its first visible PLM projection.
   // Establish the same fully rendered baseline on both arms; do not omit fields
   // or weaken the complete-row equality assertion below.
   await page.evaluate(()=>switchTab('orders'));
   await page.waitForFunction(()=>document.querySelector('#ordersTable tbody tr[data-id]')&&
    ['cp','orders'].every(key=>state[key].rows.every(row=>Object.hasOwn(row,'Artwork Detail')&&Object.hasOwn(row,'Fabric (PLM)'))),null,{timeout:900000});
   await page.evaluate(()=>switchTab('cp'));
   const rowsBefore=await page.evaluate(()=>({cp:JSON.stringify(state.cp.rows),orders:JSON.stringify(state.orders.rows)}));
   run.rowHashesBefore=Object.fromEntries(Object.entries(rowsBefore).map(([k,v])=>[k,sha(v)]));
   for(const module of ['cp','orders'])for(const render of ['gpu','software'])for(const reducedMotion of ['no-preference','reduce']){
    await page.emulateMedia({reducedMotion});
    await page.evaluate(({module,render})=>{document.activeElement?.blur();document.documentElement.dataset.blRender=render;switchTab(module);}, {module,render});
    await page.waitForFunction(module=>document.body.dataset.activeTab===module&&document.querySelector('#'+module+'Table tbody tr[data-id]'),module,{timeout:900000});
    const result=await page.evaluate(async({module,render,reducedMotion})=>{
     const view=document.querySelector('main > section.active'),table=document.getElementById(module+'Table'),seen=new Set(),counts={},violations=[];
     const observe=()=>{
      for(const animation of document.getAnimations()){
       const target=animation.effect?.target;
       if(target&&(target===table||target.contains(table)||table.tHead.contains(target)))violations.push({id:animation.id,target:target.tagName});
       if(animation.id==='bl-motion-table-row'&&target&&view.contains(target)){
        seen.add(animation);const owner=target.closest('table');if(!owner)violations.push({id:animation.id,target:target.tagName});
       }
      }
     };
     BLMotionPlus.setEnabled(true);BLMotionPlus.activate(true);observe();
     const started=performance.now();
     while(performance.now()-started<1100){await new Promise(r=>requestAnimationFrame(r));observe();}
     for(const animation of seen){const id=animation.effect.target.closest('table').id;counts[id]=(counts[id]||0)+1;}
     return {module,render,reducedMotion,enabled:BLMotionPlus.enabled(),counts,seen:seen.size,violations};
    },{module,render,reducedMotion});
    assert.deepEqual(result.violations,[],'Headers and table ancestors must stay still');
    assert.ok(Object.keys(result.counts).length<=2);for(const count of Object.values(result.counts))assert.ok(count<=6,'At most six unique row effects per table across all delayed retries');
    if(render==='gpu'&&reducedMotion==='no-preference')assert.ok(result.seen>0,'Normal GPU Motion+ must animate actual rows');else assert.equal(result.seen,0,'Reduced motion/software must keep rows still');
    run.states.push(result);save();
   }
   const after=await page.evaluate(()=>({cp:JSON.stringify(state.cp.rows),orders:JSON.stringify(state.orders.rows)}));
   for(const module of ['cp','orders'])assert.equal(sha(after[module]),sha(rowsBefore[module]),'Motion check must preserve full row data');
   run.rowHashes=Object.fromEntries(Object.entries(after).map(([k,v])=>[k,sha(v)]));
   assert.deepEqual(run.errors,[]);save();
  }finally{await context.close();}
 }
 report.status='passed';
})().catch(e=>{report.status='failed';report.error={message:e.message,stack:e.stack};process.exitCode=1;}).finally(async()=>{
 try{await browser?.close();}finally{if(server&&server.exitCode===null){const done=new Promise(r=>server.once('exit',r));server.kill('SIGTERM');await done;}report.finishedAt=new Date().toISOString();save();console.log(report.status,path.join(out,'motion.json'));}
});
