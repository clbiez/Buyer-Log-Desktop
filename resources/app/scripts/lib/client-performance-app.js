'use strict';
// Sentetik istemci kabulü için izole gerçek Buyer Log sunucusu ve tarayıcısı.
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), net = require('node:net');
const { spawn, spawnSync } = require('node:child_process');
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { initializeBenchmarkState } = require('./startup-benchmark');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function start(options = {}) {
  const app = path.resolve(__dirname, '../..'), root = fs.mkdtempSync(path.join(os.tmpdir(), 'bl-client-acceptance-'));
  let server, browser;
  const close = async () => { if (browser) await browser.close(); if (server) { server.kill('SIGTERM'); await new Promise(resolve => server.exitCode !== null ? resolve() : server.once('exit', resolve)); } };
  try {
    const socket = net.createServer(); await new Promise(resolve => socket.listen(0, '127.0.0.1', resolve));
    const port = socket.address().port; await new Promise(resolve => socket.close(resolve));
    const base = 'http://127.0.0.1:' + port, source = path.join(root, 'source');
    const generated = spawnSync(process.execPath, [path.join(app, 'scripts/generate-demo-data.js'), source, '--rows', '20', '--seed', '7'], { cwd: app, encoding: 'utf8' });
    assert.equal(generated.status, 0, generated.stderr); initializeBenchmarkState(root);
    const env = { ...process.env, BUYER_LOG_CENTRAL_IAM_ENABLED: '0', BUYER_LOG_SERVER_DATA_ROOT: path.join(root, 'data'), BUYER_LOG_AUTH_DATA_ROOT: path.join(root, 'data'), BUYER_LOG_DATA_ROOT: path.join(root, 'app'), BUYER_LOG_LOCAL_DATA_ROOT: path.join(root, 'local'), BUYER_LOG_LOCAL_DB: path.join(root, 'local/BuyerLogLocal.db'), BUYER_LOG_CONFIG_PATH: path.join(root, 'config.json'), BUYER_LOG_TEMP_ROOT: path.join(root, 'tmp') };
    fs.writeFileSync(env.BUYER_LOG_CONFIG_PATH, JSON.stringify({ port, host: '127.0.0.1', sourceFolder: source, updates: { enabled: false } }));
    const log = fs.openSync(path.join(root, 'server.log'), 'a');
    server = spawn(process.execPath, ['server/server.js'], { cwd: app, env, stdio: ['ignore', log, log] }); fs.closeSync(log);
    let cookie = '';
    const api = async (url, body, method = 'POST') => {
      const response = await fetch(base + url, { method: body === undefined ? 'GET' : method, signal: AbortSignal.timeout(60000), headers: { cookie, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
      assert.ok(response.ok, url + ': ' + response.status); return response;
    };
    let ready = false;
    for (let i = 0; i < 120; i++) { try { await api('/api/status'); ready = true; break; } catch (_) {} await delay(250); }
    assert.ok(ready, 'Synthetic server did not start: ' + root);
    const login = await api('/api/user-login', { userId: 'moderator', password: 'synthetic-perf-only-123', newPassword: 'synthetic-perf-only-123' });
    cookie = login.headers.get('set-cookie').split(';')[0]; await api('/api/refresh', {});
    let refreshed = false;
    for (let i = 0; i < 240; i++) { const status = await (await api('/api/refresh-status')).json(); if (!status.running) { assert.equal(status.error, null); refreshed = true; break; } await delay(250); }
    assert.ok(refreshed, 'Synthetic refresh did not finish');
    browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: ['--no-sandbox'] });
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
    const split = cookie.indexOf('='); await context.addCookies([{ name: cookie.slice(0, split), value: cookie.slice(split + 1), url: base, httpOnly: true }]);
    await context.addInitScript(() => { localStorage.setItem('bl.user.moderator.lcw.lang.v1', 'tr'); localStorage.setItem('bl.user.moderator.lcw_theme', 'light'); for (const key of ['bl.releaseNotes.lastSeenStable.v1', 'bl.user.moderator.bl.releaseNotes.lastSeenStable.v1']) localStorage.setItem(key, '99.0.0'); });
    if (options.initScript) await context.addInitScript(options.initScript, options.initArg);
    const page = await context.newPage(), errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.route('https://**', route => route.abort());
    await page.goto(base + '/?module=overview', { waitUntil: 'domcontentloaded', timeout: 120000 });
    await page.waitForSelector('[data-boot-continue]', { timeout: 180000 }); await page.click('[data-boot-continue]');
    await page.waitForFunction(() => !document.getElementById('blBootGuard'), null, { timeout: 180000 });
    await page.evaluate(() => document.querySelectorAll('dialog[open]').forEach(dialog => dialog.close()));
    return { page, api, root, errors, close };
  } catch (error) { await close(); throw error; }
}
module.exports = { start };
