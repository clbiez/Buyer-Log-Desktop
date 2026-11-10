'use strict';
// Real Buyer Log runtime acceptance on isolated, generated demo data only.
// Requires Playwright + Chromium. No TEST/STABLE workflow or remote publication.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { spawn, spawnSync } = require('node:child_process');
const { chromium } = require('playwright');
const app = path.resolve(__dirname, '..');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'buyerlog-checklist-ui-'));
const captureRoot = process.env.BUYER_LOG_CHECKLIST_CAPTURE_ROOT || root;
const port = Number(process.env.BUYER_LOG_CHECKLIST_TEST_PORT || 6478);
const base = `http://127.0.0.1:${port}`;
const env = { ...process.env, BUYER_LOG_DATA_ROOT: path.join(root, 'app'), BUYER_LOG_SERVER_DATA_ROOT: path.join(root, 'server'), BUYER_LOG_LOCAL_DATA_ROOT: path.join(root, 'local'), BUYER_LOG_TEMP_ROOT: path.join(root, 'temp'), BUYER_LOG_AUTH_DATA_ROOT: path.join(root, 'server'), BUYER_LOG_CONFIG_PATH: path.join(root, 'config.json') };
for (const folder of ['app', 'server', 'local', 'temp']) fs.mkdirSync(path.join(root, folder));
fs.mkdirSync(captureRoot, { recursive: true });
const generated = spawnSync(process.execPath, ['scripts/generate-demo-data.js', path.join(root, 'source'), '--rows', '40'], { cwd: app, encoding: 'utf8' });
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
  const result = await page.evaluate(async () => {
    const row=state.cp.rows.find(r=>r._canEdit!==false);
    const analysis=BLCpAssistant.computeDecisionsForRows([row]).byRow.get(row);
    if(!analysis)throw Error('No live analysis');
    const rule={id:'demo-set-approval',kind:'checklist',enabled:true,approvalScope:'option',tr:'Set Onayı',en:'Set Approval',mode:'formula',formula:'=[@qty]>0',conditions:[],evidenceFields:{reportNumber:true,attachments:true}};
    BLCpAssistant._state.rules.push(rule);
    if(!BLCpAssistant.setChecklistComponents(analysis,2))throw Error('Roster failed');
    const id=rule.id+'~part~B';
    if(!BLCpAssistant.setChecklistAnswer(analysis,id,'approved',{note:'Demo evidence'}))throw Error('Part failed');
    await BLChecklistSupplierSync.syncAnswerChanges();
    BLChecklistSupplierSync.refreshColumns({render:true});
    const payload=await (await fetch('/api/checklist-supplier')).json();
    const key=BLCpChecklistEngine.optionAnswerKey(analysis,id);
    if(payload.answers[key]?.state!=='approved')throw Error('Option approval was not saved: '+JSON.stringify(payload));
    return {id,key,orderKey:analysis.orderKey};
  });
  console.log('Server accepted order and option part approvals',JSON.stringify(result));
  await page.locator('.clStatusTrigger[data-item="'+result.id+'"]').first().scrollIntoViewIfNeeded();
  await page.locator('.clStatusTrigger[data-item="'+result.id+'"]').first().click();
  const savedResponse = page.waitForResponse(response => response.url().endsWith('/api/checklist-supplier/answers') && response.request().method() === 'POST');
  await page.locator('[data-cl-status="approved"]').click();
  assert.equal((await savedResponse).status(),200);
  await page.locator('.clStatusTrigger[data-item="'+result.id+'"]').first().click();
  await page.screenshot({path:path.join(captureRoot,'checklist-set-roster-sync.png')});
  assert.equal(errors.length,0,errors.join('\n'));
  console.log('PASS: screenshot and live server persistence');
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{await browser?.close();server.kill('SIGTERM');console.log('Demo root:',root);});
