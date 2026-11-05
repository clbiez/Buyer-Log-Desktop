'use strict';
// Real app, production routes and output editor. No corporate service is contacted.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const assert = require('node:assert/strict');
const { fork } = require('node:child_process');
const { chromium } = require('playwright');
const app = path.resolve(__dirname, '..');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lcwai-acceptance-'));
const child = fork(path.join(app, 'tests/helpers/lcwai-retention-server.cjs'), [root], { cwd: app, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
const log = fs.createWriteStream(path.join(root, 'server.log'));
child.stdout.pipe(log); child.stderr.pipe(log);
let browser;
function reply(predicate) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { cleanup(); reject(new Error('Fixture timeout: ' + root)); }, 45000);
    const onMessage = message => { if (predicate(message)) { cleanup(); message.error ? reject(new Error(message.error)) : resolve(message); } };
    const onExit = code => { cleanup(); reject(new Error('Fixture exited: ' + code)); };
    function cleanup() { clearTimeout(timeout); child.off('message', onMessage); child.off('exit', onExit); }
    child.on('message', onMessage); child.on('exit', onExit);
  });
}
(async () => {
  const ready = await reply(message => message.ready);
  const seeded = reply(message => message.id === 'outputs');
  child.send({ command: 'seedLcwOutputs', id: 'outputs' });
  const { first } = await seeded;
  browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce', timezoneId: 'Europe/Istanbul' });
  await context.route('**/*', route => ['127.0.0.1', 'localhost'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort());
  await context.route('**/api/lcwai/status*', route => route.fulfill({ json: { status: { connected: false, state: 'disconnected' } } }));
  const base = 'http://127.0.0.1:' + ready.port;
  assert.equal((await context.request.post(base + '/api/user-login', { data: { username: 'fixture-admin', password: 'Fixture-only-123' } })).status(), 200);
  const outputs = await (await context.request.get(base + '/api/lcwai/outputs')).json();
  assert.equal(outputs.outputs.length, 45, 'all 45 outputs are visible, foreign output excluded');
  assert.equal((await context.request.get(base + '/api/lcwai/output-drafts/' + first.draftId)).status(), 200);
  await context.addInitScript(() => localStorage.setItem('bl.releaseNotes.lastSeenStable.v1', '99.0.0'));
  const page = await context.newPage();
  await page.addLocatorHandler(page.locator('[data-rn-close]:visible').first(), locator => locator.click(), { noWaitAfter: true });
  const openApp = async () => {
    await page.goto(base, { waitUntil: 'domcontentloaded' });
    const proceed = page.getByRole('button', { name: /Buyer Log.a devam et|Continue to Buyer Log/i });
    await proceed.click({ timeout: 30000 });
    await page.locator('button[data-tab="lcwai"]').click();
    await page.locator('[data-chat-input]').waitFor();
  };
  await openApp();
  await page.evaluate(file => {
    const chat = window.BLLcwAiChat;
    chat._state.conversations = [
      { id: 'demo-file-chat', title: 'Demo Raporu · iki gün önce', messages: [{ role: 'ai', text: 'Demo raporunuz hazır.', file }] },
      { id: 'demo-keep', title: 'Demo planlama', messages: [{ role: 'user', text: 'Demo planlamaya devam edelim.' }] },
    ];
    chat.persistConversations();
  }, first);
  await openApp();
  page.once('dialog', dialog => dialog.dismiss());
  await page.locator('[data-chat-delete="demo-file-chat"]').click();
  assert.equal(await page.locator('[data-chat-open="demo-file-chat"]').count(), 1, 'cancel preserves chat');
  page.once('dialog', dialog => dialog.accept());
  await page.locator('[data-chat-delete="demo-file-chat"]').click();
  assert.equal(await page.locator('[data-chat-open="demo-file-chat"]').count(), 0);
  assert.equal(await page.locator('[data-chat-open="demo-keep"].is-active').count(), 1);
  await openApp();
  assert.equal(await page.locator('[data-chat-open="demo-file-chat"]').count(), 0, 'deletion survives reload');
  await page.locator('[data-chat-outputs]').click();
  await page.waitForFunction(() => document.querySelectorAll('[data-file-card]').length === 45);
  assert.equal(await page.locator('[data-chat-form]').isVisible(), false);
  const assets = path.join(app, 'public/release-notes/next-assets');
  fs.mkdirSync(assets, { recursive: true });
  await page.screenshot({ path: path.join(assets, 'lcwai-files-60-days.png') });
  await page.locator(`[data-file-edit="${first.id}"]`).click();
  await page.locator('[data-ed-title]').waitFor();
  await page.locator('[data-ed-title]').fill('Demo Raporu Güncellendi');
  await page.locator('[data-ed-mode="review"]').click();
  const [response] = await Promise.all([
    page.waitForResponse(response => response.url().endsWith('/render') && response.request().method() === 'POST'),
    page.locator('[data-ed-render]').first().click(),
  ]);
  assert.equal(response.status(), 200);
  const result = await response.json();
  assert.equal(result.output.edited, true);
  assert.equal(result.output.draftId, first.draftId);
  await page.waitForFunction(() => document.querySelector('[data-ed-open]'));
  await page.screenshot({ path: path.join(assets, 'lcwai-retained-file-edit.png') });
  await page.locator('[data-ed-close]').first().click();
  await page.waitForFunction(() => document.querySelectorAll('[data-file-card]').length === 46);
  await page.evaluate(() => applyLanguage('en'));
  assert.match(await page.locator('[data-chat-messages]').innerText(), /My files · Last 60 days/);
  assert.equal(await page.getByRole('button', { name: 'Back to chat', exact: true }).count(), 1);
  await page.getByRole('button', { name: 'Back to chat', exact: true }).click();
  assert.equal(await page.locator('[data-chat-form]').isVisible(), true);
  page.once('dialog', dialog => dialog.accept());
  await page.locator('[data-chat-delete="demo-keep"]').click();
  assert.equal(await page.locator('[data-chat-open]').count(), 0);
  assert.equal(await page.locator('[data-chat-input]').isVisible(), true);
  assert.equal((await (await context.request.get(base + '/api/lcwai/outputs')).json()).outputs.length, 46);
  console.log('PASS: cancel/delete/reload/last chat, 45 two-day-old files, owner isolation, edit/render after chat deletion, offline archive, TR/EN. Artifacts: ' + assets);
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => { if (browser) await browser.close(); child.kill(); log.end(); });
