'use strict';
// Actual Buyer Log UI on an isolated server; OAB/INTAKE HTTP responses use demo fixtures.
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
  const excel = require('../server/lib/intake-excel');
  const exportPlan = excel.prepare({ fields, viewConfig });
  const exportBuffer = excel.createWorkbook({ connection: { server: 'demo-server', catalog: 'demo-catalog' }, plan: exportPlan, rows });
  let exportCalls = 0;
  const oabPivot = { rows: ['Season', 'Month', 'Class'], columns: [], values: [{ field: 'Amount', agg: 'SUM' }], grouped: true, showSubtotals: true };
  const oabRows = ['January', 'February', 'March'].flatMap((month, i) => ['Demo A', 'Demo B'].map(name => ({ Season: 'S7', Month: month, Class: name, Amount: (i + 1) * 100, 'Wssi Sipariş Miktarı YD': 100 })));
  await page.route('**/api/oab/**', async route => {
    const endpoint = new URL(route.request().url()).pathname.split('/').pop();
    const payload = {
      seasons: { seasons: [{ SeasonRef: 1, Name: 'S7' }] },
      mag: { mag: [{ MerchSubGroupRef: 1, Name: 'DEMO' }] },
      'buyer-groups': { buyerGroups: [{ BuyerGroupRef: 1, Name: 'DEMO' }] },
      settings: { settings: { pivotConfig: oabPivot } },
      state: { state: { selection: { seasonRef: 1, merchSubGroupRef: 1, buyerGroupRef: 1 }, snapshot: { rows: oabRows, fields: ['Season', 'Month', 'Class', 'Amount'] } } },
    }[endpoint] || {};
    await route.fulfill({ json: { ok: true, ...payload } });
  });
  await page.route('**/api/intake/**', async route => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/export')) {
      exportCalls++;
      const body = route.request().postDataJSON();
      assert.ok(body.viewConfig.query.measures.length);
      assert.ok(['tr', 'en'].includes(body.language));
      return route.fulfill({ status: 200, contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', body: exportBuffer });
    }
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
  // Stacked full-width widgets must shrink independently and move the next
  // widget with them, without persisting measured pixel sizes into preferences.
  const savedLayout = await page.evaluate(() => {
    const layout = BLOverviewHome.state(), old = JSON.stringify(layout);
    layout.pages[layout.page].items = [{ key: 'oab', x: 0, y: 0, w: 12, h: 10 }, { key: 'intake', x: 0, y: 10, w: 12, h: 10 }];
    BLStorage.setItem(BLOverviewHome.STORAGE_KEY, JSON.stringify(layout));BLOverviewHome.reload();return old;
  });
  await page.waitForFunction(() => document.querySelectorAll('#oabTable tbody tr').length > 1);
  if (await page.locator('#oabExpandAllBtn').isEnabled()) await page.locator('#oabExpandAllBtn').click();
  await page.waitForTimeout(500);
  const measure = id => page.locator('#' + id + 'Section').evaluate(el => {
    const wrap = el.querySelector('.' + (el.id === 'oabSection' ? 'oab' : 'intake') + 'TableWrap'), table = wrap.querySelector('table');
    const r = el.getBoundingClientRect(), t = table.getBoundingClientRect();
    return { height: r.height, top: r.top, bottom: r.bottom, tableBottom: t.bottom, verticalOverflow: wrap.scrollHeight - wrap.clientHeight, rows: table.tBodies[0].rows.length };
  });
  const check = async () => {
    for (const id of ['oab', 'intake']) {
      const m = await measure(id);
      assert.ok(m.verticalOverflow <= 1, id + ': no internal vertical scroll');
      assert.ok(m.bottom >= m.tableBottom, id + ': total row is inside the widget');
      assert.ok(m.bottom - m.tableBottom < 35, id + ': no unused fixed-height area');
    }
    const a = await measure('oab'), b = await measure('intake');
    assert.ok(b.top >= a.bottom, 'stacked widgets never overlap');
    assert.ok(b.top - a.bottom < 25, 'layout closes the gap after the pivot');
  };
  await check();
  for (const id of ['oab', 'intake']) {
    const expanded = await measure(id);
    await page.locator('#' + id + 'CollapseAllBtn').click();await page.waitForTimeout(500);
    const collapsed = await measure(id);
    assert.ok(collapsed.height < expanded.height - 20, id + ': collapse shrinks the widget ' + JSON.stringify({ expanded, collapsed }));
    await check();
    await page.locator('#' + id + 'ExpandAllBtn').click();await page.waitForTimeout(500);
    assert.ok((await measure(id)).height > collapsed.height + 20, id + ': expand grows the widget');
    await check();
  }
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.evaluate(() => {
    window.pivotAnimations = [];
    const original = Element.prototype.animate;
    Element.prototype.animate = function(frames, options) { if (this.id === 'intakeSection' || this.tagName === 'TR') pivotAnimations.push({ id: this.id, tag: this.tagName, duration: options.duration });return original.call(this, frames, options); };
  });
  await page.locator('#intakeCollapseAllBtn').click();await page.waitForTimeout(500);
  const motionCollapsed = (await measure('intake')).height;
  await page.locator('#intakeExpandAllBtn').click();await page.waitForTimeout(90);
  const motionMiddle = (await measure('intake')).height;
  await page.waitForTimeout(400);
  const motionExpanded = (await measure('intake')).height;
  assert.ok(motionMiddle > motionCollapsed + 1 && motionMiddle < motionExpanded - 1, 'module height actually interpolates between collapsed and expanded sizes');
  const animations = await page.evaluate(() => pivotAnimations);
  assert.ok(animations.some(a => a.id === 'intakeSection'), 'module height uses shared Motion+');
  assert.ok(animations.some(a => a.tag === 'TR'), 'pivot rows animate through shared Motion+');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.evaluate(() => { pivotAnimations.length = 0; });
  await page.locator('#intakeCollapseAllBtn').click();await page.waitForTimeout(100);
  assert.equal(await page.evaluate(() => pivotAnimations.length), 0, 'reduced motion skips all pivot animation');
  await page.locator('#intakeExpandAllBtn').click();await page.waitForTimeout(100);
  const downloadPromise = page.waitForEvent('download');
  await page.locator('#intakeExcelExportBtn').click();
  const download = await downloadPromise;await download.saveAs(path.join(root, download.suggestedFilename()));
  assert.equal(exportCalls, 1);assert.equal(download.suggestedFilename(), 'INTAKE-Live-Pivot.xlsx');
  if (process.env.BUYER_LOG_PIVOT_SCREENSHOT) {
    await page.locator('#oabCollapseAllBtn').click();await page.waitForTimeout(100);
    await page.evaluate(() => { applyLanguage('tr');document.getElementById('oabSection').scrollIntoView({ block: 'start' }); });
    await page.screenshot({ path: process.env.BUYER_LOG_PIVOT_SCREENSHOT });
  }
  for (const width of [800, 1600]) {
    await page.setViewportSize({ width, height: 1000 });await page.waitForTimeout(150);await check();
  }
  // Over the old virtualization threshold: page scrolling still reaches real
  // leaf rows and the grand total, with no internal scrolling or blank spacers.
  const initialRows = fixture.rows;
  fixture.rows = Array.from({ length: 410 }, (_, n) => Object.fromEntries([
    ...viewConfig.query.rows.map((f, i) => [f.id, i === 0 ? 'DEMO' : i === 1 ? 'January' : 'Demo ' + n]),
    ...viewConfig.query.measures.map(f => [f.id, n + 1]),
  ]));
  await page.evaluate(() => BLINTAKE.refresh());
  await page.locator('#intakeTable tbody tr').last().scrollIntoViewIfNeeded();
  assert.ok(await page.locator('#intakeTable tbody tr').count() > 400);
  assert.equal(await page.locator('#intakeTable .virtualSpacerRow').count(), 0);
  assert.ok(await page.locator('#intakeTable .oabPivotGrandTotalRow').isVisible());
  await check();
  fixture.rows = initialRows;await page.evaluate(() => BLINTAKE.refresh());
  await page.evaluate(old => { BLStorage.setItem(BLOverviewHome.STORAGE_KEY, old);BLOverviewHome.reload(); }, savedLayout);
  results.push('Both pivots: natural height, group collapse/expand, reflow, shared motion, reduced motion, mobile layout, 410 real rows and native Excel download');
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
