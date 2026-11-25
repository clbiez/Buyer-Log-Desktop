'use strict';
// Çok kullanıcılı gerçek tarayıcı kabulü için izole gerçek Buyer Log sunucusu.
// Sunucu açılışı client-performance-app.js ile aynıdır (demo veri, izole kökler);
// fark: sentetik hesap oluşturma ve kullanıcı başına ayrı BrowserContext açma.
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), net = require('node:net');
const { spawn, spawnSync } = require('node:child_process');
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { initializeBenchmarkState } = require('./startup-benchmark');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const PASSWORD = 'synthetic-multiuser-only-123';

async function freePort() {
  const socket = net.createServer(); await new Promise(resolve => socket.listen(0, '127.0.0.1', resolve));
  const port = socket.address().port; await new Promise(resolve => socket.close(resolve)); return port;
}

async function startServer(options = {}) {
  const app = path.resolve(__dirname, '../..'), root = options.root || fs.mkdtempSync(path.join(os.tmpdir(), 'bl-multiuser-'));
  const port = await freePort(), base = 'http://127.0.0.1:' + port, source = path.join(root, 'source');
  const generated = spawnSync(process.execPath, [path.join(app, 'scripts/generate-demo-data.js'), source, '--rows', String(options.demoRows || 20), '--seed', '7'], { cwd: app, encoding: 'utf8' });
  assert.equal(generated.status, 0, generated.stderr); initializeBenchmarkState(root);
  const env = { ...process.env, BUYER_LOG_CENTRAL_IAM_ENABLED: '0', BUYER_LOG_SERVER_DATA_ROOT: path.join(root, 'data'), BUYER_LOG_AUTH_DATA_ROOT: path.join(root, 'data'), BUYER_LOG_DATA_ROOT: path.join(root, 'app'), BUYER_LOG_LOCAL_DATA_ROOT: path.join(root, 'local'), BUYER_LOG_LOCAL_DB: path.join(root, 'local/BuyerLogLocal.db'), BUYER_LOG_CONFIG_PATH: path.join(root, 'config.json'), BUYER_LOG_TEMP_ROOT: path.join(root, 'tmp') };
  fs.writeFileSync(env.BUYER_LOG_CONFIG_PATH, JSON.stringify({ port, host: '127.0.0.1', sourceFolder: source, updates: { enabled: false } }));
  const log = fs.openSync(path.join(root, 'server.log'), 'a');
  const child = spawn(process.execPath, ['server/server.js'], { cwd: app, env, stdio: ['ignore', log, log] }); fs.closeSync(log);
  const server = { root, base, port, child };
  // Ham HTTP istemcisi: her çağrı kendi çerezini taşır (kullanıcı başına oturum).
  server.api = async (url, { method = 'GET', body, cookie, expect } = {}) => {
    const response = await fetch(base + url, { method, signal: AbortSignal.timeout(60000), headers: { ...(cookie ? { cookie } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await response.text(); let data; try { data = JSON.parse(text); } catch (_) { data = { raw: text.slice(0, 400) }; }
    if (expect !== undefined) assert.equal(response.status, expect, `${method} ${url}: ${response.status} ${text.slice(0, 300)}`);
    return { status: response.status, data, cookie: (response.headers.get('set-cookie') || '').split(';')[0] };
  };
  server.login = async (userId) => {
    const result = await server.api('/api/user-login', { method: 'POST', body: { userId, password: PASSWORD, newPassword: PASSWORD }, expect: 200 });
    return result.cookie;
  };
  server.close = async () => { if (child.exitCode === null) { child.kill('SIGTERM'); await Promise.race([new Promise(resolve => child.once('exit', resolve)), delay(10000)]); if (child.exitCode === null) child.kill('SIGKILL'); } };
  try {
    let ready = false;
    for (let i = 0; i < 160; i++) { try { const r = await server.api('/api/status'); if (r.status === 200) { ready = true; break; } } catch (_) {} await delay(250); }
    assert.ok(ready, 'Synthetic server did not start: ' + root);
    server.moderatorCookie = await server.login('moderator');
    { const started = await server.api('/api/refresh', { method: 'POST', body: {}, cookie: server.moderatorCookie }); assert.ok(started.status === 200 || started.status === 202, 'refresh ' + started.status); }
    let refreshed = false;
    for (let i = 0; i < 240; i++) { const status = (await server.api('/api/refresh-status', { cookie: server.moderatorCookie })).data; if (!status.running) { assert.equal(status.error, null); refreshed = true; break; } await delay(250); }
    assert.ok(refreshed, 'Synthetic refresh did not finish');
    return server;
  } catch (error) { await server.close(); throw error; }
}

async function createBuyer(server, username) {
  const created = await server.api('/api/users', { method: 'POST', cookie: server.moderatorCookie, expect: 201, body: { username, displayName: username, title: 'Synthetic buyer', password: PASSWORD, systemRole: 'buyer', managerId: 'moderator' } });
  return { id: created.data.user.id, username, displayName: username };
}

async function launchBrowser() {
  return chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: ['--no-sandbox'] });
}

// Kullanıcı başına ayrı BrowserContext: ayrı çerez, ayrı localStorage, ayrı SSE.
async function openUser(browser, server, account, options = {}) {
  const context = await browser.newContext({ viewport: options.viewport || { width: 1600, height: 900 }, reducedMotion: 'reduce', deviceScaleFactor: options.deviceScaleFactor || 1 });
  const cookie = await server.login(account.id), split = cookie.indexOf('=');
  await context.addCookies([{ name: cookie.slice(0, split), value: cookie.slice(split + 1), url: server.base, httpOnly: true }]);
  await context.addInitScript(({ id, lang }) => {
    try {
      localStorage.setItem(`bl.user.${id}.lcw.lang.v1`, lang); localStorage.setItem(`bl.user.${id}.lcw_theme`, 'light');
      for (const key of ['bl.releaseNotes.lastSeenStable.v1', `bl.user.${id}.bl.releaseNotes.lastSeenStable.v1`]) localStorage.setItem(key, '99.0.0');
    } catch (_) {}
  }, { id: account.id, lang: options.lang || 'tr' });
  const page = await context.newPage(), errors = [], consoleErrors = [], failedImages = [];
  page.on('pageerror', error => errors.push(String(error && error.message || error)));
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text().slice(0, 300)); });
  page.on('response', response => { const url = response.url(); if (/\/api\/(collection-images|model-images)\//.test(url) && response.status() >= 400) failedImages.push({ url, status: response.status() }); });
  await page.route('https://**', route => route.abort());
  page.setDefaultTimeout(60000);
  await page.goto(server.base + '/?module=overview', { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForFunction(() => !document.getElementById('blBootGuard') || document.querySelector('[data-boot-continue]'), null, { timeout: 180000 });
  if (await page.locator('[data-boot-continue]').count()) await page.click('[data-boot-continue]');
  await page.waitForFunction(() => !document.getElementById('blBootGuard'), null, { timeout: 180000 });
  await page.evaluate(() => document.querySelectorAll('dialog[open]').forEach(dialog => dialog.close()));
  return { account, context, page, errors, consoleErrors, failedImages, close: () => context.close().catch(() => {}) };
}

module.exports = { PASSWORD, startServer, createBuyer, launchBrowser, openUser, delay };
