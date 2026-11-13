'use strict';
/* Sessiz eksik görsel tamamlama — kabul + L2 ölçümü (yalnız sentetik demo veri).
 *
 *   node scripts/silent-image-complete-acceptance.js --mode perf --rows 30000 --app-root <dir> --out <json>
 *   node scripts/silent-image-complete-acceptance.js --mode functional --rows 40 --out <json> [--screenshot <png>]
 *
 * perf: açılış perdesi, Orders hazır, CP modül açılışı, 30k Orders kaydırması ve
 * kaydırma sonrası 20 sn boşta pencerede uzun görevler (>50 ms), sessiz istek
 * sayısı/başlığı, toast, Operasyon Merkezi ve tablo gövdesi yeniden çizimi.
 * Main ve aday için aynı betik --app-root ile çalışır (Main'de motor yoktur).
 *
 * functional: görünür bir Orders satırının görseli sunucuda bağlanır ama
 * istemci bunu bilmez (eski durum). Sessiz motor açılınca hücre, tablo yeniden
 * çizilmeden görsel kaynağına bağlanmalıdır. Gerçek CoreNectum'a gidilmez. */
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), net = require('node:net');
const assert = require('node:assert/strict');
const { spawn, spawnSync } = require('node:child_process');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const arg = (name, fallback) => { const i = process.argv.indexOf(name); return i < 0 ? fallback : process.argv[i + 1]; };
const tools = path.resolve(__dirname, '..');
const app = path.resolve(arg('--app-root', tools));
const mode = arg('--mode', 'perf');
const rows = Number(arg('--rows', mode === 'perf' ? 30000 : 40));
const out = arg('--out', '');
const screenshot = arg('--screenshot', '');
const sourceFixture = arg('--source-fixture', '');
const lang = arg('--lang', 'tr');
const { initializeBenchmarkState } = require(path.join(tools, 'scripts/lib/startup-benchmark'));
assert.ok(['perf', 'functional', 'screenshot'].includes(mode));
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'buyerlog-silent-img-'));
const env = { ...process.env, BUYER_LOG_CENTRAL_IAM_ENABLED: '0',
  BUYER_LOG_SERVER_DATA_ROOT: path.join(root, 'data'), BUYER_LOG_AUTH_DATA_ROOT: path.join(root, 'data'),
  BUYER_LOG_DATA_ROOT: path.join(root, 'app'), BUYER_LOG_LOCAL_DATA_ROOT: path.join(root, 'local'),
  BUYER_LOG_LOCAL_DB: path.join(root, 'local/BuyerLogLocal.db'), BUYER_LOG_CONFIG_PATH: path.join(root, 'config.json'),
  BUYER_LOG_TEMP_ROOT: path.join(root, 'tmp') };
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
let server, browser, cookie = '', base;
async function api(url, body, method) {
  const response = await fetch(base + url, { method: method || (body ? 'POST' : 'GET'), signal: AbortSignal.timeout(120000),
    headers: { cookie, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  if (!response.ok) throw new Error(url + ': ' + response.status + ' ' + await response.text());
  return response;
}
(async () => {
  const socket = net.createServer(); await new Promise(resolve => socket.listen(0, '127.0.0.1', resolve));
  const port = socket.address().port; await new Promise(resolve => socket.close(resolve)); base = 'http://127.0.0.1:' + port;
  let source = sourceFixture ? path.resolve(sourceFixture) : path.join(root, 'source');
  if (!sourceFixture) {
    const generated = spawnSync(process.execPath, [path.join(tools, 'scripts/generate-demo-data.js'), source, '--rows', String(rows), '--seed', '7'], { cwd: tools, encoding: 'utf8' });
    assert.equal(generated.status, 0, generated.stderr);
  }
  initializeBenchmarkState(root);
  fs.writeFileSync(env.BUYER_LOG_CONFIG_PATH, JSON.stringify({ port, host: '127.0.0.1', sourceFolder: source, updates: { enabled: false } }));
  const log = fs.openSync(path.join(root, 'server.log'), 'a');
  server = spawn(process.execPath, ['server/server.js'], { cwd: app, env, stdio: ['ignore', log, log] }); fs.closeSync(log);
  let ready = false;
  for (let i = 0; i < 240; i++) { try { await api('/api/status'); ready = true; break; } catch (_) {} await delay(250); }
  assert.ok(ready, 'Synthetic server did not start');
  const login = await api('/api/user-login', { userId: 'moderator', password: 'synthetic-perf-only-123', newPassword: 'synthetic-perf-only-123' });
  cookie = login.headers.get('set-cookie').split(';')[0];
  await api('/api/refresh', {});
  for (let i = 0; i < 2400; i++) { const status = await (await api('/api/refresh-status')).json(); if (!status.running) { assert.equal(status.error, null); break; } await delay(250); }
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce', deviceScaleFactor: mode === 'screenshot' ? 2 : 1 });
  const split = cookie.indexOf('=');
  await context.addCookies([{ name: cookie.slice(0, split), value: cookie.slice(split + 1), url: base, httpOnly: true }]);
  await context.addInitScript(({ functional, lang }) => {
    localStorage.setItem('bl.user.moderator.lcw.lang.v1', lang);
    for (const key of ['bl.releaseNotes.lastSeenStable.v1', 'bl.user.moderator.bl.releaseNotes.lastSeenStable.v1']) localStorage.setItem(key, '99.0.0');
    // İşlevsel kipte motor tohumlamadan önce kapalı başlar (sonra açılır).
    if (functional) localStorage.setItem('bl.user.moderator.bl.modelImages.silentComplete.v1', '0');
    window.__silentProbe = { longTasks: [], mark: 0 };
    try { new PerformanceObserver(list => { for (const t of list.getEntries()) window.__silentProbe.longTasks.push({ start: t.startTime, duration: t.duration }); }).observe({ type: 'longtask', buffered: true }); } catch (_) {}
  }, { functional: mode !== 'perf', lang });
  const page = await context.newPage(), errors = [], imageRequests = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('dialog', dialog => dialog.dismiss());
  await page.route('https://**', route => route.abort());
  page.on('request', request => {
    if (request.url().includes('/api/model-images/import-plm')) imageRequests.push({ at: Date.now(), silent: request.headers()['x-buyerlog-auth-mode'] === 'silent', items: (() => { try { return JSON.parse(request.postData() || '{}').items.length; } catch (_) { return -1; } })() });
  });
  const t0 = Date.now();
  await page.goto(base + '/?module=orders', { waitUntil: 'domcontentloaded', timeout: 300000 });
  await page.waitForSelector('[data-boot-continue]', { timeout: 900000 });
  const bootReadyMs = Date.now() - t0;
  const t1 = Date.now();
  await page.click('[data-boot-continue]');
  await page.waitForFunction(() => !document.getElementById('blBootGuard') && document.querySelector('#ordersTable tbody tr[data-id]'), null, { timeout: 900000 });
  const ordersReadyMs = Date.now() - t1;
  const ordersRows = await page.evaluate(() => state.orders?.rows.length || 0);
  const result = { mode, appRoot: app, rows, ordersRows, bootReadyMs, ordersReadyMs, engine: await page.evaluate(() => Boolean(window.BLSilentImageComplete)) };
  // Bildirim sayacı: showToast ve BLUI.notify çağrıları doğrudan sayılır.
  const armToasts = () => page.evaluate(() => {
    window.__toastCalls = [];
    const wrap = fn => function (...args) { window.__toastCalls.push(String(args[0]).slice(0, 120)); return fn.apply(this, args); };
    if (!window.__toastWrapped) {
      window.__toastWrapped = true;
      if (typeof window.showToast === 'function') window.showToast = wrap(window.showToast);
      if (window.BLUI && typeof window.BLUI.notify === 'function') window.BLUI.notify = wrap(window.BLUI.notify);
    }
  });

  if (mode === 'perf') {
    const t2 = Date.now();
    await page.evaluate(() => switchTab('cp'));
    await page.waitForFunction(() => document.body.dataset.activeTab === 'cp' && document.querySelector('#cpTable tbody tr[data-id]'), null, { timeout: 900000 });
    result.cpOpenMs = Date.now() - t2;
    await page.evaluate(() => switchTab('orders'));
    await page.waitForFunction(() => document.querySelector('#ordersTable tbody tr[data-id]'), null, { timeout: 300000 });
    await delay(1500);
    // Kaydırma penceresi
    const scroll = await page.evaluate(async () => {
      // Asıl kaydırıcı: Orders görünümündeki en uzun kaydırılabilir kap (ya da belge).
      const view = document.getElementById('view-orders') || document.body;
      let wrap = document.scrollingElement, best = wrap.scrollHeight - wrap.clientHeight;
      for (const el of view.querySelectorAll('*')) { const room = el.scrollHeight - el.clientHeight; if (room > best && /auto|scroll/.test(getComputedStyle(el).overflowY)) { wrap = el; best = room; } }
      const probe = window.__silentProbe;
      const start = performance.now();
      for (let i = 0; i < 40; i++) { wrap.scrollTop += 2000; await new Promise(r => setTimeout(r, 50)); }
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      const tasks = probe.longTasks.filter(t => t.start >= start);
      return { ms: performance.now() - start, longTasks: tasks.length, maxLongTaskMs: tasks.reduce((m, t) => Math.max(m, t.duration), 0), scrollTop: wrap.scrollTop, scrollRoom: best, scroller: wrap.id || wrap.tagName };
    });
    result.scroll = scroll;
    // Sessiz pencere: kullanıcı 20 sn etkileşimsiz.
    const requestsBefore = imageRequests.length;
    await armToasts();
    const silent = await page.evaluate(async () => {
      const probe = window.__silentProbe, tbody = document.querySelector('#ordersTable tbody');
      let rowMutations = 0, toasts = 0;
      const rowObserver = new MutationObserver(list => { for (const m of list) if (m.type === 'childList' && (m.addedNodes.length || m.removedNodes.length)) rowMutations++; });
      rowObserver.observe(tbody, { childList: true });
      const toastObserver = new MutationObserver(list => { for (const m of list) for (const n of m.addedNodes) if (n.nodeType === 1 && /toast|notify|blUiNotify/i.test(n.className + ' ' + n.id)) toasts++; });
      toastObserver.observe(document.body, { childList: true, subtree: true });
      const opsBefore = document.querySelector('.plmOpsPanel:not([hidden]), #blPlmOpsPanel:not([hidden])') ? 1 : 0;
      const start = performance.now();
      await new Promise(r => setTimeout(r, 20000));
      rowObserver.disconnect(); toastObserver.disconnect();
      const tasks = probe.longTasks.filter(t => t.start >= start);
      const opsAfter = document.querySelector('.plmOpsPanel:not([hidden]), #blPlmOpsPanel:not([hidden])') ? 1 : 0;
      return { longTasks: tasks.length, maxLongTaskMs: tasks.reduce((m, t) => Math.max(m, t.duration), 0), rowMutations, toasts, opsOpened: opsAfter - opsBefore,
        toastCalls: window.__toastCalls.slice(), stats: window.BLSilentImageComplete ? window.BLSilentImageComplete.stats() : null };
    });
    silent.requests = imageRequests.slice(requestsBefore);
    result.silent = silent;
  } else {
    // İşlevsel: görünür ilk görselsiz Orders hücresi seçilir.
    const target = await page.evaluate(() => {
      const wrap = document.getElementById('ordersTableWrap');
      for (const img of wrap.querySelectorAll('td.cpPictureCell>img[data-has-image="0"]')) {
        const r = img.getBoundingClientRect(); if (r.bottom <= 0 || r.top >= innerHeight) continue;
        const row = state.orders.rows.find(item => String(item._id) === img.dataset.id);
        if (!row || !normalizePlmLinkId(row['PLM ID'])) continue;
        return { id: img.dataset.id, plmId: row['PLM ID'], colourCode: row['C.Code'], colour: row.Colour || row['Colour'] || row.Color || '' };
      }
      return null;
    });
    assert.ok(target, 'görünür görselsiz Orders satırı bulunmalı');
    const saved = await (await api('/api/collection-images', { rowId: 'silent-demo', filename: 'demo.png', mimeType: 'image/png', base64: PNG })).json();
    await api('/api/plm-image-links', { items: [{ plmId: target.plmId, colourCode: target.colourCode, colour: target.colour, imageRef: saved.image.id }] });
    const before = await page.evaluate(id => {
      const tbody = document.querySelector('#ordersTable tbody');
      window.__rowMutations = 0;
      new MutationObserver(list => { for (const m of list) if (m.addedNodes.length || m.removedNodes.length) window.__rowMutations++; }).observe(tbody, { childList: true });
      const img = document.querySelector(`#ordersTableWrap img[data-id="${id}"]`);
      window.__targetImg = img; img.dataset.probe = 'same-node';
      return { hasImage: img.dataset.hasImage, src: img.dataset.src, scrollTop: document.getElementById('ordersTableWrap').scrollTop };
    }, target.id);
    assert.equal(before.hasImage, '0');
    await delay(4500); // açılış/yenileme bildirimleri sönsün
    await armToasts();
    await page.evaluate(() => window.BLSilentImageComplete.setEnabled(true));
    await page.waitForFunction(() => window.__targetImg.dataset.hasImage === '1', null, { timeout: 60000 }).catch(async error => {
      console.error('stats', JSON.stringify(await page.evaluate(() => ({ stats: window.BLSilentImageComplete.stats(), enabled: window.BLSilentImageComplete.isEnabled(), connected: window.__targetImg.isConnected, requests: 0 }))), JSON.stringify(imageRequests));
      throw error;
    });
    const after = await page.evaluate(() => ({
      sameNode: window.__targetImg.isConnected && window.__targetImg.dataset.probe === 'same-node',
      hasImage: window.__targetImg.dataset.hasImage, src: window.__targetImg.dataset.src,
      rowMutations: window.__rowMutations, scrollTop: document.getElementById('ordersTableWrap').scrollTop,
      toastCalls: window.__toastCalls.slice(),
      stats: window.BLSilentImageComplete.stats(),
    }));
    result.functional = { target, before, after, requests: imageRequests.slice() };
    assert.equal(after.sameNode, true, 'hücre yeniden çizilmeden güncellenmeli');
    assert.match(after.src, new RegExp(saved.image.id));
    assert.equal(after.rowMutations, 0, 'tablo gövdesi yeniden çizilmemeli');
    assert.equal(after.scrollTop, before.scrollTop);
    assert.deepEqual(after.toastCalls, [], 'sessiz iş bildirim açmaz');
    assert.ok(imageRequests.length >= 1 && imageRequests.every(r => r.silent && r.items <= 12));
    if (mode === 'screenshot' && screenshot) {
      await page.evaluate(() => openModelImageLimitModal());
      await page.waitForSelector('#_modelImageSilentComplete', { timeout: 30000 });
      await delay(800);
      fs.mkdirSync(path.dirname(path.resolve(screenshot)), { recursive: true });
      await page.screenshot({ path: path.resolve(screenshot) });
      result.screenshot = path.resolve(screenshot);
    }
  }
  // Gözlemci kanıtı: tüm oturumdaki uzun görevler (açılış dahil).
  result.sessionLongTasks = await page.evaluate(() => ({ count: window.__silentProbe.longTasks.length, maxMs: window.__silentProbe.longTasks.reduce((m, t) => Math.max(m, t.duration), 0) }));
  result.errors = errors;
  if (out) { fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true }); fs.writeFileSync(path.resolve(out), JSON.stringify(result, null, 2)); }
  console.log(JSON.stringify(result));
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  try { await browser?.close(); } catch (_) {}
  try { server?.kill(); } catch (_) {}
  if (!process.env.KEEP_FIXTURE) { await delay(500); try { fs.rmSync(root, { recursive: true, force: true }); } catch (_) {} }
  else console.error('fixture:', root);
});
