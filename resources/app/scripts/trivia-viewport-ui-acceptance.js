'use strict';
// Actual Buyer Log with isolated demo storage. Optional baseline assets are read
// from git; all application code, DOM, styles and loading/ready ownership are real.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const {spawn,execFileSync}=require('node:child_process'),{chromium}=require('playwright');
const app=path.resolve(__dirname,'..'),repo=path.resolve(app,'../..');
const artifacts=process.env.BUYER_LOG_TRIVIA_ARTIFACTS||fs.mkdtempSync(path.join(os.tmpdir(),'buyerlog-trivia-'));
fs.mkdirSync(artifacts,{recursive:true});
const root=fs.mkdtempSync(path.join(artifacts,'runtime-')),port=Number(process.env.BUYER_LOG_TRIVIA_PORT||6498),base=`http://127.0.0.1:${port}`;
const env={...process.env,BUYER_LOG_CONFIG_PATH:path.join(root,'config.json'),BL_KEEP_ALIVE:'1'};
for(const [key,dir] of Object.entries({BUYER_LOG_DATA_ROOT:'app',BUYER_LOG_SERVER_DATA_ROOT:'server',BUYER_LOG_LOCAL_DATA_ROOT:'local',BUYER_LOG_TEMP_ROOT:'temp',BUYER_LOG_AUTH_DATA_ROOT:'server/auth'})){
  env[key]=path.join(root,dir);fs.mkdirSync(env[key],{recursive:true});
}
env.BL_DATA_DIR=env.BUYER_LOG_SERVER_DATA_ROOT;
fs.writeFileSync(env.BUYER_LOG_CONFIG_PATH,JSON.stringify({port,host:'127.0.0.1',centralIamEnabled:false,refreshWithExcel:false,updates:{enabled:false}}));
const baseRef=process.env.BUYER_LOG_TRIVIA_BASE_REF;
const assets=Object.fromEntries(['buyerlog-trivia.js','buyerlog-guide.css'].map(file=>[file,fs.readFileSync(path.join(app,'public',file),'utf8')]));
const baseline=baseRef?Object.fromEntries(['buyerlog-trivia.js','buyerlog-guide.css'].map(file=>[file,execFileSync('git',['show',`${baseRef}:resources/app/public/${file}`],{cwd:repo,encoding:'utf8'})])):null;
const log=fs.openSync(path.join(root,'server.log'),'a'),server=spawn(process.execPath,['server/server.js'],{cwd:app,env,stdio:['ignore',log,log]});
const results={baseRef,source:execFileSync('git',['rev-parse','HEAD'],{cwd:repo,encoding:'utf8'}).trim(),assetHashes:Object.fromEntries(Object.entries(assets).map(([file,body])=>[file,require('node:crypto').createHash('sha256').update(body).digest('hex')])),node:process.version,runs:[],matrix:[]};
let browser,page;
async function metrics(session){const r=await session.send('Performance.getMetrics');return Object.fromEntries(r.metrics.map(m=>[m.name,m.value]));}
async function createHold(page,tab='cp',height=430){
  await page.evaluate(({tab,height})=>{
    for(const h of BLTrivia._holds.values())h.close(true);
    const section=document.getElementById('view-'+tab);
    // Synthetic ready module sizes include the reported short-content case.
    section.style.height=height+'px';section.style.minHeight='0';
    section.innerHTML='<div class="uiState uiState--loading"><strong data-i18n-tr="Demo yükleme" data-i18n-en="Demo loading">Demo</strong></div>';
  },{tab,height});
  await page.clock.fastForward(1000);await page.clock.fastForward(3200);
  assert.equal(await page.locator('#view-'+tab+' .blTriviaPanel').count(),1,'delayed loading card mounted');
  await page.evaluate(tab=>document.querySelector('#view-'+tab+' .uiState--loading').remove(),tab);
  await page.clock.fastForward(400);await page.clock.fastForward(500);
  assert.equal(await page.locator('.blTriviaHold').count(),1,'explicit Continue remains after readiness');
}
async function geometry(page){return page.evaluate(()=>{
  const hold=document.querySelector('.blTriviaHold'),button=hold.querySelector('[data-hold-continue]'),slot=hold.querySelector('[data-hold-slot]');
  const b=button.getBoundingClientRect(),h=hold.getBoundingClientRect(),s=slot.getBoundingClientRect();
  const hit=document.elementFromPoint(b.x+b.width/2,b.y+b.height/2);
  return {visible:!hold.hidden,button:b.toJSON(),hold:h.toJSON(),slot:s.toJSON(),
    hit:hit===button||button.contains(hit),horizontalOverflow:slot.scrollWidth-slot.clientWidth,
    scrollable:slot.scrollHeight>slot.clientHeight,slotHeight:slot.clientHeight};
});}
async function closeHold(page,keyboard=false){
  if(keyboard){await page.locator('[data-hold-continue]').focus();await page.keyboard.press('Enter');}
  else await page.evaluate(()=>document.querySelector('[data-hold-continue]').click());
  await page.clock.runFor(1);
  assert.equal(await page.locator('.blTriviaHold').count(),0);
  assert.equal(await page.evaluate(()=>BLTrivia._holds.size),0,'hold ownership released');
}
(async()=>{
  console.log('Artifacts:',artifacts);
  let ready=false;for(let i=0;i<120;i++){try{if((await fetch(base+'/api/user-profiles')).ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,250));}assert.ok(ready,'server ready');
  const response=await fetch(base+'/api/user-login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({userId:'moderator',newPassword:'demo-trivia-123',password:'demo-trivia-123'})});
  assert.equal(response.status,200);const account=await response.json();
  browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH||'/usr/bin/chromium',args:['--no-sandbox']});
  const variants=process.env.BUYER_LOG_TRIVIA_VARIANTS?.split(',')||(baseline?['base','candidate','base','candidate','base','candidate']:['candidate']);
  for(const [runIndex,variant] of variants.entries()){
    const context=await browser.newContext({viewport:{width:1787,height:813},reducedMotion:'reduce'});
    if(baseline)await context.route(/\/(buyerlog-trivia\.js|buyerlog-guide\.css)(\?|$)/,route=>{const file=new URL(route.request().url()).pathname.slice(1);return route.fulfill({body:(variant==='base'?baseline:assets)[file],contentType:file.endsWith('.css')?'text/css':'application/javascript'});});
    await context.addInitScript(()=>{localStorage.setItem('bl.releaseNotes.lastSeenStable.v1','99.0.0');Math.random=()=>.25;});
    page=await context.newPage();await page.clock.install();const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.addInitScript(()=>{window.__triviaLongTasks=[];new PerformanceObserver(list=>{for(const e of list.getEntries())window.__triviaLongTasks.push(e.duration);}).observe({type:'longtask'});});
    await page.goto(base+'/select-user.html');await page.locator('#username').fill(account.user.username);await page.locator('#password').fill('demo-trivia-123');
    const start=performance.now();await page.evaluate(()=>document.getElementById('loginBtn').click());await page.waitForURL(base+'/',{waitUntil:'domcontentloaded'});await page.locator('[data-boot-continue]').waitFor({timeout:60000});
    const startupMs=performance.now()-start,startupGateMs=await page.evaluate(()=>BLPerf.snapshot().startupGateReadyMs?.lastMs);await page.locator('[data-boot-continue]').click();await page.waitForSelector('#blBootGuard',{state:'detached'});
    await page.evaluate(()=>switchTab('cp'));await page.waitForTimeout(1000);
    const session=await context.newCDPSession(page);await session.send('Performance.enable');
    await session.send('HeapProfiler.collectGarbage');
    const run={variant,startupMs,startupGateMs,cycles:[]};
    for(let cycle=0;cycle<5;cycle++){
      await page.evaluate(()=>window.__triviaLongTasks=[]);
      const before=await metrics(session);await createHold(page);
      const g=await geometry(page);
      if(variant==='candidate'){assert.ok(g.hit,'Continue hit target fully inside layer');assert.ok(g.button.bottom<=g.hold.bottom);}
      else if(cycle===0){assert.equal(g.hit,false,'baseline reproduces clipped Continue');}
      const clickStart=performance.now();await closeHold(page);const closeMs=performance.now()-clickStart;
      assert.ok(closeMs<=200,'Continue response <=200ms');
      const after=await metrics(session);
      await session.send('HeapProfiler.collectGarbage');
      const retained=await metrics(session),dom=await session.send('Memory.getDOMCounters');
      const longTasks=await page.evaluate(()=>window.__triviaLongTasks);
      run.cycles.push({cycle,closeMs,taskMs:(after.TaskDuration-before.TaskDuration)*1000,layoutMs:(after.LayoutDuration-before.LayoutDuration)*1000,heap:retained.JSHeapUsedSize,dom, longTasks,geometry:g});
    }
    if(variant==='candidate'&&runIndex===variants.lastIndexOf('candidate')&&process.env.BUYER_LOG_TRIVIA_MATRIX!=='off'){
      for(const tab of ['cp','orders','koleksiyon']){
        if(tab!=='cp'){await page.evaluate(tab=>switchTab(tab),tab);await page.clock.fastForward(1000);}
        for(const lang of ['tr','en']){
          await page.evaluate(lang=>applyLanguage(lang),lang);await createHold(page,tab,0);
          for(const theme of ['light','dark'])for(const scale of ['compact','standard','large','xl'])for(const viewport of [{width:1787,height:813},{width:960,height:480},{width:640,height:480}]){
            await page.setViewportSize(viewport);await page.evaluate(({theme,scale})=>Object.assign(document.documentElement.dataset,{theme,uiScale:scale}),{theme,scale});await page.clock.fastForward(350);
            const g=await geometry(page),label=`${tab}/${lang}/${theme}/${scale}/${viewport.width}x${viewport.height}`;
            assert.ok(g.visible&&g.hit,label+': Continue hit target');assert.ok(g.button.bottom<=g.hold.bottom&&g.button.top>=g.hold.top,label+': full button visible');
            assert.ok(g.slotHeight>0,label+': fact has a readable scroll area');assert.ok(g.horizontalOverflow<=1,label+': no clipped horizontal content');
            await page.evaluate(()=>{const s=document.querySelector('[data-hold-slot]');s.scrollTop=s.scrollHeight;});
            const still=await geometry(page);assert.ok(still.hit,label+': Continue survives scrolling');
            results.matrix.push({label,...g});
            if(tab==='cp'&&lang==='tr'&&theme==='light'&&scale==='standard'&&viewport.width===960){
              await page.evaluate(()=>document.querySelector('[data-hold-slot]').scrollTop=0);
              await page.screenshot({path:path.join(artifacts,'trivia-continue-viewport.png')});
            }
          }
          // Hidden tabs suspend the hold; revisiting restores the same card.
          await page.evaluate(tab=>document.getElementById('view-'+tab).style.display='none',tab);await page.clock.fastForward(350);assert.equal(await page.locator('.blTriviaHold').isVisible(),false);
          await page.evaluate(tab=>document.getElementById('view-'+tab).style.display='',tab);await page.clock.fastForward(350);assert.ok((await geometry(page)).hit);
          await closeHold(page,true);await page.setViewportSize({width:1787,height:813});
        }
      }
    }
    assert.deepEqual(errors,[],'browser errors');results.runs.push(run);await context.close();page=null;
    fs.writeFileSync(path.join(artifacts,'results.json'),JSON.stringify(results,null,2));
    console.log(variant,JSON.stringify({startupMs,cycles:run.cycles.map(({closeMs,taskMs,layoutMs})=>({closeMs,taskMs,layoutMs}))}));
  }
  console.log('PASS viewport geometry, scroll, pointer/keyboard Continue, hidden/revisit, 5-cycle cleanup; cases:',results.matrix.length);
})().catch(async e=>{console.error(e);process.exitCode=1;if(page)await page.screenshot({path:path.join(artifacts,'failure.png')}).catch(()=>{});}).finally(async()=>{
  fs.writeFileSync(path.join(artifacts,'results.json'),JSON.stringify(results,null,2));
  if(browser)await browser.close();if(server.exitCode===null)server.kill('SIGTERM');fs.closeSync(log);
});
