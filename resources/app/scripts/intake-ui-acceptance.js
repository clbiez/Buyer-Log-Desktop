'use strict';
// Actual Buyer Log UI on an isolated server; only INTAKE HTTP responses use demo fixtures.
// Requires Playwright + Chromium. No production source or user data is read.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const app = path.resolve(__dirname, '..');
const root = process.env.BUYER_LOG_INTAKE_ACCEPTANCE_ROOT || fs.mkdtempSync(path.join(os.tmpdir(), 'buyerlog-intake-'));
fs.mkdirSync(root, { recursive: true });
const port = Number(process.env.BUYER_LOG_INTAKE_ACCEPTANCE_PORT || 6493);
const base = `http://127.0.0.1:${port}`;
const env = { ...process.env, BUYER_LOG_CONFIG_PATH: path.join(root, 'config.json') };
for (const [key, dir] of Object.entries({ BUYER_LOG_DATA_ROOT: 'app', BUYER_LOG_SERVER_DATA_ROOT: 'server', BUYER_LOG_LOCAL_DATA_ROOT: 'local', BUYER_LOG_TEMP_ROOT: 'temp' })) {
  env[key] = path.join(root, dir);
  fs.mkdirSync(env[key], { recursive: true });
}
env.BUYER_LOG_AUTH_DATA_ROOT = env.BUYER_LOG_SERVER_DATA_ROOT;
env.BL_DATA_DIR = env.BUYER_LOG_SERVER_DATA_ROOT;
fs.writeFileSync(env.BUYER_LOG_CONFIG_PATH, JSON.stringify({ port, host: '127.0.0.1', updates: { enabled: false } }));
const intake = require('../server/lib/intake-report');
const viewConfig = intake.defaultViewConfig();
const fields = intake.defaultFields();
const rows = [0, 1, 2].map(index => Object.fromEntries([
  ...viewConfig.query.rows.map(field => [field.id, /dönem/i.test(field.name) ? ['Ocak', 'Şubat', 'Mart'][index] : 'DEMO']),
  ...viewConfig.query.measures.map((field, measure) => [field.id, (index + 1) * (measure + 1) * 100]),
]));
const fixture = { ok: true, fields, viewConfig, rows, fetchedAt: '2026-11-04T08:00:00Z', offline: false };
const log = fs.openSync(path.join(root, 'server.log'), 'a');
const server = spawn(process.execPath, ['server/server.js'], { cwd: app, env, stdio: ['ignore', log, log] });
let browser;
(async () => {
  console.log('Artifacts:', root);
  let ready = false;
  for (let i = 0; i < 120; i++) {
    try { ready = (await fetch(base + '/api/health')).status < 500; if (ready) break; } catch {}
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  assert.ok(ready, 'Isolated Buyer Log server did not start; see server.log');
  const login = await fetch(base + '/api/user-login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId: 'moderator', password: 'demo-intake-123', newPassword: 'demo-intake-123' }),
  });
  assert.ok(login.ok, await login.clone().text());
  const cookie = login.headers.get('set-cookie').split(';')[0], split = cookie.indexOf('=');
  browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || '/usr/bin/chromium', args: ['--no-sandbox'] });
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, reducedMotion: 'reduce' });
  await context.addCookies([{ name: cookie.slice(0, split), value: cookie.slice(split + 1), domain: '127.0.0.1', path: '/', httpOnly: true }]);
  await context.addInitScript(() => localStorage.setItem('bl.releaseNotes.lastSeenStable.v1', '99.0.0'));
  const page = await context.newPage(), errors = [], results = [];
  page.setDefaultTimeout(10000);
  let stateCalls = 0, reportCalls = 0, failState = false, failReport = false, includeSnapshot = true;
  page.on('pageerror', error => errors.push(error.message));
  page.on('dialog', dialog => dialog.dismiss());
  await page.route('**/api/intake/**', async route => {
    const url = new URL(route.request().url());
    let payload = fixture, status = 200;
    if (url.pathname.endsWith('/state')) {
      stateCalls++;
      payload = { ...fixture, snapshot: includeSnapshot ? fixture : null };
      if (failState) { payload = { error: 'Demo state unavailable' }; status = 503; }
    } else if (url.pathname.endsWith('/report')) {
      reportCalls++;
      if (failReport) { payload = { error: 'Demo report unavailable' }; status = 503; }
    } else if (url.pathname.endsWith('/settings') && route.request().method() === 'PUT') {
      payload = { ...fixture, viewConfig: route.request().postDataJSON().viewConfig || viewConfig };
    } else if (url.pathname.endsWith('/distinct')) payload = { values: ['DEMO'] };
    await route.fulfill({ status, json: payload });
  });
  async function open(module) {
    await page.goto(base + '/?module=' + module, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof switchTab === 'function', null, { timeout: 60000 });
    await page.getByText(/Buyer Log'a devam et|Continue to Buyer Log/).click({ timeout: 4000 }).catch(() => {});
    await page.waitForFunction(() => !document.getElementById('blBootGuard'), null, { timeout: 15000 });
    await page.waitForFunction(() => postUiStartupScheduled && document.body.dataset.activeTab === new URLSearchParams(location.search).get('module'));
    // Let the deferred startup timer finish while the opening module is still active.
    await page.waitForTimeout(800);
  }
  async function showIntake() {
    await page.evaluate(() => {
      const index = BLOverviewHome.state().pages.findIndex(page => page.items.some(item => item.key === 'intake'));
      BLOverviewHome.goToPage(index);
    });
    await page.locator('#intakeSection').scrollIntoViewIfNeeded();
  }
  await open('orders');
  assert.equal(await page.evaluate(() => Boolean(window.BLINTAKE)), false, 'INTAKE must stay lazy outside Overview');
  assert.equal(stateCalls, 0);
  await page.evaluate(() => switchTab('overview'));
  await showIntake();
  await page.waitForFunction(() => window.BLINTAKE?.state.loaded, null, { timeout: 5000 });
  await page.locator('#intakeTable tbody tr').first().waitFor();
  assert.equal(await page.locator('#intakeTable').isVisible(), true);
  assert.equal(stateCalls, 1);
  results.push('Orders cold start → Overview loads the INTAKE snapshot and table');
  for (const lang of ['tr', 'en']) {
    await page.evaluate(lang => applyLanguage(lang), lang);
    const before = reportCalls;
    await page.locator('#intakeRefreshBtn').click();
    await page.waitForFunction(() => !window.BLINTAKE.state.loading);
    assert.equal(reportCalls, before + 1);
    await page.locator('#intakeFieldsBtn').click();
    await page.locator('#_intakeFieldsModal').waitFor();
    await page.locator('#_intakeFieldsModal [data-intake-close]').first().click();
    await page.locator('#_intakeFieldsModal').waitFor({ state: 'hidden' });
    await page.locator('#intakeFiltersBtn').click();
    assert.equal(await page.locator('#intakeFilterPanel').isVisible(), true);
    await page.keyboard.press('Escape');
    results.push(`${lang}: refresh, pivot settings and filters work`);
  }
  const beforeState = stateCalls;
  await page.evaluate(() => { switchTab('orders'); switchTab('overview'); switchTab('overview'); });
  assert.equal(stateCalls, beforeState, 'Returning must reuse the initialized module');
  assert.equal(await page.locator('script[src*="intake.js"]').count(), 1, 'Do not duplicate script or event bindings');
  const screenshot = process.env.BUYER_LOG_INTAKE_SCREENSHOT;
  if (screenshot) {
    await page.evaluate(async () => { applyLanguage('tr'); await BLINTAKE.refresh(); });
    await showIntake();
    const originalLayout = await page.evaluate(() => {
      const layout = BLOverviewHome.state(), original = JSON.stringify(layout);
      layout.pages[layout.page].items = [{ key: 'intake', x: 0, y: 0, w: 12, h: 14 }];
      BLStorage.setItem(BLOverviewHome.STORAGE_KEY, JSON.stringify(layout));
      BLOverviewHome.reload();
      return original;
    });
    await page.locator('#intakeSection').screenshot({ path: screenshot });
    await page.evaluate(original => { BLStorage.setItem(BLOverviewHome.STORAGE_KEY, original); BLOverviewHome.reload(); }, originalLayout);
  }
  includeSnapshot = false;
  await open('overview');
  await showIntake();
  await page.waitForFunction(() => window.BLINTAKE?.state.loaded);
  results.push('Overview cold start without a snapshot loads the report when visible');
  failState = true; failReport = true;
  await open('orders');
  await page.evaluate(() => switchTab('overview'));
  await showIntake();
  await page.waitForFunction(() => document.getElementById('intakeStatus').textContent === 'Demo state unavailable');
  assert.equal(await page.locator('#intakeBody').isVisible(), true);
  await page.locator('#intakeRefreshBtn').click();
  await page.waitForFunction(() => document.getElementById('intakeStatus').textContent === 'Demo report unavailable');
  failReport = false;
  await page.locator('#intakeRefreshBtn').click();
  await page.waitForFunction(() => window.BLINTAKE.state.loaded && !window.BLINTAKE.state.loading);
  results.push('Failed state/report requests remain visible and Refresh recovers');
  assert.deepEqual(errors, [], 'Browser JavaScript errors');
  fs.writeFileSync(path.join(root, 'results.json'), JSON.stringify(results, null, 2));
  console.log('PASS', results);
})().catch(async error => {
  console.error(error);
  const page = browser?.contexts()[0]?.pages()[0];
  if (page) {
    await page.screenshot({ path: path.join(root, 'failure.png') });
    console.error(await page.evaluate(() => ({ activeTab: document.body.dataset.activeTab, intake: Boolean(window.BLINTAKE), boot: document.getElementById('blBootGuard')?.textContent, errors: document.querySelector('.loginError')?.textContent })));
  }
  process.exitCode = 1;
}).finally(async () => {
  if (browser) await browser.close();
  if (server.exitCode === null) {
    const stopped = new Promise(resolve => server.once('exit', resolve));
    server.kill('SIGTERM');
    const timer = setTimeout(() => server.kill('SIGKILL'), 5000);
    await stopped;
    clearTimeout(timer);
  }
  fs.closeSync(log);
});
