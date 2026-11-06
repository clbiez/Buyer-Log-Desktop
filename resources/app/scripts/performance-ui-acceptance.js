'use strict';
// Capture an actual post-change screen using only generated, isolated demo data.
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), net = require('node:net');
const assert = require('node:assert/strict');
const { spawn, spawnSync } = require('node:child_process');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { initializeBenchmarkState } = require('./lib/startup-benchmark');
const arg = (name, fallback) => { const i = process.argv.indexOf(name); return i < 0 ? fallback : process.argv[i + 1]; };
const app = path.resolve(arg('--app-root', path.join(__dirname, '..')));
const moduleName = arg('--module', 'orders'), lang = arg('--lang', 'tr'), theme = arg('--theme', 'light');
const capture = arg('--capture', 'workspace');
const failModule = arg('--simulate-error', '');
const seedCollection=Number(arg('--seed-collection','0'));
const screenshot = path.resolve(arg('--screenshot', path.join(app, 'public/release-notes/next-assets/source-dense-orders.png')));
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'buyerlog-perf-ui-'));
const env = { ...process.env, BUYER_LOG_CENTRAL_IAM_ENABLED: '0',
  BUYER_LOG_SERVER_DATA_ROOT: path.join(root, 'data'), BUYER_LOG_AUTH_DATA_ROOT: path.join(root, 'data'),
  BUYER_LOG_DATA_ROOT: path.join(root, 'app'), BUYER_LOG_LOCAL_DATA_ROOT: path.join(root, 'local'),
  BUYER_LOG_LOCAL_DB: path.join(root, 'local/BuyerLogLocal.db'), BUYER_LOG_CONFIG_PATH: path.join(root, 'config.json'),
  BUYER_LOG_TEMP_ROOT: path.join(root, 'tmp') };
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
let server, browser, cookie = '', base;
async function api(url, body) {
  const response = await fetch(base + url, { method: body ? 'POST' : 'GET', signal: AbortSignal.timeout(60000),
    headers: { cookie, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  assert.ok(response.ok, url + ': ' + response.status); return response;
}
(async () => {
  assert.ok(['overview', 'cp', 'orders', 'koleksiyon'].includes(moduleName));
  assert.ok(['tr', 'en'].includes(lang)); assert.ok(['light', 'dark'].includes(theme));
  assert.ok(['startup', 'workspace'].includes(capture));
  assert.ok(['','cp','orders'].includes(failModule));
  assert.ok(Number.isInteger(seedCollection)&&seedCollection>=0&&seedCollection<=6);
  if(seedCollection)assert.ok(moduleName==='koleksiyon'&&capture==='workspace');
  const socket = net.createServer(); await new Promise(resolve => socket.listen(0, '127.0.0.1', resolve));
  const port = socket.address().port; await new Promise(resolve => socket.close(resolve)); base = 'http://127.0.0.1:' + port;
  const source = path.join(root, 'source');
  const generated = spawnSync(process.execPath, [path.join(app, 'scripts/generate-demo-data.js'), source, '--rows', '20', '--seed', '7'], { cwd: app, encoding: 'utf8' });
  assert.equal(generated.status, 0, generated.stderr);
  initializeBenchmarkState(root);
  fs.writeFileSync(env.BUYER_LOG_CONFIG_PATH, JSON.stringify({ port, host: '127.0.0.1', sourceFolder: source, updates: { enabled: false } }));
  const log = fs.openSync(path.join(root, 'server.log'), 'a');
  server = spawn(process.execPath, ['server/server.js'], { cwd: app, env, stdio: ['ignore', log, log] }); fs.closeSync(log);
  let ready = false;
  for (let i = 0; i < 120; i++) { try { await api('/api/status'); ready = true; break; } catch (_) {} await delay(250); }
  assert.ok(ready, 'Synthetic server did not start');
  const login = await api('/api/user-login', { userId: 'moderator', password: 'synthetic-perf-only-123', newPassword: 'synthetic-perf-only-123' });
  cookie = login.headers.get('set-cookie').split(';')[0];
  await api('/api/refresh', {});
  let refreshed = false;
  for (let i = 0; i < 240; i++) {
    const status = await (await api('/api/refresh-status')).json();
    if (!status.running) { assert.equal(status.error, null); refreshed = true; break; } await delay(250);
  }
  assert.ok(refreshed, 'Refresh did not complete');
  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--no-sandbox'] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  const split = cookie.indexOf('=');
  await context.addCookies([{ name: cookie.slice(0, split), value: cookie.slice(split + 1), url: base, httpOnly: true }]);
  await context.addInitScript(({ lang, theme }) => {
    localStorage.setItem('bl.user.moderator.lcw.lang.v1', lang);
    localStorage.setItem('bl.user.moderator.lcw_theme', theme);
    for (const key of ['bl.releaseNotes.lastSeenStable.v1', 'bl.user.moderator.bl.releaseNotes.lastSeenStable.v1']) localStorage.setItem(key, '99.0.0');
  }, { lang, theme });
  const page = await context.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message)); await page.route('https://**', route => route.abort());
  if(failModule)await page.route('**/api/page-projection/'+failModule,route=>route.fulfill({status:500,contentType:'application/json',body:JSON.stringify({error:'SYNTHETIC_LOAD_FAILURE'})}));
  await page.goto(base + '/?module=' + moduleName, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForSelector('[data-boot-continue]', { timeout: 180000 });
  const beforeContinue=await page.evaluate(()=>({
    active:document.body.dataset.activeTab,gateReady:document.getElementById('blBootGuard')?.dataset.ready,
    profile:window.BL_USER_CONTEXT?.id,accessApplied:Boolean(document.getElementById('accessModeBadge')?.textContent.trim()),
    cpRows:state.cp?.rows.length??null,ordersRows:state.orders?.rows.length??null,overviewRows:state.overviewSummary?.rows.length??null,
    moduleStates:window.BLModulePreparation?.snapshot(),metrics:window.BLPerf?.snapshot?.(),
    observed:{lang:appLang,documentLang:document.documentElement.lang,theme:document.documentElement.dataset.theme},
  }));
  assert.equal(beforeContinue.gateReady,'1');assert.equal(beforeContinue.profile,'moderator');assert.equal(beforeContinue.accessApplied,true);
  assert.deepEqual(beforeContinue.observed,{lang,documentLang:lang,theme});
  if(capture==='startup'){
    assert.equal(beforeContinue.active,moduleName);
    assert.equal(beforeContinue.metrics.firstUsableInteractionMs,undefined,'covered workspace is not yet usable');
    if(moduleName==='overview'){
      assert.equal(beforeContinue.overviewRows,20);
      assert.equal(beforeContinue.cpRows,null);assert.equal(beforeContinue.ordersRows,null);
    }
    fs.mkdirSync(path.dirname(screenshot),{recursive:true});await page.screenshot({path:screenshot});
  }
  await page.click('[data-boot-continue]');
  await page.waitForFunction(() => !document.getElementById('blBootGuard'), null, { timeout: 180000 });
  let errorRecovery=null;
  if(failModule){
    await page.evaluate(target=>switchTab(target),failModule);
    await page.waitForFunction(target=>window.BLModulePreparation?.snapshot()[target]?.status==='error',failModule,{timeout:60000});
    const selector=failModule==='cp'?'#cpEmpty':'#ordersEmpty';
    assert.equal(await page.locator(selector+' .uiState--error').count(),1,'a failed module must show an error state, not an endless loading panel');
    assert.match(await page.locator(selector).innerText(),lang==='en'?/Retry/:/Tekrar dene/);
    const errorScreenshot=screenshot.replace(/\.png$/,'-error.png');
    await page.screenshot({path:errorScreenshot});
    await page.unroute('**/api/page-projection/'+failModule);
    await page.locator(selector+' .uiState--error button').click();
    await page.waitForFunction(target=>window.BLModulePreparation?.snapshot()[target]?.status==='ready'&&document.querySelector(target==='cp'?'#cpTable tbody tr[data-id]':'#ordersTable tbody tr[data-id]'),failModule,{timeout:180000});
    errorRecovery={module:failModule,errorScreenshot,recovered:true};
  }
  if (moduleName === 'orders') await page.waitForFunction(() => state.orders?.rows.length === 20 && document.querySelector('#ordersTable tbody tr[data-id]'), null, { timeout: 60000 });
  let collectionFixture=null;
  if(seedCollection){
    await page.waitForFunction(()=>kolWorkspaceCanEdit&&kolIsOwnWorkspace(),null,{timeout:60000});
    await page.evaluate(async count=>{
      if(!kolWorkspaceCanEdit||!kolIsOwnWorkspace()||kolRows.length)throw Error('Synthetic Collection must be empty and owner-editable');
      if(!await ensureCpLoaded({deferRender:true}))throw Error('Synthetic CP source did not load');
      if(state.cp.rows.length<count)throw Error('Synthetic source has too few rows');
      kolRows=kolNormalizeModelGroups(state.cp.rows.slice(0,count).map(row=>cpRowToKolRow(row)));
      saveKolRows();renderKol();
    },seedCollection);
    await page.waitForFunction(()=>document.querySelector('#kolTable tbody tr[data-id]'),null,{timeout:60000});
    collectionFixture=await page.evaluate(()=>({rows:kolRows.length,canEdit:kolWorkspaceCanEdit,own:kolIsOwnWorkspace(),catalogFields:Object.keys(state.collectionCatalogs||{})}));
    assert.equal(collectionFixture.rows,seedCollection,'the real Collection screen must contain the requested synthetic rows');
    assert.equal(collectionFixture.canEdit,true);assert.equal(collectionFixture.own,true);
    assert.equal(collectionFixture.catalogFields.length,12);assert.ok(collectionFixture.catalogFields.includes('manufacturer'));
  }
  await page.evaluate(() => document.querySelectorAll('dialog[open]').forEach(dialog => dialog.close()));
  assert.equal(await page.locator('.blRnDialog[open]').count(), 0);
  assert.deepEqual(errors, []);
  const observed = await page.evaluate(() => ({ lang: appLang, documentLang: document.documentElement.lang, theme: document.documentElement.dataset.theme }));
  assert.deepEqual(observed, { lang, documentLang: lang, theme }, 'The requested language and theme must actually be active');
  const preparationLayout=capture==='workspace'?await page.evaluate(()=>{
    const root=document.documentElement,previous=root.style.getPropertyValue('--ui-font-add');
    const result=[];
    try{for(const fontAdd of [0,4]){
      root.style.setProperty('--ui-font-add',fontAdd+'px');
      for(const button of document.querySelectorAll('nav.tabs button.hasModulePreparation')){
        const label=button.querySelector(':scope>span[data-i18n-tr]'),badge=button.querySelector('[data-module-preparation]');
        result.push({fontAdd,module:button.dataset.tab,labelBottom:label.getBoundingClientRect().bottom,badgeTop:badge.getBoundingClientRect().top});
      }
    }}finally{if(previous)root.style.setProperty('--ui-font-add',previous);else root.style.removeProperty('--ui-font-add');}
    return result;
  }):[];
  for(const item of preparationLayout)assert.ok(item.badgeTop>=item.labelBottom-0.5,'module label and status must not overlap at font step '+item.fontAdd+': '+item.module);
  if(capture==='workspace'){fs.mkdirSync(path.dirname(screenshot), { recursive: true }); await page.screenshot({ path: screenshot });}
  const afterContinue=await page.evaluate(()=>({moduleStates:window.BLModulePreparation?.snapshot(),metrics:window.BLPerf?.snapshot?.()}));
  fs.writeFileSync(path.join(root, 'acceptance.json'), JSON.stringify({ synthetic: true, screenshot, capture, module: moduleName, lang, theme, observed, rows: 20, beforeContinue, afterContinue, preparationLayout, errorRecovery, collectionFixture, errors }, null, 2));
  console.log(JSON.stringify({ screenshot, evidence: root }));
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  try { await browser?.close(); } finally {
    if (server && server.exitCode === null) {
      const done = new Promise(resolve => server.once('exit', resolve)); server.kill('SIGTERM');
      await Promise.race([done, delay(10000)]); if (server.exitCode === null) { server.kill('SIGKILL'); await done; }
    }
  }
});
