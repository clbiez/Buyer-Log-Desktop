'use strict';
/* D1 ölçümü — Siparişler filtre/sıralama/arama değişimi → satırlar görünür (#1071 / #1076).
 * Çalışma zamanında yüklenmez; yalnız geliştirme ölçümüdür (bench-query.js gibi).
 *
 *   node server/lib/read-model/orders-bench.js [--rows 30000] [--samples 24] [--source-fixture DIR]
 *        [--screenshots DIR] [--out FILE]
 *
 * WS0 (#1072) koşucusunun kurduğu ortamın aynısı: sentetik demo verisi (seed 7),
 * yalıtılmış veri kökü, gerçek server.js, kaynak yenileme + yeniden başlatma,
 * formdan giriş, başsız Chromium. Açılış sonrası hazırlık (BACKGROUND_WARMUP_DONE)
 * bittikten sonra aynı sayfada iki yol ölçülür:
 *   legacy    — anahtar kapalı: renderOrdersNow tam satırlarla (ana iş parçacığı)
 *   readModel — anahtar açık: /api/read-model/orders/query ilk pencere → çizim
 * Her örnek farklı bir filtre birleşimidir (ülke × sezon çipi × sıralama × arama):
 * sunucu sonuç önbelleği isabet etmez. Ölçülen: tetikleyici olay → 'bl:orders-rows-visible'
 * + bir kare (requestAnimationFrame). Eski yol için olay eşzamanlı çizimin sonunda gelir.
 */
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {spawn}=require('node:child_process');
const APP_ROOT=path.resolve(__dirname,'..','..','..');
const {prepareSource,removeTemp,tempDir}=require(path.join(APP_ROOT,'scripts','lib','erp-readmodel-run'));
const {requestJson,initializeBenchmarkState,compactRefreshStatus,readRendererMetrics}=require(path.join(APP_ROOT,'scripts','lib','startup-benchmark'));
const P=require(path.join(APP_ROOT,'scripts','lib','erp-readmodel-probe'));
const PASSWORD='synthetic-startup-only-123';
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));

function parseArgs(argv){
  const value=(name,fallback)=>{const i=argv.indexOf(name);return i<0?fallback:argv[i+1];};
  return {rows:Number(value('--rows',30000)),samples:Number(value('--samples',24)),sourceFixture:value('--source-fixture',''),
    screenshots:value('--screenshots',''),out:value('--out',''),keepFixture:argv.includes('--keep-fixture')};
}
function percentile(values,p){
  const sorted=[...values].sort((a,b)=>a-b);if(!sorted.length)return null;
  return sorted[Math.min(sorted.length-1,Math.max(0,Math.ceil(p/100*sorted.length)-1))];
}
async function freePort(){
  const net=require('node:net'),socket=net.createServer();
  await new Promise(resolve=>socket.listen(0,'127.0.0.1',resolve));
  const {port}=socket.address();await new Promise(resolve=>socket.close(resolve));return port;
}

// Tarayıcıda çalışır: tek örnek. state'i kurar, ülke seçim kutusuna 'change' gönderir
// (kullanıcının seçim yapması), sonraki 'bl:orders-rows-visible' + 1 kareyi bekler.
function sampleInPage(args){
  const {country,season,sortKey,sortDir,search,path:wanted}=args;
  return new Promise(resolve=>{
    const search$=document.getElementById('ordersSearch');search$.value=search;
    state.ordersSort={key:sortKey,dir:sortDir};
    if(season){state.colFilters.orders.Season={values:new Set([season])};}else delete state.colFilters.orders.Season;
    const select=document.getElementById('ordersFCountry');
    if(![...select.options].some(o=>o.value===country)){const o=document.createElement('option');o.value=country;o.textContent=country;select.appendChild(o);}
    select.value=country;
    const countBefore=document.getElementById('ordersCount').textContent;
    const t0=performance.now();
    const timer=setTimeout(()=>{window.removeEventListener('bl:orders-rows-visible',done);resolve({timedOut:true});},60000);
    function done(event){
      if(event.detail.path!==wanted)return;
      window.removeEventListener('bl:orders-rows-visible',done);clearTimeout(timer);
      requestAnimationFrame(()=>{
        const out={ms:performance.now()-t0,renderMs:event.detail.ms,rows:event.detail.rows,queryMs:event.detail.queryMs??null,
          domRows:document.querySelectorAll('#ordersTable tbody tr[data-id]').length};
        // Sayım satırı (pencereli yolda sayaçlar satırlardan sonra gelir): yerleşene kadar bekle.
        const settle=performance.now(),poll=()=>{
          const text=document.getElementById('ordersCount').textContent;
          if(text!==countBefore||performance.now()-settle>5000){out.count=text;out.countSettledMs=performance.now()-t0;resolve(out);return;}
          setTimeout(poll,20);
        };poll();
      });
    }
    window.addEventListener('bl:orders-rows-visible',done);
    select.dispatchEvent(new Event('change'));
  });
}

(async()=>{
  const opts=parseArgs(process.argv.slice(2));
  const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
  const report={tool:'orders-bench',synthetic:true,startedAt:new Date().toISOString(),options:{...opts,out:undefined},
    environment:{platform:process.platform,arch:process.arch,node:process.version,cpu:os.cpus()[0]?.model,cpuCount:os.cpus().length,totalMemoryBytes:os.totalmem(),browser:'headless Chromium (Playwright)'},
    harnessSha256:crypto.createHash('sha256').update(fs.readFileSync(__filename)).digest('hex')};
  const source=prepareSource({harnessRoot:APP_ROOT,rows:opts.rows,sourceFixture:opts.sourceFixture});
  report.fixture=source.meta;
  const root=tempDir('erp-orders'),logFile=path.join(root,'server.log');
  const env={...process.env,BUYER_LOG_CENTRAL_IAM_ENABLED:'0',BUYER_LOG_SERVER_DATA_ROOT:path.join(root,'data'),BUYER_LOG_AUTH_DATA_ROOT:path.join(root,'data'),
    BUYER_LOG_DATA_ROOT:path.join(root,'app'),BUYER_LOG_LOCAL_DATA_ROOT:path.join(root,'local'),BUYER_LOG_LOCAL_DB:path.join(root,'local','BuyerLogLocal.db'),
    BUYER_LOG_CONFIG_PATH:path.join(root,'config.json'),BUYER_LOG_TEMP_ROOT:path.join(root,'tmp')};
  let server=null,browser=null,base='',cookie='';
  const api=(url,init={})=>requestJson(base+url,{...init,headers:{cookie,'Content-Type':'application/json',...init.headers}});
  async function start(){
    const fd=fs.openSync(logFile,'a');
    server=spawn(process.execPath,[path.join(APP_ROOT,'server','server.js')],{cwd:APP_ROOT,env,stdio:['ignore',fd,fd]});fs.closeSync(fd);
    for(let i=0;i<120;i++){if(server.exitCode!==null)throw Error('Server exited');try{await api('/api/status');return;}catch(_){}await delay(250);}
    throw Error('Server startup timed out');
  }
  async function stop(){if(!server||server.exitCode!==null)return;const done=new Promise(r=>server.once('exit',r));server.kill('SIGTERM');await Promise.race([done,delay(10000)]);if(server.exitCode===null){server.kill('SIGKILL');await done;}}
  try{
    const dataSource=path.join(root,'source');fs.cpSync(source.dir,dataSource,{recursive:true});
    initializeBenchmarkState(root);
    const port=await freePort();base='http://127.0.0.1:'+port;
    fs.writeFileSync(env.BUYER_LOG_CONFIG_PATH,JSON.stringify({port,sourceFolder:dataSource,host:'127.0.0.1'}));
    await start();
    const login=await fetch(base+'/api/user-login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({userId:'moderator',password:PASSWORD,newPassword:PASSWORD})});
    cookie=String(login.headers.get('set-cookie')||'').split(';')[0];
    await api('/api/refresh',{method:'POST',body:'{}'});
    for(let i=0;i<1200;i++){const s=compactRefreshStatus(await api('/api/refresh-status'));if(!s.running){if(s.error)throw Error(JSON.stringify(s.error));break;}await delay(500);}
    await stop();await start();
    const username=JSON.parse(fs.readFileSync(path.join(root,'data','user-access.json'),'utf8')).moderator.username;
    browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||undefined,args:['--no-sandbox']});
    const context=await browser.newContext({viewport:{width:1600,height:1000},locale:'tr-TR',deviceScaleFactor:opts.screenshots?2:1});
    await context.addInitScript(P.installErpProbe,{lagIntervalMs:50,bridge:true});
    const page=await context.newPage();
    const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.dismiss().catch(()=>{}));
    await page.goto(base+'/select-user.html',{waitUntil:'domcontentloaded',timeout:120000});
    await page.locator('#username').fill(username);
    const option=page.locator('#suggestions [role="option"]').first();
    if(await option.waitFor({state:'visible',timeout:3000}).then(()=>true,()=>false)){await option.click();await page.locator('#suggestions').waitFor({state:'hidden',timeout:3000}).catch(()=>{});}
    await page.locator('#password').fill(PASSWORD);
    await page.locator('#loginBtn').click({noWaitAfter:true});
    await page.waitForURL(base+'/',{waitUntil:'commit',timeout:120000});
    await page.waitForFunction(()=>Number.isFinite(window.__erpProbe?.events['bl:startup-ready']),null,{timeout:300000,polling:100});
    await page.evaluate(()=>{window.BLBootGuard?.continue?.({intentAtMs:window.__erpProbe.events['bl:startup-ready']});});
    await page.waitForFunction(()=>window.BLPerf?.timeline?.().some(m=>m.name==='BACKGROUND_WARMUP_DONE'),null,{timeout:300000,polling:250});
    await delay(1500);
    // Siparişler'i aç (eski yol; tam satırlar arka plan hazırlığıyla bellekte).
    await page.evaluate(()=>{(document.querySelector('#railModules button[data-tab="orders"]')||document.querySelector('button[data-tab="orders"]')).click();});
    await page.waitForFunction(()=>document.querySelector('#ordersTable tbody tr[data-id]'),null,{timeout:120000});
    await delay(1000);
    const countries=await page.evaluate(()=>[...document.getElementById('ordersFCountry').options].map(o=>o.value).filter(Boolean));
    const seasons=await page.evaluate(()=>[...new Set(state.orders.rows.map(r=>String(r.Season||'').trim()).filter(Boolean))].sort());
    const sorts=[['Order Quantity',-1],['Ex-factory',1],['Model Name',1],['Season',-1]];
    const searches=['','a','kız','/e'];
    const plan=Array.from({length:opts.samples},(_,i)=>({country:countries[i%countries.length],season:i%3===0?'':seasons[i%seasons.length],
      sortKey:sorts[i%sorts.length][0],sortDir:sorts[i%sorts.length][1],search:searches[Math.floor(i/countries.length)%searches.length]}));
    report.plan=plan;
    const results={};
    for(const [label,enabled] of [['legacy',false],['readModel',true]]){
      await page.evaluate(value=>{window.BLOrdersReadModel.setEnabled(value);},enabled);
      await delay(2000);
      const samples=[];
      for(const step of plan){samples.push({...step,...await page.evaluate(`(${sampleInPage})(${JSON.stringify({...step,path:label})})`)});await delay(150);}
      const ms=samples.filter(s=>Number.isFinite(s.ms)).map(s=>s.ms);
      results[label]={samples,n:ms.length,p50:P.round(percentile(ms,50)),p95:P.round(percentile(ms,95)),max:P.round(Math.max(...ms)),
        renderP50:P.round(percentile(samples.map(s=>s.renderMs).filter(Number.isFinite),50)),status:await page.evaluate(()=>window.BLOrdersReadModel.status())};
      console.log(`${label}: n=${ms.length} p50=${results[label].p50} ms p95=${results[label].p95} ms max=${results[label].max} ms`);
    }
    // Aynı birleşimde iki yolun sayım satırı aynı olmalı (son örnek).
    report.results=results;
    report.countLineEqual=results.legacy.samples.map((s,i)=>s.count===results.readModel.samples[i].count);
    if(opts.screenshots){
      fs.mkdirSync(opts.screenshots,{recursive:true});
      await page.evaluate(()=>{window.BLOrdersReadModel.setEnabled(true);});await delay(2500);
      await page.screenshot({path:path.join(opts.screenshots,'orders-read-model.png')});
    }
    report.heap=await readRendererMetrics(context,page,30000);
    report.errors=errors;report.status='passed';
  }catch(error){report.status='failed';report.error={message:error.message,stack:error.stack};try{report.serverLogTail=fs.readFileSync(logFile,'utf8').split(/\r?\n/).slice(-40);}catch(_){}process.exitCode=1;}
  finally{
    try{if(browser)await browser.close();}finally{await stop();}
    if(!opts.keepFixture)removeTemp(root);
    if(source.owned&&!opts.keepFixture)removeTemp(source.holder);
    report.finishedAt=new Date().toISOString();
    const out=path.resolve(opts.out||path.join(os.tmpdir(),`orders-bench-${Date.now()}.json`));
    fs.writeFileSync(out,JSON.stringify(report,null,2)+'\n');
    console.log(`Report: ${out} (status=${report.status})`);
  }
})();
