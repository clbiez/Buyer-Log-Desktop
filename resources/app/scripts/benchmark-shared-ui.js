'use strict';

// Reuses only the synthetic 30k startup fixture. No production configuration.
// node scripts/benchmark-shared-ui.js --startup /tmp/buyerlog-startup-*/startup.json
//   --baseline <commit> --out /tmp/shared-ui --variants before,after --runs 3
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),zlib=require('node:zlib'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {spawn,execFileSync}=require('node:child_process');
const {chromium}=require('playwright');
const {installProbe}=require('./lib/startup-benchmark');
const arg=(key,fallback)=>{const i=process.argv.indexOf(key);return i<0?fallback:process.argv[i+1];};
const app=path.resolve(__dirname,'..'),startup=JSON.parse(fs.readFileSync(arg('--startup'),'utf8'));
assert.equal(startup.synthetic,true);assert.equal(startup.status,'passed');assert.equal(startup.requestedRows,30000);
const root=fs.realpathSync(startup.fixtureRoot);
assert.equal(path.dirname(root),os.tmpdir());assert.ok(path.basename(root).startsWith('buyerlog-startup-'));
const baseline=arg('--baseline'),out=path.resolve(arg('--out','/tmp/shared-ui'));
assert.match(baseline,/^[a-f0-9]{7,40}$/);
fs.mkdirSync(out,{recursive:true});
const files=['i18n-runtime.js','table-header-tracking.js','model-image-cache.js','workspace-blur.js'];
const sources=Object.fromEntries(files.map(file=>[file,execFileSync('git',['show',`${baseline}:resources/app/public/${file}`],{cwd:app,encoding:'utf8'})]));
const candidate=Object.fromEntries(files.map(file=>[file,fs.readFileSync(path.join(app,'public',file),'utf8')]));
const config=JSON.parse(fs.readFileSync(path.join(root,'config.json'),'utf8')),base=`http://127.0.0.1:${config.port}`;
const env={...process.env,BUYER_LOG_CENTRAL_IAM_ENABLED:'0',BUYER_LOG_SERVER_DATA_ROOT:path.join(root,'data'),BUYER_LOG_AUTH_DATA_ROOT:path.join(root,'data'),BUYER_LOG_DATA_ROOT:path.join(root,'app'),BUYER_LOG_LOCAL_DATA_ROOT:path.join(root,'local'),BUYER_LOG_LOCAL_DB:path.join(root,'local/BuyerLogLocal.db'),BUYER_LOG_CONFIG_PATH:path.join(root,'config.json'),BUYER_LOG_TEMP_ROOT:path.join(root,'tmp')};
const log=fs.openSync(path.join(out,'server.log'),'a'),server=spawn(process.execPath,['server/server.js'],{cwd:app,env,stdio:['ignore',log,log]});fs.closeSync(log);
const delay=ms=>new Promise(r=>setTimeout(r,ms));
const write=(file,data)=>fs.writeFileSync(path.join(out,file),JSON.stringify(data,null,2)+'\n');
const zip=(file,data)=>fs.writeFileSync(path.join(out,file),zlib.gzipSync(JSON.stringify(data)));
let browser;
const hashes=map=>Object.fromEntries(Object.entries(map).map(([file,body])=>[file,crypto.createHash('sha256').update(body).digest('hex')]));
const report={baseline,startedAt:new Date().toISOString(),sourceHashes:{before:hashes(sources),after:hashes(candidate)},fixture:startup.fixture,expected:startup.expected,runs:[],platform:process.platform,cpu:os.cpus()[0]?.model,viewport:{width:1600,height:1000},samplingIntervalUs:500};
function profileSummary(profile){
  const nodes=new Map(profile.nodes.map(n=>[n.id,n])),parents=new Map();
  for(const n of profile.nodes)for(const id of n.children||[])parents.set(id,n.id);
  const own={},inclusive={},functions={};let total=0,active=0,time=profile.startTime;
  // CDP can return samples out of timestamp order (negative timeDeltas).
  const samples=(profile.samples||[]).map((id,i)=>({id,time:time+=profile.timeDeltas[i]})).sort((a,b)=>a.time-b.time);
  for(let i=0;i<samples.length;i++){
    const ms=Math.max(0,Math.min(profile.endTime,samples[i+1]?.time??profile.endTime)-samples[i].time)/1000;total+=ms;
    const id=samples[i].id,n=nodes.get(id),file=(n.callFrame.url||'').split('/').pop().split('?')[0];
    if(n.callFrame.functionName!=='(idle)')active+=ms;
    if(files.includes(file)){own[file]=(own[file]||0)+ms;const key=file+':'+(n.callFrame.functionName||'(anonymous)');functions[key]=(functions[key]||0)+ms;}
    const seen=new Set();
    for(let p=id;p;p=parents.get(p)){const f=(nodes.get(p).callFrame.url||'').split('/').pop().split('?')[0];if(files.includes(f)&&!seen.has(f)){inclusive[f]=(inclusive[f]||0)+ms;seen.add(f);}}
  }
  return {sampledMs:total,activeMs:active,selfMs:own,inclusiveMs:inclusive,functions};
}
async function main(){
  for(let i=0;;i++){try{if((await fetch(base+'/api/status')).ok)break;}catch{}if(i===120)throw Error('Server did not start');await delay(250);}
  const login=await fetch(base+'/api/user-login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({userId:'moderator',password:'synthetic-startup-only-123'})});assert.ok(login.ok);
  const cookie=login.headers.get('set-cookie').split(';')[0],split=cookie.indexOf('=');
  browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});report.chromium=browser.version();
  for(let repetition=1;repetition<=Number(arg('--runs',3));repetition++)for(const variant of arg('--variants','before,after').split(',')){
    const label=`${variant}-${repetition}`;console.log('START',label);
    const context=await browser.newContext({viewport:{width:1600,height:1000},reducedMotion:'no-preference'});
    try{
      await context.addCookies([{name:cookie.slice(0,split),value:cookie.slice(split+1),url:base,httpOnly:true}]);
      await context.route('https://**',r=>r.abort());
      // Each context starts with identical UI preferences. Visual checks must
      // not sync freeze/language settings into the next measured context.
      await context.route(/\/api\/user-preferences(?:\/[^?]*)?(?:\?.*)?$/,route=>route.fulfill({contentType:'application/json',body:JSON.stringify(route.request().method()==='GET'?{entries:{},roleDefaults:{},deletions:{}}:{ok:true})}));
      await context.route(/\/(i18n-runtime|table-header-tracking|model-image-cache|workspace-blur)\.js(?:\?|$)/,route=>{
        const file=new URL(route.request().url()).pathname.split('/').pop();
        return route.fulfill({contentType:'text/javascript',body:variant==='before'?sources[file]:candidate[file]});
      });
      await context.addInitScript(installProbe,{sampleWindowMs:10000});
      await context.addInitScript(()=>{
        for(const key of ['bl.releaseNotes.lastSeenStable.v1','bl.user.moderator.bl.releaseNotes.lastSeenStable.v1'])localStorage.setItem(key,'99.0.0');
      });
      const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.dismiss());
      await page.goto(base+'/?module=cp',{waitUntil:'domcontentloaded',timeout:120000});
      await page.waitForFunction(()=>Number.isFinite(window.__startupProbe?.startupReadyMs),null,{timeout:900000});
      await page.evaluate(()=>BLBootGuard.continue());
      await page.waitForFunction(rows=>Number.isFinite(window.__startupProbe?.startupCompleteMs)&&state.cp?.rows.length===rows&&document.querySelector('#cpTable tbody tr[data-id]'),startup.expected.rows.cp,{timeout:900000});
      await page.waitForFunction(()=>window.BLPerf?.timeline?.().some(m=>m.name==='BACKGROUND_WARMUP_DONE'),null,{timeout:900000});
      await page.mouse.move(1400,900);await delay(500);
      const run={variant,repetition,rows:await page.evaluate(()=>({cp:state.cp.rows.length,orders:state.orders.rows.length})),errors,phases:[]};report.runs.push(run);write('measurement.json',report);
      run.initialUI=await page.evaluate(()=>({lang:appLang,scale:document.documentElement.dataset.uiScale,freeze:{cp:getFreeze('cp'),orders:getFreeze('orders')}}));
      assert.equal(run.initialUI.lang,'tr');assert.equal(run.initialUI.scale,'standard');assert.equal(run.initialUI.freeze.cp.left,0);assert.equal(run.initialUI.freeze.orders.left,0);
      if(process.argv.includes('--checks-only')){
        run.acceptance=await require('./lib/shared-ui-acceptance')(page,out,label);assert.deepEqual(errors,[]);write('measurement.json',report);console.log('CHECKED',label);continue;
      }
      const cdp=await context.newCDPSession(page);
      await cdp.send('Profiler.enable');await cdp.send('Profiler.setSamplingInterval',{interval:500});
      await cdp.send('Tracing.start',{categories:'devtools.timeline,disabled-by-default-devtools.timeline,blink.user_timing',transferMode:'ReturnAsStream'});
      async function phase(name,action){
        console.log(label,name);await page.evaluate(name=>performance.mark('shared-ui:'+name+':start'),name);
        await cdp.send('Profiler.start');const started=performance.now();await action();
        const {profile}=await cdp.send('Profiler.stop');
        run.phases.push({name,elapsedMs:performance.now()-started,...profileSummary(profile)});zip(`${label}-${name}.cpuprofile.gz`,profile);
        await page.evaluate(name=>performance.mark('shared-ui:'+name+':end'),name);write('measurement.json',report);
      }
      async function scroll(module){
        await page.evaluate(async module=>{
          const wrap=document.getElementById(module+'Table').closest('.tablewrap');
          window.__scrollFrames=[];let last=performance.now();
          for(let i=0;i<70;i++)await new Promise(resolve=>requestAnimationFrame(now=>{
            window.__scrollFrames.push(now-last);last=now;wrap.scrollLeft=i<35?i*70:(69-i)*70;wrap.scrollTop=i<35?i*30:(69-i)*30;resolve();
          }));
        },module);
      }
      for(const module of ['cp','orders']){
        if(module==='orders')await phase('switch-orders',async()=>{
          await page.evaluate(()=>switchTab('orders'));
          await page.waitForFunction(()=>document.body.dataset.activeTab==='orders'&&state.orders?.rows.length===30000&&document.querySelector('#ordersTable tbody tr[data-id]'),null,{timeout:180000});await delay(1000);
        });
        await phase(module+'-scroll',()=>scroll(module));
        run.phases.at(-1).frameIntervalsMs=await page.evaluate(()=>window.__scrollFrames);
        await phase(module+'-modal',async()=>{
          await page.evaluate(module=>openNotesEditor(state[module].rows[0]._id,'Notes'),module);await page.locator('#_notesEditorModal').waitFor({state:'visible'});await delay(300);
          await page.keyboard.press('Escape');await delay(300);
        });
      }
      await phase('switch-cp',async()=>{await page.evaluate(()=>switchTab('cp'));await delay(1000);});
      const done=new Promise(resolve=>cdp.once('Tracing.tracingComplete',resolve));await cdp.send('Tracing.end');
      const {stream}=await done;let trace='';
      for(;;){const chunk=await cdp.send('IO.read',{handle:stream});trace+=chunk.base64Encoded?Buffer.from(chunk.data,'base64').toString():chunk.data;if(chunk.eof)break;}
      await cdp.send('IO.close',{handle:stream});const events=JSON.parse(trace);zip(label+'-trace.json.gz',events);
      const main=events.traceEvents.find(e=>e.name==='thread_name'&&e.args.name==='CrRendererMain');
      const timeline=events.traceEvents.filter(e=>e.tid===main?.tid&&e.pid===main?.pid&&e.ph==='X');
      function summarizeTimeline(entries){return Object.fromEntries(['Layout','UpdateLayoutTree','FunctionCall','FireAnimationFrame','RunMicrotasks'].map(name=>{const es=entries.filter(e=>e.name===name);return [name,{count:es.length,ms:es.reduce((s,e)=>s+(e.dur||0)/1000,0)}];}));}
      run.timeline=summarizeTimeline(timeline);
      for(const p of run.phases){
        const start=events.traceEvents.find(e=>e.name===`shared-ui:${p.name}:start`).ts,end=events.traceEvents.find(e=>e.name===`shared-ui:${p.name}:end`).ts;
        p.timeline=summarizeTimeline(timeline.filter(e=>e.ts>=start&&e.ts<end));
      }
      run.images=await page.locator('#cpTable img[data-src],#ordersTable img[data-src]').evaluateAll(es=>({count:es.length,sources:[...new Set(es.map(e=>e.dataset.src))].slice(0,5),dimensions:es.filter(e=>e.naturalWidth).map(e=>[e.naturalWidth,e.naturalHeight]).slice(0,5)}));
      await page.screenshot({path:path.join(out,label+'.png')});assert.deepEqual(errors,[]);write('measurement.json',report);
      console.log('DONE',label,JSON.stringify(run.timeline));
      if(process.argv.includes('--visual-checks')&&((variant==='before'&&repetition===1)||(variant==='after'&&repetition===Number(arg('--runs',3))))){
        run.acceptance=await require('./lib/shared-ui-acceptance')(page,out,label);assert.deepEqual(errors,[]);write('measurement.json',report);console.log('CHECKED',label);
      }
    }finally{await context.close();}
  }
}
main().catch(error=>{report.error=error.stack;write('measurement.json',report);console.error(error);process.exitCode=1;}).finally(async()=>{
  await browser?.close();if(server.exitCode===null){const done=new Promise(r=>server.once('exit',r));server.kill('SIGTERM');const timer=setTimeout(()=>server.kill('SIGKILL'),5000);await done;clearTimeout(timer);}
  report.finishedAt=new Date().toISOString();write('measurement.json',report);
});
