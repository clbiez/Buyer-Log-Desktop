'use strict';

// Synthetic fixture, real server and Chromium. Baseline JS is routed from an
// untouched checkout; pairs run RED/GREEN/RED/GREEN/RED/GREEN on the same host.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const {spawn, execFileSync} = require('node:child_process');
const {chromium} = require('playwright');
const {initializeBenchmarkState} = require('./lib/startup-benchmark');
const arg = (name, fallback) => { const i = process.argv.indexOf(name); return i < 0 ? fallback : process.argv[i + 1]; };
const app = path.resolve(__dirname, '..'), repo = path.resolve(app, '../..');
const root = '/tmp/buyerlog-startup-analytics', baseline = path.resolve(arg('--baseline', '/tmp/buyerlog-analytics-baseline'));
const pilot = process.argv.includes('--pilot'), output = path.resolve(arg('--out', path.join(root, pilot ? 'pilot.json' : 'results.json')));
const captureOnly = process.argv.includes('--capture-only');
const base = 'http://127.0.0.1:6493';
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
let server, browser, cookie, lastPage;
async function api(url, body) {
  const res = await fetch(base + url, {method:body?'POST':'GET', headers:{cookie, 'Content-Type':'application/json'}, body:body?JSON.stringify(body):undefined, signal:AbortSignal.timeout(180000)});
  assert.ok(res.ok, url + ': ' + res.status); return res;
}
function instrument(source, name) {
  if (name !== 'lfl.js') return source;
  for (const fn of ['render','manufacturerVolumes','frameworkRows','renderKpis','renderSource','renderCustomCompare']) {
    const re = new RegExp('(function '+fn+'\\([^)]*\\)\\s*\\{)');
    source = source.replace(re, '$1 window.__counts["'+fn+'"]=(window.__counts["'+fn+'"]||0)+1;');
  }
  return source.replace('window.__lflTest={', 'window.__analytics={state,compute,render,exports:LFL_TABLE_EXPORTS};window.__lflTest={');
}
async function open(variant) {
  const context = await browser.newContext({viewport:{width:1440,height:1000}, reducedMotion:'reduce'});
  const sep = cookie.indexOf('=');
  await context.addCookies([{name:cookie.slice(0,sep),value:cookie.slice(sep+1),url:base}]);
  await context.addInitScript(() => {
    window.__counts={};window.__messages=[];
    localStorage.setItem('bl.user.moderator.bl.releaseNotes.lastSeenStable.v1','99.0.0');
    const NativeWorker=window.Worker;
    window.Worker=class extends NativeWorker {
      constructor(...args){super(...args);this.delivery=String(args[0]).includes('backlog-delivery-worker.js');this.addEventListener('message',event=>{if(this.delivery&&event.data.kind==='result')window.__messages.push({receivedByUI:performance.timeOrigin+performance.now(),...event.data.timing});});}
      postMessage(...args){const start=performance.now();super.postMessage(...args);if(this.delivery)window.__messages.push({postMs:performance.now()-start,dataset:!!args[0].rows});}
    };
    window.__sha=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value))))).map(x=>x.toString(16).padStart(2,'0')).join('');
  });
  const page = await context.newPage(), errors=[];
  lastPage=page;
  page.on('pageerror',error=>errors.push(error.message));
  page.on('console',message=>{if(message.text().startsWith('ANALYTICS '))console.log(variant+' '+message.text());});
  page.on('dialog',dialog=>dialog.dismiss());
  await page.route('https://**',route=>route.abort());
  for (const name of ['lfl.js','backlog-delivery-analysis.js','transit-analysis.js']) {
    await page.route('**/'+name+'*',route=>route.fulfill({contentType:'application/javascript',body:instrument(fs.readFileSync(path.join(variant==='red'?baseline:path.join(app,'public'),name),'utf8'),name)}));
  }
  await page.goto(base+'/?module=lfl',{waitUntil:'domcontentloaded',timeout:180000});
  await page.locator('[data-boot-continue]').click({timeout:180000});
  await page.waitForFunction(()=>!document.getElementById('blBootGuard'),null,{timeout:180000});
  await page.evaluate(()=>switchTab('lfl'));
  await page.waitForFunction(()=>window.__analytics?.state.analysis?.currentRows.length>0,null,{timeout:180000});
  await page.evaluate(async()=>{await BLPerf.ensureFeature('backlogAnalysis');await BLPerf.ensureFeature('transitAnalysis');});
  await page.waitForFunction(()=>BLBacklogAnalysis._state.model&&!BLBacklogAnalysis._state.loading,null,{timeout:180000});
  await page.waitForTimeout(100);
  for(const button of await page.locator('[data-hold-continue]:visible').all())await button.click();
  await page.locator('#lflGroupTable th[data-k="currentAvg"] .thLabel').waitFor({state:'visible'});
  await page.waitForTimeout(50);
  console.log(variant+' ready',await page.evaluate(()=>({backlog:BLBacklogAnalysis._state.rows.length,lfl:__analytics.state.rows.length})));
  return {context,page,errors};
}
async function measure(page, round) {
  const cdp=await page.context().newCDPSession(page);
  await cdp.send('HeapProfiler.collectGarbage');await cdp.detach();
  return page.evaluate(async round=>{
    const settle=()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
    await settle();
    const nodes=['lflKpis','lflSourceInfo','lflManufacturerVolumeTable','lflCustomCompareTable'].map(id=>document.getElementById(id)?.firstElementChild);
    const counts=window.__counts={};
    const start=performance.now();
    document.querySelector('#lflGroupTable th[data-k="currentAvg"] .thLabel').click();
    const syncMs=performance.now()-start;await settle();const paintMs=performance.now()-start;
    const exports=[...__analytics.exports].map(([key,value])=>[key,value.rows]);
    const lfl={syncMs,paintMs,counts:{...counts},otherDOMPreserved:['lflKpis','lflSourceInfo','lflManufacturerVolumeTable','lflCustomCompareTable'].every((id,index)=>document.getElementById(id)?.firstElementChild===nodes[index])};
    const s=BLBacklogAnalysis._state;
    async function deliveryRun(cold){
      if(cold)s.rows=s.rows.slice();
      s.settings={...s.settings,requiredBufferRetail:round+3};s.model=null;window.__messages=[];
      let maxGap=0,last=performance.now();const longTasks=[];
      const before=performance.now(),observer=new PerformanceObserver(list=>{for(const entry of list.getEntries())if(entry.startTime+entry.duration>before)longTasks.push(entry.duration);});
      observer.observe({type:'longtask'});
      const timer=setInterval(()=>{const now=performance.now();maxGap=Math.max(maxGap,now-last);last=now;},5);
      await BLBacklogAnalysis.refresh(false);await new Promise(resolve=>setTimeout(resolve,10));clearInterval(timer);observer.disconnect();
      const posts=window.__messages.filter(m=>m.postMs!=null),uploads=posts.filter(m=>m.dataset);
      return {wallMs:performance.now()-before,maxGapMs:maxGap,longTasks,
        inputPackets:uploads.length,inputPostTotalMs:uploads.reduce((n,m)=>n+m.postMs,0),inputPostMaxMs:Math.max(0,...uploads.map(m=>m.postMs)),
        timing:window.__messages.find(m=>m.computedAt),rows:s.rows.length,
        sourceRowsRestored:s.model.orders.every((order,index)=>order.sourceRow===s.rows[index]),model:s.model};
    }
    const delivery=await deliveryRun(false),coldDelivery=await deliveryRun(true);
    // Independent 20k stress workload with many country/vehicle/year groups.
    // Values and weights are deterministic, distinct from production data.
    const records=[],steps=[];
    for(let i=0;i<20000;i++){
      const country='Demo '+(i%100),vehicle=['Gemi','Uçak','Tır',''][Math.floor(i/100)%4],year=String(2024+Math.floor(i/400)%3);
      records.push({basis:'loading',country,vehicle,year,period:year+'-'+String(1+Math.floor(i/1200)%12).padStart(2,'0'),qty:10+i%97,shipments:1+i%4,endToEnd:20+i%60,loading:i%9,transit:10+i%40,customs:i%7});
      steps.push({basis:'loading',country:i%2?country.toUpperCase():country,vehicle,year,code:String(1+Math.floor(i/1200)%9),label:'Demo step',days:1+i%45,qty:10+i%97});
    }
    const analysis={records,steps,weighting:round%2?'qty':'shipment'};
    const t=performance.now(),summary=BLTransitAnalysis.summarize(analysis,{basis:'loading',year:round===2?'2026':'*'});
    const transit={ms:performance.now()-t,rows:summary.rows.length};
    // Hashing and standalone clone diagnostics are outside all latency windows.
    lfl.sha=await __sha(exports);transit.sha=await __sha(summary);
    for(const result of [delivery,coldDelivery]){result.sha=await __sha({...result.model,context:{...result.model.context,generatedAt:''}});delete result.model;}
    const copyStart=performance.now();structuredClone(s.rows);const inputCloneMs=performance.now()-copyStart;
    const projectStart=performance.now(),fields=Object.values(BLBacklogDeliveryEngine.FIELDS);
    const projected=s.rows.map(row=>Object.assign(Object.fromEntries(fields.map(field=>[field,row[field]])),{_backlogExcel:Object.fromEntries(['mag','mmyg','handoverDate','actualAntrepoDate','signals','transitDays','transitOverdue','transitRule'].map(key=>[key,row._backlogExcel?.[key]]))}));
    const projectMs=performance.now()-projectStart,projectedStart=performance.now();structuredClone(projected);const projectedCloneMs=performance.now()-projectedStart;
    const outStart=performance.now();structuredClone(s.model);const outputCloneMs=performance.now()-outStart;
    return {round,lfl,delivery,coldDelivery,transit,cloneDiagnostics:{inputCloneMs,projectMs,projectedCloneMs,outputCloneMs}};
  },round);
}
(async()=>{
  fs.mkdirSync(path.join(root,'source'),{recursive:true});
  execFileSync('tar',['-xzf',path.join(repo,'docs/performance-program/fixtures/source-30000-seed7-20261105.tar.gz'),'-C',path.join(root,'source')]);
  initializeBenchmarkState(root);
  const env={...process.env,BUYER_LOG_CENTRAL_IAM_ENABLED:'0',BUYER_LOG_CONFIG_PATH:path.join(root,'config.json')};
  for(const [key,dir] of Object.entries({BUYER_LOG_DATA_ROOT:'app',BUYER_LOG_SERVER_DATA_ROOT:'data',BUYER_LOG_AUTH_DATA_ROOT:'data',BUYER_LOG_LOCAL_DATA_ROOT:'local',BUYER_LOG_TEMP_ROOT:'tmp'}))env[key]=path.join(root,dir);
  env.BUYER_LOG_LOCAL_DB=path.join(root,'local/BuyerLogLocal.db');
  fs.writeFileSync(env.BUYER_LOG_CONFIG_PATH,JSON.stringify({port:6493,host:'127.0.0.1',sourceFolder:path.join(root,'source'),updates:{enabled:false},refreshWithExcel:false}));
  const log=fs.openSync(path.join(root,'server.log'),'a');server=spawn(process.execPath,['server/server.js'],{cwd:app,env,stdio:['ignore',log,log]});fs.closeSync(log);
  let ready=false;for(let i=0;i<160;i++){try{await api('/api/status');ready=true;break;}catch{}await delay(250);}assert.ok(ready);
  const login=await api('/api/user-login',{userId:'moderator',password:'synthetic-startup-only-123',newPassword:'synthetic-startup-only-123'});cookie=login.headers.get('set-cookie').split(';')[0];
  await api('/api/refresh',{});
  let refreshed=false;for(let i=0;i<720;i++){const s=await(await api('/api/refresh-status')).json();if(!s.running){assert.equal(s.error,null);refreshed=true;break;}await delay(250);}assert.ok(refreshed);
  browser=await chromium.launch({headless:true,executablePath:'/usr/bin/chromium',args:['--no-sandbox']});
  const red=captureOnly?null:await open('red'),green=pilot?null:await open('green'),runs=[];
  for(let round=0;round<(captureOnly?0:pilot?1:3);round++)for(const [variant,target] of [['red',red],...(green?[['green',green]]:[])]){
    await target.page.bringToFront();const result=await measure(target.page,round);runs.push({variant,...result});console.log(JSON.stringify(runs.at(-1)));
  }
  const report={synthetic:true,fixture:'source-30000-seed7-20261105.tar.gz',browser:await browser.version(),runs};
  if(!captureOnly){fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');}
  if(green){
    for(let i=0;i<runs.length;i+=2)for(const key of ['lfl','delivery','coldDelivery','transit'])assert.equal(runs[i][key].sha,runs[i+1][key].sha,key+' output SHA');
    if(red)assert.deepEqual(red.errors,[]);assert.deepEqual(green.errors,[]);
    assert.ok(runs.filter(r=>r.variant==='green').every(r=>r.delivery.sourceRowsRestored));
    assert.ok(runs.filter(r=>r.variant==='green').every(r=>r.lfl.otherDOMPreserved));
    if(process.argv.includes('--measure-only'))return;
    await green.page.evaluate(()=>switchTab('lfl'));
    for(const button of await green.page.locator('[data-hold-continue]:visible').all())await button.click();
    await green.page.locator('#lflGroupTable th[data-k="currentAvg"] .thLabel').click();
    await green.page.locator('#lflGroupTable').scrollIntoViewIfNeeded();
    await green.page.waitForTimeout(100);
    await green.page.screenshot({path:path.join(app,'public/release-notes/next-assets/analytics-lfl-sort.png')});
    await green.page.evaluate(()=>switchTab('backlog'));
    await green.page.locator('#backlogOverviewBody .bpaHero').waitFor({timeout:180000});
    await green.page.waitForFunction(()=>BLBacklogAnalysis._state.parity?.match&&!BLBacklogAnalysis._state.loading,null,{timeout:180000});
    await green.page.locator('#backlogAnalysis .bdaKpi').first().waitFor();
    await green.page.locator('#backlogAnalysis').scrollIntoViewIfNeeded();
    await green.page.screenshot({path:path.join(app,'public/release-notes/next-assets/analytics-delivery-worker.png')});
    // Full renders replace local closures when language, data or analysis inputs
    // change; local table callbacks must never keep a previous snapshot alive.
    await green.page.evaluate(async()=>{
      const state=__analytics.state,previous=state.analysis;
      state.analysisRevision=(state.analysisRevision||0)+1;__analytics.render();
      if(state.analysis===previous)throw Error('analysis revision did not invalidate');
      const old=state.analysis;await reloadLflFromCache();
      if(state.analysis===old)throw Error('dataset reload did not invalidate');
      appLang='en';renderLFLLanguage();
      if(!document.getElementById('lflManufacturerVolumeTitle').textContent.includes('Manufacturer'))throw Error('language did not refresh');
      appLang='tr';renderLFLLanguage();
    });
    await green.page.evaluate(async()=>{
      // The startup fixture has no loading-request dates for live IAS analysis.
      // Save a labelled synthetic report through the real module/server API.
      const records=[],steps=[];
      for(const country of ['Bangladesh','China','Turkey'])for(const vehicle of ['Gemi','Uçak'])for(let month=1;month<=6;month++){
        records.push({basis:'loading',country,vehicle,year:'2026',granularity:'month',period:'2026'+String(month).padStart(2,'0'),qty:1200+month*100,loading:4+month,transit:vehicle==='Gemi'?30+month:5+month,customs:3,endToEnd:vehicle==='Gemi'?37+month*2:12+month*2});
      }
      for(const record of records.filter(r=>r.period==='202601'))for(let code=1;code<=8;code++)steps.push({...record,code:String(code),label:'Demo process '+code,group:'loading',days:code+1});
      await BLTransitAnalysisUI.load();
      const saved=await BLTransitAnalysisUI.save({source:'excel',fileName:'Synthetic Transit Report · seed 7',records,steps,sources:[],weighting:'qty'});
      if(!saved)throw Error('synthetic transit report was rejected');
      openTransitRulesModal();
    });
    console.log('Transit opened');
    await green.page.locator('[data-ta-source="excel"]').click();
    await green.page.locator('#_transitAnalysisMount .trxTable tbody tr').first().waitFor({timeout:180000});
    const collapse=green.page.locator('[data-ta-collapse]');
    if(await collapse.getAttribute('aria-expanded')==='false')await collapse.click();
    await green.page.screenshot({path:path.join(app,'public/release-notes/next-assets/analytics-transit-summary.png')});
    assert.deepEqual(green.errors,[]);
  }
})().catch(async error=>{console.error(error);if(lastPage){await lastPage.screenshot({path:path.join(root,'failure.png')}).catch(()=>{});console.error(await lastPage.locator('#_transitAnalysisMount').innerText().catch(()=>''));}process.exitCode=1;}).finally(async()=>{await browser?.close();server?.kill('SIGTERM');});
