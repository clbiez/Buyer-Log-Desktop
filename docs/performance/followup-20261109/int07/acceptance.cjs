'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { chromium } = require('/opt/codex/cua_node/lib/node_modules/playwright');
const repo = path.resolve(__dirname, '../../../..');
const app = path.join(repo, 'resources/app');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'int07-app-'));
const base = 'http://127.0.0.1:6487';
const metricsPath = path.join(root, 'metrics.json');
const log = fs.openSync(path.join(__dirname, 'application.log'), 'w');
fs.writeFileSync(path.join(root, 'config.json'), JSON.stringify({ port: 6487 }));
const env = { ...process.env, BUYER_LOG_SERVER_DATA_ROOT: path.join(root, 'server'), BUYER_LOG_DATA_ROOT: path.join(root, 'app'), BUYER_LOG_LOCAL_DATA_ROOT: path.join(root, 'local'), BUYER_LOG_CONFIG_PATH: path.join(root, 'config.json'), BUYER_LOG_TEMP_ROOT: path.join(root, 'tmp'), INT07_APP_ROOT: app, INT07_METRICS: metricsPath };
const server = spawn(process.execPath, ['--require', path.join(__dirname, 'synthetic-preload.cjs'), path.join(app, 'server/server.js')], { cwd: app, env, stdio: ['ignore', log, log] });
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
let browser;
(async () => {
  try {
    let ready = false;
    for (let i = 0; i < 120; i++) {
      if (server.exitCode !== null) throw new Error(`server exited ${server.exitCode}`);
      try { if ((await fetch(base + '/api/health')).ok) { ready = true; break; } } catch {}
      await pause(250);
    }
    assert.ok(ready, 'Actual app became ready');
    const login = await fetch(base + '/api/user-login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId: 'moderator', password: 'int07-demo-password', newPassword: 'int07-demo-password' }) });
    assert.ok(login.ok, 'Demo moderator login');
    const cookie = login.headers.get('set-cookie').split(';')[0];
    const api = async (route, body) => {
      const r = await fetch(base + route, { method: body ? 'POST' : 'GET', headers: { cookie, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
      const result = await r.json(); assert.ok(r.ok, JSON.stringify(result)); return result;
    };
    const responses = await Promise.all([100, 110].map(first => api('/api/plm-sync/fetch', { scope: 'cp', language: 'en', bomMode: 'inline', plmIds: Array.from({ length: 5 }, (_, i) => String(first + i)) })));
    fs.writeFileSync(path.join(__dirname, 'application-responses.json'), JSON.stringify(responses, null, 2) + '\n');
    const metrics = JSON.parse(fs.readFileSync(metricsPath));
    assert.equal(metrics.attempts, 80); assert.equal(metrics.active, 0); assert.ok(metrics.peak <= 5); assert.ok(metrics.peak > 1);
    const detail = await api('/api/plm-sync/bom/100');
    assert.equal(detail.entry.setComponents.length, 6); assert.equal(detail.entry.totalPrintCount, 6);
    const batch = await api('/api/plm-sync/bom/batch', { plmIds: ['100', '110'] });
    fs.writeFileSync(path.join(__dirname, 'application-batch.json'), JSON.stringify(batch, null, 2) + '\n');
    browser = await chromium.launch({ headless: true, executablePath: '/usr/bin/chromium', args: ['--no-sandbox'] });
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const [name, value] = cookie.split('=');
    await context.addCookies([{ name, value, domain: '127.0.0.1', path: '/', httpOnly: true }]);
    const page = await context.newPage();
    await page.goto(base, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.querySelector('nav.tabs button[data-tab="cp"]'), null, { timeout: 60000 });
    const go = page.getByText(/Buyer Log'a devam et|Continue to Buyer Log/);
    await go.waitFor({ timeout: 15000 }).then(() => go.click()).catch(() => {});
    await page.waitForFunction(() => !document.getElementById('blBootGuard'), null, { timeout: 60000 });
    await page.evaluate(() => document.querySelectorAll('dialog[open]').forEach(d => d.close()));
    await page.addScriptTag({ url: base + '/plm-bom.js' });
    await page.evaluate(() => window.BLPlmBom.openForPlm('100', 'DEMO INT07 · six synthetic set parts'));
    await page.waitForFunction(() => document.querySelectorAll('.cpaModalBody .cpaTable tbody tr').length === 12, null, { timeout: 30000 });
    await page.waitForTimeout(800);
    await page.evaluate(() => document.querySelectorAll('dialog[open]').forEach(d => d.close()));
    assert.ok(await page.locator('.cpaModal').isVisible());
    assert.ok(await page.evaluate(() => Boolean(document.elementFromPoint(720, 450)?.closest('.cpaModal'))), 'BOM is the visible foreground content');
    const png = path.join(app, 'public/release-notes/next-assets/int07-bom-owner-read-budget-20261109.png');
    await page.screenshot({ path: png });
    const report = { status: 'PASS_PARTIAL_SCOPE', actualApplication: true, actualHttpClient: true, syntheticRemote: true, sameOwnerConcurrentJobs: 2, setStylesPerJob: 5, childrenPerSet: 6, ...metrics, persistedSetParts: detail.entry.setComponents.length, persistedPrintCount: detail.entry.totalPrintCount, screenshot: path.relative(repo, png), activeCancellation: 'BLOCKED: unchanged client ignores external AbortSignal', hardDeadline: 'BLOCKED: unchanged client clears timeout before body decoding', productionCapacityClaim: false };
    fs.writeFileSync(path.join(__dirname, 'application-acceptance.json'), JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await browser?.close(); server.kill('SIGTERM'); fs.closeSync(log);
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
