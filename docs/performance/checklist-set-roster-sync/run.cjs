'use strict';
// Real Buyer Log runtime acceptance on isolated, generated demo data only.
// Requires Playwright + Chromium. No TEST/STABLE workflow or remote publication.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { spawn, spawnSync } = require('node:child_process');
const { chromium } = require('playwright');
const app = process.env.BENCH_APP_ROOT;
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'buyerlog-checklist-ui-'));
const captureRoot = process.env.BUYER_LOG_CHECKLIST_CAPTURE_ROOT || root;
const port = Number(process.env.BUYER_LOG_CHECKLIST_TEST_PORT || 6478);
const base = `http://127.0.0.1:${port}`;
const env = { ...process.env, BUYER_LOG_DATA_ROOT: path.join(root, 'app'), BUYER_LOG_SERVER_DATA_ROOT: path.join(root, 'server'), BUYER_LOG_LOCAL_DATA_ROOT: path.join(root, 'local'), BUYER_LOG_TEMP_ROOT: path.join(root, 'temp'), BUYER_LOG_AUTH_DATA_ROOT: path.join(root, 'server'), BUYER_LOG_CONFIG_PATH: path.join(root, 'config.json') };
for (const folder of ['app', 'server', 'local', 'temp']) fs.mkdirSync(path.join(root, folder));
fs.mkdirSync(captureRoot, { recursive: true });
const generated = spawnSync(process.execPath, ['scripts/generate-demo-data.js', path.join(root, 'source'), '--rows', process.env.BENCH_ROWS || '40', '--seed', '7'], { cwd: app, encoding: 'utf8' });
assert.equal(generated.status, 0, generated.stderr);
fs.writeFileSync(env.BUYER_LOG_CONFIG_PATH, JSON.stringify({ port, sourceFolder: path.join(root, 'source') }));
const log = fs.openSync(path.join(root, 'server.log'), 'a');
const server = spawn(process.execPath, ['server/server.js'], { cwd: app, env, stdio: ['ignore', log, log] });
let browser;
(async () => {
  for (let i = 0; i < 160; i++) {
    try { if ((await fetch(base + '/api/health')).status < 500) break; } catch (_) {}
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  console.log('Demo server ready');
  const login = await fetch(base + '/api/user-login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId: 'moderator', password: 'studio-demo-2026', newPassword: 'studio-demo-2026' }) });
  assert.equal(login.status, 200, await login.text());
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const refresh = await fetch(base + '/api/refresh', { method: 'POST', headers: { cookie, 'Content-Type': 'application/json' }, body: '{}' });
  assert.ok(refresh.ok, `Demo refresh: ${refresh.status}`);
  browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || '/usr/bin/chromium', args: ['--no-sandbox'] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  const separator = cookie.indexOf('=');
  await context.addCookies([{ name: cookie.slice(0, separator), value: cookie.slice(separator + 1), domain: '127.0.0.1', path: '/', httpOnly: true }]);
  await context.addInitScript(() => { localStorage.setItem('bl.releaseNotes.lastSeenStable.v1', '99.0.0'); });
  console.log('Demo login and refresh accepted');
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('dialog', dialog => dialog.accept());
  const navigationStarted=performance.now();
  await page.goto(base + '/?module=cp', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.BLPerf && typeof window.switchTab === 'function', { timeout: 60000 });
  await page.getByText(/Buyer Log'a devam et|Continue to Buyer Log/).click({ timeout: 4000 }).catch(() => {});
  await page.waitForFunction(() => !document.getElementById('blBootGuard'), { timeout: 60000 });
  await page.evaluate(async () => { document.querySelectorAll('dialog[open]').forEach(dialog => dialog.close()); await BLPerf.ensureFeature('cpAssistant'); });
  console.log('App booted');
  await page.waitForFunction(() => state.cp?.rows?.length > 0);
  await page.evaluate(() => BLCpAssistant.onOverviewRendered(state.cp.rows, { dataRevision: 1 }));
  console.log('Demo CP loaded');

  await page.evaluate(async () => {
    await switchTab('cp');
  });

  const startupMs=performance.now()-navigationStarted;
  const fixture=await page.evaluate(()=>JSON.stringify(state.cp.rows.map(r=>['Order Code','PLM ID','Model Name','C.Code','Order Quantity'].map(k=>r[k]))));
  const fixtureHash=require('node:crypto').createHash('sha256').update(fixture).digest('hex');
  const cdp=await context.newCDPSession(page);
  await page.evaluate(async()=>{
    await BLChecklistSupplierSync.loadShared();
    const row=state.cp.rows.find(r=>r._canEdit!==false),analysis=BLCpAssistant.computeDecisionsForRows([row]).byRow.get(row);
    BLCpAssistant.setChecklistComponents(analysis,2);
    await BLChecklistSupplierSync.syncAnswerChanges();
    window.__bench={row,analysis,requests:0,bytes:0,active:0,peak:0,longTasks:[]};
    const original=window.fetch;
    window.fetch=async function(url,opts){
      const tracked=String(url).endsWith('/api/checklist-supplier/answers')&&opts?.method==='POST';
      if(!tracked)return original.apply(this,arguments);
      __bench.requests++;__bench.bytes+=new TextEncoder().encode(opts.body).length;__bench.active++;__bench.peak=Math.max(__bench.peak,__bench.active);
      try{return await original.apply(this,arguments);}finally{__bench.active--;}
    };
    new PerformanceObserver(list=>__bench.longTasks.push(...list.getEntries().map(e=>({start:e.startTime,duration:e.duration})))).observe({type:'longtask',buffered:false});
  });
  const samples=[];
  for(let i=0;i<5;i++){
    await cdp.send('HeapProfiler.collectGarbage');
    const sample=await page.evaluate(async i=>{
      const b=__bench,start=performance.now(),before=b.requests;
      const status=i%2?'rejected':'approved';
      if(!BLCpAssistant.setChecklistAnswer(b.analysis,'tests~part~B',status,{note:'Demo evidence'}))throw Error('Local save rejected');
      BLChecklistSupplierSync.refreshColumns({render:true});
      const feedbackMs=performance.now()-start;
      await BLChecklistSupplierSync.syncAnswerChanges();
      await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
      const elapsedMs=performance.now()-start;
      const payload=await(await fetch('/api/checklist-supplier')).json();
      if(payload.answers[b.analysis.orderKey+'::tests~part~B']?.state!==status)throw Error('Saved status mismatch');
      return {feedbackMs,elapsedMs,requests:b.requests-before};
    },i);
    await cdp.send('HeapProfiler.collectGarbage');
    const heap=await cdp.send('Runtime.getHeapUsage');sample.heapUsed=heap.usedSize;samples.push(sample);
  }
  const neighbor=[];
  for(let i=0;i<5;i++)neighbor.push(await page.evaluate(async()=>{const start=performance.now();await switchTab('orders');await switchTab('cp');await new Promise(r=>requestAnimationFrame(r));return performance.now()-start;}));
  const network=await page.evaluate(()=>({requests:__bench.requests,bytes:__bench.bytes,peak:__bench.peak,active:__bench.active,longTasks:__bench.longTasks}));
  const result={label:process.env.BENCH_LABEL,rows:Number(process.env.BENCH_ROWS),sha:spawnSync('git',['rev-parse','HEAD'],{cwd:app,encoding:'utf8'}).stdout.trim(),fixtureHash,startupMs,samples,neighbor,network,browser:await browser.version(),node:process.version};
  fs.writeFileSync(process.env.BENCH_RESULT,JSON.stringify(result,null,2)+'\n');
  assert.ok(samples.every(s=>s.requests===1));assert.equal(network.active,0);assert.equal(network.peak,1);
  console.log('PERFORMANCE_RESULT',JSON.stringify(result));
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{await browser?.close();server.kill('SIGTERM');console.log('Demo root:',root);});
