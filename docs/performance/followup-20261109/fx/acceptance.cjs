'use strict';
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), net = require('node:net');
const assert = require('node:assert/strict');
const { fork, execFileSync } = require('node:child_process'), { createRequire } = require('node:module');
const { chromium } = require('playwright');
const repo = path.resolve(__dirname, '../../../..'), app = path.join(repo, 'resources/app');
const appRequire = createRequire(path.join(app, 'package.json')), XLSX = appRequire('xlsx');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'buyerlog-fx-acceptance-'));
const source = path.join(root, 'source'); fs.mkdirSync(source);
const env = { ...process.env, FX_ACCEPTANCE_APP: app, BUYER_LOG_CONFIG_PATH: path.join(root, 'config.json') };
for (const [key, dir] of Object.entries({ BUYER_LOG_DATA_ROOT: 'app', BUYER_LOG_SERVER_DATA_ROOT: 'server', BUYER_LOG_LOCAL_DATA_ROOT: 'local', BUYER_LOG_TEMP_ROOT: 'temp' })) env[key] = path.join(root, dir);
env.BUYER_LOG_AUTH_DATA_ROOT = env.BUYER_LOG_SERVER_DATA_ROOT; env.BL_DATA_DIR = env.BUYER_LOG_SERVER_DATA_ROOT;
appRequire('./scripts/lib/startup-benchmark').initializeBenchmarkState(root);
const demo = appRequire('./scripts/generate-demo-data').build({ rows: 20, seed: 7, today: new Date('2026-11-09T00:00:00Z') });
for (const [name, rows] of [['ASAS', demo.asas], ['Antrepo', demo.antrepo]]) {
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), name); XLSX.writeFile(wb, path.join(source, `${name} - Demo.xlsx`));
}
function workbook(value = 42, month = '2026-11') {
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    [null, null, month], [null, 'TRY', value], [null, 'EUR', .9], [null, 'GBP', .8],
  ]), 'Synthetic FX'); XLSX.writeFile(wb, path.join(source, 'KUR.xlsx'));
}
let server, browser, base, cookie = '', sequence = 0;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const evidence = { sourceHead: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim(),
  sourceState: 'worktree; SHA-256 pins the exact application files',
  sourceFiles: Object.fromEntries(['server/server.js', 'public/fx.js'].map(file => [file, require('node:crypto').createHash('sha256').update(fs.readFileSync(path.join(app, file))).digest('hex')])),
  syntheticOnly: true, scenarios: [], screenshots: [] };
async function api(url, body, method) {
  const response = await fetch(base + url, { method: method || (body ? 'POST' : 'GET'), headers: { cookie, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  return { response, data: await response.json() };
}
function command(command) {
  return new Promise((resolve, reject) => {
    const id = ++sequence, timeout = setTimeout(() => { server.off('message', receive); reject(new Error('IPC timed out: ' + command)); }, 30000);
    function receive(message) {
      if (message.id !== id) return;
      clearTimeout(timeout); server.off('message', receive);
      if (message.error) reject(new Error(JSON.stringify(message.error))); else resolve(message);
    }
    server.on('message', receive); server.send({ id, command });
  });
}
(async () => {
  const socket = net.createServer(); await new Promise(resolve => socket.listen(0, '127.0.0.1', resolve));
  const port = socket.address().port; await new Promise(resolve => socket.close(resolve)); base = `http://127.0.0.1:${port}`;
  fs.writeFileSync(env.BUYER_LOG_CONFIG_PATH, JSON.stringify({ port, host: '127.0.0.1', sourceFolder: source, updates: { enabled: false } }));
  const log = fs.openSync(path.join(__dirname, 'acceptance-server.log'), 'w');
  server = fork(path.join(__dirname, 'demo-server.cjs'), [], { cwd: app, env, stdio: ['ignore', log, log, 'ipc'] }); fs.closeSync(log);
  let ready = false;
  for (let i = 0; i < 120; i++) { try { ready = (await fetch(base + '/api/health')).ok; if (ready) break; } catch {} await delay(250); }
  assert.ok(ready, 'Actual demo server failed to start');
  const login = await api('/api/user-login', { userId: 'moderator', password: 'synthetic-fx-only-123', newPassword: 'synthetic-fx-only-123' });
  assert.equal(login.response.status, 200); cookie = login.response.headers.get('set-cookie').split(';')[0];
  assert.ok([200, 202].includes((await api('/api/refresh', {})).response.status));
  for (let i = 0; i < 240; i++) { const { data } = await api('/api/refresh-status'); if (!data.running) { assert.equal(data.error, null); break; } await delay(250); }
  const initial = (await api('/api/fx')).data;
  const seeded = await api('/api/fx', { base: 'USD', months: { '2026-10': { TRY: 40 }, '2026-11': { CHF: .8 } }, currencies: ['TRY', 'CHF'], expectedRevision: initial._revision }, 'PUT');
  assert.equal(seeded.response.status, 200); const before = seeded.data;
  workbook();
  const busy = await command('busy'); assert.equal(busy.result.reason, 'worker-busy'); assert.equal(busy.result.updated, false);
  assert.equal(busy.stats.pending, 64); assert.equal(busy.stats.rejected, 1); assert.equal(busy.stats.activeWorkers, busy.stats.maxWorkers);
  assert.equal(busy.store._revision, before._revision); assert.deepEqual(busy.store.months, before.months);
  evidence.scenarios.push({ name: 'default-singleton-admission-busy', ...busy });
  await command('drain');

  browser = await chromium.launch({ headless: true, executablePath: '/usr/bin/chromium', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  const split = cookie.indexOf('='); await context.addCookies([{ name: cookie.slice(0, split), value: cookie.slice(split + 1), url: base, httpOnly: true }]);
  await context.addInitScript(() => {
    for (const key of ['bl.releaseNotes.lastSeenStable.v1', 'bl.user.moderator.bl.releaseNotes.lastSeenStable.v1']) localStorage.setItem(key, '99.0.0');
  });
  const page = await context.newPage(), pageErrors = [], writes = [], external = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('request', request => { if (request.url().includes('/api/fx') && ['PUT', 'POST'].includes(request.method())) writes.push(request.url()); });
  await page.route('https://**', route => { external.push(route.request().url()); return route.abort(); });
  await page.goto(base + '/?module=opencosting', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('[data-boot-continue]', { timeout: 120000 }); await page.click('[data-boot-continue]');
  await page.waitForFunction(() => !document.getElementById('blBootGuard'), null, { timeout: 60000 });
  await page.evaluate(() => switchTab('opencosting')); await page.locator('#ocFxBtn').click();
  await page.locator('#ocFxFolderSync').waitFor();
  for (const lang of ['tr', 'en']) {
    await page.evaluate(lang => { appLang = lang; window.BLI18n?.setLanguage?.(lang); window.renderOpenCostingLanguage(); }, lang);
    const text = await page.locator('#ocFxFolderSync').innerText();
    assert.match(text, lang === 'tr' ? /kuyruğu dolu/ : /queue is full/);
    assert.equal(await page.locator('#ocFxFolderSync button').count(), 0);
    const name = `fx-admission-busy-${lang}-20261109.png`;
    const target = lang === 'tr' ? path.join(app, 'public/release-notes/next-assets', name) : path.join(__dirname, name);
    await page.screenshot({ path: target }); evidence.screenshots.push(name);
  }
  assert.equal(writes.length, 0); evidence.scenarios.push({ name: 'TR-EN-busy-no-AI-no-write', writes: writes.length });
  const applied = await command('sync'); assert.equal(applied.result.updated, true); assert.equal(applied.folderSync, null);
  assert.equal(applied.store._revision, before._revision + 1); assert.equal(applied.store.months['2026-11'].TRY, 42); assert.equal(applied.store.months['2026-11'].CHF, .8);
  const duplicate = await command('sync'); assert.equal(duplicate.result.updated, false); assert.equal(duplicate.store._revision, applied.store._revision);
  evidence.scenarios.push({ name: 'normal-attempt-applies-once', applied, duplicate });
  fs.unlinkSync(path.join(source, 'KUR.xlsx')); const missing = await command('sync'); assert.equal(missing.result.found, false); assert.equal(missing.folderSync, null);
  fs.writeFileSync(path.join(source, 'KUR.xlsx'), 'synthetic corrupt file'); const corrupt = await command('sync'); assert.equal(corrupt.result.reason, 'parse-failed'); assert.equal(corrupt.store._revision, applied.store._revision);
  await page.evaluate(async () => { await BLFX.load(true); window.renderOpenCostingLanguage(); });
  assert.equal(await page.locator('#ocFxFolderSync button').count(), 1); assert.match(await page.locator('#ocFxFolderSync button').innerText(), /LCW AI/);
  evidence.scenarios.push({ name: 'missing-and-corrupt-distinct', missing, corrupt });
  workbook(41, '2026-10'); const older = await command('sync'); assert.equal(older.result.reason, 'older-report');
  await page.evaluate(async () => { await BLFX.load(true); window.renderOpenCostingLanguage(); });
  page.once('dialog', dialog => dialog.dismiss()); await page.locator('#ocFxFolderSync button').click(); assert.equal(writes.length, 0);
  await command('saturate');
  page.once('dialog', dialog => dialog.accept()); await page.locator('#ocFxFolderSync button').click();
  await page.waitForFunction(() => BLFX.store.folderSync?.reason === 'worker-busy');
  assert.match(await page.locator('#ocFxFolderSync').innerText(), /queue is full/);
  assert.equal(await page.locator('#ocFxFolderSync button').count(), 0);
  assert.equal((await api('/api/fx')).data._revision, applied.store._revision);
  await command('drain'); await command('sync');
  await page.evaluate(async () => { await BLFX.load(true); window.renderOpenCostingLanguage(); });
  page.once('dialog', dialog => dialog.accept()); await page.locator('#ocFxFolderSync button').click();
  await page.waitForFunction(() => BLFX.store.folderSync === null);
  const confirmed = (await api('/api/fx')).data; assert.equal(confirmed._revision, applied.store._revision + 1); assert.equal(confirmed.months['2026-10'].TRY, 41); assert.equal(confirmed.months['2026-11'].TRY, 42);
  assert.equal(writes.length, 2);
  const stale = await api('/api/fx/apply-source-kur', { fingerprint: confirmed.sourceFingerprint, expectedRevision: applied.store._revision });
  // Use a changed source to make the stale revision reach the write guard.
  workbook(43, '2026-09'); const candidate = await command('sync');
  const conflict = await api('/api/fx/apply-source-kur', { fingerprint: candidate.folderSync.fingerprint, expectedRevision: applied.store._revision });
  assert.equal(conflict.response.status, 409); assert.equal(conflict.data.code, 'REVISION_CONFLICT');
  const changed = await api('/api/fx/apply-source-kur', { fingerprint: '0'.repeat(64), expectedRevision: confirmed._revision }); assert.equal(changed.response.status, 409); assert.equal(changed.data.code, 'SOURCE_KUR_CHANGED');
  assert.equal((await api('/api/fx')).data._revision, confirmed._revision);
  evidence.scenarios.push({ name: 'explicit-confirmation-busy-and-conflicts', cancelledWrites: 0, busyRequestsWithoutWrite: 1, confirmedWrites: 1, totalBrowserRequests: writes.length, confirmedRevision: confirmed._revision, conflict: conflict.data, changed: changed.data, unchangedExplicitStatus: stale.response.status });
  assert.deepEqual(pageErrors, []); evidence.pageErrors = pageErrors; evidence.externalRequests = external;
  evidence.result = 'PASS'; fs.writeFileSync(path.join(__dirname, 'acceptance.json'), JSON.stringify(evidence, null, 2) + '\n');
  console.log(JSON.stringify({ result: 'PASS', scenarios: evidence.scenarios.map(item => item.name), screenshots: evidence.screenshots }));
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  await browser?.close();
  if (server && server.exitCode === null) { const exited = new Promise(resolve => server.once('exit', resolve)); server.kill(); await exited; }
  fs.rmSync(root, { recursive: true, force: true });
});
