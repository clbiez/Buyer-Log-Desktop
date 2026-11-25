'use strict';
// Gerçek Buyer Log (izole, üretilmiş demo veri) üzerinde model/renk kapsamlı
// checklist'te Onaylandı dışındaki durumların (Reddedildi, Gerekmiyor) aynı
// PLM + Model + Renkteki diğer PO'lara taşındığını doğrular ve sürüm notu
// görselini üretir. TEST/STABLE yayını veya uzak yazma yoktur.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { spawn, spawnSync } = require('node:child_process');
const { chromium } = require('playwright');
const app = path.resolve(__dirname, '..');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'buyerlog-option-scope-'));
const port = Number(process.env.BUYER_LOG_OPTION_SCOPE_PORT || 6479);
const base = `http://127.0.0.1:${port}`;
const shot = path.join(app, 'public/release-notes/next-assets/checklist-option-scope-all-statuses.png');
const env = { ...process.env, BUYER_LOG_DATA_ROOT: path.join(root, 'app'), BUYER_LOG_SERVER_DATA_ROOT: path.join(root, 'server'), BUYER_LOG_LOCAL_DATA_ROOT: path.join(root, 'local'), BUYER_LOG_TEMP_ROOT: path.join(root, 'temp'), BUYER_LOG_AUTH_DATA_ROOT: path.join(root, 'server'), BUYER_LOG_CONFIG_PATH: path.join(root, 'config.json') };
for (const folder of ['app', 'server', 'local', 'temp']) fs.mkdirSync(path.join(root, folder));
const generated = spawnSync(process.execPath, ['scripts/generate-demo-data.js', path.join(root, 'source'), '--rows', '300'], { cwd: app, encoding: 'utf8' });
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
  const login = await fetch(base + '/api/user-login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId: 'moderator', password: 'option-demo-2026', newPassword: 'option-demo-2026' }) });
  assert.equal(login.status, 200, await login.text());
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const refresh = await fetch(base + '/api/refresh', { method: 'POST', headers: { cookie, 'Content-Type': 'application/json' }, body: '{}' });
  assert.ok(refresh.ok, `Demo refresh: ${refresh.status}`);
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, reducedMotion: 'reduce' });
  const separator = cookie.indexOf('=');
  await context.addCookies([{ name: cookie.slice(0, separator), value: cookie.slice(separator + 1), domain: '127.0.0.1', path: '/', httpOnly: true }]);
  await context.addInitScript(() => { localStorage.setItem('bl.releaseNotes.lastSeenStable.v1', '99.0.0'); });
  const page = await context.newPage();
  page.setDefaultTimeout(20000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('dialog', dialog => dialog.accept());
  await page.goto(base, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.BLPerf && typeof window.switchTab === 'function', null, { timeout: 60000 });
  await page.getByText(/Buyer Log'a devam et|Continue to Buyer Log/).click({ timeout: 60000 });
  await page.waitForFunction(() => !document.getElementById('blBootGuard'), null, { timeout: 60000 });
  await page.evaluate(async () => { document.querySelectorAll('dialog[open]').forEach(dialog => dialog.close()); await BLPerf.ensureFeature('cpAssistant'); });
  await page.waitForFunction(() => state.cp?.rows?.length > 0);
  await page.evaluate(() => BLCpAssistant.onOverviewRendered(state.cp.rows, { dataRevision: 1 }));

  const result = await page.evaluate(async () => {
    const item = BLCpRulesEngine.normalizeRule({ id: 'demo-option-scope', kind: 'checklist', name: 'Print Test', tr: 'Print Test', en: 'Print Test', approvalScope: 'option' });
    item.conditions = [{ field: '@daysToLoad', operator: 'lte', value: 3650 }];
    // Gerçek paylaşılan tanım akışı: kural tercihlere kaydedilir ve CP yeniden hesaplanır.
    BLCpAssistant._state.sharedChecklistAdopted = false;
    BLCpAssistant.adoptSharedChecklistDefinitions([item]);
    const rule = BLCpAssistant._state.rules.find(r => r.id === item.id);
    const saved = await fetch('/api/checklist-supplier/definitions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ definitions: [rule] }) });
    if (!saved.ok) return { error: 'definition write ' + saved.status };
    const rows = state.cp.rows.filter(r => r._canEdit !== false);
    const decisions = BLCpAssistant.computeDecisionsForRows(rows).byRow;
    const groups = new Map();
    for (const row of rows) {
      const analysis = decisions.get(row), identity = analysis && BLCpChecklistEngine.optionIdentity(analysis);
      if (!identity || BLCpChecklistEngine.Components.isSet(row, 'cp')) continue;
      if (!groups.has(identity)) groups.set(identity, []);
      groups.get(identity).push({ row, analysis });
    }
    const group = [...groups.values()].find(list => list.length >= 2 && new Set(list.map(e => e.analysis.orderKey)).size >= 2);
    if (!group) return { error: 'no shared option group' };
    const [first, second] = group;
    const ctx = () => ({ answers: BLCpAssistant._state.answers, item: rule });
    const out = {};
    for (const status of ['rejected', 'notRequired', 'approved']) {
      BLCpAssistant.setChecklistAnswer(first.analysis, rule.id, status);
      out[status] = [second].map(e => BLCpChecklistEngine.statusOf(e.analysis, rule.id, ctx()));
    }
    BLCpAssistant.setChecklistAnswer(first.analysis, rule.id, 'rejected');
    await BLChecklistSupplierSync.syncAnswerChanges();
    window.__optionDemo = { model: first.analysis.modelName, keys: group.map(e => e.analysis.orderKey), id: rule.id };
    return { out, model: first.analysis.modelName, size: group.length };
  });
  assert.ok(!result.error, result.error);
  assert.deepEqual(result.out.rejected, ['rejected'], JSON.stringify(result));
  assert.deepEqual(result.out.notRequired, ['notRequired'], JSON.stringify(result));
  assert.deepEqual(result.out.approved, ['approved'], JSON.stringify(result));

  const persisted = await page.evaluate(async () => {
    const payload = await (await fetch('/api/checklist-supplier')).json();
    return Object.entries(payload.answers || {}).filter(([key]) => key.startsWith('@option:') && key.endsWith('::' + __optionDemo.id)).map(([, a]) => a.state);
  });
  assert.deepEqual(persisted, ['rejected'], 'paylaşılan model/renk durumu sunucuya yazılmalı');

  await page.evaluate(async () => { await switchTab('cp'); await BLChecklistSupplierSync.refreshColumns({ render: true }); });
  await page.fill('#cpSearch', result.model);
  await page.locator('#cpSearch').dispatchEvent('input');
  await page.waitForTimeout(1500);
  await page.evaluate(async () => { await BLChecklistSupplierSync.refreshColumns({ render: true }); });
  await page.waitForTimeout(1500);
  const cells = await page.evaluate(() => {
    const th = [...document.querySelectorAll('#view-cp thead th')].find(el => /Print Test/.test(el.textContent));
    if (!th) return { error: 'no column', heads: [...document.querySelectorAll('#view-cp thead th')].map(el => el.textContent.trim()).slice(-12) };
    th.scrollIntoView({ block: 'nearest', inline: 'center' });
    const keys = new Set(__optionDemo.keys);
    const rows = state.cp.rows.filter(r => keys.has(r._cpOrderKey));
    return { values: rows.map(r => r['__checklist__' + __optionDemo.id] || ''), status: rows.map(r => (r._checklistStatus || {})[__optionDemo.id]), dom: [...document.querySelectorAll('#view-cp tbody tr')].map(tr => tr.textContent.match(/Reddedildi|Rejected/g)?.length || 0) };
  });
  await page.waitForTimeout(500);
  assert.ok(!cells.error, JSON.stringify(cells));
  assert.ok(cells.values.filter(v => /Reddedildi|Rejected/.test(v)).length >= 2, JSON.stringify(cells));
  if (!process.argv.includes('--no-shot')) {
    fs.mkdirSync(path.dirname(shot), { recursive: true });
    await page.screenshot({ path: shot, clip: { x: 0, y: 0, width: 1440, height: 640 } });
  }
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ ...result, persisted, cells, shot }, null, 1));
})().catch(async error => {
  console.error(error);
  const page = browser?.contexts()[0]?.pages()[0];
  if (page) await page.screenshot({ path: path.join(root, 'failure.png') }).catch(() => {});
  console.error('failure screenshot:', path.join(root, 'failure.png'));
  process.exitCode = 1;
}).finally(async () => { await browser?.close(); server.kill(); fs.closeSync(log); });
